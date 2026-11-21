import type { Card, ProjectView } from './types';

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 3.0;

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type AlignMode =
  | 'left'
  | 'center-h'
  | 'right'
  | 'top'
  | 'center-v'
  | 'bottom'
  | 'distribute-h'
  | 'distribute-v';

export interface SmartGuideLine {
  axis: 'x' | 'y';
  pos: number;
  start: number;
  end: number;
  kind: 'edge' | 'center';
}

export interface SmartSpacingGuide {
  axis: 'x' | 'y';
  crossPos: number;
  start: number;
  end: number;
  distance: number;
}

export interface SnapResult {
  deltaWorld: Point;
  rect: Rect;
  guides: SmartGuideLine[];
  spacings: SmartSpacingGuide[];
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function worldToScreen(worldPoint: Point, view: ProjectView): Point {
  return {
    x: worldPoint.x * view.zoom + view.x,
    y: worldPoint.y * view.zoom + view.y,
  };
}

export function screenToWorld(screenPoint: Point, view: ProjectView): Point {
  return {
    x: (screenPoint.x - view.x) / view.zoom,
    y: (screenPoint.y - view.y) / view.zoom,
  };
}

export function zoomAtScreenPoint(
  view: ProjectView,
  screenPoint: Point,
  nextZoomRaw: number
): ProjectView {
  const nextZoom = clampZoom(nextZoomRaw);
  const worldBefore = screenToWorld(screenPoint, view);
  return {
    zoom: nextZoom,
    x: screenPoint.x - worldBefore.x * nextZoom,
    y: screenPoint.y - worldBefore.y * nextZoom,
  };
}

export function getCardRotatedAABB(card: {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
}): Rect {
  const deg = card.rotation ?? 0;
  if (Math.abs(deg) < 0.05) {
    return { x: card.x, y: card.y, w: card.w, h: card.h };
  }
  const rad = (deg * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  const rotW = card.w * c + card.h * s;
  const rotH = card.w * s + card.h * c;
  const cx = card.x + card.w / 2;
  const cy = card.y + card.h / 2;
  return {
    x: cx - rotW / 2,
    y: cy - rotH / 2,
    w: rotW,
    h: rotH,
  };
}

export function computeCardsBounds(cards: Card[]): Rect | null {
  if (cards.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of cards) {
    const b = getCardRotatedAABB(c);
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.w > maxX) maxX = b.x + b.w;
    if (b.y + b.h > maxY) maxY = b.y + b.h;
  }
  return {
    x: minX,
    y: minY,
    w: Math.max(1, maxX - minX),
    h: Math.max(1, maxY - minY),
  };
}

export function computeFitView(
  cards: Card[],
  viewportW: number,
  viewportH: number,
  insetsInput: number | { side: number; left?: number; right?: number; top: number; bottom: number } = {
    side: 48,
    top: 84,
    bottom: 92,
  }
): ProjectView {
  const bounds = computeCardsBounds(cards);
  if (!bounds || viewportW <= 0 || viewportH <= 0) {
    return { x: Math.round(viewportW * 0.12), y: Math.round(viewportH * 0.14), zoom: 1 };
  }
  const insets =
    typeof insetsInput === 'number'
      ? { left: insetsInput, right: insetsInput, top: insetsInput + 36, bottom: insetsInput + 44 }
      : {
          left: insetsInput.left ?? insetsInput.side,
          right: insetsInput.right ?? insetsInput.side,
          top: insetsInput.top,
          bottom: insetsInput.bottom,
        };
  const availW = Math.max(1, viewportW - insets.left - insets.right);
  const availH = Math.max(1, viewportH - insets.top - insets.bottom);

  const rawZoom = Math.min(availW / bounds.w, availH / bounds.h, 1.15);
  const zoom = clampZoom(rawZoom);
  const centerX = bounds.x + bounds.w / 2;
  const centerY = bounds.y + bounds.h / 2;

  return {
    zoom,
    x: Math.round(insets.left + availW / 2 - centerX * zoom),
    y: Math.round(insets.top + availH / 2 - centerY * zoom),
  };
}

export interface ConnectorCurve {
  sx: number;
  sy: number;
  c1x: number;
  c1y: number;
  c2x: number;
  c2y: number;
  ex: number;
  ey: number;
  endAngle: number;
  svgPath: string;
}

/**
 * Computes a smooth Milanote/FigJam style edge-to-edge cubic Bezier connector curve
 * between two card rects, exiting & entering card edges cleanly without crossing card centers.
 */
export function computeConnectorCurve(src: Rect, dst: Rect): ConnectorCurve {
  const ax = src.x + src.w / 2;
  const ay = src.y + src.h / 2;
  const bx = dst.x + dst.w / 2;
  const by = dst.y + dst.h / 2;
  const dx = bx - ax;
  const dy = by - ay;

  const normX = Math.abs(dx) / Math.max(1, (src.w + dst.w) / 2);
  const normY = Math.abs(dy) / Math.max(1, (src.h + dst.h) / 2);
  const horizontal = normX >= normY;

  let sx: number;
  let sy: number;
  let ex: number;
  let ey: number;
  let c1x: number;
  let c1y: number;
  let c2x: number;
  let c2y: number;

  const pad = 4;
  if (horizontal) {
    const dir = dx >= 0 ? 1 : -1;
    sx = dir > 0 ? src.x + src.w + pad : src.x - pad;
    sy = ay;
    ex = dir > 0 ? dst.x - pad : dst.x + dst.w + pad;
    ey = by;
    const pull = Math.max(44, Math.min(180, Math.abs(ex - sx) * 0.45));
    c1x = sx + dir * pull;
    c1y = sy;
    c2x = ex - dir * pull;
    c2y = ey;
  } else {
    const dir = dy >= 0 ? 1 : -1;
    sx = ax;
    sy = dir > 0 ? src.y + src.h + pad : src.y - pad;
    ex = bx;
    ey = dir > 0 ? dst.y - pad : dst.y + dst.h + pad;
    const pull = Math.max(44, Math.min(180, Math.abs(ey - sy) * 0.45));
    c1x = sx;
    c1y = sy + dir * pull;
    c2x = ex;
    c2y = ey - dir * pull;
  }

  const endAngle = Math.atan2(ey - c2y, ex - c2x);
  const svgPath = `M ${Math.round(sx)} ${Math.round(sy)} C ${Math.round(c1x)} ${Math.round(c1y)}, ${Math.round(c2x)} ${Math.round(c2y)}, ${Math.round(ex)} ${Math.round(ey)}`;
  return { sx, sy, c1x, c1y, c2x, c2y, ex, ey, endAngle, svgPath };
}

export function computeConnectorToPoint(src: Rect, targetPt: Point): ConnectorCurve {
  return computeConnectorCurve(src, { x: targetPt.x - 1, y: targetPt.y - 1, w: 2, h: 2 });
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.w < b.x ||
    b.x + b.w < a.x ||
    a.y + a.h < b.y ||
    b.y + b.h < a.y
  );
}

