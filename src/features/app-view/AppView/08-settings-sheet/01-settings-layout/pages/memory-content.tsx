/**
 * 设置页 · 人格与记忆（10-28 P1-2：从 00-settings-registry 的 366 行统一解构里拆出）。
 *
 * 每页只解构自己真正用到的 app 字段 —— 原注册表让 39 个页面共用一份 366 行的解构块，
 * 读一页要跨 300 行找绑定；拆完后本文件自包含。
 * ⛔ JSX 与搬迁前逐字一致（只换了外层包装与解构来源），行为等价性由预检【101】+ 设置页验收守着。
 */
import type { HarnessAppApi } from "../../../../../app-state/useHarnessApp";
import type { SettingsPage, SettingsPageEntry } from "../types";
import { lazy } from "react";
const MemoryCenterSection = lazy(() => import("../../../../../settings-memory/MemoryCenterSection").then((m) => ({ default: m.MemoryCenterSection })));
const SoulMarketSection = lazy(() => import("../../../../../soul-market/SoulMarketSection").then((m) => ({ default: m.SoulMarketSection })));
const KnowledgeBaseSection = lazy(() => import("../../../../../knowledge-base/KnowledgeBaseSection").then((m) => ({ default: m.KnowledgeBaseSection })));

export function memoryContentPages(app: HarnessAppApi): Partial<Record<SettingsPage, SettingsPageEntry>> {
  const {
    localSkills,
    memories,
    memoryConfigOpen,
    memoryEnabled,
    memoryGateway,
    memoryGatewayAction,
    memoryGroups,
    memoryLayers,
    memoryMode,
    memoryStatus,
    openThread,
    setMemoryPreview,
    saveMemoryGateway,
    scheduledTasks,
    setMemoryConfigOpen,
    setMemoryEnabled,
    setMemoryGateway,
    setNotice,
    testMemoryGateway,
    threads,
    workspace,
    workspaceMemoryEnabled,
  } = app;
  return {
    "soul-market": { render: () => <SoulMarketSection onNotice={(m) => setNotice(m)} /> },
    memory: { render: () => <MemoryCenterSection app={app} memoryEnabled={memoryEnabled} setMemoryEnabled={setMemoryEnabled} memories={memories} memoryGroups={memoryGroups} memoryLayers={memoryLayers} memoryMode={memoryMode} workspaceMemoryEnabled={workspaceMemoryEnabled} threads={threads} scheduledTasks={scheduledTasks} localSkills={localSkills} memoryStatus={memoryStatus} memoryConfigOpen={memoryConfigOpen} memoryGateway={memoryGateway} setMemoryGateway={setMemoryGateway} memoryGatewayAction={memoryGatewayAction} setMemoryConfigOpen={setMemoryConfigOpen} testMemoryGateway={testMemoryGateway} saveMemoryGateway={saveMemoryGateway} setMemoryPreview={setMemoryPreview} openThread={openThread} /> },
    "knowledge-base": { render: () => <KnowledgeBaseSection workspace={workspace} setNotice={(m) => setNotice(m)} /> },
  };
}
