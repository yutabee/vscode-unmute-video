'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { findFfmpeg, resetFfmpegCache } = require('../out/audio.js');
const { execFileAsync } = require('./exec.js');

async function discoverFfmpeg() {
  resetFfmpegCache();
  return findFfmpeg();
}

async function makeAacMp4(ffmpeg, dir) {
  const sample = path.join(dir, 'sample.mp4');
  // Tiny H.264 + AAC clip: AAC is exactly the codec the webview can't decode,
  // so this is the real extraction path.
  await execFileAsync(ffmpeg, [
    '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=160x120:rate=15',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', sample,
  ]);
  return sample;
}

async function makeVideoOnlyMp4(ffmpeg, dir) {
  const videoOnly = path.join(dir, 'video-only.mp4');
  await execFileAsync(ffmpeg, [
    '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=160x120:rate=15',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', videoOnly,
  ]);
  return videoOnly;
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

module.exports = {
  discoverFfmpeg,
  makeAacMp4,
  makeVideoOnlyMp4,
  looksLikeMp3,
};
