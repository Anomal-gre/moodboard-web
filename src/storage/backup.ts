import type {
  AssetBytesRecord,
  AssetMeta,
  BackupAssetEntry,
  BackupFileV1,
  Project,
} from '../domain/types';
import { createId, isValidHttpUrl, normalizeHex, sanitizeCard, validateBackupPayload } from '../domain/validate';
import { clampZoom } from '../domain/geometry';
import { base64ToBlob, blobToBase64, processUploadedImage } from './assets';
import { idbRunTransaction, STORES } from './indexedDb';
import { getAssetBlob, getAssetMeta } from './workspaceRepository';

export const MAX_BACKUP_FILE_BYTES = 100 * 1024 * 1024; // 100 MB
const BACKUP_TOO_LARGE = 'Tệp bản sao vượt quá giới hạn an toàn 100 MB.';

export async function exportProjectBackup(
  project: Project,
  onProgress?: (done: number, total: number) => void
): Promise<Blob> {
  // Include original images so cutouts can still be reverted after import.
  const assetIds = new Set<string>();
  for (const card of [...project.cards, ...project.trash.map(({ card }) => card)]) {
    if (card.assetId) assetIds.add(card.assetId);
    if (card.originalAssetId) assetIds.add(card.originalAssetId);
  }

  const ids = [...assetIds];
  const assets: BackupAssetEntry[] = [];
  let encodedBytes = 0;

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const meta = await getAssetMeta(id);
    const blob = await getAssetBlob(id, false);
    if (meta && blob) {
      encodedBytes += 4 * Math.ceil(blob.size / 3);
      if (encodedBytes > MAX_BACKUP_FILE_BYTES) throw new Error(BACKUP_TOO_LARGE);
      const base64 = await blobToBase64(blob);
      assets.push({
        meta: {
          ...meta,
          mime: blob.type || meta.mime || 'application/octet-stream',
          size: blob.size,
          samplePath: undefined, // Pack portable bytes
        },
        base64,
      });
    }
    onProgress?.(i + 1, ids.length);
  }

  const { revision, ...portableProject } = project;
  const payload: BackupFileV1 = {
    format: 'mosa-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    project: portableProject,
    assets,
  };

  const backup = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  if (backup.size > MAX_BACKUP_FILE_BYTES) throw new Error(BACKUP_TOO_LARGE);
  return backup;
}

export async function parseAndValidateBackupFile(
  file: File
): Promise<{ ok: true; data: BackupFileV1 } | { ok: false; reason: string }> {
  if (file.size > MAX_BACKUP_FILE_BYTES) {
    return { ok: false, reason: BACKUP_TOO_LARGE };
  }
  try {
    const text = await file.text();
    const parsed: unknown = JSON.parse(text);
    return validateBackupPayload(parsed);
  } catch {
    return { ok: false, reason: 'Tệp JSON bị hỏng hoặc không thể đọc được.' };
  }
}

/**
 * Imports a validated backup as a brand new independent project with remapped IDs
 * inside a single atomic IndexedDB transaction.
 */
