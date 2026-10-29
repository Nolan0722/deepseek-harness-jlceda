'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {targets,connect}=require('./cdp.cjs'),{setFrameViewport,clearFrameViewport,captureFrame}=require('./frame-test.cjs');
const root=path.resolve(__dirname,'..'),owner=Number(process.argv[2]),delay=ms=>new Promise(r=>setTimeout(r,ms));
const report={date:new Date().toISOString(),owner,steps:[],modelRequests:0,computerUseUsed:false};
const clients=[];let frame,editor,wasDark,preview=false;
async function evaluate(c,expression){const r=await c.call('Runtime.evaluate',{expression:`window.__JLC_BRANDING_PROMISE__=Promise.resolve(${expression})`,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function waitFor(fn){const until=Date.now()+35000;while(Date.now()<until){const r=await fn();if(r)return r;await delay(150);}throw Error('Branding test timed out: '+report.stage);}
function step(name,data={}){report.steps.push({name,...data});console.log(name);}
async function controls(){return evaluate(frame,'({expand:document.querySelectorAll("[data-sidebar-right-expand]").length,collapse:document.querySelectorAll("[data-sidebar-right-toggle]").length,toggleCommand:window.__JLC_DSH_CONTEXT_TEST__.ui().commands.includes("sidebar.right.toggle")})');}
(async()=>{try{
  const host=JSON.parse(fs.readFileSync(path.join(root,'lab',`host-state-${owner}.json`)));
  for(const t of(await targets()).filter(t=>t.type==='page'&&t.url.startsWith('https://client/editor'))){const c=await connect(t);clients.push(c);if(await evaluate(c,'window.electronAPI.getWinId()')===2){editor=c;break;}}assert.ok(editor);
  frame=await waitFor(async()=>{for(const t of(await targets()).filter(t=>t.type==='iframe'&&t.url.startsWith(host.dshOrigin))){const c=await connect(t);clients.push(c);if(await evaluate(c,'!!window.__JLC_DSH_CONTEXT_TEST__')&&(await evaluate(c,'window.jlcEDAContext.current()')).windowId===2)return c;}return false;});
  assert.equal(await evaluate(editor,'document.querySelector("#jlc-dsh-frame").title'),'JLCEDA Agent');
  await evaluate(frame,'window.__JLC_DSH_CONTEXT_TEST__.create()');await waitFor(()=>evaluate(frame,'document.querySelector("[data-jlc-binding]")?.dataset.jlcBinding==="bound"'));
  const missing=await controls();assert.deepEqual(missing,{expand:0,collapse:0,toggleCommand:false});step('generic-right-sidebar-controls-and-shortcut-removed',missing);
  const gear=await evaluate(frame,'(()=>{const b=document.querySelector("[data-jlc-settings]");return {label:b.getAttribute("aria-label"),kind:b.dataset.jlcSettingsIcon,viewBox:b.querySelector("svg")?.getAttribute("viewBox"),paths:b.querySelectorAll("svg path").length,rectangles:b.querySelectorAll("svg rect").length};})()');assert.equal(gear.label,'设置');assert.equal(gear.kind,'gear');assert.equal(gear.viewBox,'0 0 16 16');assert.ok(gear.paths>=2);assert.equal(gear.rectangles,0);step('settings-use-native-gear-artwork-and-settings-label',gear);
  await setFrameViewport(editor,720,820);await delay(250);
  await waitFor(()=>evaluate(frame,'document.querySelector("[data-jlc-brand]")?.textContent==="JLCEDA Agent"&&document.querySelector("[data-jlc-history]")?.checkVisibility()'));assert.ok(await evaluate(frame,'document.body.innerText.includes("JLCEDA Agent")'));assert.equal(await evaluate(frame,'document.querySelector("button[aria-label=打开侧边栏]")?.checkVisibility()??false'),false);step('sidebar-hidden-and-conversation-name-remains-JLCEDA-Agent');
  wasDark=await evaluate(frame,'document.body.hasAttribute("data-ds-dark-theme")');
  for(const dark of [false,true]){
    await evaluate(frame,`document.body.toggleAttribute("data-ds-dark-theme",${dark})`);
    const color=await evaluate(frame,'(()=>{const s=getComputedStyle(document.body),send=document.querySelector("button[aria-label=发送消息]");return {brand:s.getPropertyValue("--dsw-alias-brand-primary").trim(),business:s.getPropertyValue("--dsw-alias-state-business-primary").trim(),info:s.getPropertyValue("--dsw-alias-button-info-fill").trim(),primary:s.getPropertyValue("--dsw-alias-button-primary-fill").trim(),send:send?getComputedStyle(send).backgroundColor:null};})()');
    for(const key of ['brand','business','info','primary'])assert.equal(color[key],'#5588ff');assert.equal(color.send,'rgb(85, 136, 255)');step('requested-accent-applies-to-'+(dark?'dark':'light')+'-theme',color);
  }
  await evaluate(frame,`document.body.toggleAttribute("data-ds-dark-theme",${wasDark})`);
  for(const width of [360,440,720]){
    report.stage='viewport '+width;await setFrameViewport(editor,width,820);await delay(250);assert.deepEqual(await controls(),missing);
    const layout=await evaluate(frame,'(()=>{const r=document.querySelector("[data-composer-card]").getBoundingClientRect();return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,left:r.left,right:r.right};})()');assert.ok(layout.scrollWidth<=width+1);assert.ok(layout.left>=0&&layout.right<=width+1);
    const shot=await captureFrame(editor);fs.writeFileSync(path.join(root,'evidence',`jlceda-agent-${width}.png`),Buffer.from(shot.data,'base64'));step('branding-and-control-removal-fit-'+width,layout);
  }
  report.stage='preview';await evaluate(frame,'window.__JLC_DSH_CONTEXT_TEST__.openGuidePreview()');preview=true;
  await waitFor(()=>evaluate(frame,'!!document.querySelector("[data-sidebar-right-open]")'));assert.deepEqual(await controls(),missing);step('native-preview-controller-remains-available-without-toggle-controls');
  await evaluate(frame,'window.__JLC_DSH_CONTEXT_TEST__.closeGuidePreview()');preview=false;await waitFor(()=>evaluate(frame,'!document.querySelector("[data-sidebar-right-open]")'));assert.deepEqual(await controls(),missing);step('closing-preview-does-not-restore-expand-button');report.passed=true;
}catch(error){report.passed=false;report.error=error.stack;process.exitCode=1;console.error(error);}
finally{
  if(frame){if(preview)await evaluate(frame,'window.__JLC_DSH_CONTEXT_TEST__.closeGuidePreview()').catch(()=>{});if(wasDark!==undefined)await evaluate(frame,`document.body.toggleAttribute("data-ds-dark-theme",${wasDark})`).catch(()=>{});}
  if(editor)await clearFrameViewport(editor).catch(()=>{});clients.forEach(c=>c.close());fs.writeFileSync(path.join(root,'evidence/branding-regression.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,steps:report.steps.length,error:report.error}));
}})();
