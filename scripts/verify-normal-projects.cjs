'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {McpTransport}=require('../host/mcp-transport.cjs');
const root=path.resolve(__dirname,'..'),owner=Number(process.argv[2]),delay=ms=>new Promise(r=>setTimeout(r,ms));
const report={date:new Date().toISOString(),owner,steps:[],computerUseUsed:false,modelRequests:0};
const stateFile=path.join(root,'lab',`host-state-${owner}.json`),canonical=p=>p.replaceAll('\\','/').toLowerCase();
const mcp=new McpTransport(path.join(root,'lab/client/lceda-pro.exe'),path.join(root,'lab/profile'),path.join(root,'lab'));
let opened;
async function close(){if(!opened)return;await mcp.command('session.close',{session:opened.sessionId,destroy:true});opened=null;}
function step(name,details={}){report.steps.push({name,...details});console.log(name);}
(async()=>{try{
  assert.equal(await fetch('http://127.0.0.1:9431/json/list',{signal:AbortSignal.timeout(1000)}).then(()=>true,()=>false),false,'Normal regression must run without CDP');
  assert.equal(JSON.parse(fs.readFileSync(stateFile)).embedding,'sandboxed-iframe');
  for(const [format,relative] of [['eprj2','lab/phase2-fixture/DSH读写闭环.eprj2'],['eprj3','lab/eprj3-fixture/中文工程 带空格']]){
    const file=path.join(root,relative),directory=fs.statSync(file).isDirectory()?file:path.dirname(file);
    const expected=JSON.parse(fs.readFileSync(path.join(root,'lab/project-bindings.json'))).bindings.find(b=>canonical(b.target.projectPath||'')===canonical(file))?.target.projectId;
    assert.ok(expected,'Functional regression must have established the fixture identity first');
    opened=await mcp.command('open',{path:file});
    const actual=await mcp.command('invoke',{session:opened.sessionId,timeout:5000,code:'const p=await eda.dmt_Project.getCurrentProjectInfo();return {uuid:p?.uuid,documentId:p?.data?.find(x=>x.schematic)?.schematic?.page?.[0]?.uuid};'});
    assert.equal(actual.uuid,expected);assert.ok(actual.documentId);step(format+'-normal-open-immediately-returns-real-project',{projectId:actual.uuid});
    let bound=false;const deadline=Date.now()+30000;
    while(Date.now()<deadline){
      const window=JSON.parse(fs.readFileSync(stateFile)).windows.find(w=>w.id===opened.renderId);
      const anchor=JSON.parse(fs.readFileSync(path.join(root,'lab/project-bindings.json'))).bindings.find(b=>b.conversationId===window?.conversationId);
      if(window?.frameReady&&anchor?.target.projectId===expected&&canonical(anchor.target.workspaceDirectory)===canonical(directory)){bound=true;break;}
      await delay(200);
    }
    assert.equal(bound,true);step(format+'-normal-DSH-frame-establishes-correct-project-and-directory');
    await close();opened=await mcp.command('open',{path:file});
    const restored=await mcp.command('invoke',{session:opened.sessionId,timeout:5000,code:`await eda.dmt_EditorControl.openDocument(${JSON.stringify(actual.documentId)});const p=await eda.dmt_Project.getCurrentProjectInfo();const d=await eda.dmt_SelectControl.getCurrentDocumentInfo();return {projectId:p?.uuid,documentId:d?.uuid};`});
    assert.equal(restored.projectId,expected);assert.equal(restored.documentId,actual.documentId);step(format+'-normal-close-reopen-and-document-restore');await close();
  }
  report.passed=true;
}catch(error){report.passed=false;report.error=error.stack;process.exitCode=1;console.error(error);}
finally{await close().catch(()=>{});await mcp.close();fs.writeFileSync(path.join(root,'evidence/normal-projects-regression.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,steps:report.steps.length,error:report.error}));}})();
