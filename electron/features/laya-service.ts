/**
 * Laya 智能判断 · 服务管理（10-01 用户立项：「内置一个 laya 判断模型，自动切换思考等级」）
 *
 * Laya = GitHub NandhaKishorM/laya（Apache 2.0）：非自回归 System 1 决策引擎，
 * 单次前向 ~33ms 输出结构化决策（choice/score/noul），零文本生成零幻觉，中文走
 * multilingual checkpoint（mmBERT-base，100+ 语言）。官方 HTTP 服务 = laya-serve
 * （`pip install laya[serve]`，Jev 兼容 POST /v1/systemone 协议，全部配置走环境变量）。
 *
 * 生命周期（省内存）：
 *   安装（pip 清华镜像）→ **懒启动**（首次 decide 才拉起服务）→ 闲置 10 分钟自动退出 →
 *   下次请求再拉起。权重（multilingual safetensors ~700MB）由 laya 在首启时经
 *   huggingface_hub 下载，走 **hf-mirror**（HF_ENDPOINT）——国内网络必需。
 *
 * ⛔ 安全：服务只绑 127.0.0.1 + 随机 API key（存 userData/laya-key.txt）——官方默认
 *   绑 0.0.0.0 且无鉴权，绝不能照抄。
 * ⛔ 决策失败一律降级：调用方（思考等级自动切换）拿不到结果就用用户手选档——
 *   判断器是增强，不是依赖。
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import crypto from "node:crypto";
import { app } from "electron";
import { bundledPython } from "../toolchain";

const PIP_INDEX = process.env.LAYA_PIP_INDEX ?? "https://pypi.tuna.tsinghua.edu.cn/simple";
const HF_ENDPOINT = process.env.LAYA_HF_ENDPOINT ?? "https://hf-mirror.com";
const IDLE_EXIT_MS = 10 * 60 * 1000; // 闲置 10 分钟自动退出（省 ~1GB 内存）
const START_TIMEOUT_MS = 30 * 60 * 1000; // 首启含权重下载，放宽到 30 分钟
const DECIDE_TIMEOUT_MS = 15_000;

export type LayaProgress = {
  phase: string;     // download（下载包/权重）/ install（pip 落盘）
  current: string;   // 当前包名或权重文件名
  percent: number;   // 0-100（当前这一项的进度）
  speed: string;     // 如 "3.4MB/s"（pip/下载器原始输出）
  detail: string;    // 如 "45.2 MB / 78.0 MB"
};

export type LayaServiceState = {
  installed: boolean;      // pip 包 laya[serve] 已装
  version: string;         // laya 版本号（未装为空）
  running: boolean;        // 服务进程在跑
  ready: boolean;          // /health 200（权重就绪，可判断）
  port: number;
  installing: boolean;
  starting: boolean;
  lastError: string;
  installProgress: LayaProgress | null;  // pip 安装实时进度（下载百分比/速度）
  startProgress: LayaProgress | null;    // 首启权重下载实时进度（~700MB）
};

let proc: ChildProcess | null = null;
let port = 0;
let apiKey = "";
let ready = false;
let installing = false;
let starting = false;
let lastUsedAt = 0;
let idleTimer: NodeJS.Timeout | null = null;
let lastError = "";
let serviceLog: string[] = [];
let installProgress: LayaProgress | null = null;
let startProgress: LayaProgress | null = null;

function userDataDir(): string {
  return app?.getPath?.("userData") ?? process.cwd();
}

function keyFile(): string {
  return path.join(userDataDir(), "laya-key.txt");
}

function ensureApiKey(): string {
  if (apiKey) return apiKey;
  try {
    const saved = fs.readFileSync(keyFile(), "utf8").trim();
    if (saved.length >= 16) { apiKey = saved; return apiKey; }
  } catch { /* 首次没有 */ }
  apiKey = crypto.randomBytes(24).toString("hex");
  try { fs.writeFileSync(keyFile(), apiKey, "utf8"); } catch { /* 写失败则本次进程内用临时 key */ }
  return apiKey;
}

