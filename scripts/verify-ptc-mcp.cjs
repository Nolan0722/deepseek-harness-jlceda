'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {McpTransport,decodeResult}=require('../host/mcp-transport.cjs'),{request}=require('../plugins/jlc-context/index.cjs');
const {targets,connect}=require('./cdp.cjs');
const root=path.resolve(__dirname,'..'),owner=Number(process.argv[2]),contextOnly=!!process.argv[3],fixture=path.resolve(root,process.argv[3]||'lab/eprj3-fixture/中文工程 带空格');
const report={date:new Date().toISOString(),owner,fixture,steps:[],computerUseUsed:false,modelRequests:0,sandboxDisabled:false};
const mcp=new McpTransport(path.join(root,'lab/client/lceda-pro.exe'),path.join(root,'lab/profile'),path.join(root,'lab'));
const clients=[],delay=ms=>new Promise(r=>setTimeout(r,ms));let frame,session,conversation,documentTabId,original,changed=false;
const host=()=>JSON.parse(fs.readFileSync(path.join(root,'lab',`host-state-${owner}.json`)));
function step(name,data={}){report.steps.push({name,...data});console.log(name);}
async function waitFor(fn){const end=Date.now()+40000;while(Date.now()<end){const v=await fn();if(v)return v;await delay(150);}throw Error('PTC regression timeout: '+report.stage);}
async function evaluate(c,expression){const r=await c.call('Runtime.evaluate',{expression:`Promise.resolve(${expression})`,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function run(code,expectError=false){const r=await request(host().contextPipe+'-dsh-test',{action:'ptc-regression',conversationId:conversation,code},AbortSignal.timeout(65000));if(expectError)return r;assert.ok(!r.isError,JSON.stringify(r));assert.equal(r.value.sandbox.mode,'workspace-write');assert.equal(r.value.sandbox.enforcement,'partial');return r.value;}
const readCode=id=>`const c=await eda.sch_PrimitiveComponent.get(${JSON.stringify(id)});return {id:c.getState_PrimitiveId(),name:c.getState_Name(),designator:c.getState_Designator()};`;
function callCode(code,purpose='query',verifyOf){return `return await tools.jlceda_call(${JSON.stringify({path:'invoke',documentTabId,input:{code,timeout:10000},purpose,...(verifyOf?{verifyOf}:{})})});`;}
(async()=>{try{
  report.stage='native open';await waitFor(()=>host().status.phase==='ready'&&host().mcp.bridgeHealthy);
  const existing=(await mcp.command('session.list')).find(s=>s.status==='alive'&&s.path===fixture);
  session=existing||await mcp.command('open',{path:fixture});
  const project=await mcp.command('invoke',{session:session.sessionId,code:'return await eda.dmt_Project.getCurrentProjectInfo();'});
  const document=project.data.find(d=>d.schematic?.page?.length).schematic.page[0].uuid;
  await mcp.command('invoke',{session:session.sessionId,code:`await eda.dmt_EditorControl.openDocument(${JSON.stringify(document)});return true;`});
  const active=await waitFor(async()=>{const d=await mcp.command('invoke',{session:session.sessionId,code:'return await eda.dmt_SelectControl.getCurrentDocumentInfo();'});return d?.uuid===document&&d;});documentTabId=active.tabId;
  frame=await waitFor(async()=>{for(const t of(await targets()).filter(t=>t.type==='iframe'&&t.url.startsWith(host().dshOrigin))){const c=await connect(t);clients.push(c);if(await evaluate(c,'!!window.__JLC_DSH_CONTEXT_TEST__')&&(await evaluate(c,'window.jlcEDAContext.current()')).windowId===session.renderId)return c;}return false;});
  conversation=await evaluate(frame,'window.__JLC_DSH_CONTEXT_TEST__.create()');await waitFor(()=>evaluate(frame,`document.querySelector('[data-jlc-conversation="${conversation}"]')?.dataset.jlcBinding==='bound'`));
  await waitFor(()=>evaluate(frame,'[...document.querySelectorAll("button[title]")].some(b=>b.title==="选择新任务使用的 Agent 预设"&&!b.disabled)'));
  await evaluate(frame,'[...document.querySelectorAll("button[title]")].find(b=>b.title==="选择新任务使用的 Agent 预设").click()');
  await waitFor(()=>evaluate(frame,'[...document.querySelectorAll("[role=menu] button")].some(b=>b.textContent.includes("PTC"))'));
  await evaluate(frame,'[...document.querySelectorAll("[role=menu] button")].find(b=>b.textContent.includes("PTC")).click()');
  await waitFor(()=>evaluate(frame,'[...document.querySelectorAll("button[title]")].find(b=>b.title==="选择新任务使用的 Agent 预设")?.textContent.includes("PTC")'));
  conversation=await evaluate(frame,'document.querySelector("[data-jlc-binding]").dataset.jlcConversation');
  assert.ok((await request(host().contextPipe+'-dsh-test',{action:'list',conversationId:conversation})).includes('run_code'));step('native-PTC-preset-activates-run-code',{conversation,windowId:session.renderId,documentTabId});
  report.stage='PTC context';const context=await run('return await tools.jlceda_context({});');
  assert.equal(context.result.binding.scope,'project');assert.equal(context.result.target.edaSessionId,session.sessionId);assert.equal(context.result.target.documentTabId,documentTabId);assert.equal(path.resolve(context.result.workspace.cwd).toLowerCase(),fixture.toLowerCase());step('PTC-real-native-MCP-context-succeeds-with-workspace-write-sandbox',{context:context.result,sandbox:context.sandbox});
  if(contextOnly){report.passed=true;return;}
  const outside=path.join(root,'lab/ptc-outside');fs.mkdirSync(outside,{recursive:true});const outsideFile=path.join(outside,'blocked-write.txt');fs.writeFileSync(outsideFile,'host-can-write');
  const innerFile=path.join(fixture,'.ptc-sandbox-probe.txt'),tempRoot=path.join(root,'lab/profile/dsh-temp'),tempCandidates=fs.readdirSync(tempRoot).filter(n=>/^dsh-[a-z0-9]{6}$/i.test(n)).map(n=>path.join(tempRoot,n));assert.ok(tempCandidates.length);
  report.stage='confinement';const sandbox=await run(`const fs=process.getBuiltinModule('fs');fs.writeFileSync(${JSON.stringify(innerFile)},'confined');const inside=fs.readFileSync(${JSON.stringify(innerFile)},'utf8');fs.unlinkSync(${JSON.stringify(innerFile)});let outside='unexpected-success';try{fs.writeFileSync(${JSON.stringify(outsideFile)},'must-not-write');}catch(e){outside=e.code;}const tempResults=${JSON.stringify(tempCandidates)}.map(temp=>{const probe=process.getBuiltinModule('path').join(temp,'ptc-private-probe.txt');try{fs.writeFileSync(probe,'private-temp',{flag:'wx'});fs.unlinkSync(probe);return {temp,write:true};}catch(e){return {temp,write:false,code:e.code};}});return {inside,outside,tempResults,programEnvironmentEmpty:Object.keys(process.env).length===0};`);
  assert.equal(sandbox.result.inside,'confined');assert.match(sandbox.result.outside,/EACCES|EPERM/);assert.equal(fs.readFileSync(outsideFile,'utf8'),'host-can-write');assert.equal(sandbox.result.programEnvironmentEmpty,true);assert.equal(sandbox.result.tempResults.filter(t=>t.write).length,1);assert.ok(sandbox.result.tempResults.filter(t=>!t.write).every(t=>/EACCES|EPERM/.test(t.code)));step('real-worker-denies-outside-writes-and-other-session-temp-writes',{...sandbox.result,sandbox:sandbox.sandbox});
  report.stage='help';const help=await run('return await tools.jlceda_help({path:"invoke"});');assert.ok(help.result);step('PTC-nested-tool-dispatch-reaches-native-MCP-help');
  const read=await run(callCode('const all=await eda.sch_PrimitiveComponent.getAll();return all.map(c=>({id:c.getState_PrimitiveId(),name:c.getState_Name(),designator:c.getState_Designator()}));'));
  original=decodeResult(read.result,{envelope:true}).find(c=>/^R\d+$/.test(c.designator)&&typeof c.name==='string');assert.ok(original);step('PTC-reads-real-schematic-component-before-changing',{original});
  const testName='PTC_MCP_'+Date.now(),code=`const c=await eda.sch_PrimitiveComponent.get(${JSON.stringify(original.id)});if(c.getState_Name()!==${JSON.stringify(original.name)})throw Error('PRECONDITION_CHANGED');const r=await eda.sch_PrimitiveComponent.modify(${JSON.stringify(original.id)},{name:${JSON.stringify(testName)}});return {id:r.getState_PrimitiveId()};`;
  report.stage='modify';changed=true;const modified=await run(callCode(code,'modify'));assert.equal(decodeResult(modified.result,{envelope:true}).id,original.id);assert.equal(modified.result.jlcCall.verified,false);step('PTC-modifies-real-component-through-native-MCP',{call:modified.result.jlcCall});
  const verified=await run(callCode(readCode(original.id),'verify',modified.result.jlcCall.id));assert.equal(decodeResult(verified.result,{envelope:true}).name,testName);assert.equal(verified.result.jlcCall.verifyOf,modified.result.jlcCall.id);
  const independent=await mcp.command('invoke',{session:session.sessionId,code:readCode(original.id)});assert.equal(independent.name,testName);step('separate-PTC-readback-and-independent-native-MCP-readback-match',{independent,call:verified.result.jlcCall});
  const refused=await run(callCode('throw Error("MUST_NOT_RUN");','modify').replace(documentTabId,'wrong-document-tab'),true);assert.equal(refused.isError,true);assert.match(JSON.stringify(refused),/DOCUMENT_CHANGED/);step('PTC-cannot-bypass-native-document-target-check');
  report.stage='restore';const restoration=await run(callCode(`await eda.sch_PrimitiveComponent.modify(${JSON.stringify(original.id)},{name:${JSON.stringify(original.name)}});return true;`,'modify'));
  const restored=await run(callCode(readCode(original.id),'verify',restoration.result.jlcCall.id));assert.equal(decodeResult(restored.result,{envelope:true}).name,original.name);changed=false;report.restored=true;step('original-fixture-component-restored-and-independently-read-back');
  const repeat=await run('return await tools.jlceda_context({});');assert.equal(repeat.result.target.projectId,project.uuid);step('repeated-PTC-call-reuses-native-grants-without-changing-policy');report.passed=true;
}catch(error){report.passed=false;report.error=error.stack;console.error(error);process.exitCode=1;}
finally{
  if(changed&&original&&session){try{await mcp.command('invoke',{session:session.sessionId,code:`await eda.sch_PrimitiveComponent.modify(${JSON.stringify(original.id)},{name:${JSON.stringify(original.name)}});return true;`});report.emergencyRestored=true;}catch(error){report.restoreError=error.message;}}
  for(const c of clients)c.close();await mcp.close();fs.writeFileSync(path.join(root,'evidence',contextOnly?'ptc-project-smoke.json':'ptc-mcp-regression.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,steps:report.steps.length,error:report.error}));
}})();
