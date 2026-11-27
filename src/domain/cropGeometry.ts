/**
 * Figma / Photoshop-grade Non-Destructive Image Crop Geometry Engine.
 * - Keeps full original image anchored in world space while cropping (zero visual jump).
 * - Resizes card frame cleanly to cropped rectangle on commit (zero image stretching/distortion).
 * - Supports all 8 handles (nw, ne, sw, se, n, s, e, w) + pan-inside + aspect ratio presets & Shift lock.
 */

import type { Rect } from './geometry';

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type CropHandle = 'box' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };
export const MIN_CROP_SIZE = 0.08;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function isFullCrop(crop?: CropRect | null): boolean {
  if (!crop) return true;
  return crop.x <= 0.004 && crop.y <= 0.004 && crop.w >= 0.992 && crop.h >= 0.992;
}

/**
 * Given a card's current canvas rect and its active crop, computes the world-space
 * rectangle of the full uncropped image so entering crop mode keeps the visible pixels
 * anchored in exact place (just like Figma & Illustrator).
 */
export function computeFullImageFrame(cardRect: Rect, crop?: CropRect): Rect {
  if (!crop || isFullCrop(crop)) {
    return { x: cardRect.x, y: cardRect.y, w: cardRect.w, h: cardRect.h };
  }
  const safeW = Math.max(MIN_CROP_SIZE, Math.min(1, crop.w));
  const safeH = Math.max(MIN_CROP_SIZE, Math.min(1, crop.h));
  const fullW = cardRect.w / safeW;
  const fullH = cardRect.h / safeH;
  return {
    x: cardRect.x - crop.x * fullW,
    y: cardRect.y - crop.y * fullH,
    w: fullW,
    h: fullH,
  };
}

/**
 * Given the full uncropped image frame and a chosen crop rect, computes the exact
 * distortion-free canvas card rect matching the cropped region.
 */
export function computeCroppedCardRect(fullFrame: Rect, crop: CropRect): Rect {
  return {
    x: Math.round(fullFrame.x + crop.x * fullFrame.w),
    y: Math.round(fullFrame.y + crop.y * fullFrame.h),
    w: Math.max(48, Math.round(crop.w * fullFrame.w)),
    h: Math.max(48, Math.round(crop.h * fullFrame.h)),
  };
}

/**
 * Applies a normalized drag delta (dxNorm, dyNorm in full-image [0..1] coordinates)
 * to any of the 8 crop handles or 'box' pan, optionally locking the visual aspect ratio
 * (`targetPixelAspect = desiredWidth / desiredHeight` in world pixels).
 */
export function applyCropHandleDrag(
  init: CropRect,
  handle: CropHandle,
  dxNorm: number,
  dyNorm: number,
  fullW: number,
  fullH: number,
  lockPixelAspect?: number | null
): CropRect {
  if (handle === 'box') {
    return {
      x: clamp(init.x + dxNorm, 0, 1 - init.w),
      y: clamp(init.y + dyNorm, 0, 1 - init.h),
      w: init.w,
      h: init.h,
    };
  }

  let left = init.x;
  let right = init.x + init.w;
  let top = init.y;
  let bottom = init.y + init.h;

  if (handle.includes('w')) {
    left = clamp(init.x + dxNorm, 0, right - MIN_CROP_SIZE);
  }
  if (handle.includes('e')) {
    right = clamp(init.x + init.w + dxNorm, left + MIN_CROP_SIZE, 1);
  }
  if (handle.includes('n')) {
    top = clamp(init.y + dyNorm, 0, bottom - MIN_CROP_SIZE);
  }
  if (handle.includes('s')) {
    bottom = clamp(init.y + init.h + dyNorm, top + MIN_CROP_SIZE, 1);
  }

  // Enforce locked aspect ratio on corner drags (or when preset ratio is active)
  if (lockPixelAspect && lockPixelAspect > 0 && fullW > 0 && fullH > 0) {
    // Visual ratio: (w * fullW) / (h * fullH) = lockPixelAspect => w / h = normRatio
    const normRatio = (lockPixelAspect * fullH) / fullW;
    const anchorRight = handle.includes('w') && !handle.includes('e');
    const anchorBottom = handle.includes('n') && !handle.includes('s');

    let w = right - left;
    let h = bottom - top;

    if (handle === 'n' || handle === 's') {
      w = h * normRatio;
      const cx = (left + right) / 2;
      left = cx - w / 2;
      right = cx + w / 2;
      if (left < 0) {
        right = Math.min(1, right - left);
        left = 0;
      }
      if (right > 1) {
        left = Math.max(0, left - (right - 1));
        right = 1;
      }
      w = right - left;
      h = w / normRatio;
      if (anchorBottom) top = Math.max(0, bottom - h);
      else bottom = Math.min(1, top + h);
    } else if (handle === 'e' || handle === 'w') {
      h = w / normRatio;
      const cy = (top + bottom) / 2;
      top = cy - h / 2;
      bottom = cy + h / 2;
      if (top < 0) {
        bottom = Math.min(1, bottom - top);
        top = 0;
      }
      if (bottom > 1) {
        top = Math.max(0, top - (bottom - 1));
        bottom = 1;
      }
      h = bottom - top;
      w = h * normRatio;
      if (anchorRight) left = Math.max(0, right - w);
      else right = Math.min(1, left + w);
    } else {
      // Corner drag: choose dominant axis & clamp within [0..1] bounds cleanly
      const candH = w / normRatio;
      const candW = h * normRatio;
      if (Math.abs(dxNorm) >= Math.abs(dyNorm)) {
        h = candH;
      } else {
        w = candW;
      }

      const maxW = anchorRight ? right : 1 - left;
      const maxH = anchorBottom ? bottom : 1 - top;
      if (w > maxW) {
        w = maxW;
        h = w / normRatio;
      }
      if (h > maxH) {
        h = maxH;
        w = h * normRatio;
      }
      if (w < MIN_CROP_SIZE) {
        w = MIN_CROP_SIZE;
        h = w / normRatio;
      }
      if (h < MIN_CROP_SIZE) {
        h = MIN_CROP_SIZE;
        w = h * normRatio;
      }

      if (anchorRight) left = right - w;
      else right = left + w;
      if (anchorBottom) top = bottom - h;
      else bottom = top + h;
    }
  }

  return {
    x: clamp(left, 0, 1 - MIN_CROP_SIZE),
    y: clamp(top, 0, 1 - MIN_CROP_SIZE),
    w: clamp(right - left, MIN_CROP_SIZE, 1),
    h: clamp(bottom - top, MIN_CROP_SIZE, 1),
  };
}

/**
 * Fits a centered crop rectangle with the requested pixel aspect ratio inside the full image
 * (keeping the center close to the current crop's center).
 */
export function fitCropToAspectPreset(
  current: CropRect,
  fullW: number,
  fullH: number,
  targetPixelAspect: number
): CropRect {
  if (fullW <= 0 || fullH <= 0 || targetPixelAspect <= 0) return current;
  const normRatio = (targetPixelAspect * fullH) / fullW;

  // Maximize inside current crop bounds first, or expand to full image if needed
  let w = 1;
  let h = w / normRatio;
  if (h > 1) {
    h = 1;
    w = h * normRatio;
  }
  const cx = current.x + current.w / 2;
  const cy = current.y + current.h / 2;
  const x = clamp(cx - w / 2, 0, 1 - w);
  const y = clamp(cy - h / 2, 0, 1 - h);
  return { x, y, w, h };
}
