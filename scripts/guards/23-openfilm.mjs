/**
 * 预检守卫：OpenFilm 对接域（10-27 立，批次二扩到 Studio/工具/技能）
 *
 * 为什么单独一条：这是一个**第三方开源项目**的对接面，失效方式全是静默的 ——
 *   镜像被换回官方（国内用户下不动 100MB 浏览器）、卸载范围失手（删到用户影片）、
 *   许可声明被顺手删掉（合规问题）、版本比较被手写第二份（预发布语义分歧）、
 *   Studio 开了但没进内置浏览器（用户看不到改动，以为"没生效"）、
 *   工具把 `filmDir` 放到工作区外（一次 render --out 就能写到用户任何地方）。
 *   这些 tsc 与预检都看不见，只能钉结构与来源。
 *
 * ⛔ 本守卫钉「契约与来源」，不钉"安装能成功/渲染能出片"（那要真下 100MB + ffmpeg，属验收脚本的事）。
 * 独立守卫（不进 check-preflight 的 checks 计数，同 22/11r 口径）。
 *
 * 批次二把实现拆成了五个文件（ipc ↔ studio 互相 import 会成环）：
 *   features/openfilm-ipc.ts（IPC 面 + 安装器）· openfilm/{paths,runner,probe,studio,tools,brand}.ts
 * ⇒ 断言必须指向**真正持有事实的那个文件**，否则守的是"文件搬过家"而不是行为。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnly } from "./_ctx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const has = (rel) => existsSync(join(ROOT, rel));
const code = (rel) => (has(rel) ? codeOnly(read(rel)) : "");

let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【openfilm】${message}`);
  if (!condition) fails++;
};

const ipc = code("electron/features/openfilm-ipc.ts");
const paths = code("electron/openfilm/paths.ts");
const runner = code("electron/openfilm/runner.ts");
const probe = code("electron/openfilm/probe.ts");
const studio = code("electron/openfilm/studio.ts");
const tools = code("electron/openfilm/tools.ts");
const brand = code("electron/openfilm/brand.ts");
const desktop = code("electron/openfilm/desktop.ts");

ok(Boolean(ipc) && Boolean(paths) && Boolean(runner) && Boolean(probe) && Boolean(studio) && Boolean(tools) && Boolean(brand) && Boolean(desktop),
  "主进程七件套在位（ipc / paths / runner / probe / studio / tools / brand / desktop）");

/* ── 1. 域登记：一个前缀、9 条通道、生成物齐 ─────────────────────────── */
{
  const composition = JSON.parse(read("electron/composition.json"));
  const row = (composition.domains ?? []).find((d) => d.id === "openfilm");
  ok(Boolean(row?.enabled) && row?.file === "features/openfilm-ipc.ts" && row?.export === "openfilmFeature",
    "composition.json 已启用该域且 file/export 对得上");
  ok(read("electron/composition.gen.ts").includes("openfilm-ipc"), "composition.gen.ts 已重生成（跑过 npm run gen:domains）");

  const manifest = JSON.parse(read("electron/ipc-channels.manifest.json"));
  const channels = manifest.channels.filter((c) => String(c.channel ?? "").startsWith("openfilm:")).map((c) => c.channel);
  ok(channels.length === 12, `manifest 有 12 条 openfilm 通道（实测 ${channels.length}）`);
  ok(["openfilm:status", "openfilm:install", "openfilm:retry", "openfilm:uninstall", "openfilm:settings-get", "openfilm:settings-set",
    "openfilm:update-check", "openfilm:studio-open", "openfilm:studio-status",
    "openfilm:desktop-info", "openfilm:desktop-download", "openfilm:desktop-run"]
    .every((name) => channels.includes(name)), "12 条通道名与实现一致（含批次二 studio / 批次三 desktop）");
  /* ⛔ 没有"关闭 Studio"通道：那个实例可能正被上游桌面 App 或别的 agent 用着，杀它 = 丢用户没保存的手改 */
  ok(!channels.some((name) => /studio-close|studio-kill/.test(name)),
    "⛔ 不提供关闭 Studio 的通道（可能是别人正在用的实例）");

  const registry = read("electron/ipc-registry.ts");
  ok(/\{ prefix: "openfilm", count: 12, status: "in-features", file: "features\/openfilm-ipc\.ts"/.test(registry),
    "ipc-registry.ts 账本已登记（count=12）");

  const preload = read("electron/preload.ts");
  for (const method of ["openfilmStatus", "openfilmInstall", "openfilmRetry", "openfilmUninstall", "openfilmSettingsGet",
    "openfilmSettingsSet", "openfilmUpdateCheck", "openfilmStudioOpen", "openfilmStudioStatus",
    "openfilmDesktopInfo", "openfilmDesktopDownload", "openfilmDesktopRun"]) {
    ok(preload.includes(method), `preload 已生成 ${method}`);
  }
}

/* ── 2. 安装纪律：镜像来源单一真相源 + 双跳回落 + 不经 shell ──────────── */
{
  ok(/import \{[^}]*CHINA_NPM_REGISTRY[^}]*\} from "\.\.\/toolchain"/.test(ipc),
    "npm 镜像取自 toolchain 的 CHINA_NPM_REGISTRY（⛔ 不在这里再写一份 registry 字面量）");
  ok(!/registry\.npmmirror\.com/.test(ipc),
    "⛔ 源码里不出现 npmmirror 字面量（只有 toolchain 一处真相源）");
  ok(/\[CHINA_NPM_REGISTRY, "https:\/\/registry\.npmjs\.org"\]/.test(ipc),
    "安装按「国内镜像 → 官方」两跳（⛔ 失败不能静默停在国内源）");
  ok(/PLAYWRIGHT_DOWNLOAD_HOST/.test(ipc) && /cdn\.npmmirror\.com\/binaries\/playwright/.test(ipc),
    "渲染引擎走 playwright 自己的下载根，并指向 cdn.npmmirror.com 镜像");
  ok(/\{ host: PLAYWRIGHT_MIRROR, label:[^}]*\}, \{ host: "", label: "官方 CDN" \}/.test(ipc),
    "渲染引擎同样是「镜像 → 官方」两跳；⛔ 镜像挂掉不能把用户卡死");
  ok(!/shell:\s*true/.test(ipc) && !/shell:\s*true/.test(runner) && /spawn\(exe, args, \{/.test(runner),
    "子进程一律 spawn(args 数组)，⛔ 不经 shell / 不拼命令字符串（唯一出口 = openfilm/runner.ts）");
  ok(/bundledNode\(\)/.test(runner) && /bundledNpmCli\(\)/.test(ipc),
    "用我们自己的内置 node（runner）/ npm（安装器）—— ⛔ 不要求用户装 Node");
  ok(/bundledFfmpeg\(\)/.test(probe) && !/ffmpeg\.exe\?|github\.com\/Gyan/.test(probe + ipc),
    "ffmpeg 只认内置/系统（⛔ 不下载第三方 ffmpeg 二进制 —— GPL 传染风险，见设计稿）");
  /* CLI 一律走内置 node + toolchain 的 PATH —— look/render 要能看见我们内置的 ffmpeg/ffprobe */
  ok(/toolchainEnv\(\)/.test(runner), "子进程环境走 toolchainEnv()（否则装了 ffmpeg 也看不见）");
}

/* ── 3. 卸载安全闸：只删 runtime，绝不碰影片 ─────────────────────────── */
{
  ok(/entry === "runtime"/.test(ipc) && /entry === "\.installing"/.test(ipc),
    "卸载只清 runtime（与安装标记），白名单之外的条目一律不动");
  ok(/!\/openfilm\$\/i\.test\(resolved\)/.test(ipc) && /length < 3/.test(ipc),
    "删除目标必须是自己算出的 openfilm 根且深度 ≥3（防路径配置坏掉时删到用户目录）");
  /* ⛔ 批次二起我们会**建**影片目录（<工作区>/films），所以不能再断言"代码里没有 films"；
     真契约是「没有任何一处按 films 递归删」 */
  const deletions = [ipc, studio, tools, paths].filter((text) => /rm\(\s*[^)]*films|rmSync\(\s*[^)]*films/.test(text));
  ok(deletions.length === 0, "⛔ 没有任何一处对 films 目录做删除（卸载/清理只碰运行时）");
}

/* ── 4. 版本比较单一真相源 ───────────────────────────────────────────── */
{
  ok(/import \{ compareVersions \} from "\.\.\/updates"/.test(ipc) && /compareVersions\(latest\.version, current\)/.test(ipc),
    "版本比较走 electron/updates.ts 的 compareVersions（⛔ 不手写第二份）");
  ok(!/function compareVersions|function parseVersion/.test(ipc + tools), "⛔ 本域不重复实现版本比较");
}

/* ── 5. 自动更新开关（三档要真的生效，不能只是个 UI）──────────────────── */
{
  ok(/async function autoUpdateOnStartup/.test(ipc) && /autoUpdate === "off"\) return/.test(ipc),
    "启动检查按设置生效（off 直接返回 —— 开关不是摆设）");
  ok(/24 \* 3600_000|CHECK_INTERVAL_MS/.test(ipc) && /lastCheckedAt/.test(ipc),
    "24h 节奏靠 settings.lastCheckedAt（⛔ 别每次启动都打网络）");
  ok(/settings\.autoUpdate === "auto"\) await runInstall\("cli"\)/.test(ipc),
    "「自动安装」档真去更新运行时（只更 CLI，不重下 100MB 浏览器）");
  ok(!/require\("electron"\)\)\.autoUpdater|electron-updater/.test(ipc),
    "⛔ 不代跑上游桌面 App 的 electron-updater（那是它自己的更新器）");
}

