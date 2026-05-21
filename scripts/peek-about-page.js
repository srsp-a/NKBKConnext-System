const admin = require('../functions/node_modules/firebase-admin');
const sa = require('../firebase-service-account.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });

admin
  .firestore()
  .collection('cms_pages')
  .doc('241')
  .get()
  .then((s) => {
    const h = s.data()?.contentHtml || '';
    const tablesHtml = [...h.matchAll(/<table class="table">([\s\S]*?)<\/table>/gi)];
    tablesHtml.forEach((t, i) => {
      const trs = [...t[1].matchAll(/<tr>([\s\S]*?)<\/tr>/gi)];
      console.log('\n=== table', i + 1, 'rows', trs.length);
      trs.slice(0, 4).forEach((r, ri) => {
        const tds = [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
        console.log(
          ri,
          tds.map((c) => c[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60))
        );
      });
    });
  });
