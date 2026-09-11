// src/lib/model-recency.mjs —— 会话模型「谁后改谁生效」判定（纯函数，零依赖）
//
// 为什么单独成文件、且写成 .mjs：
//   渲染层要用它（openThread 回填模型），离线预检 scripts/check-preflight.mjs 也要跑它的
//   行为断言——node 能直接 import .mjs，不用转译。本仓库 tsconfig 的 allowJs 是关的，
//   所以类型走同目录的 model-recency.d.mts，渲染层 import 时照样有类型。
//
// 背景（09-11 实证）：模型是**会话级**状态，`thread/resume` 不带 model，渲染层打开会话时
// 用 localStorage 的 `thread-model-<id>` 回填并推给引擎。旧逻辑**无条件偏向会话记录**——
// 用户在新会话页/设置页改了全局模型后，打开旧会话仍然跑老模型（表现为「我切换的模型没生效」
// 「思考又是英文」——因为实际跑的还是那个说英文的旧模型）。
//
// 修法：给「用户显式选择」打时间戳（全局一份、每会话一份），回填时谁更晚被选中就用谁。
// 注意只有**用户亲手选**才打戳；自动回填/新建时的写入不记时，否则回填会把会话记录的新鲜度
// 刷成「现在」，永远压过全局。

export const DEFAULT_MODEL_AT_KEY = "default-model-at";

/** 每会话「用户显式选过模型」的时刻（毫秒）所存的 key */
export const threadModelAtKey = (id) => `thread-model-at-${id}`;

/**
 * 打开会话时决定用哪个模型。
 *
 * @param {{ stored?: string, storedAt?: number, global?: string, globalAt?: number }} input
 *   - `stored` / `global`：模型 id（`custom:<provider>:<model>` 形态；空串 = 从未选过）
 *   - `storedAt` / `globalAt`：该选择被**用户显式指定**的时刻（毫秒；0 = 从未显式选过）
 * @returns {string} 生效的模型 id（可能为空串，由调用方继续兜底）
 */
export function resolveEffectiveModel(input) {
  const stored = String(input?.stored ?? "");
  const global = String(input?.global ?? "");
  const storedAt = Number(input?.storedAt ?? 0) || 0;
  const globalAt = Number(input?.globalAt ?? 0) || 0;
  // 全局比会话记录更晚被显式选中 → 用全局（用户刚改的模型要生效）；
  // 否则会话记录优先（用户在某个会话里亲手选过的，才算这个会话自己的模型）。
  // storedAt 为 0 表示「这个会话没有过显式选择」（记录只是自动回填的），此时全局直接胜出。
  if (global && global !== stored && globalAt > storedAt) return global;
  return stored || global || "";
}
