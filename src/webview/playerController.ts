import { ALLOWED_RATES, clampPreferences } from "../shared/preferences";
import type { Preferences } from "../shared/preferences";
import type { WebviewToHost } from "../shared/protocol";
import { RESUME_END_THRESHOLD_SEC, shouldResume } from "../shared/resume";

import { FRAME_STEP_SECONDS } from "../shared/config";
import { nextLoopTarget, type LoopState } from "./abLoop";
import { BufferingOverlay } from "./bufferingOverlay";
import { canResumeAudio, DEFAULT_DRIFT_TUNING, driftAction, isBenignPlayError } from "./sync";
import { els } from "./dom";
import { renderLoopMarkers } from "./seekbar";
import { clearStatus, flashFeedback, showStatus } from "./status";
import { clamp, formatTime, latestBufferedEnd } from "./util";

export class PlayerController {
  /** The separate audible mp3 track, created when 'audioSrc' arrives. */
  private audio: HTMLAudioElement | null = null;
  private subtitlesUrl: string | null = null;
  private videoCarriesAudio = false;
  private seekStep = 10;
  // User's intended mute state, independent of which element is currently
  // audible -- so muting before the audio track attaches is preserved.
  private userMuted = false;
  private readonly SPEEDS: readonly number[] = ALLOWED_RATES;
  private speedIndex = this.SPEEDS.indexOf(1);
  private volumePreferenceSaveTimeout: number | undefined;
  private hasPendingVolumePreferenceSave = false;
  private readonly PROGRESS_SAVE_DELTA_SEC = 5;
  private resumeTime = 0;
  private lastSavedTime = 0;
  // Whether the user wants playback running, independent of whether an element
  // is momentarily paused for buffering. Drives togglePlay and buffer recovery.
  private userIntendsPlay = false;
  // True while the video is held paused *because the audio track underran*. The
  // pause is masked from the UI/progress so it reads as buffering, not a stop.
  private waitingForAudio = false;
  // Stage buffering spinner with a debounce so micro-stalls don't flash it. The
  // debounce/cancel logic lives in a pure BufferingOverlay so it is unit-tested
  // with a fake clock; this only wires it to the CSS class toggle.
  private readonly buffering = new BufferingOverlay(
    () => els.player.classList.add("is-buffering"),
    () => els.player.classList.remove("is-buffering"),
    {
      setTimeout: (handler, ms) => window.setTimeout(handler, ms),
      clearTimeout: (id) => window.clearTimeout(id),
    },
  );
  private loop: LoopState = { a: null, b: null, whole: false, duration: 0 };
  // Whether a drag-scrub is in progress. Wired by the Seekbar via
  // setScrubProvider so the timeupdate handler can skip redrawing the bar
  // mid-drag. Defaults to "not scrubbing" until the Seekbar attaches.
  private isScrubbing: () => boolean = () => false;

  public constructor(
    private readonly postMessage: (message: WebviewToHost) => void,
  ) {
    this.attachVideoListeners();
  }

  /** Let the Seekbar report when a drag-scrub is active. */
  public setScrubProvider(isScrubbing: () => boolean): void {
    this.isScrubbing = isScrubbing;
  }

  public get duration(): number {
    return els.video.duration;
  }

  public setNativeAudio(on: boolean): void {
    this.videoCarriesAudio = on;
    this.applyAudible();
  }

  public setSeekStep(step: number): void {
    this.seekStep = step;
    if (Number.isFinite(step)) {
      this.updateSeekStepLabels(step);
    }
  }

  public getSeekStep(): number {
    return this.seekStep;
  }

  // Keep the back/forward buttons honest about the configured step: their face
  // badge, tooltip, and accessible name all derive from the live seekStep
  // instead of a baked-in "10".
  private updateSeekStepLabels(step: number): void {
    const label = String(step);
    const backSub = els.back10Btn.querySelector(".btn-sub");
    const fwdSub = els.fwd10Btn.querySelector(".btn-sub");
    if (backSub) {
      backSub.textContent = label;
    }
    if (fwdSub) {
      fwdSub.textContent = label;
    }
    els.back10Btn.title = "Back " + label + "s (J)";
    els.fwd10Btn.title = "Forward " + label + "s (L)";
    els.back10Btn.setAttribute("aria-label", "Rewind " + label + " seconds");
    els.fwd10Btn.setAttribute("aria-label", "Forward " + label + " seconds");
  }

