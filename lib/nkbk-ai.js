/**
 * NKBK Desktop AI — OpenAI chat + per-user memory (Firestore)
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DESKTOP_AI_CONFIG_DOC = 'desktop_ai';
const AI_CHAT_CONFIG_DOC = 'ai_chat';
const MEMORY_COLLECTION = 'ai_desktop_memory';
const DEFAULT_ASSISTANT_NAME = 'ChatGPT โมเน่';
const DEFAULT_DISPLAY_NAME = 'โมเน่';

function sanitizeMemoryId(username) {
  const s = String(username || 'unknown').trim().replace(/[/\\#?]/g, '_').slice(0, 120);
  return s || 'unknown';
}

async function getDesktopAiConfig(db) {
  const snap = await db.collection('config').doc(DESKTOP_AI_CONFIG_DOC).get();
  if (!snap.exists) return null;
  return snap.data();
}

async function getAiChatConfig(db) {
  const snap = await db.collection('config').doc(AI_CHAT_CONFIG_DOC).get();
  if (!snap.exists) return null;
  return snap.data();
}

function lineRulesToPrompt(line) {
  if (!line) return '';
  if (Array.isArray(line.systemRules) && line.systemRules.length) {
    return line.systemRules.map((r) => (r && r.text) || '').filter(Boolean).join('\n');
  }
  if (typeof line.systemRulesSummary === 'string') return line.systemRulesSummary.trim();
  return '';
}

function normalizeDesktopConfig(raw, source) {
  if (!raw) return null;
  const name = (raw.assistantName || DEFAULT_ASSISTANT_NAME).trim();
  const displayName = (raw.displayName || name.replace(/^ChatGPT\s*/i, '').trim() || DEFAULT_DISPLAY_NAME).trim();
  return {
    ...raw,
    enabled: !!raw.enabled,
    openaiApiKey: raw.openaiApiKey || '',
    model: raw.model || 'gpt-4o-mini',
    assistantName: name,
    displayName,
    systemPrompt: raw.systemPrompt || '',
    userCallName: (raw.userCallName || '').trim(),
    chatHistoryMax: raw.chatHistoryMax || 20,
    maxTokens: raw.maxTokens || 1500,
    imageModel: raw.imageModel || 'gpt-image-2',
    responsesModel: raw.responsesModel || 'gpt-5.5',
    allowedUsernames: Array.isArray(raw.allowedUsernames) ? raw.allowedUsernames : [],
    allowAllUsers: raw.allowAllUsers === true || !Array.isArray(raw.allowedUsernames) || raw.allowedUsernames.length === 0,
    source: source || 'desktop_ai'
  };
}

function configFromAiChat(line) {
  if (!line || !line.enabled || !(line.openaiApiKey && String(line.openaiApiKey).trim())) return null;
  const aiName = (line.name || DEFAULT_DISPLAY_NAME).trim();
  const genderNote =
    line.gender === 'female' ? 'ใช้คำลงท้าย คะ/ค่ะ' : line.gender === 'male' ? 'ใช้คำลงท้าย ครับ' : '';
  let systemPrompt = lineRulesToPrompt(line);
  if (genderNote) systemPrompt = (systemPrompt ? systemPrompt + '\n' : '') + genderNote;
  return normalizeDesktopConfig(
    {
      enabled: true,
      openaiApiKey: line.openaiApiKey,
      model: line.model || 'gpt-4o-mini',
      assistantName: `ChatGPT ${aiName}`,
      displayName: aiName,
      userCallName: (line.userCallName || '').trim(),
      systemPrompt,
      chatHistoryMax: line.memoryMaxPerScope || 20,
      maxTokens: 1500,
      imageModel: line.imageModel || 'gpt-image-2',
      responsesModel: line.responsesModel || 'gpt-5.5',
      allowedUsernames: [],
      allowAllUsers: true
    },
    'ai_chat'
  );
}

/** รวม config/desktop_ai กับ config/ai_chat (โมเน่) — desktop ชนะถ้าเปิดและมี key */
async function getEffectiveAiConfig(db) {
  const [desktopRaw, lineRaw] = await Promise.all([getDesktopAiConfig(db), getAiChatConfig(db)]);
  const desktop = normalizeDesktopConfig(desktopRaw, 'desktop_ai');
  if (desktop && desktop.enabled && String(desktop.openaiApiKey).trim()) return desktop;
  const fromLine = configFromAiChat(lineRaw);
  if (fromLine) return fromLine;
  return desktop || fromLine;
}

function isUserAllowed(config, username) {
  if (!config || !config.enabled) return false;
  if (!(config.openaiApiKey && String(config.openaiApiKey).trim())) return false;
  if (config.allowAllUsers || config.source === 'ai_chat') return true;
  const allowed = config.allowedUsernames;
  if (!allowed || !Array.isArray(allowed) || allowed.length === 0) return true;
  const u = String(username || '').trim().toLowerCase();
  const padded = /^\d+$/.test(u) ? u.padStart(6, '0') : u;
  return allowed.some((a) => {
    const x = String(a).trim().toLowerCase();
    const xp = /^\d+$/.test(x) ? x.padStart(6, '0') : x;
    return x === u || xp === padded || x === padded;
  });
}

function denyMessage(config) {
  const n = (config && config.displayName) || DEFAULT_DISPLAY_NAME;
  return `ไม่มีสิทธิ์ใช้งาน ${n} AI`;
}

function publicConfig(config) {
  if (!config) {
    return {
      enabled: false,
      assistantName: DEFAULT_ASSISTANT_NAME,
      displayName: DEFAULT_DISPLAY_NAME,
      model: 'gpt-4o-mini',
      hasApiKey: false
    };
  }
  return {
    enabled: !!config.enabled,
    assistantName: config.assistantName || DEFAULT_ASSISTANT_NAME,
    displayName: config.displayName || DEFAULT_DISPLAY_NAME,
    model: config.model || 'gpt-4o-mini',
    hasApiKey: !!(config.openaiApiKey && String(config.openaiApiKey).trim()),
    supportsImages: true
  };
}

