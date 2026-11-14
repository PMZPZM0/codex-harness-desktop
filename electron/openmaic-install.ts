/**
 * openmaic-install（11-14）—— OpenMAIC 互动课堂的本机安装/配置/环境（从 runtime-ipc 拆出）
 *
 * 源码型 Next.js + PostgreSQL：没有预编译发布包 ⇒ 按需「下载源码 → 装 pnpm/便携 PG → 构建 → 本机起服务」。
 * ⛔ 程序落 tools/openmaic（app + runtime），**数据落 userData/openmaic-data**（PG / 课程媒体 / 配置 / secret）——
 *   分开放才能做到「卸载只删程序、课程数据可选保留」。
 * ⛔ 依赖必须在**最终 app 路径**上安装（先换目录、失败还原）：pnpm node_modules 含链接，装完再移动会让链接指向旧路径
 *   （11-14 实测：跨盘搬移后 Cannot find module '@swc/helpers'）。
 * ⛔ 构建必须用**随包 Node**（>=22.19）与本地 pnpm：PATH 里要有 runtime/bin/pnpm.cmd shim，
 *   否则仓库 postinstall（pnpm run build:packages）会因找不到 pnpm 而失败（11-14 实测）。
 * ⛔ 构建产物 .next/cache 与 .next/standalone 各占 1.3GB/423MB，next start 用不到 ⇒ 装完删掉。
 * ⛔ pg_ctl start 在 Windows 控制台下可能回非零却已启动 ⇒ 一律以端口可连为准。
 */
import fs from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { app } from "electron";
import { bundledNode, bundledNpmCli, toolchainEnv, writeToolsRoot } from "./toolchain";
import { mirrorCandidates } from "./gh-mirror";
import { guardedFetch } from "./net-guard";
import { downloadThroughMirrors } from "./mirror-download";
import { emitRuntimeProgress, isCancelRequested, trackRuntimeProc } from "./features/dev-runtimes";
import type { DevRuntimeId } from "./features/dev-runtimes";

/* ── OpenMAIC 互动课堂（11-14，THU-MAIC/OpenMAIC，MIT）──────────────────────
 * 源码型 Next.js + PostgreSQL：没有预编译发布包 ⇒ 按需「下载源码 → 装 pnpm/便携 PG → 构建 → 本机起服务」。
 * ⛔ 程序落 tools/openmaic（app + runtime），**数据落 userData/openmaic-data**（PG / 课程媒体 / 配置 / secret）——
 *   分开放才能做到「卸载只删程序、课程数据可选保留」。
 * ⛔ 构建必须用**随包 Node**（>=22.19）与本地 pnpm：PATH 里要有 runtime/bin/pnpm.cmd shim，
 *   否则仓库的 postinstall（`pnpm run build:packages`）会因找不到 pnpm 而失败（10-14 实测）。
 * ⛔ 构建产物 .next/cache 与 .next/standalone 各占 1.3GB/423MB，`next start` 用不到 ⇒ 装完删掉。
 * ⛔ 构建先进 .installing/app，成功后才替换旧 app：中途失败/取消不破坏已装版本。 */
export const OPENMAIC_REPO = "THU-MAIC/OpenMAIC";
const OPENMAIC_PNPM = "10.28.0";
const OPENMAIC_PG = "16.15.0-beta.19";
const OPENMAIC_NPM = "https://registry.npmmirror.com";

export type OpenMaicConfig = { port: number; pgPort: number; secret: string };

/** OpenMAIC 的落点（程序 / 数据分开；openmaic-ipc 也读这里）。 */
export function openMaicPaths() {
  const root = path.join(writeToolsRoot(), "openmaic");
  return {
    root,
    app: path.join(root, "app"),
    runtime: path.join(root, "runtime"),
    versionFile: path.join(root, "version.txt"),
    data: path.join(app.getPath("userData"), "openmaic-data"),
    pgBin: path.join(root, "runtime", "node_modules", "@embedded-postgres", "windows-x64", "native", "bin"),
  };
}

/** 读已装版本（安装时落的 version.txt）；更新链用它判断「已是最新」。 */
export function openmaicInstalledVersion(): string {
  try { return readFileSync(openMaicPaths().versionFile, "utf8").trim(); } catch { return ""; }
}

