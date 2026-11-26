// 能力网关守卫（10-05 立 / 10-09 收窄）：内置 MCP 的工具面在引擎 0.157 后对模型**整批不可见**
//   （`tool_search_always_defer_mcp_tools` 已是 removed/true，永久默认；直接调用一律 unsupported call），
//   宿主用一个 dynamicTool `harness_tools` 把它们接回来。
//   ⛔ 10-09 收窄：**图像四件套**（image_generate / image_edit / image_info / image_view）已搬去
//      image-lab 域自己的 IPC —— 既不进网关、也不在 MCP 工具面里。本守卫只盯**其余**能力；
//      那四个由 12b-image-lab.mjs 盯（用户要求「生成和编辑的 IPC 彻底分开」）。
//
// 判据形状（每条都打到「接线」而不是「常量存在」）：
//   ① 执行端**复用** dispatchRpcCall（不许另写第二份实现）+ 它接受显式 callerThreadId；
//   ② 工具面 = MCP − 渲染层自带专用工具的（负向：不许把 agent_invoke 之类加回网关）；
//   ③ 渲染层注册 + 分发；callerThreadId 必须取**引擎事件的 threadId**（负向：不许用 args 里模型自报的）；
//   ④ 通道三处登记齐（handler / manifest / preload / ipc-registry 计数）。
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readAppUi } from "./_ctx.mjs";   // 渲染层聚合读取（⛔ 必须递归，见 _ctx 注释）

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
/* ⛔⛔ 11-25：这份清单**同时是执行端拒绝清单**。dispatchRpcCall 里 agent_invoke 是完整实现，
   网关入口若不校验名字，「工具面里没有它」的会话仍能用 harness_tools({name:"agent_invoke"})
   派活 —— 一条目录里不列、实际能调的隐性双通道（subagent_invoke 老坑的变体）。
   判据落在**执行分支**上（不是"常量还在"）：没有 if 分支就等于没拦。 */
ok(/if \(RENDERER_DEDICATED\.has\(tool\)\)/.test(agents),
  "⛔ agents:dispatch-call 拒绝渲染层专用工具（否则网关就是 agent_invoke 的隐性后门）");
ok(/if \(!String\(args\.displayNameZh \?\? ""\)\.trim\(\)\)/.test(rpc),
  "⛔ expert_save 校验 displayNameZh（不校验 ⇒ normalize 把它默认成「未命名团队」，用户得手动删垃圾条目）");

/* ── ② 工具面：MCP − 渲染层自带专用工具的（10-09：图像四件套已搬去 image-lab 域自己的通道）── */
{
  const excluded = /const RENDERER_DEDICATED = new Set\(\[([^\]]*)\]\)/.exec(rpc);
  const list = excluded ? excluded[1] : "";
  ok(["agent_invoke", "agent_archive_sessions"].every((n) => list.includes(`"${n}"`)),
    "⛔ 网关排除渲染层自带专用工具的能力（同一个能力挂两个名字 ⇒ 模型只用最直白的那个、另一套被绕过）");
  ok(/\.filter\(\(tool\) => !RENDERER_DEDICATED\.has/.test(rpc),
    "排除清单真的作用在工具面上（不是只声明了一个没人用的常量）");
  // ⛔ 10-09 用户：「把生成和编辑的 IPC 也彻底分开，不要混在一起」⇒ 图像四件套必须**不在**工具面里
  const core = readFileSync(join(ROOT, "electron", "features", "dispatch-core.ts"), "utf8");
  ok(
    !/name: "image_generate"/.test(core) && !/name: "image_edit"/.test(core)
      && !/name: "image_info"/.test(core) && !/name: "image_view"/.test(core),
    "⛔ 图像四件套已从 MCP 工具面移除（改由 image-lab 域自己的 IPC 承担，不再与网关混在一起）",
  );
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
    .filter((n) => !["agent_invoke", "agent_archive_sessions"].includes(n));   // 渲染层自带专用工具的（图像四件套已不在工具面里，无需过滤）
  // 渲染层：harness_tools 那个对象的描述段（两端锚点唯一 ⇒ 与中间写多少行无关）
  const descStart = seg08.indexOf('name: "harness_tools"');
  const descEnd = seg08.indexOf('required: ["name"]', descStart);
  const descBlock = descStart >= 0 ? seg08.slice(descStart, descEnd > descStart ? descEnd : undefined) : "";
  const missing = names.filter((n) => !descBlock.includes(n));
  ok(names.length > 0 && missing.length === 0,
    `⛔ 渲染层描述列全了主进程的能力清单（${names.length} 个${missing.length ? `；漏：${missing.join(", ")}` : ""}）`
    + " —— 漏了模型就看不到那个名字，等于装了却没人用");
}

