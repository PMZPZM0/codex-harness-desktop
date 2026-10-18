/**
 * 连接器密钥「每次启动都注入引擎 env」的判据（10-19 立）
 *
 * 事故：知识库 MCP 累计 396 次 401（`missing bearer token`），且**每次重启后第一条就报**。
 * 根因：`connectorEnv(readConnectors())` 只在 `applyCustomModel` 里 `setExternalEnv`，
 * 而启动时它**只有 config 漂移才跑** ⇒ 配置没漂移的启动，引擎 env 里没有 `CLOUD_KB_MCP_TOKEN`
 * ⇒ 引擎连 MCP 时没有 bearer。改连接器的那次会话正常、重开应用就坏，正是这个形状。
 *
 * 判据（静态，运行时由「启动后 engine-debug.log 无 AuthRequired」实测）：
 *   ① boot 里**无条件**注入连接器 env（不在 openai-official 分支、不在漂移分支）；
 *   ② 注入点必须在 server.start() 之前（spawn 之后设对已起进程无效）；
 *   ③ 依赖还在（connectorEnv / readConnectors 来自 boot 的 deps，别退化成直连 main 的环）。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnly } from "./_ctx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const boot = codeOnly(readFileSync(join(ROOT, "electron", "features", "boot.ts"), "utf8"));

let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【connector-env】${message}`);
  if (!condition) fails++;
};

const inject = "server.setExternalEnv(connectorEnv(await readConnectors()));";
const at = boot.indexOf(inject);
ok(at >= 0, "boot.ts 无条件注入连接器 env（`server.setExternalEnv(connectorEnv(await readConnectors()))`）");

const startAt = boot.indexOf("server.start(");
ok(at >= 0 && startAt > at, `注入点在 server.start() 之前（注入 ${at} < start ${startAt}）`);

/* ② 不许只在 openai-official 分支里设：注入点前 600 字符内出现该分支判定 = 又退回条件注入 */
const before = at >= 0 ? boot.slice(Math.max(0, at - 600), at) : "";
ok(!/provider === "openai-official"/.test(before), "注入不是挂在 openai-official 分支里（普通供应商也要注入）");

/* ③ 依赖来源不退化 */
ok(/connectorEnv = deps\.connectorEnv/.test(boot) && /readConnectors = deps\.readConnectors/.test(boot),
  "connectorEnv / readConnectors 仍走 boot 的 deps 注入（⛔ 不许直连 ../main 成环）");

/* ④ cloud-kb 的令牌必须带 Bearer 前缀（引擎 env_http_headers 原样写进请求头，不会自动补）。
   实测：裸 token → 401 `missing bearer token`；带 Bearer → 200。
   ⛔ 云助手仓**没有** cloud-kb 域（该能力只在桌面版/PPcode）⇒ 文件不存在时显式说明并跳过，
      不静默（这是"本仓没有这个功能"，不是"实现坏了"）。 */
const kbIpcPath = join(ROOT, "electron", "features", "cloud-kb-ipc.ts");
if (!existsSync(kbIpcPath)) {
  console.log("  - 【connector-env】本仓没有 cloud-kb 域（跳过 Bearer 前缀两条；启动 env 注入仍由上面三条覆盖）");
} else {
  const kbIpc = codeOnly(readFileSync(kbIpcPath, "utf8"));
  ok(/\^Bearer\\s/.test(kbIpc) && /`Bearer \$\{rawToken\}`/.test(kbIpc),
    "cloud-kb 同步落盘前补 `Bearer ` 前缀（幂等：已是 Bearer 就不重复加）");
  ok(!/const token = String\(kb\.mcpToken \|\| ""\);/.test(kbIpc),
    "⛔ 负向：不许退回「直接存裸 token」（那会让 Authorization 变成 `mcp_…` → 服务端判没有 bearer）");
}

console.log(`\n【connector-env】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
