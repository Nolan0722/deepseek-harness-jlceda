'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFile}=require('node:child_process');
const {targets,connect}=require('./cdp.cjs');
const root=path.resolve(__dirname,'..'),report={started:new Date().toISOString(),observations:[],logs:[]};
let done=false,client;
execFile(path.join(root,'lab/client/lceda-pro.exe'),['--userData',path.join(root,'lab/profile'),'open','--path',path.join(root,'lab/eprj3-fixture/中文工程 带空格')],{windowsHide:true,timeout:40000,maxBuffer:1e6},(error,stdout,stderr)=>{report.result={error:error?.message,stdout,stderr};done=true;});
(async()=>{try{while(!done){
  if(!client){const t=(await targets()).find(x=>x.type==='page'&&x.url.includes('prjPath=')&&decodeURIComponent(x.url).includes('eprj3-fixture'));if(t){client=await connect(t,e=>{if(e.method==='Runtime.consoleAPICalled')report.logs.push({type:e.params.type,args:e.params.args.map(x=>x.value??x.description).filter(Boolean)});if(e.method==='Runtime.exceptionThrown')report.logs.push(e.params.exceptionDetails);});await client.call('Runtime.enable');}}
  if(client){const r=await client.call('Runtime.evaluate',{expression:'({hint:window.__JLC_DSH_READ_CONTEXT__?.(),debug:window.__JLC_DSH_DEBUG__?.state().projectReadyId,text:document.body.innerText.slice(0,1300)})',returnByValue:true}).catch(()=>null);if(r)report.observations.push({at:new Date().toISOString(),value:r.result.value});}
  await new Promise(r=>setTimeout(r,400));
}}finally{client?.close();fs.writeFileSync('evidence/eprj3-open-diagnostic.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report).slice(-18000));}})().catch(e=>{console.error(e);process.exitCode=1});
