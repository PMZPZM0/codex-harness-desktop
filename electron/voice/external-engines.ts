/**
 * 开源语音引擎：按需下载、启停、本机服务与合成适配（11-16 用户令）
 *
 * 现状：
 *  · 卡片目录在 `src/lib/voice-external-engines.mjs`（主进程/渲染层共用一份）。
 *  · 已真接入 6 个：GPT-SoVITS（官方便携包）、CosyVoice 3（源码 + venv + ModelScope 权重），
 *    以及 11-16 第二批 F5-TTS / Chatterbox / Qwen3-TTS(0.6B) / IndexTTS2（通用 Python 安装器）。
 *  · Fish Speech（4B 需更大显存）与 Zonos（官方不支持 Windows）只出卡片，不接管播报。
 *
 * ⛔ 不随包、不内置权重：全部下载到 `<userData>/voice-engines/`；下载/解压/安装都有进度事件。
 * ⛔ 同一时间只允许一个外部引擎处于启用态（8GB 显存跑不动两个），切换时先停旧服务。
 * ⛔ 服务只监听 127.0.0.1；spawn 一律参数数组、不开 shell。
 * ⛔ 路径惰性求值：模块体早于 `app.setPath("userData")`。
 */
import { app } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { externalEngineById, VOICE_EXTERNAL_ENGINES } from "../../src/lib/voice-external-engines.mjs";
import type { VoiceExternalEngine } from "../../src/lib/voice-external-engines.mjs";
import { toolsRoot } from "../toolchain";
import { mirrorCandidates } from "../gh-mirror";
import { listBundledVoices, readBuiltinVoice, readBundledVoice } from "./builtin-voices";
import { purgeDirWithProgress } from "./model-purge";

type InstalledInfo = { dir: string; adapter: string; installedAt: number; version?: string };
type ExternalState = { version: 1; installed: Record<string, InstalledInfo>; active: string };
type ExternalService = { state: "stopped" | "starting" | "running" | "error"; error?: string; child: ChildProcess | null; starting: Promise<void> | null };

export type ExternalProgressEvent = { id: string; kind: "download" | "downloadDone" | "remove" | "removeDone" | "service"; percent: number; message: string; ok?: boolean; error?: string; service?: string };

const SERVICES = new Map<string, ExternalService>();
let progressSink: ((event: ExternalProgressEvent) => void) | null = null;
let installLock: string | null = null;
const cancels = new Map<string, AbortController>();
const PORTS: Record<string, number> = {
  "gpt-sovits": 19880,
  "cosyvoice3": 19881,
  chatterbox: 19883,
  "qwen3-tts": 19884,
};
/** 走「通用 Python 适配器」（POST /speak）的引擎。 */
const PY_ADAPTERS = new Set(["chatterbox", "qwen3-tts"]);
/** 自带默认音色（模型自己带条件向量，无需参考音频）的引擎 —— 目前只有 Chatterbox（models/conds.pt）。 */
const NATIVE_VOICE_ENGINES = new Set(["chatterbox"]);
/** 向适配器表示「用引擎自带音色」的哨兵（避免改所有适配器的请求协议）。 */
const NATIVE_REF = "@native";
/** HuggingFace 在国内不可直连；模型文件与运行时下载一律走镜像。 */
const HF_ENDPOINT = "https://hf-mirror.com";
/** 各适配器首次启动要加载模型（Chatterbox/IndexTTS 更大），给足冷启动时间。 */
const SERVICE_TIMEOUT: Record<string, number> = {
  "gpt-sovits": 180_000,
  cosyvoice3: 240_000,
  chatterbox: 600_000,
  "qwen3-tts": 420_000,
};

/** 设置进度回调（IPC 段转成 voice:event 的 download 事件）。 */
export function setExternalProgressSink(sink: ((event: ExternalProgressEvent) => void) | null): void {
  progressSink = sink;
}

function userDataDir(): string { return app.getPath("userData"); }
function enginesRoot(): string { return join(userDataDir(), "voice-engines"); }
function engineDir(id: string): string { return join(enginesRoot(), id); }
function stateFile(): string { return join(userDataDir(), "voice-external-engines.json"); }

function loadState(): ExternalState {
  try {
    const raw = JSON.parse(readFileSync(stateFile(), "utf8"));
    if (raw && typeof raw === "object" && raw.installed && typeof raw.installed === "object") {
      return { version: 1, installed: raw.installed, active: String(raw.active ?? "") };
    }
  } catch { /* 首次运行 */ }
  return { version: 1, installed: {}, active: "" };
}

function saveState(state: ExternalState): void {
  try {
    mkdirSync(dirname(stateFile()), { recursive: true });
    const tmp = stateFile() + ".tmp";
    writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    renameSync(tmp, stateFile());
  } catch { /* 写不了就只保留内存态（下次启动丢失安装标记） */ }
}

/**
 * 当前平台是否支持该引擎（11-17 mac 适配）。
 * ⛔ 四个可安装引擎的安装器与推理后端都按 **Windows + CUDA** 适配：Windows 便携包 / Windows venv
 *   （`.venv\Scripts\python.exe`）/ `--torch-backend=cu*`。mac 上不能用 —— 目录里不写 platforms 的
 *   （纯展示卡片）按全平台处理；mac 仍可用基础模型 + MOSS + 随包默认音色。
 */
function supportsPlatform(entry: VoiceExternalEngine): boolean {
  const platforms = (entry as { platforms?: string[] }).platforms;
  return !platforms || platforms.includes(process.platform);
}

/** 推送事件（安装进度 / 服务状态）。 */
function emit(event: ExternalProgressEvent): void {
  try { progressSink?.(event); } catch { /* 渲染层关掉不影响安装 */ }
}

/** 服务状态推进推给渲染层：否则卡片只会在开弹窗时刷新，永远停在「启动中…」（用户实测）。 */
function emitService(id: string, service: ExternalService): void {
  emit({ id, kind: "service", percent: 0, message: "", service: service.state, error: service.error });
}

/**
 * 某个引擎的「开箱默认音色」（11-17 用户令「每个语音模型都加几个默认音色」）：
 *  · Chatterbox 用它自带的默认音色（models/conds.pt，无需参考音频）；
 *  · 其余克隆型引擎用**随包默认音色**（resources/voice-presets，不依赖本机基础模型）。
 */
export function externalEngineDefaultVoice(id: string): string {
  if (NATIVE_VOICE_ENGINES.has(id)) return "native";
  const first = listBundledVoices()[0];
  return first ? `preset:${first.id}` : "";
}

/** 某个引擎当前实际生效的音色（按引擎独立 + 老档案回退 + 默认音色）。 */
export function externalEngineEffectiveVoice(
  id: string,
  tts?: { engineVoices?: Record<string, string>; engineVoice?: string }
): string {
  let choice = String(tts?.engineVoices?.[id] ?? "").trim();
  if (!choice) {
    const legacy = String(tts?.engineVoice ?? "").trim();
    /* `native` 只对自带音色的引擎有效；老档案里它可能是别的引擎选的，别串到克隆引擎上。 */
    if (legacy && (legacy !== "native" || NATIVE_VOICE_ENGINES.has(id))) choice = legacy;
  }
  return choice || externalEngineDefaultVoice(id);
}

/** 目录 + 安装/启用/服务状态（渲染层卡片直接消费）。 */
export function externalEngineList() {
  const state = loadState();
  return {
    engines: VOICE_EXTERNAL_ENGINES.map((entry) => {
      const installed = state.installed[entry.id];
      const service = SERVICES.get(entry.id);
      return {
        ...entry,
        installed: Boolean(installed),
        installedVersion: installed?.version ?? "",
        dir: installed?.dir ?? "",
        enabled: state.active === entry.id,
        active: state.active,
        service: service?.state ?? "stopped",
        serviceError: service?.error ?? "",
        /* 11-17：自带默认音色的引擎（卡片音色下拉里多一项「默认音色」）。 */
        nativeVoice: NATIVE_VOICE_ENGINES.has(entry.id),
        /* 11-17：开箱默认音色（没手动选过时用它，引擎弹窗里高亮这一项）。 */
        defaultVoice: externalEngineDefaultVoice(entry.id),
        /* 11-17 mac 适配：当前平台能不能安装/运行（mac 上四个引擎都是 false，卡片如实标注）。 */
        supported: supportsPlatform(entry),
        installable: Boolean(entry.install && entry.install.kind !== "external"),
      };
    }),
    active: state.active,
    enginesRoot: enginesRoot(),
  };
}

/** 读当前启用的引擎（没有返回 null）；供 voice-service 判断是否走外部合成。 */
export function activeExternalEngine(): VoiceExternalEngine | null {
  const state = loadState();
  if (!state.active) return null;
  const entry = externalEngineById(state.active);
  if (!entry) {
    /* 11-17 用户令移除的非商用引擎可能还留在档案里：停掉它的服务并清掉启用态，
       否则会继续占显存、而界面上已经看不到它。 */
    stopService(state.active);
    state.active = "";
    saveState(state);
    return null;
  }
  /* 11-17 mac 适配：别的平台装/拷来的引擎在这里跑不起来 ⇒ 清掉启用态，回落到基础模型 / MOSS。 */
  if (!supportsPlatform(entry)) {
    stopService(state.active);
    state.active = "";
    saveState(state);
    return null;
  }
  return entry;
}

