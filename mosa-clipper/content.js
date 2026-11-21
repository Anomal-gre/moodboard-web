(() => {
  const MIN_EDGE = 210;
  let hoverEnabled = true;
  let currentLang = 'en';
  let activeImg = null;
  let resetTimer = null;

  function isMosaAppPage() {
    return document.documentElement?.dataset?.mosaApp === '1';
  }

  // Announce extension presence when running on a Mosa web app tab (GitHub Pages, Vercel, or local)
  function notifyMosaTabIfReady() {
    if (!isMosaAppPage()) return;
    window.postMessage({ type: 'MOSA_EXT_HELLO' }, '*');
    chrome.runtime
      .sendMessage({
        type: 'MOSA_APP_OPENED',
        lang: document.documentElement.dataset.mosaLang || null,
        url: window.location.href,
      })
      .catch(() => undefined);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || typeof event.data !== 'object') return;
    if (event.data.type === 'MOSA_APP_READY') {
      notifyMosaTabIfReady();
    }
  });
  setTimeout(notifyMosaTabIfReady, 450);

  const MOSA_ICON_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M11 11H6a4 4 0 0 1-4-4V2h9v9Z"/>
    <path d="M22 11h-9V6a4 4 0 0 1 4-4h5v9Z"/>
    <path d="M11 13h5a4 4 0 0 1 4 4v5h-9v-9Z"/>
    <path d="M2 13h9v5a4 4 0 0 1-4 4H2v-9Z"/>
  </svg>`;

  const CHECK_ICON_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5"/>
  </svg>`;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mosa-clip-hover-btn';
  btn.innerHTML = `${MOSA_ICON_SVG}<span>Mosa</span>`;
  document.documentElement.appendChild(btn);

  function applySettings(s) {
    if (!s) return;
    if (typeof s.hoverButton === 'boolean') hoverEnabled = s.hoverButton;
    if (s.lang === 'vi' || s.lang === 'en') currentLang = s.lang;
    btn.title =
      currentLang === 'vi'
        ? 'Lưu ảnh gốc vào Mosa (hoặc Alt + Click)'
        : 'Save original image to Mosa (or Alt + Click)';
    if (!hoverEnabled) hideBtn();
  }

  chrome.storage.local.get('mosaClipperSettings', (res) => {
    applySettings(res && res.mosaClipperSettings);
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.mosaClipperSettings?.newValue) {
      applySettings(changes.mosaClipperSettings.newValue);
    }
  });

  let toastEl = null;
  let toastTimer = null;

  function showToast(text) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'mosa-clip-toast';
      document.documentElement.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.classList.add('is-visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl && toastEl.classList.remove('is-visible'), 2600);
  }

  function resetBtnLabel() {
    btn.classList.remove('is-saved', 'is-busy');
    btn.innerHTML = `${MOSA_ICON_SVG}<span>Mosa</span>`;
  }

  function hideBtn() {
    activeImg = null;
    btn.classList.remove('is-visible');
  }

  function positionBtn(img) {
    const rect = img.getBoundingClientRect();
    if (rect.width < MIN_EDGE || rect.height < MIN_EDGE) {
      hideBtn();
      return;
    }
    btn.style.top = `${Math.max(8, Math.round(rect.top + 10))}px`;
    btn.style.left = `${Math.max(8, Math.round(rect.left + 10))}px`;
    btn.classList.add('is-visible');
  }

  function clipImageElement(img) {
    const src = img.currentSrc || img.src;
    if (!src) return;
    const title = (img.alt || document.title || '').trim();
    if (resetTimer) clearTimeout(resetTimer);
    btn.classList.add('is-busy');
    btn.innerHTML = `${MOSA_ICON_SVG}<span>…</span>`;

    chrome.runtime.sendMessage(
      {
        type: 'CLIP_IMAGE',
        imageUrl: src,
        pageUrl: window.location.href,
        title,
      },
      (res) => {
        btn.classList.remove('is-busy');
        const isVi = currentLang === 'vi';
        if (chrome.runtime.lastError) {
          resetBtnLabel();
          showToast(isVi ? 'Không thể kết nối tiện ích Mosa' : 'Could not reach Mosa extension');
          return;
        }
        if (res && res.delivered) {
          btn.classList.add('is-saved');
          btn.innerHTML = `${CHECK_ICON_SVG}<span>${isVi ? 'Đã lưu' : 'Saved'}</span>`;
          showToast(isVi ? 'Đã lưu ảnh gốc vào Mosa ✓' : 'Saved original image to Mosa ✓');
        } else {
          btn.classList.add('is-saved');
          btn.innerHTML = `${CHECK_ICON_SVG}<span>${isVi ? 'Đã xếp hàng' : 'Queued'}</span>`;
          showToast(
            isVi
              ? 'Mosa chưa mở · Đã lưu vào hàng chờ'
              : 'Mosa is closed · Saved to sync queue'
          );
        }
        resetTimer = setTimeout(resetBtnLabel, 1400);
      }
    );
  }

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (activeImg) clipImageElement(activeImg);
  });

  document.addEventListener(
    'mouseover',
    (e) => {
      if (!hoverEnabled || isMosaAppPage()) return;
      if (e.target === btn || btn.contains(e.target)) return;
      const img = e.target instanceof HTMLImageElement ? e.target : null;
      if (!img) {
        if (activeImg && !activeImg.contains(e.target)) {
          const r = activeImg.getBoundingClientRect();
          if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
            hideBtn();
          }
        }
        return;
      }
      const rect = img.getBoundingClientRect();
      if (rect.width >= MIN_EDGE && rect.height >= MIN_EDGE && (img.currentSrc || img.src)) {
        if (activeImg !== img) resetBtnLabel();
        activeImg = img;
        positionBtn(img);
      }
    },
    true
  );

  document.addEventListener(
    'click',
    (e) => {
      if (!e.altKey || isMosaAppPage()) return;
      const img = e.target instanceof HTMLImageElement ? e.target : null;
      if (!img) return;
      e.preventDefault();
      e.stopPropagation();
      clipImageElement(img);
    },
    true
  );

  window.addEventListener(
    'scroll',
    () => {
      if (activeImg) positionBtn(activeImg);
    },
    { passive: true }
  );

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return false;

    if (msg.type === 'MOSA_SHOW_TOAST' && msg.text) {
      showToast(msg.text);
      return false;
    }

    if (msg.type === 'MOSA_TAB_PING') {
      if (isMosaAppPage()) {
        window.postMessage({ type: 'MOSA_EXT_HELLO' }, '*');
        sendResponse({
          ok: true,
          app: 'Mosa',
          lang: document.documentElement.dataset.mosaLang || null,
          url: window.location.href,
        });
      } else {
        sendResponse({ ok: false });
      }
      return false;
    }

    if (msg.type === 'MOSA_TAB_PUSH_CLIP' && msg.clip) {
      if (!isMosaAppPage()) {
        sendResponse({ ok: false });
        return false;
      }
      const targetId = msg.clip.id;
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onAck);
        clearTimeout(timeout);
        sendResponse({ ok });
      };
      const onAck = (event) => {
        if (event.source !== window || !event.data) return;
        if (event.data.type === 'MOSA_APP_CLIP_ACK' && event.data.id === targetId) {
          finish(Boolean(event.data.ok));
        }
      };
      const timeout = setTimeout(() => finish(false), 5000);
      window.addEventListener('message', onAck);
      window.postMessage({ type: 'MOSA_EXT_CLIP_PUSH', clip: msg.clip }, '*');
      return true;
    }

    return false;
  });
})();
