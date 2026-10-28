'use strict';
const {parse,one,declarations,replaceOnce,applyEdits}=require('./client-analysis.cjs');
const traverse=require('../.tools/node_modules/@babel/traverse').default;
const id='[\\w$]+',helper='globalThis.__JLC_DSH_FOLDER_PROJECT__';
function collectFolderEdits(source,ast=parse(source)){
  const functions=declarations(source,ast).filter(r=>r.kind==='function'),edits=[];
  const validate=one(functions.filter(r=>r.code.includes('--path must be a file path string')&&r.code.includes('unsupported file type:')),'CLI path validator');
  const check=validate.code.match(new RegExp(`:(${id})\\((${id})\\)\\?null:\\{code:(${id}),message:`));if(!check)throw Error('Unsupported CLI path validator expression');
  const [,isFile,arg,errorCode]=check;
  function edit(row,from,to,label){edits.push({start:row.node.start,end:row.node.end,code:replaceOnce(row.code,from,to,label),label});}
  edit(validate,`${isFile}(${arg})?null`,`(${isFile}(${arg})||${helper}.isFolderProject(${arg}))?null`,'CLI-directory-validation');
  const find=one(functions.filter(r=>new RegExp(`return ${id}\\.find\\((${id})=>${isFile}\\(\\1\\)\\)`).test(r.code)&&r.code.length<160),'editor URL path selection');
  const findMatch=find.code.match(new RegExp(`(${id}\\.find\\((${id})=>${isFile}\\(\\2\\))\\)`));
  edit(find,findMatch[0],`${helper}.normalizeOpenPath(${findMatch[1]}||${helper}.isFolderProject(${findMatch[2]})))`,'editor-URL-directory-path');
  const positional=one(functions.filter(r=>r.code.includes('.startsWith("-")')&&new RegExp(`return ${isFile}\\((${id})\\)\\?\\1:void 0`).test(r.code)&&r.code.length<400),'positional path selection');
  const pos=positional.code.match(new RegExp(`return ${isFile}\\((${id})\\)\\?\\1:void 0`));
  edit(positional,pos[0],`return ${isFile}(${pos[1]})||${helper}.isFolderProject(${pos[1]})?${helper}.normalizeOpenPath(${pos[1]}):void 0`,'positional-directory-path');
  const dispatch=one(functions.filter(r=>r.code.includes('endpointName:')&&r.code.includes('.docCli')&&r.code.includes(`${validate.name}(`)),'native CLI/MCP dispatcher');
  const open=dispatch.code.match(new RegExp(`if\\((${id})===(${id})\\)\\{let (${id})=${validate.name}\\((${id})\\.path\\);`));if(!open)throw Error('Unsupported native open dispatch');
  const failure=dispatch.code.match(new RegExp(`let (${id})=${id}=>\\(\\{ok:!1,error:${id}\\}\\)`));if(!failure)throw Error('Unsupported native command error reply');
  edit(dispatch,open[0],`if(${open[1]}===${open[2]}){try{${open[4]}.path=${helper}.normalizeOpenPath(${open[4]}.path)}catch(__jlc_error){return ${failure[1]}({code:${errorCode},message:__jlc_error.message})}let ${open[3]}=${validate.name}(${open[4]}.path);`,'CLI-and-MCP-open-normalization');
  const renderer=one(functions.filter(r=>r.code.includes('"session-render-wrapped"')&&r.code.includes('probeReady()')),'native renderer readiness');
  const probe=renderer.code.match(new RegExp(`return (${id})\\(await (${id})\\.webContents\\.executeJavaScript\\((${id})\\(\\)\\)\\)`));if(!probe)throw Error('Unsupported renderer readiness probe');
  const fromUrl=one(functions.filter(r=>r.code.includes('.indexOf("#")')&&r.code.includes('.split(",")')&&r.code.includes('decodeURIComponent')),'native URL path reader');
  const hash=one(functions.filter(r=>r.code.includes('.createHash)("sha256")')&&r.code.includes('.digest("hex")')&&r.code.includes('"utf-8"')&&r.code.length<250),'native project identity function');
  edit(renderer,probe[0],`let __jlc_probe=${probe[1]}(await ${probe[2]}.webContents.executeJavaScript(${probe[3]}()));if(__jlc_probe.ready){let __jlc_path=${fromUrl.name}(${probe[2]}.webContents.getURL());if(__jlc_path&&(/\\.eprj2?$/i.test(__jlc_path)||${helper}.isFolderProject(__jlc_path))){let __jlc_hint=await ${probe[2]}.webContents.executeJavaScript('window.__JLC_DSH_READ_CONTEXT__?.()');if(!__jlc_hint?.projectReady)return{ready:!1,reason:"project-initializing"}}if(${helper}.isFolderProject(__jlc_path)){let __jlc_dir=${helper}.normalizeOpenPath(__jlc_path),__jlc_hint=await ${probe[2]}.webContents.executeJavaScript('window.__JLC_DSH_READ_CONTEXT__?.()');if(!__jlc_hint?.projectReady||__jlc_hint.projectId!==${hash.name}(__jlc_dir)||${helper}.normalizeOpenPath(__jlc_hint.projectPath)!==__jlc_dir)return{ready:!1,reason:"folder-project-initializing"}}}return __jlc_probe`,'folder-project-render-readiness');
  const owners=[],stores=[];traverse(ast,{ObjectMethod(p){if(p.node.key.name==='openProject'){const code=source.slice(p.node.start,p.node.end),m=code.match(new RegExp(`let (${id})=(${id}\\((${id})\\.path\\)\\?\\?"")`));if(m)owners.push({node:p.node,code,m});}},ClassMethod(p){if(p.node.key.name==='openProject'){const code=source.slice(p.node.start,p.node.end),m=code.match(new RegExp(`let (${id})=(this\\.ctx\\.requestParams\\.path\\.replace\\(/\\^file:.*?,""\\))`));if(m)stores.push({node:p.node,code,m});}}});
  const owner=one(owners,'owner session path');edit(owner,owner.m[0],`let ${owner.m[1]}=${helper}.normalizeOpenPath(${owner.m[2]})`,'owner-session-path');
  const store=one(stores,'project storage path');edit(store,store.m[0],`let ${store.m[1]}=${helper}.normalizeOpenPath(${store.m[2]})`,'storage-path-identity');
  return edits;
}
function patchFolderProject(source){return applyEdits(source,collectFolderEdits(source));}
module.exports=patchFolderProject;module.exports.collectFolderEdits=collectFolderEdits;
