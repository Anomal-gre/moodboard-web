import type { AssetBytesRecord, Project } from '../domain/types';
import { idbDelete, idbGetAll, STORES } from './indexedDb';
import { revokeCachedAssetUrl } from './workspaceRepository';

export interface StorageHealthReport {
  usedAssetBytes: number;
  assetCount: number;
  orphanAssetIds: string[];
  orphanBytes: number;
  browserUsageBytes?: number;
  browserQuotaBytes?: number;
}

function collectReferencedAssetIds(projects: Project[]): Set<string> {
  const refs = new Set<string>();
  const addCard = (c: Project['cards'][number]) => {
    if (c.assetId) refs.add(c.assetId);
    if (c.originalAssetId) refs.add(c.originalAssetId);
    if (c.aiClassifiedAssetId) refs.add(c.aiClassifiedAssetId);
  };
  for (const p of projects) {
    for (const c of p.cards || []) addCard(c);
    for (const t of p.trash || []) addCard(t.card);
  }
  return refs;
}

export async function getStorageHealth(): Promise<StorageHealthReport> {
  const [projects, assetBytes] = await Promise.all([
    idbGetAll<Project>(STORES.PROJECTS),
    idbGetAll<AssetBytesRecord>(STORES.ASSET_BYTES),
  ]);

  const referenced = collectReferencedAssetIds(projects);
  let usedAssetBytes = 0;
  let orphanBytes = 0;
  const orphanAssetIds: string[] = [];

  for (const rec of assetBytes) {
    const sz = (rec.blob?.size ?? 0) + (rec.thumbnail && rec.thumbnail !== rec.blob ? rec.thumbnail.size : 0);
    usedAssetBytes += sz;
    if (!referenced.has(rec.id)) {
      orphanAssetIds.push(rec.id);
      orphanBytes += sz;
    }
  }

  let browserUsageBytes: number | undefined;
  let browserQuotaBytes: number | undefined;
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      const est = await navigator.storage.estimate();
      browserUsageBytes = est.usage;
      browserQuotaBytes = est.quota;
    } catch {
      // Ignore estimate errors in restricted contexts
    }
  }

  return {
    usedAssetBytes,
    assetCount: assetBytes.length,
    orphanAssetIds,
    orphanBytes,
    browserUsageBytes,
    browserQuotaBytes,
  };
}

export async function purgeOrphanAssets(): Promise<{ removedCount: number; reclaimedBytes: number }> {
  const report = await getStorageHealth();
  if (report.orphanAssetIds.length === 0) {
    return { removedCount: 0, reclaimedBytes: 0 };
  }
  for (const id of report.orphanAssetIds) {
    await idbDelete(STORES.ASSET_BYTES, id);
    await idbDelete(STORES.ASSET_META, id);
    revokeCachedAssetUrl(id);
  }
  return {
    removedCount: report.orphanAssetIds.length,
    reclaimedBytes: report.orphanBytes,
  };
}

export function formatBytesMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1 && bytes > 0) return '<0.1';
  return mb.toFixed(1);
}
