/**
 * ติดตามและวัดผลลิงก์ติดต่อเจ้าหน้าที่ผ่านโมเน่
 */
const METRICS_COL = 'staff_contact_metrics';
const EVENTS_COL = 'staff_contact_events';

function dayKey(d) {
  d = d || new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function monthKey(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

async function bumpMetric(db, staffId, fields) {
  const sid = String(staffId || '').trim();
  if (!sid) return;
  const admin = require('firebase-admin');
  const FieldValue = admin.firestore.FieldValue;
  const dk = dayKey();
  const mk = monthKey();
  const ref = db.collection(METRICS_COL).doc(sid + '_' + dk);
  const patch = {
    staffId: sid,
    date: dk,
    month: mk,
    updatedAt: FieldValue.serverTimestamp()
  };
  Object.keys(fields || {}).forEach(function (k) {
    patch[k] = FieldValue.increment(Number(fields[k]) || 0);
  });
  await ref.set(patch, { merge: true });
}

async function logEvent(db, payload) {
  const admin = require('firebase-admin');
  const FieldValue = admin.firestore.FieldValue;
  const staffId = String((payload && payload.staffId) || '').trim();
  if (!staffId) return;
  await db.collection(EVENTS_COL).add({
    staffId,
    type: String((payload && payload.type) || '').trim(),
    conversationId: String((payload && payload.conversationId) || '').trim() || null,
    shortCode: String((payload && payload.shortCode) || '').trim() || null,
    score: payload && payload.score != null ? Number(payload.score) : null,
    comment: payload && payload.comment ? String(payload.comment).slice(0, 500) : null,
    createdAt: FieldValue.serverTimestamp(),
    date: dayKey()
  });
}

async function recordLinkOpen(db, staffId, shortCode) {
  await bumpMetric(db, staffId, { linkOpens: 1 });
  await logEvent(db, { staffId, type: 'link_open', shortCode });
}

async function recordContactStart(db, staffId, conversationId, shortCode) {
  await bumpMetric(db, staffId, { contacts: 1, conversations: 1 });
  await logEvent(db, { staffId, type: 'contact_start', conversationId, shortCode });
}

async function recordVisitorMessage(db, staffId, conversationId) {
  await bumpMetric(db, staffId, { messages: 1 });
  await logEvent(db, { staffId, type: 'message', conversationId });
}

async function recordCaseClosed(db, staffId, conversationId) {
  await bumpMetric(db, staffId, { casesClosed: 1 });
  await logEvent(db, { staffId, type: 'case_closed', conversationId });
}

async function recordRating(db, staffId, conversationId, score, comment) {
  const s = Math.max(1, Math.min(5, Number(score) || 0));
  if (!s) return;
  await bumpMetric(db, staffId, { ratingsCount: 1, ratingsSum: s });
  await logEvent(db, { staffId, type: 'rating', conversationId, score: s, comment });
}

async function getStaffStats(db, staffId, days) {
  const sid = String(staffId || '').trim();
  if (!sid) return { ok: false };
  const n = Math.max(1, Math.min(90, Number(days) || 30));
  const snap = await db.collection(METRICS_COL).where('staffId', '==', sid).limit(Math.max(n, 60)).get();
  let linkOpens = 0;
  let contacts = 0;
  let conversations = 0;
  let messages = 0;
  let casesClosed = 0;
  let ratingsCount = 0;
  let ratingsSum = 0;
  const daily = [];
  snap.forEach(function (d) {
    const x = d.data() || {};
    linkOpens += Number(x.linkOpens) || 0;
    contacts += Number(x.contacts) || 0;
    conversations += Number(x.conversations) || 0;
    messages += Number(x.messages) || 0;
    casesClosed += Number(x.casesClosed) || 0;
    ratingsCount += Number(x.ratingsCount) || 0;
    ratingsSum += Number(x.ratingsSum) || 0;
    daily.push({
      date: x.date,
      linkOpens: Number(x.linkOpens) || 0,
      contacts: Number(x.contacts) || 0,
      conversations: Number(x.conversations) || 0,
      messages: Number(x.messages) || 0,
      casesClosed: Number(x.casesClosed) || 0,
      ratingsCount: Number(x.ratingsCount) || 0,
      ratingsSum: Number(x.ratingsSum) || 0
    });
  });
  daily.sort(function (a, b) {
    return String(b.date || '').localeCompare(String(a.date || ''));
  });
  if (daily.length > n) daily.length = n;
  return {
    ok: true,
    staffId: sid,
    days: n,
    totals: {
      linkOpens,
      contacts,
      conversations,
      messages,
      casesClosed,
      ratingsCount,
      avgRating: ratingsCount ? Math.round((ratingsSum / ratingsCount) * 10) / 10 : null
    },
    daily
  };
}

module.exports = {
  recordLinkOpen,
  recordContactStart,
  recordVisitorMessage,
  recordCaseClosed,
  recordRating,
  getStaffStats
};
