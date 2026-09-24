/**
 * usePart03a1 —— usePart03a 按序切分出的第 1 段（纯搬迁、零改写）。
 * 域：机器人/远程通道 · 钉顶几何与滚动锚
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import type { RateLimitCtx, BotEntry } from "../../types";
import type { Bag } from "../../bag-types";

export function usePart03a1(bag: Bag) {
  useEffect(() => {
    let alive = true;
    void window.codex.botsGet?.().then(async (persisted) => {
      if (!alive) return;
      let legacy: BotEntry[] = [];
      try { legacy = JSON.parse(localStorage.getItem("bots") ?? "[]"); } catch { legacy = []; }
      if (Array.isArray(persisted) && persisted.length) {
        bag.setBots(persisted);
      } else if (legacy.length) {
        // 迁移：主进程为空 + localStorage 有旧档案 → 上交（localStorage 保留一份作备份，不再作为真相源）
        bag.setBots(legacy);
        void window.codex.botsSet?.(legacy).catch(() => undefined);
      } else {
        // 档案与旧数据都为空：从持久化的渠道登录态**自动恢复**机器人卡片。
        // 微信登录凭据/配对/绑定都在主进程，唯独卡片记录丢了会让"已连接的机器人"
        // 在面板里隐身（09-13 用户反馈「已连接机器人没显示出来」）——已连接的渠道必须可见。
        const status: Record<string, boolean | undefined> = await (window.codex.channelsStatus?.() ?? Promise.resolve({}));
        const names: Record<string, string> = { wechat: "微信机器人", telegram: "Telegram 机器人", feishu: "飞书机器人", dingtalk: "钉钉机器人", qq: "QQ 机器人", "wecom-webhook": "企微推送" };
        const restored: BotEntry[] = Object.entries(status)
          .filter(([, on]) => Boolean(on))
          .map(([ch]) => {
            const channel = ch === "weixin" ? "wechat" : ch;
            return { id: `restored-${ch}-${Date.now().toString(36)}`, name: names[channel] ?? `${channel} 机器人`, channel, enabled: true };
          });
        if (restored.length) {
          bag.setBots(restored);
          void window.codex.botsSet?.(restored).catch(() => undefined);
        }
      }
    }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  // 打开机器人管理弹窗默认选中已配置的机器人（优先已启用的），不再显示空详情页
  useEffect(() => {
    if (!bag.botManagerOpen) return;
    if (bag.bots.some((b) => b.id === bag.activeBotId)) return;
    const first = bag.bots.find((b) => b.enabled) ?? bag.bots[0];
    if (first) { bag.setActiveBotId(first.id); bag.setBotChannelPick(null); }
  }, [bag.botManagerOpen, bag.bots, bag.activeBotId]);

  useEffect(() => {
    if (!bag.botManagerOpen) return;
    void window.codex.botBindingGet?.().then(bag.setBotBindings).catch(() => undefined);
    const off = window.codex.onBotBindingChanged?.((bindings) => bag.setBotBindings({ wechat: (bindings as any)?.wechat ?? null, telegram: (bindings as any)?.telegram ?? null }));
    return () => { off?.(); };
  }, [bag.botManagerOpen]);

  const [botChannelPick, setBotChannelPick] = useState<string | null>(null);
bag.botChannelPick = botChannelPick as typeof bag.botChannelPick; bag.setBotChannelPick = setBotChannelPick as typeof bag.setBotChannelPick;

  const [botQr, setBotQr] = useState("");
bag.botQr = botQr as typeof bag.botQr; bag.setBotQr = setBotQr as typeof bag.setBotQr;

  const [remoteUrl, setRemoteUrl] = useState("");
bag.remoteUrl = remoteUrl as typeof bag.remoteUrl; bag.setRemoteUrl = setRemoteUrl as typeof bag.setRemoteUrl;

  const [remoteDevices, setRemoteDevices] = useState<any[]>([]);
bag.remoteDevices = remoteDevices as typeof bag.remoteDevices; bag.setRemoteDevices = setRemoteDevices as typeof bag.setRemoteDevices;

  const [remoteStatus, setRemoteStatus] = useState("idle");
bag.remoteStatus = remoteStatus as typeof bag.remoteStatus; bag.setRemoteStatus = setRemoteStatus as typeof bag.setRemoteStatus;

  void bag.remoteStatus;

 /* WIP: 用户远控状态尚未接线，先占位防 noUnusedLocals */
  const [remoteCmd, setRemoteCmd] = useState("");
