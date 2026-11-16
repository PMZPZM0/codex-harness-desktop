/**
 * 开源语音引擎：按需下载、启停、本机服务与合成适配（11-16 用户令）
 *
 * 现状：
 *  · 卡片目录在 `src/lib/voice-external-engines.mjs`（主进程/渲染层共用一份）。
 *  · 首批真接入：GPT-SoVITS（官方便携包，内置 runtime + API 9880）与 CosyVoice 3（源码 + venv + ModelScope 权重）。
 *  · 其余项目只出卡片：独立工作台走「打开官网」，未适配引擎显示「下一批」。
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

type InstalledInfo = { dir: string; adapter: string; installedAt: number; version?: string };
type ExternalState = { version: 1; installed: Record<string, InstalledInfo>; active: string };
type ExternalService = { state: "stopped" | "starting" | "running" | "error"; error?: string; child: ChildProcess | null; starting: Promise<void> | null };

export type ExternalProgressEvent = { id: string; kind: "download" | "downloadDone"; percent: number; message: string; ok?: boolean; error?: string };

const SERVICES = new Map<string, ExternalService>();
let progressSink: ((event: ExternalProgressEvent) => void) | null = null;
let installLock: string | null = null;
const cancels = new Map<string, AbortController>();
const PORTS: Record<string, number> = { "gpt-sovits": 19880, "cosyvoice3": 19881 };

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

function emit(event: ExternalProgressEvent): void {
  try { progressSink?.(event); } catch { /* 渲染层关掉不影响安装 */ }
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
  return state.active ? externalEngineById(state.active) : null;
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

/** 跑一个命令并等它结束（安装步骤用；stdout/stderr 只留尾部）。 */
function runCommand(command: string, args: string[], cwd: string, signal: AbortSignal, onLine?: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    let tail = "";
    const onData = (chunk: Buffer) => { tail = (tail + String(chunk)).slice(-4000); onLine?.(String(chunk).trim().split(/\r?\n/).pop() ?? ""); };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`命令失败（${code}）：${tail.slice(-400)}`))));
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
  await download(install.url, archive, Number(install.bytes ?? 0), (ratio) => {
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
  await download(String(install.zipUrl), zip, 0, (ratio) => emit({ id: entry.id, kind: "download", percent: ratio * 0.05, message: "下载源码…" }), signal);
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
    await download("https://codeload.github.com/shivammehta25/Matcha-TTS/zip/refs/heads/main", mzip, 0, () => { /* 忽略细进度 */ }, signal);
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
  if (!existsSync(py)) await runCommand(uv, ["venv", "--python", "3.10", venv], root, signal);
  emit({ id: entry.id, kind: "download", percent: 0.15, message: "安装 PyTorch（CUDA 12.1，约 2–3GB）…" });
  await runCommand(uv, ["pip", "install", "--python", py, "torch==2.3.1", "torchaudio==2.3.1", "--index-url", "https://download.pytorch.org/whl/cu121"], root, signal);
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
  await runCommand(uv, ["pip", "install", "--python", py, "-r", localRequirements, "--index-url", "https://mirrors.aliyun.com/pypi/simple/"], root, signal);
  /* ⛔ frontend.py 硬 import whisper（TTS 其实不用），但 whisper 是 sdist、构建要 pkg_resources。
     setuptools 69 仍带 pkg_resources；装好后用 --no-build-isolation 现场构建一次。 */
  emit({ id: entry.id, kind: "download", percent: 0.52, message: "补装 whisper 运行时…" });
  await runCommand(uv, ["pip", "install", "--python", py, "setuptools==69.5.1", "--index-url", "https://mirrors.aliyun.com/pypi/simple/"], root, signal);
  await runCommand(uv, ["pip", "install", "--python", py, "--no-build-isolation", "openai-whisper==20231117", "--index-url", "https://mirrors.aliyun.com/pypi/simple/"], root, signal);
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

/** 删除一个引擎（先停服务，再删目录）。 */
export function removeExternalEngine(id: string): { ok: boolean; error?: string } {
  const entry = externalEngineById(id);
  if (!entry) return { ok: false, error: "未知的引擎" };
  stopService(id);
  const state = loadState();
  const info = state.installed[id];
  if (info?.dir) {
    try { rmSync(join(enginesRoot(), id), { recursive: true, force: true }); } catch (error: any) { return { ok: false, error: String(error?.message ?? error) }; }
  }
  delete state.installed[id];
  if (state.active === id) state.active = "";
  saveState(state);
  return { ok: true };
}

/** 启用/停用一个引擎（同时只允许一个）。 */
export function setExternalEngineEnabled(id: string, enabled: boolean): { ok: boolean; active?: string; error?: string } {
  const entry = externalEngineById(id);
  if (!entry) return { ok: false, error: "未知的引擎" };
  const state = loadState();
  if (enabled) {
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

function waitPort(port: number, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      if (signal?.aborted) return reject(new Error("已取消"));
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
  const service: ExternalService = existing ?? { state: "stopped", child: null, starting: null };
  SERVICES.set(id, service);
  service.state = "starting";
  service.error = "";
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
      logLine(`exit ${code}`);
      try { log.end(); } catch { /* 忽略 */ }
    });
    child.on("error", (error) => logLine(`spawn error: ${String(error?.message ?? error)}`));
    await waitPort(port, info.adapter === "gpt-sovits" ? 180_000 : 240_000);
    service.state = "running";
    service.starting = null;
    logLine(`ready in ${Date.now() - startedAt}ms`);
  })();
  try {
    await service.starting;
  } catch (error: any) {
    stopService(id);
    service.state = "error";
    service.error = String(error?.message ?? error);
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

type SpeakOptions = { userData: string; speed: number; profileId?: string };

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
  const profile = readProfile(options.userData, options.profileId);
  if (!profile) return { ok: false, error: "外部引擎需要参考音色：请先在「我的音色」里选一个克隆音色" };
  const refAudio = ensureLongReference(profile.audioPath, profile.profileId, active.id);
  try { await ensureService(active.id); } catch (error: any) { return { ok: false, error: `外部引擎启动失败：${String(error?.message ?? error)}` }; }
  const port = portOf(active.id);
  try {
    if (info.adapter === "gpt-sovits") {
      const params = new URLSearchParams({
        text,
        text_lang: langOf(text),
        ref_audio_path: refAudio,
        prompt_text: profile.refText,
        prompt_lang: langOf(profile.refText),
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
        body: JSON.stringify({ text, refAudio, refText: profile.refText, speed: options.speed || 1 }),
        signal: AbortSignal.timeout(180_000),
      });
      const parsed: any = await res.json();
      if (!parsed?.ok || !parsed.wavBase64) throw new Error(String(parsed?.error ?? "CosyVoice 合成失败"));
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

app.on("will-quit", () => stopAllExternalEngines());
