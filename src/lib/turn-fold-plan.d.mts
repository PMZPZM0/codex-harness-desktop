// src/lib/turn-fold-plan.d.mts —— turn-fold-plan.mjs 的类型（tsconfig 关着 allowJs，
// 渲染层靠这份声明拿到类型；实现在 .mjs 里，预检直接 import 那份跑行为断言）。
import type { FoldUnit } from "./turn-fold";

export declare const FOLD_BODY_ANCHOR_CHARS: number;

export type CompletedFoldPlanEntry =
  | { kind: "fold"; units: FoldUnit[] }
  | { kind: "body"; unit: FoldUnit };

export declare function planCompletedFold(units: FoldUnit[], finalAgentId?: string): CompletedFoldPlanEntry[];
