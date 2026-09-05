import { EventEmitter } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { toolchainEnv } from "./toolchain";

type RpcId = number | string;
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

// ── 引擎健康看门狗参数 ──
// 心跳间隔 12s、单次超时 6s、连续失败 3 次 → 约 36s 无响应即判定卡死并自动重启；
// 连续重启上限 3 次，达到后停止自动重启（避免无限循环）。
const HEARTBEAT_INTERVAL_MS = 12_000;
const HEARTBEAT_TIMEOUT_MS = 6_000;
const HEARTBEAT_MAX_FAILS = 3;
const HEARTBEAT_MAX_RESTARTS = 3;

export type CodexEvent = {
  kind: "notification" | "request" | "status" | "log";
  method?: string;
  id?: RpcId;
  params?: unknown;
  status?: "starting" | "ready" | "stopped" | "error";
  message?: string;
};

function platformPackage() {
  const key = `${process.platform}-${process.arch}`;
  const packages: Record<string, [string, string]> = {
    "win32-x64": ["@openai/codex-win32-x64", "x86_64-pc-windows-msvc"],
    "win32-arm64": ["@openai/codex-win32-arm64", "aarch64-pc-windows-msvc"],
    "darwin-x64": ["@openai/codex-darwin-x64", "x86_64-apple-darwin"],
    "darwin-arm64": ["@openai/codex-darwin-arm64", "aarch64-apple-darwin"],
    "linux-x64": ["@openai/codex-linux-x64", "x86_64-unknown-linux-musl"],
    "linux-arm64": ["@openai/codex-linux-arm64", "aarch64-unknown-linux-musl"],
  };
  const target = packages[key];
  if (!target) throw new Error(`Unsupported platform: ${key}`);
  return target;
}

export function codexBinaryPath() {
  const [packageName, target] = platformPackage();
  const packageJson = require.resolve(`${packageName}/package.json`);
  const executable = process.platform === "win32" ? "codex.exe" : "codex";
  return path.join(path.dirname(packageJson), "vendor", target, "bin", executable).replace("app.asar", "app.asar.unpacked");
}

