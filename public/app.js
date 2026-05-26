const API = '/api/system';
let refreshTimer = null;
let fetchInProgress = false;

const el = (id) => document.getElementById(id);

document.addEventListener('click', (ev) => {
  const btn = ev.target && ev.target.closest ? ev.target.closest('[data-pw-toggle]') : null;
  if (!btn) return;
  ev.preventDefault();
  const targetId = btn.getAttribute('data-pw-toggle');
  const input = targetId ? document.getElementById(targetId) : null;
  if (!input) return;
  const showNow = input.type === 'password';
  input.type = showNow ? 'text' : 'password';
  const on = btn.querySelector('.pw-eye-on');
  const off = btn.querySelector('.pw-eye-off');
  if (on && off) { on.hidden = showNow; off.hidden = !showNow; }
});

function formatUptime(seconds) {
  if (seconds == null || seconds < 0) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(`${d} วัน`);
  if (h > 0) parts.push(`${h} ชม.`);
  parts.push(`${m} นาที`);
  return parts.join(' ') || '0 นาที';
}

function escapeHtml(str) {
  if (str == null) return '—';
  const s = String(str);
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function renderDisks(disks) {
  const container = el('disksList');
  if (!disks || disks.length === 0) {
    container.innerHTML = '<p class="muted">ไม่มีข้อมูลดิสก์</p>';
    return;
  }
  container.innerHTML = disks.map((d) => `
    <div class="disk-item">
      <span class="name">${escapeHtml(d.name)}</span>
      <span class="meta">${escapeHtml(d.type)} · ${escapeHtml(d.size)}${d.vendor ? ' · ' + escapeHtml(d.vendor) : ''}</span>
    </div>
  `).join('');
}

function renderNetwork(network) {
  const container = el('networkList');
  if (!network || network.length === 0) {
    container.innerHTML = '<p class="muted">ไม่มีข้อมูลเครือข่าย</p>';
    return;
  }
  container.innerHTML = network.map((n) => {
    const state = (n.operstate || '').toLowerCase();
    const stateText = state === 'up' ? 'เชื่อมต่อ' : state === 'down' ? 'ไม่เชื่อมต่อ' : state || '—';
    const speedText = n.speed ? ` · ${n.speed}` : '';
    const connType = n.connectionType || '—';
    return `
    <div class="net-item">
      <span class="iface">${escapeHtml(n.iface)}</span>
      <span class="meta">
        <span class="net-type-badge net-type-${connType === 'Wi-Fi' ? 'wifi' : 'lan'}">${escapeHtml(connType)}</span>
        IP: ${escapeHtml(n.ip4)} · MAC: ${escapeHtml(n.mac || '—')}${speedText}
      </span>
      <span class="net-state state-${state}">${escapeHtml(stateText)}</span>
    </div>
  `;
  }).join('');
}

function updateNetworkStatus(status) {
  const statusMap = {
    connected: { text: 'เชื่อมต่อแล้ว', cls: 'status-ok' },
    disconnected: { text: 'ไม่มีการเชื่อมต่อ', cls: 'status-warn' },
    no_interfaces: { text: 'ไม่มี interface', cls: 'status-warn' }
  };
  const s = statusMap[status] || { text: '—', cls: '' };
  const html = `<span class="status-dot ${s.cls}"></span> ${s.text}`;
  ['networkStatus', 'networkStatusFull'].forEach((id) => {
    const e = el(id);
    if (e) e.innerHTML = html;
  });
}

function renderStorage(storage) {
  const container = el('storageList');
  if (!container) return;
  if (!storage || storage.length === 0) {
    container.innerHTML = '<p class="muted">ไม่มีข้อมูลพื้นที่เก็บ</p>';
    return;
  }
  container.innerHTML = storage.map((s) => {
    const pct = parseFloat(s.usePercent || 0);
    const pctCls = pct >= 90 ? 'high' : pct >= 70 ? 'mid' : 'low';
    return `
    <div class="storage-item">
      <span class="storage-mount">${escapeHtml(s.mount)}</span>
      <span class="storage-meta">ใช้แล้ว ${escapeHtml(s.usedGB)} GB · เหลือ ${escapeHtml(s.freeGB)} GB จาก ${escapeHtml(s.totalGB)} GB</span>
      <div class="meter storage-meter">
        <div class="meter-fill storage-fill ${pctCls}" style="width: ${Math.min(100, pct)}%"></div>
      </div>
      <span class="storage-pct">${s.usePercent}% ใช้แล้ว</span>
    </div>
  `;
  }).join('');
}

function renderOffice(office) {
  const container = el('officeList');
  if (!container) return;
  if (!office || office.length === 0) {
    container.innerHTML = '<p class="muted">ไม่พบ Microsoft Office (หรือไม่ได้ติดตั้งบนเครื่องนี้)</p>';
    return;
  }
  container.innerHTML = office.map((o) => `
    <div class="soft-item">
      <span class="soft-name">${escapeHtml(o.name)}</span>
      <span class="soft-ver">เวอร์ชัน ${escapeHtml(o.version)}</span>
    </div>
  `).join('');
}

function renderPrinters(printers) {
  const container = el('printersList');
  if (!container) return;
  if (!printers || printers.length === 0) {
    container.innerHTML = '<p class="muted">ไม่มีเครื่องพิมพ์ที่ติดตั้ง</p>';
    return;
  }
  container.innerHTML = printers.map((p) => `
    <div class="printer-item">
      <span class="printer-name">${escapeHtml(p.name)}</span>
      ${p.default ? '<span class="printer-default">ค่าเริ่มต้น</span>' : ''}
      <span class="printer-meta">ไดรเวอร์: ${escapeHtml(p.driver)}</span>
    </div>
  `).join('');
}

function renderPrinterDrivers(drivers) {
  const container = el('printerDriversList');
  if (!container) return;
  if (!drivers || drivers.length === 0) {
    container.innerHTML = '<p class="muted">ไม่มีไดรเวอร์เครื่องพิมพ์</p>';
    return;
  }
  container.innerHTML = '<ul class="driver-list">' + drivers.map((d) => `<li>${escapeHtml(d)}</li>`).join('') + '</ul>';
}

function renderLine(line) {
  const container = el('lineBody');
  if (!container) return;
  if (!line) {
    container.innerHTML = '<p class="muted">—</p>';
    return;
  }
  const installedText = line.installed ? 'ติดตั้งแล้ว' : 'ไม่ได้ติดตั้ง';
  const versionText = line.version ? ` เวอร์ชัน ${escapeHtml(line.version)}` : '';
  const runningText = line.running ? 'กำลังใช้อยู่' : 'ไม่ได้เปิดใช้';
  const runningClass = line.running ? 'line-running' : 'line-not-running';
  container.innerHTML = `
    <div class="line-row">
      <span class="label">สถานะการติดตั้ง</span>
      <span class="value">${escapeHtml(installedText)}${versionText}</span>
    </div>
    <div class="line-row">
      <span class="label">สถานะการใช้งาน</span>
      <span class="value ${runningClass}">${escapeHtml(runningText)}</span>
    </div>
  `;
}

function renderWindowsUpdate(data) {
  const container = el('windowsUpdateBody');
  if (!container) return;
  if (!data) {
    container.innerHTML = '<p class="muted">—</p>';
    return;
  }
  const last = data.lastHotfix || data.lastUpdate;
  const pending = data.pendingCount;
  let html = '';
  if (last && (last.date || last.description)) {
    const dateStr = typeof last === 'object' ? last.date : last;
    const descStr = typeof last === 'object' && last.description ? last.description : '';
    html += `<div class="info-row"><span class="label">อัปเดตล่าสุด</span><span class="value">${escapeHtml(dateStr)}</span></div>`;
    if (descStr) html += `<div class="info-row"><span class="label">รายการ</span><span class="value value-wrap">${escapeHtml(descStr)}</span></div>`;
  } else {
    html += '<div class="info-row"><span class="label">อัปเดตล่าสุด</span><span class="value">—</span></div>';
  }
  if (pending !== null && pending !== undefined) {
    const pendingText = pending === 0 ? 'ไม่มีอัปเดตรอติดตั้ง' : `รอติดตั้ง ${pending} รายการ`;
    html += `<div class="info-row"><span class="label">สถานะ</span><span class="value">${escapeHtml(pendingText)}</span></div>`;
  }
  container.innerHTML = html || '<p class="muted">ไม่พบข้อมูล (ไม่ใช่ Windows)</p>';
}

function renderBattery(data) {
  const card = el('batteryCard');
  const body = el('batteryBody');
  if (!body) return;
  if (!data || data.percent == null) {
    body.innerHTML = '<p class="muted">ไม่พบข้อมูลแบตเตอรี่ (อาจเป็นเครื่องตั้งโต๊ะ)</p>';
    return;
  }
  body.innerHTML = `
    <div class="battery-row">
      <span class="label">ระดับแบตเตอรี่</span>
      <span class="value">${data.percent}%</span>
    </div>
    <div class="battery-row">
      <span class="label">สถานะ</span>
      <span class="value">${data.isCharging ? 'กำลังชาร์จ' : 'ใช้พลังงานจากแบตเตอรี่'}</span>
    </div>
    <div class="battery-row">
      <span class="label">เสียบปลั๊ก</span>
      <span class="value">${data.acConnected ? 'ใช่' : 'ไม่'}</span>
    </div>
  `;
}

function updateUI(data) {
  const os = data.os || {};
  const cpu = data.cpu || {};
  const memory = data.memory || {};
  const load = data.load || {};
  const processes = data.processes || {};
  const system = data.system || {};
  const gpu = data.gpu;

  el('hostname').textContent = os.hostname ?? '—';
  el('distro').textContent = [os.distro, os.platform].filter(Boolean).join(' ') || '—';
  el('release').textContent = [os.release, os.build].filter(Boolean).join(' (Build ') + (os.build ? ')' : '') || '—';
  el('arch').textContent = os.arch ?? '—';
  el('kernel').textContent = os.kernel ?? '—';
  el('uptime').textContent = formatUptime(os.uptime);

  el('cpuBrand').textContent = cpu.brand || cpu.manufacturer || '—';
  el('cpuSpeed').textContent = cpu.speed ? `${cpu.speed} GHz` : '—';
  el('cpuCores').textContent = cpu.cores != null ? `${cpu.cores} คอร์ (${cpu.physicalCores || cpu.cores} physical)` : '—';

  const loadVal = Math.min(100, Math.round(load.currentLoad || 0));
  el('cpuLoadBar').style.width = loadVal + '%';
  el('cpuLoad').textContent = loadVal + '%';

  el('memUsed').textContent = memory.usedGB != null ? memory.usedGB + ' GB' : '—';
  el('memFree').textContent = memory.freeGB != null ? memory.freeGB + ' GB' : '—';
  el('memTotal').textContent = memory.totalGB != null ? memory.totalGB + ' GB' : '—';
  const memPct = parseFloat(memory.usagePercent || 0);
  el('memBar').style.width = memPct + '%';
  el('memPercent').textContent = memPct.toFixed(1) + '%';

  el('procAll').textContent = processes.all != null ? processes.all.toLocaleString() : '—';
  el('procRunning').textContent = processes.running != null ? processes.running.toLocaleString() : '—';

  el('sysManufacturer').textContent = system.manufacturer ?? '—';
  el('sysModel').textContent = system.model ?? '—';
  el('sysSerial').textContent = system.serial ?? '—';
  el('sysUuid').textContent = system.uuid ?? '—';

  if (gpu) {
    el('gpuModel').textContent = gpu.model ?? '—';
    el('gpuVram').textContent = gpu.vram ?? '—';
  } else {
    el('gpuModel').textContent = '—';
    el('gpuVram').textContent = '—';
  }

  renderDisks(data.disks);
  renderStorage(data.storage);
  renderOffice(data.office);
  renderLine(data.line);
  renderPrinters(data.printers);
  renderPrinterDrivers(data.printerDrivers);
  renderWindowsUpdate(data.windowsUpdate);
  renderNetwork(data.network);
  updateNetworkStatus(data.networkStatus);
  renderBattery(data.battery);

  const lastEl = el('lastUpdate');
  const statusEl = el('statusText');
  const footerDot = el('footerStatusDot');
  if (lastEl) lastEl.textContent = new Date().toLocaleTimeString('th-TH');
  if (statusEl) statusEl.textContent = 'เชื่อมต่อแล้ว';
  if (footerDot) {
    footerDot.className = 'status-dot footer-status-dot status-ok';
  }
}

async function fetchSystem() {
  if (fetchInProgress) return;
  fetchInProgress = true;
  try {
    const res = await fetch(API);
    if (!res.ok) {
      let detail = res.statusText || ('HTTP ' + res.status);
      try {
        const errBody = await res.json();
        if (errBody && errBody.error) detail = String(errBody.error);
      } catch (_) {}
      throw new Error(detail);
    }
    const data = await res.json();
    updateUI(data);
  } catch (err) {
    const statusEl = el('statusText');
    const footerDot = el('footerStatusDot');
    if (statusEl) statusEl.textContent = 'ผิดพลาด: ' + err.message;
    const lastEl = el('lastUpdate');
    if (lastEl) lastEl.textContent = '—';
    if (footerDot) footerDot.className = 'status-dot footer-status-dot status-warn';
  } finally {
    fetchInProgress = false;
  }
}

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(fetchSystem, 15000);
}

function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

