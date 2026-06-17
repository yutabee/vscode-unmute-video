/**
 * Pure audio/video drift-correction policy. No DOM dependency, so it is the
 * machine-checkable contract for how the separate <audio> track is kept in step
 * with the muted <video>.
 *
 * WHY this exists: the previous policy hard-set `audio.currentTime` to the video
 * clock on every `timeupdate` whenever drift passed a 0.3s threshold. Assigning
 * `currentTime` is a seek — it flushes the decode buffer and re-fetches — so a
 * steady offset (e.g. mp3 encoder delay) turned every frame into a re-seek,
 * producing audible dropouts and a buffering feedback loop. Instead we nudge the
 * audio `playbackRate` to let it gently catch up or fall back, and only hard-seek
 * when drift is so large that rate-nudging would take too long to converge.
 */

export interface DriftTuning {
  /** Within this band (seconds) audio is "in sync": run at the base rate. */
  readonly soft: number;
  /** Beyond this drift (seconds) rate-nudging is too slow: hard-seek instead. */
  readonly hard: number;
  /** How much to add/subtract from the base playbackRate while catching up. */
  readonly rateNudge: number;
}

export const DEFAULT_DRIFT_TUNING: DriftTuning = {
  soft: 0.1,
  hard: 1.0,
  rateNudge: 0.05,
};

export type DriftAction =
  /** In sync (or undecidable): caller should run audio at the base rate. */
  | { readonly kind: "none" }
  /** Catching up gently: caller should set audio.playbackRate to this value. */
  | { readonly kind: "rate"; readonly playbackRate: number }
  /** Too far apart: caller should hard-seek audio.currentTime to this value. */
  | { readonly kind: "seek"; readonly to: number };

/**
 * Decide how to correct audio drift relative to the video clock.
 *
 * `audioTime` / `videoTime` are the two elements' currentTimes. A positive
 * difference means audio is AHEAD of video. `baseRate` is the user's intended
 * playback speed (1, 1.5, ...). Returns the action the caller should apply.
 */
export function driftAction(
  audioTime: number,
  videoTime: number,
  baseRate: number,
  tuning: DriftTuning = DEFAULT_DRIFT_TUNING,
): DriftAction {
  if (!Number.isFinite(audioTime) || !Number.isFinite(videoTime)) {
    return { kind: "none" };
  }

  const diff = audioTime - videoTime;
  const magnitude = Math.abs(diff);

  if (magnitude >= tuning.hard) {
    return { kind: "seek", to: videoTime };
  }

  if (magnitude <= tuning.soft) {
    return { kind: "none" };
  }

  // Audio ahead -> slow it down; audio behind -> speed it up. Clamp so the
  // nudge can never invert or stall playback even with an odd base rate.
  const direction = diff > 0 ? -1 : 1;
  const playbackRate = Math.max(0.0625, baseRate + direction * tuning.rateNudge);
  return { kind: "rate", playbackRate };
}

/**
 * Minimum HTMLMediaElement.readyState before starting audio is worth it.
 * HAVE_FUTURE_DATA (3): enough data to advance at least one frame from the
 * current position. Below this, play() tends to stall or reject and then
 * re-drift on recovery.
 */
export const AUDIO_READY_THRESHOLD = 3;

/**
 * Whether the audio element is ready enough to start without immediately
 * stalling. Used to gate resume so we wait for `canplay`/`seeked` instead of
 * calling play() on an unbuffered/seeking element.
 */
export function canResumeAudio(readyState: number, seeking: boolean): boolean {
  return readyState >= AUDIO_READY_THRESHOLD && !seeking;
}

/**
 * play() rejections that are expected and must NOT be surfaced as errors:
 * - AbortError: a pause()/load()/seek interrupted the pending play (benign).
 * - NotAllowedError: autoplay blocked before a user gesture; the next gesture
 *   retries, so it is not a failure to report.
 * Anything else (decode/format/network) is a real failure worth showing so the
 * cause of silence is no longer hidden behind an empty catch.
 */
export function isBenignPlayError(errorName: string): boolean {
  return errorName === "AbortError" || errorName === "NotAllowedError";
}
