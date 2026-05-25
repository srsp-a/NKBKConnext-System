/**
 * Back Office (icoopsiam) credentials — server-side only (Firestore config/backoffice_secrets)
 */
const crypto = require('crypto');

const SECRETS_DOC = 'backoffice_secrets';
const SUPER_UID = 'yPyuxPnu9tQmK89OH4NrUBjJ3jb2';

function getCredKey() {
  const raw = (process.env.BACKOFFICE_CREDENTIAL_KEY || '').trim();
  if (raw.length >= 32) return crypto.createHash('sha256').update(raw).digest();
  if (process.env.K_SERVICE || process.env.FUNCTION_TARGET) {
    console.warn('[backoffice] BACKOFFICE_CREDENTIAL_KEY not set — using dev fallback (set secret in production)');
  }
  return crypto.createHash('sha256').update('nkbk-backoffice-dev-key-change-me').digest();
}

function encryptSecret(plain) {
  const key = getCredKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptSecret(blob) {
  if (!blob) return '';
  const buf = Buffer.from(String(blob), 'base64');
  if (buf.length < 29) return '';
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const key = getCredKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

async function loadBackofficeCredentials(db) {
  if (!db) return null;
  try {
    const snap = await db.collection('config').doc(SECRETS_DOC).get();
    if (!snap.exists) return null;
    const d = snap.data() || {};
    const username = String(d.username || '').trim();
    const password = decryptSecret(d.passwordEnc);
    const database = String(d.database || 'ฐานข้อมูลหลัก').trim();
    if (!username || !password) return null;
    return { username, password, database };
  } catch (e) {
    console.warn('[backoffice] load credentials failed:', e.message);
    return null;
  }
}

async function saveBackofficeCredentials(db, payload, uid) {
  if (!db) throw new Error('Firestore unavailable');
  const username = String(payload.username || '').trim();
  const database = String(payload.database || 'ฐานข้อมูลหลัก').trim();
  const password = String(payload.password || '');
  const patch = {
    username,
    database,
    updatedAt: new Date(),
    updatedBy: String(uid || '')
  };
  if (password) {
    patch.passwordEnc = encryptSecret(password);
    patch.hasPassword = true;
  } else {
    const existing = await db.collection('config').doc(SECRETS_DOC).get();
    if (!existing.exists || !existing.data()?.passwordEnc) {
      throw new Error('กรุณาระบุรหัสผ่าน');
    }
    patch.hasPassword = true;
  }
  await db.collection('config').doc(SECRETS_DOC).set(patch, { merge: true });
  return { username, database, hasPassword: true };
}

async function getBackofficeCredentialsMeta(db) {
  if (!db) return { username: '', database: 'ฐานข้อมูลหลัก', hasPassword: false };
  try {
    const snap = await db.collection('config').doc(SECRETS_DOC).get();
    if (!snap.exists) {
      return { username: '', database: 'ฐานข้อมูลหลัก', hasPassword: false };
    }
    const d = snap.data() || {};
    return {
      username: String(d.username || ''),
      database: String(d.database || 'ฐานข้อมูลหลัก'),
      hasPassword: !!(d.passwordEnc || d.hasPassword),
      updatedAt: d.updatedAt && d.updatedAt.toDate ? d.updatedAt.toDate().toISOString() : d.updatedAt || null
    };
  } catch (e) {
    return { username: '', database: 'ฐานข้อมูลหลัก', hasPassword: false };
  }
}

function getAdminBearer(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7).trim();
  return '';
}

async function verifySuperAdminOnly(db, bearer) {
  if (!bearer) return null;
  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) return null;
    const decoded = await admin.auth().verifyIdToken(bearer);
    if (decoded.uid === SUPER_UID || decoded.admin === true) return decoded;
    if (!db) return null;
    const userDoc = await db.collection('users').doc(decoded.uid).get();
    if (userDoc.exists && String(userDoc.data().role || '').trim() === 'ผู้ดูแลระบบ') {
      return decoded;
    }
    const email = String(decoded.email || '').trim().toLowerCase();
    if (email) {
      const byEmail = await db.collection('users').where('email', '==', email).limit(1).get();
      if (!byEmail.empty && String(byEmail.docs[0].data().role || '').trim() === 'ผู้ดูแลระบบ') {
        return decoded;
      }
    }
    return null;
  } catch (e) {
    console.warn('[backoffice] verifySuperAdminOnly:', e.message);
    return null;
  }
}

module.exports = {
  SECRETS_DOC,
  SUPER_UID,
  encryptSecret,
  decryptSecret,
  loadBackofficeCredentials,
  saveBackofficeCredentials,
  getBackofficeCredentialsMeta,
  getAdminBearer,
  verifySuperAdminOnly
};
