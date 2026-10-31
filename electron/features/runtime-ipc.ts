/**
 * runtime-ipc（10-03 从 `features/engine-ipc/03-dev-runtime` + `04-dev-runtime-install` 合并成单前缀板块，
 * 同时改为**插件形态**）
 *
 * 域：runtime(7)
 * 通道：runtime:list / install / uninstall / cancel / health / update-check / update
 *
 * ⛔⛔ 四条实证口径（本次纯搬迁，一字未改）：
 *   1. **卸载落点不能按 marker 首段推导**（10-01 用户报「卸载不真」的根因）：首段会得到
 *      `tools/npm-global` 或 `tools/python` —— 那是多个 npm 包 / 整个 Python 运行时的**共同
 *      家目录**，卸载一个会把其它一起删光。npm 包要删「包体目录 + 它自己的 shim」。
 *   2. **ponytail 卸载/重装必须显式写 config.toml 的 enabled**：插件 key 是
 *      `"ponytail@ponytail"`（写成 "ponytail-plugin" 会静默无效）；且必须带 `mergeStrategy`
 *      —— 缺了整条请求被判 Invalid request，而这里是 `.catch(() => undefined)` 静默吞掉。
 *      install 分支必须把 enabled 置回 true（seedConfigSections 幂等，不会自己翻回 true）。
 *   3. **同一工具并发安装要「等它跑完」而不是抛错**（09-18 用户反馈）：抛错会让整批安装中断。
 *   4. **随包内置只认 zip，不回落在线下载**（09-12 实测发布包故障）：GitHub Release 那个
 *      automation-tools.zip 资产根本不存在，回落只会撞死地址 —— 装不上就当场说清楚。
 * ⛔ 自检（`runtime:health`）单项失败绝不抛出，探测带 8s 超时：一个工具探不通不能让整页崩。
 * ⛔ 待接缝化（阶段 2）：app / shell / spawn 为宿主能力。
 */
import fs from "node:fs/promises";
import { existsSync, readFileSync, readdirSync, statSync, createWriteStream } from "node:fs";
import { once } from "node:events";
import { createHash } from "node:crypto";
import path from "node:path";
import { spawn } from "node:child_process";
import { app, shell } from "electron";
import { CHINA_NPM_REGISTRY, bundledNode, bundledNpmCli, existingToolPath, npmGlobalRoot, npmGlobalRootCandidates, npmPackagePath, pythonPipReady, toolchainEnv, toolRootsRead, toolsRoot, userToolsRoot, writeToolsRoot } from "../toolchain";
import { mirrorCandidates } from "../gh-mirror";
import { installKbEmbedding, kbBackendDir, kbEmbeddingInstalled, uninstallKbEmbedding } from "./kb-embed-backend";
import { DARWIN_HIDDEN, DARWIN_MARKERS, DARWIN_SPEC_TEXT, IS_MAC, PIP_PACKAGE_DIRS, cancelRuntimeInstall, cleanupRuntimeTempFiles, clearCancelRequest, devRuntimeSpecs, emitRuntimeProgress, isCancelRequested, pipMetadataDirs, pythonSiteDir, readDownloadSource, requestRuntimeCancel, restartServerWhenIdle, runRuntimeInstaller, runtimeInstalled, runtimeInstaller, runtimeInstalls, trackRuntimeProc } from "./dev-runtimes";
import type { DevRuntimeId, DevRuntimeSpec } from "./dev-runtimes";
import { sendToWindow } from "./window-bus";
import { readAppSettings, saveAppSettings } from "../app-settings";
import type { AppSettings } from "../app-settings";
import { healPonytailInstall } from "../ponytail-heal";
import { layaInstall } from "./laya-service";
import { installPhoneHarness } from "./phone-harness";
import { codexHome, server } from "../runtime-refs";
import { defineFeature } from "../context";
import { recordToolRemoved } from "./tool-persistence";
import type { IpcHost } from "../ipc-host";
// 版本比较统一走 `../updates`（含预发布语义：1.2.3-beta < 1.2.3）——⛔ 别再写第二份。
import { compareVersions } from "../updates";
/* ⛔⛔ 10-30 Windows 真机事故（0.0.51 装了打不开，用户截图：Cannot find module
   '../../scripts/lib/tools-versions.cjs'）：这张**版本表**原先在模块顶层裸 require，而 build.files
   白名单里没有 scripts/** ⇒ 文件没进 asar ⇒ 主进程启动即死。两件事都要有：
   ① 已经把它加进 build.files（守卫【96】② /【288】钉住「产物树外的 require 必须被覆盖」）；
   ② 这里**降级**：读不到就给空表 —— 用到它的地方（飞书 CLI 的版本号）自己退化成 latest。
   ⛔ 原则：一张数据表读不到，绝不允许把应用搞崩（这条比"一定要读到"更重要）。 */
const TOOLS_VERSIONS: Record<string, string> = (() => {
  try {
    const loaded = (require("../../scripts/lib/tools-versions.cjs") as { TOOLS_VERSIONS?: Record<string, string> }).TOOLS_VERSIONS;
    return loaded && typeof loaded === "object" ? loaded : {};
  } catch (error) {
    console.warn("[runtime-ipc] 读不到 scripts/lib/tools-versions.cjs（打包缺文件？）—— 版本号退化为 latest", error);
    return {};
  }
})();

function specFor(id: DevRuntimeId, spec: DevRuntimeSpec): DevRuntimeSpec {
  if (!IS_MAC) return spec;
  const override = DARWIN_SPEC_TEXT[id];
  return override ? { ...spec, ...override } : spec;
}

function runtimeInstalledBySystem(id: DevRuntimeId): boolean {
  if (IS_MAC) {
    if (id === "git") return ["/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git"].some((p) => existsSync(p));
    if (id === "openssl") return existsSync("/usr/bin/openssl");
    // ⛔ mac 适配（09-17 审计）：Docker Desktop for Mac 装完是 /Applications/Docker.app，
    //    CLI 落在 /usr/local/bin/docker（或 Apple Silicon 的 /opt/homebrew/bin/docker）。
    //    旧实现只探测 Windows 的 docker.exe，mac 用户装好 Docker 也一直显示「未安装」。
    if (id === "docker") {
      return ["/usr/local/bin/docker", "/opt/homebrew/bin/docker", "/Applications/Docker.app"].some((p) => existsSync(p));
    }
    return false;
  }
  // docker 是系统级安装：未在工具目录时也探测系统 PATH 上的 docker.exe（已装则视为完成）
  return id === "docker" ? !!(process.env.PATH ?? "").split(path.delimiter).some((dir) => dir && existsSync(path.join(dir.trim(), "docker.exe"))) : false;
}

/* ── 「装不上就让 Codex 自己装」（10-08 用户要求）─────────────────────────────
 * 用户原话：「加一个开发工具备用方案，每个工具后面如果安装不上，可以预置一个提示词，提示用户，
 * 发 codex 自行安装就行，有的电脑网不好，容易下载报错」。
 * ⛔ 文案**只在主进程生成**（单一真相源）：渲染层只负责展示 + 复制，不许再拼一份 —— 否则又是
 *   「两处口径各自为政」（本项目当天刚栽过三次：见【286】/【241】）。
 * ⛔ 路径一律取自与「判定 / 卸载」同源的来源（toolsRoot / codexHome / kbBackendDir / pythonSiteDir /
 *   npmGlobalRoot），别再写第三套。
 * ⛔ 网络兜底文案里的镜像站必须与实际代码里用的**同一批**（npmmirror / 清华 pypi / 清华 miniconda），
 *   不要凭空发明源。 */

/** 该工具的「首选做法」一句话；没登记的走通用的一键脚本文案。 */
const FALLBACK_STEPS: Partial<Record<DevRuntimeId, string>> = {
  python: "删掉损坏的 python 目录后重跑一键脚本 —— 脚本装的是 python-build-standalone 整包（自带 pip 与 Tkinter），走 npmmirror 镜像",
  node: "重跑一键脚本装回内置 Node（体积不大，一般不会失败）",
  git: "重跑一键脚本装 MinGit（约 90 MB）：npmmirror 镜像优先，失败自动回落官方源",
  pwsh: "从 GitHub 的 PowerShell release 下 win-x64 的 zip（约 282 MB）后解压；下载慢就给链接加 gh-proxy / ghfast 加速前缀（一键脚本会自动这么干）",
  ffmpeg: "从 BtbN/FFmpeg-Builds 或 gyan.dev 下 win64 构建，取出 ffmpeg.exe 与 ffprobe.exe 放进去",
  mingw: "从 winlibs 的 release 下 winlibs-x86_64-posix-seh 的 zip（约 267 MB），解压后把里面的 mingw64 目录整体放进去",
  conda: "用清华镜像的 Miniconda3 Windows 安装器静默装到目标目录（清华镜像实测比官方站快很多）",
  markitdown: "在目标 python 下执行：python -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple \"markitdown[pdf,docx,pptx]\" openpyxl",
  laya: "在目标 python 下执行：python -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple laya[serve]（含 PyTorch，约 800 MB，要耐心等）",
  "phone-harness": "在目标 python 下执行：python -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple phone-harness，装完把它的 CLI 注册成引擎技能",
  "kb-embedding": "让 Codex 读项目里的工具链文档，用 npmmirror 装 npm 运行库、用 hf-mirror 下模型，都放目标目录",
  docker: "系统级安装：界面按钮会打开官网，按官网步骤装完需要重启电脑",
  openssl: "系统级安装：界面按钮会打开官网（slproweb 的 Windows 版），按官网步骤装",
  ponytail: "重跑一键脚本重新种插件（界面上的「修复安装」走的是同一条路）",
};

