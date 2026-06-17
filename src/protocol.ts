/**
 * Message protocol shared by the extension host (playerEditorProvider) and the
 * webview controller (webview/*) — the single source of truth for the
 * postMessage boundary.
 *
 * The webview bundle is produced by esbuild, so both ends can `import type`
 * these definitions as a normal module. Being type-only, this module emits no
 * runtime JavaScript (esbuild drops it from the bundle; tsc emits an empty
 * `out/protocol.js` on the host side).
 */

/** Messages the extension host sends to the webview. */
export type HostToWebview =
    | { type: 'init'; name: string; audioPending: boolean; ffmpegMissing: boolean; nativeAudio: boolean }
    | { type: 'videoSrc'; url: string }
    | { type: 'audioSrc'; url: string }
    | { type: 'audioNone' }
    | { type: 'audioError' }
    | { type: 'audioUntrusted' };

/** Actions the webview can ask the host to perform. */
export type WebviewAction = 'openExternal' | 'copyPath';

/** Messages the webview sends to the extension host. */
export type WebviewToHost =
    | { type: 'ready' }
    | { type: 'error'; message: string }
    | { type: 'action'; name: WebviewAction };
