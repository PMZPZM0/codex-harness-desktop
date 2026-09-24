/**
 * usePart04c2 —— usePart04c 按序切分出的第 2 段（纯搬迁、零改写）。
 * 域：聊天搜索/文件树 · 内置浏览器/书签 · 队列调度 · 设置资源
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import "@xterm/xterm/css/xterm.css";
import { AUTO_CONTINUE_MAX_ATTEMPTS, AUTO_CONTINUE_WINDOW_MS, autoContinuePrompt, isTruncatedEmptyTurn, truncationNotice } from "../../../../../lib/turn-truncation.mjs";
import { imageToken, splitPromptSegments, promptImagePaths, stripImageTokens, isImagePart, imagePartSrc, normalizeImagePartForSend } from "../../../../../lib/prompt-images";
import { classifyUnit, buildSegments, buildOrderedToolRuns, foldItemStatus, computeFoldSummary, topToolGroup, isTurnRunning, normalizeLoadedThread, type FoldUnit } from "../../../../../lib/turn-fold";
import { QueueItem } from "../../../../../lib/queue-item";
import { isQueueAlreadyStartedError } from "../../../../../lib/queue-errors.mjs";
import { inputText } from "../../../../../lib/input-text";
import type { Bag } from "../../bag-types";

export function usePart04c2(bag: Bag) {
  function openBrowser() {
    const raw = bag.browserDraft.trim();
    if (!raw) return;
    // 地址栏通行做法：裸域名自动补 https://，含空格/明显不是网址的输入走搜索引擎
    const searchEngine = localStorage.getItem("browser-search-engine") || "https://www.bing.com/search?q=";
    const looksLikeUrl = /^https?:\/\//i.test(raw)
      ? true
      : !/\s/.test(raw) && (/^localhost(:\d+)?(\/\S*)?$/i.test(raw) || /^[a-z0-9][a-z0-9.-]*(\.[a-z]{2,})(:\d+)?(\/\S*)?$/i.test(raw) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/\S*)?$/.test(raw));
    let target: string;
    if (/^https?:\/\//i.test(raw)) {
      try {
        const parsed = new URL(raw);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") { bag.setNotice("仅支持 HTTP(S) 地址"); return; }
        target = parsed.toString();
      } catch (error: any) {
        bag.setNotice(`浏览器地址无效：${error.message}`);
        return;
      }
    } else if (looksLikeUrl) {
      target = new URL(`https://${raw}`).toString();
    } else {
      // 搜索词：交给默认搜索引擎（可见视图直接导航；指纹窗口同样打开搜索结果页）
      target = searchEngine + encodeURIComponent(raw);
    }
    if (bag.browserMode === "cloak") void bag.openInCloak(target);
    else bag.setBrowserUrl(target);
    // 记录历史（去重置顶，最多 60 条）
    bag.setBrowserHistory((current) => {
      const next = [{ url: target, title: (() => { try { return new URL(target).hostname; } catch { return target; } })(), at: Date.now() }, ...current.filter((entry) => entry.url !== target)].slice(0, 60);
      localStorage.setItem("browser-history", JSON.stringify(next));
      return next;
    });
  }
bag.openBrowser = openBrowser as typeof bag.openBrowser;

  function toggleBookmark() {
    const url = bag.browserDraft.trim();
    if (!url) return;
    bag.setBrowserBookmarks((current) => {
      const exists = current.some((entry) => entry.url === url);
      const next = exists ? current.filter((entry) => entry.url !== url) : [{ url, title: (() => { try { return new URL(url).hostname; } catch { return url; } })() }, ...current].slice(0, 30);
      localStorage.setItem("browser-bookmarks", JSON.stringify(next));
      return next;
    });
  }
bag.toggleBookmark = toggleBookmark as typeof bag.toggleBookmark;

  async function deleteQueued(id: string) {
    if (!bag.thread) return;
    try {
      await window.codex.request("thread/queue/delete", { threadId: bag.thread.id, queuedSubmissionId: id });
      bag.setQueue((current) => current.filter((entry) => entry.id !== id));
    } catch (error: any) {
      bag.setNotice(`删除排队消息失败：${error.message}`);
    }
  }
bag.deleteQueued = deleteQueued as typeof bag.deleteQueued;

  async function reorderQueued(from: number, to: number) {
    if (!bag.thread || from === to || to < 0 || to >= bag.queue.length) return;
    const next = [...bag.queue];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    bag.setQueue(next);
    try {
      await window.codex.request("thread/queue/reorder", { threadId: bag.thread.id, queuedSubmissionIds: next.map((entry) => entry.id) });
    } catch (error: any) {
      bag.setNotice(`调整队列顺序失败：${error.message}`);
      void bag.refreshQueue(bag.thread.id);
    }
  }
bag.reorderQueued = reorderQueued as typeof bag.reorderQueued;

  function editQueued(entry: QueueItem) {
    bag.setPrompt(inputText(entry.input));
    void bag.deleteQueued(entry.id);
  }
bag.editQueued = editQueued as typeof bag.editQueued;

  async function saveQueued(entry: QueueItem, text: string) {
    if (!bag.thread) return;
    const images = (entry.input ?? []).filter(isImagePart).map(normalizeImagePartForSend).filter(Boolean);
    const nextText = text.trim();
    try {
      await bag.deleteQueued(entry.id);
      const input = [
        ...(nextText || images.length ? [{ type: "text", text: nextText, text_elements: [] }] : []),
        ...images,
      ];
      if (input.length) await window.codex.request("thread/queue/add", { threadId: bag.thread.id, input, clientUserMessageId: crypto.randomUUID() });
      void bag.refreshQueue(bag.thread.id);
    } catch (error: any) {
      bag.setNotice(`保存排队消息失败：${error.message}`);
    }
  }
bag.saveQueued = saveQueued as typeof bag.saveQueued;

  /** 给「不是走正常发送、但会真的出现在会话里」的用户消息建立**钉顶意图**。
   *  ⛔ 为什么必须有（09-19 用户实测「钉顶也没有」，真机打点复现）：会话正在跑时用户发的消息
   *  走 `thread/queue/add`（发送函数里那条分支在「上钉」段之前就 return 了），随后由
   *  「回合结束自动启动」（见 turn/completed 处理）或「立即」把它变成真实回合 ——
   *  这两条路径原先都不建立钉顶意图，那条消息于是落进内容流里。
   *  钉顶的**唯一 owner 仍是 `pinSentMessage`**：这里只负责在「消息真正进入会话」那一刻
   *  把意图写上（语义等价于正常发送的 send-arm）。
   *  只对**当前正在看的会话**建立意图：看不见的会话不需要钉顶，给它设了反而会抢走视口。 */
  function armPinForReleasedQueue(threadId: string | null | undefined, why: string): boolean {
    if (!threadId || threadId !== bag.threadRef.current?.id) return false;
    const live = bag.threadRef.current;
    bag.optimisticBaselineRef.current = { threadId, turnIds: new Set((live?.turns ?? []).map((entry) => entry.id)) };
    bag.stickToBottomRef.current = false;
    bag.anchorTopRef.current = true;
    bag.anchorTurnIdRef.current = null;
    bag.pinGapLockedRef.current = null;   // 新一轮锚点不该继承上一条的"交棒"锁
    bag.dbg("queue-arm", { why });
    return true;
  }
