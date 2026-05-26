/**
 * NKBK Desktop AI — OpenAI chat + per-user memory (Firestore)
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildMemberInterestRatesContextLines } = require('./member-interest-rates.js');
const {
  loadMemberDownloadSections,
  buildMemberDownloadsContextLines
} = require('./member-downloads.js');
const { buildMemberPaymentContextLines } = require('./member-payment.js');
const {
  loadMemberStaffDirectory,
  buildMemberStaffContextLines
} = require('./member-staff.js');
const { enrichPublicMemberChatReply } = require('./member-chat-enrich.js');
const { memberChatPageLinkPromptLines } = require('./member-chat-format.js');

const DESKTOP_AI_CONFIG_DOC = 'desktop_ai';
const AI_CHAT_CONFIG_DOC = 'ai_chat';
const MEMORY_COLLECTION = 'ai_desktop_memory';
const DEFAULT_ASSISTANT_NAME = 'ChatGPT โมเน่';
const DEFAULT_DISPLAY_NAME = 'โมเน่';
const PROMPT_SUGGEST_THRESHOLD = 5;
const MAX_SAVED_PROMPTS = 60;
const MIN_TRACK_PROMPT_LEN = 10;

function normalizePromptText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function promptFingerprint(text) {
  const n = normalizePromptText(text);
  if (!n) return '';
  return (
    'fp_' +
    crypto
      .createHash('sha1')
      .update(n)
      .digest('hex')
      .slice(0, 16)
  );
}

function promptTitleFromText(text, fallback) {
  const n = String(text || '').trim();
  const line = n.split('\n')[0].replace(/\s+/g, ' ').trim();
  return (line || fallback || 'พรอมต์ใหม่').slice(0, 80);
}

function normalizePromptPreviewImage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const imageId = String(raw.imageId || '').trim().slice(0, 120);
  const publicUrl = String(raw.publicUrl || raw.url || '').trim().slice(0, 500);
  if (!imageId && !publicUrl) return null;
  return {
    imageId,
    publicUrl,
    mime: String(raw.mime || 'image/png').trim().slice(0, 80),
    updatedAt: Number(raw.updatedAt) || Date.now()
  };
}

function normalizeSavedPrompts(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const text = String(item.text || '').trim().slice(0, 4000);
    if (!text || text.length < MIN_TRACK_PROMPT_LEN) continue;
    const fp = promptFingerprint(text);
    if (seen.has(fp)) continue;
    seen.add(fp);
    const now = Date.now();
    const previewImage = normalizePromptPreviewImage(item.previewImage);
    out.push({
      id: String(item.id || fp).slice(0, 80),
      title: String(item.title || promptTitleFromText(text)).trim().slice(0, 80) || promptTitleFromText(text),
      text,
      createdAt: Number(item.createdAt) || now,
      updatedAt: Number(item.updatedAt) || now,
      useCount: Math.max(0, Number(item.useCount) || 0),
      ...(previewImage ? { previewImage } : {})
    });
    if (out.length >= MAX_SAVED_PROMPTS) break;
  }
  return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function normalizePromptUsage(raw, savedPrompts) {
  const savedFps = new Set((savedPrompts || []).map((p) => promptFingerprint(p.text)));
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  Object.keys(raw).forEach((key) => {
    const val = raw[key];
    if (!val || typeof val !== 'object') return;
    const text = String(val.text || '').trim().slice(0, 4000);
    if (!text) return;
    const fp = promptFingerprint(text);
    if (savedFps.has(fp)) return;
    out[fp] = {
      text,
      count: Math.max(0, Number(val.count) || 0),
      lastUsedAt: Number(val.lastUsedAt) || 0,
      dismissed: !!val.dismissed
    };
  });
  return out;
}

function findSavedPromptByText(savedPrompts, text) {
  const fp = promptFingerprint(text);
  return (savedPrompts || []).find((p) => promptFingerprint(p.text) === fp) || null;
}

function trackPromptActivityState(promptUsage, savedPrompts, text) {
  const norm = normalizePromptText(text);
  if (norm.length < MIN_TRACK_PROMPT_LEN) {
    return { usage: promptUsage, count: 0, shouldSuggest: false, alreadySaved: false, text: norm };
  }
  const saved = findSavedPromptByText(savedPrompts, norm);
  if (saved) {
    return {
      usage: promptUsage,
      count: saved.useCount || 0,
      shouldSuggest: false,
      alreadySaved: true,
      text: norm,
      savedId: saved.id
    };
  }
  const fp = promptFingerprint(norm);
  const usage = { ...(promptUsage || {}) };
  const prev = usage[fp] || { text: norm, count: 0, lastUsedAt: 0, dismissed: false };
  if (prev.dismissed) {
    return { usage, count: prev.count, shouldSuggest: false, alreadySaved: false, text: norm, fingerprint: fp };
  }
  const count = prev.count + 1;
  usage[fp] = { text: norm, count, lastUsedAt: Date.now(), dismissed: false };
  return {
    usage,
    count,
    shouldSuggest: count >= PROMPT_SUGGEST_THRESHOLD,
    alreadySaved: false,
    text: norm,
    fingerprint: fp
  };
}

async function trackPromptActivity(db, username, fullname, text) {
  const prev = (await getUserMemory(db, username)) || {};
  const savedPrompts = normalizeSavedPrompts(prev.savedPrompts);
  const promptUsage = normalizePromptUsage(prev.promptUsage, savedPrompts);
  const result = trackPromptActivityState(promptUsage, savedPrompts, text);
  if (result.alreadySaved) {
    return {
      count: result.count,
      shouldSuggest: false,
      text: result.text,
      titleSuggestion: promptTitleFromText(result.text),
      fingerprint: promptFingerprint(result.text),
      alreadySaved: true,
      savedPrompts
    };
  }
  await saveUserMemory(db, username, fullname, {
    promptUsage: result.usage
  });
  return {
    count: result.count,
    shouldSuggest: result.shouldSuggest,
    text: result.text,
    titleSuggestion: promptTitleFromText(result.text),
    fingerprint: result.fingerprint || promptFingerprint(result.text),
    alreadySaved: false,
    savedPrompts
  };
}

async function recordPromptCompletion(db, username, fullname, { text, generated, images }) {
  const norm = normalizePromptText(text);
  if (norm.length < MIN_TRACK_PROMPT_LEN) return { savedPrompts: null };
  const prev = (await getUserMemory(db, username)) || {};
  let savedPrompts = normalizeSavedPrompts(prev.savedPrompts);
  const saved = findSavedPromptByText(savedPrompts, norm);
  if (!saved) return { savedPrompts: null };
  let previewImage = saved.previewImage || null;
  if (generated && Array.isArray(images) && images.length) {
    const last = images[images.length - 1];
    previewImage = normalizePromptPreviewImage(last) || previewImage;
  }
  savedPrompts = savedPrompts.map((p) => {
    if (p.id !== saved.id) return p;
    const next = {
      ...p,
      useCount: (p.useCount || 0) + 1,
      updatedAt: Date.now()
    };
    if (previewImage) next.previewImage = previewImage;
    return next;
  });
  await saveUserMemory(db, username, fullname, { savedPrompts });
  return { savedPrompts, prompt: findSavedPromptByText(savedPrompts, norm) };
}

async function saveQuickPrompt(db, username, fullname, { text, title }) {
  const norm = String(text || '').trim().slice(0, 4000);
  if (norm.length < MIN_TRACK_PROMPT_LEN) {
    throw new Error('พรอมต์สั้นเกินไป');
  }
  const prev = (await getUserMemory(db, username)) || {};
  let savedPrompts = normalizeSavedPrompts(prev.savedPrompts);
  const fp = promptFingerprint(norm);
  const now = Date.now();
  const existing = findSavedPromptByText(savedPrompts, norm);
  if (existing) {
    savedPrompts = savedPrompts.map((p) =>
      p.id === existing.id
        ? {
            ...p,
            title: String(title || p.title || promptTitleFromText(norm)).trim().slice(0, 80) || p.title,
            updatedAt: now
          }
        : p
    );
  } else {
    savedPrompts.unshift({
      id: fp,
      title: String(title || promptTitleFromText(norm)).trim().slice(0, 80) || promptTitleFromText(norm),
      text: norm,
      createdAt: now,
      updatedAt: now,
      useCount: 0
    });
    savedPrompts = normalizeSavedPrompts(savedPrompts);
  }
  const promptUsage = normalizePromptUsage(prev.promptUsage, savedPrompts);
  delete promptUsage[fp];
  await saveUserMemory(db, username, fullname, { savedPrompts, promptUsage });
  return { savedPrompts, prompt: findSavedPromptByText(savedPrompts, norm) };
}

async function dismissPromptSuggestion(db, username, fullname, text) {
  const norm = normalizePromptText(text);
  const fp = promptFingerprint(norm);
  if (!fp) return { ok: true };
  const prev = (await getUserMemory(db, username)) || {};
  const savedPrompts = normalizeSavedPrompts(prev.savedPrompts);
  const promptUsage = normalizePromptUsage(prev.promptUsage, savedPrompts);
  if (promptUsage[fp]) {
    promptUsage[fp] = { ...promptUsage[fp], dismissed: true };
  } else {
    promptUsage[fp] = { text: norm, count: PROMPT_SUGGEST_THRESHOLD, lastUsedAt: Date.now(), dismissed: true };
  }
  await saveUserMemory(db, username, fullname, { promptUsage });
  return { ok: true };
}

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

function lineRulesToPrompt(line, audience) {
  if (!line) return '';
  const aud = audience === 'member' ? 'member' : 'staff';
  if (aud === 'member') {
    if (Array.isArray(line.systemRulesMember) && line.systemRulesMember.length) {
      return line.systemRulesMember.map((r) => (r && r.text) || '').filter(Boolean).join('\n');
    }
    if (typeof line.systemRulesMemberSummary === 'string') return line.systemRulesMemberSummary.trim();
    return '';
  }
  if (Array.isArray(line.systemRulesStaff) && line.systemRulesStaff.length) {
    return line.systemRulesStaff.map((r) => (r && r.text) || '').filter(Boolean).join('\n');
  }
  if (Array.isArray(line.systemRules) && line.systemRules.length) {
    return line.systemRules.map((r) => (r && r.text) || '').filter(Boolean).join('\n');
  }
  if (typeof line.systemRulesStaffSummary === 'string') return line.systemRulesStaffSummary.trim();
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
    storageQuotaGb: raw.storageQuotaGb != null ? Number(raw.storageQuotaGb) : 5,
    threadQuotaGb: raw.threadQuotaGb != null ? Number(raw.threadQuotaGb) : 1,
    openAiCreditTotalUsd: raw.openAiCreditTotalUsd != null ? Number(raw.openAiCreditTotalUsd) : null,
    maxAttachCount: raw.maxAttachCount != null ? Number(raw.maxAttachCount) : 10,
    maxSendMb: raw.maxSendMb != null ? Number(raw.maxSendMb) : 25,
    maxImageMb: raw.maxImageMb != null ? Number(raw.maxImageMb) : 8,
    maxDocMb: raw.maxDocMb != null ? Number(raw.maxDocMb) : 10,
    apiBudgetUsd: raw.apiBudgetUsd != null ? Number(raw.apiBudgetUsd) : 50,
    apiBudgetAlertPct: raw.apiBudgetAlertPct != null ? Number(raw.apiBudgetAlertPct) : 80,
    billingLimitHitAt: raw.billingLimitHitAt || null,
    usageStats: raw.usageStats && typeof raw.usageStats === 'object' ? raw.usageStats : null,
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
  let systemPrompt = lineRulesToPrompt(line, 'staff');
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
  if (fromLine && desktop) {
    fromLine.storageQuotaGb = desktop.storageQuotaGb;
    fromLine.maxAttachCount = desktop.maxAttachCount;
    fromLine.maxSendMb = desktop.maxSendMb;
    fromLine.maxImageMb = desktop.maxImageMb;
    fromLine.maxDocMb = desktop.maxDocMb;
  }
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
  return `ไม่มีสิทธิ์ใช้งาน ${n}`;
}

function publicConfig(config) {
  if (!config) {
    return {
      enabled: false,
      assistantName: DEFAULT_ASSISTANT_NAME,
      displayName: DEFAULT_DISPLAY_NAME,
      model: 'gpt-4o-mini',
      hasApiKey: false,
      attachLimits: getAttachLimits(null)
    };
  }
  const limits = getAttachLimits(config);
  return {
    enabled: !!config.enabled,
    assistantName: config.assistantName || DEFAULT_ASSISTANT_NAME,
    displayName: config.displayName || DEFAULT_DISPLAY_NAME,
    model: config.model || 'gpt-4o-mini',
    hasApiKey: !!(config.openaiApiKey && String(config.openaiApiKey).trim()),
    supportsImages: true,
    attachLimits: limits
  };
}

function clampAttachInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function getAttachLimits(config) {
  const c = config || {};
  return {
    maxAttachCount: clampAttachInt(c.maxAttachCount, 1, 20, 10),
    maxSendMb: clampAttachInt(c.maxSendMb, 1, 100, 25),
    maxImageMb: clampAttachInt(c.maxImageMb, 1, 50, 8),
    maxDocMb: clampAttachInt(c.maxDocMb, 1, 50, 10),
    storageQuotaGb: clampAttachInt(c.storageQuotaGb, 1, 500, 5),
    threadQuotaGb: clampAttachInt(c.threadQuotaGb, 1, 50, 1)
  };
}

function getThreadQuotaBytes(config) {
  const gb =
    config && config.threadQuotaGb != null && Number.isFinite(Number(config.threadQuotaGb))
      ? Number(config.threadQuotaGb)
      : 1;
  return Math.max(1, gb) * 1024 * 1024 * 1024;
}

function computeThreadStorageBytes(thread) {
  if (!thread || !Array.isArray(thread.chatHistory)) return 0;
  let used = 0;
  for (const m of thread.chatHistory) {
    if (m && m.content) used += Buffer.byteLength(String(m.content), 'utf8');
    if (Array.isArray(m.images)) {
      m.images.forEach((img) => {
        used += estimateImageBytes(img);
      });
    }
    if (Array.isArray(m.files)) {
      m.files.forEach((f) => {
        used += f && f.sizeBytes ? Number(f.sizeBytes) : f && f.size ? Number(f.size) : 80000;
      });
    }
  }
  return used;
}

const THREAD_QUOTA_MSG =
  'แชตนี้ใช้พื้นที่เกินโควต้าแล้ว กรุณาเริ่มแชตใหม่เพื่อให้เว็บไซต์ทำงานได้อย่างราบรื่น';

function estimateB64Bytes(b64) {
  if (!b64) return 0;
  return Math.floor(String(b64).length * 0.75);
}

function estimateDataUrlBytes(dataUrl) {
  const p = parseDataUrl(dataUrl);
  return p ? estimateB64Bytes(p.b64) : 0;
}

function validateIncomingAttachments(config, images, files) {
  const limits = getAttachLimits(config);
  const imgs = Array.isArray(images) ? images : [];
  const docs = Array.isArray(files) ? files : [];
  if (imgs.length + docs.length > limits.maxAttachCount) {
    throw new Error(`แนบได้ไม่เกิน ${limits.maxAttachCount} รายการต่อครั้ง`);
  }
  let totalBytes = 0;
  const maxSendBytes = limits.maxSendMb * 1024 * 1024;
  const maxImageBytes = limits.maxImageMb * 1024 * 1024;
  const maxDocBytes = limits.maxDocMb * 1024 * 1024;
  for (const img of imgs) {
    if (img.imageId && !img.b64 && !img.dataUrl) continue;
    const b = estimateB64Bytes(img.b64) || estimateDataUrlBytes(img.dataUrl);
    if (b > maxImageBytes) {
      throw new Error(`รูปแต่ละไฟล์ต้องไม่เกิน ${limits.maxImageMb} MB`);
    }
    totalBytes += b;
  }
  for (const f of docs) {
    let b = 0;
    if (f.textContent != null) b = Buffer.byteLength(String(f.textContent), 'utf8');
    else if (f.b64) b = estimateB64Bytes(f.b64);
    if (b > maxDocBytes) {
      throw new Error(`ไฟล์แต่ละชิ้นต้องไม่เกิน ${limits.maxDocMb} MB`);
    }
    totalBytes += b;
  }
  if (totalBytes > maxSendBytes) {
    throw new Error(`ขนาดแนบรวมต่อครั้งต้องไม่เกิน ${limits.maxSendMb} MB (ได้รับ ~${Math.ceil(totalBytes / (1024 * 1024))} MB)`);
  }
  return limits;
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
  if (out.sharePublic == null) out.sharePublic = false;
  return out;
}

const DEFAULT_USER_PREFS = {
  theme: 'system',
  notifyRecommendations: true,
  notifyUsage: true,
  notifyResponses: true,
  notifyGroupChat: true,
  notifySound: false,
  notifySoundId: 'chime',
  locationEnabled: false,
  userLocation: '',
  aboutYou: '',
  memorySaved: true,
  memoryBrowser: false,
  memoryChatHistory: true,
  dataLocationEnabled: false
};

function normalizeUserPrefs(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const theme = ['system', 'light', 'dark'].includes(p.theme) ? p.theme : DEFAULT_USER_PREFS.theme;
  return {
    theme,
    notifyRecommendations: p.notifyRecommendations !== false,
    notifyUsage: p.notifyUsage !== false,
    notifyResponses: p.notifyResponses !== false,
    notifyGroupChat: p.notifyGroupChat !== false,
    notifySound: !!p.notifySound,
    notifySoundId: ['chime', 'pop', 'soft', 'bell'].includes(p.notifySoundId)
      ? p.notifySoundId
      : DEFAULT_USER_PREFS.notifySoundId,
    locationEnabled: !!p.locationEnabled,
    userLocation: p.userLocation != null ? String(p.userLocation).trim() : '',
    aboutYou: p.aboutYou != null ? String(p.aboutYou).trim() : '',
    memorySaved: p.memorySaved !== false,
    memoryBrowser: !!p.memoryBrowser,
    memoryChatHistory: p.memoryChatHistory !== false,
    dataLocationEnabled: !!p.dataLocationEnabled
  };
}

function getStorageQuotaBytes(config, memoryOptional) {
  if (
    memoryOptional &&
    memoryOptional.storageQuotaGb != null &&
    Number.isFinite(Number(memoryOptional.storageQuotaGb))
  ) {
    const userGb = Number(memoryOptional.storageQuotaGb);
    if (userGb > 0) return Math.max(1, userGb) * 1024 * 1024 * 1024;
  }
  const gb =
    config && config.storageQuotaGb != null && Number.isFinite(Number(config.storageQuotaGb))
      ? Number(config.storageQuotaGb)
      : 5;
  return Math.max(1, gb) * 1024 * 1024 * 1024;
}

function estimateImageBytes(img) {
  if (!img || img.omitted) return 0;
  if (img.b64) return Math.floor(String(img.b64).length * 0.75);
  if (img.imageId || img.publicUrl || img.url) return 180000;
  return 50000;
}

function computeStorageStats(threads, userLibrary) {
  let imageCount = 0;
  let imageBytes = 0;
  let fileCount = 0;
  let fileBytes = 0;
  let textBytes = 0;
  for (const t of Array.isArray(threads) ? threads : []) {
    if (!t || !Array.isArray(t.chatHistory)) continue;
    for (const m of t.chatHistory) {
      if (m && m.content) textBytes += Buffer.byteLength(String(m.content), 'utf8');
      if (Array.isArray(m.images)) {
        m.images.forEach((img) => {
          const b = estimateImageBytes(img);
          if (b > 0) {
            imageCount++;
            imageBytes += b;
          }
        });
      }
      if (Array.isArray(m.files)) {
        m.files.forEach((f) => {
          fileCount++;
          fileBytes += f && f.sizeBytes ? Number(f.sizeBytes) : f && f.size ? Number(f.size) : 80000;
        });
      }
    }
  }
  for (const item of normalizeUserLibrary(userLibrary)) {
    const b = Number(item.sizeBytes) || 0;
    if (String(item.mime || '').startsWith('image/') || item.kind === 'image') {
      imageCount++;
      imageBytes += b || 180000;
    } else {
      fileCount++;
      fileBytes += b || 80000;
    }
  }
  const usedBytes = imageBytes + fileBytes + textBytes;
  return { usedBytes, imageCount, imageBytes, fileCount, fileBytes, textBytes };
}

function normalizeUserLibrary(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((x) => x && x.id)
    .map((x) => ({
      id: String(x.id),
      title: String(x.title || x.name || 'ไฟล์').slice(0, 200),
      mime: String(x.mime || 'application/octet-stream'),
      imageId: x.imageId || null,
      fileId: x.fileId || null,
      publicUrl: x.publicUrl || '',
      sizeBytes: Number(x.sizeBytes) || 0,
      createdAt: Number(x.createdAt) || Date.now(),
      updatedAt: Number(x.updatedAt || x.createdAt) || Date.now(),
      kind: x.kind === 'file' ? 'file' : 'image',
      textPreview: x.textPreview ? String(x.textPreview).slice(0, 8000) : ''
    }));
}

function libraryItemFromRecord(rec, username, source) {
  if (!rec || !rec.id) return null;
  const mime = rec.mime || 'application/octet-stream';
  const isImage = rec.kind === 'image' || String(mime).startsWith('image/');
  let src = rec.publicUrl || '';
  if (!src && rec.imageId) src = imagePublicUrl(username, rec.imageId);
  return {
    id: rec.id,
    threadId: rec.threadId || null,
    threadTitle: rec.threadTitle || '',
    title: rec.title || 'ไฟล์',
    mime,
    src,
    imageId: rec.imageId || null,
    fileId: rec.fileId || null,
    updatedAt: rec.updatedAt || rec.createdAt || 0,
    sizeBytes: Number(rec.sizeBytes) || 0,
    kind: isImage ? 'image' : 'file',
    source: source || 'library',
    role: source === 'library' ? 'user' : rec.role || null,
    msgIdx: rec.msgIdx,
    imgIdx: rec.imgIdx,
    textPreview: rec.textPreview || ''
  };
}

function listSharedLinks(threads) {
  return (Array.isArray(threads) ? threads : [])
    .filter((t) => t && t.sharePublic)
    .map((t) => ({
      threadId: t.id,
      title: t.title || 'แชท',
      shareId: t.shareId || t.id,
      sharedAt: t.sharedAt || t.updatedAt || t.createdAt || 0
    }))
    .sort((a, b) => (b.sharedAt || 0) - (a.sharedAt || 0));
}

function listArchivedThreads(threads) {
  return (Array.isArray(threads) ? threads : [])
    .filter((t) => t && t.archived)
    .map((t) => ({
      id: t.id,
      title: t.title || 'แชท',
      archivedAt: t.archivedAt || t.updatedAt || 0,
      messageCount: Array.isArray(t.chatHistory) ? t.chatHistory.length : 0
    }))
    .sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
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
  const preferences =
    payload.preferences != null
      ? normalizeUserPrefs({ ...normalizeUserPrefs(prev.preferences), ...payload.preferences })
      : normalizeUserPrefs(prev.preferences);
  const userLibrary =
    payload.userLibrary != null ? normalizeUserLibrary(payload.userLibrary) : normalizeUserLibrary(prev.userLibrary);
  const memoryFileIds =
    payload.memoryFileIds != null
      ? Array.isArray(payload.memoryFileIds)
        ? payload.memoryFileIds.map(String).filter(Boolean)
        : []
      : Array.isArray(prev.memoryFileIds)
        ? prev.memoryFileIds.map(String).filter(Boolean)
        : [];
  const memoryFileLabels =
    payload.memoryFileLabels != null
      ? normalizeMemoryFileLabels(payload.memoryFileLabels, memoryFileIds)
      : normalizeMemoryFileLabels(prev.memoryFileLabels, memoryFileIds);
  const savedPrompts =
    payload.savedPrompts != null
      ? normalizeSavedPrompts(payload.savedPrompts)
      : normalizeSavedPrompts(prev.savedPrompts);
  const promptUsage =
    payload.promptUsage != null
      ? normalizePromptUsage(payload.promptUsage, savedPrompts)
      : normalizePromptUsage(prev.promptUsage, savedPrompts);
  const storageQuotaGb =
    payload.storageQuotaGb != null
      ? Number(payload.storageQuotaGb)
      : prev.storageQuotaGb != null
        ? Number(prev.storageQuotaGb)
        : null;
  const usageStats = payload.usageStats != null ? payload.usageStats : prev.usageStats;
  const usageLog = payload.usageLog != null ? payload.usageLog : prev.usageLog;

  if (!activeThreadId || !threads.some((t) => t.id === activeThreadId)) {
    activeThreadId = threads[0] ? threads[0].id : null;
  }

  await ref.set(
    sanitizeForFirestore({
      username: String(username).trim(),
      fullname: fullname || prev.fullname || '',
      standingInstructions,
      userCallName,
      preferences,
      userLibrary,
      memoryFileIds,
      memoryFileLabels,
      savedPrompts,
      promptUsage,
      ...(storageQuotaGb != null && Number.isFinite(storageQuotaGb) && storageQuotaGb > 0
        ? { storageQuotaGb }
        : {}),
      ...(usageStats ? { usageStats } : {}),
      ...(usageLog ? { usageLog } : {}),
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
    preferences,
    userLibrary,
    memoryFileIds,
    memoryFileLabels,
    savedPrompts,
    promptUsage,
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
  const prev = (await getUserMemory(db, username)) || {};
  const norm = normalizeThreads(prev);
  const t = findThreadByRef(norm.threads, threadId);
  if (!t) throw new Error('ไม่พบบทสนทนา');
  return saveUserMemory(db, username, fullname, { activeThreadId: t.id });
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

async function renameThread(db, username, fullname, threadId, title) {
  const nextTitle = String(title || '').trim().slice(0, 120);
  if (!nextTitle) throw new Error('กรุณาระบุชื่อแชต');
  return updateThreadFields(db, username, fullname, threadId, { title: nextTitle });
}

async function unarchiveThread(db, username, fullname, threadId) {
  return updateThreadFields(db, username, fullname, threadId, {
    archived: false,
    archivedAt: null
  });
}

async function markThreadShared(db, username, fullname, threadId) {
  return updateThreadFields(db, username, fullname, threadId, {
    sharePublic: true,
    sharedAt: Date.now()
  });
}

async function revokeThreadShare(db, username, fullname, threadId) {
  return updateThreadFields(db, username, fullname, threadId, {
    sharePublic: false,
    shareId: makeShareId()
  });
}

async function deleteAllVisibleThreads(db, username, fullname) {
  const prev = (await getUserMemory(db, username)) || {};
  const norm = normalizeThreads(prev);
  const threads = norm.threads.filter((t) => t.archived);
  let activeThreadId = null;
  if (norm.activeThreadId && threads.some((t) => t.id === norm.activeThreadId)) {
    activeThreadId = norm.activeThreadId;
  }
  return saveUserMemory(db, username, fullname, { threads, activeThreadId });
}

async function getUserSettingsBundle(db, config, session, username) {
  const memory = (await getUserMemory(db, username)) || {};
  const norm = normalizeThreads(memory);
  const prefs = normalizeUserPrefs(memory.preferences);
  const quotaBytes = getStorageQuotaBytes(config, memory);
  const stats = computeStorageStats(norm.threads, memory.userLibrary);
  const userDoc = await findV2UserDoc(db, username);
  const u = userDoc && userDoc.data ? userDoc.data : {};
  const userCallName = await resolveUserCallName(db, config, username);
  const libraryItems = collectLibraryItems(norm.threads, username, memory.userLibrary);
  const memoryFileIds = Array.isArray(memory.memoryFileIds) ? memory.memoryFileIds.map(String) : [];
  const memoryFileLabels = normalizeMemoryFileLabels(memory.memoryFileLabels, memoryFileIds);
  const memoryFiles = memoryFileIds
    .map((id) => libraryItems.find((x) => x.id === id))
    .filter(Boolean)
    .map((x) => ({
      id: x.id,
      title: x.title,
      mime: x.mime,
      sizeBytes: x.sizeBytes || 0,
      src: x.src || '',
      kind: x.kind || '',
      callName: memoryFileLabels[x.id] || ''
    }));
  return {
    preferences: prefs,
    standingInstructions: memory.standingInstructions || '',
    userCallName,
    assistantDisplayName: config.displayName || DEFAULT_DISPLAY_NAME,
    assistantName: config.assistantName || DEFAULT_ASSISTANT_NAME,
    memoryFileIds,
    memoryFileLabels,
    memoryFiles,
    savedPrompts: normalizeSavedPrompts(memory.savedPrompts),
    promptSuggestThreshold: PROMPT_SUGGEST_THRESHOLD,
    storage: { ...stats, quotaBytes },
    sharedLinks: listSharedLinks(norm.threads),
    archivedThreads: listArchivedThreads(norm.threads),
    account: {
      fullname: u.fullname || u.nameTH || session.fullname || '',
      email: u.email || '',
      username: String(username || '').trim(),
      pictureUrl: u.pictureUrl || u.linePictureUrl || ''
    }
  };
}

async function saveUserPreferences(db, username, fullname, patch) {
  const prev = (await getUserMemory(db, username)) || {};
  const preferences = normalizeUserPrefs({ ...normalizeUserPrefs(prev.preferences), ...(patch || {}) });
  return saveUserMemory(db, username, fullname, { preferences });
}

async function saveUserSettings(db, username, fullname, body) {
  const prev = (await getUserMemory(db, username)) || {};
  const payload = {};
  if (body.preferences != null) {
    payload.preferences = normalizeUserPrefs({
      ...normalizeUserPrefs(prev.preferences),
      ...(body.preferences || {})
    });
  }
  if (body.standingInstructions != null) {
    payload.standingInstructions = String(body.standingInstructions).trim();
  }
  if (body.userCallName != null) {
    await syncUserCallName(db, username, body.userCallName);
    payload.userCallName = String(body.userCallName).trim();
  }
  if (body.memoryFileIds != null) {
    payload.memoryFileIds = Array.isArray(body.memoryFileIds)
      ? body.memoryFileIds.map(String).filter(Boolean)
      : [];
  }
  if (body.memoryFileLabels != null || body.memoryFileIds != null) {
    const ids =
      payload.memoryFileIds != null
        ? payload.memoryFileIds
        : Array.isArray(prev.memoryFileIds)
          ? prev.memoryFileIds.map(String).filter(Boolean)
          : [];
    const labelSrc =
      body.memoryFileLabels != null ? body.memoryFileLabels : prev.memoryFileLabels;
    payload.memoryFileLabels = normalizeMemoryFileLabels(labelSrc, ids);
  }
  if (body.savedPrompts != null) {
    payload.savedPrompts = normalizeSavedPrompts(body.savedPrompts);
  }
  return saveUserMemory(db, username, fullname, payload);
}

function historyImagesFromMessage(m) {
  if (!m || typeof m !== 'object') return [];
  if (Array.isArray(m.images) && m.images.length) return m.images;
  return [];
}

function collectLibraryItems(threads, username, userLibrary) {
  const items = [];
  const seenImageIds = new Set();
  const seenFileIds = new Set();

  normalizeUserLibrary(userLibrary).forEach((rec) => {
    const mapped = libraryItemFromRecord(rec, username, 'library');
    if (!mapped) return;
    items.push(mapped);
    if (mapped.imageId) seenImageIds.add(String(mapped.imageId));
    if (mapped.fileId) seenFileIds.add(String(mapped.fileId));
  });

  for (const t of Array.isArray(threads) ? threads : []) {
    if (!t || t.archived) continue;
    const hist = Array.isArray(t.chatHistory) ? t.chatHistory : [];
    hist.forEach((m, msgIdx) => {
      historyImagesFromMessage(m).forEach((img, imgIdx) => {
        const imageId = String(img.imageId || img.id || '');
        if ((img.fromLibrary || img.libraryId) && imageId) return;
        if (imageId && seenImageIds.has(imageId)) return;
        const publicUrl = img.publicUrl || '';
        const url = img.url || '';
        const b64 = img.b64 || '';
        const dataUrl = img.dataUrl || '';
        const src =
          publicUrl ||
          dataUrl ||
          (b64 ? `data:${img.mime || 'image/png'};base64,${b64}` : '') ||
          (url && imageId ? imagePublicUrl(username, imageId) : url);
        if (!src && !imageId) return;
        const title =
          String(m.content || t.title || 'ChatGPT Image')
            .trim()
            .slice(0, 80) || 'ChatGPT Image';
        const approxSize =
          Number(img.sizeBytes) ||
          (b64 && b64.length
            ? Math.round((b64.length * 3) / 4)
            : dataUrl && dataUrl.length > 100
              ? Math.round((dataUrl.length * 3) / 4)
              : estimateImageBytes(img));
        items.push({
          id: `${t.id}_${msgIdx}_${imgIdx}`,
          threadId: t.id,
          threadTitle: t.title || 'แชท',
          title,
          mime: img.mime || 'image/png',
          src: src || imagePublicUrl(username, imageId),
          imageId,
          msgIdx,
          imgIdx,
          kind: 'image',
          source: 'chat',
          role: m.role === 'user' ? 'user' : 'assistant',
          updatedAt: m.ts || t.updatedAt || t.createdAt || 0,
          sizeBytes: approxSize
        });
        if (imageId) seenImageIds.add(imageId);
      });
      if (Array.isArray(m.files)) {
        m.files.forEach((f, fileIdx) => {
          if (!f || !f.name) return;
          items.push({
            id: `${t.id}_${msgIdx}_f${fileIdx}`,
            threadId: t.id,
            threadTitle: t.title || 'แชท',
            title: String(f.name).slice(0, 120),
            mime: f.mime || 'application/octet-stream',
            src: '',
            kind: 'file',
            source: 'chat',
            role: 'user',
            msgIdx,
            fileIdx,
            updatedAt: m.ts || t.updatedAt || t.createdAt || 0,
            sizeBytes: Number(f.sizeBytes || f.size) || 80000
          });
        });
      }
    });
  }
  return items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function parseChatLibraryItemId(itemId) {
  const id = String(itemId || '');
  const imgMatch = id.match(/^(.+)_(\d+)_(\d+)$/);
  if (imgMatch) return { threadId: imgMatch[1], msgIdx: Number(imgMatch[2]), imgIdx: Number(imgMatch[3]), kind: 'image' };
  const fileMatch = id.match(/^(.+)_(\d+)_f(\d+)$/);
  if (fileMatch) return { threadId: fileMatch[1], msgIdx: Number(fileMatch[2]), fileIdx: Number(fileMatch[3]), kind: 'file' };
  return null;
}

async function deleteStorageObject(username, objectId, mime) {
  const bucket = getStorageBucket();
  if (!bucket || !objectId) return;
  const paths = [
    storageObjectPath(username, objectId, mime),
    `nkbk-ai-files/${sanitizeMemoryId(username)}/${String(objectId)}`
  ];
  for (const p of paths) {
    try {
      await bucket.file(p).delete({ ignoreNotFound: true });
    } catch (_) {}
  }
  for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf', 'docx', 'txt']) {
    try {
      await bucket.file(`nkbk-ai-files/${sanitizeMemoryId(username)}/${String(objectId)}.${ext}`).delete({ ignoreNotFound: true });
    } catch (_) {}
  }
}

function scrubStorageRefsFromThreads(threads, imageIds, fileIds) {
  const imageIdSet = new Set((imageIds || []).map(String).filter(Boolean));
  const fileIdSet = new Set((fileIds || []).map(String).filter(Boolean));
  if (!imageIdSet.size && !fileIdSet.size) return threads;
  return (Array.isArray(threads) ? threads : []).map((t) => {
    if (!t || !Array.isArray(t.chatHistory)) return t;
    let changed = false;
    const chatHistory = t.chatHistory.map((m) => {
      if (!m || typeof m !== 'object') return m;
      let next = m;
      if (imageIdSet.size && Array.isArray(m.images) && m.images.length) {
        const images = m.images.filter((img) => {
          const id = String((img && (img.imageId || img.id)) || '');
          return !id || !imageIdSet.has(id);
        });
        if (images.length !== m.images.length) {
          changed = true;
          next = images.length ? { ...next, images } : { ...next, images: undefined };
        }
      }
      if (fileIdSet.size && Array.isArray(m.files) && m.files.length) {
        const files = m.files.filter((f) => {
          const id = String((f && (f.fileId || f.id)) || '');
          return !id || !fileIdSet.has(id);
        });
        if (files.length !== m.files.length) {
          changed = true;
          next = files.length ? { ...next, files } : { ...next, files: undefined };
        }
      }
      return next;
    });
    return changed ? { ...t, chatHistory, updatedAt: Date.now() } : t;
  });
}

async function deleteLibraryItems(db, username, fullname, itemIds) {
  const ids = Array.isArray(itemIds) ? itemIds.map(String).filter(Boolean) : [];
  if (!ids.length) return saveUserMemory(db, username, fullname, {});
  const prev = (await getUserMemory(db, username)) || {};
  const norm = normalizeThreads(prev);
  let threads = norm.threads;
  let userLibrary = normalizeUserLibrary(prev.userLibrary);
  let memoryFileIds = Array.isArray(prev.memoryFileIds) ? prev.memoryFileIds.map(String) : [];
  const scrubImageIds = [];
  const scrubFileIds = [];

  for (const itemId of ids) {
    if (itemId.startsWith('lib_')) {
      const rec = userLibrary.find((x) => x.id === itemId);
      if (rec) {
        if (rec.imageId) {
          scrubImageIds.push(String(rec.imageId));
          await deleteStorageObject(username, rec.imageId, rec.mime);
        }
        if (rec.fileId) {
          scrubFileIds.push(String(rec.fileId));
          await deleteStorageObject(username, rec.fileId, rec.mime);
        }
      }
      userLibrary = userLibrary.filter((x) => x.id !== itemId);
      memoryFileIds = memoryFileIds.filter((x) => x !== itemId);
      continue;
    }
    const ref = parseChatLibraryItemId(itemId);
    if (!ref) continue;
    threads = threads.map((t) => {
      if (t.id !== ref.threadId || !Array.isArray(t.chatHistory)) return t;
      const chatHistory = t.chatHistory.map((m, mi) => {
        if (mi !== ref.msgIdx) return m;
        if (ref.kind === 'image' && Array.isArray(m.images)) {
          const images = m.images.filter((_, ii) => ii !== ref.imgIdx);
          return images.length ? { ...m, images } : { ...m, images: undefined };
        }
        if (ref.kind === 'file' && Array.isArray(m.files)) {
          const files = m.files.filter((_, fi) => fi !== ref.fileIdx);
          return files.length ? { ...m, files } : { ...m, files: undefined };
        }
        return m;
      });
      return { ...t, chatHistory, updatedAt: Date.now() };
    });
    memoryFileIds = memoryFileIds.filter((x) => x !== itemId);
  }

  if (scrubImageIds.length || scrubFileIds.length) {
    threads = scrubStorageRefsFromThreads(threads, scrubImageIds, scrubFileIds);
  }

  return saveUserMemory(db, username, fullname, { threads, userLibrary, memoryFileIds });
}

async function uploadLibraryFileToStorage(username, fileId, b64, mime) {
  const bucket = getStorageBucket();
  if (!bucket) return null;
  const ext = mimeToExt(mime) || 'bin';
  const filePath = `nkbk-ai-files/${sanitizeMemoryId(username)}/${String(fileId)}.${ext}`;
  const file = bucket.file(filePath);
  const buf = Buffer.from(String(b64), 'base64');
  const token = crypto.randomBytes(16).toString('hex');
  await file.save(buf, {
    metadata: {
      contentType: mime || 'application/octet-stream',
      cacheControl: 'private, max-age=604800',
      metadata: { firebaseStorageDownloadTokens: token }
    },
    resumable: false
  });
  const encoded = encodeURIComponent(filePath);
  const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encoded}?alt=media&token=${token}`;
  return { publicUrl, filePath, sizeBytes: buf.length };
}

async function uploadLibraryItems(db, username, fullname, rawItems) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  if (!items.length) return saveUserMemory(db, username, fullname, {});
  const prev = (await getUserMemory(db, username)) || {};
  let userLibrary = normalizeUserLibrary(prev.userLibrary);
  const added = [];

  for (const raw of items.slice(0, 8)) {
    if (!raw) continue;
    let b64 = raw.b64 || '';
    let mime = raw.mime || 'application/octet-stream';
    const name = String(raw.name || 'ไฟล์').slice(0, 200);
    if (raw.dataUrl && !b64) {
      const p = parseDataUrl(raw.dataUrl);
      if (p) {
        b64 = p.b64;
        mime = p.mime || mime;
      }
    }
    if (!b64) continue;
    const libId = 'lib_' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
    const sizeBytes = Math.round((String(b64).length * 3) / 4);
    const isImage = String(mime).startsWith('image/');
    let record;
    if (isImage) {
      const imageId = Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
      const saved = await persistHistoryImageAsync(username, { b64, mime, imageId });
      record = {
        id: libId,
        title: name,
        mime: saved.mime || mime,
        imageId: saved.imageId || imageId,
        publicUrl: saved.publicUrl || '',
        sizeBytes: sizeBytes,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        kind: 'image'
      };
    } else {
      let textPreview = '';
      try {
        textPreview = String(await extractDocumentText(name, mime, b64)).slice(0, 8000);
      } catch (_) {}
      const fileId = Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
      const uploaded = await uploadLibraryFileToStorage(username, fileId, b64, mime);
      record = {
        id: libId,
        title: name,
        mime,
        fileId,
        publicUrl: (uploaded && uploaded.publicUrl) || '',
        sizeBytes: (uploaded && uploaded.sizeBytes) || sizeBytes,
        textPreview,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        kind: 'file'
      };
    }
    userLibrary.unshift(record);
    added.push(record);
  }

  const saved = await saveUserMemory(db, username, fullname, { userLibrary });
  return { ...saved, added };
}

function normalizeMemoryFileLabels(raw, fileIds) {
  const ids = new Set((Array.isArray(fileIds) ? fileIds : []).map(String));
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  Object.keys(src).forEach((id) => {
    const key = String(id);
    if (!ids.has(key)) return;
    const v = String(src[key] || '').trim();
    if (v) out[key] = v.slice(0, 60);
  });
  return out;
}

function buildMemoryFilesContext(memoryRaw, username) {
  const ids = Array.isArray(memoryRaw && memoryRaw.memoryFileIds)
    ? memoryRaw.memoryFileIds.map(String).filter(Boolean)
    : [];
  if (!ids.length) return '';
  const labels = normalizeMemoryFileLabels(memoryRaw && memoryRaw.memoryFileLabels, ids);
  const norm = normalizeThreads(memoryRaw || {});
  const items = collectLibraryItems(norm.threads, username, memoryRaw.userLibrary);
  const parts = [];
  ids.forEach((id) => {
    const item = items.find((x) => x.id === id);
    if (!item) return;
    const callName = labels[id] ? String(labels[id]).trim() : '';
    const fileTitle = item.title || 'ไฟล์';
    const label = callName || fileTitle;
    const aliasHint = callName
      ? ` (ผู้ใช้ตั้งชื่อเรียกว่า "${callName}" — เมื่อผู้ใช้พูดถึงชื่อนี้ให้อ้างอิงไฟล์นี้)`
      : '';
    if (item.textPreview) {
      parts.push(`[${label}]${aliasHint}\nไฟล์: ${fileTitle}\n${item.textPreview.slice(0, 4000)}`);
    } else if (String(item.mime || '').startsWith('image/')) {
      parts.push(
        `[รูปภาพ: ${label}]${aliasHint}\nไฟล์: ${fileTitle} — อ้างอิงภาพนี้เมื่อผู้ใช้เรียกชื่อหรือถามเกี่ยวกับเนื้อหาในรูป`
      );
    } else {
      parts.push(`[ไฟล์: ${label}]${aliasHint}\nชื่อไฟล์: ${fileTitle} (${item.mime || 'file'})`);
    }
  });
  return parts.join('\n\n');
}

function publicThreads(threads, activeThreadId, historyMax) {
  return (Array.isArray(threads) ? threads : [])
    .filter((t) => Array.isArray(t.chatHistory) && t.chatHistory.length > 0)
    .map((t) => ({
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

  function buildSystemPrompt(config, memory, userProfile, userCallNameOverride, preferences) {
  const name = (config && config.assistantName) || DEFAULT_ASSISTANT_NAME;
  const displayName = (config && config.displayName) || DEFAULT_DISPLAY_NAME;
  const prefs = preferences || (memory && memory.preferences) || {};
  const parts = [
    `คุณคือ ${name} — ผู้ช่วยภายในสำหรับพนักงานสำนักงานสหกรณ์ออมทรัพย์สาธารณสุขจังหวัดหนองคาย (NKBK)`,
    'ตอบเป็นภาษาไทยที่สุภาพ กระชับ และชัดเจน เว้นแต่ผู้ใช้ขอภาษาอื่น',
    'ห้ามเปิดเผย API key รหัสลับ หรือข้อมูลภายในที่ไม่เกี่ยวกับคำถาม',
    'ถ้าผู้ใช้สั่งให้จำอะไร ให้ยืนยันว่าจะจำไว้ตามคำสั่งที่บันทึกในระบบ',
    'คุณช่วยได้หลายอย่าง เช่น แก้ไข/สร้าง/อัปสเกลภาพ แยกพื้นหลัง PNG อ่าน PDF/Word/Excel/PowerPoint วิเคราะห์ข้อมูล แก้โค้ดเว็บ ออกแบบโปสเตอร์ และสรุปเอกสาร — เมื่อผู้ใช้แนบไฟล์ให้ใช้เนื้อหาที่แนบมาประกอบคำตอบ'
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
    parts.push('--- คำสั่งที่ผู้ใช้ต้องการให้ ' + displayName + ' จำ ---\n' + String(instr).trim());
  }
  if (prefs.memorySaved !== false && prefs.aboutYou && String(prefs.aboutYou).trim()) {
    parts.push('--- เกี่ยวกับผู้ใช้ ---\n' + String(prefs.aboutYou).trim());
  }
  if (prefs.dataLocationEnabled && prefs.userLocation && String(prefs.userLocation).trim()) {
    parts.push('ตำแหน่งของผู้ใช้: ' + String(prefs.userLocation).trim());
  }
  if (prefs.memorySaved !== false && memory && memory.memoryFilesContext && String(memory.memoryFilesContext).trim()) {
    parts.push('--- ไฟล์/เอกสารที่ผู้ใช้ต้องการให้จำ ---\n' + String(memory.memoryFilesContext).trim());
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
    return {
      mime: img.mime || 'image/png',
      url: img.publicUrl,
      publicUrl: img.publicUrl,
      imageId: img.imageId || '',
      caption: img.caption || ''
    };
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

function normalizeIncomingImages(images, maxCount) {
  const max = Math.max(1, Number(maxCount) || 10);
  if (!Array.isArray(images)) return [];
  return images
    .map((img, idx) => {
      if (!img) return null;
      const base = { _source: 'attachment', _attachmentIndex: idx + 1 };
      if (img.imageId && !img.dataUrl && !img.b64) {
        return {
          ...base,
          _source: img._source || 'library',
          mime: img.mime || 'image/png',
          imageId: String(img.imageId),
          ...(img.libraryId ? { libraryId: String(img.libraryId) } : {})
        };
      }
      if (img.dataUrl) {
        const p = parseDataUrl(img.dataUrl);
        if (!p) return null;
        return { ...base, mime: p.mime, b64: p.b64, dataUrl: img.dataUrl };
      }
      if (img.b64) {
        const mime = img.mime || 'image/png';
        return { ...base, mime, b64: img.b64, dataUrl: `data:${mime};base64,${img.b64}` };
      }
      return null;
    })
    .filter(Boolean)
    .slice(0, max);
}

function normalizeIncomingFiles(files, maxCount) {
  const max = Math.max(0, Number(maxCount) || 10);
  if (!Array.isArray(files)) return [];
  return files
    .map((f) => {
      if (!f) return null;
      if (f.textContent != null && String(f.textContent).trim()) {
        return {
          name: String(f.name || 'file.txt').slice(0, 200),
          mime: f.mime || 'text/plain',
          textContent: String(f.textContent).slice(0, 50000)
        };
      }
      if (f.dataUrl) {
        const p = parseDataUrl(f.dataUrl);
        if (!p) return null;
        return {
          name: String(f.name || 'file').slice(0, 200),
          mime: p.mime,
          b64: p.b64
        };
      }
      if (f.b64) {
        return {
          name: String(f.name || 'file').slice(0, 200),
          mime: f.mime || 'application/octet-stream',
          b64: f.b64
        };
      }
      return null;
    })
    .filter(Boolean)
    .slice(0, max);
}

async function extractDocumentText(name, mime, b64) {
  const buf = Buffer.from(String(b64 || ''), 'base64');
  const ext = String(name || '')
    .split('.')
    .pop()
    ?.toLowerCase();
  const type = String(mime || '').toLowerCase();

  if (type.startsWith('text/') || ext === 'txt' || ext === 'md') {
    return buf.toString('utf8');
  }
  if (ext === 'pdf' || type === 'application/pdf') {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buf);
    return data.text || '';
  }
  if (ext === 'docx' || type.includes('wordprocessingml')) {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer: buf });
    return result.value || '';
  }
  if (ext === 'xlsx' || type.includes('spreadsheetml')) {
    const XLSX = require('xlsx');
    const wb = XLSX.read(buf, { type: 'buffer' });
    const parts = [];
    wb.SheetNames.forEach((sheetName) => {
      const sheet = wb.Sheets[sheetName];
      parts.push(`[Sheet: ${sheetName}]\n${XLSX.utils.sheet_to_csv(sheet)}`);
    });
    return parts.join('\n\n');
  }
  if (ext === 'pptx' || type.includes('presentationml')) {
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(buf);
    const slideFiles = Object.keys(zip.files)
      .filter((k) => /^ppt\/slides\/slide\d+\.xml$/i.test(k))
      .sort((a, b) => {
        const na = parseInt(a.match(/slide(\d+)/i)?.[1] || '0', 10);
        const nb = parseInt(b.match(/slide(\d+)/i)?.[1] || '0', 10);
        return na - nb;
      });
    const slides = [];
    for (const sf of slideFiles) {
      const xml = await zip.files[sf].async('string');
      const text = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (text) slides.push(text);
    }
    return slides.map((t, i) => `[Slide ${i + 1}] ${t}`).join('\n');
  }
  throw new Error('รูปแบบไฟล์ไม่รองรับ');
}

async function buildDocumentsContext(files) {
  const parts = [];
  for (const f of files) {
    try {
      let text = '';
      if (f.textContent != null) text = String(f.textContent);
      else if (f.b64) text = await extractDocumentText(f.name, f.mime, f.b64);
      text = String(text || '').trim();
      if (text) parts.push(`[ไฟล์: ${f.name}]\n${text.slice(0, 14000)}`);
      else parts.push(`[ไฟล์: ${f.name}] (ว่างหรืออ่านไม่ได้)`);
    } catch (e) {
      parts.push(`[ไฟล์: ${f.name}] อ่านไม่สำเร็จ: ${e.message || 'unknown'}`);
    }
  }
  return parts.length ? parts.join('\n\n---\n\n') : '';
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
        `ผู้ใช้แนบรูปอ้างอิงและขอแก้ไข/สร้างรูปใหม่โดยอิงจากรูปเดิม\nคำขอ: ${text}\n\n` +
        'เขียน prompt ภาษาอังกฤษ ONE paragraph สำหรับ image generation — รักษาเลย์เอาต์ องค์ประกอบ สี สไตล์ โลโก้ ข้อความ และรายละเอียดหลักจากรูปอ้างอิงให้ใกล้เคียงที่สุด ' +
        'แล้วปรับเฉพาะสิ่งที่ผู้ใช้ขอ ตอบ prompt อย่างเดียว ไม่มี markdown'
    }
  ];
  refs.slice(0, getAttachLimits(config).maxAttachCount).forEach((img) => {
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
        'You write detailed English prompts for AI image generation from reference photos. Preserve layout, branding, colors, typography, and key visual details from the reference; change only what the user asks.'
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

function buildImageGenPersonalizationContext(promptMemory, userCallName, userPrefs) {
  const parts = [];
  const callName = userCallName && String(userCallName).trim();
  if (callName) parts.push('เรียกผู้ใช้ว่า "' + callName + '"');
  const instr = promptMemory && promptMemory.standingInstructions;
  if (instr && String(instr).trim()) {
    parts.push('คำสั่งที่ผู้ใช้ต้องการให้จำ:\n' + String(instr).trim());
  }
  const prefs = userPrefs || (promptMemory && promptMemory.preferences) || {};
  if (prefs.memorySaved !== false && prefs.aboutYou && String(prefs.aboutYou).trim()) {
    parts.push('เกี่ยวกับผู้ใช้:\n' + String(prefs.aboutYou).trim());
  }
  if (prefs.dataLocationEnabled && prefs.userLocation && String(prefs.userLocation).trim()) {
    parts.push('ตำแหน่งผู้ใช้: ' + String(prefs.userLocation).trim());
  }
  return parts.length ? parts.join('\n\n') : '';
}

function extractPosterFooterBlock(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  const footerMatch = t.match(/(?:ท้ายโปสเตอร์|ส่วนท้าย|footer|contact)[^\n]*\n([\s\S]+)/i);
  if (footerMatch && footerMatch[0]) return footerMatch[0].trim().slice(0, 900);
  const hasContact =
    /(?:โทร|tel|phone|042[-\s]?\d+)/i.test(t) &&
    (/(?:เมล|mail|@)/i.test(t) || /(?:ที่อยู่|address)/i.test(t));
  if (!hasContact) return '';
  const idx = t.search(/(?:โทร\s|tel\s|phone\s|042[-\s]?\d+|เมล\s|mail\s|ที่อยู่\s)/i);
  return idx >= 0 ? t.slice(idx).trim().slice(0, 900) : '';
}

function finalizePosterImagePrompt(basePrompt, userText, personalizationCtx) {
  let out = String(basePrompt || '').trim();
  const footer = extractPosterFooterBlock(userText);
  if (personalizationCtx) {
    out +=
      '\n\n--- Personalization / standing instructions (apply when relevant) ---\n' +
      personalizationCtx;
  }
  if (footer) {
    out +=
      '\n\nMANDATORY POSTER FOOTER — render ALL of the following Thai text legibly at the bottom of the poster (exact phone, email, address):\n' +
      footer;
  }
  return out.slice(0, 3900);
}

function buildDirectInfographicPrompt(text) {
  const t = String(text || '').trim();
  return (
    'Professional Thai cooperative infographic poster, modern flat design, clear sections with readable Thai text labels, clean layout. Content:\n' +
    t.slice(0, 2800)
  );
}

function wantsPosterDesignFlow(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return (
    /(?:ออกแบบ|design|สร้าง|ทำ).{0,40}(?:โปสเตอร์|poster|ป้าย|banner|ข่าว|news)/i.test(t) ||
    /(?:โปสเตอร์|poster|อินโฟกราฟิก|infographic).{0,40}((?:ออกแบบ|design|สร้าง|ทำ)|(?:ดีไซน์|layout))/i.test(t)
  );
}

function memoryImageMentionScore(userText, callName, title) {
  const t = String(userText || '').toLowerCase();
  const cn = String(callName || '').toLowerCase();
  const ti = String(title || '').toLowerCase();
  let score = 0;
  if (cn && cn.length >= 2 && t.includes(cn)) score += 10;
  if (/โลโก|logo|ตรา|emblem/i.test(t) && /โลโก|logo|ตรา|emblem/i.test(cn + ' ' + ti)) score += 8;
  if (/ประธาน|chairman|chairperson/i.test(t) && /ประธาน|chairman|chairperson/i.test(cn + ' ' + ti)) score += 8;
  if (/มะณู|manu|บุญศรี/i.test(t) && /มะณู|manu|บุญศรี/i.test(cn + ' ' + ti)) score += 6;
  return score;
}

async function loadLibraryItemAsIncomingImage(username, item) {
  if (!item) return null;
  const mime = item.mime || 'image/png';
  const label = item._label || '';
  const src = String(item.src || '').trim();
  if (src.startsWith('data:')) {
    const p = parseDataUrl(src);
    if (p) return { mime: p.mime, b64: p.b64, dataUrl: src, imageId: item.imageId || '', _source: 'memory', _label: label };
  }
  const imageId = item.imageId;
  if (imageId) {
    const found = readPersistedImage(username, imageId);
    if (found) {
      try {
        const b64 = fs.readFileSync(found.path).toString('base64');
        const dataUrl = `data:${found.mime};base64,${b64}`;
        return { mime: found.mime, b64, dataUrl, imageId, _source: 'memory', _label: label };
      } catch (_) {}
    }
    const stored = await readPersistedImageFromStorage(username, imageId);
    if (stored && stored.buffer) {
      const b64 = stored.buffer.toString('base64');
      const dataUrl = `data:${stored.mime};base64,${b64}`;
      return { mime: stored.mime, b64, dataUrl, imageId, _source: 'memory', _label: label };
    }
  }
  if (src.startsWith('http')) {
    const b64 = await fetchImageUrlAsB64(src);
    if (b64) {
      const dataUrl = `data:${mime};base64,${b64}`;
      return { mime, b64, dataUrl, imageId: imageId || '', _source: 'memory', _label: label };
    }
  }
  return null;
}

async function resolveIncomingImagesForChat(username, images) {
  const list = Array.isArray(images) ? images : [];
  const out = [];
  for (const img of list) {
    if (!img) continue;
    if (img.b64 || img.dataUrl) {
      out.push(img);
      continue;
    }
    if (img.imageId) {
      const loaded = await loadLibraryItemAsIncomingImage(username, {
        imageId: img.imageId,
        mime: img.mime || 'image/png',
        src: imagePublicUrl(username, img.imageId),
        _source: img._source || 'library'
      });
      if (loaded) {
        out.push({
          ...loaded,
          _source: img._source || loaded._source || 'library',
          ...(img.libraryId ? { libraryId: img.libraryId } : {}),
          _attachmentIndex: img._attachmentIndex
        });
      }
    }
  }
  return out;
}

async function resolveMemoryImagesForPrompt(memoryRaw, username, userText) {
  const ids = Array.isArray(memoryRaw && memoryRaw.memoryFileIds)
    ? memoryRaw.memoryFileIds.map(String).filter(Boolean)
    : [];
  if (!ids.length) return [];
  const labels = normalizeMemoryFileLabels(memoryRaw && memoryRaw.memoryFileLabels, ids);
  const norm = normalizeThreads(memoryRaw || {});
  const items = collectLibraryItems(norm.threads, username, memoryRaw.userLibrary);
  const scored = [];
  for (const id of ids) {
    const item = items.find((x) => x.id === id);
    if (!item || !String(item.mime || '').startsWith('image/')) continue;
    const callName = labels[id] || '';
    const score = memoryImageMentionScore(userText, callName, item.title);
    const img = await loadLibraryItemAsIncomingImage(username, { ...item, _label: callName || item.title });
    if (img) scored.push({ img, score, callName });
  }
  scored.sort((a, b) => b.score - a.score);
  const text = String(userText || '');
  const wantsMemory =
    wantsPosterDesignFlow(text) ||
    /(?:ใช้|เอา|จาก).{0,30}(?:โลโก|logo|ประธาน|memory|ที่(?:จ|ตั้งค่า|เก็บ))/i.test(text);
  if (!wantsMemory) return [];
  if (wantsPosterDesignFlow(text)) return scored.map((x) => x.img);
  return scored.filter((x) => x.score > 0).map((x) => x.img);
}

function imageDedupeKey(img) {
  if (img.imageId) return 'id:' + img.imageId;
  if (img.b64) return 'b64:' + String(img.b64).slice(0, 80);
  if (img.dataUrl) return 'url:' + String(img.dataUrl).slice(0, 80);
  return 'rand:' + Math.random();
}

function mergeImageLists(primary, secondary, maxCount) {
  const max = Math.max(1, Number(maxCount) || 10);
  const seen = new Set();
  const out = [];
  for (const img of [...primary, ...secondary]) {
    if (!img || (!img.b64 && !img.dataUrl)) continue;
    const key = imageDedupeKey(img);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(img);
    if (out.length >= max) break;
  }
  return out;
}

function posterImageRole(img) {
  const label = String((img && img._label) || '').toLowerCase();
  if (/โลโก|logo|ตรา|emblem/i.test(label)) return 'logo';
  if (/ประธาน|chairman|chairperson|มะณู/i.test(label)) return 'chairman';
  if (img && img._source === 'attachment') return 'event';
  if (img && img._source === 'memory') return 'branding';
  return 'other';
}

function posterRefImageCaption(img, idx) {
  const role = posterImageRole(img);
  const n = idx + 1;
  if (role === 'logo') return `Reference image ${n} [cooperative logo]:`;
  if (role === 'chairman') return `Reference image ${n} [chairman portrait]:`;
  if (role === 'event') {
    const i = img._attachmentIndex != null ? img._attachmentIndex : n;
    return `Reference image ${n} [event/news photo ${i} — MUST embed in poster collage]:`;
  }
  if (img && img._label) return `Reference image ${n} [${img._label}]:`;
  return `Reference image ${n}:`;
}

function pickPosterRefImagesForGeneration(allImages, maxRefs) {
  const max = Math.max(1, Math.min(Number(maxRefs) || 8, 10));
  if (!Array.isArray(allImages) || !allImages.length) return [];
  const logo = [];
  const chairman = [];
  const event = [];
  const other = [];
  for (const img of allImages) {
    const role = posterImageRole(img);
    if (role === 'logo') logo.push(img);
    else if (role === 'chairman') chairman.push(img);
    else if (role === 'event') event.push(img);
    else other.push(img);
  }
  const out = [];
  const pushUnique = (img) => {
    if (!img || out.length >= max) return;
    const key = imageDedupeKey(img);
    if (out.some((x) => imageDedupeKey(x) === key)) return;
    out.push(img);
  };
  pushUnique(logo[0]);
  pushUnique(chairman[0]);
  event.forEach(pushUnique);
  other.forEach(pushUnique);
  logo.slice(1).forEach(pushUnique);
  chairman.slice(1).forEach(pushUnique);
  return out;
}

function pickRefImagesForGeneration(allImages, maxRefs) {
  const max = Math.max(1, Math.min(Number(maxRefs) || 3, 4));
  if (!Array.isArray(allImages) || !allImages.length) return [];
  const sorted = [...allImages].sort((a, b) => {
    const am = a._source === 'memory' ? 1 : 0;
    const bm = b._source === 'memory' ? 1 : 0;
    return bm - am;
  });
  return sorted.slice(0, max);
}

async function buildPosterGenerationPrompt(
  apiKey,
  config,
  userText,
  refImages,
  memoryFilesContext,
  personalizationCtx
) {
  const refs = Array.isArray(refImages) ? refImages : [];
  const text = String(userText || '').trim();
  const memCtx = String(memoryFilesContext || '').trim();
  if (!refs.length && !memCtx) {
    return finalizePosterImagePrompt(buildDirectInfographicPrompt(text), text, personalizationCtx);
  }
  const eventCount = refs.filter((img) => posterImageRole(img) === 'event').length;
  const parts = [
    {
      type: 'text',
      text:
        `ผู้ใช้ขอออกแบบโปสเตอร์/ข่าว/กราฟิก\n\nคำขอ:\n${text.slice(0, 3500)}\n\n` +
        (eventCount
          ? `ผู้ใช้แนบภาพกิจกรรม/ข่าว ${eventCount} รูป — ต้องนำรูปเหล่านี้ไปใส่ในโปสเตอร์จริง (collage/grid) ห้ามแทนด้วยภาพประกอบทั่วไป\n\n`
          : '') +
        (memCtx ? `ไฟล์ที่โมเน่จำไว้ (โลโก้/ประธาน ฯลฯ):\n${memCtx.slice(0, 2000)}\n\n` : '') +
        (personalizationCtx ? `การปรับแต่งเฉพาะบุคคล:\n${personalizationCtx.slice(0, 1200)}\n\n` : '') +
        'วิเคราะห์รูปที่แนบ (โลโก้ ประธาน ภาพกิจกรรม/ข่าวที่ผู้ใช้แนบ) แล้วเขียน prompt ภาษาอังกฤษ ONE paragraph สำหรับสร้างโปสเตอร์ข่าวมืออาชีพ — ระบุ layout สี ฟอนต์ ตำแหน่งโลโก้ รูปประธาน แกลเลอรี/คollage ของภาพกิจกรรมที่แนบมา ข้อความไทยหลัก และท้ายโปสเตอร์ (โทร เมล ที่อยู่) ห้ามละทิ้งส่วนท้ายและห้ามแทนภาพกิจกรรมด้วย stock art ตอบ prompt อย่างเดียว ไม่มี markdown'
    }
  ];
  refs.slice(0, 10).forEach((img, idx) => {
    parts.push({ type: 'text', text: posterRefImageCaption(img, idx) });
    parts.push({
      type: 'image_url',
      image_url: {
        url: img.dataUrl || `data:${img.mime || 'image/png'};base64,${img.b64}`,
        detail: idx < 6 ? 'high' : 'low'
      }
    });
  });
  const messages = [
    {
      role: 'system',
      content:
        'You write detailed English image-generation prompts for Thai cooperative news posters. Include Thai headline text to render, layout, colors, logo placement, chairman photo, a photo collage/grid of ALL attached event/news photos (never replace with generic illustrations), and footer contact block (phone, email, address in Thai) when provided — never omit footer details or user-attached event photos.'
    },
    { role: 'user', content: parts }
  ];
  try {
    const out = await callOpenAIChat(apiKey, pickVisionModel(config), messages, 1000);
    const cleaned = String(out || '').trim().slice(0, 1200);
    return finalizePosterImagePrompt(
      cleaned || buildDirectInfographicPrompt(text),
      text,
      personalizationCtx
    );
  } catch (_) {
    return finalizePosterImagePrompt(buildDirectInfographicPrompt(text), text, personalizationCtx);
  }
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

function translateOpenAiError(message) {
  const raw = String(message || '').trim();
  if (!raw) return 'เกิดข้อผิดพลาดจาก OpenAI';
  const lower = raw.toLowerCase();
  if (/billing hard limit|hard limit has been reached/i.test(raw)) {
    return (
      'วงเงิน Hard limit ของ OpenAI เต็มแล้ว — การเติม Credit Grants อย่างเดียวอาจยังไม่พอ ' +
      'กรุณาเพิ่ม Hard limit ที่ platform.openai.com/settings/organization/billing/limits ' +
      'แล้วกด "รีเซ็ตสถานะวงเงิน" ในแอดมิน › ตั้งค่า AI แชท'
    );
  }
  if (/exceeded your current quota|insufficient quota|quota exceeded/i.test(raw)) {
    return (
      'โควต้า API OpenAI หมดแล้ว — ตรวจสอบ Credit Grants และ Hard limit ที่ OpenAI Billing ' +
      'แล้วกด "รีเซ็ตสถานะวงเงิน" ในแอดมิน'
    );
  }
  if (/rate limit|too many requests|429/i.test(raw)) {
    return 'เรียก API ถี่เกินไป — รอสักครู่แล้วลองใหม่';
  }
  if (/invalid api key|incorrect api key|authentication/i.test(raw)) {
    return 'API Key ไม่ถูกต้อง — ตรวจสอบ OpenAI API Key ในแอดมิน';
  }
  if (/timeout|timed out/i.test(raw)) {
    return 'ใช้เวลานานเกินไป — ลองใหม่อีกครั้ง';
  }
  if (/[\u0E00-\u0E7F]/.test(raw)) return raw.slice(0, 280);
  if (lower.includes('openai')) return 'เกิดข้อผิดพลาดจาก OpenAI — ' + raw.slice(0, 160);
  return raw.slice(0, 240);
}

function isBillingLimitError(message) {
  const raw = String(message || '').toLowerCase();
  return (
    /billing hard limit|hard limit has been reached/.test(raw) ||
    /exceeded your current quota|insufficient quota|quota exceeded/.test(raw)
  );
}

function currentUsageMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

const API_USAGE_ESTIMATE_USD = {
  chat: 0.008,
  vision: 0.018,
  imageGen: 0.065,
  imagePrompt: 0.006
};

async function recordApiUsage(db, kind) {
  if (!db || !kind) return;
  try {
    const admin = require('firebase-admin');
    const FieldValue = admin.firestore.FieldValue;
    const month = currentUsageMonthKey();
    const incUsd = API_USAGE_ESTIMATE_USD[kind] || 0.005;
    const docRef = db.collection('config').doc(DESKTOP_AI_CONFIG_DOC);
    const snap = await docRef.get();
    const prev = snap.exists ? snap.data() : {};
    const prevStats = prev.usageStats && typeof prev.usageStats === 'object' ? prev.usageStats : {};
    const patch = { usageStats: { month, lastUpdatedAt: Date.now() } };
    if (prevStats.month !== month) {
      patch.usageStats.chatRequests = kind === 'chat' ? 1 : 0;
      patch.usageStats.visionRequests = kind === 'vision' ? 1 : 0;
      patch.usageStats.imageGenerations = kind === 'imageGen' ? 1 : 0;
      patch.usageStats.imagePromptRequests = kind === 'imagePrompt' ? 1 : 0;
      patch.usageStats.estimatedUsd = incUsd;
    } else {
      if (kind === 'chat') patch.usageStats.chatRequests = FieldValue.increment(1);
      if (kind === 'vision') patch.usageStats.visionRequests = FieldValue.increment(1);
      if (kind === 'imageGen') patch.usageStats.imageGenerations = FieldValue.increment(1);
      if (kind === 'imagePrompt') patch.usageStats.imagePromptRequests = FieldValue.increment(1);
      patch.usageStats.estimatedUsd = FieldValue.increment(incUsd);
    }
    await docRef.set(patch, { merge: true });
    if (prev.billingLimitHitAt || prevStats.billingLimitHitAt) {
      await clearBillingLimitHit(db);
    }
  } catch (e) {
    console.error('[nkbk-ai] recordApiUsage:', e.message);
  }
}

async function markBillingLimitHit(db) {
  if (!db) return;
  try {
    await db.collection('config').doc(DESKTOP_AI_CONFIG_DOC).set(
      {
        billingLimitHitAt: Date.now(),
        usageStats: { billingLimitHitAt: Date.now(), lastUpdatedAt: Date.now() }
      },
      { merge: true }
    );
  } catch (e) {
    console.error('[nkbk-ai] markBillingLimitHit:', e.message);
  }
}

async function clearBillingLimitHit(db) {
  if (!db) return;
  try {
    const admin = require('firebase-admin');
    const FieldValue = admin.firestore.FieldValue;
    const ref = db.collection('config').doc(DESKTOP_AI_CONFIG_DOC);
    try {
      await ref.update({
        billingLimitHitAt: FieldValue.delete(),
        'usageStats.billingLimitHitAt': FieldValue.delete(),
        'usageStats.lastUpdatedAt': Date.now()
      });
    } catch (updateErr) {
      const snap = await ref.get();
      const prev = snap.exists ? snap.data() || {} : {};
      const stats = { ...(prev.usageStats && typeof prev.usageStats === 'object' ? prev.usageStats : {}) };
      delete stats.billingLimitHitAt;
      stats.lastUpdatedAt = Date.now();
      await ref.set({ billingLimitHitAt: FieldValue.delete(), usageStats: stats }, { merge: true });
    }
  } catch (e) {
    console.error('[nkbk-ai] clearBillingLimitHit:', e.message);
  }
}

async function adminDeleteMediaItem(db, payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const memoryId = String(p.memoryId || '').trim();
  if (!memoryId) throw new Error('missing memoryId');
  const username = String(p.username || memoryId).trim();
  const ref = db.collection(MEMORY_COLLECTION).doc(memoryId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('ไม่พบข้อมูลผู้ใช้');
  const data = snap.data() || {};
  const kind = String(p.kind || '').trim();

  if (kind === 'library') {
    const libraryId = String(p.libraryId || '').trim();
    if (!libraryId) throw new Error('missing libraryId');
    const libBefore = normalizeUserLibrary(data.userLibrary);
    const libItem = libBefore.find((x) => x.id === libraryId);
    if (!libItem) throw new Error('ไม่พบรูปในไลบรารี');
    if (libItem.imageId) await deleteStorageObject(username, libItem.imageId, libItem.mime);
    if (libItem.fileId) await deleteStorageObject(username, libItem.fileId, libItem.mime);
    const userLibrary = libBefore.filter((x) => x.id !== libraryId);
    const memoryFileIds = (Array.isArray(data.memoryFileIds) ? data.memoryFileIds : [])
      .map(String)
      .filter((id) => id !== libraryId);
    const memoryFileLabels = { ...(data.memoryFileLabels || {}) };
    delete memoryFileLabels[libraryId];
    await ref.set(
      sanitizeForFirestore({ userLibrary, memoryFileIds, memoryFileLabels, updatedAt: new Date() }),
      { merge: true }
    );
  } else if (kind === 'chat') {
    const threadId = String(p.threadId || '');
    const msgIdx = Number(p.messageIndex);
    const imgIdx = Number(p.imageIndex);
    const imageId = String(p.imageId || '').trim();
    let removed = false;
    let storageImageId = imageId;
    let storageMime = p.mime || 'image/png';
    const threads = normalizeThreads(data).threads;

    const nextThreads = threads.map((t) => {
      if (String(t.id) !== threadId) return t;
      const chatHistory = (Array.isArray(t.chatHistory) ? t.chatHistory : []).map((m, mi) => {
        if (!Array.isArray(m.images) || !m.images.length) return m;
        let images = m.images.slice();
        if (mi === msgIdx && Number.isFinite(imgIdx) && images[imgIdx]) {
          if (!storageImageId && images[imgIdx].imageId) storageImageId = images[imgIdx].imageId;
          if (images[imgIdx].mime) storageMime = images[imgIdx].mime;
          images = images.filter((_, ii) => ii !== imgIdx);
          removed = true;
          return { ...m, images };
        }
        if (imageId) {
          const before = images.length;
          images = images.filter((img) => String(img && img.imageId) !== imageId);
          if (images.length < before) {
            removed = true;
            return { ...m, images };
          }
        }
        return m;
      });
      return { ...t, chatHistory, updatedAt: Date.now() };
    });

    if (!removed && imageId) {
      nextThreads = threads.map((t) => {
        const chatHistory = (Array.isArray(t.chatHistory) ? t.chatHistory : []).map((m) => {
          if (!Array.isArray(m.images) || !m.images.length) return m;
          const before = m.images.length;
          const images = m.images.filter((img) => String(img && img.imageId) !== imageId);
          if (images.length < before) {
            removed = true;
            return { ...m, images };
          }
          return m;
        });
        return removed ? { ...t, chatHistory, updatedAt: Date.now() } : t;
      });
    }

    if (!removed) throw new Error('ไม่พบรูปในแชต');
    if (storageImageId) await deleteStorageObject(username, storageImageId, storageMime);
    await ref.set(sanitizeForFirestore({ threads: nextThreads, updatedAt: new Date() }), { merge: true });
  } else {
    throw new Error('ไม่รองรับประเภทไฟล์นี้');
  }
  return { ok: true };
}

async function recordUserApiUsage(db, username, fullname, kind, meta) {
  if (!db || !username || !kind) return;
  try {
    const id = sanitizeMemoryId(username);
    const ref = db.collection(MEMORY_COLLECTION).doc(id);
    const month = currentUsageMonthKey();
    const prev = (await ref.get()).data() || {};
    const prevStats =
      prev.usageStats && prev.usageStats.month === month && typeof prev.usageStats === 'object'
        ? prev.usageStats
        : {};
    const stats = {
      month,
      chatRequests: (Number(prevStats.chatRequests) || 0) + (kind === 'chat' ? 1 : 0),
      visionRequests: (Number(prevStats.visionRequests) || 0) + (kind === 'vision' ? 1 : 0),
      imageGenerations: (Number(prevStats.imageGenerations) || 0) + (kind === 'imageGen' ? 1 : 0),
      imagePromptRequests:
        (Number(prevStats.imagePromptRequests) || 0) + (kind === 'imagePrompt' ? 1 : 0),
      lastActiveAt: Date.now()
    };
    const logEntry = {
      ts: Date.now(),
      kind,
      source: 'web',
      label: meta && meta.label ? String(meta.label).slice(0, 160) : kind
    };
    const usageLog = (Array.isArray(prev.usageLog) ? prev.usageLog : []).slice(-199);
    usageLog.push(logEntry);
    await ref.set(
      sanitizeForFirestore({
        username: String(username).trim(),
        fullname: fullname || prev.fullname || '',
        usageStats: stats,
        usageLog,
        updatedAt: new Date()
      }),
      { merge: true }
    );
  } catch (e) {
    console.error('[nkbk-ai] recordUserApiUsage:', e.message);
  }
}

function summarizeMemoryForAdmin(username, memory, usersById, defaultQuotaGb) {
  const norm = normalizeThreads(memory || {});
  const stats = computeStorageStats(norm.threads, memory && memory.userLibrary);
  const quotaGb =
    memory && memory.storageQuotaGb != null && Number(memory.storageQuotaGb) > 0
      ? Number(memory.storageQuotaGb)
      : defaultQuotaGb;
  let msgCount = 0;
  let userImageCount = 0;
  let aiImageCount = 0;
  let fileCount = stats.fileCount;
  const threads = [];
  (norm.threads || []).forEach((t) => {
    const hist = Array.isArray(t.chatHistory) ? t.chatHistory : [];
    msgCount += hist.length;
    let tUserImg = 0;
    let tAiImg = 0;
    hist.forEach((m) => {
      if (!m || !Array.isArray(m.images)) return;
      m.images.forEach((img) => {
        if (!img || img.omitted) return;
        if (m.role === 'assistant') tAiImg++;
        else tUserImg++;
      });
    });
    userImageCount += tUserImg;
    aiImageCount += tAiImg;
    threads.push({
      id: t.id,
      title: t.title || 'แชท',
      messageCount: hist.length,
      userImages: tUserImg,
      aiImages: tAiImg,
      updatedAt: t.updatedAt || t.createdAt || 0,
      archived: !!t.archived,
      chatHistory: hist
    });
  });
  const uid = sanitizeMemoryId(username);
  const userDoc = usersById[uid] || usersById[username] || null;
  const usage = (memory && memory.usageStats) || {};
  return {
    username: memory && memory.username ? memory.username : username,
    memoryId: uid,
    fullname: (memory && memory.fullname) || (userDoc && (userDoc.fullname || userDoc.nameTH)) || uid,
    role: userDoc && userDoc.role ? userDoc.role : '',
    userGroup: userDoc && (userDoc.group || userDoc.userGroup) ? userDoc.group || userDoc.userGroup : '',
    threadCount: threads.filter((t) => t.messageCount > 0).length,
    messageCount: msgCount,
    userImageCount,
    aiImageCount,
    fileCount,
    storageUsedBytes: stats.usedBytes,
    storageQuotaGb: quotaGb,
    savedPrompts: normalizeSavedPrompts(memory && memory.savedPrompts),
    standingInstructions: (memory && memory.standingInstructions) || '',
    preferences: normalizeUserPrefs(memory && memory.preferences),
    memoryFileIds: Array.isArray(memory && memory.memoryFileIds) ? memory.memoryFileIds : [],
    memoryFileLabels: memory && memory.memoryFileLabels ? memory.memoryFileLabels : {},
    userLibrary: normalizeUserLibrary(memory && memory.userLibrary),
    usageStats: usage,
    usageLog: Array.isArray(memory && memory.usageLog) ? memory.usageLog : [],
    threads,
    updatedAt: memory && memory.updatedAt ? memory.updatedAt : null
  };
}

function normalizeUsageStats(raw, config) {
  const stats = raw && typeof raw === 'object' ? raw : {};
  const month = currentUsageMonthKey();
  const active = stats.month === month ? stats : {};
  const budgetUsd = Math.max(1, Number(config && config.apiBudgetUsd) || 50);
  const alertPct = Math.max(50, Math.min(99, Number(config && config.apiBudgetAlertPct) || 80));
  const estimatedUsd = Math.max(0, Number(active.estimatedUsd) || 0);
  const pct = Math.min(100, Math.round((estimatedUsd / budgetUsd) * 1000) / 10);
  const billingHit = !!(stats.billingLimitHitAt || (config && config.billingLimitHitAt));
  let status = 'ok';
  let statusLabel = 'ปกติ';
  if (billingHit) {
    status = 'limit';
    statusLabel = 'วงเงินเต็ม';
  } else if (pct >= 100) {
    status = 'limit';
    statusLabel = 'ถึงวงเงินที่ตั้ง';
  } else if (pct >= alertPct) {
    status = 'warn';
    statusLabel = 'ใกล้เต็ม';
  }
  return {
    month,
    chatRequests: Number(active.chatRequests) || 0,
    visionRequests: Number(active.visionRequests) || 0,
    imageGenerations: Number(active.imageGenerations) || 0,
    imagePromptRequests: Number(active.imagePromptRequests) || 0,
    estimatedUsd: Math.round(estimatedUsd * 100) / 100,
    budgetUsd,
    alertPct,
    usagePct: pct,
    status,
    statusLabel,
    billingLimitHitAt: stats.billingLimitHitAt || config.billingLimitHitAt || null,
    lastUpdatedAt: stats.lastUpdatedAt || null
  };
}

function openaiJsonPost(apiKey, apiPath, body, timeoutMs) {
  if (!apiKey || !String(apiKey).trim()) {
    return Promise.reject(new Error('OpenAI API Key ยังไม่ได้ตั้งค่า'));
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
              const rawMsg = (j.error && j.error.message) || data.slice(0, 300) || 'OpenAI error';
              return reject(new Error(translateOpenAiError(rawMsg)));
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

async function generateImageResponses(apiKey, config, prompt, refImages, timeoutMs, opts) {
  const model = pickResponsesModel(config);
  const refs = Array.isArray(refImages) ? refImages : [];
  const isPoster = !!(opts && opts.poster);
  let input;
  if (refs.length) {
    const eventCount = refs.filter((img) => posterImageRole(img) === 'event').length;
    const refIntro = isPoster
      ? 'Create a professional Thai cooperative news poster. MUST embed ALL attached reference images into the final poster: use logo/chairman images for header branding, and place every attached event/news photo in a visible photo collage or grid section. Do NOT replace user event photos with generic stock illustrations, silhouettes, or clip art.\n\n'
      : 'Use the attached reference image(s) as the primary visual source. Keep the same layout, composition, colors, branding, and style unless the user asks to change them.\n\n';
    const eventNote =
      isPoster && eventCount
        ? `The user attached ${eventCount} event/news photo(s) — all must appear in the poster.\n\n`
        : '';
    const content = [
      {
        type: 'input_text',
        text: refIntro + eventNote + (prompt || 'สร้างรูปจากภาพอ้างอิงนี้')
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
  }, timeoutMs || 120000);
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

async function generateImages(apiKey, config, prompt, refImages, opts) {
  const refs = Array.isArray(refImages) ? refImages : [];
  const isPoster = !!(opts && opts.poster);
  const keyRefs = isPoster
    ? pickPosterRefImagesForGeneration(refs, Math.min(refs.length, 10))
    : pickRefImagesForGeneration(refs, refs.length > 2 ? 2 : 3);
  if (keyRefs.length) {
    const genOpts = isPoster ? { poster: true } : null;
    try {
      return await generateImageResponses(apiKey, config, prompt, keyRefs, 180000, genOpts);
    } catch (e) {
      console.error('[nkbk-ai] generateImageResponses failed:', e.message);
      if (isPoster && keyRefs.length > 2) {
        try {
          const reduced = pickPosterRefImagesForGeneration(keyRefs, Math.max(2, Math.ceil(keyRefs.length / 2)));
          return await generateImageResponses(apiKey, config, prompt, reduced, 180000, genOpts);
        } catch (e2) {
          console.error('[nkbk-ai] generateImageResponses retry failed:', e2.message);
        }
      }
      if (!isPoster && (refs.length > 1 || String(prompt || '').length > 400)) {
        return await generateImageSimple(apiKey, config, prompt, 240000);
      }
      throw e;
    }
  }
  return await generateImageSimple(apiKey, config, prompt, 240000);
}

function buildChatCompletionBody(model, messages, maxTokens, options) {
  const m = model || 'gpt-4o-mini';
  const limit = Math.min(4000, Math.max(256, parseInt(maxTokens, 10) || 1500));
  const body = { model: m, messages };
  const opts = options && typeof options === 'object' ? options : {};
  // gpt-5 / o-series ใช้ max_completion_tokens แทน max_tokens
  if (/^gpt-5|^o[0-9]/i.test(m)) {
    body.max_completion_tokens = limit;
  } else {
    body.max_tokens = limit;
    body.temperature = opts.temperature != null ? opts.temperature : 0.7;
  }
  return body;
}

function callOpenAIChat(apiKey, model, messages, maxTokens, options) {
  if (!apiKey || !String(apiKey).trim()) {
    return Promise.reject(new Error('OpenAI API Key not configured'));
  }
  const body = JSON.stringify(buildChatCompletionBody(model, messages, maxTokens, options));
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
            const rawMsg = (j.error && j.error.message) || data.slice(0, 200) || 'OpenAI error';
            return reject(new Error(translateOpenAiError(rawMsg)));
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
  const imgs = Array.isArray(userImages) ? userImages : [];
  const visionMessages = messages.map((m, idx) => {
    if (idx !== messages.length - 1 || m.role !== 'user' || !imgs.length) return m;
    const parts = [{ type: 'text', text: String(m.content || '') }];
    imgs.forEach((img, imgIdx) => {
      const detail = imgs.length <= 4 || imgIdx < 4 ? 'high' : 'auto';
      parts.push({
        type: 'image_url',
        image_url: {
          url: img.dataUrl || `data:${img.mime};base64,${img.b64}`,
          detail
        }
      });
    });
    return { role: 'user', content: parts };
  });
  return callOpenAIChat(apiKey, model, visionMessages, maxTokens);
}

const WELCOME_THAI_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const WELCOME_THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

function getBangkokNowForWelcome() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 420 * 60000);
}

function formatBangkokWelcomeContext() {
  const b = getBangkokNowForWelcome();
  const day = b.getDate();
  const month = WELCOME_THAI_MONTHS[b.getMonth()];
  const year = b.getFullYear() + 543;
  const dayOfWeek = WELCOME_THAI_DAYS[b.getDay()];
  const h = b.getHours();
  const m = b.getMinutes();
  return `วันนี้วันที่ ${day} ${month} ${year} วัน${dayOfWeek} เวลา ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} น. (Bangkok)`;
}

function sanitizeWelcomeGreeting(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^["'«»""]+|["'«»""]+$/g, '');
  s = s.replace(/\s+/g, ' ');
  if (s.length > 120) s = s.slice(0, 117) + '…';
  return s;
}

function fallbackWelcomeGreeting(userCallName) {
  const cn = userCallName && String(userCallName).trim();
  return cn ? `${cn} วันนี้คุณคิดอะไรอยู่` : 'วันนี้คุณคิดอะไรอยู่';
}

async function generateWelcomeGreeting(db, config, session) {
  const userCallName = await resolveUserCallName(db, config, session.username);
  const includeName = !!(userCallName && Math.random() < 0.9);
  const fallback = fallbackWelcomeGreeting(userCallName);
  const apiKey = config && config.openaiApiKey;
  if (!apiKey || !String(apiKey).trim()) {
    return { greeting: fallback, includeName, source: 'fallback' };
  }

  const assistantName = (config && config.displayName) || DEFAULT_DISPLAY_NAME;
  const bangkokCtx = formatBangkokWelcomeContext();
  const varietySeed = Math.random().toString(36).slice(2, 10);
  const systemPrompt = [
    `คุณสร้างข้อความต้อนรับสั้นๆ บนหน้าแรกของแชท AI "${assistantName}" สำหรับพนักงานสหกรณ์ออมทรัพย์สาธารณสุขจังหวัดหนองคาย`,
    'กติกา:',
    '- ตอบเพียง 1 ประโยคสั้น ไม่เกิน 80 ตัวอักษร',
    '- ภาษาไทย โทนเป็นกันเอง อบอุ่น กระชับ',
    '- เปลี่ยนสไตล์ทุกครั้ง เช่น ทักทาย ถามไถ่ ชวนคุย แนะนำฟีเจอร์ หรืออ้างอิงวัน/เวลา/ช่วงของวัน',
    '- ห้ามใส่ emoji หรือเครื่องหมายคำพูด',
    '- ห้ามพูดว่าเป็น AI หรือ model',
    '- ตอบเป็นข้อความล้วนๆ ไม่มีคำอธิบายเพิ่ม'
  ].join('\n');

  const userPrompt = [
    bangkokCtx,
    includeName
      ? `ให้ใส่ชื่อเรียกผู้ใช้ "${userCallName}" ในประโยค`
      : 'ครั้งนี้ไม่ต้องใส่ชื่อผู้ใช้',
    `seed: ${varietySeed}`,
    'สร้างข้อความต้อนรับ 1 ประโยค'
  ].join('\n');

  try {
    const model = (config && config.model) || 'gpt-4o-mini';
    const raw = await callOpenAIChat(
      apiKey,
      model,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      120,
      { temperature: 1.0 }
    );
    const greeting = sanitizeWelcomeGreeting(raw);
    if (!greeting) return { greeting: fallback, includeName, source: 'fallback' };
    void recordApiUsage(db, 'chat');
    void recordUserApiUsage(db, session.username, session.fullname, 'chat', {
      label: 'welcome greeting',
      kind: 'welcome'
    });
    return { greeting, includeName, source: 'ai' };
  } catch (e) {
    console.error('[nkbk-ai] welcome greeting:', e.message);
    return { greeting: fallback, includeName, source: 'fallback' };
  }
}

const COOP_THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

/** วันหยุดราชการ/วันหยุดสหกรณ์ (static) ตรงกับ Admin — ปี 2025–2026 */
const STATIC_THAI_HOLIDAYS_2025 = [
  { date: '2025-01-01', name: 'วันขึ้นปีใหม่' },
  { date: '2025-01-29', name: 'วันตรุษจีน' },
  { date: '2025-02-12', name: 'วันมาฆบูชา' },
  { date: '2025-03-30', name: 'สิ้นสุดรอมฎอน' },
  { date: '2025-04-06', name: 'วันจักรี' },
  { date: '2025-04-07', name: 'ชดเชยวันจักรี' },
  { date: '2025-04-13', name: 'เทศกาลสงกรานต์' },
  { date: '2025-04-14', name: 'เทศกาลสงกรานต์' },
  { date: '2025-04-15', name: 'เทศกาลสงกรานต์' },
  { date: '2025-05-01', name: 'วันแรงงาน' },
  { date: '2025-05-04', name: 'วันฉัตรมงคล' },
  { date: '2025-05-05', name: 'ชดเชยวันฉัตรมงคล' },
  { date: '2025-05-09', name: 'วันพืชมงคล' },
  { date: '2025-05-11', name: 'วันวิสาขบูชา' },
  { date: '2025-05-12', name: 'ชดเชยวันวิสาขบูชา' },
  { date: '2025-06-02', name: 'ชดเชยวันเฉลิมพระชนมพรรษาสมเด็จพระราชินี' },
  { date: '2025-06-03', name: 'วันเฉลิมพระชนมพรรษาสมเด็จพระราชินี' },
  { date: '2025-07-10', name: 'วันอาสาฬหบูชา' },
  { date: '2025-07-11', name: 'วันเข้าพรรษา' },
  { date: '2025-07-28', name: 'วันเฉลิมพระชนมพรรษาพระบาทสมเด็จพระเจ้าอยู่หัว' },
  { date: '2025-08-11', name: 'ชดเชยวันแม่แห่งชาติ' },
  { date: '2025-08-12', name: 'วันแม่แห่งชาติ' },
  { date: '2025-10-13', name: 'วันคล้ายวันสวรรคต ร.9' },
  { date: '2025-10-23', name: 'วันปิยมหาราช' },
  { date: '2025-12-05', name: 'วันคล้ายวันพระบรมราชสมภพ ร.9' },
  { date: '2025-12-10', name: 'วันรัฐธรรมนูญ' },
  { date: '2025-12-25', name: 'วันคริสต์มาส' },
  { date: '2025-12-31', name: 'วันสิ้นปี' }
];