/**
 * mac 专用「首选做法」（10-30 全链路审计）。
 *
 * ⛔⛔ 上面那批文案是**按 Windows 写的**（MinGit / win-x64 zip / `.exe` / slproweb），而这段提示词
 *   会被用户**原样复制给 Codex 照着装** ⇒ 在 mac 上等于让模型去下 Windows 包，然后反复失败。
 *   只覆盖 darwin 上说法确实会错的条目；`mingw` 在 mac 已被隐藏（DARWIN_HIDDEN），不必覆盖。
 *   镜像站与 install-runtimes.cjs 的 mac 分支同源（清华 miniconda / 清华 pypi / evermeet 兜底）。
 */
const DARWIN_FALLBACK_STEPS: Partial<Record<DevRuntimeId, string>> = {
  git: "mac 不装 MinGit：直接用系统自带 git（随 Xcode 命令行工具）。若 `git --version` 报错就执行 `xcode-select --install`，系统弹窗里点安装，装完再验证一次",
  pwsh: "从 GitHub 的 PowerShell release 下 **osx-arm64 / osx-x64 的 tar.gz**（约 70 MB），解压后把 `pwsh` 可执行文件放进 tools/pwsh（mac 上没有 .exe 后缀、也不是 zip）",
  ffmpeg: "下 **darwin** 构建（ffmpeg-static 的 ffmpeg-darwin-<arch>.gz，或 evermeet 的 zip），把 `ffmpeg` 与 `ffprobe` 两个可执行文件放进 tools/ffmpeg/bin（无 .exe）",
  conda: "用清华镜像的 Miniconda3-**MacOSX**-<arch>.sh 安装器：`bash Miniconda3-*.sh -b -p <tools>/miniconda`（静默装到目标目录，不要用 Windows 安装器）",
  openssl: "mac 用系统自带的 LibreSSL（`/usr/bin/openssl`），一般无需安装；确实需要新版才 `brew install openssl` 并把它加进 PATH",
  markitdown: "在随包 python 下执行：`<tools>/python/bin/python3 -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple \"markitdown[pdf,docx,pptx]\" openpyxl`（mac 的 python 是 python3，没有裸 python）",
  laya: "在随包 python 下执行：`<tools>/python/bin/python3 -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple laya[serve]`（含 PyTorch，约 800 MB，要耐心等）",
  "phone-harness": "在随包 python 下执行：`<tools>/python/bin/python3 -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple phone-harness`，装完把它的 CLI 注册成引擎技能",
};

/** 该工具在本机平台的「首选做法」（darwin 先查专用表，其余沿用上面那份）。 */
function fallbackStepsOf(id: DevRuntimeId): string | undefined {
  return (process.platform === "darwin" ? DARWIN_FALLBACK_STEPS[id] : undefined) ?? FALLBACK_STEPS[id];
}

/** 发命令用的解释器与脚本路径：优先用随包 node（与主进程跑安装时同源）。
 *  ⛔ 10-08 自审改：**不要写成 `VAR="x" cmd`**（POSIX 写法在 Windows 的 cmd/PowerShell 里跑不了，
 *    而这份提示词恰恰是给 Windows 机器准备的）。改成「命令 + 需要时先设哪个环境变量」的自然语言，
 *    跨平台都读得懂，也不会让人照抄一条必然报错的命令。 */
function fallbackRunner(): string {
  const node = bundledNode() || "node";
  return `"${node}" "${runtimeInstaller("install-runtimes.cjs")}"（若脚本要求指定工具目录，先设环境变量 TOOLS_ROOT=${writeToolsRoot()}）`;
}

/** 「装到哪个目录」——按工具类型给**语义正确**的落点（⛔ 不是 marker 首段推导）。 */
function fallbackTargetDir(id: DevRuntimeId, spec: DevRuntimeSpec): string {
  if (id === "ponytail") return path.join(codexHome, "plugins", "cache");
  if (id === "kb-embedding") return kbBackendDir();
  if (PIP_PACKAGE_DIRS[id]) return path.join(writeToolsRoot(), "python");
  if (NPM_PACKAGE_ARTIFACTS[id]) return npmGlobalRoot() || path.join(writeToolsRoot(), "npm-global");
  if (spec.kind === "guide") return "系统安装目录（不在应用目录里）";
  // 其余落在 tools/<marker 首段> —— 与 runtimeUninstallTargets 的通用分支同源
  return path.join(writeToolsRoot(), spec.marker.split(/[\\/]/)[0]);
}

/** 装完怎么确认：可执行文件型给一条**真能跑**的验证命令（与自检同口径）。
 *  ⛔⛔ 不许按 marker 推导「该出现什么」：pip 包的 marker 是**占位**（见 dev-runtimes 的注释），
 *    照它拼出来的 `tools\markitdown` 是一个**根本不存在的路径** —— 这正是 10-08 当天修过的
 *    「marker 推导出不存在的路径」同款坑（探针真跑时当场抓到，不能只看类型通过就发）。 */
function fallbackExpectLine(id: DevRuntimeId, spec: DevRuntimeSpec): string {
  if (id === "ponytail") return `这个目录存在：${path.join(codexHome, "plugins", "cache", "ponytail")}`;
  if (id === "kb-embedding") return `这个目录存在（npm 包 + worker + 模型三件齐）：${kbBackendDir()}`;
  if (PIP_PACKAGE_DIRS[id]) {
    const site = pythonSiteDir(path.join(writeToolsRoot(), "python"));
    const pkg = PIP_PACKAGE_DIRS[id]!;
    return site
      ? `这个包目录存在：${path.join(site, pkg)}；也可以跑 python -c "import ${pkg}" 看能不能导入`
      : `在 ${path.join(writeToolsRoot(), "python")} 下跑 python -m pip show ${pkg} 确认`;
  }
  if (spec.kind === "guide") {
    return `在终端跑 ${id === "docker" ? "docker --version" : "openssl version"}，能打印版本就说明装好了`;
  }
  if (NPM_PACKAGE_ARTIFACTS[id]) {
    const root = npmGlobalRoot() || path.join(writeToolsRoot(), "npm-global");
    const rel = NPM_PACKAGE_ARTIFACTS[id]!.dirs[0].replace(/^node_modules[\\/]/, "");
    return `这个目录存在：${path.join(root, rel)}`;
  }
  const args = HEALTH_ARGS[id];
  const file = healthExecPath(id, spec);
  if (!args) return `这个文件存在：${file}`;
  return `"${file}" ${args.join(" ")}（能打印版本就说明装好了）`;
}

/** 拼出「发给 Codex 让它自己装」的提示词。⛔ 只在主进程生成（渲染层只展示 + 复制）。 */
function fallbackPromptFor(id: DevRuntimeId, spec: DevRuntimeSpec): string {
  // MoeKoe 是系统级外部客户端：不能套用 install-runtimes.cjs 的「装到 tools/moekoe」模板。
  if (id === "moekoe") {
    return [
      "帮我在这台电脑上安装开发工具「MoeKoe Music（酷狗客户端）」。",
      "背景：应用里「设置 → 开发工具 → MoeKoe 音乐」有手动安装入口；如果下载失败，请按下面的首选做法继续。",
      "",
      "· 用途：外部酷狗客户端，Codex 通过它的 6521 API 搜歌/播放",
      process.platform === "darwin"
        ? "· 装到哪：/Applications/MoeKoe Music.app（无权限时回落 ~/Applications）；macOS 首次打开如被拦截，去「系统设置 → 隐私与安全性」允许"
        : "· 装到哪：默认 Program Files\\MoeKoe Music（可在安装向导里改盘）",
      "· 首选做法：在 Harness 会话里调用能力网关 moekoe_install（confirm=true），它会从官方下载源（music.moekoe.cn 同款 release，中国大陆走 gh-proxy 镜像）按系统/架构选包并启动安装；⛔ 不要用 install-runtimes.cjs（那里没有 moekoe，MoeKoe 也不是装到 tools 目录）。",
      "· 网络兜底：官方下载页 https://music.moekoe.cn/download.html 勾选「我是来自中国大陆（使用镜像加速下载）」，或给 GitHub 直链加 gh-proxy / ghfast 前缀；下载失败先删掉半截文件再完整重下（续传修不好坏文件）。",
      "· 装完请验证：MoeKoe Music 能启动，且 http://127.0.0.1:6521/register/dev 返回 dfid；把结果发给我。",
    ].join("\n");
  }
  const steps = fallbackStepsOf(id) ?? `重跑本机的一键安装脚本（一条命令只装这一个工具，脚本自带「国内镜像优先 + 逐通道回落 + 坏缓存先删」）：\n    ${fallbackRunner()} ${id}`;
  const head = spec.description.split("；")[0];
  const purpose = head.length > 70 ? `${head.slice(0, 70)}…` : head;
  const lines = [
    `帮我在这台电脑上装好开发工具「${spec.name}」。`,
    "背景：应用里「设置 → 开发工具」的按需下载在这台机器上总是失败（网络不稳），请你直接用命令行装；装不上的话就换国内镜像或加速源多试几次。",
    "",
    `· 用途：${purpose}`,
    `· 装到哪：${fallbackTargetDir(id, spec)}`,
    `· 首选做法：${steps}`,
    "· 网络兜底：npm 换 registry.npmmirror.com，pip 换 pypi.tuna.tsinghua.edu.cn，GitHub 直链加 gh-proxy / ghfast 加速前缀；下到一半失败就先删掉半截文件再完整重下（续传修不好坏文件）。",
    `· 装完请验证：${fallbackExpectLine(id, spec)}，并把命令输出发给我。`,
  ];
  if (spec.builtIn || spec.bundled) {
    lines.push("· 注意：这个工具本来是随应用内置的，如果只是文件损坏，优先从随包的备份/归档恢复，不要另外装一份不同版本。");
  }
  return lines.join("\n");
}

