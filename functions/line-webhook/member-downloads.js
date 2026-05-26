/**
 * แบบฟอร์มดาวน์โหลดสมาชิก — sync กับ public-cms/download-page.js + Firestore cms_pages/7934
 */
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
    .replace(/\s*(?:อัพเดต|อัปเดต|แนบไฟล์)\s+\d{1,2}\s+[^\s]+\s+\d{4}\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripNewBadgeFromTitle(title) {
  return String(title || '')
    .replace(/\s*\(\s*New\s*!\s*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDownloadTitle(title) {
  return stripNewBadgeFromTitle(stripUpdateFromTitle(title));
}

function isUsableDownloadUrl(url) {
  return !!(url && url !== '#' && !/^javascript:/i.test(url));
}

function parseDownloadSections(html, downloadPatches) {
  const patches = Array.isArray(downloadPatches) ? downloadPatches : [];
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
          title: normalizeDownloadTitle(rawTitle),
          description,
          fileUrl,
          updatedAt,
          sectionTitle
        };
      })
      .filter((it) => it.title);

    if (items.length) sections.push({ title: sectionTitle, items });
  });

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

function flattenDownloadItems(sections) {
  const out = [];
  (sections || []).forEach((sec) => {
    (sec.items || []).forEach((it) => {
      out.push({ ...it, sectionTitle: it.sectionTitle || sec.title });
    });
  });
  return out;
}

async function loadMemberDownloadSections(db, downloadPatches) {
  if (!db) return [];
  try {
    const snap = await db.collection('cms_pages').doc(CMS_DOWNLOAD_PAGE_ID).get();
    const html = snap.exists ? String((snap.data() || {}).contentHtml || '') : '';
    if (!html.trim()) return [];
    return parseDownloadSections(html, downloadPatches);
  } catch (e) {
    console.warn('[member-downloads] load:', e.message);
    return [];
  }
}

function buildMemberDownloadsContextLines(sections) {
  const lines = [
    'ข้อมูลเดียวกับหน้าเว็บ [ดาวน์โหลด](/download) — แบบฟอร์มและเอกสาร PDF',
    'เมื่อสมาชิกต้องการดาวน์โหลด ให้แนะนำชื่อแบบฟอร์มที่ตรงความต้องการที่สุดเพียงรายการเดียว',
    'ห้ามเดา URL ไฟล์ — ใช้เฉพาะรายการด้านล่าง'
  ];
  (sections || []).forEach((sec) => {
    lines.push('');
    lines.push(`หมวด: ${sec.title}`);
    (sec.items || []).forEach((it) => {
      const urlPart = isUsableDownloadUrl(it.fileUrl) ? ` | ไฟล์: ${it.fileUrl}` : ' | (ยังไม่มีไฟล์)';
      lines.push(`- id:${it.id} | ${it.title}${urlPart}`);
    });
  });
  if (sections && sections.length) {
    lines.push('');
    lines.push('ดูทั้งหมดที่หน้า [ดาวน์โหลด](/download)');
  }
  return lines;
}

module.exports = {
  CMS_DOWNLOAD_PAGE_ID,
  parseDownloadSections,
  loadMemberDownloadSections,
  buildMemberDownloadsContextLines,
  flattenDownloadItems,
  isUsableDownloadUrl
};
