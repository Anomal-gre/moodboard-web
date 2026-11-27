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
  clampRadialCenter,
  describeRadialSectorPath,
  getRadialSectorCenter,
  hitTestRadialSector,
} = await vite.ssrLoadModule('/src/board/radialGeometry.ts');

test('hitTestRadialSector respects center deadzone and maps 6-sector & 8-sector clock directions accurately', () => {
  // Deadzone cancellation inside radius 30px
  assert.equal(hitTestRadialSector(500, 500, 500, 500, 6, 30), -1);
  assert.equal(hitTestRadialSector(518, 488, 500, 500, 6, 30), -1);

  // 6 sectors (Canvas wheel): 0=12h (Up), 1=2h, 2=4h, 3=6h (Down), 4=8h, 5=10h
  assert.equal(hitTestRadialSector(500, 420, 500, 500, 6, 30), 0); // Straight Up (12h)
  assert.equal(hitTestRadialSector(492, 420, 500, 500, 6, 30), 0); // Wrap-around slightly left of 12h
  assert.equal(hitTestRadialSector(570, 460, 500, 500, 6, 30), 1); // 2h
  assert.equal(hitTestRadialSector(570, 540, 500, 500, 6, 30), 2); // 4h
  assert.equal(hitTestRadialSector(500, 580, 500, 500, 6, 30), 3); // 6h (Down)
  assert.equal(hitTestRadialSector(430, 540, 500, 500, 6, 30), 4); // 8h
  assert.equal(hitTestRadialSector(430, 460, 500, 500, 6, 30), 5); // 10h

  // 8 sectors (Image wheel): 0=12h, 2=3h (Right), 4=6h (Down), 6=9h (Left)
  assert.equal(hitTestRadialSector(500, 410, 500, 500, 8, 30), 0);
  assert.equal(hitTestRadialSector(590, 500, 500, 500, 8, 30), 2);
  assert.equal(hitTestRadialSector(500, 590, 500, 500, 8, 30), 4);
  assert.equal(hitTestRadialSector(410, 500, 500, 500, 8, 30), 6);
});

test('clampRadialCenter keeps the full wheel inside viewport edges', () => {
  const topLeft = clampRadialCenter(10, 12, 1440, 900, 136, 20);
  assert.equal(topLeft.x, 156);
  assert.equal(topLeft.y, 156);

  const botRight = clampRadialCenter(1435, 895, 1440, 900, 136, 20);
  assert.equal(botRight.x, 1284);
  assert.equal(botRight.y, 744);

  const middle = clampRadialCenter(720, 450, 1440, 900, 136, 20);
  assert.deepEqual(middle, { x: 720, y: 450 });
});

test('describeRadialSectorPath and getRadialSectorCenter return valid SVG geometry', () => {
  const path = describeRadialSectorPath(148, 148, 52, 136, 0, 8, 2.2);
  assert.ok(path.startsWith('M ') && path.endsWith(' Z'));
  assert.ok(path.includes('A 136 136') && path.includes('A 52 52'));

  const topPt = getRadialSectorCenter(148, 148, 95, 0, 6);
  assert.ok(Math.abs(topPt.x - 148) < 0.01);
  assert.ok(Math.abs(topPt.y - 53) < 0.01);
});
