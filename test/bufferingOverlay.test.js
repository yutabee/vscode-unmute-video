'use strict';

// Pure buffering-spinner state machine (src/webview/bufferingOverlay.ts ->
// out/webview/bufferingOverlay.js). No DOM dependency: a fake clock is injected
// via the OverlayTimers seam, so the debounce/cancel contract is checked in Node.
//
// This is the regression guard for the "frozen spinner" class of bug: hide()
// MUST cancel a pending show(). playerController wires hide() into pause/ended so
// a user stop can't leave the spinner running over a stopped frame.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { BufferingOverlay } = require('../out/webview/bufferingOverlay.js');

// Minimal deterministic clock matching the OverlayTimers interface.
function makeClock() {
  let nextId = 1;
  const pending = new Map();
  return {
    timers: {
      setTimeout(handler, ms) {
        const id = nextId++;
        pending.set(id, { handler, at: ms });
        return id;
      },
      clearTimeout(id) {
        pending.delete(id);
      },
    },
    // Fire every timer whose delay is <= ms (one-shot, like window timers).
    advance(ms) {
      for (const [id, t] of [...pending.entries()]) {
        if (t.at <= ms) {
          pending.delete(id);
          t.handler();
        }
      }
    },
    pendingCount() {
      return pending.size;
    },
  };
}

function makeOverlay(delayMs = 250) {
  const clock = makeClock();
  const events = [];
  const overlay = new BufferingOverlay(
    () => events.push('show'),
    () => events.push('hide'),
    clock.timers,
    delayMs,
  );
  return { overlay, clock, events };
}

test('show() reveals the spinner only after the debounce elapses', () => {
  const { overlay, clock, events } = makeOverlay(250);
  overlay.show();
  assert.deepEqual(events, [], 'nothing before the delay');
  clock.advance(249);
  assert.deepEqual(events, [], 'still nothing just before the delay');
  clock.advance(250);
  assert.deepEqual(events, ['show'], 'shown once the delay passes');
});

test('show() twice does not restart the timer (single pending reveal)', () => {
  const { overlay, clock, events } = makeOverlay(250);
  overlay.show();
  overlay.show();
  assert.equal(clock.pendingCount(), 1, 'second show() is a no-op while pending');
  clock.advance(250);
  assert.deepEqual(events, ['show'], 'revealed exactly once');
});

test('hide() before the debounce cancels the pending reveal (the F1 guard)', () => {
  const { overlay, clock, events } = makeOverlay(250);
  overlay.show();
  overlay.hide();
  assert.equal(clock.pendingCount(), 0, 'pending timer is cleared');
  clock.advance(1000);
  assert.deepEqual(events, ['hide'], 'reveal never fires after a cancel');
});

test('hide() after the spinner is shown hides it', () => {
  const { overlay, clock, events } = makeOverlay(250);
  overlay.show();
  clock.advance(250);
  overlay.hide();
  assert.deepEqual(events, ['show', 'hide']);
});

test('hide() with nothing pending or shown is a safe no-throw', () => {
  const { overlay, events } = makeOverlay(250);
  assert.doesNotThrow(() => overlay.hide());
  assert.deepEqual(events, ['hide'], 'hide() still drives onHide idempotently');
});

test('a fresh show() after hide() schedules a new reveal', () => {
  const { overlay, clock, events } = makeOverlay(250);
  overlay.show();
  overlay.hide();
  clock.advance(250);
  overlay.show();
  clock.advance(250);
  assert.deepEqual(events, ['hide', 'show'], 'cancel then re-show works');
});