function sevenZipPath(): string {
  const p = join(toolsRoot(), "sevenzip", "7z.exe");
  return existsSync(p) ? p : "7z";
}

function findFile(root: string, name: string, depth = 4): string {
  const stack: { dir: string; level: number }[] = [{ dir: root, level: 0 }];
  while (stack.length) {
    const { dir, level } = stack.shift()!;
    let entries: any[] = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const p = join(dir, entry.name);
      if (entry.isFile() && entry.name === name) return p;
      if (entry.isDirectory() && level < depth && !/^(node_modules|\.git|\.venv|__pycache__)$/i.test(entry.name)) {
        stack.push({ dir: p, level: level + 1 });
      }
    }
  }
  return "";
}

function findDirWith(root: string, fileName: string, depth = 3): string {
  const file = findFile(root, fileName, depth);
  return file ? dirname(file) : "";
}

/** 带断点续传的下载（ModelScope/Codeload 都支持 Range；忽略 Range 的源自动整包重下）。 */
function download(url: string, dest: string, expectedBytes: number, onProgress: (ratio: number) => void, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("已取消"));
    mkdirSync(dirname(dest), { recursive: true });
    let start = 0;
    try { start = existsSync(dest) ? statSync(dest).size : 0; } catch { start = 0; }
    if (expectedBytes > 0 && start === expectedBytes) return resolve();
    if (expectedBytes > 0 && start > expectedBytes) { try { rmSync(dest, { force: true }); } catch { /* 忽略 */ } start = 0; }
    /* ⛔ 不知道总大小时**不续传**：以前会把旧文件当半截继续追加，源若不认 Range 就拼出坏包。 */
    if (expectedBytes <= 0 && start > 0) { try { rmSync(dest, { force: true }); } catch { /* 忽略 */ } start = 0; }
    const go = (target: string, redirects: number) => {
      if (redirects > 6) return reject(new Error("下载跳转过多"));
      const client = target.startsWith("https:") ? https : http;
      /* ⛔ ModelScope 的大文件会 403 无 User-Agent 的请求（小文件不拦）；统一带 UA + Referer。 */
      const headers: Record<string, string> = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) CodexHarness/1.0" };
      if (target.includes("modelscope.cn")) headers.Referer = "https://www.modelscope.cn/";
      if (start > 0) headers.Range = `bytes=${start}-`;
      const req = client.get(target, { headers }, (res) => {
        const status = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, target).toString();
          return go(next, redirects + 1);
        }
        if (start > 0 && status === 200) {
          /* 源不认 Range：从头写，避免拼出坏文件 */
          res.resume();
          try { rmSync(dest, { force: true }); } catch { /* 忽略 */ }
          start = 0;
          return go(target, redirects + 1);
        }
        if (status !== 200 && status !== 206) {
          res.resume();
          return reject(new Error(`下载失败（HTTP ${status}）`));
        }
        const total = expectedBytes > 0 ? expectedBytes : Number(res.headers["content-length"] ?? 0) + start;
        let received = start;
        const out = createWriteStream(dest, { flags: start > 0 ? "a" : "w" });
        let lastTick = 0;
        res.on("data", (chunk: Buffer) => {
          received += chunk.length;
          const now = Date.now();
          if (now - lastTick > 400) {
            lastTick = now;
            onProgress(total > 0 ? Math.min(0.999, received / total) : 0);
          }
        });
        res.on("error", (error) => { try { out.destroy(); } catch { /* 忽略 */ } reject(error); });
        out.on("error", reject);
        out.on("finish", () => {
          if (expectedBytes > 0 && received !== expectedBytes) return reject(new Error(`文件大小不符（${received}/${expectedBytes}）`));
          resolve();
        });
        res.pipe(out);
      });
      req.on("error", reject);
      req.setTimeout(60_000, () => req.destroy(new Error("下载超时")));
      const onAbort = () => { try { req.destroy(new Error("已取消")); } catch { /* 忽略 */ } };
      signal.addEventListener("abort", onAbort, { once: true });
    };
    go(url, 0);
  });
}

