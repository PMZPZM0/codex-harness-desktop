/**
 * data-dir-ipc（09-25 新增）：自定义数据目录（userData）。
 *
 * 域：dataDir(2)　通道：dataDir:read / dataDir:prepare
 *
 * 设计要点（细节见 electron/data-dir.ts）：
 * - 指路牌 = 默认目录（appData 锚点）下的 data-dir.json；env 覆盖优先于它（开发/测试用途）。
 * - prepare **就地完成基础迁移**（异步分批不阻塞主进程，进度经 dataDir:read.progress 轮询）；
 *   重启后只剩秒级增量同步（resolveStartupUserData 在引擎 spawn 前补保存→重启之间的变更）。
 * - 重启复用既有 `app:relaunch`（app-diagnostics.ts），本文件不重复注册。
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { app, ipcMain } from "electron";
import {
  defaultUserDataDir,
  migrationProgress,
  readDataDirBootstrap,
  runBaseMigration,
  writeDataDirBootstrap,
} from "../data-dir";

ipcMain.handle("dataDir:read", () => {
  const boot = readDataDirBootstrap();
  return {
    current: app.getPath("userData"),
    defaultDir: defaultUserDataDir(),
    custom: boot?.dir && path.resolve(boot.dir) !== path.resolve(defaultUserDataDir()) ? boot.dir : null,
    migratePending: Boolean(boot?.migrate),
    progress: migrationProgress(),
  };
});

ipcMain.handle("dataDir:prepare", async (_event, dir: unknown) => {
  const target = typeof dir === "string" ? path.resolve(dir.trim()) : "";
  if (!target) throw new Error("请先选择或填写数据目录");
  if (!path.isAbsolute(target)) throw new Error("必须是绝对路径");
  if (path.parse(target).root === target) throw new Error("不能把整个盘根（如 D:\\）当数据目录");
  const fallback = defaultUserDataDir();
  if (path.resolve(target) === path.resolve(fallback)) {
    // 填回默认 = 恢复默认：清掉自定义
    writeDataDirBootstrap({});
    return { ok: true, restoreDefault: true, needRestart: true, target: fallback };
  }
  // 可创建/可写探测：mkdir + 探针写
  try {
    await fs.mkdir(target, { recursive: true });
    const probe = path.join(target, ".data-dir-probe");
    await fs.writeFile(probe, "ok", "utf8");
    await fs.rm(probe, { force: true });
  } catch (error) {
    throw new Error(`目录不可用（${error instanceof Error ? error.message : String(error)}）`);
  }
  // 目标已有数据（非空且不像我们建出来的）⇒ 提示不迁移，尊重现状
  let hasExistingData = false;
  try {
    hasExistingData = existsSync(path.join(target, "app-settings.json")) || existsSync(path.join(target, "codex-home"));
  } catch { /* 忽略 */ }
  writeDataDirBootstrap({ dir: target, migrate: !hasExistingData });

  /* ⛔ 09-25 事故修复：迁移**就地、现在**做（异步分批，不阻塞主进程），而不是留给重启后的
     启动早期 —— 全量同步复制 1.8GB 会把启动卡成「应用起不来」。现在保存时迁移完（进度经
     dataDir:read.progress 轮询），重启后只剩秒级增量同步（补保存→重启之间的变更）。 */
  let migrated: { files: number; bytes: number } | null = null;
  if (!hasExistingData) {
    migrated = await runBaseMigration(fallback, target); // 失败会 throw ⇒ 渲染层收到错误并回退提示
  }
  return {
    ok: true,
    restoreDefault: false,
    needRestart: true,
    target,
    migrate: !hasExistingData,
    hasExistingData,
    migrated,
    note: hasExistingData
      ? "目标目录已有本应用数据，将直接使用（不覆盖、不迁移）"
      : undefined,
  };
});
