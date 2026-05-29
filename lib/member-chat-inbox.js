/**
 * AI โมเน่ — Member chat inbox (web MVP, LINE phase 2 ready)
 */
const crypto = require('crypto');
const memberStaff = require('./member-staff');
const staffContactAvailability = require('./staff-contact-availability');
const staffContactAnalytics = require('./staff-contact-analytics');

const COLLECTION = 'member_chat_conversations';
const MEMBER_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const MEMBER_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const STORAGE_PROJECT_ID = 'admin-panel-nkbkcoop-cbf10';
const STORAGE_BUCKET_CANDIDATES = [
  process.env.FIREBASE_STORAGE_BUCKET,
  process.env.GCLOUD_STORAGE_BUCKET,
  `${STORAGE_PROJECT_ID}.firebasestorage.app`,
  `${STORAGE_PROJECT_ID}.appspot.com`
].filter(Boolean);
let _memberChatStorageBucket = null;

const HUMAN_KEYWORDS =
  /(?:ขอ(?:คุย|พูด|ติดต่อ)|อยาก(?:คุย|พูด|ติดต่อ)|ให้(?:คุย|พูด|ติดต่อ)).{0,24}(?:เจ้าหน้าที่|คนจริง|staff|human)/i;
const HUMAN_KEYWORDS2 = /(?:เจ้าหน้าที่(?:มา)?(?:ตอบ|ช่วย|รับเรื่อง)|ขอคน(?:มา)?(?:ตอบ|ช่วย))/i;

function newConversationId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'mc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

