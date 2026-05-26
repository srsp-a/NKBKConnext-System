/** FAQ / Terms / Privacy (PDPA) — หน้ากฎหมายและช่วยเหลือ */
const CMS_FAQ_PAGE_ID = '294';
const CMS_TERMS_PAGE_ID = '525';
const CMS_PRIVACY_PAGE_ID = '3';

function escapeLegalHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function legalLang() {
  return window.CmsI18n?.getLang() || 'th';
}

function legalT(key) {
  return window.CmsI18n ? CmsI18n.t(`legal.${key}`) : key;
}

function legalPack(type) {
  const root = window.CMS_LEGAL_CONTENT?.[type] || {};
  const lang = legalLang();
  return root[lang] || root.th || {};
}

function legalIcon(name) {
  return window.KbIcon ? KbIcon.wrap(name, '', 20) : '';
}

function renderLegalCta() {
  return `
<div class="kb-legal-cta">
  <p class="kb-legal-cta-text">${escapeLegalHtml(legalT('ctaText'))}</p>
  <div class="kb-legal-cta-actions">
    <a href="/contact" class="kb-btn kb-btn-primary">${escapeLegalHtml(legalT('ctaContact'))}</a>
    <a href="tel:042420750" class="kb-btn kb-btn-outline">${escapeLegalHtml(legalT('ctaPhone'))}</a>
  </div>
</div>`;
}

function renderFaqPage() {
  const pack = legalPack('faq');
  const cats = pack.categories || [];
  let idx = 0;
  const navItems = cats
    .map(
      (c) =>
        `<a href="#kb-faq-${escapeLegalHtml(c.id)}" class="kb-legal-toc-link">${escapeLegalHtml(c.label)}</a>`
    )
    .join('');

  const sections = cats
    .map((cat) => {
      const items = (cat.items || [])
        .map((item) => {
          idx += 1;
          const id = `kb-faq-item-${idx}`;
          return `
<details class="kb-faq-item" id="${id}">
  <summary class="kb-faq-q">
    <span class="kb-faq-q-num">${idx}</span>
    <span class="kb-faq-q-text">${escapeLegalHtml(item.q)}</span>
    <span class="kb-faq-chevron" aria-hidden="true"></span>
  </summary>
  <div class="kb-faq-a kb-legal-prose">${item.a}</div>
</details>`;
        })
        .join('');
      return `
<section class="kb-faq-group" id="kb-faq-${escapeLegalHtml(cat.id)}">
  <h2 class="kb-faq-group-title">${escapeLegalHtml(cat.label)}</h2>
  <div class="kb-faq-list">${items}</div>
</section>`;
    })
    .join('');

  return `
<div class="kb-page-body kb-page-body--legal kb-page-body--faq">
  <div class="kb-container kb-legal-wrap">
    <div class="kb-legal-layout">
      <aside class="kb-legal-sidebar" aria-label="${escapeLegalHtml(legalT('tocLabel'))}">
        <div class="kb-legal-sidebar-card">
          <h2 class="kb-legal-sidebar-title">${escapeLegalHtml(legalT('faqTopics'))}</h2>
          <nav class="kb-legal-toc">${navItems}</nav>
        </div>
      </aside>
      <div class="kb-legal-main">
        <p class="kb-legal-intro">${escapeLegalHtml(pack.intro || '')}</p>
        <div class="kb-faq-search-wrap">
          <label class="kb-faq-search-label" for="kb-faq-search">${escapeLegalHtml(legalT('searchLabel'))}</label>
          <input type="search" id="kb-faq-search" class="kb-faq-search" placeholder="${escapeLegalHtml(legalT('searchPlaceholder'))}" autocomplete="off">
        </div>
        ${sections}
        ${renderLegalCta()}
      </div>
    </div>
  </div>
</div>`;
}

