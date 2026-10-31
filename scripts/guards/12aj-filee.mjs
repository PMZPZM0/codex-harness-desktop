/**
 * Filee 文件转换判据（10-30 立，16 条）
 *
 * Filee（KnifeLemon/Filee，MIT，.NET 10）：本地 244 种格式离线转换，GitHub release 直下型安装
 * （win-Portable.zip 约 151MB，镜像序 + SHA256 校验），CLI = filee-cli.exe（--json 结构化输出）。
 *
 * ⛔ 钉死的三类不变量：
 *   ① 安装/更新链：镜像序必须复用 gh-mirror.mirrorCandidates（⛔ 不许在 Filee 分支手写第二份镜像序）；
 *     SHA256 校验不能省；151MB 大包**不许进后台自动更新**（autoUpdateItems 只认配了开关的工具）。
 *   ② Codex 工具链：dynamicTool filee_convert 注册/分发 → filee:convert（spawn 参数数组不进 shell）
 *     → developer_instructions 的第 5 条只在 fileeInstalled 时注入。
 *   ③ UI：开发工具页入口卡 + 二级弹窗 + FileeCard（卸载弹窗、不判可信根的直通口径写在域文件头）。
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
  console.log(`  ${condition ? "✓" : "✗"} 【filee】${message}`);
  if (!condition) fails++;
};

const runtimes = codeOnly(read("electron/features/dev-runtimes.ts"));
const runtimeIpc = read("electron/features/runtime-ipc.ts"); // 注释也参与（进度协议锚在注释里没有）
const fileeIpc = codeOnly(read("electron/features/filee-ipc.ts"));
const part08 = codeOnly(read("src/features/app-state/parts/part08/01-seg.tsx"));
const part05Req = codeOnly(read("src/features/app-state/parts/part05/event-router/02-request.tsx"));
const devInstr = codeOnly(read("electron/developer-instructions.ts"));
const discipline = codeOnly(read("electron/main/12-skill-discipline.ts"));
const devtools = codeOnly(read("src/features/settings-devtools/DevtoolsSettingsSection.tsx"));
const fileeCard = codeOnly(read("src/features/settings-devtools/FileeCard.tsx"));
const autoUpdate = codeOnly(read("electron/features/auto-update-ipc.ts"));
const versions = read("scripts/lib/tools-versions.cjs");

/* ── 一、runtime 卡与安装/更新链 ─────────────────────────────────────────── */
{
  ok(/filee: \{ name: "Filee 文件转换"/.test(runtimes) && /marker: "filee\\\\filee-cli\.exe"/.test(runtimes),
    "dev-runtimes 有 filee 规格（marker = filee\\filee-cli.exe，卸载按首段删 tools/filee）");
  ok(/filee: "2\.2\.0"/.test(versions), "tools-versions 钉了 filee 版本（单一来源）");
  ok(runtimeIpc.includes("async function installFileeFromGitHub") && runtimeIpc.includes("const GITHUB_UPDATEABLE"),
    "runtime-ipc 有 GitHub 直下型安装函数与更新清单");
  ok(/mirrorCandidates\(/.test(runtimeIpc.split("installFileeFromGitHub")[1]?.split("const GITHUB_UPDATEABLE")[0] ?? "")
    && !/gh-proxy\.com\/|ghfast\.top\//.test(runtimeIpc.split("async function installFileeFromGitHub")[1]?.split("const GITHUB_UPDATEABLE")[0] ?? ""),
    "⛔ 安装/更新走 gh-mirror.mirrorCandidates 镜像序（不在 Filee 分支手写第二份镜像前缀）");
  ok(runtimeIpc.includes("SHA256") && runtimeIpc.includes("createHash(\"sha256\")") && runtimeIpc.includes("Filee-${version}-SHA256SUMS.txt"),
    "151MB 大包下载后做 SHA256 校验（release 自带校验表，也是镜像序拉取）");
  ok(runtimeIpc.includes('filee: ["--version"]'), "health 自检让 filee-cli 自报版本");
  ok(runtimeIpc.includes("fileeVersionFile()") && runtimeIpc.includes('writeFile(fileeVersionFile(), version'),
    "安装后落盘 version.txt（更新链的已装版本来源，不靠 spawn 自报）");
  ok(runtimeIpc.includes("id === \"filee\"") && /installFileeFromGitHub\(id, TOOLS_VERSIONS\.filee \?\?/.test(runtimeIpc),
    "runtime:install 有 filee 分支（版本钉 tools-versions，读不到时回落 GitHub 最新 tag）");
  ok(runtimeIpc.includes("const latest = await fetchGitHubLatestTag(gh.repo)") && runtimeIpc.includes("await installFileeFromGitHub(id as DevRuntimeId, latest)"),
    "runtime:update 的 GitHub 分支 = 查最新 tag 重跑同一条安装函数（手动链=自动链物理同一份）");
  // ⛔ 151MB 不许后台偷下：自动更新清单只认配了开关的工具（autoUpdateItems 的 toolKeys 没有 filee）
  ok(!/"filee":\s*"autoUpdate/.test(autoUpdate) && !/filee/.test(autoUpdate),
    "⛔ Filee 不进后台自动更新循环（151MB 只能在控制台/卡片手动更新）");
}

/* ── 二、Codex 工具链（注册 → 分发 → IPC → 指令）──────────────────────────── */
{
  ok(part08.includes('name: "filee_convert"') && part08.includes('"inputs", "to"'),
    "dynamicTool filee_convert 已注册（inputs/to 必填；无条件注册，未装由执行端指引）");
  ok(part08.includes("heic") && part08.includes("epub") && part08.includes("dwg") && part08.includes("3D"),
    "工具描述列了常用格式对（模型选 --to 全靠它；关键域：图片/电子书/CAD/3D）");
  ok(part05Req.includes('event.params?.tool === "filee_convert"') && part05Req.includes("window.codex.fileeConvert("),
    "事件分发把 filee_convert 转给 filee:convert（回执以 --json 结构化为准）");
  ok(fileeIpc.includes('spawn(binary, args,') && !/shell:\s*true/.test(fileeIpc),
    "⛔ filee-ipc spawn 用参数数组、不开 shell（模型传入的路径是注入面）");
  ok(fileeIpc.includes('"convert", ...inputs, "--to", to, "--json"'),
    "convert 恒带 --json（结构化结果 converted/skipped/failed/files[].outputs 是唯一判据）");
  ok(fileeIpc.includes("code: 2") && /result\.code === 1/.test(fileeIpc) && fileeIpc.includes("failedItems"),
    "CLI exit code 口径：2=参数错、1=有文件失败（不算宿主坏，回 failed 明细）");
  ok(/input\.fileeInstalled\) text \+= FILEE_INSTRUCTIONS/.test(devInstr) && devInstr.includes("const FILEE_INSTRUCTIONS"),
    "developer_instructions 第 5 条只在 fileeInstalled 时注入（原 describe_image 撤后的空位）");
  ok(discipline.includes('runtimeInstalled("filee", devRuntimeSpecs.filee)'),
    "devInstructionsInput 复用 runtimeInstalled 判 fileeInstalled（单一真相源，不另探一次）");
}

/* ── 三、UI 与清单对账 ───────────────────────────────────────────────────── */
{
  ok(devtools.includes('openCard === "filee"') && devtools.includes("<FileeCard") && devtools.includes("import { FileeCard }"),
    "开发工具页有 Filee 入口卡 + 二级弹窗挂 FileeCard");
  ok(fileeCard.includes('installDevRuntime?.("filee")') && fileeCard.includes("window.codex.onRuntimeProgress") && fileeCard.includes('payload?.id !== "filee"'),
    "FileeCard 安装走 runtime:install（filee id），done 后重读状态（装完界面不停在未安装）");
  ok(fileeCard.includes("setUninstallOpen") && fileeCard.includes("SettingsDialog") && fileeCard.includes('uninstallDevRuntime?.("filee")'),
    "卸载走设置内二级弹窗确认（⛔ 不用原生 confirm / openAppConfirm，飞书卡同款口径）");
  ok(fileeCard.includes("控制台 → 组件更新") && fileeCard.includes("runtime-row"),
    "卡片指路控制台更新 + 行结构用 runtime-row（自造样式没有 CSS，飞书卡教训）");
  // ⛔ 10-31 补审查（发现 1）：声明区 URL 必须由主进程下发 —— 前端硬编码 github 字面量 = 第二真相源
  ok(fileeIpc.includes("attribution: { license: \"MIT\", home: `https://github.com/${FILEE_REPO}`, site: FILEE_SITE }")
    && /export const FILEE_REPO/.test(runtimeIpc),
    "filee:status 下发 attribution（仓库地址单一真相源 = runtime-ipc 导出的 FILEE_REPO）");
  ok(!/github\.com\/KnifeLemon/.test(fileeCard) && fileeCard.includes("status.attribution.home"),
    "⛔ FileeCard 不硬编码 GitHub 字面量（跳转按钮消费 status.attribution）");
}

console.log("");
console.log(fails === 0 ? `12aj Filee 守卫：全部通过（${checks}/${checks}）` : `12aj Filee 守卫：${fails} 项未通过（共 ${checks} 项）`);
process.exit(fails === 0 ? 0 : 1);
