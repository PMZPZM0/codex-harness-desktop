/**
 * send 的**实现**（09-22 从 02-seg.tsx 整函数外提，纯搬迁、零改写）。
 *
 * ⛔ 原函数对宿主局部绑定的闭包 = 0（跨段依赖全走 bag）⇒ 只需补一个 `bag` 首参，函数体逐字照搬。
 * ⛔ 宿主里留同名薄壳转调，调用点与函数提升语义都不变。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import { attachmentToken, fileToken, promptFilePaths, shouldSavePastedTextAsFile, splitAttachmentSegments, stripAttachmentTokens } from "../../../../../lib/composer-attachments.mjs";
import { ALIGN_RESULT, CONTINUITY_TEXT, HARNESS_PROVIDER_ID, shouldAlignProvider } from "../../../../../lib/provider-continuity.mjs";
import { advanceMood, composeMoodInstructions, emptyMood, moodBlock, moodSignature, moodTone, normalizeMood, userSignalOf } from "../../../../../lib/agent-mood.mjs";
import { isRateLimitError, rateLimitBackoffMs, RATE_LIMIT_MAX_ATTEMPTS } from "../../../../../lib/rate-limit-retry";
import { isUnsupportedEffortError, pickEffortFallback, blockedEffortsOf, markEffortUnsupported, clearEffortUnsupported } from "../../../../../lib/effort-support";
import { imageToken, splitPromptSegments, promptImagePaths, stripImageTokens, isImagePart, imagePartSrc, normalizeImagePartForSend } from "../../../../../lib/prompt-images";
import { pickEnhanceHint, shouldShowHintAfterSends, isLongPrompt, HINT_COOLDOWN_MS, HINT_AUTO_HIDE_MS } from "../../../../../lib/enhance-hints.mjs";
import { nowBlock } from "../../../../../lib/now-block.mjs";
import { classifyUnit, buildSegments, buildOrderedToolRuns, foldItemStatus, computeFoldSummary, topToolGroup, isTurnRunning, normalizeLoadedThread, type FoldUnit } from "../../../../../lib/turn-fold";
import { parseUserRefs, userDisplayText, userMessageMatchesInput, firstUserTextInTurn, cleanThreadDisplayTitle, extractThreadReferenceIds, stripThreadReferenceIds, formatThreadReferenceBlock, buildThreadReferencePayload, type ParsedUserRefs, type ThreadReferencePayload } from "../../../../../lib/user-refs";
import { effortLabels } from "../../../../../lib/effort-labels";
import { fmtImportNote } from "../../../../../lib/fmt-import-note";
import { justSentIds } from "../../../../../lib/just-sent-ids";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../../app-view/helpers";
import type { Model, PendingRequest, SettingsPage, SystemEvent, Thread, TreeEntry } from "../../../../app-view/types";
import { saveMessageOriginal } from "../../../../../lib/user-message-originals.mjs";
import type { Bag } from "../../bag-types";

export async function send(bag: Bag, event?: FormEvent) {
    event?.preventDefault();
    // 自定义命令展开文本优先消费（跳过 / 前缀解析，避免展开结果被二次当命令处理）
    const pendingText = bag.pendingCommandTextRef.current;
    if (pendingText != null) bag.pendingCommandTextRef.current = null;
    const value = (pendingText ?? bag.prompt).trim();
    // 「#技能名」：与「/」命令面板同款——回车或点发送即引用该技能，不把 #查询词当正文发出去。
    // 未匹配到任何技能时按普通文本发送（用户可能真的想发以 # 开头的内容）。
    if (pendingText == null && value.startsWith("#") && !value.includes(" ") && bag.images.length === 0 && bag.attachedFiles.length === 0) {
      const hit = matchSkillCatalog(bag.mergedSkillCatalog, value.slice(1), 1)[0];
      if (hit) { bag.addSkillReference(hit); return; }
    }
    if (pendingText == null && value.startsWith("/") && bag.images.length === 0) {
      const command = value.slice(1).split(/\s+/, 1)[0].toLowerCase();
      if (bag.thread && bag.runningThreadIdsRef.current.has(bag.thread.id) && !["stop", "status", "diff", "pwd", "model", "permissions", "help", "context", "clear", "copy", "memory", "effort", "personality", "sandbox", "approval", "skills", "mcp", "plugins", "apps", "queue"].includes(command)) {
        bag.showToast("任务仍在运行", `请先使用 /stop，再执行 /${command}`);
        return;
      }
      if (await bag.runSlashCommand(value)) return;
    }
    if (!value && bag.images.length === 0 && bag.attachedFiles.length === 0) return;
    if (bag.sendInFlightRef.current) return;
    /* ⛔ 原先这里有一道并发闸门（09-19）：消息会让该会话开始跑，若它没在跑就算新增一路并发、
       超限就拦。09-25 用户要求删除并发限制 ⇒ 移除。上游限流仍由引擎默认重试/退避兜底。 */
    // 用户手动发消息：只取消**当前会话**等待中的 429 自动重试（手动发送优先，避免交错）。
    // ⛔ 不能全清：别的会话的重试链是独立的，清掉就等于「后台会话直接断」（用户实测的毛病）。
    const focusedForSend = bag.threadRef.current?.id;
    if (focusedForSend) bag.cancelRateLimitRetry(focusedForSend, true);
    // 用户语气信号（被夸 / 被催）也进会话状态：只在**已有会话**上记 —— 新建会话此刻还没有 id，
    // 它的状态从零开始（第一回合由 turn/completed 起头）。判定是关键词法，见 agent-mood.mjs。
    const userSig = userSignalOf(value);
    if (userSig && bag.threadRef.current?.id) bag.bumpMood(bag.threadRef.current.id, userSig);
    // 发送前按**最新状态**刷新一次会话作用域：语气是针对「这一次回复」的，而回合刚结束时
    // 引擎往往还在收尾（那时发 thread/settings/update 会被静默拒掉，验收实测：状态更新了、
    // 但引擎侧没有新语气块）。此刻引擎空闲，正是下发的可靠时机；同签名会被去重，不会多发。
    // ⛔ 必须**等它落地**再进入发送流程（否则语气追不上这一次回复）——但只等最多 800ms，
    //    引擎无响应时不能让发送卡住（正常情况几十毫秒就回来了）。
    // ⛔ in-flight 标记必须先置位：await 期间若它还挂着 false，这 800ms 窗口里再点一次
    //    发送就会重入（同一个问题发两遍）。code review 抓到的顺序问题。
    // ⛔ 位置与顺序（code review 抓到）：① in-flight 标记必须早于 await —— 否则 await 窗口
    //    里再点一次发送会重入；② 两者都必须在 try 内 —— 异常由 finally 释放锁，
    //    一次 throw 不会把发送永久卡死。
    try {
    bag.sendInFlightRef.current = true;
    if (bag.threadRef.current?.id && bag.adaptiveToneRef.current) {
      await Promise.race([bag.pushSessionScope(bag.threadRef.current.id), new Promise((resolve) => setTimeout(resolve, 800))]);
    }
    if (!bag.customModel || !bag.selectedModel) {
      bag.planOnceRef.current = false; // /plan 旗标不跨发送泄漏：发送失败即复位
      bag.setPlanArmed(false);
      // ⛔ 09-19：不再只是弹一句「请先配置并启用自定义模型」+ 跳设置页（新手看不懂那张完整表单）。
      //   直接打开**一键配置向导**（粘 Key 即可），并且**保留用户刚输入的内容**——
      //   send() 在更靠前的位置才清空输入框，这里 return 时 prompt 还在，配完回来不用重打。
      bag.setShowModelGuide(true);
      return;
    }
    // ⛔ 09-17 mac 实测（用户报「不使用项目地址功能用不了」）：只有「**既没有项目地址、
    //   也没有选『不使用项目地址』**」才该弹目录选择框。旧条件是裸 `!workspace` ——
    //   mac 全新机器从来没设过项目地址，于是用户在欢迎页明确选了「不使用项目地址」也照样
    //   进这里：**scratch 被清掉 + 强制弹框** ⇒ 该选项等于完全无效。
    //   Windows 上之所以看不出这个 bug，是因为老机器早就有 workspace 了。
    //   09-14 那次的坑（在弹窗里选了目录却仍建进 scratch）现在由「本分支只在没有 scratch
    //   时进入」天然避免：用户明确选了 scratch 就走 scratch，不会再弹框、也不会被清掉
    //   （scratch 的清空时机仍留在 thread/start 成功之后，保证「每次新建单独目录」）。
    if (!bag.workspace && !bag.welcomeScratchDir) {
      bag.planOnceRef.current = false; // /plan 旗标不跨发送泄漏：发送失败即复位
      bag.setPlanArmed(false);
      await bag.chooseWorkspace();
      if (!bag.workspaceRef.current) return; // 用户取消了选择：留在输入框，消息不丢
      // 选好了 → 不 return，继续走下面的正常发送流程（用刚选的目录建会话）
    }
    let messageText = value;
    let threadReferenceBlocks = "";
    // 内联图片：占位符从文本剥离，图片按占位符出现顺序发送；不在占位符里的遗留附件照旧追加
    let inlineImagePaths = promptImagePaths(messageText);
    if (inlineImagePaths.length) messageText = stripImageTokens(messageText);
    // 内联文件：同样从正文剥离，改拼成既有的 [附件文件] 段（**模型侧协议不变** —— 引擎与
    // 渲染层解析的一直是这一段；只把"用户看见的形态"从输入框上方的 strip 改成内联 chip）。
    const inlineFilePaths = promptFilePaths(messageText);
    if (inlineFilePaths.length) messageText = stripAttachmentTokens(messageText, ["file"]);
    // 图片照常发送（09-18 用户：「不管支不支持识图，就可以发正常的图片……就正常发图就行」）。
    // ⛔ 已移除「按模型 inputTypes 预判 → 把图吞掉换成一段啰嗦说明文字」的降级分支：
    //   ① 预判依据是本地模型元数据，模型其实支持视觉却漏勾「图片」时，图会被白白吞掉；
    //   ② 注入的那段文字是**面向用户**的（"请告知用户配置视觉插件…"），却拼进了用户消息正文，
    //      模型照抄出来就等于在气泡里对用户说教，观感极差（用户截图实证）。
    //   图片一律按 localImage 正常发；真遇到接入点不支持，引擎会报错，届时由
    //   healImageModalityIfUnsupported（回合错误路径）自动摘掉该模型的图片模态并提示重发。
    const sendImages = bag.images;
    // ⛔ 注解「chip 原始位置」：剥离 token 前的原文按剥离后核心文本的指纹存本地（localStorage），
    //    渲染层 UserMessageView 命中后按 token 在文字流里的位置内联渲染 ——
    //    否则附件 chip 全部堆到消息尾部（用户 09-25：「不用强制在消息尾部」）。引擎协议不动。
    saveMessageOriginal(messageText, value);
    try {
      // 必须用剥离占位符后的 messageText：传原始 value 会把 [图片:...] 编码路径
      // 覆盖回发送文本（09-04 截图实证：气泡里出现整段乱码 token）
      const resolved = await bag.resolveThreadReferences(messageText, bag.thread?.id);
      messageText = resolved.text;
      threadReferenceBlocks = resolved.blocks;
    } catch (error: any) {
      bag.scopedNotice(error.message, bag.thread?.id);
      return;
    }
    const threadReferenceSuffix = threadReferenceBlocks ? `\n\n${threadReferenceBlocks}` : "";
    if (bag.thread && bag.runningThreadIdsRef.current.has(bag.thread.id)) {
      // 排队消息与正常发送一样带上引用段（引用/文件/技能/上下文），渲染时解析成卡片
      const quotePrefix = bag.quoteItem ? `> ${bag.quoteItem.text.split("\n").join("\n> ")}\n\n` : "";
      const contextPrefix = bag.contextItems.length ? `\n\n[用户指定的对话上下文]\n${bag.contextItems.map((item, index) => `(${index + 1}) ${item.role}：${item.text}`).join("\n\n")}\n[上下文结束]\n` : "";
      const skillPrefix = bag.selectedSkills.length ? `\n\n[本轮已引用技能]\n${bag.selectedSkills.map((skill) => `- ${skill.name}：${skill.description}`).join("\n")}\n[请按上述技能工作流执行]\n` : "";
      const filePrefix = inlineFilePaths.length ? `\n\n[附件文件]\n${inlineFilePaths.map((path) => `- ${path}`).join("\n")}\n[附件结束]\n` : "";
      const input = [
        ...((messageText || threadReferenceBlocks || inlineFilePaths.length || bag.selectedSkills.length || bag.contextItems.length || bag.quoteItem) ? [{ type: "text", text: `${quotePrefix}${messageText}${contextPrefix}${skillPrefix}${filePrefix}${nowBlock()}${threadReferenceSuffix}`, text_elements: [] }] : []),
        ...inlineImagePaths.map((path) => ({ type: "localImage", path })),
        ...sendImages.filter((path) => !inlineImagePaths.includes(path)).map((path) => ({ type: "localImage", path })),
      ];
      try {
        await window.codex.request("thread/queue/add", { threadId: bag.thread.id, input, clientUserMessageId: crypto.randomUUID() });
        bag.setPrompt("");
        bag.setQuoteItem(null);
        bag.setContextItems([]);
        bag.setSelectedSkills([]);
        bag.setImages([]);
        void bag.refreshQueue(bag.thread.id);
      } catch (error: any) {
        bag.scopedNotice(error.message, bag.thread?.id);
      }
      return;
    }
    // ⛔ 09-15：供应商对齐必须放在「排队分支」之后——会话正在跑时用户发消息走的是
    // thread/queue/add（不重启引擎、不换绑定），消息入队即可；而下面的对齐会触发
    // setProviderModel（重启引擎注入新 Key）+ thread/resume 迁移，排在前面会吞掉排队消息、
    // 还弹「已自动接力」（用户实测：排队消息直接发出去 + 弹迁移提示）。只有空闲会话真正
    // 走 turn/start 的发送才需要先对齐供应商。
    // 打开一个使用其他供应商的历史会话时，仅恢复下拉框选择，不立刻重启引擎。
    // 真正发送前：若会话真实绑定的供应商 ≠ 当前激活供应商（引擎全局 Key 已换），
    // 直接发会因 Key 错配 401 无限重连——自动把会话迁移到当前激活供应商。
    // 判定依据是 threadProviderRef 登记表（resume 时记录的线程真实绑定），
    // 不是 UI 下拉框（下拉可能已被切换动作改成新供应商，比不出差异）。
    {
      const currentThread = bag.thread;
      let boundProvider = currentThread?.id ? bag.threadProviderRef.current.get(currentThread.id) : undefined;
      // 登记表无记录（本次启动还没 resume 过该会话）：轻量 resume（不带历史）问引擎要真实绑定，
      // 防止「切换供应商后不重开会话直接发」漏检——引擎是绑定的唯一权威。
      if (currentThread?.id && !boundProvider) {
        try {
          const probe = await window.codex.request("thread/resume", { threadId: currentThread.id, excludeTurns: true });
          const probed = String(probe?.modelProvider ?? probe?.model_provider ?? "").trim();
          if (probed) { bag.threadProviderRef.current.set(currentThread.id, probed); boundProvider = probed; }
        } catch { /* 探测失败按无绑定处理，走正常发送 */ }
      }
      // ⛔ 必须走 shouldAlignProvider 判定，不能拿引擎真实绑定直接跟供应商 id 比：
      // 统一内置 provider id（harness）之后，会话绑定恒为 `harness`、而生效供应商是
      // `custom906` / `relay-*`，裸比较**恒为真** → 每次发送都误判成「供应商变了」：
      //   ① setProviderModel 默认 restart → **每次发送都重启引擎**（日志里一串 [spawn]）；
      //   ② setModelId(updated.model) 把用户刚选的模型改回供应商顶层 model
      //      （09-15 用户实测「新增的模型选不了」：选完一发消息胶囊就弹回旧模型）。
      // 判定规则收在纯模块 src/lib/provider-continuity.mjs（那里明确「绑 harness = 天然对齐」）。
      if (boundProvider && bag.customModel && shouldAlignProvider(boundProvider, bag.customModel.provider) && currentThread?.id) {
        // 关键：引擎进程是「一个全局 Key」（spawn 时注入 CODEX_HARNESS_API_KEY）。
        // 只 resume 换 base_url 不换 Key → 目标供应商收到旧 Key → INVALID_API_KEY 401
        // （实测：激活 ppz123 后旧 pptoken 会话迁移后仍 401，重启引擎才注入 ppz123 的 Key）。
        // 所以迁移必须走完整切换：写激活 + applyCustomModel 重启引擎（注入新 Key）+ resume。
        try {
          const updated = await window.codex.setProviderModel({ provider: bag.customModel.provider, model: bag.customModel.model });
          bag.setCustomModel(updated);
          const aligned = await bag.alignThreadToProvider(currentThread.id, bag.customModel, { reason: "send" });
          if (aligned === ALIGN_RESULT.failed) {
            bag.showToast("已切换供应商", `已切换到 ${updated.name} 并重启生效；该会话未能自动接力，请新建会话`);
            return;
          }
          const selectedId = `custom:${updated.provider}:${updated.model}`;
          bag.setModelId(selectedId);
          // 该会话刚迁移成功：全局默认 + 这个会话一起换（其它会话不动）
          bag.applyGlobalModelChoice(selectedId);
          bag.showToast("已自动接力", `引擎已按 ${updated.name} 的 Key 重启，该会话已自动接力到 ${updated.model}（历史上下文与聊天记录完整保留），可正常发送`);
        } catch (error: any) {
          bag.showToast("暂时不能发送", `迁移失败：${String(error?.message ?? error).slice(0, 80)}`);
          return;
        }
      }
    }
    bag.setSending(true);
    // ⛔ 宿主真压缩接力（09-26 用户定稿：摘要接力 + 设置里的自动压缩阈值）：
    //    上下文到达阈值时，先把历史摘成一段 + 最近几轮原文，开新会话，把摘要块拼在本条消息前
    //    再发 —— 引擎下一轮**实际发出**的历史就是短的（引擎自己的压缩窗口在自定义网关下不生效，
    //    实测压缩后请求仍 70K）。旧会话原样保留可切回。阈值 = 设置页「自动压缩阈值」。
    {
      const relayBlock = await bag.maybeRelayHighContext();
      if (relayBlock) { messageText = relayBlock + messageText; bag.setPrompt(""); }
    }
    // 同 queue 分支：注解「chip 原始位置」，渲染层据此内联而不是堆到尾部
    saveMessageOriginal(messageText, value);
    // 立即点亮侧边栏转圈（turn/start 返回前也转）：复用当前会话时立刻标记运行中；
    // 新建会话（thread 为 null）时等 turn/start 返回后再登记。
    if (bag.thread) bag.markThreadRunning(bag.thread.id);
    bag.setNotice("");
    bag.setWorkStartedAt(Date.now());
    // ★ 乐观气泡**立刻**上屏（09-14 用户反馈：消息发出去要等一会才看到）。
    //   原先 setOptimisticInput 排在两段记忆 IPC 之后（readMemoryContext + recallMemory
    //   串行 await），记忆召回慢时用户盯着空输入框发呆。这里在引用解析完、记忆还没开始
    //   之前就用「用户实际输入」占位——显示层本来就会剥掉 SYSTEM TASK / 导入记录包装，
    //   所见即所打；下方算出真正要发给引擎的 sendInput 后再**原位替换**（同一个 id），
    //   乐观/真实的文本去重匹配（userMessageMatchesInput）不受影响。
    //   输入框同步清空，失败路径由下方 failedText 逻辑原样恢复（与原行为一致）。
    const quotePrefix = bag.quoteItem ? `> ${bag.quoteItem.text.split("\n").join("\n> ")}\n\n` : "";
    const contextPrefix = bag.contextItems.length ? `\n\n[用户指定的对话上下文]\n${bag.contextItems.map((item, index) => `(${index + 1}) ${item.role}：${item.text}`).join("\n\n")}\n[上下文结束]\n` : "";
    const skillPrefix = bag.selectedSkills.length ? `\n\n[本轮已引用技能]\n${bag.selectedSkills.map((skill) => `- ${skill.name}：${skill.description}`).join("\n")}\n[请按上述技能工作流执行]\n` : "";
    const filePrefix = inlineFilePaths.length ? `\n\n[附件文件]\n${inlineFilePaths.map((path) => `- ${path}`).join("\n")}\n[附件结束]\n` : "";
    // 专家/团队成员 defer 空会话的首条消息：发送前把用户文本包装成 SYSTEM TASK 段注入角色
    // 系统提示（渲染端按既有约定折叠为「需求已发起」卡片，气泡/引用/复制只暴露用户原文）。
    // 仅在「当前线程还没有任何回合」时生效——包装过一次后线程已非空，后续轮次走普通消息。
    const expertRole = bag.thread && !(bag.thread.turns ?? []).length ? bag.readStoredExpertRole(bag.thread.id) : undefined;
    // 导入会话记录新建的空会话：首条消息同样在「线程无回合」时把外部记录整段附在消息前
    // （渲染端折叠成可展开的「导入的会话记录」卡），发出后标记即清除。与专家角色互斥。
    const pendingImport = bag.thread && !(bag.thread.turns ?? []).length && !expertRole ? bag.readStoredPendingImport(bag.thread.id) : undefined;
    // ★ 乐观气泡**立刻**上屏（09-14 用户反馈：消息发出去要等一会才看到）。
    //   原先 setOptimisticInput 排在两段记忆 IPC 之后（readMemoryContext + recallMemory
    //   串行 await），记忆召回慢时用户盯着空输入框发呆。记忆前缀不参与可见正文
    //   （userDisplayText 会剥掉），所以这里可以先不带记忆上屏。
    //   ⛔ 约束一：钉顶旗标（anchorTopRef 等）必须与 setOptimisticInput 在**同一个同步块**
    //   置位 —— 乐观气泡挂载时 useLayoutEffect 读它决定要不要钉，中间插 await（React 会在
    //   此提交渲染）就会空跑一帧 → 新消息不钉顶（实测 gap=594）。
    //   ⛔ 约束二：只 arm **一次**、之后不改 content —— 两次 setState 会让钉顶/跟随在中间态
    //   上复核（实测视口来回拉扯 bigReversals=5）。
    //   专家/导入首条消息要走 SYSTEM TASK 包装（依赖记忆段），走下方慢路径（低频，可接受）。
    const fastArm = !expertRole && !pendingImport;
    const optimisticId = `local-${Date.now()}`;
    if (fastArm) {
      justSentIds.add(optimisticId);
      armSendAnimationClaim(messageText);   // 真实消息挂载时认领入场动画（见 claimSendAnimation）
      bag.optimisticTurnIdRef.current = null;
      bag.sawRunningTurnRef.current = false;   // 新一轮发送：重置安全阀判据（见该 effect 的 09-17 注释）
      bag.optimisticBaselineRef.current = { threadId: bag.thread?.id ?? null, turnIds: new Set((bag.thread?.turns ?? []).map((entry) => entry.id)) };
      bag.setOptimisticInput({ id: optimisticId, type: "userMessage", content: [
        ...((messageText || threadReferenceBlocks || inlineFilePaths.length || bag.quoteItem) ? [{ type: "text", text: `${quotePrefix}${messageText}${contextPrefix}${skillPrefix}${filePrefix}${threadReferenceSuffix}`, text_elements: [] }] : []),
        ...inlineImagePaths.map((path) => ({ type: "localImage", path })),
        ...sendImages.filter((path) => !inlineImagePaths.includes(path)).map((path) => ({ type: "localImage", path })),
      ] });
      bag.stickToBottomRef.current = false;
      bag.anchorTopRef.current = true;
      bag.anchorTurnIdRef.current = null;
      bag.setPrompt("");
      bag.setQuoteItem(null);
      bag.setContextItems([]);
      bag.setImages([]);
      bag.dbg("send-arm-early");
    }
    // 记忆段耗时打点：乐观气泡已上屏，这段只影响「发给引擎的内容」何时就绪。
    // 若用户仍觉得慢，__adbg 里这行直接给出是记忆慢还是别的慢（记忆已不在关键路径上）。
    const memoryStartedAt = performance.now();
    let memoryPrefix = "";
    if (bag.memoryEnabled && messageText) {
      // 常驻层无条件前置：L0 用户档案 + L1 项目记忆 + L2 近 3 天日志。
      // L3 碎片池仍按当前输入按需召回，两者互不替代——只做召回的话，
      // 模型永远看不到「这个项目不能做什么」这类不出现在本轮提问里的约束。
      try {
        const standing = await window.codex.readMemoryContext(bag.workspace || undefined, bag.workspaceMemoryEnabled);
        if (standing.text) memoryPrefix += standing.text;
      } catch (error: any) { bag.setMemoryStatus(`常驻记忆读取失败：${error.message}`); }
      if (bag.workspaceMemoryEnabled) {
        try {
          const recalled = await window.codex.recallMemory(messageText, bag.workspace || undefined);
          if (recalled.context) memoryPrefix += `\n\n[Harness 相关记忆，仅供参考]\n${recalled.context}\n[记忆结束]\n`;
        } catch (error: any) { bag.setMemoryStatus(`记忆召回失败：${error.message}`); }
      }
    }
    bag.dbg("send-memory", { ms: Math.round(performance.now() - memoryStartedAt) });
    const input = [
      ...((messageText || threadReferenceBlocks || inlineFilePaths.length || bag.quoteItem) ? [{ type: "text", text: `${quotePrefix}${messageText}${contextPrefix}${skillPrefix}${filePrefix}${memoryPrefix}${nowBlock()}${threadReferenceSuffix}`, text_elements: [] }] : []),
      ...inlineImagePaths.map((path) => ({ type: "localImage", path })),
      ...sendImages.filter((path) => !inlineImagePaths.includes(path)).map((path) => ({ type: "localImage", path })),
    ];
    let sendInput = input;
    if (expertRole) {
      const userText = input.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n").trim();
      if (userText) {
        const kindLabel = expertRole.kind === "team" ? "团队会话" : "成员会话";
        const text = `${expertRole.prefix}[SYSTEM TASK · ${kindLabel}]\n=== 用户需求 ===\n${userText}\n=== END ===\n\n${expertRole.instruction}`;
        sendInput = [{ type: "text", text, text_elements: [] }, ...inlineImagePaths.map((path) => ({ type: "localImage", path })), ...sendImages.filter((path) => !inlineImagePaths.includes(path)).map((path) => ({ type: "localImage", path }))];
      }
    } else if (pendingImport) {
      const userText = input.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n").trim();
      if (userText) {
        // 块语义自明（[导入的会话记录]），不再拼多余自然语言指令——那会泄漏进 cleanText/气泡/标题
        const text = `[导入的会话记录]\n${fmtImportNote(pendingImport)}\n=== 记录内容 ===\n${pendingImport.text}\n=== 记录结束 ===\n\n${userText}`;
        sendInput = [{ type: "text", text, text_elements: [] }, ...inlineImagePaths.map((path) => ({ type: "localImage", path })), ...sendImages.filter((path) => !inlineImagePaths.includes(path)).map((path) => ({ type: "localImage", path }))];
      }
    }
    if (!fastArm) {
      // 专家/导入首条消息：SYSTEM TASK 包装依赖记忆段（记忆在 userText 内），只能在这之后上屏
      justSentIds.add(optimisticId);
      armSendAnimationClaim(messageText);   // 真实消息挂载时认领入场动画
      bag.optimisticTurnIdRef.current = null;
      bag.sawRunningTurnRef.current = false;   // 新一轮发送：重置安全阀判据（见该 effect 的 09-17 注释）
      bag.optimisticBaselineRef.current = { threadId: bag.thread?.id ?? null, turnIds: new Set((bag.thread?.turns ?? []).map((entry) => entry.id)) };
      bag.setOptimisticInput({ id: optimisticId, type: "userMessage", content: sendInput });
      bag.stickToBottomRef.current = false;
      bag.anchorTopRef.current = true;
      bag.anchorTurnIdRef.current = null;
      bag.setPrompt("");
      bag.setQuoteItem(null);
      bag.setContextItems([]);
      bag.setImages([]);
    }
    // （fastArm 路径的乐观气泡已在上方上屏；两种路径都只 arm 一次，之后不改 content）
    let createdThreadId: string | null = null;
    try {
      const startTurn = async (target: Thread) => window.codex.request("turn/start", {
        threadId: target.id,
        input: sendInput,
        model: bag.selectedModel?.model ?? modelName(bag.modelId),
        effort: bag.effort || null,
        personality: bag.selectedModel?.supportsPersonality ? bag.personality : null,
        // 审批档位逐回合下发（TurnStartParams.approvalPolicy，协议 schema 实证 09-06）：
        // 权限胶囊切「完全访问/never」后即使 resume 未及时生效，本条回合也按新档位审批
        approvalPolicy: bag.approvalPolicy,
        // 沙箱策略逐回合下发（TurnStartParams.sandboxPolicy，09-10 真实引擎实证）：
        // turn/start 带 {type:"dangerFullAccess"} 能让该轮与后续轮真正切到完全访问。
        // 历史会话/重启后引擎可能仍按创建时的沙箱跑（表现为「UI 显示完全访问却写不了
        // 工作区外、权限总是掉」），每轮按 UI 当前权限下发是唯一稳的做法。
        sandboxPolicy: sandboxPolicy(bag.sandbox, target.cwd ?? bag.workspace ?? ""),
        // 协作模式的 settings 优先于顶层 effort；漏传时计划模式会回落 medium。
        ...(bag.planOnceRef.current ? { collaborationMode: { mode: "plan", settings: { model: bag.selectedModel?.model ?? modelName(bag.modelId), reasoning_effort: bag.effort || null } } } : {}),
      });
      let active = bag.thread;
      if (!active) {
        active = await bag.createEmptyThread();
        if (!active) throw new Error("创建新会话失败");
        createdThreadId = active.id;
      }
      bag.setPrompt("");
      bag.setQuoteItem(null);
      bag.setContextItems([]);
      bag.setImages([]);
      bag.activeModelRef.current = bag.selectedModel?.model ?? modelName(bag.modelId);
      let result: any;
      try {
        result = await startTurn(active);
      } catch (error: any) {
        const unavailable = /not found|no such thread|unloaded/i.test(String(error?.message));
        if (!unavailable) throw error;

        // 刚由 thread/start 创建的空线程可能还没被 turn/start 立即看见。
        // 原地短暂重试，绝不再创建第二条空线程。
        if (createdThreadId === active.id) {
          await new Promise((resolve) => window.setTimeout(resolve, 120));
          result = await startTurn(active);
        } else {
          // app-server 重启后只会卸载内存中的 thread，磁盘会话仍然有效。
          // 必须先 resume 原会话；只有 resume 也明确返回不存在时才创建新会话。
          let recovered: Thread | null = null;
          try {
            const resumed = await window.codex.request("thread/resume", { threadId: active.id, excludeTurns: false });
            if (resumed?.thread) recovered = normalizeLoadedThread(resumed.thread);
          } catch (resumeError: any) {
            if (!/not found|no such thread/i.test(String(resumeError?.message))) throw resumeError;
          }

          if (recovered) {
            active = recovered;
            bag.threadRef.current = recovered;
            bag.threadCacheRef.current.set(recovered.id, recovered);
            bag.setThread(recovered);
            result = await startTurn(active);
            bag.showToast("会话已恢复", "已在原会话中继续发送");
          } else {
            bag.threadCacheRef.current.delete(active.id);
            active = await bag.createEmptyThread();
            if (!active) throw error;
            createdThreadId = active.id;
            bag.showToast("会话已重建", "原会话确实不存在，已新建会话并重新发送");
            result = await startTurn(active);
          }
        }
      }
      createdThreadId = null;
      if (result.turn?.id) {
        // /plan 计划模式旗标已消费：记住这个方案回合，turn/completed 时弹「开始执行」确认条
        if (bag.planOnceRef.current) {
          bag.planOnceRef.current = false;
          bag.setPlanArmed(false);
          bag.setPlanRunning(true);
          bag.planTurnRef.current = { threadId: active.id, turnId: String(result.turn.id) };
        }
        // 记录限流重试上下文（**按会话**）：该回合若以 429 失败，可用原输入在原会话自动重发
        bag.armRateLimitRetry(active.id, {
          input: sendInput,
          model: bag.selectedModel?.model ?? modelName(bag.modelId),
          effort: bag.effort || null,
          personality: bag.selectedModel?.supportsPersonality ? bag.personality : null,
        });
        const hydratedTurn = hydrateTurnUserMessage(result.turn, sendInput);
        bag.optimisticTurnIdRef.current = hydratedTurn.id;
        bag.setActiveTurnId(hydratedTurn.id);
        bag.markThreadRunning(active.id, hydratedTurn.id);
        saveThreadModel(active.id, bag.modelId);
        bag.setThread((current) => {
          // ⛔ 跨会话污染守卫（09-13 审计 P0）：`turn/start` 是 await 的，用户完全可能在
          // 这几秒里切到另一个会话（供应商迁移重启时窗口更长）。此时 `current` 已经是**别的**
          // 会话了，无条件 mergeTurn 会把 A 的用户消息追加进 B 的时间线（mergeTurn 对未知回合
          // 是追加），而 B 永远收不到 A 的 turn/completed → B 那一轮永久"运行中"，
          // 只有重开应用才干净。改：会话已经不是发起会话时只更新缓存、不动当前渲染状态。
          if (current && current.id !== active.id) {
            const cached = bag.threadCacheRef.current.get(active.id);
            if (cached) bag.threadCacheRef.current.set(active.id, mergeTurn(cached, hydratedTurn) ?? cached);
            return current;
          }
          const next = mergeTurn(current, hydratedTurn);
          bag.threadRef.current = next;
          return next;
        });
        const hydratedHit = hydratedTurn.items.find((entry) => entry.type === "userMessage" && userMessageMatchesInput(entry, sendInput));
        if (hydratedHit) bag.setOptimisticInput(null);
      }
      if (expertRole) bag.forgetExpertRole(active.id);
      // 首条已发出：无论包装是否带上了记录（如只发图没文字），该线程已非空、记录永远附不上了，
      // 清除待发送标记（含 localStorage），避免残留卡在重启后误显示。
      if (bag.readStoredPendingImport(active.id)) bag.forgetPendingImport(active.id);
      // 提示气泡的触发（09-20 口径）：**第 1 次**成功发送 + 之后每 10 次为一个周期
      // （旧口径是"每次启动后第一次**输入**必弹"，用户说「一输入文字就出来了」）。
      // 只置 pending，真正的展示等按钮渲染出来（见 enhanceAnchorVisible 注释）。
      bag.enhanceSendCountRef.current += 1;
      if (shouldShowHintAfterSends(bag.enhanceSendCountRef.current)) bag.enhanceHintAfterSendRef.current = true;
      void bag.refreshThreads();
      // **自愈**（09-18）：这次用当前档位发送**成功**了 → 清掉「该档位不被支持」的记录。
      // 没有这一步，用户强制选回被标灰的档位、或网关后来放开了，标记会永久留着（一直标灰）。
      if (bag.effort) clearEffortUnsupported(bag.selectedModel?.model ?? modelName(bag.modelId), bag.effort);
    } catch (error: any) {
      // turn/start RPC 直接以限流失败：安排应用层自动重试（10 次退避，按会话独立）
      if (isRateLimitError(error?.message)) {
        const retryThreadId = createdThreadId ?? bag.optimisticBaselineRef.current.threadId ?? bag.threadRef.current?.id;
        if (retryThreadId) {
          bag.setSending(false);
          bag.setInterrupting(false);
          bag.setWorkStartedAt(null);
          bag.markThreadStopped(retryThreadId);
          bag.armRateLimitRetry(retryThreadId, {
            input: sendInput,
            model: bag.selectedModel?.model ?? modelName(bag.modelId),
            effort: bag.effort || null,
            personality: bag.selectedModel?.supportsPersonality ? bag.personality : null,
          });
          bag.scheduleRateLimitRetry(retryThreadId, 1);
          return;
        }
      }
      // 档位不被该模型/网关支持（09-18：档位声明 UI 删掉之后的兜底 —— 选到不支持的档位
      // 不再让用户提前勾掉，而是**报错时自动学会**：记住这一档 + 自动降一档重发一次）。
      // 判定要"档位语义 + 否定语义"双命中，否则 invalid api key 之类会被误判（见 effort-support.ts）。
      if (isUnsupportedEffortError(error?.message) && bag.effort) {
        const fallbackModelId = bag.selectedModel?.model ?? modelName(bag.modelId);
        const fallback = pickEffortFallback(bag.effort, blockedEffortsOf(fallbackModelId));
        const retryThreadId = createdThreadId ?? bag.optimisticBaselineRef.current.threadId ?? bag.threadRef.current?.id;
        if (fallback && fallback !== bag.effort && retryThreadId) {
          markEffortUnsupported(fallbackModelId, bag.effort);
          // 落会话级（有会话）或全局默认（无会话）——与用户手动选档同一条链路，切会话各自独立
          // （菜单里的"该模型不支持"标记由 EffortPicker 打开时重读，不需要这里同步 state）
          bag.applyEffort(fallback);
          bag.setSending(false);
          bag.setInterrupting(false);
          bag.setWorkStartedAt(null);
          bag.markThreadStopped(retryThreadId);
          bag.effortFallbackRef.current = {
            threadId: retryThreadId,
            input: sendInput,
            model: fallbackModelId,
            effort: fallback,
            personality: bag.selectedModel?.supportsPersonality ? bag.personality : null,
          };
          bag.showToast(
            `「${effortLabels[bag.effort] ?? bag.effort}」不被支持`,
            `已自动改用「${effortLabels[fallback] ?? fallback}」重发；这个模型以后会跳过该档位`,
          );
          window.setTimeout(() => void bag.executeEffortFallbackRetry(), 400);
          return;
        }
        // 已经是最保守的一档（或所有更低档都被标记过）→ 不重发，如实告诉用户
        if (!fallback) {
          bag.setNotice(`该模型不支持「${effortLabels[bag.effort] ?? bag.effort}」档位，且没有更低的档位可降级 —— 请在思考强度里手动选一档`);
        }
      }
      // 彻底失败也必须复位运行态，否则停止按钮一直转、composer 一直锁
      bag.setPlanRunning(false);
      if (createdThreadId && !bag.runningThreadIdsRef.current.has(createdThreadId)) {
        const orphanId = createdThreadId;
        await window.codex.request("thread/delete", { threadId: orphanId }).catch(() => undefined);
        bag.threadCacheRef.current.delete(orphanId);
        bag.setThreads((current) => current.filter((entry) => entry.id !== orphanId));
        if (bag.threadRef.current?.id === orphanId) {
          bag.threadRef.current = null;
          bag.setThread(null);
        }
      }
      bag.setSending(false);
      bag.setActiveTurnId(null);
      // ⛔ 必须按**发起会话**清运行态（09-13 审计 P0）：用户在 await 期间很可能已经切到别的
      // 会话，而 `threadRef.current` 是"此刻屏幕上的会话"——在 A 发消息后立刻切到 B，一旦 A 上
      // 失败（401/超时），用 threadRef 会把 **B** 标记成停止、把 A 永久留在运行态：
      // A 侧栏一直转圈、composer 显示"停止"但 interrupt() 因 runningTurnIds 已清而无声失效、
      // 之后在 A 发的消息全进排队且永不启动 → 该会话不可用，只能重开应用。
      // 发起会话 id 取 `createdThreadId`（新建时）或 `optimisticBaselineRef`（发送开始时记下的目标）。
      bag.markThreadStopped(createdThreadId ?? bag.optimisticBaselineRef.current.threadId ?? bag.threadRef.current?.id);
      // 失败时把乐观气泡收回去（09-13 审计：气泡不回收 + 提示 2.6 秒后消失 = 看起来像已发出），
      // 并把正文还给输入框，用户可以改一下重发。
      const failedText = (Array.isArray(sendInput) ? sendInput : [])
        .filter((part: any) => part?.type === "text")
        .map((part: any) => String(part.text ?? ""))
        .join("");
      bag.setOptimisticInput(null);
      if (failedText) bag.setPrompt((current) => (String(current ?? "").trim() ? current : failedText));
      bag.setInterrupting(false);
      bag.setWorkStartedAt(null);
      bag.scopedNotice(error.message, bag.thread?.id ?? createdThreadId ?? undefined);
    }
    } finally {
      bag.sendInFlightRef.current = false;
    }
  }
