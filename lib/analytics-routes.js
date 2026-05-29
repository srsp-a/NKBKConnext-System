'use strict';

const ga4 = require('./ga4-analytics');

function registerAnalyticsRoutes(app, deps) {
  const { getDb, verifyAdminAccess } = deps;

  app.get('/api/public-analytics-config', async (req, res) => {
    try {
      const db = typeof getDb === 'function' ? getDb() : null;
      const cfg = await ga4.getAnalyticsConfig(db);
      res.json({
        ok: true,
        enabled: cfg.enabled !== false,
        measurementId: cfg.measurementId || null
      });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  app.post('/api/public-cms-analytics', async (req, res) => {
    try {
      const db = typeof getDb === 'function' ? getDb() : null;
      if (!db) {
        res.status(503).json({ ok: false });
        return;
      }
      const path = String(req.body?.path || '/').slice(0, 500);
      const title = String(req.body?.title || '').slice(0, 200);
      const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').slice(0, 120);
      await ga4.recordPageView(db, { path, title, host });
      res.json({ ok: true });
    } catch (e) {
      console.warn('[analytics-routes] public-cms-analytics:', e.message);
      res.status(500).json({ ok: false });
    }
  });

  app.get('/api/admin-analytics/summary', async (req, res) => {
    try {
      const adminUser = await verifyAdminAccess(req);
      if (!adminUser) {
        res.status(403).json({ ok: false, message: 'ไม่มีสิทธิ์' });
        return;
      }
      const db = typeof getDb === 'function' ? getDb() : null;
      const summary = await ga4.getAdminAnalyticsSummary(db);
      res.json(summary);
    } catch (e) {
      console.error('[analytics-routes] admin-analytics/summary:', e.message);
      res.status(500).json({ ok: false, message: e.message || 'โหลดไม่สำเร็จ' });
    }
  });
}

module.exports = { registerAnalyticsRoutes };
