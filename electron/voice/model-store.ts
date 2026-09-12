/**
 * 语音模型仓库：下载 / 校验 / 断点续传。
 *
 * 设计要点（都踩过坑）：
 * - **双镜像轮换**：HuggingFace 官方主源 + hf-mirror 兜底；一个源校验失败就换下一个。
 * - **流式**：160MB 的模型不整块读进内存；下载与 SHA256 都走流。
 * - **断点续传**：`.part` 临时文件 + Range 请求。注意镜像/CDN 可能忽略 Range 返回 200
 *   全量，此时必须从头重写，不能追加（否则文件损坏）。
 * - **不抛未捕获异常**：所有失败都收敛成返回值，避免拖垮主进程启动链。
 */

import { createHash } from "crypto";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, statSync } from "fs";
import { copyFile, mkdir, open, rename, stat, unlink } from "fs/promises";
import { basename, dirname, join } from "path";
import { MODEL_HOSTS, modelUrl, type VoiceModelFile, type VoiceModelRepo, ZIPVOICE_DIR, ZIPVOICE_ARCHIVE, zipvoiceReady } from "./model-manifest";

export type VoiceDownloadProgress = {
  /** 当前仓库 id */
  repo: string;
  /** 当前文件（相对仓库根） */
  file: string;
  /** 已完成的文件数 / 总数 */
  doneFiles: number;
  totalFiles: number;
  /** 当前文件百分比 0~100，未知时 -1 */
  percent: number;
  /** 人类可读的当前状态 */
  message: string;
};

/** 仓库在本地磁盘的目录。repo 里的斜杠会变成一层子目录。 */
export function repoDir(modelsRoot: string, repo: string): string {
  return join(modelsRoot, ...repo.split("/"));
}

export function modelFilePath(modelsRoot: string, repo: string, file: string): string {
  return join(repoDir(modelsRoot, repo), ...file.split("/"));
}

/** 流式算 SHA256（不把文件读进内存）。 */
export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function fileShaOrEmpty(path: string): Promise<string> {
  try {
    const st = await stat(path);
    if (!st.isFile()) return "";
    return await sha256File(path);
  } catch {
    return "";
  }
}

/** 单个文件是否已就绪（存在且校验通过）。 */
export async function isFileReady(
  modelsRoot: string,
  repo: string,
  file: string,
  sha256: string
): Promise<boolean> {
  const p = modelFilePath(modelsRoot, repo, file);
  if (!existsSync(p)) return false;
  return (await fileShaOrEmpty(p)) === sha256;
}

/** 仓库是否全部文件就绪（用每个文件逐个校验，避免「下了半个」被当成好了）。 */
export async function isRepoReady(modelsRoot: string, repo: VoiceModelRepo): Promise<boolean> {
  for (const f of repo.files) {
    if (!(await isFileReady(modelsRoot, repo.repo, f.name, f.sha256))) return false;
  }
  return true;
}

/**
 * 找到 repo 在 sourceRoot 下的实际位置（容忍三种常见布局）：
 *   A) `<sourceRoot>/<repoId>/...`              （标准 HF 快照布局）
 *   B) `<sourceRoot>/<basename(repoId)>/...`    （只含最后一段）
 *   C) `<sourceRoot>` 本身就是仓库根目录     （直接把模型下到 sourceRoot）
 *   D) `<sourceRoot>` 的 basename == repoId     （zip 解压后只剩一段名字）
 * 找不到返回 null，并把缺失详情抛到 failures。
 */
function resolveRepoSourceDir(sourceRoot: string, repo: VoiceModelRepo): { dir: string; matchedAs: string } | null {
  const last = repo.repo.includes("/") ? repo.repo.split("/").pop()! : null;
  const candidates: { name: string; dir: string }[] = [];
  for (const n of [repo.repo, last].filter(Boolean) as string[]) {
    const d = join(sourceRoot, n);
    if (existsSync(d)) candidates.push({ name: n, dir: d });
  }
  if (basename(sourceRoot) === repo.repo || (last && basename(sourceRoot) === last)) {
    candidates.push({ name: basename(sourceRoot), dir: sourceRoot });
  }
  // 探测：sourceRoot 下直接放着 repo 的第一个文件（说明 sourceRoot 本身是 repo 根）
  const probe = repo.files[0];
  if (probe && existsSync(join(sourceRoot, probe.name))) {
    candidates.push({ name: "(根目录直接放文件)", dir: sourceRoot });
  }
  return candidates[0] ? { dir: candidates[0].dir, matchedAs: candidates[0].name } : null;
}

