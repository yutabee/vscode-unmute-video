# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.2] - 2026-06-17

### Changed

- Internal refactor (no behaviour change): the webview is now bundled by esbuild
  from `src/webview/main.ts`, and the 575-line player script is split into focused
  modules (`playerController`, `seekbar`, `dom`, `status`, `util`). The shared
  message protocol moved from a global ambient `.d.ts` to a type-only module, the
  two ffmpeg-probe caches were unified into one memoizer, and the audio-extraction
  lifecycle moved into `AudioExtractionController`.
- Expanded the test suite (pure webview helpers, ffmpeg-cache probe behaviour, and
  the audio-extraction lifecycle) to lock the refactor in place.

## [0.1.1] - 2026-06-17

### Fixed

- Corrected the copyright holder in the bundled `LICENSE`.

### Changed

- Security and Code of Conduct reports now go through GitHub's private reporting
  instead of an email address.

## [0.1.0] - 2026-06-17

### Added

- Initial release.
- Custom editor for `.mp4` / `.mov` / `.m4v`.
- Loopback HTTP server with Range support for streaming large files.
- ffmpeg-based audio extraction (MP3) synced to the muted video, working around
  the missing AAC codec in the VS Code webview.
- Player UI: play/pause, seek, 10s skip, volume/mute, playback speed,
  picture-in-picture, fullscreen, keyboard shortcuts, copy path, and open in
  external player.

### Security

- Audio extraction (which runs `ffmpeg`) only happens in trusted workspaces; the
  video plays muted until the workspace is trusted.
- The `unmuteVideo.ffmpegPath` setting is machine-scoped, so a workspace cannot
  redirect the extension to an arbitrary executable.

[Unreleased]: https://github.com/yutabee/vscode-unmute-video/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/yutabee/vscode-unmute-video/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/yutabee/vscode-unmute-video/releases/tag/v0.1.0
