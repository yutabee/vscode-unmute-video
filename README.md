# Video Player (with Audio) — `vscode-unmute-video`

[![CI](https://github.com/yutabee/vscode-unmute-video/actions/workflows/ci.yml/badge.svg)](https://github.com/yutabee/vscode-unmute-video/actions/workflows/ci.yml)
[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/yutabee.unmute-video)](https://marketplace.visualstudio.com/items?itemName=yutabee.unmute-video)
[![Open VSX Version](https://img.shields.io/open-vsx/v/yutabee/unmute-video)](https://open-vsx.org/extension/yutabee/unmute-video)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE.md)

Play `.mp4` / `.mov` / `.m4v` videos **with sound** directly inside VS Code.

## Why this exists

VS Code's webview runs on the Electron/Chromium build that ships **without the
AAC codec** (patent licensing). So a normal `<video>` element shows the picture
but stays silent. This extension works around that:

1. The video stream is served from a tiny loopback HTTP server with HTTP Range
   support, so even large files play without being loaded into memory.
2. `ffmpeg` extracts the audio track to MP3 in the background.
3. The webview plays a **muted `<video>`** alongside a hidden `<audio>` element
   and keeps the two in sync (play/pause/seek/speed/volume).

## Requirements

- VS Code `^1.90.0`
- [`ffmpeg`](https://ffmpeg.org/) on your `PATH` (for audio).
  Without it the video still plays, but silent.
  - macOS: `brew install ffmpeg`
  - Ubuntu/Debian: `sudo apt install ffmpeg`
  - Windows: install ffmpeg and ensure `ffmpeg.exe` is reachable

## Install

- In VS Code, open the Extensions view and search for
  **Video Player (with Audio)**.
- Or use Quick Open and run `ext install yutabee.unmute-video`.
- For VSCodium, Cursor, and other [Open VSX](https://open-vsx.org/extension/yutabee/unmute-video) clients, install it from there.

## Usage

- Open any `.mp4` / `.mov` / `.m4v` file from the Explorer — it opens in the
  player automatically.
- Or run **"Open with Video Player (with Audio)"** from the Command Palette.

Controls: click the stage or use `space`/`k` to play-pause, `j`/`l` (or ←/→)
to seek ±10s, `m` to mute, the volume slider to adjust audio, `f` for
fullscreen, and `p` for picture-in-picture when the host supports it. The speed
button cycles 0.5×–2×. The action buttons copy the file path or open the file in
an external player.

## Default editor

The extension registers as the default editor for `.mp4`, `.mov`, and `.m4v`
files. To opt out for a file type or glob, map it back to the built-in editor in
`workbench.editorAssociations`:

```json
{
  "workbench.editorAssociations": {
    "*.mp4": "default",
    "*.mov": "default",
    "*.m4v": "default"
  }
}
```

## Limitations

- `ffmpeg` must be installed on the same machine as the extension host.
- In Remote-SSH, WSL, and Codespaces, the extension runs on the remote machine;
  `ffmpeg` and the video files need to be available there.
- Virtual and web workspaces are not supported because the player needs a real
  on-disk path.
- Without `ffmpeg`, the video still plays, but silently.

## Security

Media is streamed from a loopback-only, token-gated HTTP server with a strict
Host-header check. The webview uses a tight CSP, and `ffmpeg` is invoked without
a shell. See [SECURITY.md](SECURITY.md) for the disclosure process and full
security model.

## Develop

```bash
npm install
npm run compile      # compiles host (-> out/) and webview (-> media/player.js)
npm test             # StreamServer / audio unit tests (node:test, no deps)
npm run package      # build a .vsix via @vscode/vsce
```

The codebase is all TypeScript. The extension host compiles via `tsconfig.json`
to `out/`; the webview is bundled by esbuild from `src/webview/main.ts` into a
single `media/player.js` IIFE (a generated, git-ignored artifact) and type-checked
via `tsconfig.webview.json` (DOM lib). `npm run watch` / `npm run watch:webview`
watch each side.

Press <kbd>F5</kbd> ("Run Extension") to launch an Extension Development Host.

### Layout

| Path | Role |
| --- | --- |
| `src/extension.ts` | activation: start the stream server, register the editor + command |
| `src/streamServer.ts` | loopback HTTP server, token-gated, HTTP Range streaming |
| `src/playerEditorProvider.ts` | custom editor: webview wiring, video token, trust handling |
| `src/audioExtractionController.ts` | per-editor audio-extraction lifecycle (ffmpeg → mp3 → stream token) |
| `src/audio.ts` | ffmpeg discovery + audio extraction (no `vscode` import) |
| `src/protocol.ts` | host ↔ webview message types (type-only module), shared by both ends |
| `src/webview/` | in-webview player, bundled to `media/player.js`: `main.ts` (entry + wiring), `playerController.ts` (video/audio sync + drift), `seekbar.ts`, `dom.ts`, `status.ts`, `util.ts` (pure, unit-tested helpers) |
| `media/player.html` / `player.css` | webview markup + styles |

## License

MIT
