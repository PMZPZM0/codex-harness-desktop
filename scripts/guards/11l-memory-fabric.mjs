/**
 * 守卫【fabric】统一记忆架构的不变量（10-05）。
 *
 * 真相源 = `docs/MEMORY-ARCHITECTURE-2026-10-05.md`。⛔ 改架构先改那份文档。
 *
 * ⛔⛔ 本守卫只钉**结构与接线**；真正的隔离/共享/生命周期由 `.workbuddy/tmp/fabric-probe.mjs`
 *    **实跑**证明（跑编译产物、真写真检索）。纯文本守卫抓不到"文件写不进 Windows"这类问题
 *    —— 上一轮 `role-memory` 26 条全绿而实跑抓到两个真 bug。
 *
 * ⛔⛔ 断言一律**锚接线/取值**，不许锚注释文本，也不许用固定字符窗口串两句代码
 *    （插几行注释就假红 —— 项目已多次踩过）。
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, readMainSource, readAppUi } from "./_ctx.mjs";

let checks = 0, fails = 0;
const ok = (c, m) => { checks++; if (c) console.log("  ✓ " + m); else { fails++; console.log("  ✗ " + m); } };

const fab = readFileSync(join(ROOT, "electron", "memory-fabric.ts"), "utf8");
const tool = readFileSync(join(ROOT, "electron", "memory-fabric-tool.ts"), "utf8");
const del = readFileSync(join(ROOT, "electron", "delegate-memory.ts"), "utf8");
const legacy = readFileSync(join(ROOT, "electron", "role-memory.ts"), "utf8");
const legacyTool = readFileSync(join(ROOT, "electron", "role-memory-tool.ts"), "utf8");
const boot = readMainSource();
const memIpc = readFileSync(join(ROOT, "electron", "features", "memory-ipc.ts"), "utf8");
const appUi = readAppUi();
const seg = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part08", "01-seg.tsx"), "utf8");
const req = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part05", "event-router", "02-request.tsx"), "utf8");
const send = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part08", "02-seg", "send.tsx"), "utf8");
const mainSrc = boot;

/* ── ① 作用域模型：只有两级，且键以 scope 打头 ─────────────────────────── */
console.log("\n【fabric】① 作用域与命名空间");
/* ⛔ 10-05 用户定稿：**三层**（私有 / 团内共享 / 项目共享）。
   ⛔ 原来的 "session" 已并入 "private"（会话记忆的本质是「某个执行体独有」）。 */
ok(/export type MemoryScope = "private" \| "team" \| "project"/.test(fab),
  "⛔ 作用域是**三层** private/team/project（用户定稿：私有 + 团内共享 + 项目共享）");
ok(!/export type MemoryScope = "session"/.test(fab),
  "⛔⛔ 旧的两级枚举不许复活（\"session\" 已并入 \"private\" —— 留着会让新代码继续写错层）");
ok(/FABRIC_BUDGET = \{ project: 3000, team: 2500, private: 4000 \}/.test(fab),
  "⛔ 三层各有独立注入预算（⛔ 共用一个 = 某一层膨胀会挤掉其它层）");
/* ⛔ 下面四条都锚**实现的真实形态**（⛔ 别用 `\$\{` 拼模板 —— 那是 bash/JS 双层转义的坑，
   上一版就是这么全红的）。判据形态：键模板含 scope 与 owner、生成点唯一、净化覆盖非法字符。 */
const NS_TEMPLATE = "return `" + "${safeId(scope)}__${safeId(owner)}`";
ok(fab.includes(NS_TEMPLATE),
  "⛔ 命名空间键 = <scope>__<owner>（scope 打头 ⇒ 不同作用域不撞）");
const nsHits = (fab.match(/safeId\(scope\)\}__/g) || []).length;
ok(nsHits === 1, `⛔ 键生成只有一处实现（实际 ${nsHits} 处 —— 两处各拼一次就会漂）`);
/* ⛔ Windows 非法文件名字符 —— 上一轮实跑抓到：`:` 分隔符让 mkdir ENOENT、条目一个都写不进，
   而当时 26 条文本守卫全绿。这条断言是那次事故的 permanent 防线。 */
