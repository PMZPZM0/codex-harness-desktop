/**
 * 设置页 · 开发（10-28 P1-2：从 00-settings-registry 的 366 行统一解构里拆出）。
 *
 * 每页只解构自己真正用到的 app 字段 —— 原注册表让 39 个页面共用一份 366 行的解构块，
 * 读一页要跨 300 行找绑定；拆完后本文件自包含。
 * ⛔ JSX 与搬迁前逐字一致（只换了外层包装与解构来源），行为等价性由预检【101】+ 设置页验收守着。
 */
import type { HarnessAppApi } from "../../../../../app-state/useHarnessApp";
import type { SettingsPage, SettingsPageEntry } from "../types";
import { lazy } from "react";
const DevtoolsSettingsSection = lazy(() => import("../../../../../settings-devtools/DevtoolsSettingsSection").then((m) => ({ default: m.DevtoolsSettingsSection })));
const ExtensibilitySettingsSection = lazy(() => import("../../../../../settings-extensibility").then((m) => ({ default: m.ExtensibilitySettingsSection })));

/** 设置页分组：开发工具（运行时安装、能力探测、控制台）。 */
export function devPages(app: HarnessAppApi): Partial<Record<SettingsPage, SettingsPageEntry>> {
  const {
    devRuntimes,
    installDevRuntime,
    runtimeInstalling,
    runtimeUninstalling,
    runtimeModal,
    runtimePercent,
    runtimeProgress,
    runtimeSpeed,
    cancelDevRuntime,
    runtimeStage,
    setNotice,
    setRuntimeModal,
    uninstallDevRuntime,
  } = app;
  const openExpert = (name: string, tool: string) => {
    const team = app.expertTeams.find((entry) => entry.lead.name === name);
    if (!team) { app.setSettingsPage("expert-center"); setNotice(`请先为「${name}」建档，再从「${tool}」发起任务`); return; }
    void app.startMemberDirectSession(team, team.lead, `请帮我检查「${tool}」的就绪情况，并给出下一步建议。`);
  };
  return {
    devtools: { render: () => <DevtoolsSettingsSection setNotice={setNotice} devRuntimes={devRuntimes} runtimeInstalling={runtimeInstalling} runtimeUninstalling={runtimeUninstalling} runtimePercent={runtimePercent} runtimeStage={runtimeStage} runtimeSpeed={runtimeSpeed} runtimeProgress={runtimeProgress} installDevRuntime={installDevRuntime} uninstallDevRuntime={uninstallDevRuntime} cancelDevRuntime={cancelDevRuntime} runtimeModal={runtimeModal} setRuntimeModal={setRuntimeModal} onOpenExperts={openExpert} /> },
    extensibility: { render: () => <ExtensibilitySettingsSection onNotice={setNotice} /> },
  };
}
