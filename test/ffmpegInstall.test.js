'use strict';

// Platform -> ffmpeg install hint (src/shared/ffmpegInstall.ts ->
// out/shared/ffmpegInstall.js). No vscode/DOM dependency, so it is exercised
// directly in Node. This is the machine-checkable contract behind the
// "ffmpeg wasn't found" status: the command we put in front of the user, and
// the clipboard text the host copies, both come from here. A wrong or
// hallucinated command is worse than no hint at all, so the mapping is pinned.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { ffmpegInstallHint } = require('../out/shared/ffmpegInstall.js');

test('ffmpegInstallHint: macOS resolves to Homebrew', () => {
    assert.deepEqual(ffmpegInstallHint('darwin'), {
        command: 'brew install ffmpeg',
        manager: 'Homebrew',
    });
});

test('ffmpegInstallHint: Windows resolves to winget', () => {
    assert.deepEqual(ffmpegInstallHint('win32'), {
        command: 'winget install Gyan.FFmpeg',
        manager: 'winget',
    });
});

test('ffmpegInstallHint: Linux resolves to apt', () => {
    assert.deepEqual(ffmpegInstallHint('linux'), {
        command: 'sudo apt install ffmpeg',
        manager: 'apt',
    });
});

test('ffmpegInstallHint: unknown platforms yield null rather than a guess', () => {
    // A hint we cannot stand behind must not be shown. The caller falls back to
    // the settings route instead of printing a command for the wrong OS.
    for (const platform of ['freebsd', 'openbsd', 'sunos', 'aix', 'android', '']) {
        assert.equal(ffmpegInstallHint(platform), null, `expected null for "${platform}"`);
    }
});

test('ffmpegInstallHint: non-string input yields null', () => {
    // The webview boundary is untrusted; a malformed platform must not throw.
    for (const bad of [undefined, null, 0, {}, []]) {
        assert.equal(ffmpegInstallHint(bad), null);
    }
});

test('ffmpegInstallHint: callers get a fresh object they cannot alias', () => {
    // Two call sites (host clipboard + webview status text) read this. A shared
    // mutable record would let one of them corrupt the other.
    const first = ffmpegInstallHint('darwin');
    first.command = 'rm -rf /';
    assert.equal(ffmpegInstallHint('darwin').command, 'brew install ffmpeg');
});
