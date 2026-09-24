/**
 * usePart02d2 —— usePart02d 按序切分出的第 2 段（纯搬迁、零改写）。
 * 域：开发运行时与能力快照 · 命令/钩子/项目账户
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import { setUserIdentity, type UserAvatarSpec } from "../../../../../lib/user-identity.mjs";
import { readStoredCodexAvatar, storeCodexAvatar, setCodexIdentity, getCodexIdentity, subscribeCodexIdentity, CODEX_DEFAULT_NAME, type CodexAvatarSpec } from "../../../../../lib/codex-identity.mjs";
import type { RateLimitCtx, BotEntry } from "../../types";
import type { Bag } from "../../bag-types";

export function usePart02d2(bag: Bag) {
  // 保存命令（新建或更新）后刷新列表
  async function persistCommand() {
    if (!bag.commandEditor) return;
    const draft = bag.commandEditor;
    const name = draft.name.trim();
    if (!name) { bag.setNotice("命令名不能为空"); return; }
    if (bag.commandBusyKey) return;
    bag.setCommandBusyKey("save");
    try {
      await window.codex.saveCommand({
        name,
        source: draft.source,
        description: draft.description,
        argumentHint: draft.argumentHint,
        allowedTools: draft.allowedTools,
        model: draft.model,
        body: draft.body,
        prevFilePath: draft.mode === "edit" ? draft.prevFilePath : undefined,
        cwd: bag.workspace ?? undefined,
      });
      bag.setCommandEditor(null);
      bag.setNotice(draft.mode === "edit" ? `命令 /${name} 已更新` : `命令 /${name} 已创建`);
      await bag.refreshCommands();
    } catch (error: any) {
      bag.setNotice(error.message);
    } finally {
      bag.setCommandBusyKey(null);
    }
  }
bag.persistCommand = persistCommand as typeof bag.persistCommand;


  async function confirmDeleteCommand() {
    if (!bag.commandDelete) return;
    bag.setCommandBusyKey("delete");
    try {
      await window.codex.deleteCommand(bag.commandDelete.filePath);
      bag.setCommandDelete(null);
      bag.setNotice(`命令 /${bag.commandDelete.name} 已删除`);
      await bag.refreshCommands();
    } catch (error: any) {
      bag.setNotice(`删除失败：${error.message}`);
    } finally {
      bag.setCommandBusyKey(null);
    }
  }
bag.confirmDeleteCommand = confirmDeleteCommand as typeof bag.confirmDeleteCommand;


  /** 从输入框使用命令：内置 / 自定义都填 /name 进入输入框；技能则直接引用 */
  function useCommand(name: string, kind: "builtin" | "custom" | "skill", skill?: any) {
    if (kind === "skill" && skill) {
      bag.setSelectedSkills((current) => current.some((entry: any) => entry.name === skill.name) ? current : [...current, skill]);
      bag.setSettingsOpen(false);
      bag.setNotice(`已引用技能：${skill.name}`);
      return;
    }
    bag.setPrompt(`/${name} `);
    bag.setSettingsOpen(false);
  }
bag.useCommand = useCommand as typeof bag.useCommand;


  const [hookTrusting, setHookTrusting] = useState(false);
bag.hookTrusting = hookTrusting as typeof bag.hookTrusting; bag.setHookTrusting = setHookTrusting as typeof bag.setHookTrusting;


  const [hookBusy, setHookBusy] = useState<string | null>(null);
bag.hookBusy = hookBusy as typeof bag.hookBusy; bag.setHookBusy = setHookBusy as typeof bag.setHookBusy;


  const [linkedBusy, setLinkedBusy] = useState<string | null>(null);
bag.linkedBusy = linkedBusy as typeof bag.linkedBusy; bag.setLinkedBusy = setLinkedBusy as typeof bag.setLinkedBusy;


  const [projectFilter, setProjectFilter] = useState<string | null>(null);
bag.projectFilter = projectFilter as typeof bag.projectFilter; bag.setProjectFilter = setProjectFilter as typeof bag.setProjectFilter;


  const [username, setUsername] = useState(() => localStorage.getItem("username") || "Codex 用户");
