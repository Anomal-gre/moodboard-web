import type { Project } from '../domain/types';
import { exportProjectBackup } from './backup';
import { idbDelete, idbGet, idbPut, STORES } from './indexedDb';
import { slugifyFileName, triggerBlobDownload } from '../features/export/exportPng';

const SYNC_FOLDER_HANDLE_KEY = 'mosa_sync_folder_handle';

// Minimal Chromium File System Access API typings (safe across TS lib versions)
export interface FsWritableStream {
  write: (data: Blob | string) => Promise<void>;
  close: () => Promise<void>;
}

export interface FsFileHandle {
  kind: 'file';
  name: string;
  getFile: () => Promise<File>;
  createWritable: () => Promise<FsWritableStream>;
}

export interface FsDirectoryHandle {
  kind: 'directory';
  name: string;
  queryPermission?: (opts: { mode: 'read' | 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission?: (opts: { mode: 'read' | 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>;
  getFileHandle: (name: string, opts?: { create?: boolean }) => Promise<FsFileHandle>;
}

interface FsWindow extends Window {
  showDirectoryPicker?: (opts?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FsDirectoryHandle>;
  showSaveFilePicker?: (opts?: {
    suggestedName?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FsFileHandle>;
  showOpenFilePicker?: (opts?: {
    multiple?: boolean;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FsFileHandle[]>;
}

export function isFolderSyncSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as FsWindow).showDirectoryPicker === 'function';
}

export async function getSavedSyncDirectory(): Promise<FsDirectoryHandle | null> {
  try {
    const handle = await idbGet<FsDirectoryHandle>(STORES.META, SYNC_FOLDER_HANDLE_KEY);
    return handle && handle.kind === 'directory' ? handle : null;
  } catch {
    return null;
  }
}

export async function clearSavedSyncDirectory(): Promise<void> {
  await idbDelete(STORES.META, SYNC_FOLDER_HANDLE_KEY);
}

export async function pickSyncDirectory(): Promise<FsDirectoryHandle | null> {
  const win = window as FsWindow;
  if (!win.showDirectoryPicker) return null;
  try {
    const handle = await win.showDirectoryPicker({
      id: 'mosa-workspace',
      mode: 'readwrite',
    });
    await idbPut(STORES.META, handle, SYNC_FOLDER_HANDLE_KEY);
    return handle;
  } catch (err) {
    // User cancelled picker
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    throw err;
  }
}

export async function checkDirectoryPermission(
  handle: FsDirectoryHandle,
  requestIfNeeded = false
): Promise<boolean> {
  try {
    if (handle.queryPermission) {
      const state = await handle.queryPermission({ mode: 'readwrite' });
      if (state === 'granted') return true;
      if (!requestIfNeeded) return false;
    }
    if (requestIfNeeded && handle.requestPermission) {
      const next = await handle.requestPermission({ mode: 'readwrite' });
      return next === 'granted';
    }
    return true;
  } catch {
    return false;
  }
}

export function buildMosaProjectFileName(project: Project): string {
  const slug = slugifyFileName(project.name);
  const shortId = project.id.replace(/[^a-zA-Z0-9]/g, '').slice(-6) || 'board';
  return `${slug}-${shortId}.mosa`;
}

export async function syncProjectToDirectory(
  handle: FsDirectoryHandle,
  project: Project
): Promise<string> {
  const blob = await exportProjectBackup(project);
  const fileName = buildMosaProjectFileName(project);
  const fileHandle = await handle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
  return fileName;
}

export async function syncAllProjectsToDirectory(
  handle: FsDirectoryHandle,
  projects: Project[],
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  let count = 0;
  for (let i = 0; i < projects.length; i++) {
    await syncProjectToDirectory(handle, projects[i]);
    count++;
    onProgress?.(count, projects.length);
  }
  return count;
}

export async function saveProjectAsMosaFile(
  project: Project,
  onProgress?: (done: number, total: number) => void
): Promise<boolean> {
  const blob = await exportProjectBackup(project, onProgress);
  const suggestedName = `${slugifyFileName(project.name)}.mosa`;
  const win = window as FsWindow;

  if (typeof win.showSaveFilePicker === 'function') {
    try {
      const fileHandle = await win.showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: 'Mosa Project File (.mosa)',
            accept: { 'application/json': ['.mosa', '.json'] },
          },
        ],
      });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return false;
      // Fallback to standard download
    }
  }

  triggerBlobDownload(blob, suggestedName);
  return true;
}

export async function openMosaFilePickerNative(): Promise<File | null> {
  const win = window as FsWindow;
  if (typeof win.showOpenFilePicker === 'function') {
    try {
      const handles = await win.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: 'Mosa Project (.mosa, .json)',
            accept: { 'application/json': ['.mosa', '.json'] },
          },
        ],
      });
      if (handles[0]) return await handles[0].getFile();
      return null;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return null;
    }
  }

  // Standard HTML file input fallback
  return await new Promise<File | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mosa,.json,.moodboard.json,application/json';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}
