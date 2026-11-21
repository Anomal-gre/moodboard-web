importScripts('destinations.js', 'queue.js');

const SETTINGS_KEY = 'mosaClipperSettings';
const RETRY_ALARM = 'retry-mosa-clips';
const MAX_IMAGE_BYTES = 28 * 1024 * 1024;
const MAX_IMAGE_BASE64_LENGTH = 4 * Math.ceil(MAX_IMAGE_BYTES / 3);
const DEFAULT_SETTINGS = {
  category: 'other',
  hoverButton: true,
  lang: 'en',
  langManual: false,
  mosaUrl: '',
  localToken: '',
  lastMosaBase: '',
};

const sending = new Map();
let flushInProgress;

async function ensureRetryAlarm() {
  if (!(await chrome.alarms.get(RETRY_ALARM))) {
    await chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 0.5 });
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM) void flushOfflineQueue().catch(() => undefined);
});
chrome.runtime.onStartup.addListener(() => { void ensureRetryAlarm().catch(() => undefined); });
void ensureRetryAlarm().catch(() => undefined);

async function getSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) };
}

async function updateBadge() {
  const queue = await useClipQueue();
  const text = queue.length ? String(queue.length) : '';
  try {
    await chrome.action.setBadgeText({ text });
    if (text) await chrome.action.setBadgeBackgroundColor({ color: '#007aff' });
  } catch {
    // Badge state is advisory. The queue has already been saved.
  }
}

async function findOpenMosaTabs(settings) {
  const tabs = await chrome.tabs.query({}).catch(() => []);
  const candidates = tabs.flatMap((tab) => {
    const base = trustedMosaUrl(tab.url, settings.mosaUrl);
    return base && typeof tab.id === 'number' ? [{ tab, base }] : [];
  }).sort((a, b) =>
    Number(b.base === settings.mosaUrl) - Number(a.base === settings.mosaUrl) ||
    Number(b.tab.active) - Number(a.tab.active) || (b.tab.lastAccessed || 0) - (a.tab.lastAccessed || 0));

  const matches = await Promise.all(candidates.map(async ({ tab, base }) => {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'MOSA_TAB_PING', version: MOSA_BRIDGE_VERSION }, { frameId: 0 });
      if (response?.version !== MOSA_BRIDGE_VERSION || !response.ok) return null;
      return {
        mode: 'tab', base, tabId: tab.id, windowId: tab.windowId, language: response.lang,
        destination: readMosaDestination(response.destination),
      };
    } catch {
      return null;
    }
  }));
  return matches.filter(Boolean);
}

async function localRequest(base, route, token, body) {
  const response = await fetch(new URL('/__mosa_clip/' + route, base), {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  });
  return response.ok ? response.json() : null;
}

async function probeLocalMosa(settings) {
  if (!settings.localToken) return [];
  const endpoints = await Promise.all(MOSA_LOCAL_ORIGINS.map(async (origin) => {
    try {
      const base = origin + '/';
      const response = await localRequest(base, 'health', settings.localToken);
      if (response?.app !== 'Mosa' || response.version !== MOSA_BRIDGE_VERSION) return null;
      return {
        mode: 'http', base, token: settings.localToken, language: response.language,
        destination: readMosaDestination(response.destination),
      };
    } catch {
      return null;
    }
  }));
  return endpoints.filter(Boolean);
}

async function getMosaProbes(settings) {
  const [tabs, local] = await Promise.all([findOpenMosaTabs(settings), probeLocalMosa(settings)]);
  // A paired local workspace is an explicit destination choice.
  return [...tabs.filter((tab) => tab.base === settings.mosaUrl), ...local,
    ...tabs.filter((tab) => tab.base !== settings.mosaUrl)];
}

function withoutDestination(entry) {
  const { destination, ...clip } = entry;
  return clip;
}

async function deliverClip(probe, entry) {
  const clip = withoutDestination(entry);
  const projectId = entry.destination.projectId;
  try {
    if (probe.mode === 'tab') {
      const response = await chrome.tabs.sendMessage(probe.tabId, {
        type: 'MOSA_TAB_PUSH_CLIP', version: MOSA_BRIDGE_VERSION, clip, projectId,
        base: probe.base, requestId: crypto.randomUUID(),
      }, { frameId: 0 });
      return readMosaDestination(response?.receipt);
    }
    const data = await localRequest(probe.base, 'push', probe.token, { clip, projectId });
    if (data?.status === 'saved') return readMosaDestination(data.receipt);
    if (data?.status !== 'queued') return null;
    for (let check = 0; check < 3; check++) {
      await new Promise((resolve) => setTimeout(resolve, 850));
      const receipt = await localRequest(probe.base, 'receipt', probe.token, { clipId: clip.id });
      if (receipt?.status === 'saved') return readMosaDestination(receipt.receipt);
    }
  } catch {
    // The extension's persisted copy can be retried.
  }
  return null;
}

