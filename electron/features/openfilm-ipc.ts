/**
 * openfilm-ipc（10-27 新增：OpenFilm 视频剪辑对接域）
 *
 * 域：**OpenFilm**（第三方开源项目 https://github.com/openfilm/openfilm ，MIT + 商标条款）
 * 通道：openfilm:status / settings-get / settings-set / install / retry / uninstall / update-check
 *
 * ⛔⛔ 本域只做四件事：**探测 → 安装 → 卸载 → 查版本**。
 *    `open` / `look` / `render` / Studio 打开在下一批（需要 session 与内置浏览器联动），
 *    ⛔ 现在别在这里顺手塞一个"能跑 render"的通道 —— 没有 session 守护的 render 会留孤儿进程。
 *
 * ⛔⛔ 三条硬纪律（照 docs/OPENFILM-INTEGRATION-2026-10-27.md）：
 *   ① **不内置任何 OpenFilm 二进制**：CLI 由 npm 装进 `<tools>/openfilm/runtime`（覆盖安装可保留），
 *      ffmpeg 用**我们自己的**内置 ffmpeg（`bundledFfmpeg()`），⛔ 不下载上游安装包。
 *   ② **不碰用户的 film 目录**：卸载只删 `runtime/`，⛔ 绝不递归删 `<workspace>/films`。
 *   ③ **一律走国内镜像**：npm → registry.npmmirror.com（复用 toolchain 的单一真相源），
 *      Chromium → cdn.npmmirror.com/binaries/playwright（playwright 自己的 env），失败自动回官方。
 *
 * ⛔ 惰性求值：本模块**不得**在顶层调 `app.getPath()` / `writeToolsRoot()`
 *    （模块体早于 main.ts 的 `app.setPath("userData")`，会拿到默认目录 —— 记忆里的 91 号坑）。
 */
import { app } from "electron";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { broadcastCodexEvent } from "./window-bus";
import { CHINA_NPM_REGISTRY, bundledFfmpeg, bundledNode, bundledNpmCli, writeToolsRoot } from "../toolchain";
import { compareVersions } from "../updates";

/* ── 常量与路径（全部惰性） ─────────────────────────────────────────────── */

/** 官方仓与声明（界面/文档都要标注 —— 用户明确要求）。 */
export const OPENFILM_HOME = "https://github.com/openfilm/openfilm";
export const OPENFILM_SITE = "https://openfilm.dev";
export const OPENFILM_LICENSE = "MIT";
export const OPENFILM_TRADEMARK_NOTE =
  "「OpenFilm」名称与图标归 OpenFilm 项目所有（TRADEMARK.md）；本产品仅提供下载/安装/调用入口，与该项目无隶属或背书关系。";

/** npm 包名（bin = openfilm）。 */
const PKG = "openfilm";
/** Chromium 的国内镜像（playwright 自己的下载根；失败回官方）。 */
const PLAYWRIGHT_MIRROR = "https://cdn.npmmirror.com/binaries/playwright";

export type OpenfilmPhase = "absent" | "installing" | "ready" | "broken";
export type OpenfilmStep = "cli" | "chromium" | "verify";

type Settings = {
  /** 自动更新三档（与主应用同款语义） */
  autoUpdate: "off" | "startup" | "auto";
  /** 镜像策略：auto = 优先国内镜像，official = 只用官方 */
  mirror: "auto" | "official";
};

const DEFAULT_SETTINGS: Settings = { autoUpdate: "startup", mirror: "auto" };

/** 安装根（随工具目录走；覆盖安装后不用重下 100MB 浏览器）。 */
function openfilmRoot(): string {
  const base = writeToolsRoot() || app.getPath("userData");
  return path.join(base, "openfilm");
}
const runtimeDir = () => path.join(openfilmRoot(), "runtime");
const pkgDir = () => path.join(runtimeDir(), "node_modules", PKG);
const cliEntry = () => path.join(pkgDir(), "bin", "openfilm.mjs");
/* ⛔ 必须写成 function 声明（不是箭头 const）：预检【91】扫的是「模块顶层表达式里出现 app.getPath」，
   箭头函数在它眼里仍算顶层求值。 */
function settingsFile(): string {
  return path.join(app.getPath("userData"), "openfilm", "settings.json");
}

function readSettings(): Settings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
    return {
      autoUpdate: ["off", "startup", "auto"].includes(raw?.autoUpdate) ? raw.autoUpdate : DEFAULT_SETTINGS.autoUpdate,
      mirror: raw?.mirror === "official" ? "official" : "auto",
    };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

function writeSettings(patch: Partial<Settings>): Settings {
  const next: Settings = { ...readSettings(), ...patch };
  if (!["off", "startup", "auto"].includes(next.autoUpdate)) next.autoUpdate = DEFAULT_SETTINGS.autoUpdate;
  if (!["auto", "official"].includes(next.mirror)) next.mirror = "auto";
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2), "utf8");
  } catch { /* 落盘失败不影响主流程（下次读回默认值） */ }
  return next;
}

/* ── 子进程（一律 args 数组，⛔ 不经 shell / 不拼字符串） ───────────────── */

type RunResult = { code: number; stdout: string; stderr: string };

/** 用**内置 node**跑脚本（我们的 Electron 也带 node，但内置 node 版本可控且不受 app 退出影响）。 */
function nodeExe(): { exe: string; env: Record<string, string> } {
  const bundled = bundledNode();
  if (bundled) return { exe: bundled, env: {} };
  /* 极端兜底：用 Electron 自带的 node（ELECTRON_RUN_AS_NODE）。⛔ 必须显式给这个 env，
     否则 spawn 出来的会是第二个 Electron 窗口进程。 */
  return { exe: process.execPath, env: { ELECTRON_RUN_AS_NODE: "1" } };
}

