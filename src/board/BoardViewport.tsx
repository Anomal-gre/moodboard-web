import React, { useMemo, useState } from 'react';
import { ImagePlus, Move, MoveUpRight } from 'lucide-react';
import type { Card, ProjectAppearance, ProjectView } from '../domain/types';
import type { CropRect } from '../domain/cropGeometry';
import {
  computeConnectorCurve,
  computeConnectorToPoint,
  rectsIntersect,
  screenToWorld,
  type Point,
  type Rect,
} from '../domain/geometry';
import { isDarkColor } from '../domain/validate';
import type { I18nDict } from '../i18n';
import { CardView } from './CardView';
import type { DragDraft } from './useBoardInteractions';

export interface ActiveCropSession {
  cardId: string;
  fullFrame: Rect;
  draftCrop: CropRect;
}

interface BoardViewportProps {
  boardRef: React.RefObject<HTMLDivElement | null>;
  viewportSize: { width: number; height: number };
  cards: Card[];
  appearance: ProjectAppearance;
  view: ProjectView;
  selectedIds: string[];
  editingCardId: string | null;
  cropSession: ActiveCropSession | null;
  highlightedCardId: string | null;
  dimmedCardIds: Set<string> | null;
  connectMode: boolean;
  connectSourceId: string | null;
  connectCursorWorld: Point | null;
  presentMode: boolean;
  isArranging: boolean;
  spacePressed: boolean;
  draft: DragDraft | null;
  dict: I18nDict;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: () => void;
  onDoubleClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  onBoardContextMenu: (e: React.MouseEvent<HTMLDivElement>, worldPoint: Point) => void;
  onCardPointerDown: (e: React.PointerEvent, card: Card) => void;
  onCardDoubleClick: (e: React.MouseEvent, card: Card) => void;
  onCardContextMenu: (e: React.MouseEvent, card: Card) => void;
  onResizePointerDown: (e: React.PointerEvent, card: Card) => void;
  onUpdateCardText: (cardId: string, text: string) => void;
  onChangeCrop: (crop: CropRect) => void;
  onFinishCrop: () => void;
  onCancelCrop: () => void;
  onFinishEdit: () => void;
  onRemoveConnector: (srcId: string, dstId: string) => void;
  onOpenLightbox: (card: Card) => void;
  onOpenFileCard: (card: Card) => void;
  onTriggerReplaceImage: (card: Card) => void;
  onTriggerAddImage: () => void;
  onDropExternal: (dt: DataTransfer, worldPoint: Point) => void;
  onDropInboxCard: (cardId: string, worldPoint: Point) => void;
}

const VIRTUAL_PADDING_SCREEN = 320;

