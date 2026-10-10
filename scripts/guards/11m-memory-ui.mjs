/**
 * 守卫【mui】记忆工作台（memory-ui 域）的不变量（10-05）。
 *
 * 真相源 = `docs/MEMORY-ARCHITECTURE-2026-10-05.md` + 用户定稿的四条要求。
 *
 * ⛔ 本守卫钉的是**用户明确要求的口径**，不是实现细节：
 *   ① 界面纯只读（⛔ 记忆只能由智能体自己写 —— 传 noop 不算，门禁要看按钮有没有渲染）
 *   ② 三层作用域与注入顺序
 *   ③ 类型统一（判别联合 ⇒ 漏分支会被编译器抓）
 *   ④ 组件分层（⛔ primitives 零业务知识、⛔ 外壳是唯一碰 IPC 的地方）
 *
 * ⛔⛔ 视觉质量**不由本守卫负责** —— 那是探针截图的活（人眼看 + DOM 取证）。
 *   守卫只能证明"结构对"，⛔ 证明不了"好看"（上一轮记忆里的教训）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { ROOT, readAppUi } from "./_ctx.mjs";

let checks = 0, fails = 0;
const ok = (c, m) => { checks++; if (c) console.log("  ✓ " + m); else { fails++; console.log("  ✗ " + m); } };

const TYPES = readFileSync(join(ROOT, "src", "features", "memory-ui", "types.ts"), "utf8");
const PRIM = readFileSync(join(ROOT, "src", "features", "memory-ui", "primitives.tsx"), "utf8");
const VIEWS = readFileSync(join(ROOT, "src", "features", "memory-ui", "views.tsx"), "utf8");
const SHELL = readFileSync(join(ROOT, "src", "features", "memory-ui", "MemoryWorkbench.tsx"), "utf8");
/* ⛔ 10-05：归一化层是跨进程字段对齐的真相源（守卫 11n 负责真跑它，这里只做结构判定） */
const NORM_SRC = readFileSync(join(ROOT, "src", "features", "memory-ui", "normalize.ts"), "utf8");
const CSS = readFileSync(join(ROOT, "src", "styles", "29-memory-ui.css"), "utf8");
const PANEL = readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "07-memory-panel.tsx"), "utf8");
const FUNNEL = readFileSync(join(ROOT, "src", "features", "memory", "MemoryPanels.tsx"), "utf8");

/* ── ① 七类记忆齐全 + 判别联合 ────────────────────────────────────────── */
console.log("\n【mui】① 类型契约");
for (const k of ["pyramid", "mcp-backend", "main", "subagent", "expert", "team", "dispatched"]) {
  ok(TYPES.includes('"' + k + '"'), `记忆类型含 ${k}`);
}
ok(/export type AnyMemory = \{ \[K in MemoryKind\]: MemorySourceMap\[K\] \}\[MemoryKind\];/.test(TYPES),
  "⛔ AnyMemory 是**判别联合**（漏分支会被编译器抓到，而不是运行时白屏）");
ok(/export type MemorySourceMap = \{/.test(TYPES) && /export type MemoryViewProps<T extends MemoryKind = MemoryKind>/.test(TYPES),
  "⛔ 数据载荷与视图 props 各有一份契约（⛔ 不在视图里现写类型）");
/* ⛔ 条目字段必须与后端 MemoryEntry 逐字对齐 —— 改名会静默变成"字段缺失" */
for (const f of ["scope", "sessionId", "projectKey", "sourceAgent", "category", "weight", "pinned", "createdAt", "updatedAt", "lastUsedAt", "useCount", "archivedAt"]) {
  ok(new RegExp("\\n  " + f + "[?]?:").test(TYPES), `条目字段 ${f} 与后端对齐`);
}
ok(/"session"\s*\|\s*"project"/.test(TYPES) === false || /private.*team.*project/s.test(TYPES),
  "⛔ 作用域是三层 private/team/project（用户定稿：私有 + 团内共享 + 项目共享）");

/* ── ② 组件分层 ───────────────────────────────────────────────────────── */
console.log("\n【mui】② 组件分层与低耦合");
ok(!/window\.codex|ipcRenderer|require\("electron"\)/.test(PRIM),
  "⛔ primitives 零业务知识：不碰 IPC、不 import electron（⛔ 它只管布局与状态）");
ok(!/ipcRenderer|require\("electron"\)|window as any\)\.codex/.test(VIEWS),
  "⛔⛔ views 零业务知识：**一个 IPC 调用都没有**（上一版只查 ipcRenderer/electron，"
  + "⛔ 而 `window.codex` 这条真路径能绕过去 —— 变异验证时才发现）");
