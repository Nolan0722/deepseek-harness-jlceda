// Runs in the sandboxed DSH iframe, before the client plugin. No Electron preload.
(() => {
  function resolveParentOrigin(){
    let origin='https://client';
    try{const listed=window.location&&window.location.ancestorOrigins;if(listed&&listed.length)origin=String(listed[0]);}catch{}
    if(origin==='https://client')return origin;
    try{const url=new URL(origin);if(url.origin===origin&&/^https:\/\/(?:[a-z0-9-]+\.)*(?:lceda\.cn|easyeda\.com)$/.test(origin))return origin;}catch{}
    return 'https://client';
  }
  const parentOrigin=resolveParentOrigin(),channel='jlc-dsh-frame-v1';
  if(window.parent===window)throw Error('JLC DSH requires its editor iframe');
  const pending=new Map(),listeners=new Set();let sequence=0,debug=false;
  function request(action,extra={}){
    return new Promise((resolve,reject)=>{
      const id=String(++sequence),timer=setTimeout(()=>{pending.delete(id);reject(Error('EDA host request timed out'));},20000);
      pending.set(id,{resolve,reject,timer});
      window.parent.postMessage({channel,type:'request',id,action,...extra},parentOrigin);
    });
  }
  window.addEventListener('message',event=>{
    if(event.source!==window.parent||event.origin!==parentOrigin||event.data?.channel!==channel)return;
    const message=event.data;
    if(message.type==='health'){for(const listener of listeners)listener(message.value);return;}
    if(message.type!=='response')return;
    const entry=pending.get(message.id);if(!entry)return;
    pending.delete(message.id);clearTimeout(entry.timer);message.ok?entry.resolve(message.value):entry.reject(Error(message.error));
  });
  const ready=request('ready').then(value=>{debug=value.debug===true;});
  window.jlcEDAContext=Object.freeze({get debug(){return debug;},ready,
    current:()=>ready.then(()=>request('current')),health:()=>ready.then(()=>request('health')),
    select:conversationId=>ready.then(()=>request('select',{conversationId})),
    onHealth:callback=>{listeners.add(callback);return()=>listeners.delete(callback);}});
  window.addEventListener('pagehide',()=>{for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(Error('DSH frame closed'));}pending.clear();listeners.clear();});
})();

