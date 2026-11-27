/**
 * Perceptual Color Naming Engine in CIE-Lab (D65) color space.
 * Zero external dependencies, <0.1ms lookup, bilingual Vietnamese & English studio color names.
 */

export interface ColorNameEntry {
  hex: string;
  vi: string;
  en: string;
}

export interface RecognizedColor {
  hex: string;
  vi: string;
  en: string;
  deltaE: number;
  tone: 'light' | 'mid' | 'dark';
  temperature: 'warm' | 'cool' | 'neutral';
}

interface LabEntry extends ColorNameEntry {
  L: number;
  a: number;
  b: number;
}

const STUDIO_COLOR_DICTIONARY: ColorNameEntry[] = [
  // Whites & Neutrals
  { hex: '#FFFFFF', vi: 'Trắng tinh', en: 'Pure White' },
  { hex: '#FAF7EE', vi: 'Trắng ngà', en: 'Ivory Paper' },
  { hex: '#F5F5F0', vi: 'Trắng sứ', en: 'Porcelain White' },
  { hex: '#F1F0EB', vi: 'Giấy ấm', en: 'Warm Canvas' },
  { hex: '#EAE6DF', vi: 'Kem phấn', en: 'Alabaster' },
  { hex: '#DED5C5', vi: 'Đá vôi', en: 'Limestone' },
  { hex: '#E5E7EB', vi: 'Xám sương', en: 'Mist Gray' },
  { hex: '#D1D5DB', vi: 'Xám bạc', en: 'Silver Gray' },
  { hex: '#B8BDC4', vi: 'Xám xi măng nhạt', en: 'Light Concrete' },
  { hex: '#9CA3AF', vi: 'Xám xi măng', en: 'Concrete Gray' },
  { hex: '#78716C', vi: 'Xám đá ấm', en: 'Warm Stone' },
  { hex: '#6B7280', vi: 'Xám trung tính', en: 'Slate Gray' },
  { hex: '#4B5563', vi: 'Xám khói đậm', en: 'Smoky Gray' },
  { hex: '#374151', vi: 'Xám chì', en: 'Gunmetal' },
  { hex: '#26292E', vi: 'Than chì', en: 'Graphite' },
  { hex: '#1F221D', vi: 'Đen mực Studio', en: 'Studio Ink' },
  { hex: '#111827', vi: 'Đen huyền', en: 'Obsidian' },
  { hex: '#000000', vi: 'Đen tuyền', en: 'Pure Black' },

  // Warm Beiges, Sands, Woods & Browns
  { hex: '#F5E6D3', vi: 'Kem vani', en: 'Vanilla Cream' },
  { hex: '#EAD7BE', vi: 'Be cát sáng', en: 'Light Sand' },
  { hex: '#DEC7A6', vi: 'Be lanh', en: 'Linen Beige' },
  { hex: '#D8C3A5', vi: 'Cát gỗ sồi', en: 'Oak Sand' },
  { hex: '#C5A47E', vi: 'Gỗ sồi tự nhiên', en: 'Natural Oak' },
  { hex: '#C4A77D', vi: 'Đất sét ấm', en: 'Warm Clay' },
  { hex: '#B58E65', vi: 'Nâu lạc đà', en: 'Camel' },
  { hex: '#A47551', vi: 'Nâu gỗ tếch', en: 'Teak Wood' },
  { hex: '#8B5E3C', vi: 'Nâu quế', en: 'Cinnamon Brown' },
  { hex: '#734B30', vi: 'Nâu óc chó', en: 'Walnut' },
  { hex: '#5C3A21', vi: 'Nâu cà phê', en: 'Espresso' },
  { hex: '#422918', vi: 'Nâu sô-cô-la đậm', en: 'Dark Chocolate' },
  { hex: '#8E7F72', vi: 'Nâu xám Taupe', en: 'Warm Taupe' },
  { hex: '#A89F91', vi: 'Be xám Greige', en: 'Greige' },

  // Reds, Terracottas & Corals
  { hex: '#FDE2E2', vi: 'Hồng phấn nhạt', en: 'Pale Blush' },
  { hex: '#FBC5C5', vi: 'Hồng san hô nhạt', en: 'Soft Coral' },
  { hex: '#F87171', vi: 'Đỏ san hô', en: 'Coral Red' },
  { hex: '#EF4444', vi: 'Đỏ tươi', en: 'Bright Red' },
  { hex: '#DC2626', vi: 'Đỏ son', en: 'Crimson' },
  { hex: '#B91C1C', vi: 'Đỏ gạch đậm', en: 'Brick Red' },
  { hex: '#991B1B', vi: 'Đỏ đô', en: 'Deep Crimson' },
  { hex: '#7F1D1D', vi: 'Đỏ rượu vang', en: 'Burgundy' },
  { hex: '#C86D51', vi: 'Đất nung Terracotta', en: 'Terracotta' },
  { hex: '#B4533C', vi: 'Đỏ đất nung đậm', en: 'Burnt Terracotta' },
  { hex: '#D97757', vi: 'Cam đất nung', en: 'Clay Orange' },
  { hex: '#A0522D', vi: 'Nâu đỏ Sienna', en: 'Sienna' },
  { hex: '#E07A5F', vi: 'San hô đất', en: 'Earth Coral' },

  // Oranges, Peaches & Ambers
  { hex: '#FFEDD5', vi: 'Kem mơ nhạt', en: 'Apricot Cream' },
  { hex: '#FFD6B5', vi: 'Cam đào', en: 'Soft Peach' },
  { hex: '#FDBA74', vi: 'Cam mơ', en: 'Apricot' },
  { hex: '#FB923C', vi: 'Cam sáng', en: 'Tangerine' },
  { hex: '#F97316', vi: 'Cam rực', en: 'Vibrant Orange' },
  { hex: '#EA580C', vi: 'Cam cháy', en: 'Burnt Orange' },
  { hex: '#C2410C', vi: 'Cam gỉ sắt', en: 'Rust Orange' },
  { hex: '#D97706', vi: 'Hổ phách', en: 'Amber' },
  { hex: '#B45309', vi: 'Nâu hổ phách', en: 'Deep Amber' },

  // Yellows, Golds & Mustards
  { hex: '#FEF9C3', vi: 'Vàng kem chanh', en: 'Lemon Cream' },
  { hex: '#FFE8A3', vi: 'Vàng bơ', en: 'Butter Yellow' },
  { hex: '#FDE047', vi: 'Vàng nắng', en: 'Sun Yellow' },
  { hex: '#FACC15', vi: 'Vàng chanh', en: 'Bright Yellow' },
  { hex: '#EAB308', vi: 'Vàng nghệ', en: 'Turmeric Gold' },
  { hex: '#D4AF37', vi: 'Vàng kim', en: 'Metallic Gold' },
  { hex: '#C9A227', vi: 'Vàng đồng cổ', en: 'Heritage Gold' },
  { hex: '#CA8A04', vi: 'Vàng mù tạt', en: 'Mustard' },
  { hex: '#A16207', vi: 'Vàng đất Ocher', en: 'Ochre' },
  { hex: '#E9D8A6', vi: 'Vàng rơm', en: 'Straw Gold' },

  // Greens, Sages, Olives & Emeralds
  { hex: '#ECFCCB', vi: 'Xanh cốm nhạt', en: 'Pale Lime' },
  { hex: '#BEF264', vi: 'Xanh chanh cốm', en: 'Lime Green' },
  { hex: '#84CC16', vi: 'Xanh lá non', en: 'Chartreuse' },
  { hex: '#65A30D', vi: 'Xanh lá mạ', en: 'Fresh Leaf' },
  { hex: '#A3B18A', vi: 'Xanh xô thơm sáng', en: 'Light Sage' },
  { hex: '#8D9A7C', vi: 'Xanh xô thơm', en: 'Muted Sage' },
  { hex: '#6B7F5E', vi: 'Xanh rêu dịu', en: 'Moss Green' },
  { hex: '#556B2F', vi: 'Xanh ô liu', en: 'Olive Green' },
  { hex: '#3F4F3C', vi: 'Xanh rừng sâu', en: 'Forest Moss' },
  { hex: '#365B49', vi: 'Xanh lá thông', en: 'Pine Green' },
  { hex: '#BFEAD0', vi: 'Xanh bạc hà', en: 'Mint Green' },
  { hex: '#6EE7B7', vi: 'Xanh ngọc sáng', en: 'Seafoam Mint' },
  { hex: '#34D399', vi: 'Xanh ngọc lục bảo', en: 'Emerald Mint' },
  { hex: '#10B981', vi: 'Xanh ngọc', en: 'Emerald' },
  { hex: '#059669', vi: 'Xanh lục bảo đậm', en: 'Deep Emerald' },
  { hex: '#047857', vi: 'Xanh lá di sản', en: 'Heritage Green' },
  { hex: '#006838', vi: 'Xanh lá cổ điển', en: 'Classic Green' },
  { hex: '#064E3B', vi: 'Xanh lục sẫm', en: 'Deep Pine' },
  { hex: '#22C55E', vi: 'Xanh lá tươi', en: 'Leaf Green' },
  { hex: '#15803D', vi: 'Xanh lá đậm', en: 'Forest Green' },

  // Teals, Cyans & Aquas
  { hex: '#CCFBF1', vi: 'Xanh băng nhạt', en: 'Ice Aqua' },
  { hex: '#99F6E4', vi: 'Xanh ngọc lam nhạt', en: 'Soft Aqua' },
  { hex: '#2DD4BF', vi: 'Xanh ngọc lam', en: 'Turquoise' },
  { hex: '#14B8A6', vi: 'Xanh mòng két sáng', en: 'Bright Teal' },
  { hex: '#0D9488', vi: 'Xanh cổ vịt', en: 'Teal' },
  { hex: '#0F766E', vi: 'Xanh cổ vịt đậm', en: 'Deep Teal' },
  { hex: '#115E59', vi: 'Xanh biển sâu', en: 'Dark Teal' },
  { hex: '#CFFAFE', vi: 'Xanh lơ nhạt', en: 'Pale Cyan' },
  { hex: '#67E8F9', vi: 'Xanh thiên thanh', en: 'Sky Cyan' },
  { hex: '#06B6D4', vi: 'Xanh Cyan', en: 'Cyan' },
  { hex: '#0891B2', vi: 'Xanh đại dương', en: 'Ocean Cyan' },
  { hex: '#155E75', vi: 'Xanh dầu khí', en: 'Petrol Blue' },

  // Blues, Cobalts & Navies
  { hex: '#EFF6FF', vi: 'Xanh mây nhạt', en: 'Cloud Blue' },
  { hex: '#DCE8F8', vi: 'Xanh Cobalt nhạt', en: 'Ice Cobalt' },
  { hex: '#BDE0FE', vi: 'Xanh trời', en: 'Sky Blue' },
  { hex: '#93C5FD', vi: 'Xanh pastel', en: 'Baby Blue' },
  { hex: '#60A5FA', vi: 'Xanh da trời', en: 'Cornflower Blue' },
  { hex: '#3B82F6', vi: 'Xanh dương sáng', en: 'Azure Blue' },
  { hex: '#2563EB', vi: 'Xanh hoàng gia', en: 'Royal Blue' },
  { hex: '#0059C7', vi: 'Xanh Cobalt', en: 'Studio Cobalt' },
  { hex: '#1D4ED8', vi: 'Xanh lam đậm', en: 'Deep Cobalt' },
  { hex: '#1E40AF', vi: 'Xanh chàm sáng', en: 'Cobalt Indigo' },
  { hex: '#1E3A8A', vi: 'Xanh hải quân', en: 'Navy Blue' },
  { hex: '#0F172A', vi: 'Xanh đêm Midnight', en: 'Midnight Navy' },
  { hex: '#64748B', vi: 'Xám xanh đá', en: 'Steel Slate' },
  { hex: '#475569', vi: 'Xanh thép trầm', en: 'Steel Blue' },
  { hex: '#5B7C99', vi: 'Xanh denim bụi', en: 'Dusty Denim' },

  // Indigos, Purples & Violets
  { hex: '#E0E7FF', vi: 'Xanh chàm phấn', en: 'Periwinkle Mist' },
  { hex: '#A5B4FC', vi: 'Tím xanh dừa cạn', en: 'Periwinkle' },
  { hex: '#6366F1', vi: 'Xanh chàm Indigo', en: 'Indigo' },
  { hex: '#4338CA', vi: 'Chàm đậm', en: 'Deep Indigo' },
  { hex: '#EDE9FE', vi: 'Tím tử đinh hương', en: 'Lilac Mist' },
  { hex: '#D9C8FF', vi: 'Tím oải hương', en: 'Lavender' },
  { hex: '#C084FC', vi: 'Tím hoa cà', en: 'Orchid Purple' },
  { hex: '#A855F7', vi: 'Tím sáng', en: 'Amethyst' },
  { hex: '#7C3AED', vi: 'Tím violet', en: 'Royal Violet' },
  { hex: '#6D28D9', vi: 'Tím đậm', en: 'Deep Violet' },
  { hex: '#4C1D95', vi: 'Tím mận sẫm', en: 'Plum Purple' },
  { hex: '#6B4C7A', vi: 'Tím khói', en: 'Dusty Plum' },

  // Pinks, Roses & Magentas
  { hex: '#FCE7F3', vi: 'Hồng phấn sữa', en: 'Blush Pink' },
  { hex: '#F9A8D4', vi: 'Hồng cánh sen nhạt', en: 'Soft Rose' },
  { hex: '#F472B6', vi: 'Hồng tươi', en: 'Flamingo Pink' },
  { hex: '#EC4899', vi: 'Hồng cánh sen', en: 'Hot Pink' },
  { hex: '#DB2777', vi: 'Hồng mâm xôi', en: 'Raspberry' },
  { hex: '#9D174D', vi: 'Hồng rượu đậm', en: 'Deep Berry' },
  { hex: '#D4A5A5', vi: 'Hồng đất bụi', en: 'Dusty Rose' },
  { hex: '#C08497', vi: 'Hồng gỗ Rosewood', en: 'Rosewood' },
  { hex: '#E879F9', vi: 'Hồng tím Fuchsia', en: 'Fuchsia' },
  { hex: '#A21CAF', vi: 'Tím hồng Magenta', en: 'Deep Magenta' },
];

