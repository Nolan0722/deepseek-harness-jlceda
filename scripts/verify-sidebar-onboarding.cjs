'use strict';
// A separate credential-free DSH profile with the actual project plugin. The
// parent-frame fixture supplies an empty editor context; it never calls EDA.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('../.tools/node_modules/playwright-core');
const {sidebarProfile}=require('../host/sidebar-profile.cjs');
const root=path.resolve(__dirname,'..'),home=fs.mkdtempSync(path.join(root,'lab/sidebar-onboarding-'));
const report={date:new Date().toISOString(),home,steps:[],modelRequests:0,computerUseUsed:false};
const node=path.join(root,'.tools/node_modules/node-win-x64/bin/node.exe');let child,browser;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn){const end=Date.now()+60000;while(Date.now()<end){const r=await fn();if(r)return r;await delay(200);}throw Error('Fresh onboarding timed out');}
function step(name){report.steps.push({name});console.log(name);}
(async()=>{try{
  const profile=path.join(home,'profiles/web');fs.mkdirSync(profile,{recursive:true});
  fs.writeFileSync(path.join(profile,'package.json'),JSON.stringify({name:'dsh-profile-web',private:true,dependencies:{},dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']}}}));fs.writeFileSync(path.join(profile,'cordis.yml'),'[]');
  const overlay=path.join(home,'sidebar.json');fs.writeFileSync(overlay,JSON.stringify([...sidebarProfile(),{id:'webserver',config:{host:'127.0.0.1',port:0,tls:{certFile:path.join(root,'lab/tls/cert.pem'),keyFile:path.join(root,'lab/tls/key.pem')}}},{id:'ui-settings-models',config:{credentialOnboarding:true}},{insert:[{id:'jlc-context',name:path.join(root,'plugins/jlc-context/index.cjs'),config:{pipe:'unused-onboarding-fixture'}}]}]));
  assert.equal(fs.existsSync(path.join(home,'.credentials.yaml')),false);
  const env={...process.env,DSH_HOME:home,PATH:path.dirname(node)+';'+process.env.PATH};for(const key of Object.keys(env))if(/KEY|PASSWORD|SECRET|TOKEN/i.test(key))delete env[key];delete env.ELECTRON_RUN_AS_NODE;
  child=spawn(node,[path.join(root,'runtime/node_modules/@deepseek-ai/dsh/lib/bin.js'),'web','--patch',overlay,'--host','127.0.0.1','--port','0','--no-open'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let url,log='';const receive=data=>{log=(log+data).slice(-12000);url=log.match(/https:\/\/127\.0\.0\.1:\d+\/[^\s\x1b]*[?&]token=[A-Za-z0-9._~%-]+/)?.[0];};child.stdout.on('data',receive);child.stderr.on('data',receive);
  await waitFor(()=>{if(child.exitCode!==null)throw Error('Fresh DSH failed: '+log.replace(/([?&]token=)[^\s]+/g,'$1[REDACTED]'));return url;});
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu'],});
  const outer=await browser.newPage({viewport:{width:440,height:820},ignoreHTTPSErrors:true});let modelRequests=0;
  // Chromium requires explicit permission for this HTTPS parent fixture to
  // embed a loopback server. This affects only the disposable browser context.
  await outer.context().grantPermissions(['local-network-access'],{origin:'https://client'});
  report.browserErrors=[];
  outer.on('console',message=>{if(message.type()==='error')report.browserErrors.push(message.text().replace(/([?&]token=)[^\s"<>]+/g,'$1[REDACTED]'));});
  outer.on('pageerror',error=>report.browserErrors.push(error.message));
  outer.on('request',req=>{if(/\/chat\/completions|\/responses(?:\?|$)/.test(req.url()))modelRequests++;});
  await outer.route('https://client/slot-regression',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><style>body{margin:0}iframe{width:100vw;height:100vh;border:0}</style><script>
    addEventListener('message',event=>{
      const frame=document.querySelector('iframe'),m=event.data;
      if(event.source!==frame.contentWindow||event.origin!==${JSON.stringify(new URL(url).origin)}||m?.channel!=='jlc-dsh-frame-v1'||m.type!=='request')return;
      const target={windowId:1,projectId:null,documentId:null,workspaceDirectory:null};
      const value=m.action==='ready'?{debug:true}:m.action==='current'?target:m.action==='health'?{phase:'disconnected',bridgeHealthy:false}:{state:'unavailable',target};
      event.source.postMessage({channel:m.channel,type:'response',id:m.id,ok:true,value},event.origin);
    });</script><iframe src=${JSON.stringify(url)}></iframe>`}));
  await outer.goto('https://client/slot-regression');
  const failedFrame=outer.frames().find(frame=>frame.url().startsWith('chrome-error:'));
  if(failedFrame)throw Error('The browser could not load the local DSH iframe: '+(await failedFrame.locator('body').innerText()).replace(/([?&]token=)[^\s"<>]+/g,'$1[REDACTED]'));
  const page=await waitFor(()=>outer.frames().find(frame=>frame.url().startsWith(new URL(url).origin)));
  await page.getByRole('button',{name:'添加 API Key',exact:true}).waitFor({timeout:30000});
  assert.ok(await page.getByRole('button',{name:'登录',exact:true}).isVisible());
  step('first-configuration-retains-both-model-sign-in-and-API-key-entry');
  const overrides=await page.evaluate(()=>window.__JLC_DSH_CONTEXT_TEST__.slotOverrides());
  assert.equal(overrides.length,6);assert.ok(overrides.every(entry=>entry.originalRegistered&&entry.active&&entry.winners===1));
  step('upstream-occupants-still-registered-and-native-priority-selects-project-occupants');
  await page.getByRole('button',{name:'添加 API Key',exact:true}).click();
  await page.locator('input[type=password]').waitFor();
  const visible=await page.locator('body').innerText();assert.ok(!visible.includes('预览版'));assert.ok(!visible.includes('插件管理'));
  assert.ok(await page.locator('input').count()>0);assert.ok(await page.locator('input[type=password]').count()>0);
  step('credential-free-profile-opens-real-model-credential-editor-without-preview-notice');
  await outer.screenshot({path:path.join(root,'evidence/sidebar-first-model-440.png')});
  // Dismiss the credential step without submitting anything, then exercise the persistent settings route.
  const dismiss=page.getByRole('button',{name:/稍后|跳过|取消|关闭/}).first();await dismiss.click();
  await page.locator('[data-jlc-settings]').click();
  await page.getByRole('button',{name:'模型',exact:true}).click();
  await page.getByRole('button',{name:'添加模型提供商',exact:false}).waitFor();
  step('model-settings-remain-reachable-after-skipping-first-configuration');
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  // Re-enter a fresh document: completing the preview step must not leave the
  // coordinator stuck or write a fake acknowledgement into native settings.
  await page.goto(url);
  await page.getByRole('button',{name:'添加 API Key',exact:true}).waitFor({timeout:30000});
  assert.equal(await page.getByRole('button',{name:'我已了解',exact:true}).count(),0);
  step('reload-skips-preview-and-still-reaches-native-credential-onboarding');
  assert.equal(modelRequests,0);report.modelRequests=modelRequests;step('no-model-request-and-no-credential-submission');report.passed=true;
}catch(error){report.passed=false;report.error=error.stack;process.exitCode=1;console.error(error);
  if(browser){const page=browser.contexts()[0]?.pages()[0];if(page){report.visibleText=(await page.locator('body').innerText()).slice(0,3000);await page.screenshot({path:path.join(root,'evidence/sidebar-onboarding-failure.png')});}}
}finally{
  await browser?.close();if(child&&child.exitCode===null){child.kill();await new Promise(resolve=>{child.once('exit',resolve);setTimeout(resolve,5000);});}
  fs.writeFileSync(path.join(root,'evidence/sidebar-onboarding-regression.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,steps:report.steps.length,error:report.error}));
}})();
