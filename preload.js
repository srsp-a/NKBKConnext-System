const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('app-get-version'),
  isPortableApp: () => ipcRenderer.invoke('app-is-portable-build'),
  isPackagedApp: () => ipcRenderer.invoke('app-is-packaged'),
  checkAppUpdatesNow: () => ipcRenderer.invoke('app-check-updates-now'),
  setMonitorPushToken: (token) => ipcRenderer.invoke('monitor-set-push-token', token),
  clearMonitorPushToken: () => ipcRenderer.invoke('monitor-clear-push-token'),
  openExternalUrl: (url) => ipcRenderer.invoke('shell-open-external', url),
  /** เปิด LINE OAuth ในหน้าต่าง Electron (session เดียวกับ login) */
  openLineOAuthWindow: (url) => ipcRenderer.invoke('open-line-oauth-window', url),
  /** main process ส่งเมื่อหน้าต่าง OAuth โหลด /api/line-login-callback แล้ว — ให้หน้า login poll ทันที */
  onLineOAuthDone: (cb) => {
    const ch = 'nkbk-line-oauth-done';
    ipcRenderer.removeAllListeners(ch);
    ipcRenderer.on(ch, (_e, payload) => {
      try {
        if (payload && payload.state && typeof cb === 'function') cb(String(payload.state));
      } catch (_) {}
    });
  },
  minimize: () => ipcRenderer.send('window-minimize'),
  close: () => ipcRenderer.send('window-close'),
  openWebviewLogin: (payload) => ipcRenderer.send('open-webview-login', payload),
  onUpdateAvailable: (cb) => {
    ipcRenderer.on('app-update-available', (_e, info) => cb(info));
  },
  /** สถานะ overlay อัปเดตแอป: idle | downloading | ready | error */
  onAppUpdateFlow: (cb) => {
    const ch = 'app-update-flow';
    ipcRenderer.removeAllListeners(ch);
    ipcRenderer.on(ch, (_e, state) => {
      try {
        if (typeof cb === 'function') cb(state);
      } catch (_) {}
    });
  },
  getAppUpdateFlowState: () => ipcRenderer.invoke('app-get-update-flow-state'),
  dismissAppUpdateFlow: () => ipcRenderer.invoke('app-dismiss-update-flow'),
  quitAndInstallAppUpdate: () => ipcRenderer.invoke('app-quit-and-install-update'),
  quitAppCompletely: () => ipcRenderer.send('app-quit-completely'),
  getPendingUpdate: () => ipcRenderer.invoke('app-get-pending-update'),
  downloadAppUpdate: () => ipcRenderer.invoke('app-download-update'),
  checkGithubRelease: () => ipcRenderer.invoke('github-check-update'),
  downloadGithubRelease: (opts) => ipcRenderer.invoke('github-download-update', opts || {}),
  /** แสดงแจ้งเตือนแบบ OS (Windows toast/Action Center) */
  showNativeNotification: (opts) => ipcRenderer.invoke('show-native-notification', opts || {}),
  onNativeNotificationClick: (cb) => {
    const ch = 'native-notification-click';
    ipcRenderer.removeAllListeners(ch);
    ipcRenderer.on(ch, (_e, payload) => {
      try { if (typeof cb === 'function') cb(payload); } catch (_) {}
    });
  }
});
