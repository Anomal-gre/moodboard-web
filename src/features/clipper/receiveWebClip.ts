import type { Card } from '../../domain/types';
import { CATEGORY_ORDER } from '../../domain/types';
import { extractHostname } from '../../domain/validate';
import { base64ToBlob } from '../../storage/assets';
import { StorageQuotaError } from '../../storage/indexedDb';
import { getClipReceipt, type ClipReceipt } from '../../storage/projectWrites';
import { putImageAsset } from '../../storage/workspaceRepository';
import { isClipId, readWebClip, type IncomingWebClip } from './clipProtocol';

async function makeClipCard(clip: IncomingWebClip): Promise<Card | null> {
  const category = CATEGORY_ORDER.find((item) => item === clip.category) ?? 'other';
  const fileName = clip.fileName || 'web-clip.jpg';
  const title = clip.title?.trim() || (clip.pageUrl ? extractHostname(clip.pageUrl) : '') || fileName;
  const now = clip.clippedAt && Number.isFinite(Date.parse(clip.clippedAt)) ? clip.clippedAt : new Date().toISOString();
  let assetId: string | undefined;
  let height = 210;

  if (clip.imageBase64) {
    try {
      const blob = base64ToBlob(clip.imageBase64, clip.mime || 'image/jpeg');
      const meta = await putImageAsset(blob, fileName);
      assetId = meta.id;
      const ratio = meta.width / meta.height;
      if (Number.isFinite(ratio) && ratio > 0) {
        height = Math.max(120, Math.min(420, Math.round(280 / Math.max(0.4, Math.min(2.6, ratio)))));
      }
    } catch (error) {
      if (error instanceof StorageQuotaError || error instanceof DOMException && error.name !== 'InvalidCharacterError') {
        throw error;
      }
      // A remote URL remains useful when the original bytes cannot be decoded.
    }
  }
  if (!assetId && !clip.imageUrl) return null;
  return {
    id: `crd_web_${clip.id}`,
    kind: 'image',
    title,
    text: clip.note?.trim() || '',
    category,
    x: 120,
    y: 120,
    w: 280,
    h: height,
    z: 1,
    inbox: true,
    locked: false,
    assetId,
    imageStatus: assetId ? 'ready' : 'remote-only',
    source: { pageUrl: clip.pageUrl, imageUrl: clip.imageUrl, fileName, method: 'web-drop', capturedAt: now },
    createdAt: now,
    updatedAt: now,
  };
}

type CommitClip = (card: Card, projectId: string, clipId: string) => Promise<boolean>;

export function createClipReceiver(commit: CommitClip, canReceive: (projectId: string) => boolean) {
  const pending = new Map<string, Promise<ClipReceipt | undefined>>();
  return async (raw: unknown, projectId: unknown): Promise<ClipReceipt | undefined> => {
    const clip = readWebClip(raw);
    if (!clip || !isClipId(projectId)) return undefined;
    const active = pending.get(clip.id);
    if (active) return active;
    const ingest = (async () => {
      const existing = await getClipReceipt(clip.id);
      if (existing || !canReceive(projectId)) return existing;
      const card = await makeClipCard(clip);
      if (!card) return undefined;
      await commit(card, projectId, clip.id);
      return getClipReceipt(clip.id);
    })();
    pending.set(clip.id, ingest);
    try {
      return await ingest;
    } finally {
      pending.delete(clip.id);
    }
  };
}
