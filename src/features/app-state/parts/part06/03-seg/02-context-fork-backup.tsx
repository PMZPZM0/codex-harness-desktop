/**
 * usePart06c2 —— usePart06c 按序切分出的第 2 段（纯搬迁、零改写）。
 * 域：权限/沙箱/力度/人格 · 复制与引用 · 编辑重发 — 图片/上下文/技能引用 · 分叉 · 备份导入导出 · 新会话
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import { useState } from "react";
import { enginePersonality } from "../../../../../lib/reply-style.mjs";
import { addMention, mentionBlockOf, mentionKeyOf } from "../../../../../lib/dispatch-mention.mjs";
import { loadDraft, saveDraft } from "../../../../../lib/composer-draft.mjs";
import { parseUserRefs, userDisplayText, userMessageMatchesInput, firstUserTextInTurn, cleanThreadDisplayTitle, extractThreadReferenceIds, stripThreadReferenceIds, formatThreadReferenceBlock, buildThreadReferencePayload, type ParsedUserRefs, type ThreadReferencePayload } from "../../../../../lib/user-refs";
import { resolveImagePath } from "../../../../../lib/resolve-image-path";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../../app-view/helpers";
import type { Model, PendingRequest, SettingsPage, SystemEvent, Thread, TreeEntry } from "../../../../app-view/types";
import type { Bag } from "../../bag-types";
/* ⛔ 新建**普通**会话 = 离开「欢迎界面」那个过渡态（10-25 用户实测：
   「我在指挥欢迎界面，点这个项目上的新建他不会跳转到普通会话的欢迎界面」）。
   `pending` 是「下一条会话是中枢」的标记，只有中枢入口该置它 ⇒ 这里统一清掉。 */
import { setBossPending } from "../../../../boss-group-view";

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

  /* ★ 10-29 @ 点名：用户在本条消息里点名的调度对象（专家 / 子智能体 / 专家团）。
     语义 = **本轮有效**：发送时拼成「[本轮点名对象]」指令块（lib/dispatch-mention.mjs 的
     mentionBlockOf），由模型用 agent_invoke 真派活；发完即清空（不跨消息继承，避免"上一条点名
     的对象被下一句话误派"）。
     ⛔ 不在选中时直接派活：那会绕过 dispatch 的许可 / 身份闸，且用户还没写正文（query 为空）。 */
  const [dispatchMentions, setDispatchMentions] = useState<DispatchTargetEntry[]>([]);
bag.dispatchMentions = dispatchMentions as typeof bag.dispatchMentions;
bag.setDispatchMentions = setDispatchMentions as typeof bag.setDispatchMentions;

  /** 选中一个候选 ⇒ 记进本轮点名 + 清掉输入框里的 @查询词（与引用上下文 / 技能同一形态）。 */
  function addDispatchMention(target: DispatchTargetEntry) {
    if (!target?.kind || !String(target.name ?? "").trim()) return;
    bag.setDispatchMentions((current) => {
      const next = addMention(current, target) as DispatchTargetEntry[];
      if (next.length === current.length) bag.showToast("已经点过名了", `「${target.name}」已在本条消息里`);
      return next;
    });
    /* ⛔ 清到行尾（不是到空白）：对象名带空格（"Claude Code"），
       用 `/@[^\s]*$/` 只会清掉 "@Code"、把 "Claude " 留在输入框里。 */
    bag.setPrompt((current) => current.replace(/@[^\n]*$/, ""));
    bag.setContextQuery("");
    bag.setContextOpen(false);
    requestAnimationFrame(() => bag.composerInputRef.current?.focus());
  }
bag.addDispatchMention = addDispatchMention as typeof bag.addDispatchMention;

  function removeDispatchMention(key: string) {
    bag.setDispatchMentions((current) => current.filter((entry) => mentionKeyOf(entry) !== key));
  }
bag.removeDispatchMention = removeDispatchMention as typeof bag.removeDispatchMention;

  function clearDispatchMentions() { bag.setDispatchMentions([]); }
