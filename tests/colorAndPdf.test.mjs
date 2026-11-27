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

const { getRecognizedColorName, isAutoColorTitle, recognizeColor } = await vite.ssrLoadModule(
  '/src/domain/colorNaming.ts'
);
const { A4_LANDSCAPE_PT, A4_PORTRAIT_PT, buildPdfBytes } = await vite.ssrLoadModule(
  '/src/features/export/pdfWriter.ts'
);

test('CIE-Lab perceptual color recognizer names exact and arbitrary random HEX colors accurately in VI/EN', () => {
  // Exact studio colors
  assert.equal(getRecognizedColorName('#0059C7', 'vi'), 'Xanh Cobalt');
  assert.equal(getRecognizedColorName('#0059C7', 'en'), 'Studio Cobalt');
  assert.equal(getRecognizedColorName('#8D9A7C', 'vi'), 'Xanh xô thơm');
  assert.equal(getRecognizedColorName('#C86D51', 'vi'), 'Đất nung Terracotta');

  // Arbitrary random colors never in dictionary
  const randomRed = recognizeColor('#E12D39');
  assert.match(randomRed.vi, /Đỏ/i);
  assert.equal(randomRed.temperature, 'warm');

  const randomTeal = recognizeColor('#1A9E96');
  assert.match(randomTeal.vi, /Xanh/i);
  assert.equal(randomTeal.temperature, 'cool');

  const randomNeutral = recognizeColor('#ECEAE4');
  assert.equal(randomNeutral.temperature, 'neutral');
  assert.equal(randomNeutral.tone, 'light');

  const randomDark = recognizeColor('#181B20');
  assert.equal(randomDark.tone, 'dark');
});

test('isAutoColorTitle auto-updates default/auto names while preserving custom user titles', () => {
  assert.equal(isAutoColorTitle('Sage', '#8D9A7C'), true);
  assert.equal(isAutoColorTitle('#3A7CA5', '#3A7CA5'), true);
  assert.equal(isAutoColorTitle('Tone 1', '#8D9A7C'), true);
  assert.equal(isAutoColorTitle('Xanh Cobalt', '#0059C7'), true);
  assert.equal(isAutoColorTitle('Studio Cobalt', '#0059C7'), true);

  // User-authored custom names MUST be preserved
  assert.equal(isAutoColorTitle('Sơn tường phòng khách Jotun 1024', '#DED5C5'), false);
  assert.equal(isAutoColorTitle('Brand Primary Accent', '#0059C7'), false);
});

test('Zero-dependency PDF 1.4 writer builds valid multi-page binary PDF with exact xref byte offsets', () => {
  // Minimal fake JPEG byte payloads
  const page1Jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
  const page2Jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);

  const pdfBytes = buildPdfBytes(
    [
      {
        jpegBytes: page1Jpeg,
        widthPx: 2480,
        heightPx: 1754,
        pageWidthPt: A4_LANDSCAPE_PT.w,
        pageHeightPt: A4_LANDSCAPE_PT.h,
      },
      {
        jpegBytes: page2Jpeg,
        widthPx: 1754,
        heightPx: 2480,
        pageWidthPt: A4_PORTRAIT_PT.w,
        pageHeightPt: A4_PORTRAIT_PT.h,
      },
    ],
    {
      title: 'Phòng khách căn hộ — Hồ sơ vật tư',
      author: 'Mosa Studio',
      embeddedComment: 'MOSA_REVIEW_V1:eyJ0ZXN0IjoxfQ==',
    }
  );

  const text = new TextDecoder('latin1').decode(pdfBytes);
  assert.ok(text.startsWith('%PDF-1.4\n'), 'Must start with %PDF-1.4 header');
  assert.ok(text.includes('/Count 2'), 'Must declare 2 pages');
  assert.ok(text.includes('/Filter /DCTDecode'), 'Must embed JPEG XObject stream');
  assert.ok(text.includes('%MOSA_REVIEW_V1:eyJ0ZXN0IjoxfQ==\n%%EOF\n'), 'Must embed Smart Hybrid comment before %%EOF');

  // Verify startxref points to exact byte offset of "xref\n"
  const startxrefMatch = text.match(/startxref\n(\d+)\n/);
  assert.ok(startxrefMatch, 'Must include startxref offset');
  const xrefPos = Number(startxrefMatch[1]);
  assert.equal(text.slice(xrefPos, xrefPos + 5), 'xref\n', 'startxref must match exact xref byte offset');

  // Verify every object entry in xref points to its exact "<id> 0 obj\n" byte offset
  const xrefLines = text.slice(xrefPos).split('\n');
  // Line 0: "xref", Line 1: "0 10", Line 2: "0000000000 65535 f "
  const totalCount = Number(xrefLines[1].split(' ')[1]);
  assert.equal(totalCount, 10, '2 pages -> 1 Catalog + 1 Pages + 2*3 Page/Img/Content + 1 Info = 9 objects (+1 free = 10)');
  for (let id = 1; id < totalCount; id++) {
    const entry = xrefLines[2 + id];
    const objOffset = Number(entry.slice(0, 10));
    assert.ok(
      text.slice(objOffset, objOffset + 12).startsWith(`${id} 0 obj\n`),
      `xref offset for object ${id} must point directly to "${id} 0 obj"`
    );
  }
});
