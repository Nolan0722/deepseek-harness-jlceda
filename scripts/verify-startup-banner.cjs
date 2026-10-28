'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {targets,connect}=require('./cdp.cjs'),{McpTransport}=require('../host/mcp-transport.cjs');
const root=path.resolve(__dirname,'..'),owner=Number(process.argv[2]),delay=ms=>new Promise(r=>setTimeout(r,ms));
const report={date:new Date().toISOString(),owner,steps:[],computerUseUsed:false,modelRequests:0};
const stateFile=path.join(root,'lab',`host-state-${owner}.json`),mcp=new McpTransport(path.join(root,'lab/client/lceda-pro.exe'),path.join(root,'lab/profile'),path.join(root,'lab'));
let opened,editor;
async function evaluate(c,expression){const r=await c.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function waitFor(fn){const end=Date.now()+35000;while(Date.now()<end){const r=await fn();if(r)return r;await delay(150);}throw Error('Startup banner wait timed out');}
async function findEditor(id){return waitFor(async()=>{for(const t of(await targets()).filter(t=>t.type==='page'&&t.url.startsWith('https://client/editor'))){const c=await connect(t);if(await evaluate(c,'window.electronAPI.getWinId()')===id)return c;c.close();}return false;});}
async function check(name,id){
  editor=await findEditor(id);await evaluate(editor,'window.electronAPI.focusWindow()');
  await waitFor(()=>{const s=JSON.parse(fs.readFileSync(stateFile));return s.status.phase==='ready'&&s.windows.some(w=>w.id===id&&w.frameReady&&w.conversationId);});
  const value=await waitFor(()=>evaluate(editor,'(()=>{const s=document.querySelector("#jlc-dsh-startup"),f=document.querySelector("#jlc-dsh-frame"),slot=document.querySelector("#jlc-dsh-slot");if(!s||!f||!slot)return null;const a=s.getBoundingClientRect(),b=f.getBoundingClientRect(),c=slot.getBoundingClientRect();return getComputedStyle(s).display==="none"&&!s.checkVisibility()&&a.height===0&&Math.abs(b.top-c.top)<1?{bannerVisible:false,bannerHeight:a.height,topGap:b.top-c.top,status:window.__JLC_DSH_DEBUG__.state().status,iframeCount:document.querySelectorAll("#jlc-dsh-frame").length}:null;})()'));
  assert.equal(value.iframeCount,1);report.steps.push({name,windowId:id,...value});console.log(name);
  if(name==='ready-before-new-window-mount'){
    const image=await editor.call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(root,'evidence/startup-status-ready.png'),Buffer.from(image.data,'base64'));
  }
  editor.close();editor=null;
}
(async()=>{try{
  const first=await waitFor(()=>{try{return JSON.parse(fs.readFileSync(stateFile)).windows.find(w=>w.id===2&&w.frameReady);}catch{return false;}});await check('cold-start-ready-banner-has-no-space',first.id);
  for(let i=0;i<2;i++){
    opened=await mcp.command('open',{path:path.join(root,'lab/phase2-fixture/DSH读写闭环.eprj2')});
    await check(i===0?'ready-before-new-window-mount':'ready-before-reopened-window-mount',opened.renderId);
    await mcp.command('session.close',{session:opened.sessionId,destroy:true});opened=null;
  }
  report.passed=true;
}catch(error){report.passed=false;report.error=error.stack;process.exitCode=1;console.error(error);}
finally{editor?.close();if(opened)await mcp.command('session.close',{session:opened.sessionId,destroy:true}).catch(()=>{});await mcp.close();fs.writeFileSync(path.join(root,'evidence/startup-banner-regression.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,steps:report.steps.length,error:report.error}));}})();
