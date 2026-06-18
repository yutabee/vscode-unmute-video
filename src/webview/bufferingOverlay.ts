// The stage buffering spinner, isolated from the DOM so its debounce/cancel
// semantics are unit-testable with a fake clock.
//
// Contract: show() reveals the spinner only after a short debounce so brief
// stalls don't flash it; hide() cancels any pending reveal AND hides immediately.
// The class that owns playback wires onShow/onHide to the actual CSS class
// toggle and passes the real timers; tests pass a fake clock.

export interface OverlayTimers {
  setTimeout(handler: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

export class BufferingOverlay {
  private timer: number | undefined;

  // timers is injected (not taken from a DOM global) so this module stays pure
  // and compiles/tests in Node without a DOM lib; the caller passes window.
  public constructor(
    private readonly onShow: () => void,
    private readonly onHide: () => void,
    private readonly timers: OverlayTimers,
    private readonly delayMs = 250,
  ) {}

  // Reveal the spinner after the debounce. A second show() while one is pending
  // is a no-op so the timer isn't restarted on every micro-stall.
  public show(): void {
    if (this.timer !== undefined) {
      return;
    }
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined;
      this.onShow();
    }, this.delayMs);
  }

  // Cancel any pending reveal and hide immediately. Safe to call when nothing
  // is pending or showing.
  public hide(): void {
    if (this.timer !== undefined) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.onHide();
  }
}
