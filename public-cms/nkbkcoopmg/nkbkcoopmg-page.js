(function () {
  'use strict';

  var DESKTOP_NAME = 'NKBKConnext System';
  var FUTURE_APP_NAME = 'NKBKCOOPMG';
  var FILE_PRODUCT = 'NKBKConnext System';
  var BASE = '/desktop-app-updates';
  var PREV_VERSION_LIMIT = 3;

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function fileUrl(name) {
    return BASE + '/' + encodeURIComponent(name);
  }

  function setupFile(ver) {
    return fileUrl(FILE_PRODUCT + ' Setup ' + ver + '.exe');
  }

  function portableFile(ver) {
    return fileUrl(FILE_PRODUCT + ' ' + ver + ' Portable.exe');
  }

  function renderLatest(latest, tagline) {
    var el = document.getElementById('mgLatest');
    if (!el) return;
    el.innerHTML =
      '<div class="mg-latest-head">' +
        '<h2 class="mg-latest-title">' + esc(DESKTOP_NAME) + '</h2>' +
        '<span class="mg-version-pill">v <strong>' + esc(latest) + '</strong></span>' +
      '</div>' +
      (tagline ? '<p class="mg-subtitle mg-latest-desc">' + esc(tagline) + '</p>' : '') +
      '<div class="mg-btn-row">' +
        '<a class="mg-btn mg-btn-primary" href="' + esc(setupFile(latest)) + '" download>' +
          '<i class="fa-regular fa-circle-down" aria-hidden="true"></i> ติดตั้ง (Setup)</a>' +
        '<a class="mg-btn mg-btn-secondary" href="' + esc(portableFile(latest)) + '" download>' +
          '<i class="fa-regular fa-hard-drive" aria-hidden="true"></i> Portable</a>' +
      '</div>';
  }

  function platformIconClass(icon) {
    if (icon === 'apple') return 'fa-brands fa-apple';
    if (icon === 'android') return 'fa-brands fa-android';
    return 'fa-regular fa-mobile';
  }

  function renderFuture(platforms) {
    var el = document.getElementById('mgFuture');
    if (!el || !platforms || !platforms.length) return;
    el.innerHTML = platforms.map(function (p) {
      var label = p.label || '';
      if (!label && p.icon === 'apple') label = FUTURE_APP_NAME + ' · iOS';
      if (!label && p.icon === 'android') label = FUTURE_APP_NAME + ' · Android';
      return (
        '<article class="mg-platform-card is-soon">' +
          '<div class="mg-platform-icon" aria-hidden="true"><i class="' + platformIconClass(p.icon) + '"></i></div>' +
          '<h3 class="mg-platform-name">' + esc(label) + '</h3>' +
          '<p class="mg-platform-status">' + esc(p.statusText || 'เร็วๆ นี้') + '</p>' +
        '</article>'
      );
    }).join('');
  }

  function renderHistory(releases, latest) {
    var el = document.getElementById('mgHistoryBody');
    if (!el || !releases || !releases.length) return;
    var previous = releases
      .filter(function (r) { return r && r.version && r.version !== latest; })
      .slice(0, PREV_VERSION_LIMIT);
    if (!previous.length) {
      el.innerHTML = '<tr><td colspan="2" class="mg-loading">ไม่มีเวอร์ชันก่อนหน้า</td></tr>';
      return;
    }
    el.innerHTML = previous.map(function (r) {
      var ver = r.version;
      return (
        '<tr>' +
          '<td data-label="เวอร์ชัน">' + esc(ver) + '</td>' +
          '<td data-label="ดาวน์โหลด">' +
            '<a class="mg-dl-link" href="' + esc(setupFile(ver)) + '" download>Setup</a>' +
            '<span class="mg-dl-sep">·</span>' +
            '<a class="mg-dl-link" href="' + esc(portableFile(ver)) + '" download>Portable</a>' +
          '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function showError(msg) {
    var root = document.getElementById('mgRoot');
    if (root) root.innerHTML = '<p class="mg-error">' + esc(msg) + '</p>';
  }

  fetch(BASE + '/releases-catalog.json', { cache: 'no-store' })
    .then(function (r) {
      if (!r.ok) throw new Error('โหลดรายการเวอร์ชันไม่สำเร็จ');
      return r.json();
    })
    .then(function (cat) {
      var latest = cat.latestVersion || '1.0.31';
      if (cat.fileProductName) FILE_PRODUCT = cat.fileProductName;
      if (cat.productName) DESKTOP_NAME = cat.productName;
      if (cat.futureAppName) FUTURE_APP_NAME = cat.futureAppName;
      renderLatest(latest, cat.productTagline || '');
      renderFuture(cat.futurePlatforms);
      renderHistory(cat.releases || [], latest);
      var pill = document.getElementById('mgHeroVersion');
      if (pill) pill.textContent = DESKTOP_NAME + ' v' + latest;
    })
    .catch(function (e) {
      showError(e.message || 'เกิดข้อผิดพลาด');
    });
})();
