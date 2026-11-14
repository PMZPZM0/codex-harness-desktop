/**
 * openmaic-ipc（11-14）—— OpenMAIC 互动课堂的宿主侧执行端
 *
 * 域：openmaic(7)
 * 通道：status / start / stop / open / generate / job / purge
 *
 * 背景：OpenMAIC（THU-MAIC/OpenMAIC，MIT）是「多智能体互动课堂」——给主题或资料生成带 AI 老师/同学、
 * 幻灯片、测验、互动模拟与 PBL 的完整课堂。它是 Next.js + PostgreSQL 服务，没有预编译包 ⇒
 * 安装在「设置 → 开发工具 → OpenMAIC 互动课堂」按需下载源码并本机构建（见 runtime-ipc 的
 * installOpenMaicFromGitHub）。本域负责起停本地服务，并把它的生成 API 接成 Codex 的 openmaic 工具。
 *
 * ⛔ 只监听 127.0.0.1：这是单用户本机安装（OWNER_SINGLE_USER=true），课程库只有本机能访问。
 * ⛔ 模型 Key 由用户在 OpenMAIC 网页设置里自己填（加密存本地库），宿主**不读不写不转发** Key；
 *   本域只把服务端的「缺模型」拒绝翻译成可执行的中文指引。
 * ⛔ 生成是异步任务：POST 拿到 jobId 就返回，轮询走 job 通道；⛔ 不在工具里循环等几十分钟。
 */
import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { app, shell } from "electron";
import { bundledNode } from "../toolchain";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
// 路径 / 配置 / 环境单一真相源 = openmaic-install（安装与运行共用同一份）
import { OPENMAIC_REPO, openMaicPaths, openMaicProcessEnv, readOpenMaicConfig, saveOpenMaicConfig, waitLocalPort } from "../openmaic-install";

let serverProc: ChildProcess | null = null;
let serverLog = "";
let cookieJar: Record<string, string> = {};

/** 端口空闲探测（Web 端口被别的程序占了就顺延，写回 config）。 */
async function pickFreePort(start: number): Promise<number> {
  for (let port = start; port < start + 20; port++) {
    const free = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => server.close(() => resolve(true)));
      server.listen(port, "127.0.0.1");
    });
    if (free) return port;
  }
  throw new Error(`从 ${start} 起找不到空闲端口（关掉占用端口的程序再试）`);
}

/** 读已装版本（安装时落的 version.txt）。 */
function installedVersion(): string {
  try { return readFileSync(openMaicPaths().versionFile, "utf8").trim(); } catch { return ""; }
}

/** 是否装好：以 .next/BUILD_ID 为准（源码目录在但没构建 = 不能用）。 */
function isInstalled(): boolean {
  return existsSync(path.join(openMaicPaths().app, ".next", "BUILD_ID"));
}

/** 跑一次 pg_ctl（status/start/stop）；返回退出码与尾部输出。 */
function runPg(args: string[], timeoutMs = 60_000): Promise<{ code: number; out: string }> {
  const { pgBin } = openMaicPaths();
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    const done = (code: number) => { if (!settled) { settled = true; resolve({ code, out: out.trim() }); } };
    try {
      const child = spawn(path.join(pgBin, "pg_ctl.exe"), args, { windowsHide: true });
      child.stdout?.on("data", (c) => { out = `${out}${String(c)}`.slice(-3000); });
      child.stderr?.on("data", (c) => { out = `${out}${String(c)}`.slice(-3000); });
      child.on("error", (error) => { out += String((error as Error)?.message ?? error); done(-1); });
      child.on("close", (code) => done(code ?? -1));
      setTimeout(() => { try { child.kill(); } catch { /* 已退出 */ } done(-1); }, timeoutMs);
    } catch (error) {
      out = String((error as Error)?.message ?? error);
      done(-1);
    }
  });
}

/** 取 health（2 秒超时；服务没起不阻塞界面）。 */
async function healthAt(port: number): Promise<{ ok: boolean; body: any; error: string }> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
    const body = await res.json().catch(() => null);
    return { ok: res.ok && Boolean(body?.success), body, error: res.ok ? "" : `HTTP ${res.status}` };
  } catch (error) {
    return { ok: false, body: null, error: String((error as Error)?.message ?? error) };
  }
}

