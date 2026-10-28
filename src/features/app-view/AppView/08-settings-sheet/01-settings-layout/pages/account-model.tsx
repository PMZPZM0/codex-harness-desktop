/**
 * 设置页 · 账户与模型（10-28 P1-2：从 00-settings-registry 的 366 行统一解构里拆出）。
 *
 * 每页只解构自己真正用到的 app 字段 —— 原注册表让 39 个页面共用一份 366 行的解构块，
 * 读一页要跨 300 行找绑定；拆完后本文件自包含。
 * ⛔ JSX 与搬迁前逐字一致（只换了外层包装与解构来源），行为等价性由预检【101】+ 设置页验收守着。
 */
import type { HarnessAppApi } from "../../../../../app-state/useHarnessApp";
import type { SettingsPage, SettingsPageEntry } from "../types";
import { lazy } from "react";
import { storeCodexAvatar, setCodexIdentity } from "../../../../../../lib/codex-identity.mjs";
import { EXPERT_CATEGORY_DEFS, LOCAL_MODEL_PRESETS, SHORTCUT_GROUPS } from "../../../../constants";
import { ToolCard, builtinCommandCatalog, categoryLabel, cronTemplates, describeSchedule, displayPath, idleTemplates, modelName, pluginDescription, pluginDisplayName, pluginMarketCategoryTabs, sandboxPolicy, skillHubCategories, skillHubCategoryName, skillHubCategoryTabs, skillZhNote, uniqueModelCount } from "../../../../helpers";
const ModelSettingsSection = lazy(() => import("../../../../../settings-model/ModelSettingsSection").then((m) => ({ default: m.ModelSettingsSection })));
const UserCenterSection = lazy(() => import("../../../../../../components/UserCenter").then((m) => ({ default: m.UserCenterSection })));
const RelayCenterPage = lazy(() => import("../../../../../relay").then((m) => ({ default: m.RelayCenterPage })));
const CloudAccountSection = lazy(() => import("../../../../../settings-cloud/CloudAccountSection").then((m) => ({ default: m.CloudAccountSection })));
const OpenaiSubscriptionPage = lazy(() => import("../../../../../openai").then((m) => ({ default: m.OpenaiSubscriptionPage })));

export function accountModelPages(app: HarnessAppApi): Partial<Record<SettingsPage, SettingsPageEntry>> {
  const {
    activateOfficialProvider,
    applyModelIdInput,
    autoCompactRatio,
    changePersonality,
    codexIdentity,
    currentProvider,
    customDraft,
    customModel,
    editingProvider,
    handleLogout,
    modelEditor,
    modelSuggestions,
    openAppConfirm,
    openModelEditor,
    personality,
    pptokenCardOff,
    probeActiveProvider,
    probeOneModel,
    probeProvider,
    probingProvider,
    providerAutoOpenRef,
    providerStatus,
    providersList,
    relayActivate,
    relayBusy,
    removeProvider,
    saveCustomDraft,
    saveCustomModel,
    saveModelEditor,
    savingSettings,
    setAutoCompactRatio,
    setCustomDraft,
    setEditingProvider,
    setModelEditor,
    setNotice,
    setOpenaiActiveAcct,
    setPptokenCardOff,
    setProviderEnabled,
    setSettingsPage,
    setShowApiKey,
    setUserAvatar,
    setUsername,
    showApiKey,
    showToast,
    switchingModel,
    targetProviderHint,
    username,
  } = app;
  return {
    user: { render: () => <UserCenterSection
                          username={username}
                          onUsernameChange={(name) => { setUsername(name); }}
                          personality={personality}
                          onPersonalityChange={(v) => changePersonality(v)}
                          onNotice={(m) => setNotice(m)}
                          onProfileChange={(p) => setUserAvatar(p.avatarType && p.avatar ? { type: p.avatarType, value: p.avatar } : null)}
                          onLogout={handleLogout}
                          assistantName={codexIdentity.name}
                          onAssistantNameChange={(name) => {
                            // 名字落 personalization（引擎侧也会知道自己叫什么：applyPersonalizationToAgentsMd 会写进 AGENTS.md）
                            setCodexIdentity({ name });
                            void window.codex.saveIdentity({ assistantName: name }).catch(() => undefined);
                          }}
                          codexAvatar={codexIdentity.avatar}
                          onCodexAvatarChange={(spec) => { storeCodexAvatar(spec); setCodexIdentity({ avatar: spec }); }}
                        /> },
    model: { render: () => <ModelSettingsSection refreshActive={app.refreshActive} autoCompactRatio={autoCompactRatio} setAutoCompactRatio={setAutoCompactRatio} setNotice={setNotice} providersList={providersList} pptokenCardOff={pptokenCardOff} editingProvider={editingProvider} setCustomDraft={setCustomDraft} setEditingProvider={setEditingProvider} uniqueModelCount={uniqueModelCount} customModel={customModel} setPptokenCardOff={setPptokenCardOff} setProviderEnabled={setProviderEnabled} currentProvider={currentProvider} probingProvider={probingProvider} probeActiveProvider={probeActiveProvider} providerAutoOpenRef={providerAutoOpenRef} customDraft={customDraft} savingSettings={savingSettings} openAppConfirm={openAppConfirm} removeProvider={removeProvider} LOCAL_MODEL_PRESETS={LOCAL_MODEL_PRESETS} showApiKey={showApiKey} setShowApiKey={setShowApiKey} probeProvider={probeProvider} saveCustomDraft={saveCustomDraft} switchingModel={switchingModel} probeOneModel={probeOneModel} openModelEditor={openModelEditor} providerStatus={providerStatus} showToast={showToast} saveCustomModel={saveCustomModel} modelEditor={modelEditor} setModelEditor={setModelEditor} targetProviderHint={targetProviderHint} applyModelIdInput={applyModelIdInput} modelSuggestions={modelSuggestions} saveModelEditor={saveModelEditor} /> },
    relay: { render: () => <RelayCenterPage busy={relayBusy} activeProvider={customModel?.provider} onActivate={relayActivate} onNotice={setNotice} onOpenModelSettings={() => { setSettingsPage("model"); }} openAppConfirm={openAppConfirm} /> },
    cloud: { render: () => <CloudAccountSection /> },
    /* 10-27：群编排现在能删群 ⇒ 需要**全局确认弹窗**与**统一 toast**（板块自己造弹窗会跟层级/样式脱节，
       用户截图里那条挤在标题行里的确认行已被否掉）。 */
    openai: { render: () => <OpenaiSubscriptionPage activeProvider={customModel?.provider} onActivate={(models) => activateOfficialProvider(models)} onNotice={setNotice} onActiveChange={setOpenaiActiveAcct} onRefreshActive={app.refreshActive} openAppConfirm={openAppConfirm} /> },
  };
}
