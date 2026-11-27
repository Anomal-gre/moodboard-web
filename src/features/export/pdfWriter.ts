/**
 * Minimal, zero-dependency, 100% spec-compliant Binary PDF 1.4 Writer.
 * Packs high-DPI JPEG pages (DCTDecode) with exact byte-level xref tables,
 * optional Studio metadata, and optional embedded Mosa Hybrid Review payload.
 */

export interface PdfJpegPage {
  jpegBytes: Uint8Array;
  widthPx: number;
  heightPx: number;
  /** Physical PDF page width in points (1 pt = 1/72 inch). A4 Landscape = 841.89, Portrait = 595.28 */
  pageWidthPt: number;
  /** Physical PDF page height in points. A4 Landscape = 595.28, Portrait = 841.89 */
  pageHeightPt: number;
}

export interface PdfDocumentOptions {
  title?: string;
  author?: string;
  /** Optional ASCII-safe comment payload embedded before %%EOF (e.g. %MOSA_REVIEW_V1:...) */
  embeddedComment?: string;
}

export const A4_LANDSCAPE_PT = { w: 841.89, h: 595.28 };
export const A4_PORTRAIT_PT = { w: 595.28, h: 841.89 };

const MOSA_BRAND_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 860 860">' +
  '<defs>' +
  '<linearGradient id="g0" x1="458.4" y1="401.5" x2="70.2" y2="13.3" gradientUnits="userSpaceOnUse">' +
  '<stop offset="0" stop-color="#38bdf8"/><stop offset="1" stop-color="#0a84ff"/>' +
  '</linearGradient>' +
  '<linearGradient id="g1" x1="846.7" y1="70.2" x2="458.5" y2="458.4" gradientUnits="userSpaceOnUse">' +
  '<stop offset="0" stop-color="#0a84ff"/><stop offset="1" stop-color="#38bdf8"/>' +
  '</linearGradient>' +
  '<linearGradient id="g2" x1="789.8" y1="846.6" x2="401.6" y2="458.4" gradientUnits="userSpaceOnUse">' +
  '<stop offset="0" stop-color="#0a84ff"/><stop offset="1" stop-color="#38bdf8"/>' +
  '</linearGradient>' +
  '<linearGradient id="g3" x1="13.4" y1="789.8" x2="401.6" y2="401.6" gradientUnits="userSpaceOnUse">' +
  '<stop offset="0" stop-color="#0a84ff"/><stop offset="1" stop-color="#38bdf8"/>' +
  '</linearGradient>' +
  '</defs>' +
  '<path fill="url(#g0)" d="M430,430h-194.1c-107.1,0-194.1-87-194.1-194.1V41.8h388.2v388.2h0Z"/>' +
  '<path fill="url(#g1)" d="M818.1,430h-388.1v-194.1c0-107.1,87-194.1,194.1-194.1h194.1v388.2h0Z"/>' +
  '<path fill="url(#g2)" d="M430,430h194.1c107.1,0,194.1,87,194.1,194.1v194.1h-388.1v-388.1h0Z"/>' +
  '<path fill="url(#g3)" d="M41.9,430h388.1v194.1c0,107.1-87,194.1-194.1,194.1H41.8v-388.1h.1Z"/>' +
  '</svg>';

