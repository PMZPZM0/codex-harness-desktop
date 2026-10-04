// 知识库本地 embedding 后端（10-04 第二步，按需下载、**不进安装包**）。
//
// 目标：语义检索不再依赖供应商 /embeddings（多数中转站没有该接口）。
// 方案：@huggingface/transformers（transformers.js）+ ONNX 模型 Xenova/bge-small-zh-v1.5，
//   装到 <userData>/kb-backend/（npm 走国内镜像），模型权重走 hf-mirror（HF_ENDPOINT）。
//   推理跑在**常驻子进程**里（内置 node 执行 kb-embed-worker.mjs，JSON 行协议）——
//   ⛔ 不在主进程里 import ONNX 运行时：那是原生/WASM 重依赖 + 长任务会卡主进程事件循环。
//   首次调用会下载模型（~30MB），进度经 harness:event 广播给界面。
// ⛔ 本模块是叶子：不 import 业务模块；路径惰性求值（【91】）。
import { app } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { CHINA_NPM_REGISTRY, bundledNode, toolchainEnv, toolsRoot } from "../toolchain";

const PKG = "@huggingface/transformers";
const MODEL = "Xenova/bge-small-zh-v1.5";
export const KB_EMBED_MARKER = "kb-embedding";

export function kbBackendDir(): string {
  return path.join(app.getPath("userData"), "kb-backend");
}

function workerFile(): string {
  return path.join(kbBackendDir(), "kb-embed-worker.mjs");
}

/** 是否已安装（开发工具页状态 + buildEmbedFn 的开关） */
export function kbEmbeddingInstalled(): boolean {
  return existsSync(path.join(kbBackendDir(), "node_modules", PKG, "package.json")) && existsSync(workerFile());
}

/** worker 脚本（装它到 kb-backend/：⛔ 不能藏在 asar 里 —— 子进程的 node 读不了 asar） */
const WORKER_SOURCE = `// kb-embed-worker.mjs —— 常驻 embedding 子进程（stdin/stdout JSON 行协议）
// 请求：{"id":1,"texts":["..."]}   响应：{"id":1,"vectors":[[...]]} 或 {"id":1,"error":"..."}
import { pipeline, env } from "@huggingface/transformers";

env.allowLocalModels = false;
if (!process.env.HF_ENDPOINT) process.env.HF_ENDPOINT = "https://hf-mirror.com";

let extractorPromise = null;
function extractor() {
  extractorPromise ??= pipeline("feature-extraction", ${JSON.stringify(MODEL)}, { dtype: "q8" });
  return extractorPromise;
}

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
    const vectors = output.tolist();
    process.stdout.write(JSON.stringify({ id: request.id, vectors }) + "\\n");
  } catch (error) {
    process.stdout.write(JSON.stringify({ id: request?.id ?? 0, error: String(error?.message ?? error) }) + "\\n");
  }
}

// 就绪信号：让主进程知道模块装好了（模型在首次请求时才下载）
process.stdout.write(JSON.stringify({ ready: true }) + "\\n");
`;

/** 安装（开发工具页 runtime:install 调）：npm 装包（国内镜像优先）+ 落 worker 脚本 */
export async function installKbEmbedding(onProgress?: (text: string) => void): Promise<void> {
  const node = bundledNode();
  if (!node) throw new Error("缺少内置 Node，无法安装知识库 embedding 后端");
  const npmCli = path.join(toolsRoot(), "node", "node_modules", "npm", "bin", "npm-cli.js");
  if (!existsSync(npmCli)) throw new Error(`内置 Node 缺少 npm（${npmCli}）`);
  const dir = kbBackendDir();
  await fs.mkdir(dir, { recursive: true });
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
        const report = (chunk: Buffer | string) => {
          const text = String(chunk);
          if (!text.trim()) return;
          tail = `${tail}\n${text}`.slice(-4000);
          onProgress?.(text);
        };
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
  await fs.writeFile(workerFile(), WORKER_SOURCE, "utf8");
  onProgress?.("worker 已就绪；首次检索会自动下载模型（约 30MB，走国内镜像）");
  disposeKbEmbedWorker();
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
    env: { ...toolchainEnv(), HF_ENDPOINT: process.env.HF_ENDPOINT || "https://hf-mirror.com" },
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

/** 本地 embedding：文本 → 向量。模型首次使用会下载（走 hf-mirror），超时给足。 */
export async function embedWithLocalBackend(texts: string[], timeoutMs = 180_000): Promise<number[][]> {
  if (!kbEmbeddingInstalled()) throw new Error("kb-embedding 未安装");
  const child = ensureWorker();
  if (!child.stdin) throw new Error("embedding 子进程 stdin 不可用");
  const id = ++workerSeq;
  return new Promise<number[][]>((resolve, reject) => {
    const timer = setTimeout(() => { pendingCalls.delete(id); reject(new Error("embedding 超时（首次下载模型可能较慢，稍后重试）")); }, timeoutMs);
    pendingCalls.set(id, { resolve, reject, timer });
    child.stdin!.write(JSON.stringify({ id, texts }) + "\n");
  });
}
