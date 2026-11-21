const MOSA_ENDPOINTS = ['http://127.0.0.1:4313', 'http://localhost:4313'];
const DEFAULT_DEPLOYED_MOSA_URL = 'https://anomal-gre.github.io/moodboard-web/';
const QUEUE_KEY = 'mosaOfflineQueue';
const SETTINGS_KEY = 'mosaClipperSettings';
const MAX_QUEUE_ITEMS = 24;

const DEFAULT_SETTINGS = {
  category: 'other',
  hoverButton: true,
  lang: 'en',
  langManual: false,
};

function getContextMenuTitle(lang) {
  return lang === 'vi' ? 'Lưu ảnh vào Mosa' : 'Save image to Mosa';
}

async function syncContextMenuTitle(lang) {
  try {
    await chrome.contextMenus.update('mosa-save-image', {
      title: getContextMenuTitle(lang),
    });
  } catch {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: 'mosa-save-image',
        title: getContextMenuTitle(lang),
        contexts: ['image'],
      });
    });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    const settings = await getSettings();
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: 'mosa-save-image',
        title: getContextMenuTitle(settings.lang),
        contexts: ['image'],
      });
    });
    await updateBadge();
  })();
});

async function getSettings() {
  const res = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(res[SETTINGS_KEY] || {}) };
}

async function getQueue() {
  const res = await chrome.storage.local.get(QUEUE_KEY);
  return Array.isArray(res[QUEUE_KEY]) ? res[QUEUE_KEY] : [];
}

async function setQueue(queue) {
  await chrome.storage.local.set({ [QUEUE_KEY]: queue.slice(-MAX_QUEUE_ITEMS) });
  await updateBadge();
}

async function updateBadge() {
  const queue = await getQueue();
  const text = queue.length > 0 ? String(queue.length) : '';
  await chrome.action.setBadgeText({ text });
  if (text) {
    await chrome.action.setBadgeBackgroundColor({ color: '#007aff' });
  }
}

function scoreTabCandidate(tab) {
  const url = (tab.url || '').toLowerCase();
  const title = (tab.title || '').toLowerCase();
  let score = 0;
  if (url.includes('moodboard-web')) score += 5;
  if (url.includes('127.0.0.1:4313') || url.includes('localhost:4313')) score += 4;
  if (title === 'mosa' || title.startsWith('mosa ')) score += 3;
  if (tab.active) score += 1;
  return score;
}

async function findOpenMosaTab() {
  try {
    const tabs = await chrome.tabs.query({});
    const candidates = tabs
      .filter((t) => typeof t.id === 'number' && /^https?:\/\//i.test(t.url || ''))
      .sort((a, b) => scoreTabCandidate(b) - scoreTabCandidate(a));

    for (const tab of candidates) {
      try {
        const resp = await chrome.tabs.sendMessage(tab.id, { type: 'MOSA_TAB_PING' });
        if (resp && resp.ok && resp.app === 'Mosa') {
          return {
            mode: 'tab',
            tabId: tab.id,
            windowId: tab.windowId,
            base: resp.url || tab.url || DEFAULT_DEPLOYED_MOSA_URL,
            appLang: resp.lang === 'vi' || resp.lang === 'en' ? resp.lang : null,
          };
        }
      } catch {
        // Tab has no Mosa content script or is not a Mosa page
      }
    }
  } catch {
    // Ignore tabs query error
  }
  return null;
}

async function probeLocalHttpMosa() {
  for (const base of MOSA_ENDPOINTS) {
    try {
      const res = await fetch(`${base}/__mosa_clip/health`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data && data.ok && data.app === 'Mosa') {
          return {
            mode: 'http',
            base,
            appLang: data.lang === 'vi' || data.lang === 'en' ? data.lang : null,
          };
        }
      }
    } catch {
      // Try next endpoint
    }
  }
  return null;
}

async function probeActiveMosa() {
  // 1. Prefer the running local standalone Mosa app (Edge --app / Tauri / Vite local)
  const local = await probeLocalHttpMosa();
  if (local) return local;

  // 2. Fall back to any open Mosa browser tab (GitHub Pages, Vercel, custom domains)
  const openTab = await findOpenMosaTab();
  if (openTab) return openTab;

  return null;
}

