import * as vscode from 'vscode';
import * as path from 'path';
import { StreamServer } from '../server/streamServer';
import { findFfmpeg, extractAudio, resolveFfmpegOverride } from '../media/audio';
import { ffmpegInstallHint } from '../shared/ffmpegInstall';
import type { Preferences } from '../shared/preferences';
import type { HostToWebview } from '../shared/protocol';

/**
 * Owns the asynchronous audio-extraction lifecycle for one open editor:
 * runs ffmpeg off the host, registers the resulting mp3 with the stream server,
 * and posts the right protocol message - guarding against an editor that closes
 * mid-extraction (no leaked token, no post to a dead webview).
 */
export class AudioExtractionController {
    private disposed = false;
    private started = false;
    private ffmpegMissing = false;
    private audioToken: string | undefined;

    constructor(
        private readonly server: StreamServer,
        private readonly fsPath: string,
        private readonly post: (message: HostToWebview) => void,
        private readonly getPreferences: () => Preferences,
        private readonly resumeTime = 0,
        private readonly seekStep = 10,
    ) {}

    /**
     * Begin extraction at most once, and never after dispose. `showPendingStatus`
     * posts the "Extracting…" init.
     */
    public start(showPendingStatus: boolean): void {
        if (this.disposed || this.started) {
            return;
        }
        this.started = true;

        if (showPendingStatus) {
            this.postInit(true, false);
        }

        void (async () => {
            const config = vscode.workspace.getConfiguration('unmuteVideo');
            const workspaceRoots = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
            const ffmpegOverride = resolveFfmpegOverride(config.get<string>('ffmpegPath'), workspaceRoots);
            const ffmpeg = await findFfmpeg(ffmpegOverride);
            if (this.disposed) {
                return;
            }

            if (ffmpeg === null) {
                this.ffmpegMissing = true;
                this.postInit(false, true);
                return;
            }

            try {
                const mp3Path = await extractAudio(ffmpeg, this.fsPath);
                const token = this.server.register(mp3Path);
                if (this.disposed) {
                    // Editor closed before extraction finished:
                    // release the token instead of leaking it.
                    this.server.unregister(token);
                    return;
                }
                this.audioToken = token;
                this.post({ type: 'audioSrc', url: this.server.urlFor(token) });
            } catch (err) {
                if (!this.disposed) {
                    this.post(hasNoAudioFlag(err) ? { type: 'audioNone' } : { type: 'audioError' });
                }
            }
        })().catch(() => {
            if (!this.disposed) {
                this.post({ type: 'audioError' });
            }
        });
    }

    /**
     * Whether the probe came back empty, i.e. the status bar is currently
     * offering the install hint. The host gates the clipboard action on this so
     * the webview cannot ask for a copy while no hint is on screen.
     */
    public isFfmpegMissing(): boolean {
        return this.ffmpegMissing;
    }

    /** Stop guarding posts and release the audio token if one was registered. */
    public dispose(): void {
        this.disposed = true;
        if (this.audioToken !== undefined) {
            this.server.unregister(this.audioToken);
            this.audioToken = undefined;
        }
    }

    private postInit(audioPending: boolean, ffmpegMissing: boolean): void {
        this.post({
            type: 'init',
            name: path.basename(this.fsPath),
            audioPending,
            ffmpegMissing,
            // Only resolved while ffmpeg is actually missing: the webview has no
            // use for it otherwise, and it keeps the platform out of the
            // messages the webview receives in the normal case.
            ffmpegInstall: ffmpegMissing ? ffmpegInstallHint(process.platform) : null,
            nativeAudio: false,
            resumeTime: this.resumeTime,
            preferences: this.getPreferences(),
            seekStep: this.seekStep,
        });
    }
}

const hasNoAudioFlag = (err: unknown): boolean =>
    typeof err === 'object' && err !== null && (err as { noAudio?: unknown }).noAudio === true;
