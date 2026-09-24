/**
 * reasoning-part-merge：思考 summary 分段的"碎片防御"落点判定（纯函数）。
 *
 * 09-22 用户群反馈（截图）：思考卡内容碎成「好。/执行/OK」一行行 2~4 字短段，
 * 停止后重发又恢复。根因在中转网关：把每条 delta 的 summaryIndex **逐条递增**
 * （正常语义：同段内恒定、段间递增），于是每条 delta 各开一段，
 * reasoningTextOf 按段 "\n\n" 连接后就是满屏碎片。引擎/网关侧不可控 ⇒ 渲染层防御。
 *
 * 规则：新段首片（落点当前为空）时，向前找**最近的非空段**；
 * 若它是超短碎片（长度 < minChars）就并入它 —— 连续碎片自然滚成一段；
 * 前段够长（正常分段）则按原 index 落，**正常分段永远不受影响**。
 * 只影响 delta 落哪一段，不增删改任何内容。
 */
export function mergeReasoningPartIndex(parts, index, field, delta, minChars) {
  if (index <= 0) return index;
  if (field !== "summary") return index; // 只防思考 summary；content / 命令输出等不碰
  if (!delta || !String(delta).trim()) return index; // 空白增量不触发合并
  if (index < parts.length && parts[index]) return index; // 落点已有内容 = 续写既有段，不是新段
  let prev = index - 1;
  while (prev >= 0 && !(parts[prev] ?? "").length) prev -= 1;
  if (prev < 0) return index; // 前面没有非空段（不该发生，保守落原位）
  return (parts[prev] ?? "").length < minChars ? prev : index;
}