function normText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function previewText(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const n = max || 120;
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function tsNow() {
  return new Date();
}

function staffAvatarFromUser(user) {
  const u = user && typeof user === 'object' ? user : {};
  return String(u.avatar || u.userAvatar || u.lineAvatar || u.authorPhotoUrl || '').trim();
}

function staffPhotoPositionFromUser(user) {
  const u = user && typeof user === 'object' ? user : {};
  return String(u.avatarPosition || 'center center').trim() || 'center center';
}

function staffRoleLabelFromUser(user) {
  const u = user && typeof user === 'object' ? user : {};
  const pos = String(u.position || '').trim();
  const job = String(u.job || '').trim();
  const role = String(u.role || '').trim();
  const dept = String(u.department || '').trim();
  const adminLike = /^(ผู้ดูแลระบบ|แอดมิน|admin)$/i;
  if (pos && job && job !== 'งานทั้งหมด' && !pos.includes(job)) return `${pos} ${job}`.trim();
  if (pos && !adminLike.test(pos)) return pos;
  if (dept) return `เจ้าหน้าที่ ${dept}`;
  if (role && role !== 'เจ้าหน้าที่' && !adminLike.test(role)) return role;
  return 'เจ้าหน้าที่';
}

function mapUserToStaff(user) {
  const u = user && typeof user === 'object' ? user : {};
  return {
    uid: String(u.uid || u.id || '').trim(),
    role: String(u.role || '').trim(),
    position: String(u.position || '').trim(),
    job: String(u.job || '').trim(),
    department: String(u.department || '').trim(),
    fullname: String(u.fullname || u.name || '').trim(),
    email: String(u.email || '').trim(),
    group: String(u.group || '').trim(),
    avatar: staffAvatarFromUser(u),
    avatarPosition: staffPhotoPositionFromUser(u)
  };
}

function isFullInboxAccess(user) {
  if (!user) return false;
  const role = String(user.role || '').trim();
  if (/^(ผู้ดูแลระบบ|แอดมิน|admin)$/i.test(role)) return true;
  const pos = String(user.position || '').trim();
  return /ผู้จัดการ/.test(pos);
}

function canAssign(user) {
  return isFullInboxAccess(user);
}

function canAccessConversation(user, conv) {
  if (!user || !conv) return false;
  if (isFullInboxAccess(user)) return true;
  const uid = String(user.uid || user.id || '').trim();
  if (!uid) return false;
  const assigned = conv.assignedTo && conv.assignedTo.uid ? String(conv.assignedTo.uid) : '';
  const requested = conv.requestedStaff && conv.requestedStaff.uid ? String(conv.requestedStaff.uid) : '';
  return assigned === uid || requested === uid;
}

async function resolveStaffFromToken(db, nkbkAi, decoded) {
  if (!decoded || !decoded.uid) return null;
  const uid = decoded.uid;
  const userDoc = await db.collection('users').doc(uid).get();
  if (userDoc.exists) {
    const data = userDoc.data() || {};
    return mapUserToStaff({
      uid,
      ...data,
      fullname: String(data.fullname || data.name || decoded.name || '').trim(),
      email: String(data.email || decoded.email || '').trim()
    });
  }
  const email = String(decoded.email || '').trim().toLowerCase();
  if (email) {
    const byEmail = await db.collection('users').where('email', '==', email).limit(1).get();
    if (!byEmail.empty) {
      const d = byEmail.docs[0];
      const data = d.data() || {};
      return mapUserToStaff({
        uid: d.id,
        ...data,
        fullname: String(data.fullname || data.name || decoded.name || '').trim(),
        email: String(data.email || decoded.email || '').trim()
      });
    }
  }
  return null;
}

const MONITOR_STAFF_GROUPS = /^(เจ้าหน้าที่|กรรมการ|ผู้ดูแลระบบ)$/;

function staffFromMonitorSessionOnly(session) {
  if (!session || !session.username) return null;
  const group = String(session.group || '').trim();
  const role = String(session.role || '').trim();
  if (!MONITOR_STAFF_GROUPS.test(group) && !/^(ผู้ดูแลระบบ|แอดมิน|admin)$/i.test(role)) return null;
  const uid = String(session.uid || session.userId || '').trim();
  return mapUserToStaff({
    uid: uid || String(session.username || '').trim(),
    fullname: String(session.fullname || session.username || '').trim(),
    email: String(session.email || '').trim(),
    group,
    role: role || (group === 'ผู้ดูแลระบบ' ? 'ผู้ดูแลระบบ' : group === 'กรรมการ' ? 'กรรมการ' : 'เจ้าหน้าที่'),
    username: String(session.username || '').trim()
  });
}

async function resolveStaffFromMonitorSession(db, nkbkAi, session) {
  if (!session || !session.username) return null;
  if (db) {
    const found = await nkbkAi.findV2UserDoc(db, session.username);
    if (found && found.docId) {
      const data = found.data || {};
      return mapUserToStaff({
        uid: found.docId,
        ...data,
        fullname: String(data.fullname || data.name || session.fullname || session.username).trim(),
        email: String(data.email || session.email || '').trim(),
        username: String(session.username || '').trim()
      });
    }
    const email = String(session.email || '').trim().toLowerCase();
    if (email) {
      const byEmail = await db.collection('users').where('email', '==', email).limit(1).get();
      if (!byEmail.empty) {
        const d = byEmail.docs[0];
        const data = d.data() || {};
        return mapUserToStaff({
          uid: d.id,
          ...data,
          fullname: String(data.fullname || data.name || session.fullname || session.username).trim(),
          email: String(data.email || session.email || '').trim(),
          username: String(session.username || '').trim()
        });
      }
    }
    const sessionUid = String(session.uid || session.userId || '').trim();
    if (sessionUid) {
      const userDoc = await db.collection('users').doc(sessionUid).get();
      if (userDoc.exists) {
        const data = userDoc.data() || {};
        return mapUserToStaff({
          uid: userDoc.id,
          ...data,
          fullname: String(data.fullname || data.name || session.fullname || session.username).trim(),
          email: String(data.email || session.email || '').trim(),
          username: String(session.username || '').trim()
        });
      }
    }
  }
  return staffFromMonitorSessionOnly(session);
}

function isDirectHumanHandoff(message) {
  const m = String(message || '');
  return HUMAN_KEYWORDS.test(m) || HUMAN_KEYWORDS2.test(m);
}

function detectRequestedStaff(message, directory) {
  if (!directory || !directory.all) return null;
  const matches = memberStaff.pickStaffMatches(message, directory, 1);
  if (!matches.length) return null;
  const p = matches[0];
  return {
    uid: String(p.id || '').trim(),
    name: String(p.fullname || '').trim(),
    dept: String(p.department || p.role || '').trim()
  };
}

async function createNotification(db, data) {
  const admin = require('firebase-admin');
  const FieldValue = admin.firestore.FieldValue;
  const doc = {
    userId: String(data.userId || ''),
    targetType: String(data.targetType || 'role'),
    targetValue: String(data.targetValue || ''),
    source: String(data.source || 'member_chat'),
    category: String(data.category || 'action'),
    title: String(data.title || ''),
    body: String(data.body || ''),
    severity: String(data.severity || 'info'),
    icon: String(data.icon || 'fa-comments'),
    relatedType: String(data.relatedType || 'member_chat'),
    relatedId: String(data.relatedId || ''),
    url: String(data.url || ''),
    read: false,
    readAt: null,
    createdBy: String(data.createdBy || 'system'),
    createdAt: FieldValue.serverTimestamp()
  };
  const ref = await db.collection('notifications').add(doc);
  return ref.id;
}

async function notifyInboxEvent(db, conv, opts) {
  const conversationId = conv.id || conv.conversationId || '';
  const preview = previewText(conv.lastMessagePreview || opts.preview || '', 80);
  const title = opts.title || 'แชตโมเน่ใหม่';
  const body = opts.body || preview || 'มีข้อความจากสมาชิก';
  const assignedUid = conv.assignedTo && conv.assignedTo.uid ? String(conv.assignedTo.uid) : '';
  const base = {
    source: 'member_chat',
    category: 'action',
    title,
    body,
    severity: opts.severity || 'info',
    icon: 'fa-comments',
    relatedType: 'member_chat',
    relatedId: conversationId,
    url: opts.url || `moneechat?conversation=${encodeURIComponent(conversationId)}`
  };
  if (assignedUid) {
    await createNotification(db, { ...base, targetType: 'userId', targetValue: assignedUid, userId: assignedUid });
    return;
  }
  const requestedUid = conv.requestedStaff && conv.requestedStaff.uid ? String(conv.requestedStaff.uid) : '';
  if (requestedUid) {
    await createNotification(db, { ...base, targetType: 'userId', targetValue: requestedUid, userId: requestedUid });
    await createNotification(db, { ...base, targetType: 'role', targetValue: 'ผู้ดูแลระบบ' });
    return;
  }
  await createNotification(db, { ...base, targetType: 'role', targetValue: 'แอดมิน' });
  await createNotification(db, { ...base, targetType: 'role', targetValue: 'ผู้ดูแลระบบ' });
  await createNotification(db, { ...base, targetType: 'role', targetValue: 'เจ้าหน้าที่' });
  const moneeMenuUsers = await db
    .collection('users')
    .where('menuPermissions.moneechat', '==', true)
    .limit(30)
    .get()
    .catch(() => ({ docs: [] }));
  const notifiedUids = new Set();
  for (const d of moneeMenuUsers.docs || []) {
    if (!d || !d.id || notifiedUids.has(d.id)) continue;
    notifiedUids.add(d.id);
    await createNotification(db, { ...base, targetType: 'userId', targetValue: d.id, userId: d.id });
  }
  const managers = await db
    .collection('users')
    .where('position', '>=', 'ผู้จัดการ')
    .where('position', '<=', 'ผู้จัดการ\uf8ff')
    .limit(20)
    .get()
    .catch(() => ({ docs: [] }));
  for (const d of managers.docs || []) {
    const pos = String((d.data() && d.data().position) || '');
    if (!/ผู้จัดการ/.test(pos)) continue;
    await createNotification(db, { ...base, targetType: 'userId', targetValue: d.id, userId: d.id });
  }
}

async function appendMessage(db, conversationId, msg) {
  const admin = require('firebase-admin');
  const FieldValue = admin.firestore.FieldValue;
  const ref = db.collection(COLLECTION).doc(conversationId).collection('messages').doc();
  const doc = {
    role: String(msg.role || 'visitor'),
    authorType: String(msg.authorType || msg.role || 'visitor'),
    authorId: msg.authorId ? String(msg.authorId) : null,
    authorName: msg.authorName ? String(msg.authorName) : null,
    authorRoleLabel: msg.authorRoleLabel ? String(msg.authorRoleLabel) : null,
    authorPhotoUrl: msg.authorPhotoUrl ? String(msg.authorPhotoUrl) : null,
    authorPhotoPosition: msg.authorPhotoPosition ? String(msg.authorPhotoPosition) : null,
    content: String(msg.content || ''),
    createdAt: FieldValue.serverTimestamp()
  };
  if (msg.rich && typeof msg.rich === 'object') doc.rich = msg.rich;
  if (msg.messageType) doc.messageType = String(msg.messageType);
  if (msg.imageUrl) doc.imageUrl = String(msg.imageUrl);
  if (msg.imageMime) doc.imageMime = String(msg.imageMime);
  if (msg.imageStoragePath) doc.imageStoragePath = String(msg.imageStoragePath);
  await ref.set(doc);
  return ref.id;
}

async function touchConversation(db, conversationId, patch) {
  const admin = require('firebase-admin');
  const FieldValue = admin.firestore.FieldValue;
  const ref = db.collection(COLLECTION).doc(conversationId);
  await ref.set(
    {
      ...patch,
      updatedAt: FieldValue.serverTimestamp(),
      lastMessageAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );
}

async function getOrCreateConversation(db, conversationId, visitorMeta) {
  const id = String(conversationId || '').trim() || newConversationId();
  const ref = db.collection(COLLECTION).doc(id);
  const snap = await ref.get();
  if (snap.exists) return { id, data: snap.data(), created: false };
  const visitor = visitorMeta && typeof visitorMeta === 'object' ? visitorMeta : {};
  const subject = previewText(visitor.firstMessage || 'แชตใหม่', 80) || 'แชตใหม่';
  const doc = {
    channel: 'web',
    status: 'ai',
    subject,
    lastMessagePreview: subject,
    unreadAdminCount: 0,
    unreadVisitorCount: 0,
    assignedTo: null,
    requestedStaff: null,
    visitor: {
      label: String(visitor.label || 'ผู้เยี่ยมชมเว็บ').trim(),
      pageUrl: visitor.pageUrl ? String(visitor.pageUrl).slice(0, 500) : null,
      userAgent: visitor.userAgent ? String(visitor.userAgent).slice(0, 300) : null
    },
    memberRef: {},
    aiEnabled: true,
    createdAt: tsNow(),
    updatedAt: tsNow(),
    lastMessageAt: tsNow()
  };
  await ref.set(doc);
  return { id, data: doc, created: true };
}

const STAFF_REPLY_TIMEOUT_MS = 3 * 60 * 1000;
const STAFF_PRESENCE_TTL_MS = 20 * 1000;
const VISITOR_PRESENCE_TTL_MS = 15 * 1000;

function presenceAtMs(p) {
  if (!p) return 0;
  let atMs = Number(p.atMs) || 0;
  if (!atMs && p.at && typeof p.at.toMillis === 'function') atMs = p.at.toMillis();
  if (!atMs && p.at && p.at._seconds != null) atMs = Number(p.at._seconds) * 1000;
  return atMs > 0 ? atMs : 0;
}

function staffPresenceActive(conv) {
  const p = conv && conv.staffPresence;
  if (!p) return false;
  const atMs = presenceAtMs(p);
  if (!atMs || Date.now() - atMs >= STAFF_PRESENCE_TTL_MS) return false;
  return !!(p.typing || p.focused);
}

function visitorPresenceActive(conv) {
  const p = conv && conv.visitorPresence;
  if (!p) return false;
  const atMs = presenceAtMs(p);
  if (!atMs || Date.now() - atMs >= VISITOR_PRESENCE_TTL_MS) return false;
  return !!(p.typing || p.focused);
}

function staffTypingForMember(conv) {
  if (!isWaitingForStaff(conv)) return false;
  return staffPresenceActive(conv);
}

function latestVisitorAndStaff(messages) {
  let lastVisitor = null;
  let lastStaff = null;
  const list = messages || [];
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (!lastVisitor && isVisitorMessage(m)) lastVisitor = m;
    if (!lastStaff && isStaffMessage(m)) lastStaff = m;
    if (lastVisitor && lastStaff) break;
  }
  return { lastVisitor, lastStaff };
}

function needsStaffReply(conv, messages) {
  if (!isWaitingForStaff(conv)) return false;
  const { lastVisitor, lastStaff } = latestVisitorAndStaff(messages);
  if (!lastVisitor) return true;
  if (!lastStaff) return true;
  return (lastStaff.createdAtMs || 0) < (lastVisitor.createdAtMs || 0);
}

function messageCreatedAtMs(data) {
  const d = data || {};
  if (d.createdAtMs != null && d.createdAtMs !== '') {
    const n = Number(d.createdAtMs);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  const c = d.createdAt;
  if (c == null) return 0;
  if (typeof c === 'number') return c > 1e12 ? c : c * 1000;
  if (typeof c === 'string') {
    const parsed = Date.parse(c);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof c.toMillis === 'function') return c.toMillis();
  if (c._seconds != null) return Number(c._seconds) * 1000;
  if (c.seconds != null) return Number(c.seconds) * 1000;
  return 0;
}

function mapMessageDoc(d) {
  const data = d.data() || {};
  return {
    id: d.id,
    role: data.role,
    authorType: data.authorType,
    authorId: data.authorId || null,
    authorName: data.authorName || null,
    authorRoleLabel: data.authorRoleLabel || null,
    authorPhotoUrl: data.authorPhotoUrl || null,
    authorPhotoPosition: data.authorPhotoPosition || null,
    content: data.content || '',
    rich: data.rich || null,
    messageType: data.messageType || (data.imageUrl ? 'image' : 'text'),
    imageUrl: data.imageUrl || null,
    imageMime: data.imageMime || null,
    imageStoragePath: data.imageStoragePath || null,
    createdAtMs: messageCreatedAtMs(data)
  };
}

function isStaffMessage(m) {
  if (!m) return false;
  const role = String(m.role || '').trim();
  const authorType = String(m.authorType || '').trim();
  return role === 'staff' || authorType === 'staff';
}

function isVisitorMessage(m) {
  if (!m) return false;
  const role = String(m.role || '').trim();
  const authorType = String(m.authorType || '').trim();
  return role === 'visitor' || role === 'user' || authorType === 'visitor';
}

function isWaitingForStaff(conv) {
  const c = conv || {};
  return c.status === 'needs_human' || c.status === 'human' || c.aiEnabled === false;
}

async function loadMessages(db, conversationId, opts) {
  const limit = (opts && opts.limit) || 100;
  const sinceMs = opts && opts.sinceMs ? Number(opts.sinceMs) : 0;
  const recentFirst = !!(opts && opts.recentFirst);
  let q = db
    .collection(COLLECTION)
    .doc(conversationId)
    .collection('messages')
    .orderBy('createdAt', recentFirst ? 'desc' : 'asc')
    .limit(limit);
  const snap = await q.get();
  const items = [];
  snap.forEach((d) => {
    const item = mapMessageDoc(d);
    if (sinceMs && item.createdAtMs && item.createdAtMs <= sinceMs) return;
    items.push(item);
  });
  if (recentFirst) items.reverse();
  return items;
}

async function processStaffContactMessage(db, nkbkAi, opts) {
  const conversationId = opts.conversationId;
  let convData = opts.convData || {};
  const message = String(opts.message || '').trim();
  const requestedStaffId = String(opts.requestedStaffId || '').trim();
  const availability = await staffContactAvailability.evaluateContactAvailability(db, requestedStaffId);
  if (!availability.ok) throw new Error(availability.message || 'ไม่พบเจ้าหน้าที่');

  const admin = require('firebase-admin');
  const FieldValue = admin.firestore.FieldValue;
  const convRef = db.collection(COLLECTION).doc(conversationId);
  const requestedStaff = {
    uid: availability.staff.id,
    name: availability.staff.name,
    contactTitle: availability.staff.contactTitle || availability.staff.role || '',
    dept: availability.staff.role || ''
  };
  const contactLabel = availability.staff.contactTitle || availability.staff.name;
  const patch = {
    status: 'needs_human',
    aiEnabled: false,
    lastMessagePreview: previewText(message),
    unreadAdminCount: FieldValue.increment(1),
    unreadVisitorCount: 0,
    requestedStaff,
    contactMode: availability.contactMode || 'message',
    contactReason: availability.reason || '',
    contactStaffId: availability.staff.id,
    contactTitle: availability.staff.contactTitle || contactLabel
  };
  if (opts.conv && opts.conv.created) {
    patch.subject = previewText('ติดต่อ ' + contactLabel + ': ' + message, 80);
  } else if (!convData.subject || convData.subject === 'แชตใหม่') {
    patch.subject = previewText('ติดต่อ ' + contactLabel, 80);
  }
  await convRef.set(patch, { merge: true });

  const ack = availability.ackMessage || '';
  if (ack) {
    await appendMessage(db, conversationId, {
      role: 'assistant',
      authorType: 'monee_ai',
      content: ack
    });
  }

  try {
    await staffContactAnalytics.recordContactStart(db, availability.staff.id, conversationId);
  } catch (e) {
    console.error('[staff-contact] analytics start:', e.message);
  }

  await notifyInboxEvent(
    db,
    { id: conversationId, ...convData, ...patch, requestedStaff, lastMessagePreview: previewText(message) },
    {
      title: availability.canLiveChat ? 'ขอติดต่อเจ้าหน้าที่' : 'ฝากข้อความถึงเจ้าหน้าที่',
      body: previewText(contactLabel + ': ' + message, 100),
      severity: availability.canLiveChat ? 'warning' : 'info',
      url: 'moneechat?conversation=' + encodeURIComponent(conversationId)
    }
  );

  const snapAfter = await convRef.get();
  return {
    reply: ack,
    name: 'โมเน่',
    waitingForStaff: true,
    contactMode: availability.contactMode,
    canLiveChat: availability.canLiveChat,
    conversationId,
    staffTyping: staffTypingForMember(snapAfter.data() || {})
  };
}

async function handlePublicChat(db, nkbkAi, payload, reqMeta) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const message = String(body.message || '').trim();
  if (!message) throw new Error('กรุณาพิมพ์ข้อความ');
  const conversationIdIn = String(body.conversationId || '').trim();
  const visitorMeta = {
    label: 'ผู้เยี่ยมชมเว็บ',
    pageUrl: reqMeta && reqMeta.pageUrl,
    userAgent: reqMeta && reqMeta.userAgent,
    firstMessage: message
  };
  const conv = await getOrCreateConversation(db, conversationIdIn, visitorMeta);
  const conversationId = conv.id;
  let convData = conv.data || {};

  await appendMessage(db, conversationId, {
    role: 'visitor',
    authorType: 'visitor',
    content: message
  });

  const requestedStaffId = String(body.requestedStaffId || body.staffId || '').trim();
  const isContactFlow = body.contactStaff === true || !!requestedStaffId;
  const admin = require('firebase-admin');
  const FieldValue = admin.firestore.FieldValue;
  const convRef = db.collection(COLLECTION).doc(conversationId);

  if (isContactFlow && requestedStaffId) {
    const alreadyWaiting =
      isWaitingForStaff(convData) &&
      convData.requestedStaff &&
      String(convData.requestedStaff.uid || '') === requestedStaffId;
    if (alreadyWaiting) {
      await convRef.set(
        {
          lastMessagePreview: previewText(message),
          unreadAdminCount: FieldValue.increment(1)
        },
        { merge: true }
      );
      await notifyInboxEvent(
        db,
        { id: conversationId, ...convData, lastMessagePreview: previewText(message) },
        {
          title: 'ข้อความติดต่อเจ้าหน้าที่',
          body: previewText(message, 100)
        }
      );
      try {
        await staffContactAnalytics.recordVisitorMessage(db, requestedStaffId, conversationId);
      } catch (e) {
        console.error('[staff-contact] analytics message:', e.message);
      }
      const snapAfter = await convRef.get();
      return {
        ok: true,
        reply: '',
        name: 'โมเน่',
        waitingForStaff: true,
        conversationId,
        staffTyping: staffTypingForMember(snapAfter.data() || {})
      };
    }
    return processStaffContactMessage(db, nkbkAi, {
      conversationId,
      conv,
      convData,
      message,
      requestedStaffId,
      reqMeta
    });
  }

  const staffDirectory = await memberStaff.loadMemberStaffDirectory(db);
  const directHuman = isDirectHumanHandoff(message);
  const requestedStaff = directHuman ? detectRequestedStaff(message, staffDirectory) : null;

  const aiOff = convData.aiEnabled === false || convData.status === 'human' || convData.status === 'needs_human';
  let result;

  if (aiOff) {
    await convRef.set(
      {
        lastMessagePreview: previewText(message),
        unreadAdminCount: FieldValue.increment(1)
      },
      { merge: true }
    );
    await notifyInboxEvent(db, { id: conversationId, ...convData, lastMessagePreview: previewText(message) }, {
      title: 'ข้อความแชตโมเน่',
      body: previewText(message, 100)
    });
    result = {
      reply: '',
      name: (convData.assistantName || 'โมเน่').trim(),
      waitingForStaff: true,
      conversationId
    };
    const snapAfter = await convRef.get();
    result.staffTyping = staffTypingForMember(snapAfter.data() || {});
  } else if (directHuman) {
    const patch = {
      status: 'needs_human',
      aiEnabled: false,
      lastMessagePreview: previewText(message),
      unreadAdminCount: FieldValue.increment(1),
      unreadVisitorCount: 0
    };
    if (requestedStaff && requestedStaff.uid) patch.requestedStaff = requestedStaff;
    if (conv.created || !convData.subject || convData.subject === 'แชตใหม่') {
      patch.subject = previewText(message, 80);
    }
    await convRef.set(patch, { merge: true });
    await notifyInboxEvent(db, { id: conversationId, ...convData, ...patch, lastMessagePreview: previewText(message) }, {
      title: 'ขอคุยกับเจ้าหน้าที่',
      body: previewText(message, 100),
      severity: 'warning'
    });
    result = {
      reply: requestedStaff && requestedStaff.name
        ? `รับเรื่องแล้วค่ะ กำลังแจ้ง${requestedStaff.name} ให้ติดต่อกลับ กรุณารอสักครู่นะคะ`
        : 'รับเรื่องแล้วค่ะ เจ้าหน้าที่จะติดต่อกลับโดยเร็วที่สุด กรุณารอสักครู่นะคะ',
      name: 'โมเน่',
      waitingForStaff: true,
      conversationId
    };
    await appendMessage(db, conversationId, {
      role: 'assistant',
      authorType: 'monee_ai',
      content: result.reply
    });
    const snapAfter = await convRef.get();
    result.staffTyping = staffTypingForMember(snapAfter.data() || {});
  } else {
    const aiResult = await nkbkAi.runPublicMemberChat(db, body);
    const rich = {};
    if (aiResult.html) rich.html = aiResult.html;
    if (aiResult.downloads && aiResult.downloads.length) rich.downloads = aiResult.downloads;
    await appendMessage(db, conversationId, {
      role: 'assistant',
      authorType: 'monee_ai',
      content: aiResult.reply,
      rich: Object.keys(rich).length ? rich : null
    });
    const patch = {
      status: 'ai',
      lastMessagePreview: previewText(aiResult.reply),
      unreadAdminCount: FieldValue.increment(1),
      unreadVisitorCount: 0
    };
    if (conv.created || !convData.subject || convData.subject === 'แชตใหม่') {
      patch.subject = previewText(message, 80);
    }
    await convRef.set(patch, { merge: true });
    if (conv.created) {
      await notifyInboxEvent(db, { id: conversationId, lastMessagePreview: previewText(message) }, {
        title: 'แชตโมเน่ใหม่',
        body: previewText(message, 100)
      });
    }
    result = { ...aiResult, conversationId, waitingForStaff: false };
  }

  return result;
}

async function enrichStaffMessageMeta(db, messages) {
  const staff = (messages || []).filter(isStaffMessage);
  const avatarCache = new Map();
  for (const m of staff) {
    if (!m.authorId) continue;
    if (!m.authorPhotoUrl || !m.authorRoleLabel) {
      if (!avatarCache.has(m.authorId)) {
        try {
          const snap = await db.collection('users').doc(m.authorId).get();
          avatarCache.set(m.authorId, snap.exists ? snap.data() || {} : {});
        } catch (_) {
          avatarCache.set(m.authorId, {});
        }
      }
      const u = avatarCache.get(m.authorId) || {};
      if (!m.authorPhotoUrl) m.authorPhotoUrl = staffAvatarFromUser(u) || null;
      if (!m.authorPhotoPosition) m.authorPhotoPosition = staffPhotoPositionFromUser(u);
      const adminLike = /^(ผู้ดูแลระบบ|แอดมิน|admin)$/i;
      if (!m.authorRoleLabel || adminLike.test(String(m.authorRoleLabel || ''))) {
        m.authorRoleLabel = staffRoleLabelFromUser(u) || null;
      }
    }
  }
  return messages;
}

async function maybeAutoReleaseStaffWait(db, nkbkAi, conversationId) {
  const id = String(conversationId || '').trim();
  if (!id) return null;
  const ref = db.collection(COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const convData = snap.data() || {};
  if (!isWaitingForStaff(convData)) return null;

  const messages = await loadMessages(db, id, { limit: 30, recentFirst: true });
  const { lastVisitor, lastStaff } = latestVisitorAndStaff(messages);
  const visitorMs = lastVisitor ? lastVisitor.createdAtMs || 0 : 0;
  const staffMs = lastStaff ? lastStaff.createdAtMs || 0 : 0;
  const lastActivityMs = Math.max(visitorMs, staffMs);
  if (!lastActivityMs || Date.now() - lastActivityMs < STAFF_REPLY_TIMEOUT_MS) return null;
  const staffNeverRepliedSinceVisitor = !lastStaff || staffMs < visitorMs;
  const wasStaffContact = !!(convData.contactStaffId || convData.requestedStaff);

  const admin = require('firebase-admin');
  const FieldValue = admin.firestore.FieldValue;
  await ref.set(
    {
      status: 'ai',
      aiEnabled: true,
      assignedTo: null,
      requestedStaff: null,
      contactStaffId: null,
      contactMode: null,
      contactTitle: null
    },
    { merge: true }
  );

  let aiMessage = null;
  if (
    !wasStaffContact &&
    staffNeverRepliedSinceVisitor &&
    lastVisitor &&
    nkbkAi &&
    typeof nkbkAi.runPublicMemberChat === 'function'
  ) {
    try {
      const aiResult = await nkbkAi.runPublicMemberChat(db, { message: lastVisitor.content || '' });
      const rich = {};
      if (aiResult.html) rich.html = aiResult.html;
      if (aiResult.downloads && aiResult.downloads.length) rich.downloads = aiResult.downloads;
      await appendMessage(db, id, {
        role: 'assistant',
        authorType: 'monee_ai',
        content: aiResult.reply,
        rich: Object.keys(rich).length ? rich : null
      });
      await ref.set(
        {
          lastMessagePreview: previewText(aiResult.reply),
          unreadVisitorCount: FieldValue.increment(1)
        },
        { merge: true }
      );
      aiMessage = {
        role: 'assistant',
        content: aiResult.reply || '',
        html: aiResult.html || null,
        downloads: aiResult.downloads || [],
        name: aiResult.name || 'โมเน่'
      };
    } catch (e) {
      console.error('[member-chat] auto-release AI:', e.message);
    }
  }
  return { released: true, aiMessage, contactReleased: wasStaffContact };
}

async function pollPublicMessages(db, conversationId, sinceMs, nkbkAi) {
  const id = String(conversationId || '').trim();
  if (!id) throw new Error('ไม่พบ conversation');
  const ref = db.collection(COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('ไม่พบการสนทนา');
  let conv = snap.data() || {};

  const autoRelease = nkbkAi ? await maybeAutoReleaseStaffWait(db, nkbkAi, id) : null;
  if (autoRelease && autoRelease.released) {
    const snap2 = await ref.get();
    conv = snap2.data() || {};
  }

  const statusMessages = await loadMessages(db, id, { limit: 20, recentFirst: true });
  const waitingBanner = needsStaffReply(conv, statusMessages);

  let messages = await loadMessages(db, id, {
    sinceMs: sinceMs || 0,
    limit: 50,
    recentFirst: true
  });
  const staffOrSystem = messages.filter(isStaffMessage);
  await enrichStaffMessageMeta(db, staffOrSystem);
  return {
    ok: true,
    conversationId: id,
    status: conv.status || 'ai',
    aiEnabled: conv.aiEnabled !== false,
    unreadVisitorCount: Number(conv.unreadVisitorCount) || 0,
    messages: staffOrSystem,
    waitingForStaff: waitingBanner,
    staffTyping: staffTypingForMember(conv),
    allowMemberImages: conv.allowMemberImages === true,
    allowMemberImagesUpdatedAtMs: memberImagesToggleAtMs(conv),
    releasedToAi: !!(autoRelease && autoRelease.released),
    contactReleased: !!(autoRelease && autoRelease.contactReleased),
    conversationClosed: conv.status === 'closed',
    pendingRating: conv.status === 'closed' && conv.pendingRating === true && !conv.ratingSubmitted,
    aiMessage: autoRelease && autoRelease.aiMessage ? autoRelease.aiMessage : null
  };
}

async function touchStaffPresence(db, user, conversationId, opts) {
  const id = String(conversationId || '').trim();
  if (!id) throw new Error('ไม่พบการสนทนา');
  if (!user || !user.uid) throw new Error('ไม่มีสิทธิ์');
  const ref = db.collection(COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('ไม่พบการสนทนา');
  const data = snap.data() || {};
  if (!canAccessConversation(user, data) && !isFullInboxAccess(user)) {
    throw new Error('ไม่มีสิทธิ์');
  }
  const body = opts && typeof opts === 'object' ? opts : {};
  const admin = require('firebase-admin');
  const FieldValue = admin.firestore.FieldValue;
  const atMs = Date.now();
  await ref.set(
    {
      staffPresence: {
        uid: String(user.uid),
        name: String(user.fullname || 'เจ้าหน้าที่'),
        at: FieldValue.serverTimestamp(),
        atMs,
        typing: !!body.typing,
        focused: !!body.focused,
        viewing: body.viewing !== false
      }
    },
    { merge: true }
  );
  return { ok: true, atMs };
}

async function touchVisitorPresence(db, conversationId, opts) {
  const id = String(conversationId || '').trim();
  if (!id) throw new Error('ไม่พบการสนทนา');
  const ref = db.collection(COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('ไม่พบการสนทนา');
  const body = opts && typeof opts === 'object' ? opts : {};
  const admin = require('firebase-admin');
  const FieldValue = admin.firestore.FieldValue;
  const atMs = Date.now();
  await ref.set(
    {
      visitorPresence: {
        at: FieldValue.serverTimestamp(),
        atMs,
        typing: !!body.typing,
        focused: body.focused !== false
      }
    },
    { merge: true }
  );
  return { ok: true, atMs };
}

async function markVisitorRead(db, conversationId) {
  const ref = db.collection(COLLECTION).doc(conversationId);
  await ref.set({ unreadVisitorCount: 0 }, { merge: true });
}

async function listConversations(db, user, query) {
  const filter = String((query && query.filter) || 'all').trim();
  const limit = Math.min(Number(query && query.limit) || 50, 100);
  let snap;
  if (filter === 'mine' && user && user.uid) {
    snap = await db
      .collection(COLLECTION)
      .where('assignedTo.uid', '==', user.uid)
      .orderBy('lastMessageAt', 'desc')
      .limit(limit)
      .get()
      .catch(async () => {
        const all = await db.collection(COLLECTION).orderBy('lastMessageAt', 'desc').limit(limit * 3).get();
        return {
          docs: all.docs.filter((d) => {
            const c = d.data() || {};
            return (c.assignedTo && c.assignedTo.uid === user.uid) ||
              (c.requestedStaff && c.requestedStaff.uid === user.uid);
          }).slice(0, limit)
        };
      });
  } else if (filter === 'needs_human') {
    snap = await db
      .collection(COLLECTION)
      .where('status', '==', 'needs_human')
      .orderBy('lastMessageAt', 'desc')
      .limit(limit)
      .get()
      .catch(async () => {
        const all = await db.collection(COLLECTION).orderBy('lastMessageAt', 'desc').limit(limit * 3).get();
        return { docs: all.docs.filter((d) => (d.data().status === 'needs_human')).slice(0, limit) };
      });
  } else if (filter === 'unread') {
    snap = await db.collection(COLLECTION).orderBy('lastMessageAt', 'desc').limit(limit * 2).get();
    snap = { docs: snap.docs.filter((d) => Number((d.data() || {}).unreadAdminCount) > 0).slice(0, limit) };
  } else {
    snap = await db.collection(COLLECTION).orderBy('lastMessageAt', 'desc').limit(limit).get();
  }
  const items = [];
  for (const d of snap.docs || []) {
    const data = d.data() || {};
    if (!canAccessConversation(user, data)) continue;
    items.push(normalizeConversation(d.id, data));
  }
  return items;
}

function normalizeConversation(id, data) {
  const d = data || {};
  let lastMessageAtMs = 0;
  if (d.lastMessageAt && d.lastMessageAt.toMillis) lastMessageAtMs = d.lastMessageAt.toMillis();
  else if (d.lastMessageAt && d.lastMessageAt._seconds) lastMessageAtMs = d.lastMessageAt._seconds * 1000;
  return {
    id,
    channel: d.channel || 'web',
    status: d.status || 'ai',
    subject: d.subject || '',
    lastMessagePreview: d.lastMessagePreview || '',
    lastMessageAtMs,
    unreadAdminCount: Number(d.unreadAdminCount) || 0,
    unreadVisitorCount: Number(d.unreadVisitorCount) || 0,
    assignedTo: d.assignedTo || null,
    requestedStaff: d.requestedStaff || null,
    visitor: d.visitor || {},
    aiEnabled: d.aiEnabled !== false,
    allowMemberImages: d.allowMemberImages === true
  };
}

async function getConversationDetail(db, user, conversationId) {
  const ref = db.collection(COLLECTION).doc(conversationId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('ไม่พบการสนทนา');
  const data = snap.data() || {};
  if (!canAccessConversation(user, data)) throw new Error('ไม่มีสิทธิ์เข้าถึง');
  const messages = await loadMessages(db, conversationId, { limit: 200 });
  await enrichStaffMessageMeta(db, messages.filter(isStaffMessage));
  const admin = require('firebase-admin');
  const FieldValue = admin.firestore.FieldValue;
  await ref.set({ unreadAdminCount: 0 }, { merge: true });
  return {
    conversation: normalizeConversation(conversationId, data),
    messages,
    visitorTyping: visitorPresenceActive(data)
  };
}

async function staffReply(db, user, conversationId, content) {
  const text = String(content || '').trim();
  if (!text) throw new Error('กรุณาพิมพ์ข้อความ');
  if (text.length > 4000) throw new Error('ข้อความยาวเกินไป');
  const ref = db.collection(COLLECTION).doc(conversationId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('ไม่พบการสนทนา');
  const data = snap.data() || {};
  if (!canAccessConversation(user, data)) throw new Error('ไม่มีสิทธิ์ตอบ');

  const admin = require('firebase-admin');
  const FieldValue = admin.firestore.FieldValue;
  const authorName = String(user.fullname || user.name || 'เจ้าหน้าที่').trim();
  const authorRoleLabel = staffRoleLabelFromUser(user);
  const authorPhotoUrl = staffAvatarFromUser(user);
  const authorPhotoPosition = staffPhotoPositionFromUser(user);

  await appendMessage(db, conversationId, {
    role: 'staff',
    authorType: 'staff',
    authorId: user.uid,
    authorName,
    authorRoleLabel,
    authorPhotoUrl: authorPhotoUrl || null,
    authorPhotoPosition: authorPhotoPosition || null,
    content: text
  });

  await touchStaffPresence(db, user, conversationId, {
    typing: false,
    focused: false,
    viewing: false
  }).catch(() => {});

  const patch = {
    status: 'human',
    aiEnabled: false,
    lastMessagePreview: previewText(text),
    unreadVisitorCount: FieldValue.increment(1),
    unreadAdminCount: 0,
    assignedTo: data.assignedTo || { uid: user.uid, name: authorName }
  };
  await ref.set(patch, { merge: true });
  return { ok: true, authorName, authorRoleLabel };
}

async function assignConversation(db, user, conversationId, assignTo) {
  if (!canAssign(user)) throw new Error('ไม่มีสิทธิ์มอบหมาย');
  const targetUid = String((assignTo && assignTo.uid) || '').trim();
  const targetName = String((assignTo && assignTo.name) || '').trim();
  if (!targetUid) throw new Error('กรุณาเลือกเจ้าหน้าที่');
  const ref = db.collection(COLLECTION).doc(conversationId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('ไม่พบการสนทนา');
  await ref.set(
    {
      assignedTo: { uid: targetUid, name: targetName || 'เจ้าหน้าที่' },
      status: 'human',
      aiEnabled: false
    },
    { merge: true }
  );
  await notifyInboxEvent(db, { id: conversationId, assignedTo: { uid: targetUid } }, {
    title: 'มอบหมายแชตโมเน่',
    body: snap.data().subject || 'มีการมอบหมายแชตให้คุณ',
    severity: 'info'
  });
  return { ok: true };
}

async function takeoverConversation(db, user, conversationId) {
  const ref = db.collection(COLLECTION).doc(conversationId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('ไม่พบการสนทนา');
  const data = snap.data() || {};
  if (!canAccessConversation(user, data) && !isFullInboxAccess(user)) {
    if (!isFullInboxAccess(user)) throw new Error('ไม่มีสิทธิ์รับเรื่อง');
  }
  const authorName = String(user.fullname || 'เจ้าหน้าที่').trim();
  await ref.set(
    {
      status: 'human',
      aiEnabled: false,
      assignedTo: { uid: user.uid, name: authorName },
      unreadAdminCount: 0
    },
    { merge: true }
  );
  return { ok: true };
}

async function releaseConversation(db, user, conversationId, action) {
  const ref = db.collection(COLLECTION).doc(conversationId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('ไม่พบการสนทนา');
  const data = snap.data() || {};
  if (!canAccessConversation(user, data)) throw new Error('ไม่มีสิทธิ์');
  const close = action === 'close';
  const admin = require('firebase-admin');
  const FieldValue = admin.firestore.FieldValue;
  if (close) {
    await ref.set(
      {
        status: 'closed',
        aiEnabled: false,
        assignedTo: null,
        closedAt: FieldValue.serverTimestamp(),
        pendingRating: true
      },
      { merge: true }
    );
    const staffId = String(data.contactStaffId || (data.requestedStaff && data.requestedStaff.uid) || '').trim();
    if (staffId) {
      try {
        await staffContactAnalytics.recordCaseClosed(db, staffId, conversationId);
      } catch (e) {
        console.error('[staff-contact] analytics close:', e.message);
      }
    }
  } else {
    await ref.set(
      { status: 'ai', aiEnabled: true, assignedTo: null, requestedStaff: null, contactStaffId: null },
      { merge: true }
    );
  }
  return { ok: true, status: close ? 'closed' : 'ai' };
}

async function submitContactRating(db, payload) {
  const conversationId = String((payload && payload.conversationId) || '').trim();
  const score = Number(payload && payload.score);
  const comment = String((payload && payload.comment) || '').trim().slice(0, 500);
  if (!conversationId) throw new Error('ไม่พบการสนทนา');
  if (!score || score < 1 || score > 5) throw new Error('กรุณาให้คะแนน 1–5 ดาว');
  const ref = db.collection(COLLECTION).doc(conversationId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('ไม่พบการสนทนา');
  const data = snap.data() || {};
  if (data.ratingSubmitted) return { ok: true, message: 'ขอบคุณที่ให้คะแนนแล้วค่ะ' };
  const staffId = String(data.contactStaffId || (data.requestedStaff && data.requestedStaff.uid) || '').trim();
  const admin = require('firebase-admin');
  const FieldValue = admin.firestore.FieldValue;
  await ref.set(
    {
      ratingSubmitted: true,
      pendingRating: false,
      satisfactionScore: score,
      satisfactionComment: comment || null,
      ratedAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );
  if (staffId) {
    try {
      await staffContactAnalytics.recordRating(db, staffId, conversationId, score, comment);
    } catch (e) {
      console.error('[staff-contact] analytics rating:', e.message);
    }
  }
  return { ok: true, message: 'ขอบคุณสำหรับความคิดเห็นค่ะ' };
}

async function listStaffForAssign(db, user) {
  const canAssignFlag = canAssign(user);
  if (!canAssignFlag) {
    return { canAssign: false, isFullAccess: isFullInboxAccess(user), items: [] };
  }
  const snap = await db.collection('users').where('group', '==', 'เจ้าหน้าที่').get();
  const items = snap.docs
    .map(function (d) {
      const data = d.data() || {};
      return {
        id: d.id,
        fullname: String(data.fullname || data.name || '').trim(),
        position: String(data.position || '').trim(),
        department: String(data.department || '').trim()
      };
    })
    .filter(function (u) {
      return u.fullname || u.id;
    })
    .sort(function (a, b) {
      return String(a.fullname || a.id).localeCompare(String(b.fullname || b.id), 'th');
    });
  return { canAssign: true, isFullAccess: true, items };
}

async function getStats(db, user) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const snap = await db.collection(COLLECTION).orderBy('lastMessageAt', 'desc').limit(200).get();
  let todayCount = 0;
  let needsHuman = 0;
  let aiCount = 0;
  let humanCount = 0;
  snap.forEach((d) => {
    const c = d.data() || {};
    if (!canAccessConversation(user, c)) return;
    let ms = 0;
    if (c.createdAt && c.createdAt.toMillis) ms = c.createdAt.toMillis();
    else if (c.lastMessageAt && c.lastMessageAt.toMillis) ms = c.lastMessageAt.toMillis();
    if (ms >= todayMs) todayCount += 1;
    if (c.status === 'needs_human') needsHuman += 1;
    if (c.status === 'ai') aiCount += 1;
    if (c.status === 'human') humanCount += 1;
  });
  return { todayCount, needsHuman, aiCount, humanCount, total: snap.size };
}

function memberImagesToggleAtMs(conv) {
  const d = conv || {};
  if (d.allowMemberImagesUpdatedAtMs != null) {
    const n = Number(d.allowMemberImagesUpdatedAtMs);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  const c = d.allowMemberImagesUpdatedAt;
  if (c == null) return 0;
  if (typeof c === 'number') return c > 1e12 ? c : c * 1000;
  if (typeof c.toMillis === 'function') return c.toMillis();
  if (c._seconds != null) return Number(c._seconds) * 1000;
  if (c.seconds != null) return Number(c.seconds) * 1000;
  return 0;
}

function canMemberSendImages(conv) {
  const c = conv || {};
  if (c.allowMemberImages !== true) return false;
  if (c.status === 'closed') return false;
  return true;
}

function getMemberChatStorageBucket() {
  if (_memberChatStorageBucket) return _memberChatStorageBucket;
  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({
        projectId: STORAGE_PROJECT_ID,
        storageBucket: STORAGE_BUCKET_CANDIDATES[0]
      });
    }
    for (const name of STORAGE_BUCKET_CANDIDATES) {
      try {
        _memberChatStorageBucket = admin.storage().bucket(name);
        return _memberChatStorageBucket;
      } catch (_) {}
    }
    _memberChatStorageBucket = admin.storage().bucket();
    return _memberChatStorageBucket;
  } catch (e) {
    console.warn('[member-chat] Storage init failed:', e.message);
    return null;
  }
}

function memberChatMimeToExt(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  return 'png';
}

function normalizeMemberImageMime(mime) {
  const m = String(mime || '').trim().toLowerCase();
  if (m === 'image/jpg') return 'image/jpeg';
  return m;
}

function parseMemberImageBase64(raw) {
  const s = String(raw || '').trim();
  if (!s) return { mime: '', b64: '' };
  const m = s.match(/^data:([^;]+);base64,(.+)$/i);
  if (m) return { mime: normalizeMemberImageMime(m[1]), b64: m[2] };
  return { mime: '', b64: s };
}

async function uploadMemberChatImageToStorage(conversationId, messageId, b64, mime) {
  const bucket = getMemberChatStorageBucket();
  if (!bucket) throw new Error('ระบบอัปโหลดรูปไม่พร้อม');
  const safeConv = String(conversationId || '').replace(/[^\w-]+/g, '_').slice(0, 80);
  const safeMsg = String(messageId || '').replace(/[^\w-]+/g, '_').slice(0, 80);
  const filePath = `member-chat-images/${safeConv}/${safeMsg}.${memberChatMimeToExt(mime)}`;
  const file = bucket.file(filePath);
  const buf = Buffer.from(String(b64), 'base64');
  if (!buf.length) throw new Error('ไฟล์รูปว่าง');
  if (buf.length > MEMBER_IMAGE_MAX_BYTES) throw new Error('รูปใหญ่เกิน 5 MB');
  const token = crypto.randomBytes(16).toString('hex');
  await file.save(buf, {
    metadata: {
      contentType: mime || 'image/jpeg',
      cacheControl: 'private, max-age=3600',
      metadata: {
        firebaseStorageDownloadTokens: token,
        conversationId: String(conversationId || ''),
        messageId: String(messageId || '')
      }
    },
    resumable: false
  });
  const encoded = encodeURIComponent(filePath);
  const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encoded}?alt=media&token=${token}`;
  return { publicUrl, filePath };
}

async function setAllowMemberImages(db, user, conversationId, allow) {
  const id = String(conversationId || '').trim();
  if (!id) throw new Error('ไม่พบการสนทนา');
  if (!user || !user.uid) throw new Error('ไม่มีสิทธิ์');
  const ref = db.collection(COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('ไม่พบการสนทนา');
  const data = snap.data() || {};
  if (!canAccessConversation(user, data)) throw new Error('ไม่มีสิทธิ์');
  const admin = require('firebase-admin');
  const FieldValue = admin.firestore.FieldValue;
  const enabled = !!allow;
  const atMs = Date.now();
  await ref.set(
    {
      allowMemberImages: enabled,
      allowMemberImagesUpdatedAt: FieldValue.serverTimestamp(),
      allowMemberImagesUpdatedAtMs: atMs,
      allowMemberImagesBy: enabled
        ? {
            uid: String(user.uid),
            name: String(user.fullname || user.name || 'เจ้าหน้าที่').trim()
          }
        : null
    },
    { merge: true }
  );
  return { allowMemberImages: enabled, allowMemberImagesUpdatedAtMs: atMs };
}

async function visitorSendImage(db, payload) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const conversationId = String(body.conversationId || '').trim();
  if (!conversationId) throw new Error('ไม่พบการสนทนา');
  const parsed = parseMemberImageBase64(body.imageBase64 || body.image || body.dataUrl);
  let mime = normalizeMemberImageMime(body.mimeType || body.mime || parsed.mime);
  const b64 = parsed.b64;
  if (!b64) throw new Error('กรุณาเลือกรูปภาพ');
  if (!mime || !MEMBER_IMAGE_MIMES.has(mime)) throw new Error('รองรับเฉพาะ JPG, PNG, WEBP, GIF');

  const ref = db.collection(COLLECTION).doc(conversationId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('ไม่พบการสนทนา');
  const convData = snap.data() || {};
  if (!canMemberSendImages(convData)) {
    throw new Error('เจ้าหน้าที่ยังไม่อนุญาตให้ส่งรูปในแชตนี้');
  }

  const admin = require('firebase-admin');
  const FieldValue = admin.firestore.FieldValue;
  const messageRef = ref.collection('messages').doc();
  const upload = await uploadMemberChatImageToStorage(conversationId, messageRef.id, b64, mime);
  const preview = '[รูปภาพ]';

  await messageRef.set({
    role: 'visitor',
    authorType: 'visitor',
    content: preview,
    messageType: 'image',
    imageUrl: upload.publicUrl,
    imageMime: mime,
    imageStoragePath: upload.filePath,
    createdAt: FieldValue.serverTimestamp()
  });

  await ref.set(
    {
      lastMessagePreview: preview,
      unreadAdminCount: FieldValue.increment(1)
    },
    { merge: true }
  );

  const aiActive =
    convData.status === 'ai' &&
    convData.aiEnabled !== false &&
    !convData.contactStaffId &&
    convData.status !== 'closed';
  if (aiActive) {
    await ref.set(
      {
        status: 'needs_human',
        aiEnabled: false,
        lastMessagePreview: preview
      },
      { merge: true }
    );
  }

  await notifyInboxEvent(
    db,
    { id: conversationId, ...convData, lastMessagePreview: preview },
    {
      title: 'สมาชิกส่งรูปภาพ',
      body: preview
    }
  );

  if (convData.contactStaffId) {
    try {
      await staffContactAnalytics.recordVisitorMessage(db, convData.contactStaffId, conversationId);
    } catch (e) {
      console.error('[staff-contact] analytics image:', e.message);
    }
  }

  return {
    messageId: messageRef.id,
    imageUrl: upload.publicUrl,
    messageType: 'image',
    content: preview,
    createdAtMs: Date.now()
  };
}

async function staffSendImage(db, user, conversationId, payload) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const id = String(conversationId || '').trim();
  if (!id) throw new Error('ไม่พบการสนทนา');
  if (!user || !user.uid) throw new Error('ไม่มีสิทธิ์');

  const parsed = parseMemberImageBase64(body.imageBase64 || body.image || body.dataUrl);
  let mime = normalizeMemberImageMime(body.mimeType || body.mime || parsed.mime);
  const b64 = parsed.b64;
  if (!b64) throw new Error('กรุณาเลือกรูปภาพ');
  if (!mime || !MEMBER_IMAGE_MIMES.has(mime)) throw new Error('รองรับเฉพาะ JPG, PNG, WEBP, GIF');

  const ref = db.collection(COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('ไม่พบการสนทนา');
  const data = snap.data() || {};
  if (!canAccessConversation(user, data)) throw new Error('ไม่มีสิทธิ์ตอบ');
  if (data.status === 'closed') throw new Error('เคสนี้ปิดแล้ว');

  const admin = require('firebase-admin');
  const FieldValue = admin.firestore.FieldValue;
  const authorName = String(user.fullname || user.name || 'เจ้าหน้าที่').trim();
  const authorRoleLabel = staffRoleLabelFromUser(user);
  const authorPhotoUrl = staffAvatarFromUser(user);
  const authorPhotoPosition = staffPhotoPositionFromUser(user);
  const messageRef = ref.collection('messages').doc();
  const upload = await uploadMemberChatImageToStorage(id, messageRef.id, b64, mime);
  const preview = '[รูปภาพ]';

  await messageRef.set({
    role: 'staff',
    authorType: 'staff',
    authorId: user.uid,
    authorName,
    authorRoleLabel,
    authorPhotoUrl: authorPhotoUrl || null,
    authorPhotoPosition: authorPhotoPosition || null,
    content: preview,
    messageType: 'image',
    imageUrl: upload.publicUrl,
    imageMime: mime,
    imageStoragePath: upload.filePath,
    createdAt: FieldValue.serverTimestamp()
  });

  await touchStaffPresence(db, user, id, {
    typing: false,
    focused: false,
    viewing: false
  }).catch(() => {});

  await ref.set(
    {
      status: 'human',
      aiEnabled: false,
      lastMessagePreview: preview,
      unreadVisitorCount: FieldValue.increment(1),
      unreadAdminCount: 0,
      assignedTo: data.assignedTo || { uid: user.uid, name: authorName }
    },
    { merge: true }
  );

  return {
    ok: true,
    messageId: messageRef.id,
    imageUrl: upload.publicUrl,
    messageType: 'image',
    content: preview,
    authorName,
    authorRoleLabel,
    createdAtMs: Date.now()
  };
}

module.exports = {
  COLLECTION,
  newConversationId,
  mapUserToStaff,
  isFullInboxAccess,
  canAccessConversation,
  canAssign,
  resolveStaffFromToken,
  resolveStaffFromMonitorSession,
  handlePublicChat,
  pollPublicMessages,
  touchStaffPresence,
  touchVisitorPresence,
  markVisitorRead,
  listConversations,
  getConversationDetail,
  staffReply,
  assignConversation,
  takeoverConversation,
  releaseConversation,
  submitContactRating,
  getStats,
  listStaffForAssign,
  normalizeConversation,
  notifyInboxEvent,
  setAllowMemberImages,
  visitorSendImage,
  staffSendImage,
  canMemberSendImages
};
