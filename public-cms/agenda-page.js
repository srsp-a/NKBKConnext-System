/** หน้าวาระและรายงานการประชุม — layout การ์ด */
function parseAgendaMeetings(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const areas = doc.querySelectorAll('.app-download-area');
  const meetings = [...areas]
    .map((area) => {
      const img = area.querySelector('.main-image img');
      const title = area.querySelector('.app-download-content h2');
      const desc = area.querySelector('.app-download-content p');
      const agendaBtn = area.querySelector('a.app-store-btn');
      const reportBtn = area.querySelector('a.play-store-btn');
      return {
        title: (title?.textContent || '').trim(),
        description: (desc?.textContent || '').trim(),
        image: img?.getAttribute('src') || '',
        agendaUrl: (agendaBtn?.getAttribute('href') || '').trim(),
        reportUrl: (reportBtn?.getAttribute('href') || '').trim()
      };
    })
    .filter((m) => m.title);

  return applyAgendaPatches(meetings);
}

function normalizeAgendaText(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function applyAgendaPatches(meetings) {
  const patches = window.CMS_SITE?.agendaPatches || [];
  if (!patches.length) return meetings;
  return meetings.map((m) => {
    const title = normalizeAgendaText(m.title);
    const patch = patches.find((p) => {
      if (!p.match || !title) return false;
      return title.includes(normalizeAgendaText(p.match));
    });
    if (!patch) return { ...m, title };
    return {
      ...m,
      title,
      ...(patch.agendaUrl !== undefined ? { agendaUrl: patch.agendaUrl } : {}),
      ...(patch.reportUrl !== undefined ? { reportUrl: patch.reportUrl } : {})
    };
  });
}

function isUsableDocUrl(url) {
  if (!url || url === '#') return false;
  return true;
}

function renderAgendaBtnInner(hintKey, labelKey, hintFallback, labelFallback) {
  const hint = window.CmsI18n ? CmsI18n.t(hintKey) : hintFallback;
  const label = window.CmsI18n ? CmsI18n.t(labelKey) : labelFallback;
  const icon = window.KbIcon ? KbIcon.svg('download', 22) : '↓';
  return `
  <span class="kb-agenda-btn-icon" aria-hidden="true">
    <span class="kb-agenda-btn-icon-default">${icon}</span>
    <span class="kb-agenda-btn-icon-spinner"></span>
  </span>
  <span class="kb-agenda-btn-text">
    <small data-i18n="${hintKey}">${hint}</small>
    <strong data-i18n="${labelKey}">${label}</strong>
  </span>`;
}

function bindAgendaDownloadButtons(root) {
  if (!root) return;
  root.querySelectorAll('a.kb-agenda-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('is-loading')) return;
      btn.classList.add('is-loading');
      btn.setAttribute('aria-busy', 'true');
      const href = btn.getAttribute('href') || '';
      const isLargeLocal =
        href.includes('/assets/docs/') && href.endsWith('.pdf');
      const resetMs = isLargeLocal ? 10000 : 3500;
      window.setTimeout(() => {
        btn.classList.remove('is-loading');
        btn.removeAttribute('aria-busy');
      }, resetMs);
    });
  });
}

function renderAgendaAgendaBtn(url) {
  const inner = renderAgendaBtnInner(
    'agenda.downloadHint',
    'agenda.agendaDoc',
    'ดาวน์โหลด',
    'วาระการประชุม'
  );
  const cls = 'kb-agenda-btn kb-agenda-btn--agenda';
  if (!isUsableDocUrl(url)) {
    return `<span class="${cls} is-disabled" aria-disabled="true">${inner}</span>`;
  }
  return `
<a href="${url.replace(/"/g, '&quot;')}" class="${cls}" target="_blank" rel="noopener noreferrer" download>${inner}</a>`;
}

function renderAgendaReportBtn(url) {
  if (!isUsableDocUrl(url)) return '';
  const inner = renderAgendaBtnInner(
    'agenda.downloadHint',
    'agenda.reportDoc',
    'ดาวน์โหลด',
    'รายงานการประชุม'
  );
  return `
<a href="${url.replace(/"/g, '&quot;')}" class="kb-agenda-btn kb-agenda-btn--report" target="_blank" rel="noopener noreferrer" download>${inner}</a>`;
}

function escapeAgendaHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderAgendaPage(meetings) {
  const cards = (meetings || [])
    .map((m) => {
      const img = m.image
        ? `<img src="${m.image.replace(/"/g, '&quot;')}" alt="" class="kb-agenda-card-img" loading="lazy">`
        : '';
      const agendaBtn = renderAgendaAgendaBtn(m.agendaUrl);
      const reportBtn = renderAgendaReportBtn(m.reportUrl);
      return `
<article class="kb-agenda-card">
  <div class="kb-agenda-card-media">${img}</div>
  <div class="kb-agenda-card-body">
    <h3 class="kb-agenda-card-title">${escapeAgendaHtml(m.title)}</h3>
    <div class="kb-agenda-card-bar" aria-hidden="true"></div>
    <p class="kb-agenda-card-desc">${escapeAgendaHtml(m.description)}</p>
    <div class="kb-agenda-card-actions">${agendaBtn}${reportBtn}</div>
  </div>
</article>`;
    })
    .join('');

  return `
<div class="kb-page-body kb-page-body--agenda">
  <div class="kb-container">
    <div class="kb-agenda-list">${cards}</div>
  </div>
</div>`;
}

window.CmsAgendaPage = {
  parseAgendaMeetings,
  renderAgendaPage,
  applyAgendaPatches,
  bindAgendaDownloadButtons
};

