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
import { bundledPython, pythonPipReady } from "../toolchain";
import { PIP_COMMON_ARGS, PIP_INDEXES } from "./pip-sources";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import type { HostCaps } from "../runtime/seams";

const LAYA_CHANNELS = ["laya:status", "laya:install", "laya:uninstall", "laya:decide-effort"];

/** 首选源可被环境变量覆盖（自测/代理场景）；其后按共享兜底表顺序（去重）。 */
const PIP_INDEX = process.env.LAYA_PIP_INDEX ?? "";
const LAYA_PIP_SOURCES: readonly string[] = PIP_INDEX
  ? [PIP_INDEX, ...PIP_INDEXES.filter((s) => s !== PIP_INDEX)]
  : PIP_INDEXES;
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

/**
 * userData 目录。10-03 起经 **host 接缝**取（`ctx.get("host").app.getPath`）。
 *
 * ⛔ 保留"取不到就回落 cwd"的宽容口径：原实现是 `app?.getPath?.(...)`（可选链），
 *    为无 Electron 宿主的场景（单测/脚本）留的。接缝取不到时同样回落，行为不变。
 * ⛔ **惰性求值**：只在函数体内取，不在模块体 —— 模块体求值会早于 main.ts 的
 *    `app.setPath("userData", …)`，拿到错的目录（【91】复发防线）。
 */
let hostApp: HostCaps["app"] | null = null;
/** 供 defineFeature 注入接缝；未注入时（单测/脚本）userDataDir 回落 cwd。 */
export function bindLayaHost(app: HostCaps["app"]): void {
  hostApp = app;
}
function userDataDir(): string {
  return hostApp?.getPath?.("userData") ?? process.cwd();
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
  const bin = bundledPython();
  // ⛔ 前置体检（10-01 用户机器实录）：旧版 Python 缺 pip 时 `python -m pip` 直接
  //  `No module named pip` exit 1，日志只剩一行裸路径报错、用户无从下手。
  //  拦在前面并给出可执行指引（同时写进 lastError，卡片状态行也能看到）。
  const pip = pythonPipReady(bin);
  if (!pip.ok) {
    lastError = pip.reason;
    log(pip.reason);
    return Promise.resolve({ ok: false, log: pip.reason });
  }
  installing = true;
  const lines: string[] = [];
  /**
   * 跑一次 pip（单个源），返回退出码与「是否真装成」。
   * ⛔⛔ 10-02 用户报障：清华源的索引页正常但 wheel 直链 403 ⇒ 单源必挂；
   *   pip 不会自己换 index（`--extra-index-url` 也不救），只能整个命令换源重跑。
   *   进度状态在每轮开始时重置，界面看到的是「当前这轮」的进度。
   */
  const runPip = (index: string) => new Promise<{ code: number; installed: boolean }>((done) => {
    installProgress = { phase: "download", current: "", percent: 0, speed: "", detail: "" };
    const child = spawn(bin, ["-m", "pip", "install", "-U", ...PIP_COMMON_ARGS, "--progress-bar", "on", "-i", index, "laya[serve]"], {
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
      clearTimeout(timer);
      lines.push(String(err));
      done({ code: -1, installed: false });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      lines.push(`pip install → exit ${code}`);
      done({ code: typeof code === "number" ? code : -1, installed: pipShow().installed });
    });
  });
  return (async () => {
    const tried: string[] = [];
    for (let i = 0; i < LAYA_PIP_SOURCES.length; i++) {
      const index = LAYA_PIP_SOURCES[i];
      if (i > 0) log(`换个源再试（${i + 1}/${LAYA_PIP_SOURCES.length}）：${index}`);
      const { code, installed } = await runPip(index);
      if (code === 0 && installed) {
        installing = false;
        if (i > 0) log(`pip 改用源成功：${index}`);
        // 装成即后台预热（拉起 laya-serve + 下载权重 ~700MB）：进度在设置页 Laya 卡片实时可见，
        // 等用户真发消息时服务已就绪——发送链的判定才配得上「立刻透出来」。
        void ensureService().catch((err) => log(`安装后预热失败: ${String(err).slice(0, 120)}`));
        return { ok: true, log: lines.join("\n") };
      }
      tried.push(`${index} → exit ${code}`);
      // 走到最后一个源仍失败：把**每个源**的结果都写出来（别让用户对着一个 403 猜）
      if (i === LAYA_PIP_SOURCES.length - 1) {
        lastError = `pip 源都不通（共试 ${LAYA_PIP_SOURCES.length} 个）：\n${tried.join("\n")}`;
        lines.push(lastError);
      }
    }
    installing = false;
    return { ok: false, log: lines.join("\n") };
  })();
}

