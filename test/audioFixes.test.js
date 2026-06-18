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
const path = require('node:path');
const crypto = require('node:crypto');

const { extractAudio } = require('../out/media/audio.js');
const {
  createCleanup,
  discoverFfmpeg,
  makeTempDir,
  makeVideoOnlyMp4,
  uniqueInput,
  writeExtractFake,
} = require('../test-support');

let workDir = '';
let fakeFfmpeg = '';
const cleanup = createCleanup();

before(() => {
  workDir = cleanup.track(makeTempDir('unmute-fixtest'));
  fakeFfmpeg = writeExtractFake(workDir);
});

after(() => {
  cleanup.run();
});

test('#3 concurrent extractAudio for the same input runs ffmpeg only once', async () => {
  const input = uniqueInput(workDir);
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
    results.forEach((r) => cleanup.track(r));
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
  const input = uniqueInput(workDir);
  process.env.UNMUTE_FAKE_STDERR_MB = '4'; // >> execFile default maxBuffer (1MB)
  process.env.UNMUTE_FAKE_DELAY_MS = '0';
  try {
    const out = await extractAudio(fakeFfmpeg, input);
    cleanup.track(out);
    assert.ok(fs.existsSync(out), 'extraction completed despite large stderr');
    assert.ok(out.endsWith('.mp3'));
  } finally {
    delete process.env.UNMUTE_FAKE_STDERR_MB;
    delete process.env.UNMUTE_FAKE_DELAY_MS;
  }
});

test('#9 a video with no audio track rejects with err.noAudio === true', async (t) => {
  const ffmpeg = await discoverFfmpeg();
  if (!ffmpeg) { t.skip('real ffmpeg not available'); return; }

  const videoOnly = await makeVideoOnlyMp4(ffmpeg, workDir);

  await assert.rejects(
    () => extractAudio(ffmpeg, videoOnly),
    (err) => {
      assert.ok(err && err.noAudio === true, `expected err.noAudio===true, got ${err && err.noAudio}`);
      return true;
    },
  );
});
