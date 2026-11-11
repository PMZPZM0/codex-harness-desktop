/**
 * 专家团工具的**主进程兜底应答**（10-22）。
 *
 * 为什么需要（根因）：`team_member_invoke` / `team_phase_invoke` 原来**只有渲染层**在应答
 * （`src/features/app-state/parts/05-event-router/02-request.tsx` → `bag.invokeTeamMember`
 * → IPC `teams:invoke-member`）。而 `item/tool/call` 不在 `RENDERER_CROSS_SESSION_METHODS`
 * 白名单里 ⇒ 用户没在看的会话（最典型：从普通会话 `agent_invoke(kind:"team")` 派出去的**团队主理人**，
 * 它在后台跑）的事件会被 `filterForRenderer` 整条裁掉 ⇒ 没有任何一方应答 ⇒ 成员永远不被调用，
 * 主理人一直等到工具超时，界面表现就是「专家团无法调用成员干活」。
 *
 * 同一类坑此前踩过三次，都在主进程补了应答：`role_memory_save`（role-memory-tool.ts）、
 * MCP 工具（handleMcpToolCall）、能力网关 `harness_tools`（handleDelegateHarnessToolCall）。
 * 本文件补上第四类。
 *
 * ⛔ 只在这个会话**送不到**渲染层时才接管（`delivered(threadId) === false`），否则两边都答 =
 *    成员被调度两次（同一次 tool call 被 respond 两遍，且两次都真起一个 turn）。
 * ⛔ 团队归属只认 `teamRunStore.teamOfThread(threadId)`（主进程落盘映射，模型伪造不了），
 *    不接受模型自报 teamId —— 与 role-memory 的身份口径一致。
 * ⛔ 工具名是模型给的字符串，先白名单再解析参数。
 */
import { teamRunStore, threadCwd } from "./runtime-refs";
import { invokeTeamMemberCore, type InvokeMemberInput, type InvokeMemberResult } from "./team-invoke";
import { dedupeTeamPhaseTasks } from "../src/lib/team-phase.mjs";
import { appendMemberOutputToGroup, groupOfTeam, recentGroupMessages, relayGroupLead } from "./team-group-bridge";
import { teamAuthorIdOf } from "../src/lib/team-models.mjs";
import { readUsableExpertTeams } from "./expert-teams";
import { broadcastHarnessEvent } from "./features/window-bus";

const TEAM_TOOL_MEMBER = "team_member_invoke";
const TEAM_TOOL_PHASE = "team_phase_invoke";
/* ⛔⛔ 11-12 用户：「你给他们设计好流程，配套好工具」。
   流程不能只写在提示词里：计划要落成群里一条消息（team_plan），进度要能查（team_status）。 */
const TEAM_TOOL_PLAN = "team_plan";
const TEAM_TOOL_STATUS = "team_status";

type Respond = (id: string | number, result: unknown) => unknown;

/* ⛔⛔ 11-11：这条会话最近**真的**调过团队工具（threadId → 时刻）。
   群聊的闭环催办据此换口径：它已经用真工具派过活时，⛔ 别再催它「另起一行 @名字」——
   那会把它推回"行首 @ 演戏"的旧模式（群里说一句，没人真去干活）。
   ⛔ 只记事实，不做权限判断；上限清空只是防 Map 无限涨。 */
const lastToolUseAt = new Map<string, number>();
function noteTeamToolUse(threadId: string): void {
  const tid = String(threadId ?? "");
  if (!tid) return;
  if (lastToolUseAt.size > 500) lastToolUseAt.clear();
  lastToolUseAt.set(tid, Date.now());
}

/** 这条会话在 `since` 之后有没有真的调过团队工具（群聊闭环用）。 */
export function teamToolUsedSince(threadId: string, since: number): boolean {
  const at = lastToolUseAt.get(String(threadId ?? ""));
  return Boolean(at && at >= Number(since || 0));
}

