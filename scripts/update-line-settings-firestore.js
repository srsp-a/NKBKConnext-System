/**
 * อัปเดต Firestore config/line_settings — monitorApiUrl ชี้ Firebase
 * ใช้: node scripts/update-line-settings-firestore.js
 */
const path = require('path');
const fs = require('fs');

const APP_DIR = path.join(__dirname, '..');
const PROJECT_ID = 'admin-panel-nkbkcoop-cbf10';
const MONITOR_API_URL = 'https://monitor-api.nkbkcoop.com';
const LINE_API_BASE = 'https://api-line.nkbkcoop.com';

async function main() {
  const saPath = path.join(APP_DIR, 'firebase-service-account.json');
  if (!fs.existsSync(saPath)) {
    console.error('ไม่พบ firebase-service-account.json ที่', saPath);
    process.exit(1);
  }

  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(sa),
      projectId: sa.project_id || PROJECT_ID
    });
  }

  const db = admin.firestore();
  const ref = db.collection('config').doc('line_settings');
  const before = await ref.get();
  const prev = before.exists ? before.data() : {};

  const patch = {
    monitorApiUrl: MONITOR_API_URL,
    webhookUrl: `${LINE_API_BASE}/line/webhook`,
    callbackUrl: `${LINE_API_BASE}/line/callback`,
    monitorApiUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    lineApiUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  await ref.set(patch, { merge: true });
  const after = await ref.get();

  console.log('[OK] config/line_settings updated (merge)');
  console.log('  monitorApiUrl:', after.data().monitorApiUrl);
  console.log('  webhookUrl:', after.data().webhookUrl);
  console.log('  callbackUrl:', after.data().callbackUrl);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
