/**
 * weknora-ipc（2026-09-28 新增）：内置知识库服务（腾讯 WeKnora Lite）的**按需安装 + 进程管理**。
 *
 * 定位（用户 09-28 定稿）：WeKnora 本体**不随安装包分发**（Go 依赖缓存实测 836MB，二进制 + 前端
 * 也有几十 MB），改为「设置 → 知识库」里点安装时按需下载；应用侧只留好接口面
 * （状态 / 安装 / 启停 / 地址），下载源是我们公开库 Release 的预构建 zip（weknora tag）。
 *
 * WeKnora Lite 是什么：单二进制 Go 服务（SQLite + 内存队列，零外部依赖）+ 磁盘 web/ 前端。
 * 运行时只绑 127.0.0.1，数据（SQLite 库 + 上传文件）全部落在 userData/weknora/ 下。
 *
 * 生命周期：
 *   · install = 探测下载源（404 ⇒ 明确报「安装包尚未发布」）→ 顺序尝试镜像下载 → 7z 解压 → 校验；
 *   · start   = spawn 二进制（env 定死 SERVER_HOST/SERVER_PORT/DB_PATH/存储目录），健康检查
 *     GET /health 轮询到 <500 才算 running；
 *   · stop    = taskkill /T /F（杀进程树）；
 *   · 应用退出（will-quit）时若还开着 ⇒ 一并杀掉，不留孤儿进程。
 *
 * ⛔ Go 侧配置读取依赖 config.yaml（ReadInConfig 失败直接退出）⇒ 解压产物里必须带 config/ 目录
 *    （构建脚本打进 zip）；spawn 的 cwd = 安装目录。
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { ipcMain, app } from "electron";
import { toolsRoot } from "../toolchain";
import { sendToWindow } from "./window-bus";

/** 下载源：公开库 Release（tag = weknora-v<版本>，资产名见 buildWeknoraAssetUrl）。 */
const WEKNORA_VERSION = "0.8.2";
const WEKNORA_RELEASE_REPO = "PMZPZM0/codex-harness-desktop";
/** 与 voice/model-store.ts 的 GITHUB_MIRROR_PREFIXES 同值：直连失败按序换镜像。 */
const GITHUB_MIRROR_PREFIXES = ["https://ghfast.top/", "https://gh-proxy.com/"];

type WeknoraState = {
  installed: boolean;
  version: string;
  running: boolean;
  port: number | null;
  pid: number | null;
  installing: boolean;
  progress: { phase: string; percent: number } | null;
  error: string | null;
};

let proc: ChildProcess | null = null;
let currentPort: number | null = null;
let starting = false;
let installing = false;
let lastProgress: { phase: string; percent: number } | null = null;
/** 粘性错误（见 state() 注释）：跨 refresh 保留，直到下一次操作开始 */
let lastError: string | null = null;

function appDir(): string {
  return path.join(app.getPath("userData"), "weknora", "app");
}

function binaryPath(): string {
  return path.join(appDir(), process.platform === "win32" ? "weknora-lite.exe" : "weknora-lite");
}

function dataDir(): string {
  return path.join(app.getPath("userData"), "weknora", "data");
}

function isRunning(): boolean {
  return proc != null && proc.pid != null && proc.exitCode == null;
}

function state(error: string | null = null): WeknoraState {
  const installed = fs.existsSync(binaryPath());
  // ⛔ 粘性错误（09-28 用户现场「点安装转一下就没了」）：渲染层拿到失败结果后会立刻
  //   `refresh()` 再拉一次状态，而状态默认 error=null ⇒ 错误只闪一帧就被覆盖，用户
  //   什么都看不到。这里把错误存住，直到下一次**操作**开始才清（clearError）。
  if (error) lastError = error;
  return {
    installed,
    version: installed ? WEKNORA_VERSION : "",
    running: isRunning(),
    port: isRunning() ? currentPort : null,
    pid: isRunning() ? proc!.pid! : null,
    installing,
    progress: lastProgress,
    error: lastError,
  };
}

/** 清掉上一次的错误（每个操作入口调一次 —— 否则旧错误会一直挂在界面上）。 */
function clearError() {
  lastError = null;
}

function reportProgress(phase: string, percent: number) {
  lastProgress = { phase, percent: Math.max(0, Math.min(100, Math.round(percent))) };
  sendToWindow("weknora:progress", lastProgress);
}

/* ── 下载 ──────────────────────────────────────────────────────────────── */

function buildWeknoraAssetUrl(prefix: string): string {
  const asset = `weknora-lite-v${WEKNORA_VERSION}-windows-x64.zip`;
  const release = `https://github.com/${WEKNORA_RELEASE_REPO}/releases/download/weknora-v${WEKNORA_VERSION}/${asset}`;
  return prefix ? prefix + release : release;
}

/** 404 探测：所有镜像都不存在这个资产 ⇒ 明确告诉用户「还没发布」，而不是下载报错一坨。 */
async function assetExists(url: string, timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    fetch(url, { method: "HEAD", redirect: "follow", signal: ctl.signal })
      .then((res) => { clearTimeout(timer); resolve(res.ok); })
      .catch(() => { clearTimeout(timer); resolve(false); });
  });
}

