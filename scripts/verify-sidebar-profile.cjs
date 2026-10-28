'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {targets,connect}=require('./cdp.cjs');
const {McpTransport}=require('../host/mcp-transport.cjs');
const {request}=require('../plugins/jlc-context/index.cjs');
const {setFrameViewport,clearFrameViewport,captureFrame}=require('./frame-test.cjs');
const root=path.resolve(__dirname,'..'),owner=Number(process.argv[2]),delay=ms=>new Promise(r=>setTimeout(r,ms));
const report={date:new Date().toISOString(),owner,steps:[],modelRequests:0,computerUseUsed:false,primaryFormat:'EPRJ3'};
const mcp=new McpTransport(path.join(root,'lab/client/lceda-pro.exe'),path.join(root,'lab/profile'),path.join(root,'lab'));
const clients=[];let frame,editor;
async function evaluate(c,expression){const r=await c.call('Runtime.evaluate',{expression:`window.__JLC_PROFILE_TEST_PROMISE__=Promise.resolve(${expression})`,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function waitFor(fn){const end=Date.now()+40000;while(Date.now()<end){const r=await fn();if(r)return r;await delay(150);}throw Error('Sidebar profile timed out: '+report.stage);}
function step(name,value={}){report.steps.push({name,...value});console.log(name);}
const canonical=p=>(p||'').replaceAll('\\','/').toLowerCase();
async function state(){return evaluate(frame,'(()=>{const e=document.querySelector("[data-jlc-binding]");return {conversationId:e?.dataset.jlcConversation,projectId:e?.dataset.jlcProject,binding:e?.dataset.jlcBinding,current:window.__JLC_DSH_CONTEXT_TEST__.project().current,syncing:window.__JLC_DSH_CONTEXT_TEST__.project().syncing};})()');}
async function clickFrame(selector){await evaluate(frame,`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e?.checkVisibility())throw Error('Visible action missing');e.click();})()`);}
(async()=>{try{
  report.stage='host ready';
  const host=await waitFor(()=>{const state=JSON.parse(fs.readFileSync(path.join(root,'lab',`host-state-${owner}.json`)));return state.status.phase==='ready'&&state.dshOrigin&&state;});
  for(const t of(await targets()).filter(t=>t.type==='page'&&t.url.startsWith('https://client/editor'))){const c=await connect(t);clients.push(c);if(await evaluate(c,'window.electronAPI.getWinId()')===2){editor=c;break;}}assert.ok(editor);
  await evaluate(editor,'window.electronAPI.focusWindow()');
  frame=await waitFor(async()=>{for(const t of(await targets()).filter(t=>t.type==='iframe'&&t.url.startsWith(host.dshOrigin))){const c=await connect(t);clients.push(c);if(await evaluate(c,'!!window.__JLC_DSH_CONTEXT_TEST__')&&(await evaluate(c,'window.jlcEDAContext.current()')).windowId===2)return c;}return false;});
  // Reload once so the latest local client contribution is tested too.
  await evaluate(frame,'location.reload()');
  await waitFor(()=>evaluate(frame,'!!window.__JLC_DSH_CONTEXT_TEST__'));
  const initial=await waitFor(async()=>{const ui=await evaluate(frame,'window.__JLC_DSH_CONTEXT_TEST__.ui()');return ui.workspaces.length>0&&Object.keys(ui.sessions).length>0&&ui;});
  assert.deepEqual(initial.panels,[]);assert.deepEqual([...initial.settings].sort(),['agent-presets','general','jlceda-diagnostics','models','plugin-manager','plugins','schedules']);assert.deepEqual(initial.onboarding,['deepseek-official']);
  assert.ok(!initial.commands.includes('workspace.add'));assert.ok(!initial.commands.some(c=>/plugin|schedule|terminal|browser/.test(c)));assert.ok(initial.commands.includes('session.new'));
  step('unrelated-panels-settings-and-commands-not-registered',{panels:initial.panels,settings:initial.settings,commands:initial.commands,onboarding:initial.onboarding});
  assert.ok(initial.workspaces.length>0);assert.ok(initial.workspaces.some(w=>w.sessionIds.length>0));
  const historicIds=Object.keys(initial.sessions);step('existing-engineering-workspaces-and-session-history-retained',{workspaceCount:initial.workspaces.length,sessionCount:historicIds.length});
  const a=path.join(root,'lab/eprj3-fixture/中文工程 带空格'),b=path.join(root,'lab/phase3-fixture/project-B');
  if(!fs.existsSync(b)){fs.mkdirSync(path.dirname(b),{recursive:true});fs.cpSync(a,b,{recursive:true,errorOnExist:true,force:false});}
  async function openProject(directory){
    report.stage='open '+directory;
    const opened=await evaluate(editor,`window.__JLC_DSH_DEBUG__.openLocalProject(${JSON.stringify(directory)})`);assert.equal(opened.success,true);
    return waitFor(async()=>{const s=await state();return !s.syncing&&s.binding==='bound'&&canonical(s.current?.projectDirectory)===canonical(directory)&&s;});
  }
  const first=await openProject(a);assert.equal(canonical(first.current.workspaceDirectory),canonical(a));
  step('eprj3-opens-with-bound-project-directory',{projectId:first.projectId,conversationId:first.conversationId});
  assert.equal(await evaluate(frame,'document.querySelector("[data-jlc-project-workspace]")?.tagName'),'SPAN');
  assert.equal(await evaluate(frame,'!!document.querySelector("button[aria-label=选择工作区]")'),false);
  assert.equal(await evaluate(frame,'!!document.querySelector("button[aria-label=添加工作区]")'),false);
  step('bound-workspace-chip-read-only-and-add-workspace-removed');
  report.stage='new session';
  await clickFrame('button[aria-label=新建会话]');
  const fresh=await waitFor(async()=>{const s=await state();return s.binding==='bound'&&s.conversationId!==first.conversationId&&s;});
  const runtime=await request(host.contextPipe+'-dsh-test',{conversationId:fresh.conversationId,action:'workspace'});assert.equal(canonical(runtime.root),canonical(a));assert.equal(canonical(runtime.cwd),canonical(a));
  step('official-new-session-navigation-creates-in-owning-window-project',{conversationId:fresh.conversationId,...runtime});
  const second=await openProject(b);assert.notEqual(second.projectId,fresh.projectId);assert.notEqual(second.conversationId,fresh.conversationId);
  const returned=await openProject(a);assert.equal(returned.conversationId,fresh.conversationId);
  step('eprj3-switch-and-return-preserve-project-session-history-and-cwd');
  await evaluate(frame,`window.__JLC_DSH_CONTEXT_TEST__.open(${JSON.stringify(second.conversationId)})`);
  await waitFor(async()=>(await state()).binding==='stale');
  const denied=await request(host.contextPipe+'-dsh-test',{conversationId:second.conversationId,name:'jlceda_context',args:{}});assert.equal(denied.isError,true);assert.match(JSON.stringify(denied.content),/PROJECT_CHANGED/);
  await evaluate(frame,'window.__JLC_DSH_CONTEXT_TEST__.newFromNavigation()');
  const afterHistory=await waitFor(async()=>{const s=await state();return s.binding==='bound'&&s.projectId===first.projectId&&s.conversationId!==fresh.conversationId&&s;});
  step('new-session-after-browsing-other-project-history-stays-in-current-project',{conversationId:afterHistory.conversationId});
  const after=await evaluate(frame,'window.__JLC_DSH_CONTEXT_TEST__.ui()');assert.ok(historicIds.every(id=>after.sessions[id]));assert.ok(after.sessions[fresh.conversationId]);assert.ok(after.sessions[second.conversationId]);
  assert.equal(await evaluate(frame,'document.body.innerText.includes("预览版")||document.body.innerText.includes("1017")'),false);
  assert.equal(await evaluate(frame,'document.querySelector("[data-jlc-mcp]")?.dataset.jlcMcp'),'connected');
  step('history-preserved-and-real-MCP-status-visible-without-preview-badges');
  for(const width of [360,440,720]){
    report.stage='viewport '+width;await setFrameViewport(editor,width,820);
    await waitFor(()=>evaluate(frame,`innerWidth===${width}&&document.documentElement.scrollWidth<=${width+1}`));
    const geometry=await evaluate(frame,'(()=>{const c=document.querySelector("[data-jlc-binding]"),i=document.querySelector("[data-composer-card]"),s=document.querySelector("[data-jlc-settings]");return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,card:c.getBoundingClientRect().toJSON(),input:i.getBoundingClientRect().toJSON(),settings:s.getBoundingClientRect().toJSON()};})()');
    assert.ok(geometry.scrollWidth<=width+1);assert.ok(geometry.card.left>=0&&geometry.card.right<=width+1);assert.ok(geometry.card.bottom<=geometry.input.top);assert.ok(geometry.settings.width>0);
    await clickFrame('[data-jlc-settings]');
    await waitFor(()=>evaluate(frame,'!!document.querySelector("[role=dialog]")'));
    await evaluate(frame,'[...document.querySelector("[role=dialog]").querySelectorAll("button")].find(e=>e.textContent.trim()==="模型").click()');
    await waitFor(()=>evaluate(frame,'[...document.querySelectorAll("button[aria-current=true]")].some(e=>e.textContent.trim()==="模型")'));
    const settings=await evaluate(frame,'(()=>{const d=document.querySelector("[role=dialog]");return {width:innerWidth,rect:d.getBoundingClientRect().toJSON(),models:!![...d.querySelectorAll("button")].find(e=>e.textContent.trim()==="模型"),selected:[...d.querySelectorAll("button[aria-current=true]")].map(e=>e.textContent.trim()),hasCredentialInputs:!!d.querySelector("input"),hasDiagnostics:d.textContent.includes("连接与诊断")};})()');
    assert.ok(settings.models);assert.ok(settings.selected.includes('模型'));assert.ok(settings.hasDiagnostics);assert.ok(settings.rect.left>=-1&&settings.rect.right<=width+1);
    if(width===440){const image=await captureFrame(editor);fs.writeFileSync(path.join(root,'evidence/sidebar-profile-models-440.png'),Buffer.from(image.data,'base64'));}
    if(width===720){
      report.stage='plugin settings';
      await evaluate(frame,'[...document.querySelector("[role=dialog]").querySelectorAll("button")].find(e=>e.textContent.trim()==="内置插件").click()');
      await waitFor(()=>evaluate(frame,'document.querySelector("[role=dialog]")?.textContent.includes("全局插件")'));
      assert.equal(await evaluate(frame,'!!document.querySelector("[data-jlc-plugin-configuration],#plugin-config-agent-loop-parallel,[data-jlc-plugin-manager-settings]")'),false);
      const builtin=await captureFrame(editor);fs.writeFileSync(path.join(root,'evidence/sidebar-builtin-original-720.png'),Buffer.from(builtin.data,'base64'));
      await evaluate(frame,'[...document.querySelector("[role=dialog]").querySelectorAll("button")].find(e=>e.textContent.trim()==="插件").click()');
      await waitFor(()=>evaluate(frame,'!!document.querySelector("[data-jlc-plugin-manager-settings]")'));
      const cards=await waitFor(()=>evaluate(frame,'(()=>{const ids=[...document.querySelectorAll("[data-plugin-item]")].map(e=>e.dataset.pluginItem);return ids.length>=4?ids:null;})()'));
      assert.ok(cards.includes('shell'));assert.ok(cards.includes('agent-loop'));assert.ok(cards.includes('subagent'));assert.ok(cards.includes('web-search'));
      const manager=await captureFrame(editor);fs.writeFileSync(path.join(root,'evidence/sidebar-plugin-manager-720.png'),Buffer.from(manager.data,'base64'));
      await evaluate(frame,'document.querySelector("[data-plugin-item=agent-loop] button").click()');
      await waitFor(()=>evaluate(frame,'!!document.querySelector("#plugin-config-agent-loop-parallel")?.checkVisibility()'));
      const plugins=await captureFrame(editor);fs.writeFileSync(path.join(root,'evidence/sidebar-plugin-settings-720.png'),Buffer.from(plugins.data,'base64'));
      step('original-builtin-inventory-and-native-plugin-manager-are-separate-settings-pages',{cards});
    }
    await evaluate(frame,'[...document.querySelectorAll("button")].find(e=>e.textContent.trim()==="连接与诊断").click()');
    await waitFor(()=>evaluate(frame,'document.querySelector("[data-jlc-diagnostics]")?.textContent.includes("Bridge ✓")'));
    await evaluate(frame,'[...document.querySelector("[role=dialog]").querySelectorAll("button")].find(e=>e.textContent.trim()==="关闭").click()');
    await waitFor(()=>evaluate(frame,'!document.querySelector("[role=dialog]")'));
    const image=await captureFrame(editor);fs.writeFileSync(path.join(root,'evidence',`sidebar-profile-${width}.png`),Buffer.from(image.data,'base64'));
    step(`compact-sidebar-model-settings-and-live-diagnostics-${width}`,{geometry,settings});
  }
  await clearFrameViewport(editor);
  await setFrameViewport(editor,720,820);await waitFor(()=>evaluate(frame,'innerWidth===720'));await delay(350);
  assert.equal(await evaluate(frame,'document.querySelector("button[aria-label=打开侧边栏]")?.checkVisibility()??false'),false);
  await waitFor(()=>evaluate(frame,'!document.querySelector(".pI_x6G_frame")?.hasAttribute("data-sidebar-collapsed")'));
  await clickFrame('[data-jlc-more]');
  const history=await waitFor(()=>evaluate(frame,'(()=>{const menu=document.querySelector(".pI_x6G_sidebarCol");const box=menu?.getBoundingClientRect();const rows=[...document.querySelectorAll(".YDXeBa_sessionRow,.YDXeBa_projectRow")];const open=document.documentElement.dataset.jlcMore==="open"&&box&&box.height>40&&getComputedStyle(menu).display!=="none";return open?{expanded:true,cards:rows.length,sessionVisible:rows.some(row=>row.classList.contains("YDXeBa_sessionRow")),workspaceVisible:rows.some(row=>row.classList.contains("YDXeBa_projectRow"))||document.body.innerText.includes("工作区"),settingsVisible:document.querySelector("[data-jlc-settings]")?.checkVisibility(),addVisible:!!document.querySelector("button[aria-label=添加工作区]"),dock:!!document.querySelector(".jlc-eda-binding")?.closest("[data-composer-card],._7yHdaG_dock")}:null;})()'));
  assert.ok(history.expanded);assert.ok(history.workspaceVisible&&history.sessionVisible&&history.settingsVisible);assert.equal(history.addVisible,false);assert.equal(history.dock,false);
  const historyImage=await captureFrame(editor);fs.writeFileSync(path.join(root,'evidence/sidebar-profile-history-720.png'),Buffer.from(historyImage.data,'base64'));
  await clickFrame('[data-jlc-more]');await waitFor(()=>evaluate(frame,'document.documentElement.dataset.jlcMore!=="open"'));await clearFrameViewport(editor);
  step('engineering-workspace-history-expands-and-collapses-without-leaving-conversation',history);
  step('model-configuration-remains-reachable-at-all-tested-widths');
  report.passed=true;
}catch(error){report.passed=false;report.error=error.stack;process.exitCode=1;console.error(error);}finally{
  if(editor)await clearFrameViewport(editor).catch(()=>{});clients.forEach(c=>c.close());await mcp.close();fs.writeFileSync(path.join(root,'evidence/sidebar-profile-regression.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,steps:report.steps.length,error:report.error}));
}})();
