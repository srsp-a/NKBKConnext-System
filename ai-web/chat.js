(function () {
  'use strict';

  function applyTheme() {
    try {
      const pref = localStorage.getItem('nkbk_ai_theme') || 'system';
      let theme = pref;
      if (pref === 'system') {
        theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      document.body.classList.toggle('theme-light', theme === 'light');
      document.body.classList.toggle('theme-dark', theme === 'dark');
    } catch (_) {}
  }
  applyTheme();
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if ((localStorage.getItem('nkbk_ai_theme') || 'system') === 'system') applyTheme();
    });
  }

  const params = new URLSearchParams(location.search);
  let initialThreadParam = String(params.get('thread') || '').trim();
  let token = '';
  try {
    token = (window.NkbkAiAuthStore && window.NkbkAiAuthStore.getToken()) || '' || '';
  } catch (_) {}
  if (params.get('t')) {
    const keep = initialThreadParam ? '?thread=' + encodeURIComponent(initialThreadParam) : '';
    history.replaceState(null, '', location.pathname + keep);
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
  const callBadgeEl = null;
  const welcomeTitleEl = el('nkbkAiWelcomeTitle');
  const bootSplashEl = el('nkbkAiBootSplash');
  const bootStatusEl = el('nkbkAiBootStatus');
  const callNameInput = el('nkbkAiCallNameInput');
  const threadList = el('nkbkAiThreadList');
  const standingEl = el('nkbkAiStandingInstructions');
  const settingsModal = el('nkbkAiSettingsModal');
  const viewer = el('nkbkAiViewer');
  const viewerImg = el('nkbkAiViewerImg');
  const viewerTitle = el('nkbkAiViewerTitle');
  const viewerThumbs = el('nkbkAiViewerThumbs');
  const viewerAspectMenu = el('nkbkAiViewerAspectMenu');
  const viewerInput = el('nkbkAiViewerInput');
  const viewerSendBtn = el('nkbkAiViewerSend');
  const viewerFileInput = el('nkbkAiViewerFileInput');
  const viewerAttachPreview = el('nkbkAiViewerAttachPreview');
  const filesDrawer = el('nkbkAiFilesDrawer');
  const filesList = el('nkbkAiFilesList');
  const threadMenu = el('nkbkAiThreadMenu');
  const composerWrap = el('nkbkAiComposerWrap');
  const starterActionsEl = el('nkbkAiStarterActions');
  const appEl = document.querySelector('.nkbk-ai-app');
  const searchModal = el('searchChatModal');
  const searchInput = el('searchChatInput');
  const searchResults = el('searchChatResults');
  const libraryPanel = el('nkbkAiLibrary');
  const libraryList = el('nkbkAiLibraryList');
  const libraryGrid = el('nkbkAiLibraryGrid');
  const librarySearchInput = el('librarySearchInput');
  const libraryListView = el('libraryListView');
  const libraryGridView = el('libraryGridView');
  const librarySelectionBar = el('librarySelectionBar');
  const librarySelectionCount = el('librarySelectionCount');
  const libraryToolbar = el('libraryToolbar');
  const libraryUploadInput = el('libraryUploadInput');
  const chatView = el('nkbkAiChatView');
  const sidebarThreadMenu = el('sidebarThreadMenu');
  const sidebarProfileMenu = el('sidebarProfileMenu');
  let menuThreadId = '';
  let sidebarThreadMenuFollowBound = false;
  let threadSwitchSeq = 0;
  const threadHistoryCache = new Map();
  let libraryItems = [];
  let libraryFilter = 'all';
  let libraryViewMode = 'list';
  let librarySelected = new Set();
  let libraryRowMenuOpen = '';
  let lightboxDataUrl = '';
  let viewerImages = [];
  let viewerIndex = 0;
  let viewerRenderGen = 0;
  let viewerEditRefIndex = -1;
  let viewerSidebarWasCollapsed = null;
  let currentChatHistory = [];
  let threadEngaged = false;
  const blobUrlCache = new Map();

  let sending = false;
  /** แชตที่กำลังรอ AI ตอบ (อนุญาตสลับแชตได้ — งานยังทำงานบนเซิร์ฟเวอร์ต่อ) */
  const inflightByThread = new Map();
  /** ข้อความที่ส่งจาก UI แต่เซิร์ฟเวอร์ยังไม่บันทึก (รอ generate เสร็จก่อน) */
  const pendingOutboundByThread = new Map();
  let composerMenuPortalEl = null;
  const threadsNeedRefresh = new Set();
  let statusOk = false;
  let userCallName = '';
  let welcomeGreetingSeq = 0;
  const WELCOME_LOAD_TIMEOUT_MS = 10000;
  let userPictureUrl = '';
  let activeThreadId = '';
  let threads = [];
  let landingMode = true;
  let bootStartedAt = 0;
  const BOOT_MIN_MS = 560;

  function isThreadSending(threadId) {
    return !!(threadId && inflightByThread.has(threadId));
  }

  function isActiveThreadSending() {
    return isThreadSending(activeThreadId);
  }

  function markInflightSend(threadId, meta) {
    if (!threadId) return;
    inflightByThread.set(threadId, {
      kind: 'chat',
      expectImage: false,
      beforeTs: 0,
      text: '',
      ...(meta || {})
    });
    sending = inflightByThread.size > 0;
  }

  function clearInflightSend(threadId) {
    if (threadId) inflightByThread.delete(threadId);
    sending = inflightByThread.size > 0;
  }

  function clearPendingOutbound(threadId) {
    if (threadId) pendingOutboundByThread.delete(threadId);
  }

  function mergePendingHistory(threadId, baseHistory) {
    const pending = pendingOutboundByThread.get(threadId);
    const base = Array.isArray(baseHistory) ? baseHistory.slice() : [];
    if (!pending || !pending.messages || !pending.messages.length) return base;
    const out = base.slice();
    pending.messages.forEach((pm) => {
      const exists = out.some(
        (m) =>
          m &&
          m.role === 'user' &&
          String(m.content || '') === String(pm.content || '') &&
          Math.abs((Number(m.ts) || 0) - (Number(pm.ts) || 0)) < 120000
      );
      if (!exists) out.push({ ...pm });
    });
    return out;
  }

  function reconcilePendingOutbound(threadId, serverHistory) {
    const pending = pendingOutboundByThread.get(threadId);
    const server = Array.isArray(serverHistory) ? serverHistory.slice() : [];
    if (!pending || !pending.messages || !pending.messages.length) return server;
    const pendingMsg = pending.messages[pending.messages.length - 1];
    const matched = server.some(
      (m) =>
        m &&
        m.role === 'user' &&
        String(m.content || '') === String(pendingMsg.content || '') &&
        Math.abs((Number(m.ts) || 0) - (Number(pendingMsg.ts) || 0)) < 300000
    );
    if (matched) {
      clearPendingOutbound(threadId);
      return server;
    }
    return mergePendingHistory(threadId, server);
  }

  function trackPendingUserSend(threadId, displayText, images, documents, opts) {
    if (!threadId) return;
    const options = opts && typeof opts === 'object' ? opts : {};
    const entry = {
      role: 'user',
      content: displayText,
      ts: Date.now(),
      _optimistic: true
    };
    const imageList = Array.isArray(images) ? images : [];
    const docList = Array.isArray(documents) ? documents : [];
    if (options.editRef && options.editRef.previewUrl) {
      entry.isImageEdit = true;
      entry.editRef = {
        mime: options.editRef.mime || 'image/png',
        dataUrl: options.editRef.previewUrl
      };
      const extras = Array.isArray(options.editExtras) ? options.editExtras : [];
      if (extras.length) {
        entry.editExtras = extras.map((x) => ({
          mime: x.mime || 'image/png',
          dataUrl: x.previewUrl
        }));
      }
    } else if (imageList.length) {
      entry.images = imageList.map((i) => ({
        mime: i.mime || 'image/png',
        dataUrl: i.dataUrl
      }));
    }
    if (docList.length) {
      entry.files = docList.map((f) => ({
        name: f.name || 'file',
        mime: f.mime || 'application/octet-stream'
      }));
    }
    pendingOutboundByThread.set(threadId, { messages: [entry] });
    const merged = mergePendingHistory(threadId, currentChatHistory);
    currentChatHistory = merged;
    rememberThreadHistory(threadId, merged);
  }

  function shouldShowInflightTyping(inflight) {
    if (!inflight) return false;
    const lastAsst = getLastAssistantMeta(currentChatHistory);
    if (inflight.beforeTs && lastAsst.ts > inflight.beforeTs) return false;
    return true;
  }

  function mapClientImagesForHistory(images) {
    return (images || [])
      .filter(Boolean)
      .map((img) => ({
        mime: img.mime || 'image/png',
        b64: img.b64,
        url: img.url || img.publicUrl,
        publicUrl: img.publicUrl || img.url,
        imageId: img.imageId,
        dataUrl: img.dataUrl
      }));
  }

  function stashBackgroundThreadResult(threadId, data, beforeLastAsstTs) {
    if (!threadId || !data || !data.ok) return;
    let hist = mergePendingHistory(threadId, threadHistoryCache.get(threadId) || []);
    const lastAsst = getLastAssistantMeta(hist);
    if (beforeLastAsstTs && lastAsst.ts > beforeLastAsstTs) {
      clearPendingOutbound(threadId);
      rememberThreadHistory(threadId, hist);
      return;
    }
    const replyImages = mapClientImagesForHistory(data.images);
    const imageOnly = !!data.generated && replyImages.length > 0;
    hist = hist.concat([
      {
        role: 'assistant',
        content: imageOnly ? '' : data.reply || '—',
        ts: Date.now(),
        ...(replyImages.length ? { images: replyImages } : {})
      }
    ]);
    rememberThreadHistory(threadId, hist);
    clearPendingOutbound(threadId);
  }

  function syncTypingForActiveThread() {
    removeTyping();
    const inflight = activeThreadId ? inflightByThread.get(activeThreadId) : null;
    if (!shouldShowInflightTyping(inflight)) {
      if (inflight && activeThreadId) clearInflightSend(activeThreadId);
      return;
    }
    if (inflight) appendTyping(inflight.kind || 'chat');
  }

  async function applyAssistantResultToUi(result, text, opts) {
    const replyImages = (result.images || []).map((img) => ({
      mime: img.mime || 'image/png',
      b64: img.b64,
      url: img.url,
      publicUrl: img.publicUrl,
      imageId: img.imageId,
      dataUrl: img.dataUrl
    }));
    const imageOnly = !!result.generated && replyImages.length > 0;
    appendMessage('assistant', imageOnly ? '' : result.reply || '—', replyImages, { imageOnly });
    notifyPromptCompletion(text, { generated: !!result.generated, images: replyImages });
    maybePlayResponseNotification(opts || {});
  }

  async function refreshActiveThreadFromServer() {
    try {
      const mem = await apiGet('/api/nkbk-ai-memory');
      if (!mem.ok) return;
      threads = mem.threads || threads;
      renderThreadList();
      if (Array.isArray(mem.chatHistory)) {
        const reconciled = reconcilePendingOutbound(
          activeThreadId,
          mergePendingHistory(activeThreadId, mem.chatHistory)
        );
        currentChatHistory = reconciled;
        rememberThreadHistory(activeThreadId, currentChatHistory);
        if (activeThreadId === (mem.activeThreadId || activeThreadId)) {
          renderMessagesFromHistory(currentChatHistory);
          syncTypingForActiveThread();
        }
      }
    } catch (_) {}
  }

  async function continueBackgroundRecovery(threadId, beforeLastAsstTs, expectImage, text, startedAt) {
    const recovered = await tryRecoverAssistantReply(beforeLastAsstTs, expectImage, {
      maxWaitMs: expectImage ? 240000 : 60000,
      silent: true
    });
    clearInflightSend(threadId);
    threadsNeedRefresh.add(threadId);
    if (!recovered) return;
    if (threadId === activeThreadId) {
      removeTyping();
      const lastAsst = getLastAssistantMeta(currentChatHistory);
      if (!beforeLastAsstTs || lastAsst.ts <= beforeLastAsstTs) {
        await applyAssistantResultToUi(recovered, text, {
          expectImageReply: expectImage,
          isGenerate: expectImage,
          startedAt
        });
      }
      await refreshActiveThreadFromServer();
      clearPendingOutbound(threadId);
      syncAppUrl();
    } else {
      stashBackgroundThreadResult(
        threadId,
        {
          ok: true,
          reply: recovered.reply,
          images: recovered.images,
          generated: recovered.generated
        },
        beforeLastAsstTs
      );
    }
    refreshSendState();
  }

  function setBootStatus(text) {
    if (bootStatusEl) bootStatusEl.textContent = text;
  }

  function showBootSplash(on) {
    if (appEl) appEl.classList.toggle('is-booting', on);
    if (!bootSplashEl) return;
    bootSplashEl.classList.toggle('is-hidden', !on);
    bootSplashEl.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  function finishBootSplash() {
    const elapsed = Date.now() - (bootStartedAt || Date.now());
    const wait = Math.max(0, BOOT_MIN_MS - elapsed);
    setTimeout(() => {
      showBootSplash(false);
      hideBanner();
      updateLandingLayout();
    }, wait);
  }
  let pendingAttachments = [];
  let generateMode = false;
  let activeStarter = '';
  const STARTER_WRITE_PREFIX = 'ช่วยเขียนหรือแก้ไขข้อความนี้ให้หน่อย:';
  const STARTER_SEARCH_PREFIX = 'ช่วยค้นหาและสรุปข้อมูลเกี่ยวกับ ';
  const LIBRARY_PATH = '/library';
  let attachLimits = {
    maxAttachCount: 10,
    maxSendMb: 25,
    maxImageMb: 8,
    maxDocMb: 10,
    storageQuotaGb: 5,
    threadQuotaGb: 1
  };
  let activeThreadStorage = null;
  const ACCEPT_IMAGE_RE = /\.(png|jpe?g|gif|webp)$/i;
  const ACCEPT_DOC_RE = /\.(pdf|docx|txt|md|pptx|xlsx)$/i;
  function applyAttachLimits(limits) {
    if (!limits || typeof limits !== 'object') return;
    attachLimits = {
      maxAttachCount: Number(limits.maxAttachCount) || 10,
      maxSendMb: Number(limits.maxSendMb) || 25,
      maxImageMb: Number(limits.maxImageMb) || 8,
      maxDocMb: Number(limits.maxDocMb) || 10,
      storageQuotaGb: Number(limits.storageQuotaGb) || 5,
      threadQuotaGb: Number(limits.threadQuotaGb) || 1
    };
  }

  function updateThreadQuotaBanner(storage) {
    if (!storage || typeof storage !== 'object') return;
    activeThreadStorage = storage;
    if (storage.overQuota) {
      const gb = attachLimits.threadQuotaGb || 1;
      showBanner(
        'แชตนี้ใช้พื้นที่เกิน ' +
          gb +
          ' GB แล้ว กรุณาเริ่มแชตใหม่เพื่อให้เว็บไซต์ทำงานได้อย่างราบรื่น',
        'warn'
      );
    }
  }

  function maxAttachCount() {
    return Math.max(1, Math.min(20, attachLimits.maxAttachCount || 10));
  }

  function maxImageBytes() {
    return Math.max(1, attachLimits.maxImageMb || 8) * 1024 * 1024;
  }

  function maxDocBytes() {
    return Math.max(1, attachLimits.maxDocMb || 10) * 1024 * 1024;
  }

  function maxSendBytes() {
    return Math.max(1, attachLimits.maxSendMb || 25) * 1024 * 1024;
  }

  function dataUrlByteSize(dataUrl) {
    const s = String(dataUrl || '');
    const i = s.indexOf(',');
    if (i < 0) return 0;
    return Math.floor((s.length - i - 1) * 0.75);
  }

  function loadImageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  async function compressImageDataUrl(dataUrl, maxBytes) {
    if (!dataUrl || dataUrlByteSize(dataUrl) <= maxBytes) return dataUrl;
    let img;
    try {
      img = await loadImageFromDataUrl(dataUrl);
    } catch (_) {
      return dataUrl;
    }
    const mime = 'image/jpeg';
    let maxEdge = 2048;
    let quality = 0.88;
    let lastOut = dataUrl;
    for (let attempt = 0; attempt < 10; attempt++) {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      const scale = Math.min(1, maxEdge / Math.max(w, h, 1));
      const cw = Math.max(1, Math.round(w * scale));
      const ch = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
      lastOut = canvas.toDataURL(mime, quality);
      if (dataUrlByteSize(lastOut) <= maxBytes) return lastOut;
      if (quality > 0.55) quality -= 0.08;
      else maxEdge = Math.floor(maxEdge * 0.78);
    }
    return lastOut;
  }

  async function prepareAttachmentsForSend(images, documents) {
    const outImages = [];
    let totalBytes = 0;
    for (const img of images) {
      if (img.librarySource && img.imageId) {
        outImages.push({
          mime: img.mime || 'image/png',
          name: img.name,
          imageId: img.imageId,
          libraryId: img.libraryId || '',
          _source: 'library'
        });
        continue;
      }
      let dataUrl = await compressImageDataUrl(img.dataUrl, maxImageBytes());
      const bytes = dataUrlByteSize(dataUrl);
      if (bytes > maxImageBytes()) {
        throw new Error('รูป ' + (img.name || '') + ' ใหญ่เกิน ' + attachLimits.maxImageMb + ' MB');
      }
      totalBytes += bytes;
      if (totalBytes > maxSendBytes()) {
        throw new Error('ขนาดแนบรวมเกิน ' + attachLimits.maxSendMb + ' MB — ลดจำนวนหรือขนาดรูป');
      }
      outImages.push({ dataUrl, mime: img.mime || 'image/jpeg', name: img.name });
    }
    const outDocs = [];
    for (const f of documents) {
      let bytes = 0;
      if (f.textContent != null) bytes = new Blob([String(f.textContent)]).size;
      else if (f.dataUrl) bytes = dataUrlByteSize(f.dataUrl);
      if (bytes > maxDocBytes()) {
        throw new Error('ไฟล์ ' + (f.name || '') + ' ใหญ่เกิน ' + attachLimits.maxDocMb + ' MB');
      }
      totalBytes += bytes;
      if (totalBytes > maxSendBytes()) {
        throw new Error('ขนาดแนบรวมเกิน ' + attachLimits.maxSendMb + ' MB');
      }
      outDocs.push(f);
    }
    return { images: outImages, documents: outDocs };
  }

  const DEFAULT_PLACEHOLDER = 'ถามอะไรก็ได้';
  const GENERATE_PLACEHOLDER = 'อธิบายรูปที่ต้องการสร้าง...';
  const BRAND_ORG = 'NKBKCOOP';
  let assistantDisplayName = 'โมเน่';

  function normalizeAssistantDisplayName(name) {
    return String(name || 'โมเน่')
      .replace(/^ChatGPT\s*/i, '')
      .replace(/^Chat\s*/i, '')
      .replace(/^น้อง/i, '')
      .trim() || 'โมเน่';
  }

  function setAssistantDisplayName(name) {
    assistantDisplayName = normalizeAssistantDisplayName(name);
    window.__nkbkAiDisplayName = assistantDisplayName;
    applyAssistantBranding();
  }

  function defaultDocumentTitle() {
    return 'Chat ' + assistantDisplayName + ' - ' + BRAND_ORG;
  }

  function threadDocumentTitle(threadTitle) {
    const t = String(threadTitle || '').trim().slice(0, 80);
    if (!t) return defaultDocumentTitle();
    return t + ' - Chat ' + assistantDisplayName + ' ' + BRAND_ORG;
  }

  function applyAssistantBranding() {
    const header = formatAssistantTitle(assistantDisplayName);
    const brandChat = 'Chat ' + assistantDisplayName;
    if (titleEl) titleEl.textContent = header;
    updateDocumentTitle();
    if (el('authTitle')) el('authTitle').textContent = brandChat;
    if (el('authBootBrand')) el('authBootBrand').textContent = brandChat;
    if (el('nkbkAiBootBrand')) el('nkbkAiBootBrand').textContent = header;
    const logo = el('sidebarLogoHome');
    if (logo) logo.setAttribute('aria-label', brandChat);
    const meta = document.querySelector('meta[name="description"]');
    if (meta) {
      meta.content = brandChat + ' — สหกรณ์ออมทรัพย์สาธารณสุขหนองคาย จำกัด';
    }
    if (window.NkbkAiSettings && window.NkbkAiSettings.applyBranding) {
      window.NkbkAiSettings.applyBranding(assistantDisplayName);
    }
  }

  window.NkbkAiBranding = {
    setAssistantDisplayName,
    getAssistantDisplayName: () => assistantDisplayName,
    defaultDocumentTitle,
    threadDocumentTitle,
    formatHeaderTitle: formatAssistantTitle
  };
  const EDIT_REF_ARROW_LIGHT =
    'https://res.cloudinary.com/dzs7zbikj/image/upload/v1779387312/Pngtree_turn_vector_arrow_diagram_6020102_j2xpjr.png';
  const EDIT_REF_ARROW_DARK =
    'https://res.cloudinary.com/dzs7zbikj/image/upload/v1779416700/turn_vector_arrow_diagram_6020102_j2xpjr_aegpv2.png';

  function getResolvedThemeMode() {
    if (document.body.classList.contains('theme-dark')) return 'dark';
    if (document.body.classList.contains('theme-light')) return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function getEditRefArrowUrl() {
    return getResolvedThemeMode() === 'dark' ? EDIT_REF_ARROW_DARK : EDIT_REF_ARROW_LIGHT;
  }

  function refreshEditRefArrows() {
    const url = getEditRefArrowUrl();
    document.querySelectorAll('.nkbk-ai-edit-ref-arrow img').forEach((img) => {
      if (img.src !== url) img.src = url;
    });
  }

  function maybePlayResponseNotification(opts) {
    const prefs = window.__nkbkAiUserPrefs || {};
    if (!prefs.notifySound || prefs.notifyResponses === false) return;
    const slow =
      !!(opts && (opts.expectImageReply || opts.isGenerate)) ||
      (opts && opts.startedAt && Date.now() - opts.startedAt > 4000);
    if (!slow && !document.hidden) return;
    if (window.NkbkAiSettings && window.NkbkAiSettings.playNotificationSound) {
      window.NkbkAiSettings.playNotificationSound();
    }
  }

  function setGenerateMode(on) {
    generateMode = !!on;
    if (!generateMode) editImageMode = false;
    if (genBtn) {
      genBtn.classList.toggle('is-active', generateMode);
      genBtn.setAttribute('aria-pressed', generateMode ? 'true' : 'false');
    }
    if (inputEl) {
      if (!generateMode) inputEl.placeholder = DEFAULT_PLACEHOLDER;
      else if (editImageMode) inputEl.placeholder = 'อธิบายแก้ไข...';
      else inputEl.placeholder = GENERATE_PLACEHOLDER;
    }
    refreshSendState();
  }

  function headers() {
    token = (window.NkbkAiAuthStore && window.NkbkAiAuthStore.getToken()) || '' || token;
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

  function hideBanner() {
    if (!bannerEl) return;
    bannerEl.textContent = '';
    bannerEl.classList.add('hidden');
  }

  function hideWelcome() {
    if (welcomeEl) welcomeEl.style.display = 'none';
  }

  function dataUrlFromB64(b64, mime) {
    return `data:${mime || 'image/png'};base64,${b64}`;
  }

  function imageIdFromPublicUrl(publicUrl) {
    try {
      const raw = String(publicUrl || '');
      const decoded = decodeURIComponent(raw);
      const m =
        decoded.match(/nkbk-ai-images\/[^/]+\/([a-zA-Z0-9_-]+)\.[a-z0-9]+/i) ||
        raw.match(/nkbk-ai-images%2F[^%]+%2F([a-zA-Z0-9_-]+)/i);
      return m ? m[1] : '';
    } catch (_) {
      return '';
    }
  }

  function imageDownloadSrc(img, fallbackSrc) {
    if (img && img.imageId) {
      const api = imageApiUrl(img.imageId);
      if (api) return api;
    }
    if (img && img.publicUrl) {
      const extracted = imageIdFromPublicUrl(img.publicUrl);
      if (extracted) {
        const api = imageApiUrl(extracted);
        if (api) return api;
      }
    }
    if (img && img.b64) return dataUrlFromB64(img.b64, img.mime);
    if (img && img.dataUrl) return img.dataUrl;
    return fallbackSrc || imageSrc(img);
  }

  function fetchBlobXHR(url) {
    return new Promise((resolve) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'blob';
        const t = (window.NkbkAiAuthStore && window.NkbkAiAuthStore.getToken()) || '' || token || '';
        if (
          t &&
          (url.startsWith('/') || url.includes('/api/nkbk-ai-image/') || url.includes(location.host))
        ) {
          xhr.setRequestHeader('X-Monitor-Token', t);
        }
        xhr.onload = () => {
          resolve(xhr.status >= 200 && xhr.status < 300 ? xhr.response : null);
        };
        xhr.onerror = () => resolve(null);
        xhr.send();
      } catch (_) {
        resolve(null);
      }
    });
  }

  async function blobFromLoadedImageElement(imgEl, mimeHint) {
    if (!imgEl || !imgEl.complete || !(imgEl.naturalWidth > 0)) return null;
    const src = imgEl.currentSrc || imgEl.src || '';
    if (src.startsWith('blob:') || src.startsWith('data:')) {
      try {
        const res = await fetch(src);
        if (res.ok) return await res.blob();
      } catch (_) {}
    }
    const mime = (mimeHint && mimeHint.startsWith('image/') ? mimeHint : null) || 'image/png';
    try {
      return await new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        canvas.width = imgEl.naturalWidth;
        canvas.height = imgEl.naturalHeight;
        canvas.getContext('2d').drawImage(imgEl, 0, 0);
        canvas.toBlob((b) => resolve(b || null), mime, 0.92);
      });
    } catch (_) {
      return null;
    }
  }

  async function resolveImageBlobForDownload(src, imgMeta, loadedImgEl) {
    const candidates = [];
    const apiSrc = imgMeta && imgMeta.imageId ? imageApiUrl(imgMeta.imageId) : '';
    if (apiSrc) candidates.push(apiSrc);
    const s = String(src || '').trim();
    if (s && !candidates.includes(s)) candidates.push(s);
    if (imgMeta && imgMeta.publicUrl && !candidates.includes(imgMeta.publicUrl)) {
      candidates.push(imgMeta.publicUrl);
    }

    for (const candidate of candidates) {
      if (blobUrlCache.has(candidate)) {
        try {
          const res = await fetch(blobUrlCache.get(candidate));
          if (res.ok) return await res.blob();
        } catch (_) {}
      }
      const fetched = await fetchImageBlobFromUrl(candidate);
      if (fetched) return fetched;
    }

    if (imgMeta?.b64) {
      try {
        const du = dataUrlFromB64(imgMeta.b64, imgMeta.mime);
        const res = await fetch(du);
        if (res.ok) return await res.blob();
      } catch (_) {}
    }
    if (imgMeta?.dataUrl) {
      try {
        const res = await fetch(imgMeta.dataUrl);
        if (res.ok) return await res.blob();
      } catch (_) {}
    }
    if (loadedImgEl) {
      const fromEl = await blobFromLoadedImageElement(loadedImgEl, imgMeta && imgMeta.mime);
      if (fromEl) return fromEl;
    }
    return null;
  }

  function isMobileDevice() {
    return (
      window.matchMedia('(max-width: 768px)').matches ||
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    );
  }

  async function saveBlobAsFile(blob, filename) {
    const name = filename || 'Mone-ai.png';
    const file = new File([blob], name, { type: blob.type || guessImageMime(name) });
    if (
      isMobileDevice() &&
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] })
    ) {
      try {
        await navigator.share({ files: [file], title: name });
        return true;
      } catch (err) {
        if (err && err.name === 'AbortError') return false;
      }
    }
    let revokeUrl = '';
    try {
      revokeUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = revokeUrl;
      a.download = name;
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return true;
    } finally {
      if (revokeUrl) setTimeout(() => URL.revokeObjectURL(revokeUrl), 2000);
    }
  }

  async function downloadDataUrl(dataUrl, filename, opts) {
    const imgMeta = opts && opts.imgMeta ? opts.imgMeta : null;
    const src = imageDownloadSrc(imgMeta, String(dataUrl || '').trim());
    const imgEl =
      (opts && opts.imgEl) ||
      (isViewerOpen() && viewerImg && viewerImg.complete ? viewerImg : null);
    if (!src && !imgMeta && !imgEl) return false;
    try {
      const blob = await resolveImageBlobForDownload(src, imgMeta, imgEl);
      if (!blob) {
        showBanner('ดาวน์โหลดไม่สำเร็จ', 'warn');
        return false;
      }
      return await saveBlobAsFile(blob, filename || 'Mone-ai.png');
    } catch (_) {
      showBanner('ดาวน์โหลดไม่สำเร็จ', 'warn');
      return false;
    }
  }

  async function downloadViewerImage() {
    const item = viewerImages[viewerIndex];
    if (!item) return;
    const ext = mimeToExtLabel((item && item.mime) || 'image/png');
    await downloadDataUrl(item.src, 'Mone-' + Date.now() + '.' + ext, {
      imgMeta: item.img,
      imgEl: viewerImg
    });
  }

  function openLightbox(dataUrl, opts) {
    const options = opts && typeof opts === 'object' ? opts : {};
    openImageViewer(dataUrl, { simple: true, single: true, ...options });
  }

  function closeLightbox() {
    closeImageViewer();
  }

  function imageDedupeKey(img) {
    if (!img) return '';
    if (img.imageId) return 'id:' + img.imageId;
    const pid = imageIdFromPublicUrl(img.publicUrl || img.url || imageSrc(img));
    if (pid) return 'id:' + pid;
    if (img.b64) return 'b64:' + String(img.b64).slice(0, 96);
    const src = imageSrc(img);
    if (!src) return '';
    if (src.startsWith('data:')) return 'data:' + src.slice(0, 96);
    try {
      const u = new URL(src, location.origin);
      return 'path:' + u.pathname;
    } catch (_) {
      return 'src:' + src.replace(/\?.*$/, '');
    }
  }

  function collectThreadImages() {
    const out = [];
    const seen = new Set();
    (currentChatHistory || []).forEach((m) => {
      if (!m) return;
      if (m.role === 'user' && m.isImageEdit) return;
      if (m.role !== 'user' && m.role !== 'assistant') return;
      const title =
        (m.role === 'user' ? m.content : m.content || m.images?.[0]?.caption || '') ||
        'Image created';
      historyImages(m).forEach((img) => {
        const key = imageDedupeKey(img);
        if (!key || seen.has(key)) return;
        const src = imageSrc(img);
        if (!src) return;
        seen.add(key);
        out.push({
          src,
          img,
          title: String(title).trim().slice(0, 80) || 'Image created',
          mime: img.mime || 'image/png',
          role: m.role
        });
      });
    });
    return out;
  }

  function findViewerImageIndex(dataUrl, imgMeta) {
    if (!viewerImages.length) return -1;
    if (imgMeta && typeof imgMeta === 'object') {
      const key = imageDedupeKey(imgMeta);
      if (key) {
        const byKey = viewerImages.findIndex((x) => x.img && imageDedupeKey(x.img) === key);
        if (byKey >= 0) return byKey;
      }
      const imageId = String(imgMeta.imageId || '').trim();
      if (imageId) {
        const byId = viewerImages.findIndex((x) => x.img && String(x.img.imageId || '') === imageId);
        if (byId >= 0) return byId;
      }
    }
    const src = String(dataUrl || '').trim();
    if (src) {
      const bySrc = viewerImages.findIndex((x) => x.src === src);
      if (bySrc >= 0) return bySrc;
      if (imgMeta) {
        const alt = imageSrc(imgMeta);
        if (alt) {
          const byAlt = viewerImages.findIndex((x) => x.src === alt);
          if (byAlt >= 0) return byAlt;
        }
      }
    }
    return -1;
  }

  async function renderImageViewer() {
    if (!viewer || !viewerImg) return;
    const item = viewerImages[viewerIndex];
    if (!item) return;
    const gen = ++viewerRenderGen;
    const simple = viewer.classList.contains('is-simple-view');
    lightboxDataUrl = item.src;
    const mainDisplay = await resolveImageDisplayUrl(item.src);
    if (gen !== viewerRenderGen) return;
    viewerImg.onerror = null;
    viewerImg.src = mainDisplay || item.src;
    if (viewerTitle) {
      if (simple) {
        viewerTitle.textContent = '';
      } else {
        const threadMeta = getActiveThreadMeta();
        viewerTitle.textContent = (threadMeta && threadMeta.title) || item.title || 'รูปภาพ';
      }
    }
    if (viewerThumbs) {
      viewerThumbs.innerHTML = '';
      if (!simple) {
        for (let idx = 0; idx < viewerImages.length; idx++) {
          const img = viewerImages[idx];
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'nkbk-ai-viewer-thumb' + (idx === viewerIndex ? ' is-active' : '');
          btn.setAttribute('aria-label', img.title || 'รูปที่ ' + (idx + 1));
          const thumb = document.createElement('img');
          thumb.src = img.src;
          thumb.alt = '';
          btn.appendChild(thumb);
          btn.addEventListener('click', () => {
            viewerIndex = idx;
            void renderImageViewer();
          });
          viewerThumbs.appendChild(btn);
        }
        const activeBtn = viewerThumbs.querySelector('.nkbk-ai-viewer-thumb.is-active');
        if (activeBtn) activeBtn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }
    if (viewerInput) {
      viewerInput.value = '';
      viewerInput.style.height = 'auto';
    }
    if (viewerSendBtn) viewerSendBtn.disabled = true;
    if (isViewerEditMode()) {
      void ensureViewerEditRef().then((ok) => {
        if (!ok || gen !== viewerRenderGen) return;
        syncAttachPreviews();
        refreshViewerSendState();
      });
    }
  }

  function navigateViewer(delta) {
    if (!viewerImages.length) return false;
    const next = viewerIndex + delta;
    if (next < 0 || next >= viewerImages.length) return false;
    viewerIndex = next;
    void renderImageViewer();
    return true;
  }

  function isViewerOpen() {
    return !!(viewer && viewer.classList.contains('open'));
  }

  function isViewerEditMode() {
    return !!(viewer && viewer.classList.contains('is-edit-mode'));
  }

  function openImageViewer(dataUrl, opts) {
    if (!viewer) return;
    const options = opts && typeof opts === 'object' ? opts : {};
    const single = options.single === true;
    const simple = single || options.simple === true;
    const editMode = !!(options.editMode || editImageMode || (!simple && !single));
    if (!editMode) cancelPendingImageEdit();
    viewerEditRefIndex = -1;
    if (single || simple) {
      viewerImages = [
        {
          src: dataUrl,
          title: '',
          img: options.imgMeta || {},
          mime: (options.imgMeta && options.imgMeta.mime) || 'image/png'
        }
      ];
      viewerIndex = 0;
    } else {
      viewerImages = collectThreadImages();
      if (!viewerImages.length && dataUrl) {
        viewerImages = [
          {
            src: dataUrl,
            title: 'รูปภาพ',
            img: options.imgMeta || {},
            mime: (options.imgMeta && options.imgMeta.mime) || 'image/png'
          }
        ];
      }
      viewerIndex = 0;
      if (typeof options.index === 'number' && options.index >= 0 && options.index < viewerImages.length) {
        viewerIndex = options.index;
      } else {
        const found = findViewerImageIndex(dataUrl, options.imgMeta);
        if (found >= 0) viewerIndex = found;
      }
    }
    void renderImageViewer();
    document.body.classList.add('is-viewer-open');
    if (simple) {
      viewerSidebarWasCollapsed = null;
    } else if (!isMobileSidebar()) {
      viewerSidebarWasCollapsed = document.body.classList.contains('sidebar-collapsed');
      document.body.classList.add('sidebar-collapsed');
    } else {
      viewerSidebarWasCollapsed = null;
      closeSidebar();
    }
    viewer.setAttribute('aria-hidden', 'false');
    viewer.classList.add('open');
    viewer.classList.toggle('is-simple-view', simple);
    viewer.classList.toggle('is-edit-mode', editMode);
    viewerAspectMenu?.classList.add('hidden');
    syncAppUrl();
    if (editMode) {
      requestAnimationFrame(() => {
        viewerInput?.focus();
      });
    }
  }

  function closeImageViewer(opts) {
    if (!viewer) return;
    const keepEdit = opts && opts.keepEdit;
    viewerEditRefIndex = -1;
    document.body.classList.remove('is-viewer-open');
    if (viewerSidebarWasCollapsed !== null) {
      document.body.classList.toggle('sidebar-collapsed', viewerSidebarWasCollapsed);
      viewerSidebarWasCollapsed = null;
    }
    if (isMobileSidebar()) closeSidebar();
    viewer.setAttribute('aria-hidden', 'true');
    viewer.classList.remove('open');
    viewer.classList.remove('is-edit-mode');
    viewer.classList.remove('is-simple-view');
    lightboxDataUrl = '';
    viewerAspectMenu?.classList.add('hidden');
    if (!keepEdit) cancelPendingImageEdit();
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

  function isLibraryPath(pathname) {
    const p = String(pathname || location.pathname || '');
    return p === LIBRARY_PATH || p.endsWith(LIBRARY_PATH);
  }

  function appHomePath() {
    return '/';
  }

  function threadSharePath(t) {
    const ref = (t && (t.shareId || t.id)) || activeThreadId;
    if (!ref) return appHomePath();
    return appHomePath() + '?thread=' + encodeURIComponent(ref);
  }

  function threadShareUrl(t) {
    return location.origin + threadSharePath(t);
  }

  function syncAppUrl() {
    if (isLibraryOpen()) {
      history.replaceState(null, '', LIBRARY_PATH);
      return;
    }
    if (threadEngaged && activeThreadId) {
      history.replaceState(null, '', threadSharePath(getActiveThreadMeta()));
      initialThreadParam = '';
      return;
    }
    history.replaceState(null, '', appHomePath());
    initialThreadParam = '';
  }

  function syncThreadUrl() {
    syncAppUrl();
  }

  function showWelcomeScreen() {
    if (!messagesEl || !welcomeEl) return;
    if (!messagesEl.contains(welcomeEl)) messagesEl.appendChild(welcomeEl);
    welcomeEl.style.display = '';
  }

  function updateLandingLayout() {
    if (appEl) appEl.classList.toggle('is-landing', landingMode);
    if (starterActionsEl) starterActionsEl.classList.toggle('hidden', !landingMode);
    if (composerWrap) composerWrap.classList.remove('is-idle');
  }

  function updateComposerIdle() {
    updateLandingLayout();
  }

  function formatAssistantTitle(name) {
    const raw = String(name || 'โมเน่')
      .replace(/^ChatGPT\s*/i, '')
      .replace(/^น้อง/i, '')
      .trim();
    return 'น้อง' + (raw || 'โมเน่');
  }

  function updateDocumentTitle() {
    const t = getActiveThreadMeta();
    if (threadEngaged && activeThreadId && t && t.title) {
      document.title = threadDocumentTitle(String(t.title).trim());
    } else {
      document.title = defaultDocumentTitle();
    }
  }

  function updateThreadChrome() {
    const hasThread = !!(threadEngaged && activeThreadId);
    el('btnThreadShare')?.classList.toggle('hidden', !hasThread);
    el('headerThreadMenuWrap')?.classList.toggle('hidden', !hasThread);
    const t = getActiveThreadMeta();
    const pinLabel = el('nkbkAiMenuPinLabel');
    if (pinLabel) pinLabel.textContent = t && t.pinned ? 'ยกเลิกปักหมุด' : 'ปักหมุดแชต';
    if (threadMenu) {
      threadMenu.querySelectorAll('[data-action]').forEach((btn) => {
        const needsThread = btn.getAttribute('data-action') !== 'group';
        btn.classList.toggle('is-disabled', needsThread && !hasThread);
      });
    }
    updateDocumentTitle();
  }

  function showLandingState() {
    landingMode = true;
    threadEngaged = false;
    activeThreadId = '';
    initialThreadParam = '';
    currentChatHistory = [];
    cancelInlineEdit();
    resetStarterState();
    hideBanner();
    renderMessagesFromHistory([]);
    showWelcomeScreen();
    updateLandingLayout();
    updateThreadChrome();
    updateThreadListActiveState();
    syncThreadUrl();
    void refreshWelcomeGreeting();
  }

  function getProfileUsername() {
    try {
      const profile = (window.NkbkAiAuthStore && window.NkbkAiAuthStore.getProfile()) || {};
      return String(profile.username || '').trim();
    } catch (_) {
      return '';
    }
  }

  function imageApiUrl(imageId) {
    const u = getProfileUsername();
    if (!u || !imageId) return '';
    const base = `/api/nkbk-ai-image/${encodeURIComponent(u)}/${encodeURIComponent(imageId)}`;
    const t = (window.NkbkAiAuthStore && window.NkbkAiAuthStore.getToken()) || '' || token || '';
    return t ? base + '?token=' + encodeURIComponent(t) : base;
  }

  function imageSrc(img) {
    if (!img) return '';
    if (img.publicUrl) return img.publicUrl;
    if (img.dataUrl) return img.dataUrl;
    if (img.b64) return dataUrlFromB64(img.b64, img.mime);
    if (img.url) {
      if (/^https:\/\/firebasestorage\.googleapis\.com\//i.test(img.url)) return img.url;
      const t = (window.NkbkAiAuthStore && window.NkbkAiAuthStore.getToken()) || '' || token || '';
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

  function isAcceptedFilename(name) {
    return ACCEPT_IMAGE_RE.test(String(name || '')) || ACCEPT_DOC_RE.test(String(name || ''));
  }

  function isProbableFileDrag(dt) {
    if (!dt) return false;
    const types = Array.from(dt.types || []).map((t) => String(t).toLowerCase());
    if (types.includes('files') || types.includes('application/x-moz-file')) return true;
    if (types.some((t) => t === 'text/uri-list' || t === 'text/html' || t === 'url')) return true;
    try {
      return Array.from(dt.items || []).some((item) => {
        if (item.kind === 'file') return true;
        return item.kind === 'string' && /uri-list|html|url/i.test(item.type);
      });
    } catch (_) {
      return false;
    }
  }

  function isProbableImageDrag(dt) {
    return isProbableFileDrag(dt);
  }

  async function fetchImageBlobFromUrl(url) {
    const src = String(url || '').trim();
    if (!src) return null;
    if (src.startsWith('data:') || src.startsWith('blob:')) {
      try {
        const r = await fetch(src);
        if (r.ok) return r.blob();
      } catch (_) {}
      return null;
    }
    const t = (window.NkbkAiAuthStore && window.NkbkAiAuthStore.getToken()) || '' || token || '';
    const opts = { cache: 'no-store', credentials: 'same-origin' };
    const isApi =
      src.startsWith('/') ||
      src.includes('/api/nkbk-ai-image/') ||
      (typeof location !== 'undefined' && src.includes(location.host));
    if (isApi) {
      opts.headers = { 'X-Monitor-Token': t };
    }
    try {
      const r = await fetch(src, opts);
      if (r.ok) return r.blob();
    } catch (_) {}
    if (isApi) {
      const xhrBlob = await fetchBlobXHR(src);
      if (xhrBlob) return xhrBlob;
    }
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
    const direct = (payload.files || []).filter((f) => isAcceptedFile(f));
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
  let pendingEditRef = null;

  async function prepareImageForEdit(src, mimeHint, imgMeta, imgEl) {
    const apiSrc = imageDownloadSrc(imgMeta, src);
    try {
      const blob = await resolveImageBlobForDownload(apiSrc, imgMeta, imgEl);
      if (!blob) return null;
      const mime = blob.type || mimeHint || 'image/png';
      const dataUrl = await readFileAsDataUrl(new File([blob], 'edit.png', { type: mime }));
      return { dataUrl, mime };
    } catch (_) {
      return null;
    }
  }

  function cancelPendingImageEdit() {
    if (!editImageMode && !pendingEditRef) return;
    pendingAttachments = pendingAttachments.filter((a) => !a.isEditRef);
    pendingEditRef = null;
    editImageMode = false;
    viewerEditRefIndex = -1;
    setGenerateMode(false);
    renderAttachPreview();
    viewer?.classList.remove('is-edit-mode');
  }

  async function startImageEdit(src, mimeHint, imgMeta, imgEl) {
    const prepared = await prepareImageForEdit(src, mimeHint, imgMeta, imgEl);
    if (!prepared) {
      showBanner('โหลดรูปเพื่อแก้ไขไม่สำเร็จ', 'warn');
      return false;
    }
    pendingAttachments = [
      { kind: 'image', dataUrl: prepared.dataUrl, mime: prepared.mime, name: 'edit.png', isEditRef: true }
    ];
    pendingEditRef = { previewUrl: prepared.dataUrl, mime: prepared.mime };
    editImageMode = true;
    setGenerateMode(true);
    renderAttachPreview();
    if (inputEl) inputEl.focus();
    return true;
  }

  async function attachImageForEdit(src, mimeHint, imgMeta, imgEl) {
    return startImageEdit(src, mimeHint, imgMeta, imgEl);
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

  function collectBubbleViewParts(bubble) {
    if (!bubble) return [];
    return Array.from(bubble.children).filter(
      (n) =>
        n.classList.contains('nkbk-ai-text-wrap') ||
        n.classList.contains('nkbk-ai-gallery') ||
        n.classList.contains('nkbk-ai-text')
    );
  }

  function repairExpandableTextWraps(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('.nkbk-ai-text-wrap').forEach((wrap) => {
      const btn = wrap.querySelector(':scope > .nkbk-ai-expand-btn');
      let txt = wrap.querySelector(':scope > .nkbk-ai-text');
      if (!btn) return;
      if (!txt) {
        const sibling = wrap.nextElementSibling;
        if (sibling && sibling.classList.contains('nkbk-ai-text')) {
          txt = sibling;
          wrap.insertBefore(txt, btn);
        }
      } else if (wrap.firstElementChild === btn) {
        wrap.insertBefore(txt, btn);
      }
    });
  }

  function restoreInlineEditView(bubble, saved) {
    if (!bubble || !saved || !saved.view) return;
    const anchor = saved.view;
    while (anchor.firstChild) {
      bubble.insertBefore(anchor.firstChild, anchor);
    }
    anchor.remove();
    repairExpandableTextWraps(bubble);
  }

  function cancelInlineEdit() {
    if (!inlineEditRow) return;
    const saved = inlineEditRow._editSaved;
    if (saved) {
      const bubble = inlineEditRow.querySelector('.nkbk-ai-bubble');
      if (bubble) {
        restoreInlineEditView(bubble, saved);
        bubble.style.width = '';
        bubble.style.minWidth = '';
        bubble.style.maxWidth = '';
      }
      if (saved.actions) saved.actions.classList.remove('hidden');
      const msgBody = inlineEditRow.querySelector('.nkbk-ai-msg-body');
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
    if (!row || isActiveThreadSending()) return;
    cancelInlineEdit();
    const bubble = row.querySelector('.nkbk-ai-bubble');
    const msgBody = row.querySelector('.nkbk-ai-msg-body');
    const actions = row.querySelector('.nkbk-ai-msg-actions');
    if (!bubble) return;

    const lockWidth = Math.max(bubble.offsetWidth, msgBody ? msgBody.offsetWidth : 0, 240);

    const viewParts = collectBubbleViewParts(bubble);
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
    imageEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const src = imageEl.dataset.srcOriginal || imageEl.currentSrc || dataUrl;
      if (role === 'user') {
        openImageViewer(src, { imgMeta: img, simple: true, single: true });
      } else {
        openImageViewer(src, { imgMeta: img, simple: false });
      }
    });
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
        const src = imageEl.dataset.srcOriginal || imageEl.currentSrc || dataUrl;
        openImageViewer(src, { imgMeta: img, simple: false, editMode: true });
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
        const ext = mimeToExtLabel(img.mime || 'image/png');
        void downloadDataUrl(imageDownloadSrc(img, dataUrl), 'Mone-' + Date.now() + '.' + ext, {
          imgMeta: img,
          imgEl: imageEl
        });
      });

      hover.appendChild(editBtn);
      hover.appendChild(dlBtn);
      wrap.appendChild(hover);
    }
    return wrap;
  }

  function fallbackWelcomeText() {
    return userCallName ? `${userCallName} วันนี้คุณคิดอะไรอยู่` : 'วันนี้คุณคิดอะไรอยู่';
  }

  function setWelcomeLoading() {
    if (!welcomeTitleEl) return;
    welcomeTitleEl.classList.add('is-loading');
    welcomeTitleEl.setAttribute('aria-busy', 'true');
    welcomeTitleEl.replaceChildren();
    const dots = document.createElement('span');
    dots.className = 'nkbk-ai-welcome-loading-dots';
    dots.setAttribute('aria-label', 'กำลังโหลด');
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      dots.appendChild(dot);
    }
    welcomeTitleEl.appendChild(dots);
  }

  function setWelcomeTitle(text) {
    if (!welcomeTitleEl) return;
    welcomeTitleEl.classList.remove('is-loading');
    welcomeTitleEl.removeAttribute('aria-busy');
    welcomeTitleEl.replaceChildren();
    welcomeTitleEl.textContent = text || fallbackWelcomeText();
  }

  async function refreshWelcomeGreeting() {
    if (!landingMode || !welcomeTitleEl) return;
    const seq = ++welcomeGreetingSeq;
    setWelcomeLoading();
    if (!token || !statusOk) {
      setWelcomeTitle(fallbackWelcomeText());
      return;
    }
    try {
      const data = await Promise.race([
        apiGet('/api/nkbk-ai-welcome'),
        new Promise((_, reject) => {
          window.setTimeout(() => reject(new Error('welcome_timeout')), WELCOME_LOAD_TIMEOUT_MS);
        })
      ]);
      if (seq !== welcomeGreetingSeq || !landingMode) return;
      if (data && data.ok && data.greeting) {
        setWelcomeTitle(data.greeting);
      } else {
        setWelcomeTitle(fallbackWelcomeText());
      }
    } catch (_) {
      if (seq !== welcomeGreetingSeq || !landingMode) return;
      setWelcomeTitle(fallbackWelcomeText());
    }
  }

  function updateCallNameDisplay(name) {
    userCallName = name && String(name).trim() ? String(name).trim() : '';
    ['sidebarProfileSub', 'sidebarProfileMenuSub'].forEach((id) => {
      const node = el(id);
      if (!node) return;
      node.textContent = userCallName;
      node.classList.toggle('hidden', !userCallName);
    });
    if (callNameInput && document.activeElement !== callNameInput) {
      callNameInput.value = userCallName;
    }
    if (landingMode) void refreshWelcomeGreeting();
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
          const editRef = m.role === 'user' ? resolveEditRefFromHistory(m) : null;
          const editExtras = m.role === 'user' ? resolveEditExtrasFromHistory(m) : null;
          const imgs = editRef ? [] : historyImages(m);
          const hideText = m.role === 'assistant' && shouldHideAssistantReplyText(m.content, imgs);
          appendMessage(m.role, hideText ? '' : m.content || '', imgs, {
            imageOnly: hideText,
            editRef,
            editExtras
          });
        }
      });
    } else {
      showWelcomeScreen();
    }
    repairExpandableTextWraps(messagesEl);
    if (activeThreadId) rememberThreadHistory(activeThreadId, currentChatHistory);
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

  function profileInitials(name) {
    const parts = String(name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return 'U';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function syncSidebarProfile(profile) {
    const p = profile && typeof profile === 'object' ? profile : {};
    try {
      if (!p.displayName && !p.username) {
        const stored = (window.NkbkAiAuthStore && window.NkbkAiAuthStore.getProfile()) || {};
        p.displayName = stored.displayName;
        p.username = stored.username;
        p.pictureUrl = stored.pictureUrl;
      }
    } catch (_) {}
    const name = p.displayName || p.username || 'ผู้ใช้';
    userPictureUrl = p.pictureUrl ? String(p.pictureUrl).trim() : '';
    ['sidebarProfileName', 'sidebarProfileMenuName'].forEach((id) => {
      const node = el(id);
      if (node) node.textContent = name;
    });
    ['sidebarProfileAvatar', 'sidebarProfileMenuAvatar'].forEach((id) => {
      const node = el(id);
      if (!node) return;
      if (p.pictureUrl) {
        node.innerHTML = '<img src="' + p.pictureUrl.replace(/"/g, '&quot;') + '" alt="">';
      } else {
        node.textContent = profileInitials(name);
      }
    });
    updateUserAvatarsInChat();
  }

  function formatRelativeDate(ts) {
    const d = new Date(ts || Date.now());
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startThat = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((startToday - startThat) / 86400000);
    if (diffDays === 0) return 'วันนี้';
    if (diffDays === 1) return 'เมื่อวาน';
    return d.toLocaleDateString('th-TH', { weekday: 'long' });
  }

  function formatFileSize(bytes) {
    const n = Number(bytes) || 0;
    if (n >= 1048576) return (n / 1048576).toFixed(2) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    if (n > 0) return n + ' B';
    return '—';
  }

  function libraryDisplaySize(item) {
    const n = Number(item && item.sizeBytes) || 0;
    if (n > 0) return formatFileSize(n);
    if (String(item && item.mime).startsWith('image/')) return '~176 KB';
    return '~78 KB';
  }

  function groupThreadsByDate(list) {
    const groups = new Map();
    sortThreadsClient(list).forEach((t) => {
      const label = formatRelativeDate(t.updatedAt || t.createdAt);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(t);
    });
    return groups;
  }

  function visibleThreads(list) {
    return sortThreadsClient(list).filter((t) => {
      const count = t.messageCount != null ? t.messageCount : Array.isArray(t.chatHistory) ? t.chatHistory.length : 0;
      return count > 0;
    });
  }

  const ICON_PIN =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22v-5"/><path d="M5 10.6c0-3.5 3.1-6.6 7-6.6s7 3.1 7 6.6c0 2.3-1.2 4.2-3 5.5l-1 5.4H9l-1-5.4C6.2 14.8 5 12.9 5 10.6z"/></svg>';

  function rememberThreadHistory(threadId, history) {
    if (!threadId) return;
    threadHistoryCache.set(threadId, Array.isArray(history) ? history.slice() : []);
  }

  function updateThreadListActiveState() {
    if (!threadList) return;
    threadList.querySelectorAll('.nkbk-ai-thread-item').forEach((row) => {
      const btn = row.querySelector('.nkbk-ai-thread-item-btn');
      const id = btn && btn.dataset.threadId;
      row.classList.toggle('is-active', !!(id === activeThreadId && threadEngaged));
    });
  }

  function renderThreadList() {
    if (!threadList) return;
    threadList.innerHTML = '';
    visibleThreads(threads).forEach((t) => {
      const row = document.createElement('div');
      row.className =
        'nkbk-ai-thread-item' +
        (t.id === activeThreadId && threadEngaged ? ' is-active' : '') +
        (t.pinned ? ' is-pinned' : '') +
        (menuThreadId === t.id ? ' is-menu-open' : '');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nkbk-ai-thread-item-btn';
      btn.textContent = t.title || 'แชท';
      btn.title = t.title || 'แชท';
      btn.dataset.threadId = t.id;
      btn.addEventListener('click', () => selectThread(t.id));
      const actions = document.createElement('div');
      actions.className = 'nkbk-ai-thread-item-actions';
      const pin = document.createElement('span');
      pin.className = 'nkbk-ai-thread-pin';
      pin.innerHTML = ICON_PIN;
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'nkbk-ai-thread-more';
      more.title = 'ตั้งค่าแชต';
      more.setAttribute('aria-label', 'ตั้งค่าแชต');
      more.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>';
      more.addEventListener('click', (e) => {
        e.stopPropagation();
        openSidebarThreadMenu(t.id, more);
      });
      actions.appendChild(pin);
      actions.appendChild(more);
      row.appendChild(btn);
      row.appendChild(actions);
      threadList.appendChild(row);
    });
    updateDocumentTitle();
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

  function nkbkPrompt(opts) {
    opts = opts || {};
    const title = opts.title != null ? String(opts.title) : '';
    const defaultValue = opts.defaultValue != null ? String(opts.defaultValue) : '';
    const okText = opts.okText || 'ตกลง';
    const cancelText = opts.cancelText || 'ยกเลิก';
    const maxLength = opts.maxLength || 120;
    const esc = (s) =>
      String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'nkbk-modal-backdrop';
      backdrop.innerHTML =
        '<div class="nkbk-modal nkbk-modal-prompt variant-info" role="dialog" aria-modal="true">' +
        '<div class="nkbk-modal-body nkbk-modal-body--prompt">' +
        '<div class="nkbk-modal-content nkbk-modal-content--full">' +
        (title ? '<div class="nkbk-modal-title">' + esc(title) + '</div>' : '') +
        '<input type="text" class="nkbk-modal-input" value="' +
        esc(defaultValue) +
        '" maxlength="' +
        esc(maxLength) +
        '" autocomplete="off">' +
        '</div></div>' +
        '<div class="nkbk-modal-actions">' +
        '<button type="button" class="nkbk-modal-btn nkbk-modal-btn-cancel" data-act="cancel">' +
        esc(cancelText) +
        '</button>' +
        '<button type="button" class="nkbk-modal-btn nkbk-modal-btn-ok" data-act="ok">' +
        esc(okText) +
        '</button></div></div>';
      document.body.appendChild(backdrop);
      const input = backdrop.querySelector('.nkbk-modal-input');
      requestAnimationFrame(() => {
        backdrop.classList.add('show');
        if (input) {
          input.focus();
          input.select();
        }
      });
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
        if (ev.key === 'Escape') cleanup(null);
        else if (ev.key === 'Enter') cleanup(input ? input.value.trim() : '');
      }
      backdrop.addEventListener('click', (ev) => {
        if (ev.target === backdrop) cleanup(null);
        const btn = ev.target.closest('[data-act]');
        if (!btn) return;
        if (btn.getAttribute('data-act') === 'ok') cleanup(input ? input.value.trim() : '');
        else cleanup(null);
      });
      if (input) {
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            cleanup(input.value.trim());
          }
        });
      }
      document.addEventListener('keydown', onKey);
    });
  }
  window.__nkbkConfirm = nkbkConfirm;

  async function deleteThreadById(threadId) {
    if (isThreadSending(threadId) || !threadId) return;
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

  async function threadAction(action, threadId, extra) {
    const body = { action, threadId };
    if (extra && typeof extra === 'object') Object.assign(body, extra);
    const data = await apiPost('/api/nkbk-ai-threads', body);
    if (!data.ok) throw new Error(data.message || 'ดำเนินการไม่สำเร็จ');
    threads = data.threads || [];
    activeThreadId = data.activeThreadId || activeThreadId;
    if (data.userCallName != null) updateCallNameDisplay(data.userCallName);
    if (action === 'switch') {
      updateThreadListActiveState();
    } else {
      renderThreadList();
    }
    if (threadEngaged && activeThreadId) {
      if (action === 'switch' && Array.isArray(data.chatHistory)) {
        rememberThreadHistory(activeThreadId, data.chatHistory);
      }
      if (action !== 'switch' || Array.isArray(data.chatHistory)) {
        renderMessagesFromHistory(data.chatHistory || []);
      }
    }
    updateThreadChrome();
    if (data.threadStorage) updateThreadQuotaBanner(data.threadStorage);
    return data;
  }

  async function ensureThreadBeforeSend() {
    if (activeThreadId) return true;
    try {
      const data = await apiPost('/api/nkbk-ai-threads', { action: 'create' });
      if (!data.ok) throw new Error(data.message || 'สร้างแชทไม่สำเร็จ');
      threads = data.threads || threads;
      activeThreadId = data.activeThreadId || activeThreadId;
      renderThreadList();
      return true;
    } catch (e) {
      showBanner(e.message || 'สร้างแชทไม่สำเร็จ', 'error');
      return false;
    }
  }

  function requireThreadSelected() {
    return !!(threadEngaged && activeThreadId);
  }

  function buildMsgAvatar(role) {
    const av = document.createElement('div');
    av.className = 'nkbk-ai-msg-avatar';
    av.setAttribute('aria-hidden', 'true');
    if (role === 'user') {
      av.classList.add('nkbk-ai-msg-avatar--user');
      av.title = userCallName || 'คุณ';
      if (userPictureUrl) {
        av.classList.add('has-photo');
        const img = document.createElement('img');
        img.src = userPictureUrl;
        img.alt = '';
        av.appendChild(img);
      } else {
        av.innerHTML =
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';
      }
    } else {
      const img = document.createElement('img');
      img.src = 'chatgpt-icon.svg';
      img.alt = '';
      av.appendChild(img);
    }
    return av;
  }

  function updateUserAvatarsInChat() {
    document.querySelectorAll('.nkbk-ai-msg--user .nkbk-ai-msg-avatar--user').forEach((av) => {
      if (userPictureUrl) {
        av.classList.add('has-photo');
        av.innerHTML = '<img src="' + userPictureUrl.replace(/"/g, '&quot;') + '" alt="">';
      } else {
        av.classList.remove('has-photo');
        av.innerHTML =
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';
      }
    });
  }

  function resolveEditRefFromHistory(m) {
    if (!m || !m.isImageEdit) return null;
    const ref = (m.editRef && (m.editRef.imageId || m.editRef.publicUrl || m.editRef.b64)) ? m.editRef : null;
    const imgMeta = ref || (Array.isArray(m.images) && m.images[0]) || null;
    if (!imgMeta) return null;
    const previewUrl = imageSrc(imgMeta);
    if (!previewUrl) return null;
    return { previewUrl, mime: imgMeta.mime || 'image/png', imageId: imgMeta.imageId };
  }

  function resolveEditExtrasFromHistory(m) {
    if (!m || !m.isImageEdit) return [];
    const raw = Array.isArray(m.editExtras) && m.editExtras.length ? m.editExtras : (Array.isArray(m.images) && m.images.length > 1 ? m.images.slice(1) : []);
    return raw
      .map((img) => {
        const previewUrl = imageSrc(img);
        if (!previewUrl) return null;
        return { previewUrl, mime: img.mime || 'image/png', imageId: img.imageId };
      })
      .filter(Boolean);
  }

  function buildEditRefBlock(editRef) {
    const wrap = document.createElement('div');
    wrap.className = 'nkbk-ai-edit-ref';
    const thumb = document.createElement('div');
    thumb.className = 'nkbk-ai-edit-ref-thumb';
    const img = document.createElement('img');
    img.src = editRef.previewUrl;
    img.alt = '';
    img.loading = 'lazy';
    thumb.appendChild(img);
    const arrow = document.createElement('span');
    arrow.className = 'nkbk-ai-edit-ref-arrow';
    const arrowImg = document.createElement('img');
    arrowImg.src = getEditRefArrowUrl();
    arrowImg.alt = '';
    arrow.appendChild(arrowImg);
    wrap.appendChild(thumb);
    wrap.appendChild(arrow);
    return wrap;
  }

  function buildUserAttachThumbsRow(images, role) {
    const row = document.createElement('div');
    row.className = 'nkbk-ai-user-attach-thumbs';
    (images || []).forEach((img) => {
      const src = imageSrc(img);
      if (!src) return;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'nkbk-ai-user-attach-thumb';
      const thumb = document.createElement('img');
      thumb.src = src;
      thumb.alt = '';
      thumb.loading = 'lazy';
      chip.appendChild(thumb);
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const simple = role === 'user';
        openImageViewer(src, { imgMeta: img, simple, single: simple });
      });
      row.appendChild(chip);
    });
    return row;
  }

  function buildEditExtrasRow(extras) {
    const row = document.createElement('div');
    row.className = 'nkbk-ai-edit-extras';
    (extras || []).forEach((ex) => {
      if (!ex || !ex.previewUrl) return;
      const chip = document.createElement('div');
      chip.className = 'nkbk-ai-edit-extra-thumb';
      const img = document.createElement('img');
      img.src = ex.previewUrl;
      img.alt = '';
      img.loading = 'lazy';
      chip.appendChild(img);
      row.appendChild(chip);
    });
    return row;
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
          if (window.NkbkAiPrompts && copyText) {
            void window.NkbkAiPrompts.track(copyText);
          }
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
    const editRef = options.editRef && options.editRef.previewUrl ? options.editRef : null;
    const editExtras = Array.isArray(options.editExtras) ? options.editExtras.filter((x) => x && x.previewUrl) : [];
    const hasText = !!(text && String(text).trim());
    const imageOnly =
      !!options.imageOnly ||
      (role === 'assistant' && imageList.length && shouldHideAssistantReplyText(text, imageList)) ||
      (role === 'user' && imageList.length && !hasText && !editRef);
    const showText = hasText && !imageOnly;

    hideWelcome();
    landingMode = false;
    threadEngaged = true;
    updateLandingLayout();
    const row = document.createElement('div');
    row.className = 'nkbk-ai-msg nkbk-ai-msg--' + role;
    row.dataset.historyIndex = String(displayMessageIndex);
    displayMessageIndex += 1;
    row.appendChild(buildMsgAvatar(role));

    const bubble = document.createElement('div');
    bubble.className = 'nkbk-ai-bubble';
    if (imageOnly) bubble.classList.add('nkbk-ai-bubble--image-only');
    if (role === 'user' && imageList.length) bubble.classList.add('nkbk-ai-bubble--with-user-image');

    const useCompactUserImages = role === 'user' && imageList.length >= 1 && !editRef;

    if (!useCompactUserImages && imageList.length && !editRef) {
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
    if (role === 'user' && editRef) contentCol.appendChild(buildEditRefBlock(editRef));
    if (role === 'user' && editExtras.length) contentCol.appendChild(buildEditExtrasRow(editExtras));
    if (useCompactUserImages) contentCol.appendChild(buildUserAttachThumbsRow(imageList, role));
    if (!(useCompactUserImages && !showText)) contentCol.appendChild(bubble);
    else bubble.remove();
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
      bubbleWrap.innerHTML =
        '<div class="nkbk-ai-bubble nkbk-ai-bubble--generating">' +
        '<div class="nkbk-ai-gen-preview" aria-hidden="true">' +
        '<div class="nkbk-ai-gen-shimmer"></div>' +
        '<div class="nkbk-ai-gen-shimmer nkbk-ai-gen-shimmer--delay"></div>' +
        '<span class="nkbk-ai-gen-orbit"><span></span><span></span><span></span></span>' +
        '</div>' +
        '<div class="nkbk-ai-gen-meta">' +
        '<span class="nkbk-ai-gen-label">กำลังสร้างรูป</span>' +
        '<span class="nkbk-ai-gen-bar" aria-hidden="true"><span></span></span>' +
        '</div></div>';
    } else {
      bubbleWrap.innerHTML = '<div class="nkbk-ai-bubble"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>';
    }
    row.appendChild(bubbleWrap.firstChild);
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setTypingStatus(text) {
    const row = el('nkbkAiTyping');
    if (!row) return;
    const label = row.querySelector('.nkbk-ai-gen-label');
    if (label) label.textContent = text;
  }

  function removeTyping() {
    const t = el('nkbkAiTyping');
    if (t) t.remove();
  }

  function pendingImages() {
    return pendingAttachments.filter((a) => a.kind === 'image');
  }

  function pendingDocuments() {
    return pendingAttachments.filter((a) => a.kind === 'document');
  }

  function refreshSendState() {
    const hasText = !!(inputEl && inputEl.value.trim());
    const hasAttach = pendingAttachments.length > 0;
    const busy = isActiveThreadSending();
    if (sendBtn) sendBtn.disabled = busy || !statusOk || (!hasText && !hasAttach);
    if (genBtn) genBtn.classList.toggle('is-active', generateMode);
    updateLandingLayout();
  }

  function fileExtLabel(name) {
    const ext = String(name || '')
      .split('.')
      .pop()
      ?.toLowerCase();
    return ext || 'file';
  }

  function guessDocMime(name) {
    const ext = fileExtLabel(name);
    const map = {
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      txt: 'text/plain',
      md: 'text/markdown',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };
    return map[ext] || 'application/octet-stream';
  }

  function isAcceptedFile(file) {
    if (!file) return false;
    const name = String(file.name || '');
    const type = String(file.type || '').toLowerCase();
    if (ACCEPT_IMAGE_RE.test(name) || type.startsWith('image/')) return true;
    if (ACCEPT_DOC_RE.test(name)) return true;
    return [
      'application/pdf',
      'text/plain',
      'text/markdown',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ].includes(type);
  }

  function classifyFile(file) {
    const name = String(file.name || '');
    const type = String(file.type || '').toLowerCase();
    if (type.startsWith('image/') || ACCEPT_IMAGE_RE.test(name)) return 'image';
    return 'document';
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = reject;
      r.readAsText(file);
    });
  }

  function renderAttachPreview() {
    if (!attachPreview) {
      renderViewerAttachPreview();
      return;
    }
    if (!pendingAttachments.length) {
      attachPreview.innerHTML = '';
      attachPreview.classList.add('hidden');
      renderViewerAttachPreview();
      return;
    }
    if (isViewerOpen()) {
      attachPreview.innerHTML = '';
      attachPreview.classList.add('hidden');
      renderViewerAttachPreview();
      return;
    }
    attachPreview.classList.remove('hidden');
    attachPreview.classList.toggle(
      'is-compact',
      pendingAttachments.some((item) => item && item.kind === 'image')
    );
    attachPreview.innerHTML = '';
    pendingAttachments.forEach((item, idx) => {
      const chip = document.createElement('div');
      chip.className = 'nkbk-ai-attach-chip' + (item.kind === 'document' ? ' nkbk-ai-attach-chip--doc' : '');
      if (item.kind === 'image') {
        const thumb = document.createElement('img');
        thumb.src = item.previewUrl || item.dataUrl || '';
        thumb.alt = '';
        chip.appendChild(thumb);
      } else {
        const badge = document.createElement('span');
        badge.className = 'nkbk-ai-attach-doc-badge';
        badge.textContent = fileExtLabel(item.name).toUpperCase();
        const label = document.createElement('span');
        label.className = 'nkbk-ai-attach-doc-name';
        label.textContent = item.name || 'ไฟล์';
        chip.appendChild(badge);
        chip.appendChild(label);
      }
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'nkbk-ai-attach-remove';
      rm.textContent = '×';
      rm.addEventListener('click', () => {
        pendingAttachments.splice(idx, 1);
        syncAttachPreviews();
        refreshSendState();
        refreshViewerSendState();
      });
      chip.appendChild(rm);
      attachPreview.appendChild(chip);
    });
    renderViewerAttachPreview();
  }

  function renderViewerAttachPreview() {
    if (!viewerAttachPreview) return;
    const extras = pendingAttachments.filter((a) => a.kind === 'image' && !a.isEditRef);
    if (!isViewerEditMode() || !extras.length) {
      viewerAttachPreview.innerHTML = '';
      viewerAttachPreview.classList.add('hidden');
      return;
    }
    viewerAttachPreview.classList.remove('hidden');
    viewerAttachPreview.innerHTML = '';
    extras.forEach((item) => {
      const realIdx = pendingAttachments.indexOf(item);
      const chip = document.createElement('div');
      chip.className = 'nkbk-ai-viewer-attach-chip';
      const thumb = document.createElement('img');
      thumb.src = item.previewUrl || item.dataUrl || '';
      thumb.alt = '';
      chip.appendChild(thumb);
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'nkbk-ai-viewer-attach-remove';
      rm.textContent = '×';
      rm.addEventListener('click', () => {
        if (realIdx >= 0) pendingAttachments.splice(realIdx, 1);
        syncAttachPreviews();
        refreshSendState();
        refreshViewerSendState();
      });
      chip.appendChild(rm);
      viewerAttachPreview.appendChild(chip);
    });
  }

  function syncAttachPreviews() {
    renderAttachPreview();
    renderViewerAttachPreview();
  }

  async function ensureViewerEditRef() {
    if (!isViewerEditMode()) return true;
    const item = viewerImages[viewerIndex];
    if (!item) return false;
    if (pendingAttachments.some((a) => a.isEditRef) && viewerEditRefIndex === viewerIndex) return true;
    pendingAttachments = pendingAttachments.filter((a) => !a.isEditRef);
    const prepared = await prepareImageForEdit(item.src, item.mime || 'image/png', item.img, viewerImg);
    if (!prepared) return false;
    pendingAttachments.unshift({
      kind: 'image',
      dataUrl: prepared.dataUrl,
      mime: prepared.mime,
      name: 'edit.png',
      isEditRef: true
    });
    pendingEditRef = { previewUrl: prepared.dataUrl, mime: prepared.mime };
    viewerEditRefIndex = viewerIndex;
    editImageMode = true;
    setGenerateMode(true);
    return true;
  }

  async function onViewerFilesSelected(fileList) {
    if (!isViewerEditMode()) return;
    const ok = await ensureViewerEditRef();
    if (!ok) {
      showBanner('โหลดรูปอ้างอิงไม่สำเร็จ', 'warn');
      return;
    }
    editImageMode = true;
    setGenerateMode(true);
    await onFilesSelected(fileList);
    syncAttachPreviews();
    refreshViewerSendState();
    viewerInput?.focus();
  }

  function refreshViewerSendState() {
    if (!viewerSendBtn) return;
    const hasText = !!(viewerInput && viewerInput.value.trim());
    const hasExtra = pendingAttachments.some((a) => a.kind === 'image' && !a.isEditRef);
    viewerSendBtn.disabled = isActiveThreadSending() || (!hasText && !hasExtra);
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
    const slots = maxAttachCount() - pendingAttachments.length;
    if (slots <= 0) {
      showBanner('แนบได้สูงสุด ' + maxAttachCount() + ' ไฟล์', 'warn');
      return;
    }
    const files = Array.from(fileList || []).slice(0, slots);
    let added = 0;
    for (const f of files) {
      if (!isAcceptedFile(f)) {
        showBanner('ไม่รองรับไฟล์ ' + (f.name || ''), 'warn');
        continue;
      }
      const kind = classifyFile(f);
      const maxSize = kind === 'image' ? maxImageBytes() : maxDocBytes();
      if (f.size > maxSize) {
        showBanner(
          (f.name || 'ไฟล์') + ' ใหญ่เกิน ' + (kind === 'image' ? attachLimits.maxImageMb : attachLimits.maxDocMb) + 'MB',
          'warn'
        );
        continue;
      }
      const name = f.name || (kind === 'image' ? 'image.png' : 'file');
      const mime = f.type || (kind === 'image' ? guessImageMime(name) : guessDocMime(name));
      if (kind === 'image') {
        const dataUrl = await readFileAsDataUrl(f);
        pendingAttachments.push({ kind: 'image', dataUrl, mime, name });
      } else if (/\.(txt|md)$/i.test(name) || mime.startsWith('text/')) {
        const textContent = await readFileAsText(f);
        pendingAttachments.push({ kind: 'document', name, mime, textContent });
      } else {
        const dataUrl = await readFileAsDataUrl(f);
        pendingAttachments.push({ kind: 'document', dataUrl, mime, name });
      }
      added += 1;
    }
    if (!added && files.length) {
      showBanner('ไม่สามารถแนบไฟล์ที่เลือกได้', 'warn');
    }
    renderAttachPreview();
    refreshSendState();
  }

  function friendlyApiError(err, fallback) {
    const raw = String((err && err.message) || err || '').trim();
    if (!raw) return fallback || 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง';
    if (/billing hard limit|hard limit has been reached/i.test(raw)) {
      return 'วงเงิน Hard limit ของ OpenAI เต็มแล้ว — เพิ่ม Hard limit ที่ platform.openai.com แล้วกดรีเซ็ตสถานะในแอดมิน';
    }
    if (/แชตนี้ใช้พื้นที่เกิน/i.test(raw)) return raw.slice(0, 240);
    if (/exceeded your current quota|insufficient quota|quota exceeded/i.test(raw)) {
      return 'โควต้า API OpenAI หมดแล้ว — ตรวจสอบ Credit Grants และ Hard limit ที่ OpenAI Billing';
    }
    if (/Unexpected token|not valid JSON|JSON\.parse/i.test(raw)) {
      return 'เซิร์ฟเวอร์ตอบกลับผิดปกติ — อาจแนบไฟล์ใหญ่เกินไป ลองลดขนาดหรือจำนวนรูป';
    }
    if (/entity too large|payload too large|request entity/i.test(raw)) {
      return 'แนบไฟล์รวมใหญ่เกินกำหนด (' + attachLimits.maxSendMb + ' MB) — ลดจำนวนหรือขนาดรูป';
    }
    if (/Failed to fetch|NetworkError|Load failed|network/i.test(raw)) {
      return 'เชื่อมต่อไม่สำเร็จ ตรวจสอบเน็ตแล้วลองใหม่';
    }
    if (/AbortError|timeout|timed out/i.test(raw)) {
      return 'ใช้เวลานานเกินไป ลองใหม่อีกครั้ง';
    }
    if (/[\u0E00-\u0E7F]/.test(raw)) return raw.slice(0, 240);
    return fallback || 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง';
  }

  function getLastAssistantMeta(hist) {
    const list = Array.isArray(hist) ? hist : [];
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i] && list[i].role === 'assistant') {
        return { msg: list[i], ts: list[i].ts || 0 };
      }
    }
    return { msg: null, ts: 0 };
  }

  async function fetchMemoryLenient() {
    try {
      const r = await fetch('/api/nkbk-ai-memory', { headers: headers(), cache: 'no-store' });
      const text = await r.text();
      if (!text) return null;
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  }

  async function tryRecoverAssistantReply(beforeLastAsstTs, expectImage, opts) {
    const options = opts && typeof opts === 'object' ? opts : {};
    if (!options.silent) setTypingStatus('กำลังดึงผลลัพธ์...');
    const maxWait = Number(options.maxWaitMs) || (expectImage ? 180000 : 45000);
    const started = Date.now();
    let delay = 1500;
    while (Date.now() - started < maxWait) {
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(4000, delay + 250);
      if (!options.silent && Date.now() - started > 30000) {
        setTypingStatus('กำลังสร้างรูป — รอสักครู่...');
      }
      const mem = await fetchMemoryLenient();
      if (!mem || !mem.ok || !Array.isArray(mem.chatHistory)) continue;
      const lastAsst = getLastAssistantMeta(mem.chatHistory);
      if (!lastAsst.msg || lastAsst.ts <= beforeLastAsstTs) continue;
      const imgs = historyImages(lastAsst.msg);
      if (expectImage && !imgs.length) continue;
      if (!expectImage && !String(lastAsst.msg.content || '').trim() && !imgs.length) continue;
      currentChatHistory = mem.chatHistory;
      if (Array.isArray(mem.threads)) {
        threads = mem.threads;
        renderThreadList();
      }
      if (mem.activeThreadId) activeThreadId = mem.activeThreadId;
      return {
        reply: lastAsst.msg.content || '',
        images: imgs,
        generated: expectImage && imgs.length > 0
      };
    }
    return null;
  }

  async function parseApiResponse(r) {
    const text = await r.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_) {
      if (r.status === 502 || r.status === 503) throw new Error('ระบบไม่พร้อม ลองใหม่ในสักครู่');
      if (r.status === 504 || r.status === 408) throw new Error('ใช้เวลานานเกินไป ลองใหม่อีกครั้ง');
      if (text.trim().startsWith('<!')) throw new Error('เซิร์ฟเวอร์ตอบกลับผิดปกติ ลองใหม่อีกครั้ง');
      throw new Error('รับข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง');
    }
    if (!r.ok) {
      throw new Error(data.message || friendlyApiError(null, 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง'));
    }
    return data;
  }

  async function apiGet(path) {
    const r = await fetch(path, { headers: headers(), cache: 'no-store' });
    return parseApiResponse(r);
  }

  async function apiPost(path, body) {
    const payload = body || {};
    const isImage = payload.mode === 'generate';
    const attachCount = (payload.images || []).length + (payload.files || []).length;
    const timeoutMs = isImage ? (attachCount >= 3 ? 360000 : 300000) : 120000;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(path, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(payload),
        signal: ctrl.signal,
        cache: 'no-store'
      });
      return parseApiResponse(r);
    } catch (e) {
      if (e && e.name === 'AbortError') {
        throw new Error('ใช้เวลานานเกินไป ลองใหม่อีกครั้ง');
      }
      throw new Error(friendlyApiError(e));
    } finally {
      clearTimeout(timer);
    }
  }


  async function loadUserPrefs() {
    if (!token) return;
    try {
      const data = await apiGet('/api/nkbk-ai-settings');
      if (data && data.preferences) {
        window.__nkbkAiUserPrefs = data.preferences;
        if (data.preferences.theme && window.NkbkAiSettings) {
          window.NkbkAiSettings.applyThemeFromPref(data.preferences.theme);
        }
      }
      if (data && data.assistantDisplayName) {
        setAssistantDisplayName(data.assistantDisplayName);
      }
      if (data && data.savedPrompts && window.NkbkAiPrompts) {
        window.NkbkAiPrompts.initFromSettings(data);
      }
    } catch (_) {}
  }

  async function loadStatus() {
    token = (window.NkbkAiAuthStore && window.NkbkAiAuthStore.getToken()) || '' || token;
    if (!token) {
      showBanner('กรุณาเข้าสู่ระบบด้วย LINE', 'error');
      return;
    }
    setBootStatus('กำลังเชื่อมต่อระบบ...');
    try {
      const data = await apiGet('/api/nkbk-ai-status');
      if (!data.ok) throw new Error(data.message || 'ไม่สามารถโหลดสถานะ');
      if (!data.ready) {
        const dn = data.displayName || 'โมเน่';
        setAssistantDisplayName(dn);
        applyAttachLimits(data.attachLimits);
        const msg = !data.enabled
          ? `ระบบ ${dn} ยังไม่เปิดใช้งาน`
          : !data.hasApiKey
            ? 'ยังไม่ได้ตั้งค่า OpenAI API Key'
            : `ไม่มีสิทธิ์ใช้งาน ${dn}`;
        showBanner(msg, 'warn');
        statusOk = false;
      } else {
        statusOk = true;
        setAssistantDisplayName(data.displayName);
        applyAttachLimits(data.attachLimits);
        updateCallNameDisplay(data.userCallName);
      }
    } catch (e) {
      showBanner(e.message || 'โหลดสถานะไม่สำเร็จ', 'error');
    }
  }

  async function loadMemory() {
    if (!token) return;
    setBootStatus('กำลังโหลดบทสนทนา...');
    try {
      const data = await apiGet('/api/nkbk-ai-memory');
      if (!data.ok) return;
      if (standingEl) standingEl.value = data.standingInstructions || '';
      updateCallNameDisplay(data.userCallName);
      threads = data.threads || [];
      renderThreadList();
      if (data.threadStorage) updateThreadQuotaBanner(data.threadStorage);

      const threadParam =
        initialThreadParam || String(new URLSearchParams(location.search).get('thread') || '').trim();
      if (isLibraryPath(location.pathname) && !threadParam) {
        await openLibrary({ fromUrl: true });
        return;
      }
      if (threadParam) {
        const t = threads.find((x) => x.id === threadParam || x.shareId === threadParam);
        if (t) {
          await selectThread(t.id, { fromUrl: true });
          syncAppUrl();
          return;
        }
        try {
          await selectThread(threadParam, { fromUrl: true, force: true });
          syncAppUrl();
          return;
        } catch (_) {}
      }
      showLandingState();
    } catch (_) {}
  }

  async function sendMessage(forceGenerate, rewindOpts) {
    if (isActiveThreadSending() || !statusOk) return;
    const rewind = rewindOpts && typeof rewindOpts === 'object' ? rewindOpts : null;
    const text = rewind ? String(rewind.text || '').trim() : (inputEl && inputEl.value || '').trim();
    const images = rewind ? (rewind.images || []) : pendingImages().slice();
    const documents = rewind ? (rewind.documents || []) : pendingDocuments().slice();
    const wantsPosterGen =
      /(?:ออกแบบ|design|สร้าง|ทำ).{0,40}(?:โปสเตอร์|poster|infographic|อินโฟ)/i.test(text);
    const wantsRefGen =
      images.length > 0 &&
      (forceGenerate ||
        generateMode ||
        wantsPosterGen ||
        /(?:เปลี่ยน|ใช้|จากรูป|จากภาพ|แก้|edit|อิง|reference|style|สร้าง|วาด|(?:ภาพ|รูป).*นี)/i.test(text));
    const isGenerate = forceGenerate || generateMode || wantsRefGen || wantsPosterGen;
    if (!text && !images.length && !documents.length) return;

    if (!rewind) {
      const ok = await ensureThreadBeforeSend();
      if (!ok) return;
      if (activeThreadStorage && activeThreadStorage.overQuota) {
        updateThreadQuotaBanner(activeThreadStorage);
        return;
      }
    }

    const sendThreadId = activeThreadId;

    if (rewind && typeof rewind.rewindToMessageIndex === 'number') {
      const rows = messagesEl.querySelectorAll('.nkbk-ai-msg:not(.nkbk-ai-msg--typing)');
      rows.forEach((row) => {
        const idx = parseInt(row.dataset.historyIndex || '-1', 10);
        if (idx >= rewind.rewindToMessageIndex) row.remove();
      });
      displayMessageIndex = rewind.rewindToMessageIndex;
    }

    const displayText =
      text ||
      (documents.length && images.length
        ? '[ส่งรูปและไฟล์]'
        : documents.length
          ? '[ส่งไฟล์]'
          : isGenerate
            ? 'สร้างรูปจากภาพอ้างอิง'
            : '[ส่งรูปภาพ]');
    const isEditSend = editImageMode && pendingEditRef;
    const editExtras = isEditSend
      ? pendingImages()
          .filter((i) => !i.isEditRef)
          .map((i) => ({ previewUrl: i.dataUrl, mime: i.mime }))
      : [];
    appendMessage(
      'user',
      displayText,
      isEditSend ? [] : images.map((i) => ({ dataUrl: i.dataUrl, mime: i.mime })),
      isEditSend
        ? {
            editRef: { previewUrl: pendingEditRef.previewUrl, mime: pendingEditRef.mime },
            editExtras
          }
        : null
    );
    trackPendingUserSend(sendThreadId, displayText, isEditSend ? [] : images, documents, isEditSend
      ? {
          editRef: { previewUrl: pendingEditRef.previewUrl, mime: pendingEditRef.mime },
          editExtras
        }
      : null);

    if (!rewind) {
      if (inputEl) inputEl.value = '';
      resetComposerInput();
      pendingAttachments = [];
      pendingEditRef = null;
      editImageMode = false;
      activeStarter = '';
      updateStarterPillsUi();
      setGenerateMode(false);
      renderAttachPreview();
    }

    appendTyping(isGenerate || /สร้าง|วาด|generate|draw|เปลี่ยน.*(?:ภาพ|รูป)/i.test(text) ? 'image' : 'chat');
    const responseStartedAt = Date.now();
    if (text && window.NkbkAiPrompts) {
      void window.NkbkAiPrompts.track(text);
    }
    const beforeLastAsstTs = getLastAssistantMeta(currentChatHistory).ts;
    const expectImageReply =
      isGenerate || /สร้าง|วาด|generate|draw|เปลี่ยน.*(?:ภาพ|รูป)/i.test(text);
    markInflightSend(sendThreadId, {
      kind: expectImageReply ? 'image' : 'chat',
      expectImage: expectImageReply,
      beforeTs: beforeLastAsstTs,
      text
    });
    refreshSendState();

    let keepInflightForRecovery = false;
    try {
      const prepared = await prepareAttachmentsForSend(images, documents);
      const payload = {
        message: text,
        mode: isGenerate ? 'generate' : 'auto',
        isImageEdit: !!isEditSend,
        images: prepared.images.map((i) => {
          if (i.imageId && i._source === 'library') {
            return {
              imageId: i.imageId,
              mime: i.mime || 'image/png',
              libraryId: i.libraryId || '',
              _source: 'library'
            };
          }
          return { dataUrl: i.dataUrl, mime: i.mime };
        }),
        files: prepared.documents.map((f) => ({
          name: f.name,
          mime: f.mime,
          dataUrl: f.dataUrl,
          textContent: f.textContent
        }))
      };
      if (rewind && typeof rewind.rewindToMessageIndex === 'number') {
        payload.rewindToMessageIndex = rewind.rewindToMessageIndex;
      }
      const data = await apiPost('/api/nkbk-ai-chat', payload);
      if (sendThreadId !== activeThreadId) {
        threadsNeedRefresh.add(sendThreadId);
        clearInflightSend(sendThreadId);
        if (data && data.ok) stashBackgroundThreadResult(sendThreadId, data, beforeLastAsstTs);
        return;
      }
      removeTyping();
      if (!data.ok) throw new Error(data.message || 'ส่งไม่สำเร็จ');

      await applyAssistantResultToUi(
        {
          reply: data.reply,
          images: data.images || [],
          generated: !!data.generated
        },
        text,
        { expectImageReply, isGenerate, startedAt: responseStartedAt }
      );
      clearPendingOutbound(sendThreadId);

      if (data.memoryUpdated && standingEl) {
        standingEl.value = data.standingInstructions || standingEl.value;
        showBanner('บันทึกคำสั่งในความจำแล้ว', 'ok');
        setTimeout(() => bannerEl && bannerEl.classList.add('hidden'), 2200);
      }
      if (data.activeThreadId) activeThreadId = data.activeThreadId;
      await refreshActiveThreadFromServer();
      syncAppUrl();
    } catch (e) {
      const isNetworkish = /Failed to fetch|NetworkError|Load failed|network|504|502|503|timeout|timed out|AbortError/i.test(
        String((e && e.message) || e || '')
      );
      const recovered = await tryRecoverAssistantReply(beforeLastAsstTs, expectImageReply, {
        maxWaitMs: expectImageReply ? 240000 : 60000
      });
      if (sendThreadId === activeThreadId) removeTyping();
      if (recovered) {
        if (sendThreadId === activeThreadId) {
          const lastAsst = getLastAssistantMeta(currentChatHistory);
          if (!beforeLastAsstTs || lastAsst.ts <= beforeLastAsstTs) {
            await applyAssistantResultToUi(recovered, text, {
              expectImageReply,
              isGenerate,
              startedAt: responseStartedAt
            });
          }
          await refreshActiveThreadFromServer();
          clearPendingOutbound(sendThreadId);
          syncAppUrl();
        } else {
          threadsNeedRefresh.add(sendThreadId);
          stashBackgroundThreadResult(
            sendThreadId,
            {
              ok: true,
              reply: recovered.reply,
              images: recovered.images,
              generated: recovered.generated
            },
            beforeLastAsstTs
          );
        }
      } else if (sendThreadId === activeThreadId) {
        if (expectImageReply && isNetworkish) {
          appendMessage(
            'assistant',
            '⚠ การเชื่อมต่อขาดระหว่างรอผลลัพธ์ — โมเน่อาจยังสร้างรูปอยู่ ลองกลับมาแชตนี้หรือรีเฟรชใน 1–2 นาที'
          );
          keepInflightForRecovery = true;
          void continueBackgroundRecovery(
            sendThreadId,
            beforeLastAsstTs,
            expectImageReply,
            text,
            responseStartedAt
          );
        } else {
          appendMessage('assistant', '⚠ ' + friendlyApiError(e));
        }
      } else if (expectImageReply && isNetworkish) {
        keepInflightForRecovery = true;
        void continueBackgroundRecovery(
          sendThreadId,
          beforeLastAsstTs,
          expectImageReply,
          text,
          responseStartedAt
        );
      }
    } finally {
      if (!keepInflightForRecovery) clearInflightSend(sendThreadId);
      if (bannerEl && bannerEl.textContent === 'กำลังเตรียมไฟล์แนบ...') hideBanner();
      refreshSendState();
    }
  }

  function sendMessageFromEdit(messageIndex, text) {
    sendMessage(false, { text, images: [], rewindToMessageIndex: messageIndex });
  }

  function openMemoryModal() {
    openSettingsModal('personalize');
  }

  function closeMemoryModal() {
    closeSettingsModal();
  }

  function openSettingsModal(panel) {
    closeProfileMenu();
    if (window.NkbkAiSettings && window.NkbkAiSettings.open) {
      window.NkbkAiSettings.open(panel || 'general');
      return;
    }
    if (!settingsModal) return;
    settingsModal.setAttribute('aria-hidden', 'false');
    settingsModal.classList.add('open');
  }

  function closeSettingsModal() {
    if (!settingsModal) return;
    settingsModal.setAttribute('aria-hidden', 'true');
    settingsModal.classList.remove('open');
  }

  async function newThread() {
    if (isActiveThreadSending()) return;
    closeImageViewer();
    closeComposerMenu();
    closeSearchModal();
    closeSettingsModal();
    window.NkbkAiHelp?.close?.();
    closeLibrary({ skipUrl: true });
    pendingAttachments = [];
    setGenerateMode(false);
    renderAttachPreview();
    showLandingState();
    closeSidebar();
    if (inputEl) {
      inputEl.value = '';
      resetComposerInput();
      inputEl.focus();
    }
    refreshSendState();
    syncAppUrl();
  }

  async function startNewChatWithPrompt(text) {
    if (isActiveThreadSending()) return false;
    closeImageViewer();
    closeLibrary();
    closeSettingsModal();
    window.NkbkAiHelp?.close?.();
    pendingAttachments = [];
    setGenerateMode(false);
    renderAttachPreview();
    closeSidebar();
    try {
      const data = await apiPost('/api/nkbk-ai-threads', { action: 'create' });
      if (!data.ok) throw new Error(data.message || 'สร้างแชทไม่สำเร็จ');
      threads = data.threads || threads;
      activeThreadId = data.activeThreadId || activeThreadId;
      threadEngaged = true;
      landingMode = false;
      currentChatHistory = Array.isArray(data.chatHistory) ? data.chatHistory : [];
      threadHistoryCache.set(activeThreadId, currentChatHistory.slice());
      renderThreadList();
      renderMessagesFromHistory(currentChatHistory);
      updateLandingLayout();
      updateThreadChrome();
      syncAppUrl();
      if (inputEl) {
        inputEl.value = String(text || '').trim();
        resetComposerInput();
        inputEl.focus();
      }
      refreshSendState();
      return true;
    } catch (e) {
      showBanner(e.message || 'สร้างแชทไม่สำเร็จ', 'error');
      return false;
    }
  }

  function notifyPromptCompletion(userText, replyPayload) {
    if (!userText || !window.NkbkAiPrompts || !window.NkbkAiPrompts.recordCompletion) return;
    const images = (replyPayload && replyPayload.images) || [];
    void window.NkbkAiPrompts.recordCompletion(userText, {
      generated: !!(replyPayload && replyPayload.generated),
      images
    });
  }

  async function deleteCurrentThread() {
    if (isActiveThreadSending()) return;
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
    if (!threadId) return;
    if (isThreadSending(threadId) && threadId !== activeThreadId) {
      /* อนุญาตเปิดแชตที่กำลังรอผล — จะโหลดจากเซิร์ฟเวอร์เมื่อสwitch */
    }
    const leavingLibrary = isLibraryOpen();
    if (
      threadId === activeThreadId &&
      threadEngaged &&
      !(opts && opts.force) &&
      !leavingLibrary
    ) {
      return;
    }
    if (leavingLibrary && threadId === activeThreadId && threadEngaged) {
      closeImageViewer();
      closeLibrary();
      closeSidebar();
      syncAppUrl();
      return;
    }
    closeImageViewer();
    closeLibrary();
    if (activeThreadId && currentChatHistory.length) {
      rememberThreadHistory(activeThreadId, currentChatHistory);
    }
    const prevThreadId = activeThreadId;
    const seq = ++threadSwitchSeq;
    landingMode = false;
    threadEngaged = true;
    activeThreadId = threadId;
    updateThreadListActiveState();
    updateLandingLayout();
    updateThreadChrome();
    syncAppUrl();
    closeSidebar();
    closeThreadMenu();
    const cached = threadHistoryCache.get(threadId);
    renderMessagesFromHistory(reconcilePendingOutbound(threadId, mergePendingHistory(threadId, cached || [])));
    syncTypingForActiveThread();
    try {
      await threadAction('switch', threadId);
      if (seq !== threadSwitchSeq || activeThreadId !== threadId) return;
      if (threadsNeedRefresh.has(threadId)) threadsNeedRefresh.delete(threadId);
      const displayHist = reconcilePendingOutbound(
        threadId,
        mergePendingHistory(threadId, currentChatHistory)
      );
      renderMessagesFromHistory(displayHist);
      syncTypingForActiveThread();
      syncAppUrl();
    } catch (e) {
      if (seq !== threadSwitchSeq) return;
      if (prevThreadId && prevThreadId !== threadId) {
        activeThreadId = prevThreadId;
        threadEngaged = true;
        updateThreadListActiveState();
        const prevCached = threadHistoryCache.get(prevThreadId);
        if (prevCached) renderMessagesFromHistory(prevCached);
        syncAppUrl();
      }
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
    try {
      await threadAction('share', activeThreadId);
      const url = threadShareUrl(getActiveThreadMeta());
      await copyToClipboard(url);
      showBanner('คัดลอกลิงก์แชร์แล้ว — บันทึกในการตั้งค่าแล้ว', 'ok');
      setTimeout(() => bannerEl && bannerEl.classList.add('hidden'), 2200);
      window.dispatchEvent(new CustomEvent('nkbk-ai-threads-changed'));
    } catch (e) {
      showBanner(e.message || 'แชร์ไม่สำเร็จ', 'error');
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
    if (m.includes('png')) return 'png';
    if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
    if (m.includes('webp')) return 'webp';
    if (m.includes('gif')) return 'gif';
    if (m.includes('pdf')) return 'pdf';
    if (m.includes('word')) return 'docx';
    if (m.includes('sheet') || m.includes('excel')) return 'xlsx';
    if (m.includes('presentation') || m.includes('powerpoint')) return 'pptx';
    if (m.startsWith('text/')) return 'txt';
    return 'file';
  }

  function mimeToDisplayLabel(mime) {
    const ext = mimeToExtLabel(mime);
    return ext === 'file' ? 'FILE' : ext.toUpperCase();
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
      const thumbWrap = document.createElement('span');
      thumbWrap.className = 'nkbk-ai-file-thumb';
      const thumbImg = document.createElement('img');
      thumbImg.alt = '';
      thumbWrap.appendChild(thumbImg);
      const meta = document.createElement('span');
      meta.className = 'nkbk-ai-file-meta';
      meta.innerHTML =
        '<span class="nkbk-ai-file-name">' +
        formatFileName(item, idx) +
        '</span><span class="nkbk-ai-file-type">' +
        ext +
        '</span>';
      btn.appendChild(thumbWrap);
      btn.appendChild(meta);
      void resolveImageDisplayUrl(item.src).then((url) => {
        thumbImg.src = url || item.src;
      });
      btn.addEventListener('click', () => {
        closeFilesDrawer();
        const simple = item.role === 'user';
        openImageViewer(item.src, {
          imgMeta: item.img,
          simple,
          single: simple
        });
      });
      filesList.appendChild(btn);
    });
  }

  function openFilesDrawer() {
    if (!filesDrawer) return;
    if (!requireThreadSelected()) {
      showBanner('เลือกบทสนทนาที่มีข้อความก่อน', 'warn');
      return;
    }
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

  function closeSidebarThreadMenu() {
    menuThreadId = '';
    sidebarThreadMenu?.classList.add('hidden');
    renderThreadList();
  }

  function getSidebarThreadMenuAnchor(threadId) {
    if (!threadList) return null;
    const row = threadList.querySelector('.nkbk-ai-thread-item.is-menu-open');
    return row?.querySelector('.nkbk-ai-thread-more') || null;
  }

  function positionSidebarThreadMenu(anchorEl) {
    if (!sidebarThreadMenu || !anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const row = anchorEl.closest('.nkbk-ai-thread-item');
    const rowRect = row ? row.getBoundingClientRect() : rect;
    const sidebar = document.getElementById('nkbkAiSidebar');
    const sidebarRect = sidebar?.getBoundingClientRect();
    const pad = 12;
    const menuW = sidebarThreadMenu.offsetWidth || 240;
    const menuH = sidebarThreadMenu.offsetHeight || 280;
    let left;
    let top = rowRect.top;
    if (sidebarRect) {
      const spaceRight = window.innerWidth - sidebarRect.right - pad;
      if (spaceRight >= menuW) {
        left = sidebarRect.right + 8;
      } else {
        left = Math.max(sidebarRect.left + 16, rowRect.left);
        left = Math.min(left, sidebarRect.right - menuW - 8);
      }
    } else {
      left = rect.right + 8;
    }
    left = Math.max(pad, Math.min(left, window.innerWidth - menuW - pad));
    if (top + menuH > window.innerHeight - pad) top = rowRect.bottom - menuH;
    top = Math.max(pad, Math.min(top, window.innerHeight - menuH - pad));
    sidebarThreadMenu.style.left = left + 'px';
    sidebarThreadMenu.style.top = top + 'px';
  }

  function bindSidebarThreadMenuFollow() {
    if (sidebarThreadMenuFollowBound) return;
    sidebarThreadMenuFollowBound = true;
    const reposition = () => {
      if (!sidebarThreadMenu || sidebarThreadMenu.classList.contains('hidden') || !menuThreadId) return;
      const anchor = getSidebarThreadMenuAnchor(menuThreadId);
      if (anchor) positionSidebarThreadMenu(anchor);
    };
    threadList?.addEventListener('scroll', reposition, { passive: true });
    window.addEventListener('resize', reposition, { passive: true });
    window.addEventListener('scroll', reposition, { passive: true });
  }

  function getThreadMetaById(threadId) {
    return (threads || []).find((t) => t.id === threadId) || null;
  }

  function openSidebarThreadMenu(threadId, anchorEl) {
    if (!sidebarThreadMenu || !anchorEl) return;
    const wasOpen = !sidebarThreadMenu.classList.contains('hidden');
    if (wasOpen && menuThreadId === threadId) {
      closeSidebarThreadMenu();
      return;
    }
    menuThreadId = threadId;
    const t = getThreadMetaById(threadId);
    const pinLabel = el('sidebarThreadMenuPinLabel');
    if (pinLabel) pinLabel.textContent = t && t.pinned ? 'เลิกปักหมุดแชต' : 'ปักหมุดแชต';
    sidebarThreadMenu.classList.remove('hidden');
    renderThreadList();
    bindSidebarThreadMenuFollow();
    const freshAnchor = getSidebarThreadMenuAnchor(threadId) || anchorEl;
    positionSidebarThreadMenu(freshAnchor);
    closeProfileMenu();
    closeSearchModal();
  }

  async function renameThreadById(threadId) {
    const t = getThreadMetaById(threadId);
    const current = (t && t.title) || 'แชท';
    const next = await nkbkPrompt({
      title: 'เปลี่ยนชื่อแชต',
      defaultValue: current,
      okText: 'บันทึก',
      cancelText: 'ยกเลิก',
      maxLength: 80
    });
    if (next == null) return;
    const title = String(next).trim();
    if (!title || title === current) return;
    try {
      await threadAction('rename', threadId, { title });
      showBanner('เปลี่ยนชื่อแล้ว', 'ok');
      setTimeout(() => bannerEl && bannerEl.classList.add('hidden'), 1800);
    } catch (e) {
      showBanner(e.message || 'เปลี่ยนชื่อไม่สำเร็จ', 'error');
    }
  }

  async function shareThreadById(threadId) {
    const t = getThreadMetaById(threadId);
    if (!t) return;
    const url = threadShareUrl(t);
    try {
      await copyToClipboard(url);
      await threadAction('share', threadId);
      showBanner('คัดลอกลิงก์แชร์แล้ว', 'ok');
      setTimeout(() => bannerEl && bannerEl.classList.add('hidden'), 2000);
    } catch (_) {
      showBanner(url, 'info');
    }
  }

  async function togglePinThreadById(threadId) {
    const t = getThreadMetaById(threadId);
    const action = t && t.pinned ? 'unpin' : 'pin';
    try {
      await threadAction(action, threadId);
      showBanner(action === 'pin' ? 'ปักหมุดแล้ว' : 'ยกเลิกปักหมุดแล้ว', 'ok');
      setTimeout(() => bannerEl && bannerEl.classList.add('hidden'), 1800);
    } catch (e) {
      showBanner(e.message || 'ดำเนินการไม่สำเร็จ', 'error');
    }
  }

  async function archiveThreadById(threadId) {
    const ok = await nkbkConfirm({
      title: 'เก็บบทสนทนาถาวร?',
      message: 'บทสนทนานี้จะถูกซ่อนจากรายการด้านซ้าย',
      okText: 'เก็บถาวร',
      cancelText: 'ยกเลิก',
      variant: 'warning'
    });
    if (!ok) return;
    const wasActive = threadId === activeThreadId;
    try {
      const data = await threadAction('archive', threadId);
      if (wasActive && !data.activeThreadId) showLandingState();
      else if (wasActive) {
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

  function renderSearchResults(query) {
    if (!searchResults) return;
    const q = String(query || '').trim().toLowerCase();
    const list = sortThreadsClient(threads).filter((t) => !q || String(t.title || '').toLowerCase().includes(q));
    searchResults.innerHTML = '';
    if (!list.length) {
      searchResults.innerHTML = '<div class="sidebar-search-empty">ไม่พบแชต</div>';
      return;
    }
    const groups = groupThreadsByDate(list);
    groups.forEach((items, label) => {
      const head = document.createElement('div');
      head.className = 'sidebar-search-group-label';
      head.textContent = label;
      searchResults.appendChild(head);
      items.forEach((t) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sidebar-search-item';
        btn.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg><span></span>';
        btn.querySelector('span').textContent = t.title || 'แชท';
        btn.addEventListener('click', () => {
          closeSearchModal();
          selectThread(t.id);
        });
        searchResults.appendChild(btn);
      });
    });
  }

  function openSearchModal() {
    if (!searchModal) return;
    closeImageViewer();
    searchModal.classList.remove('hidden');
    searchModal.setAttribute('aria-hidden', 'false');
    closeProfileMenu();
    closeSidebarThreadMenu();
    closeLibrary();
    if (searchInput) {
      searchInput.value = '';
      renderSearchResults('');
      setTimeout(() => searchInput.focus(), 50);
    }
  }

  function closeSearchModal() {
    if (!searchModal) return;
    searchModal.classList.add('hidden');
    searchModal.setAttribute('aria-hidden', 'true');
  }

  function formatLibraryRecentDate(ts) {
    const d = new Date(ts || Date.now());
    const datePart = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
    const timePart = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });
    return datePart + ' ' + timePart;
  }

  function formatLibraryDate(ts) {
    return formatRelativeDate(ts);
  }

  function libraryItemLabel(item) {
    const title = String(item.title || '').trim();
    if (title) return title.slice(0, 80);
    const ext = mimeToDisplayLabel(item.mime);
    return ext === 'FILE' ? 'ไฟล์' : 'ChatGPT Image ' + ext;
  }

  function shortLibraryLabel(item, maxLen) {
    const label = libraryItemLabel(item);
    const max = Math.max(12, Number(maxLen) || 32);
    if (label.length <= max) return label;
    return label.slice(0, max - 1) + '…';
  }

  function isLibraryItemUserImage(item) {
    if (!item || !String(item.mime || '').startsWith('image/')) return false;
    if (item.source === 'library') return true;
    if (item.role === 'user') return true;
    return false;
  }

  function filteredLibraryItems() {
    const q = String((librarySearchInput && librarySearchInput.value) || '')
      .trim()
      .toLowerCase();
    let items = libraryItems.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (libraryFilter === 'images') {
      items = items.filter((x) => String(x.mime || '').startsWith('image/'));
    } else if (libraryFilter === 'files') {
      items = items.filter((x) => !String(x.mime || '').startsWith('image/'));
    }
    if (q) {
      items = items.filter(
        (x) =>
          String(x.title || '').toLowerCase().includes(q) ||
          String(x.threadTitle || '').toLowerCase().includes(q)
      );
    }
    return items;
  }

  function getLibraryItemById(id) {
    return libraryItems.find((x) => x.id === id) || null;
  }

  function updateLibrarySelectionUi() {
    const count = librarySelected.size;
    if (librarySelectionBar) librarySelectionBar.classList.toggle('hidden', count === 0);
    if (libraryToolbar) libraryToolbar.classList.toggle('is-hidden', count > 0);
    if (librarySelectionCount) {
      librarySelectionCount.textContent = 'เลือกไว้ ' + count + ' รายการ';
    }
  }

  function toggleLibrarySelection(id, on) {
    if (!id) return;
    if (on) librarySelected.add(id);
    else librarySelected.delete(id);
    updateLibrarySelectionUi();
    renderLibraryList();
  }

  function clearLibrarySelection() {
    librarySelected.clear();
    libraryRowMenuOpen = '';
    updateLibrarySelectionUi();
  }

  function bindLibraryImage(img, src, onFail) {
    if (!img || !src) return;
    bindImageLoadRetry(img, src, onFail);
    resolveImageDisplayUrl(src).then((url) => {
      if (url && img.isConnected) img.src = url;
    });
  }

  function buildLibraryThumb(item) {
    const isImage = String(item.mime || '').startsWith('image/');
    if (isImage && item.src) {
      const thumb = document.createElement('img');
      thumb.className = 'nkbk-ai-library-thumb';
      thumb.alt = '';
      bindLibraryImage(thumb, item.src, () => {
        thumb.replaceWith(buildLibraryThumb({ ...item, mime: 'application/octet-stream', src: '' }));
      });
      return thumb;
    }
    const badge = document.createElement('span');
    badge.className = 'nkbk-ai-library-thumb nkbk-ai-library-thumb--doc';
    badge.textContent = mimeToDisplayLabel(item.mime);
    return badge;
  }

  function closeLibraryRowMenus() {
    libraryRowMenuOpen = '';
    document.querySelectorAll('.nkbk-ai-library-row-menu-wrap').forEach((n) => n.classList.remove('is-open'));
    document.querySelectorAll('.nkbk-ai-library-row-dropdown').forEach((n) => n.classList.add('hidden'));
  }

  function downloadLibraryItem(item) {
    if (!item || !item.src) return;
    const ext = mimeToExtLabel(item.mime).toLowerCase();
    void downloadDataUrl(
      item.src,
      (libraryItemLabel(item) || 'monet-file').replace(/[^\w.-]+/g, '_') + '.' + ext
    );
  }

  async function openLibraryItem(item) {
    if (!item) return;
    const imageSrc = libraryItemFetchSrc(item) || item.src || '';
    if (String(item.mime || '').startsWith('image/') && imageSrc) {
      const simple = isLibraryItemUserImage(item);
      if (!simple && item.threadId && item.threadId !== activeThreadId) {
        await selectThread(item.threadId, { force: true });
      }
      openImageViewer(imageSrc, {
        imgMeta: item,
        simple,
        single: simple
      });
      return;
    }
    if (item.src || item.publicUrl) {
      window.open(item.src || item.publicUrl, '_blank', 'noopener');
    }
  }

  async function deleteLibraryItems(ids) {
    const itemIds = Array.isArray(ids) ? ids.filter(Boolean) : [];
    if (!itemIds.length) return;
    const ok = await nkbkConfirm({
      title: 'ลบจากไลบรารี?',
      message: 'ลบ ' + itemIds.length + ' รายการ — การกระทำนี้ไม่สามารถย้อนกลับได้',
      okText: 'ลบ',
      variant: 'danger'
    });
    if (!ok) return;
    try {
      const data = await apiPost('/api/nkbk-ai-library', { action: 'delete', itemIds });
      libraryItems = data.ok && Array.isArray(data.items) ? data.items : libraryItems.filter((x) => !itemIds.includes(x.id));
      clearLibrarySelection();
      renderLibraryList();
      if (composerSubmenuType === 'recent' && composerMenuOpen) {
        renderRecentComposerSubmenu();
      }
      showBanner('ลบจากไลบรารีแล้ว', 'ok');
      setTimeout(() => bannerEl && bannerEl.classList.add('hidden'), 1800);
      window.dispatchEvent(new CustomEvent('nkbk-ai-threads-changed'));
      if (window.NkbkAiSettings && typeof window.NkbkAiSettings.refresh === 'function') {
        window.NkbkAiSettings.refresh().catch(() => {});
      }
    } catch (e) {
      showBanner(e.message || 'ลบไม่สำเร็จ', 'error');
    }
  }

  async function uploadLibraryFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    showBanner('กำลังอัปโหลด...', 'info');
    const items = [];
    for (const f of files.slice(0, 8)) {
      const dataUrl = await readFileAsDataUrl(f);
      items.push({ name: f.name, mime: f.type || 'application/octet-stream', dataUrl });
    }
    const data = await apiPost('/api/nkbk-ai-library', { action: 'upload', items });
    libraryItems = data.ok && Array.isArray(data.items) ? data.items : libraryItems;
    renderLibraryList();
    showBanner('อัปโหลดเข้าไลบรารีแล้ว', 'ok');
    setTimeout(() => bannerEl && bannerEl.classList.add('hidden'), 1800);
    window.dispatchEvent(new CustomEvent('nkbk-ai-threads-changed'));
    if (window.NkbkAiSettings && typeof window.NkbkAiSettings.refresh === 'function') {
      window.NkbkAiSettings.refresh().catch(() => {});
    }
  }

  function renderLibraryListView(items) {
    if (!libraryList) return;
    libraryList.innerHTML = '';
    if (!items.length) {
      libraryList.innerHTML = '<div class="nkbk-ai-library-empty">ยังไม่มีไฟล์ในคลัง</div>';
      return;
    }
    items.forEach((item) => {
      const selected = librarySelected.has(item.id);
      const row = document.createElement('div');
      row.className = 'nkbk-ai-library-row' + (selected ? ' is-selected' : '');
      row.dataset.id = item.id;

      const check = document.createElement('button');
      check.type = 'button';
      check.className = 'nkbk-ai-library-row-check' + (selected ? ' is-checked' : '');
      check.setAttribute('aria-label', selected ? 'ยกเลิกเลือก' : 'เลือก');
      if (selected) {
        check.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
      }
      check.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleLibrarySelection(item.id, !librarySelected.has(item.id));
      });

      const nameWrap = document.createElement('div');
      nameWrap.className = 'nkbk-ai-library-row-name';
      nameWrap.appendChild(buildLibraryThumb(item));
      const title = document.createElement('span');
      title.className = 'nkbk-ai-library-row-title';
      title.textContent = libraryItemLabel(item);
      nameWrap.appendChild(title);

      const date = document.createElement('span');
      date.className = 'nkbk-ai-library-row-date';
      date.textContent = formatLibraryDate(item.updatedAt);

      const size = document.createElement('span');
      size.className = 'nkbk-ai-library-row-size';
      size.textContent = libraryDisplaySize(item);

      const menuWrap = document.createElement('div');
      menuWrap.className = 'nkbk-ai-library-row-menu-wrap' + (libraryRowMenuOpen === item.id ? ' is-open' : '');
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'nkbk-ai-library-row-more';
      more.setAttribute('aria-label', 'ตัวเลือก');
      more.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>';
      const dropdown = document.createElement('div');
      dropdown.className = 'nkbk-ai-library-row-dropdown' + (libraryRowMenuOpen === item.id ? '' : ' hidden');
      dropdown.innerHTML =
        '<button type="button" data-act="download"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>ดาวน์โหลด</span></button>' +
        '<button type="button" data-act="delete" class="is-danger"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg><span>ลบ</span></button>';
      more.addEventListener('click', (e) => {
        e.stopPropagation();
        libraryRowMenuOpen = libraryRowMenuOpen === item.id ? '' : item.id;
        renderLibraryList();
      });
      dropdown.addEventListener('click', (e) => {
        e.stopPropagation();
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const act = btn.getAttribute('data-act');
        closeLibraryRowMenus();
        if (act === 'download') downloadLibraryItem(item);
        else if (act === 'delete') deleteLibraryItems([item.id]);
      });
      menuWrap.appendChild(more);
      menuWrap.appendChild(dropdown);

      row.appendChild(check);
      row.appendChild(nameWrap);
      row.appendChild(date);
      row.appendChild(size);
      row.appendChild(menuWrap);
      row.addEventListener('click', (e) => {
        if (e.target.closest('.nkbk-ai-library-row-check, .nkbk-ai-library-row-more, .nkbk-ai-library-row-dropdown')) return;
        openLibraryItem(item);
      });
      libraryList.appendChild(row);
    });
  }

  function renderLibraryGridView(items) {
    if (!libraryGrid) return;
    libraryGrid.innerHTML = '';
    if (!items.length) {
      libraryGrid.innerHTML = '<div class="nkbk-ai-library-empty">ยังไม่มีไฟล์ในคลัง</div>';
      return;
    }
    items.forEach((item) => {
      const selected = librarySelected.has(item.id);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'nkbk-ai-library-card' + (selected ? ' is-selected' : '');
      if (String(item.mime || '').startsWith('image/') && item.src) {
        const img = document.createElement('img');
        img.alt = '';
        bindLibraryImage(img, item.src);
        card.appendChild(img);
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'nkbk-ai-library-thumb--doc';
        placeholder.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:1rem;';
        placeholder.textContent = mimeToDisplayLabel(item.mime);
        card.appendChild(placeholder);
      }
      const check = document.createElement('button');
      check.type = 'button';
      check.className = 'nkbk-ai-library-card-check' + (selected ? ' is-checked' : '');
      check.setAttribute('aria-label', selected ? 'ยกเลิกเลือก' : 'เลือก');
      if (selected) {
        check.innerHTML =
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
      }
      check.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleLibrarySelection(item.id, !librarySelected.has(item.id));
      });
      const meta = document.createElement('div');
      meta.className = 'nkbk-ai-library-card-meta';
      meta.innerHTML =
        '<div class="nkbk-ai-library-card-title"></div><div class="nkbk-ai-library-card-sub"></div>';
      meta.querySelector('.nkbk-ai-library-card-title').textContent = libraryItemLabel(item);
      meta.querySelector('.nkbk-ai-library-card-sub').textContent =
        mimeToDisplayLabel(item.mime) + ' · ' + libraryDisplaySize(item);
      card.appendChild(check);
      card.appendChild(meta);
      card.addEventListener('click', (e) => {
        if (e.target.closest('.nkbk-ai-library-card-check')) return;
        openLibraryItem(item);
      });
      libraryGrid.appendChild(card);
    });
  }

  function renderLibraryList() {
    const items = filteredLibraryItems();
    if (libraryListView) libraryListView.classList.toggle('hidden', libraryViewMode !== 'list');
    if (libraryGridView) libraryGridView.classList.toggle('hidden', libraryViewMode !== 'grid');
    if (libraryViewMode === 'grid') renderLibraryGridView(items);
    else renderLibraryListView(items);
  }

  function setLibraryViewMode(mode) {
    libraryViewMode = mode === 'grid' ? 'grid' : 'list';
    el('btnLibraryViewList')?.classList.toggle('is-active', libraryViewMode === 'list');
    el('btnLibraryViewGrid')?.classList.toggle('is-active', libraryViewMode === 'grid');
    renderLibraryList();
  }

  async function loadLibraryItems() {
    if (libraryList) libraryList.innerHTML = '<div class="nkbk-ai-library-empty">กำลังโหลด...</div>';
    if (libraryGrid) libraryGrid.innerHTML = '';
    try {
      const data = await apiGet('/api/nkbk-ai-library');
      libraryItems =
        data.ok && Array.isArray(data.items)
          ? data.items
          : collectThreadImages().map((x, i) => ({
              id: 'local_' + i,
              title: x.title,
              src: x.src,
              mime: x.mime,
              updatedAt: Date.now(),
              sizeBytes: 0,
              threadId: activeThreadId
            }));
    } catch (_) {
      libraryItems = collectThreadImages().map((x, i) => ({
        id: 'local_' + i,
        title: x.title,
        src: x.src,
        mime: x.mime,
        updatedAt: Date.now(),
        sizeBytes: 0,
        threadId: activeThreadId
      }));
    }
    renderLibraryList();
  }

  async function openLibrary(opts) {
    if (!libraryPanel) return;
    closeImageViewer();
    closeSearchModal();
    closeProfileMenu();
    closeSidebarThreadMenu();
    closeSidebar();
    clearLibrarySelection();
    appEl?.classList.add('is-library-open');
    chatView?.classList.add('hidden');
    libraryPanel.classList.remove('hidden');
    libraryPanel.setAttribute('aria-hidden', 'false');
    el('btnLibrary')?.classList.add('is-active');
    if (!opts || !opts.fromUrl) syncAppUrl();
    await loadLibraryItems();
  }

  function closeLibrary(opts) {
    if (!libraryPanel) return;
    appEl?.classList.remove('is-library-open');
    chatView?.classList.remove('hidden');
    libraryPanel.classList.add('hidden');
    libraryPanel.setAttribute('aria-hidden', 'true');
    el('btnLibrary')?.classList.remove('is-active');
    clearLibrarySelection();
    closeLibraryRowMenus();
    if (!opts || !opts.skipUrl) syncAppUrl();
  }

  function isLibraryOpen() {
    return !!(libraryPanel && !libraryPanel.classList.contains('hidden'));
  }

  async function libraryStartChatWithSelection() {
    const ids = [...librarySelected];
    if (!ids.length) return;
    const items = ids.map(getLibraryItemById).filter(Boolean);
    closeLibrary();
    showLandingState();
    for (const item of items) {
      if (String(item.mime || '').startsWith('image/') && item.src) {
        try {
          let dataUrl = item.src;
          if (!dataUrl.startsWith('data:')) {
            const blob = await fetchImageBlobFromUrl(dataUrl);
            if (blob) dataUrl = await readFileAsDataUrl(new File([blob], 'library.png', { type: blob.type || item.mime }));
          }
          pendingAttachments.push({
            kind: 'image',
            dataUrl,
            mime: item.mime || 'image/png',
            name: libraryItemLabel(item) + '.png'
          });
        } catch (_) {}
      }
    }
    renderAttachPreview();
    refreshSendState();
    if (inputEl) inputEl.focus();
  }

  async function libraryDownloadSelection() {
    const ids = [...librarySelected];
    if (!ids.length) return;
    for (const id of ids) {
      const item = getLibraryItemById(id);
      if (item) downloadLibraryItem(item);
    }
  }

  const composerMenuHost = el('nkbkAiComposerMenuHost');
  const composerMenu = el('nkbkAiComposerMenu');
  const composerSubmenu = el('nkbkAiComposerSubmenu');
  const composerSubmenuTitle = el('nkbkAiComposerSubmenuTitle');
  const composerSubmenuList = el('nkbkAiComposerSubmenuList');
  let composerMenuOpen = false;
  let composerSubmenuType = '';
  let composerLibraryLoading = null;
  let composerSubmenuHideTimer = null;
  let composerSubmenuAnchor = null;
  let composerRecentSelected = new Set();

  function updateComposerRecentFoot() {
    const foot = el('nkbkAiComposerRecentFoot');
    const countEl = el('nkbkAiComposerRecentCount');
    const confirmBtn = el('nkbkAiComposerRecentConfirm');
    const isRecent = composerSubmenuType === 'recent';
    if (foot) foot.classList.toggle('hidden', !isRecent);
    const n = composerRecentSelected.size;
    if (countEl) countEl.textContent = 'เลือกแล้ว ' + String(n) + ' รายการ';
    if (confirmBtn) confirmBtn.disabled = n < 1;
  }

  function resetComposerRecentSelection() {
    composerRecentSelected = new Set();
    updateComposerRecentFoot();
  }

  function toggleComposerRecentSelection(id) {
    const key = String(id || '').trim();
    if (!key) return;
    if (composerRecentSelected.has(key)) composerRecentSelected.delete(key);
    else composerRecentSelected.add(key);
    updateComposerRecentFoot();
  }

  function cancelComposerSubmenuHide() {
    if (composerSubmenuHideTimer) {
      clearTimeout(composerSubmenuHideTimer);
      composerSubmenuHideTimer = null;
    }
  }

  function scheduleComposerSubmenuHide() {
    cancelComposerSubmenuHide();
    composerSubmenuHideTimer = setTimeout(() => {
      closeComposerSubmenu();
    }, 220);
  }

  function isComposerDesktopHover() {
    return window.matchMedia('(min-width: 769px) and (hover: hover) and (pointer: fine)').matches;
  }

  function isComposerMobileMenu() {
    return window.matchMedia('(max-width: 768px)').matches;
  }

  function getComposerPlusWrap() {
    return document.querySelector('.nkbk-ai-composer-plus-wrap');
  }

  function ensureComposerMenuPortal() {
    if (composerMenuPortalEl) return composerMenuPortalEl;
    composerMenuPortalEl = document.createElement('div');
    composerMenuPortalEl.id = 'nkbkAiComposerMenuPortal';
    composerMenuPortalEl.className = 'nkbk-ai-composer-menu-portal hidden';
    composerMenuPortalEl.innerHTML =
      '<div class="nkbk-ai-composer-menu-portal-backdrop" aria-hidden="true"></div>';
    composerMenuPortalEl.addEventListener('click', (e) => {
      if (e.target.classList.contains('nkbk-ai-composer-menu-portal-backdrop')) closeComposerMenu();
    });
    document.body.appendChild(composerMenuPortalEl);
    return composerMenuPortalEl;
  }

  function positionComposerMenuMobile() {
    if (!composerMenuPortalEl || !isComposerMobileMenu()) return;
    const vv = window.visualViewport;
    if (!vv) {
      composerMenuPortalEl.style.removeProperty('padding-top');
      composerMenuPortalEl.style.removeProperty('padding-bottom');
      return;
    }
    const padTop = Math.max(16, Math.round(vv.offsetTop + 12));
    const padBottom = Math.max(16, Math.round(window.innerHeight - vv.offsetTop - vv.height + 12));
    composerMenuPortalEl.style.paddingTop = padTop + 'px';
    composerMenuPortalEl.style.paddingBottom = padBottom + 'px';
  }

  function mountComposerMenuMobile() {
    if (!isComposerMobileMenu() || !composerMenuHost) return;
    const portal = ensureComposerMenuPortal();
    if (composerMenuHost.parentElement !== portal) portal.appendChild(composerMenuHost);
    portal.classList.remove('hidden');
    positionComposerMenuMobile();
    requestAnimationFrame(() => {
      positionComposerMenuMobile();
    });
  }

  function unmountComposerMenuMobile() {
    const plusWrap = getComposerPlusWrap();
    if (composerMenuPortalEl) composerMenuPortalEl.classList.add('hidden');
    if (composerMenuHost && plusWrap && composerMenuHost.parentElement !== plusWrap) {
      plusWrap.appendChild(composerMenuHost);
    }
    if (composerMenuPortalEl) {
      composerMenuPortalEl.style.removeProperty('padding-top');
      composerMenuPortalEl.style.removeProperty('padding-bottom');
    }
    if (composerMenuHost) {
      composerMenuHost.style.removeProperty('top');
      composerMenuHost.style.removeProperty('bottom');
      composerMenuHost.style.removeProperty('transform');
      composerMenuHost.style.removeProperty('max-height');
      composerMenuHost.style.removeProperty('height');
    }
  }

  function closeComposerMenu() {
    cancelComposerSubmenuHide();
    composerMenuOpen = false;
    composerSubmenuType = '';
    composerSubmenuAnchor = null;
    composerMenuHost?.classList.add('hidden');
    composerMenuHost?.setAttribute('aria-hidden', 'true');
    composerSubmenu?.classList.add('hidden');
    composerSubmenu?.setAttribute('aria-hidden', 'true');
    attachBtn?.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('nkbk-ai-composer-menu-open');
    unmountComposerMenuMobile();
    composerMenu?.querySelectorAll('[data-composer-menu]').forEach((btn) => {
      btn.classList.remove('is-active');
    });
  }

  function toggleComposerMenu() {
    if (composerMenuOpen) {
      closeComposerMenu();
      return;
    }
    if (isComposerMobileMenu()) closeSidebar();
    composerMenuOpen = true;
    composerMenuHost?.classList.remove('hidden');
    composerMenuHost?.setAttribute('aria-hidden', 'false');
    document.body.classList.add('nkbk-ai-composer-menu-open');
    mountComposerMenuMobile();
    attachBtn?.setAttribute('aria-expanded', 'true');
    if (!composerLibraryLoading) {
      composerLibraryLoading = ensureComposerLibraryItems().finally(() => {
        composerLibraryLoading = null;
      });
    }
  }

  function invalidateComposerLibraryCache() {
    libraryItems = [];
    composerLibraryLoading = null;
  }

  async function ensureComposerLibraryItems(forceRefresh) {
    if (!forceRefresh && libraryItems.length) return libraryItems;
    try {
      const data = await apiGet('/api/nkbk-ai-library');
      if (data.ok && Array.isArray(data.items)) libraryItems = data.items;
    } catch (_) {}
    return libraryItems;
  }

  async function attachLibraryItemToComposer(item, opts) {
    if (!item) return false;
    const options = opts && typeof opts === 'object' ? opts : {};
    if (!options.keepMenu) closeComposerMenu();
    const slots = maxAttachCount() - pendingAttachments.length;
    if (slots <= 0) {
      showBanner('แนบได้สูงสุด ' + maxAttachCount() + ' ไฟล์', 'warn');
      return false;
    }
    try {
      if (String(item.mime || '').startsWith('image/')) {
        const fetchSrc = libraryItemFetchSrc(item);
        if (item.imageId && fetchSrc) {
          pendingAttachments.push({
            kind: 'image',
            mime: item.mime || 'image/png',
            name: libraryItemLabel(item) + '.png',
            libraryId: String(item.id || ''),
            imageId: String(item.imageId),
            librarySource: true,
            previewUrl: fetchSrc
          });
        } else if (fetchSrc) {
          let dataUrl = fetchSrc;
          if (!dataUrl.startsWith('data:')) {
            const blob = await fetchImageBlobFromUrl(fetchSrc);
            if (!blob) {
              showBanner('แนบไฟล์ไม่สำเร็จ', 'warn');
              return false;
            }
            dataUrl = await readFileAsDataUrl(
              new File([blob], 'library.png', { type: blob.type || item.mime })
            );
          }
          pendingAttachments.push({
            kind: 'image',
            dataUrl,
            mime: item.mime || 'image/png',
            name: libraryItemLabel(item) + '.png'
          });
        } else {
          showBanner('แนบไฟล์ไม่สำเร็จ', 'warn');
          return false;
        }
      } else if (item.fileId && item.src) {
        pendingAttachments.push({
          kind: 'document',
          mime: item.mime || 'application/octet-stream',
          name: libraryItemLabel(item) || 'file',
          libraryId: String(item.id || ''),
          fileId: String(item.fileId),
          librarySource: true,
          previewUrl: item.src
        });
      } else if (item.src) {
        pendingAttachments.push({
          kind: 'document',
          dataUrl: item.src,
          mime: item.mime || 'application/octet-stream',
          name: libraryItemLabel(item) || 'file'
        });
      } else {
        showBanner('แนบไฟล์ไม่สำเร็จ', 'warn');
        return false;
      }
      renderAttachPreview();
      refreshSendState();
      inputEl?.focus();
      return true;
    } catch (_) {
      showBanner('แนบไฟล์ไม่สำเร็จ', 'warn');
      return false;
    }
  }

  async function attachLibraryItemsToComposer(items) {
    const list = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!list.length) return;
    closeComposerMenu();
    let added = 0;
    for (const item of list) {
      if (pendingAttachments.length >= maxAttachCount()) break;
      const ok = await attachLibraryItemToComposer(item, { keepMenu: true });
      if (ok) added += 1;
    }
    if (!added) showBanner('แนบไฟล์ไม่สำเร็จ', 'warn');
  }

  function libraryItemFetchSrc(item) {
    if (!item) return '';
    if (item.imageId) return imageApiUrl(item.imageId);
    return item.src || '';
  }

  function openComposerLibraryPicker() {
    closeComposerMenu();
    if (!window.NkbkAiSettings || typeof window.NkbkAiSettings.openLibraryPicker !== 'function') {
      showBanner('เปิดไลบรารีไม่สำเร็จ', 'warn');
      return;
    }
    window.NkbkAiSettings.openLibraryPicker({
      mode: 'attach',
      onAttach: (items) => attachLibraryItemsToComposer(items)
    });
  }

  function renderRecentComposerSubmenuHead() {
    if (!composerSubmenuTitle) return;
    composerSubmenuTitle.innerHTML =
      '<button type="button" class="nkbk-ai-composer-library-open" data-composer-library-open="1">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>' +
      '<span>เพิ่มจากไลบรารี</span></button>';
  }

  function renderRecentComposerSubmenu() {
    if (!composerSubmenuList) return;
    const items = libraryItems
      .filter((x) => String(x.mime || '').startsWith('image/') && (x.src || x.imageId))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 8);
    updateComposerRecentFoot();
    if (!items.length) {
      composerSubmenuList.innerHTML =
        '<div class="nkbk-ai-composer-submenu-empty">ยังไม่มีไฟล์ล่าสุด — อัปโหลดได้ที่ไลบรารี</div>';
      return;
    }
    composerSubmenuList.innerHTML =
      '<div class="nkbk-ai-composer-recent-label">เมื่อเร็วๆ นี้ — แตะเลือกหลายรูป แล้วกดแนบที่เลือก</div>' +
      '<div class="nkbk-ai-composer-recent-grid">' +
      items
        .map((item) => {
          const id = String(item.id || '');
          const selected = composerRecentSelected.has(id);
          const label = shortLibraryLabel(item, 28);
          const safeLabel = label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
          const safeSrc = String(libraryItemFetchSrc(item) || '').replace(/"/g, '&quot;');
          return (
            '<button type="button" class="nkbk-ai-composer-recent-cell' +
            (selected ? ' is-selected' : '') +
            '" data-library-id="' +
            id.replace(/"/g, '&quot;') +
            '" aria-pressed="' +
            (selected ? 'true' : 'false') +
            '">' +
            '<span class="nkbk-ai-composer-recent-check" aria-hidden="true">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12l5 5L19 7"/></svg>' +
            '</span>' +
            '<span class="nkbk-ai-composer-recent-thumb"><img src="' +
            safeSrc +
            '" alt="" loading="lazy"></span>' +
            '<span class="nkbk-ai-composer-recent-name">' +
            safeLabel +
            '</span></button>'
          );
        })
        .join('') +
      '</div>';
  }

  function renderPromptsComposerSubmenu() {
    if (!composerSubmenuList) return;
    const prompts =
      window.NkbkAiPrompts && typeof window.NkbkAiPrompts.getSavedPrompts === 'function'
        ? window.NkbkAiPrompts.getSavedPrompts()
        : Array.isArray(window.__nkbkAiSavedPrompts)
          ? window.__nkbkAiSavedPrompts
          : [];
    if (!prompts.length) {
      composerSubmenuList.innerHTML =
        '<div class="nkbk-ai-composer-submenu-empty">ยังไม่มีพรอมต์ — เพิ่มได้ที่ ตั้งค่า › ตั้งค่าพรอมต์</div>';
      return;
    }
    composerSubmenuList.innerHTML = prompts
      .map((p) => {
        const title = String(p.title || 'พรอมต์')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/"/g, '&quot;');
        const preview = String(p.text || '')
          .slice(0, 120)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/"/g, '&quot;');
        return (
          '<button type="button" class="nkbk-ai-composer-submenu-item nkbk-ai-composer-submenu-item--prompt" data-prompt-id="' +
          String(p.id || '').replace(/"/g, '&quot;') +
          '">' +
          '<span class="nkbk-ai-composer-submenu-meta">' +
          '<span class="nkbk-ai-composer-submenu-name">' +
          title +
          '</span>' +
          '<span class="nkbk-ai-composer-submenu-date">' +
          preview +
          '</span></span></button>'
        );
      })
      .join('');
  }

  function positionComposerFlyout() {
    if (!composerSubmenu) return;
    composerSubmenu.style.removeProperty('visibility');
    composerSubmenu.style.removeProperty('left');
    composerSubmenu.style.removeProperty('top');
  }

  function openComposerSubmenu(type, anchorBtn) {
    if (!composerSubmenu || !composerSubmenuList || !composerSubmenuTitle || !composerMenu) return;
    cancelComposerSubmenuHide();
    composerSubmenuType = type;
    composerSubmenuAnchor = anchorBtn;
    composerSubmenu.classList.remove('hidden');
    composerSubmenu.setAttribute('aria-hidden', 'false');
    composerMenu.querySelectorAll('[data-composer-menu]').forEach((b) => {
      b.classList.toggle('is-active', b === anchorBtn);
    });

    if (type === 'recent') {
      resetComposerRecentSelection();
      renderRecentComposerSubmenuHead();
      renderRecentComposerSubmenu();
      positionComposerFlyout();
      void (composerLibraryLoading || ensureComposerLibraryItems(true)).then(() => {
        if (composerSubmenuType === 'recent') {
          renderRecentComposerSubmenu();
          if (composerMenuOpen && isComposerMobileMenu()) positionComposerMenuMobile();
        }
      });
      if (composerMenuOpen && isComposerMobileMenu()) {
        requestAnimationFrame(() => positionComposerMenuMobile());
      }
      return;
    }

    if (type === 'prompts') {
      updateComposerRecentFoot();
      composerSubmenuTitle.innerHTML =
        '<span class="nkbk-ai-composer-flyout-title">พรอมต์ที่บันทึก</span>';
      renderPromptsComposerSubmenu();
      positionComposerFlyout();
    }
    if (composerMenuOpen && isComposerMobileMenu()) {
      requestAnimationFrame(() => positionComposerMenuMobile());
    }
  }

  function closeComposerSubmenu() {
    cancelComposerSubmenuHide();
    composerSubmenuType = '';
    composerSubmenuAnchor = null;
    composerSubmenu?.classList.add('hidden');
    composerSubmenu?.setAttribute('aria-hidden', 'true');
    composerSubmenu?.style.removeProperty('visibility');
    composerSubmenu?.style.removeProperty('left');
    composerSubmenu?.style.removeProperty('top');
    composerMenu?.querySelectorAll('[data-composer-menu]').forEach((btn) => {
      btn.classList.remove('is-active');
    });
  }

  function closeProfileMenu() {
    sidebarProfileMenu?.classList.add('hidden');
    el('btnProfileMenu')?.setAttribute('aria-expanded', 'false');
    window.NkbkAiHelp?.closeSubmenu?.();
  }

  function toggleProfileMenu() {
    if (!sidebarProfileMenu) return;
    const open = sidebarProfileMenu.classList.contains('hidden');
    sidebarProfileMenu.classList.toggle('hidden', !open ? true : false);
    el('btnProfileMenu')?.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      closeSidebarThreadMenu();
      closeSearchModal();
    }
  }

  function isMobileSidebar() {
    return window.matchMedia('(max-width: 768px)').matches;
  }

  function toggleSidebarCollapse() {
    if (isMobileSidebar() && !isViewerOpen()) return;
    if (isViewerOpen()) {
      if (document.body.classList.contains('sidebar-collapsed')) expandSidebar();
      else collapseSidebar();
      return;
    }
    if (isMobileSidebar()) return;
    const collapsed = document.body.classList.toggle('sidebar-collapsed');
    try {
      localStorage.setItem('nkbk_ai_sidebar_collapsed', collapsed ? '1' : '0');
    } catch (_) {}
    closeProfileMenu();
    closeSidebarThreadMenu();
  }

  function expandSidebar() {
    closeProfileMenu();
    closeSidebarThreadMenu();
    if (isViewerOpen()) {
      document.body.classList.remove('sidebar-collapsed');
      document.body.classList.remove('sidebar-open');
      try {
        localStorage.setItem('nkbk_ai_sidebar_collapsed', '0');
      } catch (_) {}
      return;
    }
    if (isMobileSidebar()) {
      openSidebar();
      return;
    }
    document.body.classList.remove('sidebar-collapsed');
    try {
      localStorage.setItem('nkbk_ai_sidebar_collapsed', '0');
    } catch (_) {}
  }

  function collapseSidebar() {
    closeProfileMenu();
    closeSidebarThreadMenu();
    if (isViewerOpen()) {
      document.body.classList.add('sidebar-collapsed');
      document.body.classList.remove('sidebar-open');
      try {
        localStorage.setItem('nkbk_ai_sidebar_collapsed', '1');
      } catch (_) {}
      return;
    }
    if (isMobileSidebar()) {
      closeSidebar();
      return;
    }
    document.body.classList.add('sidebar-collapsed');
    try {
      localStorage.setItem('nkbk_ai_sidebar_collapsed', '1');
    } catch (_) {}
  }

  function applySidebarCollapsePref() {
    if (isMobileSidebar()) {
      document.body.classList.remove('sidebar-collapsed');
      return;
    }
    try {
      const collapsed = localStorage.getItem('nkbk_ai_sidebar_collapsed') === '1';
      document.body.classList.toggle('sidebar-collapsed', collapsed);
    } catch (_) {}
  }
  applySidebarCollapsePref();
  window.addEventListener('resize', () => {
    if (isMobileSidebar()) {
      document.body.classList.remove('sidebar-collapsed');
    } else {
      applySidebarCollapsePref();
      document.body.classList.remove('sidebar-open');
    }
  });

  async function applyViewerAspect(aspect) {
    const item = viewerImages[viewerIndex];
    if (!item || isActiveThreadSending()) return;
    viewerAspectMenu?.classList.add('hidden');
    const prompt = 'สร้างภาพเดิมในอัตราส่วน ' + aspect;
    const prepared = await prepareImageForEdit(item.src, item.mime || 'image/png', item.img, viewerImg);
    if (!prepared) {
      showBanner('โหลดรูปเพื่อแก้ไขไม่สำเร็จ', 'warn');
      return;
    }
    pendingAttachments = [
      { kind: 'image', dataUrl: prepared.dataUrl, mime: prepared.mime, name: 'edit.png', isEditRef: true }
    ];
    pendingEditRef = { previewUrl: prepared.dataUrl, mime: prepared.mime };
    editImageMode = true;
    setGenerateMode(true);
    closeImageViewer({ keepEdit: true });
    if (inputEl) {
      inputEl.value = prompt;
      inputEl.dispatchEvent(new Event('input'));
    }
    sendMessage(true);
  }

  async function submitViewerEdit() {
    if (!viewerInput || isActiveThreadSending()) return;
    const text = viewerInput.value.trim();
    const hasExtra = pendingAttachments.some((a) => a.kind === 'image' && !a.isEditRef);
    if (!text && !hasExtra) return;
    const item = viewerImages[viewerIndex];
    if (!item) return;
    const ok = await ensureViewerEditRef();
    if (!ok) {
      showBanner('โหลดรูปเพื่อแก้ไขไม่สำเร็จ', 'warn');
      return;
    }
    closeImageViewer({ keepEdit: true });
    if (inputEl) {
      inputEl.value = text;
      inputEl.dispatchEvent(new Event('input'));
    }
    setGenerateMode(true);
    sendMessage(true);
  }

  async function shareViewerImage() {
    if (!activeThreadId) return;
    try {
      await copyToClipboard(threadShareUrl(getActiveThreadMeta()));
      showBanner('คัดลอกลิงก์แชร์แล้ว', 'ok');
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
    attachBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleComposerMenu();
    });
    composerMenu?.querySelectorAll('[data-composer-menu]').forEach((btn) => {
      const action = btn.getAttribute('data-composer-menu');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (action === 'upload') {
          closeComposerMenu();
          fileInput.click();
          return;
        }
        if (action === 'recent' || action === 'prompts') {
          if (!isComposerDesktopHover()) {
            if (composerSubmenuType === action && !composerSubmenu?.classList.contains('hidden')) {
              closeComposerSubmenu();
            } else {
              openComposerSubmenu(action, btn);
            }
          }
        }
      });
      if (action === 'recent' || action === 'prompts') {
        btn.addEventListener('mouseenter', () => {
          if (!isComposerDesktopHover()) return;
          openComposerSubmenu(action, btn);
        });
      }
    });
    composerMenuHost?.addEventListener('mouseleave', () => {
      if (!isComposerDesktopHover()) return;
      scheduleComposerSubmenuHide();
    });
    composerMenuHost?.addEventListener('mouseenter', cancelComposerSubmenuHide);
    composerSubmenu?.addEventListener('mouseenter', cancelComposerSubmenuHide);
    composerSubmenu?.addEventListener('mouseleave', () => {
      if (!isComposerDesktopHover()) return;
      scheduleComposerSubmenuHide();
    });
    if (composerSubmenu && !composerSubmenu.dataset.bound) {
      composerSubmenu.dataset.bound = '1';
      composerSubmenu.addEventListener('click', (e) => {
        if (e.target.closest('[data-composer-library-open]')) {
          e.preventDefault();
          e.stopPropagation();
          openComposerLibraryPicker();
        }
      });
    }
    if (composerSubmenuList && !composerSubmenuList.dataset.bound) {
      composerSubmenuList.dataset.bound = '1';
      composerSubmenuList.addEventListener(
        'error',
        (e) => {
          const img = e.target;
          if (!img || img.tagName !== 'IMG') return;
          const cell = img.closest('.nkbk-ai-composer-recent-cell');
          if (!cell) return;
          const id = cell.getAttribute('data-library-id');
          if (id) composerRecentSelected.delete(id);
          cell.remove();
          updateComposerRecentFoot();
          const grid = composerSubmenuList.querySelector('.nkbk-ai-composer-recent-grid');
          if (grid && !grid.querySelector('.nkbk-ai-composer-recent-cell')) {
            composerSubmenuList.innerHTML =
              '<div class="nkbk-ai-composer-submenu-empty">ยังไม่มีไฟล์ล่าสุด — อัปโหลดได้ที่ไลบรารี</div>';
          }
        },
        true
      );
      composerSubmenuList.addEventListener('click', (e) => {
        const libBtn = e.target.closest('[data-library-id]');
        if (libBtn) {
          e.preventDefault();
          e.stopPropagation();
          const id = libBtn.getAttribute('data-library-id');
          if (composerSubmenuType === 'recent') {
            toggleComposerRecentSelection(id);
            libBtn.classList.toggle('is-selected', composerRecentSelected.has(id));
            libBtn.setAttribute('aria-pressed', composerRecentSelected.has(id) ? 'true' : 'false');
            return;
          }
          const item = getLibraryItemById(id);
          void attachLibraryItemToComposer(item);
          return;
        }
        const promptBtn = e.target.closest('[data-prompt-id]');
        if (promptBtn) {
          e.preventDefault();
          e.stopPropagation();
          const id = promptBtn.getAttribute('data-prompt-id');
          const prompts =
            window.NkbkAiPrompts && typeof window.NkbkAiPrompts.getSavedPrompts === 'function'
              ? window.NkbkAiPrompts.getSavedPrompts()
              : [];
          const p = prompts.find((x) => x.id === id);
          if (p && window.NkbkAiPrompts) window.NkbkAiPrompts.apply(p.text);
          closeComposerMenu();
        }
      });
    }
    el('nkbkAiComposerRecentClear')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      resetComposerRecentSelection();
      if (composerSubmenuType === 'recent') renderRecentComposerSubmenu();
    });
    el('nkbkAiComposerRecentConfirm')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const items = [...composerRecentSelected]
        .map((id) => getLibraryItemById(id))
        .filter(Boolean);
      if (!items.length) return;
      void attachLibraryItemsToComposer(items);
      resetComposerRecentSelection();
    });
    fileInput.addEventListener('change', () => {
      onFilesSelected(fileInput.files);
      fileInput.value = '';
    });
    document.addEventListener('click', (e) => {
      if (!composerMenuOpen) return;
      if (e.target.closest('.nkbk-ai-composer-plus-wrap')) return;
      if (e.target.closest('#nkbkAiComposerMenuPortal')) return;
      if (e.target.closest('#nkbkAiComposerMenuHost')) return;
      closeComposerMenu();
    });
    window.addEventListener('resize', () => {
      if (composerMenuOpen && isComposerMobileMenu()) positionComposerMenuMobile();
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        if (composerMenuOpen && isComposerMobileMenu()) positionComposerMenuMobile();
      });
      window.visualViewport.addEventListener('scroll', () => {
        if (composerMenuOpen && isComposerMobileMenu()) positionComposerMenuMobile();
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && composerMenuOpen) closeComposerMenu();
    });
  }

  function canAcceptChatFileDrop() {
    if (isLibraryOpen()) return false;
    if (isViewerOpen()) return false;
    if (document.body.classList.contains('nkbk-ai-composer-menu-open')) return false;
    const modalIds = [
      'nkbkAiSettingsModal',
      'searchChatModal',
      'nkbkAiSharedLinksModal',
      'nkbkAiArchivedModal',
      'nkbkAiLibraryPickerModal'
    ];
    if (modalIds.some((id) => {
      const node = el(id);
      return node && node.getAttribute('aria-hidden') === 'false';
    })) {
      return false;
    }
    return true;
  }

  function setupGlobalImageDrop() {
    const app = document.querySelector('.nkbk-ai-app');
    if (!app) return;
    const chatView = el('nkbkAiChatView');
    const overlay = el('nkbkAiDropOverlay');
    let dragDepth = 0;

    const showDrop = () => {
      if (!canAcceptChatFileDrop()) return;
      dragDepth += 1;
      if (dragDepth !== 1) return;
      overlay?.classList.remove('hidden');
      overlay?.setAttribute('aria-hidden', 'false');
      chatView?.classList.add('is-dragover');
      document.body.classList.add('nkbk-ai-file-dragging');
    };
    const hideDrop = (force) => {
      if (force) dragDepth = 0;
      else dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth !== 0) return;
      overlay?.classList.add('hidden');
      overlay?.setAttribute('aria-hidden', 'true');
      chatView?.classList.remove('is-dragover');
      document.body.classList.remove('nkbk-ai-file-dragging');
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
        if (canAcceptChatFileDrop() && dragDepth === 0) showDrop();
      },
      true
    );
    app.addEventListener(
      'dragleave',
      (e) => {
        if (!dragDepth) return;
        const related = e.relatedTarget;
        if (related && app.contains(related)) return;
        hideDrop(false);
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
        hideDrop(true);
        if (!canAcceptChatFileDrop()) return;
        resolveDropPayload(payload)
          .then((files) => {
            if (files.length) {
              return onFilesSelected(files).then(() => inputEl?.focus());
            }
            showBanner('วางไฟล์ไม่สำเร็จ — ลองใช้ปุ่ม + แทน', 'warn');
          })
          .catch(() => showBanner('วางไฟล์ไม่สำเร็จ — ลองใช้ปุ่ม + แทน', 'warn'));
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
      hideDrop(true);
    });
    window.addEventListener('blur', () => hideDrop(true));
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
  if (el('btnNkbkAiNewThread')) el('btnNkbkAiNewThread').addEventListener('click', newThread);
  if (el('btnSearchChats')) el('btnSearchChats').addEventListener('click', openSearchModal);
  if (el('searchChatClose')) el('searchChatClose').addEventListener('click', closeSearchModal);
  if (el('searchChatBackdrop')) el('searchChatBackdrop').addEventListener('click', closeSearchModal);
  if (el('searchChatNew')) {
    el('searchChatNew').addEventListener('click', () => {
      closeSearchModal();
      newThread();
    });
  }
  if (searchInput) {
    searchInput.addEventListener('input', () => renderSearchResults(searchInput.value));
  }
  if (el('btnLibrary')) {
    el('btnLibrary').addEventListener('click', () => {
      if (isLibraryOpen()) closeLibrary();
      else openLibrary();
    });
  }
  if (librarySearchInput) {
    librarySearchInput.addEventListener('input', () => renderLibraryList());
  }
  if (el('btnLibraryViewList')) el('btnLibraryViewList').addEventListener('click', () => setLibraryViewMode('list'));
  if (el('btnLibraryViewGrid')) el('btnLibraryViewGrid').addEventListener('click', () => setLibraryViewMode('grid'));
  if (el('btnLibraryUpload') && libraryUploadInput) {
    el('btnLibraryUpload').addEventListener('click', () => libraryUploadInput.click());
    libraryUploadInput.addEventListener('change', async () => {
      const files = libraryUploadInput.files;
      libraryUploadInput.value = '';
      if (!files || !files.length) return;
      try {
        await uploadLibraryFiles(files);
      } catch (e) {
        showBanner(e.message || 'อัปโหลดไม่สำเร็จ', 'error');
      }
    });
  }
  if (el('btnLibraryStartChat')) el('btnLibraryStartChat').addEventListener('click', libraryStartChatWithSelection);
  if (el('btnLibraryDownload')) el('btnLibraryDownload').addEventListener('click', libraryDownloadSelection);
  if (el('btnLibraryDelete')) {
    el('btnLibraryDelete').addEventListener('click', () => {
      deleteLibraryItems([...librarySelected]);
    });
  }
  document.querySelectorAll('.nkbk-ai-library-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.nkbk-ai-library-tab').forEach((t) => t.classList.remove('is-active'));
      tab.classList.add('is-active');
      libraryFilter = tab.getAttribute('data-filter') || 'all';
      renderLibraryList();
    });
  });
  if (el('btnProfileMenu')) {
    el('btnProfileMenu').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleProfileMenu();
    });
  }
  if (sidebarProfileMenu) {
    sidebarProfileMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      if (action === 'help') {
        window.NkbkAiHelp?.toggleSubmenu?.(btn);
        return;
      }
      closeProfileMenu();
      if (action === 'personalize') openSettingsModal('personalize');
      else if (action === 'settings') openSettingsModal('general');
      else if (action === 'logout') el('btnLogout')?.click();
    });
  }
  if (sidebarThreadMenu) {
    sidebarThreadMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      const btn = e.target.closest('[data-action]');
      if (!btn || !menuThreadId) return;
      const action = btn.getAttribute('data-action');
      const tid = menuThreadId;
      closeSidebarThreadMenu();
      if (action === 'share') shareThreadById(tid);
      else if (action === 'rename') renameThreadById(tid);
      else if (action === 'pin') togglePinThreadById(tid);
      else if (action === 'archive') archiveThreadById(tid);
      else if (action === 'delete') {
        if (tid === activeThreadId) deleteCurrentThread();
        else deleteThreadById(tid);
      } else if (action === 'group') {
        showBanner('ฟีเจอร์นี้จะเปิดใช้เร็วๆ นี้', 'info');
        setTimeout(() => bannerEl && bannerEl.classList.add('hidden'), 2200);
      }
    });
  }
  if (el('nkbkAiSettingsClose')) el('nkbkAiSettingsClose').addEventListener('click', closeSettingsModal);
  if (el('nkbkAiSettingsBackdrop')) el('nkbkAiSettingsBackdrop').addEventListener('click', closeSettingsModal);
  window.addEventListener('nkbk-ai-threads-changed', async (ev) => {
    invalidateComposerLibraryCache();
    if (composerSubmenuType === 'recent' && composerMenuOpen) {
      void ensureComposerLibraryItems(true).then(() => {
        if (composerSubmenuType === 'recent') renderRecentComposerSubmenu();
      });
    }
    const detail = ev && ev.detail;
    try {
      if (detail && detail.ok) {
        if (Array.isArray(detail.threads)) threads = detail.threads;
        if (detail.activeThreadId !== undefined) {
          activeThreadId = detail.activeThreadId || null;
          threadEngaged = !!activeThreadId;
        }
        renderThreadList();
        if (!activeThreadId || !threads.some((t) => t.id === activeThreadId && !t.archived)) {
          showLandingState();
        }
        return;
      }
      const data = await apiGet('/api/nkbk-ai-memory');
      if (data.ok && Array.isArray(data.threads)) {
        threads = data.threads;
        if (data.activeThreadId !== undefined) activeThreadId = data.activeThreadId || null;
        renderThreadList();
        if (!activeThreadId) showLandingState();
      }
    } catch (_) {}
  });
  window.addEventListener('nkbk-ai-theme-change', refreshEditRefArrows);
  window.addEventListener('nkbk-ai-settings-saved', (ev) => {
    const d = ev && ev.detail;
    if (d && d.preferences) window.__nkbkAiUserPrefs = d.preferences;
    if (d && d.userCallName != null) updateCallNameDisplay(d.userCallName);
    if (d && d.preferences && d.preferences.theme && window.NkbkAiSettings) {
      window.NkbkAiSettings.applyThemeFromPref(d.preferences.theme);
    }
    showBanner('บันทึกการตั้งค่าแล้ว', 'ok');
    setTimeout(() => bannerEl && bannerEl.classList.add('hidden'), 1800);
  });
  function openSidebarFromViewer() {
    expandSidebar();
  }

  if (el('nkbkAiViewerClose')) el('nkbkAiViewerClose').addEventListener('click', closeImageViewer);
  if (el('nkbkAiViewerRailMenu')) {
    el('nkbkAiViewerRailMenu').addEventListener('click', openSidebarFromViewer);
  }
  if (el('nkbkAiViewerRailNew')) {
    el('nkbkAiViewerRailNew').addEventListener('click', () => {
      closeImageViewer();
      newThread();
    });
  }
  if (el('nkbkAiViewerRailSearch')) {
    el('nkbkAiViewerRailSearch').addEventListener('click', () => {
      closeImageViewer();
      openSearchModal();
    });
  }
  if (el('nkbkAiViewerRailLibrary')) {
    el('nkbkAiViewerRailLibrary').addEventListener('click', () => {
      closeImageViewer();
      openLibrary();
    });
  }
  if (el('sidebarLogoHome')) {
    el('sidebarLogoHome').addEventListener('click', (e) => {
      e.preventDefault();
      closeComposerMenu();
      closeSearchModal();
      closeSettingsModal();
      if (isLibraryOpen()) closeLibrary();
      const wasViewer = isViewerOpen();
      if (wasViewer) closeImageViewer();
      if (wasViewer && document.body.classList.contains('sidebar-collapsed')) {
        expandSidebar();
      }
      newThread();
    });
  }
  if (viewer) {
    viewer.addEventListener(
      'wheel',
      (e) => {
        if (!viewer.classList.contains('open') || viewerImages.length < 2) return;
        if (!e.target.closest('.nkbk-ai-viewer-center')) return;
        const delta = e.deltaY > 0 ? 1 : e.deltaY < 0 ? -1 : 0;
        if (!delta || !navigateViewer(delta)) return;
        e.preventDefault();
      },
      { passive: false }
    );
  }
  if (el('nkbkAiViewerDownload')) {
    el('nkbkAiViewerDownload').addEventListener('click', () => {
      void downloadViewerImage();
    });
  }
  if (el('nkbkAiViewerShare')) el('nkbkAiViewerShare').addEventListener('click', shareViewerImage);
  if (viewerSendBtn) viewerSendBtn.addEventListener('click', submitViewerEdit);
  if (viewerInput) {
    viewerInput.addEventListener('input', () => {
      refreshViewerSendState();
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
  if (viewerFileInput) {
    viewerFileInput.addEventListener('change', () => {
      void onViewerFilesSelected(viewerFileInput.files);
      viewerFileInput.value = '';
    });
  }
  if (el('nkbkAiViewerAttach')) {
    el('nkbkAiViewerAttach').addEventListener('click', () => {
      if (!isViewerEditMode()) return;
      viewerFileInput?.click();
    });
  }

  function setupViewerImageDrop() {
    if (!viewer) return;
    let dragActive = false;
    const showDrop = () => {
      if (!isViewerEditMode()) return;
      dragActive = true;
      viewer.classList.add('is-dragover');
    };
    const hideDrop = () => {
      dragActive = false;
      viewer.classList.remove('is-dragover');
    };
    viewer.addEventListener('dragenter', (e) => {
      if (!isProbableImageDrag(e.dataTransfer)) return;
      e.preventDefault();
      showDrop();
    });
    viewer.addEventListener('dragover', (e) => {
      if (!isProbableImageDrag(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    viewer.addEventListener('dragleave', (e) => {
      if (!dragActive) return;
      const related = e.relatedTarget;
      if (related && viewer.contains(related)) return;
      hideDrop();
    });
    viewer.addEventListener('drop', (e) => {
      if (!isProbableImageDrag(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      hideDrop();
      if (!isViewerEditMode()) return;
      const payload = captureDropPayload(e.dataTransfer);
      resolveDropPayload(payload)
        .then((files) => {
          if (files.length) return onViewerFilesSelected(files);
          showBanner('วางไฟล์ไม่สำเร็จ — ลองใช้ปุ่ม + แทน', 'warn');
        })
        .catch(() => showBanner('วางไฟล์ไม่สำเร็จ — ลองใช้ปุ่ม + แทน', 'warn'));
    });
  }
  setupViewerImageDrop();
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
    closeSidebarThreadMenu();
    closeProfileMenu();
    closeLibraryRowMenus();
    viewerAspectMenu?.classList.add('hidden');
  });
  if (el('nkbkAiFilesClose')) el('nkbkAiFilesClose').addEventListener('click', closeFilesDrawer);
  if (el('nkbkAiFilesBackdrop')) el('nkbkAiFilesBackdrop').addEventListener('click', closeFilesDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeImageViewer();
      closeFilesDrawer();
      closeThreadMenu();
      closeSearchModal();
      closeLibrary();
      closeSettingsModal();
      window.NkbkAiHelp?.close?.();
      closeSidebarThreadMenu();
      closeProfileMenu();
    }
  });

  function updateStarterPillsUi() {
    document.querySelectorAll('.nkbk-ai-starter-pill').forEach((pill) => {
      const kind = pill.getAttribute('data-starter') || '';
      pill.classList.toggle('is-active', kind === activeStarter);
      pill.setAttribute('aria-pressed', kind === activeStarter ? 'true' : 'false');
    });
  }

  function isStarterPresetText(text) {
    const v = String(text || '').trim();
    return v.startsWith(STARTER_WRITE_PREFIX) || v.startsWith(STARTER_SEARCH_PREFIX);
  }

  function resetStarterState() {
    activeStarter = '';
    setGenerateMode(false);
    if (inputEl) {
      if (!inputEl.value.trim() || isStarterPresetText(inputEl.value)) {
        inputEl.value = '';
      }
      inputEl.placeholder = DEFAULT_PLACEHOLDER;
      inputEl.dispatchEvent(new Event('input'));
      resizeComposerInput();
    }
    updateStarterPillsUi();
  }

  function applyStarterAction(kind) {
    if (!inputEl || !kind) return;

    const prevStarter = activeStarter;
    if (prevStarter === kind) {
      resetStarterState();
      inputEl.focus();
      return;
    }

    activeStarter = kind;

    if (kind === 'image') {
      if (prevStarter || isStarterPresetText(inputEl.value)) {
        inputEl.value = '';
      }
      setGenerateMode(true);
      inputEl.placeholder = GENERATE_PLACEHOLDER;
    } else {
      setGenerateMode(false);
      inputEl.placeholder = DEFAULT_PLACEHOLDER;
      if (kind === 'write') {
        inputEl.value = STARTER_WRITE_PREFIX + '\n\n';
      } else if (kind === 'search') {
        inputEl.value = STARTER_SEARCH_PREFIX;
      }
    }

    inputEl.dispatchEvent(new Event('input'));
    resizeComposerInput();
    updateStarterPillsUi();
    inputEl.focus();
  }

  document.querySelectorAll('.nkbk-ai-starter-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      applyStarterAction(pill.getAttribute('data-starter') || '');
    });
  });

  function openSidebar() {
    closeProfileMenu();
    closeSidebarThreadMenu();
    document.body.classList.add('sidebar-open');
  }
  function closeSidebar() {
    document.body.classList.remove('sidebar-open');
    closeProfileMenu();
  }

  if (el('btnSidebarOpen')) el('btnSidebarOpen').addEventListener('click', openSidebar);
  if (el('btnSidebarClose')) el('btnSidebarClose').addEventListener('click', closeSidebar);
  if (el('btnSidebarCollapse')) el('btnSidebarCollapse').addEventListener('click', toggleSidebarCollapse);
  if (el('btnSidebarExpand')) el('btnSidebarExpand').addEventListener('click', expandSidebar);
  if (el('sidebarBackdrop')) el('sidebarBackdrop').addEventListener('click', closeSidebar);

  applyTheme();

  let chatBootStarted = false;
  function bootChat() {
    if (chatBootStarted) return;
    chatBootStarted = true;
    removeTyping();
    inflightByThread.clear();
    pendingOutboundByThread.clear();
    token = (window.NkbkAiAuthStore && window.NkbkAiAuthStore.getToken()) || '' || '';
    bootStartedAt = Date.now();
    syncSidebarProfile();
    updateLandingLayout();
    showBootSplash(true);
    setBootStatus('กำลังเตรียมแชทให้คุณ...');
    loadStatus()
      .then(loadUserPrefs)
      .then(loadMemory)
      .then(refreshSendState)
      .finally(finishBootSplash);
  }

  window.addEventListener('popstate', async () => {
    const threadParam = String(new URLSearchParams(location.search).get('thread') || '').trim();
    if (isLibraryPath(location.pathname) && !threadParam) {
      if (!isLibraryOpen()) await openLibrary({ fromUrl: true });
      return;
    }
    if (isLibraryOpen()) closeLibrary({ skipUrl: true });
    if (threadParam) {
      const t = threads.find((x) => x.id === threadParam || x.shareId === threadParam);
      if (t) await selectThread(t.id, { fromUrl: true, force: true });
      else {
        try {
          await selectThread(threadParam, { fromUrl: true, force: true });
        } catch (_) {
          showLandingState();
        }
      }
      return;
    }
    if (threadEngaged) showLandingState();
  });

  window.addEventListener('nkbk-ai-auth-ready', bootChat);
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    removeTyping();
    inflightByThread.clear();
    pendingOutboundByThread.clear();
    sending = false;
    refreshSendState();
  });
  if (el('appRoot') && !el('appRoot').classList.contains('hidden')) {
    bootChat();
  }

  window.NkbkAiChat = {
    startNewChatWithPrompt,
    openLightbox
  };
})();