/** Portable self-contained Data URL of Mosa's official brand favicon/logo (works offline in HTML & Canvas PDF). */
export const MOSA_BRAND_LOGO_DATA_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(MOSA_BRAND_SVG)}`;

const encoder = new TextEncoder();

function asciiBytes(str: string): Uint8Array {
  return encoder.encode(str);
}

function escapePdfString(input: string): string {
  // Strip non-ASCII for PDF Info dictionary safety (page visuals use full UTF-8 via Canvas 2D)
  const clean = (input || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .trim();
  return clean || 'Mosa Document';
}

/**
 * Builds a complete, valid PDF 1.4 binary Uint8Array from one or more JPEG-encoded pages.
 */
export function buildPdfBytes(pages: PdfJpegPage[], options: PdfDocumentOptions = {}): Uint8Array {
  if (pages.length === 0) {
    throw new Error('Cannot build PDF with zero pages.');
  }

  const chunks: Uint8Array[] = [];
  let byteOffset = 0;
  const push = (bytes: Uint8Array) => {
    chunks.push(bytes);
    byteOffset += bytes.length;
  };
  const pushStr = (s: string) => push(asciiBytes(s));

  // PDF 1.4 Header + binary hint comment (>128 bytes)
  push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  // Object numbering:
  // 1 = Catalog
  // 2 = Pages
  // For each page i (0..N-1):
  //   pageObj = 3 + i * 3
  //   imgObj  = 4 + i * 3
  //   cntObj  = 5 + i * 3
  // infoObj = 3 + N * 3
  const pageCount = pages.length;
  const infoObjId = 3 + pageCount * 3;
  const totalObjects = infoObjId; // 1..infoObjId
  const offsets: number[] = new Array(totalObjects + 1).fill(0);

  // 1 0 obj: Catalog
  offsets[1] = byteOffset;
  pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // 2 0 obj: Pages
  offsets[2] = byteOffset;
  const kidsRefs = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  pushStr(`2 0 obj\n<< /Type /Pages /Kids [${kidsRefs}] /Count ${pageCount} >>\nendobj\n`);

  // Page, Image XObject & Content Stream triplets
  for (let i = 0; i < pageCount; i++) {
    const p = pages[i];
    const pageObjId = 3 + i * 3;
    const imgObjId = 4 + i * 3;
    const cntObjId = 5 + i * 3;
    const wPt = p.pageWidthPt.toFixed(2);
    const hPt = p.pageHeightPt.toFixed(2);

    // Page object
    offsets[pageObjId] = byteOffset;
    pushStr(
      `${pageObjId} 0 obj\n` +
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wPt} ${hPt}] ` +
        `/Resources << /XObject << /Im0 ${imgObjId} 0 R >> >> /Contents ${cntObjId} 0 R >>\n` +
        `endobj\n`
    );

    // Image XObject (raw JPEG binary stream)
    offsets[imgObjId] = byteOffset;
    pushStr(
      `${imgObjId} 0 obj\n` +
        `<< /Type /XObject /Subtype /Image /Width ${Math.round(p.widthPx)} /Height ${Math.round(p.heightPx)} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpegBytes.length} >>\n` +
        `stream\n`
    );
    push(p.jpegBytes);
    pushStr('\nendstream\nendobj\n');

    // Content stream drawing image full-bleed into page MediaBox
    const streamStr = `q\n${wPt} 0 0 ${hPt} 0 0 cm\n/Im0 Do\nQ\n`;
    const streamBytes = asciiBytes(streamStr);
    offsets[cntObjId] = byteOffset;
    pushStr(`${cntObjId} 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n`);
    push(streamBytes);
    pushStr('endstream\nendobj\n');
  }

  // Info dictionary
  offsets[infoObjId] = byteOffset;
  const safeTitle = escapePdfString(options.title || 'Mosa Specification Sheet');
  const safeAuthor = escapePdfString(options.author || 'Mosa Studio');
  pushStr(
    `${infoObjId} 0 obj\n` +
      `<< /Title (${safeTitle}) /Author (${safeAuthor}) /Producer (Mosa Local-First PDF Engine) >>\n` +
      `endobj\n`
  );

  // Cross-reference table (exact 20-byte lines per PDF spec)
  const xrefStart = byteOffset;
  pushStr(`xref\n0 ${totalObjects + 1}\n`);
  pushStr('0000000000 65535 f \n');
  for (let id = 1; id <= totalObjects; id++) {
    const off = String(offsets[id]).padStart(10, '0');
    pushStr(`${off} 00000 n \n`);
  }

  // Trailer
  pushStr(
    `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R /Info ${infoObjId} 0 R >>\n` +
      `startxref\n${xrefStart}\n`
  );

  if (options.embeddedComment) {
    const cleanComment = options.embeddedComment.replace(/[\r\n]/g, '');
    pushStr(`%${cleanComment}\n`);
  }

  pushStr('%%EOF\n');

  // Concatenate into single contiguous Uint8Array
  const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

export function buildPdfBlob(pages: PdfJpegPage[], options: PdfDocumentOptions = {}): Blob {
  const bytes = buildPdfBytes(pages, options);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: 'application/pdf' });
}

export async function canvasToJpegBytes(
  canvas: HTMLCanvasElement,
  quality = 0.92
): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to encode PDF page JPEG'))),
      'image/jpeg',
      quality
    );
  });
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}