function runtimeList() {
  return (Object.entries(devRuntimeSpecs) as [DevRuntimeId, DevRuntimeSpec][])
    .filter(([id]) => !(IS_MAC && DARWIN_HIDDEN.has(id)))
    .map(([id, spec]) => ({
      id, ...specFor(id, spec),
      installed: runtimeInstalled(id, spec),
      installedBySystem: runtimeInstalledBySystem(id),
      installing: runtimeInstalls.has(id),
      // 装不上时的备用方案：预置一段可直接发给 Codex 的提示词（渲染层只展示 + 复制）
      fallbackPrompt: fallbackPromptFor(id, spec),
    }));
}

/** 卸载也要有进度（10-07 用户要求「不允许出现无响应状态」）：pw-browsers ~170MB / ffmpeg ~300MB
 *  这种大目录逐文件删要几秒，一句「正在卸载…」闷到结束就是无响应。
 *  做法：先盘点（收集全部文件 + 字节数），再分批删（每批 ~4MB 或 200 个文件），按字节比例发
 *  `runtime:progress`；删完文件再把（现在已空的）目录树整体摘掉。批次间 setImmediate 让事件循环
 *  喘口气，进度事件才能真的发出去。 */
async function removeTargetsWithProgress(id: DevRuntimeId, targets: string[]): Promise<void> {
  const jobs: { file: string; size: number }[] = [];
  let totalBytes = 0;
  const collectDir = (dir: string) => {
    let entries: import("node:fs").Dirent[];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const childPath = path.join(dir, entry.name);
      if (entry.isDirectory()) collectDir(childPath);
      else {
        let size = 0;
        try { size = statSync(childPath).size; } catch { /* 竞态：文件刚没了 */ }
        jobs.push({ file: childPath, size });
        totalBytes += size;
      }
    }
  };
  const roots: string[] = [];
  for (const target of targets) {
    const resolved = path.resolve(target);
    roots.push(resolved);
    let stat;
    try { stat = statSync(resolved); } catch { continue; } // 目标不在了 = 已经卸载好
    if (stat.isDirectory()) collectDir(resolved);
    else { jobs.push({ file: resolved, size: stat.size }); totalBytes += stat.size; }
  }
  sendToWindow("runtime:progress", { id, stage: "正在删除文件", percent: 0 });
  const BATCH_BYTES = 4 * 1024 * 1024;
  const BATCH_FILES = 200;
  let batch: string[] = [];
  let batchBytes = 0;
  let removedBytes = 0;
  let failedCount = 0;
  let firstFailure = "";
  const flush = async () => {
    const pending = batch;
    batch = [];
    batchBytes = 0;
    for (const file of pending) {
      // ⛔ 10-07：删除失败**必须计数**（原先一律 catch 掉）。Windows 上文件被占用（EBUSY/EPERM）
      //   时旧实现会「假装删成功」⇒ 界面回到「已安装」，用户只看到「卸载了但没变」。
      //   收尾时把失败样本抛给调用方 ⇒ 用户看到「卸载失败：文件被占用，请关闭占用它的程序后重试」。
      try {
        await fs.rm(file, { force: true });
      } catch (error) {
        failedCount++;
        if (!firstFailure) firstFailure = `${file}（${String((error as Error)?.message ?? error).slice(0, 80)}）`;
      }
    }
    if (totalBytes > 0) {
      const percent = Math.min(99, Math.round((removedBytes / totalBytes) * 100));
      sendToWindow("runtime:progress", { id, stage: "正在删除文件", percent });
    }
    await new Promise((resolve) => setImmediate(resolve));
  };
  for (const job of jobs) {
    batch.push(job.file);
    batchBytes += job.size;
    removedBytes += job.size;
    if (batchBytes >= BATCH_BYTES || batch.length >= BATCH_FILES) await flush();
  }
  if (batch.length) await flush();
  // 文件删完后摘目录树（recursive 对已空目录是瞬时操作，顺带兜走漏网文件）
  for (const root of roots) {
    try { await fs.rm(root, { recursive: true, force: true }); } catch (error) {
      failedCount++;
      if (!firstFailure) firstFailure = `${root}（${String((error as Error)?.message ?? error).slice(0, 80)}）`;
    }
  }
  // ⛔ 如实报错而不是「假装卸载成功」——失败最常见的原因是文件被占用（Windows 常驻子进程、
  //   浏览器内核缓存被引用），提示必须能指导用户下一步动作。
  if (failedCount > 0) {
    throw new Error(
      `有 ${failedCount} 个文件删不掉（常见原因：被其它程序占用）。首个失败：${firstFailure}`
      + " —— 请关闭占用它的程序（浏览器 / 后台工具）后重试，或重启应用再卸载。"
    );
  }
}

/** npm 包（nuphus / rea）的卸载落点：**包体目录 + 它自己的 shim**。
 *  ⛔⛔ 为什么不能按 marker 首段推导：marker 是 `npm-global\node_modules\@nuphus\nuphus-mcp\package.json`，
 *    首段推导会得到 `tools/npm-global` —— 那是几个 npm 能力的**共同家目录**，卸载一个会把其它一起删光。
 *  ⛔ 10-01 用户报「卸载不真」的根因：旧实现只删 `npm-global/<pkg>`（那是 **shim 文件**），
 *    真正的包体 `npm-global/node_modules/<pkg>` 原地不动 ⇒ 卡片显示「未安装」但包还在。 */
const NPM_PACKAGE_ARTIFACTS: Partial<Record<DevRuntimeId, { dirs: string[]; shims: string[] }>> = {
  nuphus: { dirs: ["node_modules/@nuphus"], shims: ["nuphus-mcp", "nuphus-call"] },
  // REA（10-13）：包体目录 + rea / rea-agents 两个 shim；删完引擎重启后 [mcp_servers.rea]
  // 段自动消失（custom-model-apply 按 reaServerScript() 的存在性生成，见 ownedMcpServers）。
  rea: { dirs: ["node_modules/rea-agents"], shims: ["rea", "rea-agents"] },
  // 飞书 CLI（10-29）：包体 @larksuite/cli + 前缀根上的 lark-cli / lark-cli.cmd
  "feishu-cli": { dirs: ["node_modules/@larksuite"], shims: ["lark-cli"] },
};

/** 需要放行 postinstall 的包（**只放行点名的包**，⛔ 不全局放开脚本）。
 *  ⛔ 安装与**在线更新**是两条调用路径，名单必须同一份 —— 只在安装分支放行的话，
 *    更新走的就是「装出空壳」（飞书 CLI 的二进制全靠 postinstall 下载）。 */
const NPM_ALLOW_SCRIPTS: Partial<Record<DevRuntimeId, string[]>> = {
  "feishu-cli": ["@larksuite/cli"],
};


/** npm 包在某个 npm-global 根下留的 shim（不是包体，删完包体要顺手清掉）。
 *  ⛔ 10-07：显式接 `globalRoot` 参数，不再内部取 `npmGlobalRoot()` ——
 *   卸载要遍历**全部候选落位**，内部只取一个就又回到「删不干净」的旧 bug。 */
function npmShimPaths(globalRoot: string, ...pkgs: string[]): string[] {
  const globalDir = path.dirname(globalRoot);
  const out: string[] = [];
  for (const pkg of pkgs) {
    out.push(
      path.join(globalDir, pkg),
      // ⛔ mac 适配（09-17 审计）：POSIX 的 npm 全局 shim 落在 `<prefix>/bin/<pkg>`（不带后缀、
      //    symlink 到包内 bin），prepare-mac-tools 正是这么写的（npm-global/bin/nuphus-call）。
      //    旧清单只有 Windows 的 .cmd/.ps1 ⇒ mac 上卸载包后 shim 残留，PATH 里继续指向空目录。
      path.join(globalDir, "bin", pkg),
      path.join(globalDir, `${pkg}.cmd`),
      path.join(globalDir, `${pkg}.ps1`),
      path.join(globalDir, "node_modules", ".bin", pkg),
      path.join(globalDir, "node_modules", ".bin", `${pkg}.cmd`),
      path.join(globalDir, "node_modules", ".bin", `${pkg}.ps1`),
    );
  }
  return out;
}

/** 卸载落点（**全部**要删的路径；调用方逐条做安全校验后再删）。 */
function runtimeUninstallTargets(id: DevRuntimeId, spec: DevRuntimeSpec): string[] {
  // 引擎侧安装：ponytail 在 codex-home/plugins/cache/ponytail
  if (id === "ponytail") return [path.join(codexHome, "plugins", "cache", "ponytail")];
  // ⛔⛔ 10-07 用户实测「知识库本地语义检索卸载不更新状态，一直显示已安装」：
  //   kb-embedding 装在 **<userData>/kb-backend**（runtimeInstalled 的判据
  //   kbEmbeddingInstalled() 读的就是这个目录），而通用分支按 marker 首段推出的是
  //   `tools/kb-embedding` —— **一个根本不存在的路径** ⇒ 卸载「删成功」但文件原地不动，
  //   界面永远显示已安装。⇒ 这类「装在 tools 之外」的项必须**显式给真实目录**，不能靠 marker 推导。
  if (id === "kb-embedding") return [kbBackendDir()];
  const pkg = NPM_PACKAGE_ARTIFACTS[id];
  if (pkg) {
    // ⛔⛔ 同源纪律（10-07 同一批实测）：判定侧认**全部候选落位**（mac 双布局），
    //   卸载侧也必须逐个删 —— 只删 npmGlobalRoot() 那一个，装在另一个落位的包会
    //   「卸载了但仍显示已安装」（历史实测）。落位清单来自单一真相源，别手拼。
    // ⛔⛔⛔ dirs 里的路径是相对 **npm-global 前缀**的（`node_modules/cloakbrowser`），
    //   而候选落位 npmGlobalRootCandidates() 返回的**已含 node_modules 一段** ——
    //   直接 join 会拼出 `node_modules/node_modules/cloakbrowser` ⇒ **包体从来就没被删过**
    //   （Windows 同样中招，10-07 实测才抓到）。所以这里必须 join 到前缀（= 落位的上一级）。
    return npmGlobalRootCandidates(true).flatMap((root) => {
      const prefix = path.dirname(root);
      return [
        ...pkg.dirs.map((dir) => path.join(prefix, dir)),
        ...npmShimPaths(root, ...pkg.shims),
      ];
    });
  }
  // ⛔ pip 包（markitdown / laya / phone-harness）：只能删**包目录本身**。按 marker 首段推导会得到
  //    `tools/python` —— 那是整个 Python 运行时（含 pip 与引擎依赖），卸载一个包会把 Python 一起删光。
  const pipDir = PIP_PACKAGE_DIRS[id];
  if (pipDir) {
    const site = pythonSiteDir(path.join(writeToolsRoot(), "python"));
    if (!site) return [path.join(writeToolsRoot(), pipDir)];
    // ⛔⛔ 必须连**元数据目录**一起删（10-08 用户实测事故「开发工具装完不更新」）：只删包目录会留下
    //   `<name>-<ver>.dist-info`，pip 据此认为「已安装」⇒ 重装时回 `Requirement already satisfied`
    //   且 exit 0（什么都不做），而判定看的是包目录 ⇒ 界面报「安装成功」但卡片永远显示未安装。
    //   markitdown / laya / phone-harness 三个 pip 包都在这个分支上，一起覆盖。
    return [path.join(site, pipDir), ...pipMetadataDirs(site, pipDir)];
  }
  // 工具侧：安装根 = marker 路径的第一段（git -> git / ffmpeg -> ffmpeg / …）
  // ⛔ 卸载只删 **userData** 里的下载件；随包 resources 的目录不归用户可卸载。
  return [path.join(writeToolsRoot(), spec.marker.split(/[\\/]/)[0])];
}

