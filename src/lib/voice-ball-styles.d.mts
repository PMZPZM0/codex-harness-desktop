export type VoiceBallStyle = { id: string; name: string; desc: string };

export const VOICE_BALL_STYLES: VoiceBallStyle[];
export const DEFAULT_VOICE_BALL_STYLE: string;
export function normalizeVoiceBallStyle(value: unknown): string;
