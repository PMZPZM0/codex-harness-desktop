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
  ok(rt.includes('id === "rea"') && /rea-agents@\$\{REA_PINNED_VERSION\}/.test(rt),
    "⛔ runtime:install 分支：rea → runNpmInstall(rea-agents@pin)（锁与内置 Node 兼容的版本）");
  ok(/rea: \{ pkg: "rea-agents", label: "REA 逆向分析", pin: REA_PINNED_VERSION \}/.test(rt),
    "⛔ UPDATEABLE_TOOLS 登记 rea + pin（不追 6.8.0+ 那个一启动就 exit 1 的 latest）");
  ok((rt.match(/if \(tool\.pin\)/g) || []).length >= 1 && /version: tool\.pin/.test(rt),
    "⛔ pin 贯通「检查更新」与「在线安装」两条路径（漏一处就会装回 @latest）");
  ok(/runtimeInstalled\(id, spec\) && \(id !== "rea" \|\| Boolean\(reaServerScript\(\)\)\)/.test(rt),
    "⛔ 安装复核（11-14）：rea 除 marker 外还要过 reaServerScript 三查，半截安装不许报成功");
  ok(/if \(id === "rea" && !reaServerScript\(\)\) return "";/.test(rt),
    "⛔ 更新链自愈（11-07）：installedVersionOf 对 rea 以就绪口径回报 —— dist 被掏空时当作未装，hasUpdate=true 触发重装（否则版本号还在就判「已是最新」永久卡死）");
  ok(/rea: \{ dirs: \["node_modules\/rea-agents"\], shims: \["rea", "rea-agents"\] \}/.test(rt),
    "卸载落点登记（包体 + rea / rea-agents 两个 shim —— 不登记就删不干净）");
}

