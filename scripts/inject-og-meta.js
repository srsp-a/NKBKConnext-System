const fs = require('fs');
const path = require('path');

const CMS_DIR = path.join(__dirname, '..', 'public-cms');
const ORIGIN = 'https://admin-panel-nkbkcoop-cbf10.web.app';
const IMG =
  'https://res.cloudinary.com/dzs7zbikj/image/upload/c_pad,b_white,w_1200,h_630,f_jpg,q_auto/v1770613894/site-config/vd64o0efi0hdpetkzyrf.png';
const DESC =
  'สหกรณ์ออมทรัพย์สาธารณสุขหนองคาย จำกัด — ข่าวสาร บริการสมาชิก แจ้งโอนเงิน ดาวน์โหลดเอกสาร';

const PAGES = {
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
  }
};

function ogBlock(cfg) {
  const fullUrl = ORIGIN + cfg.url;
  return `  <meta name="description" content="${DESC}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="NKBKCOOP" />
  <meta property="og:title" content="${cfg.ogTitle}" />
  <meta property="og:description" content="${DESC}" />
  <meta property="og:image" content="${IMG}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:url" content="${fullUrl}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content="${IMG}" />
  <title>${cfg.title}</title>`;
}

for (const [file, cfg] of Object.entries(PAGES)) {
  const fp = path.join(CMS_DIR, file);
  let html = fs.readFileSync(fp, 'utf8');
  if (html.includes('property="og:image"')) {
    console.log('skip og', file);
  } else {
    html = html.replace(
      /  <meta name="viewport" content="width=device-width, initial-scale=1" \/>\r?\n  <title>[^<]*<\/title>/,
      `  <meta name="viewport" content="width=device-width, initial-scale=1" />\n${ogBlock(cfg)}`
    );
    console.log('og', file);
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