el('btnRefresh').addEventListener('click', () => {
  fetchSystem();
  if (typeof window.__monitorRefreshMe === 'function') window.__monitorRefreshMe();
  /* ส่งสเปกขึ้น monitor-api ทันที (เดิมมีแค่หลังล็อกอิน + รอบอัตโนมัติ — หลังเปิดเครื่องรอบแรกอาจพลาดถ้าเน็ต/WMI ยังไม่พร้อม) */
  fetch('/api/trigger-system-snapshot-push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  }).catch(() => {});
});

startAutoRefresh();

function applyTheme(isLight) {
  document.body.classList.toggle('theme-light', isLight);
  try { localStorage.setItem('theme', isLight ? 'light' : 'dark'); } catch (_) {}
}

const savedTheme = typeof localStorage !== 'undefined' ? localStorage.getItem('theme') : null;
const isLight = savedTheme === 'light';
if (el('themeSwitch')) {
  el('themeSwitch').checked = isLight;
  applyTheme(isLight);
  el('themeSwitch').addEventListener('change', (e) => applyTheme(e.target.checked));
}

// Speed Test
const speedGauge = el('speedGauge');
const gaugeNeedle = speedGauge ? speedGauge.querySelector('#gaugeNeedle') : null;
const speedGaugeValue = el('speedGaugeValue');
const speedDownloadEl = el('speedDownload');
const speedUploadEl = el('speedUpload');
const speedPingEl = el('speedPing');
const speedTestStatus = el('speedTestStatus');
const btnSpeedTest = el('btnSpeedTest');

function setGaugeMbps(value) {
  const v = Math.max(0, Math.min(1000, Number(value) || 0));
  if (speedGaugeValue) speedGaugeValue.textContent = v.toFixed(2);
  if (gaugeNeedle) {
    const deg = -90 + (v / 1000) * 180;
    gaugeNeedle.setAttribute('transform', `rotate(${deg} 100 100)`);
  }
}

function setSpeedReadouts(pingMs, downloadMbps, uploadMbps) {
  if (speedPingEl) speedPingEl.textContent = pingMs != null ? String(pingMs) : '—';
  if (speedDownloadEl) speedDownloadEl.textContent = downloadMbps != null ? Number(downloadMbps).toFixed(2) : '—';
  if (speedUploadEl) speedUploadEl.textContent = uploadMbps != null ? Number(uploadMbps).toFixed(2) : '—';
  const show = downloadMbps != null ? downloadMbps : (uploadMbps != null ? uploadMbps : 0);
  setGaugeMbps(show);
}

if (btnSpeedTest) {
  btnSpeedTest.addEventListener('click', async () => {
    btnSpeedTest.disabled = true;
    if (speedTestStatus) speedTestStatus.textContent = '';
    setSpeedReadouts(null, null, null);
    setGaugeMbps(0);

    let pingMs = null;
    let downloadMbps = null;
    let uploadMbps = null;

    try {
      if (speedTestStatus) speedTestStatus.textContent = 'กำลัง Ping...';
      const pingRes = await fetch('/api/speed-test/ping');
      const pingData = await pingRes.json();
      pingMs = pingData.ok ? pingData.pingMs : null;
      setSpeedReadouts(pingMs, null, null);

      if (speedTestStatus) speedTestStatus.textContent = 'กำลังทดสอบดาวน์โหลด...';
      const downStart = performance.now();
      const downRes = await fetch('/api/speed-test/download');
      if (!downRes.ok) throw new Error('Download failed');
      const downReader = downRes.body.getReader();
      let downBytes = 0;
      while (true) {
        const { done, value } = await downReader.read();
        if (done) break;
        downBytes += value.length;
      }
      const downTimeSec = (performance.now() - downStart) / 1000;
      downloadMbps = downTimeSec > 0 ? (downBytes * 8 / 1e6) / downTimeSec : 0;
      setSpeedReadouts(pingMs, downloadMbps, null);
      setGaugeMbps(downloadMbps);

      if (speedTestStatus) speedTestStatus.textContent = 'กำลังทดสอบอัปโหลด...';
      const uploadSize = 2 * 1024 * 1024;
      const blob = new Blob([new Uint8Array(uploadSize)]);
      const upStart = performance.now();
      const upRes = await fetch('/api/speed-test/upload', {
        method: 'POST',
        body: blob,
        headers: { 'Content-Type': 'application/octet-stream' }
      });
      const upTimeSec = (performance.now() - upStart) / 1000;
      if (upRes.ok) {
        const upData = await upRes.json();
        const sent = (upData.bytes || uploadSize);
        uploadMbps = upTimeSec > 0 ? (sent * 8 / 1e6) / upTimeSec : 0;
      }
      setSpeedReadouts(pingMs, downloadMbps, uploadMbps);
      setGaugeMbps(downloadMbps);
      if (speedTestStatus) speedTestStatus.textContent = 'ทดสอบเสร็จแล้ว';
    } catch (err) {
      if (speedTestStatus) speedTestStatus.textContent = 'ผิดพลาด: ' + err.message;
      setSpeedReadouts(pingMs, downloadMbps, uploadMbps);
      if (downloadMbps != null || uploadMbps != null) setGaugeMbps(downloadMbps ?? uploadMbps ?? 0);
    }
    btnSpeedTest.disabled = false;
  });
}

const btnClearTemp = el('btnClearTemp');
const clearTempResult = el('clearTempResult');
if (btnClearTemp) {
  btnClearTemp.addEventListener('click', async () => {
    btnClearTemp.disabled = true;
    if (clearTempResult) clearTempResult.textContent = 'กำลังเคลียร์...';
    if (clearTempResult) clearTempResult.className = 'clear-temp-result clear-temp-pending';
    try {
      const res = await fetch('/api/clear-temp', { method: 'POST' });
      const data = await res.json();
      if (!clearTempResult) return;
      clearTempResult.className = 'clear-temp-result ' + (data.ok ? 'clear-temp-success' : 'clear-temp-error');
      if (data.ok) {
        const mb = (data.freedBytes / (1024 * 1024)).toFixed(2);
        clearTempResult.textContent = `✓ ลบแล้ว ${data.deletedCount} รายการ ปล่อยพื้นที่ประมาณ ${mb} MB`;
        if (data.errors && data.errors.length) clearTempResult.textContent += ' (บางไฟล์ลบไม่ได้: กำลังใช้งานอยู่)';
      } else {
        clearTempResult.textContent = '✗ ' + (data.errors && data.errors[0] ? data.errors[0] : 'เกิดข้อผิดพลาด');
      }
    } catch (err) {
      if (clearTempResult) {
        clearTempResult.className = 'clear-temp-result clear-temp-error';
        clearTempResult.textContent = '✗ ผิดพลาด: ' + err.message;
      }
    }
    btnClearTemp.disabled = false;
  });
}

const nasUncPath = el('nasUncPath');
const nasUsername = el('nasUsername');
const nasPassword = el('nasPassword');
const nasDriveLetter = el('nasDriveLetter');
const nasRemember = el('nasRemember');
const nasResult = el('nasResult');
const btnNasConnect = el('btnNasConnect');
const btnNasDisconnect = el('btnNasDisconnect');
const btnNasOpenDrive = el('btnNasOpenDrive');

const NAS_STORAGE_KEY = 'nas_connect';
const NAS_WEB_REVISION_KEY = 'nas_web_revision';
const NAS_DEFAULT_UNC = '\\\\NKBKCOOP-DRIVE\\home';
function loadNasSaved() {
  try {
    const raw = localStorage.getItem(NAS_STORAGE_KEY);
    if (nasUncPath) nasUncPath.value = NAS_DEFAULT_UNC;
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.remember !== false && data.username != null && nasUsername) nasUsername.value = data.username;
    if (data.remember !== false && data.password != null && nasPassword) nasPassword.value = data.password;
    if (data.remember !== false && data.driveLetter && nasDriveLetter) {
      const letter = String(data.driveLetter).trim().toUpperCase().replace(/:$/, '');
      const opt = [...nasDriveLetter.options].find((o) => o.value === letter);
      if (opt) nasDriveLetter.value = letter;
    }
    if (nasRemember) nasRemember.checked = data.remember !== false;
  } catch (_) {
    if (nasUncPath) nasUncPath.value = NAS_DEFAULT_UNC;
  }
}
function saveNasSaved(uncPath, username, password, remember, driveLetter) {
  if (!remember) {
    try { localStorage.removeItem(NAS_STORAGE_KEY); } catch (_) {}
    return;
  }
  try {
    const o = {
      uncPath: uncPath || '',
      username: username || '',
      password: password || '',
      remember: true
    };
    if (driveLetter != null && String(driveLetter).trim()) {
      o.driveLetter = String(driveLetter).trim().toUpperCase().replace(/:$/, '');
    }
    localStorage.setItem(NAS_STORAGE_KEY, JSON.stringify(o));
  } catch (_) {}
}
function applyNasDriveLetterSelect(letter) {
  if (!nasDriveLetter) return;
  if (!letter) {
    nasDriveLetter.value = '';
    return;
  }
  const l = String(letter).trim().toUpperCase().replace(/:$/, '');
  const opt = [...nasDriveLetter.options].find((o) => o.value === l);
  nasDriveLetter.value = opt ? l : '';
}
let _webWebRevision = '';
async function pullWebFromAdmin() {
  try {
    const res = await fetch('/api/programs-web-from-web');
    const data = await res.json();
    if (!data || !data.ok || !data.web) return;
    const w = data.web;
    const rev = [w.url || '', w.database || '', w.username || '', w.password || '', w.name || '', w.note || ''].join('|');
    if (rev === _webWebRevision) return;
    _webWebRevision = rev;
    if (webUrl && w.url) webUrl.value = w.url;
    if (webDatabase && w.database != null) webDatabase.value = w.database;
    if (webUsername && w.username != null) webUsername.value = w.username;
    if (webPassword && w.password != null) webPassword.value = w.password;
    if (webRemember && webRemember.checked) {
      saveWebSaved(w.url || '', w.database || '', w.username || '', w.password || '', true);
    }
    const netPanel = document.getElementById('panel-webapp');
    if (webResult && netPanel && netPanel.classList.contains('active')) {
      webResult.className = 'nas-result success';
      webResult.textContent = '✓ อัปเดตค่าเว็บไซต์จากแอดมินแล้ว';
    }
    refreshWebappHub();
  } catch (_) {}
}

async function pullNasFromWebAdmin() {
  try {
    const res = await fetch('/api/programs-nas-from-web');
    const data = await res.json();
    if (!data.ok || !data.nas || !data.revision) return;
    let prev = '';
    try { prev = localStorage.getItem(NAS_WEB_REVISION_KEY) || ''; } catch (_) {}
    if (prev === data.revision) return;
    const nas = data.nas;
    if (nasUncPath) nasUncPath.value = NAS_DEFAULT_UNC;
    if (nasUsername) nasUsername.value = nas.username || '';
    if (nasPassword) nasPassword.value = nas.password || '';
    applyNasDriveLetterSelect(nas.driveLetter || '');
    try { localStorage.setItem(NAS_WEB_REVISION_KEY, data.revision); } catch (_) {}
    if (nasRemember && nasRemember.checked) {
      saveNasSaved(NAS_DEFAULT_UNC, nas.username, nas.password, true, nas.driveLetter || '');
    }
    const netPanel = document.getElementById('panel-webapp');
    if (nasResult && netPanel && netPanel.classList.contains('active')) {
      nasResult.className = 'nas-result success';
      nasResult.textContent = '✓ อัปเดตการตั้งค่า NAS จากแอดมินเว็บแล้ว (กดเชื่อมต่อเมื่อพร้อม)';
    }
    refreshWebappHub();
  } catch (_) {}
}
loadNasSaved();

if (nasRemember) {
  nasRemember.addEventListener('change', () => {
    if (!nasRemember.checked) saveNasSaved(null, null, null, false);
  });
}

if (btnNasConnect) {
  btnNasConnect.addEventListener('click', async () => {
    if (nasUncPath) nasUncPath.value = NAS_DEFAULT_UNC;
    const uncPath = NAS_DEFAULT_UNC;
    const username = (nasUsername && nasUsername.value) ? nasUsername.value.trim() : '';
    const password = nasPassword ? nasPassword.value : '';
    if (!username) {
      if (nasResult) {
        nasResult.className = 'nas-result error';
        nasResult.textContent = 'กรุณาระบุชื่อผู้ใช้';
      }
      return;
    }
    btnNasConnect.disabled = true;
    if (nasResult) { nasResult.textContent = 'กำลังเชื่อมต่อ...'; nasResult.className = 'nas-result'; }
    try {
      const res = await fetch('/api/map-network-drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uncPath,
          username,
          password,
          driveLetter: nasDriveLetter && nasDriveLetter.value ? nasDriveLetter.value : undefined
        })
      });
      const data = await res.json();
      if (nasResult) {
        nasResult.className = 'nas-result ' + (data.ok ? 'success' : 'error');
        nasResult.textContent = data.ok ? '✓ ' + data.message : '✗ ' + (data.message || 'เชื่อมต่อไม่สำเร็จ');
      }
      if (data.ok && nasRemember && nasRemember.checked) {
        const dl = nasDriveLetter && nasDriveLetter.value ? nasDriveLetter.value : '';
        saveNasSaved(uncPath, username, password, true, dl);
        try {
          const pr = await fetch('/api/programs-push-admin-nas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uncPath, username, password, driveLetter: dl })
          });
          const pj = await pr.json();
          if (pj && pj.ok && pj.revision) {
            try { localStorage.setItem(NAS_WEB_REVISION_KEY, pj.revision); } catch (_) {}
          }
        } catch (_) {}
      }
      if (btnNasOpenDrive) btnNasOpenDrive.classList.toggle('nas-open-hidden', !data.ok);
      refreshWebappHub();
    } catch (err) {
      if (nasResult) {
        nasResult.className = 'nas-result error';
        nasResult.textContent = '✗ ผิดพลาด: ' + err.message;
      }
    }
    btnNasConnect.disabled = false;
  });
}

