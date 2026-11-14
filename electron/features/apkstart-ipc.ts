/**
 * apkstart-ipc（11-14）—— ApkStart 安卓运行器的宿主侧执行端
 *
 * 域：apkstart(8)
 * 通道：status / install / launch / screenshot / logcat / adb / open / purge
 *
 * 背景：ApkStart（RoutineMiku/apkstart，MIT）是 Windows 上的安卓应用运行器：双击 APK 安装，
 * 应用以独立窗口运行，adb / emulator / 系统镜像由它自己下载管理（%APPDATA%\apkstart\runtime）。
 * 安装入口在「设置 → 开发工具 → ApkStart 安卓运行器」（GitHub release 直下型，见 runtime-ipc 的
 * installApkStartFromGitHub）。本域把它的 CLI 与 adb 接成 Codex 的 apkstart 工具，用来做安卓应用测试。
 *
 * ⛔ CLI 只有三种形态（上游 README / src/main.js 的 parseArgs）：无参打开主界面、`<apk>` 安装、
 *   `--launch <包名>` 启动。**没有结构化 stdout**（GUI 应用）⇒ 判据一律读它自己的
 *   `apps.json`（应用清单）与 adb，绝不靠解析输出。安装/启动一律 spawn **参数数组**，不进 shell。
 * ⛔ 单实例：已在运行时再 spawn 会把参数交给首实例（second-instance）并立即退出；带 `--silent`
 *   安装/启动不会弹主界面（上游 parseArgs 里 --launch 自带 silent，安装显式补上）。
 * ⛔ adb：优先用 ApkStart 自带的 runtime/platform-tools/adb.exe（版本与它的 emulator 对齐），
 *   运行时还没下载完时回落本应用随包的 platform-tools。adb server 端口可能是 5037 或 ApkStart
 *   动态挑的 5044+ ⇒ devices 为空时按 emulator 控制端口 5555/5557… 主动 `adb connect`。
 * ⛔ 首启要下载约 1GB Android 运行时（dl.google.com，上游用 8 线程分块 + 断点续传）。安装类动作
 *   等不到结果时如实回「尚未确认完成 / 可能正在下载运行时」，⛔ 不许假装成功。
 * ⛔ purge（删 %APPDATA%\apkstart 的运行时与已装应用数据）必须显式 confirm，且 ApkStart 必须已退出。
 */
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { app } from "electron";
import { existingToolPath, toolRootsRead, writeToolsRoot } from "../toolchain";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
// 仓库地址单一真相源 = runtime-ipc 的 APKSTART_REPO（安装与声明区共用；前端不写第二份 URL）
import { APKSTART_REPO } from "./runtime-ipc";

/** ApkStart 安装目录（marker 的单一真相源在 dev-runtimes.apkstart）。 */
function installDir(): string {
  return path.join(writeToolsRoot(), "apkstart");
}

/** ApkStart.exe 路径；未安装返回空串。 */
function exePath(): string {
  for (const root of toolRootsRead()) {
    try {
      const candidate = path.join(root, "apkstart", "ApkStart.exe");
      if (existsSync(candidate)) return candidate;
    } catch { /* 下一个根 */ }
  }
  return "";
}

/** 读盘上已装版本（安装时落的 version.txt）。 */
function installedVersion(): string {
  try { return readFileSync(path.join(installDir(), "version.txt"), "utf8").trim(); } catch { return ""; }
}

/** ApkStart 的数据目录（%APPDATA%\apkstart；它自己的 store.js 是同一路径）。 */
function dataDir(): string {
  return path.join(app.getPath("appData"), "apkstart");
}

type ApkStartSettings = { adbPath?: string; device?: string; runtime?: { dir?: string } };

/** 读 ApkStart 自己的 settings.json（运行时目录 / 自定义 adb 路径；读不到就用默认）。 */
function readSettings(): ApkStartSettings {
  try {
    const raw = JSON.parse(readFileSync(path.join(dataDir(), "settings.json"), "utf8"));
    return raw && typeof raw === "object" ? raw as ApkStartSettings : {};
  } catch { return {}; }
}

