import type { Card, Category, Project } from './types';
import { createId } from './validate';

export const DEFAULT_LIGHT_BG = '#F1F0EB';
export const DEFAULT_DARK_BG = '#191D1A';

export interface SampleAssetSeed {
  id: string;
  fileName: string;
  samplePath: string;
  title: string;
  category: Category;
  width: number;
  height: number;
}

const BASE = import.meta.env.BASE_URL || './';

export const SAMPLE_ASSETS: SampleAssetSeed[] = [
  {
    id: 'sample_living_room',
    fileName: 'living-room.jpg',
    samplePath: `${BASE}samples/living-room.jpg`,
    title: 'Không gian phòng khách ánh sáng tự nhiên',
    category: 'reference',
    width: 1024,
    height: 768,
  },
  {
    id: 'sample_armchair',
    fileName: 'armchair.jpg',
    samplePath: `${BASE}samples/armchair.jpg`,
    title: 'Ghế lounge gỗ sồi & vải bouclé',
    category: 'furniture',
    width: 768,
    height: 1024,
  },
  {
    id: 'sample_material_texture',
    fileName: 'material-texture.jpg',
    samplePath: `${BASE}samples/material-texture.jpg`,
    title: 'Mẫu gỗ sồi, đá limestone & vải linen',
    category: 'material',
    width: 1024,
    height: 1024,
  },
  {
    id: 'sample_floor_plan',
    fileName: 'floor-plan.jpg',
    samplePath: `${BASE}samples/floor-plan.jpg`,
    title: 'Phác thảo mặt bằng phòng khách',
    category: 'sketch',
    width: 1024,
    height: 768,
  },
  {
    id: 'sample_paint_swatches',
    fileName: 'paint-swatches.jpg',
    samplePath: `${BASE}samples/paint-swatches.jpg`,
    title: 'Bảng mẫu sắc độ sơn & vật liệu',
    category: 'palette',
    width: 1024,
    height: 682,
  },
];

export function getNextZ(cards: Card[]): number {
  return cards.reduce((max, c) => Math.max(max, c.z), 0) + 1;
}

export function createEmptyProject(name: string, description = ''): Project {
  const now = new Date().toISOString();
  return {
    id: createId('proj'),
    name: name.trim() || 'Dự án mới',
    description,
    appearance: {
      background: DEFAULT_LIGHT_BG,
      dots: true,
    },
    view: { x: 120, y: 100, zoom: 1 },
    cards: [],
    trash: [],
    updatedAt: now,
  };
}

/**
 * Seed board matching Section 12: "Không gian sống · 01"
 */
