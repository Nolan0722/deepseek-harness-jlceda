'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const parser=require('../.tools/node_modules/@babel/parser'),traverse=require('../.tools/node_modules/@babel/traverse').default;
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function parse(source){return parser.parse(source,{sourceType:'unambiguous'});}
function one(items,label){if(items.length!==1)throw Error(`Unsupported client structure: ${label}; expected one match, found ${items.length}`);return items[0];}
function replaceOnce(source,from,to,label){if(source.split(from).length!==2)throw Error('Unsupported client structure: '+label);return source.replace(from,to);}
function applyEdits(source,edits){let boundary=source.length;for(const e of [...edits].sort((a,b)=>b.start-a.start)){if(e.end>boundary||e.start<0)throw Error('Overlapping adapter edits: '+e.label);source=source.slice(0,e.start)+e.code+source.slice(e.end);boundary=e.start;}return source;}
function declarations(source,ast=parse(source)){
  const rows=[];traverse(ast,{FunctionDeclaration(p){rows.push({name:p.node.id?.name,node:p.node,code:source.slice(p.node.start,p.node.end),kind:'function'});},VariableDeclarator(p){if(p.node.id.type==='Identifier')rows.push({name:p.node.id.name,node:p.node,code:source.slice(p.node.start,p.node.end),kind:'variable'});},AssignmentExpression(p){if(p.node.left.type==='Identifier')rows.push({name:p.node.left.name,node:p.node,code:source.slice(p.node.start,p.node.end),kind:'assignment'});}});return rows;
}
function discoverClient(client){
  client=fs.realpathSync.native(path.resolve(client));const app=path.join(client,'resources/app');
  for(const f of ['lceda-pro.exe','resources/app/app.js','resources/app/preload.js','resources/app/package.json'])if(!fs.statSync(path.join(client,f),{throwIfNoEntry:false})?.isFile())throw Error('Client must contain unpacked '+f);
  const uiRoot=path.join(app,'assets/pro-ui');
  const candidates=fs.readdirSync(uiRoot,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name).filter(v=>fs.existsSync(path.join(uiRoot,v,'js/ui.js'))&&fs.existsSync(path.join(uiRoot,v,'extension.json')));
  const uiDirectory=one(candidates,'active pro-ui bundle');
  return {client,app,version:JSON.parse(fs.readFileSync(path.join(app,'package.json'),'utf8')).version||'unknown',uiDirectory,uiRelative:`resources/app/assets/pro-ui/${uiDirectory}/js/ui.js`,manifestRelative:`resources/app/assets/pro-ui/${uiDirectory}/extension.json`};
}
function hostIsolation(source,ast=parse(source)){
  const rows=declarations(source,ast).filter(r=>r.kind==='variable'),code=n=>source.slice(n.start,n.end);
  const documents=one(rows.filter(r=>/\(\(\)=>[\w$]+\("documents"\)\)\(\)$/.test(r.code)),'documents path');
  const local=one(rows.filter(r=>r.code.includes('"AppData","Local"')&&r.code.includes('.platform()')),'local application data path');
  const joinFrom=name=>rows.filter(r=>r.node.init?.type==='CallExpression'&&r.node.init.callee.type==='MemberExpression'&&r.node.init.callee.property.name==='join'&&r.node.init.arguments.length===2&&r.node.init.arguments[0].name===name);
  const dataRoot=one(joinFrom(documents.name),'EDA documents root'),cache=one(joinFrom(local.name),'EDA cache root');
  const profile=one(joinFrom(cache.name).filter(r=>code(r.node.init.arguments[1]).includes('cache.')&&code(r.node.init.arguments[1]).includes('.arch()')),'owner profile path');
  return [[documents,'documents'],[local,'localAppData'],[dataRoot,'dataRoot'],[cache,'cacheRoot'],[profile,'userData']].map(([r,field])=>({start:r.node.start,end:r.node.end,code:`${r.name}=globalThis.__JLC_DSH_ISOLATION__.${field}`,label:field}));
}
module.exports={parse,one,replaceOnce,applyEdits,declarations,discoverClient,hostIsolation,sha};
