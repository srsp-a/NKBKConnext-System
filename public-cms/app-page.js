/** หน้า NKBKConnext — ดาวน์โหลดและวิธีใช้งานแอป */
const CMS_APP_PAGE_ID = '9208';
const APP_MEDIA_BASE =
  'https://storage.googleapis.com/admin-panel-nkbkcoop-cbf10.firebasestorage.app/cms/wp/media/';

function escapeAppHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const APP_I18N_FALLBACK = {
  pageTitle: 'วิธีดาวน์โหลด/วิธีสมัครใช้บริการ App NKBKConnext',
  pageSubtitle: 'ดาวน์โหลดแอป สมัครใช้งาน และเริ่มต้นใช้บริการสมาชิกบนมือถือ',
  kicker: 'แอปสมาชิก',
  heroTitle: 'NKBKConnext',
  heroDesc:
    'ตรวจสอบยอดเงินฝาก เงินกู้ แจ้งโอน และรับข่าวสารจากสหกรณ์ — ใช้งานได้ทุกที่ทุกเวลา',
  f1: 'ตรวจสอบยอดบัญชีแบบเรียลไทม์',
  f2: 'แจ้งโอนเงินและชำระเงินกู้',
  f3: 'รับข่าวสารและประกาศจากสหกรณ์',
  appStore: 'App Store',
  googlePlay: 'Google Play',
  videoTitle: 'วิดีโอแนะนำการใช้งาน',
  videoDesc: 'ชมขั้นตอนการดาวน์โหลดและสมัครใช้บริการแอป NKBKConnext',
  videoFallback: 'เบราว์เซอร์ของคุณไม่รองรับการเล่นวิดีโอ',
  stepsTitle: 'ขั้นตอนการใช้งาน',
  stepsDesc: 'ทำตามภาพด้านล่างทีละขั้นตอน — จากดาวน์โหลดจนถึงเข้าใช้งานได้',
  stepLabel: 'ขั้นตอนที่',
  ctaTitle: 'พร้อมเริ่มใช้งานแล้ว?',
  ctaDesc: 'ดาวน์โหลด NKBKConnext ได้ทั้ง iOS และ Android'
};

function appT(key) {
  if (window.CmsI18n) {
    const v = CmsI18n.t(`appPage.${key}`);
    if (v && v !== `appPage.${key}`) return v;
  }
  return APP_I18N_FALLBACK[key] || key;
}

function getAppPageData() {
  const c = window.CMS_SITE || {};
  return {
    iosUrl: c.appStoreIos || '#',
    androidUrl: c.appStoreAndroid || '#',
    heroImage: c.heroAppImage || '/assets/img/hero-app.png',
    video: `${APP_MEDIA_BASE}833bf3b1ab361a5b.mp4`,
    poster: `${APP_MEDIA_BASE}6b13a4477bb834a1.jpg`,
    appStoreBadge: `${APP_MEDIA_BASE}f98fc0ce1f107f13.png`,
    playBadge: `${APP_MEDIA_BASE}424dbdaa019815ae.png`,
    steps: [
      '6b13a4477bb834a1.jpg',
      'f2e2ae46a228a8b5.jpg',
      '8195fbf057469616.jpg',
      '67630fb098e53a50.jpg',
      '5c73f30f823f3950.jpg',
      '5df2248b5ae7a7d4.jpg',
      '5932c3eb04082654.jpg',
      '2bd176ae52d5bbf3.jpg',
      '23db5eabe8baad18.jpg',
      '243ae7ce40ff38ff.jpg',
      'dff781b1fa2830b7.jpg'
    ].map((f) => APP_MEDIA_BASE + f)
  };
}

function renderStoreButtons(d, compact) {
  const cls = compact ? 'kb-app-guide-stores kb-app-guide-stores--compact' : 'kb-app-guide-stores';
  return `
<div class="${cls}">
  <a href="${escapeAppHtml(d.iosUrl)}" class="kb-app-guide-store" target="_blank" rel="noopener noreferrer">
    <img src="${escapeAppHtml(d.appStoreBadge)}" alt="App Store" width="96" height="96" loading="lazy">
    <span>${escapeAppHtml(appT('appStore'))}</span>
  </a>
  <a href="${escapeAppHtml(d.androidUrl)}" class="kb-app-guide-store" target="_blank" rel="noopener noreferrer">
    <img src="${escapeAppHtml(d.playBadge)}" alt="Google Play" width="96" height="96" loading="lazy">
    <span>${escapeAppHtml(appT('googlePlay'))}</span>
  </a>
</div>`;
}

