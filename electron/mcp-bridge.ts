/**
 * MCP ↔ dynamicTools 桥接（10-20 用户令：把内置 MCP 工具接回模型可见面）。
 *
 * 背景（为什么需要这一层）：
 *   引擎 0.157 起把**内置 MCP 工具整批「延迟暴露」** —— 连接器配好了、端点通了，
 *   但模型侧的工具列表里看不到（`memory_write` 调不到、云端知识库的 ask/search_knowledge 也调不到）。
 *   唯一绕过方式 = 宿主用 `thread/start` 的 **dynamicTools** 自己注册（引擎对 dynamicTools 不延迟）。
 *   ⛔ `thread/resume` 会**整份忽略** dynamicTools（ThreadResumeParams 里没这个字段）⇒
 *      老会话升级必须走"resume 前改写 rollout 首行"那条路，本模块只负责能力面。
 *
 * 本模块只做三件事：
 *   ① 通用 MCP 客户端（initialize / tools/list / tools/call，HTTP；响应兼容 SSE 帧）
 *   ② 把 MCP 的 tools 转成 dynamicTools 的 schema（`{ type: "function", name, description, inputSchema }`）
 *   ③ 把模型的调用按名字转发回对应端点
 *
 * ⛔ 不做的事：不缓存鉴权结果、不写连接器配置（那是 cloud-mcp.ts 的职责）。
 *    只读 `readConnectors()` 里已启用、带 url 的项。
 */
import { readConnectors } from "./main/07-connectors-io";

export type McpToolSpec = {
  /** 暴露给模型的工具名（加前缀避免与内置撞名，如 kb__search_knowledge） */
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** 转发用：原始工具名 + 目标端点 */
  serverId: string;
  serverUrl: string;
  serverToken: string;
  rawName: string;
};

type ConnectorRow = {
  id?: string; name?: string; url?: string; enabled?: boolean;
  /** 令牌不落明文：secret 在 encryptedSecrets[envHttpHeaders.Authorization]，需 decrypt */
  envHttpHeaders?: Record<string, string>;
  encryptedSecrets?: Record<string, string>;
};

/** 工具名前缀：`<connectorId 简化>__<原工具名>`，⛔ 只用 [a-zA-Z0-9_]（OpenAI function name 限制） */
function toolPrefix(connectorId: string): string {
  const safe = String(connectorId || "mcp").replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 24);
  return `${safe}__`;
}

/** 从 SSE 文本里抽 JSON（响应可能是 `event: message\ndata: {...}` 多帧） */
function parseMcpBody(text: string, contentType: string): any {
  const raw = String(text || "").trim();
  if (!raw) return null;
  if (!/event-stream/i.test(contentType) && raw.startsWith("{")) {
    try { return JSON.parse(raw); } catch { /* 落到下面按帧解析 */ }
  }
  /* SSE：取最后一个 data: 行（tools/call 的结果通常在最后一帧） */
  const lines = raw.split(/\r?\n/);
  let last: any = null;
  for (const line of lines) {
    const m = /^data:\s*(.*)$/.exec(line);
    if (!m) continue;
    const payload = m[1].trim();
    if (!payload || payload === "[DONE]") continue;
    try { last = JSON.parse(payload); } catch { /* 跳过非 JSON 帧 */ }
  }
  if (last) return last;
  try { return JSON.parse(raw); } catch { return null; }
}

