/** cli-install.mjs 的类型声明（TS7016：.mjs 需配 .d.mts） */

export function parseInstallCommand(cmd: unknown): { manager: "" | "npm" | "pip"; packages: string[]; error: string };
