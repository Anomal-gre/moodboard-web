import type { AssetBytesRecord, AssetMeta, Project, WorkspaceMeta } from '../domain/types';
import { createSampleProject, SAMPLE_ASSETS } from '../domain/project';
import { createId, normalizeDashes, sanitizeCard } from '../domain/validate';
import {
  idbGet,
  idbGetAll,
  idbPut,
  idbRunTransaction,
  STORES,
} from './indexedDb';
import { processUploadedImage } from './assets';
import { createProjectWriter } from './projectWrites';

const WORKSPACE_META_KEY = 'workspace';

const projectWriter = createProjectWriter();

// In-memory object URL cache for thumbnails/full images (revoked on cleanup)
const thumbUrlCache = new Map<string, string>();
const fullUrlCache = new Map<string, string>();

const SAMPLE_BY_ID = new Map(SAMPLE_ASSETS.map((s) => [s.id, s]));

export interface InitializedWorkspace {
  meta: WorkspaceMeta;
  projects: Project[];
  activeProject: Project;
}

function cleanProjectDashes(p: Project): Project {
  return {
    ...p,
    name: normalizeDashes(p.name),
    description: normalizeDashes(p.description),
    cards: (p.cards || []).map((c) => sanitizeCard(c)),
    trash: (p.trash || []).map((t) => ({ ...t, card: sanitizeCard(t.card) })),
  };
}

function normalizeLoadedProject(project: Project): Project {
  return cleanProjectDashes({ ...project, revision: project.revision ?? 0 });
}

export async function initWorkspace(): Promise<InitializedWorkspace> {
  const existingMeta = await idbGet<WorkspaceMeta>(STORES.META, WORKSPACE_META_KEY);
  const existingProjects = await idbGetAll<Project>(STORES.PROJECTS);

  if (!existingMeta && existingProjects.length === 0) {
    const sampleProject = normalizeLoadedProject(createSampleProject());
    const meta: WorkspaceMeta = {
      schemaVersion: 1,
      language: 'vi',
      activeProjectId: sampleProject.id,
      createdAt: new Date().toISOString(),
    };

    await idbRunTransaction([STORES.META, STORES.PROJECTS, STORES.ASSET_META], 'readwrite', (tx) => {
      const store = tx.objectStore(STORES.PROJECTS);
      const count = store.count();
      count.onsuccess = () => {
        if (count.result > 0) return;
        tx.objectStore(STORES.META).put(meta, WORKSPACE_META_KEY);
        store.add(sampleProject);
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
      };
    });

    return initWorkspace();
  }

  const projects = existingProjects.map(normalizeLoadedProject);
  let meta: WorkspaceMeta = existingMeta ?? {
    schemaVersion: 1,
    language: 'vi',
    activeProjectId: projects[0]?.id ?? '',
    createdAt: new Date().toISOString(),
  };

  if (projects.length === 0) {
    const sampleProject = normalizeLoadedProject(createSampleProject());
    await idbRunTransaction([STORES.PROJECTS, STORES.META], 'readwrite', (tx) => {
      const store = tx.objectStore(STORES.PROJECTS);
      const count = store.count();
      count.onsuccess = () => {
        if (count.result > 0) return;
        store.add(sampleProject);
        tx.objectStore(STORES.META).put({ ...meta, activeProjectId: sampleProject.id }, WORKSPACE_META_KEY);
      };
    });
    return initWorkspace();
  }

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
  const p = await idbGet<Project>(STORES.PROJECTS, projectId);
  return p ? normalizeLoadedProject(p) : undefined;
}

export async function listProjects(): Promise<Project[]> {
  const list = await idbGetAll<Project>(STORES.PROJECTS);
  return list.map(normalizeLoadedProject).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveProject(project: Project, clipId?: string): Promise<void> {
  return projectWriter.save(cleanProjectDashes(project), clipId);
}

export function saveProjectView(project: Project): Promise<void> {
  return projectWriter.updateViewOrCover(project, { view: project.view });
}

export function saveProjectCover(project: Project, coverDataUrl: string): Promise<void> {
  return projectWriter.updateViewOrCover(project, { coverDataUrl });
}

export function deleteProject(project: Project): Promise<void> {
  return projectWriter.remove(project);
}

export async function reloadProjectForEditing(id: string): Promise<Project | undefined> {
  const project = await projectWriter.reload(id);
  return project ? normalizeLoadedProject(project) : undefined;
}

export async function duplicateProject(
  source: Project,
  copySuffix = '(Copy)'
): Promise<Project> {
  const now = new Date().toISOString();
  const idMap = new Map<string, string>();
  for (const c of source.cards) {
    idMap.set(c.id, createId('crd'));
  }
  const clonedCards = source.cards.map((c) => ({
    ...c,
    id: idMap.get(c.id)!,
    groupId: c.groupId ? idMap.get(c.groupId) : undefined,
    linksTo: c.linksTo
      ?.map((tid) => idMap.get(tid))
      .filter((x): x is string => Boolean(x)),
    spec: c.spec ? { ...c.spec } : undefined,
    crop: c.crop ? { ...c.crop } : undefined,
    source: c.source ? { ...c.source } : undefined,
    designFile: c.designFile ? { ...c.designFile } : undefined,
    createdAt: now,
    updatedAt: now,
  }));

  const cloned: Project = {
    ...source,
    id: createId('proj'),
    revision: undefined,
    name: `${source.name} ${copySuffix}`.trim(),
    status: 'draft',
    pinned: false,
    appearance: { ...source.appearance },
    view: { ...source.view },
    cards: clonedCards,
    trash: [],
    updatedAt: now,
  };
  await saveProject(cloned);
  return cloned;
}

export async function putImageAsset(
  blob: Blob,
  fileName: string
): Promise<AssetMeta> {
  const decoded = await processUploadedImage(blob);

  const allMeta = await idbGetAll<AssetMeta>(STORES.ASSET_META);
  const existing = allMeta.find((m) => m.digest && m.digest === decoded.digest);
  if (existing) {
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

/**
 * Store arbitrary non-image file bytes in IndexedDB so double-click can open the file anytime.
 */
export async function putRawFileAsset(
  blob: Blob,
  fileName: string
): Promise<AssetMeta> {
  const id = createId('fil');
  const meta: AssetMeta = {
    id,
    fileName,
    mime: blob.type || 'application/octet-stream',
    size: blob.size,
    width: 0,
    height: 0,
  };
  const bytesRec: AssetBytesRecord = {
    id,
    blob,
    thumbnail: blob,
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
