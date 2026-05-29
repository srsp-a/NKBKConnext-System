(function () {
  'use strict';

  const STORAGE_KEY = 'nkbk_cms_chat_history';
  const CONV_KEY = 'nkbk_cms_conversation_id';
  const API_BASE = '/api/public-cms-chat';
  const POLL_MS = 3000;

  const QUICK_PROMPTS = [
    'เวลาทำการสหกรณ์',
    'อัตราดอกเบี้ย',
    'แบบฟอร์มดาวน์โหลด',
    'ช่องทางติดต่อสหกรณ์',
    'วันหยุดมีวันไหนบ้าง'
  ];

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function loadConversationId() {
    try {
      return localStorage.getItem(CONV_KEY) || '';
    } catch (e) {
      return '';
    }
  }

  function saveConversationId(id) {
    try {
      if (id) localStorage.setItem(CONV_KEY, String(id));
    } catch (e) {}
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data.slice(-16) : [];
    } catch (e) {
      return [];
    }
  }

  function saveHistory(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(-16)));
    } catch (e) {}
  }

  const MONET_AVATAR_URL = '/images/monet-avatar.png';

  function appendContactIntro(container, contactTitle, introBody, avatarUrl, avatarPos) {
    const div = document.createElement('div');
    div.className = 'kb-chat-msg kb-chat-msg--bot kb-chat-msg--contact-intro';
    const body = document.createElement('div');
    body.className = 'kb-chat-msg-body';
    const lead = document.createElement('div');
    lead.className = 'kb-chat-contact-intro-lead';

    const line1 = document.createElement('div');
    line1.className = 'kb-chat-contact-intro-line';
    line1.textContent = 'สวัสดีค่ะ ต้องการติดต่อ';
    lead.appendChild(line1);

    const line2 = document.createElement('div');
    line2.className = 'kb-chat-contact-intro-line kb-chat-contact-intro-line--staff';
    const av = String(avatarUrl || '').trim();
    if (av) {
      const img = document.createElement('img');
      img.className = 'kb-chat-contact-intro-avatar';
      img.src = av;
      img.alt = '';
      img.loading = 'lazy';
      img.style.objectPosition = String(avatarPos || 'center center').trim() || 'center center';
      line2.appendChild(img);
    }
    const strong = document.createElement('strong');
    strong.textContent = contactTitle || 'เจ้าหน้าที่';
    line2.appendChild(strong);
    lead.appendChild(line2);

    const line3 = document.createElement('div');
    line3.className = 'kb-chat-contact-intro-line';
    line3.textContent = 'ใช่ไหมคะ';
    lead.appendChild(line3);

    body.appendChild(lead);
    if (introBody) {
      const p = document.createElement('div');
      p.className = 'kb-chat-msg-text';
      p.innerHTML = renderBotText(introBody);
      body.appendChild(p);
    }
    div.appendChild(body);
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
  }

  function renderWidget(root, cfg) {
    const avatarUrl = esc(cfg.avatarUrl || MONET_AVATAR_URL);
    root.innerHTML =
      '<button type="button" class="kb-chat-fab" id="kbChatFab" aria-label="แชทกับโมเน่">' +
        '<span class="kb-chat-fab-badge" id="kbChatFabBadge">1</span>' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">' +
          '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>' +
        '</svg>' +
      '</button>' +
      '<div class="kb-chat-panel" id="kbChatPanel" role="dialog" aria-label="แชทกับโมเน่">' +
        '<div class="kb-chat-head">' +
          '<div class="kb-chat-avatar" aria-hidden="true">' +
            '<img class="kb-chat-avatar-img" src="' + avatarUrl + '" alt="" width="44" height="44" loading="lazy">' +
          '</div>' +
          '<div class="kb-chat-head-text">' +
            '<div class="kb-chat-head-title">น้อง' + esc(cfg.name || 'โมเน่') + '</div>' +
            '<div class="kb-chat-head-sub">ผู้ช่วยบริการสมาชิก</div>' +
          '</div>' +
          '<button type="button" class="kb-chat-close" id="kbChatClose" aria-label="ปิดแชท">&times;</button>' +
        '</div>' +
        '<div class="kb-chat-status-bar" id="kbChatStatusBar" hidden>รอเจ้าหน้าที่ตอบ…</div>' +
        '<div class="kb-chat-messages" id="kbChatMessages"></div>' +
        '<div class="kb-chat-quick" id="kbChatQuick">' +
          '<div class="kb-chat-quick-label">คำถามด่วน</div>' +
          '<div class="kb-chat-quick-scroll" id="kbChatQuickScroll"></div>' +
        '</div>' +
        '<div class="kb-chat-foot">' +
          '<div class="kb-chat-rating" id="kbChatRating" hidden>' +
            '<p class="kb-chat-rating-title">ให้คะแนนความพึงพอใจการตอบของเจ้าหน้าที่</p>' +
            '<div class="kb-chat-rating-stars" id="kbChatRatingStars"></div>' +
            '<textarea class="kb-chat-rating-comment" id="kbChatRatingComment" rows="2" placeholder="ความคิดเห็น (ไม่บังคับ)" maxlength="300"></textarea>' +
            '<button type="button" class="kb-chat-rating-submit" id="kbChatRatingSubmit">ส่งความคิดเห็น</button>' +
          '</div>' +
          '<form class="kb-chat-form" id="kbChatForm">' +
            '<div class="kb-chat-compose-shell">' +
              '<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" id="kbChatImageInput" multiple hidden>' +
              '<button type="button" class="kb-chat-image-btn" id="kbChatImageBtn" aria-label="ส่งรูปภาพ">' +
                '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
                  '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>' +
                '</svg>' +
              '</button>' +
              '<textarea class="kb-chat-input" id="kbChatInput" rows="1" placeholder="พิมพ์คำถาม..." maxlength="2000"></textarea>' +
              '<button type="submit" class="kb-chat-send" id="kbChatSend" aria-label="ส่ง">' +
              '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg>' +
            '</button>' +
            '</div>' +
          '</form>' +
          '<p class="kb-chat-note">AI อาจตอบผิดพลาดได้ — เรื่องสำคัญโปรดติดต่อเจ้าหน้าที่สหกรณ์</p>' +
        '</div>' +
      '</div>';
  }

  function renderBotText(text) {
    let s = esc(String(text || ''));
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, label, url) {
      const u = String(url || '').trim();
      if (!/^\/[a-z0-9/-]*$/i.test(u)) return esc(label);
      return '<a href="' + esc(u) + '" class="kb-chat-link">' + esc(label) + '</a>';
    });
    return s.replace(/\n/g, '<br>');
  }

  function downloadPdfFile(url, title) {
    const proxy = '/api/cms-pdf?url=' + encodeURIComponent(url);
    const safeName = String(title || 'document')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .trim()
      .slice(0, 80) || 'document';
    return fetch(proxy)
      .then(function (res) {
        if (!res.ok) throw new Error('ดาวน์โหลดไม่สำเร็จ');
        return res.blob();
      })
      .then(function (blob) {
        const objUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objUrl;
        a.download = safeName + '.pdf';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(objUrl); }, 1000);
      });
  }

  function staffDisplayLabel(meta) {
    const extras = meta && typeof meta === 'object' ? meta : {};
    return String(extras.authorRoleLabel || extras.authorName || 'เจ้าหน้าที่').trim();
  }

  function staffInitial(meta) {
    const extras = meta && typeof meta === 'object' ? meta : {};
    const name = String(extras.authorName || extras.authorRoleLabel || 'เ').trim();
    return name.charAt(0) || 'เ';
  }

  function fmtMsgTime(ms) {
    const n = Number(ms);
    if (!n || Number.isNaN(n)) return '';
    try {
      const d = new Date(n);
      const day = d.getDate();
      const mon = d.getMonth() + 1;
      const yr = (d.getFullYear() + 543) % 100;
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return day + '/' + mon + '/' + yr + ' ' + hh + ':' + mm;
    } catch (e) {
      return '';
    }
  }

  function appendMsgTime(parent, meta) {
    const extras = meta && typeof meta === 'object' ? meta : {};
    const t = fmtMsgTime(extras.createdAtMs);
    if (!t) return;
    const el = document.createElement('div');
    el.className = 'kb-chat-msg-time';
    el.textContent = t;
    parent.appendChild(el);
  }

  function appendStaffPhoto(parent, meta) {
    const extras = meta && typeof meta === 'object' ? meta : {};
    const photo = document.createElement('div');
    photo.className = 'kb-chat-staff-reply-photo';
    const url = String(extras.authorPhotoUrl || '').trim();
    const pos = String(extras.authorPhotoPosition || 'center center').trim() || 'center center';
    if (url) {
      const img = document.createElement('img');
      img.className = 'kb-chat-staff-reply-img';
      img.src = url;
      img.alt = '';
      img.loading = 'lazy';
      img.style.objectPosition = pos;
      img.addEventListener('error', function () {
        img.remove();
        photo.classList.add('is-fallback');
        photo.textContent = staffInitial(extras);
      });
      photo.appendChild(img);
    } else {
      photo.classList.add('is-fallback');
      photo.textContent = staffInitial(extras);
    }
    parent.appendChild(photo);
  }

  function ensureChatOverlays() {
    const panel = document.getElementById('kbChatPanel');
    if (!panel || panel.querySelector('#kbChatDialog')) return;
    const dialog = document.createElement('div');
    dialog.id = 'kbChatDialog';
    dialog.className = 'kb-chat-dialog';
    dialog.hidden = true;
    dialog.innerHTML =
      '<div class="kb-chat-dialog-backdrop" data-kb-chat-dialog-close></div>' +
      '<div class="kb-chat-dialog-card" role="alertdialog" aria-modal="true">' +
        '<div class="kb-chat-dialog-icon" id="kbChatDialogIcon" aria-hidden="true"></div>' +
        '<h3 class="kb-chat-dialog-title" id="kbChatDialogTitle"></h3>' +
        '<p class="kb-chat-dialog-text" id="kbChatDialogText"></p>' +
        '<button type="button" class="kb-chat-dialog-btn" id="kbChatDialogBtn">ตกลง</button>' +
      '</div>';
    const lightbox = document.createElement('div');
    lightbox.id = 'kbChatLightbox';
    lightbox.className = 'kb-chat-lightbox';
    lightbox.hidden = true;
    lightbox.innerHTML =
      '<div class="kb-chat-lightbox-backdrop" data-kb-chat-lightbox-close></div>' +
      '<div class="kb-chat-lightbox-shell">' +
        '<button type="button" class="kb-chat-lightbox-close" data-kb-chat-lightbox-close aria-label="ปิด">&times;</button>' +
        '<img class="kb-chat-lightbox-img" id="kbChatLightboxImg" src="" alt="">' +
      '</div>';
    panel.appendChild(dialog);
    panel.appendChild(lightbox);
  }

  function showChatAlert(message, opts) {
    const options = opts && typeof opts === 'object' ? opts : {};
    ensureChatOverlays();
    const dialog = document.getElementById('kbChatDialog');
    const titleEl = document.getElementById('kbChatDialogTitle');
    const textEl = document.getElementById('kbChatDialogText');
    const iconEl = document.getElementById('kbChatDialogIcon');
    const btn = document.getElementById('kbChatDialogBtn');
    if (!dialog || !titleEl || !textEl || !iconEl || !btn) return;
    const variant = options.variant === 'info' ? 'info' : 'warn';
    titleEl.textContent = options.title || (variant === 'info' ? 'แจ้งเตือน' : 'ส่งรูปไม่ได้');
    textEl.textContent = String(message || '');
    dialog.classList.toggle('is-info', variant === 'info');
    dialog.classList.toggle('is-warn', variant !== 'info');
    iconEl.textContent = variant === 'info' ? 'ℹ️' : '🖼️';
    dialog.hidden = false;
    function closeDialog() {
      dialog.hidden = true;
      btn.removeEventListener('click', closeDialog);
      dialog.querySelectorAll('[data-kb-chat-dialog-close]').forEach(function (el) {
        el.removeEventListener('click', closeDialog);
      });
    }
    btn.addEventListener('click', closeDialog);
    dialog.querySelectorAll('[data-kb-chat-dialog-close]').forEach(function (el) {
      el.addEventListener('click', closeDialog);
    });
    btn.focus();
  }

  function openChatLightbox(url, alt) {
    if (!url) return;
    ensureChatOverlays();
    var lightbox = document.getElementById('kbChatLightbox');
    var img = document.getElementById('kbChatLightboxImg');
    if (!lightbox || !img) return;
    if (lightbox.parentNode !== document.body) {
      document.body.appendChild(lightbox);
    }
    img.src = String(url);
    img.alt = alt || 'รูปภาพ';
    lightbox.hidden = false;
    lightbox.classList.add('is-open');
    document.body.classList.add('kb-chat-lightbox-open');
    function closeLightbox() {
      lightbox.hidden = true;
      lightbox.classList.remove('is-open');
      document.body.classList.remove('kb-chat-lightbox-open');
      img.src = '';
      lightbox.querySelectorAll('[data-kb-chat-lightbox-close]').forEach(function (el) {
        el.removeEventListener('click', closeLightbox);
      });
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) {
      if (e.key === 'Escape') closeLightbox();
    }
    lightbox.querySelectorAll('[data-kb-chat-lightbox-close]').forEach(function (el) {
      el.addEventListener('click', closeLightbox);
    });
    document.addEventListener('keydown', onKey);
  }

  function appendMessageImage(parent, url, alt) {
    const wrap = document.createElement('button');
    wrap.type = 'button';
    wrap.className = 'kb-chat-msg-image-btn';
    wrap.setAttribute('aria-label', 'ดูรูปภาพขนาดเต็ม');
    const img = document.createElement('img');
    img.className = 'kb-chat-msg-image';
    img.src = String(url || '');
    img.alt = alt || 'รูปภาพ';
    img.loading = 'lazy';
    wrap.appendChild(img);
    wrap.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openChatLightbox(url, alt);
    });
    parent.appendChild(wrap);
  }

  function appendMessage(container, role, text, meta) {
    const div = document.createElement('div');
    const isStaff = role === 'staff' || (meta && meta.authorType === 'staff');
    div.className = 'kb-chat-msg kb-chat-msg--' + (role === 'user' ? 'user' : (isStaff ? 'staff' : 'bot'));
    const extras = meta && typeof meta === 'object' ? meta : {};

    if (role === 'user') {
      if (extras.messageType === 'image' && extras.imageUrl) {
        appendMessageImage(div, extras.imageUrl, text || 'รูปภาพ');
      } else {
        div.textContent = text;
      }
      appendMsgTime(div, extras);
    } else if (isStaff) {
      const body = document.createElement('div');
      body.className = 'kb-chat-msg-body';
      const header = document.createElement('div');
      header.className = 'kb-chat-staff-reply-header';
      appendStaffPhoto(header, extras);
      const labelEl = document.createElement('div');
      labelEl.className = 'kb-chat-staff-reply-label';
      labelEl.textContent = staffDisplayLabel(extras);
      header.appendChild(labelEl);
      body.appendChild(header);
      if (extras.messageType === 'image' && extras.imageUrl) {
        appendMessageImage(body, extras.imageUrl, text || 'รูปภาพจากเจ้าหน้าที่');
      } else {
        const p = document.createElement('div');
        p.className = 'kb-chat-msg-text';
        p.innerHTML = renderBotText(text);
        body.appendChild(p);
      }
      div.appendChild(body);
      appendMsgTime(div, extras);
    } else {
      const body = document.createElement('div');
      body.className = 'kb-chat-msg-body';
      if (text) {
        const p = document.createElement('div');
        p.className = 'kb-chat-msg-text';
        p.innerHTML = renderBotText(text);
        body.appendChild(p);
      }
      if (extras.html) {
        const rich = document.createElement('div');
        rich.className = 'kb-chat-msg-rich';
        rich.innerHTML = extras.html;
        body.appendChild(rich);
      }
      if (extras.downloads && extras.downloads.length) {
        const dlWrap = document.createElement('div');
        dlWrap.className = 'kb-chat-downloads';
        extras.downloads.forEach(function (item) {
          if (!item || !item.url) return;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'kb-chat-download-btn';
          if (item.id) btn.setAttribute('data-download-id', item.id);
          btn.innerHTML =
            '<span class="kb-chat-download-btn-icon" aria-hidden="true">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
            '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
            '<polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></span>' +
            '<span class="kb-chat-download-btn-label">' + esc(item.title || 'ดาวน์โหลด') + '</span>';
          btn.addEventListener('click', function (e) {
            e.preventDefault();
            if (btn.classList.contains('is-loading')) return;
            btn.classList.add('is-loading');
            btn.setAttribute('aria-busy', 'true');
            if (item.id && window.CmsCounters) {
              window.CmsCounters.bump('cms_download_counts', item.id).catch(function () {});
            }
            downloadPdfFile(item.url, item.title)
              .catch(function () {
                window.alert('ดาวน์โหลดไม่สำเร็จ กรุณาลองใหม่');
              })
              .finally(function () {
                btn.classList.remove('is-loading');
                btn.removeAttribute('aria-busy');
              });
          });
          dlWrap.appendChild(btn);
        });
        body.appendChild(dlWrap);
      }
      div.appendChild(body);
      appendMsgTime(div, extras);
    }

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
  }

  function historyMeta(meta) {
    if (!meta || typeof meta !== 'object') return null;
    const out = {};
    if (meta.html) out.html = meta.html;
    if (meta.downloads && meta.downloads.length) out.downloads = meta.downloads;
    if (meta.messageType) out.messageType = meta.messageType;
    if (meta.imageUrl) out.imageUrl = meta.imageUrl;
    if (meta.createdAtMs) out.createdAtMs = meta.createdAtMs;
    return Object.keys(out).length ? out : null;
  }

  async function initMemberChatWidget() {
    if (window.__kbMemberChatReady) return;
    const root = document.getElementById('kb-member-chat-root');
    if (!root) return;

    let cfg = {
      enabled: false,
      name: 'โมเน่',
      greeting: 'สวัสดีค่ะ น้องโมเน่ ยินดีให้บริการสมาชิกสหกรณ์ค่ะ มีอะไรให้ช่วยไหมคะ?'
    };
    try {
      const res = await fetch(API_BASE + '/status');
      const data = await res.json();
      if (data && data.ok) cfg = { ...cfg, ...data };
    } catch (e) {
      return;
    }
    if (!cfg.enabled) return;

    window.__kbMemberChatReady = true;
    renderWidget(root, cfg);

    const fab = document.getElementById('kbChatFab');
    const panel = document.getElementById('kbChatPanel');
    const closeBtn = document.getElementById('kbChatClose');
    const messagesEl = document.getElementById('kbChatMessages');
    const quickScroll = document.getElementById('kbChatQuickScroll');
    const form = document.getElementById('kbChatForm');
    const input = document.getElementById('kbChatInput');
    const sendBtn = document.getElementById('kbChatSend');
    const badge = document.getElementById('kbChatFabBadge');
    const imageBtn = document.getElementById('kbChatImageBtn');
    const imageInput = document.getElementById('kbChatImageInput');

    let history = loadHistory();
    let conversationId = loadConversationId();
    let open = false;
    let sending = false;
    let greeted = history.length > 0;
    let pollTimer = null;
    let lastPollSince = 0;
    let seenStaffIds = new Set();
    const statusBar = document.getElementById('kbChatStatusBar');
    const STAFF_TYPING_MAX_MS = 60 * 1000;
    let remoteTypingEl = null;
    let remoteTypingTimer = null;
    let lastVisitorPresenceAt = 0;
    let pendingContact = null;
    let contactIntroShown = false;
    let contactHandoffSent = false;
    let activeQuickPrompts = QUICK_PROMPTS.slice();
    let selectedRating = 0;
    let allowMemberImages = false;
    let imageUploading = false;
    const ratingPanel = document.getElementById('kbChatRating');
    const ratingStars = document.getElementById('kbChatRatingStars');
    const ratingComment = document.getElementById('kbChatRatingComment');
    const ratingSubmit = document.getElementById('kbChatRatingSubmit');

    function hideRatingPanel() {
      if (ratingPanel) ratingPanel.hidden = true;
      selectedRating = 0;
      if (ratingComment) ratingComment.value = '';
      if (ratingStars) {
        ratingStars.querySelectorAll('.kb-chat-rating-star').forEach(function (s) {
          s.classList.remove('is-active');
        });
      }
    }

    function showRatingPanel() {
      if (!ratingPanel || !conversationId) return;
      ratingPanel.hidden = false;
    }

    function bindRatingStars() {
      if (!ratingStars || ratingStars.dataset.bound) return;
      ratingStars.dataset.bound = '1';
      ratingStars.innerHTML = '';
      for (let i = 1; i <= 5; i++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'kb-chat-rating-star';
        btn.setAttribute('aria-label', i + ' ดาว');
        btn.textContent = '★';
        btn.addEventListener('click', function () {
          selectedRating = i;
          ratingStars.querySelectorAll('.kb-chat-rating-star').forEach(function (s, idx) {
            s.classList.toggle('is-active', idx < i);
          });
        });
        ratingStars.appendChild(btn);
      }
      if (ratingSubmit) {
        ratingSubmit.addEventListener('click', async function () {
          if (!selectedRating || !conversationId) return;
          ratingSubmit.disabled = true;
          try {
            const res = await fetch(API_BASE + '/rating', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                conversationId: conversationId,
                score: selectedRating,
                comment: ratingComment ? ratingComment.value.trim() : ''
              })
            });
            const data = await res.json();
            hideRatingPanel();
            appendMessage(messagesEl, 'bot', (data && data.message) || 'ขอบคุณสำหรับความคิดเห็นค่ะ');
          } catch (_) {
            window.alert('ส่งคะแนนไม่สำเร็จ');
          } finally {
            ratingSubmit.disabled = false;
          }
        });
      }
    }
    bindRatingStars();

    function syncImageButton(enabled) {
      allowMemberImages = !!enabled;
      if (!imageBtn) return;
      imageBtn.classList.toggle('is-visible', allowMemberImages);
      imageBtn.disabled = imageUploading || !conversationId || !allowMemberImages;
      if (imageInput && !allowMemberImages) imageInput.value = '';
    }

    function readFileAsDataUrl(file) {
      return new Promise(function (resolve, reject) {
        const reader = new FileReader();
        reader.onload = function () {
          resolve(String(reader.result || ''));
        };
        reader.onerror = function () {
          reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
        };
        reader.readAsDataURL(file);
      });
    }

    async function sendMemberImages(fileList) {
      const files = Array.from(fileList || []).filter(function (f) {
        return f && /^image\//i.test(String(f.type || ''));
      });
      for (let i = 0; i < files.length; i++) {
        await sendMemberImage(files[i]);
      }
    }

    async function sendMemberImage(file) {
      if (!file || !conversationId || !allowMemberImages || imageUploading) return;
      if (file.size > 5 * 1024 * 1024) {
        showChatAlert('กรุณาเลือกรูปที่มีขนาดไม่เกิน 5 MB', { title: 'ไฟล์ใหญ่เกินไป', variant: 'info' });
        return;
      }
      imageUploading = true;
      syncImageButton(allowMemberImages);
      const createdAtMs = Date.now();
      let previewMeta = { messageType: 'image', imageUrl: '', createdAtMs: createdAtMs };
      let previewEl = null;
      try {
        const dataUrl = await readFileAsDataUrl(file);
        previewMeta.imageUrl = dataUrl;
        previewEl = appendMessage(messagesEl, 'user', '[รูปภาพ]', previewMeta);
        const res = await fetch(API_BASE + '/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationId: conversationId,
            imageBase64: dataUrl,
            mimeType: file.type || 'image/jpeg',
            fileName: file.name || 'image.jpg'
          })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error((data && data.message) || 'ส่งรูปไม่สำเร็จ');
        const finalMeta = {
          messageType: 'image',
          imageUrl: data.imageUrl || '',
          createdAtMs: data.createdAtMs || createdAtMs
        };
        history.push({ role: 'user', content: '[รูปภาพ]', createdAtMs: finalMeta.createdAtMs, meta: finalMeta });
        saveHistory(history);
        setWaitingStatus(true);
        pollStaffMessages();
      } catch (err) {
        if (previewEl && previewEl.parentNode) previewEl.parentNode.removeChild(previewEl);
        const msg = (err && err.message) || 'ส่งรูปไม่สำเร็จ';
        const isDenied = /ไม่อนุญาต|ยังไม่/.test(msg);
        showChatAlert(msg, {
          title: isDenied ? 'ยังส่งรูปไม่ได้' : 'ส่งรูปไม่สำเร็จ',
          variant: isDenied ? 'warn' : 'info'
        });
        if (isDenied) syncImageButton(false);
      } finally {
        imageUploading = false;
        syncImageButton(allowMemberImages);
        if (imageInput) imageInput.value = '';
      }
    }

    if (imageBtn && imageInput) {
      imageBtn.addEventListener('click', function () {
        if (!allowMemberImages || imageUploading || !conversationId) {
          if (!allowMemberImages) {
            showChatAlert('เจ้าหน้าที่ยังไม่อนุญาตให้ส่งรูปในแชตนี้ — กรุณารอเจ้าหน้าที่เปิดสิทธิ์ให้ก่อน', {
              title: 'ยังส่งรูปไม่ได้',
              variant: 'warn'
            });
          }
          return;
        }
        imageInput.click();
      });
      imageInput.addEventListener('change', function () {
        const files = imageInput.files;
        if (!files || !files.length) return;
        sendMemberImages(files);
      });
    }

    const composeShell = document.querySelector('.kb-chat-compose-shell');
    if (composeShell && !composeShell.__dropBound) {
      composeShell.__dropBound = true;
      composeShell.addEventListener('dragenter', function (e) {
        e.preventDefault();
        composeShell.classList.add('is-dragover');
      });
      composeShell.addEventListener('dragover', function (e) {
        e.preventDefault();
        composeShell.classList.add('is-dragover');
      });
      composeShell.addEventListener('dragleave', function (e) {
        e.preventDefault();
        if (!composeShell.contains(e.relatedTarget)) composeShell.classList.remove('is-dragover');
      });
      composeShell.addEventListener('drop', function (e) {
        e.preventDefault();
        composeShell.classList.remove('is-dragover');
        if (!allowMemberImages || imageUploading || !conversationId) {
          if (!allowMemberImages) {
            showChatAlert('เจ้าหน้าที่ยังไม่อนุญาตให้ส่งรูปในแชตนี้ — กรุณารอเจ้าหน้าที่เปิดสิทธิ์ให้ก่อน', {
              title: 'ยังส่งรูปไม่ได้',
              variant: 'warn'
            });
          }
          return;
        }
        const dt = e.dataTransfer;
        if (dt && dt.files && dt.files.length) sendMemberImages(dt.files);
      });
    }

    function resetContactUi() {
      renderQuickPromptButtons(QUICK_PROMPTS);
      hideRatingPanel();
    }

    function exitContactSession(reasonText) {
      pendingContact = null;
      contactHandoffSent = false;
      resetContactUi();
      setWaitingStatus(false);
      if (statusBar) {
        statusBar.hidden = true;
        statusBar.classList.remove('is-message-mode');
      }
      if (reasonText) {
        appendMessage(messagesEl, 'bot', reasonText);
        history.push({ role: 'assistant', content: reasonText });
        saveHistory(history);
      }
    }

    function renderQuickPromptButtons(labels) {
      if (!quickScroll) return;
      const list = Array.isArray(labels) && labels.length ? labels : QUICK_PROMPTS;
      activeQuickPrompts = list.slice();
      quickScroll.innerHTML = '';
      list.forEach(function (label) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'kb-chat-quick-btn';
        btn.textContent = label;
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (quickSuppressClick || sending) return;
          input.value = label;
          form.requestSubmit();
        });
        quickScroll.appendChild(btn);
      });
    }

    function setContactBanner(mode) {
      if (!statusBar) return;
      if (mode === 'message') {
        statusBar.hidden = false;
        statusBar.textContent = 'ฝากข้อความ — เจ้าหน้าที่จะตอบในเวลาทำการ';
        statusBar.classList.add('is-message-mode');
      } else if (mode === 'live' || mode === 'waiting') {
        statusBar.hidden = false;
        statusBar.textContent = 'กรุณารอสักครู่นะคะ';
        statusBar.classList.remove('is-message-mode');
      } else {
        statusBar.classList.remove('is-message-mode');
      }
    }

    async function openStaffContact(opts) {
      opts = opts && typeof opts === 'object' ? opts : {};
      const staffId = String(opts.staffId || '').trim();
      const shortCode = String(opts.code || opts.shortCode || '').trim().toLowerCase();
      if (!staffId && !shortCode) return;
      setOpen(true);
      pendingContact = {
        staffId: staffId,
        shortCode: shortCode,
        staffName: String(opts.staffName || '').trim(),
        contactTitle: String(opts.contactTitle || '').trim(),
        prefill: String(opts.prefill || '').trim()
      };
      contactIntroShown = false;
      try {
        let url = API_BASE + '/staff-contact?';
        if (shortCode) url += 'code=' + encodeURIComponent(shortCode);
        else url += 'staffId=' + encodeURIComponent(staffId);
        const res = await fetch(url);
        const data = await res.json();
        if (!res.ok || !data.ok) {
          appendMessage(messagesEl, 'bot', (data && data.message) || 'ไม่พบข้อมูลเจ้าหน้าที่');
          pendingContact = null;
          resetContactUi();
          return;
        }
        pendingContact.staffId = (data.staff && data.staff.id) || pendingContact.staffId;
        pendingContact.staffName = (data.staff && data.staff.name) || pendingContact.staffName;
        pendingContact.contactTitle = (data.staff && data.staff.contactTitle) || pendingContact.contactTitle;
        pendingContact.contactMode = data.contactMode || 'message';
        pendingContact.canLiveChat = !!data.canLiveChat;
        if (data.quickPrompts && data.quickPrompts.length) {
          renderQuickPromptButtons(data.quickPrompts);
        }
        if (!contactIntroShown) {
          const title = pendingContact.contactTitle || (data.staff && data.staff.contactTitle) || '';
          const body = data.introBody || '';
          const avatar = data.prefillAvatar || (data.staff && data.staff.avatar) || '';
          if (title) {
            appendContactIntro(
              messagesEl,
              title,
              body,
              avatar,
              data.prefillAvatarPosition || (data.staff && data.staff.avatarPosition)
            );
            history.push({ role: 'assistant', content: 'ติดต่อ ' + title });
            saveHistory(history);
            contactIntroShown = true;
            greeted = true;
          }
        }
        const prefill = pendingContact.prefill || data.prefill || '';
        if (prefill && input) {
          input.value = prefill;
          input.style.height = 'auto';
          input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        }
        setContactBanner(data.canLiveChat ? 'live' : 'message');
        setTimeout(function () {
          if (input) input.focus();
        }, 250);
      } catch (_) {
        appendMessage(messagesEl, 'bot', 'เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่');
        pendingContact = null;
        resetContactUi();
      }
    }

    window.NkbkMemberChat = {
      open: openStaffContact,
      isReady: function () {
        return true;
      }
    };

    function pingVisitorPresence(flags) {
      if (!conversationId) return;
      const now = Date.now();
      if (now - lastVisitorPresenceAt < 2000) return;
      lastVisitorPresenceAt = now;
      const payload = {
        conversationId: conversationId,
        typing: !!(flags && flags.typing),
        focused: flags && flags.focused !== undefined ? !!flags.focused : true
      };
      fetch(API_BASE + '/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(function () {});
    }

    function clearRemoteTyping() {
      if (remoteTypingTimer) {
        clearTimeout(remoteTypingTimer);
        remoteTypingTimer = null;
      }
      if (remoteTypingEl) {
        remoteTypingEl.remove();
        remoteTypingEl = null;
      }
    }

    function showRemoteTyping(kind) {
      clearRemoteTyping();
      if (!messagesEl) return;
      if (kind === 'staff') {
        const div = document.createElement('div');
        div.className = 'kb-chat-msg kb-chat-msg--staff kb-chat-msg--typing';
        const body = document.createElement('div');
        body.className = 'kb-chat-msg-body';
        const header = document.createElement('div');
        header.className = 'kb-chat-staff-reply-header';
        const labelEl = document.createElement('div');
        labelEl.className = 'kb-chat-staff-reply-label';
        labelEl.textContent = 'เจ้าหน้าที่';
        header.appendChild(labelEl);
        body.appendChild(header);
        const p = document.createElement('div');
        p.className = 'kb-chat-msg-text';
        p.textContent = 'กำลังพิมพ์...';
        body.appendChild(p);
        div.appendChild(body);
        messagesEl.appendChild(div);
        remoteTypingEl = div;
      } else {
        remoteTypingEl = appendMessage(messagesEl, 'bot', 'กำลังพิมพ์...');
        remoteTypingEl.classList.add('kb-chat-msg--typing');
      }
      messagesEl.scrollTop = messagesEl.scrollHeight;
      remoteTypingTimer = setTimeout(clearRemoteTyping, STAFF_TYPING_MAX_MS);
    }

    function rememberAiReply(aiMsg) {
      if (!aiMsg) return false;
      const text = String(aiMsg.content || aiMsg.reply || '').trim();
      if (!text) return false;
      clearRemoteTyping();
      setWaitingStatus(false);
      const meta = {};
      if (aiMsg.html) meta.html = aiMsg.html;
      if (aiMsg.downloads && aiMsg.downloads.length) meta.downloads = aiMsg.downloads;
      appendMessage(messagesEl, 'bot', text, meta);
      const histItem = { role: 'assistant', content: text };
      const savedMeta = historyMeta(meta);
      if (savedMeta) histItem.meta = savedMeta;
      history.push(histItem);
      saveHistory(history);
      if (!open) badge.classList.add('is-visible');
      return true;
    }

    function setWaitingStatus(on) {
      if (!statusBar) return;
      if (on) {
        statusBar.hidden = false;
        if (pendingContact && pendingContact.contactMode === 'message') {
          statusBar.textContent = 'ฝากข้อความแล้ว — เจ้าหน้าที่จะตอบในเวลาทำการ';
          statusBar.classList.add('is-message-mode');
        } else {
          statusBar.textContent = 'กรุณารอสักครู่นะคะ';
          statusBar.classList.remove('is-message-mode');
        }
      } else if (!pendingContact) {
        statusBar.hidden = true;
        statusBar.classList.remove('is-message-mode');
      }
    }

    function rememberStaffMessage(m) {
      if (!m || !m.id || seenStaffIds.has(m.id)) return false;
      seenStaffIds.add(m.id);
      if (m.createdAtMs && m.createdAtMs > lastPollSince) lastPollSince = m.createdAtMs;
      clearRemoteTyping();
      setWaitingStatus(false);
      appendMessage(messagesEl, 'staff', m.content || '', {
        authorType: 'staff',
        authorName: m.authorName || 'เจ้าหน้าที่',
        authorRoleLabel: m.authorRoleLabel || '',
        authorPhotoUrl: m.authorPhotoUrl || '',
        authorPhotoPosition: m.authorPhotoPosition || '',
        messageType: m.messageType || '',
        imageUrl: m.imageUrl || '',
        createdAtMs: m.createdAtMs || Date.now()
      });
      history.push({
        id: m.id,
        role: 'staff',
        content: m.content || '',
        createdAtMs: m.createdAtMs || Date.now(),
        meta: {
          authorName: m.authorName,
          authorRoleLabel: m.authorRoleLabel,
          authorPhotoUrl: m.authorPhotoUrl,
          authorPhotoPosition: m.authorPhotoPosition,
          authorType: 'staff',
          messageType: m.messageType || '',
          imageUrl: m.imageUrl || '',
          createdAtMs: m.createdAtMs || Date.now()
        }
      });
      saveHistory(history);
      if (!open) badge.classList.add('is-visible');
      if (typeof window.playMoneeChatNotifySound === 'function') window.playMoneeChatNotifySound();
      return true;
    }

    function startPoll() {
      if (pollTimer) return;
      pollStaffMessages();
      pollTimer = setInterval(pollStaffMessages, POLL_MS);
    }


    async function pollStaffMessages() {
      if (!conversationId) return;
      try {
        var url = API_BASE + '/poll?conversationId=' + encodeURIComponent(conversationId);
        if (lastPollSince) url += '&since=' + encodeURIComponent(String(lastPollSince));
        var res = await fetch(url);
        var data = await res.json();
        if (!res.ok || !data.ok) return;
        if (data.releasedToAi) {
          setWaitingStatus(false);
          clearRemoteTyping();
          if (data.contactReleased) {
            if (data.pendingRating) showRatingPanel();
            exitContactSession('เจ้าหน้าที่ไม่ว่างตอบในเวลานี้ — น้องโมเน่ช่วยต่อให้ได้ค่ะ');
          } else if (data.aiMessage) {
            rememberAiReply(data.aiMessage);
          }
          (data.messages || []).forEach(function (m) {
            rememberStaffMessage(m);
          });
          return;
        }
        if (data.conversationClosed) {
          setWaitingStatus(false);
          clearRemoteTyping();
          if (data.pendingRating) showRatingPanel();
          exitContactSession('เคสนี้ปิดแล้ว — ขอบคุณที่ติดต่อสหกรณ์ค่ะ');
          (data.messages || []).forEach(function (m) {
            rememberStaffMessage(m);
          });
          return;
        }
        (data.messages || []).forEach(function (m) {
          rememberStaffMessage(m);
        });
        if (data.releasedToAi || data.conversationClosed) return;
        if (data.waitingForStaff) {
          setWaitingStatus(true);
        } else {
          setWaitingStatus(false);
        }
        if (data.staffTyping) showRemoteTyping('staff');
        else clearRemoteTyping();
        syncImageButton(data.allowMemberImages);
      } catch (e) {}
    }

    function setOpen(next) {
      open = !!next;
      panel.classList.toggle('is-open', open);
      if (open) {
        badge.classList.remove('is-visible');
        if (conversationId) startPoll();
        pollStaffMessages();
        if (!greeted) {
          appendMessage(messagesEl, 'bot', cfg.greeting);
          history.push({ role: 'assistant', content: cfg.greeting });
          saveHistory(history);
          greeted = true;
        }
        setTimeout(function () { input.focus(); }, 200);
      }
    }

    history.forEach(function (m) {
      var role = m.role === 'user' ? 'user' : (m.role === 'staff' ? 'staff' : 'bot');
      var meta = m.meta || null;
      if (meta && m.createdAtMs && !meta.createdAtMs) meta.createdAtMs = m.createdAtMs;
      appendMessage(messagesEl, role, m.content, meta);
      if (m.role === 'staff' && m.id) seenStaffIds.add(m.id);
      if (m.role === 'staff' && m.createdAtMs && m.createdAtMs > lastPollSince) {
        lastPollSince = m.createdAtMs;
      }
    });
    if (history.length) greeted = true;
    if (conversationId) startPoll();
    syncImageButton(false);

    messagesEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.kb-chat-payment-copy');
      if (!btn) return;
      e.preventDefault();
      var text = btn.getAttribute('data-copy') || '';
      if (!text) return;
      var done = function () {
        btn.classList.add('is-copied');
        btn.setAttribute('aria-label', 'คัดลอกแล้ว');
        setTimeout(function () {
          btn.classList.remove('is-copied');
          btn.setAttribute('aria-label', 'คัดลอก');
        }, 1200);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function () {
          window.prompt('คัดลอกเลขบัญชี:', text);
        });
      } else {
        window.prompt('คัดลอกเลขบัญชี:', text);
      }
    });

    var quickSuppressClick = false;

    renderQuickPromptButtons(QUICK_PROMPTS);

    (function bindQuickScrollDesktop(el) {
      var drag = { active: false, moved: false, startX: 0, startScroll: 0 };

      el.addEventListener('wheel', function (e) {
        if (el.scrollWidth <= el.clientWidth + 1) return;
        var delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (!delta) return;
        el.scrollLeft += delta;
        e.preventDefault();
      }, { passive: false });

      el.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        drag.active = true;
        drag.moved = false;
        drag.startX = e.clientX;
        drag.startScroll = el.scrollLeft;
      });

      window.addEventListener('mousemove', function (e) {
        if (!drag.active) return;
        var dx = e.clientX - drag.startX;
        if (!drag.moved && Math.abs(dx) < 8) return;
        drag.moved = true;
        el.classList.add('is-dragging');
        el.scrollLeft = drag.startScroll - dx;
      });

      window.addEventListener('mouseup', function () {
        if (!drag.active) return;
        if (drag.moved) quickSuppressClick = true;
        drag.active = false;
        drag.moved = false;
        el.classList.remove('is-dragging');
      });

      el.addEventListener('click', function (e) {
        if (!quickSuppressClick) return;
        e.preventDefault();
        e.stopPropagation();
        quickSuppressClick = false;
      }, true);
    })(quickScroll);

    fab.addEventListener('click', function () { setOpen(!open); });
    closeBtn.addEventListener('click', function () { setOpen(false); });

    input.addEventListener('input', function () {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      pingVisitorPresence({ typing: true, focused: true });
    });

    input.addEventListener('focus', function () {
      pingVisitorPresence({ typing: false, focused: true });
    });

    input.addEventListener('blur', function () {
      pingVisitorPresence({ typing: false, focused: false });
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form.requestSubmit();
      }
    });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (sending) return;
      const text = (input.value || '').trim();
      if (!text) return;

      appendMessage(messagesEl, 'user', text, { createdAtMs: Date.now() });
      history.push({ role: 'user', content: text, createdAtMs: Date.now() });
      saveHistory(history);
      input.value = '';
      input.style.height = 'auto';

      sending = true;
      sendBtn.disabled = true;
      const wasWaiting = statusBar && !statusBar.hidden;
      if (!wasWaiting) showRemoteTyping('ai');

      try {
        const res = await fetch(API_BASE, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Page-Url': window.location.href
          },
          body: JSON.stringify({
            message: text,
            history: history.slice(0, -1),
            conversationId: conversationId || undefined,
            pageUrl: window.location.href,
            contactStaff: !!(pendingContact && pendingContact.staffId && !contactHandoffSent),
            requestedStaffId:
              pendingContact && pendingContact.staffId && !contactHandoffSent
                ? pendingContact.staffId
                : undefined
          })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          clearRemoteTyping();
          if (wasWaiting || (data && data.waitingForStaff)) {
            setWaitingStatus(true);
            if (data && data.staffTyping) showRemoteTyping('staff');
            return;
          }
          throw new Error((data && data.message) || 'ส่งข้อความไม่สำเร็จ');
        }
        if (data.conversationId) {
          conversationId = data.conversationId;
          saveConversationId(conversationId);
          startPoll();
          syncImageButton(allowMemberImages);
        }
        if (data.waitingForStaff) {
          clearRemoteTyping();
          contactHandoffSent = true;
          setWaitingStatus(true);
          const handoffReply = String(data.reply || '').trim();
          if (handoffReply) {
            appendMessage(messagesEl, 'bot', handoffReply);
            history.push({ role: 'assistant', content: handoffReply });
            saveHistory(history);
          }
          if (pendingContact) {
            setContactBanner(pendingContact.canLiveChat ? 'waiting' : 'message');
          }
          if (data.staffTyping) showRemoteTyping('staff');
          pollStaffMessages();
          return;
        }
        if (pendingContact) pendingContact = null;
        resetContactUi();
        clearRemoteTyping();
        setWaitingStatus(false);
        pollStaffMessages();
        const reply = String(data.reply || '').trim();
        if (reply) {
          const meta = {};
          if (data.html) meta.html = data.html;
          if (data.downloads && data.downloads.length) meta.downloads = data.downloads;
          appendMessage(messagesEl, 'bot', reply, meta);
          const histItem = { role: 'assistant', content: reply };
          const savedMeta = historyMeta(meta);
          if (savedMeta) histItem.meta = savedMeta;
          history.push(histItem);
          saveHistory(history);
        }
      } catch (err) {
        clearRemoteTyping();
        if (statusBar && !statusBar.hidden) {
          /* keep waiting banner */
        } else {
          appendMessage(messagesEl, 'bot', (err && err.message) || 'เกิดข้อผิดพลาด กรุณาลองใหม่');
        }
      } finally {
        sending = false;
        sendBtn.disabled = false;
      }
    });

    if (!open && !history.length) {
      badge.classList.add('is-visible');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMemberChatWidget);
  } else {
    initMemberChatWidget();
  }
})();
