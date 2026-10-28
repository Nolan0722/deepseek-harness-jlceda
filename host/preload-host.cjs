// Concatenated into the actual sandboxed preload; no local require is needed.
{
  const { contextBridge, ipcRenderer } = require('electron');
  contextBridge.exposeInMainWorld('jlcDSH', {
    isDebug:ipcRenderer.sendSync('jlc-dsh:is-debug'),
    bootstrap: () => ipcRenderer.invoke('jlc-dsh:bootstrap'),
    frameRequest: value => ipcRenderer.invoke('jlc-dsh:frame-request', value),
    status: () => ipcRenderer.invoke('jlc-dsh:status'),
    onHealth: callback => {
      const handler = (_event, health) => callback(health);
      ipcRenderer.on('jlc-dsh:mcp-status', handler);
      return () => ipcRenderer.removeListener('jlc-dsh:mcp-status', handler);
    },
    onStatus: callback => {
      const handler = (_event, status) => callback(status);
      ipcRenderer.on('jlc-dsh:status', handler);
      return () => ipcRenderer.removeListener('jlc-dsh:status', handler);
    }
  });
}
