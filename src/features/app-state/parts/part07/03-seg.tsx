/**
 * usePart07c（09-22：part07 按序切分出来的第 3 段，纯搬迁、零改写）
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句**只引用自己的局部声明与 bag**（跨语句不靠裸名）—— 这是本次切分成立的前提：
 *    每个名字要么是本段刚声明的局部，要么走 bag（跨 part 用），要么由段末 return 交给组合根转交 App。
 *    改动后请重跑预检【92】与保真脚本（口径见 docs/archive/REFACTOR-PLAN-2026-09-21.md §10.2）。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import { attachmentToken, fileToken, promptFilePaths, shouldSavePastedTextAsFile, splitAttachmentSegments, stripAttachmentTokens } from "../../../../lib/composer-attachments.mjs";
import { imageToken, splitPromptSegments, promptImagePaths, stripImageTokens, isImagePart, imagePartSrc, normalizeImagePartForSend } from "../../../../lib/prompt-images";
import { visibleTurnWindow, mergeTurnListsById } from "../../../../lib/turn-order.mjs";
import { setFavoriteHandler, type FavoriteRequest } from "../../../../lib/favorite-bridge";
import { basename } from "../../../../lib/basename";
import { Turn } from "../../../../lib/turn";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../app-view/helpers";
import type { Bag } from "../bag-types";

export function usePart07c(bag: Bag) {
  // 卸载时清定时器，避免在已卸载组件上 setState
  useEffect(() => () => { if (bag.enhanceHintTimerRef.current != null) window.clearTimeout(bag.enhanceHintTimerRef.current); }, []);

  // 记录上一条提示，避免连续两次重复
  useEffect(() => { if (bag.enhanceHint) bag.lastEnhanceHintRef.current = bag.enhanceHint; }, [bag.enhanceHint]);

  async function runPromptEnhance() {
    // 撤销模式：还原备份原文
    if (!bag.enhanceBusy && bag.hasEnhanceBackup && bag.enhanceBackupRef.current != null) {
      bag.setPrompt(bag.enhanceBackupRef.current);
      bag.enhanceBackupRef.current = null;
      bag.setHasEnhanceBackup(false);
      bag.setNotice("已还原为你原来的输入");
      return;
    }
    const raw = stripImageTokens(bag.prompt).trim();
    if (!raw || bag.enhanceBusy) return;
    // ⛔ 取消令牌（09-17）：原先"取消"只把 loading 关掉，`enhancePrompt` 的请求仍在飞，
    // 返回后照样 `setPrompt(增强结果)` 盖掉用户输入 —— 用户以为取消了、内容还是被换了。
    // 每次发起取一个 runId，回来时对不上就整个丢弃（不写输入框、不置 backup、不改状态）。
    const runId = ++bag.enhanceRunIdRef.current;
    bag.setEnhanceBusy(true);
    try {
      const result = await window.codex.enhancePrompt(raw);
      if (runId !== bag.enhanceRunIdRef.current) return;   // 已被取消：静默丢弃
      if (!result.ok || !result.text) {
        bag.setNotice(result.error || "增强失败，请重试");
        return;
      }
      bag.enhanceBackupRef.current = bag.prompt;
      bag.setHasEnhanceBackup(true);
      bag.setPrompt((current) => {
        // 保留占位符位置：文本段被替换，占位符原样保留（split 后只替换 text 段）
        const segments = splitPromptSegments(current);
        const enhanced = splitPromptSegments(result.text ?? "").filter((seg) => seg.kind === "text").map((seg) => (seg as any).text).join("\n");
        return segments.map((seg) => seg.kind === "text" ? (seg.text.trim() ? enhanced : "") : imageToken((seg as any).path)).filter(Boolean).join(" ");
      });
      bag.setNotice("提示词已增强，再次点击可还原原文");
    } catch (error: any) {
      if (runId !== bag.enhanceRunIdRef.current) return;
      bag.setNotice(`增强失败：${error.message ?? error}`);
    } finally {
      if (runId === bag.enhanceRunIdRef.current) bag.setEnhanceBusy(false);
    }
  }
bag.runPromptEnhance = runPromptEnhance as typeof bag.runPromptEnhance;

  /** 取消正在进行的增强：作废在飞的请求，输入内容保持原样。 */
  function cancelPromptEnhance() {
    bag.enhanceRunIdRef.current += 1;   // 让在飞请求的结果失效（见 runPromptEnhance 注释）
    bag.setEnhanceBusy(false);
    bag.setNotice("已取消增强，输入内容保持原样");
  }
