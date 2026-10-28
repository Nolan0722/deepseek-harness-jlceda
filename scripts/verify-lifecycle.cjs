const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {spawn,execFile}=require('node:child_process');
const {promisify}=require('node:util');
const execute=promisify(execFile);
const root=path.resolve(__dirname,'..');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const report={date:new Date().toISOString(),steps:[]};
const launched=[];
async function processes(){
  const {stdout}=await execute('powershell.exe',['-NoProfile','-Command','@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,@{Name="ConsoleWindowHandle";Expression={if($_.Name -match "^(conhost|cmd|powershell)\\.exe$"){[long](Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).MainWindowHandle}else{0}}}) | ConvertTo-Json -Compress'],{windowsHide:true,maxBuffer:4e6});
  return JSON.parse(stdout);
}
async function family(pid){
  const all=await processes(),ids=new Set([pid]);let changed=true;
  while(changed){changed=false;for(const p of all)if(ids.has(p.ParentProcessId)&&!ids.has(p.ProcessId)){ids.add(p.ProcessId);changed=true;}}
  return all.filter(p=>ids.has(p.ProcessId));
}
async function waitFor(fn,ms=45000){const deadline=Date.now()+ms;while(Date.now()<deadline){const value=await fn();if(value)return value;await delay(250);}throw Error('Lifecycle wait timed out');}
async function launch(debug=false){
  const proc=spawn(path.join(root,'JLCEDA-DSH.exe'),debug?['--debug']:[],{cwd:root,windowsHide:true,stdio:'ignore'});
  launched.push(proc);
  proc.once('exit',code=>{proc.observedExit=code;});
  const owner=await waitFor(async()=> (await family(proc.pid)).find(p=>p.ParentProcessId===proc.pid&&p.ExecutablePath?.toLowerCase()===path.join(root,'lab/client/lceda-pro.exe').toLowerCase()));
  const file=path.join(root,'lab',`host-state-${owner.ProcessId}.json`);
  const state=await waitFor(()=>{try{const s=JSON.parse(fs.readFileSync(file));return s.status.phase==='ready'&&s.mcp.bridgeHealthy&&s.windows.some(w=>w.frameReady&&w.conversationId)&&s;}catch{return false;}});
  assert.equal(state.userData,path.join(root,'lab/profile'));
  assert.equal(state.execPath,path.join(root,'lab/client/lceda-pro.exe'));
  return {proc,owner:owner.ProcessId,state,file};
}
async function checkExit(run,tracked,expected){
  await waitFor(()=>run.proc.observedExit!==undefined,15000);
  if(expected!==undefined)assert.equal(run.proc.observedExit,expected);
  const survivors=await waitFor(async()=>{const live=await processes();const remains=live.filter(p=>tracked.some(t=>t.ProcessId===p.ProcessId));return remains.length===0?{survivors:[]}:false;},15000);
  return {exitCode:run.proc.observedExit,...survivors};
}
async function nodeScript(name,args=[]){return execute(process.execPath,[path.join(root,'scripts',name),...args],{cwd:root,windowsHide:true,maxBuffer:2e6});}
(async()=>{
  assert.ok(!(await processes()).some(p=>p.ExecutablePath?.toLowerCase()===path.join(root,'lab/client/lceda-pro.exe').toLowerCase()),'Close the copied client before lifecycle testing');
  const gui=await launch(true);
  report.steps.push({name:'debug-cold-start',owner:gui.owner,state:gui.state});
  const duplicate=spawn(path.join(root,'JLCEDA-DSH.exe'),[],{cwd:root,windowsHide:true,stdio:'ignore'});
  const duplicateCode=await new Promise((resolve,reject)=>{duplicate.once('error',reject);duplicate.once('exit',resolve);});
  assert.equal(duplicateCode,0);
  const after=JSON.parse(fs.readFileSync(gui.file));assert.equal(after.pid,gui.owner);assert.equal(after.dshPid,gui.state.dshPid);
  report.steps.push({name:'duplicate-launch',exitCode:duplicateCode,owner:after.pid,dshPid:after.dshPid});
  await delay(2000);
  const guiFamily=await family(gui.proc.pid);
  await nodeScript('close-test-windows.cjs');
  report.steps.push({name:'close-all-windows',...(await checkExit(gui,guiFamily,0))});
  const normal=await launch(false);
  const debugOpen=await fetch('http://127.0.0.1:9431/json/list',{signal:AbortSignal.timeout(1500)}).then(()=>true,()=>false);
  assert.equal(debugOpen,false);
  const normalFamily=await family(normal.proc.pid);
  const consoleWindows=normalFamily.filter(p=>p.ConsoleWindowHandle!==0);
  assert.equal(consoleWindows.length,0,'Unexpected visible console window');
  await nodeScript('mcp-probe.cjs',['lab/profile','evidence/mcp-lifecycle-doctor.json','lceda-pro.call',JSON.stringify({path:'doctor'})]);
  await nodeScript('verify-normal-projects.cjs',[String(normal.owner)]);
  report.steps.push({name:'normal-start-no-cdp',owner:normal.owner,dshPid:normal.state.dshPid,debugPortOpen:false,visibleConsoleWindows:0,hiddenConsoleProcesses:normalFamily.filter(p=>/^(conhost|cmd|powershell)\.exe$/i.test(p.Name)).length});
  await nodeScript('mcp-probe.cjs',['lab/profile','evidence/mcp-lifecycle-stop.json','lceda-pro.call',JSON.stringify({path:'stop'})]);
  report.steps.push({name:'mcp-graceful-stop',...(await checkExit(normal,normalFamily,0))});
  const crash=await launch(false),crashFamily=await family(crash.proc.pid);
  process.kill(crash.owner);
  report.steps.push({name:'owner-crash-job-cleanup',...(await checkExit(crash,crashFamily))});
  const final=await launch(false);
  report.steps.push({name:'relaunch-after-crash',owner:final.owner,state:final.state});
  final.proc.unref();
  report.passed=true;
})().catch(error=>{report.passed=false;report.error=String(error);process.exitCode=1;for(const proc of launched)if(proc.exitCode===null){try{proc.kill();}catch{}}}).finally(()=>{
  fs.writeFileSync(path.join(root,'evidence/lifecycle-regression.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:report.passed,error:report.error,steps:report.steps.map(s=>({name:s.name,owner:s.owner,exitCode:s.exitCode,survivors:s.survivors}))},null,2));
});