bag.remoteCmd = remoteCmd as typeof bag.remoteCmd; bag.setRemoteCmd = setRemoteCmd as typeof bag.setRemoteCmd;

  const [remoteLog, setRemoteLog] = useState<string[]>([]);
bag.remoteLog = remoteLog as typeof bag.remoteLog; bag.setRemoteLog = setRemoteLog as typeof bag.setRemoteLog;

  void bag.remoteDevices;

 void bag.remoteCmd;

 void bag.remoteLog;

 void bag.setRemoteCmd;

 void bag.setRemoteLog;

 /* WIP: 用户远控面板尚未接线，先占位防 noUnusedLocals */
  const [remoteQr, setRemoteQr] = useState("");
bag.remoteQr = remoteQr as typeof bag.remoteQr; bag.setRemoteQr = setRemoteQr as typeof bag.setRemoteQr;

  // 配对码 + 电脑端审批（09-13 二次加固：手机首次连接要过这两关）
  const [pairCode, setPairCode] = useState("");
bag.pairCode = pairCode as typeof bag.pairCode; bag.setPairCode = setPairCode as typeof bag.setPairCode;

  const [pairPending, setPairPending] = useState<any[]>([]);
bag.pairPending = pairPending as typeof bag.pairPending; bag.setPairPending = setPairPending as typeof bag.setPairPending;

  const [pairApproved, setPairApproved] = useState<any[]>([]);
bag.pairApproved = pairApproved as typeof bag.pairApproved; bag.setPairApproved = setPairApproved as typeof bag.setPairApproved;

  // 统一拉取配对状态（手机远控 + Bot Channel 两个真相源）：approved 取并集、pending 按 rid 去重。
  // 旧实现只拉 remotePairState —— Bot Channel（微信等）批准的设备存在 bot-pairing.json，
  // 打开面板时看不到，直到下一次配对事件触发合并才冒出来（09-13 用户反馈「批准过不常驻展示」）。
  const loadPairStates = useCallback(async () => {
    try {
      const [remote, bot] = await Promise.all([
        window.codex.remotePairState?.() ?? Promise.resolve(null),
        window.codex.botPairState?.() ?? Promise.resolve(null),
      ]);
      if (remote) { bag.setPairCode(remote.code); bag.setPairPending(remote.pending ?? []); }
      const remoteApproved: any[] = remote?.approved ?? [];
      const botApproved: any[] = (bot?.approved ?? [])
        .map((a: any) => ({ deviceId: String(a.key ?? ""), name: String(a.name ?? ""), approvedAt: Number(a.approvedAt ?? 0), source: "bot" }))
        .filter((d: any) => d.deviceId);
      bag.setPairPending((prev) => {
        const merged: any[] = [...(remote?.pending ?? [])];
        const seen = new Set(merged.map((m) => m.rid));
        for (const r of prev) if (!seen.has(r.rid)) { merged.push(r); seen.add(r.rid); }
        for (const b of (bot?.pending ?? []).map((r: any) => ({ rid: r.rid, name: r.name, createdAt: r.createdAt }))) {
          if (!seen.has(b.rid)) { merged.push(b); seen.add(b.rid); }
        }
        return merged;
      });
      bag.setPairApproved([...remoteApproved, ...botApproved.filter((b: any) => !remoteApproved.some((r: any) => r.deviceId === b.deviceId))]);
    } catch { /* 拉取失败保持现状 */ }
  }, []);
bag.loadPairStates = loadPairStates as typeof bag.loadPairStates;

  // 机器人管理面板打开时拉一次配对状态（6 位码 + 待审批 + 已批准）——配对卡就显示在面板里
  useEffect(() => {
    if (!bag.botManagerOpen) return;
    void bag.loadPairStates();
  }, [bag.botManagerOpen, bag.loadPairStates]);

  const [userDataPath, setUserDataPath] = useState("");
