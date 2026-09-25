/**
 * data-dir-ipc（09-25 新增）：自定义数据目录（userData）。
 *
 * 域：dataDir(2)　通道：dataDir:read / dataDir:prepare
 *
 * 设计要点（细节见 electron/data-dir.ts）：
 * - 指路牌 = 默认目录（appData 锚点）下的 data-dir.json；env 覆盖优先于它（开发/测试用途）。
 * - prepare 只写指路牌 + 迁移标记，**不做实际迁移** —— 迁移在下一次启动的**引擎 spawn 之前**
 *   由 resolveStartupUserData() 执行（唯一没有进程写文件的时机）。
 * - 重启复用既有 `app:relaunch`（app-diagnostics.ts），本文件不重复注册。
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { app, ipcMain } from "electron";
import {
  defaultUserDataDir,
  readDataDirBootstrap,
  writeDataDirBootstrap,
} from "../data-dir";

ipcMain.handle("dataDir:read", () => {
  const boot = readDataDirBootstrap();
  return {
    current: app.getPath("userData"),
    defaultDir: defaultUserDataDir(),
    custom: boot?.dir && path.resolve(boot.dir) !== path.resolve(defaultUserDataDir()) ? boot.dir : null,
    migratePending: Boolean(boot?.migrate),
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
  return {
    ok: true,
    restoreDefault: false,
    needRestart: true,
    target,
    migrate: !hasExistingData,
    hasExistingData,
    note: hasExistingData
      ? "目标目录已有本应用数据，将直接使用（不覆盖、不迁移）"
      : undefined,
  };
});
