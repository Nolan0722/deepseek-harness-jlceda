'use strict';
// UI-only deployment choices. Workspace, native MCP and permission services stay intact.
const hiddenUi=[
  'ui-deepseek-model-label-1017',
  'ui-sidebar-browser','ui-sidebar-terminal','ui-sidebar-files','ui-open-in-app','ui-message-feedback','ui-brand-official',
];
function sidebarProfile(){return hiddenUi.map(id=>({id,disabled:true}));}
module.exports={hiddenUi,sidebarProfile};
