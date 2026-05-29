/**
 * ลิงก์สั้นติดต่อเจ้าหน้าที่ เช่น nkbkcoop.com/g5d1h
 */
const CODE_LEN = 5;
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';

const COLLECTION = 'staff_contact_codes';
const PUBLIC_ORIGIN = 'https://nkbkcoop.com';

function isValidShortCode(code) {
  return /^[a-z0-9]{5}$/.test(String(code || '').trim().toLowerCase());
}

function randomCode() {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) {
    s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return s;
}

function publicShortUrl(code) {
  const c = String(code || '').trim().toLowerCase();
  if (!isValidShortCode(c)) return '';
  return PUBLIC_ORIGIN.replace(/\/$/, '') + '/' + c;
}

async function ensureStaffContactShortCode(db, staffId) {
  const uid = String(staffId || '').trim();
  if (!uid) throw new Error('ไม่พบรหัสเจ้าหน้าที่');

  const userRef = db.collection('users').doc(uid);
  const userDoc = await userRef.get();
  if (!userDoc.exists) throw new Error('ไม่พบผู้ใช้');

  const data = userDoc.data() || {};
  if (data.group && data.group !== 'เจ้าหน้าที่') {
    throw new Error('รองรับเฉพาะเจ้าหน้าที่');
  }

  const existing = String(data.contactShortCode || '').trim().toLowerCase();
  if (isValidShortCode(existing)) {
    const linkDoc = await db.collection(COLLECTION).doc(existing).get();
    if (linkDoc.exists && String(linkDoc.data().staffId || '') === uid) {
      return existing;
    }
  }

  const admin = require('firebase-admin');
  const FieldValue = admin.firestore.FieldValue;

  for (let attempt = 0; attempt < 24; attempt++) {
    const code = randomCode();
    const ref = db.collection(COLLECTION).doc(code);
    const snap = await ref.get();
    if (snap.exists) continue;
    await ref.set({
      staffId: uid,
      active: true,
      createdAt: FieldValue.serverTimestamp()
    });
    await userRef.set({ contactShortCode: code }, { merge: true });
    return code;
  }
  throw new Error('สร้างลิงก์สั้นไม่สำเร็จ กรุณาลองใหม่');
}

async function resolveStaffIdByShortCode(db, code) {
  const c = String(code || '').trim().toLowerCase();
  if (!isValidShortCode(c)) return null;
  const snap = await db.collection(COLLECTION).doc(c).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  if (data.active === false) return null;
  return String(data.staffId || '').trim() || null;
}

module.exports = {
  COLLECTION,
  isValidShortCode,
  publicShortUrl,
  ensureStaffContactShortCode,
  resolveStaffIdByShortCode
};
