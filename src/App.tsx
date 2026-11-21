import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CircleAlert,
  CircleDashed,
  Download,
  FileArchive,
  ImagePlus,
  Keyboard,
  LayoutGrid,
  Link2,
  LoaderCircle,
  Maximize,
  Minus,
  MoreHorizontal,
  MoveUpRight,
  Palette,
  Plus,
  Presentation,
  Redo2,
  RotateCcw,
  Sparkles,
  StickyNote,
  Trash2,
  Undo2,
} from 'lucide-react';
import type {
  ArrangeOptions,
  Card,
  Category,
  Project,
  ProjectAppearance,
  ProjectView,
  SaveStatus,
  StudioProfile,
  WorkspaceMeta,
} from './domain/types';
import { createEmptyProject, getNextZ } from './domain/project';
import {
  createProjectFromTemplate,
  type ProjectTemplateId,
} from './domain/templates';
import {
  alignSelectedCards,
  clampZoom,
  computeCardsBounds,
  computeFitView,
  getMovableCardIds,
  recomputeFrameBoundsForAll,
  screenToWorld,
  zoomAtScreenPoint,
  type AlignMode,
  type Point,
} from './domain/geometry';
import {
  createEmptyHistory,
  pushHistory,
  stepRedo,
  stepUndo,
  type ProjectHistoryStack,
} from './domain/history';
import { computeArrangedCards } from './domain/arrange';
import {
  createId,
  extractInlineSvg,
  isDarkColor,
  isValidHttpUrl,
  normalizeHex,
  parseDroppedHtml,
} from './domain/validate';
import {
  extractBoard60_30_10Palette,
  extractPaletteFromBlob,
  hexColorDistance,
} from './domain/paletteExtract';
import { getDict, type Language } from './i18n';
import {
  deleteProjectById,
  duplicateProject,
  getAssetBlob,
  initWorkspace,
  putImageAsset,
  revokeAllCachedAssetUrls,
  saveProject,
  saveWorkspaceMeta,
} from './storage/workspaceRepository';
import {
  checkDirectoryPermission,
  getSavedSyncDirectory,
  isFolderSyncSupported,
  openMosaFilePickerNative,
  saveProjectAsMosaFile,
  syncProjectToDirectory,
  type FsDirectoryHandle,
} from './storage/localFolderSync';
import { commitImportedBackup, parseAndValidateBackupFile } from './storage/backup';
import { decodeImageElement } from './storage/assets';
import { resetDbConnection } from './storage/indexedDb';
import { BoardViewport } from './board/BoardViewport';
import { CanvasContextMenu, type ContextMenuState } from './board/CanvasContextMenu';
import { SelectionOverlay } from './board/SelectionOverlay';
import { useBoardInteractions } from './board/useBoardInteractions';
import { ProjectMenu } from './features/projects/ProjectMenu';
import { InspectorPanel } from './features/inspector/InspectorPanel';
import { InboxPanel } from './features/inbox/InboxPanel';
import { SettingsPopover } from './features/appearance/SettingsPopover';
import { SearchBar, type BoardFilterState } from './features/export/SearchBar';
import { renderMoodboardPng, renderProjectCoverDataUrl } from './features/export/exportPng';
import { useClipperBridge } from './features/clipper/useClipperBridge';

const ProjectHubOverlay = lazy(() =>
  import('./features/projects/ProjectHubOverlay').then((m) => ({ default: m.ProjectHubOverlay }))
);
const ArrangeModal = lazy(() =>
  import('./features/export/ArrangeModal').then((m) => ({ default: m.ArrangeModal }))
);
const ExportModal = lazy(() =>
  import('./features/export/ExportModal').then((m) => ({ default: m.ExportModal }))
);
const BackupModal = lazy(() =>
  import('./features/export/BackupModal').then((m) => ({ default: m.BackupModal }))
);
import { ShortcutsModal } from './features/export/ShortcutsModal';
import { AddLinkModal } from './features/capture/AddLinkModal';
import { LightboxModal } from './features/capture/LightboxModal';
import { TrashModal } from './features/capture/TrashModal';
import {
  importDataUrlAsCard,
  importFilesAsCards,
  importInlineSvgAsCard,
  importUrlAsCard,
  importWebDropData,
  replaceCardImageFile,
  replaceCardRawFile,
} from './features/capture/captureService';
import type { CutoutOutboundMessage } from './workers/cutout.worker';
import { openFileCard } from './desktop/tauriBridge';

const CLIPBOARD_MARKER = '__0Y03_CARDS_V1__';

function fitWorkspaceView(
  cards: Card[],
  width: number,
  height: number,
  presenting = false,
  dockedRightWidth = 0
) {
  if (presenting) {
    return computeFitView(cards, width, height, { side: 20, top: 20, bottom: 76 });
  }

  const tokens = getComputedStyle(document.documentElement);
  const baseSide = Math.min(48, Math.round(width * 0.05));
  const rightInset =
    dockedRightWidth > 0 && width > dockedRightWidth + 320
      ? dockedRightWidth + 32
      : baseSide;
  return computeFitView(cards, width, height, {
    side: baseSide,
    left: baseSide,
    right: rightInset,
    top: parseFloat(tokens.getPropertyValue('--workspace-header-height')) + 16,
    bottom: parseFloat(tokens.getPropertyValue('--workspace-footer-clearance')) + 16,
  });
}

