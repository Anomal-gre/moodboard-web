import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignCenterVertical,
  Copy,
  Crop,
  Edit3,
  ExternalLink,
  FolderOpen,
  GitBranchPlus,
  Group,
  ImagePlus,
  Inbox,
  LayoutGrid,
  Link2,
  Lock,
  Maximize2,
  MoveUpRight,
  Palette,
  Redo2,
  RotateCcw,
  Scissors,
  StickyNote,
  Trash2,
  Undo2,
  Ungroup,
  Unlock,
} from 'lucide-react';
import type { Card } from '../domain/types';
import type { AlignMode, Point } from '../domain/geometry';
import type { I18nDict } from '../i18n';
import {
  clampRadialCenter,
  describeRadialSectorPath,
  getRadialSectorCenter,
  hitTestRadialSector,
} from './radialGeometry';

export interface RadialMenuState {
  screenX: number;
  screenY: number;
  worldPoint: Point;
  targetCardId: string | null;
  openedAt: number;
}

interface RadialSlice {
  id: string;
  shortLabel: string;
  fullLabel: string;
  icon: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

interface RadialWheelMenuProps {
  menu: RadialMenuState | null;
  cards: Card[];
  selectedIds: string[];
  canUndo: boolean;
  canRedo: boolean;
  connectMode: boolean;
  dict: I18nDict;
  onClose: () => void;
  // Canvas background actions (full bottom-dock replacement)
  onCreateNoteAt: (worldPoint: Point) => void;
  onTriggerAddFiles: () => void;
  onCreateColorAt: (worldPoint: Point) => void;
  onOpenAddLink: () => void;
  onOpenArrange: () => void;
  onToggleConnectMode: () => void;
  onUndo: () => void;
  onRedo: () => void;
  // Card & Multi-select actions
  onOpenLightbox: (card: Card) => void;
  onRunAiCutout: (card: Card) => void;
  onRestoreOriginalBg: (card: Card) => void;
  onToggleCrop: (cardId: string) => void;
  onExtractPalette: (card: Card) => void;
  onStartConnectFrom: (cardId: string) => void;
  onConnectSelected: () => void;
  onEditNote: (cardId: string) => void;
  onCopyHex: (hex: string) => void;
  onOpenFileCard: (card: Card) => void;
  onDuplicate: (ids: string[]) => void;
  onToggleLock: () => void;
  onGroup: () => void;
  onUngroup: (frameId?: string) => void;
  onAlign: (mode: AlignMode) => void;
  onMoveToInbox: (ids: string[]) => void;
  onDelete: (ids: string[]) => void;
}

const WHEEL_SIZE = 296;
const HALF = WHEEL_SIZE / 2;
const OUTER_R = 136;
const INNER_R = 52;
const DEADZONE_R = 30;
const ICON_RING_R = 95;

export const RadialWheelMenu: React.FC<RadialWheelMenuProps> = ({
  menu,
  cards,
  selectedIds,
  canUndo,
  canRedo,
  connectMode,
  dict,
  onClose,
  onCreateNoteAt,
  onTriggerAddFiles,
  onCreateColorAt,
  onOpenAddLink,
  onOpenArrange,
  onToggleConnectMode,
  onUndo,
  onRedo,
  onOpenLightbox,
  onRunAiCutout,
  onRestoreOriginalBg,
  onToggleCrop,
  onExtractPalette,
  onStartConnectFrom,
  onConnectSelected,
  onEditNote,
  onCopyHex,
  onOpenFileCard,
  onDuplicate,
  onToggleLock,
  onGroup,
  onUngroup,
  onAlign,
  onMoveToInbox,
  onDelete,
}) => {
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [pinnedClickMode, setPinnedClickMode] = useState(false);
  const [pointerAngleDeg, setPointerAngleDeg] = useState<number | null>(null);

  const activeIndexRef = useRef(-1);
  const pinnedRef = useRef(false);
  const maxDistRef = useRef(0);
  const slicesRef = useRef<RadialSlice[]>([]);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const center = useMemo(() => {
    if (!menu) return { x: 0, y: 0 };
    return clampRadialCenter(
      menu.screenX,
      menu.screenY,
      typeof window !== 'undefined' ? window.innerWidth : 1440,
      typeof window !== 'undefined' ? window.innerHeight : 900,
      OUTER_R,
      20
    );
  }, [menu]);

  const { contextBadge, slices } = useMemo<{ contextBadge: string; slices: RadialSlice[] }>(() => {
    if (!menu) return { contextBadge: '', slices: [] };

    const targetCard = menu.targetCardId
      ? cards.find((c) => c.id === menu.targetCardId) ?? null
      : null;

    // 1. CANVAS BACKGROUND WHEEL (8 symmetric slices = full Zen replacement for Bottom Dock)
    // 12h: Media | 1:30: Note | 3h: Redo -> | 4:30: Color | 6h: Connect | 7:30: Link | 9h: <- Undo | 10:30: Arrange
    if (!targetCard) {
      return {
        contextBadge: dict.radialCtxCanvas,
        slices: [
          {
            id: 'media',
            shortLabel: dict.radialShortMedia,
            fullLabel: dict.addMedia,
            icon: <ImagePlus size={17} strokeWidth={2} />,
            onSelect: () => onTriggerAddFiles(),
          },
          {
            id: 'note',
            shortLabel: dict.radialShortNote,
            fullLabel: dict.ctxCreateNoteHere,
            icon: <StickyNote size={17} strokeWidth={2} />,
            onSelect: () => onCreateNoteAt(menu.worldPoint),
          },
          {
            id: 'redo',
            shortLabel: dict.radialShortRedo,
            fullLabel: dict.redo,
            icon: <Redo2 size={17} strokeWidth={2} />,
            disabled: !canRedo,
            onSelect: () => onRedo(),
          },
          {
            id: 'color',
            shortLabel: dict.radialShortColor,
            fullLabel: dict.ctxCreateColorHere,
            icon: <Palette size={17} strokeWidth={2} />,
            onSelect: () => onCreateColorAt(menu.worldPoint),
          },
          {
            id: 'connect-mode',
            shortLabel: connectMode ? dict.radialShortExitConnect : dict.radialShortConnect,
            fullLabel: dict.addConnectorTitle,
            icon: <MoveUpRight size={17} strokeWidth={2} />,
            onSelect: () => onToggleConnectMode(),
          },
          {
            id: 'link',
            shortLabel: dict.radialShortLink,
            fullLabel: dict.addLink,
            icon: <Link2 size={17} strokeWidth={2} />,
            onSelect: () => onOpenAddLink(),
          },
          {
            id: 'undo',
            shortLabel: dict.radialShortUndo,
            fullLabel: dict.undo,
            icon: <Undo2 size={17} strokeWidth={2} />,
            disabled: !canUndo,
            onSelect: () => onUndo(),
          },
          {
            id: 'arrange',
            shortLabel: dict.radialShortArrange,
            fullLabel: dict.arrangeBoard,
            icon: <LayoutGrid size={17} strokeWidth={2} />,
            onSelect: () => onOpenArrange(),
          },
        ],
      };
    }

    const activeIds = selectedIds.includes(targetCard.id) ? selectedIds : [targetCard.id];
    const activeCards = cards.filter((c) => activeIds.includes(c.id));

    // 2. MULTI-SELECT WHEEL (>= 2 cards selected, 6 slices)
    if (activeCards.length >= 2) {
      const hasFrame = activeCards.some((c) => c.kind === 'frame' || Boolean(c.groupId));
      const canGroup = activeCards.filter((c) => !c.locked && c.kind !== 'frame').length >= 2;
      return {
        contextBadge: dict.radialCtxMulti(activeCards.length),
        slices: [
          hasFrame
            ? {
                id: 'ungroup',
                shortLabel: dict.radialShortUngroup,
                fullLabel: dict.ungroupCards,
                icon: <Ungroup size={18} strokeWidth={2} />,
                onSelect: () => onUngroup(),
              }
            : {
                id: 'group',
                shortLabel: dict.radialShortGroup,
                fullLabel: dict.groupCards,
                icon: <Group size={18} strokeWidth={2} />,
                disabled: !canGroup,
                onSelect: () => onGroup(),
              },
          {
            id: 'connect-chain',
            shortLabel: dict.radialShortConnect,
            fullLabel: dict.connectCards,
            icon: <GitBranchPlus size={18} strokeWidth={2} />,
            onSelect: () => onConnectSelected(),
          },
          {
            id: 'align-mid',
            shortLabel: dict.radialShortAlign,
            fullLabel: dict.alignCenterH,
            icon: <AlignCenterVertical size={18} strokeWidth={2} />,
            onSelect: () => onAlign('center-h'),
          },
          {
            id: 'tray',
            shortLabel: dict.radialShortTray,
            fullLabel: dict.moveToInbox,
            icon: <Inbox size={18} strokeWidth={2} />,
            onSelect: () => onMoveToInbox(activeIds),
          },
          {
            id: 'delete',
            shortLabel: dict.radialShortDelete,
            fullLabel: dict.deleteToTrash,
            icon: <Trash2 size={18} strokeWidth={2} />,
            danger: true,
            onSelect: () => onDelete(activeIds),
          },
          {
            id: 'duplicate',
            shortLabel: dict.radialShortDuplicate,
            fullLabel: dict.duplicate,
            icon: <Copy size={18} strokeWidth={2} />,
            onSelect: () => onDuplicate(activeIds),
          },
        ],
      };
    }

    // 3. IMAGE CARD WHEEL (8 studio image-editing slices, 45° each)
    if (targetCard.kind === 'image') {
      const hasLocalAsset = Boolean(targetCard.assetId);
      const isCutoutRestorable = Boolean(targetCard.cutout && targetCard.originalAssetId);
      return {
        contextBadge: dict.radialCtxImage,
        slices: [
          {
            id: 'lightbox',
            shortLabel: dict.radialShortView,
            fullLabel: dict.viewLarge,
            icon: <Maximize2 size={17} strokeWidth={2} />,
            disabled: !(targetCard.assetId || targetCard.source?.imageUrl),
            onSelect: () => onOpenLightbox(targetCard),
          },
          isCutoutRestorable
            ? {
                id: 'restore-bg',
                shortLabel: dict.radialShortRestoreBg,
                fullLabel: dict.aiCutoutRestore,
                icon: <RotateCcw size={17} strokeWidth={2} />,
                onSelect: () => onRestoreOriginalBg(targetCard),
              }
            : {
                id: 'cutout',
                shortLabel: dict.radialShortCutout,
                fullLabel: dict.aiCutoutBtn,
                icon: <Scissors size={17} strokeWidth={2} />,
                disabled: !hasLocalAsset,
                onSelect: () => onRunAiCutout(targetCard),
              },
          {
            id: 'connect',
            shortLabel: dict.radialShortConnect,
            fullLabel: dict.connectCards,
            icon: <GitBranchPlus size={17} strokeWidth={2} />,
            onSelect: () => onStartConnectFrom(targetCard.id),
          },
          {
            id: 'palette',
            shortLabel: dict.radialShortPalette,
            fullLabel: dict.extractPaletteShort,
            icon: <Palette size={17} strokeWidth={2} />,
            disabled: !hasLocalAsset,
            onSelect: () => onExtractPalette(targetCard),
          },
          {
            id: 'tray',
            shortLabel: dict.radialShortTray,
            fullLabel: dict.moveToInbox,
            icon: <Inbox size={17} strokeWidth={2} />,
            onSelect: () => onMoveToInbox([targetCard.id]),
          },
          {
            id: 'delete',
            shortLabel: dict.radialShortDelete,
            fullLabel: dict.deleteToTrash,
            icon: <Trash2 size={17} strokeWidth={2} />,
            danger: true,
            onSelect: () => onDelete([targetCard.id]),
          },
          {
            id: 'crop',
            shortLabel: dict.radialShortCrop,
            fullLabel: dict.cropImage,
            icon: <Crop size={17} strokeWidth={2} />,
            disabled: !hasLocalAsset,
            onSelect: () => onToggleCrop(targetCard.id),
          },
          {
            id: 'duplicate',
            shortLabel: dict.radialShortDuplicate,
            fullLabel: dict.duplicate,
            icon: <Copy size={17} strokeWidth={2} />,
            onSelect: () => onDuplicate([targetCard.id]),
          },
        ],
      };
    }

    // 4. SINGLE CARD WHEEL (Note / Color / Link / File / Frame — adaptive 12 o'clock primary slot, 6 slices)
    const primarySlice: RadialSlice =
      targetCard.kind === 'note'
        ? {
            id: 'edit-note',
            shortLabel: dict.radialShortEdit,
            fullLabel: dict.ctxEditNote,
            icon: <Edit3 size={18} strokeWidth={2} />,
            onSelect: () => onEditNote(targetCard.id),
          }
        : targetCard.kind === 'color'
          ? {
              id: 'copy-hex',
              shortLabel: dict.radialShortCopyHex,
              fullLabel: dict.copyHex,
              icon: <Copy size={18} strokeWidth={2} />,
              onSelect: () => onCopyHex((targetCard.color || '#8D9A7C').toUpperCase()),
            }
          : targetCard.kind === 'link'
            ? {
                id: 'open-link',
                shortLabel: dict.radialShortOpenUrl,
                fullLabel: dict.openSource,
                icon: <ExternalLink size={18} strokeWidth={2} />,
                disabled: !targetCard.source?.pageUrl,
                onSelect: () => {
                  if (targetCard.source?.pageUrl) {
                    window.open(targetCard.source.pageUrl, '_blank', 'noopener,noreferrer');
                  }
                },
              }
            : targetCard.kind === 'file'
              ? {
                  id: 'open-file',
                  shortLabel: dict.radialShortOpenFile,
                  fullLabel: dict.openFile,
                  icon: <FolderOpen size={18} strokeWidth={2} />,
                  onSelect: () => onOpenFileCard(targetCard),
                }
              : {
                  id: 'ungroup-frame',
                  shortLabel: dict.radialShortUngroup,
                  fullLabel: dict.ungroupCards,
                  icon: <Ungroup size={18} strokeWidth={2} />,
                  onSelect: () => onUngroup(targetCard.id),
                };

    return {
      contextBadge: dict.radialCtxCard,
      slices: [
        primarySlice,
        {
          id: 'connect',
          shortLabel: dict.radialShortConnect,
          fullLabel: dict.connectCards,
          icon: <GitBranchPlus size={18} strokeWidth={2} />,
          disabled: targetCard.kind === 'frame',
          onSelect: () => onStartConnectFrom(targetCard.id),
        },
        {
          id: 'duplicate',
          shortLabel: dict.radialShortDuplicate,
          fullLabel: dict.duplicate,
          icon: <Copy size={18} strokeWidth={2} />,
          onSelect: () => onDuplicate([targetCard.id]),
        },
        {
          id: 'tray',
          shortLabel: dict.radialShortTray,
          fullLabel: dict.moveToInbox,
          icon: <Inbox size={18} strokeWidth={2} />,
          disabled: targetCard.kind === 'frame',
          onSelect: () => onMoveToInbox([targetCard.id]),
        },
        {
          id: 'delete',
          shortLabel: dict.radialShortDelete,
          fullLabel: dict.deleteToTrash,
          icon: <Trash2 size={18} strokeWidth={2} />,
          danger: true,
          onSelect: () => onDelete([targetCard.id]),
        },
        {
          id: 'lock',
          shortLabel: targetCard.locked ? dict.radialShortUnlock : dict.radialShortLock,
          fullLabel: targetCard.locked ? dict.unlockCard : dict.lockCard,
          icon: targetCard.locked ? <Unlock size={18} strokeWidth={2} /> : <Lock size={18} strokeWidth={2} />,
          onSelect: () => onToggleLock(),
        },
      ],
    };
  }, [
    canRedo,
    canUndo,
    cards,
    connectMode,
    dict,
    menu,
    onAlign,
    onConnectSelected,
    onCopyHex,
    onCreateColorAt,
    onCreateNoteAt,
    onDelete,
    onDuplicate,
    onEditNote,
    onExtractPalette,
    onGroup,
    onMoveToInbox,
    onOpenAddLink,
    onOpenArrange,
    onOpenFileCard,
    onOpenLightbox,
    onRedo,
    onRestoreOriginalBg,
    onRunAiCutout,
    onStartConnectFrom,
    onToggleConnectMode,
    onToggleCrop,
    onToggleLock,
    onTriggerAddFiles,
    onUndo,
    onUngroup,
    selectedIds,
  ]);

  slicesRef.current = slices;

  // Reset internal tracking whenever a fresh radial menu opens
  useEffect(() => {
    if (!menu) {
      activeIndexRef.current = -1;
      pinnedRef.current = false;
      maxDistRef.current = 0;
      setActiveIndex(-1);
      setPinnedClickMode(false);
      setPointerAngleDeg(null);
      return;
    }

    activeIndexRef.current = -1;
    pinnedRef.current = false;
    maxDistRef.current = 0;
    setActiveIndex(-1);
    setPinnedClickMode(false);
    setPointerAngleDeg(null);

    const cx = center.x;
    const cy = center.y;

    const triggerSlice = (idx: number) => {
      const target = slicesRef.current[idx];
      onCloseRef.current();
      if (target && !target.disabled) {
        target.onSelect();
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > maxDistRef.current) maxDistRef.current = dist;

      const idx = hitTestRadialSector(
        e.clientX,
        e.clientY,
        cx,
        cy,
        slicesRef.current.length,
        DEADZONE_R
      );
      if (idx !== activeIndexRef.current) {
        activeIndexRef.current = idx;
        setActiveIndex(idx);
      }
      if (dist >= 16) {
        const deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
        setPointerAngleDeg(deg);
      } else {
        setPointerAngleDeg(null);
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      // Hold-Drag-Release flow for mouse right button
      if (!pinnedRef.current && e.button === 2) {
        const idx = hitTestRadialSector(
          e.clientX,
          e.clientY,
          cx,
          cy,
          slicesRef.current.length,
          DEADZONE_R
        );
        if (idx >= 0) {
          triggerSlice(idx);
          return;
        }
        const elapsed = performance.now() - menu.openedAt;
        // Quick tap on Trackpad / Mouse without dragging stays open for click selection!
        if (elapsed < 260 && maxDistRef.current < 16) {
          pinnedRef.current = true;
          setPinnedClickMode(true);
          return;
        }
        onCloseRef.current();
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      // In Trackpad pinned mode: left-click triggers highlighted slice or closes if outside/center
      if (!pinnedRef.current) return;
      if (e.button === 0) {
        e.preventDefault();
        e.stopPropagation();
        const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
        const idx = hitTestRadialSector(
          e.clientX,
          e.clientY,
          cx,
          cy,
          slicesRef.current.length,
          DEADZONE_R
        );
        if (idx >= 0 && dist <= OUTER_R + 28) {
          triggerSlice(idx);
        } else {
          onCloseRef.current();
        }
      } else if (e.button === 2) {
        onCloseRef.current();
      }
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
      }
    };

    const onWheel = () => onCloseRef.current();

    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('contextmenu', onContextMenu, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('wheel', onWheel, { passive: true });

    return () => {
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('contextmenu', onContextMenu, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('wheel', onWheel);
    };
  }, [center.x, center.y, menu]);

  if (!menu || slices.length === 0) return null;

  const activeSlice = activeIndex >= 0 ? slices[activeIndex] : null;
  const count = slices.length;

  return (
    <div
      className="radial-wheel-root"
      style={{
        left: center.x - HALF,
        top: center.y - HALF,
        width: WHEEL_SIZE,
        height: WHEEL_SIZE,
      }}
      role="menu"
      aria-label={dict.radialMenuToggle}
      data-context={contextBadge}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Frosted Glass Ring Backdrop */}
      <div className="radial-wheel-glass-ring" aria-hidden="true" />

      {/* Crisp SVG Annular Pie Sectors */}
      <svg
        className="radial-wheel-svg"
        width={WHEEL_SIZE}
        height={WHEEL_SIZE}
        viewBox={`0 0 ${WHEEL_SIZE} ${WHEEL_SIZE}`}
        aria-hidden="true"
      >
        {slices.map((slice, i) => {
          const isActive = i === activeIndex && !slice.disabled;
          const d = describeRadialSectorPath(HALF, HALF, INNER_R, OUTER_R, i, count, 2.2);
          return (
            <path
              key={slice.id}
              d={d}
              className={[
                'radial-slice-path',
                isActive ? 'is-active' : '',
                slice.danger ? 'is-danger' : '',
                slice.disabled ? 'is-disabled' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            />
          );
        })}
      </svg>

      {/* Positioned Slice Icons & Short Labels */}
      {slices.map((slice, i) => {
        const pt = getRadialSectorCenter(HALF, HALF, ICON_RING_R, i, count);
        const isActive = i === activeIndex && !slice.disabled;
        return (
          <div
            key={slice.id}
            data-radial-slice={slice.id}
            className={[
              'radial-slice-content',
              isActive ? 'is-active' : '',
              slice.danger ? 'is-danger' : '',
              slice.disabled ? 'is-disabled' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ left: pt.x, top: pt.y }}
          >
            <span className="radial-slice-icon">{slice.icon}</span>
            <span className="radial-slice-label">{slice.shortLabel}</span>
          </div>
        );
      })}

      {/* Center Frosted Hub showing Active Command or Context Hint */}
      <div
        className={[
          'radial-wheel-hub',
          activeSlice && !activeSlice.disabled ? 'has-active' : '',
          activeSlice?.danger ? 'is-danger' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {pointerAngleDeg !== null && (
          <div
            className="radial-hub-orbit"
            style={{ transform: `rotate(${pointerAngleDeg}deg)` }}
            aria-hidden="true"
          >
            <span className="radial-hub-pip" />
          </div>
        )}
        <span className="radial-hub-badge">{contextBadge}</span>
        <span className="radial-hub-title">
          {activeSlice
            ? activeSlice.fullLabel
            : pinnedClickMode
              ? dict.radialClickHint
              : dict.radialCancelHint}
        </span>
      </div>
    </div>
  );
};