/** ⛔⛔ 安装成功后**必须回读「装没装」的判定**（10-08 用户报「开发工具安装完不更新」的整类根因）。
 *  子进程 exit 0 只证明「命令跑完了」，不证明「东西真装上了」：pip 见到孤儿 `*.dist-info` 就会
 *  回一句 `Requirement already satisfied` 然后**什么都不做**（同样 exit 0），安装脚本照样报到界面
 *  ⇒ 用户看到「开发工具安装成功」的绿条 + 卡片仍显示「下载」，点多少次都一样（markitdown 实测：
 *  包目录 83 个文件全丢、只剩 dist-info；`import` 报 ModuleNotFoundError 而 `pip show` 说装着）。
 *  ⇒ 判据必须与卡片**同源**（就是同一个 runtimeInstalled），否则又造出第二套口径。
 *  ⛔ 只在「真跑过安装」的分支调用：guide（去官网）/ builtIn（无需安装）/ 已就绪 三条不算。 */
function assertInstallVerified(id: DevRuntimeId, spec: DevRuntimeSpec): void {
  if (runtimeInstalled(id, spec)) return;
  throw new Error(
    `「${spec.name}」安装流程已结束，但复核未通过 —— 在预期位置找不到已安装产物`
    + `（安装根目录：${writeToolsRoot()}）。这通常是安装器「假成功」（命令退出码 0 但没落盘），`
    + "请把本页日志反馈给开发者；重复点「下载」不会自愈。"
  );
}

/** npm 包按需安装：用**内置 node 自带的 npm**，registry 国内镜像优先、失败回落官方源。 */
async function runNpmInstall(id: string, pkg: string, label: string, source: NonNullable<AppSettings["downloadSource"]> = "auto", allowScripts: string[] = []): Promise<void> {
  const node = bundledNode();
  if (!node) throw new Error(`缺少内置 Node，无法安装 ${label}`);
  // ⛔ 按平台候选探测（Windows zip 布局 / mac tar.gz 布局）—— 别在这里复制路径字面量，见 toolchain.bundledNpmCli
  const npmCli = bundledNpmCli();
  if (!npmCli) throw new Error(`内置 Node 缺少 npm（候选中无 npm-cli.js，tools 根：${toolsRoot()}），无法安装 ${label}`);
  const globalDir = path.join(writeToolsRoot(), "npm-global");
  await fs.mkdir(globalDir, { recursive: true });
  const userRegistry = process.env.npm_config_registry || process.env.NPM_CONFIG_REGISTRY || "";
  const registries = userRegistry ? [userRegistry] : source === "direct" ? [""] : [CHINA_NPM_REGISTRY, ""];
  let lastError: Error | null = null;
  for (const registry of registries) {
    const via = registry ? (userRegistry ? "用户配置的源" : "国内镜像") : "官方源";
    try {
      await new Promise<void>((resolve, reject) => {
        const env: Record<string, string> = {
          ...toolchainEnv(),
          npm_config_audit: "false",
          npm_config_fund: "false",
          npm_config_loglevel: "error",
          npm_config_update_notifier: "false",
          NO_UPDATE_NOTIFIER: "1",
        };
        // 空串 = 不设 registry，npm 回落到官方源
        if (registry) env.npm_config_registry = registry;
        const scriptFlags = allowScripts.map((name) => `--allow-scripts=${name}`);
        const child = spawn(node, [npmCli, "install", "--global", "--prefix", globalDir, pkg, "--no-audit", "--no-fund", ...scriptFlags], { windowsHide: true, env });
        trackRuntimeProc(id, child);
        let tail = "";
        const report = (chunk: Buffer | string) => {
          const text = String(chunk);
          if (!text.trim()) return;
          tail = `${tail}\n${text}`.slice(-4000);
          emitRuntimeProgress(id, text, `（${via}）`);
        };
        child.stdout?.on("data", report);
        child.stderr?.on("data", report);
        child.on("error", reject);
        child.on("close", (code) => code === 0 ? resolve() : reject(new Error(tail.trim().slice(-1200) || `${label} 安装失败（${code}）`)));
      });
      return;
    } catch (error) {
      lastError = error as Error;
      if (registry) sendToWindow("runtime:progress", { id, message: `${label} 从${via}安装失败，改用官方源重试…`, percent: 0 });
    }
  }
  throw lastError ?? new Error(`${label} 安装失败`);
}

/* ── Filee 文件转换（10-30）───────────────────────────────────────────────────
 * GitHub release 直下型（**不是 npm 包**）：镜像序下载便携包 → SHA256 校验 → 解压 tools/filee/。
 * ⛔ 镜像序单一真相源 = gh-mirror.mirrorCandidates（gh-proxy → ghfast → 直连），别在这里另写一份。
 * ⛔ 151MB 大包必须 SHA256 校验（release 自带 Filee-<ver>-SHA256SUMS.txt）：镜像转发偶发截断，
 *   坏包解压一半比「下载失败」更难排查（10-30 实测 CLI 真跑通过后定的口径）。
 * ⛔ 装完写 version.txt：更新链的 installedVersionOf 读它 —— `filee-cli --version` 要 spawn 一次太慢。
 * ⛔ CLI 输出/取消：下载用流式 + 进度（同 skill-packs 的 10-30 口径「要真安装」），取消走
 *   isCancelRequested 轮询（fetch 不能被 trackRuntimeProc 杀，每 chunk 自查）。
 * ⛔ 导出 FILEE_REPO：filee:status 的声明区（FileeCard 跳转按钮）从它取 —— 前端不写第二份 URL。 */
export const FILEE_REPO = "KnifeLemon/Filee";
function fileeInstallDir(): string { return path.join(writeToolsRoot(), "filee"); }
function fileeVersionFile(): string { return path.join(fileeInstallDir(), "version.txt"); }

/** Filee 便携包资产名（按平台/架构；资产名规律 10-30 实测自 GitHub release v2.2.0）。 */
function fileeAssetName(version: string): string {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  if (process.platform === "win32") return `Filee-${version}-win-Portable.zip`;
  if (process.platform === "darwin") return `Filee-${version}-osx-${arch}.tar.gz`;
  return `Filee-${version}-linux-${arch}.tar.gz`;
}

/** 读盘上已装版本（安装时落盘的 version.txt；读不到 = 未安装/旧版安装）。 */
function fileeInstalledVersion(): string {
  try { return readFileSync(fileeVersionFile(), "utf8").trim(); } catch { return ""; }
}

/** 镜像序流式下载一个 release 资产到 target（进度 + 取消 + SHA 逐块算；失败/取消删半截文件）。 */
async function fileeDownloadAsset(id: DevRuntimeId, urlPath: string, target: string, expectZipMagic: boolean): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const url = `https://github.com/${FILEE_REPO}/releases/download/${urlPath}`;
  const controller = new AbortController();
  const tried: string[] = [];
  try {
    for (const candidate of mirrorCandidates(url)) {
      let host = candidate;
      try { host = new URL(candidate).host; } catch { /* 原样显示 */ }
      try {
        const res = await fetch(candidate, { redirect: "follow", signal: controller.signal });
        if (!res.ok || !res.body) { tried.push(`${host}(HTTP ${res.status})`); continue; }
        const total = Number(res.headers.get("content-length") ?? 0) || 0;
        const file = createWriteStream(target);
        const hash = createHash("sha256");
        let received = 0;
        let reported = 0;
        const finished = once(file, "finish");
        let aborted = false;
        try {
          for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
            if (isCancelRequested(id)) { aborted = true; controller.abort(); break; }
            received += chunk.byteLength;
            hash.update(chunk);
            if (!file.write(chunk)) await once(file, "drain");
            // 首块必报（151MB 大包要让用户立刻看见在下），之后每 5% / 1MB 报一次
            if ((reported === 0 && received > 0) || received - reported >= Math.max(total ? total / 20 : 0, 1024 * 1024)) {
              reported = received;
              const pct = total ? Math.round((received / total) * 100) : 0;
              emitRuntimeProgress(id, `@@PROGRESS ${pct} 正在下载（${host}）…`);
            }
          }
        } finally { file.end(); }
        await finished;
        if (aborted) throw new Error("已取消");
        if (!received) throw new Error("下载到 0 字节");
        if (expectZipMagic) {
          const head = (await fs.readFile(target)).subarray(0, 2).toString("latin1");
          if (head !== "PK") throw new Error("下载内容不是 zip（镜像可能返回了错误页）");
        }
        // 整包 SHA 在下载时逐块算好交给调用方校验（不重读 151MB）
        fileeLastSha.set(target, hash.digest("hex"));
        return;
      } catch (error) {
        tried.push(`${host}(${String((error as { message?: unknown })?.message ?? error).slice(0, 60)})`);
        if (isCancelRequested(id)) break;
      }
    }
    throw new Error(`Filee 下载失败：${tried.join(" → ")}`);
  } finally {
    // 成功时 target 要留给解压步骤；失败/取消（没返回）时删半截文件 —— staging 目录不许攒垃圾
    if (!fileeLastSha.has(target)) await fs.rm(target, { force: true }).catch(() => undefined);
  }
}
const fileeLastSha = new Map<string, string>();