/**
 * 从本地目录导入一个仓库：把 `<sourceRoot>/<repoId>/<file>` 复制到 `<modelsRoot>/<repoId>/<file>`，
 * 校验 SHA256 通过后落盘。**用于开发版**：开发者自己下好模型后，不必走网络再下一次。
 *
 * 与 ensureRepo 不同：不会联网；不会断点续传；源文件存在性是硬要求（缺文件就当失败并列出）。
 */
export async function importRepoFromDir(
  modelsRoot: string,
  sourceRoot: string,
  repo: VoiceModelRepo,
  onProgress?: (p: VoiceDownloadProgress) => void
): Promise<string[]> {
  const failures: string[] = [];
  const total = repo.files.length;
  let done = 0;
  const resolved = resolveRepoSourceDir(sourceRoot, repo);
  if (!resolved) {
    const last = repo.repo.includes("/") ? repo.repo.split("/").pop()! : repo.repo;
    failures.push(`找不到仓库目录；期望以下任一布局：\n  • <sourceRoot>/${repo.repo}/ （HF 标准快照）\n  • <sourceRoot>/${last}/ （只含仓库最后一段）\n  • 直接选仓库根目录（里面应是：${repo.files.slice(0, 3).map((f) => f.name).join("、")}... 等 ${repo.files.length} 个文件）`);
    return failures;
  }
  const repoDir = resolved.dir;
  onProgress?.({ repo: repo.repo, file: "(目录)", doneFiles: 0, totalFiles: total, percent: 0, message: `识别为 ${resolved.matchedAs}` });

  for (const f of repo.files) {
    const src = join(repoDir, f.name);
    const dest = modelFilePath(modelsRoot, repo.repo, f.name);
    const partPath = `${dest}.part`;
    onProgress?.({ repo: repo.repo, file: f.name, doneFiles: done, totalFiles: total, percent: 0, message: `导入 ${f.name}` });
    if (!existsSync(src)) {
      done += 1;
      failures.push(`${f.name}：在 ${repoDir} 里没找到（期望 SHA256 ${f.sha256.slice(0, 8)}…）`);
      onProgress?.({ repo: repo.repo, file: f.name, doneFiles: done, totalFiles: total, percent: 100, message: `${f.name} 源目录里没有` });
      continue;
    }
    try {
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(src, partPath);
      const sha = await sha256File(partPath);
      if (sha !== f.sha256) {
        await unlink(partPath).catch(() => undefined);
        failures.push(`${f.name}：SHA256 不匹配（实际 ${sha.slice(0, 8)}…，期望 ${f.sha256.slice(0, 8)}…）`);
        onProgress?.({ repo: repo.repo, file: f.name, doneFiles: done + 1, totalFiles: total, percent: 100, message: `${f.name} SHA256 不匹配` });
      } else {
        await rename(partPath, dest);
        onProgress?.({ repo: repo.repo, file: f.name, doneFiles: done + 1, totalFiles: total, percent: 100, message: `${f.name} 已导入` });
      }
    } catch (error: any) {
      failures.push(`${f.name}：${error?.message ?? error}`);
    }
    done += 1;
  }
  return failures;
}

type DownloadOneResult = { ok: true } | { ok: false; error: string };

/**
 * 下载单个文件到目标路径，带校验与断点续传。
 * 逐个 host 尝试；任一 host 校验通过即成功。
 */
