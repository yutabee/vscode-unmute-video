'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const bundle = fs.readFileSync(path.join(__dirname, '../media/player.js'), 'utf8');

class Element extends EventTarget {
  classList = { add() {}, remove() {}, toggle() {} };
  style = {};

  setAttribute() {}
}

class MediaElement extends Element {
  paused = true;
  currentTime = 0;
  duration = 90;
  buffered = { length: 0 };
  readyState = 4;
  seeking = false;
  deferPause = false;
  playResult = null;

  play() {
    this.paused = false;
    return this.playResult ?? Promise.resolve();
  }

  pause() {
    if (!this.paused) {
      this.paused = true;
      if (!this.deferPause) {
        this.dispatchEvent(new Event('pause'));
      }
    }
  }
}

function createPlayer(userAgent = 'Linux') {
  let time = 0;
  const video = new MediaElement();
  const audio = new MediaElement();
  const playButton = new Element();
  const elements = new Map([
    ['video', video],
    ['playBtn', playButton],
    ['volSlider', Object.assign(new Element(), { value: '1' })],
  ]);
  const document = Object.assign(new EventTarget(), {
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, new Element());
      }
      return elements.get(id);
    },
    createElement: () => audio,
    body: { appendChild() {} },
  });
  // The buffering timer is irrelevant to these tests. Keep the media event
  // sequence deterministic while exercising the shipped webview bundle.
  const window = Object.assign(new EventTarget(), { setTimeout: () => 1, clearTimeout() {} });
  vm.runInNewContext(bundle, {
    acquireVsCodeApi: () => ({ postMessage() {} }),
    document,
    window,
    navigator: { userAgent },
    performance: { now: () => time },
  });
  window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'audioSrc', url: 'sample.mp3' },
  }));
  const togglePlayback = () => playButton.dispatchEvent(new Event('click'));
  togglePlayback();
  return {
    audio, video, togglePlayback,
    advanceTime: (milliseconds) => { time += milliseconds; },
  };
}

test('a video fetch stall leaves both buffered tracks playing', () => {
  const { audio, video } = createPlayer();

  video.dispatchEvent(new Event('stalled'));

  assert.equal(video.paused, false);
  assert.equal(audio.paused, false);
});

test('an audio fetch stall leaves both buffered tracks playing', () => {
  const { audio, video } = createPlayer();

  audio.dispatchEvent(new Event('stalled'));

  assert.equal(video.paused, false);
  assert.equal(audio.paused, false);
});

test('video waiting pauses audio until video resumes playing', () => {
  const { audio, video } = createPlayer();
  video.readyState = 2;
  video.dispatchEvent(new Event('waiting'));
  assert.equal(audio.paused, true);

  video.readyState = 4;
  video.dispatchEvent(new Event('playing'));
  assert.equal(audio.paused, false);
});

test('audio waiting holds video until audio can play', () => {
  const { audio, video } = createPlayer();
  audio.readyState = 2;
  audio.dispatchEvent(new Event('waiting'));
  assert.equal(video.paused, true);

  audio.readyState = 4;
  audio.dispatchEvent(new Event('canplay'));
  assert.equal(video.paused, false);
});

test('audio recovery respects a user pause during buffering', () => {
  const { audio, video, togglePlayback } = createPlayer();
  audio.readyState = 2;
  audio.dispatchEvent(new Event('waiting'));
  togglePlayback();

  audio.readyState = 4;
  audio.dispatchEvent(new Event('canplay'));
  assert.equal(video.paused, true);
  assert.equal(audio.paused, true);
});

test('a queued audio waiting event cannot pause video after audio has recovered', () => {
  const { audio, video } = createPlayer();

  audio.dispatchEvent(new Event('waiting'));

  assert.equal(video.paused, false);
  assert.equal(audio.paused, false);
});

test('a queued video waiting event cannot pause audio after video has recovered', () => {
  const { audio, video } = createPlayer();

  video.dispatchEvent(new Event('waiting'));

  assert.equal(video.paused, false);
  assert.equal(audio.paused, false);
});

