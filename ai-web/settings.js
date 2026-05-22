(function () {
  'use strict';

  const el = (id) => document.getElementById(id);
  let settingsData = null;
  let saveTimer = null;
  let memoryFileIds = [];
  let memoryFileLabels = {};
  let libraryPickerSelected = new Set();
  let libraryPickerItems = [];
  let libraryPickerQuery = '';
  let libraryPickerMode = 'memory';
  let libraryPickerAttachHandler = null;
  let assistantDisplayName = window.__nkbkAiDisplayName || 'โมเน่';

  function normalizeAssistantDisplayName(name) {
    return String(name || 'โมเน่')
      .replace(/^ChatGPT\s*/i, '')
      .replace(/^Chat\s*/i, '')
      .replace(/^น้อง/i, '')
      .trim() || 'โมเน่';
  }

  function an() {
    return assistantDisplayName;
  }

  function applyBranding(name) {
    assistantDisplayName = normalizeAssistantDisplayName(name);
    window.__nkbkAiDisplayName = assistantDisplayName;
    if (el('labelCallName')) el('labelCallName').textContent = 'ชื่อที่ ' + an() + ' เรียกคุณ';
    if (el('labelStandingInstructions')) {
      el('labelStandingInstructions').textContent = 'คำสั่งที่ต้องการให้ ' + an() + ' จำ';
    }
    if (el('settingsMemoryFilesTitle')) {
      el('settingsMemoryFilesTitle').textContent = 'ไฟล์ที่ต้องการให้ ' + an() + ' จำ';
    }
    if (el('settingsMemoryFilesDesc')) {
      el('settingsMemoryFilesDesc').textContent =
        'อัปโหลดหรือเลือกจากไลบรารี — ตั้งชื่อเรียกแต่ละไฟล์เพื่อให้' +
        an() +
        'เรียกใช้ได้ เช่น "โลโก้สหกรรม"';
    }
    if (el('libraryPickerSub')) {
      el('libraryPickerSub').textContent = 'เลือกไฟล์ที่ต้องการให้' + an() + 'จำไว้';
    }
    const about = el('nkbkAiAboutYouInput');
    if (about) about.placeholder = 'บอก' + an() + 'เกี่ยวกับงาน ความสนใจ หรือสิ่งที่ควรรู้';
    if (settingsData) {
      renderNotifications(settingsData.preferences || {});
      if (el('settingsMemoryToggles') || el('settingsMemoryFilesList')) {
        renderPersonalize(settingsData);
      }
      const loc = el('settingsDataLocation');
      if (loc) renderDataControl(settingsData);
    }
  }

  function setAssistantDisplayName(name) {
    applyBranding(name);
  }

  function token() {
    try {
      return sessionStorage.getItem('nkbk_ai_token') || '';
    } catch (_) {
      return '';
    }
  }

  function headers() {
    return { 'Content-Type': 'application/json', 'X-Monitor-Token': token() };
  }

  async function apiGet(path) {
    const r = await fetch(path, { headers: headers(), cache: 'no-store' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) throw new Error(data.message || 'โหลดไม่สำเร็จ');
    return data;
  }

  async function apiPost(path, body) {
    const r = await fetch(path, { method: 'POST', headers: headers(), body: JSON.stringify(body || {}) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) throw new Error(data.message || 'บันทึกไม่สำเร็จ');
    return data;
  }

  function fmtBytes(n) {
    const b = Number(n) || 0;
    if (b >= 1024 * 1024 * 1024) return (b / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
    if (b >= 1024) return (b / 1024).toFixed(0) + ' KB';
    return b + ' B';
  }

  function fmtDate(ts) {
    if (!ts) return '-';
    try {
      return new Date(ts).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
    } catch (_) {
      return '-';
    }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function applyThemeFromPref(themePref) {
    const pref = themePref || localStorage.getItem('nkbk_ai_theme') || 'system';
    localStorage.setItem('nkbk_ai_theme', pref);
    let resolved = pref;
    if (pref === 'system') {
      resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.body.classList.toggle('theme-light', resolved === 'light');
    document.body.classList.toggle('theme-dark', resolved === 'dark');
    window.dispatchEvent(new CustomEvent('nkbk-ai-theme-change', { detail: { theme: pref, resolved } }));
  }

  function themeLabel(pref) {
    if (pref === 'dark') return 'โหมดมืด';
    if (pref === 'system') return 'ระบบ';
    return 'โหมดสว่าง';
  }

  function setPanel(panel) {
    const modal = el('nkbkAiSettingsModal');
    if (!modal) return;
    modal.querySelectorAll('[data-settings-nav]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute('data-settings-nav') === panel);
    });
    modal.querySelectorAll('[data-settings-panel]').forEach((node) => {
      node.classList.toggle('hidden', node.getAttribute('data-settings-panel') !== panel);
    });
  }

  function buildToggleRow(id, label, desc, checked) {
    return (
      '<div class="nkbk-ai-settings-toggle-row">' +
      '<div class="nkbk-ai-settings-toggle-text">' +
      '<div class="nkbk-ai-settings-toggle-label">' +
      esc(label) +
      '</div>' +
      (desc ? '<div class="nkbk-ai-settings-toggle-desc">' + esc(desc) + '</div>' : '') +
      '</div>' +
      '<label class="nkbk-ai-switch">' +
      '<input type="checkbox" id="' +
      esc(id) +
      '"' +
      (checked ? ' checked' : '') +
      '>' +
      '<span class="nkbk-ai-switch-slider"></span></label></div>'
    );
  }

  const NOTIFY_SOUNDS = {
    chime: { label: 'กระดิ่ง', file: '/sounds/notify-chime.mp3', hint: 'เบา สดใส' },
    pop: { label: 'ป๊อป', file: '/sounds/notify-pop.mp3', hint: 'สั้น กระชับ' },
    soft: { label: 'นุ่มนวล', file: '/sounds/notify-soft.mp3', hint: 'นุ่ม ไม่รบกวน' },
    bell: { label: 'เบล', file: '/sounds/notify-bell.mp3', hint: 'ชัด เป็นทางการ' }
  };
  const notifyAudioCache = Object.create(null);
  let notifyAudioPlaying = null;

  function resolveNotifySoundId(id) {
    return NOTIFY_SOUNDS[id] ? id : 'chime';
  }

  function getSelectedNotifySoundId() {
    const active = document.querySelector('.nkbk-ai-sound-chip.is-active');
    if (active) return resolveNotifySoundId(active.getAttribute('data-sound'));
    if (window.__nkbkAiUserPrefs && window.__nkbkAiUserPrefs.notifySoundId) {
      return resolveNotifySoundId(window.__nkbkAiUserPrefs.notifySoundId);
    }
    return 'chime';
  }

  function getNotifyAudio(id) {
    const sid = resolveNotifySoundId(id);
    if (!notifyAudioCache[sid]) {
      const audio = new Audio(NOTIFY_SOUNDS[sid].file);
      audio.preload = 'auto';
      notifyAudioCache[sid] = audio;
    }
    return notifyAudioCache[sid];
  }

  function preloadNotifySounds() {
    Object.keys(NOTIFY_SOUNDS).forEach((id) => {
      try {
        getNotifyAudio(id).load();
      } catch (_) {}
    });
  }

  async function playNotificationSound(soundId) {
    const id = resolveNotifySoundId(soundId || getSelectedNotifySoundId());
    const meta = NOTIFY_SOUNDS[id] || NOTIFY_SOUNDS.chime;
    try {
      if (notifyAudioPlaying) {
        notifyAudioPlaying.pause();
        notifyAudioPlaying.currentTime = 0;
      }
      let audio = getNotifyAudio(id);
      audio.pause();
      audio.currentTime = 0;
      audio.volume = 0.82;
      notifyAudioPlaying = audio;
      await audio.play();
      return;
    } catch (_) {}
    try {
      const res = await fetch(meta.file, { cache: 'force-cache' });
      if (!res.ok) throw new Error('fetch failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.volume = 0.82;
      notifyAudioPlaying = audio;
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (_) {}
  }

  const THEME_CARD_ICONS = {
    light:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>',
    dark:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5z"/></svg>',
    system:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>'
  };

  function renderThemePicker(pref) {
    const box = el('settingsThemePicker');
    if (!box) return;
    const cur = pref || 'system';
    const opts = [
      { id: 'light', label: 'สว่าง', desc: 'พื้นหลังสว่าง อ่านง่ายกลางวัน' },
      { id: 'dark', label: 'มืด', desc: 'ลดแสงจ้า เหมาะกลางคืน' },
      { id: 'system', label: 'ระบบ', desc: 'ตามการตั้งค่าอุปกรณ์ของคุณ' }
    ];
    box.innerHTML = opts
      .map(
        (o) =>
          '<button type="button" class="nkbk-ai-theme-card' +
          (cur === o.id ? ' is-active' : '') +
          '" data-theme="' +
          o.id +
          '">' +
          '<span class="nkbk-ai-theme-card-icon">' +
          (THEME_CARD_ICONS[o.id] || '') +
          '</span>' +
          '<span class="nkbk-ai-theme-card-body">' +
          '<span class="nkbk-ai-theme-card-label">' +
          esc(o.label) +
          '</span>' +
          '<span class="nkbk-ai-theme-card-desc">' +
          esc(o.desc) +
          '</span>' +
          '</span>' +
          '<span class="nkbk-ai-theme-card-check" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12l5 5L19 7"/></svg>' +
          '</span>' +
          '</button>'
      )
      .join('');
    box.querySelectorAll('[data-theme]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const t = btn.getAttribute('data-theme');
        queueSavePreferences({ theme: t });
        applyThemeFromPref(t);
        renderThemePicker(t);
        const lbl = el('settingsThemeLabel');
        if (lbl) lbl.textContent = themeLabel(t);
      });
    });
  }

  function buildNotifySoundToggleRow(enabled) {
    return buildToggleRow(
      'prefNotifySound',
      'เสียงแจ้งเตือน',
      'เล่นเสียงเมื่อได้รับการแจ้งเตือนจากรายการด้านบนที่เปิดไว้',
      enabled
    );
  }

  function buildNotifySoundPanel(soundId) {
    const cur = resolveNotifySoundId(soundId);
    const chips = Object.keys(NOTIFY_SOUNDS)
      .map(
        (id) =>
          '<button type="button" class="nkbk-ai-sound-chip' +
          (id === cur ? ' is-active' : '') +
          '" data-sound="' +
          id +
          '" aria-pressed="' +
          (id === cur ? 'true' : 'false') +
          '">' +
          '<span class="nkbk-ai-sound-chip-icon" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">' +
          '<path d="M11 5L6 9H3v6h3l5 4V5z"/>' +
          '<path d="M15.5 8.5a4.5 4.5 0 0 1 0 7M18 6a7.5 7.5 0 0 1 0 12"/>' +
          '</svg></span>' +
          '<span class="nkbk-ai-sound-chip-label">' +
          esc(NOTIFY_SOUNDS[id].label) +
          '</span>' +
          '<span class="nkbk-ai-sound-chip-hint">' +
          esc(NOTIFY_SOUNDS[id].hint) +
          '</span>' +
          '</button>'
      )
      .join('');
    return (
      '<div class="nkbk-ai-notify-sound-panel-inner">' +
      '<div class="nkbk-ai-notify-sound-panel-head">' +
      '<h3 class="nkbk-ai-notify-sound-panel-title">เลือกเสียงแจ้งเตือน</h3>' +
      '<p class="nkbk-ai-notify-sound-panel-desc">เสียงที่เลือกจะใช้กับทุกการแจ้งเตือนที่เปิดไว้</p>' +
      '</div>' +
      '<div class="nkbk-ai-sound-grid" role="listbox" aria-label="เลือกเสียงแจ้งเตือน">' +
      chips +
      '</div>' +
      '<button type="button" class="nkbk-ai-sound-play-btn" id="prefNotifySoundSample">' +
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7L8 5z"/></svg>' +
      '<span>ฟังเสียงตัวอย่าง</span>' +
      '</button>' +
      '</div>'
    );
  }

  function setActiveNotifySoundChip(id) {
    document.querySelectorAll('.nkbk-ai-sound-chip').forEach((chip) => {
      const on = chip.getAttribute('data-sound') === id;
      chip.classList.toggle('is-active', on);
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function bindNotifySoundHandlers() {
    const panel = el('settingsNotifySoundPanel');
    if (!panel || panel.dataset.soundBound) return;
    panel.dataset.soundBound = '1';
    panel.addEventListener('click', (e) => {
      const chip = e.target.closest('.nkbk-ai-sound-chip');
      if (chip) {
        const id = resolveNotifySoundId(chip.getAttribute('data-sound'));
        setActiveNotifySoundChip(id);
        queueSavePreferences({ notifySoundId: id });
        void playNotificationSound(id);
        return;
      }
      if (e.target.closest('#prefNotifySoundSample')) {
        e.preventDefault();
        void playNotificationSound(getSelectedNotifySoundId());
      }
    });
  }

  function renderNotifications(p) {
    const box = el('settingsNotificationsBody');
    const soundPanel = el('settingsNotifySoundPanel');
    if (!box) return;
    box.innerHTML =
      buildNotifySoundToggleRow(!!p.notifySound) +
      buildToggleRow(
        'prefNotifyRecommendations',
        'การแนะนำ',
        'ทันข่าวสารเกี่ยวกับเครื่องมือ เคล็ดลับ และคุณสมบัติใหม่จาก ' + an(),
        p.notifyRecommendations !== false
      ) +
      buildToggleRow(
        'prefNotifyUsage',
        'การใช้งาน',
        'เราจะแจ้งให้คุณทราบเมื่อขีดจำกัดสำหรับคุณสมบัติอย่างการสร้างภาพรีเซ็ตแล้ว',
        p.notifyUsage !== false
      ) +
      buildToggleRow(
        'prefNotifyResponses',
        'คำตอบ',
        'รับการแจ้งเตือนเมื่อ' + an() + ' ตอบสนองต่อคำขอที่ต้องใช้เวลา เช่น การค้นคว้าหรือการสร้างภาพเสร็จ',
        p.notifyResponses !== false
      ) +
      buildToggleRow(
        'prefNotifyGroupChat',
        'แชตกลุ่ม',
        'คุณจะได้รับการแจ้งเตือนข้อความใหม่จากแชตกลุ่ม',
        p.notifyGroupChat !== false
      );
    if (soundPanel) soundPanel.innerHTML = buildNotifySoundPanel(p.notifySoundId);
    bindToggleAutosave([
      'prefNotifySound',
      'prefNotifyRecommendations',
      'prefNotifyUsage',
      'prefNotifyResponses',
      'prefNotifyGroupChat'
    ]);
    bindNotifySoundHandlers();
    preloadNotifySounds();
  }

  function openStackModal(modalId) {
    const modal = el(modalId);
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.classList.add('open', 'is-stack');
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeStackModal(modalId) {
    const modal = el(modalId);
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('open', 'is-stack');
    modal.setAttribute('aria-hidden', 'true');
  }

  function mimeLabel(mime) {
    const m = String(mime || '').toLowerCase();
    if (m.startsWith('image/')) return 'รูปภาพ';
    if (m.includes('pdf')) return 'PDF';
    if (m.includes('word') || m.includes('docx')) return 'Word';
    if (m.includes('sheet') || m.includes('xlsx')) return 'Excel';
    if (m.includes('presentation') || m.includes('pptx')) return 'PowerPoint';
    if (m.includes('text') || m.includes('markdown')) return 'ข้อความ';
    return 'ไฟล์';
  }

  function memoryFileIcon(mime) {
    const label = mimeLabel(mime);
    if (label === 'รูปภาพ') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10.5" r="1.5"/><path d="M21 17l-5-5-4 4-2-2-5 5"/></svg>';
    }
    if (label === 'PDF') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>';
  }

  function updateLibraryPickerCount() {
    const node = el('libraryPickerCount');
    if (!node) return;
    const n = libraryPickerSelected.size;
    node.textContent = 'เลือกแล้ว ' + n + ' รายการ';
  }

  function renderLibraryPickerList() {
    const listEl = el('libraryPickerList');
    if (!listEl) return;
    const q = libraryPickerQuery.trim().toLowerCase();
    const already = new Set((memoryFileIds || []).map(String));
    const items = libraryPickerItems.filter((item) => {
      if (!q) return true;
      const title = String(item.title || '').toLowerCase();
      const mime = mimeLabel(item.mime).toLowerCase();
      return title.includes(q) || mime.includes(q);
    });
    if (!items.length) {
      listEl.innerHTML =
        '<div class="nkbk-ai-library-picker-empty">' +
        (libraryPickerItems.length ? 'ไม่พบไฟล์ที่ค้นหา' : 'ยังไม่มีไฟล์ในไลบรารี — ลองอัปโหลดใหม่ก่อน') +
        '</div>';
      return;
    }
    listEl.innerHTML = items
      .map((item) => {
        const id = String(item.id);
        const added = libraryPickerMode !== 'attach' && already.has(id);
        const selected = libraryPickerSelected.has(id);
        const isImage = String(item.mime || '').startsWith('image/') && (item.src || item.imageId);
        const thumbSrc = libraryItemPickerSrc(item);
        const thumb = isImage
          ? '<img src="' + esc(thumbSrc) + '" alt="" loading="lazy">'
          : '<span class="nkbk-ai-library-picker-doc">' + esc(mimeLabel(item.mime)) + '</span>';
        return (
          '<button type="button" class="nkbk-ai-library-picker-card' +
          (selected ? ' is-selected' : '') +
          (added ? ' is-added' : '') +
          '" data-pick-id="' +
          esc(id) +
          '"' +
          (added ? ' disabled aria-disabled="true"' : '') +
          '>' +
          '<span class="nkbk-ai-library-picker-check" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12l5 5L19 7"/></svg>' +
          '</span>' +
          '<span class="nkbk-ai-library-picker-thumb">' +
          thumb +
          '</span>' +
          '<span class="nkbk-ai-library-picker-meta">' +
          '<span class="nkbk-ai-library-picker-title">' +
          esc(item.title || 'ไฟล์') +
          '</span>' +
          '<span class="nkbk-ai-library-picker-subline">' +
          esc(mimeLabel(item.mime) + ' · ' + fmtBytes(item.sizeBytes || 0)) +
          '</span>' +
          (added ? '<span class="nkbk-ai-library-picker-badge">เพิ่มแล้ว</span>' : '') +
          '</span></button>'
        );
      })
      .join('');
    listEl.querySelectorAll('[data-pick-id]:not([disabled])').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-pick-id');
        if (libraryPickerSelected.has(id)) libraryPickerSelected.delete(id);
        else libraryPickerSelected.add(id);
        renderLibraryPickerList();
        updateLibraryPickerCount();
      });
    });
  }

  function memoryFileThumbHtml(f) {
    const isImage = String(f.mime || '').startsWith('image/') && f.src;
    if (isImage) {
      return (
        '<img class="nkbk-ai-memory-file-thumb-img" src="' +
        esc(f.src) +
        '" alt="" loading="lazy" decoding="async">'
      );
    }
    return memoryFileIcon(f.mime);
  }

  function collectMemoryFileLabelsFromDom() {
    const out = { ...(memoryFileLabels || {}) };
    document.querySelectorAll('[data-mem-call]').forEach((inp) => {
      const id = inp.getAttribute('data-mem-call');
      if (!id) return;
      const v = inp.value.trim();
      if (v) out[id] = v.slice(0, 60);
      else delete out[id];
    });
    const ids = memoryFileIds || [];
    Object.keys(out).forEach((id) => {
      if (!ids.includes(id)) delete out[id];
    });
    return out;
  }

  function renderMemoryFiles(list) {
    const box = el('settingsMemoryFilesList');
    if (!box) return;
    memoryFileIds = Array.isArray(settingsData && settingsData.memoryFileIds)
      ? settingsData.memoryFileIds.slice()
      : memoryFileIds;
    if (settingsData && settingsData.memoryFileLabels) {
      memoryFileLabels = { ...settingsData.memoryFileLabels };
    }
    const files = Array.isArray(list) ? list : settingsData && settingsData.memoryFiles ? settingsData.memoryFiles : [];
    if (!files.length) {
      box.innerHTML =
        '<div class="nkbk-ai-memory-files-empty">' +
        '<span class="nkbk-ai-memory-files-empty-icon" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>' +
        '</span>' +
        '<p class="nkbk-ai-memory-files-empty-title">ยังไม่มีไฟล์ที่ให้ ' + esc(an()) + ' จำ</p>' +
        '<p class="nkbk-ai-memory-files-empty-desc">อัปโหลดหรือเลือกจากไลบรารีเพื่อให้' + esc(an()) + 'อ้างอิงเนื้อหา</p>' +
        '</div>';
      return;
    }
    box.innerHTML = files
      .map(
        (f) =>
          '<div class="nkbk-ai-memory-file-item" data-mem-file="' +
          esc(f.id) +
          '">' +
          '<div class="nkbk-ai-memory-file-icon' +
          (String(f.mime || '').startsWith('image/') && f.src ? ' nkbk-ai-memory-file-icon--thumb' : '') +
          '" aria-hidden="true">' +
          memoryFileThumbHtml(f) +
          '</div>' +
          '<div class="nkbk-ai-memory-file-main">' +
          '<div class="nkbk-ai-memory-file-title">' +
          esc(f.title || 'ไฟล์') +
          '</div>' +
          '<div class="nkbk-ai-memory-file-sub">' +
          esc(mimeLabel(f.mime) + ' · ' + fmtBytes(f.sizeBytes || 0)) +
          '</div>' +
          '<label class="nkbk-ai-memory-file-call">' +
          '<span class="nkbk-ai-memory-file-call-label">ชื่อเรียกสำหรับ ' + esc(an()) + '</span>' +
          '<input type="text" class="nkbk-ai-memory-file-call-input" data-mem-call="' +
          esc(f.id) +
          '" value="' +
          esc(f.callName || memoryFileLabels[f.id] || '') +
          '" placeholder="เช่น โลโก้สหกรรม, รูปหมอมะญู" maxlength="60" autocomplete="off">' +
          '</label></div>' +
          '<button type="button" class="nkbk-ai-memory-file-remove" data-remove-mem-file="' +
          esc(f.id) +
          '" aria-label="ลบไฟล์">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
          '</button></div>'
      )
      .join('');
    box.querySelectorAll('[data-remove-mem-file]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-remove-mem-file');
        memoryFileIds = memoryFileIds.filter((x) => x !== id);
        delete memoryFileLabels[id];
        savePreferences({ memoryFileIds, memoryFileLabels: { ...memoryFileLabels } });
        if (settingsData) {
          settingsData.memoryFiles = (settingsData.memoryFiles || []).filter((x) => x.id !== id);
          settingsData.memoryFileIds = memoryFileIds;
          settingsData.memoryFileLabels = { ...memoryFileLabels };
        }
        renderMemoryFiles(settingsData && settingsData.memoryFiles);
      });
    });
    box.querySelectorAll('[data-mem-call]').forEach((inp) => {
      if (inp.dataset.callBound) return;
      inp.dataset.callBound = '1';
      inp.addEventListener('input', () => {
        const id = inp.getAttribute('data-mem-call');
        const v = inp.value.trim();
        if (v) memoryFileLabels[id] = v.slice(0, 60);
        else delete memoryFileLabels[id];
        queueSavePreferences({ memoryFileLabels: collectMemoryFileLabelsFromDom() });
      });
      inp.addEventListener('blur', () => savePreferences({ memoryFileLabels: collectMemoryFileLabelsFromDom() }));
    });
  }

  async function uploadMemoryFilesFromInput(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const uploadBtn = el('settingsMemoryFileUpload');
    if (uploadBtn) uploadBtn.classList.add('is-loading');
    try {
      const items = [];
      for (const f of files.slice(0, 4)) {
        const dataUrl = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = reject;
          r.readAsDataURL(f);
        });
        items.push({ name: f.name, mime: f.type || 'application/octet-stream', dataUrl: String(dataUrl) });
      }
      const data = await apiPost('/api/nkbk-ai-library', { action: 'upload', items });
      const added = Array.isArray(data.added) ? data.added.map((x) => x.id).filter(Boolean) : [];
      memoryFileIds = [...new Set([...(memoryFileIds || []), ...added])];
      await savePreferences({ memoryFileIds });
      await refreshSettings();
    } finally {
      if (uploadBtn) uploadBtn.classList.remove('is-loading');
    }
  }

  function applyLibraryPickerUi() {
    const sub = el('libraryPickerSub');
    const confirmBtn = el('libraryPickerConfirm');
    if (libraryPickerMode === 'attach') {
      if (sub) sub.textContent = 'เลือกไฟล์เพื่อแนบในข้อความ';
      if (confirmBtn) confirmBtn.textContent = 'แนบที่เลือก';
    } else {
      if (sub) sub.textContent = 'เลือกไฟล์ที่ต้องการให้' + an() + 'จำไว้';
      if (confirmBtn) confirmBtn.textContent = 'เพิ่มที่เลือก';
    }
  }

  function settingsImageApiUrl(imageId) {
    try {
      const profile = JSON.parse(sessionStorage.getItem('nkbk_ai_profile') || '{}');
      const u = String(profile.username || '').trim();
      if (!u || !imageId) return '';
      const t = sessionStorage.getItem('nkbk_ai_token') || '';
      const base = `/api/nkbk-ai-image/${encodeURIComponent(u)}/${encodeURIComponent(imageId)}`;
      return t ? base + '?token=' + encodeURIComponent(t) : base;
    } catch (_) {
      return '';
    }
  }

  function libraryItemPickerSrc(item) {
    if (!item) return '';
    if (item.imageId) return settingsImageApiUrl(item.imageId);
    return item.src || '';
  }

  function bindLibraryPickerHandlers() {
    const root = document.body;
    if (!root || root.dataset.nkbkLibraryPickerBound) return;
    root.dataset.nkbkLibraryPickerBound = '1';
    if (el('nkbkAiLibraryPickerClose')) el('nkbkAiLibraryPickerClose').addEventListener('click', closeLibraryPicker);
    if (el('nkbkAiLibraryPickerBackdrop')) {
      el('nkbkAiLibraryPickerBackdrop').addEventListener('click', closeLibraryPicker);
    }
    if (el('libraryPickerCancel')) el('libraryPickerCancel').addEventListener('click', closeLibraryPicker);
    if (el('libraryPickerSearch')) {
      el('libraryPickerSearch').addEventListener('input', () => {
        libraryPickerQuery = el('libraryPickerSearch').value || '';
        renderLibraryPickerList();
      });
    }
    if (el('libraryPickerConfirm')) {
      el('libraryPickerConfirm').addEventListener('click', async () => {
        const ids = [...libraryPickerSelected];
        if (!ids.length) {
          alert('กรุณาเลือกไฟล์อย่างน้อย 1 รายการ');
          return;
        }
        if (libraryPickerMode === 'attach') {
          const items = ids
            .map((id) => libraryPickerItems.find((x) => x.id === id))
            .filter(Boolean);
          const handler = libraryPickerAttachHandler;
          closeLibraryPicker();
          if (handler) {
            try {
              await handler(items);
            } catch (e) {
              alert(e.message || 'แนบไฟล์ไม่สำเร็จ');
            }
          }
          return;
        }
        memoryFileIds = [...new Set([...(memoryFileIds || []), ...ids])];
        try {
          await savePreferences({ memoryFileIds });
          await refreshSettings();
        } catch (e) {
          alert(e.message || 'บันทึกไม่สำเร็จ');
        }
        closeLibraryPicker();
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const modal = el('nkbkAiLibraryPickerModal');
      if (modal && modal.classList.contains('open')) closeLibraryPicker();
    });
  }

  async function openLibraryPicker(opts) {
    bindLibraryPickerHandlers();
    const options = opts && typeof opts === 'object' ? opts : {};
    libraryPickerMode = options.mode === 'attach' ? 'attach' : 'memory';
    libraryPickerAttachHandler =
      typeof options.onAttach === 'function' ? options.onAttach : null;
    applyLibraryPickerUi();
    const listEl = el('libraryPickerList');
    if (!listEl) return;
    libraryPickerSelected = new Set();
    libraryPickerItems = [];
    libraryPickerQuery = '';
    if (el('libraryPickerSearch')) el('libraryPickerSearch').value = '';
    updateLibraryPickerCount();
    listEl.innerHTML = '<div class="nkbk-ai-library-picker-empty">กำลังโหลด...</div>';
    openStackModal('nkbkAiLibraryPickerModal');
    try {
      const data = await apiGet('/api/nkbk-ai-library');
      libraryPickerItems = data.ok && Array.isArray(data.items) ? data.items : [];
      renderLibraryPickerList();
      updateLibraryPickerCount();
    } catch (e) {
      listEl.innerHTML =
        '<div class="nkbk-ai-library-picker-empty">' + esc(e.message || 'โหลดไม่สำเร็จ') + '</div>';
    }
  }

  function closeLibraryPicker() {
    closeStackModal('nkbkAiLibraryPickerModal');
    libraryPickerSelected.clear();
    libraryPickerItems = [];
    libraryPickerQuery = '';
    libraryPickerMode = 'memory';
    libraryPickerAttachHandler = null;
    applyLibraryPickerUi();
  }

  function renderPersonalize(data) {
    const p = data.preferences || {};
    memoryFileIds = Array.isArray(data.memoryFileIds) ? data.memoryFileIds.slice() : [];
    memoryFileLabels =
      data.memoryFileLabels && typeof data.memoryFileLabels === 'object' ? { ...data.memoryFileLabels } : {};
    if (el('nkbkAiCallNameInput')) el('nkbkAiCallNameInput').value = data.userCallName || '';
    if (el('nkbkAiUserLocationInput')) el('nkbkAiUserLocationInput').value = p.userLocation || '';
    if (el('nkbkAiAboutYouInput')) el('nkbkAiAboutYouInput').value = p.aboutYou || '';
    if (el('nkbkAiStandingInstructions')) el('nkbkAiStandingInstructions').value = data.standingInstructions || '';
    const mem = el('settingsMemoryToggles');
    if (mem) {
      mem.innerHTML =
        buildToggleRow(
          'prefMemorySaved',
          'อ้างอิงหน่วยความจำที่บันทึกไว้',
          'ให้' + an() + 'ใช้คำสั่งและข้อมูลที่คุณบันทึกไว้',
          p.memorySaved !== false
        ) +
        buildToggleRow(
          'prefMemoryBrowser',
          'อ้างอิงหน่วยความจำเบราว์เซอร์',
          'ใช้ข้อมูลบริบทจากเซสชันเบราว์เซอร์ปัจจุบัน (ถ้ามี)',
          !!p.memoryBrowser
        ) +
        buildToggleRow(
          'prefMemoryChatHistory',
          'ประวัติการแชตที่อ้างอิง',
          'ให้' + an() + 'อ้างอิงบทสนทนาก่อนหน้าในแชตเดียวกัน',
          p.memoryChatHistory !== false
        );
      bindToggleAutosave(['prefMemorySaved', 'prefMemoryBrowser', 'prefMemoryChatHistory']);
    }
    renderMemoryFiles(data.memoryFiles || []);
  }

  function renderDataControl(data) {
    const p = data.preferences || {};
    const loc = el('settingsDataLocation');
    if (loc) {
      loc.innerHTML = buildToggleRow(
        'prefDataLocationEnabled',
        'ตำแหน่งที่ตั้ง',
        'เมื่อเปิดใช้ ' + an() + 'จะใช้ค่าใน การปรับแต่งเฉพาะบุคคล › ตำแหน่งของคุณ',
        !!p.dataLocationEnabled
      );
    }
    const shared = data.sharedLinks || [];
    const archived = data.archivedThreads || [];
    if (el('settingsSharedLinksCount')) el('settingsSharedLinksCount').textContent = String(shared.length);
    if (el('settingsArchivedCount')) el('settingsArchivedCount').textContent = String(archived.length);
    settingsData = data;
  }

  function getUserLocationText() {
    const fromInput = el('nkbkAiUserLocationInput') ? el('nkbkAiUserLocationInput').value.trim() : '';
    if (fromInput) return fromInput;
    if (settingsData && settingsData.preferences && settingsData.preferences.userLocation) {
      return String(settingsData.preferences.userLocation).trim();
    }
    return '';
  }

  async function ensureUserLocationForToggle() {
    if (getUserLocationText()) return getUserLocationText();
    if (!navigator.geolocation) return '';
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const { latitude, longitude } = pos.coords;
          let label = latitude.toFixed(4) + ', ' + longitude.toFixed(4);
          try {
            const r = await fetch(
              'https://nominatim.openstreetmap.org/reverse?lat=' +
                encodeURIComponent(latitude) +
                '&lon=' +
                encodeURIComponent(longitude) +
                '&format=json&accept-language=th',
              { headers: { 'Accept-Language': 'th' } }
            );
            if (r.ok) {
              const j = await r.json();
              if (j.display_name) label = String(j.display_name).trim();
            }
          } catch (_) {}
          const locEl = el('nkbkAiUserLocationInput');
          if (locEl) locEl.value = label;
          resolve(label);
        },
        () => resolve(''),
        { timeout: 10000, maximumAge: 600000 }
      );
    });
  }

  function bindDataLocationToggle() {
    const container = el('settingsDataLocation');
    if (!container || container.dataset.locBound) return;
    container.dataset.locBound = '1';
    container.addEventListener('change', async (e) => {
      const t = e.target;
      if (!t || t.id !== 'prefDataLocationEnabled') return;
      try {
        if (t.checked) {
          const loc = await ensureUserLocationForToggle();
          if (!loc) {
            t.checked = false;
            alert('กรุณากรอก "ตำแหน่งของคุณ" ใน การปรับแต่งเฉพาะบุคคล หรืออนุญาตการเข้าถึงตำแหน่งในเบราว์เซอร์');
            setPanel('personalize');
            setTimeout(() => el('nkbkAiUserLocationInput')?.focus(), 200);
            return;
          }
          await savePreferences({ dataLocationEnabled: true, userLocation: loc });
        } else {
          await savePreferences({ dataLocationEnabled: false });
        }
      } catch (err) {
        t.checked = !t.checked;
        alert(err.message || 'บันทึกไม่สำเร็จ');
      }
    });
  }

  function openDataModal(modalId) {
    openStackModal(modalId);
  }

  function closeDataModal(modalId) {
    closeStackModal(modalId);
  }

  function renderSharedLinksTable(links) {
    const box = el('settingsSharedLinksTable');
    if (!box) return;
    if (!links.length) {
      box.innerHTML = '<p class="nkbk-ai-settings-empty">ยังไม่มีลิงก์ที่แบ่งปัน</p>';
      return;
    }
    box.innerHTML =
      '<table class="nkbk-ai-data-table">' +
      '<thead><tr><th>ชื่อแชต</th><th>แบ่งปันเมื่อ</th><th class="nkbk-ai-data-table-actions-col">การดำเนินการ</th></tr></thead>' +
      '<tbody>' +
      links
        .map((item) => {
          const url = location.origin + '/?thread=' + encodeURIComponent(item.shareId || item.threadId);
          return (
            '<tr data-thread-id="' +
            esc(item.threadId) +
            '">' +
            '<td class="nkbk-ai-data-table-title">' +
            esc(item.title) +
            '</td>' +
            '<td class="nkbk-ai-data-table-date">' +
            esc(fmtDate(item.sharedAt)) +
            '</td>' +
            '<td class="nkbk-ai-data-table-actions">' +
            '<a class="nkbk-ai-btn-ghost nkbk-ai-btn-sm" href="' +
            esc(url) +
            '" target="_blank" rel="noopener">เปิด</a>' +
            '<button type="button" class="nkbk-ai-btn-ghost nkbk-ai-btn-sm nkbk-ai-btn-danger-text" data-revoke-share="' +
            esc(item.threadId) +
            '">ลบ</button>' +
            '</td></tr>'
          );
        })
        .join('') +
      '</tbody></table>';
    box.querySelectorAll('[data-revoke-share]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const tid = btn.getAttribute('data-revoke-share');
        if (!tid) return;
        if (!window.__nkbkConfirm) return;
        const ok = await window.__nkbkConfirm({
          title: 'ลบการแบ่งปัน?',
          message: 'ลิงก์นี้จะใช้งานไม่ได้สำหรับผู้อื่น',
          okText: 'ลบ',
          variant: 'danger'
        });
        if (!ok) return;
        try {
          await apiPost('/api/nkbk-ai-threads', { action: 'revokeShare', threadId: tid });
          const data = await refreshSettings();
          renderSharedLinksTable(data.sharedLinks || []);
          if (el('settingsSharedLinksCount')) {
            el('settingsSharedLinksCount').textContent = String((data.sharedLinks || []).length);
          }
        } catch (e) {
          alert(e.message || 'ลบไม่สำเร็จ');
        }
      });
    });
  }

  function renderArchivedTable(list) {
    const box = el('settingsArchivedTable');
    if (!box) return;
    if (!list.length) {
      box.innerHTML = '<p class="nkbk-ai-settings-empty">ไม่มีแชตที่เก็บถาวร</p>';
      return;
    }
    box.innerHTML =
      '<table class="nkbk-ai-data-table">' +
      '<thead><tr><th>ชื่อแชต</th><th>เก็บเมื่อ</th><th class="nkbk-ai-data-table-actions-col">การดำเนินการ</th></tr></thead>' +
      '<tbody>' +
      list
        .map(
          (t) =>
            '<tr><td class="nkbk-ai-data-table-title">' +
            esc(t.title) +
            '</td><td class="nkbk-ai-data-table-date">' +
            esc(fmtDate(t.archivedAt)) +
            '</td><td class="nkbk-ai-data-table-actions">' +
            '<button type="button" class="nkbk-ai-btn-ghost nkbk-ai-btn-sm" data-unarchive="' +
            esc(t.id) +
            '">นำกลับ</button></td></tr>'
        )
        .join('') +
      '</tbody></table>';
    box.querySelectorAll('[data-unarchive]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const tid = btn.getAttribute('data-unarchive');
        if (!tid) return;
        try {
          await apiPost('/api/nkbk-ai-threads', { action: 'unarchive', threadId: tid });
          const data = await refreshSettings();
          renderArchivedTable(data.archivedThreads || []);
          if (el('settingsArchivedCount')) {
            el('settingsArchivedCount').textContent = String((data.archivedThreads || []).length);
          }
          window.dispatchEvent(new CustomEvent('nkbk-ai-threads-changed'));
        } catch (e) {
          alert(e.message || 'นำกลับไม่สำเร็จ');
        }
      });
    });
  }

  function renderSharedLinks(links) {
    renderSharedLinksTable(links);
  }

  function renderArchivedThreads(list) {
    renderArchivedTable(list);
  }

  function renderStorage(storage) {
    const s = storage || {};
    const used = s.usedBytes || 0;
    const quota = s.quotaBytes || 5 * 1024 * 1024 * 1024;
    const pct = quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0;
    if (el('settingsStorageUsed')) el('settingsStorageUsed').textContent = fmtBytes(used);
    if (el('settingsStorageQuota')) el('settingsStorageQuota').textContent = fmtBytes(quota);
    if (el('settingsStorageRemain')) el('settingsStorageRemain').textContent = fmtBytes(Math.max(0, quota - used));
    const bar = el('settingsStorageBar');
    if (bar) {
      bar.style.width = pct + '%';
      bar.classList.toggle('is-warning', pct >= 75 && pct < 90);
      bar.classList.toggle('is-danger', pct >= 90);
    }
    if (el('settingsStoragePct')) el('settingsStoragePct').textContent = pct + '%';
    if (el('settingsStorageImages')) {
      el('settingsStorageImages').textContent =
        (s.imageCount || 0) + ' รูป · ' + fmtBytes(s.imageBytes || 0);
    }
    if (el('settingsStorageFiles')) {
      el('settingsStorageFiles').textContent = (s.fileCount || 0) + ' ไฟล์ · ' + fmtBytes(s.fileBytes || 0);
    }
  }

  function renderAccount(acc) {
    const a = acc || {};
    if (el('settingsAccountName')) el('settingsAccountName').textContent = a.fullname || '-';
    if (el('settingsAccountEmail')) el('settingsAccountEmail').textContent = a.email || '-';
    if (el('settingsAccountUsername')) el('settingsAccountUsername').textContent = a.username || '-';
    const av = el('settingsAccountAvatar');
    if (av) {
      if (a.pictureUrl) {
        av.innerHTML = '<img src="' + esc(a.pictureUrl) + '" alt="">';
      } else {
        const name = a.fullname || a.username || 'U';
        const parts = name.trim().split(/\s+/);
        const initials =
          parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
        av.textContent = initials;
      }
    }
  }

  function collectPreferencesPatch() {
    const p = {};
    const map = {
      prefNotifySound: 'notifySound',
      prefNotifyRecommendations: 'notifyRecommendations',
      prefNotifyUsage: 'notifyUsage',
      prefNotifyResponses: 'notifyResponses',
      prefNotifyGroupChat: 'notifyGroupChat',
      prefMemorySaved: 'memorySaved',
      prefMemoryBrowser: 'memoryBrowser',
      prefMemoryChatHistory: 'memoryChatHistory',
      prefDataLocationEnabled: 'dataLocationEnabled'
    };
    Object.keys(map).forEach((id) => {
      const node = el(id);
      if (node) p[map[id]] = !!node.checked;
    });
    if (el('nkbkAiUserLocationInput')) p.userLocation = el('nkbkAiUserLocationInput').value.trim();
    if (el('nkbkAiAboutYouInput')) p.aboutYou = el('nkbkAiAboutYouInput').value.trim();
    p.notifySoundId = getSelectedNotifySoundId();
    const themeBtn = document.querySelector('#settingsThemePicker .nkbk-ai-theme-card.is-active');
    if (themeBtn) p.theme = themeBtn.getAttribute('data-theme') || 'system';
    return p;
  }

  function queueSavePreferences(patch) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => savePreferences(patch), 400);
  }

  const MEMORY_SAVE_LABEL = 'บันทึก';

  function setMemorySaveState(state) {
    const btn = el('nkbkAiMemorySave');
    if (!btn) return;
    btn.classList.remove('is-saving', 'is-saved');
    if (state === 'loading') {
      btn.disabled = true;
      btn.classList.add('is-saving');
      btn.setAttribute('aria-busy', 'true');
      btn.setAttribute('aria-label', 'กำลังบันทึก');
      btn.innerHTML = '<span class="nkbk-ai-btn-spinner" aria-hidden="true"></span>';
      return;
    }
    if (state === 'saved') {
      btn.disabled = true;
      btn.classList.add('is-saved');
      btn.removeAttribute('aria-busy');
      btn.setAttribute('aria-label', 'บันทึกแล้ว');
      btn.textContent = 'บันทึกแล้ว';
      return;
    }
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.removeAttribute('aria-label');
    btn.textContent = MEMORY_SAVE_LABEL;
  }

  async function savePreferences(extraPatch, opts) {
    const showButtonLoading = !!(opts && opts.showButtonLoading);
    if (showButtonLoading) setMemorySaveState('loading');
    try {
      const patch = extraPatch && typeof extraPatch === 'object' ? extraPatch : {};
      const body = {
        preferences: { ...collectPreferencesPatch(), ...(patch.preferences || {}) },
        userCallName: el('nkbkAiCallNameInput') ? el('nkbkAiCallNameInput').value.trim() : undefined,
        standingInstructions: el('nkbkAiStandingInstructions') ? el('nkbkAiStandingInstructions').value : undefined,
        memoryFileIds: patch.memoryFileIds != null ? patch.memoryFileIds : memoryFileIds,
        memoryFileLabels: patch.memoryFileLabels != null ? patch.memoryFileLabels : collectMemoryFileLabelsFromDom()
      };
      const data = await apiPost('/api/nkbk-ai-settings', body);
      settingsData = data;
      if (data.memoryFileLabels) memoryFileLabels = { ...data.memoryFileLabels };
      window.dispatchEvent(new CustomEvent('nkbk-ai-settings-saved', { detail: data }));
      if (showButtonLoading) {
        setMemorySaveState('saved');
        setTimeout(() => setMemorySaveState('idle'), 1200);
      }
    } catch (e) {
      if (showButtonLoading) setMemorySaveState('idle');
      console.warn('[settings] save', e.message);
      throw e;
    }
  }

  function bindToggleAutosave(ids) {
    ids.forEach((id) => {
      const node = el(id);
      if (!node || node.dataset.bound) return;
      node.dataset.bound = '1';
      node.addEventListener('change', () => queueSavePreferences());
    });
  }

  function bindStaticHandlers() {
    const modal = el('nkbkAiSettingsModal');
    if (!modal || modal.dataset.settingsBound) return;
    modal.dataset.settingsBound = '1';
    modal.querySelectorAll('[data-settings-nav]').forEach((btn) => {
      btn.addEventListener('click', () => setPanel(btn.getAttribute('data-settings-nav')));
    });
    ['nkbkAiCallNameInput', 'nkbkAiUserLocationInput', 'nkbkAiAboutYouInput', 'nkbkAiStandingInstructions'].forEach(
      (id) => {
        const node = el(id);
        if (!node) return;
        node.addEventListener('input', () => queueSavePreferences());
        node.addEventListener('blur', () => savePreferences());
      }
    );
    if (el('nkbkAiMemorySave')) {
      el('nkbkAiMemorySave').addEventListener('click', async () => {
        try {
          await savePreferences({}, { showButtonLoading: true });
        } catch (e) {
          alert(e.message || 'บันทึกไม่สำเร็จ');
        }
      });
    }
    if (el('settingsMemoryFileUpload') && el('settingsMemoryFileInput')) {
      el('settingsMemoryFileUpload').addEventListener('click', () => el('settingsMemoryFileInput').click());
      el('settingsMemoryFileInput').addEventListener('change', async () => {
        const input = el('settingsMemoryFileInput');
        if (!input || !input.files || !input.files.length) return;
        try {
          await uploadMemoryFilesFromInput(input.files);
        } catch (e) {
          alert(e.message || 'อัปโหลดไม่สำเร็จ');
        }
        input.value = '';
      });
    }
    if (el('settingsMemoryFilePick')) {
      el('settingsMemoryFilePick').addEventListener('click', () => openLibraryPicker());
    }
    if (el('settingsOpenSharedLinks')) {
      el('settingsOpenSharedLinks').addEventListener('click', () => {
        renderSharedLinksTable((settingsData && settingsData.sharedLinks) || []);
        openDataModal('nkbkAiSharedLinksModal');
      });
    }
    if (el('settingsOpenArchived')) {
      el('settingsOpenArchived').addEventListener('click', () => {
        renderArchivedTable((settingsData && settingsData.archivedThreads) || []);
        openDataModal('nkbkAiArchivedModal');
      });
    }
    if (el('nkbkAiSharedLinksClose')) el('nkbkAiSharedLinksClose').addEventListener('click', () => closeDataModal('nkbkAiSharedLinksModal'));
    if (el('nkbkAiSharedLinksBackdrop')) el('nkbkAiSharedLinksBackdrop').addEventListener('click', () => closeDataModal('nkbkAiSharedLinksModal'));
    if (el('nkbkAiArchivedClose')) el('nkbkAiArchivedClose').addEventListener('click', () => closeDataModal('nkbkAiArchivedModal'));
    if (el('nkbkAiArchivedBackdrop')) el('nkbkAiArchivedBackdrop').addEventListener('click', () => closeDataModal('nkbkAiArchivedModal'));
    bindDataLocationToggle();
    if (el('settingsDeleteAllChats')) {
      el('settingsDeleteAllChats').addEventListener('click', async () => {
        if (!window.__nkbkConfirm) {
          if (!confirm('ลบแชตที่หน้าหลักทั้งหมด? (ไม่รวมแชตที่เก็บถาวร)')) return;
        } else {
          const ok = await window.__nkbkConfirm({
            title: 'ลบแชตทั้งหมด?',
            message: 'แชตที่หน้าหลักทั้งหมดจะถูกลบถาวร (ไม่รวมแชตที่เก็บถาวร)',
            okText: 'ลบทั้งหมด',
            variant: 'danger'
          });
          if (!ok) return;
        }
        try {
          const data = await apiPost('/api/nkbk-ai-threads', { action: 'deleteAllVisible' });
          await refreshSettings();
          window.dispatchEvent(new CustomEvent('nkbk-ai-threads-changed', { detail: data }));
        } catch (e) {
          alert(e.message || 'ลบไม่สำเร็จ');
        }
      });
    }
  }

  function renderAll(data) {
    settingsData = data;
    if (data && data.assistantDisplayName) {
      applyBranding(data.assistantDisplayName);
    }
    const p = data.preferences || {};
    window.__nkbkAiUserPrefs = p;
    renderThemePicker(p.theme || localStorage.getItem('nkbk_ai_theme') || 'system');
    const lbl = el('settingsThemeLabel');
    if (lbl) lbl.textContent = themeLabel(p.theme || 'system');
    renderNotifications(p);
    renderPersonalize(data);
    if (window.NkbkAiPrompts) window.NkbkAiPrompts.initFromSettings(data);
    renderDataControl(data);
    renderStorage(data.storage);
    renderAccount(data.account);
  }

  async function refreshSettings() {
    const data = await apiGet('/api/nkbk-ai-settings');
    renderAll(data);
    return data;
  }

  function openSettings(panel) {
    bindStaticHandlers();
    setPanel(panel || 'general');
    refreshSettings().catch((e) => console.warn('[settings]', e.message));
    const modal = el('nkbkAiSettingsModal');
    if (modal) {
      modal.setAttribute('aria-hidden', 'false');
      modal.classList.add('open');
    }
  }

  window.NkbkAiSettings = {
    open: openSettings,
    refresh: refreshSettings,
    applyThemeFromPref,
    playNotificationSound,
    renderAll,
    applyBranding,
    setAssistantDisplayName,
    openLibraryPicker,
    renderPrompts: (data) => {
      if (window.NkbkAiPrompts) window.NkbkAiPrompts.renderSettings(data);
    }
  };

  bindLibraryPickerHandlers();

  if (window.__nkbkAiDisplayName) {
    applyBranding(window.__nkbkAiDisplayName);
  }

  window.addEventListener('nkbk-ai-threads-changed', () => {
    refreshSettings().catch(() => {});
  });

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if ((localStorage.getItem('nkbk_ai_theme') || 'system') === 'system') applyThemeFromPref('system');
    });
  }

  document.addEventListener(
    'click',
    (e) => {
      const btn = e.target.closest(
        'button, .nkbk-ai-btn-primary, .nkbk-ai-btn-ghost, .nkbk-ai-btn-danger, .nkbk-ai-memory-action, .nkbk-ai-settings-nav-item, .nkbk-ai-theme-card, .nkbk-ai-sound-chip, .nkbk-ai-sound-play-btn, .nkbk-ai-library-picker-card, .nkbk-ai-settings-row, .nkbk-ai-btn-send, .nkbk-ai-memory-file-remove, .nkbk-ai-sidebar-new, .nkbk-ai-composer-prompts, .nkbk-ai-prompt-picker-item, .nkbk-ai-prompt-card-btn'
      );
      if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') return;
      btn.classList.add('is-pressed');
      window.setTimeout(() => btn.classList.remove('is-pressed'), 180);
    },
    true
  );
})();
