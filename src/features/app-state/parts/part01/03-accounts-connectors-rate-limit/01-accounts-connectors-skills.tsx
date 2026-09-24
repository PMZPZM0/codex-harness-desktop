/**
 * usePart01c1 —— usePart01c 按序切分出的第 1 段（纯搬迁、零改写）。
 * 域：账号与连接器与技能 · 限流重试与中断/乐观输入
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import { performRelayLogin, resolveRelayAutoTarget, resolveRelayTarget, resolveRelayKeyTarget, writeRelayActive, readRelayActive, type RelayActive } from "../../../../../lib/relay";
import { SkillInstallState } from "../../../../../lib/skill-install-state";
import { registerKnownSkills } from "../../../../../lib/tool-display.mjs";
import { SkillRemoveState } from "../../../../../lib/skill-remove-state";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../../app-view/helpers";
import type { RateLimitCtx, BotEntry } from "../../types";
import type { Bag } from "../../bag-types";

export function usePart01c1(bag: Bag) {
  // 中转站账户（sub2api）：余额/套餐同步与一键生成供应商
  const [relayBusy, setRelayBusy] = useState(false);
bag.relayBusy = relayBusy as typeof bag.relayBusy; bag.setRelayBusy = setRelayBusy as typeof bag.setRelayBusy;

  const [relayActive, setRelayActive] = useState<RelayActive | null>(() => {
    try { return JSON.parse(localStorage.getItem("relay-active-v1") ?? "null"); } catch { return null; }
  });
bag.relayActive = relayActive as typeof bag.relayActive; bag.setRelayActive = setRelayActive as typeof bag.setRelayActive;

  // OpenAI 官方订阅当前生效账号标识：切换账号时变化，驱动输入框额度徽标立即刷新（避免同 provider 下切号不更新）
  const [openaiActiveAcct, setOpenaiActiveAcct] = useState<string | null>(null);
bag.openaiActiveAcct = openaiActiveAcct as typeof bag.openaiActiveAcct; bag.setOpenaiActiveAcct = setOpenaiActiveAcct as typeof bag.setOpenaiActiveAcct;

  const [skillInstall, setSkillInstall] = useState<SkillInstallState | null>(null);
bag.skillInstall = skillInstall as typeof bag.skillInstall; bag.setSkillInstall = setSkillInstall as typeof bag.setSkillInstall;

  const [skillRemove, setSkillRemove] = useState<SkillRemoveState | null>(null);
bag.skillRemove = skillRemove as typeof bag.skillRemove; bag.setSkillRemove = setSkillRemove as typeof bag.setSkillRemove;

  const [connectorMenuOpen, setConnectorMenuOpen] = useState(false);
bag.connectorMenuOpen = connectorMenuOpen as typeof bag.connectorMenuOpen; bag.setConnectorMenuOpen = setConnectorMenuOpen as typeof bag.setConnectorMenuOpen;

  const [connectors, setConnectors] = useState<ConnectorEntry[]>([]);
bag.connectors = connectors as typeof bag.connectors; bag.setConnectors = setConnectors as typeof bag.setConnectors;

  const [connectorDraft, setConnectorDraft] = useState<ConnectorDraft>({ name: "", transport: "stdio", command: "", args: [], url: "", headers: {}, env: {}, secrets: {} });
bag.connectorDraft = connectorDraft as typeof bag.connectorDraft; bag.setConnectorDraft = setConnectorDraft as typeof bag.setConnectorDraft;

  const [connectorEditorOpen, setConnectorEditorOpen] = useState(false);
bag.connectorEditorOpen = connectorEditorOpen as typeof bag.connectorEditorOpen; bag.setConnectorEditorOpen = setConnectorEditorOpen as typeof bag.setConnectorEditorOpen;

  const [connectorSaving, setConnectorSaving] = useState(false);
bag.connectorSaving = connectorSaving as typeof bag.connectorSaving; bag.setConnectorSaving = setConnectorSaving as typeof bag.setConnectorSaving;

  const [connectorSecret, setConnectorSecret] = useState("");
bag.connectorSecret = connectorSecret as typeof bag.connectorSecret; bag.setConnectorSecret = setConnectorSecret as typeof bag.setConnectorSecret;

  const [connectorTemplates, setConnectorTemplates] = useState<ConnectorTemplate[]>([]);
bag.connectorTemplates = connectorTemplates as typeof bag.connectorTemplates; bag.setConnectorTemplates = setConnectorTemplates as typeof bag.setConnectorTemplates;

  const [connectorTemplateModal, setConnectorTemplateModal] = useState<ConnectorTemplate | null>(null);
bag.connectorTemplateModal = connectorTemplateModal as typeof bag.connectorTemplateModal; bag.setConnectorTemplateModal = setConnectorTemplateModal as typeof bag.setConnectorTemplateModal;

  const [connectorOAuth, setConnectorOAuth] = useState<ConnectorOAuthEvent | null>(null);
bag.connectorOAuth = connectorOAuth as typeof bag.connectorOAuth; bag.setConnectorOAuth = setConnectorOAuth as typeof bag.setConnectorOAuth;

  const [connectorTemplateValues, setConnectorTemplateValues] = useState<Record<string, string>>({});
bag.connectorTemplateValues = connectorTemplateValues as typeof bag.connectorTemplateValues; bag.setConnectorTemplateValues = setConnectorTemplateValues as typeof bag.setConnectorTemplateValues;

  const [connectorTemplateSaving, setConnectorTemplateSaving] = useState(false);
bag.connectorTemplateSaving = connectorTemplateSaving as typeof bag.connectorTemplateSaving; bag.setConnectorTemplateSaving = setConnectorTemplateSaving as typeof bag.setConnectorTemplateSaving;

  const [memoryConfigOpen, setMemoryConfigOpen] = useState(false);
bag.memoryConfigOpen = memoryConfigOpen as typeof bag.memoryConfigOpen; bag.setMemoryConfigOpen = setMemoryConfigOpen as typeof bag.setMemoryConfigOpen;

  const [contextOpen, setContextOpen] = useState(false);
bag.contextOpen = contextOpen as typeof bag.contextOpen; bag.setContextOpen = setContextOpen as typeof bag.setContextOpen;

  const [contextQuery, setContextQuery] = useState("");
bag.contextQuery = contextQuery as typeof bag.contextQuery; bag.setContextQuery = setContextQuery as typeof bag.setContextQuery;

  const [contextItems, setContextItems] = useState<{ id: string; role: "用户" | "Codex"; text: string }[]>([]);
bag.contextItems = contextItems as typeof bag.contextItems; bag.setContextItems = setContextItems as typeof bag.setContextItems;

  // 输入框上方的引用条：点击消息「引用」后在此展示，发送时以块引用前缀拼进消息文本
  const [quoteItem, setQuoteItem] = useState<{ id: string; text: string } | null>(null);
bag.quoteItem = quoteItem as typeof bag.quoteItem; bag.setQuoteItem = setQuoteItem as typeof bag.setQuoteItem;

  const [images, setImages] = useState<string[]>([]);
bag.images = images as typeof bag.images; bag.setImages = setImages as typeof bag.setImages;

  const [loading, setLoading] = useState(true);
bag.loading = loading as typeof bag.loading; bag.setLoading = setLoading as typeof bag.setLoading;

  const [sending, setSending] = useState(false);
bag.sending = sending as typeof bag.sending; bag.setSending = setSending as typeof bag.setSending;

  const sendInFlightRef = useRef(false);
bag.sendInFlightRef = sendInFlightRef as typeof bag.sendInFlightRef;

  // ── 429 限流自动重试（应用层兜底，**按会话独立**）──
  // 引擎侧 request_max_retries/stream_max_retries 耗尽后 turn 仍以限流失败结束时，
  // 把原输入自动重发，最多 RATE_LIMIT_MAX_ATTEMPTS 次，退避 5s→120s 逐次放长。
  // 不区分模型/供应商——任何模型限流都走这条兜底；用户可停止或立即重试。
  // ⛔⛔ 09-19 用户实测「多会话同时跑，只有当前看的那个会自动重试，后台的会话直接断」：
  //   · 旧实现 retryContextRef / rateLimitAttemptRef / rateLimitTimerRef 全是**单槽**，
  //     最后发送的会话会覆盖前面的 ⇒ 多会话必然互相踩（会话没有独立）。
  //   · 429 检测点又写在**当前会话事件流**里（threadId 过滤之后）⇒ 后台会话的
  //     turn/completed(429) 根本走不到那段代码 ⇒ 连「排重试」都不会。
  //   现在：上下文 / 尝试计数 / 定时器全部**按 threadId 独立**；检测点提到**跨会话区**
  //   （见事件流里 armRateLimitRetry 与 scheduleRateLimitRetry 的调用），
  //   并按会话错峰（±20% 抖动 + 重试发起串行化），避免多会话同时重发把上游打成更严重的 429。
  // ⛔ 09-19 用户要求「每个会话独立弹这个自动重试」：重试条状态**按会话分别记录**，
  //   多会话同时限流时各自有各自的倒计时（原来单槽会被最后一次覆盖，看不到别的会话）。
  const [rateLimitRetries, setRateLimitRetries] = useState<Record<string, { attempt: number; retryAt: number }>>({});
bag.rateLimitRetries = rateLimitRetries as typeof bag.rateLimitRetries; bag.setRateLimitRetries = setRateLimitRetries as typeof bag.setRateLimitRetries;

  /** 引擎侧上游重连状态（引擎上报的 `Reconnecting... N/M`），**按会话分别记录**。
   *  ⛔ 09-19 用户实测「运行脚本检查每次都空转半天没反应」+「每个会话必须完全独立」：
   *  引擎在 429 / 断流时会**自己**重试（request_max_retries=10），这段时间界面完全没动静
   *  ⇒ 用户以为卡死了。这里把它的重试进度显示出来（第 N/M 次）。
   *  按会话存：A 会话的重连提示不会被 B 会话覆盖，各窗口只显示自己的。 */
  const [upstreamRetries, setUpstreamRetries] = useState<Record<string, { no: number; total: number }>>({});
