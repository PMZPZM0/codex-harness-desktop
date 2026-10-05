// 角色私有记忆守卫（10-05）：子智能体 / 专家团主会话 / 团成员 / 每位专家 四类角色的独立记忆空间。
//
// 需求（用户原话）：「为这四类会话角色分别实现独立隔离的记忆库机制……支持读取与写入记忆，
// 交互方式与普通会话窗口保持一致。记忆按会话/角色维度存储且互不串扰，内容跨轮次保留。」
//
// 判据挑的是**不变量**，不是"文件存在"：
//   ① 四类角色各有**互不相同**的归属键（专家团主理人与成员不撞、单人专家与团成员不撞）；
//   ② 存储落在**工作区**（随项目走），⛔ 不许落 userData 全局碎片池（那儿 search 只降权不过滤 ⇒ 会串扰）；
//   ③ 写入只落该角色自己的目录，⛔ 不许写项目层/用户层；
//   ④ 身份只认引擎下发的 threadId，⛔ 不许用模型自报的 args 当身份；
//   ⑤ 工具只注册给**角色会话**，主会话没有（它的记忆写入仍走既有 memory_save）；
//   ⑥ 注入沿用既有标记体系（显示侧按标记整段剥离），⛔ 不许自发明标记。
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log("  " + (c ? "✓" : "✗") + " 【role】" + m); if (!c) fails++; };

const roleMemory = readFileSync(join(ROOT, "electron", "role-memory.ts"), "utf8");
const roleTool = readFileSync(join(ROOT, "electron", "role-memory-tool.ts"), "utf8");
const delegate = readFileSync(join(ROOT, "electron", "features", "delegation.ts"), "utf8");
const teams = readFileSync(join(ROOT, "electron", "features", "teams-ipc.ts"), "utf8");
const delegateMemory = readFileSync(join(ROOT, "electron", "delegate-memory.ts"), "utf8");
const boot = readFileSync(join(ROOT, "electron", "features", "boot.ts"), "utf8");
const send = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part08", "02-seg", "send.tsx"), "utf8");

/* ── ① 四类归属键：四类都在，且两两不同 ─────────────────────────────────── */
{
  const kinds = ["subagent", "expert", "team-lead", "team-member"];
  ok(kinds.every((k) => new RegExp(`"${k}"`).test(roleMemory)),
    "四类角色都有归属种类（子智能体 / 专家 / 团主会话 / 团成员）");
  // ⛔ 关键隔离点：成员键必须带 memberId（否则同团两个成员共用一份记忆）
  ok(/ref\.kind === "team-member" && ref\.memberId/.test(roleMemory)
    && /`\$\{safe\(kind\)\}__\$\{safe\(id\)\}__\$\{safe\(String\(ref\.memberId\)\)\}`/.test(roleMemory),
    "⛔ 团成员键含 memberId（同团不同成员不共用记忆）");
  // ⛔ 键必须以 kind 打头 ⇒ 单人专家（expert）与团主（team-lead）不撞
  ok(/`\$\{safe\(kind\)\}__\$\{safe\(id\)\}`/.test(roleMemory) && /`\$\{safe\(kind\)\}__/.test(roleMemory),
    "⛔ 归属键以 kind 打头（专家 / 团主会话是两份记忆，不撞）");
  /* ⛔⛔ 分隔符不许含 `:`：**Windows 文件名非法字符** ⇒ `mkdir` 直接 ENOENT，
     四个角色一个都写不进去，而纯文本守卫全绿（10-05 实跑抓到的真 bug）。
     这条断言直接拿"键里还有没有冒号"当判据。 */
  ok(!/\$\{kind\}:\$\{safe/.test(roleMemory) && !/`\$\{kind\}:/.test(roleMemory),
    "⛔ 归属键不含 `:`（Windows 非法文件名字符 ⇒ 实跑 mkdir ENOENT，纯文本守卫看不出）");
  // ⛔ 归属只用稳定 id，显示名不参与（改名不丢记忆）
  ok(!/roleKey[\s\S]{0,400}label/.test(roleMemory.slice(roleMemory.indexOf("export function roleKey"), roleMemory.indexOf("export function roleTitle"))),
    "⛔ 归属键不含显示名（专家改名后仍读得到自己的记忆）");
}

/* ── ② 存储位置：随工作区，不进全局池 ───────────────────────────────────── */
ok(/path\.join\(workspace, MEMORY_DIR, MEMORY_SUB, ROLES_DIR/.test(roleMemory),
  "⛔ 角色记忆写在 <workspace>/.codex-harness/memory/roles/ 下（随项目走）");
ok(!/userDataDir.*MEMORY_FILE|getPath\("userData"\).*MEMORY/.test(roleMemory.slice(0, roleMemory.indexOf("const ROLE_INDEX_FILE"))),
  "⛔ 记忆内容不落 userData（全局池 search 只降权不过滤 ⇒ 会跨项目串扰）");
ok(/ROLE_INDEX_FILE = "role-memory-index\.json"/.test(roleMemory),
  "会话→角色索引是独立小文件（与记忆内容分离：索引是运行时数据，记忆随项目走）");

/* ── ③ 写入只进角色自己的目录 ───────────────────────────────────────────── */
{
  const fn = roleMemory.slice(roleMemory.indexOf("export async function appendRoleMemory"));
  ok(/fs\.writeFile\(file, content, "utf8"\)/.test(fn) && /const file = roleFile\(workspace, key\)/.test(fn),
    "⛔ 写入只写 roleFile(workspace, key) 算出的那一个文件");
  ok(!/writeProject|writeUser|writeLessons|writeBackground/.test(fn),
    "⛔ 写入不碰项目层 / 用户层 / 纪律层（主会话记忆不受污染）");
  const normLine = (roleMemory.match(/const norm = \(s: string\) => s\.replace\(([^)]*)\)/) || [])[1] || "";
  ok(!/0-9-/.test(normLine),
    "⛔ 去重归一化**不抹数字**（记忆里的次数/阈值是有信息的；抹掉会把不同记忆判成重复）");
  ok(/ROLE_MEMORY_MAX_ENTRY/.test(fn) && /text\.length > ROLE_MEMORY_MAX_ENTRY/.test(fn),
    "⛔ 单条有长度上限（否则模型一次写 10MB 就能把角色记忆文件撑爆）");
  ok(/已存在相同内容/.test(fn) && /const norm =/.test(fn),
    "⛔ 逐条去重（反复写同一件事不会膨胀）");
  /* ⛔ 查**代码形态**而不是注释：变异 m3 把 `existing.filter(…).concat(text)`（追加）
     换成 `[text]`（只剩最新一条、其余被抹掉）时，注释里那句"只追加不改写"照样成立 ⇒ 假绿。
     所以钉的是「既有内容被 filter 后 concat 新条目」这个形态。 */
  ok(/existing\.filter\(.*?\)\.concat\(text\)/.test(fn),
    "⛔ 只追加不改写既有行（代码形态：既有内容 filter 后 concat 新条目，而非整体替换）");
}

