'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{test}=require('node:test'),assert=require('node:assert/strict');
const {build,inputs}=require('./build-dsh-sidebar.cjs'),root=path.resolve(__dirname,'..'),hash=value=>crypto.createHash('sha256').update(value).digest('hex');
test('locked frontend builds are repeatable, upgrade recorded output, and refuse unknown changes before writing',()=>{
  fs.mkdirSync(path.join(root,'.cache'),{recursive:true});const fixture=fs.mkdtempSync(path.join(root,'.cache/sidebar-build-'));fs.mkdirSync(path.join(fixture,'evidence'));
  for(const input of inputs){const cached=path.join(root,'.cache/dsh-sidebar-rc2',input.pkg+'.js'),original=fs.readFileSync(fs.existsSync(cached)?cached:path.join(root,input.relative));assert.equal(hash(original),input.expected);const target=path.join(fixture,input.relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,original);}
  const first=build(fixture);assert.ok(first.edits.every(edit=>edit.changed));assert.ok(build(fixture).edits.every(edit=>!edit.changed));
  const receipt=path.join(fixture,'evidence/dsh-sidebar-build.json'),entry=first.edits.find(edit=>edit.pkg==='ui-conversation'),expected=fs.readFileSync(entry.file),older=Buffer.concat([expected,Buffer.from('\n// previous generated frontend\n')]);
  fs.writeFileSync(entry.file,older);entry.outputSha256=hash(older);fs.writeFileSync(receipt,JSON.stringify(first));assert.ok(build(fixture).edits.find(edit=>edit.pkg===entry.pkg).changed);assert.deepEqual(fs.readFileSync(entry.file),expected);
  const firstInput=inputs[0],firstTarget=path.join(fixture,firstInput.relative),pristine=fs.readFileSync(path.join(fixture,'.cache/dsh-sidebar-rc2',firstInput.pkg+'.js'));fs.writeFileSync(firstTarget,pristine);
  const lastTarget=path.join(fixture,inputs.at(-1).relative);fs.appendFileSync(lastTarget,'\n// unrecorded edit\n');const receiptBefore=fs.readFileSync(receipt);
  assert.throws(()=>build(fixture),/Unexpected runtime customization/);assert.deepEqual(fs.readFileSync(firstTarget),pristine);assert.deepEqual(fs.readFileSync(receipt),receiptBefore);
});
