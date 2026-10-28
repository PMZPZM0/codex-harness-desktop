/**
 * 设置页 · 数据（10-28 P1-2：从 00-settings-registry 的 366 行统一解构里拆出）。
 *
 * 每页只解构自己真正用到的 app 字段 —— 原注册表让 39 个页面共用一份 366 行的解构块，
 * 读一页要跨 300 行找绑定；拆完后本文件自包含。
 * ⛔ JSX 与搬迁前逐字一致（只换了外层包装与解构来源），行为等价性由预检【101】+ 设置页验收守着。
 */
import type { HarnessAppApi } from "../../../../../app-state/useHarnessApp";
import type { SettingsPage, SettingsPageEntry } from "../types";
import { lazy } from "react";
import UsagePanel from "../../../../../../components/UsagePanel";
import ArchivePage from "../../../../../../components/ArchivePage";
import { readUsageStats, resetUsageStats } from "../../../../../../lib/usage-stats";
import { ArchiveSettingsSection } from "../../../../../settings-archive/ArchiveSettingsSection";
const BackupSettingsSection = lazy(() => import("../../../../../settings-backup/BackupSettingsSection").then((m) => ({ default: m.BackupSettingsSection })));
const StorageSection = lazy(() => import("../../../../../storage-settings").then((m) => ({ default: m.StorageSection })));
const WorkLogsSection = lazy(() => import("../../../../../storage-settings").then((m) => ({ default: m.WorkLogsSection })));
const ChangeBackupSection = lazy(() => import("../../../../../storage-settings").then((m) => ({ default: m.ChangeBackupSection })));
const FavoritesSettingsSection = lazy(() => import("../../../../../settings-favorites").then((m) => ({ default: m.FavoritesSettingsSection })));
const AppLockSettingsSection = lazy(() => import("../../../../../settings-app-lock/AppLockSettingsSection").then((m) => ({ default: m.AppLockSettingsSection })));

export function dataPages(app: HarnessAppApi): Partial<Record<SettingsPage, SettingsPageEntry>> {
  const {
    backupBusy,
    exportThreadsBackup,
    exportThreadsMarkdown,
    importConversationMarkdown,
    importThreadsBackup,
    openAppConfirm,
    openThread,
    refreshThreads,
    setNotice,
    setSettingsOpen,
    setUsageStats,
    showToast,
    stats,
    thread,
    threadCacheRef,
    threads,
    tokenUsage,
    usage,
    workspace,
    addFavoriteItem,
    favorites,
    favoritesBusy,
    favoriteToMemory,
    insertFavorite,
    refreshFavorites,
    removeFavoriteItems,
    sendFavorite,
    updateFavoriteItem,
  } = app;
  return {
    usage: { render: () => <UsagePanel
                          stats={stats}
                          currentInput={usage?.inputTokens ?? usage?.input_tokens ?? 0}
                          currentOutput={usage?.outputTokens ?? usage?.output_tokens ?? 0}
                          contextWindow={tokenUsage?.modelContextWindow ?? 0}
                          onReset={() => { resetUsageStats(); setUsageStats(readUsageStats()); setNotice("使用统计已清空"); }}
                        /> },
    storage: { render: () => <>
                  <StorageSection
                          onNotice={setNotice}
                          openAppConfirm={openAppConfirm}
                          onClearMemoryCache={() => { threadCacheRef.current.clear(); void refreshThreads().catch(() => undefined); }}
                        />
                  <WorkLogsSection onNotice={setNotice} openAppConfirm={openAppConfirm} />
                  {/* 改动备份（10-13）：独立板块挂在数据管理页尾部，不塞进 StorageSection 的既有字段 */}
                  <ChangeBackupSection onNotice={setNotice} openAppConfirm={openAppConfirm} />
                </> },
    backup: { render: () => <BackupSettingsSection thread={thread} backupBusy={backupBusy} exportThreadsMarkdown={exportThreadsMarkdown} exportThreadsBackup={exportThreadsBackup} threads={threads} importThreadsBackup={importThreadsBackup} importConversationMarkdown={importConversationMarkdown} /> },
    archive: { render: () => <ArchiveSettingsSection ArchivePage={ArchivePage} setNotice={setNotice} setSettingsOpen={setSettingsOpen} openThread={openThread} openAppConfirm={openAppConfirm} refreshThreads={refreshThreads} /> },
    favorites: { render: () => <FavoritesSettingsSection
      favorites={favorites}
      busy={favoritesBusy}
      workspace={workspace}
      onInsert={insertFavorite}
      onSend={(item) => void sendFavorite(item)}
      onAdd={addFavoriteItem}
      onUpdate={updateFavoriteItem}
      onRemove={removeFavoriteItems}
      onRefresh={refreshFavorites}
      onToMemory={favoriteToMemory}
      onNotice={setNotice}
      onToast={showToast}
    /> },
    "app-lock": { render: () => <AppLockSettingsSection onNotice={setNotice} /> },
  };
}
