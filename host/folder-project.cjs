'use strict';
const fs=require('node:fs'),path=require('node:path');
function invalid(message){return Object.assign(Error(message),{code:'INVALID_ARGS'});}
function folderProject(value){
  if(typeof value!=='string'||!value)return null;
  const absolute=path.resolve(value);let stat;
  try{stat=fs.statSync(absolute);}catch(error){
    if(/\.eprj3$/i.test(value))throw invalid(`Cannot read .eprj3 project: ${value} (${error.code})`);
    return null;
  }
  const isManifest=stat.isFile()&&/\.eprj3$/i.test(absolute);
  if(!stat.isDirectory()&&!isManifest)return null;
  const directory=fs.realpathSync.native(isManifest?path.dirname(absolute):absolute);
  let files;
  try{files=fs.readdirSync(directory,{withFileTypes:true}).filter(e=>e.isFile()&&/\.eprj3$/i.test(e.name)).map(e=>path.join(directory,e.name));}
  catch(error){throw invalid(`Cannot read project directory: ${directory} (${error.code})`);}
  if(files.length!==1)throw invalid(`Expected exactly one .eprj3 index in ${directory}; found ${files.length}`);
  if(isManifest&&fs.realpathSync.native(absolute).toLowerCase()!==files[0].toLowerCase())throw invalid('The supplied .eprj3 index does not identify the project directory');
  let manifest;
  try{manifest=JSON.parse(fs.readFileSync(files[0],'utf8'));}catch{throw invalid(`Invalid .eprj3 JSON index: ${files[0]}`);}
  if(!manifest||typeof manifest!=='object'||Array.isArray(manifest))throw invalid(`Invalid .eprj3 project index: ${files[0]}`);
  return {directory,index:files[0]};
}
function normalizeOpenPath(value){return folderProject(value)?.directory??value;}
function isFolderProject(value){try{return !!folderProject(value);}catch{return false;}}
module.exports={folderProject,normalizeOpenPath,isFolderProject};
