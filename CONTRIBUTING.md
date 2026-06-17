# Contributing

Thanks for your interest in improving **Video Player (with Audio)**. This is a
small, focused VS Code extension — contributions of any size are welcome.

## Prerequisites

- [Node.js](https://nodejs.org/) 20 or newer (the extension host itself runs on
  Node 18, which is the `@types/node` target; CI builds on 20 and 22).
- [`ffmpeg`](https://ffmpeg.org/) on your `PATH` — required to run the audio
  tests and to exercise audio extraction locally.
  - macOS: `brew install ffmpeg`
  - Ubuntu/Debian: `sudo apt install ffmpeg`
  - Windows: install ffmpeg and ensure `ffmpeg.exe` is reachable

## Setup

```bash
npm install
npm run compile   # host -> out/, webview -> media/player.js
npm test          # node:test unit tests (StreamServer + audio)
```

Press <kbd>F5</kbd> ("Run Extension") to launch an Extension Development Host
with the extension loaded, then open a `.mp4` / `.mov` / `.m4v` file.

### Generated artifacts — do not commit

`media/player.js` is **compiled** from `src/webview/player.ts` and is
**git-ignored**. Never commit it. The build (and `vsce`'s `vscode:prepublish`)
regenerates it. If you see it in `git status`, your `.gitignore` is fine — git
just isn't tracking it; leave it out of commits and PRs.

## Project layout

| Path | Role |
| --- | --- |
| `src/extension.ts` | activation: start the stream server, register the editor + command |
| `src/streamServer.ts` | loopback HTTP server, token-gated, HTTP Range streaming |
| `src/playerEditorProvider.ts` | custom editor: ffmpeg audio extraction, webview wiring |
| `src/audio.ts` | ffmpeg discovery + audio extraction (no `vscode` import, unit-testable) |
| `src/protocol.d.ts` | host ↔ webview message types (global ambient), shared by both ends |
| `src/webview/player.ts` | in-webview player UI + audio/video sync (compiles to `media/player.js`) |
| `media/player.html`, `player.css` | webview markup + styles |

## Making a change

1. **Fork** the repo and create a feature branch:
   `feat/short-description`, `fix/short-description`, or `chore/...`.
2. Keep each PR to **one logical change**. Smaller is easier to review.
3. Before pushing, make sure the gate is green:
   ```bash
   npm run compile
   npm test
   ```
   CI runs the same build + tests on Node 20 and 22 and packages a `.vsix`, plus
   a lint pass — your PR must pass all of these.
4. Update `README.md` / `CHANGELOG.md` when behavior changes. New entries go
   under the `## [Unreleased]` heading in the changelog.
5. Open a PR against `main`. Fill in the PR template checklist.

## Tests

- `test/streamServer.test.js` — HTTP server: Range, refcounting, Host header, etc.
- `test/audio.test.js` — real ffmpeg extraction (self-skips when ffmpeg is absent).
- `test/audioFixes.test.js` — regression tests for prior review findings.

Tests are plain `node:test` with no extra dependencies. When you fix a bug, add a
regression test that fails before your fix and passes after.

## Security

Please **do not** open public issues for security vulnerabilities — see
[SECURITY.md](SECURITY.md) for the private disclosure process. The extension runs
a loopback HTTP server and spawns `ffmpeg` on user files, so security reports are
taken seriously.

## Releasing (maintainers)

Releases are automated by `.github/workflows/release.yml`: pushing an annotated
`vX.Y.Z` tag builds, publishes to the VS Code Marketplace and Open VSX, and
attaches the `.vsix` to a GitHub Release. See [docs/PUBLISHING.md](docs/PUBLISHING.md)
for the one-time secret setup and the step-by-step release process.
