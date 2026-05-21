/**
 * ย้ายข่าว/หน้าจาก WordPress REST API → Firestore + ไฟล์ไป Storage
 *
 *   node scripts/migrate-wordpress-cms.js --all --posts-only
 *   node scripts/migrate-wordpress-cms.js --limit=50
 *   node scripts/migrate-wordpress-cms.js --dry-run --all --posts-only
 */
const path = require('path');
const crypto = require('crypto');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
const https = require('https');
const http = require('http');
const { URL } = require('url');

const root = path.join(__dirname, '..');
const saPath = path.join(root, 'firebase-service-account.json');
const WP_BASE = process.env.WP_BASE_URL || 'https://nkbkcoop.com';
const STORAGE_PREFIX = 'cms/wp';

const args = process.argv.slice(2);
const migrateAll = args.includes('--all');
const limitArg = args.find((a) => a.startsWith('--limit='));
const LIMIT = migrateAll ? Infinity : (limitArg ? parseInt(limitArg.split('=')[1], 10) : 50);
const postsOnly = args.includes('--posts-only');
const pagesOnly = args.includes('--pages-only');
const dryRun = args.includes('--dry-run');

if (!require('fs').existsSync(saPath)) {
  console.error('ไม่พบ', saPath);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(saPath)),
  storageBucket: 'admin-panel-nkbkcoop-cbf10.firebasestorage.app'
});

const db = admin.firestore();
const bucket = admin.storage().bucket();
const mediaCache = new Map();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'NKBK-CMS-Migrate/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} ${url}: ${body.slice(0, 200)}`));
        }
        if (body.trimStart().startsWith('<')) {
          return reject(new Error(`Non-JSON (HTML) from ${url}`));
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function fetchJsonRetry(url, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fetchJson(url);
    } catch (e) {
      last = e;
      if (i < tries - 1) await sleep(1500 * (i + 1));
    }
  }
  throw last;
}

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'NKBK-CMS-Migrate/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadBuffer(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`download ${res.statusCode} ${url}`));
        resolve({
          buffer: Buffer.concat(chunks),
          contentType: res.headers['content-type'] || 'application/octet-stream'
        });
      });
    }).on('error', reject);
  });
}

