// 能力网关守卫（10-05）：内置 MCP 的工具面在引擎 0.157 后对模型**整批不可见**
//   （`tool_search_always_defer_mcp_tools` 已是 removed/true，永久默认；直接调用一律 unsupported call），
//   宿主用一个 dynamicTool `harness_tools` 把它们接回来。
//
// 判据形状（每条都打到「接线」而不是「常量存在」）：
//   ① 执行端**复用** dispatchRpcCall（不许另写第二份实现）+ 它接受显式 callerThreadId；
//   ② 工具面 = MCP − 三个已有专用工具的（负向：不许把 agent_invoke 之类加回网关）；
//   ③ 渲染层注册 + 分发；callerThreadId 必须取**引擎事件的 threadId**（负向：不许用 args 里模型自报的）；
//   ④ 通道三处登记齐（handler / manifest / preload / ipc-registry 计数）。
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log("  " + (c ? "✓" : "✗") + " 【gw】" + m); if (!c) fails++; };

const rpc = readFileSync(join(ROOT, "electron", "features", "dispatch-rpc.ts"), "utf8");
const agents = readFileSync(join(ROOT, "electron", "features", "agents-ipc.ts"), "utf8");
const preload = readFileSync(join(ROOT, "electron", "preload.ts"), "utf8");
const dts = readFileSync(join(ROOT, "src", "vite-env.d.ts"), "utf8");
const seg08 = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part08", "01-seg.tsx"), "utf8");
const req = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part05", "event-router", "02-request.tsx"), "utf8");
const manifest = readFileSync(join(ROOT, "electron", "ipc-channels.manifest.json"), "utf8");
const registry = readFileSync(join(ROOT, "electron", "ipc-registry.ts"), "utf8");

/* ── ① 执行端：复用，不另起炉灶 ─────────────────────────────────────────── */
ok(/export async function dispatchRpcCall\(name: unknown, args: Record<string, unknown>, explicitCallerThreadId\?: string\)/.test(rpc),
  "dispatchRpcCall 接受显式 callerThreadId（网关路径不用等 MCP 旁证，最多省 10 秒）");
ok(/export function dispatchGatewayTools\(\)/.test(rpc) && /export function dispatchGatewayCatalogText\(\)/.test(rpc),
  "导出工具面 + 清单文案（name=\"list\" 的返回）");
ok(/return dispatchRpcCall\(tool, args as Record<string, unknown>, caller\)/.test(agents),
  "⛔ agents:dispatch-call 把调用**原样转给 dispatchRpcCall**（同一套实现与闸，不是第二份逻辑）");

/* ── ② 工具面：MCP − 已有专用工具的那三个 ──────────────────────────────── */
{
  const excluded = /const GATEWAY_EXCLUDED = new Set\(\[([^\]]*)\]\)/.exec(rpc);
  const list = excluded ? excluded[1] : "";
  ok(["agent_invoke", "agent_archive_sessions", "image_generate"].every((n) => list.includes(`"${n}"`)),
    "⛔ 网关排除 3 个已有专用工具的能力（同一个能力挂两个名字 ⇒ 模型只用最直白的那个、另一套被绕过）");
  ok(/\.filter\(\(tool\) => !GATEWAY_EXCLUDED\.has/.test(rpc),
    "排除清单真的作用在工具面上（不是只声明了一个没人用的常量）");
}

/* ── ③ 渲染层：注册 + 分发 + 身份来源 ──────────────────────────────────── */
ok(/name: "harness_tools"/.test(seg08) && /required: \["name"\]/.test(seg08),
  "注册 dynamicTool harness_tools（带 inputSchema，必填 name）");
