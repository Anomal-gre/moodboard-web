import React, { useMemo, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import type { Card, ProjectAppearance, ProjectView } from '../domain/types';
import { rectsIntersect, screenToWorld, type Point, type Rect } from '../domain/geometry';
import { isDarkColor } from '../domain/validate';
import type { I18nDict } from '../i18n';
import { CardView } from './CardView';
import type { DragDraft } from './useBoardInteractions';

interface BoardViewportProps {
  boardRef: React.RefObject<HTMLDivElement | null>;
  viewportSize: { width: number; height: number };
  cards: Card[];
  appearance: ProjectAppearance;
  view: ProjectView;
  selectedIds: string[];
  editingCardId: string | null;
  highlightedCardId: string | null;
  presentMode: boolean;
  spacePressed: boolean;
  draft: DragDraft | null;
  dict: I18nDict;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: () => void;
  onDoubleClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  onCardPointerDown: (e: React.PointerEvent, card: Card) => void;
  onCardDoubleClick: (e: React.MouseEvent, card: Card) => void;
  onResizePointerDown: (e: React.PointerEvent, card: Card) => void;
  onUpdateCardText: (cardId: string, text: string) => void;
  onFinishEdit: () => void;
  onOpenLightbox: (card: Card) => void;
  onTriggerReplaceImage: (card: Card) => void;
  onTriggerAddImage: () => void;
  onDropExternal: (dt: DataTransfer, worldPoint: Point) => void;
  onDropInboxCard: (cardId: string, worldPoint: Point) => void;
}

const VIRTUAL_PADDING_SCREEN = 300;

export const BoardViewport: React.FC<BoardViewportProps> = ({
  boardRef,
  viewportSize,
  cards,
  appearance,
  view,
  selectedIds,
  editingCardId,
  highlightedCardId,
  presentMode,
  spacePressed,
  draft,
  dict,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onDoubleClick,
  onCardPointerDown,
  onCardDoubleClick,
  onResizePointerDown,
  onUpdateCardText,
  onFinishEdit,
  onOpenLightbox,
  onTriggerReplaceImage,
  onTriggerAddImage,
  onDropExternal,
  onDropInboxCard,
}) => {
  const [dragOver, setDragOver] = useState(false);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const boardCards = useMemo(() => cards.filter((c) => !c.inbox), [cards]);

  // Viewport culling with 300px screen buffer (Spec Section 6 & W23)
  const visibleCards = useMemo(() => {
    const padWorld = VIRTUAL_PADDING_SCREEN / Math.max(0.1, view.zoom);
    const topLeft = screenToWorld({ x: 0, y: 0 }, view);
    const botRight = screenToWorld(
      { x: viewportSize.width || 1440, y: viewportSize.height || 900 },
      view
    );
    const viewWorld: Rect = {
      x: topLeft.x - padWorld,
      y: topLeft.y - padWorld,
      w: botRight.x - topLeft.x + padWorld * 2,
      h: botRight.y - topLeft.y + padWorld * 2,
    };

    return boardCards
      .filter((c) => {
        if (selectedSet.has(c.id) || editingCardId === c.id || highlightedCardId === c.id) {
          return true;
        }
        if (draft?.movableIds?.has(c.id) || draft?.resizeCardId === c.id) return true;
        return rectsIntersect(viewWorld, { x: c.x, y: c.y, w: c.w, h: c.h });
      })
      .sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));
  }, [boardCards, draft, editingCardId, highlightedCardId, selectedSet, view, viewportSize]);

  const darkBg = isDarkColor(appearance.background);
  const dotSpacing = Math.max(16, Math.round(27 * view.zoom));
  const dotColor = darkBg ? 'rgba(255, 255, 255, 0.14)' : 'rgba(48, 58, 49, 0.18)';

  const viewportStyle: React.CSSProperties = {
    backgroundColor: appearance.background,
    backgroundImage:
      appearance.dots && !presentMode
        ? `radial-gradient(${dotColor} 1px, transparent 1px)`
        : 'none',
    backgroundSize: `${dotSpacing}px ${dotSpacing}px`,
    backgroundPosition: `${view.x % dotSpacing}px ${view.y % dotSpacing}px`,
    cursor:
      draft?.mode === 'pan'
        ? 'grabbing'
        : spacePressed || presentMode
          ? 'grab'
          : 'default',
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (presentMode) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dragOver) setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (presentMode) return;
    e.preventDefault();
    setDragOver(false);
    const rect = boardRef.current?.getBoundingClientRect();
    const screenPt = rect
      ? { x: e.clientX - rect.left, y: e.clientY - rect.top }
      : { x: e.clientX, y: e.clientY };
    const worldPt = screenToWorld(screenPt, view);

    const inboxCardId = e.dataTransfer.getData('application/x-0y03-inbox-card');
    if (inboxCardId) {
      onDropInboxCard(inboxCardId, worldPt);
      return;
    }

    onDropExternal(e.dataTransfer, worldPt);
  };

  return (
    <div
      ref={boardRef}
      tabIndex={-1}
      className={`board-viewport ${dragOver ? 'is-drag-over' : ''}`}
      style={viewportStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={onDoubleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* World coordinate layer */}
      <div
        className="board-world"
        style={{
          transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.zoom})`,
        }}
      >
        {visibleCards.map((card) => {
          let displayX = card.x;
          let displayY = card.y;
          let displayW = card.w;
          let displayH = card.h;

          if (draft?.mode === 'move' && draft.deltaWorld && draft.movableIds?.has(card.id)) {
            displayX += draft.deltaWorld.x;
            displayY += draft.deltaWorld.y;
          } else if (draft?.mode === 'resize' && draft.resizeCardId === card.id && draft.nextRect) {
            displayW = draft.nextRect.w;
            displayH = draft.nextRect.h;
          }

          return (
            <CardView
              key={card.id}
              card={card}
              displayX={displayX}
              displayY={displayY}
              displayW={displayW}
              displayH={displayH}
              selected={selectedSet.has(card.id)}
              singleSelected={selectedIds.length === 1 && selectedSet.has(card.id)}
              isEditing={editingCardId === card.id}
              isHighlighted={highlightedCardId === card.id}
              presentMode={presentMode}
              dict={dict}
              onPointerDown={onCardPointerDown}
              onDoubleClick={onCardDoubleClick}
              onResizePointerDown={onResizePointerDown}
              onUpdateCardText={onUpdateCardText}
              onFinishEdit={onFinishEdit}
              onOpenLightbox={onOpenLightbox}
              onTriggerReplaceImage={onTriggerReplaceImage}
            />
          );
        })}

        {/* Lasso selection box in world space */}
        {draft?.mode === 'lasso' && draft.moved && draft.lassoWorld && (
          <div
            className="board-lasso"
            style={{
              transform: `translate3d(${draft.lassoWorld.x}px, ${draft.lassoWorld.y}px, 0)`,
              width: draft.lassoWorld.w,
              height: draft.lassoWorld.h,
            }}
          />
        )}
      </div>

      {/* Empty board state */}
      {boardCards.length === 0 && !presentMode && (
        <section className="board-empty-state" aria-labelledby="empty-board-title" onPointerDown={(e) => e.stopPropagation()}>
          <div className="board-empty-art" aria-hidden="true">
            <span><ImagePlus size={28} strokeWidth={1.5} /></span>
          </div>
          <h1 id="empty-board-title">{dict.emptyBoardTitle}</h1>
          <p className="board-empty-text">{dict.emptyBoardGuide}</p>
          <button type="button" className="btn btn-primary" onClick={onTriggerAddImage}>
            <ImagePlus size={17} />
            <span>{dict.addMedia}</span>
          </button>
        </section>
      )}

      {/* Drop target visual feedback */}
      {dragOver && (
        <div className="board-drop-overlay" aria-hidden="true">
          <div className="board-drop-pill">{dict.boardDropHint}</div>
        </div>
      )}
    </div>
  );
};
