const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const profile = path.resolve(root, process.argv[2] || 'lab/profile');
const output = path.resolve(root, process.argv[3] || 'evidence/mcp-probe.json');
const requests = new Map();
let seq = 0, buffer = '', stderr = '';
const child = spawn(path.join(root, 'lab/client/lceda-pro.exe'), ['--userData', profile, '--mcp', 'stdio'],
  { cwd: path.join(root, 'lab'), windowsHide: true, stdio: ['pipe','pipe','pipe'] });
child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-10000); });
child.stdout.on('data', chunk => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0,newline); buffer = buffer.slice(newline+1);
    let message; try { message = JSON.parse(line); } catch { continue; }
    const pending = requests.get(message.id);
    if (pending) { requests.delete(message.id); clearTimeout(pending.timer); message.error ? pending.reject(Error(JSON.stringify(message.error))) : pending.resolve(message.result); }
  }
});
function request(method, params) {
  return new Promise((resolve,reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { requests.delete(id); reject(Error(`MCP timeout: ${method}`)); },30000);
    requests.set(id,{resolve,reject,timer});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
  });
}
(async()=>{
  const result = {profile, transportPid:child.pid, started:new Date().toISOString()};
  try {
    result.initialize = await request('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'jlc-dsh-validation',version:'1.0.0'}});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
    const tools = await request('tools/list',{});
    result.tools = tools.tools;
    if (process.argv[4]) result.call = await request('tools/call',{name:process.argv[4],arguments:JSON.parse(process.argv[5]||'{}')});
    if(result.call?.isError)throw Error('MCP tool returned isError');
    result.passed = true;
  } catch(error) { result.passed=false; result.error=String(error); result.stderr=stderr; process.exitCode=1; }
  finally {
    for(const pending of requests.values()) clearTimeout(pending.timer);
    requests.clear();
    child.stdin.end();
    if(child.exitCode===null && child.signalCode===null) {
      const stop=spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,encoding:'utf8'});
      result.cleanupExitCode=stop.status;
    }
    fs.writeFileSync(output,JSON.stringify(result,null,2));
    console.log(JSON.stringify({output,passed:result.passed,server:result.initialize?.serverInfo,tools:result.tools?.map(t=>({name:t.name,description:t.description?.slice(0,110),required:t.inputSchema?.required})),call:result.call,error:result.error},null,2));
  }
})();