/** 运行时根（settings.runtime.dir 为空 = 默认 %APPDATA%\apkstart\runtime）。 */
function runtimeRoot(): string {
  const dir = String(readSettings().runtime?.dir ?? "").trim();
  return dir || path.join(dataDir(), "runtime");
}

/** 运行时是否已备齐（emulator 主程序在 = 首次下载解压完成；系统镜像另外判一层目录）。 */
function runtimeReady(): boolean {
  const root = runtimeRoot();
  try {
    return existsSync(path.join(root, "emulator", "emulator.exe")) && existsSync(path.join(root, "system-images"));
  } catch { return false; }
}

/** adb 可执行文件：ApkStart 自带 → 本应用随包 platform-tools → PATH 里的 adb。 */
function adbBinary(): string {
  const candidates: string[] = [];
  const custom = String(readSettings().adbPath ?? "").trim();
  if (custom) candidates.push(custom);
  candidates.push(path.join(runtimeRoot(), "platform-tools", "adb.exe"));
  candidates.push(path.join(installDir(), "tools", "platform-tools", "adb.exe"));
  const bundled = existingToolPath("platform-tools", "adb.exe");
  if (bundled) candidates.push(bundled);
  for (const candidate of candidates) {
    try { if (candidate && existsSync(candidate)) return candidate; } catch { /* 下一个 */ }
  }
  return "adb";
}

type ApkStartApp = { package?: string; label?: string; versionName?: string; installedAt?: number; lastLaunchAt?: number };

/** 读 ApkStart 的 apps.json（它自己的已装应用清单；文件不存在/损坏都回落空表）。 */
function readApps(): ApkStartApp[] {
  try {
    const raw = JSON.parse(readFileSync(path.join(dataDir(), "apps.json"), "utf8"));
    const apps = Array.isArray(raw?.apps) ? raw.apps : [];
    return apps.filter((row: unknown) => row && typeof (row as ApkStartApp).package === "string" && (row as ApkStartApp).package);
  } catch { return []; }
}

/** ApkStart 主进程是否在跑（Windows 任务列表；非 Windows 恒 false，本工具只支持 Windows）。 */
async function isRunning(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  return new Promise<boolean>((resolve) => {
    let out = "";
    let settled = false;
    const done = (value: boolean) => { if (settled) return; settled = true; resolve(value); };
    try {
      const child = spawn("tasklist", ["/FI", "IMAGENAME eq ApkStart.exe", "/NH"], { windowsHide: true });
      child.stdout?.on("data", (chunk) => { out += String(chunk); });
      child.on("error", () => done(false));
      child.on("close", () => done(/ApkStart\.exe/i.test(out)));
      setTimeout(() => { try { child.kill(); } catch { /* 已退出 */ } done(false); }, 8_000);
    } catch { done(false); }
  });
}

type AdbResult = { ok: boolean; code: number; stdout: string; stderr: string; bytes: Buffer };

/** 跑一次 adb（参数数组，不进 shell）；超时/找不到 adb 都返回结构化失败而不是抛。 */
function runAdb(args: string[], timeoutMs = 60_000): Promise<AdbResult> {
  const binary = adbBinary();
  const env = { ...process.env, ANDROID_ADB_SERVER_PORT: process.env.ANDROID_ADB_SERVER_PORT || "5037" };
  return new Promise<AdbResult>((resolve) => {
    let settled = false;
    const done = (value: AdbResult) => { if (settled) return; settled = true; resolve(value); };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(binary, args, { windowsHide: true, env });
    } catch (error) {
      done({ ok: false, code: -1, stdout: "", stderr: String((error as Error)?.message ?? error), bytes: Buffer.alloc(0) });
      return;
    }
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    const cap = (target: Buffer[]) => (chunk: Buffer) => {
      if (size >= 6 * 1024 * 1024) return;
      target.push(chunk);
      size += chunk.length;
    };
    child.stdout?.on("data", cap(out));
    child.stderr?.on("data", cap(err));
    const timer = setTimeout(() => { try { child.kill(); } catch { /* 已退出 */ } }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      done({ ok: false, code: -1, stdout: "", stderr: String((error as Error)?.message ?? error), bytes: Buffer.alloc(0) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(out);
      done({ ok: (code ?? -1) === 0, code: code ?? -1, stdout: stdout.toString("utf8"), stderr: Buffer.concat(err).toString("utf8"), bytes: stdout });
    });
  });
}

