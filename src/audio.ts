import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFile, spawn } from 'child_process';

/**
 * ffmpeg-based audio extraction, kept free of any `vscode` import so it can be
 * unit-tested directly against a real ffmpeg binary.
 */

const FFMPEG_CANDIDATES = [
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
    '/snap/bin/ffmpeg',
    'ffmpeg',
];
const CACHE_DIR = path.join(os.tmpdir(), 'unmute-video-cache');
const STDERR_TAIL_LIMIT = 16 * 1024;

/**
 * Cached discovery result, shared across the host session.
 *   undefined -> not yet probed
 *   null      -> probed, none found
 *   string    -> probed, this binary works
 */
let ffmpegCache: string | null | undefined = undefined;
let ffmpegCachePromise: Promise<string | null> | undefined;
const overrideFfmpegCache = new Map<string, string | null>();
const overrideFfmpegPromises = new Map<string, Promise<string | null>>();
const inFlightExtractions = new Map<string, Promise<string>>();

/** For tests: forget the cached probe result. */
export function resetFfmpegCache(): void {
    ffmpegCache = undefined;
    ffmpegCachePromise = undefined;
    overrideFfmpegCache.clear();
    overrideFfmpegPromises.clear();
}

/**
 * Decide whether a user-provided ffmpeg override path may be used.
 * Returns the trimmed override only when it is a non-empty ABSOLUTE path that
 * does NOT resolve inside any of the given workspace roots; otherwise undefined.
 * Belt-and-suspenders on top of the machine-scoped setting.
 */
export function resolveFfmpegOverride(
    override: string | undefined,
    workspaceRoots: string[],
): string | undefined {
    const trimmed = typeof override === 'string' ? override.trim() : '';
    if (trimmed === '' || !path.isAbsolute(trimmed)) {
        return undefined;
    }

    const resolvedOverride = normalizeResolvedPath(trimmed);
    for (const root of workspaceRoots) {
        const trimmedRoot = root.trim();
        if (trimmedRoot === '') {
            continue;
        }
        const resolvedRoot = normalizeResolvedPath(trimmedRoot);
        if (resolvedOverride === resolvedRoot || resolvedOverride.startsWith(ensureTrailingSeparator(resolvedRoot))) {
            return undefined;
        }
    }

    return trimmed;
}

/**
 * Best-effort: delete cached extracted-audio files older than maxAgeMs from the
 * private cache dir. Never throws (swallows all fs errors). Synchronous.
 */
export function pruneAudioCache(maxAgeMs = 7 * 24 * 60 * 60 * 1000): void {
    try {
        const cutoff = Date.now() - maxAgeMs;
        for (const entry of fs.readdirSync(CACHE_DIR)) {
            if (!/^unmute-audio-.*\.mp3$/.test(entry)) {
                continue;
            }
            const file = path.join(CACHE_DIR, entry);
            try {
                if (fs.statSync(file).mtimeMs < cutoff) {
                    fs.unlinkSync(file);
                }
            } catch {
                /* ignore */
            }
        }
    } catch {
        /* ignore */
    }
}

function normalizeResolvedPath(value: string): string {
    let resolved = path.resolve(value);
    try {
        // Canonicalize symlinks (and, on Windows, short/namespaced aliases like
        // 8.3 names or \\?\ prefixes) so the boundary check cannot be fooled by an
        // alias that names a workspace path without sharing its textual prefix.
        resolved = fs.realpathSync.native(resolved);
    } catch {
        // The path may not exist yet; fall back to the lexically-normalized form.
        resolved = path.normalize(resolved);
    }
    // macOS and Windows default to case-insensitive filesystems, so compare
    // case-insensitively there to avoid a case-only bypass of the boundary check.
    return process.platform === 'win32' || process.platform === 'darwin'
        ? resolved.toLowerCase()
        : resolved;
}

function ensureTrailingSeparator(value: string): string {
    return value.endsWith(path.sep) ? value : `${value}${path.sep}`;
}

/**
 * Locate a working ffmpeg binary. Tries common absolute paths and then a bare
 * `ffmpeg` from PATH; the first that responds to `-version` wins. The result
 * (including "not found") is cached.
 */
