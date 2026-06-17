'use strict';

// Exercises the real ffmpeg extraction path (src/audio.ts -> out/audio.js).
// Requires ffmpeg on the machine; when it is absent every test self-skips, since
// the audio feature itself is a no-op without ffmpeg.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { extractAudio } = require('../out/audio.js');
const {
  createCleanup,
  discoverFfmpeg,
  looksLikeMp3,
  makeAacMp4,
  makeTempDir,
} = require('../test-support');

let ffmpeg = null;
let workDir = '';
let sample = '';
const cleanup = createCleanup();

before(async () => {
  ffmpeg = await discoverFfmpeg();
  if (!ffmpeg) return;
  workDir = cleanup.track(makeTempDir('unmute-audiotest'));
  sample = await makeAacMp4(ffmpeg, workDir);
});

after(() => {
  cleanup.run();
});

test('findFfmpeg locates a working binary (or returns null)', () => {
  assert.ok(ffmpeg === null || typeof ffmpeg === 'string');
});

test('REGRESSION: extractAudio produces a valid, non-empty MP3', async (t) => {
  if (!ffmpeg) { t.skip('ffmpeg not available'); return; }
  const out = await extractAudio(ffmpeg, sample);
  cleanup.track(out);
  assert.ok(fs.existsSync(out), 'output file exists');
  assert.ok(out.endsWith('.mp3'), 'final output is named .mp3');
  assert.ok(fs.statSync(out).size > 0, 'output is non-empty');
  assert.ok(looksLikeMp3(out), 'output has an MP3 signature (ID3 or frame sync)');
  // No leftover .part files for THIS extraction in the private audio cache dir.
  // The real partial files live in CACHE_DIR (os.tmpdir()/unmute-video-cache) as
  // `unmute-audio-<key>.<rand>.part.mp3`, NOT at the top of os.tmpdir() — the old
  // top-level scan checked the wrong directory and was effectively vacuous. Scope
  // the scan to this output's key so a concurrent extraction in another test
  // process (test files run in separate processes sharing this dir) can't leave a
  // transient .part and make the assertion flaky.
  const cacheDir = path.join(os.tmpdir(), 'unmute-video-cache');
  const stem = path.basename(out, '.mp3'); // unmute-audio-<key>
  const leftovers = fs.existsSync(cacheDir)
    ? fs.readdirSync(cacheDir).filter((n) => n.startsWith(`${stem}.`) && n.includes('.part'))
    : [];
  assert.equal(leftovers.length, 0, `no .part leftovers for ${stem} in ${cacheDir}: ${leftovers.join(', ')}`);
});

test('extractAudio is cached: second call returns the same path', async (t) => {
  if (!ffmpeg) { t.skip('ffmpeg not available'); return; }
  const first = await extractAudio(ffmpeg, sample);
  cleanup.track(first);
  const mtimeBefore = fs.statSync(first).mtimeMs;
  const second = await extractAudio(ffmpeg, sample);
  assert.equal(second, first, 'same cache key -> same path');
  assert.equal(fs.statSync(second).mtimeMs, mtimeBefore, 'cached file not rewritten');
});
