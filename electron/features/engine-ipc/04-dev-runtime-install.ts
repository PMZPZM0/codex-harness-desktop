/**
 * engine-ipc 的「dev-runtime-install」部分（09-22 从同目录 engine-ipc.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { app, dialog, ipcMain, safeStorage, shell } from "electron";
import { broadcastHarnessEvent, sendToWindow } from "../../features/window-bus";
import { readAppSettings, saveAppSettings } from "../../app-settings";
import { CHINA_NPM_REGISTRY, bundledNode, downloadEnv, npmGlobalRoot, toolchainEnv, toolsRoot } from "../../toolchain";
import { ensurePonytailPlugin } from "../../ponytail-plugin";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import type { AppSettings } from "../../app-settings";
import { DARWIN_HIDDEN, DARWIN_SPEC_TEXT, IS_MAC, devRuntimeSpecs, emitRuntimeProgress, pythonSiteDir, readDownloadSource, restartServerWhenIdle, runRuntimeInstaller, runtimeInstalled, runtimeInstaller, runtimeInstalls } from "../dev-runtimes";
import { bridgeDial, readCustomModel, responsesBridge, restrictedThreadRole } from "../../main";
import { codexHome, engineActiveTurnIds, mainWindow, server, threadCwd, threadRuntimeStore } from "../../runtime-refs";
import type { DevRuntimeId, DevRuntimeSpec } from "../dev-runtimes";
import { runtimeList } from "./03-dev-runtime";
/** 浏览器内核按需下载（09-16 起内核不再随包）：先走国内镜像，失败回落官方源直连。
 *  用户自设了 PLAYWRIGHT_DOWNLOAD_HOST / CLOAKBROWSER_DOWNLOAD_URL 时尊重用户配置，
 *  此时第一轮已是用户指定的源，回落轮仍是官方源。进度实时推给设置页。
 *  ⛔ 09-20 下载源选择：direct = 只走官方；mirror/auto = 镜像优先；gh 加速前缀与本机代理
 *  对这两类内核的 CDN 通道无从生效（Cloak 内核的镜像本身就是 ghfast 前缀）→ 按 auto 处理。 */
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

/**
 * npm 包按需安装（09-16：CloakBrowser 从随包剥离后按需下载）。
 *  · 用**内置 node 自带的 npm**——开发工具页的安装链路不能依赖用户机器装没装 node/npm；
 *  · registry 国内镜像优先（npmmirror），失败回落官方源（不设 registry = npm 默认源）；
 *  · 用户自设了 npm_config_registry 时尊重用户配置，只跑一轮（不擅自改用户指定的源）。
 *  ⛔ 09-20 下载源选择：direct = 只走官方源；其余（auto/mirror/gh 加速/proxy）都是
 *  「镜像优先、失败回落官方」——npm registry 没有 gh 加速通道，gh 前缀对它无从生效。
 */
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

