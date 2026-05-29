const fs = require('fs');
const path = require('path');

const CMS_DIR = path.join(__dirname, '..', 'public-cms');
const ORIGIN = 'https://nkbkcoop.com';
const IMG =
  'https://res.cloudinary.com/dzs7zbikj/image/upload/c_pad,b_white,w_1200,h_630,f_jpg,q_auto/v1770613894/site-config/vd64o0efi0hdpetkzyrf.png';
const DESC =
  'สหกรณ์ออมทรัพย์สาธารณสุขหนองคาย จำกัด — ข่าวสาร บริการสมาชิก แจ้งโอนเงิน ดาวน์โหลดเอกสาร';

const PAGES = {
  'index.html': {
    url: '/',
    title: 'NKBKCOOP — สหกรณ์ออมทรัพย์สาธารณสุขหนองคาย จำกัด',
    ogTitle: 'NKBKCOOP — สหกรณ์ออมทรัพย์สาธารณสุขหนองคาย จำกัด'
  },
  'news.html': { url: '/news', title: 'ข่าวสาร — NKBKCOOP', ogTitle: 'ข่าวสาร — NKBKCOOP' },
  'post.html': { url: '/news', title: 'NKBKCOOP', ogTitle: 'NKBKCOOP' },
  'page.html': { url: '/', title: 'NKBKCOOP', ogTitle: 'NKBKCOOP' },
  'download.html': {
    url: '/download',
    title: 'ดาวน์โหลด — NKBKCOOP',
    ogTitle: 'ดาวน์โหลด — NKBKCOOP'
  },
  'about-us.html': {
    url: '/about-us',
    title: 'เกี่ยวกับเรา — NKBKCOOP',
    ogTitle: 'เกี่ยวกับเรา — NKBKCOOP'
  },
  'team.html': {
    url: '/team',
    title: 'คณะกรรมการ — NKBKCOOP',
    ogTitle: 'คณะกรรมการ — NKBKCOOP'
  },
  'management.html': {
    url: '/management',
    title: 'ผู้บริหาร — NKBKCOOP',
    ogTitle: 'ผู้บริหาร — NKBKCOOP'
  },
  'contact.html': {
    url: '/contact',
    title: 'ติดต่อเรา — NKBKCOOP',
    ogTitle: 'ติดต่อเรา — NKBKCOOP'
  },
  'payment.html': {
    url: '/infrom-payment',
    title: 'แจ้งโอนเงิน — NKBKCOOP',
    ogTitle: 'แจ้งโอนเงิน — NKBKCOOP'
  },
  'faq.html': {
    url: '/faq',
    title: 'คำถามที่พบบ่อย — NKBKCOOP',
    ogTitle: 'คำถามที่พบบ่อย — NKBKCOOP',
    desc: 'คำถามที่พบบ่อย — สหกรณ์ออมทรัพย์สาธารณสุขหนองคาย จำกัด'
  },
  'terms.html': {
    url: '/terms',
    title: 'ข้อกำหนดและเงื่อนไข — NKBKCOOP',
    ogTitle: 'ข้อกำหนดและเงื่อนไข — NKBKCOOP',
    desc: 'ข้อกำหนดและเงื่อนไขการใช้งาน — สหกรณ์ออมทรัพย์สาธารณสุขหนองคาย จำกัด'
  },
  'privacy-policy.html': {
    url: '/privacy-policy',
    title: 'นโยบายความเป็นส่วนตัว — NKBKCOOP',
    ogTitle: 'นโยบายความเป็นส่วนตัว — NKBKCOOP',
    desc: 'นโยบายความเป็นส่วนตัว (PDPA) — สหกรณ์ออมทรัพย์สาธารณสุขหนองคาย จำกัด'
  },
  'app.html': {
    url: '/app',
    title: 'NKBKConnext — NKBKCOOP',
    ogTitle: 'NKBKConnext — NKBKCOOP',
    desc: 'สหกรณ์ออมทรัพย์สาธารณสุขหนองคาย จำกัด — ดาวน์โหลดและวิธีใช้งานแอป NKBKConnext',
    ogDesc: 'วิธีดาวน์โหลดและสมัครใช้บริการแอป NKBKConnext สำหรับสมาชิกสหกรณ์'
  }
};

const force = !process.argv.includes('--skip-existing');

function ogBlock(cfg) {
  const fullUrl = ORIGIN + cfg.url;
  const desc = cfg.desc || DESC;
  const ogDesc = cfg.ogDesc || desc;
  return `  <meta name="description" content="${desc}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="NKBKCOOP" />
  <meta property="og:title" content="${cfg.ogTitle}" />
  <meta property="og:description" content="${ogDesc}" />
  <meta property="og:image" content="${IMG}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:url" content="${fullUrl}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content="${IMG}" />
  <title>${cfg.title}</title>`;
}

function injectMeta(html, cfg) {
  const block = ogBlock(cfg);
  if (html.includes('name="description"')) {
    return html.replace(
      /  <meta name="description" content="[^"]*" \/>[\s\S]*?  <title>[^<]*<\/title>/,
      block
    );
  }
  return html.replace(
    /  <meta name="viewport" content="width=device-width, initial-scale=1" \/>\r?\n  <title>[^<]*<\/title>/,
    `  <meta name="viewport" content="width=device-width, initial-scale=1" />\n${block}`
  );
}

for (const [file, cfg] of Object.entries(PAGES)) {
  const fp = path.join(CMS_DIR, file);
  if (!fs.existsSync(fp)) {
    console.warn('missing', file);
    continue;
  }
  let html = fs.readFileSync(fp, 'utf8');
  const hadOg = html.includes('property="og:image"');
  if (force || !hadOg) {
    html = injectMeta(html, cfg);
    console.log(hadOg ? 'replace og' : 'inject og', file);
  } else {
    console.log('skip og', file);
  }
  if (!html.includes('social-meta.js')) {
    html = html.replace(
      '<script src="/site-config.js"></script>',
      '<script src="/site-config.js"></script>\n  <script src="/social-meta.js"></script>'
    );
    console.log('social-meta', file);
  }
  fs.writeFileSync(fp, html, 'utf8');
}

console.log('done');
