const DEFAULT_SEEK_STEP_SECONDS = 10;

export const FRAME_STEP_SECONDS = 1 / 30;

export function resolveSeekStep(raw: unknown): number {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
        return raw;
    }
    return DEFAULT_SEEK_STEP_SECONDS;
}
