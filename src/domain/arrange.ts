import {
  CATEGORY_ORDER,
  type ArrangeOptions,
  type Card,
  type Category,
} from './types';
import {
  computeCardsBounds,
  getCardRotatedAABB,
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
  rotation?: number;
}

interface CompositionBox {
  items: PlacedCardPatch[];
  bounds: Rect;
}

/**
 * Deterministic fast PRNG (Mulberry32) so art-direction variations via `seed`
 * are 100% reproducible, 60fps live-previewable, and Undo/Redo-safe.
 */
function createRng(seed: number): () => number {
  let a = (seed * 0x9e3779b1 + 0x6d2b79f5) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round1(v: number): number {
  const r = Math.round(v * 10) / 10;
  return Math.abs(r) < 0.05 ? 0 : r;
}

function getAspectRatio(card: Card): number {
  if (card.w > 0 && card.h > 0) {
    return Math.max(0.42, Math.min(2.45, card.w / card.h));
  }
  return 1.33;
}

/**
 * Strictly preserves each image's true aspect ratio while capping extreme dimensions.
 */
function sizeImagePreservingRatio(
  card: Card,
  targetW: number,
  maxH = 420,
  minEdge = 96
): { w: number; h: number } {
  const aspect = getAspectRatio(card);
  let w = Math.round(targetW);
  let h = Math.round(w / aspect);
  if (h > maxH) {
    h = maxH;
    w = Math.max(minEdge, Math.round(h * aspect));
  }
  if (h < minEdge) {
    h = minEdge;
    w = Math.max(minEdge, Math.round(h * aspect));
  }
  return { w, h };
}

function estimateEditorialCardHeight(card: Card, targetW: number, compact = false): number {
  if (card.kind === 'file') return compact ? 76 : 82;
  if (card.kind === 'link') return compact ? 102 : 112;
  const charsPerLine = Math.max(18, Math.floor((targetW - 34) / 7.2));
  const rawText = (card.text || '').trim();
  const rawLines = rawText ? rawText.split('\n') : [''];
  let totalLines = 0;
  for (const line of rawLines) {
    totalLines += Math.max(1, Math.ceil(line.length / charsPerLine));
  }
  const titleLines = card.title
    ? Math.ceil(card.title.length / Math.max(13, charsPerLine - 2))
    : 0;
  const computed = 40 + titleLines * 21 + totalLines * 20;
  if (compact) {
    return Math.max(108, Math.min(240, computed));
  }
  return Math.max(126, Math.min(268, computed));
}

function parseHexLuminance(hex?: string): number {
  const clean = (hex || '#8D9A7C').replace('#', '');
  if (clean.length !== 6) return 0.5;
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function hasAccentBlockColor(card: Card): boolean {
  if (!card.color) return false;
  const upper = card.color.toUpperCase();
  return upper !== '#FFFFFF' && upper !== '#FAF7EE' && upper !== '#FBFBF8';
}

function isMeaningfulNote(card: Card): boolean {
  if (card.kind !== 'note') return false;
  const bodyLen = (card.text || '').trim().length;
  const title = (card.title || '').trim().toLowerCase();
  const genericTitle =
    title === '' ||
    title === 'ghi chú concept' ||
    title === 'ghi chú' ||
    title === 'concept note' ||
    title === 'note';
  return bodyLen >= 24 || !genericTitle;
}

function computeVisualWeight(card: Card, w: number, h: number, isHero = false): number {
  const areaFactor = Math.sqrt(Math.max(1, w * h) / 40000);
  if (card.kind === 'image') return areaFactor * (isHero ? 2.35 : 1.65);
  if (card.kind === 'color') {
    const lum = parseHexLuminance(card.color);
    return areaFactor * (lum < 0.5 ? 1.2 : 0.88);
  }
  if (card.kind === 'note') {
    return areaFactor * (hasAccentBlockColor(card) ? 1.25 : 0.94);
  }
  return areaFactor * 0.78;
}

function intersectionArea(a: Rect, b: Rect): number {
  const xOverlap = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const yOverlap = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return xOverlap * yOverlap;
}

function innerCoreRect(r: Rect, keepRatio = 0.56): Rect {
  const insetX = (r.w * (1 - keepRatio)) / 2;
  const insetY = (r.h * (1 - keepRatio)) / 2;
  return {
    x: r.x + insetX,
    y: r.y + insetY,
    w: Math.max(1, r.w * keepRatio),
    h: Math.max(1, r.h * keepRatio),
  };
}

function rectGapDistance(a: Rect, b: Rect): number {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)));
  const dy = Math.max(0, Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h)));
  return Math.hypot(dx, dy);
}

/**
 * Builds an undirected adjacency map from `card.linksTo` arrows so layout engines
 * automatically pull connected cards into tight, non-tangled visual clusters.
 */
function buildConnectionGraph(cards: Card[]): Map<string, Set<string>> {
  const idSet = new Set(cards.map((c) => c.id));
  const adj = new Map<string, Set<string>>();
  const ensure = (id: string) => {
    let s = adj.get(id);
    if (!s) {
      s = new Set<string>();
      adj.set(id, s);
    }
    return s;
  };
  for (const c of cards) {
    if (!c.linksTo || c.linksTo.length === 0) continue;
    for (const targetId of c.linksTo) {
      if (targetId === c.id || !idSet.has(targetId)) continue;
      ensure(c.id).add(targetId);
      ensure(targetId).add(c.id);
    }
  }
  return adj;
}

/**
 * Slab test checking whether line segment (x1, y1) -> (x2, y2) cuts through rect `r`.
 * Used to penalize arrow paths that slice across unrelated cards.
 */
function segmentIntersectsRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r: Rect
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let tMin = 0;
  let tMax = 1;

  if (Math.abs(dx) < 1e-6) {
    if (x1 < r.x || x1 > r.x + r.w) return false;
  } else {
    const inv = 1 / dx;
    let t1 = (r.x - x1) * inv;
    let t2 = (r.x + r.w - x1) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }

  if (Math.abs(dy) < 1e-6) {
    if (y1 < r.y || y1 > r.y + r.h) return false;
  } else {
    const inv = 1 / dy;
    let t1 = (r.y - y1) * inv;
    let t2 = (r.y + r.h - y1) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }

  return tMax >= tMin && tMax >= 0 && tMin <= 1;
}

/**
 * Reorders a card array using BFS over `adj` so arrow-connected cards stay immediately adjacent
 * in Bento mosaics and Swiss Grids.
 */
function orderKeepingConnectedAdjacent(
  cards: Card[],
  adj: Map<string, Set<string>>
): Card[] {
  if (cards.length <= 2 || adj.size === 0) return cards;
  const byId = new Map(cards.map((c) => [c.id, c]));
  const visited = new Set<string>();
  const out: Card[] = [];

  for (const start of cards) {
    if (visited.has(start.id)) continue;
    const queue: Card[] = [start];
    visited.add(start.id);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      out.push(cur);
      const neighbors = adj.get(cur.id);
      if (!neighbors) continue;
      for (const nid of neighbors) {
        if (visited.has(nid)) continue;
        const nCard = byId.get(nid);
        if (nCard) {
          visited.add(nid);
          queue.push(nCard);
        }
      }
    }
  }
  return out;
}

/**
 * Maps each card to the lead category of its connected component so Concept Zones keep
 * arrow-linked clusters together inside one cohesive zone instead of firing arrows across zones.
 */
function getConnectedZoneCategoryMap(
  cards: Card[],
  adj: Map<string, Set<string>>
): Map<string, Category> {
  const map = new Map<string, Category>();
  const byId = new Map(cards.map((c) => [c.id, c]));
  const visited = new Set<string>();

  for (const c of cards) {
    if (visited.has(c.id)) continue;
    const comp: Card[] = [];
    const q: Card[] = [c];
    visited.add(c.id);
    while (q.length > 0) {
      const cur = q.shift()!;
      comp.push(cur);
      const ns = adj.get(cur.id);
      if (!ns) continue;
      for (const nid of ns) {
        if (visited.has(nid)) continue;
        const nCard = byId.get(nid);
        if (nCard) {
          visited.add(nid);
          q.push(nCard);
        }
      }
    }

    if (comp.length === 1) {
      map.set(comp[0].id, comp[0].category);
    } else {
      // Pick the lead anchor of the connected component (largest categorized image -> highest degree card)
      const lead = [...comp].sort((a, b) => {
        const imgA = a.kind === 'image' ? 0 : 1;
        const imgB = b.kind === 'image' ? 0 : 1;
        if (imgA !== imgB) return imgA - imgB;
        const catA = a.category !== 'other' ? 0 : 1;
        const catB = b.category !== 'other' ? 0 : 1;
        if (catA !== catB) return catA - catB;
        const degDiff = (adj.get(b.id)?.size ?? 0) - (adj.get(a.id)?.size ?? 0);
        if (degDiff !== 0) return degDiff;
        return b.w * b.h - a.w * a.h;
      })[0];
      for (const member of comp) {
        map.set(member.id, lead.category);
      }
    }
  }
  return map;
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
    const b = getCardRotatedAABB(it);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  const shiftX = Math.round(minX);
  const shiftY = Math.round(minY);
  const normalized = items.map((it) => ({
    ...it,
    x: Math.round(it.x - shiftX),
    y: Math.round(it.y - shiftY),
  }));
  return {
    items: normalized,
    bounds: {
      x: 0,
      y: 0,
      w: Math.max(1, Math.round(maxX - shiftX)),
      h: Math.max(1, Math.round(maxY - shiftY)),
    },
  };
}