async function downloadOne(
  host: string,
  repo: string,
  file: string,
  destPath: string,
  expectedSha: string,
  onBytes: (received: number, total: number) => void,
  opts?: { signal?: AbortSignal }
): Promise<DownloadOneResult> {
  const partPath = `${destPath}.part`;
  await mkdir(dirname(destPath), { recursive: true });

  const partStat = await stat(partPath).catch(() => null);
  const resumeFrom = partStat?.isFile() ? partStat.size : 0;

  const headers: Record<string, string> = { "user-agent": "codex-harness-voice/1.0" };
  if (resumeFrom > 0) headers.range = `bytes=${resumeFrom}-`;

  let response: Response;
  try {
    response = await fetch(modelUrl(host, repo, file), { headers, signal: opts?.signal });
  } catch (error: any) {
    return { ok: false, error: `请求失败：${error?.message ?? error}` };
  }

  // 416 = 我们请求的起点已到文件末尾：可能 .part 其实已经完整，先校验再说
  if (response.status === 416) {
    if ((await fileShaOrEmpty(partPath)) === expectedSha) {
      await rename(partPath, destPath);
      return { ok: true };
    }
    await unlink(partPath).catch(() => undefined);
    return { ok: false, error: "续传起点越界且校验不符" };
  }
  if (response.status !== 200 && response.status !== 206) {
    return { ok: false, error: `HTTP ${response.status}` };
  }

  // 只有 206 才是真的续传；镜像忽略 Range 返回 200 时必须从头写。
  const resume = response.status === 206 ? resumeFrom : 0;
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  const total = contentLength > 0 ? contentLength + resume : 0;

  if (!response.body) return { ok: false, error: "响应无 body" };

  try {
    const sink = createWriteStream(partPath, resume > 0 ? { flags: "a" } : {});
    const reader = (response.body as any).getReader();
    let received = resume;
    let lastReport = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!sink.write(value)) {
        await new Promise<void>((resolve) => sink.once("drain", () => resolve()));
      }
      received += value.byteLength;
      // 每 2MB 报一次进度，避免刷爆 IPC
      if (received - lastReport > 2 * 1024 * 1024) {
        lastReport = received;
        onBytes(received, total);
      }
    }
    await new Promise<void>((resolve, reject) => {
      sink.end(() => resolve());
      sink.on("error", reject);
    });
  } catch (error: any) {
    return { ok: false, error: `写入失败：${error?.message ?? error}` };
  }

  const got = await fileShaOrEmpty(partPath);
  if (got !== expectedSha) {
    await unlink(partPath).catch(() => undefined);
    return { ok: false, error: got ? "SHA256 校验不符" : "落盘文件读不到" };
  }
  try {
    await rename(partPath, destPath);
  } catch (error: any) {
    return { ok: false, error: `重命名失败：${error?.message ?? error}` };
  }
  return { ok: true };
}

/**
 * HEAD 探测文件大小与延迟。
 * 返回 { host, size, latencyMs }，调用方按 size>0 + latencyMs 升序选最快的可用镜像。
 */
async function probeFile(
  host: string,
  repo: string,
  file: string,
  signal?: AbortSignal
): Promise<{ host: string; size: number; latencyMs: number; ok: boolean; error?: string }> {
  const t0 = Date.now();
  try {
    const res = await fetch(modelUrl(host, repo, file), { method: "HEAD", signal });
    const size = Number(res.headers.get("content-length") ?? 0);
    return { host, size, latencyMs: Date.now() - t0, ok: res.ok && size > 0 };
  } catch (error: any) {
    return { host, size: 0, latencyMs: Date.now() - t0, ok: false, error: String(error?.message ?? error) };
  }
}

/** 并发探测一个仓库下所有文件，按「可用主机 + 速度」排序取最优。 */
export async function probeHosts(
  hosts: readonly string[],
  repo: VoiceModelRepo,
  opts?: { signal?: AbortSignal }
): Promise<{ host: string; size: number; latencyMs: number }[]> {
  // 对每个 host 抽测前两个文件，取其最差延迟作代表（保守）
  const perHostProbes = await Promise.all(
    hosts.map(async (h) => {
      const probes = await Promise.all(
        repo.files.slice(0, 2).map((f) => probeFile(h, repo.repo, f.name, opts?.signal))
      );
      return { host: h, probes };
    })
  );
  // 每个 host 取其最差延迟（最保守：按最难的文件算）+ 任一成功 size 作为该 host 的代表 size
  const byHost = new Map<string, { size: number; worstLatency: number }>();
  for (const { host, probes } of perHostProbes) {
    for (const r of probes) {
      if (!r.ok) continue;
      const cur = byHost.get(host) ?? { size: 0, worstLatency: 0 };
      cur.size = cur.size || r.size;
      cur.worstLatency = Math.max(cur.worstLatency, r.latencyMs);
      byHost.set(host, cur);
    }
  }
  return [...byHost.entries()]
    .map(([host, { size, worstLatency }]) => ({ host, size, latencyMs: worstLatency }))
    .sort((a, b) => a.latencyMs - b.latencyMs);
}

