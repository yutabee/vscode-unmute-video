# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/yutabee/vscode-unmute-video/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/yutabee/vscode-unmute-video/releases/tag/v0.1.0
