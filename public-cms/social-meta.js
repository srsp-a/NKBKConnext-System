/** Open Graph / Twitter — อัปเดต meta ฝั่งเบราว์เซอร์ ( crawler ใช้ static + cmsOg function ) */
(function () {
  const FALLBACK_IMAGE =
    'https://res.cloudinary.com/dzs7zbikj/image/upload/c_pad,b_white,w_1200,h_630,f_jpg,q_auto/v1770613894/site-config/vd64o0efi0hdpetkzyrf.png';

  function cfg() {
    return (window.CMS_SITE && window.CMS_SITE.og) || {};
  }

  function defaultImage() {
    return cfg().image || FALLBACK_IMAGE;
  }

  function setMeta(key, content, isProperty) {
    if (!content) return;
    const attr = isProperty ? 'property' : 'name';
    let el = document.querySelector(`meta[${attr}="${key}"]`);
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute(attr, key);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  }

  function absoluteUrl(url) {
    if (!url) return '';
    const u = String(url).trim();
    if (/^https?:\/\//i.test(u)) return u;
    try {
      return new URL(u, location.origin).href;
    } catch {
      return u;
    }
  }

  function firstImgFromHtml(html) {
    const m = String(html || '').match(/<img[^>]+src=["']([^"']+)["']/i);
    return m ? absoluteUrl(m[1]) : '';
  }

  function stripHtml(s) {
    return String(s || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function apply(opts) {
    const o = opts || {};
    const siteName = cfg().siteName || (window.CMS_SITE && CMS_SITE.tabTitle) || 'NKBKCOOP';
    const title = o.title || siteName;
    const description =
      o.description || cfg().description || siteName;
    const image = absoluteUrl(o.image) || defaultImage();
    const url = o.url || location.href;

    if (o.documentTitle) document.title = o.documentTitle;
    setMeta('description', description);
    setMeta('og:type', o.type || 'website', true);
    setMeta('og:site_name', siteName, true);
    setMeta('og:title', title, true);
    setMeta('og:description', description, true);
    setMeta('og:image', image, true);
    setMeta('og:url', url, true);
    setMeta('twitter:card', 'summary_large_image');
    setMeta('twitter:title', title);
    setMeta('twitter:description', description);
    setMeta('twitter:image', image);
  }

  window.CmsSocial = {
    apply,
    firstImgFromHtml,
    stripHtml,
    defaultImage,
    absoluteUrl
  };
})();
