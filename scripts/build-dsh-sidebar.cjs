'use strict';
// A reproducible customization of the installed, pinned rc.2 client artifacts.
// Original artifacts are hash-checked and retained as build inputs, never as a runtime fallback.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),cache=path.join(root,'.cache/dsh-sidebar-rc2');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function replace(s,from,to){if(s.split(from).length!==2)throw Error('Non-unique customization anchor: '+from.slice(0,100));return s.replace(from,to);}
function replaceCount(s,from,to,count){if(s.split(from).length-1!==count)throw Error('Unexpected artwork anchor count: '+from);return s.split(from).join(to);}
function between(s,start,end,to){const at=s.indexOf(start),until=s.indexOf(end,at+start.length);if(at<0||until<0||s.indexOf(start,at+1)>=0)throw Error('Unsupported function boundary');return replace(s,s.slice(at,until),to);}
const specs=[
  ['ui-workspace','52765aacb6c7f96327da5d8709d8cbb30dd2957d4744a42da04c18e07fe264e5',s=>{
    s=between(s,'\t\t\tstartSession(workspaceId, options) {','\t\t\tprepareDraft(binding, options) {',`\t\t\tstartSession(_workspaceId, options) {
                const project = this.ctx.get("jlcProject");
                if (!project) { this.notify({kind:"createFailed",message:this.ctx.locale.bind("workspace")("shortcut.noSession")}); return; }
                const {agentPreset,...draft}=options??{};
                if(agentPreset!==undefined)this.ctx.get("jlcSettingsNavigation").close();
                project.newConversation({agentPreset}).then(id=>{
                    if(draft.prompt!==undefined||draft.clearPreviousDraft===true){
                        const binding=this.sessions.binding(id);
                        if(!binding)this.draftPreparationFailed();
                        this.prepareDraft(binding,draft);
                    }
                }).catch(reason => this.notify({kind:"createFailed",message:reason.message}));
            }
`);
    // Register a directory without changing the currently bound conversation.
    s=replace(s,'startSession(workspaceId, { clearPreviousDraft: false });','// Project conversations are selected only by the EDA project controller.');
    return s;
  }],
  ['ui-conversation','8554738cbeeb5218ad1bfa4773ef094363b066d052a1893d7a96797c5bc33a63',s=>{
    s=between(s,'\t\tfunction WorkspaceChip(','\t\tconst HERO_SWIM_UP_PATH',`\t\tfunction WorkspaceChip({ label, t }) {
            return (0, react_jsx_runtime.jsxs)("span", {
                className: HeroShell_module_css_default.workspace,
                "data-jlc-project-workspace": true,
                "aria-label": t("hero.chooseWorkspace"),
                children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderOpenRegular,{size:16}),
                    (0, react_jsx_runtime.jsx)("span",{className:HeroShell_module_css_default.workspaceLabel,children:label ?? t("hero.chooseWorkspace")})]
            });
        }
`);
    s=replace(s,'(0, react_jsx_runtime.jsx)("span", {\n\t\t\t\t\t\t\t\tclassName: HeroShell_module_css_default.previewBadge,\n\t\t\t\t\t\t\t\tchildren: t("hero.preview")\n\t\t\t\t\t\t\t})','null');
    s=replace(s,'"hero.headline": "探索未至之境"','"hero.headline": "JLCEDA Agent"');
    s=replace(s,'"hero.headline": "Into the Unknown"','"hero.headline": "JLCEDA Agent"');
    s=replace(s,'"hero.chooseWorkspace": "选择工作区"','"hero.chooseWorkspace": "工程工作区"');
    s=replace(s,'"hero.chooseWorkspace": "Choose workspace"','"hero.chooseWorkspace": "Project workspace"');
    s=replace(s,'--meter-tint:var(--dsw-static-blue-450)','--meter-tint:var(--dsw-alias-brand-primary)');
    return s;
  }],
  ['ui-settings-models','190498e15358bcd3fe6810fe6368023a20b0403e3ea493bc979eca9bdb593b28',s=>{
    s=replace(s,'if (!("dshDesktop" in globalThis)) ctx.slots.inject("settings.onboarding", () => ctx.slots.register({\n\t\t\t\tname: "settings.onboarding",\n\t\t\t\tid: "welcome-notice",\n\t\t\t\torder: -100,\n\t\t\t\tinject: welcomeInjected\n\t\t\t}, WelcomeNotice));','// Project deployment omits the product preview step; credential onboarding remains.');
    s=replace(s,'id: "models",\n\t\t\t\torder: 10,','id: "models",\n\t\t\t\torder: -10,');
    return s;
  }],
  ['ui-settings-account','ec4ca325a530d68c7e69df5465b4ef82a257e2be179f32801bd4b17b13e89c8a',s=>{
    // Retain the Models sign-in slot and its authentication pages, removing only
    // the standalone account launcher/section that carries subscription and promotion.
    return between(s,'\t\t\tctx.slots.inject("settings.launcher",','\n\t\t}\n\t\t//#endregion','');
  }],
  ['ui-schedule','46f2cfd0bfc2be7ae2159a6f52f929911e0087b7b48c62de7f31c675fbe0a0a0',s=>{
    return between(s,'\t\t\tctx.slots.inject("main",','\t\t\tctx.uiConversation.events.register(scheduleTurnDefinition);',`\t\t\tctx.slots.inject("settings.section", () => ctx.slots.register({
                name: "settings.section", id: PANEL_ID, order: 25,
                locale: MANAGER_NS, label: () => t("panel"),
                inject: () => ({...detail,onNewTask: () => {ctx.uiWorkspace.startSession();}})
            }, props => (0,react_jsx_runtime.jsx)("div",{
                "data-jlc-automation-settings":true,style:{height:"100%",minHeight:360,minWidth:0},
                children:(0,react_jsx_runtime.jsx)(TaskManagerPage,{...props,
                    onNewTask:()=>{props.close();props.onNewTask();},
                    onOpenSession:id=>{props.close();props.onOpenSession(id);}
                })
            })));
`);
  }],
  ['ui-plugin-manager','b4efaa441258a547a0d7b3cab559fe073c69e69fe2bbb617c710ded134e7c4f9',s=>{
    s=replace(s,'ctx.slots.inject("main", function* () {','ctx.slots.inject("settings.section", function* () {');
    s=replace(s,'name: "main",\n\t\t\t\t\tkey: PANEL_ID,','name: "settings.section",\n\t\t\t\t\tid: "plugin-manager", order: 20, label: () => t("panel"),');
    s=replace(s,'}, PluginManagerPage);','}, props => (0,react_jsx_runtime.jsx)("div",{"data-jlc-plugin-manager-settings":true,style:{height:"100%",minHeight:360,minWidth:0},children:(0,react_jsx_runtime.jsx)(PluginManagerPage,props)}));');
    s=replace(s,'ctx.layout.selectPanel(PANEL_ID);','ctx.get("jlcSettingsNavigation").openSection("plugin-manager");');
    return between(s,'\t\t\tctx.slots.inject("sidebar.panellist",','\n\t\t}\n\t\t//#endregion','');
  }],
  ['ui-settings-general','fb6c8d32d1994454578caa31cc975575a789e11f0afd6d3c19fe769f47050f7e',s=>{
    s=replace(s,'\t\tfunction navIcon(id) {',`\t\tfunction navIcon(id) {
            if (id === "plugin-manager") return (0,react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPluginPinwheelOutlineRegular,{className:SettingsRoot_module_css_default.navIcon,size:16});
            if (id === "schedules") return (0,react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconClockOutlineRegular,{className:SettingsRoot_module_css_default.navIcon,size:16});`);
    const responsive=`.VOzbGW_panel{width:1180px;height:min(920px,calc(100dvh - 32px));max-width:calc(100vw - 32px)}.VOzbGW_content{min-height:0}.VOzbGW_options{padding:0 16px 16px}@media(max-width:600px){.VOzbGW_panel{flex-direction:column;max-width:calc(100vw - 24px);height:calc(100dvh - 24px)}.VOzbGW_nav{width:100%;padding:14px 12px 0;gap:12px}.VOzbGW_navTitle{min-height:28px;padding:0 4px}.VOzbGW_navList{flex-direction:row;flex-wrap:wrap;overflow:visible;gap:4px}.VOzbGW_navCell{flex:none;height:36px;padding:7px 10px;gap:6px}.VOzbGW_navLabel{flex:none}.VOzbGW_header{position:absolute;right:12px;top:14px;height:28px;padding:0}.VOzbGW_options{padding:12px}}`;
    s=replace(s,'tag.textContent = css$7;','tag.textContent = css$7 + '+JSON.stringify(responsive)+';');
    s=replace(s,'const disposeCommand = ctx.shortcuts.register({','const disposeSettingsNavigation = ctx.reflect.provide("jlcSettingsNavigation", {openSection: id => shellInstance.actions.openSection(id),close:()=>shellInstance.actions.close()});\n\t\t\t\tconst disposeCommand = ctx.shortcuts.register({');
    return replace(s,'disposeCommand();\n\t\t\t\t\tdisposeSlot();','disposeSettingsNavigation();\n\t\t\t\t\tdisposeCommand();\n\t\t\t\t\tdisposeSlot();');
  }],
  ['ui-sidebar-right','55e410c962d9373ed6588b9ec6f5b848241e2979d1b7d578f149b2a23428ec14',s=>{
    s=between(s,'\t\t\t\tconst disposeExpand =','\t\t\t\tconst guideInjected =','');
    s=replace(s,'\n\t\t\t\t\tdisposeExpand();','');
    s=between(s,'const disposers = [shortcuts.register({','\t\t\tfor (const kind of ["split", "fullscreen"])','const disposers = [];\n');
    return between(s,'\t\tfunction PanelChrome(','\t\tfunction SidebarPanel(panel) {',`\t\tfunction PanelChrome({fullscreen,t,shortcuts,toggleFullscreen}) {
            const next=fullscreen?"push":"fullscreen",modeLabel=fullscreen?t("chrome.exitFullscreen"):t("chrome.toFullscreen"),mode=shortcuts.find(entry=>entry.id==="pane.fullscreen.toggle");
            return (0,react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip,{label:modeLabel,shortcutKeys:mode?.keys,side:"bottom",delayMs:500,
                children:(0,react_jsx_runtime.jsx)("button",{type:"button",className:SidebarRight_module_css_default.iconButton,"aria-label":modeLabel,"aria-keyshortcuts":mode?.aria,"data-sidebar-right-mode":next,onClick:toggleFullscreen,
                    children:fullscreen?(0,react_jsx_runtime.jsx)(ExitFullscreenGlyph,{}):(0,react_jsx_runtime.jsx)(FullscreenGlyph,{})})});
        }
`);
  }],
  ['ui-attachment','cdb497656ed0e66f011125df22791f6f579c85710d2d915020ddcfe6c0f58072',s=>{
    s=replace(s,'fill: "#679EFE"','fill: "var(--dsw-static-deepseek-400)"');
    return replace(s,'fill: "#3964FE"','fill: "var(--dsw-alias-brand-primary)"');
  }],
  ['ui-trajectory','b11426f89d3b4302964b491d7826a29fe3de390be4bbfae325375f54fe6919ad',s=>replaceCount(s,'var(--dsw-static-blue-500)','var(--dsw-alias-brand-primary)',2)],
  // Fixed-palette plugin artwork is bundled into the shared frontend, not a feature module.
  ['web-frontend','4bc914bfbb6adbdd63953a29f63835eb7127defd2a973149d64cdab489f1a9a5',s=>{
    s=replaceCount(s,'stroke:"#679EFE"','stroke:"var(--dsw-static-deepseek-400)"',2);
    s=replace(s,'fill:"#4561EE"','fill:"var(--dsw-alias-brand-primary)"');
    s=replace(s,'fill:"#658EFF"','fill:"var(--dsw-static-deepseek-400)"');
    s=replace(s,'stroke:"#658EFF"','stroke:"var(--dsw-static-deepseek-400)"');
    s=replace(s,'stopColor:"#69B9FF"','stopColor:"var(--dsw-static-deepseek-300)"');
    s=replace(s,'stopColor:"#324DE2"','stopColor:"var(--dsw-static-deepseek-600)"');
    s=replace(s,'stopColor:"#658EFF"','stopColor:"var(--dsw-static-deepseek-400)"');
    return replace(s,'rgb(101, 142, 255)','var(--dsw-static-deepseek-400)');
  },'runtime/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-CN7NIWNw.js'],
];
function build(){
  fs.mkdirSync(cache,{recursive:true});
  const edits=specs.map(([pkg,expected,transform,relative])=>{
    const file=path.join(root,relative||`runtime/node_modules/@deepseek-ai/dsh-client-${pkg}/lib/client.js`),input=path.join(cache,pkg+'.js');
    const current=fs.readFileSync(file,'utf8');
    if(!fs.existsSync(input)){if(hash(current)!==expected)throw Error('Unsupported rc.2 input: '+pkg);fs.writeFileSync(input,current);}
    const original=fs.readFileSync(input,'utf8');if(hash(original)!==expected)throw Error('Corrupt build input: '+pkg);
    const output=transform(original);
    if(current!==original&&current!==output)throw Error('Unexpected runtime customization: '+pkg);
    return {pkg,file,source:output,inputSha256:expected,outputSha256:hash(output),changed:current!==output};
  });
  for(const edit of edits){if(edit.changed)fs.writeFileSync(edit.file,edit.source);delete edit.source;}
  const report={date:new Date().toISOString(),base:'0.2.1-rc.2',runtimeFallback:false,edits};
  fs.writeFileSync(path.join(root,'evidence/dsh-sidebar-build.json'),JSON.stringify(report,null,2));
  console.log('Built project-bound DSH sidebar: '+edits.length+' pinned client artifacts.');
}
if(require.main===module)build();
module.exports={build};
