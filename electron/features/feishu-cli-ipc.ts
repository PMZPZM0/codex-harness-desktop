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
import { shell } from "electron";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { npmGlobalRootCandidates } from "../toolchain";
import fs from "node:fs";
import path from "node:path";

const BIN_NAME = process.platform === "win32" ? "lark-cli.exe" : "lark-cli";
const MAX_OUTPUT = 20_000;

/** `config init --new` 会一直挂着等用户在浏览器里完成（它可能就是写配置的那个进程）。
 *  ⛔ 同一时刻只留一个：重复点「去配置」起两个进程会抢同一份配置文件。 */
let setupChild: import("node:child_process").ChildProcess | null = null;
/** device flow 的后台轮询（`auth login --device-code`）。取消授权时要能杀掉它。 */
let loginChild: import("node:child_process").ChildProcess | null = null;

/** 授权链接直接交给系统默认浏览器 —— ⛔ 只把链接显示在卡片里 = 用户还得自己复制（10-29 用户截图投诉）。 */
function openUrl(url: string): void {
  if (!url) return;
  void shell.openExternal(url).catch(() => undefined);
}

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

/** 把 CLI 的英文报错翻成「下一步该点哪里」。
 *  ⛔ 只回 `User identity: missing` 这类原文 ⇒ 模型看不懂就会反复重试同一条命令。 */
function runHintOf(output: string): string {
  const text = String(output ?? "");
  if (/no user logged in|user identity|identity: missing|not logged in|auth login/i.test(text)) {
    return "飞书 CLI 还没登录：打开「设置 → 开发工具 → 飞书 CLI」，点第 3 步「登录」完成浏览器授权后再试。";
  }
  if (/not configured|config init|config not found|no app ?id/i.test(text)) {
    return "飞书 CLI 还没配置应用：打开「设置 → 开发工具 → 飞书 CLI」，点第 2 步「去配置」完成浏览器里的创建 / 绑定后再试。";
  }
  return "";
}

/** `--version` 结果缓存 60 秒：卡片在等待授权时每 2 秒刷一次状态，
 *  ⛔ 每次都再 spawn 一次版本查询 = 白跑一倍进程（1.0.98 每次 ~80ms）。 */
let versionCache = { value: "", at: 0 };

