'use strict';
// A separate credential-free DSH profile; never edits the user's model configuration.
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
  for(const name of ['package.json','cordis.yml'])fs.copyFileSync(path.join(root,'lab/dsh-home/profiles/web',name),path.join(profile,name));
  const overlay=path.join(home,'sidebar.json');fs.writeFileSync(overlay,JSON.stringify([...sidebarProfile(),{id:'directory-picker',disabled:true},{insert:[{id:'directory-picker-browse',name:'@deepseek-ai/dsh-host-directory-picker-browse'},{id:'ui-directory-picker-browse',name:'@deepseek-ai/dsh-client-ui-directory-picker-browse'}]},{id:'webserver',config:{host:'127.0.0.1',port:0,tls:{certFile:path.join(root,'lab/tls/cert.pem'),keyFile:path.join(root,'lab/tls/key.pem')}}},{id:'ui-settings-models',config:{credentialOnboarding:true}}]));
  assert.equal(fs.existsSync(path.join(home,'.credentials.yaml')),false);
  const env={...process.env,DSH_HOME:home,PATH:path.dirname(node)+';'+process.env.PATH};for(const key of Object.keys(env))if(/KEY|PASSWORD|SECRET|TOKEN/i.test(key))delete env[key];delete env.ELECTRON_RUN_AS_NODE;
  child=spawn(node,[path.join(root,'runtime/node_modules/@deepseek-ai/dsh/lib/bin.js'),'web','--patch',overlay,'--host','127.0.0.1','--port','0','--no-open'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let url,log='';const receive=data=>{log=(log+data).slice(-12000);url=log.match(/https:\/\/127\.0\.0\.1:\d+\/[^\s\x1b]*[?&]token=[A-Za-z0-9._~%-]+/)?.[0];};child.stdout.on('data',receive);child.stderr.on('data',receive);
  await waitFor(()=>{if(child.exitCode!==null)throw Error('Fresh DSH failed: '+log.replace(/([?&]token=)[^\s]+/g,'$1[REDACTED]'));return url;});
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu'],});
  const page=await browser.newPage({viewport:{width:440,height:820},ignoreHTTPSErrors:true});let modelRequests=0;
  page.on('request',req=>{if(/\/chat\/completions|\/responses(?:\?|$)/.test(req.url()))modelRequests++;});
  await page.goto(url);
  await page.getByRole('button',{name:'添加 API Key',exact:true}).waitFor({timeout:30000});
  assert.ok(await page.getByRole('button',{name:'登录',exact:true}).isVisible());
  step('first-configuration-retains-both-model-sign-in-and-API-key-entry');
  await page.getByRole('button',{name:'添加 API Key',exact:true}).click();
  await page.locator('input[type=password]').waitFor();
  const visible=await page.locator('body').innerText();assert.ok(!visible.includes('预览版'));assert.ok(!visible.includes('插件管理'));
  assert.ok(await page.locator('input').count()>0);assert.ok(await page.locator('input[type=password]').count()>0);
  step('credential-free-profile-opens-real-model-credential-editor-without-preview-notice');
  await page.screenshot({path:path.join(root,'evidence/sidebar-first-model-440.png')});
  // Dismiss the credential step without submitting anything, then exercise the persistent settings route.
  const dismiss=page.getByRole('button',{name:/稍后|跳过|取消|关闭/}).first();await dismiss.click();
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('button',{name:'模型',exact:true}).click();
  await page.getByRole('button',{name:'添加模型提供商',exact:false}).waitFor();
  step('model-settings-remain-reachable-after-skipping-first-configuration');
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.setViewportSize({width:1000,height:820});
  await page.getByRole('button',{name:'打开侧边栏',exact:true}).click();
  const selected=await page.evaluate(()=>localStorage.getItem('dsh.sessions.current'));
  assert.ok(selected,'A current conversation exists before adding a workspace');
  await page.getByRole('button',{name:'添加工作区',exact:true}).click();
  const picker=page.getByRole('dialog',{name:'选择工作区目录'});await picker.waitFor();
  await picker.getByRole('button',{name:'编辑路径',exact:true}).click();
  await picker.getByRole('textbox',{name:'编辑路径',exact:true}).fill(path.join(root,'lab/phase3-fixture/project-B'));
  await picker.getByRole('textbox',{name:'编辑路径',exact:true}).press('Enter');
  await picker.getByRole('textbox',{name:'编辑路径',exact:true}).waitFor({state:'hidden'});
  await picker.getByRole('button',{name:'打开',exact:true}).click();
  await picker.waitFor({state:'hidden'});
  await page.getByText('project-B',{exact:true}).first().waitFor();
  assert.equal(await page.evaluate(()=>localStorage.getItem('dsh.sessions.current')),selected);
  await page.screenshot({path:path.join(root,'evidence/sidebar-add-workspace-1000.png')});
  step('add-workspace-folder-button-registers-directory-without-changing-current-conversation');
  assert.equal(modelRequests,0);report.modelRequests=modelRequests;step('no-model-request-and-no-credential-submission');report.passed=true;
}catch(error){report.passed=false;report.error=error.stack;process.exitCode=1;console.error(error);
  if(browser){const page=browser.contexts()[0]?.pages()[0];if(page){report.visibleText=(await page.locator('body').innerText()).slice(0,3000);await page.screenshot({path:path.join(root,'evidence/sidebar-onboarding-failure.png')});}}
}finally{
  await browser?.close();if(child&&child.exitCode===null){child.kill();await new Promise(resolve=>{child.once('exit',resolve);setTimeout(resolve,5000);});}
  fs.writeFileSync(path.join(root,'evidence/sidebar-onboarding-regression.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,steps:report.steps.length,error:report.error}));
}})();