type EmulatorDevice = { serial: string; state: string; model: string; api: string; release: string };

/** 单个 TCP 端口是否可连（用于发现 emulator 的 adb 端口 5555/5557…）。 */
function portOpen(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (value: boolean) => { if (settled) return; settled = true; socket.destroy(); resolve(value); };
    const socket = net.connect({ host, port });
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/** 解析 `adb devices -l` 的行（只看 state=device）。 */
async function adbDevices(): Promise<{ serial: string; state: string }[]> {
  const result = await runAdb(["devices", "-l"], 20_000);
  const rows: { serial: string; state: string }[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^(\S+)\s+(device|offline|unauthorized)\b/);
    if (match) rows.push({ serial: match[1], state: match[2] });
  }
  return rows;
}

let deviceCache: { at: number; device: EmulatorDevice | null } = { at: 0, device: null };

/** 找当前可用的模拟器设备：先 devices，再按 5555/5557… 主动 connect（adb server 端口可能不同）。 */
async function findDevice(): Promise<EmulatorDevice | null> {
  if (Date.now() - deviceCache.at < 5_000) return deviceCache.device;
  let rows = await adbDevices();
  let serial = rows.find((row) => row.state === "device" && /^emulator-/.test(row.serial))?.serial
    ?? rows.find((row) => row.state === "device")?.serial
    ?? "";
  if (!serial) {
    const started = Date.now();
    for (let port = 5555; port <= 5579 && Date.now() - started < 12_000; port += 2) {
      if (!(await portOpen("127.0.0.1", port, 200))) continue;
      await runAdb(["connect", `127.0.0.1:${port}`], 15_000);
    }
    rows = await adbDevices();
    serial = rows.find((row) => row.state === "device" && /^emulator-/.test(row.serial))?.serial
      ?? rows.find((row) => row.state === "device")?.serial
      ?? "";
  }
  if (!serial) { deviceCache = { at: Date.now(), device: null }; return null; }
  const [model, api, release] = await Promise.all([
    runAdb(["-s", serial, "shell", "getprop", "ro.product.model"], 12_000),
    runAdb(["-s", serial, "shell", "getprop", "ro.build.version.sdk"], 12_000),
    runAdb(["-s", serial, "shell", "getprop", "ro.build.version.release"], 12_000),
  ]);
  const device: EmulatorDevice = {
    serial,
    state: "device",
    model: model.stdout.trim(),
    api: api.stdout.trim(),
    release: release.stdout.trim(),
  };
  deviceCache = { at: Date.now(), device };
  return device;
}

type ApkStartStatus = {
  installed: boolean;
  exePath: string;
  version: string;
  running: boolean;
  runtimeReady: boolean;
  runtimeRoot: string;
  adbPath: string;
  device: EmulatorDevice | null;
  apps: ApkStartApp[];
  dataDir: string;
  attribution: { license: string; home: string };
};

let statusCache: { at: number; value: ApkStartStatus } | null = null;

/** 汇总状态（3 秒缓存：卡片会轮询，adb 探测一次要百毫秒级）。 */
async function statusOf(): Promise<ApkStartStatus> {
  if (statusCache && Date.now() - statusCache.at < 3_000) return statusCache.value;
  const exe = exePath();
  const [running, device] = await Promise.all([isRunning(), exe ? findDevice() : Promise.resolve(null)]);
  const value: ApkStartStatus = {
    installed: Boolean(exe),
    exePath: exe,
    version: installedVersion(),
    running,
    runtimeReady: runtimeReady(),
    runtimeRoot: runtimeRoot(),
    adbPath: adbBinary() === "adb" ? "" : adbBinary(),
    device,
    apps: readApps(),
    dataDir: dataDir(),
    attribution: { license: "MIT", home: `https://github.com/${APKSTART_REPO}` },
  };
  statusCache = { at: Date.now(), value };
  return value;
}

