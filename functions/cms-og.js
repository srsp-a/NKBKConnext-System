/**
 * Social preview สำหรับ crawler (Facebook, LINE, ฯลฯ)
 * /n/:id — ใช้รูปข่าว; ไม่มีรูปใช้โลโก้พื้นหลังขาว
 */
const admin = require('firebase-admin');

const SITE_ORIGIN =
  process.env.CMS_PUBLIC_ORIGIN || 'https://nkbkcoop.com';
const DEFAULT_OG_IMAGE =
  'https://res.cloudinary.com/dzs7zbikj/image/upload/c_pad,b_white,w_1200,h_630,f_jpg,q_auto/v1770613894/site-config/vd64o0efi0hdpetkzyrf.png';
const SITE_NAME = 'NKBKCOOP';
const DEFAULT_DESC =
  'สหกรณ์ออมทรัพย์สาธารณสุขหนองคาย จำกัด — ข่าวสาร บริการสมาชิก แจ้งโอนเงิน ดาวน์โหลดเอกสาร';

const STATIC_SHELL = {
  '/': '/index.html',
  '/news': '/news.html',
  '/download': '/download.html',
  '/about-us': '/about-us.html',
  '/team': '/team.html',
  '/management': '/management.html',
  '/contact': '/contact.html',
  '/infrom-payment': '/payment.html',
  '/infrom-payment-line': '/payment.html',
  '/app': '/app.html',
  '/faq': '/faq.html',
  '/terms': '/terms.html',
  '/privacy-policy': '/privacy-policy.html',
  '/pdpa': '/privacy-policy.html'
};

/** หน้า CMS ที่มี rewrite เป็น path สั้น */
const STATIC_PAGE_IDS = {
  '/about-us': '241',
  '/team': '420',
  '/management': '8929',
  '/download': '7934',
  '/contact': '354',
  '/infrom-payment': '9304',
  '/infrom-payment-line': '9304',
  '/app': '9208',
  '/faq': '294',
  '/terms': '525',
  '/privacy-policy': '3',
  '/pdpa': '3'
};

function isBot(ua) {
  const s = String(ua || '');
  // In-app browsers (LINE / WhatsApp WebView) are real visitors — not preview crawlers.
  if (/Mozilla\/5\.0/i.test(s) && (/Line\/\d/i.test(s) || /WhatsApp\/\d/i.test(s))) {
    return false;
  }
  if (
    /facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Slackbot|TelegramBot|Discordbot|bingpreview|Googlebot/i.test(
      s
    )
  ) {
    return true;
  }
  if (/Linespider|LineBot|line-poker/i.test(s)) return true;
  if (/WhatsApp/i.test(s)) return true;
  if (/Line/i.test(s)) return true;
  return false;
}

