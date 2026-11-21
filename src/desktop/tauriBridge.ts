import type { Card } from '../domain/types';
import { getAssetBlob } from '../storage/workspaceRepository';

interface TauriInternals {
  invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: TauriInternals;
    __TAURI__?: {
      core?: TauriInternals;
    };
  }
}

export function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.__TAURI_INTERNALS__?.invoke || window.__TAURI__?.core?.invoke)
  );
}

export async function invokeTauri<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T> {
  const fn = window.__TAURI_INTERNALS__?.invoke ?? window.__TAURI__?.core?.invoke;
  if (!fn) {
    throw new Error('Không ở trong môi trường Tauri Desktop.');
  }
  return fn<T>(cmd, args);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const comma = dataUrl.indexOf(',');
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Không đọc được dữ liệu tệp.'));
    reader.readAsDataURL(blob);
  });
}

async function tryLocalNativeOpen(payload: {
  fileName: string;
  localPath?: string;
  base64?: string;
}): Promise<{ ok: boolean; openedPath?: string }> {
  try {
    const resp = await fetch('/__local_open_file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) return { ok: false };
    const data = (await resp.json()) as { ok?: boolean; openedPath?: string };
    return { ok: Boolean(data.ok), openedPath: data.openedPath };
  } catch {
    return { ok: false };
  }
}

const BROWSER_PREVIEWABLE_EXTENSIONS = new Set([
  'pdf',
  'txt',
  'md',
  'json',
  'csv',
  'html',
  'htm',
  'xml',
  'svg',
  'mp4',
  'webm',
  'mp3',
  'wav',
  'ogg',
]);

/**
 * Opens a File card when double-clicked on the canvas or triggered from Inspector.
 * 1. In Tauri v2 Rust Desktop: invokes native Rust command to open directly with OS default app.
 * 2. In Local Dev App mode: invokes local native bridge so files open directly on OS without browser download.
 * 3. In remote Web Browser: opens preview in new tab or triggers download fallback.
 */
export async function openFileCard(
  card: Card
): Promise<{ ok: boolean; message: string; needsRelink?: boolean }> {
  const fileName = card.source?.fileName || card.title || 'document';
  const localPath = card.designFile?.localPath || card.source?.localPath;
  const ext = (card.designFile?.extension || 'file').toLowerCase();

  // 1. Tauri v2 Rust native path open
  if (isTauriRuntime() && localPath) {
    try {
      await invokeTauri('open_file_native', { path: localPath });
      return {
        ok: true,
        message: `Đã mở tệp "${fileName}" trực tiếp trên máy.`,
      };
    } catch {
      // Fall through to stored bytes if file was moved
    }
  }

  // 2. Stored file bytes in IndexedDB
  if (card.assetId) {
    try {
      const blob = await getAssetBlob(card.assetId, false);
      if (blob) {
        if (isTauriRuntime()) {
          const buf = await blob.arrayBuffer();
          const bytes = Array.from(new Uint8Array(buf));
          await invokeTauri<string>('open_file_bytes', {
            fileName,
            bytes,
          });
          return {
            ok: true,
            message: `Đã mở tệp "${fileName}" trực tiếp trên máy.`,
          };
        }

        // Try local native bridge (opens directly via Windows/macOS without triggering browser Downloads)
        const base64 = await blobToBase64(blob);
        const localRes = await tryLocalNativeOpen({ fileName, localPath, base64 });
        if (localRes.ok) {
          return {
            ok: true,
            message: `Đã mở tệp "${fileName}" trực tiếp trên máy.`,
          };
        }

        // Remote web browser fallback
        const url = URL.createObjectURL(blob);
        if (BROWSER_PREVIEWABLE_EXTENSIONS.has(ext) || blob.type.startsWith('text/')) {
          window.open(url, '_blank', 'noopener,noreferrer');
        } else {
          const a = document.createElement('a');
          a.href = url;
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        return {
          ok: true,
          message: `Đã mở tệp "${fileName}".`,
        };
      }
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : `Không thể mở tệp "${fileName}".`,
      };
    }
  }

  // 3. Try local path via local bridge if available
  if (localPath) {
    const localRes = await tryLocalNativeOpen({ fileName, localPath });
    if (localRes.ok) {
      return {
        ok: true,
        message: `Đã mở tệp "${fileName}" trực tiếp trên máy.`,
      };
    }
  }

  // 4. Remote source URL fallback
  if (card.source?.pageUrl) {
    window.open(card.source.pageUrl, '_blank', 'noopener,noreferrer');
    return {
      ok: true,
      message: `Đã mở liên kết nguồn của "${fileName}".`,
    };
  }

  return {
    ok: false,
    needsRelink: true,
    message: `Tệp "${fileName}" là thẻ mẫu chưa gắn dữ liệu tệp thực tế. Hãy chọn tệp từ máy để gắn vào thẻ này.`,
  };
}
