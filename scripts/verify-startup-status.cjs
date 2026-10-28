'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(){
  let notify,rendered;
  const world={window:{addEventListener(){}},document:{getElementById(){return null;}},setTimeout(){},
    CKe:{jsx:(tag,props)=>({tag,props})},Te:()=>({useSyncExternalStore(subscribe,get){if(!notify)notify=subscribe(()=>{rendered=world.JlcDshPlaceholder();});return get();}})};
  vm.createContext(world);vm.runInContext(fs.readFileSync(path.join(__dirname,'../host/renderer-host.js'),'utf8'),world);
  return {world,mount(){rendered=world.JlcDshPlaceholder();},banner:()=>rendered.props.children[0].props,dispose(){notify?.();}};
}
test('ready arriving before component mount leaves no startup banner or vertical gap, including remount',()=>{
  const f=fixture();f.world.JlcDshUpdateStatus({phase:'ready',message:'DeepSeek Harness 已就绪'});f.mount();assert.equal(f.banner().style.display,'none');f.mount();assert.equal(f.banner().style.display,'none');f.dispose();
});
test('online mode does not start DSH and tells the user to switch modes',async()=>{
  const f=fixture();f.world.PRO_EDITOR_MODE='CLIENT-ONLINE-LCEDA';let started=false;
  f.world.window.jlcDSH={bootstrap(){started=true;return {url:'https://127.0.0.1:1/?token=x'};}};f.world.jlcDshFrame={};
  await f.world.JlcDshLoadFrame();assert.equal(started,false);f.mount();
  assert.notEqual(f.banner().style.display,'none');assert.match(f.banner().children[0].props.children,/半离线模式/);assert.match(f.banner().children[0].props.children,/全离线模式/);
  assert.equal(f.banner().children[1].props.hidden,true);f.world.JlcDshUpdateStatus({phase:'ready',message:'不应覆盖在线提醒'});assert.match(f.banner().children[0].props.children,/未启动/);f.dispose();
});
test('half-offline and full-offline modes still request DSH startup',async()=>{
  for(const mode of ['CLIENT-HALF_OFFLINE-LCEDA','CLIENT-OFFLINE-LCEDA']){
    const f=fixture();f.world.PRO_EDITOR_MODE=mode;let started=false;
    f.world.window.jlcDSH={bootstrap(){started=true;return {url:'https://127.0.0.1:9/?token=abc'};}};f.world.jlcDshFrame={};
    await f.world.JlcDshLoadFrame();assert.equal(started,true,mode);f.dispose();
  }
});
test('a mounted startup banner follows starting, error and ready state with the matching retry action',()=>{
  const f=fixture();f.mount();assert.notEqual(f.banner().style.display,'none');assert.equal(f.banner().children[1].props.hidden,true);
  f.world.JlcDshUpdateStatus({phase:'error',message:'启动失败'});assert.equal(f.banner().children[0].props.children,'启动失败');assert.equal(f.banner().children[1].props.hidden,false);
  f.world.JlcDshUpdateStatus({phase:'ready',message:'DeepSeek Harness 已就绪'});assert.equal(f.banner().style.display,'none');assert.equal(f.banner().children[1].props.hidden,true);f.dispose();
});