/** 端口探测：从 47901 起找第一个空闲口（每次启动固定用同一个，除非被占）。 */
async function pickPort(): Promise<number> {
  for (let p = 47901; p < 47931; p++) {
    const free = await new Promise<boolean>((resolve) => {
      const s = net.createServer();
      s.once("error", () => resolve(false));
      s.once("listening", () => s.close(() => resolve(true)));
      s.listen(p, "127.0.0.1");
    });
    if (free) return p;
  }
  return 47901;
}

function log(line: string) {
  serviceLog.push(`[${new Date().toLocaleTimeString("zh-CN")}] ${line}`);
  if (serviceLog.length > 200) serviceLog.splice(0, serviceLog.length - 200);
}

/** pip 包 laya 是否已装（含版本）。 */
function pipShow(): { installed: boolean; version: string } {
  const bin = bundledPython();
  try {
    const out = require("node:child_process").execFileSync(bin, ["-m", "pip", "show", "laya"], { encoding: "utf8", timeout: 30_000 });
    const ver = /Version:\s*(\S+)/.exec(out)?.[1] ?? "";
    return { installed: true, version: ver };
  } catch {
    return { installed: false, version: "" };
  }
}

export function layaStatus(): LayaServiceState {
  const { installed, version } = pipShow();
  return {
    installed,
    version,
    running: Boolean(proc && !proc.killed),
    ready,
    port,
    installing,
    starting,
    lastError,
    installProgress: installing ? installProgress : null,
    startProgress: starting ? startProgress : null,
  };
}

/** 近期服务日志（设置页排障展示）。 */
export function layaLog(): string {
  return serviceLog.slice(-40).join("\n");
}

