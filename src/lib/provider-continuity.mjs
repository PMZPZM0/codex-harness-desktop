// src/lib/provider-continuity.mjs —— 供应商「自动接力」的判定与文案（纯函数、零依赖）
//
// 背景（09-14 用户定稿）：切换供应商后，旧会话必须能直接继续用 —— 也就是「自动接力」：
//   ① 原地迁移优先：thread/resume 重绑定（threadId 不变 → 历史、消息、侧栏位置全不动）
//   ② 原地失败 → fork 接力：新会话带完整历史，旧会话自动归档
// 文案与判定集中在这里，是为了：UI 四处场景（打开 / 发送 / 401 / 切换）口径一致，
// 并且离线预检能直接 import 断言（scripts/check-preflight.mjs）。

/**
 * 是否需要把会话对齐到当前激活供应商。
 * ⛔ 绑定未知（本次启动还没 resume 过该会话）一律**不迁移**：引擎是会话绑定的唯一权威，
 *    拿不到真实绑定就不猜——调用方（发送路径）会先做一次轻量 probe 拿真实绑定再决定。
 *    这与迁移机制此前「仅在已确认绑定的前提下迁移」的行为一致，避免误迁。
 */
export function shouldAlignProvider(boundProvider, activeProvider) {
  const bound = String(boundProvider ?? "").trim();
  const active = String(activeProvider ?? "").trim();
  if (!bound || !active) return false;
  return bound !== active;
}

/**
 * 「自动接力」统一文案（用户可感知的关键点：接力 / 历史没丢）。
 * label 形如 `供应商名 · 模型名`。
 */
export const CONTINUITY_TEXT = {
  aligning: (label) => `检测到供应商已切换，正在把该会话自动接力到 ${label}…`,
  migrated: (label) => `该会话已自动接力到 ${label}，历史上下文与聊天记录完整保留`,
  relayed: (label) => `已自动接力到新会话（${label}），历史上下文与聊天记录完整保留，原会话已归档`,
  failed: (label) => `无法把该会话接力到 ${label}，请新建会话继续（原会话历史保留）`,
};

/** 会话「接力」结果的语义（供 UI 判断后续动作，不要用裸字符串比较）。 */
export const ALIGN_RESULT = {
  same: "same", // 无需迁移（绑定一致 / 绑定未知）
  migrated: "migrated", // 原地迁移成功（threadId 不变）
  relayed: "relayed", // fork 接力成功（新会话 + 旧会话已归档）
  failed: "failed", // 两条路都失败
};
