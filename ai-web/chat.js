(function () {
  'use strict';

  function applyTheme() {
    try {
      const theme = localStorage.getItem('nkbk_ai_theme') || 'light';
      document.body.classList.toggle('theme-light', theme === 'light');
      document.body.classList.toggle('theme-dark', theme !== 'light');
    } catch (_) {}
  }
  applyTheme();

  const params = new URLSearchParams(location.search);
  let token = '';
  try {
    token = sessionStorage.getItem('nkbk_ai_token') || '';
  } catch (_) {}
  if (params.get('t')) {
    history.replaceState(null, '', location.pathname);
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
  const viewer = el('nkbkAiViewer');
  const viewerImg = el('nkbkAiViewerImg');
  const viewerTitle = el('nkbkAiViewerTitle');
  const viewerThumbs = el('nkbkAiViewerThumbs');
  const viewerAspectMenu = el('nkbkAiViewerAspectMenu');
  const viewerInput = el('nkbkAiViewerInput');
  const viewerSendBtn = el('nkbkAiViewerSend');
  const filesDrawer = el('nkbkAiFilesDrawer');
  const filesList = el('nkbkAiFilesList');
  const threadMenu = el('nkbkAiThreadMenu');
  const composerWrap = el('nkbkAiComposerWrap');
  let lightboxDataUrl = '';
  let viewerImages = [];
  let viewerIndex = 0;
  let currentChatHistory = [];
  let threadEngaged = false;
  const blobUrlCache = new Map();

  let sending = false;
  let statusOk = false;
  let userCallName = '';
  let activeThreadId = '';
  let threads = [];
  let pendingImages = [];
  let generateMode = false;
  const DEFAULT_PLACEHOLDER = 'ถามอะไรก็ได้';
  const GENERATE_PLACEHOLDER = 'อธิบายรูปที่ต้องการสร้าง...';

  function setGenerateMode(on) {
    generateMode = !!on;
    if (!generateMode) editImageMode = false;
    if (genBtn) {
      genBtn.classList.toggle('is-active', generateMode);
      genBtn.setAttribute('aria-pressed', generateMode ? 'true' : 'false');
    }
    if (inputEl) {
      if (!generateMode) inputEl.placeholder = DEFAULT_PLACEHOLDER;
      else if (editImageMode) inputEl.placeholder = 'อธิบายการแก้ไขที่ต้องการ...';
      else inputEl.placeholder = GENERATE_PLACEHOLDER;
    }
    refreshSendState();
  }

  function headers() {
    token = sessionStorage.getItem('nkbk_ai_token') || token;
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

  function openLightbox(dataUrl, opts) {
    openImageViewer(dataUrl, opts);
  }

  function closeLightbox() {
    closeImageViewer();
  }

  function collectThreadImages() {
    const out = [];
    (currentChatHistory || []).forEach((m) => {
      if (!m) return;
      const title =
        (m.role === 'user' ? m.content : m.content || m.images?.[0]?.caption || '') ||
        'Image created';
      historyImages(m).forEach((img) => {
        const src = imageSrc(img);
        if (!src) return;
        out.push({
          src,
          img,
          title: String(title).trim().slice(0, 80) || 'Image created',
          mime: img.mime || 'image/png'
        });
      });
    });
    return out;
  }

  async function renderImageViewer() {
    if (!viewer || !viewerImg) return;
    const item = viewerImages[viewerIndex];
    if (!item) return;
    lightboxDataUrl = item.src;
    const mainDisplay = await resolveImageDisplayUrl(item.src);
    viewerImg.onerror = null;
    viewerImg.src = mainDisplay || item.src;
    if (viewerTitle) viewerTitle.textContent = item.title || 'รูปภาพ';
    if (viewerThumbs) {
      viewerThumbs.innerHTML = '';
      for (let idx = 0; idx < viewerImages.length; idx++) {
        const img = viewerImages[idx];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nkbk-ai-viewer-thumb' + (idx === viewerIndex ? ' is-active' : '');
        btn.setAttribute('aria-label', img.title || 'รูปที่ ' + (idx + 1));
        const thumb = document.createElement('img');
        thumb.alt = '';
        const thumbDisplay = await resolveImageDisplayUrl(img.src);
        thumb.src = thumbDisplay || img.src;
        btn.appendChild(thumb);
        btn.addEventListener('click', () => {
          viewerIndex = idx;
          renderImageViewer();
        });
        viewerThumbs.appendChild(btn);
      }
    }
    if (viewerInput) {
      viewerInput.value = '';
      viewerInput.style.height = 'auto';
    }
    if (viewerSendBtn) viewerSendBtn.disabled = true;
  }

  function navigateViewer(delta) {
    if (!viewerImages.length) return;
    viewerIndex = Math.max(0, Math.min(viewerImages.length - 1, viewerIndex + delta));
    renderImageViewer();
  }

  function openImageViewer(dataUrl, opts) {
    if (!viewer) return;
    viewerImages = collectThreadImages();
    if (!viewerImages.length && dataUrl) {
      viewerImages = [{ src: dataUrl, title: 'รูปภาพ', img: {}, mime: 'image/png' }];
    }
    viewerIndex = 0;
    if (opts && typeof opts.index === 'number') viewerIndex = opts.index;
    else if (dataUrl) {
      const found = viewerImages.findIndex((x) => x.src === dataUrl);
      if (found >= 0) viewerIndex = found;
    }
    renderImageViewer();
    viewer.setAttribute('aria-hidden', 'false');
    viewer.classList.add('open');
    viewerAspectMenu?.classList.add('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeImageViewer() {
    if (!viewer) return;
    viewer.setAttribute('aria-hidden', 'true');
    viewer.classList.remove('open');
    lightboxDataUrl = '';
    viewerAspectMenu?.classList.add('hidden');
    document.body.style.overflow = '';
  }

  function getActiveThreadMeta() {
    return (threads || []).find((t) => t.id === activeThreadId) || null;
  }

  function sortThreadsClient(list) {
    return [...(list || [])]
      .filter((t) => !t.archived)
      .sort((a, b) => {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        if (a.pinned && b.pinned) return (b.pinnedAt || 0) - (a.pinnedAt || 0);
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });
  }

  function threadShareUrl(t) {
    const ref = (t && (t.shareId || t.id)) || activeThreadId;
    return location.origin + location.pathname + '?thread=' + encodeURIComponent(ref);
  }

  function syncThreadUrl() {
    const t = getActiveThreadMeta();
    if (!t || !threadEngaged) {
      history.replaceState(null, '', location.pathname);
      return;
    }
    history.replaceState(null, '', threadShareUrl(t));
  }

  function showWelcomeScreen() {
    if (!messagesEl || !welcomeEl) return;
    if (!messagesEl.contains(welcomeEl)) messagesEl.appendChild(welcomeEl);
    welcomeEl.style.display = '';
  }

  function updateComposerIdle() {
    const idle = !threadEngaged || !activeThreadId;
    if (composerWrap) composerWrap.classList.toggle('is-idle', idle);
  }

  function updateThreadChrome() {
    const hasThread = !!(threadEngaged && activeThreadId);
    el('btnThreadShare')?.classList.toggle('hidden', !hasThread);
    const t = getActiveThreadMeta();
    const pinLabel = el('nkbkAiMenuPinLabel');
    if (pinLabel) pinLabel.textContent = t && t.pinned ? 'ยกเลิกปักหมุด' : 'ปักหมุดแชต';
    if (threadMenu) {
      threadMenu.querySelectorAll('[data-action]').forEach((btn) => {
        const needsThread = btn.getAttribute('data-action') !== 'group';
        btn.classList.toggle('is-disabled', needsThread && !hasThread);
      });
    }
  }

  function showLandingState() {
    threadEngaged = false;
    activeThreadId = '';
    currentChatHistory = [];
    cancelInlineEdit();
    renderMessagesFromHistory([]);
    showWelcomeScreen();
    updateComposerIdle();
    updateThreadChrome();
    syncThreadUrl();
  }

  function getProfileUsername() {
    try {
      const profile = JSON.parse(sessionStorage.getItem('nkbk_ai_profile') || '{}');
      return String(profile.username || '').trim();
    } catch (_) {
      return '';
    }
  }

  function imageApiUrl(imageId) {
    const u = getProfileUsername();
    if (!u || !imageId) return '';
    const base = `/api/nkbk-ai-image/${encodeURIComponent(u)}/${encodeURIComponent(imageId)}`;
    const t = sessionStorage.getItem('nkbk_ai_token') || token || '';
    return t ? base + '?token=' + encodeURIComponent(t) : base;
  }

  function imageSrc(img) {
    if (!img) return '';
    if (img.publicUrl) return img.publicUrl;
    if (img.dataUrl) return img.dataUrl;
    if (img.b64) return dataUrlFromB64(img.b64, img.mime);
    if (img.url) {
      if (/^https:\/\/firebasestorage\.googleapis\.com\//i.test(img.url)) return img.url;
      const t = sessionStorage.getItem('nkbk_ai_token') || token || '';
      const sep = img.url.includes('?') ? '&' : '?';
      return t && !img.url.includes('token=') ? img.url + sep + 'token=' + encodeURIComponent(t) : img.url;
    }
    if (img.imageId) return imageApiUrl(img.imageId);
    return '';
  }

  async function resolveImageDisplayUrl(src) {
    const s = String(src || '').trim();
    if (!s) return '';
    if (s.startsWith('blob:') || s.startsWith('data:')) return s;
    if (blobUrlCache.has(s)) return blobUrlCache.get(s);
    const blob = await fetchImageBlobFromUrl(s);
    if (!blob) return s;
    const obj = URL.createObjectURL(blob);
    blobUrlCache.set(s, obj);
    return obj;
  }

  function bindImageLoadRetry(imageEl, src, onFail) {
    if (!imageEl || !src) return;
    imageEl.removeAttribute('crossorigin');
    imageEl.dataset.srcOriginal = src;
    imageEl.src = src;
    imageEl.addEventListener('error', async function onErr() {
      if (imageEl.dataset.retried === '1') {
        if (typeof onFail === 'function') onFail();
        return;
      }
      imageEl.dataset.retried = '1';
      const fallback = await resolveImageDisplayUrl(src);
      if (fallback && fallback !== src) {
        imageEl.src = fallback;
      } else if (typeof onFail === 'function') {
        onFail();
      }
    });
  }

  function isImageFilename(name) {
    return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(String(name || ''));
  }

  function guessImageMime(name) {
    const ext = String(name || '')
      .split('.')
      .pop()
      ?.toLowerCase();
    const map = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
      svg: 'image/svg+xml'
    };
    return map[ext] || 'image/png';
  }

  function isProbableImageDrag(dt) {
    if (!dt) return false;
    const types = Array.from(dt.types || []).map((t) => String(t).toLowerCase());
    if (types.includes('files') || types.includes('application/x-moz-file')) return true;
    if (types.some((t) => t === 'text/uri-list' || t === 'text/html' || t === 'url')) return true;
    try {
      return Array.from(dt.items || []).some(
        (item) =>
          (item.kind === 'file' && (item.type.startsWith('image/') || item.type === '' || isImageFilename(item.type))) ||
          (item.kind === 'string' && /uri-list|html|url/i.test(item.type))
      );
    } catch (_) {
      return false;
    }
  }

  async function fetchImageBlobFromUrl(url) {
    const src = String(url || '').trim();
    if (!src) return null;
    if (src.startsWith('data:')) {
      const r = await fetch(src);
      return r.blob();
    }
    const t = sessionStorage.getItem('nkbk_ai_token') || token || '';
    const opts = { cache: 'no-store', mode: 'cors' };
    if (src.startsWith('/') || src.includes('/api/nkbk-ai-image/')) {
      opts.headers = { 'X-Monitor-Token': t };
    }
    try {
      const r = await fetch(src, opts);
      if (r.ok) return r.blob();
    } catch (_) {}
    return null;
  }

  function imageElementToDataUrl(imgEl, mimeHint) {
    if (!imgEl || !imgEl.complete || !(imgEl.naturalWidth > 0)) return '';
    try {
      const mime = mimeHint && mimeHint.startsWith('image/') ? mimeHint : 'image/png';
      const canvas = document.createElement('canvas');
      canvas.width = imgEl.naturalWidth;
      canvas.height = imgEl.naturalHeight;
      canvas.getContext('2d').drawImage(imgEl, 0, 0);
      return canvas.toDataURL(mime);
    } catch (_) {
      return '';
    }
  }

  async function getImageFilesFromDataTransfer(dt) {
    const payload = captureDropPayload(dt);
    return resolveDropPayload(payload);
  }

  function captureDropPayload(dt) {
    const payload = { files: [], uriList: '', html: '', plain: '' };
    if (!dt) return payload;
    try {
      if (dt.items && dt.items.length) {
        for (const item of Array.from(dt.items)) {
          if (item.kind !== 'file') continue;
          const f = item.getAsFile();
          if (f) payload.files.push(f);
        }
      }
    } catch (_) {}
    if (!payload.files.length && dt.files && dt.files.length) {
      payload.files = Array.from(dt.files);
    }
    try {
      payload.uriList = dt.getData('text/uri-list') || '';
      payload.html = dt.getData('text/html') || '';
      payload.plain = dt.getData('text/plain') || '';
    } catch (_) {}
    return payload;
  }

  function parseImageUrlFromHtml(html) {
    const srcMatch = String(html || '').match(/<img[^>]+src=["']([^"']+)["']/i);
    if (srcMatch) return srcMatch[1];
    const bgMatch = String(html || '').match(/background-image:\s*url\(["']?([^"')]+)["']?\)/i);
    return bgMatch ? bgMatch[1] : '';
  }

  function isImageFileLike(f) {
    if (!f || !f.size) return false;
    if (f.type && f.type.startsWith('image/')) return true;
    if (isImageFilename(f.name)) return true;
    if (!f.type || f.type === 'application/octet-stream') return true;
    return false;
  }

  async function resolveDropPayload(payload) {
    const direct = (payload.files || []).filter(isImageFileLike);
    if (direct.length) return direct;

    const urls = [];
    const fromHtml = parseImageUrlFromHtml(payload.html);
    if (fromHtml) urls.push(fromHtml);
    const uriLines = String(payload.uriList || payload.plain || '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    urls.push(...uriLines);

    const out = [];
    const seen = new Set();
    for (const raw of urls) {
      const url = String(raw || '').trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      if (url.startsWith('data:image/') || url.startsWith('blob:') || /^https?:\/\//i.test(url)) {
        const blob = await fetchImageBlobFromUrl(url);
        if (blob && (blob.type.startsWith('image/') || !blob.type)) {
          out.push(new File([blob], 'dropped.png', { type: blob.type || guessImageMime(url) }));
        }
      }
    }
    return out;
  }

  let editImageMode = false;

  async function attachImageForEdit(src, mimeHint, imgEl) {
    if (!src) return;
    try {
      let dataUrl = src;
      let mime = mimeHint || 'image/png';
      if (!src.startsWith('data:')) {
        const blob = await fetchImageBlobFromUrl(src);
        if (blob) {
          mime = blob.type || mime;
          dataUrl = await readFileAsDataUrl(new File([blob], 'edit.png', { type: mime }));
        } else {
          const resolved = await resolveImageDisplayUrl(src);
          const blob2 = resolved && resolved.startsWith('blob:') ? await fetch(resolved).then((r) => r.blob()) : null;
          if (blob2) {
            mime = blob2.type || mime;
            dataUrl = await readFileAsDataUrl(new File([blob2], 'edit.png', { type: mime }));
          } else {
            const fromCanvas = imageElementToDataUrl(imgEl, mime);
            if (!fromCanvas) throw new Error('fetch failed');
            dataUrl = fromCanvas;
          }
        }
      }
      pendingImages = [{ dataUrl, mime, name: 'edit.png' }];
      editImageMode = true;
      setGenerateMode(true);
      renderAttachPreview();
      refreshSendState();
      if (inputEl) {
        inputEl.focus();
        resizeComposerInput();
      }
      el('nkbkAiComposerWrap')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (_) {
      showBanner('โหลดรูปเพื่อแก้ไขไม่สำเร็จ', 'warn');
    }
  }

  const ICON_CHEVRON_DOWN =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  const ICON_CHEVRON_UP =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 15l-6-6-6 6"/></svg>';
  const MSG_COLLAPSE_MAX_PX = 168;

  function resizeInlineTextarea(ta, maxPx) {
    if (!ta) return;
    const cap = maxPx || 320;
    ta.style.height = '0px';
    const h = Math.min(cap, Math.max(42, ta.scrollHeight));
    ta.style.height = h + 'px';
    ta.style.overflowY = ta.scrollHeight > cap ? 'auto' : 'hidden';
  }

  function appendExpandableText(bubble, text) {
    const value = String(text || '');
    if (!value.trim()) return;
    const wrap = document.createElement('div');
    wrap.className = 'nkbk-ai-text-wrap';
    const txt = document.createElement('div');
    txt.className = 'nkbk-ai-text';
    txt.textContent = value;
    wrap.appendChild(txt);
    bubble.appendChild(wrap);

    requestAnimationFrame(() => {
      if (txt.scrollHeight <= MSG_COLLAPSE_MAX_PX + 8) return;
      txt.classList.add('is-collapsed');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nkbk-ai-expand-btn';
      btn.innerHTML = 'ดูเพิ่มเติม ' + ICON_CHEVRON_DOWN;
      btn.addEventListener('click', () => {
        const collapsed = txt.classList.toggle('is-collapsed');
        btn.innerHTML = collapsed ? 'ดูเพิ่มเติม ' + ICON_CHEVRON_DOWN : 'แสดงน้อยลง ' + ICON_CHEVRON_UP;
      });
      wrap.appendChild(btn);
    });
  }

  function cancelInlineEdit() {
    if (!inlineEditRow) return;
    const saved = inlineEditRow._editSaved;
    if (saved) {
      if (saved.view && saved.view.parentElement) {
        const bubble = saved.view.parentElement;
        while (saved.view.firstChild) bubble.insertBefore(saved.view.firstChild, saved.view);
        saved.view.remove();
      }
      if (saved.actions) saved.actions.classList.remove('hidden');
      const bubble = inlineEditRow.querySelector('.nkbk-ai-bubble');
      const msgBody = inlineEditRow.querySelector('.nkbk-ai-msg-body');
      if (bubble) {
        bubble.style.width = '';
        bubble.style.minWidth = '';
        bubble.style.maxWidth = '';
      }
      if (msgBody) {
        msgBody.style.width = '';
        msgBody.style.minWidth = '';
      }
    }
    const editor = inlineEditRow.querySelector('.nkbk-ai-inline-edit');
    if (editor) editor.remove();
    inlineEditRow.classList.remove('is-editing');
    inlineEditRow._editSaved = null;
    inlineEditRow = null;
  }

  function startInlineEdit(row, text) {
    if (!row || sending) return;
    cancelInlineEdit();
    const bubble = row.querySelector('.nkbk-ai-bubble');
    const msgBody = row.querySelector('.nkbk-ai-msg-body');
    const actions = row.querySelector('.nkbk-ai-msg-actions');
    if (!bubble) return;

    const lockWidth = Math.max(bubble.offsetWidth, msgBody ? msgBody.offsetWidth : 0, 240);

    const viewParts = [];
    bubble.querySelectorAll('.nkbk-ai-text-wrap, .nkbk-ai-gallery, .nkbk-ai-text').forEach((n) => viewParts.push(n));
    const viewWrap = document.createElement('div');
    viewWrap.className = 'nkbk-ai-msg-view';
    viewParts.forEach((n) => viewWrap.appendChild(n));
    bubble.insertBefore(viewWrap, bubble.firstChild);
    viewWrap.classList.add('hidden');

    const editor = document.createElement('div');
    editor.className = 'nkbk-ai-inline-edit';
    const ta = document.createElement('textarea');
    ta.className = 'nkbk-ai-inline-edit-input';
    ta.value = String(text || '');
    ta.rows = 1;
    ta.setAttribute('aria-label', 'แก้ไขข้อความ');
    const actionsRow = document.createElement('div');
    actionsRow.className = 'nkbk-ai-inline-edit-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'nkbk-ai-inline-edit-cancel';
    cancelBtn.textContent = 'ยกเลิก';
    const sendBtnEdit = document.createElement('button');
    sendBtnEdit.type = 'button';
    sendBtnEdit.className = 'nkbk-ai-inline-edit-send';
    sendBtnEdit.textContent = 'ส่ง';
    actionsRow.appendChild(cancelBtn);
    actionsRow.appendChild(sendBtnEdit);
    editor.appendChild(ta);
    editor.appendChild(actionsRow);
    bubble.appendChild(editor);
    if (actions) actions.classList.add('hidden');

    if (lockWidth > 0) {
      const w = lockWidth + 'px';
      bubble.style.width = w;
      bubble.style.minWidth = w;
      bubble.style.maxWidth = w;
      editor.style.width = '100%';
      if (msgBody) {
        msgBody.style.width = w;
        msgBody.style.minWidth = w;
      }
    }

    row._editSaved = { view: viewWrap, actions };
    row.classList.add('is-editing');
    inlineEditRow = row;

    const doResize = () => resizeInlineTextarea(ta, 480);
    ta.addEventListener('input', doResize);
    doResize();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);

    cancelBtn.addEventListener('click', () => cancelInlineEdit());
    sendBtnEdit.addEventListener('click', () => {
      const next = ta.value.trim();
      if (!next) return;
      const idx = parseInt(row.dataset.historyIndex || '0', 10);
      cancelInlineEdit();
      sendMessageFromEdit(idx, next);
    });
    ta.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        cancelInlineEdit();
      } else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        sendBtnEdit.click();
      }
    });
  }

  function buildImageCard(img, role) {
    const wrap = document.createElement('div');
    wrap.className = 'nkbk-ai-image-card';
    const dataUrl = imageSrc(img);
    if (!dataUrl) return wrap;
    const imageEl = document.createElement('img');
    imageEl.alt = img.caption || 'รูปภาพ';
    imageEl.loading = 'lazy';
    imageEl.draggable = true;
    bindImageLoadRetry(imageEl, dataUrl, () => {
      wrap.classList.add('nkbk-ai-image-card--error');
      imageEl.alt = 'โหลดรูปไม่สำเร็จ';
      const hoverEl = wrap.querySelector('.nkbk-ai-image-hover');
      if (hoverEl) hoverEl.remove();
    });
    imageEl.addEventListener('click', () =>
      openLightbox(imageEl.dataset.srcOriginal || imageEl.currentSrc || dataUrl)
    );
    wrap.appendChild(imageEl);

    if (role === 'assistant') {
      const hover = document.createElement('div');
      hover.className = 'nkbk-ai-image-hover';
      hover.setAttribute('aria-hidden', 'true');

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'nkbk-ai-image-edit-btn';
      editBtn.textContent = 'แก้ไข';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (wrap.classList.contains('nkbk-ai-image-card--error')) {
          showBanner('โหลดรูปไม่สำเร็จ — ไม่สามารถแก้ไขได้', 'warn');
          return;
        }
        attachImageForEdit(dataUrl, img.mime || 'image/png', imageEl);
      });

      const dlBtn = document.createElement('button');
      dlBtn.type = 'button';
      dlBtn.className = 'nkbk-ai-image-dl-btn';
      dlBtn.title = 'ดาวน์โหลด';
      dlBtn.setAttribute('aria-label', 'ดาวน์โหลด');
      dlBtn.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>';
      dlBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        downloadDataUrl(dataUrl, 'monet-' + Date.now() + '.png');
      });

      hover.appendChild(editBtn);
      hover.appendChild(dlBtn);
      wrap.appendChild(hover);
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

  let displayMessageIndex = 0;
  let inlineEditRow = null;

  function shouldHideAssistantReplyText(text, images) {
    if (!images || !images.length) return false;
    const t = String(text || '').trim();
    if (!t) return true;
    return /^สร้างรูปให้แล้ว/i.test(t);
  }

  function renderMessagesFromHistory(chatHistory) {
    displayMessageIndex = 0;
    currentChatHistory = Array.isArray(chatHistory) ? chatHistory.slice() : [];
    if (!messagesEl) return;
    messagesEl.innerHTML = '';
    if (welcomeEl) messagesEl.appendChild(welcomeEl);
    if (currentChatHistory.length) {
      hideWelcome();
      currentChatHistory.forEach((m) => {
        if (m.role === 'user' || m.role === 'assistant') {
          const imgs = historyImages(m);
          const hideText = m.role === 'assistant' && shouldHideAssistantReplyText(m.content, imgs);
          appendMessage(m.role, hideText ? '' : m.content || '', imgs, {
            imageOnly: hideText
          });
        }
      });
    } else {
      showWelcomeScreen();
    }
  }

  function historyImages(m) {
    if (!m || !Array.isArray(m.images)) return [];
    return m.images
      .filter((img) => img && !img.omitted && (img.b64 || img.url || img.dataUrl || img.imageId))
      .map((img) => ({
        mime: img.mime || 'image/png',
        b64: img.b64,
        url: img.url,
        publicUrl: img.publicUrl,
        dataUrl: img.dataUrl,
        imageId: img.imageId,
        caption: img.caption
      }));
  }

  function renderThreadList() {
    if (!threadList) return;
    threadList.innerHTML = '';
    sortThreadsClient(threads).forEach((t) => {
      const row = document.createElement('div');
      row.className =
        'nkbk-ai-thread-item' +
        (t.id === activeThreadId && threadEngaged ? ' is-active' : '') +
        (t.pinned ? ' is-pinned' : '');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nkbk-ai-thread-item-btn';
      btn.textContent = t.title || 'แชท';
      btn.title = t.title || 'แชท';
      btn.addEventListener('click', () => selectThread(t.id));
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
      const data = await threadAction('delete', threadId);
      if (threadId === activeThreadId && !data.activeThreadId) showLandingState();
      else if (threadId === activeThreadId) {
        renderMessagesFromHistory(data.chatHistory || []);
        syncThreadUrl();
      }
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
    if (threadEngaged && activeThreadId) {
      renderMessagesFromHistory(data.chatHistory || []);
    }
    updateThreadChrome();
    return data;
  }

  function requireThreadSelected() {
    if (threadEngaged && activeThreadId) return true;
    showBanner('เลือกบทสนทนาจากเมนูด้านซ้าย หรือกด + แชทใหม่', 'warn');
    openSidebar();
    return false;
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

  const ICON_COPY =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  const ICON_EDIT =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';

  function buildMsgActionButton(label, iconHtml, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nkbk-ai-msg-action-btn';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = iconHtml;
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await onClick(btn);
      } catch (_) {
        showBanner('ดำเนินการไม่สำเร็จ', 'warn');
      }
    });
    return btn;
  }

  function buildMsgActions(role, text, imagePrompt, msgRow) {
    const parts = [];
    if (text) parts.push(String(text).trim());
    if (imagePrompt && role !== 'assistant') parts.push(String(imagePrompt).trim());
    const copyText = parts.join('\n\n').trim();
    if (!copyText && role !== 'user') return null;

    const row = document.createElement('div');
    row.className = 'nkbk-ai-msg-actions';

    if (copyText) {
      row.appendChild(
        buildMsgActionButton('คัดลอก', ICON_COPY, async (btn) => {
          await copyToClipboard(copyText);
          btn.classList.add('is-copied');
          setTimeout(() => btn.classList.remove('is-copied'), 1400);
        })
      );
    }

    if (role === 'user' && text && msgRow) {
      row.appendChild(
        buildMsgActionButton('แก้ไขข้อความ', ICON_EDIT, async () => {
          startInlineEdit(msgRow, text);
        })
      );
    }

    return row.childNodes.length ? row : null;
  }

  const COMPOSER_INPUT_MIN = 24;
  const COMPOSER_INPUT_MAX = 320;

  function resizeComposerInput() {
    if (!inputEl) return;
    inputEl.style.height = '0px';
    const scrollH = inputEl.scrollHeight;
    const h = Math.min(COMPOSER_INPUT_MAX, Math.max(COMPOSER_INPUT_MIN, scrollH));
    inputEl.style.height = h + 'px';
    inputEl.style.overflowY = scrollH > COMPOSER_INPUT_MAX ? 'auto' : 'hidden';
  }

  function resetComposerInput() {
    if (!inputEl) return;
    inputEl.style.height = COMPOSER_INPUT_MIN + 'px';
    inputEl.style.overflowY = 'hidden';
  }

  function appendMessage(role, text, images, opts) {
    const options = opts && typeof opts === 'object' ? opts : {};
    const imageList = Array.isArray(images) ? images : [];
    const imageOnly = !!options.imageOnly || (role === 'assistant' && imageList.length && shouldHideAssistantReplyText(text, imageList));
    const showText = text && String(text).trim() && !imageOnly;

    hideWelcome();
    const row = document.createElement('div');
    row.className = 'nkbk-ai-msg nkbk-ai-msg--' + role;
    row.dataset.historyIndex = String(displayMessageIndex);
    displayMessageIndex += 1;
    row.appendChild(buildMsgAvatar(role));

    const bubble = document.createElement('div');
    bubble.className = 'nkbk-ai-bubble';
    if (imageOnly) bubble.classList.add('nkbk-ai-bubble--image-only');

    if (imageList.length) {
      const gallery = document.createElement('div');
      gallery.className = 'nkbk-ai-gallery';
      imageList.forEach((img) => {
        if (img.omitted) return;
        if (imageSrc(img)) gallery.appendChild(buildImageCard(img, role));
      });
      if (gallery.childNodes.length) bubble.appendChild(gallery);
    }

    if (showText) appendExpandableText(bubble, text);

    const contentCol = document.createElement('div');
    contentCol.className = 'nkbk-ai-msg-content';
    contentCol.appendChild(bubble);
    const actions = buildMsgActions(role, showText ? text : '', options.imagePrompt, role === 'user' ? row : null);
    if (actions) contentCol.appendChild(actions);

    if (role === 'user') {
      row.appendChild(wrapUserBubble(contentCol));
    } else {
      row.appendChild(contentCol);
    }
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
    const canSend = threadEngaged && activeThreadId;
    if (sendBtn) sendBtn.disabled = sending || !statusOk || !canSend || (!hasText && !hasAttach);
    if (genBtn) genBtn.classList.toggle('is-active', generateMode);
    updateComposerIdle();
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
    const slots = 4 - pendingImages.length;
    if (slots <= 0) {
      showBanner('แนบได้สูงสุด 4 รูป', 'warn');
      return;
    }
    const files = Array.from(fileList || []).slice(0, slots);
    let added = 0;
    for (const f of files) {
      const mime = f.type || guessImageMime(f.name);
      if (!mime.startsWith('image/') && !isImageFilename(f.name)) continue;
      if (f.size > 8 * 1024 * 1024) {
        showBanner('รูป ' + (f.name || '') + ' ใหญ่เกิน 8MB', 'warn');
        continue;
      }
      const dataUrl = await readFileAsDataUrl(f);
      pendingImages.push({ dataUrl, mime, name: f.name || 'image.png' });
      added += 1;
    }
    if (!added && files.length) {
      showBanner('ไฟล์นี้ไม่ใช่รูปภาพ', 'warn');
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
    token = sessionStorage.getItem('nkbk_ai_token') || token;
    if (!token) {
      showBanner('กรุณาเข้าสู่ระบบด้วย LINE', 'error');
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
      renderThreadList();

      const threadParam = new URLSearchParams(location.search).get('thread');
      if (threadParam) {
        const t = threads.find((x) => x.id === threadParam || x.shareId === threadParam);
        if (t) {
          await selectThread(t.id, { fromUrl: true });
          return;
        }
      }
      showLandingState();
    } catch (_) {}
  }

  async function sendMessage(forceGenerate, rewindOpts) {
    if (sending || !statusOk) return;
    if (!requireThreadSelected()) return;
    const rewind = rewindOpts && typeof rewindOpts === 'object' ? rewindOpts : null;
    const text = rewind ? String(rewind.text || '').trim() : (inputEl && inputEl.value || '').trim();
    const images = rewind ? (rewind.images || []) : pendingImages.slice();
    const wantsRefGen =
      images.length > 0 &&
      (forceGenerate ||
        generateMode ||
        /(?:เปลี่ยน|ใช้|จากรูป|จากภาพ|แก้|edit|อิง|reference|style|สร้าง|วาด|(?:ภาพ|รูป).*นี)/i.test(text));
    const isGenerate = forceGenerate || generateMode || wantsRefGen;
    if (!text && !images.length) return;

    sending = true;
    refreshSendState();

    if (rewind && typeof rewind.rewindToMessageIndex === 'number') {
      const rows = messagesEl.querySelectorAll('.nkbk-ai-msg:not(.nkbk-ai-msg--typing)');
      rows.forEach((row) => {
        const idx = parseInt(row.dataset.historyIndex || '-1', 10);
        if (idx >= rewind.rewindToMessageIndex) row.remove();
      });
      displayMessageIndex = rewind.rewindToMessageIndex;
    }

    const displayText = text || (isGenerate ? 'สร้างรูปจากภาพอ้างอิง' : '[ส่งรูปภาพ]');
    appendMessage('user', displayText, images.map((i) => ({ dataUrl: i.dataUrl, mime: i.mime })));

    if (!rewind) {
      if (inputEl) inputEl.value = '';
      resetComposerInput();
      pendingImages = [];
      setGenerateMode(false);
      renderAttachPreview();
    }

    appendTyping(isGenerate || /สร้าง|วาด|generate|draw|เปลี่ยน.*(?:ภาพ|รูป)/i.test(text) ? 'image' : 'chat');

    try {
      const payload = {
        message: text,
        mode: isGenerate ? 'generate' : 'auto',
        images: images.map((i) => ({ dataUrl: i.dataUrl }))
      };
      if (rewind && typeof rewind.rewindToMessageIndex === 'number') {
        payload.rewindToMessageIndex = rewind.rewindToMessageIndex;
      }
      const data = await apiPost('/api/nkbk-ai-chat', payload);
      removeTyping();
      if (!data.ok) throw new Error(data.message || 'ส่งไม่สำเร็จ');

      const replyImages = (data.images || []).map((img) => ({
        mime: img.mime || 'image/png',
        b64: img.b64,
        url: img.url,
        publicUrl: img.publicUrl,
        imageId: img.imageId
      }));
      const imageOnly = !!data.generated && replyImages.length > 0;
      appendMessage('assistant', imageOnly ? '' : data.reply || '—', replyImages, {
        imageOnly
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
          if (Array.isArray(mem.chatHistory)) {
            currentChatHistory = mem.chatHistory;
          }
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

  function sendMessageFromEdit(messageIndex, text) {
    sendMessage(false, { text, images: [], rewindToMessageIndex: messageIndex });
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
      const data = await threadAction('create');
      threadEngaged = true;
      activeThreadId = data.activeThreadId || activeThreadId;
      renderMessagesFromHistory(data.chatHistory || []);
      updateComposerIdle();
      updateThreadChrome();
      syncThreadUrl();
      closeSidebar();
      if (inputEl) inputEl.focus();
    } catch (e) {
      showBanner(e.message || 'สร้างแชทใหม่ไม่สำเร็จ', 'error');
    }
  }

  async function deleteCurrentThread() {
    if (sending) return;
    if (!activeThreadId) return;
    const ok = await nkbkConfirm({
      title: 'ลบบทสนทนา?',
      message: 'ข้อความในบทสนทนานี้จะถูกลบถาวร',
      okText: 'ลบ',
      cancelText: 'ยกเลิก',
      variant: 'danger'
    });
    if (!ok) return;
    try {
      const data = await threadAction('delete', activeThreadId);
      if (!data.activeThreadId) showLandingState();
      else {
        threadEngaged = true;
        renderMessagesFromHistory(data.chatHistory || []);
        syncThreadUrl();
      }
    } catch (e) {
      showBanner(e.message || 'ลบไม่สำเร็จ', 'error');
    }
  }

  async function selectThread(threadId, opts) {
    if (sending || !threadId) return;
    if (threadId === activeThreadId && threadEngaged && !(opts && opts.force)) return;
    try {
      const data = await threadAction('switch', threadId);
      threadEngaged = true;
      activeThreadId = data.activeThreadId || threadId;
      renderMessagesFromHistory(data.chatHistory || []);
      updateComposerIdle();
      updateThreadChrome();
      if (!opts || !opts.fromUrl) syncThreadUrl();
      closeSidebar();
      closeThreadMenu();
    } catch (e) {
      showBanner(e.message || 'สลับบทสนทนาไม่สำเร็จ', 'error');
    }
  }

  async function togglePinActiveThread() {
    if (!activeThreadId) return;
    const t = getActiveThreadMeta();
    const action = t && t.pinned ? 'unpin' : 'pin';
    try {
      await threadAction(action, activeThreadId);
      showBanner(action === 'pin' ? 'ปักหมุดบทสนทนาแล้ว' : 'ยกเลิกปักหมุดแล้ว', 'ok');
      setTimeout(() => bannerEl && bannerEl.classList.add('hidden'), 1800);
    } catch (e) {
      showBanner(e.message || 'ดำเนินการไม่สำเร็จ', 'error');
    }
  }

  async function archiveActiveThread() {
    if (!activeThreadId) return;
    const ok = await nkbkConfirm({
      title: 'เก็บบทสนทนาถาวร?',
      message: 'บทสนทนานี้จะถูกซ่อนจากรายการด้านซ้าย',
      okText: 'เก็บถาวร',
      cancelText: 'ยกเลิก',
      variant: 'warning'
    });
    if (!ok) return;
    try {
      const data = await threadAction('archive', activeThreadId);
      if (!data.activeThreadId) showLandingState();
      else {
        threadEngaged = true;
        renderMessagesFromHistory(data.chatHistory || []);
        syncThreadUrl();
      }
      showBanner('เก็บบทสนทนาแล้ว', 'ok');
      setTimeout(() => bannerEl && bannerEl.classList.add('hidden'), 1800);
    } catch (e) {
      showBanner(e.message || 'เก็บถาวรไม่สำเร็จ', 'error');
    }
  }

  async function shareActiveThread() {
    if (!activeThreadId) return;
    const url = threadShareUrl(getActiveThreadMeta());
    try {
      await copyToClipboard(url);
      showBanner('คัดลอกลิงก์แชร์แล้ว', 'ok');
      setTimeout(() => bannerEl && bannerEl.classList.add('hidden'), 2000);
    } catch (_) {
      showBanner(url, 'info');
    }
  }

  function closeThreadMenu() {
    threadMenu?.classList.add('hidden');
    el('btnThreadMenu')?.setAttribute('aria-expanded', 'false');
  }

  function toggleThreadMenu() {
    if (!threadMenu) return;
    const isHidden = threadMenu.classList.contains('hidden');
    threadMenu.classList.toggle('hidden', !isHidden ? true : false);
    el('btnThreadMenu')?.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
  }

  function mimeToExtLabel(mime) {
    const m = String(mime || '').toLowerCase();
    if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
    if (m.includes('webp')) return 'webp';
    return 'png';
  }

  function formatFileName(item, idx) {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp =
      d.getDate() +
      ' ' +
      d.toLocaleString('th-TH', { month: 'short' }) +
      ' ' +
      (d.getFullYear() + 543) +
      ' ' +
      pad(d.getHours()) +
      '_' +
      pad(d.getMinutes()) +
      '_' +
      pad(d.getSeconds());
    const ext = mimeToExtLabel(item.mime);
    const base = (item.title || 'ChatGPT Image').replace(/[^\w\u0E00-\u0E7F\s-]/g, '').trim().slice(0, 40);
    return (base || 'ChatGPT Image') + ' ' + stamp + '.' + ext;
  }

  function renderFilesDrawer() {
    if (!filesList) return;
    const items = collectThreadImages();
    filesList.innerHTML = '';
    if (!items.length) {
      filesList.innerHTML = '<div class="nkbk-ai-drawer-empty">ยังไม่มีไฟล์ในบทสนทนานี้</div>';
      return;
    }
    items.forEach((item, idx) => {
      const ext = mimeToExtLabel(item.mime);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nkbk-ai-file-item';
      btn.innerHTML =
        '<span class="nkbk-ai-file-badge nkbk-ai-file-badge--' +
        ext +
        '">' +
        ext.toUpperCase() +
        '</span><span class="nkbk-ai-file-meta"><span class="nkbk-ai-file-name">' +
        formatFileName(item, idx) +
        '</span><span class="nkbk-ai-file-type">' +
        ext +
        '</span></span>';
      btn.addEventListener('click', () => {
        closeFilesDrawer();
        openImageViewer(item.src, { index: idx });
      });
      filesList.appendChild(btn);
    });
  }

  function openFilesDrawer() {
    if (!filesDrawer) return;
    if (!requireThreadSelected()) return;
    renderFilesDrawer();
    filesDrawer.classList.add('open');
    filesDrawer.setAttribute('aria-hidden', 'false');
    closeThreadMenu();
  }

  function closeFilesDrawer() {
    if (!filesDrawer) return;
    filesDrawer.classList.remove('open');
    filesDrawer.setAttribute('aria-hidden', 'true');
  }

  function applyViewerAspect(aspect) {
    const item = viewerImages[viewerIndex];
    if (!item) return;
    closeImageViewer();
    attachImageForEdit(item.src, item.mime || 'image/png', null);
    if (inputEl) {
      inputEl.value = 'สร้างภาพเดิมในอัตราส่วน ' + aspect;
      inputEl.dispatchEvent(new Event('input'));
    }
    setGenerateMode(true);
    if (inputEl) inputEl.focus();
    viewerAspectMenu?.classList.add('hidden');
  }

  async function submitViewerEdit() {
    if (!viewerInput || sending) return;
    const text = viewerInput.value.trim();
    if (!text) return;
    const item = viewerImages[viewerIndex];
    if (!item) return;
    closeImageViewer();
    await attachImageForEdit(item.src, item.mime || 'image/png', null);
    if (inputEl) {
      inputEl.value = text;
      inputEl.dispatchEvent(new Event('input'));
    }
    setGenerateMode(true);
    sendMessage(true);
  }

  async function shareViewerImage() {
    const item = viewerImages[viewerIndex];
    if (!item) return;
    try {
      await copyToClipboard(item.src.startsWith('http') ? item.src : threadShareUrl(getActiveThreadMeta()));
      showBanner('คัดลอกลิงก์แล้ว', 'ok');
      setTimeout(() => bannerEl && bannerEl.classList.add('hidden'), 2000);
    } catch (_) {
      showBanner('แชร์ไม่สำเร็จ', 'warn');
    }
  }

  if (inputEl) {
    resetComposerInput();
    inputEl.addEventListener('input', () => {
      resizeComposerInput();
      refreshSendState();
    });
    inputEl.addEventListener('focus', () => resizeComposerInput());
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
      setGenerateMode(!generateMode);
      if (generateMode && inputEl) inputEl.focus();
    });
  }
  if (attachBtn && fileInput) {
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      onFilesSelected(fileInput.files);
      fileInput.value = '';
    });
  }

  function setupGlobalImageDrop() {
    const app = document.querySelector('.nkbk-ai-app');
    if (!app) return;
    const composerWrap = el('nkbkAiComposerWrap');
    const overlay = el('nkbkAiDropOverlay');
    let dragActive = false;

    const showDrop = () => {
      dragActive = true;
      if (overlay) overlay.classList.remove('hidden');
      composerWrap?.classList.add('is-dragover');
      messagesEl?.classList.add('is-dragover');
    };
    const hideDrop = () => {
      dragActive = false;
      if (overlay) overlay.classList.add('hidden');
      composerWrap?.classList.remove('is-dragover');
      messagesEl?.classList.remove('is-dragover');
    };

    app.addEventListener(
      'dragenter',
      (e) => {
        if (!isProbableImageDrag(e.dataTransfer)) return;
        e.preventDefault();
        showDrop();
      },
      true
    );
    app.addEventListener(
      'dragover',
      (e) => {
        if (!isProbableImageDrag(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      },
      true
    );
    app.addEventListener(
      'dragleave',
      (e) => {
        if (!dragActive) return;
        const related = e.relatedTarget;
        if (related && app.contains(related)) return;
        hideDrop();
      },
      true
    );
    app.addEventListener(
      'drop',
      (e) => {
        if (!isProbableImageDrag(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        const payload = captureDropPayload(e.dataTransfer);
        hideDrop();
        resolveDropPayload(payload)
          .then((files) => {
            if (files.length) {
              return onFilesSelected(files).then(() => inputEl?.focus());
            }
            showBanner('วางรูปไม่สำเร็จ — ลองใช้ปุ่ม + แทน', 'warn');
          })
          .catch(() => showBanner('วางรูปไม่สำเร็จ — ลองใช้ปุ่ม + แทน', 'warn'));
      },
      true
    );

    document.addEventListener('dragover', (e) => {
      if (!isProbableImageDrag(e.dataTransfer)) return;
      e.preventDefault();
    });
    document.addEventListener('drop', (e) => {
      if (!isProbableImageDrag(e.dataTransfer)) return;
      if (app.contains(e.target)) return;
      e.preventDefault();
    });
  }

  setupGlobalImageDrop();

  if (inputEl) {
    inputEl.addEventListener('paste', async (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      const imageFiles = [];
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) imageFiles.push(f);
        }
      }
      if (!imageFiles.length) return;
      e.preventDefault();
      await onFilesSelected(imageFiles);
    });
  }
  if (el('btnNkbkAiMemory')) el('btnNkbkAiMemory').addEventListener('click', openMemoryModal);
  if (el('btnNkbkAiNewThread')) el('btnNkbkAiNewThread').addEventListener('click', newThread);
  if (el('nkbkAiMemoryClose')) el('nkbkAiMemoryClose').addEventListener('click', closeMemoryModal);
  if (el('nkbkAiMemoryCancel')) el('nkbkAiMemoryCancel').addEventListener('click', closeMemoryModal);
  if (el('nkbkAiMemoryBackdrop')) el('nkbkAiMemoryBackdrop').addEventListener('click', closeMemoryModal);
  if (el('nkbkAiMemorySave')) el('nkbkAiMemorySave').addEventListener('click', saveMemory);
  if (el('nkbkAiViewerClose')) el('nkbkAiViewerClose').addEventListener('click', closeImageViewer);
  if (viewer) {
    viewer.addEventListener(
      'wheel',
      (e) => {
        if (!viewer.classList.contains('open') || viewerImages.length < 2) return;
        e.preventDefault();
        navigateViewer(e.deltaY > 0 ? 1 : -1);
      },
      { passive: false }
    );
  }
  if (el('nkbkAiViewerDownload')) {
    el('nkbkAiViewerDownload').addEventListener('click', () => {
      if (lightboxDataUrl) downloadDataUrl(lightboxDataUrl, 'monet-' + Date.now() + '.png');
    });
  }
  if (el('nkbkAiViewerShare')) el('nkbkAiViewerShare').addEventListener('click', shareViewerImage);
  if (viewerSendBtn) viewerSendBtn.addEventListener('click', submitViewerEdit);
  if (viewerInput) {
    viewerInput.addEventListener('input', () => {
      if (viewerSendBtn) viewerSendBtn.disabled = !viewerInput.value.trim() || sending;
      viewerInput.style.height = 'auto';
      viewerInput.style.height = Math.min(120, viewerInput.scrollHeight) + 'px';
    });
    viewerInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitViewerEdit();
      }
    });
  }
  if (el('nkbkAiViewerAttach')) {
    el('nkbkAiViewerAttach').addEventListener('click', () => {
      const item = viewerImages[viewerIndex];
      if (item) attachImageForEdit(item.src, item.mime || 'image/png', null);
    });
  }
  if (el('nkbkAiViewerAspectBtn')) {
    el('nkbkAiViewerAspectBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      viewerAspectMenu?.classList.toggle('hidden');
    });
  }
  if (viewerAspectMenu) {
    viewerAspectMenu.querySelectorAll('[data-aspect]').forEach((btn) => {
      btn.addEventListener('click', () => applyViewerAspect(btn.getAttribute('data-aspect')));
    });
  }
  if (el('btnThreadShare')) el('btnThreadShare').addEventListener('click', shareActiveThread);
  if (el('btnThreadMenu')) el('btnThreadMenu').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleThreadMenu();
  });
  if (threadMenu) {
    threadMenu.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn || btn.classList.contains('is-disabled')) return;
      const action = btn.getAttribute('data-action');
      closeThreadMenu();
      if (action === 'files') openFilesDrawer();
      else if (action === 'pin') togglePinActiveThread();
      else if (action === 'archive') archiveActiveThread();
      else if (action === 'delete') deleteCurrentThread();
      else if (action === 'group' || action === 'project') {
        showBanner('ฟีเจอร์นี้จะเปิดใช้เร็วๆ นี้', 'info');
        setTimeout(() => bannerEl && bannerEl.classList.add('hidden'), 2200);
      }
    });
  }
  document.addEventListener('click', () => {
    closeThreadMenu();
    viewerAspectMenu?.classList.add('hidden');
  });
  if (el('nkbkAiFilesClose')) el('nkbkAiFilesClose').addEventListener('click', closeFilesDrawer);
  if (el('nkbkAiFilesBackdrop')) el('nkbkAiFilesBackdrop').addEventListener('click', closeFilesDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeImageViewer();
      closeFilesDrawer();
      closeThreadMenu();
    }
  });

  document.querySelectorAll('.nkbk-ai-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      if (!requireThreadSelected()) return;
      const prompt = chip.getAttribute('data-prompt') || '';
      if (!inputEl || !prompt) return;
      const isImage = /สร้างรูป|วาดรูป|generate/i.test(prompt);
      inputEl.value = prompt;
      inputEl.dispatchEvent(new Event('input'));
      if (isImage) {
        setGenerateMode(true);
        sendMessage(true);
      } else sendMessage(false);
    });
  });

  function openSidebar() {
    document.body.classList.add('sidebar-open');
  }
  function closeSidebar() {
    document.body.classList.remove('sidebar-open');
  }

  if (el('btnSidebarOpen')) el('btnSidebarOpen').addEventListener('click', openSidebar);
  if (el('btnSidebarClose')) el('btnSidebarClose').addEventListener('click', closeSidebar);
  if (el('sidebarBackdrop')) el('sidebarBackdrop').addEventListener('click', closeSidebar);

  if (el('btnThemeToggle')) {
    el('btnThemeToggle').addEventListener('click', () => {
      const next = document.body.classList.contains('theme-light') ? 'dark' : 'light';
      localStorage.setItem('nkbk_ai_theme', next);
      applyTheme();
    });
  }

  function bootChat() {
    token = sessionStorage.getItem('nkbk_ai_token') || '';
    loadStatus().then(loadMemory).then(refreshSendState);
  }

  window.addEventListener('nkbk-ai-auth-ready', bootChat);
})();
