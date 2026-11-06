/** 用量账本（纯函数，见 team-ledger.mjs） */

export interface LedgerEntry {
  at: number;
  groupId: string;
  groupName: string;
  memberId: string;
  partnerName: string;
  source: "human" | "partner" | "automation";
  threadId: string;
  chars: number;
  ms: number;
  ok: boolean;
  error: string;
}

export interface LedgerBucket {
  count: number;
  chars: number;
  ms: number;
  failed: number;
  avgMs: number;
}

export interface LedgerPartnerBucket extends LedgerBucket {
  memberId: string;
  name: string;
}

export interface LedgerSourceBucket extends LedgerBucket {
  source: string;
}

export interface LedgerSummary {
  window: { since: number; days: number; groupId: string };
  total: LedgerBucket & { partners: number };
  byPartner: LedgerPartnerBucket[];
  bySource: LedgerSourceBucket[];
}

export const MAX_LEDGER_ENTRIES: number;
export const LEDGER_SOURCE_LABELS: Readonly<Record<string, string>>;
export function normalizeLedgerEntry(entry: unknown): LedgerEntry | null;
export function appendLedger(list: LedgerEntry[] | null | undefined, entry: unknown, max?: number): LedgerEntry[];
export function summarizeLedger(
  entries: unknown,
  options?: { sinceMs?: number; groupId?: string; nowMs?: number; days?: number },
): LedgerSummary;
export function formatChars(n: number): string;
export function formatMs(ms: number): string;
