import { useEffect, useRef, useState } from 'react';
import type { Card, Category } from '../../domain/types';
import { createId, extractHostname } from '../../domain/validate';
import { putImageAsset } from '../../storage/workspaceRepository';

interface IncomingWebClip {
  id: string;
  imageBase64?: string;
  mime?: string;
  fileName?: string;
  imageUrl?: string;
  pageUrl?: string;
  title?: string;
  category?: string;
  note?: string;
  clippedAt?: string;
}

const VALID_CATEGORIES = new Set<Category>([
  'reference',
  'furniture',
  'palette',
  'material',
  'sketch',
  'other',
]);

function base64ToBlob(base64: string, mime: string): Blob {
  const clean = base64.includes(',') ? base64.split(',')[1] : base64;
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime || 'image/jpeg' });
}

export function useClipperBridge(
  enabled: boolean,
  language: 'vi' | 'en',
  onClipCardReady: (card: Card) => void
): { bridgeAvailable: boolean } {
  const [bridgeAvailable, setBridgeAvailable] = useState(false);
  const processingRef = useRef(false);
  const handledIdsRef = useRef<Set<string>>(new Set());
  const cbRef = useRef(onClipCardReady);
  cbRef.current = onClipCardReady;

  useEffect(() => {
    if (!enabled || !bridgeAvailable) return;
    fetch('/__mosa_clip/lang', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: language }),
    }).catch(() => undefined);
  }, [enabled, bridgeAvailable, language]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: number | null = null;

    const drainPending = async () => {
      if (!alive || processingRef.current) return;
      processingRef.current = true;
      try {
        const res = await fetch('/__mosa_clip/pending', { cache: 'no-store' });
        if (!res.ok) return;
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) return;
        const data = (await res.json()) as { ok?: boolean; items?: IncomingWebClip[] };
        if (!data.ok || !Array.isArray(data.items) || data.items.length === 0) return;

        const ackIds: string[] = [];
        for (const item of data.items) {
          if (handledIdsRef.current.has(item.id)) {
            ackIds.push(item.id);
            continue;
          }
          handledIdsRef.current.add(item.id);

          const now = item.clippedAt || new Date().toISOString();
          const cat: Category =
            item.category && VALID_CATEGORIES.has(item.category as Category)
              ? (item.category as Category)
              : 'other';

          const fallbackTitle =
            item.title?.trim() ||
            (item.pageUrl ? extractHostname(item.pageUrl) : '') ||
            item.fileName ||
            'Web Clip';

          let assetId: string | undefined;
          let w = 280;
          let h = 210;
          let imageStatus: Card['imageStatus'] = 'remote-only';

          if (item.imageBase64) {
            try {
              const blob = base64ToBlob(item.imageBase64, item.mime || 'image/jpeg');
              const meta = await putImageAsset(blob, item.fileName || 'web-clip.jpg');
              assetId = meta.id;
              imageStatus = 'ready';
              if (meta.width > 0 && meta.height > 0) {
                const targetW = 280;
                const ratio = meta.width / meta.height;
                w = targetW;
                h = Math.max(120, Math.min(420, Math.round(targetW / Math.max(0.4, Math.min(2.6, ratio)))));
              }
            } catch {
              // Fall back to remote URL if decoding failed
            }
          }

          if (assetId || item.imageUrl) {
            const card: Card = {
              id: createId('crd'),
              kind: 'image',
              title: fallbackTitle,
              text: item.note?.trim() || '',
              category: cat,
              x: 120,
              y: 120,
              w,
              h,
              z: 1,
              inbox: true,
              locked: false,
              assetId,
              imageStatus,
              source: {
                pageUrl: item.pageUrl,
                imageUrl: item.imageUrl,
                fileName: item.fileName || 'web-clip.jpg',
                method: 'web-drop',
                capturedAt: now,
              },
              createdAt: now,
              updatedAt: now,
            };
            cbRef.current(card);
          }
          ackIds.push(item.id);
        }

        if (ackIds.length > 0) {
          await fetch('/__mosa_clip/ack', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: ackIds }),
          }).catch(() => undefined);
        }
      } catch {
        // Ignore transient bridge errors
      } finally {
        processingRef.current = false;
      }
    };

    const boot = async () => {
      try {
        const res = await fetch('/__mosa_clip/health', { cache: 'no-store' });
        const ct = res.headers.get('content-type') || '';
        if (!res.ok || !ct.includes('application/json')) return;
        const json = (await res.json()) as { ok?: boolean; app?: string };
        if (!alive || !json.ok || json.app !== 'Mosa') return;
        setBridgeAvailable(true);
        await drainPending();
        timer = window.setInterval(() => {
          void drainPending();
        }, 1800);
        window.addEventListener('focus', drainPending);
      } catch {
        // Static hosting without local bridge -> stay silently off
      }
    };

    void boot();
    return () => {
      alive = false;
      if (timer !== null) window.clearInterval(timer);
      window.removeEventListener('focus', drainPending);
    };
  }, [enabled]);

  return { bridgeAvailable };
}
