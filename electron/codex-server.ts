import { EventEmitter } from "node:events";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import nodeFs from "node:fs";
import { app } from "electron";
import { toolchainEnv } from "./toolchain";
import { ensureSessionWorkspace } from "./features/session-workspace";
import { threadCwd } from "./thread-cwd";

type RpcId = number | string;
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

// ── 引擎健康看门狗参数 ──
// 心跳间隔 12s、单次超时 6s、连续失败 3 次 → 约 36s 无响应即判定卡死并自动重启；
// 连续重启上限 3 次，达到后停止自动重启（避免无限循环）。
const HEARTBEAT_INTERVAL_MS = 12_000;
const HEARTBEAT_TIMEOUT_MS = 6_000;
const HEARTBEAT_MAX_FAILS = 3;
const HEARTBEAT_MAX_RESTARTS = 3;

// ── 引擎启动容错（10-08 用户实测「装技能/插件报安装失败」事故）────────────────
// 现象：安装流程前 5 步全绿，最后一步「重启 Codex 引擎」报
//   `[ERR_INVOKE_FAILED] skills:market-install: Error: Codex app-server exited (1)`
//   —— 文件其实已经落盘装好了，用户却被判成"安装失败"。
// 根因：引擎（0.157 起）启动时会在 CODEX_HOME 下初始化 sqlite state runtime，**偶发**失败：
//   `Error: failed to initialize sqlite state runtime under <codexHome>`（进程直接 exit 1）。
//   实测同一目录**紧接着的重启必定成功**（日志里失败后 26ms 的成功 spawn）⇒ 纯瞬时故障，
//   不是磁盘损坏（引擎自身还有"损坏库挪到备份目录再重建"的兜底，那条路径没被走到）。
// 宿主侧两处把瞬时故障放大成用户可见故障：
//   ① `doRestart()` 杀掉旧引擎后**不等它真正退出**就 spawn ⇒ 两个进程在同一 codex-home 重叠；
//   ② 这次瞬时失败被原样抛给 IPC ⇒ 已经成功的安装被报成失败。
// 对策：启动失败自动重试（首次 + 2 次，退避 300ms / 900ms）。重试成功对上层完全透明。
const ENGINE_START_ATTEMPTS = 3;
const ENGINE_START_RETRY_MS = [300, 900];
/** doRestart 等待旧引擎进程真正退出的上限（Windows 上 kill = TerminateProcess，实测毫秒级）。 */
const ENGINE_EXIT_WAIT_MS = 3_000;
/** 引擎 pid 台账上限（只留最近的；跨实例清理用，不是历史日志）。 */
const ENGINE_PID_CAP = 16;

/* ── 引擎进程台账与树杀（10-28 用户：「每次关闭应用带着进程一起杀掉，保留干净的后台」）────
   ⛔ 只 kill 父进程不够：codex 会派 pwsh / node / MCP 子进程，父进程一死它们变孤儿，
      继续占着会话 rollout 的 writer ⇒ 下次打开同一会话时引擎报
      `thread-store conflict: thread … already has an active writer`（10-28 用户截图那条红条）。
   ⛔ 台账落盘（而不是只记内存）：应用被强杀/崩溃时内存里的 pid 一起没了，
      只能靠上一次 spawn 时写下的文件知道"谁是我留下的"。
   ⛔ 路径必须惰性求值：本模块的顶层求值早于 `app.setPath("userData", …)`（见【91】）。 */
function enginePidFile(): string {
  try { return path.join(app.getPath("userData"), "engine.pid"); } catch { return ""; }
}

function readEnginePid(): number {
  try {
    const pid = Number(String(nodeFs.readFileSync(enginePidFile(), "utf8")).trim().split(/\s+/)[0]);
    return Number.isInteger(pid) && pid > 1 && pid !== process.pid ? pid : 0;
  } catch { return 0; }
}

function writeEnginePid(pid: number | undefined) {
  if (!pid) return;
  try { nodeFs.writeFileSync(enginePidFile(), String(pid)); } catch { /* 台账写不进去不该挡住启动 */ }
}

