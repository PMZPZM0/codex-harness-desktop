export declare const VOICE_DELEGATION_TAG: string;
export declare function buildVoiceDelegationPrompt(input: {
  objective: string;
  context?: { role?: string; content?: string }[];
  purpose?: string;
}): string;
export declare function isVoiceDelegationPrompt(text: unknown): boolean;
