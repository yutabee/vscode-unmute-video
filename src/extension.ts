import * as vscode from 'vscode';
import { StreamServer } from './streamServer';
import { PlayerEditorProvider } from './playerEditorProvider';
import { pruneAudioCache } from './audio';
import { VIDEO_EXTENSIONS } from './mediaFormat';

/**
 * Extension entry point. Starts the loopback streaming server, registers the
 * custom video editor, and wires up the `unmuteVideo.open` command.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    try {
        pruneAudioCache();
    } catch {
        /* ignore */
    }

    // One streaming server shared by all open editors.
    const server = new StreamServer();
    context.subscriptions.push({
        dispose: () => server.dispose(),
    });
    try {
        await server.start();
    } catch (err) {
        // Don't hard-fail activation (which would leave the file in a bare text
        // editor with no explanation). Surface the error; playback stays
        // unavailable until the window is reloaded.
        const detail = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`Unmute Video: failed to start the media server — ${detail}. Reload the window to retry.`);
    }

    const provider = new PlayerEditorProvider(context, server);

    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(
            PlayerEditorProvider.viewType,
            provider,
            {
                webviewOptions: { retainContextWhenHidden: true },
                supportsMultipleEditorsPerDocument: true,
            },
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('unmuteVideo.open', async (uri?: vscode.Uri) => {
            let target = uri;

            // Invoked from the command palette (no uri): ask the user to pick a file.
            if (!target) {
                const picked = await vscode.window.showOpenDialog({
                    canSelectMany: false,
                    // Derive from the single source of truth (drop the leading dot).
                    filters: { Video: VIDEO_EXTENSIONS.map((ext) => ext.slice(1)) },
                });
                if (!picked || picked.length === 0) {
                    return;
                }
                target = picked[0];
            }

            await vscode.commands.executeCommand(
                'vscode.openWith',
                target,
                PlayerEditorProvider.viewType,
            );
        }),
    );
}

export function deactivate(): void {
    /* nothing to clean up beyond context.subscriptions */
}
