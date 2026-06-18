'use strict';

// Acceptance tests for the security/trust hardening work:
//  - resolveFfmpegOverride(): a workspace must never be able to point the
//    extension at an arbitrary executable (defense-in-depth on top of the
//    machine-scoped setting).
//  - pruneAudioCache(): best-effort eviction of stale extracted-audio files.
//  - package.json manifest declarations (scope, capabilities, extensionKind).
//
// resolveFfmpegOverride / pruneAudioCache are pure (no `vscode` import) so they
// run directly against out/media/audio.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const audio = require('../out/media/audio.js');
const { createCleanup, makeTempDir } = require('../test-support/tmp.js');

// ---------------------------------------------------------------------------
// resolveFfmpegOverride
// ---------------------------------------------------------------------------

test('resolveFfmpegOverride: empty / whitespace / undefined -> undefined', () => {
    assert.equal(audio.resolveFfmpegOverride(undefined, []), undefined);
    assert.equal(audio.resolveFfmpegOverride('', []), undefined);
    assert.equal(audio.resolveFfmpegOverride('   ', []), undefined);
});

test('resolveFfmpegOverride: a relative path is rejected', () => {
    assert.equal(audio.resolveFfmpegOverride('ffmpeg', []), undefined);
    assert.equal(audio.resolveFfmpegOverride('./bin/ffmpeg', []), undefined);
    assert.equal(audio.resolveFfmpegOverride('../evil/ffmpeg', ['/home/user/ws']), undefined);
});

test('resolveFfmpegOverride: an absolute path outside all workspace roots is allowed', () => {
    const abs = process.platform === 'win32' ? 'C:\\tools\\ffmpeg.exe' : '/usr/bin/ffmpeg';
    assert.equal(audio.resolveFfmpegOverride(abs, ['/home/user/ws']), abs);
    // No workspace roots at all: an absolute path is fine.
    assert.equal(audio.resolveFfmpegOverride(abs, []), abs);
});

test('resolveFfmpegOverride: an absolute path INSIDE a workspace root is rejected (ACE guard)', () => {
    const root = process.platform === 'win32' ? 'C:\\Users\\me\\ws' : '/home/user/ws';
    const inside = path.join(root, 'tools', 'ffmpeg');
    assert.equal(audio.resolveFfmpegOverride(inside, [root]), undefined);
    // The root itself.
    assert.equal(audio.resolveFfmpegOverride(root, [root]), undefined);
    // Escaping via `..` back into the root is still rejected.
    const sneaky = path.join(root, 'sub', '..', 'ffmpeg');
    assert.equal(audio.resolveFfmpegOverride(sneaky, [root]), undefined);
});

test('resolveFfmpegOverride: a sibling dir that shares a name prefix is NOT treated as inside', () => {
    // Boundary safety: /home/user/ws-tools must not match root /home/user/ws.
    const root = process.platform === 'win32' ? 'C:\\Users\\me\\ws' : '/home/user/ws';
    const sibling = process.platform === 'win32'
        ? 'C:\\Users\\me\\ws-tools\\ffmpeg.exe'
        : '/home/user/ws-tools/ffmpeg';
    assert.equal(audio.resolveFfmpegOverride(sibling, [root]), sibling);
});

test('resolveFfmpegOverride: a case-only alias is caught on case-insensitive filesystems', (t) => {
    if (process.platform !== 'win32' && process.platform !== 'darwin') {
        t.skip('case-insensitive comparison only applies on macOS/Windows');
        return;
    }
    const root = process.platform === 'win32' ? 'C:\\Users\\Me\\Repo' : '/Users/Me/Repo';
    const inside = process.platform === 'win32'
        ? 'c:\\users\\me\\repo\\bin\\ffmpeg.exe'
        : '/users/me/repo/bin/ffmpeg';
    assert.equal(audio.resolveFfmpegOverride(inside, [root]), undefined);
});

