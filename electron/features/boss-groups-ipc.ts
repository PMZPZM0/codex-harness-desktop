/**
 * boss-groups —— 创世 boss 的群编排域（独立板块，2026-10-24 立）
 *
 * 通道：boss-groups:list / :status / :create / :assign / :review / :escalate / :browser
 *
 * ⛔ 本域是**唯一**的状态入口：规则全在 `electron/boss-groups/state.ts`（纯函数），
 *    执行在 `electron/boss-groups/runner.ts`。域只做「通道 + 定时器 + 广播」三件事。
 * ⛔ 不做群时间线渲染（那是渲染层 P0 之后的事）：成员事件回投到 boss 会话，
 *    看板读 `boss-groups:status`。这样不会在引擎之外伪造第二条会话。
 */
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { bossStore } from "../boss-groups/store";
import { addTaskForBoss, browserStatus, createGroupForBoss, dispatchTask, memberForBoss, pinForBoss, poolForBossIpc, postToBoss, reviewTask, sayToGroup, setBossEventSink, statusForBoss, tickAll, watchBossReplies } from "../boss-groups/runner";
import { recordReview, resolveEscalation } from "../boss-groups/state";
import type { EscalateChoice } from "../boss-groups/types";
import { broadcastCodexEvent } from "./window-bus";

const TICK_MS = 5000;

