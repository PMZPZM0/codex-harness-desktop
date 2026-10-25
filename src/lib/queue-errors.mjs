/**
 * 队列启动类 RPC 的「伪失败」判据（09-24）。
 *
 * 背景（真机实测，不是推断）：**排队消息由引擎自己启动** —— 上一回合结束后约 9ms，引擎就发
 * `thread/queue/changed` 并把队列清空。于是宿主这几处「我来启动下一条」的 `thread/queue/start`
 * 会**落在引擎之后**，引擎回：
 *   · `queued submission not found: <id>`（已经启动并出队）
 *   · `queue is empty`（队列已清空）
 * 这两种情况下**消息其实是正常发出去的**（用户 09-24 截图：消息正常、却弹「队列启动失败」）——
 * 报错纯属噪声，应按成功处理：不弹 toast、**保留**钉顶意图（消息确实要出现）。
 *
 * ⛔ 不要把它当成「失败也要吞」的兜底：只吞这一族「已经被启动 / 已不在队列」的措辞。
 * ⛔ `no active turn` **不属于**这里（那是 steer 的陈旧运行态，语义是「退化为新回合」，见
 *    part04 的 startQueued）；`thread not found` 之类也不属于。
 */
export function isQueueAlreadyStartedError(message) {
  return /queued submission not found|queue is empty|no such (?:queued )?submission/i.test(String(message ?? ""));
}

/**
 * 「线程已有活动或待处理回合」这一族（10-26 用户现场）。
 *
 * 真机报错原文：`[ERR_INVOKE_FAILED] coderequest: Error invoking remote method
 * 'coderequest: Error: thread already has an active or pending turn'`。
 *
 * ⛔ 这**不是**失败：引擎那边确实还有一个回合在跑（或队列里有一条待启动）
 *   ⇒ 我们这次"启动下一条"本就不该成功，引擎拒绝是**正确行为**。
 *   ⛔ 之前它被当成失败弹了红错（用户截图顶部那条），纯属噪声。
 *   ⇒ 按成功处理：不弹 toast、**保留**钉顶意图（那条消息确实会出现，只是晚点）。
 */
export function isQueueBusyError(message) {
  return /thread already has an active or pending turn|already has an active or pending/i.test(String(message ?? ""));
}