if (btnNasDisconnect) {
  btnNasDisconnect.addEventListener('click', async () => {
    const uncPath = (nasUncPath && nasUncPath.value) ? nasUncPath.value.trim() : '';
    const driveLetter = (nasDriveLetter && nasDriveLetter.value) ? nasDriveLetter.value : '';
    if (!uncPath && !driveLetter) {
      if (nasResult) {
        nasResult.className = 'nas-result error';
        nasResult.textContent = 'กรุณาระบุ UNC Path หรือ Drive ที่จะยกเลิก';
      }
      return;
    }
    btnNasDisconnect.disabled = true;
    if (nasResult) { nasResult.textContent = 'กำลังยกเลิกการเชื่อมต่อ...'; nasResult.className = 'nas-result'; }
    try {
      const res = await fetch('/api/disconnect-network-drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uncPath: uncPath || undefined, driveLetter: driveLetter || undefined })
      });
      const data = await res.json();
      if (nasResult) {
        nasResult.className = 'nas-result ' + (data.ok ? 'success' : 'error');
        nasResult.textContent = data.ok ? '✓ ' + data.message : '✗ ' + (data.message || 'ยกเลิกไม่สำเร็จ');
      }
      if (btnNasOpenDrive) btnNasOpenDrive.classList.add('nas-open-hidden');
    } catch (err) {
      if (nasResult) {
        nasResult.className = 'nas-result error';
        nasResult.textContent = '✗ ผิดพลาด: ' + err.message;
      }
    }
    btnNasDisconnect.disabled = false;
  });
}

if (btnNasOpenDrive) {
  btnNasOpenDrive.addEventListener('click', async () => {
    const uncPath = (nasUncPath && nasUncPath.value) ? nasUncPath.value.trim() : '';
    if (!uncPath) {
      if (nasResult) {
        nasResult.className = 'nas-result error';
        nasResult.textContent = 'กรุณาระบุ UNC Path ก่อน';
      }
      return;
    }
    try {
      const res = await fetch('/api/open-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: uncPath })
      });
      const data = await res.json();
      if (nasResult) {
        nasResult.className = 'nas-result ' + (data.ok ? 'success' : 'error');
        nasResult.textContent = data.ok ? '✓ เปิดโฟลเดอร์แล้ว' : '✗ ' + (data.message || 'เปิดไม่สำเร็จ');
      }
    } catch (err) {
      if (nasResult) {
        nasResult.className = 'nas-result error';
        nasResult.textContent = '✗ ผิดพลาด: ' + err.message;
      }
    }
  });
}

setTimeout(() => { pullNasFromWebAdmin(); pullWebFromAdmin(); }, 2500);
setInterval(() => { pullNasFromWebAdmin(); pullWebFromAdmin(); }, 90000);

const WEB_STORAGE_KEY = 'web_connect';
const WEB_DEFAULT_URL = 'http://oa.nkbkcoop.com/nkh';
const WEB_DEFAULT_DB = 'isconkh_SQL';
const webUrl = el('webUrl');
const webDatabase = el('webDatabase');
const webUsername = el('webUsername');
const webPassword = el('webPassword');
const webRemember = el('webRemember');
const webResult = el('webResult');

function loadWebSaved() {
  try {
    if (webUrl) webUrl.value = WEB_DEFAULT_URL;
    if (webDatabase) webDatabase.value = WEB_DEFAULT_DB;
    const raw = localStorage.getItem(WEB_STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.remember !== false && data.url && webUrl) webUrl.value = data.url;
    if (data.remember !== false && data.database != null && webDatabase) webDatabase.value = data.database;
    if (data.remember !== false && data.username != null && webUsername) webUsername.value = data.username;
    if (data.remember !== false && data.password != null && webPassword) webPassword.value = data.password;
    if (webRemember) webRemember.checked = data.remember !== false;
  } catch (_) {
    if (webUrl) webUrl.value = WEB_DEFAULT_URL;
    if (webDatabase) webDatabase.value = WEB_DEFAULT_DB;
  }
}
function saveWebSaved(url, database, username, password, remember) {
  if (!remember) {
    try { localStorage.removeItem(WEB_STORAGE_KEY); } catch (_) {}
    return;
  }
  try {
    localStorage.setItem(WEB_STORAGE_KEY, JSON.stringify({
      url: url || '',
      database: database || '',
      username: username || '',
      password: password || '',
      remember: true
    }));
  } catch (_) {}
  pushWebConnectToAdmin(url, database, username, password);
}

let _webPushDebounce = null;
function pushWebConnectToAdmin(url, database, username, password, opts) {
  if (!url) return;
  const showStatus = !!(opts && opts.showStatus);
  if (_webPushDebounce) clearTimeout(_webPushDebounce);
  _webPushDebounce = setTimeout(async () => {
    _webPushDebounce = null;
    try {
      const res = await fetch('/api/programs-push-admin-web', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, database, username, password })
      });
      const data = await res.json().catch(() => ({}));
      if (showStatus && webResult) {
        if (data && data.ok) {
          webResult.className = 'nas-result success';
          webResult.textContent = '✓ ซิงก์ค่าขึ้นแอดมินเว็บแล้ว';
        } else {
          const reason = data && data.reason ? String(data.reason) : 'ไม่ทราบสาเหตุ';
          webResult.className = 'nas-result error';
          webResult.textContent = '⚠ ซิงก์ไป Firestore ไม่สำเร็จ: ' + reason + (data && data.message ? ' — ' + data.message : '');
        }
      }
    } catch (err) {
      if (showStatus && webResult) {
        webResult.className = 'nas-result error';
        webResult.textContent = '⚠ ซิงก์ไม่สำเร็จ: ' + err.message;
      }
    }
  }, 400);
}

function pushCurrentWebFromDom(opts) {
    let url = (webUrl && webUrl.value) ? webUrl.value.trim() : '';
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
    const database = (webDatabase && webDatabase.value) ? webDatabase.value.trim() : '';
    const username = (webUsername && webUsername.value) ? webUsername.value : '';
    const password = (webPassword && webPassword.value) ? webPassword.value : '';
  pushWebConnectToAdmin(url, database, username, password, opts);
}

loadWebSaved();

const GPT_STORAGE_KEY = 'webapp_gpt';
const GPT_DEFAULT_URL = 'https://chatgpt.com/';
const gptEnabled = el('gptEnabled');
const gptResult = el('gptResult');

function loadGptSaved() {
  try {
    const raw = localStorage.getItem(GPT_STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    if (gptEnabled) gptEnabled.checked = !!(data && data.enabled);
  } catch (_) {}
}
function saveGptSaved(enabled) {
  try {
    localStorage.setItem(GPT_STORAGE_KEY, JSON.stringify({ enabled: !!enabled, url: GPT_DEFAULT_URL }));
  } catch (_) {}
}
function webappGptIsConfigured() {
  try {
    const raw = localStorage.getItem(GPT_STORAGE_KEY);
    if (!raw) return false;
    return JSON.parse(raw).enabled === true;
  } catch (_) {
    return false;
  }
}
function openGptInApp() {
  if (!webappGptIsConfigured()) return;
  if (typeof window.electronAPI !== 'undefined' && window.electronAPI.openWebviewLogin) {
    window.electronAPI.openWebviewLogin({ url: GPT_DEFAULT_URL, database: '', username: '', password: '' });
  } else if (gptResult) {
    gptResult.className = 'nas-result error';
    gptResult.textContent = 'เปิดในแอปได้เฉพาะ NKBKConnext System (Electron)';
  }
}
loadGptSaved();

const NKBK_AI_STORAGE_KEY = 'webapp_nkbk_ai';
const nkbkAiEnabled = el('nkbkAiEnabled');
const nkbkAiStandingLocal = el('nkbkAiStandingLocal');
const nkbkAiCallNameInBox = el('nkbkAiCallNameInBox');
const nkbkAiCallNameLocal = el('nkbkAiCallNameLocal');
const nkbkAiResult = el('nkbkAiResult');
let nkbkAiServerReady = false;
let nkbkAiUserCallName = '';
let nkbkAiStatusHint = '';

function nkbkAiStatusMessage(data) {
  if (!data || !data.ok) return 'กรุณาเข้าสู่ระบบใหม่';
  if (!data.enabled) return 'แอดมินยังไม่เปิด ChatGPT โมเน่';
  if (!data.hasApiKey) return 'ยังไม่ตั้ง OpenAI API Key';
  if (data.allowed === false) return 'ยังไม่อยู่ในรายชื่อที่อนุญาต';
  if (!data.ready) return 'รอเปิดจากแอดมิน';
  return nkbkAiUserCallName ? 'เรียก: ' + nkbkAiUserCallName : 'พร้อมใช้งาน';
}

function updateNkbkAiCallNameHint(name) {
  nkbkAiUserCallName = name && String(name).trim() ? String(name).trim() : '';
  if (nkbkAiCallNameLocal) nkbkAiCallNameLocal.value = nkbkAiUserCallName;
  if (nkbkAiCallNameInBox) nkbkAiCallNameInBox.hidden = false;
}

function loadNkbkAiSaved() {
  try {
    const raw = localStorage.getItem(NKBK_AI_STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    if (nkbkAiEnabled) nkbkAiEnabled.checked = !!(data && data.enabled);
  } catch (_) {}
}
function saveNkbkAiSaved(enabled) {
  try {
    localStorage.setItem(NKBK_AI_STORAGE_KEY, JSON.stringify({ enabled: !!enabled }));
  } catch (_) {}
}
function webappNkbkAiLocalEnabled() {
  try {
    const raw = localStorage.getItem(NKBK_AI_STORAGE_KEY);
    if (!raw) return false;
    return JSON.parse(raw).enabled === true;
  } catch (_) {
    return false;
  }
}
function webappNkbkAiIsConfigured() {
  return webappNkbkAiLocalEnabled() && nkbkAiServerReady;
}
function getMonitorToken() {
  try {
    return localStorage.getItem('monitor_token') || '';
  } catch (_) {
    return '';
  }
}
async function fetchNkbkAiStatus() {
  const token = getMonitorToken();
  if (!token) {
    nkbkAiServerReady = false;
    nkbkAiStatusHint = 'กรุณาเข้าสู่ระบบใหม่';
    return null;
  }
  try {
    const r = await fetch('/api/nkbk-ai-status', {
      headers: { 'X-Monitor-Token': token },
      cache: 'no-store'
    });
    const data = await r.json();
    if (data && data.ok) updateNkbkAiCallNameHint(data.userCallName);
    nkbkAiServerReady = !!(data && data.ok && data.ready);
    nkbkAiStatusHint = nkbkAiStatusMessage(data);
    return data;
  } catch (_) {
    nkbkAiServerReady = false;
    nkbkAiStatusHint = 'เชื่อมต่อระบบ AI ไม่ได้';
    return null;
  }
}
async function loadNkbkAiMemoryToForm() {
  const token = getMonitorToken();
  if (!token || !nkbkAiStandingLocal) return;
  try {
    const r = await fetch('/api/nkbk-ai-memory', {
      headers: { 'X-Monitor-Token': token },
      cache: 'no-store'
    });
    const data = await r.json();
    if (data.ok) {
      nkbkAiStandingLocal.value = data.standingInstructions || '';
      updateNkbkAiCallNameHint(data.userCallName);
    }
  } catch (_) {}
}
async function saveNkbkAiMemoryRemote() {
  const token = getMonitorToken();
  if (!token) throw new Error('กรุณาเข้าสู่ระบบก่อน');
  const r = await fetch('/api/nkbk-ai-memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Monitor-Token': token },
    body: JSON.stringify({
      standingInstructions: nkbkAiStandingLocal ? nkbkAiStandingLocal.value : '',
      userCallName: nkbkAiCallNameLocal ? nkbkAiCallNameLocal.value.trim() : ''
    })
  });
  const data = await r.json();
  if (!data.ok) throw new Error(data.message || 'บันทึกความจำไม่สำเร็จ');
  if (data.userCallName != null) updateNkbkAiCallNameHint(data.userCallName);
}
function openNkbkAiChat() {
  if (!webappNkbkAiIsConfigured()) return;
  const token = getMonitorToken();
  if (typeof window.electronAPI !== 'undefined' && window.electronAPI.openNkbkAiChat) {
    window.electronAPI.openNkbkAiChat(token);
  } else {
    const url = '/nkbk-ai.html' + (token ? '?t=' + encodeURIComponent(token) : '');
    window.open(url, '_blank', 'noopener');
  }
}
loadNkbkAiSaved();

const WEBAPP_COOP_TITLE = 'ระบบสหกรณ์';

