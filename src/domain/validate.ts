import type { BackupFileV1, Card, CardKind, Category, Project } from './types';

const VALID_KINDS = new Set<CardKind>(['image', 'note', 'link', 'color', 'file', 'frame']);
const VALID_CATEGORIES = new Set<Category>([
  'reference',
  'furniture',
  'palette',
  'material',
  'sketch',
  'typography',
  'other',
]);

const RENDERABLE_IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'svg',
  'avif',
  'bmp',
  'ico',
  'jfif',
]);

const RENDERABLE_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/avif',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
]);

const SKETCH_CAD_EXTENSIONS = new Set([
  'dwg',
  'dxf',
  'skp',
  '3dm',
  'rvt',
  'ifc',
  'pln',
  'vwx',
  'step',
  'stp',
  'iges',
  'igs',
]);

/**
 * Replaces all long dashes (em-dash, en-dash, horizontal bar) with standard ASCII hyphen '-'.
 */
export function normalizeDashes(raw: string): string {
  if (!raw) return '';
  return raw.replace(/[\u2012\u2013\u2014\u2015]/g, '-');
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function isValidHttpUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
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
  const clean = normalizeHex(hex) ?? '#F2F2F7';
  const r = parseInt(clean.slice(1, 3), 16);
  const g = parseInt(clean.slice(3, 5), 16);
  const b = parseInt(clean.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.52;
}

export function getContrastTextColor(hex: string): string {
  return isDarkColor(hex) ? '#F5F5F7' : '#1C1C1E';
}

/**
 * Extracts the file extension after the last dot (supports ALL extensions).
 */
export function extractFileExtension(name: string): string {
  const trimmed = name.trim();
  const idx = trimmed.lastIndexOf('.');
  if (idx <= 0 || idx === trimmed.length - 1) return 'file';
  const ext = trimmed.slice(idx + 1).toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return ext || 'file';
}

/**
 * Checks whether a file should be decoded as a canvas image card vs a general file card.
 */
export function isBrowserRenderableImage(fileName: string, mime?: string): boolean {
  const ext = extractFileExtension(fileName);
  const cleanMime = (mime || '').toLowerCase().trim();
  if (cleanMime && RENDERABLE_IMAGE_MIMES.has(cleanMime)) {
    return true;
  }
  if (!cleanMime && RENDERABLE_IMAGE_EXTENSIONS.has(ext)) {
    return true;
  }
  return false;
}

export function inferFileCategory(extension: string): Category {
  return SKETCH_CAD_EXTENSIONS.has(extension.toLowerCase()) ? 'sketch' : 'other';
}

export function isDesignFileName(name: string): { isDesign: boolean; extension: string } {
  const extension = extractFileExtension(name);
  const isImage = RENDERABLE_IMAGE_EXTENSIONS.has(extension);
  return { isDesign: !isImage, extension };
}

export function looksLikeImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /\.(png|jpe?g|webp|gif|avif|bmp|svg)$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function isValidImageDataUrl(raw: string): boolean {
  return /^data:image\/(png|jpe?g|webp|gif|svg\+xml|bmp|avif);base64,[a-zA-Z0-9+/=\s]+$/i.test(
    raw.trim()
  ) || /^data:image\/svg\+xml;(utf8|charset=utf-8),/i.test(raw.trim());
}

/**
 * Detects & sanitizes raw SVG markup copied from Adobe Illustrator, Figma or Canva.
 */
export function extractInlineSvg(raw: string): string | null {
  if (!raw || !raw.includes('<svg')) return null;
  const match = raw.match(/<svg[\s\S]*?<\/svg>/i);
  if (!match) return null;
  try {
    const doc = new DOMParser().parseFromString(match[0], 'image/svg+xml');
    const svg = doc.querySelector('svg');
    if (!svg || doc.querySelector('parsererror')) return null;
    // Strip any script or foreignObject/event handlers for safety
    svg.querySelectorAll('script, foreignObject').forEach((el) => el.remove());
    svg.querySelectorAll('*').forEach((el) => {
      for (const attr of Array.from(el.attributes)) {
        if (attr.name.toLowerCase().startsWith('on')) {
          el.removeAttribute(attr.name);
        }
      }
    });
    if (!svg.getAttribute('xmlns')) {
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }
    return new XMLSerializer().serializeToString(svg);
  } catch {
    return null;
  }
}

/**
 * Safely parse HTML string from drag/paste events (including Canva, Pinterest, Behance, Illustrator)
 * without inserting into live DOM.
 */
export function parseDroppedHtml(html: string): {
  imageUrl?: string;
  dataUrl?: string;
  inlineSvg?: string;
  pageUrl?: string;
  alt?: string;
} {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const img = doc.querySelector('img');
    const anchor = img?.closest('a') ?? doc.querySelector('a');
    let rawImg = img?.getAttribute('src')?.trim();

    // Check srcset for higher-res image (common in Canva & responsive web boards)
    const srcset = img?.getAttribute('srcset')?.trim();
    if (srcset) {
      const candidates = srcset
        .split(',')
        .map((s) => s.trim().split(/\s+/)[0])
        .filter((u) => u && isValidHttpUrl(u));
      if (candidates.length > 0) {
        rawImg = candidates[candidates.length - 1];
      }
    }

    // Check CSS background-image: url(...) if no <img> tag (common when dragging elements from Canva)
    if (!rawImg) {
      const bgEl = doc.querySelector('[style*="background-image"]');
      const styleStr = bgEl?.getAttribute('style') || '';
      const bgMatch = styleStr.match(/background-image\s*:\s*url\((['"]?)(.*?)\1\)/i);
      if (bgMatch?.[2]) {
        rawImg = bgMatch[2].trim();
      }
    }

    const rawHref = anchor?.getAttribute('href')?.trim();
    const alt = img?.getAttribute('alt')?.trim() || undefined;

    const imageUrl = rawImg && isValidHttpUrl(rawImg) ? rawImg : undefined;
    const dataUrl = rawImg && isValidImageDataUrl(rawImg) ? rawImg : undefined;
    const inlineSvg = !imageUrl && !dataUrl ? extractInlineSvg(html) ?? undefined : undefined;

    let pageUrl: string | undefined;
    if (rawHref && isValidHttpUrl(rawHref)) {
      if (rawHref !== imageUrl && !looksLikeImageUrl(rawHref)) {
        pageUrl = rawHref;
      }
    }
    return {
      imageUrl,
      dataUrl,
      inlineSvg,
      pageUrl,
      alt: alt ? normalizeDashes(alt) : undefined,
    };
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
          typeof card.source.pageUrl === 'string' && isValidHttpUrl(card.source.pageUrl)
            ? card.source.pageUrl.trim()
            : undefined,
        imageUrl:
          typeof card.source.imageUrl === 'string' && isValidHttpUrl(card.source.imageUrl)
            ? card.source.imageUrl.trim()
            : undefined,
      }
    : undefined;

  const rawCrop = card.crop;
  const crop =
    rawCrop &&
    isFiniteNumber(rawCrop.x) &&
    isFiniteNumber(rawCrop.y) &&
    isFiniteNumber(rawCrop.w) &&
    isFiniteNumber(rawCrop.h) &&
    rawCrop.w >= 0.08 &&
    rawCrop.h >= 0.08
      ? {
          x: Math.max(0, Math.min(0.92, rawCrop.x)),
          y: Math.max(0, Math.min(0.92, rawCrop.y)),
          w: Math.max(0.08, Math.min(1 - Math.max(0, rawCrop.x), rawCrop.w)),
          h: Math.max(0.08, Math.min(1 - Math.max(0, rawCrop.y), rawCrop.h)),
        }
      : undefined;

  const linksTo = Array.isArray(card.linksTo)
    ? card.linksTo.filter((id): id is string => typeof id === 'string' && id !== card.id)
    : undefined;

  const rawQty =
    card.spec && typeof card.spec === 'object' && typeof card.spec.qty === 'number'
      ? card.spec.qty
      : undefined;
  const spec =
    card.spec && typeof card.spec === 'object'
      ? {
          code: typeof card.spec.code === 'string' ? normalizeDashes(card.spec.code.slice(0, 80)) : undefined,
          price: typeof card.spec.price === 'string' ? normalizeDashes(card.spec.price.slice(0, 60)) : undefined,
          qty:
            rawQty !== undefined && Number.isFinite(rawQty) && rawQty >= 1
              ? Math.min(9999, Math.round(rawQty))
              : undefined,
        }
      : undefined;

  return {
    ...card,
    kind,
    category,
    title: typeof card.title === 'string' ? normalizeDashes(card.title) : '',
    text: typeof card.text === 'string' ? normalizeDashes(card.text) : '',
    color: typeof card.color === 'string' ? normalizeHex(card.color) ?? undefined : undefined,
    textColor: typeof card.textColor === 'string' ? normalizeHex(card.textColor) ?? undefined : undefined,
    dominantHex: typeof card.dominantHex === 'string' ? normalizeHex(card.dominantHex) ?? undefined : undefined,
    x: isFiniteNumber(card.x) ? card.x : 0,
    y: isFiniteNumber(card.y) ? card.y : 0,
    w: isFiniteNumber(card.w) && card.w >= 40 ? card.w : 220,
    h: isFiniteNumber(card.h) && card.h >= 40 ? card.h : 160,
    z: isFiniteNumber(card.z) ? card.z : 1,
    rotation: undefined,
    crop,
    flipH: Boolean(card.flipH) || undefined,
    cutout: Boolean(card.cutout) || undefined,
    originalAssetId: typeof card.originalAssetId === 'string' ? card.originalAssetId : undefined,
    linksTo: linksTo && linksTo.length > 0 ? linksTo : undefined,
    spec: spec && (spec.code || spec.price || spec.qty) ? spec : undefined,
    aiClassifiedAssetId:
      typeof card.aiClassifiedAssetId === 'string' ? card.aiClassifiedAssetId : undefined,
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
  if (
    (obj.format !== 'mosa-backup' && obj.format !== 'moodboard-0y03-backup') ||
    obj.version !== 1
  ) {
    return { ok: false, reason: 'Không đúng định dạng hoặc phiên bản bản sao Mosa.' };
  }
  const project = obj.project as Partial<Project> | undefined;
  if (!project || typeof project !== 'object' || !Array.isArray(project.cards)) {
    return { ok: false, reason: 'Dữ liệu dự án trong bản sao bị thiếu hoặc hỏng.' };
  }
  if (!Array.isArray(obj.assets)) {
    return { ok: false, reason: 'Danh sách tệp đính kèm không hợp lệ.' };
  }

  if (project.trash !== undefined && (!Array.isArray(project.trash) ||
      project.trash.some((item) => !item || typeof item !== 'object' || !item.card))) {
    return { ok: false, reason: 'Dữ liệu thùng rác trong bản sao không hợp lệ.' };
  }
  const cardIds = new Set<string>();
  for (const card of [...project.cards, ...(project.trash ?? []).map(({ card }) => card)]) {
    if (!card || typeof card !== 'object' || typeof card.id !== 'string' || !card.id || cardIds.has(card.id)) {
      return { ok: false, reason: 'Phát hiện card không hợp lệ trong bản sao.' };
    }
    cardIds.add(card.id);
    if (!VALID_KINDS.has(card.kind)) {
      return { ok: false, reason: `Loại card không được hỗ trợ: ${String(card.kind)}` };
    }
    if (!isFiniteNumber(card.x) || !isFiniteNumber(card.y) || !isFiniteNumber(card.w) || !isFiniteNumber(card.h)) {
      return { ok: false, reason: `Tọa độ card "${card.title || card.id}" không hợp lệ.` };
    }
  }

  const assetIds = new Set<string>();
  for (const asset of obj.assets as Array<Record<string, unknown>>) {
    if (!asset || typeof asset !== 'object' || !asset.meta || typeof asset.base64 !== 'string') {
      return { ok: false, reason: 'Dữ liệu tệp đính kèm bị hỏng.' };
    }
    const meta = asset.meta as Record<string, unknown>;
    if (typeof meta.id !== 'string' || !meta.id || assetIds.has(meta.id) || typeof meta.mime !== 'string') {
      return { ok: false, reason: 'Định dạng MIME tệp trong bản sao không hợp lệ.' };
    }
    assetIds.add(meta.id);
  }

  return { ok: true, data: raw as BackupFileV1 };
}

export function createId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID().slice(0, 12)}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