/* ⛔⛔ 11-12 真机（群消息实证：同一成员 21:20 / 21:21 连续三次收到同一份任务，
   成员自己都回「这是第三次收到同一份任务派发，交付物状态没有变化」）：
   主理人被催办 / 回喂后会重新调工具，把同一批活再派一遍 —— 白烧 token、群里刷屏。
   ⇒ 群聊派活加**短时幂等**：同 team + 同 member + 同任务正文，10 分钟内只真启动一次；
     重复那次只回执「已派过，还在跑」，⛔ 不再起 turn。
   ⛔ 失败的不缓存（允许重派：失败往往正是要重试的那一次）；上限清空只防 Map 无限涨。 */
const recentDispatch = new Map<string, number>();
const DISPATCH_DEDUPE_MS = 10 * 60 * 1000;

function dispatchSignature(teamId: string, memberId: string, query: string): string {
  return `${String(teamId ?? "")}::${String(memberId ?? "")}::`
    + String(query ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
}

/** 从事件里取出这次调用的参数（`arguments` 可能是字符串，也可能是对象）。 */
function readArgs(raw: unknown): any {
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return raw && typeof raw === "object" ? raw : {};
}

function outputText(result: InvokeMemberResult) {
  return `[专家团成员 ${result.profession || result.name} 的执行结果]\n${result.output}`;
}

function failureText(error: unknown) {
  return `[成员调度失败]\n${error instanceof Error ? error.message : String(error)}`;
}

/**
 * 处理一条引擎事件；返回 true = 本模块已应答（调用方不要继续往下处理）。
 * @param deps.delivered 该会话的事件是否会送到渲染层（`isThreadDelivered`）
 */
export async function handleTeamToolCall(deps: {
  event: any;
  respond: Respond;
  delivered: (threadId: string) => boolean;
  /* ⛔⛔ 11-11：群聊会话（工作伙伴 / 团队群）的 `item/tool/call` **只由主进程答**。
     为什么不能交给渲染层：渲染层拿到一条不认识 threadId 的 team_member_invoke 时，
     它的 teamId 来自 `bag.threadTeamId`（当前正在看的会话）⇒ 群聊会话那里是空的，
     会以「没有团队」失败；而 `watchedThreadIds()` 返回 null 的窗口期（没窗口活跃 / 有 stale），
     `filterForRenderer` 会把事件**全放行**给渲染层 ⇒ 它抢答、主进程就此不答。
     ⇒ 命中群聊台账就无条件接管（那条链路本来就不该经过渲染层）。 */
  isGroupTalkThread?: (threadId: string) => boolean;
}): Promise<boolean> {
  const { event, respond } = deps;
  if (event?.method !== "item/tool/call") return false;
  const tool = String(event?.params?.tool ?? "");
  if (tool !== TEAM_TOOL_MEMBER && tool !== TEAM_TOOL_PHASE
    && tool !== TEAM_TOOL_PLAN && tool !== TEAM_TOOL_STATUS) return false;

  const threadId = String(event?.params?.threadId ?? "");
  const groupTalk = Boolean(deps.isGroupTalkThread?.(threadId));
  // 渲染层收得到 ⇒ 让渲染层答（它还要点亮成员头像 / 累计并发指示）
  if (!groupTalk && deps.delivered(threadId)) return false;

  const id = event?.id;
  if (id === undefined || id === null) return false;

  /* ⛔ 11-11：先记事实（这条会话这一轮用过真工具），再决定怎么答。 */
  noteTeamToolUse(threadId);

  const teamId = String(teamRunStore.teamOfThread(threadId) ?? "");
  if (!teamId) {
    await respond(id, { contentItems: [{ type: "inputText", text: failureText(new Error(`无法确定会话 ${threadId} 所属的专家团（后台团队会话没有登记团队映射）。`)) }], success: false });
    return true;
  }

  const args = readArgs(event?.params?.arguments);

  /* ⛔⛔ 计划工具：把"目标 + 有先后的步骤"落成群里的**一条消息**。
     ⛔ 不另存状态（重启/刷新都还在、用户也看得见）；步骤顺序就是执行顺序。 */
  if (tool === TEAM_TOOL_PLAN) {
    const gid = groupOfTeam(teamId);
    const team = (await readUsableExpertTeams().catch(() => []))
      .find((entry) => String(entry.teamId) === teamId);
    const leadAuthor = team ? teamAuthorIdOf(String(team.teamId), String(team.lead?.id ?? "")) : "";
    const goal = String(args?.goal ?? "").trim();
    const steps = Array.isArray(args?.steps) ? args.steps : [];
    if (!gid || !leadAuthor || !goal || !steps.length) {
      await respond(id, { contentItems: [{ type: "inputText", text: "计划没发出去：缺目标或步骤，或这个团没绑群。" }], success: false });
      return true;
    }
    const body = ["【计划】" + goal, ...steps.map((step: Record<string, unknown>, i: number) =>
      String(i + 1) + ". @" + String(step?.memberName ?? "") + "：" + String(step?.task ?? ""))].join("\n");
    await appendMemberOutputToGroup(gid, {
      /* ⛔ 审查修：只有一个 Date.now() 的话，同一毫秒两次 team_plan 会撞 id
         （appendGroupMessage 是"同 id 覆盖"）⇒ 后一份计划把前一份吞掉。加随机后缀。 */
      id: "team-plan:" + String(Date.now()) + ":" + Math.random().toString(36).slice(2, 6),
      authorId: leadAuthor,
      authorKind: "bot",
      senderKind: "member",
      threadId,
      text: body,
      at: Date.now(),
    });
    await respond(id, { contentItems: [{ type: "inputText", text: "计划已发进群。现在只派第 1 步；⛔ 不要一次全派。" }], success: true });
    return true;
  }

  /* ⛔⛔ 进度工具：把群里最近发生了什么**原样**给它（⛔ 不给判断、不替它下结论）。 */
  if (tool === TEAM_TOOL_STATUS) {
    const gid = groupOfTeam(teamId);
    const rows = gid ? recentGroupMessages(gid).slice(-40) : [];
    const text = rows.length
      ? rows.map((row) => {
        const at = Number(row?.at ?? 0);
        const hhmm = at ? new Date(at).toTimeString().slice(0, 5) : "";
        return hhmm + " " + String(row?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 90);
      }).join("\n")
      : "群里还没有消息。";
    await respond(id, { contentItems: [{ type: "inputText", text }], success: true });
    return true;
  }
  const base: Omit<InvokeMemberInput, "memberId" | "query"> = {
    teamId,
    leadThreadId: threadId,
    // ⛔ 后台线程不在窗口里，渲染层那套「当前会话 cwd」拿不到 ⇒ 用 host 侧的线程 cwd 登记；
    //    都没有就不传（invokeTeamMemberCore 自己回到 process.cwd()，与老行为一致）。
    cwd: threadCwd.get(threadId) || undefined,
  };

  /* ⛔⛔ 11-11 用户令（「一直卡着空转」）—— **群聊会话专用异步排片**：
     原实现 `await Promise.allSettled(成员回合)`，主理人这一轮被同步挂住 3~5 分钟，
     界面只剩它自己那张「正在写」，用户只能判定卡死。
     ⇒ 群里改成：① 工具**立刻**应答「已派给谁」（引擎不等）；② 成员在后台并发跑，
       产出照旧自己落群（team-invoke 那条链）；③ 全部跑完后由宿主把话头交回主理人。
     ⛔ 独立团会话 / 主对话派出去的团队会话（groupTalk=false）**保持同步原样**——
       那条链把成员产出当 tool result 交给主理人汇总，改异步会直接断掉。 */
  if (groupTalk) {
    const tasks = tool === TEAM_TOOL_PHASE
      ? dedupeTeamPhaseTasks(args?.tasks)
      : [{ memberId: String(args?.memberId ?? ""), query: String(args?.query ?? "") }];
    if (!tasks.length) {
      await respond(id, { contentItems: [{ type: "inputText", text: "team_phase_invoke 需要至少一个成员任务（tasks 为空）" }], success: false });
      return true;
    }
    /* ⛔ 短时幂等：先筛掉「10 分钟内派过的同一件活」（规则见文件头 recentDispatch 的注释）。 */
    const nowTs = Date.now();
    const fresh = tasks.filter((task: any) => {
      const at = recentDispatch.get(dispatchSignature(teamId, String(task?.memberId ?? ""), String(task?.query ?? "")));
      return !(at && nowTs - at < DISPATCH_DEDUPE_MS);
    });
    if (!fresh.length) {
      await respond(id, {
        contentItems: [{
          type: "inputText",
          text: "[已派过] 这 " + tasks.length + " 件刚派出去、成员还在跑，⛔ 不重复派。等他们交回产出后宿主会通知你验收。",
        }],
        success: true,
      });
      return true;
    }
    for (const task of fresh) {
      recentDispatch.set(dispatchSignature(teamId, String(task?.memberId ?? ""), String(task?.query ?? "")), nowTs);
    }
    if (recentDispatch.size > 300) recentDispatch.clear();
    const names = fresh.map((task: any) => String(task?.memberId ?? "")).filter(Boolean).join("、");
    /* ⛔ 11-11 用户令「加一个异步执行反馈效果板块」：派单这一刻就把整批任务广播出去，
       板块自己订阅 `group-async-run` 事件（零 IPC、独立板块）。⛔ 只广播事实，不在这里
       维护任何状态 —— 关掉群弹窗再打开时板块按事件重建即可。 */
    const gid = groupOfTeam(teamId);
    const emitAsync = (phase: string, extra: Record<string, unknown> = {}) => {
      if (!gid) return;
      try {
        broadcastHarnessEvent({
          type: "group-async-run", phase, groupId: gid, teamId, at: Date.now(), ...extra,
        } as never);
      } catch { /* 广播失败不影响派活 */ }
    };
    emitAsync("batch", { total: fresh.length, note: names });
    /* ⛔ 11-12 用户「完全不知道派给谁、在跑什么」：每行都要带**这一步在做什么**（任务摘要）。
       ⛔ 不带 name（英文 id 会先闪一下）—— 中文名由成员真正开跑时的 running 事件补上。 */
    const summaryOf = (task: any) => String(task?.query ?? "")
      .replace(/\s+/g, " ").trim().slice(0, 28);
    for (const task of fresh) {
      /* ⛔⛔ 11-12 审查修：这里原来发的是**裸 memberId**（`copywriter`），而成员真正开跑时
         `announceLive` 发的是合成 id（`team:<teamId>:copywriter`）⇒ 板块按 memberId 合并行，
         结果是同一个人出现**两行**（一行英文 id、一行中文名），总数也跟着算多。
         ⇒ 统一用 teamAuthorIdOf 的合成 id，与 running/done 事件同一口径。 */
      emitAsync("queued", {
        memberId: teamAuthorIdOf(teamId, String(task?.memberId ?? "")),
        title: summaryOf(task),
      });
    }
    /* ⛔⛔ 11-12 用户：「就正常对话聊天派活，主代理一直刷屏」。
       原 ack 让模型「回一句已派给谁」= 自己又发一条，而派单消息（@成员：任务…）已经在群里了
       ⇒ 同一件事在群里说两遍。现在要求它**别说话**，只在全部交回后汇总一次。 */
    const ack = `[已派单] 已把 ${fresh.length} 件活交给 ${names || "团队成员"}，他们正在后台跑，产出会自己发进群。\n`
      + `⛔ 派单消息已经发进群了，**这一轮不要再说话**（不要复述派给谁、不要报进度）。\n`
      + `成员全部交回后，宿主会把产出交回给你，那时再验收 / 推进下一阶段 / 收口。`;
    /* ⛔⛔ 11-12 顺序要点：**先启动后台成员任务，再回执**。原顺序在回执抛异常时（通道异常 / 引擎忙）
       成员永远不会被启动 —— 用户看到「已派单」，实际没人干活，比"卡住"更难查。 */
    void (async () => {
      const settled = await Promise.allSettled(fresh.map((task: any) => invokeTeamMemberCore({
        ...base, memberId: String(task?.memberId ?? ""), query: String(task?.query ?? ""),
      })));
      /* ⛔ 失败的不留缓存：失败往往正是该重试的那一次。 */
      settled.forEach((entry, i) => {
        if (entry.status === "rejected") {
          recentDispatch.delete(dispatchSignature(teamId, String((fresh[i] as any)?.memberId ?? ""), String((fresh[i] as any)?.query ?? "")));
        }
      });
      const done = settled.filter((entry) => entry.status === "fulfilled").length;
      const failed = settled.length - done;
      const gid = groupOfTeam(teamId);
      if (!gid) return;
      /* ⛔⛔ 11-12 审查修：`settled` 原来发在"还有人在跑"判断**之前** ⇒ 板块标题立刻变
         「已收口」，而成员还在跑（用户看到"收口了但人还在写"）。⇒ 只有整团真的没人跑了才收口。 */
      const stillRunning = teamRunStore.activeRunList().some((run) => String(run.teamId ?? "") === teamId);
      if (stillRunning) return;
      emitAsync("settled", { done, failed });
      /* ⛔⛔ 11-12 「主代理一直刷屏」的第二个源头：**每批完成都回喂一次**，主理人每批都说一段
         （「进度 2/4」「进度 3/4」…4 个成员就刷 4 条）。⇒ 同一团队**还有人在跑就不回喂**，
         等最后一批交回时一次汇总（那时它说一条结论就够）。 */
      relayGroupLead(gid, teamId,
        `[系统] 这一批 ${settled.length} 件：交回 ${done} 件${failed ? `、失败 ${failed} 件` : ""}。`
        + "成员的产出已经各自发进群。⛔ 群里不需要逐步播报进度（用户明确不要刷屏）——"
        + "只有**全部成员都交回**时才说一条：验收结论 + 缺什么 + 下一步；全部阶段完成才写「收口」。"
        + "⛔ 不要重复派同一位同一件活，也不要代写成员产出。");
    })().catch(() => undefined);
    await respond(id, { contentItems: [{ type: "inputText", text: ack }], success: true });
    return true;
  }

  try {
    if (tool === TEAM_TOOL_MEMBER) {
      const result = await invokeTeamMemberCore({ ...base, memberId: String(args?.memberId ?? ""), query: String(args?.query ?? "") });
      await respond(id, { contentItems: [{ type: "inputText", text: outputText(result) }], success: true });
      return true;
    }
    // 并行阶段：宿主并发跑完再一起回（与渲染层 invokeTeamPhase 同语义）
    const tasks = dedupeTeamPhaseTasks(args?.tasks);
    if (!tasks.length) {
      await respond(id, { contentItems: [{ type: "inputText", text: "team_phase_invoke 需要至少一个成员任务（tasks 为空）" }], success: false });
      return true;
    }
    const settled = await Promise.allSettled(tasks.map((task: any) => invokeTeamMemberCore({ ...base, memberId: String(task?.memberId ?? ""), query: String(task?.query ?? "") })));
    const parts = settled.map((entry) => (entry.status === "fulfilled" ? outputText(entry.value) : failureText(entry.reason)));
    await respond(id, { contentItems: [{ type: "inputText", text: parts.join("\n\n---\n\n") }], success: settled.some((entry) => entry.status === "fulfilled") });
    return true;
  } catch (error) {
    await respond(id, { contentItems: [{ type: "inputText", text: failureText(error) }], success: false });
    return true;
  }
}
