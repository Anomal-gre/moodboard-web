const LEGACY_QUEUE_KEY = 'mosaOfflineQueue';
const MAX_QUEUE_ITEMS = 24;
const MAX_QUEUE_BASE64_BYTES = 96 * 1024 * 1024;
let clipperDb;
let queuedOperation = Promise.resolve();

function openClipperDb() {
  if (!clipperDb) {
    clipperDb = new Promise((resolve, reject) => {
      const request = indexedDB.open('mosa-clipper', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('state');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch((error) => {
      clipperDb = undefined;
      throw error;
    });
  }
  return clipperDb;
}

async function readClipQueue() {
  const db = await openClipperDb();
  const saved = await new Promise((resolve, reject) => {
    const request = db.transaction('state').objectStore('state').get('queue');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  if (Array.isArray(saved)) return saved;

  const legacy = (await chrome.storage.local.get(LEGACY_QUEUE_KEY))[LEGACY_QUEUE_KEY];
  const queue = Array.isArray(legacy) ? legacy.filter((item) => isMosaProjectId(item?.id)) : [];
  await writeClipQueue(queue);
  if (queue.length) await chrome.storage.local.remove(LEGACY_QUEUE_KEY).catch(() => undefined);
  return queue;
}

async function writeClipQueue(queue) {
  const db = await openClipperDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('state', 'readwrite');
    tx.objectStore('state').put(queue, 'queue');
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error || new Error('Clip queue transaction aborted'));
  });
}

function useClipQueue(update) {
  const next = queuedOperation.then(async () => {
    const before = await readClipQueue();
    if (!update) return before;
    const after = update(before);
    if (after !== before) await writeClipQueue(after);
    return after;
  });
  queuedOperation = next.catch(() => undefined);
  return next;
}

function enqueueWebClip(clip) {
  return useClipQueue((queue) => {
    if (queue.some((item) => item.id === clip.id)) return queue;
    const size = queue.reduce((total, item) => total + (item.imageBase64?.length || 0), clip.imageBase64?.length || 0);
    if (queue.length >= MAX_QUEUE_ITEMS || size > MAX_QUEUE_BASE64_BYTES) throw new Error('Clip queue is full');
    return [...queue, clip];
  });
}
