/** src/lib/session-names.mjs 的类型声明（.mjs 无声明会让 tsc 报 TS7016；守卫【87】也要求配套）。 */

export const USER_TITLE: string;
export const SUPERVISOR_SUFFIX: string;
export const ALIAS_POOL: string[];

export function aliasMeaningOf(alias: string | null | undefined): string;

export function pickSessionAlias(seed: string | null | undefined, used?: Set<string> | string[]): string;

export function supervisorIdOf(alias: string | null | undefined): string;

export function subordinateLabelOf(input: { alias?: string; supervisorAlias?: string } | null | undefined): string;

export function validateAlias(
  input: string | null | undefined,
  used?: Set<string> | string[],
): { ok: true; alias: string } | { ok: false; reason: string };