export function expandSelectionWithGroupMembers(
  cards: Card[],
  selectedIds: string[]
): Set<string> {
  const set = new Set(selectedIds);
  const selectedFrames = new Set(
    cards.filter((c) => c.kind === 'frame' && set.has(c.id)).map((c) => c.id)
  );
  if (selectedFrames.size > 0) {
    for (const c of cards) {
      if (c.groupId && selectedFrames.has(c.groupId)) {
        set.add(c.id);
      }
    }
  }
  return set;
}

export function getMovableCardIds(cards: Card[], selectedIds: string[]): Set<string> {
  const lockedFrameIds = new Set(
    cards.filter((c) => c.kind === 'frame' && c.locked).map((c) => c.id)
  );
  const expanded = expandSelectionWithGroupMembers(cards, selectedIds);
  const movable = new Set<string>();
  for (const c of cards) {
    if (!expanded.has(c.id) || c.inbox) continue;
    if (c.locked) continue;
    if (c.groupId && lockedFrameIds.has(c.groupId)) continue;
    movable.add(c.id);
  }
  return movable;
}

export function recomputeFrameBoundsForAll(cards: Card[]): Card[] {
  const frames = cards.filter((c) => c.kind === 'frame' && !c.inbox);
  if (frames.length === 0) return cards;

  const updates = new Map<string, Rect>();
  const padding = 24;
  const headerH = 38;

  for (const frame of frames) {
    const members = cards.filter((c) => c.groupId === frame.id && !c.inbox);
    if (members.length === 0) continue;
    const b = computeCardsBounds(members);
    if (!b) continue;
    updates.set(frame.id, {
      x: Math.round(b.x - padding),
      y: Math.round(b.y - padding - headerH),
      w: Math.round(b.w + padding * 2),
      h: Math.round(b.h + padding * 2 + headerH),
    });
  }

  return cards.map((c) => {
    const r = updates.get(c.id);
    if (!r) return c;
    return { ...c, x: r.x, y: r.y, w: r.w, h: r.h };
  });
}

