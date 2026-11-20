import {
  CATEGORY_ORDER,
  type ArrangeOptions,
  type Card,
  type Category,
} from './types';
import { computeCardsBounds, recomputeFrameBoundsForAll, rectsIntersect, type Rect } from './geometry';

const FREEFORM_WIDTHS = [300, 228, 265, 240];
const HORIZONTAL_NUDGES = [0, -10, 12, -6, 8];

interface ClusterBox {
  key: string;
  items: Array<{ id: string; x: number; y: number; w: number; h: number; z: number }>;
  bounds: Rect;
}

function preserveCardSize(card: Card, targetW: number, mode: 'grid' | 'freeform'): { w: number; h: number } {
  if (card.kind === 'color') {
    return mode === 'grid'
      ? { w: Math.min(targetW, 200), h: 112 }
      : { w: 176, h: 108 };
  }
  if (card.kind === 'note') {
    const w = mode === 'grid' ? targetW : Math.max(220, Math.min(280, targetW));
    const h = Math.max(120, Math.min(260, card.h));
    return { w, h };
  }
  if (card.kind === 'file' || card.kind === 'link') {
    const w = mode === 'grid' ? targetW : Math.max(220, Math.min(276, targetW));
    const h = Math.max(96, Math.min(180, card.h));
    return { w, h };
  }
  // Image card: keep aspect ratio, clamp extreme ratios nicely
  const ratio = card.w > 0 && card.h > 0 ? card.h / card.w : 0.75;
  const rawH = Math.round(targetW * ratio);
  const clampedH = Math.max(120, Math.min(440, rawH));
  return { w: Math.round(targetW), h: clampedH };
}

