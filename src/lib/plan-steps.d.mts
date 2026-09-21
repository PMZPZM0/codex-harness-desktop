/** `plan-steps.mjs` 的类型声明。
 *  项目惯例：每个 `src/lib/*.mjs` 配一个 `.d.mts` —— `tsconfig.app.json` 是 `allowJs: false`，
 *  没有声明文件时 import 会报 TS7016（implicitly has an 'any' type）。 */
export type PlanStep = { text: string; done: boolean };
export function parsePlan(text: string): { intro: string; steps: PlanStep[] };
export function serializePlan(intro: string, steps: PlanStep[]): string;