const SNAP_SCREEN_PX = 7;
const MAX_NEIGHBOR_DIST_WORLD = 1800;

function spansOverlapOrNear(aStart: number, aEnd: number, bStart: number, bEnd: number, pad = 160): boolean {
  return !(aEnd + pad < bStart || bEnd + pad < aStart);
}

/**
 * Computes Canva / Illustrator / Figma style magnetic alignment & equal-spacing smart guides
 * when dragging or sticky-moving 1 or more cards.
 */
export function computeMoveSnap(
  initialBounds: Rect,
  rawDelta: Point,
  stationaryCards: Card[],
  zoom: number,
  disableSnap = false
): SnapResult {
  const rawRect: Rect = {
    x: Math.round(initialBounds.x + rawDelta.x),
    y: Math.round(initialBounds.y + rawDelta.y),
    w: initialBounds.w,
    h: initialBounds.h,
  };

  if (disableSnap || stationaryCards.length === 0) {
    return {
      deltaWorld: { x: Math.round(rawDelta.x), y: Math.round(rawDelta.y) },
      rect: rawRect,
      guides: [],
      spacings: [],
    };
  }

  const threshold = SNAP_SCREEN_PX / Math.max(0.15, zoom);

  // Filter stationary cards within reasonable proximity
  const candidates = stationaryCards.filter((c) => {
    if (c.inbox) return false;
    const dx = Math.abs(c.x + c.w / 2 - (rawRect.x + rawRect.w / 2));
    const dy = Math.abs(c.y + c.h / 2 - (rawRect.y + rawRect.h / 2));
    return dx <= MAX_NEIGHBOR_DIST_WORLD && dy <= MAX_NEIGHBOR_DIST_WORLD;
  });

  let bestDx = 0;
  let minAbsDx = threshold + 0.001;
  let snappedXLine: { pos: number; kind: 'edge' | 'center' } | null = null;
  let snappedXSpacings: SmartSpacingGuide[] = [];

  const mAnchorsX: Array<{ val: number; kind: 'edge' | 'center' }> = [
    { val: rawRect.x, kind: 'edge' },
    { val: rawRect.x + rawRect.w / 2, kind: 'center' },
    { val: rawRect.x + rawRect.w, kind: 'edge' },
  ];

  // 1. X-Axis edge & center alignment
  for (const t of candidates) {
    const tAnchorsX: Array<{ val: number; kind: 'edge' | 'center' }> = [
      { val: t.x, kind: 'edge' },
      { val: t.x + t.w / 2, kind: 'center' },
      { val: t.x + t.w, kind: 'edge' },
    ];
    for (const mPt of mAnchorsX) {
      for (const tPt of tAnchorsX) {
        const diff = tPt.val - mPt.val;
        const abs = Math.abs(diff);
        if (abs < minAbsDx) {
          minAbsDx = abs;
          bestDx = diff;
          snappedXLine = {
            pos: Math.round(tPt.val),
            kind: mPt.kind === 'center' && tPt.kind === 'center' ? 'center' : 'edge',
          };
          snappedXSpacings = [];
        }
      }
    }
  }

  // 2. X-Axis Equal Gap / Spacing Snapping (between horizontally adjacent neighbors)
  const rowNeighbors = candidates.filter((c) =>
    spansOverlapOrNear(rawRect.y, rawRect.y + rawRect.h, c.y, c.y + c.h, 80)
  );
  const leftNeighbors = rowNeighbors
    .filter((c) => c.x + c.w <= rawRect.x + threshold * 2)
    .sort((a, b) => b.x + b.w - (a.x + a.w));
  const rightNeighbors = rowNeighbors
    .filter((c) => c.x >= rawRect.x + rawRect.w - threshold * 2)
    .sort((a, b) => a.x - b.x);

  const nearestLeft = leftNeighbors[0];
  const nearestRight = rightNeighbors[0];

  // 2A. Centered equally between nearestLeft and nearestRight
  if (nearestLeft && nearestRight) {
    const leftEdge = nearestLeft.x + nearestLeft.w;
    const rightEdge = nearestRight.x;
    const avail = rightEdge - leftEdge;
    if (avail >= rawRect.w + 4) {
      const equalGap = (avail - rawRect.w) / 2;
      const idealX = leftEdge + equalGap;
      const diff = idealX - rawRect.x;
      if (Math.abs(diff) < minAbsDx) {
        minAbsDx = Math.abs(diff);
        bestDx = diff;
        const finalX = Math.round(rawRect.x + diff);
        const crossY = Math.round(
          (Math.max(rawRect.y, nearestLeft.y, nearestRight.y) +
            Math.min(
              rawRect.y + rawRect.h,
              nearestLeft.y + nearestLeft.h,
              nearestRight.y + nearestRight.h
            )) /
            2
        );
        const gapVal = Math.round(equalGap);
        snappedXSpacings = [
          { axis: 'x', crossPos: crossY, start: leftEdge, end: finalX, distance: gapVal },
          {
            axis: 'x',
            crossPos: crossY,
            start: finalX + rawRect.w,
            end: rightEdge,
            distance: gapVal,
          },
        ];
      }
    }
  }

  // 2B. Matching gap with a pair on the left (prevLeft -> nearestLeft -> moving)
  if (nearestLeft && leftNeighbors.length >= 2) {
    const prevLeft = leftNeighbors.find((c) => c.x + c.w <= nearestLeft.x - 2);
    if (prevLeft) {
      const refGap = nearestLeft.x - (prevLeft.x + prevLeft.w);
      if (refGap >= 4 && refGap <= 260) {
        const idealX = nearestLeft.x + nearestLeft.w + refGap;
        const diff = idealX - rawRect.x;
        if (Math.abs(diff) < minAbsDx) {
          minAbsDx = Math.abs(diff);
          bestDx = diff;
          const finalX = Math.round(rawRect.x + diff);
          const crossY = Math.round(rawRect.y + rawRect.h / 2);
          const gapVal = Math.round(refGap);
          snappedXSpacings = [
            {
              axis: 'x',
              crossPos: crossY,
              start: prevLeft.x + prevLeft.w,
              end: nearestLeft.x,
              distance: gapVal,
            },
            {
              axis: 'x',
              crossPos: crossY,
              start: nearestLeft.x + nearestLeft.w,
              end: finalX,
              distance: gapVal,
            },
          ];
        }
      }
    }
  }

  // 2C. Matching gap with a pair on the right (moving -> nearestRight -> nextRight)
  if (nearestRight && rightNeighbors.length >= 2) {
    const nextRight = rightNeighbors.find((c) => c.x >= nearestRight.x + nearestRight.w + 2);
    if (nextRight) {
      const refGap = nextRight.x - (nearestRight.x + nearestRight.w);
      if (refGap >= 4 && refGap <= 260) {
        const idealX = nearestRight.x - refGap - rawRect.w;
        const diff = idealX - rawRect.x;
        if (Math.abs(diff) < minAbsDx) {
          minAbsDx = Math.abs(diff);
          bestDx = diff;
          const finalX = Math.round(rawRect.x + diff);
          const crossY = Math.round(rawRect.y + rawRect.h / 2);
          const gapVal = Math.round(refGap);
          snappedXSpacings = [
            {
              axis: 'x',
              crossPos: crossY,
              start: finalX + rawRect.w,
              end: nearestRight.x,
              distance: gapVal,
            },
            {
              axis: 'x',
              crossPos: crossY,
              start: nearestRight.x + nearestRight.w,
              end: nextRight.x,
              distance: gapVal,
            },
          ];
        }
      }
    }
  }

  // 3. Y-Axis edge & center alignment
  let bestDy = 0;
  let minAbsDy = threshold + 0.001;
  let snappedYLine: { pos: number; kind: 'edge' | 'center' } | null = null;
  let snappedYSpacings: SmartSpacingGuide[] = [];

  const mAnchorsY: Array<{ val: number; kind: 'edge' | 'center' }> = [
    { val: rawRect.y, kind: 'edge' },
    { val: rawRect.y + rawRect.h / 2, kind: 'center' },
    { val: rawRect.y + rawRect.h, kind: 'edge' },
  ];

  for (const t of candidates) {
    const tAnchorsY: Array<{ val: number; kind: 'edge' | 'center' }> = [
      { val: t.y, kind: 'edge' },
      { val: t.y + t.h / 2, kind: 'center' },
      { val: t.y + t.h, kind: 'edge' },
    ];
    for (const mPt of mAnchorsY) {
      for (const tPt of tAnchorsY) {
        const diff = tPt.val - mPt.val;
        const abs = Math.abs(diff);
        if (abs < minAbsDy) {
          minAbsDy = abs;
          bestDy = diff;
          snappedYLine = {
            pos: Math.round(tPt.val),
            kind: mPt.kind === 'center' && tPt.kind === 'center' ? 'center' : 'edge',
          };
          snappedYSpacings = [];
        }
      }
    }
  }

  // 4. Y-Axis Equal Gap / Spacing Snapping (between vertically adjacent neighbors)
  const colNeighbors = candidates.filter((c) =>
    spansOverlapOrNear(rawRect.x, rawRect.x + rawRect.w, c.x, c.x + c.w, 80)
  );
  const topNeighbors = colNeighbors
    .filter((c) => c.y + c.h <= rawRect.y + threshold * 2)
    .sort((a, b) => b.y + b.h - (a.y + a.h));
  const bottomNeighbors = colNeighbors
    .filter((c) => c.y >= rawRect.y + rawRect.h - threshold * 2)
    .sort((a, b) => a.y - b.y);

  const nearestTop = topNeighbors[0];
  const nearestBottom = bottomNeighbors[0];

  if (nearestTop && nearestBottom) {
    const topEdge = nearestTop.y + nearestTop.h;
    const bottomEdge = nearestBottom.y;
    const avail = bottomEdge - topEdge;
    if (avail >= rawRect.h + 4) {
      const equalGap = (avail - rawRect.h) / 2;
      const idealY = topEdge + equalGap;
      const diff = idealY - rawRect.y;
      if (Math.abs(diff) < minAbsDy) {
        minAbsDy = Math.abs(diff);
        bestDy = diff;
        const finalY = Math.round(rawRect.y + diff);
        const crossX = Math.round(rawRect.x + rawRect.w / 2);
        const gapVal = Math.round(equalGap);
        snappedYSpacings = [
          { axis: 'y', crossPos: crossX, start: topEdge, end: finalY, distance: gapVal },
          {
            axis: 'y',
            crossPos: crossX,
            start: finalY + rawRect.h,
            end: bottomEdge,
            distance: gapVal,
          },
        ];
      }
    }
  }

  if (nearestTop && topNeighbors.length >= 2) {
    const prevTop = topNeighbors.find((c) => c.y + c.h <= nearestTop.y - 2);
    if (prevTop) {
      const refGap = nearestTop.y - (prevTop.y + prevTop.h);
      if (refGap >= 4 && refGap <= 260) {
        const idealY = nearestTop.y + nearestTop.h + refGap;
        const diff = idealY - rawRect.y;
        if (Math.abs(diff) < minAbsDy) {
          minAbsDy = Math.abs(diff);
          bestDy = diff;
          const finalY = Math.round(rawRect.y + diff);
          const crossX = Math.round(rawRect.x + rawRect.w / 2);
          const gapVal = Math.round(refGap);
          snappedYSpacings = [
            {
              axis: 'y',
              crossPos: crossX,
              start: prevTop.y + prevTop.h,
              end: nearestTop.y,
              distance: gapVal,
            },
            {
              axis: 'y',
              crossPos: crossX,
              start: nearestTop.y + nearestTop.h,
              end: finalY,
              distance: gapVal,
            },
          ];
        }
      }
    }
  }

  if (nearestBottom && bottomNeighbors.length >= 2) {
    const nextBottom = bottomNeighbors.find((c) => c.y >= nearestBottom.y + nearestBottom.h + 2);
    if (nextBottom) {
      const refGap = nextBottom.y - (nearestBottom.y + nearestBottom.h);
      if (refGap >= 4 && refGap <= 260) {
        const idealY = nearestBottom.y - refGap - rawRect.h;
        const diff = idealY - rawRect.y;
        if (Math.abs(diff) < minAbsDy) {
          minAbsDy = Math.abs(diff);
          bestDy = diff;
          const finalY = Math.round(rawRect.y + diff);
          const crossX = Math.round(rawRect.x + rawRect.w / 2);
          const gapVal = Math.round(refGap);
          snappedYSpacings = [
            {
              axis: 'y',
              crossPos: crossX,
              start: finalY + rawRect.h,
              end: nearestBottom.y,
              distance: gapVal,
            },
            {
              axis: 'y',
              crossPos: crossX,
              start: nearestBottom.y + nearestBottom.h,
              end: nextBottom.y,
              distance: gapVal,
            },
          ];
        }
      }
    }
  }

  const finalRect: Rect = {
    x: Math.round(rawRect.x + bestDx),
    y: Math.round(rawRect.y + bestDy),
    w: rawRect.w,
    h: rawRect.h,
  };

  const guides: SmartGuideLine[] = [];

  // Build X guide line spanning all cards aligned at snappedXLine
  const finalXAnchors = [finalRect.x, finalRect.x + finalRect.w / 2, finalRect.x + finalRect.w];
  if (snappedXLine) {
    let minY = finalRect.y;
    let maxY = finalRect.y + finalRect.h;
    let matched = false;
    for (const t of candidates) {
      const tX = [t.x, t.x + t.w / 2, t.x + t.w];
      if (
        tX.some((tv) =>
          finalXAnchors.some((mv) => Math.abs(tv - mv) <= 1 && Math.abs(tv - snappedXLine!.pos) <= 1.5)
        )
      ) {
        matched = true;
        minY = Math.min(minY, t.y);
        maxY = Math.max(maxY, t.y + t.h);
      }
    }
    if (matched) {
      guides.push({
        axis: 'x',
        pos: snappedXLine.pos,
        start: minY - 10,
        end: maxY + 10,
        kind: snappedXLine.kind,
      });
    }
  }

  // Build Y guide line spanning all cards aligned at snappedYLine
  const finalYAnchors = [finalRect.y, finalRect.y + finalRect.h / 2, finalRect.y + finalRect.h];
  if (snappedYLine) {
    let minX = finalRect.x;
    let maxX = finalRect.x + finalRect.w;
    let matched = false;
    for (const t of candidates) {
      const tY = [t.y, t.y + t.h / 2, t.y + t.h];
      if (
        tY.some((tv) =>
          finalYAnchors.some((mv) => Math.abs(tv - mv) <= 1 && Math.abs(tv - snappedYLine!.pos) <= 1.5)
        )
      ) {
        matched = true;
        minX = Math.min(minX, t.x);
        maxX = Math.max(maxX, t.x + t.w);
      }
    }
    if (matched) {
      guides.push({
        axis: 'y',
        pos: snappedYLine.pos,
        start: minX - 10,
        end: maxX + 10,
        kind: snappedYLine.kind,
      });
    }
  }

  return {
    deltaWorld: {
      x: finalRect.x - initialBounds.x,
      y: finalRect.y - initialBounds.y,
    },
    rect: finalRect,
    guides,
    spacings: [...snappedXSpacings, ...snappedYSpacings],
  };
}

