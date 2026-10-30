/**
 * 每个会话**当前在用的模型**（threadId → model / provider / provider 配置）。
 *
 * ⛔⛔ 为什么需要（10-30 实测定案）：宿主侧那些"借用本会话模型"的功能（任务监控的自我改进建议、
 *   记忆蒸馏等）原先一律读 `readCustomModel()` —— 用**官方供应商**的用户根本没有自定义模型，
 *   于是每次都抛「尚未配置自定义模型」，面板上的建议永远是空的（用户看到的就是"光做个壳"）。
 *   引擎在 `turn/start` 里已经拿到了这一轮真实的 model / provider / config，宿主顺手记一份即可，
 *   不需要再猜、也不需要让用户重复配置。
 *
 * ⛔ 只记**内存**：它是运行时事实，重启后由下一次 turn/start 重新填；落盘反而会留下过期模型名。
 * ⛔ 键是 threadId（会话各自独立）—— 不同会话可以用不同模型，⛔ 不许拿"最后一个"给所有人用。
 */
export type ThreadModel = {
  model: string;
  /** provider id（openai / 自定义别名…） */
  provider: string;
  /** provider 表（base_url / wire_api 等）：与 turn/start 传下去的那份一致 */
  config?: Record<string, unknown>;
};

const models = new Map<string, ThreadModel>();

/** 记录某个会话这一轮用的模型（codex-ipc 在转发 turn/start 时调用）。 */
export function noteThreadModel(threadId: string, model: ThreadModel): void {
  const id = String(threadId ?? "").trim();
  if (!id || !model?.model) return;
  models.set(id, { model: model.model, provider: model.provider || "openai", config: model.config });
}

/** 取该会话最近一次用的模型；没有记录返回 null（⛔ 不跨会话兜底）。 */
export function threadModelOf(threadId: string): ThreadModel | null {
  const id = String(threadId ?? "").trim();
  return id ? models.get(id) ?? null : null;
}

/** 会话被删时清掉，避免同一根线程 id 复用后指向过期模型。 */
export function forgetThreadModel(threadId: string): void {
  models.delete(String(threadId ?? "").trim());
}
