/**
 * 发送入场动画的「相位续播」判定（纯函数，便于预检做行为断言）。
 *
 * 背景（09-17 实测）：发消息的入场动画只登记在**乐观气泡**上，而引擎回声的真实消息几十毫秒内接管、
 * 气泡随之卸载 —— 动画刚起头就被打断，消息"啪"地跳到最终位置。让真实消息挂载时认领动画能解决
 * "动画完全丢失"，但认领时**从 0% 重新起手**，与气泡已播的那一小段接不上，视觉上仍会"顿一下再飞"。
 *
 * 修法：认领时返回「距发送已流逝的毫秒」，真实节点用负 `animation-delay` 从同一相位接着播，
 * 两段首尾相接。本模块只管这段时序判定，DOM 侧由 App.tsx 落到 inline style。
 *
 * 三种结果：
 *   none     —— 不认领（没有登记 / 文本对不上 / 超过 10s TTL）
 *   skip     —— 认领但**不播**：已流逝 ≥ 整段动画时长（引擎慢，消息早已在屏幕上，再"飞"一下更怪）
 *   continue —— 从 delayMs 相位续播（0 ≤ delayMs < 时长）
 */

/** 入场动画时长（毫秒）——必须与 styles.css 的 `user-msg-send-in` 一致 */
export const SEND_ANIM_DURATION_MS = 550;
/** 登记的有效期：超过这么久就不再认领（避免历史消息/切会话误播） */
export const SEND_CLAIM_TTL_MS = 10_000;

const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

/** 建一个登记槽（每个 App 实例一个；测试里可随意造） */
export function createSendAnimClaim() {
  return { claim: null };
}

/** 发送时登记待认领的入场动画（存可见正文；引擎侧正文会额外拼记忆/技能/引用段） */
export function armSendAnimationClaim(store, messageText, now) {
  const text = normalize(messageText);
  if (text) store.claim = { text, at: now };
}

/**
 * 真实消息挂载时认领：命中即消费（一次性）。
 * @returns {{ kind: "none" } | { kind: "skip" } | { kind: "continue", delayMs: number }}
 */
export function claimSendAnimation(store, messageText, now) {
  const claim = store.claim;
  store.claim = null;                                  // 无论是否播都消费掉，避免以后误认领
  if (!claim) return { kind: "none" };
  const elapsed = now - claim.at;
  if (!(elapsed >= 0) || elapsed > SEND_CLAIM_TTL_MS) return { kind: "none" };
  const text = normalize(messageText);
  if (!text.includes(claim.text.slice(0, 12))) return { kind: "none" };   // 前缀匹配：真实正文可能带引用/记忆前缀
  if (elapsed >= SEND_ANIM_DURATION_MS) return { kind: "skip" };
  return { kind: "continue", delayMs: elapsed };
}
