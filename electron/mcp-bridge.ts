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
import { spawn } from "node:child_process";
import { decryptSecret, readConnectors } from "./main/07-connectors-io";
/* 10-20：工具名生成 + 「哪套后端该暴露」的判定都在 backend-routing.ts（单一真相源）。
   ⛔ 不许在本文件再写一份前缀/过滤规则 —— 那正是「指令教的名字 ≠ 工具列表里的名字」的来源。 */
import { isConnectorBlockedByBackend, mcpToolName } from "./backend-routing";
import { stripStepParam } from "../src/lib/step-note.mjs";

export type McpToolSpec = {
  /** 暴露给模型的工具名（加前缀避免与内置撞名，如 kb__search_knowledge） */
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** 转发用：原始工具名 + 目标端点 */
  serverId: string;
  transport: "http" | "stdio";
  serverUrl: string;
  serverToken: string;
  /** stdio 传输时用（http 时为空） */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  rawName: string;
};

type ConnectorRow = {
  id?: string; name?: string; url?: string; enabled?: boolean;
  transport?: string; command?: string; args?: string[]; env?: Record<string, string>;
  /** 令牌不落明文：secret 在 encryptedSecrets[envHttpHeaders.Authorization]，需 decrypt */
  envHttpHeaders?: Record<string, string>;
  encryptedSecrets?: Record<string, string>;
};

/* 工具名 ⊆ backend-routing.ts 的 `mcpToolName`（唯一生成器）；
   ⛔ 这里不再有本地前缀函数 —— 指令/技能引用的是同一个函数算出来的名字。 */

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
  return normalizeTools(listed);
}

/* ── stdio 传输 ────────────────────────────────────────────────────────────────
   ⛔ 记忆后端 = mcp 时，`local-memory` 连接器就是 **stdio**（command=electron.exe +
      ELECTRON_RUN_AS_NODE=1 + 服务脚本路径）。只做 HTTP 的话「MCP 记忆」这一档仍然不可用
      —— 所以两种传输都必须覆盖，否则「修好记忆后端」是空话。
   分帧：MCP 的 stdio 用**换行分隔的 JSON**（不是 Content-Length），一次调用一行、按 id 收响应。 */

type StdioConn = { command: string; args: string[]; env: Record<string, string> };

type StdioSession = {
  call: (method: string, params?: unknown) => Promise<any>;
  notify: (method: string) => void;
  close: () => void;
};

