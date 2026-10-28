const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {McpTransport}=require('../host/mcp-transport.cjs');
const {request}=require('../plugins/jlc-context/index.cjs');
const {targets,connect}=require('./cdp.cjs');
const root=path.resolve(__dirname,'..'),owner=Number(process.argv[2]);
const stateFile=path.join(root,'lab',`host-state-${owner}.json`);
const report={date:new Date().toISOString(),owner,steps:[]};
const mcp=new McpTransport(path.join(root,'lab/client/lceda-pro.exe'),path.join(root,'lab/profile'),path.join(root,'lab'));
const clients=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn){const end=Date.now()+30000;while(Date.now()<end){const x=await fn();if(x)return x;await delay(200)}throw Error('Context integration wait timed out');}
async function evaluate(client,expression){const r=await client.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function createConversation(client){
  await evaluate(client,'(()=>{window.__JLC_TEST_CREATE__={};window.__JLC_TEST_CREATE__.promise=window.__JLC_DSH_CONTEXT_TEST__.create().then(id=>{window.__JLC_TEST_CREATE__.id=id},error=>{window.__JLC_TEST_CREATE__.error=String(error)});return true})()');
  return waitFor(async()=>{const x=await evaluate(client,'({id:window.__JLC_TEST_CREATE__?.id,error:window.__JLC_TEST_CREATE__?.error})');if(x.error)throw Error(x.error);return x.id;});
}
async function editors(){
  const result=[];
  for(const t of (await targets()).filter(t=>t.type==='page'&&t.url.startsWith('https://client/editor'))){const c=await connect(t);clients.push(c);result.push({id:await evaluate(c,'window.electronAPI.getWinId()'),client:c});}
  return result;
}
async function guests(){
  const result=[];
  for(const t of (await targets()).filter(t=>t.type==='iframe'&&t.url.startsWith('https://127.0.0.1:'))){const c=await connect(t);clients.push(c);
    const value=await evaluate(c,'(async()=>{const id=document.querySelector("[data-jlc-conversation]")?.getAttribute("data-jlc-conversation");if(!id||!window.__JLC_DSH_CONTEXT_TEST__)return null;const s=await window.jlcEDAContext.select(id);return {windowId:s.target.windowId,conversationId:id}})()');
    if(value)result.push({...value,client:c});
  }return result;
}
async function openDocument(client,selector){
  await client.call('Page.bringToFront');
  const point=await waitFor(()=>evaluate(client,`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null})()`));
  assert.ok(point,'Document tree item exists');
  await client.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:2});
  await client.call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:2});
}
function step(name,details={}){report.steps.push({name,...details});console.log(name);}
(async()=>{try{
  const state=JSON.parse(fs.readFileSync(stateFile));assert.ok(state.contextPipe,'Launch copied client with --debug');
  report.stage='open-projects';
  const probe=(conversationId,name,args={})=>request(state.contextPipe+'-dsh-test',{conversationId,name,args},AbortSignal.timeout(65000));
  const context=async id=>{const r=await probe(id,'jlceda_context');assert.equal(r.isError,false,JSON.stringify(r));return r.value.target;};
  const fails=async(id,name,args,code)=>{const r=await probe(id,name,args);assert.equal(r.isError,true);assert.match(JSON.stringify(r.content),new RegExp(code));return r;};
  const source=path.join(root,'lab/profile/documents/LCEDA-Pro/example-projects/示例工程_快速入门.eprj2');
  const copy=path.join(root,'lab/workspace/上下文绑定测试B.eprj2');if(!fs.existsSync(copy))fs.copyFileSync(source,copy);
  const existing=await mcp.command('session.list'),readyWindows=[],editorPaths=new Map();
  for(const e of await editors())if(await evaluate(e.client,'!!window.__JLC_DSH_READ_CONTEXT__')){readyWindows.push(e.id);editorPaths.set(e.id,(await evaluate(e.client,'window.__JLC_DSH_READ_CONTEXT__()'))?.projectPath);}
  const canonical=p=>p?.replaceAll('\\','/').toLowerCase();
  const existingFor=file=>existing.find(s=>(canonical(editorPaths.get(s.renderId))===canonical(file)||canonical(s.path)===canonical(file))&&readyWindows.includes(s.renderId));
  const a=existingFor(source)||await mcp.command('open',{path:source}),b=existingFor(copy)||await mcp.command('open',{path:copy});assert.notEqual(a.renderId,b.renderId);
  let hosts;await waitFor(async()=>{hosts=await editors();return hosts.some(x=>x.id===a.renderId)&&hosts.some(x=>x.id===b.renderId)});
  const ac=hosts.find(x=>x.id===a.renderId).client,bc=hosts.find(x=>x.id===b.renderId).client;
  report.stage='open-documents';
  await waitFor(()=>evaluate(ac,'!!window.__JLC_DSH_READ_CONTEXT__'));
  await waitFor(()=>evaluate(bc,'!!window.__JLC_DSH_READ_CONTEXT__'));
  await openDocument(ac,'[node-type="101"] [data-test="PCB"]');
  await waitFor(()=>evaluate(ac,'window.__JLC_DSH_DEBUG__.state().mode===3'));
  await openDocument(bc,'[node-type="101"] [data-test="PCB"]');
  await waitFor(()=>evaluate(bc,'window.__JLC_DSH_DEBUG__.state().mode===3'));
  report.stage='match-guests';
  let web;await waitFor(async()=>{web=await guests();return web.some(x=>x.windowId===a.renderId)&&web.some(x=>x.windowId===b.renderId)});
  const ag=web.find(x=>x.windowId===a.renderId).client,bg=web.find(x=>x.windowId===b.renderId).client;
  report.stage='create-conversations';
  const aid=await createConversation(ag);
  const bid=await createConversation(bg);
  assert.notEqual(aid,bid);
  await waitFor(()=>evaluate(ag,`document.querySelector('[data-jlc-conversation="${aid}"]')?.getAttribute('data-jlc-binding')==='bound'`));
  await waitFor(()=>evaluate(bg,`document.querySelector('[data-jlc-conversation="${bid}"]')?.getAttribute('data-jlc-binding')==='bound'`));
  report.stage='actual-tool-execution';
  const at=await context(aid),bt=await context(bid);
  assert.equal(at.edaSessionId,a.sessionId);assert.equal(bt.edaSessionId,b.sessionId);assert.notEqual(at.projectPath,bt.projectPath);assert.ok(at.documentId&&bt.documentId);
  step('two-conversations-bind-distinct-project-windows',{a:{conversationId:aid,target:at},b:{conversationId:bid,target:bt}});
  const tools=await request(state.contextPipe+'-dsh-test',{action:'list',conversationId:aid});
  assert.ok(tools.includes('jlceda_call')&&tools.includes('jlceda_context'));assert.ok(!tools.some(n=>n.startsWith('mcp__jlceda__')));
  step('actual-dsh-tool-registry-has-only-bound-eda-entrypoints');
  await bc.call('Page.bringToFront');assert.equal((await context(aid)).edaSessionId,a.sessionId);
  const invoked=await probe(aid,'jlceda_call',{path:'invoke',documentTabId:at.documentTabId,input:{code:'return await eda.dmt_SelectControl.getCurrentDocumentInfo();'}});
  assert.equal(invoked.isError,false,JSON.stringify(invoked));const doc=JSON.parse(invoked.value.content[0].text).data;assert.equal(doc.tabId,at.documentTabId);
  step('focus-other-window-still-invokes-bound-document',{documentId:doc.uuid});
  await fails(aid,'jlceda_call',{path:'invoke',input:{session:b.sessionId,code:'return true;'}},'SESSION_MISMATCH');
  step('reject-explicit-foreign-session');
  await fails(aid,'jlceda_call',{path:'stop'},'UNSCOPED_COMMAND');
  await fails(aid,'jlceda_call',{path:'invoke',input:{codeFile:'anything.js'}},'UNGUARDED_INVOCATION');
  step('reject-unscoped-owner-and-unguarded-file-invocation');
  if(!await evaluate(ac,'!!document.querySelector(\'[node-type="7"] [data-test="1. P1"]\')'))await openDocument(ac,'[node-type="6"] [data-test="波形产生与变换"]');
  await waitFor(()=>evaluate(ac,'!!document.querySelector("[node-type=\\"7\\"] [data-test=\\"1. P1\\"]")'));
  await openDocument(ac,'[node-type="7"] [data-test="1. P1"]');
  await waitFor(()=>evaluate(ac,'window.__JLC_DSH_DEBUG__.state().mode===1'));
  const schematic=await context(aid);assert.notEqual(schematic.documentId,at.documentId);
  const selected=await evaluate(ag,`window.jlcEDAContext.select(${JSON.stringify(aid)})`);assert.equal(selected.state,'bound');
  await fails(aid,'jlceda_call',{path:'invoke',documentTabId:at.documentTabId,input:{code:'throw new Error("BODY_MUST_NOT_RUN");'}},'DOCUMENT_CHANGED');
  step('document-switch-follows-live-context-and-rejects-old-operation-stamp');
  const liveCall=await probe(aid,'jlceda_call',{path:'invoke',documentTabId:schematic.documentTabId,input:{code:'return await eda.dmt_SelectControl.getCurrentDocumentInfo();'}});assert.equal(liveCall.isError,false);
  assert.equal(JSON.parse(liveCall.value.content[0].text).data.uuid,schematic.documentId);
  step('current-schematic-call-works-without-conversation-rebind',{scope:selected.scope});
  await evaluate(bg,`window.__JLC_DSH_CONTEXT_TEST__.open(${JSON.stringify(aid)})`);
  const foreign=await evaluate(bg,`window.jlcEDAContext.select(${JSON.stringify(aid)})`);assert.equal(foreign.reason,'PROJECT_CHANGED');
  assert.equal((await context(aid)).edaSessionId,a.sessionId);
  step('opening-same-conversation-in-other-window-does-not-retarget');
  await bc.call('Page.close');
  await waitFor(()=>!JSON.parse(fs.readFileSync(stateFile)).windows.some(w=>w.id===b.renderId));
  await fails(bid,'jlceda_context',{},'WINDOW_CLOSED');assert.equal((await context(aid)).edaSessionId,a.sessionId);
  step('closed-window-cannot-fall-back-to-surviving-window');
  const persisted=JSON.parse(fs.readFileSync(path.join(root,'lab/project-bindings.json'))).bindings.find(x=>x.conversationId===aid);
  assert.equal(persisted.scope,'project');assert.equal(persisted.target.projectId,(await context(aid)).projectId);
  for(const key of ['ownerId','windowKey','documentId','documentTabId','editorTabId','edaSessionId'])assert.ok(!Object.hasOwn(persisted,key)&&!Object.hasOwn(persisted.target,key));
  step('persistent-project-anchor-contains-no-runtime-window-or-document-snapshot');
  report.passed=true;
}catch(error){report.passed=false;report.error=error.stack;process.exitCode=1;console.error(error)}finally{
  clients.forEach(c=>c.close());mcp.close();fs.writeFileSync(path.join(root,'evidence/context-binding-regression.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,steps:report.steps.length,error:report.error}));
}})();