bag.username = username as typeof bag.username; bag.setUsername = setUsername as typeof bag.setUsername;


  const [userAvatar, setUserAvatar] = useState<UserAvatarSpec | null>(() => { try { const p = JSON.parse(localStorage.getItem("user-profile") || "{}"); return p.avatarType && p.avatar ? { type: p.avatarType, value: p.avatar } : null; } catch { return null; } });
bag.userAvatar = userAvatar as typeof bag.userAvatar; bag.setUserAvatar = setUserAvatar as typeof bag.setUserAvatar;


  // 用户名权威源是个性化 nickname（存 userData/personalization.json，重启不丢）：
  // 启动时异步回读并覆盖 localStorage 缓存（localStorage 在应用退出瞬间可能没 flush，导致"重启恢复默认"）。
  useEffect(() => {
    void window.codex.readPersonalization().then((cfg) => {
      if (cfg?.nickname) { bag.setUsername(cfg.nickname); localStorage.setItem("username", cfg.nickname); }
      // Codex 的名字与头像（09-17）：一处读取、灌进外部 store，消息头与用户中心共用
      // （名字在 personalization.json，头像是 base64 图片所以放 localStorage，见 codex-identity.mjs）
      setCodexIdentity({ name: cfg?.assistantName || CODEX_DEFAULT_NAME, avatar: readStoredCodexAvatar() });
    }).catch(() => undefined);
  }, []);


  // 「你」（用户）的身份同样灌进外部 store（09-17 用户「人也要有名字和头像，位置跟 Codex 一样」）：
  // 用户消息的头部要用它 —— 与 Codex 侧同一套机制，免得在消息渲染链上逐层传 props。
  // 名字的权威源是上面异步回读的 personalization.nickname（会覆盖 localStorage），所以这里跟着走。
  useEffect(() => {
    setUserIdentity({
      name: bag.username,
      avatar: bag.userAvatar ? { type: bag.userAvatar.type, value: bag.userAvatar.value } : { type: "none", value: "" },
    });
  }, [bag.username, bag.userAvatar]);


  // 左下角账户名：点击进入行内编辑，Enter/失焦保存、Esc 取消
  const [accountEditing, setAccountEditing] = useState(false);
bag.accountEditing = accountEditing as typeof bag.accountEditing; bag.setAccountEditing = setAccountEditing as typeof bag.setAccountEditing;


  const [accountDraft, setAccountDraft] = useState("");
bag.accountDraft = accountDraft as typeof bag.accountDraft; bag.setAccountDraft = setAccountDraft as typeof bag.setAccountDraft;


  const accountNameRef = useRef<HTMLInputElement>(null);
bag.accountNameRef = accountNameRef as typeof bag.accountNameRef;


  const saveAccountName = () => {
    const next = bag.accountDraft.trim();
    if (next && next !== bag.username) {
      bag.setUsername(next);
      localStorage.setItem("username", next); // 缓存，供下次启动秒显
      // 联动引擎：昵称写进 AGENTS.md（Codex 每个请求动态加载），下次对话引擎就知道怎么称呼用户
      void window.codex.setNickname(next).then(() => bag.setNotice(`已更新称呼「${next}」，Codex 下次对话会这样称呼你`)).catch((error: any) => bag.setNotice(`称呼已更新，但同步到引擎失败：${error?.message ?? error}`));
    }
    bag.setAccountEditing(false);
  };
bag.saveAccountName = saveAccountName as typeof bag.saveAccountName;


  const startAccountEdit = () => { bag.setAccountDraft(bag.username); bag.setAccountEditing(true); };
