'use strict';
const path=require('node:path'),{spawnSync}=require('node:child_process');
// Windows ACL sandbox provisioning needs WRITE_OWNER on each newly created temp child.
// Keep Electron's paths unchanged; DSH receives its own private, inheritable temp root.
function prepareDshTemp(profile){
  const powershell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
  const result=spawnSync(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'create-dsh-temp.ps1'),'-Profile',profile],{windowsHide:true,encoding:'utf8',timeout:30000});
  if(result.error||result.status!==0)throw Error('DSH private temp preparation failed: '+(result.error?.message||result.stderr));
  const value=JSON.parse(result.stdout.replace(/^\uFEFF/,''));
  if(path.resolve(value.path).toLowerCase()!==path.join(path.resolve(profile),'dsh-temp').toLowerCase()||!value.inheritableFullControl)throw Error('Unexpected DSH private temp directory');
  return value.path;
}
module.exports={prepareDshTemp};
