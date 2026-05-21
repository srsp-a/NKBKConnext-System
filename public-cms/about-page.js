/** หน้าเกี่ยวกับสหกรณ์ — layout ใหม่ */

const CMS_ABOUT_PAGE_ID = '241';



function stripAboutHtml(s) {

  return String(s || '')

    .replace(/<[^>]+>/g, ' ')

    .replace(/\s+/g, ' ')

    .trim();

}



function escapeAboutHtml(s) {

  return String(s)

    .replace(/&/g, '&amp;')

    .replace(/</g, '&lt;')

    .replace(/>/g, '&gt;')

    .replace(/"/g, '&quot;');

}



function youtubeVideoId(href) {

  if (!href) return '';

  const m = String(href).match(

    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{6,})/

  );

  return m ? m[1] : '';

}



function structureHeroBody(html) {

  const doc = new DOMParser().parseFromString(

    `<div id="kb-about-root">${html || ''}</div>`,

    'text/html'

  );

  const root = doc.getElementById('kb-about-root');

  if (!root) return { introHtml: html || '', sections: [] };



  const introParts = [];

  const sections = [];

  let current = null;



  [...root.children].forEach((el) => {

    if (/^H[234]$/.test(el.tagName)) {
      const title = el.textContent.trim();
      if (!title) return;
      current = { title, bodyHtml: '' };
      sections.push(current);
      return;
    }

    if (current) current.bodyHtml += el.outerHTML;

    else introParts.push(el.outerHTML);

  });



  return { introHtml: introParts.join(''), sections };

}



function enhanceIntroHtml(html) {

  if (!html) return '';

  const doc = new DOMParser().parseFromString(

    `<div id="kb-about-intro">${html}</div>`,

    'text/html'

  );

  const root = doc.getElementById('kb-about-intro');

  if (!root) return html;



  const firstP = root.querySelector('p');

  if (firstP) firstP.classList.add('kb-about-lead');



  const list = root.querySelector('ol, ul');
  if (list) {
    list.classList.add('kb-about-members');
    const items = [...list.querySelectorAll('li')];
    if (items.length === 1) {
      const parts = items[0].innerHTML
        .split(/<br\s*\/?>/i)
        .map((part) =>
          stripAboutHtml(part).replace(/^\d+\.\s*/, '').trim()
        )
        .filter(Boolean);
      if (parts.length > 1) {
        list.innerHTML = parts
          .map((name) => `<li class="kb-about-member">${escapeAboutHtml(name)}</li>`)
          .join('');
      } else {
        items[0].classList.add('kb-about-member');
      }
    } else {
      items.forEach((li) => li.classList.add('kb-about-member'));
    }
  }



  return root.innerHTML;

}



function parseComparisonTables(doc) {

  const wraps = [...doc.querySelectorAll('.comparisons-table')];

  const sections = [];



  wraps.forEach((wrap) => {

    const headers = [...wrap.querySelectorAll('thead th')]

      .map((th) => stripAboutHtml(th.textContent))

      .filter(Boolean);

    const rows = [...wrap.querySelectorAll('tbody tr')]

      .map((tr) =>

        [...tr.querySelectorAll('td')].map((td) => td.innerHTML.trim())

      )

      .filter((cells) => cells.some((c) => stripAboutHtml(c)));



    if (!rows.length) return;



    const prev = sections[sections.length - 1];

    if (prev && !headers.length && rows[0]?.length === prev.headers.length) {

      prev.rows.push(...rows);

      return;

    }



    let title = headers[0] || '';

    if (!title) {

      title =

        rows[0]?.length >= 2

          ? sections.length === 0

            ? 'ผู้ดำรงตำแหน่งประธานสหกรณ์'

            : 'ผู้ดำรงตำแหน่งผู้จัดการสหกรณ์'

          : 'ข้อมูลเพิ่มเติม';

    }



    const colHeaders =

      headers.length >= 2

        ? headers

        : rows[0]?.length >= 2

          ? ['รายการ', 'ปี พ.ศ.']

          : ['รายการ'];



    sections.push({ title, headers: colHeaders, rows });

  });



  return sections;

}



function parseAboutPage(html) {

  const doc = new DOMParser().parseFromString(html, 'text/html');

  const data = { hero: null, tables: [] };



  const area = doc.querySelector('.about-area');

  if (area) {

    const content = area.querySelector('.about-content');

    const img = area.querySelector('.about-image img');

    const videoA = area.querySelector(

      'a.popup-youtube, a.video-btn, a[href*="youtube"]'

    );

    const h2 = content?.querySelector('h2');

    const body = content?.cloneNode(true);

    if (body) {

      body.querySelector('h2')?.remove();

      body.querySelector('span:empty')?.remove();

    }

    const rawBody = body?.innerHTML?.trim() || '';

    const structured = structureHeroBody(rawBody);



    data.hero = {

      heading: (h2?.textContent || '').trim() || 'ประวัติสหกรณ์',

      image: img?.getAttribute('src') || '',

      videoId: youtubeVideoId(videoA?.getAttribute('href') || ''),

      introHtml: enhanceIntroHtml(structured.introHtml),

      sections: structured.sections

    };

  }



  data.tables = parseComparisonTables(doc);

  return data;

}