function shuffleWithRng<T>(arr: T[], rng: () => number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function partitionByDesignerRole(cards: Card[], groupByCategory: boolean, seed: number) {
  const rng = createRng(seed + 17);
  const images = cards.filter((c) => c.kind === 'image');
  const swatches = [...cards.filter((c) => c.kind === 'color')].sort(
    (a, b) => parseHexLuminance(a.color) - parseHexLuminance(b.color) || a.id.localeCompare(b.id)
  );
  const kindOrder: Record<string, number> = { note: 1, link: 2, file: 3 };
  const editorials = [
    ...cards.filter((c) => c.kind === 'note' || c.kind === 'file' || c.kind === 'link'),
  ].sort((a, b) => {
    const ma = isMeaningfulNote(a) ? 0 : 1;
    const mb = isMeaningfulNote(b) ? 0 : 1;
    if (ma !== mb) return ma - mb;
    const ka = kindOrder[a.kind] ?? 9;
    const kb = kindOrder[b.kind] ?? 9;
    if (ka !== kb) return ka - kb;
    const ca = hasAccentBlockColor(a) ? 0 : 1;
    const cb = hasAccentBlockColor(b) ? 0 : 1;
    if (ca !== cb) return ca - cb;
    return b.text.length - a.text.length || a.id.localeCompare(b.id);
  });

  const rolePriority: Record<Category, number> = {
    reference: 1,
    furniture: 2,
    typography: 3,
    sketch: 4,
    palette: 5,
    material: 6,
    other: 7,
  };

  let sortedImages = [...images].sort((a, b) => {
    if (groupByCategory) {
      const pa = rolePriority[a.category] ?? 6;
      const pb = rolePriority[b.category] ?? 6;
      if (pa !== pb) return pa - pb;
    }
    return b.w * b.h - a.w * a.h || a.id.localeCompare(b.id);
  });

  // For seed > 0, allow rotating among top hero candidates & shuffling secondary order
  if (seed > 0 && sortedImages.length > 2) {
    const heroCandidates = sortedImages.filter(
      (img) => img.category === 'reference' || img.category === 'furniture'
    );
    if (heroCandidates.length >= 2) {
      const pick = heroCandidates[seed % heroCandidates.length];
      sortedImages = [pick, ...sortedImages.filter((c) => c.id !== pick.id)];
    }
    const [lead, ...rest] = sortedImages;
    if (!groupByCategory) {
      sortedImages = [lead, ...shuffleWithRng(rest, rng)];
    } else {
      // Gently permute within same category tiers while keeping hero intact
      const byCat = new Map<Category, Card[]>();
      for (const img of rest) {
        const list = byCat.get(img.category) ?? [];
        list.push(img);
        byCat.set(img.category, list);
      }
      const rebuilt: Card[] = [lead];
      const catOrder = seed % 2 === 0
        ? CATEGORY_ORDER
        : ['reference', 'furniture', 'typography', 'material', 'sketch', 'palette', 'other'] as Category[];
      for (const cat of catOrder) {
        const list = byCat.get(cat);
        if (list) rebuilt.push(...shuffleWithRng(list, rng));
      }
      sortedImages = rebuilt;
    }
  }

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

function getTargetAspect(options: ArrangeOptions): number {
  if (options.aspectPreset === '16:9') return 1.78;
  if (options.aspectPreset === 'a4') return 1.414;
  if (options.aspectPreset === '1:1') return 1.0;
  return 1.5;
}

/**
 * Helper: packs overflow notes/files/links into a flush-aligned multi-column strip
 * matching exact `maxWidth` (used ONLY in structured modes: Bento footer, Zones, Swiss Grid — NEVER in Collage!).
 */
function layoutEditorialGrid(
  editorials: Card[],
  startX: number,
  startY: number,
  maxWidth: number,
  baseZ: number,
  adj?: Map<string, Set<string>>
): { items: PlacedCardPatch[]; height: number } {
  if (editorials.length === 0) return { items: [], height: 0 };
  const gap = 16;
  const items: PlacedCardPatch[] = [];
  let z = baseZ;

  const hasCrossKindConn =
    adj && adj.size > 0
      ? editorials.some((c) => {
          const ns = adj.get(c.id);
          if (!ns) return false;
          for (const nid of ns) {
            const peer = editorials.find((e) => e.id === nid);
            if (peer && (peer.kind === 'note') !== (c.kind === 'note')) return true;
          }
          return false;
        })
      : false;

  const notes = editorials.filter((c) => c.kind === 'note');
  const refs = editorials.filter((c) => c.kind !== 'note');
  let cursorY = startY;

  const placeGroup = (group: Card[], idealColW: number) => {
    if (group.length === 0) return;
    const ordered = adj && adj.size > 0 ? orderKeepingConnectedAdjacent(group, adj) : group;
    const cols = Math.max(
      1,
      Math.min(10, Math.min(ordered.length, Math.floor((maxWidth + gap) / (idealColW + gap))))
    );
    const colW = Math.floor((maxWidth - gap * (cols - 1)) / cols);
    for (let i = 0; i < ordered.length; i += cols) {
      const row = ordered.slice(i, i + cols);
      const rowH = Math.max(...row.map((c) => estimateEditorialCardHeight(c, colW)));
      const rowCols = row.length;
      // Flush-justify full rows cleanly across maxWidth
      const effColW =
        rowCols === cols
          ? colW
          : Math.min(Math.round(colW * 1.25), Math.floor((maxWidth - gap * (rowCols - 1)) / rowCols));
      let rowX = startX;
      row.forEach((c, colIdx) => {
        const isLastFull = rowCols === cols && colIdx === rowCols - 1;
        const w = isLastFull ? Math.max(effColW, startX + maxWidth - rowX) : effColW;
        items.push({
          id: c.id,
          x: Math.round(rowX),
          y: Math.round(cursorY),
          w,
          h: rowH,
          z: ++z,
          rotation: 0,
        });
        rowX += w + gap;
      });
      cursorY += rowH + gap;
    }
  };

  if (hasCrossKindConn) {
    placeGroup(editorials, 238);
  } else {
    placeGroup(notes, 236);
    placeGroup(refs, 240);
  }

  return { items, height: Math.max(0, cursorY - startY - gap) };
}

/**
 * MODE 1: EDITORIAL MAGAZINE BENTO (Kinfolk / AD Spread)
 * - Adaptive 2-column or 3-column asymmetric mosaic depending on board density.
 * - Weaves standout Editorial Notes directly INSIDE Bento tiles alongside photos (true magazine feel).
 * - Equalizes column bottoms cleanly + full-width Palette Bar + flush Technical Spec Footer.
 * - Always rotation = 0° for architectural crispness.
 */
function layoutEditorialBento(
  cards: Card[],
  options: ArrangeOptions,
  baseZ: number
): CompositionBox {
  const seed = options.seed ?? 0;
  const targetAspect = getTargetAspect(options);
  const adj = buildConnectionGraph(cards);
  const { heroes, supports, accents, swatches, editorials, allImages } = partitionByDesignerRole(
    cards,
    options.groupByCategory,
    seed
  );
  const t = Math.max(0, Math.min(1, options.overlap / 100));
  const useFrame = options.galleryFrame ?? true;
  const seam = Math.round(14 * (1 - t * 0.65));

  // Up to 2 unconnected material/accent overlays sitting cleanly on Bento seam intersections
  const freeAccents = accents.filter((a) => (adj.get(a.id)?.size ?? 0) === 0);
  const maxOverlays =
    allImages.length >= 5 && t >= 0.15
      ? Math.min(freeAccents.length, Math.min(2, Math.floor((allImages.length - 3) / 2)))
      : 0;
  const overlayAccents = freeAccents.slice(0, Math.max(0, maxOverlays));
  const overlayAccentIds = new Set(overlayAccents.map((a) => a.id));
  const inlineAccents = accents.filter((a) => !overlayAccentIds.has(a.id));

  const mosaicImages = [...heroes, ...supports, ...inlineAccents];
  const mosaicImageIds = new Set(mosaicImages.map((img) => img.id));

  // Collect all cards (notes, files, links, swatches) reachable from mosaic images via connector arrows
  const reachableFromMosaic = new Set<string>(mosaicImageIds);
  if (adj.size > 0) {
    const q = [...mosaicImageIds];
    while (q.length > 0) {
      const cur = q.shift()!;
      const ns = adj.get(cur);
      if (!ns) continue;
      for (const nid of ns) {
        if (!reachableFromMosaic.has(nid)) {
          reachableFromMosaic.add(nid);
          q.push(nid);
        }
      }
    }
  }

  // Promote arrow-connected editorials & swatches + standout notes directly INTO the Bento mosaic!
  const connectedInlineCards = [
    ...editorials.filter((ed) => reachableFromMosaic.has(ed.id)),
    ...swatches.filter((sw) => reachableFromMosaic.has(sw.id)),
  ];
  const connectedInlineIds = new Set(connectedInlineCards.map((c) => c.id));
  const notePool = editorials.filter((c) => c.kind === 'note' && !connectedInlineIds.has(c.id));
  const maxInlineNotes = allImages.length >= 6 ? 3 : allImages.length >= 3 ? 2 : 1;
  const extraInlineNotes = notePool.slice(
    0,
    Math.max(0, maxInlineNotes - connectedInlineCards.filter((c) => c.kind === 'note').length)
  );
  const inlineNotes = [...connectedInlineCards, ...extraInlineNotes];
  const inlineNoteIds = new Set(inlineNotes.map((n) => n.id));
  const remainingEditorials = editorials.filter((c) => !inlineNoteIds.has(c.id));
  const freeSwatches = swatches.filter((c) => !inlineNoteIds.has(c.id));

  // Interleave inline notes harmoniously after the hero, keeping arrow-connected tiles adjacent
  const rawBentoQueue: Card[] = [];
  if (mosaicImages.length > 0) {
    rawBentoQueue.push(mosaicImages[0]);
  }
  const restImgs = mosaicImages.slice(1);
  let imgCursor = 0;
  let noteCursor = 0;
  let step = 0;
  while (imgCursor < restImgs.length || noteCursor < inlineNotes.length) {
    if (noteCursor < inlineNotes.length && (step === 0 || step % 3 === 2 || imgCursor >= restImgs.length)) {
      rawBentoQueue.push(inlineNotes[noteCursor++]);
    } else if (imgCursor < restImgs.length) {
      rawBentoQueue.push(restImgs[imgCursor++]);
    }
    step++;
  }
  const bentoQueue = orderKeepingConnectedAdjacent(rawBentoQueue, adj);
  const bentoById = new Map(bentoQueue.map((q) => [q.id, q]));
  const totalMosaicTiles = bentoQueue.length;

  const makeBentoColWidths = (n: number): number[] => {
    if (n <= 1) return [520];
    if (n === 2) return seed % 2 === 0 ? [456, 352] : [360, 448];
    if (n === 3) return seed % 2 === 0 ? [396, 304, 276] : [304, 396, 276];
    const base = n >= 6 ? 268 : n === 5 ? 278 : 290;
    const heroW = Math.round(base * 1.32);
    const cols = new Array<number>(n).fill(base);
    const heroPos = seed % 2 === 0 ? 0 : 1;
    cols[heroPos] = heroW;
    const accentPos = heroPos === 0 ? 1 : 0;
    cols[accentPos] = base + 14;
    return cols;
  };

  const buildBentoWithCols = (numCols: number): CompositionBox => {
    const items: PlacedCardPatch[] = [];
    let z = baseZ;
    const colWidths = makeBentoColWidths(numCols);
    const heroColIdx = colWidths.indexOf(Math.max(...colWidths));
    const mosaicW = colWidths.reduce((a, b) => a + b, 0) + seam * (colWidths.length - 1);
    const colXs: number[] = [];
    let accX = 0;
    for (const w of colWidths) {
      colXs.push(accX);
      accX += w + seam;
    }

    const colYs = new Array<number>(colWidths.length).fill(0);
    const colItems: PlacedCardPatch[][] = Array.from({ length: colWidths.length }, () => []);
    const colSplits: number[][] = Array.from({ length: colWidths.length }, () => []);
    const placedColById = new Map<string, { col: number; y: number; h: number; cx: number }>();

    bentoQueue.forEach((card, idx) => {
      let targetCol = 0;
      if (idx === 0 && card.kind === 'image') {
        targetCol = heroColIdx;
      } else {
        const neighbors = adj.get(card.id);
        let bestScore = Infinity;
        for (let c = 0; c < colWidths.length; c++) {
          const lastInCol = colItems[c][colItems[c].length - 1];
          const lastCard = lastInCol ? bentoById.get(lastInCol.id) : undefined;
          const isDirectlyConnectedToLast =
            lastCard && neighbors ? neighbors.has(lastCard.id) : false;
          const noteStackPenalty =
            card.kind !== 'image' && lastCard?.kind !== 'image' && !isDirectlyConnectedToLast
              ? 140
              : 0;
          let connBonus = 0;
          if (neighbors) {
            for (const nid of neighbors) {
              const pCol = placedColById.get(nid);
              if (!pCol) continue;
              const colDist = Math.abs(pCol.col - c);
              if (colDist === 0) {
                const verticalGap = Math.abs(colYs[c] - (pCol.y + pCol.h));
                connBonus += -420 + verticalGap * 0.9;
              } else if (colDist === 1) {
                const yDist = Math.abs(pCol.y - colYs[c]);
                connBonus += -380 + yDist * 0.85;
              } else {
                const yDist = Math.abs(pCol.y - colYs[c]);
                connBonus += 240 + yDist * 0.85;
              }
            }
          }
          const colScore = colYs[c] + noteStackPenalty + connBonus;
          if (colScore < bestScore) {
            bestScore = colScore;
            targetCol = c;
          }
        }
      }

      const colW = colWidths[targetCol];
      const maxImgH = numCols >= 5 ? (idx === 0 ? 340 : 272) : idx === 0 ? 370 : 320;
      const h =
        card.kind === 'image'
          ? sizeImagePreservingRatio(card, colW, maxImgH).h
          : card.kind === 'color'
            ? 84
            : estimateEditorialCardHeight(card, colW);

      const patch: PlacedCardPatch = {
        id: card.id,
        x: colXs[targetCol],
        y: colYs[targetCol],
        w: colW,
        h,
        z: ++z,
        framed: false,
        rotation: 0,
      };
      items.push(patch);
      colItems[targetCol].push(patch);
      placedColById.set(card.id, {
        col: targetCol,
        y: colYs[targetCol],
        h,
        cx: colXs[targetCol] + colW / 2,
      });
      colYs[targetCol] += h;
      colSplits[targetCol].push(colYs[targetCol]);
      colYs[targetCol] += seam;
    });

    // Equalize column bottoms smoothly for a sharp editorial magazine rectangle
    const activeCols = colItems.filter((arr) => arr.length > 0);
    if (activeCols.length >= 2) {
      const maxBottom = Math.max(
        ...activeCols.map((arr) => {
          const last = arr[arr.length - 1];
          return last.y + last.h;
        })
      );
      for (const arr of activeCols) {
        const last = arr[arr.length - 1];
        const diff = maxBottom - (last.y + last.h);
        if (diff > 0 && diff <= 190) {
          last.h += diff;
        }
      }
    }

    const mosaicH =
      activeCols.length > 0
        ? Math.max(...activeCols.map((arr) => arr[arr.length - 1].y + arr[arr.length - 1].h))
        : 0;

    // Seam-overlay material accents with crisp gallery frame
    overlayAccents.forEach((acc, idx) => {
      const seamCol = Math.min(colWidths.length - 2, idx % Math.max(1, colWidths.length - 1));
      const seamCenterX = colXs[seamCol] + colWidths[seamCol] + seam / 2;
      const splitA = colSplits[seamCol][idx] ?? colSplits[seamCol][0] ?? mosaicH * 0.48;
      const splitB = colSplits[seamCol + 1][idx] ?? colSplits[seamCol + 1][0] ?? mosaicH * 0.52;
      const seamY = Math.round((splitA + splitB) / 2);
      const boxW = Math.round(168 + 26 * t);
      const { w, h } = sizeImagePreservingRatio(acc, boxW, 204);
      items.push({
        id: acc.id,
        x: Math.round(seamCenterX - w * 0.5),
        y: Math.round(seamY - h * 0.5),
        w,
        h,
        z: baseZ + 45 + idx,
        framed: useFrame,
        rotation: 0,
      });
    });

    // Flush full-width Color Palette Bar underneath mosaic for remaining unlinked swatches
    let bottomY = mosaicH;
    if (freeSwatches.length > 0) {
      const orderedSwatches =
        adj.size > 0
          ? orderKeepingConnectedAdjacent(
              [...freeSwatches].sort((a, b) => {
                const avgX = (c: Card) => {
                  const ns = adj.get(c.id);
                  if (!ns) return Number.POSITIVE_INFINITY;
                  let sum = 0;
                  let cnt = 0;
                  for (const nid of ns) {
                    const p = placedColById.get(nid);
                    if (p) {
                      sum += p.cx;
                      cnt++;
                    }
                  }
                  return cnt > 0 ? sum / cnt : Number.POSITIVE_INFINITY;
                };
                const ax = avgX(a);
                const bx = avgX(b);
                if (ax !== bx) return ax - bx;
                return parseHexLuminance(a.color) - parseHexLuminance(b.color);
              }),
              adj
            )
          : freeSwatches;

      const swGap = 12;
      const maxPerRow = Math.max(5, Math.min(12, Math.floor((mosaicW + swGap) / 142)));
      const rowCount = Math.ceil(orderedSwatches.length / maxPerRow);
      const perRow = Math.ceil(orderedSwatches.length / rowCount);
      const swH = 92;
      const overlapUp = mosaicH > 0 ? Math.round(14 * t) : 0;
      let swCursorY = mosaicH + (mosaicH > 0 ? 16 : 0) - overlapUp;

      for (let i = 0; i < orderedSwatches.length; i += perRow) {
        const slice = orderedSwatches.slice(i, i + perRow);
        const swW = Math.floor((mosaicW - swGap * (slice.length - 1)) / slice.length);
        let rowX = 0;
        slice.forEach((sw, idx) => {
          const isLast = idx === slice.length - 1;
          const w = isLast ? Math.max(swW, mosaicW - rowX) : swW;
          items.push({
            id: sw.id,
            x: rowX,
            y: swCursorY,
            w,
            h: swH,
            z: baseZ + 60 + i + idx,
            framed: false,
            rotation: 0,
          });
          rowX += w + swGap;
        });
        swCursorY += swH + swGap;
      }
      bottomY = swCursorY - swGap;
    }

    // Remaining Notes/Files/Links sit in a flush Technical Spec Footer aligned 100% to `mosaicW`
    if (remainingEditorials.length > 0) {
      const footerStartY = bottomY > 0 ? bottomY + 20 : 0;
      const footer = layoutEditorialGrid(
        remainingEditorials,
        0,
        footerStartY,
        mosaicW,
        baseZ + 80,
        adj
      );
      items.push(...footer.items);
    }

    return normalizeBox(items);
  };

  // Search adaptive column counts (2..9) so the overall Bento spread forms a balanced presentation rectangle!
  const minCols = totalMosaicTiles <= 1 && cards.length <= 2 ? 1 : 2;
  const maxCols = Math.max(
    minCols,
    Math.min(9, Math.max(totalMosaicTiles, Math.ceil(Math.sqrt(cards.length * targetAspect))))
  );

  let bestBox: CompositionBox | null = null;
  let bestErr = Infinity;
  for (let n = minCols; n <= maxCols; n++) {
    const candidate = buildBentoWithCols(n);
    const ratio = candidate.bounds.w / Math.max(1, candidate.bounds.h);
    // Use log-ratio distance so 2x too tall and 2x too wide are penalized symmetrically
    const err = Math.abs(Math.log(ratio / targetAspect));
    if (err < bestErr) {
      bestErr = err;
      bestBox = candidate;
    }
  }

  return bestBox ?? buildBentoWithCols(minCols);
}

/**
 * MODE 2: ART-DIRECTED MIXED-MEDIA COLLAGE (`freeform`)
 * Built on graphic-design composition principles:
 * 1. Zero data-type segregation (NO bottom Excel table of Notes/Files!).
 * 2. Semantic Proximity: Notes & CAD files pin naturally near their matching-category photo.
 * 3. Varied Scale Rhythm (1 : 2 : 4) across images, editorial notes, sticky slips & file tickets.
 * 4. Visual Weight See-Saw Balancing & Anti-Grid Penalty (forbids 3 notes/files lining up like a table).
 * 5. Controlled Organic Micro-Rotation (±1.4°..±4.2°) with 0% text occlusion & 0% photo core occlusion.
 * 6. Seeded Art-Direction Variations (`Đổi biến thể`).
 */
interface CollagePlacedNode {
  card: Card;
  rect: Rect;
  isHero: boolean;
  weight: number;
  rotation: number;
}

function layoutArtDirectedCollage(
  cards: Card[],
  options: ArrangeOptions,
  baseZ: number
): CompositionBox {
  const seed = options.seed ?? 0;
  const rng = createRng(seed * 97 + 13);
  const adj = buildConnectionGraph(cards);
  const hasConnections = adj.size > 0;
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const { heroes, supports, accents, swatches, editorials } = partitionByDesignerRole(
    cards,
    options.groupByCategory,
    seed
  );

  const t = Math.max(0, Math.min(1, options.overlap / 100));
  const useFrame = options.galleryFrame ?? true;
  const tiltEnabled = false;
  const tiltAmp = 0;

  const allVisuals = [...heroes, ...supports, ...accents];
  if (allVisuals.length === 0) {
    return layoutEditorialBento(cards, options, baseZ);
  }

  const diagSign = seed % 2 === 0 ? 1 : -1;
  const items: PlacedCardPatch[] = [];
  const placed: CollagePlacedNode[] = [];
  const placedById = new Map<string, CollagePlacedNode>();
  const placedEdges: { a: CollagePlacedNode; b: CollagePlacedNode }[] = [];

  let totalWeight = 0;
  let weightedSumX = 0;
  let weightedSumY = 0;
  let boxMinX = Infinity;
  let boxMinY = Infinity;
  let boxMaxX = -Infinity;
  let boxMaxY = -Infinity;

  const recordPlaced = (
    card: Card,
    rect: Rect,
    z: number,
    isHero: boolean,
    framed: boolean,
    rotation: number
  ) => {
    const cleanRot = round1(rotation);
    const w = computeVisualWeight(card, rect.w, rect.h, isHero);
    const node: CollagePlacedNode = { card, rect, isHero, weight: w, rotation: cleanRot };
    placed.push(node);
    placedById.set(card.id, node);

    // Track already-active arrow segments so later cards avoid sitting on top of connector lines
    const ns = adj.get(card.id);
    if (ns) {
      for (const nid of ns) {
        const peer = placedById.get(nid);
        if (peer && peer.card.id !== card.id) {
          placedEdges.push({ a: node, b: peer });
        }
      }
    }

    items.push({
      id: card.id,
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.w),
      h: Math.round(rect.h),
      z,
      framed,
      rotation: cleanRot,
    });

    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    weightedSumX += cx * w;
    weightedSumY += cy * w;
    totalWeight += w;

    const aabb = getCardRotatedAABB({ ...rect, rotation: cleanRot });
    boxMinX = Math.min(boxMinX, aabb.x);
    boxMinY = Math.min(boxMinY, aabb.y);
    boxMaxX = Math.max(boxMaxX, aabb.x + aabb.w);
    boxMaxY = Math.max(boxMaxY, aabb.y + aabb.h);
  };

  // Helper: deterministic natural hand-pinned tilt alternating sign cleanly
  const pickTilt = (kind: Card['kind'], idx: number, isHero = false): number => {
    if (!tiltEnabled || tiltAmp <= 0.01) return 0;
    const sign = (idx + seed) % 2 === 0 ? 1 : -1;
    if (isHero) return round1(sign * (0.35 + rng() * 0.45) * tiltAmp);
    if (kind === 'image') return round1(sign * (1.0 + rng() * 1.8) * tiltAmp);
    if (kind === 'color') return round1(sign * (1.2 + rng() * 2.1) * tiltAmp);
    if (kind === 'file' || kind === 'link') return round1(sign * (1.3 + rng() * 2.3) * tiltAmp);
    // Note: lively sticky feel while keeping text crisp
    return round1(sign * (1.4 + rng() * 2.5) * tiltAmp);
  };

  // Helper: varied graphic-design sizing for notes & files (eliminates spreadsheet uniformity!)
  const sizeMixedCard = (card: Card, idx: number, isLeadNote: boolean): { w: number; h: number } => {
    if (card.kind === 'image') {
      const isAccent = card.category === 'material' || card.category === 'palette';
      const tierScale = isAccent
        ? 182 + Math.round(rng() * 38) // 182..220px tactile accents
        : idx <= 2
          ? 268 + Math.round(rng() * 44) // 268..312px strong secondary photos
          : 210 + Math.round(rng() * 52); // 210..262px mid photos
      return sizeImagePreservingRatio(card, tierScale, idx <= 2 ? 320 : 275);
    }
    if (card.kind === 'file') {
      const w = 212 + Math.round(rng() * 40); // varied spec ticket widths 212..252px
      return { w, h: 76 };
    }
    if (card.kind === 'link') {
      const w = 228 + Math.round(rng() * 36);
      return { w, h: 104 };
    }
    if (card.kind === 'color') {
      const w = 104 + Math.round(rng() * 22);
      return { w, h: 74 + Math.round(rng() * 10) };
    }
    // Note: contrast between featured editorial notes, compact square stickies & horizontal slips
    const bodyLen = (card.text || '').trim().length;
    if (isLeadNote || bodyLen >= 55) {
      const w = 266 + Math.round(rng() * 36);
      return { w, h: estimateEditorialCardHeight(card, w, false) };
    }
    const shapeArchetype = (idx + seed) % 3;
    if (shapeArchetype === 0) {
      // Compact sticky square
      const w = 178 + Math.round(rng() * 26);
      const h = Math.max(134, Math.min(176, estimateEditorialCardHeight(card, w, true) + 18));
      return { w, h };
    }
    if (shapeArchetype === 1) {
      // Horizontal editorial slip
      const w = 228 + Math.round(rng() * 34);
      const h = Math.max(106, Math.min(144, estimateEditorialCardHeight(card, w, true)));
      return { w, h };
    }
    // Slim tall studio memo
    const w = 186 + Math.round(rng() * 24);
    const h = Math.max(142, Math.min(188, estimateEditorialCardHeight(card, w, true) + 26));
    return { w, h };
  };

  // Overlap & readability validator (plus guaranteed breathing gap between arrow-connected cards!)
  const isCandidateValid = (cand: Rect, card: Card, clusterHalo = 0): boolean => {
    const kind = card.kind;
    const isImage = kind === 'image';
    const candArea = Math.max(1, cand.w * cand.h);
    const candCore = innerCoreRect(cand, isImage ? 0.56 : 0.72);
    const tiltSafetyPad = tiltEnabled ? 7 : 0;
    const directNeighbors = adj.get(card.id);

    for (const p of placed) {
      const existing = p.rect;

      // Directly arrow-connected cards NEVER overlap so the Bezier arrow & arrowhead stay crisp and readable!
      if (directNeighbors?.has(p.card.id)) {
        const minConnSpace = 22 + tiltSafetyPad;
        const padded: Rect = {
          x: existing.x - minConnSpace,
          y: existing.y - minConnSpace,
          w: existing.w + minConnSpace * 2,
          h: existing.h + minConnSpace * 2,
        };
        if (rectsIntersect(cand, padded)) return false;
        continue;
      }

      // Optional breathing halo when starting a brand-new disconnected component hub
      if (clusterHalo > 0) {
        const padded: Rect = {
          x: existing.x - clusterHalo,
          y: existing.y - clusterHalo,
          w: existing.w + clusterHalo * 2,
          h: existing.h + clusterHalo * 2,
        };
        if (rectsIntersect(cand, padded)) return false;
        continue;
      }

      const bothImages = isImage && p.card.kind === 'image';
      const nonImageOnImage = !isImage && p.card.kind === 'image';
      const imageOnNonImage = isImage && p.card.kind !== 'image';

      // Non-image cards (notes, files, links, swatches) NEVER overlap each other -> crisp readability!
      if (!isImage && p.card.kind !== 'image') {
        const minSpace = (kind === 'color' && p.card.kind === 'color' ? 10 : 18) + tiltSafetyPad;
        const padded: Rect = {
          x: existing.x - minSpace,
          y: existing.y - minSpace,
          w: existing.w + minSpace * 2,
          h: existing.h + minSpace * 2,
        };
        if (rectsIntersect(cand, padded)) return false;
        continue;
      }

      // Images must NEVER slide over an already-placed Note/File's text
      if (imageOnNonImage) {
        const minSpace = 14 + tiltSafetyPad;
        const padded: Rect = {
          x: existing.x - minSpace,
          y: existing.y - minSpace,
          w: existing.w + minSpace * 2,
          h: existing.h + minSpace * 2,
        };
        if (rectsIntersect(cand, padded)) return false;
        continue;
      }

      // Low overlap slider (<8%) -> clean breathing gap everywhere
      if (t < 0.08) {
        const gap = 16 + tiltSafetyPad;
        const padded: Rect = {
          x: existing.x - gap,
          y: existing.y - gap,
          w: existing.w + gap * 2,
          h: existing.h + gap * 2,
        };
        if (rectsIntersect(cand, padded)) return false;
        continue;
      }

      const ovArea = intersectionArea(cand, existing);
      if (ovArea === 0) {
        // When rotated, prevent grazing collision at very tiny gap (<4px) between different kinds
        if (tiltEnabled && nonImageOnImage && rectGapDistance(cand, existing) < 4) {
          continue;
        }
        continue;
      }

      if (bothImages) {
        const existingCore = innerCoreRect(existing, 0.56);
        if (rectsIntersect(cand, existingCore) || rectsIntersect(candCore, existing)) {
          return false;
        }
        const maxRatio = p.isHero ? 0.19 * t : 0.11 * t;
        const existingArea = Math.max(1, existing.w * existing.h);
        if (ovArea / Math.min(candArea, existingArea) > maxRatio) return false;
      } else if (nonImageOnImage) {
        // Note/File/Swatch pinned delicately onto the OUTER rim of a photo (z-index sits above photo!)
        const photoCore = innerCoreRect(existing, 0.64);
        if (rectsIntersect(cand, photoCore)) return false;
        const maxPinRatio = kind === 'file' ? 0.14 * t : 0.12 * t;
        const existingArea = Math.max(1, existing.w * existing.h);
        if (ovArea / Math.min(candArea, existingArea) > maxPinRatio) return false;
      }
    }

    return true;
  };

  // Graphic-Designer Scoring Function: Graph Clustering + See-Saw Balance + Anti-Spreadsheet + Semantic Proximity + Golden Envelope
  const scoreCandidate = (
    cand: Rect,
    card: Card,
    hostNode?: CollagePlacedNode
  ): number => {
    const cx = cand.x + cand.w / 2;
    const cy = cand.y + cand.h / 2;
    const wNew = computeVisualWeight(card, cand.w, cand.h, false);
    const directNeighbors = adj.get(card.id);
    const connectedPlaced =
      directNeighbors && directNeighbors.size > 0
        ? placed.filter((p) => directNeighbors.has(p.card.id))
        : [];
    const hasPlacedConn = connectedPlaced.length > 0;

    // 0. Explicit Connector Clustering & Non-Crossing Sightlines (highest priority when connected!)
    let connCost = 0;
    if (hasPlacedConn) {
      let totalGap = 0;
      let totalCenterDist = 0;
      let crossingCount = 0;
      for (const cp of connectedPlaced) {
        totalGap += rectGapDistance(cand, cp.rect);
        const pCx = cp.rect.x + cp.rect.w / 2;
        const pCy = cp.rect.y + cp.rect.h / 2;
        totalCenterDist += Math.hypot(cx - pCx, cy - pCy);

        for (const other of placed) {
          if (other.card.id === cp.card.id) continue;
          if (segmentIntersectsRect(cx, cy, pCx, pCy, other.rect)) {
            crossingCount++;
          }
        }
      }
      connCost += totalGap * 5.4 + totalCenterDist * 0.42 + crossingCount * 420;

      // If this node is itself a sub-hub with >= 2 unplaced children, keep its outward side breathing open
      let unplacedNeighborCount = 0;
      if (directNeighbors) {
        for (const nid of directNeighbors) {
          if (!placedById.has(nid)) unplacedNeighborCount++;
        }
      }
      if (unplacedNeighborCount >= 2) {
        let nearbyUnrelated = 0;
        for (const other of placed) {
          if (directNeighbors?.has(other.card.id)) continue;
          if (rectGapDistance(cand, other.rect) < 130) nearbyUnrelated++;
        }
        connCost += nearbyUnrelated * 85;
      }
    }

    // Penalize parking ANY card on top of an already-established connector arrow line
    if (placedEdges.length > 0) {
      let blockedArrows = 0;
      for (const edge of placedEdges) {
        if (edge.a.card.id === card.id || edge.b.card.id === card.id) continue;
        const aCx = edge.a.rect.x + edge.a.rect.w / 2;
        const aCy = edge.a.rect.y + edge.a.rect.h / 2;
        const bCx = edge.b.rect.x + edge.b.rect.w / 2;
        const bCy = edge.b.rect.y + edge.b.rect.h / 2;
        if (segmentIntersectsRect(aCx, aCy, bCx, bCy, cand)) {
          blockedArrows++;
        }
      }
      connCost += blockedArrows * 360;
    }

    // 1. Visual Weight See-Saw Center-of-Mass Balance (pull COM toward balanced center near Hero)
    const nextComX = (weightedSumX + cx * wNew) / (totalWeight + wNew);
    const nextComY = (weightedSumY + cy * wNew) / (totalWeight + wNew);
    const balanceCost =
      Math.hypot(nextComX - heroCx, nextComY - heroCy) * (hasPlacedConn ? 0.28 : 0.85);

    // 2. Canvas Aspect Ratio Envelope (aim for ~1.48:1 editorial presentation spread)
    const nMinX = Math.min(boxMinX, cand.x);
    const nMinY = Math.min(boxMinY, cand.y);
    const nMaxX = Math.max(boxMaxX, cand.x + cand.w);
    const nMaxY = Math.max(boxMaxY, cand.y + cand.h);
    const spanW = Math.max(1, nMaxX - nMinX);
    const spanH = Math.max(1, nMaxY - nMinY);
    const aspectRatio = spanW / spanH;
    const targetAspect =
      options.aspectPreset === '16:9'
        ? 1.78
        : options.aspectPreset === 'a4'
          ? 1.414
          : options.aspectPreset === '1:1'
            ? 1.0
            : 1.48;
    const aspectWeight =
      (options.aspectPreset && options.aspectPreset !== 'free' ? 275 : 195) *
      (hasPlacedConn ? 0.55 : 1);
    const aspectPenalty = Math.abs(aspectRatio - targetAspect) * aspectWeight;

    // 3. Radial compactness along slight diagonal flow
    const dx = cx - heroCx;
    const dy = (cy - heroCy) * 1.18;
    const radialDist = Math.hypot(dx, dy) * (hasPlacedConn ? 0.16 : 0.72);
    // Slight diagonal flow affinity
    const diagAlign = hasPlacedConn
      ? 0
      : (dx * diagSign > 0 && dy > 0) || (dx * diagSign < 0 && dy < 0)
        ? -26
        : 0;

    // 4. Semantic Host Attraction (explicit arrow overrides inferred category host!)
    let semanticBonus = 0;
    if (hostNode && !hasPlacedConn) {
      const hCx = hostNode.rect.x + hostNode.rect.w / 2;
      const hCy = hostNode.rect.y + hostNode.rect.h / 2;
      const dHost = Math.hypot(cx - hCx, cy - hCy);
      semanticBonus = dHost < 340 ? -240 + dHost * 0.45 : 90;
    }

    // 5. ANTI-SPREADSHEET & MIXED-MEDIA WEAVING RULES (The heart of organic Collage!)
    let compositionAdj = 0;
    if (card.kind !== 'image') {
      let nearestImageDist = Infinity;
      let sameKindNearby = 0;
      let alignedPeerCount = 0;

      for (const p of placed) {
        const isDirect = directNeighbors?.has(p.card.id) ?? false;
        const gDist = rectGapDistance(cand, p.rect);
        if (p.card.kind === 'image') {
          if (gDist < nearestImageDist) nearestImageDist = gDist;
        } else if (!isDirect && p.card.kind === card.kind) {
          if (gDist < 145) sameKindNearby++;
          // Strongly penalize horizontal or vertical spreadsheet alignment between unconnected notes/files!
          if (gDist < 220) {
            if (Math.abs(cand.y - p.rect.y) < 22 || Math.abs(cand.x - p.rect.x) < 22) {
              alignedPeerCount++;
            }
          }
        } else if (
          !isDirect &&
          (p.card.kind === 'note' || p.card.kind === 'file' || p.card.kind === 'link')
        ) {
          // Mildly discourage note & file forming a flat table row together too
          if (gDist < 170 && (Math.abs(cand.y - p.rect.y) < 16 || Math.abs(cand.x - p.rect.x) < 16)) {
            alignedPeerCount += 0.6;
          }
        }
      }

      // Reward sitting close to an image (weaving text/files around visuals!)
      if (!hasPlacedConn) {
        if (nearestImageDist < 110) {
          compositionAdj -= 115;
        } else if (nearestImageDist < 240) {
          compositionAdj -= 45;
        } else {
          compositionAdj += (nearestImageDist - 240) * 0.45;
        }
      }

      // Penalize clumping same-type unrelated notes/files together or snapping into neat rows/cols
      const clumpScale = hasPlacedConn ? 0.35 : 1;
      compositionAdj += (sameKindNearby * 115 + alignedPeerCount * 165) * clumpScale;
    } else if (!hasPlacedConn) {
      // Images enjoy diagonal stagger and mild variety of neighbors
      for (const p of placed) {
        if (p.card.kind === 'image' && Math.abs(cand.y - p.rect.y) < 14 && rectGapDistance(cand, p.rect) < 80) {
          compositionAdj += 55;
        }
      }
    }

    // Small organic tie-breaker from PRNG so layouts breathe naturally
    const organicNoise = (rng() - 0.5) * (hasPlacedConn ? 14 : 32);

    return (
      connCost +
      balanceCost +
      aspectPenalty +
      radialDist +
      diagAlign +
      semanticBonus +
      compositionAdj +
      organicNoise
    );
  };

  // --- STEP 1: Place Commanding Hero Anchor (slightly off-center per Rule of Thirds) ---
  const hero = allVisuals[0];
  const heroW = Math.round(456 + 52 * t);
  const heroSize = sizeImagePreservingRatio(hero, heroW, 395);
  const heroRect: Rect = { x: 0, y: 0, w: heroSize.w, h: heroSize.h };
  const heroCx = heroRect.x + heroRect.w / 2;
  const heroCy = heroRect.y + heroRect.h / 2;
  recordPlaced(hero, heroRect, baseZ + 6, true, false, pickTilt('image', 0, true));

  // --- STEP 2: Identify Semantic Pairings (match Notes/Files to their Category Photos!) ---
  const remainingVisuals = [...supports, ...heroes.slice(1), ...accents];
  const visualByCategory = new Map<Category, Card[]>();
  for (const img of allVisuals) {
    const arr = visualByCategory.get(img.category) ?? [];
    arr.push(img);
    visualByCategory.set(img.category, arr);
  }

  const primaryNote = editorials.find((c) => c.kind === 'note');
  const semanticHostId = new Map<string, string>();
  if (primaryNote) {
    semanticHostId.set(primaryNote.id, hero.id);
  }
  if (options.groupByCategory) {
    for (const ed of editorials) {
      if (semanticHostId.has(ed.id)) continue;
      if (ed.category !== 'other') {
        const hosts = visualByCategory.get(ed.category);
        if (hosts && hosts.length > 0) {
          semanticHostId.set(ed.id, hosts[0].id);
        }
      }
    }
  }

  // Helper to generate organic 360° perimeter + dedicated close-orbit connector candidates
  const placeCardOrganically = (
    card: Card,
    w: number,
    h: number,
    z: number,
    framed: boolean,
    idx: number,
    preferredHostId?: string,
    clusterHalo = 0
  ) => {
    if (placedById.has(card.id)) return;
    const isImage = card.kind === 'image';
    const hostNode = preferredHostId ? placedById.get(preferredHostId) : undefined;
    const directNeighbors = adj.get(card.id);
    const connectedPlaced =
      directNeighbors && directNeighbors.size > 0
        ? placed.filter((p) => directNeighbors.has(p.card.id))
        : [];
    const candidates: Rect[] = [];

    const insetHero = Math.round(-18 + 60 * t);
    const insetPeer = Math.round(-16 + 44 * t);
    const pinInset = Math.round(-16 + 34 * t); // gentle pin onto outer corner of an image
    const stagger = (scale = 34) => Math.round((rng() - 0.5) * scale);

    if (connectedPlaced.length > 0) {
      // Dedicated close-orbit 360° slots directly around every already-placed arrow neighbor!
      for (const cp of connectedPlaced) {
        const r = cp.rect;
        const rings = [28 + Math.round(rng() * 10), 60 + Math.round(rng() * 14), 104];
        for (let ringIdx = 0; ringIdx < rings.length; ringIdx++) {
          const g = rings[ringIdx];
          const midY = Math.round(r.y + (r.h - h) * 0.5);
          const midX = Math.round(r.x + (r.w - w) * 0.5);
          candidates.push(
            // Right edge (center, top, bottom)
            { x: r.x + r.w + g, y: midY, w, h },
            { x: r.x + r.w + g, y: r.y, w, h },
            { x: r.x + r.w + g, y: r.y + r.h - h, w, h },
            // Left edge (center, top, bottom)
            { x: r.x - w - g, y: midY, w, h },
            { x: r.x - w - g, y: r.y, w, h },
            { x: r.x - w - g, y: r.y + r.h - h, w, h },
            // Bottom edge (center, left, right)
            { x: midX, y: r.y + r.h + g, w, h },
            { x: r.x, y: r.y + r.h + g, w, h },
            { x: r.x + r.w - w, y: r.y + r.h + g, w, h },
            // Top edge (center, left, right)
            { x: midX, y: r.y - h - g, w, h },
            { x: r.x, y: r.y - h - g, w, h },
            { x: r.x + r.w - w, y: r.y - h - g, w, h }
          );
          if (ringIdx <= 1) {
            // 4 crisp diagonal corner pockets for starburst hubs
            candidates.push(
              { x: r.x + r.w + g, y: r.y - h - g, w, h },
              { x: r.x + r.w + g, y: r.y + r.h + g, w, h },
              { x: r.x - w - g, y: r.y + r.h + g, w, h },
              { x: r.x - w - g, y: r.y - h - g, w, h }
            );
          }
        }
      }

      // If connected to 2+ already-placed cards, probe shared pocket around their centroid!
      if (connectedPlaced.length >= 2) {
        const avgCx =
          connectedPlaced.reduce((s, cp) => s + cp.rect.x + cp.rect.w / 2, 0) /
          connectedPlaced.length;
        const avgCy =
          connectedPlaced.reduce((s, cp) => s + cp.rect.y + cp.rect.h / 2, 0) /
          connectedPlaced.length;
        candidates.push({ x: Math.round(avgCx - w / 2), y: Math.round(avgCy - h / 2), w, h });
        for (const rad of [52, 108]) {
          for (let k = 0; k < 8; k++) {
            const ang = (k / 8) * Math.PI * 2;
            candidates.push({
              x: Math.round(avgCx + Math.cos(ang) * rad - w / 2),
              y: Math.round(avgCy + Math.sin(ang) * rad - h / 2),
              w,
              h,
            });
          }
        }
      }
    } else {
      // Priority anchor nodes: semantic host first, then images, then scattered outer nodes
      const anchorPool: CollagePlacedNode[] = [];
      if (hostNode) anchorPool.push(hostNode);
      for (const p of placed) {
        if (p.card.id !== preferredHostId && p.card.kind === 'image') {
          anchorPool.push(p);
        }
      }
      // Also add up to 5 non-image nodes at staggered diagonal offsets so high-density boards fan organically
      const nonImgNodes = placed.filter((p) => p.card.kind !== 'image');
      for (let i = 0; i < Math.min(5, nonImgNodes.length); i++) {
        anchorPool.push(nonImgNodes[(i * 3 + seed) % nonImgNodes.length]);
      }

      const extraPad = clusterHalo > 0 ? clusterHalo + 12 : 0;

      for (const p of anchorPool) {
        const r = p.rect;
        if (clusterHalo > 0) {
          // Component hub prefers clean breathing perimeter around existing clusters
          const g = extraPad + Math.round(rng() * 18);
          candidates.push(
            { x: r.x + r.w + g, y: r.y + stagger(40), w, h },
            { x: r.x - w - g, y: r.y + stagger(40), w, h },
            { x: r.x + stagger(40), y: r.y + r.h + g, w, h },
            { x: r.x + stagger(40), y: r.y - h - g, w, h },
            { x: r.x + r.w + g, y: r.y + r.h + g, w, h },
            { x: r.x - w - g, y: r.y - h - g, w, h }
          );
        } else if (isImage && p.card.kind === 'image') {
          const ins = p.isHero ? insetHero : insetPeer;
          candidates.push(
            { x: r.x + r.w - ins, y: r.y + r.h - Math.round(h * 0.62) + stagger(26), w, h },
            { x: r.x + r.w - Math.round(ins * 0.72), y: r.y - Math.round(h * 0.24) + stagger(24), w, h },
            { x: r.x - w + ins, y: r.y + r.h - Math.round(h * 0.68) + stagger(26), w, h },
            { x: r.x - w + Math.round(ins * 0.72), y: r.y - Math.round(h * 0.14) + stagger(24), w, h },
            { x: r.x + Math.round(r.w * 0.1) + stagger(36), y: r.y + r.h - ins, w, h },
            { x: r.x + r.w - Math.round(w * 0.88) + stagger(36), y: r.y - h + ins, w, h },
            { x: r.x + r.w + 24 + Math.abs(stagger(24)), y: r.y + stagger(48), w, h },
            { x: r.x - w - 24 - Math.abs(stagger(24)), y: r.y + stagger(48), w, h }
          );
        } else if (!isImage && p.card.kind === 'image') {
          // Tactile pin positions + staggered breathing pockets around every image!
          const gap = 22 + Math.round(rng() * 24);
          candidates.push(
            // Corner-pinned slip (top-left, top-right, bottom-left, bottom-right outer rim)
            { x: r.x - Math.round(w * 0.72), y: r.y - Math.round(h * 0.28), w, h },
            { x: r.x + r.w - Math.round(w * 0.26), y: r.y - Math.round(h * 0.34), w, h },
            { x: r.x - Math.round(w * 0.65), y: r.y + r.h - Math.round(h * 0.62), w, h },
            { x: r.x + r.w - Math.round(w * 0.32), y: r.y + r.h - Math.round(h * 0.45), w, h },
            // Clean breathing pockets offset off-axis around all 4 sides of the photo
            { x: r.x + stagger(54), y: r.y - h - gap, w, h },
            { x: r.x + r.w - w + stagger(54), y: r.y + r.h + gap, w, h },
            { x: r.x + r.w + gap, y: r.y + Math.round((r.h - h) * 0.5) + stagger(64), w, h },
            { x: r.x - w - gap, y: r.y + Math.round((r.h - h) * 0.5) + stagger(64), w, h },
            // Soft corner kiss
            { x: r.x + r.w - pinInset, y: r.y + Math.round(r.h * 0.18) + stagger(32), w, h },
            { x: r.x - w + pinInset, y: r.y + Math.round(r.h * 0.55) + stagger(32), w, h }
          );
        } else {
          // Staggered diagonal offsets off existing non-image cards (NEVER flat row/column!)
          const shiftX = 46 + Math.round(rng() * 44);
          const shiftY = 38 + Math.round(rng() * 38);
          candidates.push(
            { x: r.x + r.w + 26 + Math.round(rng() * 22), y: r.y + shiftY, w, h },
            { x: r.x + r.w + 26 + Math.round(rng() * 22), y: r.y - shiftY, w, h },
            { x: r.x - w - 26 - Math.round(rng() * 22), y: r.y + shiftY, w, h },
            { x: r.x - w - 26 - Math.round(rng() * 22), y: r.y - shiftY, w, h },
            { x: r.x + shiftX, y: r.y + r.h + 26 + Math.round(rng() * 22), w, h },
            { x: r.x - shiftX, y: r.y + r.h + 26 + Math.round(rng() * 22), w, h },
            { x: r.x + shiftX, y: r.y - h - 26 - Math.round(rng() * 22), w, h },
            { x: r.x - shiftX, y: r.y - h - 26 - Math.round(rng() * 22), w, h }
          );
        }
      }
    }

    // Add 8 radial breathing-ring candidates around global silhouette for unconnected cards / new component hubs
    const curW = Math.max(400, boxMaxX - boxMinX);
    const curH = Math.max(300, boxMaxY - boxMinY);
    const midX = (boxMinX + boxMaxX) / 2;
    const midY = (boxMinY + boxMaxY) / 2;
    if (connectedPlaced.length === 0) {
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2 + seed * 0.43 + (rng() - 0.5) * 0.35;
        const rx = curW * 0.52 + 34 + clusterHalo + rng() * 42;
        const ry = curH * 0.52 + 28 + clusterHalo + rng() * 36;
        candidates.push({
          x: Math.round(midX + Math.cos(ang) * rx - w / 2),
          y: Math.round(midY + Math.sin(ang) * ry - h / 2),
          w,
          h,
        });
      }
    }

    const pickBest = (halo: number): Rect | null => {
      let bestRect: Rect | null = null;
      let bestSc = Infinity;
      for (const cand of candidates) {
        if (!isCandidateValid(cand, card, halo)) continue;
        const sc = scoreCandidate(cand, card, hostNode);
        if (sc < bestSc) {
          bestSc = sc;
          bestRect = cand;
        }
      }
      return bestRect;
    };

    let best = pickBest(clusterHalo);
    if (!best && clusterHalo > 0) {
      best = pickBest(0);
    }

    // Guaranteed valid spiral fallback (centered tightly on connected neighbors if any!)
    if (!best) {
      const originX =
        connectedPlaced.length > 0
          ? connectedPlaced.reduce((s, cp) => s + cp.rect.x + cp.rect.w / 2, 0) /
            connectedPlaced.length
          : midX;
      const originY =
        connectedPlaced.length > 0
          ? connectedPlaced.reduce((s, cp) => s + cp.rect.y + cp.rect.h / 2, 0) /
            connectedPlaced.length
          : midY;
      const baseDist = connectedPlaced.length > 0 ? 75 : Math.max(curW, curH) * 0.5;
      const stepDist = connectedPlaced.length > 0 ? 52 : 95;
      const anglesPerRing = connectedPlaced.length > 0 ? 16 : 12;

      for (let ring = 1; ring <= 18 && !best; ring++) {
        let ringBest: Rect | null = null;
        let ringBestScore = Infinity;
        for (let k = 0; k < anglesPerRing; k++) {
          const ang = (k / anglesPerRing) * Math.PI * 2 + ring * 0.37;
          const dist = baseDist + ring * stepDist;
          const cand: Rect = {
            x: Math.round(originX + Math.cos(ang) * dist - w / 2),
            y: Math.round(
              originY + Math.sin(ang) * dist * (connectedPlaced.length > 0 ? 0.92 : 0.72) - h / 2
            ),
            w,
            h,
          };
          if (isCandidateValid(cand, card, 0)) {
            const sc = scoreCandidate(cand, card, hostNode);
            if (sc < ringBestScore) {
              ringBestScore = sc;
              ringBest = cand;
            }
          }
        }
        if (ringBest) best = ringBest;
      }
    }

    const finalRect: Rect = best ?? {
      x: Math.round(boxMaxX + 28),
      y: Math.round(midY - h / 2 + stagger(60)),
      w,
      h,
    };

    recordPlaced(card, finalRect, z, false, framed, pickTilt(card.kind, idx));
  };

  // --- STEP 2B: Dynamic Connected-Constellation BFS Placement (keeps linked clusters tightly together!) ---
  let connOrderIdx = 1;
  const placeConnectedNode = (card: Card, clusterHalo = 0) => {
    if (placedById.has(card.id)) return;
    const isLeadNote = primaryNote?.id === card.id;
    const idx = connOrderIdx++;
    const { w, h } = sizeMixedCard(card, idx, isLeadNote);
    const isImg = card.kind === 'image';
    const isAccent = card.category === 'material' || card.category === 'palette';
    const z = isImg
      ? isAccent
        ? baseZ + 28 + idx
        : baseZ + 12 + idx
      : card.kind === 'color'
        ? baseZ + 52 + idx
        : baseZ + 66 + idx;
    placeCardOrganically(
      card,
      w,
      h,
      z,
      isImg && useFrame && t > 0.1,
      idx + 12,
      semanticHostId.get(card.id),
      clusterHalo
    );
  };

  const expandConnectedComponentBFS = (startCard: Card) => {
    const queue: Card[] = [startCard];
    const expanded = new Set<string>([startCard.id]);

    while (queue.length > 0) {
      const cur = queue.shift()!;
      const ns = adj.get(cur.id);
      if (!ns || ns.size === 0) continue;

      const unplacedNeighbors: Card[] = [];
      for (const nid of ns) {
        if (placedById.has(nid)) continue;
        const nCard = cardById.get(nid);
        if (nCard) unplacedNeighbors.push(nCard);
      }
      if (unplacedNeighbors.length === 0) continue;

      // Sort direct neighbors: multi-connected bridges first -> images -> higher-degree hubs -> compact leaves
      unplacedNeighbors.sort((a, b) => {
        const countPlacedLinks = (c: Card) => {
          let cnt = 0;
          const cNs = adj.get(c.id);
          if (cNs) {
            for (const id of cNs) {
              if (placedById.has(id)) cnt++;
            }
          }
          return cnt;
        };
        const bridgeDiff = countPlacedLinks(b) - countPlacedLinks(a);
        if (bridgeDiff !== 0) return bridgeDiff;
        const kindRank = (c: Card) =>
          c.kind === 'image' ? 0 : c.kind === 'note' ? 1 : c.kind === 'file' || c.kind === 'link' ? 2 : 3;
        const krDiff = kindRank(a) - kindRank(b);
        if (krDiff !== 0) return krDiff;
        const degDiff = (adj.get(b.id)?.size ?? 0) - (adj.get(a.id)?.size ?? 0);
        if (degDiff !== 0) return degDiff;
        return b.w * b.h - a.w * a.h || a.id.localeCompare(b.id);
      });

      for (const neighbor of unplacedNeighbors) {
        placeConnectedNode(neighbor, 0);
        if (!expanded.has(neighbor.id)) {
          expanded.add(neighbor.id);
          queue.push(neighbor);
        }
      }
    }
  };

  if (hasConnections) {
    // First lock Hero's entire connected constellation tightly around Hero
    expandConnectedComponentBFS(hero);

    // Next collect all remaining unplaced connected components (size >= 2)
    const visitedComp = new Set<string>(placedById.keys());
    const remainingComponents: Card[][] = [];
    for (const c of cards) {
      if (visitedComp.has(c.id)) continue;
      if ((adj.get(c.id)?.size ?? 0) === 0) continue;
      const comp: Card[] = [];
      const q: Card[] = [c];
      visitedComp.add(c.id);
      while (q.length > 0) {
        const cur = q.shift()!;
        comp.push(cur);
        const ns = adj.get(cur.id);
        if (!ns) continue;
        for (const nid of ns) {
          if (visitedComp.has(nid)) continue;
          const nCard = cardById.get(nid);
          if (nCard) {
            visitedComp.add(nid);
            q.push(nCard);
          }
        }
      }
      if (comp.length >= 2) {
        remainingComponents.push(comp);
      }
    }

    // Order connected islands by visual importance & size descending
    remainingComponents.sort((a, b) => {
      const aHasImg = a.some((c) => c.kind === 'image') ? 0 : 1;
      const bHasImg = b.some((c) => c.kind === 'image') ? 0 : 1;
      if (aHasImg !== bHasImg) return aHasImg - bHasImg;
      if (b.length !== a.length) return b.length - a.length;
      return a[0].id.localeCompare(b[0].id);
    });
    const orderedComponents =
      seed > 0 && remainingComponents.length > 1
        ? shuffleWithRng(remainingComponents, rng)
        : remainingComponents;

    for (const comp of orderedComponents) {
      // Pick hub of this connected cluster (largest image -> highest degree card)
      const hub = [...comp].sort((a, b) => {
        const imgA = a.kind === 'image' ? 0 : 1;
        const imgB = b.kind === 'image' ? 0 : 1;
        if (imgA !== imgB) return imgA - imgB;
        const degDiff = (adj.get(b.id)?.size ?? 0) - (adj.get(a.id)?.size ?? 0);
        if (degDiff !== 0) return degDiff;
        return b.w * b.h - a.w * a.h || a.id.localeCompare(b.id);
      })[0];
      const halo = Math.min(64, 24 + comp.length * 8);
      placeConnectedNode(hub, halo);
      expandConnectedComponentBFS(hub);
    }
  }

  // --- STEP 3: Place Core Visual Spine (first 3 unconnected secondary images) ---
  const unplacedVisuals = remainingVisuals.filter((img) => !placedById.has(img.id));
  const spineCount = Math.min(3, unplacedVisuals.length);
  const spineImages = unplacedVisuals.slice(0, spineCount);
  const tailImages = unplacedVisuals.slice(spineCount);

  spineImages.forEach((img, idx) => {
    const { w, h } = sizeMixedCard(img, idx + 1, false);
    const isAccent = img.category === 'material' || img.category === 'palette';
    placeCardOrganically(
      img,
      w,
      h,
      isAccent ? baseZ + 22 + idx : baseZ + 10 + idx,
      useFrame && t > 0.1,
      idx + 1,
      hero.id
    );
  });

  // --- STEP 4: Place Lead Concept Note right in a breathing pocket beside Hero (if unconnected) ---
  const handledEditorialIds = new Set<string>(placedById.keys());
  if (primaryNote && !placedById.has(primaryNote.id)) {
    const { w, h } = sizeMixedCard(primaryNote, 0, true);
    placeCardOrganically(primaryNote, w, h, baseZ + 62, false, 10, hero.id);
    handledEditorialIds.add(primaryNote.id);
  }

  // --- STEP 5: Place Unconnected Swatches in Tactile Pantone Fan Clusters ---
  const freeSwatches = swatches.filter((sw) => !placedById.has(sw.id));
  const splitSwatches = freeSwatches.length >= 5;
  const swatchClusterA = splitSwatches
    ? freeSwatches.slice(0, Math.ceil(freeSwatches.length / 2))
    : freeSwatches;
  const swatchClusterB = splitSwatches ? freeSwatches.slice(swatchClusterA.length) : [];

  const placeSwatchCluster = (cluster: Card[], clusterIdx: number, zStart: number) => {
    if (cluster.length === 0) return;
    // Place first swatch organically in a balanced pocket, then cascade remaining chips in a lively staggered fan
    const swW = 112;
    const swH = 78;
    const first = cluster[0];
    placeCardOrganically(first, swW, swH, zStart, false, 20 + clusterIdx * 7);
    const anchor = placedById.get(first.id);
    if (!anchor || cluster.length === 1) return;

    const dirX = anchor.rect.x + anchor.rect.w / 2 >= heroCx ? 1 : -1;
    const dirY = anchor.rect.y + anchor.rect.h / 2 >= heroCy ? -1 : 1;
    let prev = anchor.rect;

    for (let i = 1; i < cluster.length; i++) {
      const sw = cluster[i];
      if (placedById.has(sw.id)) continue;
      // Alternate gentle horizontal/vertical staircase offsets like real paint chips!
      const stepOptions: Rect[] = [
        {
          x: prev.x + (i % 2 === 0 ? 12 * dirX : -10 * dirX),
          y: prev.y + (swH + 10) * dirY,
          w: swW,
          h: swH,
        },
        {
          x: prev.x + (swW + 10) * dirX,
          y: prev.y + (i % 2 === 0 ? 14 : -14),
          w: swW,
          h: swH,
        },
        {
          x: prev.x + (i % 2 === 0 ? -12 * dirX : 12 * dirX),
          y: prev.y - (swH + 10) * dirY,
          w: swW,
          h: swH,
        },
      ];
      let chosen: Rect | null = null;
      for (const opt of stepOptions) {
        if (isCandidateValid(opt, sw)) {
          chosen = opt;
          break;
        }
      }
      if (chosen) {
        recordPlaced(sw, chosen, zStart + i, false, false, pickTilt('color', 25 + clusterIdx * 5 + i));
        prev = chosen;
      } else {
        placeCardOrganically(sw, swW, swH, zStart + i, false, 25 + clusterIdx * 5 + i);
        prev = placedById.get(sw.id)?.rect ?? prev;
      }
    }
  };

  placeSwatchCluster(swatchClusterA, 0, baseZ + 48);

  // --- STEP 6: Interleaved Mixed-Media Constellation Queue (Remaining Unconnected Photos + Notes + Files) ---
  const remainingNotes = editorials.filter(
    (c) => c.kind === 'note' && !handledEditorialIds.has(c.id) && !placedById.has(c.id)
  );
  const remainingFiles = editorials.filter(
    (c) =>
      (c.kind === 'file' || c.kind === 'link') &&
      !handledEditorialIds.has(c.id) &&
      !placedById.has(c.id)
  );

  // Gently vary order on shuffle seeds while preserving semantic priority
  const notesQ = seed > 0 ? shuffleWithRng(remainingNotes, rng) : remainingNotes;
  const filesQ = seed > 0 ? shuffleWithRng(remainingFiles, rng) : remainingFiles;
  const imgsQ = seed > 0 ? shuffleWithRng(tailImages, rng) : tailImages;

  const mixedQueue: Card[] = [];
  let iImg = 0;
  let iNote = 0;
  let iFile = 0;
  while (iImg < imgsQ.length || iNote < notesQ.length || iFile < filesQ.length) {
    if (iImg < imgsQ.length) mixedQueue.push(imgsQ[iImg++]);
    if (iFile < filesQ.length) mixedQueue.push(filesQ[iFile++]);
    if (iNote < notesQ.length) mixedQueue.push(notesQ[iNote++]);
    if (iFile < filesQ.length && filesQ.length - iFile > notesQ.length - iNote) {
      mixedQueue.push(filesQ[iFile++]);
    }
  }

  let placedClusterB = false;
  mixedQueue.forEach((card, idx) => {
    if (placedById.has(card.id)) return;
    // Drop Swatch Cluster 2 mid-way so it counterbalances the opposite diagonal naturally
    if (!placedClusterB && swatchClusterB.length > 0 && idx >= Math.floor(mixedQueue.length / 2)) {
      placeSwatchCluster(swatchClusterB, 1, baseZ + 56);
      placedClusterB = true;
    }

    const { w, h } = sizeMixedCard(card, idx + spineCount + 1, false);
    const isImg = card.kind === 'image';
    const isAccent = card.category === 'material' || card.category === 'palette';
    // Notes & Files always sit ABOVE images (`baseZ + 66+`) so pinned slips stay 100% legible!
    const z = isImg
      ? isAccent
        ? baseZ + 30 + idx
        : baseZ + 15 + idx
      : baseZ + 66 + idx;

    const preferredHost = semanticHostId.get(card.id);
    placeCardOrganically(
      card,
      w,
      h,
      z,
      isImg && useFrame && t > 0.1,
      idx + 40,
      preferredHost
    );
  });

  if (!placedClusterB && swatchClusterB.length > 0) {
    placeSwatchCluster(swatchClusterB, 1, baseZ + 56);
  }

  return normalizeBox(items);
}

