/**
 * 12bo-apkstart —— ApkStart 安卓运行器的「安装 → 状态 → 工具 → 界面」全链路守卫（11-14）。
 *
 * 用户令「github 的 apk start 帮我放到开发工具，跟飞书 cli 界面一样，按需下载，codex 可以直接
 * 调用这个进行安卓模拟测试，配套好工具」后加。钉住：
 *   ① 开发工具链：规格表 / marker / 仅 Windows（mac 隐藏）/ GitHub 直下型安装与更新；
 *   ② 专用域 apkstart 的 8 条通道三处一致（域文件 / manifest / registry / 组合表）；
 *   ③ CLI 三形态：`--silent <apk>` 安装、`--launch <包名>` 启动、无参打开；一律参数数组不进 shell；
 *   ④ 完成判据读 ApkStart 自己的 apps.json（GUI 无结构化 stdout），pending ≠ 成功；
 *   ⑤ purge 破坏性通道必须显式 confirm；
 *   ⑥ 模型工具 apkstart（action 枚举）真注册且分发到宿主；
 *   ⑦ 设置页卡片（key / 专用卡 / 不进分组重复出卡）、内置技能、开发者指令条件注入。
 *
 * ⛔ 独立守卫（不进 _ctx MODULES 计数），必须同时加进 package.json 的 check 链。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log(`  ${c ? "✓" : "✗"} 【apkstart】${m}`); if (!c) fails++; };
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const codeOnly = (s) => String(s)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const DOMAIN = "electron/features/apkstart-ipc.ts";
const RUNTIME = "electron/features/runtime-ipc.ts";
const DEVRUN = "electron/features/dev-runtimes.ts";
const SEG = "src/features/app-state/parts/part08/01-seg.tsx";
const REQ = "src/features/app-state/parts/part05/event-router/02-request.tsx";
const PAGE = "src/features/settings-devtools/DevtoolsSettingsSection.tsx";
const GROUPS = "src/features/settings-devtools/runtime-groups.tsx";

/* ── ① 开发工具链 ─────────────────────────────────────────────── */
{
  const dev = codeOnly(read(DEVRUN));
  ok(/apkstart: \{ name: "ApkStart 安卓运行器"[\s\S]{0,400}?marker: "apkstart\\\\ApkStart\.exe"/.test(dev),
    "开发工具规格表有 apkstart 且 marker 指向 ApkStart.exe");
  ok(/DARWIN_HIDDEN = new Set<DevRuntimeId>\(\[[^\]]*"apkstart"/.test(dev),
    "mac 隐藏（ApkStart 仅 Windows，不在 mac 列出假卡片）");
  const runtime = codeOnly(read(RUNTIME));
  ok(/export const APKSTART_REPO = "RoutineMiku\/apkstart"/.test(runtime),
    "仓库地址单一真相源 APKSTART_REPO");
  ok(/ApkStart-v\$\{version\}-win64-portable\.zip/.test(runtime),
    "资产名与上游 release 一致（ApkStart-v<ver>-win64-portable.zip）");
  ok(/async function installApkStartFromGitHub[\s\S]{0,400}?process\.platform !== "win32"/.test(runtime),
    "安装函数自行拒绝非 Windows（直调 runtime:install 也挡得住）");
  ok(/fetchGitHubAssetDigest\(APKSTART_REPO, asset, version\)[\s\S]{0,400}?expectedSha !== actualSha/.test(runtime),
    "下载后按目标版本的 release digest 做 SHA256 校验");
  ok(/writeFile\(apkstartVersionFile\(\)/.test(runtime),
    "装完落 version.txt（更新链读它判已装版本）");
  ok(/id === "apkstart"[\s\S]{0,300}?installApkStartFromGitHub/.test(runtime),
    "runtime:install 有 apkstart 分支");
  ok(/apkstart: \{ repo: APKSTART_REPO, label: "ApkStart 安卓运行器", platforms: \["win32"\], install: installApkStartFromGitHub \}/.test(runtime),
    "更新链 GITHUB_UPDATEABLE 走同一个安装函数 + 按平台过滤");
  ok(/await gh\.install\(id as DevRuntimeId, latest\)/.test(runtime),
    "performRuntimeUpdate 用配置里的 install 指针（不写死 Filee）");
}

/* ── ② 通道三处一致 ───────────────────────────────────────────── */
const EXPECTED = [
  "apkstart:status", "apkstart:install", "apkstart:launch", "apkstart:screenshot",
  "apkstart:logcat", "apkstart:adb", "apkstart:open", "apkstart:purge",
];
{
  const domain = codeOnly(read(DOMAIN));
  const channels = [...domain.matchAll(/"(apkstart:[a-z-]+)"/g)].map((m) => m[1]);
  ok(EXPECTED.every((ch) => channels.includes(ch)), "域文件注册了全部 8 条通道");
  const registry = read("electron/ipc-registry.ts");
  const row = registry.match(/\{ prefix: "apkstart", count: (\d+)[\s\S]*?channels: \[([^\]]+)\]/);
  ok(Boolean(row) && Number(row[1]) === EXPECTED.length, "ipc-registry 的 count = 8");
  ok(Boolean(row) && EXPECTED.every((ch) => row[2].includes(ch)), "ipc-registry 的 channels 逐条对得上");
  const manifest = read("electron/ipc-channels.manifest.json");
  ok(EXPECTED.every((ch) => manifest.includes(`"channel": "${ch}"`)), "manifest 有全部 8 条通道");
  const composition = read("electron/composition.json");
  ok(/"id": "apkstart"[\s\S]{0,200}?"file": "features\/apkstart-ipc\.ts"[\s\S]{0,80}?"export": "apkStartFeature"/.test(composition),
    "组合表启用 apkstart（export 与域文件一致）");
}

/* ── ③④ CLI 形态与完成判据 ────────────────────────────────────── */
{
  const domain = codeOnly(read(DOMAIN));
  ok(/spawnApp\(\["--silent", apk\]\)/.test(domain), "安装走 --silent <apk>（不弹主界面）");
  ok(/spawnApp\(\["--launch", String\(fresh\.package\)\]\)/.test(domain)
    && /spawnApp\(\["--launch", pkg\]\)/.test(domain), "启动走 --launch <包名>");
  ok(/spawn\(exe, args, \{/.test(domain), "CLI 一律参数数组 spawn（exe, args）");
  ok(!/exec\(|execSync\(|shell: true/.test(domain), "⛔ 不开 shell");
  ok(/apps\.json/.test(domain) && /readApps\(\)/.test(domain), "已装应用清单读 ApkStart 的 apps.json");
  ok(/pending: true/.test(domain) && /runtimeReady\(\)/.test(domain),
    "等不到安装结果时回 pending + 区分「运行时还没下完」");
  ok(/confirm !== true/.test(domain) && /apkstart:purge/.test(domain),
    "purge 必须显式 confirm（破坏性通道）");
  ok(/"exec-out", "screencap", "-p"/.test(domain), "截屏走 adb exec-out screencap");
  ok(/\["-s", device\.serial, "logcat", "-d", "-t"/.test(domain), "logcat 按当前设备读取");
  ok(/portOpen\(/.test(domain) && /\["connect", `127\.0\.0\.1:\$\{port\}`\]/.test(domain),
    "adb server 端口不一致时按 emulator 端口主动 connect");
}

/* ── ⑤ 模型工具 ──────────────────────────────────────────────── */
{
  const seg = codeOnly(read(SEG));
  ok(/name: "apkstart"/.test(seg), "dynamicTools 注册 apkstart");
  ok(/enum: \["status", "install", "launch", "screenshot", "logcat", "adb", "open"\]/.test(seg),
    "action 枚举与执行端分支一致");
  const req = codeOnly(read(REQ));
  ok(req.includes('event.params?.tool === "apkstart"'), "分发分支在（tool 名完全一致）");
  for (const method of ["apkstartStatus", "apkstartInstall", "apkstartLaunch", "apkstartScreenshot", "apkstartLogcat", "apkstartAdb", "apkstartOpen"]) {
    ok(req.includes(`window.codex.${method}(`), `分发调用 window.codex.${method}`);
  }
  ok(/result\?\.ok === true \|\| result\?\.pending === true/.test(req),
    "install pending 不判失败，但文案明确「未确认完成」");
}

/* ── ⑥ 设置页 / 技能 / 指令 ───────────────────────────────────── */
{
  const page = codeOnly(read(PAGE));
  ok(/"apkstart"/.test(page) && /<ApkStartCard/.test(page), "二级弹窗挂 ApkStartCard");
  ok(/title: "ApkStart 安卓运行器"/.test(page), "一级卡片出现在开发工具页");
  const groups = codeOnly(read(GROUPS));
  ok(/DEDICATED_IDS = \[[^\]]*"apkstart"/.test(groups), "专用卡不进分组重复出卡");
  const skills = read("electron/builtin-skills.ts");
  ok(/\["android-emulator", ANDROID_EMULATOR_SKILL\]/.test(skills), "内置技能 android-emulator 已注册");
  ok(/android-emulator/.test(read("electron/builtin-skills/00-skill-zh-notes.ts")), "技能中文导读在");
  const instructions = codeOnly(read("electron/developer-instructions.ts"));
  ok(/if \(input\.apkstartInstalled\) text \+= APKSTART_INSTRUCTIONS/.test(instructions),
    "开发者指令条件注入（装了才讲用法）");
  const caller = codeOnly(read("electron/main/12-skill-discipline.ts"));
  ok(/apkstartInstalled: Boolean\(devRuntimeSpecs\.apkstart && runtimeInstalled\("apkstart", devRuntimeSpecs\.apkstart\)\)/.test(caller),
    "注入条件与运行时判定同源（runtimeInstalled）");
}

  const runtimeSrc = codeOnly(read(RUNTIME));
  ok(runtimeSrc.includes("fetchGitHubAssetDigest(APKSTART_REPO, asset, version)"),
    "SHA256 按目标版本查（⛔ 不是永远查 latest，否则装旧版会误报校验失败）");
  const domainSrc = codeOnly(read(DOMAIN));
  ok(domainSrc.includes("ready ? findDevice()") && domainSrc.includes("port <= 5565"),
    "运行时未就绪时不扫端口；扫描窗口收到 4 秒/6 个端口（打开卡片不长时间转圈）");
console.log("");
console.log(fails === 0
  ? `【apkstart】通过（${checks} 条）`
  : `【apkstart】失败：${fails}/${checks} 条`);
process.exit(fails === 0 ? 0 : 1);
