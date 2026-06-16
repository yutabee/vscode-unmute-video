import * as http from 'http';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as path from 'path';

/**
 * A tiny loopback-only HTTP server that streams registered files with HTTP Range
 * support. Files are exposed indirectly: callers register an absolute fs path and
 * receive an opaque token. Only registered tokens can be served, so the server
 * never exposes an arbitrary path on disk.
 *
 * Bodies are streamed with fs.createReadStream — files are never read fully into
 * memory, which keeps large video seeks cheap.
 */
export class StreamServer {
    private server: http.Server | undefined;
    private port = 0;

    /** token -> absolute fs path */
    private readonly tokenToPath = new Map<string, string>();
    /** fs path -> token, so register() is idempotent per path */
    private readonly pathToToken = new Map<string, string>();
    /**
     * token -> how many live holders share it. The same path can back several
     * editors at once (supportsMultipleEditorsPerDocument), so a token is only
     * really forgotten when the last holder unregisters it.
     */
    private readonly refCount = new Map<string, number>();

    /**
     * Create the HTTP server and start listening on an OS-assigned free port,
     * bound to the loopback interface only.
     */
    public start(): Promise<void> {
        return new Promise((resolve, reject) => {
            const server = http.createServer((req, res) => {
                this.handleRequest(req, res);
            });

            // Surface listen-time errors as a rejected promise.
            const onError = (err: Error) => {
                reject(err);
            };
            server.once('error', onError);

            // Port 0 => OS assigns a free port. Bind to 127.0.0.1 only.
            server.listen(0, '127.0.0.1', () => {
                server.removeListener('error', onError);
                const addr = server.address();
                if (addr && typeof addr === 'object') {
                    this.port = addr.port;
                }
                this.server = server;
                resolve();
            });
        });
    }

    public getPort(): number {
        return this.port;
    }

    /**
     * Register an absolute fs path and return an opaque hex token. Calling this
     * again with the same path returns the same token (idempotent).
     */
    public register(fsPath: string): string {
        const existing = this.pathToToken.get(fsPath);
        if (existing !== undefined) {
            this.refCount.set(existing, (this.refCount.get(existing) ?? 0) + 1);
            return existing;
        }
        // 16 random bytes -> 32 hex chars. Unguessable handle for the path.
        const token = crypto.randomBytes(16).toString('hex');
        this.tokenToPath.set(token, fsPath);
        this.pathToToken.set(fsPath, token);
        this.refCount.set(token, 1);
        return token;
    }

    /**
     * Release one hold on a token. The token (and its path mapping) is only
     * removed once the last holder releases it, so disposing one editor never
     * pulls the rug out from another editor still streaming the same file.
     */
    public unregister(token: string): void {
        const fsPath = this.tokenToPath.get(token);
        if (fsPath === undefined) {
            return;
        }
        const next = (this.refCount.get(token) ?? 1) - 1;
        if (next > 0) {
            this.refCount.set(token, next);
            return;
        }
        this.refCount.delete(token);
        this.tokenToPath.delete(token);
        this.pathToToken.delete(fsPath);
    }

    public urlFor(token: string): string {
        return `http://127.0.0.1:${this.port}/${token}`;
    }

    /** Close the server and forget every registered path. */
    public dispose(): void {
        if (this.server) {
            this.server.close();
            this.server = undefined;
        }
        this.tokenToPath.clear();
        this.pathToToken.clear();
        this.refCount.clear();
    }

    /** Map a file extension to a Content-Type the webview understands. */
    private contentTypeFor(fsPath: string): string {
        switch (path.extname(fsPath).toLowerCase()) {
            case '.mp4':
            case '.mov':
            case '.m4v':
                return 'video/mp4';
            case '.mp3':
                return 'audio/mpeg';
            default:
                return 'application/octet-stream';
        }
    }

    private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
        // Only GET/HEAD make sense for streaming.
        const method = req.method ?? 'GET';
        if (method !== 'GET' && method !== 'HEAD') {
            res.writeHead(405, { 'Allow': 'GET, HEAD' });
            res.end();
            return;
        }