/** 7z 解压（zip/7z 都走它；stdout 里的百分比转成进度）。 */
function extractArchive(archive: string, dest: string, signal: AbortSignal, onProgress: (ratio: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    mkdirSync(dest, { recursive: true });
    const child = spawn(sevenZipPath(), ["x", "-y", "-bsp1", `-o${dest}`, archive], { windowsHide: true });
    let buf = "";
    child.stdout?.on("data", (chunk) => {
      buf = (buf + String(chunk)).slice(-400);
      const matches = [...buf.matchAll(/(\d+)%/g)];
      if (matches.length) onProgress(Math.min(0.999, Number(matches[matches.length - 1][1]) / 100));
    });
    child.on("error", reject);
    /* ⛔ Windows 上代码仓库 zip 常带符号链接，7z 建不了软链会返回 2（Sub items Errors）。
       这些链通常只是示例/triton 脚本，不影响推理 —— 放行 0/2，由调用方用关键文件校验兜底。 */
    child.on("close", (code) => (code === 0 || code === 2 ? resolve() : reject(new Error(`解压失败（退出码 ${code}）`))));
    const onAbort = () => { try { child.kill(); } catch { /* 忽略 */ } reject(new Error("已取消")); };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/* ── 国内镜像（11-21 用户实测「CosyVoice 装到 15% 就卡死」；11-22 再按实测提档）──────────
 * ⛔⛔ 卡死真因不是慢，是**两条都错**：
 *   ① `--index-url https://download.pytorch.org/whl/cu121` 是 pytorch 官方源，国内基本
 *      拉不动（2–3GB 的 torch+cu121）。而依赖走的是阿里云 pypi —— 只有 torch 一半没走镜像，
 *      用户看到的就是「一直在 15%」。
 *   ② uv 装 torch 十几分钟不吐进度，界面百分比不动 ⇒ 无论快慢都像死了。
 * 阿里云/上交的 pytorch-wheels 都是**平铺目录**（不是 PEP503 索引，没有 /torch/ 子路径）
 * ⇒ 只能用 `--find-links`，用 `--index-url` 会 404。实测 cu121 下有
 * `torch-2.3.1+cu121-cp310-cp310-win_amd64.whl`；PEP 440 规定 `==2.3.1` 匹配该 local 版本。
 *
 * ⛔⛔ 11-22 实测（同一台机器、同一时段的 12MB 采样）—— 阿里云不是最快的：
 *   mkl 218MB 轮子：**清华 26.9MB/s** ≫ 腾讯 13.8 ＞ 中科大 12.6 ＞ 华为 12.6 ＞ 阿里 7.7（曾测到 2.8）
 *   torch 2.3GB cu121：**上交 pytorch-wheels 20.5MB/s** ≫ 阿里 7.9MB/s
 *   用户报「装装到 mkl 15% 卡好久」正是这两处都落在慢档上 ⇒ 依赖改清华优先、torch 改上交优先。
 *   ⛔ 每次发版前重测；顺手把两档都留着做兜底，别只剩一个。
 */
const PYPI_MIRRORS = [
  "https://pypi.tuna.tsinghua.edu.cn/simple",     // 26.9MB/s（11-22 实测最快）
  "https://mirrors.cloud.tencent.com/pypi/simple", // 13.8MB/s
  "https://mirrors.aliyun.com/pypi/simple",        // 7.7MB/s（曾低到 2.8）
] as const;
const TORCH_INDEX_BASE = "https://mirror.sjtu.edu.cn/pytorch-wheels";
const TORCH_MIRROR_BASES = [
  TORCH_INDEX_BASE,                           // 20.5MB/s（11-22 实测最快）—— 它是 PEP503 索引，当索引用
  "https://mirrors.aliyun.com/pytorch-wheels", // 7.9MB/s 兜底 —— 平铺目录，只能 --find-links
] as const;

/**
 * 跑 `uv pip install`，索引**一次只用一档**，失败就整条换下一档（清华 → 腾讯 → 阿里）。
 *
 * ⛔⛔ 为什么不做「一个主索引 + 若干 --index」：11-22 实测这么写会**静默装成 CPU 版 torch**
 *   （`--index-strategy unsafe-best-match` / `first-index` 两种都给过，解析结果都是
 *   `torch==2.3.1` 而不是 `2.3.1+cu121`）。GPU 版与 CPU 版同版本号，装错不报错、只在
 *   推理时慢十倍——这种坑不能靠"看着装完了"判断。
 *   ⇒ 每次只给一个索引；缺包就让 uv 明确失败，由这里换下一档重试（uv 有缓存，重试不重下）。
 */
async function runPip(uv: string, py: string, args: string[], cwd: string, signal: AbortSignal, onLine?: (line: string) => void): Promise<void> {
  let lastError: unknown = null;
  for (const index of PYPI_MIRRORS) {
    try {
      await runCommand(uv, ["pip", "install", "--python", py, "--default-index", index, ...args], cwd, signal, onLine);
      return;
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error;
      onLine?.(`${new URL(index).host} 失败，换下一档镜像…`);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("依赖安装失败");
}

/** 把 `cu121` / `--torch-backend=cu121` 统一成目录名。 */
function torchTagOf(backend: string): string {
  return String(backend ?? "").replace(/^--torch-backend=/, "").replace(/[^a-z0-9]/gi, "") || "cu121";
}

/** 秒 → 「3 分 20 秒」。 */
function fmtElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return sec < 60 ? `${sec} 秒` : `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`;
}

/**
 * 把 uv 输出里的「每文件百分比」映射到本步骤的进度带，让进度条**真的在走**。
 * uv 装 torch 时逐文件打 `Downloaded mkl 15%`，同一个百分比在整步里其实是 0→100 反复；
 * 外面只知道「这一步占 15%~35%」⇒ 取**单调不减**的映射，条子不会倒退。
 */
function stepPercentOf(message: string, from: number, to: number, seen: number): number {
  const match = /(\d{1,3})%/.exec(message);
  if (!match) return seen;
  const ratio = Math.min(100, Number(match[1])) / 100;
  return Math.max(seen, Math.min(to, from + (to - from) * ratio));
}

/**
 * 长任务心跳：每 5 秒把「已用时间 + 最近一行输出」推给界面。
 * ⛔ 只对**耗时以分钟计且没有自然进度**的步骤用（装 torch / 装依赖 / 建环境），
 *    有字节进度的下载别套这层（那会把真实百分比刷没）。
 */
async function withHeartbeat(label: string, onBeat: (message: string) => void, task: (note: (line: string) => void) => Promise<void>): Promise<void> {
  const started = Date.now();
  let last = "";
  const timer = setInterval(() => {
    onBeat(`${label}（已用 ${fmtElapsed(Date.now() - started)}）${last ? `：${last}` : "…"}`);
  }, 5000);
  (timer as unknown as { unref?: () => void }).unref?.();
  try {
    await task((line) => { if (line) last = line.replace(/\s+/g, " ").slice(0, 70); });
  } finally {
    clearInterval(timer);
  }
}

/**
 * 装完自检：必须是 **CUDA 构建**。
 * ⛔ 11-22 实测过的坑：CPU 版与 GPU 版**同版本号**（都是 `torch==2.3.1`），装错不报任何错，
 *   只在推理时慢十倍 —— 用户会以为是"模型就这样"。`torch.version.cuda` 为空即 CPU 版。
 */
async function assertCudaTorch(py: string, cwd: string, signal: AbortSignal): Promise<void> {
  try {
    await runCommand(py, ["-c", "import torch,sys; sys.exit(0 if torch.version.cuda else 3)"], cwd, signal);
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error("PyTorch 装成了 CPU 版（torch.version.cuda 为空）—— 请重试；若一直如此，说明镜像只给了 CPU 轮子");
  }
}

/**
 * 装 PyTorch —— 三档实测过的组合，按速度排：
 *   ① **上交 pytorch-wheels 是标准 PEP503 索引**（`/cu121/` 下有 `torch/`、`torchaudio/` 等子目录，
 *      依赖也收在里面）⇒ 直接当 `--default-index`，实测 20.5MB/s、解析出 `torch==2.3.1+cu121`。
 *      ⛔ 这一档**不许**再挂别的 pypi 索引：实测会解析成 CPU 版 `torch==2.3.1`（同版本号、不报错）。
 *   ② 阿里云是**平铺目录**（`--index-url` 会 404）⇒ 只能 `--find-links` + 清华 pypi 取依赖，
 *      实测同样得到 `+cu121`，7.9MB/s 兜底。
 *   ③ 最后才回官方 `--torch-backend`（国内基本拉不动，只当救命通道）。
 */
async function installTorch(uv: string, py: string, backend: string, specs: string[], cwd: string, signal: AbortSignal, onLine?: (line: string) => void): Promise<void> {
  const tag = torchTagOf(backend);
  const cuIndex = `${TORCH_INDEX_BASE}/${tag}`;
  const attempts: { label: string; args: string[] }[] = [
    { label: "上交 pytorch 索引", args: ["--default-index", cuIndex, ...specs] },
    { label: "阿里云 torch-wheels", args: ["--default-index", PYPI_MIRRORS[0], "--find-links", `${TORCH_MIRROR_BASES[1]}/${tag}/`, ...specs] },
    { label: "官方 CUDA 源", args: ["--default-index", PYPI_MIRRORS[0], `--torch-backend=${tag}`, ...specs] },
  ];
  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      await runCommand(uv, ["pip", "install", "--python", py, ...attempt.args], cwd, signal, onLine);
      await assertCudaTorch(py, cwd, signal);
      return;
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error;
      onLine?.(`${attempt.label} 未成功，换下一档…`);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("PyTorch 安装失败");
}

/** 跑一个命令并等它结束（安装步骤用；stdout/stderr 只留尾部）。
 *  ⛔⛔ 11-22 与 OpenMAIC 同源事故：等 `close` 会被**孙进程继承的管道**挂住（pg_ctl→postgres 就是
 *    这么卡半小时）。装依赖时 pip/uv 会拉起构建子进程，同样可能拖着管道不放 ⇒ 改成等 `exit`，
 *    再加一条「10 分钟没有任何输出就杀掉」的看门狗，宁可报错也不无限等。 */
function runCommand(command: string, args: string[], cwd: string, signal: AbortSignal, onLine?: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    let tail = "";
    let lastOutput = Date.now();
    const onData = (chunk: Buffer) => {
      tail = (tail + String(chunk)).slice(-4000);
      lastOutput = Date.now();
      onLine?.(String(chunk).trim().split(/\r?\n/).pop() ?? "");
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    const stall = setInterval(() => {
      if (Date.now() - lastOutput > 10 * 60_000) {
        try { child.kill(); } catch { /* 已退出 */ }
      }
    }, 5000);
    (stall as unknown as { unref?: () => void }).unref?.();
    child.on("error", (error) => { clearInterval(stall); reject(error); });
    child.on("exit", (code) => {
      clearInterval(stall);
      if (code === 0) { resolve(); return; }
      const stalled = Date.now() - lastOutput > 10 * 60_000;
      reject(new Error(stalled
        ? `命令超过 10 分钟没有任何输出，已中止：${tail.slice(-400)}`
        : `命令失败（${code}）：${tail.slice(-400)}`));
    });
    const onAbort = () => { try { child.kill(); } catch { /* 忽略 */ } reject(new Error("已取消")); };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function saveInstalled(id: string, info: InstalledInfo): void {
  const state = loadState();
  state.installed[id] = info;
  saveState(state);
}

/** 启动一个安装任务（立即返回；进度走 ExternalProgressEvent）。 */
export function startExternalInstall(id: string): { ok: boolean; started?: boolean; error?: string } {
  const entry = externalEngineById(id);
  if (!entry) return { ok: false, error: "未知的引擎" };
  if (!supportsPlatform(entry)) return { ok: false, error: "当前平台（macOS/Linux）暂不支持这个引擎：安装器与推理后端目前只适配 Windows；可用基础模型 / MOSS" };
  if (!entry.install || entry.install.kind === "external") return { ok: false, error: "这个项目是独立应用，请用「打开官网」安装" };
  if (loadState().installed[id]) return { ok: false, error: "已经安装过了" };
  if (installLock) return { ok: false, error: "已有另一个引擎在安装，请等它完成" };
  installLock = id;
  const controller = new AbortController();
  cancels.set(id, controller);
  void (async () => {
    try {
      if (entry.install?.kind === "archive") await installGptArchive(entry, entry.install, controller.signal);
      else if (entry.install?.kind === "source") await installCosySource(entry, entry.install, controller.signal);
      else if (entry.install?.kind === "python") await installPythonEngine(entry, entry.install, controller.signal);
      emit({ id, kind: "downloadDone", percent: 1, message: "安装完成", ok: true });
    } catch (error: any) {
      emit({ id, kind: "downloadDone", percent: 0, message: "安装失败", ok: false, error: String(error?.message ?? error) });
    } finally {
      installLock = null;
      cancels.delete(id);
    }
  })();
  return { ok: true, started: true };
}

/** 取消正在进行的安装（下载/解压/命令都会被中断）。 */
export function cancelExternalInstall(id?: string): { ok: boolean } {
  if (id) cancels.get(id)?.abort();
  else for (const controller of cancels.values()) controller.abort();
  return { ok: true };
}

async function installGptArchive(entry: VoiceExternalEngine, install: any, signal: AbortSignal): Promise<void> {
  const dir = engineDir(entry.id);
  const appDir = join(dir, "app");
  mkdirSync(appDir, { recursive: true });
  const archive = join(dir, `package.${install.format}`);
  emit({ id: entry.id, kind: "download", percent: 0, message: "下载 GPT-SoVITS 便携包（8.2GB）…" });
  await downloadWithMirrors(install.url, archive, Number(install.bytes ?? 0), (ratio) => {
    emit({ id: entry.id, kind: "download", percent: ratio * 0.9, message: `下载 GPT-SoVITS 便携包 ${(ratio * 100).toFixed(0)}%` });
  }, signal);
  emit({ id: entry.id, kind: "download", percent: 0.9, message: "解压中（约 1–3 分钟）…" });
  await extractArchive(archive, appDir, signal, (ratio) => {
    emit({ id: entry.id, kind: "download", percent: 0.9 + ratio * 0.09, message: `解压中 ${(ratio * 100).toFixed(0)}%` });
  });
  const api = findFile(appDir, "api_v2.py", 3);
  if (!api) throw new Error("便携包里没有找到 api_v2.py（包结构可能变了）");
  const pkgDir = dirname(api);
  if (!existsSync(join(pkgDir, "runtime", "python.exe"))) {
    emit({ id: entry.id, kind: "download", percent: 0.99, message: "未发现内置 runtime，将尝试系统 Python" });
  }
  /* 包默认配置是 v2；v2ProPlus 权重随包但没被启用 ⇒ 写一份自己的配置，让服务用最好的那一档。 */
  try {
    const v2ProDir = join(pkgDir, "GPT_SoVITS", "pretrained_models", "v2Pro");
    const plus = existsSync(join(v2ProDir, "s2Gv2ProPlus.pth"));
    const pro = existsSync(join(v2ProDir, "s2Gv2Pro.pth"));
    if (plus || pro) {
      const config = [
        "custom:",
        "  bert_base_path: GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large",
        "  cnhuhbert_base_path: GPT_SoVITS/pretrained_models/chinese-hubert-base",
        "  device: cuda",
        "  is_half: true",
        "  t2s_weights_path: GPT_SoVITS/pretrained_models/s1v3.ckpt",
        `  version: ${plus ? "v2ProPlus" : "v2Pro"}`,
        `  vits_weights_path: GPT_SoVITS/pretrained_models/v2Pro/${plus ? "s2Gv2ProPlus.pth" : "s2Gv2Pro.pth"}`,
        "",
      ].join("\n");
      writeFileSync(join(pkgDir, "harness_tts_infer.yaml"), config, "utf8");
    }
  } catch { /* 配置写不了就沿用包默认 v2 */ }
  saveInstalled(entry.id, { dir: pkgDir, adapter: "gpt-sovits", installedAt: Date.now(), version: String(install.version ?? "") });
  try { rmSync(archive, { force: true }); } catch { /* 省 8GB：装完删包 */ }
}

async function installCosySource(entry: VoiceExternalEngine, install: any, signal: AbortSignal): Promise<void> {
  const dir = engineDir(entry.id);
  const appDir = join(dir, "app");
  const srcDir = join(dir, "src");
  mkdirSync(appDir, { recursive: true });
  const zip = join(dir, "source.zip");
  emit({ id: entry.id, kind: "download", percent: 0, message: "下载 CosyVoice 源码…" });
  await downloadWithMirrors(String(install.zipUrl), zip, 0, (ratio) => emit({ id: entry.id, kind: "download", percent: ratio * 0.05, message: "下载源码…" }), signal);
  await extractArchive(zip, srcDir, signal, () => { /* 源码小，不报细进度 */ });
  const extractedRoot = findDirWith(srcDir, "requirements.txt", 3);
  if (!extractedRoot) throw new Error("源码包里没有 requirements.txt");
  /* ⛔ Windows 路径上限 260：zip 里是 `CosyVoice-<40 位提交>`，直接在里面建 venv 会让
     transformers 的长文件名装不进去（uv 静默漏装）。收敛到短路径 `app/` 再建环境。 */
  try { rmSync(appDir, { recursive: true, force: true }); } catch { /* 忽略 */ }
  renameSync(extractedRoot, appDir);
  try { rmSync(srcDir, { recursive: true, force: true }); } catch { /* 忽略 */ }
  const root = appDir;
  /* CosyVoice 依赖 Matcha-TTS 子模块；zip 不含子模块，单独补。 */
  const matchaDir = join(root, "third_party", "Matcha-TTS");
  if (!existsSync(matchaDir) || !readdirSync(matchaDir).length) {
    const mzip = join(dir, "matcha.zip");
    emit({ id: entry.id, kind: "download", percent: 0.06, message: "下载 Matcha-TTS 子模块…" });
    await downloadWithMirrors("https://codeload.github.com/shivammehta25/Matcha-TTS/zip/refs/heads/main", mzip, 0, () => { /* 忽略细进度 */ }, signal);
    await extractArchive(mzip, join(root, "third_party"), signal, () => { /* 忽略 */ });
    const extracted = findDirWith(join(root, "third_party"), "setup.py", 2);
    if (extracted && extracted !== matchaDir) {
      try { rmSync(matchaDir, { recursive: true, force: true }); } catch { /* 忽略 */ }
      renameSync(extracted, matchaDir);
    }
  }
  const uv = join(toolsRoot(), "uv", "uv.exe");
  const venv = join(root, ".venv");
  const py = join(venv, "Scripts", "python.exe");
  emit({ id: entry.id, kind: "download", percent: 0.1, message: "创建 Python 3.10 环境…" });
  if (!existsSync(py)) {
    await withHeartbeat(
      "创建 Python 3.10 环境",
      (message) => emit({ id: entry.id, kind: "download", percent: 0.1, message }),
      (note) => runCommand(uv, ["venv", "--python", "3.10", venv], root, signal, note),
    );
  }
  emit({ id: entry.id, kind: "download", percent: 0.15, message: "安装 PyTorch（CUDA 12.1，约 2–3GB，走上交镜像）…" });
  /* 进度条从 15% 走到 35%：uv 逐文件报的百分比映射进来，别让条子在整段里一动不动。 */
  let torchSeen = 0.15;
  await withHeartbeat(
    "安装 PyTorch（CUDA 12.1，约 2–3GB）",
    (message) => {
      torchSeen = stepPercentOf(message, 0.15, 0.35, torchSeen);
      emit({ id: entry.id, kind: "download", percent: torchSeen, message });
    },
    (note) => installTorch(uv, py, "cu121", ["torch==2.3.1", "torchaudio==2.3.1"], root, signal, note),
  );
  emit({ id: entry.id, kind: "download", percent: 0.35, message: "安装 CosyVoice 依赖（约 5–10 分钟）…" });
  /* ⛔ 上游 requirements 里两个 --extra-index-url 会让 uv 只认第一个索引；Windows 的
     onnxruntime==1.18.0 不在那个 CUDA 源里，整份依赖直接解不出来。
     ⛔ openai-whisper 只用于 ASR，且构建要 pkg_resources（uv 隔离环境没有）⇒ 一并去掉。 */
  const requirements = readFileSync(join(root, "requirements.txt"), "utf8")
    .split(/\r?\n/)
    .filter((line) => !/^\s*--(extra-)?index-url/i.test(line) && !/^\s*openai-whisper/i.test(line))
    .join("\n");
  const localRequirements = join(root, "harness_requirements.txt");
  writeFileSync(localRequirements, requirements, "utf8");
  await withHeartbeat(
    "安装 CosyVoice 依赖（约 5–10 分钟）",
    (message) => emit({ id: entry.id, kind: "download", percent: 0.35, message }),
    (note) => runPip(uv, py, ["-r", localRequirements], root, signal, note),
  );
  /* ⛔ frontend.py 硬 import whisper（TTS 其实不用），但 whisper 是 sdist、构建要 pkg_resources。
     setuptools 69 仍带 pkg_resources；装好后用 --no-build-isolation 现场构建一次。 */
  emit({ id: entry.id, kind: "download", percent: 0.52, message: "补装 whisper 运行时…" });
  await withHeartbeat(
    "补装 whisper 运行时",
    (message) => emit({ id: entry.id, kind: "download", percent: 0.52, message }),
    async (note) => {
      await runPip(uv, py, ["setuptools==69.5.1"], root, signal, note);
      await runPip(uv, py, ["--no-build-isolation", "openai-whisper==20231117"], root, signal, note);
    },
  );
  const modelDir = join(root, "pretrained_models", "Fun-CosyVoice3-0.5B");
  const files: string[] = Array.isArray(install.modelFiles) ? install.modelFiles : [];
  for (let i = 0; i < files.length; i++) {
    const rel = files[i];
    const url = `https://www.modelscope.cn/models/${install.modelRepo}/resolve/master/${rel}`;
    const dest = join(modelDir, ...rel.split("/"));
    const start = 0.55 + (i / Math.max(1, files.length)) * 0.42;
    emit({ id: entry.id, kind: "download", percent: start, message: `下载模型 ${i + 1}/${files.length}：${rel}` });
    await download(url, dest, 0, (ratio) => {
      emit({ id: entry.id, kind: "download", percent: start + (ratio / Math.max(1, files.length)) * 0.42, message: `下载模型 ${i + 1}/${files.length}：${rel}` });
    }, signal);
  }
  writeFileSync(join(root, "harness_adapter.py"), COSY_ADAPTER, "utf8");
  saveInstalled(entry.id, { dir: root, adapter: "cosyvoice3", installedAt: Date.now(), version: String(install.commit ?? "").slice(0, 8) });
  try { rmSync(zip, { force: true }); } catch { /* 忽略 */ }
}

/** 统一走 uv pip（默认阿里云源；torch 由 --torch-backend 从官方 CUDA 源解析）。 */
function uvPip(uv: string, py: string, args: string[], cwd: string, signal: AbortSignal, onLine?: (line: string) => void): Promise<void> {
  /* 统一走 `runPip`（清华优先、失败换腾讯/阿里）：⛔ 别在这里另写 index 字面量，
     否则引擎依赖又回到慢档（11-22 实测阿里云 7.7MB/s vs 清华 26.9MB/s）。 */
  return runPip(uv, py, args, cwd, signal, onLine);
}

/** ModelScope 文件清单（递归取 blob，跳过 README/.gitattributes）。 */
async function collectModelFiles(root: string, install: any): Promise<{ url: string; dest: string; bytes: number; label: string }[]> {
  const out: { url: string; dest: string; bytes: number; label: string }[] = [];
  const models: any[] = Array.isArray(install.models) ? install.models : [];
  for (const model of models) {
    if (model?.source === "url") {
      const dest = String(model.dest ?? "");
      if (!dest) continue;
      out.push({ url: String(model.url), dest: join(root, ...dest.split("/")), bytes: Number(model.bytes ?? 0), label: dest });
      continue;
    }
    if (model?.source !== "modelscope") continue;
    const repo = String(model.repo ?? "");
    if (!repo) continue;
    const api = `https://www.modelscope.cn/api/v1/models/${repo}/repo/files?Revision=master&Recursive=True`;
    let payload: any = null;
    for (let attempt = 0; attempt < 3 && !payload; attempt++) {
      try {
        const response = await fetch(api, {
          headers: { "User-Agent": "Mozilla/5.0 CodexHarness/1.0" },
          signal: AbortSignal.timeout(60_000),
        });
        if (response.ok) payload = await response.json();
      } catch { /* 重试 */ }
    }
    if (!payload) throw new Error(`读取模型清单失败：${repo}`);
    const files = Array.isArray(payload?.Data?.Files) ? payload.Data.Files : [];
    if (!files.length) throw new Error(`模型清单为空：${repo}`);
    for (const file of files) {
      if (file?.Type !== "blob") continue;
      const path = String(file.Path ?? "");
      if (!path || path === ".gitattributes" || /(^|\/)README\.md$/i.test(path)) continue;
      const encoded = path.split("/").map(encodeURIComponent).join("/");
      out.push({
        url: `https://www.modelscope.cn/models/${repo}/resolve/master/${encoded}`,
        dest: join(root, ...String(model.dest ?? "models").split("/"), ...path.split("/")),
        bytes: Number(file.Size ?? 0),
        label: `${repo}/${path}`,
      });
    }
  }
  return out;
}

/** 下载一个可能来自 GitHub 的文件：**先按镜像序逐个试**，非 GitHub 地址原样走一次。
 *  ⛔ 这里不能直接 `download(url)`：CosyVoice 源码与 Matcha-TTS 子模块都是 codeload.github.com，
 *     国内直连经常几分钟拉不动（11-21 用户实测卡死）。镜像序来自 `mirrorCandidates`（单一真相源）。 */
async function downloadWithMirrors(url: string, dest: string, expectedBytes: number, onProgress: (ratio: number) => void, signal: AbortSignal): Promise<void> {
  const candidates = mirrorCandidates(url);
  let lastError: unknown = null;
  for (const candidate of candidates) {
    if (signal.aborted) throw new Error("已取消");
    try {
      await download(candidate, dest, expectedBytes, onProgress, signal);
      return;
    } catch (error) {
      lastError = error;
      if (signal.aborted) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`下载失败：${url}`);
}

/** 逐个下载模型文件（按字节算总进度；未知大小时退化为按文件数）。 */
async function downloadModelFiles(entry: VoiceExternalEngine, install: any, root: string, signal: AbortSignal, from: number, span: number): Promise<void> {
  const files = await collectModelFiles(root, install);
  if (!files.length) return;
  const totalBytes = files.reduce((sum, file) => sum + Math.max(0, file.bytes), 0);
  let done = 0;
  for (let index = 0; index < files.length; index++) {
    if (signal.aborted) throw new Error("已取消");
    const file = files[index];
    const base = totalBytes > 0 ? done / totalBytes : index / files.length;
    const label = `下载模型 ${file.label}`;
    emit({ id: entry.id, kind: "download", percent: from + base * span, message: label });
    await download(file.url, file.dest, file.bytes, (ratio) => {
      const inner = totalBytes > 0 ? (done + Math.max(0, file.bytes) * ratio) / totalBytes : (index + ratio) / files.length;
      emit({ id: entry.id, kind: "download", percent: from + inner * span, message: `${label} ${Math.round(ratio * 100)}%` });
    }, signal);
    done += Math.max(0, file.bytes);
  }
}

/** 通用 Python 引擎安装：源码/包 → venv → CUDA torch → 依赖 → 模型 → 适配器。
 *  ⛔ 源码收敛到短路径 `app/`（Windows 260 字符上限，CosyVoice 实测过）。
 *  ⛔ torch 走 `installTorch`（阿里云 pytorch-wheels 镜像优先），⛔ 不再直接 `--index-url`
 *     指 pytorch.org —— 11-21 用户实测「CosyVoice 卡在 15%」正是卡在那一步。
 *     后续依赖解析仍带 `--torch-backend=cuXXX`，保证源码构建时不会把 CPU 版 torch 解进来。 */
async function installPythonEngine(entry: VoiceExternalEngine, install: any, signal: AbortSignal): Promise<void> {
  const dir = engineDir(entry.id);
  const appDir = join(dir, "app");
  const srcDir = join(dir, "src");
  mkdirSync(appDir, { recursive: true });
  if (install.zipUrl) {
    const zip = join(dir, "source.zip");
    emit({ id: entry.id, kind: "download", percent: 0, message: `下载 ${entry.name} 源码…` });
    await downloadWithMirrors(String(install.zipUrl), zip, 0, (ratio) => emit({ id: entry.id, kind: "download", percent: ratio * 0.04, message: `下载源码 ${Math.round(ratio * 100)}%` }), signal);
    await extractArchive(zip, srcDir, signal, () => { /* 源码小，不报细进度 */ });
    const extracted = findDirWith(srcDir, "pyproject.toml", 3);
    if (!extracted) throw new Error("源码包里没有找到 pyproject.toml（结构可能变了）");
    try { rmSync(appDir, { recursive: true, force: true }); } catch { /* 忽略 */ }
    renameSync(extracted, appDir);
    try { rmSync(srcDir, { recursive: true, force: true }); } catch { /* 忽略 */ }
    try { rmSync(zip, { force: true }); } catch { /* 忽略 */ }
  }
  const uv = join(toolsRoot(), "uv", "uv.exe");
  const venv = join(appDir, ".venv");
  const py = join(venv, "Scripts", "python.exe");
  emit({ id: entry.id, kind: "download", percent: 0.06, message: `创建 Python ${String(install.python ?? "3.10")} 环境…` });
  if (!existsSync(py)) {
    await withHeartbeat(
      `创建 Python ${String(install.python ?? "3.10")} 环境`,
      (message) => emit({ id: entry.id, kind: "download", percent: 0.06, message }),
      (note) => runCommand(uv, ["venv", "--python", String(install.python ?? "3.10"), venv], appDir, signal, note),
    );
    if (!existsSync(py)) throw new Error("Python 环境创建失败（uv 没下载到目标版本）");
  }
  const backend = `--torch-backend=${String(install.torchBackend ?? "cu128")}`;
  emit({ id: entry.id, kind: "download", percent: 0.1, message: "安装 PyTorch（CUDA，约 2–4GB，走上交镜像）…" });
  /* ⛔ 版本必须按引擎来：Chatterbox 0.1.7 锁 torch==2.6.0，写死 2.8 会直接解不出依赖。 */
  const torchSpec = typeof install.torch === "string" && install.torch.trim()
    ? install.torch.trim().split(/\s+/)
    : ["torch==2.8.0", "torchaudio==2.8.0"];
  let torchSeen = 0.1;
  await withHeartbeat(
    `安装 PyTorch（${torchTagOf(backend)}，约 2–4GB）`,
    (message) => {
      torchSeen = stepPercentOf(message, 0.1, 0.3, torchSeen);
      emit({ id: entry.id, kind: "download", percent: torchSeen, message });
    },
    (note) => installTorch(uv, py, backend, torchSpec, appDir, signal, note),
  );
  /* ⛔ uv 的 venv 默认不带 setuptools：perth（Chatterbox 水印）与 whisper 构建都要 pkg_resources。 */
  await uvPip(uv, py, ["setuptools==69.5.1"], appDir, signal);
  if (install.editable) {
    /* IndexTTS：frontend 链会 import whisper，whisper 是 sdist、构建要 pkg_resources；
       装好后无隔离构建一次（CosyVoice 同款坑）。 */
    await uvPip(uv, py, ["--no-build-isolation", "openai-whisper==20231117"], appDir, signal);
    await uvPip(uv, py, ["hatchling", "editables", "wheel"], appDir, signal);
    emit({ id: entry.id, kind: "download", percent: 0.3, message: "安装引擎依赖（约 5–15 分钟）…" });
    await withHeartbeat(
      "安装引擎依赖（约 5–15 分钟）",
      (message) => emit({ id: entry.id, kind: "download", percent: 0.3, message }),
      (note) => uvPip(uv, py, [backend, "-e", ".", "--no-build-isolation"], appDir, signal, (line) => note(line)),
    );
  } else {
    emit({ id: entry.id, kind: "download", percent: 0.3, message: "安装引擎依赖（约 3–10 分钟）…" });
    await withHeartbeat(
      "安装引擎依赖（约 3–10 分钟）",
      (message) => emit({ id: entry.id, kind: "download", percent: 0.3, message }),
      (note) => uvPip(uv, py, [backend, ...(Array.isArray(install.pip) ? install.pip : [])], appDir, signal, (line) => note(line)),
    );
  }
  emit({ id: entry.id, kind: "download", percent: 0.62, message: "下载模型权重…" });
  await downloadModelFiles(entry, install, appDir, signal, 0.62, 0.35);
  const adapter = String(install.adapter ?? "");
  const template = ADAPTERS[adapter];
  if (!template) throw new Error(`没有 ${adapter} 的适配器模板`);
  writeFileSync(join(appDir, "harness_adapter.py"), template, "utf8");
  saveInstalled(entry.id, { dir: appDir, adapter, installedAt: Date.now(), version: String(install.commit ?? install.version ?? "").slice(0, 12) });
}

/**
 * 删除一个引擎（先停服务，再删目录）。
 *
 * ⛔⛔ 11-22 用户实测「所有语音模型卸载都没有反馈，也没有气泡小弹窗提醒」+ 截图标题栏是
 *   **「Codex Harness Desktop（未响应）」**。真因不是"没写提示"，而是这里原来是**同步**的：
 *   `rmSync(recursive)` 删的是一个 8GB 级目录（GPT-SoVITS 8.2GB、CosyVoice 带 venv 几万个小文件）。
 *   主进程被这一个调用卡住十几秒到几分钟 ⇒ 窗口「未响应」、IPC 回不去 ⇒ 前端那句
 *   `onNotice("…已卸载")` 根本没机会执行，用户看到的就是「点了没反应」。
 *   ⇒ 改成**异步逐文件删除 + 进度事件**（复用 model-purge：带 EBUSY 退避重试），
 *     每删一批就推 `kind:"remove"`，前端出百分比；完成/失败再推 removeDone。
 */
export async function removeExternalEngine(id: string): Promise<{ ok: boolean; error?: string }> {
  const entry = externalEngineById(id);
  if (!entry) return { ok: false, error: "未知的引擎" };
  stopService(id);
  const state = loadState();
  const info = state.installed[id];
  const dir = join(enginesRoot(), id);
  if (info?.dir || existsSync(dir)) {
    try {
      const result = await purgeDirWithProgress(dir, (progress) =>
        emit({ id, kind: "remove", percent: progress.percent / 100, message: progress.message }),
      );
      if (!result.ok) {
        const preview = result.failed.slice(0, 2).map((item) => item.reason).join("；");
        emit({ id, kind: "removeDone", percent: 1, message: "卸载未完成", ok: false, error: preview });
        return { ok: false, error: `${result.failed.length} 个文件没删掉（${preview}）—— 引擎进程可能还在跑，稍后重试` };
      }
    } catch (error: any) {
      const message = String(error?.message ?? error);
      emit({ id, kind: "removeDone", percent: 1, message: "卸载失败", ok: false, error: message });
      return { ok: false, error: message };
    }
  }
  /* 状态在删完之后才落盘：中途失败时「已安装」还留着，用户可以直接再点一次卸载（而不是卡在
     「显示未安装、目录还占着 8GB」的半死状态）。 */
  delete state.installed[id];
  if (state.active === id) state.active = "";
  saveState(state);
  emit({ id, kind: "removeDone", percent: 1, message: "已卸载", ok: true });
  return { ok: true };
}

/** 启用/停用一个引擎（同时只允许一个）。 */
export function setExternalEngineEnabled(id: string, enabled: boolean): { ok: boolean; active?: string; error?: string } {
  const entry = externalEngineById(id);
  if (!entry) return { ok: false, error: "未知的引擎" };
  const state = loadState();
  if (enabled) {
    if (!supportsPlatform(entry)) return { ok: false, error: "当前平台暂不支持这个引擎（安装器/推理后端只适配 Windows）" };
    if (!state.installed[id]) return { ok: false, error: "还没安装这个引擎" };
    for (const other of Object.keys(SERVICES)) if (other !== id) stopService(other);
    state.active = id;
    saveState(state);
    void ensureService(id).catch((error) => {
      const service = SERVICES.get(id);
      if (service) { service.state = "error"; service.error = String(error?.message ?? error); }
    });
    return { ok: true, active: id };
  }
  if (state.active === id) { state.active = ""; saveState(state); }
  stopService(id);
  return { ok: true, active: state.active };
}

/** 打开引擎官方项目页（独立工作台/未适配引擎用）。 */
export function externalEngineRepo(id: string): string {
  return externalEngineById(id)?.repo ?? "";
}

/** 引擎安装目录（未安装返回空串）。 */
export function externalEngineInstalledDir(id: string): string {
  return loadState().installed[id]?.dir ?? "";
}

function portOf(id: string): number { return PORTS[id] ?? 19880; }

function waitPort(port: number, timeoutMs: number, isAlive?: () => boolean): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      /* 子进程已退出（OOM / 依赖缺失）不必干等到超时：立刻失败，卡片马上给原因。 */
      if (isAlive && !isAlive()) return reject(new Error("服务进程已退出（模型加载失败，详见引擎目录的 service.log）"));
      const socket = net.connect({ host: "127.0.0.1", port });
      socket.setTimeout(1200);
      socket.once("connect", () => { socket.destroy(); resolve(); });
      socket.once("timeout", () => { socket.destroy(); retry(); });
      socket.once("error", () => { socket.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) return reject(new Error("外部引擎启动超时（模型加载可能失败，看日志）"));
      setTimeout(tryOnce, 800);
    };
    tryOnce();
  });
}

function serviceLog(id: string): string { return join(enginesRoot(), id, "service.log"); }

async function ensureService(id: string): Promise<void> {
  const existing = SERVICES.get(id);
  if (existing?.state === "running") return;
  if (existing?.starting) return existing.starting;
  const info = loadState().installed[id];
  if (!info) throw new Error("当前外部引擎未安装");
  /* 适配器模板随版本演进（如 Chatterbox 新增「自带音色」）：启动前按当前模板重写，
     否则旧安装目录里的 harness_adapter.py 永远是安装当天的旧逻辑。 */
  const adapterTemplate = info.adapter === "cosyvoice3" ? COSY_ADAPTER : ADAPTERS[info.adapter];
  if (adapterTemplate) {
    try {
      const adapterFile = join(info.dir, "harness_adapter.py");
      if (!existsSync(adapterFile) || readFileSync(adapterFile, "utf8") !== adapterTemplate) {
        writeFileSync(adapterFile, adapterTemplate, "utf8");
      }
    } catch { /* 写不进去就按旧逻辑跑，合成时会报错并显示原因 */ }
  }
  const service: ExternalService = existing ?? { state: "stopped", child: null, starting: null };
  SERVICES.set(id, service);
  service.state = "starting";
  service.error = "";
  emitService(id, service);
  const port = portOf(id);
  const startedAt = Date.now();
  service.starting = (async () => {
    const logPath = serviceLog(id);
    mkdirSync(dirname(logPath), { recursive: true });
    const log = createWriteStream(logPath, { flags: "a" });
    const logLine = (line: string) => { try { log.write(`[${new Date().toISOString()}] ${line}\n`); } catch { /* 忽略 */ } };
    let child: ChildProcess;
    if (info.adapter === "gpt-sovits") {
      const python = [join(info.dir, "runtime", "python.exe"), join(info.dir, "python.exe"), "python"].find((p) => p === "python" || existsSync(p)) ?? "python";
      const config = join(info.dir, "harness_tts_infer.yaml");
      const args = ["api_v2.py", "-a", "127.0.0.1", "-p", String(port)];
      if (existsSync(config)) args.push("-c", "harness_tts_infer.yaml");
      logLine(`start gpt-sovits: ${python} ${args.join(" ")}`);
      child = spawn(python, args, { cwd: info.dir, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    } else if (info.adapter === "cosyvoice3") {
      const python = join(info.dir, ".venv", "Scripts", "python.exe");
      logLine(`start cosyvoice3: ${python} harness_adapter.py --port ${port}`);
      child = spawn(python, ["harness_adapter.py", "--port", String(port)], { cwd: info.dir, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    } else if (PY_ADAPTERS.has(info.adapter)) {
      const python = join(info.dir, ".venv", "Scripts", "python.exe");
      if (!existsSync(python)) throw new Error("引擎的 Python 环境不完整，请卸载后重装");
      logLine(`start ${info.adapter}: ${python} harness_adapter.py --port ${port}`);
      /* ⛔ 模型懒下载会走 HuggingFace：不注入镜像在国内会卡死；HF_HOME 留在引擎目录里。 */
      child = spawn(python, ["harness_adapter.py", "--port", String(port)], {
        cwd: info.dir,
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: "utf-8", HF_ENDPOINT, HF_HOME: join(info.dir, "hf"), PYTHONWARNINGS: "ignore" },
      });
    } else {
      throw new Error("这个引擎尚未接入");
    }
    service.child = child;
    child.stdout?.on("data", (d) => logLine(String(d).trim()));
    child.stderr?.on("data", (d) => logLine(String(d).trim()));
    child.on("close", (code) => {
      service.child = null;
      service.starting = null;
      if (service.state !== "stopped") { service.state = code === 0 ? "stopped" : "error"; service.error = `服务退出（${code}）`; }
      emitService(id, service);
      logLine(`exit ${code}`);
      try { log.end(); } catch { /* 忽略 */ }
    });
    child.on("error", (error) => logLine(`spawn error: ${String(error?.message ?? error)}`));
    await waitPort(port, SERVICE_TIMEOUT[info.adapter] ?? 240_000, () => Boolean(service.child));
    /* 启动期间用户可能已关掉引擎：stopService 把状态置为 stopped，别再改回 running。 */
    if (service.state !== "starting") return;
    service.state = "running";
    service.starting = null;
    emitService(id, service);
    logLine(`ready in ${Date.now() - startedAt}ms`);
  })();
  try {
    await service.starting;
  } catch (error: any) {
    /* 用户主动关闭（已在 stopService 里置 stopped）不算失败。 */
    if (String(service.state) === "stopped") return;
    stopService(id);
    service.state = "error";
    service.error = String(error?.message ?? error);
    emitService(id, service);
    throw error;
  }
}

/** 按进程树终止（Windows 上 uvicorn 会再 fork 子进程，只 kill 直接子进程会留下占端口的孙进程）。 */
function killProcessTree(child: ChildProcess | null): void {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    try { spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)], { windowsHide: true }); } catch { /* 忽略 */ }
    return;
  }
  try { child.kill("SIGKILL"); } catch { /* 忽略 */ }
}

function stopService(id: string): void {
  const service = SERVICES.get(id);
  if (!service) return;
  service.state = "stopped";
  killProcessTree(service.child);
  service.child = null;
  service.starting = null;
  emitService(id, service);
}

/** 应用退出时停掉所有外部引擎（子进程不 detached，但 Windows 上仍要显式 kill）。 */
export function stopAllExternalEngines(): void {
  for (const id of [...SERVICES.keys()]) stopService(id);
}

/** 预热/启动当前启用的外部引擎（播报开关打开时调一次，减少首句等待）。 */
export async function warmExternalEngine(): Promise<{ ok: boolean; error?: string }> {
  const active = activeExternalEngine();
  if (!active) return { ok: true };
  try { await ensureService(active.id); return { ok: true }; } catch (error: any) { return { ok: false, error: String(error?.message ?? error) }; }
}

type SpeakOptions = { userData: string; speed: number; profileId?: string; engineVoice?: string; engineVoices?: Record<string, string> };

type ResolvedReference = { profile: { audioPath: string; refText: string; profileId: string } | null; native: boolean; error?: string };

/**
 * 解析「这个引擎这次该用谁的声音」（11-17 每个引擎卡自己的音色选择）：
 *  · `native`          → 引擎自带默认音色（无参考音频）
 *  · `preset:<id>`     → 随包默认音色（resources/voice-presets，不依赖本机基础模型）
 *  · `builtin:<sid>`   → 本机模型说话人生成的内置参考样本
 *  · `profile:<id>`    → 指定「我的音色」档案
 *  · 空                → 沿用老字段 profileId（兼容老档案/老界面）
 */
function resolveReference(userData: string, options: SpeakOptions, choiceOverride?: string): ResolvedReference {
  const choice = String(choiceOverride ?? options.engineVoice ?? "").trim();
  if (choice === "native") return { profile: null, native: true };
  if (choice.startsWith("preset:")) {
    const preset = readBundledVoice(choice.slice("preset:".length));
    return preset
      ? { profile: { audioPath: preset.audioPath, refText: preset.refText, profileId: `preset-${preset.id}` }, native: false }
      : { profile: null, native: false, error: "随包默认音色缺失：重装应用后再试，或改选「我的音色」" };
  }
  if (choice.startsWith("builtin:")) {
    const sid = Number(choice.slice("builtin:".length));
    const builtin = readBuiltinVoice(userData, sid);
    if (!builtin) return { profile: null, native: false, error: "这个内置音色还没生成好：在引擎卡里重新选一下音色（首次生成约 10 秒）" };
    return { profile: { audioPath: builtin.audioPath, refText: builtin.refText, profileId: `builtin-${sid}` }, native: false };
  }
  if (choice.startsWith("profile:")) {
    const profile = readProfile(userData, choice.slice("profile:".length));
    return profile
      ? { profile, native: false }
      : { profile: null, native: false, error: "选中的「我的音色」不可用（参考音频缺失）：请重新选一个" };
  }
  return { profile: readProfile(userData, options.profileId), native: false };
}

function readProfile(userData: string, id?: string): { audioPath: string; refText: string; profileId: string } | null {
  if (!id) return null;
  try {
    const list = JSON.parse(readFileSync(join(userData, "voice-profiles", "profiles.json"), "utf8"));
    const profile = Array.isArray(list) ? list.find((entry: any) => entry?.id === id) : null;
    const refText = String(profile?.refText ?? "").trim();
    const audioPath = join(userData, "voice-profiles", String(profile?.audioFile ?? ""));
    if (!refText || !profile?.audioFile || !existsSync(audioPath)) return null;
    return { audioPath, refText, profileId: String(id) };
  } catch { return null; }
}

/** GPT-SoVITS 要求参考音频 3–10 秒；「我的音色」可能只有 2.8 秒 ⇒ 尾部补静音到 3.4 秒。
 *  ⛔ 不改用户原文件；补过的临时文件落在引擎目录，按 profile 复用。 */
function ensureLongReference(audioPath: string, profileId: string, engineId: string): string {
  try {
    const buffer = readFileSync(audioPath);
    if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF") return audioPath;
    let offset = 12;
    let dataOffset = 0;
    let dataSize = 0;
    let sampleRate = 0;
    let channels = 1;
    let bits = 16;
    while (offset + 8 <= buffer.length) {
      const id = buffer.toString("ascii", offset, offset + 4);
      const size = buffer.readUInt32LE(offset + 4);
      if (id === "fmt ") {
        channels = buffer.readUInt16LE(offset + 10) || 1;
        sampleRate = buffer.readUInt32LE(offset + 12);
        bits = buffer.readUInt16LE(offset + 22);
      } else if (id === "data") {
        dataOffset = offset + 8;
        dataSize = Math.min(size, buffer.length - offset - 8);
        break;
      }
      offset += 8 + size + (size % 2);
    }
    const byteRate = sampleRate * channels * (bits / 8);
    if (!byteRate || !dataSize) return audioPath;
    const duration = dataSize / byteRate;
    if (duration >= 3) return audioPath;
    const padSeconds = Math.max(0.6, 3.4 - duration);
    const padBytes = Math.round(byteRate * padSeconds);
    const out = Buffer.alloc(buffer.length + padBytes);
    buffer.copy(out, 0);
    out.writeUInt32LE(buffer.readUInt32LE(4) + padBytes, 4);
    /* data 块大小在原始偏移处（后面的块不搬，只追加） */
    let cursor = 12;
    while (cursor + 8 <= buffer.length) {
      const id = buffer.toString("ascii", cursor, cursor + 4);
      const size = out.readUInt32LE(cursor + 4);
      if (id === "data") { out.writeUInt32LE(size + padBytes, cursor + 4); break; }
      cursor += 8 + size + (size % 2);
    }
    const dest = join(enginesRoot(), engineId, `ref-${profileId}.wav`);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, out);
    return dest;
  } catch { return audioPath; }
}

function langOf(text: string): string {
  return /[\u4e00-\u9fff]/.test(text) ? "zh" : "en";
}

type WavAudio = { ok: true; sampleRate: number; samples: Float32Array } | { ok: false; error: string };

function parseWav(buffer: Buffer): WavAudio {
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF") return { ok: false, error: "返回的不是 WAV" };
  let offset = 12;
  let channels = 1;
  let sampleRate = 0;
  let bits = 16;
  let format = 1;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      format = buffer.readUInt16LE(offset + 8);
      channels = buffer.readUInt16LE(offset + 10) || 1;
      sampleRate = buffer.readUInt32LE(offset + 12);
      bits = buffer.readUInt16LE(offset + 22);
    } else if (id === "data") {
      const frameBytes = channels * (bits / 8);
      const frames = Math.floor(Math.min(size, buffer.length - offset - 8) / frameBytes);
      const samples = new Float32Array(frames);
      /* 16 位整数 PCM（GPT-SoVITS）与 32 位浮点（torchaudio 保存的 CosyVoice 输出）都要认。 */
      if (format === 3 && bits === 32) {
        for (let i = 0; i < frames; i++) {
          let sum = 0;
          for (let c = 0; c < channels; c++) sum += buffer.readFloatLE(offset + 8 + (i * channels + c) * 4);
          samples[i] = sum / channels;
        }
        return { ok: true, sampleRate: sampleRate || 24000, samples };
      }
      if (format === 1 && bits === 16) {
        for (let i = 0; i < frames; i++) {
          let sum = 0;
          for (let c = 0; c < channels; c++) sum += buffer.readInt16LE(offset + 8 + (i * channels + c) * 2);
          samples[i] = sum / channels / 32768;
        }
        return { ok: true, sampleRate: sampleRate || 32000, samples };
      }
      return { ok: false, error: `暂不支持 ${bits} 位 / 格式 ${format} 的 WAV` };
    }
    offset += 8 + size + (size % 2);
  }
  return { ok: false, error: "WAV 里没有 data 块" };
}