/** 启动 ApkStart（参数数组；detached 让宿主退出后它继续跑）。 */
function spawnApp(args: string[]): { ok: boolean; error: string } {
  const exe = exePath();
  if (!exe) return { ok: false, error: "ApkStart 还没安装：请到「设置 → 开发工具 → ApkStart 安卓运行器」点安装。" };
  try {
    const child = spawn(exe, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      // 首实例会按这个端口起 adb server，让宿主的 adb 与它共用同一台设备（见文件头）。
      env: { ...process.env, ANDROID_ADB_SERVER_PORT: process.env.ANDROID_ADB_SERVER_PORT || "5037" },
    });
    child.unref();
    return { ok: true, error: "" };
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message ?? error) };
  }
}

const APK_EXT = /\.(apk|xapk|apks)$/i;

type InstallInput = { apk?: string; launch?: boolean; waitMs?: number };
type InstallResult = { ok: boolean; pending: boolean; packageName: string; label: string; error: string; detail: string };

/** 安装 APK 并（可选）启动：装完的判据 = ApkStart 自己的 apps.json 出现新条目 / 文件被改写。 */
async function install(input: InstallInput): Promise<InstallResult> {
  const base: InstallResult = { ok: false, pending: false, packageName: "", label: "", error: "", detail: "" };
  if (process.platform !== "win32") return { ...base, error: "ApkStart 仅支持 Windows 10/11 x64。" };
  if (!exePath()) return { ...base, error: "ApkStart 还没安装：请到「设置 → 开发工具 → ApkStart 安卓运行器」点安装。" };
  const apk = String(input.apk ?? "").trim();
  if (!apk) return { ...base, error: "缺少 apk 路径（要安装的 .apk 文件）" };
  if (!APK_EXT.test(apk)) return { ...base, error: `不是 APK 文件：${apk}` };
  if (!existsSync(apk)) return { ...base, error: `APK 文件不存在：${apk}` };

  const appsFile = path.join(dataDir(), "apps.json");
  const before = new Set(readApps().map((row) => String(row.package)));
  const beforeSize = (() => { try { return statSync(appsFile).size; } catch { return -1; } })();
  const beforeMtime = (() => { try { return statSync(appsFile).mtimeMs; } catch { return 0; } })();

  const started = spawnApp(["--silent", apk]);
  if (!started.ok) return { ...base, error: started.error };

  const waitMs = Math.max(10_000, Math.min(600_000, Number(input.waitMs) || 120_000));
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const apps = readApps();
    const fresh = apps.find((row) => row.package && !before.has(String(row.package)));
    if (fresh?.package) {
      let launched = false;
      if (input.launch) {
        const launchResult = spawnApp(["--launch", String(fresh.package)]);
        launched = launchResult.ok;
        if (!launched) {
          return { ok: true, pending: false, packageName: String(fresh.package), label: String(fresh.label ?? ""), error: "", detail: `已安装 ${fresh.label ?? fresh.package}，但启动失败：${launchResult.error}` };
        }
      }
      return {
        ok: true,
        pending: false,
        packageName: String(fresh.package),
        label: String(fresh.label ?? ""),
        error: "",
        detail: `已安装 ${fresh.label ?? fresh.package}（${fresh.package}）${launched ? "并已启动" : ""}${fresh.versionName ? `，版本 ${fresh.versionName}` : ""}。`,
      };
    }
    /* 同名重装（覆盖安装）不会新增清单条目，只能看 apps.json 是否被改写；此时**不猜**包名
       （猜错会让 launch 打开别的应用）—— 让模型先 status 看清单再启动。 */
    let changed = false;
    try {
      const stat = statSync(appsFile);
      changed = stat.size !== beforeSize || stat.mtimeMs !== beforeMtime;
    } catch { /* 还没写 */ }
    if (changed) {
      return { ok: true, pending: false, packageName: "", label: "", error: "", detail: "已重装并更新了 ApkStart 应用清单；同名覆盖安装无法自动确定包名，先用 status 看清单再 launch。" };
    }
  }
  const hint = runtimeReady()
    ? "还没等到安装完成（APK 可能很大，或安装失败弹窗需要处理）。用 status 看应用清单，或打开 ApkStart 主界面查看进度。"
    : "ApkStart 首次启动要先下载约 1GB 的 Android 运行时（dl.google.com，分块下载），这一步会很久；宿主没有假装装好。稍后用 status 看 runtimeReady，好了再重试安装。";
  return { ...base, pending: true, error: hint };
}