function renderAboutMedia(hero) {

  if (!hero.image && !hero.videoId) return '';

  const img = hero.image

    ? `<img src="${hero.image.replace(/"/g, '&quot;')}" alt="" class="kb-about-hero-img" loading="lazy">`

    : '';

  const play = hero.videoId

    ? `<button type="button" class="kb-about-video" data-about-video="${escapeAboutHtml(hero.videoId)}" aria-label="ดูวิดีโอ">

  <span class="kb-about-video-ring" aria-hidden="true"></span>

  <span class="kb-about-video-icon" aria-hidden="true"></span>

  <span class="kb-about-video-label">ดูวิดีโอ</span>

</button>`

    : '';



  return `<div class="kb-about-hero-media">${img}${play}</div>`;

}



function renderAboutSections(sections) {
  const valid = (sections || []).filter(
    (sec) => stripAboutHtml(sec.title) && stripAboutHtml(sec.bodyHtml)
  );
  if (!valid.length) return '';

  return valid

    .map(

      (sec) => `

<article class="kb-about-block">

  <h3 class="kb-about-block-title">${escapeAboutHtml(sec.title)}</h3>

  <div class="kb-about-block-body kb-prose">${sec.bodyHtml}</div>

</article>`

    )

    .join('');

}



function renderAboutHero(hero) {

  if (!hero) return '';

  const media = renderAboutMedia(hero);

  const blocks = renderAboutSections(hero.sections);



  return `

<section class="kb-about-hero" aria-labelledby="kb-about-hero-title">

  <div class="kb-container">

    <header class="kb-about-hero-head">

      <h2 id="kb-about-hero-title" class="kb-about-hero-title">${escapeAboutHtml(hero.heading)}</h2>

    </header>

    <div class="kb-about-story-top">

      <div class="kb-about-story-text kb-prose">${hero.introHtml || ''}</div>

      ${media}

    </div>

    ${blocks ? `<div class="kb-about-story-blocks">${blocks}</div>` : ''}

  </div>

</section>`;

}



function renderAboutTable(section) {

  const colCount = section.headers.length;

  const head = section.headers

    .map((h) => `<th scope="col">${escapeAboutHtml(h)}</th>`)

    .join('');

  const rows = section.rows

    .map((cells) => {

      const tds = section.headers

        .map((_, i) => {

          const cell = cells[i] || '';

          return `<td>${cell}</td>`;

        })

        .join('');

      return `<tr>${tds}</tr>`;

    })

    .join('');



  return `

<section class="kb-about-table-section">

  <h3 class="kb-about-table-title">${escapeAboutHtml(section.title)}</h3>

  <div class="kb-about-table-wrap">

    <table class="kb-about-table kb-about-table--cols-${colCount}">

      <thead><tr>${head}</tr></thead>

      <tbody>${rows}</tbody>

    </table>

  </div>

</section>`;

}



function renderAboutPage(data) {

  const hero = renderAboutHero(data?.hero);

  const tables = (data?.tables || []).map(renderAboutTable).join('');



  return `

<div class="kb-page-body kb-page-body--about">

  <div class="kb-container">

    ${hero}

    <div class="kb-about-tables">${tables}</div>

  </div>

</div>`;

}



function ensureAboutVideoModal() {

  let modal = document.getElementById('kb-about-video-modal');

  if (modal) return modal;



  modal = document.createElement('div');

  modal.id = 'kb-about-video-modal';

  modal.className = 'kb-about-modal';

  modal.hidden = true;

  modal.innerHTML = `

<div class="kb-about-modal-backdrop" data-about-modal-close tabindex="-1"></div>

<div class="kb-about-modal-panel" role="dialog" aria-modal="true" aria-labelledby="kb-about-modal-title">

  <div class="kb-about-modal-header">

    <h2 id="kb-about-modal-title" class="kb-about-modal-title">วิดีโอสหกรณ์</h2>

    <button type="button" class="kb-about-modal-close" data-about-modal-close aria-label="ปิด">&times;</button>

  </div>

  <div class="kb-about-modal-body">

    <div class="kb-about-modal-video"></div>

  </div>

</div>`;

  document.body.appendChild(modal);

  return modal;

}



function closeAboutVideoModal(modal) {

  const videoWrap = modal.querySelector('.kb-about-modal-video');

  if (videoWrap) videoWrap.innerHTML = '';

  modal.hidden = true;

  document.body.classList.remove('kb-about-modal-open');

}



function openAboutVideoModal(videoId) {

  const modal = ensureAboutVideoModal();

  const videoWrap = modal.querySelector('.kb-about-modal-video');

  if (!videoWrap) return;



  const embed = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0`;

  videoWrap.innerHTML = `<iframe src="${embed}" title="วิดีโอ YouTube" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;

  modal.hidden = false;

  document.body.classList.add('kb-about-modal-open');

  modal.querySelector('.kb-about-modal-close')?.focus();

}



let aboutModalListenersBound = false;

function bindAboutPage(root) {
  if (!root) return;

  root.querySelectorAll('[data-about-video]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-about-video');
      if (id) openAboutVideoModal(id);
    });
  });

  if (aboutModalListenersBound) return;
  aboutModalListenersBound = true;

  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-about-modal-close]')) return;
    const modal = document.getElementById('kb-about-video-modal');
    if (modal && !modal.hidden) closeAboutVideoModal(modal);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const modal = document.getElementById('kb-about-video-modal');
    if (modal && !modal.hidden) closeAboutVideoModal(modal);
  });
}



window.CmsAboutPage = {

  PAGE_ID: CMS_ABOUT_PAGE_ID,

  parseAboutPage,

  renderAboutPage,

  bindAboutPage

};

