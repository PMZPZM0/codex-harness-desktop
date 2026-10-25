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
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { bossStore } from "../boss-groups/store";
import { addTaskForBoss, browserStatus, createGroupForBoss, dispatchTask, memberForBoss, pinForBoss, poolForBossIpc, postToBoss, reviewTask, sayToGroup, setBossEventSink, statusForBoss, tickAll, watchBossReplies } from "../boss-groups/runner";
import { recordReview, resolveEscalation } from "../boss-groups/state";
import type { EscalateChoice } from "../boss-groups/types";
import { broadcastCodexEvent } from "./window-bus";

/** BOSS 会话的角色提示（写进 `<userData>/boss-home/AGENTS.md`，引擎自动注入）。 */
const BOSS_HOME_AGENTS_MD = `# 你是 BOSS

这个会话是**BOSS 会话**：用户在这里提需求，你负责拉群、派活、审活。它不属于任何项目，
不要在这里改代码 —— 干活的是你拉进来的成员会话（跑在用户选的项目目录里）。

## 你的工具
- \`group_create\` 建群：群名 + 成员清单（每人有名字、岗位；成员各自是一条常驻会话）
- \`group_add_member\` / \`group_remove_member\` 拉人 / 移人：可从专家、专家团、本机 CLI agent 里拉
- \`group_assign\` 派活：title / brief / criteria 三个都必填，criteria 是**验收标准**
- \`group_status\` 看群：成员、任务、进度
- \`group_review\` 审查：通过或打回重做
- \`group_escalate\` 打回次数用尽时升级给用户
- \`group_browser_setup\` 需要浏览器能力时检查

## 怎么干活
1. 用户说需求 → 判断要几个人、什么岗位 → \`group_create\`
2. 立刻 \`group_assign\` 把第一个活派下去（⛔ 不要等用户催）
3. 成员在各自会话里干活，完成后把成品交回来；你按 criteria 审查
4. 不过就 \`group_review\` 打回（默认最多 2 次），还不行 \`group_escalate\` 问用户
5. 全程中文、短句，别写长篇报告

## 硬约束
- 派活是**异步**的：不要在这里等结果，交活 / 审查 / 打回会以 [群事件] 回到你这里
- 不要假装完成：没派活就说没派活
- 这个会话会一直用下去，不会每轮新建
`;

const TICK_MS = 5000;

export const bossGroupsFeature = defineFeature<null>({
  id: "boss-groups",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("boss-groups: 缺少 ipc 服务（宿主未提供）");

    setBossEventSink((payload) => broadcastCodexEvent(payload));

    /* ⛔ 10-25 用户令：BOSS 会话要**完全独立**（项目记忆 / 技能 / logs 都不跟普通会话共享）。
       做法 = 它跑在自己的目录 `<userData>/boss-home`（那里没有 AGENTS.md、没有项目 .codex）
       ⇒ 项目级记忆天然为空；群成员仍在用户选的项目目录里干活（group.workspace）。
       目录在这里顺手建好（复用 list 通道，⛔ 不为它新开一条 IPC）。 */
    const bossHomeDir = path.join(app.getPath("userData"), "boss-home");
    try {
      fs.mkdirSync(bossHomeDir, { recursive: true });
      /* 10-25 用户令：「内置注入好提示词，让 Codex 知道」。
         BOSS 会话的 cwd 就是这里 ⇒ 引擎自己会读这份 AGENTS.md，零额外注入通道。
         ⛔ 只写一次（用户可能自己改过，绝不覆盖）。 */
      const bossAgentsMd = path.join(bossHomeDir, "AGENTS.md");
      if (!fs.existsSync(bossAgentsMd)) fs.writeFileSync(bossAgentsMd, BOSS_HOME_AGENTS_MD, "utf8");
    } catch { /* 建不了就让引擎报错，别吞 */ }
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

    /* BOSS 会话的会话 id 重绑（10-25）：rollout 丢了的会话引擎无法继续，渲染层会重建一个会话
       把消息发过去 —— 这里把群账本的 bossThreadId 改到新会话，群事件才回得到它。
       ⛔ 不重绑 = 每次发消息侧栏多一个会话、群事件回不到 BOSS（用户点名「不要新建会话」）。 */
    ipcHost.handle("boss-groups:rebind", async (_event, input: any) => {
      const previous = String(input?.previousThreadId ?? "");
      const next = String(input?.threadId ?? "");
      if (!previous || !next) return { ok: false, error: "缺 previousThreadId / threadId" };
      const state = await bossStore.load();
      const hit = Object.values(state.groups).filter((group) => group.bossThreadId === previous);
      for (const group of hit) group.bossThreadId = next;
      if (hit.length) {
        bossStore.save();
        broadcastCodexEvent({ type: "boss-group", phase: "group", groupId: hit[0].id, status: "rebound" });
      }
      return { ok: true, rebound: hit.length };
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
