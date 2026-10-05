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
import { appendRoleMemory, lookupRoleSession, registerRoleSession, type RoleRef } from "./role-memory";
import { delegateRegistry } from "./runtime-refs";

/** 工具名（与渲染层主会话的 `memory_save` 刻意不同名，避免模型混淆两个作用域）。 */
export const ROLE_MEMORY_TOOL_NAME = "role_memory_save";

/** 动态工具定义（注册进被委派会话的 `thread/start`）。 */
export function buildRoleMemoryTool(ref: RoleRef): unknown {
  return {
    type: "function",
    name: ROLE_MEMORY_TOOL_NAME,
    description:
      "把你自己的经历记进**你这个角色专属的私有记忆**（下次被派出时会读到你写的这些）。"
      + "⛔ 别的角色看不到你写的任何内容 —— 这里不是项目记忆，别拿它记项目级结论（那些由发起方记）。"
      + "⛔ 只记**下次干活用得上的**东西：你的工作方法、这个角色特有的经验、反复出现的坑。"
      + "同一件事别重复记（已存在会自动跳过）。",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "一条要记住的内容（一句话讲清是什么、以后怎么用）" },
      },
      required: ["content"],
    },
  };
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
  if (String(event?.params?.tool ?? "") !== ROLE_MEMORY_TOOL_NAME) return false;
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
     （理论上不该有这个工具，但引擎侧的 bug 也会到这里）就能往角色记忆里写。 */
  const isDelegate = await delegateRegistry.infoOf(threadId).catch(() => null);
  if (!isDelegate) {
    respond(id, {
      contentItems: [{ type: "inputText", text: "记忆写入失败：该会话不是被调度产生的会话，无权写角色记忆。" }],
      success: false,
    });
    return true;
  }

  const content = String(args?.content ?? "").trim();
  if (!content) {
    respond(id, { contentItems: [{ type: "inputText", text: "记忆内容为空，没有写入。" }], success: false });
    return true;
  }
  const result = await appendRoleMemory(found.workspace, found.ref, content).catch((error: any) => ({
    written: false, reason: String(error?.message ?? error),
  }));
  respond(id, {
    contentItems: [{
      type: "inputText",
      text: result.written
        ? "已记进你的私有记忆（下次派出时你会读到）。"
        : `没有写入：${result.reason ?? "未知原因"}`,
    }],
    success: result.written === true,
  });
  return true;
}
