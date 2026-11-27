import * as vscode from 'vscode';
import { PlayerEditorProvider } from './editor/playerEditorProvider';
import { pruneAudioCache } from './media/audio';
import { VIDEO_EXTENSIONS } from './media/mediaFormat';

/**
 * Registers the custom video editor and the `unmuteVideo.open` command.
 */
export function activate(context: vscode.ExtensionContext): void {
    try {
        pruneAudioCache();
    } catch {
        /* ignore */
    }

    const provider = new PlayerEditorProvider(context);

    context.subscriptions.push(
        provider,
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
