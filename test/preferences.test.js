'use strict';

// Pure preference normalization (src/preferences.ts -> out/preferences.js). No
// vscode/DOM dependency, so it is exercised directly in Node. This is the
// machine-checkable contract for persisting volume / muted / playbackRate:
// values read back from storage are untrusted and must be clamped to safe
// ranges before being applied to the media elements.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { clampPreferences } = require('../out/preferences.js');

test('clampPreferences returns sane defaults for missing input', () => {
  assert.deepEqual(clampPreferences(undefined), { volume: 1, muted: false, playbackRate: 1 });
  assert.deepEqual(clampPreferences({}), { volume: 1, muted: false, playbackRate: 1 });
});

test('clampPreferences clamps volume into [0, 1]', () => {
  assert.equal(clampPreferences({ volume: 2 }).volume, 1);
  assert.equal(clampPreferences({ volume: -1 }).volume, 0);
  assert.equal(clampPreferences({ volume: 0.4 }).volume, 0.4);
});

test('clampPreferences snaps playbackRate to an allowed speed', () => {
  assert.equal(clampPreferences({ playbackRate: 1.25 }).playbackRate, 1.25);
  // Out-of-set rates fall back to 1x rather than applying an arbitrary speed.
  assert.equal(clampPreferences({ playbackRate: 99 }).playbackRate, 1);
  assert.equal(clampPreferences({ playbackRate: 'x' }).playbackRate, 1);
});

test('clampPreferences coerces muted to a strict boolean', () => {
  assert.equal(clampPreferences({ muted: true }).muted, true);
  assert.equal(clampPreferences({ muted: false }).muted, false);
  assert.equal(clampPreferences({ muted: undefined }).muted, false);
});
