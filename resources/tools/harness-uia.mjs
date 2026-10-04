#!/usr/bin/env node
/**
 * harness-uia.mjs —— Windows 原生控件清单通道（MCP stdio server，零依赖）。
 *
 * 为什么要有它：nuphus 的桌面定位是「截屏 → 本地 OCR → 像素坐标」，坐标在窗口挪动 / DPI 缩放 /
 * 自绘界面上会失手。Windows 自己有一份「控件清单」（UI Automation：每个按钮/输入框的类型、名字、
 * AutomationId、矩形、支持哪些动作），拿到就能按序号直接操作，不用猜坐标。
 * ⛔ 但 UIA 只对**原生 Win32/WPF/WinForms** 应用给得全；Chromium/Electron/Tauri 窗口实测只有个位数
 *   元素（浏览器里的东西该走 browser_* / playwright，坐标兜底仍归 nuphus）。三者各管一段，不互相顶。
 *
 * 分工：真正的 UIA 调用在 `desktop-uia.ps1`（用 Windows 自带的 UIAutomation 程序集，零体积、不下载）；
 * 本文件只做 MCP 门面 + 参数校验 + 结果归一化。
 *
 * ⛔ 三条硬规矩：
 *  1. **只用 spawn + 参数数组，绝不开 shell** —— title/text 是外部输入，拼进命令行就是注入面。
 *  2. **写操作必须 confirm:true** —— invoke / 填值与 nuphus 的 desktop_mouse 同一条口径。
 *  3. **非 Windows 一律不注册工具**（tools/list 返回空数组），而不是返回报错：让引擎侧干净消失。
 *
 * 注册方：`electron/features/custom-model-apply.ts` 写 `[mcp_servers.harness-uia]`
 * （command = 随包 node，args = [本文件]），且只在 win32 + 桌面总闸开启时写。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE = path.join(HERE, "desktop-uia.ps1");
const IS_WINDOWS = process.platform === "win32";
const BRIDGE_TIMEOUT_MS = 25_000;
const MAX_LIMIT = 2000;

const TOOLS = [
  {
    name: "desktop_ui_windows",
    description: "列出当前所有可见的顶层窗口（标题、类名、进程号 pid、位置大小）。用 UIA 操作原生应用的第一步：先拿 pid。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "desktop_ui_snapshot",
    description: "读某个窗口的**原生控件清单**（UI Automation 树）：每个元素的序号、控件类型、名字、AutomationId、屏幕矩形，以及支持的动作（invoke=可点击 / value=可赋值 / toggle / scroll / expand / select）。操作前先拍一次，界面变了要重拍。⚠️ 对 Chromium/Electron/Tauri 窗口清单会很浅（只有个位数元素），那种目标改用 browser_* 工具或坐标点击。",
    inputSchema: {
      type: "object",
      properties: {
        processId: { type: "number", description: "目标窗口所属进程 pid（首选，最准）" },
        title: { type: "string", description: "按窗口标题模糊匹配（没给 pid 时用）" },
        limit: { type: "number", description: `最多返回多少个元素（默认 300，上限 ${MAX_LIMIT}）；元素很多时先小再精` },
      },
    },
  },
  {
    name: "desktop_ui_invoke",
    description: "按 snapshot 给的**序号**点击元素（UIA InvokePattern，不依赖鼠标坐标，窗口挪了也不用重算）。写操作，必须显式 confirm=true；不可逆的动作（发送/删除/支付/覆盖保存）先向用户说明要点哪个再等确认。",
    inputSchema: {
      type: "object",
      properties: {
        processId: { type: "number", description: "目标进程 pid" },
        title: { type: "string", description: "按窗口标题匹配（没给 pid 时用）" },
        index: { type: "number", description: "元素序号（来自 desktop_ui_snapshot 的 index；界面一变就可能失效，报错就重新拍清单）" },
        confirm: { type: "boolean", description: "必须传 true 才会真的点击" },
      },
      required: ["index", "confirm"],
    },
  },
  {
    name: "desktop_ui_set_value",
    description: "按序号往元素里**写值**（UIA ValuePattern，整串替换，比逐字键入快且不会丢中文）。写操作，必须 confirm=true。元素不支持 value 时改用 desktop_input（nuphus）逐字输入。",
    inputSchema: {
      type: "object",
      properties: {
        processId: { type: "number", description: "目标进程 pid" },
        title: { type: "string", description: "按窗口标题匹配（没给 pid 时用）" },
        index: { type: "number", description: "元素序号" },
        text: { type: "string", description: "要写入的内容" },
        confirm: { type: "boolean", description: "必须传 true 才会真的写" },
      },
      required: ["index", "text", "confirm"],
    },
  },
];

/** PowerShell 会把 stdout 带上 UTF-8 BOM，且可能混入警告行 ⇒ 只取最后一条以 `{` 开头的行。 */
function extractJson(raw) {
  const text = String(raw).replace(/^/, "");
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].startsWith("{")) return lines[i];
  return text.trim();
}