/** 安装 / 更新 Filee（version 传具体版本号；更新链传 GitHub 最新 tag）。 */
async function installFileeFromGitHub(id: DevRuntimeId, version: string): Promise<void> {
  if (!/^[0-9][0-9A-Za-z.\-]*$/.test(version)) throw new Error(`Filee 版本号异常：${version}`);
  const dir = fileeInstallDir();
  const staging = path.join(writeToolsRoot(), ".filee-download");
  await fs.mkdir(staging, { recursive: true });
  const asset = fileeAssetName(version);
  emitRuntimeProgress(id, `@@STAGE 下载 Filee ${version}`);
  const archive = path.join(staging, asset);
  fileeLastSha.delete(archive);
  await fileeDownloadAsset(id, `v${version}/${asset}`, archive, process.platform === "win32");
  // SHA256 校验（校验表也走镜像序；拿不到表或表里没这行 = 如实说明并跳过，不装哑巴包也不瞎报错）
  const actualSha = fileeLastSha.get(archive) ?? "";
  emitRuntimeProgress(id, "校验 SHA256…");
  let expectedSha = "";
  for (const candidate of mirrorCandidates(`https://github.com/${FILEE_REPO}/releases/download/v${version}/Filee-${version}-SHA256SUMS.txt`)) {
    try {
      const res = await fetch(candidate, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
      if (!res.ok) continue;
      const text = await res.text();
      const row = text.split(/\r?\n/).find((line) => line.toLowerCase().includes(asset.toLowerCase()));
      const hex = row?.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
      if (/^[0-9a-f]{64}$/.test(hex)) { expectedSha = hex; break; }
    } catch { /* 下一个镜像 */ }
  }
  if (expectedSha && actualSha && expectedSha !== actualSha) {
    await fs.rm(archive, { force: true });
    throw new Error(`Filee 安装包 SHA256 校验失败（下载可能被截断）：期望 ${expectedSha.slice(0, 12)}…，实际 ${actualSha.slice(0, 12)}… —— 请重试`);
  }
  // 清旧目录（解压目标整体重建；临时下载件在 staging、不受影响）
  emitRuntimeProgress(id, "正在解压…");
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  const zipMagic = process.platform === "win32";
  if (zipMagic) {
    const sevenZip = existingToolPath("sevenzip", "7z.exe");
    if (!sevenZip) throw new Error("缺少随包 7-Zip（sevenzip/7z.exe），解压不了 Filee 安装包");
    await new Promise<void>((resolve, reject) => {
      const child = spawn(sevenZip, ["x", archive, `-o${dir}`, "-y"], { windowsHide: true });
      trackRuntimeProc(id, child);
      let tail = "";
      const grab = (c: unknown) => { tail = `${tail}\n${String(c)}`.slice(-2000); };
      child.stdout?.on("data", grab);
      child.stderr?.on("data", grab);
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`解压失败（${code}）：${tail.trim().slice(-600)}`)));
    });
  } else {
    // mac / linux：系统自带 tar（osx-*.tar.gz / linux-*.tar.gz）
    await new Promise<void>((resolve, reject) => {
      const child = spawn("tar", ["-xzf", archive, "-C", dir], { windowsHide: true });
      trackRuntimeProc(id, child);
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`解压失败（${code}）`)));
    });
  }
  // 落版本号（更新链 installedVersionOf 读它）
  await fs.writeFile(fileeVersionFile(), version + "\n", "utf8");
  await fs.rm(staging, { recursive: true, force: true });
}

/* ── GitHub 直下型工具的「检查更新 / 升级」（Filee，10-30）──────────────────────
 * ⛔ 不并入 UPDATEABLE_TOOLS（那是 npm 包专用：pkg + fetchRegistryLatest）。
 *   · 查最新版走 GitHub releases/latest（api 镜像序），比 npm 慢一点但 Filee 没有 npm 源；
 *   · 升级 = 重跑同一条安装函数（带最新 tag），装完复核 version.txt。
 * ⛔ 自动更新循环不收 filee：autoUpdateItems 只认配了开关的工具（151MB 不许后台偷下），
 *   filee 只出现在「控制台 → 组件更新」的手动检查里 —— 这个边界别改。 */
const GITHUB_UPDATEABLE: Record<string, { repo: string; label: string }> = {
  filee: { repo: FILEE_REPO, label: "Filee 文件转换" },
};

/** 查 GitHub 最新 release tag（去 v 前缀）：api 镜像序，20s 超时。 */
async function fetchGitHubLatestTag(repo: string): Promise<string> {
  let lastError = "";
  for (const candidate of mirrorCandidates(`https://api.github.com/repos/${repo}/releases/latest`)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(candidate, { signal: controller.signal, headers: { accept: "application/vnd.github+json" } });
      if (!res.ok) { lastError = `HTTP ${res.status}`; continue; }
      const json = (await res.json()) as { tag_name?: unknown };
      const tag = typeof json?.tag_name === "string" ? json.tag_name.replace(/^v/, "") : "";
      if (tag) return tag;
      lastError = "响应里没有 tag_name";
    } catch (error) {
      lastError = String((error as Error)?.message ?? error);
    } finally { clearTimeout(timer); }
  }
  throw new Error(`查 GitHub 最新版失败：${lastError}`);
}

export type DevRuntimeHealth = {
  id: string;
  name: string;
  /** 文件在不在（与卡片同一份判定）。 */
  installed: boolean;
  /** 装了的能不能真跑起来。 */
  ok: boolean;
  /** 给人看的一行结论（版本串 / 失败原因）。 */
  detail: string;
};

/** 自检时让工具自报版本的参数（只列**可执行文件型**；其余只验存在性）。 */
const HEALTH_ARGS: Partial<Record<DevRuntimeId, string[]>> = {
  node: ["-v"], python: ["--version"], git: ["--version"], rg: ["--version"], uv: ["--version"],
  jq: ["--version"], ninja: ["--version"], sevenzip: [], "yt-dlp": ["--version"], cmake: ["--version"],
  ffmpeg: ["-version"], "platform-tools": ["version"],
  filee: ["--version"],
  pwsh: ["-NoLogo", "-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"],
  "vscode-cli": ["--version"], conda: ["--version"], mingw: ["--version"],
};

/** 跑一次命令拿首行输出；**任何异常都收敛成一行文字**，不抛。 */
function probeTool(file: string, args: string[]): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean, detail: string) => {
      if (settled) return;
      settled = true;
      resolve({ ok, detail });
    };
    if (!existsSync(file)) return done(false, "已安装但找不到可执行文件（目录可能被手动删过，点「修复安装」）");
    try {
      const child = spawn(file, args, { windowsHide: true, env: toolchainEnv(), timeout: 8000 });
      let out = "";
      const grab = (chunk: unknown) => { out += String(chunk); };
      child.stdout?.on("data", grab);
      child.stderr?.on("data", grab);
      child.on("error", (error) => done(false, `无法启动：${String((error as Error).message || error).slice(0, 140)}`));
      child.on("close", (code) => {
        const first = out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] ?? "";
        if (code === 0) done(true, first.slice(0, 120) || "可运行");
        else done(false, `退出码 ${code}${first ? `：${first.slice(0, 100)}` : ""}`);
      });
    } catch (error) {
      done(false, String(error).slice(0, 140));
    }
  });
}

/** 可执行文件的落点：Windows 用 spec.marker，mac 走 DARWIN_MARKERS 覆盖。 */
function healthExecPath(id: DevRuntimeId, spec: DevRuntimeSpec): string {
  const rel = IS_MAC ? (DARWIN_MARKERS[id] ?? spec.marker) : spec.marker;
  /* 随包 / 用户下载两个根都查；未安装时返回 **userData** 预期落位（提示用户装到哪）。 */
  return existingToolPath(rel) || path.join(writeToolsRoot(), rel);
}

/**
 * 工具自检（10-02 用户：「工具给老子一个检查，有一个报错，下载按不了」）。
 * 卡片上的「已安装」只证明**文件在**，不证明**能跑** —— 用户要的是后者。
 * ⛔ 单项失败绝不抛出：一个工具探不通不能让整页自检崩掉。
 * ⛔ 探测必须带超时（8s）；hidden 项也要查（用户照样会问「装了没、能不能用」）。
 */
async function devRuntimeHealth(): Promise<DevRuntimeHealth[]> {
  const specs = devRuntimeSpecs;
  const rows: DevRuntimeHealth[] = [];
  for (const [rawId, spec] of Object.entries(specs) as [DevRuntimeId, DevRuntimeSpec][]) {
    // 系统级安装项（Docker / OpenSSL，点按钮去官网）不参与自检 —— 我们没装它、也无从探测
    if (spec.kind === "guide") continue;
    const installed = runtimeInstalled(rawId, spec);
    if (!installed) {
      rows.push({ id: rawId, name: spec.name, installed: false, ok: false, detail: "未安装" });
      continue;
    }
    const args = HEALTH_ARGS[rawId];
    if (!args) {
      rows.push({ id: rawId, name: spec.name, installed: true, ok: true, detail: "已安装（无需可执行探测）" });
      continue;
    }
    const file = healthExecPath(rawId, spec);
    const probe = await probeTool(file, args);
    let ok = probe.ok;
    let detail = probe.detail;
    // Python 是最容易「在但不好用」的一个：装得上全看 pip（历史踩过 embeddable 版无 pip）。
    if (rawId === "python" && probe.ok) {
      const pip = pythonPipReady(file);
      if (!pip.ok) { ok = false; detail = pip.reason; }
      else detail = `${detail}｜pip 可用`;
    }
    rows.push({ id: rawId, name: spec.name, installed: true, ok, detail });
  }
  return rows;
}

