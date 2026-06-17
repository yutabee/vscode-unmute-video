import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { StreamServer } from './streamServer';
import { AudioExtractionController } from './audioExtractionController';
import { isNativeAudioFormat } from './mediaFormat';
import type { HostToWebview, WebviewToHost } from './protocol';

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
        const nativeAudio = isNativeAudioFormat(fsPath);
        const mediaDir = vscode.Uri.joinPath(this.context.extensionUri, 'media');
        const webview = webviewPanel.webview;

        webview.options = {
            enableScripts: true,
            localResourceRoots: [mediaDir],
        };

        // Register the video with the streaming server.
        const videoToken = this.server.register(fsPath);
        const videoUrl = this.server.urlFor(videoToken);
        let handledReady = false;
        let trustListener: vscode.Disposable | undefined;

        // Outgoing messages are checked against the shared protocol type.
        const post = (message: HostToWebview): void => {
            void webview.postMessage(message);
        };

        const audio = nativeAudio ? null : new AudioExtractionController(this.server, fsPath, post);

        const postInit = (audioPending: boolean, ffmpegMissing: boolean, initNativeAudio: boolean): void => {
            post({
                type: 'init',
                name: path.basename(fsPath),
                audioPending,
                ffmpegMissing,
                nativeAudio: initNativeAudio,
            });
        };

        const messageListener = webview.onDidReceiveMessage(async (message: WebviewToHost) => {
            if (!message || typeof message.type !== 'string') {
                return;
            }

            switch (message.type) {
                case 'ready': {
                    if (handledReady) {
                        return;
                    }
                    handledReady = true;
                    if (nativeAudio) {
                        postInit(false, false, true);
                        post({ type: 'videoSrc', url: videoUrl, nativeAudio: true });
                        return;
                    }

                    const trusted = vscode.workspace.isTrusted;
                    postInit(trusted, false, false);
                    post({ type: 'videoSrc', url: videoUrl, nativeAudio: false });

                    if (trusted) {
                        audio?.start(false);
                    } else {
                        post({ type: 'audioUntrusted' });
                        // start() is a no-op after dispose, so no extra guard here.
                        trustListener = vscode.workspace.onDidGrantWorkspaceTrust(() => {
                            audio?.start(true);
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
            audio?.dispose();
            messageListener.dispose();
            if (trustListener !== undefined) {
                trustListener.dispose();
            }
            this.server.unregister(videoToken);
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
            `style-src ${cspSource}`,
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
