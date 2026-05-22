/** หน้าแจ้งโอนเงิน — บัญชีรับโอน + แบบฟอร์ม */
const CMS_PAYMENT_PAGE_ID = '9304';

function escapePaymentHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function paymentIcon(name, size) {
  return window.KbIcon ? KbIcon.wrap(name, '', size || 20) : '';
}

function paymentT(key) {
  return window.CmsI18n ? CmsI18n.t(`payment.${key}`) : key;
}

const PAYMENT_BE_OFFSET = 543;

function todayBeDateStr() {
  const t = new Date();
  const d = String(t.getDate()).padStart(2, '0');
  const m = String(t.getMonth() + 1).padStart(2, '0');
  const y = t.getFullYear() + PAYMENT_BE_OFFSET;
  return `${d}/${m}/${y}`;
}

function parseBeDateStr(s) {
  const m = String(s || '')
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const beYear = parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const ceYear = beYear - PAYMENT_BE_OFFSET;
  if (ceYear < 1900 || ceYear > 2100) return null;
  const dt = new Date(ceYear, month - 1, day);
  if (
    dt.getFullYear() !== ceYear ||
    dt.getMonth() !== month - 1 ||
    dt.getDate() !== day
  ) {
    return null;
  }
  return {
    day,
    month,
    beYear,
    display: `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${beYear}`
  };
}

function isBeDateNotFuture(parsed) {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const d = new Date(parsed.beYear - PAYMENT_BE_OFFSET, parsed.month - 1, parsed.day);
  return d <= end;
}

