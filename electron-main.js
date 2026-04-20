const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

/** พอร์ตจริงหลัง listen (3333 ถูกใช้จะไล่ 3334, …) */
let serverListenPort = 3333;
let autoUpdater = null;
let pendingManualUpdateCheck = false;
/** แจ้งหน้า login เมื่อมีอัปเดต (จาก GitHub Releases) */
let pendingUpdateInfo = null;
const APP_DIR = __dirname;
let mainWindow = null;
let firstRunWindow = null;
/** หน้าต่าง LINE OAuth — ใช้ session เดียวกับ main เพื่อให้ BroadcastChannel ถึงหน้า login */
let lineOAuthWindow = null;
/** ป๊อปอัปสวยงาม (เวอร์ชันล่าสุด ฯลฯ) */
let appToastWindow = null;
/** ป๊อปอัปดาวน์โหลดอัปเดต NSIS (electron-updater) */
let updatePromptWindow = null;
/** สถานะอัปเดตแอป — ส่งไปหน้าโปรแกรม (overlay) */
let appUpdateFlowState = { phase: 'idle' };
let updateAvailableDebounceTimer = null;
let tray = null;
let serverProcess = null;

const RELEASES_URL = 'https://github.com/srsp-a/NKBKConnext-System/releases';

if (process.platform === 'win32') {
  try {
    app.setAppUserModelId('com.systemstatus.monitor');
  } catch (_) {}
}

/** ไอคอนสำหรับ .lnk บน Windows — ชี้ไฟล์ PNG บนดิสก์ (ไม่ใช้แค่ exe,0 ที่อาจไม่ตรงกับโลโก้แอป) */
function getWindowsShortcutIconLocation() {
  try {
    const candidates = [];
    if (app.isPackaged && process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'icon.png'));
    }
    candidates.push(path.join(APP_DIR, 'assets', 'icon.png'));
    for (const p of candidates) {
      if (!p || !fs.existsSync(p)) continue;
      const norm = p.replace(/\\/g, '/');
      if (norm.includes('.asar/')) continue;
      return `${path.normalize(p)},0`;
    }
  } catch (_) {}
  return null;
}

function getGithubRepoSlug() {
  try {
    const pkg = require(path.join(APP_DIR, 'package.json'));
    const u = (pkg.repository && pkg.repository.url) || '';
    const m = String(u).match(/github\.com[:/]([^/]+\/[^/.\s]+)/i);
    return m ? m[1].replace(/\.git$/i, '') : 'srsp-a/NKBKConnext-System';
  } catch (_) {
    return 'srsp-a/NKBKConnext-System';
  }
}

function semverNorm(v) {
  return String(v || '0').replace(/^v/i, '').trim();
}

function semverCompare(latest, current) {
  const a = semverNorm(latest).split('.').map((x) => parseInt(x, 10) || 0);
  const b = semverNorm(current).split('.').map((x) => parseInt(x, 10) || 0);
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const da = a[i] || 0;
    const db = b[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

async function fetchGithubLatestReleaseMeta() {
  const slug = getGithubRepoSlug();
  const url = `https://api.github.com/repos/${slug}/releases/latest`;
  const r = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'NKBKConnext-System-Portable-UpdateCheck'
    }
  });
  if (r.status === 404) {
    return { error: 'ยังไม่มี Release บน GitHub' };
  }
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    return { error: 'GitHub: ' + r.status + (t ? ' ' + t.slice(0, 100) : '') };
  }
  const rel = await r.json();
  const tag = semverNorm(rel.tag_name || rel.name || '0');
  const assets = Array.isArray(rel.assets) ? rel.assets : [];
  let asset = assets.find((a) => /\.exe$/i.test(a.name || '') && /portable/i.test(String(a.name || '')));
  if (!asset) asset = assets.find((a) => /\.exe$/i.test(a.name || ''));
  return {
    tag,
    downloadUrl: (asset && asset.browser_download_url) || '',
    fileName: (asset && asset.name) || ''
  };
}

async function checkGithubReleaseImpl() {
  const currentVersion = app.getVersion();
  try {
    const data = await fetchGithubLatestReleaseMeta();
    if (data.error) {
      return { hasUpdate: false, currentVersion, error: data.error };
    }
    const latestVersion = data.tag;
    const cmp = semverCompare(latestVersion, currentVersion);
    const hasUpdate = cmp > 0;
    const defaultName = `NKBKConnext System ${latestVersion} Portable.exe`;
    return {
      hasUpdate,
      currentVersion,
      latestVersion,
      downloadUrl: data.downloadUrl,
      fileName: data.fileName || defaultName
    };
  } catch (e) {
    return {
      hasUpdate: false,
      currentVersion,
      error: (e && e.message) || 'ตรวจสอบไม่สำเร็จ — ตรวจอินเทอร์เน็ต'
    };
  }
}

