'use strict';
const path=require('node:path');
const fs=require('node:fs');
const {createRequire}=require('node:module');
const packageName='@jlc-agent/dsh-context';

// The host owns this deployment's required bundle. DSH still composes all
// bundles, user settings and the final per-process configuration itself.
function prepareDshProfile(root,home){
  const runtimeRequire=createRequire(path.join(root,'runtime/package.json'));
  const packageDirectory=path.dirname(runtimeRequire.resolve(packageName+'/package.json'));
  const {initProfile,PROFILE_TEMPLATES,readProfileManifest,writeProfileManifest}=runtimeRequire('@deepseek-ai/dsh-app-boot');
  const directory=path.join(home,'profiles/web');
  initProfile(directory,[...PROFILE_TEMPLATES.web.bundles,packageName]);
  const manifest=readProfileManifest('jlceda-agent',directory);
  const bundles=manifest.dsh?.profile?.bundles;
  if(!Array.isArray(bundles)||!bundles.every(value=>typeof value==='string'))throw Error('JLCEDA Agent requires a valid DSH web profile bundle list.');
  let changed=false;
  if(!bundles.includes(packageName)){bundles.push(packageName);changed=true;}
  // DSH resolves installed plugin modules from the active profile. Link the
  // lockfile-owned local package there, without a global npm link or resolver patch.
  const link=path.join(directory,'node_modules',packageName);
  fs.mkdirSync(path.dirname(link),{recursive:true});
  if(fs.lstatSync(link,{throwIfNoEntry:false})){
    if(fs.realpathSync.native(link).toLowerCase()!==fs.realpathSync.native(packageDirectory).toLowerCase())throw Error('The JLCEDA profile plugin points to a different installation: '+link);
  }else fs.symlinkSync(packageDirectory,link,'junction');
  const dependency='file:'+path.relative(directory,packageDirectory).replaceAll('\\','/');
  manifest.dependencies??={};
  if(manifest.dependencies[packageName]!==dependency){manifest.dependencies[packageName]=dependency;changed=true;}
  if(changed){
    writeProfileManifest(directory,manifest);
  }
  return directory;
}
module.exports={prepareDshProfile,packageName};
if(require.main===module){
  const root=path.resolve(__dirname,'..');
  prepareDshProfile(root,path.join(root,'lab/dsh-home'));
  console.log('DSH profile includes '+packageName);
}
