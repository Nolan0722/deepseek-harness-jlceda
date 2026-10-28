const {setFrameViewport,clearFrameViewport,captureFrame}=require('./frame-test.cjs');
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const {McpTransport}=require('../host/mcp-transport.cjs');
const {folderProject}=require('../host/folder-project.cjs');
const {restoreContexts}=require('./restore-captured-context.cjs');
const {request}=require('../plugins/jlc-context/index.cjs');
const {targets,connect}=require('./cdp.cjs');
const execute=promisify(execFile),root=path.resolve(__dirname,'..'),owner=Number(process.argv[2]);
const executable=path.join(root,'lab/client/lceda-pro.exe'),profile=path.join(root,'lab/profile');
const mcp=new McpTransport(executable,profile,path.join(root,'lab'));
const fixtureDirectory=path.join(root,'lab/eprj3-fixture/中文工程 带空格');
if(!fs.existsSync(fixtureDirectory)){
  const projects=path.join(profile,'documents/LCEDA-Pro/projects');
  const source=process.argv[3]||fs.readdirSync(projects,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>path.join(projects,x.name)).find(value=>{try{return !!folderProject(value);}catch{return false;}});
  if(!source)throw Error('Provide an existing .eprj3 project as the third argument; tests copy it into lab.');
  fs.mkdirSync(path.dirname(fixtureDirectory),{recursive:true});fs.cpSync(folderProject(source).directory,fixtureDirectory,{recursive:true,force:false,errorOnExist:true});
}
const folder=folderProject(fixtureDirectory);
const expectedUUID=crypto.createHash('sha256').update(folder.directory).digest('hex');
const report={date:new Date().toISOString(),owner,fixture:folder,expectedUUID,steps:[],modelRequests:0,computerUseUsed:false};
const delay=ms=>new Promise(r=>setTimeout(r,ms));let lastSession,guest,conversationId,editor;
function step(name,value={}){report.steps.push({name,...value});console.log(name);}
async function waitFor(fn,ms=30000){const end=Date.now()+ms;while(Date.now()<end){const value=await fn();if(value)return value;await delay(200);}throw Error('eprj3 test timed out: '+report.stage);}
async function native(args){let stdout;try{({stdout}=await execute(executable,['--userData',profile,...args],{cwd:root,windowsHide:true,maxBuffer:2e6,timeout:40000}));}catch(error){if(!error.stdout)throw error;stdout=error.stdout;}const value=JSON.parse(stdout.trim());if(!value.ok)throw Object.assign(Error(JSON.stringify(value)),{nativeCode:value.error?.code});return Object.hasOwn(value,'value')?value.value:value.data;}
async function close(session){await mcp.command('session.close',{session:session.sessionId,destroy:true});await waitFor(async()=>!(await mcp.command('session.list')).some(x=>x.sessionId===session.sessionId&&x.status==='alive'));}
async function evaluate(c,expression){const r=await c.call('Runtime.evaluate',{expression:`window.__JLC_EPRJ3_PROMISE__=Promise.resolve(${expression})`,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function findGuest(windowId){return waitFor(async()=>{for(const t of(await targets()).filter(x=>x.type==='iframe'&&x.url.startsWith('https://127.0.0.1:'))){const c=await connect(t);try{const current=await evaluate(c,'window.jlcEDAContext?.current()');if(current?.windowId===windowId&&await evaluate(c,'!!window.__JLC_DSH_CONTEXT_TEST__'))return c;}catch{}c.close();}return false;});}
(async()=>{try{
  report.stage='ready';await waitFor(async()=>{try{const s=JSON.parse(fs.readFileSync(path.join(root,'lab',`host-state-${owner}.json`)));return s.status.phase==='ready'&&s.mcp.bridgeHealthy;}catch{return false;}});
  // Close only prior CLI-owned windows for this exact disposable fixture.
  for(const s of await mcp.command('session.list'))if(s.origin==='cli'&&s.status==='alive'&&(s.path===folder.directory||s.path===folder.index))await close(s);
  let project,documentId;
  for(const [label,via,value,headless=false] of [['CLI-directory','cli',folder.directory],['MCP-index','mcp',folder.index],['CLI-index','cli',folder.index],['MCP-headless-index','mcp',folder.index,true],['MCP-directory','mcp',folder.directory]]){
    report.stage=label;const session=via==='cli'?await native(['open','--path',value]):await mcp.command('open',{path:value,headless});lastSession=session;
    assert.equal(session.path,folder.directory);
    // open must not report success while only the execution bridge is ready.
    project=await mcp.command('invoke',{session:session.sessionId,timeout:5000,code:'return await eda.dmt_Project.getCurrentProjectInfo();'});
    assert.equal(project?.uuid,expectedUUID);assert.ok(project.data?.some(x=>x.schematic?.page?.length),'Project data must be ready immediately after native open');
    documentId=project.data.find(x=>x.schematic?.page?.length).schematic.page[0].uuid;
    if(label==='MCP-directory'){
      guest=await findGuest(session.renderId);conversationId=await evaluate(guest,'window.__JLC_DSH_CONTEXT_TEST__.create()');
      const home=await evaluate(guest,`window.jlcEDAContext.select(${JSON.stringify(conversationId)})`);assert.equal(home.state,'bound');assert.equal(home.target.documentId,null);
      step('project-conversation-created-on-home-page-before-opening-document',{conversationId});
    }
    const doc=await mcp.command('invoke',{session:session.sessionId,timeout:10000,code:`await eda.dmt_EditorControl.openDocument(${JSON.stringify(documentId)});return await eda.dmt_SelectControl.getCurrentDocumentInfo();`});assert.equal(doc.uuid,documentId);assert.equal(doc.parentProjectUuid,expectedUUID);
    step(label+'-opens-canonical-project-and-document',{session,projectId:project.uuid,documentId});
    if(label!=='MCP-directory'){await close(session);lastSession=null;step(label+'-closes-cleanly');}
  }
  report.stage='DSH-context';
  const state=JSON.parse(fs.readFileSync(path.join(root,'lab',`host-state-${owner}.json`)));
  const bound=await request(state.contextPipe+'-dsh-test',{conversationId,name:'jlceda_context',args:{}});assert.equal(bound.isError,false,JSON.stringify(bound));
  assert.equal(bound.value.target.projectId,expectedUUID);assert.equal(bound.value.target.documentId,documentId);assert.equal(bound.value.target.projectPath,folder.directory);assert.equal(bound.value.workspace.root,folder.directory);assert.equal(bound.value.workspace.cwd,folder.directory);
  step('DSH-native-MCP-binding-and-working-directory-match-canonical-folder',{conversationId,target:bound.value.target,workspace:bound.value.workspace});
  const pcbId=project.data.find(x=>x.pcb)?.pcb.uuid;assert.ok(pcbId);
  const pcb=await mcp.command('invoke',{session:lastSession.sessionId,code:`await eda.dmt_EditorControl.openDocument(${JSON.stringify(pcbId)});return await eda.dmt_SelectControl.getCurrentDocumentInfo();`});
  await waitFor(()=>evaluate(guest,`window.jlcEDAContext.select(${JSON.stringify(conversationId)}).then(x=>x.state==='bound'&&x.target.documentId===${JSON.stringify(pcbId)}).catch(()=>false)`));
  const blocked=await request(state.contextPipe+'-dsh-test',{conversationId,name:'jlceda_call',args:{path:'invoke',documentTabId:bound.value.target.documentTabId,input:{code:'throw Error("MUST_NOT_RUN");'},purpose:'modify'}});assert.equal(blocked.isError,true);assert.match(JSON.stringify(blocked.content),/DOCUMENT_CHANGED/);
  const currentCall=await request(state.contextPipe+'-dsh-test',{conversationId,name:'jlceda_call',args:{path:'invoke',documentTabId:pcb.tabId,input:{code:'return await eda.dmt_SelectControl.getCurrentDocumentInfo();'},purpose:'query'}});assert.equal(currentCall.isError,false);
  step('same-project-PCB-follows-live-context-and-rejects-old-schematic-operation');
  await mcp.command('invoke',{session:lastSession.sessionId,code:`await eda.dmt_EditorControl.openDocument(${JSON.stringify(documentId)});return true;`});
  const finalContext=await evaluate(guest,`window.jlcEDAContext.select(${JSON.stringify(conversationId)})`);assert.equal(finalContext.target.documentId,documentId);
  await waitFor(()=>evaluate(guest,`(()=>{const c=document.querySelector('[data-jlc-conversation="${conversationId}"]');return c?.getAttribute('data-jlc-binding')==='bound'&&c.getAttribute('data-jlc-document')===${JSON.stringify(finalContext.target.documentTabId)}&&c.innerText.includes(${JSON.stringify(finalContext.target.documentName)})&&!c.innerText.includes('不一致')&&!c.querySelector('button');})()`));
  const ui=await evaluate(guest,`(()=>{const c=document.querySelector('[data-jlc-conversation="${conversationId}"]');return {text:c.innerText,directory:c.querySelector('[data-jlc-workspace]').getAttribute('data-jlc-workspace')};})()`);assert.equal(ui.directory,folder.directory);
  editor=await (async()=>{for(const t of(await targets()).filter(t=>t.type==='page'&&t.url.startsWith('https://client/editor'))){const c=await connect(t);if(await evaluate(c,'window.electronAPI.getWinId()')===lastSession.renderId)return c;c.close();}throw Error('Fixture editor absent');})();
  const image=await captureFrame(editor);editor.close();editor=null;fs.writeFileSync(path.join(root,'evidence/project-binding-live-document.png'),Buffer.from(image.data,'base64'));
  step('same-conversation-returns-to-schematic-without-false-mismatch',{ui,documentId,screenshot:'evidence/project-binding-live-document.png'});
  const captured=[{restorePath:folder.index,context:{project:{uuid:expectedUUID},document:{uuid:documentId}}}];
  await close(lastSession);lastSession=null;guest.close();guest=null;
  const old=await request(state.contextPipe+'-dsh-test',{conversationId,name:'jlceda_call',args:{path:'invoke',input:{code:'throw Error("MUST_NOT_RUN");'}}});assert.equal(old.isError,true);assert.match(JSON.stringify(old.content),/WINDOW_CLOSED/);
  step('closed-project-conversation-does-not-retarget-another-window');
  report.stage='restore-index-capture';const restored=await restoreContexts(mcp,captured);assert.equal(restored.length,1);assert.equal(restored[0].path,folder.directory);assert.equal(restored[0].projectId,expectedUUID);assert.equal(restored[0].documentId,documentId);assert.equal(restored[0].reused,false);lastSession={sessionId:restored[0].sessionId};
  step('index-based-capture-restores-project-and-active-document',{restored});
  const liveBefore=(await mcp.command('session.list')).filter(x=>x.status==='alive').length;
  const reused=await restoreContexts(mcp,[{...captured[0],restorePath:folder.directory}]);assert.equal(reused[0].reused,true);assert.equal(reused[0].sessionId,lastSession.sessionId);assert.equal((await mcp.command('session.list')).filter(x=>x.status==='alive').length,liveBefore);
  step('directory-alias-restoration-reuses-ready-session-without-duplicate-window');
  await close(lastSession);lastSession=null;
  report.stage='invalid-input';
  const invalidRoot=path.join(root,'lab/eprj3-invalid-fixtures');fs.mkdirSync(invalidRoot,{recursive:true});
  for(const [name,contents] of [['missing',[]],['ambiguous',['{}','{}']],['malformed',['{']]]){
    const dir=path.join(invalidRoot,name);fs.mkdirSync(dir,{recursive:true});for(let i=0;i<contents.length;i++)fs.writeFileSync(path.join(dir,`index-${i}.eprj3`),contents[i]);
    const count=(await mcp.command('session.list')).filter(x=>x.status==='alive').length;
    await assert.rejects(()=>mcp.command('open',{path:dir}),error=>error.nativeCode==='INVALID_ARGS');
    await assert.rejects(()=>native(['open','--path',contents.length?path.join(dir,'index-0.eprj3'):dir]),error=>error.nativeCode==='INVALID_ARGS');
    assert.equal((await mcp.command('session.list')).filter(x=>x.status==='alive').length,count);
    step('invalid-'+name+'-rejected-before-window-creation');
  }
  report.passed=true;
}catch(error){report.passed=false;report.error=error.stack;process.exitCode=1;console.error(error);
  if(lastSession)for(const t of(await targets()).filter(x=>x.type==='page'&&x.url.startsWith('https://client/editor'))){const c=await connect(t);try{if(await evaluate(c,'window.electronAPI?.getWinId()')===lastSession.renderId)report.failedEditor=await evaluate(c,'({hint:window.__JLC_DSH_READ_CONTEXT__?.(),text:document.body.innerText.slice(0,3500),href:location.href})');}finally{c.close();}}
}finally{
  editor?.close();guest?.close();if(lastSession)await close(lastSession).catch(error=>{report.cleanupError=error.message;});await mcp.close();
  fs.writeFileSync(path.join(root,'evidence/eprj3-regression.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,steps:report.steps.length,error:report.error}));
}})();
