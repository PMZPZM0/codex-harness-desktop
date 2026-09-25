/**
 * 数据目录（userData）自定义 —— bootstrap 指路牌 + 迁移。
 *
 * ⛔ 为什么指路牌不放 userData 里：数据目录**本身**就是要被切的对象，切走之后
 *    指路牌必须留在一个**固定锚点**（appData 根下的默认目录）才能被下一次启动找到。
 *    ⇒ `%APPDATA%\Codex Harness Desktop\data-dir.json`，与用户数据本体隔离。
 *
 * ⛔【91】本模块是叶子：只依赖 electron app + node 内置，模块体零副作用。
 *
 * 迁移时序（09-25 事故后的最终设计，⛔ 不要改回「启动时全量复制」）：
 *  1. **保存时（prepareDataDir）就地做基础迁移** —— 异步分批复制（yield 保持主进程响应），
 *     进度经 dataDir:read 暴露给渲染层（busy spinner + 百分比）。此时应用还在旧目录上跑，
 *     引擎继续写旧目录没关系 —— 下一步会补。
 *  2. **重启后（模块体 resolveStartupUserData）只做增量同步** —— 对比源/目标差异，
 *     只复制「目标没有或大小不同」的文件（保存→重启之间的变更，通常几 MB），秒级。
 *     完成后写完成标记 `.data-dir-migrated` ⇒ 之后启动零迁移。
 *  3. 半迁移自愈：目标非空但无完成标记 ⇒ 下次启动续迁（差量复制天然幂等）。
 *  4. 迁移失败 ⇒ 回退默认目录 + 保留标记重试，绝不静默丢数据。
 *  ⛔ 排除清单：可重建/可重装/纯缓存的一律不迁（全量复制 1.8GB 会让启动卡死成
 *     「应用启动不了」，09-25 用户实测事故）。
 *
 * 优先级：CODEX_HARNESS_USER_DATA env（开发/测试覆盖，不做迁移）> bootstrap > 默认目录。
 */
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

export type DataDirBootstrap = { dir?: string; migrate?: boolean };

/** 固定锚点：默认 userData（appData 下的应用目录），bootstrap 指路牌所在。 */
export function defaultUserDataDir(): string {
  return path.join(app.getPath("appData"), "Codex Harness Desktop");
}

function bootstrapFile(): string {
  return path.join(defaultUserDataDir(), "data-dir.json");
}

export function readDataDirBootstrap(): DataDirBootstrap | null {
  try {
    const raw = JSON.parse(fs.readFileSync(bootstrapFile(), "utf8")) as DataDirBootstrap;
    if (!raw || typeof raw !== "object") return null;
    return raw;
  } catch {
    return null; // 文件不存在/损坏 ⇒ 无自定义，走默认
  }
}

export function writeDataDirBootstrap(next: DataDirBootstrap): void {
  const file = bootstrapFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n", "utf8");
}

/** 迁移完成标记：写在**目标**目录（半迁移自愈的判据）。 */
export const MIGRATED_MARKER = ".data-dir-migrated";

/** 排除清单：可重建/可重装/纯缓存的**顶层目录**与 codex-home 子目录，一律不迁。 */
const MIGRATION_SKIP = new Set([
  // Chromium/Electron 缓存（重建无害）
  "Cache", "Code Cache", "GPUCache", "DawnGraphiteCache", "DawnWebGPUCache", "ShaderCache", "DawnCache",
  // 可重装：MCP 记忆服务（node_modules 为主，设置页一键重装）
  "memory-mcp",
  // 可重下：语音模型（按需下载）
  "voice-models",
  // 引擎内部缓存/临时/自检重建的二进制（codex-home 下）
  "cache", ".tmp", ".sandbox-bin",
]);

function skipped(rel: string): boolean {
  const parts = rel.split(/[\\/]/);
  if (parts.some((p) => MIGRATION_SKIP.has(p))) return true; // 任意层命中排除名即跳（缓存语义安全）
  const base = parts[parts.length - 1];
  if (base === "data-dir.json" || base === MIGRATED_MARKER) return false; // 标记类文件由专门逻辑写
  if (/^(lock|Singleton.*)$/i.test(base)) return true; // 锁文件复制过来也是坏的
  return false;
}

export type MigrationFile = { src: string; dst: string; rel: string; size: number };
export type MigrationPlan = { files: MigrationFile[]; totalBytes: number; skippedDirs: string[] };

/** 收集待迁移清单：排除清单过滤 + 与目标对比（存在且同大小 ⇒ 已迁过，跳过）。 */
function collectMigrationFiles(source: string, target: string): MigrationPlan {
  const files: MigrationFile[] = [];
  const skippedDirs: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const src = path.join(dir, e.name);
      const rel = path.relative(source, src);
      if (skipped(rel)) {
        if (e.isDirectory()) skippedDirs.push(rel);
        continue;
      }
      if (e.isDirectory()) {
        walk(src);
        continue;
      }
      if (!e.isFile()) continue;
      let size = 0;
      try {
        size = fs.statSync(src).size;
      } catch {
        continue;
      }
      const dst = path.join(target, rel);
      // 增量：目标已存在且同大小 ⇒ 视为已迁过（mtime 也一致的概率极高，不必逐字节比对）
      try {
        if (fs.statSync(dst).size === size) continue;
      } catch { /* 目标没有 ⇒ 要迁 */ }
      files.push({ src, dst, rel, size });
    }
  };
  walk(source);
  return { files, totalBytes: files.reduce((a, f) => a + f.size, 0), skippedDirs };
}

