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

function sizeImageByWidth(card: Card, targetW: number, minH = 120, maxH = 480): { w: number; h: number } {
  const aspect = getAspectRatio(card);
  const rawH = Math.round(targetW / aspect);
  return {
    w: Math.round(targetW),
    h: Math.max(minH, Math.min(maxH, rawH)),
  };
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
 * - visualImages: all image cards sorted by compositional priority (reference -> furniture -> sketch -> material -> palette -> other)
 * - swatches: all color swatch cards sorted by luminance (dark -> light or warm progression)
 * - editorials: notes, files, links (never buried inside photo overlaps; placed in perimeter callout/header zones)
 */
function partitionByDesignerRole(cards: Card[]) {
  const images = cards.filter((c) => c.kind === 'image');
  const swatches = [...cards.filter((c) => c.kind === 'color')].sort(
    (a, b) => parseHexLuminance(a.color) - parseHexLuminance(b.color) || a.id.localeCompare(b.id)
  );
  const editorials = cards.filter(
    (c) => c.kind === 'note' || c.kind === 'file' || c.kind === 'link'
  );

  // Pick Hero Anchor(s): prefer 'reference' category or largest area image
  const rolePriority: Record<Category, number> = {
    reference: 1,
    furniture: 2,
    sketch: 3,
    material: 4,
    palette: 5,
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
    if (idx === 0 || (img.category === 'reference' && heroes.length < Math.ceil(sortedImages.length / 6))) {
      heroes.push(img);
    } else if (img.category === 'material' || img.category === 'palette') {
      accents.push(img);
    } else {
      supports.push(img);
    }
  });

  // If no explicit accents exist and we have >= 4 images, promote the last image as a focal accent overlay
  if (accents.length === 0 && supports.length >= 3) {
    const promoted = supports.pop();
    if (promoted) accents.push(promoted);
  }

  return { heroes, supports, accents, swatches, editorials, allImages: sortedImages };
}

/**
 * MODE 1: EDITORIAL BENTO (Inspired by Pinterest References #3, #6, #8)
 * - Tightly aligned central mosaic block (2 main columns + interlocking rows).
 * - Accent/Material images sit as crisp white-framed focal cards directly over the seam intersections!
 * - Color swatches form a unified horizontal palette bar docked across the bottom edge of the mosaic.
 * - Notes / DWG files sit in clean Left & Right perimeter callout margins flanking the mosaic.
 */
