'use strict';
const {spawn,spawnSync}=require('node:child_process');
const {EventEmitter}=require('node:events');
function failure(code,message){return Object.assign(Error(message),{code});}
function safeMessage(error){return String(error?.message||error).replace(/([?&]token=)[^\s"'<>]+/gi,'$1[REDACTED]').slice(0,500);}
// Normalize native CLI envelopes without replacing the original MCP content.
function decodeResult(result,{envelope=false}={}){
  const block=result?.content?.find(x=>x.type==='text');let value=result?.structuredContent;
  if(block){try{value=JSON.parse(block.text);}catch{if(envelope)throw failure('MCP_INVALID_RESULT','EDA CLI returned invalid JSON');}}
  if(value?.ok===false){
    const nativeCode=String(value.error?.code||'');
    const code=/TIMEOUT/.test(nativeCode)?'MCP_TIMEOUT':/CANCEL|ABORT/.test(nativeCode)?'MCP_CANCELLED':/DISCONNECT|CONNECTION|BROKEN_PIPE/.test(nativeCode)?'MCP_DISCONNECTED':'EDA_COMMAND_FAILED';
    throw Object.assign(failure(code,JSON.stringify(value.error||value)),{nativeCode});
  }
  if(result?.isError)throw failure('MCP_TOOL_ERROR',block?.text||'EDA MCP tool failed');
  if(envelope){
    if(value?.ok!==true)throw failure('MCP_INVALID_RESULT','EDA CLI response is missing ok:true');
    if(Object.hasOwn(value,'data'))return value.data;
    if(Object.hasOwn(value,'value'))return value.value;
    throw failure('MCP_INVALID_RESULT','EDA CLI response has no data/value');
  }return value;
}
class McpTransport extends EventEmitter{
  constructor(executable,profile,cwd,options={}){
    super();Object.assign(this,{executable,profile,cwd});this.options=options;this.pending=new Map();this.sequence=0;this.generation=0;
    this.state={phase:'idle',transportConnected:false,bridgeHealthy:false,checkedAt:null,lastSuccessAt:null,error:null};
  }
  status(){return {...this.state,generation:this.generation,pid:this.child?.pid||null};}
  publish(patch){this.state={...this.state,...patch};this.emit('status',this.status());}
  async start(){
    if(this.closed)throw failure('MCP_CLOSED','EDA MCP transport is shutting down');if(this.ready)return this.ready;
    if(Date.now()<(this.nextAttemptAt||0))throw failure('MCP_RECONNECT_WAIT','EDA MCP reconnect is backing off');
    const generation=++this.generation;
    this.publish({phase:generation===1?'starting':'reconnecting',transportConnected:false,bridgeHealthy:false,error:null});
    const run=async()=>{
      const child=this.child=(this.options.spawn||spawn)(this.executable,['--userData',this.profile,'--mcp','stdio'],{cwd:this.cwd,windowsHide:true,stdio:['pipe','pipe','pipe']});
      let buffer='';child.stdout.setEncoding('utf8');
      const failed=error=>{
        if(this.child!==child)return;this.child=null;this.ready=null;this.healthPromise=null;
        this.failures=(this.failures||0)+1;this.nextAttemptAt=Date.now()+(this.options.reconnectDelay??Math.min(15000,1000*2**Math.min(this.failures-1,4)));
        for(const p of [...this.pending.values()])if(p.child===child)p.reject(error);
        this.publish({phase:this.closed?'stopped':'disconnected',transportConnected:false,bridgeHealthy:false,error:{code:error.code||'MCP_DISCONNECTED',message:safeMessage(error)}});
      };
      child.stdout.on('data',chunk=>{
        buffer+=chunk;if(buffer.length>8e6){failed(failure('MCP_INVALID_RESULT','EDA MCP response too large'));this.kill(child);return;}
        let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);let message;try{message=JSON.parse(line)}catch{continue;}
          const p=this.pending.get(message.id);if(p?.child===child)message.error?p.reject(failure('MCP_RPC_ERROR',JSON.stringify(message.error))):p.resolve(message.result);
        }
      });
      child.stderr.resume();child.on('error',failed);child.on('exit',()=>failed(failure('MCP_DISCONNECTED','EDA MCP transport exited')));child.stdin.on('error',failed);
      this.publish({phase:'handshaking'});
      try{
        const server=await this.request('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'jlc-dsh-context',version:'1.1.0'}},undefined,child);
        if(!server?.protocolVersion||!server?.capabilities?.tools)throw failure('MCP_CAPABILITY_MISMATCH','EDA MCP does not advertise tools');
        child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
        const listed=await this.request('tools/list',{},undefined,child);
        if(!['lceda-pro.help','lceda-pro.discover','lceda-pro.call'].every(name=>listed?.tools?.some(t=>t.name===name&&t.inputSchema?.type==='object')))throw failure('MCP_CAPABILITY_MISMATCH','EDA MCP is missing required native tools/schemas');
        if(this.child!==child||this.closed)throw failure('MCP_DISCONNECTED','EDA MCP connection changed');
        this.server=server;this.tools=listed.tools;this.publish({transportConnected:true,serverVersion:server.serverInfo?.version||null,protocolVersion:server.protocolVersion});
        await this.probe(child);return server;
      }catch(error){failed(error);this.kill(child);throw error;}
    };this.ready=run();return this.ready;
  }
  request(method,params,signal,child=this.child,timeoutMs=this.options.timeout||65000){return new Promise((resolve,reject)=>{
    if(signal?.aborted)return reject(failure('MCP_CANCELLED','EDA call cancelled; verify any dispatched modification'));
    if(!child||child!==this.child||this.closed)return reject(failure('MCP_DISCONNECTED','EDA MCP is not connected'));
    const id=++this.sequence;let settled=false;
    const finish=(fn,value)=>{if(settled)return;settled=true;clearTimeout(timer);this.pending.delete(id);signal?.removeEventListener('abort',abort);fn(value);};
    const abort=()=>{
      if(!child.stdin.destroyed)child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:id,reason:'caller cancelled'}})+'\n',()=>{});
      finish(reject,failure('MCP_CANCELLED','EDA call cancelled; dispatched modifications may already have occurred. Read back before retrying.'));
    };
    const timer=setTimeout(()=>finish(reject,failure('MCP_TIMEOUT',`MCP timeout: ${method}. Dispatched modifications may already have occurred; read back before retrying.`)),timeoutMs);
    this.pending.set(id,{child,resolve:v=>finish(resolve,v),reject:e=>finish(reject,e)});signal?.addEventListener('abort',abort,{once:true});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n',error=>{if(error)finish(reject,error);});
  });}
  async probe(child=this.child,signal){
    try{
      const result=await this.request('tools/call',{name:'lceda-pro.call',arguments:{path:'doctor'}},signal,child,this.options.healthTimeout||10000);
      const doctor=decodeResult(result,{envelope:true});
      if(this.child!==child)throw failure('MCP_DISCONNECTED','EDA MCP connection changed during health check');
      const endpointOK=!this.options.expectedEndpoint||doctor.endpoint===this.options.expectedEndpoint;
      const healthy=doctor.connected===true&&doctor.versionMatch===true&&doctor.resultChannel===true&&endpointOK;const now=new Date().toISOString();
      if(healthy){this.failures=0;this.nextAttemptAt=0;}
      this.publish({phase:healthy?'connected':'degraded',transportConnected:true,bridgeHealthy:healthy,checkedAt:now,...(healthy?{lastSuccessAt:now}:{}),bridgeVersion:doctor.bridgeVersion||null,endpoint:doctor.endpoint||null,versionMatch:doctor.versionMatch===true,resultChannel:doctor.resultChannel===true,
        error:healthy?null:{code:endpointOK?'EDA_BRIDGE_UNHEALTHY':'OWNER_ENDPOINT_MISMATCH',message:endpointOK?'EDA bridge, version or result channel is unavailable':'EDA endpoint does not match the isolated profile'}});
    }catch(error){if(this.child===child)this.publish({phase:'degraded',bridgeHealthy:false,checkedAt:new Date().toISOString(),error:{code:error.code||'MCP_HEALTH_ERROR',message:safeMessage(error)}});throw error;}
    return this.status();
  }
  async health(force=false,signal){
    await this.start();
    if(force||!this.state.checkedAt||Date.now()-Date.parse(this.state.checkedAt)>(this.options.healthTTL||5000)){
      if(!this.healthPromise){const pending=this.probe(this.child,signal);this.healthPromise=pending;pending.finally(()=>{if(this.healthPromise===pending)this.healthPromise=null;}).catch(()=>{});}await this.healthPromise;
    }return this.status();
  }
  async call(name,args,signal){
    const health=await this.health(false,signal);
    if(!health.bridgeHealthy&&!(name==='lceda-pro.call'&&args?.path==='doctor'))throw failure('EDA_BRIDGE_UNHEALTHY','EDA MCP bridge is unavailable; do not dispatch or retry modifications');
    return this.request('tools/call',{name,arguments:args},signal);
  }
  async command(command,input,signal){return decodeResult(await this.call('lceda-pro.call',{path:command,...(input?{input}:{})},signal),{envelope:true});}
  kill(child){if(this.options.kill)return this.options.kill(child);if(child?.exitCode===null&&child.signalCode===null)spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}
  close(){
    if(this.closePromise)return this.closePromise;this.closed=true;const child=this.child;
    for(const p of [...this.pending.values()])p.reject(failure('MCP_CLOSED','EDA MCP transport is shutting down'));
    this.publish({phase:'stopped',transportConnected:false,bridgeHealthy:false});
    this.closePromise=new Promise(resolve=>{if(!child||child.exitCode!==null||child.signalCode!==null){resolve();return;}
      const done=()=>{clearTimeout(timeout);child.removeListener('close',done);resolve();};const timeout=setTimeout(done,5000);child.once('close',done);this.kill(child);
    });this.child=null;this.ready=null;return this.closePromise;
  }
}
module.exports={McpTransport,decodeResult,failure};