/** 多少字节以上的文件才走分块并行下载（小于它的不值得分块开销）。 */
const PARALLEL_MIN_BYTES = 24 * 1024 * 1024; // 24MB
const PARALLEL_CHUNKS = 4;

/**
 * 大文件分块并行下载（用 Range 拆成 N 段，并发拉，写到不同偏移）。
 * 服务端必须支持 Range 头（HF / hf-mirror 都支持）。不支持时降级为单流。
 * 末尾统一验 SHA256。
 */
async function downloadParallel(
  host: string,
  repo: string,
  file: string,
  destPath: string,
  expectedSha: string,
  onBytes: (received: number, total: number) => void,
  signal?: AbortSignal
): Promise<DownloadOneResult> {
  const partPath = `${destPath}.part`;
  await mkdir(dirname(destPath), { recursive: true });

  // 1) 拿总大小
  const probe = await probeFile(host, repo, file, signal);
  if (!probe.ok || probe.size <= 0) {
    return { ok: false, error: `分块探测失败：${probe.error ?? "no content-length"}` };
  }
  const total = probe.size;

  // 2) 拆成 N 段
  const chunkSize = Math.ceil(total / PARALLEL_CHUNKS);
  const ranges = Array.from({ length: PARALLEL_CHUNKS }, (_, i) => {
    const start = i * chunkSize;
    const end = Math.min(total - 1, start + chunkSize - 1);
    return { start, end, idx: i };
  });

  // 3) 预创建 + 预分配目标文件（让后续分块 fd 以 r+ 打开时直接定位写入位置；
  //    预分配让单文件大小不会因为延迟写入而出现"先稀疏再补洞"的碎片）
  {
    const wfh = await open(partPath, "w");
    try { await wfh.truncate(total); } finally { await wfh.close().catch(() => undefined); }
  }

  // 4) 并发拉各段：每个分块自己持有 fd 顺序写自己那段（开/关各一次，避开旧版每片 open/close）
  const perChunk = new Array(ranges.length).fill(0);

  const tasks = ranges.map(async (chunk) => {
    const headers: Record<string, string> = {
      "user-agent": "codex-harness-voice/1.0",
      range: `bytes=${chunk.start}-${chunk.end}`,
    };
    let res: Response;
    try {
      res = await fetch(modelUrl(host, repo, file), { headers, signal });
    } catch (e: any) {
      throw new Error(`分块 ${chunk.idx} 请求失败：${e?.message ?? e}`);
    }
    if (res.status !== 206 && res.status !== 200) {
      throw new Error(`分块 ${chunk.idx} HTTP ${res.status}`);
    }
    if (!res.body) throw new Error(`分块 ${chunk.idx} 无 body`);
    const reader = (res.body as any).getReader();
    const fh = await open(partPath, "r+");
    let offset = chunk.start;
    let received = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await fh.write(value, 0, value.byteLength, offset);
        offset += value.byteLength;
        received += value.byteLength;
        perChunk[chunk.idx] = received;
        const totalReceived = perChunk.reduce((s, n) => s + n, 0);
        onBytes(totalReceived, total);
      }
    } finally {
      await fh.close().catch(() => undefined);
    }
  });

  try {
    await Promise.all(tasks);
  } catch (error: any) {
    await unlink(partPath).catch(() => undefined);
    return { ok: false, error: `分块下载失败：${error?.message ?? error}` };
  }

  // 5) 验 SHA256
  if ((await fileShaOrEmpty(partPath)) !== expectedSha) {
    await unlink(partPath).catch(() => undefined);
    return { ok: false, error: "分块下载 SHA256 校验不符" };
  }

  // 6) 改名
  try { await rename(partPath, destPath); }
  catch (error: any) { return { ok: false, error: `重命名失败：${error?.message ?? error}` }; }

  return { ok: true };
}