function webappNasIsConfigured() {
  const u = (nasUsername && nasUsername.value) ? nasUsername.value.trim() : '';
  const p = nasPassword ? nasPassword.value : '';
  return !!(u && p);
}
function webappWebIsConfigured() {
  let url = (webUrl && webUrl.value) ? webUrl.value.trim() : '';
  const u = (webUsername && webUsername.value) ? webUsername.value.trim() : '';
  const p = webPassword ? webPassword.value : '';
  return !!(url && u && p);
}
function webappShortUrl(url) {
  if (!url) return '—';
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : 'http://' + url);
    return u.hostname + (u.pathname && u.pathname !== '/' ? u.pathname : '');
  } catch (_) {
    return url.length > 42 ? url.slice(0, 39) + '…' : url;
  }
}
function refreshWebappHub() {
  const cardNas = document.getElementById('webappCardNas');
  const cardWeb = document.getElementById('webappCardWeb');
  const cardGpt = document.getElementById('webappCardGpt');
  const cardNkbkAi = document.getElementById('webappCardNkbkAi');
  const badgeNas = document.getElementById('webappNasBadge');
  const badgeWeb = document.getElementById('webappWebBadge');
  const badgeGpt = document.getElementById('webappGptBadge');
  const badgeNkbkAi = document.getElementById('webappNkbkAiBadge');
  const metaWeb = document.getElementById('webappWebMeta');
  const metaNkbkAi = document.getElementById('webappNkbkAiMeta');
  const titleWeb = document.getElementById('webappWebTitle');
  const btnNasUse = document.getElementById('btnWebappNasUse');
  const btnWebUse = document.getElementById('btnWebappWebUse');
  const btnGptUse = document.getElementById('btnWebappGptUse');
  const btnNkbkAiUse = document.getElementById('btnWebappNkbkAiUse');
  const nasOk = webappNasIsConfigured();
  const webOk = webappWebIsConfigured();
  const gptOk = webappGptIsConfigured();
  const nkbkAiOk = webappNkbkAiIsConfigured();
  if (cardNas) cardNas.setAttribute('data-configured', nasOk ? 'true' : 'false');
  if (cardWeb) cardWeb.setAttribute('data-configured', webOk ? 'true' : 'false');
  if (cardGpt) cardGpt.setAttribute('data-configured', gptOk ? 'true' : 'false');
  if (cardNkbkAi) cardNkbkAi.setAttribute('data-configured', nkbkAiOk ? 'true' : 'false');
  if (badgeNas) {
    badgeNas.textContent = nasOk ? 'พร้อมใช้งาน' : 'ต้องตั้งค่าก่อน';
    badgeNas.className = 'webapp-card-badge ' + (nasOk ? 'webapp-card-badge--ready' : 'webapp-card-badge--pending');
  }
  if (badgeWeb) {
    badgeWeb.textContent = webOk ? 'พร้อมใช้งาน' : 'ต้องตั้งค่าก่อน';
    badgeWeb.className = 'webapp-card-badge ' + (webOk ? 'webapp-card-badge--ready' : 'webapp-card-badge--pending');
  }
  if (badgeGpt) {
    badgeGpt.textContent = gptOk ? 'พร้อมใช้งาน' : 'ต้องตั้งค่าก่อน';
    badgeGpt.className = 'webapp-card-badge ' + (gptOk ? 'webapp-card-badge--ready' : 'webapp-card-badge--pending');
  }
  if (badgeNkbkAi) {
    if (!webappNkbkAiLocalEnabled()) {
      badgeNkbkAi.textContent = 'ต้องตั้งค่าก่อน';
      badgeNkbkAi.className = 'webapp-card-badge webapp-card-badge--pending';
    } else if (!nkbkAiServerReady) {
      badgeNkbkAi.textContent = nkbkAiStatusHint || 'รอเปิดจากแอดมิน';
      badgeNkbkAi.className = 'webapp-card-badge webapp-card-badge--pending';
    } else {
      badgeNkbkAi.textContent = 'พร้อมใช้งาน';
      badgeNkbkAi.className = 'webapp-card-badge webapp-card-badge--ready';
    }
  }
  if (metaNkbkAi && nkbkAiServerReady) {
    metaNkbkAi.textContent = nkbkAiUserCallName ? 'เรียก: ' + nkbkAiUserCallName : 'พร้อมใช้งาน';
  } else if (metaNkbkAi && !webappNkbkAiLocalEnabled()) {
    metaNkbkAi.textContent = 'โมเน่';
  } else if (metaNkbkAi) {
    metaNkbkAi.textContent = nkbkAiStatusHint || 'รอเปิดจากแอดมิน';
  }
  if (metaWeb) {
    let url = (webUrl && webUrl.value) ? webUrl.value.trim() : '';
    metaWeb.textContent = url ? webappShortUrl(url) : 'ยังไม่ระบุ URL';
  }
  if (titleWeb) titleWeb.textContent = WEBAPP_COOP_TITLE;
  if (btnNasUse) btnNasUse.disabled = !nasOk;
  if (btnWebUse) btnWebUse.disabled = !webOk;
  if (btnGptUse) btnGptUse.disabled = !gptOk;
  if (btnNkbkAiUse) btnNkbkAiUse.disabled = !nkbkAiOk;
}
async function refreshWebappHubAsync() {
  await fetchNkbkAiStatus();
  refreshWebappHub();
}
function openWebappSettings(kind) {
  const modal = document.getElementById('webappSettingsModal');
  const panelNas = document.getElementById('webappSettingsPanelNas');
  const panelWeb = document.getElementById('webappSettingsPanelWeb');
  const panelGpt = document.getElementById('webappSettingsPanelGpt');
  const panelNkbkAi = document.getElementById('webappSettingsPanelNkbkAi');
  const title = document.getElementById('webappSettingsTitle');
  const btnSave = document.getElementById('btnWebSaveSettings');
  const btnGptSave = document.getElementById('btnGptSaveSettings');
  const btnNkbkAiSave = document.getElementById('btnNkbkAiSaveSettings');
  const btnOpen = document.getElementById('btnWebOpenInApp');
  if (!modal) return;
  if (panelNas) panelNas.hidden = kind !== 'nas';
  if (panelWeb) panelWeb.hidden = kind !== 'web';
  if (panelGpt) panelGpt.hidden = kind !== 'gpt';
  if (panelNkbkAi) panelNkbkAi.hidden = kind !== 'nkbkai';
  if (title) {
    if (kind === 'nas') title.textContent = 'ตั้งค่า NAS / Network Drive';
    else if (kind === 'gpt') title.textContent = 'ตั้งค่า ChatGPT';
    else if (kind === 'nkbkai') title.textContent = 'ตั้งค่า ChatGPT โมเน่';
    else title.textContent = 'ตั้งค่าเว็บแอป';
  }
  if (btnSave) btnSave.style.display = kind === 'web' ? '' : 'none';
  if (btnGptSave) btnGptSave.style.display = kind === 'gpt' ? '' : 'none';
  if (btnNkbkAiSave) btnNkbkAiSave.style.display = kind === 'nkbkai' ? '' : 'none';
  if (btnOpen) btnOpen.style.display = kind === 'web' ? '' : 'none';
  if (kind === 'nkbkai') {
    fetchNkbkAiStatus().then(() => loadNkbkAiMemoryToForm());
  }
  modal.setAttribute('aria-hidden', 'false');
  modal.classList.add('ledck-modal-open');
}
function closeWebappSettings() {
  const modal = document.getElementById('webappSettingsModal');
  if (!modal) return;
  modal.setAttribute('aria-hidden', 'true');
  modal.classList.remove('ledck-modal-open');
  refreshWebappHub();
}
function bindWebappHub() {
  const btnNasSet = document.getElementById('btnWebappNasSettings');
  const btnWebSet = document.getElementById('btnWebappWebSettings');
  const btnGptSet = document.getElementById('btnWebappGptSettings');
  const btnNkbkAiSet = document.getElementById('btnWebappNkbkAiSettings');
  const btnNasUse = document.getElementById('btnWebappNasUse');
  const btnWebUse = document.getElementById('btnWebappWebUse');
  const btnGptUse = document.getElementById('btnWebappGptUse');
  const btnNkbkAiUse = document.getElementById('btnWebappNkbkAiUse');
  const btnClose = document.getElementById('webappSettingsClose');
  const btnCancel = document.getElementById('webappSettingsCancel');
  const backdrop = document.getElementById('webappSettingsBackdrop');
  const btnSave = document.getElementById('btnWebSaveSettings');
  const btnGptSave = document.getElementById('btnGptSaveSettings');
  const btnNkbkAiSave = document.getElementById('btnNkbkAiSaveSettings');
  if (btnNasSet) btnNasSet.addEventListener('click', () => openWebappSettings('nas'));
  if (btnWebSet) btnWebSet.addEventListener('click', () => openWebappSettings('web'));
  if (btnGptSet) btnGptSet.addEventListener('click', () => openWebappSettings('gpt'));
  if (btnNkbkAiSet) btnNkbkAiSet.addEventListener('click', () => openWebappSettings('nkbkai'));
  [btnClose, btnCancel, backdrop].forEach((el) => {
    if (el) el.addEventListener('click', closeWebappSettings);
  });
  if (btnNasUse && btnNasConnect) {
    btnNasUse.addEventListener('click', () => {
      if (!webappNasIsConfigured()) {
        openWebappSettings('nas');
        return;
      }
      btnNasConnect.click();
    });
  }
  if (btnWebUse) {
    btnWebUse.addEventListener('click', () => {
      if (!webappWebIsConfigured()) {
        openWebappSettings('web');
        return;
      }
      const openBtn = document.getElementById('btnWebOpenInApp');
      if (openBtn) openBtn.click();
    });
  }
  if (btnGptUse) {
    btnGptUse.addEventListener('click', () => {
      if (!webappGptIsConfigured()) {
        openWebappSettings('gpt');
        return;
      }
      openGptInApp();
    });
  }
  if (btnNkbkAiUse) {
    btnNkbkAiUse.addEventListener('click', () => {
      if (!webappNkbkAiIsConfigured()) {
        openWebappSettings('nkbkai');
        return;
      }
      openNkbkAiChat();
    });
  }
  if (btnGptSave) {
    btnGptSave.addEventListener('click', () => {
      const on = !!(gptEnabled && gptEnabled.checked);
      saveGptSaved(on);
      if (gptResult) {
        gptResult.className = 'nas-result success';
        gptResult.textContent = on ? '✓ บันทึกการตั้งค่าแล้ว' : '✓ ปิดใช้งาน ChatGPT แล้ว';
      }
      refreshWebappHub();
      setTimeout(closeWebappSettings, 450);
    });
  }
  if (btnNkbkAiSave) {
    btnNkbkAiSave.addEventListener('click', async () => {
      const on = !!(nkbkAiEnabled && nkbkAiEnabled.checked);
      saveNkbkAiSaved(on);
      try {
        if (on) await saveNkbkAiMemoryRemote();
        if (nkbkAiResult) {
          nkbkAiResult.className = 'nas-result success';
          nkbkAiResult.textContent = on ? '✓ บันทึกแล้ว' : '✓ ปิดใช้งานแล้ว';
        }
      } catch (e) {
        if (nkbkAiResult) {
          nkbkAiResult.className = 'nas-result error';
          nkbkAiResult.textContent = e.message || 'บันทึกไม่สำเร็จ';
        }
        return;
      }
      await refreshWebappHubAsync();
      setTimeout(closeWebappSettings, 450);
    });
  }
  if (btnSave) {
    btnSave.addEventListener('click', () => {
      let url = (webUrl && webUrl.value) ? webUrl.value.trim() : '';
    if (!url) {
      if (webResult) {
        webResult.className = 'nas-result error';
        webResult.textContent = 'กรุณาระบุ URL';
      }
      return;
    }
    if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
      const database = (webDatabase && webDatabase.value) ? webDatabase.value.trim() : '';
      const username = (webUsername && webUsername.value) ? webUsername.value : '';
      const password = (webPassword && webPassword.value) ? webPassword.value : '';
      if (!username || !password) {
      if (webResult) {
          webResult.className = 'nas-result error';
          webResult.textContent = 'กรุณาระบุชื่อผู้ใช้และรหัสผ่าน';
        }
        return;
      }
      if (webRemember && webRemember.checked) {
        saveWebSaved(url, database, username, password, true);
      }
      if (webResult) {
        webResult.className = 'nas-result success';
        webResult.textContent = '✓ บันทึกการตั้งค่าแล้ว';
      }
      refreshWebappHub();
      setTimeout(closeWebappSettings, 450);
    });
  }
  if (gptEnabled) {
    gptEnabled.addEventListener('change', refreshWebappHub);
  }
  [nasUsername, nasPassword, webUrl, webDatabase, webUsername, webPassword].forEach((inp) => {
    if (!inp) return;
    inp.addEventListener('input', refreshWebappHub);
  });
}
try {
  const _saved = JSON.parse(localStorage.getItem(WEB_STORAGE_KEY) || 'null');
  if (_saved && _saved.remember !== false && _saved.url && (_saved.username || _saved.password)) {
    setTimeout(() => { pushCurrentWebFromDom({ showStatus: false }); }, 2500);
  }
} catch (_) {}

[webUrl, webDatabase, webUsername, webPassword].forEach((inp) => {
  if (!inp) return;
  inp.addEventListener('change', () => {
    if (webRemember && webRemember.checked) {
      const url = (webUrl && webUrl.value) ? webUrl.value.trim() : '';
      const database = (webDatabase && webDatabase.value) ? webDatabase.value.trim() : '';
      const username = (webUsername && webUsername.value) ? webUsername.value : '';
      const password = (webPassword && webPassword.value) ? webPassword.value : '';
      saveWebSaved(url ? (/^https?:\/\//i.test(url) ? url : 'http://' + url) : '', database, username, password, true);
    }
  });
});

if (webRemember) {
  webRemember.addEventListener('change', () => {
    if (!webRemember.checked) {
      saveWebSaved(null, null, null, null, false);
    } else {
      pushCurrentWebFromDom({ showStatus: true });
    }
  });
}

const btnWebOpenInApp = el('btnWebOpenInApp');
if (btnWebOpenInApp) {
  if (typeof window.electronAPI !== 'undefined' && window.electronAPI.openWebviewLogin) {
    btnWebOpenInApp.addEventListener('click', () => {
      let url = (webUrl && webUrl.value) ? webUrl.value.trim() : '';
      const database = (webDatabase && webDatabase.value) ? webDatabase.value.trim() : '';
      const username = (webUsername && webUsername.value) ? webUsername.value : '';
      const password = (webPassword && webPassword.value) ? webPassword.value : '';
      if (!url) {
        if (webResult) {
          webResult.className = 'nas-result error';
          webResult.textContent = 'กรุณาระบุ URL';
        }
        return;
      }
      if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
      if (webRemember && webRemember.checked) saveWebSaved(url, database, username, password, true);
      if (webResult) {
        webResult.className = 'nas-result success';
        webResult.textContent = '✓ กำลังเปิดในแอป...';
      }
      window.electronAPI.openWebviewLogin({ url, database, username, password });
    });
  }
}

bindWebappHub();
refreshWebappHubAsync();

document.querySelectorAll('.tab-nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.getAttribute('data-tab');
    document.querySelectorAll('.tab-nav-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    const panel = document.getElementById('panel-' + tab);
    if (panel) panel.classList.add('active');
    if (tab === 'webapp') { pullNasFromWebAdmin(); pullWebFromAdmin(); refreshWebappHubAsync(); }
    if (tab === 'leave') refreshLeaveTab();
  });
});

