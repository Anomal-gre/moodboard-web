import type { CaptureMethod, Card } from '../../domain/types';
import type { Point } from '../../domain/geometry';
import {
  createId,
  extractHostname,
  isDesignFileName,
  isValidHttpUrl,
  looksLikeImageUrl,
  parseDroppedHtml,
} from '../../domain/validate';
import { putImageAsset } from '../../storage/workspaceRepository';

export interface CaptureBatchResult {
  cards: Card[];
  errors: string[];
}

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
    const { isDesign, extension } = isDesignFileName(file.name);

    if (isDesign) {
      cards.push({
        id: createId('crd'),
        kind: 'file',
        title: file.name,
        text: '',
        category: extension === 'dwg' || extension === 'dxf' || extension === 'skp' ? 'sketch' : 'other',
        x: Math.round(opts.worldPoint.x + offsetIdx * 28),
        y: Math.round(opts.worldPoint.y + offsetIdx * 28),
        w: 268,
        h: 86,
        z: opts.baseZ + offsetIdx,
        inbox: opts.inbox,
        locked: false,
        designFile: { extension, size: file.size },
        source: {
          fileName: file.name,
          method: opts.method,
          capturedAt: now,
        },
        createdAt: now,
        updatedAt: now,
      });
      offsetIdx++;
      continue;
    }

    // Attempt image decoding for image files or unknown extensions
    try {
      if (file.type && !file.type.startsWith('image/')) {
        throw new Error(`Không hỗ trợ định dạng tệp (${file.type}).`);
      }
      const meta = await putImageAsset(file, file.name);
      const { w, h } = fitInitialImageSize(meta.width, meta.height);
      cards.push({
        id: createId('crd'),
        kind: 'image',
        title: stripExtension(file.name) || 'Ảnh mới',
        text: '',
        category: 'other',
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
          fileName: file.name,
          method: opts.method,
          capturedAt: now,
        },
        createdAt: now,
        updatedAt: now,
      });
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
    // Try fetching image bytes (may fail due to CORS or auth — fall back safely)
    try {
      const resp = await fetch(trimmed, { mode: 'cors' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) {
        throw new Error('URL không trả về dữ liệu ảnh trực tiếp.');
      }
      const blob = await resp.blob();
      const fileName = opts.title || extractHostname(trimmed);
      const meta = await putImageAsset(blob, fileName);
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
            title: opts.title?.trim() || extractHostname(trimmed),
            text: '',
            category: 'other',
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
      // Fallback: create remote-only image card keeping URL intact so user can Replace Image (W08)
      const pageUrl =
        opts.pageUrl && isValidHttpUrl(opts.pageUrl) && opts.pageUrl !== trimmed
          ? opts.pageUrl
          : undefined;

      return {
        cards: [
          {
            id: createId('crd'),
            kind: 'image',
            title: opts.title?.trim() || extractHostname(trimmed),
            text: '',
            category: 'other',
            x: Math.round(opts.worldPoint.x),
            y: Math.round(opts.worldPoint.y),
            w: 260,
            h: 196,
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

  // Standard link card (preserves pageUrl cleanly without forcing remote image fetch)
  return {
    cards: [
      {
        id: createId('crd'),
        kind: 'link',
        title: opts.title?.trim() || extractHostname(trimmed),
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

  // 1. Real files dropped (from OS folder or browser carrying image bytes)
  if (dt.files && dt.files.length > 0) {
    const fileArr = Array.from(dt.files);
    const result = await importFilesAsCards(fileArr, {
      inbox: opts.inbox,
      worldPoint: opts.worldPoint,
      baseZ: opts.baseZ,
      method: parsedHtml.imageUrl || parsedHtml.pageUrl ? 'web-drop' : 'folder-drop',
    });
    // Attach parsed web source metadata if drag came from a web page
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
        c.title = parsedHtml.alt.slice(0, 80);
      }
    }
    return result;
  }

  // 2. HTML image drag from another browser tab (e.g., Pinterest)
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

  // 3. URI list or plain URL
  const firstUri =
    uriList
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#')) || plain;

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

  // 4. Plain text dropped -> create note card
  if (plain) {
    const now = new Date().toISOString();
    return {
      cards: [
        {
          id: createId('crd'),
          kind: 'note',
          title: 'Ghi chú',
          text: plain.slice(0, 2000),
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
