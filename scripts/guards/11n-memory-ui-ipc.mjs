/**
 * 守卫【muiipc】记忆工作台的**跨进程字段对齐**（10-05 用户报「记忆板块有报错」）。
 *
 * ══ 为什么单独一个守卫，而不在 11m 里加几条 ══════════════════════════════
 * 10-05 上午那次，`11m-memory-ui` **56/56 全绿、变异测试 12/12 全绿**，应用却白屏：
 *   `TypeError: Cannot read properties of undefined (reading 'files')`
 * 根因是 `types.ts` 的 `PyramidMemory.archive` —— 契约里写着，主进程**根本没这个字段**
 * （它在 `memory:hygiene:plan` 的返回体里，不在 `memory:layers:read` 里）。
 * 同型还有两处：MCP 后端四个字段名全错、被调度返回体是 `{records:[...]}` 包一层。
 *
 * ⛔⛔ **那 56 条为什么全绿？** 因为它们断言的是「视图 ↔ types.ts」自洽 ——
 *   两边都是同一个人按同一份想象写的。**没有任何一条断言跨进程边界。**
 *   ⇒ 这是假绿的教科书案例，也是本守卫存在的全部理由。
 *
 * ══ 本守卫的判据强度设计（每条都针对一个具体的假绿手法）════════════════
 * ① **fixture 从 electron 源码真提取**，⛔ 不手写：手写就等于又造一份"想象"，
 *    主进程改字段名时 fixture 不变 ⇒ 守卫恒绿。做法是把 `MemoryLayersSnapshot` /
 *    `MemoryBackendStatus` / `DelegateRecord` 三个类型定义的**字段名抠出来**，
 *    合成一个"字段名与主进程完全一致、值全是噪声"的返回体。
 * ② **真跑 normalize.ts**（node --experimental-strip-types 直接 import），
 *    ⛔ 不是 grep 源码 —— grep 只能证明"代码写了"，证明不了"跑起来不炸"。
 * ③ **变异自检**：把 fixture 的字段名改掉（模拟主进程改名），
 *    断言守卫会红 —— ⛔ 判据本身必须可被违反，否则恒真。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./_ctx.mjs";

let checks = 0, fails = 0;
const ok = (c, m) => { checks++; if (c) console.log("  ✓ " + m); else { fails++; console.log("  ✗ " + m); } };

const read = (...p) => readFileSync(join(ROOT, ...p), "utf8");
const NORM_SRC = read("src", "features", "memory-ui", "normalize.ts");
const VIEWS = read("src", "features", "memory-ui", "views.tsx");
const SHELL = read("src", "features", "memory-ui", "MemoryWorkbench.tsx");
const TYPES = read("src", "features", "memory-ui", "types.ts");

/* ══ 工具：从 TS 类型定义里抠出字段名 ═══════════════════════════════════
 * ⛔ 为什么必须抠而不是手写：手写 fixture = 又一份"想象"，主进程改字段它不变 ⇒ 恒绿。
 * ⛔ 抠的方式有坑：`MemoryLayersSnapshot` 里有嵌套对象（paths/budget），
 *   只取顶层 `{...}` 里的 `name:` / `name?:`，⛔ 不能整段正则（会连嵌套的也吃进来）。
 */
function fieldsOf(src, typeName) {
  const at = src.indexOf("export type " + typeName);
  if (at < 0) return null;
  const open = src.indexOf("{", at);
  if (open < 0) return null;
  let depth = 0, end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  const body = src.slice(open + 1, end);
  /* 只取深度 0 的字段：逐字符扫，跟踪 <> {} [] () 的嵌套深度，深度 0 处的 `name:` 才是顶层字段。
     ⛔ 嵌套里的 `logs: { date: string; … }` 会把 date/date 误当顶层字段 ⇒ 必须跟深度。 */
  const out = [];
  let d = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "{" || ch === "<" || ch === "[" || ch === "(") { d++; continue; }
    if (ch === "}" || ch === ">" || ch === "]" || ch === ")") { d--; continue; }
    if (d !== 0) continue;
    if (ch === "/" && body[i + 1] === "/") { const nl = body.indexOf("\n", i); i = nl < 0 ? body.length : nl; continue; }
    if (ch === "/" && body[i + 1] === "*") { const ce = body.indexOf("*/", i); i = ce < 0 ? body.length : ce + 1; continue; }
    const m = /^[ \t]*([A-Za-z_$][\w$]*)[?]?[ \t]*:/.exec(body.slice(i));
    if (m) { out.push(m[1]); i += m[0].length - 1; }
  }
  return [...new Set(out)];
}

