// Injected into the pinned pro-ui bundle closure. The DSH frame has no preload.
var jlcDshState = { selected: true, initialized: false, error: null, startupTimer: 0, generation: 0, status: { phase: 'starting', message: 'JLCEDA Agent 正在启动…' } };
var jlcDshUnsubscribeStatus = null;
var jlcDshUnsubscribeHealth = null;
var jlcDshProjectReadySubscription = null;
var jlcDshFrame = null;
var jlcDshOrigin = null;
var jlcDshStatusListeners = new Set();
function JlcDshSubscribeStatus(listener) {
  jlcDshStatusListeners.add(listener);
  return () => jlcDshStatusListeners.delete(listener);
}
function JlcDshStatusSnapshot() { return jlcDshState.status; }
function JlcDshWatchProjectReady(projectId) {
  jlcDshState.projectReadyId = null;
  jlcDshProjectReadySubscription?.cancel();
  jlcDshProjectReadySubscription = A.messageBus.subscribe('astBuildedAfterProjectOpen', () => {
    jlcDshState.projectReadyId = projectId;
  });
}
function JlcDshReadContext() {
  const tab=me.getActiveTab();
  const element=tab&&document.querySelector('[data-tab-key="'+CSS.escape(tab)+'"]');
  const project=PE.getInstance().get(A.currentProject?.projectId);
  return {editorTabId:tab||null,documentName:element?.getAttribute('data-test')||null,
    projectId:A.currentProject?.projectId||null,projectPath:project?.cPath||null,
    projectReady:!!project&&!project.isOpening&&jlcDshState.projectReadyId===A.currentProject?.projectId};
}
window.__JLC_DSH_READ_CONTEXT__=JlcDshReadContext;
function JlcDshPost(message) {
  if(jlcDshFrame?.contentWindow&&jlcDshOrigin)jlcDshFrame.contentWindow.postMessage({channel:'jlc-dsh-frame-v1',...message},jlcDshOrigin);
}
async function JlcDshOnFrameMessage(event) {
  if(!jlcDshFrame||event.source!==jlcDshFrame.contentWindow||event.origin!==jlcDshOrigin)return;
  const message=event.data;
  if(!message||message.channel!=='jlc-dsh-frame-v1'||message.type!=='request'||typeof message.id!=='string'||message.id.length>80||!['ready','current','health','select'].includes(message.action))return;
  const generation=jlcDshState.generation;
  try{
    const value=await window.jlcDSH.frameRequest({action:message.action,...(message.action==='select'?{conversationId:message.conversationId}:{})});
    if(generation===jlcDshState.generation)JlcDshPost({type:'response',id:message.id,ok:true,value});
  }catch(error){
    if(generation===jlcDshState.generation)JlcDshPost({type:'response',id:message.id,ok:false,error:String(error.message||error)});
  }
}
window.addEventListener('message',JlcDshOnFrameMessage);
async function JlcDshLoadFrame() {
  const frame=jlcDshFrame,generation=++jlcDshState.generation;
  if(!frame)return;
  try{
    const {url}=await window.jlcDSH.bootstrap();
    if(frame!==jlcDshFrame||generation!==jlcDshState.generation)return;
    const address=new URL(url);
    if(address.protocol!=='https:'||address.hostname!=='127.0.0.1')throw Error('Invalid local DSH origin');
    jlcDshOrigin=address.origin;
    frame.src=url;
  }catch(error){
    jlcDshState.error=String(error.message||error);
    JlcDshUpdateStatus({phase:'error',message:'DSH 页面启动失败：'+jlcDshState.error});
  }
}
function JlcDshAttachFrame(frame) {
  if(frame===jlcDshFrame)return;
  jlcDshFrame=frame;
  if(frame)JlcDshLoadFrame();
}
function JlcDshPlaceholder() {
  const status=Te().useSyncExternalStore(JlcDshSubscribeStatus,JlcDshStatusSnapshot);
  return (0,CKe.jsx)('div',{id:'jlc-dsh-slot',style:{width:'100%',height:'100%',minHeight:0,display:'flex',flexDirection:'column',background:'#fff',overflow:'hidden',position:'relative',isolation:'isolate'},children:[
    (0,CKe.jsx)('div',{id:'jlc-dsh-startup',style:{padding:'16px',color:'#777',fontSize:'13px',flex:'none',display:status.phase==='ready'?'none':''},children:[
      (0,CKe.jsx)('div',{id:'jlc-dsh-status',role:'status',children:status.message},'message'),
      (0,CKe.jsx)('button',{id:'jlc-dsh-retry',type:'button',hidden:!['error','stopped'].includes(status.phase),onClick:JlcDshLoadFrame,children:'重试'},'retry')
    ]},'startup'),
    (0,CKe.jsx)('iframe',{id:'jlc-dsh-frame',title:'JLCEDA Agent',sandbox:'allow-scripts allow-same-origin allow-forms allow-downloads',allow:'clipboard-read; clipboard-write',referrerPolicy:'no-referrer',style:{display:'block',border:0,width:'100%',flex:'1 1 0',minHeight:0},ref:JlcDshAttachFrame},'frame')
  ]});
}
function JlcDshIsSelected() { return !!window.jlcDSH&&jlcDshState.selected; }
function JlcDshSelection(tabId) { jlcDshState.selected=tabId==='jlc-dsh'; }
function JlcDshUpdateStatus(status) {
  if(!status||typeof status.phase!=='string'||typeof status.message!=='string')return;
  jlcDshState.status={phase:status.phase,message:status.message};
  for(const listener of jlcDshStatusListeners)listener();
}
function JlcDshMergeTabs(tabs,container) {
  if(container==='right-panel-tab-container'&&!tabs.some(tab=>tab.tabId==='jlc-dsh'))tabs.unshift({tabId:'jlc-dsh',title:'Agent',draggable:false,isAbleDelete:false});
  return tabs;
}
function JlcDshDomState() {
  const frame=document.getElementById('jlc-dsh-frame'),rect=frame?.getBoundingClientRect();
  return {...jlcDshState,activeTab:Et.containerInfo['right-panel-tab-container']?.activeTabId,mode:Et.containerInfo['right-panel-tab-container']?.currentMode,
    rect:rect?.toJSON(),visible:!!frame&&frame.checkVisibility({checkVisibilityCSS:true})&&rect.width>40&&rect.height>20,layout:Zu()};
}
async function JlcDshInitialize() {
  if(jlcDshState.initialized)return;
  if(!window.jlcDSH||typeof qr==='undefined'||typeof Et==='undefined'||!Et.containerInfo?.['right-panel-tab-container']||!document.getElementById('layout-right-tab-body')){
    jlcDshState.startupTimer=setTimeout(JlcDshInitialize,100);return;
  }
  jlcDshState.initialized=true;
  try{
    jlcDshState.error=null;
    jlcDshUnsubscribeStatus=window.jlcDSH.onStatus(JlcDshUpdateStatus);
    jlcDshUnsubscribeHealth=window.jlcDSH.onHealth(value=>JlcDshPost({type:'health',value}));
    window.jlcDSH.status().then(JlcDshUpdateStatus).catch(error=>{jlcDshState.error=String(error);});
    document.body.classList.add('jlc-dsh-enabled');
    const style=document.createElement('style');style.id='jlc-dsh-host-style';
    style.textContent='body.none-docs.jlc-dsh-enabled #layoutRight,body.none-docs.jlc-dsh-enabled #layout_toggler_right{display:block!important}#jlc-dsh{height:100%;width:100%;min-height:0;overflow:hidden}#jlc-dsh-slot{box-sizing:border-box}';
    document.head.appendChild(style);
    if(!document.getElementById('jlc-dsh'))Nwe('jlc-dsh',document.getElementById('layout-right-tab-body'),'right-panel-tab-container');
    jlcDshState.selected=true;qr.handleClick('jlc-dsh',false);
    const layout=Zu();layout.right.open=1;layout.right.right=Math.min(Math.max(layout.right.right||0,440),Math.max(280,window.innerWidth*.48));v2(layout);await Q3({layout});
    window.__JLC_DSH_DEBUG__={state:JlcDshDomState,select:tabId=>qr.handleClick(tabId,true),collapse:value=>ps('layout_toggler_right',!!value,true),
      resize:async width=>{const layout=Zu();layout.right.right=Math.max(280,Math.min(Number(width),window.innerWidth*.7));v2(layout);await Q3({layout});}};
    if(window.jlcDSH.isDebug)window.__JLC_DSH_DEBUG__.openLocalProject=file=>Ed({cPath:file});
  }catch(error){jlcDshState.error=String(error);console.error('[JLC DSH sidebar]',error);}
}
window.addEventListener('pagehide',()=>{
  clearTimeout(jlcDshState.startupTimer);window.removeEventListener('message',JlcDshOnFrameMessage);
  jlcDshUnsubscribeStatus?.();jlcDshUnsubscribeHealth?.();jlcDshProjectReadySubscription?.cancel();
  jlcDshStatusListeners.clear();
  jlcDshState.generation++;jlcDshFrame=null;jlcDshOrigin=null;
});
jlcDshState.startupTimer=setTimeout(JlcDshInitialize,100);
