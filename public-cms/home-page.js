/** หน้าแรก — hero ตาม mockup + ส่วนล่างแบบเดิม */
function homeStatLabel(s) {
  const lang = window.CmsI18n?.getLang() || 'th';
  return lang === 'en' ? s.labelEn : s.labelTh;
}

function homeStatSuffix(s) {
  const lang = window.CmsI18n?.getLang() || 'th';
  return lang === 'en' ? s.suffixEn || '' : s.suffixTh || '';
}

function homeHeroImages() {
  const list = CMS_SITE.heroImages;
  if (Array.isArray(list) && list.length) return list;
  const one = CMS_SITE.heroImage || '/assets/img/hero-sps0100.png';
  return [one];
}

function homeRateLabel(row) {
  const lang = window.CmsI18n?.getLang() || 'th';
  return lang === 'en' && row.labelEn ? row.labelEn : row.labelTh;
}

function renderRateCard(titleKey, titleFallback, rows, variant, headIcon, rowIcon) {
  const items = (rows || [])
    .map((row) => {
      const badge = row.popular
        ? `<span class="kb-rate-badge" data-i18n="home.popularBadge">ยอดนิยม</span>`
        : '';
      return `
      <li class="kb-rate-item">
        <div class="kb-rate-item-left">
          <span class="kb-rate-item-icon" aria-hidden="true">${kbIcon(rowIcon, 18)}</span>
          <span class="kb-rate-item-label">${homeRateLabel(row)}</span>
          ${badge}
        </div>
        <div class="kb-rate-item-value">
          <strong>${row.rate}%</strong>
          <small data-i18n="home.perYearUnit">ต่อปี</small>
        </div>
      </li>`;
    })
    .join('');

  return `
<article class="kb-rate-card kb-rate-card--${variant}">
  <header class="kb-rate-card-top">
    <span class="kb-rate-card-mark" aria-hidden="true">${kbIcon(headIcon, 22)}</span>
    <h3 data-i18n="${titleKey}">${titleFallback}</h3>
  </header>
  <ul class="kb-rate-list">${items}</ul>
</article>`;
}

function homePartnerName(partner) {
  const lang = window.CmsI18n?.getLang() || 'th';
  return lang === 'en' && partner.nameEn ? partner.nameEn : partner.nameTh;
}

function renderHomePartnersSection() {
  const partners = CMS_SITE.externalPartners || [];
  const cards = partners
    .map(
      (p) => `
      <a href="${p.url}" class="kb-partner-card" target="_blank" rel="noopener noreferrer">
        <img src="${p.logo}" alt="" class="kb-partner-logo" width="56" height="56" loading="lazy">
        <span class="kb-partner-name">${homePartnerName(p)}</span>
      </a>`
    )
    .join('');

  return `
<section class="kb-section kb-section--partners" id="home-partners">
  <div class="kb-container">
    <div class="kb-partners-head">
      <h2 class="kb-section-title" data-i18n="home.partnersTitle">ลิงก์หน่วยงานภายนอก</h2>
    </div>
    <div class="kb-partners-grid">${cards}</div>
  </div>
</section>`;
}

function renderHomeRatesSection() {
  const rates = CMS_SITE.interestRates || {};
  const deposit = rates.deposit || [];
  const loanRows = [
    ...(rates.loanOrdinary || []),
    ...(rates.loanSpecial || [])
  ];

  return `
<section class="kb-section kb-section--rates" id="home-rates">
  <div class="kb-container">
    <div class="kb-section-head kb-section-head--rates">
      <h2 class="kb-section-title" data-i18n="home.ratesTitle">อัตราดอกเบี้ย</h2>
    </div>
    <div class="kb-rates-v2">
      ${renderRateCard(
        'home.ratesDeposit',
        'อัตราดอกเบี้ยเงินฝาก',
        deposit,
        'deposit',
        'bank',
        'piggy'
      )}
      ${renderRateCard(
        'home.ratesLoan',
        'อัตราดอกเบี้ยเงินกู้',
        loanRows,
        'loan',
        'wallet',
        'card'
      )}
    </div>
  </div>
</section>`;
}

