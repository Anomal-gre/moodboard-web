export type CardKind = 'image' | 'note' | 'link' | 'color' | 'file' | 'frame';

export type Category =
  | 'reference'
  | 'furniture'
  | 'palette'
  | 'material'
  | 'sketch'
  | 'other';

export type CaptureMethod =
  | 'picker'
  | 'folder-drop'
  | 'web-drop'
  | 'paste'
  | 'manual'
  | 'sample';

export type ImageStatus = 'ready' | 'remote-only' | 'missing';

export interface Source {
  pageUrl?: string;
  imageUrl?: string;
  fileName?: string;
  method: CaptureMethod;
  capturedAt: string;
}

export interface Card {
  id: string;
  kind: CardKind;
  title: string;
  text: string;
  color?: string;
  category: Category;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  inbox: boolean;
  locked: boolean;
  groupId?: string;
  source?: Source;
  assetId?: string;
  imageStatus?: ImageStatus;
  designFile?: { extension: string; size?: number };
  createdAt: string;
  updatedAt: string;
}

export interface AssetMeta {
  id: string;
  fileName: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  digest?: string;
  samplePath?: string;
}

export interface AssetBytesRecord {
  id: string;
  blob: Blob;
  thumbnail: Blob;
}

export interface TrashItem {
  card: Card;
  removedAt: string;
}

export interface ProjectAppearance {
  background: string;
  dots: boolean;
}

export interface ProjectView {
  x: number;
  y: number;
  zoom: number;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  appearance: ProjectAppearance;
  view: ProjectView;
  cards: Card[];
  trash: TrashItem[];
  updatedAt: string;
}

export interface WorkspaceMeta {
  schemaVersion: 1;
  language: 'vi' | 'en';
  activeProjectId: string;
  createdAt: string;
}

export interface ArrangeOptions {
  mode: 'freeform' | 'grid';
  groupByCategory: boolean;
  overlap: number; // 0..100
}

export interface ExportPngOptions {
  scope: 'all' | 'selection';
  scale: 1 | 2;
  includeBackground: boolean;
  includeSourcesJson: boolean;
}

export interface ClassifySuggestion {
  cardId: string;
  assetId: string;
  cardTitle: string;
  currentCategory: Category;
  suggestedCategory: Category;
  editedCategory: Category;
  relativeScore: number;
  selected: boolean;
  error?: string;
}

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';

export const CATEGORY_ORDER: Category[] = [
  'reference',
  'furniture',
  'palette',
  'material',
  'sketch',
  'other',
];

export const CATEGORY_PROMPTS: Record<Category, string> = {
  reference: 'an interior room, architectural space or building',
  furniture: 'an individual chair, table, sofa, lamp or piece of furniture',
  palette: 'a color palette, paint swatches or color samples',
  material: 'a close-up texture of wood, fabric, stone or tile',
  sketch: 'an architectural floor plan, CAD drawing or hand-drawn sketch',
  other: 'an unrelated photo, screenshot or graphic',
};

export interface BackupAssetEntry {
  meta: AssetMeta;
  base64: string;
}

export interface BackupFileV1 {
  format: 'moodboard-0y03-backup';
  version: 1;
  exportedAt: string;
  project: Project;
  assets: BackupAssetEntry[];
}
