/**
 * REA 逆向分析 + 内置专家「洞见」判据（10-13 立）
 *
 * 源：morluto/rea「REA: Reverse Engineer Anything」（npm rea-agents，MIT，~100MB 实测 > 50MB 内置线）。
 * 用户令三条：「内置一个专家」「开发工具按需下载、下载后才可以用这个专家」「MCP 支持国内镜像源更新」。
 *
 * 失效方式全是有害且静默的：
 *   · MCP 注册条件漏掉「包已装」⇒ 未装用户拿到一个起不来的服务器（引擎整份配置报错连坐）；
 *   · command 写裸 `rea` ⇒ 安装包里 PATH 没有它，静默起不来（nuphus / computer-use 同款坑）；
 *   · 可用性过滤放进**写路径** ⇒ REA 未装时保存任何专家会把隐藏专家从存档里永久删掉；
 *   · 更新链漏登记 ⇒ 「设置 → 自动化」的镜像更新对这个包失效（用户点名要的国内镜像更新）。
 * 行为（真实 npm 安装 / MCP 握手）由开发工具安装链与用户实测覆盖；本守卫钉结构、登记与口径。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnly } from "./_ctx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【rea-expert】${message}`);
  if (!condition) fails++;
};

/* ── 一、专家本体（16-reverse-engineering-expert）────────────────────── */
{
  const expert = read("electron/expert-teams/16-reverse-engineering-expert.ts");
  ok(/teamId: "reverse-engineering-expert"/.test(expert) && /洞见/.test(expert),
    "专家 teamId=reverse-engineering-expert，名字「洞见」");
  ok(/requiresTool: "rea"/.test(expert), "⛔ requiresTool=rea（未安装整队隐藏 —— 用户令「下载后才可以用」）");
  ok(/registry\.npmmirror\.com/.test(expert) && /runtime:install|开发工具/.test(expert),
    "SOP Phase 0 自助安装走 npmmirror 镜像 + 指引开发工具卡片");
  ok(/Hopper \/ Ghidra \/ IDA/.test(expert) && /如实告知|明说/.test(expert),
    "⛔ 能力边界如实写进 SOP（原生二进制需外挂引擎，没装不许假装完成）");
  ok(/拥有或获授权/.test(expert), "⛔ 合规边界写进 SOP（只分析拥有/获授权的软件）");
  const defaults = read("electron/expert-teams/07-team-default.ts");
  ok(/reverseEngineeringExpert\(mk\)/.test(defaults), "注册进 buildDefaultExpertTeams");
  const barrel = read("electron/expert-teams.ts");
  ok(barrel.includes('reverseEngineeringExpert } from "./expert-teams/16-reverse-engineering-expert"')
    && barrel.includes("readUsableExpertTeams"), "barrel 导出专家与可用读口径");
}

/* ── 二、可用读 / 原始读口径（⛔ 写路径绝不能吃过滤）──────────────────── */
{
  const fileIo = read("electron/expert-teams/02-team-file-io.ts");
  ok(/export async function readUsableExpertTeams/.test(fileIo) && /reaServerScript\(\)/.test(fileIo),
    "readUsableExpertTeams = 原始读 + requiresTool 过滤（rea → reaServerScript 存在性）");
  ok(/export async function readExpertTeams\(\)[\s\S]*?return Array\.isArray\(list\) \? list : \[\];/.test(fileIo)
    && fileIo.indexOf("readUsableExpertTeams") > fileIo.indexOf("export async function readExpertTeams"),
    "⛔ readExpertTeams 保持原始读（不过滤 —— 写路径与启动播种用它）");
  ok(/toolAvailable\(tool === "rea"\)/.test(fileIo) || /tool === "rea"/.test(fileIo),
    "可用性判据按工具名单表驱动（新依赖型专家只加一行）");
  const mainTs = read("electron/main.ts");
  ok(/reverseEngineeringExpert\(normalizeTeamConfig\)\]/.test(mainTs),
    "main.ts 启动播种：每次启动确保「洞见」在存档（老用户也能拿到）");
  ok(/reverseEngineeringExpert, videoProductionTeam,/.test(mainTs), "main.ts import 已带新专家");
}

/* ── 三、开发工具按需下载（dev-runtimes + runtime-ipc）────────────────── */
{
  const spec = read("electron/features/dev-runtimes.ts");
  ok(/"kb-embedding" \| "rea"/.test(spec) || /"rea"/.test(spec), "DevRuntimeId 类型含 rea");
  ok(/rea: \{ name: "REA 逆向分析"/.test(spec) && /marker: "npm-global\\\\node_modules\\\\rea-agents\\\\package\.json"/.test(spec),
    "开发工具卡片：REA 逆向分析（marker = npm-global 的 rea-agents package.json）");
  ok(!/rea:[^}]*builtIn: true/.test(codeOnly(spec).replace(/rea: \{ name: "REA 逆向分析"[^}]*\}/, "")),
    "⛔ REA 不随包（100MB > 50MB 内置线，用户拍板按需下载）");
  ok(/约 100 MB/.test(spec), "卡片标注实测体积 约 100 MB");

  const rt = codeOnly(read("electron/features/runtime-ipc.ts"));
  ok(rt.includes('id === "rea"') && rt.includes('"rea-agents"'),
    "runtime:install 分支：rea → runNpmInstall(rea-agents)（npmmirror 优先 + 官方回落）");
  ok(/rea: \{ pkg: "rea-agents", label: "REA 逆向分析" \}/.test(rt),
    "⛔ UPDATEABLE_TOOLS 登记 rea（在线更新链 = 国内镜像优先，用户点名）");
  ok(/rea: \{ dirs: \["node_modules\/rea-agents"\], shims: \["rea", "rea-agents"\] \}/.test(rt),
    "卸载落点登记（包体 + rea / rea-agents 两个 shim —— 不登记就删不干净）");
}

/* ── 四、MCP 注册（custom-model-apply 生成块）────────────────────────── */
{
  const apply = codeOnly(read("electron/features/custom-model-apply.ts"));
  ok(apply.includes('"rea"') && apply.includes("ownedMcpServers = new Set([\"nuphus\", \"harness-dispatch\", HARNESS_UIA_MCP_SERVER, COMPUTER_USE_MCP_SERVER, \"rea\""),
    "ownedMcpServers 含 rea（harness 自管段，用户覆盖表不保留旧段）");
  ok(/\[mcp_servers\.rea\]/.test(apply) && apply.includes("reaServerScript()") && apply.includes('args = ["${escapeToml(script)}", "mcp"]'),
    "注册块：包已装才生成 [mcp_servers.rea]，command = 随包 node + rea.mjs + mcp");
  ok(/reaServerScript\(\);\s*const node = bundledNode\(\);\s*if \(!script \|\| !node/.test(apply),
    "⛔ 双前提：脚本与随包 node 任一缺失就整段不写（不注册起不来的服务器）");
  const toolchain = read("electron/toolchain.ts");
  ok(/export function reaServerScript\(\)/.test(toolchain) && /rea-agents", "scripts", "rea\.mjs/.test(toolchain),
    "toolchain.reaServerScript：定位 npm-global 的 rea.mjs，缺失返回空串");
}

/* ── 五、check 链登记 ────────────────────────────────────────────────── */
ok(JSON.parse(read("package.json")).scripts.check.includes("12h-rea-expert.mjs"), "package.json check 链已登记本守卫");

console.log(`\n【rea-expert】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
