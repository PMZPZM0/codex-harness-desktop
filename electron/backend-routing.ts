/**
 * 「知识库 + 记忆」双后端路由（10-20）。
 *
 * ⛔⛔ 为什么必须有一个独立模块当**单一真相源**：
 *   后端不止影响"数据存哪儿"，它还决定三件互相牵连的事 ——
 *     ① 模型侧**工具面**（哪些 MCP 工具该出现）
 *     ② 模型侧**提示**（developer instructions 里教它调哪个工具、写哪里）
 *     ③ 内置**技能**（memory-classify ⇄ memory-mcp-backend 互斥启用）
 *   这三处此前各判各的：instructions 只分 `mcp / 非 mcp`（cloud 掉进内置文案）、
 *   技能启停只在 `builtin / mcp` 两态（cloud 时**两个技能都被停用**，模型没有任何写法指引）、
 *   桥接只看连接器 `enabled`（知识库切回本地后云端 6 个工具照样暴露）。
 *   三处一旦不同步，模型就会**拿着不存在的工具名乱试，最后退回手写文件** —— 那正是
 *   10-20「一条项目代号被写进 USER.md + BACKGROUND.md + memory.db 三份」的事故形态。
 *   ⇒ 判定只写在这里；其它模块**只许读**，不许各自再写一份 if。
 *
 * ⛔ 依赖方向：本模块是叶子（只依赖 memory-backend / app-settings / electron）。
 *   ⛔ 不许 import mcp-bridge（它会 import 本模块做过滤，反向依赖 = require 环）。
 */
import { app } from "electron";
import { readAppSettingsSync } from "./app-settings";
import { effectiveMemoryBackend, type MemoryBackend } from "./memory-backend";

export type KnowledgeBackend = "local" | "cloud";

/** 记忆后端三态（⛔ cloud 与 builtin 完全不同：cloud 没有任何记忆工具，见下方 note）。 */
export type MemoryRoute = {
  backend: MemoryBackend;
  /** 该后端对应的 MCP 连接器 id（空数组 = 这套后端没有 MCP 工具面） */
  connectorIds: string[];
  /** 应启用的内置技能（三态互斥，见 builtin-skills.ts） */
  skill: string;
  /** 数据落点（人话，直接讲给模型） */
  store: string;
  /** 模型该用的工具名（**已按 mcp-bridge 的暴露规则加前缀**，空 = 不需要调工具） */
  tools: string[];
  /** 一句话动作口径 */
  how: string;
  /** 该后端不可用/降级时的说明（空 = 正常） */
  degraded?: string;
};

export type KnowledgeRoute = {
  backend: KnowledgeBackend;
  connectorIds: string[];
  store: string;
  tools: string[];
  how: string;
};

/* ── 连接器 id：与 cloud-mcp.ts / memory-mcp-connector.ts 同源（改一处要改这里） ── */
export const MEMORY_MCP_CONNECTOR_ID = "local-memory";
export const CLOUD_MEMORY_CONNECTOR_ID = "cloud-memory";
export const CLOUD_KB_CONNECTOR_ID = "cloud-kb";

/**
 * MCP 工具暴露名 = `<连接器>__<原始工具名>`（连接器的 `-`/`.` 一律换成 `_`）。
 *
 * ⛔⛔ 这个函数是**工具名的唯一生成器**：mcp-bridge 用它暴露，instructions / 技能用它引用。
 *    上一版的教训就是两边各写一套 —— 指令里教模型调 `memory-write`，而工具列表里实际叫
 *    `local_memory__memory_write`，模型找不到就退回手写文件（写错位置的直接原因）。
 */
export function mcpToolName(connectorId: string, rawTool: string): string {
  const safe = String(connectorId || "mcp").replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 24);
  return `${safe}__${String(rawTool || "").replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 40)}`;
}

/** 记忆后端当前值（**生效值**：选了 MCP 但服务没装 ⇒ 这里已经回退成 builtin）。 */
export function memoryBackendNow(): MemoryBackend {
  return effectiveMemoryBackend();
}

/** 知识库后端当前值（读盘，默认 local）。 */
export function knowledgeBackendNow(): KnowledgeBackend {
  try {
    return readAppSettingsSync(app.getPath("userData")).kbBackend === "cloud" ? "cloud" : "local";
  } catch {
    return "local";
  }
}

/* 记忆 MCP（@vheins/local-memory-mcp v0.49.0 实测 19 个工具）里**主线**那几个。
   ⛔ 全量清单以 tools/list 实际返回为准；这里只列指令里会点到名的，防止写错名字。 */
const MEMORY_MCP_TOOLS = {
  write: mcpToolName(MEMORY_MCP_CONNECTOR_ID, "memory-write"),
  read: mcpToolName(MEMORY_MCP_CONNECTOR_ID, "memory-read"),
  context: mcpToolName(MEMORY_MCP_CONNECTOR_ID, "agent-context"),
};