bag.armPinForReleasedQueue = armPinForReleasedQueue as typeof bag.armPinForReleasedQueue;

  /** 释放失败时把刚建立的意图**撤回**（代码审查抓住的缺口）：否则这个"悬空的意图"会让钉顶去钉
   *  **别的**消息（列表里最后那个回合组的用户消息 / 乐观气泡），用户看到视口莫名跳到旧消息 ——
   *  比"没钉顶"更糟。只在「确实是本次 arm 的」前提下调用（`armPinForReleasedQueue` 的返回值），
   *  免得误撤掉用户正常发送时那条仍然有效的钉顶。 */
  function disarmPinIntent(why: string) {
    bag.anchorTopRef.current = false;
    bag.pinGapLockedRef.current = null;
    bag.clearAnchorPad();
    bag.dbg("queue-arm-cancelled", { why });
  }
bag.disarmPinIntent = disarmPinIntent as typeof bag.disarmPinIntent;

  /** 回合级「截断空转」的自动续接（09-19 用户实测「思考内容过长会被截断，运行状态就断了」）。
   *  机制：回合已 task_complete（引擎侧无 active turn，`turn/steer` 不可用——它的前置条件是
   *  "active turn id"，引擎自己也不做 finish_reason=length 的续写），承接只能落成**新回合**。
   *  所以：延迟等 turn/completed 收尾（mergeTurn / auto-start / markThreadStopped）跑完 →
   *  `thread/queue/add` 一条「从断点承接续写」指令 → `thread/queue/start` 启动。
   *  ⛔ 指令语义是**承接**（接着上次没写完的往下输出、不重新思考），不是"重新做一遍任务"。
   *  ⛔ 防死循环：同一会话 AUTO_CONTINUE_WINDOW_MS 内最多 AUTO_CONTINUE_MAX_ATTEMPTS 次；
   *     达到上限停手并提示换供应商（本地部署模型同样受单次输出上限约束）。 */
  function maybeAutoContinueTruncated(threadId: string) {
    const now = Date.now();
    const rec = bag.autoContinueLogRef.current.get(threadId);
    if (!rec || now - rec.firstAt > AUTO_CONTINUE_WINDOW_MS) {
      bag.autoContinueLogRef.current.set(threadId, { count: 1, firstAt: now });
    } else {
      if (rec.count >= AUTO_CONTINUE_MAX_ATTEMPTS) {
        bag.showToast("多次被截断", "已自动续接达到上限，建议更换支持更大单次输出的供应商/模型。", threadId);
        return;
      }
      rec.count++;
    }
    window.setTimeout(() => {
      if (bag.threadRef.current?.id !== threadId) return; // 用户已切走：不再自动动那个会话
      // ⛔ 二次防误判（判据已收紧为"严格零产出"，这里是最后一道闸）：延迟期间若该会话已经
      //   有回合在跑（用户手动续了 / 引擎自己恢复 / 队列已启动），就放弃自动续接——
      //   绝不让"正常收尾"因为误判而多出一个应用自己发的回合（那才是真正的空转）。
      if (bag.runningThreadIdsRef.current.has(threadId)) return;
      const liveTurn = (bag.threadRef.current?.turns ?? []).find((entry) => isTurnRunning(entry));
      if (liveTurn) return;
      void window.codex.request("thread/queue/add", {
        threadId,
        input: [{ type: "text", text: autoContinuePrompt() }],
        clientUserMessageId: crypto.randomUUID(),
      }).then(async () => {
        bag.showToast("已自动续接", "检测到被供应商截断，正在从断点继续输出…");
        const list = await window.codex.request("thread/queue/list", { threadId, limit: 1 }).catch(() => null);
        const head = list?.data?.[0];
        if (head) {
          const armedForCont = bag.armPinForReleasedQueue(threadId, "auto-continue");
          // 429 兜底也要覆盖这条续接回合（续接场景正是上游不稳的高发区）
          bag.armRetryForQueueRelease(threadId, head.input ?? [{ type: "text", text: autoContinuePrompt() }]);
          try {
            await window.codex.request("thread/queue/start", { threadId, queuedSubmissionId: head.id });
          } catch (error: any) {
            const message = String(error?.message ?? error);
            // ⛔ 引擎已自行启动这条（上一回合结束后约 9ms 就发 queue/changed 并清空队列）⇒
            //   「找不到 / 队列空」是**伪失败**：续接其实正在发生，别撤意图、别报错。
            //   成因与判据见 lib/queue-errors.mjs（用户 09-24 截图反馈的正是这一类噪声）。
            if (isQueueAlreadyStartedError(message)) {
              bag.dbg("auto-continue-raced-by-engine", { threadId, message });
            } else {
              // 启动失败 ⇒ 那条续接不会出现：撤回钉顶意图（否则去钉列表里别的消息），并告知
              if (armedForCont) bag.disarmPinIntent("auto-continue-fail");
              bag.showToast("自动续接失败", message);
            }
          }
        }
      }).catch((error: any) => bag.showToast("自动续接失败", String(error?.message ?? error)));
    }, 2500);
  }
