'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {targets,connect}=require('./cdp.cjs'),{setFrameViewport,clearFrameViewport,captureFrame}=require('./frame-test.cjs');
const {request}=require('../plugins/jlc-context/index.cjs');
const root=path.resolve(__dirname,'..'),owner=Number(process.argv[2]),delay=ms=>new Promise(r=>setTimeout(r,ms));
const report={date:new Date().toISOString(),owner,steps:[],modelRequests:0,computerUseUsed:false};
const clients=[];let frame,editor,wasDark;
async function evaluate(c,expression){const r=await c.call('Runtime.evaluate',{expression:`Promise.resolve(${expression})`,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function waitFor(fn){const end=Date.now()+35000;while(Date.now()<end){const value=await fn();if(value)return value;await delay(150);}throw Error('Theme/preset test timed out: '+report.stage);}
function step(name,data={}){report.steps.push({name,...data});console.log(name);}
async function section(label){await evaluate(frame,`[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);}
async function close(){await evaluate(frame,'[...document.querySelectorAll("[role=dialog] button")].find(b=>b.textContent.trim()==="关闭")?.click()');await waitFor(()=>evaluate(frame,'!document.querySelector("[role=dialog]")'));}
function expectedIcon(name){return require("./fixtures/native-settings-icons.json")[name];}
async function binding(){return evaluate(frame,'(()=>{const b=document.querySelector("[data-jlc-binding]");return {conversation:b?.dataset.jlcConversation,project:b?.dataset.jlcProject,binding:b?.dataset.jlcBinding,current:window.__JLC_DSH_CONTEXT_TEST__.project().current};})()');}
(async()=>{try{
  const host=JSON.parse(fs.readFileSync(path.join(root,'lab',`host-state-${owner}.json`)));
  for(const t of(await targets()).filter(t=>t.type==='page'&&t.url.startsWith('https://client/editor'))){const c=await connect(t);clients.push(c);if(await evaluate(c,'window.electronAPI.getWinId()')===2){editor=c;break;}}assert.ok(editor);
  frame=await waitFor(async()=>{for(const t of(await targets()).filter(t=>t.type==='iframe'&&t.url.startsWith(host.dshOrigin))){const c=await connect(t);clients.push(c);if(await evaluate(c,'!!window.__JLC_DSH_CONTEXT_TEST__')&&(await evaluate(c,'window.jlcEDAContext.current()')).windowId===2)return c;}return false;});
  await close();await setFrameViewport(editor,720,820);await waitFor(()=>evaluate(frame,'innerWidth===720'));await delay(250);
  assert.equal(await evaluate(editor,'document.querySelector("[title=Agent]")?.textContent'),'Agent');step('native-EDA-tab-uses-short-Agent-label');
  await evaluate(frame,'window.__JLC_DSH_CONTEXT_TEST__.create()');await waitFor(()=>evaluate(frame,'document.querySelector("[data-jlc-binding]")?.dataset.jlcBinding==="bound"'));
  await evaluate(frame,'(()=>{if(document.querySelector("button[aria-label=打开侧边栏]"))window.__JLC_DSH_CONTEXT_TEST__.toggleNavigation();})()');
  await waitFor(()=>evaluate(frame,'!!document.querySelector("[class*=folderActive] svg")'));
  wasDark=await evaluate(frame,'document.body.hasAttribute("data-ds-dark-theme")');
  for(const dark of [false,true]){
    await evaluate(frame,`document.body.toggleAttribute('data-ds-dark-theme',${dark})`);
    const colors=await evaluate(frame,`(()=>{const value=token=>{const d=document.createElement('span');d.style.color='var('+token+')';document.body.appendChild(d);const c=getComputedStyle(d).color;d.remove();return c;};const folder=document.querySelector('[class*=folderActive] svg');return {scale:[50,100,200,300,400,450,500,600,800,900].map(n=>value('--dsw-static-deepseek-'+n)),bubble:value('--dsw-specific-bubble-highlight'),folder:getComputedStyle(folder).color,paths:[...folder.querySelectorAll('[fill=currentColor]')].map(p=>({fill:getComputedStyle(p).fill,opacity:getComputedStyle(p).opacity})),gradient:getComputedStyle(document.body).getPropertyValue('--dsw-gradient-onboarding-blue-stops').trim(),ansi:value('--dsw-static-blue-500')};})()`);
    assert.equal(colors.folder,'rgb(85, 136, 255)');assert.ok(colors.paths.every(p=>p.fill==='rgb(85, 136, 255)'));assert.ok(colors.paths.some(p=>p.opacity==='0.16'));assert.ok(colors.scale.every(c=>c!=='rgb(0, 0, 0)'));assert.equal(colors.scale[6],'rgb(85, 136, 255)');if(!dark)assert.equal(colors.bubble,colors.scale[2]);assert.notEqual(colors.scale[0],colors.scale[9]);assert.notEqual(colors.ansi,colors.scale[6]);assert.ok(!/#3964fe|#398efe|#6dccff/i.test(colors.gradient));
    step('derived-palette-highlight-and-folder-artwork-'+(dark?'dark':'light'),colors);
  }
  await evaluate(frame,`document.body.toggleAttribute('data-ds-dark-theme',${wasDark})`);
  await evaluate(frame,'(()=>{const transfer=new DataTransfer();transfer.items.add(new File(["theme preview"],"theme-probe.txt",{type:"text/plain"}));document.dispatchEvent(new DragEvent("dragenter",{bubbles:true,cancelable:true,dataTransfer:transfer}));})()');
  await waitFor(()=>evaluate(frame,'!!document.querySelector("#dshDropOverlayClip")'));
  const drop=await evaluate(frame,'[...document.querySelector("#dshDropOverlayClip").closest("svg").querySelectorAll("rect")].map(e=>({fill:e.getAttribute("fill"),computed:getComputedStyle(e).fill}))');
  assert.ok(drop.some(p=>p.fill==='var(--dsw-alias-brand-primary)'&&p.computed==='rgb(85, 136, 255)'));assert.ok(drop.some(p=>p.fill==='var(--dsw-static-deepseek-400)'));assert.ok(drop.some(p=>p.fill==='#9CE5ED'));
  await evaluate(frame,'window.dispatchEvent(new DragEvent("dragend"))');await waitFor(()=>evaluate(frame,'!document.querySelector("#dshDropOverlayClip")'));step('real-attachment-drag-decoration-follows-brand-without-uploading',{drop});
  await evaluate(frame,'document.querySelector("[data-jlc-settings]").click()');await waitFor(()=>evaluate(frame,'!!document.querySelector("[role=dialog]")'));
  const icons=await evaluate(frame,'Object.fromEntries(["插件","自动化任务","Agent 预设"].map(label=>{const b=[...document.querySelectorAll("[role=dialog] button")].find(b=>b.textContent.trim()===label);return [label,[...b.querySelectorAll("svg path")].map(p=>p.getAttribute("d"))];}))');
  assert.deepEqual(icons['插件'],expectedIcon('IconPluginPinwheelOutlineArtwork'));assert.deepEqual(icons['自动化任务'],expectedIcon('IconClockOutlineArtwork'));assert.ok(icons['Agent 预设'].length);step('settings-use-original-plugin-clock-and-preset-icons');
  await section('插件');await waitFor(()=>evaluate(frame,'document.querySelectorAll("[data-plugin-item]").length>=4'));
  const art=await evaluate(frame,'[...document.querySelectorAll("[data-plugin-item]")].map(e=>({id:e.dataset.pluginItem,colors:[...e.querySelectorAll("svg [fill],svg [stroke],svg stop")].map(p=>({fill:p.getAttribute("fill"),stroke:p.getAttribute("stroke"),stop:p.getAttribute("stop-color"),computedFill:getComputedStyle(p).fill,computedStroke:getComputedStyle(p).stroke}))}))');
  assert.ok(art.some(e=>e.colors.some(c=>c.fill?.includes('--dsw-alias-brand-primary'))));assert.ok(art.some(e=>e.colors.some(c=>c.stroke?.includes('--dsw-static-deepseek-400'))));assert.ok(!JSON.stringify(art).match(/#679EFE|#4561EE|#658EFF|#69B9FF|#324DE2/i));step('native-plugin-artwork-uses-brand-palette',{art});
  await section('Agent 预设');await waitFor(()=>evaluate(frame,'!!document.querySelector("[data-agent-preset-id=standard]")'));
  const presets=await evaluate(frame,'[...document.querySelectorAll("[data-agent-preset-id]")].map(e=>({id:e.dataset.agentPresetId,label:e.innerText}))');assert.ok(presets.some(p=>p.id==='ptc'));step('original-agent-presets-settings-roster-restored',{presets});
  for(const width of [360,440,720]){
    await setFrameViewport(editor,width,820);await waitFor(()=>evaluate(frame,`innerWidth===${width}`));await delay(200);
    const geometry=await evaluate(frame,'(()=>{const d=document.querySelector("[role=dialog]"),r=d.getBoundingClientRect();return {left:r.left,right:r.right,scroll:d.scrollWidth,width:d.clientWidth,cards:document.querySelectorAll("[data-agent-preset-id]").length};})()');assert.ok(geometry.left>=-1&&geometry.right<=width+1);assert.ok(geometry.scroll<=geometry.width+1);
    fs.writeFileSync(path.join(root,'evidence',`agent-presets-${width}.png`),Buffer.from((await captureFrame(editor)).data,'base64'));step('native-preset-settings-fit-'+width,geometry);
  }
  await close();await setFrameViewport(editor,720,820);await delay(250);
  const before=await binding();assert.equal(before.binding,'bound');
  report.stage='preset menu';await waitFor(()=>evaluate(frame,'!![...document.querySelectorAll("button[title]")].find(b=>b.title==="选择新任务使用的 Agent 预设")'));
  await evaluate(frame,'[...document.querySelectorAll("button[title]")].find(b=>b.title==="选择新任务使用的 Agent 预设").click()');
  const menu=await waitFor(()=>evaluate(frame,'(()=>{const m=document.querySelector("[role=menu]");return m&&[...m.querySelectorAll("[role=menuitem],[role=menuitemradio]")].map(e=>({text:e.textContent,selected:e.getAttribute("aria-checked")}));})()'));
  assert.ok(menu.some(e=>e.text.includes('PTC')));step('original-conversation-preset-selector-restored',{menu});
  await evaluate(frame,'[...document.querySelectorAll("[role=menu] [role=menuitem],[role=menu] [role=menuitemradio]")].find(e=>e.textContent.includes("PTC")).click()');
  await waitFor(()=>evaluate(frame,'[...document.querySelectorAll("button[title]")].find(b=>b.title==="选择新任务使用的 Agent 预设")?.textContent.includes("PTC")'));
  const after=await waitFor(async()=>{const b=await binding();return b.binding==='bound'&&b;});assert.equal(after.project,before.project);assert.equal(after.current.windowId,before.current.windowId);assert.equal(after.current.workspaceDirectory,before.current.workspaceDirectory);
  const workspace=await request(host.contextPipe+'-dsh-test',{conversationId:after.conversation,action:'workspace'});assert.equal(workspace.cwd.toLowerCase(),before.current.workspaceDirectory.toLowerCase());
  const prompt=await request(host.contextPipe+'-dsh-test',{conversationId:after.conversation,action:'prompt'});
  const live=JSON.parse(prompt.contexts.find(c=>c.name==='jlceda:live').text.split('\n').slice(1).join('\n'));
  assert.equal(live.state,'bound');assert.equal(live.target.projectId,before.project);assert.equal(live.target.windowId,before.current.windowId);assert.equal(live.mcp.bridgeHealthy,true);
  step('switching-preset-preserves-window-project-directory-and-live-MCP-context',{before,after,workspace});
  const context=await request(host.contextPipe+'-dsh-test',{conversationId:after.conversation,action:'context-via-presented-tools'});
  assert.ok(!context.isError,JSON.stringify(context));
  assert.equal(context.value.sandbox.mode,'workspace-write');
  step('PTC-preset-executes-bound-native-context-through-run-code');
  await evaluate(frame,'[...document.querySelectorAll("button[title]")].find(b=>b.title==="选择新任务使用的 Agent 预设").click()');await waitFor(()=>evaluate(frame,'!!document.querySelector("[role=menu]")'));await evaluate(frame,'[...document.querySelectorAll("[role=menu] [role=menuitem],[role=menu] [role=menuitemradio]")].find(e=>e.textContent.startsWith("标准模式")).click()');await waitFor(()=>evaluate(frame,'[...document.querySelectorAll("button[title]")].find(b=>b.title==="选择新任务使用的 Agent 预设")?.textContent.includes("标准模式")'));
  const standard=await binding(),readback=await request(host.contextPipe+'-dsh-test',{conversationId:standard.conversation,action:'context-via-presented-tools'});assert.ok(!readback.isError,JSON.stringify(readback));step('standard-preset-restored-and-native-MCP-context-readback-passes-without-model-submissions');
  for(const entry of ['preset-settings','plugin-manager']){
    const previous=await binding();await evaluate(frame,'document.querySelector("[data-jlc-settings]").click()');await waitFor(()=>evaluate(frame,'!!document.querySelector("[role=dialog]")'));
    if(entry==='preset-settings'){
      await section('Agent 预设');await waitFor(()=>evaluate(frame,'[...document.querySelectorAll("[role=dialog] button")].some(b=>b.textContent.trim()==="让 Agent 帮我创建预设模式")'));
      await evaluate(frame,'[...document.querySelectorAll("[role=dialog] button")].find(b=>b.textContent.trim()==="让 Agent 帮我创建预设模式").click()');
    }else{
      await section('插件');await waitFor(()=>evaluate(frame,'!!document.querySelector("[data-jlc-plugin-manager-settings]")'));
      await evaluate(frame,'document.querySelector("[data-jlc-plugin-manager-settings] [aria-haspopup=menu]").click()');
      await waitFor(()=>evaluate(frame,'[...document.querySelectorAll("[role=menu] button")].some(b=>!b.disabled&&b.textContent.includes("让 Agent 创建插件"))'));
      await evaluate(frame,'[...document.querySelectorAll("[role=menu] button")].find(b=>b.textContent.includes("让 Agent 创建插件")).click()');
    }
    await waitFor(()=>evaluate(frame,'!document.querySelector("[role=dialog]")'));
    const creator=await waitFor(async()=>{const b=await binding();return b.binding==='bound'&&b.conversation!==previous.conversation&&b;});
    await waitFor(()=>evaluate(frame,'[...document.querySelectorAll("button[title]")].find(b=>b.title==="选择新任务使用的 Agent 预设")?.textContent.includes("创造模式")'));
    const cwd=await request(host.contextPipe+'-dsh-test',{conversationId:creator.conversation,action:'workspace'});assert.equal(creator.project,previous.project);assert.equal(creator.current.windowId,previous.current.windowId);assert.equal(cwd.cwd.toLowerCase(),previous.current.workspaceDirectory.toLowerCase());step('native-creator-entry-preserves-explicit-preset-and-project-'+entry,{creator,cwd});
    await evaluate(frame,'window.__JLC_DSH_CONTEXT_TEST__.create()');await waitFor(async()=>{const b=await binding();return b.binding==='bound'&&b.conversation!==creator.conversation;});
  }
  report.passed=true;
}catch(error){report.passed=false;report.error=error.stack;console.error(error);process.exitCode=1;}
finally{if(frame){await evaluate(frame,'window.dispatchEvent(new DragEvent("dragend"))').catch(()=>{});if(wasDark!==undefined)await evaluate(frame,`document.body.toggleAttribute('data-ds-dark-theme',${wasDark})`).catch(()=>{});}if(editor)await clearFrameViewport(editor).catch(()=>{});clients.forEach(c=>c.close());fs.writeFileSync(path.join(root,'evidence/theme-presets-regression.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,steps:report.steps.length,error:report.error}));}})();