  public applyPreferences(p: Preferences): void {
    const preferences = clampPreferences(p);
    els.volSlider.value = String(preferences.volume);
    this.userMuted = preferences.muted;

    const preferredIndex = this.SPEEDS.indexOf(preferences.playbackRate);
    this.speedIndex = preferredIndex === -1 ? this.SPEEDS.indexOf(1) : preferredIndex;

    this.applyRate();
    this.applyAudible();
  }

  public setResumeTime(time: number): void {
    this.resumeTime = Number.isFinite(time) && time > 0 ? time : 0;
    this.lastSavedTime = this.resumeTime;
  }

  public attachVideo(url: string, nativeAudio: boolean): void {
    // Set audibility before src so a videoSrc arriving before (or without) init
    // never flashes a webm muted: the message carries its own authoritative flag.
    this.videoCarriesAudio = nativeAudio;
    els.video.src = url;
    els.video.preservesPitch = true;
    this.applyAudible();
  }

  public isPaused(): boolean {
    return els.video.paused;
  }

  // The element that carries audible volume/mute for the user: the mp3 if we
  // have it, otherwise the (muted-for-AAC) video element as a fallback target.
  private audibleEl(): HTMLMediaElement {
    return this.audio || els.video;
  }

  private syncAudioToVideo(): void {
    if (this.audio && Math.abs(this.audio.currentTime - els.video.currentTime) > DEFAULT_DRIFT_TUNING.soft) {
      this.audio.currentTime = els.video.currentTime;
    }
  }

  private tryPlayAudio(): void {
    if (!this.audio) {
      return;
    }
    this.audio.play().catch((err: unknown) => {
      const name = err instanceof DOMException ? err.name : "";
      if (isBenignPlayError(name)) {
        return;
      }
      showStatus("Audio playback error", "warning");
    });
  }

  public play(): void {
    this.userIntendsPlay = true;
    els.video.play().catch(function () { /* ignore autoplay rejections */ });
    if (this.audio) {
      this.syncAudioToVideo();
      this.tryPlayAudio();
    }
  }

  private pause(): void {
    // Clearing waitingForAudio first means the video's 'pause' event (if one
    // fires) is treated as a real stop, not a masked buffering hold.
    const wasBufferHeld = this.waitingForAudio;
    this.userIntendsPlay = false;
    this.waitingForAudio = false;
    els.video.pause();
    if (this.audio) {
      this.audio.pause();
    }
    // A user stop must cancel any pending/active buffering spinner; otherwise the
    // debounced spinner can fire onto (or linger over) a stopped frame and read
    // as a freeze.
    this.hideBuffering();
    // If the video was already held paused for buffering, pausing it fires no
    // 'pause' event, so reflect the stopped state in the UI here.
    if (wasBufferHeld) {
      els.player.classList.remove("is-playing");
      els.player.classList.add("is-paused");
      els.playBtn.setAttribute("aria-pressed", "false");
    }
  }

  private videoIsPlaying(): boolean {
    return !els.video.paused && !els.video.ended;
  }

  private pauseAudioForBuffering(): void {
    if (this.audio && !this.audio.paused) {
      this.audio.pause();
    }
  }

  private resumeAudioWithVideo(): void {
    if (this.audio && this.videoIsPlaying()) {
      this.syncAudioToVideo();
      if (canResumeAudio(this.audio.readyState, this.audio.seeking)) {
        this.tryPlayAudio();
      }
    }
  }

  // Show the stage spinner after a short delay so brief stalls don't flicker it.
  private showBuffering(): void {
    this.buffering.show();
  }

  private hideBuffering(): void {
    this.buffering.hide();
  }

  private showStageError(message: string): void {
    this.hideBuffering();
    els.stageError.textContent = message;
    els.player.classList.add("is-stage-error");
  }

  private clearStageError(): void {
    els.player.classList.remove("is-stage-error");
  }