const ipcHits = (SHELL.match(/window as any\)\.codex|\.codex\./g) || []).length;
ok(ipcHits > 0, `⛔ 外壳是唯一碰 IPC 的地方（${ipcHits} 处调用，其余文件 0 处）`);
/* 10-10 修正：TABS 从 7 项收成 **5 个作用域**（金字塔 / MCP 后端改走常驻概览条，见 ⑨）——
   这条断言的**意图**没变：tab 表仍然只有这一处定义，加一个作用域只改这张表。
   ⛔ 七类**数据源**的齐全性由 ①（MemoryKind 类型）继续钉着，两件事不要混。 */
ok(/const TABS: \{ kind: ScopeTabKind; label: string \}\[\]/.test(SHELL)
  && (SHELL.match(/\{ kind: "/g) || []).length === 5,
  "⛔ 类型切换表一处 5 项作用域（⛔ 加新作用域只改这张表；分层/后端不做 tab 见 ⑨）");
ok(/createContext/.test(SHELL) === false && /createContext/.test(PRIM) === false,
  "⛔ 不用 context（视图间无共享状态 ⇒ context 只会带来耦合）");

/* ── ③ 界面纯只读（用户明确要求）───────────────────────────────────────── */
console.log("\n【mui】③ 界面纯只读");
ok(/readOnly\?: boolean/.test(FUNNEL) && /\{!readOnly && \(/.test(FUNNEL),
  "⛔ MemoryFunnel 支持只读：⛔ 只读时**不渲染**删除/置顶按钮（传 noop 不算 —— 按钮还在就等于还有入口）");
ok(/readOnly={true}|readOnly\s*\n\s*readOnly/.test(PANEL) || /\breadOnly\b/.test(PANEL),
  "⛔ 记忆中心以只读方式使用旧记忆库");
ok(!/saveMemoryRecord\(memoryManagementWorkspace\)/.test(PANEL),
  "⛔⛔ 手动保存表单已移除（记忆只能由智能体在运行时自己新增）");
/* ⛔⛔ 上一版只查"保存按钮的 onClick 不存在" ⇒ 变异把表单（textarea + 下拉）搬回来也不红
   —— 判据强度低于承诺。⇒ 查**输入控件本身**在记忆中心里不存在。
   ⚠️ 判据要避开别处的 textarea：记忆中心面板文件里若已有其它 textarea（如全局搜索框）
      会恒红 ⇒ 所以只查"手动保存"那块特征的组合。 */
const manualSaveBlock = (PANEL.match(/手动保存[\s\S]{0,600}?<\/div>\s*<\/div>/) || [""])[0];
ok(manualSaveBlock.length === 0 || !/<textarea|memory-editor/.test(manualSaveBlock),
  "⛔⛔ 手动保存**表单**（输入框）不存在 —— 界面不给任何手动写入的口子");
ok(!/清空记忆/.test(PANEL),
  "⛔⛔ 「清空记忆」入口已移除（用户要求界面不提供删除入口）");
/* ⛔ 工作台视图里不许有写入口。
   ⛔⛔ 判据不能靠"正则剥注释再搜关键词" —— 上一版那么写，⛔ 中文括号让脚本直接语法错、
   零输出（比红更坏：外部只看 ✗ 行会读成"全绿"）。
   ⇒ 可靠判据：⛔ 剥掉 JSX 注释与块注释后，源码里不许出现删除/编辑类回调 prop。 */
const viewsNoComment = VIEWS
  .replace(/\/\*[\s\S]*?\*\//g, " ")          // 块注释
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")       // JSX 注释
  .replace(/\/\/[^\n]*/g, " ");                // 行注释
ok(!/onDelete|onEdit|onSaveMemory|handleDelete/.test(viewsNoComment),
  "⛔ 工作台视图里没有删除/编辑回调（⛔ 注释里提到不算）");
ok(!/<input[^>]*type="text"|<textarea/.test(viewsNoComment),
  "⛔⛔ 工作台视图里没有输入框（⛔ 记忆只能由智能体写，界面不给输入口）");

/* ── ④ 视觉规范：颜色走 token + 状态三重编码 ───────────────────────────── */
console.log("\n【mui】④ 视觉规范");
const hardColors = CSS.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
/* ⛔ 允许的硬编码：只限"语义色"（成功/警告/危险/强调），
   ⛔ 背景与文字色必须走 token（否则深色主题下会落亮色 fallback）。 */
const semantic = ["#1d9e75", "#0f6e56", "#d99000", "#8a5a00", "#d0574f", "#a32d2d", "#d4537e"];
const illegal = hardColors.filter((c) => !semantic.includes(c.toLowerCase()));
ok(illegal.length === 0, `⛔ 背景/文字色全部走 token（硬编码只剩 ${illegal.length} 处非语义色：${illegal.slice(0, 3).join(",") || "无"}）`);
ok(/var\(--bg\)|var\(--panel\)|var\(--text\)/.test(CSS) && !/var\(--font-mono/.test(CSS),
  "⛔ 深浅色主题靠项目既有 token（⛔ --font-mono 未定义，用 --mono）");
ok(/@container \(max-width: 560px\)/.test(CSS) && /@container \(max-width: 420px\)/.test(CSS),
  "⛔ 有容器查询断点（⛔ 面板宽度变了就重排，不依赖窗口宽度）");
ok(/prefers-reduced-motion/.test(CSS), "⛔ 尊重「减少动效」系统偏好（无障碍硬要求）");
ok(/aria-selected/.test(SHELL) && /role="tablist"/.test(SHELL),
  "⛔ 类型切换有 tablist/aria-selected（键盘与读屏可用）");
ok(/aria-live="polite"/.test(PRIM), "⛔ 加载态有 aria-live（⛔ 读屏用户知道在加载）");

/* ── ⑤ 状态与性能 ─────────────────────────────────────────────────────── */
console.log("\n【mui】⑤ 状态与性能");
ok(/export function MemoryState/.test(PRIM) && /state === "loading"/.test(PRIM) && /state === "error"/.test(PRIM),
  "⛔ 加载/错误/空三态统一在 primitives（⛔ 各视图不各写一套）");
ok(/export function MemorySkeleton/.test(PRIM), "⛔ 有骨架屏（⛔ 比转圈更有用：用户知道马上会有内容）");
/* ⛔⛔ 空态判据：必须同时看"真的没条目" —— 只看 state 会让空态与列表并存（探针抓到过） */
const actorEmpty = (VIEWS.match(/state !== "ready" \|\| !entries\.length \? \(/) || [""])[0];
ok(actorEmpty.length > 0, "⛔⛔ 执行体视图的空态判「state + 真的没条目」（⛔ 只看 state ⇒ 空态与列表并存）");
ok(/!data\?\.entries\.length \? \(/.test(VIEWS),
  "⛔⛔ 团视图的空态也判条目数（同一坑，两处都要修）");
/* ⛔ 虚拟列表：⛔ 不能假设固定行高（内容长度不可控 ⇒ 必然裁切） */
/* ⛔⛔ 虚拟列表**实测行高**（⛔ 固定行高会裁内容 —— 探针抓到"统计 20 条只看见 6 条"）。
   ⛔ 判据锚**代码形态**（函数签名 + state 名），⛔ 不锚全文：
   上一版写 `!/rowHeight/.test(PRIM)`，⛔ 而 PRIM 的**注释**里正好有 rowHeight 这词
   （记录那次踩坑）⇒ 恒红。教训：取样点不能落在注释上。 */
/* ⛔ 切片到「函数体真正开始」= 见到 `) {` 后的第一个 `const`。
   ⛔⛔ 别用 `[\s\S]{0,400}?\}\s*\{` —— 签名里就有 `}`（类型标注 `{ items: T[]; … }`），
   非贪婪会在那儿截断，拿不到真正的判定点（实测这条因此恒红）。 */
const listStart = PRIM.indexOf("export function MemoryList");
const listBody = listStart < 0 ? "" : PRIM.slice(listStart, PRIM.indexOf("const [rowH", listStart));
ok(listBody.includes("estimateRow") && !/rowHeight\s*[=:?]/.test(listBody),
  "⛔⛔ 虚拟列表签名用 estimateRow（⛔ 固定 rowHeight 会裁内容 —— 探针抓到\"统计 20 条只看见 6 条\"）");
ok(/const \[rowH, setRowH\] = useState\(/.test(PRIM) && /setRowH\(/.test(PRIM),
  "⛔ 行高是 state（⛔ 首屏量一次后替换估算值，不是每次渲染重算）");
ok(/getBoundingClientRect\(\)\.height/.test(PRIM) && /median/.test(PRIM),
  "⛔ 行高取前 3 行的中位数（中位数比均值抗异常值）");
/* ⛔ 上限保护：上一版只查 `maxRender` 出现在文件里 ⇒ 变异"capped = items"（静默截断）不红。
   ⇒ 钉住**真的用了 slice**，且提示文案在（⛔ 静默截断会被读成"就这些"）。 */
const cappedLine = (PRIM.match(/const capped = [^\n]*/) || [""])[0];
ok(cappedLine.includes("items.slice(0, maxRender)"),
  "⛔⛔ 渲染上限真的用了 slice（⛔ 只查 maxRender 这个词存在 = 恒绿）");
ok(/只渲染了前/.test(PRIM) && /\{items\.length > maxRender && \(/.test(PRIM),
  "⛔⛔ 超限时**明示**还剩多少（静默截断会被读成\"就这些\"）");
ok(/overflow: hidden/.test(CSS) && /contain: content/.test(CSS),
  "⛔ 长列表滚动不触发外层重排（contain）");
/* ⛔ 动效降级：上一版 `[^}]*` 只吃到**第一条** prefers-reduced-motion（骨架屏那条），
   ⇒ 变异把转圈的 animation:none 删掉也不红。⇒ 用 matchAll 收全部，⛔ 要求每一条都含 animation: none。 */
const rmBlocks = [...CSS.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([^}]*)\}/g)].map((m) => m[1]);
ok(rmBlocks.length >= 2 && rmBlocks.every((b) => b.includes("animation: none")),
  `⛔⛔ 每处「减少动效」降级都真的关掉动画（${rmBlocks.length} 处，⛔ 只查 @media 出现过 = 空规则也绿）`);

/* ── ⑥ 归属判定不靠猜 ─────────────────────────────────────────────────── */
console.log("\n【mui】⑥ 归属映射");
/* ⛔⛔ 10-05 修订：归属判定的**真相源搬到了 `normalize.ts` 的 parseNamespace** ——
   原先三段 startsWith 散在外壳里，正是"同一件事写三遍"的形态。⇒ 判据跟着搬，
   ⛔ 但判据强度不许降：① 查函数真的导出 ② 真跑它验三种前缀（守卫 11n 用 node
   strip-types 真跑；这里只做结构判定，两层互补）。 */
ok(/export function parseNamespace/.test(NORM_SRC),
  "⛔ 命名空间归属判定的单一真相源是 parseNamespace（⛔ 不散落在多处 startsWith）");
ok((NORM_SRC.match(/startsWith\("team__"\)|startsWith\("project__"\)|startsWith\("private__"\)/g) || []).length === 3,
  "⛔ 三种命名空间前缀各有分支（⛔ 漏 team__ 会让团记忆显示成 0 条 —— 探针抓到过）");
/* ⛔⛔ 判据强度：⛔ 不靠 grep 三个 startsWith 都在（变异把某支改成 `if (false && …)` 照样绿）。
   ⇒ **真跑** parseNamespace 验三种前缀的输出。
   ⛔⛔ 用**子进程**而不是顶层 import：本守卫历史上是无 `--experimental-strip-types` 跑的
   （只有 11n 带那个标志）⇒ 直接 import .ts 会抛 ERR_UNKNOWN_FILE_EXTENSION，
   ⛔ 而 catch 会把它吞成"跑不起来"= 静默降级成 grep = 假绿。⇒ 标志写死在子进程里。 */
let nsCheck = null;
try {
  const script = `
    const m = await import(${JSON.stringify(pathToFileURL(join(ROOT, "src", "features", "memory-ui", "normalize.ts")).href)});
    const p = (x) => m.parseNamespace(x);
    console.log(JSON.stringify({
      team: p("team__t1").scope === "team" && p("team__t1").owner === "t1",
      project: p("project__p1").scope === "project" && p("project__p1").owner === "p1",
      private: p("private__th1").scope === "private" && p("private__th1").owner === "th1",
      unknown: p("weird__x").owner === "",
    }));
  `;
  const out = execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  nsCheck = JSON.parse(out.trim().split("\n").filter((l) => l.startsWith("{"))[0] || "null");
} catch {
  nsCheck = null;
}
ok(nsCheck !== null, "⛔ parseNamespace 可被真跑（跑不起来 = 判据退化成 grep = 假绿风险）");
ok(nsCheck?.team && nsCheck?.project && nsCheck?.private,
  "⛔⛔ 三种命名空间前缀**真跑**都返回正确 scope+owner（⛔ 漏 team__ 会让团记忆显示 0 条 —— 探针抓到过）");
ok(nsCheck?.unknown === true,
  "⛔⛔ 未知前缀不猜归属（owner 留空 ⇒ 上层标成「未归属」，⛔ 猜错不可见）");
ok(!/if \(false && name\.startsWith/.test(NORM_SRC) && !/if \(true \|\|/.test(NORM_SRC),
  "⛔ 归属分支没有被短路面包（变异手法自查）");
ok(!/name\.startsWith\("project__"\)[\s\S]{0,200}?content\.includes/.test(SHELL),
  "⛔⛔ 归属**只按命名空间前缀 + 角色登记表**，⛔ 绝不按条目内容/显示名猜（猜错不可见）");
ok(/pushMain\(entries, "项目共享层"/.test(SHELL) && /pushMain\(entries, "未归属的会话"/.test(SHELL),
  "⛔ 公共层与孤儿空间**如实标注**（⛔ 不硬塞给某个人）");

/* ── ⑨ 维度分离：金字塔 / 存储后端**不做 tab**（10-10 用户反馈修正）──────────────
   用户原话：「金字塔记忆不应作为单独的一个分类来呈现，而应体现在每一个选项当中。
   当前实现将记忆全部归入"金字塔记忆"这一类，其他类目均为空」。
   根因 = **两个正交维度被摆进同一排 tab**（作用域 vs 分层机制/存储位置），
   且计数口径串味：pyramid 那格填的是**层数**（L0–L7 恒 8）、mcp 那格是**布尔**，
   而作用域几格是**条目数** ⇒ 读起来就是"记忆全归到金字塔"。
   ⇒ 钉死：tab 只含作用域；金字塔与后端走**常驻概览条**；计数只统计条目数。 */
console.log("\n【mui】⑨ 维度分离（作用域 / 分层机制 / 存储后端各归其位）");
{
  const tabsBlock = (SHELL.match(/const TABS[\s\S]*?\];/) || [""])[0];
  ok(["main", "subagent", "expert", "team", "dispatched"].every((k) => tabsBlock.includes(`kind: "${k}"`)),
    "tab 覆盖五个作用域维度");
  ok(!/kind: "pyramid"/.test(tabsBlock) && !/kind: "mcp-backend"/.test(tabsBlock),
    "⛔ 金字塔与 MCP 后端**不在 tab 里**（它们是正交维度，不是记忆分类）");
  const countsBlock = (SHELL.match(/const counts = useMemo[\s\S]*?\}\), \[data\]\)/) || [""])[0];
  ok(!/layers\.length/.test(countsBlock) && !/\? 1 : 0/.test(countsBlock),
    "⛔ 计数口径统一为条目数（⛔ 不许再把层数 / 布尔塞进同一排 tab —— 那是在骗人）");
  ok(/function MemoryOverview\(/.test(SHELL) && /<MemoryOverview/.test(SHELL),
    "机制概览（金字塔水位 + 存储后端）存在且已挂载 —— 每个作用域视图下都看得到");
  ok(!/\{tab === "pyramid"\}/.test(SHELL) && !/\{tab === "mcp-backend"\}/.test(SHELL),
    "⛔ 两个视图不再挂在 tab 分支上（只在概览里渲染）");
  ok(/\.mui-overview\b/.test(CSS) && /\.mui-overview-head\b/.test(CSS),
    "概览条样式已定义（缺了会退化成裸按钮）");
}

console.log("\n【mui】" + (checks - fails) + "/" + checks + " 通过" + (fails ? " —— " + fails + " 条红" : ""));
process.exit(fails ? 1 : 0);
