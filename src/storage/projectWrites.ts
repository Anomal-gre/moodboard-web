import type { Project } from '../domain/types';
import { idbGet, idbRunTransaction, STORES } from './indexedDb';

export class ProjectConflictError extends Error {
  constructor() {
    super('The saved project changed in another tab.');
    this.name = 'ProjectConflictError';
  }
}

export interface ClipReceipt {
  projectId: string;
  projectName: string;
}

const clipKey = (clipId: string) => `clip:${clipId}`;

export function getClipReceipt(clipId: string): Promise<ClipReceipt | undefined> {
  return idbGet(STORES.META, clipKey(clipId));
}

/** Serializes writes within a tab. The IndexedDB transaction arbitrates across tabs. */
export function createProjectWriter() {
  const pending = new Map<string, Promise<unknown>>();
  const acknowledgedRevision = new Map<string, number>();

  function enqueue<T>(id: string, write: () => Promise<T>): Promise<T> {
    const next = (pending.get(id) ?? Promise.resolve()).catch(() => undefined).then(write);
    pending.set(id, next);
    const clear = () => { if (pending.get(id) === next) pending.delete(id); };
    void next.then(clear, clear);
    return next;
  }

  function save(project: Project, clipId?: string): Promise<void> {
    return enqueue(project.id, async () => {
      const expected = acknowledgedRevision.get(project.id) ?? project.revision;
      const nextRevision = (expected ?? -1) + 1;
      let conflict = false;
      await idbRunTransaction(clipId ? [STORES.PROJECTS, STORES.META] : [STORES.PROJECTS], 'readwrite', (tx) => {
        const store = tx.objectStore(STORES.PROJECTS);
        const request = store.get(project.id);
        request.onsuccess = () => {
          const current = request.result as Project | undefined;
          const actual = current ? current.revision ?? 0 : undefined;
          if (actual !== expected) {
            conflict = true;
            return;
          }
          store.put({ ...project, revision: nextRevision });
          if (clipId) {
            const receipt: ClipReceipt = { projectId: project.id, projectName: project.name };
            tx.objectStore(STORES.META).add(receipt, clipKey(clipId));
          }
        };
      });
      if (conflict) throw new ProjectConflictError();
      acknowledgedRevision.set(project.id, nextRevision);
    });
  }

  function remove(project: Project): Promise<void> {
    return enqueue(project.id, async () => {
      const expected = acknowledgedRevision.get(project.id) ?? project.revision;
      let conflict = false;
      await idbRunTransaction([STORES.PROJECTS], 'readwrite', (tx) => {
        const store = tx.objectStore(STORES.PROJECTS);
        const request = store.get(project.id);
        request.onsuccess = () => {
          const current = request.result as Project | undefined;
          if (!current || (current.revision ?? 0) !== expected) {
            conflict = true;
            return;
          }
          const count = store.count();
          count.onsuccess = () => {
            if (count.result > 1) store.delete(project.id);
            else conflict = true;
          };
        };
      });
      if (conflict) throw new ProjectConflictError();
      // Keep the acknowledged revision so a pending snapshot cannot recreate a deleted row.
    });
  }

  function reload(id: string): Promise<Project | undefined> {
    return enqueue(id, async () => {
      const project = await idbGet<Project>(STORES.PROJECTS, id);
      acknowledgedRevision.delete(id);
      return project;
    });
  }

  function updateViewOrCover(project: Project, patch: Pick<Partial<Project>, 'view' | 'coverDataUrl'>): Promise<void> {
    return enqueue(project.id, () => idbRunTransaction([STORES.PROJECTS], 'readwrite', (tx) => {
      const store = tx.objectStore(STORES.PROJECTS);
      const request = store.get(project.id);
      request.onsuccess = () => {
        const current = request.result as Project | undefined;
        if (!current) return;
        // Covers are rendered from a specific content revision. Pan and zoom are independent.
        const expected = acknowledgedRevision.get(project.id) ?? project.revision;
        if (patch.coverDataUrl && (current.revision ?? 0) !== expected) return;
        store.put({ ...current, ...patch });
      };
    }));
  }

  return { save, remove, reload, updateViewOrCover };
}
