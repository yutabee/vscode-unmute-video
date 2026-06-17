'use strict';

// Characterization tests for findFfmpeg()'s caching + override/fallback paths
// (src/audio.ts -> out/audio.js). These lock in the observable behavior of the
// override branch before/after it is refactored into a shared memoizer, so the
// refactor cannot silently change it.
//
// The override path is exercised against a FAKE ffmpeg (a tiny executable that
// counts its own invocations), so "cached" and "deduped" are verified by the
// probe COUNT — not merely by result equality, which a broken cache would still
// satisfy. The default-probe result still depends on the host, so the few
// result-only assertions self-skip when no real ffmpeg is present.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { findFfmpeg, resetFfmpegCache } = require('../out/audio.js');
const { createCleanup, makeProbeFake, makeTempDir } = require('../test-support');

const BOGUS = '/nonexistent/path/does/not/exist/ffmpeg-bogus-xyz';
const isWindows = process.platform === 'win32';

let workDir = '';
const cleanup = createCleanup();

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
  assert.equal(await findFfmpeg(''), def, 'empty override -> default');
  assert.equal(await findFfmpeg('   '), def, 'whitespace override -> default');
});

// --- Probe-count tests (fake ffmpeg). These make "cached"/"deduped" verifiable
// by counting actual probes, closing the gap that result-only assertions leave. ---

test('findFfmpeg(override): a working override is probed exactly once, then cached', async (t) => {
  if (isWindows) { t.skip('fake exec relies on a unix shebang'); return; }
  workDir = cleanup.track(makeTempDir('unmute-ffmpegcache'));
  const fake = makeProbeFake(workDir, 'ffmpeg-ok', 0);

  resetFfmpegCache();
  assert.equal(await findFfmpeg(fake.bin), fake.bin, 'working override returned verbatim');
  assert.equal(fake.probeCount(), 1, 'probed once on first lookup');

  assert.equal(await findFfmpeg(fake.bin), fake.bin, 'second lookup still returns it');
  assert.equal(fake.probeCount(), 1, 'cache hit: NOT probed again');
});

test('findFfmpeg(override): concurrent identical overrides probe only once (in-flight dedup)', async (t) => {
  if (isWindows) { t.skip('fake exec relies on a unix shebang'); return; }
  workDir = workDir || cleanup.track(makeTempDir('unmute-ffmpegcache'));
  const fake = makeProbeFake(workDir, 'ffmpeg-concurrent', 0);

  resetFfmpegCache();
  const results = await Promise.all([
    findFfmpeg(fake.bin),
    findFfmpeg(fake.bin),
    findFfmpeg(fake.bin),
  ]);
  assert.deepEqual(results, [fake.bin, fake.bin, fake.bin]);
  assert.equal(fake.probeCount(), 1, 'three concurrent lookups share a single probe');
});

test('findFfmpeg(override): a failing override is probed once, then falls back to the default', async (t) => {
  if (isWindows) { t.skip('fake exec relies on a unix shebang'); return; }
  workDir = workDir || cleanup.track(makeTempDir('unmute-ffmpegcache'));
  const failing = makeProbeFake(workDir, 'ffmpeg-fail', 1);

  resetFfmpegCache();
  const def = await findFfmpeg();
  resetFfmpegCache();
  const result = await findFfmpeg(failing.bin);
  assert.equal(failing.probeCount(), 1, 'the failing override was actually probed');
  assert.equal(result, def, 'after the probe fails it falls back to the default result');
});

test.after(() => {
  cleanup.run();
});