export async function commitImportedBackup(
  backup: BackupFileV1,
  onProgress?: (done: number, total: number) => void
): Promise<Project> {
  const assetIdMap = new Map<string, string>();
  const preparedMetas: AssetMeta[] = [];
  const preparedBytes: AssetBytesRecord[] = [];
  const allCards = [...backup.project.cards, ...(backup.project.trash ?? []).map(({ card }) => card)];
  const fileAssets = new Set(allCards.filter((card) => card.kind === 'file').map((card) => card.assetId));
  const imageAssets = new Set<string>();
  for (const card of allCards) {
    if (card.kind !== 'image') continue;
    if (card.assetId) imageAssets.add(card.assetId);
    if (card.originalAssetId) imageAssets.add(card.originalAssetId);
  }

  for (let i = 0; i < backup.assets.length; i++) {
    const entry = backup.assets[i];
    const isImage = imageAssets.has(entry.meta.id) ||
      (!fileAssets.has(entry.meta.id) && entry.meta.mime.startsWith('image/'));
    const newAssetId = createId(isImage ? 'ast' : 'fil');
    assetIdMap.set(entry.meta.id, newAssetId);

    const blob = base64ToBlob(entry.base64, entry.meta.mime || 'application/octet-stream');
    const decoded = isImage ? await processUploadedImage(blob) : undefined;

    preparedMetas.push({
      id: newAssetId,
      fileName: typeof entry.meta.fileName === 'string' && entry.meta.fileName
        ? entry.meta.fileName : isImage ? 'imported-image.jpg' : 'document.bin',
      mime: blob.type || entry.meta.mime || 'application/octet-stream',
      size: blob.size,
      width: decoded?.width ?? 0,
      height: decoded?.height ?? 0,
      digest: decoded?.digest,
    });
    preparedBytes.push({
      id: newAssetId,
      blob,
      thumbnail: decoded?.thumbnail ?? blob,
    });
    onProgress?.(i + 1, backup.assets.length);
  }

  const cardIdMap = new Map(allCards.map((card) => [card.id, createId('crd')]));

  const remapCard = (c: Project['cards'][number]) => {
    const newId = cardIdMap.get(c.id) ?? createId('crd');
    const newGroupId = c.groupId ? cardIdMap.get(c.groupId) : undefined;
    const newAssetId = c.assetId ? assetIdMap.get(c.assetId) : undefined;
    return sanitizeCard({
      ...c,
      id: newId,
      groupId: newGroupId,
      assetId: newAssetId,
      originalAssetId: c.originalAssetId ? assetIdMap.get(c.originalAssetId) : undefined,
      aiClassifiedAssetId: c.aiClassifiedAssetId ? assetIdMap.get(c.aiClassifiedAssetId) : undefined,
      linksTo: Array.isArray(c.linksTo)
        ? c.linksTo.map((id) => cardIdMap.get(id)).filter((id): id is string => id !== undefined)
        : undefined,
      imageStatus:
        c.kind === 'image'
          ? newAssetId
            ? 'ready'
            : typeof c.source?.imageUrl === 'string' && isValidHttpUrl(c.source.imageUrl)
              ? 'remote-only'
              : 'missing'
          : undefined,
    });
  };

  const now = new Date().toISOString();
  const { name, description, status, clientName, projectCode, pinned, coverDataUrl, appearance, view } = backup.project;
  const importedProject: Project = {
    id: createId('proj'),
    revision: 0,
    name: `${typeof name === 'string' && name.trim() ? name : 'Dự án nhập'} (Bản sao)`,
    description: typeof description === 'string' ? description : '',
    status: status === 'draft' || status === 'review' || status === 'approved' ? status : undefined,
    clientName: typeof clientName === 'string' ? clientName : undefined,
    projectCode: typeof projectCode === 'string' ? projectCode : undefined,
    pinned: typeof pinned === 'boolean' ? pinned : undefined,
    coverDataUrl: typeof coverDataUrl === 'string' && /^data:image\/(png|jpeg|webp);base64,/i.test(coverDataUrl)
      ? coverDataUrl : undefined,
    appearance: {
      background: typeof appearance?.background === 'string' ? normalizeHex(appearance.background) ?? '#F1F0EB' : '#F1F0EB',
      dots: typeof appearance?.dots === 'boolean' ? appearance.dots : true,
      grayscale: typeof appearance?.grayscale === 'boolean' ? appearance.grayscale : undefined,
    },
    view: {
      x: Number.isFinite(view?.x) ? view.x : 80,
      y: Number.isFinite(view?.y) ? view.y : 80,
      zoom: Number.isFinite(view?.zoom) ? clampZoom(view.zoom) : 1,
    },
    cards: backup.project.cards.map(remapCard),
    trash: (backup.project.trash ?? []).map((t) => ({
      removedAt: t.removedAt || now,
      card: remapCard(t.card),
    })),
    updatedAt: now,
  };

  // Single atomic transaction: all or nothing
  await idbRunTransaction(
    [STORES.PROJECTS, STORES.ASSET_META, STORES.ASSET_BYTES],
    'readwrite',
    (tx) => {
      const assetMetaStore = tx.objectStore(STORES.ASSET_META);
      const assetBytesStore = tx.objectStore(STORES.ASSET_BYTES);
      for (const m of preparedMetas) assetMetaStore.put(m);
      for (const b of preparedBytes) assetBytesStore.put(b);
      tx.objectStore(STORES.PROJECTS).add(importedProject);
    }
  );

  return importedProject;
}
