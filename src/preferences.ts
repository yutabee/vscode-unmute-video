export interface Preferences {
    volume: number;
    muted: boolean;
    playbackRate: number;
}

export const ALLOWED_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

const DEFAULT_PREFERENCES: Preferences = {
    volume: 1,
    muted: false,
    playbackRate: 1,
};

export function clampPreferences(raw: unknown): Preferences {
    if (typeof raw !== 'object' || raw === null) {
        return { ...DEFAULT_PREFERENCES };
    }

    const prefs = raw as Record<string, unknown>;
    const volume = typeof prefs.volume === 'number' && Number.isFinite(prefs.volume)
        ? Math.min(1, Math.max(0, prefs.volume))
        : DEFAULT_PREFERENCES.volume;
    const playbackRate = typeof prefs.playbackRate === 'number' && ALLOWED_RATES.some((rate) => rate === prefs.playbackRate)
        ? prefs.playbackRate
        : DEFAULT_PREFERENCES.playbackRate;

    return {
        volume,
        muted: prefs.muted === true,
        playbackRate,
    };
}
