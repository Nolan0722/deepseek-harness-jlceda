'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createNativeRequestLifecycle,closeNativeDatabases}=require('../host/native-request-lifecycle.cjs');
test('drain waits for the complete native handler including asynchronous database cleanup',async()=>{
  const lifecycle=createNativeRequestLifecycle();let finish;const databaseClosed=new Promise(resolve=>{finish=resolve;});let drained=false;
  const result=lifecycle.run(async()=>{await databaseClosed;return 'native-result';});const drain=lifecycle.drain().then(()=>{drained=true;});
  await Promise.resolve();assert.equal(drained,false);finish();assert.equal(await result,'native-result');await drain;assert.equal(drained,true);
});
test('native handler errors are preserved and do not prevent shutdown of other requests',async()=>{
  const lifecycle=createNativeRequestLifecycle(),error=Error('native-error');const result=lifecycle.run(()=>{throw error;});const drain=lifecycle.drain();await assert.rejects(result,error);await drain;
});
test('new native dispatch is rejected once shutdown begins',async()=>{
  const lifecycle=createNativeRequestLifecycle();await lifecycle.drain();let ran=false;await assert.rejects(()=>lifecycle.run(()=>{ran=true;}),{code:'OWNER_STOPPING'});assert.equal(ran,false);
});
test('a failed native database close is reported after every other native close has completed',async()=>{
  let finish,reported=false;const closed=new Promise(resolve=>{finish=resolve;}),error=Error('native close failed');
  const cleanup=closeNativeDatabases([Promise.resolve({close:async()=>{throw error;}}),Promise.resolve({close:()=>closed})]);
  const observed=assert.rejects(cleanup,error).then(()=>{reported=true;});await Promise.resolve();await Promise.resolve();assert.equal(reported,false);finish();await observed;assert.equal(reported,true);
});
