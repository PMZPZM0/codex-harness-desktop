/** SkillInstallState（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */

export type SkillInstallState = { skill: MarketSkillEntry; current: number; failed?: string; engineRegistered?: boolean; engineCheckMessage?: string };