/** 起 PostgreSQL（没起才起；端口冲突就顺延并写回配置）。 */
async function ensurePg(): Promise<{ ok: boolean; error: string }> {
  const paths = openMaicPaths();
  const pgData = path.join(paths.data, "pg");
  if (!existsSync(path.join(pgData, "PG_VERSION"))) return { ok: false, error: "PostgreSQL 数据目录不存在：请重装 OpenMAIC" };
  const status = await runPg(["-D", pgData, "status"], 20_000);
  if (status.code === 0) return { ok: true, error: "" };
  const cfg = readOpenMaicConfig();
  const port = await pickFreePort(cfg.pgPort).catch(() => cfg.pgPort);
  if (port !== cfg.pgPort) { cfg.pgPort = port; saveOpenMaicConfig(cfg); }
  const started = await runPg(["-D", pgData, "-o", `-p ${port} -c listen_addresses=127.0.0.1`, "-l", path.join(paths.data, "pg.log"), "start"]);
  // ⛔ pg_ctl start 在 Windows 控制台下偶尔输出 "server started" 却回非零（控制台句柄问题）——
  //    判据以端口能否连上为准，不看退出码。
  if (!(await waitLocalPort(port, 30_000))) return { ok: false, error: `PostgreSQL 启动失败：${started.out.slice(-600)}` };
  return { ok: true, error: "" };
}