bag.cancelPromptEnhance = cancelPromptEnhance as typeof bag.cancelPromptEnhance;

  // 用户修改文本后备份失效（WorkBuddy：内容发散即清 backup，防止误还原覆盖用户输入）
  useEffect(() => {
    if (bag.hasEnhanceBackup && bag.prompt !== bag.enhanceBackupRef.current && !bag.promptIncludesBackup(bag.prompt, bag.enhanceBackupRef.current ?? "")) {
      bag.enhanceBackupRef.current = null;
      bag.setHasEnhanceBackup(false);
    }
  }, [bag.prompt, bag.hasEnhanceBackup]);

  /** 备份有效性判定：prompt 剥离占位符后仍包含备份原文的前 60 字（占位符增删不算发散）。 */
  function promptIncludesBackup(current: string, backup: string) {
    const core = stripImageTokens(backup);
    if (!core) return true;
    return stripImageTokens(current).includes(core.slice(0, Math.min(core.length, 60)));
  }
bag.promptIncludesBackup = promptIncludesBackup as typeof bag.promptIncludesBackup;

  /** WorkBuddy 式内联插入：在编辑框光标处直接插入图片 chip 节点（粘贴/选择图片共用），
   *  随后序列化回流 prompt/images——DOM 即时可见，不走重建（否则光标闪跳）。 */
  /** 在光标处插入附件 chip（图片 / 文件同一套）。图片与文件只在 token 与图标上分叉。 */
  function insertComposerAttachments(kind: "image" | "file", paths: string[]) {
    if (!paths.length) return;
    const el = bag.composerInputRef.current;
    if (!el) {
      // 编辑器还没挂载（极早场景）：只回流状态，占位符文本照常带上
      if (kind === "image") bag.setImages((current) => [...current, ...paths.filter((path) => !current.includes(path))]);
      else bag.onPromptChange(`${bag.prompt}${bag.prompt && !bag.prompt.endsWith(" ") ? " " : ""}${paths.map((path) => fileToken(path)).join(" ")}`);
      return;
    }
    el.focus();
    const selection = window.getSelection();
    for (const path of paths) {
      const chip = bag.makeComposerChip(kind, path);
      const range = document.createRange();
      if (selection && selection.rangeCount > 0 && el.contains(selection.getRangeAt(0).startContainer)) {
        const current = selection.getRangeAt(0);
        range.setStart(current.startContainer, current.startOffset);
      } else {
        range.selectNodeContents(el);
      }
      range.collapse(false);
      range.insertNode(chip);
      range.setStartAfter(chip);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    bag.syncComposerFromDom();
  }
bag.insertComposerAttachments = insertComposerAttachments as typeof bag.insertComposerAttachments;

  function insertComposerImages(paths: string[]) {
    // ⛔ 粘贴不再按模型模态硬拦（09-18 用户：「带图发送直接报错还不能对话，设计不合理」）：
    // 图片照常进编辑框，发送时统一降级（见 sendMessage 里的「图片降级发送」）——
    // 视觉插件已配置就自动转 describe_image 识图，没配置也只忽略图片、对话不中断。
    bag.insertComposerAttachments("image", paths);
  }
bag.insertComposerImages = insertComposerImages as typeof bag.insertComposerImages;

  /** 插入文件 chip（09-18：文件不再挂在输入框上方，改为跟图片一样的内联 chip）。 */
  function insertComposerFiles(paths: string[]) {
    bag.insertComposerAttachments("file", paths);
  }
bag.insertComposerFiles = insertComposerFiles as typeof bag.insertComposerFiles;

  /** 粘贴的纯文本太长 → 落盘成 .txt，再作为文件 chip 插入。
   *  文本内容原样写进文件（不裁剪、不改写），模型侧照旧通过 [附件文件] 段拿到路径去读。 */
  async function pasteLongText(text: string) {
    if (!shouldSavePastedTextAsFile(text)) return;
    try {
      const path = await window.codex.savePastedText(text);
      if (!path) return;
      bag.insertComposerFiles([path]);
      bag.setNotice(`长文本已存为文件：${basename(path)}（${text.length} 字）`);
    } catch (error: any) {
      bag.setNotice(`长文本转文件失败：${error?.message ?? error}`);
    }
  }
bag.pasteLongText = pasteLongText as typeof bag.pasteLongText;

  /** 轻量 resume：excludeTurns:true 只取会话元数据（引擎不再全量水合历史），
   *  另按 desc 取最新一页回合供首屏——配合回合窗口化，打开成本与会话长度无关。
   *  此前 excludeTurns:false 会让引擎把几千个回合整个序列化回来、然后 turns/list 又取
   *  一遍——「切会话慢」的数据侧主因（渲染侧已窗口化）。
   *  extra 透传（如 dynamicTools）：引擎 resume 的 schema 实证接受 dynamicTools，
   *  每次恢复都重注册当前工具面——旧会话也能用上新增的动态工具。 */
  async function resumeThreadLight(params: { threadId: string; sandbox?: string; approvalPolicy?: string; dynamicTools?: any[] }, turnBudget: number = bag.TURNS_PAGE): Promise<any> {
    const result = await window.codex.request("thread/resume", { threadId: params.threadId, excludeTurns: true, sandbox: params.sandbox, approvalPolicy: params.approvalPolicy, ...(Array.isArray(params.dynamicTools) && params.dynamicTools.length ? { dynamicTools: params.dynamicTools } : {}) });
    const thread = result?.thread;
    if (thread && !(Array.isArray(thread.turns) && thread.turns.length)) {
      try {
        const page: any = await window.codex.request("thread/turns/list", { threadId: params.threadId, limit: turnBudget, sortDirection: "desc", itemsView: "full" });
        const data = Array.isArray(page?.data) ? page.data : [];
        if (data.length) thread.turns = [...data].reverse();
        if (page?.nextCursor) bag.turnsCursorRef.current.set(params.threadId, page.nextCursor);
        else bag.turnsCursorRef.current.delete(params.threadId);
      } catch { /* 分页失败维持原结果，不影响会话打开 */ }
    }
    return result;
  }
bag.resumeThreadLight = resumeThreadLight as typeof bag.resumeThreadLight;

  /** 向上加载更早的历史（ZCode 式增量）：
   *  ① 内存里还有未渲染的回合（hidden>0）→ 只扩大渲染窗口，不碰网络；
   *  ② 内存耗尽且有游标 → thread/turns/list 按 cursor 拉**一页**（200）拼到最前。
   *  拼接会让视口上方长高，按 scrollHeight 增量补偿 scrollTop，视口内容不跳。
   *  loadingEarlierRef 防重入：滚动近顶自动触发 + 按钮点击共用这一个入口。 */
  async function loadEarlierTurns(id: string) {
    if (bag.loadingEarlierRef.current.has(id)) return;
    const current = bag.threadCacheRef.current.get(id) ?? bag.threadRef.current;
    if (!current || current.id !== id) return;
    const rendered = bag.turnWindowRef.current[id] ?? bag.TURN_WINDOW;
    const hidden = current.turns.length - rendered;
    // ref 优先（本次会话内已更新过），否则读线程对象上的兜底游标（见 resumeThreadWithTurns）。
    const cursor = bag.turnsCursorRef.current.get(id) ?? ((current as any).__turnsCursor ?? null);
    if (hidden <= 0 && !cursor) return;
    bag.loadingEarlierRef.current.add(id);
    bag.setEarlierLoadingId(id);
    // ⛔ 兜底：任何异常路径都不许让「正在载入」与防重入锁长期持有——实测续载请求挂起时，
    // 提示会一直挂在会话顶部、且该会话再也加载不了更早历史（用户实测「一直常驻，切会话都在」）。
    const hintTimer = window.setTimeout(() => {
      bag.loadingEarlierRef.current.delete(id);
      bag.setEarlierLoadingId((current) => (current === id ? null : current));
    }, 8000);
    try {
      const el0 = bag.scrollRef.current;
      const beforeTop = el0?.scrollTop ?? 0;
      const beforeHeight = el0?.scrollHeight ?? 0;
      // 位置补偿用「锚点元素」而不是 scrollHeight 增量：content-visibility: auto 下离屏回合的
      // 高度是估算值、scrollHeight 会滞后 → 补偿不足，用户看到内容被顶飞（实测位移 4.3k px）。
      // 记下「当前视口内第一条回合」相对视口的 top，插入后按它的位移把 scrollTop 补回去。
      const anchorNode = [...(el0?.querySelectorAll(".turn-group") ?? [])].find((node) => node.getBoundingClientRect().bottom > 0) as HTMLElement | undefined;
      const anchorTopBefore = anchorNode ? anchorNode.getBoundingClientRect().top : 0;
      let grow = 0;
      if (hidden > 0) {
        grow = Math.min(hidden, bag.TURNS_PAGE); // 本地展开一批的量，翻老历史不产生网络请求
      } else if (cursor) {
        try {
          // 超时保护：引擎偶发慢/挂起时不能让加载状态卡死（超时按失败处理，游标保留，下次滚动重试）
          const result: any = await Promise.race([
            window.codex.request("thread/turns/list", { threadId: id, limit: bag.TURNS_PAGE, sortDirection: "desc", itemsView: "full", cursor }),
            new Promise((_, reject) => window.setTimeout(() => reject(new Error("turns/list timeout")), 8000)),
          ]);
          const data = Array.isArray(result?.data) ? result.data : [];
          if (result?.nextCursor) bag.turnsCursorRef.current.set(id, result.nextCursor);
          else bag.turnsCursorRef.current.delete(id);
          if (data.length) {
            grow = data.length;
            const earlier = [...data].reverse();
            bag.setThread((c) => {
              if (!c || c.id !== id) return c;
              // ⛔ 09-15：按 id 去重 + 时序规范化（旧实现在游标异常时会原样前插 → 重复回合/顺序错乱）
              const next = { ...c, turns: mergeTurnListsById(c.turns ?? [], earlier) };
              bag.threadRef.current = next;
              bag.threadCacheRef.current.set(id, next);
              return next;
            });
          }
        } catch { /* 拉取失败不影响当前视口 */ }
      }
      if (grow > 0) {
        bag.expandTurnWindow(id, grow);
        // 双 rAF 等 React 提交 DOM 后把视口钉回原内容（上方插入了新渲染的回合）：
        // 优先用锚点元素位移（对 content-visibility 免疫），锚点已卸载才退回 scrollHeight 增量。
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const el = bag.scrollRef.current;
          if (!el) return;
          if (anchorNode && anchorNode.isConnected) {
            el.scrollTop += anchorNode.getBoundingClientRect().top - anchorTopBefore;
          } else {
            el.scrollTop = beforeTop + Math.max(0, el.scrollHeight - beforeHeight);
          }
        }));
      }
    } finally {
      window.clearTimeout(hintTimer);
      bag.loadingEarlierRef.current.delete(id);
      bag.setEarlierLoadingId((current) => (current === id ? null : current));
    }
  }