const LAYERS_SRC = read("electron", "memory-layers.ts");
const BACKEND_SRC = read("electron", "memory-backend.ts");
const DELEGATE_SRC = read("electron", "delegate-registry.ts");

const layerFields = fieldsOf(LAYERS_SRC, "MemoryLayersSnapshot");
const backendFields = fieldsOf(BACKEND_SRC, "MemoryBackendStatus");
const delegateFields = fieldsOf(DELEGATE_SRC, "DelegateRecord");

/* ── ① fixture 的字段名必须真的抠出来了（⛔ 抠失败 = 守卫静默空跑）───────── */
console.log("\n【muiipc】① 主进程返回体的字段名（从 electron 源码真提取）");
ok(Array.isArray(layerFields) && layerFields.length >= 8,
  `MemoryLayersSnapshot 抠出 ${layerFields?.length ?? 0} 个字段（抠失败 = 守卫空跑，必须报红）`);
ok(Array.isArray(backendFields) && backendFields.length >= 5,
  `MemoryBackendStatus 抠出 ${backendFields?.length ?? 0} 个字段`);
ok(Array.isArray(delegateFields) && delegateFields.length >= 8,
  `DelegateRecord 抠出 ${delegateFields?.length ?? 0} 个字段`);

/* ══ ② 抠出来的字段名 ⛔ 必须与 normalize 读的一致 ═══════════════════════
 * 这一节就是 10-05 白屏的**直接判据**：`archive` 不在 MemoryLayersSnapshot 里，
 * 而上午那版视图读的就是 `data.archive.files`。
 */
console.log("\n【muiipc】② 契约字段 ⛔ 不得凭空发明");
ok(!layerFields?.includes("archive"),
  "⛔⛔ `archive` **不在** MemoryLayersSnapshot 里（10-05 白屏的直接原因：视图读它，主进程没返回）");
ok(/normalizePyramid\(pyramid, hygiene\?\.archive\)/.test(SHELL),
  "⛔⛔ archive 只能从 `memory:hygiene:plan` 拿（⛔ 那是唯一带 archive 的通道）");
ok(/bridge\.planMemoryHygiene\(workspace\)/.test(SHELL),
  "⛔ 归档统计真的调了 hygiene:plan（⛔ 只写变量名不调 = 恒绿）");
/* ⛔ MCP 后端：契约里的 active/ready 必须来自主进程真有的 effective/installed */
ok(backendFields?.includes("effective") && backendFields?.includes("installed"),
  "⛔ MCP 后端真字段是 effective/installed（⛔ 上午那版读 active/ready，两个都不存在）");
ok(/str\(r\.effective, "builtin"\)/.test(NORM_SRC) && /bool\(r\.installed, false\)/.test(NORM_SRC),
  "⛔⛔ 归一化读的是真字段名 effective/installed");
