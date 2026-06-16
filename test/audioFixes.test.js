'use strict';

// Acceptance tests for the review-driven audio fixes:
//  #3 concurrent extraction must run ffmpeg only once (in-flight dedup)
//  #4 large ffmpeg stderr must not abort extraction (no execFile maxBuffer cap)
//  #9 a video with no audio track must be reported distinctly (err.noAudio === true)
//
// #3 and #4 use a FAKE ffmpeg (a tiny node script) so they are deterministic and
// need no real ffmpeg. #9 needs real ffmpeg and self-skips when absent.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const { extractAudio, findFfmpeg, resetFfmpegCache } = require('../out/audio.js');

let workDir = '';
let fakeFfmpeg = '';
const produced = [];

// A fake ffmpeg: writes a minimal MP3 to its last arg, optionally emits N MB of
// stderr, optionally delays, and appends one byte to a counter file per call.
const FAKE_SRC = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const out = args[args.length - 1];
const counter = process.env.UNMUTE_FAKE_COUNTER;
if (counter) { try { fs.appendFileSync(counter, 'x'); } catch {} }
const mb = parseInt(process.env.UNMUTE_FAKE_STDERR_MB || '0', 10);
if (mb > 0) {
  const chunk = 'E'.repeat(64 * 1024);
  for (let i = 0; i < mb * 16; i++) process.stderr.write(chunk);
}
const delay = parseInt(process.env.UNMUTE_FAKE_DELAY_MS || '0', 10);
setTimeout(() => {
  // "ID3" tag header so it reads as an MP3.
  fs.writeFileSync(out, Buffer.from([0x49, 0x44, 0x33, 0x03, 0, 0, 0, 0, 0, 0]));
  process.exit(0);
}, delay);
`;

function uniqueInput() {
  // Unique content => unique (size+mtime+path) cache key => no cross-test cache hit.
  const p = path.join(workDir, `in-${crypto.randomBytes(6).toString('hex')}.mp4`);
  fs.writeFileSync(p, crypto.randomBytes(64));
  return p;
}

before(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unmute-fixtest-'));
  fakeFfmpeg = path.join(workDir, 'fake-ffmpeg.js');
  fs.writeFileSync(fakeFfmpeg, FAKE_SRC, { mode: 0o755 });
});

after(() => {
  for (const f of produced) { try { fs.unlinkSync(f); } catch {} }
  if (workDir) { try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {} }
});

test('#3 concurrent extractAudio for the same input runs ffmpeg only once', async () => {
  const input = uniqueInput();
  const counter = path.join(workDir, `cnt-${crypto.randomBytes(4).toString('hex')}`);
  process.env.UNMUTE_FAKE_COUNTER = counter;
  process.env.UNMUTE_FAKE_STDERR_MB = '0';
  process.env.UNMUTE_FAKE_DELAY_MS = '200'; // overlap window
  try {
    const results = await Promise.all([
      extractAudio(fakeFfmpeg, input),
      extractAudio(fakeFfmpeg, input),
      extractAudio(fakeFfmpeg, input),
    ]);
    results.forEach((r) => produced.push(r));
    assert.equal(results[0], results[1]);
    assert.equal(results[1], results[2]);
    const calls = fs.existsSync(counter) ? fs.readFileSync(counter, 'utf8').length : 0;
    assert.equal(calls, 1, `ffmpeg should run once, ran ${calls} times`);
  } finally {
    delete process.env.UNMUTE_FAKE_COUNTER;
    delete process.env.UNMUTE_FAKE_DELAY_MS;
  }
});

test('#4 large ffmpeg stderr does not abort extraction', async () => {
  const input = uniqueInput();
  process.env.UNMUTE_FAKE_STDERR_MB = '4'; // >> execFile default maxBuffer (1MB)
  process.env.UNMUTE_FAKE_DELAY_MS = '0';
  try {
    const out = await extractAudio(fakeFfmpeg, input);
    produced.push(out);
    assert.ok(fs.existsSync(out), 'extraction completed despite large stderr');
    assert.ok(out.endsWith('.mp3'));
  } finally {
    delete process.env.UNMUTE_FAKE_STDERR_MB;
    delete process.env.UNMUTE_FAKE_DELAY_MS;
  }
});

test('#9 a video with no audio track rejects with err.noAudio === true', async (t) => {
  resetFfmpegCache();
  const ffmpeg = await findFfmpeg();
  if (!ffmpeg) { t.skip('real ffmpeg not available'); return; }

  const videoOnly = path.join(workDir, 'video-only.mp4');
  await new Promise((resolve, reject) => {
    execFile(
      ffmpeg,
      ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=160x120:rate=15',
       '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', videoOnly],
      { timeout: 60000 },
      (err, _o, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve()),
    );
  });

  await assert.rejects(
    () => extractAudio(ffmpeg, videoOnly),
    (err) => {
      assert.ok(err && err.noAudio === true, `expected err.noAudio===true, got ${err && err.noAudio}`);
      return true;
    },
  );
});