window.__ModuleLoader__.load({id:'jlc-dsh-context',factory:require=>{
  const React=require('react');
  const {createPortal}=require('react-dom');
  const {IconSettingsOutlineRegular,IconFolderOpenRegular}=require('@deepseek-ai/dsh-client-ui-primitives');
  const h=React.createElement;
  const canonical=value=>(value||'').replaceAll('\\','/').toLowerCase();
  const projectKey=target=>JSON.stringify([target.projectId,canonical(target.projectPath),canonical(target.workspaceDirectory)]);
  const CSS=`
    .jlc-topbar,.jlc-eda-binding,.jlc-topbar__actions{display:contents;color:var(--dsw-alias-label-primary,#252a32);font-family:inherit;font-size:12px;line-height:18px}
    .jlc-topbar__button:hover,.jlc-eda-binding__mcp:hover{background:var(--dsw-alias-interactive-bg-hover,#eef3fa)}
    .jlc-topbar__button svg{flex:none}
    .jlc-eda-binding__directory,.jlc-sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    .jlc-eda-binding__mcp{position:relative;grid-column:4;grid-row:1;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:28px;height:28px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#5c6573);cursor:pointer}
    .jlc-connection-dot{position:absolute;right:2px;top:2px;width:5px;height:5px;border:1px solid var(--dsw-alias-bg-base,#fff);border-radius:50%;background:var(--dsw-alias-label-tertiary,#69717d)}
    [data-jlc-status="connected"] .jlc-connection-dot{background:var(--dsw-alias-state-success-primary,#28805c)}
    [data-jlc-status="attention"] .jlc-connection-dot{background:var(--dsw-alias-state-warning-primary,#c18b36)}
    [data-jlc-status="disconnected"] .jlc-connection-dot{background:var(--dsw-alias-state-error-primary,#c54141)}
    .jlc-binding-notice{display:flex;flex-direction:column;align-items:flex-start;gap:8px;min-width:0;margin-bottom:12px;padding:8px;border-radius:7px;background:color-mix(in srgb,#c18b36 10%,transparent);color:var(--dsw-alias-label-secondary,#5c6573);font-size:11px}
    .jlc-eda-binding__label{flex:1;min-width:0;overflow-wrap:anywhere}
    .jlc-eda-binding__button{appearance:none;box-sizing:border-box;display:inline-flex;flex:0 0 auto;align-items:center;justify-content:center;min-height:28px;max-width:100%;margin:0;padding:4px 9px;border:1px solid var(--dsw-alias-border-l1,#d5dce5);border-radius:6px;background:var(--dsw-specific-input-major,#fff);color:inherit;font:inherit;line-height:18px;white-space:normal;cursor:pointer}
    .jlc-eda-binding__button:hover{border-color:var(--jlc-accent,#5588ff);background:var(--dsw-specific-button-secondary-hover,#eef3fa)}
    .jlc-eda-binding__button:focus-visible{outline:2px solid var(--jlc-accent,#5588ff);outline-offset:2px}
    .jlc-eda-binding__button:disabled{opacity:.55;cursor:wait}
    .jlc-topbar__button{appearance:none;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:5px;width:28px;height:28px;margin:0;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#5c6573);font:inherit;cursor:pointer}
    .jlc-topbar__settings{grid-column:5;grid-row:1}
    .jlc-topbar__history{grid-column:1;grid-row:1}
    .jlc-topbar__button[aria-expanded="true"],.jlc-eda-binding__mcp[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover,#eef3fa);color:var(--jlc-accent,#5588ff)}
    .jlc-topbar__button:focus-visible,.jlc-eda-binding__mcp:focus-visible,.jlc-context-details button:focus-visible{outline:2px solid var(--jlc-accent,#5588ff);outline-offset:1px}
    .jlc-context-details{position:fixed;z-index:40;box-sizing:border-box;overflow:auto;padding:14px;border:1px solid var(--dsw-alias-border-l1,#d5dce5);border-radius:10px;background:var(--dsw-specific-input-major,#fff);color:var(--dsw-alias-label-primary,#252a32);box-shadow:0 8px 24px rgba(20,28,40,.12);font-family:inherit;font-size:12px}
    .jlc-context-details__heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
    .jlc-context-details h3{margin:0;font-size:12px;font-weight:600}
    .jlc-context-details dl{display:grid;grid-template-columns:70px minmax(0,1fr);gap:8px;margin:0 0 12px;font-size:11px;line-height:17px}
    .jlc-context-details dt{color:var(--dsw-alias-label-tertiary,#69717d)}
    .jlc-context-details dd{min-width:0;margin:0;overflow-wrap:anywhere}
    .jlc-context-details__diagnostics{padding:0;border:0;background:transparent;color:var(--jlc-accent,#5588ff);font:inherit;font-size:11px;cursor:pointer}
  `;
  function createProjectController(ctx){
    const listeners=new Set(),conversations=new Map();
    let snapshot={current:null,syncing:false,error:''},seenKey,pending=false,disposed=false;
    const publish=patch=>{if(disposed)return;snapshot={...snapshot,...patch};for(const listener of listeners)listener();};
    const source={subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener)},getSnapshot:()=>snapshot};
    async function openTarget(target,fresh=false,options={}){
      const key=projectKey(target),directory=target.workspaceDirectory;
      if(!directory)throw Error('当前工程没有可用的本地目录，无法自动设置工作区。');
      const workspace=await ctx.workspaces.create({path:directory});
      let id=!fresh&&conversations.get(key);
      if(!id||!ctx.sessions.list.getSnapshot().byId[id])id=await ctx.sessions.create({workspaceId:workspace.workspaceId,...(options.agentPreset===undefined?{}:{agentPreset:options.agentPreset})});
      const latest=await window.jlcEDAContext.current();
      if(projectKey(latest)!==key)throw Error('工程在切换工作区时发生变化，正在重新同步。');
      conversations.set(key,id);
      await window.jlcEDAContext.select(id);
      if(disposed)return id;
      ctx.uiWorkspace.openSession(id);
      seenKey=key;publish({current:latest,syncing:false,error:''});
      return id;
    }
    async function openCurrent(fresh=false,options={}){
      while(pending&&!disposed)await new Promise(resolve=>setTimeout(resolve,50));
      if(disposed)throw Error('工程侧栏已关闭。');
      pending=true;publish({syncing:true,error:''});
      try{return await openTarget(await window.jlcEDAContext.current(),fresh,options)}
      catch(error){publish({syncing:false,error:error.message});throw error}
      finally{pending=false;}
    }
    async function refresh(){
      if(pending||disposed)return;pending=true;
      try{
        const target=await window.jlcEDAContext.current(),key=projectKey(target);
        publish({current:target,error:target.projectId&&!target.workspaceDirectory?'此工程没有本地目录，工作区未自动切换。':''});
        if(key!==seenKey){
          if(target.workspaceDirectory){publish({syncing:true});await openTarget(target);}
          else{seenKey=key;publish({syncing:false,error:'此工程没有本地目录，工作区未自动切换。'});}
        }
      }catch(error){if(!disposed)publish({syncing:false,error:error.message})}
      finally{pending=false;}
    }
    const timer=setInterval(refresh,1500);refresh();
    return {source,openCurrent,dispose(){disposed=true;clearInterval(timer);listeners.clear();}};
  }
  return {inject:['slots','sessions','uiWorkspace','workspaces','locale'],async apply(ctx){
    await window.jlcEDAContext.ready;
    const style=document.createElement('style');style.textContent=CSS;style.id='jlc-eda-binding-style';document.head.appendChild(style);
    const controller=createProjectController(ctx);
    ctx.provide('jlcProject',{newConversation:options=>controller.openCurrent(true,options)});
    ctx.effect(()=>()=>{controller.dispose();style.remove();},'jlc-eda project workspace lifecycle');
    // These are project deployment occupants of the official branding/settings slots.
    ctx.effect(()=>ctx.locale.register('jlceda.sidebar',{
      zh:{name:'JLCEDA Agent',settings:'设置',history:'工程与会话',sessions:'会话',details:'工程与连接',close:'关闭详情',connected:'已连接',connecting:'连接中',disconnected:'未连接',diagnostics:'连接与诊断',engine:'由 DeepSeek Harness 驱动',refresh:'刷新状态',waiting:'正在读取实际状态…',project:'工程',directory:'工程目录',window:'EDA 窗口',document:'活动文档',connection:'MCP 连接',none:'未打开',unavailable:'暂不可用'},
      en:{name:'JLCEDA Agent',settings:'Settings',history:'Projects & sessions',sessions:'Sessions',details:'Project & connection',close:'Close details',connected:'Connected',connecting:'Connecting',disconnected:'Offline',diagnostics:'Connection & diagnostics',engine:'Powered by DeepSeek Harness',refresh:'Refresh status',waiting:'Reading live state…',project:'Project',directory:'Project directory',window:'EDA window',document:'Active document',connection:'MCP connection',none:'Not open',unavailable:'Unavailable'},
    }),'jlc-sidebar dictionaries');
    const sidebarCSS=document.createElement('style');sidebarCSS.textContent=`
      html:root[data-jlc-theme="brand"] body{
        --jlc-accent:#5588ff;
        --dsw-static-deepseek-50:color-mix(in srgb,var(--jlc-accent) 6%,white);
        --dsw-static-deepseek-100:color-mix(in srgb,var(--jlc-accent) 12%,white);
        --dsw-static-deepseek-200:color-mix(in srgb,var(--jlc-accent) 22%,white);
        --dsw-static-deepseek-300:color-mix(in srgb,var(--jlc-accent) 38%,white);
        --dsw-static-deepseek-400:color-mix(in srgb,var(--jlc-accent) 65%,white);
        --dsw-static-deepseek-450:color-mix(in srgb,var(--jlc-accent) 85%,white);
        --dsw-static-deepseek-500:var(--jlc-accent);
        --dsw-static-deepseek-600:color-mix(in srgb,var(--jlc-accent) 88%,black);
        --dsw-static-deepseek-700-delete:color-mix(in srgb,var(--jlc-accent) 70%,black);
        --dsw-static-deepseek-800:color-mix(in srgb,var(--jlc-accent) 36%,#1b1b1f);
        --dsw-static-deepseek-900:color-mix(in srgb,var(--jlc-accent) 18%,#1b1b1f);
        --dsw-gradient-onboarding-blue-stops:var(--dsw-static-deepseek-600) 18.75%,var(--jlc-accent) 51.78%,var(--dsw-static-deepseek-300) 86.252%,var(--dsw-static-deepseek-600);
        --dsw-alias-bg-document-selection:color-mix(in srgb,var(--jlc-accent) 40%,transparent);
        --dsw-alias-label-deep-diving:color-mix(in srgb,var(--jlc-accent) 70%,#1b1b1f);
        --dsw-alias-label-deep-diving-shimmer:color-mix(in srgb,var(--jlc-accent) 30%,#1b1b1f);
        --dsw-alias-brand-primary:var(--jlc-accent);
        --dsw-alias-brand-text:var(--jlc-accent);
        --dsw-alias-brand-primary-new-colorprimary-new-color:var(--jlc-accent);
        --dsw-alias-button-primary-fill:var(--jlc-accent);
        --dsw-alias-button-info-fill:var(--jlc-accent);
        --dsw-alias-button-primary-hover:color-mix(in srgb,var(--jlc-accent) 88%,black);
        --dsw-alias-button-info-hover:color-mix(in srgb,var(--jlc-accent) 88%,black);
        --dsw-alias-state-business-primary:var(--jlc-accent);
        --dsw-alias-state-business-tertiary:color-mix(in srgb,var(--jlc-accent) 16%,transparent);
        --dsw-alias-link:var(--jlc-accent);
        --dsw-alias-onboarding-accent:var(--jlc-accent);
        --dsw-focus-ring-color:var(--jlc-accent);
      }
      html:root[data-jlc-theme="brand"] body[data-ds-dark-theme]{
        --dsw-alias-label-deep-diving:color-mix(in srgb,var(--jlc-accent) 55%,var(--dsw-static-neutral-bluish-400));
        --dsw-alias-label-deep-diving-shimmer:color-mix(in srgb,var(--jlc-accent) 35%,white);
      }
      .jlc-sidebar-brand{display:flex;align-items:center;gap:7px;min-width:0;font-weight:600;font-size:14px;color:inherit}
      .jlc-sidebar-action{display:flex;align-items:center;gap:9px;min-height:36px;width:100%;padding:8px;border:0;border-radius:7px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
      .jlc-sidebar-action:hover{background:var(--dsw-specific-button-secondary-hover,#eef3fa)}
      .jlc-sidebar-action:focus-visible{outline:2px solid var(--jlc-accent);outline-offset:-2px}
      .jlc-sidebar-action[data-wide="false"]{justify-content:center;padding:7px}
      .jlc-sidebar-diagnostics{padding:16px;min-width:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-primary,#252a32)}
      .jlc-sidebar-diagnostics dl{display:grid;grid-template-columns:90px minmax(0,1fr);gap:9px;margin:18px 0}
      .jlc-sidebar-diagnostics dd{margin:0;overflow-wrap:anywhere;white-space:pre-wrap}
      .jlc-sidebar-diagnostics dt,.jlc-sidebar-engine{color:var(--dsw-alias-label-tertiary,#69717d)}
      .wSkVaW_header{position:relative;display:grid !important;grid-template-columns:28px minmax(0,1fr) auto 28px 28px;grid-template-rows:28px;align-items:center;column-gap:4px;row-gap:0;box-sizing:border-box;width:100%;min-width:0;min-height:0 !important;padding:6px 8px !important;overflow:visible !important;border-bottom:1px solid var(--dsw-alias-border-l3,#e1e5eb);background:var(--dsw-alias-bg-base,#fff)}
      .wSkVaW_headerLeading,.wSkVaW_titleRow,.wSkVaW_titleCluster{display:contents !important}
      .wSkVaW_crumbs{grid-column:2;grid-row:1;display:flex;min-width:0;overflow:hidden;padding:0 2px}
      .wSkVaW_crumbSeg{min-width:0;flex:0 1 auto}
      .wSkVaW_crumb,.wSkVaW_crumbCurrent{display:block;max-width:100%;min-width:0;padding:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:500;line-height:20px;color:var(--dsw-alias-label-primary,#252a32)}
      .wSkVaW_headerActions{grid-column:3;grid-row:1;display:flex;align-items:center;gap:4px;min-width:0;max-width:88px;margin:0;overflow:hidden}
      .SVAs4q_label{display:block !important;box-sizing:border-box;min-width:0;max-width:88px;height:26px;margin:0;padding:3px 5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#5c6573);font-size:11px;line-height:20px}
      .SVAs4q_label svg{display:inline-block;vertical-align:-3px;margin-right:4px}
      .wSkVaW_headerUtilities:empty{display:none}
      .wSkVaW_headerCorner:not(:has(button)){display:none !important}
      .pI_x6G_handle[data-side="sidebar"]{display:none !important}
      .pI_x6G_frame[data-animating]{transition:none !important}
      .hHd-Xa_logoRow,.hHd-Xa_footArea,.hHd-Xa_toggle,.hHd-Xa_topStrip,.hHd-Xa_panelList{display:none !important}
      .pI_x6G_centerCol{grid-column:2;grid-row:1;min-width:0}
      .pI_x6G_rightbarCol{grid-column:3;grid-row:1}
      .pI_x6G_sidebarCol{grid-column:1;grid-row:1;position:absolute !important;z-index:30;top:var(--jlc-topbar-height,40px);left:8px !important;right:auto;width:min(280px,calc(100% - 16px)) !important;height:auto !important;max-height:min(320px,calc(100% - var(--jlc-topbar-height,40px) - 16px)) !important;display:none !important;overflow:auto !important;border:1px solid var(--dsw-alias-border-l1,#e1e5eb) !important;border-radius:12px !important;background:var(--dsw-specific-sidebar-fill,#fff);box-shadow:0 12px 32px rgba(20,28,40,.16)}
      html[data-jlc-history="open"] .pI_x6G_sidebarCol{display:flex !important}
      html[data-jlc-history="open"] .hHd-Xa_root{width:100% !important;height:auto !important;max-height:inherit}
      html[data-jlc-history="open"] .YDXeBa_projectRow,html[data-jlc-history="open"] .YDXeBa_sessionRow{margin:4px 8px;min-height:36px;border:1px solid var(--dsw-alias-border-l1,#e1e5eb);border-radius:10px;background:var(--dsw-specific-input-major,#fff)}
    `;document.documentElement.dataset.jlcTheme='brand';document.head.appendChild(sidebarCSS);ctx.effect(()=>()=>{sidebarCSS.remove();delete document.documentElement.dataset.jlcTheme;},'jlc-sidebar styles');
    function Mark({size=24}){return h('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:'none','aria-hidden':true},
      h('rect',{x:5,y:5,width:14,height:14,rx:4,stroke:'currentColor',strokeWidth:1.6}),
      h('path',{d:'M9 9h6v6H9zM9 1v4m6-4v4M9 19v4m6-4v4M1 9h4m-4 6h4M19 9h4m-4 6h4',stroke:'currentColor',strokeWidth:1.6,strokeLinecap:'round'}));}
    function Brand({t}){return h('span',{className:'jlc-sidebar-brand','data-jlc-brand':true},t('name'));}
    function openSettings(){ctx.get('jlcSettingsNavigation').openSection('general');}
    function Diagnostics({t}){
      const [value,setValue]=React.useState(null),[error,setError]=React.useState('');
      async function read(){try{const [target,mcp]=await Promise.all([window.jlcEDAContext.current(),window.jlcEDAContext.health()]);setValue({target,mcp});setError('');}catch(e){setError(e.message);}}
      React.useEffect(()=>{let alive=true;Promise.all([window.jlcEDAContext.current(),window.jlcEDAContext.health()]).then(([target,mcp])=>{if(alive)setValue({target,mcp});},e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[]);
      const target=value?.target,mcp=value?.mcp;
      const rows=target?[[t('project'),target.projectName||t('none')],[t('directory'),target.projectDirectory||t('none')],[t('window'),String(target.windowId)],[t('document'),target.documentName||target.documentId||t('none')],[t('connection'),`${mcp.phase} · Bridge ${mcp.bridgeHealthy?'✓':'—'} · ${mcp.bridgeVersion||mcp.serverVersion||''}`]]:[];
      return h('section',{className:'jlc-sidebar-diagnostics','data-jlc-diagnostics':true},h('h3',null,t('diagnostics')),
        error?h('p',{role:'alert'},error):!value?h('p',{role:'status'},t('waiting')):h('dl',null,...rows.flatMap(([label,text])=>[h('dt',{key:label},label),h('dd',{key:label+'-value'},text)])),
        h('button',{className:'jlc-sidebar-action',type:'button',onClick:read},t('refresh')),
        h('p',{className:'jlc-sidebar-engine'},t('engine'),' · DSH 0.2.1-rc.2'));
    }
    for(const [name,Component] of [['sidebar.brand.mark',Mark],['sidebar.brand.name',Brand],['conversation.hero.brand.mark',Mark]])
      ctx.slots.inject(name,()=>ctx.slots.register({name,locale:'jlceda.sidebar'},Component));
    ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'jlceda-diagnostics',order:90,label:()=>ctx.locale.bind('jlceda.sidebar')('diagnostics'),locale:'jlceda.sidebar'},Diagnostics));
    const subscribeSessions=listener=>ctx.sessions.list.subscribe(listener);
    const currentSessionId=()=>Object.values(ctx.sessions.list.getSnapshot().byId).find(row=>(row.retainedBy?.mainView??0)>0)?.id||'';
    function Binding(){
      const project=React.useSyncExternalStore(controller.source.subscribe,controller.source.getSnapshot);
      const sessionId=React.useSyncExternalStore(subscribeSessions,currentSessionId);
      const cwd=React.useSyncExternalStore(subscribeSessions,()=>ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd||'');
      const sessionTitle=React.useSyncExternalStore(subscribeSessions,()=>ctx.sessions.list.getSnapshot().byId[sessionId]?.displayTitle||'新会话');
      const [historyOpen,setHistoryOpen]=React.useState(false),[detailsOpen,setDetailsOpen]=React.useState(false);
      const barRef=React.useRef(null),historyRef=React.useRef(null),detailsRef=React.useRef(null),detailsCloseRef=React.useRef(null),detailsTriggerRef=React.useRef(null);
      React.useEffect(()=>{
        if(historyOpen)document.documentElement.dataset.jlcHistory='open';
        else delete document.documentElement.dataset.jlcHistory;
        return()=>{delete document.documentElement.dataset.jlcHistory;};
      },[historyOpen]);
      React.useEffect(()=>{if(detailsOpen)detailsCloseRef.current?.focus();},[detailsOpen]);
      React.useLayoutEffect(()=>{
        if(!detailsOpen)return;
        const position=()=>{
          const anchor=detailsTriggerRef.current,panel=detailsRef.current;if(!anchor||!panel)return;
          const rect=anchor.getBoundingClientRect(),viewport=document.documentElement.clientWidth,width=Math.min(400,viewport-16);
          const left=Math.max(8,Math.min(rect.right-width,viewport-width-8)),top=rect.bottom+8;
          Object.assign(panel.style,{left:`${left}px`,top:`${top}px`,width:`${width}px`,maxHeight:`${Math.max(0,innerHeight-top-8)}px`});
        };
        position();const observer=new ResizeObserver(position);observer.observe(document.documentElement);
        window.addEventListener('resize',position);window.addEventListener('scroll',position,true);
        return()=>{observer.disconnect();window.removeEventListener('resize',position);window.removeEventListener('scroll',position,true);};
      },[detailsOpen]);
      React.useLayoutEffect(()=>{
        const bar=barRef.current;if(!bar)return;
        const host=bar.closest('.wSkVaW_header')||bar;
        const apply=()=>document.documentElement.style.setProperty('--jlc-topbar-height',`${host.offsetHeight}px`);
        apply();const observer=new ResizeObserver(apply);observer.observe(host);return()=>observer.disconnect();
      },[]);
      React.useEffect(()=>{
        if(!historyOpen&&!detailsOpen)return;
        const onPointerDown=event=>{
          const menu=document.querySelector('.pI_x6G_sidebarCol');
          if(barRef.current?.contains(event.target)||detailsRef.current?.contains(event.target))return;
          if(historyOpen&&menu?.contains(event.target)){if(event.target.closest('.YDXeBa_sessionRow'))setHistoryOpen(false);return;}
          setHistoryOpen(false);setDetailsOpen(false);
        };
        const onKey=event=>{if(event.key!=='Escape')return;event.preventDefault();event.stopPropagation();setHistoryOpen(false);setDetailsOpen(false);(detailsOpen?detailsTriggerRef:historyRef).current?.focus();};
        document.addEventListener('click',onPointerDown);document.addEventListener('keydown',onKey,true);
        return()=>{document.removeEventListener('click',onPointerDown);document.removeEventListener('keydown',onKey,true);};
      },[historyOpen,detailsOpen]);
      const [state,setState]=React.useState(null),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(false);
      const [mcp,setMcp]=React.useState(null);
      React.useEffect(()=>{
        let alive=true,pending=false;
        const refresh=async()=>{if(pending)return;pending=true;try{const health=await window.jlcEDAContext.health();if(alive)setMcp(health);}catch{if(alive)setMcp({phase:'disconnected',bridgeHealthy:false,error:{message:'连接状态暂不可用'}});}finally{pending=false;}};
        const release=window.jlcEDAContext.onHealth(value=>{if(alive)setMcp(value);});
        refresh();const timer=setInterval(refresh,2500);return()=>{alive=false;clearInterval(timer);release();};
      },[]);
      React.useEffect(()=>{
        let alive=true,pending=false;setState(null);setError('');
        const refresh=async()=>{if(pending||!sessionId)return;pending=true;try{
          const value=await window.jlcEDAContext.select(sessionId);if(alive){setState(value);setError('');}
        }catch(e){if(alive)setError(e.message)}finally{pending=false;}};
        refresh();const timer=setInterval(refresh,2000);return()=>{alive=false;clearInterval(timer)};
      },[sessionId]);
      const current=state?.target;
      const wrongWorkspace=!!current?.workspaceDirectory&&canonical(cwd)!==canonical(current.workspaceDirectory);
      const mode=error||project.error?'error':project.syncing?'syncing':wrongWorkspace||state?.state==='stale'?'stale':state?'bound':'loading';
      const reasons={PROJECT_CHANGED:'此对话属于其他工程',OTHER_WINDOW:'此对话正在另一个 EDA 窗口中使用'};
      const projectName=current?.projectName||'未打开工程';
      const documentName=current?.documentId?(current.documentName||current.documentId):'工程首页';
      const label=error||project.error?'工程上下文暂不可用':project.syncing?'正在切换工程工作区…':wrongWorkspace?'会话工作区与当前工程不一致':!state?'正在确认 EDA 工程…':state.state==='bound'?'':reasons[state.reason]||'工程连接需要更新';
      const directory=current?.workspaceDirectory;
      const connected=mcp?.phase==='connected'&&mcp.bridgeHealthy===true;
      const mcpLabel=connected?`MCP 已连接 · EDA ${mcp.bridgeVersion||mcp.serverVersion||''}`:!mcp||['idle','starting','handshaking','reconnecting'].includes(mcp.phase)?'MCP 正在连接…':'MCP 未连接 · EDA 调用已暂停';
      const mcpDetail=mcp?`传输：${mcp.phase}；Bridge：${mcp.bridgeHealthy?'可用':'不可用'}；最近检查：${mcp.checkedAt||'尚未完成'}${mcp.error?`；${mcp.error.code||''} ${mcp.error.message||''}`:''}`:'等待真实 MCP 健康检查';
      async function act(){setBusy(true);try{
        if(state?.reason==='OTHER_WINDOW')await controller.openCurrent(true);
        else if(wrongWorkspace||project.error||state?.reason==='PROJECT_CHANGED')await controller.openCurrent();
        else await controller.openCurrent(true);
        setError('');
      }catch(e){setError(e.message)}finally{setBusy(false)}}
      const t=ctx.locale.bind('jlceda.sidebar');
      function toggleDetails(event){detailsTriggerRef.current=event.currentTarget;setHistoryOpen(false);setDetailsOpen(open=>!open);}
      function closeDetails(){setDetailsOpen(false);detailsTriggerRef.current?.focus();}
      const relation=label||'当前会话已绑定此 EDA 窗口与工程';
      const connectionPending=!mcp||['idle','starting','handshaking','reconnecting'].includes(mcp.phase);
      const status=!connected?(connectionPending?'connecting':'disconnected'):mode==='stale'||mode==='error'?'attention':mode==='bound'?'connected':'connecting';
      const detailsRows=[[t('project'),projectName],[t('document'),documentName],[t('directory'),directory||t('unavailable')],['当前会话',sessionTitle],['绑定关系',relation],['绑定工程',state?.project?.projectName||t('none')],['会话工作区',cwd||t('unavailable')],[t('connection'),mcpLabel],[t('window'),String(current?.windowId??'—')]];
      return h('div',{ref:barRef,className:'jlc-topbar'},
        h('section',{className:'jlc-eda-binding','data-jlc-binding':mode,'data-jlc-conversation':sessionId,'data-jlc-project':current?.projectId||'','data-jlc-document':current?.documentTabId||'','aria-label':'EDA 工程上下文'},
          h('button',{type:'button',className:'jlc-eda-binding__mcp','data-jlc-context-details':true,'data-jlc-mcp':connected?'connected':mcp?.phase||'loading','data-jlc-status':status,'aria-label':`${t('details')}：${mcpLabel}；${relation}`,'aria-expanded':detailsOpen,'aria-haspopup':'dialog','aria-controls':'jlc-context-details',title:`${t('details')} · ${relation}`,onClick:toggleDetails},
            h('svg',{width:16,height:16,viewBox:'0 0 16 16',fill:'none','aria-hidden':true},h('path',{d:'m6.2 9.8 3.6-3.6M5.7 11.7l-1 1a2.4 2.4 0 0 1-3.4-3.4l3-3a2.4 2.4 0 0 1 3.4 0m.6 3.4a2.4 2.4 0 0 0 3.4 0l3-3a2.4 2.4 0 0 0-3.4-3.4l-1 1',stroke:'currentColor',strokeWidth:1.2,strokeLinecap:'round',strokeLinejoin:'round'})),
            h('span',{className:'jlc-connection-dot','aria-hidden':true}),h('span',{className:'jlc-sr-only',role:'status','aria-live':'polite'},mcpLabel,'；',relation)),
          h('div',{className:'jlc-eda-binding__directory','data-jlc-workspace':directory||'',title:directory||''},directory?`工作目录 · ${directory}`:'未找到本地工程目录'),
          detailsOpen&&createPortal(h('section',{ref:detailsRef,id:'jlc-context-details',className:'jlc-context-details',role:'dialog','aria-modal':false,'aria-labelledby':'jlc-context-details-title'},
            h('div',{className:'jlc-context-details__heading'},h('h3',{id:'jlc-context-details-title'},t('details')),h('button',{ref:detailsCloseRef,type:'button',className:'jlc-topbar__button','aria-label':t('close'),onClick:closeDetails},h('svg',{width:14,height:14,viewBox:'0 0 16 16',fill:'none','aria-hidden':true},h('path',{d:'m4 4 8 8M12 4l-8 8',stroke:'currentColor',strokeWidth:1.4,strokeLinecap:'round'})))),
            label&&h('div',{className:'jlc-binding-notice'},h('span',{className:'jlc-eda-binding__label',role:'status','aria-live':'polite',title:error||project.error||label},label),
              (mode==='stale'||mode==='error')&&h('button',{className:'jlc-eda-binding__button',type:'button',onClick:act,disabled:busy||project.syncing},busy?'处理中…':state?.reason==='OTHER_WINDOW'?'在此窗口新建会话':wrongWorkspace||project.error||state?.reason==='PROJECT_CHANGED'?'切换到工程对话':'新建当前工程会话')),
            h('dl',null,...detailsRows.flatMap(([name,value])=>[h('dt',{key:name},name),h('dd',{key:name+'-value'},value)])),
            h('p',{className:'jlc-sidebar-engine'},mcpDetail),
            h('button',{type:'button',className:'jlc-context-details__diagnostics',onClick:()=>{setDetailsOpen(false);ctx.get('jlcSettingsNavigation').openSection('jlceda-diagnostics');}},t('diagnostics'))),document.body)),
        h('div',{className:'jlc-topbar__actions'},
          h('button',{ref:historyRef,type:'button',className:'jlc-topbar__button jlc-topbar__history','data-jlc-history':true,'aria-label':t('history'),title:t('history'),'aria-expanded':historyOpen,'aria-controls':'jlc-project-history',onClick:()=>{setDetailsOpen(false);setHistoryOpen(open=>!open);}},h(IconFolderOpenRegular,{size:16})),
          h('button',{type:'button',className:'jlc-topbar__button jlc-topbar__settings','data-jlc-settings':true,'data-jlc-settings-icon':'gear','aria-label':t('settings'),title:t('settings'),'aria-haspopup':'dialog',onClick:()=>{setHistoryOpen(false);setDetailsOpen(false);openSettings();}},h(IconSettingsOutlineRegular,{size:16}))));
    }
    if(window.jlcEDAContext?.debug)window.__JLC_DSH_CONTEXT_TEST__={
      create:options=>controller.openCurrent(true,options),open:id=>ctx.uiWorkspace.openSession(id),project:controller.source.getSnapshot,
      ui:()=>({panels:ctx.slots.entries('sidebar.panellist').map(e=>e.options.id),settings:ctx.slots.entries('settings.section').map(e=>e.options.id),headerUtilities:ctx.slots.entries('conversation.session.header.utilities').map(e=>e.options.id),onboarding:ctx.slots.entries('settings.onboarding').map(e=>e.options.id),views:ctx.slots.entries('conversation.view').map(e=>e.options.id),commands:ctx.get('shortcuts').catalog.getSnapshot().map(e=>e.id),workspaces:ctx.workspaces.list.getSnapshot().items.map(w=>({id:w.workspaceId,path:w.path,sessionIds:w.sessionIds})),sessions:Object.fromEntries(Object.entries(ctx.sessions.list.getSnapshot().byId).map(([id,s])=>[id,{id,cwd:s.cwd,title:s.displayTitle,blank:s.blank}]))}),
      newFromNavigation:()=>ctx.uiWorkspace.startSession(),
      toggleNavigation:()=>ctx.get('layout').toggleSidebar(),
      openGuidePreview:()=>ctx.get('sidebarRight').openTab('guide'),
      closeGuidePreview:()=>ctx.get('sidebarRight').toggleExpanded(),
      async forgetFixtureWorkspace(){
        const rows=ctx.workspaces.list.getSnapshot().items.filter(row=>canonical(row.path).endsWith('/lab/workspace-switch-fixture/project-b'));
        for(const row of rows)await ctx.workspaces.delete(row.workspaceId);
        return rows.length;
      },
    };
    let pendingExpand=false;
    function pinSidebar(){
      const frame=document.querySelector('.pI_x6G_frame');if(!frame)return;
      const history=frame.querySelector('.pI_x6G_sidebarCol');if(history){history.id='jlc-project-history';history.setAttribute('aria-label',ctx.locale.bind('jlceda.sidebar')('history'));}
      if(frame.hasAttribute('data-sidebar-collapsed')){
        if(!pendingExpand){pendingExpand=true;ctx.get('layout').toggleSidebar();setTimeout(()=>{pendingExpand=false;pinSidebar();},80);}
        return;
      }
      const columns=frame.style.gridTemplateColumns;
      if(columns&&!/^0px/.test(columns.trim()))frame.style.gridTemplateColumns=columns.replace(/^[\d.]+px/,'0px');
    }
    const sidebarObserver=new MutationObserver(()=>pinSidebar());
    const watchSidebar=()=>{const frame=document.querySelector('.pI_x6G_frame');if(!frame)return false;sidebarObserver.observe(frame,{attributes:true,attributeFilter:['style']});pinSidebar();return true;};
    if(!watchSidebar()){const boot=setInterval(()=>{if(watchSidebar())clearInterval(boot);},200);ctx.effect(()=>()=>clearInterval(boot),'jlc-sidebar pin boot');}
    ctx.effect(()=>()=>{pendingExpand=false;sidebarObserver.disconnect();delete document.documentElement.dataset.jlcHistory;},'jlc-sidebar pin');
    ctx.slots.inject('conversation.header.leading',()=>ctx.slots.register({name:'conversation.header.leading',id:'jlc-eda-topbar',locale:'jlceda.sidebar'},Binding));
  }};
}});