async function statusOf(): Promise<CliResult> {
  const binary = cliPath();
  const base: CliResult = { installed: Boolean(binary), path: binary, version: "", configured: false, loggedIn: false, user: "", detail: "", error: "" };
  if (!binary) return base;
  try {
    if (!versionCache.value || Date.now() - versionCache.at > 60_000) {
      const version = await execCli(["--version"], { timeoutMs: 10_000 });
      const text = String(version.stdout || version.stderr || "").trim().split(/\s+/).pop() || "";
      if (text) versionCache = { value: text, at: Date.now() };
    }
    base.version = versionCache.value;
  } catch { /* 版本拿不到不算致命 */ }
  try {
    const result = await execCli(["auth", "status", "--json"], { timeoutMs: 12_000 });
    const data = parseJson(result.stdout) ?? {};
    base.detail = result.stdout.slice(0, 500);
    /* ⛔⛔ 按**实测输出**解析（1.0.98）：它就是
         { appId, brand, identities: { bot: { status: "ready" }, user: { status: "missing", available } }, identity }
       —— **没有 `ok` 字段**。旧实现按 `data.ok` 判定 ⇒ 应用明明配置成功也永远显示「未配置」，
          卡片停在「等待浏览器…」一直转（10-29 用户截图实锤）。
       配置完成 = 有 appId 或 bot 身份 ready；登录完成 = user 身份 ready / available。
       老形状（ok/user）保留为兜底，换了版本不会一夜全红。 */
    const identities = (data?.identities ?? {}) as Record<string, any>;
    const bot = identities?.bot ?? null;
    const userIdentity = identities?.user ?? null;
    base.configured = Boolean(data?.appId) || String(bot?.status ?? "").toLowerCase() === "ready" || data?.ok === true;
    const userStatus = String(userIdentity?.status ?? data?.user?.status ?? "").toLowerCase();
    base.loggedIn = userIdentity
      ? Boolean(userIdentity.available) || userStatus === "ready"
      : data?.ok === true && Boolean(data?.user);
    base.user = String(userIdentity?.name ?? userIdentity?.email ?? data?.user?.name ?? data?.user?.email ?? "");
    if (userStatus === "missing" || userStatus === "expired") base.loggedIn = false;
    if (!base.configured) {
      base.error = String(data?.error?.hint ?? data?.error?.message ?? "还没配置飞书应用");
    } else if (data?.error?.message) {
      base.error = String(data.error.message);
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
        try { setupChild?.kill(); } catch { /* 已退出 */ }
        const child = spawn(binary, ["config", "init", "--new"], { windowsHide: true, env: { ...process.env, NO_COLOR: "1", LARK_CLI_NO_ANALYTICS: "1" } });
        setupChild = child;
        let buffer = "";
        let url = "";
        /* 拿到链接后这个进程还得活着（浏览器完成后由它写配置），但不能无限挂：
           用户放弃 / 浏览器被关掉时，10 分钟后收掉，别在后台留一个吃配置锁的僵尸。 */
        const killTimer = setTimeout(() => { try { child.kill(); } catch { /* 已退出 */ } }, 10 * 60_000);
        child.on("close", () => { clearTimeout(killTimer); if (setupChild === child) setupChild = null; });
        const timer = setTimeout(() => {
          if (!url) { clearTimeout(killTimer); try { child.kill(); } catch { /* 忽略 */ } resolve({ ok: false, error: "没有从 CLI 输出里拿到授权链接，请稍后重试" }); }
        }, 30_000);
        const onData = (chunk: Buffer) => {
          buffer = (buffer + String(chunk)).slice(-8000);
          if (!url) {
            const found = firstUrl(buffer);
            if (found) { url = found; clearTimeout(timer); openUrl(found); resolve({ ok: true, url }); }
          }
        };
        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);
        child.on("error", (error) => { clearTimeout(timer); if (setupChild === child) setupChild = null; resolve({ ok: false, error: String(error?.message ?? error) }); });
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
        try { loginChild?.kill(); } catch { /* 已退出 */ }
        const child = spawn(binary, ["auth", "login", "--device-code", deviceCode], { windowsHide: true, detached: true, stdio: "ignore", env: { ...process.env, NO_COLOR: "1", LARK_CLI_NO_ANALYTICS: "1" } });
        loginChild = child;
        child.on("close", () => { if (loginChild === child) loginChild = null; });
        child.on("error", () => { if (loginChild === child) loginChild = null; });
        child.unref();
      } catch { /* 后台轮询起不来：用户仍可用 status 手动刷新 */ }
      openUrl(url);
      return { ok: true, url, deviceCode };
    });

    ipcHost.handle("feishu-cli:logout", async () => {
      if (!cliPath()) return { ok: false, error: "飞书 CLI 还没安装" };
      const result = await execCli(["auth", "logout"], { timeoutMs: 15_000 });
      return { ok: result.code === 0, error: result.code === 0 ? "" : (result.stderr || result.stdout).slice(0, 300) };
    });

    /** 取消授权：杀掉还挂着的 config init / device-code 轮询进程（界面随后自己清空链接与等待态）。
     *  ⛔ 只清界面不杀进程 = 用户看到「已取消」，后台仍在轮询并可能悄悄登录成功。 */
    ipcHost.handle("feishu-cli:cancel", async () => {
      for (const child of [setupChild, loginChild]) {
        if (!child) continue;
        try { child.kill(); } catch { /* 已退出 */ }
      }
      setupChild = null;
      loginChild = null;
      return { ok: true };
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
        const combined = `${result.stderr}\n${result.stdout}`;
        const hint = result.code === 0 ? "" : runHintOf(combined);
        return {
          ok: result.code === 0,
          code: result.code,
          stdout: result.stdout,
          stderr: result.stderr,
          ...(hint ? { error: `${hint}\n原始输出：${combined.trim().slice(0, 800)}` } : {}),
        };
      } catch (error: any) {
        return { ok: false, code: -1, stdout: "", stderr: "", error: String(error?.message ?? error) };
      }
    });

    ctx.effect(() => {
      for (const channel of ["feishu-cli:status", "feishu-cli:setup-start", "feishu-cli:login-start", "feishu-cli:logout", "feishu-cli:cancel", "feishu-cli:run"]) {
        ipcHost.removeHandler(channel);
      }
    });
  },
});
