(function () {
  "use strict";

  const vscode = acquireVsCodeApi();

  // ----- DOM references -----
  const player = document.getElementById("player");
  const stage = document.getElementById("stage");
  const video = document.getElementById("video");
  const fileLabel = document.getElementById("fileLabel");
  const flash = document.getElementById("flash");
  const flashIcon = document.getElementById("flashIcon");

  const seek = document.getElementById("seek");
  const seekBuffered = document.getElementById("seekBuffered");
  const seekPlayed = document.getElementById("seekPlayed");
  const seekHandle = document.getElementById("seekHandle");

  const playBtn = document.getElementById("playBtn");
  const back10Btn = document.getElementById("back10Btn");
  const fwd10Btn = document.getElementById("fwd10Btn");
  const muteBtn = document.getElementById("muteBtn");
  const volSlider = document.getElementById("volSlider");
  const timeCur = document.getElementById("timeCur");
  const timeDur = document.getElementById("timeDur");
  const speedBtn = document.getElementById("speedBtn");
  const pipBtn = document.getElementById("pipBtn");
  const fsBtn = document.getElementById("fsBtn");

  const status = document.getElementById("status");
  const statusSpinner = document.getElementById("statusSpinner");
  const statusText = document.getElementById("statusText");

  const openExternalBtn = document.getElementById("openExternalBtn");
  const copyPathBtn = document.getElementById("copyPathBtn");

  // ----- State -----
  /** The separate audible mp3 track, created when 'audioSrc' arrives. */
  let audio = null;
  let scrubbing = false;
  let wasPlayingBeforeScrub = false;
  // User's intended mute state, independent of which element is currently
  // audible — so muting before the audio track attaches is preserved.
  let userMuted = false;

  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
  let speedIndex = SPEEDS.indexOf(1);
  const DRIFT_THRESHOLD = 0.3;

  // The element that carries audible volume/mute for the user: the mp3 if we
  // have it, otherwise the (muted-for-AAC) video element as a fallback target.
  function audibleEl() {
    return audio || video;
  }

  // ----- Helpers -----
  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) {
      seconds = 0;
    }
    const total = Math.floor(seconds);
    const s = total % 60;
    const m = Math.floor(total / 60) % 60;
    const h = Math.floor(total / 3600);
    const ss = String(s).padStart(2, "0");
    if (h > 0) {
      const mm = String(m).padStart(2, "0");
      return h + ":" + mm + ":" + ss;
    }
    return m + ":" + ss;
  }

  function showStatus(text, variant) {
    statusText.textContent = text;
    status.hidden = false;
    if (variant === "warning") {
      status.classList.add("is-warning");
      statusSpinner.hidden = true;
    } else if (variant === "loading") {
      status.classList.remove("is-warning");
      statusSpinner.hidden = false;
    } else {
      status.classList.remove("is-warning");
      statusSpinner.hidden = true;
    }
  }

  function clearStatus() {
    status.hidden = true;
    statusText.textContent = "";
    statusSpinner.hidden = true;
    status.classList.remove("is-warning");
  }

  function flashFeedback(playing) {
    // swap the center icon: play triangle vs pause bars
    if (playing) {
      flashIcon.innerHTML = '<path d="M8 5v14l11-7z" fill="currentColor"></path>';
    } else {
      flashIcon.innerHTML = '<path d="M6 5h4v14H6zm8 0h4v14h-4z" fill="currentColor"></path>';
    }
    flash.classList.remove("show");
    // force reflow so the animation restarts on rapid toggles
    void flash.offsetWidth;
    flash.classList.add("show");
  }

  // ----- Playback control -----
  function syncAudioToVideo() {
    if (audio && Math.abs(audio.currentTime - video.currentTime) > 0.05) {
      audio.currentTime = video.currentTime;
    }
  }

  function play() {
    video.play().catch(function () { /* ignore autoplay rejections */ });
    if (audio) {
      syncAudioToVideo();
      audio.play().catch(function () {});
    }
  }

  function pause() {
    video.pause();
    if (audio) {
      audio.pause();
    }
  }

  function togglePlay() {
    if (video.paused) {
      play();
      flashFeedback(true);
    } else {
      pause();
      flashFeedback(false);
    }
  }

  function seekTo(time) {
    const dur = isFinite(video.duration) ? video.duration : time;
    const clamped = Math.max(0, Math.min(time, dur || 0));
    video.currentTime = clamped;
    if (audio) {
      audio.currentTime = clamped;
    }
  }

  function nudge(delta) {
    seekTo(video.currentTime + delta);
  }

  function applyRate() {
    const rate = SPEEDS[speedIndex];
    video.playbackRate = rate;
    if (audio) {
      audio.playbackRate = rate;
    }
    speedBtn.textContent = rate + "x";
  }

  function cycleSpeed() {
    speedIndex = (speedIndex + 1) % SPEEDS.length;
    applyRate();
  }

  // Apply the current volume + mute intent to whichever element is audible,
  // keeping the video itself permanently muted (its AAC can't decode and would
  // be a second, out-of-sync sound source).
  function applyAudible() {
    const v = parseFloat(volSlider.value);
    const el = audibleEl();
    el.volume = v;
    el.muted = userMuted;
    if (el !== video) {
      video.muted = true;
    }
    updateMuteUi();
  }

  function onVolumeInput() {
    // Dragging the volume up is an implicit unmute.
    if (parseFloat(volSlider.value) > 0) {
      userMuted = false;
    }
    applyAudible();
  }

  function toggleMute() {
    userMuted = !userMuted;
    applyAudible();
  }

  function updateMuteUi() {
    const v = parseFloat(volSlider.value);
    player.classList.toggle("is-muted", userMuted || v === 0);
  }

  // ----- Progress / seek bar rendering -----
  function renderProgress() {
    const dur = video.duration;
    if (isFinite(dur) && dur > 0) {
      const pct = (video.currentTime / dur) * 100;
      seekPlayed.style.width = pct + "%";
      seekHandle.style.left = pct + "%";
    } else {
      seekPlayed.style.width = "0%";
      seekHandle.style.left = "0%";
    }
    renderBuffered();
  }

  function renderBuffered() {
    const dur = video.duration;
    if (!isFinite(dur) || dur <= 0 || video.buffered.length === 0) {
      seekBuffered.style.width = "0%";
      return;
    }
    let end = 0;
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= video.currentTime) {
        end = Math.max(end, video.buffered.end(i));
      }
    }
    seekBuffered.style.width = (end / dur) * 100 + "%";
  }

  function timeFromEvent(evt) {
    const rect = seek.getBoundingClientRect();
    const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
    let ratio = (clientX - rect.left) / rect.width;
    ratio = Math.max(0, Math.min(1, ratio));
    const dur = isFinite(video.duration) ? video.duration : 0;
    return ratio * dur;
  }

  // ----- Message handling -----
  window.addEventListener("message", function (event) {
    const msg = event.data;
    if (!msg || typeof msg.type !== "string") {
      return;
    }

    switch (msg.type) {
      case "init":
        fileLabel.textContent = msg.name || "";
        fileLabel.title = msg.name || "";
        if (msg.audioPending) {
          showStatus("Extracting audio…", "loading");
        } else if (msg.ffmpegMissing) {
          showStatus("Install ffmpeg for audio (e.g. brew install ffmpeg)", "warning");
        } else {
          clearStatus();
        }
        break;

      case "videoSrc":
        // Assign directly so the media element streams via HTTP Range.
        video.src = msg.url;
        video.muted = true;
        break;

      case "audioSrc":
        attachAudio(msg.url);
        break;

      case "audioError":
        showStatus("Audio extraction failed", "warning");
        break;
    }
  });

  function attachAudio(url) {
    if (audio) {
      audio.pause();
      audio.src = "";
      audio.remove();
    }
    audio = document.createElement("audio");
    audio.preload = "auto";
    audio.hidden = true;
    audio.src = url;
    document.body.appendChild(audio);

    audio.playbackRate = SPEEDS[speedIndex];
    // Keep pitch constant at non-1x rates and match the video element.
    audio.preservesPitch = true;
    video.preservesPitch = true;
    applyAudible();

    // Mirror current playback state onto the freshly attached track.
    syncAudioToVideo();
    if (!video.paused) {
      audio.play().catch(function () {});
    }

    audio.addEventListener("error", function () {
      showStatus("Audio playback error", "warning");
    });

    clearStatus();
  }

  // ----- Drift correction -----
  function correctDrift() {
    if (!audio) {
      return;
    }
    if (!audio.paused && !video.paused) {
      if (Math.abs(audio.currentTime - video.currentTime) > DRIFT_THRESHOLD) {
        audio.currentTime = video.currentTime;
      }
    }
  }

  // ----- Video element events -----
  video.addEventListener("loadedmetadata", function () {
    timeDur.textContent = formatTime(video.duration);
    renderProgress();
  });

  video.addEventListener("durationchange", function () {
    timeDur.textContent = formatTime(video.duration);
  });

  video.addEventListener("timeupdate", function () {
    if (!scrubbing) {
      timeCur.textContent = formatTime(video.currentTime);
      renderProgress();
    }
    correctDrift();
  });

  video.addEventListener("progress", renderBuffered);

  video.addEventListener("play", function () {
    player.classList.add("is-playing");
    player.classList.remove("is-paused");
    if (audio && audio.paused) {
      syncAudioToVideo();
      audio.play().catch(function () {});
    }
  });

  video.addEventListener("pause", function () {
    player.classList.remove("is-playing");
    player.classList.add("is-paused");
    if (audio && !audio.paused) {
      audio.pause();
    }
  });

  video.addEventListener("seeking", function () {
    if (audio) {
      audio.currentTime = video.currentTime;
    }
  });

  video.addEventListener("ended", function () {
    if (audio) {
      audio.pause();
    }
  });

  video.addEventListener("error", function () {
    let detail = "Unknown playback error";
    if (video.error) {
      switch (video.error.code) {
        case 1: detail = "Playback aborted"; break;
        case 2: detail = "Network error while streaming video"; break;
        case 3: detail = "Video could not be decoded"; break;
        case 4: detail = "Video format is not supported"; break;
      }
    }
    vscode.postMessage({ type: "error", message: detail });
    showStatus(detail, "warning");
  });

  // ----- Control wiring -----
  playBtn.addEventListener("click", togglePlay);
  stage.addEventListener("click", togglePlay);

  back10Btn.addEventListener("click", function () { nudge(-10); });
  fwd10Btn.addEventListener("click", function () { nudge(10); });

  muteBtn.addEventListener("click", toggleMute);
  volSlider.addEventListener("input", onVolumeInput);

  speedBtn.addEventListener("click", cycleSpeed);

  // ----- Seek bar interaction (click + drag-scrub) -----
  function beginScrub(evt) {
    scrubbing = true;
    wasPlayingBeforeScrub = !video.paused;
    seek.classList.add("scrubbing");
    moveScrub(evt);
  }

  function moveScrub(evt) {
    if (!scrubbing) {
      return;
    }
    const t = timeFromEvent(evt);
    const dur = isFinite(video.duration) ? video.duration : 0;
    const pct = dur > 0 ? (t / dur) * 100 : 0;
    seekPlayed.style.width = pct + "%";
    seekHandle.style.left = pct + "%";
    timeCur.textContent = formatTime(t);
  }

  function endScrub(evt) {
    if (!scrubbing) {
      return;
    }
    const t = timeFromEvent(evt);
    scrubbing = false;
    seek.classList.remove("scrubbing");
    seekTo(t);
    if (wasPlayingBeforeScrub) {
      play();
    }
  }

  seek.addEventListener("mousedown", function (evt) {
    evt.preventDefault();
    beginScrub(evt);
  });
  window.addEventListener("mousemove", moveScrub);
  window.addEventListener("mouseup", endScrub);

  // touch support
  seek.addEventListener("touchstart", function (evt) {
    beginScrub(evt);
  }, { passive: true });
  seek.addEventListener("touchmove", function (evt) {
    moveScrub(evt);
  }, { passive: true });
  seek.addEventListener("touchend", endScrub);

  // ----- Picture in Picture -----
  const pipSupported = document.pictureInPictureEnabled &&
    typeof video.requestPictureInPicture === "function";
  if (!pipSupported) {
    pipBtn.hidden = true;
  }

  function togglePip() {
    if (!pipSupported) {
      return;
    }
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(function () {});
    } else {
      video.requestPictureInPicture().catch(function () {});
    }
  }
  pipBtn.addEventListener("click", togglePip);

  // ----- Fullscreen -----
  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(function () {});
    } else if (stage.requestFullscreen) {
      stage.requestFullscreen().catch(function () {});
    }
  }
  fsBtn.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", function () {
    player.classList.toggle("is-fullscreen", !!document.fullscreenElement);
  });

  // ----- Action row -----
  openExternalBtn.addEventListener("click", function () {
    vscode.postMessage({ type: "action", name: "openExternal" });
  });
  copyPathBtn.addEventListener("click", function () {
    vscode.postMessage({ type: "action", name: "copyPath" });
  });

  // ----- Keyboard shortcuts -----
  function isTypingTarget(el) {
    if (!el) {
      return false;
    }
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
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
        togglePlay();
        break;
      case "m":
      case "M":
        toggleMute();
        break;
      case "j":
      case "J":
      case "ArrowLeft":
        nudge(-10);
        break;
      case "l":
      case "L":
      case "ArrowRight":
        nudge(10);
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
  applyRate();
  player.classList.add("is-paused");
  vscode.postMessage({ type: "ready" });
})();
