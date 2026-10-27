/**
 * openfilm 的**探测面**（10-27 批次二从 features/openfilm-ipc.ts 抽出）。
 *
 * 只回答「这台机器现在是什么状态」：CLI / node / 渲染引擎 / ffmpeg / 安装中标记。
 * ⛔ 不做任何写入、不联网、不启动子进程跑 CLI（ffmpeg 跑一次 `-version` 除外，4s 超时）。
 * 为什么单独成文件：`status` 通道（IPC）、模型工具（`tools.ts`）、Studio 打开（`studio.ts`）
 * 三处都要问同一件事 —— 各写一份必然漂移（本项目反复踩过）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { bundledFfmpeg, bundledNode } from "../toolchain";
import { cliEntry, cliVersion, openfilmRoot, readSettings, type Settings } from "./paths";
import { nodeExe } from "./runner";
import { probeStudio, type StudioState } from "./studio";
import { OPENFILM_ATTRIBUTION, type OpenfilmAttribution } from "./brand";

export type OpenfilmPhase = "absent" | "installing" | "ready" | "broken";

/** playwright 的浏览器缓存根（playwright 自己不暴露查询接口，按平台约定枚举）。 */
export function browserCacheRoots(): string[] {
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
export function browserInstalled(): boolean {
  for (const root of browserCacheRoots()) {
    try {
      const entries = fs.readdirSync(root);
      if (entries.some((name) => name.startsWith("chromium_headless_shell") || name.startsWith("chromium-"))) return true;
    } catch { /* 目录不存在 */ }
  }
  return false;
}

export function binaryVersion(exe: string, args = ["-version"]): Promise<string> {
  if (!exe) return Promise.resolve("");
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
export async function ffmpegState(): Promise<{ ok: boolean; path: string; version: string }> {
  const bundled = bundledFfmpeg();
  const version = await binaryVersion(bundled || "ffmpeg", ["-version"]);
  return { ok: Boolean(version), path: bundled || "", version };
}

export type OpenfilmStatus = {
  phase: OpenfilmPhase;
  cli: { installed: boolean; version: string; path: string };
  node: { path: string; version: string; embedded: boolean };
  browser: { installed: boolean; cacheRoots: string[] };
  ffmpeg: { ok: boolean; path: string; version: string };
  settings: Settings;
  /** Studio 现状（批次二）：在里面手改片子的人看到的是不是同一个实例 */
  studio: StudioState;
  /** 声明（界面直接展示，⛔ 不要在前端另写一份文案） */
  attribution: OpenfilmAttribution;
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
  const studio = await probeStudio();
  return {
    phase,
    cli: { installed: Boolean(version), version, path: version ? cliEntry() : "" },
    node: { path: node.exe, version: nodeVersion, embedded: Boolean(bundledNode()) },
    browser,
    ffmpeg: ff,
    settings: readSettings(),
    studio,
    attribution: OPENFILM_ATTRIBUTION,
  };
}
