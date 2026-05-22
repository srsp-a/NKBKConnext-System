(function () {
  'use strict';

  const el = (id) => document.getElementById(id);
  let savedPrompts = [];
  let promptQuery = '';
  let draftTitle = '';
  let draftText = '';
  let pickerOpen = false;
  let pendingSuggestion = null;
  let suggestDismissed = new Set();
  let editingPromptId = null;

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

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtDate(ts) {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleDateString('th-TH', { dateStyle: 'medium' });
    } catch (_) {
      return '';
    }
  }

  async function apiPrompt(body) {
    const r = await fetch('/api/nkbk-ai-prompt', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body || {})
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) throw new Error(data.message || 'ดำเนินการไม่สำเร็จ');
    return data;
  }

  async function apiSavePrompts(list) {
    const r = await fetch('/api/nkbk-ai-settings', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ savedPrompts: list })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) throw new Error(data.message || 'บันทึกไม่สำเร็จ');
    return data;
  }

  function setSavedPrompts(list) {
    savedPrompts = Array.isArray(list) ? list.slice() : [];
    window.__nkbkAiSavedPrompts = savedPrompts;
  }

  function normalizePromptKey(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function isSavedPromptText(text) {
    const key = normalizePromptKey(text);
    if (!key) return false;
    return savedPrompts.some((p) => normalizePromptKey(p.text) === key);
  }

  function getProfileUsername() {
    try {
      const profile = JSON.parse(sessionStorage.getItem('nkbk_ai_profile') || '{}');
      return String(profile.username || '').trim();
    } catch (_) {
      return '';
    }
  }

  function previewImageSrc(p) {
    const img = p && p.previewImage;
    if (!img) return '';
    if (img.publicUrl) return img.publicUrl;
    if (img.imageId) {
      const u = getProfileUsername();
      const t = token();
      if (!u) return '';
      const base = '/api/nkbk-ai-image/' + encodeURIComponent(u) + '/' + encodeURIComponent(img.imageId);
      return t ? base + '?token=' + encodeURIComponent(t) : base;
    }
    return '';
  }

  function promptVisualHtml(p) {
    const src = previewImageSrc(p);
    if (src) {
      return (
        '<button type="button" class="nkbk-ai-prompt-card-thumb" data-prompt-preview="' +
        esc(p.id) +
        '" title="ดูภาพตัวอย่าง" aria-label="ดูภาพตัวอย่าง">' +
        '<img src="' +
        esc(src) +
        '" alt="" loading="lazy">' +
        '</button>'
      );
    }
    return (
      '<div class="nkbk-ai-prompt-card-icon" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
      '</div>'
    );
  }

  function resetPromptEditForm() {
    editingPromptId = null;
    draftTitle = '';
    draftText = '';
    if (el('settingsPromptTitle')) el('settingsPromptTitle').value = '';
    if (el('settingsPromptText')) el('settingsPromptText').value = '';
    if (el('settingsPromptAddBtn')) el('settingsPromptAddBtn').textContent = 'เพิ่มพรอมต์';
    if (el('settingsPromptCancelBtn')) el('settingsPromptCancelBtn').classList.add('hidden');
    el('settingsPromptsList')?.querySelectorAll('.nkbk-ai-prompt-card').forEach((c) => c.classList.remove('is-editing'));
  }

  function closeSettingsModal() {
    const modal = el('nkbkAiSettingsModal');
    if (!modal) return;
    modal.setAttribute('aria-hidden', 'true');
    modal.classList.remove('open');
  }

  async function usePromptInNewChat(text) {
    closeSettingsModal();
    closePromptPicker();
    if (window.NkbkAiChat && window.NkbkAiChat.startNewChatWithPrompt) {
      await window.NkbkAiChat.startNewChatWithPrompt(text);
      return;
    }
    applyPromptToComposer(text);
  }

  function openPreviewImage(src) {
    if (!src) return;
    if (window.NkbkAiChat && window.NkbkAiChat.openLightbox) {
      window.NkbkAiChat.openLightbox(src);
      return;
    }
    window.open(src, '_blank', 'noopener');
  }

  function filteredPrompts() {
    const q = String(promptQuery || '')
      .trim()
      .toLowerCase();
    if (!q) return savedPrompts;
    return savedPrompts.filter(
      (p) =>
        String(p.title || '')
          .toLowerCase()
          .includes(q) ||
        String(p.text || '')
          .toLowerCase()
          .includes(q)
    );
  }

  function renderSettingsPrompts(data) {
    setSavedPrompts(data && data.savedPrompts);
    const listEl = el('settingsPromptsList');
    if (!listEl) return;

    const items = filteredPrompts();
    if (!items.length) {
      listEl.innerHTML =
        '<div class="nkbk-ai-prompts-empty">' +
        '<span class="nkbk-ai-prompts-empty-icon" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
        '</span>' +
        '<p class="nkbk-ai-prompts-empty-title">ยังไม่มีพรอมต์ที่บันทึก</p>' +
        '<p class="nkbk-ai-prompts-empty-desc">เพิ่มพรอมต์ด้านบน หรือบันทึกจากข้อความที่ใช้บ่อยในแชท</p>' +
        '</div>';
      return;
    }

    listEl.innerHTML = items
      .map(
        (p) =>
          '<article class="nkbk-ai-prompt-card" data-prompt-id="' +
          esc(p.id) +
          '">' +
          '<div class="nkbk-ai-prompt-card-head">' +
          promptVisualHtml(p) +
          '<div class="nkbk-ai-prompt-card-main">' +
          '<h4 class="nkbk-ai-prompt-card-title">' +
          esc(p.title || 'พรอมต์') +
          '</h4>' +
          '<p class="nkbk-ai-prompt-card-preview">' +
          esc(p.text) +
          '</p>' +
          '<div class="nkbk-ai-prompt-card-meta">' +
          '<span>' +
          esc(window.__nkbkAiDisplayName || 'โมเน่') +
          'ตอบแล้ว ' +
          esc(String(p.useCount || 0)) +
          ' ครั้ง</span>' +
          (p.updatedAt ? '<span> · ' + esc(fmtDate(p.updatedAt)) + '</span>' : '') +
          '</div></div>' +
          '<div class="nkbk-ai-prompt-card-actions">' +
          '<button type="button" class="nkbk-ai-prompt-card-btn" data-prompt-use="' +
          esc(p.id) +
          '" title="เริ่มแชตใหม่">ใช้</button>' +
          '<button type="button" class="nkbk-ai-prompt-card-btn nkbk-ai-prompt-card-btn--ghost" data-prompt-edit="' +
          esc(p.id) +
          '" title="แก้ไข">แก้ไข</button>' +
          '<button type="button" class="nkbk-ai-prompt-card-btn nkbk-ai-prompt-card-btn--danger" data-prompt-del="' +
          esc(p.id) +
          '" title="ลบ">ลบ</button>' +
          '</div></div></article>'
      )
      .join('');

    listEl.querySelectorAll('[data-prompt-use]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = savedPrompts.find((x) => x.id === btn.getAttribute('data-prompt-use'));
        if (p) void usePromptInNewChat(p.text);
      });
    });
    listEl.querySelectorAll('[data-prompt-preview]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const p = savedPrompts.find((x) => x.id === btn.getAttribute('data-prompt-preview'));
        if (p) openPreviewImage(previewImageSrc(p));
      });
    });
    listEl.querySelectorAll('[data-prompt-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = savedPrompts.find((x) => x.id === btn.getAttribute('data-prompt-edit'));
        if (!p) return;
        draftTitle = p.title || '';
        draftText = p.text || '';
        editingPromptId = p.id;
        if (el('settingsPromptTitle')) el('settingsPromptTitle').value = draftTitle;
        if (el('settingsPromptText')) el('settingsPromptText').value = draftText;
        if (el('settingsPromptAddBtn')) el('settingsPromptAddBtn').textContent = 'บันทึกการแก้ไข';
        if (el('settingsPromptCancelBtn')) el('settingsPromptCancelBtn').classList.remove('hidden');
        el('settingsPromptText')?.focus();
        listEl.querySelectorAll('.nkbk-ai-prompt-card').forEach((c) => c.classList.remove('is-editing'));
        const card = listEl.querySelector('[data-prompt-id="' + p.id + '"]');
        if (card) card.classList.add('is-editing');
      });
    });
    listEl.querySelectorAll('[data-prompt-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-prompt-del');
        if (!id || !confirm('ลบพรอมต์นี้?')) return;
        btn.disabled = true;
        try {
          const next = savedPrompts.filter((x) => x.id !== id);
          const data = await apiSavePrompts(next);
          setSavedPrompts(data.savedPrompts);
          renderSettingsPrompts(data);
          renderPickerList();
        } catch (e) {
          alert(e.message || 'ลบไม่สำเร็จ');
          btn.disabled = false;
        }
      });
    });
  }

  function renderPickerList() {
    const listEl = el('nkbkAiPromptPickerList');
    if (!listEl) return;
    const q = String(el('nkbkAiPromptPickerSearch')?.value || '')
      .trim()
      .toLowerCase();
    const items = savedPrompts.filter(
      (p) =>
        !q ||
        String(p.title || '')
          .toLowerCase()
          .includes(q) ||
        String(p.text || '')
          .toLowerCase()
          .includes(q)
    );
    if (!items.length) {
      listEl.innerHTML =
        '<div class="nkbk-ai-prompt-picker-empty">' +
        (savedPrompts.length ? 'ไม่พบพรอมต์ที่ค้นหา' : 'ยังไม่มีพรอมต์ — เพิ่มได้ที่ ตั้งค่า › ตั้งค่าพรอมต์') +
        '</div>';
      return;
    }
    listEl.innerHTML = items
      .map(
        (p) =>
          '<button type="button" class="nkbk-ai-prompt-picker-item" data-pick-prompt="' +
          esc(p.id) +
          '">' +
          '<span class="nkbk-ai-prompt-picker-item-title">' +
          esc(p.title || 'พรอมต์') +
          '</span>' +
          '<span class="nkbk-ai-prompt-picker-item-preview">' +
          esc(p.text) +
          '</span></button>'
      )
      .join('');
    listEl.querySelectorAll('[data-pick-prompt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = savedPrompts.find((x) => x.id === btn.getAttribute('data-pick-prompt'));
        if (p) applyPromptToComposer(p.text);
        closePromptPicker();
      });
    });
  }

  function applyPromptToComposer(text) {
    const input = el('nkbkAiInput');
    if (!input) return;
    input.value = String(text || '').trim();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    window.dispatchEvent(new CustomEvent('nkbk-ai-composer-changed'));
  }

  function openPromptPicker() {
    const pop = el('nkbkAiPromptPicker');
    if (!pop) return;
    pickerOpen = true;
    pop.classList.remove('hidden');
    pop.classList.add('open');
    pop.setAttribute('aria-hidden', 'false');
    renderPickerList();
    el('nkbkAiPromptPickerSearch')?.focus();
  }

  function closePromptPicker() {
    const pop = el('nkbkAiPromptPicker');
    if (!pop) return;
    pickerOpen = false;
    pop.classList.add('hidden');
    pop.classList.remove('open');
    pop.setAttribute('aria-hidden', 'true');
    if (el('nkbkAiPromptPickerSearch')) el('nkbkAiPromptPickerSearch').value = '';
  }

  function hidePromptSuggestion() {
    pendingSuggestion = null;
    const box = el('nkbkAiPromptSuggest');
    if (box) {
      box.classList.add('hidden');
      box.setAttribute('aria-hidden', 'true');
    }
  }

  function showPromptSuggestion(payload) {
    if (!payload || !payload.text || !payload.shouldSuggest) return;
    const key = String(payload.fingerprint || payload.text).slice(0, 120);
    if (suggestDismissed.has(key)) return;
    pendingSuggestion = payload;
    const box = el('nkbkAiPromptSuggest');
    const preview = el('nkbkAiPromptSuggestPreview');
    const countEl = el('nkbkAiPromptSuggestCount');
    if (!box || !preview) return;
    preview.textContent = payload.titleSuggestion || payload.text.slice(0, 80);
    if (countEl) countEl.textContent = 'ใช้แล้ว ' + String(payload.count || 5) + ' ครั้ง';
    box.classList.remove('hidden');
    box.setAttribute('aria-hidden', 'false');
  }

  async function trackPromptText(text) {
    const norm = normalizePromptKey(text);
    if (norm.length < 10 || !token() || isSavedPromptText(norm)) return null;
    try {
      const data = await apiPrompt({ action: 'track', text: norm });
      if (data.savedPrompts) setSavedPrompts(data.savedPrompts);
      if (data.shouldSuggest) showPromptSuggestion(data);
      return data;
    } catch (_) {
      return null;
    }
  }

  async function recordPromptCompletion(text, opts) {
    const norm = normalizePromptKey(text);
    if (norm.length < 10 || !token() || !isSavedPromptText(norm)) return null;
    const images = (opts && opts.images) || [];
    const payload = {
      action: 'complete',
      text: norm,
      generated: !!(opts && opts.generated),
      images: images.map((img) => ({
        imageId: img.imageId || '',
        publicUrl: img.publicUrl || img.url || '',
        mime: img.mime || 'image/png'
      }))
    };
    try {
      const data = await apiPrompt(payload);
      if (data.savedPrompts) {
        setSavedPrompts(data.savedPrompts);
        renderPickerList();
        if (el('settingsPromptsList')) renderSettingsPrompts({ savedPrompts: data.savedPrompts });
      }
      return data;
    } catch (_) {
      return null;
    }
  }

  async function savePendingSuggestion() {
    if (!pendingSuggestion) return;
    const text = pendingSuggestion.text;
    const title = pendingSuggestion.titleSuggestion;
    try {
      const data = await apiPrompt({ action: 'save', text, title });
      if (data.savedPrompts) setSavedPrompts(data.savedPrompts);
      hidePromptSuggestion();
      renderPickerList();
      if (window.NkbkAiSettings && window.NkbkAiSettings.renderPrompts) {
        window.NkbkAiSettings.renderPrompts({ savedPrompts: data.savedPrompts });
      }
    } catch (e) {
      alert(e.message || 'บันทึกไม่สำเร็จ');
    }
  }

  async function dismissPendingSuggestion() {
    if (!pendingSuggestion) return;
    const key = String(pendingSuggestion.fingerprint || pendingSuggestion.text).slice(0, 120);
    suggestDismissed.add(key);
    try {
      await apiPrompt({ action: 'dismiss', text: pendingSuggestion.text });
    } catch (_) {}
    hidePromptSuggestion();
  }

  function bindHandlers() {
    if (document.body.dataset.promptsBound) return;
    document.body.dataset.promptsBound = '1';

    el('nkbkAiPromptPickerClose')?.addEventListener('click', closePromptPicker);
    el('nkbkAiPromptPickerSettings')?.addEventListener('click', () => {
      closePromptPicker();
      if (window.NkbkAiSettings) window.NkbkAiSettings.open('prompts');
    });
    el('nkbkAiPromptPickerSearch')?.addEventListener('input', renderPickerList);

    el('nkbkAiPromptSuggestSave')?.addEventListener('click', () => void savePendingSuggestion());
    el('nkbkAiPromptSuggestDismiss')?.addEventListener('click', () => void dismissPendingSuggestion());

    el('settingsPromptSearch')?.addEventListener('input', () => {
      promptQuery = el('settingsPromptSearch')?.value || '';
      renderSettingsPrompts({ savedPrompts });
    });

    el('settingsPromptCancelBtn')?.addEventListener('click', () => resetPromptEditForm());

    el('settingsPromptAddBtn')?.addEventListener('click', async () => {
      const title = String(el('settingsPromptTitle')?.value || '').trim();
      const text = String(el('settingsPromptText')?.value || '').trim();
      if (text.length < 10) {
        alert('กรุณาใส่พรอมต์อย่างน้อย 10 ตัวอักษร');
        return;
      }
      const btn = el('settingsPromptAddBtn');
      if (btn) {
        btn.disabled = true;
        btn.classList.add('is-saving');
      }
      try {
        let data;
        if (editingPromptId) {
          const now = Date.now();
          const next = savedPrompts.map((p) =>
            p.id === editingPromptId
              ? {
                  ...p,
                  title: title || p.title,
                  text,
                  updatedAt: now
                }
              : p
          );
          data = await apiSavePrompts(next);
        } else {
          data = await apiPrompt({
            action: 'save',
            text,
            title: title || undefined
          });
        }
        if (data.savedPrompts) setSavedPrompts(data.savedPrompts);
        resetPromptEditForm();
        renderSettingsPrompts({ savedPrompts: data.savedPrompts });
        renderPickerList();
      } catch (e) {
        alert(e.message || 'บันทึกไม่สำเร็จ');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.classList.remove('is-saving');
        }
      }
    });

    document.addEventListener('click', (e) => {
      const pop = el('nkbkAiPromptPicker');
      if (!pickerOpen || !pop) return;
      if (pop.contains(e.target) || e.target.closest('#nkbkAiComposerMenu')) return;
      closePromptPicker();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && pickerOpen) closePromptPicker();
    });
  }

  function initFromSettings(data) {
    setSavedPrompts(data && data.savedPrompts);
    renderSettingsPrompts(data || { savedPrompts });
    renderPickerList();
  }

  bindHandlers();

  window.NkbkAiPrompts = {
    renderSettings: renderSettingsPrompts,
    initFromSettings,
    track: trackPromptText,
    recordCompletion: recordPromptCompletion,
    apply: applyPromptToComposer,
    getSavedPrompts: () => savedPrompts.slice(),
    openPicker: openPromptPicker,
    closePicker: closePromptPicker
  };
})();
