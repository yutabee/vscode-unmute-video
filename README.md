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
npm run compile      # or: npm run watch
npm test             # StreamServer unit tests (node:test, no deps)
npm run package      # build a .vsix via @vscode/vsce
```

Press <kbd>F5</kbd> ("Run Extension") to launch an Extension Development Host.

### Layout

| Path | Role |
| --- | --- |
| `src/extension.ts` | activation: start the stream server, register the editor + command |
| `src/streamServer.ts` | loopback HTTP server, token-gated, HTTP Range streaming |
| `src/playerEditorProvider.ts` | custom editor: ffmpeg audio extraction, webview wiring |
| `media/player.html` / `player.css` / `player.js` | the in-webview player UI + audio/video sync |

## License

MIT
