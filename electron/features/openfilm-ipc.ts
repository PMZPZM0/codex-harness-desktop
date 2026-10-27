/**
 * openfilm-ipc（10-27 新增：OpenFilm 视频剪辑对接域）
 *
 * 域：**OpenFilm**（第三方开源项目 https://github.com/openfilm/openfilm ，MIT + 商标条款）
 * 通道（9）：
 *   openfilm:status / settings-get / settings-set / install / retry / uninstall / update-check
 *   openfilm:studio-open / studio-status（批次二新增：Studio 连接与探活）
 *
 * ⛔⛔ 三条硬纪律（照 docs/OPENFILM-INTEGRATION-2026-10-27.md）：
 *   ① **不内置任何 OpenFilm 二进制**：CLI 由 npm 装进 `<tools>/openfilm/runtime`（覆盖安装可保留），
 *      ffmpeg 用**我们自己的**内置 ffmpeg，⛔ 不下载上游安装包。
 *   ② **不碰用户的影片**：卸载只删 `runtime/`，⛔ 绝不递归删 `<workspace>/films`。
 *   ③ **一律走国内镜像**：npm → registry.npmmirror.com（复用 toolchain 的单一真相源），
 *      Chromium → cdn.npmmirror.com/binaries/playwright（playwright 自己的 env），失败自动回官方。
 *
 * 结构（批次二拆开，避免 ipc ↔ studio 互相 import 成环）：
 *   openfilm/paths.ts   路径与设置（唯一真相源）
 *   openfilm/runner.ts  子进程出口（spawn args[]、超时、内置 node + toolchain PATH）
 *   openfilm/probe.ts   「现在什么状态」（CLI/浏览器/ffmpeg/Studio）
 *   openfilm/studio.ts  Studio 打开与 session 探活
 *   openfilm/tools.ts   模型工具面（6 个 dynamicTools + 主进程应答）
 *   本文件 = **IPC 面 + 安装器**
 *
 * ⛔ 惰性求值：本模块**不得**在顶层调 `app.getPath()` / `writeToolsRoot()`
 *    （模块体早于 main.ts 的 `app.setPath("userData")`，会拿到默认目录 —— 记忆里的 91 号坑）。
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { broadcastCodexEvent } from "./window-bus";
import { CHINA_NPM_REGISTRY, bundledNpmCli } from "../toolchain";
import { compareVersions } from "../updates";
import {
  PKG, cliEntry, cliVersion, openfilmRoot, pkgDir, readSettings, runtimeDir, writeSettings,
  type Settings,
} from "../openfilm/paths";
import { runNode } from "../openfilm/runner";
import { browserInstalled, ffmpegState, openfilmStatus, type OpenfilmPhase, type OpenfilmStatus } from "../openfilm/probe";
import { openStudio, probeStudio } from "../openfilm/studio";

/* 声明常量（界面/文档/技能同一份事实；⛔ 前端不另写文案） */
export { OPENFILM_HOME, OPENFILM_LICENSE, OPENFILM_SITE, OPENFILM_TRADEMARK_NOTE } from "../openfilm/brand";
export type { OpenfilmStatus, OpenfilmPhase };

/** Chromium 的国内镜像（playwright 自己的下载根；失败回官方）。 */
const PLAYWRIGHT_MIRROR = "https://cdn.npmmirror.com/binaries/playwright";

export type OpenfilmStep = "cli" | "chromium" | "verify";

/* ── 安装（分步、可单步重试、每步一条进度事件） ────────────────────────── */

const STEP_LABEL: Record<OpenfilmStep, string> = { cli: "下载并安装 OpenFilm 命令行", chromium: "下载渲染引擎（Chromium ≈100MB）", verify: "校验安装" };

function progress(step: OpenfilmStep, pct: number, log?: string) {
  broadcastCodexEvent({ type: "openfilm", phase: "install", step, label: STEP_LABEL[step], pct, log: log ?? "" });
}

/** 安装 CLI（npm 装进私有 prefix；镜像优先，失败回官方）。 */
async function installCli(tag = "latest"): Promise<void> {
  const npmCli = bundledNpmCli();
  if (!npmCli) throw coded("OF_E_NPM_MISSING", "缺少内置 npm，请先到「设置 → 开发工具」安装内置 Node（它会带上 npm）");
  const settings = readSettings();
  const registries = settings.mirror === "official" ? ["https://registry.npmjs.org"] : [CHINA_NPM_REGISTRY, "https://registry.npmjs.org"];
  const args = (registry: string) => [npmCli, "install", `${PKG}@${tag}`, "--prefix", runtimeDir(), "--registry", registry,
    "--no-audit", "--no-fund", "--loglevel=error", "--omit=dev"];
  let lastError = "";
  for (const registry of registries) {
    progress("cli", 10, `从 ${new URL(registry).host} 获取 ${PKG}@${tag} …`);
    const result = await runNode(args(registry), {
      cwd: openfilmRoot(),
      timeoutMs: 15 * 60_000,
      onLine: (line) => progress("cli", 40, line.slice(0, 400)),
    });
    if (result.code === 0) { progress("cli", 100, `已安装 ${PKG}@${cliVersion() || tag}`); return; }
    lastError = (result.stderr || result.stdout || `退出码 ${result.code}`).trim().slice(-800);
    progress("cli", 40, `源 ${new URL(registry).host} 失败，换下一个源…`);
  }
  throw coded("OF_E_NPM_REGISTRY", `安装 ${PKG} 失败（镜像与官方源都不可用）：${lastError}`);
}

