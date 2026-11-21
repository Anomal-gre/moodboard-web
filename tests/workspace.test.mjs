import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({
  configFile: false,
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, watch: null, ws: false },
});
after(() => vite.close());

const { createEmptyProject } = await vite.ssrLoadModule('/src/domain/project.ts');
const { loadProject, saveProject, putImageAsset, putRawFileAsset, getAssetBlob } =
  await vite.ssrLoadModule('/src/storage/workspaceRepository.ts');
const { createProjectWriter, getClipReceipt, ProjectConflictError } =
  await vite.ssrLoadModule('/src/storage/projectWrites.ts');
const { exportProjectBackup, parseAndValidateBackupFile, commitImportedBackup } =
  await vite.ssrLoadModule('/src/storage/backup.ts');
const { createClipReceiver } = await vite.ssrLoadModule('/src/features/clipper/receiveWebClip.ts');
const now = '2026-01-01T00:00:00.000Z';

function card(id, kind, extras = {}) {
  return {
    id, kind, title: id, text: '', category: 'other', x: 10, y: 20, w: 240, h: 200, z: 1,
    inbox: false, locked: false, createdAt: now, updatedAt: now, ...extras,
  };
}

// IndexedDB and the production serializers stay real. Node supplies stand-ins for browser image APIs.
globalThis.FileReader = class {
  readAsDataURL(blob) {
    void blob.arrayBuffer().then((bytes) => {
      this.result = 'data:' + blob.type + ';base64,' + Buffer.from(bytes).toString('base64');
      this.onload();
    });
  }
};
globalThis.Image = class {
  naturalWidth = 640;
  naturalHeight = 480;
  set src(_url) { queueMicrotask(() => this.onload()); }
};
globalThis.document = {
  createElement() {
    return {
      getContext: () => ({ fillRect() {}, drawImage() {} }),
      toBlob: (callback, type) => callback(new Blob(['thumbnail'], { type })),
    };
  },
};

test('a second tab cannot overwrite a saved project and can save after loading the latest revision', async () => {
  const initial = createEmptyProject('Two tabs');
  await saveProject(initial);
  const [tabA, tabB] = await Promise.all([loadProject(initial.id), loadProject(initial.id)]);
  const writerA = createProjectWriter();
  const writerB = createProjectWriter();
  await writerA.save({ ...tabA, cards: [card('first', 'note')] });
  await writerB.updateViewOrCover(tabB, { view: { x: 14, y: 21, zoom: 1.1 } });
  await assert.rejects(writerB.save({ ...tabB, cards: [card('stale', 'note')] }), ProjectConflictError);
  const latest = await writerB.reload(initial.id);
  assert.equal(latest.cards[0].id, 'first');
  assert.equal(latest.view.zoom, 1.1);
  await writerB.save({ ...latest, cards: [...latest.cards, card('second', 'note')] });
  assert.deepEqual((await loadProject(initial.id)).cards.map(({ id }) => id), ['first', 'second']);
  await assert.rejects(writerA.remove(tabA), ProjectConflictError);
});

test('same-tab writes serialize and an old snapshot cannot recreate a deleted project', async () => {
  const writer = createProjectWriter();
  const project = createEmptyProject('To remove');
  await writer.save(project);
  const view = { x: 41, y: 45, zoom: 1.5 };
  await Promise.all([writer.save({ ...project, name: 'First' }), writer.save({ ...project, name: 'Second', view })]);
  const stored = await loadProject(project.id);
  assert.equal(stored.name, 'Second');
  assert.deepEqual(stored.view, view);
  await writer.remove(stored);
  await assert.rejects(writer.save(stored), ProjectConflictError);
  assert.equal(await loadProject(project.id), undefined);
});

