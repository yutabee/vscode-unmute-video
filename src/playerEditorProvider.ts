import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { StreamServer } from './streamServer';

/**
 * Custom editor that plays .mp4/.mov/.m4v files WITH sound inside VS Code.
 *
 * The webview's Chromium build cannot decode AAC, so the <video> is played muted
 * and a separately-extracted MP3 (via ffmpeg on the host) is played in sync as
 * the audible track. Both media files are streamed from a loopback HTTP server.
 */
export class PlayerEditorProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'unmuteVideo.viewer';

    /**
     * Cached ffmpeg discovery result.
     *   undefined -> not yet probed
     *   null      -> probed, none found
     *   string    -> probed, this binary works
     */
    private static ffmpegPath: string | null | undefined = undefined;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly server: StreamServer,
    ) {}

    public openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
        // This editor is read-only, so the document is just the uri plus a no-op
        // dispose.
        return {
            uri,
            dispose(): void {
                /* nothing to clean up */
            },
        };
    }

    public async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
    ): Promise<void> {
        const fsPath = document.uri.fsPath;
        const mediaDir = vscode.Uri.joinPath(this.context.extensionUri, 'media');
        const webview = webviewPanel.webview;

        webview.options = {
            enableScripts: true,
            localResourceRoots: [mediaDir],
        };

        // Register the video with the streaming server.
        const videoToken = this.server.register(fsPath);
        const videoUrl = this.server.urlFor(videoToken);
        // The audio token is created later, only if ffmpeg succeeds.
        let audioToken: string | undefined;
        // Audio extraction is async and may resolve after the editor closes;
        // this guards against leaking a token or posting to a dead webview.
        let disposed = false;

        webview.html = this.buildHtml(webview, mediaDir);

        // Probe ffmpeg up front (cached) so we can tell the webview whether to
        // expect an audio track at all.
        const ffmpeg = await PlayerEditorProvider.findFfmpeg();

        const messageListener = webview.onDidReceiveMessage(async (message: any) => {
            if (!message || typeof message.type !== 'string') {
                return;
            }

            switch (message.type) {
                case 'ready': {
                    webview.postMessage({
                        type: 'init',
                        name: path.basename(fsPath),
                        audioPending: ffmpeg !== null,
                        ffmpegMissing: ffmpeg === null,
                    });
                    webview.postMessage({ type: 'videoSrc', url: videoUrl });

                    if (ffmpeg !== null) {
                        // Extract (or reuse) the MP3 in the background; never block
                        // the video from starting.
                        this.extractAudio(ffmpeg, fsPath)
                            .then((mp3Path) => {
                                const token = this.server.register(mp3Path);
                                if (disposed) {
                                    // Editor closed before extraction finished:
                                    // release the token instead of leaking it.
                                    this.server.unregister(token);
                                    return;
                                }
                                audioToken = token;
                                webview.postMessage({
                                    type: 'audioSrc',
                                    url: this.server.urlFor(token),
                                });
                            })
                            .catch(() => {
                                if (!disposed) {
                                    webview.postMessage({ type: 'audioError' });
                                }
                            });
                    }
                    break;
                }

                case 'error': {
                    const text = typeof message.message === 'string' ? message.message : 'Unknown error';
                    vscode.window.showErrorMessage(`Unmute Video: ${text}`);
                    break;
                }

                case 'action': {
                    if (message.name === 'openExternal') {
                        void vscode.env.openExternal(document.uri);
                    } else if (message.name === 'copyPath') {
                        void vscode.env.clipboard.writeText(fsPath);
                        void vscode.window.showInformationMessage('Unmute Video: file path copied to clipboard.');
                    }
                    break;
                }

                default:
                    break;
            }
        });

        webviewPanel.onDidDispose(() => {
            disposed = true;
            messageListener.dispose();
            this.server.unregister(videoToken);
            if (audioToken !== undefined) {
                this.server.unregister(audioToken);
            }
        });
    }

    /**
     * Read media/player.html and substitute the CSP / nonce / style / script
     * tokens. The CSP must exactly match what the contract specifies so the
     * webview can load media from the loopback server.
     */
    private buildHtml(webview: vscode.Webview, mediaDir: vscode.Uri): string {
        const htmlPath = vscode.Uri.joinPath(mediaDir, 'player.html').fsPath;
        const template = fs.readFileSync(htmlPath, 'utf8');

        const nonce = crypto.randomBytes(16).toString('hex');
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaDir, 'player.css'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaDir, 'player.js'));
        const cspSource = webview.cspSource;
        const port = this.server.getPort();

        const csp = [
            "default-src 'none'",
            `img-src ${cspSource} data:`,
            `style-src ${cspSource} 'unsafe-inline'`,
            `font-src ${cspSource}`,
            `script-src 'nonce-${nonce}'`,
            `media-src http://127.0.0.1:${port}`,
        ].join('; ');

        return template
            .replace(/{{CSP}}/g, csp)
            .replace(/{{NONCE}}/g, nonce)
            .replace(/{{STYLE}}/g, styleUri.toString())
            .replace(/{{SCRIPT}}/g, scriptUri.toString());
    }

    /**
     * Locate a working ffmpeg binary. Tries a list of common absolute paths and
     * then a bare `ffmpeg` from PATH; the first that responds to `-version` wins.
     * The result (including "not found") is cached statically.
     */
    private static async findFfmpeg(): Promise<string | null> {
        if (PlayerEditorProvider.ffmpegPath !== undefined) {
            return PlayerEditorProvider.ffmpegPath;
        }

        const candidates = [
            '/opt/homebrew/bin/ffmpeg',
            '/usr/local/bin/ffmpeg',
            '/usr/bin/ffmpeg',
            '/snap/bin/ffmpeg',
            'ffmpeg',
        ];

        for (const bin of candidates) {
            const works = await new Promise<boolean>((resolve) => {
                execFile(bin, ['-version'], { timeout: 5000 }, (err) => {
                    resolve(!err);
                });
            });
            if (works) {
                PlayerEditorProvider.ffmpegPath = bin;
                return bin;
            }
        }

        PlayerEditorProvider.ffmpegPath = null;
        return null;
    }

    /**
     * Extract the audio track of `input` into an MP3 in the OS temp dir. The
     * output name is derived from the input path *and* its size+mtime, so editing
     * a file in place re-extracts instead of replaying stale audio. ffmpeg writes
     * to a temporary name that is renamed into place only on success, so a killed
     * extraction can never leave a partial file that a later open would reuse.
     */
    private async extractAudio(ffmpeg: string, input: string): Promise<string> {
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

        const tmpOut = `${out}.${crypto.randomBytes(4).toString('hex')}.part`;
        try {
            await new Promise<void>((resolve, reject) => {
                // execFile with an arg array (no shell) avoids command injection
                // from the file path.
                execFile(
                    ffmpeg,
                    ['-nostdin', '-i', input, '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', '-y', tmpOut],
                    { timeout: 120000 },
                    (err) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    },
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
}
