/**
 * 12bp-openmaic —— OpenMAIC 互动课堂的「安装 → 启停 → 工具 → 界面」全链路守卫（11-14）。
 *
 * 用户令「github 上的 openmaic 跟上面一样也帮我放到开发工具，按需下载，配套好工具，顺便在我电脑安装」。
 * 钉住：
 *   ① 开发工具链：源码 + pnpm/便携 PG 本机构建；数据与程序分开（卸载可保留课程）；
 *   ② 端口/就绪：PG 与 Web 都做空闲探测 + 端口等待，服务只监听 127.0.0.1；
 *   ③ 私密边界：模型 Key 只由用户在网页里填，宿主不读不写不转发；
 *   ④ 生成是异步：POST 拿 jobId，job 轮询；缺模型翻成可执行中文；
 *   ⑤ 通道三处一致（域文件 / manifest / registry）+ 组合表启用；
 *   ⑥ 模型工具 openmaic（action 枚举）真注册且分发到宿主；
 *   ⑦ 设置页卡片、内置技能、开发者指令条件注入；
 *   ⑧ 破坏性 purge 必须显式 confirm。
 *
 * ⛔ 独立守卫（不进 _ctx MODULES 计数），必须同时加进 package.json 的 check 链。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log(`  ${c ? "✓" : "✗"} 【openmaic】${m}`); if (!c) fails++; };
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const codeOnly = (s) => String(s)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const DOMAIN = "electron/features/openmaic-ipc.ts";
const RUNTIME = "electron/features/runtime-ipc.ts";
const INSTALL = "electron/openmaic-install.ts";
const DEVRUN = "electron/features/dev-runtimes.ts";
const SEG = "src/features/app-state/parts/part08/01-seg.tsx";
const REQ = "src/features/app-state/parts/part05/event-router/02-request.tsx";
const PAGE = "src/features/settings-devtools/DevtoolsSettingsSection.tsx";
const GROUPS = "src/features/settings-devtools/runtime-groups.tsx";

/* ── ① 开发工具链与安装 ───────────────────────────────────────── */
{
  const dev = codeOnly(read(DEVRUN));
  ok(/openmaic: \{ name: "OpenMAIC 互动课堂"[\s\S]{0,500}?marker: "openmaic\\\\app\\\\\.next\\\\BUILD_ID"/.test(dev),
    "开发工具规格表有 openmaic 且 marker 指向构建产物 BUILD_ID");
  ok(/DARWIN_HIDDEN = new Set<DevRuntimeId>\(\[[^\]]*"openmaic"/.test(dev),
    "mac 隐藏（便携 PostgreSQL 目前只做 Windows）");
  const runtime = codeOnly(read(INSTALL));
  ok(/export const OPENMAIC_REPO = "THU-MAIC\/OpenMAIC"/.test(runtime), "仓库地址单一真相源");
  ok(/async function installOpenMaicFromGitHub[\s\S]{0,400}?process\.platform !== "win32"/.test(runtime),
    "安装函数自行拒绝非 Windows");
  ok(runtime.includes("codeload.github.com/${OPENMAIC_REPO}/tar.gz/${commit}")
    && runtime.includes("refs/tags/v${version}") && runtime.includes("fetchTagCommit"),
    "源码按 tag→commit 寻址下载（拿不到 commit 才回退 tag，走镜像序）");
  const omCard = codeOnly(read("src/features/settings-devtools/OpenMaicCard.tsx"));
  ok(omCard.includes("wasHealthyRef") && omCard.includes("handleUpdated") && omCard.includes('run("start")'),
    "更新前服务在跑则更新后自动拉回（⛔ 不把用户晾在「未运行」）");
  ok(/\["-xzf", archive, "-C", staging\]/.test(runtime), "源码用 tar 解压");
  ok(/npmCli, "install", "--prefix", paths\.runtime[\s\S]{0,200}?"--ignore-scripts"/.test(runtime),
    "pnpm / 便携 PostgreSQL 走 npm 安装（--ignore-scripts：二进制已在包里）");
  ok(/writePnpmShim\(paths\.runtime, nodeExe\)/.test(runtime) && /pnpm\.cmd/.test(runtime),
    "写 pnpm.cmd shim（否则仓库 postinstall 找不到 pnpm）");
  ok(/pnpmCli, "install", "--config\.confirmModulesPurge=false"/.test(runtime), "依赖安装走本地 pnpm");
  ok(/pnpmCli, "build"/.test(runtime), "构建走 pnpm build");
  ok(/\.next", "cache"/.test(runtime) && /"standalone"/.test(runtime), "装完删构建缓存与 standalone（省约 1.7GB）");
  ok(/openmaic-data/.test(runtime) && /writeToolsRoot\(\), "openmaic"/.test(runtime),
    "程序落 tools/openmaic、数据落 userData/openmaic-data（卸载可保留课程）");
  ok(/id === "openmaic"[\s\S]{0,300}?installOpenMaicFromGitHub/.test(codeOnly(read(RUNTIME))), "runtime:install 有 openmaic 分支");
}

/* ── ② 启停与端口 ─────────────────────────────────────────────── */
{
  const domain = codeOnly(read(DOMAIN));
  ok(/127\.0\.0\.1/.test(domain) && !/0\.0\.0\.0/.test(domain), "服务只监听 127.0.0.1（不对外网开放）");
  ok(/nextBin, "start", "-p", String\(port\)/.test(domain), "用随包 Node 起 next start");
  ok(/pickFreePort\(/.test(domain) && /waitLocalPort\(/.test(domain), "Web/PG 端口都做空闲探测与就绪等待");
  ok(/pg_ctl\.exe/.test(domain) && /\[\"-D\", pgData, \"stop\", \"-m\", \"fast\"\]/.test(domain), "PG 启停成对");
  ok(/app\.on\("before-quit", onQuit\)/.test(domain) && /pg_ctl\.exe/.test(domain) && /killPort\(/.test(domain),
    "宿主退出时停服务与 PG（before-quit；不留孤儿进程）");
}

/* ── ③ 私密边界 ───────────────────────────────────────────────── */
{
  const domain = codeOnly(read(DOMAIN));
  ok(!/apiKey\s*[:=]|process\.env\.\w*API_KEY|sk-[A-Za-z0-9]{10}/.test(domain), "⛔ 宿主代码不读不写模型 Key（Key 只由用户在网页设置里填）");
  const installSrc = codeOnly(read(RUNTIME));
  ok(!/OPENAI_API_KEY=sk-/.test(installSrc), "⛔ 安装流程不写任何 Key 到 .env.local");
}

/* ── ④ 生成 / 轮询 / 破坏性通道 ───────────────────────────────── */
{
  const domain = codeOnly(read(DOMAIN));
  ok(/\/api\/generate-classroom/.test(domain) && /method: "POST"/.test(domain), "提交生成走官方 API（POST）");
  ok(/`\/api\/generate-classroom\/\$\{encodeURIComponent\(jobId\)\}`/.test(domain), "轮询走官方 API（GET jobId）");
  ok(/explainGenerateError\(/.test(domain) && /MISSING_MODEL/.test(domain), "缺模型翻成可执行中文指引");
  ok(/confirm !== true/.test(domain) && /openmaic:purge/.test(domain), "purge 必须显式 confirm");
  ok(/setCookie|getSetCookie|cookieJar/.test(domain), "复用同一个 cookie（owner 一致才能轮询到自己的任务）");
}

/* ── ⑤ 通道三处一致 ───────────────────────────────────────────── */
const EXPECTED = ["openmaic:status", "openmaic:start", "openmaic:stop", "openmaic:open", "openmaic:generate", "openmaic:job", "openmaic:purge"];
{
  const domain = codeOnly(read(DOMAIN));
  ok(EXPECTED.every((ch) => domain.includes(`"${ch}"`)), "域文件注册全部 7 条通道");
  const registry = read("electron/ipc-registry.ts");
  const row = registry.match(/\{ prefix: "openmaic", count: (\d+)[\s\S]*?channels: \[([^\]]+)\]/);
  ok(Boolean(row) && Number(row[1]) === EXPECTED.length, "ipc-registry 的 count = 7");
  ok(Boolean(row) && EXPECTED.every((ch) => row[2].includes(ch)), "ipc-registry 的 channels 逐条对得上");
  const manifest = read("electron/ipc-channels.manifest.json");
  ok(EXPECTED.every((ch) => manifest.includes(`"channel": "${ch}"`)), "manifest 有全部 7 条通道");
  const composition = read("electron/composition.json");
  ok(/"id": "openmaic"[\s\S]{0,200}?"file": "features\/openmaic-ipc\.ts"[\s\S]{0,80}?"export": "openMaicFeature"/.test(composition),
    "组合表启用 openmaic（export 与域文件一致）");
}

/* ── ⑥ 模型工具 ──────────────────────────────────────────────── */
{
  const seg = codeOnly(read(SEG));
  ok(/name: "openmaic"/.test(seg), "dynamicTools 注册 openmaic");
  ok(/enum: \["status", "start", "stop", "open", "generate", "job"\]/.test(seg), "action 枚举与执行端分支一致");
  const req = codeOnly(read(REQ));
  ok(req.includes('event.params?.tool === "openmaic"'), "分发分支在（tool 名完全一致）");
  for (const method of ["openmaicStatus", "openmaicStart", "openmaicStop", "openmaicOpen", "openmaicGenerate", "openmaicJob"]) {
    ok(req.includes(`window.codex.${method}(`), `分发调用 window.codex.${method}`);
  }
  ok(/不要循环死等|别循环|隔一会儿/.test(seg + req), "工具文案明确「异步、不要死等」");
}

/* ── ⑦ 设置页 / 技能 / 指令 ──────────────────────────────────── */
{
  const page = codeOnly(read(PAGE));
  ok(/"openmaic"/.test(page) && /<OpenMaicCard/.test(page), "二级弹窗挂 OpenMaicCard");
  ok(/title: "OpenMAIC 互动课堂"/.test(page), "一级卡片出现在开发工具页");
  const groups = codeOnly(read(GROUPS));
  ok(/DEDICATED_IDS = \[[^\]]*"openmaic"/.test(groups), "专用卡不进分组重复出卡");
  const skills = read("electron/builtin-skills.ts");
  ok(/\["openmaic", OPENMAIC_SKILL\]/.test(skills), "内置技能 openmaic 已注册");
  ok(/openmaic/.test(read("electron/builtin-skills/00-skill-zh-notes.ts")), "技能中文导读在");
  const instructions = codeOnly(read("electron/developer-instructions.ts"));
  ok(/if \(input\.openmaicInstalled\) text \+= OPENMAIC_INSTRUCTIONS/.test(instructions), "开发者指令条件注入");
  const caller = codeOnly(read("electron/main/12-skill-discipline.ts"));
  ok(/openmaicInstalled: Boolean\(devRuntimeSpecs\.openmaic && runtimeInstalled\("openmaic", devRuntimeSpecs\.openmaic\)\)/.test(caller),
    "注入条件与运行时判定同源");
}


/* ── ⑧ 卡片内更新 ─────────────────────────────────────────────── */
{
  const UPD = "src/features/settings-devtools/RuntimeUpdateRow.tsx";
  const ui = codeOnly(read(UPD));
  ok(/checkRuntimeUpdate\(/.test(ui) && /updateRuntime\(/.test(ui) && /onRuntimeProgress\(/.test(ui),
    "统一更新行走既有 runtime:update-check / runtime:update（不另造下载器）");
  ok(/installed && autoCheck/.test(ui), "打开卡片自动检查一次（未安装不查）");
  for (const [file, id] of [
    ["src/features/settings-devtools/FileeCard.tsx", "filee"],
    ["src/features/settings-devtools/ApkStartCard.tsx", "apkstart"],
    ["src/features/settings-devtools/OpenMaicCard.tsx", "openmaic"],
    ["src/features/settings-devtools/FeishuCliCard.tsx", "feishu-cli"],
  ]) {
    const card = codeOnly(read(file));
    ok(/<RuntimeUpdateRow/.test(card) && new RegExp('id="' + id + '"').test(card), file + " 内置更新行（" + id + "）");
  }
  const runtime = codeOnly(read(RUNTIME));
  ok(/openmaic: \{ repo: OPENMAIC_REPO, label: "OpenMAIC 互动课堂", platforms: \["win32"\], install: installOpenMaicFromGitHub \}/.test(runtime),
    "OpenMAIC 进 GITHUB_UPDATEABLE（检查更新能查到最新 tag）");
  ok(/if \(id === "openmaic"\) return openmaicInstalledVersion\(\)/.test(runtime), "已装版本读 version.txt（不会永远提示有更新）");
  ok(/stopOpenMaicProcesses\(\)/.test(codeOnly(read(INSTALL))), "更新/重装前先停服务与 PG（否则目录被锁改名失败）");
}

  const updateUi = codeOnly(read("src/features/settings-devtools/RuntimeUpdateRow.tsx"));
  ok(updateUi.includes("cancelled") && updateUi.includes("finally") && updateUi.includes("void check();"),
    "更新行在取消/joined 后也会收尾（⛔ 不能只靠 done 事件，否则永远停在「正在更新」）");
/* ⛔⛔ 11-15 用户实录「卸载直接把应用干死」（Windows 弹 Electron 未响应）：
   OpenMAIC 装完有几十万个小文件，卸载用同步递归 readdirSync/statSync 遍历整棵树，
   pip 卸载还用 spawnSync 在主进程同步等 180 秒 —— 事件循环被整段堵住。 */
const runtimeIpcForUninstall = codeOnly(read("electron/features/runtime-ipc.ts"));
ok(!/readdirSync\(dir, \{ withFileTypes: true \}\)/.test(runtimeIpcForUninstall)
  && /await fs\.readdir\(dir, \{ withFileTypes: true \}\)/.test(runtimeIpcForUninstall),
  "卸载遍历大目录改异步 + 分批让出事件循环（⛔ 同步递归 = 应用假死）");
ok(!/spawnSync\(\s*py, \["-m", "pip", "uninstall"/.test(runtimeIpcForUninstall)
  && /spawn\(py, \["-m", "pip", "uninstall"/.test(runtimeIpcForUninstall),
  "pip uninstall 改异步 spawn（⛔ 主进程同步等 180 秒 = 界面无响应）");
ok(/runtimeInstalls\.has\(id\)\) throw new Error/.test(runtimeIpcForUninstall),
  "安装进行中拒绝卸载（避免安装与卸载同时读写同一个 5GB 目录）");
ok(/recordInstallFailure\(idValue, "install", error\)/.test(runtimeIpcForUninstall),
  "安装失败把完整 stack 落盘 install-errors.log（界面只有一行截断文案）");
const installSrc = codeOnly(read("electron/openmaic-install.ts"));
const catchPart = installSrc.slice(installSrc.indexOf("} catch (error) {"), installSrc.indexOf("} finally {"));
ok(catchPart.includes("if (backup && existsSync(backup)) {")
  && catchPart.indexOf("if (backup && existsSync(backup)) {") < catchPart.indexOf("await fs.rm(paths.app"),
  "安装失败只在确实换入过新目录时回滚（⛔ 下载/解压阶段失败不许删掉用户已装好的版本）");
ok(/disabled=\{uninstalling \|\| installing\}/.test(read("src/features/settings-devtools/OpenMaicCard.tsx")),
  "安装中禁用卸载按钮（第一道防线，主进程互斥是第二道）");
/* ⛔⛔ 11-15 真机探针复现「能下载、安装不行」：裸名 tar 命中 PortableGit 的 GNU tar，
   它把 Windows 盘符 C: 当远程主机 ⇒ `Cannot connect to C: resolve failed`，97MB 源码下完却死在解压。 */
ok(/runOpenMaicStep\(id, tarExecutable\(\), \["-xzf"/.test(installSrc)
  && !/runOpenMaicStep\(id, "tar",/.test(installSrc),
  "OpenMAIC 解压走 tarExecutable()（⛔ 不许退回裸名 tar）");
ok(/export function tarExecutable\(\)/.test(read("electron/toolchain.ts"))
  && /spawn\(tarExecutable\(\), \["-xzf"/.test(runtimeIpcForUninstall)
  && /tarExecutable\(\), \["-xzf", tarballPath/.test(read("electron/engine-updater.ts")),
  "tar 可执行文件单一真相源：三处解压共用 toolchain.tarExecutable");
ok(/readdir\(staging, \{ withFileTypes: true \}\)/.test(installSrc)
  && /entry\.isDirectory\(\)/.test(installSrc)
  && !/\(await fs\.readdir\(staging\)\)\.find/.test(installSrc),
  "解压后只认目录（⛔ 不许把 .tar.gz 归档当目录读 package.json）");

/* ── 安装不许「卡住半小时」（11-22 用户实测）────────────────────────────────
   ⛔ 实测根因：`pg_ctl start` 会拉起 postgres.exe 并让它继承父进程管道 ⇒ 父进程 exit 了但
     `close` 永不触发（本机实测 exit 326ms、close 6 秒内不来），旧代码 `on("close", resolve)`
     就永远悬着，界面停在上一句「正在下载 pnpm…」的 20%。三条一起钉：
     ① 拉起常驻服务的命令必须 stdio:"ignore" + 等 exit；
     ② 每个安装步骤都要有卡死看门狗（N 分钟无输出即中止），不许无限等；
     ③ 每个阶段都要报 stage/progress，别让界面停在上一句。 */
{
  const install = codeOnly(read(INSTALL));
  ok(/function waitChildExit\(/.test(install)
    && /pg_ctl\.exe"\), \["-D", pgData, "status"\], \{ windowsHide: true, stdio: "ignore" \}\)/.test(install)
    && /stdio: "ignore" \}\);?\s*\n\s*trackRuntimeProc\(id, child\)/.test(install),
    "pg_ctl 一律 stdio:ignore + 等 exit（⛔ on(\"close\") 会被 postgres 继承的管道挂死）");
  ok(!/child\.on\("close", \(\) => resolve\(\)\)/.test(install),
    "⛔ 不再用 child.on(\"close\") 等起服务的命令");
  ok(/const STEP_STALL_MS = \d+_000/.test(install) && /STEP_STALL_MS\)/.test(install)
    && /没有任何输出/.test(install),
    "安装步骤有卡死看门狗（3 分钟无输出即中止并带出最后几行，不许无限等）");
  ok(/stdio: \["ignore", "pipe", "pipe"\]/.test(install),
    "步骤的 stdin 关掉（initdb/pnpm 若等读 stdin 会永远挂住）");
  ok(/@@STAGE 初始化本地数据库/.test(install) && /@@STAGE 启动本地数据库/.test(install)
    && /@@PROGRESS 25/.test(install),
    "每个阶段都上报 stage/progress（界面不会停在上一句的 20%）");
}

console.log("");
console.log(fails === 0
  ? `【openmaic】通过（${checks} 条）`
  : `【openmaic】失败：${fails}/${checks} 条`);
process.exit(fails === 0 ? 0 : 1);
