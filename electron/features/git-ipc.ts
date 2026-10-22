/**
 * git-ipc（10-03 从 `features/settings-app-ipc.ts` 按前缀拆出，同时改为**插件形态**；
 * 10-18 实修右栏「变更」四个范围）
 *
 * 域：git(1)
 * 通道：git:diff
 *
 * 范围语义：
 *   · unstaged → `git diff`（工作区里还没 add 的改动）
 *   · staged   → `git diff --cached`（已经 add 的改动）
 *   · head     → **分支起点 diff**：先找上游（@{upstream}），没有就找 origin/HEAD、main、master，
 *                再用 `merge-base <base> HEAD` 得到分叉点，`git diff <merge-base>` ——
 *                **包含分支上已提交的改动 + 工作区未提交的改动**；找不到基准才退回 `git diff HEAD`
 *                并在 error 里说明（⛔ 旧实现把 head 做成 `git diff HEAD`，与 unstaged 几乎一样，
 *                分支已提交的改动完全看不到）。
 *   · last     → 由渲染层直接用上一轮回合 diff，不经过 Git。
 *
 * 用**自带的 git**（`bundledGit()`）而不是系统 git：新电脑无需预装，口径也稳定。
 * 找不到 Git / 不是 Git 仓库 / 没有 HEAD 时都要回**可操作的中文原因**（⛔ 不许静默空列表）。
 * ⛔ 待接缝化（阶段 2）：`spawn` 属宿主能力，将来经 `"subprocess"` 接缝注入。
 */
import { spawn } from "node:child_process";
import { bundledGit, toolchainEnv } from "../toolchain";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { isInsideOrEqualTrustedRoots } from "../runtime-refs";
import { GIT_BASE_CANDIDATES, NO_BRANCH_BASE_NOTE, diffArgsForScope, gitFailureMessage } from "../git-review";

type GitDiffResult = { code: number | null; output: string; error?: string };

/** 跑一次 Git；spawn 都失败（找不到 Git）时 reject，让渲染层进入「安装 Git」分支。 */
function runGit(cwd: string, args: string[], timeoutMs = 20_000): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bundledGit() || "git", ["-c", "core.quotepath=false", ...args], {
        cwd,
        windowsHide: true,
        env: toolchainEnv(),
      });
    } catch {
      reject(new Error(gitFailureMessage(null, "")));
      return;
    }
    let output = "";
    let settled = false;
    let timedOut = false;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      resolve({ code: timedOut ? 124 : code, output });
    };
    child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch { /* 已退出 */ }
      finish(null);
    }, timeoutMs);
    child.on("error", () => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(new Error(gitFailureMessage(null, "")));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish(typeof code === "number" ? code : null);
    });
  });
}

async function findBranchBase(cwd: string): Promise<string> {
  const upstream = await runGit(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
  if (upstream.code === 0 && upstream.output.trim()) return upstream.output.trim();
  for (const candidate of GIT_BASE_CANDIDATES) {
    const verify = await runGit(cwd, ["rev-parse", "--verify", candidate]);
    if (verify.code === 0 && verify.output.trim()) return candidate;
  }
  return "";
}

async function diffForScope(cwd: string, scope: string): Promise<GitDiffResult> {
  if (scope === "last") return { code: 0, output: "", error: "「上一轮更改」由上一轮回合记录直接展示，不经过 Git。" };
  if (scope === "head") {
    const base = await findBranchBase(cwd);
    if (base) {
      const mergeBase = await runGit(cwd, ["merge-base", base, "HEAD"]);
      const mb = mergeBase.output.trim().split("\n").map((line) => line.trim()).filter(Boolean).pop() ?? "";
      if (mergeBase.code === 0 && mb) {
        const diff = await runGit(cwd, ["diff", mb]);
        return { code: diff.code, output: diff.output, error: diff.code === 0 ? "" : gitFailureMessage(diff.code, diff.output) };
      }
    }
    const fallback = await runGit(cwd, ["diff", "HEAD"]);
    return {
      code: fallback.code,
      output: fallback.output,
      error: fallback.code === 0 ? NO_BRANCH_BASE_NOTE : gitFailureMessage(fallback.code, fallback.output),
    };
  }
  const args = diffArgsForScope(scope);
  if (!args) return { code: null, output: "", error: `未知的变更范围：${scope}` };
  const diff = await runGit(cwd, args);
  return { code: diff.code, output: diff.output, error: diff.code === 0 ? "" : gitFailureMessage(diff.code, diff.output) };
}

export const gitFeature = defineFeature<null>({
  id: "git",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("git: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("git:diff", async (_event, input: { cwd?: unknown; scope?: unknown } | null | undefined): Promise<GitDiffResult> => {
      const cwd = String(input?.cwd ?? "").trim();
      if (!cwd) return { code: null, output: "", error: "还没有选择工作区：先在会话里选一个项目目录。" };
      /* 10-22 文案：原文是「不在可信工作区…拒绝读取」，用户读到的是一句拒绝声明（且不知道下一步做什么）。
         改成「说清原因 + 说清下一步」，安全语义（工作区之外一律不读）不弱化。 */
      if (!isInsideOrEqualTrustedRoots(cwd)) return { code: null, output: "", error: "读不到变更：这个目录不在当前会话的工作区内。工作区之外的 Git 数据不会被读取（安全限制），切到对应项目后再试。" };
      return diffForScope(cwd, String(input?.scope ?? "unstaged"));
    });

    ctx.effect(() => {
      ipcHost.removeHandler("git:diff");
    });
  },
});
