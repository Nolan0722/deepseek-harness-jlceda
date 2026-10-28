'use strict';
const net=require('node:net');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {McpTransport,decodeResult}=require('./mcp-transport.cjs');
const {normalizeOpenPath}=require('./folder-project.cjs');
const READ_CONTEXT=`const p=await eda.dmt_Project.getCurrentProjectInfo();const d=await eda.dmt_SelectControl.getCurrentDocumentInfo();return {project:p?{uuid:p.uuid,name:p.friendlyName||p.name,teamUuid:p.teamUuid}:null,document:d?{uuid:d.uuid,tabId:d.tabId,documentType:d.documentType}:null};`;
function fault(code,message){const error=Error(message);error.code=code;return error;}
function canonical(value){return typeof value==='string'?value.replaceAll('\\','/').toLowerCase():null;}
function projectIdentity(target){return JSON.stringify([canonical(target.projectPath),target.projectId]);}
function documentIdentity(target){return JSON.stringify([target.edaSessionId,projectIdentity(target),target.documentTabId]);}
function projectTarget(target){const {projectPath,projectDirectory,directorySource,workspaceDirectory,projectId,projectName}=target;return {projectPath,projectDirectory,directorySource,workspaceDirectory,projectId,projectName};}
function parseProjectBindings(text){
  const data=JSON.parse(text),rows=data.bindings;
  if(data.schemaVersion!==1||!Array.isArray(rows))throw Error('Invalid current project binding store');
  for(const row of rows)if(!row||Object.keys(row).sort().join(',')!=='conversationId,createdAt,scope,target'||typeof row.conversationId!=='string'||typeof row.createdAt!=='string'||row.scope!=='project'||!row.target||Object.keys(row.target).sort().join(',')!=='directorySource,projectDirectory,projectId,projectName,projectPath,workspaceDirectory'||Object.values(row.target).some(v=>v!==null&&typeof v!=='string'))throw Error('Invalid current project binding record');
  const map=new Map(rows.map(row=>[row.conversationId,row]));if(map.size!==rows.length)throw Error('Duplicate project binding');return map;
}
function projectLocation(hint,project){
  if(!project?.uuid)return {projectPath:null,projectDirectory:null,directorySource:null};
  const candidate=hint.projectPath;
  if(typeof candidate==='string'&&path.isAbsolute(candidate)){
    try{
      const normalized=normalizeOpenPath(candidate);
      const stat=fs.statSync(normalized);
      const directory=fs.realpathSync(stat.isDirectory()?normalized:path.dirname(normalized));
      return {projectPath:path.resolve(normalized),projectDirectory:directory,directorySource:'editor'};
    }catch{}
  }
  return {projectPath:null,projectDirectory:null,directorySource:null};
}
class ContextHost{
  constructor({root,profile,views,onChange}){
    this.root=root;this.profile=profile;this.views=views;this.onChange=onChange;
    this.ownerId=crypto.randomUUID();this.pipe=`\\\\.\\pipe\\jlc-dsh-context-${process.pid}-${crypto.randomBytes(12).toString('hex')}`;
    this.file=path.join(root,'lab/project-bindings.json');this.bindings=new Map();this.leases=new Map();this.inflight=new Map();this.sockets=new Set();
    try{this.bindings=parseProjectBindings(fs.readFileSync(this.file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    this.auditFile=path.join(root,'lab/eda-calls.jsonl');this.recentCalls=new Map();
    const expectedEndpoint='JLCEDAPro'+crypto.createHash('sha256').update(profile).digest('hex').slice(0,8);
    this.mcp=new McpTransport(path.join(root,'lab/client/lceda-pro.exe'),profile,path.join(root,'lab'),{expectedEndpoint});
    this.mcp.on('status',()=>this.onChange?.());
  }
  async start(){
    if(this.starting)return this.starting;
    this.starting=new Promise((resolve,reject)=>{
      this.server=net.createServer(socket=>{
        socket.setEncoding('utf8');this.sockets.add(socket);socket.on('close',()=>this.sockets.delete(socket));let buffer='';
        socket.on('data',chunk=>{buffer+=chunk;if(buffer.length>2e6){socket.destroy();return}let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);let request;try{request=JSON.parse(line)}catch{socket.destroy();return}
          const abort=new AbortController();socket.once('close',()=>abort.abort());
          this.handle(request,abort.signal).then(value=>socket.end(JSON.stringify({ok:true,value})+'\n'),error=>socket.end(JSON.stringify({ok:false,error:{code:error.code||'CONTEXT_ERROR',message:error.message}})+'\n'));
        }});socket.on('error',()=>{});
      });this.server.once('error',reject);this.server.listen(this.pipe,resolve);
    });return this.starting;
  }
  save(){const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify({schemaVersion:1,bindings:[...this.bindings.values()]},null,2));fs.renameSync(tmp,this.file);}
  async capture(entry){
    if(this.closed)throw fault('OWNER_STOPPING','EDA 实例正在退出。');
    if(entry.disposed||entry.win.isDestroyed())throw fault('WINDOW_CLOSED','绑定的 EDA 窗口已关闭。');
    const sessions=await this.mcp.command('session.list');
    const matches=sessions.filter(s=>s.renderId===entry.win.id&&s.status==='alive'&&!s.headless);
    if(matches.length!==1)throw fault('SESSION_UNAVAILABLE','无法唯一确认此窗口的 EDA 会话。');
    const session=matches[0];
    const hint=await entry.win.webContents.executeJavaScript('window.__JLC_DSH_READ_CONTEXT__?.()');
    if(!hint)throw fault('CONTEXT_NOT_READY','EDA 文档上下文尚未就绪。');
    if(hint.projectId&&!hint.projectReady)throw fault('CONTEXT_NOT_READY','工程文档结构正在初始化。');
    const actual=await this.mcp.command('invoke',{session:session.sessionId,code:READ_CONTEXT,timeout:10000});
    const after=await entry.win.webContents.executeJavaScript('window.__JLC_DSH_READ_CONTEXT__?.()');
    if(this.closed)throw fault('OWNER_STOPPING','EDA 实例正在退出。');
    if(JSON.stringify(hint)!==JSON.stringify(after))throw fault('CONTEXT_CHANGED','读取过程中 EDA 文档发生变化，请重试。');
    if((hint.projectId||null)!==(actual.project?.uuid||null)||actual.document?.tabId&&actual.document.tabId!==hint.editorTabId)throw fault('CONTEXT_CHANGED','工程控制器与原生 MCP 尚未形成同一个上下文快照。');
    if(actual.project&&!hint.projectReady)throw fault('CONTEXT_NOT_READY','工程文档结构正在初始化。');
    const location=projectLocation(hint,actual.project);
    return {edaSessionId:session.sessionId,windowId:entry.win.id,...location,
      workspaceDirectory:location.projectDirectory||(!actual.project?path.join(this.root,'lab/workspace'):null),
      projectId:actual.project?.uuid||null,projectName:actual.project?.name||null,
      documentId:actual.document?.uuid||null,documentTabId:actual.document?.tabId||null,
      documentType:actual.document?.documentType??null,editorTabId:hint.editorTabId||null,documentName:hint.documentName||null};
  }
  async select(entry,conversationId){
    if(typeof conversationId!=='string'||conversationId.length<1||conversationId.length>200)throw fault('INVALID_CONVERSATION','无效的 DSH 对话标识。');
    const target=await this.capture(entry);
    if(this.closed)throw fault('OWNER_STOPPING','EDA 实例正在退出。');
    let binding=this.bindings.get(conversationId);
    if(!binding){
      binding={conversationId,scope:'project',target:projectTarget(target),createdAt:new Date().toISOString()};
      this.bindings.set(conversationId,binding);this.save();
    }
    const lease=this.leases.get(conversationId);
    const liveLease=lease&&[...this.views.values()].some(e=>e.contextWindowKey===lease.windowKey&&!e.disposed);
    if(projectIdentity(binding.target)===projectIdentity(target)&&!liveLease){
      if(this.inflight.get(conversationId))throw fault('CALL_IN_PROGRESS','此会话有调用正在执行，暂不能连接其他窗口。');
      this.leases.set(conversationId,{windowKey:entry.contextWindowKey});
    }
    entry.conversationId=conversationId;
    const result=this.describe(binding,entry,target);this.onChange?.();return result;
  }
  describe(binding,entry,current){
    let reason=null;
    const lease=this.leases.get(binding.conversationId);
    if(projectIdentity(binding.target)!==projectIdentity(current))reason='PROJECT_CHANGED';
    else if(lease?.windowKey!==entry.contextWindowKey)reason='OTHER_WINDOW';
    return {conversationId:binding.conversationId,scope:'project',state:reason?'stale':'bound',reason,project:binding.target,target:current,mcp:this.mcp.status()};
  }
  async validate(conversationId){
    const binding=this.bindings.get(conversationId);
    if(!binding)throw fault('CONVERSATION_UNBOUND','此对话尚未绑定 EDA 窗口，请在侧栏打开此对话。');
    const lease=this.leases.get(conversationId);
    if(!lease)throw fault('CONVERSATION_UNBOUND','请在所属工程的侧栏打开此会话，建立当前窗口连接。');
    const entry=[...this.views.values()].find(e=>e.contextWindowKey===lease.windowKey&&!e.disposed);
    if(!entry)throw fault('WINDOW_CLOSED','此对话绑定的 EDA 窗口已关闭，不会改用其他窗口。');
    const current=await this.capture(entry);
    if(projectIdentity(binding.target)!==projectIdentity(current))throw fault('PROJECT_CHANGED','此对话属于其他工程，请切换到当前工程的对话。');
    return {binding,entry,current};
  }
  async handle(request,signal){
    if(request.action==='prompt-context'){
      try{return {state:'bound',observedAt:new Date().toISOString(),...await this.handle({...request,action:'tool',tool:'context'},signal)};}
      catch(error){return {state:'unavailable',observedAt:new Date().toISOString(),reason:error.code||'CONTEXT_ERROR',message:error.message,mcp:this.mcp.status()};}
    }
    if(request.action!=='tool')throw fault('INVALID_ACTION','Unsupported context operation');
    const {conversationId,tool,args={}}=request;
    const {binding,current}=await this.validate(conversationId);
    const workspace=request.workspace;
    if(current.projectDirectory&&canonical(workspace?.root)!==canonical(current.projectDirectory))throw fault('WORKSPACE_MISMATCH','DSH 对话工作区与当前工程目录不一致，请切换到当前工程的对话。');
    this.inflight.set(conversationId,(this.inflight.get(conversationId)||0)+1);
    try{
      if(tool==='context')return {binding:{conversationId,scope:'project',project:binding.target},target:current,workspace:workspace||null,mcp:this.mcp.status(),lastCall:this.recentCalls.get(conversationId)||null};
      if(tool==='help'||tool==='discover')return await this.mcp.call(`lceda-pro.${tool}`,args,signal);
      if(tool!=='call'||typeof args.path!=='string')throw fault('INVALID_TOOL','Unknown EDA tool');
      const input={...(args.input||{})};
      if(input.session!==undefined&&String(input.session)!==current.edaSessionId)throw fault('SESSION_MISMATCH','不能指定其他窗口的 EDA 会话。');
      if(args.path==='session.list')return {content:[{type:'text',text:JSON.stringify({ok:true,path:args.path,data:[current]})}]};
      if(!['invoke','functions','doc.api','doc.external','doc.format','doctor'].includes(args.path))throw fault('UNSCOPED_COMMAND','此命令不能通过已绑定的对话执行。');
      const fresh=await this.validate(conversationId);
      if(args.path==='invoke'){
        if(typeof input.code!=='string'||input.codeFile!==undefined||input.extUuid!==undefined||input.fn!==undefined)throw fault('UNGUARDED_INVOCATION','绑定调用只支持内联 code；不能使用 codeFile、extUuid 或 fn 绕过目标检查。');
        if(!current.documentId)throw fault('NO_DOCUMENT','请先打开目标原理图、PCB 或库文档。工程会话会自动跟随活动文档。');
        if(typeof args.documentTabId!=='string')throw fault('DOCUMENT_REQUIRED','请先读取 jlceda_context，并将 target.documentTabId 作为本次调用的 documentTabId。');
        if(args.documentTabId!==current.documentTabId||documentIdentity(fresh.current)!==documentIdentity(current))throw fault('DOCUMENT_CHANGED','活动文档已变化，本次调用未执行。请读取当前上下文后再操作。');
        const expected=JSON.stringify({projectId:current.projectId,documentTabId:current.documentTabId});
        input.code=`const __jlc_expected=${expected};const __jlc_p=await eda.dmt_Project.getCurrentProjectInfo();const __jlc_d=await eda.dmt_SelectControl.getCurrentDocumentInfo();if((__jlc_p?.uuid||null)!==__jlc_expected.projectId||(__jlc_d?.tabId||null)!==__jlc_expected.documentTabId)throw new Error('JLC_DSH_TARGET_CHANGED: 文档在分发前发生变化');return await (async()=>{\n${input.code}\n})();`;
      }
      // Only the host supplies this identity; never fall back to the active GUI window.
      if(['invoke','functions','doc.external'].includes(args.path))input.session=current.edaSessionId;
      const purpose=args.purpose||(['doctor','functions','doc.api','doc.external','doc.format'].includes(args.path)?'query':'unspecified');
      if(!['query','modify','verify','save','unspecified'].includes(purpose))throw fault('INVALID_PURPOSE','用途只能是 query/modify/verify/save；用途声明不是权限隔离。');
      const previous=args.verifyOf&&this.recentCalls.get(conversationId);
      if(args.verifyOf&&(purpose!=='verify'||!previous||previous.id!==args.verifyOf||previous.targetFingerprint!==documentIdentity(current)))throw fault('INVALID_VERIFICATION_REFERENCE','回读必须关联本对话同一文档最近的调用记录。');
      const record={id:crypto.randomUUID(),conversationId,path:args.path,purpose,purposeSource:args.path==='invoke'?'caller-declared':'command',
        effect:args.path==='invoke'?'script-not-inspected':'command',targetFingerprint:documentIdentity(current),documentTabId:current.documentTabId,startedAt:new Date().toISOString(),status:'dispatching',verified:false,
        ...(args.verifyOf?{verifyOf:args.verifyOf}:{}),sourceHash:typeof input.code==='string'?crypto.createHash('sha256').update(input.code).digest('hex'):null};
      const store=()=>{this.recentCalls.set(conversationId,record);fs.appendFileSync(this.auditFile,JSON.stringify(record)+'\n');};
      store();
      try{
        const result=await this.mcp.call('lceda-pro.call',{path:args.path,input},signal);
        decodeResult(result,{envelope:true});
        // Even successful arbitrary scripts require a separate semantic readback.
        record.status='returned';record.finishedAt=new Date().toISOString();store();
        return {...result,jlcCall:{id:record.id,purpose,documentTabId:record.documentTabId,verifyOf:record.verifyOf||null,status:record.status,verified:false}};
      }catch(error){
        const unknown=['MCP_TIMEOUT','MCP_CANCELLED','MCP_DISCONNECTED','MCP_RPC_ERROR','MCP_CLOSED'].includes(error.code)||!error.code;
        record.status=unknown?'outcome-unknown':'failed';record.finishedAt=new Date().toISOString();record.errorCode=error.code||'CALL_ERROR';store();
        if(unknown)throw fault('OUTCOME_UNKNOWN',`调用 ${record.id} 的结果待核实：修改可能已发生，请先回读，不要重试写入。`);
        throw error;
      }
    }finally{const n=this.inflight.get(conversationId)-1;n?this.inflight.set(conversationId,n):this.inflight.delete(conversationId);}
  }
  async health(){try{await this.mcp.health();}catch{}return this.mcp.status();}
  close(){this.closed=true;for(const socket of this.sockets)socket.destroy();this.server?.close();return this.mcp.close();}
}
module.exports={ContextHost,projectIdentity,documentIdentity,projectTarget,projectLocation,parseProjectBindings};
