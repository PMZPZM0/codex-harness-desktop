/**
 * vault-write-gate（10-29）：密码本「写入前一次性确认」的挂起队列。
 *
 * 为什么单独一个模块而不是塞进 bag：这是**一次性的模态询问**（像 confirm 框），
 * 只有 `VaultWriteConfirm` 一个消费者、也不需要跨会话存活；放进 bag 要动
 * bag-types + 每个 seg 的 `return {}`（易漏），收益为零。
 *
 * 语义：
 *  · `requestVaultWrite(draft)` 返回 Promise<boolean> —— 模型工具处理里 await 它；
 *  · 用户在弹窗点「允许」→ resolve(true)；点「取消」/ 关掉 → resolve(false)；
 *  · ⛔ 同一时刻只允许一个挂起请求（后到的覆盖前一个，前一个按拒绝结算）——
 *    模型一轮里连续写两条是异常，宁可让它重试，也不要屯一堆弹窗。
 */

export type VaultWriteDraft = {
  /** 有 id = 更新已有条目；无 id = 新增 */
  id?: string;
  title: string;
  username: string;
  url: string;
  note: string;
  /** 只报"有没有密码"，⛔ 明文绝不出现在这里（弹窗也只用圆点示意） */
  hasPassword: boolean;
  passwordLength: number;
};

type Pending = { seq: number; draft: VaultWriteDraft; resolve: (ok: boolean) => void };

let current: Pending | null = null;
let seq = 0;
const listeners = new Set<() => void>();

const emit = () => { for (const fn of listeners) fn(); };

/** 订阅「密码写入待确认」状态，返回退订函数。 */
export function subscribeVaultWrite(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 取当前等待确认的密码写入请求；没有返回 null。 */
export function currentVaultWrite(): Pending | null {
  return current;
}

/** 请求写入密码：弹确认浮层并等结果；⛔ 前一个还没答就按「拒绝」结算，避免调用方永远挂着。 */
export function requestVaultWrite(draft: VaultWriteDraft): Promise<boolean> {
  /* 前一个还没答就来了新的 ⇒ 老的按"拒绝"结算，避免调用方永远挂着 */
  if (current) {
    const stale = current;
    current = null;
    stale.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    current = { seq: ++seq, draft, resolve };
    emit();
  });
}

/** 结算密码写入确认（允许 / 拒绝），并唤醒等待的调用方。 */
export function settleVaultWrite(allow: boolean): void {
  const pending = current;
  current = null;
  emit();
  pending?.resolve(allow === true);
}
