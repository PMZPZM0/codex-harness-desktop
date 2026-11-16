/**
 * 12bu-artcraft —— Craft 全家桶（ArtCraft Launcher）全链路守卫（11-16）。
 *
 * 用户令：「photocraft 是不是还有几个配套开源，看看 GitHub 仓库」→ 查明是 Craft App Suite（18 个 App），
 * 再令「可以做成 123 级弹窗，开发工具界面一个 Craft 全家桶，弹窗里细分到每个 App 一个弹窗」。
 *
 * 钉住：
 *   ① 只从官方 GitHub release 下载 Launcher 便携包（镜像序 + SHA256SUMS 校验）；
 *   ② IPC 三条通道（status / open / sync）+ 生成物 / registry / 组合表齐全；
 *   ③ MCP 段 `[mcp_servers.ArtCraft]` **只在网关真存在时**才写（11-16 实测上游 v0.19.2 还没随包出货网关）；
 *   ④ 三级弹窗：开发工具一张卡 → App 网格 → 单 App 弹窗（PhotoCraft 那一层复用完整卡片）；
 *   ⑤ 卸载删启动器目录并摘掉 MCP 段；许可 MIT/Apache-2.0，不冒充 ArtCraft 官方。
 *
 * ⛔ 独立守卫（不进 _ctx MODULES 计数），必须同时加进 package.json 的 check 链。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log(`  ${c ? "✓" : "✗"} 【artcraft】${m}`); if (!c) fails++; };
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const codeOnly = (s) => String(s)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const CORE = "electron/artcraft.ts";
const DOMAIN = "electron/features/artcraft-ipc.ts";
const SUITE = "src/features/settings-devtools/ArtCraftSuite.tsx";
const APPS = "src/features/settings-devtools/artcraft-apps.ts";
const DEVTOOLS = "src/features/settings-devtools/DevtoolsSettingsSection.tsx";

/* ── ① 安装链 ─────────────────────────────────────────────── */
{
  const core = codeOnly(read(CORE));
  ok(core.includes('ARTCRAFT_REPO = "storytold/craft-launcher"'), "来源锚定官方仓 storytold/craft-launcher");
  ok(/releases\/download\/v\$\{version\}\/\$\{asset\}/.test(core), "按目标版本下载 release 资产（⛔ 不永远 latest）");
  ok(/SHA256SUMS\.txt/.test(core) && /mirrorCandidates\(url\)/.test(core), "校验哈希来自官方 SHA256SUMS（镜像序取）");
  ok(/artcraft-launcher-\$\{version\}-windows-\$\{arch\}-portable\.zip/.test(core), "Windows 资产名与官方 release 一致（portable zip）");
  ok(/existingToolPath\("sevenzip", "7z\.exe"\)/.test(core) && /tarExecutable\(\)/.test(core), "解压走随包 7-Zip / 系统 tar（参数数组，不开 shell）");
  ok(/version\.txt/.test(core) && /artcraftInstalledVersion/.test(core), "版本文件落盘 + 已装版本读取");
  ok(/process\.platform === "darwin"[\s\S]{0,200}?getartcraft\.com/.test(core), "mac 不代装 .app，给官网指引");
  const dev = read("electron/features/dev-runtimes.ts");
  ok(/artcraft: \{ name: "Craft 全家桶（ArtCraft Launcher）"/.test(dev) && /marker: "artcraft-launcher\\\\version\.txt"/.test(dev),
    "开发工具运行时登记（marker = artcraft-launcher/version.txt）");
  const rt = read("electron/features/runtime-ipc.ts");
  ok(/artcraft: \{ repo: ARTCRAFT_REPO[^}]*platforms: \["win32"\]/.test(rt), "GITHUB_UPDATEABLE 更新链登记（仅 win32）");
  ok(/id === "artcraft"\)[\s\S]{0,400}?installArtCraftFromGitHub[\s\S]{0,200}?refreshConfigForGatewayTools/.test(rt),
    "安装分派接入 GitHub 直下型，装完重写 config");
  ok(/id === "artcraft"\) return artcraftInstalledVersion\(\)/.test(rt), "已装版本按 Launcher 的 version.txt 读");
  ok(/id === "artcraft"\) \{[\s\S]{0,220}?removeArtCraftMcpSection\(\)[\s\S]{0,220}?restartServerWhenIdle/.test(rt),
    "卸载后摘掉 MCP 段（不依赖 config 重建时序）并重启引擎");
  const pkg = JSON.parse(read("package.json"));
  ok(!(pkg.build?.extraResources ?? []).some((entry) => JSON.stringify(entry).includes("artcraft")),
    "⛔ 不随包（第三方应用安装器：随包会把外部 App 分发塞进安装包，且 mac/linux 资产形态不同）");
}