type LaunchInput = { package?: string };
type LaunchResult = { ok: boolean; error: string; detail: string };

/** 按包名启动已装应用（ApkStart 的 --launch；没装时回可执行指引）。 */
async function launch(input: LaunchInput): Promise<LaunchResult> {
  const pkg = String(input.package ?? "").trim();
  if (!pkg) return { ok: false, error: "缺少 package（Android 包名，如 com.example.app）", detail: "" };
  if (!/^[A-Za-z][\w]*(\.[\w]+)+$/.test(pkg)) return { ok: false, error: `包名格式不对：${pkg}`, detail: "" };
  if (!exePath()) return { ok: false, error: "ApkStart 还没安装：请到「设置 → 开发工具 → ApkStart 安卓运行器」点安装。", detail: "" };
  const known = readApps().some((row) => String(row.package) === pkg);
  if (!known) return { ok: false, error: `ApkStart 的应用清单里没有 ${pkg} —— 先 install 一个 APK，或确认包名拼写。`, detail: "" };
  const result = spawnApp(["--launch", pkg]);
  return result.ok
    ? { ok: true, error: "", detail: `已请求 ApkStart 启动 ${pkg}；模拟器首次启动应用可能要十几秒。` }
    : { ok: false, error: result.error, detail: "" };
}

type ScreenshotInput = { path?: string };
type ScreenshotResult = { ok: boolean; path: string; bytes: number; error: string; detail: string };

/** 截一张设备画面（adb exec-out screencap -p）落到 userData；返回本地 PNG 路径。 */
async function screenshot(input: ScreenshotInput): Promise<ScreenshotResult> {
  const base: ScreenshotResult = { ok: false, path: "", bytes: 0, error: "", detail: "" };
  const device = await findDevice();
  if (!device) {
    return { ...base, error: runtimeReady() ? "模拟器还没启动：先在 ApkStart 里打开一个应用，或稍后再试。" : "Android 运行时还没准备好（ApkStart 首启要下载约 1GB）。" };
  }
  const result = await runAdb(["-s", device.serial, "exec-out", "screencap", "-p"], 30_000);
  if (!result.ok || result.bytes.length < 64) {
    return { ...base, error: `截屏失败：${(result.stderr || result.stdout || `退出码 ${result.code}`).trim().slice(0, 300)}` };
  }
  const requested = String(input.path ?? "").trim();
  const target = requested || path.join(app.getPath("userData"), "apkstart", "screenshots", `shot-${Date.now()}.png`);
  try {
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, result.bytes);
  } catch (error) {
    return { ...base, error: `截屏成功但写文件失败：${String((error as Error)?.message ?? error)}` };
  }
  return { ok: true, path: target, bytes: result.bytes.length, error: "", detail: `已截图（${device.serial}，${device.model || "Android"}）。` };
}

type LogcatInput = { lines?: number; filter?: string; packageName?: string };
type LogcatResult = { ok: boolean; text: string; error: string };