/* ── 6. 开源声明（用户明确要求：界面与文档都要标） ───────────────────── */
{
  ok(/OPENFILM_HOME = "https:\/\/github\.com\/openfilm\/openfilm"/.test(brand)
    && /OPENFILM_LICENSE = "MIT"/.test(brand),
    "声明常量：仓库地址 + MIT 许可（brand.ts 是唯一真相源）");
  ok(/OPENFILM_TRADEMARK_NOTE =[\s\S]{0,200}?TRADEMARK\.md[\s\S]{0,200}?无隶属或背书关系/.test(brand),
    "商标声明含「名称与图标归 OpenFilm 项目所有」与「无隶属或背书」（TRADEMARK.md 是上游事实）");
  ok(/attribution: OPENFILM_ATTRIBUTION/.test(probe),
    "状态接口把声明下发给界面（⛔ 前端不写第二份文案）");
  ok(/OPENFILM_ATTRIBUTION: OpenfilmAttribution = \{/.test(brand), "声明以对象形式集中下发（界面/文档/技能引同一组事实）");
  ok(has("docs/OPENFILM-INTEGRATION-2026-10-27.md"), "设计/合规文档在位（docs/OPENFILM-INTEGRATION-2026-10-27.md）");
  ok(!/OpenFilm-.*\.(exe|dmg)|OpenFilm-Setup/.test(ipc + tools + studio),
    "⛔ 不下载/不内置上游桌面安装包（只装 npm CLI + 浏览器）");
  const skill = code("electron/builtin-skills/26-skill-openfilm.ts");
  ok(/github\.com\/openfilm\/openfilm/.test(skill) && /MIT/.test(skill) && /商标/.test(skill),
    "内置技能正文也标了仓库地址 / MIT / 商标归属（用户要求：文档里也标）");
}

/* ── 7. Studio：打开即"配对"，且必须进内置浏览器 ─────────────────────── */
{
  ok(/OPENFILM_NO_BROWSER: "1"/.test(runner),
    "跑 CLI 恒设 OPENFILM_NO_BROWSER=1（⛔ 否则它会自己弹系统浏览器，用户看到的不是内置那个页面）");
  ok(/\^Studio\\s\+\(https\?:/.test(studio),
    "从 stdout 抓 `Studio <url>`（正则只认这一行 —— URL 结构随上游版本变）");
  ok(/api\/health/.test(studio) && /product !== "openfilm-studio"/.test(studio),
    "探活看 product 字段而不是 HTTP 200（端口上可能蹲着别的服务）");
  ok(/\.openfilm|studioHome\(\)/.test(studio + paths) && /run\.json/.test(studio),
    "Studio 现状取自机器级 ~/.openfilm/run.json（与桌面 App 共享同一份）");
  ok(/session\.json/.test(studio) && /broadcastCodexEvent\(\{ type: "openfilm", phase: "studio"/.test(studio),
    "打开后落 session.json 并广播 studio 事件（渲染层据此开内置浏览器）");
  ok(!/process\.kill\(|taskkill/.test(studio),
    "⛔ 本域不杀 Studio 进程（可能是桌面 App 或另一个 agent 正在用的实例）");
  const bridge = code("src/features/openfilm/OpenfilmBridge.tsx");
  ok(/phase .*!== "studio"/.test(bridge) && /openInBrowserPane\(url\)/.test(bridge),
    "渲染层把 studio 事件开进内置浏览器（OpenfilmBridge）");
  ok(/<OpenfilmBridge app=\{\{ openInBrowserPane: app\.openInBrowserPane/.test(code("src/features/app-view/AppView.tsx")),
    "OpenfilmBridge 已在 AppView 挂载（不挂 = 事件没人接）");
}

/* ── 8. 工具面：六个工具、命令白名单、目录闸、产物只回路径 ───────────── */
{
  for (const name of ["openfilm_status", "openfilm_make_film", "openfilm_check", "openfilm_render", "openfilm_get", "openfilm_skill"]) {
    ok(tools.includes(`name: "${name}"`), `工具定义在：${name}`);
  }
  ok(/CLI_VERBS = \["open", "look", "render", "get", "skills", "skill"\]/.test(runner),
    "命令白名单 = open/look/render/get/skills/skill");
  ok(!/"update"/.test(runner) && !/"doctor"/.test(runner),
    "⛔ 不给模型 update / doctor（一个会自己改运行时，一个只是体检）");
  ok(/if \(!tool\.startsWith\("openfilm_"\)\) return false/.test(tools),
    "主进程应答只接管 openfilm_ 前缀（⛔ 别把别的工具吞掉）");
  ok(/threadCwd\.get\(threadId\)/.test(tools),
    "工作区只认引擎下发的 threadId（⛔ 不用模型自报的路径当身份）");
  ok(/const inWorkspace = .*startsWith\(path\.resolve\(base\) \+ path\.sep\)/.test(tools) && /影片目录必须在当前工作区/.test(tools),
    "影片目录必须落在会话工作区之内（目录闸）");
  ok(/用户主目录/.test(tools) && /磁盘根目录/.test(tools) && /Studio 自己的状态目录/.test(tools)
    && /OpenFilm 的安装目录/.test(tools),
    "四条禁区都拒：home / 盘根 / ~/.openfilm / 安装目录");
  ok(/if \(out && path\.isAbsolute\(out\)\)/.test(tools) && /out 里不许出现/.test(tools),
    "render 的 out 只接受相对影片目录的文件名（⛔ 不许写任意路径）");
  ok(/GET_FLAGS = new Set\(\["--yes", "--via", "--model", "--count", "--duration", "--lang", "--style"\]\)/.test(tools),
    "get 的 `-` 选项走白名单（⛔ 命令行不接受自由文本）");
  ok(/at\.startsWith\("-"\)/.test(tools) && /at 只接受 4\.5 /.test(tools),
    "check 的 at 只接受单帧/区间/素材路径（⛔ 不许退化成自由 flag）");
  ok(/产物只回路径|只回路径/.test(tools) || /`导出完成：\$\{produced\}/.test(tools),
    "render 只回产物路径（⛔ 不把几百 MB 读进内存回给模型）");
  ok(/OF_E_NOT_READY/.test(studio) && /不要自己执行 npm install/.test(tools),
    "未安装时引导用户去卡片点安装（⛔ 模型自己 npm install）");
  /* 工具必须在 thread/start 注入，且**不带安装条件**（否则没装时模型看不见、用户永远装不上） */
  const codexIpc = code("electron/features/codex-ipc.ts");
  ok(/buildOpenfilmTools\(\)/.test(codexIpc) && /\.\.\.existing, \.\.\.buildOpenfilmTools\(\)/.test(codexIpc),
    "thread/start 把 6 个工具并进工具面（与 MCP 那批一样是追加，不覆盖）");
  ok(!/phase === "ready".*buildOpenfilmTools|buildOpenfilmTools[\s\S]{0,80}phase === "ready"/.test(codexIpc),
    "⛔ 注入不带「装好才注册」的条件（没装时工具的第一个动作就是引导安装）");
  const boot = code("electron/features/boot.ts");
  ok(/handleOpenfilmToolCall\(\{ event, respond/.test(boot),
    "boot 在事件流里应答工具调用（前台/后台会话同一条路；⛔ 排在 filterForRenderer 之前）");
  ok(boot.indexOf("handleOpenfilmToolCall") < boot.indexOf("filterForRenderer(event)"),
    "应答排在 filterForRenderer **之前**（被裁掉就再也拿不到了）");
}

/* ── 9. 桌面端：只用官方安装包，不代删系统目录，不代跑它的更新器 ──────── */
{
  ok(/api\.github\.com\/repos\/\$\{REPO\}\/releases\/latest/.test(desktop) && /const REPO = "openfilm\/openfilm"/.test(desktop),
    "只从上游官方 Release 取包（openfilm/openfilm 的 releases/latest）");
  ok(/mirrorCandidates\(RELEASE_API\)/.test(desktop),
    "API 与资产都走 gh-mirror 的候选序（⛔ 不在这里另写一份镜像表）");
  ok(/downloadUpdate\(asset\.url, target/.test(desktop) && /asset\.digest\.replace\(\/\^sha256:\/i, ""\)/.test(desktop),
    "下载复用 updates.downloadUpdate 并强制校验 asset.digest 的 sha256（第三方反代能改包体 ⇒ 必须比对）");
  ok(/OpenFilm-Setup-\.\*\.exe/.test(desktop) || /\^OpenFilm-Setup-.*\\\.exe\$/.test(desktop),
    "Windows 取 OpenFilm-Setup-*.exe（上游只发 x64）");
  ok(!/arm64.*\.exe|Setup-arm64/i.test(desktop),
    "⛔ 不假装 Windows 有 arm64 包（上游没有；ARM 设备如实说明只能走 CLI）");
  ok(/arch === "arm64" \? find\(\/arm64\\\.dmg\$\/i\) : find\(\/x64\\\.dmg\$\/i\)/.test(desktop),
    "macOS 按 arch 选 dmg（arm64 / x64 两种产物）");
  ok(/hdiutil.*attach/.test(desktop) && /\["-R", source, target\]/.test(desktop) && /xattr.*com\.apple\.quarantine/.test(desktop),
    "macOS 自动安装：hdiutil 挂载 → cp -R 到 /Applications → 清 com.apple.quarantine（未公证包不清会被 Gatekeeper 拦）");
  ok(!/rm\(.*Applications|rmSync\(.*Applications|rm\(.*ProgramFiles/.test(desktop) && !/rm -rf/.test(desktop),
    "⛔ 绝不代删 /Applications 或 Program Files（卸载只做引导：启动它的卸载器 / 在 Finder 选中）");
  ok(/Uninstall.*\.exe/.test(desktop) && /launchDetached\(uninstaller/.test(desktop),
    "Windows 卸载 = 启动上游自带的 Uninstall*.exe（不是我们删目录）");
  ok(/open.*-R/.test(desktop) && /拖进废纸篓/.test(desktop),
    "macOS 卸载 = Finder 里选中 .app 让用户自己扔（⛔ 不代删）");
  ok(!/autoUpdater|electron-updater/.test(desktop),
    "⛔ 不代跑上游的 electron-updater（App 更新归 App 自己）");
  ok(/desktopDir\(\)/.test(desktop) && /path\.join\(desktopDir\(\), asset\.name\)/.test(desktop),
    "安装包落在自己的 <安装根>/desktop/ 下（⛔ 不塞下载目录、不改名）");
  /* ⛔ 断网/API 限流时"运行安装程序"不能报"还没下载"—— 本地动作只认磁盘 */
  ok(/function localPackageAny/.test(desktop) && /localPackage\(info\.asset\?\.name \?\? ""\) \?\? localPackageAny\(\)/.test(desktop),
    "install/reveal 先认磁盘上的包（⛔ 不靠 GitHub API 决定文件在不在）");
  ok(/RELEASE_TTL_MS = 60_000/.test(desktop) && /releaseCache/.test(desktop),
    "Release 查询有 60s 缓存（未鉴权 API 只有 60 次/小时，不缓存会把自己限流）");
  ok(/desktopSummary\(info\)/.test(tools),
    "openfilm_status 里带上桌面端一句话（模型能主动建议，⛔ 不另写一份判断）");
  ok(/export function launchDetached/.test(runner) && /detached: true/.test(runner),
    "安装器用 runner 的 detached 启动器（⛔ 不 await 一个会一直开着的 NSIS 向导）");
  ok(/entry === "runtime"/.test(ipc) && !/entry === "desktop"/.test(ipc),
    "「卸载运行时」不带走已下载的安装包（两者分开，别互相连坐）");
  const desktopCard = code("src/features/openfilm/OpenfilmCard.tsx");
  ok(/openfilmDesktopDownload\(\)/.test(desktopCard) && /openfilmDesktopRun\(action\)/.test(desktopCard),
    "卡片能下载并运行安装器（desktop-download / desktop-run）");
  ok(/未公证/.test(desktopCard) && /UAC/.test(desktopCard),
    "卡片写清了 macOS 未公证与 Windows UAC 的真实情况（⛔ 不假装已签名）");
  ok(/卸载引导/.test(desktopCard) && /不会替你删系统目录/.test(desktopCard),
    "卡片明确：卸载只做引导，不代删系统目录");
}

/* ── 10. 技能：内置一份手册，正文与工具实现一致 ───────────────────────── */
{
  const builtin = code("electron/builtin-skills.ts");
  ok(/\["openfilm-video-editing", OPENFILM_SKILL\]/.test(builtin),
    "内置技能 openfilm-video-editing 已注册（skill-pack 会写进 $CODEX_HOME/skills）");
  const skill = code("electron/builtin-skills/26-skill-openfilm.ts");
  ok(/^name: openfilm-video-editing$|name: openfilm-video-editing/m.test(read("electron/builtin-skills/26-skill-openfilm.ts")),
    "SKILL.md frontmatter 的 name 与注册名一致（⛔ 不一致 = 引擎认不到）");
  ok(/画面只依赖 t/.test(skill) && /不重编码素材/.test(skill) && /overrides/.test(skill),
    "技能正文写进了 film.html 的铁律（t 决定画面 / 不重编码 / 不动 overrides）");
  ok(/openfilm_status/.test(skill) && /openfilm_make_film/.test(skill) && /openfilm_check/.test(skill) && /openfilm_render/.test(skill),
    "技能按真实工具名给顺序（status → make_film → 写片 → check → render）");
  ok(/不要自己执行 \\`npm install\\`|绝不要自己执行/.test(skill),
    "技能明令：模型不许自己 npm install（必须让用户点卡片）");
}

/* ── 11. 渲染层：卡片挂在开发工具页，且开关只有这套语义 ─────────────── */
{
  const card = code("src/features/openfilm/OpenfilmCard.tsx");
  ok(Boolean(card) && /window\.codex\.openfilmStatus\(\)/.test(card), "卡片自取状态（window.codex.openfilmStatus）");
  ok(/window\.codex\.openfilmInstall\(/.test(card) && /window\.codex\.openfilmUninstall\(/.test(card),
    "卡片有「下载并安装 / 卸载」入口");
  ok(/AUTO_UPDATE_OPTIONS[\s\S]{0,400}?value: "off"[\s\S]{0,200}?value: "startup"[\s\S]{0,200}?value: "auto"/.test(card),
    "自动更新三档（关闭 / 启动时检查 / 自动安装）");
  ok(/saveSettings\(\{ mirror: "auto" \}\)/.test(card) && /saveSettings\(\{ mirror: "official" \}\)/.test(card),
    "下载源可切（国内镜像优先 / 仅官方）");
  ok(/status\.attribution\.home/.test(card), "界面地址取自 status.attribution（⛔ 不写死 URL）");
  ok(/window\.codex\.openfilmStudioOpen\(/.test(card) && /status\.studio\.alive/.test(card),
    "卡片有「打开 / 连接 Studio」并显示连接状态");

  const devtools = code("src/features/settings-devtools/DevtoolsSettingsSection.tsx");
  ok(/import \{ OpenfilmCard \} from "\.\.\/openfilm"/.test(devtools) && /key: "openfilm"/.test(devtools)
    && /openCard === "openfilm"/.test(devtools),
    "卡片挂在「开发工具」页（一级卡 + 二级弹窗都在位）");
}

console.log(`\n【openfilm】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
