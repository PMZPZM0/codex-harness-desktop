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
 * ── 11-26 追加：删群残留的存量成员会话 ─────────────────────────────────
 * 用户实测「我把群都删了，群成员还在？不跟着删？」——老版本删群只清账本、成员会话留在侧栏。
 * 新链路已在 deleteGroupForBoss 里连带删；这里补**存量**：委托表 targetKey 以 `boss-member:`
 * 开头、但 threadId 不在任何现存群 members 里的，就是已删群的幽灵成员会话 ⇒ 引擎删掉。
 * ⛔ 判据不能用「originThreadId 不存在」：中枢会话本身还在（望舒），只是群账本没了。
 * ⛔ 只删 boss-member 这一类，绝不碰用户在主对话里派的活（kind=expert 但 targetKey 不同）。
 *
 * ── 边界 ────────────────────────────────────────────────────────────────
 * · 只补**有 threadId 且不是 CLI 成员**的（CLI 成员没有引擎会话，登记它只会多一条幽灵记录）；
 * · 已有记录就跳过（⛔ 不覆盖运行中的状态、不改产出）；
 * · 补进来的记录一律 `done`（历史会话此刻没在跑）—— `register` 默认是 running，
 *   若不立刻收口，头像会永远亮着；
 * · 失败静默：补齐是锦上添花，⛔ 不许挡住启动。
 */
import { delegateRegistry, server, threadCwd } from "../runtime-refs";
import { bossStore } from "./store";
import { broadcastHarnessEvent } from "../features/window-bus";
import { purgeDeletedThread } from "../features/thread-deletion";

/** 删群残留的幽灵成员会话：登记为 boss-member、但已不在任何现存群里 ⇒ 连会话一起删掉。
 *  返回清理条数；失败静默，⛔ 不挡启动（下次启动再试）。 */
async function healOrphanBossMemberThreads(
  groups: Array<Record<string, any>>,
): Promise<number> {
  let removed = 0;
  try {
    /* ⛔⛔ 安全闸（同 harness-team healOrphanTalkThreads 踩过的坑）：群账本**损坏/缺失**时
       bossStore.load() 也会返回空群表，拿它当依据会把**所有** boss-member 会话误删。
       但"用户把群删光了"（本次场景）与"文件坏了"不是一回事：前者文件在、JSON 合法、
       只是 groups 为空 ⇒ 必须照样清残留。判据 = 文件存在且能解析出合法对象。 */
    if (!(await bossStore.hasUsableFile())) return 0;
    /* 现存群的成员线程（权威归属集合）：⚠️ 已删群的 threadId 一定不在这里 */
    const live = new Set<string>();
    for (const g of groups) {
      for (const m of (g?.members ?? []) as Array<Record<string, any>>) {
        const tid = String(m?.threadId ?? "").trim();
        if (tid) live.add(tid);
      }
    }
    const records = await delegateRegistry.listAll();
    /* ⛔ 5 分钟门槛：建群时 members[].threadId 是后回填的，刚登记的成员会话可能暂时
       不在群账本里。自愈只在启动时跑，但加上这道保险就不会误删"刚建群正在初始化"的会话。 */
    const cutoff = Date.now() - 5 * 60 * 1000;
    const orphans = records.filter((r: any) => {
      const tid = String(r?.threadId ?? "");
      const key = String(r?.targetKey ?? "");
      const started = Number(r?.startedAt ?? 0);
      return key.startsWith("boss-member:") && tid && !live.has(tid) && started > 0 && started < cutoff;
    });
    const ghostIds = orphans.map((r: any) => String(r.threadId));
    for (const tid of ghostIds) {
      /* ⛔ 委托登记**无条件**清：引擎会话可能上一轮就已经删掉了（thread/delete 会抛错），
         但记录还在 = 侧栏幽灵。判据是"不在任何现存群里"，与引擎是否还有这条无关。 */
      await delegateRegistry.forget([tid]).catch(() => undefined);
      threadCwd.delete(tid);
      try {
        await server.request("thread/delete", { threadId: tid });
        /* ⛔⛔ 只调引擎 thread/delete 不够（11-26 实测踩过）：那只删引擎侧，
           墓碑 / 磁盘残留都不会动 ⇒ 重启就复活。必须走与渲染层同一套收尾。 */
        await purgeDeletedThread(tid).catch(() => undefined);
        removed += 1;
      } catch {
        /* 会话已不存在 = 目标已达成，按成功计；只有引擎真的删不掉才算失败 */
        removed += 1;
      }
    }
    /* ⛔⛔ 必须立刻 flush：forget 内部只是 scheduleSave（120ms 合并写），
       启动阶段其它模块并发 load 会把**磁盘旧内容整份覆盖回内存**（11-26 实测踩过：
       日志说清了 3 条、文件里还是 3 条，下次启动又"清"一遍）。 */
    if (ghostIds.length) await delegateRegistry.flush().catch(() => undefined);
    if (removed) {
      broadcastHarnessEvent({ type: "delegates-changed" } as never);
      console.log(`[boss-delegates] 已删群的残留成员会话清理 ${removed} 条`);
    }
  } catch { /* 自愈失败不挡启动，下次启动再试 */ }
  return removed;
}

/** 把存量中枢成员会话补进委托登记表；返回补了几条（幂等，重复调用 0 条）。 */
export async function backfillBossMemberDelegates(): Promise<number> {
  try {
    const state = await bossStore.load();
    const groups = Object.values((state as { groups?: Record<string, any> }).groups ?? {}) as Array<Record<string, any>>;
    /* 先清幽灵再补齐：顺序反了会把已删群的成员会话又登记一遍，永远清不掉 */
    await healOrphanBossMemberThreads(groups);
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
