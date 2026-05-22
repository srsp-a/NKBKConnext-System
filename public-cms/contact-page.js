/** หน้าติดต่อเรา — การ์ดข้อมูล + แผนที่ + แบบฟอร์ม */
const CMS_CONTACT_PAGE_ID = '354';

function escapeContactHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function contactIcon(name) {
  return window.KbIcon ? KbIcon.wrap(name, '', 22) : '';
}

function contactT(key) {
  return window.CmsI18n ? CmsI18n.t(`contact.${key}`) : key;
}

function getContactData() {
  const c = window.CMS_SITE || {};
  const ct = c.contact || {};
  const lang = window.CmsI18n?.getLang() || 'th';
  const mobile = Array.isArray(ct.mobile) ? ct.mobile : [];
  const mapEmbed =
    ct.mapEmbed ||
    'https://www.google.com/maps?q=17.8675463,102.7564733&hl=th&z=16&output=embed';
  return {
    orgName: lang === 'en' ? c.nameEn || c.name : c.name,
    hours: lang === 'en' ? ct.hoursEn || ct.hoursTh : ct.hoursTh || ct.hoursEn,
    address: lang === 'en' ? c.addressEn || c.address : c.address,
    email: c.email,
    phone: c.phoneDisplay || c.phone,
    phoneTel: c.phone || '',
    fax: ct.fax,
    mobile,
    mapUrl: c.mapUrl || 'https://maps.app.goo.gl/FhT4ThAC2VPwt7dm9',
    mapEmbed,
    facebook: c.facebook,
    line: c.line,
    youtube: c.youtube,
    privacyPath: '/privacy-policy'
  };
}

function renderContactCard(iconName, label, bodyHtml) {
  return `
<article class="kb-contact-card">
  <div class="kb-contact-card-icon" aria-hidden="true">${contactIcon(iconName)}</div>
  <div class="kb-contact-card-body">
    <h3 class="kb-contact-card-label">${escapeContactHtml(label)}</h3>
    <div class="kb-contact-card-value">${bodyHtml}</div>
  </div>
</article>`;
}

function renderContactForm() {
  const topics = [
    ['general', 'topicGeneral'],
    ['deposit', 'topicDeposit'],
    ['loan', 'topicLoan'],
    ['app', 'topicApp'],
    ['other', 'topicOther']
  ];
  const options = topics
    .map(
      ([val, key]) =>
        `<option value="${val}">${escapeContactHtml(contactT(key))}</option>`
    )
    .join('');

  return `
<form id="kb-contact-form" class="kb-contact-form" novalidate>
  <div class="kb-contact-form-grid">
    <label class="kb-contact-field kb-contact-field--full">
      <span class="kb-contact-field-label" data-i18n="contact.fieldName">${escapeContactHtml(contactT('fieldName'))} <em>*</em></span>
      <input type="text" name="name" required maxlength="120" autocomplete="name" placeholder="${escapeContactHtml(contactT('fieldName'))}">
    </label>
    <label class="kb-contact-field">
      <span class="kb-contact-field-label" data-i18n="contact.fieldEmail">${escapeContactHtml(contactT('fieldEmail'))} <em>*</em></span>
      <input type="email" name="email" required maxlength="120" autocomplete="email" placeholder="example@email.com">
    </label>
    <label class="kb-contact-field">
      <span class="kb-contact-field-label" data-i18n="contact.fieldPhone">${escapeContactHtml(contactT('fieldPhone'))}</span>
      <input type="tel" name="phone" maxlength="30" autocomplete="tel" placeholder="08x-xxx-xxxx">
    </label>
    <label class="kb-contact-field kb-contact-field--full">
      <span class="kb-contact-field-label" data-i18n="contact.fieldTopic">${escapeContactHtml(contactT('fieldTopic'))} <em>*</em></span>
      <select name="topic" required>${options}</select>
    </label>
    <label class="kb-contact-field kb-contact-field--full">
      <span class="kb-contact-field-label" data-i18n="contact.fieldMessage">${escapeContactHtml(contactT('fieldMessage'))} <em>*</em></span>
      <textarea name="message" required rows="5" maxlength="5000" placeholder="${escapeContactHtml(contactT('fieldMessage'))}"></textarea>
    </label>
  </div>
  <label class="kb-contact-hp" aria-hidden="true">
    <input type="text" name="website" tabindex="-1" autocomplete="off">
  </label>
  <p class="kb-contact-form-privacy" data-i18n="contact.privacy">${escapeContactHtml(contactT('privacy'))}</p>
  <div class="kb-contact-form-actions">
    <button type="submit" class="kb-contact-submit">
      <span class="kb-contact-submit-text" data-i18n="contact.submit">${escapeContactHtml(contactT('submit'))}</span>
    </button>
  </div>
  <p class="kb-contact-form-status" id="kb-contact-status" role="status" aria-live="polite" hidden></p>
</form>`;
}

