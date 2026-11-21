import type { CaptureMethod, Card } from '../../domain/types';
import type { Point } from '../../domain/geometry';
import {
  createId,
  extractFileExtension,
  extractHostname,
  extractInlineSvg,
  inferFileCategory,
  isBrowserRenderableImage,
  isValidHttpUrl,
  looksLikeImageUrl,
  normalizeDashes,
  parseDroppedHtml,
} from '../../domain/validate';
import { extractDominantHexFromBlob } from '../../domain/paletteExtract';
import { putImageAsset, putRawFileAsset } from '../../storage/workspaceRepository';

export interface CaptureBatchResult {
  cards: Card[];
  errors: string[];
}

const MAX_STORED_FILE_BYTES = 150 * 1024 * 1024; // 150 MB

function fitInitialImageSize(width: number, height: number): { w: number; h: number } {
  const maxW = 300;
  const maxH = 340;
  const ratio = width > 0 && height > 0 ? height / width : 0.75;
  let w = maxW;
  let h = Math.round(w * ratio);
  if (h > maxH) {
    h = maxH;
    w = Math.max(150, Math.round(h / ratio));
  }
  return { w: Math.max(160, w), h: Math.max(120, h) };
}

function stripExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(0, idx) : name;
}

async function createUniversalFileCard(
  file: File,
  offsetIdx: number,
  opts: {
    inbox: boolean;
    worldPoint: Point;
    baseZ: number;
    method: CaptureMethod;
  }
): Promise<Card> {
  const now = new Date().toISOString();
  const extension = extractFileExtension(file.name);
  const localPath = (file as File & { path?: string }).path;
  let assetId: string | undefined;

  if (file.size > 0 && file.size <= MAX_STORED_FILE_BYTES) {
    try {
      const meta = await putRawFileAsset(file, file.name);
      assetId = meta.id;
    } catch {
      // Keep card working even if IndexedDB quota is tight
    }
  }

  return {
    id: createId('crd'),
    kind: 'file',
    title: normalizeDashes(file.name),
    text: '',
    category: inferFileCategory(extension),
    x: Math.round(opts.worldPoint.x + (offsetIdx % 3) * 32),
    y: Math.round(opts.worldPoint.y + Math.floor(offsetIdx / 3) * 96 + (offsetIdx % 3) * 24),
    w: 276,
    h: 88,
    z: opts.baseZ + offsetIdx,
    inbox: opts.inbox,
    locked: false,
    assetId,
    designFile: {
      extension,
      size: file.size,
      mime: file.type || undefined,
      localPath,
    },
    source: {
      fileName: normalizeDashes(file.name),
      localPath,
      method: opts.method,
      capturedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export async function importFilesAsCards(
  files: File[],
  opts: {
    inbox: boolean;
    worldPoint: Point;
    baseZ: number;
    method: CaptureMethod;
  }
): Promise<CaptureBatchResult> {
  const cards: Card[] = [];
  const errors: string[] = [];
  let offsetIdx = 0;

  for (const file of files) {
    const now = new Date().toISOString();
    const localPath = (file as File & { path?: string }).path;

    if (isBrowserRenderableImage(file.name, file.type)) {
      try {
        const [meta, dominantHex] = await Promise.all([
          putImageAsset(file, file.name),
          extractDominantHexFromBlob(file),
        ]);
        const { w, h } = fitInitialImageSize(meta.width, meta.height);
        cards.push({
          id: createId('crd'),
          kind: 'image',
          title: normalizeDashes(stripExtension(file.name)) || 'Image',
          text: '',
          category: 'other',
          dominantHex,
          x: Math.round(opts.worldPoint.x + (offsetIdx % 4) * 32),
          y: Math.round(opts.worldPoint.y + Math.floor(offsetIdx / 4) * 32 + (offsetIdx % 4) * 20),
          w,
          h,
          z: opts.baseZ + offsetIdx,
          inbox: opts.inbox,
          locked: false,
          assetId: meta.id,
          imageStatus: 'ready',
          source: {
            fileName: normalizeDashes(file.name),
            localPath,
            method: opts.method,
            capturedAt: now,
          },
          createdAt: now,
          updatedAt: now,
        });
        offsetIdx++;
        continue;
      } catch {
        // Fallback: if browser cannot decode image (e.g. CMYK or special codec), import as File card
      }
    }

    // Any other file extension (.pdf, .docx, .xlsx, .dwg, .psd, .skp, .zip, .mp4, etc.) -> File Card
    try {
      const fileCard = await createUniversalFileCard(file, offsetIdx, opts);
      cards.push(fileCard);
      offsetIdx++;
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Lỗi đọc tệp.';
      errors.push(`${file.name}: ${reason}`);
    }
  }

  return { cards, errors };
}

export async function importUrlAsCard(
  rawUrl: string,
  opts: {
    title?: string;
    pageUrl?: string;
    tryAsImage?: boolean;
    inbox: boolean;
    worldPoint: Point;
    baseZ: number;
    method: CaptureMethod;
  }
): Promise<CaptureBatchResult> {
  const trimmed = rawUrl.trim();
  if (!isValidHttpUrl(trimmed)) {
    return {
      cards: [],
      errors: ['URL không hợp lệ (chỉ nhận http:// hoặc https:// không chứa mật khẩu).'],
    };
  }

  const now = new Date().toISOString();
  const isLikelyImg = opts.tryAsImage || looksLikeImageUrl(trimmed);

  if (isLikelyImg && opts.tryAsImage) {
    // 1. Try fetching image bytes cleanly with no-referrer (supports Pinterest i.pinimg.com & many CDNs)
    try {
      const resp = await fetch(trimmed, { mode: 'cors', referrerPolicy: 'no-referrer' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const contentType = resp.headers.get('content-type') || '';
      if (contentType && !contentType.startsWith('image/') && !contentType.includes('octet-stream')) {
        throw new Error('URL không trả về dữ liệu ảnh trực tiếp.');
      }
      const blob = await resp.blob();
      const fileName = opts.title || extractHostname(trimmed);
      const [meta, dominantHex] = await Promise.all([
        putImageAsset(blob, fileName),
        extractDominantHexFromBlob(blob),
      ]);
      const { w, h } = fitInitialImageSize(meta.width, meta.height);

      const pageUrl =
        opts.pageUrl && isValidHttpUrl(opts.pageUrl) && opts.pageUrl !== trimmed
          ? opts.pageUrl
          : undefined;

      return {
        cards: [
          {
            id: createId('crd'),
            kind: 'image',
            title: normalizeDashes(opts.title?.trim() || extractHostname(trimmed)),
            text: '',
            category: 'other',
            dominantHex,
            x: Math.round(opts.worldPoint.x),
            y: Math.round(opts.worldPoint.y),
            w,
            h,
            z: opts.baseZ,
            inbox: opts.inbox,
            locked: false,
            assetId: meta.id,
            imageStatus: 'ready',
            source: {
              pageUrl,
              imageUrl: trimmed,
              method: opts.method,
              capturedAt: now,
            },
            createdAt: now,
            updatedAt: now,
          },
        ],
        errors: [],
      };
    } catch {
      // 2. CORS blocked fetch(): probe real natural dimensions via <img> with no-referrer so tall pins keep true aspect ratio!
      const probedSize = await new Promise<{ w: number; h: number }>((resolve) => {
        const img = new Image();
        img.referrerPolicy = 'no-referrer';
        const timeout = window.setTimeout(() => resolve({ w: 260, h: 196 }), 3000);
        img.onload = () => {
          window.clearTimeout(timeout);
          resolve(fitInitialImageSize(img.naturalWidth, img.naturalHeight));
        };
        img.onerror = () => {
          window.clearTimeout(timeout);
          resolve({ w: 260, h: 196 });
        };
        img.src = trimmed;
      });

      const pageUrl =
        opts.pageUrl && isValidHttpUrl(opts.pageUrl) && opts.pageUrl !== trimmed
          ? opts.pageUrl
          : undefined;

      return {
        cards: [
          {
            id: createId('crd'),
            kind: 'image',
            title: normalizeDashes(opts.title?.trim() || extractHostname(trimmed)),
            text: '',
            category: 'other',
            x: Math.round(opts.worldPoint.x),
            y: Math.round(opts.worldPoint.y),
            w: probedSize.w,
            h: probedSize.h,
            z: opts.baseZ,
            inbox: opts.inbox,
            locked: false,
            imageStatus: 'remote-only',
            source: {
              pageUrl,
              imageUrl: trimmed,
              method: opts.method,
              capturedAt: now,
            },
            createdAt: now,
            updatedAt: now,
          },
        ],
        errors: [],
      };
    }
  }

  return {
    cards: [
      {
        id: createId('crd'),
        kind: 'link',
        title: normalizeDashes(opts.title?.trim() || extractHostname(trimmed)),
        text: '',
        category: 'reference',
        x: Math.round(opts.worldPoint.x),
        y: Math.round(opts.worldPoint.y),
        w: 276,
        h: 112,
        z: opts.baseZ,
        inbox: opts.inbox,
        locked: false,
        source: {
          pageUrl: trimmed,
          method: opts.method,
          capturedAt: now,
        },
        createdAt: now,
        updatedAt: now,
      },
    ],
    errors: [],
  };
}

export async function importInlineSvgAsCard(
  svgMarkup: string,
  opts: {
    title?: string;
    inbox: boolean;
    worldPoint: Point;
    baseZ: number;
    method: CaptureMethod;
  }
): Promise<CaptureBatchResult> {
  const fileName = `${opts.title || 'Illustrator-Vector'}.svg`;
  const svgFile = new File([svgMarkup], fileName, { type: 'image/svg+xml' });
  return importFilesAsCards([svgFile], {
    inbox: opts.inbox,
    worldPoint: opts.worldPoint,
    baseZ: opts.baseZ,
    method: opts.method,
  });
}

export async function importDataUrlAsCard(
  dataUrl: string,
  opts: {
    title?: string;
    pageUrl?: string;
    inbox: boolean;
    worldPoint: Point;
    baseZ: number;
    method: CaptureMethod;
  }
): Promise<CaptureBatchResult> {
  try {
    const resp = await fetch(dataUrl);
    const blob = await resp.blob();
    const ext = (blob.type.split('/')[1] || 'png').replace('svg+xml', 'svg');
    const file = new File([blob], `${opts.title || 'Canva-Graphic'}.${ext}`, {
      type: blob.type || 'image/png',
    });
    const res = await importFilesAsCards([file], {
      inbox: opts.inbox,
      worldPoint: opts.worldPoint,
      baseZ: opts.baseZ,
      method: opts.method,
    });
    if (res.cards[0] && opts.pageUrl) {
      res.cards[0].source = {
        ...res.cards[0].source!,
        pageUrl: opts.pageUrl,
      };
    }
    return res;
  } catch (err) {
    return {
      cards: [],
      errors: [err instanceof Error ? err.message : 'Failed to decode dropped image.'],
    };
  }
}

export async function importWebDropData(
  dt: DataTransfer,
  opts: {
    inbox: boolean;
    worldPoint: Point;
    baseZ: number;
  }
): Promise<CaptureBatchResult> {
  const html = dt.getData('text/html');
  const uriList = dt.getData('text/uri-list');
  const plain = dt.getData('text/plain').trim();
  const parsedHtml = html ? parseDroppedHtml(html) : {};

  // 1. Real files dropped (from OS folder, Photoshop/Illustrator export, or browser carrying file bytes)
  if (dt.files && dt.files.length > 0) {
    const fileArr = Array.from(dt.files);
    const result = await importFilesAsCards(fileArr, {
      inbox: opts.inbox,
      worldPoint: opts.worldPoint,
      baseZ: opts.baseZ,
      method: parsedHtml.imageUrl || parsedHtml.pageUrl ? 'web-drop' : 'folder-drop',
    });
    if (result.cards.length === 1 && (parsedHtml.imageUrl || parsedHtml.pageUrl)) {
      const c = result.cards[0];
      c.source = {
        ...c.source,
        pageUrl: parsedHtml.pageUrl,
        imageUrl: parsedHtml.imageUrl,
        method: 'web-drop',
        capturedAt: c.source?.capturedAt || new Date().toISOString(),
      };
      if (parsedHtml.alt && (!c.title || c.title === 'image')) {
        c.title = normalizeDashes(parsedHtml.alt.slice(0, 80));
      }
    }
    return result;
  }

  // 2. Data URL or Inline SVG dropped from Canva / Illustrator / Figma
  if (parsedHtml.dataUrl) {
    return importDataUrlAsCard(parsedHtml.dataUrl, {
      title: parsedHtml.alt,
      pageUrl: parsedHtml.pageUrl,
      inbox: opts.inbox,
      worldPoint: opts.worldPoint,
      baseZ: opts.baseZ,
      method: 'web-drop',
    });
  }

  const inlineSvg = parsedHtml.inlineSvg || extractInlineSvg(plain);
  if (inlineSvg) {
    return importInlineSvgAsCard(inlineSvg, {
      title: parsedHtml.alt || 'Vector SVG',
      inbox: opts.inbox,
      worldPoint: opts.worldPoint,
      baseZ: opts.baseZ,
      method: 'web-drop',
    });
  }

  // 3. HTML image drag from another browser tab (Canva / Pinterest / Behance)
  if (parsedHtml.imageUrl) {
    return importUrlAsCard(parsedHtml.imageUrl, {
      title: parsedHtml.alt,
      pageUrl: parsedHtml.pageUrl,
      tryAsImage: true,
      inbox: opts.inbox,
      worldPoint: opts.worldPoint,
      baseZ: opts.baseZ,
      method: 'web-drop',
    });
  }

  // 4. URI list or plain URL (including data:image/... URI)
  const firstUri =
    uriList
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#')) || plain;

  if (firstUri && firstUri.startsWith('data:image/')) {
    return importDataUrlAsCard(firstUri, {
      inbox: opts.inbox,
      worldPoint: opts.worldPoint,
      baseZ: opts.baseZ,
      method: 'web-drop',
    });
  }

  if (firstUri && isValidHttpUrl(firstUri)) {
    const asImage = looksLikeImageUrl(firstUri);
    return importUrlAsCard(firstUri, {
      pageUrl: asImage ? undefined : firstUri,
      tryAsImage: asImage,
      inbox: opts.inbox,
      worldPoint: opts.worldPoint,
      baseZ: opts.baseZ,
      method: 'web-drop',
    });
  }

  // 5. Plain text dropped -> create note card
  if (plain) {
    const now = new Date().toISOString();
    return {
      cards: [
        {
          id: createId('crd'),
          kind: 'note',
          title: 'Ghi chú',
          text: normalizeDashes(plain.slice(0, 2000)),
          color: '#FAF7EE',
          category: 'other',
          x: Math.round(opts.worldPoint.x),
          y: Math.round(opts.worldPoint.y),
          w: 256,
          h: 150,
          z: opts.baseZ,
          inbox: opts.inbox,
          locked: false,
          source: { method: 'web-drop', capturedAt: now },
          createdAt: now,
          updatedAt: now,
        },
      ],
      errors: [],
    };
  }

  return { cards: [], errors: [] };
}

export async function replaceCardImageFile(
  file: File
): Promise<{ assetId: string; width: number; height: number }> {
  const meta = await putImageAsset(file, file.name);
  return { assetId: meta.id, width: meta.width, height: meta.height };
}

export async function replaceCardRawFile(
  file: File
): Promise<{
  assetId: string;
  extension: string;
  size: number;
  mime?: string;
  fileName: string;
  localPath?: string;
}> {
  const meta = await putRawFileAsset(file, file.name);
  const extension = extractFileExtension(file.name);
  const localPath = (file as File & { path?: string }).path;
  return {
    assetId: meta.id,
    extension,
    size: file.size,
    mime: file.type || undefined,
    fileName: normalizeDashes(file.name),
    localPath,
  };
}
