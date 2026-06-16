# Changelog

## 0.1.0

- Initial release.
- Custom editor for `.mp4` / `.mov` / `.m4v`.
- Loopback HTTP server with Range support for streaming large files.
- ffmpeg-based audio extraction (MP3) synced to the muted video, working around
  the missing AAC codec in the VS Code webview.
- Player UI: play/pause, seek, 10s skip, volume/mute, playback speed,
  picture-in-picture, hold-to-2× boost, keyboard shortcuts, copy path,
  open in external player.