function makeThreadId() {
  return 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function threadTitleFromHistory(history, fallback) {
  const list = Array.isArray(history) ? history : [];
  for (const m of list) {
    if (m && m.role === 'user' && m.content) {
      const s = String(m.content).trim().slice(0, 42);
      if (s) return s;
    }
  }
  return fallback || 'แชทใหม่';
}

function makeShareId() {
  return 's_' + Math.random().toString(36).slice(2, 10);
}

function ensureThreadMeta(t) {
  const out = t && typeof t === 'object' ? { ...t } : {};
  if (!out.shareId) out.shareId = makeShareId();
  if (out.pinned == null) out.pinned = false;
  if (out.archived == null) out.archived = false;
  return out;
}

function normalizeThreads(memory) {
  const m = memory && typeof memory === 'object' ? memory : {};
  let threads = Array.isArray(m.threads) ? m.threads.filter((t) => t && t.id).map(ensureThreadMeta) : [];
  let activeThreadId = m.activeThreadId != null ? String(m.activeThreadId) : null;

  if (!threads.length && Array.isArray(m.chatHistory) && m.chatHistory.length) {
    const id = makeThreadId();
    threads = [
      ensureThreadMeta({
        id,
        title: threadTitleFromHistory(m.chatHistory, 'แชทเดิม'),
        chatHistory: m.chatHistory,
        createdAt: Date.now(),
        updatedAt: Date.now()
      })
    ];
    activeThreadId = id;
  }

  if (activeThreadId && !threads.some((t) => t.id === activeThreadId)) {
    activeThreadId = threads.length ? threads[0].id : null;
  }

  return { threads, activeThreadId };
}

function getActiveThread(threads, activeThreadId) {
  const list = Array.isArray(threads) ? threads : [];
  if (!activeThreadId) return null;
  return list.find((t) => t.id === activeThreadId) || null;
}

function findThreadByRef(threads, ref) {
  const r = String(ref || '').trim();
  if (!r) return null;
  return (Array.isArray(threads) ? threads : []).find((t) => t.id === r || t.shareId === r) || null;
}

async function getUserMemory(db, username) {
  const id = sanitizeMemoryId(username);
  const snap = await db.collection(MEMORY_COLLECTION).doc(id).get();
  return snap.exists ? snap.data() : null;
}

function sanitizeForFirestore(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeForFirestore(item))
      .filter((item) => item !== undefined);
  }
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (val === undefined) continue;
    const clean = sanitizeForFirestore(val);
    if (clean !== undefined) out[key] = clean;
  }
  return out;
}

async function saveUserMemory(db, username, fullname, payload) {
  const id = sanitizeMemoryId(username);
  const ref = db.collection(MEMORY_COLLECTION).doc(id);
  const prev = (await ref.get()).data() || {};
  const norm = normalizeThreads(prev);
  let threads = norm.threads;
  let activeThreadId =
    payload.activeThreadId != null ? String(payload.activeThreadId) : norm.activeThreadId;

  if (Array.isArray(payload.threads)) {
    threads = payload.threads;
  } else if (payload.chatHistory != null && activeThreadId) {
    threads = threads.map((t) => {
      if (t.id !== activeThreadId) return t;
      const hist = sanitizeForFirestore(payload.chatHistory);
      return {
        ...t,
        chatHistory: hist,
        title: threadTitleFromHistory(hist, t.title || 'แชทใหม่'),
        updatedAt: Date.now()
      };
    });
  }

  const standingInstructions =
    payload.standingInstructions != null
      ? String(payload.standingInstructions).trim()
      : String(prev.standingInstructions || '').trim();
  const userCallName =
    payload.userCallName != null
      ? String(payload.userCallName).trim()
      : String(prev.userCallName || '').trim();

  if (!activeThreadId || !threads.some((t) => t.id === activeThreadId)) {
    activeThreadId = threads[0] ? threads[0].id : null;
  }

  await ref.set(
    sanitizeForFirestore({
      username: String(username).trim(),
      fullname: fullname || prev.fullname || '',
      standingInstructions,
      userCallName,
      threads,
      activeThreadId,
      updatedAt: new Date()
    }),
    { merge: true }
  );

  const active = getActiveThread(threads, activeThreadId);
  return {
    standingInstructions,
    userCallName,
    threads,
    activeThreadId,
    chatHistory: active && Array.isArray(active.chatHistory) ? active.chatHistory : []
  };
}

/** หา user doc ใน collection users (logic เดียวกับ monitor login) */
async function findV2UserDoc(db, usernameRaw) {
  if (!db) return null;
  const raw = String(usernameRaw || '').trim();
  if (!raw) return null;
  let username = raw;
  if (/^\d+$/.test(username)) username = username.padStart(6, '0').slice(-6);

  const tryQuery = async (u) => {
    const snap = await db.collection('users').where('username', '==', u).limit(1).get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { docId: doc.id, data: doc.data() };
  };

  let user = await tryQuery(username);
  if (!user && raw !== username) user = await tryQuery(raw);
  if (!user) {
    const lower = raw.toLowerCase();
    const allSnap = await db.collection('users').limit(800).get();
    for (const doc of allSnap.docs) {
      if (String(doc.data().username || '').toLowerCase() === lower) {
        user = { docId: doc.id, data: doc.data() };
        break;
      }
    }
  }
  return user;
}

/** บันทึกชื่อเรียก — sync ไป users.aiChatCallName (ใช้ร่วมกับ LINE) */
async function syncUserCallName(db, username, callNameRaw) {
  const callName = String(callNameRaw || '').trim();
  const user = await findV2UserDoc(db, username);
  if (user && user.docId) {
    await db.collection('users').doc(user.docId).set(
      { aiChatCallName: callName || null, updatedAt: new Date() },
      { merge: true }
    );
  }
  return callName || null;
}

async function createThread(db, username, fullname) {
  const prev = (await getUserMemory(db, username)) || {};
  const norm = normalizeThreads(prev);
  const id = makeThreadId();
  const threads = [
    ensureThreadMeta({
      id,
      title: 'แชทใหม่',
      chatHistory: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }),
    ...norm.threads
  ];
  return saveUserMemory(db, username, fullname, { threads, activeThreadId: id });
}

