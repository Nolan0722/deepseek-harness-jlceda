'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createPlan,applyPlan}=require('./patch-client.cjs');
const root=path.resolve(__dirname,'..'),lab=path.join(root,'lab'),setup=path.join(lab,'setup'),cache=path.join(root,'.cache/setup');
const digest=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function inside(parent,child){const relative=path.relative(parent,child);return !!relative&&!relative.startsWith('..')&&!path.isAbsolute(relative);}
function sourceFiles(directory){
  const result=[];
  function visit(folder){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,entry.name),relative=path.relative(directory,file);
    if(fs.lstatSync(file).isSymbolicLink())throw Error('Client source contains a redirected entry: '+relative);
    if(entry.name.startsWith('.')||/\.log$/i.test(entry.name)||(folder===directory&&/^(profile|userdata|logs?|cache|temp)$/i.test(entry.name)))continue;
    if(entry.isDirectory())visit(file);else if(entry.isFile())result.push({path:relative,sha256:digest(file)});
  }}visit(directory);return result.sort((a,b)=>a.path.localeCompare(b.path));
}
function verifySource(record){const actual=sourceFiles(record.path);if(JSON.stringify(actual)!==JSON.stringify(record.files))throw Error('Source client files changed during setup; inspect lab/setup/install.json');return actual.length;}
function removeStaging(directory){const resolved=path.resolve(directory);if(!inside(cache,resolved)||!/^client-|^previous-/.test(path.basename(resolved)))throw Error('Refusing cleanup outside generated setup directories');if(fs.existsSync(resolved)&&fs.realpathSync.native(resolved).toLowerCase()!==resolved.toLowerCase())throw Error('Refusing redirected setup cleanup');fs.rmSync(resolved,{recursive:true,force:true});}
function prepare(source){
  source=fs.realpathSync.native(path.resolve(source));
  if(source.toLowerCase()===root.toLowerCase()||inside(source,root)||inside(root,source))throw Error('Provide an external, unpatched client installation; source and project must not overlap');
  for(const relative of ['','.cache','.cache/setup','lab','lab/setup','lab/client','evidence']){const folder=path.join(root,relative);if(fs.existsSync(folder)&&fs.realpathSync.native(folder).toLowerCase()!==folder.toLowerCase())throw Error('Refusing redirected setup directory: '+relative);}
  fs.mkdirSync(setup,{recursive:true});fs.mkdirSync(cache,{recursive:true});fs.mkdirSync(path.join(root,'evidence'),{recursive:true});
  const target=path.join(lab,'client'),recordFile=path.join(setup,'install.json');
  if(fs.existsSync(target)&&!fs.existsSync(recordFile))throw Error('Existing lab/client is not managed by setup; use a fresh checkout directory');
  const completion=path.join(setup,'complete.json'),priorCompletion=fs.existsSync(completion)?fs.readFileSync(completion):null;
  console.log('Analyzing client capabilities; no version number is required.');
  const plan=createPlan(source),files=sourceFiles(source),record={path:source,files};
  const staging=path.join(cache,'client-'+crypto.randomUUID()),previous=path.join(cache,'previous-'+crypto.randomUUID());fs.mkdirSync(staging);
  let promoted=false,backedUp=false;
  try{
    for(const file of files){const to=path.join(staging,file.path);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(path.join(source,file.path),to);if(digest(to)!==file.sha256)throw Error('Client changed while being copied: '+file.path);}
    const patch=applyPlan(plan,staging);verifySource(record);
    if(fs.existsSync(completion))fs.unlinkSync(completion);
    if(fs.existsSync(target)){fs.renameSync(target,previous);backedUp=true;}
    fs.renameSync(staging,target);promoted=true;
    fs.writeFileSync(recordFile,JSON.stringify({schemaVersion:1,date:new Date().toISOString(),projectRoot:root,source:record,client:patch,credentialsImported:false},null,2));
    if(backedUp)removeStaging(previous);
    console.log(`Independent client prepared: ${plan.info.version}; ${files.length} source files verified unchanged.`);
  }catch(error){if(backedUp&&!promoted)fs.renameSync(previous,target);if(!promoted&&priorCompletion)fs.writeFileSync(completion,priorCompletion);throw error;}
  finally{if(fs.existsSync(staging))removeStaging(staging);}
}
if(require.main===module){try{
  if(process.argv[2]==='--verify-source'){const record=JSON.parse(fs.readFileSync(path.join(setup,'install.json'),'utf8'));console.log('Source client files unchanged: '+verifySource(record.source));}
  else if(process.argv[2]==='--complete'){
    for(const file of ['JLCEDA-DSH.exe','lab/tls/cert.pem','lab/tls/key.pem','runtime/node_modules/@deepseek-ai/dsh/lib/bin.js','evidence/dsh-embed-build.json','evidence/dsh-sidebar-build.json'])if(!fs.existsSync(path.join(root,file)))throw Error('Incomplete setup: '+file);
    fs.writeFileSync(path.join(setup,'complete.json'),JSON.stringify({schemaVersion:1,date:new Date().toISOString(),node:process.version,credentialsImported:false},null,2));console.log('Setup artifacts verified.');
    const failure=path.join(setup,'failure.json');if(fs.existsSync(failure))fs.unlinkSync(failure);
  }
  else if(process.argv[2])prepare(process.argv[2]);else throw Error('Provide the client installation directory');
}catch(error){fs.mkdirSync(setup,{recursive:true});fs.writeFileSync(path.join(setup,'failure.json'),JSON.stringify({date:new Date().toISOString(),message:error.message},null,2));console.error(error.stack);process.exitCode=1;}}
module.exports={prepare,sourceFiles,verifySource};