// ============================================================
// Leave tab — ดึงการลา + อนุมัติ/ปฏิเสธ
// ============================================================
function _leaveStatusLabel(s) {
  switch (String(s || '')) {
    case 'pending': return 'รออนุมัติ';
    case 'approved_lv1': return 'รอผู้จัดการ';
    case 'approved': return 'อนุมัติแล้ว';
    case 'rejected': return 'ไม่อนุมัติ';
    case 'cancelled': return 'ยกเลิก';
    default: return String(s || '-');
  }
}
const _THAI_MONTHS_FULL = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const _THAI_MONTHS_SHORT = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
function _thaiDateShort(isoStr) {
  if (!isoStr) return '';
  const s = String(isoStr);
  const part = s.includes('T') ? s.split('T')[0] : s;
  const p = part.split('-');
  if (p.length !== 3) return s;
  const y = parseInt(p[0], 10), m = parseInt(p[1], 10) - 1, d = parseInt(p[2], 10);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return s;
  return d + ' ' + _THAI_MONTHS_SHORT[m] + ' ' + (y + 543);
}
function _thaiDateFull(isoStr) {
  if (!isoStr) return '';
  const s = String(isoStr);
  const part = s.includes('T') ? s.split('T')[0] : s;
  const p = part.split('-');
  if (p.length !== 3) return s;
  const y = parseInt(p[0], 10), m = parseInt(p[1], 10) - 1, d = parseInt(p[2], 10);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return s;
  return d + ' ' + _THAI_MONTHS_FULL[m] + ' ' + (y + 543);
}
function _leaveFormatRange(a, b, partial) {
  const start = String(a || '');
  const end = String(b || '');
  const p = partial && partial !== 'full' ? (partial === 'AM' ? ' (ครึ่งเช้า)' : partial === 'PM' ? ' (ครึ่งบ่าย)' : '') : '';
  if (!start) return '-';
  if (!end || start === end) return _thaiDateShort(start) + p;
  return _thaiDateShort(start) + ' - ' + _thaiDateShort(end) + p;
}
function _leaveTypeVariant(typeName) {
  const s = String(typeName || '');
  if (/ป่วย/.test(s)) return 'sick';
  if (/พักผ่อน|vacation/i.test(s)) return 'vacation';
  if (/กิจ|personal/i.test(s)) return 'personal';
  return 'other';
}
function _leaveDurationText(d) {
  const n = Number(d) || 0;
  if (n === 0.5) return 'ครึ่งวัน';
  if (n % 1 === 0.5) return Math.floor(n) + ' วันครึ่ง';
  return n + ' วัน';
}
function _leaveEsc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

async function refreshLeaveTab() {
  loadLeaveBalance();
  loadMyLeaves();
  loadLeaveApprovals();
}

async function loadLeaveBalance() {
  const grid = document.getElementById('leaveBalanceGrid');
  const badge = document.getElementById('leaveYearBadge');
  if (!grid) return;
  grid.innerHTML = '<p class="muted">กำลังโหลด...</p>';
  try {
    if (!window.__nkbkAuthFetch) { grid.innerHTML = '<p class="muted">กรุณาล็อกอินใหม่</p>'; return; }
    const res = await window.__nkbkAuthFetch('/api/monitor-my-leave-balance');
    const data = await res.json().catch(() => ({ ok: false }));
    if (!data.ok) { grid.innerHTML = '<p class="muted">โหลดไม่สำเร็จ (' + _leaveEsc(data.reason || res.status) + (data.message ? ' — ' + _leaveEsc(data.message) : '') + ')</p>'; return; }
    if (badge) {
      const y = parseInt(data.year, 10);
      badge.textContent = Number.isFinite(y) ? ('ปี ' + (y + 543)) : '—';
    }
    if (!data.items || !data.items.length) { grid.innerHTML = '<p class="muted">ยังไม่มีข้อมูลยอดลา</p>'; return; }
    grid.innerHTML = data.items.map(it => {
      const pct = it.quota > 0 ? Math.min(100, (it.used / it.quota) * 100) : 0;
      let cls = '';
      if (it.remaining <= 0) cls = 'zero';
      else if (it.remaining <= Math.max(1, it.quota * 0.2)) cls = 'low';
      return '<div class="leave-balance-item">' +
        '<div class="leave-balance-name">' + _leaveEsc(it.name) + '</div>' +
        '<div class="leave-balance-remaining ' + cls + '">' + it.remaining + '</div>' +
        '<div class="leave-balance-meta">ใช้ไป ' + it.used + ' / โควต้า ' + it.quota + ' วัน</div>' +
        '<div class="leave-balance-bar"><div class="leave-balance-bar-fill" style="width:' + pct + '%"></div></div>' +
      '</div>';
    }).join('');
  } catch (e) {
    grid.innerHTML = '<p class="muted">ผิดพลาด: ' + _leaveEsc(e.message) + '</p>';
  }
}

async function loadMyLeaves() {
  const list = document.getElementById('leaveMyList');
  if (!list) return;
  list.innerHTML = '<p class="muted">กำลังโหลด...</p>';
  try {
    if (!window.__nkbkAuthFetch) { list.innerHTML = '<p class="muted">กรุณาล็อกอินใหม่</p>'; return; }
    const res = await window.__nkbkAuthFetch('/api/monitor-my-leaves');
    const data = await res.json().catch(() => ({ ok: false }));
    if (!data.ok) { list.innerHTML = '<p class="muted">โหลดไม่สำเร็จ (' + _leaveEsc(data.reason || res.status) + (data.message ? ' — ' + _leaveEsc(data.message) : '') + ')</p>'; return; }
    const filterSel = document.getElementById('leaveMyFilter');
    const filter = filterSel ? filterSel.value : 'all';
    const items = (data.items || []).filter(x => filter === 'all' || x.status === filter);
    if (!items.length) { list.innerHTML = '<p class="leave-empty">ยังไม่มีรายการลา</p>'; return; }
    list.innerHTML = items.map(it => {
      const variant = _leaveTypeVariant(it.typeName);
      const days = Number(it.durationDays) || 0;
      const durLabel = _leaveDurationText(days);
      const cls = 'leave-row leave-type-variant-' + variant + (it.status === 'approved' ? ' is-approved' : '') + (it.status === 'rejected' ? ' is-rejected' : '');
      const canPrint = it.status === 'approved';
      return (
        '<div class="' + cls + '">' +
          '<div class="leave-day-badge">' +
            '<div class="leave-day-badge-num">' + (days % 1 === 0 ? days : days.toFixed(1)) + '</div>' +
            '<div class="leave-day-badge-unit">วัน</div>' +
          '</div>' +
          '<div class="leave-row-main">' +
            '<div class="leave-row-head">' +
              '<span class="leave-row-type">' + _leaveEsc(it.typeName) + '</span>' +
              '<span class="leave-row-dates">' + _leaveEsc(durLabel) + '</span>' +
              '<span class="leave-status ' + it.status + '">' + _leaveStatusLabel(it.status) + '</span>' +
            '</div>' +
            '<div class="leave-row-dates" style="margin-top:0.2rem;">' + _leaveEsc(_leaveFormatRange(it.startDate, it.endDate, it.partial)) + '</div>' +
            (it.reason ? '<div class="leave-row-reason">เหตุผล: ' + _leaveEsc(it.reason) + '</div>' : '') +
            (it.approverName2 ? '<div class="leave-row-reason" style="font-size:0.75rem;">หัวหน้าอนุมัติ: ' + _leaveEsc(it.approverName2) + '</div>' : '') +
            (it.approverName1 ? '<div class="leave-row-reason" style="font-size:0.75rem;">ผู้จัดการอนุมัติ: ' + _leaveEsc(it.approverName1) + '</div>' : '') +
          '</div>' +
          (canPrint ? '<div class="leave-row-actions"><button type="button" class="btn-leave-form" data-leave-form="' + _leaveEsc(it.id) + '">📄 ใบลา</button></div>' : '<div></div>') +
        '</div>'
      );
    }).join('');
    list.querySelectorAll('[data-leave-form]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-leave-form');
        if (id) openLeaveFormWindow(id);
      });
    });
  } catch (e) {
    list.innerHTML = '<p class="muted">ผิดพลาด: ' + _leaveEsc(e.message) + '</p>';
  }
}

async function loadLeaveApprovals() {
  const card = document.getElementById('leaveApprovalsCard');
  const list = document.getElementById('leaveApprovalsList');
  const count = document.getElementById('leavePendingCount');
  if (!list || !card) return;
  list.innerHTML = '<p class="muted">กำลังโหลด...</p>';
  try {
    if (!window.__nkbkAuthFetch) { card.hidden = true; return; }
    const res = await window.__nkbkAuthFetch('/api/monitor-leave-pending-approvals');
    const data = await res.json().catch(() => ({ ok: false }));
    if (!data.ok || !data.canApprove) { card.hidden = true; return; }
    card.hidden = false;
    const items = data.items || [];
    if (count) count.textContent = String(items.length);
    if (!items.length) { list.innerHTML = '<p class="leave-empty">ไม่มีคำขอรออนุมัติ</p>'; return; }
    const levelLabel = data.level === 1 ? 'คุณอนุมัติขั้นสุดท้าย (ผู้จัดการ)' : 'คุณอนุมัติระดับ 2 (หัวหน้า)';
    list.innerHTML =
      '<div class="muted" style="margin-bottom:0.5rem;font-size:0.85rem;"><i>' + _leaveEsc(levelLabel) + '</i></div>' +
      items.map(it => (
      '<div class="leave-row" data-id="' + _leaveEsc(it.id) + '">' +
        '<div class="leave-row-main">' +
          '<div class="leave-row-head">' +
            '<span class="leave-row-user">' + _leaveEsc(it.userName || it.userId) + '</span>' +
            (it.userDept ? '<span class="leave-row-dates">· ' + _leaveEsc(it.userDept) + '</span>' : '') +
            '<span class="leave-status ' + it.status + '">' + _leaveStatusLabel(it.status) + '</span>' +
          '</div>' +
          '<div class="leave-row-head">' +
            '<span class="leave-row-type">' + _leaveEsc(it.typeName) + '</span>' +
            '<span class="leave-row-dates">' + _leaveEsc(_leaveFormatRange(it.startDate, it.endDate, it.partial)) + ' · ' + (it.durationDays || 0) + ' วัน</span>' +
          '</div>' +
          (it.reason ? '<div class="leave-row-reason">เหตุผล: ' + _leaveEsc(it.reason) + '</div>' : '') +
          (it.approverName2 ? '<div class="leave-row-reason">หัวหน้าอนุมัติแล้ว: ' + _leaveEsc(it.approverName2) + '</div>' : '') +
        '</div>' +
        '<div class="leave-row-actions">' +
          '<button type="button" class="btn-leave-approve" data-action="approve" data-id="' + _leaveEsc(it.id) + '">อนุมัติ</button>' +
          '<button type="button" class="btn-leave-reject" data-action="reject" data-id="' + _leaveEsc(it.id) + '">ไม่อนุมัติ</button>' +
        '</div>' +
      '</div>'
    )).join('');
    list.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const act = btn.getAttribute('data-action');
        if (act === 'approve') await handleLeaveApprove(id);
        else if (act === 'reject') await handleLeaveReject(id);
      });
    });
  } catch (e) {
    list.innerHTML = '<p class="muted">ผิดพลาด: ' + _leaveEsc(e.message) + '</p>';
  }
}

/* ============================================================
 * nkbkModal — unified confirm/alert/prompt (แทน window.confirm / window.alert / window.prompt)
 * สวยกว่า native dialog ของ Electron เพราะ native จะใช้ Windows dialog เก่าที่มีชื่อ app/system-status-monitor
 * ============================================================ */
function nkbkModalShow(opts) {
  opts = opts || {};
  const mode = opts.mode || 'confirm'; // 'confirm' | 'alert' | 'prompt'
  const title = opts.title != null ? String(opts.title) : '';
  const message = opts.message != null ? String(opts.message) : '';
  const okText = opts.okText || (mode === 'alert' ? 'ตกลง' : 'ยืนยัน');
  const cancelText = opts.cancelText || 'ยกเลิก';
  const variant = opts.variant === 'primary' ? 'success' : (opts.variant || 'info'); // danger / warning / info / success
  const iconMap = {
    danger: '✕',
    warning: '⚠',
    info: 'ℹ',
    success: '✓'
  };
  const iconChar = opts.icon || iconMap[variant] || 'ℹ';
  const _esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'nkbk-modal-backdrop';
    backdrop.innerHTML =
      '<div class="nkbk-modal variant-' + variant + '" role="dialog" aria-modal="true">' +
        '<div class="nkbk-modal-body">' +
          '<div class="nkbk-modal-icon">' + _esc(iconChar) + '</div>' +
          '<div class="nkbk-modal-content">' +
            (title ? '<div class="nkbk-modal-title">' + _esc(title) + '</div>' : '') +
            (message ? '<div class="nkbk-modal-msg">' + _esc(message) + '</div>' : '') +
            (mode === 'prompt' ? '<div class="nkbk-modal-input-wrap"><input type="text" class="nkbk-modal-input" id="nkbkModalInput" placeholder="' + _esc(opts.placeholder || '') + '" value="' + _esc(opts.defaultValue || '') + '"/></div>' : '') +
          '</div>' +
        '</div>' +
        '<div class="nkbk-modal-actions">' +
          (mode === 'alert' ? '' : '<button type="button" class="nkbk-modal-btn nkbk-modal-btn-cancel" data-act="cancel">' + _esc(cancelText) + '</button>') +
          '<button type="button" class="nkbk-modal-btn nkbk-modal-btn-ok" data-act="ok">' + _esc(okText) + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('show'));
    const inputEl = backdrop.querySelector('.nkbk-modal-input');
    if (inputEl) { setTimeout(() => { try { inputEl.focus(); inputEl.select(); } catch (_) {} }, 30); }
    function cleanup(val) {
      backdrop.classList.remove('show');
      setTimeout(() => { try { backdrop.remove(); } catch (_) {} }, 200);
      document.removeEventListener('keydown', onKey);
      resolve(val);
    }
    function onKey(ev) {
      if (ev.key === 'Escape') cleanup(mode === 'prompt' ? null : false);
      else if (ev.key === 'Enter') {
        if (mode === 'prompt') cleanup(inputEl ? inputEl.value : '');
        else if (mode === 'alert') cleanup(true);
        else cleanup(true);
      }
    }
    backdrop.addEventListener('click', (ev) => {
      if (ev.target === backdrop) cleanup(mode === 'prompt' ? null : false);
      const btn = ev.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      if (act === 'ok') {
        if (mode === 'prompt') cleanup(inputEl ? inputEl.value : '');
        else cleanup(true);
      } else if (act === 'cancel') {
        cleanup(mode === 'prompt' ? null : false);
      }
    });
    document.addEventListener('keydown', onKey);
  });
}
window.nkbkConfirm = (opts) => nkbkModalShow({ ...(opts || {}), mode: 'confirm' });
window.nkbkAlert = (opts) => nkbkModalShow({ ...(typeof opts === 'string' ? { message: opts } : (opts || {})), mode: 'alert' });
window.nkbkPrompt = (opts) => nkbkModalShow({ ...(opts || {}), mode: 'prompt' });

