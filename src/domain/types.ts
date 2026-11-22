export type CardKind = 'image' | 'note' | 'link' | 'color' | 'file' | 'frame';

export type Category =
  | 'reference'
  | 'furniture'
  | 'palette'
  | 'material'
  | 'sketch'
  | 'typography'
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
  localPath?: string;
  method: CaptureMethod;
  capturedAt: string;
}

export interface Card {
  id: string;
  kind: CardKind;
  title: string;
  text: string;
  color?: string;
  textColor?: string;
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
  originalAssetId?: string;
  aiClassifiedAssetId?: string;
  imageStatus?: ImageStatus;
  framed?: boolean;
  cutout?: boolean;
  flipH?: boolean;
  crop?: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  linksTo?: string[];
  spec?: {
    code?: string;
    price?: string;
    qty?: number;
  };
  dominantHex?: string;
  rotation?: number; // Subtle visual tilt in degrees (-15..15), undefined/0 = straight
  designFile?: {
    extension: string;
    size?: number;
    mime?: string;
    localPath?: string;
  };
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
  grayscale?: boolean;
}

export interface ProjectView {
  x: number;
  y: number;
  zoom: number;
}

export type ProjectStatus = 'draft' | 'review' | 'approved';

export interface StudioProfile {
  studioName?: string;
  studioContact?: string;
  studioLogoDataUrl?: string;
  currency?: 'VND' | 'USD';
}

export interface Project {
  id: string;
  revision?: number;
  name: string;
  description: string;
  status?: ProjectStatus;
  clientName?: string;
  projectCode?: string;
  pinned?: boolean;
  coverDataUrl?: string;
  appearance: ProjectAppearance;
  view: ProjectView;
  cards: Card[];
  trash: TrashItem[];
  updatedAt: string;
}

export type UserDiscipline = 'interior' | 'ffe' | 'branding' | 'freeform';

export type NavigationMode = 'auto' | 'trackpad' | 'mouse';

export interface WorkspaceMeta {
  schemaVersion: 1;
  language: 'vi' | 'en';
  activeProjectId: string;
  createdAt: string;
  studioProfile?: StudioProfile;
  autoFolderSync?: boolean;
  onboardingCompleted?: boolean;
  userDiscipline?: UserDiscipline;
  navigationMode?: NavigationMode;
}

export type ArrangeMode = 'bento' | 'freeform' | 'zones' | 'grid';

export type AspectPreset = 'free' | '16:9' | 'a4' | '1:1';

export interface ArrangeOptions {
  mode: ArrangeMode;
  groupByCategory: boolean;
  overlap: number; // 0..100: controls hierarchy contrast, organic scatter & corner-inset depth
  galleryFrame?: boolean;
  aspectPreset?: AspectPreset;
  seed?: number; // Deterministic art-direction variation index
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

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error' | 'conflict';

export const CATEGORY_ORDER: Category[] = [
  'reference',
  'furniture',
  'material',
  'palette',
  'sketch',
  'typography',
  'other',
];

export const CATEGORY_PROMPTS: Record<Category, string> = {
  reference: 'a wide scene, architectural space, room environment, landscape or atmospheric mood photo',
  furniture: 'a standalone 3D form, sculpted object, product design, furniture piece or fashion item',
  material: 'a close-up material texture or surface pattern of wood, fabric, stone, paper, tile or metal',
  palette: 'a color palette, paint swatches, color chips, gradient strip or flat color samples',
  sketch: 'a line drawing, hand sketch, geometric shapes, floor plan, wireframe diagram or structural layout',
  typography: 'typography design, bold lettering, typeface specimen, graphic poster with text, editorial magazine cover or wordmark logo',
  other: 'a general reference photo, screenshot or miscellaneous visual note',
};

export interface BackupAssetEntry {
  meta: AssetMeta;
  base64: string;
}

export interface BackupFileV1 {
  format: 'mosa-backup' | 'moodboard-0y03-backup';
  version: 1;
  exportedAt: string;
  project: Project;
  assets: BackupAssetEntry[];
}
