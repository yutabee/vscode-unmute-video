'use strict';

// Acceptance test for P0 fix #1: the extracted MP3 must stay aligned to the
// source video's timeline. A steady offset between the mp3 and the video clock
// is what drove the drift-correction feedback loop, so extraction must not
// shift the audio start or grossly change its duration.
//
// Needs real ffmpeg/ffprobe; self-skips when ffmpeg is absent (the audio
// feature is a no-op without it).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');

const { extractAudio } = require('../out/media/audio.js');
const {
  createCleanup,
  discoverFfmpeg,
  makeAacMp4,
  makeTempDir,
} = require('../test-support');

let ffmpeg = null;
let ffprobe = null;
let workDir = '';
let sample = '';
const cleanup = createCleanup();

function ffprobeStdout(args) {
  return new Promise((resolve, reject) => {
    execFile(ffprobe, args, { timeout: 60000 }, (err, stdout, stderr) =>
      err ? reject(new Error(stderr || err.message)) : resolve(String(stdout).trim()),
    );
  });
}

async function probeDuration(file) {
  const out = await ffprobeStdout([
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  return parseFloat(out);
}

async function probeAudioStart(file) {
  const out = await ffprobeStdout([
    '-v', 'error',
    '-select_streams', 'a:0',
    '-show_entries', 'stream=start_time',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  return parseFloat(out);
}

before(async () => {
  ffmpeg = await discoverFfmpeg();
  if (!ffmpeg) return;
  ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
  workDir = cleanup.track(makeTempDir('unmute-timelinetest'));
  sample = await makeAacMp4(ffmpeg, workDir);
});

after(() => {
  cleanup.run();
});

test('extracted mp3 duration matches the source video within tolerance', async (t) => {
  if (!ffmpeg) return t.skip('ffmpeg not available');
  const mp3 = await extractAudio(ffmpeg, sample);
  cleanup.track(mp3);
  const srcDur = await probeDuration(sample);
  const mp3Dur = await probeDuration(mp3);
  assert.ok(Number.isFinite(srcDur) && srcDur > 0, `bad source duration: ${srcDur}`);
  assert.ok(
    Math.abs(mp3Dur - srcDur) < 0.15,
    `mp3 duration ${mp3Dur}s should match source ${srcDur}s within 0.15s`,
  );
});

test('extracted mp3 audio stream starts at (or very near) zero', async (t) => {
  if (!ffmpeg) return t.skip('ffmpeg not available');
  const mp3 = await extractAudio(ffmpeg, sample);
  cleanup.track(mp3);
  const start = await probeAudioStart(mp3);
  assert.ok(
    Number.isFinite(start) && Math.abs(start) < 0.05,
    `mp3 audio should start at ~0, got start_time=${start}`,
  );
});
