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
          '<form class="kb-chat-form" id="kbChatForm">' +
            '<textarea class="kb-chat-input" id="kbChatInput" rows="1" placeholder="พิมพ์คำถาม..." maxlength="2000"></textarea>' +
            '<button type="submit" class="kb-chat-send" id="kbChatSend" aria-label="ส่ง">' +
              '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg>' +
            '</button>' +
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

  function appendStaffPhoto(parent, meta) {
    const extras = meta && typeof meta === 'object' ? meta : {};
    const photo = document.createElement('div');
    photo.className = 'kb-chat-staff-reply-photo';
    const url = String(extras.authorPhotoUrl || '').trim();
    if (url) {
      const img = document.createElement('img');
      img.className = 'kb-chat-staff-reply-img';
      img.src = url;
      img.alt = '';
      img.loading = 'lazy';
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

  function appendMessage(container, role, text, meta) {
    const div = document.createElement('div');
    const isStaff = role === 'staff' || (meta && meta.authorType === 'staff');
    div.className = 'kb-chat-msg kb-chat-msg--' + (role === 'user' ? 'user' : (isStaff ? 'staff' : 'bot'));
    const extras = meta && typeof meta === 'object' ? meta : {};

    if (role === 'user') {
      div.textContent = text;
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
      const p = document.createElement('div');
      p.className = 'kb-chat-msg-text';
      p.innerHTML = renderBotText(text);
      body.appendChild(p);
      div.appendChild(body);
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

    let history = loadHistory();
    let conversationId = loadConversationId();
    let open = false;
    let sending = false;
    let greeted = history.length > 0;
    let pollTimer = null;
    let lastPollSince = 0;
    let seenStaffIds = new Set();
    const statusBar = document.getElementById('kbChatStatusBar');

    function setWaitingStatus(on) {
      if (!statusBar) return;
      if (on) {
        statusBar.hidden = false;
        statusBar.textContent = 'รอเจ้าหน้าที่ตอบ…';
      } else {
        statusBar.hidden = true;
      }
    }

    function rememberStaffMessage(m) {
      if (!m || !m.id || seenStaffIds.has(m.id)) return false;
      seenStaffIds.add(m.id);
      if (m.createdAtMs && m.createdAtMs > lastPollSince) lastPollSince = m.createdAtMs;
      appendMessage(messagesEl, 'staff', m.content || '', {
        authorType: 'staff',
        authorName: m.authorName || 'เจ้าหน้าที่',
        authorRoleLabel: m.authorRoleLabel || '',
        authorPhotoUrl: m.authorPhotoUrl || ''
      });
      history.push({
        id: m.id,
        role: 'staff',
        content: m.content || '',
        meta: {
          authorName: m.authorName,
          authorRoleLabel: m.authorRoleLabel,
          authorPhotoUrl: m.authorPhotoUrl,
          authorType: 'staff'
        }
      });
      saveHistory(history);
      if (!open) badge.classList.add('is-visible');
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
        if (data.waitingForStaff) setWaitingStatus(true);
        else setWaitingStatus(false);
        (data.messages || []).forEach(function (m) {
          rememberStaffMessage(m);
        });
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
      appendMessage(messagesEl, role, m.content, m.meta || null);
      if (m.role === 'staff' && m.id) seenStaffIds.add(m.id);
      if (m.role === 'staff' && m.createdAtMs && m.createdAtMs > lastPollSince) {
        lastPollSince = m.createdAtMs;
      }
    });
    if (history.length) greeted = true;
    if (conversationId) startPoll();

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

    QUICK_PROMPTS.forEach(function (label) {
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

      appendMessage(messagesEl, 'user', text);
      history.push({ role: 'user', content: text });
      saveHistory(history);
      input.value = '';
      input.style.height = 'auto';

      sending = true;
      sendBtn.disabled = true;
      const typingEl = appendMessage(messagesEl, 'bot', 'กำลังพิมพ์...');
      typingEl.classList.add('kb-chat-msg--typing');

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
            pageUrl: window.location.href
          })
        });
        const data = await res.json();
        typingEl.remove();
        if (!res.ok || !data.ok) {
          throw new Error((data && data.message) || 'ส่งข้อความไม่สำเร็จ');
        }
        if (data.conversationId) {
          conversationId = data.conversationId;
          saveConversationId(conversationId);
          startPoll();
        }
        if (data.waitingForStaff) setWaitingStatus(true);
        else setWaitingStatus(false);
        pollStaffMessages();
        const reply = String(data.reply || '').trim() || 'ขออภัยค่ะ ตอบไม่ทัน ลองใหม่อีกครั้งนะคะ';
        const meta = {};
        if (data.html) meta.html = data.html;
        if (data.downloads && data.downloads.length) meta.downloads = data.downloads;
        appendMessage(messagesEl, 'bot', reply, meta);
        const histItem = { role: 'assistant', content: reply };
        const savedMeta = historyMeta(meta);
        if (savedMeta) histItem.meta = savedMeta;
        history.push(histItem);
        saveHistory(history);
      } catch (err) {
        typingEl.remove();
        appendMessage(messagesEl, 'bot', (err && err.message) || 'เกิดข้อผิดพลาด กรุณาลองใหม่');
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
