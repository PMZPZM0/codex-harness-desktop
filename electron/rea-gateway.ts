/**
 * REA 逆向分析 → 宿主 dynamicTools 网关（11-14，「REA 完全可用」修复）。
 *
 * 为什么需要这一层（三项实测，别凭代码猜）：
 *  ① 引擎 0.157+ 把 MCP 工具整批「延迟暴露」——config.toml 里 [mcp_servers.rea] 注册成功、
 *     握手 ready，模型直调仍返回 `unsupported call`（10-05 / 10-12 隔离探针实证，0.167.2 仍是永久默认）。
 *     唯一可达通道 = 宿主 thread/start 的 dynamicTools。
 *  ② REA 6.7.0 的 `tools/list` 返回 **207 个工具**，全量注入 dynamicTools 会把 prompt 前缀撑爆。
 *     ⇒ 只暴露一个网关工具，按 action=list / describe / call 渐进披露。
 *  ③ REA 的 start_* / resume_* / close_* / frida_* 是**有状态会话**（分析目标、Frida/GDB/Cutter 会话），
 *     短命 stdio 会话会把状态丢掉 ⇒ 这里维持一条可复用的持久会话（探针实测：同一会话第二次
 *     tools/list 仍返回 207，tools/call 能拿回结构化结果）。
 *
 * ⛔ 版本为什么锁：随包内置 Node = v24.19.0，而 rea-agents 6.8.0 起把 engines.node 抬到
 *    `^22.23.4 || ^24.22.1 || >=26.12.1` —— `rea.mjs` 的 runtime admission 会直接 exit 1
 *    （实测 6.9.0 + v24.19.0：握手 0 工具、退出码 1）。6.7.0 是**与当前内置 Node 兼容的最高版本**
 *    （engines `^22.19.0 || ^24.11.0 || >=26.0.0`，实测握手 ready / 207 工具）。
 *    ponytail: 硬编码版本天花板 = 升级内置 Node 到 >=24.22.1 后即可删掉 pin 与这里的判据，恢复追 latest。
 */
import type { StdioSession, McpToolSpec } from "./mcp-bridge";
import { mcpToolName } from "./backend-routing";
import { bundledNode, reaServerScript } from "./toolchain";

/** 与随包 Node 兼容的最高上游版本（安装 / 在线更新 / 复核三处共用，⛔ 别再抄第二份）。 */
export const REA_PINNED_VERSION = "6.7.0";
/** 网关工具名走 mcpToolName 单一生成器（与连接器前缀同源）。 */
export const REA_GATEWAY_TOOL = mcpToolName("rea", "gateway");
/** 网关不是 REA 的真实工具名；执行端靠 serverId + 这个标记分流。 */
const REA_GATEWAY_MARK = "__gateway__";

const IDLE_MS = 10 * 60 * 1000;
const RESULT_LIMIT = 30000;

/**
 * config.toml 的 [mcp_servers.rea] 段形态是否漂移（纯函数，守卫可真跑）。
 * 宿主形态 = 随包 node + scripts/rea.mjs；外部形态 = 上游 install.sh 写的
 * `cmd.exe /d /c npx -y rea-agents@… mcp`（每次启动联网拉包，与按需下载设计相悖）。
 * ponytail: 只认外部形态的特征词，不逐字比对整段（避免把 TOML 转义抄第二份）；
 *           将来上游换包装脚本时补一个特征词即可。
 */
export function reaMcpDrifted(configText: string, ready: boolean): boolean {
  let inRea = false;
  let hasSection = false;
  let externalShape = false;
  for (const raw of String(configText || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (/^\[/.test(line)) {
      inRea = /^\[mcp_servers\.rea\]$/.test(line);
      if (inRea) hasSection = true;
      continue;
    }
    if (inRea && /\bnpx\b|cmd\.exe|rea-agents@/i.test(line)) externalShape = true;
  }
  // 包没就绪 ⇒ 段必须消失（ownedMcpServers 重写时会清掉）；包就绪 ⇒ 段必须在、且不是外部形态。
  return ready ? !hasSection || externalShape : hasSection;
}

/** 网关 dynamicTool 的 spec；包未装或装坏了返回 null（工具面干净消失）。 */
export function reaGatewaySpec(): McpToolSpec | null {
  const script = reaServerScript();
  const node = bundledNode();
  if (!script || !node) return null;
  return {
    name: REA_GATEWAY_TOOL,
    description:
      "REA 逆向分析工具网关（morluto/rea）：拆解 Electron/JS 应用、.NET 程序集、原生二进制、网站、SQLite 等，"
      + "共 200+ 个工具，全部通过这一个网关访问，⛔ 不要直接按工具名调用。\n"
      + "action=\"list\" 列出可用工具（可带 query 按名字/描述过滤）；action=\"describe\" 传 name 拿该工具的完整参数说明；"
      + "action=\"call\" 传 name + args 真正执行。不确定参数时先 describe。\n"
      + "典型流程：list 找工具 → describe 看参数 → call 执行（同一会话内分析状态会保留）。",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "describe", "call"], description: "list / describe / call" },
        query: { type: "string", description: "list 时按工具名或描述过滤（可选）" },
        name: { type: "string", description: "describe / call 时的 REA 工具名（来自 list）" },
        args: { type: "object", description: "call 时传给该工具的参数对象" },
      },
      required: ["action"],
    },
    serverId: "rea",
    transport: "stdio",
    serverUrl: "",
    serverToken: "",
    command: node,
    args: [script, "mcp"],
    env: {},
    rawName: REA_GATEWAY_MARK,
  };
}