function deliverQueuedClip(entry, probes) {
  if (sending.has(entry.id)) return sending.get(entry.id);
  const delivery = (async () => {
    let destination = entry.destination;
    if (!destination) {
      const defaultProbe = probes.find((probe) => probe.destination);
      if (!defaultProbe) return { queued: true };
      destination = { ...defaultProbe.destination, base: defaultProbe.base };
      const queue = await useClipQueue((items) => items.map((item) =>
        item.id === entry.id && !item.destination ? { ...item, destination } : item));
      const stored = queue.find((item) => item.id === entry.id);
      if (!stored) return {};
      destination = stored.destination;
    }
    const matching = probes.filter((probe) => probe.base === destination.base).sort((a, b) =>
      Number(b.destination?.projectId === destination.projectId) - Number(a.destination?.projectId === destination.projectId));
    for (const probe of matching) {
      const receipt = await deliverClip(probe, { ...entry, destination });
      if (receipt) {
        await useClipQueue((items) => items.filter((item) => item.id !== entry.id));
        await updateBadge();
        return { delivered: true, projectName: receipt.projectName };
      }
    }
    return { queued: true, projectName: destination.projectName };
  })();
  sending.set(entry.id, delivery);
  const clear = () => sending.delete(entry.id);
  void delivery.then(clear, clear);
  return delivery;
}

function flushOfflineQueue() {
  if (flushInProgress) return flushInProgress;
  const flush = (async () => {
    const queue = await useClipQueue();
    if (!queue.length) return { ok: true, flushed: 0, remaining: 0 };
    const probes = await getMosaProbes(await getSettings());
    let flushed = 0;
    for (const item of queue) {
      const result = await deliverQueuedClip(item, probes);
      if (result.delivered) flushed++;
    }
    return { ok: probes.length > 0, flushed, remaining: (await useClipQueue()).length };
  })();
  flushInProgress = flush;
  const clear = () => { flushInProgress = undefined; };
  void flush.then(clear, clear);
  return flush;
}

function isHttpImageSource(value) {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password;
  } catch {
    return false;
  }
}
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
      const resp = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(15000) });
      if (!resp.ok) continue;
      const mime = (resp.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
      if (!mime.startsWith('image/')) continue;
      const buf = await resp.arrayBuffer();
      if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) continue;
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


async function handleClipImage({ imageUrl, pageUrl, title, note, category }) {
  if (typeof imageUrl !== 'string') return { error: true };
  const settings = await getSettings();
  const probesPromise = getMosaProbes(settings);
  const embedded = /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(imageUrl);
  const validRemote = isHttpImageSource(imageUrl);
  if (!embedded && !validRemote) return { error: true };
  const fetched = embedded ? {
    imageBase64: imageUrl.slice(embedded[0].length),
    mime: embedded[1],
    fileName: 'mosa-clip-' + Date.now() + '.png',
  } : await fetchImagePayload(imageUrl);
  if (embedded && (!fetched.imageBase64 || fetched.imageBase64.length > MAX_IMAGE_BASE64_LENGTH)) return { error: true };
  const clip = {
    id: 'clip_' + crypto.randomUUID(),
    imageBase64: fetched?.imageBase64,
    mime: fetched?.mime || 'image/jpeg',
    fileName: fetched?.fileName || 'mosa-clip.jpg',
    imageUrl: fetched?.resolvedUrl || (validRemote ? imageUrl : ''),
    pageUrl: isHttpImageSource(pageUrl) ? pageUrl : '',
    title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 180) : 'Web Clip',
    note: typeof note === 'string' ? note.trim().slice(0, 800) : '',
    category: category || settings.category || 'other',
    clippedAt: new Date().toISOString(),
  };
  const probes = await probesPromise;
  const probe = probes.find((item) => item.destination);
  const entry = probe ? { ...clip, destination: { ...probe.destination, base: probe.base } } : clip;
  try {
    await enqueueWebClip(entry);
  } catch {
    return { error: true };
  }
  await updateBadge().catch(() => undefined);
  const result = await deliverQueuedClip(entry, probes).catch(() => ({ queued: true, projectName: entry.destination?.projectName }));
  if (result.delivered) void flushOfflineQueue().catch(() => undefined);
  return result;
}

function clipResultText(result, language) {
  const vi = language === 'vi';
  if (result.delivered) return vi ? 'Đã lưu vào ' + result.projectName : 'Saved to ' + result.projectName;
  if (result.queued) {
    if (result.projectName) return vi ? 'Đang chờ lưu vào ' + result.projectName : 'Queued for ' + result.projectName;
    return vi ? 'Ảnh đang chờ dự án Mosa' : 'Queued until a Mosa project is available';
  }
  return vi ? 'Không lưu được ảnh. Hãy đồng bộ hàng chờ rồi thử lại.' : 'Could not save. Sync queued clips and try again.';
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'mosa-save-image' || !info.srcUrl) return;
  void (async () => {
    const settings = await getSettings();
    const result = await handleClipImage({
      imageUrl: info.srcUrl, pageUrl: info.pageUrl || tab?.url, title: tab?.title,
    }).catch(() => ({ error: true }));
    if (tab?.id) {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'MOSA_SHOW_TOAST', text: clipResultText(result, settings.lang),
      }, { frameId: 0 }).catch(() => undefined);
    }
  })().catch(() => undefined);
});