bag.startAccountEdit = startAccountEdit as typeof bag.startAccountEdit;


  // 欢迎语：按时段 + 用户名组合，副语随机挑一条；useMemo 保证打字等重渲染不会让问候语跳变
  const [greeting, greetSub] = useMemo(() => {
    const hour = new Date().getHours();
    const period = hour < 6 ? "night" : hour < 11 ? "morning" : hour < 13 ? "noon" : hour < 18 ? "afternoon" : "evening";
    // 主问候保持纯渐变文字（不带 emoji）：emoji 在 background-clip:text 的 -webkit-text-fill-color:transparent 下
    // 会随文字一起变透明、渲染成黑色方块。emoji 视觉集中放在副语和建议卡里也够了
    const hello: Record<string, string> = { night: "夜深了", morning: "早上好", noon: "中午好", afternoon: "下午好", evening: "晚上好" };
    const pools: Record<string, string[]> = {
      night: ["🌙 这个点还醒着，是遇到棘手的问题了吗？说来听听，我陪你收尾。", "💡 凌晨的灵感最值钱——想清楚了就丢给我，剩下的体力活我来。", "🛏️ 夜深了，麻烦交给我，你负责早点休息。", "🌌 世界都睡了，你的问题我醒着。别硬撑，一起把它收掉。", "🕯️ 夜里的坚持值得被善待——把难题放下这边，休息交给时间。", "☕ 深夜的咖啡我陪你喝，代码我陪你写，你只管说想做成什么。"],
      morning: ["🌅 新的一天，从一句提问开始。想先推进哪件事？", "☕ 咖啡备好了吗？把今天的第一个任务丢过来吧。", "🚀 清晨头脑最清醒，正适合啃硬骨头。想从哪儿开始？", "☀️ 今天的太阳和昨天不一样，昨天的难题今天说不定一句话就通了。", "🌤️ 早上好，把今天最不想做的那件事交给我，剩下的都轻松。", "🌿 新的一天刚刚铺开，选一件小事开始，胜利感会滚雪球。"],
      noon: ["🍚 忙了一上午，先吃口饭也没关系——下午的任务可以先交给我。", "😴 午安！趁午休整理一下思路，下午开工就省力了。", "🔥 中午好，要不要趁热把上午没解决的问题清一清？", "🍵 吃饱了才有力气改变世界——先歇会儿，活儿我记着呢。", "⛅ 午间小憩是聪明的投资，醒来把想法丢给我接着干。", "🥢 上午没做完的别焦虑，下午的你有的是办法。"],
      afternoon: ["😌 下午好！困意上头的时刻，最适合把重复劳动交出去。", "📋 午后的活儿看着多？拆开一件一件来，细节我来盯。", "🍰 下午茶时间，顺便聊点正事？琐碎的活儿尽管丢给我。", "🍂 下午容易犯困，思路却最诚实——想说点什么，我都在。", "🧋 来杯奶茶的时间，够我们把一件麻烦事聊明白。", "🪟 阳光正好，把窗边的位置留给灵感，跑腿的活儿归我。"],
      evening: ["🌇 今天辛苦了，剩下的收尾让我来分担。", "🌃 夜幕降临，正适合安安静静解决一两个悬而未决的问题。", "✨ 晚上好，复盘、总结还是继续推进？交给我就行。", "🍵 忙了一天，别忘了给自己倒杯水——这边的事不着急，说清楚就好。", "🌙 夜色温柔，适合把白天的毛躁磨成晚上的成品。", "🏠 快到家了吗？今天的最后一件事，交给我来收尾。"],
    };
    const pool = pools[period];
    // 默认昵称（Codex 用户）不硬拼逗号，显得更自然；自定义昵称才带称呼
    const named = bag.username !== "Codex 用户" ? `${hello[period]}，${bag.username}` : hello[period];
    return [named, pool[Math.floor(Math.random() * pool.length)]] as const;
  }, [bag.username]);
bag.greeting = greeting as typeof bag.greeting; bag.greetSub = greetSub as typeof bag.greetSub;


  const [mobileRemoteOpen, setMobileRemoteOpen] = useState(false);
bag.mobileRemoteOpen = mobileRemoteOpen as typeof bag.mobileRemoteOpen; bag.setMobileRemoteOpen = setMobileRemoteOpen as typeof bag.setMobileRemoteOpen;


  const [botManagerOpen, setBotManagerOpen] = useState(false);
bag.botManagerOpen = botManagerOpen as typeof bag.botManagerOpen; bag.setBotManagerOpen = setBotManagerOpen as typeof bag.setBotManagerOpen;


  // botManagerOpen 的 ref 镜像：配对请求到达时判断用户是否正开着机器人面板（决定弹不弹远控面板）
  const botManagerOpenRef = useRef(false);