/** 单文件下载入口：大文件走分块并行，否则走单流；任一失败都允许上层换 host 重试。 */
async function downloadFile(
  host: string,
  repo: string,
  file: string,
  bytes: number,
  destPath: string,
  expectedSha: string,
  onBytes: (received: number, total: number) => void,
  opts?: { signal?: AbortSignal }
): Promise<DownloadOneResult> {
  if (bytes >= PARALLEL_MIN_BYTES) {
    return downloadParallel(host, repo, file, destPath, expectedSha, onBytes, opts?.signal);
  }
  return downloadOne(host, repo, file, destPath, expectedSha, onBytes, opts);
}

/**
 * 确保一个仓库的全部文件就绪；已就绪的文件跳过。
 * 返回失败列表（空数组 = 全部成功）。
 */
export async function ensureRepo(
  modelsRoot: string,
  repo: VoiceModelRepo,
  onProgress?: (p: VoiceDownloadProgress) => void,
  opts?: { hosts?: readonly string[]; concurrency?: number; signal?: AbortSignal }
): Promise<string[]> {
  const hosts = opts?.hosts?.length ? opts.hosts : MODEL_HOSTS;
  const total = repo.files.length;
  const concurrency = Math.max(1, Math.min(opts?.concurrency ?? 4, total));
  const failures: string[] = [];
  let done = 0;
  const queue: VoiceModelFile[] = [...repo.files];
  // 节流：每个文件只在上次报告的百分比变化 ≥ 1% 时才发一次进度（避免并发下载刷爆 IPC）
  const lastPercent = new Map<string, number>();
  let activeCount = 0;

  const reportDone = (file: string) => {
    done += 1;
    lastPercent.delete(file);
    onProgress?.({
      repo: repo.repo,
      file,
      doneFiles: done,
      totalFiles: total,
      percent: 100,
      message: `${file} 完成（${done}/${total} · 并行 ${Math.max(1, activeCount - 1)}）`,
    });
  };
  const reportStart = (file: string, host: string) => {
    lastPercent.set(file, 0);
    onProgress?.({
      repo: repo.repo,
      file,
      doneFiles: done,
      totalFiles: total,
      percent: 0,
      message: `下载 ${file}（${host.replace(/^https?:\/\//, "")}）· 并行 ${activeCount}/${concurrency}`,
    });
  };
  const reportProgress = (file: string, received: number, bytes: number, host: string) => {
    const pct = bytes > 0 ? Math.min(99, Math.round((received / bytes) * 100)) : -1;
    if (pct >= 0 && lastPercent.get(file) === pct) return;
    lastPercent.set(file, pct);
    onProgress?.({
      repo: repo.repo,
      file,
      doneFiles: done,
      totalFiles: total,
      percent: pct,
      message: `下载 ${file} ${pct >= 0 ? pct + "%" : ""} · ${host.replace(/^https?:\/\//, "")}`,
    });
  };

  async function processFile(f: VoiceModelFile): Promise<void> {
    if (await isFileReady(modelsRoot, repo.repo, f.name, f.sha256)) {
      reportDone(f.name);
      return;
    }
    const dest = modelFilePath(modelsRoot, repo.repo, f.name);
    let lastError = "";
    let ok = false;
    for (const host of hosts) {
      reportStart(f.name, host);
      const result = await downloadFile(host, repo.repo, f.name, f.bytes, dest, f.sha256, (received, bytes) => {
        reportProgress(f.name, received, bytes, host);
      }, { signal: opts?.signal });
      if (result.ok) { ok = true; break; }
      lastError = result.error;
    }
    if (!ok) failures.push(`${f.name}：${lastError || "所有镜像均失败"}`);
    else reportDone(f.name);
  }

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const f = queue.shift();
      if (!f) return;
      activeCount += 1;
      try { await processFile(f); }
      finally { activeCount -= 1; }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, total) }, () => worker())
  );
  return failures;
}

/** 语音模型总体状态（给 UI 用）。 */
export type VoiceModelsStatus = {
  /** 模型根目录 */
  root: string;
  /** 是否全部就绪（可用语音功能） */
  ready: boolean;
  /** 缺失的文件名列表（最多列 8 条） */
  missing: string[];
  /** 已就绪文件数 / 总数 */
  readyFiles: number;
  totalFiles: number;
};