function renderAppGuidePage() {
  const d = getAppPageData();
  const phoneIcon = window.KbIcon ? KbIcon.svg('smartphone', 20) : '';
  const checkIcon = window.KbIcon ? KbIcon.svg('check', 16) : '✓';

  const features = ['f1', 'f2', 'f3']
    .map(
      (k) =>
        `<li><span class="kb-app-guide-check" aria-hidden="true">${checkIcon}</span><span>${escapeAppHtml(appT(k))}</span></li>`
    )
    .join('');

  const steps = d.steps
    .map(
      (src, i) => `
<article class="kb-app-guide-step">
  <div class="kb-app-guide-step-head">
    <span class="kb-app-guide-step-num">${i + 1}</span>
    <span class="kb-app-guide-step-label">${escapeAppHtml(appT('stepLabel'))} ${i + 1}</span>
  </div>
  <div class="kb-app-guide-step-img">
    <img src="${escapeAppHtml(src)}" alt="" width="1024" height="1024" loading="lazy" decoding="async">
  </div>
</article>`
    )
    .join('');

  return `
<div class="kb-app-guide">
  <section class="kb-app-guide-hero" aria-labelledby="kb-app-guide-hero-title">
    <div class="kb-container kb-app-guide-hero-inner">
      <div class="kb-app-guide-hero-copy">
        <p class="kb-app-guide-kicker">${escapeAppHtml(appT('kicker'))}</p>
        <h2 id="kb-app-guide-hero-title" class="kb-app-guide-hero-title">${escapeAppHtml(appT('heroTitle'))}</h2>
        <p class="kb-app-guide-hero-desc">${escapeAppHtml(appT('heroDesc'))}</p>
        <ul class="kb-app-guide-features">${features}</ul>
        ${renderStoreButtons(d, false)}
      </div>
      <div class="kb-app-guide-hero-visual" aria-hidden="true">
        <div class="kb-app-guide-phone">
          <span class="kb-app-guide-phone-notch"></span>
          <div class="kb-app-guide-phone-screen">
            <img src="${escapeAppHtml(d.heroImage)}" alt="" width="280" height="560" loading="eager">
          </div>
        </div>
        <div class="kb-app-guide-hero-glow"></div>
      </div>
    </div>
  </section>

  <section class="kb-app-guide-video" aria-labelledby="kb-app-guide-video-title">
    <div class="kb-container">
      <div class="kb-app-guide-section-head">
        <h2 id="kb-app-guide-video-title">${escapeAppHtml(appT('videoTitle'))}</h2>
        <p>${escapeAppHtml(appT('videoDesc'))}</p>
      </div>
      <div class="kb-app-guide-video-card">
        <video controls playsinline preload="metadata" poster="${escapeAppHtml(d.poster)}" src="${escapeAppHtml(d.video)}">
          <span>${escapeAppHtml(appT('videoFallback'))}</span>
        </video>
      </div>
    </div>
  </section>

  <section class="kb-app-guide-steps" aria-labelledby="kb-app-guide-steps-title">
    <div class="kb-container">
      <div class="kb-app-guide-section-head">
        <h2 id="kb-app-guide-steps-title">${escapeAppHtml(appT('stepsTitle'))}</h2>
        <p>${escapeAppHtml(appT('stepsDesc'))}</p>
      </div>
      <div class="kb-app-guide-steps-grid">${steps}</div>
    </div>
  </section>

  <section class="kb-app-guide-cta" aria-labelledby="kb-app-guide-cta-title">
    <div class="kb-container kb-app-guide-cta-inner">
      <div class="kb-app-guide-cta-copy">
        <span class="kb-app-guide-cta-icon" aria-hidden="true">${phoneIcon}</span>
        <div>
          <h2 id="kb-app-guide-cta-title">${escapeAppHtml(appT('ctaTitle'))}</h2>
          <p>${escapeAppHtml(appT('ctaDesc'))}</p>
        </div>
      </div>
      ${renderStoreButtons(d, true)}
    </div>
  </section>
</div>`;
}

function bindAppGuidePage(main) {
  if (!main) return;
  const rerender = () => {
    if (!main.querySelector('.kb-app-guide')) return;
    main.innerHTML = renderAppGuidePage();
    if (window.CmsLayout) {
      CmsLayout.setPageTitle(escapeHtml(appT('pageTitle')), escapeHtml(appT('pageSubtitle')));
    }
  };
  window.addEventListener('cms:langchange', rerender);
}

window.CmsAppPage = {
  CMS_APP_PAGE_ID,
  renderAppGuidePage,
  getAppPageData,
  bindAppGuidePage
};
