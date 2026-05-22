/** หน้าดาวน์โหลดเอกสาร — ตาราง + ปุ่ม + นับจำนวน */
const CMS_DOWNLOAD_PAGE_ID = '7934';

function stripDownloadHtml(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugDownloadId(s) {
  return stripDownloadHtml(s)
    .toLowerCase()
    .replace(/[^\u0E00-\u0E7Aa-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 96);
}

function parseFileUpdatedAt(title, description) {
  const text = `${title || ''} ${description || ''}`;
  const paren = text.match(
    /\((?:อัพเดต|อัปเดต|แนบไฟล์|อัปโหลด)[^)]*?(\d{1,2}\s+[^\d)]+?\d{4}[^)]*)\)/i
  );
  if (paren) return paren[1].trim();
  const paren2 = text.match(/\((?:อัพเดต|อัปเดต)\s*([^)]+)\)/i);
  if (paren2) return paren2[1].trim();
  const inline = text.match(/(?:อัพเดต|อัปเดต|แนบไฟล์)\s+(\d{1,2}\s+[^\s]+\s+\d{4})/i);
  if (inline) return inline[1].trim();
  return '';
}

function stripUpdateFromTitle(title) {
  return String(title || '')
    .replace(/\s*\((?:อัพเดต|อัปเดต|แนบไฟล์|อัปโหลด)[^)]*\)/gi, '')
    .replace(
      /\s*(?:อัพเดต|อัปเดต|แนบไฟล์)\s+\d{1,2}\s+[^\s]+\s+\d{4}\s*/gi,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function isUsableDownloadUrl(url) {
  return !!(url && url !== '#' && !/^javascript:/i.test(url));
}

function parseDownloadSections(html) {
  const parts = String(html || '').split(/<h2 class="elementor-heading-title/);
  parts.shift();
  const sections = [];

  parts.forEach((part, si) => {
    const h2m = part.match(/[^>]*>([^<]+)</);
    const sectionTitle = h2m ? stripDownloadHtml(h2m[1]) : `หมวด ${si + 1}`;
    const boxes = [
      ...part.matchAll(
        /contact-cta-box([\s\S]*?)(?=contact-cta-box|elementor-toggle-item|$)/gi
      )
    ];
    const items = boxes
      .map((m) => {
        const block = m[1];
        const titleM = block.match(/<h3>([\s\S]*?)<\/h3>/i);
        const rawTitle = stripDownloadHtml(titleM ? titleM[1] : '');
        const descM = block.match(/<p>([\s\S]*?)<\/p>/i);
        const description = stripDownloadHtml(descM ? descM[1] : '');
        const pdfM =
          block.match(/iframe src="([^"]+\.pdf[^"]*)"/i) ||
          block.match(/href="([^"]+\.pdf[^"]*)"/i);
        const fileUrl = pdfM ? pdfM[1].trim() : '';
        const updatedAt = parseFileUpdatedAt(rawTitle, description);
        return {
          id: slugDownloadId(rawTitle),
          title: stripUpdateFromTitle(rawTitle),
          description,
          fileUrl,
          updatedAt
        };
      })
      .filter((it) => it.title);

    if (items.length) sections.push({ title: sectionTitle, items });
  });

  return applyDownloadPatches(sections);
}

function applyDownloadPatches(sections) {
  const patches = window.CMS_SITE?.downloadPatches || [];
  if (!patches.length) return sections;
  return sections.map((sec) => ({
    ...sec,
    items: sec.items.map((it) => {
      const patch = patches.find((p) => p.match && it.title.includes(p.match));
      if (!patch) return it;
      return {
        ...it,
        ...(patch.fileUrl !== undefined ? { fileUrl: patch.fileUrl } : {}),
        ...(patch.updatedAt !== undefined ? { updatedAt: patch.updatedAt } : {})
      };
    })
  }));
}

function escapeDownloadHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderDownloadBtn(item) {
  const icon = window.KbIcon ? KbIcon.svg('download', 18) : '↓';
  const inner = `
  <span class="kb-download-btn-icon" aria-hidden="true">
    <span class="kb-download-btn-icon-default">${icon}</span>
    <span class="kb-download-btn-icon-spinner"></span>
  </span>
  <span data-i18n="download.btn">ดาวน์โหลด</span>`;
  if (!isUsableDownloadUrl(item.fileUrl)) {
    return `<span class="kb-download-btn is-disabled" aria-disabled="true">${inner}</span>`;
  }
  const href = item.fileUrl.replace(/"/g, '&quot;');
  return `<a href="${href}" class="kb-download-btn" data-download-id="${escapeDownloadHtml(item.id)}" target="_blank" rel="noopener noreferrer" download>${inner}</a>`;
}

function renderDownloadCountInline(count) {
  const icon = window.KbIcon ? KbIcon.wrap('download', '', 11) : '';
  return `<span class="kb-download-count-inline">${icon} <span data-count-num>${formatDownloadCount(count)}</span></span>`;
}

function renderDownloadActionCell(item, count) {
  const dlCount = count != null ? count : 0;
  const datePart = item.updatedAt
    ? `<span class="kb-download-meta-date">${escapeDownloadHtml(item.updatedAt)}</span> `
    : '';
  const meta = `<div class="kb-download-meta" data-count-cell>${datePart}${renderDownloadCountInline(dlCount)}</div>`;
  return `<div class="kb-download-action">${renderDownloadBtn(item)}${meta}</div>`;
}

function formatDownloadCount(n) {
  const num = Number(n) || 0;
  const lang = window.CmsI18n?.getLang() || 'th';
  return num.toLocaleString(lang === 'en' ? 'en-US' : 'th-TH');
}

function downloadT(key) {
  return window.CmsI18n ? CmsI18n.t(`download.${key}`) : key;
}

function renderDownloadSearch() {
  return `
<div class="kb-download-search-wrap">
  <label class="kb-download-search-label" for="kb-download-search" data-i18n="download.searchLabel">${escapeDownloadHtml(downloadT('searchLabel'))}</label>
  <input type="search" id="kb-download-search" class="kb-download-search" placeholder="${escapeDownloadHtml(downloadT('searchPlaceholder'))}" autocomplete="off">
  <p class="kb-download-search-empty" id="kb-download-search-empty" hidden data-i18n="download.searchEmpty">${escapeDownloadHtml(downloadT('searchEmpty'))}</p>
</div>`;
}

function renderDownloadTable(sections, countMap) {
  const counts = countMap || {};
  const colDoc = downloadT('colDoc');
  const colAction = downloadT('colAction');

  const blocks = (sections || [])
    .map((sec) => {
      const rows = sec.items
        .map((it) => {
          const note =
            !isUsableDownloadUrl(it.fileUrl) && it.description
              ? `<div class="kb-download-desc">${escapeDownloadHtml(it.description)}</div>`
              : '';
          const dlCount = counts[it.id] != null ? counts[it.id] : 0;
          const searchText = [sec.title, it.title, it.description, it.updatedAt]
            .filter(Boolean)
            .join(' ');
          return `
<tr data-download-id="${escapeDownloadHtml(it.id)}" data-search="${escapeDownloadHtml(searchText)}">
  <td class="kb-download-col-doc">
    <div class="kb-download-title">${escapeDownloadHtml(it.title)}</div>
    ${note}
  </td>
  <td class="kb-download-col-btn">${renderDownloadActionCell(it, dlCount)}</td>
</tr>`;
        })
        .join('');

      return `
<section class="kb-download-section" data-section-title="${escapeDownloadHtml(sec.title)}">
  <h2 class="kb-download-section-title">${escapeDownloadHtml(sec.title)}</h2>
  <div class="kb-download-table-wrap">
    <table class="kb-download-table">
      <thead>
        <tr>
          <th scope="col">${colDoc}</th>
          <th scope="col">${colAction}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</section>`;
    })
    .join('');

  return `
<div class="kb-page-body kb-page-body--download">
  <div class="kb-container">
    <div class="kb-download-toolbar">${renderDownloadSearch()}</div>
    <div class="kb-download-sections">${blocks}</div>
  </div>
</div>`;
}

async function trackDownload(id) {
  if (!id || !window.CmsCounters) return null;
  try {
    return await CmsCounters.bump('cms_download_counts', id);
  } catch (e) {
    return null;
  }
}

function bindDownloadSearch(root) {
  const input = root?.querySelector('#kb-download-search');
  const emptyEl = root?.querySelector('#kb-download-search-empty');
  if (!input) return;

  const run = () => {
    const q = input.value.trim().toLowerCase();
    let any = false;
    root.querySelectorAll('.kb-download-section').forEach((sec) => {
      let secAny = false;
      sec.querySelectorAll('tr[data-search]').forEach((row) => {
        const text = (row.getAttribute('data-search') || '').toLowerCase();
        const title = (sec.getAttribute('data-section-title') || '').toLowerCase();
        const show = !q || text.includes(q) || title.includes(q);
        row.classList.toggle('is-hidden', !show);
        if (show) {
          secAny = true;
          any = true;
        }
      });
      sec.classList.toggle('is-hidden', !secAny);
    });
    if (emptyEl) emptyEl.hidden = !q || any;
  };

  input.addEventListener('input', run);
}

function bindDownloadButtons(root) {
  if (!root) return;
  bindDownloadSearch(root);
  root.querySelectorAll('a.kb-download-btn[data-download-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-download-id');
      if (!id || btn.classList.contains('is-loading')) return;
      btn.classList.add('is-loading');
      btn.setAttribute('aria-busy', 'true');
      const next = await trackDownload(id);
      if (next != null) {
        const row = btn.closest('tr');
        const numEl = row && row.querySelector('[data-count-num]');
        if (numEl) numEl.textContent = formatDownloadCount(next);
      }
      window.setTimeout(() => {
        btn.classList.remove('is-loading');
        btn.removeAttribute('aria-busy');
      }, 2000);
    });
  });
}

window.CmsDownloadPage = {
  PAGE_ID: CMS_DOWNLOAD_PAGE_ID,
  parseDownloadSections,
  renderDownloadTable,
  bindDownloadButtons,
  bindDownloadSearch
};
