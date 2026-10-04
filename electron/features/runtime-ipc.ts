/**
 * runtime-ipc（10-03 从 `features/engine-ipc/03-dev-runtime` + `04-dev-runtime-install` 合并成单前缀板块，
 * 同时改为**插件形态**）
 *
 * 域：runtime(4)
 * 通道：runtime:list / install / uninstall / health
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
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { app, shell } from "electron";
import { CHINA_NPM_REGISTRY, bundledNode, downloadEnv, npmGlobalRoot, pythonPipReady, toolchainEnv, toolsRoot } from "../toolchain";
import { installKbEmbedding } from "./kb-embed-backend";
import { DARWIN_HIDDEN, DARWIN_MARKERS, DARWIN_SPEC_TEXT, IS_MAC, PIP_PACKAGE_DIRS, devRuntimeSpecs, emitRuntimeProgress, pythonSiteDir, readDownloadSource, restartServerWhenIdle, runRuntimeInstaller, runtimeInstalled, runtimeInstaller, runtimeInstalls } from "./dev-runtimes";
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

/** npm 包在 npm-global 根与 node_modules/.bin 下留的 shim（不是包体，删完包体要顺手清掉）。 */
function npmShimPaths(...pkgs: string[]): string[] {
  const globalDir = path.join(toolsRoot(), "npm-global");
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
  const pkg = NPM_PACKAGE_ARTIFACTS[id];
  if (pkg) {
    const global = npmGlobalRoot();
    return [...pkg.dirs.map((dir) => path.join(global, dir)), ...npmShimPaths(...pkg.shims)];
  }
  // ⛔ pip 包（markitdown / laya / phone-harness）：只能删**包目录本身**。按 marker 首段推导会得到
  //    `tools/python` —— 那是整个 Python 运行时（含 pip 与引擎依赖），卸载一个包会把 Python 一起删光。
  const pipDir = PIP_PACKAGE_DIRS[id];
  if (pipDir) {
    const site = pythonSiteDir(path.join(toolsRoot(), "python"));
    return [site ? path.join(site, pipDir) : path.join(toolsRoot(), pipDir)];
  }
  // 工具侧：安装根 = marker 路径的第一段（playwright-browsers -> pw-browsers / git -> git / …）
  return [path.join(toolsRoot(), spec.marker.split(/[\\/]/)[0])];
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
  const npmCli = path.join(toolsRoot(), "node", "node_modules", "npm", "bin", "npm-cli.js");
  if (!existsSync(npmCli)) throw new Error(`内置 Node 缺少 npm（${npmCli}），无法安装 ${label}`);
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

const RUNTIME_CHANNELS = ["runtime:list", "runtime:install", "runtime:uninstall", "runtime:health"];

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
      // 要求每个 target 必须落在 toolsRoot 或 codexHome 之内，且不等于这两者本身。
      const allowedRoots = [toolsRoot(), codexHome].filter(Boolean).map((r) => path.resolve(r));
      for (const target of targets) {
        const resolvedTarget = path.resolve(target);
        const underAllowed = allowedRoots.some((r) => resolvedTarget.startsWith(r + path.sep));
        if (!resolvedTarget || allowedRoots.includes(resolvedTarget) || !underAllowed) {
          throw new Error("安装路径解析异常，已取消卸载");
        }
        // 一些 marker 是文件而不是目录（如 npm-global 下的 shim）—— 逐个删：先包体、再 shim
        await fs.rm(resolvedTarget, { recursive: true, force: true });
      }
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
      return { ok: true, runtimes: runtimeList() };
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
        // 知识库本地 embedding 后端（10-04）：npm 装 @huggingface/transformers 到 <userData>/kb-backend，
        // 模型权重首次检索时经 hf-mirror 下载。不走 tools 目录、不随包（用户令：别拉大安装包）。
        const task = (async () => {
          emitRuntimeProgress(id, "正在安装本地 embedding 运行库（国内镜像优先）…");
          await installKbEmbedding((text: string) => emitRuntimeProgress(id, text));
        })();
        runtimeInstalls.set(id, task.finally(() => runtimeInstalls.delete(id)) as Promise<void>);
        await task.catch((error) => { throw error instanceof Error ? error : new Error(String(error)); });
        return { ok: true, runtimes: runtimeList() };
      }
      if (id === "laya" || id === "phone-harness") {
        const task = (async () => {
          const result = id === "laya" ? await layaInstall() : await installPhoneHarness();
          if (!result.ok) throw new Error(result.log.split("\n").filter(Boolean).slice(-1)[0] || `${spec.name} 安装失败`);
        })();
        runtimeInstalls.set(id, task.finally(() => runtimeInstalls.delete(id)) as Promise<void>);
        await task.catch((error) => { throw error instanceof Error ? error : new Error(String(error)); });
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
        sendToWindow("runtime:progress", { id, message: "安装完成", percent: 100, speed: "", done: true });
        return { ok: true, runtimes: runtimeList() };
      } finally {
        runtimeInstalls.delete(id);
      }
    });

    ctx.effect(() => {
      for (const ch of RUNTIME_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