bag.userDataPath = userDataPath as typeof bag.userDataPath; bag.setUserDataPath = setUserDataPath as typeof bag.setUserDataPath;

  const [taskMenuOpen, setTaskMenuOpen] = useState(false);
bag.taskMenuOpen = taskMenuOpen as typeof bag.taskMenuOpen; bag.setTaskMenuOpen = setTaskMenuOpen as typeof bag.setTaskMenuOpen;

  const [renameDraft, setRenameDraft] = useState("");
bag.renameDraft = renameDraft as typeof bag.renameDraft; bag.setRenameDraft = setRenameDraft as typeof bag.setRenameDraft;

  const [inlineRename, setInlineRename] = useState(false);
bag.inlineRename = inlineRename as typeof bag.inlineRename; bag.setInlineRename = setInlineRename as typeof bag.setInlineRename;

  const inlineRenameRef = useRef<HTMLInputElement>(null);
bag.inlineRenameRef = inlineRenameRef as typeof bag.inlineRenameRef;

  const [interruptedTurns, setInterruptedTurns] = useState<Record<string, number>>({});
bag.interruptedTurns = interruptedTurns as typeof bag.interruptedTurns; bag.setInterruptedTurns = setInterruptedTurns as typeof bag.setInterruptedTurns;

  const [stoppedElapsed, setStoppedElapsed] = useState<Record<string, number>>({});
bag.stoppedElapsed = stoppedElapsed as typeof bag.stoppedElapsed; bag.setStoppedElapsed = setStoppedElapsed as typeof bag.setStoppedElapsed;

  const closeTaskMenu = () => bag.setTaskMenuOpen(false);
bag.closeTaskMenu = closeTaskMenu as typeof bag.closeTaskMenu;

  const [awayFromBottom, setAwayFromBottom] = useState(false);
bag.awayFromBottom = awayFromBottom as typeof bag.awayFromBottom; bag.setAwayFromBottom = setAwayFromBottom as typeof bag.setAwayFromBottom;

  // 流式跟随：用户滚到底时为 true（持续自动跟 agent 最新内容），向上滚看历史时为 false
  const stickToBottomRef = useRef(true);
bag.stickToBottomRef = stickToBottomRef as typeof bag.stickToBottomRef;

  // ── 发送锚顶（对齐 WorkBuddy，09-12 用户反馈「正文出字上下跳动/来回闪」）──
  // **每次**发送都把新消息钉在对话区顶部：回复向下方的空白处流式展开，视口
  // 全程稳定（用户明确要求「每次发新消息都要在那个位置」）。不自动转贴底——
  // 旧贴底跟随每字推屏+占位头塌陷猛坠 = 跳动，smooth 动画与内容增长互相
  // retarget = 闪烁。长回复超屏后由「回到底部」按钮 / 用户滚到底（dist≤4
  // 重开跟随并解除钉顶）接管；向上滚动随时解除钉顶自由翻阅。
  const anchorTopRef = useRef(false);
bag.anchorTopRef = anchorTopRef as typeof bag.anchorTopRef;

  // TEMP-DEBUG2
  if (!(window as any).__adbg) (window as any).__adbg = [];

  /** 诊断打点：只保留最近 2000 条。揭示动画是每帧 push 的（≈60 条/秒），无上限的话
   *  长时间跑长回复能累积到几十 MB 且被 window 强引用无法回收（09-13 性能审计）。 */
  const dbg = (r: string, extra: any = {}) => { try { const log = (window as any).__adbg; log.push({ r, t: Date.now() % 100000, ...extra }); if (log.length > 2000) log.splice(0, log.length - 2000); } catch {} };
bag.dbg = dbg as typeof bag.dbg;

  /** 程序滚动抑制窗：钉顶/贴底的瞬时滚动会把 scrollTop 拨来拨去，scroll 事件
      异步到达时若被 update() 当成用户滚动做方向判定，就会误解除钉顶（实测：
      钉顶 1ms 后被 cancel:up-scroll 杀掉）。程序滚动后 80ms 内的 scroll 事件
      只刷新基线、不做判定。 */
  const selfScrollUntilRef = useRef(0);
