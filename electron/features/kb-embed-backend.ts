// 知识库本地 embedding 后端（10-04 第二步，**按需下载、不进安装包**）。
//
// 目标：语义检索不再依赖供应商 /embeddings（多数中转站没有该接口）。
// 方案：@huggingface/transformers（transformers.js）+ ONNX 模型 Xenova/bge-small-zh-v1.5，
//   装到 <userData>/kb-backend/（npm 走 npmmirror），模型权重安装时就预下载（hf-mirror）。
//   ⛔ 不随包（10-04 实测：npm 树解压 463MB、裁剪后仍 ~85MB + 模型 23MB ≈ 110MB，远超 50MB 内置线
//   —— 早先「35MB 内置」只算了模型；用户拍板改回按需，下载入口在知识库设置页）。
//   推理跑在**常驻子进程**里（内置 node 执行 kb-embed-worker.mjs，JSON 行协议）——
//   ⛔ 不在主进程里 import ONNX 运行时：那是原生/WASM 重依赖 + 长任务会卡主进程事件循环。
// ⛔ 本模块是叶子：不 import 业务模块；路径惰性求值（【91】）。
import { app } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { CHINA_NPM_REGISTRY, bundledNode, bundledNpmCli, toolchainEnv, toolsRoot } from "../toolchain";

const PKG = "@huggingface/transformers";
const MODEL_REPO = "Xenova/bge-small-zh-v1.5";
const HF_MIRROR = "https://hf-mirror.com";
/** npm 依赖树解压后的估计体积（10-04 实测 463MB）——安装进度用它当分母，版本漂移只影响百分比平滑度 */
const NPM_TREE_ESTIMATE = 463 * 1024 * 1024;

export function kbBackendDir(): string {
  // 旧的随包实验（5e09b57）在 app 路径下留过一份的话继续认它，不作废；
  // 正常路径 = <userData>/kb-backend/（runtime:install 与知识库页的下载入口都装这里）。
  const legacyBundled = path.join(app.getAppPath(), "resources", "tools", "kb-embedding");
  if (existsSync(legacyBundled)) return legacyBundled;
  return path.join(app.getPath("userData"), "kb-backend");
}

function modelDir(): string {
  return path.join(kbBackendDir(), "models", MODEL_REPO);
}

function workerFile(): string {
  return path.join(kbBackendDir(), "kb-embed-worker.mjs");
}

/** 是否已安装（= npm 包 + worker + 模型权重三者齐 —— 装完即可用，没有"装完还要再下模型"的空窗） */
export function kbEmbeddingInstalled(): boolean {
  return existsSync(path.join(kbBackendDir(), "node_modules", PKG, "package.json"))
    && existsSync(workerFile())
    && existsSync(path.join(modelDir(), "onnx", "model_quantized.onnx"));
}

export function kbEmbedStatus(): { installed: boolean; dir: string } {
  return { installed: kbEmbeddingInstalled(), dir: kbBackendDir() };
}

/** worker 脚本（装它到 kb-backend/：⛔ 不能藏在 asar 里 —— 子进程的 node 读不了 asar）。
 *  模型权重安装时就落盘在 <dir>/models/ ⇒ worker 纯本地加载、离线可用。 */
const WORKER_SOURCE = `// kb-embed-worker.mjs —— 常驻 embedding 子进程（stdin/stdout JSON 行协议）
// 请求：{"id":1,"texts":["..."]}   响应：{"id":1,"vectors":[[...]]} 或 {"id":1,"error":"..."}
import { pipeline, env } from "@huggingface/transformers";
import path from "node:path";
import { fileURLToPath } from "node:url";

env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "models");

let pipePromise = null;
function extractor() { pipePromise ??= pipeline("feature-extraction", ${JSON.stringify(MODEL_REPO)}, { dtype: "q8" }); return pipePromise; }

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\\n")) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;
    void handle(line);
  }
});

async function handle(line) {
  let request = null;
  try {
    request = JSON.parse(line);
    const pipe = await extractor();
    const output = await pipe(request.texts, { pooling: "mean", normalize: true });
    process.stdout.write(JSON.stringify({ id: request.id, vectors: output.tolist() }) + "\\n");
  } catch (error) {
    process.stdout.write(JSON.stringify({ id: request?.id ?? 0, error: String(error?.message ?? error) }) + "\\n");
  }
}

process.stdout.write(JSON.stringify({ ready: true }) + "\\n");
`;