        // Defense-in-depth against DNS-rebinding: only answer requests addressed
        // to the loopback host:port we actually listen on. Media elements set
        // Host to 127.0.0.1:<port>, so legitimate traffic always passes.
        const host = req.headers.host;
        if (host !== undefined && host !== `127.0.0.1:${this.port}`) {
            res.writeHead(403);
            res.end();
            return;
        }

        // The token is the first (and only meaningful) path segment.
        // Use a dummy base because req.url is path-only.
        let token: string;
        try {
            const parsed = new URL(req.url ?? '/', 'http://127.0.0.1');
            token = decodeURIComponent(parsed.pathname.replace(/^\/+/, '').split('/')[0] ?? '');
        } catch {
            res.writeHead(400);
            res.end();
            return;
        }

        const fsPath = this.tokenToPath.get(token);
        if (fsPath === undefined) {
            // Unknown token: never serve an arbitrary path.
            res.writeHead(404);
            res.end();
            return;
        }

        fs.stat(fsPath, (statErr, stat) => {
            if (statErr || !stat.isFile()) {
                // File vanished or is not a regular file.
                res.writeHead(404);
                res.end();
                return;
            }

            const total = stat.size;
            const contentType = this.contentTypeFor(fsPath);
            const rangeHeader = req.headers['range'];
            const range = this.parseRange(rangeHeader, total);

            if (range === 'invalid') {
                // Range requested but unsatisfiable.
                res.writeHead(416, {
                    'Content-Range': `bytes */${total}`,
                    'Accept-Ranges': 'bytes',
                });
                res.end();
                return;
            }

            if (range) {
                // Partial content.
                const { start, end } = range;
                const chunkSize = end - start + 1;
                res.writeHead(206, {
                    'Content-Type': contentType,
                    'Content-Length': String(chunkSize),
                    'Content-Range': `bytes ${start}-${end}/${total}`,
                    'Accept-Ranges': 'bytes',
                });
                if (method === 'HEAD') {
                    res.end();
                    return;
                }
                this.streamFile(fsPath, res, start, end);
                return;
            }

            // Full body.
            res.writeHead(200, {
                'Content-Type': contentType,
                'Content-Length': String(total),
                'Accept-Ranges': 'bytes',
            });
            if (method === 'HEAD' || total === 0) {
                // An empty file has no body to stream; createReadStream with
                // end=-1 would otherwise throw synchronously.
                res.end();
                return;
            }
            this.streamFile(fsPath, res, 0, total - 1);
        });
    }

    /**
     * Parse a single Range header of the form `bytes=start-end`.
     * Returns a {start,end} pair, undefined when no range is requested, or
     * 'invalid' when the range cannot be satisfied.
     */
    private parseRange(
        header: string | string[] | undefined,
        total: number,
    ): { start: number; end: number } | undefined | 'invalid' {
        if (header === undefined || Array.isArray(header)) {
            return undefined;
        }
        const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
        if (!match) {
            return undefined;
        }

        const startStr = match[1];
        const endStr = match[2];

        let start: number;
        let end: number;

        if (startStr === '' && endStr === '') {
            return 'invalid';
        }

        if (startStr === '') {
            // Suffix range: last N bytes.
            const suffixLen = parseInt(endStr, 10);
            if (suffixLen <= 0) {
                return 'invalid';
            }
            start = Math.max(0, total - suffixLen);
            end = total - 1;
        } else {
            start = parseInt(startStr, 10);
            end = endStr === '' ? total - 1 : parseInt(endStr, 10);
        }

        // Clamp end to the last byte.
        if (end > total - 1) {
            end = total - 1;
        }

        if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
            return 'invalid';
        }

        return { start, end };
    }

    /** Stream a byte range of a file to the response, handling stream errors. */
    private streamFile(fsPath: string, res: http.ServerResponse, start: number, end: number): void {
        if (end < start) {
            // Nothing to send (e.g. an empty range). Avoid an invalid stream range.
            res.end();
            return;
        }
        const stream = fs.createReadStream(fsPath, { start, end });
        stream.on('error', () => {
            // If headers are already sent we can only destroy the socket.
            if (!res.headersSent) {
                res.writeHead(500);
            }
            res.end();
            stream.destroy();
        });
        // If the client disconnects, stop reading.
        res.on('close', () => {
            stream.destroy();
        });
        stream.pipe(res);
    }
}
