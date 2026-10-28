'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const {McpTransport}=require('../host/mcp-transport.cjs'),{targets,connect}=require('./cdp.cjs'),{verifySource}=require('./setup-client.cjs');
const root=path.resolve(__dirname,'..'),lab=path.join(root,'lab'),delay=ms=>new Promise(r=>setTimeout(r,ms));
const report={date:new Date().toISOString(),root,steps:[],modelRequests:0,computerUseUsed:false};let launcher,mcp,owner,opened;const clients=[];
const activationIndex=process.argv.indexOf('--activation-file'),activationFile=activationIndex<0?null:path.resolve(process.argv[activationIndex+1]);
const read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,''));
async function waitFor(fn){const end=Date.now()+60000;while(Date.now()<end){const value=await fn();if(value)return value;await delay(200);}throw Error('Portable runtime timeout: '+report.stage);}
function step(name,data={}){report.steps.push({name,...data});console.log(name);}
async function evaluate(c,expression){const r=await c.call('Runtime.evaluate',{expression:`Promise.resolve(${expression})`,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function launch(debug){
  report.stage=debug?'debug launch':'normal launch';const started=Date.now(),processHandle=spawn(path.join(root,'JLCEDA-DSH.exe'),debug?['--debug']:[],{cwd:root,windowsHide:true,stdio:'ignore'});launcher=processHandle;processHandle.observedExit=undefined;processHandle.on('exit',code=>{processHandle.observedExit=code;});
  const state=await waitFor(async()=>{for(const f of fs.readdirSync(lab).filter(n=>/^host-state-\d+\.json$/.test(n))){const file=path.join(lab,f);if(fs.statSync(file).mtimeMs<started)continue;try{const s=read(file);if(s.status.phase==='ready'&&s.mcp.bridgeHealthy&&s.windows.some(w=>w.frameReady))return s;}catch{}}
    if(debug){try{const registration=(await targets()).find(t=>t.type==='page'&&new URL(t.url).searchParams.get('entry')==='regist');if(registration)return {activationRequired:true,target:registration};}catch{}}
    if(processHandle.observedExit!==undefined)throw Error('Client exited before its sidebar became ready');return false;});
  if(state.activationRequired)return state;
  owner=state.pid;assert.equal(state.execPath,path.join(lab,'client/lceda-pro.exe'));assert.equal(state.userData,path.join(lab,'profile'));assert.equal(state.embedding,'sandboxed-iframe');
  mcp=new McpTransport(state.execPath,state.userData,lab);const doctor=await mcp.command('doctor');assert.equal(doctor.connected,true);assert.equal(doctor.endpoint,state.endpoint);assert.equal(doctor.versionMatch,true);return state;
}
async function stop(){if(mcp){try{await mcp.command('stop');}finally{await mcp.close();mcp=null;}}if(launcher){const l=launcher;await waitFor(()=>l.observedExit!==undefined);assert.equal(l.observedExit,0);launcher=null;}}
async function guest(windowId,origin){return waitFor(async()=>{for(const t of(await targets()).filter(t=>t.type==='iframe'&&t.url.startsWith(origin))){const c=await connect(t);clients.push(c);if(await evaluate(c,'!!window.__JLC_DSH_CONTEXT_TEST__')&&(await evaluate(c,'window.jlcEDAContext.current()')).windowId===windowId)return c;}return false;});}
(async()=>{try{
  const installation=read(path.join(lab,'setup/install.json'));assert.equal(installation.credentialsImported,false);assert.ok(!fs.existsSync(path.join(root,'vendor')));step('installation-has-no-vendor-or-imported-credentials');
  const existing=await fetch('http://127.0.0.1:9431/json/list',{signal:AbortSignal.timeout(1000)}).then(()=>true,()=>false);assert.equal(existing,false,'Another debug client owns CDP 9431');
  let state=await launch(true);
  if(state.activationRequired){
    step('fresh-client-requests-native-activation-without-importing-credentials');
    const registration=await connect(state.target);clients.push(registration);
    if(!activationFile){report.activationRequired=true;report.installationVerified=true;launcher.kill();await waitFor(()=>launcher.observedExit!==undefined);launcher=null;report.cleanup='owned launcher Job terminated before client activation';throw Object.assign(Error('CLIENT_ACTIVATION_REQUIRED: activate this isolated client with your own local activation file, then rerun the runtime regression; no activation data was imported.'),{code:'CLIENT_ACTIVATION_REQUIRED'});}
    if(report.activationImported)throw Error('Native activation did not complete');
    const {root:documentRoot}=await registration.call('DOM.getDocument'),{nodeId}=await registration.call('DOM.querySelector',{nodeId:documentRoot.nodeId,selector:'input[type=file]'});assert.ok(nodeId);
    await registration.call('DOM.setFileInputFiles',{nodeId,files:[activationFile]});
    await waitFor(()=>evaluate(registration,'!!document.querySelector("textarea")?.value.trim()'));
    await evaluate(registration,'document.querySelector("[i18n=OK]").closest("a,button").click()');report.activationImported=true;
    await waitFor(()=>launcher.observedExit!==undefined);assert.equal(launcher.observedExit,0);launcher=null;
    state=await launch(true);assert.ok(!state.activationRequired,'Native activation still required');
  }
  step('new-directory-debug-owner-and-native-MCP-are-isolated',{owner,endpoint:state.endpoint});
  const editorTarget=(await targets()).find(t=>t.type==='page'&&t.url.startsWith('https://client/editor'));assert.ok(editorTarget);const editor=await connect(editorTarget);clients.push(editor);
  await waitFor(()=>evaluate(editor,'document.querySelector("[title=Agent]")?.textContent==="Agent"&&!!document.querySelector("#jlc-dsh-frame")'));
  assert.equal(await evaluate(editor,'document.querySelectorAll("#jlc-dsh-frame").length'),1);step('native-Agent-tab-and-single-DOM-iframe-render');
  const home=await guest(state.windows[0].id,state.dshOrigin);assert.ok(await evaluate(home,'!!document.querySelector("[data-jlc-settings]")'));assert.ok(await evaluate(home,'window.__JLC_DSH_CONTEXT_TEST__.ui().settings.includes("agent-presets")'));step('fresh-DSH-model-configuration-settings-and-presets-load');
  const directory=path.join(lab,'portable-fixture/中文 工程'),index=path.join(directory,'Portable.eprj3');fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(index,JSON.stringify({name:'Portable',format:'folder',owner_uuid:'local',creator_uuid:'local',modifier_uuid:'local',created_at:'2026-01-01 00:00:00',updated_at:'2026-01-01 00:00:00',content:'',archive:false,cbb_project:0,thumb:'',ticket:1,g_ticket:1,boards:[],profile:{boards:{},schematics:{},sheets:{},pcbs:{},panels:{},blockSymbols:{},owner:{uuid:'local'},simSchematics:{},simulations:{}},config:{settings:{}}}));
  const uuid=crypto.createHash('sha256').update(fs.realpathSync.native(directory)).digest('hex');
  let conversationId;
  for(const entry of [directory,index]){
    report.stage='open '+entry;opened=await mcp.command('open',{path:entry});const project=await mcp.command('invoke',{session:opened.sessionId,code:'return await eda.dmt_Project.getCurrentProjectInfo();'});assert.equal(project.uuid,uuid);
    const frame=await guest(opened.renderId,state.dshOrigin);
    if(conversationId){await waitFor(()=>evaluate(frame,`!!window.__JLC_DSH_CONTEXT_TEST__.ui().sessions[${JSON.stringify(conversationId)}]`));await evaluate(frame,`window.__JLC_DSH_CONTEXT_TEST__.open(${JSON.stringify(conversationId)})`);}
    const id=conversationId||await evaluate(frame,'window.__JLC_DSH_CONTEXT_TEST__.create()');conversationId=id;
    const bound=await waitFor(()=>evaluate(frame,`window.jlcEDAContext.select(${JSON.stringify(id)}).then(x=>x.state==='bound'&&x)`));assert.equal(bound.target.projectId,uuid);assert.equal(path.resolve(bound.target.workspaceDirectory).toLowerCase(),directory.toLowerCase());
    step(entry===directory?'native-MCP-opens-eprj3-and-binds-project-directory':'index-reopen-retains-project-identity-and-context',{projectId:uuid,windowId:opened.renderId});
    const closingSession=opened.sessionId,closingWindow=opened.renderId;
    await mcp.command('session.close',{session:closingSession,destroy:true});
    await waitFor(async()=>!(await mcp.command('session.list')).some(session=>session.sessionId===closingSession&&session.status==='alive')&&!read(path.join(lab,`host-state-${owner}.json`)).windows.some(window=>window.id===closingWindow));opened=null;
  }
  clients.forEach(c=>c.close());clients.length=0;await stop();step('debug-owner-exits-cleanly');
  const normal=await launch(false);assert.equal(await fetch('http://127.0.0.1:9431/json/list',{signal:AbortSignal.timeout(1000)}).then(()=>true,()=>false),false);
  const persisted=read(path.join(lab,'project-bindings.json')).bindings.find(binding=>binding.conversationId===conversationId);assert.ok(persisted);assert.equal(persisted.target.projectId,uuid);assert.equal(path.resolve(persisted.target.workspaceDirectory).toLowerCase(),directory.toLowerCase());step('normal-restart-retains-local-data-and-has-no-CDP',{owner:normal.pid,conversationId});
  await stop();step('normal-owner-and-DSH-stop-cleanly');
  step('provided-client-installation-unchanged',{files:verifySource(installation.source)});report.passed=true;
}catch(error){report.passed=false;report.error=error.stack;report.blockedBy=error.code||null;console.error(error);process.exitCode=1;}
finally{clients.forEach(c=>c.close());if(mcp)await stop().catch(error=>{report.cleanupError=error.message;});else if(launcher&&launcher.observedExit===undefined)launcher.kill();fs.mkdirSync(path.join(root,'evidence'),{recursive:true});fs.writeFileSync(path.join(root,'evidence/portable-runtime.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,steps:report.steps.length,activationRequired:report.activationRequired||false,error:report.error}));}})();
