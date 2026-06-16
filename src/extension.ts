import * as vscode from 'vscode';
import { StreamServer } from './streamServer';
import { PlayerEditorProvider } from './playerEditorProvider';

/**
 * Extension entry point. Starts the loopback streaming server, registers the
 * custom video editor, and wires up the `unmuteVideo.open` command.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    // One streaming server shared by all open editors.
    const server = new StreamServer();
    await server.start();
    context.subscriptions.push({
        dispose: () => server.dispose(),
    });

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
                    filters: { Video: ['mp4', 'mov', 'm4v'] },
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