function runNode(args: string[], opts: { timeoutMs?: number; cwd?: string; env?: Record<string, string>; onLine?: (line: string) => void } = {}): Promise<RunResult> {
  const node = nodeExe();
  return new Promise((resolve, reject) => {
    const child = spawn(node.exe, args, {
      cwd: opts.cwd || openfilmRoot(),
      env: { ...process.env, ...node.env, ...(opts.env ?? {}), NO_UPDATE_NOTIFIER: "1" },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timer: NodeJS.Timeout | null = null;
    const feed = (chunk: string, isErr: boolean) => {
      if (isErr) stderr += chunk; else stdout += chunk;
      for (const line of chunk.split(/\r?\n/)) {
        const text = line.trim();
        if (text && opts.onLine) { try { opts.onLine(text); } catch { /* 进度回调异常不影响安装 */ } }
      }
    };
    child.stdout?.on("data", (buf) => feed(String(buf), false));
    child.stderr?.on("data", (buf) => feed(String(buf), true));
    if (opts.timeoutMs) {
      timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* 已退出 */ } }, opts.timeoutMs);
    }
    child.on("error", (error) => { if (timer) clearTimeout(timer); reject(error); });
    child.on("close", (code) => { if (timer) clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
  });
}

/* ── 探测 ───────────────────────────────────────────────────────────────── */

function cliVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir(), "package.json"), "utf8"));
    return String(pkg?.version ?? "");
  } catch { return ""; }
}

/** playwright 的浏览器缓存根（playwright 自己不暴露查询接口，按平台约定枚举）。 */
function browserCacheRoots(): string[] {
  const roots = ["ms-playwright", "ms-playwright-go"];
  const out: string[] = [];
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    for (const name of roots) out.push(path.join(local, name));
  } else if (process.platform === "darwin") {
    for (const name of roots) out.push(path.join(os.homedir(), "Library", "Caches", name));
  } else {
    for (const name of roots) out.push(path.join(os.homedir(), ".cache", name));
  }
  return out;
}

/** 是否已经装过 chromium-headless-shell（只看目录名，⛔ 不启动它 —— 启动一次要 1~2 秒）。 */
function browserInstalled(): boolean {
  for (const root of browserCacheRoots()) {
    try {
      const entries = fs.readdirSync(root);
      if (entries.some((name) => name.startsWith("chromium_headless_shell") || name.startsWith("chromium-"))) return true;
    } catch { /* 目录不存在 */ }
  }
  return false;
}

async function binaryVersion(exe: string, args = ["-version"]): Promise<string> {
  if (!exe) return "";
  return new Promise((resolve) => {
    const child = spawn(exe, args, { windowsHide: true, env: { ...process.env } });
    let out = "";
    let timer: NodeJS.Timeout | null = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* 已退出 */ } resolve(""); }, 4000);
    child.stdout?.on("data", (buf) => { out += String(buf); });
    child.stderr?.on("data", (buf) => { out += String(buf); });
    child.on("error", () => { if (timer) { clearTimeout(timer); timer = null; } resolve(""); });
    child.on("close", () => {
      if (timer) { clearTimeout(timer); timer = null; }
      const match = out.match(/(\d+\.\d+(?:\.\d+)?)/);
      resolve(match ? match[1] : out.split("\n")[0].slice(0, 40));
    });
  });
}

/** 我们自己的内置 ffmpeg（⛔ 不下载上游的；GPL 传染风险见设计稿 §9）。 */
async function ffmpegState(): Promise<{ ok: boolean; path: string; version: string }> {
  const bundled = bundledFfmpeg();
  const exe = bundled || "ffmpeg";
  const version = await binaryVersion(exe, ["-version"]);
  return { ok: Boolean(version), path: bundled || "", version };
}

export type OpenfilmStatus = {
  phase: OpenfilmPhase;
  cli: { installed: boolean; version: string; path: string };
  node: { path: string; version: string; embedded: boolean };
  browser: { installed: boolean; cacheRoots: string[] };
  ffmpeg: { ok: boolean; path: string; version: string };
  settings: Settings;
  /** 声明（界面直接展示，⛔ 不要在前端另写一份文案） */
  attribution: { home: string; site: string; license: string; trademark: string };
};

export async function openfilmStatus(): Promise<OpenfilmStatus> {
  const node = nodeExe();
  const nodeVersion = await binaryVersion(node.exe, ["-v"]);
  const version = cliVersion();
  const browser = { installed: browserInstalled(), cacheRoots: browserCacheRoots() };
  const ff = await ffmpegState();
  const installing = fs.existsSync(path.join(openfilmRoot(), ".installing"));
  const phase: OpenfilmPhase = installing
    ? "installing"
    : version && browser.installed && ff.ok
      ? "ready"
      : version
        ? "broken"      // 装了但缺浏览器/ffmpeg —— 值得单列，提示里能指名缺哪一步
        : "absent";
  return {
    phase,
    cli: { installed: Boolean(version), version, path: version ? cliEntry() : "" },
    node: { path: node.exe, version: nodeVersion, embedded: Boolean(bundledNode()) },
    browser,
    ffmpeg: ff,
    settings: readSettings(),
    attribution: { home: OPENFILM_HOME, site: OPENFILM_SITE, license: OPENFILM_LICENSE, trademark: OPENFILM_TRADEMARK_NOTE },
  };
}

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
    const doctor = await runNode([cliEntry(), "doctor"], { timeoutMs: 60_000 });
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

/* ── 卸载（⛔ 只删 runtime，绝不碰 film 目录） ─────────────────────────── */

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
  },
});