function layoutLooseCluster(
  cards: Card[],
  options: ArrangeOptions,
  baseZ: number
): ClusterBox {
  const n = cards.length;
  const cols = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(n))));
  const items: ClusterBox['items'] = [];

  if (options.mode === 'grid') {
    const colW = 260;
    const gapX = 28;
    const gapY = 28;
    let cursorY = 0;

    for (let rowStart = 0; rowStart < n; rowStart += cols) {
      const slice = cards.slice(rowStart, rowStart + cols);
      let rowMaxH = 0;
      slice.forEach((card, colIdx) => {
        const { w, h } = preserveCardSize(card, colW, 'grid');
        const x = colIdx * (colW + gapX);
        const y = cursorY;
        items.push({ id: card.id, x, y, w, h, z: baseZ + rowStart + colIdx });
        if (h > rowMaxH) rowMaxH = h;
      });
      cursorY += rowMaxH + gapY;
    }
  } else {
    // Freeform collage: shortest column placement + controlled overlap (0..35px)
    const t = Math.max(0, Math.min(1, options.overlap / 100));
    const baseGapX = Math.round(24 * (1 - t) - 22 * t); // +24 down to -22
    const baseGapY = Math.round(24 * (1 - t) - 28 * t); // +24 down to -28
    const colHeights = new Array<number>(cols).fill(0);
    const colX = new Array<number>(cols).fill(0);
    // Estimate deterministic column x anchors using average width
    const colPitch = Math.max(210, 272 + baseGapX);
    for (let c = 0; c < cols; c++) {
      colX[c] = c * colPitch;
    }

    cards.forEach((card, idx) => {
      // Pick shortest column deterministically
      let bestCol = 0;
      for (let c = 1; c < cols; c++) {
        if (colHeights[c] < colHeights[bestCol]) {
          bestCol = c;
        }
      }
      const refW = FREEFORM_WIDTHS[idx % FREEFORM_WIDTHS.length];
      const { w, h } = preserveCardSize(card, refW, 'freeform');
      const isTextSensitive = card.kind === 'note' || card.kind === 'file' || card.kind === 'color';
      const nudgeX = Math.round(HORIZONTAL_NUDGES[idx % HORIZONTAL_NUDGES.length] * (0.4 + 0.6 * t));
      const x = Math.round(colX[bestCol] + nudgeX);

      // Protect text-sensitive cards from being overlapped aggressively
      const prevH = colHeights[bestCol];
      const gapY = prevH === 0 ? 0 : isTextSensitive ? Math.max(14, baseGapY) : baseGapY;
      const y = Math.round(prevH + gapY);

      // Keep notes/colors slightly higher z so readable text isn't buried behind overlapping images
      const zBoost = isTextSensitive ? n + 5 : 0;
      items.push({ id: card.id, x, y, w, h, z: baseZ + idx + zBoost });
      colHeights[bestCol] = y + h;
    });
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
  // Normalize cluster local origin to (0, 0)
  for (const it of items) {
    it.x -= minX;
    it.y -= minY;
  }

  return {
    key: 'cluster',
    items,
    bounds: { x: 0, y: 0, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) },
  };
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
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    const candidate: Rect = { x, y, w, h };
    if (!collidesWithAny(candidate, obstacles, 28)) {
      return { x, y };
    }
    // Shift right first, occasionally step down to avoid infinitely wide sprawl
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
 * Pure deterministic auto-layout engine matching Section 9.
 * Never mutates input cards; returns a new cards array ready for preview or commit.
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

  // Determine target set: if selection active, include selected cards + members of selected unlocked frames
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

  // Obstacles are all non-targeted board cards (locked cards, locked frames, cards outside selection)
  const obstacles: Rect[] = boardCards
    .filter((c) => !targetedIdSet.has(c.id))
    .map((c) => ({ x: c.x, y: c.y, w: c.w, h: c.h }));

  // Compute starting origin from bounds of targeted cards
  const targetBounds = computeCardsBounds(targetedCards);
  const startOriginX = targetBounds ? Math.round(targetBounds.x) : 80;
  const startOriginY = targetBounds ? Math.round(targetBounds.y) : 80;

  // Separate intact unlocked group units from loose cards
  const groupedFrameIds = new Set<string>();
  for (const c of targetedCards) {
    if (c.kind === 'frame') {
      const hasMembers = targetedCards.some((m) => m.groupId === c.id);
      if (hasMembers) groupedFrameIds.add(c.id);
    }
  }

  const looseCards = targetedCards
    .filter((c) => c.kind !== 'frame' && !(c.groupId && groupedFrameIds.has(c.groupId)))
    .sort((a, b) => a.y - b.y || a.x - b.x || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  const clusters: ClusterBox[] = [];
  const maxExistingZ = boardCards.reduce((m, c) => Math.max(m, c.z), 1);
  let nextBaseZ = maxExistingZ + 2;

  if (options.groupByCategory) {
    for (const cat of CATEGORY_ORDER) {
      const subset = looseCards.filter((c) => c.category === cat);
      if (subset.length === 0) continue;
      const box = layoutLooseCluster(subset, options, nextBaseZ);
      box.key = cat;
      clusters.push(box);
      nextBaseZ += subset.length + 20;
    }
  } else if (looseCards.length > 0) {
    const box = layoutLooseCluster(looseCards, options, nextBaseZ);
    box.key = 'all';
    clusters.push(box);
    nextBaseZ += looseCards.length + 20;
  }

  // Add intact unlocked groups as independent cluster boxes preserving relative member layout
  for (const frameId of [...groupedFrameIds].sort()) {
    const frame = targetedCards.find((c) => c.id === frameId);
    const members = targetedCards.filter((c) => c.groupId === frameId);
    if (!frame || members.length === 0) continue;
    const b = computeCardsBounds([frame, ...members]);
    if (!b) continue;
    const items = members.map((m, idx) => ({
      id: m.id,
      x: Math.round(m.x - b.x),
      y: Math.round(m.y - b.y),
      w: m.w,
      h: m.h,
      z: nextBaseZ + idx + 2,
    }));
    clusters.push({
      key: `group:${frameId}`,
      items,
      bounds: { x: 0, y: 0, w: b.w, h: b.h },
    });
    nextBaseZ += members.length + 10;
  }

  // Place clusters horizontally in rows with 76px gap, avoiding obstacles
  const clusterGap = 76;
  const maxRowWidth = 1480;
  let cursorX = startOriginX;
  let cursorY = startOriginY;
  let currentRowMaxH = 0;
  const placedRects: Rect[] = [...obstacles];
  const finalUpdates = new Map<string, { x: number; y: number; w: number; h: number; z: number }>();

  for (const cluster of clusters) {
    if (cursorX > startOriginX && cursorX - startOriginX + cluster.bounds.w > maxRowWidth) {
      cursorX = startOriginX;
      cursorY += currentRowMaxH + clusterGap;
      currentRowMaxH = 0;
    }

    const pos = findNonCollidingPlacement(
      cursorX,
      cursorY,
      cluster.bounds.w,
      cluster.bounds.h,
      placedRects
    );

    for (const item of cluster.items) {
      finalUpdates.set(item.id, {
        x: Math.round(pos.x + item.x),
        y: Math.round(pos.y + item.y),
        w: Math.round(item.w),
        h: Math.round(item.h),
        z: item.z,
      });
    }

    const placed: Rect = {
      x: pos.x,
      y: pos.y,
      w: cluster.bounds.w,
      h: cluster.bounds.h,
    };
    placedRects.push(placed);
    cursorX = pos.x + cluster.bounds.w + clusterGap;
    currentRowMaxH = Math.max(currentRowMaxH, cluster.bounds.h);
  }

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
      updatedAt: new Date().toISOString(),
    };
  });

  // Recompute frames around members and guarantee frame sits behind its members
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
