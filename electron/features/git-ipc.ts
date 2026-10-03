/**
 * git-ipc（10-03 从 `features/settings-app-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：git(1)
 * 通道：git:diff（工作区 / 暂存区 / HEAD 三档 diff）
 *
 * 用**自带的 git**（`bundledGit()`）而不是系统 git：新电脑无需预装，口径也稳定。
 * ⛔ 待接缝化（阶段 2）：`spawn` 属宿主能力，将来经 `"subprocess"` 接缝注入。
 */
import { spawn } from "node:child_process";
import { bundledGit, toolchainEnv } from "../toolchain";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const gitFeature = defineFeature<null>({
  id: "git",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("git: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("git:diff", (_event, input: { cwd: string; scope: string }) => new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const args = input.scope === "staged" ? ["diff", "--cached"] : input.scope === "head" ? ["diff", "HEAD"] : ["diff"];
      const proc = spawn(bundledGit() || "git", args, { cwd: input.cwd, windowsHide: true, env: toolchainEnv() });
      let output = "";
      proc.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
      proc.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
      proc.on("error", () => resolve({ code: null, output: "" }));
      proc.on("close", (code) => resolve({ code, output }));
    }));

    ctx.effect(() => {
      ipcHost.removeHandler("git:diff");
    });
  },
});
