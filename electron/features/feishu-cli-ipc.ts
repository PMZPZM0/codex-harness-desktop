/**
 * 飞书 CLI（官方 @larksuite/cli）的宿主接线（10-29）。
 *
 * 为什么单独开一个域（而不是塞进 runtime-ipc）：
 *   · 安装/卸载复用「开发工具」的 runtime:install（按需下载，不随包）；
 *   · **登录**是官方 device flow：`lark-cli auth login --recommend --no-wait --json`
 *     返回 verification_url + device_code，用户在浏览器确认，再用 `--device-code` 落地；
 *   · Codex 侧还要有一个能直接调 CLI 的工具 ⇒ 统一走本域的 `feishu-cli:run`。
 *
 * ⛔ 命令一律**参数数组** spawn，不拼 shell（模型传入的 args 是外部输入）。
 * ⛔ 输出截断后再回给模型（CLI 有的命令返回整篇文档，不截会灌爆上下文）。
 */
import { spawn } from "node:child_process";
import os from "node:os";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { npmGlobalRootCandidates } from "../toolchain";
import fs from "node:fs";
import path from "node:path";

const BIN_NAME = process.platform === "win32" ? "lark-cli.exe" : "lark-cli";
const MAX_OUTPUT = 20_000;

type CliResult = { installed: boolean; path: string; version: string; configured: boolean; loggedIn: boolean; user: string; detail: string; error: string };

/** CLI 可执行文件候选（npm-global 的两种布局都查：win / mac 分叉见 toolchain） */
function cliPath(): string {
  for (const root of npmGlobalRootCandidates()) {
    const candidate = path.join(root, "@larksuite", "cli", "bin", BIN_NAME);
    try { if (fs.existsSync(candidate)) return candidate; } catch { /* 忽略 */ }
  }
  return "";
}

function execCli(args: string[], options: { cwd?: string; timeoutMs?: number } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  const binary = cliPath();
  if (!binary) return Promise.reject(new Error("飞书 CLI 还没安装：请到「设置 → 开发工具 → 飞书 CLI」点安装"));
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      windowsHide: true,
      cwd: options.cwd && options.cwd.trim() ? options.cwd : os.homedir(),
      env: { ...process.env, NO_COLOR: "1", LARK_CLI_NO_ANALYTICS: "1" },
    });
    let stdout = "";
    let stderr = "";
    const cap = (value: string) => (value.length > MAX_OUTPUT ? value.slice(0, MAX_OUTPUT) + "\n…（输出过长已截断）" : value);
    const timer = setTimeout(() => { try { child.kill(); } catch { /* 已退出 */ } }, options.timeoutMs ?? 60_000);
    child.stdout?.on("data", (chunk) => { stdout = cap(stdout + String(chunk)); });
    child.stderr?.on("data", (chunk) => { stderr = cap(stderr + String(chunk)); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
  });
}