const STATIC_THAI_HOLIDAYS_2026 = [
  { date: '2026-01-01', name: 'วันขึ้นปีใหม่' },
  { date: '2026-01-02', name: 'วันหยุดปีใหม่' },
  { date: '2026-02-17', name: 'วันตรุษจีน' },
  { date: '2026-03-03', name: 'วันมาฆบูชา' },
  { date: '2026-03-20', name: 'สิ้นสุดรอมฎอน' },
  { date: '2026-04-06', name: 'วันจักรี' },
  { date: '2026-04-13', name: 'เทศกาลสงกรานต์' },
  { date: '2026-04-14', name: 'เทศกาลสงกรานต์' },
  { date: '2026-04-15', name: 'เทศกาลสงกรานต์' },
  { date: '2026-05-01', name: 'วันแรงงาน' },
  { date: '2026-05-04', name: 'วันฉัตรมงคล' },
  { date: '2026-05-11', name: 'วันพืชมงคล' },
  { date: '2026-05-31', name: 'วันวิสาขบูชา' },
  { date: '2026-06-01', name: 'ชดเชยวันวิสาขบูชา' },
  { date: '2026-06-03', name: 'วันเฉลิมพระชนมพรรษาสมเด็จพระราชินี' },
  { date: '2026-07-28', name: 'วันเฉลิมพระชนมพรรษาพระบาทสมเด็จพระเจ้าอยู่หัว' },
  { date: '2026-07-29', name: 'วันอาสาฬหบูชา' },
  { date: '2026-07-30', name: 'วันเข้าพรรษา' },
  { date: '2026-08-12', name: 'วันแม่แห่งชาติ' },
  { date: '2026-10-13', name: 'วันคล้ายวันสวรรคต ร.9' },
  { date: '2026-10-23', name: 'วันปิยมหาราช' },
  { date: '2026-12-05', name: 'วันคล้ายวันพระบรมราชสมภพ ร.9' },
  { date: '2026-12-07', name: 'ชดเชยวันคล้ายวันพระบรมราชสมภพ ร.9' },
  { date: '2026-12-10', name: 'วันรัฐธรรมนูญ' },
  { date: '2026-12-25', name: 'วันคริสต์มาส' },
  { date: '2026-12-31', name: 'วันสิ้นปี' }
];

