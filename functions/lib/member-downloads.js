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

const GENERIC_DOWNLOAD_PHRASES = [
  /^แบบฟอร์มดาวน์โหลด$/,
  /^ดาวน์โหลดแบบฟอร์ม$/,
  /^ดาวน์โหลด$/,
  /^download\s*forms?$/i,
  /^download$/,
  /^แบบฟอร์ม$/,
  /^เอกสารดาวน์โหลด$/,
  /^ขอ(?:ดาวน์โหลด)?(?:แบบ)?ฟอร์ม$/,
  /^อยาก(?:ดาวน์โหลด)?(?:แบบ)?ฟอร์ม$/,
  /^ต้องการ(?:ดาวน์โหลด)?(?:แบบ)?ฟอร์ม$/
];

function isGenericDownloadQuery(message) {
  const raw = String(message || '').trim();
  if (!raw || !isDownloadIntent(raw)) return false;
  const norm = raw.replace(/\s+/g, ' ').toLowerCase();
  if (GENERIC_DOWNLOAD_PHRASES.some((re) => re.test(norm))) return true;
  const stripped = norm
    .replace(
      /แบบฟอร์ม|ดาวน์โหลด|download|forms?|เอกสาร|pdf|ขอ|หน่อย|ค่ะ|ครับ|นะ|please|อยาก|ต้องการ|โหลด/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length < 3;
}

function buildMemberDownloadsContextLines(sections) {
  const lines = [
    'ข้อมูลเดียวกับหน้าเว็บ [ดาวน์โหลด](/download) — แบบฟอร์มและเอกสาร PDF',
    'เมื่อสมาชิกถามทั่วไปว่าต้องการดาวน์โหลดแบบฟอร์มแต่ยังไม่ระบุชื่อ/เรื่อง ให้ถามกลับว่าต้องการแบบฟอร์มเรื่องอะไร และยกตัวอย่างหมวดจากรายการด้านล่าง — ห้ามเลือกแบบฟอร์มเฉพาะรายการให้เอง',
    'เมื่อสมาชิกระบุชื่อหรือเรื่องแบบฟอร์มชัดเจนแล้ว จึงแนะนำชื่อแบบฟอร์มที่ตรงที่สุดเพียงรายการเดียว',
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

function tokenizeThai(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\u0E00-\u0E7Aa-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function scoreDownloadMatch(item, haystack) {
  const title = String(item.title || '').toLowerCase();
  if (!title) return 0;
  if (haystack.includes(title)) return 100 + title.length;

  let score = 0;
  const parts = title.split(/[\s/(),\-]+/).filter((p) => p.length >= 2);
  parts.forEach((tok) => {
    if (haystack.includes(tok)) score += tok.length * 2;
  });

  for (let len = Math.min(title.length, 14); len >= 4; len--) {
    for (let i = 0; i <= title.length - len; i++) {
      const sub = title.slice(i, i + len);
      if (haystack.includes(sub)) {
        score += sub.length;
        break;
      }
    }
    if (score >= 8) break;
  }

  tokenizeThai(item.sectionTitle).forEach((tok) => {
    if (haystack.includes(tok)) score += Math.floor(tok.length / 2);
  });
  return score;
}

function pickDownloadActions(message, reply, sections, maxItems) {
  if (isGenericDownloadQuery(message)) return [];
  const limit = Math.min(1, Math.max(1, maxItems || 1));
  const userHay = String(message || '').toLowerCase();
  const replyHay = String(reply || '').toLowerCase();
  const items = flattenDownloadItems(sections).filter((it) => isUsableDownloadUrl(it.fileUrl));
  const scored = items
    .map((it) => {
      const userScore = scoreDownloadMatch(it, userHay);
      const replyScore = scoreDownloadMatch(it, replyHay);
      return {
        item: it,
        userScore,
        score: userScore >= 4 ? userScore * 3 + replyScore : userScore
      };
    })
    .filter((x) => x.score >= 4 && x.userScore >= 4)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return [];
  const { item } = scored[0];
  return [
    {
      id: item.id,
      title: item.title,
      url: item.fileUrl,
      sectionTitle: item.sectionTitle || ''
    }
  ].slice(0, limit);
}

function isDownloadIntent(message) {
  return /แบบฟอร์ม|ดาวน์โหลด|download|form|เอกสาร|ใบคำ|ใบสมัคร|pdf/i.test(String(message || ''));
}

function stripDownloadMarkers(reply) {
  return String(reply || '')
    .replace(/\n?<!--DOWNLOADS:\[[\s\S]*?\]-->\n?/g, '')
    .replace(/\n?DOWNLOADS:\[[\s\S]*?\]\n?/g, '')
    .trim();
}

module.exports = {
  CMS_DOWNLOAD_PAGE_ID,
  parseDownloadSections,
  loadMemberDownloadSections,
  buildMemberDownloadsContextLines,
  flattenDownloadItems,
  pickDownloadActions,
  isDownloadIntent,
  isGenericDownloadQuery,
  isUsableDownloadUrl,
  stripDownloadMarkers
};
