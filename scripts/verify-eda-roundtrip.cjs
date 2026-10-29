const {setFrameViewport,clearFrameViewport,captureFrame}=require('./frame-test.cjs');
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {McpTransport,decodeResult}=require('../host/mcp-transport.cjs');
const {request}=require('../plugins/jlc-context/index.cjs');
const {targets,connect}=require('./cdp.cjs');
const root=path.resolve(__dirname,'..'),owner=Number(process.argv[2]),report={date:new Date().toISOString(),owner,modelRequests:0,steps:[]};
const mcp=new McpTransport(path.join(root,'lab/client/lceda-pro.exe'),path.join(root,'lab/profile'),path.join(root,'lab'));
const clients=[],delay=ms=>new Promise(r=>setTimeout(r,ms));
const hostFile=path.join(root,'lab',`host-state-${owner}.json`);
const hostState=()=>JSON.parse(fs.readFileSync(hostFile));
let guest,editor,session,conversationId,original,documentId,documentTabId,changed=false,probe;
async function waitFor(fn,ms=35000){const end=Date.now()+ms;while(Date.now()<end){const value=await fn();if(value)return value;await delay(150);}throw Error('EDA roundtrip timed out: '+report.stage);}
async function evaluate(client,expression){const r=await client.call('Runtime.evaluate',{expression:`window.__JLC_ROUNDTRIP_PROMISE__=Promise.resolve(${expression})`,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
function step(name,value={}){report.steps.push({name,...value});console.log(name);}
async function openTree(selector){
  const point=await waitFor(()=>evaluate(editor,`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null})()`));
  await editor.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:2});
  await editor.call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:2});
}
async function invoke(code,purpose='query',verifyOf){const value=await probe('jlceda_call',{path:'invoke',documentTabId,input:{code,timeout:15000},purpose,...(verifyOf?{verifyOf}:{})});assert.equal(value.isError,false,JSON.stringify(value));return {data:decodeResult(value.value,{envelope:true}),call:value.value.jlcCall};}
const readOne=id=>`const c=await eda.sch_PrimitiveComponent.get(${JSON.stringify(id)});return {id:c.getState_PrimitiveId(),name:c.getState_Name(),designator:c.getState_Designator()};`;
(async()=>{try{
  report.stage='native-fixture';await waitFor(()=>{try{return hostState().status.phase==='ready';}catch{return false;}});
  const fixtureDir=path.join(root,'lab/phase2-fixture'),fixture=path.join(fixtureDir,'DSH读写闭环.eprj2');fs.mkdirSync(fixtureDir,{recursive:true});
  if(!fs.existsSync(fixture))fs.copyFileSync(path.join(root,'lab/profile/documents/LCEDA-Pro/example-projects/示例工程_快速入门.eprj2'),fixture);
  report.fixture=fixture;
  const readyWindows=new Set(hostState().windows.map(x=>x.id));
  const normalize=p=>(p||'').replaceAll('\\','/').toLowerCase();
  session=(await mcp.command('session.list')).find(s=>s.status==='alive'&&readyWindows.has(s.renderId)&&normalize(s.path)===normalize(fixture))||await mcp.command('open',{path:fixture});
  editor=await waitFor(async()=>{for(const t of(await targets()).filter(x=>x.type==='page'&&x.url.startsWith('https://client/editor'))){const c=await connect(t);clients.push(c);if(await evaluate(c,'window.electronAPI?.getWinId()')===session.renderId&&await evaluate(c,'!!window.__JLC_DSH_READ_CONTEXT__'))return c;}return false;});
  if(!await evaluate(editor,'!!document.querySelector(\'[node-type="7"] [data-test="1. P1"]\')'))await openTree('[node-type="6"] [data-test="波形产生与变换"]');
  await openTree('[node-type="7"] [data-test="1. P1"]');
  const document=await waitFor(async()=>{const d=await mcp.command('invoke',{session:session.sessionId,timeout:5000,code:'return await eda.dmt_SelectControl.getCurrentDocumentInfo();'});return d?.uuid&&d;});
  documentId=document.uuid;documentTabId=document.tabId;
  report.stage='actual-DSH-agent';
  guest=await waitFor(async()=>{
    for(const target of(await targets()).filter(t=>t.type==='iframe'&&t.url.startsWith('https://127.0.0.1:'))){const c=await connect(target);clients.push(c);try{const value=await evaluate(c,'window.jlcEDAContext?.current()');if(value?.windowId===session.renderId&&await evaluate(c,'!!window.__JLC_DSH_CONTEXT_TEST__'))return c;}catch{}}
    return false;
  });
  conversationId=await evaluate(guest,'window.__JLC_DSH_CONTEXT_TEST__.create()');assert.ok(conversationId);
  await waitFor(()=>evaluate(guest,`document.querySelector('[data-jlc-conversation="${conversationId}"]')?.getAttribute('data-jlc-binding')==='bound'`));
  const pipe=hostState().contextPipe;
  probe=(name,args={})=>request(pipe+'-dsh-test',{conversationId,name,args},AbortSignal.timeout(65000));
  const context=await probe('jlceda_context');assert.equal(context.isError,false,JSON.stringify(context));assert.equal(context.value.target.edaSessionId,session.sessionId);assert.equal(context.value.target.documentId,documentId);assert.equal(context.value.mcp.bridgeHealthy,true);assert.equal(path.resolve(context.value.workspace.cwd),fixtureDir);
  step('actual-DSH-agent-bound-to-fixture-document-and-directory',{conversationId,target:context.value.target,mcp:context.value.mcp});
  report.stage='prompt-assembly';
  const prompt=await request(pipe+'-dsh-test',{action:'prompt',conversationId},AbortSignal.timeout(30000));
  assert.match(prompt.prompt,/读取真实状态 → 执行操作 → 回读验证/);assert.match(prompt.prompt,/powered by DeepSeek Harness/);assert.match(prompt.prompt,/NOT a read-only sandbox/);
  const live=JSON.parse(prompt.contexts[0].text.split('\n').slice(1).join('\n'));assert.equal(live.state,'bound');assert.equal(live.target.documentId,documentId);assert.equal(live.binding.conversationId,conversationId);
  assert.deepEqual(prompt.tools.map(x=>x.name).sort(),['jlceda_call','jlceda_context','jlceda_discover','jlceda_help']);assert.ok(prompt.tools.find(x=>x.name==='jlceda_call').parameters.properties.purpose);
  fs.writeFileSync(path.join(root,'evidence/phase2-prompt.json'),JSON.stringify({rulesPresent:true,contexts:prompt.contexts,tools:prompt.tools},null,2));
  step('real-prompt-assembly-has-rules-live-target-and-only-native-proxies');
  report.stage='native-help';
  assert.equal((await probe('jlceda_help',{path:'invoke'})).isError,false);
  const docs=await probe('jlceda_call',{path:'doc.api',input:{className:'SCH_PrimitiveComponent',methodName:'modify'},purpose:'query'});assert.equal(docs.isError,false);assert.ok(decodeResult(docs.value,{envelope:true}).params.some(p=>p.name==='property'));
  step('native-help-and-method-schema-through-bound-DSH-runtime');
  report.stage='read';
  const read=await invoke('const all=await eda.sch_PrimitiveComponent.getAll();return all.map(c=>({id:c.getState_PrimitiveId(),name:c.getState_Name(),designator:c.getState_Designator(),type:c.getState_ComponentType()}));');
  original=read.data.find(c=>/^R\d+$/.test(c.designator)&&typeof c.name==='string');assert.ok(original,'Fixture has a regular resistor');
  report.original=original;step('read-real-component-before-modification',{component:original,call:read.call});
  const testName='DSH_roundtrip_'+Date.now();
  const modifyCode=`const c=await eda.sch_PrimitiveComponent.get(${JSON.stringify(original.id)});if(c.getState_Name()!==${JSON.stringify(original.name)})throw Error('PRECONDITION_CHANGED');const changed=await eda.sch_PrimitiveComponent.modify(${JSON.stringify(original.id)},{name:${JSON.stringify(testName)}});return {returnedId:changed.getState_PrimitiveId()};`;
  report.stage='modify';changed=true;const modified=await invoke(modifyCode,'modify');assert.equal(modified.data.returnedId,original.id);assert.equal(modified.call.verified,false);
  step('modify-real-attribute-through-native-invoke',{call:modified.call});
  report.stage='independent-readback';
  const verified=await invoke(readOne(original.id),'verify',modified.call.id);assert.equal(verified.data.name,testName);assert.equal(verified.data.designator,original.designator);assert.equal(verified.call.verifyOf,modified.call.id);assert.equal(verified.call.verified,false);
  step('separate-native-readback-confirms-requested-value',{before:original.name,expected:testName,actual:verified.data.name,call:verified.call,comparisonPassed:true});
  report.stage='precondition-rejection';
  const precondition=await probe('jlceda_call',{path:'invoke',documentTabId,input:{code:modifyCode},purpose:'modify'});assert.equal(precondition.isError,true);assert.match(JSON.stringify(precondition.content),/PRECONDITION_CHANGED/);assert.equal((await invoke(readOne(original.id))).data.name,testName);
  step('stale-original-value-fails-and-does-not-repeat-modification');
  report.stage='restore';
  const restored=await invoke(`await eda.sch_PrimitiveComponent.modify(${JSON.stringify(original.id)},{name:${JSON.stringify(original.name)}});return true;`,'modify');
  const restoredRead=await invoke(readOne(original.id),'verify',restored.call.id);assert.equal(restoredRead.data.name,original.name);changed=false;
  const saved=await invoke('return await eda.sch_Document.save();','save');assert.equal(saved.data,true);report.restored=true;
  step('restore-original-attribute-and-native-save-return-true',{value:restoredRead.data.name,saveReturned:saved.data,persistenceIndependentlyVerified:false});
  report.stage='native-timeout';
  const timedOut=await probe('jlceda_call',{path:'invoke',documentTabId,input:{timeout:50,code:'await new Promise(r=>setTimeout(r,500));return true;'},purpose:'query'});
  assert.equal(timedOut.isError,true);assert.match(JSON.stringify(timedOut.content),/OUTCOME_UNKNOWN/);
  const afterTimeout=await probe('jlceda_context');assert.equal(afterTimeout.isError,false);assert.equal(afterTimeout.value.lastCall.status,'outcome-unknown');
  const timeoutId=afterTimeout.value.lastCall.id;await delay(550);
  const recovered=await invoke(readOne(original.id),'verify',timeoutId);assert.equal(recovered.data.name,original.name);
  step('native-REQUEST_TIMEOUT-is-unknown-and-followed-by-independent-readback',{callId:timeoutId,recoveryCall:recovered.call});
  report.stage='health-UI';
  await waitFor(()=>evaluate(guest,'document.querySelector("[data-jlc-mcp]")?.getAttribute("data-jlc-mcp")==="connected"'));
  const healthLabel=await evaluate(guest,'document.querySelector("[data-jlc-mcp]").getAttribute("aria-label")');assert.match(healthLabel,/MCP 已连接/);
  step('UI-displays-actual-MCP-and-EDA-version',{label:healthLabel});
  report.stage='real-transport-loss';
  const before=hostState();assert.equal(before.execPath,path.join(root,'lab/client/lceda-pro.exe'));assert.equal(before.mcp.endpoint,before.endpoint);assert.ok(before.mcp.pid&&before.mcp.pid!==owner);
  await evaluate(guest,'(()=>{window.__JLC_HEALTH_TRANSITIONS__=[];const node=document.querySelector("[data-jlc-mcp]");window.__JLC_HEALTH_OBSERVER__=new MutationObserver(()=>window.__JLC_HEALTH_TRANSITIONS__.push({state:node.getAttribute("data-jlc-mcp"),text:node.innerText}));window.__JLC_HEALTH_OBSERVER__.observe(node,{attributes:true,childList:true,subtree:true});return true;})()');
  process.kill(before.mcp.pid);
  await waitFor(()=>evaluate(guest,'window.__JLC_HEALTH_TRANSITIONS__.some(x=>x.state==="disconnected")'));
  await waitFor(()=>hostState().mcp.generation>before.mcp.generation&&hostState().mcp.bridgeHealthy);
  await waitFor(()=>evaluate(guest,'document.querySelector("[data-jlc-mcp]")?.getAttribute("data-jlc-mcp")==="connected"'));
  const transitions=await evaluate(guest,'(()=>{window.__JLC_HEALTH_OBSERVER__.disconnect();return window.__JLC_HEALTH_TRANSITIONS__;})()');
  assert.equal((await invoke(readOne(original.id))).data.name,original.name);
  step('real-stdio-process-loss-updates-UI-and-reconnects-with-same-target',{transitions,generation:hostState().mcp.generation});
  report.stage='layout';
  for(const width of [380,720,1447]){
    await setFrameViewport(editor,width,900);await delay(180);
    const layout=await evaluate(guest,'(()=>{const c=document.querySelector("[data-jlc-binding]"),m=c.querySelector("[data-jlc-mcp]"),i=document.querySelector("[data-composer-card]");return {card:c.closest("header").getBoundingClientRect().toJSON(),mcp:m.getBoundingClientRect().toJSON(),input:i.getBoundingClientRect().toJSON(),width:innerWidth}})()');
    assert.ok(layout.card.bottom+3<=layout.input.top);assert.ok(layout.card.left>=0&&layout.card.right<=width+1);assert.ok(layout.mcp.top>=layout.card.top&&layout.mcp.bottom<=layout.card.bottom);
    const image=await captureFrame(editor);fs.writeFileSync(path.join(root,'evidence',`phase2-mcp-${width}.png`),Buffer.from(image.data,'base64'));
    step(`MCP-status-layout-${width}`,layout);
  }
  await clearFrameViewport(editor);
  report.stage='target-switch';
  await openTree('[node-type="101"] [data-test="PCB"]');
  await waitFor(()=>evaluate(guest,`window.jlcEDAContext.select(${JSON.stringify(conversationId)}).then(x=>x.state==='bound'&&x.target.documentTabId!==${JSON.stringify(documentTabId)}).catch(()=>false)`));
  const blocked=await probe('jlceda_call',{path:'invoke',documentTabId,input:{code:'throw Error("MUST_NOT_RUN");'},purpose:'modify'});assert.equal(blocked.isError,true);assert.match(JSON.stringify(blocked.content),/DOCUMENT_CHANGED/);
  const activePrompt=await request(pipe+'-dsh-test',{action:'prompt',conversationId});const activeLive=JSON.parse(activePrompt.contexts[0].text.split('\n').slice(1).join('\n'));assert.equal(activeLive.state,'bound');assert.notEqual(activeLive.target.documentTabId,documentTabId);
  step('project-conversation-follows-active-document-and-blocks-old-operation-stamp');
  report.passed=true;
}catch(error){report.passed=false;report.error=error.stack;process.exitCode=1;console.error(error);}
finally{
  if(changed&&original&&session){try{await mcp.command('invoke',{session:session.sessionId,code:`await eda.dmt_EditorControl.openDocument(${JSON.stringify(documentId)});await eda.sch_PrimitiveComponent.modify(${JSON.stringify(original.id)},{name:${JSON.stringify(original.name)}});return await eda.sch_Document.save();`});report.emergencyRestored=true;}catch(error){report.restoreError=error.message;}}
  if(editor)await clearFrameViewport(editor).catch(()=>{});
  for(const c of clients)c.close();await mcp.close();fs.writeFileSync(path.join(root,'evidence/eda-roundtrip-regression.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,steps:report.steps.length,error:report.error}));
}})();
