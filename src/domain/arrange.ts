import {
  CATEGORY_ORDER,
  type ArrangeOptions,
  type Card,
  type Category,
} from './types';
import {
  computeCardsBounds,
  recomputeFrameBoundsForAll,
  rectsIntersect,
  type Rect,
} from './geometry';

interface PlacedCardPatch {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  framed?: boolean;
}

interface CompositionBox {
  items: PlacedCardPatch[];
  bounds: Rect;
}

function getAspectRatio(card: Card): number {
  if (card.w > 0 && card.h > 0) {
    return Math.max(0.45, Math.min(2.2, card.w / card.h));
  }
  return 1.33;
}

function sizeImageByWidth(
  card: Card,
  targetW: number,
  minH = 130,
  maxH = 460
): { w: number; h: number } {
  const aspect = getAspectRatio(card);
  const rawH = Math.round(targetW / aspect);
  return {
    w: Math.round(targetW),
    h: Math.max(minH, Math.min(maxH, rawH)),
  };
}

function estimateEditorialCardHeight(card: Card, targetW: number): number {
  if (card.kind === 'file') return 88;
  if (card.kind === 'link') return 112;
  // Estimate wrapped line count for note cards so text is never clipped
  const charsPerLine = Math.max(22, Math.floor((targetW - 36) / 7.2));
  const rawLines = (card.text || '').split('\n');
  let totalLines = 0;
  for (const line of rawLines) {
    totalLines += Math.max(1, Math.ceil(line.length / charsPerLine));
  }
  const titleLines = card.title ? Math.ceil(card.title.length / (charsPerLine - 2)) : 0;
  const computed = 42 + titleLines * 22 + totalLines * 20;
  return Math.max(136, Math.min(280, Math.max(card.h, computed)));
}

