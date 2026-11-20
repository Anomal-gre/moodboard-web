import type { Card, ExportPngOptions, Project } from '../../domain/types';
import { computeCardsBounds, expandSelectionWithGroupMembers } from '../../domain/geometry';
import { extractHostname, getContrastTextColor, isDarkColor } from '../../domain/validate';
import { decodeImageElement } from '../../storage/assets';
import { getAssetBlob } from '../../storage/workspaceRepository';

export const MAX_EXPORT_EDGE = 12_000;
export const MAX_EXPORT_PIXELS = 36_000_000;
const EXPORT_PADDING = 32;

export interface ExportPrecheck {
  cards: Card[];
  widthPx: number;
  heightPx: number;
  tooLarge: boolean;
  missingImageCards: Card[];
}

export function getExportTargetCards(
  project: Project,
  selectedIds: string[],
  scope: 'all' | 'selection'
): Card[] {
  const boardCards = project.cards.filter((c) => !c.inbox);
  if (scope === 'all') return boardCards;
  const expanded = expandSelectionWithGroupMembers(boardCards, selectedIds);
  return boardCards.filter((c) => expanded.has(c.id));
}

export async function precheckExport(
  project: Project,
  selectedIds: string[],
  options: ExportPngOptions
): Promise<ExportPrecheck> {
  const cards = getExportTargetCards(project, selectedIds, options.scope);
  const bounds = computeCardsBounds(cards);
  if (!bounds) {
    return { cards: [], widthPx: 0, heightPx: 0, tooLarge: false, missingImageCards: [] };
  }

  const widthPx = Math.ceil((bounds.w + EXPORT_PADDING * 2) * options.scale);
  const heightPx = Math.ceil((bounds.h + EXPORT_PADDING * 2) * options.scale);
  const tooLarge =
    widthPx > MAX_EXPORT_EDGE ||
    heightPx > MAX_EXPORT_EDGE ||
    widthPx * heightPx > MAX_EXPORT_PIXELS;

  const missingImageCards: Card[] = [];
  for (const c of cards) {
    if (c.kind !== 'image') continue;
    if (!c.assetId) {
      missingImageCards.push(c);
      continue;
    }
    const blob = await getAssetBlob(c.assetId, false);
    if (!blob) {
      missingImageCards.push(c);
    }
  }

  return { cards, widthPx, heightPx, tooLarge, missingImageCards };
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxY: number
): number {
  const paragraphs = text.split('\n');
  let cursorY = y;

  for (const para of paragraphs) {
    if (!para) {
      cursorY += lineHeight * 0.7;
      continue;
    }
    const words = para.split(/\s+/);
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        if (cursorY > maxY) return cursorY;
        ctx.fillText(line, x, cursorY);
        cursorY += lineHeight;
        line = word;
      } else {
        line = test;
      }
    }
    if (line && cursorY <= maxY) {
      ctx.fillText(line, x, cursorY);
      cursorY += lineHeight;
    }
  }
  return cursorY;
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number
) {
  const imgRatio = img.naturalWidth / Math.max(1, img.naturalHeight);
  const boxRatio = w / Math.max(1, h);
  let sx = 0;
  let sy = 0;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  if (imgRatio > boxRatio) {
    sw = img.naturalHeight * boxRatio;
    sx = (img.naturalWidth - sw) / 2;
  } else {
    sh = img.naturalWidth / boxRatio;
    sy = (img.naturalHeight - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

export function slugifyFileName(name: string): string {
  const normalized = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'moodboard';
}

export function buildSourcesManifest(project: Project, exportedCards: Card[]) {
  return {
    format: 'moodboard-0y03-sources',
    version: 1,
    projectName: project.name,
    exportedAt: new Date().toISOString(),
    items: exportedCards
      .filter((c) => c.kind !== 'frame')
      .map((c) => ({
        id: c.id,
        kind: c.kind,
        title: c.title,
        category: c.category,
        pageUrl: c.source?.pageUrl ?? null,
        imageUrl: c.source?.imageUrl ?? null,
        fileName: c.source?.fileName ?? null,
        color: c.color ?? null,
      })),
  };
}

export async function renderMoodboardPng(
  project: Project,
  cards: Card[],
  options: ExportPngOptions
): Promise<Blob> {
  const bounds = computeCardsBounds(cards);
  if (!bounds) {
    throw new Error('Phạm vi xuất trống.');
  }

  const logicalW = bounds.w + EXPORT_PADDING * 2;
  const logicalH = bounds.h + EXPORT_PADDING * 2;
  const widthPx = Math.ceil(logicalW * options.scale);
  const heightPx = Math.ceil(logicalH * options.scale);

  if (
    widthPx > MAX_EXPORT_EDGE ||
    heightPx > MAX_EXPORT_EDGE ||
    widthPx * heightPx > MAX_EXPORT_PIXELS
  ) {
    throw new Error('Kích thước ảnh vượt ngưỡng an toàn.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Không thể khởi tạo Canvas 2D.');

  ctx.scale(options.scale, options.scale);

  const bg = project.appearance.background || '#F1F0EB';
  const darkTheme = isDarkColor(bg);
  if (options.includeBackground) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, logicalW, logicalH);
  }

  const offsetX = EXPORT_PADDING - bounds.x;
  const offsetY = EXPORT_PADDING - bounds.y;

  // Stable z-order sort
  const ordered = [...cards].sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));

  for (const card of ordered) {
    const x = card.x + offsetX;
    const y = card.y + offsetY;
    const { w, h } = card;

    ctx.save();

    if (card.kind === 'frame') {
      roundRectPath(ctx, x, y, w, h, 14);
      ctx.fillStyle = darkTheme ? 'rgba(104, 159, 131, 0.08)' : 'rgba(54, 91, 73, 0.055)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = darkTheme ? 'rgba(104, 159, 131, 0.36)' : 'rgba(54, 91, 73, 0.28)';
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '600 13px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = darkTheme ? '#B8C4BA' : '#365B49';
      ctx.fillText(card.title || 'Nhóm', x + 14, y + 24, w - 28);
      ctx.restore();
      continue;
    }

    // Subtle elevation shadow
    ctx.shadowColor = darkTheme ? 'rgba(0, 0, 0, 0.36)' : 'rgba(28, 36, 29, 0.12)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 4;

    if (card.kind === 'image') {
      roundRectPath(ctx, x, y, w, h, 10);
      ctx.fillStyle = darkTheme ? '#282E29' : '#FFFFFF';
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.clip();

      let rendered = false;
      if (card.assetId) {
        const blob = await getAssetBlob(card.assetId, false);
        if (blob) {
          try {
            const img = await decodeImageElement(blob);
            drawCoverImage(ctx, img, x, y, w, h);
            rendered = true;
          } catch {
            rendered = false;
          }
        }
      }

      if (!rendered) {
        ctx.fillStyle = darkTheme ? '#2E352F' : '#E8E7E0';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = darkTheme ? '#49534B' : '#C9CCC2';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 8, y + 8, w - 16, h - 16);
        ctx.fillStyle = darkTheme ? '#A6B0A7' : '#646F65';
        ctx.font = '600 13px "Segoe UI", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(card.title || 'Ảnh chưa sẵn sàng', x + w / 2, y + h / 2 - 4, w - 24);
        ctx.font = '11px "Segoe UI", Arial, sans-serif';
        ctx.fillText('(Ô giữ chỗ)', x + w / 2, y + h / 2 + 16, w - 24);
        ctx.textAlign = 'left';
      }
      ctx.restore();
      continue;
    }

    if (card.kind === 'note') {
      roundRectPath(ctx, x, y, w, h, 10);
      const noteBg = card.color || '#FAF7EE';
      ctx.fillStyle = noteBg;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(48, 58, 49, 0.12)';
      ctx.stroke();

      const textCol = getContrastTextColor(noteBg);
      ctx.fillStyle = textCol;
      let cursorY = y + 26;
      if (card.title) {
        ctx.font = '600 14px "Segoe UI", Arial, sans-serif';
        cursorY = drawWrappedText(ctx, card.title, x + 16, cursorY, w - 32, 20, y + h - 16);
        cursorY += 4;
      }
      if (card.text) {
        ctx.font = '400 13px "Segoe UI", Arial, sans-serif';
        ctx.globalAlpha = 0.88;
        drawWrappedText(ctx, card.text, x + 16, cursorY, w - 32, 19, y + h - 12);
      }
      ctx.restore();
      continue;
    }

    if (card.kind === 'color') {
      const hex = card.color || '#8D9A7C';
      const ink = getContrastTextColor(hex);
      roundRectPath(ctx, x, y, w, h, 10);
      ctx.fillStyle = hex;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.08)';
      ctx.stroke();

      ctx.fillStyle = ink;
      ctx.font = '600 14px "Segoe UI", Arial, sans-serif';
      ctx.fillText(card.title || hex, x + 14, y + h - 30, w - 28);
      ctx.font = '500 12px Consolas, monospace';
      ctx.globalAlpha = 0.82;
      ctx.fillText(hex.toUpperCase(), x + 14, y + h - 12, w - 28);
      ctx.restore();
      continue;
    }

    if (card.kind === 'link' || card.kind === 'file') {
      roundRectPath(ctx, x, y, w, h, 10);
      ctx.fillStyle = darkTheme ? '#282E29' : '#FBFCF8';
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.lineWidth = 1;
      ctx.strokeStyle = darkTheme ? '#3C443D' : '#E2E4DC';
      ctx.stroke();

      const badgeText =
        card.kind === 'file'
          ? (card.designFile?.extension || 'FILE').toUpperCase()
          : 'LINK';
      roundRectPath(ctx, x + 14, y + 14, 46, 22, 6);
      ctx.fillStyle = darkTheme ? 'rgba(104, 159, 131, 0.2)' : 'rgba(54, 91, 73, 0.12)';
      ctx.fill();
      ctx.fillStyle = darkTheme ? '#8EC5A9' : '#365B49';
      ctx.font = '700 10px "Segoe UI", Arial, sans-serif';
      ctx.fillText(badgeText, x + 21, y + 29);

      ctx.fillStyle = darkTheme ? '#EEF0EA' : '#303A31';
      ctx.font = '600 13px "Segoe UI", Arial, sans-serif';
      ctx.fillText(card.title || 'Tài liệu', x + 14, y + 54, w - 28);

      const sub =
        card.kind === 'link'
          ? extractHostname(card.source?.pageUrl || '')
          : card.text || card.source?.fileName || '';
      if (sub) {
        ctx.fillStyle = darkTheme ? '#9CA59D' : '#646F65';
        ctx.font = '400 12px "Segoe UI", Arial, sans-serif';
        ctx.fillText(sub, x + 14, y + 73, w - 28);
      }
      ctx.restore();
    }
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Không thể xuất PNG từ Canvas.'))),
      'image/png'
    );
  });

  canvas.width = 0;
  canvas.height = 0;
  return blob;
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
