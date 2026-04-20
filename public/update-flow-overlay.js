/**
 * Overlay เต็มหน้าจอ: กำลังดาวน์โหลดอัปเดต / พร้อมติดตั้ง / ข้อผิดพลาด (Electron + electron-updater)
 */
(function () {
  var api = window.electronAPI;
  if (!api || typeof document === 'undefined' || !document.body) return;

  function esc(s) {
    if (s == null) return '';
    var d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  function fmtBytes(n) {
    var x = Number(n) || 0;
    if (x >= 1073741824) return (x / 1073741824).toFixed(2) + ' GB';
    if (x >= 1048576) return (x / 1048576).toFixed(2) + ' MB';
    if (x >= 1024) return (x / 1024).toFixed(1) + ' KB';
    return x + ' B';
  }

  function fmtMbps(bps) {
    var x = Number(bps) || 0;
    if (x <= 0) return '—';
    return ((x * 8) / 1000000).toFixed(2) + ' Mbps';
  }

  var css =
    '#nkbk-upd-flow{' +
    'position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;' +
    'font-family:Kanit,system-ui,sans-serif;padding:24px;box-sizing:border-box;' +
    'background:rgba(6,8,12,.72);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);' +
    'animation:nkbkUpdFade .35s ease}' +
    '#nkbk-upd-flow.nkbk-upd-on{display:flex}' +
    '@keyframes nkbkUpdFade{from{opacity:0}to{opacity:1}}' +
    '#nkbk-upd-flow .nkbk-upd-card{' +
    'width:100%;max-width:420px;border-radius:20px;padding:2rem 1.75rem 1.75rem;' +
    'background:linear-gradient(145deg,rgba(26,32,44,.96) 0%,rgba(14,18,26,.98) 100%);' +
    'border:1px solid rgba(0,212,170,.22);box-shadow:0 24px 64px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.04) inset,' +
    '0 0 80px rgba(0,212,170,.08);text-align:center;color:#e8eaed}' +
    '#nkbk-upd-flow .nkbk-upd-orb{' +
    'width:88px;height:88px;margin:0 auto 1.25rem;border-radius:50%;position:relative;' +
    'background:radial-gradient(circle at 35% 30%,rgba(0,212,170,.45),rgba(0,212,170,.08) 55%,transparent 70%);' +
    'box-shadow:0 0 40px rgba(0,212,170,.25)}' +
    '#nkbk-upd-flow .nkbk-upd-orb::after{' +
    'content:"";position:absolute;inset:-6px;border-radius:50%;border:2px solid rgba(0,212,170,.35);' +
    'animation:nkbkUpdPulse 1.6s ease-out infinite}' +
    '@keyframes nkbkUpdPulse{0%{transform:scale(1);opacity:.9}100%{transform:scale(1.35);opacity:0}}' +
    '#nkbk-upd-flow .nkbk-upd-ring{' +
    'position:absolute;inset:8px;border-radius:50%;border:3px solid transparent;border-top-color:#00d4aa;' +
    'animation:nkbkUpdSpin .85s linear infinite}' +
    '@keyframes nkbkUpdSpin{to{transform:rotate(360deg)}}' +
    '#nkbk-upd-flow .nkbk-upd-ready-icon{' +
    'width:88px;height:88px;margin:0 auto 1.25rem;border-radius:50%;' +
    'background:linear-gradient(135deg,rgba(0,212,170,.25),rgba(0,212,170,.08));' +
    'display:flex;align-items:center;justify-content:center;font-size:2.75rem;line-height:1}' +
    '#nkbk-upd-flow h2{margin:0 0 .5rem;font-size:1.25rem;font-weight:600;letter-spacing:.02em}' +
    '#nkbk-upd-flow .nkbk-upd-sub{margin:0 0 1.25rem;font-size:.9rem;color:#8b8f99;line-height:1.5}' +
    '#nkbk-upd-flow .nkbk-upd-meter{' +
    'height:10px;border-radius:999px;background:rgba(255,255,255,.06);overflow:hidden;margin-bottom:.65rem}' +
    '#nkbk-upd-flow .nkbk-upd-meter>span{' +
    'display:block;height:100%;width:0%;border-radius:999px;' +
    'background:linear-gradient(90deg,#00b894,#00d4aa,#55efc4);transition:width .2s ease;' +
    'box-shadow:0 0 12px rgba(0,212,170,.5)}' +
    '#nkbk-upd-flow .nkbk-upd-meta{font-size:.8125rem;color:#6b7280;margin-bottom:1.25rem}' +
    '#nkbk-upd-flow .nkbk-upd-actions{display:flex;flex-direction:column;gap:.65rem}' +
    '#nkbk-upd-flow .nkbk-upd-btn{' +
    'width:100%;padding:14px 18px;border-radius:12px;font-family:inherit;font-size:.95rem;font-weight:600;' +
    'cursor:pointer;border:none;transition:transform .12s ease,box-shadow .2s,background .2s}' +
    '#nkbk-upd-flow .nkbk-upd-btn:active{transform:scale(.98)}' +
    '#nkbk-upd-flow .nkbk-upd-btn-primary{' +
    'background:linear-gradient(180deg,#00e6b8,#00c9a0);color:#0d0f14;' +
    'box-shadow:0 4px 20px rgba(0,212,170,.35)}' +
    '#nkbk-upd-flow .nkbk-upd-btn-primary:hover{box-shadow:0 6px 28px rgba(0,212,170,.45)}' +
    '#nkbk-upd-flow .nkbk-upd-btn-secondary{' +
    'background:rgba(255,255,255,.06);color:#c5cad3;border:1px solid rgba(255,255,255,.1)}' +
    '#nkbk-upd-flow .nkbk-upd-btn-secondary:hover{background:rgba(255,255,255,.1)}' +
    '#nkbk-upd-flow.nkbk-upd-err .nkbk-upd-card{border-color:rgba(255,107,107,.35);box-shadow:0 24px 64px rgba(0,0,0,.55),0 0 60px rgba(255,107,107,.08)}' +
    '#nkbk-upd-flow .nkbk-upd-err-icon{' +
    'width:72px;height:72px;margin:0 auto 1rem;border-radius:50%;background:rgba(255,107,107,.15);' +
    'display:flex;align-items:center;justify-content:center;font-size:2rem}';

  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  var root = document.createElement('div');
  root.id = 'nkbk-upd-flow';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML =
    '<div class="nkbk-upd-card">' +
    '<div class="nkbk-upd-panel" data-panel="dl">' +
    '<div class="nkbk-upd-orb"><div class="nkbk-upd-ring" aria-hidden="true"></div></div>' +
    '<h2 id="nkbkUpdTitleDl">กำลังดาวน์โหลดอัปเดต</h2>' +
    '<p class="nkbk-upd-sub" id="nkbkUpdSubDl">โปรดรอสักครู่ อย่าปิดโปรแกรมระหว่างดาวน์โหลด</p>' +
    '<div class="nkbk-upd-meter" aria-hidden="true"><span id="nkbkUpdMeter"></span></div>' +
    '<p class="nkbk-upd-meta" id="nkbkUpdMetaDl">0%</p>' +
    '</div>' +
    '<div class="nkbk-upd-panel" data-panel="ready" style="display:none">' +
    '<div class="nkbk-upd-ready-icon" aria-hidden="true">✓</div>' +
    '<h2 id="nkbkUpdTitleReady">กำลังติดตั้งและเปิดโปรแกรมใหม่</h2>' +
    '<p class="nkbk-upd-sub" id="nkbkUpdSubReady"></p>' +
    '<div class="nkbk-upd-actions">' +
    '<button type="button" class="nkbk-upd-btn nkbk-upd-btn-primary" id="nkbkUpdBtnRestart" style="display:none">รีสตาร์ทและติดตั้ง</button>' +
    '</div></div>' +
    '<div class="nkbk-upd-panel" data-panel="err" style="display:none">' +
    '<div class="nkbk-upd-err-icon" aria-hidden="true">!</div>' +
    '<h2>ดาวน์โหลดอัปเดตไม่สำเร็จ</h2>' +
    '<p class="nkbk-upd-sub" id="nkbkUpdErrMsg"></p>' +
    '<div class="nkbk-upd-actions">' +
    '<button type="button" class="nkbk-upd-btn nkbk-upd-btn-primary" id="nkbkUpdBtnDismiss">ตกลง</button>' +
    '</div></div></div>';
  document.body.appendChild(root);

  var meter = document.getElementById('nkbkUpdMeter');
  var metaDl = document.getElementById('nkbkUpdMetaDl');
  var subReady = document.getElementById('nkbkUpdSubReady');
  var errMsg = document.getElementById('nkbkUpdErrMsg');
  var btnRestart = document.getElementById('nkbkUpdBtnRestart');
  var btnDismiss = document.getElementById('nkbkUpdBtnDismiss');
  var autoInstalledOnce = false;

  function panel(name) {
    var nodes = root.querySelectorAll('.nkbk-upd-panel');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].style.display = nodes[i].getAttribute('data-panel') === name ? 'block' : 'none';
    }
  }

  function applyState(s) {
    if (!s || s.phase === 'idle') {
      root.classList.remove('nkbk-upd-on', 'nkbk-upd-err');
      root.setAttribute('aria-hidden', 'true');
      try {
        document.body.style.overflow = '';
      } catch (_) {}
      return;
    }
    root.classList.add('nkbk-upd-on');
    root.setAttribute('aria-hidden', 'false');
    try {
      document.body.style.overflow = 'hidden';
    } catch (_) {}

    if (s.phase === 'downloading') {
      root.classList.remove('nkbk-upd-err');
      panel('dl');
      var pct = typeof s.percent === 'number' ? s.percent : 0;
      if (meter) meter.style.width = pct + '%';
      var v = s.version ? 'เวอร์ชัน ' + esc(s.version) : '';
      var line =
        '<strong style="color:#00d4aa">' +
        pct +
        '%</strong>' +
        (v ? ' · ' + v : '') +
        '<br><span style="color:#6b7280;font-size:.8rem">';
      var tr = s.transferred || 0;
      var tot = s.total || 0;
      if (tot > 0) line += fmtBytes(tr) + ' / ' + fmtBytes(tot);
      else line += fmtBytes(tr) + ' ดาวน์โหลดแล้ว';
      line += ' · ' + fmtMbps(s.bytesPerSecond) + '</span>';
      if (metaDl) metaDl.innerHTML = line;
      return;
    }

    if (s.phase === 'ready') {
      root.classList.remove('nkbk-upd-err');
      panel('ready');
      var rv = s.version ? String(s.version).trim() : '';
      if (subReady) {
        subReady.innerHTML =
          'ดาวน์โหลดครบแล้ว' +
          (rv ? ' <strong style="color:#00d4aa">v' + esc(rv.replace(/^v/i, '')) + '</strong>' : '') +
          '<br>ระบบจะปิดโปรแกรม ติดตั้ง และเปิดใหม่อัตโนมัติ…';
      }
      // ติดตั้งอัตโนมัติหลังโหลดเสร็จ (เปิดแอปใหม่หลังติดตั้งสำเร็จ)
      if (!autoInstalledOnce) {
        autoInstalledOnce = true;
        setTimeout(function () {
          try {
            if (api.quitAndInstallAppUpdate) api.quitAndInstallAppUpdate();
          } catch (_) {}
        }, 1200);
      }
      return;
    }

    if (s.phase === 'error') {
      root.classList.add('nkbk-upd-err');
      panel('err');
      if (errMsg) errMsg.textContent = s.message || 'เกิดข้อผิดพลาด';
    }
  }

  if (btnRestart) {
    btnRestart.addEventListener('click', function () {
      if (api.quitAndInstallAppUpdate) api.quitAndInstallAppUpdate();
    });
  }
  if (btnDismiss) {
    btnDismiss.addEventListener('click', function () {
      if (api.dismissAppUpdateFlow) api.dismissAppUpdateFlow();
    });
  }

  if (api.onAppUpdateFlow) {
    api.onAppUpdateFlow(applyState);
  }
  if (api.getAppUpdateFlowState) {
    api.getAppUpdateFlowState().then(applyState).catch(function () {});
  }
})();
