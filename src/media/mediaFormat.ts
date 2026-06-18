import * as path from 'path';

/** Container extensions this extension opens as video. */
export const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm'] as const;

/**
 * True for formats whose audio the VS Code (Chromium) webview can decode and play
 * natively from the <video> element — currently only .webm (VP8/VP9 + Vorbis/Opus).
 * These skip the ffmpeg->mp3 sidecar and play the video UNMUTED. The other containers
 * carry AAC, which the codec-less Chromium build cannot decode, so they stay muted and
 * rely on a separate extracted mp3.
 */
export function isNativeAudioFormat(fsPath: string): boolean {
    return path.extname(fsPath).toLowerCase() === '.webm';
}
