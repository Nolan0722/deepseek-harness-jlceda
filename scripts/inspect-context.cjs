const path=require('node:path'),fs=require('node:fs');
const root=path.resolve(__dirname,'..');
const {McpTransport}=require('../host/mcp-transport.cjs');
const mcp=new McpTransport(path.join(root,'lab/client/lceda-pro.exe'),path.join(root,'lab/profile'),path.join(root,'lab'));
(async()=>{try{
  const tasks=[['editor','DMT_EditorControl'],['select','DMT_SelectControl'],['project','DMT_Project']];
  const out={};for(const[key,className]of tasks){out[key]=await mcp.command('doc.api',{className});console.log(key,JSON.stringify(out[key]).slice(0,19000));}
  fs.writeFileSync(path.join(root,'evidence/context-api-reference.json'),JSON.stringify(out,null,2));
}finally{mcp.close()}})().catch(e=>{console.error(e);process.exitCode=1});
