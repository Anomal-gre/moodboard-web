import type {
  AssetBytesRecord,
  AssetMeta,
  BackupAssetEntry,
  BackupFileV1,
  Project,
} from '../domain/types';
import { createId, sanitizeCard, validateBackupPayload } from '../domain/validate';
import { base64ToBlob, blobToBase64, processUploadedImage } from './assets';
import { idbRunTransaction, STORES } from './indexedDb';
import { getAssetBlob, getAssetMeta } from './workspaceRepository';

export const MAX_BACKUP_FILE_BYTES = 100 * 1024 * 1024; // 100 MB

export async function exportProjectBackup(
  project: Project,
  onProgress?: (done: number, total: number) => void
): Promise<Blob> {
  // Collect all unique referenced assetIds across active cards and trash
  const assetIds = new Set<string>();
  for (const c of project.cards) {
    if (c.assetId) assetIds.add(c.assetId);
  }
  for (const t of project.trash) {
    if (t.card.assetId) assetIds.add(t.card.assetId);
  }

  const ids = [...assetIds];
  const assets: BackupAssetEntry[] = [];

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const meta = await getAssetMeta(id);
    const blob = await getAssetBlob(id, false);
    if (meta && blob) {
      const base64 = await blobToBase64(blob);
      assets.push({
        meta: {
          ...meta,
          mime: blob.type || meta.mime || 'image/jpeg',
          size: blob.size,
          samplePath: undefined, // Pack portable bytes
        },
        base64,
      });
    }
    onProgress?.(i + 1, ids.length);
  }

  const payload: BackupFileV1 = {
    format: 'mosa-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    project,
    assets,
  };

  return new Blob([JSON.stringify(payload)], { type: 'application/json' });
}

export async function parseAndValidateBackupFile(
  file: File
): Promise<{ ok: true; data: BackupFileV1 } | { ok: false; reason: string }> {
  if (file.size > MAX_BACKUP_FILE_BYTES) {
    return { ok: false, reason: 'Tệp bản sao vượt quá giới hạn an toàn 100 MB.' };
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

  for (let i = 0; i < backup.assets.length; i++) {
    const entry = backup.assets[i];
    const newAssetId = createId('ast');
    assetIdMap.set(entry.meta.id, newAssetId);

    const blob = base64ToBlob(entry.base64, entry.meta.mime || 'image/jpeg');
    const decoded = await processUploadedImage(blob);

    preparedMetas.push({
      id: newAssetId,
      fileName: entry.meta.fileName || 'imported-image.jpg',
      mime: blob.type || entry.meta.mime || 'image/jpeg',
      size: blob.size,
      width: decoded.width,
      height: decoded.height,
      digest: decoded.digest,
    });
    preparedBytes.push({
      id: newAssetId,
      blob,
      thumbnail: decoded.thumbnail,
    });
    onProgress?.(i + 1, backup.assets.length);
  }

  // Remap card IDs and groupIds cleanly
  const cardIdMap = new Map<string, string>();
  for (const c of backup.project.cards) {
    cardIdMap.set(c.id, createId('crd'));
  }
  for (const t of backup.project.trash ?? []) {
    if (!cardIdMap.has(t.card.id)) {
      cardIdMap.set(t.card.id, createId('crd'));
    }
  }

  const remapCard = (c: Project['cards'][number]) => {
    const newId = cardIdMap.get(c.id) ?? createId('crd');
    const newGroupId = c.groupId ? cardIdMap.get(c.groupId) : undefined;
    const newAssetId = c.assetId ? assetIdMap.get(c.assetId) : undefined;
    return sanitizeCard({
      ...c,
      id: newId,
      groupId: newGroupId,
      assetId: newAssetId,
      imageStatus:
        c.kind === 'image'
          ? newAssetId
            ? 'ready'
            : c.source?.imageUrl
              ? 'remote-only'
              : 'missing'
          : undefined,
    });
  };

  const now = new Date().toISOString();
  const importedProject: Project = {
    id: createId('proj'),
    name: `${backup.project.name || 'Dự án nhập'} (Bản sao)`,
    description: backup.project.description || '',
    appearance: {
      background: backup.project.appearance?.background || '#F1F0EB',
      dots: backup.project.appearance?.dots ?? true,
    },
    view: {
      x: backup.project.view?.x ?? 80,
      y: backup.project.view?.y ?? 80,
      zoom: backup.project.view?.zoom ?? 1,
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
      tx.objectStore(STORES.PROJECTS).put(importedProject);
    }
  );

  return importedProject;
}
