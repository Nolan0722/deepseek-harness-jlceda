'use strict';
const { app, BrowserWindow, ipcMain, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { ContextHost } = require('./context-host.cjs');
const { createDshNetwork } = require('./dsh-network.cjs');
const { sidebarProfile } = require('./sidebar-profile.cjs');
const { prepareDshTemp } = require('./dsh-temp.cjs');
const root = path.resolve(__dirname, '..');
const lab = path.join(root, 'lab');
const nativeRequests=require('./native-request-lifecycle.cjs').createNativeRequestLifecycle();
globalThis.__JLC_DSH_TRACK_NATIVE_REQUEST__=operation=>nativeRequests.run(operation);
globalThis.__JLC_DSH_CLOSE_NATIVE_DATABASES__=require('./native-request-lifecycle.cjs').closeNativeDatabases;
const node = path.join(root, '.tools/node_modules/node-win-x64/bin/node.exe');
const cli = path.join(root, 'runtime/node_modules/@deepseek-ai/dsh/lib/bin.js');
const profile = globalThis.__JLC_DSH_ISOLATION__.userData;
const tls={certFile:path.join(lab,'tls/cert.pem'),keyFile:path.join(lab,'tls/key.pem')};
const certificateFingerprint=new crypto.X509Certificate(fs.readFileSync(tls.certFile)).fingerprint256;
const certificateReady=app.whenReady().then(()=>{
  session.defaultSession.setCertificateVerifyProc((request,callback)=>{
    const current=Date.now()/1000;
    if(request.hostname==='127.0.0.1'&&request.certificate.validStart<=current&&request.certificate.validExpiry>current&&new crypto.X509Certificate(request.certificate.data).fingerprint256===certificateFingerprint)callback(0);
    else callback(-3); // Other hosts retain Chromium's normal certificate checks.
  });
});
let dshNetwork;
const views = new Map();
let child = null;
let authenticatedURL = null;
// The shipped HTTP protocol handler owns a separate JLC cookie jar. DSH must
// use the browser cookie jar for dedicated HTTPS requests and the native WSS stack.
globalThis.__JLC_DSH_IS_NETWORK_URL__=value=>{
  try{return !!authenticatedURL&&new URL(value).origin===new URL(authenticatedURL).origin;}catch{return false;}
};
globalThis.__JLC_DSH_FETCH__=request=>dshNetwork.fetch(request);
let startPromise = null;
let closing = false;
let status = { phase: 'idle', message: '正在准备 JLCEDA Agent…' };
let timer;
const contextHost=new ContextHost({root,profile,views,onChange:()=>{
  snapshot();
  for(const {win} of views.values())if(!win.isDestroyed())win.webContents.send('jlc-dsh:mcp-status',contextHost.mcp.status());
}});
function redacted(text) { return String(text).replace(/([?&]token=)[^\s\x1b"'<>]+/g, '$1[REDACTED]'); }
function log(message) { fs.appendFileSync(path.join(lab, 'host.log'), `${new Date().toISOString()} ${redacted(message)}\n`); }
function snapshot() {
  if (!views.size && status.phase === 'idle') return;
  const record = { pid: process.pid, execPath: process.execPath, appName: app.getName(), userData: app.getPath('userData'),
    documents: app.getPath('documents'), home: app.getPath('home'),
    endpoint: app.getName().replace(/\s/g, '') + crypto.createHash('sha256').update(app.getPath('userData')).digest('hex').slice(0, 8),
    dshPid: child?.pid ?? null, dshOrigin: authenticatedURL ? new URL(authenticatedURL).origin : null,
    status,mcp:contextHost.mcp.status(), embedding: 'sandboxed-iframe',
    contextOwnerId:contextHost.ownerId,
    ...(app.commandLine.hasSwitch('remote-debugging-port')?{contextPipe:contextHost.pipe}:{}),
    windows: [...views.values()].map(({ win, frameReady, contextWindowKey, conversationId }) => ({ id: win.id, hostWebContentsId: win.webContents.id,
      frameReady,contextWindowKey,conversationId })) };
  fs.writeFileSync(path.join(lab, `host-state-${process.pid}.json`), JSON.stringify(record, null, 2));
}
function publish(next) {
  status = next;
  for (const { win } of views.values()) if (!win.isDestroyed()) win.webContents.send('jlc-dsh:status', status);
  snapshot();
}
function stopChild() {
  clearTimeout(timer);
  if (child && child.exitCode === null && child.signalCode === null) {
    const outcome = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8' });
    log(`cleanup DSH ${child.pid}: ${outcome.status}`);
  }
  child = null;
  authenticatedURL = null;
  startPromise = null;
}
function createOverlay() {
  const overlay = [...sidebarProfile(),{id:'webserver',config:{host:'127.0.0.1',port:0,tls,compression:'gzip'}},{ insert: [{ id: 'jlc-context', name: path.join(root,'plugins/jlc-context/index.cjs'),
    config:{pipe:contextHost.pipe,debug:app.commandLine.hasSwitch('remote-debugging-port'),systemPromptModule:path.join(root,'runtime/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js')} }] }];
  const file = path.join(lab, 'jlceda.cordis.json');
  fs.writeFileSync(file, JSON.stringify(overlay, null, 2));
  return file;
}
function start() {
  if (closing) return Promise.reject(new Error('Host is closing'));
  if (startPromise) return startPromise;
  fs.mkdirSync(path.join(lab, 'workspace'), { recursive: true });
  const dshTemp=prepareDshTemp(profile);
  const env = { ...process.env, TEMP:dshTemp,TMP:dshTemp,DSH_HOME: path.join(lab, 'dsh-home'), PATH: `${path.dirname(node)};${process.env.PATH}` };
  delete env.ELECTRON_RUN_AS_NODE;
  // The independent profile owns model credentials; no ambient API keys are imported.
  for (const key of Object.keys(env)) if (/KEY|PASSWORD|SECRET|TOKEN/i.test(key)) delete env[key];
  env.JLC_FRAME_ANCESTORS=frameAncestors();
  publish({ phase: 'starting', message: '正在启动 JLCEDA Agent…' });
  startPromise = Promise.all([certificateReady,contextHost.start()]).then(()=>new Promise((resolve, reject) => {
    dshNetwork=createDshNetwork({certificate:fs.readFileSync(tls.certFile),session:session.defaultSession,getOrigin:()=>authenticatedURL?new URL(authenticatedURL).origin:null});
    const proc = spawn(node, [cli, 'web', '--patch', createOverlay(), '--host', '127.0.0.1', '--port', '0', '--no-open'],
      { cwd: path.join(lab, 'workspace'), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child = proc;
    let buffer = '';
    let lineBuffer = '';
    function receive(chunk) {
      buffer = (buffer + chunk.toString()).slice(-100000);
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split(/\r?\n/); lineBuffer = lines.pop();
      for (const line of lines) log(`dsh: ${line}`);
      const found = buffer.match(/https:\/\/127\.0\.0\.1:\d+\/[^\s\x1b]*[?&]token=[A-Za-z0-9._~%-]+/);
      if (found && !authenticatedURL) {
        authenticatedURL = found[0];
        dshNetwork.authenticate(authenticatedURL).then(url=>{
          clearTimeout(timer);authenticatedURL=url;
          publish({ phase: 'ready', message: 'JLCEDA Agent 已就绪' });resolve(url);
        },error=>{clearTimeout(timer);stopChild();publish({phase:'error',message:'DSH 登录初始化失败'});reject(error);});
      }
    }
    proc.stdout.on('data', receive); proc.stderr.on('data', receive);
    proc.once('error', error => { clearTimeout(timer); if(child===proc){child=null;authenticatedURL=null;startPromise=null;} publish({ phase: 'error', message: `DSH 启动失败：${error.message}` }); reject(error); });
    proc.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (child === proc) { child = null; authenticatedURL = null; startPromise = null; }
      if (!closing) {
        for (const entry of views.values()) entry.frameReady = false;
        publish({ phase: 'error', message: `DSH 已停止（${code ?? signal}），可点击重试。` });
      }
      reject(new Error(`DSH exited ${code ?? signal}`));
    });
    timer = setTimeout(() => { stopChild(); publish({ phase: 'error', message: 'DSH 启动超时，请重试。' }); reject(new Error('DSH startup timed out')); }, 90000);
    snapshot();
  }));
  return startPromise;
}
function configuredOnlineOrigin(){
  try{
    const service=JSON.parse(fs.readFileSync(path.join(profile,'documents','LCEDA-Pro','config.json'),'utf8')).onlineService;
    const url=new URL(service);
    if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash)return null;
    if(!/^(?:[a-z0-9-]+\.)*(?:lceda\.cn|easyeda\.com)$/.test(url.hostname))return null;
    return url.origin;
  }catch{return null;}
}
function editorDocument(value){
  let address;try{address=new URL(value);}catch{return false;}
  if(!/^\/editor(?:\/\d+\.\d+\.\d+(?:\.\d+)?)?\/?$/.test(address.pathname))return false;
  return address.origin==='https://client'||address.origin===configuredOnlineOrigin();
}
function frameAncestors(){
  const origins=new Set(['https://client']),online=configuredOnlineOrigin();
  for(const {win} of views.values()){
    if(win.isDestroyed())continue;
    try{const origin=new URL(win.webContents.getURL()).origin;if(origin===online)origins.add(origin);}catch{}
  }
  return [...origins].join(' ');
}
function trusted(event) {
  if (event.sender.isDestroyed() || event.senderFrame !== event.sender.mainFrame) return null;
  let address;try{address=new URL(event.sender.getURL());}catch{return null;}
  if(!editorDocument(address.href))return null;
  const win = BrowserWindow.fromWebContents(event.sender);
  return win && !win.isDestroyed() ? win : null;
}
function ensure(win) {
  if (views.has(win.id)) return views.get(win.id);
  const entry = { win, frameReady: false,contextWindowKey:crypto.randomUUID() };
  views.set(win.id, entry);
  win.on('closed', () => {
    dispose(entry);
    snapshot();
  });
  return entry;
}
function dispose(entry) {
  if(entry.disposed)return;
  entry.disposed=true;
  views.delete(entry.win.id);
}
function waitEvent(emitter,event){
  return new Promise(resolve=>{
    const complete=()=>{clearTimeout(timeout);emitter.removeListener(event,complete);resolve();};
    const timeout=setTimeout(complete,5000);
    emitter.once(event,complete);
  });
}
ipcMain.handle('jlc-dsh:bootstrap', async event => {
  const win = trusted(event);
  if(!win||closing){
    let where='unavailable';
    try{if(!event.sender.isDestroyed()){const address=new URL(event.sender.getURL());where=`${address.origin}${address.pathname}`;}}catch{}
    log(`rejected sidebar sender closing=${!!closing} url=${where}`);
    throw Error('Invalid sidebar sender');
  }
  const page=new URL(win.webContents.getURL());
  if(page.origin!=='https://client'){
    log(`DSH not started; editor is online ${page.origin}${page.pathname}`);
    throw Error('ONLINE_MODE');
  }
  const entry = ensure(win);
  entry.frameReady=false;
  const url=await start();
  if(entry.disposed||closing)throw Error('Sidebar closed while starting');
  snapshot();
  return {url};
});
ipcMain.handle('jlc-dsh:status', event => trusted(event) ? status : null);
ipcMain.on('jlc-dsh:is-debug',event=>{event.returnValue=!!trusted(event)&&app.commandLine.hasSwitch('remote-debugging-port');});
// Only the trusted editor preload can invoke this channel. The editor broker
// accepts requests exclusively from its own iframe at the authenticated origin.
ipcMain.handle('jlc-dsh:frame-request',async(event,value)=>{
  const win=trusted(event),entry=win&&views.get(win.id);
  if(closing||!entry||entry.disposed||!authenticatedURL)throw Error('Invalid sidebar request');
  switch(value?.action){
    case 'ready':entry.frameReady=true;snapshot();return {debug:app.commandLine.hasSwitch('remote-debugging-port')};
    case 'current':return contextHost.capture(entry);
    case 'health':return contextHost.health();
    case 'select':return contextHost.select(entry,value.conversationId);
    default:throw Error('Unsupported sidebar action');
  }
});
let shutdownPromise;
function shutdown() {
  if(shutdownPromise)return shutdownPromise;
  closing = true;
  const contextClosed=contextHost.close();
  const childClosed=child&&child.exitCode===null?waitEvent(child,'close'):Promise.resolve();
  stopChild();
  for (const entry of [...views.values()]) dispose(entry);
  publish({ phase: 'stopped', message: '已退出' });
  shutdownPromise=Promise.all([contextClosed,childClosed,nativeRequests.drain()]);
  return shutdownPromise;
}
app.on('before-quit', shutdown);
// This client drains its CLI transport then calls app.exit(), bypassing before-quit.
// Drain the context transport while Electron's objects are still live.
const originalExit=app.exit.bind(app);
let exitScheduled=false;
app.exit=function(code){if(exitScheduled)return;exitScheduled=true;shutdown().then(()=>originalExit(code));};
// app.exit() bypasses Electron quit events. The launcher Job Object owns that path;
// spawning taskkill from Node's exit event can run after Electron teardown begins.
log(`host hooks loaded pid=${process.pid}`);
