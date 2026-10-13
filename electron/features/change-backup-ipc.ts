/**
 * 改动备份的 IPC（10-13）—— 设置页读写配置 + 查看/清空备份。
 *
 * ⛔ 与 `change-backup.ts` 的分工：本文件**只做 IPC 与参数校验**，落盘逻辑全在那个模块，
 *   避免同一套备份格式写在两处（这类"两处口径"本项目已栽过多次，见【286】【241】）。
 *
 * ⛔ 通道命名走 `backup:` 前缀而非 `changes:`（WorkBuddy 那两个目录名是它内部的，
 *   我们的通道名不必跟着它的内部实现走；且 `backup` 与已有的 `app:storage-*` 不冲突）。
 */
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import fsSync from "node:fs";
import { shell } from "electron";
import { saveAppSettings, readAppSettingsSync } from "../app-settings";
import {
  BACKUP_MAX_BYTES,
  backupSummary,
  clearChangeBackups,
  ensureBackupDir,
  listAllBackups,
  normalizeBackupDir,
  pruneBackups,
  readBackupChange,
  readChangeBackups,
  restoreFileFromBackup,
} from "./change-backup";
import { sendToWindow } from "./window-bus";

const BACKUP_CHANNELS = [
  "backup:config-get",
  "backup:config-set",
  "backup:list",
  "backup:summary",
  "backup:clear",
  // ── 10-13：给 agent 自己操作备份的一整套工具（用户「配套好工具，让 Codex 自己完成」）──
  "backup:list-all",
  "backup:read-change",
  "backup:restore-file",
  "backup:prune",
];

type Host = { app: { getPath(name: "userData"): string } };

/** 当前生效的配置 + 校验后的实际目录（界面靠 `dir` 回显，不用自己再规范化一次）。 */
function configView(userData: string) {
  const settings = readAppSettingsSync(userData);
  const { dir, fallback } = normalizeBackupDir(settings.changeBackupDir);
  return {
    enabled: Boolean(settings.changeBackupEnabled),
    /** 用户填的原值（非法时回显它本人写的东西，别偷偷换成默认让人以为没生效） */
    rawDir: String(settings.changeBackupDir ?? ""),
    /** 实际生效的目录（非法时是回退后的默认） */
    dir,
    /** ⛔ 目录被回退了 ⇒ 界面要显示警示，让用户知道他写的东西没生效 */
    fallback,
    /** 目录是否已存在（不存在且开着 = 还没建；关闭时不预建） */
    dirExists: existsDir(dir),
  };
}

function existsDir(dir: string): boolean {
  try {
    return fsSync.existsSync(dir);
  } catch {
    return false;
  }
}