/* ── ② IPC 域 ─────────────────────────────────────────────── */
{
  const dom = codeOnly(read(DOMAIN));
  ok(["status", "open", "sync"].every((name) => dom.includes(`artcraft:${name}`)), "IPC 三条通道齐全（status/open/sync）");
  ok(/gatewayReady: Boolean\(gateway\)/.test(dom) && /configSnippet: artcraftConfigSnippet\(\)/.test(dom),
    "status 回报网关就绪 / MCP 段 / 配置片段");
  ok(/if \(gatewayReady && !artcraftMcpRegistered\(\)\) await rewriteConfig\(\)/.test(dom),
    "sync 只在「网关就绪且未写入」时重写 config（不空转）");
  ok(/await import\("\.\/custom-model-apply"\)/.test(dom), "重写走 applyCustomModel（MCP 段的唯一来源）");
  ok(!/restartServerWhenIdle/.test(dom), "⛔ sync 不擅自重启引擎（交给用户重启；卡片写明）");
  const preload = read("electron/preload.ts");
  ok(["artcraftStatus", "artcraftOpen", "artcraftSync"].every((name) => preload.includes(`${name}:`)), "preload 桥已生成三个方法（跑过 gen:ipc）");
  const manifest = read("electron/ipc-channels.manifest.json");
  ok((manifest.match(/"channel": "artcraft:/g) || []).length === 3, "manifest 三条通道");
  const registry = read("electron/ipc-registry.ts");
  ok(/\{ prefix: "artcraft", count: 3, status: "in-features"/.test(registry), "registry 记账（3 通道）");
  ok(/"id": "artcraft"[\s\S]{0,120}?"enabled": true/.test(read("electron/composition.json")), "组合表启用 artcraft 域");
  ok(/artcraft/.test(read("electron/builtin-skills/14-skill-harness-api.ts")), "能力清单技能已含 artcraft 域（跑过 gen:ipc）");
}

/* ── ③ 网关与 MCP 段（条件式） ─────────────────────────────── */
{
  const core = codeOnly(read(CORE));
  ok(/LOCALAPPDATA[\s\S]{0,160}?"ArtCraft", "mcp", "bin"/.test(core), "网关候选含 %LOCALAPPDATA%\\ArtCraft\\mcp\\bin");
  ok(/export function craftAiMcpPath\(\)[\s\S]{0,240}?return "";/.test(core), "网关不存在时返回空（不假装就绪）");
  ok(/if \(!snippet\) return \[\];/.test(core), "⛔ 网关不存在 ⇒ MCP 段整段不写");
  ok(/mcp_servers\.\$\{ARTCRAFT_MCP_SERVER\}/.test(core), "MCP 段头用服务器名常量（单一来源）");
  ok(/args = \["--stdio"\]/.test(core), "args 与上游 mcp_config.rs 一致（--stdio）");
  ok(/startup_timeout_sec = 30/.test(core), "网关启动留 30s 超时");
  ok(/name === "mcp_servers\.ArtCraft" \|\| name\.startsWith\("mcp_servers\.ArtCraft\."\)/.test(core), "卸载删除含子表的整段");
  const apply = read("electron/features/custom-model-apply.ts");
  ok(/import \{[^}]*artcraftMcpSection[^}]*\} from "\.\.\/artcraft"/.test(apply) && /\.\.\.artcraftMcpSection\(\)/.test(apply),
    "config 生成时拼入 ArtCraft 段（网关存在才非空）");
  ok(/ARTCRAFT_MCP_SERVER, \.\.\.connectors/.test(apply) && /delete mcpOverrides\[ARTCRAFT_MCP_SERVER\]/.test(apply),
    "ArtCraft 段登记为 harness 所属并清掉旧覆盖快照（卸载后不被当用户段复活）");
}

/* ── ④ 三级弹窗 UI ─────────────────────────────────────────── */
{
  const devtools = read(DEVTOOLS);
  ok(/key: "artcraft"/.test(devtools) && /title: "Craft 全家桶"/.test(devtools), "层级 1：开发工具页一张「Craft 全家桶」卡");
  ok(/openCard === "artcraft"[\s\S]{0,400}?<ArtCraftSuite/.test(devtools), "层级 2：点卡打开 ArtCraftSuite 弹窗");
  ok(!/PhotoCraftCard/.test(devtools) && !/key: "photocraft"/.test(devtools), "PhotoCraft 独立卡已收进全家桶（⛔ 不再另起一张）");
  const suite = read(SUITE);
  ok(/CRAFT_APPS\.map/.test(suite) && /setSelectedApp\(item\.key\)/.test(suite), "层级 2：App 网格逐项可点");
  ok(/craftAppByKey\(selectedApp\)/.test(suite) && /title=\{app\.name\}/.test(suite), "层级 3：点 App 再开一层弹窗");
  ok(/<PhotoCraftCard/.test(suite), "PhotoCraft 的层级 3 复用完整卡片（工具 / MCP / GUI 入口不丢）");
  ok(/RuntimeUpdateRow[\s\S]{0,200}?id="artcraft"/.test(suite), "层级 2 有独立更新行（GitHub 直下型）");
  ok(/artcraftSync\(\)/.test(suite) && /复制配置/.test(suite), "网关就绪后给「写入配置 / 复制配置」");
  ok(/等待 Launcher 新版/.test(suite), "网关未出货时如实显示等待状态（不假装可用）");
  const apps = read(APPS);
  const names = (apps.match(/name: "[^"]+"/g) || []).length;
  ok(names >= 19, `App 目录覆盖套件（实到 ${names} 条；17 官方 + 2 社区 = 19）`);
  ok(/key: "photocraft"[\s\S]{0,600}?integrated: true/.test(apps), "目录标注 PhotoCraft 已接入");
  ok(/CRAFT_APPS\.find/.test(apps), "目录提供按 key 查找（层级 3 单一真相源）");
  ok(/19 个创作 App/.test(devtools) && /19 个开源|19 个创作 App/.test(suite),
    "界面文案与目录条数一致（19 个 = 17 官方 + 2 社区；⛔ 不是 18）");
  const groups = read("src/features/settings-devtools/runtime-groups.tsx");
  ok(/DEDICATED_IDS = \[[^\]]*"artcraft"/.test(groups), "专用卡片不重复进分类列表");
  const css = read("src/styles/12-settings-skills.css");
  ok(/\.craft-app-grid \{/.test(css) && /\.craft-app-tile \{/.test(css), "App 网格样式在位（含窄屏降列）");
}

/* ── ⑤ 验收、文档与合规 ───────────────────────────────────── */
{
  ok(/id: "artcraft"/.test(read("scripts/accept.mjs")), "验收项已登记（accept.mjs）");
  ok(/id: "photocraft"[\s\S]{0,900}?Craft 全家桶/.test(read("scripts/accept.mjs")), "PhotoCraft 验收已改走三级入口");
  const notices = read("THIRD_PARTY_NOTICES.md");
  ok(/storytold\/craft-launcher/.test(notices) && /Apache-2\.0/.test(notices), "第三方声明登记来源与许可");
  ok(/不冒充/.test(notices), "声明不冒充 ArtCraft 官方");
  ok(/Craft 全家桶/.test(read("AGENTS.md")), "AGENTS.md 有 Craft 全家桶条目");
  ok(/"artcraft"/.test(read("scripts/gen-capability-skill.mjs")), "能力清单生成器有 artcraft 域描述");
}

console.log(`\n【artcraft】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
