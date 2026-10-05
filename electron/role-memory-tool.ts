/**
 * role-memory-tool —— 角色私有记忆的**写入通道**（10-05）。
 *
 * ── 为什么必须在主进程应答，不能走渲染层 ─────────────────────────────────
 * 记忆写入的交互要和普通会话一致（模型调一个 `memory_save` 工具就写），所以它注册成
 * dynamicTool。但**被委派的会话不在渲染层的"正在看着"列表里** ⇒ 它的 `item/tool/call`
 * 会被 `features/renderer-fuse.ts` 的 `filterForRenderer` 裁掉（该方法不在
 * `RENDERER_CROSS_SESSION_METHODS` 白名单里）⇒ 渲染层根本收不到，更不会应答，
 * 工具调用会一直挂到超时。
 * ⇒ 只能在**主进程的引擎事件流**里直接 `server.respond(id, …)` 应答。
 *
 * ── 归属从哪来（不许模型自报）────────────────────────────────────────────
 * 身份只用 `item/tool/call` 的 `params.threadId`（引擎下发，模型伪造不了），
 * 再经 `role-memory-index.json` 反查角色（建会话时由四条发起路径登记）。
 * ⛔ 绝不使用 args 里的任何 id —— 那等于让模型自己决定「写进谁的记忆」。
 *
 * ── 权限 ────────────────────────────────────────────────────────────────
 * ① 工具**只**注册给角色会话（子智能体 / 专家 / 团主 / 团成员）。主会话**没有**这个工具 ——
 *    它的记忆写入仍走既有的 `memory_save`（写进项目/用户层），两套互不干扰。
 * ② 写入**只落该角色自己的目录**，永不写项目层、用户层、其他角色（守卫【role】钉死）。
 * ③ 查不到归属 ⇒ 应答**失败**（fail-closed），绝不"随便找个地方写"。
 */
import { lookupRoleSession, registerRoleSession, type RoleRef } from "./role-memory";
import { agentOfRoleRef, buildFabricWriteTool, FABRIC_WRITE_TOOL } from "./memory-fabric-tool";
import { delegateRegistry } from "./runtime-refs";

/** ⛔ 10-05 统一写入面：**只有一个工具名** `memory_write`。
 * 改造前有 `memory_save`（主会话）与 `role_memory_save`（角色）两个，
 * 模型得自己判断该用哪个 —— 那是"两套同名能力"的变体（项目踩过同款坑）。
 * 本常量保留是为了让引用点不必全改；旧名 `role_memory_save` 走**别名**（同一 handler）。 */
export const ROLE_MEMORY_TOOL_NAME = FABRIC_WRITE_TOOL;

/** 动态工具定义（注册进被委派会话的 `thread/start`）。 */
export function buildRoleMemoryTool(ref: RoleRef): unknown {
  return buildFabricWriteTool(agentOfRoleRef(ref));
}

/** 建会话后登记归属（委派 / 成员会话各建完线程都调一次；幂等）。 */
export async function noteRoleThread(userDataDir: string, threadId: string, ref: RoleRef, workspace: string): Promise<void> {
  await registerRoleSession(userDataDir, threadId, ref, workspace).catch(() => undefined);
}

/**
 * 主进程侧应答角色会话的 `role_memory_save`。
 * 返回 true = 已应答（调用方不要再转发给渲染层）；false = 不是这个工具，交回原流程。
 */
export async function handleRoleMemoryToolCall(input: {
  userDataDir: string;
  event: { id?: string | number; method?: string; params?: any };
  respond: (id: string | number, result: unknown) => void;
}): Promise<boolean> {
  const { event, respond, userDataDir } = input;
  if (String(event?.method ?? "") !== "item/tool/call") return false;
  /* ⛔ 10-05 统一写入面：认 `memory_write`（新名）+ `role_memory_save`（旧名，别名期）。
     两者是**同一个 handler** —— 不是两套能力（项目踩过：`agent_invoke` 与
     `subagent_invoke` 并存 ⇒ 模型只用名字最直白的那个 ⇒ 专家被绕过）。 */
  const { isFabricWriteTool } = await import("./memory-fabric-tool");
  if (!isFabricWriteTool(event?.params?.tool)) return false;
  const id = event?.id;
  if (id === undefined || id === null) return false;

  const threadId = String(event?.params?.threadId ?? "");
  const args = (() => {
    const raw = event?.params?.arguments;
    if (typeof raw === "string") { try { return JSON.parse(raw) as any; } catch { return {} as any; } }
    return (raw && typeof raw === "object") ? raw as any : {} as any;
  })();

  /* 身份硬闸：只用引擎下发的 threadId 反查归属，⛔ 不用 args 里的任何东西当身份。 */
  const found = await lookupRoleSession(userDataDir, threadId).catch(() => null);
  if (!found) {
    respond(id, {
      contentItems: [{ type: "inputText", text: "记忆写入失败：这个会话没有角色归属（索引缺失），已拒绝写入以免写错地方。" }],
      success: false,
    });
    return true;
  }
  /* ⛔ 二次核对：这个 threadId 必须确实是一条**被委派**的会话 —— 否则一个普通会话
     （理论上不该有这个工具，但引擎侧的 bug 也会到这里）就能往记忆里写。 */
  const isDelegate = await delegateRegistry.infoOf(threadId).catch(() => null);
  if (!isDelegate) {
    respond(id, {
      contentItems: [{ type: "inputText", text: "记忆写入失败：该会话不是被调度产生的会话，无权写入记忆。" }],
      success: false,
    });
    return true;
  }

  /* ⛔⛔ 10-05 架构改造：写入**转发到统一内核**（`memory-fabric`）——
     不再直接写 roles/<键>/MEMORY.md。身份闸（threadId 反查 + 委派核对）保留不动 ——
     那是安全面，改造的是存储不是权限。
     ⛔ scope 由 args 决定（session=它自己的 / project=全项目共享，角色写 project 需 promote 闸）。 */
  const { handleFabricWrite } = await import("./memory-fabric-tool");
  const result = await handleFabricWrite({
    args,
    threadId,
    workspace: found.workspace,
    agent: agentOfRoleRef(found.ref),
  }).catch((error: any) => ({ ok: false, text: String(error?.message ?? error) }));
  respond(id, {
    contentItems: [{ type: "inputText", text: result.ok ? result.text : `没有写入：${result.text}` }],
    success: result.ok === true,
  });
  return true;
}