function renderHomeHero() {
  const heroImages = homeHeroImages();
  const front = heroImages[0];
  const back = heroImages.slice(1);
  const layers = [
    { src: back[2], cls: 'kb-hero-v2-stack-card--back-3', chip: true },
    { src: back[1], cls: 'kb-hero-v2-stack-card--back-2' },
    { src: back[0], cls: 'kb-hero-v2-stack-card--back-1' },
    { src: front, cls: 'kb-hero-v2-stack-card--front', caption: true }
  ].filter((layer) => layer.src);

  const stackCards = layers
    .map((layer, i) => {
      const eager = layer.cls.includes('front');
      const chip = layer.chip
        ? `<span class="kb-hero-v2-stack-chip" data-i18n="hero.stackChip">สหกรณ์ • เปิดบริการ</span>`
        : '';
      const caption = layer.caption
        ? `<figcaption class="kb-hero-v2-stack-caption">
        <span class="kb-hero-v2-stack-live" aria-hidden="true"></span>
        <span class="kb-hero-v2-stack-caption-title">${escapeHtml(CMS_SITE.brandTitle || 'NKBKCOOP')}</span>
        <span class="kb-hero-v2-stack-caption-sub" data-i18n="hero.stackCaption">สหกรณ์ฯ หนองคาย</span>
        <span class="kb-hero-v2-stack-caption-meta" data-i18n="hero.stackMeta">บริการครบ • โปร่งใส</span>
      </figcaption>`
        : '';
      return `<figure class="kb-hero-v2-stack-card ${layer.cls}">
        <img src="${layer.src}" alt="" width="640" height="420" loading="${eager ? 'eager' : 'lazy'}">
        ${chip}
        ${caption}
      </figure>`;
    })
    .join('');

  const stackFloats = `
    <div class="kb-hero-v2-float kb-hero-v2-float--tl">
      <span class="kb-hero-v2-float-icon kb-hero-v2-float-icon--violet">${kbIcon('shield', 18)}</span>
      <div>
        <strong data-i18n="hero.floatSecureTitle">บริการออนไลน์</strong>
        <span data-i18n="hero.floatSecureSub">พร้อมใช้งานทุกวัน</span>
      </div>
    </div>
    <div class="kb-hero-v2-float kb-hero-v2-float--br">
      <span class="kb-hero-v2-float-icon kb-hero-v2-float-icon--pink">${kbIcon('users', 18)}</span>
      <div>
        <strong data-i18n="hero.floatMembersTitle">สมาชิก 3,285+</strong>
        <span data-i18n="hero.floatMembersSub">ทั่วจังหวัดหนองคาย</span>
      </div>
    </div>`;
  const stats = CMS_SITE.homeStats || [];
  const statsHtml = stats
    .map(
      (s) => `
    <div class="kb-stat-card kb-stat-card--${s.tone || 'pink'}">
      <span class="kb-stat-icon">${kbIcon(s.icon, 22)}</span>
      <div>
        <span class="kb-stat-label">${escapeHtml(homeStatLabel(s))}</span>
        <strong class="kb-stat-value">${escapeHtml(s.value)}<span class="kb-stat-suffix">${escapeHtml(homeStatSuffix(s))}</span></strong>
      </div>
    </div>`
    )
    .join('');

  return `
<section class="kb-hero-v2" style="--kb-hero-photo: url('${front}')">
  <div class="kb-hero-v2-photo" aria-hidden="true"></div>
  <div class="kb-hero-v2-waves" aria-hidden="true"></div>
  <div class="kb-container kb-hero-v2-inner">
    <div class="kb-hero-v2-grid">
      <div class="kb-hero-v2-copy">
        <p class="kb-hero-v2-tag" data-i18n="hero.tagline">มั่นคง โปร่งใส ใส่ใจสมาชิก</p>
        <h1 class="kb-hero-v2-title" data-i18n="hero.headline" data-i18n-html>สหกรณ์ออมทรัพย์<br><span class="kb-hero-v2-title-accent">สาธารณสุขหนองคาย จำกัด</span></h1>
        <p class="kb-hero-v2-sub" data-i18n="hero.sub">สหกรณ์ออมทรัพย์เพื่อสวัสดิการสมาชิก...</p>
        <div class="kb-hero-v2-actions">
          <a href="${CmsLayout.menuUrl('/app/')}" class="kb-btn kb-btn-primary">
            ${kbIcon('download', 18)}<span data-i18n="hero.ctaApp">ดาวน์โหลด NKBKConnext</span>
          </a>
        </div>
      </div>
      <div class="kb-hero-v2-visual">
        <div class="kb-hero-v2-visual-glow" aria-hidden="true"></div>
        <div class="kb-hero-v2-stack-scene">
          <div class="kb-hero-v2-stack-mesh" aria-hidden="true"></div>
          <div class="kb-hero-v2-stack">
            ${stackCards}
            ${stackFloats}
          </div>
        </div>
      </div>
    </div>
    <div class="kb-hero-v2-glass">
      <div class="kb-hero-v2-stats">${statsHtml}</div>
      <aside class="kb-hero-v2-badge">
        <span class="kb-hero-v2-badge-icon">${kbIcon('shield', 28)}</span>
        <div>
          <strong data-i18n="hero.badgeTitle">มั่นคง โปร่งใส</strong>
          <span data-i18n="hero.badgeSub">ใส่ใจบริการเพื่อสมาชิก</span>
        </div>
      </aside>
    </div>
  </div>
</section>`;
}

