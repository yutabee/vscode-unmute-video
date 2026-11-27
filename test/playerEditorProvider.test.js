'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { makeTempDir } = require('../test-support/tmp.js');

const uri = (fsPath) => ({ fsPath, toString: () => fsPath });
const vscode = {
    Uri: { joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)) },
    workspace: { getConfiguration: () => ({ get: () => undefined }) },
};
const realLoad = Module._load;
Module._load = function (request, ...args) {
    return request === 'vscode' ? vscode : realLoad.call(this, request, ...args);
};
const { PlayerEditorProvider } = require('../out/editor/playerEditorProvider.js');
Module._load = realLoad;

function makePanel() {
    const onClose = new Set();
    const onMessage = new Set();
    const posted = [];

    return {
        webview: {
            cspSource: 'https://webview.example',
            asWebviewUri: (resource) => resource,
            async postMessage(message) {
                posted.push(message);
                return true;
            },
            onDidReceiveMessage(listener) {
                onMessage.add(listener);
                return { dispose: () => onMessage.delete(listener) };
            },
        },
        onDidDispose(listener) {
            onClose.add(listener);
            return { dispose: () => onClose.delete(listener) };
        },
        async ready() {
            for (const listener of onMessage) await listener({ type: 'ready' });
            return posted.find(({ type }) => type === 'videoSrc')?.url;
        },
        close() {
            for (const listener of onClose) listener();
        },
    };
}

async function range(url) {
    const response = await fetch(url, {
        headers: { Range: 'bytes=1-4', Connection: 'close' },
        signal: AbortSignal.timeout(5000),
    });
    return { status: response.status, body: await response.text() };
}

test('split panels have independent stream servers and CSPs', async (t) => {
    const dir = makeTempDir('player-editor');
    const file = path.join(dir, 'split.webm');
    fs.writeFileSync(file, 'abcdefg');

    const provider = new PlayerEditorProvider({
        extensionUri: uri(path.join(__dirname, '..')),
        workspaceState: new Map(),
        globalState: new Map(),
    });
    t.after(() => {
        provider.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const document = provider.openCustomDocument(uri(file));
    const first = makePanel();
    const second = makePanel();
    await Promise.all([
        provider.resolveCustomEditor(document, first),
        provider.resolveCustomEditor(document, second),
    ]);

    const firstUrl = new URL(await first.ready());
    const secondUrl = new URL(await second.ready());
    assert.notEqual(firstUrl.port, secondUrl.port);
    assert.ok(first.webview.html.includes(`media-src ${firstUrl.origin} blob:`));
    assert.ok(second.webview.html.includes(`media-src ${secondUrl.origin} blob:`));

    const expected = { status: 206, body: 'bcde' };
    assert.deepEqual(await range(firstUrl), expected);
    assert.deepEqual(await range(secondUrl), expected);
    assert.deepEqual(await range(new URL(firstUrl.pathname, secondUrl.origin)), { status: 404, body: '' });

    first.close();
    await assert.rejects(range(firstUrl), (error) => error.cause?.code === 'ECONNREFUSED');
    assert.deepEqual(await range(secondUrl), expected);

    provider.dispose();
    await assert.rejects(range(secondUrl), (error) => error.cause?.code === 'ECONNREFUSED');
});
