(function () {
  'use strict';

  function applyTheme() {
    try {
      document.body.classList.toggle('theme-light', localStorage.getItem('theme') === 'light');
    } catch (_) {}
  }
  applyTheme();
  window.addEventListener('storage', (e) => {
    if (e.key === 'theme') applyTheme();
  });

  const params = new URLSearchParams(location.search);
  let token = params.get('t') || '';
  if (token) {
    try {
      sessionStorage.setItem('nkbk_ai_token', token);
      history.replaceState(null, '', location.pathname);
    } catch (_) {}
  } else {
    try {
      token = sessionStorage.getItem('nkbk_ai_token') || localStorage.getItem('monitor_token') || '';
    } catch (_) {}
  }

  const el = (id) => document.getElementById(id);
  const messagesEl = el('nkbkAiMessages');
  const welcomeEl = el('nkbkAiWelcome');
  const inputEl = el('nkbkAiInput');
  const sendBtn = el('btnNkbkAiSend');
  const attachBtn = el('btnNkbkAiAttach');
  const genBtn = el('btnNkbkAiGenerate');
  const fileInput = el('nkbkAiFileInput');
  const attachPreview = el('nkbkAiAttachPreview');
  const bannerEl = el('nkbkAiBanner');
  const titleEl = el('nkbkAiTitle');
  const subtitleEl = el('nkbkAiSubtitle');
  const callBadgeEl = el('nkbkAiCallBadge');
  const welcomeTitleEl = el('nkbkAiWelcomeTitle');
  const callNameInput = el('nkbkAiCallNameInput');
  const threadList = el('nkbkAiThreadList');
  const standingEl = el('nkbkAiStandingInstructions');
  const memoryModal = el('nkbkAiMemoryModal');
  const lightbox = el('nkbkAiLightbox');
  const lightboxImg = el('nkbkAiLightboxImg');
  let lightboxDataUrl = '';

  let sending = false;
  let statusOk = false;
  let userCallName = '';
  let activeThreadId = '';
  let threads = [];
  let pendingImages = [];
  let generateMode = false;

  function headers() {
    return {
      'Content-Type': 'application/json',
      'X-Monitor-Token': token
    };
  }

  function showBanner(text, kind) {
    if (!bannerEl) return;
    bannerEl.textContent = text;
    bannerEl.className = 'nkbk-ai-banner' + (kind ? ' nkbk-ai-banner--' + kind : '');
    bannerEl.classList.remove('hidden');
  }

  function hideWelcome() {
    if (welcomeEl) welcomeEl.style.display = 'none';
  }

  function dataUrlFromB64(b64, mime) {
    return `data:${mime || 'image/png'};base64,${b64}`;
  }

  function downloadDataUrl(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename || 'monet-ai.png';
    a.click();
  }

  function openLightbox(dataUrl) {
    if (!lightbox || !lightboxImg) return;
    lightboxDataUrl = dataUrl;
    lightboxImg.src = dataUrl;
    lightbox.setAttribute('aria-hidden', 'false');
    lightbox.classList.add('open');
  }

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.setAttribute('aria-hidden', 'true');
    lightbox.classList.remove('open');
    lightboxDataUrl = '';
  }

  function buildImageCard(img, role) {
    const wrap = document.createElement('div');
    wrap.className = 'nkbk-ai-image-card';
    const imageEl = document.createElement('img');
    const dataUrl = img.dataUrl || (img.b64 ? dataUrlFromB64(img.b64, img.mime) : (img.url || ''));
    if (!dataUrl) return wrap;
    imageEl.src = dataUrl;
    imageEl.alt = img.caption || 'รูปภาพ';
    imageEl.loading = 'lazy';
    imageEl.addEventListener('click', () => openLightbox(dataUrl));
    wrap.appendChild(imageEl);

    if (role === 'assistant') {
      const actions = document.createElement('div');
      actions.className = 'nkbk-ai-image-actions';
      const dl = document.createElement('button');
      dl.type = 'button';
      dl.className = 'nkbk-ai-img-btn';
      dl.textContent = '⬇ ดาวน์โหลด';
      dl.addEventListener('click', (e) => {
        e.stopPropagation();
        downloadDataUrl(dataUrl, 'monet-' + Date.now() + '.png');
      });
      actions.appendChild(dl);
      wrap.appendChild(actions);
    }
    return wrap;
  }

  function updateCallNameDisplay(name) {
    userCallName = name && String(name).trim() ? String(name).trim() : '';
    if (callBadgeEl) {
      if (userCallName) {
        callBadgeEl.textContent = userCallName;
        callBadgeEl.classList.remove('hidden');
      } else {
        callBadgeEl.textContent = '';
        callBadgeEl.classList.add('hidden');
      }
    }
    if (subtitleEl) {
      subtitleEl.textContent = 'แชท · วิเคราะห์รูป · สร้างภาพ';
    }
    if (welcomeTitleEl) {
      welcomeTitleEl.textContent = userCallName
        ? `สวัสดีค่ะ ${userCallName} โมเน่พร้อมช่วยแล้ว`
        : 'สวัสดีค่ะ โมเน่พร้อมช่วยแล้ว';
    }
    if (callNameInput && document.activeElement !== callNameInput) {
      callNameInput.value = userCallName;
    }
  }

  function renderMessagesFromHistory(chatHistory) {
    if (!messagesEl) return;
    messagesEl.innerHTML = '';
    if (welcomeEl) messagesEl.appendChild(welcomeEl);
    if (Array.isArray(chatHistory) && chatHistory.length) {
      hideWelcome();
      chatHistory.forEach((m) => {
        if (m.role === 'user' || m.role === 'assistant') {
          appendMessage(m.role, m.content || '', historyImages(m));
        }
      });
    } else if (welcomeEl) {
      welcomeEl.style.display = '';
    }
  }

  function historyImages(m) {
    if (!m || !Array.isArray(m.images)) return [];
    return m.images
      .filter((img) => img && !img.omitted && (img.b64 || img.url || img.dataUrl))
      .map((img) => ({
        mime: img.mime || 'image/png',
        b64: img.b64,
        url: img.url,
        dataUrl: img.dataUrl,
        caption: img.caption
      }));
  }

  function renderThreadList() {
    if (!threadList) return;
    threadList.innerHTML = '';
    (threads || []).forEach((t) => {
      const row = document.createElement('div');
      row.className = 'nkbk-ai-thread-item' + (t.id === activeThreadId ? ' is-active' : '');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nkbk-ai-thread-item-btn';
      btn.textContent = t.title || 'แชท';
      btn.title = t.title || 'แชท';
      btn.addEventListener('click', () => switchThread(t.id));
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'nkbk-ai-thread-item-del';
      del.title = 'ลบบทสนทนา';
      del.textContent = '×';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (t.id === activeThreadId) deleteCurrentThread();
        else deleteThreadById(t.id);
      });
      row.appendChild(btn);
      row.appendChild(del);
      threadList.appendChild(row);
    });
  }

  function nkbkConfirm(opts) {
    opts = opts || {};
    const title = opts.title != null ? String(opts.title) : '';
    const message = opts.message != null ? String(opts.message) : '';
    const okText = opts.okText || 'ยืนยัน';
    const cancelText = opts.cancelText || 'ยกเลิก';
    const variant = opts.variant || 'info';
    const iconMap = { danger: '✕', warning: '⚠', info: 'ℹ', success: '✓' };
    const iconChar = opts.icon || iconMap[variant] || 'ℹ';
    const esc = (s) =>
      String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'nkbk-modal-backdrop';
      backdrop.innerHTML =
        '<div class="nkbk-modal variant-' +
        esc(variant) +
        '" role="dialog" aria-modal="true">' +
        '<div class="nkbk-modal-body">' +
        '<div class="nkbk-modal-icon">' +
        esc(iconChar) +
        '</div>' +
        '<div class="nkbk-modal-content">' +
        (title ? '<div class="nkbk-modal-title">' + esc(title) + '</div>' : '') +
        (message ? '<div class="nkbk-modal-msg">' + esc(message) + '</div>' : '') +
        '</div></div>' +
        '<div class="nkbk-modal-actions">' +
        '<button type="button" class="nkbk-modal-btn nkbk-modal-btn-cancel" data-act="cancel">' +
        esc(cancelText) +
        '</button>' +
        '<button type="button" class="nkbk-modal-btn nkbk-modal-btn-ok" data-act="ok">' +
        esc(okText) +
        '</button></div></div>';
      document.body.appendChild(backdrop);
      requestAnimationFrame(() => backdrop.classList.add('show'));
      function cleanup(val) {
        backdrop.classList.remove('show');
        setTimeout(() => {
          try {
            backdrop.remove();
          } catch (_) {}
        }, 200);
        document.removeEventListener('keydown', onKey);
        resolve(val);
      }
      function onKey(ev) {
        if (ev.key === 'Escape') cleanup(false);
        else if (ev.key === 'Enter') cleanup(true);
      }
      backdrop.addEventListener('click', (ev) => {
        if (ev.target === backdrop) cleanup(false);
        const btn = ev.target.closest('[data-act]');
        if (!btn) return;
        cleanup(btn.getAttribute('data-act') === 'ok');
      });
      document.addEventListener('keydown', onKey);
    });
  }

  async function deleteThreadById(threadId) {
    if (sending || !threadId) return;
    const ok = await nkbkConfirm({
      title: 'ลบบทสนทนา?',
      message: 'ข้อความในบทสนทนานี้จะถูกลบถาวร',
      okText: 'ลบ',
      cancelText: 'ยกเลิก',
      variant: 'danger'
    });
    if (!ok) return;
    try {
      await threadAction('delete', threadId);
    } catch (e) {
      showBanner(e.message || 'ลบไม่สำเร็จ', 'error');
    }
  }

  async function threadAction(action, threadId) {
    const data = await apiPost('/api/nkbk-ai-threads', { action, threadId });
    if (!data.ok) throw new Error(data.message || 'ดำเนินการไม่สำเร็จ');
    threads = data.threads || [];
    activeThreadId = data.activeThreadId || activeThreadId;
    if (data.userCallName != null) updateCallNameDisplay(data.userCallName);
    renderThreadList();
    renderMessagesFromHistory(data.chatHistory || []);
    return data;
  }

  function buildMsgAvatar(role) {
    const av = document.createElement('div');
    av.className = 'nkbk-ai-msg-avatar';
    av.setAttribute('aria-hidden', 'true');
    if (role === 'user') {
      av.classList.add('nkbk-ai-msg-avatar--user');
      av.title = userCallName || 'คุณ';
      av.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';
    } else {
      const img = document.createElement('img');
      img.src = 'chatgpt-icon.svg';
      img.alt = '';
      av.appendChild(img);
    }
    return av;
  }

  function wrapUserBubble(bubble) {
    const col = document.createElement('div');
    col.className = 'nkbk-ai-msg-body';
    if (userCallName) {
      const name = document.createElement('div');
      name.className = 'nkbk-ai-msg-callname';
      name.textContent = userCallName;
      name.title = userCallName;
      col.appendChild(name);
    }
    col.appendChild(bubble);
    return col;
  }

  function copyToClipboard(text) {
    const value = String(text || '').trim();
    if (!value) return Promise.reject(new Error('empty'));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value);
    }
    return new Promise((resolve, reject) => {
      try {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  }

  function buildCopyButton(label, textToCopy, iconOnly) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nkbk-ai-copy-btn' + (iconOnly ? ' nkbk-ai-copy-btn--icon' : '');
    btn.title = label || 'คัดลอก';
    btn.setAttribute('aria-label', label || 'คัดลอก');
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>' +
      (iconOnly ? '' : '<span>คัดลอก</span>');
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await copyToClipboard(textToCopy);
        btn.classList.add('is-copied');
        btn.title = 'คัดลอกแล้ว';
        const span = btn.querySelector('span');
        if (span) span.textContent = 'คัดลอกแล้ว';
        setTimeout(() => {
          btn.classList.remove('is-copied');
          btn.title = label || 'คัดลอก';
          if (span) span.textContent = 'คัดลอก';
        }, 1400);
      } catch (_) {
        showBanner('คัดลอกไม่สำเร็จ', 'warn');
      }
    });
    return btn;
  }

  function buildCopyRow(label, textToCopy, iconOnly) {
    const row = document.createElement('div');
    row.className = 'nkbk-ai-copy-row';
    row.appendChild(buildCopyButton(label, textToCopy, iconOnly));
    return row;
  }

  const COMPOSER_INPUT_MIN = 42;
  const COMPOSER_INPUT_MAX = 168;

  function resizeComposerInput() {
    if (!inputEl) return;
    inputEl.style.height = 'auto';
    const h = Math.min(COMPOSER_INPUT_MAX, Math.max(COMPOSER_INPUT_MIN, inputEl.scrollHeight));
    inputEl.style.height = h + 'px';
    inputEl.style.overflowY = inputEl.scrollHeight > COMPOSER_INPUT_MAX ? 'auto' : 'hidden';
  }

  function resetComposerInput() {
    if (!inputEl) return;
    inputEl.style.height = COMPOSER_INPUT_MIN + 'px';
    inputEl.style.overflowY = 'hidden';
  }

  function appendMessage(role, text, images, opts) {
    const options = opts && typeof opts === 'object' ? opts : {};
    hideWelcome();
    const row = document.createElement('div');
    row.className = 'nkbk-ai-msg nkbk-ai-msg--' + role;
    row.appendChild(buildMsgAvatar(role));

    const bubble = document.createElement('div');
    bubble.className = 'nkbk-ai-bubble';

    if (Array.isArray(images) && images.length) {
      const gallery = document.createElement('div');
      gallery.className = 'nkbk-ai-gallery';
      images.forEach((img) => {
        if (img.omitted) return;
        if (img.b64 || img.dataUrl) gallery.appendChild(buildImageCard(img, role));
      });
      if (gallery.childNodes.length) bubble.appendChild(gallery);
    }

    if (text) {
      const txt = document.createElement('div');
      txt.className = 'nkbk-ai-text';
      txt.textContent = text;
      bubble.appendChild(txt);
      if (role === 'user') {
        bubble.appendChild(buildCopyRow('คัดลอก prompt', text, true));
      }
    }

    if (options.imagePrompt && String(options.imagePrompt).trim()) {
      const promptBox = document.createElement('div');
      promptBox.className = 'nkbk-ai-prompt-used';
      const promptLabel = document.createElement('div');
      promptLabel.className = 'nkbk-ai-prompt-used-label';
      promptLabel.textContent = 'Prompt ที่ใช้สร้างรูป';
      const promptText = document.createElement('div');
      promptText.className = 'nkbk-ai-prompt-used-text';
      promptText.textContent = options.imagePrompt;
      promptBox.appendChild(promptLabel);
      promptBox.appendChild(promptText);
      promptBox.appendChild(buildCopyRow('คัดลอก prompt', options.imagePrompt, true));
      bubble.appendChild(promptBox);
    }

    row.appendChild(role === 'user' ? wrapUserBubble(bubble) : bubble);
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return row;
  }

  function appendTyping(kind) {
    const row = document.createElement('div');
    row.className = 'nkbk-ai-msg nkbk-ai-msg--assistant nkbk-ai-msg--typing';
    row.id = 'nkbkAiTyping';
    row.appendChild(buildMsgAvatar('assistant'));
    const bubbleWrap = document.createElement('div');
    if (kind === 'image') {
      bubbleWrap.innerHTML = '<div class="nkbk-ai-bubble nkbk-ai-bubble--generating"><span class="nkbk-ai-gen-spinner"></span><span>กำลังสร้างรูป...</span></div>';
    } else {
      bubbleWrap.innerHTML = '<div class="nkbk-ai-bubble"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>';
    }
    row.appendChild(bubbleWrap.firstChild);
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function removeTyping() {
    const t = el('nkbkAiTyping');
    if (t) t.remove();
  }

  function refreshSendState() {
    const hasText = !!(inputEl && inputEl.value.trim());
    const hasAttach = pendingImages.length > 0;
    if (sendBtn) sendBtn.disabled = sending || !statusOk || (!hasText && !hasAttach);
    if (genBtn) genBtn.classList.toggle('active', generateMode);
  }

  function renderAttachPreview() {
    if (!attachPreview) return;
    if (!pendingImages.length) {
      attachPreview.innerHTML = '';
      attachPreview.classList.add('hidden');
      return;
    }
    attachPreview.classList.remove('hidden');
    attachPreview.innerHTML = '';
    pendingImages.forEach((img, idx) => {
      const chip = document.createElement('div');
      chip.className = 'nkbk-ai-attach-chip';
      const thumb = document.createElement('img');
      thumb.src = img.dataUrl;
      thumb.alt = '';
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'nkbk-ai-attach-remove';
      rm.textContent = '×';
      rm.addEventListener('click', () => {
        pendingImages.splice(idx, 1);
        renderAttachPreview();
        refreshSendState();
      });
      chip.appendChild(thumb);
      chip.appendChild(rm);
      attachPreview.appendChild(chip);
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  async function onFilesSelected(fileList) {
    const files = Array.from(fileList || []).slice(0, 4 - pendingImages.length);
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      if (f.size > 8 * 1024 * 1024) {
        showBanner('รูป ' + f.name + ' ใหญ่เกิน 8MB', 'warn');
        continue;
      }
      const dataUrl = await readFileAsDataUrl(f);
      pendingImages.push({ dataUrl, mime: f.type, name: f.name });
    }
    renderAttachPreview();
    refreshSendState();
  }

  async function apiGet(path) {
    const r = await fetch(path, { headers: headers(), cache: 'no-store' });
    return r.json();
  }

  async function apiPost(path, body) {
    const payload = body || {};
    const isImage = payload.mode === 'generate';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), isImage ? 300000 : 120000);
    try {
      const r = await fetch(path, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(payload),
        signal: ctrl.signal,
        cache: 'no-store'
      });
      return r.json();
    } catch (e) {
      if (e && e.name === 'AbortError') {
        throw new Error('OpenAI timeout — ลองใหม่อีกครั้ง');
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  function updateSubtitle(userCallNameArg) {
    updateCallNameDisplay(userCallNameArg);
  }

  async function loadStatus() {
    if (!token) {
      showBanner('ไม่พบ session — กรุณาเข้าสู่ระบบในแอป NKBKConnext แล้วเปิดใหม่', 'error');
      return;
    }
    try {
      const data = await apiGet('/api/nkbk-ai-status');
      if (!data.ok) throw new Error(data.message || 'ไม่สามารถโหลดสถานะ');
      if (!data.ready) {
        const dn = data.displayName || 'โมเน่';
        const msg = !data.enabled
          ? `ระบบ ${dn} AI ยังไม่เปิดใช้งาน`
          : !data.hasApiKey
            ? 'ยังไม่ได้ตั้งค่า OpenAI API Key'
            : `ไม่มีสิทธิ์ใช้งาน ${dn} AI`;
        showBanner(msg, 'warn');
        statusOk = false;
      } else {
        statusOk = true;
        if (titleEl && data.assistantName) titleEl.textContent = data.assistantName;
        updateSubtitle(data.userCallName);
      }
    } catch (e) {
      showBanner(e.message || 'โหลดสถานะไม่สำเร็จ', 'error');
    }
  }

  async function loadMemory() {
    if (!token) return;
    try {
      const data = await apiGet('/api/nkbk-ai-memory');
      if (!data.ok) return;
      if (standingEl) standingEl.value = data.standingInstructions || '';
      updateCallNameDisplay(data.userCallName);
      threads = data.threads || [];
      activeThreadId = data.activeThreadId || '';
      renderThreadList();
      renderMessagesFromHistory(data.chatHistory || []);
    } catch (_) {}
  }

  async function sendMessage(forceGenerate) {
    if (sending || !statusOk) return;
    const text = (inputEl && inputEl.value || '').trim();
    const images = pendingImages.slice();
    const wantsRefGen =
      images.length > 0 &&
      (forceGenerate ||
        generateMode ||
        /(?:เปลี่ยน|ใช้|จากรูป|จากภาพ|แก้|edit|อิง|reference|style|สร้าง|วาด|(?:ภาพ|รูป).*นี)/i.test(text));
    const isGenerate = forceGenerate || generateMode || wantsRefGen;
    if (!text && !images.length) return;

    sending = true;
    refreshSendState();

    const displayText = text || (isGenerate ? 'สร้างรูปจากภาพอ้างอิง' : '[ส่งรูปภาพ]');
    appendMessage('user', displayText, images.map((i) => ({ dataUrl: i.dataUrl, mime: i.mime })));

    if (inputEl) inputEl.value = '';
    resetComposerInput();
    pendingImages = [];
    generateMode = false;
    renderAttachPreview();

    appendTyping(isGenerate || /สร้าง|วาด|generate|draw|เปลี่ยน.*(?:ภาพ|รูป)/i.test(text) ? 'image' : 'chat');

    try {
      const payload = {
        message: text,
        mode: isGenerate ? 'generate' : 'auto',
        images: images.map((i) => ({ dataUrl: i.dataUrl }))
      };
      const data = await apiPost('/api/nkbk-ai-chat', payload);
      removeTyping();
      if (!data.ok) throw new Error(data.message || 'ส่งไม่สำเร็จ');

      const replyImages = (data.images || []).map((img) => ({
        mime: img.mime || 'image/png',
        b64: img.b64
      }));
      appendMessage('assistant', data.reply || '—', replyImages, {
        imagePrompt: data.imagePrompt || ''
      });

      if (data.memoryUpdated && standingEl) {
        standingEl.value = data.standingInstructions || standingEl.value;
        showBanner('บันทึกคำสั่งในความจำแล้ว', 'ok');
        setTimeout(() => bannerEl && bannerEl.classList.add('hidden'), 2200);
      }
      if (data.activeThreadId) activeThreadId = data.activeThreadId;
      try {
        const mem = await apiGet('/api/nkbk-ai-memory');
        if (mem.ok) {
          threads = mem.threads || threads;
          renderThreadList();
        }
      } catch (_) {}
    } catch (e) {
      removeTyping();
      appendMessage('assistant', '⚠ ' + (e.message || 'เกิดข้อผิดพลาด'));
    } finally {
      sending = false;
      refreshSendState();
    }
  }

  function openMemoryModal() {
    if (!memoryModal) return;
    if (callNameInput) callNameInput.value = userCallName;
    memoryModal.setAttribute('aria-hidden', 'false');
    memoryModal.classList.add('open');
  }

  function closeMemoryModal() {
    if (!memoryModal) return;
    memoryModal.setAttribute('aria-hidden', 'true');
    memoryModal.classList.remove('open');
  }

  async function saveMemory() {
    try {
      const data = await apiPost('/api/nkbk-ai-memory', {
        standingInstructions: standingEl ? standingEl.value : '',
        userCallName: callNameInput ? callNameInput.value.trim() : ''
      });
      if (!data.ok) throw new Error(data.message || 'บันทึกไม่สำเร็จ');
      updateCallNameDisplay(data.userCallName);
      showBanner('บันทึกแล้ว — ชื่อเรียก sync กับ LINE แล้ว', 'ok');
      setTimeout(() => bannerEl && bannerEl.classList.add('hidden'), 2200);
      closeMemoryModal();
    } catch (e) {
      showBanner(e.message || 'บันทึกไม่สำเร็จ', 'error');
    }
  }

  async function newThread() {
    if (sending) return;
    try {
      await threadAction('create');
    } catch (e) {
      showBanner(e.message || 'สร้างแชทใหม่ไม่สำเร็จ', 'error');
    }
  }

  async function deleteCurrentThread() {
    if (sending) return;
    const ok = await nkbkConfirm({
      title: 'ลบบทสนทนา?',
      message: 'ข้อความในบทสนทนานี้จะถูกลบถาวร',
      okText: 'ลบ',
      cancelText: 'ยกเลิก',
      variant: 'danger'
    });
    if (!ok) return;
    try {
      await threadAction('delete', activeThreadId);
    } catch (e) {
      showBanner(e.message || 'ลบไม่สำเร็จ', 'error');
    }
  }

  async function switchThread(threadId) {
    if (sending || !threadId || threadId === activeThreadId) return;
    try {
      await threadAction('switch', threadId);
    } catch (e) {
      showBanner(e.message || 'สลับบทสนทนาไม่สำเร็จ', 'error');
    }
  }

  if (inputEl) {
    resetComposerInput();
    inputEl.addEventListener('input', () => {
      resizeComposerInput();
      refreshSendState();
    });
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(false);
      }
    });
  }
  if (sendBtn) sendBtn.addEventListener('click', () => sendMessage(false));
  if (genBtn) {
    genBtn.addEventListener('click', () => {
      const hasText = !!(inputEl && inputEl.value.trim());
      const hasAttach = pendingImages.length > 0;
      if (hasText || hasAttach) {
        sendMessage(true);
        return;
      }
      generateMode = !generateMode;
      if (generateMode && inputEl) {
        inputEl.placeholder = 'อธิบายรูปที่ต้องการสร้าง...';
        inputEl.focus();
      } else if (inputEl) {
        inputEl.placeholder = 'พิมพ์ข้อความ หรือ สร้างรูป...';
      }
      refreshSendState();
    });
  }
  if (attachBtn && fileInput) {
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      onFilesSelected(fileInput.files);
      fileInput.value = '';
    });
  }
  if (el('btnNkbkAiMemory')) el('btnNkbkAiMemory').addEventListener('click', openMemoryModal);
  if (el('btnNkbkAiNewThread')) el('btnNkbkAiNewThread').addEventListener('click', newThread);
  if (el('nkbkAiMemoryClose')) el('nkbkAiMemoryClose').addEventListener('click', closeMemoryModal);
  if (el('nkbkAiMemoryCancel')) el('nkbkAiMemoryCancel').addEventListener('click', closeMemoryModal);
  if (el('nkbkAiMemoryBackdrop')) el('nkbkAiMemoryBackdrop').addEventListener('click', closeMemoryModal);
  if (el('nkbkAiMemorySave')) el('nkbkAiMemorySave').addEventListener('click', saveMemory);
  if (el('nkbkAiLightboxClose')) el('nkbkAiLightboxClose').addEventListener('click', closeLightbox);
  if (el('nkbkAiLightboxBackdrop')) el('nkbkAiLightboxBackdrop').addEventListener('click', closeLightbox);
  if (el('nkbkAiLightboxDownload')) {
    el('nkbkAiLightboxDownload').addEventListener('click', () => {
      if (lightboxDataUrl) downloadDataUrl(lightboxDataUrl, 'monet-' + Date.now() + '.png');
    });
  }

  document.querySelectorAll('.nkbk-ai-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const prompt = chip.getAttribute('data-prompt') || '';
      if (!inputEl || !prompt) return;
      const isImage = /สร้างรูป|วาดรูป|generate/i.test(prompt);
      inputEl.value = prompt;
      inputEl.dispatchEvent(new Event('input'));
      if (isImage) sendMessage(true);
      else sendMessage(false);
    });
  });

  if (typeof window.electronAPI !== 'undefined') {
    document.body.classList.add('electron');
    const btnMin = el('btnMinimize');
    const btnMax = el('btnMaximize');
    const btnCloseWin = el('btnClose');
    if (btnMin) btnMin.addEventListener('click', () => window.electronAPI.minimize());
    if (btnMax) btnMax.addEventListener('click', () => window.electronAPI.maximize());
    if (btnCloseWin) btnCloseWin.addEventListener('click', () => window.electronAPI.close());
  }

  loadStatus().then(loadMemory).then(refreshSendState);
})();
