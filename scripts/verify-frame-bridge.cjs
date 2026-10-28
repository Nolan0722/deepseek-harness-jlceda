'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function broker(handler=async()=>({value:true})){
  const sent=[],calls=[],source={postMessage:(...args)=>sent.push(args)};
  const world={window:{addEventListener(){},jlcDSH:{frameRequest:async v=>{calls.push(v);return handler(v);}}},setTimeout(){}};
  vm.createContext(world);vm.runInContext(fs.readFileSync(path.join(root,'host/renderer-host.js'),'utf8'),world);
  world.jlcDshFrame={contentWindow:source};world.jlcDshOrigin='https://127.0.0.1:4433';
  const event=patch=>({source,origin:world.jlcDshOrigin,data:{channel:'jlc-dsh-frame-v1',type:'request',id:'1',action:'current'},...patch});
  return {world,event,sent,calls};
}
test('editor broker refuses foreign origin, sibling frame and arbitrary host actions',async()=>{
  const b=broker();for(const e of [b.event({source:{}}),b.event({origin:'https://attacker.invalid'}),b.event({data:{channel:'jlc-dsh-frame-v1',type:'request',id:'1',action:'invoke'}})])await b.world.JlcDshOnFrameMessage(e);
  assert.equal(b.calls.length,0);assert.equal(b.sent.length,0);
});
test('broker forwards only the selected action fields and replies to the exact frame origin',async()=>{
  const b=broker();const e=b.event();Object.assign(e.data,{action:'select',conversationId:'actual',session:'foreign',code:'untrusted'});await b.world.JlcDshOnFrameMessage(e);
  assert.deepEqual(JSON.parse(JSON.stringify(b.calls)),[{action:'select',conversationId:'actual'}]);assert.equal(b.sent[0][1],b.world.jlcDshOrigin);assert.equal(b.sent[0][0].ok,true);
});
test('a reload discards old in-flight responses instead of sending them to the new document',async()=>{
  let finish;const b=broker(()=>new Promise(r=>{finish=r;})),pending=b.world.JlcDshOnFrameMessage(b.event());
  b.world.jlcDshState.generation++;finish({old:true});await pending;assert.equal(b.sent.length,0);
});
test('frame client accepts responses and health events only from its editor parent',async()=>{
  const sent=[],handlers={},timers=new Map(),parent={postMessage:(...args)=>sent.push(args)};
  const world={window:{parent,addEventListener:(name,fn)=>{handlers[name]=fn;}},setTimeout:fn=>{const id=timers.size+1;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)};
  vm.createContext(world);const source=fs.readFileSync(path.join(root,'plugins/jlc-context/client.js'),'utf8').split('window.__ModuleLoader__.load(')[0];vm.runInContext(source,world);
  const response={channel:'jlc-dsh-frame-v1',type:'response',id:sent[0][0].id,ok:true,value:{debug:true}};
  handlers.message({source:{},origin:'https://client',data:response});handlers.message({source:parent,origin:'https://attacker.invalid',data:response});assert.equal(timers.size,1);
  handlers.message({source:parent,origin:'https://client',data:response});await world.window.jlcEDAContext.ready;assert.equal(world.window.jlcEDAContext.debug,true);assert.equal(timers.size,0);
  let events=0;world.window.jlcEDAContext.onHealth(()=>events++);const health={channel:'jlc-dsh-frame-v1',type:'health',value:{bridgeHealthy:true}};
  handlers.message({source:{},origin:'https://client',data:health});assert.equal(events,0);handlers.message({source:parent,origin:'https://client',data:health});assert.equal(events,1);
  handlers.pagehide();
});
