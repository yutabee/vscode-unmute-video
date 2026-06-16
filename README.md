# Video Player (with Audio) — `vscode-unmute-video`

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

## Usage

- Open any `.mp4` / `.mov` / `.m4v` file from the Explorer — it opens in the
  player automatically.
- Or run **"Open with Video Player (with Audio)"** from the Command Palette.

Controls: `space`/`k` play-pause, `j`/`l` (or ←/→) seek ±10s, `m` mute,
`f` fullscreen, `p` picture-in-picture; the speed button cycles 0.5×–2×.

## Develop

```bash
npm install
npm run compile      # compiles host (-> out/) and webview (-> media/player.js)
npm test             # StreamServer / audio unit tests (node:test, no deps)
npm run package      # build a .vsix via @vscode/vsce
```

The codebase is all TypeScript. The extension host compiles via `tsconfig.json`
to `out/`; the webview script compiles via `tsconfig.webview.json` (DOM lib) from
`src/webview/player.ts` to `media/player.js` (a generated, git-ignored artifact).
`npm run watch` / `npm run watch:webview` watch each side.

Press <kbd>F5</kbd> ("Run Extension") to launch an Extension Development Host.

### Layout

| Path | Role |
| --- | --- |
| `src/extension.ts` | activation: start the stream server, register the editor + command |
| `src/streamServer.ts` | loopback HTTP server, token-gated, HTTP Range streaming |
| `src/playerEditorProvider.ts` | custom editor: ffmpeg audio extraction, webview wiring |
| `src/audio.ts` | ffmpeg discovery + audio extraction (no `vscode` import) |
| `src/protocol.ts` | host ↔ webview message types, shared by both ends |
| `src/webview/player.ts` | in-webview player UI + audio/video sync (compiles to `media/player.js`) |
| `media/player.html` / `player.css` | webview markup + styles |

## License

MIT
