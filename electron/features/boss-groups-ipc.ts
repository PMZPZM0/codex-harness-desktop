/**
 * boss-groups —— 创世 boss 的群编排域（独立板块，2026-10-24 立）
 *
 * 通道：boss-groups:list / :status / :create / :delete / :assign / :review / :escalate / :browser
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
import { addTaskForBoss, browserStatus, createGroupForBoss, deleteGroupForBoss, dispatchTask, memberForBoss, pinForBoss, poolForBossIpc, postToBoss, reconcileRunningTasks, reviewTask, sayToGroup, setBossEventSink, statusForBoss, tickAll, watchBossReplies, watchMemberSettlements } from "../boss-groups/runner";
import { normalizeEscalateChoice, recordReview, resolveEscalation } from "../boss-groups/state";
import { backfillFromGroups, clearBossMemory, listBossSessions, registerBossSession, renameBossSession, unregisterBossSession } from "../boss-groups/session-registry";
import { broadcastCodexEvent } from "./window-bus";

/** BOSS 会话的角色提示（写进 `<userData>/boss-home/AGENTS.md`，引擎自动注入）。
 *  ⛔ 改内容必须同时抬 BOSS_HOME_AGENTS_VERSION —— 否则老用户的旧文件不会更新（只写一次）。 */
const BOSS_HOME_AGENTS_VERSION = "v5";
const BOSS_HOME_AGENTS_MD = `<!-- boss-home-agents:${"v5"} -->
# 你是 BOSS（主控），不亲自干活

用户在这里提需求。你的职责**只有六件**：拆需求 → 组队 → 拉群 → 派活 → 推进 → 监督与验收。
⛔ **你不亲自执行任何任务**：不写代码、不改文件、不跑命令、不做实现、不"顺手帮你改一下"。
   用户如果直接说"你帮我改"，回答一句"我拉个人来做"，然后 group_create + group_assign。
   唯一允许你自己动手的：读群状态（group_status）、审查成品（group_review）、拉人/移人。

## 你的工具（9 个）
- \`group_create\` 建群：群名 + 成员清单（每人有名字、岗位；成员各自是一条常驻会话）
- \`group_add_member\` 拉人：\`from="expert"\` 从专家/专家团登记表拉（expertTeamId + expertMemberId，或按花名 name）；
  \`from="cli"\` 拉本机命令行 agent（cliName ∈ zcode / qoder / workbuddy / deepseek / doubao，或自定义 cliCommand，
  模板里 {prompt} 换成任务全文）。**用户点名要谁就拉谁**，不要自作主张换人。
- \`group_remove_member\` 移人（⛔ 移出即删会话；移出的人永远不会自己复工，别指望他还能接活）
- \`group_delete\` 删群（用户明确说「删掉 / 不要这个群了」才用；⛔ 不可撤销，会话与产出保留）
- \`group_assign\` 派活：title / brief / criteria 三个都必填，criteria 是**验收标准**
- \`group_status\` 看群：成员、任务、进度、以及**可拉名单**（专家团成员 + 本机 CLI 是否已安装）
- \`group_review\` 审查：通过，或打回重做
- \`group_escalate\` 打回次数用尽时升级给用户
- \`group_browser_setup\` 需要浏览器能力时检查

## 怎么干活
1. 听需求 → 判断要几个人、什么岗位（人少而准，别堆人）
2. \`group_create\` 建群，成员写清岗位
3. **立刻** \`group_assign\` 把第一个活派下去（⛔ 不要等用户催、不要只说不做）
4. 成员在各自会话里干活，完成后把成品交回来；你按 criteria 审查
5. 不过就 \`group_review\` 打回（默认最多 2 次），还不行 \`group_escalate\` 问用户
6. 全程中文、短句，别写长篇报告；进度用一句话报

## 硬约束
- 派活是**异步**的：不要在这里等结果，交活 / 审查 / 打回会以 [群事件] 回到你这里
- 不要假装完成：没派活就说没派活，成员没交活就说没交
- 这个会话会一直用下去，不会每轮新建；它也**不属于任何项目**，这里没有代码可改
`;

const TICK_MS = 5000;

/** 指挥中枢自己的目录（`<userData>/boss-home`）：建好目录并把角色提示写进 AGENTS.md。
 *  ⛔ 单一真相源：桌面侧建会话走这个 cwd，**手机端建中枢会话**也调它 —— 别各写一份 AGENTS。 */