/** 从 CLI 输出里找第一个 http(s) 链接（device flow 的授权地址） */
function firstUrl(text: string): string {
  const match = String(text ?? "").match(/https?:\/\/[^\s"'<>]+/);
  return match ? match[0] : "";
}

function parseJson(text: string): any {
  try { return JSON.parse(String(text ?? "").trim()); } catch { return null; }
}

async function statusOf(): Promise<CliResult> {
  const binary = cliPath();
  const base: CliResult = { installed: Boolean(binary), path: binary, version: "", configured: false, loggedIn: false, user: "", detail: "", error: "" };
  if (!binary) return base;
  try {
    const version = await execCli(["--version"], { timeoutMs: 10_000 });
    base.version = String(version.stdout || version.stderr || "").trim().split(/\s+/).pop() || "";
  } catch { /* 版本拿不到不算致命 */ }
  try {
    const result = await execCli(["auth", "status", "--json"], { timeoutMs: 12_000 });
    const data = parseJson(result.stdout) ?? {};
    base.detail = result.stdout.slice(0, 500);
    if (data?.ok) {
      base.configured = true;
      const user = data.user ?? data.currentUser ?? null;
      const status = String(user?.status ?? "").toLowerCase();
      base.loggedIn = Boolean(user) || status === "ready" || Boolean(data.userId);
      base.user = String(user?.name ?? user?.email ?? user?.openId ?? data.userId ?? "");
      if (status === "missing" || status === "expired") base.loggedIn = false;
    } else if (data?.error?.type === "config") {
      base.configured = false;
      base.error = String(data?.error?.hint ?? data?.error?.message ?? "");
    } else {
      base.error = String(data?.error?.message ?? data?.error?.hint ?? result.stderr ?? "");
    }
  } catch (error: any) {
    base.error = String(error?.message ?? error);
  }
  return base;
}

export const feishuCliFeature = defineFeature<null>({
  id: "feishu-cli",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("feishu-cli: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("feishu-cli:status", async () => statusOf());

    /** 第一步：创建/绑定飞书应用（config init --new 会阻塞并打印授权链接） */
    ipcHost.handle("feishu-cli:setup-start", async () => {
      const binary = cliPath();
      if (!binary) return { ok: false, error: "飞书 CLI 还没安装" };
      return await new Promise((resolve) => {
        const child = spawn(binary, ["config", "init", "--new"], { windowsHide: true, env: { ...process.env, NO_COLOR: "1" } });
        let buffer = "";
        let url = "";
        const timer = setTimeout(() => {
          if (!url) { try { child.kill(); } catch { /* 忽略 */ } resolve({ ok: false, error: "没有从 CLI 输出里拿到授权链接，请稍后重试" }); }
        }, 30_000);
        const onData = (chunk: Buffer) => {
          buffer = (buffer + String(chunk)).slice(-8000);
          if (!url) {
            const found = firstUrl(buffer);
            if (found) { url = found; clearTimeout(timer); resolve({ ok: true, url }); }
          }
        };
        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);
        child.on("error", (error) => { clearTimeout(timer); resolve({ ok: false, error: String(error?.message ?? error) }); });
      });
    });

    /** 第二步：用户登录（device flow）。发起后拿到链接，后台用 device-code 完成落地。 */
    ipcHost.handle("feishu-cli:login-start", async () => {
      const binary = cliPath();
      if (!binary) return { ok: false, error: "飞书 CLI 还没安装" };
      const result = await execCli(["auth", "login", "--recommend", "--no-wait", "--json"], { timeoutMs: 20_000 });
      const data = parseJson(result.stdout) ?? {};
      const url = String(data.verification_url ?? data.verificationUrl ?? data.url ?? firstUrl(result.stdout + result.stderr));
      const deviceCode = String(data.device_code ?? data.deviceCode ?? "");
      if (!url || !deviceCode) return { ok: false, error: String(data?.error?.message ?? result.stderr ?? "没有拿到授权链接").slice(0, 300) };
      /* 后台完成轮询：这个命令会阻塞到用户在浏览器里确认（或超时），结果由界面轮询 status 反映 */
      try {
        const child = spawn(binary, ["auth", "login", "--device-code", deviceCode], { windowsHide: true, detached: true, stdio: "ignore", env: { ...process.env, NO_COLOR: "1" } });
        child.unref();
      } catch { /* 后台轮询起不来：用户仍可用 status 手动刷新 */ }
      return { ok: true, url, deviceCode };
    });

    ipcHost.handle("feishu-cli:logout", async () => {
      if (!cliPath()) return { ok: false, error: "飞书 CLI 还没安装" };
      const result = await execCli(["auth", "logout"], { timeoutMs: 15_000 });
      return { ok: result.code === 0, error: result.code === 0 ? "" : (result.stderr || result.stdout).slice(0, 300) };
    });

    /** Codex 工具入口：参数数组直传 CLI（⛔ 不过 shell） */
    ipcHost.handle("feishu-cli:run", async (_event, input: any) => {
      const args = Array.isArray(input?.args) ? input.args.map((arg: any) => String(arg ?? "")) : [];
      if (!args.length) return { ok: false, error: "args 不能为空", code: -1, stdout: "", stderr: "" };
      if (args.length > 64 || args.some((arg: string) => arg.length > 2000)) return { ok: false, error: "参数过多或过长", code: -1, stdout: "", stderr: "" };
      if (!cliPath()) return { ok: false, error: "飞书 CLI 还没安装：请到「设置 → 开发工具 → 飞书 CLI」点安装", code: -1, stdout: "", stderr: "" };
      const cwd = typeof input?.cwd === "string" && input.cwd.trim() ? input.cwd : "";
      try {
        const result = await execCli(args, { cwd, timeoutMs: 90_000 });
        return { ok: result.code === 0, code: result.code, stdout: result.stdout, stderr: result.stderr };
      } catch (error: any) {
        return { ok: false, code: -1, stdout: "", stderr: "", error: String(error?.message ?? error) };
      }
    });

    ctx.effect(() => {
      for (const channel of ["feishu-cli:status", "feishu-cli:setup-start", "feishu-cli:login-start", "feishu-cli:logout", "feishu-cli:run"]) {
        ipcHost.removeHandler(channel);
      }
    });
  },
});