export const BoardViewport: React.FC<BoardViewportProps> = ({
  boardRef,
  viewportSize,
  cards,
  appearance,
  view,
  selectedIds,
  editingCardId,
  cropSession,
  highlightedCardId,
  dimmedCardIds,
  connectMode,
  connectSourceId,
  connectCursorWorld,
  presentMode,
  isArranging,
  spacePressed,
  draft,
  dict,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onDoubleClick,
  onBoardContextMenu,
  onCardPointerDown,
  onCardDoubleClick,
  onCardContextMenu,
  onResizePointerDown,
  onUpdateCardText,
  onChangeCrop,
  onFinishCrop,
  onCancelCrop,
  onFinishEdit,
  onRemoveConnector,
  onOpenLightbox,
  onOpenFileCard,
  onTriggerReplaceImage,
  onTriggerAddImage,
  onDropExternal,
  onDropInboxCard,
}) => {
  const [dragOver, setDragOver] = useState(false);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const boardCards = useMemo(() => cards.filter((c) => !c.inbox), [cards]);

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
  const dotSpacing = Math.max(16, Math.round(26 * view.zoom));
  const dotColor = darkBg ? 'rgba(255, 255, 255, 0.13)' : 'rgba(60, 60, 67, 0.16)';

  const isStickyMoving = draft?.mode === 'sticky-move';

  const viewportStyle: React.CSSProperties = {
    backgroundColor: appearance.background,
    backgroundImage:
      appearance.dots && !presentMode
        ? `radial-gradient(${dotColor} 1px, transparent 1px)`
        : 'none',
    backgroundSize: `${dotSpacing}px ${dotSpacing}px`,
    backgroundPosition: `${view.x % dotSpacing}px ${view.y % dotSpacing}px`,
    cursor: connectMode
      ? 'crosshair'
      : isStickyMoving
        ? 'move'
        : draft?.mode === 'pan'
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
      className={`board-viewport ${dragOver ? 'is-drag-over' : ''} ${isStickyMoving ? 'is-sticky-moving' : ''} ${connectMode ? 'is-connect-mode' : ''} ${appearance.grayscale ? 'is-grayscale' : ''}`}
      style={viewportStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => {
        e.preventDefault();
        if (presentMode || isStickyMoving) return;
        const rect = boardRef.current?.getBoundingClientRect();
        const screenPt = rect
          ? { x: e.clientX - rect.left, y: e.clientY - rect.top }
          : { x: e.clientX, y: e.clientY };
        const worldPt = screenToWorld(screenPt, view);
        onBoardContextMenu(e, worldPt);
      }}
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

          const isCardMoving =
            Boolean(
              (draft?.mode === 'move' || draft?.mode === 'sticky-move') &&
                draft.moved &&
                draft.movableIds?.has(card.id)
            );

          const isCardCropping = cropSession?.cardId === card.id;
          if (isCardCropping && cropSession) {
            displayX = cropSession.fullFrame.x;
            displayY = cropSession.fullFrame.y;
            displayW = cropSession.fullFrame.w;
            displayH = cropSession.fullFrame.h;
          } else if (
            (draft?.mode === 'move' || draft?.mode === 'sticky-move') &&
            draft.deltaWorld &&
            draft.movableIds?.has(card.id)
          ) {
            displayX += draft.deltaWorld.x;
            displayY += draft.deltaWorld.y;
          } else if (
            draft?.mode === 'resize' &&
            draft.resizeCardId === card.id &&
            draft.nextRect
          ) {
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
              zoom={view.zoom}
              selected={selectedSet.has(card.id) || connectSourceId === card.id}
              singleSelected={!connectMode && selectedIds.length === 1 && selectedSet.has(card.id)}
              isEditing={editingCardId === card.id}
              isCropping={isCardCropping}
              draftCrop={isCardCropping ? cropSession?.draftCrop ?? null : null}
              isHighlighted={highlightedCardId === card.id}
              isDimmed={Boolean(dimmedCardIds?.has(card.id))}
              isMoving={isCardMoving}
              isArranging={isArranging}
              presentMode={presentMode}
              dict={dict}
              onPointerDown={onCardPointerDown}
              onDoubleClick={onCardDoubleClick}
              onContextMenu={onCardContextMenu}
              onResizePointerDown={onResizePointerDown}
              onUpdateCardText={onUpdateCardText}
              onChangeCrop={onChangeCrop}
              onFinishCrop={onFinishCrop}
              onCancelCrop={onCancelCrop}
              onFinishEdit={onFinishEdit}
              onOpenLightbox={onOpenLightbox}
              onOpenFileCard={onOpenFileCard}
              onTriggerReplaceImage={onTriggerReplaceImage}
            />
          );
        })}

        {/* Milanote / FigJam Style Edge-to-Edge Curved Arrows Layer */}
        {(boardCards.some((c) => c.linksTo && c.linksTo.length > 0) ||
          (connectMode && connectSourceId && connectCursorWorld)) && (
          <svg className="board-connectors-svg" aria-hidden="true">
            <defs>
              <marker
                id="oy03-arrowhead"
                markerWidth="10"
                markerHeight="10"
                refX="8.5"
                refY="5"
                orient="auto"
                markerUnits="userSpaceOnUse"
              >
                <path d="M 1 1.4 L 9 5 L 1 8.6 L 2.8 5 Z" fill="var(--accent)" />
              </marker>
              <marker
                id="oy03-arrowhead-danger"
                markerWidth="10"
                markerHeight="10"
                refX="8.5"
                refY="5"
                orient="auto"
                markerUnits="userSpaceOnUse"
              >
                <path d="M 1 1.4 L 9 5 L 1 8.6 L 2.8 5 Z" fill="#ef4444" />
              </marker>
            </defs>

            {boardCards.map((src) => {
              if (!src.linksTo || src.linksTo.length === 0) return null;
              const srcRect: Rect = { x: src.x, y: src.y, w: src.w, h: src.h };
              if (
                (draft?.mode === 'move' || draft?.mode === 'sticky-move') &&
                draft.deltaWorld &&
                draft.movableIds?.has(src.id)
              ) {
                srcRect.x += draft.deltaWorld.x;
                srcRect.y += draft.deltaWorld.y;
              }
              return src.linksTo.map((targetId) => {
                const dst = boardCards.find((c) => c.id === targetId);
                if (!dst) return null;
                const dstRect: Rect = { x: dst.x, y: dst.y, w: dst.w, h: dst.h };
                if (
                  (draft?.mode === 'move' || draft?.mode === 'sticky-move') &&
                  draft.deltaWorld &&
                  draft.movableIds?.has(dst.id)
                ) {
                  dstRect.x += draft.deltaWorld.x;
                  dstRect.y += draft.deltaWorld.y;
                }
                const curve = computeConnectorCurve(srcRect, dstRect);
                return (
                  <g
                    key={`${src.id}->${dst.id}`}
                    className="board-connector-group"
                    onPointerDown={(e) => {
                      if (presentMode) return;
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      if (presentMode) return;
                      e.stopPropagation();
                      onRemoveConnector(src.id, dst.id);
                    }}
                  >
                    <title>{dict.connectorClickDeleteHint}</title>
                    <path d={curve.svgPath} className="board-connector-hit" />
                    <path
                      d={curve.svgPath}
                      className="board-connector-path"
                      markerEnd="url(#oy03-arrowhead)"
                    />
                    <circle cx={curve.sx} cy={curve.sy} r={3.5} className="board-connector-dot" />
                  </g>
                );
              });
            })}

            {/* Live interactive preview arrow from source card to mouse cursor */}
            {connectMode &&
              connectSourceId &&
              connectCursorWorld &&
              (() => {
                const src = boardCards.find((c) => c.id === connectSourceId);
                if (!src) return null;
                const previewCurve = computeConnectorToPoint(
                  { x: src.x, y: src.y, w: src.w, h: src.h },
                  connectCursorWorld
                );
                return (
                  <g className="board-connector-preview">
                    <path
                      d={previewCurve.svgPath}
                      className="board-connector-path board-connector-path--live"
                      markerEnd="url(#oy03-arrowhead)"
                    />
                    <circle
                      cx={previewCurve.sx}
                      cy={previewCurve.sy}
                      r={3.5}
                      className="board-connector-dot"
                    />
                  </g>
                );
              })()}
          </svg>
        )}

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

      {/* Sticky Move or Interactive Connector Mode HUD Banner */}
      {connectMode && !presentMode && (
        <div className="sticky-move-hud" role="status">
          <MoveUpRight size={14} />
          <span>{connectSourceId ? dict.connectModePickTargetHud : dict.connectModeStartHud}</span>
        </div>
      )}
      {!connectMode && isStickyMoving && !presentMode && (
        <div className="sticky-move-hud" role="status">
          <Move size={14} />
          <span>{dict.stickyMoveHud}</span>
        </div>
      )}

      {/* Empty board state */}
      {boardCards.length === 0 && !presentMode && (
        <section
          className="board-empty-state"
          aria-labelledby="empty-board-title"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="board-empty-art" aria-hidden="true">
            <span>
              <ImagePlus size={28} strokeWidth={1.5} />
            </span>
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
