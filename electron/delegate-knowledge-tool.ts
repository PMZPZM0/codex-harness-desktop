/**
 * delegate-knowledge-tool —— 被委派会话的**只读**知识库检索工具（10-10 用户令「他们也要能用知识库」）。
 *
 * ── 为什么是「独立工具 + 只读」，⛔ 不是给它们挂 `harness_tools` 网关 ──────────────
 * 那个网关里装着**写操作**（保存专家 / 建定时任务 / 注册连接器 / 改壁纸 …）—— 给被委派会话等于
 * 把越权面整个放开。它们真正缺的只有一件事：**查项目资料** ⇒ 只补 `knowledge_search`（读）。
 * ⛔ 写入侧仍受 `restrictedThreadRole` 闸（知识库是项目级公共资产，角色不该改它）——
 *   这条是既有权限边界，本次不改。
 *
 * ── 为什么必须在主进程应答 ────────────────────────────────────────────────
 * 同 `role-memory-tool.ts`：被委派会话不在渲染层"正在看着"的列表里 ⇒ 它的 `item/tool/call`
 * 会被 `features/renderer-fuse.ts` 的 `filterForRenderer` 裁掉 ⇒ 渲染层根本收不到、不会应答，
 * 工具调用会一直挂到超时。⇒ 只能在**主进程的引擎事件流**里直接 `server.respond(id, …)`。
 *
 * ── 归属从哪来（⛔ 不许模型自报）─────────────────────────────────────────
 * 只用引擎下发的 `params.threadId` 反查：先查角色登记表（拿 workspace），
 * 再要求它确实是**被委派 / 团队**会话（与 `dispatch-core.ts` 的 `restrictedThreadRole` 同口径）。
 * ⛔ 绝不使用 args 里的任何 id。
 */
import { lookupRoleSession } from "./role-memory";
import { delegateRegistry, teamRunStore, threadCwd } from "./runtime-refs";

/** 工具名：与被委派会话能拿到的东西一一对应 —— 只有这一个（⛔ 不并列第二个名字）。 */
export const DELEGATE_KNOWLEDGE_TOOL = "knowledge_search";

/** 动态工具定义（注册进被委派会话的 `thread/start`）。 */
export function buildDelegateKnowledgeTool(): unknown {
  return {
    type: "function",
    name: DELEGATE_KNOWLEDGE_TOOL,
    description:
      "检索**当前项目**的本地知识库（用户导入的文档 / 规范 / 笔记 / 历史结论），"
      + "返回相关片段与来源文档名。用户说「查一下项目资料 / 我们的规范 / 知识库里有没有…」时用它。"
      + "⛔ 只读：你能查，但**不能改**知识库。若查到值得沉淀的结论，用 memory_write 记进你自己的私有记忆，"
      + "或把结论交回给派你来的会话由它决定。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "检索关键词 —— 中文直接写整句/短语即可，⛔ 不用加空格分隔" },
        limit: { type: "number", description: "返回条数（缺省 8，上限 20）" },
      },
      required: ["query"],
    },
  };
}

/**
 * 主进程侧应答被委派会话的 `knowledge_search`。
 * 返回 true = 已应答（调用方不要再转发给渲染层）；false = 不是这个工具，交回原流程。
 */
export async function handleDelegateKnowledgeToolCall(input: {
  userDataDir: string;
  event: { id?: string | number; method?: string; params?: any };
  respond: (id: string | number, result: unknown) => void;
}): Promise<boolean> {
  const { event, respond, userDataDir } = input;
  if (String(event?.method ?? "") !== "item/tool/call") return false;
  if (String(event?.params?.tool ?? "") !== DELEGATE_KNOWLEDGE_TOOL) return false;
  const id = event?.id;
  if (id === undefined || id === null) return false;

  const reply = (text: string, ok = true) =>
    respond(id, { contentItems: [{ type: "inputText", text }], success: ok });

  /* 身份硬闸：只用引擎下发的 threadId，⛔ 不用 args 里的任何东西当身份。 */
  const threadId = String(event?.params?.threadId ?? "");
  const found = await lookupRoleSession(userDataDir, threadId).catch(() => null);
  /* ⛔ 团队主会话那一类**没有**角色登记（teams-ipc 的 teams:session 只登记 threadCwd）⇒ 用
     「被委派登记表 / 团队会话表」兜底判定身份；两者都不认 ⇒ 拒绝（fail-closed，不当"随便哪个会话"）。 */
  const isDelegated = Boolean(found)
    || Boolean(await delegateRegistry.infoOf(threadId).catch(() => null))
    || Boolean(teamRunStore.teamOfThread(threadId));
  if (!isDelegated) {
    reply("知识库检索失败：该会话不是被调度 / 团队会话，无权使用本项目知识库。", false);
    return true;
  }
  /* 工作区：优先角色登记的 workspace，回落到 threadCwd（团队主会话那条走的正是回落）。 */
  const workspace = String(found?.workspace ?? threadCwd.get(threadId) ?? "").trim();
  if (!workspace) {
    reply("知识库检索失败：这个会话没有工作目录 —— 知识库是**项目级**的，没有项目就无从检索。", false);
    return true;
  }

  const args = (() => {
    const raw = event?.params?.arguments;
    if (typeof raw === "string") { try { return JSON.parse(raw) as any; } catch { return {} as any; } }
    return (raw && typeof raw === "object") ? raw as any : {} as any;
  })();

  const query = String(args.query ?? "").trim();
  if (!query) { reply("知识库检索失败：query 为空（要查什么？）。", false); return true; }

  try {
    /* ⛔ 与模型侧 `knowledge_search`（dispatch-rpc.ts）**同一个执行端** ——
       `searchDocs` 是全文档的唯一实现，⛔ 不另写一份（两份必然漂）。 */
    const { searchDocs } = await import("./knowledge-base");
    const hits = searchDocs(workspace, query, Number(args.limit) || 8);
    reply(hits.length
      ? hits.map((h) => `【${h.title} · 第 ${h.chunkIndex + 1} 块】${h.snippet}`).join("\n\n")
      : "（知识库没有命中 —— 确认相关文档已导入，或换个关键词）");
  } catch (error: any) {
    reply(`知识库检索失败：${String(error?.message ?? error)}`, false);
  }
  return true;
}
