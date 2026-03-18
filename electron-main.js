const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const PORT = 3333;
let autoUpdater = null;
let pendingManualUpdateCheck = false;
/** แจ้งหน้า login เมื่อมีอัปเดต (จาก GitHub Releases) */
let pendingUpdateInfo = null;
const APP_DIR = __dirname;
let mainWindow = null;
let tray = null;
let serverProcess = null;

function getTrayIcon() {
  const size = 32;
  const canvas = Buffer.alloc(size * size * 4);
  const center = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = x - center, dy = y - center;
      const d = Math.sqrt(dx * dx + dy * dy);
      const inCircle = d <= center - 1;
      const inInner = d <= center - 4;
      if (inCircle && !inInner) {
        canvas[i] = 0;     // R
        canvas[i+1] = 212; // G
        canvas[i+2] = 170; // B
        canvas[i+3] = 255;
      } else {
        canvas[i] = 13;
        canvas[i+1] = 15;
        canvas[i+2] = 20;
        canvas[i+3] = inCircle ? 255 : 0;
      }
    }
  }
  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

function startServer() {
  return new Promise((resolve, reject) => {
    try {
      const { app: expressApp, PORT: serverPort } = require('./server.js');
      const http = require('http');
      const server = http.createServer(expressApp);
      server.listen(serverPort, '127.0.0.1', () => {
        resolve();
      });
      serverProcess = server;
    } catch (e) {
      reject(e);
    }
  });
}

function createWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 640,
    minHeight: 480,
    maximizable: false,
    resizable: false,
    frame: false,
    icon: path.join(APP_DIR, 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(APP_DIR, 'preload.js')
    },
    show: false,
    title: 'NKBKConnext System - ระบบตรวจสอบและจัดการข้อมูลสหกรณ์'
  });

  ipcMain.on('window-minimize', () => { if (mainWindow) mainWindow.minimize(); });
  ipcMain.on('window-close', () => {
    if (mainWindow) mainWindow.hide();
  });

  ipcMain.on('open-webview-login', (event, { url, username, password, database }) => {
    if (!url || typeof url !== 'string') return;
    const win = new BrowserWindow({
      width: 1000,
      height: 700,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      },
      title: 'เว็บไซต์ - NKBKConnext System'
    });
    win.loadURL(url);
    const dbStr = typeof database === 'string' ? database : '';
    const userStr = typeof username === 'string' ? username : '';
    const passStr = typeof password === 'string' ? password : '';
    const injectScript = `
      (function() {
        var db = ${JSON.stringify(dbStr)};
        var user = ${JSON.stringify(userStr)};
        var pass = ${JSON.stringify(passStr)};
        var setInput = function(el, val) {
          if (!el) return;
          var d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
          if (d && d.set) {
            d.set.call(el, val);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        };
        var typeIntoInput = function(el, val) {
          if (!el || !val) return;
          el.focus();
          var d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
          var setter = d && d.set;
          for (var i = 0; i < val.length; i++) {
            var v = val.slice(0, i + 1);
            if (setter) setter.call(el, v);
            else el.value = v;
            try {
              el.dispatchEvent(new InputEvent('input', { data: val[i], inputType: 'insertText', bubbles: true }));
            } catch (e) {
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        var form = document.querySelector('form');
        if (!form) form = document.querySelector('form#form1');
        if (!form) return;
        var selects = form.querySelectorAll('select');
        var labels = form.querySelectorAll('label');
        var userInput = form.querySelector('#TbUsername') || form.querySelector('input[name="TbUsername"]');
        var passInput = form.querySelector('#TbPassword') || form.querySelector('input[name="TbPassword"]') || form.querySelector('input[type="password"]');
        var loginBtn = form.querySelector('#BtLogIn') || form.querySelector('input[name="BtLogIn"]') || form.querySelector('input[value="เข้าใช้งาน"]');
        if (!userInput) {
          for (var i = 0; i < labels.length; i++) {
            var t = (labels[i].textContent || '').toLowerCase();
            if (t.indexOf('ชื่อผู้ใช้') >= 0 || t.indexOf('username') >= 0) {
              var forId = labels[i].getAttribute('for');
              if (forId) userInput = document.getElementById(forId);
              break;
            }
          }
        }
        if (!passInput) {
          for (var j = 0; j < labels.length; j++) {
            var s = (labels[j].textContent || '').toLowerCase();
            if (s.indexOf('รหัสผ่าน') >= 0 || s.indexOf('password') >= 0) {
              var fid = labels[j].getAttribute('for');
              if (fid) passInput = document.getElementById(fid);
              break;
            }
          }
        }
        if (db && selects.length > 0) {
          var sel = selects[0];
          sel.value = db;
          if (sel.value !== db) {
            var opt = Array.from(sel.options).find(function(o) { return o.value === db || o.text.trim() === db; });
            if (opt) sel.value = opt.value;
          }
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (userInput && userInput.tagName === 'INPUT') setInput(userInput, user);
        if (passInput && passInput.tagName === 'INPUT') setInput(passInput, pass);
        if (!loginBtn) {
          var nodes = form.querySelectorAll('input[type="submit"], input[type="button"], button');
          for (var k = 0; k < nodes.length; k++) {
            var v = (nodes[k].value || nodes[k].textContent || '').trim();
            if (v.indexOf('เข้าใช้งาน') >= 0 || v.indexOf('เข้าสู่ระบบ') >= 0) { loginBtn = nodes[k]; break; }
          }
        }
        setTimeout(function() {
          if (userInput && userInput.tagName === 'INPUT') setInput(userInput, user);
          if (passInput && passInput.tagName === 'INPUT') setInput(passInput, pass);
          if (loginBtn) {
            try { loginBtn.click(); } catch (e) { form.submit(); }
          } else {
            form.submit();
          }
        }, 400);
      })();
    `;
    win.webContents.once('did-finish-load', () => {
      var run = "setTimeout(function() { " + injectScript + " }, 1000);";
      win.webContents.executeJavaScript(run).catch(function(){});
    });
    win.on('closed', () => {});
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}/`);
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    Menu.setApplicationMenu(null);
  });
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function getStartupShortcutPath() {
  const startup = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
  return path.join(startup, 'NKBKConnext System.lnk');
}

function isStartupEnabled() {
  try {
    return fs.existsSync(getStartupShortcutPath());
  } catch {
    return false;
  }
}

function setStartup(enabled) {
  const shortcutPath = getStartupShortcutPath();
  const startupDir = path.dirname(shortcutPath);
  if (!fs.existsSync(startupDir)) return;
  try {
    if (enabled) {
      const target = process.execPath;
      const args = [APP_DIR];
      const wsh = require('child_process').execSync('where wscript', { encoding: 'utf8' }).trim().split('\n')[0];
      const esc = (p) => p.replace(/\\/g, '\\\\');
      const vbs = `
