import { useCallback, useEffect, useRef, useState } from 'react';
import type { Card, ProjectView } from '../domain/types';
import {
  clampZoom,
  getMovableCardIds,
  recomputeFrameBoundsForAll,
  rectsIntersect,
  screenToWorld,
  zoomAtScreenPoint,
  type Point,
  type Rect,
} from '../domain/geometry';

export interface DragDraft {
  mode: 'move' | 'resize' | 'pan' | 'lasso';
  pointerId: number;
  startScreen: Point;
  startView: ProjectView;
  moved: boolean;
  // Move
  movableIds?: Set<string>;
  initialPositions?: Map<string, { x: number; y: number }>;
  deltaWorld?: Point;
  // Resize
  resizeCardId?: string;
  initialRect?: Rect;
  keepAspect?: boolean;
  nextRect?: Rect;
  // Lasso
  lassoWorld?: Rect;
}

interface UseBoardInteractionsArgs {
  boardRef: React.RefObject<HTMLDivElement | null>;
  cards: Card[];
  view: ProjectView;
  selectedIds: string[];
  presentMode: boolean;
  editingCardId: string | null;
  modalOpen: boolean;
  onViewChange: (view: ProjectView, commit?: boolean) => void;
  onSelectChange: (ids: string[]) => void;
  onCommitCards: (cards: Card[]) => void;
  onStartEditNote: (cardId: string) => void;
  onCreateNoteAt: (worldPoint: Point) => void;
}

const DRAG_THRESHOLD_PX = 4;

