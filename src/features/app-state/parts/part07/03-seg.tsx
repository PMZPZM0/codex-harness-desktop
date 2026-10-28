/**
 * usePart07c（09-22：part07 按序切分出来的第 3 段，纯搬迁、零改写）
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句**只引用自己的局部声明与 bag**（跨语句不靠裸名）—— 这是本次切分成立的前提：
 *    每个名字要么是本段刚声明的局部，要么走 bag（跨 part 用），要么由段末 return 交给组合根转交 App。
 *    改动后请重跑预检【92】与保真脚本（口径见 docs/archive/REFACTOR-PLAN-2026-09-21.md §10.2）。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { attachmentToken, fileToken, promptFilePaths, shouldSavePastedTextAsFile, splitAttachmentSegments, stripAttachmentTokens } from "../../../../lib/composer-attachments.mjs";
import { imageToken, splitPromptSegments, promptImagePaths, stripImageTokens, isImagePart, imagePartSrc, normalizeImagePartForSend } from "../../../../lib/prompt-images";
import { mergeTurnListsById } from "../../../../lib/turn-order.mjs";
import { primeTurnHistory, setTurnWindowTail, turnWindowTailFor } from "../../../../lib/turn-history.mjs";
import { setFavoriteHandler, type FavoriteRequest } from "../../../../lib/favorite-bridge";
import { basename } from "../../../../lib/basename";
import { cancelHistoryPin, clearHistoryPin, clearHistoryPinState, contentOffsetTop, scrollToOffsetInstant, setHistoryPin, setHistoryPinState, type HistoryPinState } from "../../../../components/scroll-utils";
import { Turn } from "../../../../lib/turn";
import type { Bag } from "../bag-types";

/* 10-21：这两个游标必须跨渲染存活 —— 放在 hook 体内会每次渲染归零（冷却窗形同虚设）。 */
let lastHistoryLoadAt = 0;
let lastHistoryScrollTop: number | null = null;
let lastWindowSlideAt = 0;
/* 单次水合的回合数。⛔ 必须比首屏的 TURNS_PAGE(5) 更小：老回合经常是带长工具输出的
   巨型回合（实测一条 3.6MB），一次挂 5 条会让主线程渲染阻塞十几秒（CDP 都超时）。
   2 条一页仍保持「按页」，但把单次提交的正文量砍掉一半以上。 */
