'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {targets,connect}=require('./cdp.cjs'),{request}=require('../plugins/jlc-context/index.cjs');
const {setFrameViewport,clearFrameViewport,captureFrame}=require('./frame-test.cjs');
const root=path.resolve(__dirname,'..'),owner=Number(process.argv[2]),delay=ms=>new Promise(r=>setTimeout(r,ms));
const report={date:new Date().toISOString(),owner,steps:[],modelRequests:0,computerUseUsed:false};
const clients=[];let frame,editor,fixture,conversationId,pipe;
async function evaluate(c,expression){const r=await c.call('Runtime.evaluate',{expression:`window.__JLC_AUTOMATION_PROMISE__=Promise.resolve(${expression})`,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function waitFor(fn){const until=Date.now()+35000;while(Date.now()<until){const r=await fn();if(r)return r;await delay(150);}throw Error('Automation settings timed out: '+report.stage);}
function step(name,details={}){report.steps.push({name,...details});console.log(name);}
const probe=(action,extra={})=>request(pipe,{conversationId,action,...extra});
async function clickText(text){await evaluate(frame,`(()=>{const e=[...document.querySelectorAll('button,[role=menuitem]')].find(e=>e.checkVisibility()&&e.textContent.trim()===${JSON.stringify(text)});if(!e)throw Error('Action missing: '+${JSON.stringify(text)});e.click();})()`);}
async function fill(label,value){await evaluate(frame,`(()=>{const e=document.querySelector('[aria-label='+CSS.escape(${JSON.stringify(label)})+']');if(!e)throw Error('Field missing');Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);}
async function openSettings(){await evaluate(frame,'document.querySelector("[data-jlc-settings]").click()');await waitFor(()=>evaluate(frame,'!!document.querySelector("[role=dialog]")'));await clickText('自动化任务');await waitFor(()=>evaluate(frame,'!!document.querySelector("[data-jlc-automation-settings] [data-testid=task-manager-page]")'));}
(async()=>{try{
  const host=JSON.parse(fs.readFileSync(path.join(root,'lab',`host-state-${owner}.json`)));pipe=host.contextPipe+'-dsh-test';
  for(const t of(await targets()).filter(t=>t.type==='page'&&t.url.startsWith('https://client/editor'))){const c=await connect(t);clients.push(c);if(await evaluate(c,'window.electronAPI.getWinId()')===2){editor=c;break;}}assert.ok(editor);
  frame=await waitFor(async()=>{for(const t of(await targets()).filter(t=>t.type==='iframe'&&t.url.startsWith(host.dshOrigin))){const c=await connect(t);clients.push(c);if(await evaluate(c,'!!window.__JLC_DSH_CONTEXT_TEST__')&&(await evaluate(c,'window.jlcEDAContext.current()')).windowId===2)return c;}return false;});
  const before=await evaluate(frame,'window.jlcEDAContext.current()');assert.ok(before.projectId);conversationId=await evaluate(frame,'document.querySelector("[data-jlc-conversation]").dataset.jlcConversation');
  const ui=await evaluate(frame,'window.__JLC_DSH_CONTEXT_TEST__.ui()');assert.ok(ui.settings.includes('schedules'));assert.ok(!ui.panels.includes('schedules'));step('automation-is-in-settings-without-main-sidebar-entry');
  fixture=await probe('schedule-fixture-create');assert.ok(fixture.id);assert.ok(Date.parse(fixture.scheduledAt)>Date.now()+13*86400000);step('real-future-task-created-without-model-or-immediate-trigger',{id:fixture.id,scheduledAt:fixture.scheduledAt});
  report.stage='catalog';await setFrameViewport(editor,720,820);await openSettings();
  await waitFor(()=>evaluate(frame,'document.querySelector("[data-testid=task-manager-page]")?.textContent.includes("DSH 自动化设置回归")'));
  step('settings-load-real-host-task-catalog');
  await evaluate(frame,'[...document.querySelectorAll("[data-testid=task-manager-page] button")].find(e=>e.textContent.includes("DSH 自动化设置回归")).click()');
  await waitFor(()=>evaluate(frame,'!!document.querySelector("input[aria-label=自动化任务名称]")'));
  report.stage='edit';await fill('自动化任务名称','DSH 自动化设置回读验证');await fill('自动化任务内容','仅用于自动化回归；验证编辑与回读后立即删除。');
  await waitFor(()=>evaluate(frame,'[...document.querySelectorAll("button")].some(e=>e.textContent.trim()==="保存修改"&&!e.disabled)'));await clickText('保存修改');
  const saved=await waitFor(async()=>{const rows=await probe('schedule-fixture-list');return rows.find(r=>r.id===fixture.id&&r.title==='DSH 自动化设置回读验证');});assert.match(saved.prompt,/验证编辑与回读/);step('task-edit-is-persisted-and-independently-read-back');
  report.stage='history';await clickText('任务运行记录');await waitFor(()=>evaluate(frame,'document.body.textContent.includes("暂无任务运行记录")'));step('task-delivery-history-remains-accessible');
  await clickText('规则');const shot=await captureFrame(editor);fs.writeFileSync(path.join(root,'evidence/automation-settings-task-720.png'),Buffer.from(shot.data,'base64'));
  report.stage='delete';await evaluate(frame,'document.querySelector("button[aria-label=自动化任务操作]").click()');await clickText('删除任务');await clickText('确认删除');
  await waitFor(async()=>!(await probe('schedule-fixture-list')).some(r=>r.id===fixture.id));await probe('schedule-fixture-delete',{id:fixture.id});fixture=null;report.fixtureDeleted=true;step('task-deletion-confirmed-by-real-host-readback');
  for(const width of [360,440,720]){
    report.stage='viewport '+width;await setFrameViewport(editor,width,820);await delay(200);
    const rect=await evaluate(frame,'(()=>{const e=document.querySelector("[data-jlc-automation-settings]"),r=e.getBoundingClientRect();return {width:innerWidth,left:r.left,right:r.right,height:r.height,search:!!e.querySelector("input[aria-label=搜索任务]")};})()');assert.ok(rect.height>200);assert.ok(rect.left>=0&&rect.right<=width+1);assert.ok(rect.search);
    const shot=await captureFrame(editor);fs.writeFileSync(path.join(root,'evidence',`automation-settings-${width}.png`),Buffer.from(shot.data,'base64'));step('automation-settings-fit-'+width,rect);
  }
  report.stage='new';await clickText('新建自动化任务');await waitFor(()=>evaluate(frame,`!document.querySelector("[role=dialog]")&&document.querySelector("[data-jlc-binding]")?.dataset.jlcBinding==="bound"&&document.querySelector("[data-jlc-conversation]")?.dataset.jlcConversation!==${JSON.stringify(conversationId)}`));
  const current=await evaluate(frame,'window.jlcEDAContext.current()');assert.equal(current.windowId,before.windowId);assert.equal(current.projectId,before.projectId);assert.equal(current.workspaceDirectory,before.workspaceDirectory);
  assert.notEqual(await evaluate(frame,'document.querySelector("[data-jlc-conversation]").dataset.jlcConversation'),conversationId);step('new-task-closes-settings-and-opens-owning-project-conversation');report.passed=true;
}catch(error){report.passed=false;report.error=error.stack;process.exitCode=1;console.error(error);if(frame)report.visibleText=await evaluate(frame,'document.body.innerText.slice(-2600)').catch(()=>null);if(editor){const shot=await captureFrame(editor).catch(()=>null);if(shot)fs.writeFileSync(path.join(root,'evidence/automation-settings-failure.png'),Buffer.from(shot.data,'base64'));}}
finally{
  if(fixture&&pipe){await probe('schedule-fixture-delete',{id:fixture.id}).catch(e=>{report.cleanupError=e.message;});report.fixtureDeleted=!(await probe('schedule-fixture-list').catch(()=>[{id:fixture.id}])).some(r=>r.id===fixture.id);}
  if(editor)await clearFrameViewport(editor).catch(()=>{});clients.forEach(c=>c.close());fs.writeFileSync(path.join(root,'evidence/automation-settings-regression.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,steps:report.steps.length,fixtureDeleted:report.fixtureDeleted,error:report.error}));
}})();
