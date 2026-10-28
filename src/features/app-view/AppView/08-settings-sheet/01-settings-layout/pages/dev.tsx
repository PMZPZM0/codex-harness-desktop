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

export function devPages(app: HarnessAppApi): Partial<Record<SettingsPage, SettingsPageEntry>> {
  const {
    capabilityError,
    capabilityRows,
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
  return {
    devtools: { render: () => <DevtoolsSettingsSection capabilityRows={capabilityRows} capabilityError={capabilityError} setNotice={setNotice} devRuntimes={devRuntimes} runtimeInstalling={runtimeInstalling} runtimeUninstalling={runtimeUninstalling} runtimePercent={runtimePercent} runtimeStage={runtimeStage} runtimeSpeed={runtimeSpeed} runtimeProgress={runtimeProgress} installDevRuntime={installDevRuntime} uninstallDevRuntime={uninstallDevRuntime} cancelDevRuntime={cancelDevRuntime} runtimeModal={runtimeModal} setRuntimeModal={setRuntimeModal} /> },
    extensibility: { render: () => <ExtensibilitySettingsSection onNotice={setNotice} /> },
  };
}