ipcMain.handle("runtime:install", async (_event, idValue: string) => {
  const id = idValue as DevRuntimeId;
  if (!devRuntimeSpecs[id]) throw new Error("未知开发工具");
  if (devRuntimeSpecs[id].builtIn) return { ok: true, runtimes: runtimeList() };
  // ⛔ 09-20 下载源选择：所有按需下载通道（工具链 / npm 包 / 浏览器内核）统一从这里读源，
  //    用户在「开发工具」页切完源，下一次下载立即生效（每次现读 app-settings，不缓存）。
  const downloadSource = await readDownloadSource();
  // ⛔ 同一工具并发安装：**等它跑完**，不要抛「该工具正在安装」（09-18 用户反馈截图）。
  //   触发场景很常见：首次启动的 Git 后台自愈安装（`autoInstallGitIfNeeded`，仅 Windows）会占住 `git`，
  //   而体检弹窗的「一键安装」里 git 恰好排在可安装项第一位 → 用户点一次就得到
  //   「安装失败：Error invoking remote method 'runtime:install': Error: 该工具正在安装」，
  //   既看不懂，又让**整批安装被中断**（后两项也没装）。等待语义对用户才是正确的。
  const inFlight = runtimeInstalls.get(id);
  if (inFlight) {
    // 它成功 → 一起成功；它真失败 → 把真实错误抛给调用方（不假装成功）
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
  // 判定用 runtimeInstalled（与清单同一份逻辑）——ponytail 的 marker 在引擎侧 cache，不在 tools 目录。
  if (spec.bundled && runtimeInstalled(id, spec)) return { ok: true, runtimes: runtimeList() };
  const task = (async () => {
    if (id === "ponytail") {
      // ponytail 写代码模式插件（bundled）：从随包安装源种到引擎（plugins cache + config 注册段），技能随 cache 自动列出。
      // ⛔ 必须排在 spec.bundled 分支**之前**：ponytail 也是 bundled，但它的修复路径是「重种插件」
      //    而不是「解压 automation-tools.zip」——漏了会让「修复安装 ponytail」把 zip 解到 npm-global。
      await ensurePonytailPlugin(codexHome, path.join(toolsRoot(), "ponytail-plugin"));
      // 卸载时把注册段置成了 false，这里必须显式置回 true —— seedConfigSections 是
      // 「段已存在就幂等跳过」，不会自己翻回 true，漏了会导致「卸载→重装」后插件永久不可用。
      await server.request("config/value/write", {
        filePath: path.join(codexHome, "config.toml"),
        keyPath: 'plugins."ponytail@ponytail".enabled',
        value: true,
        // ⛔ 同卸载分支：引擎必填 mergeStrategy（缺了整条请求被拒且此处 catch 吞掉），
        //    漏了会让「卸载→重装」后插件永久 disabled（seedConfigSections 幂等不回滚 enabled）。
        mergeStrategy: "replace",
      }).catch(() => undefined);
    } else if (spec.bundled) {
      // 随包内置能力的「修复安装」（nuphus / playwright-cli）：从随包 zip 重新解压。
      // 正常情况下卡片直接显示「内置」，界面不给按钮；只有目录被误删/损坏时才会走到这里。
      // 内置 node 是解压器的引导运行时（install-automation.cjs 依赖它跑 python/7z）。
      if (!bundledNode()) await runRuntimeInstaller("node", runtimeInstaller("install-runtimes.cjs"), ["node"], process.execPath, { DOWNLOAD_SOURCE: downloadSource });
      // ⛔ 只认随包 zip（解压安装），**不再回落在线下载**（09-12 用户实测发布包故障）：
      //   旧实现找不到 zip 就去拉 GitHub Release 的 automation-tools.zip —— 而那个资产
      //   **根本不存在**（实测 v0.0.13 的 release 只有两个 mac zip），于是用户看到的是
      //   「直接下载失败」。既然装不上就当场说清楚，别去撞一个死地址。
      //   保证「包里一定有 zip」是打包链路的责任：scripts/before-pack.cjs 现在**硬失败**
      //   （并且直接校验随包 npm-global 里 nuphus / playwright-cli 是否在位），宁可不打包也不发坏包。
      const bundledAutomationZip = path.join(toolsRoot(), "automation-tools.zip");
      if (!existsSync(bundledAutomationZip)) {
        throw new Error(
          `随包缺少 tools/automation-tools.zip —— 这一版安装包不完整，装不了「${spec.name}」。`
          + "请更新到带该文件的版本；自建包时先在本机装一次自动化工具链再执行打包。"
        );
      }
      await runRuntimeInstaller(id, runtimeInstaller("install-automation.cjs"), [], bundledNode());
      // 解压安装成功后自动激活「桌面自动化」「浏览器自动化」联动开关（nuphus MCP 注册 + 技能启用）
      await saveAppSettings(app.getPath("userData"), { desktopAutomation: true, browserAutomation: true });
    } else if (id === "cloakbrowser") {
      // CloakBrowser npm 包（09-16 起不随包）：npm 国内镜像优先、失败回落官方源。
      // 装完 CLOAKBROWSER_ENTRY 才会指向它（toolchainEnv 按标记文件存在与否注入），
      // 在此之前引擎侧看不到它 —— 默认浏览器用内置视图 / playwright-cli，不受影响。
      await runNpmInstall(id, "cloakbrowser", "CloakBrowser", downloadSource);
    } else if (id === "playwright-browsers") {
      // 用内置的 playwright CLI 下载 Chromium 到 pw-browsers（toolchainEnv 已注入 PLAYWRIGHT_BROWSERS_PATH；
      // 09-16 起内核不随包，这里按需下载：国内镜像优先、失败回落官方源）
      const node = bundledNode();
      const cli = path.join(npmGlobalRoot(), "@playwright", "cli", "node_modules", "playwright", "cli.js");
      if (!node || !existsSync(cli)) throw new Error("缺少 Playwright CLI，请先在「开发工具」安装「Playwright 浏览器自动化」");
      await runBrowserDownload(id, node, cli, ["install", "chromium"], "浏览器内核", downloadSource);
    } else if (id === "cloak-browsers") {
      // CloakBrowser 反检测 Chromium 内核下载到 tools/cloak-cache（toolchainEnv 已注入 CLOAKBROWSER_CACHE_DIR；
      // 09-16 起内核不随包，这里按需下载：国内镜像优先、失败回落官方源）
      const node = bundledNode();
      const cli = path.join(npmGlobalRoot(), "cloakbrowser", "dist", "cli.js");
      if (!node || !existsSync(cli)) throw new Error("缺少 CloakBrowser，请先在「开发工具」安装「CloakBrowser 指纹浏览器」（约 4 MB）");
      await runBrowserDownload(id, node, cli, ["install"], "Cloak 内核", downloadSource);
    } else {
      // ⛔ DOWNLOAD_SOURCE 经环境变量传给安装脚本（install-runtimes.cjs 按 it 分通道）——
      //    脚本 argv 的裸词会被当成工具 id，所以不用命令行参数传。
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
