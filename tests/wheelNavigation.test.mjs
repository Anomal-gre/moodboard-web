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

const { classifyWheelEvent, createWheelGestureState } = await vite.ssrLoadModule(
  '/src/board/wheelNavigation.ts'
);

test('auto mode pans in 2D on Windows/macOS touchpad 2-finger scroll and locks momentum inertia', () => {
  const state = createWheelGestureState();
  // Smooth diagonal touchpad gesture
  const a = classifyWheelEvent(
    { deltaX: 12, deltaY: 18.5, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, timestamp: 100 },
    'auto',
    state
  );
  assert.deepEqual(a, { type: 'pan', dx: 12, dy: 18.5 });

  // Fast vertical follow-up frame within 320ms sticky window stays locked to pan (even if deltaY hits 100!)
  const b = classifyWheelEvent(
    { deltaX: 0, deltaY: 100, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, timestamp: 140 },
    'auto',
    state
  );
  assert.deepEqual(b, { type: 'pan', dx: 0, dy: 100 });
});

test('touchpad pinch-to-zoom (ctrlKey + small pixel delta) zooms responsively and prevents lift-off jump', () => {
  const state = createWheelGestureState();
  const pinchOut = classifyWheelEvent(
    { deltaX: 0, deltaY: -8, deltaMode: 0, ctrlKey: true, metaKey: false, shiftKey: false, timestamp: 500 },
    'auto',
    state
  );
  assert.equal(pinchOut.type, 'zoom');
  assert.ok(pinchOut.zoomFactor > 1.05 && pinchOut.zoomFactor < 1.15);

  // Stray non-ctrl event 40ms after pinch lift-off is suppressed
  const stray = classifyWheelEvent(
    { deltaX: 0, deltaY: 14, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, timestamp: 540 },
    'auto',
    state
  );
  assert.deepEqual(stray, { type: 'none' });
});

test('auto mode keeps discrete stepped mouse wheel (deltaY = 100/120, deltaX = 0) as cursor-anchored zoom', () => {
  const state = createWheelGestureState();
  const wheelUp = classifyWheelEvent(
    { deltaX: 0, deltaY: -100, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, timestamp: 1000 },
    'auto',
    state
  );
  assert.equal(wheelUp.type, 'zoom');
  assert.ok(wheelUp.zoomFactor > 1.1);
});

test('explicit trackpad mode always pans on bare scroll, while explicit mouse mode always zooms', () => {
  const tpState = createWheelGestureState();
  const tpPan = classifyWheelEvent(
    { deltaX: 0, deltaY: 120, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, timestamp: 100 },
    'trackpad',
    tpState
  );
  assert.deepEqual(tpPan, { type: 'pan', dx: 0, dy: 120 });

  const mouseState = createWheelGestureState();
  const mouseZoom = classifyWheelEvent(
    { deltaX: 0, deltaY: -16, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, timestamp: 100 },
    'mouse',
    mouseState
  );
  assert.equal(mouseZoom.type, 'zoom');
  assert.ok(mouseZoom.zoomFactor > 1);
});