bag.loadEarlierTurns = loadEarlierTurns as typeof bag.loadEarlierTurns;

  /** 时间线滚动近顶（<720px ≈ 一屏）自动续载更早的历史（ZCode 式）：
   *  loadEarlierTurns 内部防重入 + 切换动画期间跳过（switchJumpRef，避免对旧 DOM 做
   *  scrollTop 补偿）；贴近顶部时每向上滚一屏加载一页，离开顶部自然停止。 */
  function onTimelineScroll(event: React.UIEvent<HTMLDivElement>) {
    const el = event.currentTarget;
    // 只有用户真的滚过才响应：程序化滚动（打开时跳底、插入内容后的位置补偿）也会把
    // scrollTop 扫过近顶区间，据此加载就成了「没滚也加载」。
    if (!bag.userScrolledRef.current) return;
    const id = bag.threadRef.current?.id;
    if (!id || bag.switchJumpPending()) return;
    // 回到最新（贴底）：把往上滚期间展开的历史窗口收回基线（用户 09-14：滚下来后不该
    // 一直撑着渲染；切会话回来也应是初始态）。只收窗口，不动数据。
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 48) {
      bag.collapseTurnWindow(id);
      return;
    }
    if (el.scrollTop > 720) return;
    void bag.loadEarlierTurns(id);
  }