function renderHomeLegacySections() {
  return `
<section class="kb-section" id="home-services">
  <div class="kb-container">
    <h2 class="kb-section-title" data-i18n="home.servicesTitle">บริการยอดนิยม</h2>
    <div class="kb-services">
      <a href="${CmsLayout.menuUrl('/infrom-payment/')}" class="kb-service-card"><div class="kb-service-icon kb-service-icon--payment">${kbIcon('svc-payment', 26)}</div><h3 data-i18n="nav.payment">แจ้งโอนเงิน</h3></a>
      <a href="${CmsLayout.menuUrl('/download/')}" class="kb-service-card"><div class="kb-service-icon kb-service-icon--download">${kbIcon('svc-download', 26)}</div><h3 data-i18n="nav.download">ดาวน์โหลด</h3></a>
      <a href="/news" class="kb-service-card"><div class="kb-service-icon kb-service-icon--news">${kbIcon('svc-news', 26)}</div><h3 data-i18n="nav.news">ข่าวสาร</h3></a>
      <a href="${CmsLayout.menuUrl('/contact/')}" class="kb-service-card"><div class="kb-service-icon kb-service-icon--contact">${kbIcon('svc-contact', 26)}</div><h3 data-i18n="nav.contact">ติดต่อเรา</h3></a>
    </div>
  </div>
</section>
${renderHomeRatesSection()}
<section class="kb-section kb-section--news">
  <div class="kb-container">
    <div class="kb-section-head">
      <h2 class="kb-section-title" data-i18n="home.newsTitle">ข่าวสารและประกาศ</h2>
      <a href="/news" class="kb-btn kb-btn-primary kb-btn-sm" data-i18n="home.newsMore">ดูข่าวทั้งหมด</a>
    </div>
    <div id="homeNewsGrid" class="kb-news-grid kb-news-grid--compact">${CmsLayout.renderLoading()}</div>
  </div>
</section>
${renderHomePartnersSection()}`;
}

function renderHomePage() {
  return renderHomeHero() + renderHomeLegacySections();
}
