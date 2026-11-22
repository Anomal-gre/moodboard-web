import { useCallback, useEffect, useRef, useState } from 'react';
import type { Card, NavigationMode, ProjectView } from '../domain/types';
import {
  clampZoom,
  computeCardsBounds,
  computeMoveSnap,
  computeResizeSnap,
  getMovableCardIds,
  recomputeFrameBoundsForAll,
  rectsIntersect,
  screenToWorld,
  worldToScreen,
  zoomAtScreenPoint,
  type Point,
  type Rect,
  type SmartGuideLine,
  type SmartSpacingGuide,
} from '../domain/geometry';
import { classifyWheelEvent, createWheelGestureState } from './wheelNavigation';

export interface DragDraft {
  mode: 'move' | 'sticky-move' | 'resize' | 'pan' | 'lasso';
  pointerId: number;
  startScreen: Point;
  startView: ProjectView;
  moved: boolean;
  // Move / Sticky-move
  movableIds?: Set<string>;
  initialPositions?: Map<string, { x: number; y: number }>;
  initialBounds?: Rect;
  deltaWorld?: Point;
  guides?: SmartGuideLine[];
  spacings?: SmartSpacingGuide[];
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
  navigationMode?: NavigationMode;
  onViewChange: (view: ProjectView, commit?: boolean) => void;
  onSelectChange: (ids: string[]) => void;
  onCommitCards: (cards: Card[]) => void;
  onStartEditNote: (cardId: string) => void;
  onCreateNoteAt: (worldPoint: Point) => void;
  onOpenFileCard: (card: Card) => void;
  onOpenLightbox: (card: Card) => void;
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
  navigationMode = 'auto',
  onViewChange,
  onSelectChange,
  onCommitCards,
  onStartEditNote,
  onCreateNoteAt,
  onOpenFileCard,
  onOpenLightbox,
}: UseBoardInteractionsArgs) {
  const [spacePressed, setSpacePressed] = useState(false);
  const [draft, setDraft] = useState<DragDraft | null>(null);
  const draftRef = useRef<DragDraft | null>(null);
  const rafRef = useRef<number | null>(null);
  const suppressNextClickRef = useRef(false);
  const lastPointerScreenRef = useRef<Point | null>(null);
  const lastCardDownTimeRef = useRef<number>(0);
  const wheelGestureRef = useRef(createWheelGestureState());
  const navigationModeRef = useRef<NavigationMode>(navigationMode);
  navigationModeRef.current = navigationMode;
  const activeTouchesRef = useRef<Map<number, Point>>(new Map());
  const touchPinchRef = useRef<{
    startDist: number;
    startMid: Point;
    startView: ProjectView;
  } | null>(null);

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

  // Cancel active drag or sticky-move cleanly on Esc
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

  // Commit an active sticky-move at its current deltaWorld
  const commitStickyMove = useCallback(() => {
    const cur = draftRef.current;
    if (!cur || cur.mode !== 'sticky-move') return false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (cur.deltaWorld && cur.movableIds) {
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
    }
    suppressNextClickRef.current = true;
    window.setTimeout(() => {
      suppressNextClickRef.current = false;
    }, 80);
    setDraftSync(null);
    return true;
  }, [onCommitCards, setDraftSync]);

  // Start Click-Select -> Sticky Move mode (cards attach to cursor until next click)
  const startStickyMove = useCallback(
    (clientPt?: { clientX: number; clientY: number }) => {
      if (presentMode || modalOpen || editingCardId) return false;
      if (draftRef.current?.mode === 'sticky-move') {
        commitStickyMove();
        return true;
      }
      const movableIds = getMovableCardIds(cardsRef.current, selectedIdsRef.current);
      if (movableIds.size === 0) return false;

      const initialPositions = new Map<string, { x: number; y: number }>();
      const movingCards: Card[] = [];
      for (const c of cardsRef.current) {
        if (movableIds.has(c.id)) {
          initialPositions.set(c.id, { x: c.x, y: c.y });
          movingCards.push(c);
        }
      }

      let startScreen: Point;
      const bounds = computeCardsBounds(movingCards) ?? { x: 0, y: 0, w: 100, h: 100 };
      if (clientPt) {
        startScreen = getBoardRelativePoint(clientPt.clientX, clientPt.clientY);
      } else if (lastPointerScreenRef.current) {
        startScreen = lastPointerScreenRef.current;
      } else {
        const centerWorld = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
        startScreen = worldToScreen(centerWorld, viewRef.current);
      }

      setDraftSync({
        mode: 'sticky-move',
        pointerId: -1,
        startScreen,
        startView: { ...viewRef.current },
        moved: true,
        movableIds,
        initialPositions,
        initialBounds: bounds,
        deltaWorld: { x: 0, y: 0 },
        guides: [],
        spacings: [],
      });
      return true;
    },
    [commitStickyMove, editingCardId, getBoardRelativePoint, modalOpen, presentMode, setDraftSync]
  );

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

  // Native Touchpad (2-finger 2D pan + pinch-to-zoom) & Mouse Wheel (cursor-anchored zoom).
  // Also handles Safari/WebKit gesturestart/gesturechange so macOS trackpad pinch never zooms the page.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (modalOpen) return;
      const el = boardRef.current;
      if (!el) return;
      const target = e.target as Node | null;
      if (!target || !el.contains(target)) return;

      e.preventDefault();
      const curView = viewRef.current;
      const screenPt = getBoardRelativePoint(e.clientX, e.clientY);

      const action = classifyWheelEvent(
        {
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          deltaMode: e.deltaMode,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          shiftKey: e.shiftKey,
          timestamp: e.timeStamp || performance.now(),
        },
        navigationModeRef.current,
        wheelGestureRef.current
      );

      if (action.type === 'pan') {
        onViewChange(
          {
            ...curView,
            x: curView.x - action.dx,
            y: curView.y - action.dy,
          },
          true
        );
        return;
      }

      if (action.type === 'zoom') {
        const nextZoom = clampZoom(curView.zoom * action.zoomFactor);
        const nextView = zoomAtScreenPoint(curView, screenPt, nextZoom);
        onViewChange(nextView, true);
      }
    };

    // Safari / WebKit native trackpad pinch gestures
    let gestureStartView: ProjectView | null = null;
    const onGestureStart = (e: Event) => {
      if (modalOpen) return;
      const el = boardRef.current;
      const target = e.target as Node | null;
      if (!el || !target || !el.contains(target)) return;
      e.preventDefault();
      gestureStartView = { ...viewRef.current };
    };
    const onGestureChange = (e: Event) => {
      if (modalOpen || !gestureStartView) return;
      const ge = e as Event & { scale?: number; clientX?: number; clientY?: number };
      e.preventDefault();
      const scale = typeof ge.scale === 'number' && ge.scale > 0 ? ge.scale : 1;
      const screenPt =
        typeof ge.clientX === 'number' && typeof ge.clientY === 'number'
          ? getBoardRelativePoint(ge.clientX, ge.clientY)
          : lastPointerScreenRef.current ?? {
              x: (boardRef.current?.clientWidth ?? 1200) / 2,
              y: (boardRef.current?.clientHeight ?? 800) / 2,
            };
      const nextZoom = clampZoom(gestureStartView.zoom * scale);
      onViewChange(zoomAtScreenPoint(gestureStartView, screenPt, nextZoom), false);
    };
    const onGestureEnd = (e: Event) => {
      if (!gestureStartView) return;
      e.preventDefault();
      gestureStartView = null;
      onViewChange({ ...viewRef.current }, true);
    };

    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('gesturestart', onGestureStart, { passive: false });
    window.addEventListener('gesturechange', onGestureChange, { passive: false });
    window.addEventListener('gestureend', onGestureEnd, { passive: false });
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('gesturestart', onGestureStart);
      window.removeEventListener('gesturechange', onGestureChange);
      window.removeEventListener('gestureend', onGestureEnd);
    };
  }, [boardRef, getBoardRelativePoint, modalOpen, onViewChange]);

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

      // Return keyboard focus to the board so shortcuts like Del / Ctrl+Z always fire immediately
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== boardRef.current && active !== document.body) {
        active.blur?.();
      }
      boardRef.current?.focus?.({ preventScroll: true });

      // If in sticky-move mode: left click places cards down, right click cancels
      if (draftRef.current?.mode === 'sticky-move') {
        e.preventDefault();
        e.stopPropagation();
        if (e.button === 0) {
          commitStickyMove();
        } else {
          cancelDraft();
        }
        return;
      }

      if (e.pointerType === 'touch') {
        const pt = getBoardRelativePoint(e.clientX, e.clientY);
        activeTouchesRef.current.set(e.pointerId, pt);
        if (activeTouchesRef.current.size === 2) {
          cancelDraft();
          const pts = Array.from(activeTouchesRef.current.values());
          const startDist = Math.max(12, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
          const startMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
          touchPinchRef.current = {
            startDist,
            startMid,
            startView: { ...viewRef.current },
          };
          e.preventDefault();
          return;
        }
      }

      if (e.button === 1 || spacePressed || presentMode) {
        e.preventDefault();
        startPan(e);
        return;
      }
      if (e.button !== 0) return;

      const startScreen = getBoardRelativePoint(e.clientX, e.clientY);
      const startWorld = screenToWorld(startScreen, viewRef.current);
      setDraftSync({
        mode: 'lasso',
        pointerId: e.pointerId,
        startScreen,
        startView: { ...viewRef.current },
        moved: false,
        lassoWorld: { x: startWorld.x, y: startWorld.y, w: 0, h: 0 },
      });
    },
    [
      cancelDraft,
      commitStickyMove,
      getBoardRelativePoint,
      modalOpen,
      presentMode,
      setDraftSync,
      spacePressed,
      startPan,
    ]
  );

  const handleBoardDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (presentMode || modalOpen || suppressNextClickRef.current) return;
      const targetEl = e.target as HTMLElement | null;
      if (targetEl?.closest?.('.board-card')) return;
      if (performance.now() - lastCardDownTimeRef.current < 480) return;
      if (e.target !== e.currentTarget) return;
      const screenPt = getBoardRelativePoint(e.clientX, e.clientY);
      const worldPt = screenToWorld(screenPt, viewRef.current);
      const insideAnyCard = cardsRef.current.some(
        (c) =>
          !c.inbox &&
          c.kind !== 'frame' &&
          worldPt.x >= c.x &&
          worldPt.x <= c.x + c.w &&
          worldPt.y >= c.y &&
          worldPt.y <= c.y + c.h
      );
      if (insideAnyCard) return;
      onCreateNoteAt(worldPt);
    },
    [getBoardRelativePoint, modalOpen, onCreateNoteAt, presentMode]
  );

  const handleCardPointerDown = useCallback(
    (e: React.PointerEvent, card: Card) => {
      if (modalOpen) return;
      lastCardDownTimeRef.current = performance.now();

      // Blur any Inspector/Search input & focus the board so Del / Ctrl+C / M work immediately
      if (editingCardId !== card.id) {
        const active = document.activeElement as HTMLElement | null;
        if (active && active !== boardRef.current && active !== document.body) {
          active.blur?.();
        }
        boardRef.current?.focus?.({ preventScroll: true });
      }

      // If in sticky-move mode: clicking anywhere places the moving card(s) down
      if (draftRef.current?.mode === 'sticky-move') {
        e.preventDefault();
        e.stopPropagation();
        if (e.button === 0) {
          commitStickyMove();
        } else {
          cancelDraft();
        }
        return;
      }

      if (e.pointerType === 'touch') {
        const pt = getBoardRelativePoint(e.clientX, e.clientY);
        activeTouchesRef.current.set(e.pointerId, pt);
        if (activeTouchesRef.current.size === 2) {
          cancelDraft();
          const pts = Array.from(activeTouchesRef.current.values());
          const startDist = Math.max(12, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
          const startMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
          touchPinchRef.current = {
            startDist,
            startMid,
            startView: { ...viewRef.current },
          };
          e.preventDefault();
          return;
        }
      }

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
      const movingCards: Card[] = [];
      for (const c of cardsRef.current) {
        if (movableIds.has(c.id)) {
          initialPositions.set(c.id, { x: c.x, y: c.y });
          movingCards.push(c);
        }
      }
      const initialBounds = computeCardsBounds(movingCards) ?? {
        x: card.x,
        y: card.y,
        w: card.w,
        h: card.h,
      };

      const startScreen = getBoardRelativePoint(e.clientX, e.clientY);
      setDraftSync({
        mode: 'move',
        pointerId: e.pointerId,
        startScreen,
        startView: { ...viewRef.current },
        moved: false,
        movableIds,
        initialPositions,
        initialBounds,
        deltaWorld: { x: 0, y: 0 },
        guides: [],
        spacings: [],
      });
    },
    [
      cancelDraft,
      commitStickyMove,
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
      const curScreen = getBoardRelativePoint(e.clientX, e.clientY);
      lastPointerScreenRef.current = curScreen;

      if (e.pointerType === 'touch' && activeTouchesRef.current.has(e.pointerId)) {
        activeTouchesRef.current.set(e.pointerId, curScreen);
        if (activeTouchesRef.current.size === 2 && touchPinchRef.current) {
          const pts = Array.from(activeTouchesRef.current.values());
          const curDist = Math.max(12, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
          const curMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
          const pinch = touchPinchRef.current;
          const nextZoom = clampZoom(pinch.startView.zoom * (curDist / pinch.startDist));
          const zoomed = zoomAtScreenPoint(pinch.startView, pinch.startMid, nextZoom);
          onViewChange(
            {
              ...zoomed,
              x: zoomed.x + (curMid.x - pinch.startMid.x),
              y: zoomed.y + (curMid.y - pinch.startMid.y),
            },
            false
          );
          return;
        }
      }

      const cur = draftRef.current;
      if (!cur) return;
      if (cur.mode !== 'sticky-move' && cur.pointerId !== e.pointerId) return;

      const dxScreen = curScreen.x - cur.startScreen.x;
      const dyScreen = curScreen.y - cur.startScreen.y;
      const moved =
        cur.mode === 'sticky-move' ||
        cur.moved ||
        Math.hypot(dxScreen, dyScreen) >= DRAG_THRESHOLD_PX;

      if (!cur.moved && moved && cur.pointerId >= 0) {
        try {
          boardRef.current?.setPointerCapture?.(cur.pointerId);
        } catch {
          // ignore
        }
      }

      const altPressed = e.altKey;
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

        if (active.mode === 'move' || active.mode === 'sticky-move') {
          const zoom = viewRef.current.zoom || 1;
          const rawDelta = {
            x: dxScreen / zoom,
            y: dyScreen / zoom,
          };
          if (active.initialBounds && moved) {
            const stationary = cardsRef.current.filter(
              (c) => !c.inbox && !active.movableIds?.has(c.id)
            );
            const snap = computeMoveSnap(
              active.initialBounds,
              rawDelta,
              stationary,
              zoom,
              altPressed
            );
            setDraftSync({
              ...active,
              moved,
              deltaWorld: snap.deltaWorld,
              guides: snap.guides,
              spacings: snap.spacings,
            });
          } else {
            setDraftSync({
              ...active,
              moved,
              deltaWorld: {
                x: Math.round(rawDelta.x),
                y: Math.round(rawDelta.y),
              },
              guides: [],
              spacings: [],
            });
          }
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
          const rawNextRect: Rect = {
            x: active.initialRect.x,
            y: active.initialRect.y,
            w: nextW,
            h: nextH,
          };
          const stationary = cardsRef.current.filter(
            (c) => !c.inbox && c.id !== active.resizeCardId
          );
          const snap = computeResizeSnap(
            active.initialRect,
            rawNextRect,
            Boolean(active.keepAspect),
            stationary,
            zoom,
            altPressed
          );
          setDraftSync({
            ...active,
            moved,
            nextRect: snap.rect,
            guides: moved ? snap.guides : [],
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
      if (e.pointerType === 'touch') {
        activeTouchesRef.current.delete(e.pointerId);
        if (touchPinchRef.current && activeTouchesRef.current.size < 2) {
          touchPinchRef.current = null;
          onViewChange({ ...viewRef.current }, true);
          return;
        }
      }

      const cur = draftRef.current;
      if (!cur) return;
      // Sticky-move commits on pointerDown, not pointerUp
      if (cur.mode === 'sticky-move') return;
      if (cur.pointerId !== e.pointerId) return;

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

      if (cur.mode === 'move') {
        if (cur.moved && cur.deltaWorld && cur.movableIds) {
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
            .filter(
              (c) =>
                !c.inbox &&
                rectsIntersect(cur.lassoWorld!, { x: c.x, y: c.y, w: c.w, h: c.h })
            )
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
    activeTouchesRef.current.clear();
    touchPinchRef.current = null;
    if (draftRef.current?.mode === 'sticky-move') return;
    cancelDraft();
  }, [cancelDraft]);

  const handleCardDoubleClick = useCallback(
    (e: React.MouseEvent, card: Card) => {
      if (presentMode || suppressNextClickRef.current) return;
      e.stopPropagation();
      if (card.kind === 'note' && !card.locked) {
        onStartEditNote(card.id);
        return;
      }
      if (card.kind === 'file') {
        onOpenFileCard(card);
        return;
      }
      if (card.kind === 'image') {
        onOpenLightbox(card);
        return;
      }
      if (card.kind === 'link' && card.source?.pageUrl) {
        window.open(card.source.pageUrl, '_blank', 'noopener,noreferrer');
      }
    },
    [onOpenFileCard, onOpenLightbox, onStartEditNote, presentMode]
  );

  return {
    spacePressed,
    draft,
    cancelDraft,
    startStickyMove,
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