bag.onTimelineScroll = onTimelineScroll as typeof bag.onTimelineScroll;

  /** 刻度尺跳转：目标回合可能还在渲染窗口之外（元素未挂载，scrollIntoView 找不到目标）。
   *  先把窗口扩到覆盖目标回合，等 React 提交 DOM 后再跳。引用恒定（useCallback []），
   *  保证 MemoMessageRuler 的 memo 比较仍然拦得住无关重渲染。 */
  const jumpToTurnInWindow = useCallback((turnId: string) => {
    const t = bag.threadRef.current;
    if (t) {
      const idx = t.turns.findIndex((turn: Turn) => turn.id === turnId);
      const rendered = bag.turnWindowRef.current[t.id] ?? bag.TURN_WINDOW;
      if (idx >= 0 && idx < t.turns.length - rendered) {
        bag.turnWindowRef.current = { ...bag.turnWindowRef.current, [t.id]: t.turns.length - idx };
        bag.setTurnWindow(bag.turnWindowRef.current);
      }
    }
    requestAnimationFrame(() => requestAnimationFrame(() => jumpToTurn(turnId)));
  }, []);
bag.jumpToTurnInWindow = jumpToTurnInWindow as typeof bag.jumpToTurnInWindow;

  /** 独立会话弹窗：把会话开到新窗口。focused=true 表示该会话已有弹窗（已聚焦旧窗口）。 */
  async function popoutCurrentThread(threadId: string) {
    try {
      const result = await window.codex.popoutThread(threadId);
      if (result?.focused) {
        bag.showToast("独立窗口已打开", "该会话已有独立窗口，已聚焦到它");
      } else {
        bag.showToast("已弹出独立窗口", "会话可拖出应用外，多个弹窗可同时存在");
      }
      bag.refreshPoppedOut();
      // 主窗口当前正在看的会话被弹窗出去 → 自动离开它（避免双窗口重复渲染）：
      // 切到侧栏第一个「未被弹窗」的会话；全都弹出去了 → 回欢迎页（用户 09-13 定稿）。
      // poppedOutThreadIds 可能还没含刚弹窗的这个（refreshPoppedOut 异步），用 threadId 显式排除。
      if (bag.threadRef.current?.id === threadId) {
        const firstAvailable = bag.listThreads.find((entry) => entry.id !== threadId && !bag.poppedOutThreadIds.has(entry.id));
        if (firstAvailable) void bag.openThread(firstAvailable.id);
        else bag.setThread(null);
      }
    } catch (error: any) {
      bag.setNotice(`打开独立窗口失败：${error?.message ?? String(error)}`);
    }
  }