test('a video waiting event during an audio underrun does not pause the recovering audio', () => {
  const { audio, video } = createPlayer();
  audio.readyState = video.readyState = 2;
  audio.dispatchEvent(new Event('waiting'));

  video.dispatchEvent(new Event('waiting'));

  assert.equal(video.paused, true);
  assert.equal(audio.paused, false);
});

test('a seeked event does not release the video while audio still needs data', () => {
  const { audio, video } = createPlayer();
  audio.readyState = 2;
  audio.dispatchEvent(new Event('waiting'));

  audio.dispatchEvent(new Event('seeked'));
  assert.equal(video.paused, true);

  audio.readyState = 4;
  audio.dispatchEvent(new Event('canplay'));
  assert.equal(video.paused, false);
});

test('a buffered audio event does not resume audio while video is still waiting', () => {
  const { audio, video } = createPlayer();
  video.readyState = 2;
  video.dispatchEvent(new Event('waiting'));

  audio.dispatchEvent(new Event('canplay'));

  assert.equal(audio.paused, true);
});

test('a delayed pause event does not pause audio after video resumes', () => {
  const { audio, video } = createPlayer();
  video.deferPause = true;
  audio.readyState = 2;
  audio.dispatchEvent(new Event('waiting'));
  audio.readyState = 4;
  audio.dispatchEvent(new Event('canplay'));

  video.dispatchEvent(new Event('pause'));

  assert.equal(video.paused, false);
  assert.equal(audio.paused, false);
});

test('a rejected buffering resume does not override a later play request', async () => {
  const { audio, video, togglePlayback } = createPlayer();
  audio.readyState = 2;
  audio.dispatchEvent(new Event('waiting'));
  let rejectResume;
  video.playResult = new Promise((_, reject) => { rejectResume = reject; });
  audio.readyState = 4;
  audio.dispatchEvent(new Event('canplay'));

  togglePlayback();
  video.playResult = null;
  togglePlayback();
  rejectResume(new Error('Earlier play was interrupted by a pause'));
  await Promise.resolve();

  togglePlayback();
  assert.equal(video.paused, true);
  assert.equal(audio.paused, true);
});

test('repeated large drift uses rate correction while audio recovers from an automatic seek', () => {
  const { audio, video, advanceTime } = createPlayer();
  video.currentTime = 5;
  video.dispatchEvent(new Event('timeupdate'));
  assert.equal(audio.currentTime, 5);

  advanceTime(1000);
  video.currentTime = 6.5;
  video.dispatchEvent(new Event('timeupdate'));
  assert.equal(audio.currentTime, 5);
  assert.ok(audio.playbackRate > 1);

  advanceTime(4000);
  video.dispatchEvent(new Event('timeupdate'));
  assert.equal(audio.currentTime, 6.5);
  assert.equal(audio.playbackRate, 1);
});

test('video recovery restarts the audio track without seeking it again', () => {
  const { audio, video } = createPlayer();
  video.currentTime = 12;
  audio.currentTime = 10.5;
  video.readyState = 2;
  video.dispatchEvent(new Event('waiting'));
  assert.equal(audio.paused, true);

  video.readyState = 4;
  video.dispatchEvent(new Event('playing'));

  assert.equal(audio.paused, false);
  assert.equal(audio.currentTime, 10.5);
});

test('Windows corrects drift on the video without rate changes or seeks on audio', () => {
  const { audio, video } = createPlayer('Mozilla/5.0 (Windows NT 10.0; Win64; ARM64)');
  video.currentTime = 3.5;
  audio.currentTime = 3;
  video.dispatchEvent(new Event('timeupdate'));
  assert.equal(audio.currentTime, 3);
  assert.equal(audio.playbackRate, 1);
  assert.equal(video.playbackRate, 0.95);

  video.currentTime = 5;
  video.dispatchEvent(new Event('timeupdate'));
  assert.equal(audio.currentTime, 3);
  assert.equal(audio.playbackRate, 1);
  assert.equal(video.playbackRate, 0.95);

  video.currentTime = 3;
  video.dispatchEvent(new Event('timeupdate'));
  assert.equal(video.playbackRate, 1);
});