bag.selfScrollUntilRef = selfScrollUntilRef as typeof bag.selfScrollUntilRef;

  /** 锚元素（乐观气泡或确认后的真实回合），流式跟随钉顶时实时取坐标用 */
  const anchorElRef = useRef<HTMLElement | null>(null);
bag.anchorElRef = anchorElRef as typeof bag.anchorElRef;

  /** 确认后的真实回合 id：钉顶时动态按 id 查元素——回合元素可能比确认信号晚一帧挂载，
      一次性换锚会错过它（实测钉到已卸载的乐观气泡坐标上，gap -506） */
  const anchorTurnIdRef = useRef<string | null>(null);
bag.anchorTurnIdRef = anchorTurnIdRef as typeof bag.anchorTurnIdRef;

  /** 锚元素的内容坐标兜底值（锚元素已卸载时用） */
  const contentAnchorTopRef = useRef(0);
bag.contentAnchorTopRef = contentAnchorTopRef as typeof bag.contentAnchorTopRef;

  /** 锚点顶端**未减去偏移**的内容坐标：用来判断内容是否已长过一屏。
      超出「锚点顶端 + 视口高」就说明回复已经被推到屏幕外，必须交回跟随，
      否则视口钉在原地、正文一路流出屏幕（用户实测：大片空白、看不到最新内容）。 */
  const anchorTopOffsetRef = useRef(0);
bag.anchorTopOffsetRef = anchorTopOffsetRef as typeof bag.anchorTopOffsetRef;

  /** 钉顶时的内容高度基线：回复每长出一段，就按**增长量**把视口往下推同样多，
      既保证新内容始终可见（用户要的自动跟随），又不会像旧版那样每个字重推整屏
      （那正是「出字上下跳动」的来源）。 */
  const anchorHeightBaselineRef = useRef(0);
bag.anchorHeightBaselineRef = anchorHeightBaselineRef as typeof bag.anchorHeightBaselineRef;

  /** 锚顶专用底部留白：把「锚点下方」补足到一整屏，让短消息也能钉到顶部。
      几何原因（09-12 实测探针实锤）：视口高 622px、短消息只有 72px，若下方没有
      内容顶着，scrollTop 会被浏览器钳在 maxScroll → 消息停在视口中间，随后被贴底
      接管（away=0）。第一条长消息能成，正是因为它自己就撑满了一屏。
      高度必须随锚点高度自适应（= clientHeight - 锚高），否则大留白会把下一个
      新消息的坐标一起撑大（实测 want 因此比 maxScroll 还大）。 */
  const anchorSpacerRef = useRef<HTMLDivElement | null>(null);
bag.anchorSpacerRef = anchorSpacerRef as typeof bag.anchorSpacerRef;

  /** 已下发过的留白高度（px）。`null` = 当前没有锚定留白。
   *  收缩必须是**单向的**（只减不增）：内容只会越来越长，留白只需越来越小；
   *  若允许回增，就会变成新的 scrollHeight 突变源（与闪烁同类问题）。
   *  （锚点元素复用上方既有的 `anchorElRef`，它已经会跟到确认后的真实回合。） */
  const anchorPadAppliedRef = useRef<number | null>(null);
bag.anchorPadAppliedRef = anchorPadAppliedRef as typeof bag.anchorPadAppliedRef;
  return { botChannelPick, setBotChannelPick, botQr, setBotQr, remoteUrl, setRemoteUrl, remoteDevices, setRemoteDevices, remoteStatus, setRemoteStatus, remoteCmd, setRemoteCmd, remoteLog, setRemoteLog, remoteQr, setRemoteQr, pairCode, setPairCode, pairPending, setPairPending, pairApproved, setPairApproved, loadPairStates, userDataPath, setUserDataPath, taskMenuOpen, setTaskMenuOpen, renameDraft, setRenameDraft, inlineRename, setInlineRename, inlineRenameRef, interruptedTurns, setInterruptedTurns, stoppedElapsed, setStoppedElapsed, closeTaskMenu, awayFromBottom, setAwayFromBottom, stickToBottomRef, anchorTopRef, dbg, selfScrollUntilRef, anchorElRef, anchorTurnIdRef, contentAnchorTopRef, anchorTopOffsetRef, anchorHeightBaselineRef, anchorSpacerRef, anchorPadAppliedRef };
}