function parseHexLuminance(hex?: string): number {
  const clean = (hex || '#8D9A7C').replace('#', '');
  if (clean.length !== 6) return 0.5;
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function normalizeBox(items: PlacedCardPatch[]): CompositionBox {
  if (items.length === 0) {
    return { items: [], bounds: { x: 0, y: 0, w: 1, h: 1 } };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const it of items) {
    minX = Math.min(minX, it.x);
    minY = Math.min(minY, it.y);
    maxX = Math.max(maxX, it.x + it.w);
    maxY = Math.max(maxY, it.y + it.h);
  }
  const normalized = items.map((it) => ({
    ...it,
    x: Math.round(it.x - minX),
    y: Math.round(it.y - minY),
  }));
  return {
    items: normalized,
    bounds: {
      x: 0,
      y: 0,
      w: Math.max(1, Math.round(maxX - minX)),
      h: Math.max(1, Math.round(maxY - minY)),
    },
  };
}

/**
 * Separates cards into semantic designer roles:
 * - Heroes: primary space/architecture anchor(s)
 * - Supports: furniture, floor plans, secondary visuals
 * - Accents: tactile materials & palette detail photos
 * - Swatches: color swatch cards sorted by luminance
 * - Editorials: notes first (concept headers), then links & DWG design files
 */
function partitionByDesignerRole(cards: Card[]) {
  const images = cards.filter((c) => c.kind === 'image');
  const swatches = [...cards.filter((c) => c.kind === 'color')].sort(
    (a, b) => parseHexLuminance(a.color) - parseHexLuminance(b.color) || a.id.localeCompare(b.id)
  );
  const kindOrder: Record<string, number> = { note: 1, link: 2, file: 3 };
  const editorials = [...cards.filter(
    (c) => c.kind === 'note' || c.kind === 'file' || c.kind === 'link'
  )].sort(
    (a, b) =>
      (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9) ||
      b.text.length - a.text.length ||
      a.id.localeCompare(b.id)
  );

  const rolePriority: Record<Category, number> = {
    reference: 1,
    furniture: 2,
    sketch: 3,
    palette: 4,
    material: 5,
    other: 6,
  };

  const sortedImages = [...images].sort((a, b) => {
    const pa = rolePriority[a.category] ?? 6;
    const pb = rolePriority[b.category] ?? 6;
    if (pa !== pb) return pa - pb;
    return b.w * b.h - a.w * a.h || a.id.localeCompare(b.id);
  });

  const heroes: Card[] = [];
  const supports: Card[] = [];
  const accents: Card[] = [];

  sortedImages.forEach((img, idx) => {
    if (idx === 0) {
      heroes.push(img);
    } else if (img.category === 'material') {
      accents.push(img);
    } else {
      supports.push(img);
    }
  });

  if (accents.length === 0 && supports.length >= 4) {
    const promoted = supports.pop();
    if (promoted) accents.push(promoted);
  }

  return { heroes, supports, accents, swatches, editorials, allImages: sortedImages };
}

/**
 * MODE 1: EDITORIAL BENTO (Inspired by Pinterest References #3, #6, #8)
 * - Tightly aligned 2-column central mosaic block where all 4 quadrants fill evenly.
 * - At most 1 focal accent card per 4 base images sits as a crisp white-framed card over the 4-way seam intersection!
 * - Color swatches form a unified horizontal palette bar docked across the bottom edge of the mosaic.
 * - Notes / DWG files sit in clean Left & Right perimeter callout margins with full unclipped height.
 */
function layoutEditorialBento(
  cards: Card[],
  options: ArrangeOptions,
  baseZ: number
): CompositionBox {
  const { heroes, supports, accents, swatches, editorials, allImages } =
    partitionByDesignerRole(cards);
  const t = Math.max(0, Math.min(1, options.overlap / 100));
  const useFrame = options.galleryFrame ?? true;
  const seam = Math.round(14 * (1 - t * 0.72));
  const items: PlacedCardPatch[] = [];
  let z = baseZ;

  const leftColW = 456;
  const rightColW = 348;
  const mosaicW = leftColW + seam + rightColW;

  // Keep enough images in the base mosaic so both columns have at least 2 rows before floating an overlay
  const maxOverlays =
    allImages.length >= 5 && t >= 0.15 ? Math.min(accents.length, Math.floor((allImages.length - 3) / 2)) : 0;
  const overlayAccents = accents.slice(0, Math.max(0, maxOverlays));
  const inlineAccents = accents.slice(overlayAccents.length);
  const bentoPool = [...heroes, ...supports, ...inlineAccents];

  let leftY = 0;
  let rightY = 0;
  const leftSplitY: number[] = [];
  const rightSplitY: number[] = [];

  bentoPool.forEach((img, idx) => {
    const placeLeft = idx === 0 || leftY <= rightY;
    if (placeLeft) {
      const { h } = sizeImageByWidth(img, leftColW, 200, 360);
      items.push({
        id: img.id,
        x: 0,
        y: leftY,
        w: leftColW,
        h,
        z: ++z,
        framed: false,
      });
      leftY += h;
      leftSplitY.push(leftY);
      leftY += seam;
    } else {
      const { h } = sizeImageByWidth(img, rightColW, 190, 350);
      items.push({
        id: img.id,
        x: leftColW + seam,
        y: rightY,
        w: rightColW,
        h,
        z: ++z,
        framed: false,
      });
      rightY += h;
      rightSplitY.push(rightY);
      rightY += seam;
    }
  });

  // Equalize bottom edge of left and right columns so the Bento outer rectangle is razor-sharp!
  const leftItems = items.filter((it) => it.x === 0);
  const rightItems = items.filter((it) => it.x > 0);
  if (leftItems.length > 0 && rightItems.length > 0) {
    const targetH = Math.max(leftY - seam, rightY - seam);
    const lastLeft = leftItems[leftItems.length - 1];
    const lastRight = rightItems[rightItems.length - 1];
    const leftDiff = targetH - (lastLeft.y + lastLeft.h);
    const rightDiff = targetH - (lastRight.y + lastRight.h);
    if (leftDiff > 0 && leftDiff <= 180) lastLeft.h += leftDiff;
    if (rightDiff > 0 && rightDiff <= 180) lastRight.h += rightDiff;
  }

  const mosaicH =
    leftItems.length > 0 && rightItems.length > 0
      ? Math.max(
          leftItems[leftItems.length - 1].y + leftItems[leftItems.length - 1].h,
          rightItems[rightItems.length - 1].y + rightItems[rightItems.length - 1].h
        )
      : Math.max(leftY, rightY, 240) - (bentoPool.length > 0 ? seam : 0);

  // Place white-framed Focal Accent card(s) at distinct 4-way seam intersections (Image #8 style)
  overlayAccents.forEach((acc, idx) => {
    const seamY =
      idx === 0
        ? Math.round(((leftSplitY[0] ?? mosaicH * 0.5) + (rightSplitY[0] ?? mosaicH * 0.5)) / 2)
        : Math.round(
            ((leftSplitY[idx] ?? mosaicH * 0.72) + (rightSplitY[idx] ?? mosaicH * 0.72)) / 2
          );
    const boxW = Math.round(176 + 26 * t);
    const { w, h } = sizeImageByWidth(acc, boxW, 156, 210);
    items.push({
      id: acc.id,
      x: Math.round(leftColW + seam / 2 - w * 0.5),
      y: Math.round(seamY - h * 0.5),
      w,
      h,
      z: baseZ + 40 + idx,
      framed: useFrame,
    });
  });

  // Bottom Color Palette Dock (Images #3, #6, #8)
  if (swatches.length > 0) {
    const nSw = swatches.length;
    const swGap = 12;
    const totalBarW = Math.min(mosaicW, Math.max(430, nSw * 148));
    const swW = Math.max(100, Math.min(172, Math.floor((totalBarW - swGap * (nSw - 1)) / nSw)));
    const swH = 110;
    const actualRowW = nSw * swW + (nSw - 1) * swGap;
    const startX = Math.round((mosaicW - actualRowW) / 2);
    const overlapUp = Math.round(20 * t);
    const swY = mosaicH + 16 - overlapUp;

    swatches.forEach((sw, idx) => {
      items.push({
        id: sw.id,
        x: startX + idx * (swW + swGap),
        y: swY,
        w: swW,
        h: swH,
        z: baseZ + 60 + idx,
        framed: false,
      });
    });
  }

  // Left & Right Perimeter Callout Margins for Concept Notes & DWG Files (never clipping text!)
  const marginGap = 34;
  const noteW = 282;
  let leftMarginY = 4;
  let rightMarginY = 4;

  editorials.forEach((ed, idx) => {
    const h = estimateEditorialCardHeight(ed, noteW);
    if (idx % 2 === 0) {
      items.push({
        id: ed.id,
        x: -(noteW + marginGap),
        y: leftMarginY,
        w: noteW,
        h,
        z: baseZ + 50 + idx,
      });
      leftMarginY += h + 22;
    } else {
      items.push({
        id: ed.id,
        x: mosaicW + marginGap,
        y: rightMarginY,
        w: noteW,
        h,
        z: baseZ + 50 + idx,
      });
      rightMarginY += h + 22;
    }
  });

  return normalizeBox(items);
}

/**
 * MODE 2: LAYERED FOCAL COLLAGE / SCRAPBOOK (Inspired by Pinterest References #2, #4, #5)
 * - 1 Commanding Hero Anchor in the center-left.
 * - Supporting & Accent photos interlock at distinct corner/edge slots around the Hero without colliding with one another!
 * - Swatches form a sleek vertical Palette Rail on the right flank.
 * - Primary Concept Note sits at the Top-Left Editorial Header slot (Image #5 STUDIO NEBULA), while DWG files & extra notes sit cleanly in the bottom spec bar.
 */
function layoutFocalCollage(
  cards: Card[],
  options: ArrangeOptions,
  baseZ: number
): CompositionBox {
  const { heroes, supports, accents, swatches, editorials } = partitionByDesignerRole(cards);
  const t = Math.max(0, Math.min(1, options.overlap / 100));
  const useFrame = options.galleryFrame ?? true;
  const items: PlacedCardPatch[] = [];

  const allVisuals = [...heroes, ...supports, ...accents];
  if (allVisuals.length === 0) {
    return layoutEditorialBento(cards, options, baseZ);
  }

  // Tier 1: Commanding Hero Anchor
  const hero = allVisuals[0];
  const heroW = Math.round(450 + 70 * t); // 450..520px
  const heroSize = sizeImageByWidth(hero, heroW, 290, 410);
  const heroRect: Rect = { x: 0, y: 0, w: heroSize.w, h: heroSize.h };

  items.push({
    id: hero.id,
    x: heroRect.x,
    y: heroRect.y,
    w: heroRect.w,
    h: heroRect.h,
    z: baseZ + 5,
    framed: false,
  });

  // Corner inset depth (0..72px overlap onto Hero's corners)
  const insetPx = Math.round(-16 + 84 * t);
  const remainingVisuals = [...supports, ...heroes.slice(1), ...accents];

  // Track placed satellite rects so satellites never pile on top of each other's labels
  let rightTopBottomY = 0;

  remainingVisuals.forEach((card, idx) => {
    const isAccent = card.category === 'material' || card.category === 'palette' || idx >= 3;
    const targetW = isAccent ? Math.round(216 - 14 * t) : Math.round(284 - 12 * t);
    const { w, h } = sizeImageByWidth(card, targetW, 148, 320);

    let x = 0;
    let y = 0;
    const slot = idx % 5;

    switch (slot) {
      case 0:
        // Slot 0: Bottom-Right Corner of Hero (Armchair)
        x = heroRect.x + heroRect.w - insetPx;
        y = heroRect.y + heroRect.h - Math.round(h * 0.58);
        break;
      case 1:
        // Slot 1: Top-Right Shoulder of Hero (placed cleanly above Slot 0!)
        x = heroRect.x + heroRect.w - Math.round(insetPx * 0.65) + 18;
        y = heroRect.y - Math.round(h * 0.25);
        rightTopBottomY = y + h;
        break;
      case 2:
        // Slot 2: Bottom-Left Corner below Hero (Material texture)
        x = heroRect.x + 24;
        y = heroRect.y + heroRect.h - Math.round(insetPx * 0.75);
        break;
      case 3:
        // Slot 3: Far-Right Wing (Paint swatches — placed to the right of Slot 1/0, never covering Floor Plan label!)
        x = heroRect.x + heroRect.w + 260 - Math.round(insetPx * 0.45);
        y = Math.max(heroRect.y + 24, rightTopBottomY - Math.round(h * 0.35));
        break;
      default: {
        const extraCol = (idx - 4) % 3;
        const extraRow = Math.floor((idx - 4) / 3);
        x = heroRect.x + extraCol * (w + 22);
        y = heroRect.y + heroRect.h + 210 + extraRow * (h + 22);
        break;
      }
    }

    items.push({
      id: card.id,
      x: Math.round(x),
      y: Math.round(y),
      w,
      h,
      z: isAccent ? baseZ + 26 + idx : baseZ + 12 + idx,
      framed: useFrame,
    });
  });

  let islandMinX = Infinity;
  let islandMinY = Infinity;
  let islandMaxX = -Infinity;
  let islandMaxY = -Infinity;
  for (const it of items) {
    islandMinX = Math.min(islandMinX, it.x);
    islandMinY = Math.min(islandMinY, it.y);
    islandMaxX = Math.max(islandMaxX, it.x + it.w);
    islandMaxY = Math.max(islandMaxY, it.y + it.h);
  }

  // Vertical Color Palette Rail hugging the Right Flank (Images #2 & #4)
  if (swatches.length > 0) {
    const railX = Math.round(islandMaxX + 26);
    const swW = 148;
    const swH = 88;
    const swGap = 10;
    const totalRailH = swatches.length * swH + (swatches.length - 1) * swGap;
    const startY = Math.round(
      islandMinY + Math.max(0, (islandMaxY - islandMinY - totalRailH) / 2)
    );

    swatches.forEach((sw, idx) => {
      items.push({
        id: sw.id,
        x: railX,
        y: startY + idx * (swH + swGap),
        w: swW,
        h: swH,
        z: baseZ + 50 + idx,
      });
    });
    islandMaxX = railX + swW;
  }

  // Editorial Header (Primary Concept Note at Top-Left above Hero, remaining Notes & DWG below)
  let bottomNoteX = heroRect.x + 260;
  const bottomNoteY = Math.round(islandMaxY - 70);

  editorials.forEach((ed, idx) => {
    const w = ed.kind === 'file' ? 288 : 310;
    const h = estimateEditorialCardHeight(ed, w);
    if (idx === 0 && ed.kind === 'note') {
      // Top-Left Editorial Manifest above Hero (Image #5 STUDIO NEBULA)
      items.push({
        id: ed.id,
        x: heroRect.x,
        y: Math.round(heroRect.y - h - 22),
        w: 340,
        h: estimateEditorialCardHeight(ed, 340),
        z: baseZ + 60,
      });
    } else {
      items.push({
        id: ed.id,
        x: Math.round(bottomNoteX),
        y: bottomNoteY,
        w,
        h,
        z: baseZ + 60 + idx,
      });
      bottomNoteX += w + 22;
    }
  });

  return normalizeBox(items);
}

/**
 * MODE 3: CONCEPT ZONES / PRESENTATION SPREAD (Inspired by Pinterest References #1 & #7)
 */
function layoutConceptZones(
  cards: Card[],
  options: ArrangeOptions,
  baseZ: number
): CompositionBox {
  const t = Math.max(0, Math.min(1, options.overlap / 100));
  const useFrame = options.galleryFrame ?? true;
  const zoneBoxes: CompositionBox[] = [];
  let z = baseZ;

  for (const cat of CATEGORY_ORDER) {
    const catCards = cards.filter((c) => c.category === cat);
    if (catCards.length === 0) continue;

    const zoneItems: PlacedCardPatch[] = [];
    const swatches = catCards.filter((c) => c.kind === 'color');
    const nonSwatches = catCards.filter((c) => c.kind !== 'color');

    let cursorY = 0;
    nonSwatches.forEach((c, idx) => {
      if (c.kind === 'image') {
        const isZoneAnchor = idx === 0;
        const targetW = isZoneAnchor ? 320 : idx % 2 === 1 ? 248 : 268;
        const { w, h } = sizeImageByWidth(c, targetW, 140, 340);

        if (idx === 0) {
          zoneItems.push({ id: c.id, x: 0, y: 0, w, h, z: ++z, framed: false });
          cursorY = h;
        } else if (idx === 1) {
          const overlapX = Math.round(52 * t);
          const overlapY = Math.round(h * (0.28 + 0.25 * t));
          const x = 320 - overlapX;
          const y = Math.max(18, cursorY - overlapY);
          zoneItems.push({ id: c.id, x, y, w, h, z: ++z, framed: useFrame });
          cursorY = Math.max(cursorY, y + h);
        } else {
          const col = idx % 2;
          const overlapY = Math.round(28 * t);
          const x = col === 0 ? 18 : 250 - Math.round(32 * t);
          const y = cursorY + 16 - overlapY;
          zoneItems.push({ id: c.id, x, y, w, h, z: ++z, framed: useFrame });
          cursorY = Math.max(cursorY, y + h);
        }
      } else {
        const w = 286;
        const h = estimateEditorialCardHeight(c, w);
        const y = cursorY === 0 ? 0 : cursorY + 14;
        zoneItems.push({ id: c.id, x: 0, y, w, h, z: ++z });
        cursorY = y + h;
      }
    });

    if (swatches.length > 0) {
      const swStartY = cursorY === 0 ? 0 : cursorY + 16;
      const swW = 138;
      const swH = 88;
      const swGap = 10;
      swatches.forEach((sw, idx) => {
        const col = idx % 2;
        const row = Math.floor(idx / 2);
        zoneItems.push({
          id: sw.id,
          x: col * (swW + swGap),
          y: swStartY + row * (swH + swGap),
          w: swW,
          h: swH,
          z: ++z,
        });
      });
    }

    zoneBoxes.push(normalizeBox(zoneItems));
  }

  const zoneGapX = 68;
  const zoneGapY = 64;
  const colsPerRow = Math.min(3, Math.max(2, Math.ceil(zoneBoxes.length / 2)));
  const merged: PlacedCardPatch[] = [];
  let rowY = 0;

  for (let r = 0; r < zoneBoxes.length; r += colsPerRow) {
    const rowZones = zoneBoxes.slice(r, r + colsPerRow);
    let colX = 0;
    let rowMaxH = 0;
    for (const zb of rowZones) {
      for (const it of zb.items) {
        merged.push({
          ...it,
          x: it.x + colX,
          y: it.y + rowY,
        });
      }
      colX += zb.bounds.w + zoneGapX;
      rowMaxH = Math.max(rowMaxH, zb.bounds.h);
    }
    rowY += rowMaxH + zoneGapY;
  }

  return normalizeBox(merged);
}

/**
 * MODE 4: SWISS MAGAZINE JUSTIFIED GRID (Inspired by Pinterest Reference #6)
 */
function layoutSwissJustifiedGrid(
  cards: Card[],
  baseZ: number
): CompositionBox {
  const { allImages, swatches, editorials } = partitionByDesignerRole(cards);
  const masterW = 900;
  const gap = 18;
  const items: PlacedCardPatch[] = [];
  let cursorY = 0;
  let z = baseZ;

  if (editorials.length > 0) {
    const perRow = Math.min(3, editorials.length);
    for (let i = 0; i < editorials.length; i += perRow) {
      const slice = editorials.slice(i, i + perRow);
      const cellW = Math.floor((masterW - gap * (slice.length - 1)) / slice.length);
      const rowH = Math.max(...slice.map((c) => estimateEditorialCardHeight(c, cellW)));
      slice.forEach((c, idx) => {
        items.push({
          id: c.id,
          x: idx * (cellW + gap),
          y: cursorY,
          w: cellW,
          h: rowH,
          z: ++z,
        });
      });
      cursorY += rowH + gap;
    }
  }

  let imgIdx = 0;
  let rowPatternIdx = 0;
  while (imgIdx < allImages.length) {
    const remaining = allImages.length - imgIdx;
    const targetCount =
      remaining === 1 ? 1 : remaining === 2 ? 2 : rowPatternIdx % 2 === 0 ? 2 : 3;
    const rowImgs = allImages.slice(imgIdx, imgIdx + targetCount);
    imgIdx += rowImgs.length;
    rowPatternIdx++;

    const aspects = rowImgs.map((c) => getAspectRatio(c));
    const sumAspect = aspects.reduce((a, b) => a + b, 0);
    const availW = masterW - gap * (rowImgs.length - 1);
    const rowH = Math.max(170, Math.min(370, Math.round(availW / sumAspect)));

    let rowX = 0;
    rowImgs.forEach((c, i) => {
      const isLast = i === rowImgs.length - 1;
      const w = isLast
        ? Math.max(120, masterW - rowX)
        : Math.max(120, Math.round(rowH * aspects[i]));
      items.push({
        id: c.id,
        x: rowX,
        y: cursorY,
        w,
        h: rowH,
        z: ++z,
        framed: false,
      });
      rowX += w + gap;
    });
    cursorY += rowH + gap;
  }

  if (swatches.length > 0) {
    const n = swatches.length;
    const swW = Math.floor((masterW - gap * (n - 1)) / n);
    const swH = 104;
    let rowX = 0;
    swatches.forEach((sw, i) => {
      const isLast = i === n - 1;
      const w = isLast ? masterW - rowX : swW;
      items.push({
        id: sw.id,
        x: rowX,
        y: cursorY,
        w,
        h: swH,
        z: ++z,
      });
      rowX += w + gap;
    });
  }

  return normalizeBox(items);
}

function collidesWithAny(candidate: Rect, obstacles: Rect[], pad = 28): boolean {
  const expanded: Rect = {
    x: candidate.x - pad,
    y: candidate.y - pad,
    w: candidate.w + pad * 2,
    h: candidate.h + pad * 2,
  };
  return obstacles.some((obs) => rectsIntersect(expanded, obs));
}

function findNonCollidingPlacement(
  originX: number,
  originY: number,
  w: number,
  h: number,
  obstacles: Rect[]
): { x: number; y: number } {
  let x = originX;
  let y = originY;
  for (let i = 0; i < 60; i++) {
    if (!collidesWithAny({ x, y, w, h }, obstacles, 28)) {
      return { x, y };
    }
    if (i % 6 === 5) {
      x = originX;
      y += Math.max(160, Math.round(h * 0.55));
    } else {
      x += 180;
    }
  }
  return { x, y };
}

export function computeArrangedCards(
  allCards: Card[],
  selectedIds: string[],
  options: ArrangeOptions
): Card[] {
  const boardCards = allCards.filter((c) => !c.inbox);
  if (boardCards.length === 0) return allCards;

  const lockedFrameIds = new Set(
    boardCards.filter((c) => c.kind === 'frame' && c.locked).map((c) => c.id)
  );
  const selSet = new Set(selectedIds);
  const useSelection = selSet.size > 0;

  const selectedUnlockedFrameIds = new Set(
    boardCards
      .filter((c) => c.kind === 'frame' && !c.locked && (!useSelection || selSet.has(c.id)))
      .map((c) => c.id)
  );

  const isCardTargeted = (c: Card): boolean => {
    if (c.inbox || c.locked) return false;
    if (c.groupId && lockedFrameIds.has(c.groupId)) return false;
    if (!useSelection) return true;
    if (selSet.has(c.id)) return true;
    if (c.groupId && selectedUnlockedFrameIds.has(c.groupId)) return true;
    return false;
  };

  const targetedCards = boardCards.filter(isCardTargeted);
  if (targetedCards.length === 0) return allCards;

  const targetedIdSet = new Set(targetedCards.map((c) => c.id));
  const obstacles: Rect[] = boardCards
    .filter((c) => !targetedIdSet.has(c.id))
    .map((c) => ({ x: c.x, y: c.y, w: c.w, h: c.h }));

  const targetBounds = computeCardsBounds(targetedCards);
  const startOriginX = targetBounds ? Math.round(targetBounds.x) : 80;
  const startOriginY = targetBounds ? Math.round(targetBounds.y) : 80;

  const groupedFrameIds = new Set<string>();
  for (const c of targetedCards) {
    if (c.kind === 'frame') {
      const hasMembers = targetedCards.some((m) => m.groupId === c.id);
      if (hasMembers) groupedFrameIds.add(c.id);
    }
  }

  const looseCards = targetedCards
    .filter((c) => c.kind !== 'frame' && !(c.groupId && groupedFrameIds.has(c.groupId)))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  const maxExistingZ = boardCards.reduce((m, c) => Math.max(m, c.z), 1);
  let nextBaseZ = maxExistingZ + 2;

  const boxes: CompositionBox[] = [];

  if (looseCards.length > 0) {
    let mainBox: CompositionBox;
    if (options.mode === 'bento') {
      mainBox = layoutEditorialBento(looseCards, options, nextBaseZ);
    } else if (options.mode === 'zones') {
      mainBox = layoutConceptZones(looseCards, options, nextBaseZ);
    } else if (options.mode === 'grid') {
      mainBox = layoutSwissJustifiedGrid(looseCards, nextBaseZ);
    } else {
      mainBox = layoutFocalCollage(looseCards, options, nextBaseZ);
    }
    boxes.push(mainBox);
    nextBaseZ += looseCards.length + 80;
  }

  for (const frameId of [...groupedFrameIds].sort()) {
    const frame = targetedCards.find((c) => c.id === frameId);
    const members = targetedCards.filter((c) => c.groupId === frameId);
    if (!frame || members.length === 0) continue;
    const b = computeCardsBounds([frame, ...members]);
    if (!b) continue;
    boxes.push({
      items: members.map((m, idx) => ({
        id: m.id,
        x: Math.round(m.x - b.x),
        y: Math.round(m.y - b.y),
        w: m.w,
        h: m.h,
        z: nextBaseZ + idx + 2,
        framed: m.framed,
      })),
      bounds: { x: 0, y: 0, w: b.w, h: b.h },
    });
    nextBaseZ += members.length + 12;
  }

  const placedRects: Rect[] = [...obstacles];
  const finalUpdates = new Map<string, PlacedCardPatch>();
  let cursorX = startOriginX;
  const cursorY = startOriginY;

  for (const box of boxes) {
    const pos = findNonCollidingPlacement(
      cursorX,
      cursorY,
      box.bounds.w,
      box.bounds.h,
      placedRects
    );
    for (const item of box.items) {
      finalUpdates.set(item.id, {
        ...item,
        x: Math.round(pos.x + item.x),
        y: Math.round(pos.y + item.y),
      });
    }
    placedRects.push({ x: pos.x, y: pos.y, w: box.bounds.w, h: box.bounds.h });
    cursorX = pos.x + box.bounds.w + 80;
  }

  const now = new Date().toISOString();
  const updated = allCards.map((c) => {
    const upd = finalUpdates.get(c.id);
    if (!upd) return c;
    return {
      ...c,
      x: upd.x,
      y: upd.y,
      w: upd.w,
      h: upd.h,
      z: upd.z,
      framed: upd.framed ?? false,
      updatedAt: now,
    };
  });

  const withFrames = recomputeFrameBoundsForAll(updated);
  return withFrames.map((c) => {
    if (c.kind !== 'frame') return c;
    const members = withFrames.filter((m) => m.groupId === c.id);
    if (members.length === 0) return c;
    const minMemberZ = Math.min(...members.map((m) => m.z));
    if (c.z >= minMemberZ) {
      return { ...c, z: Math.max(1, minMemberZ - 1) };
    }
    return c;
  });
}

export function getCategoryOrder(): Category[] {
  return [...CATEGORY_ORDER];
}