bag.popoutCurrentThread = popoutCurrentThread as typeof bag.popoutCurrentThread;

  /** 离开某会话前记下阅读位置：只在「用户确实往上翻了」时记（距底 > 40px），
   *  贴在底部的会话不需要记忆（切回来本来就该贴底）。 */
  function rememberScrollPosition(id: string) {
    if (!id) return;
    const el = bag.scrollRef.current;
    if (!el) return;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (fromBottom > 40) bag.scrollMemoRef.current.set(id, fromBottom);
    else bag.scrollMemoRef.current.delete(id);
    // 与窗口记忆同量级的 LRU 上限，避免长跑进程里无界增长
    if (bag.scrollMemoRef.current.size > bag.TURN_WINDOW_MEMORY_KEEP) {
      const first = bag.scrollMemoRef.current.keys().next().value;
      if (first !== undefined) bag.scrollMemoRef.current.delete(first);
    }
  }
bag.rememberScrollPosition = rememberScrollPosition as typeof bag.rememberScrollPosition;

  /** 取回某会话的阅读位置；没有记忆（或已贴在底部）返回 null → 调用方走原来的贴底逻辑。 */
  function recallScrollOffset(id: string): number | null {
    if (!id) return null;
    const value = bag.scrollMemoRef.current.get(id);
    if (value === undefined) return null;
    bag.scrollMemoRef.current.delete(id); // 用一次即消费，避免后续无关渲染反复跳位
    return value;
  }