export async function voiceModelsStatus(
  modelsRoot: string,
  repos: VoiceModelRepo[]
): Promise<VoiceModelsStatus> {
  const missing: string[] = [];
  let readyFiles = 0;
  let totalFiles = 0;
  for (const repo of repos) {
    for (const f of repo.files) {
      totalFiles += 1;
      if (await isFileReady(modelsRoot, repo.repo, f.name, f.sha256)) {
        readyFiles += 1;
      } else if (missing.length < 8) {
        missing.push(f.name);
      }
    }
  }
  return {
    root: modelsRoot,
    ready: readyFiles === totalFiles && totalFiles > 0,
    missing,
    readyFiles,
    totalFiles,
  };
}

/** 磁盘占用（字节），目录不存在时返回 0。 */
export function modelsSizeOnDisk(modelsRoot: string): number {
  let total = 0;
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    let entries: string[] = [];
    try {
      entries = require("fs").readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const p = join(dir, name);
      try {
        const st = statSync(p);
        if (st.isDirectory()) walk(p);
        else total += st.size;
      } catch {
        /* 忽略单个文件的读取失败 */
      }
    }
  };
  walk(modelsRoot);
  return total;
}

// ── 归档型资源：音色克隆模型（ZipVoice，GitHub release tar.bz2）────────────────
// 与 HF 逐文件仓库不同：整包下载 → SHA256 校验 → 解压到 modelsRoot → 声码器单独下载。
// 按需下载，不进安装包（与其它语音模型一致）。

/** 单流下载到文件（带进度与 SHA256 校验）。GitHub release 场景不需要多段并发。 */
async function downloadUrlToFile(
  url: string,
  destPath: string,
  sha256: string,
  bytes: number,
  onBytes?: (received: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await mkdir(dirname(destPath), { recursive: true });
    const response = await fetch(url, { redirect: "follow", signal: signal as any });
    if (!response.ok || !response.body) return { ok: false, error: "下载失败 HTTP " + response.status };
    const total = Number(response.headers.get("content-length") ?? 0) || bytes;
    const hash = createHash("sha256");
    const out = createWriteStream(destPath);
    let received = 0;
    const reader = (response.body as any).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      received += chunk.length;
      hash.update(chunk);
      if (!out.write(chunk)) await new Promise<void>((resolve) => out.once("drain", () => resolve()));
      onBytes?.(received, total);
      if (signal?.aborted) throw new Error("已取消");
    }
    await new Promise<void>((resolve, reject) => out.end(() => resolve()).on("error", reject));
    if (sha256 && hash.digest("hex") !== sha256) {
      await unlink(destPath).catch(() => undefined);
      return { ok: false, error: "SHA256 校验失败（下载损坏），请重试" };
    }
    return { ok: true };
  } catch (error: any) {
    await unlink(destPath).catch(() => undefined);
    return { ok: false, error: String(error?.message ?? error) };
  }
}

/** 解压 tar.bz2：**优先随包 Python**（`tarfile` + `_bz2.pyd` 原生支持，跨平台一致）。
 *  实测坑：Windows 自带 bsdtar 报 `Can't initialize filter; unable to run program "bzip2 -d"`
 *  （bsdtar 不内置 bz2，系统又没有 bzip2 程序）；随包 7z 26.02 对该 .tar.bz2 报
 *  `Cannot open as archive`。所以 Python 是首选，tar/7z 仅作最后的回落。 */
