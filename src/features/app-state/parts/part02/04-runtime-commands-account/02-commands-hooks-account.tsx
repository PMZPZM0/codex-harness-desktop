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
import { avatarAsset } from "../../../../../lib/avatar-presets";
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




  const [username, setUsername] = useState(() => localStorage.getItem("username") || "Codex 用户");
bag.username = username as typeof bag.username; bag.setUsername = setUsername as typeof bag.setUsername;


  /* 10-21：没头像的老档案不再显示名字首字母 —— 默认发熊猫插画头像；
     用户在「用户中心」选其它内置头像或上传后可覆盖。 */
  const [userAvatar, setUserAvatar] = useState<UserAvatarSpec | null>(() => {
    try {
      const p = JSON.parse(localStorage.getItem("user-profile") || "{}");
      if (p.avatarType && p.avatarType !== "none" && p.avatar) return { type: p.avatarType, value: p.avatar };
      return { type: "image", value: avatarAsset("user-panda.png") };
    } catch {
      return { type: "image", value: avatarAsset("user-panda.png") };
    }
  });
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
      night: [
        "🌃 城市的灯一盏盏灭了，我们这盏还亮着——把问题放过来，我陪你把它收干净。",
        "🌫️ 夜里想不清楚很正常，先把念头写下来，明早的你会感谢现在的自己。",
        "🪐 凌晨的脑子像失重的房间，东西都飘着；说给我听，我帮你把它们摆回原位。",
        "🧊 别用硬撑换进度，卡住就停一下，回来我们换个入口再进。",
        "🎬 今晚不求大结局，先拍完这一场；剩下的镜头明天继续。",
        "🌙 月亮负责守夜，我负责守住你的上下文；你只管去睡，明天接着聊。",
        "🌠 夜里适合做减法：留下最重要的那件，其余明天再说。",
        "🧭 如果思路卡住了，就把问题原样丢过来，我陪你换个方向。",
        "🎧 戴上耳机，世界安静下来，剩下的交给键盘和我。",
        "🌒 月亮在值班，我也在；你只需要说一句「开始」。",
        "📝 今晚不必完美，先把想法落成第一行，剩下的明天再打磨。",
        "🫖 夜里别跟自己较劲，问题交给我，热水留给你。",
      ],
      morning: [
        "🌞 新的一天不用一下子很厉害，先做成一件小事，节奏就起来了。",
        "🧭 早上先别急着回所有消息，挑最重要的那件事，我们从它开始。",
        "🫖 先给脑子热身：说个模糊的想法也行，我帮你把它磨成可执行的下一步。",
        "🪴 今天的任务清单不必写满，留一格给意外的好主意。",
        "🧱 清晨适合打地基：把最难那件事拆成三块，我们先搬第一块。",
        "📬 把昨天悬着的那件事发我，今天的第一口气把它顺掉。",
        "🥐 先吃口早饭，再挑一件最重要的事，我们从那里出发。",
        "🎯 早上适合定方向：说个目标，我帮你拆成今天能做完的几步。",
        "🧹 把昨天没收拾的尾巴交给我，今天从干净桌面开始。",
        "🌱 不急着跑完整程，先迈一步；剩下的路我们边走边看。",
        "📮 今天的待办里，最烦的那条先给我，剩下的会顺很多。",
        "🛠️ 开工前先想清楚「做完什么算赢」，我来负责把它做出来。",
      ],
      noon: [
        "🍱 上午的进度先封箱，午饭回来我们再开新的一箱。",
        "🌬️ 中午是一天的换气口：停十分钟，下午的判断会准很多。",
        "🧊 上午卡住的那一步，午休后可能只需要换个顺序。",
        "🍵 先把胃安顿好，再安顿待办——两件事都不用急。",
        "🪟 中午别做重大决定，先让脑子透透气。",
        "🔁 上午做过的事不用重走一遍，把结论丢给我，我们接着往下。",
        "🍜 午饭别对付，脑子需要燃料；回来我们再啃硬骨头。",
        "🧠 上午的坑先别急着填，午休后换个角度可能一步就过。",
        "🪑 起来走两步，喝口水；回来告诉我下一步想做什么。",
        "📎 把上午的零碎收一收，下午只留一件事做主攻。",
        "🌤️ 中午适合按下暂停键，下午的节奏由你定，我负责跟上。",
        "🧃 先补充能量，再补充上下文；下午的麻烦我来接。",
      ],
      afternoon: [
        "🌞 下午适合做「减法」：删掉不重要的，把力气留给一件真要紧的。",
        "🧭 方向对了慢一点没关系，方向没定我们先花五分钟定方向。",
        "🥤 困了就起来接杯水，回来我们从最容易启动的那一步继续。",
        "🪴 下午的注意力像电池，别切成十段用，留一段给正事。",
        "🧱 把大任务砌成小砖块，一块块搬，今天就能看见墙。",
        "📮 杂事都丢过来，你留着力气做那个只有你能做的判断。",
        "🧩 下午最适合收拾拼图：把散着的线索丢过来，我来拼。",
        "🎯 别一次做十件，挑一件做到收尾，今天就算没白过。",
        "🌇 太阳开始往西走，趁还有精神，把最硬的那块啃掉。",
        "🧹 把上午留下的半成品交给我，下午我们把它收干净。",
        "📦 琐事打包发我，你只留需要判断的那部分。",
        "🫧 脑子转不动就去洗把脸；回来我们从最小的一步重启。",
      ],
      evening: [
        "🌇 今天不管完成多少，先给自己记一笔「有推进」，剩下的我来接。",
        "🥘 收工前把明天的第一步写下来，明早就不用重新找状态。",
        "🪔 晚上适合把「没做完」改成「下一步」，焦虑会小很多。",
        "🗂️ 把今天的碎事交给我归档，你只留一个明天最想先做的。",
        "🌙 夜色不是用来赶工的，先歇一口；真着急的话，把任务丢过来。",
        "🛋️ 今天到此为止也可以，剩下的交给计划和自动化。",
        "🍲 晚饭吃了吗？吃饱回来，我们把今天最后一块拼图放好。",
        "🕯️ 晚上适合做一件小而完整的事，比十件半途而废更解压。",
        "🌆 白天没顾上的想法，现在可以慢慢说，我帮你把它们排好。",
        "🧺 把今天的碎念和待办一起丢过来，我帮你分成「今晚」和「明天」。",
        "🌌 不必今天解决所有问题；挑一件收尾，剩下的留给明早清醒的你。",
        "🎈 今天已经够长了，剩下的交给自动化，你负责好好收工。",
      ],
    };
    const pool = pools[period];
    /* 10-25 用户：「个性化词更新一下，丰富一下，之前都看腻了」——
       ⛔ 除了扩充到每段 12 条，还要**记住上一条**：否则随机很可能连续撞同一句，
          用户会觉得"根本没变"。优先从「不是上次那句」里随机挑。 */
    let sub = pool[Math.floor(Math.random() * pool.length)];
    try {
      const last = localStorage.getItem("welcome-greet-sub-v1") || "";
      if (pool.length > 1 && sub === last) {
        const start = Math.floor(Math.random() * pool.length);
        for (let i = 1; i <= pool.length; i++) {
          const candidate = pool[(start + i) % pool.length];
          if (candidate !== last) { sub = candidate; break; }
        }
      }
      localStorage.setItem("welcome-greet-sub-v1", sub);
    } catch { /* 隐私模式/存储不可用时退回随机 */ }
    // 默认昵称（Codex 用户）不硬拼逗号，显得更自然；自定义昵称才带称呼
    const named = bag.username !== "Codex 用户" ? `${hello[period]}，${bag.username}` : hello[period];
    return [named, sub] as const;
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
    /* ⛔ 失败不许静默（10-06 用户：「很多开发都没有通知提醒，全部检查一下」）：
       原来 `.catch(() => undefined)` 把落盘失败吞干净 —— 开关看着开了，重启后又是旧的。
       ⛔ 成功不回执：这三个是纯展示偏好，勾选框本身就是即时反馈（与"要重启引擎"的开关不同类）。 */
    void window.codex.botStreamSet?.(next).then(bag.setBotStream).catch((error: any) => bag.setNotice(`机器人流式设置保存失败：${error?.message ?? error}`));
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
      void window.codex.botsSet?.(next).catch((error: any) => bag.setNotice(`机器人设置保存失败：${error?.message ?? error}`));
      return next;
    });
  }, []);
bag.setBotsPersist = setBotsPersist as typeof bag.setBotsPersist;
  return { persistCommand, confirmDeleteCommand, useCommand, hookTrusting, setHookTrusting, hookBusy, setHookBusy, linkedBusy, setLinkedBusy, username, setUsername, userAvatar, setUserAvatar, accountEditing, setAccountEditing, accountDraft, setAccountDraft, accountNameRef, saveAccountName, startAccountEdit, greeting, greetSub, mobileRemoteOpen, setMobileRemoteOpen, botManagerOpen, setBotManagerOpen, botManagerOpenRef, botStream, setBotStream, updateBotStream, botBindings, setBotBindings, setBotBinding, bots, setBots, activeBotId, setActiveBotId, setBotsPersist };
}
