import { computeCardsBounds } from '../../domain/geometry';
import { isFullCrop } from '../../domain/cropGeometry';
import type { Card, Project, StudioProfile } from '../../domain/types';
import { getCategoryLabel, type I18nDict } from '../../i18n';
import { resolveAssetUrl } from '../../storage/workspaceRepository';
import { renderMoodboardPng, slugifyFileName, triggerBlobDownload } from './exportPng';
import { computeFfeBudget, formatCurrency } from './ffeBudget';
import {
  A4_LANDSCAPE_PT,
  A4_PORTRAIT_PT,
  MOSA_BRAND_LOGO_DATA_URL,
  buildPdfBlob,
  canvasToJpegBytes,
  type PdfJpegPage,
} from './pdfWriter';

const FONT_SANS = 'Inter, "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif';

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (!text) return '';
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, Math.max(0, lo)) + '…';
}

function wrapTwoLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (ctx.measureText(clean).width <= maxW) return [clean];
  const words = clean.split(' ');
  let line1 = '';
  let i = 0;
  for (; i < words.length; i++) {
    const next = line1 ? `${line1} ${words[i]}` : words[i];
    if (ctx.measureText(next).width <= maxW) {
      line1 = next;
    } else {
      break;
    }
  }
  if (!line1) {
    return [truncateText(ctx, clean, maxW)];
  }
  const rest = words.slice(i).join(' ');
  return [line1, truncateText(ctx, rest, maxW)];
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  pageW: number,
  marginX: number,
  marginY: number,
  logoImg: HTMLImageElement | null,
  title: string,
  metaRight: string
): number {
  const headerBottomY = marginY + 76;
  let leftX = marginX;

  if (logoImg && logoImg.naturalWidth > 0) {
    const lh = 44;
    const lw = Math.min(180, Math.round((logoImg.naturalWidth / logoImg.naturalHeight) * lh));
    ctx.save();
    drawRoundedRect(ctx, leftX, marginY + 6, lw, lh, 8);
    ctx.clip();
    ctx.drawImage(logoImg, leftX, marginY + 6, lw, lh);
    ctx.restore();
    leftX += lw + 18;
  }

  ctx.fillStyle = '#1F221D';
  ctx.font = `700 32px ${FONT_SANS}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  ctx.save();
  ctx.font = `500 21px ${FONT_SANS}`;
  const metaW = ctx.measureText(metaRight).width;
  ctx.restore();

  const maxTitleW = Math.max(240, pageW - marginX - leftX - metaW - 36);
  ctx.fillText(truncateText(ctx, title, maxTitleW), leftX, marginY + 28);

  ctx.fillStyle = '#565950';
  ctx.font = `500 21px ${FONT_SANS}`;
  ctx.textAlign = 'right';
  ctx.fillText(metaRight, pageW - marginX, marginY + 28);

  // Crisp studio rule
  ctx.strokeStyle = '#1F221D';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(marginX, headerBottomY);
  ctx.lineTo(pageW - marginX, headerBottomY);
  ctx.stroke();

  return headerBottomY;
}

function drawFooter(
  ctx: CanvasRenderingContext2D,
  pageW: number,
  pageH: number,
  marginX: number,
  marginY: number,
  leftText: string,
  rightText: string
) {
  const lineY = pageH - marginY - 38;
  ctx.strokeStyle = '#E2E4DC';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(marginX, lineY);
  ctx.lineTo(pageW - marginX, lineY);
  ctx.stroke();

  ctx.fillStyle = '#6B7280';
  ctx.font = `500 19px ${FONT_SANS}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(truncateText(ctx, leftText, pageW * 0.55), marginX, lineY + 22);
  ctx.textAlign = 'right';
  ctx.fillText(rightText, pageW - marginX, lineY + 22);
}

/**
 * Generates and directly downloads a multi-page A4 Studio Spec Sheet PDF (.pdf).
 * Zero new browser tabs, zero print dialog, 100% offline & Vietnamese UTF-8 accurate.
 */