export type KbInstallProgress = { percent?: number; speed?: string; remaining?: string; message?: string };

/** 安装中继发（防重复点/两处入口并发）：同一时刻只跑一份，后来者等它完成 */
let installInFlight: Promise<void> | null = null;

/** 装完自动裁掉与当前平台无关的大块二进制（10-04 实测能省 ~275MB：跨平台 onnxruntime 154MB
 *  + onnxruntime-web wasm 135MB；node 里走 onnxruntime-node 后端，wasm 档用不到）。 */
async function pruneForeignBinaries(dir: string): Promise<void> {
  const ortBin = path.join(dir, "node_modules", "onnxruntime-node", "bin", "napi-v6");
  for (const foreign of [path.join(ortBin, "darwin"), path.join(ortBin, "linux"), path.join(ortBin, "win32", "arm64")]) {
    await fs.rm(foreign, { recursive: true, force: true }).catch(() => undefined);
  }
  await fs.rm(path.join(dir, "node_modules", "onnxruntime-web"), { recursive: true, force: true }).catch(() => undefined);
  await fs.rm(path.join(dir, "node_modules", "@types"), { recursive: true, force: true }).catch(() => undefined);
}

/** 安装（知识库页 / 开发工具页 runtime:install 共用）：npm 装包（国内镜像优先，带进度/速度/剩余）
 *  → 裁剪 → 预下载模型权重（hf-mirror，带进度）→ 落 worker。全程结束后 installed === true。 */
export async function installKbEmbedding(onProgress?: (p: KbInstallProgress) => void): Promise<void> {
  if (installInFlight) return installInFlight;
  installInFlight = doInstall(onProgress ?? (() => undefined)).finally(() => { installInFlight = null; });
  return installInFlight;
}

