export interface CutoutInboundMessage {
  type: 'cutout';
  requestId: string;
  width: number;
  height: number;
  rgbaBuffer: ArrayBuffer;
}

export type CutoutOutboundMessage =
  | {
      type: 'done';
      requestId: string;
      width: number;
      height: number;
      rgbaBuffer: ArrayBuffer;
    }
  | {
      type: 'error';
      requestId: string;
      reason: string;
    };

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  let sr = r / 255;
  let sg = g / 255;
  let sb = b / 255;
  sr = sr > 0.04045 ? Math.pow((sr + 0.055) / 1.055, 2.4) : sr / 12.92;
  sg = sg > 0.04045 ? Math.pow((sg + 0.055) / 1.055, 2.4) : sg / 12.92;
  sb = sb > 0.04045 ? Math.pow((sb + 0.055) / 1.055, 2.4) : sb / 12.92;

  const x = (sr * 0.4124 + sg * 0.3576 + sb * 0.1805) / 0.95047;
  const y = (sr * 0.2126 + sg * 0.7152 + sb * 0.0722) / 1.0;
  const z = (sr * 0.0193 + sg * 0.1192 + sb * 0.9505) / 1.08883;

  const fx = x > 0.008856 ? Math.cbrt(x) : 7.787 * x + 16 / 116;
  const fy = y > 0.008856 ? Math.cbrt(y) : 7.787 * y + 16 / 116;
  const fz = z > 0.008856 ? Math.cbrt(z) : 7.787 * z + 16 / 116;

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/**
 * Edge-aware CIE-Lab Multi-Seed Salient Subject Cutout Worker:
 * 1. Converts image pixels to perceptual CIE-Lab space + computes Sobel gradient energy.
 * 2. Samples perimeter clusters (top, left, right, bottom borders) to model studio/room backdrop.
 * 3. Runs priority flood-fill from border seeds with gradient barrier protection so interior furniture
 *    edges are never eaten into.
 * 4. Applies soft morphological alpha feathering for crisp anti-aliased cutouts.
 */