/* ── 四、MCP 注册（custom-model-apply 生成块）────────────────────────── */
{
  const apply = codeOnly(read("electron/features/custom-model-apply.ts"));
  ok(/ownedMcpServers = new Set\(\[[^\]]*"rea"[^\]]*\]\)/.test(apply),
    "ownedMcpServers 含 rea（harness 自管段，用户覆盖表不保留旧段）");
  ok(/\[mcp_servers\.rea\]/.test(apply) && apply.includes("reaServerScript()") && apply.includes('args = ["${escapeToml(script)}", "mcp"]'),
    "注册块：包已装才生成 [mcp_servers.rea]，command = 随包 node + rea.mjs + mcp");
  ok(/reaServerScript\(\);\s*const node = bundledNode\(\);\s*if \(!script \|\| !node/.test(apply),
    "⛔ 双前提：脚本与随包 node 任一缺失就整段不写（不注册起不来的服务器）");
  const toolchain = codeOnly(read("electron/toolchain.ts"));
  ok(/export function reaServerScript\(\)/.test(toolchain) && /rea-agents", "scripts", "rea\.mjs/.test(toolchain),
    "toolchain.reaServerScript：定位 npm-global 的 rea.mjs，缺失返回空串");
  ok(/export function reaServerScript\(\)\s*\{[\s\S]*?npmPackagePath\("rea-agents", "package\.json"\)[\s\S]*?npmPackagePath\("rea-agents", "dist", "mcp", "main\.js"\)\s*\?\s*script\s*:\s*""/.test(toolchain),
    "⛔ 就绪三查（11-14）：package.json + rea.mjs + dist/mcp/main.js 齐才算能用的安装（真机半截安装：main.js 在但前两个没了）");
}

/* ── 六、模型侧工具面：网关（11-14，⛔ 引擎 0.157+ 延迟暴露 MCP 工具）───── */
{
  const gw = read("electron/rea-gateway.ts");
  ok(/export const REA_PINNED_VERSION = "6\.7\.0"/.test(gw) && /24\.22\.1/.test(gw),
    "⛔ 锁版本 6.7.0 且写明原因（随包 Node v24.19.0 < 6.8.0+ 的 engines 下限）");
  ok(/export function reaGatewaySpec\(\)[\s\S]*?name: REA_GATEWAY_TOOL[\s\S]*?rawName: REA_GATEWAY_MARK/.test(gw),
    "⛔ 只暴露一个网关工具（207 个工具整批进 dynamicTools 会撑爆 prompt 前缀）");
  ok(/action: \{ type: "string", enum: \["list", "describe", "call"\]/.test(gw),
    "网关按 list / describe / call 渐进披露");
  ok(/async function ensureSession[\s\S]*?if \(active && active\.command === command/.test(gw)
    && /resetSession\(\);\s*return \{ ok: false/.test(gw),
    "⛔ 持久 stdio 会话（REA 分析/调试状态跨调用）；失败只重置、不自动重试有状态工具");
  const bridge = read("electron/mcp-bridge.ts");
  ok(/export function openStdio/.test(bridge) && /export type StdioSession/.test(bridge),
    "stdio 分帧器单一真相源：rea-gateway 动态 import 复用 openStdio（不复制一份）");
  ok(/const withReaBridge =/.test(bridge) && (bridge.match(/return withReaBridge\(/g) || []).length === 2,
    "⛔ REA 网关挂进 listMcpDynamicTools 的两条返回路径（缓存命中 / 重新握手）⇒ thread/start 与 resume 自动覆盖");
  ok(/if \(isReaGatewaySpec\(spec\)\)[\s\S]*?return callReaGateway\(/.test(bridge),
    "⛔ callMcpTool 对网关分流（不能走短命 withStdio，会丢分析状态）");
  const driftFn = /export function reaMcpDrifted\(configText: string, ready: boolean\): boolean \{([\s\S]*?)\n\}/.exec(gw);
  ok(Boolean(driftFn), "reaMcpDrifted 是纯函数（可被守卫真跑）");
  if (driftFn) {
    let drifted = null;
    try { drifted = new Function("configText", "ready", driftFn[1]); } catch { /* 语法变了就报红 */ }
    ok(Boolean(drifted), "reaMcpDrifted 函数体可独立执行（无 electron / 路径依赖）");
    if (drifted) {
      const host = '[mcp_servers.rea]\ncommand = "C:/app/node.exe"\nargs = ["C:/app/scripts/rea.mjs", "mcp"]\n\n[other]\nx = 1';
      const external = '[mcp_servers.rea]\ncommand = "cmd.exe"\nargs = ["/d", "/c", "npx -y rea-agents@6.5.0 mcp"]';
      const none = '[other]\nx = 1';
      ok(drifted(host, true) === false, "真跑①：宿主形态 + 包就绪 ⇒ 不漂移（幂等，不每次启动重写）");
      ok(drifted(external, true) === true, "真跑②：上游 install.sh 的 npx 形态 ⇒ 触发自愈重写");
      ok(drifted(none, true) === true, "真跑③：包就绪但缺段 ⇒ 触发补写");
      ok(drifted(external, false) === true, "真跑④：包未就绪却残留段 ⇒ 触发清理");
      ok(drifted(none, false) === false, "真跑⑤：包未就绪且无段 ⇒ 不漂移");
    }
  }
  const delegation = read("electron/features/delegation.ts");
  ok(/const reaSpec = reaGatewaySpec\(\)/.test(delegation)
    && /\.\.\.\(reaSpec \? toDynamicTools\(\[reaSpec\]\) : \[\]\)/.test(delegation),
    "⛔ 被委派专家会话（主进程直发 thread/start，不经过 codex-ipc 合并）也挂 rea__gateway —— 否则「洞见」拿不到任何逆向工具");
  ok(/if \(leadOfTeam \|\| reaSpec\)/.test(delegation),
    "⛔ 复用中的专家会话也同步工具面（装包前建的会话不会永久缺 REA）");
  const boot = read("electron/features/boot.ts");
  ok(/const reaMcpBad = reaMcpDrifted\(configText, reaReady\)/.test(boot)
    && /\|\| reaMcpBad\)/.test(boot),
    "⛔ boot 的 config drift 判据纳入 rea 段形态（否则外部 npx 段永远不自愈）");
  ok(/reaMcpDrifted\(cleaned, Boolean\(reaServerScript\(\) && bundledNode\(\)\)\)/.test(boot),
    "⛔ 无自定义模型分支也清理外部形态 rea 段（两条启动路径都收敛）");
}

ok(/id: "rea",/.test(read("electron/update-registry.ts")) && /REA 逆向分析（洞见专用）/.test(read("electron/update-registry.ts")),
  "控制台组件更新清单登记 rea（npm-tool + 镜像；后端复用 UPDATEABLE_TOOLS 的镜像更新链）");

/* ── 五、check 链登记 ────────────────────────────────────────────────── */
ok(JSON.parse(read("package.json")).scripts.check.includes("12h-rea-expert.mjs"), "package.json check 链已登记本守卫");

console.log(`\n【rea-expert】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
