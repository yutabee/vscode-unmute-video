'use strict';

// Exercises the real ffmpeg extraction path (src/audio.ts -> out/audio.js).
// Requires ffmpeg on the machine; when it is absent every test self-skips, since
// the audio feature itself is a no-op without ffmpeg.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const { findFfmpeg, extractAudio, resetFfmpegCache } = require('../out/audio.js');

let ffmpeg = null;
let workDir = '';
let sample = '';
const produced = [];

function run(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 60000 }, (err, _stdout, stderr) =>
      err ? reject(new Error(stderr || err.message)) : resolve(),
    );
  });
}

// A valid MP3 starts with an ID3 tag ("ID3") or an MPEG audio frame sync
// (0xFF 0xEx). A failed/empty extraction would not.
function looksLikeMp3(file) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(3);
  fs.readSync(fd, buf, 0, 3, 0);
  fs.closeSync(fd);
  const isId3 = buf.toString('latin1', 0, 3) === 'ID3';
  const isFrameSync = buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0;
  return isId3 || isFrameSync;
}

before(async () => {
  resetFfmpegCache();
  ffmpeg = await findFfmpeg();
  if (!ffmpeg) return;
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unmute-audiotest-'));
  sample = path.join(workDir, 'sample.mp4');
  // Tiny H.264 + AAC clip: AAC is exactly the codec the webview can't decode,
  // so this is the real extraction path.
  await run(ffmpeg, [
    '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=160x120:rate=15',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', sample,
  ]);
});

after(() => {
  for (const f of produced) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
  if (workDir) {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

test('findFfmpeg locates a working binary (or returns null)', () => {
  assert.ok(ffmpeg === null || typeof ffmpeg === 'string');
});

test('REGRESSION: extractAudio produces a valid, non-empty MP3', async (t) => {
  if (!ffmpeg) { t.skip('ffmpeg not available'); return; }
  const out = await extractAudio(ffmpeg, sample);
  produced.push(out);
  assert.ok(fs.existsSync(out), 'output file exists');
  assert.ok(out.endsWith('.mp3'), 'final output is named .mp3');
  assert.ok(fs.statSync(out).size > 0, 'output is non-empty');
  assert.ok(looksLikeMp3(out), 'output has an MP3 signature (ID3 or frame sync)');
  // No leftover .part files in the temp dir.
  const leftovers = fs.readdirSync(os.tmpdir()).filter((n) => n.includes('.part'));
  assert.equal(leftovers.length, 0, `no .part leftovers: ${leftovers.join(', ')}`);
});

test('extractAudio is cached: second call returns the same path', async (t) => {
  if (!ffmpeg) { t.skip('ffmpeg not available'); return; }
  const first = await extractAudio(ffmpeg, sample);
  produced.push(first);
  const mtimeBefore = fs.statSync(first).mtimeMs;
  const second = await extractAudio(ffmpeg, sample);
  assert.equal(second, first, 'same cache key -> same path');
  assert.equal(fs.statSync(second).mtimeMs, mtimeBefore, 'cached file not rewritten');
});