/**
 * 卸载 Laya（10-01 用户：「layade 卸载按键呢」——内置/按需工具都要能真卸载）。
 * 顺序：先停服务进程（否则 Windows 上文件被占用删不干净）→ pip uninstall -y laya。
 * ⛔ 模型权重缓存在用户级 HF 缓存目录（~/.cache/huggingface），**不随卸载删除**：
 *   那是共享缓存，别的工具也可能用同一份；要彻底清空间由用户自己删该目录即可。
 */
export function layaUninstall(): Promise<{ ok: boolean; log: string }> {
  killService("卸载 Laya");
  const bin = bundledPython();
  const pip = pythonPipReady(bin);
  if (!pip.ok) {
    lastError = pip.reason;
    log(pip.reason);
    return Promise.resolve({ ok: false, log: pip.reason });
  }
  const lines: string[] = [];
  log("开始卸载 laya");
  return new Promise((resolve) => {
    const child = spawn(bin, ["-m", "pip", "uninstall", "-y", "laya"], {
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      windowsHide: true,
    });
    let buffered = "";
    const pump = (chunk: string) => {
      buffered += chunk;
      const parts = buffered.split(/\r\n|\r|\n/);
      buffered = parts.pop() ?? "";
      for (const raw of parts) {
        const line = raw.trim();
        if (!line) continue;
        lines.push(line);
        log(`pip(uninstall): ${line.slice(0, 160)}`);
      }
    };
    child.stdout?.on("data", (d) => pump(String(d)));
    child.stderr?.on("data", (d) => pump(String(d)));
    const timer = setTimeout(() => child.kill(), 5 * 60 * 1000);
    child.on("error", (err) => {
      clearTimeout(timer);
      lastError = String(err);
      resolve({ ok: false, log: lines.concat(String(err)).join("\n") });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      lines.push(`pip uninstall → exit ${code}`);
      const { installed } = pipShow();
      // ⛔ 只看退出码会假绿：pip 有时 exit 0 但包还在（多环境/被占用）。以**复核结果**为准。
      const ok = !installed;
      if (ok) lastError = "";
      resolve({ ok, log: lines.join("\n") });
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

/* ── 判定结果解析（10-05 校准实测，scripts/calibrate-laya-kb.mjs）──────────────
   ⛔⛔ 置信度必须读 `answer_confidence`（= 所选答案的校准概率，实测定标 0.6~0.9 档）——
   `confidence` 是**行动门限**（实测可能低到 0.10），拿它当判定置信会把全部判断弃权掉。
   answer_confidence 缺失时回落 probabilities[choice]，再回落 confidence（老版本兼容）。 */
function parseVerdict(ans: unknown, criteria: Record<string, string>): { choice: string; confidence: number } | null {
  const a = ans as { choice?: string; confidence?: number; answer_confidence?: number; probabilities?: Record<string, number> } | undefined;
  const choice = String(a?.choice ?? "").toLowerCase();
  if (!(choice in criteria)) return null;
  const confidence = Number(a?.answer_confidence ?? a?.probabilities?.[choice] ?? a?.confidence ?? 0);
  return { choice, confidence };
}

/**
 * 通用单问判断（知识库写入门禁 / 检索重排等**软增强**用，10-04 用户拍板「未装照旧、装了增强」）：
 * 服务已就绪才判；未就绪 / 超时 / 低置信 / 答案不在 criteria 里 ⇒ 一律返回 null（fail-open，
 * 调用方必须把 null 当「弃权放行」处理，绝不因判断不可用而丢功能）。
 * ⛔ 沿用思考档同款延迟纪律：**不为一次判断拉起 1.7GB 服务**——未就绪只后台预热、立刻弃权。
 */
export async function layaJudge(
  text: string,
  question: { instructions: string; criteria: Record<string, string> },
  options: { minConfidence?: number; timeoutMs?: number } = {},
): Promise<{ choice: string; confidence: number } | null> {
  if (!proc || !ready) {
    void ensureService().catch((err) => log(`预热失败: ${String(err).slice(0, 120)}`));
    return null;
  }
  const minConfidence = options.minConfidence ?? 0.5;
  const run = (async () => {
    const answers = await layaDecide(text.slice(0, 4000), {
      judge: { type: "choice", instructions: question.instructions, criteria: question.criteria },
    });
    const verdict = parseVerdict(answers.judge, question.criteria);
    if (!verdict || !(verdict.confidence >= minConfidence)) return null;
    return verdict;
  })();
  return Promise.race([
    run,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), options.timeoutMs ?? 2_000)),
  ]);
}

/**
 * 批量判断（10-04 检索全过滤 / 重复拦截用）：同一个 state 一次 HTTP 带**多个问题**
 * （layaDecide 协议原生支持 answers 按名字返回）——N 条候选的逐条判断只有一次往返。
 * 返回值只含「答了、选项合法、过了置信线」的问题，缺席 = 弃权（fail-open，调用方按"保留"处理）。
 * ⛔ 与 layaJudge 同款延迟纪律：未就绪只预热并返回空对象，绝不为此拉起服务。
 */
export async function layaJudgeAll(
  text: string,
  questions: Record<string, { instructions: string; criteria: Record<string, string> }>,
  options: { minConfidence?: number; timeoutMs?: number } = {},
): Promise<Record<string, { choice: string; confidence: number }>> {
  if (!proc || !ready) {
    void ensureService().catch((err) => log(`预热失败: ${String(err).slice(0, 120)}`));
    return {};
  }
  const minConfidence = options.minConfidence ?? 0.5;
  const run = (async () => {
    const payload: Record<string, unknown> = {};
    for (const [name, q] of Object.entries(questions)) {
      payload[name] = { type: "choice", instructions: q.instructions, criteria: q.criteria };
    }
    const answers = await layaDecide(text.slice(0, 4000), payload);
    const out: Record<string, { choice: string; confidence: number }> = {};
    for (const [name, q] of Object.entries(questions)) {
      const verdict = parseVerdict(answers[name], q.criteria);
      if (!verdict || !(verdict.confidence >= minConfidence)) continue;
      out[name] = verdict;
    }
    return out;
  })();
  return Promise.race([
    run,
    new Promise<Record<string, { choice: string; confidence: number }>>((resolve) => setTimeout(() => resolve({}), options.timeoutMs ?? 3_000)),
  ]);
}

/** 应用退出时收服务进程。 */
export function layaShutdown() {
  killService("应用退出");
}

/* ── 插件入口（10-03：模块体裸注册 → defineFeature）────────────────────────
   4 条通道 + will-quit 订阅都收进 setup()：卸载时 ctx.effect 会摘掉 will-quit 钩子，
   不会像原先 `app.on(...)` 那样留在 app 上（泄漏 + 再挂一次重复触发）。 */
export const layaFeature = defineFeature<null>({
  id: "laya",
  inject: ["ipc", "host"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    const host = ctx.get<HostCaps>("host");
    if (!ipcHost) throw new Error("laya: 缺少 ipc 服务（宿主未提供）");
    if (!host) throw new Error("laya: 缺少 host 接缝（宿主未提供）");
    const appHost = host.app;
    // 供模块级函数（userDataDir）惰性取用 —— 保持"模块体不求值"的【91】防线
    bindLayaHost(appHost);

    ipcHost.handle("laya:status", () => layaStatus());
    ipcHost.handle("laya:install", () => layaInstall());
    ipcHost.handle("laya:uninstall", () => layaUninstall());
    ipcHost.handle("laya:decide-effort", (_event, text: unknown) => layaDecideEffort(String(text ?? "")));

    // ⛔ 10-03：will-quit 订阅的**退订函数**必须交给 ctx.effect —— 插件卸载时随容器一起释放。
    //    直接 app.on(...) 不注册退订 = 域卸载后钩子仍在（泄漏，且再挂一次会重复触发）。
    ctx.effect(() => appHost.on("will-quit", () => layaShutdown()));

    // 卸载即摘通道
    ctx.effect(() => {
      for (const ch of LAYA_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