async function getStaffContactOgMeta(db, staffId, shortCode) {
  const staffContactAvailability = require('./lib/staff-contact-availability');
  const staffContactPrompts = require('./lib/staff-contact-prompts');
  const info = await staffContactAvailability.evaluateContactAvailability(db, staffId);
  if (!info.ok || !info.staff) return null;
  const title = info.staff.contactTitle || staffContactPrompts.staffContactTitle(info.staff);
  const name = info.staff.name || title;
  const desc =
    'ติดต่อ' +
    title +
    ' ผ่านน้องโมเน่ — สหกรณ์ออมทรัพย์สาธารณสุขหนองคาย จำกัด';
  const avatar = info.staff.avatar || info.prefillAvatar || '';
  const image = avatar && /^https?:\/\//i.test(avatar) ? avatar : DEFAULT_OG_IMAGE;
  const code = String(shortCode || info.staff.shortCode || '').trim().toLowerCase();
  const url = code
    ? SITE_ORIGIN.replace(/\/$/, '') + '/' + code
    : SITE_ORIGIN.replace(/\/$/, '') + '/management?contact=' + encodeURIComponent(staffId);
  return {
    title: 'ติดต่อ ' + title + ' — ' + SITE_NAME,
    description: desc,
    image: absoluteImage(image),
    url
  };
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function absoluteImage(url) {
  if (!url || !String(url).trim()) return DEFAULT_OG_IMAGE;
  const u = String(url).trim();
  if (/^https?:\/\//i.test(u)) return u;
  return SITE_ORIGIN.replace(/\/$/, '') + (u.startsWith('/') ? u : `/${u}`);
}

function firstImgFromHtml(html) {
  const m = String(html || '').match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? absoluteImage(m[1]) : '';
}

function ogHtml(meta) {
  const title = meta.title || SITE_NAME;
  const description = meta.description || DEFAULT_DESC;
  const image = meta.image || DEFAULT_OG_IMAGE;
  const url = meta.url || SITE_ORIGIN;
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(SITE_NAME)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${esc(url)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<title>${esc(title)}</title>
</head>
<body><p><a href="${esc(url)}">${esc(title)}</a></p></body>
</html>`;
}

async function getPostMeta(id) {
  const db = admin.firestore();
  const doc = await db.collection('cms_posts').doc(String(id)).get();
  if (!doc.exists) return null;
  const d = doc.data();
  const title = d.title || SITE_NAME;
  const plain = stripHtml(d.contentHtml || '');
  const description = (d.excerpt || plain).slice(0, 200) || DEFAULT_DESC;
  const image = absoluteImage(d.featuredImageUrl) || firstImgFromHtml(d.contentHtml) || DEFAULT_OG_IMAGE;
  return {
    title,
    description,
    image,
    url: `${SITE_ORIGIN.replace(/\/$/, '')}/n/${id}`
  };
}

async function getCmsPageMeta(pageId, urlPath) {
  const db = admin.firestore();
  const doc = await db.collection('cms_pages').doc(String(pageId)).get();
  if (!doc.exists) return null;
  const d = doc.data();
  const title = d.title || SITE_NAME;
  const html = d.html || '';
  const plain = stripHtml(html);
  const description = plain.slice(0, 200) || DEFAULT_DESC;
  const image = firstImgFromHtml(html) || DEFAULT_OG_IMAGE;
  const base = SITE_ORIGIN.replace(/\/$/, '');
  return {
    title,
    description,
    image,
    url: `${base}${urlPath || `/page/${pageId}`}`
  };
}

function shellPath(reqPath) {
  const p = (reqPath || '/').replace(/\/$/, '') || '/';
  if (STATIC_SHELL[p]) return STATIC_SHELL[p];
  if (/^\/n\/\d+$/i.test(p)) return '/post.html';
  if (p.startsWith('/page/')) return '/page.html';
  return '/index.html';
}

async function proxyShell(reqPath) {
  const file = shellPath(reqPath);
  const res = await fetch(`${SITE_ORIGIN.replace(/\/$/, '')}${file}`, {
    headers: { 'User-Agent': 'NKBK-CmsOg-Proxy' }
  });
  if (!res.ok) throw new Error(`shell ${file} ${res.status}`);
  return res.text();
}

async function cmsOgHandler(req, res) {
  const path = (req.path || '/').split('?')[0];
  const ua = req.get('user-agent') || '';

  const shortMatch = path.match(/^\/([a-z0-9]{5})\/?$/i);
  if (shortMatch) {
    try {
      if (!admin.apps.length) admin.initializeApp();
      const db = admin.firestore();
      const staffContactLinks = require('./lib/staff-contact-links');
      const staffId = await staffContactLinks.resolveStaffIdByShortCode(db, shortMatch[1]);
      if (staffId) {
        if (isBot(ua)) {
          const meta = await getStaffContactOgMeta(db, staffId, shortMatch[1]);
          if (meta) {
            res.set('Cache-Control', 'public, max-age=600');
            return res.status(200).send(ogHtml(meta));
          }
        }
        const dest =
          SITE_ORIGIN.replace(/\/$/, '') + '/management?contact=' + encodeURIComponent(staffId);
        return res.redirect(302, dest);
      }
    } catch (e) {
      console.error('cmsOg short contact', e.message);
    }
  }

  const postMatch = path.match(/^\/n\/(\d+)\/?$/i);

  if (isBot(ua)) {
    try {
      if (postMatch) {
        const meta = await getPostMeta(postMatch[1]);
        if (meta) {
          res.set('Cache-Control', 'public, max-age=600');
          return res.status(200).send(ogHtml(meta));
        }
      }
      const pageMatch = path.match(/^\/page\/(\d+)\/?$/i);
      if (pageMatch) {
        const meta = await getCmsPageMeta(pageMatch[1], path);
        if (meta) {
          res.set('Cache-Control', 'public, max-age=600');
          return res.status(200).send(ogHtml(meta));
        }
      }
      const norm = (path || '/').replace(/\/$/, '') || '/';
      const staticPageId = STATIC_PAGE_IDS[norm];
      if (staticPageId) {
        const meta = await getCmsPageMeta(staticPageId, norm);
        if (meta) {
          res.set('Cache-Control', 'public, max-age=600');
          return res.status(200).send(ogHtml(meta));
        }
      }
      res.set('Cache-Control', 'public, max-age=600');
      return res.status(200).send(
        ogHtml({
          title: SITE_NAME,
          description: DEFAULT_DESC,
          image: DEFAULT_OG_IMAGE,
          url: `${SITE_ORIGIN.replace(/\/$/, '')}${path === '/' ? '' : path}`
        })
      );
    } catch (e) {
      console.error('cmsOg bot', e);
      return res.status(200).send(
        ogHtml({
          title: SITE_NAME,
          description: DEFAULT_DESC,
          image: DEFAULT_OG_IMAGE,
          url: SITE_ORIGIN
        })
      );
    }
  }

  try {
    const html = await proxyShell(path);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'no-cache');
    return res.status(200).send(html);
  } catch (e) {
    console.error('cmsOg proxy', e);
    return res.redirect(302, SITE_ORIGIN);
  }
}

module.exports = { cmsOgHandler, DEFAULT_OG_IMAGE, SITE_ORIGIN };