async function doInstall(onProgress: (p: KbInstallProgress) => void): Promise<void> {
  const node = bundledNode();
  if (!node) throw new Error("缺少内置 Node，无法安装知识库 embedding 后端");
  // ⛔ 按平台候选探测（Windows zip 布局 / mac tar.gz 布局）—— 别在这里复制路径字面量，见 toolchain.bundledNpmCli
  const npmCli = bundledNpmCli();
  if (!npmCli) throw new Error(`内置 Node 缺少 npm（候选中无 npm-cli.js，tools 根：${toolsRoot()}）`);
  const dir = kbBackendDir();
  await fs.mkdir(dir, { recursive: true });

  // ── 阶段 1/3（0→70%）：npm 装 @huggingface/transformers。进度靠轮询目标目录体积（npm 没有
  //    可编程的进度钩子）；速度/剩余由体积差分算出 —— 数字是估计值，但方向和量级是对的。
  let lastBytes = 0;
  let lastAt = Date.now();
  const poller = setInterval(async () => {
    try {
      const bytes = await dirBytes(dir);
      const now = Date.now();
      const dt = (now - lastAt) / 1000;
      if (dt > 0) {
        const speed = (bytes - lastBytes) / dt / 1048576;
        onProgress({
          percent: Math.round(70 * Math.min(1, bytes / NPM_TREE_ESTIMATE)),
          speed: speed >= 0.1 ? `${speed.toFixed(1)} MB/s` : "…",
          remaining: `剩余 ${Math.max(0, Math.round((NPM_TREE_ESTIMATE - bytes) / 1048576))} MB`,
        });
      }
      lastBytes = bytes;
      lastAt = now;
    } catch { /* 目录还不存在/正在删改：下一轮再采样 */ }
  }, 800);
  try {
    const userRegistry = process.env.npm_config_registry || process.env.NPM_CONFIG_REGISTRY || "";
    const registries = userRegistry ? [userRegistry] : [CHINA_NPM_REGISTRY, ""];
    let lastError: Error | null = null;
    for (const registry of registries) {
      try {
        await new Promise<void>((resolve, reject) => {
          const env: Record<string, string> = {
            ...toolchainEnv(),
            npm_config_audit: "false",
            npm_config_fund: "false",
            npm_config_loglevel: "error",
            npm_config_update_notifier: "false",
            NO_UPDATE_NOTIFIER: "1",
          };
          if (registry) env.npm_config_registry = registry;
          const child = spawn(node, [npmCli, "install", "--prefix", dir, PKG, "--no-audit", "--no-fund"], { windowsHide: true, env });
          let tail = "";
          const report = (chunk: Buffer | string) => { tail = `${tail}\n${chunk}`.slice(-4000); };
          child.stdout?.on("data", report);
          child.stderr?.on("data", report);
          child.on("error", reject);
          child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`npm install 退出码 ${code}\n${tail.slice(-800)}`))));
        });
        lastError = null;
        break;
      } catch (error) { lastError = error as Error; }
    }
    if (lastError) throw lastError;
    onProgress({ percent: 70, message: "运行库下载完成，正在清理无关平台的二进制…" });
    await pruneForeignBinaries(dir);
  } finally {
    clearInterval(poller);
  }

  // ── 阶段 3/3（76→100%）：预下载模型权重（hf-mirror）——装完即用，首次检索不再等模型。
  await fs.mkdir(path.join(modelDir(), "onnx"), { recursive: true });
  const files: Array<{ rel: string; big?: boolean }> = [
    { rel: "config.json" }, { rel: "tokenizer.json" }, { rel: "tokenizer_config.json" }, { rel: "special_tokens_map.json" },
    { rel: "onnx/model_quantized.onnx", big: true },
  ];
  const base = 76;
  for (const file of files) {
    const url = `${HF_MIRROR}/${MODEL_REPO}/resolve/main/${file.rel}`;
    const dest = path.join(modelDir(), ...file.rel.split("/"));
    const weight = file.big ? 24 : 1; // 小文件几乎瞬间；onnx 按实测 ~23MB 当权重
    const from = base;
    const to = base + Math.round(24 * (weight / 28));
    await downloadToFile(url, dest, (bytes, total, mbs) => {
      const ratio = total > 0 ? Math.min(1, bytes / total) : 0;
      onProgress({
        percent: Math.round(from + (to - from) * ratio),
        speed: `${mbs.toFixed(1)} MB/s`,
        remaining: total > 0 ? `剩余 ${Math.max(0, Math.round((total - bytes) / 1048576))} MB` : `${(bytes / 1048576).toFixed(1)} MB`,
        message: file.big ? "下载语义模型权重（约 23 MB，hf-mirror）" : "下载模型配置文件",
      });
    });
  }

  await fs.writeFile(workerFile(), WORKER_SOURCE, "utf8");
  disposeKbEmbedWorker();
  onProgress({ percent: 100, message: "本地语义检索已就绪", speed: "", remaining: "" });
}

async function dirBytes(dir: string): Promise<number> {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    /* ⛔ `entry.path` 在 @types/node@24 已移除（Dirent 只有 `parentPath`）⇒ 之前
       写 `entry.parentPath ?? entry.path` 编译期就报 TS2339（`??` 兜一个不存在的
       属性不成立）。递归 readdir 时每个 entry 的父目录就是 `parentPath`，
       顶层时它等于传入的 dir。 */
    if (entry.isFile()) total += (await fs.stat(path.join(entry.parentPath, entry.name)).catch(() => null))?.size ?? 0;
  }
  return total;
}

