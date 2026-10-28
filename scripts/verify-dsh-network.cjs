'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),https=require('node:https'),fs=require('node:fs'),path=require('node:path'),dns=require('node:dns');
const {createDshNetwork}=require('../host/dsh-network.cjs');
const root=path.resolve(__dirname,'..'),certificate=fs.readFileSync(path.join(root,'lab/tls/cert.pem')),key=fs.readFileSync(path.join(root,'lab/tls/key.pem'));
async function fixture(t,handler){
  const server=https.createServer({cert:certificate,key},handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  const origin='https://127.0.0.1:'+server.address().port,jar=[];
  const session={cookies:{async set(row){jar.push(row);},async get(){return jar;}}};
  return {server,origin,jar,network:createDshNetwork({certificate,session,getOrigin:()=>origin})};
}
test('launch token is exchanged once into a signed browser cookie and only the clean URL is returned',async t=>{
  const f=await fixture(t,(req,res)=>{assert.equal(req.url,'/?token=fixture-proof');res.writeHead(303,{'set-cookie':'signed_fixture=proof; Path=/; Max-Age=60; HttpOnly; SameSite=None; Secure',location:'./'});res.end();});
  assert.equal(await f.network.authenticate(f.origin+'/?token=fixture-proof'),f.origin+'/');
  assert.equal(f.jar.length,1);assert.equal(f.jar[0].httpOnly,true);assert.equal(f.jar[0].secure,true);assert.equal(f.jar[0].sameSite,'no_restriction');
});
test('the dedicated transport preserves POST bodies and browser credentials and refuses foreign origins',async t=>{
  const f=await fixture(t,(req,res)=>{let body='';req.on('data',b=>body+=b);req.on('end',()=>{assert.equal(req.headers.cookie,'signed_fixture=proof');assert.equal(req.headers['accept-encoding'],'identity');res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({method:req.method,body}));});});
  f.jar.push({name:'signed_fixture',value:'proof'});
  const response=await f.network.fetch(new Request(f.origin+'/api/test',{method:'POST',body:'{"read":true}'}));
  assert.deepEqual(await response.json(),{method:'POST',body:'{"read":true}'});
  await assert.rejects(f.network.fetch(new Request('https://attacker.invalid/api/test')),/origin mismatch/);
});
test('aborted streaming requests release the upstream connection and simultaneous frames do not queue behind streams',async t=>{
  let active=0;
  const f=await fixture(t,(req,res)=>{if(req.url==='/stream'){active++;res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: ready\n\n');const interval=setInterval(()=>res.write(': heartbeat\n\n'),1000);res.on('close',()=>{active--;clearInterval(interval);});}else res.end('ok');});
  const controllers=Array.from({length:8},()=>new AbortController());
  const streams=await Promise.all(controllers.map(c=>f.network.fetch(new Request(f.origin+'/stream',{signal:c.signal}))));
  assert.equal(active,8);
  const replies=await Promise.all(Array.from({length:12},async()=>{const r=await f.network.fetch(new Request(f.origin+'/'));return r.text();}));assert.ok(replies.every(r=>r==='ok'));
  controllers.forEach(c=>c.abort());await Promise.all(streams.map(s=>s.body.cancel().catch(()=>{})));
  const deadline=Date.now()+3000;while(active&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));assert.equal(active,0);
});
test('TLS hostname checks remain active even with the private local CA',async t=>{
  dns.setDefaultResultOrder('ipv4first');const f=await fixture(t,(_req,res)=>res.end('unexpected'));
  await assert.rejects(f.network.authenticate(f.origin.replace('127.0.0.1','localhost')+'/'),error=>error.code==='ERR_TLS_CERT_ALTNAME_INVALID');
});