/** 起一个短命 stdio 会话（用完即 kill；换来的是零状态残留，不会留下孤儿进程） */
function openStdio(conn: StdioConn): StdioSession {
  const child = spawn(conn.command, conn.args, {
    env: { ...process.env, ...conn.env },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let buf = "";
  let stderr = "";
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  const failAll = (message: string) => {
    for (const slot of pending.values()) slot.reject(new Error(message));
    pending.clear();
  };
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    buf += chunk;
    for (let at = buf.indexOf("\n"); at >= 0; at = buf.indexOf("\n")) {
      const line = buf.slice(0, at).trim();
      buf = buf.slice(at + 1);
      if (!line) continue;
      let msg: any;
      try { msg = JSON.parse(line); } catch { continue; }          // 非 JSON 行（日志混进 stdout）直接跳过
      const slot = typeof msg?.id === "number" ? pending.get(msg.id) : undefined;
      if (!slot) continue;
      pending.delete(msg.id);
      if (msg?.error) slot.reject(new Error(String(msg.error?.message ?? JSON.stringify(msg.error))));
      else slot.resolve(msg?.result);
    }
  });
  /* stderr 只留尾巴：服务起不来时错误全在这里，不带出来就只剩一句“超时” */
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-800); });
  child.on("error", (error: Error) => failAll(`MCP 进程启动失败：${error.message}`));
  child.on("exit", (code) => failAll(`MCP 进程退出（code=${code}）${stderr ? `：${stderr.trim().slice(-300)}` : ""}`));

  const call = (method: string, params?: unknown) => new Promise<any>((resolve, reject) => {
    const id = nextId();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP ${method} 超时（20s）${stderr ? `：${stderr.trim().slice(-200)}` : ""}`)); }, 20000);
    pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} })}\n`);
  });
  const notify = (method: string) => { child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`); };
  const close = () => {
    try { child.stdin?.end(); } catch { /* 已关闭 */ }
    try { child.kill(); } catch { /* 已退出 */ }
  };
  return { call, notify, close };
}

/** 握手 + 执行 + 收尾（initialize → initialized 通知 → fn） */
async function withStdio<T>(conn: StdioConn, fn: (session: StdioSession) => Promise<T>): Promise<T> {
  const session = openStdio(conn);
  try {
    await session.call("initialize", {
      protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "codex-harness", version: "1" },
    });
    session.notify("notifications/initialized");
    return await fn(session);
  } finally { session.close(); }
}

/** 连接器行 → stdio 启动参数（没有 command 就不是 stdio） */
function stdioConnOf(row: ConnectorRow): StdioConn | null {
  const command = String(row?.command || "").trim();
  if (!command) return null;
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(row?.env ?? {})) env[key] = String(value);
  return { command, args: Array.isArray(row?.args) ? row.args.map(String) : [], env };
}

/** 把 MCP 的 tools 数组规整成内部结构（两种传输共用） */
function normalizeTools(listed: any): Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> {
  const tools = Array.isArray(listed?.tools) ? listed.tools : [];
  return tools.map((t: any) => ({
    name: String(t?.name || ""),
    description: String(t?.description || ""),
    inputSchema: (t?.inputSchema && typeof t.inputSchema === "object") ? t.inputSchema as Record<string, unknown> : { type: "object", properties: {} },
  })).filter((t: { name: string }) => Boolean(t.name));
}

/** MCP `tools/call` 的结果 → 纯文本（content[] 里 type=text 的拼起来） */
function textOfResult(result: any): { ok: boolean; text: string } {
  const parts = Array.isArray(result?.content) ? result.content : [];
  const text = parts
    .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
  const isError = Boolean(result?.isError);
  return { ok: !isError, text: text || (isError ? "（MCP 返回错误但没有文本）" : "（无返回内容）") };
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
  /* ⛔⛔ 10-20 第二道过滤：**受后端管辖的连接器**（local-memory / cloud-memory / cloud-kb）
     只有属于当前后端时才暴露工具。第一道（enabled）不够 —— 知识库切回「本地」时 cloud-kb
     连接器仍是 enabled（凭据在，只是不该用），记忆切到 builtin 时同理 ⇒ 模型会看到两套后端工具，
     「该调哪个」只能靠猜，猜错就是写错位置。判定单一真相源 = backend-routing.ts。
     ⛔ 只挡这三个：tencent-docs / cos 之类与后端无关的连接器照旧暴露。 */
  const out: McpToolSpec[] = [];
  for (const row of rows) {
    if (row?.enabled === false) continue;
    const id = String(row?.id || row?.name || "mcp");
    if (isConnectorBlockedByBackend(id)) {
      console.log(`[mcp-bridge] ${id}: 不属于当前后端 ⇒ 不暴露`);
      continue;
    }
    const url = String(row?.url || "").trim();
    const stdio = url ? null : stdioConnOf(row);
    if (!url && !stdio) continue;                 // 既没 url 也没 command ⇒ 配了一半的残项，跳过
    /* ⛔ 10-20 审查抓到的坑：连接器**不存明文 token**——secret 存在 encryptedSecrets 里，
       key 由 envHttpHeaders.Authorization 指明（cloud-mcp.ts 用 secretKey 环境变量名）。
       直接读 row.token 会永远为空 ⇒ MCP 请求无鉴权 ⇒ 401 ⇒ 桥接形同虚设。 */
    const secretKey = String(row?.envHttpHeaders?.Authorization || "");
    const encrypted = secretKey ? String(row?.encryptedSecrets?.[secretKey] || "") : "";
    /* ⛔ 复用 07-connectors-io 已导出的 decryptSecret（safeStorage）——三仓共有，
       不必探测 cloud-api（云助手仓没有它）。安全存储不可用时返回空串 ⇒ 按无 token 处理。 */
    let token = "";
    if (encrypted) { try { token = decryptSecret(encrypted) || ""; } catch { token = ""; } }
    try {
      /* stdio 走本地进程（MCP 记忆服务就是这条），其余走 HTTP 端点 */
      const tools = stdio ? await withStdio(stdio, (s) => s.call("tools/list", {}).then(normalizeTools)) : await listToolsOn(url, token);
      for (const t of tools as Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>) {
        out.push({
          name: mcpToolName(id, t.name),
          description: t.description || `${id} 提供的 ${t.name}`,
          inputSchema: t.inputSchema || { type: "object", properties: {} },
          serverId: id,
          transport: stdio ? "stdio" : "http",
          serverUrl: url,
          serverToken: token,
          command: stdio?.command,
          args: stdio?.args,
          env: stdio?.env,
          rawName: t.name,
        });
      }
      console.log(`[mcp-bridge] ${id}（${stdio ? "stdio" : "http"}）: ${tools.length} 个工具已接入 dynamicTools`);
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
  /* ⛔ 转发前剥掉宿主的展示参数 `step`（10-21）：它只服务于界面标题，
     第三方 MCP / 我们自己的执行端都不认这个键 —— 严校验的服务器会直接判成非法入参。
     剥离点就这一处（所有 MCP 调用都从这里出去），别在执行端各写一遍。 */
  const params = { name: spec.rawName, arguments: stripStepParam(args && typeof args === "object" ? args : {}) };
  if (spec.transport === "stdio") {
    const conn: StdioConn = { command: String(spec.command || ""), args: spec.args ?? [], env: spec.env ?? {} };
    if (!conn.command) return { ok: false, text: `MCP 连接器 ${spec.serverId} 缺少启动命令` };
    try {
      return await withStdio(conn, async (s) => textOfResult(await s.call("tools/call", params)));
    } catch (error: any) {
      return { ok: false, text: `MCP 调用失败：${error?.message || error}` };
    }
  }
  try {
    const result = await rpc(spec.serverUrl, spec.serverToken, {
      jsonrpc: "2.0", id: nextId(), method: "tools/call", params,
    }, 60000);
    return textOfResult(result);
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
