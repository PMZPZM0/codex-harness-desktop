/**
 * 设置页 · 外观与体验（10-28 P1-2：从 00-settings-registry 的 366 行统一解构里拆出）。
 *
 * 每页只解构自己真正用到的 app 字段 —— 原注册表让 39 个页面共用一份 366 行的解构块，
 * 读一页要跨 300 行找绑定；拆完后本文件自包含。
 * ⛔ JSX 与搬迁前逐字一致（只换了外层包装与解构来源），行为等价性由预检【101】+ 设置页验收守着。
 */
import type { HarnessAppApi } from "../../../../../app-state/useHarnessApp";
import type { SettingsPage, SettingsPageEntry } from "../types";
import { lazy } from "react";
import VoiceSettingsSection from "../../../../../../components/VoiceSettingsSection";
import { EXPERT_CATEGORY_DEFS, LOCAL_MODEL_PRESETS, SHORTCUT_GROUPS } from "../../../../constants";
import { Slot } from "../../../../../../runtime/registry";
const GeneralSettingsSection = lazy(() => import("../../../../../settings-general/GeneralSettingsSection").then((m) => ({ default: m.GeneralSettingsSection })));
const DevtoolsSettingsSection = lazy(() => import("../../../../../settings-devtools/DevtoolsSettingsSection").then((m) => ({ default: m.DevtoolsSettingsSection })));
const PersonalizationPage = lazy(() => import("../../../../../../components/PersonalizationPage").then((m) => ({ default: m.PersonalizationPage })));
const AppearanceSettingsSection = lazy(() => import("../../../../../settings-appearance/AppearanceSettingsSection").then((m) => ({ default: m.AppearanceSettingsSection })));
const ScreenshotSettingsSection = lazy(() => import("../../../../../settings-screenshot").then((m) => ({ default: m.ScreenshotSettingsSection })));
const PetSettingsSection = lazy(() => import("../../../../../settings-pet/PetSettingsSection").then((m) => ({ default: m.PetSettingsSection })));

export function appearancePages(app: HarnessAppApi): Partial<Record<SettingsPage, SettingsPageEntry>> {
  const {
    adaptiveTone,
    applyGlobalPermissionMode,
    applyGroup,
    browserAuto,
    capabilityHint,
    changeAdaptiveTone,
    changeHardwareAccel,
    changePersonality,
    checkEngineUpdateNow,
    chooseWorkspace,
    desktopAuto,
    downloadSource,
    engineCheck,
    engineUpdateLog,
    engineUpdatePercent,
    engineUpdateResult,
    engineUpdateStageText,
    engineUpdating,
    engineVersion,
    globalPermApproval,
    groupBusy,
    hardwareAccel,
    performEngineUpdateNow,
    personality,
    ponytailOn,
    readMood,
    relaunchCountdown,
    restartPending,
    rightOpen,
    setNotice,
    setRightOpen,
    setShortcutsOpen,
    setTheme,
    setUiFont,
    theme,
    thread,
    toggleBrowserAuto,
    toggleDesktopAuto,
    uiFont,
    userDataPath,
    workspace,
  } = app;
  return {
    general: { render: () => <><GeneralSettingsSection globalPermApproval={globalPermApproval} applyGlobalPermissionMode={applyGlobalPermissionMode} workspace={workspace} chooseWorkspace={chooseWorkspace} userDataPath={userDataPath} setNotice={setNotice} rightOpen={rightOpen} setRightOpen={setRightOpen} capabilityHint={capabilityHint} desktopAuto={desktopAuto} groupBusy={groupBusy} toggleDesktopAuto={toggleDesktopAuto} browserAuto={browserAuto} toggleBrowserAuto={toggleBrowserAuto} ponytailOn={ponytailOn} applyGroup={applyGroup} hardwareAccel={hardwareAccel} changeHardwareAccel={changeHardwareAccel} restartPending={restartPending} SHORTCUT_GROUPS={SHORTCUT_GROUPS} setShortcutsOpen={setShortcutsOpen} engineVersion={engineVersion} engineCheck={engineCheck} engineUpdating={engineUpdating} checkEngineUpdateNow={checkEngineUpdateNow} performEngineUpdateNow={performEngineUpdateNow} engineUpdatePercent={engineUpdatePercent} engineUpdateStageText={engineUpdateStageText} engineUpdateLog={engineUpdateLog} engineUpdateResult={engineUpdateResult} relaunchCountdown={relaunchCountdown} onOpenSkills={(manage: boolean) => { app.setSkillsManageOnly(manage); app.setSettingsPage("skills"); }} openAppConfirm={app.openAppConfirm} downloadSource={downloadSource} adaptiveTone={adaptiveTone} changeAdaptiveTone={changeAdaptiveTone} thread={thread} readMood={readMood} /><Slot id="settings.general.bottom" /></> },
    /* ⛔ 这里用 `app.` 而不是往上面的逐字解构块里加名字：那段解构是「与搬迁前逐字一致」的
       （改它会让对照 diff 失真）。新增 props 直接取 app 上的同名状态即可。 */
    /* 10-10 两级 IA：开发工具页改成「一级卡片 + 二级弹窗」，两个插槽的**消费点**已移进
       DevtoolsSettingsSection 的对应弹窗（守卫【268-c】要求同一 slot id 全局只许被消费一次
       ⇒ 一级页不再放插槽）。⛔ id 与注册方式都没变：DomainsPanel / DeclaredPluginsPanel 仍
       各自 registerSlot，声明式插件照旧能挂到这些位置 —— 10-07 那次「同一 id 写成两处 ⇒
       功能域画两遍、声明式插件从不显示」的坑，继续由【268-c】按 id 全局去重钉着。 */
    appearance: { render: () => <AppearanceSettingsSection theme={theme} setTheme={setTheme} uiFont={uiFont} setUiFont={setUiFont} onNotice={setNotice} /> },
    personalization: { render: () => <PersonalizationPage personality={personality} onPersonalityChange={changePersonality} onNotice={setNotice} /> },
    pet: { render: () => <PetSettingsSection onNotice={setNotice} /> },
    voice: { render: () => <VoiceSettingsSection onNotice={setNotice} /> },
    screenshot: { render: () => <ScreenshotSettingsSection onNotice={setNotice} /> },
    /* 桌面宠物（09-30）：域只收显式 props（onNotice），状态全走自己的 IPC（pet:*），不占 app 字段面 */
  };
}
