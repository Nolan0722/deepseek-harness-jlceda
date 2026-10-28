'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {prepareDshTemp}=require('../host/dsh-temp.cjs');
const root=path.resolve(__dirname,'..'),parent=path.join(root,'lab/ptc-temp-regression');fs.mkdirSync(parent,{recursive:true});
const profile=()=>fs.mkdtempSync(path.join(parent,'profile-'));
test('private temp children support native restricted-token grant and revoke without elevation',async()=>{
  const p=profile(),managed=prepareDshTemp(p),child=fs.mkdtempSync(path.join(managed,'grant-'));
  const {AclWriteGrant,tempWriteSid}=await import(pathToFileURL(path.join(root,'runtime/node_modules/@deepseek-ai/dsh-sandbox-windows-acl/lib/index.js')));
  const grant=AclWriteGrant.create(tempWriteSid(child));
  try{grant.add(child);}finally{grant.dispose();}
  assert.equal(prepareDshTemp(p),managed);fs.writeFileSync(path.join(child,'owner-still-writes'),'ok');
});
test('existing Modify-only temp directory is refused rather than silently changing its permissions',()=>{
  const p=profile(),target=path.join(p,'dsh-temp');fs.mkdirSync(target);
  assert.throws(()=>prepareDshTemp(p),/permissions differ/);assert.equal(fs.readdirSync(target).length,0);
});
test('temp junction is refused and the linked directory is untouched',()=>{
  const p=profile(),other=profile(),target=path.join(p,'dsh-temp');fs.writeFileSync(path.join(other,'marker'),'unchanged');
  fs.symlinkSync(other,target,'junction');
  try{assert.throws(()=>prepareDshTemp(p),/reparse point/);assert.equal(fs.readFileSync(path.join(other,'marker'),'utf8'),'unchanged');}finally{fs.unlinkSync(target);}
});
