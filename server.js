const express = require('express');
const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const si = require('systeminformation');

const app = express();
const PORT = Number(process.env.PORT) || 3333;
const isWin = process.platform === 'win32';

// Cache ข้อมูล Windows (ช้า) ไว้ 2 นาที ไม่รัน PowerShell บ่อย
const WINDOWS_CACHE_TTL_MS = 2 * 60 * 1000;
let windowsCache = { data: null, expires: 0 };

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// รัน PowerShell แบบไม่บล็อก (async) เพื่อไม่ให้ระบบค้าง
function runPsAsync(script, timeout = 5000) {
  return runPsWithEnv(script, null, timeout).then((r) => r.out);
}

// รัน PowerShell พร้อม env เพิ่ม (เช่น ส่งรหัสผ่านโดยไม่ใส่ในคำสั่ง)
function runPsWithEnv(script, envExtra, timeout = 5000) {
  if (!isWin) return Promise.resolve({ out: null, err: null, code: null });
  return new Promise((resolve) => {
    try {
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      const env = { ...process.env, ...envExtra };
      const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true, env });
      let out = '';
      let err = '';
      let done = false;
      const finish = (result) => {
        if (done) return;
        done = true;
        try { child.kill(); } catch (_) {}
        resolve(result);
      };
      child.stdout.on('data', (d) => { out += d.toString(); });
      child.stderr.on('data', (d) => { err += d.toString(); });
      child.on('close', (code) => finish({ out: out.trim(), err: err.trim(), code }));
      child.on('error', () => finish({ out: null, err: null, code: null }));
      setTimeout(() => finish({ out: out.trim(), err: err.trim(), code: null }), timeout);
    } catch (e) {
      resolve({ out: null, err: String(e.message), code: null });
    }
  });
}

async function getMicrosoftOfficeAsync() {
  const script = "Get-ChildItem 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | ForEach-Object { $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue; if ($p.DisplayName -match 'Microsoft Office|Office 365') { $p.DisplayName + '|' + $p.DisplayVersion } } | Where-Object { $_ }";
  const out = await runPsAsync(script, 4000);
  if (!out) return [];
  return out.split(/\r?\n/).filter(Boolean).map(line => {
    const i = line.lastIndexOf('|');
    const name = i >= 0 ? line.slice(0, i) : line;
    const version = i >= 0 ? line.slice(i + 1) : '—';
    return { name: name || 'Microsoft Office', version: version || '—' };
  });
}

async function getPrintersAndDriversAsync() {
  const script = "Get-WmiObject -Query 'SELECT Name,DriverName,Default FROM Win32_Printer' -ErrorAction SilentlyContinue | ForEach-Object { $_.Name + '|' + $_.DriverName + '|' + $_.Default }";
  const out = await runPsAsync(script, 4000);
  if (!out) return { printers: [], drivers: [] };
  const drivers = new Set();
  const printers = out.split(/\r?\n/).filter(Boolean).map(line => {
    const parts = line.split('|');
    const name = parts[0] || '—';
    const driver = parts[1] || '—';
    const isDefault = parts[2] === 'True';
    if (driver && driver !== '—') drivers.add(driver);
    return { name, driver, default: isDefault };
  });
  return { printers, drivers: Array.from(drivers) };
}

async function getLineAsync() {
  if (!isWin) return { installed: false, version: null };
  const script = "Get-ChildItem 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | ForEach-Object { $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue; if ($p.DisplayName -match '^LINE') { $p.DisplayName + '|' + ($p.DisplayVersion -replace ',','.') } } | Where-Object { $_ }";
  const out = await runPsAsync(script, 4000);
  if (!out || !out.trim()) return { installed: false, version: null };
  const line = out.split(/\r?\n/)[0];
  const i = line.lastIndexOf('|');
  const version = i >= 0 ? line.slice(i + 1).trim() || null : null;
  return { installed: true, version: version || null };
}

async function getWindowsUpdateAsync() {
  const result = { lastUpdate: null, pendingCount: null, lastHotfix: null };
  const [hotfixOut, pendingOut] = await Promise.all([
    runPsAsync("Get-HotFix -ErrorAction SilentlyContinue | Where-Object { $_.InstalledOn } | Sort-Object InstalledOn -Descending | Select-Object -First 1 | ForEach-Object { $_.InstalledOn.ToString('yyyy-MM-dd HH:mm') + '|' + $_.Description }", 4000),
    runPsAsync("try { $s = New-Object -ComObject Microsoft.Update.Session; $u = $s.CreateUpdateSearcher(); $r = $u.Search('IsInstalled=0'); $r.Updates.Count } catch { 0 }", 5000)
  ]);
  if (hotfixOut) {
    const idx = hotfixOut.indexOf('|');
    const date = idx >= 0 ? hotfixOut.slice(0, idx).trim() : hotfixOut.trim();
    const desc = idx >= 0 ? hotfixOut.slice(idx + 1).trim() : '';
    result.lastHotfix = date ? { date, description: desc } : null;
    result.lastUpdate = result.lastHotfix ? result.lastHotfix.date : null;
  }
  if (pendingOut !== null && /^\d+$/.test(pendingOut)) result.pendingCount = parseInt(pendingOut, 10);
  return result;
}

// ดึงข้อมูล Windows ทั้งหมดแบบรันขนาน แล้วเก็บ cache
async function fetchWindowsData() {
  const [office, printersData, windowsUpdate, line] = await Promise.all([
    getMicrosoftOfficeAsync(),
    getPrintersAndDriversAsync(),
    getWindowsUpdateAsync(),
    getLineAsync()
  ]);
  return { office, printersData, windowsUpdate, line };
}

