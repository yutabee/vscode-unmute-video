import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { StreamServer } from './streamServer';
import { findFfmpeg, extractAudio } from './audio';

/**
 * Custom editor that plays .mp4/.mov/.m4v files WITH sound inside VS Code.
 *
 * The webview's Chromium build cannot decode AAC, so the <video> is played muted
 * and a separately-extracted MP3 (via ffmpeg on the host) is played in sync as
 * the audible track. Both media files are streamed from a loopback HTTP server.
 */
export class PlayerEditorProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'unmuteVideo.viewer';

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
        let handledReady = false;

        const ffmpegOverride = vscode.workspace
            .getConfiguration('unmuteVideo')
            .get<string>('ffmpegPath');
        const ffmpegPromise = findFfmpeg(ffmpegOverride);

        const messageListener = webview.onDidReceiveMessage(async (message: any) => {
            if (!message || typeof message.type !== 'string') {
                return;
            }

            switch (message.type) {
                case 'ready': {
                    if (handledReady) {
                        return;
                    }
                    handledReady = true;
                    const ffmpeg = await ffmpegPromise;
                    if (disposed) {
                        return;
                    }
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
                        extractAudio(ffmpeg, fsPath)
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
                            .catch((err) => {
                                if (!disposed) {
                                    webview.postMessage({ type: err && err.noAudio === true ? 'audioNone' : 'audioError' });
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

        webview.html = this.buildHtml(webview, mediaDir);
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
}
