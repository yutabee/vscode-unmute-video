'use strict';

// Pure webview helpers (src/webview/util.ts -> out/webview/util.js). These have
// no DOM dependency, so they are exercised directly in Node.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { formatTime, clamp, ratioInRect, latestBufferedEnd } = require('../out/webview/util.js');

test('formatTime: sub-hour durations render as m:ss', () => {
    assert.equal(formatTime(0), '0:00');
    assert.equal(formatTime(5), '0:05');
    assert.equal(formatTime(65), '1:05');
    assert.equal(formatTime(599), '9:59');
});

test('formatTime: hour+ durations render as h:mm:ss', () => {
    assert.equal(formatTime(3600), '1:00:00');
    assert.equal(formatTime(3661), '1:01:01');
    assert.equal(formatTime(36000), '10:00:00');
});

test('formatTime: non-finite or negative input clamps to 0:00', () => {
    assert.equal(formatTime(NaN), '0:00');
    assert.equal(formatTime(Infinity), '0:00');
    assert.equal(formatTime(-5), '0:00');
});

test('formatTime: fractional seconds floor', () => {
    assert.equal(formatTime(59.9), '0:59');
});

test('clamp: bounds the value into [min, max]', () => {
    assert.equal(clamp(5, 0, 10), 5);
    assert.equal(clamp(-3, 0, 10), 0);
    assert.equal(clamp(42, 0, 10), 10);
});

test('ratioInRect: maps clientX to a clamped 0..1 position', () => {
    assert.equal(ratioInRect(100, 100, 200), 0);
    assert.equal(ratioInRect(200, 100, 200), 0.5);
    assert.equal(ratioInRect(300, 100, 200), 1);
    assert.equal(ratioInRect(50, 100, 200), 0); // left of the rect
    assert.equal(ratioInRect(999, 100, 200), 1); // right of the rect
});

test('ratioInRect: a non-positive width yields 0', () => {
    assert.equal(ratioInRect(150, 100, 0), 0);
    assert.equal(ratioInRect(150, 100, -10), 0);
});

test('latestBufferedEnd: returns the farthest end of started ranges', () => {
    const ranges = [
        { start: 0, end: 10 },
        { start: 12, end: 20 },
    ];
    assert.equal(latestBufferedEnd(ranges, 5), 10);
    assert.equal(latestBufferedEnd(ranges, 15), 20);
});

test('latestBufferedEnd: ignores ranges that have not started yet', () => {
    const ranges = [{ start: 30, end: 40 }];
    assert.equal(latestBufferedEnd(ranges, 5), 0);
});

test('latestBufferedEnd: empty ranges -> 0', () => {
    assert.equal(latestBufferedEnd([], 5), 0);
});
