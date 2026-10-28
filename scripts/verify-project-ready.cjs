'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
test('native project readiness works without sidebar layout and accepts AST completion before onSuccess',()=>{
  const listeners=new Set(),project={cPath:'E:\\fixture',isOpening:true};
  const world={window:{addEventListener(){}},document:{querySelector(){return null;}},setTimeout(){},CSS:{escape:x=>x},
    me:{getActiveTab(){return '0';}},A:{currentProject:{projectId:'old'},client:{},messageBus:{subscribe(_name,fn){listeners.add(fn);return{cancel(){listeners.delete(fn);}};}}},
    PE:{getInstance(){return{get(){return project;}};}}};
  vm.createContext(world);vm.runInContext(fs.readFileSync(path.join(__dirname,'../host/renderer-host.js'),'utf8'),world);
  assert.equal(world.jlcDshState.initialized,false);assert.equal(typeof world.window.__JLC_DSH_READ_CONTEXT__,'function');
  world.JlcDshWatchProjectReady('new');for(const listener of listeners)listener();
  world.A.currentProject.projectId='new';assert.equal(world.window.__JLC_DSH_READ_CONTEXT__().projectReady,false);
  project.isOpening=false;assert.equal(world.window.__JLC_DSH_READ_CONTEXT__().projectReady,true);
  world.JlcDshWatchProjectReady('next');world.A.currentProject.projectId='next';assert.equal(listeners.size,1);assert.equal(world.window.__JLC_DSH_READ_CONTEXT__().projectReady,false);
  for(const listener of listeners)listener();assert.equal(world.window.__JLC_DSH_READ_CONTEXT__().projectReady,true);
  world.A.currentProject.projectId='other';assert.equal(world.window.__JLC_DSH_READ_CONTEXT__().projectReady,false);
});
