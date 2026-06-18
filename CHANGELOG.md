# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Marketplace listing: expanded `keywords` (now covering "sound", "no sound",
  "aac", "mute", and common format terms), added WebM to the display name and
  description, and led the description with the in-sync-audio value proposition.
- README restructured as a listing page: a demo GIF and a benefit/feature list
  now sit above the fold, with a supported-formats table; the codec deep-dive
  moved down to a "How it works" section.

### Packaging

- Excluded scratch (`.playwright-mcp/`) and the README demo GIF from the
  published `.vsix` (the GIF is served from the repo via a raw URL instead).

## [0.2.2] - 2026-06-18

### Added

- The "ffmpeg not found" and "workspace not trusted" notices are now actionable:
  a button opens the relevant Settings entry or the Workspace Trust editor.
- The video stage shows a buffering spinner while playback stalls and an error
  overlay when a video fails to play.

### Changed

- The player follows the active VS Code color theme, including High Contrast, and
  the control bar wraps onto multiple rows in narrow editors instead of clipping.
- Improved screen-reader support: the seek bar announces a live timestamp and
  transient status messages are exposed to assistive technology.

### Fixed

- Fixed the play/pause button occasionally drawing two overlapping icons.
- The buffering spinner no longer lingers over a paused or finished video, where
  it could look like the player had frozen.

## [0.2.1] - 2026-06-17

### Fixed

- Fixed `.mp4` / `.mov` playback stalling and audio dropping out: the extracted
  audio is now normalized to the video timeline so it no longer carries a
  constant offset, and drift is corrected by gently nudging playback speed
  instead of re-seeking the audio on every frame — which had turned a steady
  offset into a continuous re-seek and a buffering feedback loop.
- Audio and video now wait for each other through buffering: when the audio
  track underruns, the video holds instead of running ahead into silence, and
  both resume together once the audio is ready again.
- Audio resume now waits until the track is actually buffered before starting,
  so it no longer stalls and re-drifts immediately after a seek or recovery.
- Real audio playback failures (decode / format / network) are now surfaced as a
  status message instead of being silently swallowed, so the cause of silence is
  visible.

## [0.2.0] - 2026-06-17

### Added

- Play `.webm` files using the video element's own audio track (no separate
  ffmpeg extraction needed for natively-decodable formats).
- Auto-detect a same-name `.srt` / `.vtt` sidecar next to the video and show it
  as a toggleable subtitle track (`CC` button / `c` key). `.srt` is converted to
  WebVTT on the fly.
- Remember the last playback position per video and resume from it on reopen
  (restarts from the beginning when you were within the final few seconds).
- Persist volume, mute, and playback speed across videos and sessions.
- A-B segment loop and whole-clip loop: mark an A point and a B point to loop a
  region (`[` / `]` keys), or toggle looping the whole clip (`\` key).
- Frame-by-frame stepping with `,` / `.`, and a new `unmuteVideo.seekStep`
  setting to configure the J/L and arrow-key seek width (default 10s).

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

[Unreleased]: https://github.com/yutabee/vscode-unmute-video/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/yutabee/vscode-unmute-video/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/yutabee/vscode-unmute-video/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/yutabee/vscode-unmute-video/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/yutabee/vscode-unmute-video/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/yutabee/vscode-unmute-video/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/yutabee/vscode-unmute-video/releases/tag/v0.1.0