/**
 * Computes smart guide snapping when resizing a single card's right/bottom edge.
 */
export function computeResizeSnap(
  initialRect: Rect,
  rawNextRect: Rect,
  keepAspect: boolean,
  stationaryCards: Card[],
  zoom: number,
  disableSnap = false
): { rect: Rect; guides: SmartGuideLine[] } {
  if (disableSnap || stationaryCards.length === 0) {
    return { rect: rawNextRect, guides: [] };
  }

  const threshold = SNAP_SCREEN_PX / Math.max(0.15, zoom);
  let nextW = rawNextRect.w;
  let nextH = rawNextRect.h;

  const rawRight = initialRect.x + nextW;
  const rawBottom = initialRect.y + nextH;

  let bestRightDiff = 0;
  let minAbsX = threshold + 0.001;
  let snappedXPos: number | null = null;

  for (const t of stationaryCards) {
    if (t.inbox) continue;
    for (const tx of [t.x, t.x + t.w / 2, t.x + t.w]) {
      const diff = tx - rawRight;
      if (Math.abs(diff) < minAbsX) {
        minAbsX = Math.abs(diff);
        bestRightDiff = diff;
        snappedXPos = Math.round(tx);
      }
    }
    // Also snap width to match another card's exact width
    const wDiff = t.w - nextW;
    if (Math.abs(wDiff) < minAbsX) {
      minAbsX = Math.abs(wDiff);
      bestRightDiff = wDiff;
      snappedXPos = Math.round(initialRect.x + t.w);
    }
  }

  if (snappedXPos !== null) {
    nextW = Math.max(110, Math.round(nextW + bestRightDiff));
    if (keepAspect && initialRect.w > 0 && initialRect.h > 0) {
      const ratio = initialRect.h / initialRect.w;
      nextH = Math.max(72, Math.round(nextW * ratio));
    }
  }

  let bestBottomDiff = 0;
  let minAbsY = threshold + 0.001;
  let snappedYPos: number | null = null;

  if (!keepAspect || snappedXPos === null) {
    for (const t of stationaryCards) {
      if (t.inbox) continue;
      for (const ty of [t.y, t.y + t.h / 2, t.y + t.h]) {
        const diff = ty - rawBottom;
        if (Math.abs(diff) < minAbsY) {
          minAbsY = Math.abs(diff);
          bestBottomDiff = diff;
          snappedYPos = Math.round(ty);
        }
      }
      const hDiff = t.h - nextH;
      if (Math.abs(hDiff) < minAbsY) {
        minAbsY = Math.abs(hDiff);
        bestBottomDiff = hDiff;
        snappedYPos = Math.round(initialRect.y + t.h);
      }
    }
    if (snappedYPos !== null) {
      nextH = Math.max(72, Math.round(nextH + bestBottomDiff));
      if (keepAspect && initialRect.w > 0 && initialRect.h > 0) {
        const ratio = initialRect.w / initialRect.h;
        nextW = Math.max(110, Math.round(nextH * ratio));
      }
    }
  }

  const finalRect: Rect = {
    x: initialRect.x,
    y: initialRect.y,
    w: nextW,
    h: nextH,
  };

  const guides: SmartGuideLine[] = [];
  if (snappedXPos !== null) {
    let minY = finalRect.y;
    let maxY = finalRect.y + finalRect.h;
    for (const t of stationaryCards) {
      if (
        Math.abs(t.x - snappedXPos) <= 1.5 ||
        Math.abs(t.x + t.w / 2 - snappedXPos) <= 1.5 ||
        Math.abs(t.x + t.w - snappedXPos) <= 1.5
      ) {
        minY = Math.min(minY, t.y);
        maxY = Math.max(maxY, t.y + t.h);
      }
    }
    guides.push({
      axis: 'x',
      pos: finalRect.x + finalRect.w,
      start: minY - 10,
      end: maxY + 10,
      kind: 'edge',
    });
  }

  if (snappedYPos !== null) {
    let minX = finalRect.x;
    let maxX = finalRect.x + finalRect.w;
    for (const t of stationaryCards) {
      if (
        Math.abs(t.y - snappedYPos) <= 1.5 ||
        Math.abs(t.y + t.h / 2 - snappedYPos) <= 1.5 ||
        Math.abs(t.y + t.h - snappedYPos) <= 1.5
      ) {
        minX = Math.min(minX, t.x);
        maxX = Math.max(maxX, t.x + t.w);
      }
    }
    guides.push({
      axis: 'y',
      pos: finalRect.y + finalRect.h,
      start: minX - 10,
      end: maxX + 10,
      kind: 'edge',
    });
  }

  return { rect: finalRect, guides };
}

