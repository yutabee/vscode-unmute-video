'use strict';

// Characterization tests for findFfmpeg()'s caching + override/fallback paths
// (src/audio.ts -> out/audio.js). These lock in the observable behavior of the
// override branch before it is refactored into a shared memoizer, so the
// refactor cannot silently change it.
//
// Most assertions hold whether or not ffmpeg is installed: with no ffmpeg the
// default probe returns null, and a bogus override still falls back to that
// null. The "valid override" case self-skips when no binary is present.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { findFfmpeg, resetFfmpegCache } = require('../out/audio.js');

const BOGUS = '/nonexistent/path/does/not/exist/ffmpeg-bogus-xyz';

test('findFfmpeg(): default probe result is stable across calls (cached)', async () => {
  resetFfmpegCache();
  const a = await findFfmpeg();
  const b = await findFfmpeg();
  assert.equal(a, b, 'second default call returns the cached result');
  assert.ok(a === null || typeof a === 'string');
});

test('findFfmpeg(override): a working override is returned as-is', async (t) => {
  resetFfmpegCache();
  const def = await findFfmpeg();
  if (!def) { t.skip('ffmpeg not available'); return; }
  // The discovered default binary is, by definition, a working binary, so
  // passing it as an explicit override must probe OK and be returned verbatim.
  const viaOverride = await findFfmpeg(def);
  assert.equal(viaOverride, def, 'a probe-able override is returned unchanged');
});

test('findFfmpeg(override): a bogus override falls back to the default probe', async () => {
  resetFfmpegCache();
  const def = await findFfmpeg();
  resetFfmpegCache();
  const viaBogus = await findFfmpeg(BOGUS);
  assert.equal(viaBogus, def, 'unprobeable override falls back to the default result');
});

test('findFfmpeg(override): override result is cached (stable across calls)', async () => {
  resetFfmpegCache();
  const first = await findFfmpeg(BOGUS);
  const second = await findFfmpeg(BOGUS);
  assert.equal(first, second, 'repeated override lookups return the same result');
});

test('findFfmpeg(override): concurrent identical overrides dedupe to one result', async () => {
  resetFfmpegCache();
  const [a, b, c] = await Promise.all([
    findFfmpeg(BOGUS),
    findFfmpeg(BOGUS),
    findFfmpeg(BOGUS),
  ]);
  assert.equal(a, b);
  assert.equal(b, c);
});

test('findFfmpeg(override): an empty/whitespace override behaves like no override', async () => {
  resetFfmpegCache();
  const def = await findFfmpeg();
  assert.equal(await findFfmpeg(''), def, "empty override -> default");
  assert.equal(await findFfmpeg('   '), def, 'whitespace override -> default');
});