type ExternalSpeakResult = { ok: true; sampleRate: number; samples: Float32Array } | { ok: false; error: string };

/** 走当前启用的外部引擎合成；没启用返回 null（调用方继续走本地/MOSS）。 */
export async function externalEngineSpeak(text: string, options: SpeakOptions): Promise<ExternalSpeakResult | null> {
  const active = activeExternalEngine();
  if (!active) return null;
  const info = loadState().installed[active.id];
  if (!info) return { ok: false, error: "当前外部引擎未安装" };
  /* 11-17：每个引擎自己的音色（engineVoices[id]）；没选过就回落到开箱默认音色。
     ⛔ 不再共用一个 engineVoice —— 换引擎会互相串音色（用户要求「互不影响、配置独立」）。 */
  const resolved = resolveReference(options.userData, options, externalEngineEffectiveVoice(active.id, options));
  if (resolved.native && !NATIVE_VOICE_ENGINES.has(active.id)) {
    return { ok: false, error: `「${active.name}」没有自带音色：请给它在音色里选一个参考声音` };
  }
  if (!resolved.native && !resolved.profile) {
    return { ok: false, error: resolved.error || "外部引擎需要参考音色：请先在音色里选一个声音" };
  }
  const profile = resolved.profile;
  const refAudio = resolved.native ? NATIVE_REF : ensureLongReference(profile!.audioPath, profile!.profileId, active.id);
  try { await ensureService(active.id); } catch (error: any) { return { ok: false, error: `外部引擎启动失败：${String(error?.message ?? error)}` }; }
  const port = portOf(active.id);
  try {
    if (info.adapter === "gpt-sovits") {
      const params = new URLSearchParams({
        text,
        text_lang: langOf(text),
        ref_audio_path: refAudio,
        prompt_text: profile!.refText,
        prompt_lang: langOf(profile!.refText),
        text_split_method: "cut5",
        batch_size: "1",
        media_type: "wav",
        streaming_mode: "false",
        speed_factor: String(options.speed || 1),
      });
      const res = await fetch(`http://127.0.0.1:${port}/tts?${params.toString()}`, { signal: AbortSignal.timeout(180_000) });
      if (!res.ok) throw new Error(`GPT-SoVITS 返回 HTTP ${res.status}`);
      return parseWav(Buffer.from(await res.arrayBuffer()));
    }
    if (info.adapter === "cosyvoice3") {
      const res = await fetch(`http://127.0.0.1:${port}/speak`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, refAudio, refText: profile?.refText ?? "", speed: options.speed || 1 }),
        signal: AbortSignal.timeout(180_000),
      });
      const parsed: any = await res.json();
      if (!parsed?.ok || !parsed.wavBase64) throw new Error(String(parsed?.error ?? "CosyVoice 合成失败"));
      return parseWav(Buffer.from(parsed.wavBase64, "base64"));
    }
    if (PY_ADAPTERS.has(info.adapter)) {
      /* 第二批统一协议：POST /speak { text, refAudio, refText, speed } → { ok, wavBase64 } */
      const res = await fetch(`http://127.0.0.1:${port}/speak`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, refAudio, refText: profile?.refText ?? "", speed: options.speed || 1 }),
        signal: AbortSignal.timeout(300_000),
      });
      const parsed: any = await res.json();
      if (!parsed?.ok || !parsed.wavBase64) throw new Error(String(parsed?.error ?? `${info.adapter} 合成失败`));
      return parseWav(Buffer.from(parsed.wavBase64, "base64"));
    }
    return { ok: false, error: "这个外部引擎尚未接入" };
  } catch (error: any) {
    return { ok: false, error: `外部引擎合成失败：${String(error?.message ?? error)}` };
  }
}

