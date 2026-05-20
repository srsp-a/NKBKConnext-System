(function () {
  const STORAGE_KEY = 'cms_lang';
  let lang = localStorage.getItem(STORAGE_KEY) || 'th';

  function getLang() {
    return lang;
  }

  function setLang(next) {
    lang = next === 'en' ? 'en' : 'th';
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang;
    applyTranslations();
    document.querySelectorAll('.kb-lang-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.lang === lang);
    });
    window.dispatchEvent(new CustomEvent('cms:langchange', { detail: { lang } }));
  }

  function t(key) {
    const dict = window.CMS_SITE?.i18n?.[lang] || {};
    const val = key.split('.').reduce((o, k) => (o && o[k] != null ? o[k] : undefined), dict);
    return val != null ? val : key;
  }

  function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const val = t(el.getAttribute('data-i18n'));
      if (el.hasAttribute('data-i18n-html')) el.innerHTML = val;
      else el.textContent = val;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.title = t(el.getAttribute('data-i18n-title'));
    });
  }

  function initLangToggle(root) {
    if (!root) return;
    root.querySelectorAll('.kb-lang-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.lang === lang);
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        setLang(btn.dataset.lang);
      });
    });
  }

  document.documentElement.lang = lang;

  window.CmsI18n = { getLang, setLang, t, applyTranslations, initLangToggle };
})();
