import type { AssetBytesRecord, AssetMeta, Project, WorkspaceMeta } from '../domain/types';
import { createSampleProject, SAMPLE_ASSETS } from '../domain/project';
import { createId } from '../domain/validate';
import {
  idbDelete,
  idbGet,
  idbGetAll,
  idbPut,
  idbRunTransaction,
  STORES,
} from './indexedDb';
import { processUploadedImage } from './assets';

const WORKSPACE_META_KEY = 'workspace';

// Per-project write queue so slow transactions never overwrite newer commits
const projectSaveQueues = new Map<string, Promise<void>>();

// In-memory object URL cache for thumbnails/full images (revoked on cleanup)
const thumbUrlCache = new Map<string, string>();
const fullUrlCache = new Map<string, string>();

const SAMPLE_BY_ID = new Map(SAMPLE_ASSETS.map((s) => [s.id, s]));

export interface InitializedWorkspace {
  meta: WorkspaceMeta;
  projects: Project[];
  activeProject: Project;
}

export async function initWorkspace(): Promise<InitializedWorkspace> {
  const existingMeta = await idbGet<WorkspaceMeta>(STORES.META, WORKSPACE_META_KEY);
  const existingProjects = await idbGetAll<Project>(STORES.PROJECTS);

  if (!existingMeta && existingProjects.length === 0) {
    // Seed sample board once on a genuinely empty DB
    const sampleProject = createSampleProject();
    const meta: WorkspaceMeta = {
      schemaVersion: 1,
      language: 'vi',
      activeProjectId: sampleProject.id,
      createdAt: new Date().toISOString(),
    };

    await idbRunTransaction([STORES.META, STORES.PROJECTS, STORES.ASSET_META], 'readwrite', (tx) => {
      tx.objectStore(STORES.META).put(meta, WORKSPACE_META_KEY);
      tx.objectStore(STORES.PROJECTS).put(sampleProject);
      for (const s of SAMPLE_ASSETS) {
        const assetMeta: AssetMeta = {
          id: s.id,
          fileName: s.fileName,
          mime: 'image/jpeg',
          size: 0,
          width: s.width,
          height: s.height,
          samplePath: s.samplePath,
        };
        tx.objectStore(STORES.ASSET_META).put(assetMeta);
      }
    });

    return { meta, projects: [sampleProject], activeProject: sampleProject };
  }

  let projects = existingProjects;
  let meta: WorkspaceMeta = existingMeta ?? {
    schemaVersion: 1,
    language: 'vi',
    activeProjectId: projects[0]?.id ?? '',
    createdAt: new Date().toISOString(),
  };

  if (projects.length === 0) {
    const sampleProject = createSampleProject();
    projects = [sampleProject];
    meta = { ...meta, activeProjectId: sampleProject.id };
    await idbPut(STORES.PROJECTS, sampleProject);
    await idbPut(STORES.META, meta, WORKSPACE_META_KEY);
  }

  // Sort most recently updated first
  projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  let active = projects.find((p) => p.id === meta.activeProjectId);
  if (!active) {
    active = projects[0];
    meta = { ...meta, activeProjectId: active.id };
    await idbPut(STORES.META, meta, WORKSPACE_META_KEY);
  }

  return { meta, projects, activeProject: active };
}

export async function saveWorkspaceMeta(meta: WorkspaceMeta): Promise<void> {
  await idbPut(STORES.META, meta, WORKSPACE_META_KEY);
}

export async function loadProject(projectId: string): Promise<Project | undefined> {
  return idbGet<Project>(STORES.PROJECTS, projectId);
}