export async function exportFfePdf(
  project: Project,
  cards: Card[],
  dict: I18nDict,
  studioProfile?: StudioProfile
): Promise<void> {
  const items = cards.filter((c) => !c.inbox && c.kind !== 'frame');
  if (items.length === 0) return;

  const isVi = dict.cancel === 'Hủy';
  const budget = computeFfeBudget(items, studioProfile);
  const bounds = computeCardsBounds(items);
  const isPortrait = Boolean(bounds && bounds.h > bounds.w * 1.15);

  // High-DPI A4 canvas (~210 DPI): sharp vector-like typography + fast encoding
  const pageW = isPortrait ? 1754 : 2480;
  const pageH = isPortrait ? 2480 : 1754;
  const pagePt = isPortrait ? A4_PORTRAIT_PT : A4_LANDSCAPE_PT;
  const marginX = 110;
  const marginY = 88;

  const studioName = studioProfile?.studioName?.trim() || 'Mosa';
  const studioContact = studioProfile?.studioContact?.trim() || 'Mosa Specification Schedule';
  const dateStr = new Date().toLocaleDateString(isVi ? 'vi-VN' : 'en-US');
  const clientMeta = [
    project.clientName ? `${dict.homeClientLabel}: ${project.clientName}` : '',
    project.projectCode || '',
    dateStr,
    `${items.length} ${isVi ? 'hạng mục' : 'items'}`,
  ]
    .filter(Boolean)
    .join(' · ');

  // Render full board PNG spread + load studio logo + load row thumbnails in parallel
  const pngBlob = await renderMoodboardPng(project, items, {
    scope: 'all',
    scale: 2,
    includeBackground: true,
    includeSourcesJson: false,
  });
  const boardUrl = URL.createObjectURL(pngBlob);

  const [boardImg, logoImg] = await Promise.all([
    loadImage(boardUrl),
    loadImage(studioProfile?.studioLogoDataUrl || MOSA_BRAND_LOGO_DATA_URL),
  ]);

  const thumbImgs = new Map<string, HTMLImageElement | null>();
  await Promise.all(
    items.map(async (c) => {
      if (c.kind !== 'image') return;
      let url: string | null = null;
      if (c.assetId) {
        url = await resolveAssetUrl(c.assetId, 'thumb');
      }
      if (!url && c.source?.imageUrl) {
        url = c.source.imageUrl;
      }
      if (url) {
        thumbImgs.set(c.id, await loadImage(url));
      }
    })
  );

  // Calculate how many spec table pages we need
  const tableHeaderH = 56;
  const rowH = 98;
  const footerReserve = 70;
  const budgetBannerH = budget.pricedCount > 0 ? 94 : 0;
  const bodyTop = marginY + 76 + 26;
  const availTableH = pageH - marginY - footerReserve - bodyTop - tableHeaderH;
  const maxRowsPerPage = Math.max(5, Math.floor(availTableH / rowH));
  const maxRowsLastPage = Math.max(4, Math.floor((availTableH - budgetBannerH) / rowH));

  // Paginate rows cleanly
  const rowChunks: Array<typeof budget.rows> = [];
  let cursor = 0;
  while (cursor < budget.rows.length) {
    const remaining = budget.rows.length - cursor;
    if (remaining <= maxRowsLastPage) {
      rowChunks.push(budget.rows.slice(cursor));
      cursor = budget.rows.length;
    } else {
      rowChunks.push(budget.rows.slice(cursor, cursor + maxRowsPerPage));
      cursor += maxRowsPerPage;
    }
  }
  if (rowChunks.length === 0) {
    rowChunks.push([]);
  }
  const totalPages = 1 + rowChunks.length;
  const pdfPages: PdfJpegPage[] = [];

  try {
    // =====================================================
    // PAGE 1: FULL MOODBOARD SPREAD (HERO SHEET)
    // =====================================================
    const c1 = document.createElement('canvas');
    c1.width = pageW;
    c1.height = pageH;
    const ctx1 = c1.getContext('2d')!;
    ctx1.fillStyle = '#FFFFFF';
    ctx1.fillRect(0, 0, pageW, pageH);

    const h1Bottom = drawHeader(
      ctx1,
      pageW,
      marginX,
      marginY,
      logoImg,
      `${studioName} · ${project.name}`,
      clientMeta
    );

    const stageTop = h1Bottom + 28;
    const stageBottom = pageH - marginY - 64;
    const stageW = pageW - marginX * 2;
    const stageH = stageBottom - stageTop;

    if (boardImg && boardImg.naturalWidth > 0) {
      const scale = Math.min(stageW / boardImg.naturalWidth, stageH / boardImg.naturalHeight);
      const dw = Math.round(boardImg.naturalWidth * scale);
      const dh = Math.round(boardImg.naturalHeight * scale);
      const dx = Math.round(marginX + (stageW - dw) / 2);
      const dy = Math.round(stageTop + (stageH - dh) / 2);

      ctx1.save();
      drawRoundedRect(ctx1, dx, dy, dw, dh, 18);
      ctx1.clip();
      ctx1.drawImage(boardImg, dx, dy, dw, dh);
      ctx1.restore();

      ctx1.strokeStyle = '#E5E7EB';
      ctx1.lineWidth = 2;
      drawRoundedRect(ctx1, dx, dy, dw, dh, 18);
      ctx1.stroke();
    }

    drawFooter(
      ctx1,
      pageW,
      pageH,
      marginX,
      marginY,
      studioContact,
      `${project.name} · 01 / ${String(totalPages).padStart(2, '0')}`
    );

    pdfPages.push({
      jpegBytes: await canvasToJpegBytes(c1, 0.93),
      widthPx: pageW,
      heightPx: pageH,
      pageWidthPt: pagePt.w,
      pageHeightPt: pagePt.h,
    });

    // =====================================================
    // PAGE 2+: FF&E SPECIFICATION SCHEDULE
    // =====================================================
    const contentW = pageW - marginX * 2;
    const colSpecs = isPortrait
      ? {
          idx: 56,
          thumb: 94,
          item: Math.round(contentW * 0.27),
          code: Math.round(contentW * 0.14),
          qty: 66,
          price: Math.round(contentW * 0.13),
          total: Math.round(contentW * 0.14),
        }
      : {
          idx: 64,
          thumb: 102,
          item: Math.round(contentW * 0.26),
          code: Math.round(contentW * 0.14),
          qty: 74,
          price: Math.round(contentW * 0.12),
          total: Math.round(contentW * 0.13),
        };
    const usedW =
      colSpecs.idx +
      colSpecs.thumb +
      colSpecs.item +
      colSpecs.code +
      colSpecs.qty +
      colSpecs.price +
      colSpecs.total;
    const noteW = Math.max(120, contentW - usedW);

    let globalRowIndex = 0;

    for (let pageIdx = 0; pageIdx < rowChunks.length; pageIdx++) {
      const chunk = rowChunks[pageIdx];
      const isLastPage = pageIdx === rowChunks.length - 1;
      const pageNum = pageIdx + 2;

      const cp = document.createElement('canvas');
      cp.width = pageW;
      cp.height = pageH;
      const ctx = cp.getContext('2d')!;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, pageW, pageH);

      const hBottom = drawHeader(
        ctx,
        pageW,
        marginX,
        marginY,
        logoImg,
        `${project.name} — ${dict.ffeSection}`,
        studioContact
      );

      let y = hBottom + 24;

      // Table column headers
      const xIdx = marginX;
      const xThumb = xIdx + colSpecs.idx;
      const xItem = xThumb + colSpecs.thumb;
      const xCode = xItem + colSpecs.item;
      const xQty = xCode + colSpecs.code;
      const xPrice = xQty + colSpecs.qty;
      const xTotal = xPrice + colSpecs.price;
      const xNote = xTotal + colSpecs.total;

      ctx.fillStyle = '#4B5563';
      ctx.font = `700 18px ${FONT_SANS}`;
      ctx.textBaseline = 'middle';

      const thMidY = y + tableHeaderH / 2 - 4;
      ctx.textAlign = 'left';
      ctx.fillText('#', xIdx + 8, thMidY);
      ctx.fillText(dict.titleLabel.toUpperCase(), xItem + 8, thMidY);
      ctx.fillText(dict.ffeCodeLabel.toUpperCase(), xCode + 8, thMidY);
      ctx.textAlign = 'center';
      ctx.fillText(dict.ffeQtyLabel.toUpperCase(), xQty + colSpecs.qty / 2, thMidY);
      ctx.textAlign = 'right';
      ctx.fillText(dict.ffePriceLabel.toUpperCase(), xPrice + colSpecs.price - 12, thMidY);
      ctx.fillText(dict.ffeLineTotalLabel.toUpperCase(), xTotal + colSpecs.total - 12, thMidY);
      ctx.textAlign = 'left';
      ctx.fillText(dict.captionLabel.toUpperCase(), xNote + 14, thMidY);

      y += tableHeaderH;
      ctx.strokeStyle = '#1F221D';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(marginX, y);
      ctx.lineTo(pageW - marginX, y);
      ctx.stroke();

      // Rows
      for (const row of chunk) {
        globalRowIndex++;
        const c = row.card;
        const rowMidY = y + rowH / 2;

        // Subtle zebra alternating band
        if (globalRowIndex % 2 === 0) {
          ctx.fillStyle = '#FAFAF8';
          ctx.fillRect(marginX, y + 1, contentW, rowH - 2);
        }

        // # Index
        ctx.fillStyle = '#6B7280';
        ctx.font = `600 20px ${FONT_SANS}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(globalRowIndex).padStart(2, '0'), xIdx + 8, rowMidY);

        // Preview thumbnail or color swatch
        const thumbSize = 68;
        const tx = xThumb + 8;
        const ty = y + Math.round((rowH - thumbSize) / 2);
        const imgEl = thumbImgs.get(c.id);
        const swColor = c.color || c.dominantHex;

        if (imgEl && imgEl.naturalWidth > 0) {
          const activeCrop = c.crop && !isFullCrop(c.crop) ? c.crop : null;
          const srcX = activeCrop ? activeCrop.x * imgEl.naturalWidth : 0;
          const srcY = activeCrop ? activeCrop.y * imgEl.naturalHeight : 0;
          const srcW = activeCrop ? Math.max(1, activeCrop.w * imgEl.naturalWidth) : imgEl.naturalWidth;
          const srcH = activeCrop ? Math.max(1, activeCrop.h * imgEl.naturalHeight) : imgEl.naturalHeight;
          const coverScale = Math.max(thumbSize / srcW, thumbSize / srcH);
          const sw = srcW * coverScale;
          const sh = srcH * coverScale;
          ctx.save();
          drawRoundedRect(ctx, tx, ty, thumbSize, thumbSize, 10);
          ctx.clip();
          if (c.flipH) {
            ctx.translate(tx + thumbSize, ty);
            ctx.scale(-1, 1);
            ctx.drawImage(
              imgEl,
              srcX,
              srcY,
              srcW,
              srcH,
              (thumbSize - sw) / 2,
              (thumbSize - sh) / 2,
              sw,
              sh
            );
          } else {
            ctx.drawImage(
              imgEl,
              srcX,
              srcY,
              srcW,
              srcH,
              tx + (thumbSize - sw) / 2,
              ty + (thumbSize - sh) / 2,
              sw,
              sh
            );
          }
          ctx.restore();
          ctx.strokeStyle = '#E5E7EB';
          ctx.lineWidth = 1.5;
          drawRoundedRect(ctx, tx, ty, thumbSize, thumbSize, 10);
          ctx.stroke();
        } else if (swColor) {
          ctx.fillStyle = swColor;
          drawRoundedRect(ctx, tx, ty, thumbSize, thumbSize, 10);
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.14)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else {
          ctx.fillStyle = '#F3F4F6';
          drawRoundedRect(ctx, tx, ty, thumbSize, thumbSize, 10);
          ctx.fill();
          ctx.fillStyle = '#6B7280';
          ctx.font = `700 15px ${FONT_SANS}`;
          ctx.textAlign = 'center';
          ctx.fillText(c.kind.toUpperCase().slice(0, 5), tx + thumbSize / 2, ty + thumbSize / 2);
        }

        // Title + Category/HEX subtitle
        ctx.textAlign = 'left';
        ctx.fillStyle = '#111827';
        ctx.font = `600 22px ${FONT_SANS}`;
        ctx.fillText(
          truncateText(ctx, c.title || c.kind, colSpecs.item - 20),
          xItem + 8,
          rowMidY - 13
        );
        ctx.fillStyle = '#6B7280';
        ctx.font = `500 18px ${FONT_SANS}`;
        const subMeta = `${getCategoryLabel(dict, c.category)}${swColor ? ` · ${swColor}` : ''}`;
        ctx.fillText(truncateText(ctx, subMeta, colSpecs.item - 20), xItem + 8, rowMidY + 16);

        // Code / SKU
        ctx.fillStyle = '#1F2937';
        ctx.font = `500 20px ${FONT_SANS}`;
        ctx.fillText(truncateText(ctx, c.spec?.code || '—', colSpecs.code - 16), xCode + 8, rowMidY);

        // Qty
        ctx.textAlign = 'center';
        ctx.fillStyle = '#111827';
        ctx.font = `600 21px ${FONT_SANS}`;
        ctx.fillText(String(row.qty), xQty + colSpecs.qty / 2, rowMidY);

        // Unit price
        ctx.textAlign = 'right';
        ctx.fillStyle = '#374151';
        ctx.font = `500 20px ${FONT_SANS}`;
        ctx.fillText(
          truncateText(ctx, c.spec?.price || '—', colSpecs.price - 16),
          xPrice + colSpecs.price - 12,
          rowMidY
        );

        // Subtotal
        const lineTotalStr =
          row.lineTotal !== null ? formatCurrency(row.lineTotal, budget.currency) : '—';
        ctx.fillStyle = '#111827';
        ctx.font = `700 21px ${FONT_SANS}`;
        ctx.fillText(
          truncateText(ctx, lineTotalStr, colSpecs.total - 16),
          xTotal + colSpecs.total - 12,
          rowMidY
        );

        // Note (up to 2 lines)
        ctx.textAlign = 'left';
        ctx.fillStyle = '#4B5563';
        ctx.font = `400 18px ${FONT_SANS}`;
        const noteLines = wrapTwoLines(ctx, c.text || '', noteW - 22);
        if (noteLines.length === 1) {
          ctx.fillText(noteLines[0], xNote + 14, rowMidY);
        } else if (noteLines.length >= 2) {
          ctx.fillText(noteLines[0], xNote + 14, rowMidY - 12);
          ctx.fillText(noteLines[1], xNote + 14, rowMidY + 13);
        }

        // Bottom row divider
        y += rowH;
        ctx.strokeStyle = '#E5E7EB';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(marginX, y);
        ctx.lineTo(pageW - marginX, y);
        ctx.stroke();
      }

      // Total Budget Banner on last page
      if (isLastPage && budget.pricedCount > 0) {
        const bannerY = y + 22;
        const bannerH = 74;
        ctx.fillStyle = '#F5F3EE';
        drawRoundedRect(ctx, marginX, bannerY, contentW, bannerH, 14);
        ctx.fill();
        ctx.strokeStyle = '#DFDDD4';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = '#1F221D';
        ctx.font = `700 23px ${FONT_SANS}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          `${dict.ffeTotalBudgetLabel} (${budget.pricedCount}/${items.length})`,
          marginX + 26,
          bannerY + bannerH / 2
        );

        ctx.fillStyle = '#0059C7';
        ctx.font = `700 29px ${FONT_SANS}`;
        ctx.textAlign = 'right';
        ctx.fillText(
          formatCurrency(budget.grandTotal, budget.currency),
          pageW - marginX - 26,
          bannerY + bannerH / 2
        );
      }

      drawFooter(
        ctx,
        pageW,
        pageH,
        marginX,
        marginY,
        studioContact,
        `${project.name} · ${String(pageNum).padStart(2, '0')} / ${String(totalPages).padStart(2, '0')}`
      );

      pdfPages.push({
        jpegBytes: await canvasToJpegBytes(cp, 0.92),
        widthPx: pageW,
        heightPx: pageH,
        pageWidthPt: pagePt.w,
        pageHeightPt: pagePt.h,
      });
    }

    const pdfBlob = buildPdfBlob(pdfPages, {
      title: `${studioName} - ${project.name} FF&E Spec Sheet`,
      author: studioName,
    });
    const slug = slugifyFileName(project.name);
    triggerBlobDownload(pdfBlob, `${slug}-spec.pdf`);
  } finally {
    URL.revokeObjectURL(boardUrl);
  }
}
