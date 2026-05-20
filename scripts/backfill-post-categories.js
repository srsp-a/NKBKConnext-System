/**
 * อัปเดต categoryIds ใน cms_posts จาก WP (เร็ว — ไม่โหลดรูป/HTML ใหม่)
 *   node scripts/backfill-post-categories.js
 */
const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
const https = require('https');

const saPath = path.join(__dirname, '..', 'firebase-service-account.json');
const WP_BASE = process.env.WP_BASE_URL || 'https://nkbkcoop.com';

if (!require('fs').existsSync(saPath)) {
  console.error('ไม่พบ', saPath);
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(require(saPath)) });
const db = admin.firestore();

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'NKBK-CMS-Migrate/1.0' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        if (body.trimStart().startsWith('<')) return reject(new Error('HTML response'));
        resolve(JSON.parse(body));
      });
    }).on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  let page = 1;
  let updated = 0;
  while (true) {
    const url = `${WP_BASE}/wp-json/wp/v2/posts?per_page=100&page=${page}&status=publish&_fields=id,categories`;
    const batch = await fetchJson(url);
    if (!Array.isArray(batch) || !batch.length) break;
    for (const p of batch) {
      const categoryIds = Array.isArray(p.categories) ? p.categories.map(Number) : [];
      await db.collection('cms_posts').doc(String(p.id)).set({ categoryIds }, { merge: true });
      updated += 1;
    }
    console.log(`page ${page} (+${batch.length}), total ${updated}`);
    if (batch.length < 100) break;
    page += 1;
    await sleep(500);
  }
  console.log('Done. Updated', updated, 'posts');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