/** 是不是我们的网关调用（mcp-bridge.callMcpTool 用它分流）。 */
export function isReaGatewaySpec(spec: McpToolSpec): boolean {
  return spec.serverId === "rea" && spec.rawName === REA_GATEWAY_MARK;
}

type Active = { session: StdioSession; command: string; script: string };
let active: Active | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function resetSession() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  const old = active;
  active = null;
  try { old?.session.close(); } catch { /* 已退出 */ }
}

function bumpIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(resetSession, IDLE_MS);
  idleTimer.unref?.();
}

/** 懒启动 + 复用一条 REA stdio 会话；动态 import 只为避开 mcp-bridge ↔ 本文件的加载环。 */
async function ensureSession(command: string, script: string): Promise<StdioSession> {
  if (active && active.command === command && active.script === script) {
    bumpIdle();
    return active.session;
  }
  resetSession();
  const { openStdio } = await import("./mcp-bridge");
  const session = openStdio({ command, args: [script, "mcp"], env: {} });
  try {
    await session.call("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "codex-harness", version: "1" },
    });
    session.notify("notifications/initialized");
  } catch (error) {
    try { session.close(); } catch { /* 已退出 */ }
    throw error;
  }
  active = { session, command, script };
  bumpIdle();
  return session;
}

function textOf(result: any): string {
  const text = Array.isArray(result?.content)
    ? result.content.map((item: any) => typeof item?.text === "string" ? item.text : JSON.stringify(item ?? {})).join("\n")
    : JSON.stringify(result ?? {});
  return text.length > RESULT_LIMIT ? `${text.slice(0, RESULT_LIMIT)}\n…（结果已截断，可用 describe 缩小范围）` : text;
}

type ToolRow = { name: string; description?: string; inputSchema?: Record<string, unknown> };
const toolsOf = (result: any): ToolRow[] => Array.isArray(result?.tools) ? result.tools : [];

/** 主进程应答一次 dynamicTool 调用。失败只重置会话、⛔ 不自动重试（避免有状态工具被执行两次）。 */
export async function callReaGateway(rawArgs: unknown): Promise<{ ok: boolean; text: string }> {
  const args = (rawArgs && typeof rawArgs === "object" ? rawArgs : {}) as Record<string, unknown>;
  const action = String(args.action ?? "").trim();
  if (!["list", "describe", "call"].includes(action)) {
    return { ok: false, text: `未知的 action：${action || "(空)"}。只用 list / describe / call。` };
  }
  const script = reaServerScript();
  const node = bundledNode();
  if (!script || !node) {
    return { ok: false, text: "REA 逆向分析未安装或安装不完整。请到「设置 → 开发工具 → REA 逆向分析」重新安装（约 100 MB，国内镜像），装完重启应用。" };
  }
  try {
    const session = await ensureSession(node, script);
    if (action === "call") {
      const name = String(args.name ?? "").trim();
      if (!name) return { ok: false, text: "action=call 必须给 name（先用 list 查工具名）。" };
      const callArgs = args.args && typeof args.args === "object" ? args.args : {};
      const result = await session.call("tools/call", { name, arguments: callArgs });
      return { ok: !result?.isError, text: textOf(result) };
    }
    const listed = toolsOf(await session.call("tools/list", {}));
    if (action === "describe") {
      const name = String(args.name ?? "").trim();
      const tool = listed.find((entry) => entry.name === name);
      if (!tool) return { ok: false, text: `REA 没有名为 ${name || "(空)"} 的工具。先调 action=list 查名字。` };
      return { ok: true, text: JSON.stringify(tool, null, 2) };
    }
    const query = String(args.query ?? "").trim().toLowerCase();
    const matched = query
      ? listed.filter((entry) => `${entry.name} ${entry.description ?? ""}`.toLowerCase().includes(query))
      : listed;
    return {
      ok: true,
      text: JSON.stringify({
        total: listed.length,
        matched: matched.length,
        hint: "选定工具后先 action=describe 看参数，再 action=call 执行。",
        tools: matched.map((entry) => ({ name: entry.name, description: String(entry.description ?? "").slice(0, 100) })),
      }, null, 2),
    };
  } catch (error) {
    resetSession();
    return { ok: false, text: `REA 网关调用失败：${(error as Error)?.message ?? String(error)}。会话已重置，请重试一次。` };
  }
}

// 应用退出时别把 REA 的 MCP 子进程留成孤儿。
process.once("exit", resetSession);
