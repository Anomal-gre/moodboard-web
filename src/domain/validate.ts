import type { BackupFileV1, Card, CardKind, Category, Project } from './types';

const VALID_KINDS = new Set<CardKind>(['image', 'note', 'link', 'color', 'file', 'frame']);
const VALID_CATEGORIES = new Set<Category>([
  'reference',
  'furniture',
  'palette',
  'material',
  'sketch',
  'other',
]);

const DESIGN_EXTENSIONS = new Set([
  'dwg',
  'dxf',
  'psd',
  'ai',
  'indd',
  'skp',
  '3dm',
  'rvt',
  'max',
  'c4d',
  'blend',
  'eps',
]);

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function isValidHttpUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    // Reject URLs containing credentials
    if (parsed.username || parsed.password) return false;
    return true;
  } catch {
    return false;
  }
}

export function extractHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function normalizeHex(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) {
    return `#${trimmed.toUpperCase()}`;
  }
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return null;
}

export function isDarkColor(hex: string): boolean {
  const clean = normalizeHex(hex) ?? '#F1F0EB';
  const r = parseInt(clean.slice(1, 3), 16);
  const g = parseInt(clean.slice(3, 5), 16);
  const b = parseInt(clean.slice(5, 7), 16);
  // Relative perceived luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.52;
}

export function getContrastTextColor(hex: string): string {
  return isDarkColor(hex) ? '#F5F6F2' : '#262E27';
}

export function isDesignFileName(name: string): { isDesign: boolean; extension: string } {
  const idx = name.lastIndexOf('.');
  if (idx < 0) return { isDesign: false, extension: '' };
  const ext = name.slice(idx + 1).toLowerCase();
  return { isDesign: DESIGN_EXTENSIONS.has(ext), extension: ext };
}

export function looksLikeImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /\.(png|jpe?g|webp|gif|avif|bmp|svg)$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

/**
 * Safely parse HTML string from drag/paste events without inserting into live DOM.
 */
export function parseDroppedHtml(html: string): {
  imageUrl?: string;
  pageUrl?: string;
  alt?: string;
} {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const img = doc.querySelector('img');
    const anchor = img?.closest('a') ?? doc.querySelector('a');
    const rawImg = img?.getAttribute('src')?.trim();
    const rawHref = anchor?.getAttribute('href')?.trim();
    const alt = img?.getAttribute('alt')?.trim() || undefined;

    const imageUrl = rawImg && isValidHttpUrl(rawImg) ? rawImg : undefined;
    // Only treat anchor href as pageUrl if it isn't just the exact same direct CDN image URL
    let pageUrl: string | undefined;
    if (rawHref && isValidHttpUrl(rawHref)) {
      if (rawHref !== imageUrl && !looksLikeImageUrl(rawHref)) {
        pageUrl = rawHref;
      }
    }
    return { imageUrl, pageUrl, alt };
  } catch {
    return {};
  }
}

export function sanitizeCard(card: Card): Card {
  const kind: CardKind = VALID_KINDS.has(card.kind) ? card.kind : 'note';
  const category: Category = VALID_CATEGORIES.has(card.category) ? card.category : 'other';
  const source = card.source
    ? {
        ...card.source,
        pageUrl:
          card.source.pageUrl && isValidHttpUrl(card.source.pageUrl)
            ? card.source.pageUrl.trim()
            : undefined,
        imageUrl:
          card.source.imageUrl && isValidHttpUrl(card.source.imageUrl)
            ? card.source.imageUrl.trim()
            : undefined,
      }
    : undefined;

  return {
    ...card,
    kind,
    category,
    title: typeof card.title === 'string' ? card.title : '',
    text: typeof card.text === 'string' ? card.text : '',
    color: card.color ? (normalizeHex(card.color) ?? undefined) : undefined,
    x: isFiniteNumber(card.x) ? card.x : 0,
    y: isFiniteNumber(card.y) ? card.y : 0,
    w: isFiniteNumber(card.w) && card.w >= 40 ? card.w : 220,
    h: isFiniteNumber(card.h) && card.h >= 40 ? card.h : 160,
    z: isFiniteNumber(card.z) ? card.z : 1,
    inbox: Boolean(card.inbox),
    locked: Boolean(card.locked),
    source,
  };
}

export function validateBackupPayload(
  raw: unknown
): { ok: true; data: BackupFileV1 } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'Định dạng JSON không hợp lệ.' };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.format !== 'moodboard-0y03-backup' || obj.version !== 1) {
    return { ok: false, reason: 'Không đúng định dạng hoặc phiên bản bản sao 0Y03.' };
  }
  const project = obj.project as Partial<Project> | undefined;
  if (!project || typeof project !== 'object' || !Array.isArray(project.cards)) {
    return { ok: false, reason: 'Dữ liệu dự án trong bản sao bị thiếu hoặc hỏng.' };
  }
  if (!Array.isArray(obj.assets)) {
    return { ok: false, reason: 'Danh sách ảnh đính kèm không hợp lệ.' };
  }

  for (const card of project.cards) {
    if (!card || typeof card !== 'object' || typeof card.id !== 'string') {
      return { ok: false, reason: 'Phát hiện card không hợp lệ trong bản sao.' };
    }
    if (!VALID_KINDS.has(card.kind)) {
      return { ok: false, reason: `Loại card không được hỗ trợ: ${String(card.kind)}` };
    }
    if (!isFiniteNumber(card.x) || !isFiniteNumber(card.y) || !isFiniteNumber(card.w) || !isFiniteNumber(card.h)) {
      return { ok: false, reason: `Tọa độ card "${card.title || card.id}" không hợp lệ.` };
    }
  }

  for (const asset of obj.assets as Array<Record<string, unknown>>) {
    if (!asset || typeof asset !== 'object' || !asset.meta || typeof asset.base64 !== 'string') {
      return { ok: false, reason: 'Dữ liệu ảnh đính kèm bị hỏng.' };
    }
    const meta = asset.meta as Record<string, unknown>;
    if (typeof meta.id !== 'string' || typeof meta.mime !== 'string' || !meta.mime.startsWith('image/')) {
      return { ok: false, reason: 'Định dạng MIME ảnh trong bản sao không hợp lệ.' };
    }
  }

  return { ok: true, data: raw as BackupFileV1 };
}

export function createId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID().slice(0, 12)}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
