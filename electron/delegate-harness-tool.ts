/**
 * delegate-harness-tool —— 被委派会话的**能力网关**（10-10 用户令「全开 harness_tools」）。
 *
 * ── 与主会话的 `harness_tools` 是什么关系 ────────────────────────────────────
 * 同一个形态、同一份能力清单（都取自 `dispatch-core.dispatchMcpTools()`，⛔ 不各写一份描述 ——
 * 本项目反复踩过"两处各写一份"的漂移）、同一个执行端（`dispatchRpcCall`）。
 * 唯一的区别是**身份来源**：被委派会话的调用由这里把引擎下发的 `threadId` 直接告诉
 * `dispatchRpcCall`（第 3 参）—— 更硬，也省掉最多 10 秒的旁证等待。
 *
 * ── 为什么必须在主进程应答 ──────────────────────────────────────────────────
 * 同 `role-memory-tool.ts`：被委派会话不在渲染层"正在看着"的列表里 ⇒ 它的 `item/tool/call`
 * 会被 `renderer-fuse.filterForRenderer` 裁掉 ⇒ 渲染层收不到、不会应答，工具调用一直挂到超时。
 * ⇒ 只能在**主进程的引擎事件流**里直接 `server.respond(id, …)`。
 *
 * ── 权限：⛔ 别把"给了工具"当成"给了权限" ───────────────────────────────────
 * 真正的边界全在**执行端**（`dispatch-rpc.dispatchRpcCall`）：
 *   · `agent_invoke` → `canDispatchFrom`（被委派会话不许再套娃）；
 *   · `scheduler_save` / `knowledge_add` → `restrictedThreadRole`（同一批会话不许建定时任务 / 写知识库）。
 * ⇒ 工具可见 ≠ 操作被允许。被拒时把原因**如实转述**给用户，别换个名字重试。
 *
 * ── 归属从哪来（⛔ 不许模型自报）───────────────────────────────────────────
 * 只用引擎下发的 `params.threadId`：先查角色登记表（拿 workspace），再要求它确实是
 * **被委派 / 团队**会话（与 `dispatch-core.restrictedThreadRole` 同口径）。两者都不认 ⇒ fail-closed。
 * ⛔ 绝不使用 args 里的任何 id 当身份判据。
 */
import { dispatchMcpTools } from "./features/dispatch-core";
import { dispatchRpcCall } from "./features/dispatch-rpc";
import { lookupRoleSession } from "./role-memory";
import { delegateRegistry, teamRunStore, threadCwd } from "./runtime-refs";

/** 工具名：与主会话的网关**完全同名** —— 两个环境里是同一件事，⛔ 不另起名字。 */
export const DELEGATE_HARNESS_TOOL = "harness_tools";

/** 不在本网关内（也不接受调用）的能力：调度类有专用工具，且被委派会话本就不该有调度权。 */
const GATEWAY_EXCLUDED = new Set(["agent_invoke", "agent_archive_sessions"]);

/** 网关可见的能力定义（与执行端同源，过滤掉上面那两个）。 */
function gatewayTools(): any[] {
  return (dispatchMcpTools() as any[]).filter((tool) => !GATEWAY_EXCLUDED.has(String(tool?.name ?? "")));
}

/** 动态工具定义（注册进被委派会话的 `thread/start`）。 */
export function buildDelegateHarnessTool(): unknown {
  const names = gatewayTools().map((tool) => String(tool?.name ?? "")).filter(Boolean);
  return {
    type: "function",
    name: DELEGATE_HARNESS_TOOL,
    description:
      `调用宿主的其余内置能力。可用：${names.join(" / ")}。`
      + `传 name="list" 可拿到每个能力的完整参数说明（不确定参数就先调它）。`
      + `⛔ 你的写入类操作受宿主的角色权限限制（有些能力会被明确拒绝）——被拒时把原因如实转述给用户，`
      + `不要换个名字重试。`
      + `⛔ 调度专家 / 专家团 / 子智能体不在这里（由宿主按角色权限管理）。`
      + `⛔ 图像生成与编辑是各自独立的工具（image_generate / image_edit / image_info / image_view），本工具里调不到。`,
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "工具名；传 \"list\" 返回全部能力与它们的参数说明" },
        args: { type: "object", description: "该工具的参数对象（没有参数就省略）" },
      },
      required: ["name"],
    },
  };
}

