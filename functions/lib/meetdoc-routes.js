/**
 * Express routes สำหรับ Meetdoc — ใช้ใน monitor-api
 */
'use strict';

const express = require('express');
const meetdocPdfUpload = express.raw({ type: 'application/pdf', limit: '105mb' });

function loadMeetdocApi() {
  try {
    return require('./meetdoc-api');
  } catch (e) {
    console.warn('[meetdoc-routes] load meetdoc-api:', e.message);
    return null;
  }
}

function meetdocTokenFromReq(req) {
  const h = req.headers['x-meetdoc-token'] || req.headers['X-Meetdoc-Token'] || '';
  if (h) return String(h).trim();
  if (req.body && req.body.token) return String(req.body.token).trim();
  if (req.query && req.query.token) return String(req.query.token).trim();
  return '';
}

/**
 * @param {import('express').Express} app
 * @param {{ getMonitorSession: (token: string) => object|null }} opts
 */
function registerMeetdocRoutes(app, opts) {
  const meetdoc = loadMeetdocApi();
  if (!meetdoc) {
    console.warn('[meetdoc-routes] skipped — meetdoc-api not available');
    return;
  }

  if (opts && typeof opts.warmupAdmin === 'function') {
    try {
      opts.warmupAdmin();
    } catch (_) {}
  }

  const getMonitorSession = opts && opts.getMonitorSession;

  app.post('/api/meetdoc-login', async (req, res) => {
    try {
      const result = await meetdoc.loginWithPin(req.body && req.body.username, req.body && req.body.pin);
      res.status(200).json(result);
    } catch (e) {
      console.error('[meetdoc-login]', e.message);
      res.status(500).json({ ok: false, message: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
    }
  });

  app.post('/api/meetdoc-exchange', async (req, res) => {
    try {
      const monitorToken = String((req.body && req.body.monitorToken) || '').trim();
      if (!getMonitorSession) {
        return res.status(503).json({ ok: false, message: 'exchange unavailable' });
      }
      const mon = await getMonitorSession(monitorToken);
      const result = await meetdoc.exchangeFromMonitorSession(mon);
      res.status(200).json(result);
    } catch (e) {
      console.error('[meetdoc-exchange]', e.message);
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  app.post('/api/meetdoc-line-login', async (req, res) => {
    try {
      const result = await meetdoc.loginWithLine(req.body && req.body.lineUserId);
      res.status(200).json(result);
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  app.post('/api/meetdoc-line-link', async (req, res) => {
    try {
      const result = await meetdoc.linkLineAccount(req.body && req.body.lineUserId, req.body && req.body.username);
      res.status(200).json(result);
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  app.get('/api/meetdoc/meetings', async (req, res) => {
    try {
      const token = meetdocTokenFromReq(req);
      const result = await meetdoc.listMeetings(token, { queue: req.query.queue === 'approval' });
      res.status(result.ok ? 200 : 401).json(result);
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  app.get('/api/meetdoc/meetings/:id', async (req, res) => {
    try {
      const token = meetdocTokenFromReq(req);
      const result = await meetdoc.getMeeting(token, req.params.id);
      res.status(result.ok ? 200 : 404).json(result);
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  app.get('/api/meetdoc/meetings/:id/file', async (req, res) => {
    try {
      const token = meetdocTokenFromReq(req);
      const kind = req.query.kind || 'agenda';
      const result = await meetdoc.getSignedFileUrl(token, req.params.id, kind);
      res.status(result.ok ? 200 : 404).json(result);
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  app.post('/api/meetdoc/meetings/:id/approve', async (req, res) => {
    try {
      const token = meetdocTokenFromReq(req);
      const result = await meetdoc.approveMeeting(token, req.params.id, req.body && req.body.step);
      res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  app.post('/api/meetdoc/meetings/:id/reject', async (req, res) => {
    try {
      const token = meetdocTokenFromReq(req);
      const result = await meetdoc.rejectMeeting(token, req.params.id);
      res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  app.post('/api/meetdoc/firebase-token', async (req, res) => {
    try {
      const token = meetdocTokenFromReq(req);
      const result = await meetdoc.createFirebaseCustomToken(token);
      res.status(result.ok ? 200 : 403).json(result);
    } catch (e) {
      console.error('[meetdoc/firebase-token]', e.message);
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  app.get('/api/meetdoc/manage/bootstrap', async (req, res) => {
    try {
      const token = meetdocTokenFromReq(req);
      const result = await meetdoc.getManageBootstrap(token);
      res.status(result.ok ? 200 : 403).json(result);
    } catch (e) {
      console.error('[meetdoc/manage/bootstrap]', e.message);
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  let manage;
  try {
    manage = require('./meetdoc-manage');
  } catch (e) {
    console.warn('[meetdoc-routes] meetdoc-manage:', e.message);
  }

  if (manage) {
    app.get('/api/meetdoc/manage/settings', async (req, res) => {
      try {
        const result = await manage.getSettings(meetdocTokenFromReq(req));
        res.status(result.ok ? 200 : 403).json(result);
      } catch (e) {
        res.status(500).json({ ok: false, message: e.message });
      }
    });
    app.put('/api/meetdoc/manage/settings', async (req, res) => {
      try {
        const result = await manage.saveSettings(meetdocTokenFromReq(req), req.body);
        res.status(result.ok ? 200 : 403).json(result);
      } catch (e) {
        res.status(500).json({ ok: false, message: e.message });
      }
    });
    app.get('/api/meetdoc/manage/meetings', async (req, res) => {
      try {
        const result = await manage.listMeetingsManage(meetdocTokenFromReq(req));
        res.status(result.ok ? 200 : 403).json(result);
      } catch (e) {
        res.status(500).json({ ok: false, message: e.message });
      }
    });
    app.post('/api/meetdoc/manage/meetings', async (req, res) => {
      try {
        const result = await manage.createMeeting(meetdocTokenFromReq(req), req.body);
        res.status(result.ok ? 200 : 400).json(result);
      } catch (e) {
        res.status(500).json({ ok: false, message: e.message });
      }
    });
    app.put('/api/meetdoc/manage/meetings/:id', async (req, res) => {
      try {
        const body = req.body || {};
        const result = await manage.updateMeeting(
          meetdocTokenFromReq(req),
          req.params.id,
          body.data || body,
          body.merge !== false
        );
        res.status(result.ok ? 200 : 400).json(result);
      } catch (e) {
        res.status(500).json({ ok: false, message: e.message });
      }
    });
    app.delete('/api/meetdoc/manage/meetings/:id', async (req, res) => {
      try {
        const result = await manage.deleteMeeting(meetdocTokenFromReq(req), req.params.id);
        res.status(result.ok ? 200 : 400).json(result);
      } catch (e) {
        res.status(500).json({ ok: false, message: e.message });
      }
    });
    app.get('/api/meetdoc/manage/email-template/:id', async (req, res) => {
      try {
        const result = await manage.getEmailTemplate(meetdocTokenFromReq(req), req.params.id);
        res.status(result.ok ? 200 : 403).json(result);
      } catch (e) {
        res.status(500).json({ ok: false, message: e.message });
      }
    });
    app.put('/api/meetdoc/manage/email-template/:id', async (req, res) => {
      try {
        const result = await manage.saveEmailTemplate(meetdocTokenFromReq(req), req.params.id, req.body);
        res.status(result.ok ? 200 : 400).json(result);
      } catch (e) {
        res.status(500).json({ ok: false, message: e.message });
      }
    });
    app.post('/api/meetdoc/manage/meetings/:id/upload-url', async (req, res) => {
      try {
        const result = await manage.getUploadUrl(
          meetdocTokenFromReq(req),
          req.params.id,
          req.body && req.body.kind,
          req.body && req.body.fileName
        );
        res.status(result.ok ? 200 : 400).json(result);
      } catch (e) {
        res.status(500).json({ ok: false, message: e.message });
      }
    });
    async function handleMeetdocPdfUpload(req, res) {
      try {
        const kind = (req.query && req.query.kind) || (req.body && req.body.kind) || 'agenda';
        const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
        const qToken = req.query && req.query.token ? String(req.query.token).trim() : '';
        const dlToken = req.query && req.query.dlToken ? String(req.query.dlToken).trim() : '';
        const token = meetdocTokenFromReq(req) || qToken;

        if (req.method === 'PUT' || (dlToken && qToken)) {
          const result = await manage.uploadMeetingPdfPut(token, req.params.id, kind, buf, dlToken);
          if (!result.ok) {
            res.status(400).json(result);
            return;
          }
          res.status(200).send('');
          return;
        }

        const rawName = req.headers['x-meetdoc-file-name'] || req.headers['X-Meetdoc-File-Name'] || '';
        let fileName = '';
        try {
          fileName = decodeURIComponent(String(rawName || ''));
        } catch (_) {
          fileName = String(rawName || '');
        }
        const result = await manage.uploadMeetingPdf(token, req.params.id, kind, buf, fileName);
        res.status(result.ok ? 200 : 400).json(result);
      } catch (e) {
        console.error('[meetdoc/upload-pdf]', e.message);
        res.status(500).json({ ok: false, message: e.message || 'upload_failed' });
      }
    }
    app.post('/api/meetdoc/manage/meetings/:id/upload-pdf', meetdocPdfUpload, handleMeetdocPdfUpload);
    app.put('/api/meetdoc/manage/meetings/:id/upload-pdf', meetdocPdfUpload, handleMeetdocPdfUpload);
    app.put('/api/meetdoc/manage/meetings/:id/file-meta', async (req, res) => {
      try {
        const result = await manage.saveFileMeta(
          meetdocTokenFromReq(req),
          req.params.id,
          req.body && req.body.kind,
          req.body || {}
        );
        res.status(result.ok ? 200 : 400).json(result);
      } catch (e) {
        res.status(500).json({ ok: false, message: e.message });
      }
    });
    app.post('/api/meetdoc/manage/test-log', async (req, res) => {
      try {
        const result = await manage.addTestLog(meetdocTokenFromReq(req), req.body);
        res.status(result.ok ? 200 : 400).json(result);
      } catch (e) {
        res.status(500).json({ ok: false, message: e.message });
      }
    });
    app.post('/api/meetdoc/manage/meetings/:id/analyze-agenda', async (req, res) => {
      try {
        const result = await manage.analyzeMeetingAgenda(
          meetdocTokenFromReq(req),
          req.params.id,
          req.body || {}
        );
        res.status(result.ok ? 200 : 400).json(result);
      } catch (e) {
        res.status(500).json({ ok: false, message: e.message });
      }
    });
  }

  app.post('/api/meeting-docs/meetings/:id/analyze-agenda', async (req, res) => {
    try {
      if (!manage) return res.status(503).json({ ok: false, message: 'unavailable' });
      const authHeader = String(req.headers.authorization || '');
      const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!bearer) return res.status(401).json({ ok: false, message: 'auth_required' });
      const admin = require('firebase-admin');
      let uid;
      try {
        const decoded = await admin.auth().verifyIdToken(bearer);
        uid = decoded.uid;
      } catch (e) {
        return res.status(401).json({ ok: false, message: 'invalid_token' });
      }
      const result = await manage.analyzeMeetingAgendaForUid(uid, req.params.id, req.body || {});
      res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      console.error('[meeting-docs/analyze-agenda]', e.message);
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  console.log('[meetdoc-routes] registered /api/meetdoc-*');
}

module.exports = { registerMeetdocRoutes };