function parseHexRgb(raw: string): [number, number, number] | null {
  const clean = raw.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(clean)) {
    return [
      parseInt(clean[0] + clean[0], 16),
      parseInt(clean[1] + clean[1], 16),
      parseInt(clean[2] + clean[2], 16),
    ];
  }
  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ];
  }
  return null;
}

/**
 * Converts sRGB [0..255] to CIE-Lab (D65 illuminant).
 */
export function rgbToLab(r8: number, g8: number, b8: number): [number, number, number] {
  const toLinear = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const r = toLinear(r8);
  const g = toLinear(g8);
  const b = toLinear(b8);

  // sRGB -> XYZ (D65)
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = (r * 0.2126729 + g * 0.7151522 + b * 0.0721750) / 1.0;
  const z = (r * 0.0193339 + g * 0.1191920 + b * 0.9503041) / 1.08883;

  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const LAB_TABLE: LabEntry[] = STUDIO_COLOR_DICTIONARY.map((entry) => {
  const rgb = parseHexRgb(entry.hex) ?? [128, 128, 128];
  const [L, a, b] = rgbToLab(rgb[0], rgb[1], rgb[2]);
  return { ...entry, L, a, b };
});

/**
 * Recognizes any arbitrary HEX color perceptually using CIE-Lab Delta-E distance.
 */
export function recognizeColor(rawHex: string): RecognizedColor {
  const rgb = parseHexRgb(rawHex);
  if (!rgb) {
    return {
      hex: '#8D9A7C',
      vi: 'Xanh xô thơm',
      en: 'Muted Sage',
      deltaE: 0,
      tone: 'mid',
      temperature: 'neutral',
    };
  }
  const normHex = `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  const [L, a, b] = rgbToLab(rgb[0], rgb[1], rgb[2]);

  let best = LAB_TABLE[0];
  let bestDist = Infinity;
  for (let i = 0; i < LAB_TABLE.length; i++) {
    const item = LAB_TABLE[i];
    const dL = L - item.L;
    const da = a - item.a;
    const db = b - item.b;
    const dist = Math.sqrt(dL * dL + da * da + db * db);
    if (dist < bestDist) {
      bestDist = dist;
      best = item;
    }
  }

  const chroma = Math.hypot(a, b);
  const tone: 'light' | 'mid' | 'dark' = L >= 74 ? 'light' : L <= 34 ? 'dark' : 'mid';
  const temperature: 'warm' | 'cool' | 'neutral' =
    chroma < 8 ? 'neutral' : a * 0.55 + b * 0.45 >= 0 ? 'warm' : 'cool';

  let vi = best.vi;
  let en = best.en;

  // Add subtle lightness qualifier if the picked random color diverges noticeably in brightness
  if (bestDist > 12) {
    const lDiff = L - best.L;
    if (lDiff > 14 && !/nhạt|sáng|kem|phấn|trắng/i.test(vi)) {
      vi = `${vi} nhạt`;
      if (!/light|pale|soft|white/i.test(en)) en = `Light ${en}`;
    } else if (lDiff < -14 && !/đậm|sẫm|đen|tuyền/i.test(vi)) {
      vi = `${vi} đậm`;
      if (!/dark|deep|black|midnight/i.test(en)) en = `Deep ${en}`;
    }
  }

  return {
    hex: normHex,
    vi,
    en,
    deltaE: Math.round(bestDist * 10) / 10,
    tone,
    temperature,
  };
}

export function getRecognizedColorName(rawHex: string, lang: 'vi' | 'en'): string {
  const res = recognizeColor(rawHex);
  return lang === 'vi' ? res.vi : res.en;
}

const GENERIC_AUTO_TITLES = new Set([
  '',
  'sage',
  'swatch',
  'color',
  'màu',
  'ô màu',
]);

/**
 * Determines whether a color card's current title is auto-generated (safe to auto-rename
 * when the user picks a new random color) vs custom user-authored text (must preserve!).
 */
export function isAutoColorTitle(currentTitle: string, prevHex?: string): boolean {
  const trimmed = (currentTitle || '').trim();
  const lower = trimmed.toLowerCase();
  if (GENERIC_AUTO_TITLES.has(lower)) return true;
  if (/^#[0-9a-f]{3,6}$/i.test(trimmed)) return true;
  if (/^tone\s+\d+$/i.test(trimmed)) return true;

  if (prevHex) {
    const prev = recognizeColor(prevHex);
    if (lower === prev.vi.toLowerCase() || lower === prev.en.toLowerCase()) {
      return true;
    }
  }
  // Also allow replacing any exact dictionary entry name when switching colors
  for (const entry of LAB_TABLE) {
    if (lower === entry.vi.toLowerCase() || lower === entry.en.toLowerCase()) {
      return true;
    }
  }
  return false;
}
