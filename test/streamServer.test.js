'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { StreamServer } = require('../out/streamServer.js');
const { makeTempDir } = require('../test-support/tmp.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A scratch directory unique to this test run. */
const TMP_ROOT = makeTempDir('streamserver-test');

/**
 * Write a temp file with the given contents (string or Buffer) and a given
 * extension, returning its absolute path. Files live under TMP_ROOT and are
 * cleaned up at the end of the run.
 */
let fileSeq = 0;
function makeTempFile(contents, ext) {
    const name = `f${fileSeq++}${ext || '.mp4'}`;
    const p = path.join(TMP_ROOT, name);
    fs.writeFileSync(p, contents);
    return p;
}

/**
 * Start a fresh StreamServer and arrange for it to be disposed after the test.
 * Returns the started server.
 */
async function freshServer(t) {
    const server = new StreamServer();
    await server.start();
    t.after(() => server.dispose());
    return server;
}

/**
 * Perform an HTTP request against host:port and collect the full response.
 * Resolves with { statusCode, headers, body (Buffer) }.
 *
 * `opts` may include: method, pathname, headers, host (overrides connect host),
 * port (overrides connect port).
 */
function request(port, opts = {}) {
    return new Promise((resolve, reject) => {
        const reqOpts = {
            host: '127.0.0.1',
            port,
            method: opts.method || 'GET',
            path: opts.pathname || '/',
            headers: opts.headers || {},
        };
        const req = http.request(reqOpts, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: Buffer.concat(chunks),
                });
            });
        });
        req.on('error', reject);
        req.end();
    });
}

/** Request by token: builds the "/<token>" path. */
function requestToken(port, token, opts = {}) {
    return request(port, { ...opts, pathname: `/${token}` });
}

// ---------------------------------------------------------------------------
// Global teardown: remove the scratch directory.
// ---------------------------------------------------------------------------

