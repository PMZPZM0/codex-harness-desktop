/**
 * SettingsLayoutSettingsNav —— SettingsSheetSettingsLayout 的 JSX 第 1 段（09-22 从 01-settings-layout.tsx 分出，纯搬迁）。
 * ⛔ 收一个 `app`（类型 HarnessAppApi = hook 的返回类型）并按需解构 ⇒ 类型不落快照。
 */
import { RequestCard, ToolCard, VoiceSettingsBridge, admitThreadRuntimeRef, ago, appendDelta, appendIndexedDelta, applyThreadEvent, approvalMenuOptions, armSendAnimationClaim, botChannelName, botOnlineOf, builtinCommandCatalog, categoryLabel, clampRruleNum, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, cronTemplates, deltaMethods, describeRrule, describeSchedule, displayPath, fmtImportTime, formatTimestamp, greetingForHour, groupThreadsByTime, hydrateTurnUserMessage, idleTemplates, imageExts, isActivityItem, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, localFormatDurationMs, locateMatchEl, markBufferedAgentReveal, markBufferedTurnReveal, matchSkillCatalog, mergeItem, mergeLongerStreams, mergeTurn, modelBadges, modelName, normSkillName, noticeTone, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDescription, pluginDisplayName, pluginMarketCategoryTabs, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, revealStepFor, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, settingsNav, settingsRootPage, shortSkillName, skillHubCategories, skillHubCategoryName, skillHubCategoryTabs, skillZhNote, slashCommands, stableItem, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, toFileUrl, uniqueModelCount, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../helpers";
import type { HarnessAppApi } from "../../../../app-state/useHarnessApp";
import { useEffect, useRef } from "react";

/** 设置左栏导航：高亮当前页；⛔ 二级页（浏览器/电脑操作/RPA）要归到它的父分组才算高亮对。 */
export function SettingsLayoutSettingsNav({ app }: { app: HarnessAppApi }) {
  const {
    setSettingsPage,
    settingsPage,
  } = app;
  /* ⛔ 11-07 用户实测两条：
     ① 进二级页（浏览器 / 电脑操作 / RPA）后左栏「自动化」不再高亮 —— 二级页 id 不在
        settingsNav 里，按 === 比必然落空 ⇒ 统一折算到一级页；
     ② 从主界面「功能入口」直达某页时，左栏看不出选中（长列表里选中项常在视口外）
        ⇒ 选中项变化/面板挂载时滚到可见区域。 */
  const activePage = settingsRootPage(settingsPage);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activePage]);
  return (
    <nav className="settings-nav" aria-label="设置分类">
                          {settingsNav.map((group) => (
                            <div key={group.group} className="settings-group">
                              <div className="settings-group-label">{group.group}</div>
                              {group.items.map(([key, label, Icon, tone]) => <button ref={activePage === key ? activeRef : undefined} key={key} className={`${activePage === key ? "active" : ""} ic-${tone}`.trim()} onClick={() => setSettingsPage(key)}><Icon size={15} />{label}</button>)}
                            </div>
                          ))}
                        </nav>
  );
}