/* ── 工具链「检查更新 / 升级」（10-12 用户要求）────────────────────────────────
 * 用户原话：「nuphus 和 browser 能不能留好国内镜像源更新入口，这个界面加上两个更新功能」。
 * ⛔ 与「修复安装」的分工（两者不可互相替代，界面文案也要分清）：
 *   · 修复安装 = 从**随包 zip** 重解压 ⇒ 版本回到「包内版本」（离线、永远可用）；
 *   · 在线更新 = 从 **npm 国内镜像**装 `<pkg>@latest` ⇒ 真升级（联网、版本跟着 npm 走）。
 *   ⇒ 用户点过在线更新后，日后再点修复安装会**降级**回包内版本 —— 这是设计使然，不是 bug。
 * ⛔ 包名与落位都取既有真相源（npmGlobalRootCandidates），别在这里手拼 `npm-global/node_modules`。
 * ⛔ 装完必须**复核磁盘上的版本**，读不到就报错 —— 不许「看起来装好了」。
 * ⛔ 必须重启引擎：nuphus 是引擎 spawn 的 MCP 子进程，CLI 也在引擎的 PATH 上。
 * ⛔ 新增可更新工具时，**同时**改这里与界面侧清单（界面侧从 runtime:update-check 全量拉，不用改）。
 */
const UPDATEABLE_TOOLS: Record<string, { pkg: string; label: string; platforms?: NodeJS.Platform[] }> = {
  nuphus: { pkg: "@nuphus/nuphus-mcp", label: "Nuphus 桌面自动化" },
  // ⛔ mac 专属：open-computer-use 只在 mac 随包工具链里（scripts/prepare-mac-tools.cjs 装进
  //    <tools>/npm-global），Windows/Linux 上既没装也不该提示 —— 列出来会永远显示「未检测到已装版本」，
  //    后台自动更新还会为它白跑一次 npm 安装。故带 platforms 约束，由 updateableToolIds() 统一过滤。
  "computer-use": { pkg: "open-computer-use", label: "Mac 电脑操作（Computer Use）", platforms: ["darwin"] },
  // REA 逆向分析（10-13）：同一条在线更新链（fetchRegistryLatest = 国内镜像优先 + 官方回落）。
  rea: { pkg: "rea-agents", label: "REA 逆向分析" },
  "feishu-cli": { pkg: "@larksuite/cli", label: "飞书 CLI" },
};

/** 单个可更新工具的包名 / 显示名（**唯一真相源**）：自动更新板块从这里取，⛔ 不许另抄一份包名。 */
export function updateableToolMeta(id: string): { pkg: string; label: string } | null {
  const tool = UPDATEABLE_TOOLS[id];
  if (tool) return { pkg: tool.pkg, label: tool.label };
  const gh = GITHUB_UPDATEABLE[id];
  if (gh) return { pkg: `github:${gh.repo}`, label: gh.label };
  return null;
}

export type RuntimeUpdateRow = {
  id: string;
  name: string;
  pkg: string;
  current: string;
  latest: string;
  registry: string;
  hasUpdate: boolean;
  error: string;
};

/** 当前平台**真正**可更新的工具 id（桌面 → 浏览器 → 电脑操作 → GitHub 直下型，顺序稳定）。
 *  ⛔ 界面与后台调度都必须走这里，别各写一份清单（本项目反复栽在两处各写一套上）。 */
export function updateableToolIds(): string[] {
  return [...Object.keys(UPDATEABLE_TOOLS), ...Object.keys(GITHUB_UPDATEABLE)].filter((id) => {
    const platforms = UPDATEABLE_TOOLS[id]?.platforms;
    return !platforms || platforms.includes(process.platform);
  });
}

/** 读磁盘上已装的版本号（npm 包读 package.json；GitHub 直下型读安装时落的 version.txt）。 */
function installedVersionOf(id: string): string {
  const gh = GITHUB_UPDATEABLE[id];
  if (gh) return fileeInstalledVersion();
  const tool = UPDATEABLE_TOOLS[id];
  if (!tool) return "";
  const segments = tool.pkg.split("/");
  for (const root of npmGlobalRootCandidates()) {
    try {
      const pkgJson = path.join(root, ...segments, "package.json");
      if (!existsSync(pkgJson)) continue;
      const parsed = JSON.parse(readFileSync(pkgJson, "utf8")) as { version?: unknown };
      if (typeof parsed.version === "string" && parsed.version) return parsed.version;
    } catch { /* 读不到就换下一个落位 */ }
  }
  return "";
}

