const admin = require('../functions/node_modules/firebase-admin');
const sa = require('../firebase-service-account.json');
admin.initializeApp({
  credential: admin.credential.cert(sa),
  storageBucket: 'admin-panel-nkbkcoop-cbf10.firebasestorage.app'
});
const id = process.argv[2] || '14499';
admin.firestore().collection('cms_posts').doc(id).get().then((s) => {
  const h = s.data()?.contentHtml || '';
  const m = h.match(/href="([^"]+)"/);
  if (m) console.log('href len', m[1].length, '\n', m[1]);
  console.log(h);
});