ok(/function safeId\(s: string\): string/.test(fab)
  && /\[\\\\\/:\*\?"<>\|]\+\/g, "_"/.test(fab),
  "⛔ 键的净化覆盖 Windows 非法字符（⛔ 实跑过：':' 分隔符让 mkdir ENOENT、条目一个都写不进）");
ok(/export function namespaceOf\(scope: MemoryScope, ownerId: string\)/.test(fab) && fab.includes(NS_TEMPLATE),
  "⛔ 同 scope 不同 owner ⇒ 不同命名空间（键含 owner ⇒ 隔离靠寻址，不靠过滤）");

/* ── ② 隔离：物理隔离 + 检索不返回不相关内容 ───────────────────────────── */
console.log("\n【fabric】② 硬隔离");
ok(/if \(!rel \|\| rel\.startsWith\("\.\."\) \|\| path\.isAbsolute\(rel\)\) return null/.test(fab),
  "⛔ 目录必须仍在 fabric 根内（挡住 .. 与绝对路径 ⇒ 越界写 = 任意文件写）");
/* ⛔ 判据形态随实现改过一次（加了归档过滤后中间变量从 scored 变成 live）——
   锚点必须跟着**当前的真实代码形态**，⛔ 别锚一个已不存在的中间变量。 */
ok(/const live = opts\.includeArchived \? pool : pool\.filter\(\(e\) => e\.archivedAt == null\)/.test(fab)
  && /const kept = tokens\.length \? live\.filter\(\(e\) => isRelevant\(e\.content, tokens\)\) : live/.test(fab),
  "⛔ 带 query 时**不相关的条目不返回**（只排序不丢弃 = 噪声召回，实跑抓过）");
ok(/function isRelevant\(content: string, tokens: string\[\]\)/.test(fab)
  && /shortHits \/ shortTotal >= 0\.34/.test(fab),
  "⛔ 相关性判定有命中率门槛（中文单字命中天然偏高，无门槛必然噪声）");
ok(!/pool\.filter\(\(e\) => e\.sessionId ===/.test(fab),
  "⛔⛔ 隔离**不做**成\"读全量再按 sessionId 过滤\"（漏一个条件就是串扰事故）");
/* ⛔ 上一版只有上面那条**负向**断言 ⇒ 变异（在 recall 里读别的命名空间）不红 = 假绿。
   ⛔ 负向断言只防"出现某种写法"，防不住"该走的路没走 / 走了另一条"。
   ⇒ 补**正向**：recall 必须物理寻址到本句柄的 ns，且函数体内**不出现别的命名空间键**。
   ⛔ 判据按**函数体切片**（`async recall(` 到下一个 `\n    },`），⛔ 不用固定字符窗口。 */
const recallBody = (fab.match(/async recall\([\s\S]*?\n {4}\},/) || [""])[0];
ok(recallBody.length > 0 && /await readNamespace\(workspace, ns\)/.test(recallBody),
  "⛔⛔ recall 物理寻址到**本句柄的命名空间**（隔离的实现本体，不是过滤）");
ok(recallBody.length > 0 && !/namespaceOf\(/.test(recallBody) && !/session__/.test(recallBody),
  "⛔⛔ recall 体内**不自己拼别的键**（能拼就能读别人 ⇒ 隔离漏一个条件就串扰）");
ok(recallBody.length > 0 && !/readNamespace\(workspace, (?!ns\b)/.test(recallBody),
  "⛔ recall 只读 ns 这一个命名空间（多读一个就是隔离漏口）");

/* ── ③ 条目结构 ────────────────────────────────────────────────────────── */
console.log("\n【fabric】③ 记忆条目数据结构");
for (const field of ["id", "content", "scope", "sessionId", "projectKey", "sourceAgent", "category", "weight", "pinned", "createdAt", "updatedAt", "lastUsedAt", "useCount"]) {
  ok(new RegExp(`\\n  ${field}[?]?:`).test(fab), `条目含字段 ${field}`);
}
ok(/export type MemorySourceAgent = \{ kind: MemoryAgentKind; id: string; label\?: string \}/.test(fab),
  "⛔ 来源智能体 = {kind, id, label}（角色是\"谁写的\"，可追溯）");
ok(/MemoryAgentKind = "main" \| "subagent" \| "expert" \| "team-lead" \| "team-member" \| "system"/.test(fab),
  "⛔ 来源身份覆盖六类（主会话 / 子智能体 / 专家 / 团主 / 团成员 / 系统）");
ok(/entries\.jsonl/.test(fab),
  "⛔ 落盘是 entries.jsonl（⛔ 不是 .md —— Markdown 行解析做不了元数据过滤与排序）");
ok(/CATEGORY_WEIGHT: Record<MemoryCategory, number>/.test(fab),
  "分类 ⇒ 默认权重有**唯一映射**（检索与裁剪都依赖它）");
/* ⛔⛔ 判"归一化不抹数字/字母"：**放弃解析字符类**，改判"归一化行里没有数字范围/字母范围"。
   解析字符类这条路试了三次都错：① 从 replace( 起截 → 把函数名 replace 的字母算进去
   恒红；② indexOf("]") → 命中转义 `\]`；③ 正则 `\[\^?\\\][^\n]*?\]` → 同样只吃到 `[\]]`。
   ⛔ 教训：**判据要锚在不会被转义形态影响的东西上** —— 数字范围 `0-9` 与字母范围
   `a-z`/`A-Z` 无论怎么写、怎么转义都是这三个字符，是稳定锚点。 */
const normLine = (fab.match(/const norm = \(s: string\)[^\n]*/) || [""])[0];
ok(normLine.length > 0
  && !normLine.includes("0-9")
  && !normLine.includes("a-z")
  && !normLine.includes("A-Z"),
  "⛔ 去重归一化**不抹数字与字母**（归一化行里无 0-9 / a-z / A-Z；\"跑了 3 次\"是有信息的）");

/* ── ④ 写入闸 ──────────────────────────────────────────────────────────── */
console.log("\n【fabric】④ 写入闸与纪律");
ok(/isRoleAgent\(init\.agent\) && input\?\.promote !== true/.test(fab),
  "⛔ 角色写 project 必须带 promote（全局共享的东西不能被中间结论污染）");
ok(/function isRoleAgent/.test(fab) && /return agent\.kind !== "main" && agent\.kind !== "system"/.test(fab),
  "⛔ 闸的判据是\"是不是角色\"（主会话与系统不受限）");
ok(/content\.length > FABRIC_MAX_ENTRY/.test(fab),
  "⛔ 单条有长度上限（否则模型一次写 10MB 就能把文件撑爆）");
ok(/pruneEntries\(after, FABRIC_MAX_ENTRIES\)/.test(fab) && /e\.pinned \? 1\.5 : 1\.0|filter\(\(e\) => e\.pinned\)/.test(fab),
  "⛔ 超量裁剪且 pinned 永不裁");
ok(/inject 不|不静默|被截断/.test(fab) && /超出预算被截断/.test(fab),
  "⛔ 注入被钳制时必须**如实告知**（静默截断 = 让它在盲区里干活）");
ok(/本次注入 \$\{relevant\.length\} \/ 命名空间共 \$\{entries\.length\} 条/.test(fab),
  "⛔ 注入的条目数如实报告（不许报全量 —— 那是谎报）");
/* ⛔ useCount / lastUsedAt 是 LRU 裁剪的输入 ⇒ 必须**真的**在召回时更新。
   第一版只初始化为 0/null、从不更新 ⇒ 裁剪退化成"按创建时间"（review 抓到）。 */
ok(/void touchEntries\(workspace, ns, new Set\(hit\.map\(\(e\) => e\.id\)\), Date\.now\(\)\)/.test(fab),
  "⛔ 召回命中后真的记账（useCount/lastUsedAt）—— 只定义不更新 = 裁剪判据是装饰");
ok(/async function touchEntries[\s\S]{0,900}?await rewriteJsonl\(file, entries\)/.test(fab),
  "⛔⛔ 记账**就地重写**整份文件（⛔ appendFile 追加残缺行 ⇒ readNamespace 返回字段缺失的对象）");
ok(!/void appendJsonl\(entriesFile\(workspace, ns\)/.test(fab),
  "⛔ 记账路径不追加残缺行（第一版的错法，会污染 entries.jsonl）");

/* ── ⑤ 一个写入面（不许并列第二个语义）────────────────────────────────── */
console.log("\n【fabric】⑤ 统一写入面");
ok(/export const FABRIC_WRITE_TOOL = "memory_write"/.test(tool),
  "⛔ 唯一写入工具名 = memory_write");
/* ⛔ 分类必须白名单校验：分类决定默认权重与注入分组，模型自造词会让条目落在
   错误的权重档上（裁剪时先被淘汰）。第一版直接 as 断言绕过校验（review 抓到）。 */
ok(/const category = \(CATEGORIES as string\[\]\)\.includes\(rawCategory\) \? \(rawCategory as MemoryCategory\) : "临时上下文"/.test(tool),
  "⛔ 分类走五类白名单（模型自造词 → 退回临时上下文，⛔ 不静默接受）");
ok(!/category: \(args\.category as MemoryCategory\)/.test(tool),
  "⛔⛔ 不许用类型断言绕过白名单（`as` 不做运行时校验）");
ok(/FABRIC_WRITE_ALIASES = \["memory_save", "role_memory_save"\]/.test(tool),
  "⛔ 旧名只作**别名**（老会话里模型记着它们；别名不是第二套能力）");
ok(/return n === FABRIC_WRITE_TOOL \|\| \(FABRIC_WRITE_ALIASES as readonly string\[\]\)\.includes\(n\)/.test(tool),
  "别名与新名**走同一个判别**（不是两个 handler）");
ok(/buildFabricWriteTool\(agentOfRoleRef\(ref\)\)/.test(legacyTool),
  "⛔ 角色侧工具定义直接用统一的（⛔ 不再自造一份说明书 —— 两套语义的老坑）");
ok(!/name: "role_memory_save"/.test(legacyTool) && !/name: "memory_save"/.test(legacyTool),
  "⛔ 旧工具名不再作为独立工具定义出现");
ok(/name: "memory_write"/.test(seg) && !/name: "memory_save"/.test(seg),
  "⛔ 渲染层主会话工具面只暴露 memory_write（旧名仅在分发层作别名）");
ok(/event\.params\?\.tool === "memory_write" \|\| event\.params\?\.tool === "memory_save"/.test(req),
  "⛔ 分发层两个名字同一个分支");
ok(/window\.codex\.writeFabricMemory\(/.test(req),
  "⛔ 渲染层写入转发到统一内核的通道（不自己拼 categories）");

/* ── ⑥ 一条注入路径（不许分两处拼装）──────────────────────────────────── */
console.log("\n【fabric】⑥ 注入路径同源");
ok(/export async function buildContext\(/.test(fab)
  && /handles: \{ private: MemoryHandle \| null; team: MemoryHandle \| null; project: MemoryHandle \| null \}/.test(fab),
  "⛔ 注入只有一个 buildContext，且接受**三层**句柄（分两处拼装 ⇒ \"派出去的专家拿不到自己刚写的\"）");
/* ⛔ 注入顺序 = 共享在前、私有在后（⛔ 顺序有语义：模型对上下文开头权重更高） */
const injectOrder = (fab.match(/const projectSection = [\s\S]{0,900}?const privateSection = await options\.handles\.private/) || [""])[0];
ok(injectOrder.length > 0
  && injectOrder.indexOf("handles.project") < injectOrder.indexOf("handles.team")
  && injectOrder.indexOf("handles.team") < injectOrder.indexOf("handles.private"),
  "⛔⛔ 注入顺序 = 项目 → 团内 → 私有（共享的在前、自己的在后）");
ok(/await buildContext\(\{ handles/.test(del),
  "⛔ 被委派会话走同一个 buildContext");
ok(/memory:role-context[\s\S]{0,200}?await buildContext\(/.test(memIpc)
  || /handle\("memory:role-context"[\s\S]{0,1400}?await buildContext\(/.test(memIpc),
  "⛔ 渲染层读（主会话 + 亲自对话）也走同一个 buildContext");
ok(/legacyRole: found\?\.ref \?\? null/.test(memIpc) || /legacyRole: options\.legacyRole/.test(fab),
  "⛔ 上一版 roles/<键>/MEMORY.md 作为**兼容段**继续可读（架构文档 §7：不删）");
ok(/readRoleMemoryContext\(\{[\s\S]{0,300}?query: messageText/.test(send),
  "⛔ 发送路径带 query（只注入相关的；不相关的挂在本轮开头是噪声）");
/* ⛔ 标记纪律：fabric 自己**不产出**标记字面量（由调用方拼进既有 [Harness 常驻记忆] 之内）。
   判据 = fabric 文件里不出现该标记（自造 ⇒ 显示侧剥不掉、机器块漏进用户气泡）。 */
ok(!/\[Harness 常驻记忆\]/.test(fab),
  "⛔ fabric 段**不自造注入标记**（自造 ⇒ 显示侧剥不掉、机器块漏进用户气泡）");
ok(/标记/.test(fab),
  "⛔ 该纪律在实现处有注释说明（⛔ 注释不参与判定，只防后人误读）");

/* ── ⑦ 生命周期闭环 ────────────────────────────────────────────────────── */
console.log("\n【fabric】⑦ 生命周期");
ok(/export async function archiveSessionMemory\(/.test(fab)
  && /if \(archived\) \{[\s\S]{0,200}?e\.archivedAt = now/.test(fab),
  "⛔ 会话归档/取消归档有闭环（归档 ≠ 失忆：内容保留）");
ok(/FABRIC_PRIVATE_RETENTION_DAYS \* 86_400_000/.test(fab),
  "⛔ 私有记忆有保留期（过期**归档**而不是删除）");
/* ⛔ 上一版只查"保留期常量被用上"，变异 m12（把过期判据改成 `false &&`）不红 = 假绿。
   ⇒ 判据必须是**可判真假的具体条件**：e.archivedAt 为空 **且** 已超保留期。 */
ok(/e\.archivedAt == null && now - e\.createdAt > FABRIC_PRIVATE_RETENTION_DAYS \* 86_400_000/.test(fab),
  "⛔⛔ 过期归档的判据是「未归档 且 超保留期」（两条件都在 —— 少一个就永不过期，恒假）");
/* ⛔ 归档必须有**行为差异**：只打标记、不过滤 = 字段是装饰（review 抓到）。
   ⇒ 钉住 rankEntries 默认排除已归档 + 提供 includeArchived 出口。 */
ok(/const live = opts\.includeArchived \? pool : pool\.filter\(\(e\) => e\.archivedAt == null\)/.test(fab),
  "⛔⛔ 已归档条目**不参与召回**（只打标记不过滤 ⇒ 归档形同虚设）");
ok(/includeArchived\?: boolean/.test(fab),
  "⛔ 需要读历史时有出口（includeArchived —— 归档不等于删内容）");
/* ⛔ 删除会话路径必须**真的调用**归档（否则 archiveSessionMemory 又是死代码）。
   ⛔⛔ 上一版只查「调用那行存在」，变异把它藏进 `if (false && …)` 照样绿 ——
   「只验落地不验执行」。⇒ 必须钉住**触发条件**：由 threadCwd 取到工作区才执行，
   ⛔ 而 threadCwd.get 必须真的被调用（判据本身也不能被短路的常量顶掉）。 */
ok(/archiveSessionMemory\(goneCwd, goneId, true\)/.test(boot)
  && /const goneCwd = threadCwd\.get\(goneId\)/.test(boot),
  "⛔⛔ 会话被删时真的调用了 archiveSessionMemory（⛔ 写了不接线 = 等于没写）");
/* ⛔ 按分支切片（⛔ 不用固定字符窗口）：`if (goneCwd)` 那一支里必须有归档调用，
   ⛔ 这样把它改成 `if (false && goneCwd)` 就会红。 */
const delBranch = (boot.match(/if \(goneCwd\)[^\n]*archiveSessionMemory[^\n]*/) || [""])[0];
ok(delBranch.length > 0 && /if \(goneCwd\)/.test(delBranch),
  `⛔ 归档的触发条件是「取到工作区」（实际：${delBranch.trim().slice(0, 48) || "未找到分支"}）`);
ok(/export async function sweepFabric\(/.test(fab) && /pruneEntries\(entries2, FABRIC_MAX_ENTRIES\)/.test(fab),
  "sweep 同时做归档与裁剪");
/* ⛔⛔ 上一轮最大教训：prune() 写好了但**全仓无调用点** ⇒ 记录只增不减。
   这条断言就是那次事故的 permanent 防线：清扫必须挂在启动路径上。 */
ok(/sweepFabric\(/.test(boot) && /for \(const ws of pickWorkspacesToSweep/.test(boot),
  "⛔⛔ 启动路径**真的调用**了 sweepFabric（写了不接线 = 等于没写）");
ok(/pickWorkspacesToSweep\(\[...threadCwd\.values\(\)\]\)/.test(boot),
  "⛔ 清扫的工作区来源是已知登记（threadCwd）—— ⛔ 不猜路径，否则等于对任意目录读扫描");
ok(/forgetRoleSession/.test(boot),
  "会话被删会清 session→角色 索引（⛔ 内容留着：角色还在，下次派出继续用）");
ok(/function pickWorkspacesToSweep\(known: Iterable<string>\)/.test(fab)
  && /isScratchWorkspace\(p\)/.test(fab),
  "⛔ scratch 工作区不落记忆也不清扫（与 fabricRoot 同口径）");

/* ── ⑧ 身份闸（安全面：绝不许用 args 当身份）───────────────────────────── */
console.log("\n【fabric】⑧ 身份闸");
ok(/isFabricWriteTool\(event\?\.params\?\.tool\)/.test(legacyTool),
  "⛔ 主进程应答认新名 + 旧名（同一个 handler）");
ok(/lookupRoleSession\(userDataDir, threadId\)/.test(legacyTool),
  "⛔ 身份只由**引擎下发的 threadId** 反查（⛔ 不用 args 任何字段当身份 = 让模型自报家门）");
ok(/const isDelegate = await delegateRegistry\.infoOf\(threadId\)/.test(legacyTool),
  "⛔ 二次核对：必须是**被委派**的会话（引擎侧出 bug 时这条兜底）");
ok(/handleFabricWrite\(\{[\s\S]{0,200}?threadId,/.test(legacyTool),
  "⛔ 角色会话的写入转发到统一内核（⛔ 不再自己写 roles/<键>/MEMORY.md）");
ok(/appendRoleMemory/.test(legacyTool) === false,
  "⛔⛔ 旧写入函数**不再被工具路径调用**（存储已统一，身份闸留着）");

/* ── ⑨ 与既有系统的边界（不许顺手改 L0–L7）─────────────────────────────── */
console.log("\n【fabric】⑨ 与既有系统的边界");
ok(/import \{ MEMORY_BUDGET, isScratchWorkspace \} from "\.\/memory-layers"/.test(fab),
  "⛔ 复用 memory-layers 的原语与 scratch 判据（⛔ 不另造一套路径判断）");
ok(!/MEMORY_BUDGET\.total/.test(fab) && /FABRIC_BUDGET/.test(fab),
  "⛔ fabric 段**独立预算**（它是额外一段，不占 L 层的共享额度）");
ok(/MEMORY_DIR = "\.codex-harness"/.test(fab) && /MEMORY_DIR = "\.codex-harness"/.test(legacy),
  "⛔ 目录常量与 role-memory 同值（漂了就写到别处、读时找不到）");
/* kind 映射在两处（delegate-memory 的 agentOf 与 memory-fabric-tool 的 agentOfRoleRef）——
   刻意不共用一个（会成环），所以必须钉住一致。
   ⛔ 两个正则必须先取值再断言（⛔ 别把匹配塞进 ok() 的第一个参数里 ——
   上一轮就因为"未匹配返回 undefined"导致后面所有断言都因异常不执行，
   而守卫自己报的条数仍是绿的 —— 那是假绿的极端形态）。 */
const delKinds = del.match(/role\.kind === "subagent" \? "subagent"[\s\S]{0,240}?: "team-member"/);
const toolKinds = tool.match(/subagent: "subagent",[\s\S]{0,260}?"team-member": "team-member"/);
const KINDS = ["subagent", "expert", "team-lead", "team-member"];
const delHas = KINDS.filter((k) => Boolean(delKinds) && delKinds[0].includes(`"${k}"`));
const toolHas = KINDS.filter((k) => Boolean(toolKinds) && toolKinds[0].includes(`"${k}"`));
ok(delHas.length === 4 && toolHas.length === 4,
  `⛔ 四类角色的 kind 映射两处一致（delegate ${delHas.length}/4、tool ${toolHas.length}/4）—— 漂了会写错 sourceAgent`);

console.log("\n【fabric】" + (checks - fails) + "/" + checks + " 通过" + (fails ? " —— " + fails + " 条红" : ""));
process.exit(fails ? 1 : 0);