export async function findFfmpeg(override?: string): Promise<string | null> {
    const overridePath = typeof override === 'string' ? override.trim() : '';
    if (overridePath !== '') {
        const cached = overrideFfmpegCache.get(overridePath);
        if (cached !== undefined) {
            return cached;
        }
        const pending = overrideFfmpegPromises.get(overridePath);
        if (pending !== undefined) {
            return pending;
        }
        const promise = (async () => {
            if (await probeFfmpeg(overridePath)) {
                overrideFfmpegCache.set(overridePath, overridePath);
                return overridePath;
            }
            const fallback = await findFfmpeg();
            overrideFfmpegCache.set(overridePath, fallback);
            return fallback;
        })().finally(() => {
            overrideFfmpegPromises.delete(overridePath);
        });
        overrideFfmpegPromises.set(overridePath, promise);
        return promise;
    }

    if (ffmpegCache !== undefined) {
        return ffmpegCache;
    }
    if (ffmpegCachePromise !== undefined) {
        return ffmpegCachePromise;
    }
    ffmpegCachePromise = probeDefaultFfmpeg().finally(() => {
        ffmpegCachePromise = undefined;
    });
    return ffmpegCachePromise;
}

async function probeDefaultFfmpeg(): Promise<string | null> {
    for (const bin of FFMPEG_CANDIDATES) {
        if (await probeFfmpeg(bin)) {
            ffmpegCache = bin;
            return bin;
        }
    }
    ffmpegCache = null;
    return null;
}

function probeFfmpeg(bin: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        execFile(bin, ['-version'], { timeout: 5000 }, (err) => resolve(!err));
    });
}

/**
 * Extract the audio track of `input` into an MP3 in the private temp cache. The
 * output name is derived from the input path *and* its size+mtime, so editing a
 * file in place re-extracts instead of replaying stale audio. ffmpeg writes to a
 * temporary file that is renamed into place only on success, so a killed
 * extraction can never leave a partial file that a later open would reuse.
 */
export async function extractAudio(ffmpeg: string, input: string): Promise<string> {
    const stat = fs.statSync(input);
    const key = crypto
        .createHash('md5')
        .update(`${input}\0${stat.size}\0${stat.mtimeMs}`)
        .digest('hex')
        .slice(0, 16);
    const out = path.join(CACHE_DIR, `unmute-audio-${key}.mp3`);

    // Reuse a previously-extracted (complete) file if present.
    if (fs.existsSync(out)) {
        return out;
    }

    const inFlight = inFlightExtractions.get(key);
    if (inFlight !== undefined) {
        return inFlight;
    }

    const promise = extractAudioToCache(ffmpeg, input, key, out).finally(() => {
        inFlightExtractions.delete(key);
    });
    inFlightExtractions.set(key, promise);
    return promise;
}

async function extractAudioToCache(ffmpeg: string, input: string, key: string, out: string): Promise<string> {
    fs.mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });

    if (fs.existsSync(out)) {
        return out;
    }

    // The temp name keeps a .mp3 suffix AND we pass `-f mp3`, so ffmpeg's
    // extension-based muxer detection can never trip over the temp suffix.
    const tmpOut = path.join(CACHE_DIR, `unmute-audio-${key}.${crypto.randomBytes(4).toString('hex')}.part.mp3`);
    try {
        await runFfmpeg(ffmpeg, [
            '-nostdin',
            '-i', input,
            '-vn',
            '-c:a', 'libmp3lame',
            '-b:a', '192k',
            '-f', 'mp3',
            '-y', tmpOut,
        ]);
        fs.chmodSync(tmpOut, 0o600);
        fs.renameSync(tmpOut, out);
    } catch (err) {
        // Best-effort cleanup of the partial file.
        try {
            fs.unlinkSync(tmpOut);
        } catch {
            /* ignore */
        }
        throw err;
    }

    return out;
}

function runFfmpeg(ffmpeg: string, args: string[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        let stderrTail = '';
        let settled = false;
        let timedOut = false;

        // spawn with an arg array (no shell) avoids command injection from the file path.
        const child = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill();
            finish(makeFfmpegError('ffmpeg timed out after 120s', stderrTail));
        }, 120000);

        const finish = (err?: Error) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        };

        child.stderr.on('data', (chunk: Buffer) => {
            stderrTail += chunk.toString('utf8');
            if (stderrTail.length > STDERR_TAIL_LIMIT) {
                stderrTail = stderrTail.slice(-STDERR_TAIL_LIMIT);
            }
        });

        child.on('error', (err) => {
            finish(err);
        });

        child.on('close', (code, signal) => {
            if (timedOut) {
                return;
            }
            if (code === 0) {
                finish();
            } else {
                const suffix = signal ? `signal ${signal}` : `exit code ${code}`;
                finish(makeFfmpegError(`ffmpeg failed with ${suffix}`, stderrTail));
            }
        });
    });
}

function makeFfmpegError(message: string, stderr: string): Error {
    const detail = stderr.trim();
    const err = new Error(detail ? `${message}: ${detail}` : message);
    if (isNoAudioStderr(stderr)) {
        (err as any).noAudio = true;
    }
    return err;
}

function isNoAudioStderr(stderr: string): boolean {
    return /does not contain any stream|matches no streams|output file is empty/i.test(stderr);
}
