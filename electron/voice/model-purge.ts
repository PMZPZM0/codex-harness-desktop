/**
 * 语音模型目录的「逐文件删除 + 失败重试 + 进度回调」（11-21）。
 *
 * ⛔⛔ 为什么不能只写 `fs.rm(dir, { recursive: true, force: true })`（旧实现就是这么干的）：
 *   ① **`force: true` 只忽略「不存在」，不忽略「被占用」**。语音模型的 onnx 由 worker
 *      子进程持有句柄，Windows 上删到那个文件就 EBUSY —— 整次 `rm` 抛错，前面删掉的一大半
 *      白删（用户看到的是「卸载失败」，磁盘上却已经少了一部分文件，状态变「未装全」）。
 *   ② **没有进度**：474MB、几千个文件，主进程闷头删十几秒，界面一动不动。
 *   ③ 抛错的 message 常常只有 `EBUSY: resource busy or locked, rmdir '...'`，看不出是哪个文件
 *      —— 用户拿到这句话毫无办法。
 *
 * 所以这里：先按字节数摊平成一个文件清单（拿到总量才能算百分比）→ 逐文件删（可重试的错误
 * 退避重试）→ 最后自底向上清空目录 → 把**删不掉的文件名 + 错误码**带回去。
 * 部分失败也算「删了大部分」：调用方据此决定报错文案，而不是把整次操作判成没做。
 */

import { existsSync, type Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

/** 删一个条目时值得重试的错误码（多为句柄还没释放 / 杀软在扫 / 目录里还有子项）。 */
const RETRYABLE = new Set(["EBUSY", "EPERM", "EACCES", "ENOTEMPTY", "EMFILE", "ENFILE"]);
/** 退避阶梯（毫秒）——总等待约 5.3s，足够让 `terminate()` 的子进程真正退出。 */
const BACKOFF_MS = [120, 250, 500, 900, 1500, 2000];

export type PurgeProgress = { percent: number; message: string };
export type PurgeFailure = { path: string; reason: string };
export type PurgeResult = { ok: boolean; failed: PurgeFailure[]; bytes: number; files: number };

/** 递归摊平成一个文件清单（目录单独收集，最后自底向上删）。读不到的条目直接跳过。 */
async function listTree(dir: string): Promise<{ files: { path: string; size: number }[]; dirs: string[] }> {
  const files: { path: string; size: number }[] = [];
  const dirs: string[] = [];
  const walk = async (current: string) => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return; // 读不到就交回上层：目录会在最后一步 rm 时再试
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        dirs.push(full);
        await walk(full);
      } else {
        let size = 0;
        try { size = (await fs.stat(full)).size; } catch { /* 读不到大小按 0 计（只影响百分比精度） */ }
        files.push({ path: full, size });
      }
    }
  };
  await walk(dir);
  return { files, dirs };
}

/** 删一个条目；可重试的错误退避重试。成功（含「已经不存在」）返回 null，否则返回错误码/文案。 */
async function removeWithRetry(target: string, isDir: boolean): Promise<string | null> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      if (isDir) await fs.rmdir(target);
      else await fs.unlink(target);
      return null;
    } catch (error) {
      const code = String((error as { code?: unknown })?.code ?? "");
      if (code === "ENOENT") return null; // 已经没了 = 目标达成（并发/上轮残留）
      if (!RETRYABLE.has(code) || attempt >= BACKOFF_MS.length) {
        return code || String((error as Error)?.message ?? error);
      }
      await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[attempt]));
    }
  }
}

/**
 * 删除整个目录，边删边报进度。
 *
 * @param dir        目标目录（调用方必须已完成路径白名单校验）
 * @param onProgress 进度回调：percent 为「已处理字节 / 总字节」，总量未知时为 -1（界面走不定态）
 */
export async function purgeDirWithProgress(
  dir: string,
  onProgress?: (progress: PurgeProgress) => void,
): Promise<PurgeResult> {
  const failed: PurgeFailure[] = [];
  if (!existsSync(dir)) {
    onProgress?.({ percent: 100, message: "目录不存在，无需删除" });
    return { ok: true, failed, bytes: 0, files: 0 };
  }

  const { files, dirs } = await listTree(dir);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const totalFiles = files.length || 1;
  onProgress?.({ percent: 0, message: `正在删除 ${files.length} 个文件（${Math.round(totalBytes / 1048576)} MB）…` });

  /* 逐文件删（并发 16）：模型目录是几千个中等文件，串行删要几十秒；并发太高又会和杀软抢 IO。
     进度按**已处理字节**算，这样大小文件混着也能匀速走到 100%。 */
  let handledBytes = 0;
  let index = 0;
  let lastReport = 0;
  const worker = async () => {
    for (;;) {
      const current = index;
      index += 1;
      const file = files[current];
      if (!file) return;
      const reason = await removeWithRetry(file.path, false);
      if (reason) failed.push({ path: file.path, reason });
      handledBytes += file.size;
      const now = Date.now();
      if (now - lastReport > 200 || handledBytes >= totalBytes) {
        lastReport = now;
        const percent = totalBytes > 0 ? Math.min(99, Math.round((handledBytes / totalBytes) * 100)) : Math.round(((current + 1) / totalFiles) * 98);
        onProgress?.({ percent, message: `已删除 ${current + 1} / ${files.length} 个文件…` });
      }
    }
  };
  await Promise.all(Array.from({ length: 16 }, () => worker()));

  /* 自底向上清空目录：清单是前序遍历，反转即「先子后父」。 */
  for (const sub of [...dirs].reverse()) {
    const reason = await removeWithRetry(sub, true);
    // ENOTEMPTY 只说明里面还有删不掉的文件（已记在 failed 里），不重复计
    if (reason && reason !== "ENOTEMPTY") failed.push({ path: sub, reason });
  }
  const rootReason = await removeWithRetry(dir, true);
  if (rootReason && rootReason !== "ENOTEMPTY") failed.push({ path: dir, reason: rootReason });

  const ok = failed.length === 0;
  onProgress?.({
    percent: 100,
    message: ok ? "已删除完成" : `有 ${failed.length} 个文件没删掉`,
  });
  return { ok, failed, bytes: totalBytes, files: files.length };
}
