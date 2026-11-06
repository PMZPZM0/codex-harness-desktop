/** cli-install.mjs 的类型声明（TS7016：.mjs 需配 .d.mts） */

export function parseInstallCommand(cmd: unknown): { manager: "" | "npm" | "pip"; packages: string[]; options: string[]; error: string };
export function normalizeVersion(value: unknown): string;
export function compareVersions(a: unknown, b: unknown): -1 | 0 | 1;
export function hasCliUpdate(current: unknown, latest: unknown): boolean;
export function withLatestPackage(spec: unknown): string;
export function basePackageName(spec: unknown): string;
