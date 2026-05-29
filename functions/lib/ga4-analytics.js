'use strict';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'admin-panel-nkbkcoop-cbf10';
const DEFAULT_MEASUREMENT_ID = 'G-DFHZN01J6L';

let analyticsDataClient = null;

function getAnalyticsDataClient() {
  if (analyticsDataClient) return analyticsDataClient;
  try {
    const { BetaAnalyticsDataClient } = require('@google-analytics/data');
    analyticsDataClient = new BetaAnalyticsDataClient();
    return analyticsDataClient;
  } catch (e) {
    console.warn('[ga4-analytics] BetaAnalyticsDataClient unavailable:', e.message);
    return null;
  }
}

async function getAnalyticsConfig(db) {
  const defaults = {
    enabled: true,
    measurementId: process.env.GA4_MEASUREMENT_ID || DEFAULT_MEASUREMENT_ID,
    propertyId: String(process.env.GA4_PROPERTY_ID || '').trim(),
    hostFilter: 'nkbkcoop.com'
  };
  if (!db) return defaults;
  try {
    const snap = await db.collection('config').doc('analytics').get();
    if (!snap.exists) return defaults;
    return { ...defaults, ...snap.data() };
  } catch (e) {
    console.warn('[ga4-analytics] getAnalyticsConfig:', e.message);
    return defaults;
  }
}

async function resolvePropertyId(db, cfg) {
  const fromCfg = String(cfg?.propertyId || '').replace(/\D/g, '');
  if (fromCfg) return fromCfg;

  try {
    const admin = require('firebase-admin');
    const cred = admin.app().options.credential;
    if (!cred || typeof cred.getAccessToken !== 'function') return null;
    const token = await cred.getAccessToken();
    const res = await fetch(
      `https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}/analyticsDetails`,
      { headers: { Authorization: `Bearer ${token.access_token}` } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const raw = data?.analyticsProperty?.id || '';
    const id = String(raw).replace(/^properties\//, '').replace(/\D/g, '');
    return id || null;
  } catch (e) {
    console.warn('[ga4-analytics] resolvePropertyId:', e.message);
    return null;
  }
}

function todayBangkokDateStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

async function recordPageView(db, payload) {
  if (!db) return;
  const path = String(payload?.path || '/').slice(0, 500);
  const title = String(payload?.title || '').slice(0, 200);
  const host = String(payload?.host || '').slice(0, 120);
  const day = todayBangkokDateStr();
  const ref = db.collection('analytics_daily').doc(day);
  const pathKey = path.replace(/\./g, '_');
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? snap.data() : { pageViews: 0, paths: {} };
    const paths = { ...(cur.paths || {}) };
    paths[pathKey] = (paths[pathKey] || 0) + 1;
    tx.set(
      ref,
      {
        pageViews: (cur.pageViews || 0) + 1,
        paths,
        lastPath: path,
        lastTitle: title,
        lastHost: host,
        updatedAt: new Date().toISOString()
      },
      { merge: true }
    );
  });
}

async function getFirestoreSummary(db, days) {
  if (!db) return { pageViewsToday: 0, pageViews7d: 0, topPages: [] };
  const n = Math.min(Math.max(Number(days) || 7, 1), 30);
  const today = todayBangkokDateStr();
  const pathTotals = {};
  let pageViewsToday = 0;
  let pageViews7d = 0;

  for (let i = 0; i < n; i++) {
    const d = new Date(`${today}T12:00:00+07:00`);
    d.setDate(d.getDate() - i);
    const key = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    const snap = await db.collection('analytics_daily').doc(key).get();
    if (!snap.exists) continue;
    const data = snap.data() || {};
    const pv = Number(data.pageViews) || 0;
    pageViews7d += pv;
    if (i === 0) pageViewsToday = pv;
    const paths = data.paths || {};
    Object.keys(paths).forEach((p) => {
      const display = p.replace(/_/g, '.');
      pathTotals[display] = (pathTotals[display] || 0) + (Number(paths[p]) || 0);
    });
  }

  const topPages = Object.entries(pathTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([path, views]) => ({ path, views }));

  return { pageViewsToday, pageViews7d, topPages };
}

async function runGa4Report(propertyId, requestBody) {
  const client = getAnalyticsDataClient();
  if (!client || !propertyId) return null;
  const [response] = await client.runReport({
    property: `properties/${propertyId}`,
    ...requestBody
  });
  return response;
}

async function runGa4Realtime(propertyId) {
  const client = getAnalyticsDataClient();
  if (!client || !propertyId) return null;
  try {
    const [response] = await client.runRealtimeReport({
      property: `properties/${propertyId}`,
      metrics: [{ name: 'activeUsers' }]
    });
    const row = response?.rows?.[0];
    const val = row?.metricValues?.[0]?.value;
    return val != null ? Number(val) : 0;
  } catch (e) {
    console.warn('[ga4-analytics] runGa4Realtime:', e.message);
    return null;
  }
}

async function fetchGa4Summary(db, cfg) {
  const propertyId = await resolvePropertyId(db, cfg);
  if (!propertyId) {
    return { configured: false, propertyId: null, reason: 'no_property_id' };
  }

  try {
    const [activeUsers1d, activeUsers7d, activeUsers30d, realtimeUsers, pagesReport] =
      await Promise.all([
        runGa4Report(propertyId, {
          dateRanges: [{ startDate: '1daysAgo', endDate: 'today' }],
          metrics: [{ name: 'activeUsers' }]
        }),
        runGa4Report(propertyId, {
          dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
          metrics: [{ name: 'activeUsers' }]
        }),
        runGa4Report(propertyId, {
          dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
          metrics: [{ name: 'activeUsers' }]
        }),
        runGa4Realtime(propertyId),
        runGa4Report(propertyId, {
          dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
          dimensions: [{ name: 'pagePath' }],
          metrics: [{ name: 'screenPageViews' }],
          orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
          limit: 8
        })
      ]);

    const metricVal = (report) => {
      const v = report?.rows?.[0]?.metricValues?.[0]?.value;
      return v != null ? Number(v) : 0;
    };

    const topPages = (pagesReport?.rows || []).map((row) => ({
      path: row.dimensionValues?.[0]?.value || '/',
      views: Number(row.metricValues?.[0]?.value || 0)
    }));

    return {
      configured: true,
      propertyId,
      activeUsers1d: metricVal(activeUsers1d),
      activeUsers7d: metricVal(activeUsers7d),
      activeUsers30d: metricVal(activeUsers30d),
      realtimeUsers: realtimeUsers != null ? realtimeUsers : null,
      topPages
    };
  } catch (e) {
    console.warn('[ga4-analytics] fetchGa4Summary:', e.message);
    return {
      configured: false,
      propertyId,
      reason: e.message || 'ga4_api_error'
    };
  }
}

async function getAdminAnalyticsSummary(db) {
  const cfg = await getAnalyticsConfig(db);
  const [ga4, firestore] = await Promise.all([
    fetchGa4Summary(db, cfg),
    getFirestoreSummary(db, 7)
  ]);

  return {
    ok: true,
    measurementId: cfg.measurementId,
    hostFilter: cfg.hostFilter,
    ga4,
    firestore,
    ga4ConsoleUrl: `https://console.firebase.google.com/project/${PROJECT_ID}/analytics`,
    googleAnalyticsUrl: ga4.propertyId
      ? `https://analytics.google.com/analytics/web/#/p${ga4.propertyId}/reports/intelligenthome`
      : null
  };
}

module.exports = {
  getAnalyticsConfig,
  recordPageView,
  getFirestoreSummary,
  getAdminAnalyticsSummary
};