bag.clearDispatchMentions = clearDispatchMentions as typeof bag.clearDispatchMentions;

  /** @ 一个**不存在**的子智能体时由宿主代建（确定性：失败原因能直接告诉用户，不用烧一回合）。
   *  ⛔ 只在用户点了面板里的「新建并 @」时调用 —— 打字过程中绝不自动建对象。
   *  ⛔ 模型侧没有建对象的工具（dispatch-core 只暴露 agent_invoke / agent_archive_sessions），
   *    所以这是唯一入口；建完刷新目录，之后的手动调度看到的是同一份。 */
  async function createDispatchSubagent(name: string): Promise<DispatchTargetEntry | null> {
    const clean = String(name ?? "").trim();
    if (!clean) return null;
    if (clean.length > 32) { bag.showToast("名字太长", "子智能体名称最多 32 个字"); return null; }
    try {
      const agent = (await window.codex.saveSubAgent({ name: clean })) as { id?: string; description?: string } | null | undefined;
      const target: DispatchTargetEntry = { kind: "subagent", key: String(agent?.id ?? clean), name: clean, profession: "", description: String(agent?.description ?? "") };
      await Promise.resolve(bag.refreshDispatchInfo?.()).catch(() => undefined);
      addDispatchMention(target);
      bag.showToast("已新建子智能体", `「${clean}」已按默认配置创建，可在 设置 → 子智能体 里补充指令`);
      return target;
    } catch (error) {
      bag.showToast("新建子智能体失败", String((error as Error)?.message ?? error));
      return null;
    }
  }
bag.createDispatchSubagent = createDispatchSubagent as typeof bag.createDispatchSubagent;

  /** 发送时拼进正文的指令块（空数组 ⇒ 空串，正文一字不多）。 */
  function dispatchMentionBlock() { return mentionBlockOf(bag.dispatchMentions); }