/**
 * MODE 3: CURATED CONCEPT ZONES (`zones`)
 * - Each Category becomes a mini editorial spread with clear focal hierarchy (lead visual 1.3x larger)
 *   instead of an anonymous uniform box.
 * - Adaptive 2-col or 3-col shortest-column Masonry so overall board keeps balanced ~16:10 proportions.
 * - Always rotation = 0° for crisp structural clarity.
 */
function layoutConceptZones(
  cards: Card[],
  options: ArrangeOptions,
  baseZ: number
): CompositionBox {
  const seed = options.seed ?? 0;
  const adj = buildConnectionGraph(cards);
  const zoneCatMap = getConnectedZoneCategoryMap(cards, adj);
  const t = Math.max(0, Math.min(1, options.overlap / 100));
  const useFrame = options.galleryFrame ?? true;
  const zoneBoxes: CompositionBox[] = [];
  let z = baseZ;

  const orderedCats =
    seed % 2 === 0
      ? CATEGORY_ORDER
      : ([
          'reference',
          'material',
          'furniture',
          'typography',
          'palette',
          'sketch',
          'other',
        ] as Category[]);

  for (const cat of orderedCats) {
    const catCards = cards.filter((c) => (zoneCatMap.get(c.id) ?? c.category) === cat);
    if (catCards.length === 0) continue;

    const zoneItems: PlacedCardPatch[] = [];
    const zoneCardIdSet = new Set(catCards.map((c) => c.id));
    const zoneHasInternalEdges =
      adj.size > 0 &&
      catCards.some((c) => {
        const ns = adj.get(c.id);
        if (!ns) return false;
        for (const nid of ns) {
          if (zoneCardIdSet.has(nid)) return true;
        }
        return false;
      });

    if (zoneHasInternalEdges) {
      // Connected Concept Zone: 2-column Mini-Editorial Spread keeping linked images/swatches/notes tightly adjacent!
      const sortedZoneCards = orderKeepingConnectedAdjacent(
        [...catCards].sort((a, b) => {
          const imgA = a.kind === 'image' ? 0 : 1;
          const imgB = b.kind === 'image' ? 0 : 1;
          if (imgA !== imgB) return imgA - imgB;
          const degDiff = (adj.get(b.id)?.size ?? 0) - (adj.get(a.id)?.size ?? 0);
          if (degDiff !== 0) return degDiff;
          return b.w * b.h - a.w * a.h || a.id.localeCompare(b.id);
        }),
        adj
      );
      const colWidths =
        catCards.length >= 16
          ? [290, 240, 240, 224]
          : catCards.length >= 9
            ? [288, 240, 224]
            : [304, 244];
      const zGap = 16;
      const colXs: number[] = [];
      let cxAcc = 0;
      for (const cw of colWidths) {
        colXs.push(cxAcc);
        cxAcc += cw + zGap;
      }
      const colYs = new Array<number>(colWidths.length).fill(0);
      const placedInZone = new Map<string, { col: number; y: number; h: number }>();

      sortedZoneCards.forEach((card, idx) => {
        let bestCol = 0;
        if (idx === 0) {
          bestCol = 0;
        } else {
          const ns = adj.get(card.id);
          let bestSc = Infinity;
          for (let c = 0; c < colWidths.length; c++) {
            let connBonus = 0;
            if (ns) {
              for (const nid of ns) {
                const p = placedInZone.get(nid);
                if (!p) continue;
                const cDist = Math.abs(p.col - c);
                if (cDist === 0) {
                  connBonus += -380 + Math.abs(colYs[c] - (p.y + p.h)) * 0.9;
                } else if (cDist === 1) {
                  connBonus += -350 + Math.abs(colYs[c] - p.y) * 0.85;
                } else {
                  connBonus += 220 + Math.abs(colYs[c] - p.y) * 0.85;
                }
              }
            }
            const sc = colYs[c] + connBonus;
            if (sc < bestSc) {
              bestSc = sc;
              bestCol = c;
            }
          }
        }
        const cw = colWidths[bestCol];
        const h =
          card.kind === 'image'
            ? sizeImagePreservingRatio(card, cw, idx === 0 ? 290 : 230).h
            : card.kind === 'color'
              ? 78
              : estimateEditorialCardHeight(card, cw);
        zoneItems.push({
          id: card.id,
          x: colXs[bestCol],
          y: colYs[bestCol],
          w: cw,
          h,
          z: ++z,
          framed: false,
          rotation: 0,
        });
        placedInZone.set(card.id, { col: bestCol, y: colYs[bestCol], h });
        colYs[bestCol] += h + zGap;
      });

      zoneBoxes.push(normalizeBox(zoneItems));
      continue;
    }

    const zoneImgs = orderKeepingConnectedAdjacent(
      [...catCards.filter((c) => c.kind === 'image')].sort(
        (a, b) => b.w * b.h - a.w * a.h || a.id.localeCompare(b.id)
      ),
      adj
    );
    const zoneSwatches = orderKeepingConnectedAdjacent(
      [...catCards.filter((c) => c.kind === 'color')].sort(
        (a, b) => parseHexLuminance(a.color) - parseHexLuminance(b.color)
      ),
      adj
    );
    const zoneEditorials = orderKeepingConnectedAdjacent(
      catCards.filter((c) => c.kind === 'note' || c.kind === 'file' || c.kind === 'link'),
      adj
    );

    let cursorY = 0;
    let zoneMaxW = 320;

    // Layer 1: Mini-Editorial Image Spread (Lead image 1.3x featured, satellites beside/below)
    if (zoneImgs.length > 0) {
      const imgGap = 14;
      if (zoneImgs.length === 1) {
        const s0 = sizeImagePreservingRatio(zoneImgs[0], 332, 310);
        zoneItems.push({ id: zoneImgs[0].id, x: 0, y: 0, w: s0.w, h: s0.h, z: ++z, framed: false, rotation: 0 });
        cursorY = s0.h;
        zoneMaxW = Math.max(zoneMaxW, s0.w);
      } else if (zoneImgs.length === 2) {
        const s0 = sizeImagePreservingRatio(zoneImgs[0], 316, 300);
        const s1 = sizeImagePreservingRatio(zoneImgs[1], 228, 250);
        const linkedPair = adj.get(zoneImgs[0].id)?.has(zoneImgs[1].id) ?? false;
        const stepX = !linkedPair && t >= 0.2 ? Math.round(s0.w - 36 * t) : s0.w + (linkedPair ? 24 : imgGap);
        const stepY = !linkedPair && t >= 0.2 ? Math.round(Math.min(s0.h * 0.36, 68)) : 18;
        zoneItems.push({ id: zoneImgs[0].id, x: 0, y: 0, w: s0.w, h: s0.h, z: ++z, framed: false, rotation: 0 });
        zoneItems.push({
          id: zoneImgs[1].id,
          x: stepX,
          y: stepY,
          w: s1.w,
          h: s1.h,
          z: ++z,
          framed: useFrame && !linkedPair && t >= 0.2,
          rotation: 0,
        });
        cursorY = Math.max(s0.h, stepY + s1.h);
        zoneMaxW = Math.max(zoneMaxW, stepX + s1.w);
      } else {
        // Featured Lead Image on left + stacked satellites on right (true mini-Bento!)
        const lead = zoneImgs[0];
        const rest = zoneImgs.slice(1);
        const leadSize = sizeImagePreservingRatio(lead, 316, 320);
        zoneItems.push({
          id: lead.id,
          x: 0,
          y: 0,
          w: leadSize.w,
          h: leadSize.h,
          z: ++z,
          framed: false,
          rotation: 0,
        });
        const sideX = leadSize.w + imgGap;
        const sideW = 216;
        let sideY = 0;
        let leftY = leadSize.h + imgGap;

        rest.forEach((img, idx) => {
          const placeOnRight = idx < 2 || sideY <= leftY;
          const colW = placeOnRight ? sideW : leadSize.w;
          const colX = placeOnRight ? sideX : 0;
          const { w, h } = sizeImagePreservingRatio(img, colW, 230);
          const y = placeOnRight ? sideY : leftY;
          zoneItems.push({
            id: img.id,
            x: colX,
            y,
            w,
            h,
            z: ++z,
            framed: useFrame && idx === 0 && t > 0.35,
            rotation: 0,
          });
          if (placeOnRight) {
            sideY += h + imgGap;
          } else {
            leftY += h + imgGap;
          }
        });
        cursorY = Math.max(leftY, sideY) - imgGap;
        zoneMaxW = Math.max(zoneMaxW, sideX + sideW);
      }
    }

    // Layer 2: Compact Swatch Palette Strip
    if (zoneSwatches.length > 0) {
      const swStartY = cursorY === 0 ? 0 : cursorY + 16;
      const swCols = zoneSwatches.length <= 2 ? zoneSwatches.length : zoneSwatches.length <= 6 ? 3 : 4;
      const swW = 124;
      const swH = 80;
      const swGap = 10;
      zoneSwatches.forEach((sw, idx) => {
        const col = idx % swCols;
        const row = Math.floor(idx / swCols);
        zoneItems.push({
          id: sw.id,
          x: col * (swW + swGap),
          y: swStartY + row * (swH + swGap),
          w: swW,
          h: swH,
          z: ++z,
          rotation: 0,
        });
      });
      const rows = Math.ceil(zoneSwatches.length / swCols);
      cursorY = swStartY + rows * swH + (rows - 1) * swGap;
      zoneMaxW = Math.max(zoneMaxW, swCols * swW + (swCols - 1) * swGap);
    }

    // Layer 3: Notes, Files & Links cleanly fitted to zone width
    if (zoneEditorials.length > 0) {
      const edStartY = cursorY === 0 ? 0 : cursorY + 16;
      const targetGridW =
        zoneEditorials.length >= 6
          ? Math.max(zoneMaxW, 740)
          : zoneEditorials.length >= 3
            ? Math.max(zoneMaxW, 520)
            : Math.max(zoneMaxW, 316);
      const edGrid = layoutEditorialGrid(zoneEditorials, 0, edStartY, targetGridW, z + 2, adj);
      zoneItems.push(...edGrid.items);
      z += zoneEditorials.length + 4;
    }

    zoneBoxes.push(normalizeBox(zoneItems));
  }

  // Pack zones into 2 or 3 balanced Masonry columns
  const sortedZones = [...zoneBoxes].sort((a, b) => b.bounds.h - a.bounds.h);
  const gapX = 56;
  const gapY = 48;
  const numCols = sortedZones.length <= 1 ? 1 : sortedZones.length >= 5 ? 3 : 2;
  const colWidths = new Array<number>(numCols).fill(0);
  const colSlots: CompositionBox[][] = Array.from({ length: numCols }, () => []);
  const colHeights = new Array<number>(numCols).fill(0);

  for (const zb of sortedZones) {
    let bestCol = 0;
    for (let c = 1; c < numCols; c++) {
      if (colHeights[c] < colHeights[bestCol]) bestCol = c;
    }
    colSlots[bestCol].push(zb);
    colHeights[bestCol] += zb.bounds.h + gapY;
    colWidths[bestCol] = Math.max(colWidths[bestCol], zb.bounds.w);
  }

  const merged: PlacedCardPatch[] = [];
  let cursorX = 0;
  for (let c = 0; c < numCols; c++) {
    let cursorY = 0;
    for (const zb of colSlots[c]) {
      for (const it of zb.items) {
        merged.push({
          ...it,
          x: it.x + cursorX,
          y: it.y + cursorY,
        });
      }
      cursorY += zb.bounds.h + gapY;
    }
    cursorX += colWidths[c] + gapX;
  }

  return normalizeBox(merged);
}