/* ── ④ 身份只认引擎下发的 threadId ─────────────────────────────────────── */
{
  const h = roleTool.slice(roleTool.indexOf("export async function handleRoleMemoryToolCall"));
  ok(/event\?\.params\?\.threadId/.test(h) && /lookupRoleSession\(userDataDir, threadId\)/.test(h),
    "⛔ 身份取 item/tool/call 的 threadId 并反查索引（模型伪造不了）");
  ok(!/args\?\.threadId|args\.roleId|args\?\.ref/.test(h),
    "⛔ 身份不许取 args 里的任何字段（否则等于让模型自报家门）");
  ok(/if \(!found\)[\s\S]{0,400}?success: false/.test(h),
    "⛔ 查不到归属 ⇒ 应答失败（fail-closed，不随便找个地方写）");
  /* ⛔ 必须钉**真的去查了登记表**：变异 m7 把 `delegateRegistry.infoOf(threadId)` 换成
     一个恒真对象时，`isDelegate…success:false` 那条形态仍在 ⇒ 假绿。 */
  ok(/const isDelegate = await delegateRegistry\.infoOf\(threadId\)/.test(h)
    && /if \(!isDelegate\)[\s\S]{0,300}?success: false/.test(h),
    "⛔ 非被委派会话也拒写（真的查了 delegateRegistry.infoOf，不是恒真占位）");
}

/* ── ⑤ 工具只给角色会话；主会话仍是 memory_save ────────────────────────── */
ok(/ROLE_MEMORY_TOOL_NAME = "role_memory_save"/.test(roleTool)
  && /与渲染层主会话的 `memory_save` 刻意不同名/.test(roleTool),
  "⛔ 工具名与主会话的 memory_save 不同（两个作用域，别让模型混）");
ok(/buildRoleMemoryTool\(roleRef\)/.test(delegate) && /dynamicTools/.test(delegate),
  "委派会话注册了角色记忆写入工具");
ok(/dynamicTools: \[buildRoleMemoryTool\(\{ kind: "team-member"/.test(teams),
  "⛔ 团成员会话也注册了写入工具（含 defer 分支：用户亲自对话那条）");
ok(!/name: "role_memory_save"/.test(send) && !/memory_role_save/.test(send),
  "⛔ 渲染层主会话**没有**这个工具（它的记忆写入仍走既有 memory_save）");

/* ── ⑥ 注入沿用既有标记；⛔ 不自发明标记 ─────────────────────────────────── */
ok(/roleMemorySection/.test(delegateMemory) && /roleSection/.test(delegateMemory),
  "委派记忆构建里接入了角色私有段");
ok(/不发明标记|塞进 `\[Harness 常驻记忆/.test(roleMemory),
  "⛔ 角色段不自带注入标记（由调用方拼进 [Harness 常驻记忆] 之内，显示侧才剥得掉）");
ok(/roleMemorySection\(workspace \|\| undefined, input\.role\)/.test(delegateMemory),
  "⛔ 角色私有记忆在共享层之后、召回之前注入（身份段最靠近任务）");

/* ── ⑦ 主进程应答必须在事件被裁剪之前 ─────────────────────────────────── */
{
  const i = boot.indexOf("handleRoleMemoryToolCall({");
  const j = boot.indexOf("filterForRenderer(event)");
  ok(i > 0 && j > 0 && i < j,
    "⛔ 主进程应答排在 filterForRenderer **之前**（被委派会话的事件会被裁掉，晚了就收不到）");
  ok(/只处理 role_memory_save/.test(boot) || /void handleRoleMemoryToolCall/.test(boot),
    "主进程只拦这一个工具，其余事件照原流程转发");
}

/* ── ⑧ 渲染层发送路径也能读（"交互与普通会话一致"）───────────────────── */
ok(/readRoleMemoryContext\(\{ threadId: bag\.thread\?\.id/.test(send),
  "⛔ 渲染层发送路径按当前会话注入角色私有记忆（亲自对话与被派出读到同一份）");
ok(/if \(roleCtx\?\.text\) memoryPrefix/.test(send),
  "角色段为空时静默跳过（普通会话行为与今天完全一致）");

console.log("\n【role】" + (checks - fails) + "/" + checks + " 通过" + (fails ? " —— " + fails + " 条红" : ""));
process.exit(fails ? 1 : 0);