/** 读最近 logcat（默认 300 行；可按关键字过滤；带包名时会标出崩溃栈相关行）。 */
async function logcat(input: LogcatInput): Promise<LogcatResult> {
  const device = await findDevice();
  if (!device) return { ok: false, text: "", error: runtimeReady() ? "模拟器还没启动：先在 ApkStart 里打开一个应用。" : "Android 运行时还没准备好（首启下载约 1GB）。" };
  const lines = Math.max(20, Math.min(5_000, Number(input.lines) || 300));
  const result = await runAdb(["-s", device.serial, "logcat", "-d", "-t", String(lines)], 40_000);
  if (!result.ok) return { ok: false, text: "", error: `读取 logcat 失败：${(result.stderr || `退出码 ${result.code}`).trim().slice(0, 300)}` };
  const filter = String(input.filter ?? "").trim();
  const pkg = String(input.packageName ?? "").trim();
  let rows = result.stdout.split(/\r?\n/).filter(Boolean);
  if (filter) rows = rows.filter((line) => line.toLowerCase().includes(filter.toLowerCase()));
  if (pkg) rows = rows.filter((line) => line.includes(pkg) || /FATAL EXCEPTION|AndroidRuntime|ANR in/.test(line));
  const text = rows.join("\n").slice(-120_000);
  return { ok: true, text: text || "（没有匹配的日志行）", error: "" };
}

type AdbInput = { args?: string[]; timeoutMs?: number };
type AdbRawResult = { ok: boolean; code: number; stdout: string; stderr: string; error: string };

/** 透传一条 adb 命令（测试常用：shell input / pm grant / am start / dumpsys）。 */
async function adbRaw(input: AdbInput): Promise<AdbRawResult> {
  const args = (Array.isArray(input.args) ? input.args : []).map((arg) => String(arg ?? "")).filter((arg) => arg.length > 0);
  if (!args.length) return { ok: false, code: 2, stdout: "", stderr: "", error: "缺少 args（adb 参数数组，例如 [\"shell\", \"input\", \"tap\", \"540\", \"960\"]）" };
  const device = await findDevice();
  const hasSerial = args.includes("-s");
  const timeoutMs = Math.max(5_000, Math.min(300_000, Number(input.timeoutMs) || 60_000));
  const full = device && !hasSerial ? ["-s", device.serial, ...args] : args;
  const result = await runAdb(full, timeoutMs);
  return { ok: result.ok, code: result.code, stdout: result.stdout.slice(0, 120_000), stderr: result.stderr.slice(0, 20_000), error: "" };
}

/** 打开 ApkStart 主界面（用户手动操作 / 看安装进度用）。 */
async function openApp(): Promise<{ ok: boolean; error: string }> {
  const result = spawnApp([]);
  if (!result.ok) return result;
  return { ok: true, error: "" };
}

/** 删除 ApkStart 的运行时与已装应用数据（%APPDATA%\apkstart）—— 只在应用已退出且显式 confirm 时执行。 */
async function purgeData(confirm: boolean): Promise<{ ok: boolean; error: string }> {
  if (confirm !== true) return { ok: false, error: "这是破坏性操作：必须显式传 confirm: true" };
  if (await isRunning()) return { ok: false, error: "ApkStart 还在运行：请先退出它（托盘 → 退出）再删除数据" };
  const { rm } = await import("node:fs/promises");
  try {
    await rm(dataDir(), { recursive: true, force: true });
    statusCache = null;
    return { ok: true, error: "" };
  } catch (error) {
    return { ok: false, error: `删除失败：${String((error as Error)?.message ?? error)}` };
  }
}

const APKSTART_CHANNELS = ["apkstart:status", "apkstart:install", "apkstart:launch", "apkstart:screenshot", "apkstart:logcat", "apkstart:adb", "apkstart:open", "apkstart:purge"];

export const apkStartFeature = defineFeature<null>({
  id: "apkstart",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("apkstart: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("apkstart:status", async () => statusOf());
    ipcHost.handle("apkstart:install", async (_e, input: InstallInput) => install(input ?? {}));
    ipcHost.handle("apkstart:launch", async (_e, input: LaunchInput) => launch(input ?? {}));
    ipcHost.handle("apkstart:screenshot", async (_e, input: ScreenshotInput) => screenshot(input ?? {}));
    ipcHost.handle("apkstart:logcat", async (_e, input: LogcatInput) => logcat(input ?? {}));
    ipcHost.handle("apkstart:adb", async (_e, input: AdbInput) => adbRaw(input ?? {}));
    ipcHost.handle("apkstart:open", async () => openApp());
    ipcHost.handle("apkstart:purge", async (_e, confirm: boolean) => purgeData(confirm === true));

    ctx.effect(() => {
      for (const ch of APKSTART_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
