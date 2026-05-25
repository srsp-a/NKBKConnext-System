(function () {
  'use strict';

  const el = (id) => document.getElementById(id);
  const HELP_SUPPORT_EMAIL = 'support@nkbkcoop.com';
  const HELP_SUPPORT_PHONE = '042-420750 กด 6 (งาน IT)';

  function closeSubmenu() {
    el('sidebarProfileHelpMenu')?.classList.add('hidden');
    el('sidebarProfileHelpBtn')?.setAttribute('aria-expanded', 'false');
  }

  function toggleSubmenu(anchor) {
    const menu = el('sidebarProfileHelpMenu');
    if (!menu) return;
    const willOpen = menu.classList.contains('hidden');
    closeSubmenu();
    if (willOpen) {
      menu.classList.remove('hidden');
      (anchor || el('sidebarProfileHelpBtn'))?.setAttribute('aria-expanded', 'true');
    }
  }

  function setActivePanel(panelId) {
    const id = String(panelId || 'guide');
    document.querySelectorAll('[data-help-nav]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute('data-help-nav') === id);
    });
    document.querySelectorAll('[data-help-panel]').forEach((panel) => {
      panel.classList.toggle('hidden', panel.getAttribute('data-help-panel') !== id);
    });
    const title = document.querySelector('[data-help-nav="' + id + '"] span');
    const head = el('nkbkAiHelpPanelTitle');
    if (head && title) head.textContent = title.textContent;
  }

  function open(panelId) {
    closeSubmenu();
    const modal = el('nkbkAiHelpModal');
    if (!modal) return;
    setActivePanel(panelId || 'guide');
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('open');
  }

  function close() {
    const modal = el('nkbkAiHelpModal');
    if (!modal) return;
    modal.setAttribute('aria-hidden', 'true');
    modal.classList.remove('open');
  }

  function bindHelpNav() {
    document.querySelectorAll('[data-help-nav]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setActivePanel(btn.getAttribute('data-help-nav'));
      });
    });
  }

  function bindSubmenu() {
    const submenu = el('sidebarProfileHelpMenu');
    if (!submenu || submenu.dataset.bound) return;
    submenu.dataset.bound = '1';
    submenu.addEventListener('click', (e) => {
      e.stopPropagation();
      const btn = e.target.closest('[data-help-open]');
      if (!btn) return;
      open(btn.getAttribute('data-help-open'));
      el('sidebarProfileMenu')?.classList.add('hidden');
      el('btnProfileMenu')?.setAttribute('aria-expanded', 'false');
      closeSubmenu();
    });
  }

  function bindModal() {
    el('nkbkAiHelpClose')?.addEventListener('click', close);
    el('nkbkAiHelpBackdrop')?.addEventListener('click', close);
    el('nkbkAiHelpReportBtn')?.addEventListener('click', () => {
      const subject = encodeURIComponent('แจ้งปัญหา ChatMONE');
      const body = encodeURIComponent(
        'รายละเอียดปัญหา:\n\n\nขั้นตอนที่ทำ:\n1.\n2.\n\nอุปกรณ์/เบราว์เซอร์:\n'
      );
      window.location.href =
        'mailto:' + HELP_SUPPORT_EMAIL + '?subject=' + subject + '&body=' + body;
    });
  }

  bindHelpNav();
  bindSubmenu();
  bindModal();

  window.NkbkAiHelp = {
    open,
    close,
    toggleSubmenu,
    closeSubmenu,
    supportEmail: HELP_SUPPORT_EMAIL,
    supportPhone: HELP_SUPPORT_PHONE
  };
})();
