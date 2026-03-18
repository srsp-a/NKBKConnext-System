const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  close: () => ipcRenderer.send('window-close'),
  openWebviewLogin: (payload) => ipcRenderer.send('open-webview-login', payload),
  onUpdateAvailable: (cb) => {
    ipcRenderer.on('app-update-available', (_e, info) => cb(info));
  },
  getPendingUpdate: () => ipcRenderer.invoke('app-get-pending-update'),
  downloadAppUpdate: () => ipcRenderer.invoke('app-download-update')
});
