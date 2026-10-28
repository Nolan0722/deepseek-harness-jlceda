'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {ContextHost,projectIdentity,documentIdentity,projectTarget,projectLocation,parseProjectBindings}=require('../host/context-host.cjs');
const base={edaSessionId:'session',windowId:1,projectId:'project',projectPath:'E:/project',projectDirectory:'E:/project',workspaceDirectory:'E:/project',documentId:null,documentTabId:null,editorTabId:'home'};
function fixture(){
  const entry={contextWindowKey:'window',disposed:false},host=Object.create(ContextHost.prototype);let current={...base};
  Object.assign(host,{ownerId:'owner',views:new Map([[1,entry]]),bindings:new Map(),leases:new Map(),inflight:new Map(),recentCalls:new Map(),capture:async()=>({...current}),save(){},mcp:{status:()=>({phase:'connected',bridgeHealthy:true})}});
  return {host,entry,setCurrent:value=>{current={...value};}};
}
test('project initialization is checked before invoking project APIs',async()=>{
  const host=Object.create(ContextHost.prototype),calls=[];
  host.mcp={command:async name=>{calls.push(name);if(name==='session.list')return[{renderId:1,status:'alive',headless:false,sessionId:'native'}];throw Error('Project API must not run before AST readiness');}};
  const entry={win:{id:1,isDestroyed:()=>false,webContents:{executeJavaScript:async()=>({projectId:'opening',projectReady:false})}}};
  await assert.rejects(host.capture(entry),{code:'CONTEXT_NOT_READY'});assert.deepEqual(calls,['session.list']);
});
test('project identity stays stable across home, schematic, PCB and split tab changes',()=>{
  const sch={...base,documentId:'schematic',documentTabId:'sch@project',editorTabId:'sch@project'},pcb={...sch,documentId:'pcb',documentTabId:'pcb@project',editorTabId:'pcb@project'};
  assert.equal(projectIdentity(base),projectIdentity(sch));assert.equal(projectIdentity(sch),projectIdentity(pcb));assert.notEqual(documentIdentity(sch),documentIdentity(pcb));assert.equal(Object.hasOwn(projectTarget(sch),'documentId'),false);
});
test('conversation remains bound and reports live document after opening a page',async()=>{
  const f=fixture();await f.host.select(f.entry,'conversation');const doc={...base,documentId:'sch',documentTabId:'sch@project',editorTabId:'sch@project'};f.setCurrent(doc);
  const selected=await f.host.select(f.entry,'conversation');assert.equal(selected.state,'bound');assert.equal(selected.target.documentTabId,'sch@project');assert.equal(selected.scope,'project');assert.equal(Object.hasOwn(f.host.bindings.get('conversation').target,'documentId'),false);
  assert.equal((await f.host.validate('conversation')).current.documentId,'sch');
});
test('another project and window remain separate, and project records alone grant no runtime connection',async()=>{
  const f=fixture();await f.host.select(f.entry,'conversation');f.setCurrent({...base,projectId:'other'});await assert.rejects(()=>f.host.validate('conversation'),{code:'PROJECT_CHANGED'});
  assert.equal(f.host.describe(f.host.bindings.get('conversation'),{contextWindowKey:'other'},base).reason,'OTHER_WINDOW');
  f.host.leases.clear();await assert.rejects(()=>f.host.validate('conversation'),{code:'CONVERSATION_UNBOUND'});
  f.setCurrent({...base,edaSessionId:'new-runtime-session'});await f.host.select(f.entry,'conversation');assert.equal((await f.host.validate('conversation')).current.edaSessionId,'new-runtime-session');
});
test('missing or stale invocation document ID is rejected before native dispatch',async()=>{
  const f=fixture(),doc={...base,documentId:'sch',documentTabId:'sch@project',editorTabId:'sch@project'};f.setCurrent(doc);await f.host.select(f.entry,'conversation');
  const request={action:'tool',conversationId:'conversation',tool:'call',workspace:{root:'E:/project'},args:{path:'invoke',input:{code:'throw Error("MUST_NOT_RUN")'}}};
  await assert.rejects(()=>f.host.handle(request),{code:'DOCUMENT_REQUIRED'});
  await assert.rejects(()=>f.host.handle({...request,args:{...request.args,documentTabId:'pcb@project'}}),{code:'DOCUMENT_CHANGED'});
});
test('document changing between preflight and dispatch is rejected even with a matching original ID',async()=>{
  const f=fixture(),sch={...base,documentId:'sch',documentTabId:'sch@project',editorTabId:'sch@project'},pcb={...base,documentId:'pcb',documentTabId:'pcb@project',editorTabId:'pcb@project'};
  f.setCurrent(sch);await f.host.select(f.entry,'conversation');let n=0;f.host.capture=async()=>++n===1?sch:pcb;
  await assert.rejects(()=>f.host.handle({action:'tool',conversationId:'conversation',tool:'call',workspace:{root:'E:/project'},args:{path:'invoke',documentTabId:sch.documentTabId,input:{code:'return true;'}}}),{code:'DOCUMENT_CHANGED'});
});
test('an account/team identifier is never guessed to be the local project path',()=>{
  assert.deepEqual(projectLocation({},{uuid:'project',teamUuid:process.cwd()}),{projectPath:null,projectDirectory:null,directorySource:null});
});
test('only the current project-only store is accepted, without version or record migration',()=>{
  const target={projectPath:null,projectDirectory:null,directorySource:null,workspaceDirectory:'E:/project',projectId:null,projectName:null},row={conversationId:'new',scope:'project',target,createdAt:new Date().toISOString()};
  assert.equal(parseProjectBindings(JSON.stringify({schemaVersion:1,bindings:[row]})).size,1);
  assert.throws(()=>parseProjectBindings(JSON.stringify({schemaVersion:0,bindings:[row]})),/Invalid current/);
  assert.throws(()=>parseProjectBindings(JSON.stringify({schemaVersion:1,bindings:[{...row,ownerId:'old'}]})),/Invalid current/);
  assert.throws(()=>parseProjectBindings(JSON.stringify({schemaVersion:1,bindings:[{...row,target:{...target,documentId:'old'}}]})),/Invalid current/);
});