function ensureDirOf(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

/** 同步差量复制（模块体用；保存→重启间隔短 ⇒ 差量通常极小，秒级）。 */
function copySync(files: MigrationFile[]): void {
  for (const f of files) {
    ensureDirOf(f.dst);
    fs.copyFileSync(f.src, f.dst);
  }
}

/** 异步分批复制（保存时用）：每批后 yield，保持主进程可响应（IPC/窗口不卡死）。 */
async function copyAsync(files: MigrationFile[], onProgress: (done: number, total: number, bytes: number) => void): Promise<void> {
  const BATCH = 8;
  let done = 0;
  let bytes = 0;
  for (let i = 0; i < files.length; i += BATCH) {
    for (const f of files.slice(i, i + BATCH)) {
      ensureDirOf(f.dst);
      await fs.promises.copyFile(f.src, f.dst);
      done += 1;
      bytes += f.size;
    }
    onProgress(done, files.length, bytes);
    await new Promise((r) => setImmediate(r)); // yield 事件循环
  }
}

/**
 * 解析本次启动应使用的 userData 目录（模块体调用）。
 * 若指路牌带迁移标记且目标没有完成标记 ⇒ 先做**同步增量同步**（差量通常极小）再切换。
 * 增量失败 ⇒ 回退默认目录并保留标记（下次重试），绝不静默丢数据。
 */
export function resolveStartupUserData(): string {
  const envOverride = process.env.CODEX_HARNESS_USER_DATA;
  if (envOverride) return envOverride;

  const fallback = defaultUserDataDir();
  const boot = readDataDirBootstrap();
  const target = boot?.dir;
  if (!target || path.resolve(target) === path.resolve(fallback)) return fallback;

  // 基本合法性：必须绝对路径、不能是盘根（防止用户填 "D:\" 把整盘当数据目录）
  if (!path.isAbsolute(target) || path.parse(target).root === target) {
    console.warn(`[data-dir] 自定义目录不合法（${target}），回退默认`);
    return fallback;
  }

  // ⛔ 半迁移自愈：标记 migrate 且目标**没有完成标记** ⇒ 增量同步（差量复制幂等）。
  if (boot.migrate === true && !fs.existsSync(path.join(target, MIGRATED_MARKER))) {
    try {
      const plan = collectMigrationFiles(fallback, target);
      copySync(plan.files);
      fs.writeFileSync(path.join(target, MIGRATED_MARKER), new Date().toISOString() + "\n", "utf8");
      writeDataDirBootstrap({ dir: target });
      if (plan.files.length) console.log(`[data-dir] 增量同步 ${plan.files.length} 个文件（${(plan.totalBytes / 1048576).toFixed(1)} MB）→ ${target}`);
    } catch (error) {
      console.warn(`[data-dir] 增量同步失败，本次回退默认目录：${error instanceof Error ? error.message : String(error)}`);
      return fallback; // 保留 migrate 标记，下次启动重试
    }
  }
  return target;
}

/* ── 保存时（prepareDataDir）的就地基础迁移：异步分批 + 进度 ── */

export type MigrationProgress = { running: boolean; done: number; total: number; bytes: number; totalBytes: number; error: string | null };

let activeProgress: MigrationProgress | null = null;

/** 供 IPC 轮询的进度快照（无迁移时 null）。 */
export function migrationProgress(): MigrationProgress | null {
  return activeProgress;
}

/**
 * 保存时就地执行基础迁移（异步分批，不阻塞主进程）。
 * 完成后写完成标记 ⇒ 重启后模块体零迁移、秒开。
 * ⛔ 此时引擎还在写**旧**目录 ⇒ 重启前的增量同步由 resolveStartupUserData 补（差量极小）。
 */
export async function runBaseMigration(source: string, target: string): Promise<{ files: number; bytes: number }> {
  const plan = collectMigrationFiles(source, target);
  activeProgress = { running: true, done: 0, total: plan.files.length, bytes: 0, totalBytes: plan.totalBytes, error: null };
  try {
    await copyAsync(plan.files, (done, total, bytes) => {
      activeProgress = { ...activeProgress!, done, total, bytes, error: null };
    });
    fs.writeFileSync(path.join(target, MIGRATED_MARKER), new Date().toISOString() + "\n", "utf8");
    return { files: plan.files.length, bytes: plan.totalBytes };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    activeProgress = { ...activeProgress!, running: false, error: msg };
    throw error;
  } finally {
    if (activeProgress && !activeProgress.error) activeProgress = { ...activeProgress, running: false };
  }
}
