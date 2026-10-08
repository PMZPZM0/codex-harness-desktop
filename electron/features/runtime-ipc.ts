/**
 * runtime-ipc（10-03 从 `features/engine-ipc/03-dev-runtime` + `04-dev-runtime-install` 合并成单前缀板块，
 * 同时改为**插件形态**）
 *
 * 域：runtime(5)
 * 通道：runtime:list / install / uninstall / cancel / health
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
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { app, shell } from "electron";
import { CHINA_NPM_REGISTRY, bundledNode, bundledNpmCli, downloadEnv, npmGlobalRoot, npmGlobalRootCandidates, pythonPipReady, toolchainEnv, toolsRoot } from "../toolchain";
import { installKbEmbedding, kbBackendDir, kbEmbeddingInstalled, uninstallKbEmbedding } from "./kb-embed-backend";
import { DARWIN_HIDDEN, DARWIN_MARKERS, DARWIN_SPEC_TEXT, IS_MAC, PIP_PACKAGE_DIRS, cancelRuntimeInstall, cleanupRuntimeTempFiles, clearCancelRequest, devRuntimeSpecs, emitRuntimeProgress, isCancelRequested, pipMetadataDirs, pythonSiteDir, readDownloadSource, requestRuntimeCancel, restartServerWhenIdle, runRuntimeInstaller, runtimeInstalled, runtimeInstaller, runtimeInstalls, trackRuntimeProc } from "./dev-runtimes";
import type { DevRuntimeId, DevRuntimeSpec } from "./dev-runtimes";
import { sendToWindow } from "./window-bus";
import { readAppSettings, saveAppSettings } from "../app-settings";
import type { AppSettings } from "../app-settings";
import { ensurePonytailPlugin } from "../ponytail-plugin";
import { layaInstall } from "./laya-service";
import { installPhoneHarness } from "./phone-harness";
import { codexHome, server } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

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

function runtimeList() {
  return (Object.entries(devRuntimeSpecs) as [DevRuntimeId, DevRuntimeSpec][])
    .filter(([id]) => !(IS_MAC && DARWIN_HIDDEN.has(id)))
    .map(([id, spec]) => ({
      id, ...specFor(id, spec),
      installed: runtimeInstalled(id, spec),
      installedBySystem: runtimeInstalledBySystem(id),
      installing: runtimeInstalls.has(id),
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

/** npm 包（nuphus / playwright-cli / cloakbrowser）的卸载落点：**包体目录 + 它自己的 shim**。
 *  ⛔⛔ 为什么不能按 marker 首段推导：marker 是 `npm-global\node_modules\@nuphus\nuphus-mcp\package.json`，
 *    首段推导会得到 `tools/npm-global` —— 那是几个 npm 能力的**共同家目录**，卸载一个会把其它一起删光。
 *  ⛔ 10-01 用户报「卸载不真」的根因：旧实现只删 `npm-global/<pkg>`（那是 **shim 文件**），
 *    真正的包体 `npm-global/node_modules/<pkg>` 原地不动 ⇒ 卡片显示「未安装」但包还在。 */