async function extractTarBz2(archivePath: string, destDir: string, resourcesToolsDir: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const run = (cmd: string, args: string[]) =>
    new Promise<{ code: number | null; stderr: string }>((resolve) => {
      const child = spawn(cmd, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
      child.on("error", (error) => resolve({ code: -1, stderr: String(error.message) }));
      child.on("exit", (code) => resolve({ code, stderr }));
    });

  await mkdir(destDir, { recursive: true });

  const python = join(resourcesToolsDir, "python", process.platform === "win32" ? "python.exe" : "bin/python3");
  if (existsSync(python)) {
    const py = await run(python, ["-c", "import sys, tarfile; tarfile.open(sys.argv[1]).extractall(sys.argv[2])", archivePath, destDir]);
    if (py.code === 0) return { ok: true };
  }

  const tar = await run("tar", ["-xjf", archivePath, "-C", destDir]);
  if (tar.code === 0) return { ok: true };

  const sevenZip = join(resourcesToolsDir, "sevenzip", process.platform === "win32" ? "7z.exe" : "7z");
  if (!existsSync(sevenZip)) {
    return { ok: false, error: "解压失败（随包 Python 不可用，tar: " + tar.stderr.slice(-120) + "），且未找到随包 7z" };
  }
  const stage = await run(sevenZip, ["x", archivePath, "-o" + destDir, "-y"]);
  if (stage.code !== 0) return { ok: false, error: "7z 解压失败：" + stage.stderr.slice(-160) };
  const inner = archivePath.replace(/\.bz2$/, "");
  if (existsSync(inner)) {
    const second = await run(sevenZip, ["x", inner, "-o" + destDir, "-y"]);
    if (second.code !== 0) return { ok: false, error: "7z 二次解压失败：" + second.stderr.slice(-160) };
    await unlink(inner).catch(() => undefined);
  }
  return { ok: true };
}

/** 安装/补齐音色克隆模型（ZipVoice + vocos 声码器）。已就绪时直接返回。 */
export async function ensureZipvoice(
  modelsRoot: string,
  resourcesToolsDir: string,
  onProgress?: (p: VoiceDownloadProgress) => void,
  signal?: AbortSignal,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (zipvoiceReady(modelsRoot)) return { ok: true };
  const report = (file: string, percent: number, message: string, doneFiles: number, totalFiles: number) =>
    onProgress?.({ repo: ZIPVOICE_DIR, file, doneFiles, totalFiles, percent, message });

  const dir = join(modelsRoot, ZIPVOICE_DIR);
  const needMain = ZIPVOICE_ARCHIVE.readyFiles.some((name) => {
    try { return statSync(join(dir, name)).size <= 0; } catch { return true; }
  });

  if (needMain) {
    const archivePath = join(modelsRoot, ".cache", ZIPVOICE_DIR + ".tar.bz2");
    const cached = existsSync(archivePath)
      ? await sha256File(archivePath).then((h) => h === ZIPVOICE_ARCHIVE.sha256).catch(() => false)
      : false;
    if (!cached) {
      report("模型包", 0, "正在下载音色克隆模型（约 109MB）…", 0, 2);
      const downloaded = await downloadUrlToFile(
        ZIPVOICE_ARCHIVE.url, archivePath, ZIPVOICE_ARCHIVE.sha256, ZIPVOICE_ARCHIVE.bytes,
        (received, total) => report("模型包", total ? Math.round((received / total) * 100) : -1,
          "正在下载音色克隆模型 " + (received / 1048576).toFixed(0) + "/" + (total / 1048576).toFixed(0) + "MB", 0, 2),
        signal,
      );
      if (!downloaded.ok) return downloaded;
    }
    report("模型包", 100, "正在解压音色克隆模型…", 0, 2);
    const extracted = await extractTarBz2(archivePath, modelsRoot, resourcesToolsDir);
    if (!extracted.ok) return extracted;
    await unlink(archivePath).catch(() => undefined);
  }

  const vocoderPath = join(dir, ZIPVOICE_ARCHIVE.vocoder.name);
  const vocoderOk = existsSync(vocoderPath)
    && (await sha256File(vocoderPath).then((h) => h === ZIPVOICE_ARCHIVE.vocoder.sha256).catch(() => false));
  if (!vocoderOk) {
    report(ZIPVOICE_ARCHIVE.vocoder.name, 0, "正在下载声码器（约 54MB）…", 1, 2);
    const result = await downloadUrlToFile(
      ZIPVOICE_ARCHIVE.vocoder.url, vocoderPath, ZIPVOICE_ARCHIVE.vocoder.sha256, ZIPVOICE_ARCHIVE.vocoder.bytes,
      (received, total) => report(ZIPVOICE_ARCHIVE.vocoder.name, total ? Math.round((received / total) * 100) : -1,
        "正在下载声码器 " + (received / 1048576).toFixed(0) + "/" + (total / 1048576).toFixed(0) + "MB", 1, 2),
      signal,
    );
    if (!result.ok) return result;
  }

  report("完成", 100, "音色克隆模型就绪", 2, 2);
  return { ok: true };
}
