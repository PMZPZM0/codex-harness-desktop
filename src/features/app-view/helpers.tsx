/**
 * app-view/helpers（09-21 从 src/App.tsx 模块级搬出；09-22 按功能域再切进 ./helpers/**）
 *
 * ⛔ 本文件现在只有两件事：
 *   ① 保留「没有任何子模块认领」的 import —— 保持模块加载图与拆分前一致（含 side-effect import）；
 *   ② 把 86 个符号原样 re-export 出去 ⇒ 12 个既有 import 点零改动。
 *
 * 分域：
 *   ./runtime  —— 18 个符号
 *   ./stream  —— 15 个符号
 *   ./catalogs  —— 11 个符号
 *   ./skills  —— 6 个符号
 *   ./text  —— 21 个符号
 *   ./thread-list  —— 5 个符号
 *   ./paths  —— 3 个符号
 *   ./view-dom  —— 4 个符号
 *   ./components  —— 3 个符号
 */

/* ⛔ 这里只保留**副作用 import**（无绑定导入）。
   本文件是 09-21 从 App.tsx 整块复制导入区生成的，复制来的具名导入**没有一个被用到**；
   09-22 已清掉其中 169 条（369 个绑定）。当时的顾虑是「删了会改变被打包的模块集合」，
   本轮用两条判据把它证否了：① 按**解析后的绝对路径**在全仓反查，这些模块**0 条孤儿**
   （163 条仍有其它引用者）；② 删除后 `dist/` 与 `dist-electron/` 产物**字节与哈希完全一致**。
   副作用 import 则不同：删了会改变模块求值时机与 CSS 拼接顺序，故**保留**。 */
import "@xterm/xterm/css/xterm.css";
/** 对外导出面与拆分前完全一致（86 个符号）。 */
export { loadThreadRuntimeRaw, loadThreadRuntime, writeThreadRuntimeMirror, saveThreadRuntime, admitThreadRuntimeRef, ownRuntimeWrites, loadThreadPermissions, threadSandboxOf, threadApprovalOf, saveThreadPermissions, loadThreadModel, saveThreadModel, resolveThreadModel, loadThreadEffort, saveThreadEffort, sandboxPolicy, sandboxMode, displayPath } from "./helpers/runtime";
export { reasoningStart, deltaMethods, isDeltaMethod, mergeItem, threadContentChanged, mergeLongerStreams, mergeTurn, markBufferedAgentReveal, markBufferedTurnReveal, stableItem, hydrateTurnUserMessage, appendDelta, appendIndexedDelta, threadStreamMethods, applyThreadEvent } from "./helpers/stream";
export { builtinCommandCatalog, slashCommands, idleTemplates, cronTemplates, settingsNav, imageExts, approvalMenuOptions, skillHubCategories, skillHubCategoryTabs, skillHubCategoryName, pluginMarketCategoryTabs } from "./helpers/catalogs";
export { normSkillName, shortSkillName, skillZhNote, matchSkillCatalog, categoryLabel, subAgentTools } from "./helpers/skills";
export { fmtImportTime, prettifyHookLabel, noticeTone, modelName, botChannelName, botOnlineOf, localFormatDurationMs, isActivityItem, formatTimestamp, timeAgo, ago, uniqueModelCount, clampRruleNum, describeRrule, describeSchedule, greetingForHour, modelBadges, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, pluginDescription } from "./helpers/text";
export { parseTeamMemberTitle, groupThreadsByTime, collectMessageTexts, locateMatchEl, resumeThreadWithTurns } from "./helpers/thread-list";
export { collectKnownPaths, usageCounterSnapshot, toFileUrl } from "./helpers/paths";
export { createInlineAttachmentChip, armSendAnimationClaim, jumpToTurn, revealStepFor } from "./helpers/view-dom";
export { ToolCard, RequestCard, VoiceSettingsBridge } from "./helpers/components";
