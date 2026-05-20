/**
 * เพิ่มประกาศ/ข่าวใน Firestore + อัปโหลด PDF ไป Storage
 *
 *   node scripts/add-cms-announcement.js "C:\path\file.pdf" "C:\path\thumb.png" [postId]
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const saPath = path.join(__dirname, '..', 'firebase-service-account.json');
const pdfPath = process.argv[2];
const imagePath = process.argv[3] && !/^\d+$/.test(process.argv[3]) ? process.argv[3] : '';
const postId = /^\d+$/.test(process.argv[3]) ? process.argv[3] : process.argv[4] || '95001';

const title =
  'ประกาศ สหกรณ์ออมทรัพย์สาธารณสุขหนองคาย จำกัด ฉบับที่ 4/2569 เรื่อง การพิจารณาให้เงินกู้พิเศษเพื่อการเคหะสงเคราะห์ และเงินกู้พิเศษเพื่อการลงทุนประกอบอาชีพ';

const CATEGORY_COMMAND_ANNOUNCE = 1;

if (!pdfPath || !fs.existsSync(pdfPath)) {
  console.error('ใช้: node scripts/add-cms-announcement.js "<path-to.pdf>" [postId]');
  process.exit(1);
}
if (!fs.existsSync(saPath)) {
  console.error('ไม่พบ', saPath);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(saPath)),
  storageBucket: 'admin-panel-nkbkcoop-cbf10.firebasestorage.app'
});

const db = admin.firestore();
const bucket = admin.storage().bucket();

function pdfViewerHtml(url, docTitle) {
  const safe = url.replace(/"/g, '&quot;');
  const t = (docTitle || 'เอกสาร PDF').replace(/"/g, '');
  return `<div class="pdf-viewer"><iframe src="${safe}#view=FitH" title="${t}" loading="lazy"></iframe></div>`;
}

async function uploadLocalFile(filePath, ext, contentType) {
  const buffer = fs.readFileSync(filePath);
  const hash = crypto.createHash('md5').update(buffer).digest('hex').slice(0, 16);
  const dest = `cms/wp/media/${hash}${ext}`;
  const file = bucket.file(dest);
  await file.save(buffer, {
    metadata: { contentType, cacheControl: 'public,max-age=31536000' }
  });
  await file.makePublic();
  return `https://storage.googleapis.com/${bucket.name}/${dest}`;
}

async function uploadLocalPdf(filePath) {
  return uploadLocalFile(filePath, '.pdf', 'application/pdf');
}

async function uploadLocalImage(filePath) {
  const ext = (path.extname(filePath) || '.png').toLowerCase();
  const types = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp'
  };
  return uploadLocalFile(filePath, ext, types[ext] || 'image/png');
}

async function main() {
  const existing = await db.collection('cms_posts').doc(String(postId)).get();
  if (existing.exists) {
    console.error(`cms_posts/${postId} มีอยู่แล้ว — ใส่ postId อื่น`);
    process.exit(1);
  }

  console.log('อัปโหลด PDF...', path.basename(pdfPath));
  const pdfUrl = await uploadLocalPdf(pdfPath);
  let featuredImageUrl = '';
  if (imagePath && fs.existsSync(imagePath)) {
    console.log('อัปโหลดภาพปก...', path.basename(imagePath));
    featuredImageUrl = await uploadLocalImage(imagePath);
  } else if (imagePath) {
    console.warn('ไม่พบไฟล์ภาพปก:', imagePath);
  }
  const contentHtml = pdfViewerHtml(pdfUrl, title);
  const publishedAt = admin.firestore.Timestamp.fromDate(
    new Date('2026-05-20T09:00:00+07:00')
  );

  const doc = {
    wpId: Number(postId) || null,
    kind: 'post',
    slug: 'announce-4-2569',
    title,
    excerpt: '',
    contentHtml,
    featuredImageUrl,
    link: '',
    status: 'publish',
    categoryIds: [CATEGORY_COMMAND_ANNOUNCE],
    publishedAt,
    modifiedAt: publishedAt,
    migratedAt: admin.firestore.FieldValue.serverTimestamp(),
    source: 'manual'
  };

  await db.collection('cms_posts').doc(String(postId)).set(doc);
  console.log('[OK] cms_posts/' + postId);
  console.log('หัวข้อ:', title);
  console.log('PDF:', pdfUrl);
  console.log('เปิด:', `https://admin-panel-nkbkcoop-cbf10.web.app/n/${postId}`);
  console.log('หมวด:', 'https://admin-panel-nkbkcoop-cbf10.web.app/news?c=command-announce');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