async function downloadToFile(url: string, destPath: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    const headersTimeoutMs = 12000;
    const timeoutCtl = new AbortController();
    const headersTimer = setTimeout(() => timeoutCtl.abort(), headersTimeoutMs);
    let response: Response;
    try {
      response = await fetch(url, { redirect: "follow", signal: timeoutCtl.signal });
    } catch {
      return { ok: false, error: `连接超时（${headersTimeoutMs / 1000}s 无响应）` };
    } finally {
      clearTimeout(headersTimer);
    }
    if (!response.ok || !response.body) return { ok: false, error: "下载失败 HTTP " + response.status };
    const total = Number(response.headers.get("content-length") ?? 0) || 0;
    const out = createWriteStream(destPath);
    const reader = (response.body as any).getReader();
    let received = 0;
    for (;;) {
      const { done, value } = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("下载中断（45 秒无数据）")), 45000)),
      ]);
      if (done) break;
      const chunk = Buffer.from(value);
      received += chunk.length;
      if (!out.write(chunk)) await new Promise<void>((resolve) => out.once("drain", () => resolve()));
      if (total) reportProgress("下载安装包", (received / total) * 100);
    }
    await new Promise<void>((resolve, reject) => { out.on("finish", resolve); out.on("error", reject); out.end(); });
    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}

function extractZip(zipPath: string, destDir: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const sevenZip = path.join(toolsRoot(), "sevenzip", process.platform === "win32" ? "7z.exe" : "7z");
  if (!fs.existsSync(sevenZip)) return Promise.resolve({ ok: false, error: "缺少内置 7-Zip（开发工具页可安装）" });
  return new Promise((resolve) => {
    const child = spawn(sevenZip, ["x", zipPath, `-o${destDir}`, "-y", "-bso0", "-bsp0"], { windowsHide: true });
    let stderr = "";
    child.stderr?.on("data", (d) => { stderr += String(d); });
    child.on("error", (error) => resolve({ ok: false, error: String(error) }));
    child.on("exit", (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: `解压失败（exit ${code}）${stderr.slice(0, 120)}` }));
  });
}

async function doInstall(): Promise<WeknoraState> {
  clearError();
  if (process.platform !== "win32") return state("当前仅支持 Windows（macOS 构建随后提供）");
  if (fs.existsSync(binaryPath())) return state();
  if (installing) return state();
  installing = true;
  lastProgress = { phase: "准备下载", percent: 0 };
  // ⛔ zip 与暂存目录分开：解压前要清空 staging，zip 若在里面会被自己删掉
  const zipPath = path.join(app.getPath("userData"), "weknora", `weknora-lite-v${WEKNORA_VERSION}-windows-x64.zip`);
  const staging = path.join(app.getPath("userData"), "weknora", "staging");
  try {
    // ① 探测下载源：**国内镜像优先**，直连兜底；收集**全部**可用源（不 break）
    //    ⛔ 09-28 修正两处（用户点安装"转一下就没了"+ 要求国内加速）：
    //      a) 旧实现撞到第一个可用源就 `break` ⇒ 候选恒为 1 个，注释里写的「直连 → 镜像
    //         逐个退避」根本没发生；国内直连 GitHub Release 慢/断流时没有任何退路。
    //      b) 顺序反了：原来是直连优先 —— 对国内用户来说直连最慢。改成镜像优先。
    //    探测（HEAD）成功 ≠ 下载快，所以探测只用来筛「存在的源」，真正选择交给下载退避。
    reportProgress("探测下载源", 0);
    const candidates: string[] = [];
    for (const prefix of [...GITHUB_MIRROR_PREFIXES, ""]) {
      const url = buildWeknoraAssetUrl(prefix);
      if (await assetExists(url)) candidates.push(url);
    }
    if (!candidates.length) {
      return state(`安装包尚未发布：公开库 Release 需有 weknora-v${WEKNORA_VERSION} tag 及对应资产`);
    }
    // ② 下载（镜像优先 → 直连兜底，逐个退避）
    reportProgress("下载安装包", 0);
    let downloaded: { ok: true } | { ok: false; error: string } = { ok: false, error: "未尝试" };
    const failures: string[] = [];
    for (const url of candidates) {
      downloaded = await downloadToFile(url, zipPath);
      if (downloaded.ok) break;
      // 记下每个源失败的原因：只报最后一个会让用户以为"没试镜像"
      failures.push(`${new URL(url).host}：${downloaded.error}`);
    }
    if (!downloaded.ok) {
      return state(`下载失败（已依次尝试 ${candidates.length} 个下载源）—— ${failures.join("；")}。可稍后重试，或检查网络/代理。`);
    }
    // ③ 解压到暂存 → 校验 → 原子落位
    reportProgress("解压", 90);
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    const extracted = await extractZip(zipPath, staging);
    if (!extracted.ok) return state(extracted.error);
    const exe = fs.existsSync(path.join(staging, "weknora-lite.exe")) ? staging
      : (fs.readdirSync(staging).find((name) => fs.existsSync(path.join(staging, name, "weknora-lite.exe"))) ?? null);
    if (!exe) return state("安装包内容异常：未找到 weknora-lite.exe（zip 需包含二进制 + web/ + config/）");
    fs.rmSync(appDir(), { recursive: true, force: true });
    fs.mkdirSync(path.dirname(appDir()), { recursive: true });
    fs.renameSync(exe === staging ? staging : path.join(staging, exe), appDir());
    reportProgress("完成", 100);
    return state();
  } catch (error: any) {
    return state(String(error?.message ?? error));
  } finally {
    installing = false;
    setTimeout(() => { lastProgress = null; sendToWindow("weknora:progress", null); }, 4000);
    try { fs.rmSync(zipPath, { force: true }); } catch { /* 临时包清不掉就留给下次覆盖 */ }
  }
}