bag.upstreamRetries = upstreamRetries as typeof bag.upstreamRetries; bag.setUpstreamRetries = setUpstreamRetries as typeof bag.setUpstreamRetries;

  /** 写入/清除某个会话的重试条（entry=null 表示清除该会话） */
  function setRetryEntry(threadId: string, entry: { attempt: number; retryAt: number } | null) {
    if (!threadId) return;
    bag.setRateLimitRetries((current) => {
      if (entry) return { ...current, [threadId]: entry };
      if (!(threadId in current)) return current;
      const next = { ...current };
      delete next[threadId];
      return next;
    });
  }
bag.setRetryEntry = setRetryEntry as typeof bag.setRetryEntry;

  const retryContextsRef = useRef<Map<string, RateLimitCtx>>(new Map());
bag.retryContextsRef = retryContextsRef as typeof bag.retryContextsRef;

  const rateLimitAttemptsRef = useRef<Map<string, number>>(new Map());
bag.rateLimitAttemptsRef = rateLimitAttemptsRef as typeof bag.rateLimitAttemptsRef;

  const rateLimitTimersRef = useRef<Map<string, number>>(new Map());
bag.rateLimitTimersRef = rateLimitTimersRef as typeof bag.rateLimitTimersRef;

  /** 重试发起串行化：**按会话各自排队**（同一个会话不并发投递），
   *  ⛔⛔ 09-19 用户严令「每个会话必须完全独立，A 在跑/报错/重试跟 B 一点关系都没有」：
   *  原实现是**全局单门**（一个 Promise 串所有会话）—— B 的重试必须等 A 的重试发完，
   *  这就是"会话之间还串着"的根源之一。现在按 threadId 分门：跨会话完全并行，
   *  只有同一个会话自己的多次重试才排队（防重复投递）。 */
  const retryGatesRef = useRef<Map<string, Promise<unknown>>>(new Map());
