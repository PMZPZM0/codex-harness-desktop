/**
 * openfilm 的**唯一子进程出口**（10-27 批次二）。
 *
 * 三条纪律（照 docs/OPENFILM-INTEGRATION-2026-10-27.md §3.4）：
 *   ① `spawn(exe, args[])` —— ⛔ 不经 shell、不拼命令字符串（用户内容会进 args：片名 / 区间 / 输出名）；
 *   ② 一律 `cwd` 在**影片目录**（工具执行前由 `tools.ts` 过路径闸）；安装类命令 cwd 在安装根；
 *   ③ 每次调用带超时，超时 `SIGKILL` 并回 `OF_E_TIMEOUT` —— 否则 render 一挂就是永久孤儿进程。
 *
 * ⛔ 用**我们自己的**内置 node 跑 CLI（不要求用户装 Node，也不受系统 Node 版本影响）；
 *    PATH 走 `toolchainEnv()`，`look`/`render` 才能看见我们内置的 ffmpeg/ffprobe。
 */
import { spawn } from "node:child_process";
import { bundledNode, toolchainEnv } from "../toolchain";

export type RunResult = { code: number; stdout: string; stderr: string; timedOut?: boolean };

export type RunOptions = {
  timeoutMs?: number;
  cwd?: string;
  env?: Record<string, string>;
  onLine?: (line: string, isErr: boolean) => void;
};

/** 内置 node；没有就退到 Electron 自带的（⛔ 必须显式给 ELECTRON_RUN_AS_NODE，否则会再开一个窗口）。 */
export function nodeExe(): { exe: string; env: Record<string, string> } {
  const bundled = bundledNode();
  if (bundled) return { exe: bundled, env: {} };
  return { exe: process.execPath, env: { ELECTRON_RUN_AS_NODE: "1" } };
}

/** 通用「用 node 跑一个脚本」（安装器与 CLI 共用，⛔ 别各写一份 spawn）。 */
export function runNode(args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const node = nodeExe();
  return runExe(node.exe, args, opts, node.env);
}

export function runExe(exe: string, args: string[], opts: RunOptions, extraEnv: Record<string, string> = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      cwd: opts.cwd,
      env: { ...toolchainEnv(), ...extraEnv, ...(opts.env ?? {}), NO_UPDATE_NOTIFIER: "1", NO_COLOR: "1" },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timer: NodeJS.Timeout | null = null;
    const feed = (chunk: string, isErr: boolean) => {
      if (isErr) stderr += chunk; else stdout += chunk;
      if (!opts.onLine) return;
      for (const line of chunk.split(/\r?\n/)) {
        const text = line.trim();
        if (!text) continue;
        try { opts.onLine(text, isErr); } catch { /* 进度回调异常不许弄坏一次安装 */ }
      }
    };
    child.stdout?.on("data", (buf) => feed(String(buf), false));
    child.stderr?.on("data", (buf) => feed(String(buf), true));
    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        try { child.kill("SIGKILL"); } catch { /* 已退出 */ }
      }, opts.timeoutMs);
    }
    child.on("error", (error) => { if (timer) clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, ...(timedOut ? { timedOut } : {}) });
    });
  });
}

/* ── OpenFilm CLI ───────────────────────────────────────────────────────── */

/** 允许从模型侧执行的命令（白名单；⛔ `update` / `doctor` 之类的维护命令不开放给模型）。 */
export const CLI_VERBS = ["open", "look", "render", "get", "skills", "skill"] as const;
export type CliVerb = typeof CLI_VERBS[number];

/** 每个动词的超时（look 要抓帧，render 要整片重绘）。 */
const VERB_TIMEOUT: Record<CliVerb, number> = { open: 120_000, look: 180_000, render: 900_000, get: 180_000, skills: 30_000, skill: 30_000 };

export function verbTimeout(verb: CliVerb): number {
  return VERB_TIMEOUT[verb];
}

/**
 * 跑一次 CLI。
 * ⛔ `OPENFILM_NO_BROWSER=1` 恒定设置：否则 `open` 15 秒后自己弹**系统浏览器**，
 *    而我们要把它开进**内置浏览器**（同一实例、同一个页面）。
 * ⛔ `OPENFILM_HOME` 不覆盖：Studio 的机器级状态要与上游桌面端共享（那是"配对"的唯一锚点）。
 */
export function runCli(entry: string, args: string[], opts: RunOptions & { verb: CliVerb }): Promise<RunResult> {
  return runNode([entry, ...args], {
    ...opts,
    timeoutMs: opts.timeoutMs ?? verbTimeout(opts.verb),
    env: { OPENFILM_NO_BROWSER: "1", ...(opts.env ?? {}) },
  });
}
