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
        const title = stripDownloadHtml(titleM ? titleM[1] : '');
        const descM = block.match(/<p>([\s\S]*?)<\/p>/i);
        const description = stripDownloadHtml(descM ? descM[1] : '');
        const pdfM =
          block.match(/iframe src="([^"]+\.pdf[^"]*)"/i) ||
          block.match(/href="([^"]+\.pdf[^"]*)"/i);
        const fileUrl = pdfM ? pdfM[1].trim() : '';
        const id = slugDownloadId(title);
        return {
          id,
          title,
          description,
          fileUrl,
          updatedAt: parseFileUpdatedAt(title, description)
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

function renderDownloadTable(sections) {
  const colDoc = window.CmsI18n ? CmsI18n.t('download.colDoc') : 'เอกสาร';
  const colUpdated = window.CmsI18n ? CmsI18n.t('download.colUpdated') : 'อัปเดตไฟล์';
  const colAction = window.CmsI18n ? CmsI18n.t('download.colAction') : 'ดาวน์โหลด';
  const colCount = window.CmsI18n ? CmsI18n.t('download.colCount') : 'จำนวนดาวน์โหลด';
  const noFile = window.CmsI18n ? CmsI18n.t('download.noFile') : 'ยังไม่มีไฟล์';
  const noDate = window.CmsI18n ? CmsI18n.t('download.noDate') : '—';

  const blocks = (sections || [])
    .map((sec) => {
      const rows = sec.items
        .map((it) => {
          const updated = it.updatedAt
            ? escapeDownloadHtml(it.updatedAt)
            : `<span class="kb-download-muted">${noDate}</span>`;
          const note =
            !isUsableDownloadUrl(it.fileUrl) && it.description
              ? `<div class="kb-download-desc">${escapeDownloadHtml(it.description)}</div>`
              : '';
          return `
<tr data-download-id="${escapeDownloadHtml(it.id)}">
  <td class="kb-download-col-doc">
    <div class="kb-download-title">${escapeDownloadHtml(it.title)}</div>
    ${note}
  </td>
  <td class="kb-download-col-date">${updated}</td>
  <td class="kb-download-col-btn">${renderDownloadBtn(it)}</td>
  <td class="kb-download-col-count"><span class="kb-download-count" data-count-for="${escapeDownloadHtml(it.id)}">0</span></td>
</tr>`;
        })
        .join('');

      return `
<section class="kb-download-section">
  <h2 class="kb-download-section-title">${escapeDownloadHtml(sec.title)}</h2>
  <div class="kb-download-table-wrap">
    <table class="kb-download-table">
      <thead>
        <tr>
          <th scope="col">${colDoc}</th>
          <th scope="col">${colUpdated}</th>
          <th scope="col">${colAction}</th>
          <th scope="col">${colCount}</th>
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
    <p class="kb-download-intro" data-i18n="download.intro">ดาวน์โหลดแบบฟอร์มและเอกสารสำคัญของสหกรณ์ — รายการที่ยังไม่มีไฟล์จะแสดงปุ่มไม่พร้อมใช้งาน</p>
    ${blocks}
  </div>
</div>`;
}

async function loadDownloadCounts(root) {
  const ids = [
    ...new Set(
      [...(root?.querySelectorAll('[data-download-id]') || [])].map((el) =>
        el.getAttribute('data-download-id')
      )
    )
  ].filter(Boolean);
  if (!ids.length || !window.db) return;

  const counts = {};
  await Promise.all(
    ids.map(async (id) => {
      try {
        const snap = await db.collection('cms_download_counts').doc(id).get();
        counts[id] = snap.exists ? snap.data().count || 0 : 0;
      } catch {
        counts[id] = 0;
      }
    })
  );

  root.querySelectorAll('.kb-download-count').forEach((el) => {
    const id = el.getAttribute('data-count-for');
    if (id && counts[id] != null) {
      el.textContent = Number(counts[id]).toLocaleString('th-TH');
    }
  });
}

async function trackDownload(id) {
  if (!id || !window.db) return null;
  const ref = db.collection('cms_download_counts').doc(id);
  try {
    await ref.set(
      { count: firebase.firestore.FieldValue.increment(1) },
      { merge: true }
    );
    const snap = await ref.get();
    return snap.exists ? snap.data().count || 0 : 1;
  } catch (e) {
    console.warn('download count', id, e.message);
    return null;
  }
}

function bindDownloadButtons(root) {
  if (!root) return;
  root.querySelectorAll('a.kb-download-btn[data-download-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-download-id');
      if (!id || btn.classList.contains('is-loading')) return;
      btn.classList.add('is-loading');
      btn.setAttribute('aria-busy', 'true');
      const newCount = await trackDownload(id);
      const countEl = root.querySelector(
        `.kb-download-count[data-count-for="${CSS.escape(id)}"]`
      );
      if (countEl && newCount != null) {
        countEl.textContent = Number(newCount).toLocaleString('th-TH');
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
  loadDownloadCounts,
  bindDownloadButtons
};
