import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFile } from 'child_process';

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

/**
 * Cached discovery result, shared across the host session.
 *   undefined -> not yet probed
 *   null      -> probed, none found
 *   string    -> probed, this binary works
 */
let ffmpegCache: string | null | undefined = undefined;

/** For tests: forget the cached probe result. */
export function resetFfmpegCache(): void {
    ffmpegCache = undefined;
}

/**
 * Locate a working ffmpeg binary. Tries common absolute paths and then a bare
 * `ffmpeg` from PATH; the first that responds to `-version` wins. The result
 * (including "not found") is cached.
 */
export async function findFfmpeg(): Promise<string | null> {
    if (ffmpegCache !== undefined) {
        return ffmpegCache;
    }
    for (const bin of FFMPEG_CANDIDATES) {
        const works = await new Promise<boolean>((resolve) => {
            execFile(bin, ['-version'], { timeout: 5000 }, (err) => resolve(!err));
        });
        if (works) {
            ffmpegCache = bin;
            return bin;
        }
    }
    ffmpegCache = null;
    return null;
}

/**
 * Extract the audio track of `input` into an MP3 in the OS temp dir. The output
 * name is derived from the input path *and* its size+mtime, so editing a file in
 * place re-extracts instead of replaying stale audio. ffmpeg writes to a
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
    const out = path.join(os.tmpdir(), `unmute-audio-${key}.mp3`);

    // Reuse a previously-extracted (complete) file if present.
    if (fs.existsSync(out)) {
        return out;
    }

    // The temp name keeps a .mp3 suffix AND we pass `-f mp3`, so ffmpeg's
    // extension-based muxer detection can never trip over the temp suffix.
    const tmpOut = path.join(os.tmpdir(), `unmute-audio-${key}.${crypto.randomBytes(4).toString('hex')}.part.mp3`);
    try {
        await new Promise<void>((resolve, reject) => {
            // execFile with an arg array (no shell) avoids command injection from
            // the file path. `-f mp3` forces the muxer regardless of filename.
            execFile(
                ffmpeg,
                ['-nostdin', '-i', input, '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', '-f', 'mp3', '-y', tmpOut],
                { timeout: 120000 },
                (err) => (err ? reject(err) : resolve()),
            );
        });
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
