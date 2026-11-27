/**
 * Pure polar-coordinate geometry helpers for Mosa's Context-Aware Radial Wheel Menu.
 * Sector 0 is always centered straight UP (12 o'clock = -90 deg), proceeding clockwise.
 */

export interface RadialPoint {
  x: number;
  y: number;
}

export function clampRadialCenter(
  screenX: number,
  screenY: number,
  viewportW: number,
  viewportH: number,
  outerRadius: number,
  pad = 22
): RadialPoint {
  const margin = outerRadius + pad;
  const minX = Math.min(margin, viewportW / 2);
  const maxX = Math.max(minX, viewportW - margin);
  const minY = Math.min(margin, viewportH / 2);
  const maxY = Math.max(minY, viewportH - margin);
  return {
    x: Math.round(Math.max(minX, Math.min(maxX, screenX))),
    y: Math.round(Math.max(minY, Math.min(maxY, screenY))),
  };
}

/**
 * Hit-tests a screen pointer against `sectorCount` equal pie sectors centered at (cx, cy).
 * Returns -1 when pointer is inside the neutral center deadzone.
 * Sector 0 is centered at 12 o'clock (-90°), proceeding clockwise.
 */
export function hitTestRadialSector(
  cursorX: number,
  cursorY: number,
  cx: number,
  cy: number,
  sectorCount: number,
  deadzonePx = 30
): number {
  if (sectorCount <= 0) return -1;
  const dx = cursorX - cx;
  const dy = cursorY - cy;
  const dist = Math.hypot(dx, dy);
  if (dist < deadzonePx) return -1;

  const stepDeg = 360 / sectorCount;
  // Angle in degrees where 0° = 12 o'clock (-Y axis), increasing clockwise [0, 360)
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  if (deg < 0) deg += 360;
  // Shift by half a sector so sector 0 spans [-step/2, +step/2] around 12 o'clock
  const shifted = (deg + stepDeg / 2) % 360;
  return Math.floor(shifted / stepDeg) % sectorCount;
}

function polarToCartesian(cx: number, cy: number, r: number, clockDeg: number): RadialPoint {
  const rad = ((clockDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

/**
 * Generates an SVG annular wedge path for sector `index` out of `count`,
 * with an optional angular gap (in degrees) between adjacent wedges.
 */
export function describeRadialSectorPath(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  index: number,
  count: number,
  gapDeg = 2.4
): string {
  const step = 360 / Math.max(1, count);
  const centerDeg = index * step;
  const half = Math.max(1, step / 2 - gapDeg / 2);
  const startDeg = centerDeg - half;
  const endDeg = centerDeg + half;

  const pOuterStart = polarToCartesian(cx, cy, outerR, startDeg);
  const pOuterEnd = polarToCartesian(cx, cy, outerR, endDeg);
  const pInnerEnd = polarToCartesian(cx, cy, innerR, endDeg);
  const pInnerStart = polarToCartesian(cx, cy, innerR, startDeg);

  const largeArc = endDeg - startDeg > 180 ? 1 : 0;

  return [
    `M ${pOuterStart.x.toFixed(2)} ${pOuterStart.y.toFixed(2)}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${pOuterEnd.x.toFixed(2)} ${pOuterEnd.y.toFixed(2)}`,
    `L ${pInnerEnd.x.toFixed(2)} ${pInnerEnd.y.toFixed(2)}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${pInnerStart.x.toFixed(2)} ${pInnerStart.y.toFixed(2)}`,
    'Z',
  ].join(' ');
}

export function getRadialSectorCenter(
  cx: number,
  cy: number,
  midR: number,
  index: number,
  count: number
): RadialPoint {
  const step = 360 / Math.max(1, count);
  return polarToCartesian(cx, cy, midR, index * step);
}