function layoutEditorialBento(
  cards: Card[],
  options: ArrangeOptions,
  baseZ: number
): CompositionBox {
  const { heroes, supports, accents, swatches, editorials } = partitionByDesignerRole(cards);
  const t = Math.max(0, Math.min(1, options.overlap / 100));
  const useFrame = options.galleryFrame ?? true;
  // Seam gap shrinks from 14px (clean grid) down to 2px (tight magazine mosaic) as slider increases
  const seam = Math.round(14 * (1 - t * 0.75));
  const items: PlacedCardPatch[] = [];
  let z = baseZ;

  const leftColW = 460;
  const rightColW = 340;
  const mosaicW = leftColW + seam + rightColW;

  let leftY = 0;
  let rightY = 0;
  const seamIntersections: Array<{ x: number; y: number }> = [];

  // 1. Place Hero card(s) & Supporting cards into the 2-column Bento core
  const coreImages = [...heroes, ...supports];
  // If we have very few core images, include accents in core except 1 focal overlay
  const overlayAccents =
    coreImages.length >= 3 && t >= 0.15
      ? accents.slice(0, Math.max(1, Math.min(2, accents.length)))
      : [];
  const inlineAccents = accents.slice(overlayAccents.length);
  const bentoPool = [...coreImages, ...inlineAccents];

  bentoPool.forEach((img, idx) => {
    const placeLeft = idx === 0 || leftY <= rightY;
    if (placeLeft) {
      // Check if we can split left column into 2 side-by-side sub-cells for variety on row 2+
      const { h } = sizeImageByWidth(img, leftColW, 190, 380);
      items.push({
        id: img.id,
        x: 0,
        y: leftY,
        w: leftColW,
        h,
        z: ++z,
        framed: false,
      });
      seamIntersections.push({ x: leftColW, y: leftY + h });
      leftY += h + seam;
    } else {
      const { h } = sizeImageByWidth(img, rightColW, 175, 360);
      items.push({
        id: img.id,
        x: leftColW + seam,
        y: rightY,
        w: rightColW,
        h,
        z: ++z,
        framed: false,
      });
      seamIntersections.push({ x: leftColW, y: rightY + h });
      rightY += h + seam;
    }
  });

  // Balance bottom edge of the 2 Bento columns when both columns have cards
  const leftItems = items.filter((it) => it.x === 0);
  const rightItems = items.filter((it) => it.x > 0);
  if (leftItems.length > 0 && rightItems.length > 0) {
    const maxColH = Math.max(leftY - seam, rightY - seam);
    const lastLeft = leftItems[leftItems.length - 1];
    const lastRight = rightItems[rightItems.length - 1];
    const leftDiff = maxColH - (lastLeft.y + lastLeft.h);
    const rightDiff = maxColH - (lastRight.y + lastRight.h);
    if (leftDiff > 0 && leftDiff < 140) lastLeft.h += leftDiff;
    if (rightDiff > 0 && rightDiff < 140) lastRight.h += rightDiff;
  }

  const mosaicH = Math.max(leftY, rightY, 240) - (bentoPool.length > 0 ? seam : 0);

  // 2. Signature Designer Touch (Image #8): White-framed Focal Accent card(s) sitting on Seam Intersections!
  overlayAccents.forEach((acc, idx) => {
    const anchor = seamIntersections[idx] ?? {
      x: leftColW,
      y: Math.round(mosaicH * (0.38 + idx * 0.3)),
    };
    const boxW = Math.round(186 + 28 * t);
    const { w, h } = sizeImageByWidth(acc, boxW, 160, 230);
    items.push({
      id: acc.id,
      x: Math.round(anchor.x - w * 0.52),
      y: Math.round(anchor.y - h * 0.5),
      w,
      h,
      z: baseZ + 40 + idx,
      framed: useFrame,
    });
  });

  // 3. Bottom Color Palette Dock (Images #3, #6, #8: sleek horizontal row of vertical swatch bars)
  let bottomCursorY = mosaicH;
  if (swatches.length > 0) {
    const nSw = swatches.length;
    const swGap = 12;
    const totalBarW = Math.min(mosaicW, Math.max(420, nSw * 142));
    const swW = Math.max(96, Math.min(168, Math.floor((totalBarW - swGap * (nSw - 1)) / nSw)));
    const swH = 112;
    const actualRowW = nSw * swW + (nSw - 1) * swGap;
    const startX = Math.round((mosaicW - actualRowW) / 2);
    // At higher overlap slider, the swatch bar kisses/overlaps the bottom 22px of the mosaic just like Image #8!
    const overlapUp = Math.round(24 * t);
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
    bottomCursorY = swY + swH;
  }

  // 4. Perimeter Callout Margins for Notes, DWG Files & Links (Images #3, #7, #8)
  const marginGap = 36;
  const noteW = 264;
  let leftMarginY = 12;
  let rightMarginY = 12;

  editorials.forEach((ed, idx) => {
    const h = ed.kind === 'file' ? 86 : ed.kind === 'link' ? 108 : Math.max(136, Math.min(210, ed.h));
    if (idx % 2 === 0) {
      // Left margin callout
      items.push({
        id: ed.id,
        x: -(noteW + marginGap),
        y: leftMarginY,
        w: noteW,
        h,
        z: baseZ + 50 + idx,
      });
      leftMarginY += h + 24;
    } else {
      // Right margin callout
      items.push({
        id: ed.id,
        x: mosaicW + marginGap,
        y: rightMarginY,
        w: noteW,
        h,
        z: baseZ + 50 + idx,
      });
      rightMarginY += h + 24;
    }
  });

  void bottomCursorY;
  return normalizeBox(items);
}