export async function listProjects(): Promise<Project[]> {
  const list = await idbGetAll<Project>(STORES.PROJECTS);
  return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveProject(project: Project): Promise<void> {
  const prev = projectSaveQueues.get(project.id) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(async () => {
      await idbPut(STORES.PROJECTS, project);
    });
  projectSaveQueues.set(project.id, next);
  return next;
}

export async function deleteProjectById(projectId: string): Promise<void> {
  await idbDelete(STORES.PROJECTS, projectId);
}

export async function putImageAsset(
  blob: Blob,
  fileName: string
): Promise<AssetMeta> {
  const decoded = await processUploadedImage(blob);

  // Deduplicate by SHA-256 digest
  const allMeta = await idbGetAll<AssetMeta>(STORES.ASSET_META);
  const existing = allMeta.find((m) => m.digest && m.digest === decoded.digest);
  if (existing) {
    // Verify bytes still exist
    const bytes = await idbGet<AssetBytesRecord>(STORES.ASSET_BYTES, existing.id);
    if (bytes) {
      return existing;
    }
  }

  const id = createId('ast');
  const meta: AssetMeta = {
    id,
    fileName,
    mime: blob.type || 'image/jpeg',
    size: blob.size,
    width: decoded.width,
    height: decoded.height,
    digest: decoded.digest,
  };
  const bytesRec: AssetBytesRecord = {
    id,
    blob,
    thumbnail: decoded.thumbnail,
  };

  await idbRunTransaction([STORES.ASSET_META, STORES.ASSET_BYTES], 'readwrite', (tx) => {
    tx.objectStore(STORES.ASSET_META).put(meta);
    tx.objectStore(STORES.ASSET_BYTES).put(bytesRec);
  });

  return meta;
}

export async function getAssetMeta(assetId: string): Promise<AssetMeta | undefined> {
  const sample = SAMPLE_BY_ID.get(assetId);
  const stored = await idbGet<AssetMeta>(STORES.ASSET_META, assetId);
  if (stored) return stored;
  if (sample) {
    return {
      id: sample.id,
      fileName: sample.fileName,
      mime: 'image/jpeg',
      size: 0,
      width: sample.width,
      height: sample.height,
      samplePath: sample.samplePath,
    };
  }
  return undefined;
}

export async function getAssetBlob(
  assetId: string,
  preferThumbnail = false
): Promise<Blob | null> {
  const sample = SAMPLE_BY_ID.get(assetId);
  const rec = await idbGet<AssetBytesRecord>(STORES.ASSET_BYTES, assetId);
  if (rec) {
    return preferThumbnail ? rec.thumbnail || rec.blob : rec.blob;
  }
  if (sample) {
    try {
      const resp = await fetch(sample.samplePath);
      if (resp.ok) return await resp.blob();
    } catch {
      return null;
    }
  }
  const meta = await idbGet<AssetMeta>(STORES.ASSET_META, assetId);
  if (meta?.samplePath) {
    try {
      const resp = await fetch(meta.samplePath);
      if (resp.ok) return await resp.blob();
    } catch {
      return null;
    }
  }
  return null;
}

export async function resolveAssetUrl(
  assetId: string,
  variant: 'thumb' | 'full' = 'thumb'
): Promise<string | null> {
  const sample = SAMPLE_BY_ID.get(assetId);
  if (sample) return sample.samplePath;

  const cache = variant === 'thumb' ? thumbUrlCache : fullUrlCache;
  const cached = cache.get(assetId);
  if (cached) return cached;

  const blob = await getAssetBlob(assetId, variant === 'thumb');
  if (!blob) return null;

  const url = URL.createObjectURL(blob);
  cache.set(assetId, url);
  return url;
}

export function revokeCachedAssetUrl(assetId: string): void {
  const t = thumbUrlCache.get(assetId);
  if (t) {
    URL.revokeObjectURL(t);
    thumbUrlCache.delete(assetId);
  }
  const f = fullUrlCache.get(assetId);
  if (f) {
    URL.revokeObjectURL(f);
    fullUrlCache.delete(assetId);
  }
}

export function revokeAllCachedAssetUrls(): void {
  for (const url of thumbUrlCache.values()) URL.revokeObjectURL(url);
  for (const url of fullUrlCache.values()) URL.revokeObjectURL(url);
  thumbUrlCache.clear();
  fullUrlCache.clear();
}