export function useBoardInteractions({
  boardRef,
  cards,
  view,
  selectedIds,
  presentMode,
  editingCardId,
  modalOpen,
  onViewChange,
  onSelectChange,
  onCommitCards,
  onStartEditNote,
  onCreateNoteAt,
}: UseBoardInteractionsArgs) {
  const [spacePressed, setSpacePressed] = useState(false);
  const [draft, setDraft] = useState<DragDraft | null>(null);
  const draftRef = useRef<DragDraft | null>(null);
  const rafRef = useRef<number | null>(null);
  const suppressNextClickRef = useRef(false);

  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const viewRef = useRef(view);
  viewRef.current = view;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

  const setDraftSync = useCallback((next: DragDraft | null) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const getBoardRelativePoint = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = boardRef.current?.getBoundingClientRect();
      if (!rect) return { x: clientX, y: clientY };
      return { x: clientX - rect.left, y: clientY - rect.top };
    },
    [boardRef]
  );

  // Cancel active drag cleanly on Esc
  const cancelDraft = useCallback(() => {
    const active = draftRef.current;
    if (!active) return false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (active.mode === 'pan') {
      onViewChange(active.startView, false);
    }
    setDraftSync(null);
    return true;
  }, [onViewChange, setDraftSync]);

  // Track Spacebar for pan mode
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        const isInput =
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          (e.target as HTMLElement | null)?.isContentEditable;
        if (!isInput && !editingCardId && !modalOpen) {
          e.preventDefault();
          setSpacePressed(true);
        }
      }
      if (e.key === 'Escape' && draftRef.current) {
        e.preventDefault();
        cancelDraft();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(false);
      }
    };
    const onBlur = () => {
      setSpacePressed(false);
      cancelDraft();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [cancelDraft, editingCardId, modalOpen]);

  // Wheel pan & Ctrl/Cmd cursor-anchored zoom
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (modalOpen) return;
      e.preventDefault();
      const curView = viewRef.current;
      const screenPt = getBoardRelativePoint(e.clientX, e.clientY);

      if (e.ctrlKey || e.metaKey || presentMode) {
        // Smooth cursor-anchored zoom (presentMode allows scroll wheel zoom directly like Bienac)
        const zoomFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        const nextZoom = clampZoom(curView.zoom * zoomFactor);
        const nextView = zoomAtScreenPoint(curView, screenPt, nextZoom);
        onViewChange(nextView, true);
      } else {
        // Regular wheel scrolls/pans the artboard
        onViewChange(
          {
            ...curView,
            x: curView.x - e.deltaX,
            y: curView.y - e.deltaY,
          },
          true
        );
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [boardRef, getBoardRelativePoint, modalOpen, onViewChange, presentMode]);

  const startPan = useCallback(
    (e: React.PointerEvent) => {
      const startScreen = getBoardRelativePoint(e.clientX, e.clientY);
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      setDraftSync({
        mode: 'pan',
        pointerId: e.pointerId,
        startScreen,
        startView: { ...viewRef.current },
        moved: false,
      });
    },
    [getBoardRelativePoint, setDraftSync]
  );

  const handleBoardPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (modalOpen) return;
      if (e.button === 1 || spacePressed || presentMode) {
        e.preventDefault();
        startPan(e);
        return;
      }
      if (e.button !== 0) return;
      // Clicking empty board starts lasso (or clears selection on click)
      const startScreen = getBoardRelativePoint(e.clientX, e.clientY);
      const startWorld = screenToWorld(startScreen, viewRef.current);
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setDraftSync({
        mode: 'lasso',
        pointerId: e.pointerId,
        startScreen,
        startView: { ...viewRef.current },
        moved: false,
        lassoWorld: { x: startWorld.x, y: startWorld.y, w: 0, h: 0 },
      });
    },
    [getBoardRelativePoint, modalOpen, presentMode, setDraftSync, spacePressed, startPan]
  );

  const handleBoardDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (presentMode || modalOpen) return;
      if (e.target !== e.currentTarget) return;
      const screenPt = getBoardRelativePoint(e.clientX, e.clientY);
      const worldPt = screenToWorld(screenPt, viewRef.current);
      onCreateNoteAt(worldPt);
    },
    [getBoardRelativePoint, modalOpen, onCreateNoteAt, presentMode]
  );

  const handleCardPointerDown = useCallback(
    (e: React.PointerEvent, card: Card) => {
      if (modalOpen) return;
      if (e.button === 1 || spacePressed || presentMode) {
        e.stopPropagation();
        startPan(e);
        return;
      }
      if (editingCardId === card.id) {
        e.stopPropagation();
        return;
      }
      if (e.button !== 0) return;
      e.stopPropagation();

      let nextSelected = selectedIdsRef.current;
      if (e.shiftKey) {
        if (nextSelected.includes(card.id)) {
          nextSelected = nextSelected.filter((id) => id !== card.id);
        } else {
          nextSelected = [...nextSelected, card.id];
        }
        onSelectChange(nextSelected);
      } else if (!nextSelected.includes(card.id)) {
        nextSelected = [card.id];
        onSelectChange(nextSelected);
      }

      const movableIds = getMovableCardIds(cardsRef.current, nextSelected);
      if (movableIds.size === 0) return;

      const initialPositions = new Map<string, { x: number; y: number }>();
      for (const c of cardsRef.current) {
        if (movableIds.has(c.id)) {
          initialPositions.set(c.id, { x: c.x, y: c.y });
        }
      }

      const startScreen = getBoardRelativePoint(e.clientX, e.clientY);
      boardRef.current?.setPointerCapture?.(e.pointerId);
      setDraftSync({
        mode: 'move',
        pointerId: e.pointerId,
        startScreen,
        startView: { ...viewRef.current },
        moved: false,
        movableIds,
        initialPositions,
        deltaWorld: { x: 0, y: 0 },
      });
    },
    [
      boardRef,
      editingCardId,
      getBoardRelativePoint,
      modalOpen,
      onSelectChange,
      presentMode,
      setDraftSync,
      spacePressed,
      startPan,
    ]
  );

  const handleResizePointerDown = useCallback(
    (e: React.PointerEvent, card: Card) => {
      if (presentMode || modalOpen || card.locked) return;
      e.stopPropagation();
      e.preventDefault();
      const startScreen = getBoardRelativePoint(e.clientX, e.clientY);
      boardRef.current?.setPointerCapture?.(e.pointerId);
      setDraftSync({
        mode: 'resize',
        pointerId: e.pointerId,
        startScreen,
        startView: { ...viewRef.current },
        moved: false,
        resizeCardId: card.id,
        initialRect: { x: card.x, y: card.y, w: card.w, h: card.h },
        keepAspect: card.kind === 'image',
        nextRect: { x: card.x, y: card.y, w: card.w, h: card.h },
      });
    },
    [boardRef, getBoardRelativePoint, modalOpen, presentMode, setDraftSync]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const cur = draftRef.current;
      if (!cur || cur.pointerId !== e.pointerId) return;
      const curScreen = getBoardRelativePoint(e.clientX, e.clientY);
      const dxScreen = curScreen.x - cur.startScreen.x;
      const dyScreen = curScreen.y - cur.startScreen.y;
      const moved = cur.moved || Math.hypot(dxScreen, dyScreen) >= DRAG_THRESHOLD_PX;

      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const active = draftRef.current;
        if (!active) return;

        if (active.mode === 'pan') {
          onViewChange(
            {
              ...active.startView,
              x: active.startView.x + dxScreen,
              y: active.startView.y + dyScreen,
            },
            false
          );
          setDraftSync({ ...active, moved });
          return;
        }

        if (active.mode === 'move') {
          const zoom = active.startView.zoom || 1;
          setDraftSync({
            ...active,
            moved,
            deltaWorld: {
              x: Math.round(dxScreen / zoom),
              y: Math.round(dyScreen / zoom),
            },
          });
          return;
        }

        if (active.mode === 'resize' && active.initialRect) {
          const zoom = active.startView.zoom || 1;
          const dw = dxScreen / zoom;
          const dh = dyScreen / zoom;
          const minW = 110;
          const minH = 72;
          let nextW = Math.max(minW, Math.round(active.initialRect.w + dw));
          let nextH = Math.max(minH, Math.round(active.initialRect.h + dh));
          if (active.keepAspect && active.initialRect.w > 0 && active.initialRect.h > 0) {
            const ratio = active.initialRect.h / active.initialRect.w;
            nextH = Math.max(minH, Math.round(nextW * ratio));
          }
          setDraftSync({
            ...active,
            moved,
            nextRect: {
              x: active.initialRect.x,
              y: active.initialRect.y,
              w: nextW,
              h: nextH,
            },
          });
          return;
        }

        if (active.mode === 'lasso') {
          const p0 = screenToWorld(active.startScreen, active.startView);
          const p1 = screenToWorld(curScreen, active.startView);
          setDraftSync({
            ...active,
            moved,
            lassoWorld: {
              x: Math.min(p0.x, p1.x),
              y: Math.min(p0.y, p1.y),
              w: Math.abs(p1.x - p0.x),
              h: Math.abs(p1.y - p0.y),
            },
          });
        }
      });
    },
    [getBoardRelativePoint, onViewChange, setDraftSync]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const cur = draftRef.current;
      if (!cur || cur.pointerId !== e.pointerId) return;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      try {
        boardRef.current?.releasePointerCapture?.(e.pointerId);
      } catch {
        // ignore
      }

      if (cur.moved) {
        suppressNextClickRef.current = true;
        setTimeout(() => {
          suppressNextClickRef.current = false;
        }, 60);
      }

      if (cur.mode === 'pan') {
        if (cur.moved) onViewChange(viewRef.current, true);
        setDraftSync(null);
        return;
      }

      if (cur.mode === 'move' && cur.moved && cur.deltaWorld && cur.movableIds) {
        const dx = cur.deltaWorld.x;
        const dy = cur.deltaWorld.y;
        if (dx !== 0 || dy !== 0) {
          const now = new Date().toISOString();
          const movedCards = cardsRef.current.map((c) => {
            if (!cur.movableIds?.has(c.id)) return c;
            return { ...c, x: c.x + dx, y: c.y + dy, updatedAt: now };
          });
          onCommitCards(recomputeFrameBoundsForAll(movedCards));
        }
        setDraftSync(null);
        return;
      }

      if (cur.mode === 'resize' && cur.moved && cur.resizeCardId && cur.nextRect) {
        const { w, h } = cur.nextRect;
        const now = new Date().toISOString();
        const resized = cardsRef.current.map((c) =>
          c.id === cur.resizeCardId ? { ...c, w, h, updatedAt: now } : c
        );
        onCommitCards(recomputeFrameBoundsForAll(resized));
        setDraftSync(null);
        return;
      }

      if (cur.mode === 'lasso') {
        if (cur.moved && cur.lassoWorld) {
          const hits = cardsRef.current
            .filter((c) => !c.inbox && rectsIntersect(cur.lassoWorld!, { x: c.x, y: c.y, w: c.w, h: c.h }))
            .map((c) => c.id);
          onSelectChange(hits);
        } else {
          onSelectChange([]);
        }
        setDraftSync(null);
      }
    },
    [boardRef, onCommitCards, onSelectChange, onViewChange, setDraftSync]
  );

  const handlePointerCancel = useCallback(() => {
    cancelDraft();
  }, [cancelDraft]);

  const handleCardDoubleClick = useCallback(
    (e: React.MouseEvent, card: Card) => {
      if (presentMode || suppressNextClickRef.current) return;
      e.stopPropagation();
      if (card.kind === 'note' && !card.locked) {
        onStartEditNote(card.id);
      }
    },
    [onStartEditNote, presentMode]
  );

  return {
    spacePressed,
    draft,
    cancelDraft,
    handleBoardPointerDown,
    handleBoardDoubleClick,
    handleCardPointerDown,
    handleCardDoubleClick,
    handleResizePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
  };
}
