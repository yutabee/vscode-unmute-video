'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const realLoad = Module._load;
let vscodeConfigValue = undefined;
let vscodeWorkspaceFolders = undefined;
const vscodeStub = {
    workspace: {
        getConfiguration: () => ({ get: () => vscodeConfigValue }),
        get workspaceFolders() { return vscodeWorkspaceFolders; },
    },
};

Module._load = function (request, ...rest) {
    if (request === 'vscode') {
        return vscodeStub;
    }
    return realLoad.call(this, request, ...rest);
};

const audioModule = require('../out/audio.js');
const originalAudio = {
    findFfmpeg: audioModule.findFfmpeg,
    extractAudio: audioModule.extractAudio,
    resolveFfmpegOverride: audioModule.resolveFfmpegOverride,
};
const { AudioExtractionController } = require('../out/audioExtractionController.js');

const FS_PATH = '/tmp/unmute/clip.mp4';

function makeFakeServer() {
    const calls = { register: [], unregister: [], urlFor: [] };
    let n = 0;
    return {
        calls,
        register(p) { calls.register.push(p); return 'tok-' + (++n); },
        unregister(t) { calls.unregister.push(t); },
        urlFor(t) { calls.urlFor.push(t); return 'http://127.0.0.1:0/' + t; },
    };
}

function makePostSink() {
    const posts = [];
    const waiters = [];
    const post = (m) => {
        posts.push(m);
        waiters.forEach((w) => w(m));
    };
    const waitForPost = (pred) => new Promise((resolve) => {
        const hit = posts.find(pred);
        if (hit) {
            resolve(hit);
            return;
        }
        waiters.push((m) => { if (pred(m)) resolve(m); });
    });
    return { posts, post, waitForPost };
}

function makeHarness() {
    const server = makeFakeServer();
    const sink = makePostSink();
    const ctl = new AudioExtractionController(server, FS_PATH, sink.post);
    return { server, sink, ctl };
}

function installSuccessStubs() {
    const findCalls = [];
    const extractCalls = [];
    audioModule.findFfmpeg = async (override) => {
        findCalls.push(override);
        return '/usr/bin/ffmpeg';
    };
    audioModule.extractAudio = async (ffmpeg, fsPath) => {
        extractCalls.push([ffmpeg, fsPath]);
        return '/cache/out.mp3';
    };
    return { findCalls, extractCalls };
}

function flushAsync() {
    return new Promise((resolve) => setImmediate(resolve));
}

afterEach(() => {
    vscodeConfigValue = undefined;
    vscodeWorkspaceFolders = undefined;
    audioModule.findFfmpeg = originalAudio.findFfmpeg;
    audioModule.extractAudio = originalAudio.extractAudio;
    audioModule.resolveFfmpegOverride = originalAudio.resolveFfmpegOverride;
});

test.after(() => {
    Module._load = realLoad;
});

test('success posts audioSrc and registers extracted audio', async () => {
    const { findCalls, extractCalls } = installSuccessStubs();
    const { server, sink, ctl } = makeHarness();

    ctl.start(false);
    await sink.waitForPost((m) => m.type === 'audioSrc');

    assert.deepEqual(sink.posts, [
        { type: 'audioSrc', url: 'http://127.0.0.1:0/tok-1' },
    ]);
    assert.deepEqual(findCalls, [undefined]);
    assert.deepEqual(extractCalls, [['/usr/bin/ffmpeg', FS_PATH]]);
    assert.deepEqual(server.calls.register, ['/cache/out.mp3']);
    assert.deepEqual(server.calls.urlFor, ['tok-1']);
    assert.deepEqual(server.calls.unregister, []);
});

test('ffmpeg missing posts init with ffmpegMissing and does not extract', async () => {
    const findCalls = [];
    let extractCalls = 0;
    audioModule.findFfmpeg = async (override) => {
        findCalls.push(override);
        return null;
    };
    audioModule.extractAudio = async () => {
        extractCalls += 1;
        return '/cache/out.mp3';
    };
    const { server, sink, ctl } = makeHarness();

    ctl.start(false);
    await sink.waitForPost((m) => m.type === 'init');

    assert.deepEqual(sink.posts, [
        { type: 'init', name: 'clip.mp4', audioPending: false, ffmpegMissing: true, nativeAudio: false },
    ]);
    assert.deepEqual(findCalls, [undefined]);
    assert.equal(extractCalls, 0);
    assert.deepEqual(server.calls.register, []);
    assert.equal(sink.posts.some((m) => m.type === 'audioSrc'), false);
});

test('showPendingStatus posts pending init before later audioSrc', async () => {
    const { findCalls, extractCalls } = installSuccessStubs();
    const { server, sink, ctl } = makeHarness();

    ctl.start(true);
    await sink.waitForPost((m) => m.type === 'audioSrc');

    assert.deepEqual(sink.posts[0], {
        type: 'init',
        name: 'clip.mp4',
        audioPending: true,
        ffmpegMissing: false,
        nativeAudio: false,
    });
    assert.deepEqual(sink.posts, [
        { type: 'init', name: 'clip.mp4', audioPending: true, ffmpegMissing: false, nativeAudio: false },
        { type: 'audioSrc', url: 'http://127.0.0.1:0/tok-1' },
    ]);
    assert.equal(findCalls.length, 1);
    assert.deepEqual(extractCalls, [['/usr/bin/ffmpeg', FS_PATH]]);
    assert.deepEqual(server.calls.register, ['/cache/out.mp3']);
});