const NPM_PACKAGE_ARTIFACTS: Partial<Record<DevRuntimeId, { dirs: string[]; shims: string[] }>> = {
  nuphus: { dirs: ["node_modules/@nuphus"], shims: ["nuphus-mcp", "nuphus-call"] },
  "playwright-cli": { dirs: ["node_modules/@playwright/cli"], shims: ["playwright-cli"] },
  cloakbrowser: { dirs: ["node_modules/cloakbrowser"], shims: ["cloakbrowser"] },
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
    //   「卸载了但仍显示已安装」（cloakbrowser 实测）。落位清单来自单一真相源，别手拼。
    // ⛔⛔⛔ dirs 里的路径是相对 **npm-global 前缀**的（`node_modules/cloakbrowser`），
    //   而候选落位 npmGlobalRootCandidates() 返回的**已含 node_modules 一段** ——
    //   直接 join 会拼出 `node_modules/node_modules/cloakbrowser` ⇒ **包体从来就没被删过**
    //   （Windows 同样中招，10-07 实测才抓到）。所以这里必须 join 到前缀（= 落位的上一级）。
    return npmGlobalRootCandidates().flatMap((root) => {
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
    const site = pythonSiteDir(path.join(toolsRoot(), "python"));
    if (!site) return [path.join(toolsRoot(), pipDir)];
    // ⛔⛔ 必须连**元数据目录**一起删（10-08 用户实测事故「开发工具装完不更新」）：只删包目录会留下
    //   `<name>-<ver>.dist-info`，pip 据此认为「已安装」⇒ 重装时回 `Requirement already satisfied`
    //   且 exit 0（什么都不做），而判定看的是包目录 ⇒ 界面报「安装成功」但卡片永远显示未安装。
    //   markitdown / laya / phone-harness 三个 pip 包都在这个分支上，一起覆盖。
    return [path.join(site, pipDir), ...pipMetadataDirs(site, pipDir)];
  }
  // 工具侧：安装根 = marker 路径的第一段（playwright-browsers -> pw-browsers / git -> git / …）
  return [path.join(toolsRoot(), spec.marker.split(/[\\/]/)[0])];
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
    + `（安装根目录：${toolsRoot()}）。这通常是安装器「假成功」（命令退出码 0 但没落盘），`
    + "请把本页日志反馈给开发者；重复点「下载」不会自愈。"
  );
}

/** 浏览器内核按需下载（09-16 起内核不再随包）：先走国内镜像，失败回落官方源直连。 */
async function runBrowserDownload(
  id: DevRuntimeId, node: string, cli: string, args: string[], label: string, source: NonNullable<AppSettings["downloadSource"]> = "auto",
): Promise<void> {
  const mirrored = downloadEnv();
  const mirrorKeys = ["PLAYWRIGHT_DOWNLOAD_HOST", "CLOAKBROWSER_DOWNLOAD_URL"].filter((key) => mirrored[key]);
  const official = { ...mirrored };
  for (const key of mirrorKeys) delete official[key];
  const attempts = source === "direct" || !mirrorKeys.length
    ? [{ env: official, via: "官方源" }]
    : [{ env: mirrored, via: "国内镜像" }, { env: official, via: "官方源" }];
  let lastError: Error | null = null;
  for (let index = 0; index < attempts.length; index++) {
    const via = attempts[index].via;
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(node, [cli, ...args], { windowsHide: true, env: attempts[index].env });
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
        child.on("close", (code) => code === 0 ? resolve() : reject(new Error(tail.trim().slice(-1200) || `${label}下载失败（${code}）`)));
      });
      return;
    } catch (error) {
      lastError = error as Error;
      if (index < attempts.length - 1) {
        sendToWindow("runtime:progress", { id, message: `${label}${attempts[index].via}下载失败，改用官方源重试…`, percent: 0 });
      }
    }
  }
  throw lastError ?? new Error(`${label}下载失败`);
}

