(function () {
  const cfg = () => window.CMS_SITE || {};

  function legacyUrl(path) {
    const base = (cfg().wpLegacy || 'https://nkbkcoop.com').replace(/\/$/, '');
    const p = path.startsWith('/') ? path : `/${path}`;
    return base + p;
  }

  function pageUrl(id) {
    return `/page/${id}`;
  }

  function menuUrl(wpPath) {
    const pages = cfg().cmsPages || {};
    const p = wpPath.startsWith('/') ? wpPath : `/${wpPath}`;
    const withSlash = p.endsWith('/') ? p : `${p}/`;
    if (withSlash === '/download/' || p === '/download') return '/download';
    if (withSlash === '/about-us/' || p === '/about-us') return '/about-us';
    if (withSlash === '/team/' || p === '/team') return '/team';
    if (withSlash === '/management/' || p === '/management') return '/management';
    if (withSlash === '/contact/' || p === '/contact') return '/contact';
    if (withSlash === '/infrom-payment/' || p === '/infrom-payment') return '/infrom-payment';
    if (withSlash === '/infrom-payment-line/' || p === '/infrom-payment-line') return '/infrom-payment-line';
    if (withSlash === '/app/' || p === '/app') return '/app';
    if (withSlash === '/faq/' || p === '/faq') return '/faq';
    if (withSlash === '/terms/' || p === '/terms' || withSlash === '/terms-conditions/' || p === '/terms-conditions') return '/terms';
    if (withSlash === '/privacy-policy/' || p === '/privacy-policy' || withSlash === '/pdpa/' || p === '/pdpa') return '/privacy-policy';
    const id = pages[withSlash] || pages[p];
    return id ? pageUrl(id) : legacyUrl(p);
  }

  function catLabel(cat) {
    const lang = window.CmsI18n?.getLang() || 'th';
    return lang === 'en' ? cat.labelEn || cat.labelTh : cat.labelTh || cat.labelEn;
  }

  function t(key) {
    return window.CmsI18n ? CmsI18n.t(key) : key;
  }

  function langBar() {
    return `
<div class="kb-lang-switch" role="group" aria-label="Language">
  <button type="button" class="kb-lang-btn" data-lang="th" title="ไทย">TH</button>
  <button type="button" class="kb-lang-btn" data-lang="en" title="English">EN</button>
</div>`;
  }

  function navActive(activeKey, key) {
    return activeKey === key ? ' is-active' : '';
  }

  function servicesHref() {
    return location.pathname === '/' || location.pathname === '/index.html'
      ? '#home-services'
      : '/#home-services';
  }

  function renderHeader(activeKey) {
    const c = cfg();
    const logo = c.logos?.header || c.logos?.favicon || '/assets/img/favicon-32.png';
    const cats = c.newsCategories || [];
    const newsItems = cats
      .map(
        (cat) =>
          `<li><a href="/news?c=${encodeURIComponent(cat.slug)}">${catLabel(cat)}</a></li>`
      )
      .join('');

    const homeIcon =
      activeKey === 'home' && window.KbIcon ? KbIcon.svg('home', 16) : '';
    return `
<header class="kb-header-wrap">
  <div class="kb-header-pill">
  <div class="kb-container kb-header-inner">
    <a class="kb-brand" href="/">
      <span class="kb-brand-logo-wrap"><img class="kb-brand-logo" src="${logo}" alt="" width="44" height="44"></span>
      <span class="kb-brand-text">
        <span class="kb-brand-name kb-logo-name">${c.brandTitle || 'NKBKCOOP'}</span>
        <span class="kb-brand-sub kb-logo-sub">${c.brandSubTh || c.name}</span>
      </span>
    </a>
    <nav class="kb-header-nav" id="kb-main-nav" aria-label="Main">
    <div class="kb-mobile-menu-card">
        <div class="kb-mobile-nav-head">
          <span class="kb-mobile-nav-title" data-i18n="nav.menu">เมนู</span>
          <button type="button" class="kb-nav-close" aria-label="ปิดเมนู">&times;</button>
        </div>
        <div class="kb-mobile-nav-body">
      <a href="/" class="kb-nav-link${navActive(activeKey, 'home')}">${homeIcon}<span data-i18n="nav.home">หน้าหลัก</span></a>
      <div class="kb-nav-item kb-has-drop${navActive(activeKey, 'about')}">
        <button type="button" class="kb-nav-link kb-nav-trigger" data-i18n="nav.aboutUs">เกี่ยวกับสหกรณ์</button>
        <div class="kb-drop">
          <ul>
            <li><a href="${menuUrl('/about-us/')}" data-i18n="nav.aboutUs">เกี่ยวกับสหกรณ์</a></li>
            <li><a href="${menuUrl('/team/')}" data-i18n="nav.team">คณะกรรมการดำเนินการ</a></li>
            <li><a href="${menuUrl('/management/')}" data-i18n="nav.management">ทำเนียบฝ่ายจัดการ</a></li>
            <li><a href="${menuUrl('/agenda/')}" data-i18n="nav.agenda">วาระและรายงานการประชุม</a></li>
          </ul>
        </div>
      </div>
      <a href="${servicesHref()}" class="kb-nav-link${navActive(activeKey, 'services')}" data-i18n="nav.services">บริการของเรา</a>
      <div class="kb-nav-item kb-has-drop${navActive(activeKey, 'news')}">
        <button type="button" class="kb-nav-link kb-nav-trigger" data-i18n="nav.news">ข่าวสาร</button>
        <div class="kb-drop">
          <ul>
            <li><a href="/news" data-i18n="nav.newsAll">ข่าวทั้งหมด</a></li>
            ${newsItems}
          </ul>
        </div>
      </div>
      <a href="${menuUrl('/download/')}" class="kb-nav-link${navActive(activeKey, 'download')}" data-i18n="nav.download">ดาวน์โหลด</a>
      <a href="${menuUrl('/contact/')}" class="kb-nav-link${navActive(activeKey, 'contact')}" data-i18n="nav.contact">ติดต่อเรา</a>
        </div>
      </div>
    </nav>
    <div class="kb-header-actions">
      ${langBar()}
      <button type="button" class="kb-nav-toggle" aria-label="เปิดเมนู" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
    </div>
  </div>
  </div>
</header>`;
  }

  function socialIcon(type) {
    return window.KbIcon ? KbIcon.brand(type, 22) : '';
  }

  function renderLoading() {
    const c = cfg();
    const label = t('misc.loading');
    const logo = c.logos?.header || c.logos?.favicon || '/assets/img/logo-cooperative.png';
    return `
<div class="kb-loading" role="status" aria-live="polite" aria-busy="true">
  <div class="kb-loading-logo-wrap">
    <div class="kb-loading-ring" aria-hidden="true"></div>
    <img class="kb-loading-logo" src="${logo}" alt="" width="64" height="64">
  </div>
  <p class="kb-loading-text">${label}</p>
</div>`;
  }

  function renderFooter() {
    const c = cfg();
    const logo = c.logos?.footer || c.logos?.favicon || '/assets/img/logo-cooperative.png';
    const appImgs = c.footerAppImages || [
      '/assets/img/footer-app-1.png',
      '/assets/img/footer-app-2.png'
    ];
    const iosUrl =
      c.appStoreIos ||
      'https://apps.apple.com/th/app/nkbkconnext/id1554206325?l=th';
    const androidUrl =
      c.appStoreAndroid ||
      'https://play.google.com/store/apps/details?id=com.nkhsaving.mobile';
    const phoneIcon = window.KbIcon ? KbIcon.svg('smartphone', 22) : '';
    const lang = window.CmsI18n?.getLang() || 'th';
    const addr = lang === 'en' ? c.addressEn || c.address : c.address;
    const siteName = lang === 'en' ? c.nameEn || c.name : c.name;
    const phone = c.phoneDisplay || c.phone;

    return `
<footer class="kb-footer">
  <div class="kb-footer-body">
    <div class="kb-container">
      <div class="kb-footer-grid">
      <div class="kb-footer-app-block">
        <div class="kb-footer-app-showcase" aria-hidden="true">
          <div class="kb-footer-phones">
            <img src="${appImgs[0]}" alt="" class="kb-footer-phone kb-footer-phone--left" width="320" height="480" loading="lazy">
            <img src="${appImgs[1]}" alt="" class="kb-footer-phone kb-footer-phone--right" width="320" height="480" loading="lazy">
          </div>
        </div>
        <div class="kb-footer-store-badges">
          <a href="${iosUrl}" class="kb-footer-store kb-footer-store--ios" target="_blank" rel="noopener noreferrer">
            <span class="kb-footer-store-icon" aria-hidden="true">${phoneIcon}</span>
            <span class="kb-footer-store-text">
              <span class="kb-footer-store-hint" data-i18n="footer.storeIosHint">ดาวน์โหลดบน</span>
              <span class="kb-footer-store-name" data-i18n="footer.storeIos">App Store</span>
            </span>
          </a>
          <a href="${androidUrl}" class="kb-footer-store kb-footer-store--android" target="_blank" rel="noopener noreferrer">
            <span class="kb-footer-store-icon" aria-hidden="true">${phoneIcon}</span>
            <span class="kb-footer-store-text">
              <span class="kb-footer-store-hint" data-i18n="footer.storeAndroidHint">ดาวน์โหลดที่</span>
              <span class="kb-footer-store-name" data-i18n="footer.storeAndroid">Google Play</span>
            </span>
          </a>
        </div>
      </div>
      <div class="kb-footer-links">
      <div>
        <h4 data-i18n="footer.company">เกี่ยวกับองค์กร</h4>
        <ul>
          <li><a href="${menuUrl('/about-us/')}" data-i18n="nav.aboutUs">เกี่ยวกับสหกรณ์</a></li>
          <li><a href="${menuUrl('/team/')}" data-i18n="nav.team">คณะกรรมการดำเนินการ</a></li>
          <li><a href="${menuUrl('/management/')}" data-i18n="nav.management">ทำเนียบฝ่ายจัดการ</a></li>
        </ul>
      </div>
      <div>
        <h4 data-i18n="footer.support">ช่วยเหลือ</h4>
        <ul>
          <li><a href="${menuUrl('/faq/')}" data-i18n="nav.faq">คำถามที่พบบ่อย</a></li>
          <li><a href="${menuUrl('/terms/')}" data-i18n="nav.terms">ข้อกำหนดและเงื่อนไข</a></li>
          <li><a href="${menuUrl('/privacy-policy/')}" data-i18n="nav.privacy">นโยบายความเป็นส่วนตัว</a></li>
          <li><a href="${menuUrl('/contact/')}" data-i18n="nav.contact">ติดต่อเรา</a></li>
        </ul>
      </div>
      <div>
        <h4 data-i18n="footer.address">ที่ตั้ง</h4>
        <ul class="kb-footer-contact">
          <li id="kb-footer-address">${addr}</li>
          <li><a href="mailto:${c.email}">${c.email}</a></li>
        </ul>
      </div>
      </div>
      </div>
    </div>
  </div>
  <section class="kb-footer-phonebar">
    <div class="kb-container kb-footer-phonebar-inner">
      <div class="kb-footer-social">
        <span class="kb-footer-social-label" data-i18n="footer.followUs">ติดตามเรา</span>
        <a href="${c.facebook}" class="kb-social-link" target="_blank" rel="noopener" title="Facebook">
          ${socialIcon('facebook')}<span>Facebook</span>
        </a>
        <a href="${c.line}" class="kb-social-link kb-social-link--line" target="_blank" rel="noopener noreferrer" title="LINE">
          ${socialIcon('line')}<span>LINE</span>
        </a>
        <a href="${c.youtube}" class="kb-social-link" target="_blank" rel="noopener" title="YouTube">
          ${socialIcon('youtube')}<span>YouTube</span>
        </a>
      </div>
      <div class="kb-footer-phone">
        <span class="kb-footer-phone-label" data-i18n="footer.hotlineLabel">สายด่วนสหกรณ์</span>
        <a href="tel:${c.phone}" class="kb-footer-phone-num">${phone}</a>
      </div>
    </div>
  </section>
  <div class="kb-footer-tagline">
    <div class="kb-container">
      <p data-i18n="footer.tagline">บริการทุกระดับประทับใจ</p>
    </div>
  </div>
  <div class="kb-footer-bottom">
    <div class="kb-container">
      <p>&copy; ${new Date().getFullYear()} ${siteName}</p>
    </div>
  </div></footer>
<button type="button" class="kb-back-top" aria-label="Top">${window.KbIcon ? KbIcon.svg('arrow-up', 20) : '↑'}</button>`;
  }

  function renderPageTitle(title, subtitle) {
    return `
<section class="kb-page-head">
  <div class="kb-container">
    <h1>${title}</h1>
    ${subtitle ? `<p class="kb-page-head-sub">${subtitle}</p>` : ''}
  </div>
</section>`;
  }

  const NAV_MOBILE_BP = 992;
  const PILL_LAYOUT_MIN_H = 56;
  let headerOffsetRetryTimer = null;

  function readPageHeadGapPx() {
    const desktop = window.innerWidth >= NAV_MOBILE_BP;
    const varName = desktop ? '--kb-page-head-gap' : '--kb-page-head-gap-mobile';
    const fallback = desktop ? 10 : 4;
    return Math.round(
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(varName)
      ) || fallback
    );
  }

  /** จัดระดับแถบชมพูให้เท่าทุกหน้า — อ้างอิงหน้าติดต่อเรา (ช่องว่างเล็กน้อยใต้แท็บเมนู ไม่ทับ) */
  function syncHeaderOffset() {
    const wrap = document.querySelector('.kb-header-wrap');
    const pill = wrap?.querySelector('.kb-header-pill');
    if (!wrap || document.body.classList.contains('kb-home')) return;

    const gapPx = readPageHeadGapPx();
    let offset = 0;

    if (pill) {
      const pr = pill.getBoundingClientRect();
      if (pr.height >= PILL_LAYOUT_MIN_H) {
        offset = Math.ceil(pr.bottom + gapPx);
      } else {
        return;
      }
    } else {
      const wr = wrap.getBoundingClientRect();
      offset = Math.ceil(wr.bottom + gapPx);
    }
    if (offset > 0) {
      document.documentElement.style.setProperty('--kb-header-offset', offset + 'px');
    }
  }

  let headerOffsetObserver = null;
  function attachHeaderOffsetObserver() {
    const wrap = document.querySelector('.kb-header-wrap');
    if (!wrap || headerOffsetObserver) return;
    headerOffsetObserver = new ResizeObserver(() => syncHeaderOffset());
    headerOffsetObserver.observe(wrap);
    const pill = wrap.querySelector('.kb-header-pill');
    if (pill) headerOffsetObserver.observe(pill);
  }

  function scheduleHeaderOffsetSync() {
    syncHeaderNavPlacement();
    const run = () => syncHeaderOffset();
    requestAnimationFrame(() => {
      run();
      requestAnimationFrame(run);
    });
    if (headerOffsetRetryTimer) clearTimeout(headerOffsetRetryTimer);
    [0, 50, 150, 400, 800].forEach((ms) => setTimeout(run, ms));
    headerOffsetRetryTimer = setTimeout(run, 1200);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(run).catch(() => {});
    }
  }

  const ANCHOR_SCROLL_EXTRA = 20;

  function headerScrollOffsetPx() {
    const root = document.documentElement;
    const synced = parseFloat(getComputedStyle(root).getPropertyValue('--kb-header-offset'));
    if (synced > 0) return Math.ceil(synced + ANCHOR_SCROLL_EXTRA);

    const wrap = document.querySelector('.kb-header-wrap');
    const pill = wrap?.querySelector('.kb-header-pill');
    const gap = readPageHeadGapPx();
    if (pill) return Math.ceil(pill.getBoundingClientRect().bottom + gap + ANCHOR_SCROLL_EXTRA);
    if (wrap) return Math.ceil(wrap.getBoundingClientRect().bottom + gap + ANCHOR_SCROLL_EXTRA);
    return 122;
  }

  function anchorScrollTargetEl(target) {
    if (!target) return null;
    if (target.matches('.kb-faq-group, .kb-legal-section')) {
      return (
        target.querySelector('.kb-faq-group-title, .kb-legal-section-title') || target
      );
    }
    const titled = target.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > h4');
    return titled || target;
  }

  function scrollToAnchorTarget(target, { smooth = true } = {}) {
    const el = anchorScrollTargetEl(target);
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - headerScrollOffsetPx();
    window.scrollTo({ top: Math.max(0, y), behavior: smooth ? 'smooth' : 'auto' });
  }

  function resolveAnchorTarget(hash) {
    if (!hash || hash.length < 2) return null;
    let target = document.querySelector(hash);
    if (target) return target;
    try {
      const id = decodeURIComponent(hash.slice(1));
      target = document.getElementById(id);
      if (target) return target;
      if (typeof CSS !== 'undefined' && CSS.escape) {
        return document.querySelector(`[id="${CSS.escape(id)}"]`);
      }
    } catch (_) {
      /* ignore */
    }
    return null;
  }

  function jumpToLocationHash({ smooth = false } = {}) {
    const target = resolveAnchorTarget(location.hash);
    if (target) scrollToAnchorTarget(target, { smooth });
  }

  function bindHeaderAwareAnchors(root) {
    const scope = root || document.getElementById('cms-page-content') || document;
    scope.querySelectorAll('a[href^="#"]').forEach((link) => {
      const href = link.getAttribute('href') || '';
      if (href === '#' || href.length < 2) return;
      if (link.dataset.kbAnchorBound === '1') return;
      link.dataset.kbAnchorBound = '1';
      link.addEventListener('click', (e) => {
        const target = resolveAnchorTarget(href);
        if (!target) return;
        e.preventDefault();
        scrollToAnchorTarget(target);
        if (history.replaceState) history.replaceState(null, '', href);
      });
    });
    if (location.hash && location.hash.length > 1) {
      requestAnimationFrame(() => requestAnimationFrame(() => jumpToLocationHash({ smooth: false })));
      setTimeout(() => jumpToLocationHash({ smooth: false }), 150);
      setTimeout(() => jumpToLocationHash({ smooth: false }), 400);
    }
  }

  function syncHeaderNavPlacement() {
    const wrap = document.querySelector('.kb-header-wrap');
    const nav = document.getElementById('kb-main-nav');
    const inner = wrap?.querySelector('.kb-header-inner');
    const actions = inner?.querySelector('.kb-header-actions');
    if (!wrap || !nav || !inner || !actions) return;

    if (window.innerWidth <= NAV_MOBILE_BP) {
      if (nav.parentElement !== wrap) wrap.appendChild(nav);
    } else if (nav.parentElement !== inner) {
      inner.insertBefore(nav, actions);
    }
  }

  function setMobileNavOpen(open) {
    const nav = document.getElementById('kb-main-nav');
    const toggle = document.querySelector('.kb-nav-toggle');
    const wrap = document.querySelector('.kb-header-wrap');
    if (!nav) return;
    nav.classList.toggle('is-open', open);
    wrap?.classList.toggle('is-menu-open', open);
    document.body.classList.toggle('kb-nav-open', open);
    if (toggle) {
      toggle.classList.toggle('is-active', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'ปิดเมนู' : 'เปิดเมนู');
    }
  }

  function bindShellEvents(root) {
    CmsI18n?.initLangToggle(root);

    const toggle = root.querySelector('.kb-nav-toggle');
    const nav = document.getElementById('kb-main-nav');
    const closeBtn = root.querySelector('.kb-nav-close');

    if (toggle && nav) {
      toggle.addEventListener('click', () => {
        setMobileNavOpen(!nav.classList.contains('is-open'));
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', () => setMobileNavOpen(false));
    }
    if (nav) {
      nav.addEventListener('click', (e) => {
        if (e.target === nav) setMobileNavOpen(false);
      });
      nav.querySelectorAll('a.kb-nav-link').forEach((a) => {
        a.addEventListener('click', () => {
          if (window.innerWidth <= NAV_MOBILE_BP) setMobileNavOpen(false);
        });
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setMobileNavOpen(false);
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth > NAV_MOBILE_BP) setMobileNavOpen(false);
      scheduleHeaderOffsetSync();
    });

    scheduleHeaderOffsetSync();
    attachHeaderOffsetObserver();
    window.addEventListener('load', scheduleHeaderOffsetSync);

    root.querySelectorAll('.kb-has-drop .kb-nav-trigger').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        if (window.innerWidth > NAV_MOBILE_BP) return;
        e.preventDefault();
        const item = btn.closest('.kb-has-drop');
        item?.classList.toggle('is-open');
      });
    });

    const backTop = document.querySelector('.kb-back-top');
    if (backTop) {
      window.addEventListener('scroll', () => {
        backTop.classList.toggle('is-visible', window.scrollY > 400);
      });
      backTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    }

    CmsI18n?.applyTranslations();
    updateBrandText();
    window.addEventListener('cms:langchange', () => {
      CmsI18n.applyTranslations();
      updateBrandText();
      refreshFooterLocale();
      scheduleHeaderOffsetSync();
      setTimeout(() => jumpToLocationHash({ smooth: false }), 200);
    });
  }

  function refreshFooterLocale() {
    const c = cfg();
    const lang = window.CmsI18n?.getLang() || 'th';
    const addr = lang === 'en' ? c.addressEn || c.address : c.address;
    const addrEl = document.getElementById('kb-footer-address');
    if (addrEl) addrEl.textContent = addr;
  }

  function updateBrandText() {
    const lang = CmsI18n?.getLang() || 'th';
    const nameEl = document.querySelector('.kb-logo-name');
    const subEl = document.querySelector('.kb-logo-sub');
    if (!window.CMS_SITE) return;
    if (nameEl) nameEl.textContent = CMS_SITE.brandTitle || 'NKBKCOOP';
    if (subEl) {
      subEl.textContent =
        lang === 'en'
          ? CMS_SITE.brandSubEn || CMS_SITE.nameShortEn || CMS_SITE.brandTitle
          : CMS_SITE.brandSubTh || CMS_SITE.name;
    }
  }

  function applyFavicon() {
    const href = window.CMS_SITE?.logos?.favicon;
    if (!href) return;
    let link = document.querySelector('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      link.type = 'image/png';
      document.head.appendChild(link);
    }
    link.href = href;
  }

  function initCmsShell(options) {
    applyFavicon();
    document.body.className = options.bodyClass || 'kb-site';
    const headerEl = document.getElementById('cms-header');
    const footerEl = document.getElementById('cms-footer');
    const titleEl = document.getElementById('cms-page-title');
    if (headerEl) {
      headerEl.innerHTML = renderHeader(options.activeNav || '');
      bindShellEvents(headerEl);
      scheduleHeaderOffsetSync();
    }
    if (titleEl && options.pageTitle) {
      setPageTitle(options.pageTitle, options.pageSubtitle || '');
    }
    if (footerEl) {
      footerEl.innerHTML = renderFooter();
      CmsI18n?.initLangToggle(footerEl);
      CmsI18n?.applyTranslations();
    }
  }

  function activeNavForPageId(pageId) {
    const map = {
      '7934': 'download',
      '9304': 'payment',
      '9278': 'payment',
      '354': 'contact',
      '294': 'faq',
      '525': 'faq',
      '3': 'faq',
      '420': 'about',
      '8929': 'about',
      '241': 'about',
      '13575': 'about',
      '1263': 'login',
      '9208': 'app'
    };
    return map[String(pageId)] || '';
  }

  function setPageTitle(title, subtitle) {
    const titleEl = document.getElementById('cms-page-title');
    if (!titleEl) return;
    titleEl.innerHTML = renderPageTitle(title, subtitle || '');
    scheduleHeaderOffsetSync();
  }

  window.CmsLayout = {
    initCmsShell,
    renderPageTitle,
    setPageTitle,
    scheduleHeaderOffsetSync,
    bindHeaderAwareAnchors,
    scrollToAnchorTarget,
    renderLoading,
    legacyUrl,
    menuUrl,
    pageUrl,
    catLabel,
    activeNavForPageId,
    refreshFooterLocale
  };
})();