self.onmessage = (event: MessageEvent<CutoutInboundMessage>) => {
  const msg = event.data;
  if (msg.type !== 'cutout') return;
  const { requestId, width: w, height: h, rgbaBuffer } = msg;

  try {
    const data = new Uint8ClampedArray(rgbaBuffer);
    const total = w * h;
    const L = new Float32Array(total);
    const A = new Float32Array(total);
    const B = new Float32Array(total);

    for (let i = 0; i < total; i++) {
      const idx = i * 4;
      const [l, a, b] = rgbToLab(data[idx], data[idx + 1], data[idx + 2]);
      L[i] = l;
      A[i] = a;
      B[i] = b;
    }

    // Compute Sobel gradient magnitude on L+A+B
    const grad = new Float32Array(total);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gxL = -L[i - w - 1] + L[i - w + 1] - 2 * L[i - 1] + 2 * L[i + 1] - L[i + w - 1] + L[i + w + 1];
        const gyL = -L[i - w - 1] - 2 * L[i - w] - L[i - w + 1] + L[i + w - 1] + 2 * L[i + w] + L[i + w + 1];
        const gxA = -A[i - 1] + A[i + 1];
        const gyA = -A[i - w] + A[i + w];
        const gxB = -B[i - 1] + B[i + 1];
        const gyB = -B[i - w] + B[i + w];
        grad[i] = Math.hypot(gxL, gyL) * 0.25 + Math.hypot(gxA, gyA) * 0.4 + Math.hypot(gxB, gyB) * 0.4;
      }
    }

    // Collect border seeds around outer margin (excluding bottom center where furniture legs touch floor)
    const borderSamples: Array<[number, number, number]> = [];
    const queue = new Int32Array(total);
    const visited = new Uint8Array(total);
    const bgScore = new Float32Array(total); // 1 = background, 0 = foreground
    let qHead = 0;
    let qTail = 0;

    const pushSeed = (x: number, y: number) => {
      const idx = y * w + x;
      if (visited[idx]) return;
      visited[idx] = 1;
      bgScore[idx] = 1;
      queue[qTail++] = idx;
      borderSamples.push([L[idx], A[idx], B[idx]]);
    };

    const step = Math.max(1, Math.floor(Math.min(w, h) / 48));
    for (let x = 0; x < w; x += 1) {
      pushSeed(x, 0);
      if (x < w * 0.24 || x > w * 0.76) {
        pushSeed(x, h - 1);
      }
    }
    for (let y = 1; y < h - 1; y += 1) {
      pushSeed(0, y);
      pushSeed(w - 1, y);
    }

    // Cluster border samples into up to 6 representative background centroids
    const centroids: Array<[number, number, number]> = [];
    for (let i = 0; i < borderSamples.length; i += step) {
      const s = borderSamples[i];
      const near = centroids.some(
        (c) => Math.hypot(c[0] - s[0], c[1] - s[1], c[2] - s[2]) < 14
      );
      if (!near) {
        centroids.push(s);
        if (centroids.length >= 8) break;
      }
    }

    const minCentroidDist = (idx: number): number => {
      const l = L[idx];
      const a = A[idx];
      const b = B[idx];
      let best = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = Math.hypot(l - centroids[c][0], (a - centroids[c][1]) * 1.25, (b - centroids[c][2]) * 1.25);
        if (d < best) best = d;
      }
      return best;
    };

    const cx = w * 0.5;
    const cy = h * 0.54;
    const maxR = Math.hypot(cx, cy);

    // Region-growing flood fill from perimeter with local neighbor continuity + centroid affinity
    const neighbors = [-1, 1, -w, w];
    while (qHead < qTail) {
      const curr = queue[qHead++];
      const cl = L[curr];
      const ca = A[curr];
      const cb = B[curr];
      const x = curr % w;
      const y = (curr - x) / w;

      for (let k = 0; k < 4; k++) {
        const nxt = curr + neighbors[k];
        if (nxt < 0 || nxt >= total || visited[nxt]) continue;
        const nx = nxt % w;
        if (Math.abs(nx - x) > 1) continue;
        const ny = (nxt - nx) / w;

        const localDiff = Math.hypot(L[nxt] - cl, (A[nxt] - ca) * 1.25, (B[nxt] - cb) * 1.25);
        const globalDiff = minCentroidDist(nxt);
        const edgeStrength = grad[nxt];

        // Protect inner core more strictly than outer margins so light furniture cushions stay intact
        const centerRatio = Math.hypot(nx - cx, ny - cy) / maxR;
        const globalThresh = 10.5 + centerRatio * 8.5;
        const localThresh = 3.8 + centerRatio * 2.6;
        const edgeLimit = centerRatio < 0.42 ? 6.5 : 11.5;

        if (edgeStrength < edgeLimit && localDiff <= localThresh && globalDiff <= globalThresh) {
          visited[nxt] = 1;
          bgScore[nxt] = 1;
          queue[qTail++] = nxt;
        }
      }
    }

    // Soft 2-pass alpha feathering along the foreground/background boundary
    const alpha = new Float32Array(total);
    for (let i = 0; i < total; i++) {
      alpha[i] = 1 - bgScore[i];
    }

    const smoothed = new Float32Array(total);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const sum =
          alpha[i] * 4 +
          (alpha[i - 1] + alpha[i + 1] + alpha[i - w] + alpha[i + w]) * 2 +
          (alpha[i - w - 1] + alpha[i - w + 1] + alpha[i + w - 1] + alpha[i + w + 1]);
        let aVal = sum / 16;
        // S-curve contrast on alpha edge for crisp anti-aliased contour
        if (aVal > 0.12 && aVal < 0.88) {
          const cDist = minCentroidDist(i);
          if (cDist < 16) aVal *= 0.45;
        }
        smoothed[i] = aVal < 0.08 ? 0 : aVal > 0.92 ? 1 : aVal;
      }
    }

    for (let i = 0; i < total; i++) {
      data[i * 4 + 3] = Math.round(smoothed[i] * 255);
    }

    self.postMessage(
      {
        type: 'done',
        requestId,
        width: w,
        height: h,
        rgbaBuffer: data.buffer,
      } satisfies CutoutOutboundMessage,
      [data.buffer]
    );
  } catch (err) {
    self.postMessage({
      type: 'error',
      requestId,
      reason: err instanceof Error ? err.message : 'Cutout error',
    } satisfies CutoutOutboundMessage);
  }
};