/** CosyVoice 本地 HTTP 适配器（安装时写到源码目录；只监听 127.0.0.1）。 */
const COSY_ADAPTER = `# Harness CosyVoice3 adapter (auto-generated)
import argparse, base64, io, json, os, sys, tempfile, traceback
from http.server import BaseHTTPRequestHandler, HTTPServer
sys.path.append('third_party/Matcha-TTS')
import torch
import torchaudio
from cosyvoice.cli.cosyvoice import AutoModel

MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pretrained_models', 'Fun-CosyVoice3-0.5B')
print('loading CosyVoice3 from', MODEL_DIR, flush=True)
tts = AutoModel(model_dir=MODEL_DIR)
print('model ready, sample_rate', tts.sample_rate, flush=True)

def synth(text, ref_audio, ref_text, speed):
    prompt_text = ref_text
    # Fun-CosyVoice3 官方示例给 prompt 加了系统前缀；缺失时音色/韵律会漂
    if '<|endofprompt|>' not in prompt_text:
        prompt_text = 'You are a helpful assistant.<|endofprompt|>' + prompt_text
    chunks = []
    for item in tts.inference_zero_shot(text, prompt_text, ref_audio, stream=False, speed=float(speed or 1.0)):
        chunks.append(item['tts_speech'])
    if not chunks:
        raise RuntimeError('empty result')
    audio = torch.cat(chunks, dim=1) if len(chunks) > 1 else chunks[0]
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as fh:
        path = fh.name
    try:
        torchaudio.save(path, audio, tts.sample_rate)
        with open(path, 'rb') as fh:
            return fh.read()
    finally:
        try: os.unlink(path)
        except OSError: pass

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass
    def do_GET(self):
        if self.path.startswith('/health'):
            body = b'{"ok":true}'
            self.send_response(200)
            self.send_header('content-type', 'application/json')
            self.send_header('content-length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_error(404)
    def do_POST(self):
        if not self.path.startswith('/speak'):
            return self.send_error(404)
        try:
            length = int(self.headers.get('content-length', '0'))
            data = json.loads(self.rfile.read(length) or b'{}')
            wav = synth(str(data.get('text', '')), str(data.get('refAudio', '')), str(data.get('refText', '')), data.get('speed', 1.0))
            body = json.dumps({'ok': True, 'wavBase64': base64.b64encode(wav).decode('ascii')}).encode('utf-8')
            self.send_response(200)
            self.send_header('content-type', 'application/json')
            self.send_header('content-length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as error:
            body = json.dumps({'ok': False, 'error': str(error)}).encode('utf-8')
            self.send_response(500)
            self.send_header('content-type', 'application/json')
            self.send_header('content-length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            traceback.print_exc()

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=19881)
    args = parser.parse_args()
    print('listening 127.0.0.1:%d' % args.port, flush=True)
    HTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
`;

