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
import { createReadStream, createWriteStream, existsSync, statSync } from "fs";
import { mkdir, rename, stat, unlink } from "fs/promises";
import { dirname, join } from "path";
import { MODEL_HOSTS, modelUrl, type VoiceModelRepo } from "./model-manifest";

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
  onBytes: (received: number, total: number) => void
): Promise<DownloadOneResult> {
  const partPath = `${destPath}.part`;
  await mkdir(dirname(destPath), { recursive: true });

  const partStat = await stat(partPath).catch(() => null);
  const resumeFrom = partStat?.isFile() ? partStat.size : 0;

  const headers: Record<string, string> = { "user-agent": "codex-harness-voice/1.0" };
  if (resumeFrom > 0) headers.range = `bytes=${resumeFrom}-`;

  let response: Response;
  try {
    response = await fetch(modelUrl(host, repo, file), { headers });
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
 * 确保一个仓库的全部文件就绪；已就绪的文件跳过。
 * 返回失败列表（空数组 = 全部成功）。
 */
export async function ensureRepo(
  modelsRoot: string,
  repo: VoiceModelRepo,
  onProgress?: (p: VoiceDownloadProgress) => void
): Promise<string[]> {
  const failures: string[] = [];
  const total = repo.files.length;
  let done = 0;

  for (const f of repo.files) {
    const dest = modelFilePath(modelsRoot, repo.repo, f.name);
    if (await isFileReady(modelsRoot, repo.repo, f.name, f.sha256)) {
      done += 1;
      onProgress?.({
        repo: repo.repo,
        file: f.name,
        doneFiles: done,
        totalFiles: total,
        percent: 100,
        message: `${f.name} 已就绪`,
      });
      continue;
    }

    let lastError = "";
    let ok = false;
    for (const host of MODEL_HOSTS) {
      onProgress?.({
        repo: repo.repo,
        file: f.name,
        doneFiles: done,
        totalFiles: total,
        percent: 0,
        message: `下载 ${f.name}（${host.replace(/^https?:\/\//, "")}）`,
      });
      const result = await downloadOne(host, repo.repo, f.name, dest, f.sha256, (received, bytes) => {
        onProgress?.({
          repo: repo.repo,
          file: f.name,
          doneFiles: done,
          totalFiles: total,
          percent: bytes > 0 ? Math.min(99, Math.round((received / bytes) * 100)) : -1,
          message: `下载 ${f.name} ${bytes > 0 ? `${Math.round((received / bytes) * 100)}%` : ""}`,
        });
      });
      if (result.ok) {
        ok = true;
        break;
      }
      lastError = result.error;
    }

    if (!ok) {
      failures.push(`${f.name}：${lastError || "两个镜像均失败"}`);
      continue;
    }
    done += 1;
  }

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
