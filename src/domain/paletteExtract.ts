/**
 * Fast client-side dominant palette extractor & 60-30-10 interior harmony generator
 * using Canvas 2D quantization.
 */
export async function extractPaletteFromBlob(
  blob: Blob,
  count = 3
): Promise<Array<{ hex: string; name: string }>> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Image load failed'));
      el.src = url;
    });

    const size = 48;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    const buckets = new Map<string, { r: number; g: number; b: number; n: number }>();
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 180) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
      const prev = buckets.get(key);
      if (prev) {
        prev.r += r;
        prev.g += g;
        prev.b += b;
        prev.n += 1;
      } else {
        buckets.set(key, { r, g, b, n: 1 });
      }
    }

    const sorted = [...buckets.values()]
      .map((b) => ({
        r: Math.round(b.r / b.n),
        g: Math.round(b.g / b.n),
        b: Math.round(b.b / b.n),
        n: b.n,
      }))
      .sort((a, b) => b.n - a.n);

    const chosen: Array<{ r: number; g: number; b: number }> = [];
    for (const candidate of sorted) {
      const distinct = chosen.every((c) => {
        const dr = c.r - candidate.r;
        const dg = c.g - candidate.g;
        const db = c.b - candidate.b;
        return Math.sqrt(dr * dr + dg * dg + db * db) > 52;
      });
      if (distinct) {
        chosen.push(candidate);
        if (chosen.length >= count) break;
      }
    }

    if (chosen.length === 0 && sorted[0]) {
      chosen.push(sorted[0]);
    }

    return chosen.map((c, idx) => {
      const hex = `#${[c.r, c.g, c.b]
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()}`;
      return { hex, name: `Tone ${idx + 1}` };
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function extractDominantHexFromBlob(blob: Blob): Promise<string | undefined> {
  try {
    const res = await extractPaletteFromBlob(blob, 1);
    return res[0]?.hex;
  } catch {
    return undefined;
  }
}

/**
 * Interior Design 60-30-10 Color Rule Generator across all board images:
 * - 60% Dominant foundation tones (2 swatches)
 * - 30% Secondary material tones (2 swatches)
 * - 10% Accent focal tone (1 high-chroma/contrast swatch)
 */
export async function extractBoard60_30_10Palette(
  blobs: Blob[],
  roleLabels: { role60: string; role30: string; role10: string }
): Promise<Array<{ hex: string; name: string }>> {
  const globalBuckets = new Map<string, { r: number; g: number; b: number; n: number }>();

  for (const blob of blobs) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Image load failed'));
        el.src = url;
      });
      const size = 36;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.drawImage(img, 0, 0, size, size);
      const { data } = ctx.getImageData(0, 0, size, size);

      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 180) continue;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
        const prev = globalBuckets.get(key);
        if (prev) {
          prev.r += r;
          prev.g += g;
          prev.b += b;
          prev.n += 1;
        } else {
          globalBuckets.set(key, { r, g, b, n: 1 });
        }
      }
    } catch {
      // skip unreadable blob
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const sorted = [...globalBuckets.values()]
    .map((b) => {
      const r = Math.round(b.r / b.n);
      const g = Math.round(b.g / b.n);
      const bl = Math.round(b.b / b.n);
      const maxC = Math.max(r, g, bl);
      const minC = Math.min(r, g, bl);
      const chroma = maxC - minC;
      return { r, g, b: bl, n: b.n, chroma };
    })
    .sort((a, b) => b.n - a.n);

  const chosen: Array<{ r: number; g: number; b: number; chroma: number }> = [];
  for (const cand of sorted) {
    const distinct = chosen.every(
      (c) => Math.hypot(c.r - cand.r, c.g - cand.g, c.b - cand.b) > 48
    );
    if (distinct) {
      chosen.push(cand);
      if (chosen.length >= 4) break;
    }
  }

  // Pick 5th swatch as a richer accent tone (highest chroma * sqrt(count) that is distinct)
  const accentCandidates = [...sorted].sort(
    (a, b) => b.chroma * Math.sqrt(b.n) - a.chroma * Math.sqrt(a.n)
  );
  for (const cand of accentCandidates) {
    const distinct = chosen.every(
      (c) => Math.hypot(c.r - cand.r, c.g - cand.g, c.b - cand.b) > 50
    );
    if (distinct) {
      chosen.push(cand);
      break;
    }
  }

  const roles = [
    `${roleLabels.role60} · 01`,
    `${roleLabels.role60} · 02`,
    `${roleLabels.role30} · 01`,
    `${roleLabels.role30} · 02`,
    roleLabels.role10,
  ];

  return chosen.slice(0, 5).map((c, idx) => {
    const hex = `#${[c.r, c.g, c.b]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()}`;
    return { hex, name: roles[idx] ?? `Tone ${idx + 1}` };
  });
}

export function hexColorDistance(hexA?: string, hexB?: string): number {
  if (!hexA || !hexB) return 999;
  const a = hexA.replace('#', '');
  const b = hexB.replace('#', '');
  if (a.length !== 6 || b.length !== 6) return 999;
  const r1 = parseInt(a.slice(0, 2), 16) || 0;
  const g1 = parseInt(a.slice(2, 4), 16) || 0;
  const b1 = parseInt(a.slice(4, 6), 16) || 0;
  const r2 = parseInt(b.slice(0, 2), 16) || 0;
  const g2 = parseInt(b.slice(2, 4), 16) || 0;
  const b2 = parseInt(b.slice(4, 6), 16) || 0;
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}