/** 安装 playwright 的 chromium-headless-shell（≈100MB；镜像优先）。 */
async function installChromium(): Promise<void> {
  const cli = path.join(runtimeDir(), "node_modules", "playwright-core", "cli.js");
  if (!fs.existsSync(cli)) throw coded("OF_E_BROWSER_DOWNLOAD", "包内没有 playwright-core（CLI 可能没装成功），请先重试第一步");
  if (browserInstalled()) { progress("chromium", 100, "渲染引擎已在缓存中，跳过下载"); return; }
  const settings = readSettings();
  const attempts: { host: string; label: string }[] = settings.mirror === "official"
    ? [{ host: "", label: "官方 CDN" }]
    : [{ host: PLAYWRIGHT_MIRROR, label: new URL(PLAYWRIGHT_MIRROR).host }, { host: "", label: "官方 CDN" }];
  let lastError = "";
  for (const attempt of attempts) {
    progress("chromium", 15, `从 ${attempt.label} 下载渲染引擎（约 100MB，仅首次）…`);
    const result = await runNode([cli, "install", "chromium-headless-shell"], {
      cwd: openfilmRoot(),
      timeoutMs: 30 * 60_000,
      env: attempt.host ? { PLAYWRIGHT_DOWNLOAD_HOST: attempt.host } : {},
      onLine: (line) => progress("chromium", 55, line.slice(0, 400)),
    });
    if (result.code === 0 && browserInstalled()) { progress("chromium", 100, "渲染引擎就绪"); return; }
    lastError = (result.stderr || result.stdout || `退出码 ${result.code}`).trim().slice(-800);
    progress("chromium", 55, `${attempt.label} 失败，换下一个源…`);
  }
  throw coded("OF_E_BROWSER_DOWNLOAD", `渲染引擎下载失败：${lastError}\n可手动执行：node "${cli}" install chromium-headless-shell`);
}

/** 校验：读版本 + 跑 doctor（doctor 失败只记录不抛 —— 它只是体检）。 */
async function verifyInstall(): Promise<void> {
  const version = cliVersion();
  if (!version) throw coded("OF_E_VERIFY", "装完读不到 openfilm 的版本号，安装可能没落盘");
  progress("verify", 40, `OpenFilm CLI ${version}`);
  const ff = await ffmpegState();
  if (!ff.ok) progress("verify", 70, "提示：没有可用的 ffmpeg，look / render 会失败（到「开发工具」页装 FFmpeg）");
  try {
    const doctor = await runNode([cliEntry(), "doctor"], { cwd: openfilmRoot(), timeoutMs: 60_000 });
    for (const line of doctor.stdout.split("\n").slice(0, 12)) if (line.trim()) progress("verify", 85, line.trim().slice(0, 300));
  } catch { /* doctor 缺失/失败不影响安装结论 */ }
  progress("verify", 100, "安装完成");
}

const STEPS: Record<OpenfilmStep, () => Promise<void>> = {
  cli: () => installCli(),
  chromium: () => installChromium(),
  verify: () => verifyInstall(),
};

