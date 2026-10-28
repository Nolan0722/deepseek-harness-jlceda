'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {discoverClient,parse,applyEdits,sha}=require('./client-analysis.cjs'),{createPlan}=require('./patch-client.cjs');
const traverse=require('../.tools/node_modules/@babel/traverse').default;
const root=path.resolve(__dirname,'..'),report={date:new Date().toISOString(),steps:[],computerUseUsed:false};
function step(name,data={}){report.steps.push({name,...data});console.log(name);}
function renamed(source,names){const spans=new Map();traverse(parse(source),{Identifier(p){if(names.includes(p.node.name)&&(p.isReferencedIdentifier()||p.isBindingIdentifier()))spans.set(p.node.start,{start:p.node.start,end:p.node.end,code:'portable_'+p.node.name,label:p.node.name});}});return applyEdits(source,[...spans.values()]);}
try{
  if(!process.argv[2])throw Error('Provide an unmodified client directory');const source=discoverClient(process.argv[2]);
  const plan=createPlan(source.client);assert.ok(plan.features.length>=20);step('provided-client-is-analyzed-without-history-inputs',{version:plan.info.version,features:plan.features.length});
  const base=path.join(root,'.cache');fs.mkdirSync(base,{recursive:true});const synthetic=fs.mkdtempSync(path.join(base,'adapter-input-')),app=path.join(synthetic,'resources/app');fs.mkdirSync(path.join(app,'assets/pro-ui/portable-ui/js'),{recursive:true});
  fs.writeFileSync(path.join(synthetic,'lceda-pro.exe'),'static-analysis-only');fs.writeFileSync(path.join(app,'package.json'),JSON.stringify({version:'2099.99-test-not-pinned'}));
  const main=fs.readFileSync(path.join(source.app,'app.js'),'utf8'),ui=fs.readFileSync(path.join(source.client,source.uiRelative),'utf8');
  fs.writeFileSync(path.join(app,'app.js'),renamed(main,['Oh','hq','Ir','qA','Ki','cz','vl','z2e','H2e','xQ','AC','cQ','QF','st']));
  fs.copyFileSync(path.join(source.app,'preload.js'),path.join(app,'preload.js'));fs.copyFileSync(path.join(source.client,source.manifestRelative),path.join(app,'assets/pro-ui/portable-ui/extension.json'));
  const input=renamed(ui,['qr','Q3','ps','Zu','v2','Nwe','Ed','PE','CKe','Te']);fs.writeFileSync(path.join(app,'assets/pro-ui/portable-ui/js/ui.js'),input);
  const varied=createPlan(synthetic);assert.equal(varied.info.version,'2099.99-test-not-pinned');assert.equal(varied.info.uiDirectory,'portable-ui');assert.equal(varied.symbols.qr,'portable_qr');assert.equal(varied.symbols.PE,'portable_PE');assert.equal(varied.symbols.CKe,'portable_CKe');step('version-resource-directory-and-minified-symbol-renames-do-not-lock-adaptation');
  fs.writeFileSync(path.join(app,'assets/pro-ui/portable-ui/js/ui.js'),input.replace('this.id="right-panel-tab-container"','this.id="unsupported-panel-container"'));
  const before=sha(fs.readFileSync(path.join(app,'app.js')));assert.throws(()=>createPlan(synthetic),/Unsupported client structure/);assert.equal(sha(fs.readFileSync(path.join(app,'app.js'))),before);step('missing-private-interface-is-rejected-without-writing-client-files');report.passed=true;
}catch(error){report.passed=false;report.error=error.stack;console.error(error);process.exitCode=1;}
finally{fs.mkdirSync(path.join(root,'evidence'),{recursive:true});fs.writeFileSync(path.join(root,'evidence/client-adapter-regression.json'),JSON.stringify(report,null,2));}