bag.recallScrollOffset = recallScrollOffset as typeof bag.recallScrollOffset;

  /* ── 收藏夹（09-24）────────────────────────────────────────────────
     真相源在主进程 `userData/favorites.json`；这里的 `favorites` 只是**镜像**。
     三处消费同一份列表：设置页（批量管理）、加号菜单（一键发送）、消息操作条（收藏）。
     任一入口写完都整体替换镜像（主进程返回全量列表）⇒ 不会出现「删了又回来」。
     ⛔ 不要在这里另存一份 localStorage：两份真相源必然分叉。 */
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [favoritesBusy, setFavoritesBusy] = useState(false);
bag.favorites = favorites as typeof bag.favorites;
bag.setFavorites = setFavorites as typeof bag.setFavorites;
bag.favoritesBusy = favoritesBusy as typeof bag.favoritesBusy;
bag.setFavoritesBusy = setFavoritesBusy as typeof bag.setFavoritesBusy;

  async function refreshFavorites(): Promise<FavoriteItem[]> {
    try {
      const list = await window.codex.listFavorites();
      const safe = Array.isArray(list) ? list : [];
      setFavorites(safe);
      return safe;
    } catch (error: any) {
      bag.setNotice(`收藏读取失败：${error?.message ?? error}`);
      return [];
    }
  }
bag.refreshFavorites = refreshFavorites as typeof bag.refreshFavorites;

  // 启动拉一次（加号菜单/设置页要立刻有内容）。之后不再轮询：所有变更都经本层写回并整体替换镜像。
  useEffect(() => { void refreshFavorites(); }, []);

  async function addFavoriteItem(input: Partial<FavoriteItem>): Promise<FavoriteItem | null> {
    try {
      const result = await window.codex.addFavorite(input);
      setFavorites(result.items);
      bag.showToast("已收藏", result.item.title);
      return result.item;
    } catch (error: any) {
      bag.setNotice(`收藏失败：${error?.message ?? error}`);
      return null;
    }
  }
bag.addFavoriteItem = addFavoriteItem as typeof bag.addFavoriteItem;

  /** 「收藏这条消息」—— 由 MessageFooter 经 favorite-bridge 发起（不逐层传 prop）。 */
  async function favoriteFromMessage(request: FavoriteRequest): Promise<void> {
    if (!request?.content?.trim()) return;
    await addFavoriteItem({ kind: request.kind, title: request.title, content: request.content, source: request.source });
  }
bag.favoriteFromMessage = favoriteFromMessage as typeof bag.favoriteFromMessage;

  async function updateFavoriteItem(id: string, patch: Partial<FavoriteItem>): Promise<void> {
    try {
      setFavorites(await window.codex.updateFavorite({ id, patch }));
    } catch (error: any) {
      bag.setNotice(`收藏修改失败：${error?.message ?? error}`);
    }
  }
bag.updateFavoriteItem = updateFavoriteItem as typeof bag.updateFavoriteItem;

  /** 批量删除：**一次显式 id 列表**（批量管理仍是一次确认，不是逐条弹窗）。 */
  async function removeFavoriteItems(ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    try {
      const result = await window.codex.deleteFavorites(ids);
      setFavorites(result.items);
      if (result.removed) bag.showToast(`已删除 ${result.removed} 条收藏`);
      return result.removed;
    } catch (error: any) {
      bag.setNotice(`删除失败：${error?.message ?? error}`);
      return 0;
    }
  }
bag.removeFavoriteItems = removeFavoriteItems as typeof bag.removeFavoriteItems;

  /** 插入（不发送）：图片/文件走输入框的 chip，文本/链接追加到草稿末尾（不覆盖用户正在写的内容）。 */
  function insertFavorite(item: FavoriteItem): void {
    if (!item) return;
    if (item.kind === "image") { insertComposerImages([item.content]); return; }
    if (item.kind === "file") { insertComposerFiles([item.content]); return; }
    bag.setPrompt((current) => (current.trim() ? `${current}\n${item.content}` : item.content));
  }