/** 读（必要时生成）OpenMAIC 本地配置：Web 端口 / PG 端口 / 实例 secret。 */
export function readOpenMaicConfig(): OpenMaicConfig {
  const { data } = openMaicPaths();
  const file = path.join(data, "config.json");
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<OpenMaicConfig>;
    const port = Number(raw.port) || 3300;
    const pgPort = Number(raw.pgPort) || 5433;
    const secret = String(raw.secret ?? "");
    if (secret) return { port, pgPort, secret };
  } catch { /* 首次安装 */ }
  const secret = randomBytes(32).toString("base64");
  const cfg = { port: 3300, pgPort: 5433, secret };
  try {
    // 同步写（安装/启动前都要立即可用；数据目录由调用方先建）
    mkdirSync(data, { recursive: true });
    writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  } catch { /* 读不到就按内存值跑，下次再落盘 */ }
  return cfg;
}

/** 写回 OpenMAIC 配置（端口被占用需要换端口时用）。 */
export function saveOpenMaicConfig(cfg: OpenMaicConfig): void {
  const { data } = openMaicPaths();
  try {
    mkdirSync(data, { recursive: true });
    writeFileSync(path.join(data, "config.json"), JSON.stringify(cfg, null, 2) + "\n", "utf8");
  } catch { /* 落盘失败不影响本次运行 */ }
}

/** 端口空闲探测（装 PG / Web 服务前用，避免和本机已有服务抢端口）。 */
async function freePort(start: number): Promise<number> {
  for (let port = start; port < start + 20; port++) {
    const free = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => server.close(() => resolve(true)));
      server.listen(port, "127.0.0.1");
    });
    if (free) return port;
  }
  throw new Error(`从 ${start} 起找不到空闲端口`);
}

/** 等一个本地端口可连（PG / Web 起服务后用它确认真的起来了）。 */
export async function waitLocalPort(port: number, timeoutMs = 40_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: "127.0.0.1", port });
      let settled = false;
      const done = (value: boolean) => { if (settled) return; settled = true; socket.destroy(); resolve(value); };
      socket.setTimeout(800, () => done(false));
      socket.once("connect", () => done(true));
      socket.once("error", () => done(false));
    });
    if (open) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

type StepResult = { code: number; out: string };

/** 跑一个安装步骤（参数数组、不进 shell；输出留尾部给报错；受取消开关控制）。 */
function runOpenMaicStep(id: DevRuntimeId, bin: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; label: string }): Promise<StepResult> {
  return new Promise<StepResult>((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, windowsHide: true });
    } catch (error) {
      reject(error); return;
    }
    trackRuntimeProc(id, child);
    let tail = "";
    const grab = (chunk: unknown) => { tail = `${tail}\n${String(chunk)}`.slice(-4000); };
    child.stdout?.on("data", grab);
    child.stderr?.on("data", grab);
    const timer = setInterval(() => { if (isCancelRequested(id)) { try { child.kill(); } catch { /* 已退出 */ } } }, 1000);
    child.on("error", (error) => { clearInterval(timer); reject(error); });
    child.on("close", (code) => {
      clearInterval(timer);
      if (isCancelRequested(id)) { reject(new Error("已取消")); return; }
      if (code !== 0) { reject(new Error(`${opts.label}失败（${code}）：${tail.trim().slice(-1200)}`)); return; }
      resolve({ code: code ?? 0, out: tail });
    });
  });
}

/** pnpm 的 Windows shim：仓库 postinstall 里直接调 `pnpm`，PATH 上必须有同名 .cmd。 */
async function writePnpmShim(runtimeDir: string, nodeExe: string): Promise<void> {
  const binDir = path.join(runtimeDir, "bin");
  await fs.mkdir(binDir, { recursive: true });
  const pnpmCli = path.join(runtimeDir, "node_modules", "pnpm", "bin", "pnpm.cjs");
  const quote = (value: string) => `"${value}"`;
  await fs.writeFile(path.join(binDir, "pnpm.cmd"), `@echo off\r\n${quote(nodeExe)} ${quote(pnpmCli)} %*\r\n`, "utf8");
}

/** PG 的 data 目录已初始化？ */
function pgInitialized(pgData: string): boolean {
  try { return existsSync(path.join(pgData, "PG_VERSION")); } catch { return false; }
}