/** 单文件下载：跟随重定向（hf-mirror 302 到 CDN），按流计数回报进度。失败不残留半截文件。 */
async function downloadToFile(url: string, dest: string, onTick: (bytes: number, total: number, mbs: number) => void): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(600_000) });
  if (!response.ok || !response.body) throw new Error(`模型下载失败：HTTP ${response.status}（${url}）`);
  const total = Number(response.headers.get("content-length")) || 0;
  const tmp = `${dest}.downloading`;
  const handle = await fs.open(tmp, "w");
  let bytes = 0;
  let lastAt = Date.now();
  let lastBytes = 0;
  try {
    for await (const chunk of response.body) {
      await handle.write(Buffer.from(chunk));
      bytes += chunk.length;
      const now = Date.now();
      if (now - lastAt >= 300) {
        const dt = (now - lastAt) / 1000;
        onTick(bytes, total, (bytes - lastBytes) / dt / 1048576);
        lastAt = now;
        lastBytes = bytes;
      }
    }
    onTick(bytes, total, 0);
    await handle.close();
    await fs.rename(tmp, dest);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** 卸载 */
export async function uninstallKbEmbedding(): Promise<void> {
  disposeKbEmbedWorker();
  await fs.rm(kbBackendDir(), { recursive: true, force: true });
}

/* ── 常驻 worker 管理 ───────────────────────────────────────────────────── */
type Pending = { resolve: (vectors: number[][]) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
let worker: ChildProcess | null = null;
let workerBuffer = "";
let workerSeq = 0;
let workerReady = false;
const pendingCalls = new Map<number, Pending>();

function failAll(error: Error): void {
  for (const [, entry] of pendingCalls) { clearTimeout(entry.timer); entry.reject(error); }
  pendingCalls.clear();
}

function ensureWorker(): ChildProcess {
  if (worker && !worker.killed) return worker;
  const node = bundledNode();
  if (!node) throw new Error("缺少内置 Node");
  workerReady = false;
  workerBuffer = "";
  const child = spawn(node, [workerFile()], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...toolchainEnv() },
  });
  worker = child;
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    workerBuffer += chunk;
    let index: number;
    while ((index = workerBuffer.indexOf("\n")) >= 0) {
      const line = workerBuffer.slice(0, index);
      workerBuffer = workerBuffer.slice(index + 1);
      if (!line.trim()) continue;
      let message: any = null;
      try { message = JSON.parse(line); } catch { continue; }
      if (message.ready) { workerReady = true; continue; }
      const entry = pendingCalls.get(Number(message.id));
      if (!entry) continue;
      pendingCalls.delete(Number(message.id));
      clearTimeout(entry.timer);
      if (Array.isArray(message.vectors)) entry.resolve(message.vectors);
      else entry.reject(new Error(String(message.error ?? "embedding 失败")));
    }
  });
  const drop = () => { worker = null; workerReady = false; failAll(new Error("embedding 子进程退出")); };
  child.on("exit", drop);
  child.on("error", drop);
  return child;
}

export function disposeKbEmbedWorker(): void {
  if (worker) { try { worker.kill(); } catch { /* 已退出 */ } worker = null; }
  workerReady = false;
  failAll(new Error("embedding 子进程已释放"));
}

/** 本地 embedding：文本 → 向量（模型已随安装落盘，纯本地推理）。 */
export async function embedWithLocalBackend(texts: string[], timeoutMs = 180_000): Promise<number[][]> {
  if (!kbEmbeddingInstalled()) throw new Error("kb-embedding 未安装");
  const child = ensureWorker();
  if (!child.stdin) throw new Error("embedding 子进程 stdin 不可用");
  const id = ++workerSeq;
  return new Promise<number[][]>((resolve, reject) => {
    const timer = setTimeout(() => { pendingCalls.delete(id); reject(new Error("embedding 超时（模型加载可能较慢，稍后重试）")); }, timeoutMs);
    pendingCalls.set(id, { resolve, reject, timer });
    child.stdin!.write(JSON.stringify({ id, texts }) + "\n");
  });
}
