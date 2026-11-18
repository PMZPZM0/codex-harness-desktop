/**
 * 12bu-artcraft —— Craft 全家桶（ArtCraft Launcher）全链路守卫（11-16）。
 *
 * 用户令：「photocraft 是不是还有几个配套开源」→ 查明是 Craft App Suite；
 *   「可以做成 123 级弹窗，开发工具界面一个 Craft 全家桶，弹窗里细分到每个点击一个弹窗」；
 *   「保留 ArtCraft Launcher 入口…安装后要做好联动，工具都拆开」。
 *
 * 钉住：
 *   ① 只从官方 GitHub release 下载 Launcher 便携包（镜像序 + SHA256SUMS 校验）；
 *   ② IPC 五条通道（status / open / sync / run / pick-root）+ 生成物 / registry / 组合表齐全；
 *   ③ 工具按 App 拆开：每个已装 App 一条 `[mcp_servers.<id>]` + 独立工具 `craft_<id>`
 *      （⛔ 不再是「一个网关覆盖全部」）；
 *   ④ 联动：扫描 Launcher 安装目录得已装列表（含版本 / CLI），装完回来自动显示已安装并同步配置；
 *   ⑤ 三级弹窗：卡 → App 网格 → 单 App 详情（与 PhotoCraft 同构、19 个 App 都有「能做什么」）；
 *   ⑥ 卸载删启动器目录并摘掉所有 App MCP 段；许可 MIT/Apache-2.0，不冒充 ArtCraft 官方。
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
const TOOL = "src/features/app-state/parts/part08/01-seg.tsx";
const DISPATCH = "src/features/app-state/parts/part05/event-router/02-request.tsx";

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
  ok(/id === "artcraft"\) \{[\s\S]{0,220}?removeCraftAppMcpSections\(\)[\s\S]{0,220}?restartServerWhenIdle/.test(rt),
    "卸载后摘掉全部 App MCP 段（不依赖 config 重建时序）并重启引擎");
  const pkg = JSON.parse(read("package.json"));
  ok(!(pkg.build?.extraResources ?? []).some((entry) => JSON.stringify(entry).includes("artcraft")),
    "⛔ 不随包（第三方应用安装器：随包会把外部 App 分发塞进安装包，且 mac/linux 资产形态不同）");
}

/* ── ② IPC 域（5 通道） ────────────────────────────────────── */
{
  const dom = codeOnly(read(DOMAIN));
  ok(["status", "open", "sync", "run", "pick-root"].every((name) => dom.includes(`artcraft:${name}`)), "IPC 五条通道齐全（status/open/sync/run/pick-root）");
  ok(/installedApps: await listInstalledCraftApps\(\)/.test(dom) && /mcpServers: craftAppMcpServers\(\)|servers, "photocraft"/.test(dom),
    "status 下发已装 App 列表 + 已写入的独立 MCP 名单");
  ok(/photocraftCliPath\(\) && photocraftMcpRegistered\(\)/.test(dom) && /servers, "photocraft"/.test(dom),
    "PhotoCraft 也算「已接入」（走自己的 photocraft MCP；⛔ 不再出现「装 3 个只接 2 个」）");
  ok(/await rewriteConfig\(\);[\s\S]{0,120}?return \{ servers: craftAppMcpServers\(\) \}/.test(dom),
    "sync 重写 config 并回报服务器名单");
  ok(/isInsideOrEqualTrustedRoots/.test(dom) && /输出不能与输入同一路径/.test(dom), "run 的路径闸 + ⛔ 输出不覆盖输入");
  ok(/total > 20000/.test(dom) && !/65536/.test(dom), "run 命令参数合计 ≤20KB（Windows 命令行上限）");
  ok(/await import\("\.\/custom-model-apply"\)/.test(dom), "重写走 applyCustomModel（MCP 段的唯一来源）");
  ok(!/restartServerWhenIdle/.test(dom), "⛔ sync 不擅自重启引擎（交给用户重启；卡片写明）");
  const preload = read("electron/preload.ts");
  ok(["artcraftStatus", "artcraftOpen", "artcraftSync", "artcraftRun", "artcraftPickRoot"].every((name) => preload.includes(`${name}:`)), "preload 桥已生成五个方法（跑过 gen:ipc）");
  const manifest = read("electron/ipc-channels.manifest.json");
  ok((manifest.match(/"channel": "artcraft:/g) || []).length === 5, "manifest 五条通道");
  const registry = read("electron/ipc-registry.ts");
  ok(/\{ prefix: "artcraft", count: 5, status: "in-features"/.test(registry), "registry 记账（5 通道）");
  ok(/"id": "artcraft"[\s\S]{0,120}?"enabled": true/.test(read("electron/composition.json")), "组合表启用 artcraft 域");
  ok(/artcraft/.test(read("electron/builtin-skills/14-skill-harness-api.ts")), "能力清单技能已含 artcraft 域（跑过 gen:ipc）");
}

/* ── ③ 按 App 拆分的 MCP 段（⛔ 不要统一网关） ─────────────── */
{
  const core = codeOnly(read(CORE));
  ok(/ProgramFiles/.test(core) && /"ArtCraft"/.test(core), "安装根扫描含 %ProgramFiles%\\ArtCraft");
  const domSrc = codeOnly(read(DOMAIN));
  ok(/CRAFT_APP_IDS/.test(core) && /readLauncherInstallRoots/.test(core) && /app\.ron/.test(core)
    && /craftAppSiblingRoots/.test(core) && /readCraftRootSetting/.test(core),
    "11-17 安装识别加宽：已知 App 名 + Launcher 记录的 install_locations + per-user Programs + 手动指定的根");
  ok(/roots: craftScanRoots\(\)/.test(domSrc) && /customRoot: readCraftRootSetting\(\)/.test(domSrc)
    && /artcraft:pick-root/.test(domSrc) && /showOpenDialog/.test(domSrc),
    "status 回传扫描根 + 手动安装位置通道（pick-root 走目录选择器）");
  ok(/artcraftPickRoot/.test(read("src/features/settings-devtools/ArtCraftSuite.tsx")) && /安装位置/.test(read("src/features/settings-devtools/ArtCraftSuite.tsx")),
    "界面有「安装位置」入口（识别不到时手动指定，任意盘都行）");
  /* 11-17 用户实测「Launcher 下载只有 1MB/s」：ureq 只认环境变量，系统代理要由我们注入。 */
  ok(/systemProxyForLauncher/.test(core) && /HTTPS_PROXY/.test(core) && /ALL_PROXY/.test(core)
    && /openArtCraftLauncher[\s\S]{0,1400}?env/.test(core) && /proxy: systemProxyForLauncher\(\)/.test(domSrc),
    "打开 Launcher 时注入系统代理（HTTPS_PROXY/ALL_PROXY）并在状态里回报（下载慢时可提速）");
  ok(/scutil/.test(core) && /HTTPSEnable/.test(core) && /SOCKSProxy/.test(core),
    "macOS 系统代理走 scutil --proxy（HTTP/HTTPS/SOCKS 都认）");
  ok(/process\.platform === "darwin"[\s\S]{0,120}?\/Applications/.test(core) && /homedir\(\)[\s\S]{0,60}?Applications/.test(core),
    "mac 扫描 /Applications 与 ~/Applications");
  ok(core.includes(".app$/i") && core.includes("Contents") && core.includes("MacOS")
    && core.includes("-cli(") && /const isCli/.test(core),
    "mac 的 .app 包：去掉后缀认名字、可执行文件在 Contents/MacOS、*-cli 无后缀也认");
  ok(/CFBundleShortVersionString/.test(core), "mac 版本读 .app/Contents/Info.plist（CFBundleShortVersionString）");
  ok(/macLauncherApp/.test(core) && /ArtCraft Launcher\.app/.test(core) && /macAppExecutable/.test(core)
    && /\.endsWith\(\"\.app\"\)/.test(core),
    "mac 识别 .app 并直接 spawn 包内可执行文件（`open -a` 经 launchd 会丢代理环境变量）");
  ok(/process\.platform === \"darwin\"\) return \"\"/.test(core) && /本应用不代装/.test(core),
    "mac 不在应用内下载 Launcher（.app 由官网安装，宿主只识别）");
  ok(/安装位置/.test(read("src/features/settings-devtools/ArtCraftSuite.tsx"))
    && /修改位置/.test(read("src/features/settings-devtools/ArtCraftSuite.tsx")),
    "App 详情弹窗展示安装位置并可修改（PhotoCraft 与其它 App 同一个弹窗）");
  ok(/function scanCraftAppDirs[\s\S]{0,1400}?cliPath: cli/.test(core), "扫描记录主程序 + *-cli.exe");
  ok(/ARTCRAFT_EXE/.test(core) && /VersionInfo\.ProductVersion/.test(core),
    "版本读 exe VERSIONINFO（路径经环境变量传入，⛔ 不进 PowerShell 源码）");
  ok(/\[mcp_servers\.\$\{app\.id\}\]/.test(core), "每个已装 App 一条独立 [mcp_servers.<id>]");
  ok(/'args = \["mcp"\]'/.test(core), "MCP 走该 App 自己的无头 CLI（mcp 子命令）");
  ok(/artcraft-mcp-servers\.json/.test(core), "MCP 名单落账（删 App 后据此清旧段）");
  ok(/export function removeCraftAppMcpSections/.test(core) && /server\.startsWith\(`\$\{id\}\.`\)/.test(core),
    "卸载删除每个 App 的段（含子表）");
  ok(!/mcp_servers\.ArtCraft|craft-ai-mcp|ARTCRAFT_MCP_SERVER/.test(core), "⛔ 不再有统一网关段（用户令：不容易区分）");
  const apply = read("electron/features/custom-model-apply.ts");
  ok(/import \{ craftAppMcpPlan \} from "\.\.\/artcraft"/.test(apply) && /\.\.\.craftPlan\.sections/.test(apply),
    "config 生成时拼入每个 App 的段（按安装状态增删）");
  ok(/\.\.\.craftPlan\.servers, \.\.\.craftPlan\.previous/.test(apply) && /delete mcpOverrides\[server\]/.test(apply),
    "App 段登记为 harness 所属并清掉旧覆盖快照（卸载后不复活）");
}

/* ── ④ 三级弹窗 + 联动 ─────────────────────────────────────── */
{
  const devtools = read(DEVTOOLS);
  ok(/key: "artcraft"/.test(devtools) && /title: "Craft 全家桶"/.test(devtools), "层级 1：开发工具页一张「Craft 全家桶」卡");
  ok(/openCard === "artcraft"[\s\S]{0,400}?<ArtCraftSuite/.test(devtools), "层级 2：点卡打开 ArtCraftSuite 弹窗");
  ok(!/PhotoCraftCard/.test(devtools) && !/key: "photocraft"/.test(devtools), "PhotoCraft 独立卡已收进全家桶（⛔ 不再另起一张）");
  const suite = read(SUITE);
  ok(/CRAFT_APPS\.map/.test(suite) && /setSelectedApp\(item\.key\)/.test(suite), "层级 2：App 网格逐项可点");
  ok(/craftAppByKey\(selectedApp\)/.test(suite) && /title=\{app\.name\}/.test(suite), "层级 3：点 App 再开一层弹窗");
  ok(!/PhotoCraftCard/.test(suite) && /app\.key === "photocraft" \? "photocraft"/.test(suite), "PhotoCraft 与其它 App 同一个层级 3 弹窗（工具名仍是 photocraft）");
  ok(/RuntimeUpdateRow[\s\S]{0,200}?id="artcraft"/.test(suite), "层级 2 有独立更新行（GitHub 直下型）");
  ok(/已安装/.test(suite) && /在 Launcher 中打开/.test(suite) && /在 Launcher 中安装/.test(suite),
    "层级 3 真实反映已装状态（已安装 / 在 Launcher 中打开 / 安装）");
  ok(/craft_\$\{app\.key|appToolId/.test(suite) && /Codex 工具（独立）/.test(suite), "层级 3 写明独立工具名（craft_<id>）");
  ok(/setInterval[^]{0,400}?refresh/.test(suite) && /addEventListener\("focus"/.test(suite),
    "弹窗开着轮询 + 回前台立刻刷新（装完有反馈）");
  ok(/syncTools\(true\)/.test(suite) && /withCliKey !== writtenKey|withCliKey === writtenKey/.test(suite),
    "已装名单变化时自动同步 MCP 配置（装/卸不用手点）");
  const apps = read(APPS);
  const names = (apps.match(/name: "[^"]+"/g) || []).length;
  ok(names >= 19, `App 目录覆盖套件（实到 ${names} 条；17 官方 + 2 社区 = 19）`);
  /* 11-17 用户截图：「未安装的 PhotoCraft 还挂着『已接入』标签」——现在它与其它 App 一样，只在已装时显示「已安装」。 */
  ok(!/integrated: true/.test(apps) && !/item\.integrated/.test(suite) && !/app\.integrated/.test(suite),
    "目录与网格不再给未安装 App 挂「已接入」标签（已装只显示「已安装」）");
  ok(/CRAFT_APPS\.find/.test(apps) && /normalizeCraftKey/.test(apps), "目录提供按 key 查找 + id 归一化");
  ok(/19 个创作 App/.test(devtools) && /19 个开源|19 个创作 App/.test(suite),
    "界面文案与目录条数一致（19 个 = 17 官方 + 2 社区；⛔ 不是 18）");
  ok((apps.match(/features: \[/g) || []).length >= 19 && !/features: \[\]/.test(apps),
    "19 个 App 都带「能做什么」要点（详情页不再空白）");
  ok(/installedByKey/.test(suite) && /item\.color/.test(suite), "网格用 Launcher 目录 id 与主题色（视觉一致）");
  const groups = read("src/features/settings-devtools/runtime-groups.tsx");
  ok(/DEDICATED_IDS = \[[^\]]*"artcraft"/.test(groups), "专用卡片不重复进分类列表");
  const css = read("src/styles/12-settings-skills.css");
  ok(/\.craft-app-grid \{/.test(css) && /\.craft-app-tile \{/.test(css), "App 网格样式在位（含窄屏降列）");
}

/* ── ⑤ 独立工具接线（craft_<id>） ─────────────────────────── */
{
  const tool = codeOnly(read(TOOL));
  ok(/function craftToolDefs/.test(tool) && /name: `craft_\$\{app\.id\}`/.test(tool), "每个已装 App 注册独立工具 craft_<id>");
  ok(/artcraftStatus\?\.\(\)/.test(tool) && /cliPath/.test(tool), "只给「已装且有无头 CLI」的 App 注册");
  ok(/app\.id !== "photocraft"/.test(tool), "⛔ PhotoCraft 不重复注册（它有自己的工具）");
  const dispatch = codeOnly(read(DISPATCH));
  ok(/tool\.startsWith\("craft_"\)/.test(dispatch) && /runCraftAppTool\(/.test(dispatch), "事件路由分派 craft_* → runCraftAppTool");
  const helper = codeOnly(read("src/features/app-state/parts/part05/event-router/craft-app-tool.ts"));
  ok(/window\.codex\.artcraftRun\(/.test(helper), "工具分发体接到 artcraft:run");
}

/* ── ⑥ 验收、文档与合规 ───────────────────────────────────── */
{
  ok(/id: "artcraft"/.test(read("scripts/accept.mjs")), "验收项已登记（accept.mjs）");
  ok(/id: "photocraft"[\s\S]{0,900}?Craft 全家桶/.test(read("scripts/accept.mjs")), "PhotoCraft 验收已改走三级入口");
  ok(/已安装|在 Launcher 中打开/.test(read("scripts/accept.mjs")), "验收覆盖安装联动文案");
  const notices = read("THIRD_PARTY_NOTICES.md");
  ok(/storytold\/craft-launcher/.test(notices) && /Apache-2\.0/.test(notices), "第三方声明登记来源与许可");
  ok(/不冒充/.test(notices), "声明不冒充 ArtCraft 官方");
  ok(/Craft 全家桶/.test(read("AGENTS.md")), "AGENTS.md 有 Craft 全家桶条目");
  ok(/"artcraft"/.test(read("scripts/gen-capability-skill.mjs")), "能力清单生成器有 artcraft 域描述");
}

/* ── ⑦ 产出文件按格式用对应 App 打开（11-16） ─────────────── */
{
  const openers = read("src/lib/craft-openers.mjs");
  const shared = read("src/features/shared/craft-open.ts");
  const cards = read("src/features/shared/InlineCards.tsx");
  const media = read("src/features/status/TurnMediaCards.tsx");
  ok(/export const CRAFT_OPENERS/.test(openers) && /export function craftOpenersFor/.test(openers),
    "打开器目录是纯模块（单一真相源）");
  ok(/export function craftFileExtension/.test(openers), "扩展名归一化（小写、无扩展名返回空）");
  const { craftOpenersFor, craftFileExtension } = await import(new URL("../../src/lib/craft-openers.mjs", import.meta.url).href);
  ok(craftFileExtension("C:\\a\\B.PPTX") === "pptx" && craftFileExtension("noext") === "", "扩展名真值：大写转小写 / 无扩展名为空");
  ok(craftOpenersFor("a.pptx", ["deckcraft"]).length === 1 && craftOpenersFor("a.pptx", ["cadcraft"]).length === 0,
    "真值：pptx 只给装了 DeckCraft 的用户；没装 = 不出现");
  ok(craftOpenersFor("a.svg", ["vectorcraft", "figcraft"], { limit: 1 })[0]?.id === "vectorcraft", "优先级：svg 先 VectorCraft");
  ok(craftOpenersFor("a.pdf", ["wordcraft", "pdfcraft"], { limit: 1 })[0]?.id === "pdfcraft", "优先级：pdf 先 PdfCraft");
  ok(craftOpenersFor("a.png", ["lightcraft", "photocraft"], { limit: 1 })[0]?.id === "photocraft", "优先级：png 先 PhotoCraft");
  ok(/artcraftStatus/.test(shared) && /installedApps/.test(shared) && /setInterval/.test(shared),
    "已装名单共享轮询（文件菜单与媒体卡读同一份）");
  ok(/window\.codex\.artcraftRun\(\{ app: appId, action: "open", path: filePath \}\)/.test(shared),
    "打开走 artcraft:run 的 open（spawn 官方主程序，不开 shell）");
  ok(/craftOpeners\(menu\.path, craftIds/.test(cards) && /用 \$\{opener\.name\} 打开/.test(cards),
    "文件卡菜单按格式插入「用 X 打开」");
  ok(/const height = pad \* 2 \+ items\.length \* itemH/.test(cards), "菜单高度按实际项数算（多出的项不被裁掉）");
  ok(/useInstalledCraftIds\(\)/.test(media) && /openPathInCraft\(opener\.id/.test(media),
    "媒体产物卡：图片 / 视频 / 音频都带「用对应 App 打开」");
  ok(/filter\(\(opener\) => opener\.id !== "photocraft"\)/.test(media), "图片保留 PhotoCraft 专用按钮，不重复列");
  ok(/turn-media-chip-wrap/.test(media) && /\.turn-media-chip-wrap \{/.test(read("src/styles/39-media-preview.css")),
    "音频芯片用无固定尺寸的定位包裹（⛔ 不套 112×112 图片框，否则会被裁切）");
  const outputCards = read("src/features/status/OutputFileCards.tsx");
  ok(/craftItemsFor/.test(outputCards) && /用 (\$\{|\{)opener\.name\}? 打开/.test(outputCards),
    "Qoder 式产出文件卡的「打开方式」与右键菜单都插入「用 X 打开」");
  ok(/craftItemsFor\(path\)\.length \* 30/.test(outputCards) && /craftItemsFor\(menu\?\.path \?\? ""\)\.length/.test(outputCards),
    "弹出层高度按实际项数算（贴底翻转判断不会错位）");
  ok(/craftOpenersFor/.test(read("src/lib/craft-openers.d.mts")), "TS 类型面与纯模块同源（craftOpenersFor 已声明）");
}

console.log(`\n【artcraft】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
