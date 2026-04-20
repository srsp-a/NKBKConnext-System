const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  firstRunDone: () => ipcRenderer.send('first-run-done')
});