function renderDocPage(type) {
  const pack = legalPack(type);
  const sections = pack.sections || [];
  const toc = sections
    .map(
      (s, i) =>
        `<a href="#kb-legal-sec-${i}" class="kb-legal-toc-link">${escapeLegalHtml(s.title)}</a>`
    )
    .join('');
  const body = sections
    .map(
      (s, i) => `
<section class="kb-legal-section" id="kb-legal-sec-${i}">
  <h2 class="kb-legal-section-title">${escapeLegalHtml(s.title)}</h2>
  <div class="kb-legal-prose">${s.body}</div>
</section>`
    )
    .join('');

  const updated =
    pack.updated &&
    `<p class="kb-legal-updated"><span>${escapeLegalHtml(legalT('updatedLabel'))}</span> ${escapeLegalHtml(pack.updated)}</p>`;

  return `
<div class="kb-page-body kb-page-body--legal kb-page-body--${type}">
  <div class="kb-container kb-legal-wrap">
    <div class="kb-legal-layout">
      <aside class="kb-legal-sidebar" aria-label="${escapeLegalHtml(legalT('tocLabel'))}">
        <div class="kb-legal-sidebar-card">
          <h2 class="kb-legal-sidebar-title">${escapeLegalHtml(legalT('tocLabel'))}</h2>
          <nav class="kb-legal-toc">${toc}</nav>
        </div>
      </aside>
      <div class="kb-legal-main kb-legal-doc">
        <p class="kb-legal-intro">${escapeLegalHtml(pack.intro || '')}</p>
        ${updated || ''}
        ${body}
        ${renderLegalCta()}
      </div>
    </div>
  </div>
</div>`;
}

function renderTermsPage() {
  return renderDocPage('terms');
}

function renderPrivacyPage() {
  return renderDocPage('privacy');
}

function bindLegalTocScroll(root) {
  window.CmsLayout?.bindHeaderAwareAnchors?.(root);
}

function bindFaqSearch(root) {
  const input = root?.querySelector('#kb-faq-search');
  if (!input) return;
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    root.querySelectorAll('.kb-faq-item').forEach((el) => {
      const text = el.textContent.toLowerCase();
      const show = !q || text.includes(q);
      el.classList.toggle('is-hidden', !show);
      if (show && q) el.open = true;
    });
    root.querySelectorAll('.kb-faq-group').forEach((g) => {
      const any = g.querySelector('.kb-faq-item:not(.is-hidden)');
      g.classList.toggle('is-hidden', !any);
    });
  });
}

function rerenderLegalPage() {
  const main = document.getElementById('cms-page-content');
  const type = window._kbLegalPageType;
  if (!main || !type) return;
  if (type === 'faq') main.innerHTML = renderFaqPage();
  else if (type === 'terms') main.innerHTML = renderTermsPage();
  else if (type === 'privacy') main.innerHTML = renderPrivacyPage();
  bindFaqSearch(main);
  const titleEl = document.getElementById('cms-page-title');
  if (titleEl && window.CmsLayout) {
    const titleKey =
      type === 'faq' ? 'faqTitle' : type === 'terms' ? 'termsTitle' : 'privacyTitle';
    const subKey =
      type === 'faq' ? 'faqSubtitle' : type === 'terms' ? 'termsSubtitle' : 'privacySubtitle';
    CmsLayout.setPageTitle(legalT(titleKey), legalT(subKey));
  }
  window.CmsI18n?.applyTranslations();
  window.CmsLayout?.refreshFooterLocale?.();
  bindLegalTocScroll(main);
}

function bindLegalPage(root, type) {
  if (!root) return;
  window._kbLegalPageType = type;
  bindFaqSearch(root);
  bindLegalTocScroll(root);
  if (!window._kbLegalLangInit) {
    window._kbLegalLangInit = true;
    window.addEventListener('cms:langchange', rerenderLegalPage);
  }
}

window.CmsLegalPage = {
  CMS_FAQ_PAGE_ID,
  CMS_TERMS_PAGE_ID,
  CMS_PRIVACY_PAGE_ID,
  renderFaqPage,
  renderTermsPage,
  renderPrivacyPage,
  bindLegalPage
};
