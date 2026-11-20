export const MAX_IMAGE_FILE_BYTES = 30 * 1024 * 1024; // 30 MB
export const THUMBNAIL_MAX_EDGE = 1120;
export const INFERENCE_MAX_EDGE = 512;

export interface DecodedImageInfo {
  width: number;
  height: number;
  thumbnail: Blob;
  digest: string;
}

export async function computeBlobDigest(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback deterministic fingerprint if crypto.subtle unavailable
  const bytes = new Uint8Array(buf);
  let h = 2166136261;
  const step = Math.max(1, Math.floor(bytes.length / 4096));
  for (let i = 0; i < bytes.length; i += step) {
    h ^= bytes[i];
    h = Math.imul(h, 16777619);
  }
  return `fnv_${blob.size}_${(h >>> 0).toString(16)}`;
}

export async function decodeImageElement(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Không thể giải mã dữ liệu ảnh.'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function resizeImageBlob(
  blob: Blob,
  maxEdge: number,
  mimeType: 'image/jpeg' | 'image/webp' | 'image/png' = 'image/jpeg',
  quality = 0.86
): Promise<{ blob: Blob; width: number; height: number }> {
  const img = await decodeImageElement(blob);
  const origW = img.naturalWidth || img.width;
  const origH = img.naturalHeight || img.height;
  if (!origW || !origH) {
    throw new Error('Kích thước ảnh không hợp lệ.');
  }
  if (origW * origH > 64_000_000) {
    throw new Error('Ảnh vượt quá giới hạn 64 triệu điểm ảnh.');
  }

  const longest = Math.max(origW, origH);
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  const outW = Math.max(1, Math.round(origW * scale));
  const outH = Math.max(1, Math.round(origH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Không thể khởi tạo Canvas 2D.');

  if (mimeType === 'image/jpeg') {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, outW, outH);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, outW, outH);

  const outBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Không thể tạo thumbnail.'))),
      mimeType,
      quality
    );
  });

  // Free canvas pixels immediately
  canvas.width = 0;
  canvas.height = 0;

  return { blob: outBlob, width: origW, height: origH };
}

export async function processUploadedImage(blob: Blob): Promise<DecodedImageInfo> {
  if (blob.size > MAX_IMAGE_FILE_BYTES) {
    throw new Error('Tệp ảnh vượt quá giới hạn 30 MB.');
  }
  if (blob.type && !blob.type.startsWith('image/')) {
    throw new Error(`Định dạng không phải ảnh (${blob.type}).`);
  }

  const digest = await computeBlobDigest(blob);
  const targetMime =
    blob.type === 'image/png' || blob.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
  const { blob: thumbnail, width, height } = await resizeImageBlob(
    blob,
    THUMBNAIL_MAX_EDGE,
    targetMime,
    0.85
  );

  return { width, height, thumbnail, digest };
}

export async function prepareInferenceImageBlob(blob: Blob): Promise<Blob> {
  const { blob: resized } = await resizeImageBlob(blob, INFERENCE_MAX_EDGE, 'image/jpeg', 0.85);
  return resized;
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result || '');
      const comma = res.indexOf(',');
      resolve(comma >= 0 ? res.slice(comma + 1) : res);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Không thể mã hóa base64.'));
    reader.readAsDataURL(blob);
  });
}

export function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}
