import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  WorkspaceMeta,
} from './domain/types';
import { createEmptyProject, getNextZ } from './domain/project';
import {
  alignSelectedCards,
  clampZoom,
  computeCardsBounds,
  computeFitView,
  getMovableCardIds,
  recomputeFrameBoundsForAll,
  screenToWorld,
  zoomAtScreenPoint,
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
import { createId, isDarkColor, isValidHttpUrl } from './domain/validate';
import { extractPaletteFromBlob } from './domain/paletteExtract';
import { getDict, type Language } from './i18n';
import {
  deleteProjectById,
  getAssetBlob,
  initWorkspace,
  revokeAllCachedAssetUrls,
  saveProject,
  saveWorkspaceMeta,
} from './storage/workspaceRepository';
import { resetDbConnection } from './storage/indexedDb';
import { BoardViewport } from './board/BoardViewport';
import { SelectionOverlay } from './board/SelectionOverlay';
import { useBoardInteractions } from './board/useBoardInteractions';
import { ProjectMenu } from './features/projects/ProjectMenu';
import { InspectorPanel } from './features/inspector/InspectorPanel';
import { InboxPanel } from './features/inbox/InboxPanel';
import { SettingsPopover } from './features/appearance/SettingsPopover';
import { SearchBar } from './features/export/SearchBar';
import { ArrangeModal } from './features/export/ArrangeModal';
import { ClassifyModal } from './features/classification/ClassifyModal';
import { ExportModal } from './features/export/ExportModal';
import { BackupModal } from './features/export/BackupModal';
import { ShortcutsModal } from './features/export/ShortcutsModal';
import { AddLinkModal } from './features/capture/AddLinkModal';
import { LightboxModal } from './features/capture/LightboxModal';
import { TrashModal } from './features/capture/TrashModal';
import {
  importFilesAsCards,
  importUrlAsCard,
  importWebDropData,
  replaceCardImageFile,
} from './features/capture/captureService';

const CLIPBOARD_MARKER = '__0Y03_CARDS_V1__';

function fitWorkspaceView(cards: Card[], width: number, height: number, presenting = false) {
  if (presenting) {
    return computeFitView(cards, width, height, { side: 20, top: 20, bottom: 76 });
  }

  const tokens = getComputedStyle(document.documentElement);
  return computeFitView(cards, width, height, {
    side: Math.min(48, Math.round(width * 0.05)),
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
  const [highlightedCardId, setHighlightedCardId] = useState<string | null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [presentMode, setPresentMode] = useState(false);
  const prePresentViewRef = useRef<ProjectView | null>(null);

  // Modals
  const [arrangeOpen, setArrangeOpen] = useState(false);
  const [arrangePreviewCards, setArrangePreviewCards] = useState<Card[] | null>(null);
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
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
    document.documentElement.classList.toggle('theme-dark', darkTheme);
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

  const anyModalOpen =
    arrangeOpen ||
    classifyOpen ||
    exportOpen ||
    backupOpen ||
    addLinkOpen ||
    trashOpen ||
    shortcutsOpen ||
    Boolean(lightboxCardId);

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
        } catch (err) {
          setSaveStatus('error');
          showToast(
            err instanceof Error ? err.message : 'Chưa lưu được vào bộ nhớ máy.',
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
   * Central project mutation entry point — supports targeted projectId (W10, W17!)
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

      setProjects((list) => list.map((p) => (p.id === targetProjectId ? nextProject : p)));
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
    const boardCards = activeProject.cards.filter((c) => !c.inbox);
    const nextView = fitWorkspaceView(boardCards, viewportSize.width, viewportSize.height);
    handleViewChange(nextView, true);
  }, [activeProject, handleViewChange, viewportSize.height, viewportSize.width]);

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
        title: 'Ghi chú concept',
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

  const createColorCard = useCallback(() => {
    if (!activeProject) return;
    const pt = getViewportCenterWorld();
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
  }, [activeProject, getViewportCenterWorld, mutateProject]);

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
      title: 'Nhóm concept',
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
        showToast(err instanceof Error ? err.message : 'Không thể thay ảnh.', true);
      } finally {
        replaceTargetCardRef.current = null;
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

  // Z-Order & Alignment
  const handleStepZ = useCallback(
    (dir: 'forward' | 'backward') => {
      if (!activeProject || selectedIds.length === 0) return;
      const selSet = new Set(selectedIds);
      mutateProject(
        activeProject.id,
        (p) => {
          const zs = p.cards.filter((c) => !c.inbox).map((c) => c.z);
          const maxZ = zs.length ? Math.max(...zs) : 1;
          const minZ = zs.length ? Math.min(...zs) : 1;
          return {
            ...p,
            cards: p.cards.map((c) => {
              if (!selSet.has(c.id) || c.locked) return c;
              return { ...c, z: dir === 'forward' ? maxZ + 1 : Math.max(1, minZ - 1) };
            }),
          };
        },
        { recordUndo: true }
      );
    },
    [activeProject, mutateProject, selectedIds]
  );

  const handleAlign = useCallback(
    (mode: 'left' | 'top' | 'distribute-h') => {
      if (!activeProject) return;
      const nextCards = alignSelectedCards(activeProject.cards, selectedIds, mode);
      if (!nextCards) return;
      mutateProject(activeProject.id, (p) => ({ ...p, cards: nextCards }), {
        recordUndo: true,
      });
    },
    [activeProject, mutateProject, selectedIds]
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

  // Arrange Preview & Apply
  const handleArrangePreview = useCallback(
    (opts: ArrangeOptions) => {
      if (!activeProject) return;
      setArrangePreviewCards(computeArrangedCards(activeProject.cards, selectedIds, opts));
    },
    [activeProject, selectedIds]
  );

  const handleArrangeApply = useCallback(
    (opts: ArrangeOptions) => {
      if (!activeProject) return;
      const arranged = computeArrangedCards(activeProject.cards, selectedIds, opts);
      setArrangePreviewCards(null);
      const nextView =
        selectedIds.length === 0
          ? computeFitView(
              arranged.filter((c) => !c.inbox),
              viewportSize.width,
              viewportSize.height,
              54
            )
          : activeProject.view;
      mutateProject(
        activeProject.id,
        (p) => ({ ...p, cards: arranged, view: nextView }),
        { recordUndo: true }
      );
    },
    [activeProject, mutateProject, selectedIds, viewportSize.height, viewportSize.width]
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
        return { ...c, category: u.newCategory };
      });

      if (applied > 0) {
        mutateProject(targetProjectId, (p) => ({ ...p, cards: nextCards }), {
          recordUndo: true,
        });
      }
      if (skippedChanged > 0) {
        showToast(
          `Đã áp dụng ${applied} nhãn (bỏ qua ${skippedChanged} mục đã đổi thủ công/đổi ảnh).`
        );
      } else if (applied > 0) {
        showToast(`Đã áp dụng ${applied} nhãn phân loại AI.`);
      }
      return { applied, skippedChanged };
    },
    [mutateProject, showToast]
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
    modalOpen: anyModalOpen,
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
  });

  // Global keyboard shortcuts & paste handler (W04, W05, Section 4 & 5)
  useEffect(() => {
    const isTextInputFocused = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
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
          navigator.clipboard
            ?.writeText(JSON.stringify({ marker: CLIPBOARD_MARKER, cards: payload }))
            .catch(() => undefined);
        }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.length > 0) {
          e.preventDefault();
          handleDeleteIdsToTrash(selectedIds);
        }
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

      // 1. Clipboard image files
      const imgFiles: File[] = [];
      for (const item of Array.from(e.clipboardData.items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) imgFiles.push(f);
        }
      }
      if (imgFiles.length > 0) {
        e.preventDefault();
        const res = await importFilesAsCards(imgFiles, {
          inbox: false,
          worldPoint: { x: center.x - 140, y: center.y - 100 },
          baseZ: getNextZ(proj.cards),
          method: 'paste',
        });
        appendImportedCards(pid, res.cards, res.errors);
        return;
      }

      const text = e.clipboardData.getData('text/plain').trim();
      if (!text) return;

      // 2. Internal 0Y03 cards copy/paste (W04)
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
          // Fall through to plain text
        }
      }

      // 3. HTTP/HTTPS URL -> Link card (or image card)
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
        title: 'Ghi chú dán',
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
    editingCardId,
    exitPresentMode,
    handleDeleteIdsToTrash,
    handleDuplicateIds,
    handleRedo,
    handleUndo,
    interactions,
    moreMenuOpen,
    mutateProject,
    presentMode,
    selectedIds,
    viewportSize.height,
    viewportSize.width,
  ]);

  if (loading) {
    return (
      <div className="fatal-screen">
        <div className="fatal-card">
          <strong>0Y03</strong>
          <p className="field-hint">Đang tải không gian làm việc cục bộ…</p>
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
    <div className={`app-root ${darkTheme ? 'theme-dark' : ''}`}>
      {/* Hidden file inputs */}
      <input
        ref={filePickerRef}
        type="file"
        multiple
        accept="image/*,.dwg,.dxf,.psd,.ai,.indd,.skp,.3dm,.rvt,.max"
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

      {/* Full-viewport interactive Artboard */}
      <BoardViewport
        boardRef={boardRef}
        viewportSize={viewportSize}
        cards={displayedCards}
        appearance={activeProject.appearance}
        view={activeProject.view}
        selectedIds={selectedIds}
        editingCardId={editingCardId}
        highlightedCardId={highlightedCardId}
        presentMode={presentMode}
        spacePressed={interactions.spacePressed}
        draft={interactions.draft}
        dict={dict}
        onPointerDown={interactions.handleBoardPointerDown}
        onPointerMove={interactions.handlePointerMove}
        onPointerUp={interactions.handlePointerUp}
        onPointerCancel={interactions.handlePointerCancel}
        onDoubleClick={interactions.handleBoardDoubleClick}
        onCardPointerDown={interactions.handleCardPointerDown}
        onCardDoubleClick={interactions.handleCardDoubleClick}
        onResizePointerDown={interactions.handleResizePointerDown}
        onUpdateCardText={handleUpdateNoteText}
        onFinishEdit={() => setEditingCardId(null)}
        onOpenLightbox={(c) => setLightboxCardId(c.id)}
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
              <div className="brand-mark">
                <img src={`${import.meta.env.BASE_URL}brand/logo.svg`} alt="" className="brand-logo" />
                <span>{dict.appName}</span>
              </div>

              <div className="topbar-project">
                <ProjectMenu
                  projects={projects}
                  activeProject={activeProject}
                  dict={dict}
                  onSelectProject={handleSelectProject}
                  onCreateProject={handleCreateProject}
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
              <SearchBar cards={activeProject.cards} dict={dict} onSelectResult={handleSearchSelect} />
              <InboxPanel
                open={inboxOpen}
                inboxCards={inboxCards}
                dict={dict}
                onToggle={() => setInboxOpen((v) => !v)}
                onMoveToBoard={(id) => handleMoveFromInboxToBoard(id)}
                onDeleteCard={(id) => handleDeleteIdsToTrash([id])}
                onDropExternalToInbox={(dt) => void handleDropExternal(dt, { x: 100, y: 100 }, true)}
              />
            </div>

            <div className="topbar-right">
              <button
                type="button"
                className="btn topbar-ai-btn"
                title={dict.aiClassify}
                aria-label={dict.aiClassify}
                onClick={() => setClassifyOpen(true)}
              >
                <Sparkles size={15} />
                <span className="btn-label-md">{dict.aiClassify}</span>
              </button>

              <button
                type="button"
                className="btn topbar-arrange-btn"
                title={dict.arrangeBoard}
                aria-label={dict.arrangeBoard}
                onClick={() => setArrangeOpen(true)}
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
                onClick={enterPresentMode}
              >
                <Presentation size={17} />
              </button>

              <SettingsPopover
                appearance={activeProject.appearance}
                language={language}
                dict={dict}
                onChangeAppearance={handleChangeAppearance}
                onChangeLanguage={handleChangeLanguage}
              />

              {/* Secondary Menu: Export, Backup, Trash */}
              <div ref={moreMenuRef} className="popover-anchor">
                <button
                  type="button"
                  className={`icon-btn ${moreMenuOpen ? 'is-active' : ''}`}
                  title={dict.moreMenu}
                  aria-label={dict.moreMenu}
                  aria-expanded={moreMenuOpen}
                  onClick={() => setMoreMenuOpen((v) => !v)}
                >
                  <MoreHorizontal size={18} />
                </button>
                {moreMenuOpen && (
                  <div className="popover-panel popover-panel--right" role="menu">
                    <button
                      type="button"
                      className="popover-action-btn compact-ai-action"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        setClassifyOpen(true);
                      }}
                    >
                      <Sparkles size={15} />
                      <span>{dict.aiClassify}</span>
                    </button>
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
            onGroup={handleGroupSelected}
            onUngroup={() => handleUngroup()}
            onToggleLock={handleToggleLockSelected}
            onBringForward={() => handleStepZ('forward')}
            onSendBackward={() => handleStepZ('backward')}
            onAlignLeft={() => handleAlign('left')}
            onAlignTop={() => handleAlign('top')}
            onDistributeH={() => handleAlign('distribute-h')}
            onDuplicate={() => handleDuplicateIds(selectedIds)}
            onMoveToInbox={() => handleMoveToInbox(selectedIds)}
            onDelete={() => handleDeleteIdsToTrash(selectedIds)}
          />

          {/* Right Inspector Panel when 1 card selected */}
          {singleSelectedCard && !inboxOpen && !arrangeOpen && (
            <InspectorPanel
              card={singleSelectedCard}
              dict={dict}
              onClose={() => setSelectedIds([])}
              onChangeCard={handleChangeCard}
              onOpenLightbox={(c) => setLightboxCardId(c.id)}
              onTriggerReplaceImage={(c) => {
                replaceTargetCardRef.current = c;
                replacePickerRef.current?.click();
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
              className="shortcuts-corner-btn"
              title={dict.shortcuts}
              aria-label={dict.shortcuts}
              onClick={() => setShortcutsOpen(true)}
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
                onClick={createColorCard}
              >
                <Palette size={17} />
                <span className="dock-label">{dict.addColor}</span>
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

      <ArrangeModal
        open={arrangeOpen}
        selectedCount={selectedIds.length}
        dict={dict}
        onPreview={handleArrangePreview}
        onClearPreview={() => setArrangePreviewCards(null)}
        onApply={handleArrangeApply}
        onClose={() => setArrangeOpen(false)}
      />

      <ClassifyModal
        open={classifyOpen}
        projectId={activeProject.id}
        cards={activeProject.cards}
        selectedIds={selectedIds}
        dict={dict}
        onClose={() => setClassifyOpen(false)}
        onApplyLabels={handleApplyAiLabels}
      />

      <ExportModal
        open={exportOpen}
        project={activeProject}
        selectedIds={selectedIds}
        dict={dict}
        onClose={() => setExportOpen(false)}
        onExported={(msg) => showToast(msg)}
      />

      <BackupModal
        open={backupOpen}
        project={activeProject}
        dict={dict}
        onClose={() => setBackupOpen(false)}
        onImportedProject={(imported) => {
          setProjects((list) => [imported, ...list]);
          handleSelectProject(imported.id);
          showToast(`Đã nhập dự án "${imported.name}".`);
        }}
      />

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
