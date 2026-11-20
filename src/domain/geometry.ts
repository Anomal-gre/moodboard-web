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

export function computeCardsBounds(cards: Card[]): Rect | null {
  if (cards.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of cards) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x + c.w > maxX) maxX = c.x + c.w;
    if (c.y + c.h > maxY) maxY = c.y + c.h;
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
  insets: { side: number; top: number; bottom: number }
): ProjectView {
  const bounds = computeCardsBounds(cards);
  if (!bounds || viewportW <= 0 || viewportH <= 0) {
    return { x: Math.round(viewportW * 0.12), y: Math.round(viewportH * 0.14), zoom: 1 };
  }
  const availW = Math.max(1, viewportW - insets.side * 2);
  const availH = Math.max(1, viewportH - insets.top - insets.bottom);

  const rawZoom = Math.min(availW / bounds.w, availH / bounds.h, 1.15);
  const zoom = clampZoom(rawZoom);
  const centerX = bounds.x + bounds.w / 2;
  const centerY = bounds.y + bounds.h / 2;

  return {
    zoom,
    x: Math.round(viewportW / 2 - centerX * zoom),
    y: Math.round(insets.top + availH / 2 - centerY * zoom),
  };
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

/**
 * Computes the unique set of unlocked card IDs that should move together when dragging,
 * ensuring frame + member never get double-counted.
 */
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

export function alignSelectedCards(
  cards: Card[],
  selectedIds: string[],
  mode: 'left' | 'top' | 'distribute-h'
): Card[] | null {
  const lockedFrameIds = new Set(
    cards.filter((c) => c.kind === 'frame' && c.locked).map((c) => c.id)
  );
  // Top-level selected units: unlocked non-inbox cards whose frame isn't also selected
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

  if (eligible.length < 2) return null;
  const target =
    mode === 'left'
      ? Math.min(...eligible.map((c) => c.x))
      : Math.min(...eligible.map((c) => c.y));

  const deltaMap = new Map<string, Point>();
  for (const item of eligible) {
    deltaMap.set(item.id, {
      x: mode === 'left' ? Math.round(target - item.x) : 0,
      y: mode === 'top' ? Math.round(target - item.y) : 0,
    });
  }

  const next = cards.map((c) => {
    const d = deltaMap.get(c.id) ?? (c.groupId ? deltaMap.get(c.groupId) : undefined);
    if (!d || (d.x === 0 && d.y === 0)) return c;
    return { ...c, x: c.x + d.x, y: c.y + d.y };
  });
  return recomputeFrameBoundsForAll(next);
}
