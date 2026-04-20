const express = require('express');
const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const fsSync = require('fs');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');
const { URL } = require('url');
const si = require('systeminformation');

const app = express();
const PORT = Number(process.env.PORT) || 3333;
const isWin = process.platform === 'win32';

function getElectronUserDataDir() {
  try {
    if (process.versions && process.versions.electron) {
      const electronApp = require('electron').app;
      if (electronApp && electronApp.getPath) return electronApp.getPath('userData') || '';
    }
  } catch (_) {}
  return '';
}

function normUncPathDriveKey(p) {
  return String(p || '')
    .trim()
    .replace(/\//g, '\\')
    .replace(/\\+$/, '')
    .toLowerCase();
}

/** รวมรายการ SMB จาก Get-SmbMapping — กรณี map แบบไม่ระบุไดรฟ์ (ไม่ขึ้นใน fsSize / networkDrives เดิม) */
async function augmentNetworkDrivesWithSmbMappings(networkDrives) {
  if (!isWin) return networkDrives || [];
  const merged = Array.isArray(networkDrives) ? networkDrives.map((d) => ({ ...d })) : [];
  const script =
    "$ErrorActionPreference='SilentlyContinue'; " +
    "$m = Get-SmbMapping -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'OK' -and $_.RemotePath }; " +
    "if (-not $m) { Write-Output '[]'; exit }; " +
    "$m | Select-Object @{N='local';E={$_.LocalPath}}, @{N='remote';E={$_.RemotePath}} | ConvertTo-Json -Compress";
  const out = await runPsAsync(script, 6000);
  if (!out) return merged;
  let rows;
  try {
    const parsed = JSON.parse(out.trim());
    rows = Array.isArray(parsed) ? parsed : [parsed];
  } catch (_) {
    return merged;
  }
  for (const row of rows) {
    if (!row || row.remote == null) continue;
    const remoteRaw = String(row.remote).trim();
    if (!remoteRaw.startsWith('\\\\')) continue;
    const remoteNorm = normUncPathDriveKey(remoteRaw);
    if (merged.some((d) => normUncPathDriveKey(d.mount) === remoteNorm)) continue;
    const loc = row.local != null ? String(row.local).trim() : '';
    const letterMatch = loc.match(/^([A-Za-z]):\\?$/);
    const driveLetter = letterMatch ? letterMatch[1].toUpperCase() + ':' : '';
    if (driveLetter) {
      const idx = merged.findIndex((d) => {
        const m = String(d.mount || '')
          .trim()
          .replace(/\\+$/,'')
          .toUpperCase();
        return m === driveLetter;
      });
      if (idx >= 0) {
        const note = String(merged[idx].note || '').trim();
        const bit = remoteRaw;
        if (!note.includes(remoteRaw)) {
          merged[idx] = { ...merged[idx], note: note ? note + ' · ' + bit : bit };
        }
        continue;
      }
    }
    merged.push({
      mount: driveLetter || remoteRaw,
      fs: 'SMB',
      type: 'network',
      totalGB: '',
      usedGB: '',
      note: driveLetter ? remoteRaw : ''
    });
  }
  return merged;
}

/** เติมจาก nas-last-connect.json (หลังเชื่อมต่อ NAS สำเร็จ) — มี UNC + ชื่อผู้ใช้ (ไม่เก็บรหัส) */
function mergeNasLastConnectHint(networkDrives) {
  const merged = Array.isArray(networkDrives) ? networkDrives.map((d) => ({ ...d })) : [];
  const dir = getElectronUserDataDir();
  if (!dir) return merged;
  const fp = path.join(dir, 'nas-last-connect.json');
  if (!fsSync.existsSync(fp)) return merged;
  let j;
  try {
    j = JSON.parse(fsSync.readFileSync(fp, 'utf8'));
  } catch (_) {
    return merged;
  }
  const unc = String(j.uncPath || '').trim().replace(/\//g, '\\');
  const un = String(j.username || '').trim();
  if (!unc.startsWith('\\\\')) return merged;
  const norm = normUncPathDriveKey(unc);
  const hasUncRow = merged.some((d) => normUncPathDriveKey(d.mount) === norm);
  if (hasUncRow) {
    return merged.map((d) => {
      if (normUncPathDriveKey(d.mount) !== norm) return d;
      if (!un) return d;
      const note = String(d.note || '');
      if (note.includes(un)) return d;
      const tag = 'ผู้ใช้ SMB: ' + un;
      return { ...d, note: note ? note + ' · ' + tag : tag };
    });
  }
  merged.push({
    mount: unc,
    fs: 'SMB',
    type: 'network',
    totalGB: '',
    usedGB: '',
    note: un ? 'ผู้ใช้ SMB: ' + un + ' · จากการเชื่อมต่อในแอป' : 'จากการเชื่อมต่อในแอป'
  });
  return merged;
}

// Cache ข้อมูล Windows (ช้า) ไว้ 2 นาที ไม่รัน PowerShell บ่อย
const WINDOWS_CACHE_TTL_MS = 2 * 60 * 1000;
let windowsCache = { data: null, expires: 0 };
let winNetExtrasCache = { data: null, expires: 0 };

function normIfaceKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function dnsServersForIface(entry, dnsList) {
  if (!Array.isArray(dnsList) || !dnsList.length) return '';
  const names = [entry.ifaceName, entry.iface].map(normIfaceKey).filter(Boolean);
  for (const row of dnsList) {
    const alias = normIfaceKey(row.InterfaceAlias != null ? row.InterfaceAlias : row.interfaceAlias);
    const dnsStr = row.Dns != null ? row.Dns : row.dns;
    if (!alias || !dnsStr) continue;
    for (const n of names) {
      if (alias === n || alias.includes(n) || n.includes(alias)) return String(dnsStr).trim();
    }
  }
  return '';
}

function adapterDetailForIface(entry, adapters) {
  if (!Array.isArray(adapters) || !adapters.length) return null;
  const names = [entry.ifaceName, entry.iface].map(normIfaceKey).filter(Boolean);
  for (const ad of adapters) {
    const an = normIfaceKey(ad.Name != null ? ad.Name : ad.name);
    if (!an) continue;
    for (const n of names) {
      if (an === n || an.includes(n) || n.includes(an)) {
        return {
          description: ad.Description != null ? String(ad.Description) : ad.description != null ? String(ad.description) : '',
          driverVersion: ad.DriverVersion != null ? String(ad.DriverVersion) : ad.driverVersion != null ? String(ad.driverVersion) : '',
          linkSpeed: ad.LinkSpeed != null ? String(ad.LinkSpeed) : ad.linkSpeed != null ? String(ad.linkSpeed) : ''
        };
      }
    }
  }
  return null;
}

/** DNS ต่ออินเทอร์เฟซ + รายละเอียดอะแดปเตอร์ (ผู้ผลิต/ไดรเวอร์/ความเร็วลิงก์) — Windows เท่านั้น */
async function fetchWindowsNetworkExtrasOnce() {
  if (!isWin) return { dnsList: [], adapters: [] };
  const script =
    "$d=@();Get-DnsClientServerAddress -AddressFamily IPv4 -EA 0|Where-Object{$_.ServerAddresses -and $_.ServerAddresses.Count -gt 0}|ForEach-Object{$d+=[PSCustomObject]@{InterfaceAlias=[string]$_.InterfaceAlias;Dns=[string]($_.ServerAddresses -join ', ')}};$a=@();Get-NetAdapter -EA 0|Where-Object{$_.Status -eq 'Up'}|ForEach-Object{$a+=[PSCustomObject]@{Name=[string]$_.Name;Description=[string]$_.InterfaceDescription;DriverVersion=[string]$_.DriverVersion;LinkSpeed=[string]$_.LinkSpeed}};[PSCustomObject]@{dns=$d;adapters=$a}|ConvertTo-Json -Compress -Depth 5";
  const { out } = await runPsWithEnv(script, null, 12000);
  if (!out) return { dnsList: [], adapters: [] };
  try {
    const j = JSON.parse(out);
    const dns = j.dns != null ? (Array.isArray(j.dns) ? j.dns : [j.dns]) : [];
    const adapters = j.adapters != null ? (Array.isArray(j.adapters) ? j.adapters : [j.adapters]) : [];
    return { dnsList: dns, adapters };
  } catch (_) {
    return { dnsList: [], adapters: [] };
  }
}

async function getWindowsNetworkExtrasCached() {
  const now = Date.now();
  if (winNetExtrasCache.data && now < winNetExtrasCache.expires) return winNetExtrasCache.data;
  const data = await fetchWindowsNetworkExtrasOnce();
  winNetExtrasCache = { data, expires: now + WINDOWS_CACHE_TTL_MS };
  return data;
}

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

/** Payload เดียวกับ GET /api/system — ใช้อัปโหลดขึ้น monitor-api (เว็บ) */
async function buildSystemSnapshotJson() {
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
    uuid,
    timeInfo,
    defaultGatewayRaw
  ] = await Promise.all([
    si.osInfo().catch(() => ({})),
    si.cpu().catch(() => ({})),
    si.mem().catch(() => ({})),
    si.diskLayout().catch(() => []),
    si.fsSize().catch(() => []),
    si.networkInterfaces().catch(() => []),
    si.currentLoad().catch(() => ({})),
    si.processes().catch(() => ({ all: 0, running: 0 })),
    si.system().catch(() => ({})),
    si.battery().catch(() => ({})),
    si.graphics().catch(() => ({ controllers: [], displays: [] })),
    si.uuid().catch(() => ({})),
    Promise.resolve(typeof si.time === 'function' ? si.time() : null).catch(() => null),
    si.networkGatewayDefault().catch(() => '')
  ]);

  const netList = Array.isArray(networkInterfaces) ? networkInterfaces : [];
  const diskList = Array.isArray(diskLayout) ? diskLayout : [];
  const fsList = Array.isArray(fsSize) ? fsSize : [];
  const gfx = graphics && typeof graphics === 'object' ? graphics : { controllers: [], displays: [] };
  const proc = processes && typeof processes === 'object' ? processes : { all: 0, running: 0, list: [] };
  const osI = osInfo && typeof osInfo === 'object' ? osInfo : {};
  const cpuI = cpu && typeof cpu === 'object' ? cpu : {};
  const memI = mem && typeof mem === 'object' ? mem : { total: 0, used: 0, free: 0, active: 0, available: 0 };
  const bat = battery && typeof battery === 'object' ? battery : {};
  const sysI = system && typeof system === 'object' ? system : {};
  const uuidI = uuid && typeof uuid === 'object' ? uuid : {};
  const timeI = timeInfo && typeof timeInfo === 'object' ? timeInfo : {};

  const osUptimeSec =
    osI.uptime != null && osI.uptime >= 0
      ? osI.uptime
      : timeI.uptime != null && timeI.uptime >= 0
        ? timeI.uptime
        : null;

  const storage = fsList.filter(f => f.mount && f.size > 0).map(f => ({
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

  const lineRunning = Array.isArray(proc.list) && proc.list.some((p) => (p.name || '').toLowerCase() === 'line.exe');
  const lineInfo = { installed: line.installed, running: lineRunning, version: line.version };

  const disks = diskList.slice(0, 5).map(d => ({
    name: d.name,
    type: d.type,
    size: (d.size / 1e12).toFixed(2) + ' TB',
    vendor: d.vendor
  }));

  let net = netList.filter(n => !n.internal && n.ip4).map(n => {
    const t = (n.type || '').toLowerCase();
    const connectionType = t === 'wireless' ? 'Wi-Fi' : t === 'wired' ? 'LAN' : (n.ifaceName || '').toLowerCase().includes('wi-fi') || (n.ifaceName || '').toLowerCase().includes('wireless') ? 'Wi-Fi' : 'LAN';
    return {
      iface: n.iface || n.ifaceName,
      ifaceName: n.ifaceName || n.iface,
      ip4: n.ip4,
      subnet: n.ip4subnet || '',
      ip6: n.ip6 || '',
      mac: n.mac,
      operstate: n.operstate || 'unknown',
      speed: n.speed != null ? n.speed + ' Mbps' : null,
      speedMbps: n.speed != null ? n.speed : null,
      connectionType,
      dhcp: n.dhcp === true,
      isDefault: n.default === true,
      dnsSuffix: n.dnsSuffix || ''
    };
  });

  const networkDefaultGateway = typeof defaultGatewayRaw === 'string' ? defaultGatewayRaw.trim() : '';
  if (isWin && net.length) {
    const { dnsList, adapters } = await getWindowsNetworkExtrasCached();
    net = net.map((e) => {
      const dnsServers = dnsServersForIface(e, dnsList);
      const ad = adapterDetailForIface(e, adapters);
      const out = { ...e };
      if (dnsServers) out.dnsServers = dnsServers;
      if (ad) {
        if (ad.description) out.adapterDescription = ad.description;
        if (ad.driverVersion) out.driverVersion = ad.driverVersion;
        if (ad.linkSpeed) out.linkSpeedDetail = ad.linkSpeed;
      }
      if (e.isDefault && networkDefaultGateway) out.defaultGateway = networkDefaultGateway;
      return out;
    });
  } else {
    net = net.map((e) => {
      const out = { ...e };
      if (e.isDefault && networkDefaultGateway) out.defaultGateway = networkDefaultGateway;
      return out;
    });
  }

  const networkStatus = netList.some(n => n.operstate === 'up')
    ? 'connected'
    : (netList.length ? 'disconnected' : 'no_interfaces');

  let networkDrives = fsList
    .filter((f) => {
      const ty = String(f.type || '').toLowerCase();
      const m = String(f.mount || '').trim();
      if (ty === 'network' || ty === 'cifs' || ty === 'smb' || ty === 'nfs') return true;
      if (m.startsWith('\\\\')) return true;
      return false;
    })
    .map((f) => ({
      mount: f.mount,
      fs: f.fs,
      type: f.type,
      totalGB: f.size ? (Number(f.size) / 1e9).toFixed(2) : null,
      usedGB: f.used != null ? (Number(f.used) / 1e9).toFixed(2) : null,
      usePercent: f.use != null ? Number(f.use).toFixed(1) : null
    }));

  networkDrives = await augmentNetworkDrivesWithSmbMappings(networkDrives);
  networkDrives = mergeNasLastConnectHint(networkDrives);

  const ctrl0 = gfx.controllers && gfx.controllers[0];
  const gpu = ctrl0 ? {
    model: ctrl0.model,
    vram: ctrl0.vram ? (ctrl0.vram / 1024).toFixed(1) + ' GB' : 'N/A'
  } : null;

  const memTotal = Number(memI.total) || 0;
  const memUsed = Number(memI.used) || 0;
  const memFree = Number(memI.free) || 0;
  const usagePct = memTotal > 0 ? ((memUsed / memTotal) * 100).toFixed(1) : '0.0';
  const loadI = currentLoad && typeof currentLoad === 'object' ? currentLoad : {};

  let appVersionSnap = '0.0.0';
  try {
    appVersionSnap = String(require('./package.json').version || '0.0.0');
  } catch (_) {}

  return {
    appVersion: appVersionSnap,
    os: {
      hostname: osI.hostname,
      platform: osI.platform,
      distro: osI.distro,
      release: osI.release,
      build: osI.build || '',
      arch: osI.arch,
      kernel: osI.kernel,
      serial: osI.serial,
      uptime: osUptimeSec,
      logofile: osI.logofile
    },
    cpu: {
      manufacturer: cpuI.manufacturer,
      brand: cpuI.brand,
      cores: cpuI.cores,
      physicalCores: cpuI.physicalCores,
      speed: cpuI.speed,
      speedMin: cpuI.speedMin,
      speedMax: cpuI.speedMax
    },
    memory: {
      total: memI.total,
      free: memI.free,
      used: memI.used,
      active: memI.active,
      available: memI.available,
      totalGB: (memTotal / 1e9).toFixed(2),
      usedGB: (memUsed / 1e9).toFixed(2),
      freeGB: (memFree / 1e9).toFixed(2),
      usagePercent: usagePct
    },
    load: {
      currentLoad: loadI.currentLoad || 0,
      currentLoadUser: loadI.currentLoadUser || 0,
      currentLoadSystem: loadI.currentLoadSystem || 0
    },
    processes: {
      all: proc.all || 0,
      running: proc.running || 0
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
    ...(networkDefaultGateway ? { networkDefaultGateway } : {}),
    battery: bat.percent !== undefined ? {
      percent: bat.percent,
      isCharging: bat.isCharging,
      acConnected: bat.acConnected,
      timeRemaining: bat.timeRemaining
    } : null,
    gpu,
    graphics: {
      controllers: Array.isArray(gfx.controllers) ? gfx.controllers : [],
      displays: Array.isArray(gfx.displays) ? gfx.displays : []
    },
    networkDrives,
    system: {
      manufacturer: sysI.manufacturer,
      model: sysI.model,
      serial: sysI.serial,
      uuid: uuidI.os || uuidI.hardware
    },
    timestamp: Date.now()
  };
}

function stripUndefinedDeepForLive(val) {
  if (val === undefined) return undefined;
  if (val === null || typeof val !== 'object') return val;
  if (Array.isArray(val)) {
    return val.map(stripUndefinedDeepForLive).filter((x) => x !== undefined);
  }
  const o = {};
  for (const [k, v] of Object.entries(val)) {
    if (v === undefined) continue;
    const inner = stripUndefinedDeepForLive(v);
    if (inner !== undefined) o[k] = inner;
  }
  return o;
}

/** ข้อมูลย่อยสำหรับแอดมิน #programs (ซิงก์ไป Firestore เป็น map เดียว) */
function buildLiveDetailPayload(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return {};
  const s = snapshot;
  return stripUndefinedDeepForLive({
    schemaVersion: 1,
    uuid: (s.system && s.system.uuid) || (s.os && s.os.serial) || '',
    capturedAt: s.timestamp || Date.now(),
    os: s.os,
    cpu: s.cpu,
    memory: s.memory,
    load: s.load,
    processes: s.processes,
    disks: s.disks,
    storage: s.storage,
    networkDrives: s.networkDrives,
    gpu: s.gpu,
    graphics: s.graphics,
    network: s.network,
    networkStatus: s.networkStatus,
    networkDefaultGateway: s.networkDefaultGateway,
    printers: s.printers,
    printerDrivers: s.printerDrivers,
    office: s.office,
    line: s.line,
    battery: s.battery,
    windowsUpdate: s.windowsUpdate,
    system: s.system,
    appVersion: s.appVersion,
    extras: s.extras
  });
}

// API: ข้อมูลระบบทั้งหมด
app.get('/api/system', async (req, res) => {
  try {
    const payload = await buildSystemSnapshotJson();
    res.json(payload);
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
    const udir = getElectronUserDataDir();
    if (udir) {
      const fp = path.join(udir, 'nas-last-connect.json');
      fs.writeFile(
        fp,
        JSON.stringify({ uncPath: pathNorm, username: user, updatedAt: Date.now() }),
        'utf8'
      ).catch(() => {});
    }
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
const MONITOR_SESSIONS = new Map(); // token -> { username, createdAt, fullname, ... }
/** LINE Login (OAuth) — state -> { redirectUri, expires } */
const LINE_OAUTH_PENDING = new Map();
/** หลัง callback สำเร็จ — state -> { token, username, error, expires } ให้หน้า login poll */
const LINE_LOGIN_POLL = new Map();

/** บันทึกเซสชันลงดิสก์ — หลังปิดแอป/รีสตาร์ทเซิร์ฟเวอร์ ยังใช้โทเดิมจาก localStorage ได้ (จนกว่าจะกดออกจากระบบ) */
function getMonitorSessionsFilePath() {
  return path.join(process.env.LEDCK_DATA_DIR || __dirname, 'monitor-sessions.json');
}
function loadMonitorSessionsFromDisk() {
  try {
    const p = getMonitorSessionsFilePath();
    if (!fsSync.existsSync(p)) return;
    const raw = fsSync.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    const tokens = parsed && parsed.tokens && typeof parsed.tokens === 'object' ? parsed.tokens : null;
    if (!tokens) return;
    let n = 0;
    for (const [token, sess] of Object.entries(tokens)) {
      if (!token || typeof token !== 'string' || token.length < 16) continue;
      if (!sess || typeof sess !== 'object' || !sess.username) continue;
      MONITOR_SESSIONS.set(token, {
        username: String(sess.username).trim(),
        createdAt: typeof sess.createdAt === 'number' ? sess.createdAt : Date.now(),
        fullname: sess.fullname != null ? String(sess.fullname).trim() : '',
        email: sess.email != null ? String(sess.email).trim() : '',
        group: sess.group != null ? String(sess.group).trim() : '',
        role: sess.role != null ? String(sess.role).trim() : ''
      });
      n++;
    }
    if (n > 0) console.log('[Monitor] โหลดเซสชันที่บันทึกไว้:', n, 'รายการ');
  } catch (e) {
    console.warn('[Monitor] โหลด monitor-sessions.json ไม่สำเร็จ:', e.message);
  }
}
let _monitorSessionsPersistTimer = null;
function persistMonitorSessionsToDisk() {
  if (_monitorSessionsPersistTimer) clearTimeout(_monitorSessionsPersistTimer);
  _monitorSessionsPersistTimer = setTimeout(() => {
    _monitorSessionsPersistTimer = null;
    try {
      const p = getMonitorSessionsFilePath();
      const dir = path.dirname(p);
      if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
      const tokens = {};
      MONITOR_SESSIONS.forEach((sess, token) => {
        tokens[token] = {
          username: sess.username,
          createdAt: sess.createdAt || Date.now(),
          fullname: sess.fullname || '',
          email: sess.email || '',
          group: sess.group || '',
          role: sess.role || ''
        };
      });
      fsSync.writeFileSync(p, JSON.stringify({ version: 1, tokens }, null, 0), 'utf8');
    } catch (e) {
      console.warn('[Monitor] บันทึก monitor-sessions.json ไม่สำเร็จ:', e.message);
    }
  }, 80);
}
function monitorSessionsSet(token, sessionObj) {
  MONITOR_SESSIONS.set(token, sessionObj);
  persistMonitorSessionsToDisk();
}
function monitorSessionsDelete(token) {
  if (!token) return;
  MONITOR_SESSIONS.delete(token);
  persistMonitorSessionsToDisk();
}
loadMonitorSessionsFromDisk();
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
  /** บาง build / ทีมวางคีย์ไว้ที่ dist/ — ค้นหาเพิ่มจาก cwd และโฟลเดอร์ของ server.js */
  try {
    if (process.cwd()) searchDirs.push(path.join(process.cwd(), 'dist'));
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
  try {
    searchDirs.push(path.join(__dirname, 'dist'));
  } catch (_) {}

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

/** Document ID สำหรับซิงก์เครื่องไป Firestore programs — ใช้ env MONITOR_PROGRAM_DOC_ID เพื่อผูกกับรายการที่มีอยู่แล้ว */
function slugifyWorkstationProgramDocId(hostname) {
  const h = String(hostname || 'pc').trim() || 'pc';
  const s = h.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^[._]+|[._]+$/g, '').slice(0, 120);
  return 'ws_' + (s || 'pc');
}

const _UUID_DOC_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ลำดับโฟลเดอร์ค้นหา monitor-config.json
 * - โหมดพัฒนา (ไม่ packaged): โฟลเดอร์โปรเจกต์ก่อน userData — กันไฟล์เก่าใน AppData ทับ URL/secret ผิด
 * - Portable/ติดตั้ง: ข้าง .exe ก่อน แล้ว userData
 */
function getMonitorConfigSearchDirs() {
  const dirs = [];
  let packaged = false;
  let userData = '';
  try {
    if (process.versions && process.versions.electron) {
      const electronApp = require('electron').app;
      if (electronApp && electronApp.getPath) {
        packaged = !!electronApp.isPackaged;
        userData = electronApp.getPath('userData');
      }
    }
  } catch (_) {}
  let execDir = '';
  try {
    if (process.execPath && /\.exe$/i.test(process.execPath.replace(/\\/g, '/'))) {
      execDir = path.dirname(process.execPath);
    }
  } catch (_) {}
  if (packaged) {
    if (execDir) dirs.push(execDir);
    try {
      if (process.versions && process.versions.electron) {
        const electronApp = require('electron').app;
        if (electronApp && electronApp.isPackaged && process.resourcesPath) {
          dirs.push(process.resourcesPath);
        }
      }
    } catch (_) {}
    if (userData) dirs.push(userData);
    dirs.push(__dirname);
  } else {
    dirs.push(__dirname);
    if (userData) dirs.push(userData);
    if (execDir) dirs.push(execDir);
  }
  const seen = new Set();
  return dirs.filter((d) => {
    if (!d) return false;
    let key;
    try {
      key = path.resolve(d);
    } catch (_) {
      key = d;
    }
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** ลำดับเดียวกับ getMonitorApiUrl — หา monitor-config.json ไฟล์แรกที่มี */
function findMonitorConfigJsonPath() {
  for (const dir of getMonitorConfigSearchDirs()) {
    try {
      const p = path.join(dir, 'monitor-config.json');
      if (fsSync.existsSync(p) && fsSync.statSync(p).isFile()) return p;
    } catch (_) {}
  }
  return '';
}

/** LINE Login channel (OAuth) — env หรือ monitor-config.json */
function getLineLoginChannelCredentials() {
  const id = (process.env.LINE_LOGIN_CHANNEL_ID || '').trim();
  const secret = (process.env.LINE_LOGIN_CHANNEL_SECRET || '').trim();
  if (id && secret) return { channelId: id, channelSecret: secret };
  const p = findMonitorConfigJsonPath();
  if (!p) return { channelId: '', channelSecret: '' };
  try {
    const raw = fsSync.readFileSync(p, 'utf8');
    const j = JSON.parse(raw);
    if (!j || j.type === 'service_account') return { channelId: '', channelSecret: '' };
    const cid = String(j.lineLoginChannelId || j.LINE_LOGIN_CHANNEL_ID || '').trim();
    const sec = String(j.lineLoginChannelSecret || j.LINE_LOGIN_CHANNEL_SECRET || '').trim();
    if (cid && sec) return { channelId: cid, channelSecret: sec };
  } catch (_) {}
  return { channelId: '', channelSecret: '' };
}

/** รับเฉพาะ loopback — กัน open redirect */
function sanitizeLineLoginRedirectBase(s) {
  const u = String(s || '').trim();
  if (!/^http:\/\/127\.0\.0\.1:\d+$/i.test(u)) return '';
  return u.replace(/\/+$/, '');
}

/** อ่าน programSyncAliases จาก JSON (ไม่รับ service account JSON) */
function programSyncAliasesFromConfigRaw(raw) {
  try {
    const j = JSON.parse(raw);
    if (j && j.type === 'service_account') return [];
    const a = j.programSyncAliases;
    if (Array.isArray(a)) return a.map((x) => String(x).trim()).filter(Boolean);
    if (typeof a === 'string' && a.trim()) {
      return a.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    }
  } catch (_) {}
  return [];
}

/**
 * ชื่อเพิ่มสำหรับจับคู่การ์ดแอดมินเมื่อ hostname Windows (เช่น GLOSZILLA-V) ≠ ชื่อใน Firestore (เช่น NKBK-GLOSZILLA)
 * env: MONITOR_PROGRAM_SYNC_ALIASES=ชื่อ1,ชื่อ2 หรือใส่ใน monitor-config.json
 */
function getProgramSyncAliases() {
  const set = new Set();
  const envA = (process.env.MONITOR_PROGRAM_SYNC_ALIASES || '').trim();
  if (envA) {
    envA.split(/[,;]/).map((s) => s.trim()).filter(Boolean).forEach((s) => set.add(s));
  }
  const cfgPath = findMonitorConfigJsonPath();
  if (cfgPath) {
    try {
      const raw = fsSync.readFileSync(cfgPath, 'utf8');
      programSyncAliasesFromConfigRaw(raw).forEach((s) => set.add(s));
    } catch (_) {}
  }
  return Array.from(set);
}

/** แถวแรกใน adminNetworkDrives → ฟอร์ม NAS บนเครื่อง (สอดคล้องแอดมินเว็บ) */
function firstAdminDriveToNasForm(drives) {
  const arr = Array.isArray(drives) ? drives : [];
  for (const d of arr) {
    if (!d || typeof d !== 'object') continue;
    const unc = String(d.uncPath || '').trim().replace(/\//g, '\\');
    let m = String(d.mount || d.unc || '').trim().replace(/\//g, '\\');
    const uncPath = unc || (m.startsWith('\\\\') ? m : '');
    const user = String(d.smbUsername || '').trim();
    const pass = String(d.smbPassword || '');
    const letterRaw = String(d.driveLetter || '').trim();
    let driveSel = letterRaw.toUpperCase().replace(/:$/, '');
    if (!driveSel && /^[A-Za-z]:/.test(m)) driveSel = m.charAt(0).toUpperCase();
    const effectiveUnc = uncPath || m;
    if (!effectiveUnc && !user && !pass) continue;
    return {
      uncPath: effectiveUnc || '',
      username: user,
      password: pass,
      driveLetter: driveSel || ''
    };
  }
  return null;
}

function buildNasWebRevision(docId, nas) {
  const payload = {
    docId: String(docId || ''),
    uncPath: nas.uncPath || '',
    username: nas.username || '',
    password: nas.password || '',
    driveLetter: nas.driveLetter || ''
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);
}

/** เลือกเอกสาร programs ที่ตรงชื่อเครื่อง — ถ้ามีหลายไฟล์ ให้ลำดับ UUID (การ์ดแอดมินเดิม) ก่อน doc แบบ ws_ */
function pickPreferredProgramDocByHostname(docs) {
  if (!docs || docs.length === 0) return null;
  if (docs.length === 1) return docs[0];
  const uuidFirst = docs.find((d) => _UUID_DOC_ID_RE.test(d.id));
  return uuidFirst || docs[0];
}

/**
 * หา docRef สำหรับซิงก์: 1) MONITOR_PROGRAM_DOC_ID 2) ลองทุกชื่อใน nameCandidates กับ device.computer_name / name 3) ws_<ชื่อแรก>
 * nameCandidates = hostname จริง + aliases (เช่น NKBK-XXX เมื่อ Windows ชื่อ GLOSZILLA-V)
 */
async function resolveConnextProgramDocRef(db, nameCandidates) {
  const envId = (process.env.MONITOR_PROGRAM_DOC_ID || '').trim();
  if (envId) {
    return {
      docRef: db.collection('programs').doc(envId),
      docId: envId,
      source: 'env',
      matchedBy: null,
      preserveDisplayNames: true
    };
  }
  const list = Array.isArray(nameCandidates)
    ? [...new Set(nameCandidates.map((n) => String(n || '').trim()).filter((n) => n && n !== 'unknown'))]
    : [String(nameCandidates || '').trim()].filter((n) => n && n !== 'unknown');

  if (list.length === 0) {
    const slug = slugifyWorkstationProgramDocId('pc');
    return {
      docRef: db.collection('programs').doc(slug),
      docId: slug,
      source: 'ws_slug',
      matchedBy: null,
      preserveDisplayNames: false
    };
  }

  try {
    for (const hn of list) {
      let qs = await db.collection('programs').where('device.computer_name', '==', hn).limit(8).get();
      let chosen = pickPreferredProgramDocByHostname(qs.docs);
      if (!chosen) {
        qs = await db.collection('programs').where('name', '==', hn).limit(8).get();
        chosen = pickPreferredProgramDocByHostname(qs.docs);
      }
      if (chosen) {
        return {
          docRef: chosen.ref,
          docId: chosen.id,
          source: 'matched_existing',
          matchedBy: hn,
          preserveDisplayNames: true
        };
      }
    }
  } catch (err) {
    console.warn('[NKBKConnext] ค้นหา programs ตามชื่อเครื่องไม่สำเร็จ:', err.message);
  }
  const slug = slugifyWorkstationProgramDocId(list[0]);
  return {
    docRef: db.collection('programs').doc(slug),
    docId: slug,
    source: 'ws_slug',
    matchedBy: list[0],
    preserveDisplayNames: false
  };
}

/**
 * อ่านการเชื่อมต่อเว็บไซต์ (adminWebConnections[0]) กลับมาจาก Firestore — เพื่อให้ desktop ซิงก์ค่ากลับจากเว็บแอดมิน
 * พยายาม local Firestore ก่อน ถ้าไม่มี SA ให้ดึงผ่าน monitor-api (ใช้ read key เหมือน NAS)
 */
async function readProgramsWebFromLocalFirestore() {
  if (!ensureMonitorFirestore()) {
    return { ok: false, reason: 'no_firestore' };
  }
  try {
    const db = getMonitorDb();
    const osInfo = await si.osInfo();
    const hostname = (osInfo.hostname || 'unknown').toString().trim() || 'unknown';
    const winComputerName = isWin ? String(process.env.COMPUTERNAME || '').trim() : '';
    const syncAliases = getProgramSyncAliases();
    const nameCandidates = [...new Set([hostname, winComputerName, ...syncAliases].filter(Boolean))];
    const { docRef, docId, source, matchedBy } = await resolveConnextProgramDocRef(db, nameCandidates);
    const snap = await docRef.get();
    if (!snap.exists) {
      return { ok: false, reason: 'no_doc', docId, source, matchedBy };
    }
    const data = snap.data() || {};
    const list = Array.isArray(data.adminWebConnections) ? data.adminWebConnections : [];
    const row0 = list[0] && typeof list[0] === 'object' ? list[0] : null;
    if (!row0 || (!row0.url && !row0.name && !row0.username)) {
      return { ok: false, reason: 'no_admin_web', docId, source, matchedBy };
    }
    const web = {
      name: row0.name != null ? String(row0.name) : '',
      url: row0.url != null ? String(row0.url) : '',
      database: row0.database != null ? String(row0.database) : '',
      username: row0.username != null ? String(row0.username) : '',
      password: row0.password != null ? String(row0.password) : '',
      note: row0.note != null ? String(row0.note) : ''
    };
    return { ok: true, docId, source, matchedBy, web };
  } catch (e) {
    return { ok: false, reason: 'local_error', message: (e && e.message) || String(e) };
  }
}

async function readProgramsNasFromLocalFirestore() {
  if (!ensureMonitorFirestore()) {
    return { ok: false, reason: 'no_firestore' };
  }
  try {
    const db = getMonitorDb();
    const osInfo = await si.osInfo();
    const hostname = (osInfo.hostname || 'unknown').toString().trim() || 'unknown';
    const winComputerName = isWin ? String(process.env.COMPUTERNAME || '').trim() : '';
    const syncAliases = getProgramSyncAliases();
    const nameCandidates = [...new Set([hostname, winComputerName, ...syncAliases].filter(Boolean))];
    const { docRef, docId, source, matchedBy } = await resolveConnextProgramDocRef(db, nameCandidates);
    const snap = await docRef.get();
    if (!snap.exists) {
      return { ok: false, reason: 'no_doc', docId, source, matchedBy };
    }
    const data = snap.data() || {};
    const nas = firstAdminDriveToNasForm(data.adminNetworkDrives);
    if (!nas) {
      return { ok: false, reason: 'no_admin_drives', docId, source, matchedBy };
    }
    const revision = buildNasWebRevision(docId, nas);
    return { ok: true, docId, source, matchedBy, nas, revision };
  } catch (e) {
    return { ok: false, reason: 'local_error', message: (e && e.message) || String(e) };
  }
}

/** เขียนแถว NAS แรกใน adminNetworkDrives (ให้แอดมินเว็บเห็นตรงกับที่ตั้งบนโปรแกรม) — ต้องมี Firebase Admin บนเครื่อง */
async function pushAdminNasToFirestoreFromWorkstation(body) {
  if (!ensureMonitorFirestore()) {
    return { ok: false, reason: 'no_firestore' };
  }
  const pathNorm = String((body && body.uncPath) || '').trim().replace(/\//g, '\\');
  const user = String((body && body.username) || '').trim();
  const password = body && body.password != null ? String(body.password) : '';
  const letter = body && body.driveLetter
    ? String(body.driveLetter).trim().toUpperCase().replace(/[^A-Z]/g, '')
    : '';
  if (!UNC_REGEX.test(pathNorm) || !user) {
    return { ok: false, reason: 'invalid_unc_or_user' };
  }
  try {
    const db = getMonitorDb();
    const adminSdk = require('firebase-admin');
    const FieldValue = adminSdk.firestore.FieldValue;
    const osInfo = await si.osInfo();
    const hostname = (osInfo.hostname || 'unknown').toString().trim() || 'unknown';
    const winComputerName = isWin ? String(process.env.COMPUTERNAME || '').trim() : '';
    const syncAliases = getProgramSyncAliases();
    const nameCandidates = [...new Set([hostname, winComputerName, ...syncAliases].filter(Boolean))];
    const { docRef, docId } = await resolveConnextProgramDocRef(db, nameCandidates);
    const snap = await docRef.get();
    const existing = snap.exists ? snap.data() || {} : {};
    let drives = Array.isArray(existing.adminNetworkDrives)
      ? existing.adminNetworkDrives.map((d) => (d && typeof d === 'object' ? { ...d } : {}))
      : [];
    const prev0 = drives[0] && typeof drives[0] === 'object' ? drives[0] : {};
    const row = {
      mount: letter ? `${letter}:` : pathNorm,
      fs: 'SMB',
      type: 'network',
      uncPath: pathNorm,
      smbUsername: user
    };
    if (letter) row.driveLetter = letter;
    if (password) {
      row.smbPassword = password;
    } else if (prev0.smbPassword) {
      row.smbPassword = prev0.smbPassword;
    }
    const merged0 = { ...prev0, ...row };
    if (prev0.note != null && String(prev0.note).trim() !== '' && (merged0.note == null || String(merged0.note).trim() === '')) {
      merged0.note = prev0.note;
    }
    if (prev0.totalGB != null && merged0.totalGB == null) merged0.totalGB = prev0.totalGB;
    if (prev0.usedGB != null && merged0.usedGB == null) merged0.usedGB = prev0.usedGB;
    drives[0] = merged0;
    if (drives.length === 0) drives = [merged0];
    await docRef.set(
      {
        adminNetworkDrives: drives,
        connextAdminNasPushedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    const nas = firstAdminDriveToNasForm(drives);
    const revision = nas ? buildNasWebRevision(docId, nas) : '';
    return { ok: true, docId, revision };
  } catch (e) {
    return { ok: false, reason: 'error', message: (e && e.message) || String(e) };
  }
}

/**
 * ซิงก์ "เว็บไซต์ / บริการที่เชื่อมต่อ" จากโปรแกรมบนเครื่อง → Firestore (adminWebConnections[0])
 * เรียกจาก /api/programs-push-admin-web (localhost เท่านั้น)
 * ถ้าเครื่องมี firebase service account จะเขียนตรง; ไม่งั้น fallback proxy ไปที่ monitor-api (nkbk.srsp.app)
 */
async function pushAdminWebToFirestoreFromWorkstation(body) {
  const rawUrl = String((body && body.url) || '').trim();
  if (!rawUrl) return { ok: false, reason: 'invalid_url' };
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : ('http://' + rawUrl);
  const database = (body && body.database) != null ? String(body.database).trim() : '';
  const username = (body && body.username) != null ? String(body.username).trim() : '';
  const password = body && body.password != null ? String(body.password) : '';
  const explicitName = (body && body.name) != null ? String(body.name).trim() : '';
  let name = explicitName;
  if (!name) {
    try {
      const host = new URL(url).host || '';
      name = host.replace(/^www\./i, '');
    } catch (_) { name = url; }
  }
  const osInfo = await si.osInfo();
  const hostname = (osInfo.hostname || 'unknown').toString().trim() || 'unknown';
  const winComputerName = isWin ? String(process.env.COMPUTERNAME || '').trim() : '';
  const syncAliases = getProgramSyncAliases();
  const aliasesAll = [...new Set([hostname, winComputerName, ...syncAliases].filter(Boolean))];

  if (ensureMonitorFirestore()) {
    try {
      const db = getMonitorDb();
      const adminSdk = require('firebase-admin');
      const FieldValue = adminSdk.firestore.FieldValue;
      const { docRef, docId } = await resolveConnextProgramDocRef(db, aliasesAll);
      const snap = await docRef.get();
      const existing = snap.exists ? snap.data() || {} : {};
      const list = Array.isArray(existing.adminWebConnections)
        ? existing.adminWebConnections.map((w) => (w && typeof w === 'object' ? { ...w } : {}))
        : [];
      const prev0 = list[0] && typeof list[0] === 'object' ? list[0] : {};
      const row = { name, url };
      if (database) row.database = database;
      if (username) row.username = username;
      if (password) row.password = password;
      const merged0 = { ...prev0, ...row };
      if (!database && prev0.database) merged0.database = prev0.database;
      if (!username && prev0.username) merged0.username = prev0.username;
      if (!password && prev0.password) merged0.password = prev0.password;
      if (prev0.note != null && String(prev0.note).trim() !== '' && (merged0.note == null || String(merged0.note).trim() === '')) {
        merged0.note = prev0.note;
      }
      list[0] = merged0;
      await docRef.set(
        {
          adminWebConnections: list,
          connextAdminWebPushedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      return { ok: true, via: 'local', docId, row: merged0 };
    } catch (e) {
      return { ok: false, reason: 'error', message: (e && e.message) || String(e) };
    }
  }

  const base = getMonitorApiUrl();
  const secret = getSystemSnapshotUploadSecret();
  if (!base || !secret) {
    return {
      ok: false,
      reason: 'no_firestore',
      message: !base
        ? 'ไม่พบ firebase-service-account.json และยังไม่ตั้ง monitorApiUrl ใน monitor-config.json'
        : 'ไม่พบ firebase-service-account.json และยังไม่ตั้ง systemSnapshotUploadSecret'
    };
  }
  try {
    const endpoint = `${base.replace(/\/$/, '')}/api/programs-push-admin-web`;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 15000) : null;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Monitor-System-Secret': secret
      },
      body: JSON.stringify({
        hostname,
        computerName: winComputerName,
        aliases: aliasesAll,
        url,
        database,
        username,
        password,
        name
      }),
      signal: controller ? controller.signal : undefined
    });
    if (timer) clearTimeout(timer);
    let parsed = null;
    try { parsed = await res.json(); } catch (_) {}
    if (!res.ok) {
      const reason = parsed && parsed.reason ? String(parsed.reason) : ('http_' + res.status);
      const message = parsed && parsed.message ? String(parsed.message) : ('HTTP ' + res.status);
      return { ok: false, reason, message, via: 'remote' };
    }
    return { ok: true, via: 'remote', ...(parsed || {}) };
  } catch (e) {
    return { ok: false, reason: 'remote_error', message: (e && e.message) || String(e) };
  }
}

let _connextProgramSyncTimer = null;
let _connextProgramSyncStarted = false;

/**
 * ซิงก์สเปกเครื่องจาก NKBKConnext ไป collection programs (แอดมิน #programs)
 * ต้องมี firebase-service-account (Admin SDK) — ค้นหาเอกสารเดิมจาก device.computer_name / name ก่อน แล้วค่อยใช้ ws_<hostname>
 */
function startConnextProgramFirestoreSync() {
  if (_connextProgramSyncStarted) return;
  _connextProgramSyncStarted = true;
  const intervalMs = Math.max(60000, parseInt(process.env.MONITOR_PROGRAM_SYNC_INTERVAL_MS || '300000', 10) || 300000);
  const run = () => {
    syncConnextWorkstationToFirestoreProgram().catch(() => {});
  };
  setTimeout(run, 15000);
  _connextProgramSyncTimer = setInterval(run, intervalMs);
}

async function syncConnextWorkstationToFirestoreProgram() {
  if (process.env.MONITOR_DISABLE_PROGRAM_SYNC === '1' || String(process.env.MONITOR_DISABLE_PROGRAM_SYNC).toLowerCase() === 'true') {
    return;
  }
  if (!ensureMonitorFirestore()) return;
  let pkgVer = '0.0.0';
  try {
    pkgVer = require('./package.json').version;
  } catch (_) {}
  try {
    const db = getMonitorDb();
    const adminSdk = require('firebase-admin');
    const FieldValue = adminSdk.firestore.FieldValue;

    const osInfo = await si.osInfo();
    const hostname = (osInfo.hostname || 'unknown').toString().trim() || 'unknown';
    const winComputerName = isWin ? String(process.env.COMPUTERNAME || '').trim() : '';
    const syncAliases = getProgramSyncAliases();
    const nameCandidates = [...new Set([hostname, winComputerName, ...syncAliases].filter(Boolean))];
    const { docRef, docId, source: docResolveSource, matchedBy, preserveDisplayNames } = await resolveConnextProgramDocRef(db, nameCandidates);
    if (docResolveSource === 'matched_existing') {
      console.log('[NKBKConnext] ซิงก์เข้าเอกสาร programs เดิม (จับคู่ชื่อ "' + (matchedBy || '') + '" → doc ' + docId + ')');
    } else if (syncAliases.length && docResolveSource === 'ws_slug') {
      console.warn(
        '[NKBKConnext] ไม่พบเอกสาร programs ที่ตรงชื่อ — ใช้',
        docId,
        '— ถ้ามีการ์ดแอดมินชื่ออื่น (เช่น NKBK-...) ให้ใส่ใน monitor-config.json → programSyncAliases'
      );
    }

    const [cpu, mem, graphics, networkInterfaces, system, winData, currentLoad] = await Promise.all([
      si.cpu(),
      si.mem(),
      si.graphics().catch(() => ({ controllers: [] })),
      si.networkInterfaces().catch(() => []),
      si.system().catch(() => ({})),
      isWin ? fetchWindowsData() : Promise.resolve({ office: [], printersData: { printers: [] }, line: {} }),
      si.currentLoad().catch(() => ({}))
    ]);

    const office = winData.office || [];
    const netArr = (networkInterfaces || []).filter((n) => !n.internal && n.ip4);
    const primaryNet = netArr[0] || {};
    const gpu = graphics.controllers && graphics.controllers[0];
    const liveOsLabel = [osInfo.distro, osInfo.release].filter(Boolean).join(' ').trim()
      || `${osInfo.platform || ''} ${osInfo.release || ''}`.trim();
    const officeLines = office.slice(0, 16).map((o) => {
      const n = o.name || 'Microsoft Office';
      const v = o.version && o.version !== '—' ? o.version : '';
      return v ? `${n} ${v}` : n;
    });
    const brandModel = [system.manufacturer, system.model].filter(Boolean).join(' ').trim();

    const liveTelemetry = {
      memoryUsedGB: mem.total ? (mem.used / 1e9).toFixed(2) : null,
      memoryTotalGB: mem.total ? (mem.total / 1e9).toFixed(2) : null,
      memoryUsagePercent: mem.total ? ((mem.used / mem.total) * 100).toFixed(1) : null,
      loadPercent: currentLoad && currentLoad.currentLoad != null ? Number(currentLoad.currentLoad).toFixed(1) : null,
      officeCount: office.length,
      printersCount: winData.printersData && Array.isArray(winData.printersData.printers) ? winData.printersData.printers.length : 0,
      lineInstalled: !!(winData.line && winData.line.installed),
      timestamp: Date.now()
    };

    let liveDetail = {};
    try {
      liveDetail = buildLiveDetailPayload(await buildSystemSnapshotJson());
    } catch (e) {
      console.warn('[NKBKConnext] liveDetail:', e.message);
    }

    const snap = await docRef.get();
    const exists = snap.exists;

    const telemetryPatch = {
      nkbkConnextSync: true,
      connextHostname: hostname,
      connextAppVersion: pkgVer,
      liveOsLabel,
      liveSoftwareLines: officeLines,
      liveTelemetry,
      liveDetail,
      lastLiveSyncAt: FieldValue.serverTimestamp(),
      type: 'computer'
    };

    if (!exists) {
      await docRef.set({
        ...telemetryPatch,
        workStatus: 'ใช้งาน',
        icon: 'fas fa-desktop',
        name: hostname,
        user: '',
        details: 'ข้อมูลซิงก์อัตโนมัติจาก NKBKConnext System — แก้ไขเพิ่มได้ที่แอดมิน',
        startDate: '',
        device: {
          computer_name: hostname,
          brand_model: brandModel
        },
        net: {
          ip: primaryNet.ip4 || '',
          mac: primaryNet.mac || ''
        },
        hw: {
          cpu: `${cpu.brand || ''} (${cpu.cores || 0} cores)`.trim(),
          ram: mem.total ? `${(mem.total / 1e9).toFixed(2)} GB (รวม)` : '',
          gpu: gpu && gpu.model ? gpu.model : '',
          storage: '',
          monitor: '',
          peripherals: '',
          warranty_item: ''
        },
        userInfo: {},
        sw: {},
        svc: {},
        sec: {},
        linkedSystems: [],
        otherSystems: []
      });
      console.log('[NKBKConnext] สร้างรายการ programs/' + docId + ' (ซิงก์จากเครื่องนี้)');
      return;
    }

    const updatePayload = {
      ...telemetryPatch,
      'device.brand_model': brandModel || FieldValue.delete(),
      'net.ip': primaryNet.ip4 || FieldValue.delete(),
      'net.mac': primaryNet.mac || FieldValue.delete(),
      'hw.cpu': `${cpu.brand || ''} (${cpu.cores || 0} cores)`.trim(),
      'hw.ram': mem.total ? `${(mem.total / 1e9).toFixed(2)} GB (รวม)` : FieldValue.delete(),
      'hw.gpu': gpu && gpu.model ? gpu.model : FieldValue.delete()
    };
    if (!preserveDisplayNames) {
      updatePayload['device.computer_name'] = hostname;
    }
    const cleaned = {};
    for (const [k, v] of Object.entries(updatePayload)) {
      if (v === undefined) continue;
      cleaned[k] = v;
    }
    await docRef.update(cleaned);
  } catch (e) {
    console.warn('[NKBKConnext] ซิงก์ Firestore programs ไม่สำเร็จ:', e.message);
  }
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

/** หา user จาก lineUserId (ผูกบัญชี LINE ใน V2 แล้ว) */
async function findV2UserByLineUserId(db, lineUserIdRaw) {
  const raw = String(lineUserIdRaw || '').trim();
  if (!raw) return null;
  try {
    const snap = await db.collection(V2_USERS_COLLECTION).where('lineUserId', '==', raw).limit(1).get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { _docId: doc.id, ...doc.data() };
  } catch (_) {
    return null;
  }
}

function monitorProfileFromV2User(u) {
  if (!u) return null;
  return {
    fullname: u.fullname != null ? String(u.fullname).trim() : '',
    email: u.email != null ? String(u.email).trim() : '',
    group: u.group != null ? String(u.group).trim() : '',
    role: u.role != null ? String(u.role).trim() : ''
  };
}

/** Bangkok วันนี้แบบ UTC+420 — สอดคล้องกับ line-webhook (getBangkokNow) */
function getBangkokNowMonitor() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 420 * 60000);
}

/** แสดงใน UI: YYYY-MM-DD */
function getBangkokDateIso() {
  const b = getBangkokNowMonitor();
  const y = b.getFullYear();
  const m = b.getMonth() + 1;
  const d = b.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * คีย์เอกสาร attendance_log ใน Firestore = DDMMYYYY (เช่น 23032026)
 * ไม่ใช่ YYYY-MM-DD — ระบบหลักบันทึกแบบนี้จาก ATT2Mobile / line-webhook
 */
function getBangkokAttendanceLogDocId() {
  const b = getBangkokNowMonitor();
  return String(b.getDate()).padStart(2, '0') + String(b.getMonth() + 1).padStart(2, '0') + String(b.getFullYear());
}

function getBangkokDateId() {
  return getBangkokDateIso();
}

function calcTenureTextMonitor(startDateStr) {
  if (!startDateStr) return '';
  const start = new Date(startDateStr);
  if (Number.isNaN(start.getTime())) return '';
  const now = new Date();
  let years = now.getFullYear() - start.getFullYear();
  let months = now.getMonth() - start.getMonth();
  let days = now.getDate() - start.getDate();
  if (days < 0) {
    months -= 1;
    const prevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    days += prevMonth.getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  let txt = '';
  if (years > 0) txt += `${years} ปี `;
  if (months > 0) txt += `${months} เดือน `;
  if (days >= 0) txt += `${days} วัน`;
  return txt.trim();
}

function normNameMonitor(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

/** ตัดคำนำหน้าชื่อไทย — เหมือน line-webhook normNameForMatch / ai-chat */
function normStaffNameForMatchMonitor(str) {
  if (!str || typeof str !== 'string') return '';
  let s = str.trim().replace(/\s+/g, ' ');
  const prefixes = [/^นาง\s+/i, /^นาย\s+/i, /^น\.ส\.\s*/i, /^นส\.\s*/i, /^ด\.ช\.\s*/i, /^ด\.ญ\.\s*/i, /^ว่าที่\s*ร\.ต\.\s*(หญิง\s*)?/i, /^ร\.ต\.\s*/i, /^พล\.ต\.\s*/i];
  for (const p of prefixes) s = s.replace(p, '');
  return s.trim();
}

function codesMatchMonitor(a, b) {
  const sa = String(a || '').trim();
  const sb = String(b || '').trim();
  if (!sa || !sb) return false;
  const na = sa.replace(/^0+/, '') || '0';
  const nb = sb.replace(/^0+/, '') || '0';
  return na === nb;
}

function timeStrToMinutesMonitor(s) {
  if (!s || typeof s !== 'string') return NaN;
  const t = s.trim().replace('.', ':');
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;
  const h = parseInt(m[1], 10);
  const mn = parseInt(m[2], 10);
  if (h < 0 || h > 23 || mn < 0 || mn > 59) return NaN;
  return h * 60 + mn;
}

/** มาสาย — ตรงกับแท็บเจ้าหน้าที่ในแอดมิน (grace สีม่วง / เกิน grace สีแดง) */
function computeLateInfoMonitor(checkInStr, workStartStr, graceMinRaw) {
  const graceMin = Math.max(0, Math.min(60, Number(graceMinRaw) || 15));
  const startStr = String(workStartStr || '08:30')
    .trim()
    .replace('.', ':');
  if (!checkInStr || !String(checkInStr).trim()) {
    return { show: false, text: '', level: null };
  }
  const startMin = timeStrToMinutesMonitor(startStr);
  const inMin = timeStrToMinutesMonitor(String(checkInStr).trim());
  if (Number.isNaN(startMin) || Number.isNaN(inMin)) {
    return { show: false, text: '', level: null };
  }
  const lateMin = inMin - startMin;
  if (lateMin <= 0) return { show: false, text: '', level: null };
  const text = `มาสาย ${lateMin} นาที`;
  if (lateMin <= graceMin) return { show: true, text, level: 'within' };
  return { show: true, text, level: 'over' };
}

async function getOrgAttendanceSettingsMonitor(db) {
  const defaults = { workStart: '08:30', graceMinutes: 15 };
  try {
    const snap = await db.collection('config').doc('org').get();
    if (!snap.exists) return defaults;
    const c = snap.data() || {};
    const ws = c.attendanceWorkStart && String(c.attendanceWorkStart).trim()
      ? String(c.attendanceWorkStart).trim().replace('.', ':')
      : defaults.workStart;
    const g = c.attendanceGraceMinutes;
    const grace =
      g !== undefined && g !== null && g !== '' && !Number.isNaN(Number(g))
        ? Math.max(0, Math.min(60, Number(g)))
        : defaults.graceMinutes;
    return { workStart: ws, graceMinutes: grace };
  } catch (_) {
    return defaults;
  }
}

let _thaiPublicHolidaysCache = null;
function getThaiPublicHolidaysList() {
  if (_thaiPublicHolidaysCache !== null) return _thaiPublicHolidaysCache;
  try {
    const p = path.join(__dirname, 'thai-public-holidays.json');
    const raw = fsSync.readFileSync(p, 'utf8');
    const j = JSON.parse(raw);
    _thaiPublicHolidaysCache = Array.isArray(j) ? j : [];
  } catch (_) {
    _thaiPublicHolidaysCache = [];
  }
  return _thaiPublicHolidaysCache;
}
/** เติมวันหยุดราชการ/สหกรณ์จากไฟล์ (สอดคล้องแอดมิน thaiHolidays) — ไม่ทับวันที่ตั้งใน Firestore */
function mergeThaiPublicHolidaysIntoHolidayMap(map, ym, hiddenDates) {
  const hidden = hiddenDates || new Set();
  for (const h of getThaiPublicHolidaysList()) {
    const dt = (h && h.date ? h.date : '').toString().trim();
    if (!dt || dt.slice(0, 7) !== ym) continue;
    if (hidden.has(dt)) continue;
    if (map.has(dt)) continue;
    map.set(dt, (h.name || 'วันหยุดสหกรณ์').toString().trim());
  }
}

async function loadCoopHolidayLabelsForMonthMonitor(db, year, month) {
  const map = new Map();
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const hiddenDates = new Set();
  try {
    const snap = await db.collection('holidays').get();
    snap.forEach((doc) => {
      const data = doc.data();
      const dt = (data.date || '').toString().trim();
      if (!dt) return;
      if (data.hidden === true) {
        hiddenDates.add(dt);
        return;
      }
      if (dt.slice(0, 7) !== ym) return;
      const label = (data.nameTH || data.name || 'วันหยุดสหกรณ์').toString().trim();
      map.set(dt, label);
    });
  } catch (_) {}
  mergeThaiPublicHolidaysIntoHolidayMap(map, ym, hiddenDates);
  return map;
}

function classifyMonitorDayKind(dateIso, holidayMap) {
  const parts = dateIso.split('-').map((n) => parseInt(n, 10));
  if (parts.length !== 3 || parts.some((x) => Number.isNaN(x))) return { dayKind: 'work', dayLabel: '' };
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  const dow = d.getDay();
  if (holidayMap.has(dateIso)) {
    return { dayKind: 'holiday', dayLabel: holidayMap.get(dateIso) };
  }
  if (dow === 0 || dow === 6) {
    return { dayKind: 'weekend', dayLabel: 'หยุด เสาร์-อาทิตย์' };
  }
  return { dayKind: 'work', dayLabel: '' };
}

function findAttendanceRowForMonitor(rows, user) {
  if (!rows || !Array.isArray(rows) || !user) return null;
  const code = String(
    user.workCode != null ? user.workCode
      : user.employeeCode != null ? user.employeeCode
      : user.username != null ? user.username
      : user.code != null ? user.code
      : user.id != null ? user.id
      : ''
  ).trim();
  const name = String(user.fullname || user.nameTH || user.displayName || user.name || '').trim();
  const normName = normStaffNameForMatchMonitor(name);
  for (const r of rows) {
    if (!r) continue;
    const rc = (r.code != null ? r.code : '').toString().trim();
    if (code && rc && codesMatchMonitor(rc, code)) return r;
    const rn = (r.name || '').toString().trim();
    const normRn = normStaffNameForMatchMonitor(rn);
    if (normName && normRn && normName === normRn) return r;
    if (normName && normRn && normName.length >= 3 && (normRn.indexOf(normName) >= 0 || normName.indexOf(normRn) >= 0)) return r;
  }
  return null;
}

function buildWorkFromV2User(u) {
  if (!u) {
    return {
      position: '',
      department: '',
      job: '',
      unit: '',
      serviceCounter: '',
      employmentStart: '',
      tenureText: ''
    };
  }
  const employmentStart = u.employmentStart != null ? String(u.employmentStart).trim() : '';
  return {
    position: String(u.position || u.jobPosition || '').trim(),
    department: String(u.department || u.dept || '').trim(),
    job: String(u.job || u.workType || '').trim(),
    unit: String(u.unit || '').trim(),
    serviceCounter: u.serviceCounter != null && u.serviceCounter !== '' ? String(u.serviceCounter) : '',
    employmentStart,
    tenureText: calcTenureTextMonitor(employmentStart)
  };
}

async function buildTodayAttendanceFromDb(db, user) {
  const dateIso = getBangkokDateIso();
  const docIdPrimary = getBangkokAttendanceLogDocId();
  const org = await getOrgAttendanceSettingsMonitor(db);
  try {
    let snap = await db.collection('attendance_log').doc(docIdPrimary).get();
    if (!snap.exists) {
      snap = await db.collection('attendance_log').doc(dateIso).get();
    }
    const day = snap.exists ? snap.data() : null;
    const rows = Array.isArray(day && day.rows) ? day.rows : [];
    const match = findAttendanceRowForMonitor(rows, user);
    if (!match) {
      return {
        date: dateIso,
        checkIn: '—',
        checkOut: '—',
        statusText: 'ยังไม่มีข้อมูลสแกนวันนี้',
        lateText: '',
        lateLevel: null
      };
    }
    const checkIn = (match.checkIn != null ? match.checkIn : match.check_in != null ? match.check_in : '')
      .toString()
      .trim();
    const checkOut = (match.checkOut != null ? match.checkOut : match.check_out != null ? match.check_out : '')
      .toString()
      .trim();
    const late = computeLateInfoMonitor(checkIn, org.workStart, org.graceMinutes);
    return {
      date: dateIso,
      checkIn: checkIn || '—',
      checkOut: checkOut || '—',
      statusText: '',
      lateText: late.show ? late.text : '',
      lateLevel: late.show ? late.level : null
    };
  } catch (e) {
    return {
      date: dateIso,
      checkIn: '—',
      checkOut: '—',
      statusText: 'โหลดข้อมูลไม่สำเร็จ',
      lateText: '',
      lateLevel: null
    };
  }
}

async function buildAttendanceMonthFromDb(db, user, year, month) {
  const org = await getOrgAttendanceSettingsMonitor(db);
  const holidayMap = await loadCoopHolidayLabelsForMonthMonitor(db, year, month);
  const lastDay = new Date(year, month, 0).getDate();
  const days = [];
  for (let d = 1; d <= lastDay; d++) {
    const dateIso = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const docId = String(d).padStart(2, '0') + String(month).padStart(2, '0') + String(year);
    const cls = classifyMonitorDayKind(dateIso, holidayMap);
    try {
      let snap = await db.collection('attendance_log').doc(docId).get();
      if (!snap.exists) snap = await db.collection('attendance_log').doc(dateIso).get();
      const rowData = snap.exists ? snap.data() : null;
      const rowList = Array.isArray(rowData && rowData.rows) ? rowData.rows : [];
      const match = findAttendanceRowForMonitor(rowList, user);
      if (!match) {
        days.push({
          date: dateIso,
          checkIn: '',
          checkOut: '',
          lateText: '',
          lateLevel: null,
          hasRecord: false,
          dayKind: cls.dayKind,
          dayLabel: cls.dayLabel
        });
        continue;
      }
      const checkIn = (match.checkIn != null ? match.checkIn : match.check_in != null ? match.check_in : '')
        .toString()
        .trim();
      const checkOut = (match.checkOut != null ? match.checkOut : match.check_out != null ? match.check_out : '')
        .toString()
        .trim();
      const late = computeLateInfoMonitor(checkIn, org.workStart, org.graceMinutes);
      days.push({
        date: dateIso,
        checkIn: checkIn || '',
        checkOut: checkOut || '',
        lateText: late.show ? late.text : '',
        lateLevel: late.show ? late.level : null,
        hasRecord: !!(checkIn || checkOut),
        dayKind: cls.dayKind,
        dayLabel: cls.dayLabel
      });
    } catch (_) {
      days.push({
        date: dateIso,
        checkIn: '',
        checkOut: '',
        lateText: '',
        lateLevel: null,
        hasRecord: false,
        dayKind: cls.dayKind,
        dayLabel: cls.dayLabel
      });
    }
  }
  return { year, month, days };
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
  if (r === 'ผู้ดูแลระบบ' || r === 'แอดมิน' || r.indexOf('ผู้ดูแล') >= 0) return true;
  if (!g) return true;
  return false;
}

/** ดึง monitorApiUrl จาก JSON — ถ้าวางผิดเป็นไฟล์ service account ในชื่อ monitor-config.json ให้ข้าม */
function monitorApiUrlFromConfigRaw(raw) {
  try {
    const j = JSON.parse(raw);
    const isServiceAccountJson =
      j &&
      j.type === 'service_account' &&
      typeof j.private_key === 'string' &&
      j.private_key.indexOf('BEGIN PRIVATE KEY') >= 0;
    const u = (j.monitorApiUrl || '').trim();
    if (u) return u.replace(/\/$/, '');
    if (isServiceAccountJson) {
      console.warn(
        '[monitor-config] พบไฟล์ service account ในชื่อ monitor-config.json — ต้องใช้แค่ {"monitorApiUrl":"..."} วาง firebase-service-account.json แยกต่างหาก'
      );
    }
  } catch (_) {}
  return '';
}

function monitorApiUrlFallbackFromConfigRaw(raw) {
  try {
    const j = JSON.parse(raw);
    if (j && j.type === 'service_account') return '';
    const u = (j.monitorApiUrlFallback || '').trim();
    return u ? u.replace(/\/$/, '') : '';
  } catch (_) {}
  return '';
}

/** อ่าน Monitor API URL จาก env หรือไฟล์ monitor-config.json ข้าง exe/userData */
function getMonitorApiUrl() {
  const fromEnv = (process.env.MONITOR_API_URL || '').trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  for (const dir of getMonitorConfigSearchDirs()) {
    try {
      const p = path.join(dir, 'monitor-config.json');
      if (fsSync.existsSync(p) && fsSync.statSync(p).isFile()) {
        const raw = fsSync.readFileSync(p, 'utf8');
        const u = monitorApiUrlFromConfigRaw(raw);
        if (u) return u;
      }
    } catch (_) {}
  }
  return '';
}

/** POST JSON ไปที่ url (รองรับ HTTPS ที่ Windows ไม่เชื่อถือใบรับรอง — ใช้ rejectUnauthorized: false เฉพาะ monitor API) */
function postJsonToMonitorApi(url, body, timeoutMs, rejectUnauthorized = false, extraHeaders = {}) {
  const u = new URL(url);
  const isHttps = u.protocol === 'https:';
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body || {});
  const opts = {
    hostname: u.hostname,
    port: u.port || (isHttps ? 443 : 80),
    path: u.pathname + u.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr, 'utf8'),
      Accept: 'application/json',
      'User-Agent': 'NKBKConnext-Monitor/1.0',
      ...extraHeaders
    }
  };
  if (isHttps && rejectUnauthorized === false) {
    opts.rejectUnauthorized = false;
  }
  const mod = isHttps ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(opts, (res) => {
      let raw = '';
      res.on('data', (ch) => { raw += ch; });
      res.on('end', () => resolve({ status: res.statusCode, raw }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('ETIMEDOUT')); });
    req.end(bodyStr);
  });
}

/** GET JSON จาก monitor API (HTTPS บน Windows อาจต้อง rejectUnauthorized: false) */
function getJsonFromMonitorApi(url, timeoutMs, rejectUnauthorized = false) {
  const u = new URL(url);
  const isHttps = u.protocol === 'https:';
  const opts = {
    hostname: u.hostname,
    port: u.port || (isHttps ? 443 : 80),
    path: u.pathname + u.search,
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'NKBKConnext-Monitor/1.0'
    }
  };
  if (isHttps && rejectUnauthorized === false) {
    opts.rejectUnauthorized = false;
  }
  const mod = isHttps ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(opts, (res) => {
      let raw = '';
      res.on('data', (ch) => {
        raw += ch;
      });
      res.on('end', () => resolve({ status: res.statusCode, raw }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error('ETIMEDOUT'));
    });
    req.end();
  });
}

async function readProgramsNasViaMonitorApiProxy() {
  const bases = [];
  const main = getMonitorApiUrl();
  const fb = getMonitorApiUrlFallback();
  if (main) bases.push(main);
  if (fb && fb !== main) bases.push(fb);
  const readKey = getMonitorSystemPublicReadKey();
  if (!bases.length || !readKey) {
    return { ok: false, reason: 'no_monitor_api_or_key' };
  }
  let osInfo;
  try {
    osInfo = await si.osInfo();
  } catch (_) {
    osInfo = { hostname: 'unknown' };
  }
  const hostname = (osInfo.hostname || 'unknown').toString().trim() || 'unknown';
  const winComputerName = isWin ? String(process.env.COMPUTERNAME || '').trim() : '';
  const qs = new URLSearchParams({ key: readKey, hostname });
  if (winComputerName) qs.set('computerName', winComputerName);
  const aliases = getProgramSyncAliases();
  if (aliases.length) qs.set('aliases', aliases.join(','));
  const apiPath = `/api/monitor-program-nas?${qs.toString()}`;
  const FETCH_TIMEOUT_MS = 12000;
  let lastErr = null;
  for (const base of bases) {
    const url = `${base.replace(/\/$/, '')}${apiPath}`;
    try {
      const skipSslRelax = url.startsWith('https');
      const r = await getJsonFromMonitorApi(url, FETCH_TIMEOUT_MS, skipSslRelax ? false : true);
      let data;
      try {
        data = r.raw ? JSON.parse(r.raw) : {};
      } catch (e) {
        lastErr = e;
        continue;
      }
      if (data && typeof data === 'object') {
        return data;
      }
    } catch (err) {
      lastErr = err;
    }
  }
  return {
    ok: false,
    reason: 'monitor_api_fetch_failed',
    message: (lastErr && lastErr.message) || ''
  };
}

async function readProgramsNasFromWebForWorkstation() {
  const local = await readProgramsNasFromLocalFirestore();
  if (local.ok) return local;
  if (local.reason === 'no_firestore') {
    const via = await readProgramsNasViaMonitorApiProxy();
    return via && typeof via === 'object' ? via : local;
  }
  return local;
}

function systemSnapshotSecretFromConfigRaw(raw) {
  try {
    const j = JSON.parse(raw);
    if (j && j.type === 'service_account') return '';
    return String(j.systemSnapshotUploadSecret || '').trim();
  } catch (_) {}
  return '';
}

function monitorSystemPublicReadKeyFromConfigRaw(raw) {
  try {
    const j = JSON.parse(raw);
    if (j && j.type === 'service_account') return '';
    return String(j.monitorSystemPublicReadKey || j.workstationsPublicReadKey || '').trim();
  } catch (_) {}
  return '';
}

/** รหัสเปิดดู workstations.html บนเว็บ — env หรือ monitor-config.json (ฝังใน build) */
function getMonitorSystemPublicReadKey() {
  const e = (process.env.MONITOR_SYSTEM_PUBLIC_READ_KEY || '').trim();
  if (e) return e;
  const p = findMonitorConfigJsonPath();
  if (!p) return '';
  try {
    return monitorSystemPublicReadKeyFromConfigRaw(fsSync.readFileSync(p, 'utf8'));
  } catch (_) {}
  return '';
}

/** รหัสลับสำหรับ POST สเปกขึ้น monitor-api — env MONITOR_SYSTEM_UPLOAD_SECRET หรือ monitor-config.json */
function getSystemSnapshotUploadSecret() {
  const e = (process.env.MONITOR_SYSTEM_UPLOAD_SECRET || '').trim();
  if (e) return e;
  const p = findMonitorConfigJsonPath();
  if (!p) return '';
  try {
    return systemSnapshotSecretFromConfigRaw(fsSync.readFileSync(p, 'utf8'));
  } catch (_) {}
  return '';
}

/** โทเคนล็อกอิน Monitor ที่ renderer เขียนลง userData — ส่งไป monitor-api เพื่อซิงก์ชื่อผู้ใช้ไป Firestore programs */
function readMonitorPushTokenForSnapshotPush() {
  try {
    if (process.versions && process.versions.electron) {
      const electronApp = require('electron').app;
      if (electronApp && electronApp.getPath) {
        const p = path.join(electronApp.getPath('userData'), '.monitor-push-token');
        if (fsSync.existsSync(p)) {
          const t = fsSync.readFileSync(p, 'utf8').trim();
          if (t.length >= 16) return t;
        }
      }
    }
  } catch (_) {}
  return '';
}

let _systemSnapshotWebPushStarted = false;

/** สถานะ push ล่าสุด — สำหรับ GET /api/system-snapshot-push-status */
let _lastWebPushAt = null;
let _lastWebPushOk = null;
let _lastWebPushDetail = '';

/** ส่ง payload เดียวกับ /api/system ไปที่ monitorApiUrl (เช่น https://โดเมน/monitor-api) เพื่อแสดงบนเว็บ + ซิงก์ #programs */
async function pushSystemSnapshotToMonitorWeb() {
  if (process.env.MONITOR_DISABLE_SYSTEM_WEB_PUSH === '1') {
    _lastWebPushDetail = 'disabled';
    return;
  }
  const secret = getSystemSnapshotUploadSecret();
  const base = getMonitorApiUrl();
  if (!secret || !base) {
    _lastWebPushAt = Date.now();
    _lastWebPushOk = false;
    _lastWebPushDetail = !base ? 'ยังไม่ตั้ง monitorApiUrl ใน monitor-config.json' : 'ยังไม่ตั้ง systemSnapshotUploadSecret';
    return;
  }
  try {
    const snapshot = await buildSystemSnapshotJson();
    const url = `${base.replace(/\/$/, '')}/api/monitor-system-snapshot`;
    const headers = { 'X-Monitor-System-Secret': secret };
    const pushTok = readMonitorPushTokenForSnapshotPush();
    if (pushTok) headers['X-Monitor-Token'] = pushTok;
    const r = await postJsonToMonitorApi(url, { snapshot }, 45000, false, headers);
    _lastWebPushAt = Date.now();
    _lastWebPushOk = r.status >= 200 && r.status < 300;
    _lastWebPushDetail = _lastWebPushOk ? 'ok ' + r.status : 'HTTP ' + r.status + ' ' + String(r.raw || '').slice(0, 160);
    if (!_lastWebPushOk) {
      console.warn('[NKBKConnext] อัปโหลดสเปกขึ้นเว็บ', _lastWebPushDetail);
    }
  } catch (e) {
    _lastWebPushAt = Date.now();
    _lastWebPushOk = false;
    _lastWebPushDetail = (e && e.message) ? String(e.message) : 'error';
    console.warn('[NKBKConnext] อัปโหลดสเปกขึ้นเว็บ:', _lastWebPushDetail);
  }
}

function startSystemSnapshotWebPush() {
  if (_systemSnapshotWebPushStarted) return;
  _systemSnapshotWebPushStarted = true;
  const intervalMs = Math.max(120000, parseInt(process.env.MONITOR_SYSTEM_WEB_PUSH_INTERVAL_MS || '300000', 10) || 300000);
  const firstDelayMs = Math.max(2000, parseInt(process.env.MONITOR_SYSTEM_WEB_PUSH_FIRST_MS || '6000', 10) || 6000);
  setTimeout(() => {
    pushSystemSnapshotToMonitorWeb().catch(() => {});
  }, firstDelayMs);
  /* หลังบูตเครื่อง รอบแรก (~6s) มักชนเน็ตหรือ WMI ยังช้า — ยิงซ้ำอีกครั้ง */
  const bootRetryMs = Math.max(0, parseInt(process.env.MONITOR_SYSTEM_WEB_PUSH_BOOT_RETRY_MS || '45000', 10) || 45000);
  if (bootRetryMs > 0) {
    setTimeout(() => {
      pushSystemSnapshotToMonitorWeb().catch(() => {});
    }, bootRetryMs);
  }
  setInterval(() => {
    pushSystemSnapshotToMonitorWeb().catch(() => {});
  }, intervalMs);
}

/** URL สำรองเมื่อโดเมนหลัก 502/504/timeout — ใส่ใน monitor-config.json เป็น monitorApiUrlFallback (เช่น IP NAS ใน LAN) */
function getMonitorApiUrlFallback() {
  for (const dir of getMonitorConfigSearchDirs()) {
    try {
      const p = path.join(dir, 'monitor-config.json');
      if (fsSync.existsSync(p) && fsSync.statSync(p).isFile()) {
        const raw = fsSync.readFileSync(p, 'utf8');
        const u = monitorApiUrlFallbackFromConfigRaw(raw);
        if (u) return u;
      }
    } catch (_) {}
  }
  return '';
}

let PKG_VERSION = '0.0.0';
try {
  PKG_VERSION = require(path.join(__dirname, 'package.json')).version;
} catch (_) {}

/** คืนค่า config — ส่ง monitorApiUrl เมื่อตั้งค่าแล้ว เพื่อให้หน้า login เรียก API ตรงจาก Chromium (หลบ Cloudflare บล็อก Node) — monitor-api เปิด CORS แล้ว */
app.get('/api/config', async (req, res) => {
  const base = getMonitorApiUrl();
  const readKey = getMonitorSystemPublicReadKey();
  let monitorWorkstationsUrl = '';
  if (base && readKey) {
    monitorWorkstationsUrl = `${base.replace(/\/$/, '')}/workstations.html?key=${encodeURIComponent(readKey)}`;
  }
  const lc = getLineLoginChannelCredentials();
  let lineLoginEnabled = !!(lc.channelId && lc.channelSecret);
  if (!lineLoginEnabled && base) {
    const fallbackBase = getMonitorApiUrlFallback();
    const bases = [base];
    if (fallbackBase && fallbackBase !== base) bases.push(fallbackBase);
    for (const b of bases) {
      try {
        const r = await getJsonFromMonitorApi(`${b}/api/monitor-public-config`, 6000, false);
        if (r.status >= 200 && r.status < 300) {
          const j = JSON.parse(r.raw || '{}');
          if (j && j.lineLoginEnabled) {
            lineLoginEnabled = true;
            break;
          }
        }
      } catch (_) {}
    }
  }
  const monitorFirestoreReady = ensureMonitorFirestore() || !!base;
  res.json({
    appVersion: PKG_VERSION,
    remoteLogin: !!base,
    lineLoginEnabled,
    monitorFirestoreReady,
    ...(base ? { monitorApiUrl: base } : {}),
    ...(monitorWorkstationsUrl ? { monitorWorkstationsUrl } : {})
  });
});

function isLocalhostSnapshotRequest(req) {
  const ra = String((req.socket && req.socket.remoteAddress) || req.ip || '');
  return ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1';
}

/** ช่วยไล่ปัญหา monitorApiUrl บนเครื่องลูก — เปิดในเบราว์เซอร์: http://127.0.0.1:พอร์ต/api/diag-monitor-config */
app.get('/api/diag-monitor-config', (req, res) => {
  if (!isLocalhostSnapshotRequest(req)) {
    return res.status(403).json({ ok: false, message: 'เฉพาะ localhost' });
  }
  const dirs = getMonitorConfigSearchDirs();
  const detail = [];
  for (const dir of dirs) {
    const p = path.join(dir, 'monitor-config.json');
    let hasFile = false;
    let hasUrl = false;
    try {
      hasFile = fsSync.existsSync(p) && fsSync.statSync(p).isFile();
      if (hasFile) {
        const raw = fsSync.readFileSync(p, 'utf8');
        hasUrl = !!monitorApiUrlFromConfigRaw(raw);
      }
    } catch (_) {}
    detail.push({ configPath: p, hasFile, hasUrl });
  }
  res.json({
    ok: true,
    monitorApiUrlResolved: getMonitorApiUrl() || null,
    envMonitorApiUrl: String(process.env.MONITOR_API_URL || '').trim() || null,
    lineLoginLocalCreds: (() => {
      const lc = getLineLoginChannelCredentials();
      return !!(lc.channelId && lc.channelSecret);
    })(),
    searchDirs: dirs,
    detail
  });
});

function lineHtmlEsc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** เริ่ม LINE Login (OAuth) — เปิด url ในเบราว์เซอร์ แล้ว poll /api/line-login-poll?state= */
app.get('/api/line-login-start', async (req, res) => {
  if (!isLocalhostSnapshotRequest(req)) {
    return res.status(403).json({ ok: false, message: 'เฉพาะ localhost' });
  }
  const redirectBase = sanitizeLineLoginRedirectBase(req.query.redirect_base || req.query.redirectBase || '');
  if (!redirectBase) {
    return res.status(400).json({
      ok: false,
      message: 'ส่ง query redirect_base เป็น origin ของหน้า login เช่น http://127.0.0.1:3333'
    });
  }
  const remoteBase = getMonitorApiUrl();
  if (remoteBase) {
    const fallbackBase = getMonitorApiUrlFallback();
    const bases = [remoteBase];
    if (fallbackBase && fallbackBase !== remoteBase) bases.push(fallbackBase);
    const lineOAuthRedirectUri = `${String(remoteBase).replace(/\/+$/g, '')}/api/line-login-callback`;
    const qs = new URLSearchParams({
      return_origin: redirectBase,
      line_oauth_redirect_uri: lineOAuthRedirectUri
    }).toString();
    for (const b of bases) {
      try {
        const r = await getJsonFromMonitorApi(`${b}/api/line-login-start?${qs}`, 18000, false);
        let data;
        try {
          data = JSON.parse(r.raw || '{}');
        } catch (_) {
          data = {};
        }
        if (r.status >= 200 && r.status < 300 && data.ok && data.url && data.state) {
          return res.json({ ok: true, url: data.url, state: data.state });
        }
      } catch (err) {
        console.warn('[line-login-start] remote', b, err.message);
      }
    }
    return res.status(503).json({
      ok: false,
      message:
        'เชื่อมต่อ monitor-api สำหรับ LINE ไม่ได้ — ตรวจ monitorApiUrl และให้เซิร์ฟเวอร์ตั้ง LINE + Callback URL ใน .env (ดู monitor-api)'
    });
  }
  const { channelId, channelSecret } = getLineLoginChannelCredentials();
  if (!channelId || !channelSecret) {
    return res.status(503).json({
      ok: false,
      message: 'ยังไม่ตั้ง LINE Login — ใส่ lineLoginChannelId และ lineLoginChannelSecret ใน monitor-config.json'
    });
  }
  const redirectUri = `${redirectBase}/api/line-login-callback`;
  const state = crypto.randomBytes(24).toString('hex');
  LINE_OAUTH_PENDING.set(state, { redirectUri, expires: Date.now() + 10 * 60 * 1000 });
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: channelId,
    redirect_uri: redirectUri,
    state,
    scope: 'openid profile'
  });
  const url = `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;
  res.json({ ok: true, url, state });
});

app.get('/api/line-login-poll', async (req, res) => {
  if (!isLocalhostSnapshotRequest(req)) {
    return res.status(403).json({ ok: false, message: 'เฉพาะ localhost' });
  }
  const state = String(req.query.state || '').trim();
  if (!state || !/^[a-f0-9]{48}$/i.test(state)) {
    return res.status(400).json({ ok: false, message: 'state ไม่ถูกต้อง' });
  }
  const remoteBase = getMonitorApiUrl();
  if (remoteBase) {
    const fallbackBase = getMonitorApiUrlFallback();
    const bases = [remoteBase];
    if (fallbackBase && fallbackBase !== remoteBase) bases.push(fallbackBase);
    const qs = new URLSearchParams({ state }).toString();
    for (const b of bases) {
      try {
        const r = await getJsonFromMonitorApi(`${b}/api/line-login-poll?${qs}`, 15000, false);
        let data;
        try {
          data = JSON.parse(r.raw || '{}');
        } catch (_) {
          data = {};
        }
        if (r.status >= 200 && r.status < 300) {
          return res.status(200).json(data);
        }
      } catch (err) {
        console.warn('[line-login-poll] remote', b, err.message);
      }
    }
    return res.json({ ok: true, pending: true });
  }
  const row = LINE_LOGIN_POLL.get(state);
  if (!row) return res.json({ ok: true, pending: true });
  if (row.expires < Date.now()) {
    LINE_LOGIN_POLL.delete(state);
    return res.json({ ok: false, message: 'หมดเวลา ลองเข้า LINE ใหม่' });
  }
  if (row.error) {
    LINE_LOGIN_POLL.delete(state);
    return res.json({ ok: false, message: row.error });
  }
  if (row.token) {
    LINE_LOGIN_POLL.delete(state);
    return res.json({ ok: true, token: row.token, username: row.username });
  }
  return res.json({ ok: true, pending: true });
});

app.get('/api/line-login-callback', async (req, res) => {
  const qerr = (req.query && req.query.error) || '';
  const qdesc = (req.query && req.query.error_description) || '';
  if (qerr) {
    return res
      .status(200)
      .type('html')
      .send(
        `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>LINE Login</title></head><body style="font-family:sans-serif;padding:1.5rem;text-align:center">` +
          `<p>${lineHtmlEsc(String(qdesc || qerr))}</p><p>ปิดหน้าต่างนี้แล้วลองใหม่ในแอป NKBKConnext</p></body></html>`
      );
  }
  const codeStr = String((req.query && req.query.code) || '').trim();
  const state = String((req.query && req.query.state) || '').trim();
  if (!codeStr || !state) {
    return res.status(400).type('html').send('<body>พารามิเตอร์ไม่ครบ</body>');
  }
  const pending = LINE_OAUTH_PENDING.get(state);
  if (!pending || pending.expires < Date.now()) {
    return res.status(400).type('html').send('<body>ลิงก์หมดอายุ — ลองกดเข้าด้วย LINE จากแอปอีกครั้ง</body>');
  }
  LINE_OAUTH_PENDING.delete(state);
  const { channelId, channelSecret } = getLineLoginChannelCredentials();
  if (!channelId || !channelSecret) {
    return res.status(500).type('html').send('<body>เซิร์ฟเวอร์ยังไม่ตั้งค่า LINE channel</body>');
  }
  try {
    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code: codeStr,
      redirect_uri: pending.redirectUri,
      client_id: channelId,
      client_secret: channelSecret
    });
    const tr = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString()
    });
    const tj = await tr.json().catch(() => ({}));
    if (!tr.ok) {
      const msg = (tj && (tj.error_description || tj.error)) || 'token error';
      return res
        .status(200)
        .type('html')
        .send(`<!DOCTYPE html><meta charset="utf-8"><body style="padding:1.5rem;text-align:center"><p>${lineHtmlEsc(msg)}</p></body></html>`);
    }
    const idToken = (tj && tj.id_token) || '';
    if (!idToken) {
      return res.status(200).type('html').send('<body>LINE ไม่ส่ง id_token</body>');
    }
    const vb = new URLSearchParams({ id_token: idToken, client_id: channelId });
    const vr = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: vb.toString()
    });
    const vj = await vr.json().catch(() => ({}));
    if (!vr.ok || !vj.sub) {
      const msg = (vj && (vj.error_description || vj.error)) || 'verify id_token failed';
      return res.status(200).type('html').send(`<body>${lineHtmlEsc(msg)}</body>`);
    }
    const lineSub = String(vj.sub).trim();
    if (!ensureMonitorFirestore()) {
      LINE_LOGIN_POLL.set(state, { error: 'ไม่มีการเชื่อมต่อ Firestore', expires: Date.now() + 120000 });
      return res
        .status(200)
        .type('html')
        .send(
          '<body style="font-family:sans-serif;padding:1.5rem;text-align:center"><p>ไม่สามารถโหลดบัญชีจากระบบได้</p><p>ปิดหน้าต่างแล้วใช้ PIN ในแอป</p></body>'
        );
    }
    const db = getMonitorDb();
    const v2User = await findV2UserByLineUserId(db, lineSub);
    if (!v2User) {
      LINE_LOGIN_POLL.set(state, {
        error: 'ไม่พบบัญชีที่ผูก LINE นี้ — ผูกบัญชีที่เว็บ link ของสหกรณ์ก่อน',
        expires: Date.now() + 120000
      });
      return res
        .status(200)
        .type('html')
        .send(
          '<body style="font-family:sans-serif;padding:1.5rem;text-align:center"><p>บัญชี LINE นี้ยังไม่ได้ผูกกับผู้ใช้ในระบบ</p><p>กรุณาผูกบัญชีผ่านลิงก์จากสหกรณ์ แล้วลองใหม่</p></body>'
        );
    }
    if (!v2UserMayAccessMonitor(v2User)) {
      LINE_LOGIN_POLL.set(state, { error: 'บัญชีนี้ไม่มีสิทธิ์เข้าแอป Monitor', expires: Date.now() + 120000 });
      return res
        .status(200)
        .type('html')
        .send(
          '<body style="padding:1.5rem;text-align:center"><p>บัญชีนี้ไม่มีสิทธิ์เข้าแอป (เฉพาะเจ้าหน้าที่/กรรมการ/ผู้ดูแลระบบ)</p></body>'
        );
    }
    const sessionName = String(v2User.username || '').trim() || v2User._docId || 'user';
    const token = crypto.randomBytes(24).toString('hex');
    monitorSessionsSet(token, {
      username: sessionName,
      createdAt: Date.now(),
      fullname: v2User.fullname != null ? String(v2User.fullname).trim() : '',
      email: v2User.email != null ? String(v2User.email).trim() : '',
      group: v2User.group != null ? String(v2User.group).trim() : '',
      role: v2User.role != null ? String(v2User.role).trim() : ''
    });
    LINE_LOGIN_POLL.set(state, { token, username: sessionName, expires: Date.now() + 120000 });
    return res
      .status(200)
      .type('html')
      .send(
        '<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
          '<title>เข้าสู่ระบบแล้ว</title></head><body style="font-family:sans-serif;padding:2rem;text-align:center;background:#0d0f14;color:#e8eaed">' +
          '<p style="font-size:1.1rem">เข้าสู่ระบบแล้ว</p><p style="color:#8b8f99">กลับไปที่แอป NKBKConnext — หน้าเข้าสู่ระบบจะดำเนินการต่ออัตโนมัติ</p>' +
          '<p style="color:#6b7280;font-size:0.85rem;margin-top:1rem">กำลังปิดแท็บนี้ (ถ้าไม่ปิด ให้ปิดเอง)</p>' +
          '<script>(function(){try{var c=new BroadcastChannel(\'nkbk-line-oauth\');c.postMessage({type:\'line-callback-ok\'});c.close();}catch(e){}' +
          'setTimeout(function(){try{window.close();}catch(e2){}},500);setTimeout(function(){try{window.close();}catch(e3){}},2000);})();</script>' +
          '</body></html>'
      );
  } catch (e) {
    console.error('[line-login-callback]', e);
    LINE_LOGIN_POLL.set(state, { error: (e && e.message) || 'ผิดพลาด', expires: Date.now() + 120000 });
    return res.status(500).type('html').send('<body>เกิดข้อผิดพลาด</body>');
  }
});

/** บังคับอัปโหลด snapshot ไป monitor-api ทันที (เฉพาะ localhost — หน้า index เรียกหลังล็อกอิน) */
app.post('/api/trigger-system-snapshot-push', async (req, res) => {
  if (!isLocalhostSnapshotRequest(req)) {
    return res.status(403).json({ ok: false, message: 'เฉพาะ localhost' });
  }
  try {
    await pushSystemSnapshotToMonitorWeb();
    return res.json({
      ok: !!_lastWebPushOk,
      at: _lastWebPushAt,
      detail: _lastWebPushDetail
    });
  } catch (e) {
    return res.status(500).json({ ok: false, message: (e && e.message) || String(e) });
  }
});

/** ดูว่า push ล่าสุดสำเร็จหรือไม่ (localhost) — ช่วยเช็กว่า monitorApiUrl / secret ถูกต้อง */
app.get('/api/system-snapshot-push-status', (req, res) => {
  if (!isLocalhostSnapshotRequest(req)) {
    return res.status(403).json({ ok: false, message: 'เฉพาะ localhost' });
  }
  res.json({
    ok: _lastWebPushOk,
    at: _lastWebPushAt,
    detail: _lastWebPushDetail || '(ยังไม่เคย push)'
  });
});

/** ดึง NAS ที่แอดมินกำหนดใน Firestore (adminNetworkDrives) — เฉพาะ localhost; ไม่มี SA บนเครื่องจะลองผ่าน monitor-api + read key */
app.get('/api/programs-nas-from-web', async (req, res) => {
  if (!isLocalhostSnapshotRequest(req)) {
    return res.status(403).json({ ok: false, message: 'เฉพาะ localhost' });
  }
  try {
    const out = await readProgramsNasFromWebForWorkstation();
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ ok: false, message: (e && e.message) || String(e) });
  }
});

/** ดึง Web Connection ที่แอดมินกำหนดใน Firestore (adminWebConnections[0]) — ใช้ซิงก์กลับเข้าฟอร์มในแอป */
app.get('/api/programs-web-from-web', async (req, res) => {
  if (!isLocalhostSnapshotRequest(req)) {
    return res.status(403).json({ ok: false, message: 'เฉพาะ localhost' });
  }
  try {
    const out = await readProgramsWebFromLocalFirestore();
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ ok: false, message: (e && e.message) || String(e) });
  }
});

/** ส่งค่า NAS จากโปรแกรมไปอัปเดต adminNetworkDrives ใน Firestore (แอดมินเว็บ) — เฉพาะ localhost; ต้องมี firebase service account บนเครื่อง */
app.post('/api/programs-push-admin-nas', async (req, res) => {
  if (!isLocalhostSnapshotRequest(req)) {
    return res.status(403).json({ ok: false, message: 'เฉพาะ localhost' });
  }
  try {
    const out = await pushAdminNasToFirestoreFromWorkstation(req.body || {});
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ ok: false, message: (e && e.message) || String(e) });
  }
});

/** ส่งค่าเว็บไซต์เชื่อมต่อจากโปรแกรมไปอัปเดต adminWebConnections[0] ใน Firestore — เฉพาะ localhost */
app.post('/api/programs-push-admin-web', async (req, res) => {
  if (!isLocalhostSnapshotRequest(req)) {
    return res.status(403).json({ ok: false, message: 'เฉพาะ localhost' });
  }
  try {
    const out = await pushAdminWebToFirestoreFromWorkstation(req.body || {});
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ ok: false, message: (e && e.message) || String(e) });
  }
});

app.post('/api/monitor-login', async (req, res) => {
  const username = (req.body && req.body.username) != null ? String(req.body.username).trim() : '';
  const pin = (req.body && req.body.pin) != null ? String(req.body.pin).trim() : '';
  if (!username) return res.status(400).json({ ok: false, message: 'กรุณากรอกชื่อผู้ใช้' });

  const remoteBase = getMonitorApiUrl();
  if (remoteBase) {
    if (!pin) {
      return res.status(400).json({ ok: false, message: 'กรุณากรอกรหัส PIN หรือรหัสผ่าน' });
    }
    if (pin.length > 512) {
      return res.status(400).json({ ok: false, message: 'รหัสยาวเกินไป' });
    }
    const fallbackBase = getMonitorApiUrlFallback();
    // ลอง URL หลัก (nkbk.srsp.app) ก่อน — fallback ใช้เมื่อหลักใช้ไม่ได้หรืออยู่ LAN
    const bases = [];
    bases.push(remoteBase);
    if (fallbackBase && fallbackBase !== remoteBase) bases.push(fallbackBase);
    const FETCH_TIMEOUT_MS = 25000;
    const FALLBACK_TIMEOUT_MS = 8000;
    const errMsg = (status, raw) => {
      if (status === 403) return 'เซิร์ฟเวอร์ห้ามเรียก (403) — ต้องตั้งค่าโฮสต์ nkbk.srsp.app ให้อนุญาต POST /api/monitor-login (ปิด WAF หรือเพิ่ม rewrite/proxy ไปที่แอป Node)';
      if (status === 404) return 'ไม่พบ API ล็อกอินบนเซิร์ฟเวอร์ (404) — ตรวจว่า path /api/monitor-login มีบนเซิร์ฟเวอร์';
      if (status === 502) return 'เซิร์ฟเวอร์ล็อกอินไม่ตอบ (502) — ตรวจว่า line-webhook รันอยู่และ Nginx proxy ไปถูกที่';
      if (status === 504) return 'Gateway Timeout (504) — รอเซิร์ฟเวอร์ไม่ทัน · ถ้าอยู่ในออฟฟิศ ลองใส่ monitorApiUrlFallback เป็น IP NAS ใน LAN';
      return `เซิร์ฟเวอร์ตอบกลับไม่ใช่ JSON (HTTP ${status}) — ตรวจว่า API ล็อกอิน deploy แล้วหรือไม่`;
    };
    for (const base of bases) {
      try {
        const isFallback = base === fallbackBase;
        const timeoutMs = isFallback ? FALLBACK_TIMEOUT_MS : FETCH_TIMEOUT_MS;
        const skipSslVerify = base.startsWith('https');
        const r = await postJsonToMonitorApi(
          `${base}/api/monitor-login`,
          { username, pin },
          timeoutMs,
          skipSslVerify ? false : true
        );
        const raw = r.raw || '';
        let data;
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch (_) {
          console.error('monitor-login remote response not JSON:', r.status, (raw || '').trim().slice(0, 80));
          // 403/404 = โฮสต์บล็อกหรือไม่มี path — ไม่ลอง fallback (ไม่รอ NAS จนหมดเวลา)
          const skipFallbackForStatus = r.status === 403 || r.status === 404;
          if (!skipFallbackForStatus && bases.indexOf(base) < bases.length - 1) continue;
          return res.status(502).json({ ok: false, message: errMsg(r.status, raw) });
        }
        if (!data || typeof data !== 'object') data = { ok: false, message: 'ตอบกลับจากเซิร์ฟเวอร์ไม่ถูกต้อง' };
        return res.status(r.status >= 200 && r.status < 300 ? 200 : r.status).json(data);
      } catch (err) {
        const isTimeout = err.message === 'ETIMEDOUT' || err.code === 'ETIMEDOUT';
        console.error('monitor-login proxy', base, isTimeout ? 'timeout' : err.message);
        if (bases.indexOf(base) < bases.length - 1) continue;
        return res.status(502).json({
          ok: false,
          message: isTimeout
            ? 'เซิร์ฟเวอร์ล็อกอินตอบช้าเกินเวลาที่ตั้งไว้ · ตรวจว่า (1) IP ใน monitorApiUrlFallback ถูกต้องและ NAS รัน line-webhook (2) NAS ออกเน็ตไป Firestore ได้'
            : 'เชื่อมต่อเซิร์ฟเวอร์ล็อกอินไม่ได้ — ตรวจอินเทอร์เน็ต หรือที่อยู่ API ใน monitor-config.json'
        });
      }
    }
  }

  if (!/^\d{6}$/.test(pin)) {
    return res.status(400).json({ ok: false, message: 'รหัส PIN ต้องเป็นตัวเลข 6 หลัก' });
  }

  if (!ensureMonitorFirestore()) {
    const hints = {
      missing_file:
        'ไม่พบไฟล์ firebase-service-account.json — หรือตั้งล็อกอินผ่าน NAS: สร้าง monitor-config.json แบบ {"monitorApiUrl":"http://IP:3001"} เท่านั้น (ห้ามวางไฟล์ service account ในชื่อ monitor-config.json — ให้ใช้ชื่อ firebase-service-account.json)',
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
      monitorSessionsSet(token, {
        username: sessionName,
        createdAt: Date.now(),
        fullname: v2User.fullname != null ? String(v2User.fullname).trim() : '',
        email: v2User.email != null ? String(v2User.email).trim() : '',
        group: v2User.group != null ? String(v2User.group).trim() : '',
        role: v2User.role != null ? String(v2User.role).trim() : ''
      });
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
    monitorSessionsSet(token, {
      username: snap.id,
      createdAt: Date.now(),
      fullname: data.fullname != null ? String(data.fullname).trim() : '',
      email: data.email != null ? String(data.email).trim() : '',
      group: data.group != null ? String(data.group).trim() : '',
      role: data.role != null ? String(data.role).trim() : ''
    });
    res.json({ ok: true, token, username: snap.id });
  } catch (err) {
    console.error('monitor-login:', err);
    res.status(500).json({ ok: false, message: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
  }
});

app.get('/api/monitor-me', async (req, res) => {
  const token = (req.headers['x-monitor-token'] || req.query.token || '').trim();
  const session = token ? MONITOR_SESSIONS.get(token) : null;
  /** โทเคนที่ออกจากเครื่องนี้ (PIN / LINE) — ต้องตอบจาก RAM ที่นี่ ห้ามส่งไป remote ก่อน */
  if (session) {
    let fullname = session.fullname || '';
    let email = session.email || '';
    let group = session.group || '';
    let role = session.role || '';
    let work = buildWorkFromV2User(null);
    let todayAttendance = {
      date: getBangkokDateId(),
      checkIn: '—',
      checkOut: '—',
      statusText: '—',
      lateText: '',
      lateLevel: null
    };
    if (ensureMonitorFirestore()) {
      try {
        const db = getMonitorDb();
        const u = await findV2UserByUsername(db, session.username);
        const p = monitorProfileFromV2User(u);
        if (p) {
          fullname = p.fullname;
          email = p.email;
          group = p.group;
          role = p.role;
        }
        if (u) {
          work = buildWorkFromV2User(u);
          todayAttendance = await buildTodayAttendanceFromDb(db, u);
        }
      } catch (e) {
        console.error('monitor-me profile lookup:', e.message);
      }
    }
    return res.json({
      ok: true,
      username: session.username,
      fullname,
      email,
      group,
      role,
      work,
      todayAttendance
    });
  }

  const remoteBase = getMonitorApiUrl();
  if (remoteBase) {
    const fallbackBase = getMonitorApiUrlFallback();
    const bases = [remoteBase];
    if (fallbackBase && fallbackBase !== remoteBase) bases.push(fallbackBase);
    for (const base of bases) {
      try {
        const r = await fetch(`${base}/api/monitor-me`, {
          headers: { 'X-Monitor-Token': token }
        });
        const data = await r.json().catch(() => ({ ok: false }));
        return res.status(r.status).json(data);
      } catch (err) {
        if (bases.indexOf(base) < bases.length - 1) continue;
        console.error('monitor-me proxy', err);
        return res.status(502).json({ ok: false });
      }
    }
  }
  return res.status(401).json({ ok: false });
});

// =====================================================
// Leave system — sync กับ Firestore (V2 schema)
// =====================================================

/** สร้าง notification — ใช้ firebase-admin ของเครื่อง (ถ้ามี) หรือ fallback REST */
async function _notifCreate(data) {
  if (!ensureMonitorFirestore()) return { ok: false, reason: 'no_firestore' };
  try {
    const db = getMonitorDb();
    const adminSdk = require('firebase-admin');
    const FieldValue = adminSdk.firestore.FieldValue;
    const ref = await db.collection('notifications').add({
      userId: String(data.userId || ''),
      targetType: String(data.targetType || 'user'),
      targetValue: String(data.targetValue || ''),
      source: String(data.source || 'system'),
      category: String(data.category || 'info'),
      title: String(data.title || ''),
      body: String(data.body || ''),
      severity: String(data.severity || 'info'),
      icon: String(data.icon || ''),
      relatedType: String(data.relatedType || ''),
      relatedId: String(data.relatedId || ''),
      url: String(data.url || ''),
      read: false,
      readAt: null,
      createdBy: String(data.createdBy || 'system'),
      createdAt: FieldValue.serverTimestamp()
    });
    return { ok: true, id: ref.id };
  } catch (e) {
    console.warn('[notif] create fail:', e.message);
    return { ok: false, reason: 'error', message: e.message };
  }
}

/** Proxy request ไป remote monitor-api เมื่อเครื่องไม่มี firebase-service-account.json */
async function proxyLeaveToRemote(req, res, apiPath) {
  const remoteBase = getMonitorApiUrl();
  if (!remoteBase) return res.status(503).json({ ok: false, reason: 'no_remote', message: 'ไม่ได้ตั้ง monitorApiUrl' });
  const token = (req.headers['x-monitor-token'] || req.query.token || '').trim();
  const bases = [remoteBase];
  const fb = getMonitorApiUrlFallback();
  if (fb && fb !== remoteBase) bases.push(fb);
  let queryStr = '';
  try { const u = new URL(req.originalUrl, 'http://x'); queryStr = u.search || ''; } catch (_) {}
  for (const base of bases) {
    try {
      const url = base.replace(/\/$/, '') + apiPath + queryStr;
      const headers = { 'X-Monitor-Token': token };
      let body;
      if (req.method === 'POST') {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(req.body || {});
      }
      const r = await fetch(url, { method: req.method, headers, body });
      const j = await r.json().catch(() => ({ ok: false, reason: 'bad_json' }));
      return res.status(r.status).json(j);
    } catch (e) {
      if (bases.indexOf(base) < bases.length - 1) continue;
      return res.status(502).json({ ok: false, reason: 'proxy_fail', message: (e && e.message) || String(e) });
    }
  }
}

/**
 * รองรับ session จาก 2 ที่:
 *  1) local MONITOR_SESSIONS (PIN / LINE login ที่ออกจากเครื่องนี้)
 *  2) remote monitor-api (nkbk.srsp.app) — ตรวจด้วย /api/monitor-me
 * คืน { username, fullname, email, group, role } ถ้าสำเร็จ หรือ null ถ้าไม่ผ่าน
 */
async function resolveMonitorSessionFromToken(token) {
  if (!token) return null;
  const local = MONITOR_SESSIONS.get(token);
  if (local) return {
    username: local.username || '',
    fullname: local.fullname || '',
    email: local.email || '',
    group: local.group || '',
    role: local.role || ''
  };
  const remoteBase = getMonitorApiUrl();
  if (!remoteBase) return null;
  const fallbackBase = getMonitorApiUrlFallback();
  const bases = [remoteBase];
  if (fallbackBase && fallbackBase !== remoteBase) bases.push(fallbackBase);
  for (const base of bases) {
    try {
      const r = await fetch(`${base.replace(/\/$/, '')}/api/monitor-me`, {
        headers: { 'X-Monitor-Token': token }
      });
      if (r.status !== 200) continue;
      const data = await r.json().catch(() => null);
      if (!data || !data.ok) continue;
      return {
        username: String(data.username || ''),
        fullname: String(data.fullname || ''),
        email: String(data.email || ''),
        group: String(data.group || ''),
        role: String(data.role || '')
      };
    } catch (_) {}
  }
  return null;
}

function _leaveFiscalYearKey(now) {
  const d = now instanceof Date ? now : new Date();
  return d.getFullYear();
}

function _escOrEmpty(v) {
  return v == null ? '' : String(v);
}

function _leaveClassify(user) {
  const pos = String((user && user.position) || '').trim();
  const canFlag = user && (user.canApproveLeave === true || user.canApproveLeave === 'true');
  const isLevel1 = canFlag && /ผู้จัดการ/.test(pos) && !/รอง/.test(pos);
  const isLevel2 = canFlag && (/รองผู้จัดการ/.test(pos) || /หัวหน้า/.test(pos));
  return { canApprove: !!(canFlag && (isLevel1 || isLevel2)), isLevel1, isLevel2 };
}

async function _leaveLoadTypes(db) {
  try {
    const snap = await db.collection('leave_types').get();
    const out = {};
    snap.forEach((d) => { out[d.id] = { id: d.id, ...(d.data() || {}) }; });
    return out;
  } catch (_) { return {}; }
}

app.get('/api/monitor-my-leaves', async (req, res) => {
  const token = (req.headers['x-monitor-token'] || req.query.token || '').trim();
  const session = await resolveMonitorSessionFromToken(token);
  if (!session) return res.status(401).json({ ok: false, reason: 'no_session' });
  if (!ensureMonitorFirestore()) return proxyLeaveToRemote(req, res, '/api/monitor-my-leaves');
  try {
    const db = getMonitorDb();
    const u = await findV2UserByUsername(db, session.username);
    if (!u) return res.status(404).json({ ok: false, reason: 'no_user' });
    const uid = u._docId || u.id;
    const types = await _leaveLoadTypes(db);
    const qs = await db.collection('leaves').where('userId', '==', uid).get();
    const items = [];
    qs.forEach((doc) => {
      const d = doc.data() || {};
      items.push({
        id: doc.id,
        type: _escOrEmpty(d.type),
        typeName: (types[d.type] && (types[d.type].nameTH || types[d.type].name)) || _escOrEmpty(d.type),
        partial: _escOrEmpty(d.partial || 'full'),
        startDate: _escOrEmpty(d.startDate),
        endDate: _escOrEmpty(d.endDate),
        durationDays: Number(d.durationDays) || 0,
        status: _escOrEmpty(d.status || 'pending'),
        reason: _escOrEmpty(d.reason),
        approverName1: _escOrEmpty(d.approverName1),
        approverName2: _escOrEmpty(d.approverName2),
        createdAtMs: d.createdAt && d.createdAt.toMillis ? d.createdAt.toMillis() : (d.createdAt && d.createdAt._seconds ? d.createdAt._seconds * 1000 : 0)
      });
    });
    // sort by startDate desc (newest leave first), fallback createdAt
    items.sort((a, b) => {
      const sa = String(a.startDate || '');
      const sb = String(b.startDate || '');
      if (sa && sb && sa !== sb) return sb.localeCompare(sa);
      return (b.createdAtMs || 0) - (a.createdAtMs || 0);
    });
    return res.json({ ok: true, items, userId: uid });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: 'error', message: (e && e.message) || String(e) });
  }
});

app.get('/api/monitor-my-leave-balance', async (req, res) => {
  const token = (req.headers['x-monitor-token'] || req.query.token || '').trim();
  const session = await resolveMonitorSessionFromToken(token);
  if (!session) return res.status(401).json({ ok: false, reason: 'no_session' });
  if (!ensureMonitorFirestore()) return proxyLeaveToRemote(req, res, '/api/monitor-my-leave-balance');
  try {
    const db = getMonitorDb();
    const u = await findV2UserByUsername(db, session.username);
    if (!u) return res.status(404).json({ ok: false, reason: 'no_user' });
    const uid = u._docId || u.id;
    const year = _leaveFiscalYearKey(new Date());
    const balDocId = uid + '_' + year;
    const types = await _leaveLoadTypes(db);
    const balSnap = await db.collection('leave_balances').doc(balDocId).get();
    const data = balSnap.exists ? balSnap.data() || {} : {};
    const itemsMap = data.items && typeof data.items === 'object' ? data.items : {};
    // ใช้ leave_types เป็นแหล่งความจริง — ประเภทที่ไม่มีใน collection จะไม่แสดง (กันพวก id เก่า / stale)
    const out = [];
    for (const [tid, t] of Object.entries(types)) {
      const row = itemsMap[tid] || {};
      const quota = Number(row.quota != null ? row.quota : (t.yearlyQuota || t.quota || 0)) || 0;
      const used = Number(row.used != null ? row.used : 0) || 0;
      const remaining = Number(row.remaining != null ? row.remaining : (quota - used)) || 0;
      out.push({
        typeId: tid,
        name: _escOrEmpty(t.nameTH || t.name || tid),
        order: Number(t.order) || 999,
        quota, used, remaining
      });
    }
    out.sort((a, b) => (a.order || 999) - (b.order || 999));
    return res.json({ ok: true, year, items: out });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: 'error', message: (e && e.message) || String(e) });
  }
});

app.get('/api/monitor-leave-pending-approvals', async (req, res) => {
  const token = (req.headers['x-monitor-token'] || req.query.token || '').trim();
  const session = await resolveMonitorSessionFromToken(token);
  if (!session) return res.status(401).json({ ok: false, reason: 'no_session' });
  if (!ensureMonitorFirestore()) return proxyLeaveToRemote(req, res, '/api/monitor-leave-pending-approvals');
  try {
    const db = getMonitorDb();
    const u = await findV2UserByUsername(db, session.username);
    if (!u) return res.status(404).json({ ok: false, reason: 'no_user' });
    const uid = u._docId || u.id;
    const cls = _leaveClassify(u);
    if (!cls.canApprove) {
      return res.json({ ok: true, canApprove: false, items: [] });
    }
    const types = await _leaveLoadTypes(db);
    // Level 2 (หัวหน้า/รอง) — เห็น status = pending
    // Level 1 (ผู้จัดการ) — เห็นทั้ง pending และ approved_lv1
    const statusesToFetch = cls.isLevel1 ? ['pending', 'approved_lv1'] : ['pending'];
    const all = [];
    for (const st of statusesToFetch) {
      const qs = await db.collection('leaves').where('status', '==', st).get();
      qs.forEach((doc) => {
        const d = doc.data() || {};
        if (d.userId === uid) return; // ไม่อนุมัติใบของตัวเอง
        all.push({
          id: doc.id,
          userId: _escOrEmpty(d.userId),
          userName: _escOrEmpty(d.userName),
          userDept: _escOrEmpty(d.userDept),
          type: _escOrEmpty(d.type),
          typeName: (types[d.type] && (types[d.type].nameTH || types[d.type].name)) || _escOrEmpty(d.type),
          partial: _escOrEmpty(d.partial || 'full'),
          startDate: _escOrEmpty(d.startDate),
          endDate: _escOrEmpty(d.endDate),
          durationDays: Number(d.durationDays) || 0,
          status: _escOrEmpty(d.status || 'pending'),
          reason: _escOrEmpty(d.reason),
          approverName2: _escOrEmpty(d.approverName2),
          createdAtMs: d.createdAt && d.createdAt.toMillis ? d.createdAt.toMillis() : 0
        });
      });
    }
    all.sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
    return res.json({
      ok: true,
      canApprove: true,
      level: cls.isLevel1 ? 1 : 2,
      items: all
    });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: 'error', message: (e && e.message) || String(e) });
  }
});

app.post('/api/monitor-leave-approve', async (req, res) => {
  const token = (req.headers['x-monitor-token'] || req.query.token || '').trim();
  const session = await resolveMonitorSessionFromToken(token);
  if (!session) return res.status(401).json({ ok: false, reason: 'no_session' });
  if (!ensureMonitorFirestore()) return proxyLeaveToRemote(req, res, '/api/monitor-leave-approve');
  const leaveId = req.body && req.body.leaveId ? String(req.body.leaveId) : '';
  if (!leaveId) return res.status(400).json({ ok: false, reason: 'no_id' });
  try {
    const db = getMonitorDb();
    const adminSdk = require('firebase-admin');
    const FieldValue = adminSdk.firestore.FieldValue;
    const u = await findV2UserByUsername(db, session.username);
    if (!u) return res.status(404).json({ ok: false, reason: 'no_user' });
    const uid = u._docId || u.id;
    const cls = _leaveClassify(u);
    if (!cls.canApprove) return res.status(403).json({ ok: false, reason: 'not_approver' });
    const ref = db.collection('leaves').doc(leaveId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ ok: false, reason: 'no_leave' });
    const d = snap.data() || {};
    if (d.userId === uid) return res.status(400).json({ ok: false, reason: 'self' });
    const curStatus = String(d.status || 'pending');
    const now = FieldValue.serverTimestamp();
    const approverName = String(u.fullname || session.fullname || session.username);
    const update = {};
    if (cls.isLevel1) {
      if (curStatus === 'approved' || curStatus === 'rejected' || curStatus === 'cancelled') {
        return res.status(400).json({ ok: false, reason: 'bad_state', currentStatus: curStatus });
      }
      update.status = 'approved';
      update.approvedByLevel1 = uid;
      update.approvedAtLevel1 = now;
      update.approverName1 = approverName;
      // หักยอดจาก leave_balances (ตามที่ V2 ทำ)
      try {
        const year = _leaveFiscalYearKey(new Date());
        const balRef = db.collection('leave_balances').doc(d.userId + '_' + year);
        const balSnap = await balRef.get();
        const items = balSnap.exists && balSnap.data() && balSnap.data().items ? balSnap.data().items : {};
        const tid = d.type;
        const days = Number(d.durationDays) || 0;
        const row = items[tid] || {};
        const used = (Number(row.used) || 0) + days;
        const quota = Number(row.quota != null ? row.quota : 0) || 0;
        items[tid] = { ...row, used, remaining: quota - used };
        await balRef.set({ items }, { merge: true });
      } catch (e) { console.warn('[leave-approve] update balance fail:', e.message); }
    } else {
      if (curStatus !== 'pending') {
        return res.status(400).json({ ok: false, reason: 'bad_state', currentStatus: curStatus });
      }
      update.status = 'approved_lv1';
      update.approvedByLevel2 = uid;
      update.approvedAtLevel2 = now;
      update.approverName2 = approverName;
    }
    await ref.update(update);
    try {
      const types = await _leaveLoadTypes(db);
      const tName = (types[d.type] && (types[d.type].nameTH || types[d.type].name)) || d.type;
      if (cls.isLevel1) {
        await _notifCreate({
          userId: d.userId, category: 'leave.approved',
          title: '✅ การลาได้รับอนุมัติแล้ว',
          body: 'คำขอลา ' + tName + ' ' + (d.startDate || '') + ' จำนวน ' + (d.durationDays || 0) + ' วัน ได้รับการอนุมัติขั้นสุดท้ายจาก ' + approverName,
          severity: 'success', icon: 'fa-check-circle',
          relatedType: 'leave', relatedId: leaveId
        });
      } else {
        await _notifCreate({
          userId: d.userId, category: 'leave.approved_lv1',
          title: '👤 หัวหน้าอนุมัติแล้ว — รอผู้จัดการ',
          body: 'คำขอลา ' + tName + ' ' + (d.startDate || '') + ' ได้รับการอนุมัติระดับ 2 จาก ' + approverName,
          severity: 'info', icon: 'fa-user-check',
          relatedType: 'leave', relatedId: leaveId
        });
      }
    } catch (e) { console.warn('[leave-approve] notify:', e.message); }
    return res.json({ ok: true, status: update.status });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: 'error', message: (e && e.message) || String(e) });
  }
});

/**
 * GET /api/monitor-leave-form-data?leaveId=xxx
 * ดึงข้อมูลทุกอย่างที่ต้องใช้พิมพ์ "ใบลา" (สอดคล้องกับ generateLeavePDF ใน V2 LIFF)
 */
app.get('/api/monitor-leave-form-data', async (req, res) => {
  const token = (req.headers['x-monitor-token'] || req.query.token || '').trim();
  const session = await resolveMonitorSessionFromToken(token);
  if (!session) return res.status(401).json({ ok: false, reason: 'no_session' });
  if (!ensureMonitorFirestore()) return proxyLeaveToRemote(req, res, '/api/monitor-leave-form-data');
  const leaveId = String(req.query.leaveId || '').trim();
  if (!leaveId) return res.status(400).json({ ok: false, reason: 'no_id' });
  try {
    const db = getMonitorDb();
    const lvSnap = await db.collection('leaves').doc(leaveId).get();
    if (!lvSnap.exists) return res.status(404).json({ ok: false, reason: 'no_leave' });
    const l = lvSnap.data() || {};
    const me = await findV2UserByUsername(db, session.username);
    const myUid = me ? (me._docId || me.id) : '';
    // อนุญาตเฉพาะเจ้าของใบลา หรือแอดมิน / ผู้อนุมัติ
    const meRole = me ? String(me.role || '').trim() : '';
    const cls = _leaveClassify(me);
    if (l.userId !== myUid && meRole !== 'ผู้ดูแลระบบ' && meRole !== 'แอดมิน' && !cls.canApprove) {
      return res.status(403).json({ ok: false, reason: 'forbidden' });
    }
    // owner user
    let user = null;
    if (l.userId) {
      try {
        const us = await db.collection('users').doc(l.userId).get();
        if (us.exists) user = { _docId: us.id, ...(us.data() || {}) };
      } catch (_) {}
    }
    // approver lv1 / lv2 names (lookup by id if not stored)
    async function resolveApprover(idOrEmail, fallback) {
      const s = String(idOrEmail || '').trim();
      if (!s) return String(fallback || '');
      try {
        if (s.includes('@')) {
          const qs = await db.collection('users').where('email', '==', s).limit(1).get();
          if (!qs.empty) {
            const d = qs.docs[0].data();
            return String(d.fullname || d.nameTH || d.displayName || fallback || '');
          }
        } else {
          const d = await db.collection('users').doc(s).get();
          if (d.exists) {
            const x = d.data();
            return String(x.fullname || x.nameTH || x.displayName || fallback || '');
          }
        }
      } catch (_) {}
      return String(fallback || s);
    }
    const approverLv1Name = await resolveApprover(l.approvedByLevel1 || l.approverId1 || l.approverId, l.approverName1 || l.approverName);
    const approverLv2Name = await resolveApprover(l.approvedByLevel2 || l.acknowledgedByLevel2 || l.approverId2, l.approverName2 || l.acknowledgerName2);
    // leave type name
    const types = await _leaveLoadTypes(db);
    const typeName = (l.type && types[l.type] && (types[l.type].nameTH || types[l.type].name)) || _escOrEmpty(l.type);
    // balance for stat table (current year)
    const year = _leaveFiscalYearKey(new Date());
    const balSnap = await db.collection('leave_balances').doc((l.userId || '') + '_' + year).get();
    const balItems = balSnap.exists && balSnap.data() && balSnap.data().items ? balSnap.data().items : {};
    const balance = [];
    for (const [tid, t] of Object.entries(types)) {
      const row = balItems[tid] || {};
      const quota = Number(t.yearlyQuota || row.quota || 0) || 0;
      const used = Number(row.used || 0) || 0;
      const remaining = Math.max(0, quota - used);
      balance.push({
        typeId: tid,
        name: String(t.nameTH || t.name || tid),
        quota, used, remaining,
        order: Number(t.order) || 999
      });
    }
    balance.sort((a, b) => (a.order || 999) - (b.order || 999));
    function tsToIso(v) {
      if (!v) return '';
      if (typeof v === 'string') return v;
      if (v.toDate) { try { return v.toDate().toISOString(); } catch (_) {} }
      if (v._seconds != null) { try { return new Date(v._seconds * 1000).toISOString(); } catch (_) {} }
      return String(v);
    }
    return res.json({
      ok: true,
      leaveId,
      leave: {
        type: l.type || '',
        typeName,
        partial: l.partial || 'full',
        startDate: l.startDate || '',
        endDate: l.endDate || l.startDate || '',
        durationDays: Number(l.durationDays) || 0,
        reason: l.reason || l.note || '',
        status: l.status || 'pending',
        createdAtIso: tsToIso(l.createdAt),
        approvedAtLevel1Iso: tsToIso(l.approvedAtLevel1 || l.approvedAt1 || l.approvedAt),
        approvedAtLevel2Iso: tsToIso(l.approvedAtLevel2 || l.approvedAt2 || l.acknowledgedAtLevel2),
        acknowledged: !!l.acknowledgedByLevel2
      },
      user: {
        fullname: (user && (user.fullname || user.nameTH || user.displayName)) || l.userName || '',
        position: (user && (user.position || user.jobPosition)) || '',
        job: (user && (user.job || user.workType)) || '',
        department: (user && (user.department || user.dept)) || l.userDept || ''
      },
      approver: {
        level1Name: approverLv1Name || '',
        level2Name: approverLv2Name || ''
      },
      balance
    });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: 'error', message: (e && e.message) || String(e) });
  }
});

app.post('/api/monitor-leave-reject', async (req, res) => {
  const token = (req.headers['x-monitor-token'] || req.query.token || '').trim();
  const session = await resolveMonitorSessionFromToken(token);
  if (!session) return res.status(401).json({ ok: false, reason: 'no_session' });
  if (!ensureMonitorFirestore()) return proxyLeaveToRemote(req, res, '/api/monitor-leave-reject');
  const leaveId = req.body && req.body.leaveId ? String(req.body.leaveId) : '';
  const reason = req.body && req.body.reason != null ? String(req.body.reason).trim() : '';
  if (!leaveId) return res.status(400).json({ ok: false, reason: 'no_id' });
  try {
    const db = getMonitorDb();
    const adminSdk = require('firebase-admin');
    const FieldValue = adminSdk.firestore.FieldValue;
    const u = await findV2UserByUsername(db, session.username);
    if (!u) return res.status(404).json({ ok: false, reason: 'no_user' });
    const uid = u._docId || u.id;
    const cls = _leaveClassify(u);
    if (!cls.canApprove) return res.status(403).json({ ok: false, reason: 'not_approver' });
    const ref = db.collection('leaves').doc(leaveId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ ok: false, reason: 'no_leave' });
    const d = snap.data() || {};
    if (d.userId === uid) return res.status(400).json({ ok: false, reason: 'self' });
    const curStatus = String(d.status || 'pending');
    if (curStatus === 'approved' || curStatus === 'rejected' || curStatus === 'cancelled') {
      return res.status(400).json({ ok: false, reason: 'bad_state', currentStatus: curStatus });
    }
    const now = FieldValue.serverTimestamp();
    const rejectorName = String(u.fullname || session.fullname || session.username);
    await ref.update({
      status: 'rejected',
      rejectedAt: now,
      statusAt: now,
      approverId: uid,
      rejectedBy: uid,
      rejectedByName: rejectorName,
      rejectorName: rejectorName,
      rejectReason: reason
    });
    try {
      const types = await _leaveLoadTypes(db);
      const tName = (types[d.type] && (types[d.type].nameTH || types[d.type].name)) || d.type;
      await _notifCreate({
        userId: d.userId, category: 'leave.rejected',
        title: '❌ การลาไม่ได้รับอนุมัติ',
        body: 'คำขอลา ' + tName + ' ' + (d.startDate || '') + ' ถูกปฏิเสธโดย ' + rejectorName + (reason ? ' — เหตุผล: ' + reason : ''),
        severity: 'danger', icon: 'fa-times-circle',
        relatedType: 'leave', relatedId: leaveId
      });
    } catch (e) { console.warn('[leave-reject] notify:', e.message); }
    return res.json({ ok: true, status: 'rejected' });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: 'error', message: (e && e.message) || String(e) });
  }
});

// =====================================================
// Notification — list / mark-read / create (fallback proxy เมื่อไม่มี SA)
// =====================================================
app.get('/api/monitor-notifications', async (req, res) => {
  const token = (req.headers['x-monitor-token'] || req.query.token || '').trim();
  const session = await resolveMonitorSessionFromToken(token);
  if (!session) return res.status(401).json({ ok: false, reason: 'no_session' });
  if (!ensureMonitorFirestore()) return proxyLeaveToRemote(req, res, '/api/monitor-notifications');
  try {
    const db = getMonitorDb();
    const u = await findV2UserByUsername(db, session.username);
    if (!u) return res.status(404).json({ ok: false, reason: 'no_user' });
    const uid = u._docId || u.id;
    const role = String(u.role || '').trim();
    const position = String(u.position || '').trim();
    const map = new Map();
    const add = (doc) => {
      if (!doc || !doc.id) return;
      map.set(doc.id, doc);
    };
    const qMine = await db.collection('notifications').where('userId', '==', uid).limit(200).get();
    qMine.forEach((d) => add({ id: d.id, ...d.data() }));
    const qBc = await db.collection('notifications').where('targetType', '==', 'broadcast').limit(100).get();
    qBc.forEach((d) => add({ id: d.id, ...d.data() }));
    if (role) {
      const qr = await db.collection('notifications').where('targetType', '==', 'role').where('targetValue', '==', role).limit(100).get();
      qr.forEach((d) => add({ id: d.id, ...d.data() }));
    }
    if (position) {
      const qp = await db.collection('notifications').where('targetType', '==', 'position').where('targetValue', '==', position).limit(100).get();
      qp.forEach((d) => add({ id: d.id, ...d.data() }));
    }
    const items = Array.from(map.values()).map((n) => ({
      id: n.id,
      source: String(n.source || 'system'),
      category: String(n.category || 'info'),
      title: String(n.title || ''),
      body: String(n.body || ''),
      severity: String(n.severity || 'info'),
      icon: String(n.icon || ''),
      relatedType: String(n.relatedType || ''),
      relatedId: String(n.relatedId || ''),
      url: String(n.url || ''),
      read: !!n.read,
      createdAtMs: n.createdAt && n.createdAt.toMillis ? n.createdAt.toMillis() : (n.createdAt && n.createdAt._seconds ? n.createdAt._seconds * 1000 : 0)
    })).sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0)).slice(0, 50);
    const unread = items.filter((x) => !x.read).length;
    return res.json({ ok: true, items, unread });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: 'error', message: (e && e.message) || String(e) });
  }
});

app.post('/api/monitor-notification-read', async (req, res) => {
  const token = (req.headers['x-monitor-token'] || req.query.token || '').trim();
  const session = await resolveMonitorSessionFromToken(token);
  if (!session) return res.status(401).json({ ok: false, reason: 'no_session' });
  if (!ensureMonitorFirestore()) return proxyLeaveToRemote(req, res, '/api/monitor-notification-read');
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(String) : [];
  const all = !!(req.body && req.body.all);
  try {
    const db = getMonitorDb();
    const adminSdk = require('firebase-admin');
    const FieldValue = adminSdk.firestore.FieldValue;
    let targets = ids;
    if (all) {
      const u = await findV2UserByUsername(db, session.username);
      if (!u) return res.status(404).json({ ok: false, reason: 'no_user' });
      const uid = u._docId || u.id;
      const snap = await db.collection('notifications').where('userId', '==', uid).where('read', '==', false).get();
      targets = snap.docs.map((d) => d.id);
    }
    let ok = 0;
    for (const id of targets) {
      if (!id) continue;
      try {
        await db.collection('notifications').doc(id).update({ read: true, readAt: FieldValue.serverTimestamp() });
        ok++;
      } catch (_) {}
    }
    return res.json({ ok: true, updated: ok });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: 'error', message: (e && e.message) || String(e) });
  }
});

app.post('/api/monitor-notification-create', async (req, res) => {
  const token = (req.headers['x-monitor-token'] || req.query.token || '').trim();
  const session = await resolveMonitorSessionFromToken(token);
  if (!session) return res.status(401).json({ ok: false, reason: 'no_session' });
  if (!ensureMonitorFirestore()) return proxyLeaveToRemote(req, res, '/api/monitor-notification-create');
  try {
    const db = getMonitorDb();
    const u = await findV2UserByUsername(db, session.username);
    if (!u) return res.status(404).json({ ok: false, reason: 'no_user' });
    const role = String(u.role || '').trim();
    if (role !== 'ผู้ดูแลระบบ' && role !== 'แอดมิน') {
      return res.status(403).json({ ok: false, reason: 'forbidden' });
    }
    const b = req.body || {};
    const targetType = String(b.targetType || 'user').toLowerCase();
    if (!['user', 'role', 'position', 'broadcast'].includes(targetType)) {
      return res.status(400).json({ ok: false, reason: 'bad_target_type' });
    }
    if (!b.title || !b.body) return res.status(400).json({ ok: false, reason: 'need_title_body' });
    const uid = u._docId || u.id;
    const out = await _notifCreate({
      source: 'admin',
      category: String(b.category || 'admin.announce'),
      title: String(b.title).trim(),
      body: String(b.body).trim(),
      severity: String(b.severity || 'info'),
      icon: String(b.icon || ''),
      targetType,
      userId: targetType === 'user' ? String(b.targetValue || '').trim() : '',
      targetValue: (targetType === 'role' || targetType === 'position') ? String(b.targetValue || '').trim() : '',
      createdBy: uid
    });
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ ok: false, reason: 'error', message: (e && e.message) || String(e) });
  }
});

/**
 * GET /api/me-permissions
 * ส่ง allowedMenus[] สำหรับผู้ใช้ปัจจุบัน (ตาม session token)
 * - ผู้ดูแลระบบ / แอดมิน = bypass (ทุกเมนู)
 * - ผู้ใช้อื่น = role AND position ต้องอนุญาตถึงผ่าน
 * ถ้า config/menu_permissions ยังไม่มี → ทุกคนได้ทุกเมนู (กันล็อกตัวเอง)
 */
app.get('/api/me-permissions', async (req, res) => {
  const token = (req.headers['x-monitor-token'] || req.query.token || '').trim();
  const session = await resolveMonitorSessionFromToken(token);
  if (!session) return res.status(401).json({ ok: false, reason: 'no_session' });
  try {
    let role = session.role || '';
    let position = '';
    let fullname = session.fullname || '';
    if (ensureMonitorFirestore()) {
      const db = getMonitorDb();
      const u = await findV2UserByUsername(db, session.username);
      if (u) {
        role = String((u.role != null ? u.role : role) || '').trim();
        position = String((u.position != null ? u.position : '') || '').trim();
        fullname = String((u.fullname != null ? u.fullname : fullname) || '').trim();
      }
      const cfgSnap = await db.collection('config').doc('menu_permissions').get();
      let cfg = null;
      if (cfgSnap.exists) cfg = cfgSnap.data() || null;
      if (!cfg || !Array.isArray(cfg.menus) || cfg.menus.length === 0) {
        return res.json({
          ok: true, role, position, fullname,
          allowedMenus: ['overview','webapp','leave','system','storage','network','software'],
          bypass: true, reason: 'no_config'
        });
      }
      // รายการเมนู "ที่รู้จัก" ในแอปตอนนี้ — ใช้เป็น union กับ matrix ของแอดมิน
      // เมนูที่ไม่มีใน matrix = อนุญาตโดยปริยาย (ป้องกันแท็บใหม่หายเมื่อแอดมินยังไม่ได้อัปเดต)
      const KNOWN_MENUS = ['overview','webapp','leave','system','storage','network','software'];
      const managedIds = (cfg.menus || []).map((m) => m && m.id).filter(Boolean);
      const managedSet = new Set(managedIds);
      if (role === 'ผู้ดูแลระบบ' || role === 'แอดมิน') {
        const all = Array.from(new Set([...managedIds, ...KNOWN_MENUS]));
        return res.json({ ok: true, role, position, fullname, allowedMenus: all, managedMenus: managedIds, bypass: true });
      }
      const defaultAllow = !!cfg.defaultAllow;
      const rolePerm = (cfg.rolePermissions && cfg.rolePermissions[role]) || {};
      const posPerm = (cfg.positionPermissions && cfg.positionPermissions[position]) || {};
      const allowed = [];
      for (const m of cfg.menus) {
        if (!m || !m.id) continue;
        const rA = rolePerm[m.id] === true || (rolePerm[m.id] == null && defaultAllow);
        const pA = posPerm[m.id] === true || (posPerm[m.id] == null && defaultAllow);
        if (rA && pA) allowed.push(m.id);
      }
      // ใส่เมนูที่รู้จักแต่ยังไม่อยู่ใน matrix → ถือว่าอนุญาตโดยปริยาย
      for (const mid of KNOWN_MENUS) {
        if (!managedSet.has(mid) && !allowed.includes(mid)) allowed.push(mid);
      }
      return res.json({ ok: true, role, position, fullname, allowedMenus: allowed, managedMenus: managedIds, bypass: false });
    }
    return res.json({
      ok: true, role, position: '', fullname,
      allowedMenus: ['overview','webapp','leave','system','storage','network','software'],
      bypass: true, reason: 'no_firestore'
    });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: 'error', message: (e && e.message) || String(e) });
  }
});

app.get('/api/monitor-attendance-month', async (req, res) => {
  const token = (req.headers['x-monitor-token'] || req.query.token || '').trim();
  const session = token ? MONITOR_SESSIONS.get(token) : null;
  const y = req.query.year;
  const m = req.query.month;
  const qs = new URLSearchParams({ year: String(y || ''), month: String(m || '') }).toString();

  if (session) {
    const year = parseInt(req.query.year, 10);
    const month = parseInt(req.query.month, 10);
    if (!year || !month || month < 1 || month > 12 || year < 2000 || year > 2100) {
      return res.status(400).json({ ok: false, message: 'ระบุ year (ค.ศ.) และ month (1-12)' });
    }
    if (!ensureMonitorFirestore()) {
      return res.status(503).json({ ok: false, message: 'ไม่ได้ตั้งค่า Firestore' });
    }
    try {
      const db = getMonitorDb();
      const u = await findV2UserByUsername(db, session.username);
      if (!u) return res.status(404).json({ ok: false, message: 'ไม่พบบัญชีผู้ใช้' });
      const payload = await buildAttendanceMonthFromDb(db, u, year, month);
      return res.json({ ok: true, ...payload });
    } catch (e) {
      console.error('monitor-attendance-month', e);
      return res.status(500).json({ ok: false, message: e.message || 'โหลดไม่สำเร็จ' });
    }
  }

  const remoteBase = getMonitorApiUrl();
  if (remoteBase) {
    const fallbackBase = getMonitorApiUrlFallback();
    const bases = [remoteBase];
    if (fallbackBase && fallbackBase !== remoteBase) bases.push(fallbackBase);
    for (const base of bases) {
      try {
        const r = await fetch(`${base}/api/monitor-attendance-month?${qs}`, {
          headers: { 'X-Monitor-Token': token }
        });
        const data = await r.json().catch(() => ({ ok: false }));
        return res.status(r.status).json(data);
      } catch (err) {
        if (bases.indexOf(base) < bases.length - 1) continue;
        console.error('monitor-attendance-month proxy', err);
        return res.status(502).json({ ok: false, message: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้' });
      }
    }
  }
  return res.status(401).json({ ok: false, message: 'กรุณาเข้าสู่ระบบใหม่' });
});

app.post('/api/monitor-change-pin', async (req, res) => {
  const token = (req.headers['x-monitor-token'] || '').trim();
  const currentPin = String((req.body && req.body.currentPin) || '').trim();
  const newPin = String((req.body && req.body.newPin) || '').trim();
  if (!/^\d{6}$/.test(newPin)) {
    return res.status(400).json({ ok: false, message: 'รหัส PIN ใหม่ต้องเป็นตัวเลข 6 หลัก' });
  }
  if (currentPin === newPin) {
    return res.status(400).json({ ok: false, message: 'รหัสใหม่ต้องไม่ซ้ำกับรหัสเดิม' });
  }
  const session = token ? MONITOR_SESSIONS.get(token) : null;
  if (session) {
    if (!ensureMonitorFirestore()) {
      return res.status(503).json({ ok: false, message: 'ระบบไม่ได้ตั้งค่า Firestore บนเครื่องนี้' });
    }
    try {
      const db = getMonitorDb();
      const u = await findV2UserByUsername(db, session.username);
      if (!u) return res.status(404).json({ ok: false, message: 'ไม่พบบัญชีผู้ใช้' });
      const pinOk = String(u.pin != null ? u.pin : '').trim() === currentPin;
      if (!pinOk) return res.status(400).json({ ok: false, message: 'รหัส PIN ปัจจุบันไม่ถูกต้อง' });
      const docId = u._docId;
      if (!docId) return res.status(500).json({ ok: false, message: 'ไม่พบรหัสเอกสารผู้ใช้' });
      await db.collection(V2_USERS_COLLECTION).doc(docId).update({ pin: newPin });
      return res.json({ ok: true, message: 'เปลี่ยนรหัส PIN เรียบร้อย' });
    } catch (e) {
      console.error('monitor-change-pin:', e);
      return res.status(500).json({ ok: false, message: e.message || 'ไม่สามารถเปลี่ยนรหัสได้' });
    }
  }

  const remoteBase = getMonitorApiUrl();
  if (remoteBase) {
    const fallbackBase = getMonitorApiUrlFallback();
    const bases = [remoteBase];
    if (fallbackBase && fallbackBase !== remoteBase) bases.push(fallbackBase);
    for (const base of bases) {
      try {
        const skipSsl = base.startsWith('https');
        const r = await postJsonToMonitorApi(
          `${base}/api/monitor-change-pin`,
          { currentPin, newPin },
          25000,
          skipSsl ? false : true,
          { 'X-Monitor-Token': token }
        );
        let data;
        try {
          data = r.raw ? JSON.parse(r.raw) : {};
        } catch (_) {
          data = { ok: false, message: 'ตอบกลับจากเซิร์ฟเวอร์ไม่ถูกต้อง' };
        }
        const okHttp = r.status >= 200 && r.status < 300;
        return res.status(okHttp ? 200 : r.status >= 400 ? r.status : 502).json(data);
      } catch (err) {
        if (bases.indexOf(base) < bases.length - 1) continue;
        console.error('monitor-change-pin proxy', err.message);
        return res.status(502).json({ ok: false, message: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้' });
      }
    }
  }
  return res.status(401).json({ ok: false, message: 'กรุณาเข้าสู่ระบบใหม่' });
});

app.post('/api/monitor-logout', async (req, res) => {
  const token = (req.headers['x-monitor-token'] || req.body?.token || '').trim();
  if (token && MONITOR_SESSIONS.has(token)) {
    monitorSessionsDelete(token);
    return res.json({ ok: true });
  }
  const remoteBase = getMonitorApiUrl();
  if (remoteBase) {
    const fallbackBase = getMonitorApiUrlFallback();
    const bases = [remoteBase];
    if (fallbackBase && fallbackBase !== remoteBase) bases.push(fallbackBase);
    for (const base of bases) {
      try {
        const r = await fetch(`${base}/api/monitor-logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Monitor-Token': token
          },
          body: JSON.stringify(req.body || {})
        });
        const data = await r.json().catch(() => ({ ok: true }));
        return res.status(r.status).json(data);
      } catch (err) {
        if (bases.indexOf(base) < bases.length - 1) continue;
        console.error('monitor-logout proxy', err);
        return res.status(502).json({ ok: false });
      }
    }
  }
  if (token) monitorSessionsDelete(token);
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
    startConnextProgramFirestoreSync();
    startSystemSnapshotWebPush();
  });
}

module.exports = { app, PORT, startConnextProgramFirestoreSync, startSystemSnapshotWebPush };
