export const RESUME_END_THRESHOLD_SEC = 5;

export function resumeKey(fsPath: string): string {
    return `resume:${fsPath}`;
}

export function shouldResume(saved: number, duration: number, endThresholdSec: number): boolean {
    return saved > 0 && Number.isFinite(duration) && saved < duration - endThresholdSec;
}