/**
 * MODE 4: SWISS BRAND GUIDELINES GRID (`grid`)
 * - Visual-First Hierarchy: opens with a Hero Editorial Spread (Hero photo 62% + Lead Note & companion on right 38%),
 *   never burying visuals underneath two rows of empty notes!
 * - Justified flush image rows + full-width Color Palette divider bar + flush Spec/Notes footer.
 * - Always rotation = 0° for pure Swiss precision.
 */
function layoutSwissJustifiedGrid(
  cards: Card[],
  options: ArrangeOptions,
  baseZ: number
): CompositionBox {
  const seed = options.seed ?? 0;
  const targetAspect = getTargetAspect(options);
  const adj = buildConnectionGraph(cards);
  const { allImages, swatches, editorials } = partitionByDesignerRole(
    cards,
    options.groupByCategory,
    seed
  );
  const gap = 18;

  const buildSwissWithWidth = (masterW: number): CompositionBox => {
    const items: PlacedCardPatch[] = [];
    const placedPatchById = new Map<string, PlacedCardPatch>();
    let cursorY = 0;
    let z = baseZ;

    const pushPatch = (p: PlacedCardPatch) => {
      items.push(p);
      placedPatchById.set(p.id, p);
    };

    let remainingImages = [...allImages];
    let remainingSwatches = [...swatches];
    let remainingEditorials = [...editorials];

    // Helper: place any unplaced swatches/notes/files directly connected to the band we JUST placed
    // as a crisp flush Swiss Callout Strip directly beneath that band (aligned to partner X)!
    const placeConnectedCalloutStrip = (anchorIds: string[]): string[] => {
      if (adj.size === 0 || anchorIds.length === 0) return [];
      const anchorSet = new Set(anchorIds);
      const nonImgPool = [...remainingSwatches, ...remainingEditorials];
      const nonImgById = new Map(nonImgPool.map((c) => [c.id, c]));

      const picked: Card[] = [];
      const pickedSet = new Set<string>();
      const queue = [...anchorIds];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        const ns = adj.get(cur);
        if (!ns) continue;
        for (const nid of ns) {
          if (pickedSet.has(nid) || placedPatchById.has(nid)) continue;
          const cand = nonImgById.get(nid);
          if (cand) {
            pickedSet.add(nid);
            picked.push(cand);
            queue.push(nid);
          }
        }
      }
      if (picked.length === 0) return [];

      // Sort callouts left-to-right by the X-center of their connected card in the band above
      picked.sort((a, b) => {
        const targetX = (c: Card) => {
          const ns = adj.get(c.id);
          if (!ns) return masterW / 2;
          let sum = 0;
          let cnt = 0;
          for (const nid of ns) {
            const p = placedPatchById.get(nid);
            if (p && anchorSet.has(nid)) {
              sum += p.x + p.w / 2;
              cnt++;
            }
          }
          return cnt > 0 ? sum / cnt : masterW / 2;
        };
        const dx = targetX(a) - targetX(b);
        if (Math.abs(dx) > 4) return dx;
        return a.id.localeCompare(b.id);
      });

      const maxPerRow = Math.max(4, Math.min(8, Math.floor((masterW + gap) / 215)));
      const rowCount = Math.ceil(picked.length / maxPerRow);
      const perRow = Math.ceil(picked.length / rowCount);
      for (let i = 0; i < picked.length; i += perRow) {
        const slice = picked.slice(i, i + perRow);
        const count = slice.length;
        const cellW = Math.floor((masterW - gap * (count - 1)) / count);
        const rowH = Math.max(
          ...slice.map((c) => (c.kind === 'color' ? 84 : estimateEditorialCardHeight(c, cellW)))
        );
        let rx = 0;
        slice.forEach((c, idx) => {
          const w = idx === count - 1 ? Math.max(110, masterW - rx) : cellW;
          pushPatch({
            id: c.id,
            x: rx,
            y: cursorY,
            w,
            h: rowH,
            z: ++z,
            rotation: 0,
          });
          rx += w + gap;
        });
        cursorY += rowH + gap;
      }

      remainingSwatches = remainingSwatches.filter((c) => !pickedSet.has(c.id));
      remainingEditorials = remainingEditorials.filter((c) => !pickedSet.has(c.id));
      return picked.map((c) => c.id);
    };

    let lastBandIds: string[] = [];

    // Band 1: Visual-First Hero Editorial Spread (adapts cleanly to wide landscape frames!)
    if (remainingImages.length >= 1) {
      const hero = remainingImages[0];
      const heroNeighbors = adj.get(hero.id);
      const leadNote =
        remainingEditorials.find((e) => e.kind === 'note' && heroNeighbors?.has(e.id)) ??
        remainingEditorials.find((e) => e.kind === 'note');
      const leadNoteNeighbors = leadNote ? adj.get(leadNote.id) : undefined;
      const companionImg =
        remainingImages
          .slice(1)
          .find((img) => heroNeighbors?.has(img.id) || leadNoteNeighbors?.has(img.id)) ??
        (remainingImages.length >= 2 ? remainingImages[1] : undefined);

      if (leadNote) {
        const wideSpread = masterW >= 1320 && remainingImages.length >= 3;
        const heroW = wideSpread
          ? Math.min(Math.round((masterW - gap) * 0.48), 760)
          : Math.round((masterW - gap) * 0.62);
        const sideW = masterW - gap - heroW;
        const heroSize = sizeImagePreservingRatio(hero, heroW, wideSpread ? 372 : 384);
        const heroH = Math.max(248, heroSize.h);

        const heroLeft = seed % 2 === 0;
        const heroX = heroLeft ? 0 : sideW + gap;
        const sideX = heroLeft ? heroW + gap : 0;

        pushPatch({
          id: hero.id,
          x: heroX,
          y: cursorY,
          w: heroW,
          h: heroH,
          z: ++z,
          framed: false,
          rotation: 0,
        });

        const band1Ids = [hero.id, leadNote.id];
        const usedImgIds = new Set<string>([hero.id]);

        if (wideSpread && sideW >= 540) {
          // Split right side into 2 crisp Swiss architectural sub-columns matching exact heroH
          const subColA = Math.floor((sideW - gap) * 0.48);
          const subColB = sideW - gap - subColA;
          const noteEstH = estimateEditorialCardHeight(leadNote, subColA);

          if (companionImg && heroH - noteEstH - gap >= 112) {
            const noteH = Math.min(noteEstH, Math.round(heroH * 0.46));
            const compH = heroH - noteH - gap;
            pushPatch({
              id: leadNote.id,
              x: sideX,
              y: cursorY,
              w: subColA,
              h: noteH,
              z: ++z,
              rotation: 0,
            });
            pushPatch({
              id: companionImg.id,
              x: sideX,
              y: cursorY + noteH + gap,
              w: subColA,
              h: compH,
              z: ++z,
              framed: false,
              rotation: 0,
            });
            band1Ids.push(companionImg.id);
            usedImgIds.add(companionImg.id);
          } else {
            pushPatch({
              id: leadNote.id,
              x: sideX,
              y: cursorY,
              w: subColA,
              h: heroH,
              z: ++z,
              rotation: 0,
            });
          }

          // Fill sub-column B with 1 or 2 companion images (preferring images connected to Band 1!)
          const availB = remainingImages.filter((img) => !usedImgIds.has(img.id));
          const b1 =
            availB.find((img) => heroNeighbors?.has(img.id) || leadNoteNeighbors?.has(img.id)) ??
            availB[0];
          const b2 =
            availB.length >= 2
              ? availB.find(
                  (img) =>
                    img.id !== b1?.id &&
                    (heroNeighbors?.has(img.id) || (b1 && adj.get(b1.id)?.has(img.id)))
                ) ?? availB.find((img) => img.id !== b1?.id)
              : undefined;

          if (b1 && b2 && heroH >= 280) {
            const topH = Math.round((heroH - gap) * 0.5);
            const botH = heroH - gap - topH;
            pushPatch({
              id: b1.id,
              x: sideX + subColA + gap,
              y: cursorY,
              w: subColB,
              h: topH,
              z: ++z,
              framed: false,
              rotation: 0,
            });
            pushPatch({
              id: b2.id,
              x: sideX + subColA + gap,
              y: cursorY + topH + gap,
              w: subColB,
              h: botH,
              z: ++z,
              framed: false,
              rotation: 0,
            });
            band1Ids.push(b1.id, b2.id);
            usedImgIds.add(b1.id);
            usedImgIds.add(b2.id);
          } else if (b1) {
            pushPatch({
              id: b1.id,
              x: sideX + subColA + gap,
              y: cursorY,
              w: subColB,
              h: heroH,
              z: ++z,
              framed: false,
              rotation: 0,
            });
            band1Ids.push(b1.id);
            usedImgIds.add(b1.id);
          }
        } else {
          const noteEstH = estimateEditorialCardHeight(leadNote, sideW);
          if (companionImg && heroH - noteEstH - gap >= 112) {
            const noteH = Math.min(noteEstH, Math.round(heroH * 0.48));
            const compH = heroH - noteH - gap;
            pushPatch({
              id: leadNote.id,
              x: sideX,
              y: cursorY,
              w: sideW,
              h: noteH,
              z: ++z,
              rotation: 0,
            });
            pushPatch({
              id: companionImg.id,
              x: sideX,
              y: cursorY + noteH + gap,
              w: sideW,
              h: compH,
              z: ++z,
              framed: false,
              rotation: 0,
            });
            band1Ids.push(companionImg.id);
            usedImgIds.add(companionImg.id);
          } else {
            pushPatch({
              id: leadNote.id,
              x: sideX,
              y: cursorY,
              w: sideW,
              h: heroH,
              z: ++z,
              rotation: 0,
            });
          }
        }

        remainingImages = remainingImages.filter((img) => !usedImgIds.has(img.id));
        remainingEditorials = remainingEditorials.filter((e) => e.id !== leadNote.id);
        cursorY += heroH + gap;
        const calloutIds = placeConnectedCalloutStrip(band1Ids);
        lastBandIds = [...band1Ids, ...calloutIds];
      }
    }

    // Band 2: Justified Flush Image Rows + Inline Connected Callout Strips
    const basePerRow = Math.max(2, Math.min(9, Math.round(masterW / 295)));
    let rowPatternIdx = 0;
    let poolImages = orderKeepingConnectedAdjacent(remainingImages, adj);
    while (poolImages.length > 0) {
      // Bubble any image directly connected to `lastBandIds` to the front of the next row!
      if (adj.size > 0 && lastBandIds.length > 0) {
        const lastSet = new Set(lastBandIds);
        const linkedToPrev: Card[] = [];
        const others: Card[] = [];
        for (const img of poolImages) {
          const ns = adj.get(img.id);
          let touchesPrev = false;
          if (ns) {
            for (const nid of ns) {
              if (lastSet.has(nid)) {
                touchesPrev = true;
                break;
              }
            }
          }
          if (touchesPrev) linkedToPrev.push(img);
          else others.push(img);
        }
        if (linkedToPrev.length > 0) {
          poolImages = orderKeepingConnectedAdjacent([...linkedToPrev, ...others], adj);
        }
      }

      const remaining = poolImages.length;
      let targetCount =
        remaining <= basePerRow
          ? remaining
          : rowPatternIdx % 2 === 0
            ? basePerRow
            : Math.max(2, basePerRow - 1);

      // Avoid awkward 1-image orphan row on wide grids
      if (remaining - targetCount === 1 && targetCount >= 3) {
        targetCount = Math.ceil(remaining / 2);
      }

      // Avoid splitting a directly-connected image pair across row boundaries when we can flex ±1
      if (adj.size > 0 && targetCount < remaining) {
        const lastInRow = poolImages[targetCount - 1];
        const firstNextRow = poolImages[targetCount];
        if (adj.get(lastInRow.id)?.has(firstNextRow.id)) {
          if (targetCount < basePerRow + 1 && remaining - (targetCount + 1) !== 1) {
            targetCount++;
          } else if (targetCount > 2) {
            targetCount--;
          }
        }
      }

      const rowImgs = poolImages.slice(0, targetCount);
      poolImages = poolImages.slice(rowImgs.length);
      rowPatternIdx++;

      // Sort images within the row by their connected upper-band X coordinate to prevent crossing arrows
      if (adj.size > 0 && rowImgs.length >= 2) {
        rowImgs.sort((a, b) => {
          const upperX = (c: Card) => {
            const ns = adj.get(c.id);
            if (!ns) return Number.POSITIVE_INFINITY;
            let sum = 0;
            let cnt = 0;
            for (const nid of ns) {
              const p = placedPatchById.get(nid);
              if (p) {
                sum += p.x + p.w / 2;
                cnt++;
              }
            }
            return cnt > 0 ? sum / cnt : Number.POSITIVE_INFINITY;
          };
          const ax = upperX(a);
          const bx = upperX(b);
          if (ax !== bx) return ax - bx;
          return 0;
        });
      }

      const aspects = rowImgs.map((c) => getAspectRatio(c));
      const sumAspect = aspects.reduce((a, b) => a + b, 0);
      const availW = masterW - gap * (rowImgs.length - 1);
      const rowH = Math.max(156, Math.min(310, Math.round(availW / sumAspect)));

      let rowX = 0;
      const rowIds: string[] = [];
      rowImgs.forEach((c, i) => {
        const isLast = i === rowImgs.length - 1;
        const w = isLast
          ? Math.max(120, masterW - rowX)
          : Math.max(120, Math.round(rowH * aspects[i]));
        pushPatch({
          id: c.id,
          x: rowX,
          y: cursorY,
          w,
          h: rowH,
          z: ++z,
          framed: false,
          rotation: 0,
        });
        rowIds.push(c.id);
        rowX += w + gap;
      });
      cursorY += rowH + gap;

      const calloutIds = placeConnectedCalloutStrip(rowIds);
      lastBandIds = [...rowIds, ...calloutIds];
    }

    // Band 3: Full-Width Cohesive Color Palette Bar (balanced multi-row wrap so swatches stay crisp & wide!)
    if (remainingSwatches.length > 0) {
      const orderedSwatches =
        adj.size > 0
          ? orderKeepingConnectedAdjacent(remainingSwatches, adj)
          : remainingSwatches;

      const maxPerRow = Math.max(5, Math.min(12, Math.floor((masterW + gap) / 138)));
      const rowCount = Math.ceil(orderedSwatches.length / maxPerRow);
      const perRow = Math.ceil(orderedSwatches.length / rowCount);
      const swH = 92;

      for (let i = 0; i < orderedSwatches.length; i += perRow) {
        const slice = orderedSwatches.slice(i, i + perRow);
        const swW = Math.floor((masterW - gap * (slice.length - 1)) / slice.length);
        let rowX = 0;
        slice.forEach((sw, idx) => {
          const isLast = idx === slice.length - 1;
          const w = isLast ? Math.max(swW, masterW - rowX) : swW;
          pushPatch({
            id: sw.id,
            x: rowX,
            y: cursorY,
            w,
            h: swH,
            z: ++z,
            rotation: 0,
          });
          rowX += w + gap;
        });
        cursorY += swH + gap;
      }
    }

    // Band 4: Flush-Aligned Notes & Technical Files Footer
    if (remainingEditorials.length > 0) {
      const edGrid = layoutEditorialGrid(remainingEditorials, 0, cursorY, masterW, z, adj);
      items.push(...edGrid.items);
    }

    return normalizeBox(items);
  };

  // Search adaptive Swiss master widths so the final grid forms a balanced landscape presentation rectangle!
  const allWidths = [940, 1180, 1440, 1720, 2020, 2340, 2680, 3040, 3420];
  const maxSensibleW = Math.max(
    940,
    Math.min(3420, Math.round(Math.sqrt(cards.length * targetAspect) * 390))
  );
  const candidateWidths = allWidths.filter((w) => w <= maxSensibleW);
  if (candidateWidths.length === 0) candidateWidths.push(940);

  let bestBox: CompositionBox | null = null;
  let bestErr = Infinity;
  for (const w of candidateWidths) {
    const candidate = buildSwissWithWidth(w);
    const ratio = candidate.bounds.w / Math.max(1, candidate.bounds.h);
    const err = Math.abs(Math.log(ratio / targetAspect));
    if (err < bestErr) {
      bestErr = err;
      bestBox = candidate;
    }
  }

  return bestBox ?? buildSwissWithWidth(940);
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
    .map((c) => getCardRotatedAABB(c));

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
      mainBox = layoutSwissJustifiedGrid(looseCards, options, nextBaseZ);
    } else {
      mainBox = layoutArtDirectedCollage(looseCards, options, nextBaseZ);
    }
    boxes.push(mainBox);
    nextBaseZ += looseCards.length + 140;
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
        rotation: m.rotation,
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
      rotation: undefined,
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
