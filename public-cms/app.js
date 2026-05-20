function t(key) {
  return window.CmsI18n ? CmsI18n.t(key) : key;
}

function formatDate(ts) {
  if (!ts || !ts.toDate) return '';
  const lang = window.CmsI18n?.getLang() || 'th';
  return ts.toDate().toLocaleDateString(lang === 'en' ? 'en-GB' : 'th-TH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

function postUrl(id) {
  return `/n/${id}`;
}

function getPostIdFromLocation() {
  const pathMatch = location.pathname.match(/^\/n\/(\d+)\/?$/i);
  if (pathMatch) return pathMatch[1];
  const params = new URLSearchParams(location.search);
  if (params.get('id')) return params.get('id');
  return null;
}

function getPageIdFromLocation() {
  const path = (location.pathname || '').replace(/\/+$/, '') || '/';
  if (path === '/download') return '7934';
  const pathKey = path === '/' ? '/' : `${path}/`;
  const pages = (window.CMS_SITE && window.CMS_SITE.cmsPages) || {};
  if (pages[pathKey]) return String(pages[pathKey]);
  if (pages[path]) return String(pages[path]);
  const m = path.match(/^\/page\/(\d+)$/i);
  return m ? m[1] : null;
}

function getNewsCategoryFilter() {
  return new URLSearchParams(location.search).get('c') || '';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isPdfUrl(url) {
  if (!url) return false;
  try {
    const p = new URL(url, location.origin).pathname.toLowerCase();
    return p.endsWith('.pdf') || p.includes('.pdf/');
  } catch {
    return /\.pdf(\?|$)/i.test(url);
  }
}

function enhancePostContent(root) {
  if (!root) return;
  root.querySelectorAll('a[href]').forEach((a) => {
    if (a.closest('.pdf-viewer')) return;
    const href = a.getAttribute('href') || '';
    if (!href || href.startsWith('#')) return;
    const isPdfemb = /pdfemb|pdf-embed/i.test(a.className || '');
    const inPdfBlock = !!a.closest('.wp-block-pdfemb-pdf-embedder-viewer, [class*="pdfemb"]');
    if (!isPdfUrl(href) && !isPdfemb && !inPdfBlock) return;
    const wrap = document.createElement('div');
    wrap.className = 'pdf-viewer';
    const iframe = document.createElement('iframe');
    iframe.src = href.includes('#') ? href : `${href}#view=FitH`;
    iframe.title = (a.textContent || 'PDF').trim() || 'PDF';
    iframe.loading = 'lazy';
    wrap.appendChild(iframe);
    const parent = a.parentElement;
    if (parent && parent.tagName === 'P' && parent.childNodes.length === 1) {
      parent.replaceWith(wrap);
    } else {
      a.replaceWith(wrap);
    }
  });
}

function rewriteContentLinks(root) {
  if (!root) return;
  const legacy = (window.CMS_SITE && window.CMS_SITE.wpLegacy) || 'https://nkbkcoop.com';
  const host = legacy.replace(/^https?:\/\//, '').replace(/\/$/, '');
  root.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    try {
      const u = new URL(href, location.origin);
      if (!u.hostname.includes(host.replace(/^www\./, '')) && u.hostname !== host) return;
      const m = u.pathname.match(/-(\d+)\/?$/);
      if (m) {
        a.setAttribute('href', postUrl(m[1]));
        return;
      }
      const pages = (window.CMS_SITE && window.CMS_SITE.cmsPages) || {};
      const pathKey = u.pathname.endsWith('/') ? u.pathname : `${u.pathname}/`;
      if (pages[pathKey]) {
        a.setAttribute('href', `/page/${pages[pathKey]}`);
        return;
      }
      if (u.pathname === '/' || u.pathname === '') {
        a.setAttribute('href', '/');
      }
    } catch (_) {
      /* ignore */
    }
  });
}

function siteTabTitle() {
  return (window.CMS_SITE && CMS_SITE.tabTitle) || 'NKBKCOOP';
}

async function loadSiteName() {
  document.title = siteTabTitle();
}

function loadElementorPageCss(pageId) {
  const id = `kb-el-css-${pageId}`;
  if (document.getElementById(id)) return;
  const legacy = (window.CMS_SITE && window.CMS_SITE.wpLegacy) || 'https://nkbkcoop.com';
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `${legacy.replace(/\/$/, '')}/wp-content/uploads/elementor/css/post-${pageId}.css`;
  document.head.appendChild(link);
}

async function fetchPageHtml(pageId) {
  const doc = await db.collection('cms_pages').doc(String(pageId)).get();
  if (doc.exists && doc.data().contentHtml) {
    return { html: doc.data().contentHtml, title: doc.data().title || '' };
  }
  const legacy = (window.CMS_SITE && window.CMS_SITE.wpLegacy) || 'https://nkbkcoop.com';
  const res = await fetch(`${legacy}/wp-json/wp/v2/pages/${pageId}?_fields=title,content`);
  if (!res.ok) throw new Error(t('misc.notFound'));
  const json = await res.json();
  return { html: json.content?.rendered || '', title: json.title?.rendered || '' };
}

function renderNewsCard(post, opts) {
  const id = post.id;
  const d = post.data();
  const href = postUrl(id);
  const compact = opts && opts.compact;
  const img = d.featuredImageUrl
    ? `<img src="${escapeHtml(d.featuredImageUrl)}" alt="" loading="lazy">`
    : '';
  const cardClass = compact ? 'kb-news-card kb-news-card--compact' : 'kb-news-card';
  const title = escapeHtml(d.title || '');
  return `
<article class="${cardClass}">
  ${img}
  <div class="kb-news-card-body">
    <time class="kb-news-date">${formatDate(d.publishedAt)}</time>
    <h3 class="kb-clamp-2"><a href="${href}" title="${title}">${title}</a></h3>
    ${!compact && d.excerpt ? `<p class="kb-clamp-2">${escapeHtml(d.excerpt)}</p>` : ''}
    <a class="kb-link-more" href="${href}">${t('news.readMore')} ${kbIcon('arrow-right', 16)}</a>
  </div>
</article>`;
}

function renderNewsSidebar(activeSlug) {
  const cats = (window.CMS_SITE && window.CMS_SITE.newsCategories) || [];
  const items = cats
    .map((c) => {
      const active = c.slug === activeSlug ? ' class="active"' : '';
      const label = CmsLayout.catLabel(c);
      return `<li${active}><a href="/news?c=${encodeURIComponent(c.slug)}">${label}</a></li>`;
    })
    .join('');
  return `
<aside class="kb-sidebar">
  <h3 data-i18n="news.categories">เธซเธกเธงเธ”เธเนเธฒเธง</h3>
  <ul>
    <li${activeSlug ? '' : ' class="active"'}><a href="/news" data-i18n="nav.newsAll">เธเนเธฒเธงเธ—เธฑเนเธเธซเธกเธ”</a></li>
    ${items}
  </ul>
</aside>`;
}

async function getCategoryWpId(slug) {
  if (!slug) return null;
  const snap = await db.collection('cms_categories').where('slug', '==', slug).limit(1).get();
  if (!snap.empty) return snap.docs[0].id;
  return null;
}

async function fetchPosts(limit, categorySlug) {
  const snap = await db.collection('cms_posts').orderBy('publishedAt', 'desc').limit(limit).get();
  let docs = snap.docs;
  if (!categorySlug) return docs;
  const catId = await getCategoryWpId(categorySlug);
  if (!catId) return docs;
  return docs.filter((doc) => {
    const ids = (doc.data().categoryIds || []).map(String);
    return ids.includes(String(catId));
  });
}

function categoryLabel(slug) {
  const cats = (window.CMS_SITE && window.CMS_SITE.newsCategories) || [];
  const found = cats.find((c) => c.slug === slug);
  return found ? CmsLayout.catLabel(found) : '';
}

function kbIcon(name, size, mod) {
  return window.KbIcon ? KbIcon.wrap(name, mod, size) : '';
}


async function initHome() {
  CmsLayout.initCmsShell({ activeNav: 'home', bodyClass: 'kb-site kb-home' });
  await loadSiteName();
  const main = document.getElementById('cms-page-content');
  if (!main) return;
  main.innerHTML = renderHomePage();
  CmsI18n.applyTranslations();
  const grid = document.getElementById('homeNewsGrid');
  try {
    const docs = await fetchPosts(6);
    if (grid) {
      grid.innerHTML = docs.length
        ? docs.map((p) => renderNewsCard(p, { compact: true })).join('')
        : `<p class="muted">${t('news.empty')}</p>`;
    }
  } catch (e) {
    if (grid) grid.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
  }
}

async function initNewsList() {
  const cat = getNewsCategoryFilter();
  const catTitle = cat ? categoryLabel(cat) : t('news.title');
  CmsLayout.initCmsShell({
    activeNav: 'news',
    bodyClass: 'kb-site',
    pageTitle: escapeHtml(catTitle),
    pageSubtitle: cat ? '' : t('news.subtitle')
  });
  await loadSiteName();

  const sidebar = document.getElementById('newsSidebar');
  if (sidebar) {
    sidebar.outerHTML = renderNewsSidebar(cat);
    CmsI18n.applyTranslations();
  }

  const list = document.getElementById('newsList');
  if (!list) return;
  list.innerHTML = CmsLayout.renderLoading();
  try {
    const docs = await fetchPosts(300, cat);
    list.innerHTML = docs.length
      ? docs.map((p) => renderNewsCard(p, true)).join('')
      : `<p class="muted">${t('news.empty')}</p>`;
    list.classList.add('kb-news-list');
  } catch (e) {
    list.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
  }
}

async function initPost() {
  CmsLayout.initCmsShell({
    activeNav: 'news',
    bodyClass: 'kb-site',
    pageTitle: t('nav.news')
  });
  await loadSiteName();

  const id = getPostIdFromLocation();
  const titleEl = document.getElementById('postTitle');
  const metaEl = document.getElementById('postMeta');
  const bodyEl = document.getElementById('postBody');
  const heroEl = document.getElementById('postHero');

  if (!id) {
    bodyEl.innerHTML = `<p class="muted">${t('misc.notFound')}</p>`;
    titleEl.textContent = t('misc.notFound');
    return;
  }

  try {
    const doc = await db.collection('cms_posts').doc(String(id)).get();
    if (!doc.exists) {
      bodyEl.innerHTML = `<p class="muted">${t('misc.notFound')}</p>`;
      titleEl.textContent = t('misc.notFound');
      return;
    }
    const d = doc.data();
    titleEl.textContent = d.title || '';
    document.title = (d.title || '') + ' — ' + siteTabTitle();
    metaEl.textContent = formatDate(d.publishedAt);
    if (history.replaceState) history.replaceState(null, '', postUrl(doc.id));
    bodyEl.innerHTML = d.contentHtml || '';
    bodyEl.classList.add('kb-prose');
    rewriteContentLinks(bodyEl);
    enhancePostContent(bodyEl);
    if (d.featuredImageUrl && heroEl) {
      heroEl.innerHTML = `<img src="${escapeHtml(d.featuredImageUrl)}" alt="">`;
    }
  } catch (e) {
    bodyEl.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
  }
}

const AGENDA_PAGE_ID = '13575';
const DOWNLOAD_PAGE_ID = '7934';

async function initDownloadPage(main) {
  main.innerHTML = CmsLayout.renderLoading();
  try {
    const page = await fetchPageHtml(DOWNLOAD_PAGE_ID);
    const title = page.title || t('nav.download') || 'ดาวน์โหลด';
    document.title = title + ' — ' + siteTabTitle();
    const titleWrap = document.getElementById('cms-page-title');
    if (titleWrap) {
      titleWrap.innerHTML = CmsLayout.renderPageTitle(escapeHtml(title), '');
    }
    const sections = window.CmsDownloadPage
      ? CmsDownloadPage.parseDownloadSections(page.html)
      : [];
    main.innerHTML = window.CmsDownloadPage
      ? CmsDownloadPage.renderDownloadTable(sections)
      : page.html;
    if (location.pathname.match(/^\/page\/7934\/?$/i)) {
      history.replaceState(null, '', '/download');
    }
    CmsI18n?.applyTranslations();
    await window.CmsDownloadPage?.loadDownloadCounts(main);
    window.CmsDownloadPage?.bindDownloadButtons(main);
  } catch (e) {
    main.innerHTML = `<p class="error text-center">${escapeHtml(e.message)}</p>`;
  }
}

async function initAgendaPage(main) {
  main.innerHTML = CmsLayout.renderLoading();
  try {
    const page = await fetchPageHtml(AGENDA_PAGE_ID);
    const title =
      page.title || t('nav.agenda') || 'วาระและรายงานการประชุม';
    document.title = title + ' — ' + siteTabTitle();
    const titleWrap = document.getElementById('cms-page-title');
    if (titleWrap) {
      titleWrap.innerHTML = CmsLayout.renderPageTitle(escapeHtml(title), '');
    }
    const meetings = window.CmsAgendaPage
      ? CmsAgendaPage.parseAgendaMeetings(page.html)
      : [];
    main.innerHTML = window.CmsAgendaPage
      ? CmsAgendaPage.renderAgendaPage(meetings)
      : page.html;
    CmsI18n?.applyTranslations();
    window.CmsAgendaPage?.bindAgendaDownloadButtons(main);
  } catch (e) {
    main.innerHTML = `<p class="error text-center">${escapeHtml(e.message)}</p>`;
  }
}

async function initStaticPage() {
  const pageId = getPageIdFromLocation();
  const activeNav = CmsLayout.activeNavForPageId(pageId);
  const isAgenda = String(pageId) === AGENDA_PAGE_ID;
  const isDownload = String(pageId) === DOWNLOAD_PAGE_ID;
  CmsLayout.initCmsShell({
    activeNav,
    bodyClass: isAgenda
      ? 'kb-site kb-page kb-page--agenda'
      : isDownload
        ? 'kb-site kb-page kb-page--download'
        : 'kb-site kb-page'
  });
  await loadSiteName();

  const main = document.getElementById('cms-page-content');
  if (!pageId || !main) {
    if (main) main.innerHTML = `<p class="muted">${t('misc.notFound')}</p>`;
    return;
  }

  if (isAgenda && window.CmsAgendaPage) {
    await initAgendaPage(main);
    return;
  }

  if (isDownload && window.CmsDownloadPage) {
    await initDownloadPage(main);
    return;
  }

  main.innerHTML = CmsLayout.renderLoading();
  loadElementorPageCss(pageId);
  try {
    const page = await fetchPageHtml(pageId);
    if (page.title) {
      document.title = page.title + ' — ' + siteTabTitle();
      const titleWrap = document.getElementById('cms-page-title');
      if (titleWrap) titleWrap.innerHTML = CmsLayout.renderPageTitle(escapeHtml(page.title), '');
    }
    main.innerHTML = `
<div class="kb-page-body">
  <div class="kb-container">
    <article class="kb-article kb-prose kb-wp-content elementor">${page.html}</article>
  </div>
</div>`;
    rewriteContentLinks(main);
    enhancePostContent(main);
  } catch (e) {
    main.innerHTML = `<p class="error text-center">${escapeHtml(e.message)}</p>`;
  }
}