export const backupFeature = defineFeature<null>({
  id: "backup",
  inject: ["ipc", "host"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("backup: 缺少 ipc 服务（宿主未提供）");
    const host = ctx.get<Host>("host");
    if (!host) throw new Error("backup: 缺少 host 服务（宿主未提供）");

    ipcHost.handle("backup:config-get", async () => {
      try {
        return { ok: true, config: configView(host.app.getPath("userData")) };
      } catch (err: any) {
        return { ok: false, error: err?.message || String(err) };
      }
    });

    /**
     * 写配置。
     * ⛔ **启用时才建目录**（关闭状态下不预先创建 —— 用户还没开就不该有产物落盘）。
     * ⛔ 建目录失败**照常保存开关**并如实回报：配置是用户的意图，不能因为他填了个
     *   不可写的路径就默默不开；但必须告诉他"目录建不出来"，否则表现为"开了却没备份"。
     */
    ipcHost.handle("backup:config-set", async (_event: unknown, input: { enabled?: boolean; dir?: string } = {}) => {
      const userData = host.app.getPath("userData");
      try {
        const patch: { changeBackupEnabled?: boolean; changeBackupDir?: string } = {};
        if (input.enabled !== undefined) patch.changeBackupEnabled = Boolean(input.enabled);
        if (input.dir !== undefined) patch.changeBackupDir = String(input.dir ?? "").trim();

        const nextEnabled = input.enabled !== undefined
          ? Boolean(input.enabled)
          : Boolean(readAppSettingsSync(userData).changeBackupEnabled);
        await saveAppSettings(userData, patch);

        const view = configView(userData);
        let dirReady = true;
        if (nextEnabled && !view.fallback) {
          // 已在用的旧目录也一并确保（用户可能换了个新路径）
          dirReady = ensureBackupDir(view.dir);
        }
        return { ok: true, config: view, dirReady };
      } catch (err: any) {
        return { ok: false, error: err?.message || String(err) };
      }
    });

    ipcHost.handle("backup:list", async (_event: unknown, conversationId?: string) => {
      try {
        const userData = host.app.getPath("userData");
        const settings = readAppSettingsSync(userData);
        const root = normalizeBackupDir(settings.changeBackupDir).dir;
        return { ok: true, changes: readChangeBackups(String(conversationId ?? ""), root) };
      } catch (err: any) {
        return { ok: false, error: err?.message || String(err) };
      }
    });

    ipcHost.handle("backup:summary", async () => {
      try {
        const userData = host.app.getPath("userData");
        const settings = readAppSettingsSync(userData);
        const root = normalizeBackupDir(settings.changeBackupDir).dir;
        return { ok: true, summary: backupSummary(root) };
      } catch (err: any) {
        return { ok: false, error: err?.message || String(err) };
      }
    });

    /** ⚠️ 不可恢复 ⇒ 渲染层必须先弹确认再调，本通道自己不代用户决定。 */
    ipcHost.handle("backup:clear", async () => {
      try {
        const userData = host.app.getPath("userData");
        const settings = readAppSettingsSync(userData);
        const root = normalizeBackupDir(settings.changeBackupDir).dir;
        clearChangeBackups(root);
        sendToWindow("backup:cleared", { at: Date.now() });
        return { ok: true, summary: backupSummary(root) };
      } catch (err: any) {
        return { ok: false, error: err?.message || String(err) };
      }
    });

    /* ══════════════════════════════════════════════════════════════════════
     * 10-13：agent 工具面 —— 让 Codex 自己完成「找回改动 / 查备份 / 清容量」
     *
     * 为什么要有：用户报「昨天那次改动找不回来」时，模型应该能自己查、自己比对、
     *   自己触发清理，而不是只会说"你去设置里看看"。
     * ⛔ 写操作只有 `restore-file`（且必须显式给文件路径 + 受工作区约束）与 `prune`
     *   （只往回收站搬，不硬删）—— 没有"一键整条回滚"，那会连带覆盖用户之后的改动。
     * ══════════════════════════════════════════════════════════════════════ */

    /** 当前生效的备份根目录（各 handler 共用，避免每处重写一遍 normalize）。 */
    const currentRoot = (): string => normalizeBackupDir(readAppSettingsSync(host.app.getPath("userData")).changeBackupDir).dir;

    /** 移进系统回收站（⛔ 失败就保留，绝不硬删）。 */
    const toTrash = async (target: string): Promise<boolean> => {
      try {
        await shell.trashItem(target);
        return true;
      } catch {
        return false;
      }
    };

    /** 列出全部会话的备份概览 —— agent 判断"有没有可捞的"的第一入口。 */
    ipcHost.handle("backup:list-all", async () => {
      try {
        return { ok: true, list: listAllBackups(currentRoot()), maxBytes: BACKUP_MAX_BYTES };
      } catch (err: any) {
        return { ok: false, error: err?.message || String(err) };
      }
    });

    /** 读某条备份的全文（索引 + 明细 hunks）—— 用来告诉用户"当时到底改了什么"。 */
    ipcHost.handle("backup:read-change", async (_event: unknown, input: { conversationId?: string; requestId?: string } = {}) => {
      try {
        const found = readBackupChange(String(input?.conversationId ?? ""), String(input?.requestId ?? ""), currentRoot());
        if (!found) return { ok: false, error: "backup_not_found" };
        return { ok: true, change: found.detail ?? found.index };
      } catch (err: any) {
        return { ok: false, error: err?.message || String(err) };
      }
    });

    /**
     * 把某文件回滚到备份里的那一版。
     * ⛔ 明细默认只存 hunks（省空间）⇒ 大多数情况会回 `needs_full_content`，
     *    **如实回报**而不是假装成功；此时 agent 应据 hunk 定位后手工改。
     */
    ipcHost.handle("backup:restore-file", async (_event: unknown, input: { conversationId?: string; requestId?: string; filePath?: string; workspace?: string } = {}) => {
      try {
        const r = restoreFileFromBackup({
          conversationId: String(input?.conversationId ?? ""),
          requestId: String(input?.requestId ?? ""),
          filePath: String(input?.filePath ?? ""),
          workspace: String(input?.workspace ?? ""),
          root: currentRoot(),
        });
        return r;
      } catch (err: any) {
        return { ok: false, error: err?.message || String(err) };
      }
    });

    /** 手动触发容量裁剪（超 3G 时把最旧的搬进回收站）。 */
    ipcHost.handle("backup:prune", async (_event: unknown, input: { maxBytes?: number } = {}) => {
      try {
        const max = Number(input?.maxBytes) > 0 ? Number(input.maxBytes) : BACKUP_MAX_BYTES;
        const r = await pruneBackups(currentRoot(), toTrash, max);
        return { ok: true, ...r, maxBytes: max };
      } catch (err: any) {
        return { ok: false, error: err?.message || String(err) };
      }
    });

    ctx.effect(() => {
      for (const channel of BACKUP_CHANNELS) ipcHost.removeHandler(channel);
    });
  },
});