import { isValidHttpUrl } from '../../domain/validate';

export const MAX_CLIP_BASE64_LENGTH = 4 * Math.ceil(28 * 1024 * 1024 / 3);

export interface ClipDestination {
  projectId: string;
  projectName: string;
}

export interface IncomingWebClip {
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

export function isClipId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_\-]{1,96}$/.test(value);
}

export function readWebClip(value: unknown): IncomingWebClip | null {
  if (!value || typeof value !== 'object') return null;
  const clip = value as Record<string, unknown>;
  if (!isClipId(clip.id)) return null;
  const text = (value: unknown, limit: number) => typeof value === 'string' ? value.slice(0, limit) : undefined;
  const url = (value: unknown) => typeof value === 'string' && value.length <= 8192 && isValidHttpUrl(value)
    ? value.trim() : undefined;
  const imageUrl = url(clip.imageUrl);
  const mime = text(clip.mime, 80) || 'image/jpeg';
  const imageBase64 = typeof clip.imageBase64 === 'string' && clip.imageBase64.length > 0 &&
    clip.imageBase64.length <= MAX_CLIP_BASE64_LENGTH && /^image\/[a-z0-9.+-]+$/i.test(mime)
    ? clip.imageBase64 : undefined;
  if (!imageUrl && !imageBase64) return null;
  return {
    id: clip.id,
    imageUrl,
    imageBase64,
    mime,
    fileName: text(clip.fileName, 240),
    pageUrl: url(clip.pageUrl),
    title: text(clip.title, 180),
    category: text(clip.category, 32),
    note: text(clip.note, 800),
    clippedAt: text(clip.clippedAt, 40),
  };
}
