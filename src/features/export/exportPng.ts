import type { Card, ExportPngOptions, Project, StudioProfile } from '../../domain/types';
import {
  computeCardsBounds,
  computeConnectorCurve,
  expandSelectionWithGroupMembers,
} from '../../domain/geometry';
import { extractHostname, getContrastTextColor, isDarkColor } from '../../domain/validate';
import { getCategoryLabel, type I18nDict } from '../../i18n';
import { decodeImageElement } from '../../storage/assets';
import { getAssetBlob, resolveAssetUrl } from '../../storage/workspaceRepository';
import { computeFfeBudget, formatCurrency } from './ffeBudget';

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
  h: number,
  crop?: { x: number; y: number; w: number; h: number },
  flipH?: boolean
) {
  let sx = 0;
  let sy = 0;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;

  if (crop && crop.w > 0.05 && crop.h > 0.05) {
    sx = crop.x * img.naturalWidth;
    sy = crop.y * img.naturalHeight;
    sw = crop.w * img.naturalWidth;
    sh = crop.h * img.naturalHeight;
  } else {
    const imgRatio = img.naturalWidth / Math.max(1, img.naturalHeight);
    const boxRatio = w / Math.max(1, h);
    if (imgRatio > boxRatio) {
      sw = img.naturalHeight * boxRatio;
      sx = (img.naturalWidth - sw) / 2;
    } else {
      sh = img.naturalWidth / boxRatio;
      sy = (img.naturalHeight - sh) / 2;
    }
  }

  ctx.save();
  if (flipH) {
    ctx.translate(x + w, y);
    ctx.scale(-1, 1);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  } else {
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }
  ctx.restore();
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
    format: 'mosa-sources',
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
      ctx.fillStyle = card.color
        ? `${card.color}2e`
        : darkTheme
          ? 'rgba(104, 159, 131, 0.08)'
          : 'rgba(54, 91, 73, 0.055)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = card.color
        ? card.color
        : darkTheme
          ? 'rgba(104, 159, 131, 0.36)'
          : 'rgba(54, 91, 73, 0.28)';
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '600 13px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = card.textColor || (darkTheme ? '#B8C4BA' : '#365B49');
      ctx.fillText(card.title || 'Nhóm', x + 14, y + 24, w - 28);
      ctx.restore();
      continue;
    }

    // Subtle elevation shadow
    ctx.shadowColor = darkTheme ? 'rgba(0, 0, 0, 0.36)' : 'rgba(28, 36, 29, 0.12)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 4;

    if (card.kind === 'image') {
      const isCutout = Boolean(card.cutout);
      const pad = !isCutout && card.framed ? 6 : 0;
      if (!isCutout) {
        roundRectPath(ctx, x, y, w, h, 10);
        ctx.fillStyle = card.framed ? '#FFFFFF' : darkTheme ? '#282E29' : '#FFFFFF';
        ctx.fill();
        ctx.shadowColor = 'transparent';
        if (card.framed) {
          ctx.lineWidth = 1;
          ctx.strokeStyle = 'rgba(48, 58, 49, 0.12)';
          ctx.stroke();
        }
      }
      ctx.save();
      if (!isCutout) {
        roundRectPath(ctx, x + pad, y + pad, Math.max(1, w - pad * 2), Math.max(1, h - pad * 2), card.framed ? 6 : 10);
        ctx.clip();
      }

      let rendered = false;
      if (card.assetId) {
        const blob = await getAssetBlob(card.assetId, false);
        if (blob) {
          try {
            const img = await decodeImageElement(blob);
            drawCoverImage(
              ctx,
              img,
              x + pad,
              y + pad,
              Math.max(1, w - pad * 2),
              Math.max(1, h - pad * 2),
              card.crop,
              card.flipH
            );
            rendered = true;
          } catch {
            rendered = false;
          }
        }
      } else if (card.source?.imageUrl) {
        try {
          const resp = await fetch(card.source.imageUrl, {
            mode: 'cors',
            referrerPolicy: 'no-referrer',
          });
          if (resp.ok) {
            const blob = await resp.blob();
            const img = await decodeImageElement(blob);
            drawCoverImage(
              ctx,
              img,
              x + pad,
              y + pad,
              Math.max(1, w - pad * 2),
              Math.max(1, h - pad * 2),
              card.crop,
              card.flipH
            );
            rendered = true;
          }
        } catch {
          rendered = false;
        }
      }

      if (!rendered) {
        ctx.fillStyle = darkTheme ? '#2E352F' : '#E8E7E0';
        ctx.fillRect(x + pad, y + pad, w - pad * 2, h - pad * 2);
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

      const textCol = card.textColor || getContrastTextColor(noteBg);
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
      const ink = card.textColor || getContrastTextColor(hex);
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
      const defaultFill =
        darkTheme
          ? card.kind === 'file'
            ? '#EBF1F7'
            : '#F0F3F8'
          : '#FBFCF8';
      const fillBg = card.color || defaultFill;
      const primaryInk = card.textColor || getContrastTextColor(fillBg);
      ctx.fillStyle = fillBg;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.lineWidth = 1;
      ctx.strokeStyle = darkTheme ? 'rgba(160, 188, 218, 0.48)' : '#E2E4DC';
      ctx.stroke();

      const badgeText =
        card.kind === 'file'
          ? (card.designFile?.extension || 'FILE').toUpperCase()
          : 'LINK';
      roundRectPath(ctx, x + 14, y + 14, 46, 22, 6);
      ctx.fillStyle = 'rgba(0, 122, 255, 0.14)';
      ctx.fill();
      ctx.fillStyle = '#0066D6';
      ctx.font = '700 10px "Segoe UI", Arial, sans-serif';
      ctx.fillText(badgeText, x + 21, y + 29);

      ctx.fillStyle = primaryInk;
      ctx.font = '600 13px "Segoe UI", Arial, sans-serif';
      ctx.fillText(card.title || 'Tài liệu', x + 14, y + 54, w - 28);

      const sub =
        card.kind === 'link'
          ? extractHostname(card.source?.pageUrl || '')
          : card.text || card.source?.fileName || '';
      if (sub) {
        ctx.fillStyle = primaryInk;
        ctx.globalAlpha = 0.72;
        ctx.font = '400 12px "Segoe UI", Arial, sans-serif';
        ctx.fillText(sub, x + 14, y + 73, w - 28);
      }
      ctx.restore();
    }
  }

  // Draw Milanote/FigJam-style edge-to-edge curved arrows above cards
  const cardById = new Map(ordered.map((c) => [c.id, c]));
  for (const src of ordered) {
    if (!src.linksTo || src.linksTo.length === 0) continue;
    for (const targetId of src.linksTo) {
      const dst = cardById.get(targetId);
      if (!dst) continue;
      const curve = computeConnectorCurve(
        { x: src.x + offsetX, y: src.y + offsetY, w: src.w, h: src.h },
        { x: dst.x + offsetX, y: dst.y + offsetY, w: dst.w, h: dst.h }
      );
      const strokeCol = darkTheme ? '#38BDF8' : '#0A84FF';

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(curve.sx, curve.sy);
      ctx.bezierCurveTo(curve.c1x, curve.c1y, curve.c2x, curve.c2y, curve.ex, curve.ey);
      ctx.strokeStyle = strokeCol;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Origin anchor dot
      ctx.beginPath();
      ctx.arc(curve.sx, curve.sy, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = strokeCol;
      ctx.fill();

      // Sharp arrowhead at destination edge
      ctx.translate(curve.ex, curve.ey);
      ctx.rotate(curve.endAngle);
      ctx.beginPath();
      ctx.moveTo(1, 0);
      ctx.lineTo(-9, -4.4);
      ctx.lineTo(-6.8, 0);
      ctx.lineTo(-9, 4.4);
      ctx.closePath();
      ctx.fillStyle = strokeCol;
      ctx.fill();
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

function escapeCsvCell(val: string): string {
  const clean = (val || '').replace(/\r?\n/g, ' ').trim();
  if (/[",]/.test(clean)) {
    return `"${clean.replace(/"/g, '""')}"`;
  }
  return clean;
}

/**
 * Renders a lightweight JPEG cover thumbnail (~520px wide) for the Project Hub gallery.
 */
export async function renderProjectCoverDataUrl(project: Project): Promise<string | undefined> {
  const boardCards = project.cards.filter((c) => !c.inbox && c.kind !== 'frame');
  if (boardCards.length === 0) return undefined;
  try {
    const pngBlob = await renderMoodboardPng(project, project.cards.filter((c) => !c.inbox), {
      scope: 'all',
      scale: 1,
      includeBackground: true,
      includeSourcesJson: false,
    });
    const img = await decodeImageElement(pngBlob);
    const maxW = 540;
    const scale = Math.min(1, maxW / Math.max(1, img.naturalWidth || img.width));
    const outW = Math.max(120, Math.round((img.naturalWidth || img.width) * scale));
    const outH = Math.max(80, Math.round((img.naturalHeight || img.height) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(img, 0, 0, outW, outH);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
    canvas.width = 0;
    canvas.height = 0;
    return dataUrl;
  } catch {
    return undefined;
  }
}

/**
 * Exports a UTF-8 BOM CSV schedule of all board items (FF&E Material & Furniture Schedule)
 * with Qty, Line Total, and Estimated Grand Total Budget for Excel / Google Sheets.
 */
export function exportFfeScheduleCsv(
  project: Project,
  cards: Card[],
  dict: I18nDict,
  studioProfile?: StudioProfile
): void {
  const items = cards.filter((c) => !c.inbox && c.kind !== 'frame');
  const budget = computeFfeBudget(items, studioProfile);
  const headers = [
    '#',
    dict.titleLabel,
    dict.categoryLabel,
    dict.ffeCodeLabel,
    dict.ffeQtyLabel,
    dict.ffePriceLabel,
    dict.ffeLineTotalLabel,
    dict.hexLabel,
    dict.captionLabel,
    dict.pageUrlLabel,
  ];
  const rows = budget.rows.map((row, idx) => {
    const c = row.card;
    return [
      String(idx + 1),
      c.title || c.kind.toUpperCase(),
      getCategoryLabel(dict, c.category),
      c.spec?.code || '',
      String(row.qty),
      c.spec?.price || '',
      row.lineTotal !== null ? formatCurrency(row.lineTotal, budget.currency) : '',
      c.color || c.dominantHex || '',
      c.text || '',
      c.source?.pageUrl || c.source?.imageUrl || c.source?.fileName || '',
    ];
  });

  if (budget.pricedCount > 0) {
    rows.push([
      '',
      dict.ffeTotalBudgetLabel,
      '',
      '',
      '',
      '',
      formatCurrency(budget.grandTotal, budget.currency),
      '',
      '',
      '',
    ]);
  }

  const csvBody = [headers, ...rows]
    .map((r) => r.map(escapeCsvCell).join(','))
    .join('\r\n');
  // Prepend UTF-8 BOM so Excel detects Vietnamese Unicode automatically
  const blob = new Blob([`\uFEFF${csvBody}`], { type: 'text/csv;charset=utf-8' });
  triggerBlobDownload(blob, `${slugifyFileName(project.name)}-FFE-Schedule.csv`);
}

function escapeHtml(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Generates a studio-grade White-Label printable A4 Client Presentation & FF&E Cut Sheet deck
 * (Page 1: Full Moodboard Spread with Studio Logo & Client Block;
 *  Page 2+: FF&E Specification Schedule with Qty, Subtotals & Total Estimated Budget).
 */
export async function openFfePrintSpecWindow(
  project: Project,
  cards: Card[],
  dict: I18nDict,
  studioProfile?: StudioProfile
): Promise<void> {
  const items = cards.filter((c) => !c.inbox && c.kind !== 'frame');
  const budget = computeFfeBudget(items, studioProfile);
  const pngBlob = await renderMoodboardPng(project, items, {
    scope: 'all',
    scale: 2,
    includeBackground: true,
    includeSourcesJson: false,
  });
  const boardDataUrl = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(pngBlob);
  });

  const thumbMap = new Map<string, string>();
  for (const c of items) {
    if (c.kind === 'image' && c.assetId) {
      const u = await resolveAssetUrl(c.assetId, 'thumb');
      if (u) thumbMap.set(c.id, u);
    } else if (c.kind === 'image' && c.source?.imageUrl) {
      thumbMap.set(c.id, c.source.imageUrl);
    }
  }

  const isVi = dict.exportFfePrint.includes('PDF') && dict.cancel === 'Hủy';
  const bounds = computeCardsBounds(items);
  const defaultOrientation: 'landscape' | 'portrait' =
    bounds && bounds.h > bounds.w * 1.15 ? 'portrait' : 'landscape';

  const studioName = studioProfile?.studioName?.trim() || 'Mosa';
  const studioContact = studioProfile?.studioContact?.trim() || 'Mosa Specification Schedule';
  const studioLogoHtml = studioProfile?.studioLogoDataUrl
    ? `<img src="${studioProfile.studioLogoDataUrl}" alt="" style="height:26px;width:auto;max-width:120px;object-fit:contain;border-radius:5px;" />`
    : '';
  const clientMetaParts = [
    project.clientName ? `${dict.homeClientLabel}: ${project.clientName}` : '',
    project.projectCode ? project.projectCode : '',
    new Date().toLocaleDateString(isVi ? 'vi-VN' : 'en-US'),
    `${items.length} ${isVi ? 'hạng mục' : 'items'}`,
  ].filter(Boolean);

  const rowsHtml = budget.rows
    .map((row, idx) => {
      const c = row.card;
      const thumb = thumbMap.get(c.id);
      const swColor = c.color || c.dominantHex;
      const previewCell = thumb
        ? `<img src="${escapeHtml(thumb)}" referrerpolicy="no-referrer" style="width:36px;height:36px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb;display:block;" />`
        : swColor
          ? `<div style="width:36px;height:36px;border-radius:6px;background:${escapeHtml(swColor)};border:1px solid rgba(0,0,0,0.12);"></div>`
          : `<div style="width:36px;height:36px;border-radius:6px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#6b7280;">${escapeHtml(c.kind.toUpperCase())}</div>`;

      const lineTotalStr =
        row.lineTotal !== null ? formatCurrency(row.lineTotal, budget.currency) : '—';

      return `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-weight:600;font-variant-numeric:tabular-nums;width:30px;">${String(idx + 1).padStart(2, '0')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;width:48px;">${previewCell}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">
          <div style="font-weight:650;color:#111827;line-height:1.3;">${escapeHtml(c.title || c.kind)}</div>
          <div style="font-size:10.5px;color:#6b7280;margin-top:2px;">${escapeHtml(getCategoryLabel(dict, c.category))}${swColor ? ` · ${escapeHtml(swColor)}` : ''}</div>
        </td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:11.5px;color:#1f2937;white-space:nowrap;">${escapeHtml(c.spec?.code || '—')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;font-weight:600;text-align:center;font-variant-numeric:tabular-nums;">${row.qty}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:11.5px;color:#374151;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;">${escapeHtml(c.spec?.price || '—')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;font-weight:700;color:#111827;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;">${escapeHtml(lineTotalStr)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:11px;color:#4b5563;max-width:210px;line-height:1.35;">${escapeHtml(c.text || '')}</td>
      </tr>`;
    })
    .join('');

  const budgetBannerHtml =
    budget.pricedCount > 0
      ? `<div class="budget-total">
          <span>${escapeHtml(dict.ffeTotalBudgetLabel)} (${budget.pricedCount}/${items.length})</span>
          <span class="budget-amount">${escapeHtml(formatCurrency(budget.grandTotal, budget.currency))}</span>
        </div>`
      : '';

  const html = `<!doctype html>
<html lang="${isVi ? 'vi' : 'en'}">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(studioName)} · ${escapeHtml(project.name)} — FF&E Spec Sheet</title>
  <style id="page-orientation-style">@page { size: A4 ${defaultOrientation}; margin: 0; }</style>
  <style>
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body {
      margin: 0;
      padding: 0;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #1f221d;
      background: #ecebe7;
    }
    .print-toolbar {
      position: sticky;
      top: 0;
      z-index: 20;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 20px;
      background: rgba(255, 255, 255, 0.94);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid #dfddd4;
      font-size: 13px;
    }
    .toolbar-left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .toolbar-tip { font-size: 12px; color: #565950; }
    .toolbar-actions { display: flex; align-items: center; gap: 8px; }
    .tb-seg {
      display: inline-flex;
      padding: 3px;
      border-radius: 9px;
      background: #f2efe9;
      border: 1px solid #dfddd4;
    }
    .tb-seg button {
      border: none;
      background: transparent;
      color: #565950;
      font-size: 12px;
      font-weight: 600;
      padding: 5px 11px;
      border-radius: 6px;
      cursor: pointer;
    }
    .tb-seg button.is-active {
      background: #ffffff;
      color: #1f221d;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }
    .tb-print-btn {
      border: none;
      background: #0059c7;
      color: #ffffff;
      font-size: 13px;
      font-weight: 600;
      padding: 8px 16px;
      border-radius: 9px;
      cursor: pointer;
    }
    .tb-print-btn:hover { background: #0048a4; }

    .deck-sheets {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
      padding: 24px 16px 40px;
    }
    .deck-page {
      width: 297mm;
      background: #ffffff;
      padding: 11mm 14mm;
      box-shadow: 0 14px 36px rgba(0, 0, 0, 0.1);
      border-radius: 6px;
    }
    .deck-page--hero {
      height: 210mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      overflow: hidden;
    }
    .deck-page--spec {
      min-height: 210mm;
      display: flex;
      flex-direction: column;
    }
    body.is-portrait .deck-page { width: 210mm; }
    body.is-portrait .deck-page--hero { height: 297mm; }
    body.is-portrait .deck-page--spec { min-height: 297mm; }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 14px;
      border-bottom: 1.5px solid #1f221d;
      padding-bottom: 8px;
      margin-bottom: 10px;
      flex-shrink: 0;
    }
    .header-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .title { font-size: 16.5px; font-weight: 700; letter-spacing: -0.02em; }
    .brand { font-family: "Bricolage Grotesque", Inter, sans-serif; letter-spacing: -0.03em; }
    .meta { font-size: 11.5px; color: #565950; text-align: right; white-space: nowrap; }

    .board-stage {
      flex: 1;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 3mm 0;
    }
    .board-stage img.board-spread {
      width: 100%;
      height: 100%;
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border-radius: 10px;
      border: 1px solid #e5e7eb;
    }

    .spec-body { flex: 1; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    th {
      text-align: left;
      padding: 7px 8px;
      border-bottom: 1.5px solid #1f221d;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #4b5563;
      white-space: nowrap;
    }
    .budget-total {
      margin-top: 12px;
      padding: 11px 14px;
      border-radius: 9px;
      background: #f5f3ee;
      border: 1px solid #dfddd4;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 13px;
      font-weight: 700;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .budget-amount { font-size: 16px; color: #0059c7; font-variant-numeric: tabular-nums; }
    .doc-footer {
      margin-top: 10px;
      padding-top: 8px;
      border-top: 1px solid #e5e7eb;
      display: flex;
      justify-content: space-between;
      font-size: 10.5px;
      color: #6b7280;
      flex-shrink: 0;
    }

    @media print {
      html, body { background: #ffffff !important; }
      .print-toolbar { display: none !important; }
      .deck-sheets { display: block; padding: 0; gap: 0; }
      .deck-page {
        width: 100% !important;
        margin: 0 !important;
        border-radius: 0 !important;
        box-shadow: none !important;
      }
      .deck-page--hero {
        height: 209mm;
        page-break-after: always;
        break-after: page;
      }
      body.is-portrait .deck-page--hero { height: 296mm; }
      .deck-page--spec { min-height: auto; }
    }
  </style>
</head>
<body class="${defaultOrientation === 'portrait' ? 'is-portrait' : ''}">
  <div class="print-toolbar">
    <div class="toolbar-left">
      <div class="tb-seg" role="group" aria-label="Orientation">
        <button type="button" id="btn-land" class="${defaultOrientation === 'landscape' ? 'is-active' : ''}">${isVi ? 'A4 Ngang' : 'A4 Landscape'}</button>
        <button type="button" id="btn-port" class="${defaultOrientation === 'portrait' ? 'is-active' : ''}">${isVi ? 'A4 Dọc' : 'A4 Portrait'}</button>
      </div>
      <span class="toolbar-tip">${
        isVi
          ? 'Mẹo: Chọn đích "Lưu dưới dạng PDF (Save as PDF)" để giữ đúng hướng trang và không bị viền thừa.'
          : 'Tip: Choose "Save as PDF" as destination to keep exact orientation with zero browser headers.'
      }</span>
    </div>
    <div class="toolbar-actions">
      <button type="button" class="tb-print-btn" id="btn-print">${isVi ? 'Lưu PDF / In' : 'Save PDF / Print'}</button>
    </div>
  </div>

  <div class="deck-sheets">
    <section class="deck-page deck-page--hero">
      <div class="header">
        <div class="header-left">
          ${studioLogoHtml}
          <div class="title"><span class="brand">${escapeHtml(studioName)}</span> · ${escapeHtml(project.name)}</div>
        </div>
        <div class="meta">${escapeHtml(clientMetaParts.join(' · '))}</div>
      </div>
      <div class="board-stage">
        <img class="board-spread" src="${boardDataUrl}" alt="Moodboard" />
      </div>
      <div class="doc-footer">
        <span>${escapeHtml(studioContact)}</span>
        <span>${escapeHtml(project.name)} · 01</span>
      </div>
    </section>

    <section class="deck-page deck-page--spec">
      <div class="header">
        <div class="header-left">
          ${studioLogoHtml}
          <div class="title">${escapeHtml(project.name)} — ${escapeHtml(dict.ffeSection)}</div>
        </div>
        <div class="meta">${escapeHtml(studioContact)}</div>
      </div>
      <div class="spec-body">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th></th>
              <th>${escapeHtml(dict.titleLabel)}</th>
              <th>${escapeHtml(dict.ffeCodeLabel)}</th>
              <th style="text-align:center;">${escapeHtml(dict.ffeQtyLabel)}</th>
              <th style="text-align:right;">${escapeHtml(dict.ffePriceLabel)}</th>
              <th style="text-align:right;">${escapeHtml(dict.ffeLineTotalLabel)}</th>
              <th>${escapeHtml(dict.captionLabel)}</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        ${budgetBannerHtml}
      </div>
      <div class="doc-footer">
        <span>${escapeHtml(studioName)} · ${escapeHtml(studioContact)}</span>
        <span>${escapeHtml(new Date().toLocaleDateString(isVi ? 'vi-VN' : 'en-US'))} · 02</span>
      </div>
    </section>
  </div>

  <script>
    (function () {
      var styleTag = document.getElementById('page-orientation-style');
      var btnLand = document.getElementById('btn-land');
      var btnPort = document.getElementById('btn-port');
      var btnPrint = document.getElementById('btn-print');
      function setOrient(mode) {
        styleTag.textContent = '@page { size: A4 ' + mode + '; margin: 0; }';
        document.body.classList.toggle('is-portrait', mode === 'portrait');
        btnLand.classList.toggle('is-active', mode === 'landscape');
        btnPort.classList.toggle('is-active', mode === 'portrait');
      }
      btnLand.addEventListener('click', function () { setOrient('landscape'); });
      btnPort.addEventListener('click', function () { setOrient('portrait'); });
      btnPrint.addEventListener('click', function () { window.print(); });
      window.addEventListener('load', function () {
        var imgs = Array.prototype.slice.call(document.images || []);
        Promise.all(imgs.map(function (img) {
          return img.decode ? img.decode().catch(function () {}) : Promise.resolve();
        })).then(function () {
          setTimeout(function () { window.print(); }, 220);
        });
      });
    })();
  </script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=1180,height=840');
  if (win) {
    win.document.open();
    win.document.write(html);
    win.document.close();
  }
}