bag.dispatchMentionBlock = dispatchMentionBlock as typeof bag.dispatchMentionBlock;

  function addContextItem(item: { id: string; role: "用户" | "Codex"; text: string }) {
    bag.setContextItems((current) => [...current, item]);
    /* 10-29 用户令：引用上下文的触发符从 `@` 改成 `*`（`@` 让给"点名专家/子智能体/专家团"）。 */
    bag.setPrompt((current) => current.replace(/\*[^\s]*$/, ""));
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
    /* ★ 两个触发符共用同一个弹层，按**最后出现的那个符号**决定这次是谁（互不抢）：
         `@` = 点名调度对象（专家 / 子智能体 / CLI 智能体 / 专家团）
         `*` = 引用本次对话里的历史消息
       ⛔⛔ 10-29 晚补齐 `@` 的触发入口：上一版把 `@` 整体换成了 `*`（用户令「把 @ 引用上下文改成 *」），
         结果 `@ 点名` 只剩下面板渲染 + 芯片 + 发送注入，**没有任何地方把 contextOpen 打开的**
         —— 文档与交付说明都写着"输入 @ 即弹候选"，实际敲了没反应（典型的「声称能力」）。
       判据刻意不同：
         · `*` 后面不许有空白 —— `a*b` / `2*3` / `**粗体**` 这类不能误触；
         · `@` 允许空格 —— 对象名本身带空格（"Claude Code"、"Codex CLI"），
           敲到一半就关面板的话，用户永远选不到带空格的那一个。 */
    const star = value.lastIndexOf("*");
    const at = value.lastIndexOf("@");
    if (at >= 0 && at > star) {
      const afterAt = value.slice(at + 1);
      const atStart = at === 0 || /\s/.test(value[at - 1] ?? "");
      // 40 字上限 = 防止把整段粘贴文本当查询词（对象名不会这么长）
      if (atStart && !/\n/.test(afterAt) && afterAt.length <= 40) {
        bag.setContextQuery(afterAt);
        bag.setContextOpen(true);
        return;
      }
      bag.setContextOpen(false);
      return;
    }
    const afterStar = star >= 0 ? value.slice(star + 1) : "";
    const tokenStart = star === 0 || /\s/.test(value[star - 1] ?? "");
    const looksLikeQuery = /^\s*$/.test(afterStar) || /^[\p{L}\p{N}]/u.test(afterStar);
    if (star >= 0 && tokenStart && !/\s/.test(afterStar) && looksLikeQuery) {
      bag.setContextQuery(afterStar);
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
        /* ⛔⛔ 必须走「打开会话」正门，⛔ 不能只 `setThread`（2026-10-10 修）：
           引擎的 dynamicTools **只在 `thread/start` 与 `thread/resume` 注册** ⇒ 只把新会话塞进
           渲染状态、不 resume，它继承的就是**源会话创建时**的工具面快照 —— 之后新增的能力
           （知识库 / 定时任务 / 视频 / 语音 …）在这个分支里全部报 `unsupported call`
           （用户报「知识库调不到」的一条真凶）。openThread 内部会带当前工具面 resume。 */
        await bag.openThread(result.thread.id, result.thread);
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
        personality: bag.selectedModel?.supportsPersonality ? enginePersonality(bag.personality) : null,
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

  /* opts.boss：这一路是**指挥中枢**入口（颜色与文案不同，见下面那条提示）。
     ⛔ 只有中枢入口传 true；其余所有「新建普通会话」的路径保持默认。 */
  function startNewThread(opts?: { boss?: boolean }) {
    /* ⛔⛔ 这里是**所有**「新建普通会话」入口的唯一漏斗（新建任务 / Ctrl+N / 项目行的 ＋ /
       命令面板 /new / 空白态按钮都走它）。10-25 用户实测：
       「我在指挥欢迎界面，点这个项目上的新建他不会跳转到普通会话的欢迎界面」
       —— 根因是 `bossThreads.pending`（= 下一条会话是中枢）只在侧栏「新建任务」里被清过，
       项目行那条路径没清 ⇒ 标签页都换新的了，时间线还在按 pending 渲染中枢引导卡。
       ⇒ 在漏斗里统一清：新建普通会话必然不是指挥中枢（中枢入口会在调用**之后**再置 true）。 */
    setBossPending(false);
    bag.setChatSearchOpen(false);
    const savedSandbox = localStorage.getItem("default-sandbox") ?? "danger-full-access";
    // ⛔ 输入框草稿（09-19）：先存走当前会话草稿（必须在置空 threadRef 之前），再恢复「新会话草稿」
    saveDraft(bag.threadRef.current?.id ?? null, bag.promptRef.current);
    bag.threadRef.current = null;
    bag.setThread(null);
    /* 未选工作区：不悄悄默认，提醒用户自选（发送时才会真正用到目录）。
       ⛔ 10-27 用户令：「这个提示不对，项目地址选项在左上角」—— chip 就在输入框左上角
          （`02-composer-form.tsx` 的 cwd chip），别再写「右上角」。
       ⛔ 同日：「新建任务，提示要是蓝色；指挥中枢进去提醒现在这个颜色可以」
          ⇒ 显式指定语气：普通新建 = info（蓝），中枢 = warning（琥珀），不再让颜色由文案猜。 */
    if (!bag.workspace) {
      bag.setNotice(
        opts?.boss
          ? "尚未选择项目地址：中枢会话暂用主目录，点输入框左上角的「选择项目地址」"
          : "尚未选择工作区：当前会话暂用主目录，点输入框左上角的「选择项目地址」",
        undefined,
        opts?.boss ? "warning" : "info",
      );
    }
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


  return { copyImage, quoteMessage, cancelQuote, addContextItem, removeContextItem, addSkillReference, dispatchMentions, setDispatchMentions, addDispatchMention, removeDispatchMention, clearDispatchMentions, createDispatchSubagent, dispatchMentionBlock, onPromptChange, forkFromTurn, exportThreadsBackup, importThreadsBackup, exportThreadsMarkdown, forkThreadFromSidebar, importConversationMarkdown, startNewThread };
}
