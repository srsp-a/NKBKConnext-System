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
  if (path === '/about-us') return '241';
  if (path === '/team') return '420';
  if (path === '/management') return '8929';
  if (path === '/contact') return '354';
  if (path === '/infrom-payment' || path === '/infrom-payment-line') return '9304';
  if (path === '/app') return '9208';
  if (path === '/faq') return '294';
  if (path === '/terms') return '525';
  if (path === '/privacy-policy' || path === '/pdpa') return '3';
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

function getNewsSearchQuery() {
  return (new URLSearchParams(location.search).get('q') || '').trim();
}

const NEWS_PAGE_SIZE = 15;

function getNewsPage() {
  const p = parseInt(new URLSearchParams(location.search).get('page') || '1', 10);
  return Number.isFinite(p) && p >= 1 ? p : 1;
}

function buildNewsListUrl(page, cat, q) {
  const params = new URLSearchParams();
  if (cat) params.set('c', cat);
  const query = q != null ? q : getNewsSearchQuery();
  if (query) params.set('q', query);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return '/news' + (qs ? '?' + qs : '');
}

function filterPostsBySearch(docs, q) {
  if (!q) return docs;
  const needle = q.toLowerCase();
  return docs.filter((doc) => {
    const d = doc.data();
    const title = decodeHtmlEntities(d.title || '').toLowerCase();
    const excerpt = decodeHtmlEntities(d.excerpt || '').toLowerCase();
    return title.includes(needle) || excerpt.includes(needle);
  });
}

function renderNewsPagination(page, totalPages, cat, q) {
  if (totalPages <= 1) return '';
  const searchQ = q != null ? q : getNewsSearchQuery();
  const prevHref = page > 1 ? buildNewsListUrl(page - 1, cat, searchQ) : '';
  const nextHref = page < totalPages ? buildNewsListUrl(page + 1, cat, searchQ) : '';
  const pageLabel = t('news.pageOf')
    .replace('{page}', String(page))
    .replace('{total}', String(totalPages));
  return `<nav class="kb-news-pagination" aria-label="${escapeHtml(t('news.pagination'))}">
    ${
      prevHref
        ? `<a href="${prevHref}" class="kb-btn kb-btn-secondary kb-btn-sm">${escapeHtml(t('news.prev'))}</a>`
        : '<span class="kb-news-pagination-spacer" aria-hidden="true"></span>'
    }
    <span class="kb-news-pagination-info">${escapeHtml(pageLabel)}</span>
    ${
      nextHref
        ? `<a href="${nextHref}" class="kb-btn kb-btn-primary kb-btn-sm">${escapeHtml(t('news.next'))}</a>`
        : '<span class="kb-news-pagination-spacer" aria-hidden="true"></span>'
    }
  </nav>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function decodeHtmlEntities(s) {
  if (s == null || s === '') return '';
  const el = document.createElement('textarea');
  el.innerHTML = String(s);
  return el.value;
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

/** URL สำหรับ iframe PDF — แสดงเต็มหน้าแบบ A4 แนวตั้ง */
function pdfIframeSrc(url) {
  const base = String(url || '').split('#')[0];
  return `${base}#page=1&view=Fit`;
}

