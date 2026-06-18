"use strict";

import type { HostToWebview, WebviewAction, WebviewToHost } from "../protocol";

import { els } from "./dom";
import { PlayerController } from "./playerController";
import { Seekbar } from "./seekbar";
import { clearStatus, setStatusAction, showStatus } from "./status";

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

// The host action the status-bar button should trigger when shown (e.g. the
// "Trust workspace" / "Open settings" buttons on the ffmpeg/trust warnings).
let pendingStatusAction: WebviewAction | null = null;

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
      pendingStatusAction = null;
      if (msg.audioPending) {
        showStatus("Extracting audio…", "loading");
      } else if (msg.ffmpegMissing) {
        showStatus("Audio needs ffmpeg, which wasn't found. Install it (see README) or set its path in Settings.", "warning");
        pendingStatusAction = "openFfmpegSettings";
        setStatusAction("Open settings");
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
      pendingStatusAction = "trustWorkspace";
      setStatusAction("Trust workspace");
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
els.statusAction.addEventListener("click", function () {
  // Only act when the button is actually visible: a status can be cleared (and
  // the button hidden) without nulling pendingStatusAction, so guard on hidden
  // to avoid posting a stale action.
  if (pendingStatusAction && !els.statusAction.hidden) {
    vscode.postMessage({ type: "action", name: pendingStatusAction });
  }
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