const HISTORY_PAGE = 2;

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
    /* 虚拟滚动条（10-21）：后台拉全量回合元数据（itemsView:"notLoaded"，不含正文），
       不 await —— 打开会话的等待时间不变。元数据到达前滚动条只按已加载回合算高度，
       到达后由 turn-history 订阅触发重渲染、补上整段历史。 */
    void primeTurnHistory(params.threadId, (method, payload) => window.codex.request(method as any, payload as any));
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

  /** 向上水合一页更早的历史（10-21 虚拟滚动条）：
   *  ① 内存里窗口上方还有回合 → 把**滑动窗口**整体上移一页（不碰网络）；
   *  ② 内存耗尽且有游标 → thread/turns/list 按 cursor 拉**一页**拼到最前，再上移窗口。
   *  ⛔ 窗口大小恒为 TURN_WINDOW：往上读时最新回合落进底部占位区，绝不把整段历史
   *  挂进 React（实测全量加载后 53 个回合让切会话从 0.5s 变成 2s）。
   *  顶部/底部两个占位区都按「隐藏回合数 × 平均回合高」撑高度，窗口滑动时一增一减，
   *  总高度不变，锚点补偿只处理真实内容高度差。 */
  async function loadEarlierTurns(id: string) {
    if (bag.loadingEarlierRef.current.has(id)) return;
    const current = bag.threadCacheRef.current.get(id) ?? bag.threadRef.current;
    if (!current || current.id !== id) return;
    const rendered = bag.turnWindowRef.current[id] ?? bag.TURN_WINDOW;
    const tail = turnWindowTailFor(id);
    const hiddenAbove = current.turns.length - tail - rendered;
    // ref 优先（本次会话内已更新过），否则读线程对象上的兜底游标（见 resumeThreadWithTurns）。
    const cursor = bag.turnsCursorRef.current.get(id) ?? ((current as any).__turnsCursor ?? null);
    if (hiddenAbove <= 0 && !cursor) return;
    /* ⛔ 10-21 用户实测「滚到顶部就弹回最下面」：续载会在**上方**插入内容，
       高度变化被贴底跟随（height-follow）当成"底部又长了" ⇒ 直接跳到 contentTail。
       用户此刻是在看历史，必须先交出跟随权（同时撤钉顶留白）。 */
    bag.releaseToUserRef.current?.("history");
    /* ⛔ 一次续载消费掉本次用户滚动信号：续载后滚动位置仍在触发区时，布局/程序滚动
       会不断触发 onTimelineScroll ⇒ 一次手势把全部历史加载出来、页面狂闪。
       下一次真实滚轮/触摸由 part09 的 window 监听重新置真，一次手势最多加载一页。 */
    bag.userScrolledRef.current = false;
    lastHistoryLoadAt = Date.now();
    bag.loadingEarlierRef.current.add(id);
    bag.setEarlierLoadingId(id);
    // ⛔ 兜底：任何异常路径都不许让「正在载入」与防重入锁长期持有——实测续载请求挂起时，
    // 提示会一直挂在会话顶部、且该会话再也加载不了更早历史（用户实测「一直常驻，切会话都在」）。
    const hintTimer = window.setTimeout(() => {
      bag.loadingEarlierRef.current.delete(id);
      bag.setEarlierLoadingId((current) => (current === id ? null : current));
    }, 8000);
    let pinEl: HTMLElement | null = null;
    let pinCancel: (() => void) | null = null;
    let pinState: HistoryPinState | null = null;
    const endPin = (why = "") => {
      if (why && pinEl) bag.dbg("history-pin-end", { why, top: Math.round(pinEl.scrollTop) });
      if (pinEl && pinCancel) clearHistoryPin(pinEl, pinCancel);
      if (pinEl && pinState) clearHistoryPinState(pinEl, pinState);
      pinEl = null;
      pinCancel = null;
      pinState = null;
    };
    try {
      const el0 = bag.scrollRef.current;
      /* ⛔ 不在入口就取消上一轮钉住：拉取要几百毫秒，期间上一页的延迟布局还在结算，
         提前撤掉会让视口先飘一下。等新内容到手、准备扩窗时再交接（见 grow>0 分支）。 */
      const beforeTop = el0?.scrollTop ?? 0;
      const spacerBefore = el0?.querySelector<HTMLElement>(".timeline-history-spacer") ?? null;
      const spacerBeforeH = spacerBefore?.offsetHeight ?? 0;
      /* 视口完全落在占位区里（用户拖滚动条直接到顶）：占位区没有可锚定的内容。
         水合后把视口落到新占位区的下边缘 = 新加载内容的顶部，不能拿"下面的回合"
         当锚点（那会把滚动条从顶部一路拽到内容处）。 */
      const inSpacer = Boolean(el0) && spacerBeforeH > 0 && beforeTop + (el0?.clientHeight ?? 0) <= spacerBeforeH + 2;
      // 位置补偿用「锚点元素」而不是 scrollHeight 增量：离屏/占位区高度会让 scrollHeight 滞后。
      // 记下「当前视口内第一条回合」在**内容坐标**里的位置，插入后按增量补 scrollTop。
      const anchorNode = inSpacer ? undefined : [...(el0?.querySelectorAll(".turn-group") ?? [])].find((node) => node.getBoundingClientRect().bottom > 0) as HTMLElement | undefined;
      /* 10-20：锚点不能只存 DOM 引用 —— 续载/收起工具回合会让 React 替换节点，
         旧节点 isConnected=false 后代码会误走 scrollHeight 回退，直接跳到上一页顶部。
         `.turn-group` 的 id 是 `turn-<turnId>`，跨重渲染稳定，用它重新解析。 */
      const anchorId = anchorNode?.id ?? "";
      /* 10-20：补偿基准用**内容坐标**（anchor 在滚动内容里的 offset），不是视口 top。
         视口 top 会被用户滚轮改变；用内容 offset 才能只补"上方插入的高度"、不跟用户抢滚动。 */
      const anchorContentBefore = anchorNode && el0 ? contentOffsetTop(anchorNode, el0) : 0;
      let fetched = 0;
      if (hiddenAbove <= 0 && cursor) {
        try {
          // 超时保护：引擎偶发慢/挂起时不能让加载状态卡死（超时按失败处理，游标保留，下次滚动重试）
          const result: any = await Promise.race([
            window.codex.request("thread/turns/list", { threadId: id, limit: HISTORY_PAGE, sortDirection: "desc", itemsView: "full", cursor }),
            new Promise((_, reject) => window.setTimeout(() => reject(new Error("turns/list timeout")), 8000)),
          ]);
          const data = Array.isArray(result?.data) ? result.data : [];
          if (result?.nextCursor) bag.turnsCursorRef.current.set(id, result.nextCursor);
          else bag.turnsCursorRef.current.delete(id);
          if (data.length) {
            fetched = data.length;
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
      const availableAbove = hiddenAbove + fetched;
      const grow = availableAbove > 0 ? Math.min(availableAbove, HISTORY_PAGE) : 0;
      const newLength = bag.threadRef.current?.id === id ? (bag.threadRef.current.turns.length ?? current.turns.length) : current.turns.length;
      const targetTail = Math.max(0, Math.min(newLength - rendered, tail + grow));
      /* 拉取期间用户已经回到底部 ⇒ 不要上移窗口（否则会把刚贴底的人带回历史）。
         新拉到的更早回合留在内存，底部由 collapse/贴底负责。 */
      if (grow > 0 && el0 && el0.scrollHeight - el0.scrollTop - el0.clientHeight < 48) {
        bag.dbg("history-load-skip-bottom", { id, top: Math.round(el0.scrollTop) });
        return;
      }
      if (grow > 0) {
        /* 交接时按**当前**内容坐标重算锚点：上一页的 rAF 钉住在拉取期间可能已经补过
           一次延迟布局，用入口时记的旧值会少补/多补一截。 */
        const liveAnchor = anchorId ? document.getElementById(anchorId) : anchorNode;
        const handoffBefore = liveAnchor && el0 && el0.contains(liveAnchor) ? contentOffsetTop(liveAnchor, el0) : anchorContentBefore;
        if (el0) cancelHistoryPin(el0);
        /* ⛔ 在 setState **之前**占住「历史钉住」标记与锚点状态：
           · 占位区变矮 / 真实内容插入的那一刻，update() 的通用占位高度补偿必须让位；
           · 时间线的 layout effect 在**首帧绘制前**消费这个状态，把净高度差补进 scrollTop
             （只靠 rAF 会晚一帧，慢机器/大会话上能看到 300px+ 的闪跳）。 */
        let pinCancelled = false;
        pinCancel = () => { pinCancelled = true; };
        if (el0) {
          pinEl = el0;
          pinState = {
            threadId: id,
            anchorId,
            contentBefore: handoffBefore,
            spacerBefore: spacerBeforeH,
            inSpacer,
            direction: 1,
            expectedTail: targetTail,
            expectedLength: newLength,
            applied: false,
          };
          setHistoryPin(el0, pinCancel);
          setHistoryPinState(el0, pinState);
        }
        /* 窗口整体上移：顶部占位区少 grow 个、底部占位区多 grow 个（都用估算高度，
           总高度不变）；真实内容替换估算值的高度差由锚点补偿吃掉。 */
        setTurnWindowTail(id, targetTail);
        /* ⛔⛔ 10-20 用户实测「滚轮触发上面页数，就自动到最前面」：
           旧补偿按**视口 top** 算，用户一滚就必须取消（否则和用户抢滚动）；一取消，
           上方插入的高度直接把视图顶走。改成按**内容坐标增量**补偿 —— 内容 offset 只随
           上方插入/布局结算变化，用户滚轮不改变它 ⇒ 只补插入量，用户怎么滚都不会被撤销。
           1.5s 上限覆盖表格/图片/代码高亮的延迟结算；连续翻页由 WeakMap 先取消上一轮，
           避免两轮同时改 scrollTop（上一版验收实测锚点被顶飞 717px）。 */
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const el = bag.scrollRef.current;
          if (!el || pinCancelled || bag.threadRef.current?.id !== id) { endPin("stale"); return; }
          if (inSpacer) {
            // 拖到顶：落到新占位区的下边缘（= 刚水合出来的内容顶部），避免停在空白占位里。
            // layout effect 通常已经在 paint 前落过一次；这里只兜底。
            if (!pinState?.applied) {
              const spacer = el.querySelector<HTMLElement>(".timeline-history-spacer");
              bag.selfScrollUntilRef.current = Date.now() + 80;
              scrollToOffsetInstant(el, Math.max(0, spacer?.offsetHeight ?? 0));
            }
            endPin("spacer-land");
            return;
          }
          bag.dbg("history-pin-start", { anchorId, before: Math.round(pinState?.contentBefore ?? anchorContentBefore), top: Math.round(beforeTop) });
          /* ⛔ 10-20：锚点按 id 重新解析。React 重渲染/纯工具回合合并会替换 DOM 节点，
             拿旧节点判断 isConnected 会误走 scrollHeight 回退（content-visibility 估算高度
             下直接跳到上一页顶部）。`.turn-group` 的 id 跨重渲染稳定。 */
          const resolveAnchor = (): HTMLElement | null => {
            if (!anchorId) return anchorNode && anchorNode.isConnected ? anchorNode : null;
            const byId = document.getElementById(anchorId);
            return byId && el.contains(byId) ? byId : null;
          };
          if (!resolveAnchor()) {
            /* 锚点被移出窗口（连续翻页/连点按钮时可能发生）：落到新窗口的上沿，
               不能停在上方/下方占位区里变成一片空白。 */
            const spacer = el.querySelector<HTMLElement>(".timeline-history-spacer");
            bag.selfScrollUntilRef.current = Date.now() + 80;
            scrollToOffsetInstant(el, Math.max(0, spacer?.offsetHeight ?? 0));
            endPin("no-anchor-land");
            return;
          }
          const deadline = performance.now() + 1500;
          const pin = () => {
            if (pinCancelled) { endPin("cancelled"); return; }
            const node = bag.scrollRef.current;
            if (!node || bag.threadRef.current?.id !== id) { endPin("thread-changed"); return; }
            const anchor = resolveAnchor();
            if (!anchor) { endPin("anchor-lost"); return; }
            /* 只补"锚点内容 offset 的增长"（= 上方插入/占位收缩的净高度）；用户滚轮改的是
               scrollTop 与 rect.top，两者抵消，内容 offset 不变 ⇒ 不会被这里撤销。 */
            const contentNow = contentOffsetTop(anchor, node);
            const delta = contentNow - (pinState?.contentBefore ?? anchorContentBefore);
            if (Math.abs(delta) > 0.5) {
              bag.selfScrollUntilRef.current = Date.now() + 80;
              node.scrollTop += delta;
              if (pinState) pinState.contentBefore = contentNow;
              bag.dbg("history-pin", { delta: Math.round(delta), top: Math.round(node.scrollTop) });
            }
            if (performance.now() < deadline) requestAnimationFrame(pin);
            else endPin("deadline");
          };
          requestAnimationFrame(pin);
        }));
      }
    } finally {
      window.clearTimeout(hintTimer);
      bag.loadingEarlierRef.current.delete(id);
      bag.setEarlierLoadingId((current) => (current === id ? null : current));
    }
  }
