(function () {
  'use strict';

  const PDFJS_VER = '3.11.174';
  const PDFJS_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + PDFJS_VER;
  const A4_W = 794;
  const A4_H = 1123;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) {
        resolve();
        return;
      }
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function ensurePdfJs() {
    if (window.pdfjsLib) return window.pdfjsLib;
    await loadScript(PDFJS_BASE + '/pdf.min.js');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + '/pdf.worker.min.js';
    return window.pdfjsLib;
  }

  function setLoading(container, msg) {
    container.innerHTML =
      '<p class="pdf-viewer-loading">' + (msg || 'กำลังโหลด PDF...') + '</p>';
  }

  function appendOpenLink(container, url) {
    var link = document.createElement('a');
    link.className = 'pdf-viewer-open';
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'เปิด PDF เต็มจอ';
    container.appendChild(link);
  }

  function pdfLoadUrl(url) {
    try {
      var abs = new URL(url, location.origin).href;
      if (new URL(abs).origin === location.origin) return abs;
      return location.origin + '/api/cms-pdf?url=' + encodeURIComponent(abs);
    } catch (e) {
      return url;
    }
  }

  /** เรนเดอร์ทุกหน้า fit ความกว้าง container (มือถือ) */
  async function renderCanvasFitWidth(container, url) {
    setLoading(container);
    var pdfjsLib = await ensurePdfJs();
    var loadUrl = pdfLoadUrl(url);
    var task = pdfjsLib.getDocument({ url: loadUrl, withCredentials: false });
    var pdf = await task.promise;
    container.innerHTML = '';
    container.classList.add('pdf-viewer--canvas');
    var pagesWrap = document.createElement('div');
    pagesWrap.className = 'pdf-viewer-pages';
    container.appendChild(pagesWrap);

    var cw = container.clientWidth || Math.min(window.innerWidth - 40, A4_W);
    for (var i = 1; i <= pdf.numPages; i++) {
      var page = await pdf.getPage(i);
      var base = page.getViewport({ scale: 1 });
      var scale = cw / base.width;
      var viewport = page.getViewport({ scale: scale });
      var canvas = document.createElement('canvas');
      canvas.className = 'pdf-viewer-page';
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      pagesWrap.appendChild(canvas);
      await page.render({
        canvasContext: canvas.getContext('2d'),
        viewport: viewport
      }).promise;
    }
    appendOpenLink(container, url);
    return true;
  }

  /** fallback: iframe A4 แล้ว scale ลงให้พอดีความกว้างจอ */
  function renderScaledIframe(container, url) {
    container.innerHTML = '';
    container.classList.add('pdf-viewer--mobile-scale');
    var abs = url;
    var scaler = document.createElement('div');
    scaler.className = 'pdf-viewer-scaler';
    var iframe = document.createElement('iframe');
    iframe.src = abs + '#page=1&view=FitH&toolbar=0&navpanes=0&scrollbar=1';
    iframe.title = 'PDF';
    iframe.setAttribute('scrolling', 'auto');
    scaler.appendChild(iframe);
    container.appendChild(scaler);

    function fit() {
      var w = container.clientWidth || Math.min(window.innerWidth - 40, A4_W);
      var scale = w / A4_W;
      iframe.style.width = A4_W + 'px';
      iframe.style.height = A4_H + 'px';
      scaler.style.width = A4_W + 'px';
      scaler.style.height = A4_H + 'px';
      scaler.style.transform = 'scale(' + scale + ')';
      container.style.height = Math.ceil(A4_H * scale) + 'px';
    }
    fit();
    iframe.addEventListener('load', fit);
    if (!container.dataset.scaleBound) {
      container.dataset.scaleBound = '1';
      window.addEventListener('resize', fit);
    }
    appendOpenLink(container, url);
    return true;
  }

  async function renderMobilePdf(container, url) {
    if (!container || !url) return false;
    try {
      return await renderCanvasFitWidth(container, url);
    } catch (e) {
      console.warn('[pdf-mobile]', e.message || e);
      try {
        return renderScaledIframe(container, url);
      } catch (e2) {
        container.innerHTML =
          '<p class="pdf-viewer-error">ไม่สามารถแสดง PDF ในเว็บได้</p>';
        appendOpenLink(container, url);
        return false;
      }
    }
  }

  window.KbPdfMobile = {
    isMobile: function () {
      return window.matchMedia('(max-width: 767px)').matches;
    },
    renderMobilePdf: renderMobilePdf
  };
})();