/** 从 pip / huggingface 下载器的一行输出里提取进度（解析失败静默忽略——进度条只是增强）。 */
function parseProgress(line: string, into: LayaProgress): void {
  const collecting = /Collecting\s+(\S+)/.exec(line);
  if (collecting) { into.phase = "download"; into.current = collecting[1].replace(/\[.*/, ""); into.percent = 0; into.speed = ""; into.detail = ""; return; }
  const downloading = /Downloading\s+(\S+?)\s*\(([\d.]+)\s*([KM]B)\)/.exec(line);
  if (downloading) { into.phase = "download"; into.current = downloading[1].split("-")[0]; into.percent = 0; into.speed = ""; into.detail = `${downloading[2]} ${downloading[3]}`; return; }
  if (/Installing collected packages|To update pip|Successfully installed/.test(line)) { into.phase = "install"; into.percent = 100; into.speed = ""; return; }
  // 进度条行：` 45%|████ | 45.2/78.0 MB [00:12<00:20, 3.4MB/s]` 或 hf 的 `model.safetensors:  45%|...`
  const bar = /(\d{1,3}(?:\.\d+)?)%/.exec(line);
  if (!bar) return;
  const pct = Number(bar[1]);
  if (pct < 0 || pct > 100) return;
  const frac = /([\d.]+)\s*\/\s*([\d.]+)\s*([KM]?B)/.exec(line);
  const speed = /([\d.]+\s*[KM]?B\/s)/.exec(line)?.[1] ?? "";
  // 文件名线索：hf 下载条形如 `model.safetensors:  45%|...`；pip 是裸条
  const file = /^\s*([\w.\-]+\.(?:safetensors|bin|whl|json|model))\s*:\s*/.exec(line)?.[1];
  into.phase = "download";
  into.percent = pct;
  into.speed = speed;
  if (file) into.current = file;
  if (frac) into.detail = `${frac[1]} / ${frac[2]} ${frac[3]}`;
}

/** 安装 / 更新 laya[serve]（清华 pip 镜像；torch 体积大，超时放宽 20 分钟）。 */
export function layaInstall(): Promise<{ ok: boolean; log: string }> {
  if (installing) return Promise.resolve({ ok: false, log: "已有安装任务在进行中" });
  installing = true;
  installProgress = { phase: "download", current: "", percent: 0, speed: "", detail: "" };
  const bin = bundledPython();
  const lines: string[] = [];
  return new Promise((resolve) => {
    const child = spawn(bin, ["-m", "pip", "install", "-U", "--no-input", "--progress-bar", "on", "-i", PIP_INDEX, "laya[serve]"], {
      env: { ...process.env },
      windowsHide: true,
    });
    // ⛔ pip 的进度条写在 stderr 且用 \r 原地刷新（不换行）——按 \r 与 \n 一起切行，
    //   否则整段进度被吞进 buffer 永远不出来（10-01 用户实测「安装进度没有」的根因）。
    let buffered = "";
    const pump = (chunk: string) => {
      buffered += chunk;
      const parts = buffered.split(/\r\n|\r|\n/);
      buffered = parts.pop() ?? "";
      for (const raw of parts) {
        const line = raw.trim();
        if (!line) continue;
        lines.push(line);
        if (!/^\s*\d{1,3}%/.test(raw)) log(`pip: ${line.slice(0, 160)}`); // 进度条刷屏行不进日志
        if (installProgress) parseProgress(line, installProgress);
      }
    };
    child.stdout.on("data", (d) => pump(String(d)));
    child.stderr.on("data", (d) => pump(String(d)));
    const timer = setTimeout(() => child.kill(), 20 * 60 * 1000);
    child.on("error", (err) => {
      clearTimeout(timer); installing = false;
      lastError = String(err);
      resolve({ ok: false, log: lines.concat(String(err)).join("\n") });
    });
    child.on("close", (code) => {
      clearTimeout(timer); installing = false;
      lines.push(`pip install → exit ${code}`);
      const { installed } = pipShow();
      // 装成即后台预热（拉起 laya-serve + 下载权重 ~700MB）：进度在设置页 Laya 卡片实时可见，
      // 等用户真发消息时服务已就绪——发送链的判定才配得上「立刻透出来」。
      if (installed) void ensureService().catch((err) => log(`安装后预热失败: ${String(err).slice(0, 120)}`));
      resolve({ ok: code === 0 && installed, log: lines.join("\n") });
    });
  });
}

function killService(reason: string) {
  if (proc) {
    log(`服务退出（${reason}）`);
    try { proc.kill(); } catch { /* 已死忽略 */ }
    proc = null;
  }
  ready = false;
  startProgress = null;
  if (idleTimer) { clearInterval(idleTimer); idleTimer = null; }
}

/** serve 日志泵：进日志 + 解析权重下载进度（hf 下载条在 stderr，同样 \r 刷新）。 */
function pumpServe(chunk: string) {
  for (const raw of String(chunk).split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (!/^\s*\d{1,3}%/.test(raw)) log(`serve: ${line.slice(0, 160)}`);
    if (!startProgress) return;
    const bar = /(\d{1,3}(?:\.\d+)?)%/.exec(line);
    if (bar) parseProgress(line, startProgress);
    else if (/Downloading|Fetching \d+ files/.test(line)) startProgress.current = "模型权重（~700MB，走 hf-mirror）";
  }
}

/** 懒启动 laya-serve（127.0.0.1 + API key + 只预载 multilingual + hf-mirror 拉权重）。 */
async function ensureService(): Promise<number> {
  if (proc && !proc.killed) return port;
  if (starting) throw new Error("Laya 服务正在启动中（首次会下载权重，请稍候）");
  const { installed } = pipShow();
  if (!installed) throw new Error("laya 未安装——请先在 设置 → 开发工具 里安装");
  starting = true;
  ready = false;
  startProgress = { phase: "download", current: "", percent: 0, speed: "", detail: "" };
  try {
    port = await pickPort();
    const key = ensureApiKey();
    const bin = bundledPython();
    log(`启动 laya-serve :${port}（${bin}）`);
    // ⛔ 用 python -c 兜底：console script（Scripts/laya-serve.exe）可能不在 PATH 上（phone-harness 同款经验）
    proc = spawn(bin, ["-c", "from laya.serve import main; main()"], {
      env: {
        ...process.env,
        LAYA_HOST: "127.0.0.1",
        LAYA_PORT: String(port),
        LAYA_API_KEY: key,
        LAYA_MODELS: "multilingual", // 只预载中文 checkpoint（省内存；英文场景 Route 到它也能答）
        LAYA_PRELOAD: "1",
        LAYA_THREADS: "4",
        HF_ENDPOINT, // ⛔ 权重下载走 hf-mirror（国内直连 HF 不通）
        PYTHONIOENCODING: "utf-8",
      },
      windowsHide: true,
    });
    proc.stdout?.on("data", (d) => pumpServe(String(d)));
    proc.stderr?.on("data", (d) => pumpServe(String(d)));
    proc.on("exit", (code) => {
      log(`服务进程退出（code=${code}）`);
      proc = null;
      ready = false;
    });
    // 就绪轮询：LAYA_PRELOAD=1 ⇒ 首启要下载权重（~700MB），可能 10-30 分钟
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (!proc || proc.killed) throw new Error("Laya 服务进程异常退出");
      if (await healthOk()) { ready = true; break; }
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (!ready) { killService("启动超时"); lastError = "启动超时（首次需下载 ~700MB 权重，检查网络后重试）"; throw new Error(lastError); }
    lastUsedAt = Date.now();
    // 闲置自动退出（省内存）
    if (idleTimer) clearInterval(idleTimer);
    idleTimer = setInterval(() => {
      if (Date.now() - lastUsedAt > IDLE_EXIT_MS) killService("闲置超时");
    }, 60_000);
    return port;
  } finally {
    starting = false;
  }
}

async function healthOk(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch { return false; }
}

/** 决策：state + questions → Jev 形状的 answers。失败 throw（调用方降级）。 */
export async function layaDecide(state: string, questions: Record<string, unknown>): Promise<Record<string, unknown>> {
  await ensureService();
  lastUsedAt = Date.now();
  const res = await fetch(`http://127.0.0.1:${port}/v1/systemone`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ensureApiKey()}` },
    body: JSON.stringify({ state, questions, model: "multilingual" }),
    signal: AbortSignal.timeout(DECIDE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`laya HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { answers?: Record<string, unknown> };
  return json.answers ?? {};
}

/**
 * 思考等级专用判断（渲染层「自动」档的入口）：
 * state = 用户消息（截 4000 字），输出 low/medium/high/xhigh + confidence。
 * 置信度 < 0.45 ⇒ abstain（返回 null，调用方回落手选档）——Laya 的置信度是校准过的，
 * 低置信硬判不如不判（README 的 gating 惯例：≥0.85 自动执行，这里放宽到「低于就弃权」）。
 *
 * ⛔⛔ 延迟纪律（10-01 用户实测教训：「自动档要立刻透出来，延迟高就没用了」）：
 *   ① **只用已就绪的服务，绝不为了挑一档去拉起服务**（首启要下 700MB 权重）——
 *     未就绪就弃权 null，同时后台预热（下次发消息就能真判）；
 *   ② 3 秒硬超时兜底（服务就绪时判定 ~200ms，3s 都到不了说明环境有病，弃权）；
 *   发送链**永远不等模型**。
 */
/* ── 混合判定：升档锚点（确定性规则，0ms）────────────────────────
 * 10-01 实测定标（6 档难度 × 4 种问法：中文四选/英文四选/score 列表/noul 阶梯）：
 * multilingual checkpoint 对「中以上」**系统性压缩**——极难任务在各种问法下都输出
 * medium（score 甚至给极难打的分低于难）。它的可靠区间 = 极易(low，置信 0.8+) vs
 * 其余(medium)。因此分工：**laya 只判低端**（33ms 强项），升到 high/xhigh 由确定性
 * 规则锚点负责（0ms，宁高档不低档——用户明确要求难任务必须升上去）。
 * 规则命中 ⇒ 直接返回，连 laya 都不调；未命中才问 laya（low/medium 分辨）。 */
const TRIVIAL_RE = /错别字|拼写|typo|格式化|注释|文案|翻译/i;
const XHIGH_SIGNALS = [/重构/, /架构/, /模块树/, /拆分|拆成/, /迁移/, /全仓/, /整个项目/, /大规模/, /系统性/, /系统设计|设计.{0,12}系统|调度系统/, /从零(实现|搭建)/, /上千行|上万行/];
const HIGH_SIGNALS = [/多文件/, /多个文件/, /跨模块/, /几个文件/, /原因不明/, /根因/, /排查/, /历史.{0,4}(数据|链路)/, /联调/, /竞态/, /并发.{0,6}(问题|bug|冲突)/];

function ruleEscalate(text: string): string | null {
  if (TRIVIAL_RE.test(text) && text.length <= 40) return null; // 一目了然的小修永不升档
  if (XHIGH_SIGNALS.some((r) => r.test(text))) return "xhigh";
  // 灵敏度拉满（10-01 用户定标）：单个高危信号即升 high——宁高档不低档
  if (HIGH_SIGNALS.some((r) => r.test(text))) return "high";
  return null;
}

const DECIDE_EFFORT_TIMEOUT_MS = 3_000;

export async function layaDecideEffort(text: string): Promise<{ effort: string; confidence: number } | null> {
  // ① 规则锚点先行（0ms；命中即连模型都不调）
  const rule = ruleEscalate(text);
  if (rule) return { effort: rule, confidence: 0.6 };
  // ② laya 判低端：只用已就绪服务（⛔ 不为挑档拉起 1.7GB 服务），未就绪弃权 + 后台预热
  if (!proc || !ready) {
    void ensureService().catch((err) => log(`预热失败: ${String(err).slice(0, 120)}`));
    return null;
  }
  const run = (async () => {
    const answers = await layaDecide(text.slice(0, 4000), {
      effort: {
        type: "choice",
        instructions: "用户即将给 AI 编程助手发这条消息。按完成它需要的推理深度选一档思考强度。",
        criteria: {
          low: "改错别字、格式化、一句话小修、简单问答，几乎不动脑",
          medium: "日常开发、改一个函数、排查一个明确的小问题",
          high: "多文件改动、原因不明的 bug、需要仔细分析的任务",
          xhigh: "大型重构、架构设计、极难的问题、长链路多步任务",
        },
      },
    });
    const ans = answers.effort as { choice?: string; confidence?: number } | undefined;
    const choice = String(ans?.choice ?? "").toLowerCase();
    const confidence = Number(ans?.confidence ?? 0);
    if (!["low", "medium", "high", "xhigh"].includes(choice)) return null;
    if (!(confidence >= 0.45)) return null;
    return { effort: choice, confidence };
  })();
  return Promise.race([
    run,
    new Promise<null>((resolve) => setTimeout(() => { log("effort 判定超时（3s），弃权回落手选档"); resolve(null); }, DECIDE_EFFORT_TIMEOUT_MS)),
  ]);
}

/** 应用退出时收服务进程。 */
export function layaShutdown() {
  killService("应用退出");
}

/* ── IPC 接线（laya 域 3 条）───────────────────────────────────────── */
import { ipcMain } from "electron";

ipcMain.handle("laya:status", () => layaStatus());
ipcMain.handle("laya:install", () => layaInstall());
ipcMain.handle("laya:decide-effort", (_event, text: unknown) => layaDecideEffort(String(text ?? "")));

app.on("will-quit", () => layaShutdown());