bag.insertFavorite = insertFavorite as typeof bag.insertFavorite;

  /**
   * 一键发送。
   * ⛔ 不能「先 setPrompt 再 send」：`send()` 读的是 `bag.prompt`（上一次渲染的值），
   *    同一 tick 里 setState 还没生效 ⇒ 会发出**上一条草稿**（最恶心的静默错发）。
   *    走 `pendingCommandTextRef` 旁路 —— 那是 send() 自己设计的「外部供给文本」优先通道
   *    （斜杠命令展开就用它），值在 send() 内部当轮消费，不经 React 状态。
   * ⛔ 输入框已有草稿时不自动发送：那会覆盖用户正在写的东西，改成插入 + 明确提示。
   */
  async function sendFavorite(item: FavoriteItem): Promise<void> {
    if (!item) return;
    const hasDraft = Boolean(bag.prompt.trim() || bag.images.length || bag.attachedFiles.length);
    if (hasDraft) {
      insertFavorite(item);
      bag.setNotice("输入框已有内容，收藏已插入（未自动发送）");
      return;
    }
    const token = item.kind === "image" ? imageToken(item.content) : item.kind === "file" ? fileToken(item.content) : "";
    bag.pendingCommandTextRef.current = token || item.content;
    try {
      await bag.send();
      // 记账失败不该影响已发出的消息 ⇒ 静默
      void window.codex.touchFavorite(item.id).then((list) => setFavorites(list)).catch(() => undefined);
    } catch (error: any) {
      bag.pendingCommandTextRef.current = null;
      bag.setNotice(`发送失败：${error?.message ?? error}`);
    }
  }
bag.sendFavorite = sendFavorite as typeof bag.sendFavorite;

  /** 加入 Agent 记忆：写记忆金字塔的层文件（主进程侧先读后写，只追加不覆盖）。 */
  async function favoriteToMemory(ids: string[], scope: MemoryLayerScope): Promise<FavoritesToMemoryResult> {
    if (!ids.length) return { ok: false, written: 0, error: "没有选中任何收藏" };
    setFavoritesBusy(true);
    try {
      const result = await window.codex.favoritesToMemory({ ids, scope, workspace: bag.workspace });
      if (result.ok) bag.showToast("已加入 Agent 记忆", `写入 ${result.written} 条`);
      else bag.setNotice(`加入记忆失败：${result.error ?? "未知原因"}`);
      return result;
    } catch (error: any) {
      bag.setNotice(`加入记忆失败：${error?.message ?? error}`);
      return { ok: false, written: 0, error: String(error?.message ?? error) };
    } finally {
      setFavoritesBusy(false);
    }
  }
bag.favoriteToMemory = favoriteToMemory as typeof bag.favoriteToMemory;

  // 注册收藏桥：MessageFooter 只表达意图，不 import 状态层（避免循环依赖）
  useEffect(() => {
    setFavoriteHandler((request) => void favoriteFromMessage(request));
    return () => setFavoriteHandler(null);
  }, []);

  // 截图完成 ⇒ 放进输入框（用户 09-24 明确：**不加截图图标按钮**，只在输入框里预放入）。
  // ⛔ 插入路径**只有这一条**：主进程成功截图必发此事件，所以 invoke 的返回值不再另插一次。
  // 09-24 二轮：截图现在先进覆盖层编辑器（标注/裁剪），确认 = 已落盘 + 已复制剪贴板 + 到这里。
  useEffect(() => window.codex.onScreenshotCaptured((payload) => {
    const path = String(payload?.path ?? "");
    if (!path) return;
    insertComposerImages([path]);
    bag.showToast(payload.mode === "region" ? "已截图（框选）" : "已截图（全屏）", "已复制到剪贴板并放入输入框，按回车发送");
  }), []);

  return { runPromptEnhance, cancelPromptEnhance, promptIncludesBackup, insertComposerAttachments, insertComposerImages, insertComposerFiles, pasteLongText, resumeThreadLight, loadEarlierTurns, onTimelineScroll, jumpToTurnInWindow, popoutCurrentThread, rememberScrollPosition, recallScrollOffset, favorites, setFavorites, favoritesBusy, setFavoritesBusy, refreshFavorites, favoriteFromMessage, addFavoriteItem, updateFavoriteItem, removeFavoriteItems, insertFavorite, sendFavorite, favoriteToMemory };
}