bag.maybeAutoContinueTruncated = maybeAutoContinueTruncated as typeof bag.maybeAutoContinueTruncated;

  async function startQueued(id?: string) {
    if (!bag.thread) return;
    const entry = id ? bag.queue.find((q) => q.id === id) : undefined;
    // 「立即」= 把这条消息交给引擎插进当前回合（`turn/steer`，**不打断**当前任务）。
    // 定案（用户 09-13）：「恢复成原来那种，排队消息点立即发出去后，弹窗提醒」——
    // 所以这里**不再**尝试在聊天区把它当普通消息展示（那套实验引入了回归，已撤）：
    // 消息由引擎插进正在跑的回合流里，界面按引擎回推的 item 正常渲染；
    // 用户消息不会被折叠进过程组（见 src/lib/turn-fold-plan.mjs 的 isAnchor 第 ① 条）。
    //
    // ⛔ 09-17 修复「插队消息每次都报错」（用户实测；引擎原文 = `no active turn to steer`）：
    //   原实现只认 `activeTurnId`（应用侧状态）。但上一轮 **429 限流失败 / 被中断 / 已跑完** 之后，
    //   它仍可能是**上一回合的旧值**，而引擎那边早已没有活动回合 → steer 必然失败，且失败后
    //   只弹一句报错、消息还留在队列里，用户重试多少次都一样。
    //   现在两层防：
    //   ① 先按「**真的有回合在跑**」判断（`isTurnRunning`），activeTurnId 命中运行中回合才用它；
    //   ② 引擎仍回 `no active turn` 时**退化为开始新回合**（下面 `thread/queue/start`），
    //      并清掉应用侧的陈旧运行态，而不是把消息卡死在队列里。
    const runningTurnId = (bag.thread.turns ?? []).find((turn) => isTurnRunning(turn))?.id ?? null;
    const steerTurnId = bag.activeTurnId && bag.activeTurnId === runningTurnId ? bag.activeTurnId : runningTurnId;
    if (steerTurnId && entry) {
      // 「立即」= 这条消息马上会作为用户消息出现在当前回合里 → 先建立钉顶意图（否则它落进内容流）
      const armedForSteer = bag.armPinForReleasedQueue(bag.thread.id, "steer");
      // 这条消息会并入当前回合；若该回合以 429 结束，重发的就是它（同手动发送的语义）
      bag.armRetryForQueueRelease(bag.thread.id, entry.input);
      try {
        await window.codex.request("turn/steer", {
          threadId: bag.thread.id,
          expectedTurnId: steerTurnId,
          input: entry.input,
          ...(entry.clientUserMessageId ? { clientUserMessageId: entry.clientUserMessageId } : {}),
        });
        await bag.deleteQueued(entry.id);
        void bag.refreshQueue(bag.thread.id);
        bag.showToast("已发送", "这条排队消息已并入当前任务");
        return;
      } catch (error: any) {
        const message = String(error?.message ?? error ?? "");
        if (!/no active turn/i.test(message)) {
          if (armedForSteer) bag.disarmPinIntent("steer-fail");   // 意图悬空会去钉别的消息
          bag.showToast("发送失败", message);
          return;
        }
        // 陈旧运行态：清掉后按「新回合」发出去（不再卡在队列里）
        bag.markThreadStopped(bag.thread.id);
        bag.setActiveTurnId(null);
        bag.dbg("steer-stale-fallback", {});
      }
    }
    const armedForStart = bag.armPinForReleasedQueue(bag.thread.id, "queue-start");
    // 「立即」启动的回合同样要被 429 兜底覆盖（用排队条目自己的 input）
    bag.armRetryForQueueRelease(bag.thread.id, entry?.input);
    try {
      // 它会作为**新回合**的用户消息出现 → 同样要先建立钉顶意图
      await window.codex.request("thread/queue/start", { threadId: bag.thread.id, ...(id ? { queuedSubmissionId: id } : {}) });
      // 同「回合结束自动启动」：先本地摘掉，避免与真实气泡并存（否则会短暂重复展示）
      if (id) bag.setQueue((current) => current.filter((entry) => entry.id !== id));
      void bag.refreshQueue(bag.thread.id);
      bag.showToast("已发送", "排队消息已开始执行");
    } catch (error: any) {
      const message = String(error?.message ?? error);
      // ⛔「立即」与引擎自动启动撞车：消息其实**已经发出去了**（用户 09-24 反馈「排队消息出去，
      //   正常的，为啥报这个错」）⇒ 按成功处理：**保留**钉顶意图（消息确实要出现），只留一行 dbg。
      if (isQueueAlreadyStartedError(message)) {
        bag.dbg("queue-start-raced-by-engine", { threadId: bag.thread.id, message });
      } else {
        if (armedForStart) bag.disarmPinIntent("queue-start-fail");
        bag.showToast("发送失败", message);
      }
    }
  }
