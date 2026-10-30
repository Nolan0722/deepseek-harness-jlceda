'use strict';
// Exercises the installed client and actual DSH iframe through native MCP/CDP.
// Long conversation text and transport-loss events below are presentation fixtures;
// the real project binding and MCP handshake are independently checked first.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {McpTransport}=require('../host/mcp-transport.cjs'),{targets,connect}=require('./cdp.cjs');
const {setFrameViewport,clearFrameViewport,captureFrame}=require('./frame-test.cjs');
const {request}=require('../plugins/jlc-context/index.cjs');
const root=path.resolve(__dirname,'..'),lab=path.join(root,'lab'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const report={date:new Date().toISOString(),steps:[],modelRequests:0,computerUseUsed:false},connections=new Map();
let launcher,mcp,editor,frame,opened,secondaryOpened,wasDark,originalTitle;
function step(name,data={}){report.steps.push({name,...data});console.log(name);}
async function waitFor(fn){const end=Date.now()+60000;while(Date.now()<end){const value=await fn();if(value)return value;await delay(150);}throw Error('Topbar regression timed out: '+report.stage);}
async function evaluate(client,expression){const value=await client.call('Runtime.evaluate',{expression:`Promise.resolve(${expression})`,awaitPromise:true,returnByValue:true});if(value.exceptionDetails)throw Error(JSON.stringify(value.exceptionDetails));return value.result.value;}
async function clientFor(target){if(!connections.has(target.id))connections.set(target.id,await connect(target,event=>{
  if(event.method==='Runtime.consoleAPICalled'&&event.params.type==='error'){
    (report.browserErrors??=[]).push(event.params.args.map(a=>a.value??a.description??'').join(' ').replace(/([?&]token=)[^\s"<>]+/g,'$1[REDACTED]').slice(0,3000));
  }
}));return connections.get(target.id);}
async function dismissNativePreferenceNotice(){
  await evaluate(editor,'window.electronAPI.focusWindow()');
  await evaluate(editor,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const point=await evaluate(editor,'(()=>{const dialog=[...document.querySelectorAll("[class*=lc_modal_dialog_box]")].find(e=>e.checkVisibility()&&e.innerText.includes("编辑器新增了设置"));if(!dialog)return null;const button=dialog.querySelector("[data-test=Cancel]");if(!button)throw Error("Known preference notice has no Cancel button");const r=button.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()');if(!point)return false;
  await editor.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await editor.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await editor.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
  await waitFor(()=>evaluate(editor,'![...document.querySelectorAll("[class*=lc_modal_dialog_box]")].some(e=>e.checkVisibility()&&e.innerText.includes("编辑器新增了设置"))'));report.nativePreferenceNoticeDismissed=true;return true;
}
async function click(selector,text){
  await dismissNativePreferenceNotice();
  const point=await evaluate(frame,`(()=>{const element=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.checkVisibility()&&(${text===undefined?'true':`e.textContent.trim()===${JSON.stringify(text)}`}));if(!element)throw Error('Visible control missing');const r=element.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,top=document.elementFromPoint(x,y);if(top!==element&&!element.contains(top))throw Error('Control covered inside iframe');return {x,y,width:innerWidth,height:innerHeight};})()`);
  const parentHit=()=>evaluate(editor,`(()=>{const f=document.querySelector('#jlc-dsh-frame'),r=f.getBoundingClientRect();return document.elementFromPoint(r.x+${point.x}*r.width/${point.width},r.y+${point.y}*r.height/${point.height})===f;})()`);if(!await parentHit()){assert.ok(await dismissNativePreferenceNotice(),'Control covered by an unexpected native EDA overlay');assert.ok(await parentHit(),'Control remains covered by native EDA');}
  const position={x:point.x,y:point.y};await frame.call('Input.dispatchMouseEvent',{type:'mouseMoved',...position});await frame.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...position});await frame.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...position});
}
async function anchoredDetails(width){
  return waitFor(async()=>{const value=await evaluate(frame,'(()=>{const p=document.querySelector("#jlc-context-details"),a=document.querySelector("[data-jlc-context-details]");return p?{panel:p.getBoundingClientRect().toJSON(),anchor:a.getBoundingClientRect().toJSON(),height:innerHeight}:null;})()');
    if(!value)return false;const {panel,anchor}=value;if(Math.abs(panel.top-anchor.bottom-8)>1||panel.left<7||panel.right>width-7||panel.bottom>value.height-7)return false;if(width>=480&&Math.abs(panel.right-anchor.right)>1)return false;return value;
  });
}
async function verifyPointerMenus(width,dark){
  await click('[data-jlc-settings]');await waitFor(()=>evaluate(frame,'!!document.querySelector("[data-jlc-settings-panel]")'));
  const settings=await evaluate(frame,'document.querySelector("[data-jlc-settings-panel]").getBoundingClientRect().toJSON()');assert.ok(settings.left>=-1&&settings.right<=width+1);
  if(width===1536)await screenshot(`topbar-settings-wide-${dark?'dark':'light'}.png`);await click('[role=dialog] button','关闭');await waitFor(()=>evaluate(frame,'!document.querySelector("[data-jlc-settings-panel]")'));
  await click('[data-jlc-context-details]');const anchor=await anchoredDetails(width);await click('#jlc-context-details h3');assert.ok(await evaluate(frame,'!!document.querySelector("#jlc-context-details")'),'Clicks inside the portalled details keep it open');
  if(width===1536)await screenshot(`topbar-status-wide-${dark?'dark':'light'}.png`);await escape();await waitFor(()=>evaluate(frame,'!document.querySelector("#jlc-context-details")'));return {settings,anchor};
}
async function verifySettingsPages(){
  await click('[data-jlc-settings]');await waitFor(()=>evaluate(frame,'!!document.querySelector("[data-jlc-settings-panel]")'));
  const sections=await evaluate(frame,'[...document.querySelectorAll("[data-jlc-settings-section]")].map(e=>e.dataset.jlcSettingsSection)');
  assert.equal(sections[0],'models');assert.ok(!sections.includes('account'));
  for(const id of ['models','general','plugins','plugin-manager','schedules','agent-presets','jlceda-diagnostics'])assert.ok(sections.includes(id),id+' remains reachable');
  const icons=await evaluate(frame,'Object.fromEntries(["plugin-manager","schedules","agent-presets"].map(id=>[id,[...document.querySelector(`[data-jlc-settings-section="${id}"]`).querySelectorAll("svg path")].map(e=>e.getAttribute("d"))]))');
  const nativeIcons=require('./fixtures/native-settings-icons.json');
  assert.deepEqual(icons['plugin-manager'],nativeIcons.IconPluginPinwheelOutlineArtwork);assert.deepEqual(icons.schedules,nativeIcons.IconClockOutlineArtwork);assert.ok(icons['agent-presets'].length);
  await click('[data-jlc-settings-section="plugins"]');await waitFor(()=>evaluate(frame,'document.querySelector("[data-jlc-settings-panel]").textContent.includes("全局插件")'));
  assert.equal(await evaluate(frame,'!!document.querySelector("[data-jlc-plugin-manager-settings]")'),false);
  await click('[data-jlc-settings-section="plugin-manager"]');await waitFor(()=>evaluate(frame,'document.querySelectorAll("[data-jlc-plugin-manager-settings] [data-plugin-item]").length>=4'));
  await click('[data-plugin-item="agent-loop"] button');await waitFor(()=>evaluate(frame,'!!document.querySelector("#plugin-config-agent-loop-parallel")?.checkVisibility()'));
  await click('[data-jlc-settings-section="schedules"]');await waitFor(()=>evaluate(frame,'!!document.querySelector("[data-jlc-automation-settings]")?.checkVisibility()'));
  await click('[data-jlc-settings-section="agent-presets"]');await waitFor(()=>evaluate(frame,'!!document.querySelector("[data-agent-preset-id=ptc]")'));
  await screenshot('settings-presentation-native-presets.png');
  await escape();await waitFor(()=>evaluate(frame,'!document.querySelector("[data-jlc-settings-panel]")'));
  assert.equal(await evaluate(frame,'document.activeElement===document.querySelector("[data-jlc-settings]")'),true);
  step('project-settings-presentation-retains-native-pages-icons-navigation-and-modal-focus',{sections});
}
async function dismissModelOnboarding(){
  const shown=await evaluate(frame,'(()=>{const dialog=[...document.querySelectorAll("[role=dialog]")].find(element=>element.checkVisibility()&&/开始使用/.test(element.innerText));if(!dialog)return false;const close=[...dialog.querySelectorAll("button")].find(button=>/关闭|稍后|跳过/.test(button.getAttribute("aria-label")||button.innerText));if(!close)throw Error("Native model onboarding close button missing");close.dataset.jlcTestOnboardingClose="true";return true;})()');
  if(shown){await click('[data-jlc-test-onboarding-close]');await waitFor(()=>evaluate(frame,'!document.querySelector("[data-jlc-test-onboarding-close]")'));}
}
async function escape(){await editor.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await editor.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});}
async function screenshot(name){const shot=await captureFrame(editor);fs.writeFileSync(path.join(root,'evidence',name),Buffer.from(shot.data,'base64'));}
async function headerScreenshot(name){
  const rect=await evaluate(editor,'document.querySelector("#jlc-dsh-frame").getBoundingClientRect().toJSON()'),height=await evaluate(frame,'document.querySelector("header").getBoundingClientRect().height');
  const shot=await editor.call('Page.captureScreenshot',{format:'png',clip:{x:rect.x,y:rect.y,width:rect.width,height:height+4,scale:1}});fs.writeFileSync(path.join(root,'evidence',name),Buffer.from(shot.data,'base64'));
}
async function geometry(){await dismissNativePreferenceNotice();const layout=await evaluate(frame,`(()=>{
  const header=document.querySelector('header'),rect=e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height};};
  const names={title:'.jlc-session-title',connection:'[data-jlc-mcp]',settings:'[data-jlc-settings]',history:'[data-jlc-history]',preset:'.jlc-session-actions [data-slot] > *'};
  return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,header:rect(header),controls:Object.fromEntries(Object.entries(names).flatMap(([name,selector])=>{const e=header.querySelector(selector);if(!e?.checkVisibility())return [];const box=rect(e),top=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);return [[name,{...box,receivesPointer:e===top||e.contains(top)}]];})),title:header.querySelector('.jlc-session-title__current')?.textContent};
})()`);
  layout.parentHit=await evaluate(editor,`(()=>{const frame=document.querySelector('#jlc-dsh-frame'),f=frame.getBoundingClientRect(),controls=${JSON.stringify(layout.controls)};return Object.fromEntries(Object.entries(controls).map(([name,r])=>{const top=document.elementFromPoint(f.x+r.x+r.width/2,f.y+r.y+r.height/2);return [name,top===frame];}));})()`);
  return layout;
}
async function verifyComposer(){
  const state=await evaluate(frame,'(()=>{const card=document.querySelector("[data-composer-card]"),input=card?.querySelector("[contenteditable=true],textarea"),seat=document.querySelector("[data-composer-seat]"),body=document.querySelector("[data-conversation-content]");const rect=e=>e?.getBoundingClientRect().toJSON();return {width:innerWidth,height:innerHeight,phase:body?.dataset.contentPhase,card:rect(card),seat:rect(seat),input:rect(input),visible:card?.checkVisibility(),seatVisibility:seat&&getComputedStyle(seat).visibility,body:rect(body),scroll:body&&{height:body.clientHeight,scrollHeight:body.scrollHeight,top:body.scrollTop}};})()');
  report.composer=state;
  assert.ok(state.card&&state.visible,'Composer exists and is visible');assert.ok(state.card.top>=0&&state.card.bottom<=state.height+1,'Composer stays within the iframe viewport');
  assert.ok(state.input&&state.input.width>0&&state.input.height>0,'Composer has an editable input');
  await click('[data-composer-card] [contenteditable=true],[data-composer-card] textarea');
  await frame.call('Input.insertText',{text:'输入框自动化检查（不发送）'});
  assert.ok(await evaluate(frame,'(()=>{const e=document.querySelector("[data-composer-card] [contenteditable=true],[data-composer-card] textarea");return (e?.value||e?.textContent||"").includes("输入框自动化检查");})()'));
  await frame.call('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await frame.call('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
  await frame.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});await frame.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
}
function assertLayout(layout){
  assert.ok(layout.scrollWidth<=layout.width+1,'No horizontal scrolling');assert.ok(layout.header.height<=44,'Single-row header');
  for(const name of ['title','connection','settings','history','preset'])assert.ok(layout.controls[name]?.width>0,name+' visible');
  const controls=Object.entries(layout.controls);
  for(const [name,b] of controls){assert.ok(b.left>=-1&&b.right<=layout.width+1,name+' stays inside the sidebar');assert.equal(b.receivesPointer,true,name+' is not covered by an iframe overlay');assert.equal(layout.parentHit[name],true,name+' is not covered by a native EDA overlay');}
  for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){const [a,ra]=controls[i],[b,rb]=controls[j];assert.ok(Math.min(ra.right,rb.right)-Math.max(ra.left,rb.left)<=1||Math.min(ra.bottom,rb.bottom)-Math.max(ra.top,rb.top)<=1,a+' overlaps '+b);}
  for(const [,rect] of controls)assert.ok(Math.abs(rect.top+rect.height/2-(layout.controls.history.top+layout.controls.history.height/2))<2,'Every control stays on the same row');
}
(async()=>{try{
  fs.mkdirSync(path.join(root,'evidence'),{recursive:true});
  assert.equal(await fetch('http://127.0.0.1:9431/json/list',{signal:AbortSignal.timeout(800)}).then(()=>true,()=>false),false,'Debug port already occupied');
  const started=Date.now();launcher=spawn(path.join(root,'JLCEDA-DSH.exe'),['--debug'],{cwd:root,windowsHide:true,stdio:'ignore'});launcher.on('exit',code=>{launcher.observedExit=code;});
  report.stage='isolated native startup';
  const host=await waitFor(()=>{if(launcher.observedExit!==undefined)throw Error('Client exited during startup');for(const name of fs.readdirSync(lab).filter(name=>/^host-state-\d+\.json$/.test(name))){const file=path.join(lab,name);if(fs.statSync(file).mtimeMs<started)continue;try{const value=JSON.parse(fs.readFileSync(file));if(value.status.phase==='ready'&&value.mcp.bridgeHealthy&&value.windows.some(window=>window.frameReady))return value;}catch{}}return false;});
  assert.equal(host.execPath,path.join(lab,'client/lceda-pro.exe'));assert.equal(host.userData,path.join(lab,'profile'));
  mcp=new McpTransport(host.execPath,host.userData,lab);assert.equal((await mcp.command('doctor')).connected,true);
  const projectName='多通道精密电源与高速数据采集控制系统 · 工程名称较长的布局验证';
  const directory=path.join(lab,'topbar-fixture',String(Date.now())),index=path.join(directory,projectName+'.eprj3');fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(index,JSON.stringify({name:projectName,format:'folder',owner_uuid:'local',creator_uuid:'local',modifier_uuid:'local',created_at:'2026-01-01 00:00:00',updated_at:'2026-01-01 00:00:00',content:'',archive:false,cbb_project:0,thumb:'',ticket:1,g_ticket:1,boards:[],profile:{boards:{},schematics:{},sheets:{},pcbs:{},panels:{},blockSymbols:{},owner:{uuid:'local'},simSchematics:{},simulations:{}},config:{settings:{}}}));
  opened=await mcp.command('open',{path:directory});
  report.stage='bound iframe';
  await waitFor(async()=>{for(const target of await targets()){if(target.type==='page'&&target.url.startsWith('https://client/editor')){const client=await clientFor(target);if(await evaluate(client,'window.electronAPI?.getWinId()')===opened.renderId)editor=client;}if(target.type==='iframe'&&target.url.startsWith(host.dshOrigin)){const client=await clientFor(target);if(await evaluate(client,'!!window.__JLC_DSH_CONTEXT_TEST__')&&(await evaluate(client,'window.jlcEDAContext.current()')).windowId===opened.renderId)frame=client;}}return editor&&frame;});
  await evaluate(frame,'(()=>{window.__JLC_POINTER_EVENTS__=[];document.addEventListener("click",event=>{window.__JLC_POINTER_EVENTS__.push({trusted:event.isTrusted,label:event.target.closest("button")?.getAttribute("aria-label")||event.target.tagName});if(window.__JLC_POINTER_EVENTS__.length>40)window.__JLC_POINTER_EVENTS__.shift();},true);})()');
  const conversationId=await evaluate(frame,'window.__JLC_DSH_CONTEXT_TEST__.create({agentPreset:"standard"})');
  await waitFor(()=>evaluate(frame,'document.querySelector("[data-jlc-binding]")?.dataset.jlcBinding==="bound"&&document.querySelector("[data-jlc-mcp]")?.dataset.jlcMcp==="connected"&&!!document.querySelector(".jlc-session-title__current")&&!!document.querySelector(".jlc-session-actions [data-slot] > *")'));
  const target=await evaluate(frame,`window.jlcEDAContext.select(${JSON.stringify(conversationId)})`);assert.equal(target.target.projectName,projectName);assert.equal(path.resolve(target.target.workspaceDirectory),directory);
  const prompt=await request(host.contextPipe+'-dsh-test',{conversationId,action:'prompt'});
  assert.equal(prompt.contexts.length,1);assert.ok(prompt.prompt.includes('读取'));assert.ok(prompt.contexts[0].text.includes(target.target.projectId));
  assert.deepEqual(prompt.tools.map(tool=>tool.name).sort(),['jlceda_call','jlceda_context','jlceda_discover','jlceda_help']);
  step('named-plugin-loads-prompt-live-project-context-and-four-native-MCP-proxies');
  assert.equal((await request(host.contextPipe+'-dsh-test',{conversationId,action:'workspace'})).agentPreset,'standard');
  assert.equal(await evaluate(frame,`window.__JLC_DSH_CONTEXT_TEST__.ui().sessions[${JSON.stringify(conversationId)}].agentPreset`),'standard');
  await dismissModelOnboarding();
  const transcript=await request(host.contextPipe+'-dsh-test',{conversationId,action:'topbar-transcript-fixture',long:process.argv.includes('--composer-only')});assert.equal(transcript.modelRequests,0);
  await waitFor(()=>evaluate(frame,'document.querySelector(".wSkVaW_root")?.dataset.phase==="active"&&document.body.innerText.includes("这是本地构造的已完成会话")'));
  const overrides=await evaluate(frame,'window.__JLC_DSH_CONTEXT_TEST__.slotOverrides()');
  assert.equal(overrides.length,6);assert.ok(overrides.every(entry=>entry.originalRegistered&&entry.active&&entry.winners===1));
  step('native-slot-occupants-retained-and-project-overrides-win',{overrides});
  assert.equal(await evaluate(frame,'document.querySelectorAll(".nL4_yW_moreButton,[data-jlc-more]").length'),0);
  assert.equal(await evaluate(frame,'[...document.querySelectorAll("header button")].some(button=>button.getAttribute("aria-label")==="更多")'),false);
  assert.equal(await evaluate(frame,'document.querySelectorAll(".jlc-connection-dot").length'),1);
  step('real-eprj3-binding-and-MCP-retained-log-download-and-duplicate-marker-removed');
  if(process.argv.includes('--workspace-only')){
    report.stage='native workspace entry guards';
    const before=await evaluate(frame,'window.__JLC_DSH_CONTEXT_TEST__.ui()');
    assert.ok(before.commands.includes('workspace.add'));assert.ok(!before.views.includes('trajectory'));
    const add=await evaluate(frame,'window.__JLC_DSH_CONTEXT_TEST__.workspaceAdd()');
    assert.equal(add.directoryFlows,0);assert.equal(add.consumed,true);
    await click('[data-jlc-history]');await waitFor(()=>evaluate(frame,'document.querySelector("#jlc-project-history")?.checkVisibility()'));
    assert.equal(await evaluate(frame,'!!document.querySelector("button[aria-label=添加工作区]")'),false);
    const after=await evaluate(frame,'window.__JLC_DSH_CONTEXT_TEST__.ui()');assert.deepEqual(after.workspaces,before.workspaces);
    assert.ok(await evaluate(frame,'document.querySelectorAll(".YDXeBa_sessionRow").length>0'));await escape();
    step('native-directory-flow-hides-add-entry-and-blocks-shortcut-with-history-retained');
    const otherDirectory=path.join(lab,'topbar-fixture','other-'+Date.now());fs.mkdirSync(otherDirectory,{recursive:true});fs.copyFileSync(index,path.join(otherDirectory,'独立工程-B.eprj3'));
    secondaryOpened=await mcp.command('open',{path:otherDirectory});
    const otherFrame=await waitFor(async()=>{for(const t of await targets()){if(t.type!=='iframe'||!t.url.startsWith(host.dshOrigin))continue;const c=await clientFor(t);if(await evaluate(c,'!!window.__JLC_DSH_CONTEXT_TEST__')&&(await evaluate(c,'window.jlcEDAContext.current()')).windowId===secondaryOpened.renderId)return c;}return false;});
    const otherConversation=await evaluate(otherFrame,'window.__JLC_DSH_CONTEXT_TEST__.create({agentPreset:"standard"})');
    await mcp.command('session.close',{session:secondaryOpened.sessionId,destroy:true});secondaryOpened=null;
    await evaluate(frame,`window.__JLC_DSH_CONTEXT_TEST__.open(${JSON.stringify(otherConversation)})`);
    await waitFor(()=>evaluate(frame,'document.querySelector("[data-jlc-binding]")?.dataset.jlcBinding==="stale"'));
    const denied=await request(host.contextPipe+'-dsh-test',{conversationId:otherConversation,name:'jlceda_context',args:{}});assert.equal(denied.isError,true);assert.match(JSON.stringify(denied.content),/WINDOW_CLOSED/);
    await evaluate(frame,`(()=>{const api=window.__JLC_DSH_CONTEXT_TEST__,workspace=api.ui().workspaces.find(w=>w.sessionIds.includes(${JSON.stringify(otherConversation)}));if(!workspace)throw Error('Other workspace missing');api.newFromNavigation(workspace.id);})()`);
    const fresh=await waitFor(()=>evaluate(frame,`(()=>{const e=document.querySelector('[data-jlc-binding]');return e?.dataset.jlcBinding==='bound'&&e.dataset.jlcConversation!==${JSON.stringify(otherConversation)}&&e.dataset.jlcConversation!==${JSON.stringify(conversationId)}&&e.dataset.jlcConversation;})()`));
    const cwd=await request(host.contextPipe+'-dsh-test',{conversationId:fresh,action:'workspace'});assert.equal(path.resolve(cwd.root),directory);assert.equal(path.resolve(cwd.cwd),directory);
    assert.equal((await mcp.command('invoke',{session:opened.sessionId,code:'return await eda.dmt_Project.getCurrentProjectInfo();'})).uuid,target.target.projectId);
    await evaluate(frame,`window.__JLC_DSH_CONTEXT_TEST__.open(${JSON.stringify(conversationId)})`);await waitFor(()=>evaluate(frame,'document.querySelector("[data-jlc-binding]")?.dataset.jlcBinding==="bound"'));
    await dismissModelOnboarding();await verifyComposer();
    assert.ok(await evaluate(frame,`!!window.__JLC_DSH_CONTEXT_TEST__.ui().sessions[${JSON.stringify(otherConversation)}]`));
    step('other-project-history-cannot-call-EDA-and-new-session-stays-in-owning-project');
  }else if(process.argv.includes('--composer-only')){
    report.stage='composer at native size';await dismissNativePreferenceNotice();await verifyComposer();step('long-conversation-input-at-native-window-size',report.composer);
    if(process.argv.includes('--composer-reload')){
      await frame.call('Runtime.enable');
      // Exercise upstream HMR with identical bundle bytes, only in the disposable test installation.
      const bundle=path.join(root,'runtime/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js');
      fs.writeFileSync(bundle,fs.readFileSync(bundle));await delay(3000);
      report.stage='composer after module reload';await verifyComposer();assert.deepEqual(report.browserErrors??=[],[],'Native module reload must not crash a slot');step('input-survives-native-conversation-module-reload');
    }
    for(const width of [440,1536]){
      report.stage='composer at '+width;await setFrameViewport(editor,width,820);await waitFor(()=>evaluate(frame,`innerWidth===${width}`));
      await dismissNativePreferenceNotice();await verifyComposer();step('long-conversation-input-visible-and-editable-'+width,report.composer);
    }
    await evaluate(frame,'window.__JLC_DSH_CONTEXT_TEST__.create({agentPreset:"standard"})');await waitFor(()=>evaluate(frame,'document.querySelector("[data-jlc-binding]")?.dataset.jlcBinding==="bound"&&document.querySelector("[data-conversation-content]")?.dataset.contentPhase==="hero"'));
    await dismissModelOnboarding();await verifyComposer();step('new-conversation-input-visible-and-editable',report.composer);
  }else if(process.argv.includes('--slots-only')){
    for(const width of [440,1536]){
      report.stage='slot presentation at '+width;
      await setFrameViewport(editor,width,820);await waitFor(()=>evaluate(frame,`innerWidth===${width}`));
      assertLayout(await geometry());await verifyPointerMenus(width,false);
    }
    await verifySettingsPages();
    const ptc=await evaluate(frame,'window.__JLC_DSH_CONTEXT_TEST__.create({agentPreset:"ptc"})');
    await waitFor(()=>evaluate(frame,'document.querySelector(".jlc-session-actions")?.textContent.includes("PTC")&&document.querySelector("[data-jlc-binding]")?.dataset.jlcBinding==="bound"'));
    await dismissModelOnboarding();assertLayout(await geometry());
    await evaluate(frame,`window.__JLC_DSH_CONTEXT_TEST__.open(${JSON.stringify(conversationId)})`);
    await waitFor(()=>evaluate(frame,'document.querySelector(".jlc-session-actions")?.textContent.includes("标准")'));
    step('project-header-retains-native-mode-and-session-switching',{ptc});
    await evaluate(frame,'window.__JLC_DSH_CONTEXT_TEST__.openGuidePreview()');
    await waitFor(()=>evaluate(frame,'!!document.querySelector("[data-sidebar-right-mode]")'));
    assert.equal(await evaluate(frame,'document.querySelectorAll(".jlc-session-corner button").length'),0);
    await evaluate(frame,'window.__JLC_DSH_CONTEXT_TEST__.closeGuidePreview()');
    step('slot-migration-keeps-native-settings-status-and-guide-preview-without-header-expand');
  }else{
  wasDark=await evaluate(frame,'document.body.hasAttribute("data-ds-dark-theme")');
  originalTitle=await evaluate(frame,'document.querySelector(".jlc-session-title__current").textContent');
  await evaluate(frame,'document.querySelector(".jlc-session-title__current").textContent="高精度采样电路与多路电源时序设计讨论"');
  for(const dark of [false,true])for(const width of [320,360,720,1280,1536,1920]){
    report.stage=(dark?'dark':'light')+' layout '+width;await evaluate(editor,'window.electronAPI.focusWindow()');await setFrameViewport(editor,width,820);await evaluate(frame,`document.body.toggleAttribute('data-ds-dark-theme',${dark})`);
    await waitFor(()=>evaluate(frame,`innerWidth===${width}&&Math.abs(document.querySelector('header').getBoundingClientRect().width-${width})<1`));
    const layout=await geometry();report.lastLayout=layout;assertLayout(layout);const menus=await verifyPointerMenus(width,dark);await screenshot(`topbar-${dark?'dark':'light'}-${width}.png`);if(width===360||width===1536)await headerScreenshot(`topbar-preview-${dark?'dark':'light'}-${width}.png`);step(report.stage+'-completed-session-single-row-and-real-pointer-menus',{...layout,menus});
  }
  await evaluate(frame,`(()=>{document.querySelector('.jlc-session-title__current').textContent=${JSON.stringify(originalTitle)};document.body.toggleAttribute('data-ds-dark-theme',${wasDark});})()`);
  await setFrameViewport(editor,360,820);await waitFor(()=>evaluate(frame,'innerWidth===360'));await evaluate(frame,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  report.stage='details';await click('[data-jlc-context-details]');await waitFor(()=>evaluate(frame,'!!document.querySelector("#jlc-context-details")'));
  const details=await evaluate(frame,'(()=>{const d=document.querySelector("#jlc-context-details"),r=d.getBoundingClientRect();return {text:d.innerText,left:r.left,right:r.right,bottom:r.bottom,height:innerHeight,focused:document.activeElement?.getAttribute("aria-label")};})()');assert.ok(details.text.includes(directory));assert.ok(details.text.includes('MCP 已连接'));assert.ok(details.text.includes('当前会话已绑定此 EDA 窗口与工程'));assert.ok(details.text.includes('绑定工程'));assert.ok(details.left>=0&&details.right<=360&&details.bottom<=details.height);assert.equal(details.focused,'关闭详情');await screenshot('topbar-details-360.png');
  await escape();await waitFor(()=>evaluate(frame,'!document.querySelector("#jlc-context-details")'));assert.equal(await evaluate(frame,'document.activeElement===document.querySelector("[data-jlc-context-details]")'),true);
  step('details-show-complete-native-project-path-and-MCP-version-Escape-restores-focus');
  report.stage='history';await click('[data-jlc-history]');report.historyAfterClick=await evaluate(frame,'({open:document.documentElement.dataset.jlcHistory,expanded:document.querySelector("[data-jlc-history]")?.getAttribute("aria-expanded"),panel:!!document.querySelector("#jlc-project-history"),collapsed:document.querySelector(".pI_x6G_frame")?.hasAttribute("data-sidebar-collapsed"),events:window.__JLC_POINTER_EVENTS__.slice(-5)})');await waitFor(()=>evaluate(frame,'document.querySelector("#jlc-project-history")?.checkVisibility()'));
  assert.ok(await evaluate(frame,'document.querySelectorAll(".YDXeBa_sessionRow").length>0'));await screenshot('topbar-history-360.png');await escape();await waitFor(()=>evaluate(frame,'document.documentElement.dataset.jlcHistory!=="open"'));assert.equal(await evaluate(frame,'document.activeElement===document.querySelector("[data-jlc-history]")'),true);
  await click('[data-jlc-history]');await click('[data-jlc-context-details]');assert.equal(await evaluate(frame,'document.documentElement.dataset.jlcHistory==="open"'),false);await click('[data-jlc-settings]');
  await waitFor(()=>evaluate(frame,'!!document.querySelector("[data-jlc-settings-panel],[role=dialog]:not(#jlc-context-details)")'));assert.equal(await evaluate(frame,'!!document.querySelector("#jlc-context-details")'),false);
  await click('[role=dialog] button','关闭');
  step('project-session-history-retained-and-popovers-close-before-native-settings');
  report.stage='conversation view';assert.equal(await evaluate(frame,'!!document.querySelector("[data-conversation-tabs]")'),false);assert.equal(await evaluate(frame,'window.__JLC_DSH_CONTEXT_TEST__.ui().views.includes("trajectory")'),false);assert.ok(await evaluate(frame,'document.querySelector(".jlc-session-title__current")?.checkVisibility()&&document.querySelector(".jlc-session-actions [data-slot] > *")?.checkVisibility()'));step('native-conversation-title-and-mode-remain-visible-with-only-chat-view');
  report.stage='real project mismatch';
  const otherDirectory=path.join(lab,'topbar-fixture','other-'+Date.now());fs.mkdirSync(otherDirectory,{recursive:true});fs.copyFileSync(index,path.join(otherDirectory,'独立工程-B.eprj3'));
  secondaryOpened=await mcp.command('open',{path:otherDirectory});
  const otherFrame=await waitFor(async()=>{for(const target of await targets()){if(target.type!=='iframe'||!target.url.startsWith(host.dshOrigin))continue;const candidate=await clientFor(target);if(await evaluate(candidate,'!!window.__JLC_DSH_CONTEXT_TEST__')&&(await evaluate(candidate,'window.jlcEDAContext.current()')).windowId===secondaryOpened.renderId)return candidate;}return false;});
  const otherConversation=await evaluate(otherFrame,'window.__JLC_DSH_CONTEXT_TEST__.create({agentPreset:"standard"})');
  await evaluate(frame,`window.__JLC_DSH_CONTEXT_TEST__.open(${JSON.stringify(otherConversation)})`);
  await waitFor(()=>evaluate(frame,'document.querySelector("[data-jlc-binding]")?.dataset.jlcBinding==="stale"&&document.querySelector("[data-jlc-mcp]")?.dataset.jlcStatus==="attention"'));
  await evaluate(editor,'window.electronAPI.focusWindow()');await dismissModelOnboarding();await click('[data-jlc-context-details]');
  const mismatch=await evaluate(frame,'document.querySelector("#jlc-context-details").innerText');assert.match(mismatch,/不一致|其他工程/);assert.ok(mismatch.includes('独立工程-B'));assert.ok(mismatch.includes(projectName));assert.ok(await evaluate(frame,'!!document.querySelector("#jlc-context-details .jlc-eda-binding__button")'));
  assert.equal((await mcp.command('invoke',{session:opened.sessionId,code:'return await eda.dmt_Project.getCurrentProjectInfo();'})).uuid,target.target.projectId);
  await screenshot('topbar-binding-mismatch-360.png');await escape();await evaluate(frame,`window.__JLC_DSH_CONTEXT_TEST__.open(${JSON.stringify(conversationId)})`);
  await waitFor(()=>evaluate(frame,'document.querySelector("[data-jlc-binding]")?.dataset.jlcBinding==="bound"&&document.querySelector("[data-jlc-mcp]")?.dataset.jlcStatus==="connected"'));
  await mcp.command('session.close',{session:secondaryOpened.sessionId,destroy:true});secondaryOpened=null;
  step('actual-other-project-conversation-shows-mismatch-and-recovery-without-switching-the-EDA-project');
  report.stage='PTC mode label';await evaluate(frame,'window.__JLC_DSH_CONTEXT_TEST__.create({agentPreset:"ptc"})');
  await waitFor(()=>evaluate(frame,'document.querySelector(".jlc-session-actions [data-slot] > *")?.textContent.includes("PTC")&&document.querySelector("[data-jlc-binding]")?.dataset.jlcBinding==="bound"'));
  await dismissModelOnboarding();assertLayout(await geometry());await headerScreenshot('topbar-preview-ptc.png');await evaluate(frame,`window.__JLC_DSH_CONTEXT_TEST__.open(${JSON.stringify(conversationId)})`);
  await waitFor(()=>evaluate(frame,'document.querySelector(".jlc-session-actions [data-slot] > *")?.textContent.includes("标准")'));step('native-standard-and-PTC-mode-labels-fit-the-single-row-without-running-a-model');
  await dismissModelOnboarding();
  report.stage='wide high-DPI';await setFrameViewport(editor,1536,1000,1.5);await waitFor(()=>evaluate(frame,'innerWidth===1536'));assertLayout(await geometry());await verifyPointerMenus(1536,false);step('1536-wide-150-percent-DPI-settings-and-anchored-status-receive-real-pointer-clicks');
  await click('[data-jlc-context-details]');await anchoredDetails(1536);await setFrameViewport(editor,720,820);await waitFor(()=>evaluate(frame,'innerWidth===720'));await anchoredDetails(720);await escape();await setFrameViewport(editor,360,820);step('open-status-menu-repositions-below-its-button-on-sidebar-resize');
  // Feed the real iframe receiver from its trusted editor parent. No native
  // transport is killed; this isolates visual states from reconnect timing.
  for(const phase of ['reconnecting','disconnected']){
    await evaluate(editor,`(()=>{const f=document.querySelector('#jlc-dsh-frame');f.contentWindow.postMessage({channel:'jlc-dsh-frame-v1',type:'health',value:{phase:${JSON.stringify(phase)},bridgeHealthy:false,error:{message:'UI regression fixture'}}},new URL(f.src).origin)})()`);
    await waitFor(()=>evaluate(frame,`document.querySelector('[data-jlc-mcp]')?.dataset.jlcMcp===${JSON.stringify(phase)}`));
    assert.equal(await evaluate(frame,'document.querySelector("[data-jlc-mcp]").dataset.jlcStatus'),phase==='reconnecting'?'connecting':'disconnected');
    const layout=await geometry();assertLayout(layout);await screenshot('topbar-'+phase+'-360.png');assert.match(await evaluate(frame,'document.querySelector("[data-jlc-mcp]").getAttribute("aria-label")'),phase==='reconnecting'?/正在连接/:/已暂停/);
  }
  await waitFor(()=>evaluate(frame,'document.querySelector("[data-jlc-mcp]")?.dataset.jlcMcp==="connected"'));step('connecting-and-disconnected-presentation-follow-health-events-and-real-health-recovers');
  }
  await clearFrameViewport(editor);await mcp.command('session.close',{session:opened.sessionId,destroy:true});opened=null;await mcp.command('stop');await mcp.close();mcp=null;
  await waitFor(()=>launcher.observedExit!==undefined);assert.equal(launcher.observedExit,0);step('owned-client-and-DSH-exit-cleanly');report.passed=true;
}catch(error){report.passed=false;report.error=error.stack;process.exitCode=1;console.error(error);if(frame)report.eventDebug=await evaluate(frame,'({width:innerWidth,focused:document.activeElement?.outerHTML.slice(0,240),hasFocus:document.hasFocus(),events:window.__JLC_POINTER_EVENTS__})').catch(()=>null);if(frame)report.ui=await evaluate(frame,'document.querySelector("header")?.innerText').catch(()=>null);if(editor){await screenshot('topbar-failure.png').catch(()=>{});const shot=await editor.call('Page.captureScreenshot',{format:'png'}).catch(()=>null);if(shot)fs.writeFileSync(path.join(root,'evidence/topbar-parent-failure.png'),Buffer.from(shot.data,'base64'));report.nativeDialogs=await evaluate(editor,'[...document.querySelectorAll("[class*=lc_modal_dialog_box]")].filter(e=>e.checkVisibility()).map(e=>({text:e.innerText.slice(0,500),buttons:[...e.querySelectorAll("[data-test]")].map(b=>b.getAttribute("data-test"))}))').catch(()=>null);}}
finally{
  if(frame&&wasDark!==undefined)await evaluate(frame,`document.body.toggleAttribute('data-ds-dark-theme',${wasDark})`).catch(()=>{});
  if(editor)await clearFrameViewport(editor).catch(()=>{});
  if(opened&&mcp)await mcp.command('session.close',{session:opened.sessionId,destroy:true}).catch(()=>{});
  if(secondaryOpened&&mcp)await mcp.command('session.close',{session:secondaryOpened.sessionId,destroy:true}).catch(()=>{});
  if(mcp){await mcp.command('stop').catch(()=>{});await mcp.close();}
  for(const client of connections.values())client.close();
  if(launcher&&launcher.observedExit===undefined){await Promise.race([new Promise(resolve=>launcher.once('exit',resolve)),delay(5000)]);if(launcher.observedExit===undefined)launcher.kill();}
  fs.writeFileSync(path.join(root,'evidence/topbar-regression.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,steps:report.steps.length,error:report.error}));
}})();