  // The audio track underran. Mirror how the video's `waiting` pauses audio:
  // hold the video so it cannot run ahead of silent audio, but mask the pause
  // (waitingForAudio) so it reads as buffering rather than a user stop.
  private holdForAudioBuffering(): void {
    if (this.audio && this.userIntendsPlay && this.videoIsPlaying()) {
      this.waitingForAudio = true;
      els.video.pause();
      this.showBuffering();
    }
  }

  // The audio track recovered. Release a buffering hold and resume the pair the
  // user still wants playing.
  private resumeAfterAudioBuffering(): void {
    if (!this.waitingForAudio) {
      return;
    }
    this.waitingForAudio = false;
    if (this.userIntendsPlay) {
      this.syncAudioToVideo();
      // Keep the spinner up until the video actually resumes (its own 'playing'
      // handler hides it) so we don't flash "playing, no spinner, silent". If
      // play() rejects there is no 'playing' event, so drop to a stopped state
      // here rather than spinning over a frame that will never advance.
      els.video.play().catch(() => this.dropToPausedFromBuffering());
      if (this.audio && canResumeAudio(this.audio.readyState, this.audio.seeking)) {
        this.tryPlayAudio();
      }
    }
  }

  // A buffering resume failed to start the video. Reflect a real stop so the UI
  // doesn't keep a spinner over a frame that will never advance.
  private dropToPausedFromBuffering(): void {
    this.userIntendsPlay = false;
    this.hideBuffering();
    els.player.classList.remove("is-playing");
    els.player.classList.add("is-paused");
    els.playBtn.setAttribute("aria-pressed", "false");
  }

  // An audio readiness event fired. Resume whichever path was waiting on it:
  // a masked buffering hold, or a play deferred while video kept running.
  private onAudioReady(): void {
    if (this.waitingForAudio) {
      this.resumeAfterAudioBuffering();
    } else {
      this.resumeAudioWithVideo();
    }
  }

  public togglePlay(): void {
    if (!this.userIntendsPlay) {
      this.play();
      flashFeedback(true);
    } else {
      this.pause();
      flashFeedback(false);
    }
  }

  public seekTo(time: number): void {
    const dur = isFinite(els.video.duration) ? els.video.duration : time;
    const clamped = clamp(time, 0, dur || 0);
    els.video.currentTime = clamped;
    if (this.audio) {
      this.audio.currentTime = clamped;
    }
  }

  public nudge(delta: number): void {
    this.seekTo(els.video.currentTime + delta);
  }

  public frameStep(direction: number): void {
    this.pause();
    this.seekTo(els.video.currentTime + direction * FRAME_STEP_SECONDS);
  }

  public setLoopA(): void {
    const a = els.video.currentTime;
    this.loop.a = a;
    if (this.loop.b !== null && this.loop.b <= a) {
      this.loop.b = null;
    }
    this.refreshLoopUi();
  }

  public setLoopB(): void {
    if (this.loop.a === null) {
      return;
    }
    const b = els.video.currentTime;
    if (b <= this.loop.a) {
      return;
    }
    this.loop.b = b;
    this.refreshLoopUi();
  }

  public toggleWholeLoop(): void {
    this.loop.whole = !this.loop.whole;
    this.refreshLoopUi();
  }

  public clearLoop(): void {
    this.loop = { a: null, b: null, whole: false, duration: els.video.duration };
    this.refreshLoopUi();
  }

  public applyRate(): void {
    const rate = this.SPEEDS[this.speedIndex];
    els.video.playbackRate = rate;
    if (this.audio) {
      this.audio.playbackRate = rate;
    }
    els.speedBtn.textContent = rate + "x";
    els.speedBtn.setAttribute("aria-label", "Playback speed " + rate + "x");
  }

  public cycleSpeed(): void {
    this.speedIndex = (this.speedIndex + 1) % this.SPEEDS.length;
    this.applyRate();
    this.emitPreferences();
  }

