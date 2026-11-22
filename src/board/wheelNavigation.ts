import type { NavigationMode } from '../domain/types';

export interface WheelInput {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  timestamp: number;
}

export interface WheelGestureState {
  lastKind: 'trackpad' | 'mouse' | null;
  lastTimestamp: number;
  pinchCooldownUntil: number;
}

export type WheelAction =
  | { type: 'none' }
  | { type: 'pan'; dx: number; dy: number }
  | { type: 'zoom'; zoomFactor: number };

const STICKY_GESTURE_MS = 320;
const PINCH_COOLDOWN_MS = 160;

export function createWheelGestureState(): WheelGestureState {
  return {
    lastKind: null,
    lastTimestamp: 0,
    pinchCooldownUntil: 0,
  };
}

function normalizeWheelDelta(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * 16; // DOM_DELTA_LINE
  if (deltaMode === 2) return delta * 400; // DOM_DELTA_PAGE
  return delta;
}

/**
 * Distinguishes discrete stepped mouse-wheel notches (typically exact multiples of 100/120
 * on Windows or line-mode ticks with zero horizontal delta) from smooth precision
 * trackpad / touchpad 2-finger pan gestures (which carry deltaX, fractional values,
 * or small pixel deltas).
 */
export function isLikelyDiscreteMouseWheel(input: WheelInput): boolean {
  if (input.deltaMode !== 0) return true;
  if (input.deltaX !== 0) return false;
  const absY = Math.abs(input.deltaY);
  if (absY < 48) return false;
  if (!Number.isInteger(input.deltaY)) return false;
  return (
    absY % 100 === 0 ||
    absY % 120 === 0 ||
    absY === 50 ||
    absY === 53 ||
    absY === 150
  );
}

/**
 * Classifies a wheel event into 2D pan or cursor-anchored zoom while updating
 * sticky gesture state so trackpad momentum never flips into zoom mid-glide.
 */
export function classifyWheelEvent(
  input: WheelInput,
  mode: NavigationMode,
  state: WheelGestureState
): WheelAction {
  const dx = normalizeWheelDelta(input.deltaX, input.deltaMode);
  const dy = normalizeWheelDelta(input.deltaY, input.deltaMode);

  if (dx === 0 && dy === 0) return { type: 'none' };

  // 1. Pinch-to-zoom (synthesized as ctrlKey on Chrome/Edge/Vivaldi/Firefox) or Ctrl/Cmd + Wheel
  if (input.ctrlKey || input.metaKey) {
    state.pinchCooldownUntil = input.timestamp + PINCH_COOLDOWN_MS;
    state.lastKind = 'trackpad';
    state.lastTimestamp = input.timestamp;

    if (dy === 0) return { type: 'none' };
    // Precision trackpad pinch sends small pixel deltas (~1..35); discrete Ctrl+wheel sends ~100..120
    const isTrackpadPinch = input.deltaMode === 0 && Math.abs(input.deltaY) < 42;
    const intensity = isTrackpadPinch ? 0.0085 : 0.0025;
    const zoomFactor = Math.min(1.28, Math.max(0.78, Math.exp(-dy * intensity)));
    return { type: 'zoom', zoomFactor };
  }

  // Briefly ignore stray non-ctrl frames right as fingers lift off a pinch gesture
  if (input.timestamp < state.pinchCooldownUntil) {
    return { type: 'none' };
  }

  // 2. Shift + Wheel always pans horizontally (universal mouse & trackpad expectation)
  if (input.shiftKey) {
    const panX = dx !== 0 ? dx : dy;
    return { type: 'pan', dx: panX, dy: 0 };
  }

  // 3. Explicit Trackpad mode: 2-finger scroll ALWAYS pans in 2D
  if (mode === 'trackpad') {
    state.lastKind = 'trackpad';
    state.lastTimestamp = input.timestamp;
    return { type: 'pan', dx, dy };
  }

  // 4. Explicit Mouse mode: vertical wheel zooms directly (PureRef / CAD style)
  if (mode === 'mouse') {
    state.lastKind = 'mouse';
    state.lastTimestamp = input.timestamp;
    if (dy === 0) {
      return dx !== 0 ? { type: 'pan', dx, dy: 0 } : { type: 'none' };
    }
    const zoomFactor = Math.min(1.22, Math.max(0.82, Math.exp(-dy * 0.0012)));
    return { type: 'zoom', zoomFactor };
  }

  // 5. Auto mode: sticky gesture classification (Figma / Miro / Apple Freeform feel)
  const withinStickyWindow =
    state.lastKind !== null && input.timestamp - state.lastTimestamp <= STICKY_GESTURE_MS;

  let kind: 'trackpad' | 'mouse';
  if (input.deltaX !== 0) {
    // Horizontal movement immediately signals trackpad 2D panning
    kind = 'trackpad';
  } else if (withinStickyWindow && state.lastKind) {
    kind = state.lastKind;
  } else {
    kind = isLikelyDiscreteMouseWheel(input) ? 'mouse' : 'trackpad';
  }

  state.lastKind = kind;
  state.lastTimestamp = input.timestamp;

  if (kind === 'trackpad') {
    return { type: 'pan', dx, dy };
  }

  if (dy === 0) return { type: 'none' };
  const zoomFactor = Math.min(1.22, Math.max(0.82, Math.exp(-dy * 0.0012)));
  return { type: 'zoom', zoomFactor };
}
