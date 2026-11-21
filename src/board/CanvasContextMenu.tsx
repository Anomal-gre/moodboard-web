import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AlignCenterVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDownToLine,
  ArrowUpToLine,
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
  Maximize,
  Maximize2,
  Move,
  Palette,
  Pipette,
  Redo2,
  RefreshCw,
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

export interface ContextMenuState {
  screenX: number;
  screenY: number;
  worldPoint: Point;
  targetCardId: string | null;
}

interface CanvasContextMenuProps {
  menu: ContextMenuState | null;
  cards: Card[];
  selectedIds: string[];
  canUndo: boolean;
  canRedo: boolean;
  dict: I18nDict;
  onClose: () => void;
  // Card actions
  onStartStickyMove: (clientPt: { clientX: number; clientY: number }) => void;
  onEditNote: (cardId: string) => void;
  onOpenFileCard: (card: Card) => void;
  onReplaceFileCard: (card: Card) => void;
  onOpenLightbox: (card: Card) => void;
  onReplaceImageCard: (card: Card) => void;
  onExtractPalette: (card: Card) => void;
  onToggleCrop: (cardId: string) => void;
  onRunAiCutout: (card: Card) => void;
  onCopyImageForApps: (card?: Card) => void;
  onConnectSelected: () => void;
  onClearConnections: () => void;
  onPickEyedropperColor: () => void;
  onCopyHex: (hex: string) => void;
  onDuplicate: (ids: string[]) => void;
  onStepZ: (dir: 'forward' | 'backward') => void;
  onToggleLock: () => void;
  onGroup: () => void;
  onUngroup: (frameId?: string) => void;
  onAlign: (mode: AlignMode) => void;
  onMoveToInbox: (ids: string[]) => void;
  onDelete: (ids: string[]) => void;
  // Canvas background actions
  onCreateNoteAt: (worldPoint: Point) => void;
  onTriggerAddFiles: () => void;
  onOpenAddLink: () => void;
  onCreateColorAt: (worldPoint: Point) => void;
  onOpenArrange: () => void;
  onFitBoard: () => void;
  onZoomReset: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

export const CanvasContextMenu: React.FC<CanvasContextMenuProps> = ({
  menu,
  cards,
  selectedIds,
  canUndo,
  canRedo,
  dict,
  onClose,
  onStartStickyMove,
  onEditNote,
  onOpenFileCard,
  onReplaceFileCard,
  onOpenLightbox,
  onReplaceImageCard,
  onExtractPalette,
  onToggleCrop,
  onRunAiCutout,
  onCopyImageForApps,
  onConnectSelected,
  onClearConnections,
  onPickEyedropperColor,
  onCopyHex,
  onDuplicate,
  onStepZ,
  onToggleLock,
  onGroup,
  onUngroup,
  onAlign,
  onMoveToInbox,
  onDelete,
  onCreateNoteAt,
  onTriggerAddFiles,
  onOpenAddLink,
  onCreateColorAt,
  onOpenArrange,
  onFitBoard,
  onZoomReset,
  onUndo,
  onRedo,
}) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!menu) return;
    const el = menuRef.current;
    const w = el ? el.offsetWidth : 232;
    const h = el ? el.offsetHeight : 320;
    const pad = 12;
    const left = Math.max(pad, Math.min(menu.screenX, window.innerWidth - w - pad));
    const top = Math.max(pad, Math.min(menu.screenY, window.innerHeight - h - pad));
    setPos({ left, top });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    const onWheel = () => onClose();
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('wheel', onWheel);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  const targetCard = menu.targetCardId
    ? cards.find((c) => c.id === menu.targetCardId) ?? null
    : null;

  const activeIds =
    targetCard && selectedIds.includes(targetCard.id)
      ? selectedIds
      : targetCard
        ? [targetCard.id]
        : [];
  const activeCards = cards.filter((c) => activeIds.includes(c.id));
  const isMulti = activeCards.length >= 2;
  const allLocked = activeCards.length > 0 && activeCards.every((c) => c.locked);
  const hasFrame = activeCards.some((c) => c.kind === 'frame' || Boolean(c.groupId));
  const canGroup = activeCards.filter((c) => !c.locked && c.kind !== 'frame').length >= 2;

  const run = (fn: () => void) => {
    onClose();
    fn();
  };

  return (
    <div
      ref={menuRef}
      className="ctx-menu"
      style={{ left: pos.left, top: pos.top }}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      {targetCard ? (
        <>
          {/* Single-card contextual primary actions */}
          {!isMulti && targetCard.kind === 'file' && (
            <>
              <button
                type="button"
                className="ctx-item"
                role="menuitem"
                onClick={() => run(() => onOpenFileCard(targetCard))}
              >
                <FolderOpen size={15} />
                <span>{dict.openFile}</span>
              </button>
              <button
                type="button"
                className="ctx-item"
                role="menuitem"
                onClick={() => run(() => onReplaceFileCard(targetCard))}
              >
                <RefreshCw size={15} />
                <span>{dict.relinkFile}</span>
              </button>
              <div className="ctx-sep" />
            </>
          )}

          {!isMulti && targetCard.kind === 'image' && (
            <>
              {(targetCard.assetId || targetCard.source?.imageUrl) && (
                <button
                  type="button"
                  className="ctx-item"
                  role="menuitem"
                  onClick={() => run(() => onOpenLightbox(targetCard))}
                >
                  <Maximize2 size={15} />
                  <span>{dict.viewLarge}</span>
                </button>
              )}
              {targetCard.assetId && (
                <>
                  <button
                    type="button"
                    className="ctx-item"
                    role="menuitem"
                    onClick={() => run(() => onToggleCrop(targetCard.id))}
                  >
                    <Crop size={15} />
                    <span>{dict.cropImage}</span>
                  </button>
                  <button
                    type="button"
                    className="ctx-item"
                    role="menuitem"
                    onClick={() => run(() => onRunAiCutout(targetCard))}
                  >
                    <Scissors size={15} />
                    <span>{dict.aiCutoutBtn}</span>
                  </button>
                  <button
                    type="button"
                    className="ctx-item"
                    role="menuitem"
                    onClick={() => run(() => onCopyImageForApps(targetCard))}
                  >
                    <Copy size={15} />
                    <span>{dict.copyForDesignApps}</span>
                    <span className="ctx-kbd">Ctrl+C</span>
                  </button>
                  <button
                    type="button"
                    className="ctx-item"
                    role="menuitem"
                    onClick={() => run(() => onExtractPalette(targetCard))}
                  >
                    <Palette size={15} />
                    <span>{dict.extractPalette}</span>
                  </button>
                </>
              )}
              <button
                type="button"
                className="ctx-item"
                role="menuitem"
                onClick={() => run(() => onReplaceImageCard(targetCard))}
              >
                <RefreshCw size={15} />
                <span>{dict.replaceImage}</span>
              </button>
              <div className="ctx-sep" />
            </>
          )}

          {!isMulti && targetCard.kind === 'note' && !targetCard.locked && (
            <>
              <button
                type="button"
                className="ctx-item"
                role="menuitem"
                onClick={() => run(() => onEditNote(targetCard.id))}
              >
                <Edit3 size={15} />
                <span>{dict.ctxEditNote}</span>
              </button>
              <div className="ctx-sep" />
            </>
          )}

          {!isMulti && targetCard.kind === 'link' && targetCard.source?.pageUrl && (
            <>
              <button
                type="button"
                className="ctx-item"
                role="menuitem"
                onClick={() =>
                  run(() => window.open(targetCard.source!.pageUrl!, '_blank', 'noopener,noreferrer'))
                }
              >
                <ExternalLink size={15} />
                <span>{dict.openSource}</span>
              </button>
              <div className="ctx-sep" />
            </>
          )}

          {!isMulti && targetCard.kind === 'color' && (
            <>
              <button
                type="button"
                className="ctx-item"
                role="menuitem"
                onClick={() => run(() => onCopyHex((targetCard.color || '#8D9A7C').toUpperCase()))}
              >
                <Copy size={15} />
                <span>{dict.copyHex} ({(targetCard.color || '#8D9A7C').toUpperCase()})</span>
              </button>
              <div className="ctx-sep" />
            </>
          )}

          {/* Move, Duplicate, Z-order */}
          {!allLocked && (
            <button
              type="button"
              className="ctx-item"
              role="menuitem"
              onClick={() =>
                run(() => onStartStickyMove({ clientX: menu.screenX, clientY: menu.screenY }))
              }
            >
              <Move size={15} />
              <span>{dict.ctxStickyMove}</span>
              <span className="ctx-kbd">M</span>
            </button>
          )}

          <button
            type="button"
            className="ctx-item"
            role="menuitem"
            onClick={() => run(() => onDuplicate(activeIds))}
          >
            <Copy size={15} />
            <span>{dict.duplicate}</span>
            <span className="ctx-kbd">Ctrl+D</span>
          </button>

          <button
            type="button"
            className="ctx-item"
            role="menuitem"
            onClick={() => run(() => onStepZ('forward'))}
          >
            <ArrowUpToLine size={15} />
            <span>{dict.bringForward}</span>
          </button>

          <button
            type="button"
            className="ctx-item"
            role="menuitem"
            onClick={() => run(() => onStepZ('backward'))}
          >
            <ArrowDownToLine size={15} />
            <span>{dict.sendBackward}</span>
          </button>

          {/* Multi-select quick align, connectors & group */}
          {isMulti && (
            <>
              <div className="ctx-sep" />
              <button
                type="button"
                className="ctx-item"
                role="menuitem"
                onClick={() => run(onConnectSelected)}
              >
                <GitBranchPlus size={15} />
                <span>{dict.connectCards}</span>
              </button>
              {activeCards.some((c) => c.linksTo && c.linksTo.length > 0) && (
                <button
                  type="button"
                  className="ctx-item"
                  role="menuitem"
                  onClick={() => run(onClearConnections)}
                >
                  <Ungroup size={15} />
                  <span>{dict.clearConnections}</span>
                </button>
              )}
              <button
                type="button"
                className="ctx-item"
                role="menuitem"
                onClick={() => run(() => onCopyImageForApps())}
              >
                <Copy size={15} />
                <span>{dict.copyForDesignApps}</span>
              </button>
              <div className="ctx-align-row">
                <button
                  type="button"
                  className="ctx-mini-btn"
                  title={dict.alignLeft}
                  onClick={() => run(() => onAlign('left'))}
                >
                  <AlignStartVertical size={14} />
                </button>
                <button
                  type="button"
                  className="ctx-mini-btn"
                  title={dict.alignCenterH}
                  onClick={() => run(() => onAlign('center-h'))}
                >
                  <AlignCenterVertical size={14} />
                </button>
                <button
                  type="button"
                  className="ctx-mini-btn"
                  title={dict.alignTop}
                  onClick={() => run(() => onAlign('top'))}
                >
                  <AlignStartHorizontal size={14} />
                </button>
                {canGroup && (
                  <button
                    type="button"
                    className="ctx-mini-btn"
                    title={dict.groupCards}
                    onClick={() => run(onGroup)}
                  >
                    <Group size={14} />
                  </button>
                )}
              </div>
            </>
          )}

          {hasFrame && (
            <button
              type="button"
              className="ctx-item"
              role="menuitem"
              onClick={() => run(() => onUngroup(targetCard.kind === 'frame' ? targetCard.id : undefined))}
            >
              <Ungroup size={15} />
              <span>{dict.ungroupCards}</span>
            </button>
          )}

          <div className="ctx-sep" />

          <button
            type="button"
            className="ctx-item"
            role="menuitem"
            onClick={() => run(onToggleLock)}
          >
            {allLocked ? <Unlock size={15} /> : <Lock size={15} />}
            <span>{allLocked ? dict.unlockCard : dict.lockCard}</span>
          </button>

          {targetCard.kind !== 'frame' && (
            <button
              type="button"
              className="ctx-item"
              role="menuitem"
              onClick={() => run(() => onMoveToInbox(activeIds))}
            >
              <Inbox size={15} />
              <span>{dict.moveToInbox}</span>
            </button>
          )}

          <div className="ctx-sep" />

          <button
            type="button"
            className="ctx-item ctx-item--danger"
            role="menuitem"
            onClick={() => run(() => onDelete(activeIds))}
          >
            <Trash2 size={15} />
            <span>{dict.deleteToTrash}</span>
            <span className="ctx-kbd">Del</span>
          </button>
        </>
      ) : (
        <>
          {/* Empty Canvas Background Context Menu */}
          <button
            type="button"
            className="ctx-item"
            role="menuitem"
            onClick={() => run(() => onCreateNoteAt(menu.worldPoint))}
          >
            <StickyNote size={15} />
            <span>{dict.ctxCreateNoteHere}</span>
          </button>
          <button
            type="button"
            className="ctx-item"
            role="menuitem"
            onClick={() => run(onTriggerAddFiles)}
          >
            <ImagePlus size={15} />
            <span>{dict.addImageOrFile}</span>
          </button>
          <button
            type="button"
            className="ctx-item"
            role="menuitem"
            onClick={() => run(onOpenAddLink)}
          >
            <Link2 size={15} />
            <span>{dict.addLinkTitle}</span>
          </button>
          <button
            type="button"
            className="ctx-item"
            role="menuitem"
            onClick={() => run(() => onCreateColorAt(menu.worldPoint))}
          >
            <Palette size={15} />
            <span>{dict.ctxCreateColorHere}</span>
          </button>
          <button
            type="button"
            className="ctx-item"
            role="menuitem"
            onClick={() => run(onPickEyedropperColor)}
          >
            <Pipette size={15} />
            <span>{dict.eyedropperBtn}</span>
          </button>

          <div className="ctx-sep" />

          <button
            type="button"
            className="ctx-item"
            role="menuitem"
            onClick={() => run(onOpenArrange)}
          >
            <LayoutGrid size={15} />
            <span>{dict.arrangeBoard}</span>
          </button>
          <button
            type="button"
            className="ctx-item"
            role="menuitem"
            onClick={() => run(onFitBoard)}
          >
            <Maximize size={15} />
            <span>{dict.fitBoard}</span>
          </button>
          <button
            type="button"
            className="ctx-item"
            role="menuitem"
            onClick={() => run(onZoomReset)}
          >
            <Maximize2 size={15} />
            <span>{dict.zoomReset}</span>
          </button>

          <div className="ctx-sep" />

          <button
            type="button"
            className="ctx-item"
            role="menuitem"
            disabled={!canUndo}
            onClick={() => run(onUndo)}
          >
            <Undo2 size={15} />
            <span>{dict.undo}</span>
            <span className="ctx-kbd">Ctrl+Z</span>
          </button>
          <button
            type="button"
            className="ctx-item"
            role="menuitem"
            disabled={!canRedo}
            onClick={() => run(onRedo)}
          >
            <Redo2 size={15} />
            <span>{dict.redo}</span>
            <span className="ctx-kbd">Ctrl+Shift+Z</span>
          </button>
        </>
      )}
    </div>
  );
};
