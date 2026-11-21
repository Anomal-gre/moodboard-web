import type { Card, Project } from './types';
import { createEmptyProject, createSampleProject, DEFAULT_LIGHT_BG } from './project';
import { createId } from './validate';
import type { I18nDict } from '../i18n';

export type ProjectTemplateId = 'blank' | 'wabi-sabi' | 'ffe-materials' | 'brand-bento';

export interface ProjectTemplateDescriptor {
  id: ProjectTemplateId;
  accentColors: string[];
  previewSample?: string;
}

const BASE = import.meta.env.BASE_URL || './';

export const PROJECT_TEMPLATES: ProjectTemplateDescriptor[] = [
  {
    id: 'blank',
    accentColors: ['#F1F0EB', '#E5E5EA', '#D1D1D6'],
  },
  {
    id: 'wabi-sabi',
    accentColors: ['#DED5C5', '#C5A47E', '#8D9A7C'],
    previewSample: `${BASE}samples/living-room.jpg`,
  },
  {
    id: 'ffe-materials',
    accentColors: ['#C5A47E', '#8D9A7C', '#4A473E'],
    previewSample: `${BASE}samples/material-texture.jpg`,
  },
  {
    id: 'brand-bento',
    accentColors: ['#007AFF', '#1C1C1E', '#E8E3D9'],
    previewSample: `${BASE}samples/armchair.jpg`,
  },
];

export function getTemplateTitleDesc(
  templateId: ProjectTemplateId,
  dict: I18nDict
): { title: string; desc: string } {
  switch (templateId) {
    case 'wabi-sabi':
      return { title: dict.templateWabiTitle, desc: dict.templateWabiDesc };
    case 'ffe-materials':
      return { title: dict.templateFfeTitle, desc: dict.templateFfeDesc };
    case 'brand-bento':
      return { title: dict.templateBrandTitle, desc: dict.templateBrandDesc };
    case 'blank':
    default:
      return { title: dict.templateBlankTitle, desc: dict.templateBlankDesc };
  }
}

function regenerateCardIds(cards: Card[]): Card[] {
  const idMap = new Map<string, string>();
  for (const c of cards) {
    idMap.set(c.id, createId('crd'));
  }
  const now = new Date().toISOString();
  return cards.map((c) => ({
    ...c,
    id: idMap.get(c.id)!,
    groupId: c.groupId ? idMap.get(c.groupId) : undefined,
    linksTo: c.linksTo
      ?.map((tid) => idMap.get(tid))
      .filter((x): x is string => Boolean(x)),
    createdAt: now,
    updatedAt: now,
  }));
}