function coded(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

/** 全量安装（三步连贯）；`only` 给单步重试用。⛔ 并发保护：同一时刻只允许一个安装任务。 */
let busy = false;
async function runInstall(only?: OpenfilmStep): Promise<{ ok: boolean; code?: string; error?: string; status: OpenfilmStatus }> {
  if (busy) return { ok: false, code: "OF_E_BUSY", error: "已有安装任务在进行，请稍候", status: await openfilmStatus() };
  busy = true;
  const marker = path.join(openfilmRoot(), ".installing");
  try {
    fs.mkdirSync(openfilmRoot(), { recursive: true });
    fs.writeFileSync(marker, String(Date.now()), "utf8");
    const steps: OpenfilmStep[] = only ? [only] : ["cli", "chromium", "verify"];
    for (const step of steps) await STEPS[step]();
    return { ok: true, status: await openfilmStatus() };
  } catch (error: any) {
    const code = String(error?.code ?? "OF_E_UNKNOWN");
    const message = String(error?.message ?? error);
    broadcastCodexEvent({ type: "openfilm", phase: "install", step: only ?? "cli", pct: 0, error: code, message });
    return { ok: false, code, error: message, status: await openfilmStatus() };
  } finally {
    busy = false;
    try { fs.rmSync(marker, { force: true }); } catch { /* 标记删不掉下次会显示 installing，可接受 */ }
  }
}

/* ── 卸载（⛔ 只删 runtime，绝不碰影片） ───────────────────────────────── */

async function uninstall(): Promise<{ ok: boolean; removed: number; error?: string }> {
  const root = openfilmRoot();
  /* ⛔ 安全闸：删除目标必须是自己算出来的 openfilm 根，且深度 ≥ 2 —— 防止 tools 根被配置坏时删到用户目录。 */
  const resolved = path.resolve(root);
  if (!/openfilm$/i.test(resolved) || resolved.split(path.sep).filter(Boolean).length < 3) {
    return { ok: false, removed: 0, error: "拒绝卸载：安装目录不符合预期（未删除任何文件）" };
  }
  let removed = 0;
  try {
    const entries = await fsp.readdir(resolved);
    for (const entry of entries) {
      /* ⛔ 白名单：只删运行时与安装标记。用户的影片不在这个根下，这里也绝不按通配删 */
      if (entry === "runtime" || entry === ".installing") {
        await fsp.rm(path.join(resolved, entry), { recursive: true, force: true });
        removed += 1;
      }
    }
  } catch { /* 目录不存在 = 已经没了 */ }
  return { ok: true, removed };
}

/* ── 版本检查（镜像优先；比较只认 compareVersions） ─────────────────────── */

async function latestVersion(): Promise<{ version: string; source: string }> {
  const settings = readSettings();
  const sources = settings.mirror === "official"
    ? ["https://registry.npmjs.org"]
    : [CHINA_NPM_REGISTRY, "https://registry.npmjs.org"];
  let lastError = "";
  for (const base of sources) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${base}/${PKG}/latest`, { signal: controller.signal });
      if (!response.ok) { lastError = `HTTP ${response.status}`; continue; }
      const data: any = await response.json();
      const version = String(data?.version ?? "");
      if (version) return { version, source: new URL(base).host };
      lastError = "响应里没有 version";
    } catch (error: any) {
      lastError = String(error?.message ?? error);
    } finally { clearTimeout(timer); }
  }
  throw new Error(`读取最新版本失败：${lastError}`);
}

const CHECK_INTERVAL_MS = 24 * 3600_000;

/**
 * 启动时按设置查一次（「关 / 启动时检查 / 自动安装」三档的第二、三支）。
 * ⛔ 没装就没有"更新"这回事（也就不会在启动时打网络）；24h 节奏靠 settings.lastCheckedAt。
 * ⛔ 网络失败静默：启动链路上不许因为查版本卡住或报错。
 */
async function autoUpdateOnStartup(): Promise<void> {
  const settings = readSettings();
  if (settings.autoUpdate === "off") return;
  const current = cliVersion();
  if (!current) return;
  if (Date.now() - Number(settings.lastCheckedAt ?? 0) < CHECK_INTERVAL_MS) return;
  writeSettings({ lastCheckedAt: Date.now() });
  try {
    const latest = await latestVersion();
    const hasUpdate = compareVersions(latest.version, current) > 0;
    broadcastCodexEvent({ type: "openfilm", phase: "update", current, latest: latest.version, source: latest.source, hasUpdate });
    if (hasUpdate && settings.autoUpdate === "auto") await runInstall("cli");
  } catch { /* 离线/镜像不可用：下次再说 */ }
}

/* ── 域注册 ─────────────────────────────────────────────────────────────── */

export const openfilmFeature = defineFeature<null>({
  id: "openfilm",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("openfilm: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("openfilm:status", () => openfilmStatus());
    ipcHost.handle("openfilm:settings-get", () => readSettings());
    ipcHost.handle("openfilm:settings-set", (_event, patch: unknown) => writeSettings((patch ?? {}) as Partial<Settings>));
    ipcHost.handle("openfilm:install", (_event, step?: unknown) => {
      const only = step === "cli" || step === "chromium" || step === "verify" ? step : undefined;
      return runInstall(only);
    });
    ipcHost.handle("openfilm:retry", (_event, step?: unknown) => {
      const only = step === "cli" || step === "chromium" || step === "verify" ? step : "verify";
      return runInstall(only);
    });
    ipcHost.handle("openfilm:uninstall", () => uninstall());
    ipcHost.handle("openfilm:update-check", async () => {
      const current = cliVersion();
      try {
        const latest = await latestVersion();
        return {
          current, latest: latest.version, source: latest.source,
          hasUpdate: Boolean(current) && compareVersions(latest.version, current) > 0,
        };
      } catch (error: any) {
        return { current, latest: "", source: "", hasUpdate: false, error: String(error?.message ?? error) };
      }
    });
    /* 批次二：Studio 连接（这就是需求里的「连接与配对」）。⛔ 只开不杀：
       这个实例可能正被上游桌面 App 或另一个 agent 用着，杀它 = 丢用户没保存的手改。 */
    ipcHost.handle("openfilm:studio-open", (_event, filmDir?: unknown) => openStudio({ filmDir: String(filmDir ?? "") }));
    ipcHost.handle("openfilm:studio-status", () => probeStudio());

    /* 启动检查：延后 20s（不拖慢启动，也不与首屏抢网络） */
    void app.whenReady().then(() => {
      setTimeout(() => { void autoUpdateOnStartup(); }, 20_000);
    }).catch(() => undefined);
  },
});
