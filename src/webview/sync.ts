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
