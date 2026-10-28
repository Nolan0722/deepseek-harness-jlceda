'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function exportSource(destination){
  destination=path.resolve(destination);if(fs.existsSync(destination))throw Error('Source export destination must not exist');
  const files=['.gitignore','.gitattributes','README.md','THIRD_PARTY_NOTICES.md','setup.ps1','.tools/package.json','.tools/package-lock.json','runtime/package.json','runtime/package-lock.json'];
  function collect(relative){for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true})){const name=path.join(relative,entry.name);if(/^(node_modules|\.git|\.cache|lab|evidence)$/.test(entry.name)||/^\.env(?:\.|$)|^\.npmrc$|^(credentials|secrets).*\.json$|activation.*\.json$/i.test(entry.name)||/\.(pem|key|pfx|p12|exe|log|db|sqlite|lic)$/i.test(entry.name))continue;if(fs.lstatSync(path.join(root,name)).isSymbolicLink())throw Error('Refusing redirected source: '+name);if(entry.isDirectory())collect(name);else if(entry.isFile())files.push(name);}}
  for(const folder of ['host','plugins','scripts'])collect(folder);
  fs.mkdirSync(destination,{recursive:true});
  for(const file of files){const target=path.join(destination,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,file),target);}
  return files;
}
module.exports={exportSource};
if(require.main===module){if(!process.argv[2])throw Error('Provide a new export directory');console.log(JSON.stringify({files:exportSource(process.argv[2]).length,destination:path.resolve(process.argv[2])}));}