bag.retryGatesRef = retryGatesRef as typeof bag.retryGatesRef;

  /** 档位降档重发的内容（即时、只试一次，单槽即可，与限流重试链路解耦）。 */
  const effortFallbackRef = useRef<{ threadId: string; input: any[]; model: string; effort: string | null; personality: string | null } | null>(null);
bag.effortFallbackRef = effortFallbackRef as typeof bag.effortFallbackRef;

  // 截断自动续接的防循环记账：threadId → { 次数, 首续时刻 }。窗口内超限即停手提示换供应商。
  const autoContinueLogRef = useRef<Map<string, { count: number; firstAt: number }>>(new Map());
bag.autoContinueLogRef = autoContinueLogRef as typeof bag.autoContinueLogRef;

  const [, setRateLimitTick] = useState(0);
bag.setRateLimitTick = setRateLimitTick as typeof bag.setRateLimitTick;

  /* ★ 本地技能清单喂给展示层（09-24：「用了哪个技能」要看得懂）：
     引擎侧只有技能**目录名**（`…/skills/electron-main-surgery/…`），用户看不懂那是啥。
     `skills:local-list` 是唯一写着"这个技能干什么"的真相源 —— 启动取一次，注册进
     纯函数表 `registerKnownSkills`（tool-display.mjs），命令行卡/折叠芯片据此显示中文/描述。
     ⛔ 取不到也没关系：未注册时退回目录名，功能不受影响（所以这里不报错、不重试）。 */
  useEffect(() => {
    let alive = true;
    Promise.resolve(window.codex?.listLocalSkills?.())
      .then((list: unknown) => { if (alive && Array.isArray(list)) registerKnownSkills(list as never[]); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!Object.keys(bag.rateLimitRetries).length) return;
    const tick = window.setInterval(() => bag.setRateLimitTick((n) => n + 1), 1000);
    return () => window.clearInterval(tick);
  }, [Object.keys(bag.rateLimitRetries).join(",")]);

  function clearRateLimitTimer(threadId?: string) {
    if (threadId) {
      const timer = bag.rateLimitTimersRef.current.get(threadId);
      if (timer != null) { window.clearTimeout(timer); bag.rateLimitTimersRef.current.delete(threadId); }
      return;
    }
    for (const timer of bag.rateLimitTimersRef.current.values()) window.clearTimeout(timer);
    bag.rateLimitTimersRef.current.clear();
  }
bag.clearRateLimitTimer = clearRateLimitTimer as typeof bag.clearRateLimitTimer;

  /** 登记/覆盖某会话的「重发内容」（发送成功时调用；限流失败时用它原地重发）。 */
  function armRateLimitRetry(threadId: string, ctx: RateLimitCtx) {
    if (!threadId) return;
    bag.retryContextsRef.current.set(threadId, ctx);
    bag.rateLimitAttemptsRef.current.set(threadId, 0);
  }
bag.armRateLimitRetry = armRateLimitRetry as typeof bag.armRateLimitRetry;

  /** 429 兜底：解析该会话的「重发内容」——**没有登记就现场恢复**。
   *  ⛔⛔ 09-19 用户截图实证（「429 重试机制都没有了？直接中止了？」）：
   *   登记原先只发生在**手动发送**路径（armRateLimitRetry）——而**排队释放的回合**
   *   （运行中发消息 → 回合结束自动启动 / 点「立即」/ 自动续接）以及**引擎侧的回合**
   *   （应用重启后继续跑的、渠道机器人发起的）从来没有登记 ⇒ 三个检测点的
   *   `retryContextsRef.has(threadId)` 全为假 ⇒ 429 时**连重试都不会排**，直接报错结束
   *   （用户操作模式正是「发出去就切走 / 多会话同时跑」，排队是最常走的路径）。
   *   这里做兜底：从**该回合自己的用户消息**现场重建原文（逐条 text part 原样取，
   *   不经显示层清洗），模型取该会话自己的记录、退当前生效模型。
   *   这样**任何路径**启动的回合都能被限流兜底接住（登记仍是首选，它更精确：带模型的
   *   effort/personality 与原始 input 结构）。 */
  function recoverRateLimitCtx(threadId: string, turn: any): RateLimitCtx | null {
    if (!threadId) return null;
    const sources: any[] = [turn];
    const cached = bag.threadCacheRef.current.get(threadId);
    if (cached) sources.push(cached.turns?.find((entry: any) => entry.id === String(turn?.id ?? "")));
    if (bag.threadRef.current?.id === threadId) {
      sources.push(bag.threadRef.current.turns?.find((entry) => entry.id === String(turn?.id ?? "")));
    }
    const collect = (full: any): any[] => {
      const input: any[] = [];
      for (const item of full?.items ?? []) {
        if (item?.type !== "userMessage") continue;
        for (const part of item.content ?? []) {
          if (part?.type === "text" && String(part.text ?? "").trim()) input.push({ type: "text", text: part.text });
        }
      }
      return input;
    };
    // 逐来源找「该回合自己的用户消息」：事件本体 → 缓存 → 当前视图（同一回合 id）。
    // ⛔ 不用「会话最后一条用户消息」这类启发式：它可能重发**早已成功完成**的旧消息
    //   （等于重复执行整个任务）——宁可报错也不发错内容。
    for (const full of sources) {
      const input = collect(full);
      if (input.length) {
        return {
          input,
          model: modelName(loadThreadModel(threadId)) || bag.activeModelRef.current || "",
          effort: null,
          personality: null,
        };
      }
    }
    // ③ 最终兜底：连「该回合自己的用户消息」都拿不到（引擎的失败回包常常只带产出条目；
    //   渲染层重载后 resume 回来的回合也可能缺）→ 退**该会话最后一条用户消息**。
    //   ⛔ 只在失败的正好是该会话**最新回合**时才用（那种情况下"最后一条用户消息"就是触发
    //   这个回合的输入）。失败的不是最新回合 ⇒ 后面还有更新的回合，重发旧输入会把已完成的
    //   活整个重跑 → 宁可报错。
    for (const full of sources) {
      const turns: any[] = full?.turns ?? [];
      if (!turns.length) continue;
      const last = turns[turns.length - 1];
      const turnId = String(turn?.id ?? "");
      if (turnId && last?.id !== turnId) continue;
      for (let i = turns.length - 1; i >= 0; i--) {
        const input = collect(turns[i]);
        if (input.length) {
          return {
            input,
            model: modelName(loadThreadModel(threadId)) || bag.activeModelRef.current || "",
            effort: null,
            personality: null,
          };
        }
      }
    }
    return null;   // 彻底拿不到原文就不重试（宁可报错也不乱发）
  }
bag.recoverRateLimitCtx = recoverRateLimitCtx as typeof bag.recoverRateLimitCtx;
  return { relayBusy, setRelayBusy, relayActive, setRelayActive, openaiActiveAcct, setOpenaiActiveAcct, skillInstall, setSkillInstall, skillRemove, setSkillRemove, connectorMenuOpen, setConnectorMenuOpen, connectors, setConnectors, connectorDraft, setConnectorDraft, connectorEditorOpen, setConnectorEditorOpen, connectorSaving, setConnectorSaving, connectorSecret, setConnectorSecret, connectorTemplates, setConnectorTemplates, connectorTemplateModal, setConnectorTemplateModal, connectorOAuth, setConnectorOAuth, connectorTemplateValues, setConnectorTemplateValues, connectorTemplateSaving, setConnectorTemplateSaving, memoryConfigOpen, setMemoryConfigOpen, contextOpen, setContextOpen, contextQuery, setContextQuery, contextItems, setContextItems, quoteItem, setQuoteItem, images, setImages, loading, setLoading, sending, setSending, sendInFlightRef, rateLimitRetries, setRateLimitRetries, upstreamRetries, setUpstreamRetries, setRetryEntry, retryContextsRef, rateLimitAttemptsRef, rateLimitTimersRef, retryGatesRef, effortFallbackRef, autoContinueLogRef, setRateLimitTick, clearRateLimitTimer, armRateLimitRetry, recoverRateLimitCtx };
}
