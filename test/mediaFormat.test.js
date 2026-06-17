'use strict';

// Pure format classification (src/mediaFormat.ts -> out/mediaFormat.js). No
// vscode/DOM dependency, so it is exercised directly in Node. This is the
// machine-checkable contract for the webm (native-audio) branch: .webm plays
// its audio natively in the webview, while the AAC containers stay muted and
// rely on the ffmpeg->mp3 sidecar.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { isNativeAudioFormat, VIDEO_EXTENSIONS } = require('../out/mediaFormat.js');

test('webm is a native-audio format (case-insensitive)', () => {
  assert.equal(isNativeAudioFormat('/x/clip.webm'), true);
  assert.equal(isNativeAudioFormat('/x/CLIP.WEBM'), true);
  assert.equal(isNativeAudioFormat('clip.WebM'), true);
});

test('AAC containers are not native-audio', () => {
  for (const p of ['/x/a.mp4', '/x/a.mov', '/x/a.m4v', '/x/a.MP4', '/x/a.MOV']) {
    assert.equal(isNativeAudioFormat(p), false);
  }
});

test('unrelated or extension-less paths are not native-audio', () => {
  assert.equal(isNativeAudioFormat('/x/a.txt'), false);
  assert.equal(isNativeAudioFormat('/x/webm'), false);
  assert.equal(isNativeAudioFormat('/x/a.webm.txt'), false);
});

test('VIDEO_EXTENSIONS covers every supported container including webm', () => {
  for (const ext of ['.mp4', '.mov', '.m4v', '.webm']) {
    assert.ok(VIDEO_EXTENSIONS.includes(ext), `missing ${ext}`);
  }
});
