'use strict';
const fs=require('node:fs'),path=require('node:path'),https=require('node:https'),assert=require('node:assert/strict');
const {targets,connect}=require('./cdp.cjs');
const {McpTransport}=require('../host/mcp-transport.cjs');
const root=path.resolve(__dirname,'..'),owner=Number(process.argv[2]),delay=ms=>new Promise(r=>setTimeout(r,ms));
const report={date:new Date().toISOString(),owner,steps:[],computerUseUsed:false,modelRequests:0};
const mcp=new McpTransport(path.join(root,'lab/client/lceda-pro.exe'),path.join(root,'lab/profile'),path.join(root,'lab'));
let editor,frame,sessionId,originalWidth;
async function evaluate(c,expression){const r=await c.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function waitFor(fn){const end=Date.now()+30000;while(Date.now()<end){const value=await fn();if(value)return value;await delay(100);}throw Error('DOM layer wait timed out: '+report.stage);}
function step(name,details={}){report.steps.push({name,...details});console.log(name);}
async function click(selector){
  const p=await waitFor(()=>evaluate(editor,`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e?.checkVisibility())return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`));
  await editor.call('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});
  await editor.call('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});
}
async function key(key,code=key){await editor.call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:key==='Escape'?27:undefined});await editor.call('Input.dispatchKeyEvent',{type:'keyUp',key,code});}
async function screenshot(file){const png=await editor.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(root,'evidence',file),Buffer.from(png.data,'base64'));}
function get(url){return new Promise((resolve,reject)=>{const req=https.get(url,{ca:fs.readFileSync(path.join(root,'lab/tls/cert.pem'))},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode,headers:res.headers}));});req.on('error',reject);req.setTimeout(5000,()=>req.destroy(Error('TLS request timeout')));});}
async function overlap(selector){
  return evaluate(editor,`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),f=document.querySelector('#jlc-dsh-frame');if(!e?.checkVisibility()||!f?.checkVisibility())return null;let opacity=1;for(let n=e;n;n=n.parentElement)opacity*=Number(getComputedStyle(n).opacity);if(opacity<.999)return null;const a=e.getBoundingClientRect(),b=f.getBoundingClientRect(),x1=Math.max(a.left,b.left),x2=Math.min(a.right,b.right),y1=Math.max(a.top,b.top),y2=Math.min(a.bottom,b.bottom);if(x2<=x1||y2<=y1)return null;const point={x:(x1+x2)/2,y:(y1+y2)/2},top=document.elementFromPoint(point.x,point.y);return {rect:a.toJSON(),frame:b.toJSON(),point,topIsOverlay:e===top||e.contains(top),topTag:top?.tagName,topClass:top?.className};})()`);
}
// Native modal registration and layout settle asynchronously. Geometry alone
// does not establish that the modal has entered its final stacking position.
async function paintedOverlay(selector){return waitFor(async()=>{const value=await overlap(selector);report.lastOverlay=value;return value?.topIsOverlay?value:false;});}
async function largeSidebar(){
  await evaluate(editor,'window.__JLC_DSH_DEBUG__.resize(innerWidth*.7)');
  await waitFor(()=>evaluate(editor,'(()=>{const r=document.querySelector("#jlc-dsh-frame").getBoundingClientRect();return r.left<innerWidth*.4&&r.width>innerWidth*.6;})()'));
}
(async()=>{try{
  const state=JSON.parse(fs.readFileSync(path.join(root,'lab',`host-state-${owner}.json`)));assert.equal(state.embedding,'sandboxed-iframe');
  const sessions=(await mcp.command('session.list')).filter(s=>s.status==='alive'&&!s.headless);
  const selected=sessions.find(s=>s.renderId===2)||sessions[0];assert.ok(selected);sessionId=selected.sessionId;
  for(const t of(await targets()).filter(t=>t.type==='page'&&t.url.startsWith('https://client/editor'))){const c=await connect(t);if(await evaluate(c,'window.electronAPI.getWinId()')===selected.renderId){editor=c;break;}c.close();}
  assert.ok(editor);await evaluate(editor,'window.electronAPI.focusWindow()');
  frame=await waitFor(async()=>{for(const t of(await targets()).filter(t=>t.type==='iframe'&&t.url.startsWith(state.dshOrigin))){const c=await connect(t);try{const current=await evaluate(c,'window.jlcEDAContext?.current()');if(current?.windowId===selected.renderId&&await evaluate(c,'!!window.__JLC_DSH_CONTEXT_TEST__'))return c;}catch{}c.close();}return false;});
  const original=await evaluate(editor,'window.__JLC_DSH_DEBUG__.state()');originalWidth=original.layout.right.right;
  await evaluate(editor,'(async()=>{const d=window.__JLC_DSH_DEBUG__;if(d.state().activeTab!=="jlc-dsh")d.select("jlc-dsh");if(!d.state().visible)await d.collapse(false);await d.resize(innerWidth*.7);})()');
  await largeSidebar();
  const topology=await evaluate(editor,'(()=>{const f=document.querySelector("#jlc-dsh-frame");return {count:document.querySelectorAll("#jlc-dsh-frame").length,tag:f.tagName,parent:f.parentElement.id,panel:f.closest("#jlc-dsh")?.id,sandbox:f.sandbox.value,origin:new URL(f.src).origin};})()');assert.equal(topology.count,1);assert.equal(topology.tag,'IFRAME');assert.equal(topology.parent,'jlc-dsh-slot');assert.equal(topology.panel,'jlc-dsh');assert.equal(topology.origin,state.dshOrigin);
  step('DSH-is-one-DOM-iframe-inside-the-native-sidebar',topology);
  const isolation=await evaluate(frame,'({node:typeof require,electron:typeof window.electronAPI,hostPreload:typeof window.jlcDSH,parentAccess:(()=>{try{void parent.document;return "allowed"}catch(e){return e.name}})(),topNavigationSandboxed:!frameElement})');assert.equal(isolation.node,'undefined');assert.equal(isolation.electron,'undefined');assert.equal(isolation.hostPreload,'undefined');assert.equal(isolation.parentAccess,'SecurityError');step('same-origin-and-preload-isolation-enforced',isolation);
  const denied=await get(state.dshOrigin+'/');assert.equal(denied.status,401);assert.equal(denied.headers['content-security-policy'],'frame-ancestors https://client');assert.equal(denied.headers['cross-origin-embedder-policy'],'require-corp');
  // Never record cookie names or values. The actual UI must also receive live
  // session updates; the existing workspace regression checks that separately.
  const allCookies=(await editor.call('Network.getCookies',{urls:[state.dshOrigin]})).cookies;
  const authenticated=allCookies.find(c=>c.httpOnly&&c.secure&&c.sameSite==='None');assert.ok(authenticated,'A signed browser session uses a Secure HttpOnly cookie');
  step('TLS-authentication-and-browser-cookie-retained',{unauthenticatedStatus:denied.status,frameAncestors:denied.headers['content-security-policy'],secure:true,httpOnly:true,sameSite:authenticated.sameSite});
  await waitFor(()=>evaluate(frame,'!!document.querySelector("[data-jlc-conversation]")&&document.querySelector("[data-jlc-binding]").getAttribute("data-jlc-binding")==="bound"'));
  const identity=await evaluate(frame,'(window.__JLC_DOM_ID__=crypto.randomUUID(),{marker:window.__JLC_DOM_ID__,conversationId:document.querySelector("[data-jlc-conversation]").getAttribute("data-jlc-conversation")})');
  await evaluate(editor,'(()=>{window.__JLC_LAYER_VISIBILITY__=[];window.__JLC_LAYER_OBSERVER__=new MutationObserver(()=>window.__JLC_LAYER_VISIBILITY__.push(window.__JLC_DSH_DEBUG__.state().visible));for(const id of ["jlc-dsh-frame","jlc-dsh-slot","jlc-dsh","layoutRight"])window.__JLC_LAYER_OBSERVER__.observe(document.getElementById(id),{attributes:true,attributeFilter:["class","style","hidden"]});})()');
  report.stage='confirmation';
  await mcp.command('invoke',{session:sessionId,code:'eda.sys_Dialog.showConfirmationMessage("弹窗应完整显示在 DSH 侧栏之上。","DSH DOM 层级回归","确认测试","取消测试");return true;'});
  const confirmation='#extapiDialogConfirmationMessageDlg_dialog_box';const confirmationOverlap=await paintedOverlay(confirmation);assert.equal(confirmationOverlap.topIsOverlay,true);
  assert.equal(await evaluate(editor,'window.__JLC_DSH_DEBUG__.state().visible'),true);await screenshot('dom-confirmation-over-dsh.png');step('real-EDA-confirmation-renders-over-visible-DSH',confirmationOverlap);
  const cancel=confirmation+' [data-test="取消测试"]';assert.ok(await overlap(cancel),'Cancel button overlaps the actual DSH region');await click(cancel);await waitFor(()=>evaluate(editor,`!document.querySelector(${JSON.stringify(confirmation)})?.checkVisibility()`));step('overlapping-dialog-button-receives-pointer-and-closes');
  report.stage='input';
  await mcp.command('invoke',{session:sessionId,code:'eda.sys_Dialog.showInputDialog("自动化验证焦点与键盘输入","","DSH 输入回归","text","初始值");return true;'});
  const inputDialog=await waitFor(()=>evaluate(editor,'[...document.querySelectorAll("[class*=lc_modal_dialog_box]")].find(e=>e.checkVisibility()&&e.innerText.includes("DSH 输入回归"))?.id'));
  await paintedOverlay('#'+inputDialog);
  const inputSelector='#'+inputDialog+' input';await click(inputSelector);await evaluate(editor,`document.querySelector(${JSON.stringify(inputSelector)}).select()`);await editor.call('Input.insertText',{text:'自动化回归输入'});assert.equal(await evaluate(editor,`document.querySelector(${JSON.stringify(inputSelector)}).value`),'自动化回归输入');
  await screenshot('dom-input-over-dsh.png');step('real-EDA-input-dialog-receives-focus-and-text');
  const closeInput='#'+inputDialog+' [data-test="close"]';await click(closeInput);await waitFor(()=>evaluate(editor,`!document.getElementById(${JSON.stringify(inputDialog)})?.checkVisibility()`));
  const visibility=await evaluate(editor,'(window.__JLC_LAYER_OBSERVER__.disconnect(),window.__JLC_LAYER_VISIBILITY__)');assert.ok(visibility.every(Boolean));assert.equal(await evaluate(frame,'window.__JLC_DOM_ID__'),identity.marker);step('dialogs-do-not-hide-reload-or-recreate-the-DSH-frame',{visibilityChanges:visibility.length});
  report.stage='menu';
  // A document enables the complete native menu bar, including Help at the
  // right. Open an existing page only; no design mutation is made here.
  const activeDocument=await mcp.command('invoke',{session:sessionId,code:'const p=await eda.dmt_Project.getCurrentProjectInfo();const id=p?.data?.find(x=>x.schematic)?.schematic?.page?.[0]?.uuid;if(id)await eda.dmt_EditorControl.openDocument(id);return await eda.dmt_SelectControl.getCurrentDocumentInfo();'});
  assert.ok(activeDocument?.tabId);
  // The API returns before the home menu is replaced by the document menu.
  // Measure Help only after the full menu exists; its old coordinate points
  // at Layout once Edit/Place/Design entries are inserted.
  await waitFor(()=>evaluate(editor,`window.__JLC_DSH_READ_CONTEXT__().editorTabId===${JSON.stringify(activeDocument.tabId)}&&!!document.querySelector("[data-test=Edit]")?.checkVisibility()`));
  await largeSidebar();
  await click('[data-test="Help"]');
  const menuItem=await waitFor(()=>evaluate(editor,'[...document.querySelectorAll("[data-test]")].filter(e=>e.checkVisibility()&&e.getBoundingClientRect().top>30&&/关于/.test(e.innerText)&&e.children.length<2).map(e=>({test:e.getAttribute("data-test"),text:e.innerText,tag:e.tagName}))[0]'));
  const itemSelector='[data-test='+JSON.stringify(menuItem.test)+']';const menuOverlap=await paintedOverlay(itemSelector);assert.equal(menuOverlap.topIsOverlay,true);assert.equal(await evaluate(editor,'window.__JLC_DSH_DEBUG__.state().visible'),true);
  await screenshot('dom-menu-over-dsh.png');step('real-EDA-menu-renders-over-visible-DSH',{menuItem,...menuOverlap});
  await key('Escape');await waitFor(()=>evaluate(editor,`!document.querySelector(${JSON.stringify(itemSelector)})?.checkVisibility()`));step('native-menu-keyboard-dismissal-works');
  report.stage='sidebar-switch';
  for(let n=0;n<3;n++){
    await evaluate(editor,'window.__JLC_DSH_DEBUG__.select("multi-attr")');await waitFor(()=>evaluate(editor,'!window.__JLC_DSH_DEBUG__.state().visible'));
    await evaluate(editor,'window.__JLC_DSH_DEBUG__.select("jlc-dsh")');await waitFor(()=>evaluate(editor,'window.__JLC_DSH_DEBUG__.state().visible'));
  }
  assert.equal(await evaluate(frame,'window.__JLC_DOM_ID__'),identity.marker);assert.equal(await evaluate(frame,'document.querySelector("[data-jlc-conversation]").getAttribute("data-jlc-conversation")'),identity.conversationId);step('properties-and-DSH-switch-without-frame-or-conversation-recreation',{cycles:3});
  await evaluate(editor,'window.__JLC_DSH_DEBUG__.collapse(true)');await waitFor(()=>evaluate(editor,'!window.__JLC_DSH_DEBUG__.state().visible'));
  await evaluate(editor,'window.__JLC_DSH_DEBUG__.collapse(false)');await waitFor(()=>evaluate(editor,'window.__JLC_DSH_DEBUG__.state().visible'));assert.equal(await evaluate(frame,'window.__JLC_DOM_ID__'),identity.marker);step('collapse-and-restore-preserve-the-iframe');
  report.passed=true;
}catch(error){report.passed=false;report.error=error.stack;process.exitCode=1;console.error(error);
  if(editor){report.visibleDialogs=await evaluate(editor,'[...document.querySelectorAll("[class*=lc_modal_dialog_box]")].filter(e=>e.checkVisibility()).map(e=>({id:e.id,text:e.innerText.slice(0,250)}))').catch(()=>null);await screenshot('dom-layers-failure.png').catch(()=>{});}
}finally{
  if(editor){await evaluate(editor,'window.__JLC_LAYER_OBSERVER__?.disconnect()').catch(()=>{});if(originalWidth)await evaluate(editor,`window.__JLC_DSH_DEBUG__.resize(${originalWidth})`).catch(()=>{});editor.close();}
  frame?.close();await mcp.close();fs.writeFileSync(path.join(root,'evidence/dom-layers-regression.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,steps:report.steps.length,error:report.error}));
}})();