function clearEnginePid() {
  try { nodeFs.unlinkSync(enginePidFile()); } catch { /* 本来就不存在 */ }
}

/* ── 多 pid 台账（10-31）──────────────────────────────────────────────────────
   ⛔ 单 pid 台账（engine.pid）只记「最后一次 spawn」：启动序列重叠时前一个引擎会被覆盖掉，
      应用崩溃后再启动就再也找不到它 ⇒ 它会一直占着同一 codex-home 的会话 writer。
   云助手实测事故（10-31）：2 秒内 4 次 [spawn]，两个 codex.exe 同时活着，
   打开任何会话都报 `thread-store conflict: thread … already has an active writer`。
   ⇒ 台账改成**数组**（最近的 ENGINE_PID_CAP 个），stop() 与下次启动据此逐个清理。 */
function enginePidListFile(): string {
  try { return path.join(app.getPath("userData"), "engine.pids.json"); } catch { return ""; }
}

function readEnginePids(): number[] {
  const pids: number[] = [];
  try {
    const parsed = JSON.parse(nodeFs.readFileSync(enginePidListFile(), "utf8"));
    if (Array.isArray(parsed)) {
      for (const value of parsed) {
        const pid = Number(value);
        if (Number.isInteger(pid) && pid > 1) pids.push(pid);
      }
    }
  } catch { /* 没有台账 / 旧版本没写过 */ }
  const legacy = readEnginePid();   // 旧版本的单个 pid 台账，一并纳入迁移
  if (legacy) pids.push(legacy);
  return [...new Set(pids)];
}

function appendEnginePid(pid: number | undefined) {
  if (!pid) return;
  try {
    const pids = readEnginePids().filter((value) => value !== pid);
    pids.push(pid);
    nodeFs.writeFileSync(enginePidListFile(), JSON.stringify(pids.slice(-ENGINE_PID_CAP)));
  } catch { /* 台账写不进去不该挡住启动 */ }
}

function clearEnginePids() {
  try { nodeFs.unlinkSync(enginePidListFile()); } catch { /* 本来就不存在 */ }
  clearEnginePid();
}

/** 列出「可执行文件就是本应用的引擎二进制」的 codex 进程。
    ⛔ 跨实例遗留清理的第二道网：旧版本只写单个 pid（还会被覆盖），今天的现场里最早那个 pid
       就不在任何台账上 —— 只靠 pid 台账清不掉它。这里只比**可执行文件全路径**：
       桌面版 / PPcode / 云助手各有自己的 node_modules 与安装目录，别的产品的引擎不会被误杀。 */
function listCodexPidsByBinary(binary: string): { pid: number; ppid: number }[] {
  const target = binary.replace(/\//g, "\\").toLowerCase();
  try {
    if (process.platform === "win32") {
      const out = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        "Get-CimInstance Win32_Process -Filter \"Name='codex.exe'\" | ForEach-Object { $_.ProcessId.ToString() + '|' + $_.ParentProcessId.ToString() + '|' + $_.ExecutablePath }",
      ], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
      return String(out.stdout ?? "").split(/\r?\n/).flatMap((line) => {
        const [id, parent, exePath] = line.trim().split("|");
        const pid = Number(id);
        const ppid = Number(parent);
        return Number.isInteger(pid) && pid > 1 && String(exePath ?? "").replace(/\//g, "\\").toLowerCase() === target
          ? [{ pid, ppid: Number.isInteger(ppid) ? ppid : 0 }]
          : [];
      });
    }
    // mac/Linux：ps 的 command/args 首段就是可执行文件（含路径）
    const out = spawnSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8", timeout: 5_000 });
    return String(out.stdout ?? "").split(/\r?\n/).flatMap((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
      if (!match) return [];
      const exePath = match[3].trim().replace(/^"|"$/g, "").split(/\s+/)[0];
      return exePath === binary ? [{ pid: Number(match[1]), ppid: Number(match[2]) }] : [];
    });
  } catch { return []; }
}

/** 进程是否还活着（Windows 上 signal 0 只查存在性，不真发信号）。 */
function isProcessAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException)?.code === "EPERM"; }
}