export function alignSelectedCards(
  cards: Card[],
  selectedIds: string[],
  mode: AlignMode
): Card[] | null {
  const lockedFrameIds = new Set(
    cards.filter((c) => c.kind === 'frame' && c.locked).map((c) => c.id)
  );
  const selSet = new Set(selectedIds);
  const eligible = cards.filter((c) => {
    if (!selSet.has(c.id) || c.inbox || c.locked) return false;
    if (c.groupId && lockedFrameIds.has(c.groupId)) return false;
    if (c.groupId && selSet.has(c.groupId)) return false;
    return true;
  });

  if (mode === 'distribute-h') {
    if (eligible.length < 3) return null;
    const sorted = [...eligible].sort((a, b) => a.x - b.x || a.id.localeCompare(b.id));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const totalWidths = sorted.reduce((acc, c) => acc + c.w, 0);
    const currentSpan = last.x + last.w - first.x;
    const minGap = 20;
    const neededSpan = totalWidths + minGap * (sorted.length - 1);
    const span = Math.max(currentSpan, neededSpan);
    const gap = (span - totalWidths) / (sorted.length - 1);

    const dxMap = new Map<string, number>();
    let cursorX = first.x;
    for (const item of sorted) {
      dxMap.set(item.id, Math.round(cursorX - item.x));
      cursorX += item.w + gap;
    }

    const next = cards.map((c) => {
      const dx = dxMap.get(c.id) ?? (c.groupId ? dxMap.get(c.groupId) : undefined);
      if (dx === undefined || dx === 0) return c;
      return { ...c, x: c.x + dx };
    });
    return recomputeFrameBoundsForAll(next);
  }

  if (mode === 'distribute-v') {
    if (eligible.length < 3) return null;
    const sorted = [...eligible].sort((a, b) => a.y - b.y || a.id.localeCompare(b.id));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const totalHeights = sorted.reduce((acc, c) => acc + c.h, 0);
    const currentSpan = last.y + last.h - first.y;
    const minGap = 20;
    const neededSpan = totalHeights + minGap * (sorted.length - 1);
    const span = Math.max(currentSpan, neededSpan);
    const gap = (span - totalHeights) / (sorted.length - 1);

    const dyMap = new Map<string, number>();
    let cursorY = first.y;
    for (const item of sorted) {
      dyMap.set(item.id, Math.round(cursorY - item.y));
      cursorY += item.h + gap;
    }

    const next = cards.map((c) => {
      const dy = dyMap.get(c.id) ?? (c.groupId ? dyMap.get(c.groupId) : undefined);
      if (dy === undefined || dy === 0) return c;
      return { ...c, y: c.y + dy };
    });
    return recomputeFrameBoundsForAll(next);
  }

  if (eligible.length < 2) return null;
  const bounds = computeCardsBounds(eligible);
  if (!bounds) return null;

  const deltaMap = new Map<string, Point>();
  for (const item of eligible) {
    let dx = 0;
    let dy = 0;
    if (mode === 'left') dx = Math.round(bounds.x - item.x);
    else if (mode === 'center-h') dx = Math.round(bounds.x + bounds.w / 2 - (item.x + item.w / 2));
    else if (mode === 'right') dx = Math.round(bounds.x + bounds.w - (item.x + item.w));
    else if (mode === 'top') dy = Math.round(bounds.y - item.y);
    else if (mode === 'center-v') dy = Math.round(bounds.y + bounds.h / 2 - (item.y + item.h / 2));
    else if (mode === 'bottom') dy = Math.round(bounds.y + bounds.h - (item.y + item.h));
    deltaMap.set(item.id, { x: dx, y: dy });
  }

  const next = cards.map((c) => {
    const d = deltaMap.get(c.id) ?? (c.groupId ? deltaMap.get(c.groupId) : undefined);
    if (!d || (d.x === 0 && d.y === 0)) return c;
    return { ...c, x: c.x + d.x, y: c.y + d.y };
  });
  return recomputeFrameBoundsForAll(next);
}