async function deleteThread(db, username, fullname, threadId) {
  const tid = String(threadId || '').trim();
  const prev = (await getUserMemory(db, username)) || {};
  const norm = normalizeThreads(prev);
  let threads = norm.threads.filter((t) => t.id !== tid);
  let activeThreadId = norm.activeThreadId;
  if (activeThreadId === tid) {
    const visible = threads.filter((t) => !t.archived);
    activeThreadId = visible[0] ? visible[0].id : null;
  }
  return saveUserMemory(db, username, fullname, { threads, activeThreadId });
}

async function switchThread(db, username, fullname, threadId) {
  const tid = String(threadId || '').trim();
  const prev = (await getUserMemory(db, username)) || {};
  const norm = normalizeThreads(prev);
  if (!norm.threads.some((t) => t.id === tid)) throw new Error('ไม่พบบทสนทนา');
  return saveUserMemory(db, username, fullname, { activeThreadId: tid });
}

async function updateThreadFields(db, username, fullname, threadId, patch) {
  const tid = String(threadId || '').trim();
  const prev = (await getUserMemory(db, username)) || {};
  const norm = normalizeThreads(prev);
  if (!norm.threads.some((t) => t.id === tid)) throw new Error('ไม่พบบทสนทนา');
  const threads = norm.threads.map((t) => {
    if (t.id !== tid) return t;
    return ensureThreadMeta({ ...t, ...patch, updatedAt: Date.now() });
  });
  let activeThreadId = norm.activeThreadId;
  if (patch.archived && activeThreadId === tid) {
    const visible = threads.filter((t) => !t.archived);
    activeThreadId = visible[0] ? visible[0].id : null;
  }
  return saveUserMemory(db, username, fullname, { threads, activeThreadId });
}

async function pinThread(db, username, fullname, threadId, pinned) {
  return updateThreadFields(db, username, fullname, threadId, {
    pinned: !!pinned,
    pinnedAt: pinned ? Date.now() : null
  });
}

async function archiveThread(db, username, fullname, threadId) {
  return updateThreadFields(db, username, fullname, threadId, {
    archived: true,
    archivedAt: Date.now()
  });
}

function publicThreads(threads, activeThreadId, historyMax) {
  return (Array.isArray(threads) ? threads : []).map((t) => ({
    id: t.id,
    shareId: t.shareId || t.id,
    title: t.title || 'แชท',
    pinned: !!t.pinned,
    archived: !!t.archived,
    updatedAt: t.updatedAt || t.createdAt || 0,
    pinnedAt: t.pinnedAt || 0,
    messageCount: Array.isArray(t.chatHistory) ? t.chatHistory.length : 0,
    active: t.id === activeThreadId,
    chatHistory:
      t.id === activeThreadId ? trimChatHistory(t.chatHistory, historyMax) : undefined
  }));
}

/** คำเรียกผู้ใช้รายบุคคลจาก users.aiChatCallName (ตั้งในแอดมิน / โปรแกรม — sync กัน) */
async function findUserAiChatCallName(db, usernameRaw) {
  const user = await findV2UserDoc(db, usernameRaw);
  if (!user || !user.data || user.data.aiChatCallName == null) return null;
  const s = String(user.data.aiChatCallName).trim();
  return s || null;
}

async function resolveUserCallName(db, config, usernameRaw) {
  const personal = await findUserAiChatCallName(db, usernameRaw);
  if (personal) return personal;
  const globalName = config && config.userCallName != null ? String(config.userCallName).trim() : '';
  return globalName || null;
}

function buildSystemPrompt(config, memory, userProfile, userCallNameOverride) {
  const name = (config && config.assistantName) || DEFAULT_ASSISTANT_NAME;
  const parts = [
    `คุณคือ ${name} — ผู้ช่วย AI ภายในสำหรับพนักงานสำนักงานสหกรณ์ออมทรัพย์สาธารณสุขจังหวัดหนองคาย (NKBK)`,
    'ตอบเป็นภาษาไทยที่สุภาพ กระชับ และชัดเจน เว้นแต่ผู้ใช้ขอภาษาอื่น',
    'ห้ามเปิดเผย API key รหัสลับ หรือข้อมูลภายในที่ไม่เกี่ยวกับคำถาม',
    'ถ้าผู้ใช้สั่งให้จำอะไร ให้ยืนยันว่าจะจำไว้ตามคำสั่งที่บันทึกในระบบ'
  ];
  const callName =
    (userCallNameOverride && String(userCallNameOverride).trim()) ||
    (config && config.userCallName && String(config.userCallName).trim()) ||
    '';
  if (callName) {
    parts.push(`เรียกผู้ใช้คนนี้ว่า "${callName}" เสมอเมื่อพูดกับเขา`);
  }
  if (config && config.systemPrompt) parts.push(String(config.systemPrompt).trim());
  if (userProfile && userProfile.fullname) {
    let who = `ผู้ใช้ปัจจุบัน: ${userProfile.fullname} (${userProfile.username || ''})`;
    if (userProfile.group) who += ` แผนก/ฝ่าย: ${userProfile.group}`;
    if (userProfile.role) who += ` บทบาท: ${userProfile.role}`;
    parts.push(who);
  }
  const instr = memory && memory.standingInstructions;
  if (instr && String(instr).trim()) {
    parts.push('--- คำสั่งที่ผู้ใช้ต้องการให้ AI จำ ---\n' + String(instr).trim());
  }
  return parts.filter(Boolean).join('\n\n');
}

function extractRememberInstruction(message) {
  const m = String(message || '').trim();
  const patterns = [
    /^จำ(?:ไว้)?(?:ว่า|:)\s*(.+)/i,
    /^remember(?:\s+that)?:?\s*(.+)/i,
    /^บันทึก(?:ไว้)?(?:ว่า|:)\s*(.+)/i
  ];
  for (const p of patterns) {
    const match = m.match(p);
    if (match && match[1]) return match[1].trim();
  }
  return null;
}