async function deliverClipToProbe(probe, clipPayload) {
  if (probe.mode === 'tab' && typeof probe.tabId === 'number') {
    try {
      const resp = await chrome.tabs.sendMessage(probe.tabId, {
        type: 'MOSA_TAB_PUSH_CLIP',
        clip: clipPayload,
      });
      return Boolean(resp && resp.ok);
    } catch {
      return false;
    }
  }

  try {
    const res = await fetch(`${probe.base}/__mosa_clip/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(clipPayload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function upgradeHighResImageUrl(url) {
  if (!url || typeof url !== 'string') return url;
  if (/^https?:\/\/i\.pinimg\.com\/(?:236x|474x|564x|736x)\//i.test(url)) {
    return url.replace(/\/(?:236x|474x|564x|736x)\//i, '/originals/');
  }
  return url;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function fetchImagePayload(rawImageUrl) {
  const upgraded = upgradeHighResImageUrl(rawImageUrl);
  const candidates = upgraded !== rawImageUrl ? [upgraded, rawImageUrl] : [rawImageUrl];

  for (const url of candidates) {
    try {
      const resp = await fetch(url, { credentials: 'omit' });
      if (!resp.ok) continue;
      const mime = (resp.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
      if (!mime.startsWith('image/')) continue;
      const buf = await resp.arrayBuffer();
      if (buf.byteLength === 0 || buf.byteLength > 28 * 1024 * 1024) continue;
      const ext = mime.includes('png')
        ? 'png'
        : mime.includes('webp')
          ? 'webp'
          : mime.includes('svg')
            ? 'svg'
            : 'jpg';
      return {
        imageBase64: arrayBufferToBase64(buf),
        mime,
        fileName: `mosa-clip-${Date.now()}.${ext}`,
        resolvedUrl: url,
      };
    } catch {
      // Try fallback URL
    }
  }
  return null;
}

async function pushClipToMosa(clipPayload) {
  const probe = await probeActiveMosa();
  if (!probe) {
    const queue = await getQueue();
    queue.push(clipPayload);
    await setQueue(queue);
    return { delivered: false, queued: true, queueCount: queue.length };
  }

  const ok = await deliverClipToProbe(probe, clipPayload);
  if (ok) {
    return { delivered: true, queued: false };
  }

  const queue = await getQueue();
  queue.push(clipPayload);
  await setQueue(queue);
  return { delivered: false, queued: true, queueCount: queue.length };
}

async function flushOfflineQueue() {
  const probe = await probeActiveMosa();
  if (!probe) return { ok: false, flushed: 0, remaining: (await getQueue()).length };

  const queue = await getQueue();
  if (queue.length === 0) return { ok: true, flushed: 0, remaining: 0 };

  const remaining = [];
  let flushed = 0;
  for (const item of queue) {
    const ok = await deliverClipToProbe(probe, item);
    if (ok) flushed++;
    else remaining.push(item);
  }
  await setQueue(remaining);
  return { ok: true, flushed, remaining: remaining.length };
}

async function handleClipImage({ imageUrl, pageUrl, title, note, category }) {
  const settings = await getSettings();
  const fetched = imageUrl.startsWith('data:image/')
    ? {
        imageBase64: imageUrl.split(',')[1] || '',
        mime: imageUrl.slice(5, imageUrl.indexOf(';')) || 'image/png',
        fileName: `mosa-clip-${Date.now()}.png`,
        resolvedUrl: '',
      }
    : await fetchImagePayload(imageUrl);

  const payload = {
    id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    imageBase64: fetched?.imageBase64,
    mime: fetched?.mime || 'image/jpeg',
    fileName: fetched?.fileName || 'mosa-clip.jpg',
    imageUrl: fetched?.resolvedUrl || (imageUrl.startsWith('http') ? imageUrl : ''),
    pageUrl: pageUrl || '',
    title: (title || '').trim() || 'Web Clip',
    note: (note || '').trim(),
    category: category || settings.category || 'other',
    clippedAt: new Date().toISOString(),
  };

  const result = await pushClipToMosa(payload);
  if (result.delivered) {
    void flushOfflineQueue();
  }
  return result;
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'mosa-save-image' || !info.srcUrl) return;
  void (async () => {
    const settings = await getSettings();
    const res = await handleClipImage({
      imageUrl: info.srcUrl,
      pageUrl: info.pageUrl || tab?.url || '',
      title: tab?.title || '',
    });
    if (tab?.id) {
      const isVi = settings.lang === 'vi';
      chrome.tabs
        .sendMessage(tab.id, {
          type: 'MOSA_SHOW_TOAST',
          text: res.delivered
            ? isVi
              ? 'Đã lưu ảnh gốc vào Mosa ✓'
              : 'Saved original image to Mosa ✓'
            : isVi
              ? 'Mosa chưa mở · Đã lưu vào hàng chờ'
              : 'Mosa is closed · Saved to sync queue',
        })
        .catch(() => undefined);
    }
  })();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;

  if (msg.type === 'MOSA_APP_OPENED') {
    void (async () => {
      const stored = await getSettings();
      if ((msg.lang === 'vi' || msg.lang === 'en') && !stored.langManual && stored.lang !== msg.lang) {
        const next = { ...stored, lang: msg.lang };
        await chrome.storage.local.set({ [SETTINGS_KEY]: next });
        await syncContextMenuTitle(next.lang);
      }
      await flushOfflineQueue();
    })();
    return false;
  }

  if (msg.type === 'CLIP_IMAGE') {
    void handleClipImage({
      imageUrl: msg.imageUrl,
      pageUrl: msg.pageUrl || sender.tab?.url || '',
      title: msg.title || sender.tab?.title || '',
      note: msg.note || '',
      category: msg.category,
    }).then((res) => sendResponse(res));
    return true;
  }

  if (msg.type === 'GET_STATUS') {
    void (async () => {
      const [probe, queue, stored] = await Promise.all([
        probeActiveMosa(),
        getQueue(),
        getSettings(),
      ]);

      let settings = stored;
      if (probe?.appLang && !stored.langManual && stored.lang !== probe.appLang) {
        settings = { ...stored, lang: probe.appLang };
        await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
        await syncContextMenuTitle(settings.lang);
      }

      sendResponse({
        connected: Boolean(probe),
        baseUrl: probe?.base || DEFAULT_DEPLOYED_MOSA_URL,
        appLang: probe?.appLang || null,
        queueCount: queue.length,
        settings,
      });
    })();
    return true;
  }

  if (msg.type === 'OPEN_MOSA') {
    void (async () => {
      // 1. If local Mosa server is running, focus the standalone desktop Mosa window directly
      const local = await probeLocalHttpMosa();
      if (local) {
        try {
          const res = await fetch(`${local.base}/__mosa_clip/focus`, { method: 'POST' });
          if (res.ok) {
            const data = await res.json().catch(() => null);
            if (data && data.ok) {
              sendResponse({ ok: true, focused: true, mode: 'app' });
              return;
            }
          }
        } catch {
          // Fall through to tab focus / open
        }
      }

      // 2. Otherwise focus an already-open Mosa browser tab (e.g. GitHub Pages)
      const openTab = await findOpenMosaTab();
      if (openTab && typeof openTab.tabId === 'number') {
        await chrome.tabs.update(openTab.tabId, { active: true });
        if (typeof openTab.windowId === 'number') {
          await chrome.windows.update(openTab.windowId, { focused: true }).catch(() => undefined);
        }
        sendResponse({ ok: true, focused: true, mode: 'tab' });
        return;
      }

      // 3. Last resort: open Mosa web app
      const targetUrl = local?.base || DEFAULT_DEPLOYED_MOSA_URL;
      await chrome.tabs.create({ url: targetUrl });
      sendResponse({ ok: true, focused: false });
    })();
    return true;
  }

  if (msg.type === 'SAVE_SETTINGS') {
    void (async () => {
      const prev = await getSettings();
      const next = { ...prev, ...(msg.settings || {}) };
      await chrome.storage.local.set({ [SETTINGS_KEY]: next });
      if (next.lang !== prev.lang) {
        await syncContextMenuTitle(next.lang);
      }
      sendResponse({ ok: true, settings: next });
    })();
    return true;
  }

  if (msg.type === 'FLUSH_QUEUE') {
    void flushOfflineQueue().then((res) => sendResponse(res));
    return true;
  }

  if (msg.type === 'CAPTURE_VISIBLE_TAB') {
    void (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const dataUrl = await chrome.tabs.captureVisibleTab(undefined, { format: 'png' });
        const res = await handleClipImage({
          imageUrl: dataUrl,
          pageUrl: tab?.url || '',
          title: tab?.title || 'Screenshot',
          category: msg.category,
        });
        sendResponse(res);
      } catch (err) {
        sendResponse({ delivered: false, error: String(err) });
      }
    })();
    return true;
  }

  return false;
});