async function downloadGithubReleaseImpl(downloadUrl, fileName) {
  if (!downloadUrl) return { ok: false, error: 'ไม่มีลิงก์ดาวน์โหลด (แนบไฟล์ *Portable*.exe ใน Release)' };
  const safeName = String(fileName || 'update.exe').replace(/[\\/:*?"<>|]/g, '_');
  const dest = path.join(app.getPath('downloads'), safeName);
  const res = await fetch(downloadUrl, {
    headers: { 'User-Agent': 'NKBKConnext-System', Accept: '*/*' },
    redirect: 'follow'
  });
  if (!res.ok) return { ok: false, error: 'ดาวน์โหลด HTTP ' + res.status };
  if (!res.body) return { ok: false, error: 'ไม่มีข้อมูลไฟล์' };
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
  try {
    shell.showItemInFolder(dest);
  } catch (_) {}
  return { ok: true, path: dest };
}

function isPortableBuild() {
  return !!(process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR);
}

/** สร้าง .lnk บน Windows (VBS UTF-16 รองรับ path ภาษาไทย) */
function createWindowsLnk(shortcutPath, opts) {
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '""');
  const lines = [
    'Set WshShell = CreateObject("WScript.Shell")',
    `Set s = WshShell.CreateShortcut("${esc(shortcutPath)}")`,
    `s.TargetPath = "${esc(opts.target)}"`
  ];
  if (opts.args != null && opts.args !== '') {
    lines.push(`s.Arguments = "${esc(opts.args)}"`);
  }
  const cwd = opts.cwd || path.dirname(opts.target);
  lines.push(`s.WorkingDirectory = "${esc(cwd)}"`);
  lines.push(`s.Description = "${esc(opts.description || 'NKBKConnext System')}"`);
  if (opts.iconLocation) {
    lines.push(`s.IconLocation = "${esc(opts.iconLocation)}"`);
  }
  lines.push('s.Save');
  const vbs = lines.join('\r\n');
  const vbsPath = path.join(app.getPath('temp'), `nkbk-sc-${Date.now()}.vbs`);
  const bom = Buffer.from([0xff, 0xfe]);
  const body = Buffer.from(vbs, 'utf16le');
  fs.writeFileSync(vbsPath, Buffer.concat([bom, body]));
  try {
    require('child_process').execSync(`cscript //nologo //B "${vbsPath}"`, { windowsHide: true });
  } finally {
    try {
      fs.unlinkSync(vbsPath);
    } catch (_) {}
  }
}

function getDesktopShortcutPath() {
  return path.join(app.getPath('desktop'), 'NKBKConnext System.lnk');
}

/** ไอคอนบน Desktop ชี้ไปที่ .exe ปัจจุบัน (Portable) */
function createDesktopShortcutOverwrite() {
  if (!app.isPackaged) return;
  const exe = process.execPath;
  const iconLoc = getWindowsShortcutIconLocation() || `${exe},0`;
  const spec = isPortableBuild()
    ? { target: exe, cwd: path.dirname(exe), iconLocation: iconLoc }
    : { target: exe, cwd: path.dirname(exe), iconLocation: iconLoc };
  createWindowsLnk(getDesktopShortcutPath(), spec);
}

function showFirstRunWelcomeIfNeeded() {
  return new Promise((resolve) => {
    if (!app.isPackaged) {
      resolve();
      return;
    }
    const flagPath = path.join(app.getPath('userData'), '.first_run_welcome_ok');
    if (fs.existsSync(flagPath)) {
      resolve();
      return;
    }
    let finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      try {
        fs.writeFileSync(flagPath, new Date().toISOString(), 'utf8');
      } catch (_) {}
      try {
        if (isPortableBuild()) {
          createDesktopShortcutOverwrite();
        }
      } catch (e) {
        console.warn('Desktop shortcut:', e.message);
      }
      try {
        if (app.isPackaged && process.platform === 'win32') {
          setStartup(true);
        }
      } catch (e) {
        console.warn('Default startup:', e.message);
      }
      if (firstRunWindow && !firstRunWindow.isDestroyed()) {
        firstRunWindow.close();
      }
      firstRunWindow = null;
      resolve();
    }
    firstRunWindow = new BrowserWindow({
      width: 420,
      height: 520,
      frame: false,
      resizable: false,
      center: true,
      show: true,
      icon: path.join(APP_DIR, 'assets', 'icon.png'),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(APP_DIR, 'preload-first-run.js')
      },
      title: 'NKBKConnext System'
    });
    firstRunWindow.loadURL(`http://127.0.0.1:${serverListenPort}/first-run.html`);
    firstRunWindow.once('closed', finish);
    ipcMain.once('first-run-done', finish);
  });
}

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

