/**
 * AI โมเน่ — Member chat inbox (web MVP, LINE phase 2 ready)
 */
const crypto = require('crypto');
const memberStaff = require('./member-staff');

const COLLECTION = 'member_chat_conversations';
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
    avatar: staffAvatarFromUser(u)
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

async function resolveStaffFromMonitorSession(db, nkbkAi, session) {
  if (!session || !session.username) return null;
  const found = await nkbkAi.findV2UserDoc(db, session.username);
  if (!found || !found.docId) return null;
  const data = found.data || {};
  return mapUserToStaff({
    uid: found.docId,
    ...data,
    fullname: String(data.fullname || data.name || session.username).trim(),
    email: String(data.email || '').trim(),
    username: String(session.username || '').trim()
  });
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
  await createNotification(db, { ...base, targetType: 'role', targetValue: 'แอดมิน' });
  await createNotification(db, { ...base, targetType: 'role', targetValue: 'ผู้ดูแลระบบ' });
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
    content: String(msg.content || ''),
    createdAt: FieldValue.serverTimestamp()
  };
  if (msg.rich && typeof msg.rich === 'object') doc.rich = msg.rich;
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

function messageCreatedAtMs(data) {
  const d = data || {};
  if (d.createdAt && d.createdAt.toMillis) return d.createdAt.toMillis();
  if (d.createdAt && d.createdAt._seconds) return d.createdAt._seconds * 1000;
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
    content: data.content || '',
    rich: data.rich || null,
    createdAtMs: messageCreatedAtMs(data)
  };
}

function isStaffMessage(m) {
  if (!m) return false;
  const role = String(m.role || '').trim();
  const authorType = String(m.authorType || '').trim();
  return role === 'staff' || authorType === 'staff';
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

  const admin = require('firebase-admin');
  const FieldValue = admin.firestore.FieldValue;
  const convRef = db.collection(COLLECTION).doc(conversationId);

  const staffDirectory = await memberStaff.loadMemberStaffDirectory(db);
  const directHuman = isDirectHumanHandoff(message);
  const requestedStaff = directHuman ? detectRequestedStaff(message, staffDirectory) : null;

  const aiOff = convData.aiEnabled === false || convData.status === 'human' || convData.status === 'needs_human';
  let result;

  if (aiOff && convData.status !== 'needs_human') {
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
      reply: 'ข้อความของคุณถูกส่งถึงเจ้าหน้าที่แล้วค่ะ กรุณารอสักครู่นะคะ',
      name: (convData.assistantName || 'โมเน่').trim(),
      waitingForStaff: true,
      conversationId
    };
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
      const adminLike = /^(ผู้ดูแลระบบ|แอดมิน|admin)$/i;
      if (!m.authorRoleLabel || adminLike.test(String(m.authorRoleLabel || ''))) {
        m.authorRoleLabel = staffRoleLabelFromUser(u) || null;
      }
    }
  }
  return messages;
}

async function pollPublicMessages(db, conversationId, sinceMs) {
  const id = String(conversationId || '').trim();
  if (!id) throw new Error('ไม่พบ conversation');
  const ref = db.collection(COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('ไม่พบการสนทนา');
  const conv = snap.data() || {};
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
    waitingForStaff: conv.status === 'needs_human' || conv.status === 'human' || conv.aiEnabled === false
  };
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
    aiEnabled: d.aiEnabled !== false
  };
}

async function getConversationDetail(db, user, conversationId) {
  const ref = db.collection(COLLECTION).doc(conversationId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('ไม่พบการสนทนา');
  const data = snap.data() || {};
  if (!canAccessConversation(user, data)) throw new Error('ไม่มีสิทธิ์เข้าถึง');
  const messages = await loadMessages(db, conversationId, { limit: 200 });
  const admin = require('firebase-admin');
  const FieldValue = admin.firestore.FieldValue;
  await ref.set({ unreadAdminCount: 0 }, { merge: true });
  return {
    conversation: normalizeConversation(conversationId, data),
    messages
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

  await appendMessage(db, conversationId, {
    role: 'staff',
    authorType: 'staff',
    authorId: user.uid,
    authorName,
    authorRoleLabel,
    authorPhotoUrl: authorPhotoUrl || null,
    content: text
  });

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
  await ref.set(
    close
      ? { status: 'closed', aiEnabled: false, assignedTo: null }
      : { status: 'ai', aiEnabled: true, assignedTo: null, requestedStaff: null },
    { merge: true }
  );
  return { ok: true, status: close ? 'closed' : 'ai' };
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

module.exports = {
  COLLECTION,
  newConversationId,
  isFullInboxAccess,
  canAccessConversation,
  canAssign,
  resolveStaffFromToken,
  resolveStaffFromMonitorSession,
  handlePublicChat,
  pollPublicMessages,
  markVisitorRead,
  listConversations,
  getConversationDetail,
  staffReply,
  assignConversation,
  takeoverConversation,
  releaseConversation,
  getStats,
  normalizeConversation,
  notifyInboxEvent
};