  // Apply the current volume + mute intent to whichever element is audible,
  // keeping the video itself permanently muted (its AAC can't decode and would
  // be a second, out-of-sync sound source).
  private applyAudible(): void {
    const v = parseFloat(els.volSlider.value);
    const el = this.audibleEl();
    el.volume = v;
    el.muted = this.userMuted;
    if (el !== els.video) {
      els.video.muted = true;
    } else if (!this.videoCarriesAudio) {
      els.video.muted = true;
    }
    this.updateMuteUi();
  }

  public onVolumeInput(): void {
    // Dragging the volume up is an implicit unmute.
    if (parseFloat(els.volSlider.value) > 0) {
      this.userMuted = false;
    }
    this.applyAudible();
    this.queueVolumePreferences();
  }

  public toggleMute(): void {
    this.userMuted = !this.userMuted;
    this.applyAudible();
    this.emitPreferences();
  }

  private emitPreferences(): void {
    this.hasPendingVolumePreferenceSave = false;
    this.postMessage({
      type: "savePreferences",
      preferences: {
        volume: parseFloat(els.volSlider.value),
        muted: this.userMuted,
        playbackRate: this.SPEEDS[this.speedIndex],
      },
    });
  }

  private queueVolumePreferences(): void {
    if (this.volumePreferenceSaveTimeout === undefined) {
      this.emitPreferences();
      this.volumePreferenceSaveTimeout = window.setTimeout(() => {
        this.flushVolumePreferences();
      }, 400);
      return;
    }

    this.hasPendingVolumePreferenceSave = true;
  }

  private flushVolumePreferences(): void {
    if (this.hasPendingVolumePreferenceSave) {
      this.emitPreferences();
      this.volumePreferenceSaveTimeout = window.setTimeout(() => {
        this.flushVolumePreferences();
      }, 400);
      return;
    }

    this.volumePreferenceSaveTimeout = undefined;
  }

  private updateMuteUi(): void {
    const v = parseFloat(els.volSlider.value);
    const muted = this.userMuted || v === 0;
    els.player.classList.toggle("is-muted", muted);
    els.muteBtn.setAttribute("aria-pressed", muted ? "true" : "false");
  }

  public attachAudio(url: string): void {
    if (this.audio) {
      this.audio.pause();
      // Release the element without loading the empty string (which would fire a
      // spurious error event).
      this.audio.removeAttribute("src");
      this.audio.load();
      this.audio.remove();
    }
    this.audio = document.createElement("audio");
    this.audio.preload = "auto";
    this.audio.hidden = true;
    this.audio.src = url;
    document.body.appendChild(this.audio);

    this.audio.playbackRate = this.SPEEDS[this.speedIndex];
    // Keep pitch constant at non-1x rates and match the video element.
    this.audio.preservesPitch = true;
    els.video.preservesPitch = true;
    this.applyAudible();

    // Mirror current playback state onto the freshly attached track.
    this.syncAudioToVideo();
    if (!els.video.paused) {
      this.tryPlayAudio();
    }

    this.audio.addEventListener("error", function () {
      showStatus("Audio playback error", "warning");
    });

    // Symmetric buffer coordination: when the audio track underruns, hold the
    // video so it cannot run ahead of silent audio; when audio is ready again,
    // release the hold and resume both. Without this the video kept playing
    // through audio dropouts and the two re-drifted on recovery.
    this.audio.addEventListener("waiting", () => this.holdForAudioBuffering());
    this.audio.addEventListener("stalled", () => this.holdForAudioBuffering());
    this.audio.addEventListener("canplay", () => this.onAudioReady());
    this.audio.addEventListener("playing", () => this.onAudioReady());
    this.audio.addEventListener("seeked", () => this.onAudioReady());

    clearStatus();
  }

  public attachSubtitles(vtt: string, label: string): void {
    if (this.subtitlesUrl !== null) {
      URL.revokeObjectURL(this.subtitlesUrl);
    }

    const blob = new Blob([vtt], { type: "text/vtt" });
    this.subtitlesUrl = URL.createObjectURL(blob);
    els.track.src = this.subtitlesUrl;
    els.track.label = label;
    els.track.track.mode = "hidden";
    els.subBtn.hidden = false;
    els.subBtn.setAttribute("aria-pressed", "false");
    els.player.classList.remove("is-subtitles-on");
  }

