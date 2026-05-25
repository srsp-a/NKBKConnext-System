(function () {
  'use strict';

  const STORAGE_KEY = 'nkbk_cms_chat_history';
  const QUICK_COLLAPSED_KEY = 'nkbk_cms_quick_collapsed';
  const API_BASE = '/api/public-cms-chat';

  const QUICK_PROMPTS = [
    'เวลาทำการสหกรณ์',
    'วันหยุดมีวันไหนบ้าง',
    'ช่องทางติดต่อสหกรณ์',
    'ขั้นตอนสมัครสมาชิก',
    'แจ้งโอนเงินทำอย่างไร'
  ];

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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

  function renderWidget(root, cfg) {
    root.innerHTML =
      '<button type="button" class="kb-chat-fab" id="kbChatFab" aria-label="แชทกับโมเน่">' +
        '<span class="kb-chat-fab-badge" id="kbChatFabBadge">1</span>' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">' +
          '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>' +
        '</svg>' +
      '</button>' +
      '<div class="kb-chat-panel" id="kbChatPanel" role="dialog" aria-label="แชทกับโมเน่">' +
        '<div class="kb-chat-head">' +
          '<div class="kb-chat-avatar" aria-hidden="true">🌸</div>' +
          '<div class="kb-chat-head-text">' +
            '<div class="kb-chat-head-title">น้อง' + esc(cfg.name || 'โมเน่') + '</div>' +
            '<div class="kb-chat-head-sub">ผู้ช่วยบริการสมาชิก · ไม่ต้องผูกบัญชี</div>' +
          '</div>' +
          '<button type="button" class="kb-chat-close" id="kbChatClose" aria-label="ปิดแชท">&times;</button>' +
        '</div>' +
        '<div class="kb-chat-messages" id="kbChatMessages"></div>' +
        '<div class="kb-chat-quick" id="kbChatQuick">' +
          '<button type="button" class="kb-chat-quick-toggle" id="kbChatQuickToggle" aria-expanded="true" aria-controls="kbChatQuickInner">' +
            '<span class="kb-chat-quick-toggle-label">คำถามด่วน</span>' +
            '<svg class="kb-chat-quick-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
              '<path d="M6 9l6 6 6-6"/>' +
            '</svg>' +
          '</button>' +
          '<div class="kb-chat-quick-inner" id="kbChatQuickInner"></div>' +
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

  function appendMessage(container, role, text) {
    const div = document.createElement('div');
    div.className = 'kb-chat-msg kb-chat-msg--' + (role === 'user' ? 'user' : 'bot');
    div.textContent = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
  }

  async function initMemberChatWidget() {
    if (window.__kbMemberChatReady) return;
    const root = document.getElementById('kb-member-chat-root');
    if (!root) return;

    let cfg = { enabled: false, name: 'โมเน่', greeting: 'สวัสดีค่ะ มีอะไรให้ช่วยไหมคะ?' };
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
    const quickEl = document.getElementById('kbChatQuick');
    const quickToggle = document.getElementById('kbChatQuickToggle');
    const quickInner = document.getElementById('kbChatQuickInner');
    const form = document.getElementById('kbChatForm');
    const input = document.getElementById('kbChatInput');
    const sendBtn = document.getElementById('kbChatSend');
    const badge = document.getElementById('kbChatFabBadge');

    let history = loadHistory();
    let open = false;
    let sending = false;
    let greeted = history.length > 0;

    function setOpen(next) {
      open = !!next;
      panel.classList.toggle('is-open', open);
      if (open) {
        badge.classList.remove('is-visible');
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
      appendMessage(messagesEl, m.role === 'user' ? 'user' : 'bot', m.content);
    });
    if (history.length) greeted = true;

    function readQuickCollapsed() {
      try {
        return sessionStorage.getItem(QUICK_COLLAPSED_KEY) === '1';
      } catch (e) {
        return false;
      }
    }

    function writeQuickCollapsed(collapsed) {
      try {
        sessionStorage.setItem(QUICK_COLLAPSED_KEY, collapsed ? '1' : '0');
      } catch (e) {}
    }

    function setQuickCollapsed(collapsed) {
      quickEl.classList.toggle('is-collapsed', collapsed);
      quickToggle.setAttribute('aria-expanded', String(!collapsed));
    }

    setQuickCollapsed(readQuickCollapsed());

    QUICK_PROMPTS.forEach(function (label) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'kb-chat-quick-btn';
      btn.textContent = label;
      btn.addEventListener('click', function () {
        input.value = label;
        form.requestSubmit();
      });
      quickInner.appendChild(btn);
    });

    quickToggle.addEventListener('click', function () {
      const next = !quickEl.classList.contains('is-collapsed');
      setQuickCollapsed(next);
      writeQuickCollapsed(next);
    });

    fab.addEventListener('click', function () { setOpen(!open); });
    closeBtn.addEventListener('click', function () { setOpen(false); });

    input.addEventListener('input', function () {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
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
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            history: history.slice(0, -1)
          })
        });
        const data = await res.json();
        typingEl.remove();
        if (!res.ok || !data.ok) {
          throw new Error((data && data.message) || 'ส่งข้อความไม่สำเร็จ');
        }
        const reply = String(data.reply || '').trim() || 'ขออภัยค่ะ ตอบไม่ทัน ลองใหม่อีกครั้งนะคะ';
        appendMessage(messagesEl, 'bot', reply);
        history.push({ role: 'assistant', content: reply });
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