async function handleLeaveApprove(id) {
  const ok = await window.nkbkConfirm({
    title: 'อนุมัติคำขอลา?',
    message: 'เมื่ออนุมัติแล้วระบบจะอัปเดตสถานะและหักยอดลา (ถ้าคุณเป็นผู้อนุมัติขั้นสุดท้าย)',
    okText: 'อนุมัติ', cancelText: 'ยกเลิก', variant: 'success', icon: '✓'
  });
  if (!ok) return;
  try {
    const res = await window.__nkbkAuthFetch('/api/monitor-leave-approve', {
      method: 'POST', body: JSON.stringify({ leaveId: id })
    });
    const data = await res.json().catch(() => ({ ok: false }));
    if (!data.ok) {
      await window.nkbkAlert({ title: 'ไม่สำเร็จ', message: (data.reason || 'error') + (data.message ? ' — ' + data.message : ''), variant: 'danger' });
      return;
    }
    refreshLeaveTab();
  } catch (e) {
    await window.nkbkAlert({ title: 'เกิดข้อผิดพลาด', message: e.message || String(e), variant: 'danger' });
  }
}

async function handleLeaveReject(id) {
  const reason = await window.nkbkPrompt({
    title: 'เหตุผลที่ไม่อนุมัติ',
    message: 'ระบุเหตุผลเพื่อแจ้งผู้ลา (ไม่บังคับ)',
    placeholder: 'เช่น เอกสารไม่ครบ / ติดวันประชุม',
    okText: 'ถัดไป', cancelText: 'ยกเลิก', variant: 'warning', icon: '⚠'
  });
  if (reason === null) return; // ยกเลิก
  const ok = await window.nkbkConfirm({
    title: 'ไม่อนุมัติคำขอลา?',
    message: 'สถานะคำขอจะถูกเปลี่ยนเป็น "ไม่อนุมัติ" และไม่สามารถย้อนกลับได้' + (reason ? '\n\nเหตุผล: ' + reason : ''),
    okText: 'ไม่อนุมัติ', cancelText: 'กลับ', variant: 'danger', icon: '✕'
  });
  if (!ok) return;
  try {
    const res = await window.__nkbkAuthFetch('/api/monitor-leave-reject', {
      method: 'POST', body: JSON.stringify({ leaveId: id, reason })
    });
    const data = await res.json().catch(() => ({ ok: false }));
    if (!data.ok) {
      await window.nkbkAlert({ title: 'ไม่สำเร็จ', message: (data.reason || 'error') + (data.message ? ' — ' + data.message : ''), variant: 'danger' });
      return;
    }
    refreshLeaveTab();
  } catch (e) {
    await window.nkbkAlert({ title: 'เกิดข้อผิดพลาด', message: e.message || String(e), variant: 'danger' });
  }
}

// bind filter + refresh button
document.addEventListener('DOMContentLoaded', () => {
  const sel = document.getElementById('leaveMyFilter');
  if (sel) sel.addEventListener('change', loadMyLeaves);
  const btn = document.getElementById('btnLeaveRefresh');
  if (btn) btn.addEventListener('click', refreshLeaveTab);
  bindLeaveSubmitModal();
});

// ----- ส่งคำขอลางาน (จากในโปรแกรม) -----
let _leaveSubmitMeta = { types: [], earliestRetrospective: '', partial: 'full', typeId: '' };

function _leaveSubmitIsoToday() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function _leaveIsoToThaiSlash(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const parts = iso.split('-').map((n) => parseInt(n, 10));
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  return String(d).padStart(2, '0') + '/' + String(m).padStart(2, '0') + '/' + (y + 543);
}

function _leaveThaiSlashToIso(text) {
  const m = String(text || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const be = parseInt(m[3], 10);
  if (d < 1 || d > 31 || mo < 1 || mo > 12 || be < 2400 || be > 2700) return null;
  const ad = be - 543;
  const iso = ad + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  const dt = new Date(ad, mo - 1, d);
  if (dt.getFullYear() !== ad || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return iso;
}

function _leaveFormatThaiDateInput(text) {
  let digits = String(text || '').replace(/[^\d]/g, '').slice(0, 8);
  if (digits.length > 2) digits = digits.slice(0, 2) + '/' + digits.slice(2);
  if (digits.length > 5) digits = digits.slice(0, 5) + '/' + digits.slice(5);
  return digits;
}

function _leaveSetDateField(baseId, iso) {
  const hidden = document.getElementById(baseId);
  const text = document.getElementById(baseId + 'Text');
  const native = document.getElementById(baseId + 'Native');
  if (hidden) hidden.value = iso || '';
  if (text) text.value = iso ? _leaveIsoToThaiSlash(iso) : '';
  if (native) native.value = iso || '';
}

function _leaveGetDateFieldIso(baseId) {
  const hidden = document.getElementById(baseId);
  if (hidden && hidden.value && /^\d{4}-\d{2}-\d{2}$/.test(hidden.value)) return hidden.value;
  const text = document.getElementById(baseId + 'Text');
  if (!text) return null;
  return _leaveThaiSlashToIso(text.value);
}

function _leaveSyncDateFieldFromText(baseId) {
  const text = document.getElementById(baseId + 'Text');
  const hidden = document.getElementById(baseId);
  const native = document.getElementById(baseId + 'Native');
  if (!text) return null;
  const iso = _leaveThaiSlashToIso(text.value);
  if (iso) {
    if (hidden) hidden.value = iso;
    if (native) native.value = iso;
    return iso;
  }
  return hidden && hidden.value ? hidden.value : null;
}

function bindThaiLeaveDateField(baseId, onChange) {
  const text = document.getElementById(baseId + 'Text');
  const native = document.getElementById(baseId + 'Native');
  const btn = document.querySelector('[data-thai-date-btn="' + baseId + '"]');
  const notify = () => { if (typeof onChange === 'function') onChange(); };
  if (text) {
    text.addEventListener('input', () => {
      text.value = _leaveFormatThaiDateInput(text.value);
      if (text.value.length >= 10) _leaveSyncDateFieldFromText(baseId);
      notify();
    });
    text.addEventListener('blur', () => {
      const iso = _leaveSyncDateFieldFromText(baseId);
      if (!iso && text.value.trim()) text.classList.add('thai-date-invalid');
      else text.classList.remove('thai-date-invalid');
      if (iso) _leaveSetDateField(baseId, iso);
      notify();
    });
  }
  if (native) {
    native.addEventListener('change', () => {
      if (native.value) _leaveSetDateField(baseId, native.value);
      notify();
    });
  }
  if (btn && native) {
    btn.addEventListener('click', () => {
      const cur = _leaveGetDateFieldIso(baseId);
      if (cur) native.value = cur;
      if (typeof native.showPicker === 'function') {
        try { native.showPicker(); return; } catch (_) {}
      }
      native.click();
    });
  }
}

function _leaveSubmitPartialLabel(p) {
  const k = String(p || '').toLowerCase();
  if (k === 'full') return 'เต็มวัน';
  if (k === 'am') return 'ครึ่งเช้า';
  if (k === 'pm') return 'ครึ่งบ่าย';
  return p;
}

function openLeaveSubmitModal() {
  const modal = document.getElementById('leaveSubmitModal');
  if (!modal) return;
  modal.setAttribute('aria-hidden', 'false');
  modal.classList.add('ledck-modal-open');
  const res = document.getElementById('leaveSubmitResult');
  if (res) res.textContent = '';
  loadLeaveSubmitMeta();
}

function closeLeaveSubmitModal() {
  const modal = document.getElementById('leaveSubmitModal');
  if (!modal) return;
  modal.setAttribute('aria-hidden', 'true');
  modal.classList.remove('ledck-modal-open');
}

async function loadLeaveSubmitMeta() {
  const typeWrap = document.getElementById('leaveSubmitTypeBtns');
  const partialWrap = document.getElementById('leaveSubmitPartialBtns');
  const reasonEl = document.getElementById('leaveSubmitReason');
  if (!typeWrap || !window.__nkbkAuthFetch) return;
  typeWrap.innerHTML = '<span class="muted leave-chip-loading">กำลังโหลด...</span>';
  if (partialWrap) partialWrap.innerHTML = '';
  try {
    const res = await window.__nkbkAuthFetch('/api/monitor-leave-submit-meta');
    const data = await res.json().catch(() => ({ ok: false }));
    if (!data.ok) throw new Error(data.message || data.reason || 'โหลดไม่สำเร็จ');
    _leaveSubmitMeta.types = Array.isArray(data.types) ? data.types : [];
    _leaveSubmitMeta.earliestRetrospective = data.earliestRetrospective || '';
    _leaveSubmitMeta.typeId = _leaveSubmitMeta.types[0] ? _leaveSubmitMeta.types[0].id : '';
    const today = _leaveSubmitIsoToday();
    const earliest = _leaveSubmitMeta.earliestRetrospective || '';
    _leaveSetDateField('leaveSubmitStart', today);
    _leaveSetDateField('leaveSubmitEnd', today);
    ['leaveSubmitStartNative', 'leaveSubmitEndNative'].forEach((id) => {
      const el = document.getElementById(id);
      if (el && earliest) el.min = earliest;
    });
    if (reasonEl) {
      reasonEl.value = '';
      updateLeaveSubmitReasonCount();
    }
    renderLeaveSubmitTypeButtons();
    renderLeaveSubmitPartialButtons();
    updateLeaveSubmitDurationPreview();
  } catch (e) {
    typeWrap.innerHTML = '<span class="muted leave-chip-loading">โหลดไม่สำเร็จ</span>';
    const resEl = document.getElementById('leaveSubmitResult');
    if (resEl) resEl.textContent = e.message || String(e);
  }
}

function renderLeaveSubmitTypeButtons() {
  const typeWrap = document.getElementById('leaveSubmitTypeBtns');
  if (!typeWrap) return;
  const types = _leaveSubmitMeta.types || [];
  if (!types.length) {
    typeWrap.innerHTML = '<span class="muted leave-chip-loading">ไม่พบประเภทการลา</span>';
    _leaveSubmitMeta.typeId = '';
    return;
  }
  if (!_leaveSubmitMeta.typeId || !types.some((t) => t.id === _leaveSubmitMeta.typeId)) {
    _leaveSubmitMeta.typeId = types[0].id;
  }
  typeWrap.innerHTML = types.map((t) => {
    const variant = _leaveTypeVariant(t.name);
    const active = t.id === _leaveSubmitMeta.typeId;
    return '<button type="button" class="leave-type-btn leave-type-' + variant + (active ? ' is-active' : '') + '" data-type-id="' + _leaveEsc(t.id) + '">' + _leaveEsc(t.name) + '</button>';
  }).join('');
  typeWrap.querySelectorAll('.leave-type-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      _leaveSubmitMeta.typeId = btn.getAttribute('data-type-id') || '';
      typeWrap.querySelectorAll('.leave-type-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
      renderLeaveSubmitPartialButtons();
      updateLeaveSubmitDurationPreview();
    });
  });
}

function updateLeaveSubmitReasonCount() {
  const reasonEl = document.getElementById('leaveSubmitReason');
  const countEl = document.getElementById('leaveSubmitReasonCount');
  if (!reasonEl || !countEl) return;
  const n = (reasonEl.value || '').length;
  countEl.textContent = n + '/500';
  countEl.classList.toggle('is-near-limit', n >= 450);
}

function renderLeaveSubmitPartialButtons() {
  const partialWrap = document.getElementById('leaveSubmitPartialBtns');
  if (!partialWrap) return;
  const t = _leaveSubmitMeta.types.find((x) => x.id === _leaveSubmitMeta.typeId);
  const modes = (t && t.modes && t.modes.length) ? t.modes : ['full'];
  if (!_leaveSubmitMeta.partial || !modes.some((m) => String(m).toLowerCase() === String(_leaveSubmitMeta.partial).toLowerCase())) {
    _leaveSubmitMeta.partial = String(modes[0] || 'full');
  }
  partialWrap.innerHTML = modes.map((m) => {
    const active = String(m).toLowerCase() === String(_leaveSubmitMeta.partial).toLowerCase();
    return '<button type="button" class="leave-partial-btn' + (active ? ' is-active' : '') + '" data-partial="' + _leaveEsc(m) + '">' + _leaveEsc(_leaveSubmitPartialLabel(m)) + '</button>';
  }).join('');
  partialWrap.querySelectorAll('.leave-partial-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      _leaveSubmitMeta.partial = btn.getAttribute('data-partial') || 'full';
      partialWrap.querySelectorAll('.leave-partial-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
      updateLeaveSubmitDurationPreview();
    });
  });
}

