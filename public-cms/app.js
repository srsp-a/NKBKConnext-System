function formatDate(ts) {
  if (!ts || !ts.toDate) return '';
  return ts.toDate().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** URL สั้น: /n/146 */
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

function renderCard(post) {
  const id = post.id;
  const data = post.data();
  const href = postUrl(id);
  const img = data.featuredImageUrl
    ? `<img src="${data.featuredImageUrl}" alt="" loading="lazy" />`
    : '<div class="thumb-placeholder"></div>';
  return `
    <article class="card">
      <a href="${href}" class="card-link">
        ${img}
        <div class="card-body">
          <time>${formatDate(data.publishedAt)}</time>
          <h3>${escapeHtml(data.title || '')}</h3>
          <p>${escapeHtml(data.excerpt || '')}</p>
        </div>
      </a>
    </article>`;
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

/** แสดง PDF ในหน้า ไม่เปิดแท็บใหม่ */
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
    iframe.title = (a.textContent || 'PDF').trim() || 'เอกสาร PDF';
    iframe.loading = 'lazy';
    wrap.appendChild(iframe);

    const parent = a.parentElement;
    if (parent && parent.tagName === 'P' && parent.childNodes.length === 1) {
      parent.replaceWith(wrap);
    } else {
      a.replaceWith(wrap);
    }
  });

  root.querySelectorAll('iframe[src], embed[src], object[data]').forEach((el) => {
    const src = el.getAttribute('src') || el.getAttribute('data') || '';
    if (!isPdfUrl(src)) return;
    const box = el.closest('.pdf-viewer') || document.createElement('div');
    if (!box.classList.contains('pdf-viewer')) {
      box.className = 'pdf-viewer';
      el.parentNode.insertBefore(box, el);
      box.appendChild(el);
    }
    if (el.tagName === 'IFRAME' && !el.src.includes('#')) {
      el.src = el.src + '#view=FitH';
    }
  });
}

async function loadSiteName() {
  try {
    const snap = await db.collection('cms_site').doc('settings').get();
    if (snap.exists && snap.data().siteName) {
      const el = document.getElementById('siteName');
      if (el) el.textContent = snap.data().siteName;
      document.title = snap.data().siteName;
    }
  } catch (e) {
    console.warn('cms_site', e);
  }
}

async function fetchPosts(limit) {
  const snap = await db
    .collection('cms_posts')
    .orderBy('publishedAt', 'desc')
    .limit(limit)
    .get();
  return snap.docs;
}

async function initHome() {
  await loadSiteName();
  const list = document.getElementById('newsList');
  if (!list) return;
  try {
    const docs = await fetchPosts(6);
    if (!docs.length) {
      list.innerHTML = '<p class="muted">ยังไม่มีข่าว — รัน scripts/migrate-wordpress-cms.js</p>';
      return;
    }
    list.innerHTML = docs.map(renderCard).join('');
  } catch (e) {
    list.innerHTML = `<p class="error">โหลดข่าวไม่สำเร็จ: ${escapeHtml(e.message)}</p>`;
  }
}

async function initNewsList() {
  await loadSiteName();
  const list = document.getElementById('newsList');
  if (!list) return;
  try {
    const docs = await fetchPosts(300);
    if (!docs.length) {
      list.innerHTML = '<p class="muted">ยังไม่มีข่าว</p>';
      return;
    }
    list.innerHTML = docs.map(renderCard).join('');
  } catch (e) {
    list.innerHTML = `<p class="error">โหลดข่าวไม่สำเร็จ: ${escapeHtml(e.message)}</p>`;
  }
}

async function initPost() {
  await loadSiteName();
  const id = getPostIdFromLocation();
  const titleEl = document.getElementById('postTitle');
  const metaEl = document.getElementById('postMeta');
  const bodyEl = document.getElementById('postBody');

  if (!id) {
    bodyEl.innerHTML = '<p class="muted">ไม่พบข่าวนี้</p>';
    titleEl.textContent = 'ไม่พบข่าว';
    return;
  }

  try {
    const doc = await db.collection('cms_posts').doc(String(id)).get();
    if (!doc.exists) {
      bodyEl.innerHTML = '<p class="muted">ไม่พบข่าวนี้</p>';
      titleEl.textContent = 'ไม่พบข่าว';
      return;
    }
    const d = doc.data();
    titleEl.textContent = d.title || '';
    document.title = (d.title || 'ข่าว') + ' — สหกรณ์หนองคาย';
    metaEl.textContent = formatDate(d.publishedAt);
    if (history.replaceState) {
      history.replaceState(null, '', postUrl(doc.id));
    }
    bodyEl.innerHTML = d.contentHtml || '<p class="muted">ไม่มีเนื้อหา</p>';
    enhancePostContent(bodyEl);
    if (d.featuredImageUrl) {
      document.getElementById('postHero').innerHTML =
        `<img src="${d.featuredImageUrl}" alt="" />`;
    }
  } catch (e) {
    bodyEl.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
  }
}