ok(/event\.params\?\.tool === "harness_tools"/.test(req) && /window\.codex\.callDispatchTool\(/.test(req),
  "渲染层 harness_tools 分发接 callDispatchTool");
ok(/const gatewayCaller = String\(event\.params\?\.threadId/.test(req),
  "⛔ callerThreadId 取**引擎事件的 threadId**（模型伪造不了）");
// ⛔ 负向：身份绝不能来自 args（那是模型自己填的）——这批能力里有写操作（保存专家/定时任务/连接器）
ok(!/callerThreadId:\s*(?:String\()?gatewayArgs/.test(req) && !/callerThreadId:\s*(?:String\()?args\.callerThreadId/.test(req),
  "⛔ 身份不许取模型自报的 args.callerThreadId（等于让模型自证）");
ok(/if \(!caller\) return \{ ok: false, output: "", error: "缺少 callerThreadId/.test(agents),
  "⛔ 主进程侧缺 callerThreadId 时**拒绝**（fail-closed，不是默默放行）");
ok(/if \(tool === "list"\) return \{ ok: true, output: dispatchGatewayCatalogText\(\) \}/.test(agents),
  "name=\"list\" 返回能力清单（参数说明按需取，不占常驻提示词）");

/* ── ④ 通道四处登记齐 ─────────────────────────────────────────────────── */
ok(/ipcHost\.handle\("agents:dispatch-call"/.test(agents), "handler 已注册（agents:dispatch-call）");
ok(/"channel": "agents:dispatch-call"/.test(manifest), "manifest 已登记");
ok(/callDispatchTool: \(input: unknown\) => __ipc\("agents:dispatch-call", 1, \[input\]\)/.test(preload), "preload 已生成");
ok(/callDispatchTool\(input: \{ name: string; args\?: Record<string, unknown>; callerThreadId: string \}\)/.test(dts), "vite-env.d.ts 已生成（渲染层才有类型）");
// ⛔ 账本**自维护**检查：域条目里的 count 必须等于它自己 channels 数组的长度。
//   ⛔ 别写死数字（写死 ⇒ 以后任何人加一条 agents 通道都会假红，而红的原因与本守卫无关）。
//   真正要防的是"加了通道忘了登记"：那一刻 channels 少一条、count 没动 ⇒ 这里红。
{
  const entry = /\{\s*prefix: "agents", count: (\d+)[\s\S]*?channels: \[([^\]]*)\]/.exec(registry);
  const declared = entry ? Number(entry[1]) : -1;
  const listed = entry ? (entry[2].match(/"[^"]+"/g) || []).length : -1;
  ok(declared > 0 && declared === listed && /"agents:dispatch-call"/.test(registry),
    `ipc-registry 的 agents 域账本自洽（count=${declared} / 列出 ${listed} 条，含 dispatch-call）`);
}

/* ── ⑤ 工具名两端一致（防"新增能力静默不可见"）──────────────────────────
   渲染层 `harness_tools` 的描述里**手写**了能力清单（省 token），主进程的工具面是
   `dispatchMcpTools()`。两处不同源 ⇒ 以后主进程加了新工具，网关能调、但模型看不到名字，
   只能靠 `name="list"` 才发现 ⇒ 能力"装了却没人用"。这条断言把漂移挡在预检里。 */
{
  const core = readFileSync(join(ROOT, "electron", "features", "dispatch-core.ts"), "utf8");
  const start = core.indexOf("function dispatchMcpTools(");
  const end = core.indexOf("\n}", start);
  const body = start >= 0 ? core.slice(start, end > start ? end : undefined) : "";
  const names = [...new Set([...body.matchAll(/name: "([a-z_]+)"/g)].map((m) => m[1]))]
    .filter((n) => !["agent_invoke", "agent_archive_sessions", "image_generate"].includes(n));
  // 渲染层：harness_tools 那个对象的描述段（两端锚点唯一 ⇒ 与中间写多少行无关）
  const descStart = seg08.indexOf('name: "harness_tools"');
  const descEnd = seg08.indexOf('required: ["name"]', descStart);
  const descBlock = descStart >= 0 ? seg08.slice(descStart, descEnd > descStart ? descEnd : undefined) : "";
  const missing = names.filter((n) => !descBlock.includes(n));
  ok(names.length > 0 && missing.length === 0,
    `⛔ 渲染层描述列全了主进程的能力清单（${names.length} 个${missing.length ? `；漏：${missing.join(", ")}` : ""}）`
    + " —— 漏了模型就看不到那个名字，等于装了却没人用");
}

console.log("\n【gw】" + (checks - fails) + "/" + checks + " 通过" + (fails ? " —— " + fails + " 条红" : ""));
process.exit(fails ? 1 : 0);
