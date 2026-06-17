# Security Policy

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, use one of these private channels:

- **GitHub** — open a private report via the repository's
  **Security → Report a vulnerability** tab
  ([Privately reporting a security vulnerability](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)).
- **Email** — `info@syncbloom.jp`.

Please include enough detail to reproduce: VS Code version, OS, the file/codec
involved, and a description of the impact. We aim to acknowledge a report within
**7 days** and to provide a remediation timeline after triage.

## Supported versions

This extension ships from `main`. Security fixes are released in the latest
published version; please upgrade to the newest version before reporting.

## Security model

The extension is designed to keep untrusted media at arm's length. Key
properties (see `src/streamServer.ts`, `src/audio.ts`, `src/playerEditorProvider.ts`):

- **Loopback-only media server.** Files are streamed from an HTTP server bound to
  `127.0.0.1` on an OS-assigned port. Paths are never exposed directly: a caller
  registers an absolute path and receives a 16-byte random token; only registered
  tokens are served.
- **Anti-DNS-rebinding.** Requests must carry the exact `Host: 127.0.0.1:<port>`
  the server listens on; anything else is rejected (`403`).
- **Strict Range parsing** with explicit handling of unsatisfiable ranges (`416`).
- **No shell.** `ffmpeg` is invoked with an argument array via `spawn` (never a
  shell string), so a file path can't inject a command.
- **Tight webview CSP.** `default-src 'none'`; scripts run only under a per-load
  nonce; media is restricted to the loopback origin.
- **Cache permissions.** Extracted audio is written under a private cache
  directory created `0o700` with files `0o600`.

### Workspace trust

Audio extraction runs `ffmpeg` over the file being opened. In an **untrusted**
workspace the extension does not spawn `ffmpeg`; the video plays muted until you
trust the workspace, after which audio is extracted. The extension is declared as
not supported in virtual workspaces (it needs a real on-disk path).

The `unmuteVideo.ffmpegPath` setting points at an executable and is therefore
**`machine`-scoped** — it can only be set in user/machine settings, never by a
workspace, so a cloned repository cannot redirect the extension to run an
arbitrary binary.

### Residual risk

`ffmpeg` parses untrusted media, so its decoders/demuxers are part of the trust
boundary. Keep `ffmpeg` up to date. Decoded audio is cached on disk under the
system temp directory and is not automatically purged on uninstall.
