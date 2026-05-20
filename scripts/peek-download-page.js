const admin = require('../functions/node_modules/firebase-admin');
const sa = require('../firebase-service-account.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });

function strip(s) {
  return (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function slugId(s) {
  return strip(s)
    .toLowerCase()
    .replace(/[^\u0E00-\u0E7Aa-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

admin
  .firestore()
  .collection('cms_pages')
  .doc('7934')
  .get()
  .then((s) => {
    const h = s.data()?.contentHtml || '';
    const parts = h.split(/<h2 class="elementor-heading-title/);
    parts.shift();
    parts.forEach((part, si) => {
      const h2m = part.match(/[^>]*>([^<]+)</);
      const section = h2m ? strip(h2m[1]) : `section-${si}`;
      const boxes = [...part.matchAll(/contact-cta-box([\s\S]*?)(?=contact-cta-box|elementor-toggle-item|$)/gi)];
      console.log('\n##', section, boxes.length);
      boxes.forEach((m) => {
        const block = m[1];
        const titleM = block.match(/<h3>([\s\S]*?)<\/h3>/i);
        const title = strip(titleM ? titleM[1] : '');
        const pdfM =
          block.match(/iframe src="([^"]+\.pdf[^"]*)"/i) ||
          block.match(/href="([^"]+\.pdf[^"]*)"/i);
        console.log(' -', slugId(title), '|', !!pdfM, '|', title.slice(0, 55));
      });
    });
  });