/** 单次 JSON-RPC 调用（MCP over HTTP：POST 一条消息，读一条响应） */
async function rpc(url: string, token: string, body: Record<string, unknown>, timeoutMs = 20000): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(token ? { authorization: /^Bearer\s/i.test(token) ? token : `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    const json = parseMcpBody(text, String(res.headers.get("content-type") || ""));
    if (!res.ok) {
      const msg = json?.error?.message || json?.message || text.slice(0, 200) || `HTTP ${res.status}`;
      throw new Error(`MCP ${res.status}: ${msg}`);
    }
    if (json?.error) throw new Error(`MCP error: ${json.error.message || JSON.stringify(json.error)}`);
    return json?.result ?? json;
  } finally {
    clearTimeout(timer);
  }
}

let rpcSeq = 0;
const nextId = () => ++rpcSeq;

/** 一个端点上的 MCP 会话：initialize → tools/list */
async function listToolsOn(url: string, token: string): Promise<Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>> {
  /* initialize：协议握手。⛔ 失败直接抛，由调用方决定跳过该连接器（不让一个坏端点拖垮整批）。 */
  await rpc(url, token, {
    jsonrpc: "2.0", id: nextId(), method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "codex-harness", version: "1" } },
  });
  const listed = await rpc(url, token, { jsonrpc: "2.0", id: nextId(), method: "tools/list", params: {} });
  const tools = Array.isArray(listed?.tools) ? listed.tools : [];
  return tools.map((t: any) => ({
    name: String(t?.name || ""),
    description: String(t?.description || ""),
    inputSchema: (t?.inputSchema && typeof t.inputSchema === "object") ? t.inputSchema as Record<string, unknown> : { type: "object", properties: {} },
  })).filter((t: { name: string }) => Boolean(t.name));
}

/** 缓存：连接器清单变化或超过 TTL 才重拉（thread/start 每次都会问，不能每次都打网络） */
let cache: { at: number; tools: McpToolSpec[] } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export function invalidateMcpBridgeCache(): void { cache = null; }

/** 聚合所有已启用连接器的工具（失败项静默跳过，只留日志） */
export async function listMcpDynamicTools(force = false): Promise<McpToolSpec[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.tools;
  let rows: ConnectorRow[] = [];
  try { rows = (await readConnectors()) as ConnectorRow[]; } catch { rows = []; }
  const out: McpToolSpec[] = [];
  for (const row of rows) {
    const url = String(row?.url || "").trim();
    if (!url || row?.enabled === false) continue;
    const id = String(row?.id || row?.name || "mcp");
    /* ⛔ 10-20 审查抓到的坑：连接器**不存明文 token**——secret 存在 encryptedSecrets 里，
       key 由 envHttpHeaders.Authorization 指明（cloud-mcp.ts 用 secretKey 环境变量名）。
       直接读 row.token 会永远为空 ⇒ MCP 请求无鉴权 ⇒ 401 ⇒ 桥接形同虚设。 */
    const secretKey = String(row?.envHttpHeaders?.Authorization || "");
    const encrypted = secretKey ? String(row?.encryptedSecrets?.[secretKey] || "") : "";
    let token = "";
    if (encrypted) {
      /* ⛔ 云助手仓没有 cloud-api.ts（safeStorage 封装只存在于主仓/PPCode）⇒ 动态导入并降级，
         找不到解密器按"无 token"处理（该仓本来也不写云端连接器）。 */
      try {
        /* ⛔ 用 require 而不是 import()：TS 对 `import("./x")` **仍做模块解析**（云助手仓没有
           cloud-api.ts 会直接报 TS2307）；`require("字面量")` 不解析、返回 any —— 这是项目既有结论。 */
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const req: any = typeof require === "function" ? require : null;
        const mod: any = req ? req("./cloud-api") : null;
        token = mod?.decrypt ? String(mod.decrypt(encrypted)) : "";
      } catch { token = ""; }
    }
    try {
      const tools = await listToolsOn(url, token);
      for (const t of tools as Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>) {
        out.push({
          name: toolPrefix(id) + t.name.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 40),
          description: t.description || `${id} 提供的 ${t.name}`,
          inputSchema: t.inputSchema || { type: "object", properties: {} },
          serverId: id,
          serverUrl: url,
          serverToken: token,
          rawName: t.name,
        });
      }
      console.log(`[mcp-bridge] ${id}: ${tools.length} 个工具已接入 dynamicTools`);
    } catch (error: any) {
      console.warn(`[mcp-bridge] ${id} 跳过：${error?.message || error}`);
    }
  }
  cache = { at: Date.now(), tools: out };
  return out;
}

/** 转成引擎要的 dynamicTools 结构（OpenAI function schema） */
export function toDynamicTools(tools: McpToolSpec[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    type: "function",
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

/** 按暴露名找到原始工具信息 */
export async function resolveMcpTool(name: string): Promise<McpToolSpec | null> {
  const tools = await listMcpDynamicTools();
  return tools.find((t) => t.name === name) ?? null;
}

/** 转发一次工具调用（模型传进来的 arguments 原样交给 MCP） */
export async function callMcpTool(name: string, args: unknown): Promise<{ ok: boolean; text: string }> {
  const spec = await resolveMcpTool(name);
  if (!spec) return { ok: false, text: `未知的 MCP 工具：${name}` };
  try {
    const result = await rpc(spec.serverUrl, spec.serverToken, {
      jsonrpc: "2.0", id: nextId(), method: "tools/call",
      params: { name: spec.rawName, arguments: args && typeof args === "object" ? args : {} },
    }, 60000);
    /* MCP 的 tools/call 结果形如 { content: [{ type: "text", text: "..." }], isError? } */
    const parts = Array.isArray(result?.content) ? result.content : [];
    const text = parts
      .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
    const isError = Boolean(result?.isError);
    return { ok: !isError, text: text || (isError ? "（MCP 返回错误但没有文本）" : "（无返回内容）") };
  } catch (error: any) {
    return { ok: false, text: `MCP 调用失败：${error?.message || error}` };
  }
}

/**
 * 主进程侧应答模型的 `item/tool/call`（dynamicTools 的调用回调）。
 * 返回 true = 已应答（调用方不要再转发给渲染层）；false = 不是 MCP 工具，交回原流程。
 *
 * ⛔ 只认**带连接器前缀**的工具名（`listMcpDynamicTools` 生成的 `xxx__tool`）——
 *    绝不能把任意工具名都吞掉，否则会把 memory_write / harness_tools 抢走。
 */
export async function handleMcpToolCall(input: {
  event: { id?: string | number; method?: string; params?: any };
  respond: (id: string | number, result: unknown) => void;
}): Promise<boolean> {
  const { event, respond } = input;
  if (String(event?.method ?? "") !== "item/tool/call") return false;
  const toolName = String(event?.params?.tool ?? "");
  if (!toolName || !toolName.includes("__")) return false;      // 快速排除：无前缀必定不是 MCP
  const spec = await resolveMcpTool(toolName);
  if (!spec) return false;                                       // 不在缓存里 ⇒ 不是我们注册的工具
  const id = event?.id;
  if (id === undefined || id === null) return false;
  const raw = event?.params?.arguments;
  let args: unknown = {};
  if (typeof raw === "string") { try { args = JSON.parse(raw); } catch { args = {}; } }
  else if (raw && typeof raw === "object") args = raw;
  const result = await callMcpTool(toolName, args).catch((error: any) => ({ ok: false, text: `MCP 调用异常：${error?.message || error}` }));
  respond(id, {
    contentItems: [{ type: "inputText", text: result.text }],
    success: result.ok,
  });
  return true;
}
