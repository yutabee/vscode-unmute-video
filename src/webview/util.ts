/**
 * Pure, DOM-free helpers for the webview player. Kept isolated from any DOM or
 * media-element access so they can be unit-tested directly in Node (see
 * test/webviewUtil.test.js, which requires the CommonJS build at
 * out/webview/util.js).
 */

/** Format a duration in seconds as `m:ss` (or `h:mm:ss` past an hour). */
export function formatTime(seconds: number): string {
    if (!isFinite(seconds) || seconds < 0) {
        seconds = 0;
    }
    const total = Math.floor(seconds);
    const s = total % 60;
    const m = Math.floor(total / 60) % 60;
    const h = Math.floor(total / 3600);
    const ss = String(s).padStart(2, '0');
    if (h > 0) {
        const mm = String(m).padStart(2, '0');
        return h + ':' + mm + ':' + ss;
    }
    return m + ':' + ss;
}

/** Clamp `value` into the inclusive [min, max] range. */
export function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(value, max));
}

/**
 * The 0..1 position of `clientX` within a horizontal rect starting at `left`
 * with the given `width`, clamped to the rect. A non-positive width yields 0.
 */
export function ratioInRect(clientX: number, left: number, width: number): number {
    if (width <= 0) {
        return 0;
    }
    return clamp((clientX - left) / width, 0, 1);
}

/** A contiguous buffered span, mirroring one entry of a TimeRanges object. */
export interface BufferedRange {
    start: number;
    end: number;
}

/**
 * Given the buffered ranges and the current playback time, return the farthest
 * buffered end among the ranges that have already started at or before
 * `currentTime`. Returns 0 when nothing relevant is buffered.
 */
export function latestBufferedEnd(ranges: readonly BufferedRange[], currentTime: number): number {
    let end = 0;
    for (const range of ranges) {
        if (range.start <= currentTime) {
            end = Math.max(end, range.end);
        }
    }
    return end;
}
