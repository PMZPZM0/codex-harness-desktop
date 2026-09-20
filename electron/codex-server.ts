import { EventEmitter } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import nodeFs from "node:fs";
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
  /** 主动停止意图（退出应用 / 引擎自更新替换二进制）：置位后 fail() 不再自动拉起引擎。 */
  private stopping = false;
  private heartbeatRestartCount = 0;

  constructor(private readonly codexHome: string) {
    super();
  }

  /** 看门狗已移除（2026-09-09）：保留空实现兼容主进程调用点，不再做任何心跳/重启。 */
  startWatchdog() {}
  stopWatchdog() {}

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
        // ⛔ 必须 force：判定的前提就是"引擎不响应"，此时正在跑的回合**不会**再有
        //    turn/completed（事件根本发不出来），走闸门等下去 = 永远不恢复。
        try { await this.restart({ force: true, reason: "heartbeat-timeout" }); } catch { /* 重启失败会走 fail() 事件 */ }
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

  // ── 重启闸门（09-19 用户：「又莫名其妙断了，能一次性从根上解决嘛」）────────────
  // 背景：全仓库有 20+ 处 `server.restart()`（改模型 / 改供应商 / 装插件 / 装技能 /
  // 改连接器 / 改沙箱档位 …）。每一次重启都会**打断当时所有在跑的回合**（引擎侧
  // 统一报 "app-server restarted"），用户看到的就是"我明明没点停止，任务自己断了"。
  // 逐个调用点加判断是防不住的（今天加一处、明天新增一处照样漏），所以在**唯一入口**
  // 收口：busy 时不真重启，只挂起；等最后一个回合结束（主进程 turn/completed 记账归零）
  // 再自动补做。20+ 处调用点一个字都不用改，全部自动受益。
  private busyGate?: () => number;
  private busyNotice?: (waiting: boolean, reason?: string) => void;
  /** 有回合在跑时被推迟的重启请求（reason 用于日志/提示，只保留第一条避免刷屏） */
  private deferredRestart: { reason: string } | null = null;
  /** 重启台账（诊断用：谁在什么时候触发的重启、当时有几个任务在跑、最终是立即还是推迟） */
  private restartLog: { t: number; reason: string; busy: boolean; activeTurns: number; action: "now" | "defer" | "flush" | "force" }[] = [];

  /** 注入「当前有几个回合在跑」的判定（主进程用 turn/started|completed 的真实记账）。
   *  ⛔ 返回**数量**而不是布尔：台账里要能看出"当时确实有 2 个任务在跑"，
   *  否则闸门不生效时无法区分"真的不忙"与"记账坏了"（09-19 实测踩过这个坑）。 */
  setBusyGate(fn: () => number) {
    this.busyGate = fn;
  }

  /** 注入「重启被推迟/已补做」的通知（渲染层据此提示用户：改动将在任务结束后生效）。 */
  setBusyNotice(fn: (waiting: boolean, reason?: string) => void) {
    this.busyNotice = fn;
  }

  /** 重启台账（诊断：用户报「又断了」时能立刻查是谁触发的）。 */
  restartHistory() {
    return this.restartLog.slice(-40);
  }

  /** 有回合在跑时挂起的重启，等空闲后由主进程调用本方法补做。 */
  async flushDeferredRestart() {
    if (!this.deferredRestart) return;
    if (this.activeTurnCount() > 0) return;    // 又忙起来了（新回合）→ 继续等
    const { reason } = this.deferredRestart;
    this.deferredRestart = null;
    this.restartLog.push({ t: Date.now(), reason, busy: false, activeTurns: 0, action: "flush" });
    this.busyNotice?.(false, reason);
    await this.doRestart();
  }

  /** 当前活跃回合数（0 = 可以安全重启）。 */
  /** 引擎进程**重新拉起**时回调（每次 spawn 后立刻调用）：主进程据此清掉"谁在跑"的记账。
   *  为什么挂在 spawn 而不是 exit：exit 之后可能还有正在进行的 restart 流程，而 spawn 那一刻
   *  才是"旧的回合确定全部不存在"的确定点（见 launch 里的注释）。 */
  setEngineSpawnHook(fn: () => void) {
    this.onEngineSpawned = fn;
  }

  private onEngineSpawned?: () => void;

  activeTurnCount() {
    try { return Number(this.busyGate?.() ?? 0) || 0; } catch { return 0; }
  }

  /**
   * 重启引擎。
   * @param opts.reason 触发原因（写进台账，便于回溯"是谁把任务打断的"）
   * @param opts.force  引擎已死/退出流程等**必须立刻**的场景（等也等不到空闲）；
   *                    默认 false = 有回合在跑就推迟到空闲，绝不打断用户正在跑的任务。
   */
  async restart(opts: { reason?: string; force?: boolean } = {}) {
    const reason = opts.reason ?? "unspecified";
    const activeTurns = this.activeTurnCount();
    const busy = activeTurns > 0;
    if (busy && !opts.force) {
      // 推迟：不重启、返回。调用方 await 也不会卡住（配置已落盘，引擎在下次启动时读）。
      this.deferredRestart = { reason };
      this.restartLog.push({ t: Date.now(), reason, busy: true, activeTurns, action: "defer" });
      this.busyNotice?.(true, reason);
      return;
    }
    this.restartLog.push({ t: Date.now(), reason, busy, activeTurns, action: opts.force && busy ? "force" : "now" });
    await this.doRestart();
  }

  private async doRestart() {
    this.stopping = false;   // 显式重启（不是退出）→ 恢复正常崩溃自愈
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
    const spawnEnv: Record<string, string> = {
      ...toolchainEnv(),
      ...this.externalEnv,
      CODEX_HOME: this.codexHome,
      CODEX_HARNESS_API_KEY: this.apiKey,
      CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: "1",
    };
    this.child = spawn(binary, ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      // toolchainEnv：PATH 里带内置 node/pwsh/npm-global，NODE_PATH 指向 npm 全局
      // node_modules——引擎能直接用 nuphus-mcp / playwright-cli / cloakbrowser。
      // 关掉 remote control 轮询：它是 ChatGPT 账号专属功能，本机走 API key 没有登录态，
      // websocket 每秒重试解析偏好并连带触发 auth reload，实测占全部日志的 95%。
      // 这是二进制里的官方内部开关（不在 --help 里），对非登录态环境是安全关闭。
      env: spawnEnv,
    });
    this.debugLog(`[spawn] HTTPS_PROXY=${spawnEnv.HTTPS_PROXY ?? "(无)"} NO_PROXY=${spawnEnv.NO_PROXY ?? "(无)"} CODEX_HOME=${spawnEnv.CODEX_HOME} provider 相关 env 已注入 ${this.externalEnv.HTTPS_PROXY ? "externalEnv" : "externalEnv 无代理"}`);
    // ⛔ 进程级清账（09-19，用户：「每个会话都是绝对独立运行状态，互不影响」）：
    //   新引擎 = 旧进程里那些回合**全部不存在了**（它们的子进程/会话随进程销毁）。主进程那份
    //   「谁在跑」的记账必须在这里清，否则它会永久卡在"有任务在跑"——
    //     ① 重启闸门（setBusyGate）此后一律推迟，改配置永不生效；
    //     ② `turn/start` 安全网（见 main.ts）此后一律拒绝，用户再也发不出消息。
    //   这是"记账只增不减"的唯一出口，漏了就变成死锁。
    try { this.onEngineSpawned?.(); } catch { /* 钩子异常绝不能影响引擎启动 */ }
    // 被推迟的重启请求：新引擎读的就是磁盘上的新配置（推迟时配置已落盘）——等价于已经生效，
    // 直接作废，别再多余地重启一次（用户刚看到"改动会在任务结束后生效"，这里就是那个兑现点）。
    if (this.deferredRestart) {
      const { reason } = this.deferredRestart;
      this.deferredRestart = null;
      this.restartLog.push({ t: Date.now(), reason, busy: false, activeTurns: 0, action: "flush" });
      this.debugLog(`[restart] 新引擎启动即视为兑现被推迟的重启：${reason}`);
    }
    this.child.stderr.setEncoding("utf8");
    // stderr 只落盘、**不再转发渲染层**（多会话性能 09-12）：渲染层对 kind:"log" 的事件
    // 在 App.tsx 直接 return 丢弃，转发等于白付一次 IPC 序列化；而引擎 stderr 很密
    // （实测 4 小时 1.4 万条），多会话并行时是纯粹的开销。要排查仍看 engine-debug.log。
    this.child.stderr.on("data", (message) => { this.debugLog(`[stderr] ${String(message).trim().slice(0, 600)}`); });
    this.child.on("error", (error) => this.fail(error));
    this.child.on("exit", (code) => this.fail(new Error(`Codex app-server exited (${code ?? "unknown"})`)));

    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => this.handleLine(line));

    await this.request("initialize", {
      clientInfo: { name: "codex_harness_desktop", title: "Codex Harness Desktop", version: "0.0.26" },
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

  /** 黑匣子：引擎关键日志落盘 userData/engine-debug.log（>2MB 轮转），用于诊断流断开等现场问题 */
  debugLog(line: string) {
    try {
      const file = path.join(path.dirname(this.codexHome), "engine-debug.log");
      try {
        if (nodeFs.statSync(file).size > 2 * 1024 * 1024) nodeFs.rmSync(file, { force: true });
      } catch { /* 不存在则直接写 */ }
      nodeFs.appendFileSync(file, `[${new Date().toISOString()}] ${line}\n`);
    } catch { /* 日志失败不影响主流程 */ }
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
    // ⛔ 必须先摘掉 exit/error 监听（09-13 审计 P0）：`exit` 事件接到 `fail()`，而 `fail()`
    // 无条件 `restart()` —— 不摘监听的话，退出路径（cleanupAll → server.stop()）会把引擎
    // **重新 spawn** 出来（孤儿 codex.exe 占同一份 codex-home），引擎自更新时还会和
    // codex.exe 的文件替换抢占用，正好破坏"先停引擎才能换二进制"这个前提。
    this.stopping = true;
    this.child?.removeAllListeners("exit");
    this.child?.removeAllListeners("error");
    this.child?.kill();
    this.child = undefined;
  }

  private write(message: unknown) {
    if (!this.child?.stdin.writable) throw new Error("Codex app-server is unavailable");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  /** 大 payload 事件（命令输出 / file diff 可达数 MB）的延后解析队列。
      多会话性能（09-12）：所有会话共用这一条 stdio 管道，而 `JSON.parse` 是**同步**的——
      一条数 MB 的行在主线程解析期间，其它会话的流式字全部停在管道里。
      处理方式：只对**超过阈值**的行延后到事件循环空闲再解析；小行（绝大多数流式 delta）
      仍然同步解析、**保持原有即时性**。延后项用单条链串起来，确保它们之间顺序不乱。 */
  private deferredParseChain: Promise<void> = Promise.resolve();
  private static readonly DEFER_PARSE_BYTES = 256 * 1024;

  private handleLine(line: string) {
    if (!line.trim()) return;
    // 快速预检：只看前 4KB 同时含 method 与 params 字段（响应是 result/error）+
    // 整行超过阈值 —— 三个条件都满足才认为是「大通知」，值得延后。
    if (line.length > CodexServer.DEFER_PARSE_BYTES) {
      const head = line.slice(0, 4096);
      if (head.includes('"method"') && head.includes('"params"')) {
        this.deferredParseChain = this.deferredParseChain
          .then(() => new Promise<void>((resolve) => setImmediate(resolve)))
          .then(() => { this.parseAndDispatch(line); })
          .catch(() => { /* 单行失败不影响后续 */ });
        return;
      }
    }
    this.parseAndDispatch(line);
  }

  private parseAndDispatch(line: string) {
    let message: any;
    try {
      message = JSON.parse(line);
    } catch {
      this.debugLog(`[raw] ${line.slice(0, 600)}`);
      this.emitEvent({ kind: "log", message: line });
      return;
    }
    if (message.method && /error|retry|disconnect|stream|warning|failed/i.test(message.method)) this.debugLog(`[notice] ${line.slice(0, 600)}`);
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
    // ⛔ 主动停止（退出应用 / 引擎自更新替换二进制）时**不许自动拉起**（09-13 审计 P0）。
    // 退出路径 cleanupAll → stop() 会 kill 引擎，若这里还无条件 restart，就会在退出过程中
    // 重新 spawn 一个孤儿 codex.exe（占同一份 codex-home，下次启动两个引擎抢索引）；
    // 引擎自更新路径更硬：stop() 之后要替换 codex.exe，自动重启会和 rename 抢占用。
    if (this.stopping) {
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(error);
      }
      this.pending.clear();
      return;
    }
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
    this.emitEvent({ kind: "status", status: "error", message: error.message });
    // 看门狗已整体移除（2026-09-09 用户拍板）：心跳误判（MCP worker 慢/忙时 thread/list
    // 超时）会触发无意义重启，丢掉全部内存线程 → 用户会话莫名跳回欢迎页。
    // 只保留「进程真死了」时的自动拉起（上面 fail() 的进程退出分支不再依赖心跳计时器，
    // 改为无条件自动重启一次——真实崩溃恢复是必要的，误判重启不是）。
    this.heartbeatRestarting = true;
    this.emitEvent({ kind: "status", status: "error", message: "Codex 引擎已退出，正在自动重启…" });
    // ⛔ 必须 force：引擎已经死了，闸门等的"回合结束"永远不会到来（那些回合随进程一起没了），
    //    若走默认推迟就会变成"永远不重启"—— 正确的顺序是立刻拉起，让用户自己重发。
    void this.restart({ force: true, reason: "engine-exited" })
      .catch(() => undefined)
      .finally(() => { this.heartbeatRestarting = false; });
  }

  private emitEvent(event: CodexEvent) {
    this.emit("event", event);
  }
}