function doUninstall(): WeknoraState {
  clearError();
  doStop();
  fs.rmSync(appDir(), { recursive: true, force: true });
  return state();
}

/* ── 启动 / 停止 ───────────────────────────────────────────────────────── */

function killTree(pid: number) {
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch { /* 已退出 */ } }
  }
}

async function healthCheck(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const req = http.get({ host: "127.0.0.1", port, path: "/health", timeout: 1500 }, (res) => {
        res.resume();
        resolve((res.statusCode ?? 500) < 500);
      });
      req.on("error", () => resolve(false));
      req.on("timeout", () => { req.destroy(); resolve(false); });
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = http.get({ host: "127.0.0.1", port, path: "/", timeout: 800 }, (res) => { res.resume(); resolve(false); });
    probe.on("error", () => resolve(true));   // 连不上 = 空闲
    probe.on("timeout", () => { probe.destroy(); resolve(false); });
  });
}

async function pickPort(): Promise<number> {
  const base = 17653;
  for (let i = 0; i < 10; i++) {
    const port = base + i;
    if (await portFree(port)) return port;
  }
  return base; // 全占满就让 WeKnora 自己的 listenWithRetry 去处理
}

async function doStart(): Promise<WeknoraState> {
  clearError();
  if (isRunning()) return state();
  if (starting) return { ...state(), error: "正在启动中" };
  const bin = binaryPath();
  if (!fs.existsSync(bin)) return { ...state(), error: "尚未安装知识库服务" };
  if (!fs.existsSync(path.join(appDir(), "config", "config.yaml"))) {
    return { ...state(), error: "安装不完整：缺少 config/config.yaml（WeKnora 启动硬依赖）" };
  }
  starting = true;
  try {
    const port = await pickPort();
    const data = dataDir();
    fs.mkdirSync(path.join(data, "files"), { recursive: true });
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      EDITION: "lite",
      GIN_MODE: "release",
      LOG_LEVEL: "info",
      // ⛔ viper AutomaticEnv + EnvKeyReplacer(".","_") ⇒ cfg.Server.Port ← SERVER_PORT
      SERVER_HOST: "127.0.0.1",
      SERVER_PORT: String(port),
      DB_DRIVER: "sqlite",
      DB_PATH: path.join(data, "weknora.db"),
      RETRIEVE_DRIVER: "sqlite",
      STORAGE_TYPE: "local",
      LOCAL_STORAGE_BASE_DIR: path.join(data, "files"),
      STREAM_MANAGER_TYPE: "memory",
      NEO4J_ENABLE: "false",
      WEKNORA_SANDBOX_MODE: "disabled",
      ENABLE_GRAPH_RAG: "false",
      WEKNORA_WEB_DIR: path.join(appDir(), "web"),
    };
    proc = spawn(bin, [], { cwd: appDir(), env, stdio: "ignore", windowsHide: true });
    currentPort = port;
    proc.on("exit", () => { proc = null; currentPort = null; });
    const healthy = await healthCheck(port, 30_000);
    if (!healthy) {
      const exited = proc.exitCode != null || proc.signalCode != null;
      killTree(proc.pid!);
      proc = null; currentPort = null;
      return { ...state(), error: exited ? "服务进程启动后立即退出（可尝试卸载后重装）" : "健康检查超时（30s）" };
    }
    return state();
  } finally {
    starting = false;
  }
}

function doStop(): WeknoraState {
  clearError();
  if (isRunning()) {
    killTree(proc!.pid!);
    proc = null;
    currentPort = null;
  }
  return state();
}

ipcMain.handle("weknora:status", () => state());
ipcMain.handle("weknora:install", () => doInstall());
ipcMain.handle("weknora:uninstall", () => doUninstall());
ipcMain.handle("weknora:start", () => doStart());
ipcMain.handle("weknora:stop", () => doStop());
ipcMain.handle("weknora:address", () => (isRunning() && currentPort ? `http://127.0.0.1:${currentPort}` : null));

/** 应用退出时清掉服务进程（不留孤儿）。main.ts 的 will-quit 链上调用。 */
export function shutdownWeknora() {
  if (isRunning()) killTree(proc!.pid!);
  proc = null;
  currentPort = null;
}
