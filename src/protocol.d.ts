/**
 * Message protocol shared by the extension host (playerEditorProvider) and the
 * webview controller (webview/player) — the single source of truth for the
 * postMessage boundary.
 *
 * This file has no top-level `import`/`export`, so its declarations are GLOBAL
 * ambient types. Both ends reference them without importing, which keeps the
 * compiled webview script a plain classic `<script>` (an `import` would turn it
 * into a module and force a `type="module"` load). Being a `.d.ts`, it emits no
 * JavaScript on either side.
 */

/** Messages the extension host sends to the webview. */
type HostToWebview =
    | { type: 'init'; name: string; audioPending: boolean; ffmpegMissing: boolean }
    | { type: 'videoSrc'; url: string }
    | { type: 'audioSrc'; url: string }
    | { type: 'audioNone' }
    | { type: 'audioError' }
    | { type: 'audioUntrusted' };

/** Actions the webview can ask the host to perform. */
type WebviewAction = 'openExternal' | 'copyPath';

/** Messages the webview sends to the extension host. */
type WebviewToHost =
    | { type: 'ready' }
    | { type: 'error'; message: string }
    | { type: 'action'; name: WebviewAction };
