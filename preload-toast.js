const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('toastApi', {
  close: () => ipcRenderer.send('nkbk-app-toast-close'),
  /** phase: 'available' | 'ready' — action: 'later' | 'download' | 'restart' */
  updatePrompt: (phase, action) => ipcRenderer.send('nkbk-update-prompt', { phase, action })
});
