import type { Card } from '../domain/types';
import { isValidHttpUrl } from '../domain/validate';
import { getAssetBlob } from '../storage/workspaceRepository';
import { MAX_NATIVE_FILE_BYTES, nativeDesignFileName } from './designFilePolicy';

interface TauriInternals {
  invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: TauriInternals;
    __TAURI__?: { core?: TauriInternals };
  }
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__?.invoke || window.__TAURI__?.core?.invoke);
}

export async function invokeTauri<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const bridge = window.__TAURI_INTERNALS__ ?? window.__TAURI__?.core;
  if (!bridge?.invoke) throw new Error('Không ở trong môi trường Tauri Desktop.');
  return bridge.invoke<T>(cmd, args);
}

async function tryNativeOpen(fileName: string, blob: Blob): Promise<boolean> {
  const safeName = nativeDesignFileName(fileName);
  if (!safeName || !blob.size || blob.size > MAX_NATIVE_FILE_BYTES) return false;
  try {
    if (isTauriRuntime()) {
      await invokeTauri('open_file_bytes', { fileName: safeName, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) });
      return true;
    }
    if (location.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(location.hostname)) return false;
    const response = await fetch('/__local_open_file', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Mosa-App': '1',
        'X-Mosa-File-Name': encodeURIComponent(safeName),
      },
      body: blob,
    });
    return response.ok && response.headers.get('content-type')?.includes('application/json') === true &&
      (await response.json() as { ok?: boolean }).ok === true;
  } catch {
    return false;
  }
}

const TEXT_PREVIEWS = new Set(['txt', 'md', 'json', 'csv']);
const MEDIA_PREVIEWS = new Set(['mp4', 'webm', 'mp3', 'wav', 'ogg']);

function previewBlob(blob: Blob, extension: string): Blob | null {
  if (extension === 'pdf') return blob.slice(0, blob.size, 'application/pdf');
  if (TEXT_PREVIEWS.has(extension)) return blob.slice(0, blob.size, 'text/plain');
  if (MEDIA_PREVIEWS.has(extension) && /^(audio|video)\//.test(blob.type)) return blob;
  return null;
}

export async function openFileCard(
  card: Card,
): Promise<{ ok: boolean; message: string; needsRelink?: boolean }> {
  const fileName = card.source?.fileName || card.title || 'document';
  const extension = (card.designFile?.extension || '').toLowerCase();
  if (card.kind === 'file' && card.assetId) {
    try {
      const blob = await getAssetBlob(card.assetId, false);
      if (blob) {
        if (await tryNativeOpen(fileName, blob)) {
          return { ok: true, message: 'Đã mở tệp "' + fileName + '" trực tiếp trên máy.' };
        }
        const preview = previewBlob(blob, extension);
        const url = URL.createObjectURL(preview ?? blob);
        if (preview) {
          window.open(url, '_blank', 'noopener,noreferrer');
        } else {
          const link = document.createElement('a');
          link.href = url;
          link.download = fileName;
          document.body.appendChild(link);
          link.click();
          link.remove();
        }
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        return { ok: true, message: 'Đã mở tệp "' + fileName + '".' };
      }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Không thể mở tệp "' + fileName + '".' };
    }
  }

  if (card.source?.pageUrl && isValidHttpUrl(card.source.pageUrl)) {
    window.open(card.source.pageUrl, '_blank', 'noopener,noreferrer');
    return { ok: true, message: 'Đã mở liên kết nguồn của "' + fileName + '".' };
  }

  return {
    ok: false,
    needsRelink: true,
    message: 'Chưa có dữ liệu cho "' + fileName + '". Hãy chọn tệp từ máy để gắn vào thẻ.',
  };
}