export function createSampleProject(): Project {
  const now = new Date().toISOString();
  const cards: Card[] = [
    {
      id: 'sample_card_note_concept',
      kind: 'note',
      title: 'Concept định hướng',
      text: 'Gỗ ấm, bề mặt thô và ánh sáng tự nhiên.\n\nƯu tiên tỉ lệ thoáng, vật liệu mộc không phủ bóng và sắc xanh xô thơm dịu mắt cho khu tiếp khách.',
      color: '#FAF7EE',
      category: 'reference',
      x: 40,
      y: 36,
      w: 310,
      h: 162,
      z: 6,
      inbox: false,
      locked: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'sample_card_living',
      kind: 'image',
      title: 'Phòng khách ánh sáng tự nhiên',
      text: 'Tỉ lệ cửa kính lớn đón nắng sáng, sofa linen trung tính kết hợp bàn đá travertine thấp.',
      category: 'reference',
      x: 40,
      y: 222,
      w: 440,
      h: 330,
      z: 2,
      inbox: false,
      locked: false,
      assetId: 'sample_living_room',
      imageStatus: 'ready',
      source: {
        fileName: 'living-room.jpg',
        method: 'sample',
        capturedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'sample_card_armchair',
      kind: 'image',
      title: 'Ghế lounge gỗ sồi & bouclé',
      text: 'Điểm nhấn điêu khắc góc đọc sách gần cửa ban công.',
      category: 'furniture',
      x: 432,
      y: 266,
      w: 224,
      h: 298,
      z: 4,
      inbox: false,
      locked: false,
      assetId: 'sample_armchair',
      imageStatus: 'ready',
      framed: true,
      source: {
        fileName: 'armchair.jpg',
        method: 'sample',
        capturedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'sample_card_material',
      kind: 'image',
      title: 'Bề mặt gỗ sồi, đá & linen',
      text: 'Độ tương phản xúc giác giữa vân gỗ chải xước, đá vôi thô và vải dệt mộc.',
      category: 'material',
      x: 696,
      y: 44,
      w: 238,
      h: 238,
      z: 3,
      inbox: false,
      locked: false,
      assetId: 'sample_material_texture',
      imageStatus: 'ready',
      framed: true,
      source: {
        fileName: 'material-texture.jpg',
        method: 'sample',
        capturedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'sample_card_floorplan',
      kind: 'image',
      title: 'Phác thảo mặt bằng phòng khách',
      text: 'Bố trí giao thông mở nối khu sofa – bàn trà – logia.',
      category: 'sketch',
      x: 696,
      y: 306,
      w: 294,
      h: 220,
      z: 3,
      inbox: false,
      locked: false,
      assetId: 'sample_floor_plan',
      imageStatus: 'ready',
      source: {
        fileName: 'floor-plan.jpg',
        method: 'sample',
        capturedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'sample_card_dwg',
      kind: 'file',
      title: 'Mat-bang-PK-01.dwg',
      text: 'Bản vẽ kỹ thuật mặt bằng bố trí nội thất tỉ lệ 1:50 (chốt sơ bộ lần 2).',
      category: 'sketch',
      x: 696,
      y: 544,
      w: 294,
      h: 82,
      z: 5,
      inbox: false,
      locked: false,
      designFile: { extension: 'dwg', size: 2480120 },
      source: {
        fileName: 'Mat-bang-PK-01.dwg',
        method: 'sample',
        capturedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'sample_card_swatch_sage',
      kind: 'color',
      title: 'Sage',
      text: 'Mảng nhấn gốm & rèm phụ',
      color: '#8D9A7C',
      category: 'palette',
      x: 1030,
      y: 44,
      w: 174,
      h: 104,
      z: 5,
      inbox: false,
      locked: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'sample_card_swatch_oak',
      kind: 'color',
      title: 'Oak',
      text: 'Sàn & hệ lam gỗ sồi tự nhiên',
      color: '#C5A47E',
      category: 'palette',
      x: 1030,
      y: 164,
      w: 174,
      h: 104,
      z: 5,
      inbox: false,
      locked: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'sample_card_swatch_limestone',
      kind: 'color',
      title: 'Limestone',
      text: 'Tường sơn hiệu ứng & bàn đá',
      color: '#DEDBD2',
      category: 'palette',
      x: 1030,
      y: 284,
      w: 174,
      h: 104,
      z: 5,
      inbox: false,
      locked: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'sample_card_paint_photo',
      kind: 'image',
      title: 'Mẫu bảng sơn thực tế',
      text: 'Đối chiếu sắc độ sơn mờ dưới ánh sáng ban ngày.',
      category: 'palette',
      x: 1030,
      y: 406,
      w: 224,
      h: 150,
      z: 4,
      inbox: false,
      locked: false,
      assetId: 'sample_paint_swatches',
      imageStatus: 'ready',
      source: {
        fileName: 'paint-swatches.jpg',
        method: 'sample',
        capturedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'sample_card_inbox_note',
      kind: 'note',
      title: 'Ghi chú rèm & ánh sáng chiều',
      text: 'Kiểm tra hướng nắng Tây logia căn hộ — đề xuất dùng rèm voan linen 2 lớp để giữ ánh sáng tán xạ mềm.',
      color: '#F3F6EF',
      category: 'other',
      x: 120,
      y: 120,
      w: 248,
      h: 148,
      z: 10,
      inbox: true,
      locked: false,
      createdAt: now,
      updatedAt: now,
    },
  ];

  return {
    id: 'proj_sample_living_01',
    name: 'Không gian sống · 01',
    description: 'Board mẫu cho phòng khách phong cách tối giản ấm áp',
    appearance: {
      background: DEFAULT_LIGHT_BG,
      dots: true,
    },
    view: { x: 80, y: 90, zoom: 0.92 },
    cards,
    trash: [],
    updatedAt: now,
  };
}
