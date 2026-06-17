/**
 * Pure, DOM-free A-B / whole-clip loop helper for the webview player.
 */

export interface LoopState {
  a: number | null;
  b: number | null;
  whole: boolean;
  duration: number;
}

export function nextLoopTarget(current: number, state: LoopState): number | null {
  if (state.a !== null && state.b !== null && state.b > state.a) {
    if (current >= state.b) {
      return state.a;
    }
    return null;
  }

  if (state.whole && Number.isFinite(state.duration) && state.duration > 0) {
    if (current >= state.duration) {
      return 0;
    }
  }

  return null;
}