/** 起本地 Web 服务（已就绪则直接返回；失败把输出尾部带回去）。 */
async function startServer(): Promise<{ ok: boolean; port: number; url: string; error: string }> {
  const paths = openMaicPaths();
  const cfg = readOpenMaicConfig();
  if (!isInstalled()) return { ok: false, port: cfg.port, url: "", error: "OpenMAIC 还没安装：请到「设置 → 开发工具 → OpenMAIC 互动课堂」点安装（约 1.3GB 下载，构建 5–10 分钟）。" };
  if ((await healthAt(cfg.port)).ok) return { ok: true, port: cfg.port, url: `http://127.0.0.1:${cfg.port}`, error: "" };
  const node = bundledNode();
  const nextBin = path.join(paths.app, "node_modules", "next", "dist", "bin", "next");
  if (!node) return { ok: false, port: cfg.port, url: "", error: "缺少随包 Node（先修复「Node.js」内置组件）" };
  if (!existsSync(nextBin)) return { ok: false, port: cfg.port, url: "", error: "OpenMAIC 安装不完整（缺 next）：请重装" };
  const pg = await ensurePg();
  if (!pg.ok) return { ok: false, port: cfg.port, url: "", error: pg.error };
  const port = await pickFreePort(cfg.port).catch(() => cfg.port);
  if (port !== cfg.port) { cfg.port = port; saveOpenMaicConfig(cfg); }
  try {
    const child = spawn(node, [nextBin, "start", "-p", String(port)], {
      cwd: paths.app,
      env: openMaicProcessEnv(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    serverProc = child;
    serverLog = "";
    const grab = (chunk: unknown) => { serverLog = `${serverLog}${String(chunk)}`.slice(-8000); };
    child.stdout?.on("data", grab);
    child.stderr?.on("data", grab);
    child.on("exit", () => { if (serverProc === child) serverProc = null; });
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      if ((await healthAt(port)).ok) return { ok: true, port, url: `http://127.0.0.1:${port}`, error: "" };
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    try { child.kill(); } catch { /* 已退出 */ }
    return { ok: false, port, url: "", error: `OpenMAIC 90 秒内没就绪：${serverLog.slice(-1200) || "无输出"}` };
  } catch (error) {
    return { ok: false, port, url: "", error: String((error as Error)?.message ?? error) };
  }
}

/** 杀掉监听某端口的进程（宿主重启过、serverProc 丢了时的兜底）。 */
async function killPort(port: number): Promise<void> {
  if (process.platform !== "win32") return;
  await new Promise<void>((resolve) => {
    let out = "";
    const child = spawn("netstat", ["-ano"], { windowsHide: true });
    child.stdout?.on("data", (c) => { out += String(c); });
    child.on("close", () => {
      const line = out.split(/\r?\n/).find((row) => row.includes(`:${port}`) && /LISTENING/i.test(row));
      const pid = line?.trim().split(/\s+/).pop() || "";
      if (!/^\d+$/.test(pid)) { resolve(); return; }
      const killer = spawn("taskkill", ["/PID", pid, "/T", "/F"], { windowsHide: true });
      killer.on("close", () => resolve());
      killer.on("error", () => resolve());
    });
    child.on("error", () => resolve());
    setTimeout(resolve, 8000);
  });
}

/** 停服务与 PostgreSQL（都停不掉也不算错，状态里会如实显示）。 */
async function stopServer(): Promise<{ ok: boolean; error: string }> {
  const cfg = readOpenMaicConfig();
  if (serverProc) {
    try { serverProc.kill(); } catch { /* 已退出 */ }
    serverProc = null;
  }
  await killPort(cfg.port);
  const pgData = path.join(openMaicPaths().data, "pg");
  await runPg(["-D", pgData, "stop", "-m", "fast"], 60_000);
  return { ok: true, error: "" };
}

type OpenMaicStatus = {
  installed: boolean;
  version: string;
  appDir: string;
  dataDir: string;
  port: number;
  url: string;
  running: boolean;
  healthy: boolean;
  pgRunning: boolean;
  capabilities: { webSearch?: boolean; imageGeneration?: boolean; videoGeneration?: boolean; tts?: boolean } | null;
  healthError: string;
  attribution: { license: string; home: string };
};

/** 汇总状态（装没装 / 服务与库起没起 / 能力面）。 */
async function statusOf(): Promise<OpenMaicStatus> {
  const paths = openMaicPaths();
  const cfg = readOpenMaicConfig();
  const installed = isInstalled();
  const health = installed ? await healthAt(cfg.port) : { ok: false, body: null, error: "未安装" };
  const pgData = path.join(paths.data, "pg");
  const pg = installed ? await runPg(["-D", pgData, "status"], 15_000) : { code: -1, out: "" };
  const body = health.body as { capabilities?: OpenMaicStatus["capabilities"] } | null;
  return {
    installed,
    version: installedVersion(),
    appDir: paths.app,
    dataDir: paths.data,
    port: cfg.port,
    url: `http://127.0.0.1:${cfg.port}`,
    running: Boolean(serverProc) || health.ok,
    healthy: health.ok,
    pgRunning: pg.code === 0,
    capabilities: body?.capabilities ?? null,
    healthError: health.ok ? "" : health.error,
    attribution: { license: "MIT", home: `https://github.com/${OPENMAIC_REPO}` },
  };
}

/** 带 cookie 的本机 API 请求（OWNER_SINGLE_USER 下 owner 固定，cookie 只为上传/轮询一致）。 */
async function api(pathname: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<{ status: number; body: any; error: string }> {
  const cfg = readOpenMaicConfig();
  const cookie = Object.entries(cookieJar).map(([key, value]) => `${key}=${value}`).join("; ");
  try {
    const res = await fetch(`http://127.0.0.1:${cfg.port}${pathname}`, {
      ...init,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(init.headers || {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const setCookies = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    for (const line of setCookies) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) cookieJar = { ...cookieJar, [pair.slice(0, eq).trim()]: pair.slice(eq + 1).trim() };
    }
    const body = await res.json().catch(() => null);
    return { status: res.status, body, error: "" };
  } catch (error) {
    return { status: 0, body: null, error: String((error as Error)?.message ?? error) };
  }
}

/** 生成请求被服务端拒绝时，把错误码翻成用户能立刻执行的中文。 */
function explainGenerateError(status: number, body: any): string {
  const code = String(body?.errorCode ?? "");
  const raw = String(body?.error ?? "");
  const url = `http://127.0.0.1:${readOpenMaicConfig().port}`;
  if (code === "MISSING_MODEL" || code === "MISSING_API_KEY" || code === "MISSING_PROVIDER") {
    return `OpenMAIC 还没配模型（${raw || code}）。请打开 ${url} → 设置 → 模型，填一个可用的 API Key（这步必须用户自己填，⛔ 不要把 Key 发到对话里），保存后再生成。`;
  }
  if (code === "ACTIVE_RUN_LIMIT") return "OpenMAIC 已有生成任务在跑（并发上限），等它完成后再试。";
  if (status === 0) return `连不上 OpenMAIC 本地服务：${raw || "服务未启动"}`;
  return raw || `生成请求失败（HTTP ${status}${code ? ` / ${code}` : ""}）`;
}

type GenerateInput = { requirement?: string; materialIds?: string[] };
type GenerateResult = { ok: boolean; jobId: string; status: string; url: string; error: string; detail: string };

/** 提交一个课堂生成任务（异步；不做轮询，轮询走 job）。 */
async function generate(input: GenerateInput): Promise<GenerateResult> {
  const base: GenerateResult = { ok: false, jobId: "", status: "", url: "", error: "", detail: "" };
  const requirement = String(input.requirement ?? "").trim();
  if (!requirement) return { ...base, error: "缺少 requirement（要讲什么，一句话即可）" };
  if (requirement.length > 20_000) return { ...base, error: "requirement 太长（上限 20000 字），先提炼一下" };
  const materialIds = (Array.isArray(input.materialIds) ? input.materialIds : []).map((v) => String(v ?? "")).filter(Boolean).slice(0, 5);
  const started = await startServer();
  if (!started.ok) return { ...base, error: started.error };
  const res = await api("/api/generate-classroom", { method: "POST", body: JSON.stringify({ requirement, ...(materialIds.length ? { materialIds } : {}) }) }, 60_000);
  if (!res.body?.success) return { ...base, error: explainGenerateError(res.status, res.body) };
  return {
    ok: true,
    jobId: String(res.body.jobId ?? res.body.runId ?? ""),
    status: String(res.body.status ?? "queued"),
    url: started.url,
    error: "",
    detail: `已提交（job ${res.body.jobId ?? "?"}）。生成要几分钟：稍后用 job 动作查进度，成功后返回课堂链接。`,
  };
}

type JobResult = { ok: boolean; status: string; progress: number; scenesGenerated: number; totalScenes: number; classroomUrl: string; message: string; error: string; done: boolean };

/** 查询生成任务：状态 / 进度 / 完成后的课堂链接。 */
async function job(jobIdValue: string): Promise<JobResult> {
  const jobId = String(jobIdValue ?? "").trim();
  const empty: JobResult = { ok: false, status: "", progress: 0, scenesGenerated: 0, totalScenes: 0, classroomUrl: "", message: "", error: "", done: false };
  if (!/^[A-Za-z0-9_-]+$/.test(jobId)) return { ...empty, error: "jobId 格式不对" };
  const started = await startServer();
  if (!started.ok) return { ...empty, error: started.error };
  const res = await api(`/api/generate-classroom/${encodeURIComponent(jobId)}`, {}, 30_000);
  if (!res.body?.success) return { ...empty, error: res.body?.error ?? res.error ?? `查询失败（HTTP ${res.status}）` };
  const body = res.body;
  return {
    ok: true,
    status: String(body.status ?? ""),
    progress: Number(body.progress ?? 0),
    scenesGenerated: Number(body.scenesGenerated ?? 0),
    totalScenes: Number(body.totalScenes ?? 0),
    classroomUrl: String(body.result?.url ?? ""),
    message: String(body.message ?? ""),
    error: String(body.error ?? ""),
    done: body.done === true,
  };
}

/** 删除课程库与数据库（破坏性；必须显式 confirm，且先停服务）。 */
async function purgeData(confirm: boolean): Promise<{ ok: boolean; error: string }> {
  if (confirm !== true) return { ok: false, error: "这是破坏性操作：必须显式传 confirm: true" };
  await stopServer();
  try {
    await fs.rm(openMaicPaths().data, { recursive: true, force: true });
    cookieJar = {};
    return { ok: true, error: "" };
  } catch (error) {
    return { ok: false, error: `删除失败：${String((error as Error)?.message ?? error)}` };
  }
}

const OPENMAIC_CHANNELS = ["openmaic:status", "openmaic:start", "openmaic:stop", "openmaic:open", "openmaic:generate", "openmaic:job", "openmaic:purge"];

export const openMaicFeature = defineFeature<null>({
  id: "openmaic",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("openmaic: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("openmaic:status", async () => statusOf());
    ipcHost.handle("openmaic:start", async () => {
      const result = await startServer();
      return { ...result, status: await statusOf() };
    });
    ipcHost.handle("openmaic:stop", async () => {
      const result = await stopServer();
      return { ...result, status: await statusOf() };
    });
    ipcHost.handle("openmaic:open", async () => {
      const result = await startServer();
      if (!result.ok) return { ok: false, url: "", error: result.error };
      await shell.openExternal(result.url);
      return { ok: true, url: result.url, error: "" };
    });
    ipcHost.handle("openmaic:generate", async (_e, input: GenerateInput) => generate(input ?? {}));
    ipcHost.handle("openmaic:job", async (_e, jobId: string) => job(jobId));
    ipcHost.handle("openmaic:purge", async (_e, confirm: boolean) => purgeData(confirm === true));

    // 宿主退出：停掉本地服务与 PG（否则会留下孤儿进程占端口/内存）。
    // ⛔ ctx.effect 只在域被 dispose 时跑；正常关窗退出走 before-quit。pg_ctl stop 用 detached 包一层，
    //    不等应用退出、让它在后台把库停干净。
    const onQuit = () => {
      const cfg = readOpenMaicConfig();
      if (serverProc) { try { serverProc.kill(); } catch { /* 已退出 */ } serverProc = null; }
      void killPort(cfg.port);
      try {
        spawn(path.join(openMaicPaths().pgBin, "pg_ctl.exe"), ["-D", path.join(openMaicPaths().data, "pg"), "stop", "-m", "fast"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
      } catch { /* 没装或已停 */ }
    };
    app.on("before-quit", onQuit);
    ctx.effect(() => {
      app.removeListener("before-quit", onQuit);
      void stopServer();
    });
    ctx.effect(() => {
      for (const ch of OPENMAIC_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
