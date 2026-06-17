import type { WebviewToHost } from "../protocol";

import { els } from "./dom";
import { clearStatus, flashFeedback, showStatus } from "./status";
import { clamp, formatTime, latestBufferedEnd } from "./util";

export class PlayerController {
  /** The separate audible mp3 track, created when 'audioSrc' arrives. */
  private audio: HTMLAudioElement | null = null;
  private subtitlesUrl: string | null = null;
  private videoCarriesAudio = false;
  // User's intended mute state, independent of which element is currently
  // audible -- so muting before the audio track attaches is preserved.
  private userMuted = false;
  private readonly SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
  private speedIndex = this.SPEEDS.indexOf(1);
  private readonly DRIFT_THRESHOLD = 0.3;
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
    if (this.audio && Math.abs(this.audio.currentTime - els.video.currentTime) > 0.05) {
      this.audio.currentTime = els.video.currentTime;
    }
  }

  public play(): void {
    els.video.play().catch(function () { /* ignore autoplay rejections */ });
    if (this.audio) {
      this.syncAudioToVideo();
      this.audio.play().catch(function () {});
    }
  }

  private pause(): void {
    els.video.pause();
    if (this.audio) {
      this.audio.pause();
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
      this.audio.play().catch(function () {});
    }
  }

  public togglePlay(): void {
    if (els.video.paused) {
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

  public applyRate(): void {
    const rate = this.SPEEDS[this.speedIndex];
    els.video.playbackRate = rate;
    if (this.audio) {
      this.audio.playbackRate = rate;
    }
    els.speedBtn.textContent = rate + "x";
  }

  public cycleSpeed(): void {
    this.speedIndex = (this.speedIndex + 1) % this.SPEEDS.length;
    this.applyRate();
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
  }

  public toggleMute(): void {
    this.userMuted = !this.userMuted;
    this.applyAudible();
  }

  private updateMuteUi(): void {
    const v = parseFloat(els.volSlider.value);
    els.player.classList.toggle("is-muted", this.userMuted || v === 0);
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
      this.audio.play().catch(function () {});
    }

    this.audio.addEventListener("error", function () {
      showStatus("Audio playback error", "warning");
    });

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

  private correctDrift(): void {
    if (!this.audio) {
      return;
    }
    if (!this.audio.paused && !els.video.paused) {
      if (Math.abs(this.audio.currentTime - els.video.currentTime) > this.DRIFT_THRESHOLD) {
        this.audio.currentTime = els.video.currentTime;
      }
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

  private attachVideoListeners(): void {
    els.video.addEventListener("loadedmetadata", () => {
      els.timeDur.textContent = formatTime(els.video.duration);
      this.renderProgress();
    });

    els.video.addEventListener("durationchange", function () {
      els.timeDur.textContent = formatTime(els.video.duration);
    });

    els.video.addEventListener("timeupdate", () => {
      if (!this.isScrubbing()) {
        els.timeCur.textContent = formatTime(els.video.currentTime);
        this.renderProgress();
      }
      this.correctDrift();
    });

    els.video.addEventListener("progress", () => {
      this.renderBuffered();
    });

    els.video.addEventListener("play", () => {
      els.player.classList.add("is-playing");
      els.player.classList.remove("is-paused");
      this.resumeAudioWithVideo();
    });

    els.video.addEventListener("pause", () => {
      els.player.classList.remove("is-playing");
      els.player.classList.add("is-paused");
      if (this.audio && !this.audio.paused) {
        this.audio.pause();
      }
    });

    els.video.addEventListener("seeking", () => {
      if (this.audio) {
        this.audio.currentTime = els.video.currentTime;
      }
    });

    els.video.addEventListener("seeked", () => {
      this.resumeAudioWithVideo();
    });

    els.video.addEventListener("waiting", () => {
      this.pauseAudioForBuffering();
    });
    els.video.addEventListener("stalled", () => {
      this.pauseAudioForBuffering();
    });
    els.video.addEventListener("playing", () => {
      this.resumeAudioWithVideo();
    });

    els.video.addEventListener("ended", () => {
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
    });
  }
}
