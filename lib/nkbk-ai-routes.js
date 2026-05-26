/**
 * Express routes for NKBK Desktop AI (ChatGPT โมเน่)
 */
const fs = require('fs');
const nkbkAi = require('./nkbk-ai');
const memberChatInbox = require('./member-chat-inbox');

function getToken(req) {
  return (req.headers['x-monitor-token'] || req.query.token || '').trim();
}

function getAdminBearer(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7).trim();
  return (req.query.adminToken || req.query.token || '').trim();
}

function registerNkbkAiRoutes(app, deps) {
  const { getDb, resolveSession, proxyToRemote } = deps;

  async function verifyAdminAccess(req) {
    const token = getAdminBearer(req);
    if (!token) return null;
    try {
      const admin = require('firebase-admin');
      if (!admin.apps.length) admin.initializeApp();
      const decoded = await admin.auth().verifyIdToken(token);
      if (decoded.uid === 'yPyuxPnu9tQmK89OH4NrUBjJ3jb2' || decoded.admin === true) return decoded;
      const db = typeof getDb === 'function' ? getDb() : null;
      if (!db) return decoded;
      const roleOk = (role) => /^(ผู้ดูแลระบบ|แอดมิน|admin)$/i.test(String(role || '').trim());
      const userDoc = await db.collection('users').doc(decoded.uid).get();
      if (userDoc.exists && roleOk(userDoc.data().role)) return decoded;
      const email = String(decoded.email || '').trim().toLowerCase();
      if (email) {
        const byEmail = await db.collection('users').where('email', '==', email).limit(1).get();
        if (!byEmail.empty && roleOk(byEmail.docs[0].data().role)) return decoded;
      }
      return null;
    } catch (e) {
      console.error('[nkbk-ai] verifyAdminAccess:', e.message);
      return null;
    }
  }

  async function verifyStaffAccess(req) {
    const bearer = getAdminBearer(req);
    const db = typeof getDb === 'function' ? getDb() : null;
    if (bearer) {
      try {
        const admin = require('firebase-admin');
        if (!admin.apps.length) admin.initializeApp();
        const decoded = await admin.auth().verifyIdToken(bearer);
        if (!db) return null;
        const staff = await memberChatInbox.resolveStaffFromToken(db, nkbkAi, decoded);
        if (staff) return staff;
      } catch (e) {
        console.error('[member-chat] verifyStaff bearer:', e.message);
      }
    }
    const monitorToken = getToken(req);
    if (monitorToken && typeof resolveSession === 'function' && db) {
      try {
        const session = await resolveSession(monitorToken);
        if (session) {
          const staff = await memberChatInbox.resolveStaffFromMonitorSession(db, nkbkAi, session);
          if (staff) return staff;
        }
      } catch (e) {
        console.error('[member-chat] verifyStaff monitor:', e.message);
      }
    }
    return null;
  }

  async function withSession(req, res) {
    const token = getToken(req);
    const session = await resolveSession(token);
    if (!session) {
      res.status(401).json({ ok: false, reason: 'no_session', message: 'กรุณาเข้าสู่ระบบใหม่' });
      return null;
    }
    return session;
  }

  async function withDb(req, res, apiPath) {
    const db = typeof getDb === 'function' ? getDb() : null;
    if (!db) {
      if (typeof proxyToRemote === 'function') {
        await proxyToRemote(req, res, apiPath);
        return null;
      }
      res.status(503).json({ ok: false, reason: 'no_firestore', message: 'ระบบ AI ยังไม่พร้อม (Firestore)' });
      return null;
    }
    return db;
  }

  async function loadConfig(db) {
    return nkbkAi.getEffectiveAiConfig(db);
  }

  const CMS_PDF_HOSTS = new Set([
    'nkbkcoop.com',
    'www.nkbkcoop.com',
    'admin-panel-nkbkcoop-cbf10.web.app',
    'res.cloudinary.com',
    'firebasestorage.googleapis.com',
    'storage.googleapis.com'
  ]);

  function isAllowedCmsPdfUrl(raw) {
    try {
      const u = new URL(String(raw || ''));
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
      const host = u.hostname.toLowerCase();
      if (CMS_PDF_HOSTS.has(host)) return true;
      return host.endsWith('.nkbkcoop.com') || host.endsWith('.web.app');
    } catch {
      return false;
    }
  }

  app.get('/api/cms-pdf', async (req, res) => {
    try {
      const raw = String(req.query.url || '').trim();
      if (!raw || !isAllowedCmsPdfUrl(raw)) {
        return res.status(403).json({ ok: false, message: 'URL ไม่ได้รับอนุญาต' });
      }
      const resp = await fetch(raw, { redirect: 'follow' });
      if (!resp.ok) {
        return res.status(resp.status).json({ ok: false, message: 'โหลด PDF ไม่สำเร็จ' });
      }
      const ct = resp.headers.get('content-type') || 'application/pdf';
      res.setHeader('Content-Type', ct.includes('pdf') ? ct : 'application/pdf');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Access-Control-Allow-Origin', '*');
      const buf = Buffer.from(await resp.arrayBuffer());
      return res.send(buf);
    } catch (e) {
      console.error('[cms-pdf]', e.message);
      return res.status(500).json({ ok: false, message: e.message || 'โหลด PDF ไม่สำเร็จ' });
    }
  });

  app.get('/api/public-cms-chat/status', async (req, res) => {
    try {
      const db = await withDb(req, res, '/api/public-cms-chat/status');
      if (!db) return;
      const status = await nkbkAi.getPublicMemberChatStatus(db);
      return res.json({ ok: true, ...status });
    } catch (e) {
      console.error('[public-cms-chat] status:', e.message);
      return res.status(500).json({ ok: false, message: e.message });
    }
  });

  app.post('/api/public-cms-chat', async (req, res) => {
    try {
      const db = await withDb(req, res, '/api/public-cms-chat');
      if (!db) return;
      const reqMeta = {
        pageUrl: String(req.headers['x-page-url'] || req.body?.pageUrl || '').trim() || null,
        userAgent: String(req.headers['user-agent'] || '').slice(0, 300)
      };
      const result = await memberChatInbox.handlePublicChat(db, nkbkAi, req.body || {}, reqMeta);
      return res.json({ ok: true, ...result });
    } catch (e) {
      console.error('[public-cms-chat] chat:', e.message);
      const msg = nkbkAi.translateOpenAiError ? nkbkAi.translateOpenAiError(e.message || 'เกิดข้อผิดพลาด') : (e.message || 'เกิดข้อผิดพลาด');
      return res.status(500).json({ ok: false, message: msg });
    }
  });

  app.get('/api/public-cms-chat/poll', async (req, res) => {
    try {
      const db = await withDb(req, res, '/api/public-cms-chat/poll');
      if (!db) return;
      const conversationId = String(req.query.conversationId || '').trim();
      const since = Number(req.query.since) || 0;
      const result = await memberChatInbox.pollPublicMessages(db, conversationId, since);
      if (result.messages && result.messages.length) {
        await memberChatInbox.markVisitorRead(db, conversationId);
      }
      return res.json(result);
    } catch (e) {
      console.error('[public-cms-chat] poll:', e.message);
      return res.status(400).json({ ok: false, message: e.message || 'poll failed' });
    }
  });

  app.get('/api/member-chat/conversations', async (req, res) => {
    try {
      const staff = await verifyStaffAccess(req);
      if (!staff) return res.status(403).json({ ok: false, message: 'ไม่มีสิทธิ์' });
      const db = await withDb(req, res, '/api/member-chat/conversations');
      if (!db) return;
      const items = await memberChatInbox.listConversations(db, staff, req.query || {});
      return res.json({ ok: true, items });
    } catch (e) {
      console.error('[member-chat] list:', e.message);
      return res.status(500).json({ ok: false, message: e.message });
    }
  });

  app.get('/api/member-chat/conversations/:id', async (req, res) => {
    try {
      const staff = await verifyStaffAccess(req);
      if (!staff) return res.status(403).json({ ok: false, message: 'ไม่มีสิทธิ์' });
      const db = await withDb(req, res, '/api/member-chat/conversations/:id');
      if (!db) return;
      const detail = await memberChatInbox.getConversationDetail(db, staff, req.params.id);
      return res.json({ ok: true, ...detail });
    } catch (e) {
      console.error('[member-chat] get:', e.message);
      const code = /ไม่มีสิทธิ์|ไม่พบ/.test(e.message) ? 403 : 500;
      return res.status(code).json({ ok: false, message: e.message });
    }
  });

  app.post('/api/member-chat/conversations/:id/reply', async (req, res) => {
    try {
      const staff = await verifyStaffAccess(req);
      if (!staff) return res.status(403).json({ ok: false, message: 'ไม่มีสิทธิ์' });
      const db = await withDb(req, res, '/api/member-chat/conversations/:id/reply');
      if (!db) return;
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const result = await memberChatInbox.staffReply(db, staff, req.params.id, body.content || body.message);
      return res.json({ ok: true, ...result });
    } catch (e) {
      console.error('[member-chat] reply:', e.message);
      return res.status(400).json({ ok: false, message: e.message });
    }
  });

  app.post('/api/member-chat/conversations/:id/assign', async (req, res) => {
    try {
      const staff = await verifyStaffAccess(req);
      if (!staff) return res.status(403).json({ ok: false, message: 'ไม่มีสิทธิ์' });
      const db = await withDb(req, res, '/api/member-chat/conversations/:id/assign');
      if (!db) return;
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const result = await memberChatInbox.assignConversation(db, staff, req.params.id, body.assignTo || body);
      return res.json(result);
    } catch (e) {
      console.error('[member-chat] assign:', e.message);
      return res.status(400).json({ ok: false, message: e.message });
    }
  });

  app.post('/api/member-chat/conversations/:id/takeover', async (req, res) => {
    try {
      const staff = await verifyStaffAccess(req);
      if (!staff) return res.status(403).json({ ok: false, message: 'ไม่มีสิทธิ์' });
      const db = await withDb(req, res, '/api/member-chat/conversations/:id/takeover');
      if (!db) return;
      const result = await memberChatInbox.takeoverConversation(db, staff, req.params.id);
      return res.json(result);
    } catch (e) {
      console.error('[member-chat] takeover:', e.message);
      return res.status(400).json({ ok: false, message: e.message });
    }
  });

  app.post('/api/member-chat/conversations/:id/release', async (req, res) => {
    try {
      const staff = await verifyStaffAccess(req);
      if (!staff) return res.status(403).json({ ok: false, message: 'ไม่มีสิทธิ์' });
      const db = await withDb(req, res, '/api/member-chat/conversations/:id/release');
      if (!db) return;
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const result = await memberChatInbox.releaseConversation(db, staff, req.params.id, body.action);
      return res.json(result);
    } catch (e) {
      console.error('[member-chat] release:', e.message);
      return res.status(400).json({ ok: false, message: e.message });
    }
  });

  app.get('/api/member-chat/stats', async (req, res) => {
    try {
      const staff = await verifyStaffAccess(req);
      if (!staff) return res.status(403).json({ ok: false, message: 'ไม่มีสิทธิ์' });
      const db = await withDb(req, res, '/api/member-chat/stats');
      if (!db) return;
      const stats = await memberChatInbox.getStats(db, staff);
      return res.json({ ok: true, stats });
    } catch (e) {
      console.error('[member-chat] stats:', e.message);
      return res.status(500).json({ ok: false, message: e.message });
    }
  });

  app.get('/api/nkbk-ai-status', async (req, res) => {
    try {
      const session = await withSession(req, res);
      if (!session) return;
      const db = await withDb(req, res, '/api/nkbk-ai-status');
      if (!db) return;
      const config = await loadConfig(db);
      const pub = nkbkAi.publicConfig(config);
      const allowed = nkbkAi.isUserAllowed(config, session.username);
      const userCallName = await nkbkAi.resolveUserCallName(db, config, session.username);
      return res.json({
        ok: true,
        ...pub,
        userCallName,
        allowed,
        ready: pub.enabled && pub.hasApiKey && allowed
      });
    } catch (e) {
      console.error('[nkbk-ai] status:', e.message);
      return res.status(500).json({ ok: false, message: e.message });
    }
  });

  app.get('/api/nkbk-ai-welcome', async (req, res) => {
    try {
      const session = await withSession(req, res);
      if (!session) return;
      const db = await withDb(req, res, '/api/nkbk-ai-welcome');
      if (!db) return;
      const config = await loadConfig(db);
      if (!nkbkAi.isUserAllowed(config, session.username)) {
        return res.status(403).json({ ok: false, message: nkbkAi.denyMessage(config) });
      }
      const result = await nkbkAi.generateWelcomeGreeting(db, config, session);
      return res.json({ ok: true, ...result });
    } catch (e) {
      console.error('[nkbk-ai] welcome:', e.message);
      return res.status(500).json({ ok: false, message: e.message });
    }
  });

  app.get('/api/nkbk-ai-memory', async (req, res) => {
    try {
      const session = await withSession(req, res);
      if (!session) return;
      const db = await withDb(req, res, '/api/nkbk-ai-memory');
      if (!db) return;
      const config = await loadConfig(db);
      if (!nkbkAi.isUserAllowed(config, session.username)) {
        return res.status(403).json({ ok: false, message: nkbkAi.denyMessage(config) });
      }
      const memory = (await nkbkAi.getUserMemory(db, session.username)) || {};
      const norm = nkbkAi.normalizeThreads(memory);
      const userCallName = await nkbkAi.resolveUserCallName(db, config, session.username);
      const active = norm.threads.find((t) => t.id === norm.activeThreadId);
      const threadQuotaBytes = nkbkAi.getThreadQuotaBytes(config);
      const activeThreadBytes = active ? nkbkAi.computeThreadStorageBytes(active) : 0;
      return res.json({
        ok: true,
        standingInstructions: memory.standingInstructions || '',
        userCallName,
        activeThreadId: norm.activeThreadId,
        threadStorage: {
          usedBytes: activeThreadBytes,
          quotaBytes: threadQuotaBytes,
          overQuota: activeThreadBytes >= threadQuotaBytes
        },
        threads: nkbkAi.publicThreads(norm.threads, norm.activeThreadId, config && config.chatHistoryMax),
        chatHistory: nkbkAi.expandHistoryForClient(
          session.username,
          nkbkAi.trimChatHistory(active && active.chatHistory ? active.chatHistory : [], config && config.chatHistoryMax)
        )
      });
    } catch (e) {
      console.error('[nkbk-ai] memory get:', e.message);
      return res.status(500).json({ ok: false, message: e.message });
    }
  });

  app.post('/api/nkbk-ai-memory', async (req, res) => {
    try {
      const session = await withSession(req, res);
      if (!session) return;
      const db = await withDb(req, res, '/api/nkbk-ai-memory');
      if (!db) return;
      const config = await loadConfig(db);
      if (!nkbkAi.isUserAllowed(config, session.username)) {
        return res.status(403).json({ ok: false, message: nkbkAi.denyMessage(config) });
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      let userCallName = null;
      if (body.userCallName != null) {
        userCallName = await nkbkAi.syncUserCallName(db, session.username, body.userCallName);
      }
      const patch = {
        standingInstructions: body.standingInstructions,
        userCallName: userCallName != null ? userCallName : body.userCallName
      };
      if (body.preferences != null) patch.preferences = body.preferences;
      const saved = await nkbkAi.saveUserMemory(db, session.username, session.fullname, patch);
      const resolvedName = await nkbkAi.resolveUserCallName(db, config, session.username);
      return res.json({ ok: true, ...saved, userCallName: resolvedName });
    } catch (e) {
      console.error('[nkbk-ai] memory put:', e.message);
      return res.status(500).json({ ok: false, message: e.message });
    }
  });

  app.get('/api/nkbk-ai-settings', async (req, res) => {
    try {
      const session = await withSession(req, res);
      if (!session) return;
      const db = await withDb(req, res, '/api/nkbk-ai-settings');
      if (!db) return;
      const config = await loadConfig(db);
      if (!nkbkAi.isUserAllowed(config, session.username)) {
        return res.status(403).json({ ok: false, message: nkbkAi.denyMessage(config) });
      }
      const bundle = await nkbkAi.getUserSettingsBundle(db, config, session, session.username);
      return res.json({ ok: true, ...bundle });
    } catch (e) {
      console.error('[nkbk-ai] settings get:', e.message);
      return res.status(500).json({ ok: false, message: e.message });
    }
  });

  app.post('/api/nkbk-ai-settings', async (req, res) => {
    try {
      const session = await withSession(req, res);
      if (!session) return;
      const db = await withDb(req, res, '/api/nkbk-ai-settings');
      if (!db) return;
      const config = await loadConfig(db);
      if (!nkbkAi.isUserAllowed(config, session.username)) {
        return res.status(403).json({ ok: false, message: nkbkAi.denyMessage(config) });
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const saved = await nkbkAi.saveUserSettings(db, session.username, session.fullname, body);
      const bundle = await nkbkAi.getUserSettingsBundle(db, config, session, session.username);
      return res.json({ ok: true, ...bundle, ...saved });
    } catch (e) {
      console.error('[nkbk-ai] settings put:', e.message);
      return res.status(500).json({ ok: false, message: e.message });
    }
  });

  app.get('/api/nkbk-ai-image/:userId/:imageId', async (req, res) => {
    try {
      const session = await withSession(req, res);
      if (!session) return;
      const imageId = decodeURIComponent(req.params.imageId || '').replace(/[^a-zA-Z0-9_-]/g, '');
      const stored = await nkbkAi.readPersistedImageFromStorage(session.username, imageId);
      if (stored && stored.buffer) {
        res.setHeader('Content-Type', stored.mime || 'image/png');
        res.setHeader('Cache-Control', 'private, max-age=86400');
        return res.send(stored.buffer);
      }
      let found = nkbkAi.readPersistedImage(session.username, imageId);
      if (!found) {
        return res.status(404).end();
      }
      res.setHeader('Content-Type', found.mime);
      res.setHeader('Cache-Control', 'private, max-age=86400');
      fs.createReadStream(found.path).pipe(res);
    } catch (e) {
      console.error('[nkbk-ai] image:', e.message);
      return res.status(500).end();
    }
  });

  app.post('/api/nkbk-ai-admin-delete-media', async (req, res) => {
    try {
      const adminUser = await verifyAdminAccess(req);
      if (!adminUser) return res.status(403).json({ ok: false, message: 'ไม่มีสิทธิ์แอดมิน' });
      const db = await withDb(req, res, '/api/nkbk-ai-admin-delete-media');
      if (!db) return;
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      await nkbkAi.adminDeleteMediaItem(db, body);
      return res.json({ ok: true });
    } catch (e) {
      console.error('[nkbk-ai] admin-delete-media:', e.message);
      return res.status(400).json({ ok: false, message: e.message || 'ลบไม่สำเร็จ' });
    }
  });

  app.post('/api/nkbk-ai-admin-clear-billing', async (req, res) => {
    try {
      const adminUser = await verifyAdminAccess(req);
      if (!adminUser) return res.status(403).json({ ok: false, message: 'ไม่มีสิทธิ์แอดมิน' });
      const db = await withDb(req, res, '/api/nkbk-ai-admin-clear-billing');
      if (!db) return;
      await nkbkAi.clearBillingLimitHit(db);
      return res.json({ ok: true });
    } catch (e) {
      console.error('[nkbk-ai] admin-clear-billing:', e.message);
      return res.status(500).json({ ok: false, message: e.message || 'รีเซ็ตไม่สำเร็จ' });
    }
  });

  app.post('/api/nkbk-ai-admin-delete-storage', async (req, res) => {
    try {
      const adminUser = await verifyAdminAccess(req);
      if (!adminUser) return res.status(403).json({ ok: false, message: 'ไม่มีสิทธิ์แอดมิน' });
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const username = String(body.username || '').trim();
      const imageId = String(body.imageId || '').replace(/[^a-zA-Z0-9_-]/g, '');
      const mime = String(body.mime || 'image/png').trim();
      if (!username || !imageId) return res.status(400).json({ ok: false, message: 'ข้อมูลไม่ครบ' });
      await nkbkAi.deleteStorageObject(username, imageId, mime);
      return res.json({ ok: true });
    } catch (e) {
      console.error('[nkbk-ai] admin-delete-storage:', e.message);
      return res.status(500).json({ ok: false, message: e.message || 'ลบไฟล์ไม่สำเร็จ' });
    }
  });

  app.get('/api/nkbk-ai-admin-image/:userId/:imageId', async (req, res) => {
    try {
      const adminUser = await verifyAdminAccess(req);
      if (!adminUser) return res.status(403).json({ ok: false, message: 'ไม่มีสิทธิ์แอดมิน' });
      const username = decodeURIComponent(req.params.userId || '').trim();
      const imageId = decodeURIComponent(req.params.imageId || '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!username || !imageId) return res.status(400).end();
      const stored = await nkbkAi.readPersistedImageFromStorage(username, imageId);
      if (stored && stored.buffer) {
        res.setHeader('Content-Type', stored.mime || 'image/png');
        res.setHeader('Cache-Control', 'private, max-age=86400');
        return res.send(stored.buffer);
      }
      const found = nkbkAi.readPersistedImage(username, imageId);
      if (!found) return res.status(404).end();
      res.setHeader('Content-Type', found.mime);
      res.setHeader('Cache-Control', 'private, max-age=86400');
      fs.createReadStream(found.path).pipe(res);
    } catch (e) {
      console.error('[nkbk-ai] admin-image:', e.message);
      return res.status(500).end();
    }
  });

  app.post('/api/nkbk-ai-threads', async (req, res) => {
    try {
      const session = await withSession(req, res);
      if (!session) return;
      const db = await withDb(req, res, '/api/nkbk-ai-threads');
      if (!db) return;
      const config = await loadConfig(db);
      if (!nkbkAi.isUserAllowed(config, session.username)) {
        return res.status(403).json({ ok: false, message: nkbkAi.denyMessage(config) });
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const action = String(body.action || '').trim();
      let saved;
      if (action === 'create') saved = await nkbkAi.createThread(db, session.username, session.fullname);
      else if (action === 'delete') saved = await nkbkAi.deleteThread(db, session.username, session.fullname, body.threadId);
      else if (action === 'switch') saved = await nkbkAi.switchThread(db, session.username, session.fullname, body.threadId);
      else if (action === 'pin') saved = await nkbkAi.pinThread(db, session.username, session.fullname, body.threadId, true);
      else if (action === 'unpin') saved = await nkbkAi.pinThread(db, session.username, session.fullname, body.threadId, false);
      else if (action === 'archive') saved = await nkbkAi.archiveThread(db, session.username, session.fullname, body.threadId);
      else if (action === 'unarchive') saved = await nkbkAi.unarchiveThread(db, session.username, session.fullname, body.threadId);
      else if (action === 'share') saved = await nkbkAi.markThreadShared(db, session.username, session.fullname, body.threadId);
      else if (action === 'revokeShare') saved = await nkbkAi.revokeThreadShare(db, session.username, session.fullname, body.threadId);
      else if (action === 'deleteAllVisible') saved = await nkbkAi.deleteAllVisibleThreads(db, session.username, session.fullname);
      else if (action === 'rename') saved = await nkbkAi.renameThread(db, session.username, session.fullname, body.threadId, body.title);
      else return res.status(400).json({ ok: false, message: 'action ไม่ถูกต้อง' });
      const userCallName = await nkbkAi.resolveUserCallName(db, config, session.username);
      const expandedHistory = nkbkAi.expandHistoryForClient(session.username, saved.chatHistory || []);
      const activeThread = (saved.threads || []).find((t) => t.id === saved.activeThreadId);
      const threadQuotaBytes = nkbkAi.getThreadQuotaBytes(config);
      const activeThreadBytes = activeThread ? nkbkAi.computeThreadStorageBytes(activeThread) : 0;
      return res.json({
        ok: true,
        ...saved,
        userCallName,
        chatHistory: expandedHistory,
        threadStorage: {
          usedBytes: activeThreadBytes,
          quotaBytes: threadQuotaBytes,
          overQuota: activeThreadBytes >= threadQuotaBytes
        },
        threads: nkbkAi.publicThreads(saved.threads, saved.activeThreadId, config && config.chatHistoryMax)
      });
    } catch (e) {
      console.error('[nkbk-ai] threads:', e.message);
      return res.status(500).json({ ok: false, message: e.message });
    }
  });

  app.get('/api/nkbk-ai-library', async (req, res) => {
    try {
      const session = await withSession(req, res);
      if (!session) return;
      const db = await withDb(req, res, '/api/nkbk-ai-library');
      if (!db) return;
      const config = await loadConfig(db);
      if (!nkbkAi.isUserAllowed(config, session.username)) {
        return res.status(403).json({ ok: false, message: nkbkAi.denyMessage(config) });
      }
      const memory = (await nkbkAi.getUserMemory(db, session.username)) || {};
      const norm = nkbkAi.normalizeThreads(memory);
      const items = nkbkAi.collectLibraryItems(norm.threads, session.username, memory.userLibrary);
      return res.json({ ok: true, items });
    } catch (e) {
      console.error('[nkbk-ai] library:', e.message);
      return res.status(500).json({ ok: false, message: e.message });
    }
  });

  app.post('/api/nkbk-ai-library', async (req, res) => {
    try {
      const session = await withSession(req, res);
      if (!session) return;
      const db = await withDb(req, res, '/api/nkbk-ai-library');
      if (!db) return;
      const config = await loadConfig(db);
      if (!nkbkAi.isUserAllowed(config, session.username)) {
        return res.status(403).json({ ok: false, message: nkbkAi.denyMessage(config) });
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const action = String(body.action || '').trim();
      if (action === 'upload') {
        const saved = await nkbkAi.uploadLibraryItems(db, session.username, session.fullname, body.items);
        const memory = (await nkbkAi.getUserMemory(db, session.username)) || {};
        const norm = nkbkAi.normalizeThreads(memory);
        const items = nkbkAi.collectLibraryItems(norm.threads, session.username, memory.userLibrary);
        return res.json({ ok: true, items, added: saved.added || [] });
      }
      if (action === 'delete') {
        await nkbkAi.deleteLibraryItems(db, session.username, session.fullname, body.itemIds || body.ids);
        const memory = (await nkbkAi.getUserMemory(db, session.username)) || {};
        const norm = nkbkAi.normalizeThreads(memory);
        const items = nkbkAi.collectLibraryItems(norm.threads, session.username, memory.userLibrary);
        return res.json({ ok: true, items });
      }
      return res.status(400).json({ ok: false, message: 'action ไม่ถูกต้อง' });
    } catch (e) {
      console.error('[nkbk-ai] library post:', e.message);
      return res.status(500).json({ ok: false, message: e.message });
    }
  });

  app.post('/api/nkbk-ai-chat', async (req, res) => {
    try {
      const session = await withSession(req, res);
      if (!session) return;
      const db = await withDb(req, res, '/api/nkbk-ai-chat');
      if (!db) return;
      const config = await loadConfig(db);
      if (!nkbkAi.isUserAllowed(config, session.username)) {
        return res.status(403).json({ ok: false, message: nkbkAi.denyMessage(config) });
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      if (body.clearHistory) {
        const memory = (await nkbkAi.getUserMemory(db, session.username)) || {};
        const norm = nkbkAi.normalizeThreads(memory);
        await nkbkAi.saveUserMemory(db, session.username, session.fullname, {
          chatHistory: [],
          activeThreadId: norm.activeThreadId,
          standingInstructions: body.standingInstructions
        });
        if (!body.message && !(Array.isArray(body.images) && body.images.length)) {
          return res.json({ ok: true, cleared: true, activeThreadId: norm.activeThreadId });
        }
      }
      const hasText = !!(body.message && String(body.message).trim());
      const hasImages = Array.isArray(body.images) && body.images.length > 0;
      const hasFiles = Array.isArray(body.files) && body.files.length > 0;
      if (!hasText && !hasImages && !hasFiles) {
        return res.status(400).json({ ok: false, message: 'กรุณาพิมพ์ข้อความหรือแนบรูป/ไฟล์' });
      }
      const result = await nkbkAi.runChat(db, config, session, body);
      return res.json({
        ok: true,
        reply: result.reply,
        images: result.images || [],
        generated: !!result.generated,
        imagePrompt: result.imagePrompt || '',
        memoryUpdated: result.memoryUpdated,
        standingInstructions: result.standingInstructions,
        activeThreadId: result.activeThreadId
      });
    } catch (e) {
      console.error('[nkbk-ai] chat:', e.message);
      const msg = nkbkAi.translateOpenAiError(e.message || 'เกิดข้อผิดพลาด');
      return res.status(500).json({ ok: false, message: msg });
    }
  });

  app.post('/api/nkbk-ai-prompt', async (req, res) => {
    try {
      const session = await withSession(req, res);
      if (!session) return;
      const db = await withDb(req, res, '/api/nkbk-ai-prompt');
      if (!db) return;
      const config = await loadConfig(db);
      if (!nkbkAi.isUserAllowed(config, session.username)) {
        return res.status(403).json({ ok: false, message: nkbkAi.denyMessage(config) });
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const action = String(body.action || 'track').trim();
      if (action === 'save') {
        const saved = await nkbkAi.saveQuickPrompt(db, session.username, session.fullname, {
          text: body.text,
          title: body.title
        });
        return res.json({ ok: true, savedPrompts: saved.savedPrompts, prompt: saved.prompt });
      }
      if (action === 'dismiss') {
        await nkbkAi.dismissPromptSuggestion(db, session.username, session.fullname, body.text);
        return res.json({ ok: true });
      }
      if (action === 'complete') {
        const images = Array.isArray(body.images) ? body.images : [];
        const done = await nkbkAi.recordPromptCompletion(db, session.username, session.fullname, {
          text: body.text,
          generated: !!body.generated,
          images
        });
        return res.json({ ok: true, savedPrompts: done.savedPrompts, prompt: done.prompt || null });
      }
      const tracked = await nkbkAi.trackPromptActivity(
        db,
        session.username,
        session.fullname,
        body.text
      );
      return res.json({
        ok: true,
        ...tracked,
        threshold: nkbkAi.PROMPT_SUGGEST_THRESHOLD
      });
    } catch (e) {
      console.error('[nkbk-ai] prompt:', e.message);
      return res.status(500).json({ ok: false, message: e.message });
    }
  });
}

module.exports = { registerNkbkAiRoutes };