/** ก่อน require server — บังคับ MONITOR_API_URL จากไฟล์ข้าง .exe/resources ถ้า server.js หา path ไม่เจอ (พฤติกรรมติดตั้ง Windows) */
function primeMonitorApiUrlFromPackagedConfig() {
  try {
    if (String(process.env.MONITOR_API_URL || '').trim()) return;
    const execDir = process.execPath && path.dirname(process.execPath);
    const candidates = [];
    if (execDir) candidates.push(path.join(execDir, 'monitor-config.json'));
    try {
      if (app.isPackaged && process.resourcesPath) {
        candidates.push(path.join(process.resourcesPath, 'monitor-config.json'));
      }
    } catch (_) {}
    for (const p of candidates) {
      if (!p || !fs.existsSync(p)) continue;
      let raw;
      try {
        raw = fs.readFileSync(p, 'utf8');
      } catch (_) {
        continue;
      }
      let j;
      try {
        j = JSON.parse(raw);
      } catch (_) {
        continue;
      }
      if (!j || j.type === 'service_account') continue;
      const u = String(j.monitorApiUrl || '')
        .trim()
        .replace(/\/$/, '');
      if (u) {
        process.env.MONITOR_API_URL = u;
        console.log('[NKBKConnext] ใช้ monitorApiUrl จาก', p);
        return;
      }
    }
  } catch (e) {
    console.warn('[NKBKConnext] primeMonitorApiUrlFromPackagedConfig:', e && e.message);
  }
}

function startServer() {
  return new Promise((resolve, reject) => {
    try {
      primeMonitorApiUrlFromPackagedConfig();
      const serverModule = require('./server.js');
      const expressApp = serverModule.app;
      const http = require('http');
      const base = Number(process.env.PORT) || 3333;
      const maxTry = base + 40;
      const tryListen = (port) => {
        if (port > maxTry) {
          reject(
            new Error(
              'พอร์ต ' +
                base +
                '–' +
                maxTry +
                ' ถูกใช้หมด — ปิดโปรแกรม NKBKConnext / หยุด npm start ที่ค้าง แล้วลองใหม่'
            )
          );
          return;
        }
        const server = http.createServer(expressApp);
        server.once('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            tryListen(port + 1);
          } else {
            reject(err);
          }
        });
        server.listen(port, '127.0.0.1', () => {
          serverListenPort = port;
          serverProcess = server;
          if (port !== base) {
            console.warn(
              '[NKBKConnext] พอร์ต ' + base + ' ถูกใช้แล้ว — ใช้พอร์ต ' + port + ' แทน'
            );
          }
          try {
            if (typeof serverModule.startConnextProgramFirestoreSync === 'function') {
              serverModule.startConnextProgramFirestoreSync();
            }
            if (typeof serverModule.startSystemSnapshotWebPush === 'function') {
              serverModule.startSystemSnapshotWebPush();
            }
          } catch (e) {
            console.warn('[NKBKConnext] start sync / web push:', e && e.message);
          }
          resolve();
        });
      };
      tryListen(base);
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

  // อนุญาตให้ window.open() จาก renderer สร้างหน้าต่างใหม่ (เช่น "ใบลา" print popup)
  mainWindow.webContents.setWindowOpenHandler(({ url, features }) => {
    if (url && /^https?:\/\//i.test(url)) {
      const { shell } = require('electron');
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return {
      action: 'allow',
      outlivesOpener: true,
      overrideBrowserWindowOptions: {
        width: 900,
        height: 1000,
        resizable: true,
        maximizable: true,
        minimizable: true,
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true
        }
      }
    };
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
        if (window.__nkbkAutoLoginDone) return;
        window.__nkbkAutoLoginDone = true;
        var db = ${JSON.stringify(dbStr)};
        var user = ${JSON.stringify(userStr)};
        var pass = ${JSON.stringify(passStr)};
        var inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        var selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        function setVal(el, val) {
          if (!el || val == null) return;
          try {
            if (el.tagName === 'SELECT' && selectSetter) selectSetter.call(el, val);
            else if (inputSetter) inputSetter.call(el, val);
            else el.value = val;
          } catch (e) { el.value = val; }
        }
        function findForm() {
          return document.querySelector('form#form1') || document.querySelector('form');
        }
        function findUser(root) {
          return root.querySelector('#TbUsername')
            || root.querySelector('input[name="TbUsername"]')
            || root.querySelector('input[name*="Username" i]')
            || root.querySelector('input[id*="Username" i]');
        }
        function findPass(root) {
          return root.querySelector('#TbPassword')
            || root.querySelector('input[name="TbPassword"]')
            || root.querySelector('input[name*="Password" i]')
            || root.querySelector('input[id*="Password" i]')
            || root.querySelector('input[type="password"]');
        }
        function findLoginBtn(root) {
          return root.querySelector('#BtLogIn')
            || root.querySelector('input[name="BtLogIn"]')
            || root.querySelector('input[id*="LogIn" i]')
            || root.querySelector('input[id*="Login" i]')
            || root.querySelector('input[value*="เข้าใช้งาน"]')
            || root.querySelector('input[value*="เข้าสู่ระบบ"]')
            || root.querySelector('input[type="submit"]');
        }
        var attempts = 0;
        var timer = setInterval(function() {
          attempts++;
          var form = findForm();
          if (!form) { if (attempts > 30) clearInterval(timer); return; }
          var userInput = findUser(form) || findUser(document);
          var passInput = findPass(form) || findPass(document);
          var loginBtn = findLoginBtn(form) || findLoginBtn(document);
          if (!userInput || !passInput || !loginBtn) {
            if (attempts > 30) clearInterval(timer);
            return;
          }
          clearInterval(timer);
          var sel = form.querySelector('select');
          if (db && sel) {
            setVal(sel, db);
            if (sel.value !== db) {
              for (var oi = 0; oi < sel.options.length; oi++) {
                var o = sel.options[oi];
                if (o.value === db || (o.text || '').trim() === db) { setVal(sel, o.value); break; }
              }
            }
          }
          setVal(userInput, user);
          setVal(passInput, pass);
          setTimeout(function() {
            try { loginBtn.click(); }
            catch (e) { try { form.submit(); } catch (_) {} }
          }, 200);
        }, 250);
      })();
    `;
    win.webContents.once('did-finish-load', () => {
      win.webContents.executeJavaScript(injectScript).catch(function(){});
    });
    win.on('closed', () => {});
  });

  mainWindow.loadURL(`http://127.0.0.1:${serverListenPort}/`);
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
      const iconLoc = getWindowsShortcutIconLocation() || `${target},0`;
      if (app.isPackaged) {
        createWindowsLnk(shortcutPath, {
          target,
          cwd: path.dirname(target),
          description: 'NKBKConnext System',
          iconLocation: iconLoc
        });
      } else {
        createWindowsLnk(shortcutPath, {
          target,
          args: `"${APP_DIR}"`,
          cwd: APP_DIR,
          description: 'NKBKConnext System',
          iconLocation: iconLoc
        });
      }
    } else {
      if (fs.existsSync(shortcutPath)) fs.unlinkSync(shortcutPath);
    }
  } catch (e) {
    console.error('Startup setting failed', e);
  }
}