ok(!/str\(r\.active/.test(NORM_SRC) && !/bool\(r\.ready/.test(NORM_SRC),
  "⛔ 归一化⛔ 没有读主进程不存在的 active/ready（这正是 10-05 的错法）");
/* ⛔ 被调度：返回体是 {records:[...]} 包一层
   ⛔⛔ 判据踩过的坑：⛔ 不能用 `[\s\S]{0,200}?` 找 `records:` ——
     `agents:delegated-of` 那个 handler 里**也有** records，窗口跨行就匹配到了它
     ⇒ 变异"把 delegated 的包装删掉"照样全绿（实测）。窗口必须**锁死在同一行**：
     先按行切开，只在 `agents:delegated"`（带尾引号，排除 `-of`）那一行里找。 */
const AGENTS_SRC = read("electron", "features", "agents-ipc.ts");
const delegatedLine = (AGENTS_SRC.split("\n").find((l) => /handle\("agents:delegated"/.test(l)) || "");
ok(delegatedLine.includes("records:"),
  "⛔⛔ `agents:delegated` 返回 `{records:[...]}`（⛔ 当数组用会在 .filter 处必崩）");
ok(AGENTS_SRC.split("\n").some((l) => /handle\("agents:delegated-of"/.test(l)),
  "⛔ 判据锁在 delegated 那一行（⛔ 存在同名近似的 delegated-of，跨行窗口会误匹配它 ⇒ 恒绿）");
ok(/Array\.isArray\(raw\) \? raw : arr\(obj\(raw\)\.records\)/.test(NORM_SRC),
  "⛔⛔ 归一化真的解了 `{records}` 这层包装（两种形态都吃）");
/* ⛔ 后端字段叫 kind，前端契约叫 dispatchKind（⛔ 不改后端字段名：那张表被侧栏/办公室多处消费） */
ok(delegateFields?.includes("kind") && !delegateFields?.includes("dispatchKind"),
  "⛔ 后端字段叫 `kind`（⛔ 改后端会波及其它消费方 ⇒ 改名只在前端契约侧做）");
ok(/dispatchKind: str\(r\.kind, "unknown"\)/.test(NORM_SRC),
  "⛔⛔ 归一化把 kind 映射成 dispatchKind（⛔ 不映射 ⇒ KIND_LABEL[d.dispatchKind] 全是 undefined）");

/* ══ ③ 真跑 normalize：喂"字段名与主进程一致 + 值全是噪声"的返回体 ════════
 * ⛔ 这是本守卫与 11m 的分水岭：11m 只读源码，⛔ 这里**执行**代码。
 */
const NORM = await import(pathToFileURL(join(ROOT, "src", "features", "memory-ui", "normalize.ts")).href);

/** 用抠出来的字段名造一个"每字段都有值"的返回体（值刻意用不可预测的噪声） */
function makeRaw(fields, seed = {}) {
  const out = {};
  let i = 0;
  for (const f of fields) {
    if (f in seed) { out[f] = seed[f]; continue; }
    out[f] = `__noise_${f}_${i++}__`;
  }
  return out;
}

console.log("\n【muiipc】③ 真跑 normalize（喂主进程真实字段名）");

/* ③-1 金字塔：⛔ 这就是白屏那条路径 */
const pyramidRaw = { ...makeRaw(layerFields, { layers: [{ id: "L1", name: "项目宪法", where: "w", writer: "x", sink: "y", budget: 100, used: 95, ratio: 0.95, needDistill: true }] }) };
const pyr = NORM.normalizePyramid(pyramidRaw, { files: 3, bytes: 2048 });
ok(pyr.archive.files === 3 && pyr.archive.bytes === 2048,
  "⛔⛔ archive 从第二个参数来（⛔ 这是 10-05 白屏的那一行，现在有值了）");
ok(Array.isArray(pyr.layers) && pyr.layers.length === 1 && pyr.layers[0].ratio === 0.95,
  "⛔ 层数据真读到了（⛔ ratio/needDistill 是水位条的全部依据）");
ok(NORM.normalizePyramid(pyramidRaw, null).archive.files === 0,
  "⛔⛔ archive 缺失时归零（⛔ 不是 undefined —— undefined.files 就是那句报错）");
/* ⛔ 关键：⛔ 主进程**没返回**的字段不许从别处"猜"出来 */
ok(!("archive" in pyramidRaw),
  "⛔ fixture 里确实没有 archive（⛔ 若守卫自己造出了这个字段，上面两条就是恒绿）");

/* ③-2 MCP 后端 */
const mcpRaw = makeRaw(backendFields, { backend: "mcp", effective: "mcp", installed: true, fallbackReason: null });
const mcp = NORM.normalizeMcpBackend(mcpRaw);
ok(mcp.active === "mcp" && mcp.ready === true,
  "⛔⛔ effective→active、installed→ready 映射正确（⛔ 上午那版两个都读不到 ⇒ 永远显示内置）");
ok(mcp.connector && typeof mcp.connector === "string",
  "⛔ connector 有值（⛔ 返回体里没有连接器名 ⇒ 取常量，不是 undefined）");
ok(mcp.sinkLabel.length > 0 && mcp.fallbackReason === null,
  "⛔ sinkLabel 有值、fallbackReason 如实为 null");
const mcpFallback = NORM.normalizeMcpBackend({ backend: "mcp", effective: "builtin", installed: false, fallbackReason: "服务未安装" });
ok(mcpFallback.active === "builtin" && mcpFallback.fallbackReason === "服务未安装",
  "⛔⛔ 选了 MCP 却回退内置时：active=builtin 且**回退原因透出**（不说 = 用户以为生效了）");
ok(/fallbackReason/.test(VIEWS),
  "⛔⛔ 视图真的把回退原因显示出来（⛔ 归一化了但不渲染 = 白改）");

/* ③-3 被调度：⛔ `{records}` 包一层 */
const delegateRaw = { records: [makeRaw(delegateFields, { threadId: "t1", originThreadId: "o1", kind: "expert", name: "张老师", depth: 1, status: "done", startedAt: 100, endedAt: 200 })] };
const del = NORM.normalizeDelegates(delegateRaw, (id) => (id === "t1" ? 5 : 0));
ok(Array.isArray(del) && del.length === 1,
  "⛔⛔ `{records:[...]}` 被解成数组（⛔ 上午那版直接当数组用 ⇒ items.filter 必崩）");
ok(del[0].dispatchKind === "expert" && del[0].status === "done",
  "⛔ kind→dispatchKind 映射正确、状态归一");
ok(del[0].memoryCount === 5,
  "⛔⛔ memoryCount 由回调按 threadId 查（⛔ 登记表里没这个字段 ⇒ 不查就永远显示 0 条）");
ok(NORM.normalizeDelegates(delegateRaw.records).length === 1,
  "⛔ 裸数组形态也吃（⛔ 只认一种形态 = 换个调用方就崩）");
ok(NORM.normalizeDelegates(null).length === 0 && NORM.normalizeDelegates(undefined).length === 0,
  "⛔⛔ null/undefined 降级成空数组（⛔ 通道抛错时 safe() 给的兜底就是这个）");

/* ③-4 条目：⛔ sourceAgent 是嵌套对象，缺它就是第二处白屏 */
const FABRIC_SRC = read("electron", "memory-fabric.ts");
const entryFields = fieldsOf(FABRIC_SRC, "MemoryEntry");
ok(Array.isArray(entryFields) && entryFields.includes("sourceAgent"),
  `MemoryEntry 抠出 ${entryFields?.length ?? 0} 个字段（含嵌套的 sourceAgent）`);
const e1 = NORM.normalizeEntry(makeRaw(entryFields, { sourceAgent: { kind: "expert", id: "e1", label: "张老师" }, weight: 0.8 }));
ok(e1.sourceAgent && e1.sourceAgent.label === "张老师",
  "⛔ sourceAgent 正常读出");
const e2 = NORM.normalizeEntry({ id: "x", content: "c" });
ok(e2.sourceAgent && e2.sourceAgent.kind === "unknown" && e2.scope === "private",
  "⛔⛔ 缺 sourceAgent 时兜底成 {kind:'unknown'}（⛔ undefined.label 是第二处必崩点）");
ok(e2.weight >= 0 && e2.weight <= 1, "⛔ weight 被夹到 0..1（⛔ 噪声值会让进度条炸）");
ok(NORM.normalizeEntry({ weight: 999 }).weight === 1 && NORM.normalizeEntry({ weight: -5 }).weight === 0,
  "⛔⛔ 越界 weight 真被夹住（⛔ 只判 0..1 区间不夹 = 恒绿）");
ok(NORM.normalizeEntry({ lastUsedAt: 0 }).lastUsedAt === null,
  "⛔⛔ lastUsedAt=0 归一成 null（⛔ 0 会被 `!= null` 判成「有值」⇒ 显示 1970 年）");

/* ══ ④ 变异自检：⛔ 判据本身必须可被违反 ══════════════════════════════════
 * ⛔⛔ 这一节是本守卫与"看起来很严"的假绿守卫的分界：把 fixture 的字段名改掉
 *   （模拟主进程改名），断言映射结果**真的变**。若恒绿 = 判据无效。
 */
console.log("\n【muiipc】④ 变异自检（判据可被违反）");
const renamed = { ...mcpRaw, effective: undefined, effectiveBackend: "mcp" };
const mcpRenamed = NORM.normalizeMcpBackend(renamed);
ok(mcpRenamed.active === "builtin",
  "⛔⛔ 主进程把 effective 改名后，归一化**如实降级**而不是继续显示 MCP（变异有效性）");
const noRecords = NORM.normalizeDelegates({ items: [] });
ok(noRecords.length === 0,
  "⛔ 包装键从 records 改名成 items 后不再崩（降级是正确行为，⛔ 不是仍能显示）");
/* ⛔ 反向：⛔ 不能出现"字段改名后 UI 仍然显示旧数据"这种更糟的情况 */
ok(NORM.normalizePyramid({}, undefined).layers.length === 0
  && NORM.normalizePyramid({}, undefined).archive.files === 0,
  "⛔ 空返回体下金字塔仍是合法空值（⛔ 不是抛异常、也不是假数据）");

/* ══ ⑤ 结构性纪律：归一化是唯一碰原始返回体的地方 ═══════════════════════ */
console.log("\n【muiipc】⑤ 分层纪律");
ok(!/window\.codex|ipcRenderer|require\("electron"\)/.test(NORM_SRC),
  "⛔ normalize 零 IPC（⛔ 它是纯函数 ⇒ 守卫能真跑它；碰了 IPC 就只能 grep，判据立刻退化成假绿）");
ok(!/Date\.now\(\)|new Date\(\)/.test(NORM_SRC.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")),
  "⛔⛔ normalize 里没有时间依赖（⛔ 有的话守卫结果随运行时刻变 ⇒ 不可复现）");
ok(/NORM_SRC|normalize/.test(SHELL) && /normalizePyramid/.test(SHELL) && /normalizeMcpBackend/.test(SHELL)
  && /normalizeDelegates/.test(SHELL) && /normalizeEntries/.test(SHELL),
  "⛔⛔ 外壳取数**全部经过归一化**（⛔ 漏一个 = 那个视图还在读原始返回体 = 白屏还在）");
ok(!/as PyramidMemory|as McpBackendMemory|as DispatchedSession\[\]/.test(SHELL),
  "⛔⛔⛔ 外壳里没有 `as` 强转断言（10-05 的病根：强转让编译期闭嘴，运行时才炸）");
/* ⛔ 视图层防御：⛔ 三重兜底是刻意的（缺一层就可能白屏），但也不能退化成什么都不防 */
ok(/data\?\.archive \?\? \{ files: 0, bytes: 0 \}/.test(VIEWS),
  "⛔⛔ 视图对 archive 有兜底（⛔ 归一化是第一道，视图是第二道 —— 少一道就可能白屏）");
ok(/Array\.isArray\(items\) \? items : \[\]/.test(VIEWS),
  "⛔⛔ 时间线视图对 items 有数组兜底（⛔ `.filter` 必崩点）");
ok(/SCOPE_META\[entry\?\.scope\] \?\?/.test(VIEWS),
  "⛔⛔ 作用域查表有兜底（⛔ 后端加新作用域时 SCOPE_META[scope] 是 undefined ⇒ 下一行崩）");
/* ⛔ 归一化必须导出全部六个 —— ⛔ 少一个就有一个视图没被保护 */
for (const fn of ["normalizePyramid", "normalizeMcpBackend", "normalizeEntry", "normalizeEntries",
  "normalizeDelegates", "normalizeMember", "parseNamespace", "statOf"]) {
  ok(new RegExp("export function " + fn + "\\b").test(NORM_SRC), `归一化导出 ${fn}`);
}
ok(/readonly/.test(TYPES) === false && /normalize/.test(TYPES),
  "⛔ types.ts 注明契约由 normalize 产出（⛔ 下一个人才会知道别再手写理想形状）");
/* ⛔⛔ 同一通道不许在一次刷新里被调两次：既是多余的 IPC（委托一多就拖慢刷新），
   又会读到不同时刻的快照（成员 running 标记与时间线可能对不上）。 */
const ipcCalls = (SHELL.match(/bridge\.(readMemoryLayers|readMemoryBackend|listFabricNamespaces|listDelegates|listRoleSessions|listExpertTeams|planMemoryHygiene)\b/g) || []);
const callCounts = {};
for (const c of ipcCalls) callCounts[c] = (callCounts[c] || 0) + 1;
ok(Object.keys(callCounts).length >= 5 && Object.values(callCounts).every((n) => n === 1),
  `⛔⛔ 每个通道在取数层只调一次（实测 ${JSON.stringify(callCounts)}）`);

console.log("\n【muiipc】" + (checks - fails) + "/" + checks + " 通过" + (fails ? " —— " + fails + " 条红" : ""));
process.exit(fails ? 1 : 0);