  public toggleSubtitles(): void {
    if (els.video.textTracks.length === 0 || els.subBtn.hidden) {
      return;
    }

    const track = els.video.textTracks[0];
    const showing = track.mode !== "showing";
    track.mode = showing ? "showing" : "hidden";
    els.player.classList.toggle("is-subtitles-on", showing);
    els.subBtn.setAttribute("aria-pressed", showing ? "true" : "false");
  }

  // Keep the audio track in step with the video clock without re-seeking every
  // frame: nudge playbackRate for small drift, hard-seek only for large drift.
  // Policy lives in the pure `driftAction` so it is unit-tested in isolation.
  private correctDrift(): void {
    if (!this.audio || this.audio.paused || els.video.paused) {
      return;
    }
    // Don't fight an in-flight seek; the `seeked`/`seeking` handlers resync it.
    if (this.audio.seeking || els.video.seeking) {
      return;
    }
    const baseRate = this.SPEEDS[this.speedIndex];
    const action = driftAction(this.audio.currentTime, els.video.currentTime, baseRate);
    switch (action.kind) {
      case "seek":
        this.audio.currentTime = action.to;
        this.audio.playbackRate = baseRate;
        break;
      case "rate":
        this.audio.playbackRate = action.playbackRate;
        break;
      case "none":
        // Back in sync: restore the user's intended rate (no-op if unchanged).
        if (this.audio.playbackRate !== baseRate) {
          this.audio.playbackRate = baseRate;
        }
        break;
    }
  }

  private postProgress(time: number): void {
    if (!Number.isFinite(time)) {
      return;
    }
    this.lastSavedTime = time;
    this.postMessage({ type: "progress", time });
  }

  private postProgressIfNeeded(): void {
    const time = els.video.currentTime;
    if (!Number.isFinite(time)) {
      return;
    }
    if (Math.abs(time - this.lastSavedTime) >= this.PROGRESS_SAVE_DELTA_SEC) {
      this.postProgress(time);
    }
  }

  private renderProgress(): void {
    const dur = els.video.duration;
    if (isFinite(dur) && dur > 0) {
      const pct = (els.video.currentTime / dur) * 100;
      els.seekPlayed.style.width = pct + "%";
      els.seekHandle.style.left = pct + "%";
    } else {
      els.seekPlayed.style.width = "0%";
      els.seekHandle.style.left = "0%";
    }
    this.renderBuffered();
    this.updateSeekAria();
  }

  // Mirror the seek bar's position into ARIA so screen readers announce a
  // human-readable timestamp; the visual width/handle alone are silent.
  private updateSeekAria(): void {
    const dur = els.video.duration;
    if (!isFinite(dur) || dur <= 0) {
      return;
    }
    els.seek.setAttribute("aria-valuemax", String(Math.floor(dur)));
    els.seek.setAttribute("aria-valuenow", String(Math.floor(els.video.currentTime)));
    els.seek.setAttribute("aria-valuetext", formatTime(els.video.currentTime) + " of " + formatTime(dur));
  }

  private renderBuffered(): void {
    const dur = els.video.duration;
    if (!isFinite(dur) || dur <= 0 || els.video.buffered.length === 0) {
      els.seekBuffered.style.width = "0%";
      return;
    }
    const ranges = Array.from({ length: els.video.buffered.length }, function (_, i) {
      return {
        start: els.video.buffered.start(i),
        end: els.video.buffered.end(i),
      };
    });
    const end = latestBufferedEnd(ranges, els.video.currentTime);
    els.seekBuffered.style.width = (end / dur) * 100 + "%";
  }

  private refreshLoopUi(): void {
    this.loop.duration = els.video.duration;
    renderLoopMarkers(this.loop.a, this.loop.b, this.loop.duration);
    els.player.classList.toggle("is-looping", this.loop.whole);
    els.loopBtn.classList.toggle("is-active", this.loop.whole);
    els.loopBtn.setAttribute("aria-pressed", this.loop.whole ? "true" : "false");
    els.setABtn.classList.toggle("is-active", this.loop.a !== null);
    els.setBBtn.classList.toggle("is-active", this.loop.b !== null);
  }