test('start is a no-op after the first call', async () => {
    const { findCalls, extractCalls } = installSuccessStubs();
    const { server, sink, ctl } = makeHarness();

    ctl.start(false);
    ctl.start(false);
    await sink.waitForPost((m) => m.type === 'audioSrc');

    assert.equal(findCalls.length, 1);
    assert.deepEqual(extractCalls, [['/usr/bin/ffmpeg', FS_PATH]]);
    assert.deepEqual(sink.posts, [
        { type: 'audioSrc', url: 'http://127.0.0.1:0/tok-1' },
    ]);
    assert.deepEqual(server.calls.register, ['/cache/out.mp3']);
});

test('start is a no-op after dispose', () => {
    let findCalls = 0;
    audioModule.findFfmpeg = async () => {
        findCalls += 1;
        return '/usr/bin/ffmpeg';
    };
    audioModule.extractAudio = async () => '/cache/out.mp3';
    const { server, sink, ctl } = makeHarness();

    ctl.dispose();
    ctl.start(false);

    assert.equal(findCalls, 0);
    assert.deepEqual(sink.posts, []);
    assert.deepEqual(server.calls.register, []);
    assert.deepEqual(server.calls.unregister, []);
});

test('dispose during extraction unregisters the late token and posts no audioSrc', async () => {
    const findCalls = [];
    const extractCalls = [];
    let signalExtractCalled;
    let releaseExtract;
    const extractCalled = new Promise((resolve) => { signalExtractCalled = resolve; });
    const extractGate = new Promise((resolve) => { releaseExtract = resolve; });
    audioModule.findFfmpeg = async (override) => {
        findCalls.push(override);
        return '/usr/bin/ffmpeg';
    };
    audioModule.extractAudio = async (ffmpeg, fsPath) => {
        extractCalls.push([ffmpeg, fsPath]);
        signalExtractCalled();
        await extractGate;
        return '/cache/out.mp3';
    };
    const { server, sink, ctl } = makeHarness();

    ctl.start(false);
    await extractCalled;
    ctl.dispose();
    releaseExtract();
    await flushAsync();

    assert.deepEqual(findCalls, [undefined]);
    assert.deepEqual(extractCalls, [['/usr/bin/ffmpeg', FS_PATH]]);
    assert.deepEqual(server.calls.register, ['/cache/out.mp3']);
    assert.deepEqual(server.calls.unregister, ['tok-1']);
    assert.deepEqual(server.calls.urlFor, []);
    assert.equal(sink.posts.some((m) => m.type === 'audioSrc'), false);
    assert.deepEqual(sink.posts, []);
});

test('noAudio extraction error posts audioNone', async () => {
    const findCalls = [];
    const extractCalls = [];
    audioModule.findFfmpeg = async (override) => {
        findCalls.push(override);
        return '/usr/bin/ffmpeg';
    };
    audioModule.extractAudio = async (ffmpeg, fsPath) => {
        extractCalls.push([ffmpeg, fsPath]);
        throw { noAudio: true };
    };
    const { server, sink, ctl } = makeHarness();

    ctl.start(false);
    await sink.waitForPost((m) => m.type === 'audioNone');

    assert.deepEqual(sink.posts, [{ type: 'audioNone' }]);
    assert.deepEqual(findCalls, [undefined]);
    assert.deepEqual(extractCalls, [['/usr/bin/ffmpeg', FS_PATH]]);
    assert.deepEqual(server.calls.register, []);
});

test('generic extraction error posts audioError', async () => {
    const findCalls = [];
    const extractCalls = [];
    audioModule.findFfmpeg = async (override) => {
        findCalls.push(override);
        return '/usr/bin/ffmpeg';
    };
    audioModule.extractAudio = async (ffmpeg, fsPath) => {
        extractCalls.push([ffmpeg, fsPath]);
        throw new Error('boom');
    };
    const { server, sink, ctl } = makeHarness();

    ctl.start(false);
    await sink.waitForPost((m) => m.type === 'audioError');

    assert.deepEqual(sink.posts, [{ type: 'audioError' }]);
    assert.deepEqual(findCalls, [undefined]);
    assert.deepEqual(extractCalls, [['/usr/bin/ffmpeg', FS_PATH]]);
    assert.deepEqual(server.calls.register, []);
});

test('dispose unregisters an already registered audio token', async () => {
    const { findCalls, extractCalls } = installSuccessStubs();
    const { server, sink, ctl } = makeHarness();

    ctl.start(false);
    await sink.waitForPost((m) => m.type === 'audioSrc');
    ctl.dispose();

    assert.deepEqual(sink.posts, [
        { type: 'audioSrc', url: 'http://127.0.0.1:0/tok-1' },
    ]);
    assert.deepEqual(findCalls, [undefined]);
    assert.deepEqual(extractCalls, [['/usr/bin/ffmpeg', FS_PATH]]);
    assert.deepEqual(server.calls.register, ['/cache/out.mp3']);
    assert.deepEqual(server.calls.unregister, ['tok-1']);
});
