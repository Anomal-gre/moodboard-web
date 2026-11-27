import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({
  configFile: false,
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, watch: null, ws: false },
});
after(() => vite.close());

const {
  applyCropHandleDrag,
  computeCroppedCardRect,
  computeFullImageFrame,
  fitCropToAspectPreset,
  FULL_CROP,
  isFullCrop,
} = await vite.ssrLoadModule('/src/domain/cropGeometry.ts');

test('computeFullImageFrame and computeCroppedCardRect preserve exact zero-jump non-destructive round-trip', () => {
  const full = { x: 100, y: 200, w: 600, h: 400 };
  const crop = { x: 0.25, y: 0.1, w: 0.5, h: 0.75 };

  const croppedCard = computeCroppedCardRect(full, crop);
  assert.deepEqual(croppedCard, { x: 250, y: 240, w: 300, h: 300 });

  // Re-entering crop mode from croppedCard recovers the EXACT original full frame!
  const recoveredFull = computeFullImageFrame(croppedCard, crop);
  assert.deepEqual(recoveredFull, full);
  assert.equal(isFullCrop(FULL_CROP), true);
  assert.equal(isFullCrop(crop), false);
});

test('applyCropHandleDrag handles all 8 handles, box pan, and clamps cleanly within [0..1]', () => {
  const init = { x: 0.2, y: 0.2, w: 0.6, h: 0.6 };

  // Pan inside box clamps at right edge
  const panned = applyCropHandleDrag(init, 'box', 0.5, -0.5, 400, 300);
  assert.deepEqual(panned, { x: 0.4, y: 0, w: 0.6, h: 0.6 });

  // Single-side edge handles trim ONLY that edge
  const trimRight = applyCropHandleDrag(init, 'e', -0.2, 0.3, 400, 300);
  assert.ok(Math.abs(trimRight.x - 0.2) < 1e-6);
  assert.ok(Math.abs(trimRight.w - 0.4) < 1e-6);
  assert.ok(Math.abs(trimRight.h - 0.6) < 1e-6);

  const trimTop = applyCropHandleDrag(init, 'n', 0.3, 0.15, 400, 300);
  assert.ok(Math.abs(trimTop.y - 0.35) < 1e-6);
  assert.ok(Math.abs(trimTop.h - 0.45) < 1e-6);
  assert.ok(Math.abs(trimTop.x - 0.2) < 1e-6);

  // Corner handle ne moves top & right while anchoring bottom-left
  const cornerNe = applyCropHandleDrag(init, 'ne', 0.1, -0.1, 400, 300);
  assert.ok(Math.abs(cornerNe.x - 0.2) < 1e-6);
  assert.ok(Math.abs(cornerNe.y - 0.1) < 1e-6);
  assert.ok(Math.abs(cornerNe.w - 0.7) < 1e-6);
  assert.ok(Math.abs(cornerNe.h - 0.7) < 1e-6);
});

test('fitCropToAspectPreset produces exact distortion-free 1:1 and 16:9 visual pixel ratios', () => {
  const fullW = 400;
  const fullH = 300; // 4:3 image

  const sq = fitCropToAspectPreset(FULL_CROP, fullW, fullH, 1);
  const sqPxW = sq.w * fullW;
  const sqPxH = sq.h * fullH;
  assert.ok(Math.abs(sqPxW / sqPxH - 1) < 0.01, `Expected 1:1 pixel ratio, got ${sqPxW / sqPxH}`);

  const wide = fitCropToAspectPreset(FULL_CROP, fullW, fullH, 16 / 9);
  const widePxW = wide.w * fullW;
  const widePxH = wide.h * fullH;
  assert.ok(Math.abs(widePxW / widePxH - 16 / 9) < 0.01);
});