function normalizePdfViewers(root) {
  if (!root) return;
  root.querySelectorAll('.pdf-viewer iframe').forEach((iframe) => {
    const src = iframe.getAttribute('src') || '';
    if (!isPdfUrl(src)) return;
    const next = pdfIframeSrc(src);
    if (src !== next) iframe.setAttribute('src', next);
  });
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
    wrap.className = 'pdf-viewer pdf-viewer--a4';
    const iframe = document.createElement('iframe');
    iframe.src = pdfIframeSrc(href);
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
  normalizePdfViewers(root);
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
        const pageId = pages[pathKey];
        const pretty = {
          '7934': '/download',
          '241': '/about-us',
          '420': '/team',
          '8929': '/management',
          '354': '/contact',
          '9304': '/infrom-payment',
          '9208': '/app',
          '294': '/faq',
          '525': '/terms',
          '3': '/privacy-policy'
        };
        a.setAttribute('href', pretty[pageId] || `/page/${pageId}`);
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

function homeTabTitle() {
  const c = window.CMS_SITE || {};
  const lang = window.CmsI18n?.getLang?.() || 'th';
  if (lang === 'en') {
    return c.nameEn || c.brandSubEn || c.name || siteTabTitle();
  }
  return c.name || c.brandSubTh || siteTabTitle();
}

function bindPageAnchors(root) {
  window.CmsLayout?.bindHeaderAwareAnchors?.(
    root || document.getElementById('cms-page-content')
  );
}

async function loadSiteName() {
  const path = (location.pathname || '').replace(/\/+$/, '') || '/';
  document.title =
    path === '/' || path === '/index.html' ? homeTabTitle() : siteTabTitle();
}

function applyPageSocial(opts) {
  if (!window.CmsSocial) return;
  CmsSocial.apply(opts);
}

function socialFromPage(page, urlPath) {
  const title = page.title || siteTabTitle();
  const html = page.html || '';
  const desc =
    (window.CmsSocial && CmsSocial.stripHtml(html).slice(0, 200)) ||
    (window.CMS_SITE && CMS_SITE.og && CMS_SITE.og.description) ||
    '';
  const img =
    (window.CmsSocial && CmsSocial.firstImgFromHtml(html)) ||
    (window.CmsSocial && CmsSocial.defaultImage()) ||
    '';
  const origin = location.origin.replace(/\/$/, '');
  applyPageSocial({
    title,
    documentTitle: title + ' — ' + siteTabTitle(),
    description: desc,
    image: img,
    url: origin + (urlPath || location.pathname)
  });
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

const CMS_VIEW_SESSION = 'cms_pv_v3_';

function formatViewCount(n) {
  const num = Number(n) || 0;
  const lang = window.CmsI18n?.getLang() || 'th';
  return num.toLocaleString(lang === 'en' ? 'en-US' : 'th-TH');
}

function renderViewBadge(count) {
  const label = t('news.views');
  return `<span class="kb-news-views" title="${escapeHtml(label)}">${kbIcon('eye', 14)}<span class="kb-news-views-num">${formatViewCount(count)}</span></span>`;
}

async function fetchPostViewCounts(ids) {
  if (window.CmsCounters) {
    return CmsCounters.fetchMap('cms_post_views', ids);
  }
  return {};
}

async function trackPostView(postId) {
  if (!postId || !window.CmsCounters) return 0;
  const id = String(postId);
  const sessionKey = CMS_VIEW_SESSION + id;
  const existing = await fetchPostViewCounts([id]);
  const stored = existing[id] || 0;
  if (sessionStorage.getItem(sessionKey)) {
    return stored;
  }
  try {
    const next = await CmsCounters.bump('cms_post_views', id);
    if (next != null) sessionStorage.setItem(sessionKey, '1');
    return next != null ? next : stored;
  } catch (e) {
    return stored;
  }
}

async function loadCategoryNameMap() {
  const map = {};
  if (typeof db === 'undefined') return map;
  try {
    const snap = await db.collection('cms_categories').get();
    snap.docs.forEach((doc) => {
      const name = doc.data().name || doc.data().slug || '';
      map[String(doc.id)] = name;
    });
  } catch (e) {
    console.warn('categories', e.message);
  }
  return map;
}

function postCategoryLabel(d, categoryMap) {
  const ids = (d.categoryIds || []).map(String);
  if (!ids.length || !categoryMap) return '';
  const hit = ids.find((id) => categoryMap[id]);
  return hit ? categoryMap[hit] : '';
}

function renderNewsCard(post, opts) {
  const id = post.id;
  const d = post.data();
  const href = postUrl(id);
  const compact = opts && opts.compact;
  const list = opts && opts.list;
  const viewCount = opts && opts.viewCount != null ? opts.viewCount : 0;
  const title = escapeHtml(decodeHtmlEntities(d.title || ''));
  const catLabel = postCategoryLabel(d, opts && opts.categoryMap);
  const mediaInner = d.featuredImageUrl
    ? `<img src="${escapeHtml(d.featuredImageUrl)}" alt="" loading="lazy">`
    : `<div class="kb-news-card-placeholder" aria-hidden="true">${kbIcon('news', 32)}</div>`;
  const cardClass = [
    'kb-news-card',
    compact ? 'kb-news-card--compact' : '',
    list ? 'kb-news-card--list' : ''
  ]
    .filter(Boolean)
    .join(' ');
  const excerpt =
    !compact && d.excerpt ? `<p class="kb-news-card-excerpt kb-clamp-3">${escapeHtml(d.excerpt)}</p>` : '';
  const catBadge = catLabel
    ? `<span class="kb-news-card-cat">${escapeHtml(catLabel)}</span>`
    : '';
  return `
<article class="${cardClass}">
  <a class="kb-news-card-hit" href="${href}">
    <div class="kb-news-card-media">${mediaInner}</div>
    <div class="kb-news-card-body">
      ${catBadge}
      <div class="kb-news-card-meta">
        <time class="kb-news-date">${formatDate(d.publishedAt)}</time>
        ${renderViewBadge(viewCount)}
      </div>
      <h3 class="kb-news-card-title kb-clamp-2">${title}</h3>
      ${excerpt}
      <span class="kb-news-card-cta">${t('news.readMore')} ${kbIcon('arrow-right', 16)}</span>
    </div>
  </a>
</article>`;
}

function renderNewsSidebar(activeSlug, searchQ) {
  const cats = (window.CMS_SITE && window.CMS_SITE.newsCategories) || [];
  const items = cats
    .map((c) => {
      const active = c.slug === activeSlug ? ' class="active"' : '';
      const label = CmsLayout.catLabel(c);
      return `<li${active}><a href="/news?c=${encodeURIComponent(c.slug)}">${label}</a></li>`;
    })
    .join('');
  const qVal = searchQ != null ? searchQ : getNewsSearchQuery();
  return `
<aside id="newsSidebar" class="kb-sidebar">
  <form class="kb-news-search" action="/news" method="get" role="search">
    ${activeSlug ? `<input type="hidden" name="c" value="${escapeHtml(activeSlug)}">` : ''}
    <label class="kb-news-search-label" for="newsSearchInput">${escapeHtml(t('news.searchLabel'))}</label>
    <div class="kb-news-search-row">
      <input id="newsSearchInput" class="kb-news-search-input" type="search" name="q" value="${escapeHtml(qVal)}" placeholder="${escapeHtml(t('news.searchPlaceholder'))}" autocomplete="off">
      <button type="submit" class="kb-btn kb-btn-primary kb-btn-sm">${escapeHtml(t('news.searchBtn'))}</button>
    </div>
  </form>
  <h3 data-i18n="news.categories">หมวดข่าว</h3>
  <ul>
    <li${activeSlug ? '' : ' class="active"'}><a href="/news" data-i18n="nav.newsAll">ข่าวทั้งหมด</a></li>
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

async function getPostNewsCategorySlug(categoryIds) {
  if (!categoryIds || !categoryIds.length) return '';
  const knownSlugs = new Set(
    ((window.CMS_SITE && window.CMS_SITE.newsCategories) || []).map((c) => c.slug)
  );
  const snap = await db.collection('cms_categories').get();
  const idToSlug = {};
  snap.docs.forEach((doc) => {
    const slug = String((doc.data().slug || '')).trim();
    if (slug) idToSlug[String(doc.id)] = slug;
  });
  for (const id of categoryIds.map(String)) {
    const slug = idToSlug[id];
    if (slug && knownSlugs.has(slug)) return slug;
  }
  return '';
}

async function getPostNewsCategoryLabel(categoryIds) {
  const slug = await getPostNewsCategorySlug(categoryIds);
  return slug ? categoryLabel(slug) : '';
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
    const viewMap = await fetchPostViewCounts(docs.map((p) => p.id));
    if (grid) {
      grid.innerHTML = docs.length
        ? docs
            .map((p) => renderNewsCard(p, { compact: true, viewCount: viewMap[p.id] || 0 }))
            .join('')
        : `<p class="muted">${t('news.empty')}</p>`;
    }
  } catch (e) {
    if (grid) grid.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
  }
  const c = window.CMS_SITE || {};
  const homeTitle = homeTabTitle();
  applyPageSocial({
    title: homeTitle,
    documentTitle: homeTitle,
    description: (c.og && c.og.description) || c.brandSubTh || '',
    image: (c.og && c.og.image) || c.heroImage || c.logos?.header,
    url: location.origin.replace(/\/$/, '') + '/'
  });
}

async function initNewsList() {
  const cat = getNewsCategoryFilter();
  const searchQ = getNewsSearchQuery();
  const catTitle = cat ? categoryLabel(cat) : t('news.title');
  CmsLayout.initCmsShell({
    activeNav: 'news',
    navNewsLabel: cat ? categoryLabel(cat) : '',
    bodyClass: 'kb-site',
    pageTitle: escapeHtml(catTitle),
    pageSubtitle: cat ? '' : t('news.subtitle')
  });
  await loadSiteName();

  const sidebar = document.getElementById('newsSidebar');
  if (sidebar) {
    sidebar.outerHTML = renderNewsSidebar(cat, searchQ);
    CmsI18n.applyTranslations();
  }

  const list = document.getElementById('newsList');
  if (!list) return;
  list.innerHTML = CmsLayout.renderLoading();
  let pager = document.getElementById('newsPagination');
  if (pager) {
    pager.innerHTML = '';
    pager.classList.add('kb-news-pagination--empty');
    pager.setAttribute('aria-hidden', 'true');
  }
  try {
    let docs = await fetchPosts(300, cat);
    docs = filterPostsBySearch(docs, searchQ);
    const page = getNewsPage();
    const totalPages = Math.max(1, Math.ceil(docs.length / NEWS_PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * NEWS_PAGE_SIZE;
    const pageDocs = docs.slice(start, start + NEWS_PAGE_SIZE);
    const [viewMap, categoryMap] = await Promise.all([
      fetchPostViewCounts(pageDocs.map((p) => p.id)),
      loadCategoryNameMap()
    ]);
    const emptyMsg = searchQ ? t('news.searchEmpty') : t('news.empty');
    list.innerHTML = pageDocs.length
      ? pageDocs
          .map((p) =>
            renderNewsCard(p, {
              list: true,
              viewCount: viewMap[p.id] || 0,
              categoryMap
            })
          )
          .join('')
      : `<p class="muted">${escapeHtml(emptyMsg)}</p>`;
    list.classList.add('kb-news-list', 'kb-news-list--grid');
    const paginationHtml = renderNewsPagination(safePage, totalPages, cat, searchQ);
    if (paginationHtml) {
      if (!pager) {
        pager = document.createElement('nav');
        pager.id = 'newsPagination';
        pager.className = 'kb-news-pagination';
        list.insertAdjacentElement('afterend', pager);
      }
      pager.outerHTML = paginationHtml;
      pager = document.getElementById('newsPagination');
      if (pager) pager.removeAttribute('aria-hidden');
    } else if (pager) {
      pager.innerHTML = '';
      pager.classList.add('kb-news-pagination--empty');
      pager.setAttribute('aria-hidden', 'true');
    }
    if (safePage !== page) {
      history.replaceState(null, '', buildNewsListUrl(safePage, cat, searchQ));
    }
  } catch (e) {
    list.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
    if (pager) {
      pager.innerHTML = '';
      pager.classList.add('kb-news-pagination--empty');
      pager.setAttribute('aria-hidden', 'true');
    }
  }
}

async function initPost() {
  await loadSiteName();

  const id = getPostIdFromLocation();
  const titleEl = document.getElementById('postTitle');
  const metaEl = document.getElementById('postMeta');
  const bodyEl = document.getElementById('postBody');
  const heroEl = document.getElementById('postHero');

  if (!id) {
    CmsLayout.initCmsShell({
      activeNav: 'news',
      bodyClass: 'kb-site',
      pageTitle: escapeHtml(t('misc.notFound'))
    });
    bodyEl.innerHTML = `<p class="muted">${t('misc.notFound')}</p>`;
    titleEl.textContent = t('misc.notFound');
    return;
  }

  try {
    const doc = await db.collection('cms_posts').doc(String(id)).get();
    if (!doc.exists) {
      CmsLayout.initCmsShell({
        activeNav: 'news',
        bodyClass: 'kb-site',
        pageTitle: escapeHtml(t('misc.notFound'))
      });
      bodyEl.innerHTML = `<p class="muted">${t('misc.notFound')}</p>`;
      titleEl.textContent = t('misc.notFound');
      return;
    }
    const d = doc.data();
    const catLabel = await getPostNewsCategoryLabel(d.categoryIds);
    const bannerTitle = catLabel || t('nav.news');
    CmsLayout.initCmsShell({
      activeNav: 'news',
      navNewsLabel: catLabel || '',
      bodyClass: 'kb-site',
      pageTitle: escapeHtml(bannerTitle)
    });

    const titleText = decodeHtmlEntities(d.title || '');
    titleEl.textContent = titleText;
    document.title = titleText + ' — ' + siteTabTitle();
    const views = await trackPostView(doc.id);
    metaEl.innerHTML = `<span class="kb-article-meta-date">${formatDate(d.publishedAt)}</span>${renderViewBadge(views)}`;
    if (history.replaceState) history.replaceState(null, '', postUrl(doc.id));
    bodyEl.innerHTML = d.contentHtml || '';
    bodyEl.classList.add('kb-prose');
    rewriteContentLinks(bodyEl);
    enhancePostContent(bodyEl);
    if (d.featuredImageUrl && heroEl) {
      heroEl.innerHTML = `<img src="${escapeHtml(d.featuredImageUrl)}" alt="">`;
    }
    const desc =
      (window.CmsSocial && CmsSocial.stripHtml(d.contentHtml || '').slice(0, 200)) ||
      (window.CMS_SITE && CMS_SITE.og && CMS_SITE.og.description) ||
      '';
    applyPageSocial({
      title: titleText || siteTabTitle(),
      documentTitle: titleText + ' — ' + siteTabTitle(),
      description: desc,
      image:
        d.featuredImageUrl ||
        (window.CmsSocial && CmsSocial.firstImgFromHtml(d.contentHtml)) ||
        (window.CmsSocial && CmsSocial.defaultImage()),
      url: location.origin.replace(/\/$/, '') + postUrl(doc.id),
      type: 'article'
    });
  } catch (e) {
    CmsLayout.initCmsShell({
      activeNav: 'news',
      bodyClass: 'kb-site',
      pageTitle: escapeHtml(t('nav.news'))
    });
    bodyEl.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
  }
}

const AGENDA_PAGE_ID = '13575';
const DOWNLOAD_PAGE_ID = '7934';
const ABOUT_PAGE_ID = '241';
const TEAM_PAGE_ID = '420';
const MANAGEMENT_PAGE_ID = '8929';
const CONTACT_PAGE_ID = '354';
const PAYMENT_PAGE_ID = '9304';
const APP_PAGE_ID = '9208';
const FAQ_PAGE_ID = '294';
const TERMS_PAGE_ID = '525';
const PRIVACY_PAGE_ID = '3';

function stripTagsPlain(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function initPaymentPage(main) {
  main.innerHTML = CmsLayout.renderLoading();
  try {
    const page = await fetchPageHtml(PAYMENT_PAGE_ID);
    const headTitle = t('nav.payment') || 'แจ้งโอนเงิน';
    const docTitle = stripTagsPlain(page.title) || headTitle;
    document.title = docTitle + ' — ' + siteTabTitle();
    CmsLayout.setPageTitle(escapeHtml(headTitle), '');
    main.innerHTML = window.CmsPaymentPage
      ? CmsPaymentPage.renderPaymentPage()
      : page.html;
    if (location.pathname.match(/^\/page\/9304\/?$/i)) {
      history.replaceState(null, '', '/infrom-payment');
    }
    CmsI18n?.applyTranslations();
    window.CmsPaymentPage?.bindPaymentForm(main);
    bindPageAnchors(main);
    applyPageSocial({
      title: docTitle,
      documentTitle: docTitle + ' — ' + siteTabTitle(),
      description: t('payment.intro') || (window.CMS_SITE && CMS_SITE.og && CMS_SITE.og.description),
      image: window.CmsSocial && CmsSocial.defaultImage(),
      url: location.href
    });
  } catch (e) {
    main.innerHTML = `<p class="error text-center">${escapeHtml(e.message)}</p>`;
  }
}

async function initContactPage(main) {
  main.innerHTML = CmsLayout.renderLoading();
  try {
    const page = await fetchPageHtml(CONTACT_PAGE_ID);
    const title = page.title || t('nav.contact') || 'ติดต่อเรา';
    document.title = title + ' — ' + siteTabTitle();
    CmsLayout.setPageTitle(escapeHtml(title), '');
    main.innerHTML = window.CmsContactPage
      ? CmsContactPage.renderContactPage()
      : page.html;
    if (location.pathname.match(/^\/page\/354\/?$/i)) {
      history.replaceState(null, '', '/contact');
    }
    CmsI18n?.applyTranslations();
    window.CmsContactPage?.bindContactForm(main);
    window.CmsContactPage?.bindContactLang(main);
    bindPageAnchors(main);
    applyPageSocial({
      title: page.title || t('nav.contact'),
      documentTitle: title + ' — ' + siteTabTitle(),
      description: t('contact.intro') || (window.CMS_SITE && CMS_SITE.og && CMS_SITE.og.description),
      image: window.CmsSocial && CmsSocial.defaultImage(),
      url: location.href
    });
  } catch (e) {
    main.innerHTML = `<p class="error text-center">${escapeHtml(e.message)}</p>`;
  }
}

async function initDownloadPage(main) {
  main.innerHTML = CmsLayout.renderLoading();
  try {
    const page = await fetchPageHtml(DOWNLOAD_PAGE_ID);
    const title = page.title || t('nav.download') || 'ดาวน์โหลด';
    document.title = title + ' — ' + siteTabTitle();
    CmsLayout.setPageTitle(escapeHtml(title), '');
    const sections = window.CmsDownloadPage
      ? CmsDownloadPage.parseDownloadSections(page.html)
      : [];
    const downloadIds = sections.flatMap((s) => s.items.map((it) => it.id)).filter(Boolean);
    const downloadCounts = window.CmsCounters
      ? await CmsCounters.fetchMap('cms_download_counts', downloadIds)
      : {};
    main.innerHTML = window.CmsDownloadPage
      ? CmsDownloadPage.renderDownloadTable(sections, downloadCounts)
      : page.html;
    if (location.pathname.match(/^\/page\/7934\/?$/i)) {
      history.replaceState(null, '', '/download');
    }
    CmsI18n?.applyTranslations();
    window.CmsDownloadPage?.bindDownloadButtons(main);
    bindPageAnchors(main);
    socialFromPage(page, location.pathname);
  } catch (e) {
    main.innerHTML = `<p class="error text-center">${escapeHtml(e.message)}</p>`;
  }
}

async function initAboutPage(main) {
  main.innerHTML = CmsLayout.renderLoading();
  try {
    const page = await fetchPageHtml(ABOUT_PAGE_ID);
    const title = page.title || t('nav.aboutUs') || 'เกี่ยวกับสหกรณ์';
    document.title = title + ' — ' + siteTabTitle();
    CmsLayout.setPageTitle(escapeHtml(title), '');
    const data = window.CmsAboutPage
      ? CmsAboutPage.parseAboutPage(page.html)
      : { hero: null, tables: [] };
    main.innerHTML = window.CmsAboutPage
      ? CmsAboutPage.renderAboutPage(data)
      : page.html;
    if (location.pathname.match(/^\/page\/241\/?$/i)) {
      history.replaceState(null, '', '/about-us');
    }
    CmsI18n?.applyTranslations();
    window.CmsAboutPage?.bindAboutPage(main);
    bindPageAnchors(main);
    socialFromPage(page, '/about-us');
  } catch (e) {
    main.innerHTML = `<p class="error text-center">${escapeHtml(e.message)}</p>`;
  }
}

async function initTeamPage(main) {
  main.innerHTML = CmsLayout.renderLoading();
  try {
    const page = await fetchPageHtml(TEAM_PAGE_ID);
    const title = t('nav.team') || 'คณะกรรมการสหกรณ์';
    document.title = title + ' — ' + siteTabTitle();
    CmsLayout.setPageTitle(escapeHtml(title), '');
    if (window.CmsTeamPage) {
      await CmsTeamPage.initTeamPage(main);
    } else {
      main.innerHTML = `<p class="error text-center">ไม่พบโมดูลหน้าคณะกรรมการ</p>`;
    }
    if (location.pathname.match(/^\/page\/420\/?$/i)) {
      history.replaceState(null, '', '/team');
    }
    CmsI18n?.applyTranslations();
    bindPageAnchors(main);
  } catch (e) {
    main.innerHTML = `<p class="error text-center">${escapeHtml(e.message)}</p>`;
  }
}

async function initManagementPage(main) {
  main.innerHTML = CmsLayout.renderLoading();
  try {
    const title = t('nav.management') || 'ทำเนียบฝ่ายจัดการ';
    document.title = title + ' — ' + siteTabTitle();
    CmsLayout.setPageTitle(escapeHtml(title), '');
    if (window.CmsManagementPage) {
      await CmsManagementPage.initManagementPage(main);
    } else {
      main.innerHTML = `<p class="error text-center">ไม่พบโมดูลหน้าทำเนียบฝ่ายจัดการ</p>`;
    }
    if (location.pathname.match(/^\/page\/8929\/?$/i)) {
      history.replaceState(null, '', '/management');
    }
    CmsI18n?.applyTranslations();
    bindPageAnchors(main);
  } catch (e) {
    main.innerHTML = `<p class="error text-center">${escapeHtml(e.message)}</p>`;
  }
}

function legalT(key) {
  return window.CmsI18n ? CmsI18n.t(`legal.${key}`) : key;
}

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function ensureLegalScripts() {
  if (window.CmsLegalPage) return;
  await loadScriptOnce('/legal-content.js?v=4');
  await loadScriptOnce('/legal-pages.js?v=6');
}

async function initFaqPage(main) {
  main.innerHTML = CmsLayout.renderLoading();
  try {
    const title = legalT('faqTitle') || t('nav.faq') || 'คำถามที่พบบ่อย';
    const subtitle = legalT('faqSubtitle') || '';
    document.title = title + ' — ' + siteTabTitle();
    CmsLayout.setPageTitle(escapeHtml(title), escapeHtml(subtitle));
    main.innerHTML = window.CmsLegalPage
      ? CmsLegalPage.renderFaqPage()
      : '';
    if (location.pathname.match(/^\/page\/294\/?$/i)) {
      history.replaceState(null, '', '/faq');
    }
    CmsI18n?.applyTranslations();
    window.CmsLegalPage?.bindLegalPage(main, 'faq');
    applyPageSocial({
      title,
      documentTitle: title + ' — ' + siteTabTitle(),
      description: legalPackIntro('faq') || (window.CMS_SITE && CMS_SITE.og && CMS_SITE.og.description),
      image: window.CmsSocial && CmsSocial.defaultImage(),
      url: location.origin.replace(/\/$/, '') + '/faq'
    });
  } catch (e) {
    main.innerHTML = `<p class="error text-center">${escapeHtml(e.message)}</p>`;
  }
}

function legalPackIntro(type) {
  const lang = window.CmsI18n?.getLang() || 'th';
  const pack = window.CMS_LEGAL_CONTENT?.[type]?.[lang] || window.CMS_LEGAL_CONTENT?.[type]?.th;
  return pack?.intro || '';
}

async function initTermsPage(main) {
  main.innerHTML = CmsLayout.renderLoading();
  try {
    const title = legalT('termsTitle') || t('nav.terms') || 'ข้อกำหนดและเงื่อนไข';
    const subtitle = legalT('termsSubtitle') || '';
    document.title = title + ' — ' + siteTabTitle();
    CmsLayout.setPageTitle(escapeHtml(title), escapeHtml(subtitle));
    main.innerHTML = window.CmsLegalPage ? CmsLegalPage.renderTermsPage() : '';
    if (location.pathname.match(/^\/page\/525\/?$/i)) {
      history.replaceState(null, '', '/terms');
    }
    CmsI18n?.applyTranslations();
    window.CmsLegalPage?.bindLegalPage(main, 'terms');
    applyPageSocial({
      title,
      documentTitle: title + ' — ' + siteTabTitle(),
      description: legalPackIntro('terms') || (window.CMS_SITE && CMS_SITE.og && CMS_SITE.og.description),
      image: window.CmsSocial && CmsSocial.defaultImage(),
      url: location.origin.replace(/\/$/, '') + '/terms'
    });
  } catch (e) {
    main.innerHTML = `<p class="error text-center">${escapeHtml(e.message)}</p>`;
  }
}

async function initPrivacyPage(main) {
  main.innerHTML = CmsLayout.renderLoading();
  try {
    const title = legalT('privacyTitle') || t('nav.privacy') || 'นโยบายความเป็นส่วนตัว';
    const subtitle = legalT('privacySubtitle') || '';
    document.title = title + ' — ' + siteTabTitle();
    CmsLayout.setPageTitle(escapeHtml(title), escapeHtml(subtitle));
    main.innerHTML = window.CmsLegalPage ? CmsLegalPage.renderPrivacyPage() : '';
    if (location.pathname.match(/^\/page\/3\/?$/i) || location.pathname === '/pdpa') {
      history.replaceState(null, '', '/privacy-policy');
    }
    CmsI18n?.applyTranslations();
    window.CmsLegalPage?.bindLegalPage(main, 'privacy');
    applyPageSocial({
      title,
      documentTitle: title + ' — ' + siteTabTitle(),
      description: legalPackIntro('privacy') || (window.CMS_SITE && CMS_SITE.og && CMS_SITE.og.description),
      image: window.CmsSocial && CmsSocial.defaultImage(),
      url: location.origin.replace(/\/$/, '') + '/privacy-policy'
    });
  } catch (e) {
    main.innerHTML = `<p class="error text-center">${escapeHtml(e.message)}</p>`;
  }
}

async function initAppPage(main) {
  main.innerHTML = CmsLayout.renderLoading();
  try {
    const page = await fetchPageHtml(APP_PAGE_ID);
    const title = appT('pageTitle') || page.title || 'NKBKConnext';
    const subtitle = appT('pageSubtitle') || '';
    const docTitle = stripTagsPlain(page.title) || title;
    document.title = docTitle + ' — ' + siteTabTitle();
    CmsLayout.setPageTitle(escapeHtml(title), escapeHtml(subtitle));
    main.innerHTML = window.CmsAppPage
      ? CmsAppPage.renderAppGuidePage()
      : page.html;
    if (location.pathname.match(/^\/page\/9208\/?$/i)) {
      history.replaceState(null, '', '/app');
    }
    CmsI18n?.applyTranslations();
    window.CmsAppPage?.bindAppGuidePage(main);
    bindPageAnchors(main);
    applyPageSocial({
      title: stripTagsPlain(page.title) || title,
      documentTitle: (stripTagsPlain(page.title) || title) + ' — ' + siteTabTitle(),
      description: subtitle || t('home.appDesc') || (window.CMS_SITE && CMS_SITE.og && CMS_SITE.og.description),
      image: window.CmsSocial && CmsSocial.defaultImage(),
      url: location.origin.replace(/\/$/, '') + '/app'
    });
  } catch (e) {
    main.innerHTML = `<p class="error text-center">${escapeHtml(e.message)}</p>`;
  }
}

function appT(key) {
  return window.CmsI18n ? CmsI18n.t(`appPage.${key}`) : key;
}

async function initAgendaPage(main) {
  main.innerHTML = CmsLayout.renderLoading();
  try {
    const page = await fetchPageHtml(AGENDA_PAGE_ID);
    const title =
      page.title || t('nav.agenda') || 'วาระและรายงานการประชุม';
    document.title = title + ' — ' + siteTabTitle();
    CmsLayout.setPageTitle(escapeHtml(title), '');
    const meetings = window.CmsAgendaPage
      ? CmsAgendaPage.parseAgendaMeetings(page.html)
      : [];
    main.innerHTML = window.CmsAgendaPage
      ? CmsAgendaPage.renderAgendaPage(meetings)
      : page.html;
    CmsI18n?.applyTranslations();
    window.CmsAgendaPage?.bindAgendaDownloadButtons(main);
    bindPageAnchors(main);
  } catch (e) {
    main.innerHTML = `<p class="error text-center">${escapeHtml(e.message)}</p>`;
  }
}

async function initStaticPage() {
  const pageId = getPageIdFromLocation();
  const activeNav = CmsLayout.activeNavForPageId(pageId);
  const isAgenda = String(pageId) === AGENDA_PAGE_ID;
  const isDownload = String(pageId) === DOWNLOAD_PAGE_ID;
  const isAbout = String(pageId) === ABOUT_PAGE_ID;
  const isTeam = String(pageId) === TEAM_PAGE_ID;
  const isManagement = String(pageId) === MANAGEMENT_PAGE_ID;
  const isContact = String(pageId) === CONTACT_PAGE_ID;
  const isPayment = String(pageId) === PAYMENT_PAGE_ID;
  const isApp = String(pageId) === APP_PAGE_ID;
  const isFaq = String(pageId) === '294';
  const isTerms = String(pageId) === '525';
  const isPrivacy = String(pageId) === '3';
  CmsLayout.initCmsShell({
    activeNav,
    bodyClass: isAgenda
      ? 'kb-site kb-page kb-page--agenda'
      : isDownload
        ? 'kb-site kb-page kb-page--download'
        : isAbout
          ? 'kb-site kb-page kb-page--about'
          : isTeam
            ? 'kb-site kb-page kb-page--team'
            : isManagement
              ? 'kb-site kb-page kb-page--management'
              : isContact
                ? 'kb-site kb-page kb-page--contact'
                : isPayment
                  ? 'kb-site kb-page kb-page--payment'
                  : isApp
                    ? 'kb-site kb-page kb-page--app'
                    : isFaq
                      ? 'kb-site kb-page kb-page--faq'
                      : isTerms
                        ? 'kb-site kb-page kb-page--terms'
                        : isPrivacy
                          ? 'kb-site kb-page kb-page--privacy'
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

  if (isAbout && window.CmsAboutPage) {
    await initAboutPage(main);
    return;
  }

  if (isTeam && window.CmsTeamPage) {
    await initTeamPage(main);
    return;
  }

  if (isManagement && window.CmsManagementPage) {
    await initManagementPage(main);
    return;
  }

  if (isContact && window.CmsContactPage) {
    await initContactPage(main);
    return;
  }

  if (isPayment && window.CmsPaymentPage) {
    await initPaymentPage(main);
    return;
  }

  if (isApp && window.CmsAppPage) {
    await initAppPage(main);
    return;
  }

  if (isFaq || isTerms || isPrivacy) {
    try {
      await ensureLegalScripts();
    } catch (e) {
      console.warn('legal scripts', e);
    }
    if (window.CmsLegalPage) {
      if (isFaq) {
        await initFaqPage(main);
        return;
      }
      if (isTerms) {
        await initTermsPage(main);
        return;
      }
      if (isPrivacy) {
        await initPrivacyPage(main);
        return;
      }
    }
    main.innerHTML = `<p class="error text-center">${escapeHtml(t('misc.loading'))}</p>`;
    return;
  }

  main.innerHTML = CmsLayout.renderLoading();
  loadElementorPageCss(pageId);
  try {
    const page = await fetchPageHtml(pageId);
    if (page.title) {
      document.title = page.title + ' — ' + siteTabTitle();
      CmsLayout.setPageTitle(escapeHtml(page.title), '');
    }
    main.innerHTML = `
<div class="kb-page-body">
  <div class="kb-container">
    <article class="kb-article kb-prose kb-wp-content elementor">${page.html}</article>
  </div>
</div>`;
    rewriteContentLinks(main);
    enhancePostContent(main);
    bindPageAnchors(main);
    socialFromPage(page, location.pathname);
  } catch (e) {
    main.innerHTML = `<p class="error text-center">${escapeHtml(e.message)}</p>`;
  }
}