/** 第二批 Python 适配器（安装时写到引擎目录；统一 POST /speak，只监听 127.0.0.1）。 */
const ADAPTER_HTTP_HEAD = String.raw`# Harness external TTS adapter (auto-generated)
import argparse, base64, io, json, os, tempfile, traceback
from http.server import BaseHTTPRequestHandler, HTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass
    def _send(self, status, payload):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_GET(self):
        if self.path.startswith('/health'):
            return self._send(200, {'ok': True})
        self.send_error(404)
    def do_POST(self):
        if not self.path.startswith('/speak'):
            return self.send_error(404)
        try:
            length = int(self.headers.get('content-length', '0'))
            data = json.loads(self.rfile.read(length) or b'{}')
            wav = synth(str(data.get('text', '')), str(data.get('refAudio', '')), str(data.get('refText', '')), data.get('speed', 1.0))
            self._send(200, {'ok': True, 'wavBase64': base64.b64encode(wav).decode('ascii')})
        except Exception as error:
            traceback.print_exc()
            self._send(500, {'ok': False, 'error': str(error)})
`;

const ADAPTER_HTTP_MAIN = String.raw`
if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=19880)
    args = parser.parse_args()
    print('listening 127.0.0.1:%d' % args.port, flush=True)
    HTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
`;


