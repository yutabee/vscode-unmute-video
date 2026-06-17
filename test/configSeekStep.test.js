'use strict';

// Pure config helpers (src/config.ts -> out/config.js). No vscode/DOM
// dependency, so they are exercised directly in Node. This is the
// machine-checkable contract for the configurable seek step (used by J/L and
// the arrow keys) and the fixed frame-step delta.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { resolveSeekStep, FRAME_STEP_SECONDS } = require('../out/config.js');

test('resolveSeekStep defaults to 10 seconds for missing/invalid input', () => {
  assert.equal(resolveSeekStep(undefined), 10);
  assert.equal(resolveSeekStep(null), 10);
  assert.equal(resolveSeekStep('x'), 10);
});

test('resolveSeekStep rejects non-positive values and falls back to 10', () => {
  assert.equal(resolveSeekStep(0), 10);
  assert.equal(resolveSeekStep(-3), 10);
});

test('resolveSeekStep honors a positive numeric step', () => {
  assert.equal(resolveSeekStep(5), 5);
  assert.equal(resolveSeekStep(2.5), 2.5);
});

test('FRAME_STEP_SECONDS is a small positive frame delta', () => {
  assert.equal(typeof FRAME_STEP_SECONDS, 'number');
  assert.equal(FRAME_STEP_SECONDS > 0, true);
  assert.equal(FRAME_STEP_SECONDS < 1, true);
});