function updateLeaveSubmitDurationPreview() {
  const durEl = document.getElementById('leaveSubmitDuration');
  if (!durEl) return;
  const start = _leaveGetDateFieldIso('leaveSubmitStart');
  let end = _leaveGetDateFieldIso('leaveSubmitEnd') || start;
  if (start && end && end < start) {
    _leaveSetDateField('leaveSubmitEnd', start);
    end = start;
  }
  if (!start) { durEl.textContent = 'จำนวนวัน: —'; return; }
  const days = _leaveSubmitEstimateDays(start, end, _leaveSubmitMeta.partial || 'full');
  durEl.textContent = days > 0
    ? ('จำนวนวัน: ' + (days % 1 === 0 ? days : days.toFixed(1)) + ' วัน (ไม่นับเสาร์-อาทิตย์)')
    : 'จำนวนวัน: 0 — ช่วงที่เลือกอาจเป็นวันหยุด';
}

function _leaveSubmitEstimateDays(startDate, endDate, partial) {
  try {
    const sp = startDate.split('-').map((n) => parseInt(n, 10));
    const ep = (endDate || startDate).split('-').map((n) => parseInt(n, 10));
    if (sp.length !== 3 || ep.length !== 3) return 0;
    let current = new Date(sp[0], sp[1] - 1, sp[2]);
    const endD = new Date(ep[0], ep[1] - 1, ep[2]);
    let count = 0;
    while (current <= endD) {
      const dow = current.getDay();
      if (dow !== 0 && dow !== 6) count++;
      current.setDate(current.getDate() + 1);
    }
    if (!count) return 0;
    const p = String(partial).toLowerCase();
    if (p === 'full') return count;
    if (count === 1) return 0.5;
    return 0.5 + (count - 1);
  } catch (_) { return 0; }
}

async function submitLeaveRequest() {
  const reasonEl = document.getElementById('leaveSubmitReason');
  const resEl = document.getElementById('leaveSubmitResult');
  const confirmBtn = document.getElementById('leaveSubmitConfirm');
  if (!window.__nkbkAuthFetch) return;
  const type = _leaveSubmitMeta.typeId || '';
  const startDate = _leaveSyncDateFieldFromText('leaveSubmitStart') || _leaveGetDateFieldIso('leaveSubmitStart');
  const endDate = _leaveSyncDateFieldFromText('leaveSubmitEnd') || _leaveGetDateFieldIso('leaveSubmitEnd') || startDate;
  const partial = _leaveSubmitMeta.partial || 'full';
  const reason = reasonEl ? reasonEl.value.trim() : '';
  if (!type || !startDate) {
    if (resEl) resEl.textContent = 'กรุณาเลือกประเภทและวันที่ (รูปแบบ วัน/เดือน/ปี พ.ศ.)';
    return;
  }
  const earliest = _leaveSubmitMeta.earliestRetrospective || '';
  if (earliest && startDate < earliest) {
    if (resEl) resEl.textContent = 'วันที่เริ่มต้นต้องไม่เก่ากว่า ' + _leaveIsoToThaiSlash(earliest);
    return;
  }
  if (endDate < startDate) {
    if (resEl) resEl.textContent = 'วันเริ่มต้นต้องไม่เกินวันสิ้นสุด';
    return;
  }
  if (confirmBtn) confirmBtn.disabled = true;
  if (resEl) resEl.textContent = 'กำลังส่งคำขอ...';
  try {
    const res = await window.__nkbkAuthFetch('/api/monitor-leave-submit', {
    method: 'POST',
      body: JSON.stringify({ type, partial, startDate, endDate, reason })
    });
    const data = await res.json().catch(() => ({ ok: false }));
    if (!data.ok) {
      if (resEl) resEl.textContent = data.message || data.reason || 'ส่งไม่สำเร็จ';
      return;
    }
    closeLeaveSubmitModal();
    if (typeof window.nkbkAlert === 'function') {
      await window.nkbkAlert({
        title: 'ส่งคำขอลาเรียบร้อย',
        message: (data.typeName || 'การลา') + ' จำนวน ' + (data.durationDays || 0) + ' วัน — รอการอนุมัติ',
        variant: 'success'
      });
    }
    refreshLeaveTab();
  } catch (e) {
    if (resEl) resEl.textContent = e.message || String(e);
  } finally {
    if (confirmBtn) confirmBtn.disabled = false;
  }
}

function bindLeaveSubmitModal() {
  const openBtn = document.getElementById('btnLeaveSubmit');
  if (openBtn) openBtn.addEventListener('click', openLeaveSubmitModal);
  const closeBtn = document.getElementById('leaveSubmitModalClose');
  const cancelBtn = document.getElementById('leaveSubmitCancel');
  const backdrop = document.getElementById('leaveSubmitModalBackdrop');
  const confirmBtn = document.getElementById('leaveSubmitConfirm');
  [closeBtn, cancelBtn, backdrop].forEach((el) => {
    if (el) el.addEventListener('click', closeLeaveSubmitModal);
  });
  if (confirmBtn) confirmBtn.addEventListener('click', submitLeaveRequest);
  bindThaiLeaveDateField('leaveSubmitStart', () => {
    const start = _leaveGetDateFieldIso('leaveSubmitStart');
    const end = _leaveGetDateFieldIso('leaveSubmitEnd');
    if (start && end && end < start) _leaveSetDateField('leaveSubmitEnd', start);
    updateLeaveSubmitDurationPreview();
  });
  bindThaiLeaveDateField('leaveSubmitEnd', updateLeaveSubmitDurationPreview);
  const reasonEl = document.getElementById('leaveSubmitReason');
  if (reasonEl) reasonEl.addEventListener('input', updateLeaveSubmitReasonCount);
}

// ----- ใบลา (PDF/Print) -----
async function openLeaveFormWindow(leaveId) {
  try {
    if (!window.__nkbkAuthFetch) { await window.nkbkAlert({ title: 'กรุณาล็อกอินใหม่', variant: 'warning' }); return; }
    const res = await window.__nkbkAuthFetch('/api/monitor-leave-form-data?leaveId=' + encodeURIComponent(leaveId));
    const data = await res.json().catch(() => ({ ok: false }));
    if (!data || !data.ok) {
      await window.nkbkAlert({ title: 'ไม่สามารถดึงข้อมูลใบลา', message: String((data && (data.reason || data.message)) || 'unknown'), variant: 'danger' });
      return;
    }
    const html = buildLeaveFormHtml(data);
    const w = window.open('', '_blank', 'width=900,height=1000,noopener=no');
    if (!w) { await window.nkbkAlert({ title: 'เบราว์เซอร์บล็อก popup', message: 'กรุณาอนุญาต popup ใน Electron', variant: 'warning' }); return; }
    try { w.document.open(); w.document.write(html); w.document.close(); } catch (e) { await window.nkbkAlert({ title: 'เปิดใบลาไม่สำเร็จ', message: e.message, variant: 'danger' }); }
  } catch (e) {
    await window.nkbkAlert({ title: 'เกิดข้อผิดพลาด', message: e.message, variant: 'danger' });
  }
}

