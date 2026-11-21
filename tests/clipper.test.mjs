import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { IDBFactory } from 'fake-indexeddb';
import { unzipSync } from 'fflate';

const source = new URL('../mosa-clipper/', import.meta.url);
const script = (name) => readFileSync(new URL(name, source), 'utf8');

function fakeWorker(indexedDB, legacyItems = []) {
  const stored = { mosaOfflineQueue: legacyItems };
  const trustedTab = 'https://anomal-gre.github.io/moodboard-web/';
  let destination = { projectId: 'design_a', projectName: 'First project' };
  let receipt;
  const deliveries = [];
  const listeners = [];
  const event = () => ({ addListener() {} });
  const worker = vm.createContext({
    indexedDB, URL, AbortSignal, crypto, Buffer, setTimeout, clearTimeout,
    chrome: {
      action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
      alarms: { get: async () => true, create: async () => {}, onAlarm: event() },
      contextMenus: { onClicked: event() },
      runtime: {
        onStartup: event(), onInstalled: event(), id: 'clipper',
        onMessage: { addListener: (listener) => listeners.push(listener) },
        getURL: (path) => 'chrome-extension://clipper/' + path,
      },
      storage: {
        local: {
          get: async (key) => ({ [key]: stored[key] }),
          set: async (patch) => { Object.assign(stored, patch); },
          remove: async (key) => { delete stored[key]; },
        },
      },
      tabs: {
        query: async () => [
          { id: 10, url: 'https://example.test/moodboard-web/', active: true },
          { id: 11, url: trustedTab, active: false },
        ],
        sendMessage: async (id, msg) => {
          assert.equal(id, 11, 'Never send a clip or probe to an untrusted site');
          if (msg.type === 'MOSA_TAB_PING') return { ok: true, version: 2, destination };
          deliveries.push(msg);
          return { receipt };
        },
      },
    },
    importScripts: (...names) => names.forEach((name) => vm.runInContext(script(name), worker)),
  });
  vm.runInContext(script('background.js'), worker);
  return {
    worker, deliveries, legacyRemoved: () => !stored.mosaOfflineQueue,
    setDestination: (next) => { destination = next; },
    setReceipt: (next) => { receipt = next; },
  };
}

test('extension keeps a pending clip across restart and retries to the originally selected project', async () => {
  const db = new IDBFactory();
  const original = { projectId: 'design_a', projectName: 'First project' };
  const other = { projectId: 'design_b', projectName: 'Another board' };
  const input = { id: 'legacy_clip', imageUrl: 'https://example.test/legacy.jpg' };
  const { worker, deliveries, legacyRemoved } = fakeWorker(db, [input]);
  assert.equal((await worker.flushOfflineQueue()).remaining, 1);
  assert.equal(deliveries[0].projectId, original.projectId);
  assert.equal(legacyRemoved(), true);

  const restarted = fakeWorker(db);
  restarted.setDestination(other);
  assert.equal((await restarted.worker.flushOfflineQueue()).remaining, 1);
  assert.equal(restarted.deliveries[0].projectId, original.projectId);
  restarted.setReceipt(original);
  const result = await restarted.worker.flushOfflineQueue();
  assert.equal(result.flushed, 1);
  assert.equal(result.remaining, 0);
  assert.equal(restarted.deliveries[1].clip.id, input.id);
});

test('a full extension queue keeps previously accepted clips', async () => {
  const { worker } = fakeWorker(new IDBFactory());
  const clips = Array.from({ length: 24 }, (_, i) => ({ id: 'clip_' + i, imageUrl: 'https://example.test/image.jpg' }));
  await Promise.all(clips.map((clip) => worker.enqueueWebClip(clip)));
  await assert.rejects(worker.enqueueWebClip({ id: 'overflow' }), /queue is full/);
  assert.deepEqual(Array.from(await worker.useClipQueue(), ({ id }) => id), clips.map(({ id }) => id));
});

test('the official Mosa subdomain is recognized without custom Clipper settings', () => {
  const { worker } = fakeWorker(new IDBFactory());
  assert.equal(worker.trustedMosaUrl('https://mosa.ohwow.win/'), 'https://mosa.ohwow.win/');
  assert.equal(worker.trustedMosaUrl('https://mosa.ohwow.win.example.test/'), '');
});

test('the download ZIP contains the same extension files as the working tree', () => {
  const zipped = unzipSync(readFileSync(new URL('../public/downloads/mosa-clipper.zip', import.meta.url)));
  const files = readdirSync(source, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
  assert.equal(Object.keys(zipped).length, files.length);
  for (const path of Object.keys(zipped)) {
    assert.match(path, /^mosa-clipper\//);
    const bytes = readFileSync(new URL('../' + path, source));
    const expected = /\.(js|json|html|css|md)$/i.test(path)
      ? Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n')) : bytes;
    assert.deepEqual(Buffer.from(zipped[path]), expected);
  }
});