async function updateSettings(patch) {
  const previous = await getSettings();
  const settings = { ...previous, ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  if (settings.lang !== previous.lang) await syncContextMenuTitle(settings.lang);
  return settings;
}

async function handlePopupMessage(message) {
  const settings = await getSettings();
  switch (message.type) {
    case 'GET_STATUS': {
      const [probes, queue] = await Promise.all([getMosaProbes(settings), useClipQueue()]);
      const probe = probes.find((item) => item.destination);
      const language = probe?.language;
      if (!settings.langManual && (language === 'vi' || language === 'en') && settings.lang !== language) {
        await updateSettings({ lang: language });
        settings.lang = language;
      }
      const { localToken, ...safeSettings } = settings;
      return {
        connected: Boolean(probe), destination: probe?.destination, queueCount: queue.length,
        settings: safeSettings, tokenConfigured: Boolean(localToken),
      };
    }
    case 'OPEN_MOSA': {
      const probes = await getMosaProbes(settings);
      const local = probes.find((probe) => probe.mode === 'http');
      if (local) {
        const result = await localRequest(local.base, 'focus', local.token).catch(() => null);
        if (result?.ok) return { ok: true };
      }
      const tab = probes.find((probe) => probe.mode === 'tab');
      if (tab) {
        await chrome.tabs.update(tab.tabId, { active: true });
        if (typeof tab.windowId === 'number') await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
        return { ok: true };
      }
      const target = settings.mosaUrl || probes[0]?.base ||
        trustedMosaUrl(settings.lastMosaBase, settings.mosaUrl) || DEFAULT_DEPLOYED_MOSA_URL;
      await chrome.tabs.create({ url: target });
      return { ok: true };
    }
    case 'SAVE_SETTINGS': {
      const requested = message.settings || {};
      await updateSettings({
        category: typeof requested.category === 'string' ? requested.category : settings.category,
        hoverButton: typeof requested.hoverButton === 'boolean' ? requested.hoverButton : settings.hoverButton,
        lang: requested.lang === 'vi' || requested.lang === 'en' ? requested.lang : settings.lang,
        langManual: typeof requested.langManual === 'boolean' ? requested.langManual : settings.langManual,
      });
      return { ok: true };
    }
    case 'SET_MOSA_CONNECTION': {
      const mosaUrl = normalizeMosaUrl(message.mosaUrl);
      const token = typeof message.token === 'string' ? message.token.trim() : '';
      if (message.mosaUrl && !mosaUrl || token && !/^[A-Za-z0-9_-]{32,128}$/.test(token)) return { ok: false };
      await updateSettings({ mosaUrl, localToken: message.clearToken ? '' : token || settings.localToken });
      void flushOfflineQueue().catch(() => undefined);
      return { ok: true };
    }
    case 'FLUSH_QUEUE':
      return flushOfflineQueue();
    case 'CAPTURE_VISIBLE_TAB': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const imageUrl = await chrome.tabs.captureVisibleTab(undefined, { format: 'png' });
      return handleClipImage({ imageUrl, pageUrl: tab?.url, title: tab?.title || 'Screenshot', category: message.category });
    }
    default:
      return { ok: false };
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message || typeof message !== 'object' || sender.id !== chrome.runtime.id) return false;
  if (message.type === 'MOSA_APP_OPENED') {
    if (sender.frameId !== 0 || message.version !== MOSA_BRIDGE_VERSION) return false;
    void (async () => {
      const settings = await getSettings();
      const base = trustedMosaUrl(sender.url, settings.mosaUrl);
      if (!base) return;
      const language = message.lang;
      const lang = !settings.langManual && (language === 'vi' || language === 'en') ? language : settings.lang;
      if (settings.lastMosaBase !== base || settings.lang !== lang) await updateSettings({ lastMosaBase: base, lang });
      await flushOfflineQueue();
    })().catch(() => undefined);
    return false;
  }
  if (message.type === 'CLIP_IMAGE') {
    if (!sender.tab) return false;
    void handleClipImage({ ...message, pageUrl: sender.url || sender.tab.url, title: message.title || sender.tab.title })
      .then(respond, () => respond({ error: true }));
    return true;
  }
  if (sender.url !== chrome.runtime.getURL('popup.html')) return false;
  void handlePopupMessage(message).then(respond, () => respond({ ok: false, error: true }));
  return true;
});