Set WshShell = CreateObject("WScript.Shell")
Set shortcut = WshShell.CreateShortcut("${esc(shortcutPath)}")
shortcut.TargetPath = "${esc(target)}"
shortcut.Arguments = Chr(34) & "${esc(APP_DIR)}" & Chr(34)
shortcut.WorkingDirectory = "${esc(APP_DIR)}"
shortcut.Description = "NKBKConnext System"
shortcut.Save
`;
      const vbsPath = path.join(APP_DIR, 'create-shortcut.vbs');
      fs.writeFileSync(vbsPath, vbs, 'utf8');
      require('child_process').execSync(`cscript //nologo "${vbsPath}"`);
      try { fs.unlinkSync(vbsPath); } catch (_) {}
    } else {
      if (fs.existsSync(shortcutPath)) fs.unlinkSync(shortcutPath);
    }
  } catch (e) {
    console.error('Startup setting failed', e);
  }
}

function createTray() {
  let iconPath = path.join(APP_DIR, 'assets', 'icon.png');
  try {
    if (!fs.existsSync(iconPath)) iconPath = null;
  } catch (_) {}
  const icon = iconPath
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : getTrayIcon().resize({ width: 16, height: 16 });

  tray = new Tray(icon);
  tray.setToolTip('NKBKConnext System - ระบบตรวจสอบและจัดการข้อมูลสหกรณ์');
  updateTrayMenu();
  tray.on('double-click', () => createWindow());
}

function checkForUpdatesManual() {
  if (!autoUpdater) {
    dialog.showMessageBox({
      title: 'NKBKConnext System',
      message: 'การอัปเดตอัตโนมัติใช้ได้เฉพาะตัวที่ติดตั้งจาก installer (ไม่ใช่โหมด npm start)'
    });
    return;
  }
  pendingManualUpdateCheck = true;
  autoUpdater.checkForUpdates().catch((e) => {
    pendingManualUpdateCheck = false;
    dialog.showMessageBox({ type: 'warning', title: 'NKBKConnext System', message: 'ตรวจสอบอัปเดตไม่สำเร็จ: ' + (e.message || String(e)) });
  });
}