export function ensureBossHomeDir(): string {
  const dir = path.join(app.getPath("userData"), "boss-home");
  try {
    fs.mkdirSync(dir, { recursive: true });
    /* 10-25 用户令：「内置注入好提示词，让 Codex 知道」。BOSS 会话的 cwd 就是这里 ⇒ 引擎自己读这份文件。
       ⛔ 版本化：内容升级就覆盖，否则只写一次（用户不该手改系统文件；不覆盖会让老用户停在旧提示词）。 */
    const agents = path.join(dir, "AGENTS.md");
    const stamp = `boss-home-agents:${BOSS_HOME_AGENTS_VERSION}`;
    let needWrite = true;
    try { needWrite = !fs.readFileSync(agents, "utf8").includes(stamp); } catch { needWrite = true; }
    if (needWrite) fs.writeFileSync(agents, BOSS_HOME_AGENTS_MD, "utf8");
  } catch { /* 建不了就让引擎报错，别吞 */ }
  return dir;
}

/** 群列表快照（桌面首页群卡 / **手机端中枢首页**共用）。
 *  ⛔ 与 `boss-groups:list` 是同一份映射：成员名字、最近 3 条事件、未完成数都在这；
 *    消费方别再按群逐个查 status（N 个群 N 次 IPC，首页一开就抖）。 */
