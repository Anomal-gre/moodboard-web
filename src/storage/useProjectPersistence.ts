import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project, SaveStatus } from '../domain/types';
import { checkDirectoryPermission, syncProjectToDirectory, type FsDirectoryHandle } from './localFolderSync';
import { ProjectConflictError } from './projectWrites';
import { loadProject, saveProject, saveProjectView } from './workspaceRepository';

export function useProjectPersistence(
  mirrorFolder: FsDirectoryHandle | null,
  onError: (message: string, conflict: boolean) => void,
) {
  const [statuses, setStatuses] = useState<Record<string, SaveStatus>>({});
  const states = useRef<Record<string, SaveStatus>>({});
  const latestWrite = useRef(new Map<string, symbol>());
  const delayedWrites = useRef(new Map<string, { timer: number; resolve: (saved: boolean) => void }>());
  const viewTimers = useRef(new Map<string, number>());
  const mirrorTimers = useRef(new Map<string, number>());
  const mirrorWrites = useRef(new Map<string, Promise<void>>());
  const folder = useRef(mirrorFolder);
  const report = useRef(onError);
  folder.current = mirrorFolder;
  report.current = onError;

  const publish = useCallback((id: string, status: SaveStatus) => {
    states.current = { ...states.current, [id]: status };
    setStatuses(states.current);
  }, []);

  const scheduleMirror = useCallback((id: string) => {
    if (!folder.current) return;
    window.clearTimeout(mirrorTimers.current.get(id));
    mirrorTimers.current.set(id, window.setTimeout(() => {
      mirrorTimers.current.delete(id);
      const mirror = async () => {
        const handle = folder.current;
        if (!handle || !(await checkDirectoryPermission(handle, false))) return;
        const project = await loadProject(id);
        if (project) await syncProjectToDirectory(handle, project);
      };
      const queued = (mirrorWrites.current.get(id) ?? Promise.resolve()).then(async () => {
        if (navigator.locks) await navigator.locks.request(`mosa-folder-mirror:${id}`, mirror);
        else await mirror();
      }).catch(() => { /* A failed mirror can be retried by the next edit. */ });
      mirrorWrites.current.set(id, queued);
      void queued.then(() => { if (mirrorWrites.current.get(id) === queued) mirrorWrites.current.delete(id); });
    }, 2400));
  }, []);

  const cancelDelayedWrite = useCallback((id: string) => {
    const pending = delayedWrites.current.get(id);
    if (!pending) return;
    window.clearTimeout(pending.timer);
    delayedWrites.current.delete(id);
    pending.resolve(false);
  }, []);

  const persistProject = useCallback(async (
    project: Project, options?: { debounceMs?: number; clipId?: string },
  ): Promise<boolean> => {
    if (states.current[project.id] === 'conflict') return false;
    cancelDelayedWrite(project.id);
    const write = Symbol();
    latestWrite.current.set(project.id, write);
    const save = async () => {
      publish(project.id, 'saving');
      try {
        await saveProject(project, options?.clipId);
        if (latestWrite.current.get(project.id) === write) publish(project.id, 'saved');
        scheduleMirror(project.id);
        return true;
      } catch (error) {
        const conflict = error instanceof ProjectConflictError;
        if (latestWrite.current.get(project.id) === write) {
          publish(project.id, conflict ? 'conflict' : 'error');
          report.current(error instanceof Error ? error.message : '', conflict);
        }
        return false;
      }
    };
    if (options?.debounceMs) {
      publish(project.id, 'unsaved');
      return new Promise((resolve) => {
        const timer = window.setTimeout(() => {
          delayedWrites.current.delete(project.id);
          void save().then(resolve);
        }, options.debounceMs);
        delayedWrites.current.set(project.id, { timer, resolve });
      });
    }
    return save();
  }, [cancelDelayedWrite, publish, scheduleMirror]);

  const persistView = useCallback((project: Project) => {
    window.clearTimeout(viewTimers.current.get(project.id));
    if (states.current[project.id] === 'conflict') return;
    viewTimers.current.set(project.id, window.setTimeout(() => {
      viewTimers.current.delete(project.id);
      void saveProjectView(project).catch(() => undefined);
    }, 380));
  }, []);

  const clearStatus = useCallback((id: string) => {
    cancelDelayedWrite(id);
    latestWrite.current.delete(id);
    window.clearTimeout(viewTimers.current.get(id));
    viewTimers.current.delete(id);
    window.clearTimeout(mirrorTimers.current.get(id));
    mirrorTimers.current.delete(id);
    publish(id, 'saved');
  }, [cancelDelayedWrite, publish]);

  const getStatus = useCallback((id: string) => states.current[id] ?? 'saved', []);

  useEffect(() => {
    const warnOnUnload = (event: BeforeUnloadEvent) => {
      if (Object.values(states.current).some((status) => status !== 'saved')) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warnOnUnload);
    const view = viewTimers.current;
    const mirror = mirrorTimers.current;
    const delayed = delayedWrites.current;
    return () => {
      window.removeEventListener('beforeunload', warnOnUnload);
      for (const timeout of view.values()) window.clearTimeout(timeout);
      for (const timeout of mirror.values()) window.clearTimeout(timeout);
      view.clear();
      mirror.clear();
      for (const id of delayed.keys()) cancelDelayedWrite(id);
    };
  }, [cancelDelayedWrite]);

  return { statuses, persistProject, persistView, clearStatus, publish, getStatus, cancelDelayedWrite };
}
