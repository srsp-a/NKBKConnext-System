const API = '/api/system';
let refreshTimer = null;
let fetchInProgress = false;

const el = (id) => document.getElementById(id);

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
  if (statusEl) statusEl.textContent = 'เชื่อมต่อแล้ว (auto update)';
  if (footerDot) {
    footerDot.className = 'status-dot footer-status-dot status-ok';
  }
}

async function fetchSystem() {
  if (fetchInProgress) return;
  fetchInProgress = true;
  try {
    const res = await fetch(API);
    if (!res.ok) throw new Error(res.statusText);
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

el('btnRefresh').addEventListener('click', () => fetchSystem());

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
const NAS_DEFAULT_UNC = '\\\\NKBKCOOP-DRIVE\\home';
function loadNasSaved() {
  try {
    const raw = localStorage.getItem(NAS_STORAGE_KEY);
    if (nasUncPath) nasUncPath.value = NAS_DEFAULT_UNC;
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.remember !== false && data.uncPath && nasUncPath) nasUncPath.value = data.uncPath;
    if (data.remember !== false && data.username != null && nasUsername) nasUsername.value = data.username;
    if (data.remember !== false && data.password != null && nasPassword) nasPassword.value = data.password;
    if (nasRemember) nasRemember.checked = data.remember !== false;
  } catch (_) {
    if (nasUncPath) nasUncPath.value = NAS_DEFAULT_UNC;
  }
}
function saveNasSaved(uncPath, username, password, remember) {
  if (!remember) {
    try { localStorage.removeItem(NAS_STORAGE_KEY); } catch (_) {}
    return;
  }
  try {
    localStorage.setItem(NAS_STORAGE_KEY, JSON.stringify({
      uncPath: uncPath || '',
      username: username || '',
      password: password || '',
      remember: true
    }));
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
    const uncPath = (nasUncPath && nasUncPath.value) ? nasUncPath.value.trim() : '';
    const username = (nasUsername && nasUsername.value) ? nasUsername.value.trim() : '';
    const password = nasPassword ? nasPassword.value : '';
    if (!uncPath || !username) {
      if (nasResult) {
        nasResult.className = 'nas-result error';
        nasResult.textContent = 'กรุณาระบุ UNC Path และชื่อผู้ใช้';
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
      if (data.ok && nasRemember && nasRemember.checked) saveNasSaved(uncPath, username, password, true);
      if (btnNasOpenDrive) btnNasOpenDrive.classList.toggle('nas-open-hidden', !data.ok);
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

const WEB_STORAGE_KEY = 'web_connect';
const WEB_DEFAULT_URL = 'http://oa.nkbkcoop.com/nkh';
const WEB_DEFAULT_DB = 'isconkh_SQL';
const webUrl = el('webUrl');
const webDatabase = el('webDatabase');
const webUsername = el('webUsername');
const webPassword = el('webPassword');
const webRemember = el('webRemember');
const webResult = el('webResult');
const btnWebOpen = el('btnWebOpen');

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
}
loadWebSaved();

if (webRemember) {
  webRemember.addEventListener('change', () => {
    if (!webRemember.checked) saveWebSaved(null, null, null, null, false);
  });
}

if (btnWebOpen) {
  btnWebOpen.addEventListener('click', async () => {
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
    if (webResult) { webResult.textContent = 'กำลังเปิด...'; webResult.className = 'nas-result'; }
    try {
      const res = await fetch('/api/open-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, username, password })
      });
      const data = await res.json();
      if (webResult) {
        webResult.className = 'nas-result ' + (data.ok ? 'success' : 'error');
        webResult.textContent = data.ok ? '✓ เปิดเว็บไซต์แล้ว' : '✗ ' + (data.message || 'เปิดไม่สำเร็จ');
      }
    } catch (err) {
      if (webResult) {
        webResult.className = 'nas-result error';
        webResult.textContent = '✗ ผิดพลาด: ' + err.message;
      }
    }
  });
}

const btnWebOpenInApp = el('btnWebOpenInApp');
if (btnWebOpenInApp) {
  if (typeof window.electronAPI === 'undefined' || !window.electronAPI.openWebviewLogin) {
    btnWebOpenInApp.style.display = 'none';
  } else {
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

// ----- ระบบตรวจสอบ led-ck.com -----
const LEDCK_URL = 'https://led-ck.com/';
const LEDCK_STORAGE_KEY = 'web_connect_ledck';
const ledckUsername = el('ledckUsername');
const ledckPassword = el('ledckPassword');
const ledckRemember = el('ledckRemember');
const ledckResult = el('ledckResult');
const btnLedckOpen = el('btnLedckOpen');
const btnLedckOpenInApp = el('btnLedckOpenInApp');

function loadLedckSaved() {
  try {
    const raw = localStorage.getItem(LEDCK_STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.remember !== false && data.username != null && ledckUsername) ledckUsername.value = data.username;
    if (data.remember !== false && data.password != null && ledckPassword) ledckPassword.value = data.password;
    if (ledckRemember) ledckRemember.checked = data.remember !== false;
  } catch (_) {}
}
function saveLedckSaved(username, password, remember) {
  if (!remember) {
    try { localStorage.removeItem(LEDCK_STORAGE_KEY); } catch (_) {}
    return;
  }
  try {
    localStorage.setItem(LEDCK_STORAGE_KEY, JSON.stringify({
      username: username || '',
      password: password || '',
      remember: true
    }));
  } catch (_) {}
}
loadLedckSaved();

if (ledckRemember) {
  ledckRemember.addEventListener('change', () => {
    if (!ledckRemember.checked) saveLedckSaved(null, null, false);
  });
}

if (btnLedckOpen) {
  btnLedckOpen.addEventListener('click', async () => {
    const username = (ledckUsername && ledckUsername.value) ? ledckUsername.value : '';
    const password = (ledckPassword && ledckPassword.value) ? ledckPassword.value : '';
    if (ledckRemember && ledckRemember.checked) saveLedckSaved(username, password, true);
    if (ledckResult) { ledckResult.textContent = 'กำลังเปิด...'; ledckResult.className = 'nas-result'; }
    try {
      const res = await fetch('/api/open-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: LEDCK_URL, username, password })
      });
      const data = await res.json();
      if (ledckResult) {
        ledckResult.className = 'nas-result ' + (data.ok ? 'success' : 'error');
        ledckResult.textContent = data.ok ? '✓ เปิดเว็บไซต์แล้ว' : '✗ ' + (data.message || 'เปิดไม่สำเร็จ');
      }
    } catch (err) {
      if (ledckResult) {
        ledckResult.className = 'nas-result error';
        ledckResult.textContent = '✗ ผิดพลาด: ' + err.message;
      }
    }
  });
}

if (btnLedckOpenInApp) {
  if (typeof window.electronAPI === 'undefined' || !window.electronAPI.openWebviewLogin) {
    btnLedckOpenInApp.style.display = 'none';
  } else {
    btnLedckOpenInApp.addEventListener('click', () => {
      const username = (ledckUsername && ledckUsername.value) ? ledckUsername.value : '';
      const password = (ledckPassword && ledckPassword.value) ? ledckPassword.value : '';
      if (ledckRemember && ledckRemember.checked) saveLedckSaved(username, password, true);
      if (ledckResult) {
        ledckResult.className = 'nas-result success';
        ledckResult.textContent = '✓ กำลังเปิดในแอป...';
      }
      window.electronAPI.openWebviewLogin({
        url: LEDCK_URL,
        database: '',
        username,
        password
      });
    });
  }
}

// ---------- ตรวจสอบบังคับคดี (ระบบโคลน led-ck.com) - ไม่ต้องล็อกอิน ----------
const ledckTableBody = el('ledckTableBody');
const ledckTableEmpty = el('ledckTableEmpty');

function ledckLoadMembers() {
  const search = (el('ledckSearch') && el('ledckSearch').value) ? el('ledckSearch').value.trim() : '';
  const status = (el('ledckStatusFilter') && el('ledckStatusFilter').value) ? el('ledckStatusFilter').value : '';
  const q = new URLSearchParams();
  if (search) q.set('search', search);
  if (status) q.set('status', status);
  fetch('/api/ledck/members?' + q.toString())
    .then((r) => r.json())
    .then((data) => {
      if (data.ok && data.members) ledckRenderTable(data.members);
    })
    .catch(() => { if (ledckTableBody) ledckTableBody.innerHTML = ''; if (ledckTableEmpty) ledckTableEmpty.style.display = 'block'; });
}

function ledckRenderTable(members) {
  if (!ledckTableBody) return;
  if (!members || members.length === 0) {
    ledckTableBody.innerHTML = '';
    if (ledckTableEmpty) ledckTableEmpty.style.display = 'block';
    return;
  }
  if (ledckTableEmpty) ledckTableEmpty.style.display = 'none';
  const fmtDate = (d) => {
    if (!d) return '—';
    try { const x = new Date(d); return x.toLocaleDateString('th-TH') + ' ' + x.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }); } catch (_) { return d; }
  };
  ledckTableBody.innerHTML = members.map((m) => {
    const statusCls = (m.status === 'ล้มละลาย') ? 'ledck-status-bad' : (m.status === 'ปกติ') ? 'ledck-status-ok' : '';
    return `<tr>
      <td>${escapeHtml(m.fullName || '—')}</td>
      <td><span class="ledck-status ${statusCls}">${escapeHtml(m.status || '—')}</span></td>
      <td>${fmtDate(m.lastChecked)}</td>
      <td>
        <button type="button" class="btn-test btn-small ledck-btn-check" data-member-id="${escapeHtml(m.id)}" data-id-card="${escapeHtml(m.idCard || '')}" title="ตรวจสอบ">⚖️ ตรวจสอบ</button>
        <button type="button" class="btn-test btn-small btn-edit" data-member-id="${escapeHtml(m.id)}" title="แก้ไข">แก้ไข</button>
        <button type="button" class="btn-test btn-small btn-delete" data-member-id="${escapeHtml(m.id)}" title="ลบ">ลบ</button>
      </td>
    </tr>`;
  }).join('');
  ledckTableBody.querySelectorAll('.ledck-btn-check').forEach((btn) => {
    btn.addEventListener('click', () => { ledckOpenStatusModal(btn.getAttribute('data-member-id'), btn.getAttribute('data-id-card')); });
  });
  ledckTableBody.querySelectorAll('.btn-edit').forEach((btn) => {
    btn.addEventListener('click', () => { ledckOpenMemberModal(btn.getAttribute('data-member-id')); });
  });
  ledckTableBody.querySelectorAll('.btn-delete').forEach((btn) => {
    btn.addEventListener('click', () => { if (confirm('ต้องการลบสมาชิกนี้?')) ledckDeleteMember(btn.getAttribute('data-member-id')); });
  });
}

function ledckOpenStatusModal(memberId, idCard) {
  fetch('/api/ledck/check-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(memberId ? { memberId } : { idCard })
  })
    .then((r) => r.json())
    .then((data) => {
      if (!data.ok) return;
      const r = data.result || {};
      const isNormal = (r.status || '') === 'ปกติ';
      const badgeClass = (r.status === 'ล้มละลาย') ? 'ledck-status-bad' : (isNormal ? 'ledck-status-ok' : '');
      const title = el('ledckModalStatusTitle');
      const body = el('ledckModalStatusBody');
      if (title) title.textContent = 'สถานะบังคับคดี: ' + (r.fullName || '—');
      if (body) {
        const viewCaseHtml = isNormal ? '' : `<button type="button" class="btn-test" id="ledckBtnViewCase" data-id-card="${escapeHtml(r.idCard || '')}">ดูรายละเอียดคดี</button>`;
        body.innerHTML = `
          <div class="ledck-detail-row"><span class="label">ชื่อ - นามสกุล</span><span>${escapeHtml(r.fullName || '—')}</span></div>
          <div class="ledck-detail-row"><span class="label">เลขบัตรประชาชน</span><span>${escapeHtml(r.idCard || '—')}</span></div>
          <div class="ledck-detail-row"><span class="label">สถานะบังคับคดี</span><span class="ledck-status-badge ${badgeClass}">${escapeHtml(r.status || '—')}</span></div>
          <div class="ledck-detail-row"><span class="label">ตรวจสอบล่าสุด</span><span>${escapeHtml(r.lastChecked ? new Date(r.lastChecked).toLocaleString('th-TH') : '—')}</span></div>
          <div class="ledck-modal-actions">
            ${viewCaseHtml}
            <button type="button" class="btn-test btn-recheck" id="ledckBtnRecheck" data-member-id="${escapeHtml(memberId || '')}" data-id-card="${escapeHtml(r.idCard || '')}">ตรวจสอบอีกครั้ง</button>
          </div>`;
        const viewCaseBtn = body.querySelector('#ledckBtnViewCase');
        if (viewCaseBtn) viewCaseBtn.addEventListener('click', () => { ledckCloseModal('ledckModalStatus'); ledckOpenCaseModal(viewCaseBtn.getAttribute('data-id-card')); });
        const recheckBtn = body.querySelector('#ledckBtnRecheck');
        if (recheckBtn) recheckBtn.addEventListener('click', () => {
          const mid = recheckBtn.getAttribute('data-member-id') || null;
          const id = recheckBtn.getAttribute('data-id-card') || null;
          ledckCloseModal('ledckModalStatus');
          ledckOpenStatusModal(mid || undefined, id || undefined);
        });
      }
      ledckOpenModal('ledckModalStatus');
    });
}

function ledckOpenCaseModal(idCard) {
  if (!idCard) return;
  fetch('/api/ledck/case/' + encodeURIComponent(idCard))
    .then((r) => r.json())
    .then((data) => {
      if (!data.ok || !data.case) return;
      const c = data.case;
      const title = el('ledckModalCaseTitle');
      const body = el('ledckModalCaseBody');
      if (title) title.textContent = 'รายละเอียดคดี - ข้อมูลบังคับคดีและล้มละลาย ' + (c.defendantName || '');
      if (body) {
        body.innerHTML = `
          <div class="ledck-case-table-wrap">
            <table class="ledck-case-table">
              <tr><td class="label">เลขที่รับ / ปีที่รับ</td><td>${escapeHtml(c.receptionNo + ' / ' + c.receptionYear)}</td></tr>
              <tr><td class="label">บัตรประชาชน</td><td>${escapeHtml(c.idCard)}</td></tr>
              <tr><td class="label">ชื่อ - นามสกุลจำเลย</td><td>${escapeHtml(c.defendantName)}</td></tr>
              <tr><td class="label">ชื่อศาล</td><td>${escapeHtml(c.courtName)}</td></tr>
              <tr><td class="label">คดีหมายเลขดำ</td><td>${escapeHtml(c.blackCaseNo)}</td></tr>
              <tr><td class="label">คดีหมายเลขแดง</td><td>${escapeHtml(c.redCaseNo)}</td></tr>
              <tr><td class="label">โจทก์</td><td>${escapeHtml(c.plaintiff)}</td></tr>
              <tr><td class="label">จำเลย</td><td>${escapeHtml((c.defendants || []).join(', '))}</td></tr>
              <tr><td class="label">ทุนทรัพย์ (มูลหนี้ตามหมาย)</td><td>${escapeHtml(c.debtAmount)}</td></tr>
              <tr><td class="label">วัน-เดือน-ปี ที่ฟ้อง</td><td>${escapeHtml(c.filingDate)}</td></tr>
              <tr><td class="label">อัปเดตข้อมูลล่าสุด</td><td>${escapeHtml(c.lastUpdate)}</td></tr>
            </table>
          </div>`;
      }
      ledckOpenModal('ledckModalCase');
    });
}

function ledckOpenModal(id) {
  const modal = el(id);
  if (modal) { modal.setAttribute('aria-hidden', 'false'); modal.classList.add('ledck-modal-open'); }
}
function ledckCloseModal(id) {
  const modal = el(id);
  if (modal) { modal.setAttribute('aria-hidden', 'true'); modal.classList.remove('ledck-modal-open'); }
}

function ledckOpenMemberModal(memberId) {
  window._ledckEditId = memberId || null;
  const title = el('ledckModalMemberTitle');
  if (title) title.textContent = memberId ? 'แก้ไขสมาชิก' : 'เพิ่มสมาชิก';
  const idCard = el('ledckMemberIdCard');
  const fullName = el('ledckMemberFullName');
  const resultEl = el('ledckMemberResult');
  if (resultEl) resultEl.textContent = '';
  if (idCard) idCard.value = '';
  if (fullName) fullName.value = '';
  if (memberId) {
    fetch('/api/ledck/members?' + new URLSearchParams({ search: '' }))
      .then((r) => r.json())
      .then((data) => {
        const m = (data.members || []).find((x) => x.id === memberId);
        if (m) {
          if (idCard) idCard.value = m.idCard || '';
          if (fullName) fullName.value = m.fullName || '';
        }
        ledckOpenModal('ledckModalMember');
      });
  } else {
    ledckOpenModal('ledckModalMember');
  }
}

function ledckSaveMember() {
  const idCard = (el('ledckMemberIdCard') && el('ledckMemberIdCard').value) ? el('ledckMemberIdCard').value.trim() : '';
  const fullName = (el('ledckMemberFullName') && el('ledckMemberFullName').value) ? el('ledckMemberFullName').value.trim() : '';
  const resultEl = el('ledckMemberResult');
  const editId = window._ledckEditId;
  const url = editId ? '/api/ledck/members/' + encodeURIComponent(editId) : '/api/ledck/members';
  const method = editId ? 'PUT' : 'POST';
  const body = { idCard, fullName };
  if (resultEl) { resultEl.textContent = 'กำลังบันทึก...'; resultEl.className = 'ledck-member-result'; }
  fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then((r) => {
      if (!r.ok) return r.json().then((d) => Promise.reject(new Error(d.message || 'บันทึกไม่สำเร็จ')));
      return r.json();
    })
    .then((data) => {
      if (data.ok) {
        if (resultEl) { resultEl.textContent = 'บันทึกเรียบร้อย'; resultEl.className = 'ledck-member-result success'; }
        ledckCloseModal('ledckModalMember');
        ledckLoadMembers();
      } else {
        if (resultEl) { resultEl.textContent = data.message || 'บันทึกไม่สำเร็จ'; resultEl.className = 'ledck-member-result error'; }
      }
    })
    .catch((err) => {
      if (resultEl) { resultEl.textContent = err.message || 'เกิดข้อผิดพลาด'; resultEl.className = 'ledck-member-result error'; }
    });
}

function ledckDeleteMember(id) {
  fetch('/api/ledck/members/' + encodeURIComponent(id), { method: 'DELETE' })
    .then((r) => r.json())
    .then((data) => { if (data.ok) ledckLoadMembers(); });
}

if (el('ledckBtnSearch')) el('ledckBtnSearch').addEventListener('click', () => ledckLoadMembers());
if (el('ledckBtnClearFilter')) {
  el('ledckBtnClearFilter').addEventListener('click', () => {
    if (el('ledckSearch')) el('ledckSearch').value = '';
    if (el('ledckStatusFilter')) el('ledckStatusFilter').value = '';
    ledckLoadMembers();
  });
}
if (el('ledckBtnAddMember')) el('ledckBtnAddMember').addEventListener('click', () => ledckOpenMemberModal(null));
if (el('ledckModalMemberSave')) el('ledckModalMemberSave').addEventListener('click', () => ledckSaveMember());
if (el('ledckModalMemberCancel')) el('ledckModalMemberCancel').addEventListener('click', () => ledckCloseModal('ledckModalMember'));
if (el('ledckModalMemberClose')) el('ledckModalMemberClose').addEventListener('click', () => ledckCloseModal('ledckModalMember'));

if (el('ledckBtnCheckStatus')) {
  el('ledckBtnCheckStatus').addEventListener('click', () => {
    const idCard = prompt('กรอกเลขบัตรประชาชนที่ต้องการตรวจสอบ:');
    if (idCard && idCard.trim()) ledckOpenStatusModal(null, idCard.trim());
  });
}

el('ledckModalStatusClose') && el('ledckModalStatusClose').addEventListener('click', () => ledckCloseModal('ledckModalStatus'));
el('ledckModalCaseClose') && el('ledckModalCaseClose').addEventListener('click', () => ledckCloseModal('ledckModalCase'));
el('ledckModalCaseCloseBtn') && el('ledckModalCaseCloseBtn').addEventListener('click', () => ledckCloseModal('ledckModalCase'));
document.querySelectorAll('#ledckModalStatus .ledck-modal-backdrop, #ledckModalCase .ledck-modal-backdrop, #ledckModalMember .ledck-modal-backdrop').forEach((b) => {
  b.addEventListener('click', () => {
    ledckCloseModal('ledckModalStatus'); ledckCloseModal('ledckModalCase'); ledckCloseModal('ledckModalMember');
  });
});

  document.querySelectorAll('.tab-nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.getAttribute('data-tab');
    document.querySelectorAll('.tab-nav-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    const panel = document.getElementById('panel-' + tab);
    if (panel) panel.classList.add('active');
    if (tab === 'ledck') ledckLoadMembers();
  });
});

if (typeof window.electronAPI !== 'undefined') {
  document.body.classList.add('electron');
  const btnMin = el('btnMinimize');
  const btnClose = el('btnClose');
  if (btnMin) btnMin.addEventListener('click', () => window.electronAPI.minimize());
  if (btnClose) btnClose.addEventListener('click', () => window.electronAPI.close());
}

fetchSystem();
