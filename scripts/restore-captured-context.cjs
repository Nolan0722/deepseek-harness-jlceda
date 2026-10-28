'use strict';
const fs=require('node:fs'),path=require('node:path');
const {McpTransport}=require('../host/mcp-transport.cjs');
const {normalizeOpenPath}=require('../host/folder-project.cjs');
const root=path.resolve(__dirname,'..'),delay=ms=>new Promise(r=>setTimeout(r,ms));
const canonical=value=>(value||'').replaceAll('\\','/').toLowerCase();
async function restoreContexts(mcp,rows,{timeout=30000}={}){
  const restored=[];
  for(const row of rows){
    if(!row.restorePath)continue;
    if(!fs.existsSync(row.restorePath))throw Error('Captured project no longer exists: '+row.restorePath);
    const restorePath=normalizeOpenPath(row.restorePath);
    const existing=(await mcp.command('session.list')).find(s=>{if(s.status!=='alive'||s.headless)return false;try{return canonical(normalizeOpenPath(s.path))===canonical(restorePath);}catch{return false;}});
    const opened=existing||await mcp.command('open',{path:restorePath});
    const deadline=Date.now()+timeout;let actual,lastError;
    while(Date.now()<deadline){
      try{
        actual=await mcp.command('invoke',{session:opened.sessionId,timeout:2000,code:'const p=await eda.dmt_Project.getCurrentProjectInfo();return p?{uuid:p.uuid}:null;'});
        if(actual?.uuid===row.context.project.uuid)break;
      }catch(error){lastError=error.message;}
      await delay(250);
    }
    if(actual?.uuid!==row.context.project.uuid)throw Error(`Restored project identity mismatch for ${restorePath}: expected ${row.context.project.uuid}, observed ${actual?.uuid||'not ready'}${lastError?'; '+lastError:''}`);
    let document=null;
    if(row.context.document?.uuid){
      const documentDeadline=Date.now()+timeout;
      while(Date.now()<documentDeadline){
        try{
          document=await mcp.command('invoke',{session:opened.sessionId,timeout:3000,code:`const p=await eda.dmt_Project.getCurrentProjectInfo();if(p?.uuid!==${JSON.stringify(row.context.project.uuid)})throw Error('RESTORE_TARGET_CHANGED');await eda.dmt_EditorControl.openDocument(${JSON.stringify(row.context.document.uuid)});return await eda.dmt_SelectControl.getCurrentDocumentInfo();`});
          if(document?.uuid===row.context.document.uuid)break;
        }catch(error){if(error.message.includes('RESTORE_TARGET_CHANGED'))throw error;}
        await delay(200);
      }
      if(document?.uuid!==row.context.document.uuid)throw Error('Restored document identity mismatch');
    }
    restored.push({path:restorePath,sessionId:opened.sessionId,windowId:opened.renderId,projectId:actual.uuid,documentId:document?.uuid||null,reused:!!existing});
  }
  return restored;
}
module.exports={restoreContexts};
if(require.main===module)(async()=>{
  const mcp=new McpTransport(path.join(root,'lab/client/lceda-pro.exe'),path.join(root,'lab/profile'),path.join(root,'lab'));
  try{
    const rows=JSON.parse(fs.readFileSync(path.resolve(root,process.argv[2]||'evidence/workspace-fix-restore.json')));
    const restored=await restoreContexts(mcp,rows);
    fs.writeFileSync(path.join(root,process.argv[2]?'evidence/phase2-restored.json':'evidence/workspace-restored.json'),JSON.stringify({date:new Date().toISOString(),restored,notRestored:[]},null,2));
    console.log(JSON.stringify({restored},null,2));
  }finally{await mcp.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