/** PowerShell 5.1 的 ConvertTo-Json 会把空数组序列化成 `{}`，这里统一回数组。 */
function normalize(raw) {
  let data;
  try { data = JSON.parse(extractJson(raw)); } catch { return { ok: false, code: "bridge_unparsable", error: `桥输出不是 JSON：${String(raw).slice(0, 200)}` }; }
  if (!data || typeof data !== "object") return { ok: false, code: "bridge_unparsable", error: "桥输出为空" };
  for (const key of ["windows", "elements", "actions"]) {
    if (data[key] && typeof data[key] === "object" && !Array.isArray(data[key])) data[key] = [];
    if (Array.isArray(data.windows) || Array.isArray(data.elements)) break;
  }
  if (Array.isArray(data.windows)) data.windows = data.windows.map((w) => ({ ...w, ...(w.actions && !Array.isArray(w.actions) ? { actions: [] } : {}) }));
  if (Array.isArray(data.elements)) data.elements = data.elements.map((e) => ({ ...e, actions: Array.isArray(e.actions) ? e.actions : [] }));
  return data;
}

function runBridge(args) {
  return new Promise((resolve) => {
    if (!fs.existsSync(BRIDGE)) { resolve({ ok: false, code: "bridge_missing", error: `找不到控件清单脚本：${BRIDGE}` }); return; }
    const powershell = process.env.SystemRoot
      ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
      : "powershell.exe";
    const child = spawn(powershell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", BRIDGE, ...args], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const killChild = () => { try { child.kill("SIGKILL"); } catch { /* 已退出 */ } };
    const done = (value) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => {
      killChild();
      done({ ok: false, code: "bridge_timeout", error: `控件清单脚本超过 ${BRIDGE_TIMEOUT_MS / 1000} 秒没返回（目标界面可能卡住了）` });
    }, BRIDGE_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 4_000_000) { killChild(); done({ ok: false, code: "bridge_too_large", error: "清单过大已中止；给 snapshot 传更小的 limit" }); }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => done({ ok: false, code: "bridge_spawn_failed", error: `启动 PowerShell 失败：${error?.message ?? error}` }));
    child.on("close", (code) => {
      const text = stdout.trim();
      if (!text) { done({ ok: false, code: "bridge_no_output", error: `脚本没有输出（exit=${code}）${stderr ? ` stderr: ${stderr.slice(0, 300)}` : ""}` }); return; }
      done(normalize(text));
    });
  });
}

function num(value) { const n = Number(value); return Number.isFinite(n) ? Math.trunc(n) : 0; }

/** 目标窗口参数：pid 优先，其次标题；两者都不给就让桥返回窗口清单（snapshot 需要明确目标）。 */
function targetArgs(args) {
  const out = [];
  const pid = num(args?.processId ?? args?.pid);
  if (pid > 0) out.push("-ProcessId", String(pid));
  const title = typeof args?.title === "string" ? args.title.trim() : "";
  if (title) out.push("-Title", title);
  return out;
}

async function callTool(name, args) {
  if (!IS_WINDOWS) return { ok: false, error: "控件清单通道只在 Windows 上提供" };
  if (name === "desktop_ui_windows") return await runBridge(["-Action", "windows"]);
  if (name === "desktop_ui_snapshot") {
    const limit = Math.min(MAX_LIMIT, Math.max(1, num(args?.limit) || 300));
    return await runBridge(["-Action", "snapshot", ...targetArgs(args), "-Limit", String(limit)]);
  }
  if (name === "desktop_ui_invoke" || name === "desktop_ui_set_value") {
    if (args?.confirm !== true) return { ok: false, error: "这是写操作：必须显式传 confirm=true（确认你真的要点/要写）" };
    if (!targetArgs(args).length) return { ok: false, error: "缺少目标窗口：传 processId 或 title" };
    const index = num(args?.index);
    if (index < 0) return { ok: false, error: "index 无效：先用 desktop_ui_snapshot 拿元素序号" };
    if (name === "desktop_ui_invoke") return await runBridge(["-Action", "invoke", ...targetArgs(args), "-Index", String(index)]);
    const text = typeof args?.text === "string" ? args.text : "";
    if (!text) return { ok: false, error: "text 不能为空（要清空输入框请改用逐字输入或删除键）" };
    return await runBridge(["-Action", "value", ...targetArgs(args), "-Index", String(index), "-Text", text]);
  }
  return { ok: false, error: `未知工具：${name}` };
}

/* ── MCP stdio 门面（行分隔 JSON-RPC，与 harness-dispatch 的 HTTP 门面同一套响应形状）── */
const send = (payload) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...payload })}\n`);
const reply = (id, result) => send({ id: id ?? null, result });
const replyError = (id, message) => send({ id: id ?? null, error: { code: -32000, message: String(message).slice(0, 300) } });

readline.createInterface({ input: process.stdin }).on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg = null;
  try { msg = JSON.parse(trimmed); } catch { replyError(null, "parse error"); return; }
  if (msg?.id === undefined || msg?.id === null) return;           // notification：不回
  try {
    if (msg.method === "initialize") {
      reply(msg.id, { protocolVersion: msg.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "harness-uia", version: "1.0.0" } });
      return;
    }
    if (msg.method === "ping") { reply(msg.id, {}); return; }
    if (msg.method === "tools/list") { reply(msg.id, { tools: IS_WINDOWS ? TOOLS : [] }); return; }
    if (msg.method === "tools/call") {
      const out = await callTool(msg.params?.name, msg.params?.arguments ?? {});
      const ok = out?.ok !== false;
      reply(msg.id, { content: [{ type: "text", text: ok ? JSON.stringify(out) : `调用被拒绝：${out?.error ?? out?.code ?? "未知原因"}` }], isError: !ok });
      return;
    }
    replyError(msg.id, `method not found: ${String(msg.method)}`);
  } catch (error) {
    replyError(msg.id, error?.message ?? error);
  }
});