const CHATTERBOX_ADAPTER = ADAPTER_HTTP_HEAD + String.raw`# Harness Chatterbox multilingual adapter (auto-generated)
import re
import torchaudio
from chatterbox.mtl_tts import ChatterboxMultilingualTTS

MODELS = os.path.join(ROOT, 'models')
print('loading Chatterbox multilingual', flush=True)
tts = ChatterboxMultilingualTTS.from_local(MODELS, device='cuda')
print('model ready, sample_rate', tts.sr, flush=True)

def synth(text, ref_audio, ref_text, speed):
    lang = 'zh' if re.search(r'[\u4e00-\u9fff]', text) else 'en'
    kwargs = dict(language_id=lang, exaggeration=0.5, cfg_weight=0.5)
    # 11-17：'@native' = 用模型自带默认音色（models/conds.pt 的条件向量），无需参考音频。
    if ref_audio and ref_audio != '@native':
        kwargs['audio_prompt_path'] = ref_audio
    wav = tts.generate(text, **kwargs)
    handle, path = tempfile.mkstemp(suffix='.wav')
    os.close(handle)
    try:
        torchaudio.save(path, wav, tts.sr)
        with open(path, 'rb') as fh:
            return fh.read()
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass

` + ADAPTER_HTTP_MAIN;