  private applyLoop(resumeAfterSeek: boolean): boolean {
    const target = nextLoopTarget(els.video.currentTime, { ...this.loop, duration: els.video.duration });
    if (target === null) {
      return false;
    }
    this.seekTo(target);
    this.renderProgress();
    if (resumeAfterSeek) {
      this.play();
    }
    return true;
  }

  private attachVideoListeners(): void {
    els.video.addEventListener("loadedmetadata", () => {
      els.timeDur.textContent = formatTime(els.video.duration);
      this.refreshLoopUi();
      this.renderProgress();
      if (shouldResume(this.resumeTime, els.video.duration, RESUME_END_THRESHOLD_SEC)) {
        this.seekTo(this.resumeTime);
      }
      this.hideBuffering();
    });

    els.video.addEventListener("durationchange", () => {
      els.timeDur.textContent = formatTime(els.video.duration);
      this.refreshLoopUi();
      this.updateSeekAria();
    });

    els.video.addEventListener("timeupdate", () => {
      if (!this.isScrubbing()) {
        els.timeCur.textContent = formatTime(els.video.currentTime);
        this.renderProgress();
      }
      if (this.applyLoop(this.videoIsPlaying())) {
        return;
      }
      this.correctDrift();
      this.postProgressIfNeeded();
    });

    els.video.addEventListener("progress", () => {
      this.renderBuffered();
    });

    els.video.addEventListener("play", () => {
      els.player.classList.add("is-playing");
      els.player.classList.remove("is-paused");
      els.playBtn.setAttribute("aria-pressed", "true");
      this.resumeAudioWithVideo();
    });

    els.video.addEventListener("pause", () => {
      // A buffering hold pauses the video element but is not a user stop: keep
      // the UI showing playback and leave audio/progress untouched so it reads
      // as buffering. resumeAfterAudioBuffering will resume the pair.
      if (this.waitingForAudio) {
        return;
      }
      // A genuine stop ends any buffering spinner so it can't linger over the
      // paused frame.
      this.hideBuffering();
      els.player.classList.remove("is-playing");
      els.player.classList.add("is-paused");
      els.playBtn.setAttribute("aria-pressed", "false");
      if (this.audio && !this.audio.paused) {
        this.audio.pause();
      }
      this.postProgress(els.video.currentTime);
    });

    els.video.addEventListener("seeking", () => {
      if (this.audio) {
        this.audio.currentTime = els.video.currentTime;
      }
    });

    els.video.addEventListener("seeked", () => {
      this.resumeAudioWithVideo();
      this.hideBuffering();
    });

    els.video.addEventListener("waiting", () => {
      this.pauseAudioForBuffering();
      this.showBuffering();
    });
    els.video.addEventListener("stalled", () => {
      this.pauseAudioForBuffering();
      this.showBuffering();
    });
    els.video.addEventListener("playing", () => {
      this.resumeAudioWithVideo();
      this.hideBuffering();
      this.clearStageError();
    });
    els.video.addEventListener("canplay", () => {
      this.hideBuffering();
      this.clearStageError();
    });
    els.video.addEventListener("loadstart", () => {
      this.showBuffering();
    });

    els.video.addEventListener("ended", () => {
      if (this.applyLoop(true)) {
        return;
      }
      // Playback finished with no loop: drop play intent so the next togglePlay
      // restarts from the end instead of being read as a pause.
      this.userIntendsPlay = false;
      this.waitingForAudio = false;
      // Reaching the end clears any spinner so it doesn't sit over the last frame.
      this.hideBuffering();
      if (this.audio) {
        this.audio.pause();
      }
    });

    els.video.addEventListener("error", () => {
      let detail = "Unknown playback error";
      if (els.video.error) {
        switch (els.video.error.code) {
          case 1: detail = "Playback aborted"; break;
          case 2: detail = "Network error while streaming video"; break;
          case 3: detail = "Video could not be decoded"; break;
          case 4: detail = "Video format is not supported"; break;
        }
      }
      this.postMessage({ type: "error", message: detail });
      showStatus(detail, "warning");
      this.showStageError(detail);
    });
  }
}