bag.loadEarlierTurns = loadEarlierTurns as typeof bag.loadEarlierTurns;

  /** 往下读：窗口整体下移（tail 减小），把底部占位区里的已加载回合换回真实内容。
   *  纯本地滑窗、不拉网络；用户滚到渲染窗口底边时由 onTimelineScroll 触发。
   *  一次最多下移 2 个回合，锚点取**最后一条可见回合**（窗口下移后它仍在窗口内）。 */
  function slideTurnWindowDown(id: string) {
    if (bag.loadingEarlierRef.current.has(id)) return;
    if (Date.now() - lastWindowSlideAt < 220) return;
    const current = bag.threadCacheRef.current.get(id) ?? bag.threadRef.current;
    if (!current || current.id !== id) return;
    const tail = turnWindowTailFor(id);
    if (tail <= 0) return;
    const rendered = bag.turnWindowRef.current[id] ?? bag.TURN_WINDOW;
    const el0 = bag.scrollRef.current;
    if (!el0) return;
    const bottomEdge = el0.getBoundingClientRect().bottom;
    const anchorNode = [...el0.querySelectorAll(".turn-group")].reverse().find((node) => node.getBoundingClientRect().top < bottomEdge) as HTMLElement | undefined;
    if (!anchorNode) return;
    const anchorId = anchorNode.id;
    const contentBefore = contentOffsetTop(anchorNode, el0);
    const targetTail = Math.max(0, tail - Math.min(HISTORY_PAGE, Math.max(1, rendered - 1)));
    lastWindowSlideAt = Date.now();
    let cancelled = false;
    let pinState: HistoryPinState | null = {
      threadId: id,
      anchorId,
      contentBefore,
      spacerBefore: 0,
      inSpacer: false,
      direction: -1,
      expectedTail: targetTail,
      expectedLength: current.turns.length,
      applied: false,
    };
    const cancel = () => { cancelled = true; };
    cancelHistoryPin(el0);
    setHistoryPin(el0, cancel);
    setHistoryPinState(el0, pinState);
    const endPin = (why = "") => {
      if (why) bag.dbg("history-slide-end", { why, top: Math.round(el0.scrollTop) });
      clearHistoryPin(el0, cancel);
      if (pinState) clearHistoryPinState(el0, pinState);
      pinState = null;
    };
    setTurnWindowTail(id, targetTail);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = bag.scrollRef.current;
      if (!el || cancelled || bag.threadRef.current?.id !== id) { endPin("stale"); return; }
      const resolveAnchor = () => {
        const byId = document.getElementById(anchorId);
        return byId && el.contains(byId) ? byId : null;
      };
      if (!resolveAnchor()) { endPin("no-anchor"); return; }
      const deadline = performance.now() + 1200;
      const pin = () => {
        if (cancelled) { endPin("cancelled"); return; }
        const node = bag.scrollRef.current;
        if (!node || bag.threadRef.current?.id !== id) { endPin("thread-changed"); return; }
        const anchor = resolveAnchor();
        if (!anchor) { endPin("anchor-lost"); return; }
        const now = contentOffsetTop(anchor, node);
        const delta = now - (pinState?.contentBefore ?? contentBefore);
        if (Math.abs(delta) > 0.5) {
          bag.selfScrollUntilRef.current = Date.now() + 80;
          node.scrollTop += delta;
          if (pinState) pinState.contentBefore = now;
          bag.dbg("history-slide", { delta: Math.round(delta), top: Math.round(node.scrollTop), tail: targetTail });
        }
        if (performance.now() < deadline) requestAnimationFrame(pin);
        else endPin("deadline");
      };
      requestAnimationFrame(pin);
    }));
  }

  /** 时间线滚动到**历史占位区边界**时水合下一页（10-21 虚拟滚动条）。
   *  ⛔ 不看"离文档顶多远"：占位区高度就是整段未加载历史，边界随水合往上退。
   *  ⛔ 一次用户手势只加载一页（userScrolledRef 被续载消费）+ 冷却窗 + 补偿中不响应，
   *  避免布局/程序滚动把整段历史一次拉完。 */
  function onTimelineScroll(event: React.UIEvent<HTMLDivElement>) {
    const el = event.currentTarget;
    /* 方向基线：先记账再判早退 —— 补偿期间也要保持基线最新，否则补偿结束后第一次
       用户滚动会和"上一次用户滚动"比较，方向判断失真。 */
    const previousTop = lastHistoryScrollTop;
    lastHistoryScrollTop = el.scrollTop;
    const id = bag.threadRef.current?.id;
    if (!id) return;
    /* ⛔ 回到底部必须排在补偿抑制窗/滑窗钉住之前：用户从历史一口气滚到文档底时，
       上一轮的 slide pin 可能刚写过 scrollTop（selfScrollUntil 80ms）⇒ 旧顺序会把它
       当程序滚动跳过，tail 留在 >0，视口停在底部占位区 = 一片空白（10-21 验收⑧实测）。
       用户明确滚到底（userScrolledRef 真）时直接收窗口/tail=0，并取消历史钉住。 */
    if (bag.userScrolledRef.current && el.scrollHeight - el.scrollTop - el.clientHeight < 48) {
      cancelHistoryPin(el);
      bag.collapseTurnWindow(id);
      return;
    }
    /* ⛔ 不再用「补偿进行中就一律不响应」挡住用户：大会话一页要渲染/结算几百毫秒到 1 秒，
       快滚时用户早已越过占位区边界（随后被当成"拖到顶"落到边界，视觉上就是一次跳）。
       现在只忽略**补偿自己写 scrollTop 产生的** scroll 事件（selfScrollUntil 抑制窗），
       用户的新滚动可以立刻触发下一页；旧钉住在拉取期间继续跑，扩窗前再交接。 */
    if (Date.now() < bag.selfScrollUntilRef.current) return;
    // 只有用户真的滚过才响应：程序化滚动（打开时跳底、插入内容后的位置补偿）也会把
    // scrollTop 扫过触发区，据此加载就成了「没滚也加载」。
    if (!bag.userScrolledRef.current) return;
    // 冷却窗：同一手势内的多次 wheel/scroll 只允许触发一页。
    if (Date.now() - lastHistoryLoadAt < 350) return;
    if (bag.switchJumpPending()) return;
    const tail = turnWindowTailFor(id);
    // 回到最新（贴底）：把往上滚期间展开/滑走的窗口收回基线（用户 09-14：滚下来后不该
    // 一直撑着渲染；切会话回来也应是初始态）。只收窗口，不动数据。
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 48) {
      bag.collapseTurnWindow(id);
      return;
    }
    /* ⛔ 只在上滚时水合历史。下滚时（尤其是从占位区往最新消息方向滚）如果还按
       「离边界近」触发，会在用户反向滚动期间继续插内容 + 锚点补偿，滚动会一顿一顿的，
       到底时还可能被一次新的水合带离底部。
       ⇒ 下滚只做**本地滑窗**：接近渲染窗口底边时把底部占位区里的已加载回合换回来。 */
    const movingDown = previousTop != null && el.scrollTop > previousTop + 2;
    if (movingDown) {
      if (tail > 0) {
        const groups = [...el.querySelectorAll(".turn-group")];
        const last = groups[groups.length - 1] as HTMLElement | undefined;
        const downMargin = Math.max(900, el.clientHeight * 1.5);
        if (last && last.getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom + downMargin) {
          slideTurnWindowDown(id);
        }
      }
      return;
    }
    const spacer = el.querySelector<HTMLElement>(".timeline-history-spacer");
    const spacerH = spacer?.offsetHeight ?? 0;
    const margin = Math.max(1200, el.clientHeight * 2);
    /* 占位区存在 ⇒ 触发点是「占位区边界 + 2 屏」（提前一个缓冲，滚动时不会看见空白）；
       元数据还没到/没有占位区时退回文档顶触发一页（按钮仍是主入口）。 */
    const triggerAt = spacerH > 0 ? spacerH + margin : 12;
    if (el.scrollTop <= triggerAt + 200) {
      bag.dbg("history-scroll", { top: Math.round(el.scrollTop), spacerH, tail, triggerAt, user: bag.userScrolledRef.current, jump: bag.switchJumpPending(), cd: Math.round(Date.now() - lastHistoryLoadAt), down: movingDown });
    }
    if (el.scrollTop <= triggerAt) {
      void bag.loadEarlierTurns(id);
    }
  }