function broadcastUpdateToRenderer(info) {
  pendingUpdateInfo = { version: (info && info.version) || '' };
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('app-update-available', pendingUpdateInfo);
    } catch (_) {}
  }
}

function setupAutoUpdater() {
  if (!app.isPackaged) return;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
    autoUpdater.autoDownload = false;
    autoUpdater.on('update-available', (info) => {
      const ver = (info && info.version) || '';
      if (pendingManualUpdateCheck) {
        pendingManualUpdateCheck = false;
        dialog.showMessageBox({
          type: 'info',
          buttons: ['ภายหลัง', 'ดาวน์โหลด'],
          defaultId: 1,
          cancelId: 0,
          title: 'NKBKConnext System',
          message: 'มีเวอร์ชันใหม่ ' + ver + ' ต้องการดาวน์โหลดหรือไม่?'
        }).then(({ response }) => {
          if (response === 1) autoUpdater.downloadUpdate();
        });
        return;
      }
      broadcastUpdateToRenderer(info);
    });
    autoUpdater.on('update-downloaded', () => {
      dialog.showMessageBox({
        type: 'info',
        buttons: ['รีสตาร์ทและติดตั้ง', 'ทีหลัง'],
        defaultId: 0,
        title: 'NKBKConnext System',
        message: 'ดาวน์โหลดอัปเดตเสร็จแล้ว กดรีสตาร์ทเพื่อติดตั้งเวอร์ชันใหม่'
      }).then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall(false, true);
      });
    });
    autoUpdater.on('update-not-available', () => {
      if (pendingManualUpdateCheck) {
        pendingManualUpdateCheck = false;
        dialog.showMessageBox({ title: 'NKBKConnext System', message: 'คุณใช้เวอร์ชันล่าสุดแล้ว' });
      }
    });
    autoUpdater.on('error', (err) => {
      if (pendingManualUpdateCheck) {
        pendingManualUpdateCheck = false;
        dialog.showMessageBox({ type: 'warning', title: 'NKBKConnext System', message: 'อัปเดต: ' + (err.message || String(err)) });
      } else {
        console.warn('Auto-updater:', err.message);
      }
    });
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => {});
    }, 5000);
  } catch (e) {
    console.warn('electron-updater:', e.message);
  }
}

function updateTrayMenu() {
  const startupOn = isStartupEnabled();
  const menu = Menu.buildFromTemplate([
    { label: 'เปิดโปรแกรม', click: () => createWindow() },
    { type: 'separator' },
    {
      label: 'เปิดพร้อม Windows',
      type: 'checkbox',
      checked: startupOn,
      click: (item) => setStartup(item.checked)
    },
    { type: 'separator' },
    { label: 'ตรวจสอบอัปเดต', click: () => checkForUpdatesManual() },
    { type: 'separator' },
    { label: 'ออกจากโปรแกรม', click: () => quitApp() }
  ]);
  tray.setContextMenu(menu);
}

function quitApp() {
  app.isQuitting = true;
  if (mainWindow) mainWindow.destroy();
  if (tray) tray.destroy();
  if (serverProcess && serverProcess.close) {
    serverProcess.close();
    serverProcess = null;
  }
  app.quit();
}

ipcMain.handle('app-get-pending-update', () => pendingUpdateInfo);
ipcMain.handle('app-download-update', async () => {
  if (!autoUpdater) return { ok: false, error: 'no-updater' };
  try {
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
});

app.whenReady().then(async () => {
  // เก็บไฟล์ข้อมูลตรวจสอบบังคับคดีใน userData (เขียนได้) ไม่ใช้ path ใน app.asar
  process.env.LEDCK_DATA_DIR = app.getPath('userData');
  try {
    await startServer();
  } catch (e) {
    console.error('Server start failed', e);
    app.quit();
    return;
  }
  createTray();
  createWindow();
  setupAutoUpdater();
});

app.on('window-all-closed', (e) => {
  if (!app.isQuitting) e.preventDefault();
});

app.on('before-quit', () => {
  app.isQuitting = true;
});
