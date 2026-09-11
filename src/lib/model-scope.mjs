// src/lib/model-scope.mjs —— 「模型选择的作用域」判定（纯函数，零依赖）
//
// 为什么单独成文件、且写成 .mjs：
//   渲染层要用它（openThread 回填模型 + 改全局默认时同步当前会话），离线预检
//   scripts/check-preflight.mjs 也要跑它的行为断言——node 能直接 import .mjs，不用转译。
//   本仓库 tsconfig 的 allowJs 是关的，所以类型走同目录的 model-scope.d.mts。
//
// 背景（09-11 两次返工后定稿）：模型是**会话级**状态——引擎 thread/resume 不回带 model，
// 模型由客户端每轮 turn/start 的 model 字段下发（rollout 的 turn_context.model 是唯一权威
// 判据）。宿主层却有三份状态（React 的 modelId、每会话 thread-model-<id>、全局 default-model）
// 十几个写入点，于是「谁说了算」很难自洽：
//
//   第一版：openThread 无条件用会话记录 → 用户改了全局默认模型，打开旧会话仍跑老模型
//           （表现「我切换的模型没生效」「思考又是英文」）。
//   第二版：改成「谁后改谁生效」（带时间戳）→ 治好了上面，但**改一次全局默认就把所有旧会话
//           的模型冲掉**，与「每个会话独立选模型」直接冲突。
//
// 定稿只有两条规则，作用域各自清晰、互不越界：
//   1) **打开会话**：该会话自己的记录优先；它还没有记录（新建 / 从没选过）才用全局默认。
//   2) **改全局默认**：永远写全局（新会话用它）；若此刻有会话打开，只把这**一个**会话一并
//      改过去（用户意图是「我改了就要生效」）；其它会话一律不动。
//
// 一句话记忆：会话内选择 = 只管这个会话；无会话时选择 = 只管新会话；
//            设置页 / 切供应商 = 当前会话 + 新会话默认。任何操作都不波及其它会话。

/**
 * 打开会话时该用哪个模型。
 *
 * @param {{ stored?: string, global?: string }} input
 *   - `stored`：该会话自己的模型记录（`custom:<provider>:<model>` 形态；空串 = 还没记录）
 *   - `global`：全局默认模型（新会话用它）
 * @returns {string} 生效的模型 id（可能为空串，由调用方继续兜底）
 */
export function resolveModelForOpen(input) {
  return String(input?.stored || input?.global || "");
}

/**
 * 用户改「全局默认模型」时，要不要顺手把当前打开的会话也改过去？
 * 要——用户改了就该生效；但调用方**只能改这一个会话**，其它会话必须原样不动。
 *
 * @param {string|null|undefined} openThreadId 当前打开的会话 id（没有会话时传空/undefined）
 * @returns {boolean}
 */
export function shouldSyncOpenThread(openThreadId) {
  return Boolean(String(openThreadId ?? ""));
}