bag.onTimelineScroll = onTimelineScroll as typeof bag.onTimelineScroll;

  /** 刻度尺跳转：目标回合可能还在渲染窗口之外（元素未挂载，scrollIntoView 找不到目标）。
   *  把**滑动窗口**移到目标附近（tail = 总长 − 目标下标 − 窗口大小），等 React 提交后再跳。
   *  引用恒定（useCallback []），保证 MemoMessageRuler 的 memo 比较仍然拦得住无关重渲染。 */
  const jumpToTurnInWindow = useCallback((turnId: string) => {
    const t = bag.threadRef.current;
    if (t) {
      const idx = t.turns.findIndex((turn: Turn) => turn.id === turnId);
      const rendered = bag.turnWindowRef.current[t.id] ?? bag.TURN_WINDOW;
      if (idx >= 0) {
        setTurnWindowTail(t.id, Math.max(0, t.turns.length - idx - rendered));
      }
    }
    /* ⛔ 不等“两个 rAF 后 scrollIntoView”：滑窗切换要经过 store → React 提交，
       大会话里两个 rAF 可能还没挂上目标；scrollIntoView 失败会停在别的回合。
       改成等目标真的进了 DOM，用内容坐标瞬时定位（含顶部占位区偏移）。 */
    const started = performance.now();
    let frames = 0;
    const align = () => {
      const el = bag.scrollRef.current;
      const node = document.getElementById(`turn-${turnId}`);
      if (!el || !node || !el.contains(node)) {
        if (performance.now() - started < 800) requestAnimationFrame(align);
        return;
      }
      const desired = Math.max(0, contentOffsetTop(node, el) - 12);
      if (Math.abs(el.scrollTop - desired) > 4) {
        bag.selfScrollUntilRef.current = Date.now() + 80;
        scrollToOffsetInstant(el, desired);
      }
      frames += 1;
      /* 目标挂载后内容还会继续结算（图片/代码高亮/折叠展开）—— 跟 30 帧把它钉在顶部，
         不依赖 smooth scroll 的时长，也不会“点了刻度停在上一段”。 */
      if (frames < 30 && performance.now() - started < 800) requestAnimationFrame(align);
    };
    requestAnimationFrame(() => requestAnimationFrame(align));
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