export async function listBossGroupSummaries(): Promise<any[]> {
  const state = await bossStore.load();
  const lastActivityAt = (groupId: string, createdAt: number) => {
    let latest = createdAt || 0;
    for (const event of state.events ?? []) {
      if (event.groupId === groupId && Number(event.at ?? 0) > latest) latest = Number(event.at ?? 0);
    }
    for (const task of Object.values(state.tasks ?? {})) {
      if (task.groupId === groupId && Number(task.updatedAt ?? 0) > latest) latest = Number(task.updatedAt ?? 0);
    }
    return latest;
  };
  return Object.values(state.groups).map((group) => ({
    id: group.id,
    name: group.name,
    createdAt: group.createdAt,
    paused: Boolean(group.paused),
    bossThreadId: group.bossThreadId,
    memberThreadIds: group.members.filter((member) => String(member.status ?? "") !== "removed").map((member) => member.threadId).filter(Boolean),
    memberCount: group.members.filter((m: any) => String(m?.status ?? "") !== "removed").length,
    removedCount: group.members.filter((m: any) => String(m?.status ?? "") === "removed").length,
    lastActivityAt: lastActivityAt(group.id, Number(group.createdAt ?? 0)),
    taskCount: Object.values(state.tasks).filter((task) => task.groupId === group.id).length,
    /* 10-28 首页（群卡 / 会话行群头像）：一次把卡上要的都带上。 */
    members: group.members
      .filter((member) => String(member.status ?? "") !== "removed")
      .map((member) => ({ id: member.id, name: member.name, role: member.role, status: member.status })),
    recentEvents: (state.events ?? [])
      .filter((event) => event.groupId === group.id)
      .slice(-3)
      .reverse()
      .map((event) => ({ id: event.id, kind: event.kind, text: event.text, at: event.at, memberId: event.memberId })),
    openTaskCount: Object.values(state.tasks)
      .filter((task) => task.groupId === group.id && task.status !== "done" && task.status !== "failed").length,
  })).sort((a: any, b: any) => Number(b.lastActivityAt ?? 0) - Number(a.lastActivityAt ?? 0));
}

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
    ensureBossHomeDir();
    /* BOSS 会话身份登记（10-25 用户令：「记忆板块里面加一个BOSS会话记忆板块，跟普通会话完全拆开」）。
       ⛔ **主进程是唯一真相源**：记忆层的读写以 workspace 为键，捕获写入在主进程跑 ——
          渲染层 localStorage 主进程读不到 ⇒ 名单必须落主进程。
       action：list / add / remove / rename */
    ipcHost.handle("boss-groups:session", async (_event, input: any) => {
      const action = String(input?.action ?? "list");
      if (action === "add") {
        const rec = await registerBossSession(String(input?.id ?? ""));
        return { ok: Boolean(rec), session: rec };
      }
      if (action === "remove") {
        const res = await unregisterBossSession(String(input?.id ?? ""));
        return { ok: res.ok, removedDir: res.removedDir };
      }
      if (action === "rename") {
        const ok = await renameBossSession(String(input?.previousId ?? ""), String(input?.id ?? ""));
        return { ok };
      }
      return { ok: true, sessions: await listBossSessions() };
    });

    /* 启动补登（10-25）：老用户的 BOSS 会话可能只存在于群账本（boss-groups.json）里，
       名单文件是新建的 ⇒ 拿群账本的 bossThreadId 补进来，别让他们的记忆路由失效。 */
    void (async () => {
      try {
        const state = await bossStore.load();
        const ids = Object.values(state.groups ?? {}).map((g: any) => String(g?.bossThreadId ?? "")).filter(Boolean);
        const added = await backfillFromGroups(ids);
        if (added) console.log("[boss-groups] 补登指挥中枢身份：", added);
      } catch (error: any) {
        console.warn("[boss-groups] 补登失败：", String(error?.message ?? error).slice(0, 160));
      }
    })();

    /* 清空某个 BOSS 会话的专属记忆（⛔ 只清记忆目录，不删会话本身）。 */
    ipcHost.handle("boss-groups:memory", async (_event, input: any) => {
      return clearBossMemory(String(input?.memoryDir ?? ""));
    });

    ipcHost.handle("boss-groups:list", async () => {
      /* ⛔ list 的返回形状是**数组**（多处消费方按数组用）⇒ BOSS 会话名单走独立的
         `boss-groups:session`（action=list）通道，⛔ 不在这里夹带。
         10-28：映射收进 `listBossGroupSummaries()`（手机端中枢首页共用同一份：成员 / 最近事件 / 未完成数）。 */
      return listBossGroupSummaries();
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

    /* ⛔⛔ 10-31 用户令「每个中枢会话都是独立的，调度必须归在自己的中枢下面」：
       群工具的**归属硬闸**（写侧，主进程最终把关）—— 群只属于创建它的那个中枢会话。
       模型在别的中枢里能从 group_status 看到群 id（读侧已在渲染层过滤）⇒ 不拦就会
       跨中枢拿别人的群派活/删群，被派会话全部缩进到别人的中枢行下（用户实测截图）。 */
    const assertGroupOwned = (group: { bossThreadId?: string } | null | undefined, callerThreadId: unknown): void => {
      const caller = String(callerThreadId ?? "").trim();
      if (!caller) return; /* 身份缺失（旧调用方 / 设置页 UI）不拦 —— 引擎 tool call 恒带 threadId */
      const owner = String(group?.bossThreadId ?? "").trim();
      if (owner && owner !== caller) throw new Error("这个群属于另一个指挥中枢：跨中枢派活/操作已禁止（只能在中枢自己的群里派）。");
    };
    const groupOfTask = (state: any, taskId: string) => state?.groups?.[state?.tasks?.[String(taskId ?? "")]?.groupId ?? ""];

    ipcHost.handle("boss-groups:status", async (_event, groupId: string) => {
      await bossStore.load();
      return statusForBoss(String(groupId ?? ""));
    });

    ipcHost.handle("boss-groups:create", async (_event, input: any) => {
      await bossStore.load();
      return createGroupForBoss({
        name: String(input?.name ?? ""),
        workspace: String(input?.workspace ?? ""),
        /* ⛔ 群归属以**引擎下发的调用者 threadId**为权威（callerThreadId）——
           两个中枢同时建群时，bossThreadId 绝不能串（用户实测全部串到一个中枢下面）。 */
        bossThreadId: String(input?.callerThreadId ?? "") || String(input?.bossThreadId ?? ""),
        members: Array.isArray(input?.members) ? input.members : [],
        policy: input?.policy ?? undefined,
      });
    });

    /* 删群（10-27 用户令：「光界面删了，codex 那边不知道群删了不行」）。
       ⛔ 联动就在 runner 里：先往中枢回投 [群事件]，再清群/任务/事件三处账本。
       ⛔ 会话不删（成员产出与轨迹保留）；memberThreadIds 也随之失效，侧栏的「中枢调度」标签自然消失。 */
    ipcHost.handle("boss-groups:delete", async (_event, input: any) => {
      const st = await bossStore.load();
      assertGroupOwned(Object.values(st.groups ?? {}).find((g: any) => g.id === String(input?.groupId ?? "")), input?.callerThreadId);
      return deleteGroupForBoss({
        groupId: String(input?.groupId ?? ""),
        by: input?.by === "boss" ? "boss" : "user",
        reason: input?.reason ? String(input.reason) : "",
      });
    });

    ipcHost.handle("boss-groups:assign", async (_event, input: any) => {
      const st = await bossStore.load();
      assertGroupOwned(Object.values(st.groups ?? {}).find((g: any) => g.id === String(input?.groupId ?? "")), input?.callerThreadId);
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
      assertGroupOwned(groupOfTask(state, String(input?.taskId ?? "")), input?.callerThreadId);
      const task = recordReview(state, String(input?.taskId ?? ""), {
        by: String(input?.by ?? "user"),
        verdict,
        reasons: Array.isArray(input?.reasons) ? input.reasons.map(String) : [],
      });
      bossStore.save();
      const group = state.groups[task.groupId];
      /* ⛔⛔ 10-26 用户令：「Codex 要区分出来成员广播汇总消息和用户消息，成员消息是汇报结果的」
         ⇒ 审查结论（通过/打回）也要按**成员汇报**回投（带头像+名字+结论徽标），
            而不是一条居中灰行。
         ⛔ 文案带**成员名**（谁做的活被认可/打回）+ **判定方**（中枢/人工）——
            解析器按这个格式出块（改文案必须同步改 group-event-text.mjs，否则会落回灰行）。 */
      const reviewer = String(input?.by ?? "user") === "user" ? "人工" : "中枢";
      const memberName = group?.members?.find((m: any) => m.id === task.assignee)?.name ?? "成员";
      if (group) void postToBoss(group, `[群事件] 审查结论：${memberName} 的「${task.title}」${verdict === "approved" ? "通过" : "打回"}（${reviewer}判定）${input?.reasons?.length ? `：${input.reasons.join("；")}` : ""}`);
      return { ok: true, task: { id: task.id, status: task.status, rejects: task.rejects, lockedAuthors: task.lockedAuthors } };
    });

    ipcHost.handle("boss-groups:escalate", async (_event, input: any) => {
      const state = await bossStore.load();
      /* ⛔ 兼容旧值：账本里可能存着改名前的 `retry-with-other-model`（历史 escalation 快照），
         用户从旧界面点过来时不能因为改名就报错。 */
      const choice = normalizeEscalateChoice(input?.choice);
      if (!choice) {
        throw new Error(`choice 只能是 retry / relax-criteria / user-takeover（收到「${String(input?.choice ?? "")}」）`);
      }
      assertGroupOwned(groupOfTask(state, String(input?.taskId ?? "")), input?.callerThreadId);
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
      const st = await bossStore.load();
      const action = input?.action === "add" ? "add" : "remove";
      assertGroupOwned(Object.values(st.groups ?? {}).find((g: any) => g.id === String(input?.groupId ?? "")), input?.callerThreadId);
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

    /* boss 线程的回复镜像进群流（「在群里回」）——全局只挂一次。 */
    watchBossReplies();

    /* ⛔⛔ 成员回合结算改**引擎事件驱动**（10-26 用户现场：「成员正在干活，我都没有发任务」）。
       真机取证：3 个任务卡 running、成员卡 busy ⇒ 界面永远「正在做」。
       根因：结算只靠进程内 Promise ⇒ 应用一重启所有等待回调全丢。
       ⇒ 挂引擎事件监听：回合结束按 turnId 反查任务并结算（重启后依然有效）。 */
    watchMemberSettlements();

    /* ⛔ 启动对账：把上次没结算完的**残留** running 任务与引擎真相对齐
       （回合早结束 ⇒ 补结算；引擎里没这一回合 ⇒ 静默标失败并释放成员）。
       ⛔ 静默：不回投中枢（凭空造"执行失败"是噪声，而回投走的就是用户消息队列）。 */
    void reconcileRunningTasks().catch(() => undefined);

    /* ⛔ ctx.effect 是**释放钩子**（dispose 时逆序执行），不是"立即执行"的 effect ——
       定时器要在外面启动，这里只登记"怎么停"。 */
    const tickTimer = setInterval(() => { void tickAll().catch(() => undefined); }, TICK_MS);
    ctx.effect(() => clearInterval(tickTimer));

    ctx.effect(() => {
      setBossEventSink(null);
      for (const channel of ["boss-groups:list", "boss-groups:status", "boss-groups:create", "boss-groups:delete", "boss-groups:assign", "boss-groups:review", "boss-groups:escalate", "boss-groups:browser", "boss-groups:member", "boss-groups:pin", "boss-groups:say", "boss-groups:pool"]) {
        ipcHost.removeHandler(channel);
      }
    });
  },
});
