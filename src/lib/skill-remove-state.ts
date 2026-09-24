/** SkillRemoveState（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */

export type SkillRemoveState = { folder: string; name: string; description: string; current: number; failed?: string; engineRemoved?: boolean; engineCheckMessage?: string };