bag.startQueued = startQueued as typeof bag.startQueued;

  async function refreshSettingsResources(opts: { mcpDetail?: boolean } = {}) {
    bag.setResourceLoading(true);
    bag.setResourceError("");
    const cwd = bag.workspace ? [bag.workspace] : [];
    const failures: string[] = [];
    // mcpDetail=true 才做 toolsAndAuthOnly 全量枚举（会拉起全部 MCP 服务）；
    // 已加载过详情的会话内后续刷新沿用，避免其他分区操作把 MCP 状态刷丢
    const wantMcpDetail = opts.mcpDetail === true || bag.mcpDetailLoadedRef.current;
    if (opts.mcpDetail === true) bag.mcpDetailLoadedRef.current = true;
    // 每项独立容错：某个接口不被当前 Codex 版本支持时，不能拖垮整批数据
    const safe = async (label: string, run: () => Promise<any>, fallback: any) => {
      try { return await run(); } catch (error: any) {
        let msg = String(error.message ?? error);
        // Cloudflare 挑战页/超长 HTML 不要甩到界面上，降级成一句人话
        if (/<html|__cf_chl|challenge/i.test(msg)) msg = "请求被 Cloudflare 人机验证拦截（该项需要可直连 OpenAI 的网络或代理）";
        else if (msg.length > 160) msg = msg.slice(0, 160) + "…";
        failures.push(`${label}（${msg}）`);
        return fallback;
      }
    };
    const [skillsResult, hooksResult, pluginsResult, memoryResult, taskResult, mcpResult] = await Promise.all([
      safe("技能", () => window.codex.request("skills/list", { cwds: cwd, forceReload: false }), { data: [] }),
      safe("钩子", () => window.codex.request("hooks/list", { cwds: cwd }), { data: [] }),
      // 不要用 forceRefetch：它会去远端重新拉取 marketplace（Codex 自带 git 不走系统代理，会卡到超时）；
      // 实测本地 config.toml 的改动在普通列表里就能立刻反映。
      safe("插件", () => window.codex.request("plugin/list", { cwds: cwd, forceRefetch: false }), { marketplaces: [] }),
      safe("记忆", () => window.codex.listMemory(), []),
      safe("定时任务", () => window.codex.listScheduledTasks(), []),
      wantMcpDetail
        ? safe("MCP", () => window.codex.request("mcpServerStatus/list", { detail: "toolsAndAuthOnly", ...(bag.threadRef.current?.id ? { threadId: bag.threadRef.current.id } : {}) }), { data: [] })
        : Promise.resolve({ data: bag.settingsResources.mcp }),
    ]);
    bag.setSettingsResources({
      skills: (skillsResult.data ?? []).flatMap((entry: any) => entry.skills ?? []),
      // hooks/list 的 data 是按 cwd 分组的数组（[{ cwd, hooks: [...] }]），必须摊平，
      // 否则渲染层拿到的是分组对象，页面上只会渲染出空白卡片（ponytail 的钩子就是这样“消失”的）。
      hooks: (hooksResult.data ?? []).flatMap((entry: any) => entry.hooks ?? []),
      plugins: (pluginsResult.marketplaces ?? [])
        // 官方精选市场（openai-api-curated）需 ChatGPT 账号登录才能装，API Key 方式装不了；
        // 与其显示一堆点不动的「虚假卡片」，直接不展示，用户需要的插件走「开发工具」随包内置。
        .filter((marketplace: any) => marketplace.name !== "openai-api-curated")
        .flatMap((marketplace: any) => (marketplace.plugins ?? []).map((plugin: any) => ({ ...plugin, marketplaceName: marketplace.name, marketplacePath: marketplace.path }))),
      mcp: mcpResult.data ?? [],
    });
    bag.setMemories(memoryResult ?? []);
    bag.setScheduledTasks(taskResult ?? []);
    // 引擎直管 MCP 的启停覆盖表，跟着每次刷新一起回读，保证卡片开关显示的是真实状态
    bag.setMcpOverrides(await window.codex.readMcpServerOverrides().catch(() => ({}) as Record<string, boolean>));
    // 各 MCP 服务器的按工具权限档位，同样每次刷新回读
    bag.setMcpToolPermissions(await window.codex.readMcpToolPermissions().catch(() => ({})));
    bag.setResourceError(failures.length ? `以下数据读取失败：${failures.join("、")}` : "");
    bag.setResourceLoading(false);
  }
