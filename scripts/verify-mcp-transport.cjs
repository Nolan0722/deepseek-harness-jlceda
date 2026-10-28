'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PassThrough,Writable}=require('node:stream');
const {McpTransport,decodeResult}=require('../host/mcp-transport.cjs');
const result=value=>({content:[{type:'text',text:JSON.stringify(value)}]});
function fixture(overrides={}){
  const requests=[],children=[];let doctor={connected:true,versionMatch:true,resultChannel:true,endpoint:'isolated',bridgeVersion:'test'};
  const spawn=()=>{
    const child=new EventEmitter();Object.assign(child,{pid:100+children.length,exitCode:null,signalCode:null,stdout:new PassThrough(),stderr:new PassThrough()});
    child.stdin=new Writable({write(chunk,_encoding,done){
      const q=JSON.parse(chunk.toString());requests.push(q);done();if(!q.id)return;
      queueMicrotask(()=>{
        let value=q.method==='initialize'?{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{version:'test'}}:
          q.method==='tools/list'?{tools:['help','discover','call'].map(n=>({name:'lceda-pro.'+n,inputSchema:{type:'object'}}))}:
          q.params.arguments.path==='doctor'?result({ok:true,data:doctor}):result({ok:true,data:'native'});
        if(overrides.respond)value=overrides.respond(q,value);
        if(value!==undefined)child.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result:value})+'\n');
      });
    }});children.push(child);return child;
  };
  const kill=child=>{if(child.exitCode!==null)return;child.exitCode=0;child.emit('exit',0);child.emit('close',0);};
  const transport=new McpTransport('copy.exe','profile','lab',{spawn,kill,timeout:60,healthTimeout:60,reconnectDelay:0,expectedEndpoint:'isolated'});
  return {transport,requests,children,kill,setDoctor:patch=>{doctor={...doctor,...patch};}};
}
test('native MCP handshake discovers schemas and checks actual bridge before connected',async()=>{
  const f=fixture(),phases=[];f.transport.on('status',s=>phases.push(s.phase));
  try{await f.transport.start();assert.equal(f.transport.status().phase,'connected');assert.deepEqual(f.requests.filter(x=>x.id).map(x=>x.method),['initialize','tools/list','tools/call']);assert.ok(phases.includes('handshaking'));assert.equal(await f.transport.command('invoke',{code:'native'}),'native');}finally{await f.transport.close();}
});
test('both documented and installed envelopes normalize; nested errors never succeed',()=>{
  assert.deepEqual(decodeResult(result({ok:true,value:{a:1}}),{envelope:true}),{a:1});
  assert.equal(decodeResult(result({ok:true,data:false}),{envelope:true}),false);
  assert.throws(()=>decodeResult(result({ok:false,error:'failed'}),{envelope:true}),{code:'EDA_COMMAND_FAILED'});
  assert.throws(()=>decodeResult(result({ok:true}),{envelope:true}),{code:'MCP_INVALID_RESULT'});
  assert.throws(()=>decodeResult({isError:true,content:[{type:'text',text:'bad'}]}),{code:'MCP_TOOL_ERROR'});
  assert.throws(()=>decodeResult({...result({ok:false,error:{code:'REQUEST_TIMEOUT',message:'invoke timed out'}}),isError:true},{envelope:true}),{code:'MCP_TIMEOUT'});
});
test('bridge and owner mismatches block invocation, and recover on actual health check',async()=>{
  const f=fixture();try{
    await f.transport.start();f.setDoctor({endpoint:'original-install'});await f.transport.health(true);assert.equal(f.transport.status().error.code,'OWNER_ENDPOINT_MISMATCH');
    await assert.rejects(()=>f.transport.command('invoke',{code:'never'}),{code:'EDA_BRIDGE_UNHEALTHY'});assert.ok(!f.requests.some(q=>q.params?.arguments?.path==='invoke'));
    f.setDoctor({endpoint:'isolated',resultChannel:false});await f.transport.health(true);assert.equal(f.transport.status().phase,'degraded');
    f.setDoctor({resultChannel:true});await f.transport.health(true);assert.equal(f.transport.status().phase,'connected');
  }finally{await f.transport.close();}
});
test('missing native schemas fail handshake',async()=>{
  const f=fixture({respond:(q,v)=>q.method==='tools/list'?{tools:[]}:v});
  try{await assert.rejects(()=>f.transport.start(),{code:'MCP_CAPABILITY_MISMATCH'});assert.equal(f.transport.status().bridgeHealthy,false);}finally{await f.transport.close();}
});
test('timeout and cancellation never replay a dispatched modification',async()=>{
  const f=fixture({respond:(q,v)=>q.params?.arguments?.path==='invoke'?undefined:v});
  try{
    await assert.rejects(()=>f.transport.command('invoke',{code:'modify'}),{code:'MCP_TIMEOUT'});
    await assert.rejects(()=>f.transport.command('invoke',{code:'modify'},AbortSignal.timeout(10)),{code:'MCP_CANCELLED'});
    assert.equal(f.requests.filter(q=>q.params?.arguments?.path==='invoke').length,2);assert.equal(f.transport.pending.size,0);
  }finally{await f.transport.close();}
});
test('dead connection rejects pending calls; old exit cannot erase replacement connection',async()=>{
  const f=fixture({respond:(q,v)=>q.params?.arguments?.path==='invoke'?undefined:v});
  try{
    await f.transport.start();const old=f.children[0];const pending=f.transport.command('invoke',{code:'modify'});
    await new Promise(r=>setImmediate(r));f.kill(old);await assert.rejects(()=>pending,{code:'MCP_DISCONNECTED'});
    await f.transport.start();old.emit('exit',1);assert.equal(f.transport.status().phase,'connected');assert.equal(f.transport.status().generation,2);assert.equal(f.transport.pending.size,0);
  }finally{await f.transport.close();}
});