export function createProjectFromTemplate(
  templateId: ProjectTemplateId,
  customName: string | undefined,
  dict: I18nDict
): Project {
  const now = new Date().toISOString();
  const { title } = getTemplateTitleDesc(templateId, dict);
  const name = customName?.trim() || title;

  if (templateId === 'blank') {
    const empty = createEmptyProject(name);
    return { ...empty, status: 'draft' };
  }

  if (templateId === 'wabi-sabi') {
    const sample = createSampleProject();
    return {
      ...sample,
      id: createId('proj'),
      name,
      status: 'draft',
      cards: regenerateCardIds(sample.cards),
      trash: [],
      updatedAt: now,
    };
  }

  if (templateId === 'ffe-materials') {
    const idHero = createId('crd');
    const idChair = createId('crd');
    const idMat = createId('crd');
    const idPlan = createId('crd');
    const idNote = createId('crd');
    const idSw1 = createId('crd');
    const idSw2 = createId('crd');
    const idSw3 = createId('crd');

    const cards: Card[] = [
      {
        id: idNote,
        kind: 'note',
        title: 'FF&E Specification Brief',
        text: 'Hạng mục hoàn thiện phòng khách căn hộ.\nƯu tiên vật liệu tự nhiên bền màu, sơn hiệu ứng mờ và gỗ sồi hoàn thiện dầu lau.',
        color: '#FAF7EE',
        category: 'reference',
        x: 60,
        y: 40,
        w: 320,
        h: 138,
        z: 5,
        inbox: false,
        locked: false,
        linksTo: [idHero],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: idHero,
        kind: 'image',
        title: 'Sofa & Không gian tổng thể',
        text: 'Sofa văng 3 chỗ bọc vải linen chống thấm, bàn trà đá travertine.',
        category: 'reference',
        x: 60,
        y: 204,
        w: 440,
        h: 326,
        z: 2,
        inbox: false,
        locked: false,
        assetId: 'sample_living_room',
        imageStatus: 'ready',
        spec: { code: 'SF-01 · Linen Oat', price: '28.500.000 đ', qty: 1 },
        linksTo: [idMat, idSw1],
        source: { fileName: 'living-room.jpg', method: 'sample', capturedAt: now },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: idChair,
        kind: 'image',
        title: 'Ghế thư giãn gỗ sồi & bouclé',
        text: 'Khung gỗ sồi tự nhiên uốn cong, đệm bouclé màu kem sữa.',
        category: 'furniture',
        x: 540,
        y: 40,
        w: 248,
        h: 324,
        z: 3,
        inbox: false,
        locked: false,
        assetId: 'sample_armchair',
        imageStatus: 'ready',
        spec: { code: 'AC-04 · Oak Bouclé', price: '9.800.000 đ', qty: 2 },
        linksTo: [idSw2],
        source: { fileName: 'armchair.jpg', method: 'sample', capturedAt: now },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: idMat,
        kind: 'image',
        title: 'Vật liệu hoàn thiện sàn & tường',
        text: 'Gỗ sồi kỹ thuật 15mm, đá limestone mài honed & rèm linen 2 lớp.',
        category: 'material',
        x: 540,
        y: 390,
        w: 248,
        h: 248,
        z: 4,
        inbox: false,
        locked: false,
        assetId: 'sample_material_texture',
        imageStatus: 'ready',
        spec: { code: 'MT-12 · Oak & Limestone', price: '1.650.000 đ', qty: 32 },
        linksTo: [idSw3],
        source: { fileName: 'material-texture.jpg', method: 'sample', capturedAt: now },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: idPlan,
        kind: 'image',
        title: 'Mặt bằng bố trí nội thất',
        text: 'Bản vẽ định vị cao độ ổ cắm & hướng ánh sáng ban công.',
        category: 'sketch',
        x: 824,
        y: 40,
        w: 300,
        h: 224,
        z: 3,
        inbox: false,
        locked: false,
        assetId: 'sample_floor_plan',
        imageStatus: 'ready',
        source: { fileName: 'floor-plan.jpg', method: 'sample', capturedAt: now },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: idSw1,
        kind: 'color',
        title: 'Limestone Wall (60%)',
        text: 'Sơn hiệu ứng vôi mờ mã DL-04',
        color: '#DED5C5',
        category: 'palette',
        x: 824,
        y: 300,
        w: 156,
        h: 88,
        z: 6,
        inbox: false,
        locked: false,
        spec: { code: 'PNT-01 · Limewash', price: '380.000 đ', qty: 45 },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: idSw2,
        kind: 'color',
        title: 'Natural Oak (30%)',
        text: 'Gỗ sồi lau dầu tự nhiên',
        color: '#C5A47E',
        category: 'palette',
        x: 824,
        y: 406,
        w: 156,
        h: 88,
        z: 6,
        inbox: false,
        locked: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: idSw3,
        kind: 'color',
        title: 'Muted Sage (10%)',
        text: 'Điểm nhấn vải & cây xanh',
        color: '#8D9A7C',
        category: 'palette',
        x: 824,
        y: 512,
        w: 156,
        h: 88,
        z: 6,
        inbox: false,
        locked: false,
        createdAt: now,
        updatedAt: now,
      },
    ];

    return {
      id: createId('proj'),
      name,
      description: dict.templateFfeDesc,
      status: 'draft',
      appearance: { background: DEFAULT_LIGHT_BG, dots: true },
      view: { x: 80, y: 60, zoom: 0.92 },
      cards,
      trash: [],
      updatedAt: now,
    };
  }

  // 'brand-bento'
  const idMain = createId('crd');
  const idAccent = createId('crd');
  const idPal = createId('crd');
  const idNote = createId('crd');
  const idSwA = createId('crd');
  const idSwB = createId('crd');
  const idSwC = createId('crd');

  const cards: Card[] = [
    {
      id: idMain,
      kind: 'image',
      title: 'Key Visual Direction',
      text: 'Ánh sáng mềm, tương phản sạch, bố cục thoáng theo lưới tạp chí.',
      category: 'reference',
      x: 60,
      y: 48,
      w: 420,
      h: 315,
      z: 2,
      inbox: false,
      locked: false,
      assetId: 'sample_living_room',
      imageStatus: 'ready',
      linksTo: [idNote],
      source: { fileName: 'living-room.jpg', method: 'sample', capturedAt: now },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: idNote,
      kind: 'note',
      title: 'Art Direction & Tone',
      text: 'Tinh giản — Hiện đại — Có chiều sâu vật liệu.\nGiữ tối thiểu 30% khoảng trắng quanh điểm nhấn chính.',
      color: '#FFFFFF',
      category: 'reference',
      x: 504,
      y: 48,
      w: 300,
      h: 136,
      z: 5,
      inbox: false,
      locked: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: idAccent,
      kind: 'image',
      title: 'Hero Product Silhouette',
      text: 'Góc chụp 3/4 làm nổi bật đường cong vật liệu.',
      category: 'furniture',
      x: 504,
      y: 204,
      w: 300,
      h: 360,
      z: 3,
      inbox: false,
      locked: false,
      assetId: 'sample_armchair',
      imageStatus: 'ready',
      source: { fileName: 'armchair.jpg', method: 'sample', capturedAt: now },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: idPal,
      kind: 'image',
      title: 'Color & Texture Reference',
      text: 'Hệ màu trung tính ấm kết hợp sắc nhấn xanh dương/xô thơm.',
      category: 'palette',
      x: 60,
      y: 382,
      w: 420,
      h: 182,
      z: 2,
      inbox: false,
      locked: false,
      assetId: 'sample_paint_swatches',
      imageStatus: 'ready',
      source: { fileName: 'paint-swatches.jpg', method: 'sample', capturedAt: now },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: idSwA,
      kind: 'color',
      title: 'Paper Cream',
      text: 'Nền chính',
      color: '#F1F0EB',
      category: 'palette',
      x: 60,
      y: 584,
      w: 236,
      h: 82,
      z: 6,
      inbox: false,
      locked: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: idSwB,
      kind: 'color',
      title: 'Warm Clay',
      text: 'Màu bổ trợ',
      color: '#C5A47E',
      category: 'palette',
      x: 314,
      y: 584,
      w: 236,
      h: 82,
      z: 6,
      inbox: false,
      locked: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: idSwC,
      kind: 'color',
      title: 'Studio Ink',
      text: 'Typography chính',
      color: '#1C1C1E',
      category: 'palette',
      x: 568,
      y: 584,
      w: 236,
      h: 82,
      z: 6,
      inbox: false,
      locked: false,
      createdAt: now,
      updatedAt: now,
    },
  ];

  return {
    id: createId('proj'),
    name,
    description: dict.templateBrandDesc,
    status: 'draft',
    appearance: { background: '#F6F5F1', dots: true },
    view: { x: 100, y: 60, zoom: 0.94 },
    cards,
    trash: [],
    updatedAt: now,
  };
}
