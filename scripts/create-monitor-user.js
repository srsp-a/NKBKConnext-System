/**
 * สร้างผู้ใช้สำหรับล็อกอิน Monitor (ชื่อผู้ใช้ + PIN 6 หลัก)
 * เก็บใน Firestore collection: monitor_users
 *
 * วิธีใช้: node scripts/create-monitor-user.js <username> <pin 6 หลัก>
 * ต้องมีไฟล์ firebase-service-account.json ในโฟลเดอร์โปรเจกต์ (เดียวกับ server.js)
 */
const path = require('path');
const crypto = require('crypto');

const APP_DIR = path.join(__dirname, '..');
const MONITOR_COLLECTION = 'monitor_users';
const PBKDF2_ITERATIONS = 100000;

function hashPin(pin, salt) {
  return crypto.pbkdf2Sync(pin, salt, PBKDF2_ITERATIONS, 64, 'sha512').toString('hex');
}

async function main() {
  const username = process.argv[2];
  const pin = process.argv[3];

  if (!username || !pin) {
    console.log('ใช้: node scripts/create-monitor-user.js <username> <pin 6 หลัก>');
    console.log('ตัวอย่าง: node scripts/create-monitor-user.js admin 123456');
    process.exit(1);
  }

  if (!/^\d{6}$/.test(pin)) {
    console.error('รหัส PIN ต้องเป็นตัวเลข 6 หลัก');
    process.exit(1);
  }

  const admin = require('firebase-admin');
  const serviceAccountPath = path.join(APP_DIR, 'firebase-service-account.json');
  const fs = require('fs');
  if (!fs.existsSync(serviceAccountPath)) {
    console.error('ไม่พบไฟล์ firebase-service-account.json ในโฟลเดอร์โปรเจกต์');
    console.error('ดาวน์โหลดจาก Firebase Console > Project settings > Service accounts > Generate new private key');
    process.exit(1);
  }

  const serviceAccount = require(serviceAccountPath);
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  const docId = username.toLowerCase().replace(/\s+/g, '');
  const salt = crypto.randomBytes(16).toString('hex');
  const pinHash = hashPin(pin, salt);

  await db.collection(MONITOR_COLLECTION).doc(docId).set({
    pinHash,
    salt,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  console.log('สร้างผู้ใช้สำเร็จ:', docId);
  console.log('ล็อกอินด้วยชื่อผู้ใช้:', username, 'และรหัส PIN 6 หลักที่ตั้งไว้');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
