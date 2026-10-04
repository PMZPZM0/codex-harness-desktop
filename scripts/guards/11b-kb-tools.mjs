/**
 * 知识库工具「模型侧真的能调吗」判据（2026-10-04）
 *
 * ⛔ 起因：用户让模型自检「读/写/索引」三项，模型回「三个都做不到 ❌unsupported call」。
 *   ⇒ 光看 `dispatch-core.ts` 里有这两个工具名**不足以证明可用**。
 *
 * ⛔⛔ 这条判据的形状（两次踩坑换来的）：
 *   ① 判「工具名在源码里」≠ 模型能用（上一轮我就是这么判错的）。
 *   ② 判「MCP 配置里有这个 server」≠ 它暴露了这些工具。
 *   ⇒ 权威只能是 `tools/list` 的返回；而 tools/list 返回的就是 `dispatchMcpTools()`。
 *
 * ⛔⛔ 桩不许抛（铁律：桩一抛 ⇒ 后面上千条断言全不执行，看着像"只有一两条红"
 *   实际是整片假绿）。我第一版 `import(dist-electron/features/dispatch-rpc.js)`
 *   ⇒ 其 require 链拉起 `phone-harness.js` → `electron_1.app.name`，
 *   在 node 里 `app` 是 undefined ⇒ **整份判据崩**。
 *   ⇒ 本判据**只加载 dispatch-core**（纯数据、无 electron 依赖）；
 *   端到端那层降级为**静态核对 MCP 配置**（不起真 server）——
 *   宁可少验一层，也不能让判据整体挂掉。
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log(`  ${c ? "✓" : "✗"} 【kbtool】${m}`); if (!c) fails++; };

/** 安全加载：失败只报一行、返回 null（⛔ 绝不 rethrow —— 那会让判据整体崩）。 */
async function safeImport(rel) {
  try {
    return await import(`file://${join(ROOT, rel).replace(/\\/g, "/")}?t=${Date.now()}`);
  } catch (e) {
    console.log(`  ⚠ 【kbtool】加载 ${rel} 失败：${String(e?.message ?? e).slice(0, 110)}`);
    return null;
  }
}

// ── 1. 权威口径：tools/list 返回的就是 dispatchMcpTools() ──
const core = await safeImport("dist-electron/features/dispatch-core.js");
const list = core?.dispatchMcpTools?.() ?? [];
const names = list.map((t) => t.name);

ok(Array.isArray(list) && list.length > 0, `dispatchMcpTools() 返回 ${list.length} 个工具`);
ok(names.includes("knowledge_search"), "tools/list 里有 knowledge_search（读）");
ok(names.includes("knowledge_add"), "tools/list 里有 knowledge_add（写）");

// ⛔ 每项的 description 必须够长（模型靠它判断何时调用）；空描述 = 模型基本不会用。
//⛔ required 必须非空（否则模型乱传参 ⇒ 参数错 ⇒ 表现为"不支持"）。
for (const name of ["knowledge_search", "knowledge_add"]) {
  const t = list.find((x) => x.name === name);
  ok(Boolean(t?.description && t.description.length > 20),
    `${name} 有可用的 description（长度 ${t?.description?.length ?? 0}）`);
  ok(Boolean(t?.inputSchema?.required?.length),
    `${name} 的 inputSchema 有 required`);
}

// ── 2. MCP 配置层：这server 有没有被注册进 codex 的配置 ──
// ⛔ 降级说明：起真 server 需要 electron 宿主（桩会崩，见文件头），故只静态核对。
// ⛔ 名字我第一版写成了 `harness_dispatch`（下划线）⇒ 判据恒红。
//   真名是 **`harness-dispatch`（连字符）**，见 boot.ts 的 `[mcp_servers.harness-dispatch]`。
//   ⇒ 教训：判据里的**标识符必须从源码抄**，不能凭"大概是下划线"写 —— 那是恒红的制造机。
const boot = readFileSync(join(ROOT, "electron", "features", "boot.ts"), "utf8");
ok(/\[mcp_servers\.harness-dispatch\]/.test(boot),
  "boot 会把 harness-dispatch MCP server 写进 codex 配置（不写 = 模型永远看不到这些工具）");
// ⛔ 端口必须用**常量插值**（源码是模板串 `${DISPATCH_FIXED_PORT}`，运行时才成数字）。
//   ⇒ 判据查"有没有用这个常量"，而不是查字面 URL —— 源码里根本不存在数字形态。
ok(
  /\[mcp_servers\.harness-dispatch\][^`]*\$\{DISPATCH_FIXED_PORT\}/.test(boot),
  "MCP 配置的 url 用的是 DISPATCH_FIXED_PORT 常量（写死端口号 ⇒ 改端口即断链）",
);

// ⚠️ 失败模式的对照说明：`unsupported call` 有两种成因，静态核对只能排除第二种。
//   ① MCP server 没起/端口错位→ 引擎连不上，一个工具都调不到。
//   ② 工具没在 tools/list 里 → 只这一个工具调不到。
//   ⇒ 真要区分必须起真 server（要electron 宿主）。这里至少钉住"配置里有注册"。
const portConst = core?.DISPATCH_FIXED_PORT;
ok(Number.isInteger(portConst) && portConst > 0,
  `dispatch 固定端口已导出（${portConst}）—— 配置里的端口要与代码一致，否则连不上`);

// ── 3. 反向：新增工具时最容易漏的同步点 ──
// ⛔ 能力清单是**生成物**，且它的 DOMAIN_DESCRIPTIONS 决定模型看不看得懂这个工具。
const gen = readFileSync(join(ROOT, "scripts", "gen-capability-skill.mjs"), "utf8");
ok(gen.includes("knowledge_add") && gen.includes("knowledge_search"),
  "生成器里登记了这两个工具（能力清单是生成物：不在生成器里 ⇒ 下次生成就被抹掉）");
ok(existsSync(join(ROOT, "docs", "KNOWLEDGE-BASE.md")), "索引规范文档在（docs/KNOWLEDGE-BASE.md）");

console.log(`\n【kbtool】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
