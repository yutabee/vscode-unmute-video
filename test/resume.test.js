'use strict';

// Pure resume helpers (src/resume.ts -> out/resume.js). No vscode/DOM
// dependency, so they are exercised directly in Node. These are the
// machine-checkable contract for "remember playback position": the host
// persists currentTime keyed by file path and only restores it when the saved
// position is meaningfully before the end.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { resumeKey, shouldResume } = require('../out/resume.js');

test('resumeKey is a stable, path-distinct, non-empty string', () => {
  const a = resumeKey('/movies/a.mp4');
  const b = resumeKey('/movies/b.mp4');
  assert.equal(typeof a, 'string');
  assert.equal(a.length > 0, true);
  assert.equal(a, resumeKey('/movies/a.mp4'));
  assert.notEqual(a, b);
});

test('shouldResume returns true for a position well before the end', () => {
  assert.equal(shouldResume(50, 100, 5), true);
});

test('shouldResume returns false within the end threshold', () => {
  // 97s of a 100s clip is inside the trailing 5s -> start from 0 instead.
  assert.equal(shouldResume(97, 100, 5), false);
});

test('shouldResume returns false for a zero/negative saved position', () => {
  assert.equal(shouldResume(0, 100, 5), false);
  assert.equal(shouldResume(-1, 100, 5), false);
});

test('shouldResume returns false when the duration is not finite', () => {
  assert.equal(shouldResume(50, NaN, 5), false);
  assert.equal(shouldResume(50, Infinity, 5), false);
});