/* ── ⑥ 恢复会话必须携带工具面（10-05 用户报「能力全挂了」的第二真凶）────────────
   ⛔ 10-11 更正机制（此前这里写「最后那次 resume 决定工具面」——探针实测**不成立**）：
   引擎的工具面**只在 spawn 时定死**，来源 = rollout 首行 session_meta.dynamic_tools；
   thread/resume 与 thread/fork 里的 dynamicTools 被**整份忽略**（协议 schema 的
   ThreadResumeParams 无该字段；独立探针实测上游请求体 tools 一个不多）。
   ⇒ 渲染层仍然每次都带工具面，但作用变成"告诉主进程当前工具面是什么"，由主进程
     改写老会话 rollout 首行（electron/rollout-worker.cjs 的 syncToolSurface）。
     缺了它 ⇒ 创建于旧版本的会话永远停在旧工具面（模型 schema 里没有新参数）。
   ⇒ 判据：① 直发 thread/resume 只剩 2 处且都在允许清单；② 唯一入口强制附加 dynamicTools；
     ③ 所有入口调用都必须传 bag。 */
{
  const appUi = readAppUi();
  const listSrc = readFileSync(join(ROOT, "src", "features", "app-view", "helpers", "thread-list.ts"), "utf8");
  const raws = appUi.match(/window\.codex\.request\("thread\/resume"/g) ?? [];
  ok(raws.length === 2,
    `⛔ 渲染层只允许 2 处直发 thread/resume（实际 ${raws.length} 处）—— 新增恢复路径必须走 resumeThreadWithTurns`);
  /* ⛔ 判据查的是**接线**不是"这个词还在"：变异把 `await bag.buildDynamicTools()` 换成
     `const dynamicTools: any[] = []` 时，"函数体里出现 dynamicTools" 仍然为真 ⇒ 那样写就是**假绿**
     （本轮实测踩到：先写成查词，变异测试当场没红）。所以分别钉住"来源"与"真的拼进请求"。 */
  ok(/const dynamicTools = await bag\.buildDynamicTools\(\)/.test(listSrc)
    && /\.\.\.\(dynamicTools\.length \? \{ dynamicTools \} : \{\}\)/.test(listSrc),
    "⛔ 唯一入口 resumeThreadWithTurns 取当前工具面并真的拼进 resume 请求（漏了 ⇒ 老会话工具面被打回创建时快照）");
  /* ⛔⛔ 11-25：工具面**不含会话身份**（渲染层不再按类型增删）⇒ 这里不许再传角色。
     身份由主进程写首行时按目标会话裁（electron/tool-surface.ts），见下面 ③ 的真跑。 */
  ok(!/buildDynamicTools\(role\)/.test(listSrc),
    "⛔ 渲染层不再把「会话角色」塞进工具面（否则切会话/新建会话必串身份）");
  // 只数**调用点**：声明本身（`function resumeThreadWithTurns(`）也要扣掉，否则永远差 1
  const defs = (appUi.match(/function resumeThreadWithTurns\(/g) ?? []).length;
  const calls = (appUi.match(/resumeThreadWithTurns\(/g) ?? []).length - defs;
  const withBag = appUi.match(/resumeThreadWithTurns\(bag,/g) ?? [];
  ok(calls > 0 && calls === withBag.length,
    `⛔ 所有 resumeThreadWithTurns 调用都传 bag（${withBag.length}/${calls}）—— 少传就等于没带工具面`);

  /* ── ⑦ 分叉会话同样要带工具面（2026-10-10）───────────────────────────────
     ⛔ 10-11 实测：`thread/fork` 自己的 dynamicTools 也被忽略，**继承的是源会话 rollout 的
     工具面**（源被升级后 fork 出来的新会话跟着拿新工具，已实证）。所以 fork 前先走 openThread
     （它会把源会话的 rollout 同步成当前工具面）才是正解 —— 原来 4 处直发 fork 里 2 处只
     setThread、不 resume ⇒ 分叉出来的会话继承的是源会话**创建时**的工具面快照，
     知识库 / 定时任务 / 视频 … 全部 `unsupported call`（用户报「知识库调不到」的真凶之一）。
     ⇒ 现在 fork 后一律走 openThread（内部带当前工具面 resume）。
     判据：每处 fork 的近邻必须出现 `openThread` —— fork 之后要做的动作本来就在紧邻几行，
     正常写法不会离得远；这条能抓住"新加一处裸 fork"。 */
  const forks = [...appUi.matchAll(/request\("thread\/fork"/g)];
  const naked = forks.filter((m) => {
    const from = m.index ?? 0;
    return !/openThread\(/.test(appUi.slice(from, from + 1200));
  });
  ok(forks.length > 0 && naked.length === 0,
    `⛔ 每处 thread/fork 之后都要 openThread（带工具面 resume）—— 裸 fork ${naked.length}/${forks.length} 处`
    + "（只 setThread 不 resume ⇒ 新分支继承源会话的旧工具面）");
}

/* ── ③ 工具面的**身份裁剪**（11-25 架构位）：真跑 + 表驱动 + 接线 ────────────
   ⛔ 为什么必须真跑：这张表是"谁该有哪些身份工具"的唯一实现，写错了（比如把 group_* 记成
      dispatch）上面所有文本断言都照样绿。真跑 = 子进程 import 那个 TS，逐类比对期望集合。 */
{
  const codexIpc = readFileSync(join(ROOT, "electron", "features", "codex-ipc.ts"), "utf8");
  const toolSurfaceSrc = readFileSync(join(ROOT, "electron", "tool-surface.ts"), "utf8");
  const delegationSrc = readFileSync(join(ROOT, "electron", "features", "delegation.ts"), "utf8");

  /* 接线：**五个写面**都必须过表（少一处 = 那条路仍按旧身份走）。
     ⛔ 这五处覆盖用户点名的五类会话：normal/hub（codex-ipc start+resume）、expert（delegation）、
        expertTeam（teams-ipc 主理人 + 成员）、workPartner（group-talk）。 */
  ok(/const split = splitIdentity\(\(params as any\)\.dynamicTools as unknown\[\]\)/.test(codexIpc)
    && /applyToolIdentity\(split\.identity, "normal"\)/.test(codexIpc)
    && !/filterToolSurface\(\(params as any\)\.dynamicTools/.test(codexIpc),
    "thread/start：身份类按 normal 裁、其余按 CORE 收窄（⛔ 顺序反了会把身份工具一起裁掉）");
  ok(/const split = splitIdentity\(\[\.\.\.byName\.values\(\)\]\)/.test(codexIpc)
    && /applyToolIdentity\(split\.identity, hostKind \|\| "normal"\)/.test(codexIpc)
    && !/filterToolSurface\(surface as any\[\]/.test(codexIpc),
    "thread/resume：按**目标会话**类型裁身份类、只收窄其余（切会话的唯一重写点）");
  ok(/applyToolIdentity\(desiredTools as unknown\[\], "expert"\)/.test(delegationSrc)
    && /dynamicTools: identityTools,/.test(delegationSrc),
    "派生会话（专家/团/伙伴/被调度）用同一张表 + 真的用上了裁剪后的数组");
  const teamsSrc = readFileSync(join(ROOT, "electron", "features", "teams-ipc.ts"), "utf8");
  const groupSrc = readFileSync(join(ROOT, "electron", "features", "group-talk", "01-channel.ts"), "utf8");
  ok((teamsSrc.match(/applyToolIdentity\(/g) ?? []).length >= 2
    && /applyToolIdentity\(\[teamTool, teamPhaseTool, buildTeamPlanTool\(\), buildTeamStatusTool\(\), buildDelegateHarnessTool\(\)\], "expertTeam"\)/.test(teamsSrc)
    && /applyToolIdentity\(\[buildRoleMemoryTool\(/.test(teamsSrc),
    "专家团主理人 / 成员两个写面都过表（团队会话不许有派活与群编排工具）");
  ok(/applyToolIdentity\(surface \?\? buildGroupTalkTools\(\), "workPartner"\)/.test(groupSrc),
    "工作伙伴（群聊）会话写面也过表（dispatch / 群编排全关）");
  /* ⛔⛔ 11-26：派生会话的工具面是**手写最小集**，⛔ 不许再套 CORE 画像收窄（filterToolSurface）——
     那张表里没有 team_* 与 role_memory_*，一收窄就整批消失（用户实测：竹影专家团里
     team_member_invoke 返回「未知工具」、team_plan 也不存在）。收窄只服务宿主那 48 个工具。 */
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  ok(!/filterToolSurface/.test(stripComments(teamsSrc)) && !/filterToolSurface/.test(stripComments(delegationSrc)),
    "⛔ 派生会话不吃 CORE 画像收窄（否则团队调度工具 / 角色记忆会被裁掉，模型报「未知工具」）");

  /* 期望表：正常/中枢 = 派活三件套 + 群编排九件套；派生四类 = 空。
     ⛔ 这里逐名字写死，就是为了让"表里写错一个能力位"当场红。 */
  const EXPECT = {
    normal: ["agent_archive_sessions", "agent_invoke", "agent_list_children",
      "group_add_member", "group_assign", "group_browser_setup", "group_create", "group_delete",
      "group_escalate", "group_remove_member", "group_review", "group_status"],
    hub: null, // 与 normal 相同（下面断言）
    expertTeam: [], expert: [], workPartner: [], delegate: [],
  };
  const BODY = `
import { applyToolIdentity, identityToolsOf, splitIdentity, IDENTITY_TOOLS } from "./electron/tool-surface.ts";
const names = Object.keys(IDENTITY_TOOLS);
const mk = () => names.map((n) => ({ type: "function", name: n }));
const of = (k) => identityToolsOf(k).slice().sort();
const src = mk();
const after = applyToolIdentity(src, "delegate");
const R = {
  normal: of("normal"),
  hub: of("hub"),
  expertTeam: of("expertTeam"),
  expert: of("expert"),
  workPartner: of("workPartner"),
  delegate: of("delegate"),
  idempotent: JSON.stringify(applyToolIdentity(applyToolIdentity(mk(), "expert"), "expert")) === "[]",
  noMutation: src.length === names.length && after.length === 0,
  orderStable: JSON.stringify(applyToolIdentity(mk(), "normal").map((t) => t.name)) === JSON.stringify(names),
  unknownAsNormal: applyToolIdentity(mk(), "no_such_kind").length === names.length,
  splitPartition: (() => { const sp = splitIdentity([...mk(), { type: "function", name: "harness_tools" }]); return sp.identity.length === names.length && sp.rest.length === 1 && sp.rest[0].name === "harness_tools"; })(),
  total: names.length,
};
console.log("DATA " + JSON.stringify(R));
`;
  let raw = "";
  let data = null;
  try {
    raw = execFileSync(process.execPath, [
      "--experimental-strip-types",
      "--import", pathToFileURL(join(ROOT, "scripts", "guards", "_ts-register.mjs")).href,
      "--input-type=module", "-e", BODY,
    ], { cwd: ROOT, encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    raw = `${error?.stdout ?? ""}${error?.stderr ?? ""}`;
  }
  raw = raw.replace(/^.*MODULE_TYPELESS.*$|^.*Reparsing.*$|^.*To eliminate.*$|^.*trace-warnings.*$/gm, "");
  const line = raw.split("\n").find((l) => l.trim().startsWith("DATA "));
  if (line) { try { data = JSON.parse(line.trim().slice(5)); } catch { data = null; } }
  ok(Boolean(data), "身份表真跑出结果（⛔ 没解析到 = 脚本没跑起来，别当成通过）");
  ok(JSON.stringify(data?.normal) === JSON.stringify(EXPECT.normal),
    `正常会话的身份工具正好是派活三件套 + 群编排九件套（实际 ${data?.total ?? "?"} 个：${(data?.normal ?? []).join(",")}）`);
  ok(JSON.stringify(data?.hub) === JSON.stringify(EXPECT.normal),
    "中枢会话与正常会话身份面相同（capabilitiesOf：两者 dispatch / bossGroup 都开）");
  ok(["expertTeam", "expert", "workPartner", "delegate"].every((k) => Array.isArray(data?.[k]) && data[k].length === 0),
    "专家 / 专家团 / 工作伙伴 / 被调度会话：身份工具**一个都不给**（派活与群编排全关）");
  ok(data?.idempotent === true && data?.noMutation === true && data?.orderStable === true,
    "身份裁剪是纯函数：幂等、不改入参、结果与输入顺序无关（并发/反复切换下不会互相污染）");
  ok(data?.splitPartition === true,
    "splitIdentity 是**划分**：身份类与非身份类互不重叠、不漏（先收窄再裁的前提）");
  ok(data?.unknownAsNormal === true,
    "未知类型按 normal 处理（与 session-kind 同口径 —— 判不出来时不误禁）");
  /* ⛔⛔ 11-25：表里的群工具名与渲染层常量是**两份字面量**（表在 electron、常量在 src）。
     只真跑表自身证明不了它们一致：渲染层改名（历史真发生过 group_browser → group_browser_setup）
     而表没跟 ⇒ 该裁的不裁、且没有任何报错。这里按名字集合逐条比对。 */
  {
    const tbl = [...toolSurfaceSrc.matchAll(/^\s+(group_[a-z_]+): "bossGroup"/gm)].map((m) => m[1]).sort();
    const constSrc = readFileSync(join(ROOT, "src", "features", "app-view", "constants", "05-boss-group-tools.tsx"), "utf8");
    const cons = [...constSrc.matchAll(/name: "(group_[a-z_]+)"/g)].map((m) => m[1]).sort();
    ok(tbl.length > 0 && JSON.stringify(tbl) === JSON.stringify(cons),
      "身份表的群编排名单与 BOSS_GROUP_TOOLS 逐条一致（表 " + tbl.length + " / 常量 " + cons.length + "）");
  }
  ok(/IDENTITY_TOOLS: Readonly<Record<string, IdentityCap>>/.test(toolSurfaceSrc)
    && !/SESSION_CAPS\s*=/.test(toolSurfaceSrc),
    "身份表不复制能力矩阵（只维护「工具名 → 能力位」，矩阵仍只有 src/lib/session-kind.mjs 一份）");
}

console.log("\n【gw】" + (checks - fails) + "/" + checks + " 通过" + (fails ? " —— " + fails + " 条红" : ""));
process.exit(fails ? 1 : 0);
process.exit(fails ? 1 : 0);