/** 该 pid 仍是 codex 引擎吗（防 PID 复用误杀无关进程）：只认镜像名。 */
function isCodexProcess(pid: number): boolean {
  if (process.platform === "darwin") {
    /* ⛔⛔ mac 适配（10-30 审计）：darwin **没有 /proc**（下面那条 Linux 分支在 mac 上读文件恒抛
       ⇒ 一律返回 false）⇒「清理上次遗留的引擎」在 mac 上是**死代码**，孤儿引擎不会被杀，
       会话 writer 冲突（`thread-store conflict: already has an active writer`）照旧复发。
       macOS 用 `ps -p <pid> -o comm=`：comm 是**可执行文件全路径**，取 basename 再比 codex。 */
    try {
      const out = spawnSync("ps", ["-p", String(pid), "-o", "comm="], { encoding: "utf8", timeout: 5_000 });
      return /^codex/i.test(path.basename(String(out.stdout ?? "").trim()));
    } catch { return false; }
  }
  if (process.platform !== "win32") {
    try { return /^codex/i.test(nodeFs.readFileSync(`/proc/${pid}/comm`, "utf8").trim()); } catch { return false; }
  }
  try {
    const out = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
      encoding: "utf8", windowsHide: true, timeout: 5_000,
    });
    return /^"codex[^"]*\.exe"/i.test(String(out.stdout ?? "").trim());
  } catch { return false; }
}