export class CodexServer extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private pending = new Map<RpcId, Pending>();
  private nextId = 1;
  private starting?: Promise<void>;
  private apiKey = "";
  private externalEnv: Record<string, string> = {};
  // ── 引擎健康看门狗 ──
  // 引擎子进程可能「活着但不响应」（interrupt 打断慢速上游请求时偶发死锁），
  // 表现为回都不回。心跳用 thread/list（轻量秒回、无需 experimentalApi），
  // 连续 HEARTBEAT_MAX_FAILS 次超时即判定卡死 → 自动 kill + 重启 → 渲染层恢复。
  private heartbeatTimer?: NodeJS.Timeout;
  private heartbeatFails = 0;
  private heartbeatRestarting = false;
  private heartbeatRestartCount = 0;

  constructor(private readonly codexHome: string) {
    super();
  }

  /** 启动引擎健康看门狗：每 HEARTBEAT_INTERVAL_MS 发一次 thread/list 心跳。 */
  startWatchdog() {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref?.();
  }

  stopWatchdog() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    this.heartbeatFails = 0;
    this.heartbeatRestarting = false;
    this.heartbeatRestartCount = 0;
  }

  private async heartbeat() {
    // 启动/重启进行中，或没有子进程：跳过本轮
    if (this.starting || this.heartbeatRestarting || !this.child || this.child.killed || this.child.exitCode != null) {
      this.heartbeatFails = 0;
      return;
    }
    try {
      // 6s 超时；正常情况 thread/list 毫秒级返回
      await this.request("thread/list", {}, HEARTBEAT_TIMEOUT_MS);
      this.heartbeatFails = 0;
      this.heartbeatRestartCount = 0; // 心跳恢复 → 清零重启计数
    } catch {
      this.heartbeatFails += 1;
      if (this.heartbeatFails >= HEARTBEAT_MAX_FAILS) {
        this.heartbeatFails = 0;
        // 连续重启超过上限：停止自动重启，避免无限循环（引擎可能无法恢复，交用户处理）
        if (this.heartbeatRestartCount >= HEARTBEAT_MAX_RESTARTS) {
          this.stopWatchdog();
          this.emitEvent({ kind: "status", status: "error", message: `Codex 引擎连续 ${this.heartbeatRestartCount} 次无响应，已停止自动重启，请重启应用。` });
          return;
        }
        this.heartbeatRestartCount += 1;
        this.heartbeatRestarting = true;
        this.emitEvent({ kind: "status", status: "error", message: "Codex 引擎无响应，正在自动重启…" });
        // 卡死恢复：restart 会把 pending 里的请求全部 reject（避免挂 60s 超时）
        try { await this.restart(); } catch { /* 重启失败会走 fail() 事件 */ }
        this.heartbeatRestarting = false;
      }
    }
  }

  async start() {
    if (this.child) return;
    if (this.starting) return this.starting;
    this.starting = this.launch();
    try {
      await this.starting;
    } finally {
      this.starting = undefined;
    }
  }

  setApiKey(value: string) {
    this.apiKey = value;
  }

  setExternalEnv(value: Record<string, string>) {
    this.externalEnv = value;
  }

  async restart() {
    if (this.child) {
      this.child.removeAllListeners("exit");
      this.child.kill();
      this.child = undefined;
    }
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error("Codex app-server restarted"));
    }
    this.pending.clear();
    await this.start();
  }

  private async launch() {
    this.emitEvent({ kind: "status", status: "starting" });
    const binary = codexBinaryPath();
    this.child = spawn(binary, ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      // toolchainEnv：PATH 里带内置 node/pwsh/npm-global，NODE_PATH 指向 npm 全局
      // node_modules——引擎能直接用 nuphus-mcp / playwright-cli / cloakbrowser。
      // 关掉 remote control 轮询：它是 ChatGPT 账号专属功能，本机走 API key 没有登录态，
      // websocket 每秒重试解析偏好并连带触发 auth reload，实测占全部日志的 95%。
      // 这是二进制里的官方内部开关（不在 --help 里），对非登录态环境是安全关闭。
      env: {
        ...toolchainEnv(),
        ...this.externalEnv,
        CODEX_HOME: this.codexHome,
        CODEX_HARNESS_API_KEY: this.apiKey,
        CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: "1",
      },
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (message) => this.emitEvent({ kind: "log", message: String(message).trim() }));
    this.child.on("error", (error) => this.fail(error));
    this.child.on("exit", (code) => this.fail(new Error(`Codex app-server exited (${code ?? "unknown"})`)));

    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => this.handleLine(line));

    await this.request("initialize", {
      clientInfo: { name: "codex_harness_desktop", title: "Codex Harness Desktop", version: "0.0.5" },
      capabilities: { experimentalApi: true },
    });
    this.notify("initialized", {});
    // 已知噪音（调研结论，别重复踩）：app-server 的 remote control 是 ChatGPT 账号专属功能，
    // 本机走 API key 没有登录态，websocket 会每秒重试解析偏好并连带触发一次 auth reload。
    // 实测它俩占全部日志的 95%（近 4 小时 1.4 万条），日志库因此涨到 80MB+；但对单轮延迟
    // 影响可忽略（引擎本地开销总计 <0.1s），所以只记录不处理。三条关闭路径都试过，均无效：
    //   remoteControl/disable → 需认证，报 "remote control requires ChatGPT authentication"
    //   --disable remote_control → 不是合法 feature 名，静默无效
    //   config.toml 里没有对应键（二进制里 remote_control 只出现在 SQL 语句中）
    this.emitEvent({ kind: "status", status: "ready" });
    // 注意：引擎就绪后是否启动健康看门狗由主进程控制（startWatchdog/stopWatchdog），
    // 因为开关存于 app-settings.json（engineWatchdog，默认开）。主进程在 server 的
    // "ready" 事件里按设置调用；这里不再自动启动，避免与主进程控制竞争。
  }

  /** 引擎子进程是否存活（/doctor、/debug 等诊断命令用） */
  get running() {
    return Boolean(this.child && !this.child.killed && this.child.exitCode == null);
  }

  async request(method: string, params: unknown, timeoutMs = 60_000) {
    if (!this.child && method !== "initialize") await this.start();
    if (!this.child) throw new Error("Codex app-server is not running");
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, method, params });
    });
  }

  respond(id: RpcId, result: unknown) {
    this.write({ id, result });
  }

  notify(method: string, params: unknown) {
    this.write({ method, params });
  }

  stop() {
    this.stopWatchdog();
    this.child?.kill();
    this.child = undefined;
  }

  private write(message: unknown) {
    if (!this.child?.stdin.writable) throw new Error("Codex app-server is unavailable");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string) {
    if (!line.trim()) return;
    let message: any;
    try {
      message = JSON.parse(line);
    } catch {
      this.emitEvent({ kind: "log", message: line });
      return;
    }
    if (message.id !== undefined && ("result" in message || "error" in message)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
      else pending.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) {
      this.emitEvent({ kind: "request", id: message.id, method: message.method, params: message.params });
      return;
    }
    if (message.method) this.emitEvent({ kind: "notification", method: message.method, params: message.params });
  }

  private fail(error: Error) {
    this.child = undefined;
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
    this.emitEvent({ kind: "status", status: "error", message: error.message });
    // 引擎崩溃/退出也要自动恢复：若看门狗已启用且未在重启中、未超上限，则自动拉起。
    // （卡死重启在看门狗 heartbeat 里做；这里只处理「进程已死」的崩溃场景。）
    if (this.heartbeatTimer && !this.heartbeatRestarting && this.heartbeatRestartCount < HEARTBEAT_MAX_RESTARTS) {
      this.heartbeatRestarting = true;
      this.heartbeatRestartCount += 1;
      this.emitEvent({ kind: "status", status: "error", message: "Codex 引擎已退出，正在自动重启…" });
      void this.restart()
        .catch(() => undefined)
        .finally(() => { this.heartbeatRestarting = false; });
    }
  }

  private emitEvent(event: CodexEvent) {
    this.emit("event", event);
  }
}