function trimChatHistory(history, max) {
  const limit = Math.min(40, Math.max(4, parseInt(max, 10) || 20));
  const list = Array.isArray(history) ? history : [];
  return list.slice(-limit);
}

function getAiImageStoreDir(username) {
  const onCloud = isCloudRuntime();
  const base = onCloud
    ? path.join(require('os').tmpdir(), 'nkbk-ai-images')
    : path.join(__dirname, '..', 'data', 'nkbk-ai-images');
  const dir = path.join(base, sanitizeMemoryId(username));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function isCloudRuntime() {
  return !!(process.env.K_SERVICE || process.env.FUNCTION_TARGET || process.env.SKIP_HTTP_LISTEN === '1');
}

const STORAGE_PROJECT_ID = 'admin-panel-nkbkcoop-cbf10';
const STORAGE_BUCKET_CANDIDATES = [
  process.env.FIREBASE_STORAGE_BUCKET,
  process.env.GCLOUD_STORAGE_BUCKET,
  `${STORAGE_PROJECT_ID}.firebasestorage.app`,
  `${STORAGE_PROJECT_ID}.appspot.com`
].filter(Boolean);

let _storageBucket = null;

function getStorageBucket() {
  if (_storageBucket) return _storageBucket;
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
        _storageBucket = admin.storage().bucket(name);
        return _storageBucket;
      } catch (_) {}
    }
    _storageBucket = admin.storage().bucket();
    return _storageBucket;
  } catch (e) {
    console.warn('[nkbk-ai] Storage init failed:', e.message);
    return null;
  }
}

function mimeToExt(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  return 'png';
}

function storageObjectPath(username, imageId, mime) {
  return `nkbk-ai-images/${sanitizeMemoryId(username)}/${String(imageId)}.${mimeToExt(mime)}`;
}

