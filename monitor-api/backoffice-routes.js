/**
 * Express routes — Back Office auto-login (super admin only)
 */
const {
  getAdminBearer,
  verifySuperAdminOnly,
  saveBackofficeCredentials,
  getBackofficeCredentialsMeta
} = require('./backoffice-creds');
const {
  createBackofficeSession,
  sessions,
  MANAGE_PATH,
  buildProxyPrefix,
  handleProxyRequest
} = require('./backoffice-bridge');

function registerBackofficeRoutes(app, getMonitorAdminFirestore) {
  app.get('/api/backoffice/credentials', async (req, res) => {
    const db = getMonitorAdminFirestore();
    const admin = await verifySuperAdminOnly(db, getAdminBearer(req));
    if (!admin) return res.status(403).json({ ok: false, error: 'forbidden', message: 'เฉพาะผู้ดูแลระบบ' });
    try {
      const meta = await getBackofficeCredentialsMeta(db);
      return res.json({ ok: true, ...meta });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  app.post('/api/backoffice/credentials', async (req, res) => {
    const db = getMonitorAdminFirestore();
    const admin = await verifySuperAdminOnly(db, getAdminBearer(req));
    if (!admin) return res.status(403).json({ ok: false, error: 'forbidden', message: 'เฉพาะผู้ดูแลระบบ' });
    try {
      const body = req.body || {};
      const saved = await saveBackofficeCredentials(
        db,
        {
          username: body.username,
          password: body.password,
          database: body.database
        },
        admin.uid
      );
      return res.json({ ok: true, ...saved });
    } catch (e) {
      return res.status(400).json({ ok: false, error: e.message || String(e) });
    }
  });

  app.post('/api/backoffice/session', async (req, res) => {
    const db = getMonitorAdminFirestore();
    const admin = await verifySuperAdminOnly(db, getAdminBearer(req));
    if (!admin) return res.status(403).json({ ok: false, error: 'forbidden', message: 'เฉพาะผู้ดูแลระบบ' });
    try {
      const { sid, expiresAt } = await createBackofficeSession(db, admin.uid);
      const proxyPrefix = buildProxyPrefix(req, sid);
      const embedPath = MANAGE_PATH.startsWith('/') ? MANAGE_PATH : '/' + MANAGE_PATH;
      const embedUrl = proxyPrefix + embedPath;
      return res.json({ ok: true, sid, expiresAt, embedUrl });
    } catch (e) {
      console.error('[backoffice] session create failed:', e.message);
      return res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  app.delete('/api/backoffice/session/:sid', async (req, res) => {
    const db = getMonitorAdminFirestore();
    const admin = await verifySuperAdminOnly(db, getAdminBearer(req));
    if (!admin) return res.status(403).json({ ok: false, error: 'forbidden' });
    sessions.delete(String(req.params.sid || ''));
    return res.json({ ok: true });
  });

  app.use('/api/backoffice/proxy/:sid', (req, res) => {
    const sid = req.params.sid;
    let subPath = req.url || '/';
    const q = subPath.indexOf('?');
    if (q >= 0) subPath = subPath.slice(0, q);
    if (!subPath || subPath === '') subPath = '/';
    const db = getMonitorAdminFirestore();
    return handleProxyRequest(req, res, sid, subPath, db);
  });
}

module.exports = { registerBackofficeRoutes };
