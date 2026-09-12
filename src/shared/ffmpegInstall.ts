/**
 * Where to get ffmpeg, per platform.
 *
 * MP4/MOV/M4V audio is extracted with ffmpeg, so a machine without it plays the
 * picture and stays silent — exactly the problem this extension exists to fix.
 * The status bar therefore needs to offer a way forward rather than pointing at
 * the README, and both ends need the same text: the webview shows the command,
 * the host copies it to the clipboard.
 *
 * Being free of `vscode` and DOM imports, this module is shared by the extension
 * host and the webview bundle (see src/shared/preferences.ts for the same shape)
 * and is unit-tested directly in Node via out/shared/ffmpegInstall.js.
 */

/** A platform-specific way to install ffmpeg. */
export interface FfmpegInstallHint {
    /** The command to run, e.g. `brew install ffmpeg`. */
    command: string;
    /** The package manager the command drives, e.g. `Homebrew`. */
    manager: string;
}

/**
 * The install hint for a Node `process.platform` value, or `null` when we have
 * no command we can stand behind for that platform.
 *
 * Returning `null` is deliberate: printing a command for the wrong OS costs the
 * user more than showing none, so callers fall back to the settings route
 * (`unmuteVideo.ffmpegPath`) instead of guessing. A fresh object is returned on
 * every call so neither caller can alias — and corrupt — the other's copy.
 */
export function ffmpegInstallHint(platform: string): FfmpegInstallHint | null {
    switch (platform) {
        case 'darwin':
            return { command: 'brew install ffmpeg', manager: 'Homebrew' };
        case 'win32':
            return { command: 'winget install Gyan.FFmpeg', manager: 'winget' };
        case 'linux':
            // Debian/Ubuntu. Other families differ, so the manager is named in
            // the UI rather than presented as the one true way.
            return { command: 'sudo apt install ffmpeg', manager: 'apt' };
        default:
            return null;
    }
}
