import { useCallback, useEffect, useRef, type RefObject } from 'react';

interface UseSmoothScrollOptions {
  containerRef: RefObject<HTMLElement | null>;
  disabled?: boolean;
  onScroll?: (scrollTop: number, maxScroll: number, velocity: number) => void;
}

// Exact Lenis v1.1.18 exponential ease-out curve used on anomal.ohwow.win
const easeOutExpo = (t: number): number =>
  t >= 1 ? 1 : Math.min(1, 1.001 - Math.pow(2, -10 * t));

const SCROLL_DURATION_MS = 1150;
// Frame-rate independent exponential damping calibrated to match Lenis duration: 1.15s
const WHEEL_DAMPING = 7.4;

function normalizeWheelDelta(e: WheelEvent, containerHeight: number): number {
  if (e.deltaMode === 1) return e.deltaY * 32; // DOM_DELTA_LINE
  if (e.deltaMode === 2) return e.deltaY * containerHeight; // DOM_DELTA_PAGE
  return e.deltaY;
}

export function useSmoothScroll({
  containerRef,
  disabled = false,
  onScroll,
}: UseSmoothScrollOptions) {
  const onScrollRef = useRef(onScroll);
  onScrollRef.current = onScroll;

  const stateRef = useRef({
    current: 0,
    target: 0,
    velocity: 0,
    rafId: 0,
    lastTime: 0,
    isDriving: false,
    // Programmatic smooth scrollTo animation (exact Lenis 1.15s expo curve)
    animActive: false,
    animStart: 0,
    animFrom: 0,
    animTo: 0,
    animDuration: SCROLL_DURATION_MS,
  });

  const reducedMotionRef = useRef(false);

  const emitScroll = useCallback((el: HTMLElement, scrollTop: number, velocity: number) => {
    const maxScroll = Math.max(1, el.scrollHeight - el.clientHeight);
    onScrollRef.current?.(scrollTop, maxScroll, velocity);
  }, []);

  const stopRaf = useCallback(() => {
    const st = stateRef.current;
    if (st.rafId) {
      window.cancelAnimationFrame(st.rafId);
      st.rafId = 0;
    }
    st.isDriving = false;
    st.animActive = false;
    st.velocity = 0;
  }, []);

  const startRaf = useCallback(() => {
    const st = stateRef.current;
    if (st.rafId) return;
    st.lastTime = performance.now();

    const tick = (now: number) => {
      const el = containerRef.current;
      if (!el) {
        st.rafId = 0;
        st.isDriving = false;
        return;
      }

      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      const dt = Math.max(0.001, Math.min(0.05, (now - st.lastTime) / 1000));
      st.lastTime = now;

      const prev = st.current;
      let keepRunning = false;

      if (st.animActive) {
        const progress = Math.min(1, (now - st.animStart) / st.animDuration);
        const eased = easeOutExpo(progress);
        st.current = st.animFrom + (st.animTo - st.animFrom) * eased;
        st.target = st.animTo;
        keepRunning = progress < 1;
        if (!keepRunning) {
          st.current = Math.max(0, Math.min(maxScroll, st.animTo));
          st.animActive = false;
        }
      } else {
        st.target = Math.max(0, Math.min(maxScroll, st.target));
        const diff = st.target - st.current;
        if (Math.abs(diff) < 0.35) {
          st.current = st.target;
          keepRunning = false;
        } else {
          // Frame-rate independent exponential smoothing (60Hz / 120Hz / 144Hz identical feel)
          const factor = 1 - Math.exp(-WHEEL_DAMPING * dt);
          st.current += diff * factor;
          keepRunning = true;
        }
      }

      st.velocity = (st.current - prev) / dt;
      st.isDriving = true;
      el.scrollTop = st.current;
      emitScroll(el, st.current, st.velocity);

      if (keepRunning) {
        st.rafId = window.requestAnimationFrame(tick);
      } else {
        st.rafId = 0;
        st.isDriving = false;
        st.velocity = 0;
        el.classList.remove('is-smooth-scrolling');
        emitScroll(el, st.current, 0);
      }
    };

    st.rafId = window.requestAnimationFrame(tick);
  }, [containerRef, emitScroll]);

  const scrollTo = useCallback(
    (targetY: number, options?: { immediate?: boolean; duration?: number }) => {
      const el = containerRef.current;
      if (!el) return;
      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      const clamped = Math.max(0, Math.min(maxScroll, targetY));
      const st = stateRef.current;

      if (options?.immediate || reducedMotionRef.current) {
        stopRaf();
        st.current = clamped;
        st.target = clamped;
        el.scrollTop = clamped;
        el.classList.remove('is-smooth-scrolling');
        emitScroll(el, clamped, 0);
        return;
      }

      st.current = el.scrollTop;
      st.animActive = true;
      st.animStart = performance.now();
      st.animFrom = st.current;
      st.animTo = clamped;
      st.animDuration = options?.duration ?? SCROLL_DURATION_MS;
      st.target = clamped;
      el.classList.add('is-smooth-scrolling');
      startRaf();
    },
    [containerRef, emitScroll, startRaf, stopRaf]
  );

  const scrollToElement = useCallback(
    (selector: string, offsetPx = 0) => {
      const el = containerRef.current;
      if (!el) return;
      const targetEl = el.querySelector<HTMLElement>(selector);
      if (!targetEl) return;
      const containerRect = el.getBoundingClientRect();
      const targetRect = targetEl.getBoundingClientRect();
      const targetY = el.scrollTop + (targetRect.top - containerRect.top) - offsetPx;
      scrollTo(targetY);
    },
    [containerRef, scrollTo]
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const mq =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    const syncReducedMotion = () => {
      reducedMotionRef.current = Boolean(mq?.matches);
      if (reducedMotionRef.current) stopRaf();
    };
    syncReducedMotion();
    mq?.addEventListener?.('change', syncReducedMotion);

    const st = stateRef.current;
    st.current = el.scrollTop;
    st.target = el.scrollTop;
    emitScroll(el, el.scrollTop, 0);

    if (disabled) {
      stopRaf();
      return () => {
        mq?.removeEventListener?.('change', syncReducedMotion);
      };
    }

    const onWheel = (e: WheelEvent) => {
      if (reducedMotionRef.current || e.ctrlKey || e.metaKey) return;

      // Allow horizontal scroll gestures (e.g. comparison table on narrow screens) to pass natively
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;

      // Respect opted-out inner scroll areas
      const targetNode = e.target as HTMLElement | null;
      if (targetNode?.closest('[data-smooth-prevent]')) return;

      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      if (maxScroll <= 0) return;

      e.preventDefault();

      // If no wheel glide is active yet, seed from real scrollTop (handles keyboard/touch jumps cleanly)
      if (!st.rafId) {
        st.current = el.scrollTop;
        st.target = el.scrollTop;
      }

      // Cancel any in-progress programmatic anchor jump immediately on user wheel input
      if (st.animActive) {
        st.animActive = false;
        st.target = st.current;
      }

      const delta = normalizeWheelDelta(e, el.clientHeight);
      st.target = Math.max(0, Math.min(maxScroll, st.target + delta));
      el.classList.add('is-smooth-scrolling');
      startRaf();
    };

    const onNativeScroll = () => {
      if (st.isDriving) return;
      st.current = el.scrollTop;
      st.target = el.scrollTop;
      emitScroll(el, el.scrollTop, 0);
    };

    const onTouchStart = () => {
      if (st.rafId) {
        stopRaf();
        el.classList.remove('is-smooth-scrolling');
      }
      st.current = el.scrollTop;
      st.target = el.scrollTop;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (
        st.rafId &&
        ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(e.key)
      ) {
        stopRaf();
        el.classList.remove('is-smooth-scrolling');
        st.current = el.scrollTop;
        st.target = el.scrollTop;
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('scroll', onNativeScroll, { passive: true });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('keydown', onKeyDown, { passive: true });

    return () => {
      stopRaf();
      el.classList.remove('is-smooth-scrolling');
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('scroll', onNativeScroll);
      el.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('keydown', onKeyDown);
      mq?.removeEventListener?.('change', syncReducedMotion);
    };
  }, [containerRef, disabled, emitScroll, startRaf, stopRaf]);

  return { scrollTo, scrollToElement };
}