/* 云端知识库（weknora MCP，10-20 实测 6 个工具）。 */
const CLOUD_KB_TOOLS = {
  ask: mcpToolName(CLOUD_KB_CONNECTOR_ID, "ask"),
  search: mcpToolName(CLOUD_KB_CONNECTOR_ID, "search_knowledge"),
  grep: mcpToolName(CLOUD_KB_CONNECTOR_ID, "grep_chunks"),
  list: mcpToolName(CLOUD_KB_CONNECTOR_ID, "list_documents"),
  read: mcpToolName(CLOUD_KB_CONNECTOR_ID, "read_document"),
  bases: mcpToolName(CLOUD_KB_CONNECTOR_ID, "list_knowledge_bases"),
};

export const memoryToolNames = MEMORY_MCP_TOOLS;
export const knowledgeToolNames = CLOUD_KB_TOOLS;

export function memoryRoute(): MemoryRoute {
  const backend = memoryBackendNow();
  if (backend === "mcp") {
    return {
      backend,
      connectorIds: [MEMORY_MCP_CONNECTOR_ID],
      skill: "memory-mcp-backend",
      store: "<userData>/memory-mcp/memory.db（本机 MCP 记忆服务）",
      tools: [MEMORY_MCP_TOOLS.write, MEMORY_MCP_TOOLS.read, MEMORY_MCP_TOOLS.context],
      how: `写记忆调 \`${MEMORY_MCP_TOOLS.write}\`（type = code_fact / decision / mistake / pattern / task_archive；importance 是 1–5 的数字）；读记忆用 \`${MEMORY_MCP_TOOLS.read}\`；要带预算的上下文用 \`${MEMORY_MCP_TOOLS.context}\`。⛔ 不要再往 lessons/*.md、MEMORY.md 或日志手写同一条。`,
    };
  }
  if (backend === "cloud") {
    /* ⛔⛔ 云端记忆**不是工具**（10-16 实测）：memapi 没有任何记忆读写路由，记忆由对话上游
       （tdai-proxy）在请求层自动注入 / 自动写入，按账号 userKey 隔离。
       ⇒ 模型侧「什么都不用调」才是正确行为；教它调某个工具 = 教它编造工具名。 */
    return {
      backend,
      connectorIds: [CLOUD_MEMORY_CONNECTOR_ID], // 仅当服务端将来给 mcpUrl 才真存在，通常为空
      skill: "memory-cloud-backend",
      store: "云端 memapi（随账号走，按账号隔离）",
      tools: [],
      how: "云端记忆由对话上游自动注入与写入 —— ⛔ 你**不需要**调用任何记忆工具，也⛔ 不要往 lessons/*.md / MEMORY.md 手写（那套是内置金字塔的位置，云端不会读它）。只要正常回答，记忆会被上游自动收走。",
    };
  }
  return {
    backend: "builtin",
    connectorIds: [],
    skill: "memory-classify",
    store: "<workspace>/.codex-harness/memory/（分层文件：lessons/ · project/ · logs/）",
    tools: [],
    how: "写记忆按 `memory-classify` 的四分类（纠错 > 坑 > SOP > 偏好）落到 `lessons/<分类>.md`，写前去重。",
  };
}

export function knowledgeRoute(): KnowledgeRoute {
  const backend = knowledgeBackendNow();
  if (backend === "cloud") {
    return {
      backend,
      connectorIds: [CLOUD_KB_CONNECTOR_ID],
      store: "云端 weknora（每账号独立库）",
      tools: [
        CLOUD_KB_TOOLS.ask, CLOUD_KB_TOOLS.search, CLOUD_KB_TOOLS.grep,
        CLOUD_KB_TOOLS.list, CLOUD_KB_TOOLS.read, CLOUD_KB_TOOLS.bases,
      ],
      how: `检索云端知识库用 \`${CLOUD_KB_TOOLS.ask}\`（自然语言提问）/ \`${CLOUD_KB_TOOLS.search}\`（关键词）；先 \`${CLOUD_KB_TOOLS.bases}\` 看有哪些库，再 \`${CLOUD_KB_TOOLS.list}\` 列文档、\`${CLOUD_KB_TOOLS.read}\` 读全文。⛔ 本地目录（<workspace>/.codex-harness/knowledge/）在此模式下不是真相源，别去 grep 它当检索结果。`,
    };
  }
  return {
    backend: "local",
    connectorIds: [],
    store: "<workspace>/.codex-harness/knowledge/（项目级本地库，随项目走）",
    tools: [],
    how: "本地知识库没有 MCP 工具：检索就 grep 文档文件本身（`.codex-harness/knowledge/<project>/docs/*.md`），或用应用界面的知识库页搜索。⛔ 此时云端工具不存在，别去找 `cloud_kb__*`。",
  };
}

/** 当前后端应暴露的连接器集合（mcp-bridge 用它做**第二道过滤**，第一道仍是 enabled）。 */
export function activeConnectorIds(): Set<string> {
  const ids = new Set<string>();
  for (const id of memoryRoute().connectorIds) ids.add(id);
  for (const id of knowledgeRoute().connectorIds) ids.add(id);
  return ids;
}

