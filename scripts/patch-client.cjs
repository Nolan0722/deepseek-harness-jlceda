'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {discoverClient,parse,hostIsolation,applyEdits,replaceOnce,declarations,one,sha}=require('./client-analysis.cjs');
const {collectFolderEdits}=require('./patch-folder-project.cjs'),{adaptSidebar}=require('./patch-sidebar.cjs');
const root=path.resolve(__dirname,'..');
function createPlan(sourceDirectory){
  const info=discoverClient(sourceDirectory),read=relative=>fs.readFileSync(path.join(info.client,relative),'utf8');
  let main=read('resources/app/app.js');if(main.includes('__JLC_DSH_ISOLATION__'))throw Error('Provide an unmodified client installation, not an already patched copy');
  const originalMain=main,ast=parse(main),isolation=hostIsolation(main,ast),folder=collectFolderEdits(main,ast);
  main=applyEdits(main,[...isolation,...folder]);
  const preferences=one([...main.matchAll(/nodeIntegrationInSubFrames:!1,sandbox:!0,webSecurity:![01]/g)],'sandboxed editor preferences')[0];
  main=replaceOnce(main,preferences,'nodeIntegrationInSubFrames:!1,sandbox:!0,webSecurity:!0','sandboxed editor preferences');
  main=replaceOnce(main,'scheme:"app",privileges:{supportFetchAPI:!0,stream:!0,corsEnabled:!0}','scheme:"app",privileges:{secure:!0,supportFetchAPI:!0,stream:!0,corsEnabled:!0}','secure application scheme');
  const handlers=declarations(main).filter(r=>r.kind==='function'&&r.node.async&&/^async function [\w$]+\([\w$]+\)\{let [\w$]+=[\w$]+\(\),[\w$]+=[\w$]+\.inject/.test(r.code));
  const handler=one(handlers,'client protocol request handler'),param=handler.node.params[0].name,at=handler.node.body.start+1;
  main=main.slice(0,at)+`if(globalThis.__JLC_DSH_IS_NETWORK_URL__(${param}.url))return await globalThis.__JLC_DSH_FETCH__(${param});`+main.slice(at);
  const nativeCall=one([...handler.code.matchAll(/[\w$]+\.interceptHttpProtocol\([\w$]+,[\w$]+,[\w$]+\)/g)],'native protocol dispatch')[0];
  main=replaceOnce(main,nativeCall,`globalThis.__JLC_DSH_TRACK_NATIVE_REQUEST__(()=>${nativeCall})`,'native request lifetime');
  const finalizer=one([...main.matchAll(/Object\.values\(([\w$]+)\.db\)\.forEach\(([\w$]+)=>\{\2\.then\(([\w$]+)=>\{\3\.close\(\)\}\)\}\)/g)],'native request database finalizer');
  main=replaceOnce(main,finalizer[0],`await globalThis.__JLC_DSH_CLOSE_NATIVE_DATABASES__(Object.values(${finalizer[1]}.db))`,'await native database finalizers');
  main=`require(require('node:path').resolve(__dirname,'../../../../host/isolation.cjs')).applyPaths();\nglobalThis.__JLC_DSH_FOLDER_PROJECT__=require(require('node:path').resolve(__dirname,'../../../../host/folder-project.cjs'));\nrequire(require('node:path').resolve(__dirname,'../../../../host/main-host.cjs'));\n`+main;
  const preload=read('resources/app/preload.js')+'\n'+fs.readFileSync(path.join(root,'host/preload-host.cjs'),'utf8'),uiInput=read(info.uiRelative),ui=adaptSidebar(uiInput);
  const outputs=[{relative:'resources/app/app.js',content:main},{relative:'resources/app/preload.js',content:preload},{relative:info.uiRelative,content:ui.source}];
  for(const file of outputs)new vm.Script(file.content,{filename:file.relative});
  return {info,outputs,manifestSha256:sha(fs.readFileSync(path.join(info.client,info.manifestRelative))),inputHashes:{main:sha(originalMain),ui:sha(uiInput),preload:sha(read('resources/app/preload.js'))},features:[...isolation,...folder].map(e=>e.label).concat(ui.features,['native request lifetime','await native database finalizers']),symbols:ui.symbols};
}
function applyPlan(plan,target){
  target=path.resolve(target);const relative=path.relative(root,target);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||target.toLowerCase()===plan.info.client.toLowerCase())throw Error('Patch target must be an independent generated directory inside this project');
  if(fs.realpathSync.native(target).toLowerCase()!==target.toLowerCase())throw Error('Refusing redirected patch target');
  for(const [relative,expected] of [['resources/app/app.js',plan.inputHashes.main],[plan.info.uiRelative,plan.inputHashes.ui],['resources/app/preload.js',plan.inputHashes.preload]])if(sha(fs.readFileSync(path.join(target,relative)))!==expected)throw Error('Client changed after analysis: '+relative+'; rerun setup from the unmodified source');
  if(sha(fs.readFileSync(path.join(target,plan.info.manifestRelative)))!==plan.manifestSha256)throw Error('Client descriptor changed before patching');
  for(const file of plan.outputs)fs.writeFileSync(path.join(target,file.relative),file.content);
  if(sha(fs.readFileSync(path.join(target,plan.info.manifestRelative)))!==plan.manifestSha256)throw Error('Client descriptor changed while patching');
  return {version:plan.info.version,uiDirectory:plan.info.uiDirectory,features:plan.features,symbols:plan.symbols,inputHashes:plan.inputHashes,outputs:plan.outputs.map(f=>({relative:f.relative,sha256:sha(f.content)})),manifestUnchanged:true};
}
module.exports={createPlan,applyPlan};
if(require.main===module){try{
  const install=JSON.parse(fs.readFileSync(path.join(root,'lab/setup/install.json'),'utf8'));const plan=createPlan(install.source.path),report=applyPlan(plan,path.join(root,'lab/client'));
  fs.mkdirSync(path.join(root,'evidence'),{recursive:true});fs.writeFileSync(path.join(root,'evidence/patch-result.json'),JSON.stringify(report,null,2));console.log('Independent client rebuilt from provided source; feature and syntax checks passed.');
}catch(error){console.error(error.message);process.exitCode=1;}}