bag.refreshSettingsResources = refreshSettingsResources as typeof bag.refreshSettingsResources;

  async function trustAllHooks() {
    bag.setHookTrusting(true);
    try {
      const result = await window.codex.trustHooks(bag.workspace ? [bag.workspace] : []);
      if (result.failures?.length) bag.setNotice(`部分钩子信任失败：${result.failures.join("；")}`);
      else bag.setNotice(result.trusted ? `已信任 ${result.trusted} 个钩子，下一轮任务开始执行` : `${result.total} 个钩子都已处于信任状态`);
      await bag.refreshSettingsResources();
    } catch (error: any) { bag.setNotice(`信任钩子失败：${error.message}`); }
    finally { bag.setHookTrusting(false); }
  }
bag.trustAllHooks = trustAllHooks as typeof bag.trustAllHooks;

  /** 单条钩子启停：只改这一条，不动插件本体 */
  async function setHookEnabled(hook: any, enabled: boolean) {
    const key = String(hook.key ?? "");
    if (!key) return;
    bag.setHookBusy(key);
    try {
      const result = await window.codex.setHookEnabled({ hookKeys: [key], enabled });
      if (result.failures?.length) throw new Error(result.failures.join("；"));
      await bag.refreshSettingsResources();
      bag.setNotice(`钩子「${hook.eventName ?? key}」已${enabled ? "启用" : "停用"}`);
    } catch (error: any) { bag.setNotice(`钩子${enabled ? "启用" : "停用"}失败：${error.message}`); }
    finally { bag.setHookBusy(null); }
  }