/** 连**子进程树**一起杀：`/T` 走 Windows 的父链，codex 派生的 pwsh/node/MCP 一并清掉。 */
function killProcessTree(pid: number | undefined) {
  if (!pid || pid <= 1 || pid === process.pid) return;
  if (process.platform === "win32") {
    try { spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: 8_000 }); } catch { /* 已退出 */ }
    return;
  }
  try { process.kill(-pid, "SIGKILL"); } catch { /* 无进程组 */ }
  try { process.kill(pid, "SIGKILL"); } catch { /* 已退出 */ }
}

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
  /** 启动序列（含重试）进行中。`fail()` 据此避免并发再拉一次（见 fail() 注释）。 */
  private launching = false;
  /** 启动代次令牌：`doRestart()` 杀进程后自增，让在途启动序列的重试**立刻让位**，
   *  否则它会把自己刚被杀的引擎再 spawn 一遍。 */
  private launchToken = 0;
  private apiKey = "";
  private externalEnv: Record<string, string> = {};
  /** 内置插件密钥（生图/视觉）→ 引擎进程 env；见 setBuiltinPluginEnv。 */
  private builtinEnv: Record<string, string> = {};
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

  /** 看门狗已移除（2026-09-09）：保留空实现兼容主进程调用点，不再做任何心跳/重启。
   *  ⛔ 09-24 评估报告核查后的更正：这**不是**"忘了实现的死代码"，而是**刻意的产品决策**，
   *  所以不要顺手把它接回来 —— 下面的 heartbeat() 是力重启（`restart({ force: true })`），
   *  在引擎被长回合占满时若判定超时就会**打断正在跑的会话**，违反「除用户停止不许断」的铁律。
   *  真要恢复必须先加"忙碌闸"（有活动回合时只记数、不重启）。
   *  残留的诚实性问题（设置项与注释仍声称本能力）已同轮改写，并由守卫【140】钉住。 */
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

  async start(): Promise<void> {
    if (this.child) return;
    if (this.starting) return this.starting;
    /* ⛔ 10-31：重启序列进行中不许再 spawn（它会自己把引擎拉起来）。
       旧写法在这里直接 `this.starting = this.launch()` —— doRestart 清空 child 之后要等旧进程
       退出（最长 3 秒），这个窗口里任何 request() 都能顺手 start() 出一个新引擎，紧接着被
       doRestart 的 reject 打成「重启中失败」并重试 ⇒ 两个引擎同时活着抢同一份会话。 */
    if (this.restartInFlight) {
      await this.restartInFlight.catch(() => undefined);
      return this.start();
    }
    return this.startInternal();
  }

  /** 真正的启动入口（重启序列内部用，绕过 restartInFlight 等待，否则自己等自己）。
   *  ⛔ `starting` 的清理必须**比对 promise 身份**：旧写法无条件 `this.starting = undefined`，
   *    会把更晚那条启动序列刚赋的值抹掉 ⇒ 再来一个 start() 就会看到"没在启动、也没 child"
   *    而并发 spawn 第二个引擎（同一 codex-home ⇒ active writer 冲突）。 */
  private async startInternal(): Promise<void> {
    if (this.child) return;
    const inFlight = this.starting;
    if (inFlight) return inFlight;
    const promise = this.launch();
    this.starting = promise;
    try {
      await promise;
    } finally {
      if (this.starting === promise) this.starting = undefined;
    }
  }

  setApiKey(value: string) {
    this.apiKey = value;
  }

  setExternalEnv(value: Record<string, string>) {
    this.externalEnv = value;
  }

  /**
   * 内置插件（生图 / 视觉）的密钥 → 只进**引擎进程的环境变量**，不落盘（10-13 体检 P0-1）。
   * ⛔ 为什么单独一格而不并进 `externalEnv`：后者由 connector 组装在**多处**各自整体替换
   *    （connectors-ipc / custom-model-apply / boot），并进去会被下一次替换冲掉。
   *    这里是**叠加**关系，与那套组装互不干扰。
   */
  setBuiltinPluginEnv(value: Record<string, string>) {
    this.builtinEnv = value;
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
  /** 上次实例遗留的引擎只清一次（每次 spawn 都做会多花一次 tasklist/taskkill）。 */
  private reapedPreviousEngine = false;
  /** 进行中的重启序列（10-31）：并发 restart() 合并成一次；start() 在它收尾前不得 spawn。 */
  private restartInFlight: Promise<void> | null = null;

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

  /** 并发 restart() 合并成一次（10-31）：启动期 20+ 处调用点里常有两三处同时触发，
   *  旧写法会各跑一遍「清 child → 等退出 → spawn」，互相把对方刚 spawn 的引擎打成孤儿。 */
  private async doRestart() {
    if (this.restartInFlight) return this.restartInFlight;
    const run = this.performRestart();
    this.restartInFlight = run;
    try {
      await run;
    } finally {
      if (this.restartInFlight === run) this.restartInFlight = null;
    }
  }

  private async performRestart() {
    this.stopping = false;   // 显式重启（不是退出）→ 恢复正常崩溃自愈
    // 作废在途启动序列的重试：它 spawn 的进程马上会被杀掉，不许它自己再补一个。
    this.launchToken += 1;
    /* ⛔⛔ 10-31 顺序修正（云助手「会话正被另一个引擎进程占用」事故）：
       旧写法**先等旧进程退出（最长 3 秒）、后 reject 在途请求**。这个窗口里 child 已被清空、
       starting 也可能刚被清，任何 request() 都会顺手 start() 出一个新引擎；等退出完成后这里
       再 reject，打中的正是**新引擎的 initialize** ✗ ⇒ launch() 看到 token 没变、按「瞬时失败」
       重试又 spawn 一个 ⇒ 两个引擎同时活着，各自占着同一份 codex-home 的会话 writer。
       ⇒ 先 reject（在途启动序列立刻失败让位），再杀、再等退出。 */
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error("Codex app-server restarted"));
    }
    this.pending.clear();
    // ⛔⛔ 必须**等旧进程真的退出**再 spawn（10-08 事故）：引擎 0.157 起启动时要在
    //   codex-home 下初始化 sqlite state runtime，两个进程重叠时新进程会以
    //   `failed to initialize sqlite state runtime under …` 直接 exit 1。
    await this.reapCurrentChild();
    // 在途启动序列（如果有）已被上面 reject 打断，等它真正收尾再 start ——
    // 否则 `start()` 会因为 `this.starting` 仍被那个注定失败的 promise 占用而直接返回它，
    // 结果既不 spawn 也不报错，引擎静默停在"已退出"（10-08 日志里 8 秒无 spawn 就是这个）。
    await this.starting?.catch(() => undefined);
    if (!this.child) await this.startInternal();
  }

  /** 杀掉当前 child（含子进程树）并等它真正退出；没有 child 时是 no-op。
   *  ⛔ 摘掉 exit/error 监听（否则会触发 fail() 的自动重启），用 once("exit") 等落地，
   *    超时兜底 ENGINE_EXIT_WAIT_MS，绝不无限等。
   *  ⛔ 连树杀（10-28）：只结束 app-server 本体时，它派生的 pwsh / MCP 会留在后台并继续
   *    握着会话 writer —— 下一个进程打开同一会话就报 already has an active writer。
   *  ⛔ 必须在等 exit **之前**同步做完：异步树杀会在"新进程已 spawn、旧子进程还在"的窗口里打架。 */
  private async reapCurrentChild() {
    const dying = this.child;
    this.child = undefined;
    if (!dying) return;
    dying.removeAllListeners("exit");
    dying.removeAllListeners("error");
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => { if (settled) return; settled = true; clearTimeout(timer); resolve(); };
      const timer = setTimeout(finish, ENGINE_EXIT_WAIT_MS);
      dying.once("exit", finish);
      const dyingPid = dying.pid;
      try { dying.kill(); } catch { finish(); }
      killProcessTree(dyingPid);
    });
  }

  /** 清掉**本应用二进制**遗留的引擎（上一次实例被强杀 / 旧版本启动序列重叠留下的孤儿）。
   *  两道证据取并集：① 多 pid 台账；② 按可执行文件全路径扫描（旧版本只写单个 pid，会被覆盖）。
   *  ⛔ 只比二进制全路径：三仓（桌面 / PPcode / 云助手）各有自己的安装目录，互不误杀。 */
  private reapStaleEngines() {
    const candidates = new Set<number>(readEnginePids());
    for (const { pid, ppid } of listCodexPidsByBinary(codexBinaryPath())) {
      /* ⛔ 父进程还活着且不是本进程 ⇒ 这是**别的活实例**（e2e / 守卫真跑会拉起真引擎）的引擎，
         动了就会把别人的测试打断；真正的孤儿（应用崩溃后 parent 已退出）才清理。 */
      if (ppid !== process.pid && isProcessAlive(ppid)) continue;
      candidates.add(pid);
    }
    for (const pid of candidates) {
      if (!isCodexProcess(pid)) continue;
      this.debugLog(`[spawn] 清理遗留引擎进程 PID=${pid}（异常退出/重叠启动留下的孤儿，占着会话 writer）`);
      killProcessTree(pid);
    }
    clearEnginePids();
  }

  /** 启动序列（含瞬时失败重试）。`this.launching` 覆盖**整个**序列（含重试间隔）——
   *  期间的进程退出由这里的重试负责，`fail()` 不得并发再拉一次（原因见 fail()）。 */
  private async launch() {
    const token = ++this.launchToken;
    this.launching = true;
    try {
      let lastError: unknown;
      for (let attempt = 1; attempt <= ENGINE_START_ATTEMPTS; attempt++) {
        try {
          await this.launchOnce();
          return;
        } catch (error) {
          lastError = error;
          if (this.stopping) throw error;
          // 已被更新的启动/重启取代（doRestart 刚杀掉本次 spawn 的进程）：立刻让位，
          // 绝不重试出一个马上又会被杀掉的引擎。
          if (token !== this.launchToken) throw error;
          if (attempt < ENGINE_START_ATTEMPTS) {
            const delay = ENGINE_START_RETRY_MS[attempt - 1];
            this.debugLog(`[spawn] 引擎启动失败（第 ${attempt}/${ENGINE_START_ATTEMPTS} 次）：${(error as Error).message} → ${delay}ms 后重试`);
            await new Promise((resolve) => setTimeout(resolve, delay));
            if (token !== this.launchToken) throw lastError;
          }
        }
      }
      // 重试全部用尽：这时候才轮到上层看见"引擎起不来"（上面的每一次失败都被静默消化了）。
      this.emitEvent({ kind: "status", status: "error", message: (lastError as Error)?.message ?? String(lastError) });
      throw lastError;
    } finally {
      // 只在仍是本次序列时清标志：被取代时新序列已把 launching 置回 true。
      if (token === this.launchToken) this.launching = false;
    }
  }

  private async launchOnce() {
    /* 10-28：首次 spawn 前先清掉**上一个实例**留下的引擎（应用被强杀/崩溃时来不及 stop）。
       证据 = 上次 spawn 写下的 pid 台账；同一 userData 只会有一个实例在跑（单实例锁），
       所以台账里的 pid 必然属于已退出的那个实例 —— 杀掉不会误伤别人的任务。
       ⛔ 10-31 扩成**多 pid 台账 + 二进制全路径扫描**：单 pid 台账会被后一次 spawn 覆盖，
          旧版本里 2 秒 4 次 [spawn] 的事故中最早那个进程根本不在台账上。
       ⛔ 不做这一步，旧引擎会一直握着会话 writer，新实例打开该会话就报
          `thread-store conflict: already has an active writer`（用户 10-28 / 10-31 截图）。 */
    if (!this.reapedPreviousEngine) {
      this.reapedPreviousEngine = true;
      this.reapStaleEngines();
    }
    /* ⛔⛔ 10-31（云助手事故）：每次 spawn 前先把**本次进程里**已经存在的 child 回收掉。
       启动重试 / 启动与重启交错时，上一次尝试 spawn 的进程可能还活着（它的 initialize 被
       doRestart reject，但进程本身没退出）⇒ 直接 spawn 会把它从 this.child 顶掉，
       变成永远没人管的孤儿，占着同一 codex-home 的会话 writer。 */
    await this.reapCurrentChild();
    this.emitEvent({ kind: "status", status: "starting" });
    const binary = codexBinaryPath();
    const spawnEnv: Record<string, string> = {
      ...toolchainEnv(),
      ...this.externalEnv,
      // 内置插件密钥（生图/视觉）：只走 env —— `harness-media.mjs` 那条命令行兜底拿不到
      // Electron safeStorage，只能从这里取（配置文件里现在是密文）。
      ...this.builtinEnv,
      CODEX_HOME: this.codexHome,
      CODEX_HARNESS_API_KEY: this.apiKey,
      CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: "1",
    };
    // ⛔ project_doc_max_bytes（09-26 实测）：引擎读 <cwd>/AGENTS.md 并注入会话上下文，但默认上限
    //   只有 32768 字节，超出部分**静默截断**（不报错、也不加"已截断"提示）。本项目 AGENTS.md
    //   已 64KB ⇒ 尾部一半规则（工具链清单 / 能力清单 / 初始化原则 / 记忆后端…）根本进不了模型，
    //   表现为"规章写了但 agent 不照做"。实测：加此参数后 129890 字节完整注入；且引擎会向上遍历
    //   拼接多级 AGENTS.md，这个上限卡的是**拼接总量**，必须留足余量。
    //   放在子命令之前（`codex -c k=v app-server`）—— app-server 只认全局 -c。
    // ⛔ 10-16 262144 → 524288：AGENTS.md 已长到 131,109 字节（顶部新增「本地产物 vs 云端界面」
    //   判定表后越过了 262144 的一半）⇒ 【172】的 2× 余量判据（引擎还要向上拼接多级 AGENTS.md）
    //   只剩 1.99×，预检在 **HEAD 上就是红的**（非本轮刷新回执引入）。抬到 512KB = 4× 当前文档，
    //   留出继续增长的余量；⛔ 这只是"读得到"，文档仍应克制增长（关键规则往前放）。
    const child = spawn(binary, ["-c", "project_doc_max_bytes=524288", "app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      // toolchainEnv：PATH 里带内置 node/pwsh/npm-global，NODE_PATH 指向 npm 全局
      // node_modules——引擎能直接用 nuphus-mcp；浏览器自动化走外部 ego-browser。
      // 关掉 remote control 轮询：它是 ChatGPT 账号专属功能，本机走 API key 没有登录态，
      // websocket 每秒重试解析偏好并连带触发 auth reload，实测占全部日志的 95%。
      // 这是二进制里的官方内部开关（不在 --help 里），对非登录态环境是安全关闭。
      env: spawnEnv,
    });
    this.child = child;
    /* 台账：崩溃/强杀后下次启动靠它找出"我上次留下的引擎"（见 launchOnce 开头的清理）。
       ⛔ 10-31 起追加进**多 pid** 台账：重叠启动序列留下的每一个 pid 都要留痕，
          否则最早那个永远清不掉。 */
    writeEnginePid(child.pid);
    appendEnginePid(child.pid);
    this.debugLog(`[spawn] HTTPS_PROXY=${spawnEnv.HTTPS_PROXY ?? "(无)"} NO_PROXY=${spawnEnv.NO_PROXY ?? "(无)"} CODEX_HOME=${spawnEnv.CODEX_HOME} provider 相关 env 已注入 ${this.externalEnv.HTTPS_PROXY ? "externalEnv" : "externalEnv 无代理"} | connectorEnv 键=${Object.keys(this.externalEnv).filter((key) => !/^(HTTPS?_PROXY|NO_PROXY|no_proxy)$/.test(key)).join(",") || "(无)"}`);
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
    child.stderr.setEncoding("utf8");
    // stderr 只落盘、**不再转发渲染层**（多会话性能 09-12）：渲染层对 kind:"log" 的事件
    // 在 App.tsx 直接 return 丢弃，转发等于白付一次 IPC 序列化；而引擎 stderr 很密
    // （实测 4 小时 1.4 万条），多会话并行时是纯粹的开销。要排查仍看 engine-debug.log。
    child.stderr.on("data", (message) => { this.debugLog(`[stderr] ${String(message).trim().slice(0, 600)}`); });
    // ⛔⛔ 监听里必须**比对进程身份**：启动重试/重启都会换新进程，旧进程的 exit 若迟到还照样
    //   走 fail()，会把**新的** this.child 误清成 undefined —— 引擎明明活着却被判死，
    //   紧接着的自动重启再叠一个进程上去。只处理"仍是当前那个 child"的事件。
    child.on("error", (error) => {
      if (this.child === child) this.fail(error);
      else this.debugLog(`[spawn] 过期引擎进程 error（已忽略）：${error.message}`);
    });
    child.on("exit", (code) => {
      if (this.child === child) this.fail(new Error(`Codex app-server exited (${code ?? "unknown"})`));
      else this.debugLog(`[spawn] 过期引擎进程退出（已忽略）code=${code ?? "unknown"}`);
    });

    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => this.handleLine(line));

    await this.request("initialize", {
      // ⛔ 版本号取自 `package.json`（发版时唯一要改的地方）：这里曾长期硬编码字面量
      //   ⇒ 0.0.16 只改了 package.json，clientInfo 还停在 0.0.15；10-09 发版清单里它仍要手工对齐。
      //   `app.getVersion()` 在运行时求值（不是模块体），不违反【91】惰性求值纪律。
      clientInfo: { name: "codex_harness_desktop", title: "Codex Harness Desktop", version: app.getVersion() },
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
    // ⛔ 09-24 更正：这里原先写「引擎就绪后由主进程按设置启停看门狗」——**已不成立**。
    // 看门狗 2026-09-09 被整体移除（理由见本文件 fail() 分支的注释：心跳误判会让用户会话
    // 莫名跳回欢迎页），startWatchdog/stopWatchdog 是空实现。主进程那边的调用点仍在，
    // 但什么都不做。真实崩溃恢复不依赖心跳（走 fail() 的进程退出分支无条件拉起一次）。
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
    const pending = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, method, params });
    });
    /* ⛔⛔ 10-29 用户令：会话专属工作区必须建在**这一个入口**。
       `thread/start` 有 10+ 个调用点（渲染层 IPC、专家团成员、委派专家、频道机器人、IM 入口、
       回合摘要…）全走这里；钩子放在 codex:request 只覆盖渲染层那一条 ⇒
       专家团成员会话、委派专家会话全都没有工作区（用户 10-29 追问时才发现的）。
       ⛔ cwd 用引擎回的真实值：专家团成员用 group.workspace、中枢用 boss-home、
         委派用角色工作区 —— 各是各的"项目地址"，不在调用方猜。 */
    if (method !== "thread/start") return pending;
    return pending.then((result) => {
      const started = result as any;
      const threadId = String(started?.thread?.id ?? "");
      const cwd = String(started?.thread?.cwd ?? (params as any)?.cwd ?? "");
      if (threadId && cwd) {
        /* ⛔⛔ 10-30（用户：「调度会话的记忆/归档删除都要跟主会话一样」）：
           `threadCwd` 必须**在这一个入口**登记 —— 它原来只由渲染层那条响应拦截
           （features/codex-ipc.ts 的 thread/start 分支）写入，而**主进程自己发的**
           thread/start（子智能体 / 委派专家 / 团主理人 / 团成员 / 渠道机器人…）全都不经过它
           ⇒ 这些会话的 cwd 永远为空 ⇒ boot 的 turn/started 不记文件快照、
           记忆捕获（captureBuffers 的 cwd）直接静默跳过 —— 它们「跟主会话不一样」的根源之一。
           ⛔ 用引擎回的真实 cwd（started.thread.cwd 优先），与 ensureSessionWorkspace 同源。 */
        if (!threadCwd.get(threadId)) threadCwd.set(threadId, cwd);
        void ensureSessionWorkspace(app.getPath("userData"), threadId, cwd)
          .then((out) => console.log(out.ok
            ? `[sessionspace] 已建工作区：${threadId.slice(0, 8)} → ${out.dir}`
            : `[sessionspace] 未建工作区（${out.reason}）：${threadId.slice(0, 8)}`))
          .catch(() => undefined);
      }
      return result;
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
    const pid = this.child?.pid;
    this.child?.removeAllListeners("exit");
    this.child?.removeAllListeners("error");
    this.child?.kill();
    this.child = undefined;
    /* ⛔ 10-28 用户令「每次关闭应用带着进程一起杀掉，保留干净的后台」：
       `child.kill()` 只结束 app-server 本体，它派生的 pwsh / node / MCP 会变成孤儿并**继续
       占着会话 rollout 的 writer**（下次启动打开同一会话 ⇒ `already has an active writer`）。
       ⇒ 退出一律连树杀一遍（同步执行，保证进程真的死透再让 Electron 退出）。
       ⛔ 10-31：台账里可能不止一个 pid（重叠启动序列留下的）—— 逐个连树杀掉，后台必须干净。 */
    killProcessTree(pid);
    for (const stale of readEnginePids()) {
      if (stale === pid) continue;
      if (isCodexProcess(stale)) killProcessTree(stale);
    }
    clearEnginePids();
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
    // ⛔⛔ 启动序列进行中：由 `launch()` 自己的重试循环负责重拉，这里**必须直接返回**。
    //   否则 `this.restart()` → `start()` 会因为 `this.starting` 仍被那个注定失败的 promise
    //   占用而**把它原样返回**（既不 spawn 也不报错，更不会重试）—— 引擎就此静默停在
    //   "已退出"状态。10-08 事故实测：07:17:17 引擎退出后日志里整整 8 秒没有任何 [spawn]，
    //   期间应用是无引擎的（用户的"重启 Codex 引擎"这一步就是这么失败的）。
    //   ⛔ 状态事件也一并推迟：重试期间的 status:"error" 会让渲染层把状态点打红并清掉
    //   "正在跑"的记账（01-status.tsx），而引擎 300ms 后就会回来 —— 纯属误导。
    if (this.launching) {
      this.debugLog(`[spawn] 启动序列进行中，本次退出交给重试循环处理：${error.message}`);
      return;
    }
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
