'use strict';
const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),owner=Number(process.argv[2]);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const report={date:new Date().toISOString(),owner,modelRequests:0,tests:[]};
async function run(name,args,file,unitChecks=6){
  console.log('start '+name);const log=fs.createWriteStream(path.join(root,'evidence',name+'.log'));
  const child=spawn(process.execPath,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});await new Promise(resolve=>log.end(resolve));
  const result=file?JSON.parse(fs.readFileSync(path.join(root,'evidence',file))):{passed:code===0};
  report.tests.push({name,code,passed:code===0&&result.passed,steps:result.steps?.length??unitChecks,report:file||name+'.log',executionLimitations:result.executionLimitations||[]});
  console.log(JSON.stringify(report.tests.at(-1)));if(code!==0||!result.passed)throw Error(name+' failed; inspect evidence/'+name+'.log');
}
(async()=>{try{
  const end=Date.now()+45000;let ready=false;while(Date.now()<end){try{const state=JSON.parse(fs.readFileSync(path.join(root,'lab',`host-state-${owner}.json`)));ready=state.status.phase==='ready'&&state.windows.some(w=>w.frameReady);if(ready&&await fetch('http://127.0.0.1:9431/json/list').then(r=>r.ok))break;}catch{}await delay(250);}
  if(!ready)throw Error('Isolated debug owner did not become ready');
  await run('phase2-transport',['--test','scripts/verify-mcp-transport.cjs']);
  await run('eprj3-path-unit',['--test','scripts/verify-folder-project.cjs'],undefined,5);
  await run('eprj3-render-ready',['--test','scripts/verify-project-ready.cjs'],undefined,1);
  await run('startup-status-unit',['--test','scripts/verify-startup-status.cjs'],undefined,2);
  await run('project-binding-unit',['--test','scripts/verify-project-binding.cjs'],undefined,8);
  await run('frame-bridge-unit',['--test','scripts/verify-frame-bridge.cjs'],undefined,4);
  await run('dsh-network-unit',['--test','scripts/verify-dsh-network.cjs'],undefined,4);
  await run('startup-banner',['scripts/verify-startup-banner.cjs',String(owner)],'startup-banner-regression.json');
  await run('phase2-workspace',['scripts/verify-workspace-sync.cjs',String(owner)],'workspace-sync-regression.json');
  await run('phase2-binding',['scripts/verify-context-binding.cjs',String(owner)],'context-binding-regression.json');
  await run('phase2-sidebar',['scripts/verify-sidebar.cjs',String(owner)],'sidebar-regression.json');
  await run('phase2-roundtrip',['scripts/verify-eda-roundtrip.cjs',String(owner)],'eda-roundtrip-regression.json');
  await run('eprj3-open-restore',['scripts/verify-eprj3.cjs',String(owner)],'eprj3-regression.json');
  await run('ptc-private-temp',['--test','scripts/verify-dsh-temp.cjs'],undefined,3);
  await run('ptc-mcp',['scripts/verify-ptc-mcp.cjs',String(owner)],'ptc-mcp-regression.json');
  await run('sidebar-profile',['scripts/verify-sidebar-profile.cjs',String(owner)],'sidebar-profile-regression.json');
  await run('branding',['scripts/verify-branding.cjs',String(owner)],'branding-regression.json');
  await run('theme-presets',['scripts/verify-theme-presets.cjs',String(owner)],'theme-presets-regression.json');
  await run('automation-settings',['scripts/verify-automation-settings.cjs',String(owner)],'automation-settings-regression.json');
  await run('sidebar-onboarding',['scripts/verify-sidebar-onboarding.cjs'],'sidebar-onboarding-regression.json');
  await run('dom-layers',['scripts/verify-dom-layers.cjs',String(owner)],'dom-layers-regression.json');
  report.passed=true;
}catch(error){report.passed=false;report.error=error.stack;process.exitCode=1;console.error(error);}finally{fs.writeFileSync(path.join(root,'evidence/phase2-integration.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,tests:report.tests.length,steps:report.tests.reduce((n,t)=>n+t.steps,0)}));}})();
