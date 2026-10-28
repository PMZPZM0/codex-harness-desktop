/**
 * 引擎安装自愈（10-28 用户实测事故）—— 在线更新把 live vendor 目录搬走后，落位/回滚都失败，
 * `bin/codex.exe` 就彻底不见了：技能 / 钩子 / 插件三类读取一起报 `spawn … ENOENT`，
 * 用户看到的是「设置页一片红」，而真正的原因只是引擎文件不在。
 *
 * 本模块在**引擎启动前**跑一次：live 缺失就从上一代备份（`.bak-1`）或上次更新的解压产物
 * （`.engine-update-<时间戳>/extract/package/vendor/<target>`）里挑最新完整的一份搬回来。
 *
 * ⛔ 只在 live 缺失时动手：正常安装一次 `existsSync` 就返回，不做任何 IO。
 * ⛔ 不假设同卷：沿用 updater 的 rename → EXDEV 复制 兜底（C: 装系统 + D: 装应用是常见布局）。
 * ⛔ 不删 `.bak-1`：它是最后一手回滚副本，清理由 updater 在「live 确认在位」后自己做。
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { codexBinaryPath } from "./codex-server";

type Log = (message: string) => void;

export type EngineHealResult = { healed: boolean; from?: string; message: string };

function hasBinary(dir: string, exe: string): boolean {
  try { return fs.existsSync(path.join(dir, "bin", exe)); } catch { return false; }
}

function mtimeOf(dir: string): number {
  try { return fs.statSync(dir).mtimeMs; } catch { return 0; }
}

/** 整目录搬移：同卷 rename；跨卷（EXDEV）复制 + 删除；瞬时占用（EPERM/EBUSY/ENOTEMPTY）重试。 */
async function moveWithRetry(from: string, to: string): Promise<void> {
  let last: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (error) {
      last = error;
      const code = String((error as NodeJS.ErrnoException)?.code ?? "");
      if (code === "EXDEV") {
        await fsp.cp(from, to, { recursive: true, force: true, errorOnExist: false, dereference: false });
        await fsp.rm(from, { recursive: true, force: true });
        return;
      }
      if (attempt === 4 || !/^(EPERM|EBUSY|ENOTEMPTY)$/.test(code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** 清掉历次更新留下的暂存目录（只认 `.engine-update-*`；失败只记日志，不影响启动）。 */
async function cleanupUpdateDirs(vendorDir: string, log: Log): Promise<void> {
  const parent = path.dirname(vendorDir);
  let entries: fs.Dirent[] = [];
  try { entries = await fsp.readdir(parent, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(".engine-update-")) continue;
    try {
      await fsp.rm(path.join(parent, entry.name), { recursive: true, force: true, maxRetries: 3 });
    } catch (error) {
      log(`暂存目录清理失败（下次再试）：${entry.name} — ${(error as Error).message}`);
    }
  }
}

export async function healEngineInstall(log: Log = (message) => console.log(`[engine-heal] ${message}`)): Promise<EngineHealResult> {
  let bin: string;
  try {
    bin = codexBinaryPath();
  } catch (error) {
    return { healed: false, message: `引擎路径解析失败：${(error as Error).message}` };
  }
  const vendorDir = path.dirname(path.dirname(bin));
  const exe = path.basename(bin);
  if (hasBinary(vendorDir, exe)) {
    await cleanupUpdateDirs(vendorDir, log);
    return { healed: false, message: "引擎在位" };
  }

  const parent = path.dirname(vendorDir);
  const target = path.basename(vendorDir);
  const candidates: { dir: string; at: number }[] = [];
  const backup = `${vendorDir}.bak-1`;
  if (hasBinary(backup, exe)) candidates.push({ dir: backup, at: mtimeOf(backup) });
  try {
    for (const entry of await fsp.readdir(parent, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith(".engine-update-")) continue;
      const dir = path.join(parent, entry.name, "extract", "package", "vendor", target);
      // 解压产物是"已下载但没落位"的新版本，优先于更老的备份 —— 按目录时间取最新即可。
      if (hasBinary(dir, exe)) candidates.push({ dir, at: mtimeOf(dir) });
    }
  } catch { /* 父目录不可读：只剩备份候选 */ }

  candidates.sort((a, b) => b.at - a.at);
  for (const candidate of candidates) {
    try {
      await moveWithRetry(candidate.dir, vendorDir);
      if (hasBinary(vendorDir, exe)) {
        log(`引擎缺失，已从 ${candidate.dir} 恢复`);
        await cleanupUpdateDirs(vendorDir, log);
        return { healed: true, from: candidate.dir, message: "已从备份恢复引擎" };
      }
    } catch (error) {
      log(`从 ${candidate.dir} 恢复失败：${(error as Error).message}`);
    }
  }
  return { healed: false, message: "引擎缺失且没有可用备份：请在「设置 → 开发工具」重新安装 / 更新引擎" };
}
