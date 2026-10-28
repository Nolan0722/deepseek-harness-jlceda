const fs = require('node:fs');
async function connect(target,onEvent) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map(); let sequence = 0;
  await new Promise((resolve,reject)=>{ socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true}); });
  socket.addEventListener('message',event=>{
    const message=JSON.parse(event.data); const req=pending.get(message.id);
    if(message.method)onEvent?.(message);
    if(req){clearTimeout(req.timer);pending.delete(message.id); message.error?req.reject(Error(JSON.stringify(message.error))):req.resolve(message.result);}
  });
  return { call(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},30000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});}, close(){socket.close();} };
}
async function targets(){return fetch('http://127.0.0.1:9431/json/list').then(r=>r.json());}
module.exports={connect,targets};
if(require.main===module)(async()=>{
  const list=await targets();
  if(!process.argv[2])return console.log(JSON.stringify(list.map(({id,title,url,type})=>({id,title,url:url.split('?')[0],type})),null,2));
  const target=list.find(x=>x.id===process.argv[2]);if(!target)throw Error('Target id absent');
  const client=await connect(target);
  try{const expression=fs.readFileSync(process.argv[3],'utf8');const r=await client.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});console.log(JSON.stringify(r,null,2));}finally{client.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