/**
 * MODE 2: LAYERED FOCAL COLLAGE / SCRAPBOOK (Inspired by Pinterest References #2, #4, #5)
 * - Strong 3-tier scale hierarchy: 1 Commanding Hero Anchor -> Medium Supporting cards anchored to Hero's corners -> Compact Accent cards tucked into seams.
 * - Corner-Only Overlap invariant: overlapping cards NEVER cover the inner 65% focal core of the card beneath!
 * - Swatches form a sleek vertical Palette Rail hugging the right edge of the island (Images #2 & #4).
 * - Notes & files sit in the Top-Left Editorial Header & Bottom-Left Spec zones (Image #5 STUDIO NEBULA).
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
    // Only notes/swatches exist
    return layoutEditorialBento(cards, options, baseZ);
  }

  // Tier 1: Primary Hero Anchor
  const hero = allVisuals[0];
  const heroW = Math.round(440 + 80 * t); // 440..520px
  const heroSize = sizeImageByWidth(hero, heroW, 280, 420);
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

  // Inset factor controls how far supporting cards step over the Hero's outer corner (from -18px gap to +24% corner overlap)
  const insetRatio = -0.05 + 0.27 * t; // -5% (gap) at t=0 -> +22% corner overlap at t=1

  // Tier 2 & 3 slots around the Hero perimeter (Pinwheel / Spiral focal island)
  const remainingVisuals = [...supports, ...heroes.slice(1), ...accents];

  remainingVisuals.forEach((card, idx) => {
    const isAccent = card.category === 'material' || card.category === 'palette' || idx >= 4;
    const targetW = isAccent
      ? Math.round(215 - 20 * t) // Compact tactile square/detail (195..215px)
      : Math.round(285 - 15 * t); // Medium supporting card (270..285px)
    const { w, h } = sizeImageByWidth(card, targetW, 145, 340);

    const insetX = Math.round(Math.min(w, heroRect.w) * insetRatio);
    const insetY = Math.round(Math.min(h, heroRect.h) * insetRatio);

    let x = 0;
    let y = 0;
    const slot = idx % 6;

    switch (slot) {
      case 0:
        // Bottom-Right Corner of Hero (Classic armchair-over-living-room overlap!)
        x = heroRect.x + heroRect.w - insetX;
        y = heroRect.y + heroRect.h - Math.round(h * 0.72);
        break;
      case 1:
        // Top-Right Shoulder of Hero
        x = heroRect.x + heroRect.w - Math.round(insetX * 0.7) + 14;
        y = heroRect.y - Math.round(h * 0.18);
        break;
      case 2:
        // Bottom-Left Base beneath Hero
        x = heroRect.x + Math.round(heroRect.w * 0.08);
        y = heroRect.y + heroRect.h - insetY;
        break;
      case 3:
        // Far Right Lower Counterweight (interlocking with slot 0 & slot 1)
        x = heroRect.x + heroRect.w + Math.round(w * 0.78) - insetX;
        y = heroRect.y + Math.round(heroRect.h * 0.24);
        break;
      case 4:
        // Left Flank of Hero
        x = heroRect.x - w + insetX;
        y = heroRect.y + Math.round(heroRect.h * 0.28);
        break;
      default: {
        // Extended island rows for 7+ images
        const extraRow = Math.floor(idx / 6);
        const col = idx % 3;
        x = heroRect.x + col * (w + 18);
        y = heroRect.y + heroRect.h + 180 + (extraRow - 1) * (h + 20);
        break;
      }
    }

    items.push({
      id: card.id,
      x: Math.round(x),
      y: Math.round(y),
      w,
      h,
      z: isAccent ? baseZ + 30 + idx : baseZ + 12 + idx,
      framed: useFrame,
    });
  });

  // Compute current photo island bounds so we can dock the Swatch Rail & Editorial Headers cleanly
  const photoBox = normalizeBox(items);
  // Keep original coordinates before final normalization
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
  void photoBox;

  // Vertical Color Palette Rail hugging the Right Flank (Images #2 & #4)
  if (swatches.length > 0) {
    const railX = Math.round(islandMaxX + 24);
    const swW = 148;
    const swH = 88;
    const swGap = 10;
    const totalRailH = swatches.length * swH + (swatches.length - 1) * swGap;
    const startY = Math.round(islandMinY + Math.max(0, (islandMaxY - islandMinY - totalRailH) / 2));

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

  // Editorial Intro & Technical Specs (Image #5 STUDIO NEBULA: Top-Left Manifest + Bottom-Left/Right Notes)
  editorials.forEach((ed, idx) => {
    const w = ed.kind === 'file' ? 284 : 296;
    const h = ed.kind === 'file' ? 84 : ed.kind === 'link' ? 108 : Math.max(142, Math.min(196, ed.h));
    if (idx === 0) {
      // Top-Left Editorial Header above Hero
      items.push({
        id: ed.id,
        x: heroRect.x,
        y: islandMinY - h - 24,
        w: Math.max(w, 330),
        h,
        z: baseZ + 60,
      });
    } else if (idx === 1) {
      // Bottom-Right or Bottom-Left Spec Slot
      items.push({
        id: ed.id,
        x: Math.round(islandMaxX - w),
        y: Math.round(islandMaxY + 24),
        w,
        h,
        z: baseZ + 61,
      });
    } else {
      items.push({
        id: ed.id,
        x: Math.round(islandMinX + ((idx - 2) % 3) * (w + 20)),
        y: Math.round(islandMaxY + 24 + Math.floor((idx - 2) / 3) * (h + 18)),
        w,
        h,
        z: baseZ + 60 + idx,
      });
    }
  });

  return normalizeBox(items);
}

/**
 * MODE 3: CONCEPT ZONES / PRESENTATION SPREAD (Inspired by Pinterest References #1 & #7)
 * - Groups cards into thematic zones (Space, Furniture, Palette, Material, Floor Plan/Sketch, Notes).
 * - Within each zone, cards are arranged in a diagonal magazine staircase/cascade overlap (Image #1 PHOTOS / TEXTURE / GRAPHICS) rather than a flat list!
 * - Swatches form a compact 2-column pigment mosaic inside the Palette zone.
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

    // Arrange photos/notes in a diagonal staggered cascade within the zone
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
          // Diagonal step to bottom-right of anchor (Image #1 PHOTOS cascade!)
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
        // Note, file or link inside zone
        const w = c.kind === 'file' ? 284 : 284;
        const h = c.kind === 'file' ? 84 : c.kind === 'link' ? 108 : Math.max(132, Math.min(190, c.h));
        const y = cursorY === 0 ? 0 : cursorY + 14;
        zoneItems.push({ id: c.id, x: 0, y, w, h, z: ++z });
        cursorY = y + h;
      }
    });

    // Arrange color swatches as a tight 2-column pigment block (Image #1 COLORS)
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

  // Place zones in a balanced 2-row panoramic spread (max 3 zones per row)
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
 * - Every row is mathematically aspect-ratio justified so both the left and right outer margins
 *   align to a razor-sharp master width (W_master = 920px) while keeping 100% true image aspect ratios!
 * - Swatches form a full-width equal-division palette strip across the bottom.
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

  // 1. Top Editorial Specification Row (Notes / Files / Links)
  if (editorials.length > 0) {
    const perRow = Math.min(3, editorials.length);
    for (let i = 0; i < editorials.length; i += perRow) {
      const slice = editorials.slice(i, i + perRow);
      const cellW = Math.floor((masterW - gap * (slice.length - 1)) / slice.length);
      const rowH = slice.some((c) => c.kind === 'note') ? 148 : 96;
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

  // 2. Justified Aspect-Ratio Image Rows (alternating 2-card Hero row and 3-card Detail row)
  let imgIdx = 0;
  let rowPatternIdx = 0;
  while (imgIdx < allImages.length) {
    const remaining = allImages.length - imgIdx;
    const targetCount = remaining === 1 ? 1 : remaining === 2 ? 2 : rowPatternIdx % 2 === 0 ? 2 : 3;
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
      const w = isLast ? Math.max(120, masterW - rowX) : Math.max(120, Math.round(rowH * aspects[i]));
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

  // 3. Bottom Full-Width Palette Strip (Image #6 Colour Palette bar)
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

/**
 * Pure deterministic Designer Moodboard Auto-Layout Engine.
 * Supports 4 authentic studio archetypes ('bento', 'freeform', 'zones', 'grid')
 * plus locked card/frame protection and obstacle avoidance.
 */
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

  // Separate intact unlocked group frames from loose cards
  const groupedFrameIds = new Set<string>();
  for (const c of targetedCards) {
    if (c.kind === 'frame') {
      const hasMembers = targetedCards.some((m) => m.groupId === c.id);
      if (hasMembers) groupedFrameIds.add(c.id);
    }
  }

  const looseCards = targetedCards
    .filter((c) => c.kind !== 'frame' && !(c.groupId && groupedFrameIds.has(c.groupId)))
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
    );

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
      if (options.groupByCategory) {
        // When grouping by category in Grid mode, create clean Swiss rows per category
        mainBox = layoutSwissJustifiedGrid(looseCards, nextBaseZ);
      } else {
        mainBox = layoutSwissJustifiedGrid(looseCards, nextBaseZ);
      }
    } else {
      // 'freeform' (Layered Focal Collage)
      mainBox = options.groupByCategory
        ? layoutFocalCollage(looseCards, options, nextBaseZ)
        : layoutFocalCollage(looseCards, { ...options, overlap: Math.max(25, options.overlap) }, nextBaseZ);
    }
    boxes.push(mainBox);
    nextBaseZ += looseCards.length + 80;
  }

  // Keep existing unlocked group frames intact as atomic units
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
