'use strict';
// UI-only deployment choices. Workspace, native MCP and permission services stay intact.
// directory-picker is the manual folder chooser; the EDA project controller creates workspaces.
const hiddenUi=[
  'ui-deepseek-model-label-1017',
  'ui-trajectory',
  'ui-sidebar-browser','ui-sidebar-terminal','ui-sidebar-files','ui-open-in-app','ui-message-feedback','ui-brand-official',
  'directory-picker',
];
function sidebarProfile(){return hiddenUi.map(id=>({id,disabled:true}));}
module.exports={hiddenUi,sidebarProfile};
