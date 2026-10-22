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

const TEAM_TOOL_MEMBER = "team_member_invoke";
const TEAM_TOOL_PHASE = "team_phase_invoke";

type Respond = (id: string | number, result: unknown) => unknown;

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
}): Promise<boolean> {
  const { event, respond } = deps;
  if (event?.method !== "item/tool/call") return false;
  const tool = String(event?.params?.tool ?? "");
  if (tool !== TEAM_TOOL_MEMBER && tool !== TEAM_TOOL_PHASE) return false;

  const threadId = String(event?.params?.threadId ?? "");
  // 渲染层收得到 ⇒ 让渲染层答（它还要点亮成员头像 / 累计并发指示）
  if (deps.delivered(threadId)) return false;

  const id = event?.id;
  if (id === undefined || id === null) return false;

  const teamId = String(teamRunStore.teamOfThread(threadId) ?? "");
  if (!teamId) {
    await respond(id, { contentItems: [{ type: "inputText", text: failureText(new Error(`无法确定会话 ${threadId} 所属的专家团（后台团队会话没有登记团队映射）。`)) }], success: false });
    return true;
  }

  const args = readArgs(event?.params?.arguments);
  const base: Omit<InvokeMemberInput, "memberId" | "query"> = {
    teamId,
    leadThreadId: threadId,
    // ⛔ 后台线程不在窗口里，渲染层那套「当前会话 cwd」拿不到 ⇒ 用 host 侧的线程 cwd 登记；
    //    都没有就不传（invokeTeamMemberCore 自己回到 process.cwd()，与老行为一致）。
    cwd: threadCwd.get(threadId) || undefined,
  };

  try {
    if (tool === TEAM_TOOL_MEMBER) {
      const result = await invokeTeamMemberCore({ ...base, memberId: String(args?.memberId ?? ""), query: String(args?.query ?? "") });
      await respond(id, { contentItems: [{ type: "inputText", text: outputText(result) }], success: true });
      return true;
    }
    // 并行阶段：宿主并发跑完再一起回（与渲染层 invokeTeamPhase 同语义）
    const tasks = Array.isArray(args?.tasks) ? args.tasks.filter((task: any) => task && String(task?.memberId ?? "").trim()) : [];
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