/** npm 包按需安装：用**内置 node 自带的 npm**，registry 国内镜像优先、失败回落官方源。 */
async function runNpmInstall(id: DevRuntimeId, pkg: string, label: string, source: NonNullable<AppSettings["downloadSource"]> = "auto"): Promise<void> {
  const node = bundledNode();
  if (!node) throw new Error(`缺少内置 Node，无法安装 ${label}`);
  // ⛔ 按平台候选探测（Windows zip 布局 / mac tar.gz 布局）—— 别在这里复制路径字面量，见 toolchain.bundledNpmCli
  const npmCli = bundledNpmCli();
  if (!npmCli) throw new Error(`内置 Node 缺少 npm（候选中无 npm-cli.js，tools 根：${toolsRoot()}），无法安装 ${label}`);
  const globalDir = path.join(toolsRoot(), "npm-global");
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
        const child = spawn(node, [npmCli, "install", "--global", "--prefix", globalDir, pkg, "--no-audit", "--no-fund"], { windowsHide: true, env });
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
  return path.join(toolsRoot(), rel);
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

const RUNTIME_CHANNELS = ["runtime:list", "runtime:install", "runtime:uninstall", "runtime:cancel", "runtime:health"];

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
      // 随包内置能力（nuphus / playwright-cli / ponytail 插件），不是联网下载 —— 删了没有可靠的重取途径
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
      const allowedRoots = [toolsRoot(), codexHome].filter(Boolean).map((r) => path.resolve(r));
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
        const url = id === "openssl"
          ? "https://slproweb.com/products/Win32OpenSSL.html"
          : "https://www.docker.com/products/docker-desktop/";
        await shell.openExternal(url);
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
          sendToWindow("runtime:progress", { id, percent: 100, message: "安装完成", done: true });
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
      const task = (async () => {
        if (id === "ponytail") {
          // ⛔ 必须排在 spec.bundled 分支**之前**：ponytail 也是 bundled，但它的修复路径是「重种插件」
          //    而不是「解压 automation-tools.zip」——漏了会让「修复安装 ponytail」把 zip 解到 npm-global。
          await ensurePonytailPlugin(codexHome, path.join(toolsRoot(), "ponytail-plugin"));
          // 卸载时把注册段置成了 false，这里必须显式置回 true —— seedConfigSections 是
          // 「段已存在就幂等跳过」，不会自己翻回 true，漏了会导致「卸载→重装」后插件永久不可用。
          await server.request("config/value/write", {
            filePath: path.join(codexHome, "config.toml"),
            keyPath: 'plugins."ponytail@ponytail".enabled',
            value: true,
            mergeStrategy: "replace",
          }).catch(() => undefined);
        } else if (spec.bundled) {
          // 随包内置能力的「修复安装」（nuphus / playwright-cli）：从随包 zip 重新解压。
          if (!bundledNode()) await runRuntimeInstaller("node", runtimeInstaller("install-runtimes.cjs"), ["node"], process.execPath, { DOWNLOAD_SOURCE: downloadSource });
          // ⛔ 只认随包 zip（解压安装），**不再回落在线下载**（09-12 用户实测发布包故障）：
          //   GitHub Release 那个 automation-tools.zip 资产根本不存在，回落只会撞死地址。
          const bundledAutomationZip = path.join(toolsRoot(), "automation-tools.zip");
          if (!existsSync(bundledAutomationZip)) {
            throw new Error(
              `随包缺少 tools/automation-tools.zip —— 这一版安装包不完整，装不了「${spec.name}」。`
              + "请更新到带该文件的版本；自建包时先在本机装一次自动化工具链再执行打包。"
            );
          }
          await runRuntimeInstaller(id, runtimeInstaller("install-automation.cjs"), [], bundledNode());
          // 解压安装成功后自动激活「桌面自动化」「浏览器自动化」联动开关
          await saveAppSettings(app.getPath("userData"), { desktopAutomation: true, browserAutomation: true });
        } else if (id === "cloakbrowser") {
          await runNpmInstall(id, "cloakbrowser", "CloakBrowser", downloadSource);
        } else if (id === "playwright-browsers") {
          const node = bundledNode();
          const cli = path.join(npmGlobalRoot(), "@playwright", "cli", "node_modules", "playwright", "cli.js");
          if (!node || !existsSync(cli)) throw new Error("缺少 Playwright CLI，请先在「开发工具」安装「Playwright 浏览器自动化」");
          await runBrowserDownload(id, node, cli, ["install", "chromium"], "浏览器内核", downloadSource);
        } else if (id === "cloak-browsers") {
          const node = bundledNode();
          const cli = path.join(npmGlobalRoot(), "cloakbrowser", "dist", "cli.js");
          if (!node || !existsSync(cli)) throw new Error("缺少 CloakBrowser，请先在「开发工具」安装「CloakBrowser 指纹浏览器」（约 4 MB）");
          await runBrowserDownload(id, node, cli, ["install"], "Cloak 内核", downloadSource);
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

    ctx.effect(() => {
      for (const ch of RUNTIME_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
