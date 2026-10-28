'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {folderProject,normalizeOpenPath,isFolderProject}=require('../host/folder-project.cjs');
const {projectLocation}=require('../host/context-host.cjs');
function fixture(fn){const root=fs.mkdtempSync(path.join(os.tmpdir(),'jlc-eprj3-'));try{return fn(root);}finally{
  // mkdtemp creates this exact test-owned root; never delete user project paths.
  const absolute=path.resolve(root);assert.ok(path.dirname(absolute)===path.resolve(os.tmpdir())&&path.basename(absolute).startsWith('jlc-eprj3-'));
  fs.rmSync(absolute,{recursive:true,force:true});
}}
test('directory, index, trailing separator and dot aliases resolve to one physical directory',()=>fixture(root=>{
  const dir=path.join(root,'中文 工程'),file=path.join(dir,'工程.EPRJ3');fs.mkdirSync(dir);fs.writeFileSync(file,'{"config":{}}');
  const expected=fs.realpathSync.native(dir);
  for(const value of [dir,file,dir+path.sep,path.join(dir,'.'),...(process.platform==='win32'?[file.toLowerCase()]:[])])assert.equal(normalizeOpenPath(value),expected);
  assert.equal(folderProject(file).index,file);assert.equal(isFolderProject(dir),true);
}));
test('bare opens and regular project formats retain original behavior',()=>fixture(root=>{
  assert.equal(normalizeOpenPath(undefined),undefined);assert.equal(normalizeOpenPath(''),'');assert.equal(normalizeOpenPath(null),null);
  const file=path.join(root,'legacy.eprj2');fs.writeFileSync(file,'not a folder project');assert.equal(normalizeOpenPath(file),file);assert.equal(isFolderProject(file),false);
}));
test('context binding canonicalizes an editor-reported index path to the same folder',()=>fixture(root=>{
  const index=path.join(root,'project.eprj3');fs.writeFileSync(index,'{}');
  const fromIndex=projectLocation({projectPath:index},{uuid:'test'}),fromDirectory=projectLocation({projectPath:root},{uuid:'test'});
  assert.deepEqual(fromIndex,fromDirectory);assert.equal(fromIndex.projectPath,fs.realpathSync.native(root));assert.equal(fromIndex.projectDirectory,fs.realpathSync.native(root));
}));
test('missing or ambiguous indexes are rejected for both directory and index entrances',()=>fixture(root=>{
  assert.throws(()=>normalizeOpenPath(root),/found 0/);const first=path.join(root,'a.eprj3');fs.writeFileSync(first,'{}');fs.writeFileSync(path.join(root,'b.eprj3'),'{}');
  assert.throws(()=>normalizeOpenPath(root),/found 2/);assert.throws(()=>normalizeOpenPath(first),/found 2/);
}));
test('malformed, nonobject and nonexistent indexes fail before a window is allocated',()=>fixture(root=>{
  const file=path.join(root,'a.eprj3');assert.throws(()=>normalizeOpenPath(file),{code:'INVALID_ARGS'});
  for(const text of ['{','null','[]']){fs.writeFileSync(file,text);assert.throws(()=>normalizeOpenPath(file),{code:'INVALID_ARGS'});assert.equal(isFolderProject(file),false);}
}));