/** 查 npm 上某包的最新版：国内镜像优先、失败回落官方源（与 runNpmInstall 同序、同口径）。 */
async function fetchRegistryLatest(
  pkg: string,
  source: NonNullable<AppSettings["downloadSource"]>,
  timeoutMs = 20000,
): Promise<{ version: string; registry: string }> {
  const userRegistry = process.env.npm_config_registry || process.env.NPM_CONFIG_REGISTRY || "";
  const registries = userRegistry
    ? [userRegistry]
    : source === "direct"
      ? ["https://registry.npmjs.org", CHINA_NPM_REGISTRY]
      : [CHINA_NPM_REGISTRY, "https://registry.npmjs.org"];
  let lastError = "";
  for (const registry of registries) {
    // ⛔ 必须带超时：镜像站偶发挂住时不能让「检查更新」按钮永远转圈
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${registry}/${pkg.replace("/", "%2F")}`, {
        signal: controller.signal,
        // 精简 packument：只要 dist-tags，不要每个版本的完整元数据（镜像与官方源都支持）
        headers: { accept: "application/vnd.npm.install-v1+json, application/json" },
      });
      if (!res.ok) { lastError = `${registry} 返回 HTTP ${res.status}`; continue; }
      const json = (await res.json()) as { "dist-tags"?: { latest?: unknown } };
      const latest = json?.["dist-tags"]?.latest;
      if (typeof latest === "string" && latest) return { version: latest, registry };
      lastError = `${registry} 的响应里没有 dist-tags.latest`;
    } catch (error) {
      lastError = `${registry}：${(error as Error)?.message ?? String(error)}`;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`查最新版本失败（国内镜像与官方源都试过了）：${lastError}`);
}

/* ── 手动/自动共用的两条链路（10-13 抽出）────────────────────────────────────
 * ⛔⛔ **手动链 = 自动链，物理同一份函数**：后台自动更新（auto-update-ipc）必须调这两个函数，
 *    不许在主进程再抄一遍「查最新版 → 装 → 复核 → 重启引擎」——两处各写判据必漂移
 *    （症状：界面说「已是最新」、后台却在偷偷装，或反之）。界面按钮只是这两个函数的薄包装。
 */
export async function checkRuntimeUpdateRow(id: string): Promise<RuntimeUpdateRow> {
  const gh = GITHUB_UPDATEABLE[id];
  if (gh) {
    // GitHub 直下型（Filee）：查 releases/latest tag，与盘上 version.txt 比
    const current = installedVersionOf(id);
    try {
      const latest = await fetchGitHubLatestTag(gh.repo);
      return { id, name: gh.label, pkg: `github:${gh.repo}`, current, latest, registry: "github", hasUpdate: !current || compareVersions(latest, current) > 0, error: "" };
    } catch (error) {
      return { id, name: gh.label, pkg: `github:${gh.repo}`, current, latest: "", registry: "", hasUpdate: false, error: (error as Error)?.message ?? String(error) };
    }
  }
  const tool = UPDATEABLE_TOOLS[id];
  if (!tool) throw new Error(`该工具不支持在线更新：${id}`);
  const source = await readDownloadSource();
  const current = installedVersionOf(id);
  try {
    const { version: latest, registry } = await fetchRegistryLatest(tool.pkg, source);
    return { id, name: tool.label, pkg: tool.pkg, current, latest, registry, hasUpdate: !current || compareVersions(latest, current) > 0, error: "" };
  } catch (error) {
    // ⛔ 查不到最新版**不是致命错**：照常返回已装版本，错误原文给人看（网络问题用户自己能判断）
    return { id, name: tool.label, pkg: tool.pkg, current, latest: "", registry: "", hasUpdate: false, error: (error as Error)?.message ?? String(error) };
  }
}

/** 返回 `joined` = 同一工具已有更新在跑，本次只是等它跑完（与 install 同语义，不抛「正在安装」）。 */
export async function performRuntimeUpdate(
  id: string,
): Promise<{ ok: boolean; from: string; to: string; cancelled?: boolean; joined?: boolean }> {
  const gh = GITHUB_UPDATEABLE[id];
  if (gh) {
    // GitHub 直下型（Filee）：升级 = 重跑同一条安装函数（最新 tag），装完复核 version.txt
    const inFlight = runtimeInstalls.get(id);
    if (inFlight) { await inFlight; return { ok: true, joined: true, from: "", to: installedVersionOf(id) }; }
    const from = installedVersionOf(id);
    const task = (async () => {
      emitRuntimeProgress(id, `@@STAGE 更新 ${gh.label}`);
      const latest = await fetchGitHubLatestTag(gh.repo);
      await installFileeFromGitHub(id as DevRuntimeId, latest);
      await restartServerWhenIdle(id);
    })();
    runtimeInstalls.set(id, task);
    try {
      await task;
      const to = installedVersionOf(id);
      if (!to) throw new Error(`${gh.label} 更新流程已结束，但读不到已装版本 —— 请重试或重新安装`);
      sendToWindow("runtime:progress", { id, message: `已更新到 ${to}`, percent: 100, speed: "", done: true });
      return { ok: true, from, to };
    } catch (error) {
      if (isCancelRequested(id)) return { ok: true, cancelled: true, from, to: "" };
      throw error;
    } finally {
      runtimeInstalls.delete(id);
      clearCancelRequest(id);
    }
  }
  const tool = UPDATEABLE_TOOLS[id];
  if (!tool) throw new Error(`该工具不支持在线更新：${id}`);
  const inFlight = runtimeInstalls.get(id);
  if (inFlight) { await inFlight; return { ok: true, joined: true, from: "", to: installedVersionOf(id) }; }
  const from = installedVersionOf(id);
  const downloadSource = await readDownloadSource();
  const task = (async () => {
    emitRuntimeProgress(id, `@@STAGE 更新 ${tool.label}`);
    emitRuntimeProgress(id, `正在从国内镜像更新 ${tool.pkg}@latest（当前 ${from || "未知"}）…`);
    await runNpmInstall(id, `${tool.pkg}@latest`, tool.label, downloadSource, NPM_ALLOW_SCRIPTS[id as DevRuntimeId]);
    // 引擎重启会等当前任务跑完（闸门），期间界面显示「等待任务结束后刷新引擎」
    await restartServerWhenIdle(id);
  })();
  runtimeInstalls.set(id, task);
  try {
    await task;
    const to = installedVersionOf(id);
    // ⛔ 复核：命令退出码 0 ≠ 装上了（落位/权限/半截网络都可能「成功退出」）
    if (!to) throw new Error(`${tool.label} 更新命令已跑完，但读不到已装版本 —— 请点「修复安装」回到随包版本`);
    sendToWindow("runtime:progress", { id, message: `已更新到 ${to}`, percent: 100, speed: "", done: true });
    return { ok: true, from, to };
  } catch (error) {
    // 取消（杀进程导致的非零退出）不算错误：回执 cancelled，与 install 同一口径
    if (isCancelRequested(id)) return { ok: true, cancelled: true, from, to: "" };
    throw error;
  } finally {
    runtimeInstalls.delete(id);
    clearCancelRequest(id);
  }
}

const RUNTIME_CHANNELS = ["runtime:list", "runtime:install", "runtime:uninstall", "runtime:cancel", "runtime:health", "runtime:update-check", "runtime:update"];

/* 装不上的备用方案文案生成器：导出**只为可验证**（探针/守卫能真跑它），业务侧一律经 runtime:list 取。 */
export { fallbackPromptFor };

export const runtimeFeature = defineFeature<null>({
  id: "runtime",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("runtime: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("runtime:list", () => runtimeList());

    ipcHost.handle("runtime:uninstall", async (_event, idValue: string) => {
      const id = idValue as DevRuntimeId;
      const spec = devRuntimeSpecs[id];
      if (!spec) throw new Error("未知开发工具");
      if (spec.builtIn) throw new Error("内置工具不可卸载");
      if (spec.kind === "guide") throw new Error("该工具是系统级安装，请到系统的「应用与功能」里卸载");
      // 随包内置能力（nuphus / ponytail 插件），不是联网下载 —— 删了没有可靠的重取途径
      if (spec.bundled) throw new Error("该工具随应用内置，删除后只能从随包资源恢复，因此不支持卸载");
      // 随包内置资源（zip / 插件目录），不是联网下载 —— 删了没有可靠的重取途径，直接拒绝
      if (spec.noUninstall) throw new Error("该工具来自随包内置资源，删除后难以恢复，因此不支持卸载");
      const targets = runtimeUninstallTargets(id, spec);
      // 防御：marker 解析异常时 target 可能退化成某个根目录 —— 那会把**所有**工具/插件删光。
      // 要求每个 target 必须落在允许根之内，且不等于这些根本身。
      // ⛔ 10-07：kb-embedding 装在 <userData>/kb-backend（userData 下），需要放行。
      //   ⛔⛔ 但它**不是「根」而是「恰好等于允许值的具体目录」** ⇒ 放进 allowedRoots 会与
      //   上面「不得等于根」那条自相矛盾（target === 允许根 ⇒ 直接被拒，症状仍是卸不掉）。
      //   ⇒ 故拆成两个概念：allowedRoots = 可以往里删的**根**（不得相等）；
      //      exactAllowed = 允许**整体删除**的具体目录（target 就等于它）。
      const allowedRoots = [...toolRootsRead(), codexHome].filter(Boolean).map((r) => path.resolve(r));
      const exactAllowed = new Set([path.resolve(kbBackendDir())]);
      for (const target of targets) {
        const resolvedTarget = path.resolve(target);
        const underAllowed = allowedRoots.some((r) => resolvedTarget.startsWith(r + path.sep));
        if (!resolvedTarget || allowedRoots.includes(resolvedTarget)
          || (!underAllowed && !exactAllowed.has(resolvedTarget))) {
          throw new Error("安装路径解析异常，已取消卸载");
        }
      }
      // 逐个删（先包体、再 shim；marker 是文件还是目录都适用）—— 大目录按字节比例发卸载进度
      // ⛔⛔ 10-07：kb-embedding 必须走它**自己的**卸载函数，不能用通用分批删除 ——
      //   常驻 embedding worker 子进程正抱着模型文件，Windows 上文件被占用时 fs.rm 直接 EBUSY/EPERM
      //   （try/catch 还把它吞成「删成功」）⇒ 又一个「卸载了但一直显示已安装」。
      //   uninstallKbEmbedding() 内部先 disposeKbEmbedWorker() 再删，与 10-04 的安装/卸载设计同源。
      if (id === "kb-embedding") {
        sendToWindow("runtime:progress", { id, stage: "正在删除文件", percent: 0 });
        await uninstallKbEmbedding();
        sendToWindow("runtime:progress", { id, message: "卸载完成", percent: 100, done: true });
        return { ok: true, runtimes: runtimeList() };
      }
      await removeTargetsWithProgress(id, targets);
      // ponytail 卸载后要显式关掉 config.toml 里的注册段（否则引擎重启找不到已删的 cache）：
      // 插件 key 是 **"ponytail@ponytail"**（见 ponytail-plugin.ts 的 MARKETPLACE_SECTION）。
      // ⛔ 引擎必填 mergeStrategy：缺了整条请求被判 Invalid request，而这里是 catch 静默吞掉
      //    —— 表现为「卸载了但 enabled 还是 true」。
      if (id === "ponytail") {
        await server.request("config/value/write", {
          filePath: path.join(codexHome, "config.toml"),
          keyPath: 'plugins."ponytail@ponytail".enabled',
          value: false,
          mergeStrategy: "replace",
        }).catch(() => undefined);
      }
      sendToWindow("runtime:progress", { id, message: "卸载完成", percent: 100, done: true });
      // ⛔ 10-12 同步清账：留着记录的话，更新后的「你装过哪些工具」会把一个**用户主动卸载**的
      //   工具算成「待重装」并提示恢复 —— 账本必须跟着真实状态走，不是只增不减。
      try { recordToolRemoved(id); } catch { /* 记账失败不影响卸载结果 */ }
      return { ok: true, runtimes: runtimeList() };
    });

    // 取消安装（10-07 用户要求）：杀掉该工具名下的安装子进程 + 清半截下载产物。
    // 「已取消」经 runtime:progress(cancelled) 推给界面；正在等的 install 调用随后会以
    // 非零码 reject —— install handler 查 isCancelRequested 把它改判成 cancelled 回执。
    ipcHost.handle("runtime:cancel", (_event, idValue: string) => {
      const id = idValue as DevRuntimeId;
      if (!devRuntimeSpecs[id]) return { ok: false, reason: "unknown" };
      if (!runtimeInstalls.has(id)) return { ok: false, reason: "not-running" };
      requestRuntimeCancel(id);
      const killed = cancelRuntimeInstall(id);
      cleanupRuntimeTempFiles(id);
      sendToWindow("runtime:progress", { id, message: "已取消下载，临时文件已清理", cancelled: true, done: true });
      return { ok: true, killed };
    });

    ipcHost.handle("runtime:health", () => devRuntimeHealth());

    ipcHost.handle("runtime:install", async (_event, idValue: string) => {
      const id = idValue as DevRuntimeId;
      if (!devRuntimeSpecs[id]) throw new Error("未知开发工具");
      if (devRuntimeSpecs[id].builtIn) return { ok: true, runtimes: runtimeList() };
      // ⛔ 09-20 下载源选择：所有按需下载通道统一从这里读源（每次现读 app-settings，不缓存）。
      const downloadSource = await readDownloadSource();
      // ⛔ 同一工具并发安装：**等它跑完**，不要抛「该工具正在安装」（09-18 用户反馈截图）。
      //   抛错既看不懂，又让**整批安装被中断**（后两项也没装）。等待语义对用户才是正确的。
      const inFlight = runtimeInstalls.get(id);
      if (inFlight) {
        await inFlight;
        return { ok: true, joined: true, runtimes: runtimeList() };
      }
      const spec = devRuntimeSpecs[id];
      // 引导型（docker/openssl）：静默安装需要管理员/重启/登录，这里打开官方下载页由用户自己装
      if (spec.kind === "guide") {
        /* ⛔ mac 的 openssl 是系统自带件（见 runtimeInstalledBySystem 的 darwin 分支）⇒
           不给 Windows 下载页（slproweb 是 Win32 构建，mac 上装了也用不了），guide 留空。 */
        const url = id === "openssl"
          ? (IS_MAC ? "" : "https://slproweb.com/products/Win32OpenSSL.html")
          : "https://www.docker.com/products/docker-desktop/";
        if (url) await shell.openExternal(url);
        return { ok: true, guide: url, runtimes: runtimeList() };
      }
      // 随包内置且已就位：无需「修复」。再解压/重种一遍只会覆盖同名文件（无收益，还多一次引擎重启）。
      if (spec.bundled && runtimeInstalled(id, spec)) return { ok: true, runtimes: runtimeList() };
      // ⛔ 10-01：Laya / 手机控制是 pip 包（各有专用安装器）——必须走它们自己的安装链，
      //   绝不能落到 install-runtimes.cjs（那里没有这两个 id，会静默什么也不做）。
      if (id === "kb-embedding") {
        // 知识库本地 embedding 后端（10-04 改判：npm 树 463MB 远超 50MB 内置线 ⇒ 不随包，按需下载）。
        // npm 装 @huggingface/transformers 到 <userData>/kb-backend + 预下载 bge 模型（hf-mirror）。
        // 进度事件直接透传给渲染层（知识库页与开发工具页共用 runtime:progress）。
        const task = (async () => {
          if (kbEmbeddingInstalled()) return; // 已装好（三件齐）⇒ 幂等早退，不重下 463MB
          sendToWindow("runtime:progress", { id, message: "正在安装本地 embedding 运行库（npmmirror + hf-mirror）…" });
          await installKbEmbedding((p) => sendToWindow("runtime:progress", { id, ...p }));
          // ⛔ 这里**不许**发 done:true 的「安装完成」：紧随其后的 assertInstallVerified 才是判据
          //   （10-08 自审抓到：旧写法在这条分支上先报完成、再复核 —— 复核失败就成了
          //   「先绿条后报错」，正是本次要根除的那类「假成功」。真正的那条完成消息在复核之后发。）
          sendToWindow("runtime:progress", { id, message: "正在复核安装结果…" });
        })();
        runtimeInstalls.set(id, task.finally(() => runtimeInstalls.delete(id)) as Promise<void>);
        await task.catch((error) => { throw error instanceof Error ? error : new Error(String(error)); });
        assertInstallVerified(id, spec);
        return { ok: true, runtimes: runtimeList() };
      }
      if (id === "laya" || id === "phone-harness") {
        const task = (async () => {
          const result = id === "laya" ? await layaInstall() : await installPhoneHarness();
          if (!result.ok) throw new Error(result.log.split("\n").filter(Boolean).slice(-1)[0] || `${spec.name} 安装失败`);
        })();
        runtimeInstalls.set(id, task.finally(() => runtimeInstalls.delete(id)) as Promise<void>);
        await task.catch((error) => { throw error instanceof Error ? error : new Error(String(error)); });
        assertInstallVerified(id, spec);
        return { ok: true, runtimes: runtimeList() };
      }
      /* MoeKoe Music（10-20）：系统级外部客户端，不能走 install-runtimes.cjs。
         下载/安装由 moekoe.ts 负责；这里只发进度、等安装向导完成（exe 出现）再启动。
         ⛔ 用户完成 NSIS 向导前 exe 不存在 —— 不能提前报「安装完成」。 */
      if (id === "moekoe") {
        const task = (async () => {
          const { findMoeKoeExe, installMoeKoe } = await import("../moekoe");
          if (findMoeKoeExe()) {
            const launched = await installMoeKoe({ confirm: true });
            sendToWindow("runtime:progress", { id, message: launched.message || "MoeKoe Music 已启动", percent: 100, done: true });
            return;
          }
          sendToWindow("runtime:progress", { id, message: "正在从国内镜像下载 MoeKoe Music（约 133 MB）…", percent: 1 });
          const started = await installMoeKoe({ confirm: true });
          sendToWindow("runtime:progress", { id, message: started.message || "安装程序已启动，请完成安装向导…", percent: 3 });
          for (let attempt = 0; attempt < 300; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            if (!findMoeKoeExe()) continue;
            await installMoeKoe({ confirm: true }).catch(() => undefined); // 装好就启动；启动失败不影响「已安装」
            sendToWindow("runtime:progress", { id, message: "MoeKoe Music 已安装并启动", percent: 100, done: true });
            return;
          }
          throw new Error("安装程序已启动，但 5 分钟内未检测到安装完成；请完成安装后回来刷新");
        })();
        runtimeInstalls.set(id, task.finally(() => runtimeInstalls.delete(id)) as Promise<void>);
        await task.catch((error) => { throw error instanceof Error ? error : new Error(String(error)); });
        return { ok: true, runtimes: runtimeList() };
      }
      const task = (async () => {
        if (id === "ponytail") {
          // ⛔ 必须排在 spec.bundled 分支**之前**：ponytail 也是 bundled，但它的修复路径是「重种插件」
          //    而不是「解压 automation-tools.zip」——漏了会让「修复安装 ponytail」把 zip 解到 npm-global。
          /* 10-30：改走 healPonytailInstall（重建**带清单文件**的本地市场 + 引擎 plugin/install
             + enabled=true + 按 currentHash 信任钩子）。旧做法把 marketplaces 指到插件目录本身，
             引擎 0.16x 不认 ⇒ 插件/技能/钩子一起消失（用户实测）。 */
          const heal = await healPonytailInstall({ restart: true });
          if (!heal.ok) throw new Error(heal.message);
        } else if (spec.bundled) {
          // 随包内置能力的「修复安装」（nuphus）：从随包 zip 重新解压。
          if (!bundledNode()) await runRuntimeInstaller("node", runtimeInstaller("install-runtimes.cjs"), ["node"], process.execPath, { DOWNLOAD_SOURCE: downloadSource });
          // ⛔ 只认随包 zip（解压安装），**不再回落在线下载**（09-12 用户实测发布包故障）：
          //   GitHub Release 那个 automation-tools.zip 资产根本不存在，回落只会撞死地址。
          const bundledAutomationZip = existingToolPath("automation-tools.zip") || path.join(toolsRoot(), "automation-tools.zip");
          if (!existsSync(bundledAutomationZip)) {
            throw new Error(
              `随包缺少 tools/automation-tools.zip —— 这一版安装包不完整，装不了「${spec.name}」。`
              + "请更新到带该文件的版本；自建包时先在本机装一次自动化工具链再执行打包。"
            );
          }
          await runRuntimeInstaller(id, runtimeInstaller("install-automation.cjs"), ["--zip", bundledAutomationZip], bundledNode());
          // 解压安装成功后自动激活「桌面自动化」「浏览器自动化」联动开关
          await saveAppSettings(app.getPath("userData"), { desktopAutomation: true, browserAutomation: true });
        } else if (id === "feishu-cli") {
          /* 飞书官方 CLI（10-29）：npm 包自身 postinstall 会按平台下载 Go 二进制（约 50MB）⇒ 必须放行该包的脚本。 */
          await runNpmInstall(id, `@larksuite/cli@${TOOLS_VERSIONS.feishuCli ?? "latest"}`, "飞书 CLI", downloadSource, NPM_ALLOW_SCRIPTS["feishu-cli"]);
        } else if (id === "filee") {
          /* Filee 文件转换（10-30）：GitHub release 直下型（151MB，镜像序 + SHA256 校验）。
             更新链（performRuntimeUpdate 的 GITHUB_UPDATEABLE 分支）也走这一个函数。 */
          await installFileeFromGitHub(id, TOOLS_VERSIONS.filee ?? (await fetchGitHubLatestTag(FILEE_REPO)));
        } else if (id === "rea") {
          // REA 逆向分析（10-13）：npm 国内镜像装，失败回落官方源；重跑同一入口 = 更新到 latest
          // （UPDATEABLE_TOOLS 的 rea 条目让「设置 → 自动化」的在线更新链对它同样成立）。
          await runNpmInstall(id, "rea-agents", "REA 逆向分析", downloadSource);
        } else {
          // ⛔ DOWNLOAD_SOURCE 经环境变量传给安装脚本 —— 脚本 argv 的裸词会被当成工具 id。
          await runRuntimeInstaller(id, runtimeInstaller("install-runtimes.cjs"), [id], process.execPath, { DOWNLOAD_SOURCE: downloadSource });
        }
        await restartServerWhenIdle(id);
      })();
      runtimeInstalls.set(id, task);
      try {
        await task;
        // ⛔ 成功绿条只在**复核通过**之后发 —— 否则界面会先报「安装完成」再报错，把一次假成功演成两次消息。
        assertInstallVerified(id, spec);
        sendToWindow("runtime:progress", { id, message: "安装完成", percent: 100, speed: "", done: true });
        return { ok: true, runtimes: runtimeList() };
      } catch (error) {
        // 取消（杀进程导致的非零退出）不算错误：回执 cancelled，渲染层按「已取消」处理而不是报红
        if (isCancelRequested(id)) return { ok: true, cancelled: true, runtimes: runtimeList() };
        throw error;
      } finally {
        runtimeInstalls.delete(id);
        clearCancelRequest(id);
      }
    });

    /* ── 工具链更新（10-12 新增；界面在「设置 → 自动化」）───────────────────────
     * runtime:update-check —— 只读：查 npm 最新版 + 读盘上已装版，给 hasUpdate。
     * runtime:update       —— 真装：`<pkg>@latest` 从国内镜像进 tools/npm-global，复核版本后重启引擎。
     * ⛔ 传 id 返回单条；不传返回**全部**可更新工具（界面一次拿全，免得渲染层再抄一份清单）。 */
    ipcHost.handle("runtime:update-check", async (_event, idValue?: string) => {
      // ⛔ 清单走 updateableToolIds()（按平台过滤），别用 Object.keys(UPDATEABLE_TOOLS)
      const ids = idValue ? [idValue] : updateableToolIds();
      const rows = await Promise.all(ids.map((id) => checkRuntimeUpdateRow(id)));
      return idValue ? rows[0] : rows;
    });

    ipcHost.handle("runtime:update", async (_event, idValue: string) => {
      const result = await performRuntimeUpdate(idValue);
      return { ...result, runtimes: runtimeList() };
    });

    ctx.effect(() => {
      for (const ch of RUNTIME_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
