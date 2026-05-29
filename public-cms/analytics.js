(function () {
  'use strict';

  var MEASUREMENT_ID = 'G-DFHZN01J6L';
  var trackedPath = '';

  function apiBase() {
    var host = (location.hostname || '').toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:3333';
    return 'https://monitor-api.nkbkcoop.com';
  }

  function recordPageView(isSpaNav) {
    var path = location.pathname + location.search;
    if (path === trackedPath && isSpaNav) return;
    trackedPath = path;
    var title = document.title || path;

    if (isSpaNav && typeof window.gtag === 'function') {
      window.gtag('event', 'page_view', {
        page_path: path,
        page_title: title,
        page_location: location.href
      });
    }

    try {
      fetch(apiBase() + '/api/public-cms-analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: path, title: title }),
        keepalive: true
      }).catch(function () {});
    } catch (_) {}
  }

  function boot() {
    recordPageView(false);

    window.addEventListener('popstate', function () {
      recordPageView(true);
    });
    var pushState = history.pushState;
    history.pushState = function () {
      pushState.apply(history, arguments);
      recordPageView(true);
    };
    var replaceState = history.replaceState;
    history.replaceState = function () {
      replaceState.apply(history, arguments);
      recordPageView(true);
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
