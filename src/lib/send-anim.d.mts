export declare const SEND_ANIM_DURATION_MS: number;
export declare const SEND_CLAIM_TTL_MS: number;
export declare function createSendAnimClaim(): { claim: { text: string; at: number } | null };
export declare function armSendAnimationClaim(store: { claim: { text: string; at: number } | null }, messageText: string, now: number): void;
export declare function claimSendAnimation(
  store: { claim: { text: string; at: number } | null },
  messageText: string,
  now: number
): { kind: "none" } | { kind: "skip" } | { kind: "continue"; delayMs: number };