function isPdfUrl(url) {
  try {
    return /\.pdf(\?|#|$)/i.test(new URL(url).pathname);
  } catch {
    return /\.pdf/i.test(url);
  }
}

async function migrateMediaUrl(originalUrl) {
  if (!originalUrl || !originalUrl.startsWith('http')) return originalUrl;
  if (mediaCache.has(originalUrl)) return mediaCache.get(originalUrl);

  try {
    const u = new URL(originalUrl);
    if (!u.hostname.includes('nkbkcoop.com')) {
      mediaCache.set(originalUrl, originalUrl);
      return originalUrl;
    }
    const hash = crypto.createHash('md5').update(originalUrl).digest('hex').slice(0, 16);
    let ext = path.extname(u.pathname).toLowerCase();
    if (!ext && /\.pdf(\?|#|$)/i.test(originalUrl)) ext = '.pdf';
    const dest = `${STORAGE_PREFIX}/media/${hash}${ext}`;
    if (dryRun) {
      const fake = `https://storage.googleapis.com/${bucket.name}/${dest}`;
      mediaCache.set(originalUrl, fake);
      return fake;
    }
    const { buffer, contentType } = await downloadBuffer(originalUrl);
    let finalDest = dest;
    if (!path.extname(dest) && contentType && contentType.includes('pdf')) {
      finalDest = `${dest}.pdf`;
    }
    const file = bucket.file(finalDest);
    await file.save(buffer, { metadata: { contentType, cacheControl: 'public,max-age=31536000' } });
    await file.makePublic();
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${finalDest}`;
    mediaCache.set(originalUrl, publicUrl);
    return publicUrl;
  } catch (e) {
    console.warn('  [media skip]', originalUrl.slice(0, 80), e.message);
    mediaCache.set(originalUrl, originalUrl);
    return originalUrl;
  }
}

function pdfViewerHtml(url, title) {
  const safe = url.replace(/"/g, '&quot;');
  const t = (title || 'เอกสาร PDF').replace(/"/g, '');
  return `<div class="pdf-viewer pdf-viewer--a4"><iframe src="${safe}#page=1&view=Fit" title="${t}" loading="lazy"></iframe></div>`;
}

function embedPdfLinksInHtml(html) {
  if (!html) return html;
  html = html.replace(
    /<a\s+[^>]*class=["'][^"']*pdfemb[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/gi,
    (_m, url) => pdfViewerHtml(url, '')
  );
  html = html.replace(
    /<a\s+[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*pdfemb[^"']*["'][^>]*>[\s\S]*?<\/a>/gi,
    (_m, url) => pdfViewerHtml(url, '')
  );
  html = html.replace(
    /<a\s+[^>]*href=["']([^"']+\.pdf[^"']*)["'][^>]*>[\s\S]*?<\/a>/gi,
    (_m, url) => {
      const inner = _m.match(/>([\s\S]*?)<\/a>/i);
      const title = inner ? inner[1].replace(/<[^>]+>/g, '').trim() : '';
      return pdfViewerHtml(url, title);
    }
  );
  return html;
}

async function rewriteHtmlContent(html) {
  if (!html) return html;
  const urls = new Set();
  const re = /(?:src|href|data)=["'](https?:\/\/[^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) urls.add(m[1]);

  let out = html;
  for (const url of urls) {
    const nu = await migrateMediaUrl(url);
    out = out.split(url).join(nu);
  }
  out = embedPdfLinksInHtml(out);
  return out;
}

function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchAllWp(type) {
  if (type === 'pages') {
    const ids = [];
    let page = 1;
    const perPage = 10;
    while (true) {
      const url = `${WP_BASE}/wp-json/wp/v2/pages?per_page=${perPage}&page=${page}&status=publish&_fields=id`;
      const batch = await fetchJsonRetry(url);
      if (!Array.isArray(batch) || batch.length === 0) break;
      ids.push(...batch.map((p) => p.id));
      console.log(`[WP pages] list ${page} (+${batch.length})`);
      if (batch.length < perPage) break;
      page += 1;
      await sleep(400);
    }
    console.log(`[WP pages] fetching ${ids.length} pages by id...`);
    const items = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      try {
        const item = await fetchJsonRetry(`${WP_BASE}/wp-json/wp/v2/pages/${id}`);
        items.push(item);
      } catch (e) {
        console.warn(`[WP pages] skip id ${id}:`, e.message);
      }
      if ((i + 1) % 5 === 0) console.log(`[WP pages] detail ${i + 1}/${ids.length}`);
      await sleep(350);
    }
    return Number.isFinite(LIMIT) ? items.slice(0, LIMIT) : items;
  }

  const items = [];
  let page = 1;
  const perPage = 100;
  let totalPages = null;

  while (true) {
    if (Number.isFinite(LIMIT) && items.length >= LIMIT) break;
    const url = `${WP_BASE}/wp-json/wp/v2/${type}?per_page=${perPage}&page=${page}&status=publish`;
    const batch = await fetchJsonRetry(url);
    if (!Array.isArray(batch) || batch.length === 0) break;
    items.push(...batch);
    if (totalPages == null && page === 1) {
      try {
        const headUrl = `${WP_BASE}/wp-json/wp/v2/${type}?per_page=1&page=1&status=publish`;
        await new Promise((resolve, reject) => {
          https.get(headUrl, { headers: { 'User-Agent': 'NKBK-CMS-Migrate/1.0' } }, (res) => {
            totalPages = parseInt(res.headers['x-wp-totalpages'] || '0', 10);
            const total = res.headers['x-wp-total'];
            if (total) console.log(`[WP ${type}] total ~${total} posts, ${totalPages} pages`);
            res.resume();
            resolve();
          }).on('error', reject);
        });
      } catch (_) { /* ignore */ }
    }
    console.log(`[WP ${type}] page ${page}${totalPages ? '/' + totalPages : ''} (+${batch.length})`);
    if (batch.length < perPage) break;
    page += 1;
    if (totalPages && page > totalPages) break;
  }

  return Number.isFinite(LIMIT) ? items.slice(0, LIMIT) : items;
}

async function saveItem(collection, item, kind) {
  const id = String(item.id);
  const title = item.title?.rendered || '';
  const slug = item.slug || id;
  let contentHtml = item.content?.rendered || '';
  contentHtml = await rewriteHtmlContent(contentHtml);

  let featuredImageUrl = '';
  if (item.featured_media) {
    try {
      const media = await fetchJson(`${WP_BASE}/wp-json/wp/v2/media/${item.featured_media}`);
      if (media?.source_url) featuredImageUrl = await migrateMediaUrl(media.source_url);
    } catch (e) {
      console.warn('  featured_media', id, e.message);
    }
  }

  const categoryIds = Array.isArray(item.categories) ? item.categories.map(Number) : [];

  const doc = {
    wpId: item.id,
    kind,
    slug,
    title,
    excerpt: stripHtml(item.excerpt?.rendered || '').slice(0, 500),
    contentHtml,
    featuredImageUrl,
    link: item.link || '',
    status: item.status || 'publish',
    categoryIds,
    publishedAt: item.date_gmt ? admin.firestore.Timestamp.fromDate(new Date(item.date_gmt + 'Z')) : null,
    modifiedAt: item.modified_gmt ? admin.firestore.Timestamp.fromDate(new Date(item.modified_gmt + 'Z')) : null,
    migratedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  if (dryRun) {
    console.log(`[dry-run] ${collection}/${id}`, title.slice(0, 60));
    return;
  }
  await db.collection(collection).doc(id).set(doc, { merge: true });
  console.log(`[OK] ${collection}/${id}`, title.slice(0, 60));
}

async function migrateCategories() {
  const cats = await fetchJson(`${WP_BASE}/wp-json/wp/v2/categories?per_page=100`);
  if (!Array.isArray(cats)) return;
  for (const c of cats) {
    const doc = { wpId: c.id, name: c.name, slug: c.slug, count: c.count };
    if (!dryRun) await db.collection('cms_categories').doc(String(c.id)).set(doc, { merge: true });
    console.log('[cat]', c.name);
  }
}

async function main() {
  const limitLabel = migrateAll ? 'ALL' : String(LIMIT);
  console.log('WP_BASE:', WP_BASE, '| limit:', limitLabel, dryRun ? '(dry-run)' : '');
  await migrateCategories();

  let migratedPostCount = 0;
  if (!pagesOnly) {
    console.log('\n--- Posts ---');
    const posts = await fetchAllWp('posts');
    console.log(`Migrating ${posts.length} posts...`);
    migratedPostCount = posts.length;
    let n = 0;
    for (const p of posts) {
      n += 1;
      if (n % 10 === 0) console.log(`--- progress ${n}/${posts.length} ---`);
      await saveItem('cms_posts', p, 'post');
    }
  }

  if (!postsOnly) {
    console.log('\n--- Pages ---');
    const pages = await fetchAllWp('pages');
    for (const p of pages) {
      try {
        await saveItem('cms_pages', p, 'page');
      } catch (e) {
        console.warn('[page save skip]', p.id, e.message);
      }
    }
  }

  if (!dryRun) {
    await db.collection('cms_site').doc('settings').set({
      siteName: 'สหกรณ์ออมทรัพย์สาธารณสุขหนองคาย จำกัด',
      wpSource: WP_BASE,
      lastMigrationAt: admin.firestore.FieldValue.serverTimestamp(),
      migratedPostCount
    }, { merge: true });
  }

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