function renderContactPage() {
  const d = getContactData();
  const phoneLines = [];
  if (d.phone) {
    const tel = d.phoneTel || d.phone.replace(/[^\d+]/g, '');
    phoneLines.push(
      `<a href="tel:${escapeContactHtml(tel)}">${escapeContactHtml(d.phone)}</a>`
    );
  }
  if (d.fax) {
    phoneLines.push(
      `<span class="kb-contact-fax"><span class="kb-contact-inline-label" data-i18n="contact.faxLabel">${contactT('faxLabel')}</span> ${escapeContactHtml(d.fax)}</span>`
    );
  }
  const mobileHtml = d.mobile.length
    ? d.mobile
        .map((num) => {
          const tel = num.replace(/[^\d+]/g, '');
          return `<a href="tel:${escapeContactHtml(tel)}">${escapeContactHtml(num)}</a>`;
        })
        .join('<span class="kb-contact-sep"> · </span>')
    : '';

  const cards = [
    renderContactCard(
      'clock',
      contactT('hoursLabel'),
      `<p>${escapeContactHtml(d.hours || '')}</p>`
    ),
    renderContactCard(
      'map-pin',
      contactT('addressLabel'),
      `<p>${escapeContactHtml(d.address || '')}</p>`
    ),
    renderContactCard(
      'mail',
      contactT('emailLabel'),
      d.email
        ? `<a href="mailto:${escapeContactHtml(d.email)}">${escapeContactHtml(d.email)}</a>`
        : ''
    ),
    renderContactCard(
      'phone',
      contactT('phoneLabel'),
      `<div class="kb-contact-phones">${phoneLines.join('')}${mobileHtml ? `<div class="kb-contact-mobile"><span class="kb-contact-inline-label" data-i18n="contact.mobileLabel">${contactT('mobileLabel')}</span> ${mobileHtml}</div>` : ''}</div>`
    )
  ].join('');

  const social = [
    d.facebook
      ? `<a href="${escapeContactHtml(d.facebook)}" class="kb-contact-social-link" target="_blank" rel="noopener noreferrer" aria-label="Facebook">${window.KbIcon ? KbIcon.brand('facebook', 20) : 'Facebook'}</a>`
      : '',
    d.line
      ? `<a href="${escapeContactHtml(d.line)}" class="kb-contact-social-link" target="_blank" rel="noopener noreferrer" aria-label="LINE">${window.KbIcon ? KbIcon.brand('line', 20) : 'LINE'}</a>`
      : '',
    d.youtube
      ? `<a href="${escapeContactHtml(d.youtube)}" class="kb-contact-social-link" target="_blank" rel="noopener noreferrer" aria-label="YouTube">${window.KbIcon ? KbIcon.brand('youtube', 20) : 'YouTube'}</a>`
      : ''
  ]
    .filter(Boolean)
    .join('');

  return `
<div class="kb-page-body kb-page-body--contact">
  <div class="kb-container">
    <p class="kb-contact-intro" data-i18n="contact.intro">${escapeContactHtml(contactT('intro'))}</p>
    <div class="kb-contact-layout">
      <div class="kb-contact-main">
        <div class="kb-contact-org">
          <h2 class="kb-contact-org-name">${escapeContactHtml(d.orgName || '')}</h2>
        </div>
        <div class="kb-contact-cards">${cards}</div>
        ${
          social
            ? `<div class="kb-contact-social-block">
          <span class="kb-contact-social-title" data-i18n="contact.followUs">${escapeContactHtml(contactT('followUs'))}</span>
          <div class="kb-contact-social">${social}</div>
        </div>`
            : ''
        }
      </div>
      <aside class="kb-contact-aside">
        <section class="kb-contact-map-wrap" aria-labelledby="kb-contact-map-title">
          <div class="kb-contact-map-head">
            <h2 id="kb-contact-map-title" class="kb-contact-map-title" data-i18n="contact.mapLabel">${escapeContactHtml(contactT('mapLabel'))}</h2>
            <a href="${escapeContactHtml(d.mapUrl)}" class="kb-contact-map-link" target="_blank" rel="noopener noreferrer" data-i18n="contact.mapOpen">${escapeContactHtml(contactT('mapOpen'))}</a>
          </div>
          <div class="kb-contact-map">
            <iframe src="${escapeContactHtml(d.mapEmbed)}" title="${escapeContactHtml(contactT('mapLabel'))}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>
          </div>
        </section>
        <section class="kb-contact-form-wrap" aria-labelledby="kb-contact-form-title">
          <header class="kb-contact-form-head">
            <h2 id="kb-contact-form-title" class="kb-contact-form-title" data-i18n="contact.formTitle">${escapeContactHtml(contactT('formTitle'))}</h2>
            <p class="kb-contact-form-hint" data-i18n="contact.formHint">${escapeContactHtml(contactT('formHint'))}</p>
          </header>
          <div class="kb-contact-form-panel">${renderContactForm()}</div>
        </section>
      </aside>
    </div>
  </div>
</div>`;
}