test('resolveFfmpegOverride: a symlinked alias of a workspace path is caught (realpath)', (t) => {
    if (process.platform === 'win32') {
        t.skip('directory symlinks need privileges on Windows');
        return;
    }
    const cleanup = createCleanup();
    const base = cleanup.track(makeTempDir('unmute-symlink'));
    try {
        const realRoot = path.join(base, 'real-root');
        fs.mkdirSync(path.join(realRoot, 'bin'), { recursive: true });
        fs.writeFileSync(path.join(realRoot, 'bin', 'ffmpeg'), '');
        const linkRoot = path.join(base, 'link-root');
        fs.symlinkSync(realRoot, linkRoot);
        // The override reaches the binary through the symlinked root; realpath
        // must canonicalize it back inside realRoot and reject it.
        const viaLink = path.join(linkRoot, 'bin', 'ffmpeg');
        assert.equal(audio.resolveFfmpegOverride(viaLink, [realRoot]), undefined);
    } finally {
        cleanup.run();
    }
});

// ---------------------------------------------------------------------------
// pruneAudioCache
// ---------------------------------------------------------------------------

test('pruneAudioCache: never throws when the cache dir is absent', () => {
    assert.doesNotThrow(() => audio.pruneAudioCache());
    assert.doesNotThrow(() => audio.pruneAudioCache(1000));
});

test('pruneAudioCache: deletes stale audio files, keeps fresh ones', () => {
    const cacheDir = path.join(os.tmpdir(), 'unmute-video-cache');
    fs.mkdirSync(cacheDir, { recursive: true });

    const stale = path.join(cacheDir, `unmute-audio-test-stale-${process.pid}.mp3`);
    const fresh = path.join(cacheDir, `unmute-audio-test-fresh-${process.pid}.mp3`);
    fs.writeFileSync(stale, 'x');
    fs.writeFileSync(fresh, 'x');
    // Backdate the stale file by 10 days.
    const tenDaysAgo = (Date.now() - 10 * 24 * 60 * 60 * 1000) / 1000;
    fs.utimesSync(stale, tenDaysAgo, tenDaysAgo);

    try {
        audio.pruneAudioCache(); // default: 7 days
        assert.equal(fs.existsSync(stale), false, 'stale file should be pruned');
        assert.equal(fs.existsSync(fresh), true, 'fresh file should survive');
    } finally {
        for (const f of [stale, fresh]) {
            try { fs.unlinkSync(f); } catch { /* ignore */ }
        }
    }
});

// ---------------------------------------------------------------------------
// package.json manifest declarations
// ---------------------------------------------------------------------------

test('package.json: ffmpegPath is machine-scoped with a markdown description', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const prop = pkg.contributes.configuration.properties['unmuteVideo.ffmpegPath'];
    assert.equal(prop.scope, 'machine', 'ffmpegPath must be machine-scoped (no workspace override)');
    assert.ok(typeof prop.markdownDescription === 'string' && prop.markdownDescription.length > 0);
});

test('package.json: declares workspace-trust + virtual-workspace capabilities', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    assert.equal(pkg.capabilities.untrustedWorkspaces.supported, 'limited');
    assert.equal(pkg.capabilities.virtualWorkspaces.supported, false);
});

test('package.json: extensionKind is workspace; categories/keywords broadened', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    assert.ok(Array.isArray(pkg.extensionKind) && pkg.extensionKind.includes('workspace'));
    assert.ok(pkg.categories.includes('Visualization'));
    for (const kw of ['mov', 'm4v', 'ffmpeg']) {
        assert.ok(pkg.keywords.includes(kw), `keywords should include ${kw}`);
    }
    assert.equal(pkg.pricing, 'Free');
    assert.ok(typeof pkg.qna === 'string' && pkg.qna.length > 0);
    assert.ok(typeof pkg.homepage === 'string' && pkg.homepage.length > 0);
});