function getStaticThaiHolidaysForYear(gregorianYear) {
  if (gregorianYear === 2025) return STATIC_THAI_HOLIDAYS_2025;
  if (gregorianYear === 2026) return STATIC_THAI_HOLIDAYS_2026;
  return [];
}

function parseCoopHolidayDate(dateStr) {
  const date = String(dateStr || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const dateObj = new Date(date + 'T12:00:00');
  return Number.isNaN(dateObj.getTime()) ? null : dateObj;
}

function formatCoopHolidayDateBE(dateObj) {
  const day = dateObj.getDate();
  const month = COOP_THAI_MONTHS[dateObj.getMonth()];
  const yearBE = dateObj.getFullYear() + 543;
  return `${day} ${month} ${yearBE}`;
}

/**
 * สร้างบรรทัด context วันหยุดสหกรณ์ (static + Firestore) ตรงกับ Admin
 * @param {Array<object>} holidaysDocs - เอกสารจาก collection holidays
 * @param {object} [options]
 * @param {Date} [options.now] - วันที่อ้างอิง (default: วันนี้)
 * @param {number} [options.gregorianYear] - ปี ค.ศ. ที่ต้องการ (default: จาก now)
 * @param {boolean} [options.futureOnly=false] - true = เฉพาะวันหยุดที่ยังไม่ผ่าน
 * @param {number} [options.maxItems] - จำกัดจำนวนรายการ (เช่น staff brain)
 */
function buildCoopHolidayContextLines(holidaysDocs, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const now = opts.now instanceof Date ? opts.now : new Date();
  const gregorianYear = opts.gregorianYear != null ? Number(opts.gregorianYear) : now.getFullYear();
  const beYear = gregorianYear + 543;
  const futureOnly = opts.futureOnly === true;
  const maxItems = opts.maxItems != null ? Number(opts.maxItems) : null;

  const holidays = Array.isArray(holidaysDocs) ? holidaysDocs : [];
  const datesCoopOpen = new Set(
    holidays
      .filter((h) => h && h.hidden === true && h.date)
      .map((h) => String(h.date).trim().slice(0, 10))
  );

  const byDate = new Map();
  const staticForYear = getStaticThaiHolidaysForYear(gregorianYear);

  staticForYear.forEach((h) => {
    const date = String(h.date).trim().slice(0, 10);
    const dateObj = parseCoopHolidayDate(date);
    if (!dateObj || dateObj.getFullYear() !== gregorianYear) return;
    if (futureOnly && dateObj < startOfDay(now)) return;
    if (!byDate.has(date)) {
      byDate.set(date, { date, name: (h.name || '').trim() || '-', dateObj, source: 'static' });
    }
  });

  holidays.forEach((h) => {
    if (!h || !h.date || h.hidden === true) return;
    const date = String(h.date).trim().slice(0, 10);
    const dateObj = parseCoopHolidayDate(date);
    if (!dateObj || dateObj.getFullYear() !== gregorianYear) return;
    if (futureOnly && dateObj < startOfDay(now)) return;
    const name = (h.nameTH || h.name || '').trim() || '-';
    byDate.set(date, { date, name, dateObj, source: 'firestore' });
  });

  let sortedHolidays = Array.from(byDate.values()).sort((a, b) => a.dateObj - b.dateObj);
  if (maxItems != null && maxItems > 0) sortedHolidays = sortedHolidays.slice(0, maxItems);

  const lines = [
    'สหกรณ์หยุดทุกวันเสาร์-อาทิตย์',
    `อ้างอิงปี พ.ศ. ${beYear} (ปีปัจจุบัน)`
  ];

  if (sortedHolidays.length === 0) {
    lines.push('ไม่มีรายการวันหยุดนักขัตฤกษ์/พิเศษในปีนี้ (นอกจากเสาร์-อาทิตย์)');
  } else {
    sortedHolidays.forEach((h) => {
      const dateStr = formatCoopHolidayDateBE(h.dateObj);
      const isCoopOpen = datesCoopOpen.has(h.date);
      lines.push(
        isCoopOpen
          ? `${h.name}: ${dateStr} (สหกรณ์ไม่หยุด — เปิดทำการ)`
          : `${h.name}: ${dateStr}`
      );
    });
  }

  if (datesCoopOpen.size > 0) {
    lines.push('หมายเหตุ: (สหกรณ์ไม่หยุด) = วันที่สหกรณ์เปิดทำการตามที่แอดมินตั้งค่า');
  }

  return lines;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** ค่าเริ่มต้นช่องทางติดต่อ — sync กับ public-cms/site-config.js + หน้า /contact */
const CMS_CONTACT_DEFAULTS = {
  contactPagePath: '/contact',
  hoursTh: 'วันจันทร์–วันศุกร์: 08.30 น.-16.30 น.',
  phoneDisplay: '042-420750',
  email: 'support@nkbkcoop.com',
  address: '919 หมู่ 5 ต.โพธิ์ชัย อ.เมืองหนองคาย จ.หนองคาย 43000',
  fax: '042-420740',
  mobile: ['087-8604004', '089-8619198'],
  facebook: 'https://www.facebook.com/sahakon.nkbk',
  line: 'https://page.line.me/117kkqhx?openQrModal=true',
  youtube: 'https://www.youtube.com/@nkbkcoop',
  mapUrl: 'https://maps.app.goo.gl/FhT4ThAC2VPwt7dm9'
};

function normalizeCoopTimeDot(value, fallback) {
  const raw = value != null ? String(value).trim() : '';
  if (!raw) return fallback;
  return raw.replace(':', '.');
}

function buildMemberWorkHoursLine(org) {
  const start = normalizeCoopTimeDot(org && org.attendanceWorkStart, '08.30');
  const end = normalizeCoopTimeDot(org && org.attendanceWorkEnd, '16.30');
  const ct = (org && org.contact) || {};
  const hoursLabel = ct.hoursTh || CMS_CONTACT_DEFAULTS.hoursTh;
  return `[เวลาทำการสหกรณ์] ${hoursLabel} (เปิด ${start} น.-${end} น. วันจันทร์-ศุกร์)`;
}

function buildMemberContactContextLines(org, cmsSite) {
  const site = cmsSite && typeof cmsSite === 'object' ? cmsSite : {};
  const ct = site.contact || (org && org.contact) || {};
  const lines = [
    'ข้อมูลช่องทางติดต่อเดียวกับหน้า [ติดต่อเรา](/contact)',
    'หน้าติดต่อ: [ติดต่อเรา](/contact)'
  ];
  const hours = ct.hoursTh || CMS_CONTACT_DEFAULTS.hoursTh;
  lines.push('เวลาทำการ: ' + hours);
  const phone =
    site.phoneDisplay ||
    site.phone ||
    (org && (org.phoneDisplay || org.phone || org.contactPhone)) ||
    CMS_CONTACT_DEFAULTS.phoneDisplay;
  lines.push('โทรศัพท์: ' + String(phone).trim());
  const fax = ct.fax || CMS_CONTACT_DEFAULTS.fax;
  if (fax) lines.push('แฟกซ์: ' + String(fax).trim());
  const mobile = Array.isArray(ct.mobile) ? ct.mobile : CMS_CONTACT_DEFAULTS.mobile;
  if (mobile.length) lines.push('มือถือ: ' + mobile.join(', '));
  const email =
    site.email ||
    (org && (org.email || org.contactEmail)) ||
    CMS_CONTACT_DEFAULTS.email;
  if (email) lines.push('อีเมล: ' + String(email).trim());
  const address =
    site.address ||
    (org && org.address) ||
    CMS_CONTACT_DEFAULTS.address;
  if (address) lines.push('ที่อยู่: ' + String(address).trim());
  const facebook = site.facebook || CMS_CONTACT_DEFAULTS.facebook;
  const lineUrl = site.line || CMS_CONTACT_DEFAULTS.line;
  const youtube = site.youtube || CMS_CONTACT_DEFAULTS.youtube;
  const mapUrl = site.mapUrl || CMS_CONTACT_DEFAULTS.mapUrl;
  if (facebook) lines.push('Facebook: ' + facebook);
  if (lineUrl) lines.push('LINE Official: ' + lineUrl);
  if (youtube) lines.push('YouTube: ' + youtube);
  if (mapUrl) lines.push('แผนที่: ' + mapUrl);
  return lines;
}

async function buildPublicMemberDataContext(db) {
  const bundle = await loadPublicMemberContextBundle(db);
  return bundle.contextStr;
}

async function loadPublicMemberContextBundle(db) {
  const sections = [];
  let org = {};
  let cmsSite = {};
  try {
    const orgSnap = await db.collection('config').doc('org').get();
    org = orgSnap.exists ? orgSnap.data() || {} : {};
  } catch (e) {
    console.warn('[public-member-chat] org context:', e.message);
  }
  try {
    const cmsSnap = await db.collection('cms_site').doc('settings').get();
    cmsSite = cmsSnap.exists ? cmsSnap.data() || {} : {};
  } catch (e) {
    console.warn('[public-member-chat] cms_site context:', e.message);
  }
  const downloadPatches = cmsSite.downloadPatches || [];
  const downloadSections = await loadMemberDownloadSections(db, downloadPatches);
  const staffDirectory = await loadMemberStaffDirectory(db, org);
  sections.push(buildMemberWorkHoursLine({ ...cmsSite, ...org, contact: { ...(cmsSite.contact || {}), ...(org.contact || {}) } }));
  sections.push('[ช่องทางติดต่อสหกรณ์]\n' + buildMemberContactContextLines(org, cmsSite).join('\n'));
  sections.push('[แจ้งโอนเงิน]\n' + buildMemberPaymentContextLines(cmsSite).join('\n'));
  sections.push('[ทำเนียบเจ้าหน้าที่และกรรมการ]\n' + buildMemberStaffContextLines(staffDirectory).join('\n'));
  sections.push('[อัตราดอกเบี้ย]\n' + buildMemberInterestRatesContextLines(cmsSite).join('\n'));
  if (downloadSections.length) {
    sections.push('[แบบฟอร์มดาวน์โหลด]\n' + buildMemberDownloadsContextLines(downloadSections).join('\n'));
  }
  let holidaysDocs = [];
  try {
    const holSnap = await db.collection('holidays').limit(80).get();
    holidaysDocs = holSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
    const holidayLines = buildCoopHolidayContextLines(holidaysDocs, { futureOnly: false });
    sections.push('[วันหยุด/วันหยุดขัตฤกษ์]\n' + holidayLines.join('\n'));
  } catch (e) {
    console.warn('[public-member-chat] holidays context:', e.message);
  }
  const contextStr = sections.length
    ? sections.join('\n\n')
    : '(ไม่มีข้อมูลเพิ่มเติมจากระบบ — ตอบจากกฎสมาชิกและความรู้ทั่วไปเกี่ยวกับสหกรณ์)';
  return { contextStr, cmsSite, downloadSections, holidaysDocs, staffDirectory };
}

function buildPublicMemberSystemPrompt(lineCfg, dataContextStr) {
  const name = (lineCfg.name || 'โมเน่').trim();
  const gender = String(lineCfg.gender || 'female').toLowerCase();
  const particle = gender === 'male' ? 'ครับ' : 'คะ/ค่ะ';
  const rules = lineRulesToPrompt(lineCfg, 'member') || 'ให้บริการสมาชิกสหกรณ์อย่างสุภาพ ไม่เปิดเผยข้อมูลภายใน';
  const parts = [
    `คุณคือ ${name} — ผู้ช่วยบริการสมาชิกสหกรณ์ออมทรัพย์สาธารณสุขหนองคาย จำกัด`,
    `ใช้คำลงท้าย ${particle} พูดสั้น กระชับ เหมาะกับแชทบนเว็บไซต์`,
    'เมื่อพูดถึงวันหยุดนักขัตฤกษ์/พิเศษ ให้ใช้คำว่า "วันหยุดขัตฤกษ์" ไม่ใช้คำว่า "วันหยุดสหกรณ์"',
    'เมื่อถามเวลาทำการ ให้แจ้งช่วงเวลาเปิด-ปิดครบ เช่น 08.30 น.-16.30 น. และหยุดเสาร์-อาทิตย์',
    'เมื่อถามช่องทางติดต่อ (ทั่วไป) ให้ตอบจาก [ช่องทางติดต่อสหกรณ์] และแนะนำ [ติดต่อเรา](/contact)',
    'เมื่อถามแจ้งโอน/โอนเงิน/ชำระเงิน ให้ตอบจาก [แจ้งโอนเงิน] และแนะนำกรอกแบบฟอร์มที่ [แจ้งโอนเงิน](/infrom-payment) — ห้ามลิงก์ไป [ติดต่อเรา](/contact)',
    'เมื่อถามอัตราดอกเบี้ย ให้ตอบจาก [อัตราดอกเบี้ย] สั้นๆ 1-2 ประโยงตามประเภทที่ถาม (เงินฝาก / เงินกู้) — ห้ามพิมพ์ตารางเอง',
    'เมื่อถามวันหยุด ให้ตอบจาก [วันหยุด/วันหยุดขัตฤกษ์] สั้นๆ 1-2 ประโยง — ห้ามพิมพ์ตารางรายการวันหยุดเอง',
    'เมื่อถามแบบฟอร์ม/ดาวน์โหลด ให้ตอบจาก [แบบฟอร์มดาวน์โหลด] แนะนำชื่อแบบฟอร์มที่ตรงที่สุด หรือดูเพิ่มเติมที่ [ดาวน์โหลด](/download) — ห้ามใส่ URL ไฟล์',
    'เมื่อถามติดต่อเจ้าหน้าที่/ฝ่าย ให้แนะนำ [ทำเนียบฝ่ายจัดการ](/management)',
    'เมื่อถามประธาน/กรรมการ/คณะกรรมการ ให้แนะนำ [คณะกรรมการ](/team) — ห้ามลิงก์ไป [ทำเนียบฝ่ายจัดการ](/management)',
    'เมื่อถามประธาน/กรรมการ/เจ้าหน้าที่เฉพาะคน ตอบสั้นๆ 1 ประโยง — ระบบจะแสดงการ์ดรูป ชื่อ ตำแหน่ง เบอร์โทรให้ ห้ามพิมพ์ชื่อ-เบอร์ซ้ำ',
    ...memberChatPageLinkPromptLines(),
    'ห้ามเปิดเผยข้อมูลภายใน เช่น วันลา เข้างาน รหัสผ่าน ระบบ IT ที่ไม่เกี่ยวกับการติดต่อสาธารณะ',
    'ห้ามบอกยอดเงินฝาก/เงินกู้จริงถ้าไม่มีใน context — แนะนำติดต่อสหกรณ์',
    '## สมองสมาชิกสหกรณ์\n' + rules
  ];
  if (dataContextStr) parts.push('## ข้อมูลจากระบบ\n' + dataContextStr);
  return parts.filter(Boolean).join('\n\n');
}

async function runPublicMemberChat(db, payload) {
  const lineRaw = await getAiChatConfig(db);
  if (!lineRaw || lineRaw.enabled !== true) throw new Error('บริการแชทยังไม่เปิดใช้งาน');
  if (!(lineRaw.openaiApiKey && String(lineRaw.openaiApiKey).trim())) {
    throw new Error('ยังไม่ได้ตั้งค่า OpenAI API Key');
  }
  const body = payload && typeof payload === 'object' ? payload : {};
  const message = String(body.message || '').trim();
  if (!message) throw new Error('กรุณาพิมพ์ข้อความ');
  if (message.length > 2000) throw new Error('ข้อความยาวเกินไป');
  const history = Array.isArray(body.history)
    ? body.history
        .filter((h) => h && (h.role === 'user' || h.role === 'assistant') && h.content)
        .slice(-8)
        .map((h) => ({
          role: h.role,
          content: String(h.content).slice(0, 3000)
        }))
    : [];
  const ctxBundle = await loadPublicMemberContextBundle(db);
  const systemContent = buildPublicMemberSystemPrompt(lineRaw, ctxBundle.contextStr);
  const messages = [
    { role: 'system', content: systemContent },
    ...history,
    { role: 'user', content: message }
  ];
  const rawReply = await callOpenAIChat(
    lineRaw.openaiApiKey,
    lineRaw.model || 'gpt-4o-mini',
    messages,
    800,
    { temperature: 0.65 }
  );
  const trimmedReply = rawReply.length > 4000 ? rawReply.slice(0, 3997) + '...' : rawReply;
  const enriched = enrichPublicMemberChatReply(
    message,
    trimmedReply,
    ctxBundle.cmsSite,
    ctxBundle.downloadSections,
    ctxBundle.holidaysDocs,
    ctxBundle.staffDirectory
  );
  const result = {
    reply: enriched.reply,
    name: (lineRaw.name || 'โมเน่').trim()
  };
  if (enriched.html) result.html = enriched.html;
  if (enriched.downloads && enriched.downloads.length) result.downloads = enriched.downloads;
  return result;
}

async function getPublicMemberChatStatus(db) {
  const lineRaw = await getAiChatConfig(db);
  const enabled = !!(lineRaw && lineRaw.enabled === true && lineRaw.openaiApiKey && String(lineRaw.openaiApiKey).trim());
  const name = (lineRaw && lineRaw.name) ? String(lineRaw.name).trim() : 'โมเน่';
  const gender = lineRaw && lineRaw.gender ? String(lineRaw.gender) : 'female';
  const greeting =
    gender === 'male'
      ? `สวัสดีครับ น้อง${name} ยินดีให้บริการสมาชิกสหกรณ์ครับ มีอะไรให้ช่วยไหมครับ?`
      : `สวัสดีค่ะ น้อง${name} ยินดีให้บริการสมาชิกสหกรณ์ค่ะ มีอะไรให้ช่วยไหมคะ?`;
  return { enabled, name, gender, greeting };
}

async function runChat(db, config, session, payload) {
  const body = payload && typeof payload === 'object' ? payload : { message: payload };
  const text = String(body.message || '').trim();
  const mode = body.mode || 'auto';
  const attachLimits = getAttachLimits(config);
  let incomingImages = normalizeIncomingImages(body.images, attachLimits.maxAttachCount);
  incomingImages = await resolveIncomingImagesForChat(session.username, incomingImages);
  const incomingFiles = normalizeIncomingFiles(
    body.files,
    Math.max(0, attachLimits.maxAttachCount - incomingImages.length)
  );
  validateIncomingAttachments(config, incomingImages, incomingFiles);
  const forceGenerate = mode === 'generate' || wantsImageGeneration(text);
  const hasImages = incomingImages.length > 0;
  const hasFiles = incomingFiles.length > 0;

  if (!text && !hasImages && !hasFiles) throw new Error('ข้อความว่าง');

  const memoryRaw = (await getUserMemory(db, session.username)) || {};
  let { threads, activeThreadId } = normalizeThreads(memoryRaw);
  let activeThread = getActiveThread(threads, activeThreadId);
  if (!activeThreadId || !activeThread) {
    const id = makeThreadId();
    activeThread = ensureThreadMeta({
      id,
      title: 'แชทใหม่',
      chatHistory: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    threads = [activeThread, ...threads];
    activeThreadId = id;
  }

  const threadQuotaBytes = getThreadQuotaBytes(config);
  const threadUsedBytes = computeThreadStorageBytes(activeThread);
  if (threadUsedBytes >= threadQuotaBytes) {
    throw new Error(THREAD_QUOTA_MSG);
  }

  const docContext = hasFiles ? await buildDocumentsContext(incomingFiles) : '';
  let effectiveText = text;
  if (docContext) {
    effectiveText = (text ? text + '\n\n' : '') + '--- เนื้อหาจากไฟล์ที่แนบ ---\n' + docContext;
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
  const userPrefs = normalizeUserPrefs(memoryRaw.preferences);
  const memoryFilesContext = buildMemoryFilesContext(memoryRaw, session.username);
  const promptMemory = { standingInstructions, memoryFilesContext, preferences: userPrefs };
  const imageGenPersonalizationCtx = buildImageGenPersonalizationContext(
    promptMemory,
    userCallName,
    userPrefs
  );

  const remember = text ? extractRememberInstruction(text) : null;
  let memoryUpdated = false;
  if (remember) {
    standingInstructions = standingInstructions
      ? standingInstructions + '\n- ' + remember
      : '- ' + remember;
    memoryUpdated = true;
  }

  const userLabel =
    text ||
    (hasImages && hasFiles ? '[ส่งรูปและไฟล์]' : hasImages ? '[ส่งรูปภาพ]' : hasFiles ? '[ส่งไฟล์]' : '');
  let reply = '';
  let images = [];
  let imagePromptUsed = '';
  let usageKind = null;
  let posterVisionUsed = false;
  let refVisionUsed = false;

  try {
    if (wantsImageGenFlow(text, hasImages, forceGenerate)) {
      usageKind = 'imageGen';
      const rawPrompt = extractImagePrompt(text) || 'สร้างรูปภาพสวยงามตามภาพอ้างอิง';
      const memoryImages = await resolveMemoryImagesForPrompt(memoryRaw, session.username, text);
      const combinedImages = mergeImageLists(memoryImages, incomingImages, attachLimits.maxAttachCount);
      const hasCombinedImages = combinedImages.length > 0;
      const isPoster = wantsPosterDesignFlow(text);
      let prompt;
      if (isPoster) {
        posterVisionUsed = true;
        prompt = await buildPosterGenerationPrompt(
          config.openaiApiKey,
          config,
          rawPrompt,
          combinedImages,
          memoryFilesContext,
          imageGenPersonalizationCtx
        );
      } else if (hasCombinedImages) {
        refVisionUsed = true;
        prompt = await buildReferenceImagePrompt(config.openaiApiKey, config, rawPrompt, combinedImages);
      } else if (rawPrompt.length > 100) {
        prompt = buildDirectInfographicPrompt(rawPrompt);
      } else {
        prompt = await prepareImagePrompt(config.openaiApiKey, config, rawPrompt);
      }
      imagePromptUsed = prompt;
      images = await generateImages(
        config.openaiApiKey,
        config,
        prompt,
        hasCombinedImages ? combinedImages : [],
        { poster: isPoster }
      );
      reply = images.length ? '' : 'สร้างรูปไม่สำเร็จ';
    } else if (hasImages) {
      usageKind = 'vision';
      const systemContent = buildSystemPrompt(config, promptMemory, session, userCallName, userPrefs);
      const messages = [{ role: 'system', content: systemContent }];
      chatHistory.forEach((m) => {
        if (m && (m.role === 'user' || m.role === 'assistant') && m.content) {
          messages.push({ role: m.role, content: String(m.content) });
        }
      });
      messages.push({
        role: 'user',
        content: effectiveText || 'ช่วยอธิบายหรือวิเคราะห์รูปนี้ให้หน่อย'
      });
      const visionMaxTokens =
        incomingImages.length > 3
          ? Math.max(config.maxTokens || 1500, 2800)
          : config.maxTokens || 1500;
      reply = await callOpenAIChatVision(
        config.openaiApiKey,
        config,
        messages,
        visionMaxTokens,
        incomingImages
      );
    } else {
      usageKind = 'chat';
      const systemContent = buildSystemPrompt(config, promptMemory, session, userCallName, userPrefs);
      const messages = [{ role: 'system', content: systemContent }];
      chatHistory.forEach((m) => {
        if (m && (m.role === 'user' || m.role === 'assistant') && m.content) {
          messages.push({ role: m.role, content: String(m.content) });
        }
      });
      messages.push({ role: 'user', content: effectiveText });
      reply = await callOpenAIChat(
        config.openaiApiKey,
        config.model,
        messages,
        config.maxTokens || 1500
      );
    }
  } catch (aiErr) {
    const rawMsg = aiErr && aiErr.message ? String(aiErr.message) : String(aiErr || '');
    const msg = translateOpenAiError(rawMsg);
    console.error('[nkbk-ai] chat ai failed:', msg);
    if (isBillingLimitError(rawMsg)) void markBillingLimitHit(db);
    if (usageKind === 'imageGen') throw new Error('สร้างรูปไม่สำเร็จ — ' + msg);
    throw new Error(msg);
  }

  if (usageKind === 'imageGen') {
    void recordApiUsage(db, 'imageGen');
    void recordUserApiUsage(db, session.username, session.fullname, 'imageGen', {
      label: text ? text.slice(0, 80) : 'สร้างรูป'
    });
    if (posterVisionUsed || refVisionUsed) {
      void recordApiUsage(db, 'imagePrompt');
      void recordUserApiUsage(db, session.username, session.fullname, 'imagePrompt', { label: 'เตรียม prompt' });
    }
  } else if (usageKind === 'vision') {
    void recordApiUsage(db, 'vision');
    void recordUserApiUsage(db, session.username, session.fullname, 'vision', {
      label: text ? text.slice(0, 80) : 'วิเคราะห์รูป'
    });
  } else if (usageKind === 'chat') {
    void recordApiUsage(db, 'chat');
    void recordUserApiUsage(db, session.username, session.fullname, 'chat', {
      label: text ? text.slice(0, 80) : 'แชท'
    });
  }

  const isImageEdit = !!body.isImageEdit;
  let savedUserImages = [];
  if (hasImages) {
    savedUserImages = await Promise.all(
      incomingImages.map(async (img) => {
        if (img.imageId && (img._source === 'library' || img.libraryId)) {
          return {
            mime: img.mime || 'image/png',
            imageId: img.imageId,
            publicUrl: img.publicUrl || imagePublicUrl(session.username, img.imageId),
            fromLibrary: true,
            ...(img.libraryId ? { libraryId: img.libraryId } : {})
          };
        }
        const saved = await persistHistoryImageAsync(session.username, img);
        if (saved && saved.publicUrl) {
          return { mime: saved.mime || img.mime || 'image/png', imageId: saved.imageId, publicUrl: saved.publicUrl };
        }
        if (saved && saved.imageId) {
          return { mime: saved.mime || img.mime || 'image/png', imageId: saved.imageId };
        }
        return { mime: img.mime || 'image/png', b64: img.b64 };
      })
    );
  }

  const userEntry = {
    role: 'user',
    content: userLabel,
    ts: Date.now(),
    ...(hasImages ? { images: savedUserImages } : {}),
    ...(isImageEdit && savedUserImages.length
      ? {
          isImageEdit: true,
          editRef: {
            mime: savedUserImages[0].mime || 'image/png',
            ...(savedUserImages[0].imageId ? { imageId: savedUserImages[0].imageId } : {}),
            ...(savedUserImages[0].publicUrl ? { publicUrl: savedUserImages[0].publicUrl } : {}),
            ...(savedUserImages[0].b64 ? { b64: savedUserImages[0].b64 } : {})
          },
          ...(savedUserImages.length > 1
            ? {
                editExtras: savedUserImages.slice(1).map((img) => ({
                  mime: img.mime || 'image/png',
                  ...(img.imageId ? { imageId: img.imageId } : {}),
                  ...(img.publicUrl ? { publicUrl: img.publicUrl } : {}),
                  ...(img.b64 ? { b64: img.b64 } : {})
                }))
              }
            : {})
        }
      : {}),
    ...(hasFiles
      ? {
          files: incomingFiles.map((f) => ({
            name: f.name,
            mime: f.mime || 'application/octet-stream'
          }))
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
  unarchiveThread,
  markThreadShared,
  revokeThreadShare,
  deleteAllVisibleThreads,
  renameThread,
  normalizeUserPrefs,
  getStorageQuotaBytes,
  computeStorageStats,
  getUserSettingsBundle,
  saveUserPreferences,
  saveUserSettings,
  trackPromptActivity,
  recordPromptCompletion,
  saveQuickPrompt,
  dismissPromptSuggestion,
  normalizeSavedPrompts,
  promptTitleFromText,
  PROMPT_SUGGEST_THRESHOLD,
  listSharedLinks,
  listArchivedThreads,
  collectLibraryItems,
  deleteLibraryItems,
  deleteStorageObject,
  uploadLibraryItems,
  buildMemoryFilesContext,
  findThreadByRef,
  buildSystemPrompt,
  generateWelcomeGreeting,
  extractRememberInstruction,
  callOpenAIChat,
  callOpenAIChatVision,
  generateImages,
  wantsImageGeneration,
  normalizeIncomingImages,
  normalizeIncomingFiles,
  runChat,
  runPublicMemberChat,
  getPublicMemberChatStatus,
  buildPublicMemberSystemPrompt,
  buildPublicMemberDataContext,
  buildCoopHolidayContextLines,
  persistHistoryImageAsync,
  expandHistoryForClient,
  readPersistedImage,
  readPersistedImageFromStorage,
  imagePublicUrl,
  stripHeavyImagesFromHistory,
  trimChatHistory,
  translateOpenAiError,
  normalizeUsageStats,
  isBillingLimitError,
  markBillingLimitHit,
  clearBillingLimitHit,
  adminDeleteMediaItem,
  recordApiUsage,
  recordUserApiUsage,
  getAttachLimits,
  getThreadQuotaBytes,
  computeThreadStorageBytes,
  THREAD_QUOTA_MSG,
  summarizeMemoryForAdmin
};
