'use strict';

// Pure A-B / whole-loop boundary logic (src/webview/abLoop.ts ->
// out/webview/abLoop.js). No DOM dependency, so it is exercised directly in
// Node. This is the machine-checkable contract for looping: given the current
// time and the loop state, decide whether (and where) to seek back.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { nextLoopTarget } = require('../out/webview/abLoop.js');

test('A-B loop seeks back to A once playback reaches B', () => {
  const state = { a: 2, b: 4, whole: false, duration: 10 };
  assert.equal(nextLoopTarget(4, state), 2);
  assert.equal(nextLoopTarget(5, state), 2);
});

test('A-B loop does not seek while inside the [A, B] window', () => {
  const state = { a: 2, b: 4, whole: false, duration: 10 };
  assert.equal(nextLoopTarget(3, state), null);
});

test('whole loop restarts from 0 at the end of the clip', () => {
  const state = { a: null, b: null, whole: true, duration: 10 };
  assert.equal(nextLoopTarget(10, state), 0);
});

test('whole loop does not seek mid-clip', () => {
  const state = { a: null, b: null, whole: true, duration: 10 };
  assert.equal(nextLoopTarget(5, state), null);
});

test('no loop active means no seek', () => {
  const state = { a: null, b: null, whole: false, duration: 10 };
  assert.equal(nextLoopTarget(5, state), null);
  assert.equal(nextLoopTarget(10, state), null);
});
