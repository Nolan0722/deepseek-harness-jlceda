'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),cache=path.join(root,'.cache');fs.mkdirSync(cache,{recursive:true});
const fixture=fs.mkdtempSync(path.join(cache,'setup-safety-')),fakeClient=path.join(fixture,'provided-client');fs.mkdirSync(fakeClient);fs.writeFileSync(path.join(fakeClient,'lceda-pro.exe'),'read-only fixture');
const powershell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),report={date:new Date().toISOString(),steps:[]};
try{
  const project=path.join(fixture,'project');fs.mkdirSync(project);fs.copyFileSync(path.join(root,'setup.ps1'),path.join(project,'setup.ps1'));
  const other=path.join(fixture,'other');fs.mkdirSync(other);fs.writeFileSync(path.join(other,'marker'),'untouched');fs.symlinkSync(other,path.join(project,'.tools'),'junction');
  const result=spawnSync(powershell,['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(project,'setup.ps1'),'-ClientPath',fakeClient],{windowsHide:true,encoding:'utf8',timeout:10000});
  assert.notEqual(result.status,0);assert.match(result.stderr,/Refusing redirected setup path/);assert.deepEqual(fs.readdirSync(other),['marker']);assert.equal(fs.readFileSync(path.join(other,'marker'),'utf8'),'untouched');
  report.steps.push({name:'redirected-dependency-directory-is-refused-before-npm-or-source-copy'});fs.unlinkSync(path.join(project,'.tools'));report.passed=true;
}catch(error){report.passed=false;report.error=error.stack;console.error(error);process.exitCode=1;}
finally{fs.mkdirSync(path.join(root,'evidence'),{recursive:true});fs.writeFileSync(path.join(root,'evidence/setup-safety.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