export const bossGroupsFeature = defineFeature<null>({
  id: "boss-groups",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("boss-groups: 缺少 ipc 服务（宿主未提供）");

    setBossEventSink((payload) => broadcastCodexEvent(payload));

    ipcHost.handle("boss-groups:list", async () => {
      const state = await bossStore.load();
      return Object.values(state.groups).map((group) => ({
        id: group.id,
        name: group.name,
        createdAt: group.createdAt,
        paused: Boolean(group.paused),
        bossThreadId: group.bossThreadId,
        /* 群成员的会话 id（10-25 用户令：侧栏给它们打「BOSS 调度」标签）。
           ⛔ 成员会话是派活时新建的，不走 delegate 登记 ⇒ 只能从这里回给渲染层。 */
        memberThreadIds: group.members.map((member) => member.threadId).filter(Boolean),
        memberCount: group.members.length,
        taskCount: Object.values(state.tasks).filter((task) => task.groupId === group.id).length,
      }));
    });

    ipcHost.handle("boss-groups:status", async (_event, groupId: string) => {
      await bossStore.load();
      return statusForBoss(String(groupId ?? ""));
    });

    ipcHost.handle("boss-groups:create", async (_event, input: any) => {
      await bossStore.load();
      return createGroupForBoss({
        name: String(input?.name ?? ""),
        workspace: String(input?.workspace ?? ""),
        bossThreadId: String(input?.bossThreadId ?? ""),
        members: Array.isArray(input?.members) ? input.members : [],
        policy: input?.policy ?? undefined,
      });
    });

    ipcHost.handle("boss-groups:assign", async (_event, input: any) => {
      await bossStore.load();
      return addTaskForBoss({
        groupId: String(input?.groupId ?? ""),
        title: String(input?.title ?? ""),
        brief: String(input?.brief ?? ""),
        criteria: String(input?.criteria ?? ""),
        assignee: input?.assignee ? String(input.assignee) : undefined,
        autoDispatch: input?.autoDispatch !== false,
      });
    });

    /** 人工/boss 直接给结论（P0 的审查默认走独立评审，这条是覆盖口）。 */
    ipcHost.handle("boss-groups:review", async (_event, input: any) => {
      const state = await bossStore.load();
      const verdict = input?.verdict === "approved" ? "approved" : "rejected";
      const task = recordReview(state, String(input?.taskId ?? ""), {
        by: String(input?.by ?? "user"),
        verdict,
        reasons: Array.isArray(input?.reasons) ? input.reasons.map(String) : [],
      });
      bossStore.save();
      const group = state.groups[task.groupId];
      if (group) void postToBoss(group, `[群事件] 审查结论（人）：${verdict === "approved" ? "通过" : "打回"}「${task.title}」${input?.reasons?.length ? `：${input.reasons.join("；")}` : ""}`);
      return { ok: true, task: { id: task.id, status: task.status, rejects: task.rejects, lockedAuthors: task.lockedAuthors } };
    });

    ipcHost.handle("boss-groups:escalate", async (_event, input: any) => {
      const state = await bossStore.load();
      const choice = String(input?.choice ?? "") as EscalateChoice;
      if (!["retry-with-other-model", "relax-criteria", "user-takeover"].includes(choice)) {
        throw new Error(`choice 只能是 retry-with-other-model / relax-criteria / user-takeover（收到「${choice}」）`);
      }
      const task = resolveEscalation(state, String(input?.taskId ?? ""), choice, String(input?.note ?? ""));
      bossStore.save();
      if (choice !== "user-takeover" && task.status === "queued") {
        const dispatched = await dispatchTask(task.id);
        return { ok: dispatched.ok, taskId: task.id, status: task.status, dispatched: dispatched.ok, error: dispatched.error };
      }
      return { ok: true, taskId: task.id, status: task.status };
    });

    ipcHost.handle("boss-groups:browser", async () => browserStatus());

    /** 拉人 / 移人（boss 工具与群视图面板共用）。移人不删会话、不打断在跑任务。 */
    ipcHost.handle("boss-groups:member", async (_event, input: any) => {
      await bossStore.load();
      const action = input?.action === "add" ? "add" : "remove";
      return memberForBoss({
        groupId: String(input?.groupId ?? ""),
        action,
        name: input?.name ? String(input.name) : undefined,
        role: input?.role ? String(input.role) : undefined,
        systemPrompt: input?.systemPrompt ? String(input.systemPrompt) : undefined,
        model: input?.model ? String(input.model) : undefined,
        effort: input?.effort ? String(input.effort) : undefined,
        memberId: input?.memberId ? String(input.memberId) : undefined,
        from: input?.from ? String(input.from) as any : undefined,
        expertTeamId: input?.expertTeamId ? String(input.expertTeamId) : undefined,
        expertMemberId: input?.expertMemberId ? String(input.expertMemberId) : undefined,
        cliName: input?.cliName ? String(input.cliName) : undefined,
        cliCommand: input?.cliCommand ? String(input.cliCommand) : undefined,
      });
    });

    /** 置顶 / 取消置顶群事件（群视图卡带，最多 3 条）。 */
    ipcHost.handle("boss-groups:pin", async (_event, input: any) => {
      await bossStore.load();
      return pinForBoss({ groupId: String(input?.groupId ?? ""), eventId: String(input?.eventId ?? ""), pinned: input?.pinned === true });
    });

    /** 可拉名单：专家/专家团 + 本机 CLI agent（带探测）。 */
    ipcHost.handle("boss-groups:pool", async () => poolForBossIpc());

    /** 你在群对话框里说话 → boss 线程（不新建会话/回合入口，回复镜像回群流）。 */
    ipcHost.handle("boss-groups:say", async (_event, input: any) => {
      await bossStore.load();
      return sayToGroup({ groupId: String(input?.groupId ?? ""), text: String(input?.text ?? "") });
    });

    /** 手动跑一次审查（模型自评之后不服、或评审会话丢了时用）。 */
    ipcHost.handle("boss-groups:recheck", async (_event, taskId: string) => reviewTask(String(taskId ?? "")));

    /* boss 线程的回复镜像进群流（「在群里回」）——全局只挂一次。 */
    watchBossReplies();

    /* ⛔ ctx.effect 是**释放钩子**（dispose 时逆序执行），不是"立即执行"的 effect ——
       定时器要在外面启动，这里只登记"怎么停"。 */
    const tickTimer = setInterval(() => { void tickAll().catch(() => undefined); }, TICK_MS);
    ctx.effect(() => clearInterval(tickTimer));

    ctx.effect(() => {
      setBossEventSink(null);
      for (const channel of ["boss-groups:list", "boss-groups:status", "boss-groups:create", "boss-groups:assign", "boss-groups:review", "boss-groups:escalate", "boss-groups:browser", "boss-groups:recheck", "boss-groups:member", "boss-groups:pin", "boss-groups:say", "boss-groups:pool"]) {
        ipcHost.removeHandler(channel);
      }
    });
  },
});