// API: ข้อมูลระบบทั้งหมด
app.get('/api/system', async (req, res) => {
  try {
    const [
      osInfo,
      cpu,
      mem,
      diskLayout,
      fsSize,
      networkInterfaces,
      currentLoad,
      processes,
      system,
      battery,
      graphics,
      uuid
    ] = await Promise.all([
      si.osInfo(),
      si.cpu(),
      si.mem(),
      si.diskLayout().catch(() => []),
      si.fsSize().catch(() => []),
      si.networkInterfaces().catch(() => []),
      si.currentLoad().catch(() => ({})),
      si.processes().catch(() => ({ all: 0, running: 0 })),
      si.system().catch(() => ({})),
      si.battery().catch(() => ({})),
      si.graphics().catch(() => ({ controllers: [], displays: [] })),
      si.uuid().catch(() => ({}))
    ]);

    const storage = (fsSize || []).filter(f => f.mount && f.size > 0).map(f => ({
      mount: f.mount,
      totalGB: (f.size / 1e9).toFixed(2),
      usedGB: (f.used / 1e9).toFixed(2),
      freeGB: (f.available / 1e9).toFixed(2),
      usePercent: (f.use || 0).toFixed(1)
    }));

    let office = [], printersData = { printers: [], drivers: [] };
    let windowsUpdate = { lastUpdate: null, pendingCount: null, lastHotfix: null };
    let line = { installed: false, version: null };

    if (isWin) {
      const now = Date.now();
      const cacheValid = windowsCache.data && now < windowsCache.expires;
      if (cacheValid) {
        const c = windowsCache.data;
        office = c.office;
        printersData = c.printersData;
        windowsUpdate = c.windowsUpdate;
        line = c.line || line;
      } else if (windowsCache.data) {
        const c = windowsCache.data;
        office = c.office;
        printersData = c.printersData;
        windowsUpdate = c.windowsUpdate;
        line = c.line || line;
        fetchWindowsData().then((fresh) => {
          windowsCache = { data: fresh, expires: Date.now() + WINDOWS_CACHE_TTL_MS };
        }).catch(() => {});
      } else {
        const fresh = await fetchWindowsData();
        windowsCache = { data: fresh, expires: Date.now() + WINDOWS_CACHE_TTL_MS };
        office = fresh.office;
        printersData = fresh.printersData;
        windowsUpdate = fresh.windowsUpdate;
        line = fresh.line || line;
      }
    }

    const lineRunning = Array.isArray(processes.list) && processes.list.some((p) => (p.name || '').toLowerCase() === 'line.exe');
    const lineInfo = { installed: line.installed, running: lineRunning, version: line.version };

    const disks = diskLayout.slice(0, 5).map(d => ({
      name: d.name,
      type: d.type,
      size: (d.size / 1e12).toFixed(2) + ' TB',
      vendor: d.vendor
    }));

    const net = networkInterfaces.filter(n => !n.internal && n.ip4).map(n => {
      const t = (n.type || '').toLowerCase();
      const connectionType = t === 'wireless' ? 'Wi-Fi' : t === 'wired' ? 'LAN' : (n.ifaceName || '').toLowerCase().includes('wi-fi') || (n.ifaceName || '').toLowerCase().includes('wireless') ? 'Wi-Fi' : 'LAN';
      return {
        iface: n.ifaceName,
        ip4: n.ip4,
        mac: n.mac,
        operstate: n.operstate || 'unknown',
        speed: n.speed != null ? n.speed + ' Mbps' : null,
        connectionType
      };
    });

    const networkStatus = networkInterfaces.some(n => n.operstate === 'up')
      ? 'connected'
      : (networkInterfaces.length ? 'disconnected' : 'no_interfaces');

    const gpu = graphics.controllers && graphics.controllers[0] ? {
      model: graphics.controllers[0].model,
      vram: graphics.controllers[0].vram ? (graphics.controllers[0].vram / 1024).toFixed(1) + ' GB' : 'N/A'
    } : null;

    res.json({
      os: {
        hostname: osInfo.hostname,
        platform: osInfo.platform,
        distro: osInfo.distro,
        release: osInfo.release,
        build: osInfo.build || '',
        arch: osInfo.arch,
        kernel: osInfo.kernel,
        serial: osInfo.serial,
        uptime: osInfo.uptime,
        logofile: osInfo.logofile
      },
      cpu: {
        manufacturer: cpu.manufacturer,
        brand: cpu.brand,
        cores: cpu.cores,
        physicalCores: cpu.physicalCores,
        speed: cpu.speed,
        speedMin: cpu.speedMin,
        speedMax: cpu.speedMax
      },
      memory: {
        total: mem.total,
        free: mem.free,
        used: mem.used,
        active: mem.active,
        available: mem.available,
        totalGB: (mem.total / 1e9).toFixed(2),
        usedGB: (mem.used / 1e9).toFixed(2),
        freeGB: (mem.free / 1e9).toFixed(2),
        usagePercent: ((mem.used / mem.total) * 100).toFixed(1)
      },
      load: {
        currentLoad: currentLoad.currentLoad || 0,
        currentLoadUser: currentLoad.currentLoadUser || 0,
        currentLoadSystem: currentLoad.currentLoadSystem || 0
      },
      processes: {
        all: processes.all || 0,
        running: processes.running || 0
      },
      disks,
      storage,
      office,
      line: lineInfo,
      printers: printersData.printers,
      printerDrivers: printersData.drivers,
      windowsUpdate,
      network: net,
      networkStatus,
      battery: battery.percent !== undefined ? {
        percent: battery.percent,
        isCharging: battery.isCharging,
        acConnected: battery.acConnected,
        timeRemaining: battery.timeRemaining
      } : null,
      gpu,
      system: {
        manufacturer: system.manufacturer,
        model: system.model,
        serial: system.serial,
        uuid: uuid.os || uuid.hardware
      },
      timestamp: Date.now()
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// API: ทดสอบเครือข่าย (เช็กการเชื่อมต่ออินเทอร์เน็ต + ความหน่วง)
app.get('/api/network-test', (req, res) => {
  const start = Date.now();
  const timeout = 10000;
  const https = require('https');
  const reqOpt = {
    hostname: 'www.google.com',
    port: 443,
    path: '/',
    method: 'HEAD',
    timeout
  };
  const request = https.request(reqOpt, (response) => {
    const latency = Date.now() - start;
    response.resume();
    res.json({
      ok: true,
      latencyMs: latency,
      message: `เชื่อมต่อได้ (${latency} ms)`
    });
  });
  request.on('error', (err) => {
    res.json({
      ok: false,
      latencyMs: null,
      message: 'เชื่อมต่อไม่ได้: ' + (err.message || 'Unknown error')
    });
  });
  request.on('timeout', () => {
    request.destroy();
    res.json({
      ok: false,
      latencyMs: null,
      message: 'หมดเวลา (timeout)'
    });
  });
  request.setTimeout(timeout);
  request.end();
});

const https = require('https');

// Ping สำหรับ Speed Test
app.get('/api/speed-test/ping', (req, res) => {
  const start = Date.now();
  const r = https.request({
    hostname: 'www.google.com',
    port: 443,
    path: '/',
    method: 'HEAD'
  }, (response) => {
    response.resume();
    res.json({ ok: true, pingMs: Date.now() - start });
  });
  r.on('error', () => res.json({ ok: false, pingMs: null }));
  r.setTimeout(8000, () => { r.destroy(); res.json({ ok: false, pingMs: null }); });
  r.end();
});

// ดาวน์โหลดจากเน็ตแล้ว stream ให้ client (ใช้วัดความเร็วดาวน์โหลด)
const DOWNLOAD_TEST_URL = 'https://proof.ovh.net/files/10Mb.dat';
app.get('/api/speed-test/download', (req, res) => {
  const proxy = https.get(DOWNLOAD_TEST_URL, (stream) => {
    res.setHeader('Content-Type', 'application/octet-stream');
    stream.pipe(res);
    stream.on('error', () => res.end());
  });
  proxy.on('error', () => res.status(502).end());
});

// รับอัปโหลดเพื่อวัดความเร็ว (client ส่ง blob มาวัดเวลา)
app.use('/api/speed-test/upload', express.raw({ type: '*/*', limit: '15mb' }));
app.post('/api/speed-test/upload', (req, res) => {
  const len = req.body ? req.body.length : 0;
  res.json({ ok: true, bytes: len });
});

// เคลียร์โฟลเดอร์ Temp (ไฟล์ชั่วคราว)
async function clearTempFolder() {
  const tmpDir = os.tmpdir();
  let deletedCount = 0;
  let freedBytes = 0;
  const errors = [];
  try {
    const entries = await fs.readdir(tmpDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(tmpDir, entry.name);
      try {
        if (entry.isDirectory()) {
          const size = await getDirSize(fullPath).catch(() => 0);
          await fs.rm(fullPath, { recursive: true, force: true });
          freedBytes += size;
          deletedCount += 1;
        } else {
          const stat = await fs.stat(fullPath).catch(() => null);
          await fs.unlink(fullPath);
          if (stat && stat.size) freedBytes += stat.size;
          deletedCount += 1;
        }
      } catch (err) {
        errors.push(entry.name + ': ' + (err.message || 'ลบไม่ได้'));
      }
    }
  } catch (err) {
    return { ok: false, deletedCount: 0, freedBytes: 0, errors: [err.message || 'อ่านโฟลเดอร์ Temp ไม่ได้'] };
  }
  return { ok: true, deletedCount, freedBytes, errors };
}

async function getDirSize(dirPath) {
  let total = 0;
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dirPath, e.name);
    if (e.isDirectory()) total += await getDirSize(p).catch(() => 0);
    else total += (await fs.stat(p).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

app.post('/api/clear-temp', async (req, res) => {
  try {
    const result = await clearTempFolder();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, deletedCount: 0, freedBytes: 0, errors: [err.message] });
  }
});

// เชื่อมต่อ NAS / Network Drive (Windows SMB) ด้วย user/pass
function escapePsSingleQuoted(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/'/g, "''");
}
// แปลง error จาก PowerShell (CLIXML) เป็นข้อความที่อ่านง่าย
function friendlySmbError(psErr) {
  if (!psErr || typeof psErr !== 'string') return 'เชื่อมต่อไม่สำเร็จ';
  const raw = psErr.replace(/_x000D__x000A_/g, ' ').replace(/\s+/g, ' ');
  if (raw.includes('network name cannot be found') || raw.includes('Error 67')) {
    return 'ไม่พบชื่อเครือข่าย (Error 67) — ตรวจสอบว่า UNC Path ใช้ชื่อแชร์จริงของ NAS ไม่ใช่คำว่า ShareName และเครื่องอยู่ในเครือข่ายเดียวกันกับ NAS';
  }
  if (raw.includes('Access is denied') || raw.includes('Error 5') || raw.includes('Logon failure')) {
    return 'ปฏิเสธการเข้าถึง — ตรวจสอบชื่อผู้ใช้และรหัสผ่าน';
  }
  if (raw.includes('Multiple connections') || raw.includes('already in use')) {
    return 'มีการเชื่อมต่อไปยังแชร์นี้อยู่แล้ว';
  }
  const m = raw.match(/<S S="Error">([^<]+)/);
  if (m) return m[1].trim().replace(/_x000D__x000A_/g, ' ');
  return psErr.length > 200 ? psErr.slice(0, 200) + '…' : psErr;
}
const UNC_REGEX = /^\\\\[^\\]+\\[^\\\s]+$/;
app.post('/api/map-network-drive', async (req, res) => {
  if (!isWin) {
    return res.status(400).json({ ok: false, message: 'รองรับเฉพาะ Windows' });
  }
  const { uncPath, username, password, driveLetter } = req.body || {};
  const pathNorm = (uncPath || '').trim().replace(/\//g, '\\');
  if (!UNC_REGEX.test(pathNorm)) {
    return res.status(400).json({ ok: false, message: 'กรุณาระบุ UNC path ให้ถูกต้อง เช่น \\\\NKBKCOOP-DRIVE\\ShareName' });
  }
  const user = (username || '').trim();
  if (!user) {
    return res.status(400).json({ ok: false, message: 'กรุณาระบุชื่อผู้ใช้' });
  }
  const letter = driveLetter ? String(driveLetter).trim().toUpperCase().replace(/[^A-Z]/, '') : '';
  const pathEsc = escapePsSingleQuoted(pathNorm);
  const userEsc = escapePsSingleQuoted(user);
  const script = letter
    ? `$ErrorActionPreference='Stop'; $sec=ConvertTo-SecureString -String $env:NAS_PASS -AsPlainText -Force; $c=New-Object PSCredential('${userEsc}',$sec); New-SmbMapping -LocalPath '${letter}:' -RemotePath '${pathEsc}' -Credential $c -Persistent $true | Out-Null; Write-Output 'OK'`
    : `$ErrorActionPreference='Stop'; $sec=ConvertTo-SecureString -String $env:NAS_PASS -AsPlainText -Force; $c=New-Object PSCredential('${userEsc}',$sec); New-SmbMapping -RemotePath '${pathEsc}' -Credential $c -Persistent $true | Out-Null; Write-Output 'OK'`;
  const { out, err } = await runPsWithEnv(script, { NAS_PASS: password || '' }, 15000);
  if (out && out.includes('OK')) {
    return res.json({ ok: true, message: letter ? `เชื่อมต่อแล้ว (${letter}:)` : `เชื่อมต่อแล้ว (${pathNorm})` });
  }
  const message = friendlySmbError(err || out);
  return res.json({ ok: false, message });
});

// ยกเลิกการเชื่อมต่อ Network Drive
app.post('/api/disconnect-network-drive', (req, res) => {
  if (!isWin) {
    return res.status(400).json({ ok: false, message: 'รองรับเฉพาะ Windows' });
  }
  const { uncPath, driveLetter } = req.body || {};
  const letter = driveLetter ? String(driveLetter).trim().toUpperCase().replace(/[^A-Z]/, '') : '';
  const pathNorm = uncPath ? String(uncPath).trim().replace(/\//g, '\\') : '';
  if (!letter && !pathNorm) {
    return res.status(400).json({ ok: false, message: 'กรุณาระบุ drive letter (เช่น Z) หรือ UNC path' });
  }
  const pathEsc = escapePsSingleQuoted(pathNorm);
  const script = letter
    ? `Remove-SmbMapping -LocalPath '${letter}:' -Force -ErrorAction SilentlyContinue; Write-Output 'OK'`
    : `Remove-SmbMapping -RemotePath '${pathEsc}' -Force -ErrorAction SilentlyContinue; Write-Output 'OK'`;
  runPsWithEnv(script, null, 5000).then(({ err }) => {
    res.json({ ok: true, message: 'ยกเลิกการเชื่อมต่อแล้ว' });
  }).catch(() => res.json({ ok: false, message: 'ยกเลิกการเชื่อมต่อไม่สำเร็จ' }));
});

// เปิดโฟลเดอร์ใน Explorer (Windows)
app.post('/api/open-path', (req, res) => {
  const rawPath = (req.body && req.body.path) ? String(req.body.path).trim() : '';
  if (!rawPath) return res.status(400).json({ ok: false, message: 'กรุณาระบุ path' });
  const pathNorm = rawPath.replace(/\//g, '\\');
  if (!pathNorm.startsWith('\\\\') && !pathNorm.match(/^[A-Za-z]:/)) {
    return res.status(400).json({ ok: false, message: 'path ไม่ถูกต้อง' });
  }
  if (!isWin) return res.status(400).json({ ok: false, message: 'รองรับเฉพาะ Windows' });
  const child = spawn('explorer', [pathNorm], { windowsHide: false });
  child.on('error', () => res.json({ ok: false, message: 'เปิดไม่สำเร็จ' }));
  child.on('close', () => res.json({ ok: true, message: 'เปิดแล้ว' }));
  child.unref();
});

// เปิด URL ในเบราว์เซอร์เริ่มต้น (รองรับ user:pass แบบ HTTP Basic Auth เพื่อไม่ต้องกรอกที่เว็บ)
app.post('/api/open-url', (req, res) => {
  let url = (req.body && req.body.url) ? String(req.body.url).trim() : '';
  const username = (req.body && req.body.username) != null ? String(req.body.username) : '';
  const password = (req.body && req.body.password) != null ? String(req.body.password) : '';
  if (!url) return res.status(400).json({ ok: false, message: 'กรุณาระบุ URL' });
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
  let openUrl = url;
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) return res.status(400).json({ ok: false, message: 'รองรับเฉพาะ http/https' });
    if (username || password) {
      const auth = encodeURIComponent(username) + ':' + encodeURIComponent(password);
      openUrl = u.protocol + '//' + auth + '@' + u.host + (u.pathname || '/') + (u.search || '');
    }
  } catch {
    return res.status(400).json({ ok: false, message: 'URL ไม่ถูกต้อง' });
  }
  const openCmd = isWin ? { cmd: 'cmd', args: ['/c', 'start', '', openUrl] } : process.platform === 'darwin' ? { cmd: 'open', args: [openUrl] } : { cmd: 'xdg-open', args: [openUrl] };
  const child = spawn(openCmd.cmd, openCmd.args, { windowsHide: false });
  child.on('error', () => res.json({ ok: false, message: 'เปิดไม่สำเร็จ' }));
  child.on('close', () => res.json({ ok: true, message: 'เปิดเว็บไซต์แล้ว' }));
  child.unref();
});

// ---------- ล็อกอิน Monitor: ชื่อผู้ใช้ + รหัส PIN 6 หลัก (เก็บใน Firestore เดียวกับ V2) ----------
const crypto = require('crypto');
const fsSync = require('fs');
const MONITOR_SESSIONS = new Map(); // token -> { username, createdAt }
const MONITOR_COLLECTION = 'monitor_users';
/** เจ้าหน้าที่ V2 — ชื่อผู้ใช้ + PIN เดียวกับหน้าแก้ไขเจ้าหน้าที่ */
const V2_USERS_COLLECTION = 'users';
const PBKDF2_ITERATIONS = 100000;
let getMonitorDb = null;
/** เหตุล่าสุดที่ init Monitor Firestore ไม่สำเร็จ — สำหรับข้อความตอบ API */
let monitorFirestoreInitReason = null;

/** หาไฟล์ Service Account — รองรับชื่อ firebase-service-account.json หรือ firebase-service-account (ไม่มี .json) */
const SERVICE_ACCOUNT_FILENAMES = [
  'firebase-service-account.json',
  'firebase-service-account',
  'serviceAccountKey.json'
];

function findServiceAccountInDir(dir) {
  if (!dir) return null;
  try {
    if (!fsSync.existsSync(dir) || !fsSync.statSync(dir).isDirectory()) return null;
  } catch (_) {
    return null;
  }
  for (const name of SERVICE_ACCOUNT_FILENAMES) {
    const full = path.join(dir, name);
    try {
      if (fsSync.existsSync(full) && fsSync.statSync(full).isFile()) return full;
    } catch (_) {}
  }
  try {
    const entries = fsSync.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const n = ent.name;
      if (/^firebase-service-account(\.json)?$/i.test(n)) return path.join(dir, n);
      if (n.toLowerCase() === 'serviceaccountkey.json') return path.join(dir, n);
    }
  } catch (_) {}
  return null;
}

function resolveServiceAccountPath() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH && fsSync.existsSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)) {
    return process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  }

  const searchDirs = [];
  /** โฟลเดอร์เดียวกับ .exe — รันแอปจาก win-unpacked ต้องเจอไฟล์ key ที่วางข้าง exe */
  try {
    const ep = process.execPath || '';
    if (ep && /\.exe$/i.test(ep.replace(/\\/g, '/'))) {
      searchDirs.push(path.dirname(ep));
    }
  } catch (_) {}
  try {
    if (process.cwd()) searchDirs.push(process.cwd());
  } catch (_) {}

  if (process.versions && process.versions.electron) {
    try {
      const electronApp = require('electron').app;
      if (electronApp) {
        try {
          if (electronApp.isPackaged && process.resourcesPath) {
            searchDirs.push(process.resourcesPath);
          }
        } catch (_) {}
        try {
          searchDirs.push(electronApp.getPath('userData'));
        } catch (_) {}
      }
    } catch (_) {}
  }
  searchDirs.push(__dirname);

  const seen = new Set();
  for (const d of searchDirs) {
    if (!d) continue;
    let key;
    try {
      key = path.resolve(d);
    } catch (_) {
      key = d;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    const found = findServiceAccountInDir(d);
    if (found) return found;
  }
  return null;
}

function ensureMonitorFirestore() {
  if (getMonitorDb) return true;
  monitorFirestoreInitReason = 'missing_file';
  try {
    const admin = require('firebase-admin');
    const serviceAccountPath = resolveServiceAccountPath();
    if (!serviceAccountPath) return false;
    monitorFirestoreInitReason = 'bad_file';
    let raw;
    try {
      raw = fsSync.readFileSync(serviceAccountPath, 'utf8');
    } catch (readErr) {
      console.warn('Monitor Firestore: cannot read service account file:', readErr.message);
      monitorFirestoreInitReason = 'read_error';
      return false;
    }
    const serviceAccount = JSON.parse(raw);
    if (!serviceAccount || typeof serviceAccount.private_key !== 'string') {
      monitorFirestoreInitReason = 'bad_json';
      return false;
    }
    monitorFirestoreInitReason = 'admin_failed';
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    getMonitorDb = () => admin.firestore();
    monitorFirestoreInitReason = null;
    return true;
  } catch (e) {
    console.warn('Monitor Firestore init failed:', e.message);
    if (monitorFirestoreInitReason === 'missing_file') monitorFirestoreInitReason = 'bad_file';
    return false;
  }
}

function hashPin(pin, salt) {
  return crypto.pbkdf2Sync(pin, salt, PBKDF2_ITERATIONS, 64, 'sha512').toString('hex');
}

function verifyPin(pin, salt, storedHash) {
  const computed = hashPin(pin, salt);
  if (computed.length !== storedHash.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(storedHash, 'hex'));
  } catch (_) {
    return false;
  }
}

/** หา user ใน collection users (V2) — logic เดียวกับ api/installer-login */
async function findV2UserByUsername(db, usernameRaw) {
  const raw = (usernameRaw || '').trim();
  if (!raw) return null;
  let username = raw;
  if (/^\d+$/.test(username)) username = username.padStart(6, '0').slice(-6);

  const tryQuery = async (u) => {
    const snap = await db.collection(V2_USERS_COLLECTION).where('username', '==', u).limit(15).get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { _docId: doc.id, ...doc.data() };
  };

  let user = await tryQuery(username);
  if (!user && raw !== username) user = await tryQuery(raw);
  if (!user) {
    const lower = raw.toLowerCase();
    const cap = 800;
    const allSnap = await db.collection(V2_USERS_COLLECTION).limit(cap).get();
    for (const doc of allSnap.docs) {
      const d = doc.data();
      if (String(d.username || '').toLowerCase() === lower) {
        user = { _docId: doc.id, ...d };
        break;
      }
    }
  }
  return user;
}

function v2UserMayAccessMonitor(u) {
  if (!u || !(u.fullname && String(u.fullname).trim())) return false;
  if (process.env.MONITOR_ALLOW_ANY_V2_USER === '1' || process.env.MONITOR_ALLOW_ANY_V2_USER === 'true') {
    return true;
  }
  const g = String(u.group || '').trim();
  const r = String(u.role || '').trim();
  if (g === 'สมาชิก') return false;
  if (g === 'เจ้าหน้าที่' || g === 'กรรมการ') return true;
  if (r === 'ผู้ดูแลระบบ' || r.indexOf('ผู้ดูแล') >= 0) return true;
  if (!g) return true;
  return false;
}

/** อ่าน Monitor API URL จาก env หรือไฟล์ monitor-config.json ข้าง exe/userData */
function getMonitorApiUrl() {
  const fromEnv = (process.env.MONITOR_API_URL || '').trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const searchDirs = [];
  try {
    if (process.execPath && /\.exe$/i.test(process.execPath.replace(/\\/g, '/'))) {
      searchDirs.push(path.dirname(process.execPath));
    }
  } catch (_) {}
  if (process.versions && process.versions.electron) {
    try {
      const electronApp = require('electron').app;
      if (electronApp && electronApp.getPath) searchDirs.push(electronApp.getPath('userData'));
    } catch (_) {}
  }
  searchDirs.push(__dirname);
  for (const dir of searchDirs) {
    try {
      const p = path.join(dir, 'monitor-config.json');
      if (fsSync.existsSync(p) && fsSync.statSync(p).isFile()) {
        const raw = fsSync.readFileSync(p, 'utf8');
        const j = JSON.parse(raw);
        const u = (j.monitorApiUrl || '').trim();
        if (u) return u.replace(/\/$/, '');
      }
    } catch (_) {}
  }
  return '';
}

/** คืนค่า config สำหรับฝั่ง client — ถ้า monitorApiUrl ถูกตั้ง แอปจะล็อกอินผ่าน API บนเซิร์ฟเวอร์ (ไม่ต้องมีไฟล์ service account) */
app.get('/api/config', (req, res) => {
  res.json({ monitorApiUrl: getMonitorApiUrl() });
});

app.post('/api/monitor-login', async (req, res) => {
  const username = (req.body && req.body.username) != null ? String(req.body.username).trim() : '';
  const pin = (req.body && req.body.pin) != null ? String(req.body.pin).trim() : '';
  if (!username) return res.status(400).json({ ok: false, message: 'กรุณากรอกชื่อผู้ใช้' });
  if (!/^\d{6}$/.test(pin)) return res.status(400).json({ ok: false, message: 'รหัส PIN ต้องเป็นตัวเลข 6 หลัก' });

  if (!ensureMonitorFirestore()) {
    const hints = {
      missing_file:
        'ไม่พบไฟล์ firebase-service-account.json — วางข้าง NKBKConnext System.exe แล้วปิดแอปเปิดใหม่ (หรือตั้ง FIREBASE_SERVICE_ACCOUNT_PATH)',
      bad_file:
        'ไฟล์ service account อยู่แล้วแต่อ่าน/แปลงไม่ได้ — ตรวจว่าเป็น JSON จาก Firebase จริง, คลิกขวา Properties > Unblock, หรือเปลี่ยนชื่อเป็น firebase-service-account.json',
      bad_json: 'ไฟล์ JSON ไม่ถูกต้องหรือไม่ใช่คีย์ Service Account',
      read_error: 'เปิดอ่านไฟล์ service account ไม่ได้ — สิทธิ์ไฟล์หรือถูกโปรแกรมอื่นล็อก',
      admin_failed: 'เชื่อมต่อ Firestore ไม่สำเร็จ — ตรวจโปรเจกต์ Firebase และคีย์ service account'
    };
    return res.status(503).json({
      ok: false,
      message: hints[monitorFirestoreInitReason] || hints.missing_file
    });
  }

  try {
    const db = getMonitorDb();
    const v2User = await findV2UserByUsername(db, username);
    if (v2User) {
      const userPin = String(v2User.pin != null ? v2User.pin : '').trim();
      if (userPin !== pin) {
        return res.json({ ok: false, message: 'ชื่อผู้ใช้หรือรหัส PIN ไม่ถูกต้อง' });
      }
      if (!v2UserMayAccessMonitor(v2User)) {
        return res.json({
          ok: false,
          message: 'บัญชีนี้ไม่มีสิทธิ์เข้าแอป Monitor (เฉพาะเจ้าหน้าที่ / กรรมการ / ผู้ดูแลระบบ)'
        });
      }
      const sessionName = String(v2User.username || username).trim() || username;
      const token = crypto.randomBytes(24).toString('hex');
      MONITOR_SESSIONS.set(token, { username: sessionName, createdAt: Date.now() });
      return res.json({ ok: true, token, username: sessionName });
    }

    const docId = username.toLowerCase().replace(/\s+/g, '');
    const docRef = db.collection(MONITOR_COLLECTION).doc(docId);
    const snap = await docRef.get();
    if (!snap.exists) {
      return res.json({
        ok: false,
        message:
          'ชื่อผู้ใช้หรือรหัส PIN ไม่ถูกต้อง — ใช้ชื่อผู้ใช้และ PIN 6 หลักเดียวกับที่ตั้งใน V2 (เจ้าหน้าที่) หรือบัญชีพิเศษใน monitor_users'
      });
    }

    const data = snap.data();
    const salt = data.salt || '';
    const storedHash = data.pinHash || '';
    if (!storedHash || !verifyPin(pin, salt, storedHash)) {
      return res.json({
        ok: false,
        message: 'ชื่อผู้ใช้หรือรหัส PIN ไม่ถูกต้อง'
      });
    }

    const token = crypto.randomBytes(24).toString('hex');
    MONITOR_SESSIONS.set(token, { username: snap.id, createdAt: Date.now() });
    res.json({ ok: true, token, username: snap.id });
  } catch (err) {
    console.error('monitor-login:', err);
    res.status(500).json({ ok: false, message: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
  }
});

app.get('/api/monitor-me', (req, res) => {
  const token = (req.headers['x-monitor-token'] || req.query.token || '').trim();
  const session = token ? MONITOR_SESSIONS.get(token) : null;
  if (!session) return res.status(401).json({ ok: false });
  res.json({ ok: true, username: session.username });
});

app.post('/api/monitor-logout', (req, res) => {
  const token = (req.headers['x-monitor-token'] || req.body?.token || '').trim();
  if (token) MONITOR_SESSIONS.delete(token);
  res.json({ ok: true });
});

// ---------- ระบบโคลน led-ck.com (ตรวจสอบบังคับคดี) ----------
// เมื่อรันจากแอปแพ็ก (app.asar) ใช้ LEDCK_DATA_DIR จาก Electron (userData) เพื่อให้เขียนไฟล์ได้
const LEDCK_DATA_DIR = process.env.LEDCK_DATA_DIR || __dirname;
const LEDCK_DATA_PATH = path.join(LEDCK_DATA_DIR, 'ledck-data.json');
const LEDCK_SESSIONS = new Map(); // token -> { username, createdAt }

const defaultLedckData = () => ({
  users: [{ username: 'admin', password: '123456' }],
  members: [
    { id: 'm1', idCard: '3430500521205', fullName: 'นายเอกชัย นารถชัย', status: 'ล้มละลาย', lastChecked: '2026-03-17T12:13:00.000Z' }
  ]
});

async function readLedckData() {
  try {
    const raw = await fs.readFile(LEDCK_DATA_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') {
      // ย้ายข้อมูลจาก path เก่า (data/ledck.json หรือ ledck-data.json ใน __dirname) ถ้ามี
      const oldPath = path.join(__dirname, 'data', 'ledck.json');
      const oldPath2 = path.join(__dirname, 'ledck-data.json');
      try {
        const rawOld = await fs.readFile(oldPath, 'utf8');
        const data = JSON.parse(rawOld);
        await writeLedckData(data);
        return data;
      } catch (_) {
        try {
          const rawOld2 = await fs.readFile(oldPath2, 'utf8');
          const data = JSON.parse(rawOld2);
          await writeLedckData(data);
          return data;
        } catch (_2) {
          return defaultLedckData();
        }
      }
    }
    throw e;
  }
}

async function writeLedckData(data) {
  await fs.writeFile(LEDCK_DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function requireLedckAuth(req, res, next) {
  const token = (req.headers['x-ledck-token'] || req.query.token || '').trim();
  const session = token ? LEDCK_SESSIONS.get(token) : null;
  if (!session) {
    return res.status(401).json({ ok: false, message: 'กรุณาเข้าสู่ระบบ' });
  }
  req.ledckUser = session.username;
  next();
}

// ล็อกอิน
app.post('/api/ledck/login', async (req, res) => {
  const { username, password } = req.body || {};
  const u = (username || '').trim();
  const p = (password || '').trim();
  if (!u || !p) {
    return res.json({ ok: false, message: 'กรุณากรอกชื่อผู้ใช้งานและรหัสผ่าน' });
  }
  const data = await readLedckData();
  const user = data.users.find((x) => x.username === u && x.password === p);
  if (!user) {
    return res.json({ ok: false, message: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง' });
  }
  const token = require('crypto').randomBytes(24).toString('hex');
  LEDCK_SESSIONS.set(token, { username: u, createdAt: Date.now() });
  res.json({ ok: true, token, user: { username: u } });
});

// สมัครสมาชิก (เพิ่ม user ใหม่)
app.post('/api/ledck/register', async (req, res) => {
  const { username, password } = req.body || {};
  const u = (username || '').trim();
  const p = (password || '').trim();
  if (!u || !p) {
    return res.json({ ok: false, message: 'กรุณากรอกชื่อผู้ใช้งานและรหัสผ่าน' });
  }
  const data = await readLedckData();
  if (data.users.some((x) => x.username === u)) {
    return res.json({ ok: false, message: 'ชื่อผู้ใช้นี้มีอยู่แล้ว' });
  }
  data.users.push({ username: u, password: p });
  await writeLedckData(data);
  res.json({ ok: true, message: 'สมัครสมาชิกเรียบร้อย' });
});

// ออกจากระบบ (ลบ token)
app.post('/api/ledck/logout', (req, res) => {
  const token = (req.headers['x-ledck-token'] || req.body?.token || '').trim();
  if (token) LEDCK_SESSIONS.delete(token);
  res.json({ ok: true });
});

// รายการสมาชิก (ทะเบียนสมาชิก) - ไม่ต้องล็อกอิน
app.get('/api/ledck/members', async (req, res) => {
  const data = await readLedckData();
  let list = data.members || [];
  const search = (req.query.search || '').trim();
  const status = (req.query.status || '').trim();
  if (search) {
    const s = search.toLowerCase();
    list = list.filter((m) => (m.idCard && m.idCard.includes(search)) || (m.fullName && m.fullName.toLowerCase().includes(s)));
  }
  if (status) {
    list = list.filter((m) => (m.status || '') === status);
  }
  res.json({ ok: true, members: list });
});

// เพิ่มสมาชิก
app.post('/api/ledck/members', async (req, res) => {
  try {
    const { idCard, fullName } = req.body || {};
  const id = 'm' + Date.now();
  const data = await readLedckData();
  data.members = data.members || [];
  data.members.push({
    id,
    idCard: (idCard || '').trim(),
    fullName: (fullName || '').trim(),
    status: 'ยังไม่ตรวจสอบ',
    lastChecked: null
  });
    await writeLedckData(data);
    res.json({ ok: true, member: data.members[data.members.length - 1] });
  } catch (err) {
    console.error('ledck add member:', err);
    res.status(500).json({ ok: false, message: err.message || 'บันทึกไม่สำเร็จ' });
  }
});

// แก้ไขสมาชิก
app.put('/api/ledck/members/:id', async (req, res) => {
  const data = await readLedckData();
  const idx = (data.members || []).findIndex((m) => m.id === req.params.id);
  if (idx < 0) return res.status(404).json({ ok: false, message: 'ไม่พบสมาชิก' });
  const { idCard, fullName } = req.body || {};
  if (idCard != null) data.members[idx].idCard = String(idCard).trim();
  if (fullName != null) data.members[idx].fullName = String(fullName).trim();
  await writeLedckData(data);
  res.json({ ok: true, member: data.members[idx] });
});

// ลบสมาชิก
app.delete('/api/ledck/members/:id', async (req, res) => {
  const data = await readLedckData();
  const idx = (data.members || []).findIndex((m) => m.id === req.params.id);
  if (idx < 0) return res.status(404).json({ ok: false, message: 'ไม่พบสมาชิก' });
  data.members.splice(idx, 1);
  await writeLedckData(data);
  res.json({ ok: true });
});

// ตรวจสอบสถานะบังคับคดี (mock: อ่านจาก member หรือสุ่ม/คงที่)
app.post('/api/ledck/check-status', async (req, res) => {
  const { idCard, memberId } = req.body || {};
  const data = await readLedckData();
  let member = null;
  if (memberId) member = (data.members || []).find((m) => m.id === memberId);
  else if (idCard) member = (data.members || []).find((m) => m.idCard === idCard);
  const now = new Date().toISOString();
  if (member) {
    if (!member.lastChecked) {
      member.lastChecked = now;
      member.status = member.status === 'ยังไม่ตรวจสอบ' ? 'ปกติ' : member.status;
      await writeLedckData(data);
    }
    return res.json({
      ok: true,
      result: {
        fullName: member.fullName,
        idCard: member.idCard,
        status: member.status,
        lastChecked: member.lastChecked
      }
    });
  }
  res.json({
    ok: true,
    result: {
      fullName: idCard ? '—' : 'ไม่พบข้อมูล',
      idCard: idCard || '—',
      status: 'ยังไม่ตรวจสอบ',
      lastChecked: now
    }
  });
});

// รายละเอียดคดี (mock)
app.get('/api/ledck/case/:idCard', async (req, res) => {
  const data = await readLedckData();
  const member = (data.members || []).find((m) => m.idCard === req.params.idCard);
  const idCard = req.params.idCard;
  const base = {
    receptionNo: '107730',
    receptionYear: '2568',
    idCard: idCard,
    defendantName: member ? member.fullName : '—',
    courtName: 'ศาลล้มละลายกลาง',
    blackCaseNo: 'ล.2003 ปี 2568',
    redCaseNo: 'ล.7643 ปี 2568',
    plaintiff: 'ธนาคารออมสิน',
    defendants: member ? [member.fullName + ' ที่ 1'] : [],
    debtAmount: '2875416.95',
    filingDate: '25-03-2568',
    absoluteReceivershipDate: '05-08-2568',
    claimDeadlineDate: '24-11-2568',
    claimExaminationDate: '17-12-2568',
    bankruptcyDate: null,
    gazetteDate: null,
    lastUpdate: '2025-08-18'
  };
  res.json({ ok: true, case: base });
});

// หน้าแรก
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// หน้าเข้าสู่ระบบ (Firebase Auth + Firestore เดียวกับ V2)
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// รันเองเมื่อใช้ node server.js; ถ้าให้ Electron เรียกใช้จะไม่ listen ตรงนี้
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`ระบบตรวจสอบสถานะรันที่ http://localhost:${PORT}`);
  });
}

module.exports = { app, PORT };
