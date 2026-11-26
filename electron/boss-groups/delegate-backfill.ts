/**
 * 中枢成员会话的委托登记 · **存量补齐**（11-26 立）
 *
 * ── 为什么要有这个文件 ──────────────────────────────────────────────────
 * 中枢（指挥中枢）的成员会话是 `runner.ts` 自己 `thread/start` 建的，历史上**从不登记**到
 * 委托登记表 ⇒ 侧栏「子会话 · N」折叠块与右侧头像轨都读不到归属：
 *   · 侧栏：`buildDispatchChildren` 只按 `delegateRecords[id].originThreadId` 收编；
 *   · 头像轨：`delegate-run` 事件由登记表产出，没登记就没有运行反馈。
 * 派活链路已在 11-26 补上登记，但**已经存在的成员会话**不会凭空出现（用户看到的就是
 * 「望舒下面有子会话、抱朴下面没有」）。这里在启动时按中枢台账把它们一次性补进去，幂等。
 *
 * ── 边界 ────────────────────────────────────────────────────────────────
 * · 只补**有 threadId 且不是 CLI 成员**的（CLI 成员没有引擎会话，登记它只会多一条幽灵记录）；
 * · 已有记录就跳过（⛔ 不覆盖运行中的状态、不改产出）；
 * · 补进来的记录一律 `done`（历史会话此刻没在跑）—— `register` 默认是 running，
 *   若不立刻收口，头像会永远亮着；
 * · 失败静默：补齐是锦上添花，⛔ 不许挡住启动。
 */
import { delegateRegistry } from "../runtime-refs";
import { bossStore } from "./store";
import { broadcastHarnessEvent } from "../features/window-bus";

/** 把存量中枢成员会话补进委托登记表；返回补了几条（幂等，重复调用 0 条）。 */
export async function backfillBossMemberDelegates(): Promise<number> {
  try {
    const state = await bossStore.load();
    const groups = Object.values((state as { groups?: Record<string, any> }).groups ?? {}) as Array<Record<string, any>>;
    let patched = 0;
    /* ⛔ 同一个专家会被拉进多个群（member.threadId 相同）⇒ 按线程去重计数，
       否则日志报「补登记 9 条」而文件只有 3 条，看着像又丢了数据（11-26 实测踩过）。 */
    const seen = new Set<string>();
    for (const group of groups) {
      const bossThreadId = String(group?.bossThreadId ?? "").trim();
      if (!bossThreadId) continue;
      for (const member of (group?.members ?? []) as Array<Record<string, any>>) {
        const threadId = String(member?.threadId ?? "").trim();
        if (!threadId || String(member?.source ?? "") === "cli") continue;
        if (seen.has(threadId)) continue;
        seen.add(threadId);
        /* ⛔ 已有记录（新链路派过活的）不动 —— 状态/产出都比这里能补的更准。 */
        const existing = await delegateRegistry.infoOf(threadId).catch(() => null);
        if (existing) continue;
        await delegateRegistry.register({
          threadId,
          originThreadId: bossThreadId,
          kind: "expert",
          name: String(member?.name ?? ""),
          depth: 1,
          targetKey: `boss-member:${String(member?.id ?? threadId)}`,
        });
        /* ⛔ register 默认 running ⇒ 必须立刻收口，否则侧栏显示「调度中」、头像一直亮。 */
        await delegateRegistry.markStatus(threadId, "done");
        patched += 1;
      }
    }
    if (patched) {
      /* ⛔ 显式落盘：登记表内部是 120ms 合并写，启动阶段进程可能很快转入其它初始化
         （实测：内存里补了 11 条，文件里只落 3 条 ⇒ 下次启动又不一致）。 */
      await delegateRegistry.flush();
      broadcastHarnessEvent({ type: "delegates-changed" } as never);
      console.log("[boss-delegates] 存量成员会话补登记 " + patched + " 条（侧栏子会话 / 右侧运行反馈的数据前提）");
    }
    return patched;
  } catch {
    return 0; /* 补齐失败不挡启动 */
  }
}