test('a v1 backup round trip preserves attachments, project metadata, links and references from trash', async () => {
  const pixels = await readFile(new URL('../public/samples/floor-plan.jpg', import.meta.url));
  const original = await putImageAsset(new Blob([pixels], { type: 'image/jpeg' }), 'floor-plan.jpg');
  const variant = await putImageAsset(new Blob([pixels, 'variant'], { type: 'image/jpeg' }), 'floor-variant.jpg');
  const drawing = await putRawFileAsset(new Blob(['test-drawing'], { type: 'application/octet-stream' }), 'plan.dwg');
  const source = {
    ...createEmptyProject('Review presentation'), revision: 9, status: 'approved', pinned: true,
    clientName: 'Sample Studio', projectCode: 'P42', appearance: { background: '#F1F0EB', dots: false, grayscale: true },
    cards: [
      card('group', 'frame'),
      card('image', 'image', {
        groupId: 'group', linksTo: ['drawing', 'recycled'], assetId: variant.id,
        originalAssetId: original.id, aiClassifiedAssetId: variant.id, cutout: true, imageStatus: 'ready',
      }),
      card('drawing', 'file', { assetId: drawing.id, designFile: { extension: 'dwg' } }),
    ],
    trash: [{ removedAt: now, card: card('recycled', 'note', { linksTo: ['image'] }) }],
  };
  const file = new File([await exportProjectBackup(source)], 'project.mosa', { type: 'application/json' });
  const parsed = await parseAndValidateBackupFile(file);
  assert.ok(parsed.ok);
  assert.equal(parsed.data.version, 1);
  assert.equal(parsed.data.project.revision, undefined);
  const imported = await commitImportedBackup(parsed.data);
  const [frame, image, attachment] = imported.cards;
  assert.notEqual(imported.id, source.id);
  assert.equal(imported.clientName, source.clientName);
  assert.equal(imported.projectCode, source.projectCode);
  assert.equal(imported.status, 'approved');
  assert.equal(imported.pinned, true);
  assert.deepEqual(imported.appearance, source.appearance);
  assert.equal(image.groupId, frame.id);
  assert.deepEqual(image.linksTo, [attachment.id, imported.trash[0].card.id]);
  assert.deepEqual(imported.trash[0].card.linksTo, [image.id]);
  assert.equal(image.aiClassifiedAssetId, image.assetId);
  assert.notEqual(image.originalAssetId, original.id);
  assert.deepEqual(Buffer.from(await (await getAssetBlob(image.originalAssetId)).arrayBuffer()), pixels);
  assert.equal(await (await getAssetBlob(attachment.assetId)).text(), 'test-drawing');
  assert.equal((await loadProject(imported.id)).cards.length, 3);
});

test('legacy backup format remains importable with optional fields omitted', async () => {
  const project = createEmptyProject('Original format');
  delete project.trash;
  const file = new File([JSON.stringify({ format: 'moodboard-0y03-backup', version: 1, project, assets: [] })], 'legacy.json');
  const parsed = await parseAndValidateBackupFile(file);
  assert.ok(parsed.ok);
  assert.deepEqual((await commitImportedBackup(parsed.data)).trash, []);
});

test('clip acknowledgement waits for the transaction and replay after receiver reload creates one card', async () => {
  const initial = createEmptyProject('Clip destination');
  const writer = createProjectWriter();
  await writer.save(initial);
  const clip = { id: 'incoming_clip', imageUrl: 'https://example.test/chair.jpg', title: 'Chair' };
  let started;
  let release;
  const committing = new Promise((resolve) => { started = resolve; });
  const permitWrite = new Promise((resolve) => { release = resolve; });
  const receive = createClipReceiver(async (card, projectId, clipId) => {
    started();
    await permitWrite;
    const project = await loadProject(projectId);
    await writer.save({ ...project, cards: [...project.cards, card] }, clipId);
    return true;
  }, () => true);
  const delivery = receive(clip, initial.id);
  const duplicate = receive(clip, initial.id);
  await committing;
  assert.equal(await getClipReceipt(clip.id), undefined);
  assert.equal((await loadProject(initial.id)).cards.length, 0);
  release();
  const expected = { projectId: initial.id, projectName: initial.name };
  assert.deepEqual(await delivery, expected);
  assert.deepEqual(await duplicate, expected);
  const reloadedReceiver = createClipReceiver(() => assert.fail('Replays must not create a card'), () => true);
  assert.deepEqual(await reloadedReceiver(clip, initial.id), expected);
  assert.equal((await loadProject(initial.id)).cards.length, 1);
});

test('a failed clip write has no receipt and remains retryable', async () => {
  const initial = createEmptyProject('Retry destination');
  await saveProject(initial);
  const clip = { id: 'retry_clip', imageUrl: 'https://example.test/material.jpg' };
  const refuse = createClipReceiver(async () => false, () => true);
  assert.equal(await refuse(clip, initial.id), undefined);
  assert.equal(await getClipReceipt(clip.id), undefined);
  const retry = createClipReceiver(async (card, id, clipId) => {
    const current = await loadProject(id);
    await saveProject({ ...current, cards: [...current.cards, card] }, clipId);
    return true;
  }, () => true);
  assert.equal((await retry(clip, initial.id)).projectId, initial.id);
  assert.equal((await loadProject(initial.id)).cards.length, 1);
});

test('a duplicate receipt rolls back the attempted project write', async () => {
  const writer = createProjectWriter();
  const first = createEmptyProject('First destination');
  const other = createEmptyProject('Another destination');
  await writer.save(first, 'existing_receipt');
  await writer.save(other);
  await assert.rejects(writer.save({ ...other, cards: [card('duplicate', 'note')] }, 'existing_receipt'));
  assert.equal((await loadProject(other.id)).cards.length, 0);
  assert.equal((await getClipReceipt('existing_receipt')).projectId, first.id);
});