function maskBeDateInput(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function getPaymentConfig() {
  const c = window.CMS_SITE || {};
  const p = c.payment || {};
  const lang = window.CmsI18n?.getLang() || 'th';
  const isLine =
    (location.pathname || '').replace(/\/+$/, '') === '/infrom-payment-line';
  return {
    banks: p.banks || [],
    transferTypes: p.transferTypes || [],
    lineUrl: c.line || '',
    isLine,
    lang
  };
}

function renderBankIcon(b) {
  if (b.logoUrl) {
    return `<img src="${escapePaymentHtml(b.logoUrl)}" alt="" width="44" height="44" loading="lazy" decoding="async">`;
  }
  return paymentIcon(b.icon || 'bank', 22);
}

function renderBankCards(banks) {
  return banks
    .map(
      (b) => `
<article class="kb-pay-bank-card" data-account="${escapePaymentHtml(b.value)}">
  <div class="kb-pay-bank-icon${b.logoUrl ? ' kb-pay-bank-icon--logo' : ''}" aria-hidden="true">${renderBankIcon(b)}</div>
  <div class="kb-pay-bank-body">
    <p class="kb-pay-bank-name">${escapePaymentHtml(b.label)}</p>
    <p class="kb-pay-bank-acct"><span class="kb-pay-bank-num">${escapePaymentHtml(b.account)}</span>
      <button type="button" class="kb-pay-copy" data-copy="${escapePaymentHtml(b.account)}" title="คัดลอก">${paymentIcon('transfer', 16)}</button>
    </p>
  </div>
</article>`
    )
    .join('');
}

function renderTransferTypeOptions(types) {
  return types
    .map(
      ([val, key]) => `
<label class="kb-pay-type-option">
  <input type="radio" name="transferType" value="${escapePaymentHtml(val)}" required>
  <span class="kb-pay-type-pill" data-i18n="payment.${key}">${escapePaymentHtml(paymentT(key))}</span>
</label>`
    )
    .join('');
}

function renderBankSelectOptions(banks) {
  return banks
    .map(
      (b) =>
        `<option value="${escapePaymentHtml(b.value)}">${escapePaymentHtml(b.label)} — ${escapePaymentHtml(b.account)}</option>`
    )
    .join('');
}

function renderPaymentForm(cfg) {
  const todayBe = todayBeDateStr();
  return `
<form id="kb-payment-form" class="kb-payment-form" novalidate>
  <div class="kb-payment-form-grid">
    <label class="kb-payment-field">
      <span class="kb-payment-label" data-i18n="payment.fieldName">${escapePaymentHtml(paymentT('fieldName'))} <em>*</em></span>
      <input type="text" name="name" required maxlength="120" autocomplete="name">
    </label>
    <label class="kb-payment-field">
      <span class="kb-payment-label" data-i18n="payment.fieldMember">${escapePaymentHtml(paymentT('fieldMember'))}</span>
      <input type="text" name="memberId" maxlength="6" inputmode="numeric" pattern="[0-9]*" placeholder="000000">
    </label>
    <label class="kb-payment-field">
      <span class="kb-payment-label" data-i18n="payment.fieldPhone">${escapePaymentHtml(paymentT('fieldPhone'))} <em>*</em></span>
      <input type="tel" name="phone" required maxlength="20" autocomplete="tel" placeholder="0xx-xxx-xxxx">
    </label>
    <label class="kb-payment-field">
      <span class="kb-payment-label" data-i18n="payment.fieldAmount">${escapePaymentHtml(paymentT('fieldAmount'))} <em>*</em></span>
      <div class="kb-payment-amount-wrap">
        <input type="number" name="amount" required min="1" max="99999999" step="0.01" inputmode="decimal">
        <span class="kb-payment-amount-suffix">฿</span>
      </div>
    </label>
    <fieldset class="kb-payment-field kb-payment-field--full kb-payment-types">
      <legend class="kb-payment-label" data-i18n="payment.fieldType">${escapePaymentHtml(paymentT('fieldType'))} <em>*</em></legend>
      <div class="kb-pay-type-grid">${renderTransferTypeOptions(cfg.transferTypes)}</div>
    </fieldset>
    <label class="kb-payment-field kb-payment-field--full">
      <span class="kb-payment-label" data-i18n="payment.fieldBank">${escapePaymentHtml(paymentT('fieldBank'))} <em>*</em></span>
      <select name="bankAccount" required>
        <option value="" disabled selected data-i18n="payment.fieldBankPlaceholder">${escapePaymentHtml(paymentT('fieldBankPlaceholder'))}</option>
        ${renderBankSelectOptions(cfg.banks)}
      </select>
    </label>
    <label class="kb-payment-field">
      <span class="kb-payment-label" data-i18n="payment.fieldDate">${escapePaymentHtml(paymentT('fieldDate'))} <em>*</em></span>
      <input type="text" name="transferDate" required maxlength="10" inputmode="numeric" autocomplete="off" placeholder="${todayBe}" value="${todayBe}" pattern="\\d{2}/\\d{2}/\\d{4}" title="${escapePaymentHtml(paymentT('fieldDateHint'))}">
      <span class="kb-payment-field-hint" data-i18n="payment.fieldDateHint">${escapePaymentHtml(paymentT('fieldDateHint'))}</span>
    </label>
    <label class="kb-payment-field">
      <span class="kb-payment-label" data-i18n="payment.fieldTime">${escapePaymentHtml(paymentT('fieldTime'))} <em>*</em></span>
      <input type="time" name="transferTime" required>
    </label>
    <label class="kb-payment-field kb-payment-field--full">
      <span class="kb-payment-label" data-i18n="payment.fieldNote">${escapePaymentHtml(paymentT('fieldNote'))}</span>
      <input type="text" name="note" maxlength="500">
    </label>
    <div class="kb-payment-field kb-payment-field--full">
      <span class="kb-payment-label" data-i18n="payment.fieldSlip">${escapePaymentHtml(paymentT('fieldSlip'))}</span>
      <div class="kb-pay-slip-zone" id="kb-pay-slip-zone">
        <input type="file" name="slip" id="kb-pay-slip-input" accept="image/jpeg,image/png,image/webp,image/gif" hidden>
        <div class="kb-pay-slip-placeholder" id="kb-pay-slip-placeholder">
          ${paymentIcon('download', 28)}
          <span data-i18n="payment.slipHint">${escapePaymentHtml(paymentT('slipHint'))}</span>
          <button type="button" class="kb-pay-slip-pick" id="kb-pay-slip-pick" data-i18n="payment.slipPick">${escapePaymentHtml(paymentT('slipPick'))}</button>
        </div>
        <div class="kb-pay-slip-preview hidden" id="kb-pay-slip-preview">
          <img id="kb-pay-slip-img" alt="">
          <button type="button" class="kb-pay-slip-remove" id="kb-pay-slip-remove" title="ลบรูปสลิป" aria-label="ลบรูปสลิป">&times;</button>
        </div>
      </div>
      <p class="kb-pay-slip-meta" data-i18n="payment.slipMax">${escapePaymentHtml(paymentT('slipMax'))}</p>
    </div>
  </div>
  <label class="kb-contact-hp" aria-hidden="true"><input type="text" name="website" tabindex="-1" autocomplete="off"></label>
  <p class="kb-payment-privacy" data-i18n="payment.privacy">${escapePaymentHtml(paymentT('privacy'))}</p>
  <div class="kb-payment-actions">
    <button type="submit" class="kb-payment-submit">
      <span class="kb-payment-submit-text" data-i18n="payment.submit">${escapePaymentHtml(paymentT('submit'))}</span>
    </button>
  </div>
  <p class="kb-payment-status" id="kb-payment-status" role="status" aria-live="polite" hidden></p>
</form>`;
}

function renderPaymentPage() {
  const cfg = getPaymentConfig();
  const lineBanner = cfg.isLine && cfg.lineUrl
    ? `<div class="kb-pay-line-banner">
        <span>${paymentIcon('line', 22)}</span>
        <p data-i18n="payment.lineBanner">${escapePaymentHtml(paymentT('lineBanner'))}</p>
        <a href="${escapePaymentHtml(cfg.lineUrl)}" class="kb-pay-line-btn" target="_blank" rel="noopener">LINE</a>
      </div>`
    : '';

  return `
<div class="kb-page-body kb-page-body--payment">
  <div class="kb-container">
    ${lineBanner}
    <p class="kb-payment-intro" data-i18n="payment.intro">${escapePaymentHtml(paymentT('intro'))}</p>
    <ol class="kb-payment-steps" aria-label="ขั้นตอน">
      <li><span class="kb-payment-step-num">1</span><span data-i18n="payment.step1">${escapePaymentHtml(paymentT('step1'))}</span></li>
      <li><span class="kb-payment-step-num">2</span><span data-i18n="payment.step2">${escapePaymentHtml(paymentT('step2'))}</span></li>
      <li><span class="kb-payment-step-num">3</span><span data-i18n="payment.step3">${escapePaymentHtml(paymentT('step3'))}</span></li>
    </ol>
    <div class="kb-payment-layout">
      <aside class="kb-payment-aside">
        <h2 class="kb-payment-aside-title" data-i18n="payment.accountsTitle">${escapePaymentHtml(paymentT('accountsTitle'))}</h2>
        <p class="kb-payment-aside-hint" data-i18n="payment.accountsHint">${escapePaymentHtml(paymentT('accountsHint'))}</p>
        <div class="kb-pay-bank-list">${renderBankCards(cfg.banks)}</div>
      </aside>
      <section class="kb-payment-form-wrap" aria-labelledby="kb-payment-form-title">
        <h2 id="kb-payment-form-title" class="kb-payment-form-title" data-i18n="payment.formTitle">${escapePaymentHtml(paymentT('formTitle'))}</h2>
        <p class="kb-payment-form-hint" data-i18n="payment.formHint">${escapePaymentHtml(paymentT('formHint'))}</p>
        ${renderPaymentForm(cfg)}
      </section>
    </div>
  </div>
</div>`;
}

function setPaymentStatus(form, type, message) {
  const el = form.querySelector('#kb-payment-status');
  if (!el) return;
  el.hidden = !message;
  el.textContent = message || '';
  el.className = 'kb-payment-status' + (type ? ` is-${type}` : '');
}

async function uploadPaymentSlip(file) {
  if (!file || !window.firebase?.storage) return { url: '', path: '' };
  const max = 5 * 1024 * 1024;
  if (file.size > max) throw new Error(paymentT('slipTooBig'));
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `cms_payment_slips/${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const ref = firebase.storage().ref(path);
  await ref.put(file, { contentType: file.type || 'image/jpeg' });
  const url = await ref.getDownloadURL();
  return { url, path };
}

function bindPaymentForm(root) {
  const form = root?.querySelector('#kb-payment-form');
  if (!form) return;

  const slipInput = form.querySelector('#kb-pay-slip-input');
  const slipPick = form.querySelector('#kb-pay-slip-pick');
  const slipZone = form.querySelector('#kb-pay-slip-zone');
  const slipPlaceholder = form.querySelector('#kb-pay-slip-placeholder');
  const slipPreview = form.querySelector('#kb-pay-slip-preview');
  const slipImg = form.querySelector('#kb-pay-slip-img');
  const slipRemove = form.querySelector('#kb-pay-slip-remove');

  function clearSlip() {
    if (slipInput) slipInput.value = '';
    slipPreview?.classList.add('hidden');
    slipPlaceholder?.classList.remove('hidden');
    if (slipImg) slipImg.removeAttribute('src');
  }

  slipPick?.addEventListener('click', () => slipInput?.click());
  slipZone?.addEventListener('click', (e) => {
    if (e.target.closest('.kb-pay-slip-remove') || e.target.closest('.kb-pay-slip-pick')) return;
    if (!slipPreview?.classList.contains('hidden')) return;
    slipInput?.click();
  });
  slipInput?.addEventListener('change', () => {
    const file = slipInput.files?.[0];
    if (!file) return clearSlip();
    const url = URL.createObjectURL(file);
    if (slipImg) slipImg.src = url;
    slipPlaceholder?.classList.add('hidden');
    slipPreview?.classList.remove('hidden');
  });
  slipRemove?.addEventListener('click', (e) => {
    e.stopPropagation();
    clearSlip();
  });

  const dateInput = form.querySelector('[name="transferDate"]');
  if (dateInput && !dateInput.value) dateInput.value = todayBeDateStr();
  dateInput?.addEventListener('input', () => {
    const pos = dateInput.selectionStart;
    const before = dateInput.value.length;
    dateInput.value = maskBeDateInput(dateInput.value);
    const after = dateInput.value.length;
    const next = Math.max(0, (pos || 0) + (after - before));
    try {
      dateInput.setSelectionRange(next, next);
    } catch (_) {
      /* ignore */
    }
  });

  root.querySelectorAll('.kb-pay-copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const text = btn.getAttribute('data-copy') || '';
      try {
        await navigator.clipboard.writeText(text);
        btn.classList.add('is-copied');
        setTimeout(() => btn.classList.remove('is-copied'), 1200);
      } catch (_) {
        window.prompt('คัดลอกเลขบัญชี:', text);
      }
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('.kb-payment-submit');
    const btnText = form.querySelector('.kb-payment-submit-text');
    const fd = new FormData(form);
    if ((fd.get('website') || '').trim()) return;

    const name = String(fd.get('name') || '').trim();
    const memberId = String(fd.get('memberId') || '').trim();
    const phone = String(fd.get('phone') || '').trim();
    const amount = Number(fd.get('amount'));
    const transferType = String(fd.get('transferType') || '');
    const bankAccount = String(fd.get('bankAccount') || '');
    const transferDateRaw = String(fd.get('transferDate') || '').trim();
    const transferTime = String(fd.get('transferTime') || '');
    const note = String(fd.get('note') || '').trim();
    const slipFile = slipInput?.files?.[0];
    const parsedDate = parseBeDateStr(transferDateRaw);

    if (!name || !phone || !transferType || !bankAccount || !transferTime || !amount) {
      setPaymentStatus(form, 'error', paymentT('required'));
      return;
    }
    if (!parsedDate) {
      setPaymentStatus(form, 'error', paymentT('dateInvalid'));
      return;
    }
    if (!isBeDateNotFuture(parsedDate)) {
      setPaymentStatus(form, 'error', paymentT('dateFuture'));
      return;
    }
    const transferDate = parsedDate.display;

    if (!window.db || !window.firebase) {
      setPaymentStatus(form, 'error', paymentT('error'));
      return;
    }

    btn.disabled = true;
    if (btnText) btnText.textContent = paymentT('sending');
    setPaymentStatus(form, '', '');

    try {
      let slipUrl = '';
      let slipPath = '';
      if (slipFile) {
        const up = await uploadPaymentSlip(slipFile);
        slipUrl = up.url;
        slipPath = up.path;
      }
      const cfg = getPaymentConfig();
      await window.db.collection('cms_payment_notifications').add({
        name,
        memberId,
        phone,
        amount,
        transferType,
        bankAccount,
        transferDate,
        transferTime,
        note,
        slipUrl,
        slipPath,
        status: 'pending',
        source: cfg.isLine ? 'line' : 'web',
        lang: cfg.lang,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      form.reset();
      clearSlip();
      const dateEl = form.querySelector('[name="transferDate"]');
      if (dateEl) dateEl.value = todayBeDateStr();
      setPaymentStatus(form, 'success', paymentT('success'));
    } catch (err) {
      setPaymentStatus(form, 'error', err.message === paymentT('slipTooBig') ? paymentT('slipTooBig') : paymentT('error'));
    } finally {
      btn.disabled = false;
      if (btnText) btnText.textContent = paymentT('submit');
    }
  });
}

window.CmsPaymentPage = {
  CMS_PAYMENT_PAGE_ID,
  renderPaymentPage,
  bindPaymentForm
};