bag.setHookEnabled = setHookEnabled as typeof bag.setHookEnabled;

  /**
   * 联动开关：把插件、它提供的全部钩子、它提供的全部技能一次性对齐。
   * 停用时三者一起停；启用时三者一起起，避免出现「插件开着但钩子是灰的」这种自相矛盾的状态。
   */
  async function setLinkedEnabled(pluginId: string, enabled: boolean, label: string) {
    bag.setLinkedBusy(pluginId);
    try {
      const result = await window.codex.setPluginLinkedEnabled({ pluginId, enabled });
      await Promise.all([bag.refreshSettingsResources(), window.codex.listLocalSkills().then(bag.setLocalSkills)]);
      if (result.failures?.length) bag.setNotice(`${label}：部分联动失败 —— ${result.failures.join("；")}`);
      else bag.setNotice(`已${enabled ? "启用" : "停用"}「${label}」，并同步其钩子与关联技能`);
    } catch (error: any) { bag.setNotice(`联动${enabled ? "启用" : "停用"}失败：${error.message}`); }
    finally { bag.setLinkedBusy(null); }
  }
bag.setLinkedEnabled = setLinkedEnabled as typeof bag.setLinkedEnabled;
  return { openBrowser, toggleBookmark, deleteQueued, reorderQueued, editQueued, saveQueued, armPinForReleasedQueue, disarmPinIntent, maybeAutoContinueTruncated, startQueued, refreshSettingsResources, trustAllHooks, setHookEnabled, setLinkedEnabled };
}