const QWEN3_ADAPTER = ADAPTER_HTTP_HEAD + String.raw`# Harness Qwen3-TTS adapter (auto-generated)
import re
import torch
import soundfile as sf
from qwen_tts import Qwen3TTSModel

MODELS = os.path.join(ROOT, 'models')
print('loading Qwen3-TTS from', MODELS, flush=True)
tts = Qwen3TTSModel.from_pretrained(
    MODELS,
    device_map='cuda:0',
    dtype=torch.bfloat16,
    attn_implementation='sdpa',
)
print('model ready', flush=True)

def synth(text, ref_audio, ref_text, speed):
    lang = 'Chinese' if re.search(r'[\u4e00-\u9fff]', text) else 'English'
    wavs, sr = tts.generate_voice_clone(
        text=text,
        language=lang,
        ref_audio=ref_audio,
        ref_text=ref_text or None,
        x_vector_only_mode=not bool(ref_text),
    )
    buf = io.BytesIO()
    sf.write(buf, wavs[0], sr, format='WAV')
    return buf.getvalue()

` + ADAPTER_HTTP_MAIN;


const ADAPTERS: Record<string, string> = {
  chatterbox: CHATTERBOX_ADAPTER,
  "qwen3-tts": QWEN3_ADAPTER,
};

app.on("will-quit", () => stopAllExternalEngines());