export const App: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [storageFatal, setStorageFatal] = useState<string | null>(null);
  const [meta, setMeta] = useState<WorkspaceMeta | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');

  // Selection, editing & UI modes
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [croppingCardId, setCroppingCardId] = useState<string | null>(null);
  const [cuttingOutCardId, setCuttingOutCardId] = useState<string | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null);
  const [connectCursorWorld, setConnectCursorWorld] = useState<Point | null>(null);
  const [boardFilter, setBoardFilter] = useState<BoardFilterState>({
    category: null,
    colorHex: null,
    duplicatesOnly: false,
  });
  const [highlightedCardId, setHighlightedCardId] = useState<string | null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [presentMode, setPresentMode] = useState(false);
  const prePresentViewRef = useRef<ProjectView | null>(null);

  // Modals
  const [arrangeOpen, setArrangeOpen] = useState(false);
  const [arrangePreviewCards, setArrangePreviewCards] = useState<Card[] | null>(null);
  const [arrangeAnimating, setArrangeAnimating] = useState(false);
  const arrangeAnimTimerRef = useRef<number | null>(null);
  const lastPreviewFitKeyRef = useRef<string | null>(null);
  const internalClipboardRef = useRef<{
    cards: Card[];
    pngSize: number;
    copiedAt: number;
  } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [projectHubOpen, setProjectHubOpen] = useState(false);
  const [syncFolderHandle, setSyncFolderHandle] = useState<FsDirectoryHandle | null>(null);
  const syncFolderRef = useRef<FsDirectoryHandle | null>(null);
  syncFolderRef.current = syncFolderHandle;
  const folderSyncTimersRef = useRef<Map<string, number>>(new Map());
  const metaRef = useRef<WorkspaceMeta | null>(meta);
  metaRef.current = meta;
  const [addLinkOpen, setAddLinkOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [lightboxCardId, setLightboxCardId] = useState<string | null>(null);

  // Toast notifications
  const [toast, setToast] = useState<{ text: string; isError?: boolean } | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  // Refs for DOM, file pickers, history, debounce
  const boardRef = useRef<HTMLDivElement | null>(null);
  const filePickerRef = useRef<HTMLInputElement | null>(null);
  const replacePickerRef = useRef<HTMLInputElement | null>(null);
  const replaceTargetCardRef = useRef<Card | null>(null);
  const replaceFilePickerRef = useRef<HTMLInputElement | null>(null);
  const replaceTargetFileCardRef = useRef<Card | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const historyMapRef = useRef<Map<string, ProjectHistoryStack>>(new Map());
  const [, bumpHistoryVersion] = useState(0);
  const saveTimersRef = useRef<Map<string, number>>(new Map());
  const projectsRef = useRef<Project[]>(projects);
  projectsRef.current = projects;
  const activeProjectIdRef = useRef<string>(activeProjectId);
  activeProjectIdRef.current = activeProjectId;

  const [viewportSize, setViewportSize] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1440,
    height: typeof window !== 'undefined' ? window.innerHeight : 900,
  }));

  const showToast = useCallback((text: string, isError = false) => {
    setToast({ text, isError });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), isError ? 5200 : 3000);
  }, []);

  // Boot workspace from IndexedDB
  const bootWorkspace = useCallback(async () => {
    setLoading(true);
    setStorageFatal(null);
    resetDbConnection();
    try {
      const init = await initWorkspace();
      setMeta(init.meta);
      setProjects(init.projects);
      setActiveProjectId(init.activeProject.id);
      if (isFolderSyncSupported()) {
        getSavedSyncDirectory()
          .then((h) => setSyncFolderHandle(h))
          .catch(() => undefined);
      }

      // Fit board nicely on first visit to sample board
      if (
        init.projects.length === 1 &&
        init.activeProject.id === 'proj_sample_living_01' &&
        init.activeProject.view.x === 80 &&
        init.activeProject.view.y === 90
      ) {
        const boardCards = init.activeProject.cards.filter((c) => !c.inbox);
        const fitted = fitWorkspaceView(boardCards, window.innerWidth, window.innerHeight);
        const fittedProj: Project = { ...init.activeProject, view: fitted };
        setProjects([fittedProj]);
        void saveProject(fittedProj);
      }
    } catch (err) {
      setStorageFatal(err instanceof Error ? err.message : 'Lỗi khởi tạo lưu trữ cục bộ.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void bootWorkspace();
    return () => {
      revokeAllCachedAssetUrls();
    };
  }, [bootWorkspace]);

  // Track window resize
  useEffect(() => {
    const onResize = () =>
      setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Close More Menu on outside click
  useEffect(() => {
    if (!moreMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!moreMenuRef.current?.contains(e.target as Node)) setMoreMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [moreMenuOpen]);

  // Warn before unload if unsaved/error
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (saveStatus === 'saving' || saveStatus === 'unsaved' || saveStatus === 'error') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [saveStatus]);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? projects[0] ?? null,
    [projects, activeProjectId]
  );

  const language: Language = meta?.language ?? 'vi';
  const dict = useMemo(() => getDict(language), [language]);
  const darkTheme = activeProject ? isDarkColor(activeProject.appearance.background) : false;

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = dict.pageTitle;
  }, [language, dict.pageTitle]);

  useEffect(() => {
    document.documentElement.classList.toggle('theme-dark', darkTheme);
    document.documentElement.style.colorScheme = darkTheme ? 'dark' : 'light';

    // Sync OS / Edge --app / PWA Window Title Bar color dynamically with Light/Dark mode
    const titleBarColor = darkTheme ? '#1c1c1e' : '#f2f2f7';
    let metaTheme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!metaTheme) {
      metaTheme = document.createElement('meta');
      metaTheme.name = 'theme-color';
      document.head.appendChild(metaTheme);
    }
    metaTheme.content = titleBarColor;

    return () => {
      document.documentElement.classList.remove('theme-dark');
    };
  }, [darkTheme]);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const displayedCards = useMemo(
    () => arrangePreviewCards ?? activeProject?.cards ?? [],
    [arrangePreviewCards, activeProject?.cards]
  );

  const inboxCards = useMemo(
    () => (activeProject?.cards ?? []).filter((c) => c.inbox),
    [activeProject?.cards]
  );

  const selectedCards = useMemo(() => {
    const set = new Set(selectedIds);
    return (activeProject?.cards ?? []).filter((c) => !c.inbox && set.has(c.id));
  }, [activeProject?.cards, selectedIds]);

  const singleSelectedCard = selectedCards.length === 1 ? selectedCards[0] : null;
  const lightboxCard = useMemo(
    () => (activeProject?.cards ?? []).find((c) => c.id === lightboxCardId) ?? null,
    [activeProject?.cards, lightboxCardId]
  );

  const blockingModalOpen =
    projectHubOpen ||
    exportOpen ||
    backupOpen ||
    addLinkOpen ||
    trashOpen ||
    Boolean(lightboxCardId);

  const anyModalOpen = arrangeOpen || blockingModalOpen;

  // Persistence helper: immediate or debounced per project
  const persistProject = useCallback(
    (project: Project, debounceMs = 0) => {
      const existingTimer = saveTimersRef.current.get(project.id);
      if (existingTimer) window.clearTimeout(existingTimer);

      const doWrite = async () => {
        saveTimersRef.current.delete(project.id);
        setSaveStatus('saving');
        try {
          await saveProject(project);
          setSaveStatus('saved');

          // Debounced background .mosa folder mirror if user linked a local directory
          const handle = syncFolderRef.current;
          if (handle && metaRef.current?.autoFolderSync) {
            const prevSyncTimer = folderSyncTimersRef.current.get(project.id);
            if (prevSyncTimer) window.clearTimeout(prevSyncTimer);
            const syncTimer = window.setTimeout(async () => {
              folderSyncTimersRef.current.delete(project.id);
              try {
                const granted = await checkDirectoryPermission(handle, false);
                if (granted) {
                  await syncProjectToDirectory(handle, project);
                }
              } catch {
                // Silent background retry next edit
              }
            }, 2400);
            folderSyncTimersRef.current.set(project.id, syncTimer);
          }
        } catch (err) {
          setSaveStatus('error');
          showToast(
            err instanceof Error ? err.message : dict.saveLocalError,
            true
          );
        }
      };

      if (debounceMs > 0) {
        setSaveStatus('unsaved');
        const id = window.setTimeout(() => void doWrite(), debounceMs);
        saveTimersRef.current.set(project.id, id);
      } else {
        void doWrite();
      }
    },
    [showToast]
  );

  const getHistoryStack = useCallback((projectId: string): ProjectHistoryStack => {
    let stack = historyMapRef.current.get(projectId);
    if (!stack) {
      stack = createEmptyHistory();
      historyMapRef.current.set(projectId, stack);
    }
    return stack;
  }, []);

  /**
   * Central project mutation entry point - supports targeted projectId (W10, W17!)
   * and optional single-step Undo recording.
   */
  const mutateProject = useCallback(
    (
      targetProjectId: string,
      updater: (prev: Project) => Project,
      opts?: { recordUndo?: boolean; debounceMs?: number }
    ) => {
      const prevProject = projectsRef.current.find((p) => p.id === targetProjectId);
      if (!prevProject) return;

      if (opts?.recordUndo) {
        const nextStack = pushHistory(getHistoryStack(targetProjectId), prevProject);
        historyMapRef.current.set(targetProjectId, nextStack);
        bumpHistoryVersion((v) => v + 1);
      }

      const nextProject: Project = {
        ...updater(prevProject),
        updatedAt: new Date().toISOString(),
      };

      const nextList = projectsRef.current.map((p) => (p.id === targetProjectId ? nextProject : p));
      projectsRef.current = nextList;
      setProjects(nextList);
      persistProject(nextProject, opts?.debounceMs ?? 0);
    },
    [getHistoryStack, persistProject]
  );

  // Undo & Redo
  const activeHistory = activeProject ? getHistoryStack(activeProject.id) : createEmptyHistory();
  const canUndo = activeHistory.past.length > 0;
  const canRedo = activeHistory.future.length > 0;

  const handleUndo = useCallback(() => {
    if (!activeProject) return;
    const res = stepUndo(getHistoryStack(activeProject.id), activeProject);
    if (!res) return;
    historyMapRef.current.set(activeProject.id, res.stack);
    bumpHistoryVersion((v) => v + 1);
    setProjects((list) => list.map((p) => (p.id === activeProject.id ? res.project : p)));
    setSelectedIds([]);
    persistProject(res.project, 0);
  }, [activeProject, getHistoryStack, persistProject]);

  const handleRedo = useCallback(() => {
    if (!activeProject) return;
    const res = stepRedo(getHistoryStack(activeProject.id), activeProject);
    if (!res) return;
    historyMapRef.current.set(activeProject.id, res.stack);
    bumpHistoryVersion((v) => v + 1);
    setProjects((list) => list.map((p) => (p.id === activeProject.id ? res.project : p)));
    setSelectedIds([]);
    persistProject(res.project, 0);
  }, [activeProject, getHistoryStack, persistProject]);

  // Viewport controls (stored outside content Undo)
  const handleViewChange = useCallback(
    (nextView: ProjectView, commit = false) => {
      const pid = activeProjectIdRef.current;
      if (!pid) return;
      setProjects((list) =>
        list.map((p) => (p.id === pid ? { ...p, view: nextView } : p))
      );
      if (commit) {
        const cur = projectsRef.current.find((p) => p.id === pid);
        if (cur) persistProject({ ...cur, view: nextView }, 380);
      }
    },
    [persistProject]
  );

  const getViewportCenterWorld = useCallback((): Point => {
    const view = activeProject?.view ?? { x: 0, y: 0, zoom: 1 };
    return screenToWorld(
      { x: viewportSize.width / 2, y: viewportSize.height / 2 },
      view
    );
  }, [activeProject?.view, viewportSize.height, viewportSize.width]);

  const handleFitBoard = useCallback(() => {
    if (!activeProject) return;
    const sourceCards = arrangePreviewCards ?? activeProject.cards;
    const boardCards = sourceCards.filter((c) => !c.inbox);
    const nextView = fitWorkspaceView(
      boardCards,
      viewportSize.width,
      viewportSize.height,
      false,
      arrangeOpen ? 360 : 0
    );
    handleViewChange(nextView, true);
  }, [activeProject, arrangeOpen, arrangePreviewCards, handleViewChange, viewportSize.height, viewportSize.width]);

  const handleZoomStep = useCallback(
    (factor: number) => {
      if (!activeProject) return;
      const center = { x: viewportSize.width / 2, y: viewportSize.height / 2 };
      const next = zoomAtScreenPoint(
        activeProject.view,
        center,
        clampZoom(activeProject.view.zoom * factor)
      );
      handleViewChange(next, true);
    },
    [activeProject, handleViewChange, viewportSize.height, viewportSize.width]
  );

  const handleZoomReset = useCallback(() => {
    if (!activeProject) return;
    const center = { x: viewportSize.width / 2, y: viewportSize.height / 2 };
    handleViewChange(zoomAtScreenPoint(activeProject.view, center, 1), true);
  }, [activeProject, handleViewChange, viewportSize.height, viewportSize.width]);

  // Project Management
  const handleSelectProject = useCallback(
    (id: string) => {
      setActiveProjectId(id);
      setSelectedIds([]);
      setEditingCardId(null);
      setArrangePreviewCards(null);
      if (meta) {
        const nextMeta: WorkspaceMeta = { ...meta, activeProjectId: id };
        setMeta(nextMeta);
        void saveWorkspaceMeta(nextMeta);
      }
    },
    [meta]
  );

  const handleCreateProject = useCallback(
    (name: string) => {
      const created = createEmptyProject(name);
      setProjects((list) => [created, ...list]);
      setActiveProjectId(created.id);
      setSelectedIds([]);
      setEditingCardId(null);
      persistProject(created, 0);
      if (meta) {
        const nextMeta: WorkspaceMeta = { ...meta, activeProjectId: created.id };
        setMeta(nextMeta);
        void saveWorkspaceMeta(nextMeta);
      }
    },
    [meta, persistProject]
  );

  const handleRenameProject = useCallback(
    (id: string, name: string) => {
      mutateProject(id, (p) => ({ ...p, name }), { recordUndo: true });
    },
    [mutateProject]
  );

  const handleDeleteProject = useCallback(
    async (id: string) => {
      if (projectsRef.current.length <= 1) return;
      await deleteProjectById(id);
      const remaining = projectsRef.current.filter((p) => p.id !== id);
      setProjects(remaining);
      if (activeProjectIdRef.current === id && remaining[0]) {
        handleSelectProject(remaining[0].id);
      }
    },
    [handleSelectProject]
  );

  const handleChangeLanguage = useCallback(
    (lang: Language) => {
      if (!meta) return;
      const nextMeta: WorkspaceMeta = { ...meta, language: lang };
      setMeta(nextMeta);
      void saveWorkspaceMeta(nextMeta);
    },
    [meta]
  );

  const handleChangeStudioProfile = useCallback(
    (studioProfile: StudioProfile) => {
      if (!meta) return;
      const nextMeta: WorkspaceMeta = { ...meta, studioProfile };
      setMeta(nextMeta);
      void saveWorkspaceMeta(nextMeta);
    },
    [meta]
  );

  const handleChangeAutoFolderSync = useCallback(
    (autoFolderSync: boolean) => {
      if (!meta) return;
      const nextMeta: WorkspaceMeta = { ...meta, autoFolderSync };
      setMeta(nextMeta);
      void saveWorkspaceMeta(nextMeta);
    },
    [meta]
  );

  const handleOpenProjectHub = useCallback(() => {
    setArrangeOpen(false);
    setArrangePreviewCards(null);
    setSettingsOpen(false);
    setMoreMenuOpen(false);
    setInboxOpen(false);
    setContextMenu(null);
    setProjectHubOpen(true);

    // Lazily refresh cover thumbnail of active project so Home Hub shows fresh board artwork
    const cur = projectsRef.current.find((p) => p.id === activeProjectIdRef.current);
    if (cur && cur.cards.some((c) => !c.inbox && c.kind !== 'frame')) {
      void renderProjectCoverDataUrl(cur).then((coverDataUrl) => {
        if (!coverDataUrl) return;
        const target = projectsRef.current.find((p) => p.id === cur.id);
        if (!target) return;
        const updated = { ...target, coverDataUrl };
        setProjects((list) => list.map((p) => (p.id === cur.id ? updated : p)));
        void saveProject(updated);
      });
    }
  }, []);

  const handleCreateFromTemplate = useCallback(
    (templateId: ProjectTemplateId, customName?: string) => {
      const created = createProjectFromTemplate(templateId, customName, dict);
      const nextList = [created, ...projectsRef.current];
      projectsRef.current = nextList;
      setProjects(nextList);
      setActiveProjectId(created.id);
      setSelectedIds([]);
      setEditingCardId(null);
      persistProject(created, 0);
      if (meta) {
        const nextMeta: WorkspaceMeta = { ...meta, activeProjectId: created.id };
        setMeta(nextMeta);
        void saveWorkspaceMeta(nextMeta);
      }
    },
    [dict, meta, persistProject]
  );

  const handleDuplicateProject = useCallback(
    async (source: Project) => {
      const cloned = await duplicateProject(source, dict.homeCopySuffix);
      const nextList = [cloned, ...projectsRef.current];
      projectsRef.current = nextList;
      setProjects(nextList);
      showToast(dict.homeDuplicatedToast);
    },
    [dict.homeCopySuffix, dict.homeDuplicatedToast, showToast]
  );

  const handleUpdateProjectMeta = useCallback(
    (
      id: string,
      patch: Partial<Pick<Project, 'name' | 'status' | 'clientName' | 'projectCode' | 'pinned'>>
    ) => {
      mutateProject(id, (p) => ({ ...p, ...patch }), { recordUndo: false });
    },
    [mutateProject]
  );

  const handleExportMosaFileQuick = useCallback(
    async (proj: Project) => {
      try {
        const ok = await saveProjectAsMosaFile(proj);
        if (ok) showToast(dict.backupExportSuccess);
      } catch (err) {
        showToast(err instanceof Error ? err.message : dict.backupExportError, true);
      }
    },
    [dict.backupExportError, dict.backupExportSuccess, showToast]
  );

  const handleOpenMosaFileQuick = useCallback(async () => {
    const file = await openMosaFilePickerNative();
    if (!file) return;
    const res = await parseAndValidateBackupFile(file);
    if (!res.ok) {
      showToast(res.reason, true);
      return;
    }
    try {
      const imported = await commitImportedBackup(res.data);
      const nextList = [imported, ...projectsRef.current];
      projectsRef.current = nextList;
      setProjects(nextList);
      handleSelectProject(imported.id);
      setProjectHubOpen(false);
      showToast(dict.projectImportedToast(imported.name));
    } catch (err) {
      showToast(err instanceof Error ? err.message : dict.backupImportError, true);
    }
  }, [dict, handleSelectProject, showToast]);

  // Listen to Chrome / Edge Mosa Web Clipper extension bridge (localhost only)
  const handleWebClipReceived = useCallback(
    (clipCard: Card) => {
      const targetId = activeProjectIdRef.current;
      if (!targetId) return;
      mutateProject(
        targetId,
        (p) => ({
          ...p,
          cards: [...p.cards, { ...clipCard, z: getNextZ(p.cards) }],
        }),
        { recordUndo: true }
      );
      showToast(dict.clipperReceivedToast(clipCard.title || 'Web Clip'));
    },
    [dict, mutateProject, showToast]
  );

  const { bridgeAvailable: clipperBridgeReady } = useClipperBridge(
    !loading && Boolean(activeProjectId),
    language,
    handleWebClipReceived
  );

  const handleChangeAppearance = useCallback(
    (appearance: ProjectAppearance) => {
      if (!activeProject) return;
      mutateProject(activeProject.id, (p) => ({ ...p, appearance }), { recordUndo: false });
    },
    [activeProject, mutateProject]
  );

  // Card Creation Helpers
  const createNoteAt = useCallback(
    (worldPt: Point) => {
      if (!activeProject) return;
      const now = new Date().toISOString();
      const card: Card = {
        id: createId('crd'),
        kind: 'note',
        title: dict.defaultNoteTitle,
        text: '',
        color: '#FAF7EE',
        category: 'other',
        x: Math.round(worldPt.x - 120),
        y: Math.round(worldPt.y - 60),
        w: 252,
        h: 148,
        z: getNextZ(activeProject.cards),
        inbox: false,
        locked: false,
        createdAt: now,
        updatedAt: now,
      };
      mutateProject(activeProject.id, (p) => ({ ...p, cards: [...p.cards, card] }), {
        recordUndo: true,
      });
      setSelectedIds([card.id]);
      setEditingCardId(card.id);
    },
    [activeProject, mutateProject]
  );

  const createColorCard = useCallback(
    (worldPt?: Point) => {
      if (!activeProject) return;
      const pt = worldPt ?? getViewportCenterWorld();
      const now = new Date().toISOString();
      const card: Card = {
        id: createId('crd'),
        kind: 'color',
        title: 'Sage',
        text: '',
        color: '#8D9A7C',
        category: 'palette',
        x: Math.round(pt.x - 86),
        y: Math.round(pt.y - 52),
        w: 174,
        h: 104,
        z: getNextZ(activeProject.cards),
        inbox: false,
        locked: false,
        createdAt: now,
        updatedAt: now,
      };
      mutateProject(activeProject.id, (p) => ({ ...p, cards: [...p.cards, card] }), {
        recordUndo: true,
      });
      setSelectedIds([card.id]);
    },
    [activeProject, getViewportCenterWorld, mutateProject]
  );

  // Group / Ungroup
  const handleGroupSelected = useCallback(() => {
    if (!activeProject) return;
    const selSet = new Set(selectedIds);
    const members = activeProject.cards.filter(
      (c) => selSet.has(c.id) && !c.inbox && !c.locked && c.kind !== 'frame'
    );
    if (members.length < 2) return;
    const bounds = computeCardsBounds(members);
    if (!bounds) return;

    const now = new Date().toISOString();
    const frameId = createId('frm');
    const minZ = Math.min(...members.map((m) => m.z));
    const frame: Card = {
      id: frameId,
      kind: 'frame',
      title: dict.defaultGroupTitle,
      text: '',
      category: 'other',
      x: Math.round(bounds.x - 24),
      y: Math.round(bounds.y - 62),
      w: Math.round(bounds.w + 48),
      h: Math.round(bounds.h + 86),
      z: Math.max(1, minZ - 1),
      inbox: false,
      locked: false,
      createdAt: now,
      updatedAt: now,
    };
    const memberIds = new Set(members.map((m) => m.id));
    mutateProject(
      activeProject.id,
      (p) => ({
        ...p,
        cards: [
          ...p.cards.map((c) => (memberIds.has(c.id) ? { ...c, groupId: frameId } : c)),
          frame,
        ],
      }),
      { recordUndo: true }
    );
    setSelectedIds([frameId]);
  }, [activeProject, mutateProject, selectedIds]);

  const handleUngroup = useCallback(
    (specificFrameId?: string) => {
      if (!activeProject) return;
      const frameIds = new Set<string>();
      if (specificFrameId) {
        frameIds.add(specificFrameId);
      } else {
        for (const c of selectedCards) {
          if (c.kind === 'frame') frameIds.add(c.id);
          if (c.groupId) frameIds.add(c.groupId);
        }
      }
      if (frameIds.size === 0) return;

      mutateProject(
        activeProject.id,
        (p) => ({
          ...p,
          cards: p.cards
            .filter((c) => !frameIds.has(c.id))
            .map((c) => (c.groupId && frameIds.has(c.groupId) ? { ...c, groupId: undefined } : c)),
        }),
        { recordUndo: true }
      );
      setSelectedIds([]);
    },
    [activeProject, mutateProject, selectedCards]
  );

  // Duplicate / Delete / Restore / Inbox
  const handleDuplicateIds = useCallback(
    (ids: string[]) => {
      if (!activeProject || ids.length === 0) return;
      const targetIds = getMovableCardIds(activeProject.cards, ids);
      // Allow duplicating locked cards too (duplicating creates an unlocked copy)
      const idSet = new Set([...targetIds, ...ids]);
      const sourceCards = activeProject.cards.filter((c) => idSet.has(c.id) && !c.inbox);
      if (sourceCards.length === 0) return;

      const now = new Date().toISOString();
      let nextZ = getNextZ(activeProject.cards);
      const idMap = new Map<string, string>();
      for (const c of sourceCards) {
        idMap.set(c.id, createId(c.kind === 'frame' ? 'frm' : 'crd'));
      }

      const clones: Card[] = sourceCards.map((c) => ({
        ...c,
        id: idMap.get(c.id)!,
        groupId: c.groupId ? idMap.get(c.groupId) : undefined,
        x: c.x + 24,
        y: c.y + 24,
        z: c.kind === 'frame' ? nextZ : ++nextZ,
        locked: false,
        source: c.source ? { ...c.source } : undefined,
        designFile: c.designFile ? { ...c.designFile } : undefined,
        createdAt: now,
        updatedAt: now,
      }));

      mutateProject(
        activeProject.id,
        (p) => ({ ...p, cards: [...p.cards, ...clones] }),
        { recordUndo: true }
      );
      setSelectedIds(clones.map((c) => c.id));
    },
    [activeProject, mutateProject]
  );

  const handleDeleteIdsToTrash = useCallback(
    (ids: string[]) => {
      if (!activeProject || ids.length === 0) return;
      const idSet = new Set(ids);
      const deletedFrames = new Set(
        activeProject.cards.filter((c) => idSet.has(c.id) && c.kind === 'frame').map((c) => c.id)
      );
      const toTrash = activeProject.cards.filter((c) => idSet.has(c.id));
      if (toTrash.length === 0) return;

      const now = new Date().toISOString();
      mutateProject(
        activeProject.id,
        (p) => ({
          ...p,
          cards: p.cards
            .filter((c) => !idSet.has(c.id))
            .map((c) =>
              c.groupId && deletedFrames.has(c.groupId) ? { ...c, groupId: undefined } : c
            ),
          trash: [
            ...toTrash.map((card) => ({ card, removedAt: now })),
            ...p.trash,
          ],
        }),
        { recordUndo: true }
      );
      setSelectedIds((prev) => prev.filter((id) => !idSet.has(id)));
    },
    [activeProject, mutateProject]
  );

  const handleRestoreFromTrash = useCallback(
    (cardId: string) => {
      if (!activeProject) return;
      const item = activeProject.trash.find((t) => t.card.id === cardId);
      if (!item) return;

      mutateProject(
        activeProject.id,
        (p) => {
          const existingFrameIds = new Set(
            p.cards.filter((c) => c.kind === 'frame').map((c) => c.id)
          );
          const restored: Card = {
            ...item.card,
            groupId:
              item.card.groupId && existingFrameIds.has(item.card.groupId)
                ? item.card.groupId
                : undefined,
            updatedAt: new Date().toISOString(),
          };
          return {
            ...p,
            cards: [...p.cards, restored],
            trash: p.trash.filter((t) => t.card.id !== cardId),
          };
        },
        { recordUndo: true }
      );
    },
    [activeProject, mutateProject]
  );

  const handleMoveToInbox = useCallback(
    (ids: string[]) => {
      if (!activeProject || ids.length === 0) return;
      const set = new Set(ids);
      mutateProject(
        activeProject.id,
        (p) => ({
          ...p,
          cards: p.cards.map((c) =>
            set.has(c.id) && c.kind !== 'frame'
              ? { ...c, inbox: true, groupId: undefined, locked: false }
              : c
          ),
        }),
        { recordUndo: true }
      );
      setSelectedIds((prev) => prev.filter((id) => !set.has(id)));
      setInboxOpen(true);
    },
    [activeProject, mutateProject]
  );

  const handleMoveFromInboxToBoard = useCallback(
    (cardId: string, dropWorldPoint?: Point) => {
      if (!activeProject) return;
      const boardCards = activeProject.cards.filter((c) => !c.inbox);
      const card = activeProject.cards.find((c) => c.id === cardId);
      let targetPt = dropWorldPoint;
      if (!targetPt && card) {
        const bounds = computeCardsBounds(boardCards);
        if (bounds) {
          targetPt = {
            x: bounds.x + Math.round(card.w / 2),
            y: bounds.y + bounds.h + 28 + Math.round(card.h / 2),
          };
        } else {
          targetPt = getViewportCenterWorld();
        }
      }
      const pt = targetPt ?? getViewportCenterWorld();
      mutateProject(
        activeProject.id,
        (p) => {
          const nextZ = getNextZ(p.cards);
          return {
            ...p,
            cards: p.cards.map((c) =>
              c.id === cardId
                ? {
                    ...c,
                    inbox: false,
                    x: Math.round(pt.x - c.w / 2),
                    y: Math.round(pt.y - c.h / 2),
                    z: nextZ,
                  }
                : c
            ),
          };
        },
        { recordUndo: true }
      );
      setSelectedIds([cardId]);
    },
    [activeProject, getViewportCenterWorld, mutateProject]
  );

  // Capture / Import with pinned projectId & worldPoint (W10!)
  const appendImportedCards = useCallback(
    (targetProjectId: string, newCards: Card[], errors: string[]) => {
      if (errors.length > 0) {
        showToast(errors.join(' · '), true);
      }
      if (newCards.length === 0) return;
      mutateProject(
        targetProjectId,
        (p) => ({ ...p, cards: [...p.cards, ...newCards] }),
        { recordUndo: true }
      );
      if (targetProjectId === activeProjectIdRef.current) {
        const boardAdded = newCards.filter((c) => !c.inbox).map((c) => c.id);
        if (boardAdded.length > 0) setSelectedIds(boardAdded);
      }
    },
    [mutateProject, showToast]
  );

  const handleFilesSelected = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0 || !activeProject) return;
      const pinnedProjectId = activeProject.id;
      const pinnedWorld = getViewportCenterWorld();
      const baseZ = getNextZ(activeProject.cards);
      const fileArr = Array.from(files);
      showToast(dict.readingImages);
      const res = await importFilesAsCards(fileArr, {
        inbox: false,
        worldPoint: { x: pinnedWorld.x - 140, y: pinnedWorld.y - 100 },
        baseZ,
        method: 'picker',
      });
      appendImportedCards(pinnedProjectId, res.cards, res.errors);
    },
    [activeProject, appendImportedCards, dict.readingImages, getViewportCenterWorld, showToast]
  );

  const handleDropExternal = useCallback(
    async (dt: DataTransfer, worldPoint: Point, toInbox: boolean) => {
      const pid = activeProjectIdRef.current;
      const proj = projectsRef.current.find((p) => p.id === pid);
      if (!proj) return;
      const baseZ = getNextZ(proj.cards);
      const res = await importWebDropData(dt, {
        inbox: toInbox,
        worldPoint,
        baseZ,
      });
      appendImportedCards(pid, res.cards, res.errors);
    },
    [appendImportedCards]
  );

  const handleAddLinkSubmit = useCallback(
    async (url: string, title: string, tryAsImage: boolean) => {
      if (!activeProject) return;
      const pid = activeProject.id;
      const pt = getViewportCenterWorld();
      const baseZ = getNextZ(activeProject.cards);
      const res = await importUrlAsCard(url, {
        title,
        tryAsImage,
        inbox: false,
        worldPoint: { x: pt.x - 130, y: pt.y - 60 },
        baseZ,
        method: 'manual',
      });
      appendImportedCards(pid, res.cards, res.errors);
    },
    [activeProject, appendImportedCards, getViewportCenterWorld]
  );

  const handleReplaceImagePicked = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      const target = replaceTargetCardRef.current;
      const pid = activeProjectIdRef.current;
      if (!file || !target || !pid) return;
      try {
        const metaRes = await replaceCardImageFile(file);
        // Preserve ID, coordinates, category, caption, and existing web source URLs (W08!)
        mutateProject(
          pid,
          (p) => ({
            ...p,
            cards: p.cards.map((c) =>
              c.id === target.id
                ? {
                    ...c,
                    assetId: metaRes.assetId,
                    imageStatus: 'ready',
                    source: {
                      ...(c.source ?? { method: 'picker', capturedAt: new Date().toISOString() }),
                      fileName: file.name,
                    },
                  }
                : c
            ),
          }),
          { recordUndo: true }
        );
      } catch (err) {
        showToast(err instanceof Error ? err.message : dict.replaceImageError, true);
      } finally {
        replaceTargetCardRef.current = null;
      }
    },
    [mutateProject, showToast]
  );

  const handleOpenFileCard = useCallback(
    async (card: Card) => {
      const res = await openFileCard(card);
      showToast(res.message, !res.ok);
      if (res.needsRelink) {
        replaceTargetFileCardRef.current = card;
        replaceFilePickerRef.current?.click();
      }
    },
    [showToast]
  );

  const handleReplaceFilePicked = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      const target = replaceTargetFileCardRef.current;
      const pid = activeProjectIdRef.current;
      if (!file || !target || !pid) return;
      try {
        const metaRes = await replaceCardRawFile(file);
        const now = new Date().toISOString();
        const updatedCard: Card = {
          ...target,
          title: metaRes.fileName,
          assetId: metaRes.assetId,
          designFile: {
            extension: metaRes.extension,
            size: metaRes.size,
            mime: metaRes.mime,
            localPath: metaRes.localPath,
          },
          source: {
            ...(target.source ?? { method: 'picker', capturedAt: now }),
            fileName: metaRes.fileName,
            localPath: metaRes.localPath,
          },
          updatedAt: now,
        };
        mutateProject(
          pid,
          (p) => ({
            ...p,
            cards: p.cards.map((c) => (c.id === target.id ? updatedCard : c)),
          }),
          { recordUndo: true }
        );
        const openRes = await openFileCard(updatedCard);
        showToast(openRes.message, !openRes.ok);
      } catch (err) {
        showToast(err instanceof Error ? err.message : dict.relinkFileError, true);
      } finally {
        replaceTargetFileCardRef.current = null;
      }
    },
    [mutateProject, showToast]
  );

  // Bonus: Extract dominant palette swatches from photo
  const handleExtractPalette = useCallback(
    async (card: Card) => {
      if (!activeProject || !card.assetId) return;
      const blob = await getAssetBlob(card.assetId, true);
      if (!blob) return;
      const swatches = await extractPaletteFromBlob(blob, 3);
      if (swatches.length === 0) return;

      const now = new Date().toISOString();
      let z = getNextZ(activeProject.cards);
      const newCards: Card[] = swatches.map((sw, idx) => ({
        id: createId('crd'),
        kind: 'color',
        title: `${card.title.slice(0, 14) || 'Swatch'} · ${idx + 1}`,
        text: '',
        color: sw.hex,
        category: 'palette',
        x: Math.round(card.x + card.w + 20),
        y: Math.round(card.y + idx * 102),
        w: 162,
        h: 92,
        z: ++z,
        inbox: false,
        locked: false,
        createdAt: now,
        updatedAt: now,
      }));
      mutateProject(
        activeProject.id,
        (p) => ({ ...p, cards: [...p.cards, ...newCards] }),
        { recordUndo: true }
      );
      setSelectedIds(newCards.map((c) => c.id));
    },
    [activeProject, mutateProject]
  );

  // Phase 2.3: Board-wide 60-30-10 Interior Color Rule Palette Generator
  const handleGenerateBoardPalette = useCallback(async () => {
    const proj = projectsRef.current.find((p) => p.id === activeProjectIdRef.current);
    if (!proj) return;
    const imgCards = proj.cards.filter((c) => !c.inbox && c.kind === 'image' && c.assetId);
    if (imgCards.length === 0) return;

    const blobs: Blob[] = [];
    for (const c of imgCards) {
      const b = await getAssetBlob(c.assetId!, true);
      if (b) blobs.push(b);
    }
    if (blobs.length === 0) return;

    const swatches = await extractBoard60_30_10Palette(blobs, {
      role60: dict.role60,
      role30: dict.role30,
      role10: dict.role10,
    });
    if (swatches.length === 0) return;

    const bounds = computeCardsBounds(proj.cards.filter((c) => !c.inbox));
    const startX = bounds ? Math.round(bounds.x) : 120;
    const startY = bounds ? Math.round(bounds.y + bounds.h + 32) : 420;
    const now = new Date().toISOString();
    let z = getNextZ(proj.cards);

    const newCards: Card[] = swatches.map((sw, idx) => ({
      id: createId('crd'),
      kind: 'color',
      title: sw.name,
      text: '',
      color: sw.hex,
      category: 'palette',
      x: startX + idx * 176,
      y: startY,
      w: 162,
      h: 96,
      z: ++z,
      inbox: false,
      locked: false,
      createdAt: now,
      updatedAt: now,
    }));

    mutateProject(
      proj.id,
      (p) => ({ ...p, cards: [...p.cards, ...newCards] }),
      { recordUndo: true }
    );
    setSelectedIds(newCards.map((c) => c.id));
    showToast(dict.boardPaletteCreatedToast);
  }, [dict, mutateProject, showToast]);

  // Phase 2.3: Native Screen Eyedropper (Chromium EyeDropper API + fallback)
  const handlePickEyedropperColor = useCallback(
    async (targetCardId?: string) => {
      if (!activeProject) return;
      let pickedHex: string | null = null;
      const EyeDropperCtor = (
        window as unknown as {
          EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> };
        }
      ).EyeDropper;

      if (EyeDropperCtor) {
        try {
          const dropper = new EyeDropperCtor();
          const res = await dropper.open();
          pickedHex = normalizeHex(res.sRGBHex);
        } catch {
          return; // User cancelled with Esc
        }
      } else {
        const imgCard =
          activeProject.cards.find((c) => selectedIds.includes(c.id) && c.kind === 'image') ??
          activeProject.cards.find((c) => !c.inbox && c.kind === 'image');
        if (imgCard?.dominantHex) {
          pickedHex = imgCard.dominantHex;
        } else if (imgCard?.assetId) {
          const b = await getAssetBlob(imgCard.assetId, true);
          if (b) {
            const p = await extractPaletteFromBlob(b, 1);
            pickedHex = p[0]?.hex ?? '#8D9A7C';
          }
        }
      }

      if (!pickedHex) return;

      if (targetCardId) {
        mutateProject(
          activeProject.id,
          (p) => ({
            ...p,
            cards: p.cards.map((c) => (c.id === targetCardId ? { ...c, color: pickedHex! } : c)),
          }),
          { recordUndo: true }
        );
        showToast(`${dict.eyedropperFallbackToast} (${pickedHex})`);
        return;
      }

      const pt = getViewportCenterWorld();
      const now = new Date().toISOString();
      const card: Card = {
        id: createId('crd'),
        kind: 'color',
        title: pickedHex,
        text: '',
        color: pickedHex,
        category: 'palette',
        x: Math.round(pt.x - 84),
        y: Math.round(pt.y - 50),
        w: 168,
        h: 100,
        z: getNextZ(activeProject.cards),
        inbox: false,
        locked: false,
        createdAt: now,
        updatedAt: now,
      };
      mutateProject(activeProject.id, (p) => ({ ...p, cards: [...p.cards, card] }), {
        recordUndo: true,
      });
      setSelectedIds([card.id]);
      showToast(`${dict.eyedropperFallbackToast} (${pickedHex})`);
    },
    [activeProject, dict, getViewportCenterWorld, mutateProject, selectedIds, showToast]
  );

  // Phase 4.1: On-Device AI Object Background Removal (Cutout Worker with immediate RAM release)
  const handleRunAiCutout = useCallback(
    async (card: Card) => {
      if (!activeProject || card.kind !== 'image' || !card.assetId || cuttingOutCardId) return;
      const pinnedProjectId = activeProject.id;
      const sourceAssetId = card.originalAssetId ?? card.assetId;
      setCuttingOutCardId(card.id);

      try {
        const rawBlob = await getAssetBlob(sourceAssetId, false);
        if (!rawBlob) throw new Error(dict.aiMissingLocalImage);
        const img = await decodeImageElement(rawBlob);
        const maxEdge = 960;
        const scale = Math.min(1, maxEdge / Math.max(1, img.naturalWidth, img.naturalHeight));
        const w = Math.max(16, Math.round(img.naturalWidth * scale));
        const h = Math.max(16, Math.round(img.naturalHeight * scale));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D unavailable');
        ctx.drawImage(img, 0, 0, w, h);
        const imageData = ctx.getImageData(0, 0, w, h);
        const buf = imageData.data.buffer.slice(0);

        const worker = new Worker(
          new URL('./workers/cutout.worker.ts', import.meta.url),
          { type: 'module' }
        );

        const cutoutBlob = await new Promise<Blob>((resolve, reject) => {
          const reqId = createId('cut');
          worker.onmessage = (ev: MessageEvent<CutoutOutboundMessage>) => {
            worker.terminate();
            if (ev.data.type === 'error') {
              reject(new Error(ev.data.reason));
              return;
            }
            const outArr = new Uint8ClampedArray(ev.data.rgbaBuffer);
            const outData = new ImageData(outArr, ev.data.width, ev.data.height);
            ctx.clearRect(0, 0, w, h);
            ctx.putImageData(outData, 0, 0);
            canvas.toBlob(
              (b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))),
              'image/png'
            );
          };
          worker.onerror = (err) => {
            worker.terminate();
            reject(new Error(err.message || 'Cutout worker error'));
          };
          worker.postMessage(
            { type: 'cutout', requestId: reqId, width: w, height: h, rgbaBuffer: buf },
            [buf]
          );
        });

        const fileName = `${card.title || 'Cutout'}-cutout.png`;
        const newMeta = await putImageAsset(cutoutBlob, fileName);

        mutateProject(
          pinnedProjectId,
          (p) => ({
            ...p,
            cards: p.cards.map((c) =>
              c.id === card.id
                ? {
                    ...c,
                    assetId: newMeta.id,
                    originalAssetId: sourceAssetId,
                    cutout: true,
                    framed: false,
                  }
                : c
            ),
          }),
          { recordUndo: true }
        );
        showToast(dict.aiCutoutDoneToast);
      } catch (err) {
        showToast(err instanceof Error ? err.message : dict.aiCutoutErrorToast, true);
      } finally {
        setCuttingOutCardId(null);
      }
    },
    [activeProject, cuttingOutCardId, dict, mutateProject, showToast]
  );

  const handleRestoreOriginalBg = useCallback(
    (card: Card) => {
      if (!activeProject || !card.originalAssetId) return;
      mutateProject(
        activeProject.id,
        (p) => ({
          ...p,
          cards: p.cards.map((c) =>
            c.id === card.id
              ? { ...c, assetId: card.originalAssetId, cutout: undefined }
              : c
          ),
        }),
        { recordUndo: true }
      );
    },
    [activeProject, mutateProject]
  );

  // Phase 1.2: Copy crisp PNG (PURE 'image/png' ClipboardItem so Adobe Illustrator, Photoshop & Canva all paste natively!)
  const handleCopyImageForApps = useCallback(
    async (singleCard?: Card) => {
      if (!activeProject) return;
      const targetCards = singleCard
        ? [singleCard]
        : activeProject.cards.filter((c) => selectedIds.includes(c.id) && !c.inbox);
      if (targetCards.length === 0) return;

      const buildCleanPngBlob = async (): Promise<Blob> => {
        if (targetCards.length === 1 && targetCards[0].kind === 'image' && targetCards[0].assetId) {
          const card = targetCards[0];
          const rawBlob = await getAssetBlob(card.assetId!, false);
          if (rawBlob) {
            const img = await decodeImageElement(rawBlob);
            const crop = card.crop;
            const sx = crop ? Math.round(crop.x * img.naturalWidth) : 0;
            const sy = crop ? Math.round(crop.y * img.naturalHeight) : 0;
            const sw = crop ? Math.max(1, Math.round(crop.w * img.naturalWidth)) : img.naturalWidth;
            const sh = crop ? Math.max(1, Math.round(crop.h * img.naturalHeight)) : img.naturalHeight;

            const canvas = document.createElement('canvas');
            canvas.width = sw;
            canvas.height = sh;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              if (card.flipH) {
                ctx.translate(sw, 0);
                ctx.scale(-1, 1);
              }
              ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
              const cleanBlob = await new Promise<Blob | null>((res) =>
                canvas.toBlob((b) => res(b), 'image/png')
              );
              canvas.width = 0;
              canvas.height = 0;
              if (cleanBlob) {
                internalClipboardRef.current = {
                  cards: targetCards,
                  pngSize: cleanBlob.size,
                  copiedAt: Date.now(),
                };
                return cleanBlob;
              }
            }
          }
        }

        const composite = await renderMoodboardPng(activeProject, targetCards, {
          scope: 'selection',
          scale: 2,
          includeBackground: false,
          includeSourcesJson: false,
        });
        internalClipboardRef.current = {
          cards: targetCards,
          pngSize: composite.size,
          copiedAt: Date.now(),
        };
        return composite;
      };

      const jsonPayload = JSON.stringify({ marker: CLIPBOARD_MARKER, cards: targetCards });
      try {
        if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
          // Pass Promise<Blob> synchronously inside user gesture & omit 'text/plain' so Illustrator doesn't abort on CF_UNICODETEXT!
          const pngPromise = buildCleanPngBlob();
          await navigator.clipboard.write([
            new ClipboardItem({
              'image/png': pngPromise,
            }),
          ]);
          showToast(dict.copiedPngToast);
          return;
        }
      } catch {
        // Fallback to text clipboard if image rendering or permission fails
      }
      navigator.clipboard?.writeText(jsonPayload).catch(() => undefined);
    },
    [activeProject, dict.copiedPngToast, selectedIds, showToast]
  );

  // Phase 3.1: Connect / Clear Milanote-style Minimalist Callout Lines
  const handleConnectSelected = useCallback(() => {
    if (!activeProject || selectedIds.length < 2) return;
    mutateProject(
      activeProject.id,
      (p) => {
        const linkMap = new Map<string, Set<string>>();
        for (let i = 0; i < selectedIds.length - 1; i++) {
          const a = selectedIds[i];
          const b = selectedIds[i + 1];
          const existing = p.cards.find((c) => c.id === a)?.linksTo ?? [];
          const set = linkMap.get(a) ?? new Set(existing);
          set.add(b);
          linkMap.set(a, set);
        }
        return {
          ...p,
          cards: p.cards.map((c) => {
            const updated = linkMap.get(c.id);
            return updated ? { ...c, linksTo: [...updated] } : c;
          }),
        };
      },
      { recordUndo: true }
    );
  }, [activeProject, mutateProject, selectedIds]);

  const handleClearConnections = useCallback(() => {
    if (!activeProject || selectedIds.length === 0) return;
    const selSet = new Set(selectedIds);
    mutateProject(
      activeProject.id,
      (p) => ({
        ...p,
        cards: p.cards.map((c) =>
          selSet.has(c.id)
            ? { ...c, linksTo: undefined }
            : c.linksTo
              ? { ...c, linksTo: c.linksTo.filter((id) => !selSet.has(id)) }
              : c
        ),
      }),
      { recordUndo: true }
    );
  }, [activeProject, mutateProject, selectedIds]);

  const handleToggleConnectorPair = useCallback(
    (srcId: string, dstId: string) => {
      if (!activeProject || srcId === dstId) return;
      mutateProject(
        activeProject.id,
        (p) => ({
          ...p,
          cards: p.cards.map((c) => {
            if (c.id !== srcId) return c;
            const list = c.linksTo ?? [];
            const exists = list.includes(dstId);
            const next = exists ? list.filter((id) => id !== dstId) : [...list, dstId];
            return { ...c, linksTo: next.length > 0 ? next : undefined };
          }),
        }),
        { recordUndo: true }
      );
    },
    [activeProject, mutateProject]
  );

  const handleRemoveConnector = useCallback(
    (srcId: string, dstId: string) => {
      if (!activeProject) return;
      mutateProject(
        activeProject.id,
        (p) => ({
          ...p,
          cards: p.cards.map((c) => {
            if (c.id !== srcId || !c.linksTo) return c;
            const next = c.linksTo.filter((id) => id !== dstId);
            return { ...c, linksTo: next.length > 0 ? next : undefined };
          }),
        }),
        { recordUndo: true }
      );
    },
    [activeProject, mutateProject]
  );

  // Card field updates
  const handleChangeCard = useCallback(
    (cardId: string, patch: Partial<Card>, recordUndo = false) => {
      if (!activeProject) return;
      mutateProject(
        activeProject.id,
        (p) => ({
          ...p,
          cards: p.cards.map((c) => (c.id === cardId ? { ...c, ...patch } : c)),
        }),
        { recordUndo, debounceMs: recordUndo ? 0 : 350 }
      );
    },
    [activeProject, mutateProject]
  );

  const handleUpdateNoteText = useCallback(
    (cardId: string, text: string) => {
      handleChangeCard(cardId, { text }, false);
    },
    [handleChangeCard]
  );

  // Z-Order & Alignment (steps cleanly past the nearest overlapping card so every keypress gives instant visual feedback)
  const handleStepZ = useCallback(
    (dir: 'forward' | 'backward') => {
      if (!activeProject || selectedIds.length === 0) return;
      const selSet = new Set(selectedIds);
      mutateProject(
        activeProject.id,
        (p) => {
          const boardCards = p.cards.filter((c) => !c.inbox);
          const ordered = [...boardCards].sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));
          const movableSel = ordered.filter((c) => selSet.has(c.id) && !c.locked);
          if (movableSel.length === 0) return p;

          const overlapsAnySelected = (other: Card) =>
            movableSel.some(
              (s) =>
                !(
                  s.x + s.w < other.x ||
                  other.x + other.w < s.x ||
                  s.y + s.h < other.y ||
                  other.y + other.h < s.y
                )
            );

          const remaining = ordered.filter((c) => !selSet.has(c.id) || c.locked);
          const selIndices = ordered
            .map((c, idx) => (selSet.has(c.id) && !c.locked ? idx : -1))
            .filter((idx) => idx >= 0);

          let reordered: Card[];
          if (dir === 'forward') {
            const maxSelIdx = Math.max(...selIndices);
            // Find the nearest overlapping card currently above the selection
            let targetAfterId: string | null = null;
            for (let i = maxSelIdx + 1; i < ordered.length; i++) {
              const cand = ordered[i];
              if (cand.kind !== 'frame' && overlapsAnySelected(cand)) {
                targetAfterId = cand.id;
                break;
              }
            }
            if (targetAfterId) {
              const insertAt = remaining.findIndex((c) => c.id === targetAfterId) + 1;
              reordered = [
                ...remaining.slice(0, insertAt),
                ...movableSel,
                ...remaining.slice(insertAt),
              ];
            } else {
              reordered = [...remaining, ...movableSel];
            }
          } else {
            const minSelIdx = Math.min(...selIndices);
            // Find the nearest overlapping card currently below the selection
            let targetBeforeId: string | null = null;
            for (let i = minSelIdx - 1; i >= 0; i--) {
              const cand = ordered[i];
              if (cand.kind !== 'frame' && overlapsAnySelected(cand)) {
                targetBeforeId = cand.id;
                break;
              }
            }
            if (targetBeforeId) {
              const insertAt = remaining.findIndex((c) => c.id === targetBeforeId);
              reordered = [
                ...remaining.slice(0, insertAt),
                ...movableSel,
                ...remaining.slice(insertAt),
              ];
            } else {
              reordered = [...movableSel, ...remaining];
            }
          }

          // Assign strictly unique sequential z-indices (2, 3, 4, ...) and keep frames behind members
          const zMap = new Map<string, number>();
          reordered.forEach((c, idx) => zMap.set(c.id, idx + 2));

          const withNewZ = p.cards.map((c) => {
            const nz = zMap.get(c.id);
            return nz !== undefined ? { ...c, z: nz } : c;
          });

          const fixedFrames = withNewZ.map((c) => {
            if (c.kind !== 'frame') return c;
            const members = withNewZ.filter((m) => m.groupId === c.id && !m.inbox);
            if (members.length === 0) return c;
            const minMemberZ = Math.min(...members.map((m) => m.z));
            return c.z >= minMemberZ ? { ...c, z: Math.max(1, minMemberZ - 1) } : c;
          });

          return { ...p, cards: fixedFrames };
        },
        { recordUndo: true }
      );
    },
    [activeProject, mutateProject, selectedIds]
  );

  const triggerArrangeSpring = useCallback(() => {
    setArrangeAnimating(true);
    if (arrangeAnimTimerRef.current) window.clearTimeout(arrangeAnimTimerRef.current);
    arrangeAnimTimerRef.current = window.setTimeout(() => setArrangeAnimating(false), 420);
  }, []);

  const handleAlign = useCallback(
    (mode: AlignMode) => {
      if (!activeProject) return;
      const nextCards = alignSelectedCards(activeProject.cards, selectedIds, mode);
      if (!nextCards) return;
      triggerArrangeSpring();
      mutateProject(activeProject.id, (p) => ({ ...p, cards: nextCards }), {
        recordUndo: true,
      });
    },
    [activeProject, mutateProject, selectedIds, triggerArrangeSpring]
  );

  const handleToggleLockSelected = useCallback(() => {
    if (!activeProject || selectedCards.length === 0) return;
    const allLocked = selectedCards.every((c) => c.locked);
    const set = new Set(selectedIds);
    mutateProject(
      activeProject.id,
      (p) => ({
        ...p,
        cards: p.cards.map((c) => (set.has(c.id) ? { ...c, locked: !allLocked } : c)),
      }),
      { recordUndo: true }
    );
  }, [activeProject, mutateProject, selectedCards, selectedIds]);

  // Arrange Preview & Apply (always reads latest projectsRef so freshly applied AI labels take effect immediately)
  const handleArrangePreview = useCallback(
    (opts: ArrangeOptions) => {
      const proj = projectsRef.current.find((p) => p.id === activeProjectIdRef.current);
      if (!proj) return;
      triggerArrangeSpring();
      const nextCards = computeArrangedCards(proj.cards, selectedIds, opts);
      setArrangePreviewCards(nextCards);

      // Frame live preview cleanly in the unobstructed left canvas when opening, changing mode, or shuffling
      const fitKey = `${proj.id}|${opts.mode}|${opts.seed ?? 0}`;
      if (lastPreviewFitKeyRef.current !== fitKey) {
        lastPreviewFitKeyRef.current = fitKey;
        const boardCards = nextCards.filter((c) => !c.inbox);
        const fitted = fitWorkspaceView(
          boardCards,
          viewportSize.width,
          viewportSize.height,
          false,
          360
        );
        handleViewChange(fitted, false);
      }
    },
    [handleViewChange, selectedIds, triggerArrangeSpring, viewportSize.height, viewportSize.width]
  );

  const handleArrangeApply = useCallback(
    (
      opts: ArrangeOptions,
      pendingAiUpdates?: Array<{
        cardId: string;
        assetId: string;
        originalCategory: Category;
        newCategory: Category;
      }>
    ) => {
      const proj = projectsRef.current.find((p) => p.id === activeProjectIdRef.current);
      if (!proj) return;
      triggerArrangeSpring();

      // If user clicked the main "Áp dụng" button while AI suggestions are waiting in review,
      // apply those AI labels first so both labels + layout commit atomically!
      let baseCards = proj.cards;
      let appliedAiCount = 0;
      if (pendingAiUpdates && pendingAiUpdates.length > 0) {
        const updMap = new Map(pendingAiUpdates.map((u) => [u.cardId, u]));
        baseCards = proj.cards.map((c) => {
          const u = updMap.get(c.id);
          if (!u) return c;
          if (c.assetId !== u.assetId || c.category !== u.originalCategory) return c;
          appliedAiCount++;
          return { ...c, category: u.newCategory, aiClassifiedAssetId: c.assetId };
        });
      }

      const arranged = computeArrangedCards(baseCards, selectedIds, opts);
      setArrangePreviewCards(null);
      const nextView =
        selectedIds.length === 0
          ? computeFitView(
              arranged.filter((c) => !c.inbox),
              viewportSize.width,
              viewportSize.height,
              54
            )
          : proj.view;
      mutateProject(
        proj.id,
        (p) => ({ ...p, cards: arranged, view: nextView }),
        { recordUndo: true }
      );
      if (appliedAiCount > 0) {
        showToast(dict.aiAppliedAndArranged(appliedAiCount));
      }
    },
    [dict, mutateProject, selectedIds, showToast, triggerArrangeSpring, viewportSize.height, viewportSize.width]
  );

  // AI Classification Apply (W17: respects projectId, deleted/replaced/manually-changed cards)
  const handleApplyAiLabels = useCallback(
    (
      targetProjectId: string,
      updates: Array<{
        cardId: string;
        assetId: string;
        originalCategory: Category;
        newCategory: Category;
      }>
    ) => {
      const proj = projectsRef.current.find((p) => p.id === targetProjectId);
      if (!proj) return { applied: 0, skippedChanged: 0 };

      const updMap = new Map(updates.map((u) => [u.cardId, u]));
      let applied = 0;
      let skippedChanged = 0;

      const nextCards = proj.cards.map((c) => {
        const u = updMap.get(c.id);
        if (!u) return c;
        // Skip if asset changed or user manually changed category while AI was running (W17)
        if (c.assetId !== u.assetId || c.category !== u.originalCategory) {
          skippedChanged++;
          return c;
        }
        applied++;
        return { ...c, category: u.newCategory, aiClassifiedAssetId: c.assetId };
      });

      if (applied > 0) {
        mutateProject(targetProjectId, (p) => ({ ...p, cards: nextCards }), {
          recordUndo: true,
        });
      }
      if (skippedChanged > 0) {
        showToast(dict.aiAppliedPartial(applied, skippedChanged));
      } else if (applied > 0) {
        showToast(dict.aiAppliedLabels(applied));
      }
      return { applied, skippedChanged };
    },
    [dict, mutateProject, showToast]
  );

  // Search focus & scroll
  const handleSearchSelect = useCallback(
    (card: Card) => {
      if (!activeProject) return;
      if (card.inbox) {
        setInboxOpen(true);
        return;
      }
      setSelectedIds([card.id]);
      setHighlightedCardId(card.id);
      window.setTimeout(() => setHighlightedCardId(null), 2200);
      const zoom = Math.max(0.75, Math.min(1.2, activeProject.view.zoom));
      const cx = card.x + card.w / 2;
      const cy = card.y + card.h / 2;
      handleViewChange(
        {
          zoom,
          x: Math.round(viewportSize.width / 2 - cx * zoom),
          y: Math.round(viewportSize.height / 2 - cy * zoom),
        },
        true
      );
    },
    [activeProject, handleViewChange, viewportSize.height, viewportSize.width]
  );

  // Present mode enter/exit preserving previous viewport (Section 3)
  const enterPresentMode = useCallback(() => {
    if (!activeProject) return;
    prePresentViewRef.current = { ...activeProject.view };
    setSelectedIds([]);
    setEditingCardId(null);
    setInboxOpen(false);
    setPresentMode(true);
    (document.activeElement as HTMLElement | null)?.blur?.();
    const boardCards = activeProject.cards.filter((c) => !c.inbox);
    if (boardCards.length > 0) {
      handleViewChange(fitWorkspaceView(boardCards, viewportSize.width, viewportSize.height, true), false);
    }
    window.setTimeout(() => {
      boardRef.current?.focus?.();
    }, 20);
  }, [activeProject, handleViewChange, viewportSize.height, viewportSize.width]);

  const exitPresentMode = useCallback(() => {
    setPresentMode(false);
    if (prePresentViewRef.current) {
      handleViewChange(prePresentViewRef.current, false);
      prePresentViewRef.current = null;
    }
  }, [handleViewChange]);

  // Board pointer interactions hook
  const interactions = useBoardInteractions({
    boardRef,
    cards: displayedCards,
    view: activeProject?.view ?? { x: 0, y: 0, zoom: 1 },
    selectedIds,
    presentMode,
    editingCardId,
    modalOpen: blockingModalOpen,
    onViewChange: handleViewChange,
    onSelectChange: (ids) => {
      setSelectedIds(ids);
      if (editingCardId && !ids.includes(editingCardId)) setEditingCardId(null);
    },
    onCommitCards: (nextCards) => {
      if (!activeProject) return;
      mutateProject(activeProject.id, (p) => ({ ...p, cards: nextCards }), {
        recordUndo: true,
      });
    },
    onStartEditNote: (cardId) => setEditingCardId(cardId),
    onCreateNoteAt: createNoteAt,
    onOpenFileCard: (card) => void handleOpenFileCard(card),
    onOpenLightbox: (card) => setLightboxCardId(card.id),
  });

  // Global keyboard shortcuts & paste handler (W04, W05, Section 4 & 5)
  useEffect(() => {
    const isTextInputFocused = (target: EventTarget | null): boolean => {
      const el = (target as HTMLElement | null) ?? (document.activeElement as HTMLElement | null);
      if (!el) return false;
      const tag = el.tagName;
      if (tag === 'TEXTAREA' || el.isContentEditable) return true;
      if (tag === 'INPUT') {
        const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
        return !['checkbox', 'radio', 'range', 'color', 'button', 'submit', 'reset', 'file'].includes(type);
      }
      return false;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (anyModalOpen) return;

      if (e.key === 'Escape') {
        if (interactions.cancelDraft()) return;
        if (presentMode) {
          e.preventDefault();
          exitPresentMode();
          return;
        }
        if (connectMode) {
          setConnectMode(false);
          setConnectSourceId(null);
          setConnectCursorWorld(null);
          return;
        }
        if (croppingCardId) {
          setCroppingCardId(null);
          return;
        }
        if (editingCardId) {
          setEditingCardId(null);
          return;
        }
        if (moreMenuOpen) {
          setMoreMenuOpen(false);
          return;
        }
        if (selectedIds.length > 0) {
          setSelectedIds([]);
        }
        return;
      }

      if (presentMode || editingCardId || isTextInputFocused(e.target)) return;

      const mod = e.ctrlKey || e.metaKey;

      // Phase 2.2: Alt + G toggles PureRef Grayscale Value Check
      if (e.altKey && !mod && e.key.toLowerCase() === 'g' && activeProject) {
        e.preventDefault();
        handleChangeAppearance({
          ...activeProject.appearance,
          grayscale: !activeProject.appearance.grayscale,
        });
        return;
      }

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }
      if (mod && e.altKey && (e.code === 'BracketLeft' || e.key === '[')) {
        if (selectedIds.length > 0) {
          e.preventDefault();
          handleStepZ('forward');
        }
        return;
      }
      if (mod && e.altKey && (e.code === 'BracketRight' || e.key === ']')) {
        if (selectedIds.length > 0) {
          e.preventDefault();
          handleStepZ('backward');
        }
        return;
      }
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a' && activeProject) {
        e.preventDefault();
        const allBoardIds = activeProject.cards.filter((c) => !c.inbox).map((c) => c.id);
        setSelectedIds(allBoardIds);
        return;
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        handleDuplicateIds(selectedIds);
        return;
      }
      if (mod && e.key.toLowerCase() === 'c' && selectedIds.length > 0 && activeProject) {
        const copySet = new Set(selectedIds);
        // Include group members if frame copied
        for (const c of activeProject.cards) {
          if (c.groupId && copySet.has(c.groupId)) copySet.add(c.id);
        }
        const payload = activeProject.cards.filter((c) => copySet.has(c.id) && !c.inbox);
        if (payload.length > 0) {
          const hasVisual = payload.some((c) => c.kind === 'image' || payload.length > 1);
          if (hasVisual) {
            void handleCopyImageForApps(payload.length === 1 ? payload[0] : undefined);
          } else {
            navigator.clipboard
              ?.writeText(JSON.stringify({ marker: CLIPBOARD_MARKER, cards: payload }))
              .catch(() => undefined);
          }
        }
        return;
      }
      if (
        e.key === 'Delete' ||
        e.key === 'Del' ||
        e.code === 'Delete' ||
        e.key === 'Backspace' ||
        (e.code === 'NumpadDecimal' && e.key === 'Delete')
      ) {
        if (selectedIds.length > 0) {
          e.preventDefault();
          handleDeleteIdsToTrash(selectedIds);
        }
        return;
      }
      if (
        !mod &&
        (e.key.toLowerCase() === 'm' || e.key.toLowerCase() === 'g') &&
        selectedIds.length > 0
      ) {
        e.preventDefault();
        interactions.startStickyMove();
        return;
      }
      if (
        (e.key === 'ArrowUp' ||
          e.key === 'ArrowDown' ||
          e.key === 'ArrowLeft' ||
          e.key === 'ArrowRight') &&
        selectedIds.length > 0 &&
        activeProject
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const movable = getMovableCardIds(activeProject.cards, selectedIds);
        if (movable.size === 0) return;
        mutateProject(
          activeProject.id,
          (p) => ({
            ...p,
            cards: recomputeFrameBoundsForAll(
              p.cards.map((c) => (movable.has(c.id) ? { ...c, x: c.x + dx, y: c.y + dy } : c))
            ),
          }),
          { recordUndo: true }
        );
      }
    };

    const onPaste = async (e: ClipboardEvent) => {
      if (presentMode || anyModalOpen || editingCardId || isTextInputFocused(e.target)) return;
      const pid = activeProjectIdRef.current;
      const proj = projectsRef.current.find((p) => p.id === pid);
      if (!proj || !e.clipboardData) return;

      const center = screenToWorld(
        { x: viewportSize.width / 2, y: viewportSize.height / 2 },
        proj.view
      );

      const text = e.clipboardData.getData('text/plain').trim();
      const html = e.clipboardData.getData('text/html').trim();

      // 1. Internal 0Y03 cards copy/paste (checked first so dual PNG+JSON ClipboardItem pastes native cards inside 0Y03!)
      if (text.includes(CLIPBOARD_MARKER)) {
        try {
          const parsed = JSON.parse(text) as { marker?: string; cards?: Card[] };
          if (parsed.marker === CLIPBOARD_MARKER && Array.isArray(parsed.cards) && parsed.cards.length > 0) {
            e.preventDefault();
            const now = new Date().toISOString();
            let z = getNextZ(proj.cards);
            const idMap = new Map<string, string>();
            for (const c of parsed.cards) {
              idMap.set(c.id, createId(c.kind === 'frame' ? 'frm' : 'crd'));
            }
            const pasted: Card[] = parsed.cards.map((c) => ({
              ...c,
              id: idMap.get(c.id)!,
              groupId: c.groupId ? idMap.get(c.groupId) : undefined,
              x: c.x + 28,
              y: c.y + 28,
              z: c.kind === 'frame' ? z : ++z,
              inbox: false,
              locked: false,
              createdAt: now,
              updatedAt: now,
            }));
            mutateProject(pid, (p) => ({ ...p, cards: [...p.cards, ...pasted] }), {
              recordUndo: true,
            });
            setSelectedIds(pasted.map((c) => c.id));
            return;
          }
        } catch {
          // Fall through
        }
      }

      // 2. Vector SVG pasted from Adobe Illustrator / Figma / Canva (<svg...>)
      const svgMarkup = extractInlineSvg(text) || extractInlineSvg(html);
      if (svgMarkup) {
        e.preventDefault();
        const res = await importInlineSvgAsCard(svgMarkup, {
          title: dict.importedSvgVector,
          inbox: false,
          worldPoint: { x: center.x - 130, y: center.y - 100 },
          baseZ: getNextZ(proj.cards),
          method: 'paste',
        });
        appendImportedCards(pid, res.cards, res.errors);
        return;
      }

      // 3. Clipboard files (raster images from Photoshop / Canva / Snipping Tool or internal 0Y03 PNG copy)
      const pastedFiles: File[] = [];
      for (const item of Array.from(e.clipboardData.items)) {
        if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) pastedFiles.push(f);
        }
      }
      if (pastedFiles.length > 0) {
        e.preventDefault();
        const mem = internalClipboardRef.current;
        if (
          pastedFiles.length === 1 &&
          !text &&
          !html &&
          mem &&
          Math.abs(pastedFiles[0].size - mem.pngSize) <= 16 &&
          Date.now() - mem.copiedAt < 180_000
        ) {
          const now = new Date().toISOString();
          let z = getNextZ(proj.cards);
          const idMap = new Map<string, string>();
          for (const c of mem.cards) {
            idMap.set(c.id, createId(c.kind === 'frame' ? 'frm' : 'crd'));
          }
          const pasted: Card[] = mem.cards.map((c) => ({
            ...c,
            id: idMap.get(c.id)!,
            groupId: c.groupId ? idMap.get(c.groupId) : undefined,
            x: c.x + 28,
            y: c.y + 28,
            z: c.kind === 'frame' ? z : ++z,
            inbox: false,
            locked: false,
            createdAt: now,
            updatedAt: now,
          }));
          mutateProject(pid, (p) => ({ ...p, cards: [...p.cards, ...pasted] }), {
            recordUndo: true,
          });
          setSelectedIds(pasted.map((c) => c.id));
          return;
        }

        const res = await importFilesAsCards(pastedFiles, {
          inbox: false,
          worldPoint: { x: center.x - 140, y: center.y - 100 },
          baseZ: getNextZ(proj.cards),
          method: 'paste',
        });
        appendImportedCards(pid, res.cards, res.errors);
        return;
      }

      // 4. HTML image/background pasted from Canva Web or browser
      if (html) {
        const parsedHtml = parseDroppedHtml(html);
        if (parsedHtml.dataUrl) {
          e.preventDefault();
          const res = await importDataUrlAsCard(parsedHtml.dataUrl, {
            title: parsedHtml.alt,
            pageUrl: parsedHtml.pageUrl,
            inbox: false,
            worldPoint: { x: center.x - 140, y: center.y - 100 },
            baseZ: getNextZ(proj.cards),
            method: 'paste',
          });
          appendImportedCards(pid, res.cards, res.errors);
          return;
        }
        if (parsedHtml.imageUrl) {
          e.preventDefault();
          const res = await importUrlAsCard(parsedHtml.imageUrl, {
            title: parsedHtml.alt,
            pageUrl: parsedHtml.pageUrl,
            tryAsImage: true,
            inbox: false,
            worldPoint: { x: center.x - 140, y: center.y - 100 },
            baseZ: getNextZ(proj.cards),
            method: 'paste',
          });
          appendImportedCards(pid, res.cards, res.errors);
          return;
        }
        if (!text && /canva/i.test(html)) {
          e.preventDefault();
          showToast(dict.canvaInternalCopyHint, true);
          return;
        }
      }

      if (!text) return;

      // 5. HTTP/HTTPS URL -> Link card (or image card)
      if (isValidHttpUrl(text)) {
        e.preventDefault();
        const res = await importUrlAsCard(text, {
          tryAsImage: false,
          inbox: false,
          worldPoint: { x: center.x - 138, y: center.y - 56 },
          baseZ: getNextZ(proj.cards),
          method: 'paste',
        });
        appendImportedCards(pid, res.cards, res.errors);
        return;
      }

      // 4. Plain text -> Note card
      e.preventDefault();
      const now = new Date().toISOString();
      const note: Card = {
        id: createId('crd'),
        kind: 'note',
        title: dict.defaultPastedNoteTitle,
        text: text.slice(0, 2000),
        color: '#FAF7EE',
        category: 'other',
        x: Math.round(center.x - 125),
        y: Math.round(center.y - 70),
        w: 256,
        h: 152,
        z: getNextZ(proj.cards),
        inbox: false,
        locked: false,
        source: { method: 'paste', capturedAt: now },
        createdAt: now,
        updatedAt: now,
      };
      mutateProject(pid, (p) => ({ ...p, cards: [...p.cards, note] }), { recordUndo: true });
      setSelectedIds([note.id]);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('paste', onPaste);
    };
  }, [
    activeProject,
    anyModalOpen,
    appendImportedCards,
    connectMode,
    croppingCardId,
    dict.canvaInternalCopyHint,
    dict.defaultPastedNoteTitle,
    dict.importedSvgVector,
    editingCardId,
    exitPresentMode,
    handleChangeAppearance,
    handleCopyImageForApps,
    handleDeleteIdsToTrash,
    handleDuplicateIds,
    handleRedo,
    handleStepZ,
    handleUndo,
    interactions,
    moreMenuOpen,
    mutateProject,
    presentMode,
    selectedIds,
    viewportSize.height,
    viewportSize.width,
  ]);

  // Phase 4.2 & 2.4: Visual Similarity / Duplicate Detection & Smart Filter Dimming
  const duplicateIds = useMemo(() => {
    const dup = new Set<string>();
    if (!activeProject) return dup;
    const imgs = activeProject.cards.filter((c) => !c.inbox && c.kind === 'image');
    for (let i = 0; i < imgs.length; i++) {
      for (let j = i + 1; j < imgs.length; j++) {
        const a = imgs[i];
        const b = imgs[j];
        const sameAsset = Boolean(a.assetId && a.assetId === b.assetId);
        const sameFile = Boolean(
          a.source?.fileName &&
            b.source?.fileName &&
            a.source.fileName.toLowerCase() === b.source.fileName.toLowerCase()
        );
        const nearVisual =
          Boolean(a.dominantHex && b.dominantHex) &&
          hexColorDistance(a.dominantHex, b.dominantHex) <= 14 &&
          Math.abs(a.w / Math.max(1, a.h) - b.w / Math.max(1, b.h)) <= 0.08;
        if (sameAsset || sameFile || nearVisual) {
          dup.add(a.id);
          dup.add(b.id);
        }
      }
    }
    return dup;
  }, [activeProject]);

  const dimmedCardIds = useMemo(() => {
    if (!activeProject) return null;
    const { category, colorHex, duplicatesOnly } = boardFilter;
    if (!category && !colorHex && !duplicatesOnly) return null;
    const dimmed = new Set<string>();
    for (const c of activeProject.cards) {
      if (c.inbox || c.kind === 'frame') continue;
      let match = true;
      if (category && c.category !== category) match = false;
      if (colorHex) {
        const cardHex = c.kind === 'color' ? c.color : c.dominantHex || c.color;
        if (!cardHex || hexColorDistance(cardHex, colorHex) > 48) match = false;
      }
      if (duplicatesOnly && !duplicateIds.has(c.id)) match = false;
      if (!match) dimmed.add(c.id);
    }
    return dimmed;
  }, [activeProject, boardFilter, duplicateIds]);

  if (loading) {
    return (
      <div className="fatal-screen">
        <div className="fatal-card">
          <strong className="brand-name brand-name--lg">{dict.appName}</strong>
          <p className="field-hint">{dict.loadingWorkspace}</p>
        </div>
      </div>
    );
  }

  if (storageFatal || !activeProject) {
    return (
      <div className="fatal-screen">
        <div className="fatal-card">
          <h2>{dict.storageErrorTitle}</h2>
          <p className="field-hint">{storageFatal || dict.storageErrorDesc}</p>
          <button type="button" className="btn btn-primary" onClick={() => void bootWorkspace()}>
            <RotateCcw size={15} />
            <span>{dict.retry}</span>
          </button>
        </div>
      </div>
    );
  }

  const saveLabel =
    saveStatus === 'saved'
      ? dict.saveSaved
      : saveStatus === 'saving'
        ? dict.saveSaving
        : saveStatus === 'error'
          ? dict.saveError
          : dict.saveUnsaved;

  return (
    <div
      className={`app-root ${darkTheme ? 'theme-dark' : ''}`}
      onContextMenu={(e) => {
        const el = e.target as HTMLElement | null;
        const tag = el?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return;
        e.preventDefault();
      }}
    >
      {/* Hidden file inputs (supports ALL file extensions) */}
      <input
        ref={filePickerRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          void handleFilesSelected(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={replacePickerRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void handleReplaceImagePicked(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={replaceFilePickerRef}
        type="file"
        hidden
        onChange={(e) => {
          void handleReplaceFilePicked(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Full-viewport interactive Artboard */}
      <BoardViewport
        boardRef={boardRef}
        viewportSize={viewportSize}
        cards={displayedCards}
        appearance={activeProject.appearance}
        view={activeProject.view}
        selectedIds={selectedIds}
        editingCardId={editingCardId}
        croppingCardId={croppingCardId}
        highlightedCardId={highlightedCardId}
        dimmedCardIds={dimmedCardIds}
        connectMode={connectMode}
        connectSourceId={connectSourceId}
        connectCursorWorld={connectCursorWorld}
        presentMode={presentMode}
        isArranging={Boolean(arrangePreviewCards) || arrangeAnimating}
        spacePressed={interactions.spacePressed}
        draft={interactions.draft}
        dict={dict}
        onPointerDown={(e) => {
          if (connectMode && e.button === 0 && !interactions.spacePressed) {
            if (connectSourceId) {
              setConnectSourceId(null);
            } else {
              setConnectMode(false);
              setConnectCursorWorld(null);
            }
            return;
          }
          interactions.handleBoardPointerDown(e);
        }}
        onPointerMove={(e) => {
          if (connectMode && boardRef.current) {
            const rect = boardRef.current.getBoundingClientRect();
            setConnectCursorWorld(
              screenToWorld(
                { x: e.clientX - rect.left, y: e.clientY - rect.top },
                activeProject.view
              )
            );
          }
          interactions.handlePointerMove(e);
        }}
        onPointerUp={interactions.handlePointerUp}
        onPointerCancel={interactions.handlePointerCancel}
        onDoubleClick={interactions.handleBoardDoubleClick}
        onBoardContextMenu={(e, worldPoint) => {
          setMoreMenuOpen(false);
          setContextMenu({
            screenX: e.clientX,
            screenY: e.clientY,
            worldPoint,
            targetCardId: null,
          });
        }}
        onCardPointerDown={(e, card) => {
          if (connectMode && e.button === 0 && !interactions.spacePressed) {
            e.stopPropagation();
            if (card.kind === 'frame') return;
            if (!connectSourceId) {
              setConnectSourceId(card.id);
              const rect = boardRef.current?.getBoundingClientRect();
              if (rect) {
                setConnectCursorWorld(
                  screenToWorld(
                    { x: e.clientX - rect.left, y: e.clientY - rect.top },
                    activeProject.view
                  )
                );
              }
            } else if (connectSourceId === card.id) {
              setConnectSourceId(null);
            } else {
              handleToggleConnectorPair(connectSourceId, card.id);
              setConnectSourceId(null);
            }
            return;
          }
          interactions.handleCardPointerDown(e, card);
        }}
        onCardDoubleClick={interactions.handleCardDoubleClick}
        onCardContextMenu={(e, card) => {
          e.preventDefault();
          e.stopPropagation();
          if (presentMode || interactions.draft?.mode === 'sticky-move') return;
          setMoreMenuOpen(false);
          if (!selectedIds.includes(card.id)) {
            setSelectedIds([card.id]);
          }
          setContextMenu({
            screenX: e.clientX,
            screenY: e.clientY,
            worldPoint: { x: card.x, y: card.y },
            targetCardId: card.id,
          });
        }}
        onResizePointerDown={interactions.handleResizePointerDown}
        onUpdateCardText={handleUpdateNoteText}
        onChangeCrop={(cardId, crop) => handleChangeCard(cardId, { crop }, false)}
        onFinishCrop={() => {
          if (croppingCardId) {
            const c = activeProject.cards.find((it) => it.id === croppingCardId);
            if (c) handleChangeCard(c.id, { crop: c.crop }, true);
          }
          setCroppingCardId(null);
        }}
        onFinishEdit={() => setEditingCardId(null)}
        onRemoveConnector={handleRemoveConnector}
        onOpenLightbox={(c) => setLightboxCardId(c.id)}
        onOpenFileCard={(c) => void handleOpenFileCard(c)}
        onTriggerReplaceImage={(c) => {
          replaceTargetCardRef.current = c;
          replacePickerRef.current?.click();
        }}
        onTriggerAddImage={() => filePickerRef.current?.click()}
        onDropExternal={(dt, pt) => void handleDropExternal(dt, pt, false)}
        onDropInboxCard={(id, pt) => handleMoveFromInboxToBoard(id, pt)}
      />

      {/* Editor Chrome (hidden cleanly in Presentation Mode) */}
      {!presentMode && (
        <>
          <header className="topbar">
            <div className="topbar-left">
              <button
                type="button"
                className="brand-mark brand-mark--btn"
                title={dict.homeAllProjects}
                aria-label={dict.homeAllProjects}
                onClick={handleOpenProjectHub}
              >
                <img src={`${import.meta.env.BASE_URL}brand/logo.svg?v=6`} alt="Mosa" className="brand-logo" />
                <span className="brand-name">{dict.appName}</span>
              </button>

              <div className="topbar-project">
                <ProjectMenu
                  projects={projects}
                  activeProject={activeProject}
                  dict={dict}
                  onSelectProject={handleSelectProject}
                  onCreateProject={handleCreateProject}
                  onDuplicateProject={(p) => void handleDuplicateProject(p)}
                  onOpenProjectHub={handleOpenProjectHub}
                  onRenameProject={handleRenameProject}
                  onDeleteProject={(id) => void handleDeleteProject(id)}
                />

                <div className={`save-indicator save-indicator--${saveStatus}`}>
                  <span className="save-status" title={saveLabel} role="status">
                    {saveStatus === 'saved' && <Check size={13} aria-hidden="true" />}
                    {saveStatus === 'saving' && <LoaderCircle size={13} className="spin" aria-hidden="true" />}
                    {saveStatus === 'unsaved' && <CircleDashed size={13} aria-hidden="true" />}
                    {saveStatus === 'error' && <CircleAlert size={13} aria-hidden="true" />}
                    <span className="truncate">{saveLabel}</span>
                  </span>
                  {saveStatus === 'error' && (
                    <button type="button" className="save-retry" onClick={() => persistProject(activeProject, 0)}>
                      {dict.retry}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="topbar-discover">
              <SearchBar
                cards={activeProject.cards}
                dict={dict}
                filter={boardFilter}
                duplicateIds={duplicateIds}
                onChangeFilter={setBoardFilter}
                onSelectResult={handleSearchSelect}
              />
              <InboxPanel
                open={inboxOpen}
                inboxCards={inboxCards}
                clipperBridgeReady={clipperBridgeReady}
                dict={dict}
                onToggle={() =>
                  setInboxOpen((v) => {
                    const next = !v;
                    if (next) {
                      setSettingsOpen(false);
                      setMoreMenuOpen(false);
                      lastPreviewFitKeyRef.current = null;
                      setArrangePreviewCards(null);
                      setArrangeOpen(false);
                    }
                    return next;
                  })
                }
                onMoveToBoard={(id) => handleMoveFromInboxToBoard(id)}
                onDeleteCard={(id) => handleDeleteIdsToTrash([id])}
                onDropExternalToInbox={(dt) => void handleDropExternal(dt, { x: 100, y: 100 }, true)}
              />
            </div>

            <div className="topbar-right">
              <button
                type="button"
                className={`btn topbar-arrange-btn ${arrangeOpen ? 'is-active' : ''}`}
                title={dict.arrangeBoard}
                aria-label={dict.arrangeBoard}
                aria-expanded={arrangeOpen}
                onClick={() => {
                  if (arrangeOpen) {
                    lastPreviewFitKeyRef.current = null;
                    setArrangePreviewCards(null);
                    setArrangeOpen(false);
                  } else {
                    setSettingsOpen(false);
                    setMoreMenuOpen(false);
                    setInboxOpen(false);
                    setContextMenu(null);
                    setArrangeOpen(true);
                  }
                }}
              >
                <LayoutGrid size={15} />
                <span className="btn-label-md">{dict.arrangeBoard}</span>
              </button>

              <span className="toolbar-sep topbar-divider" aria-hidden="true" />

              <button
                type="button"
                className="icon-btn"
                title={dict.present}
                aria-label={dict.present}
                onClick={() => {
                  lastPreviewFitKeyRef.current = null;
                  setArrangePreviewCards(null);
                  setArrangeOpen(false);
                  setSettingsOpen(false);
                  setMoreMenuOpen(false);
                  setInboxOpen(false);
                  enterPresentMode();
                }}
              >
                <Presentation size={17} />
              </button>

              <SettingsPopover
                open={settingsOpen}
                onOpenChange={(next) => {
                  if (next) {
                    lastPreviewFitKeyRef.current = null;
                    setArrangePreviewCards(null);
                    setArrangeOpen(false);
                    setMoreMenuOpen(false);
                    setInboxOpen(false);
                    setContextMenu(null);
                  }
                  setSettingsOpen(next);
                }}
                appearance={activeProject.appearance}
                language={language}
                syncFolderName={syncFolderHandle?.name ?? null}
                dict={dict}
                onChangeAppearance={handleChangeAppearance}
                onChangeLanguage={handleChangeLanguage}
                onOpenStorageHub={() => setBackupOpen(true)}
              />

              {/* Secondary Menu: Export, Backup, Trash */}
              <div ref={moreMenuRef} className="popover-anchor">
                <button
                  type="button"
                  className={`icon-btn ${moreMenuOpen ? 'is-active' : ''}`}
                  title={dict.moreMenu}
                  aria-label={dict.moreMenu}
                  aria-expanded={moreMenuOpen}
                  onClick={() =>
                    setMoreMenuOpen((v) => {
                      const next = !v;
                      if (next) {
                        lastPreviewFitKeyRef.current = null;
                        setArrangePreviewCards(null);
                        setArrangeOpen(false);
                        setSettingsOpen(false);
                        setInboxOpen(false);
                        setContextMenu(null);
                      }
                      return next;
                    })
                  }
                >
                  <MoreHorizontal size={18} />
                </button>
                {moreMenuOpen && (
                  <div className="popover-panel popover-panel--right" role="menu">
                    <button
                      type="button"
                      className="popover-action-btn"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        setExportOpen(true);
                      }}
                    >
                      <Download size={15} />
                      <span>{dict.exportPng}</span>
                    </button>
                    <button
                      type="button"
                      className="popover-action-btn"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        setBackupOpen(true);
                      }}
                    >
                      <FileArchive size={15} />
                      <span>{dict.backupExport} / {dict.backupImport}</span>
                    </button>
                    <div className="popover-divider" />
                    <button
                      type="button"
                      className="popover-action-btn"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        setTrashOpen(true);
                      }}
                    >
                      <Trash2 size={15} />
                      <span>
                        {dict.trash} ({activeProject.trash.length})
                      </span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>

          {/* Multi-select action bar */}
          <SelectionOverlay
            selectedCards={selectedCards}
            dict={dict}
            onStartStickyMove={(e) => {
              interactions.startStickyMove({ clientX: e.clientX, clientY: e.clientY });
            }}
            onGroup={handleGroupSelected}
            onUngroup={() => handleUngroup()}
            onToggleLock={handleToggleLockSelected}
            onBringForward={() => handleStepZ('forward')}
            onSendBackward={() => handleStepZ('backward')}
            onAlign={handleAlign}
            onDuplicate={() => handleDuplicateIds(selectedIds)}
            onMoveToInbox={() => handleMoveToInbox(selectedIds)}
            onDelete={() => handleDeleteIdsToTrash(selectedIds)}
          />

          {/* Right Inspector Panel when 1 card selected */}
          {singleSelectedCard && !inboxOpen && !arrangeOpen && !settingsOpen && !moreMenuOpen && (
            <InspectorPanel
              card={singleSelectedCard}
              dict={dict}
              isCropping={croppingCardId === singleSelectedCard.id}
              isCuttingOut={cuttingOutCardId === singleSelectedCard.id}
              onClose={() => setSelectedIds([])}
              onChangeCard={handleChangeCard}
              onToggleCrop={(id) => {
                setCroppingCardId((prev) => {
                  if (prev === id) return null;
                  if (!singleSelectedCard.crop) {
                    handleChangeCard(id, { crop: { x: 0.08, y: 0.08, w: 0.84, h: 0.84 } }, true);
                  }
                  return id;
                });
              }}
              onRunAiCutout={(c) => void handleRunAiCutout(c)}
              onRestoreOriginalBg={handleRestoreOriginalBg}
              onCopyImageForApps={(c) => void handleCopyImageForApps(c)}
              onPickEyedropperColor={(tid) => void handlePickEyedropperColor(tid)}
              onOpenLightbox={(c) => setLightboxCardId(c.id)}
              onOpenFileCard={(c) => void handleOpenFileCard(c)}
              onTriggerReplaceImage={(c) => {
                replaceTargetCardRef.current = c;
                replacePickerRef.current?.click();
              }}
              onTriggerReplaceFile={(c) => {
                replaceTargetFileCardRef.current = c;
                replaceFilePickerRef.current?.click();
              }}
              onExtractPalette={(c) => void handleExtractPalette(c)}
              onDuplicate={(id) => handleDuplicateIds([id])}
              onMoveToInbox={(id) => handleMoveToInbox([id])}
              onDelete={(id) => handleDeleteIdsToTrash([id])}
              onUngroupFrame={(fid) => handleUngroup(fid)}
            />
          )}

          <footer className="workspace-footer">
            <button
              type="button"
              className={`shortcuts-corner-btn ${shortcutsOpen ? 'is-active' : ''}`}
              title={dict.shortcuts}
              aria-label={dict.shortcuts}
              aria-expanded={shortcutsOpen}
              onClick={() => setShortcutsOpen((v) => !v)}
            >
              <Keyboard size={14} />
              <span>{dict.shortcuts}</span>
            </button>

            {/* Bottom-center Creation Dock */}
            <nav className="bottom-dock" aria-label={dict.creationTools}>
              <button
                type="button"
                className="dock-btn btn-primary dock-btn--primary"
                title={dict.addImageOrFile}
                aria-label={dict.addMedia}
                onClick={() => filePickerRef.current?.click()}
              >
                <ImagePlus size={17} />
                <span>{dict.addMedia}</span>
              </button>
              <button
                type="button"
                className="dock-btn"
                title={dict.addNote}
                aria-label={dict.addNote}
                onClick={() => createNoteAt(getViewportCenterWorld())}
              >
                <StickyNote size={17} />
                <span className="dock-label">{dict.addNote}</span>
              </button>
              <button
                type="button"
                className="dock-btn"
                title={dict.addLink}
                aria-label={dict.addLink}
                onClick={() => setAddLinkOpen(true)}
              >
                <Link2 size={17} />
                <span className="dock-label">{dict.addLink}</span>
              </button>
              <button
                type="button"
                className="dock-btn"
                title={dict.addColor}
                aria-label={dict.addColor}
                onClick={() => createColorCard()}
              >
                <Palette size={17} />
                <span className="dock-label">{dict.addColor}</span>
              </button>
              <button
                type="button"
                className={`dock-btn ${connectMode ? 'is-active' : ''}`}
                title={dict.addConnectorTitle}
                aria-label={dict.addConnector}
                aria-pressed={connectMode}
                onClick={() => {
                  if (connectMode) {
                    setConnectMode(false);
                    setConnectSourceId(null);
                    setConnectCursorWorld(null);
                    return;
                  }
                  if (selectedIds.length >= 2) {
                    handleConnectSelected();
                    return;
                  }
                  setConnectMode(true);
                  const single =
                    selectedIds.length === 1
                      ? activeProject.cards.find((c) => c.id === selectedIds[0] && c.kind !== 'frame')
                      : null;
                  setConnectSourceId(single ? single.id : null);
                  setConnectCursorWorld(null);
                }}
              >
                <MoveUpRight size={17} />
                <span className="dock-label">{dict.addConnector}</span>
              </button>
              <span className="toolbar-sep" aria-hidden="true" />

              <button
                type="button"
                className="icon-btn"
                title={`${dict.undo} (Ctrl+Z)`}
                aria-label={dict.undo}
                disabled={!canUndo}
                onClick={handleUndo}
              >
                <Undo2 size={16} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title={`${dict.redo} (Ctrl+Shift+Z)`}
                aria-label={dict.redo}
                disabled={!canRedo}
                onClick={handleRedo}
              >
                <Redo2 size={16} />
              </button>
            </nav>

            {/* Bottom-right Zoom Bar */}
            <div className="zoom-bar">
              <button
                type="button"
                className="icon-btn-sm"
                title={dict.zoomOut}
                aria-label={dict.zoomOut}
                onClick={() => handleZoomStep(1 / 1.2)}
              >
                <Minus size={15} />
              </button>
              <button
                type="button"
                className="zoom-pct-btn"
                title={dict.zoomReset}
                onClick={handleZoomReset}
              >
                {Math.round(activeProject.view.zoom * 100)}%
              </button>
              <button
                type="button"
                className="icon-btn-sm"
                title={dict.zoomIn}
                aria-label={dict.zoomIn}
                onClick={() => handleZoomStep(1.2)}
              >
                <Plus size={15} />
              </button>
              <span className="toolbar-sep" aria-hidden="true" />
              <button
                type="button"
                className="icon-btn-sm"
                title={dict.fitBoard}
                aria-label={dict.fitBoard}
                onClick={handleFitBoard}
              >
                <Maximize size={14} />
              </button>
            </div>
          </footer>
        </>
      )}

      {/* Presentation Mode Minimal HUD */}
      {presentMode && (
        <div className="present-hud">
          <span>{dict.presentExitHint}</span>
          <button type="button" className="btn-xs btn-primary" onClick={exitPresentMode}>
            {dict.exitPresent}
          </button>
        </div>
      )}

      {/* Task Modals */}
      <AddLinkModal
        open={addLinkOpen}
        dict={dict}
        onClose={() => setAddLinkOpen(false)}
        onSubmit={handleAddLinkSubmit}
      />

      <Suspense fallback={null}>
        {arrangeOpen && (
          <ArrangeModal
            open={arrangeOpen}
            projectId={activeProject.id}
            cards={activeProject.cards}
            selectedIds={selectedIds}
            dict={dict}
            onPreview={handleArrangePreview}
            onClearPreview={() => {
              lastPreviewFitKeyRef.current = null;
              setArrangePreviewCards(null);
            }}
            onApply={handleArrangeApply}
            onApplyLabels={handleApplyAiLabels}
            onGenerateBoardPalette={() => void handleGenerateBoardPalette()}
            onClose={() => {
              lastPreviewFitKeyRef.current = null;
              setArrangePreviewCards(null);
              setArrangeOpen(false);
            }}
          />
        )}

        {exportOpen && (
          <ExportModal
            open={exportOpen}
            project={activeProject}
            selectedIds={selectedIds}
            studioProfile={meta?.studioProfile}
            dict={dict}
            onClose={() => setExportOpen(false)}
            onChangeStudioProfile={handleChangeStudioProfile}
            onExported={(msg) => showToast(msg)}
          />
        )}

        {backupOpen && (
          <BackupModal
            open={backupOpen}
            project={activeProject}
            allProjects={projects}
            autoFolderSync={Boolean(meta?.autoFolderSync)}
            dict={dict}
            onClose={() => setBackupOpen(false)}
            onImportedProject={(imported) => {
              setProjects((list) => [imported, ...list]);
              handleSelectProject(imported.id);
              showToast(dict.projectImportedToast(imported.name));
            }}
            onChangeAutoFolderSync={handleChangeAutoFolderSync}
            onSyncFolderChanged={(h) => setSyncFolderHandle(h)}
            onToast={(msg) => showToast(msg)}
          />
        )}

        {projectHubOpen && (
          <ProjectHubOverlay
            open={projectHubOpen}
            projects={projects}
            activeProjectId={activeProject.id}
            dict={dict}
            onClose={() => setProjectHubOpen(false)}
            onSelectProject={handleSelectProject}
            onCreateFromTemplate={handleCreateFromTemplate}
            onDuplicateProject={(p) => void handleDuplicateProject(p)}
            onUpdateProjectMeta={handleUpdateProjectMeta}
            onDeleteProject={(id) => void handleDeleteProject(id)}
            onExportMosaFile={(p) => void handleExportMosaFileQuick(p)}
            onOpenMosaFile={() => void handleOpenMosaFileQuick()}
          />
        )}
      </Suspense>

      <TrashModal
        open={trashOpen}
        items={activeProject.trash}
        dict={dict}
        onClose={() => setTrashOpen(false)}
        onRestore={handleRestoreFromTrash}
        onEmptyTrash={() =>
          mutateProject(activeProject.id, (p) => ({ ...p, trash: [] }), { recordUndo: true })
        }
      />

      <LightboxModal
        card={lightboxCard}
        dict={dict}
        onClose={() => setLightboxCardId(null)}
      />

      <ShortcutsModal
        open={shortcutsOpen}
        dict={dict}
        onClose={() => setShortcutsOpen(false)}
      />

      {/* Native Apple-style Canvas & Card Right-Click Context Menu */}
      {!presentMode && (
        <CanvasContextMenu
          menu={contextMenu}
          cards={activeProject.cards}
          selectedIds={selectedIds}
          canUndo={canUndo}
          canRedo={canRedo}
          dict={dict}
          onClose={() => setContextMenu(null)}
          onStartStickyMove={(pt) => interactions.startStickyMove(pt)}
          onEditNote={(id) => setEditingCardId(id)}
          onOpenFileCard={(c) => void handleOpenFileCard(c)}
          onReplaceFileCard={(c) => {
            replaceTargetFileCardRef.current = c;
            replaceFilePickerRef.current?.click();
          }}
          onOpenLightbox={(c) => setLightboxCardId(c.id)}
          onReplaceImageCard={(c) => {
            replaceTargetCardRef.current = c;
            replacePickerRef.current?.click();
          }}
          onExtractPalette={(c) => void handleExtractPalette(c)}
          onToggleCrop={(id) => {
            setCroppingCardId((prev) => {
              if (prev === id) return null;
              const target = activeProject.cards.find((it) => it.id === id);
              if (target && !target.crop) {
                handleChangeCard(id, { crop: { x: 0.08, y: 0.08, w: 0.84, h: 0.84 } }, true);
              }
              return id;
            });
          }}
          onRunAiCutout={(c) => void handleRunAiCutout(c)}
          onCopyImageForApps={(c) => void handleCopyImageForApps(c)}
          onConnectSelected={handleConnectSelected}
          onClearConnections={handleClearConnections}
          onPickEyedropperColor={() => void handlePickEyedropperColor()}
          onCopyHex={(hex) => {
            navigator.clipboard?.writeText(hex).catch(() => undefined);
            showToast(`${dict.copiedHex}: ${hex}`);
          }}
          onDuplicate={handleDuplicateIds}
          onStepZ={handleStepZ}
          onToggleLock={handleToggleLockSelected}
          onGroup={handleGroupSelected}
          onUngroup={handleUngroup}
          onAlign={handleAlign}
          onMoveToInbox={handleMoveToInbox}
          onDelete={handleDeleteIdsToTrash}
          onCreateNoteAt={createNoteAt}
          onTriggerAddFiles={() => filePickerRef.current?.click()}
          onOpenAddLink={() => setAddLinkOpen(true)}
          onCreateColorAt={(pt) => createColorCard(pt)}
          onOpenArrange={() => setArrangeOpen(true)}
          onFitBoard={handleFitBoard}
          onZoomReset={handleZoomReset}
          onUndo={handleUndo}
          onRedo={handleRedo}
        />
      )}

      {/* Ephemeral status toast */}
      {toast && (
        <div
          className={`toast-banner ${toast.isError ? 'toast-banner--error' : ''}`}
          role="status"
        >
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  );
};