/** 停掉本机 OpenMAIC 的 Web 服务与 PostgreSQL（更新/重装前必须停：app 目录要被改名，运行中的文件会锁住）。 */
export async function stopOpenMaicProcesses(): Promise<void> {
  const cfg = readOpenMaicConfig();
  const killPort = (port: number) => new Promise<void>((resolve) => {
    if (process.platform !== "win32") { resolve(); return; }
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
  await killPort(cfg.port);
  const pgData = path.join(openMaicPaths().data, "pg");
  if (pgInitialized(pgData)) {
    await new Promise<void>((resolve) => {
      try {
        const child = spawn(path.join(openMaicPaths().pgBin, "pg_ctl.exe"), ["-D", pgData, "stop", "-m", "fast"], { windowsHide: true });
        child.on("close", () => resolve());
        child.on("error", () => resolve());
        setTimeout(resolve, 15_000);
      } catch { resolve(); }
    });
  }
}

/** 解析 tag 指向的 commit SHA（annotated tag 会自动解引用）。
 *  源码 tarball 没有官方 digest；用**提交寻址**（codeload/…/tar.gz/<sha>）至少保证 tag 不被悄悄移动。 */
async function fetchTagCommit(version: string): Promise<string> {
  const refs = [`v${version}`, version];
  for (const ref of refs) {
    for (const candidate of mirrorCandidates(`https://api.github.com/repos/${OPENMAIC_REPO}/git/ref/tags/${ref}`)) {
      try {
        const res = await guardedFetch(candidate, {
          headers: { accept: "application/vnd.github+json" },
          signal: AbortSignal.timeout(15_000),
        }, { timeoutMs: 15_000 });
        if (!res.ok) continue;
        const json = (await res.json()) as { object?: { type?: string; sha?: string } };
        const sha = String(json?.object?.sha ?? "");
        if (json?.object?.type === "commit" && /^[0-9a-f]{40}$/.test(sha)) return sha;
        if (json?.object?.type === "tag" && /^[0-9a-f]{40}$/.test(sha)) {
          for (const deref of mirrorCandidates(`https://api.github.com/repos/${OPENMAIC_REPO}/git/tags/${sha}`)) {
            try {
              const inner = await guardedFetch(deref, {
                headers: { accept: "application/vnd.github+json" },
                signal: AbortSignal.timeout(15_000),
              }, { timeoutMs: 15_000 });
              if (!inner.ok) continue;
              const body = (await inner.json()) as { object?: { sha?: string } };
              const commit = String(body?.object?.sha ?? "");
              if (/^[0-9a-f]{40}$/.test(commit)) return commit;
            } catch { /* 下一个镜像 */ }
          }
        }
      } catch { /* 下一个镜像 */ }
    }
  }
  return "";
}

/** 安装 / 重装 OpenMAIC（version 传 GitHub 稳定 tag 去 v 前缀）。 */
export async function installOpenMaicFromGitHub(id: DevRuntimeId, version: string): Promise<void> {
  if (process.platform !== "win32") throw new Error("OpenMAIC 本机安装目前仅支持 Windows 10/11 x64");
  if (!/^[0-9][0-9A-Za-z.\-]*$/.test(version)) throw new Error(`OpenMAIC 版本号异常：${version}`);
  const nodeExe = bundledNode();
  const npmCli = bundledNpmCli();
  if (!nodeExe || !npmCli) throw new Error("缺少随包 Node/npm：装不了 OpenMAIC（先修复「Node.js」内置组件）");
  const paths = openMaicPaths();
  const staging = path.join(paths.root, ".installing");
  await fs.mkdir(paths.data, { recursive: true });
  const cfg = readOpenMaicConfig();
  const pgData = path.join(paths.data, "pg");
  // 重装/更新前先停服务与库：app 目录马上要被改名，运行中的文件会锁住
  await stopOpenMaicProcesses();
  emitRuntimeProgress(id, "@@STAGE 下载 OpenMAIC 源码");
  emitRuntimeProgress(id, `正在下载 OpenMAIC ${version} 源码（约 98 MB）…`);
  const archive = path.join(staging, `OpenMAIC-${version}.tar.gz`);
  let backup = "";
  try {
    await fs.rm(staging, { recursive: true, force: true });
    await fs.mkdir(staging, { recursive: true });
    /* 源码包没有官方 digest ⇒ 按 tag 解析出 commit，用提交寻址下载（tag 被移动也拿不到别的代码）。 */
    const commit = await fetchTagCommit(version).catch(() => "");
    emitRuntimeProgress(id, commit ? `源码提交：${commit.slice(0, 12)}` : "提示：未能解析 tag 提交，按 tag 下载");
    await downloadThroughMirrors({
      url: commit
        ? `https://codeload.github.com/${OPENMAIC_REPO}/tar.gz/${commit}`
        : `https://codeload.github.com/${OPENMAIC_REPO}/tar.gz/refs/tags/v${version}`,
      target: archive,
      expectZipMagic: false,
      isCancelled: () => isCancelRequested(id),
      onProgress: (p) => {
        emitRuntimeProgress(id, `@@PROGRESS ${Math.round((p.percent || 0) * 0.2)}`);
        const mb = p.total
          ? `${(p.received / 1048576).toFixed(1)} MB / ${(p.total / 1048576).toFixed(1)} MB`
          : `${(p.received / 1048576).toFixed(1)} MB`;
        emitRuntimeProgress(id, `正在下载 OpenMAIC 源码（${mb}）`);
      },
    });
    if (isCancelRequested(id)) throw new Error("已取消");

    emitRuntimeProgress(id, "@@STAGE 解压源码");
    emitRuntimeProgress(id, "正在解压 OpenMAIC 源码…");
    await runOpenMaicStep(id, "tar", ["-xzf", archive, "-C", staging], { label: "解压源码" });
    const extracted = (await fs.readdir(staging)).find((name) => name.startsWith("OpenMAIC-"));
    if (!extracted) throw new Error("源码包解压后找不到 OpenMAIC-* 目录");
    const pkgVersion = JSON.parse(await fs.readFile(path.join(staging, extracted, "package.json"), "utf8")).version;
    if (String(pkgVersion) !== version) throw new Error(`源码版本不符：期望 ${version}，实际 ${pkgVersion}`);
    /* ⛔ 依赖要在**最终 app 路径**上安装：pnpm 的 node_modules 会含链接，先装再移动/改名会让链接指向旧路径
       （11-14 实测：跨盘搬移后 `Cannot find module '@swc/helpers'`）。所以先换目录（旧版改成 app.old），
       失败再还原 —— 换目录本身是同一卷 rename，秒级、不破坏旧版本。 */
    backup = `${paths.app}.old`;
    await stopOpenMaicProcesses();
    await fs.rm(backup, { recursive: true, force: true });
    if (existsSync(paths.app)) await fs.rename(paths.app, backup);
    await fs.rename(path.join(staging, extracted), paths.app);

    emitRuntimeProgress(id, "@@STAGE 安装 pnpm 与便携 PostgreSQL");
    emitRuntimeProgress(id, "正在下载 pnpm 与便携 PostgreSQL（约 110 MB）…");
    await fs.rm(paths.runtime, { recursive: true, force: true });
    await fs.mkdir(paths.runtime, { recursive: true });
    await runOpenMaicStep(id, nodeExe, [
      npmCli, "install", "--prefix", paths.runtime, "--no-fund", "--no-audit", "--ignore-scripts",
      "--registry", OPENMAIC_NPM, `pnpm@${OPENMAIC_PNPM}`, `@embedded-postgres/windows-x64@${OPENMAIC_PG}`,
    ], { label: "安装运行时组件" });
    await writePnpmShim(paths.runtime, nodeExe);
    if (!pgInitialized(pgData)) {
      await fs.mkdir(pgData, { recursive: true });
      emitRuntimeProgress(id, "正在初始化本地 PostgreSQL…");
      await runOpenMaicStep(id, path.join(paths.pgBin, "initdb.exe"),
        ["-D", pgData, "-U", "openmaic", "-A", "trust", "-E", "UTF8", "--locale=C"], { label: "初始化 PostgreSQL" });
    }
    // 构建期 Next 可能连库：先把 PG 起在配置端口
    const pgRunning = await new Promise<boolean>((resolve) => {
      const check = spawn(path.join(paths.pgBin, "pg_ctl.exe"), ["-D", pgData, "status"], { windowsHide: true });
      check.on("close", (code) => resolve(code === 0));
      check.on("error", () => resolve(false));
    });
    if (!pgRunning) {
      const freePg = await freePort(cfg.pgPort).catch(() => cfg.pgPort);
      if (freePg !== cfg.pgPort) { cfg.pgPort = freePg; saveOpenMaicConfig(cfg); }
      // ⛔ 不看 pg_ctl 退出码（Windows 控制台下「server started」也可能是非零），以端口可连为准
      await new Promise<void>((resolve) => {
        const child = spawn(path.join(paths.pgBin, "pg_ctl.exe"),
          ["-D", pgData, "-o", `-p ${cfg.pgPort} -c listen_addresses=127.0.0.1`, "-l", path.join(paths.data, "pg.log"), "start"],
          { windowsHide: true });
        trackRuntimeProc(id, child);
        child.on("close", () => resolve());
        child.on("error", () => resolve());
      });
      if (!(await waitLocalPort(cfg.pgPort, 30_000))) throw new Error("PostgreSQL 没能在 30 秒内就绪（看 userData/openmaic-data/pg.log）");
    }
    const env = openMaicEnv(paths, cfg);
    // .env.local 在构建期就要在（Next 构建会读）
    await fs.writeFile(path.join(paths.app, ".env.local"), openMaicEnvFile(cfg), "utf8");

    emitRuntimeProgress(id, "@@STAGE 安装项目依赖（5–10 分钟）");
    emitRuntimeProgress(id, "正在安装 OpenMAIC 依赖（约 2.4 GB，5–10 分钟）…");
    emitRuntimeProgress(id, "@@PROGRESS 35");
    const pnpmCli = path.join(paths.runtime, "node_modules", "pnpm", "bin", "pnpm.cjs");
    await runOpenMaicStep(id, nodeExe, [pnpmCli, "install", "--config.confirmModulesPurge=false"], { cwd: paths.app, env, label: "安装项目依赖" });

    emitRuntimeProgress(id, "@@STAGE 构建 OpenMAIC（5–10 分钟）");
    emitRuntimeProgress(id, "正在构建 OpenMAIC（5–10 分钟，CPU 会跑满）…");
    emitRuntimeProgress(id, "@@PROGRESS 65");
    await runOpenMaicStep(id, nodeExe, [pnpmCli, "build"], { cwd: paths.app, env, label: "构建 OpenMAIC" });

    // 停 PG（Start 按钮会再起），换入新 app，删构建缓存
    try {
      await runOpenMaicStep(id, path.join(paths.pgBin, "pg_ctl.exe"), ["-D", pgData, "stop", "-m", "fast"], { label: "停止 PostgreSQL" });
    } catch { /* 停不掉不影响安装 */ }
    await fs.rm(backup, { recursive: true, force: true });
    await fs.rm(path.join(paths.app, ".next", "cache"), { recursive: true, force: true });
    await fs.rm(path.join(paths.app, ".next", "standalone"), { recursive: true, force: true });
    await fs.writeFile(paths.versionFile, version + "\n", "utf8");
    emitRuntimeProgress(id, "@@PROGRESS 100");
  } catch (error) {
    // 失败/取消：把旧版本换回来（第一次安装则保持未安装），别让用户连旧版都用不了
    await fs.rm(paths.app, { recursive: true, force: true }).catch(() => undefined);
    if (backup && existsSync(backup)) await fs.rename(backup, paths.app).catch(() => undefined);
    throw error;
  } finally {
    await fs.rm(backup, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** 启动 OpenMAIC 用的完整环境（PG 地址 / secret / 课程媒体目录 / 内存上限）；openmaic-ipc 起服务时用。 */
export function openMaicProcessEnv(): NodeJS.ProcessEnv {
  const paths = openMaicPaths();
  return openMaicEnv(paths, readOpenMaicConfig());
}

/** 启动 OpenMAIC 用的完整环境（PG 地址 / secret / 课程媒体目录 / 内存上限）。 */
function openMaicEnv(paths: ReturnType<typeof openMaicPaths>, cfg: OpenMaicConfig): NodeJS.ProcessEnv {
  const nodeDir = path.dirname(bundledNode());
  return {
    ...toolchainEnv(),
    PATH: [path.join(paths.runtime, "bin"), nodeDir, process.env.PATH || ""].filter(Boolean).join(path.delimiter),
    DATABASE_URL: `postgresql://openmaic@127.0.0.1:${cfg.pgPort}/postgres`,
    OPENMAIC_SECRET_KEY: cfg.secret,
    OPENMAIC_CLASSROOMS_DIR: path.join(paths.data, "classrooms"),
    OWNER_SINGLE_USER: "true",
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_OPTIONS: "--max-old-space-size=6144",
  };
}

/** .env.local 正文（OpenMAIC 自己会读；模型 Key 由用户在网页设置里填，不写进这里）。 */
function openMaicEnvFile(cfg: OpenMaicConfig): string {
  return [
    "# 由 Codex Harness Desktop 生成：本地单用户安装（模型请在 OpenMAIC 网页设置里配置）",
    `DATABASE_URL=postgresql://openmaic@127.0.0.1:${cfg.pgPort}/postgres`,
    `OPENMAIC_SECRET_KEY=${cfg.secret}`,
    "OWNER_SINGLE_USER=true",
    "NEXT_TELEMETRY_DISABLED=1",
    "",
  ].join("\n");
}