bag.botManagerOpenRef = botManagerOpenRef as typeof bag.botManagerOpenRef;


  // 机器人管理弹窗打开期间轮询渠道在线状态（5s）：扫码绑定成功/断开时左侧徽章即时跟上，
  // 不依赖网关 log 事件转发链路（09-08 反馈：扫码连接成功但状态一直「未连接」）。
  // 09-13 改为**常驻**轮询：用户经常叉掉面板再回来看，关闭期间停轮询会导致重开瞬间
  // 状态还是旧的（弹窗内 5s 才追上）；5s 一次 IPC 成本可忽略。
  useEffect(() => {
    void window.codex.channelsStatus?.().then(bag.setChannelOnline).catch(() => undefined);
    const timer = window.setInterval(() => { void window.codex.channelsStatus?.().then(bag.setChannelOnline).catch(() => undefined); }, 5000);
    return () => window.clearInterval(timer);
  }, []);


  // 频道机器人流式回复设置（全局，主进程 bot-stream.json）：弹窗打开时加载
  const [botStream, setBotStream] = useState<{ enabled: boolean; thinking: boolean; tools: boolean }>({ enabled: true, thinking: true, tools: true });
bag.botStream = botStream as typeof bag.botStream; bag.setBotStream = setBotStream as typeof bag.setBotStream;


  useEffect(() => {
    if (!bag.botManagerOpen) return;
    void window.codex.botStreamGet?.().then(bag.setBotStream).catch(() => undefined);
  }, [bag.botManagerOpen]);


  const updateBotStream = (next: { enabled: boolean; thinking: boolean; tools: boolean }) => {
    bag.setBotStream(next);
    void window.codex.botStreamSet?.(next).then(bag.setBotStream).catch(() => undefined);
  };
bag.updateBotStream = updateBotStream as typeof bag.updateBotStream;


  // 频道机器人会话绑定：机器人消息固定在选定会话中继续（可选老会话；持久化在主进程）
  const [botBindings, setBotBindings] = useState<{ wechat: { threadId: string; title: string; updatedAt: number } | null; telegram: { threadId: string; title: string; updatedAt: number } | null }>({ wechat: null, telegram: null });
bag.botBindings = botBindings as typeof bag.botBindings; bag.setBotBindings = setBotBindings as typeof bag.setBotBindings;


  useEffect(() => {
    if (!bag.botManagerOpen) return;
    void window.codex.botBindingGet?.().then(bag.setBotBindings).catch(() => undefined);
  }, [bag.botManagerOpen]);


  const setBotBinding = async (channel: "wechat" | "telegram", threadId: string | null, title?: string) => {
    try {
      const next = await window.codex.botBindingSet?.({ channel, threadId, title });
      bag.setBotBindings((cur) => ({ ...cur, [channel]: next ?? null }));
      bag.showToast("绑定已更新", threadId ? "机器人后续消息将在所选会话中继续" : "机器人已解绑，下一条消息将开启新会话", threadId ?? undefined);
    } catch { bag.showToast("绑定失败", "请稍后重试"); }
  };
bag.setBotBinding = setBotBinding as typeof bag.setBotBinding;


  const [bots, setBots] = useState<BotEntry[]>([]);
bag.bots = bots as typeof bag.bots; bag.setBots = setBots as typeof bag.setBots;


  const [activeBotId, setActiveBotId] = useState<string | null>(null);
bag.activeBotId = activeBotId as typeof bag.activeBotId; bag.setActiveBotId = setActiveBotId as typeof bag.setActiveBotId;


  const setBotsPersist = useCallback((updater: BotEntry[] | ((cur: BotEntry[]) => BotEntry[])) => {
    bag.setBots((cur) => {
      const next = typeof updater === "function" ? (updater as (c: BotEntry[]) => BotEntry[])(cur) : updater;
      void window.codex.botsSet?.(next).catch(() => undefined);
      return next;
    });
  }, []);
bag.setBotsPersist = setBotsPersist as typeof bag.setBotsPersist;
  return { persistCommand, confirmDeleteCommand, useCommand, hookTrusting, setHookTrusting, hookBusy, setHookBusy, linkedBusy, setLinkedBusy, projectFilter, setProjectFilter, username, setUsername, userAvatar, setUserAvatar, accountEditing, setAccountEditing, accountDraft, setAccountDraft, accountNameRef, saveAccountName, startAccountEdit, greeting, greetSub, mobileRemoteOpen, setMobileRemoteOpen, botManagerOpen, setBotManagerOpen, botManagerOpenRef, botStream, setBotStream, updateBotStream, botBindings, setBotBindings, setBotBinding, bots, setBots, activeBotId, setActiveBotId, setBotsPersist };
}