/** name="list" 的返回：逐条列出名字 + 说明 + 参数 schema（渐进披露 —— ⛔ 不常驻工具面）。 */
function describeGateway(): string {
  return gatewayTools()
    .map((tool) => `### ${tool?.name}\n${tool?.description ?? ""}\n参数：${JSON.stringify(tool?.inputSchema ?? {})}`)
    .join("\n\n");
}

/**
 * 主进程侧应答被委派会话的 `harness_tools` 调用。
 * 返回 true = 已应答（调用方不要再转发给渲染层）；false = 不是这个工具，交回原流程。
 */
export async function handleDelegateHarnessToolCall(input: {
  userDataDir: string;
  event: { id?: string | number; method?: string; params?: any };
  respond: (id: string | number, result: unknown) => void;
}): Promise<boolean> {
  const { event, respond, userDataDir } = input;
  if (String(event?.method ?? "") !== "item/tool/call") return false;
  if (String(event?.params?.tool ?? "") !== DELEGATE_HARNESS_TOOL) return false;
  const id = event?.id;
  if (id === undefined || id === null) return false;

  const reply = (text: string, ok = true) =>
    respond(id, { contentItems: [{ type: "inputText", text }], success: ok });

  /* 身份硬闸：只用引擎下发的 threadId，⛔ 不用 args 里的任何东西当身份。 */
  const threadId = String(event?.params?.threadId ?? "");
  const found = await lookupRoleSession(userDataDir, threadId).catch(() => null);
  /* 团队主会话那一类没有角色登记（teams-ipc 的 teams:session 只登记 threadCwd）⇒ 用
     「被委派登记表 / 团队会话表」兜底；两者都不认 ⇒ 拒绝（fail-closed，不当"随便哪个会话"）。 */
  const isDelegated = Boolean(found)
    || Boolean(await delegateRegistry.infoOf(threadId).catch(() => null))
    || Boolean(teamRunStore.teamOfThread(threadId));
  if (!isDelegated) {
    reply("能力调用失败：该会话不是被调度 / 团队会话，无权使用宿主能力网关。", false);
    return true;
  }
  /* ⛔ 工作目录兜底（10-10）：被委派会话原来只登记在角色表里，`threadCwd` 是空的 ——
     而网关里的 `knowledge_search` 等能力要靠它定位**项目级**资源。缺了会让这类调用
     直接失败（"无法确定工作目录"）。这里用角色表里的 workspace 补登记（同 delegation 建会话时
     写进去的同一份值，不是新造事实）。 */
  const roleWorkspace = String(found?.workspace ?? "").trim();
  if (roleWorkspace && !threadCwd.get(threadId)) threadCwd.set(threadId, roleWorkspace);

  const args = (() => {
    const raw = event?.params?.arguments;
    if (typeof raw === "string") { try { return JSON.parse(raw) as any; } catch { return {} as any; } }
    return (raw && typeof raw === "object") ? raw as any : {} as any;
  })();

  const name = String(args.name ?? "").trim();
  if (!name) { reply('要调哪个能力？传 name（不确定就先传 name="list" 看全部）。', false); return true; }
  if (name === "list") { reply(describeGateway()); return true; }
  if (GATEWAY_EXCLUDED.has(name)) {
    reply(`「${name}」不在你的能力范围内 —— 调度专家 / 专家团 / 子智能体由宿主按角色权限管理。`, false);
    return true;
  }

  try {
    /* ⛔ 与模型侧（主会话网关、内置 MCP）**同一个执行端** —— 权限闸（canDispatchFrom /
       restrictedThreadRole）都在里面，⛔ 不在这里另写一套判据。 */
    const result = await dispatchRpcCall(
      name,
      (args.args && typeof args.args === "object") ? args.args as Record<string, unknown> : {},
      threadId,
    );
    reply(result.ok
      ? (String(result.output ?? "").trim() || "（已完成，没有文本产出）")
      : `能力调用被拒绝或失败：${result.error ?? "未知原因"}`, result.ok);
  } catch (error: any) {
    reply(`能力调用失败：${String(error?.message ?? error)}`, false);
  }
  return true;
}