function showAppToast(opts) {
  const variant = opts.variant || 'info';
  const title = opts.title || 'NKBKConnext System';
  const message = String(opts.message || '');
  const sub = String(opts.subtitle || '');
  const autoCloseMs = Number(opts.autoCloseMs) || 0;
  try {
    if (appToastWindow && !appToastWindow.isDestroyed()) {
      appToastWindow.close();
      appToastWindow = null;
    }
  } catch (_) {}
  const win = new BrowserWindow({
    width: 400,
    height: 244,
    frame: false,
    resizable: false,
    center: true,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#f6f8fc',
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    modal: !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()),
    webPreferences: {
      preload: path.join(APP_DIR, 'preload-toast.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  appToastWindow = win;
  const closer = () => {
    try {
      if (!win.isDestroyed()) win.close();
    } catch (_) {}
    appToastWindow = null;
  };
  ipcMain.once('nkbk-app-toast-close', closer);
  win.once('closed', () => {
    try {
      ipcMain.removeListener('nkbk-app-toast-close', closer);
    } catch (_) {}
    appToastWindow = null;
  });
  win.once('ready-to-show', () => {
    try {
      win.show();
    } catch (_) {}
  });
  const filePath = path.join(APP_DIR, 'public', 'electron-toast.html');
  win
    .loadFile(filePath, {
      query: { variant, title, message, sub }
    })
    .catch((e) => {
      console.warn('[toast]', e.message);
      closer();
      dialog.showMessageBox({ title, message: message || sub || '—' }).catch(() => {});
    });
  if (autoCloseMs > 0) {
    const tid = setTimeout(() => {
      try {
        if (!win.isDestroyed()) win.close();
      } catch (_) {}
    }, autoCloseMs);
    win.once('closed', () => clearTimeout(tid));
  }
}

/** ปิดแอปแล้วรัน NSIS ติดตั้ง — ต้องตั้ง isQuitting ก่อน ไม่งั้น window-all-closed จะ preventDefault แล้ว quit ไม่สำเร็จ */
function runQuitAndInstall() {
  try {
    app.isQuitting = true;
    try {
      if (updatePromptWindow && !updatePromptWindow.isDestroyed()) {
        updatePromptWindow.destroy();
        updatePromptWindow = null;
      }
    } catch (_) {}
    try {
      if (appToastWindow && !appToastWindow.isDestroyed()) {
        appToastWindow.destroy();
        appToastWindow = null;
      }
    } catch (_) {}
    if (!autoUpdater) {
      app.isQuitting = false;
      return;
    }
    autoUpdater.quitAndInstall(false, true);
  } catch (e) {
    console.warn('[quitAndInstall]', (e && e.message) || String(e));
    app.isQuitting = false;
  }
}

/** ป๊อปอัปแบบกำหนดเอง — พบเวอร์ชันใหม่จาก GitHub (electron-updater) */
function showNsisUpdateAvailableWindow(newVersion) {
  if (!autoUpdater) return;
  if (appUpdateFlowState.phase === 'downloading' || appUpdateFlowState.phase === 'ready') return;
  try {
    if (updatePromptWindow && !updatePromptWindow.isDestroyed()) return;
  } catch (_) {}
  const cur = app.getVersion();
  let allowUpdatePromptClose = false;
  const win = new BrowserWindow({
    width: 452,
    height: 312,
    frame: false,
    resizable: false,
    center: true,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#e2eaf8',
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    modal: !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()),
    webPreferences: {
      preload: path.join(APP_DIR, 'preload-toast.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.on('close', (e) => {
    if (!allowUpdatePromptClose) {
      e.preventDefault();
    }
  });
  updatePromptWindow = win;
  const handler = (_e, payload) => {
    ipcMain.removeListener('nkbk-update-prompt', handler);
    const action = payload && payload.action;
    const phase = payload && payload.phase;
    const proceed = phase === 'available' && action === 'download';
    if (proceed) {
      allowUpdatePromptClose = true;
      try {
        if (!win.isDestroyed()) win.close();
      } catch (_) {}
    }
    if (proceed) {
      try {
        broadcastAppUpdateFlow({
          phase: 'downloading',
          version: (pendingUpdateInfo && pendingUpdateInfo.version) || ''
        });
        focusMainWindowForUpdate();
        autoUpdater.downloadUpdate();
      } catch (e) {
        console.warn('[autoUpdater] downloadUpdate', e.message);
        broadcastAppUpdateFlow({ phase: 'error', message: e.message || String(e) });
      }
    }
  };
  ipcMain.on('nkbk-update-prompt', handler);
  win.once('closed', () => {
    try {
      ipcMain.removeListener('nkbk-update-prompt', handler);
    } catch (_) {}
    if (updatePromptWindow === win) updatePromptWindow = null;
  });
  win.once('ready-to-show', () => {
    try {
      win.show();
    } catch (_) {}
  });
  const filePath = path.join(APP_DIR, 'public', 'electron-toast.html');
  win
    .loadFile(filePath, {
      query: {
        variant: 'update',
        newVersion: String(newVersion || ''),
        currentVersion: String(cur || '')
      }
    })
    .catch((e) => {
      console.warn('[update-prompt]', e.message);
      try {
        ipcMain.removeListener('nkbk-update-prompt', handler);
      } catch (_) {}
      allowUpdatePromptClose = true;
      try {
        if (!win.isDestroyed()) win.close();
      } catch (_) {}
      updatePromptWindow = null;
      dialog
        .showMessageBox({
          type: 'info',
          buttons: ['อัปเดต'],
          defaultId: 0,
          title: 'NKBKConnext System',
          message: 'มีเวอร์ชันใหม่ ' + String(newVersion || '') + ' กด อัปเดต เพื่อดาวน์โหลด'
        })
        .then(({ response }) => {
          if (response === 0) {
            try {
              broadcastAppUpdateFlow({
                phase: 'downloading',
                version: (pendingUpdateInfo && pendingUpdateInfo.version) || ''
              });
              focusMainWindowForUpdate();
              autoUpdater.downloadUpdate();
            } catch (_) {}
          }
        });
    });
}

/** ป๊อปอัปหลังดาวน์โหลดอัปเดตเสร็จ (NSIS) */
function showNsisUpdateReadyWindow() {
  if (!autoUpdater) return;
  try {
    if (updatePromptWindow && !updatePromptWindow.isDestroyed()) updatePromptWindow.close();
  } catch (_) {}
  const win = new BrowserWindow({
    width: 452,
    height: 300,
    frame: false,
    resizable: false,
    center: true,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#e2eaf8',
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    modal: !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()),
    webPreferences: {
      preload: path.join(APP_DIR, 'preload-toast.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  updatePromptWindow = win;
  const handler = (_e, payload) => {
    ipcMain.removeListener('nkbk-update-prompt', handler);
    const action = payload && payload.action;
    const phase = payload && payload.phase;
    try {
      if (!win.isDestroyed()) win.close();
    } catch (_) {}
    if (updatePromptWindow === win) updatePromptWindow = null;
    if (phase === 'ready' && action === 'restart') {
      runQuitAndInstall();
    }
  };
  ipcMain.on('nkbk-update-prompt', handler);
  win.once('closed', () => {
    try {
      ipcMain.removeListener('nkbk-update-prompt', handler);
    } catch (_) {}
    if (updatePromptWindow === win) updatePromptWindow = null;
  });
  win.once('ready-to-show', () => {
    try {
      win.show();
    } catch (_) {}
  });
  win
    .loadFile(path.join(APP_DIR, 'public', 'electron-toast.html'), { query: { variant: 'update-ready' } })
    .catch((e) => {
      console.warn('[update-ready]', e.message);
      try {
        ipcMain.removeListener('nkbk-update-prompt', handler);
      } catch (_) {}
      try {
        if (!win.isDestroyed()) win.close();
      } catch (_) {}
      updatePromptWindow = null;
      dialog
        .showMessageBox({
          type: 'info',
          buttons: ['รีสตาร์ทและติดตั้ง', 'ทีหลัง'],
          defaultId: 0,
          title: 'NKBKConnext System',
          message: 'ดาวน์โหลดอัปเดตเสร็จแล้ว กดรีสตาร์ทเพื่อติดตั้งเวอร์ชันใหม่'
        })
        .then(({ response }) => {
          if (response === 0) {
            runQuitAndInstall();
          }
        });
    });
}

/** อัปเกรดจากเวอร์ชันเก่า: เปิด startup ครั้งเดียวถ้ายังไม่เคยบันทึก flag (ผู้ใช้ปิดได้ในเมนูถาด) */
function ensureDefaultStartupIfNeeded() {
  if (!app.isPackaged || process.platform !== 'win32') return;
  try {
    const flag = path.join(app.getPath('userData'), '.nkbk_startup_default_v1');
    if (fs.existsSync(flag)) return;
    fs.writeFileSync(flag, '1', 'utf8');
    if (!isStartupEnabled()) setStartup(true);
    updateTrayMenu();
  } catch (e) {
    console.warn('ensureDefaultStartupIfNeeded', e.message);
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
  if (isPortableBuild()) {
    (async () => {
      const u = await checkGithubReleaseImpl();
      if (u.error) {
        dialog.showMessageBox({
          type: 'warning',
          title: 'NKBKConnext System',
          message: u.error,
          buttons: ['เปิดหน้า Releases', 'ตกลง'],
          defaultId: 1
        }).then(({ response }) => {
          if (response === 0) shell.openExternal(RELEASES_URL);
        });
        return;
      }
      if (!u.hasUpdate) {
        showAppToast({
          variant: 'success',
          message: 'คุณใช้เวอร์ชันล่าสุดแล้ว',
          subtitle: 'เวอร์ชัน ' + u.currentVersion,
          autoCloseMs: 4800
        });
        return;
      }
      const { response } = await dialog.showMessageBox({
        type: 'info',
        title: 'NKBKConnext System',
        message:
          'มีเวอร์ชันใหม่ ' +
          u.latestVersion +
          ' (ปัจจุบัน ' +
          u.currentVersion +
          ')\n\nดาวน์โหลดไฟล์ Portable ไปที่โฟลเดอร์ดาวน์โหลด แล้วปิดแอปและรันไฟล์ใหม่แทนที่เดิม',
        buttons: ['ดาวน์โหลด', 'เปิด GitHub', 'ปิด'],
        defaultId: 0,
        cancelId: 2
      });
      if (response === 0 && u.downloadUrl) {
        const r = await downloadGithubReleaseImpl(u.downloadUrl, u.fileName);
        if (r.ok) {
          dialog.showMessageBox({
            title: 'NKBKConnext System',
            message: 'ดาวน์โหลดแล้ว — เปิดโฟลเดอร์ให้แล้ว ปิดโปรแกรมนี้แล้วรันไฟล์ใหม่'
          });
        } else {
          dialog.showMessageBox({
            type: 'warning',
            title: 'NKBKConnext System',
            message: r.error || 'ดาวน์โหลดไม่สำเร็จ'
          });
        }
      } else if (response === 1) {
        shell.openExternal(RELEASES_URL);
      }
    })();
    return;
  }
  if (!autoUpdater) {
    dialog.showMessageBox({
      title: 'NKBKConnext System',
      message: 'การอัปเดตใช้ได้เมื่อรันแบบแพ็กเกจ (ไม่ใช่ npm start)'
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

function pushAppUpdateFlowToRenderer() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('app-update-flow', { ...appUpdateFlowState });
    } catch (_) {}
  }
}

function broadcastAppUpdateFlow(partial) {
  const p = partial || {};
  if (p.phase === 'idle') {
    appUpdateFlowState = { phase: 'idle' };
  } else if (p.phase === 'downloading') {
    appUpdateFlowState = {
      phase: 'downloading',
      version: p.version != null ? String(p.version) : (pendingUpdateInfo && pendingUpdateInfo.version) || '',
      percent: typeof p.percent === 'number' ? p.percent : 0,
      transferred: typeof p.transferred === 'number' ? p.transferred : 0,
      total: typeof p.total === 'number' ? p.total : 0,
      bytesPerSecond: typeof p.bytesPerSecond === 'number' ? p.bytesPerSecond : 0
    };
  } else if (p.phase === 'ready') {
    appUpdateFlowState = {
      phase: 'ready',
      version: p.version != null ? String(p.version) : (pendingUpdateInfo && pendingUpdateInfo.version) || ''
    };
  } else if (p.phase === 'error') {
    appUpdateFlowState = {
      phase: 'error',
      message: String((p && p.message) || 'เกิดข้อผิดพลาด')
    };
  } else {
    appUpdateFlowState = { ...appUpdateFlowState, ...p };
  }
  pushAppUpdateFlowToRenderer();
}

function broadcastAppUpdateProgress(progressObj) {
  if (!progressObj || appUpdateFlowState.phase !== 'downloading') return;
  const pct = progressObj.percent != null ? Number(progressObj.percent) : 0;
  appUpdateFlowState = {
    phase: 'downloading',
    version: appUpdateFlowState.version || ((pendingUpdateInfo && pendingUpdateInfo.version) || ''),
    percent: Math.min(100, Math.max(0, Math.round(pct))),
    transferred: Number(progressObj.transferred) || 0,
    total: Number(progressObj.total) || 0,
    bytesPerSecond: Number(progressObj.bytesPerSecond) || 0
  };
  pushAppUpdateFlowToRenderer();
}

function resetAppUpdateFlow() {
  appUpdateFlowState = { phase: 'idle' };
  pushAppUpdateFlowToRenderer();
}

function focusMainWindowForUpdate() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } catch (_) {}
}

function setupAutoUpdater() {
  if (!app.isPackaged) return;
  if (isPortableBuild()) {
    return;
  }
  try {
    autoUpdater = require('electron-updater').autoUpdater;
    autoUpdater.autoDownload = false;
    autoUpdater.on('update-available', (info) => {
      const ver = (info && info.version) || '';
      pendingManualUpdateCheck = false;
      broadcastUpdateToRenderer(info);
      if (updateAvailableDebounceTimer) clearTimeout(updateAvailableDebounceTimer);
      updateAvailableDebounceTimer = setTimeout(() => {
        updateAvailableDebounceTimer = null;
        showNsisUpdateAvailableWindow(ver);
      }, 450);
    });
    autoUpdater.on('download-progress', (progressObj) => {
      broadcastAppUpdateProgress(progressObj);
    });
    autoUpdater.on('update-downloaded', () => {
      const ver = (pendingUpdateInfo && pendingUpdateInfo.version) || '';
      broadcastAppUpdateFlow({ phase: 'ready', version: ver });
      focusMainWindowForUpdate();
      const needToast =
        !mainWindow ||
        mainWindow.isDestroyed() ||
        !mainWindow.isVisible();
      if (needToast) showNsisUpdateReadyWindow();
    });
    autoUpdater.on('update-not-available', () => {
      if (pendingManualUpdateCheck) {
        pendingManualUpdateCheck = false;
        showAppToast({
          variant: 'success',
          message: 'คุณใช้เวอร์ชันล่าสุดแล้ว',
          subtitle: app.getVersion() ? 'เวอร์ชัน ' + app.getVersion() : '',
          autoCloseMs: 4800
        });
      }
    });
    autoUpdater.on('error', (err) => {
      const msg = (err && err.message) || String(err);
      if (appUpdateFlowState.phase === 'downloading') {
        broadcastAppUpdateFlow({ phase: 'error', message: msg });
        pendingManualUpdateCheck = false;
        return;
      }
      if (pendingManualUpdateCheck) {
        pendingManualUpdateCheck = false;
        dialog.showMessageBox({ type: 'warning', title: 'NKBKConnext System', message: 'อัปเดต: ' + msg });
      } else {
        console.warn('Auto-updater:', msg);
      }
    });
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => {});
    }, 4000);
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
      click: (item) => {
        setStartup(item.checked);
        updateTrayMenu();
      }
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

ipcMain.handle('app-get-version', () => app.getVersion());
ipcMain.handle('app-is-portable-build', () => isPortableBuild());
ipcMain.handle('app-is-packaged', () => app.isPackaged);
ipcMain.handle('app-check-updates-now', async () => {
  if (!autoUpdater) return { ok: false, error: 'no-updater' };
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
});

const MONITOR_PUSH_TOKEN_FILE = '.monitor-push-token';
function getMonitorPushTokenPath() {
  return path.join(app.getPath('userData'), MONITOR_PUSH_TOKEN_FILE);
}
ipcMain.handle('monitor-set-push-token', (_e, tokenRaw) => {
  try {
    const t = tokenRaw != null ? String(tokenRaw).trim() : '';
    if (!t || t.length < 16) {
      try {
        fs.unlinkSync(getMonitorPushTokenPath());
      } catch (_) {}
      return { ok: true };
    }
    fs.writeFileSync(getMonitorPushTokenPath(), t, { encoding: 'utf8' });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
});
ipcMain.handle('monitor-clear-push-token', () => {
  try {
    fs.unlinkSync(getMonitorPushTokenPath());
  } catch (_) {}
  return { ok: true };
});

ipcMain.handle('shell-open-external', async (_e, url) => {
  try {
    const u = typeof url === 'string' ? url.trim() : '';
    if (u && /^https?:\/\//i.test(u)) {
      await shell.openExternal(u);
      return { ok: true };
    }
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
  return { ok: false };
});

ipcMain.handle('open-line-oauth-window', async (_e, url) => {
  const u = typeof url === 'string' ? url.trim() : '';
  if (!u || !/^https:\/\/access\.line\.me\//i.test(u)) {
    return { ok: false, error: 'URL ไม่ใช่ LINE OAuth' };
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: 'ยังไม่มีหน้าต่างหลัก' };
  }
  try {
    if (lineOAuthWindow && !lineOAuthWindow.isDestroyed()) {
      try {
        lineOAuthWindow.close();
      } catch (_) {}
      lineOAuthWindow = null;
    }
    const parentSession = mainWindow.webContents.session;
    lineOAuthWindow = new BrowserWindow({
      width: 520,
      height: 720,
      parent: mainWindow,
      modal: false,
      show: true,
      autoHideMenuBar: true,
      title: 'LINE Login — NKBKConnext',
      icon: path.join(APP_DIR, 'assets', 'icon.png'),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        session: parentSession
      }
    });
    lineOAuthWindow.on('closed', () => {
      lineOAuthWindow = null;
    });
    const notifyMainWindowLineCallback = (navigatedUrl) => {
      try {
        if (typeof navigatedUrl !== 'string' || navigatedUrl.indexOf('/api/line-login-callback') === -1) {
          return;
        }
        let parsed;
        try {
          parsed = new URL(navigatedUrl.split('#')[0]);
        } catch (_) {
          return;
        }
        const st = parsed.searchParams.get('state');
        if (!st) return;
        setTimeout(() => {
          try {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('nkbk-line-oauth-done', { state: st });
            }
          } catch (_) {}
        }, 250);
      } catch (_) {}
    };
    const scheduleCloseIfLineCallback = (navigatedUrl) => {
      try {
        if (typeof navigatedUrl !== 'string' || navigatedUrl.indexOf('/api/line-login-callback') === -1) return;
        const q = navigatedUrl.indexOf('?');
        const qs = q >= 0 ? navigatedUrl.slice(q) : '';
        if (!qs || (qs.indexOf('code=') < 0 && qs.indexOf('error=') < 0)) return;
        setTimeout(() => {
          try {
            if (lineOAuthWindow && !lineOAuthWindow.isDestroyed()) lineOAuthWindow.close();
          } catch (_) {}
        }, 2200);
      } catch (_) {}
    };
    const onLineOauthChildNavigated = (navigatedUrl) => {
      notifyMainWindowLineCallback(navigatedUrl);
      scheduleCloseIfLineCallback(navigatedUrl);
    };
    lineOAuthWindow.webContents.on('did-navigate', (_evt, navigatedUrl) => {
      onLineOauthChildNavigated(navigatedUrl);
    });
    lineOAuthWindow.webContents.on('did-finish-load', () => {
      try {
        if (lineOAuthWindow && !lineOAuthWindow.isDestroyed()) {
          onLineOauthChildNavigated(lineOAuthWindow.webContents.getURL());
        }
      } catch (_) {}
    });
    await lineOAuthWindow.loadURL(u);
    return { ok: true };
  } catch (e) {
    lineOAuthWindow = null;
    return { ok: false, error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('github-check-update', async () => checkGithubReleaseImpl());
ipcMain.handle('github-download-update', async (_e, opts) => {
  const url = opts && opts.url;
  const fileName = opts && opts.fileName;
  try {
    return await downloadGithubReleaseImpl(url, fileName);
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('app-get-pending-update', () => pendingUpdateInfo);
ipcMain.handle('app-download-update', async () => {
  if (!autoUpdater) return { ok: false, error: 'no-updater' };
  try {
    broadcastAppUpdateFlow({
      phase: 'downloading',
      version: (pendingUpdateInfo && pendingUpdateInfo.version) || ''
    });
    focusMainWindowForUpdate();
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (e) {
    const msg = (e && e.message) || String(e);
    broadcastAppUpdateFlow({ phase: 'error', message: msg });
    return { ok: false, error: msg };
  }
});

ipcMain.handle('app-get-update-flow-state', () => ({ ...appUpdateFlowState }));
ipcMain.handle('app-dismiss-update-flow', () => {
  resetAppUpdateFlow();
  return { ok: true };
});
ipcMain.handle('app-quit-and-install-update', () => {
  if (!autoUpdater) return { ok: false, error: 'no-updater' };
  try {
    runQuitAndInstall();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
});
ipcMain.on('app-quit-completely', () => {
  quitApp();
});

/** ป้องกันเปิด .exe ซ้ำ (เช่น ปิดหน้าต่างแล้วยังอยู่ถาด + เปิดจากเดสก์ท็อปอีกครั้ง) — ไม่ให้สองไอคอนในแถบงาน */
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    } catch (_) {}
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
  await showFirstRunWelcomeIfNeeded();
  createTray();
  ensureDefaultStartupIfNeeded();
  try {
    if (app.isPackaged && isStartupEnabled()) {
      const sc = getStartupShortcutPath();
      const target = process.execPath;
      const iconLoc = getWindowsShortcutIconLocation() || `${target},0`;
      createWindowsLnk(sc, {
        target,
        cwd: path.dirname(target),
        description: 'NKBKConnext System',
        iconLocation: iconLoc
      });
    }
  } catch (e) {
    console.warn('Startup shortcut icon refresh:', e && e.message);
  }
  try {
    if (app.isPackaged && isPortableBuild()) {
      const mark = path.join(app.getPath('userData'), '.desktop_shortcut_once');
      const lnk = getDesktopShortcutPath();
      if (!fs.existsSync(mark)) {
        if (!fs.existsSync(lnk)) {
          createDesktopShortcutOverwrite();
        }
        fs.writeFileSync(mark, '1', 'utf8');
      }
    }
  } catch (_) {}
  setupAutoUpdater();
  createWindow();
});

app.on('window-all-closed', (e) => {
  if (!app.isQuitting) e.preventDefault();
});

app.on('before-quit', () => {
  app.isQuitting = true;
});
}
