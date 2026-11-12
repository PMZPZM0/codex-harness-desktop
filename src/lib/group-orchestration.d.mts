/** group-orchestration.mjs 的类型声明（TS7016：.mjs 需配 .d.mts） */

export interface OrchestrationRule {
  id: string;
  enabled: boolean;
  label: string;
}

export interface ProgressVerdict {
  claim: boolean;
  evidence: number;
  ok: boolean;
  notice: string;
}

export interface SpeakInput {
  memberId?: string;
  spokeSince?: string[];
  ranCount?: number;
  maxTurnsPerMember?: number;
  known?: string[];
}

export interface SelectSpeakersInput extends Omit<SpeakInput, "memberId" | "ranCount"> {
  candidates?: Array<string | { id?: string }>;
  budget?: number;
  spokeSince?: string[];
  known?: string[];
  maxTurnsPerMember?: number;
  ranCount?: Map<string, number> | Record<string, number>;
}

export interface StopInput {
  itemsTotal?: number;
  itemsDone?: number;
  chainBudget?: number;
  maxTurnsPerMember?: number;
  ranCount?: Map<string, number> | Record<string, number>;
  declined?: number;
}

export declare const ORCHESTRATION_RULES: Readonly<Record<"progressClaim" | "speakerSelection" | "hostTermination", Readonly<OrchestrationRule>>>;
export declare const DISPATCH_TOOL_NAMES: readonly string[];
export declare const PROGRESS_CLAIM_RE: RegExp;
export declare function verifyProgressClaim(input?: { text?: string; toolCalls?: Array<{ name?: string } | string>; memberOutputs?: unknown[] }): ProgressVerdict;
export declare function canSpeak(input?: SpeakInput): boolean;
export declare function selectNextSpeakers(input?: SelectSpeakersInput): string[];
export declare function shouldStopGroupTurn(input?: StopInput): { stop: boolean; reason: string };