async function uploadHistoryImageToStorage(username, imageId, b64, mime) {
  const bucket = getStorageBucket();
  if (!bucket) return null;
  const filePath = storageObjectPath(username, imageId, mime);
  const file = bucket.file(filePath);
  const buf = Buffer.from(String(b64), 'base64');
  const token = crypto.randomBytes(16).toString('hex');
  await file.save(buf, {
    metadata: {
      contentType: mime || 'image/png',
      cacheControl: 'public, max-age=604800',
      metadata: { firebaseStorageDownloadTokens: token }
    },
    resumable: false
  });
  const encoded = encodeURIComponent(filePath);
  const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encoded}?alt=media&token=${token}`;
  return { publicUrl, filePath };
}

async function readPersistedImageFromStorage(username, imageId) {
  const bucket = getStorageBucket();
  if (!bucket || !imageId) return null;
  for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif']) {
    const filePath = `nkbk-ai-images/${sanitizeMemoryId(username)}/${String(imageId)}.${ext}`;
    const file = bucket.file(filePath);
    try {
      const [exists] = await file.exists();
      if (!exists) continue;
      const [buf] = await file.download();
      const mime =
        ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/png';
      return { buffer: buf, mime, filePath };
    } catch (_) {}
  }
  return null;
}

function imageFilePath(username, imageId, mime) {
  const ext = String(mime || '').includes('jpeg') || String(mime || '').includes('jpg') ? '.jpg' : '.png';
  return path.join(getAiImageStoreDir(username), String(imageId) + ext);
}

function persistHistoryImage(username, img) {
  if (!img || !img.b64) return img;
  const b64 = String(img.b64);
  if (b64.length <= 120000 && !img.omitted) {
    return { mime: img.mime || 'image/png', b64, caption: img.caption || '', thumb: !!img.thumb };
  }
  const imageId = Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
  const mime = img.mime || 'image/png';
  try {
    fs.writeFileSync(imageFilePath(username, imageId, mime), Buffer.from(b64, 'base64'));
  } catch (e) {
    console.warn('[nkbk-ai] local image write failed:', e.message);
  }
  return { mime, imageId, caption: img.caption || '' };
}

async function persistHistoryImageAsync(username, img) {
  if (!img) return img;
  if (img.publicUrl) return img;
  if (!img.b64) {
    if (img.imageId) return img;
    return img;
  }
  const b64 = String(img.b64);
  const mime = img.mime || 'image/png';
  const imageId = img.imageId || Date.now().toString(36) + crypto.randomBytes(3).toString('hex');

  if (isCloudRuntime()) {
    try {
      const uploaded = await uploadHistoryImageToStorage(username, imageId, b64, mime);
      if (uploaded && uploaded.publicUrl) {
        return { mime, imageId, publicUrl: uploaded.publicUrl, caption: img.caption || '' };
      }
    } catch (e) {
      console.warn('[nkbk-ai] storage upload failed:', e.message);
    }
  }

  if (b64.length <= 120000 && !img.omitted) {
    return { mime, b64, caption: img.caption || '', thumb: !!img.thumb };
  }
  return persistHistoryImage(username, { ...img, b64, mime, imageId });
}

function readPersistedImage(username, imageId) {
  if (!imageId) return null;
  const base = getAiImageStoreDir(username);
  for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
    const p = path.join(base, String(imageId) + ext);
    if (fs.existsSync(p)) {
      const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
      return { path: p, mime };
    }
  }
  return null;
}

function imagePublicUrl(username, imageId) {
  return `/api/nkbk-ai-image/${encodeURIComponent(sanitizeMemoryId(username))}/${encodeURIComponent(imageId)}`;
}

function enrichHistoryImageForClient(username, img) {
  if (!img || img.omitted) return null;
  if (img.publicUrl) {
    return { mime: img.mime || 'image/png', url: img.publicUrl, publicUrl: img.publicUrl, caption: img.caption || '' };
  }
  if (img.b64) return { mime: img.mime || 'image/png', b64: img.b64, caption: img.caption || '' };
  if (img.imageId) {
    const found = readPersistedImage(username, img.imageId);
    if (found) {
      try {
        const b64 = fs.readFileSync(found.path).toString('base64');
        return { mime: found.mime, b64, caption: img.caption || '' };
      } catch (_) {}
    }
    return {
      mime: img.mime || 'image/png',
      url: imagePublicUrl(username, img.imageId),
      imageId: img.imageId,
      caption: img.caption || ''
    };
  }
  return null;
}

function expandHistoryForClient(username, history) {
  return (Array.isArray(history) ? history : []).map((m) => {
    if (!m || !Array.isArray(m.images) || !m.images.length) return m;
    const images = m.images.map((img) => enrichHistoryImageForClient(username, img)).filter(Boolean);
    return images.length ? { ...m, images } : m;
  });
}

function persistLargeImagesInHistory(username, history) {
  if (!username) return history || [];
  return (history || []).map((m) => {
    if (!m || !Array.isArray(m.images) || !m.images.length) return m;
    const images = m.images.map((img) => persistHistoryImage(username, img)).filter(Boolean);
    return { ...m, images };
  });
}

function stripHeavyImagesFromHistory(history) {
  return persistLargeImagesInHistory(null, history);
}

function parseDataUrl(dataUrl) {
  const s = String(dataUrl || '').trim();
  const m = s.match(/^data:([^;]+);base64,(.+)$/i);
  if (!m) return null;
  return { mime: m[1], b64: m[2] };
}

function normalizeIncomingImages(images) {
  if (!Array.isArray(images)) return [];
  return images
    .map((img) => {
      if (!img) return null;
      if (img.dataUrl) {
        const p = parseDataUrl(img.dataUrl);
        if (!p) return null;
        return { mime: p.mime, b64: p.b64, dataUrl: img.dataUrl };
      }
      if (img.b64) {
        const mime = img.mime || 'image/png';
        return { mime, b64: img.b64, dataUrl: `data:${mime};base64,${img.b64}` };
      }
      return null;
    })
    .filter(Boolean)
    .slice(0, 4);
}

function wantsImageGeneration(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return (
    /(?:สร้าง|วาด|generate|draw|make|design|ออกแบบ).{0,32}(?:รูป|ภาพ|image|picture|photo|poster|logo|illustration|icon|infographic|อินโฟ|กราฟิก)/i.test(t) ||
    /(?:รูป|ภาพ|image|picture|infographic|อินโฟกราฟิก).{0,32}(?:สร้าง|วาด|generate|draw|make|design|ออกแบบ)/i.test(t) ||
    /^\/(?:image|img|pic)\b/i.test(t)
  );
}

function extractImagePrompt(text) {
  const t = String(text || '').trim();
  return t.replace(/^\/(?:image|img|pic)\s*/i, '').trim() || t;
}

async function buildReferenceImagePrompt(apiKey, config, userText, refImages) {
  const refs = Array.isArray(refImages) ? refImages : [];
  const text = String(userText || '').trim() || 'สร้างรูปจากภาพอ้างอิง';
  if (!refs.length) return text;
  const parts = [
    {
      type: 'text',
      text:
        `ผู้ใช้แนบรูปอ้างอิงและขอให้ใช้ในการสร้างรูปใหม่\nคำขอ: ${text}\n\n` +
        'เขียน prompt ภาษาอังกฤษ ONE paragraph สำหรับ image generation — ให้ใช้ใบหน้า/บุคคล/ชุดจากรูปอ้างอิงให้ใกล้เคียงที่สุด ' +
        'ระบุพื้นหลัง สไตล์ องค์ประกอบ ตามคำขอ ตอบ prompt อย่างเดียว ไม่มี markdown'
    }
  ];
  refs.slice(0, 2).forEach((img) => {
    parts.push({
      type: 'image_url',
      image_url: {
        url: img.dataUrl || `data:${img.mime || 'image/png'};base64,${img.b64}`,
        detail: 'high'
      }
    });
  });
  const messages = [
    {
      role: 'system',
      content:
        'You write detailed English prompts for AI image generation from reference photos. Preserve identity, face, uniform, and key visual traits from the reference.'
    },
    { role: 'user', content: parts }
  ];
  try {
    const out = await callOpenAIChat(apiKey, pickVisionModel(config), messages, 700);
    const cleaned = String(out || '').trim().slice(0, 900);
    return cleaned || text;
  } catch (_) {
    return `Professional portrait based on reference photo. ${text}`.slice(0, 900);
  }
}

function wantsImageGenFlow(text, hasImages, forceGenerate) {
  if (forceGenerate) return true;
  if (!hasImages) return false;
  const t = String(text || '').trim();
  return (
    /(?:แก้|edit|เปลี่ย|ปรับ|จากรูป|จากภาพ|อิง|reference|style)/i.test(t) ||
    /(?:ใช้|เอา).{0,20}(?:ภาพ|รูป).*นี/i.test(t) ||
    /(?:ภาพ|รูป).*นี/i.test(t)
  );
}

function buildDirectInfographicPrompt(text) {
  const t = String(text || '').trim();
  return (
    'Professional Thai cooperative infographic poster, modern flat design, clear sections with readable Thai text labels, clean layout. Content:\n' +
    t.slice(0, 2800)
  );
}

async function enhanceInfographicPrompt(apiKey, config, userText) {
  const source = String(userText || '').trim();
  if (!source || source.length < 80) return source;
  const messages = [
    {
      role: 'system',
      content:
        'Convert Thai organization/cooperative content into ONE English image-generation prompt for a professional infographic poster. ' +
        'Include layout, recommended colors, and key Thai labels to render. Output ONLY the prompt, max 900 characters.'
    },
    { role: 'user', content: source.slice(0, 3500) }
  ];
  try {
    const out = await callOpenAIChat(apiKey, pickVisionModel(config), messages, 900);
    return String(out || '').trim().slice(0, 900) || source;
  } catch (_) {
    return source.slice(0, 2000);
  }
}

function extractUrls(text) {
  const m = String(text || '').match(/https?:\/\/[^\s<>"']+/gi);
  return m ? [...new Set(m.map((u) => u.replace(/[.,;:!?)]+$/, '')))] : [];
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fetchUrlSnippet(url, maxLen) {
  const limit = Math.max(500, parseInt(maxLen, 10) || 2000);
  return new Promise((resolve) => {
    try {
      const lib = String(url).startsWith('https') ? https : http;
      const req = lib.get(
        url,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; NKBKConnext/1.0)',
            Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'
          }
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            return fetchUrlSnippet(res.headers.location, limit).then(resolve);
          }
          if (res.statusCode >= 400) {
            res.resume();
            return resolve(null);
          }
          let data = '';
          res.on('data', (c) => {
            if (data.length < 120000) data += c;
          });
          res.on('end', () => resolve(htmlToText(data).slice(0, limit) || null));
        }
      );
      req.setTimeout(12000, () => {
        req.destroy();
        resolve(null);
      });
      req.on('error', () => resolve(null));
    } catch (_) {
      resolve(null);
    }
  });
}

async function prepareImagePrompt(apiKey, config, prompt) {
  const base = extractImagePrompt(prompt);
  const urls = extractUrls(base);
  if (!urls.length) return base;

  let context = '';
  for (const url of urls.slice(0, 2)) {
    const snippet = await fetchUrlSnippet(url, 1800);
    if (snippet) context += `\n\nReference from ${url}:\n${snippet}`;
  }

  const withoutUrls = base.replace(/https?:\/\/[^\s<>"']+/gi, ' ').replace(/\s+/g, ' ').trim();
  const userBrief = withoutUrls || 'Create a professional infographic';

  if (!context) {
    return `${userBrief}. Visual infographic design, clean layout, Thai cooperative theme.`;
  }

  try {
    const enhanced = await callOpenAIChat(
      apiKey,
      pickVisionModel(config),
      [
        {
          role: 'system',
          content:
            'You write concise English image-generation prompts for DALL-E/gpt-image. Output ONE paragraph only (max 400 chars). Focus on visual layout, colors, icons, and text placement. No markdown.'
        },
        {
          role: 'user',
          content: `User request: ${userBrief}\n${context}\n\nWrite the image prompt:`
        }
      ],
      500
    );
    const cleaned = String(enhanced || '').trim().slice(0, 900);
    return cleaned || `${userBrief}. Professional infographic, modern flat design.`;
  } catch (_) {
    return `${userBrief}. Professional infographic based on reference content. ${context.slice(0, 400)}`;
  }
}

function extractImagesFromResponse(j) {
  const outputs = Array.isArray(j && j.output) ? j.output : [];
  const images = [];
  for (const o of outputs) {
    if (!o) continue;
    if (o.type === 'image_generation_call' && o.result) {
      const b64 = typeof o.result === 'string' ? o.result : o.result.b64 || o.result.data || '';
      if (b64) images.push({ mime: 'image/png', b64 });
      continue;
    }
    if (o.type === 'image' && o.b64) {
      images.push({ mime: o.mime || 'image/png', b64: o.b64 });
      continue;
    }
    if (o.type === 'message' && Array.isArray(o.content)) {
      o.content.forEach((part) => {
        if (!part) return;
        if (part.type === 'output_image' && part.image_url) {
          const url = part.image_url.url || part.image_url;
          if (typeof url === 'string' && url.startsWith('data:')) {
            const m = url.match(/^data:([^;]+);base64,(.+)$/);
            if (m) images.push({ mime: m[1], b64: m[2] });
          }
        }
      });
    }
  }
  return images;
}

function openaiJsonPost(apiKey, apiPath, body, timeoutMs) {
  if (!apiKey || !String(apiKey).trim()) {
    return Promise.reject(new Error('OpenAI API Key not configured'));
  }
  const payload = JSON.stringify(body);
  const timeout = Math.max(15000, parseInt(timeoutMs, 10) || 240000);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.openai.com',
        port: 443,
        path: apiPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + String(apiKey).trim(),
          'Content-Length': Buffer.byteLength(payload, 'utf8')
        }
      },
      (res) => {
        let data = '';
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => {
          try {
            const j = JSON.parse(data || '{}');
            if (res.statusCode >= 400) {
              return reject(new Error((j.error && j.error.message) || data.slice(0, 300) || 'OpenAI error'));
            }
            resolve(j);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.setTimeout(timeout, () => {
      req.destroy(new Error('OpenAI timeout — ลองใหม่อีกครั้ง'));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function pickVisionModel(config) {
  const m = (config && config.model) || 'gpt-4o-mini';
  if (/^gpt-(4o|4\.1|5)/i.test(m)) return m;
  return 'gpt-4o-mini';
}

function pickResponsesModel(config) {
  return (config && config.responsesModel) || 'gpt-5.5';
}

function pickImageModel(config) {
  return (config && config.imageModel) || 'gpt-image-2';
}

async function generateImageResponses(apiKey, config, prompt, refImages) {
  const model = pickResponsesModel(config);
  const refs = Array.isArray(refImages) ? refImages : [];
  let input;
  if (refs.length) {
    const content = [
      {
        type: 'input_text',
        text:
          'Use the attached reference photo(s) as the primary visual reference. Match face, uniform, and key details closely.\n\n' +
          (prompt || 'สร้างรูปจากภาพอ้างอิงนี้')
      }
    ];
    refs.forEach((img) => {
      content.push({ type: 'input_image', image_url: img.dataUrl || `data:${img.mime};base64,${img.b64}` });
    });
    input = [{ role: 'user', content }];
  } else {
    input = prompt;
  }
  const j = await openaiJsonPost(apiKey, '/v1/responses', {
    model,
    input,
    tools: [{ type: 'image_generation', quality: 'medium' }]
  }, 120000);
  const images = extractImagesFromResponse(j);
  if (!images.length) {
    const textOut = (Array.isArray(j.output) ? j.output : [])
      .filter((o) => o && o.type === 'message')
      .map((o) =>
        (Array.isArray(o.content) ? o.content : [])
          .filter((c) => c && c.type === 'output_text')
          .map((c) => c.text)
          .join('')
      )
      .join('\n')
      .trim();
    const hint = textOut
      ? ` — ${textOut.slice(0, 180)}`
      : ' — ลองใช้คำสั่งสั้นๆ ไม่ใส่ลิงก์ หรือเปลี่ยน model ใน Admin';
    throw new Error('ไม่ได้รับรูปจาก OpenAI' + hint);
  }
  return images;
}

function isGptImageModel(model) {
  return /^gpt-image|^chatgpt-image/i.test(String(model || '').trim());
}

async function generateImageSimple(apiKey, config, prompt, timeoutMs) {
  const model = pickImageModel(config);
  const body = {
    model,
    prompt,
    n: 1,
    size: '1024x1024'
  };
  // gpt-image-* คืน b64 โดย default — ห้ามส่ง response_format (API จะ error)
  if (isGptImageModel(model)) {
    body.quality = (config && config.imageQuality) || 'low';
    body.output_format = 'png';
  } else {
    body.response_format = 'b64_json';
  }
  const j = await openaiJsonPost(apiKey, '/v1/images/generations', body, timeoutMs || 240000);
  const data = Array.isArray(j.data) ? j.data : [];
  const images = [];
  for (const d of data) {
    if (!d) continue;
    if (d.b64_json) {
      images.push({ mime: 'image/png', b64: d.b64_json });
    } else if (d.url) {
      const b64 = await fetchImageUrlAsB64(d.url);
      if (b64) images.push({ mime: 'image/png', b64 });
    }
  }
  if (!images.length) throw new Error('สร้างรูปไม่สำเร็จ');
  return images;
}

function fetchImageUrlAsB64(url) {
  return new Promise((resolve) => {
    https
      .get(url, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(Buffer.concat(chunks).toString('base64'));
          } catch (_) {
            resolve(null);
          }
        });
      })
      .on('error', () => resolve(null));
  });
}

async function generateImages(apiKey, config, prompt, refImages) {
  const refs = Array.isArray(refImages) ? refImages : [];
  if (!refs.length) {
    return await generateImageSimple(apiKey, config, prompt, 240000);
  }

  try {
    return await generateImageSimple(apiKey, config, prompt, 240000);
  } catch (simpleErr) {
    try {
      return await generateImageResponses(apiKey, config, prompt, refs);
    } catch (e) {
      throw simpleErr;
    }
  }
}

function buildChatCompletionBody(model, messages, maxTokens) {
  const m = model || 'gpt-4o-mini';
  const limit = Math.min(4000, Math.max(256, parseInt(maxTokens, 10) || 1500));
  const body = { model: m, messages };
  // gpt-5 / o-series ใช้ max_completion_tokens แทน max_tokens
  if (/^gpt-5|^o[0-9]/i.test(m)) {
    body.max_completion_tokens = limit;
  } else {
    body.max_tokens = limit;
    body.temperature = 0.7;
  }
  return body;
}

function callOpenAIChat(apiKey, model, messages, maxTokens) {
  if (!apiKey || !String(apiKey).trim()) {
    return Promise.reject(new Error('OpenAI API Key not configured'));
  }
  const body = JSON.stringify(buildChatCompletionBody(model, messages, maxTokens));
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.openai.com',
      port: 443,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + String(apiKey).trim(),
        'Content-Length': Buffer.byteLength(body, 'utf8')
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (res.statusCode >= 400) {
            const msg = (j.error && j.error.message) || data.slice(0, 200) || 'OpenAI error';
            return reject(new Error(msg));
          }
          const reply = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
          if (!reply) return reject(new Error('Empty response from OpenAI'));
          resolve(String(reply).trim());
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('OpenAI chat timeout')));
    req.write(body);
    req.end();
  });
}

async function callOpenAIChatVision(apiKey, config, messages, maxTokens, userImages) {
  const model = pickVisionModel(config);
  const visionMessages = messages.map((m, idx) => {
    if (idx !== messages.length - 1 || m.role !== 'user' || !userImages || !userImages.length) return m;
    const parts = [{ type: 'text', text: String(m.content || '') }];
    userImages.forEach((img) => {
      parts.push({
        type: 'image_url',
        image_url: { url: img.dataUrl || `data:${img.mime};base64,${img.b64}`, detail: 'auto' }
      });
    });
    return { role: 'user', content: parts };
  });
  return callOpenAIChat(apiKey, model, visionMessages, maxTokens);
}

async function runChat(db, config, session, payload) {
  const body = payload && typeof payload === 'object' ? payload : { message: payload };
  const text = String(body.message || '').trim();
  const mode = body.mode || 'auto';
  const incomingImages = normalizeIncomingImages(body.images);
  const forceGenerate = mode === 'generate' || wantsImageGeneration(text);
  const hasImages = incomingImages.length > 0;

  if (!text && !hasImages) throw new Error('ข้อความว่าง');

  const memoryRaw = (await getUserMemory(db, session.username)) || {};
  const { threads, activeThreadId } = normalizeThreads(memoryRaw);
  const activeThread = getActiveThread(threads, activeThreadId);
  if (!activeThreadId || !activeThread) {
    throw new Error('กรุณาเลือกหรือสร้างบทสนทนาก่อน');
  }

  const historyMax = config.chatHistoryMax || 20;
  let standingInstructions = String(memoryRaw.standingInstructions || '').trim();
  let chatHistory = trimChatHistory(
    activeThread && Array.isArray(activeThread.chatHistory) ? activeThread.chatHistory : [],
    historyMax
  );
  const rewindTo = body.rewindToMessageIndex;
  if (typeof rewindTo === 'number' && rewindTo >= 0 && Number.isFinite(rewindTo)) {
    chatHistory = chatHistory.slice(0, Math.floor(rewindTo));
  }
  const userCallName = await resolveUserCallName(db, config, session.username);

  const remember = text ? extractRememberInstruction(text) : null;
  let memoryUpdated = false;
  if (remember) {
    standingInstructions = standingInstructions
      ? standingInstructions + '\n- ' + remember
      : '- ' + remember;
    memoryUpdated = true;
  }

  const userLabel = text || (hasImages ? '[ส่งรูปภาพ]' : '');
  let reply = '';
  let images = [];
  let imagePromptUsed = '';

  if (wantsImageGenFlow(text, hasImages, forceGenerate)) {
    const rawPrompt = extractImagePrompt(text) || 'สร้างรูปภาพสวยงามตามภาพอ้างอิง';
    let prompt;
    if (hasImages) {
      prompt = await buildReferenceImagePrompt(config.openaiApiKey, config, rawPrompt, incomingImages);
    } else if (rawPrompt.length > 100) {
      prompt = buildDirectInfographicPrompt(rawPrompt);
    } else {
      prompt = await prepareImagePrompt(config.openaiApiKey, config, rawPrompt);
    }
    imagePromptUsed = prompt;
    images = await generateImages(config.openaiApiKey, config, prompt, hasImages ? incomingImages : []);
    reply = images.length ? '' : 'สร้างรูปไม่สำเร็จ';
  } else if (hasImages) {
    const systemContent = buildSystemPrompt(config, { standingInstructions }, session, userCallName);
    const messages = [{ role: 'system', content: systemContent }];
    chatHistory.forEach((m) => {
      if (m && (m.role === 'user' || m.role === 'assistant') && m.content) {
        messages.push({ role: m.role, content: String(m.content) });
      }
    });
    messages.push({
      role: 'user',
      content: text || 'ช่วยอธิบายหรือวิเคราะห์รูปนี้ให้หน่อย'
    });
    reply = await callOpenAIChatVision(
      config.openaiApiKey,
      config,
      messages,
      config.maxTokens || 1500,
      incomingImages
    );
  } else {
    const systemContent = buildSystemPrompt(config, { standingInstructions }, session, userCallName);
    const messages = [{ role: 'system', content: systemContent }];
    chatHistory.forEach((m) => {
      if (m && (m.role === 'user' || m.role === 'assistant') && m.content) {
        messages.push({ role: m.role, content: String(m.content) });
      }
    });
    messages.push({ role: 'user', content: text });
    reply = await callOpenAIChat(
      config.openaiApiKey,
      config.model,
      messages,
      config.maxTokens || 1500
    );
  }

  const userEntry = {
    role: 'user',
    content: userLabel,
    ts: Date.now(),
    ...(hasImages
      ? {
          images: await Promise.all(
            incomingImages.map(async (img) => {
              const saved = await persistHistoryImageAsync(session.username, img);
              if (saved && saved.publicUrl) {
                return { mime: saved.mime || img.mime || 'image/png', imageId: saved.imageId, publicUrl: saved.publicUrl };
              }
              if (saved && saved.imageId) {
                return { mime: saved.mime || img.mime || 'image/png', imageId: saved.imageId };
              }
              return { mime: img.mime || 'image/png', b64: img.b64 };
            })
          )
        }
      : {})
  };
  const assistantEntry = {
    role: 'assistant',
    content: reply,
    ts: Date.now(),
    ...(images.length
      ? {
          images: await Promise.all(
            images.map(async (img) => {
              const saved = await persistHistoryImageAsync(session.username, img);
              if (saved && saved.publicUrl) {
                return {
                  mime: saved.mime || img.mime || 'image/png',
                  imageId: saved.imageId,
                  publicUrl: saved.publicUrl,
                  caption: text || 'generated'
                };
              }
              if (saved && saved.imageId) {
                return { mime: saved.mime || img.mime || 'image/png', imageId: saved.imageId, caption: text || 'generated' };
              }
              return { mime: img.mime, b64: img.b64, caption: text || 'generated' };
            })
          )
        }
      : {})
  };

  chatHistory = trimChatHistory(chatHistory.concat([userEntry, assistantEntry]), historyMax);

  await saveUserMemory(db, session.username, session.fullname, {
    standingInstructions,
    chatHistory,
    activeThreadId
  });

  const clientImages = (generated) =>
    (generated || []).map((img, idx) => {
      if (!img) return null;
      if (img.b64) {
        return { mime: img.mime || 'image/png', b64: img.b64 };
      }
      const persisted = assistantEntry.images && assistantEntry.images[idx];
      if (persisted && persisted.publicUrl) {
        return {
          mime: persisted.mime || img.mime || 'image/png',
          url: persisted.publicUrl,
          publicUrl: persisted.publicUrl,
          imageId: persisted.imageId
        };
      }
      if (persisted && persisted.b64) {
        return { mime: persisted.mime || img.mime || 'image/png', b64: persisted.b64 };
      }
      const imageId = (persisted && persisted.imageId) || img.imageId;
      if (imageId) {
        return {
          mime: (persisted && persisted.mime) || img.mime || 'image/png',
          url: imagePublicUrl(session.username, imageId),
          imageId
        };
      }
      return null;
    }).filter(Boolean);

  return {
    reply,
    images: clientImages(images),
    imagePrompt: imagePromptUsed || undefined,
    memoryUpdated,
    standingInstructions,
    activeThreadId,
    generated: images.length > 0
  };
}

module.exports = {
  DESKTOP_AI_CONFIG_DOC,
  AI_CHAT_CONFIG_DOC,
  MEMORY_COLLECTION,
  getDesktopAiConfig,
  getAiChatConfig,
  getEffectiveAiConfig,
  isUserAllowed,
  denyMessage,
  publicConfig,
  getUserMemory,
  saveUserMemory,
  sanitizeForFirestore,
  findUserAiChatCallName,
  findV2UserDoc,
  syncUserCallName,
  resolveUserCallName,
  normalizeThreads,
  publicThreads,
  createThread,
  deleteThread,
  switchThread,
  pinThread,
  archiveThread,
  findThreadByRef,
  buildSystemPrompt,
  extractRememberInstruction,
  callOpenAIChat,
  callOpenAIChatVision,
  generateImages,
  wantsImageGeneration,
  normalizeIncomingImages,
  runChat,
  persistHistoryImageAsync,
  expandHistoryForClient,
  readPersistedImage,
  readPersistedImageFromStorage,
  imagePublicUrl,
  stripHeavyImagesFromHistory,
  trimChatHistory
};
