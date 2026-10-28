const {setFrameViewport,clearFrameViewport,captureFrame}=require('./frame-test.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {McpTransport}=require('../host/mcp-transport.cjs');
const {request}=require('../plugins/jlc-context/index.cjs');
const {targets,connect}=require('./cdp.cjs');
const root=path.resolve(__dirname,'..'),owner=Number(process.argv[2]);
const hostFile=path.join(root,'lab',`host-state-${owner}.json`),report={date:new Date().toISOString(),owner,steps:[]};
const mcp=new McpTransport(path.join(root,'lab/client/lceda-pro.exe'),path.join(root,'lab/profile'),path.join(root,'lab'));
const clients=[];
const canonical=p=>p.replaceAll('\\','/').toLowerCase();
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn){const end=Date.now()+35000;while(Date.now()<end){const x=await fn();if(x)return x;await delay(200)}throw Error(`Workspace test timed out: ${report.stage}`);}
async function evaluate(client,expression){
  // Retain async evaluations across DSH view changes and Chromium GC.
  const result=await client.call('Runtime.evaluate',{expression:`window.__JLC_WORKSPACE_TEST_PROMISE__=Promise.resolve(${expression})`,awaitPromise:true,returnByValue:true});
  if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;
}
async function findEditor(id){return waitFor(async()=>{
  for(const t of(await targets()).filter(t=>t.type==='page'&&t.url.startsWith('https://client/editor'))){const c=await connect(t);clients.push(c);if(await evaluate(c,'window.electronAPI.getWinId()')===id)return c;}return false;
});}
async function findGuest(id){return waitFor(async()=>{
  for(const t of(await targets()).filter(t=>t.type==='iframe'&&t.url.startsWith('https://127.0.0.1:'))){const c=await connect(t);clients.push(c);const info=await evaluate(c,'window.jlcEDAContext?.current()');if(info?.windowId===id)return c;}return false;
});}
function step(name,details={}){report.steps.push({name,...details});console.log(name);}
function uiState(guest){return evaluate(guest,`(()=>{const card=document.querySelector('[data-jlc-binding]');return {conversationId:card?.getAttribute('data-jlc-conversation'),binding:card?.getAttribute('data-jlc-binding'),directory:document.querySelector('[data-jlc-workspace]')?.getAttribute('data-jlc-workspace'),project:window.__JLC_DSH_CONTEXT_TEST__?.project(),workspaceChip:document.querySelector('button[aria-label="选择工作区"]')?.innerText}})()`);}
(async()=>{let guest,editor;try{
  const state=JSON.parse(fs.readFileSync(hostFile)),sessions=await mcp.command('session.list');
  const home=sessions.find(s=>s.status==='alive'&&s.origin==='user'&&s.renderId===2);assert.ok(home,'Start with a bare copied editor');
  editor=await findEditor(home.renderId);guest=await findGuest(home.renderId);
  const probe=(id,action,extra={})=>request(state.contextPipe+'-dsh-test',{conversationId:id,action,...extra});
  const source=path.join(root,'lab/profile/documents/LCEDA-Pro/example-projects/示例工程_快速入门.eprj2');
  const directoryB=path.join(root,'lab/workspace-switch-fixture/project-B');fs.mkdirSync(directoryB,{recursive:true});
  const fileB=path.join(directoryB,'上下文工程B.eprj2');if(!fs.existsSync(fileB))fs.copyFileSync(source,fileB);
  const switchTo=async(expectedDirectory,file)=>{
    const opened=await evaluate(editor,`window.__JLC_DSH_DEBUG__.openLocalProject(${JSON.stringify(file)})`);
    assert.equal(opened.success,true,'The actual GUI local-file open path succeeds');
    return waitFor(async()=>{
      const x=await uiState(guest);
      if(x.project?.syncing||!['bound','stale'].includes(x.binding)||canonical(x.directory||'')!==canonical(expectedDirectory)||canonical(x.project?.current?.projectPath||'')!==canonical(file))return false;
      try{const runtime=await probe(x.conversationId,'workspace');return canonical(runtime.root)===canonical(expectedDirectory)&&canonical(runtime.cwd)===canonical(expectedDirectory)&&{...x,runtime};}catch{return false;}
    });
  };
  report.stage='switch-GUI-project-A';
  const first=await switchTo(path.dirname(source),source);
  const sessionAfter=(await mcp.command('session.list')).find(s=>s.sessionId===home.sessionId);assert.equal(sessionAfter.path,null,'GUI-open path remains null in raw CLI session metadata');
  step('GUI-project-path-and-real-DSH-workspace-A',{conversationId:first.conversationId,projectPath:first.project.current.projectPath,workspaceChip:first.workspaceChip,...first.runtime});
  report.stage='switch-GUI-project-B';
  const second=await switchTo(directoryB,fileB);assert.notEqual(second.conversationId,first.conversationId);
  const oldRuntime=await probe(first.conversationId,'workspace');assert.equal(canonical(oldRuntime.root),canonical(path.dirname(source)));
  step('same-window-project-B-switches-directory-and-preserves-A-history',{conversationId:second.conversationId,workspaceChip:second.workspaceChip,...second.runtime,oldRoot:oldRuntime.root});
  report.stage='switch-back-A';
  const returned=await switchTo(path.dirname(source),source);assert.equal(returned.conversationId,first.conversationId);
  step('switch-back-restores-project-conversation-and-directory');
  // A project anchor never changes merely because its conversation is opened elsewhere.
  const mismatch=await probe(second.conversationId,undefined,{name:'jlceda_context',args:{}});
  assert.equal(mismatch.isError,true);assert.match(JSON.stringify(mismatch.content),/PROJECT_CHANGED/);
  step('old-conversation-with-different-working-root-is-rejected');
  report.stage='document-follows-project';
  await mcp.command('invoke',{session:home.sessionId,code:'return await eda.dmt_EditorControl.openDocument("b2f4d387989c4c63ac68533b05f0eee3");'});
  await waitFor(async()=>{const x=await uiState(guest);return x.binding==='bound'&&x.conversationId===first.conversationId;});
  assert.equal(await evaluate(guest,'!!document.querySelector(".jlc-eda-binding__button")'),false);
  step('same-project-document-switch-needs-no-rebind-and-shows-no-mismatch');
  report.stage='show-project-mismatch';
  await evaluate(guest,`window.__JLC_DSH_CONTEXT_TEST__.open(${JSON.stringify(second.conversationId)})`);
  await waitFor(async()=> (await uiState(guest)).binding==='stale');
  const sizes=[{width:380,height:800},{width:720,height:900},{width:1447,height:1100}];
  for(const size of sizes){
    await setFrameViewport(editor,size.width,size.height);await delay(250);
    const layout=await evaluate(guest,`(()=>{const c=document.querySelector('[data-jlc-binding]'),i=document.querySelector('[data-composer-card]'),b=c.querySelector('button');return {card:c.getBoundingClientRect().toJSON(),input:i.getBoundingClientRect().toJSON(),button:b?.getBoundingClientRect().toJSON(),flexShrink:getComputedStyle(c).flexShrink,viewport:{width:innerWidth,height:innerHeight},text:c.innerText}})()`);
    assert.ok(layout.card.height>=44,'Context card has a readable height');assert.ok(layout.card.bottom+3<=layout.input.top,'Context card must not overlap input');
    assert.ok(layout.card.left>=0&&layout.card.right<=layout.viewport.width+1,'Context card fits viewport');
    assert.ok(layout.button&&layout.button.top>=layout.card.top&&layout.button.bottom<=layout.card.bottom+1,'Rebind action fits inside card');
    assert.equal(layout.flexShrink,'0');
    const screenshot=await captureFrame(editor);
    const imagePath=path.join(root,'evidence',`workspace-binding-${size.width}.png`);fs.writeFileSync(imagePath,Buffer.from(screenshot.data,'base64'));
    step(`context-card-layout-${size.width}`,{...layout,screenshot:imagePath});
  }
  await clearFrameViewport(editor);
  report.stage='switch-project-conversation';
  await evaluate(guest,'document.querySelector(".jlc-eda-binding__button").click()');
  await waitFor(async()=> (await uiState(guest)).binding==='bound');
  const bound=await uiState(guest),result=await probe(bound.conversationId,undefined,{name:'jlceda_context',args:{}});assert.equal(result.isError,false);
  assert.equal(canonical(result.value.workspace.cwd),canonical(path.dirname(source)));
  assert.equal(bound.conversationId,first.conversationId);
  step('project-conversation-switch-restores-correct-workspace-and-live-document');
  report.passed=true;
}catch(error){report.passed=false;report.error=error.stack;process.exitCode=1;console.error(error)}finally{
  if(editor)await clearFrameViewport(editor).catch(()=>{});
  clients.forEach(c=>c.close());await mcp.close();fs.writeFileSync(path.join(root,'evidence/workspace-sync-regression.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,steps:report.steps.length,error:report.error}));
}})();
