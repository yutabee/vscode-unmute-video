'use strict';

// Pure SRT->WebVTT conversion (src/media/subtitles.ts -> out/media/subtitles.js). No
// vscode/DOM dependency, so it is exercised directly in Node. This is the
// machine-checkable contract for sidecar subtitle support: a same-name .srt
// file is converted to WebVTT before being streamed to the <track> element.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { srtToVtt } = require('../out/media/subtitles.js');

const SRT = [
  '1',
  '00:00:01,000 --> 00:00:02,000',
  'Hello',
  '',
  '2',
  '00:00:03,500 --> 00:00:04,200',
  'World',
  '',
].join('\n');

test('srtToVtt prepends the WEBVTT header', () => {
  const vtt = srtToVtt(SRT);
  assert.equal(vtt.startsWith('WEBVTT'), true);
});

test('srtToVtt converts comma cue timestamps to dot form', () => {
  const vtt = srtToVtt(SRT);
  assert.match(vtt, /00:00:01\.000 --> 00:00:02\.000/);
  assert.match(vtt, /00:00:03\.500 --> 00:00:04\.200/);
  // The SRT comma form must NOT survive in the output.
  assert.equal(vtt.includes('00:00:01,000'), false);
});

test('srtToVtt preserves cue text', () => {
  const vtt = srtToVtt(SRT);
  assert.equal(vtt.includes('Hello'), true);
  assert.equal(vtt.includes('World'), true);
});

test('srtToVtt tolerates CRLF line endings', () => {
  const crlf = SRT.replace(/\n/g, '\r\n');
  const vtt = srtToVtt(crlf);
  assert.equal(vtt.startsWith('WEBVTT'), true);
  assert.match(vtt, /00:00:01\.000 --> 00:00:02\.000/);
});
