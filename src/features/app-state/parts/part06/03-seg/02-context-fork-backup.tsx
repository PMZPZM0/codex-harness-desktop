/**
 * usePart06c2 —— usePart06c 按序切分出的第 2 段（纯搬迁、零改写）。
 * 域：权限/沙箱/力度/人格 · 复制与引用 · 编辑重发 — 图片/上下文/技能引用 · 分叉 · 备份导入导出 · 新会话
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import "@xterm/xterm/css/xterm.css";
import { loadDraft, saveDraft } from "../../../../../lib/composer-draft.mjs";
import { parseUserRefs, userDisplayText, userMessageMatchesInput, firstUserTextInTurn, cleanThreadDisplayTitle, extractThreadReferenceIds, stripThreadReferenceIds, formatThreadReferenceBlock, buildThreadReferencePayload, type ParsedUserRefs, type ThreadReferencePayload } from "../../../../../lib/user-refs";
import { resolveImagePath } from "../../../../../lib/resolve-image-path";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../../app-view/helpers";
import type { Model, PendingRequest, SettingsPage, SystemEvent, Thread, TreeEntry } from "../../../../app-view/types";
import type { Bag } from "../../bag-types";

export function usePart06c2(bag: Bag) {
  async function copyImage(path: string) {
    try {
      // 本地图片：渲染层 fetch harness-image:// 自定义协议拿不到 blob（复制不了根因），
      // 走主进程 nativeImage → clipboard.write；http URL 才用 fetch + ClipboardItem。
      const local = resolveImagePath(path);
      if (local) {
        await window.codex.writeClipboardImage(local);
        bag.setNotice("图片已复制");
        return;
      }
      const response = await fetch(path);
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
      bag.setNotice("图片已复制");
    } catch (error: any) { bag.setNotice(`复制图片失败：${error.message}`); }
  }
bag.copyImage = copyImage as typeof bag.copyImage;

  function quoteMessage(text: string) {
    const clean = text.trim();
    if (!clean) return;
    // 引用条模式：不把引用塞进输入框，而是在输入框上方显示可取消的引用条，发送时再拼块引用
    bag.setQuoteItem({ id: `quote-${Date.now()}`, text: clean });
    requestAnimationFrame(() => bag.composerInputRef.current?.focus());
  }
bag.quoteMessage = quoteMessage as typeof bag.quoteMessage;

  function cancelQuote() {
    bag.setQuoteItem(null);
  }
bag.cancelQuote = cancelQuote as typeof bag.cancelQuote;

  function addContextItem(item: { id: string; role: "用户" | "Codex"; text: string }) {
    bag.setContextItems((current) => [...current, item]);
    bag.setPrompt((current) => current.replace(/@[^\s]*$/, ""));
    bag.setContextQuery("");
    bag.setContextOpen(false);
  }
bag.addContextItem = addContextItem as typeof bag.addContextItem;

  function removeContextItem(id: string) {
    bag.setContextItems((current) => current.filter((item) => item.id !== id));
  }
bag.removeContextItem = removeContextItem as typeof bag.removeContextItem;

  /** 引用一个技能：加入本轮技能条（发送时拼成 [本轮已引用技能]）并清掉输入框里的 #查询词。
   *  技能子面板与输入框「#」面板共用，保证两条入口行为一致。 */
  function addSkillReference(skill: { name: string; description: string }) {
    bag.setSelectedSkills((current) => current.some((entry) => entry.name === skill.name) ? current : [...current, { name: skill.name, description: skill.description }]);
    bag.setPrompt((current) => current.replace(/#[^\s]*$/, ""));
    requestAnimationFrame(() => bag.composerInputRef.current?.focus());
  }
bag.addSkillReference = addSkillReference as typeof bag.addSkillReference;

  function onPromptChange(value: string) {
    bag.setPrompt(value);
    // ⛔ 草稿即时落盘（09-19）：闭包里的 thread 是当前会话，键不会写错；空内容 = 清草稿。
    //   同时消费恢复标记：真实输入时 thread 已稳定，防抖兜底恢复可用（防「恢复值==当前值导致
    //   标记滞留、下一次程序化改 prompt 被误跳过」）。
    bag.draftJustRestoredRef.current = false;
    saveDraft(bag.thread?.id ?? null, value);
    const at = value.lastIndexOf("@");
    const afterAt = at >= 0 ? value.slice(at + 1) : "";
    if (at >= 0 && !/\s/.test(afterAt)) {
      bag.setContextQuery(afterAt);
      bag.setContextOpen(true);
    } else {
      bag.setContextOpen(false);
    }
  }
bag.onPromptChange = onPromptChange as typeof bag.onPromptChange;

  async function forkFromTurn(turnId: string) {
    if (!bag.thread) return;
    const sourceId = bag.thread.id;
    try {
      const result = await window.codex.request("thread/fork", { threadId: sourceId, turnId, excludeTurns: false });
      if (result.thread) {
        // ⛔ 分支后我们离开了源会话：源会话的重试链/提示必须彻底重置（否则它到点会继续
        //   对着源会话重发，用户视角就是"分支出去以后那边还在自己动"）。新会话 id 天然干净。
        bag.resetSessionRetryState(sourceId);
        bag.threadRef.current = result.thread;
        bag.setThread(result.thread);
        bag.setModelId(`custom:${bag.customModel?.provider ?? "custom"}:${result.model ?? bag.selectedModel?.model ?? bag.customModel?.model ?? ""}`);
        await bag.refreshThreads();
        bag.showToast("任务已分支", "已从选定消息创建新的任务分支（新分支状态独立）");
      }
    } catch (error: any) {
      bag.setNotice(`创建分支失败：${error.message}`);
    }
  }
bag.forkFromTurn = forkFromTurn as typeof bag.forkFromTurn;

  /** 会话备份导出：threadIds 缺省/空数组 = 全部会话；单条走任务菜单「导出备份」 */
  async function exportThreadsBackup(threadIds?: string[]) {
    bag.setBackupBusy("export");
    try {
      const res = await window.codex.exportThreadsBackup(threadIds && threadIds.length ? threadIds : undefined);
      if (res?.path) bag.setNotice(`已导出 ${res.count} 个会话备份 → ${res.path}`);
    } catch (error: any) { bag.setNotice("导出失败：" + error.message); }
    finally { bag.setBackupBusy(""); }
  }
bag.exportThreadsBackup = exportThreadsBackup as typeof bag.exportThreadsBackup;

  /** 会话备份导入：rollout 写回 codex-home 后刷新列表，让会话立即出现在侧边栏 */
  async function importThreadsBackup() {
    bag.setBackupBusy("import");
    try {
      const res = await window.codex.importThreadsBackup();
      if (!res) return; // 用户取消
      await bag.refreshThreads();
      bag.setNotice(res.imported
        ? `已导入 ${res.imported} 个会话${res.skipped ? `，跳过 ${res.skipped} 个已存在` : ""}`
        : `没有可导入的新会话${res.skipped ? `（${res.skipped} 个已存在被跳过，不覆盖）` : ""}`);
    } catch (error: any) { bag.setNotice("导入失败：" + error.message); }
    finally { bag.setBackupBusy(""); }
  }
bag.importThreadsBackup = importThreadsBackup as typeof bag.importThreadsBackup;

  /** 会话记录导出为通用 Markdown（对齐官方 Codex /export：User/Assistant 交替、无系统注入，主流 AI 可直接带入） */
  async function exportThreadsMarkdown(threadIds?: string[]) {
    bag.setBackupBusy("export-md");
    try {
      const res = await window.codex.exportThreadsMarkdown(threadIds && threadIds.length ? threadIds : undefined);
      if (res?.path) bag.setNotice(`已导出 ${res.count} 个会话（${res.totalMessages} 条消息）为 Markdown → ${res.path}`);
    } catch (error: any) { bag.setNotice("导出失败：" + error.message); }
    finally { bag.setBackupBusy(""); }
  }
bag.exportThreadsMarkdown = exportThreadsMarkdown as typeof bag.exportThreadsMarkdown;

  /** 侧栏指定会话分支：不依赖当前打开的 thread，成功后直接进入新分支。 */
  async function forkThreadFromSidebar(entry: Thread) {
    if (bag.runningThreadIdsRef.current.has(entry.id)) { bag.setNotice("任务运行中，请完成或停止后再分支"); return; }
    try {
      const result = await window.codex.request("thread/fork", { threadId: entry.id, excludeTurns: false });
      if (!result?.thread) throw new Error("引擎未返回新分支");
      // 源会话的重试链一并作废（分支后它的状态不应再自行推进）；新会话 id 从零开始
      bag.resetSessionRetryState(entry.id);
      const sourceModel = loadThreadModel(entry.id);
      if (sourceModel) saveThreadModel(result.thread.id, sourceModel);
      await bag.refreshThreads();
      await bag.openThread(result.thread.id, result.thread);
      bag.showToast("已创建会话分支", `${cleanThreadDisplayTitle(entry.name, { preview: entry.preview })}（新分支状态独立）`, entry.id);
    } catch (error: any) {
      bag.setNotice(`创建分支失败：${error.message}`);
    }
  }
bag.forkThreadFromSidebar = forkThreadFromSidebar as typeof bag.forkThreadFromSidebar;

  /** 导入外部对话记录（主流 AI / 官方 Codex 导出的 .md/.txt 记录）：
   *  主进程选文件→解析→自动新建「导入：原会话名」命名会话并打开到对话框（不自动跑）；
   *  记录暂存为待发送（localStorage），用户发出首条消息时自动整段附上，界面折叠成可展开卡。 */
  async function importConversationMarkdown() {
    bag.setBackupBusy("import-md");
    try {
      const res = await window.codex.importConversationMarkdown({
        cwd: bag.workspace || undefined,
        model: bag.selectedModel?.model ?? modelName(bag.modelId),
        effort: bag.effort || undefined,
        sandbox: bag.sandbox,
        approvalPolicy: bag.approvalPolicy,
        personality: bag.selectedModel?.supportsPersonality ? bag.personality : null,
      });
      if (!res) return; // 用户取消
      bag.rememberPendingImport(res.thread.id, res.imported);
      bag.setSettingsOpen(false);
      await bag.openThread(res.thread.id, res.thread);
      // 新建线程是主进程 thread/start 直接建的，openThread 只切视图不更新左侧列表，
      // 必须显式刷新一次，让「导入：xxx」立即出现在左侧
      void bag.refreshThreads();
      requestAnimationFrame(() => bag.composerInputRef.current?.focus());
      bag.setNotice(`已导入「${res.imported.title || res.imported.fileName}」并新建会话：直接输入即可继续，记录会在首条消息时自动附上`);
    } catch (error: any) { bag.setNotice("导入失败：" + error.message); }
    finally { bag.setBackupBusy(""); }
  }
bag.importConversationMarkdown = importConversationMarkdown as typeof bag.importConversationMarkdown;

  function startNewThread() {
    bag.setChatSearchOpen(false);
    const savedSandbox = localStorage.getItem("default-sandbox") ?? "danger-full-access";
    // ⛔ 输入框草稿（09-19）：先存走当前会话草稿（必须在置空 threadRef 之前），再恢复「新会话草稿」
    saveDraft(bag.threadRef.current?.id ?? null, bag.promptRef.current);
    bag.threadRef.current = null;
    bag.setThread(null);
    // 标准会话未选工作区：不悄悄默认，提醒用户自选（发送时才会真正用到目录）
    if (!bag.workspace) bag.setNotice("尚未选择工作区：当前会话暂用主目录，建议点右上角 📁 选择项目目录");
    // 重置滚动：上个会话若滚在中间，欢迎页会被顶出视口（顶部只露半截建议 chips 幻影）
    requestAnimationFrame(() => { const el = bag.scrollRef.current; if (el) el.scrollTop = 0; });
    bag.draftJustRestoredRef.current = true;
    bag.setPrompt(loadDraft(null));
    bag.setImages([]);
    bag.setModelId(localStorage.getItem("default-model") ?? bag.modelId);
    bag.setEffort(localStorage.getItem("default-effort") ?? bag.effort);
    bag.setSandbox(savedSandbox);
    bag.setApprovalPolicy(localStorage.getItem("default-approval") ?? (savedSandbox === "danger-full-access" ? "never" : "on-request"));
    bag.setPersonality(localStorage.getItem("default-personality") ?? "pragmatic");
    bag.setDiff("");
    bag.setSystemEvents([]);
    bag.setOptimisticInput(null);
    bag.setSending(false);
    bag.setActiveTurnId(null);
    bag.setInterrupting(false);
    bag.setWorkStartedAt(null);
    bag.closeTaskMenu();
    bag.setMobileNav(false);
    bag.setReviewBusy(false);
    bag.setReviewReport("");
    bag.reviewTurnRef.current = null;
    bag.setPlanSteps([]);
    bag.setGoalText("");
    // 立即与引擎同步一次列表：让左侧会话列表反映最新状态（含刚发起的专家团会话等）
    void bag.refreshThreads();
  }
bag.startNewThread = startNewThread as typeof bag.startNewThread;


  return { copyImage, quoteMessage, cancelQuote, addContextItem, removeContextItem, addSkillReference, onPromptChange, forkFromTurn, exportThreadsBackup, importThreadsBackup, exportThreadsMarkdown, forkThreadFromSidebar, importConversationMarkdown, startNewThread };
}
