const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {connect,targets}=require('./cdp.cjs');
const root=path.resolve(__dirname,'..');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  let target;
  const readyDeadline=Date.now()+30000;
  while(!target&&Date.now()<readyDeadline){target=(await targets()).find(t=>t.type==='page' && t.url.startsWith('https://client/editor') && t.title.includes('示例工程'));if(!target)await delay(200);}
  assert.ok(target,'Example project must be open in isolated client');
  const client=await connect(target);
  await client.call('Page.bringToFront');
  const report={date:new Date().toISOString(),target:target.id,steps:[]};
  async function evaluate(expression){const result=await client.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
  async function state(){return evaluate('window.__JLC_DSH_DEBUG__.state()');}
  const winId=await evaluate('window.electronAPI.getWinId()');
  const hostFile=path.join(root,'lab',`host-state-${Number(process.argv[2])}.json`);
  assert.ok(fs.existsSync(hostFile),'Pass current isolated owner PID as first argument');
  async function embeddedState(){
    const deadline=Date.now()+20000;
    while(Date.now()<deadline){
      const host=JSON.parse(fs.readFileSync(hostFile,'utf8'));
      const win=host.windows.find(w=>w.id===winId);
      if(host.status.phase==='ready'&&host.embedding==='sandboxed-iframe'&&win?.frameReady)return win;
      await delay(100);
    }
    throw Error('Embedded iframe readiness assertion timed out');
  }
  async function waitFor(predicate){const deadline=Date.now()+20000;while(Date.now()<deadline){const value=await state();if(predicate(value))return value;await delay(200);}throw Error('Sidebar assertion timed out');}
  async function step(name,expression,predicate){await evaluate(expression);const value=await waitFor(predicate);const visible=value.visible; const embedded=await embeddedState(); report.steps.push({name,activeTab:value.activeTab,mode:value.mode,rect:value.rect,visible,embedded,error:value.error});assert.equal(value.error,null);}
  async function openDocument(selector,clickCount=2){
    const point=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Document element absent');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await client.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount});
    await client.call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount});
  }
  try{
    await step('select-dsh','(async()=>{const d=window.__JLC_DSH_DEBUG__;if(d.state().activeTab!=="jlc-dsh")d.select("jlc-dsh");if(!d.state().layout.right.open)await d.collapse(false);})()',s=>s.activeTab==='jlc-dsh'&&s.visible);
    await step('resize-520','window.__JLC_DSH_DEBUG__.resize(520)',s=>s.rect.width>450&&s.rect.width<530&&s.visible);
    await step('collapse','window.__JLC_DSH_DEBUG__.collapse(true)',s=>!s.visible);
    await step('restore','window.__JLC_DSH_DEBUG__.collapse(false)',s=>s.visible);
    await step('properties','window.__JLC_DSH_DEBUG__.select("multi-attr")',s=>s.activeTab==='multi-attr'&&!s.visible);
    await step('back-to-dsh','window.__JLC_DSH_DEBUG__.select("jlc-dsh")',s=>s.activeTab==='jlc-dsh'&&s.visible);
    // Selector was inspected in the actual isolated application's document tree.
    await openDocument('[node-type="101"] [data-test="PCB"]');
    await step('pcb-document','true',s=>String(s.mode)==='3'&&s.activeTab==='jlc-dsh'&&s.visible);
    if(!await evaluate('!!document.querySelector("[node-type=\\"7\\"] [data-test=\\"1. P1\\"]")')) {
      await openDocument('[node-type="6"] [data-test="波形产生与变换"]');
      const deadline=Date.now()+20000;
      while(!await evaluate('!!document.querySelector("[node-type=\\"7\\"] [data-test=\\"1. P1\\"]")')) {
        assert.ok(Date.now()<deadline,'Schematic page did not load');
        await delay(200);
      }
    }
    await openDocument('[node-type="7"] [data-test="1. P1"]');
    await step('schematic-document','true',s=>String(s.mode)==='1'&&s.activeTab==='jlc-dsh'&&s.visible);
    await openDocument('[data-tab-key="tab_page1"]',1);
    await step('home-document','true',s=>String(s.mode)==='-1'&&s.activeTab==='jlc-dsh'&&s.visible);
    await step('home-collapse','window.__JLC_DSH_DEBUG__.collapse(true)',s=>!s.visible);
    await step('home-restore','window.__JLC_DSH_DEBUG__.collapse(false)',s=>s.visible);
    report.passed=true;
  }catch(error){report.passed=false;report.error=String(error);report.lastState=await state().catch(()=>null);process.exitCode=1;}
  finally{client.close();fs.writeFileSync(path.join(root,'evidence/sidebar-regression.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
})().catch(error=>{console.error(error);process.exitCode=1;});
