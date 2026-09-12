"use strict";

import type { HostToWebview, WebviewToHost } from "../shared/protocol";

import { els } from "./dom";
import { PlayerController } from "./playerController";
import { Seekbar } from "./seekbar";
import { clearStatus, setStatusActions, showStatus, statusActionAt } from "./status";

declare function acquireVsCodeApi(): {
  postMessage(message: WebviewToHost): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

const controller = new PlayerController(function (message) {
  vscode.postMessage(message);
});
const seekbar = new Seekbar(controller);
controller.setScrubProvider(function () {
  return seekbar.isScrubbing();
});

// ----- Message handling -----
window.addEventListener("message", function (event: MessageEvent<HostToWebview>) {
  const msg = event.data;
  if (!msg || typeof msg.type !== "string") {
    return;
  }

  switch (msg.type) {
    case "init":
      els.fileLabel.textContent = msg.name || "";
      els.fileLabel.title = msg.name || "";
      controller.setResumeTime(msg.resumeTime || 0);
      controller.setNativeAudio(!!msg.nativeAudio);
      controller.setSeekStep(msg.seekStep);
      controller.applyPreferences(msg.preferences);
      if (msg.audioPending) {
        showStatus("Extracting audio…", "loading");
      } else if (msg.ffmpegMissing) {
        // The host caches the "not found" probe for the life of the extension
        // host, so installing ffmpeg only takes effect after a window reload —
        // reopening the file would look like the fix did nothing.
        const hint = msg.ffmpegInstall;
        if (hint) {
          showStatus(
            `Audio needs ffmpeg, which wasn't found. Install it with ${hint.manager} (${hint.command}), then reload the window.`,
            "warning",
          );
          setStatusActions([
            { label: "Copy command", action: "copyFfmpegCommand" },
            { label: "Open settings", action: "openFfmpegSettings" },
          ]);
        } else {
          showStatus(
            "Audio needs ffmpeg, which wasn't found. Install it (see README) or set its path in Settings, then reload the window.",
            "warning",
          );
          setStatusActions([{ label: "Open settings", action: "openFfmpegSettings" }]);
        }
      } else {
        clearStatus();
      }
      break;

    case "videoSrc":
      // Assign directly so the media element streams via HTTP Range.
      controller.attachVideo(msg.url, !!msg.nativeAudio);
      break;

    case "subtitles":
      controller.attachSubtitles(msg.vtt, msg.label);
      break;

    case "audioSrc":
      controller.attachAudio(msg.url);
      break;

    case "audioNone":
      showStatus("No audio track", "info");
      break;

    case "audioError":
      showStatus("Audio extraction failed", "warning");
      break;

    case "audioUntrusted":
      showStatus("Audio is disabled because this workspace isn't trusted.", "warning");
      setStatusActions([{ label: "Trust workspace", action: "trustWorkspace" }]);
      break;
  }
});

// ----- Control wiring -----
els.playBtn.addEventListener("click", function () {
  controller.togglePlay();
});
els.stage.addEventListener("click", function () {
  controller.togglePlay();
});

els.back10Btn.addEventListener("click", function () {
  controller.nudge(-controller.getSeekStep());
});
els.fwd10Btn.addEventListener("click", function () {
  controller.nudge(controller.getSeekStep());
});

els.loopBtn.addEventListener("click", function () {
  controller.toggleWholeLoop();
});
els.setABtn.addEventListener("click", function () {
  controller.setLoopA();
});
els.setBBtn.addEventListener("click", function () {
  controller.setLoopB();
});

els.muteBtn.addEventListener("click", function () {
  controller.toggleMute();
});
els.volSlider.addEventListener("input", function () {
  controller.onVolumeInput();
});

els.speedBtn.addEventListener("click", function () {
  controller.cycleSpeed();
});
els.subBtn.addEventListener("click", function () {
  controller.toggleSubtitles();
});

// ----- Picture in Picture -----
const pipSupported = document.pictureInPictureEnabled &&
  typeof els.video.requestPictureInPicture === "function";
if (!pipSupported) {
  els.pipBtn.hidden = true;
}

function togglePip(): void {
  if (!pipSupported) {
    return;
  }
  if (document.pictureInPictureElement) {
    document.exitPictureInPicture().catch(function () {});
  } else {
    els.video.requestPictureInPicture().catch(function () {});
  }
}
els.pipBtn.addEventListener("click", togglePip);

// ----- Fullscreen -----
function toggleFullscreen(): void {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(function () {});
  } else if (els.stage.requestFullscreen) {
    els.stage.requestFullscreen().catch(function () {});
  }
}
els.fsBtn.addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", function () {
  const isFs = !!document.fullscreenElement;
  els.player.classList.toggle("is-fullscreen", isFs);
  els.fsBtn.setAttribute("aria-pressed", isFs ? "true" : "false");
});

// ----- Action row -----
els.openExternalBtn.addEventListener("click", function () {
  vscode.postMessage({ type: "action", name: "openExternal" });
});
els.copyPathBtn.addEventListener("click", function () {
  vscode.postMessage({ type: "action", name: "copyPath" });
});
// statusActionAt returns null for a button that is not currently offered, so a
// status cleared between render and click cannot post a stale action.
function postStatusAction(index: number): void {
  const action = statusActionAt(index);
  if (action !== null) {
    vscode.postMessage({ type: "action", name: action });
  }
}
els.statusAction.addEventListener("click", function () {
  postStatusAction(0);
});
els.statusActionSecondary.addEventListener("click", function () {
  postStatusAction(1);
});

// ----- Keyboard shortcuts -----
function isTypingTarget(el: EventTarget | null): boolean {
  if (!el) {
    return false;
  }
  const tag = (el as HTMLElement).tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement).isContentEditable;
}

document.addEventListener("keydown", function (evt) {
  if (isTypingTarget(evt.target)) {
    return;
  }
  let handled = true;
  switch (evt.key) {
    case " ":
    case "k":
    case "K":
      controller.togglePlay();
      break;
    case "m":
    case "M":
      controller.toggleMute();
      break;
    case "c":
    case "C":
      controller.toggleSubtitles();
      break;
    case "j":
    case "J":
    case "ArrowLeft":
      controller.nudge(-controller.getSeekStep());
      break;
    case "l":
    case "L":
    case "ArrowRight":
      controller.nudge(controller.getSeekStep());
      break;
    case ",":
      controller.frameStep(-1);
      break;
    case ".":
      controller.frameStep(1);
      break;
    case "[":
      controller.setLoopA();
      break;
    case "]":
      controller.setLoopB();
      break;
    case "\\":
      controller.toggleWholeLoop();
      break;
    case "p":
    case "P":
      togglePip();
      break;
    case "f":
    case "F":
      toggleFullscreen();
      break;
    default:
      handled = false;
  }
  if (handled) {
    evt.preventDefault();
  }
});

// ----- Init -----
controller.applyRate();
els.player.classList.add("is-paused");
vscode.postMessage({ type: "ready" });