function setFormStatus(form, type, message) {
  const el = form.querySelector('#kb-contact-status');
  if (!el) return;
  el.hidden = !message;
  el.textContent = message || '';
  el.className = 'kb-contact-form-status' + (type ? ` is-${type}` : '');
}

function rerenderContactPage() {
  if (window._kbLegalPageType) return;
  const main = document.getElementById('cms-page-content');
  if (!main || !document.body.classList.contains('kb-page--contact')) return;
  main.innerHTML = renderContactPage();
  bindContactForm(main);
  const title = window.CmsI18n ? CmsI18n.t('nav.contact') : 'ติดต่อเรา';
  window.CmsLayout?.setPageTitle?.(title, '');
  window.CmsI18n?.applyTranslations();
  window.CmsLayout?.refreshFooterLocale?.();
}

function bindContactLang(root) {
  if (!root || window._kbContactLangInit) return;
  window._kbContactLangInit = true;
  window.addEventListener('cms:langchange', rerenderContactPage);
}

function bindContactForm(root) {
  const form = root?.querySelector('#kb-contact-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('.kb-contact-submit');
    const btnText = form.querySelector('.kb-contact-submit-text');
    const fd = new FormData(form);

    if ((fd.get('website') || '').trim()) return;

    const name = String(fd.get('name') || '').trim();
    const email = String(fd.get('email') || '').trim();
    const phone = String(fd.get('phone') || '').trim();
    const topic = String(fd.get('topic') || 'general');
    const message = String(fd.get('message') || '').trim();

    if (!name || !email || !message) {
      setFormStatus(form, 'error', contactT('required'));
      return;
    }

    if (!window.db || !window.firebase) {
      setFormStatus(form, 'error', contactT('error'));
      return;
    }

    btn.disabled = true;
    if (btnText) btnText.textContent = contactT('sending');
    setFormStatus(form, '', '');

    try {
      await window.db.collection('cms_contact_inquiries').add({
        name,
        email,
        phone: phone || '',
        topic,
        message,
        lang: window.CmsI18n?.getLang() || 'th',
        page: 'contact',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      form.reset();
      setFormStatus(form, 'success', contactT('success'));
    } catch (err) {
      setFormStatus(form, 'error', contactT('error'));
    } finally {
      btn.disabled = false;
      if (btnText) btnText.textContent = contactT('submit');
    }
  });
}

window.CmsContactPage = {
  CMS_CONTACT_PAGE_ID,
  getContactData,
  renderContactPage,
  bindContactForm,
  bindContactLang
};