/**
 * **受后端管辖**的连接器（只有这三个属于「记忆 / 知识库」两条链）。
 *
 * ⛔ 为什么要单独给这一组：桥接里还有 tencent-docs / cos 这类与后端无关的连接器，
 *    过滤时**只能**对这三个动手 —— 拿 `activeConnectorIds()` 无差别过滤会把它们一起杀掉。
 */
export function managedConnectorIds(): Set<string> {
  return new Set([MEMORY_MCP_CONNECTOR_ID, CLOUD_MEMORY_CONNECTOR_ID, CLOUD_KB_CONNECTOR_ID]);
}

/** 该连接器是否被后端挡下（受管辖但不在当前后端里）。 */
export function isConnectorBlockedByBackend(id: string): boolean {
  return managedConnectorIds().has(id) && !activeConnectorIds().has(id);
}

/**
 * 后端切换后**立即**重建引擎配置（config.toml 里的 developer_instructions 就是本文件的 `backendRoutingBlock()`）。
 *
 * ⛔⛔ 为什么需要这一步：instructions 只在**启动时**自愈重写（boot 的 `instructionsOutdated` 判据），
 *   同一进程里切后端不会重跑那条路径 ⇒ 用户切了云端、模型下一轮还在按内置口径往 `lessons/` 写，
 *   直到重启为止。症状与「切了没反应」完全一样，但根因是提示层没刷新，不是工具面没刷新。
 * ⛔ 用 `require` 能力探测而不是静态 import：`cloud-provider` 是个重模块（会带起 applyCustomModel
 *   与整条云链路），静态引进来会让本叶子模块卷进环里；`require("字面量")` 不做模块解析，
 *   缺失/失败一律降级为「这次没刷新」（下次启动仍会自愈）。
 * ⛔ 失败静默：刷配置失败不能反过来把后端切换判成失败。
 */
export async function refreshEngineInstructions(): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const req: any = typeof require === "function" ? require : null;
    const mod: any = req ? req("./cloud-provider") : null;
    if (typeof mod?.refreshEngineProviders !== "function") return false;
    return Boolean(await mod.refreshEngineProviders());
  } catch {
    return false;
  }
}

/**
 * 给模型的「当前生效后端」块。
 *
 * ⛔ 为什么既有**权威值**又有**口诀**：
 *   · 权威值（宿主读设置得出）= 正常情况下的真相；
 *   · 口诀（以工具列表为准）= 兜底。引擎的 dynamicTools 只在 `thread/start` 定死，
 *     会话中途切后端时工具表要到下个线程才刷新 ⇒ 设置与工具面会短暂不一致。
 *     这种时候**必须以实际可用的工具为准**（有工具就调、没工具就别假装有），
 *     否则模型会调一个不在列表里的名字，失败后退回手写文件 = 写错位置。
 */
export function backendRoutingBlock(): string {
  const mem = memoryRoute();
  const kb = knowledgeRoute();
  const fmt = (tools: string[]) => (tools.length ? tools.map((t) => `\`${t}\``).join(" · ") : "（无工具：本后端不需要你调工具）");
  return `\n17) ACTIVE BACKENDS — the host writes the CURRENT values into this block at session start. ⛔ They can be switched in 设置 → 记忆（记忆后端）/ 设置 → 知识库（知识库来源）；the tool list is rebuilt on the NEXT thread start, so the two can disagree for a while — when they do, **the tool list wins** (see the cross-check rule below).\n` +
    `   · 记忆后端 = **${mem.backend}** ⇒ 落点 ${mem.store}\n` +
    `     工具：${fmt(mem.tools)}\n` +
    `     口径：${mem.how}\n` +
    `   · 知识库后端 = **${kb.backend}** ⇒ 落点 ${kb.store}\n` +
    `     工具：${fmt(kb.tools)}\n` +
    `     口径：${kb.how}\n` +
    `   CROSS-CHECK (do this BEFORE any memory/knowledge action — it beats the values above): look at your OWN tool list.\n` +
    `     · 有 \`${MEMORY_MCP_TOOLS.write}\` ⇒ MCP 记忆生效：写入走它，⛔ 不要写 lessons/*.md。没有它 ⇒ MCP 不生效（后端是 builtin 或 cloud），按上面那一行的口径办。\n` +
    `     · 有 \`${CLOUD_KB_TOOLS.ask}\` ⇒ 云端知识库生效：检索走云端工具。没有它 ⇒ 走本地库（grep 文档文件），⛔ 不要谎称查过云端。\n` +
    `   ⛔⛔ 名字必须逐字匹配：工具名形如 \`<后端>__<动作>\`（下划线，不是连字符，也没有 \`mcp__\` 前缀）。找不到**不要**试近义名字、不要换连接方式（node 直连 MCP server）、更**不要**把同一条内容在多个位置各写一份 —— 按上面的落点**只写一处**，并在回复里说一句「<后端> 工具不可达，已按 <落点> 落盘」。\n`;
}
