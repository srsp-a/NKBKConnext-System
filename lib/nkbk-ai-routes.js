/**
 * Express routes for NKBK Desktop AI (ChatGPT โมเน่)
 */
const fs = require('fs');
const nkbkAi = require('./nkbk-ai');

function getToken(req) {
  return (req.headers['x-monitor-token'] || req.query.token || '').trim();
}

function registerNkbkAiRoutes(app, deps) {
  const { getDb, resolveSession, proxyToRemote } = deps;

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
      return res.json({
        ok: true,
        standingInstructions: memory.standingInstructions || '',
        userCallName,
        activeThreadId: norm.activeThreadId,
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
      const saved = await nkbkAi.saveUserMemory(db, session.username, session.fullname, {
        standingInstructions: body.standingInstructions,
        userCallName: userCallName != null ? userCallName : body.userCallName
      });
      const resolvedName = await nkbkAi.resolveUserCallName(db, config, session.username);
      return res.json({ ok: true, ...saved, userCallName: resolvedName });
    } catch (e) {
      console.error('[nkbk-ai] memory put:', e.message);
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
      else return res.status(400).json({ ok: false, message: 'action ไม่ถูกต้อง' });
      const userCallName = await nkbkAi.resolveUserCallName(db, config, session.username);
      const expandedHistory = nkbkAi.expandHistoryForClient(session.username, saved.chatHistory || []);
      return res.json({
        ok: true,
        ...saved,
        userCallName,
        chatHistory: expandedHistory,
        threads: nkbkAi.publicThreads(saved.threads, saved.activeThreadId, config && config.chatHistoryMax)
      });
    } catch (e) {
      console.error('[nkbk-ai] threads:', e.message);
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
      if (!hasText && !hasImages) {
        return res.status(400).json({ ok: false, message: 'กรุณาพิมพ์ข้อความหรือแนบรูป' });
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
      return res.status(500).json({ ok: false, message: e.message || 'เกิดข้อผิดพลาด' });
    }
  });
}

module.exports = { registerNkbkAiRoutes };