test.after(() => {
    try {
        fs.rmSync(TMP_ROOT, { recursive: true, force: true });
    } catch {
        /* best-effort cleanup */
    }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('start() assigns a port > 0 and the server answers on 127.0.0.1', async (t) => {
    const server = await freshServer(t);
    const port = server.getPort();
    assert.ok(Number.isInteger(port) && port > 0, `expected port > 0, got ${port}`);

    // Server is reachable on loopback; an unknown token still gets an HTTP reply
    // (404), proving the listener is live on 127.0.0.1:<port>.
    const res = await request(port, { pathname: '/nope' });
    assert.equal(res.statusCode, 404);
});

test('register() is idempotent per path (same path -> same token)', async (t) => {
    const server = await freshServer(t);
    const file = makeTempFile('idempotent', '.mp4');

    const t1 = server.register(file);
    const t2 = server.register(file);
    assert.equal(t1, t2, 'registering the same path twice must return the same token');

    // Clean up the two refs we just took.
    server.unregister(t1);
    server.unregister(t2);
});

test('register() is refcounted: two registers, one unregister still serves, second 404s', async (t) => {
    const server = await freshServer(t);
    const port = server.getPort();
    const body = 'refcount-payload';
    const file = makeTempFile(body, '.mp4');

    const tok = server.register(file);
    const tok2 = server.register(file);
    assert.equal(tok, tok2);

    // First release: still one holder -> still served.
    server.unregister(tok);
    let res = await requestToken(port, tok, { method: 'GET' });
    assert.equal(res.statusCode, 200, 'after one unregister of two refs, still served');
    assert.equal(res.body.toString(), body);

    // Last release: now forgotten -> 404.
    server.unregister(tok);
    res = await requestToken(port, tok, { method: 'GET' });
    assert.equal(res.statusCode, 404, 'after the last unregister, token is forgotten');
});

test('urlFor() produces the expected loopback URL format', async (t) => {
    const server = await freshServer(t);
    const port = server.getPort();
    const file = makeTempFile('x', '.mp4');
    const tok = server.register(file);

    assert.equal(server.urlFor(tok), `http://127.0.0.1:${port}/${tok}`);
    server.unregister(tok);
});

test('GET full body -> 200 with correct Content-Length and exact bytes', async (t) => {
    const server = await freshServer(t);
    const port = server.getPort();
    // Use binary content to exercise byte-accuracy, not just text.
    const data = Buffer.from([0, 1, 2, 3, 4, 250, 251, 252, 253, 254, 255]);
    const file = makeTempFile(data, '.mp4');
    const tok = server.register(file);

    const res = await requestToken(port, tok, { method: 'GET' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-length'], String(data.length));
    assert.equal(res.headers['accept-ranges'], 'bytes');
    assert.deepEqual(res.body, data, 'body bytes must equal file bytes');
    assert.equal(res.body.length, fs.statSync(file).size);

    server.unregister(tok);
});

test('HEAD -> headers only, empty body', async (t) => {
    const server = await freshServer(t);
    const port = server.getPort();
    const data = Buffer.from('head-test-content');
    const file = makeTempFile(data, '.mp4');
    const tok = server.register(file);

    const res = await requestToken(port, tok, { method: 'HEAD' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-length'], String(data.length));
    assert.equal(res.body.length, 0, 'HEAD response must have an empty body');

    server.unregister(tok);
});

test('Range bytes=0-3 -> 206 with Content-Range, Content-Length 4 and correct bytes', async (t) => {
    const server = await freshServer(t);
    const port = server.getPort();
    const data = Buffer.from('0123456789'); // total 10
    const file = makeTempFile(data, '.mp4');
    const tok = server.register(file);

    const res = await requestToken(port, tok, {
        method: 'GET',
        headers: { Range: 'bytes=0-3' },
    });
    assert.equal(res.statusCode, 206);
    assert.equal(res.headers['content-range'], `bytes 0-3/${data.length}`);
    assert.equal(res.headers['content-length'], '4');
    assert.equal(res.headers['accept-ranges'], 'bytes');
    assert.deepEqual(res.body, data.subarray(0, 4));

    server.unregister(tok);
});

test('multi-range bytes=0-3,8-9 -> 206 serving the first range', async (t) => {
    const server = await freshServer(t);
    const port = server.getPort();
    const data = Buffer.from('0123456789'); // total 10
    const file = makeTempFile(data, '.mp4');
    const tok = server.register(file);

    const res = await requestToken(port, tok, {
        method: 'GET',
        headers: { Range: 'bytes=0-3,8-9' },
    });
    // We honor the first range rather than falling back to a full 200.
    assert.equal(res.statusCode, 206);
    assert.equal(res.headers['content-range'], `bytes 0-3/${data.length}`);
    assert.equal(res.headers['content-length'], '4');
    assert.deepEqual(res.body, data.subarray(0, 4));

    server.unregister(tok);
});

test('open-ended Range bytes=2- -> 206 to the end', async (t) => {
    const server = await freshServer(t);
    const port = server.getPort();
    const data = Buffer.from('0123456789'); // total 10
    const file = makeTempFile(data, '.mp4');
    const tok = server.register(file);

    const res = await requestToken(port, tok, {
        method: 'GET',
        headers: { Range: 'bytes=2-' },
    });
    assert.equal(res.statusCode, 206);
    assert.equal(res.headers['content-range'], `bytes 2-${data.length - 1}/${data.length}`);
    assert.equal(res.headers['content-length'], String(data.length - 2));
    assert.deepEqual(res.body, data.subarray(2));

    server.unregister(tok);
});

test('suffix Range bytes=-4 -> 206 of the last 4 bytes', async (t) => {
    const server = await freshServer(t);
    const port = server.getPort();
    const data = Buffer.from('0123456789'); // total 10
    const file = makeTempFile(data, '.mp4');
    const tok = server.register(file);

    const res = await requestToken(port, tok, {
        method: 'GET',
        headers: { Range: 'bytes=-4' },
    });
    assert.equal(res.statusCode, 206);
    assert.equal(res.headers['content-range'], `bytes ${data.length - 4}-${data.length - 1}/${data.length}`);
    assert.equal(res.headers['content-length'], '4');
    assert.deepEqual(res.body, data.subarray(data.length - 4));

    server.unregister(tok);
});

test('unsatisfiable Range (start beyond size) -> 416 with Content-Range bytes */<total>', async (t) => {
    const server = await freshServer(t);
    const port = server.getPort();
    const data = Buffer.from('0123456789'); // total 10
    const file = makeTempFile(data, '.mp4');
    const tok = server.register(file);

    const res = await requestToken(port, tok, {
        method: 'GET',
        headers: { Range: 'bytes=100-200' },
    });
    assert.equal(res.statusCode, 416);
    assert.equal(res.headers['content-range'], `bytes */${data.length}`);
    assert.equal(res.headers['accept-ranges'], 'bytes');

    server.unregister(tok);
});

test('REGRESSION: zero-byte file -> 200, Content-Length 0, empty body, server stays alive', async (t) => {
    const server = await freshServer(t);
    const port = server.getPort();

    const emptyFile = makeTempFile(Buffer.alloc(0), '.mp4');
    assert.equal(fs.statSync(emptyFile).size, 0, 'precondition: file is zero bytes');
    const emptyTok = server.register(emptyFile);

    const res = await requestToken(port, emptyTok, { method: 'GET' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-length'], '0');
    assert.equal(res.body.length, 0, 'zero-byte file must yield an empty body');

    // The server must NOT have crashed: a follow-up request to a normal file
    // still succeeds on the same listener.
    const liveData = Buffer.from('still-alive');
    const liveFile = makeTempFile(liveData, '.mp4');
    const liveTok = server.register(liveFile);
    const res2 = await requestToken(port, liveTok, { method: 'GET' });
    assert.equal(res2.statusCode, 200, 'server must still be answering after the zero-byte request');
    assert.deepEqual(res2.body, liveData);

    server.unregister(emptyTok);
    server.unregister(liveTok);
});

test('unknown token -> 404', async (t) => {
    const server = await freshServer(t);
    const port = server.getPort();

    const res = await requestToken(port, 'deadbeefdeadbeefdeadbeefdeadbeef', { method: 'GET' });
    assert.equal(res.statusCode, 404);
});

test('Host header mismatch -> 403; correct Host -> 200', async (t) => {
    const server = await freshServer(t);
    const port = server.getPort();
    const data = Buffer.from('host-check');
    const file = makeTempFile(data, '.mp4');
    const tok = server.register(file);

    // Wrong host:port in the Host header is rejected.
    const wrong = await requestToken(port, tok, {
        method: 'GET',
        headers: { Host: 'evil.example.com:1234' },
    });
    assert.equal(wrong.statusCode, 403);

    // The exact loopback host:port we listen on is accepted.
    const right = await requestToken(port, tok, {
        method: 'GET',
        headers: { Host: `127.0.0.1:${port}` },
    });
    assert.equal(right.statusCode, 200);
    assert.deepEqual(right.body, data);

    server.unregister(tok);
});

test('Content-Type by extension: .mp4 -> video/mp4', async (t) => {
    const server = await freshServer(t);
    const port = server.getPort();
    const file = makeTempFile(Buffer.from('mp4'), '.mp4');
    const tok = server.register(file);

    const res = await requestToken(port, tok, { method: 'GET' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'video/mp4');

    server.unregister(tok);
});

test('Content-Type by extension: .webm -> video/webm', async (t) => {
    const server = await freshServer(t);
    const port = server.getPort();
    const file = makeTempFile(Buffer.from('webm'), '.webm');
    const tok = server.register(file);

    const res = await requestToken(port, tok, { method: 'GET' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'video/webm');

    server.unregister(tok);
});

test('Content-Type by extension: .mp3 -> audio/mpeg', async (t) => {
    const server = await freshServer(t);
    const port = server.getPort();
    const file = makeTempFile(Buffer.from('mp3'), '.mp3');
    const tok = server.register(file);

    const res = await requestToken(port, tok, { method: 'GET' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'audio/mpeg');

    server.unregister(tok);
});

test('dispose() stops the server (subsequent request fails to connect)', async (t) => {
    const server = new StreamServer();
    await server.start();
    const port = server.getPort();

    // Sanity: it's serving before dispose.
    const before = await request(port, { pathname: '/x' });
    assert.equal(before.statusCode, 404);

    server.dispose();

    // After dispose the listener is gone; connecting must error (ECONNREFUSED).
    await assert.rejects(
        () => request(port, { pathname: '/x' }),
        (err) => {
            assert.ok(err instanceof Error);
            // Connection refused (or reset) — anything but a successful HTTP reply.
            assert.ok(
                ['ECONNREFUSED', 'ECONNRESET'].includes(err.code),
                `expected a connection error, got ${err.code}`,
            );
            return true;
        },
    );
});
