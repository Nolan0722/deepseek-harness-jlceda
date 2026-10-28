'use strict';
function createNativeRequestLifecycle(){
  const pending=new Set();let stopping=false;
  return {
    run(operation){
      if(stopping)return Promise.reject(Object.assign(Error('Native request shutdown has begun'),{code:'OWNER_STOPPING'}));
      const promise=Promise.resolve().then(operation);pending.add(promise);
      return promise.finally(()=>pending.delete(promise));
    },
    async drain(){stopping=true;await Promise.allSettled([...pending]);}
  };
}
async function closeNativeDatabases(databases){
  const results=await Promise.allSettled(databases.map(async database=>(await database).close()));
  const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
}
module.exports={createNativeRequestLifecycle,closeNativeDatabases};