function buildLeaveFormHtml(d) {
  const L = d.leave || {};
  const U = d.user || {};
  const A = d.approver || {};
  const bal = Array.isArray(d.balance) ? d.balance : [];
  const userName = String(U.fullname || '-');
  const createdStr = _thaiDateFull(L.createdAtIso);
  const startStr = _thaiDateFull(L.startDate);
  const endStr = _thaiDateFull(L.endDate || L.startDate);
  const approvedLv1Str = _thaiDateFull(L.approvedAtLevel1Iso);
  const approvedLv2Str = _thaiDateFull(L.approvedAtLevel2Iso);
  const durText = _leaveDurationText(L.durationDays);
  const partialText = L.partial === 'AM' ? 'ครึ่งวันเช้า' : (L.partial === 'PM' ? 'ครึ่งวันบ่าย' : 'เต็มวัน');
  const isApproved = String(L.status || '').toLowerCase() === 'approved';
  function _e(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function balanceRows() {
    if (!bal.length) return '';
    return bal.map(t => {
      const u = _leaveDurationText(t.used || 0);
      const r = _leaveDurationText(t.remaining || 0);
      return '<tr><td>' + _e(t.name) + '</td><td style="text-align:center;">' + _e(u) + '</td><td style="text-align:center;">' + _e(r) + '</td></tr>';
    }).join('');
  }
  const lv2ActionLabel = L.acknowledged ? ' (รับทราบ)' : '';
  return '<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>ใบลา - ' + _e(userName) + '</title>' +
    '<style>' +
    '@import url("https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap");' +
    '*{margin:0;padding:0;box-sizing:border-box}' +
    '@page{size:A4;margin:10mm}' +
    'body{font-family:Sarabun,sans-serif;font-size:14px;line-height:1.5;color:#000;background:white}' +
    '.toolbar{position:sticky;top:0;background:#4f46e5;color:#fff;padding:8px 16px;display:flex;gap:8px;align-items:center;justify-content:space-between;box-shadow:0 2px 6px rgba(0,0,0,0.2);z-index:10}' +
    '.toolbar h3{font-weight:600;font-size:16px}' +
    '.toolbar .btns{display:flex;gap:8px}' +
    '.toolbar button{background:rgba(255,255,255,0.2);color:#fff;border:none;padding:6px 14px;border-radius:6px;font-size:13px;cursor:pointer;font-family:Sarabun,sans-serif}' +
    '.toolbar button:hover{background:rgba(255,255,255,0.3)}' +
    '.toolbar button.close{background:rgba(255,255,255,0.15)}' +
    '.page{width:210mm;min-height:297mm;padding:12mm 15mm;margin:0 auto;background:#fff}' +
    '.header{text-align:center;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #333}' +
    '.logo{width:70px;height:70px;margin-bottom:5px}' +
    '.doc-title{font-size:22px;font-weight:700;margin:3px 0}' +
    '.org-name{font-size:14px}' +
    '.date-line{text-align:right;margin-bottom:10px;font-size:13px}' +
    '.letter-line{margin-bottom:6px;font-size:14px}' +
    '.indent{text-indent:50px}' +
    '.detail-box{background:#f9f9f9;border:1px solid #ddd;padding:10px 12px;margin:10px 0;border-radius:5px}' +
    '.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:13px}' +
    '.detail-item{display:flex;gap:6px}' +
    '.detail-label{min-width:85px}' +
    '.detail-full{grid-column:1/-1}' +
    '.balance-section{margin:10px 0}' +
    '.balance-title{font-weight:600;margin-bottom:5px;border-bottom:1px solid #ccc;padding-bottom:3px;font-size:13px}' +
    '.balance-table{width:100%;border-collapse:collapse;font-size:12px}' +
    '.balance-table th{background:#f0f0f0;padding:5px;text-align:left;border:1px solid #ccc}' +
    '.balance-table td{padding:4px 5px;border:1px solid #ccc}' +
    '.closing{text-align:center;margin:30px 0 25px;font-size:14px}' +
    '.signature-requester{text-align:center;margin:10px 0 20px}' +
    '.signature-line{width:150px;border-bottom:1px dotted #333;margin:55px auto 5px}' +
    '.signature-name{font-size:13px}' +
    '.signature-role{font-size:12px;color:#555}' +
    '.signature-date{font-size:11px;color:#555;margin-top:3px}' +
    '.approval-section{border:1px solid #333;padding:10px;margin:15px 0}' +
    '.approval-title{font-weight:600;text-align:center;margin-bottom:10px;border-bottom:1px solid #ccc;padding-bottom:5px;font-size:13px}' +
    '.approval-checkboxes{display:flex;justify-content:center;gap:50px;margin:10px 0;font-size:14px}' +
    '.checkbox{display:inline-flex;align-items:center;gap:6px}' +
    '.checkbox-box{width:16px;height:16px;border:2px solid #333;display:inline-flex;align-items:center;justify-content:center;font-weight:bold;font-size:12px}' +
    '.signature-approvers{display:flex;justify-content:space-between;margin-top:15px}' +
    '.signature-box{text-align:center;width:45%}' +
    '.footer{margin-top:12px;text-align:center;font-size:10px;color:#888;border-top:1px solid #ccc;padding-top:8px}' +
    '@media print{.toolbar{display:none} body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}' +
    '</style></head><body>' +
    '<div class="toolbar"><h3>📄 ใบลา</h3><div class="btns"><button onclick="window.print()">🖨 พิมพ์</button><button class="close" onclick="window.close()">✕ ปิด</button></div></div>' +
    '<div class="page">' +
    '<div class="header"><img src="https://res.cloudinary.com/dzs7zbikj/image/upload/v1770171747/logo_u8uk39.jpg" class="logo" alt="Logo"><div class="doc-title">ใบลา</div><div class="org-name">สหกรณ์ออมทรัพย์สาธารณสุขหนองคาย จำกัด</div></div>' +
    '<div class="date-line">วันที่ ' + _e(createdStr) + '</div>' +
    '<div class="letter-line"><strong>เรียน</strong> ผู้จัดการ</div>' +
    '<div class="letter-line"><strong>เรื่อง</strong> ขอ' + _e(L.typeName) + '</div>' +
    '<p class="letter-line indent" style="margin-top:10px;font-size:14px;">ข้าพเจ้า <strong>' + _e(userName) + '</strong>' +
      (U.position ? ' ตำแหน่ง <strong>' + _e(U.position) + '</strong>' : '') +
      (U.job ? ' งาน <strong>' + _e(U.job) + '</strong>' : '') +
      (U.department ? ' ฝ่าย <strong>' + _e(U.department) + '</strong>' : '') +
    '</p>' +
    '<div class="detail-box"><div class="detail-grid">' +
      '<div class="detail-item"><span class="detail-label">ขอลา:</span><strong>' + _e(L.typeName) + '</strong></div>' +
      '<div class="detail-item"><span class="detail-label">จำนวน:</span><strong>' + _e(durText) + '</strong></div>' +
      '<div class="detail-item"><span class="detail-label">ตั้งแต่วันที่:</span><span>' + _e(startStr) + '</span></div>' +
      '<div class="detail-item"><span class="detail-label">ถึงวันที่:</span><span>' + _e(endStr) + '</span></div>' +
      '<div class="detail-item"><span class="detail-label">ช่วงเวลา:</span><span>' + _e(partialText) + '</span></div>' +
      '<div class="detail-item detail-full"><span class="detail-label">เหตุผล:</span><span>' + _e(L.reason || '-') + '</span></div>' +
    '</div></div>' +
    (bal.length ? '<div class="balance-section"><div class="balance-title">สถิติการลา</div><table class="balance-table"><tr><th>ประเภท</th><th style="text-align:center;width:80px;">ใช้ไป</th><th style="text-align:center;width:80px;">คงเหลือ</th></tr>' + balanceRows() + '</table></div>' : '') +
    '<div class="closing">ขอแสดงความนับถือ</div>' +
    '<div class="signature-requester"><div class="signature-line"></div><div class="signature-name">( ' + _e(userName) + ' )</div><div class="signature-role">ผู้ขอลา</div><div class="signature-date">วันที่ ' + _e(createdStr) + '</div></div>' +
    '<div class="approval-section"><div class="approval-title">ความเห็นผู้บังคับบัญชา</div><div class="approval-checkboxes"><span class="checkbox"><span class="checkbox-box">' + (isApproved ? '✓' : '') + '</span> อนุมัติ</span><span class="checkbox"><span class="checkbox-box">' + (!isApproved ? '✓' : '') + '</span> ไม่อนุมัติ</span></div>' +
    '<div class="signature-approvers">' +
      '<div class="signature-box"><div class="signature-line"></div><div class="signature-name">( ' + _e(A.level2Name || '............................') + ' )</div><div class="signature-role">รองผู้จัดการ' + _e(lv2ActionLabel) + '</div><div class="signature-date">วันที่ ' + _e(approvedLv2Str || '......./......./.......') + '</div></div>' +
      '<div class="signature-box"><div class="signature-line"></div><div class="signature-name">( ' + _e(A.level1Name || '............................') + ' )</div><div class="signature-role">ผู้จัดการ</div><div class="signature-date">วันที่ ' + _e(approvedLv1Str || '......./......./.......') + '</div></div>' +
    '</div></div>' +
    '<div class="footer">เอกสารนี้ออกโดยระบบจัดการวันลา สหกรณ์ออมทรัพย์สาธารณสุขหนองคาย จำกัด | เลขที่อ้างอิง: ' + _e(String(d.leaveId || '').substring(0, 8).toUpperCase()) + '</div>' +
    '</div></body></html>';
}

if (typeof window.electronAPI !== 'undefined') {
  document.body.classList.add('electron');
  const btnMin = el('btnMinimize');
  const btnClose = el('btnClose');
  if (btnMin) btnMin.addEventListener('click', () => window.electronAPI.minimize());
  if (btnClose) btnClose.addEventListener('click', () => window.electronAPI.close());
}

// ============================================================
// Notification system — bell badge, toast, panel
// ============================================================
const NOTIF_SEEN_KEY = 'nkbk_notif_seen_ids';
const NOTIF_POLL_MS = 30000;
let _notifAllItems = [];
let _notifSeenSet = (() => {
  try { return new Set(JSON.parse(localStorage.getItem(NOTIF_SEEN_KEY) || '[]')); } catch (_) { return new Set(); }
})();
function _persistNotifSeen() {
  try {
    const arr = Array.from(_notifSeenSet).slice(-200);
    localStorage.setItem(NOTIF_SEEN_KEY, JSON.stringify(arr));
  } catch (_) {}
}
const _FA_TO_EMOJI = {
  'fa-bell': '🔔', 'fa-info-circle': 'ℹ️', 'fa-check-circle': '✅', 'fa-check': '✅',
  'fa-times-circle': '❌', 'fa-exclamation-triangle': '⚠️', 'fa-exclamation-circle': '❗',
  'fa-bolt': '⚡', 'fa-bullhorn': '📢', 'fa-envelope': '✉️', 'fa-comment': '💬', 'fa-comments': '💬',
  'fa-calendar-check': '📅', 'fa-calendar-day': '📅', 'fa-clock': '🕐',
  'fa-user': '👤', 'fa-user-check': '✅', 'fa-user-shield': '🛡️', 'fa-users': '👥',
  'fa-heart': '❤️', 'fa-star': '⭐', 'fa-flag': '🚩', 'fa-fire': '🔥',
  'fa-gift': '🎁', 'fa-trophy': '🏆', 'fa-tools': '🛠️', 'fa-wrench': '🔧',
  'fa-cog': '⚙️', 'fa-server': '🖥️', 'fa-database': '💾',
  'fa-lock': '🔒', 'fa-unlock': '🔓', 'fa-shield-alt': '🛡️', 'fa-key': '🔑',
  'fa-desktop': '🖥️', 'fa-laptop': '💻', 'fa-mobile-alt': '📱',
  'fa-globe': '🌐', 'fa-wifi': '📶',
  'fa-download': '⬇️', 'fa-upload': '⬆️', 'fa-sync': '🔄', 'fa-power-off': '🔌',
  'fa-thumbs-up': '👍', 'fa-thumbs-down': '👎',
  'fa-coins': '🪙', 'fa-hand-holding-usd': '💵',
  'fa-file-alt': '📄', 'fa-book': '📖',
  'fa-cake-candles': '🎂', 'fa-umbrella-beach': '🏖️'
};
function _notifSeverityIcon(item) {
  const sev = item.severity || 'info';
  if (item.icon) {
    const m = String(item.icon).match(/fa-[a-zA-Z0-9\-]+/);
    if (m && _FA_TO_EMOJI[m[0]]) return _FA_TO_EMOJI[m[0]];
  }
  if (sev === 'success') return '✅';
  if (sev === 'warning') return '⚠️';
  if (sev === 'danger') return '❌';
  return 'ℹ️';
}
function _timeAgoTh(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 60) return 'เมื่อสักครู่';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' นาทีที่แล้ว';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' ชั่วโมงที่แล้ว';
  const d = Math.floor(h / 24);
  if (d < 7) return d + ' วันที่แล้ว';
  return _thaiDateShort(new Date(ms).toISOString());
}
function _escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function showNotifToast(item, opts) {
  // 1) พยายามแสดงเป็น OS native notification (มุมเดสก์ท็อป/Action Center) ก่อนเสมอ
  try {
    if (typeof window.electronAPI !== 'undefined' && typeof window.electronAPI.showNativeNotification === 'function') {
      window.electronAPI.showNativeNotification({
        title: item.title || 'NKBKConnext',
        body: item.body || '',
        severity: item.severity || 'info',
        payload: { id: item.id, relatedType: item.relatedType || '', relatedId: item.relatedId || '' }
      });
      return;
    }
    // 2) ถ้าเบราว์เซอร์รองรับ Web Notifications — ใช้ native ของเบราว์เซอร์
    if (typeof window.Notification !== 'undefined' && window.Notification.permission === 'granted') {
      const n = new window.Notification(item.title || 'NKBKConnext', { body: item.body || '' });
      n.onclick = () => { try { window.focus(); } catch (_) {} };
      return;
    }
  } catch (_) {}
  // 3) Fallback: in-app toast (กรณีที่ Electron Notification หรือ permission ใช้ไม่ได้)
  const stack = document.getElementById('notifToastStack');
  if (!stack) return;
  const duration = (opts && opts.duration) || 8000;
  const toast = document.createElement('div');
  toast.className = 'notif-toast severity-' + (item.severity || 'info');
  toast.innerHTML =
    '<div class="notif-toast-icon">' + _notifSeverityIcon(item) + '</div>' +
    '<div class="notif-toast-body">' +
      '<div class="notif-toast-title">' + _escHtml(item.title || '') + '</div>' +
      (item.body ? '<div class="notif-toast-msg">' + _escHtml(item.body) + '</div>' : '') +
    '</div>' +
    '<button type="button" class="notif-toast-close" aria-label="ปิด">✕</button>';
  stack.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  const close = () => {
    toast.classList.add('hiding');
    toast.classList.remove('show');
    setTimeout(() => { try { toast.remove(); } catch (_) {} }, 400);
  };
  toast.querySelector('.notif-toast-close').addEventListener('click', close);
  setTimeout(close, duration);
}

function renderNotifBadge(unread) {
  const badge = document.getElementById('notifBadge');
  const bell = document.getElementById('btnNotifBell');
  if (!badge || !bell) return;
  if (unread > 0) {
    badge.hidden = false;
    badge.textContent = unread > 99 ? '99+' : String(unread);
    bell.classList.add('has-unread');
      } else {
    badge.hidden = true;
    badge.textContent = '0';
    bell.classList.remove('has-unread');
  }
}

function renderNotifPanel(items) {
  const body = document.getElementById('notifPanelBody');
  const count = document.getElementById('notifPanelCount');
  if (!body) return;
  const unread = items.filter((n) => !n.read).length;
  if (count) count.textContent = String(unread);
  if (!items.length) { body.innerHTML = '<p class="notif-empty">ไม่มีการแจ้งเตือน</p>'; return; }
  body.innerHTML = items.map((n) => (
    '<div class="notif-item severity-' + (n.severity || 'info') + (n.read ? '' : ' unread') + '" data-id="' + _escHtml(n.id) + '">' +
      '<div class="notif-item-icon">' + _notifSeverityIcon(n) + '</div>' +
      '<div class="notif-item-body">' +
        '<div class="notif-item-title">' + _escHtml(n.title || '') + '</div>' +
        (n.body ? '<div class="notif-item-msg">' + _escHtml(n.body) + '</div>' : '') +
        '<div class="notif-item-time">' + _escHtml(_timeAgoTh(n.createdAtMs)) + '</div>' +
      '</div>' +
    '</div>'
  )).join('');
  body.querySelectorAll('.notif-item').forEach((row) => {
    row.addEventListener('click', async () => {
      const id = row.getAttribute('data-id');
      const notif = _notifAllItems.find((x) => x.id === id);
      if (!notif || notif.read) return;
      try {
        await window.__nkbkAuthFetch('/api/monitor-notification-read', {
          method: 'POST', body: JSON.stringify({ ids: [id] })
        });
        notif.read = true;
        row.classList.remove('unread');
      } catch (_) {}
      refreshNotifBadge();
    });
  });
}

function refreshNotifBadge() {
  const unread = _notifAllItems.filter((n) => !n.read).length;
  renderNotifBadge(unread);
}

async function pollNotifications() {
  if (!window.__nkbkAuthFetch) return;
  try {
    const res = await window.__nkbkAuthFetch('/api/monitor-notifications');
    const data = await res.json().catch(() => ({ ok: false }));
    if (!data || !data.ok) return;
    const items = data.items || [];
    _notifAllItems = items;
    // โชว์ toast ตัวใหม่ที่ยังไม่เคยเห็น (เรียงเก่า→ใหม่ แสดงทีละตัวพร้อม delay)
    const fresh = items.filter((n) => !n.read && !_notifSeenSet.has(n.id));
    fresh.reverse();
    fresh.forEach((n, idx) => {
      setTimeout(() => showNotifToast(n), idx * 350);
      _notifSeenSet.add(n.id);
    });
    if (fresh.length > 0) _persistNotifSeen();
    renderNotifBadge(data.unread || items.filter((n) => !n.read).length);
    // ถ้า panel เปิดอยู่ re-render
    const panel = document.getElementById('notifPanel');
    if (panel && !panel.hidden) renderNotifPanel(items);
  } catch (_) {}
}

function openNotifPanel() {
  const panel = document.getElementById('notifPanel');
  if (!panel) return;
  renderNotifPanel(_notifAllItems);
  panel.hidden = false;
}
function closeNotifPanel() {
  const panel = document.getElementById('notifPanel');
  if (panel) panel.hidden = true;
}

document.addEventListener('DOMContentLoaded', () => {
  const bell = document.getElementById('btnNotifBell');
  const close = document.getElementById('btnNotifClose');
  const readAll = document.getElementById('btnNotifReadAll');
  const panel = document.getElementById('notifPanel');
  if (bell) bell.addEventListener('click', () => {
    if (panel && panel.hidden) openNotifPanel(); else closeNotifPanel();
    // โหลดซ้ำเพื่อได้ข้อมูลล่าสุด
    pollNotifications();
  });
  if (close) close.addEventListener('click', closeNotifPanel);
  if (panel) {
    const bd = panel.querySelector('.notif-panel-backdrop');
    if (bd) bd.addEventListener('click', closeNotifPanel);
  }
  if (readAll) readAll.addEventListener('click', async () => {
    try {
      await window.__nkbkAuthFetch('/api/monitor-notification-read', {
        method: 'POST', body: JSON.stringify({ all: true })
      });
      _notifAllItems.forEach((n) => { n.read = true; });
      renderNotifPanel(_notifAllItems);
      refreshNotifBadge();
    } catch (_) {}
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closeNotifPanel();
  });
  // เริ่ม polling
  setTimeout(() => pollNotifications(), 3500);
  setInterval(() => pollNotifications(), NOTIF_POLL_MS);

  // ผู้ใช้คลิกที่ native notification → เปิด panel + สลับแท็บตาม relatedType
  if (typeof window.electronAPI !== 'undefined' && typeof window.electronAPI.onNativeNotificationClick === 'function') {
    window.electronAPI.onNativeNotificationClick((payload) => {
      try {
        if (payload && payload.relatedType === 'leave') {
          const btn = document.querySelector('.tab-nav-btn[data-tab="leave"]');
          if (btn) btn.click();
        } else {
          openNotifPanel();
        }
      } catch (_) {}
    });
  }
});

fetchSystem();
