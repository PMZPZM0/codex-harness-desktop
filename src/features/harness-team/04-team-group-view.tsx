/**
 * 团队模式 · 群视图
 *
 * 结构照飞书群（逆向报告）：群头 → [消息流 + 输入区 | 成员栏]。
 * ⛔ 消息流只渲染**投影**（threadId + itemId），真身仍在各伙伴的原子会话；
 *    ⛔ 一条假消息都不造 —— 派活失败时这里什么都不加，错误走状态条。
 *
 * 11-06 二改（用户：「你这群跟普通会话没区别了」「功能太少了」）——按报告补了三处"群才有"的结构：
 *   ① **成员栏**（飞书 groupBotList / 豆包伙伴档案）：每个成员显示角色、运行态，点一下就把 @ 打上；
 *   ② **消息卡片**（飞书 2.2–2.4）：伙伴的回复不再是裸文本，而是带角色条 + 三个真实动作
 *      （复制 / 追问 / 来源会话）的卡片；
 *   ③ **@ 高亮**（飞书 4：mention 是单独一类对象）：人发的消息把 @ 了谁显示成 chip。
 */
import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { MessagesSquare, Search, Settings2, X, PanelRightClose, PanelRightOpen } from "lucide-react";
import type { GroupMessageRow, TeamFile, TeamGroup } from "./01-team-types";
import type { LiveRun } from "./02-team-store";
import { TeamSettings } from "./03-team-settings";
import { stripVoiceScript } from "../../lib/voice-script.mjs";
import { Markdown } from "../markdown";
/* 11-07 用户令：正文里的 @ 必须渲染成**真艾特**（带头像 + 用户名），多个按出现顺序逐个出。
   ⛔ 渲染在独立板块 `17-team-mention-text`（口径在纯函数 `team-mention-render.mjs` + 单测）。
   ⛔ 成员行三件套拆到 `18-team-member-actions`（守住 >1000 行棘轮，行为逐字未变）。 */
import { TeamMentionText } from "./17-team-mention-text";
import { TeamAvatarPicker } from "./19-team-avatar-picker";
import { buildMentionCandidates, fmtTime, shortId } from "./20-team-view-utils";
import { MemberActions } from "./18-team-member-actions";
import { TeamMenuButton } from "./06-team-menu";

import { TeamRuler } from "./07-team-ruler";
import { TeamProcess } from "./09-team-process";
import { TeamCards } from "./11-team-cards";
import { MemberAvatar } from "./13-team-avatar";
/* ⛔ 11-07 用户令「用户头像还有名字同步出来」：群主这一行必须和主对话同一个身份源
   （`components/UserAvatar` 的 subscribeUserIdentity）—— ⛔ 不要再写死「我」或首字圆圈。 */
import { useUserName } from "../../components/UserAvatar";
import { TeamProfileCard } from "./14-team-profile-card";
import { TeamMentionPanel } from "./15-team-mention-panel";
import { TeamSearchPanel } from "./16-team-search";
import { TeamComposer, loadTeamRunOpts, saveTeamRunOpts } from "./10-team-composer";
/* 11-08 用户令「询问/审批跟对话框一样，不要重复造轮子」：卡片本体复用主对话那两件，
   本域只做归属过滤（独立板块，⛔ 不往群视图里再写一套卡片 JSX）。 */
import { TeamPendingCards } from "./22-team-pending-cards";
import type { TeamRunOpts, TeamRunParams } from "./10-team-composer";
import { buildReplyQuotes } from "../../lib/team-fold.mjs";
import { getActiveModel } from "../../lib/active-model.mjs";
import { menuPickResult } from "../../lib/team-menu.mjs";
import { mergeConsecutive, parseCommand, parseMentions, parseTeamAuthorId, resolveManagerId, teamAuthorIdOf, teamMemberIdOf } from "../../lib/team-models.mjs";
/* 11-07：@ 提及与群内搜索的口径全部在纯函数里（可单测），视图只做接线。 */
import { applyMention, matchMentionCandidates, mentionSectionsOf, mentionTriggerOf } from "../../lib/team-mention.mjs";
/* 11-07 界面优化：消息流按天分隔（飞书群同款）——连续几十条跨天消息只靠时间看不出"这是哪天"。 */
import { dayKeyOf, dayLabelOf } from "../../lib/team-view.mjs";
/* ⛔ 贴底走统一原语（守卫禁止在时间线里直接把 scrollTop 赋成 scrollHeight ——
   连带注释里出现那个字面量都会被扫到）。群消息流没有主对话那圈「尾部留白」，
   所以目标就是内容底 —— 但写入路径必须同源。 */
import { scrollToOffsetInstant } from "../../components/scroll-utils";
import type { HarnessAppApi } from "../app-state";

type Props = {
  /** 11-07 用户令「输入框侧边粗条同步」：宿主 app（ComposerRail 需要）。 */
  app?: HarnessAppApi;
  group: TeamGroup;
  rows: GroupMessageRow[];
  issues?: string[];
  limit: number;
  onAddPartner: (partner: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  onRemovePartner: (partnerId: string) => Promise<{ ok: boolean; error?: string }>;
  onMute: (partnerId: string, muted: boolean) => Promise<{ ok: boolean; error?: string }>;
  onSetManager: (memberId: string, managerId: string) => Promise<{ ok: boolean; error?: string }>;
  onSetMemory: (text: string) => Promise<{ ok: boolean; error?: string }>;
  /** 项目地址（群的工作目录） */
  onSetWorkspace: (workspace: string) => Promise<{ ok: boolean; error?: string }>;
  onSetFiles: (files: TeamFile[]) => Promise<{ ok: boolean; error?: string }>;
  /** 清空聊天记录（只清群日志；伙伴的子会话不动） */
  onClearMessages?: () => Promise<{ ok: boolean; error?: string; cleared?: number }>;
  /** 解散群（11-07 用户令：群 + 群里派出去的会话一起删） */
  onDeleteGroup?: () => Promise<{ ok: boolean; error?: string }>;
  /** 记忆条目 */
  onAddNote: (note: { text: string; type: "fact" | "constraint" | "runbook" }) => Promise<{ ok: boolean; error?: string }>;
  onRemoveNote: (noteId: string) => Promise<{ ok: boolean; error?: string }>;
  /** 快捷指令菜单（整份替换） */
  onSaveMenu: (items: unknown[]) => Promise<{ ok: boolean; error?: string }>;
  /** 菜单展示形态（飞书 INPUT_FIRST / FLOAT） */
  onSaveMenuPlacement: (placement: "input" | "float") => Promise<{ ok: boolean; error?: string }>;
  /** 定时任务（整组替换；nextRunAt 由主进程算） */
  onSaveSchedules: (list: unknown[]) => Promise<{ ok: boolean; error?: string }>;
  /** 立刻运行一条定时任务 */
  onRunSchedule: (scheduleId: string) => Promise<{ ok: boolean; error?: string; sent?: number }>;
  /** 群内成员头像（11-07 用户令「加一个群内的成员头像自定义修改功能」）：只改这个群里的这张脸；空串 = 恢复默认 */
  onSetAvatar?: (memberId: string, avatar: string) => Promise<{ ok: boolean; error?: string }>;
  /** 群消息排版（11-07）：split = 伙伴靠左 / 用户靠右；left = 全部靠左（主进程落盘） */
  onSetMessageLayout?: (next: "split" | "left") => void;
  /** 停止某个伙伴当前这一回合（`@成员 /stop`、成员栏的停止键） */
  onStopPartner: (memberId: string) => Promise<{ ok: boolean; error?: string }>;
  /** 11-08 用户令「点停止是群里所有运行状态都停止掉」：输入框发送键在运行中变成停止键，
      一点全群停（候选 id 由本视图数出来，通道在 store）。 */
  onStopAll?: (threadIds: string[]) => Promise<{ ok: boolean; error?: string; stopped?: number }>;
  /** 模型下拉「更多设置…」：与主对话同款入口（打开 设置 → 模型） */
  onOpenModelSettings?: () => void;
  /** 正在流式输出的伙伴（飞书 `cardId` 原地刷新的等价物）：同一次运行只更新一张卡 */
  live?: LiveRun[];
  /** 重命名（主进程是唯一落点；这里只负责发与显示错误） */
  onRename?: (name: string) => Promise<{ ok: boolean; error?: string }>;
  /** 正在跑活的伙伴（id）：显示「正在处理…」，⛔ 不是消息 */
  busy?: string[];
  /** 上次派活的失败说明（⛔ 与消息流分开） */
  notice?: string;
  /** 派活：@ 了谁就把这句话交给谁，各自落各自子会话 */
  /** 第三参 = 本轮运行参数（模型/档位/沙箱/审批），⛔ 不传就回落到全局默认 */
  onSend?: (partnerIds: string[], text: string, params?: TeamRunParams) => Promise<{ ok: boolean; error?: string }> | void;
  /** 正向联动（11-07 用户令）：点消息上的「来源」直接打开那条会话。
   *  ⛔ 由宿主传进来（群面板在设置页里，自己拿不到 openThread）；不传就退回"复制 id"。 */
  onOpenThread?: (threadId: string) => void;
  /** 反向联动：这些 threadId 对应的会话**已经被删掉**（主进程 `team-thread-gone` 广播）
   *  ⇒ 来源标记变成不可点的「已删除」，⛔ 不让按钮点了没反应。 */
  goneThreads?: Set<string>;
};


/** 群聊一页多少条（首屏 + 每次向上补的量）。 */
const PAGE = 30;

/* ⛔ 11-07：成员行三件套（运行态点 → ⏹️ → @）已拆到 `18-team-member-actions.tsx`，
   两处调用（伙伴行 / 团成员行）不变。 */

export function TeamGroupView({
  app, group, rows, issues, busy, notice, limit,
  onAddPartner, onRemovePartner, onMute, onSetManager, onSetMemory, onSetWorkspace, onSetFiles,
  onDeleteGroup, onClearMessages, onRename, onSend,
  onAddNote, onRemoveNote, onSaveMenu, onSaveMenuPlacement, onSaveSchedules, onRunSchedule,
  onStopPartner, onStopAll, live, onOpenModelSettings, onOpenThread, goneThreads, onSetAvatar, onSetMessageLayout,
}: Props) {
  /* ⛔ 11-07 用户令「用户头像还有名字同步出来」：群主 = 当前用户，名字取**同一个**身份 store
     （主对话 `UserMessageView` 也是它）。⛔ 不读群记录里写死的「我」。 */
  const userName = useUserName();
  const [showSettings, setShowSettings] = useState(false);
  /* 11-07 用户令：「群设置里加一个选项，消息左右选项，卡片展示」——
     存进群 JSON（`messageLayout`，主进程落盘）；split = 伙伴靠左 / 用户靠右，left = 全部靠左。 */
  const messageLayout = group.messageLayout ?? "split";
  /* 正在换头像的成员（11-07）：{ 成员、当前值、点的那个头像元素 } —— 元素用于浮层定位。 */
  const [avatarTarget, setAvatarTarget] = useState<{ memberId: string; name: string; value: string; anchor: HTMLElement; variant: "agent" | "user" } | null>(null);
  const [text, setText] = useState("");
  const [atTargets, setAtTargets] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  /* 11-08 用户令「点停止是群里所有运行状态都停止掉」：输入框发送键在运行中变成一个停止键，
     一点全群停。`stopping` 只用来锁住那一下（主对话同款：interrupting 期间按钮转圈）。
     ⛔ 停止候选 = `agentThreadIds`（群内出现过的子会话），store 再让主进程按活动回合表核对。
     （处理函数在 agentThreadIds 之后定义，见下方的 stopEverything。） */
  const [stopping, setStopping] = useState(false);
  /* ⛔ 11-06：busy 会在 `invokeAgent` 返回时就清空，但后台调度会话可能还在收尾
     ⇒ 只看 busy 会显示「没有运行」而后台其实还在跑。订阅共享桥的登记数做补充判据。 */
  const [sendError, setSendError] = useState("");
  /** 菜单点击的回显（飞书 `showMsg` 的等价物：告诉用户"我往输入框放了什么"） */
  const [menuMsg, setMenuMsg] = useState("");
  /* ⛔ 11-07 用户：「这一块删了」——一次性回执（已清理 / 已填进输入框）只活 4 秒。 */
  const menuMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashMenuMsg = (text: string) => {
    setMenuMsg(text);
    if (menuMsgTimerRef.current) clearTimeout(menuMsgTimerRef.current);
    if (text) menuMsgTimerRef.current = setTimeout(() => setMenuMsg(""), 4000);
  };
  /** 群名内联编辑（⛔ 不用 window.prompt：原生弹窗在这个壳里体验差且样式不可控） */
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [nameError, setNameError] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [copied, setCopied] = useState("");
  /* 11-07 用户令：点伙伴头像 → 资料卡（身份 / 模型 / 群内统计）。⛔ 独立组件，别往这里塞内容。 */
  const [profile, setProfile] = useState<{ memberId: string; x: number; y: number } | null>(null);
  /* @ 候选面板：点 @ 按钮（多选，面板不关）与在输入框打 `@`（选完即替换并关闭）共用一份状态。
     ⛔ `start` 只在 typed 模式用（替换那段 `@查询词`），面板多选模式不碰正文。 */
  const [mention, setMention] = useState<{ open: boolean; query: string; start: number; caret: number; typed: boolean }>(
    { open: false, query: "", start: 0, caret: 0, typed: false },
  );
  const [searchOpen, setSearchOpen] = useState(false);
  /* ⛔ 11-08 用户（截图）：「两边侧边栏都没有展开折叠按键，右边在 🔍 图标右边加一个下面展开折叠的按键」
     ⇒ 成员栏可收起，键位就在搜索键右边。落 localStorage：关掉面板再开、重启应用都保持。 */
  const [membersOpen, setMembersOpen] = useState(() => {
    try { return localStorage.getItem("harness-team:members-open") !== "0"; } catch { return true; }
  });
  const toggleMembers = () => {
    setMembersOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem("harness-team:members-open", next ? "1" : "0"); } catch { /* 存储不可用：本次会话内有效 */ }
      return next;
    });
  };
  /** 搜索跳转后的短暂高亮（1.6s 后清掉，⛔ 不留永久 class） */
  const [flashKey, setFlashKey] = useState("");
  /* 过程折叠（用户：「这样不会刷屏」）：每条消息自带一个折叠块、默认收起。
     ⛔ 11-06 用户：「群头那个『展开过程』多余，可以不要了」⇒ 全局开关整体删除，
        只在单条消息上开合；FoldGroup 自己管手动状态，⛔ 不留死 state。 */
  /** 输入框工具行：模型/档位/权限是**持久化偏好**（重启不丢），技能/文件是一次性附件 */
  const [runOpts, setRunOpts] = useState<TeamRunOpts>(loadTeamRunOpts);
  useEffect(() => { saveTeamRunOpts(runOpts); }, [runOpts]);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  /* 11-08 用户令「@ 弹窗放到 @ 图标上面自适应展示」：面板锚在 @ 按钮上（composer 侧挂 ref）。 */
  const mentionAnchorRef = useRef<HTMLButtonElement | null>(null);
  /* 消息区贴底（11-06 实测：面板关掉再打开时停在最上面，看不到底部"正在写"那张卡，
     用户就会觉得"关了之后什么都没了"）。⛔ 只在自己本来就在底部时才跟，别抢用户翻历史的滚动。 */
  const streamRef = useRef<HTMLDivElement | null>(null);
  /* 刻度尺是 absolute：定位基准 = 消息流 wrap（不是 stream，会跟着内容滚走） */
  const wrapRef = useRef<HTMLDivElement | null>(null);
  /* ⛔ 11-06 用户：「团成员不展示出来吗」——群里的「软件开发专家团」只显示一行，
     看不到团里那 4 个人。⇒ 拉一次调度目录，把 member 条目按 teamId 挂到团下面。
     ⛔ 只读展示：团内成员由主理人编排，群视图不给它们单独派活（那是另一套语义）。 */
  const [catalog, setCatalog] = useState<Array<{ kind: string; key: string; name: string; profession?: string; teamId?: string }>>([]);
  const stickRef = useRef(true);
  const stick = () => { const el = streamRef.current; if (el) scrollToOffsetInstant(el, el.scrollHeight); };
  /* 分页（用户 11-06：「滚轮和聊天记录分页咋做的」）：⛔ 不一次把 400 条全画进 DOM ——
     首屏 30 条，滚到顶再往前加载一页，并且**保持滚动位置**（否则一加载就跳到别处）。 */
  const [visibleCount, setVisibleCount] = useState(PAGE);
  const hasMore = rows.length > visibleCount;
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;
  const loadEarlier = () => {
    const el = streamRef.current;
    const prevH = el?.scrollHeight ?? 0;
    const prevTop = el?.scrollTop ?? 0;
    stickRef.current = false; // 正在翻历史：⛔ 别让贴底 effect 把人拽回底部
    setVisibleCount((v) => Math.min(rows.length, v + PAGE));
    requestAnimationFrame(() => {
      const node = streamRef.current;
      if (node) scrollToOffsetInstant(node, node.scrollHeight - prevH + prevTop);
    });
  };
  const onStreamScroll = () => {
    const el = streamRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
    /* 滚到顶再往上 = 加载更早一页（主对话的「滚一屏补一页」同口径） */
    if (el.scrollTop < 36 && hasMoreRef.current) loadEarlier();
  };

  const partners = useMemo(() => group.members.filter((m) => m.kind === "bot"), [group]);
  /* 菜单形态（飞书 INPUT_FIRST / FLOAT）：两种形态共用同一份数据与同一个点击口径 */
  const menuPlacement = group.menuPlacement ?? "input";
  const floatMenu = menuPlacement === "float";
  /* 菜单 = 群自己的（用户可编辑）。⛔ 11-07 用户令：「停止运行放到成员列表的 @ 前面去」——
     系统项「停止运行」已从菜单里撤掉（它本来也解析不到、点了只弹「菜单项已经不在了」），
     改到成员栏顶部、成员行（每行的 @）**之前**。 */
  const menuItems = useMemo(() => group.menu ?? [], [group.menu]);

  const pickMenu = (key: string) => {
    const r = menuPickResult(group.menu ?? [], key);
    flashMenuMsg(r.message);
    if (r.ok) {
      setText(r.prompt);
      composerRef.current?.focus();
    }
  };
  /* ── 专家团 = 主理人 + 成员 ──────────────────────────────────────────────────
     ⛔⛔ 11-06 用户（截图）：「肯定要是主理人➕成员啊，专家团不一直是这样吗」——
        原来成员栏/@ 条/气泡署名都用群成员名（= 团名「软件开发专家团」），主理人「承枢」
        只缩在小字「负责人 承枢」里 ⇒ 看起来像"团"在群里说话，而不是一个人带队。
        现在统一：**团的第一行就是主理人本人**（名字 + 头像 + 职业），团名退到副标题。
     ⛔ 判据只此一处（成员栏 / @ 条 / 气泡头 / 头像 / @ 提及全部走它），别在三处各写一套。 */
  const teamLeadOf = (member: TeamGroup["members"][number]) => {
    if (member?.targetKind !== "team") return null;
    return catalog.find((t) => t.kind === "expert" && t.teamId === member.targetKey) ?? null;
  };

  /** 某个团伙伴的下属成员（按 teamId 匹配；同一 memberId 只留一条） */
  const teamKidsOf = (member: TeamGroup["members"][number]) => {
    if (member?.targetKind !== "team") return [];
    const teamId = String(member.targetKey ?? "");
    if (!teamId) return [];
    const seen = new Set<string>();
    return catalog
      .filter((t) => t.kind === "member" && t.teamId === teamId)
      .filter((t) => (seen.has(t.key) ? false : (seen.add(t.key), true)));
  };

  /** 团伙伴「出面上的人」= 主理人；目录还没回来时退回团名（⛔ 不编名字、不画空壳） */
  const personNameOf = (m: TeamGroup["members"][number]) =>
    /* ⛔ 11-07 用户令「用户头像还有名字同步出来」：群主那一行的名字必须与主对话同源
       （`useUserName()`：设过就用真名，没设过回落「你」）。
       ⛔ 群记录里 human 成员的 name 是建群时写死的「我」，不能拿它当显示名 ——
          改了用户名、群里还挂着旧的那个字。 */
    (m?.kind === "human" ? (userName || m?.name || "") : (teamLeadOf(m)?.name ?? m?.name ?? ""));

  /** 头像种子同理：团用**主理人**的身份（kind=expert + 主理人 key），画出来才是专家中心那张脸；
     ⛔ 只换 key 不换 kind 会画成团队徽章（`agentAvatarKindOf("team")`），等于没换。 */
  const faceOf = (m: TeamGroup["members"][number]) => {
    const lead = teamLeadOf(m);
    return lead ? { ...m, targetKind: "expert", targetKey: lead.key } : m;
  };

  /* 定时任务在群日志里的作者 id 是 `automation`（主进程写入）—— 它不是群成员，
     但消息不能显示成裸 id「automation」。⛔ 只有这一处映射，别在别处再判断一次。 */
  const nameOf = (id: string) => {
    if (id === "automation") return "定时任务";
    /* 11-07：系统播报不是群成员，直接露 id 会显示成英文「system」（真机截图实测）。 */
    if (id === "system") return "系统";
    /* 11-07 用户令：专家团成员要「以自己的身份」在群里说话。作者 id 是
       `team:<teamId>:<memberId>`（主进程/渲染层都用这一个口径），名字从调度目录查 —— 目录还没回来
       就退回 memberId（⛔ 不编名字，也不把整条消息丢掉）。 */
    const teamAuthor = parseTeamAuthorId(id);
    if (teamAuthor) {
      const kid = catalog.find((t) => t.kind === "member" && t.teamId === teamAuthor.teamId && (teamMemberIdOf(t) === teamAuthor.memberId || t.key === teamAuthor.memberId));
      return kid?.name || teamAuthor.memberId;
    }
    const m = group.members.find((x) => x.id === id);
    return m ? personNameOf(m) : id;
  };
  const memberOf = (id: string) => group.members.find((m) => m.id === id) ?? null;
  /* 团这一行的职业写主理人的（「交付总监」）；目录里 team 条目的 profession 是「4 位成员」，
     那是人数不是身份（用户要看的是"谁、什么角色"）。 */
  const roleOf = (id: string) => {
    const teamAuthor = parseTeamAuthorId(id);
    if (teamAuthor) {
      const kid = catalog.find((t) => t.kind === "member" && t.teamId === teamAuthor.teamId && (teamMemberIdOf(t) === teamAuthor.memberId || t.key === teamAuthor.memberId));
      return kid?.profession || "团成员";
    }
    const m = memberOf(id);
    if (!m) return "";
    return teamLeadOf(m)?.profession || m.targetProfession || "";
  };
  /** 按 id 取"画头像用的那个 member"（团 ⇒ 主理人的 key；团成员 ⇒ 目录里那条；未知 id ⇒ 只有名字的占位） */
  const faceOfId = (id: string) => {
    const teamAuthor = parseTeamAuthorId(id);
    if (teamAuthor) {
      return {
        id: teamAuthor.memberId,
        kind: "bot",
        name: nameOf(id),
        targetKind: "member",
        targetKey: teamAuthor.memberId,
        /* 团成员换过的脸（群级覆盖表，key = 合成 id）：消息气泡 / @ 芯片与成员栏同一张。 */
        avatar: group.avatars?.[id] ?? "",
      };
    }
    const m = memberOf(id);
    return m ? faceOf(m) : { id, name: nameOf(id) };
  };

  /* @ 候选（正文解析用）：群成员 + 团成员，名字统一走 personNameOf（群主 = 用户中心真名）。 */
  const mentionCandidates = buildMentionCandidates(group.members, personNameOf, teamKidsOf, teamAuthorIdOf, teamMemberIdOf);


  /* 伙伴回复正文里写了 `@某人` ⇒ 只做成**可点提及**：点一下把它加进本轮 @，
     ⛔ 不自动发、不自动派活（11-06：模型写「PPT @星象」这种举例文本也会被误读成指令）。 */
  const mentionPartner = (id: string) => {
    setAtTargets((prev) => (prev.includes(id) ? prev : [...prev, id]));
    composerRef.current?.focus();
  };

  /* ⛔ 11-06 用户：「补充文件引用和对话消息引用」——
     引用一条群消息 = 以主对话同款 `> 引文` 前缀放进输入框（发送时模型能读到），
     ⛔ 不新增群日志字段、⛔ 不改投影结构。 */
  const quoteRow = (row: GroupMessageRow) => {
    const quoted = String(row.text ?? "").trim().split("\n").map((line) => `> ${line}`).join("\n");
    if (!quoted) return;
    setText((prev) => `${prev.trimEnd()}${prev.trim() ? "\n\n" : ""}${quoted}\n\n`);
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const toggleAt = (id: string) => {
    setAtTargets((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  /* ── 11-07 三块（资料卡 / @ 面板 / 群内搜索）──────────────────────────────── */

  /** 点头像弹资料卡（锚点取头像的位置，卡片自己夹到视口内） */
  const openProfile = (event: React.MouseEvent<HTMLElement>, memberId: string) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setProfile({ memberId, x: rect.left, y: rect.bottom + 6 });
  };
  const closeMention = () => setMention({ open: false, query: "", start: 0, caret: 0, typed: false });
  const openMentionPanel = () => setMention({ open: true, query: "", start: 0, caret: 0, typed: false });

  /* 输入框内容变化：顺手判一次 `@` 触发（⛔ 判据只在纯函数里，别在这里写第二套）。 */
  const updateText = (next: string) => {
    setText(next);
    const caret = composerRef.current?.selectionStart ?? next.length;
    const trigger = mentionTriggerOf(next, caret);
    if (trigger) {
      setMention({ open: true, query: trigger.query, start: trigger.start, caret: trigger.caret, typed: true });
      return;
    }
    /* 只是「打字触发」的会话要跟着关；面板按钮打开的多选不因继续打字而关 */
    setMention((prev) => (prev.typed ? { open: false, query: "", start: 0, caret: 0, typed: false } : prev));
  };

  /** 面板候选（机器人 / 专家团 / 团成员）—— 目录与群成员一变就重算；
      团成员换过的脸（group.avatars）也在这里叠上去，@ 面板与成员栏才是同一张。 */
  const mentionSections = useMemo(() => mentionSectionsOf(group, catalog).map((section) => ({
    ...section,
    items: section.items.map((item) => ({
      ...item,
      avatar: { ...item.avatar, avatar: group.avatars?.[item.selectId] ?? item.avatar.avatar ?? "" },
    })),
  })), [group, catalog]);

  const pickCandidate = (item: { selectId: string; name: string }) => {
    const already = atTargets.includes(item.selectId);
    if (mention.typed) {
      /* 打字触发：把 `@查询词` 换成 `@名字 `，并把这个人加进本轮 @（已选中就只换文本） */
      if (!already) setAtTargets((prev) => [...prev, item.selectId]);
      /* ⛔ 传 caret：只替换用户输入的那几个字，⛔ 不碰后面已经写好的正文。 */
      const applied = applyMention(text, { start: mention.start, caret: mention.caret }, item.name);
      setText(applied.text);
      closeMention();
      requestAnimationFrame(() => {
        const el = composerRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(applied.caret, applied.caret);
      });
      return;
    }
    /* 按钮打开 = 多选面板：点一下切换，面板不关（飞书同款） */
    setAtTargets((prev) => (already ? prev.filter((x) => x !== item.selectId) : [...prev, item.selectId]));
  };

  /**
   * 搜索命中 → 跳到那条消息。
   * ⛔ 分页是「从尾部往前取 visibleCount 条」⇒ 目标在这一页之外时先补足窗口，
   *    否则 DOM 里根本没有那个节点（滚动会静默失败）。
   */
  const jumpToRow = (hit: { key: string; itemId: string }) => {
    const index = rows.findIndex((r) => r.key === hit.key);
    if (index < 0) return;
    const need = rows.length - index;
    if (need > visibleCount) setVisibleCount(Math.min(rows.length, need + 6));
    setSearchOpen(false);
    setFlashKey(hit.key);
    window.setTimeout(() => setFlashKey((cur) => (cur === hit.key ? "" : cur)), 1600);
    /* 等 React 把新的一页提交到 DOM 再量位置（两帧够用；单帧在长列表里会量到旧节点） */
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const stream = streamRef.current;
      if (!stream) return;
      const target = Array.from(stream.querySelectorAll<HTMLElement>("[data-item-id]"))
        .find((el) => el.getAttribute("data-item-id") === hit.itemId);
      if (!target) return;
      const offset = target.getBoundingClientRect().top - stream.getBoundingClientRect().top + stream.scrollTop - 24;
      stickRef.current = false; // 正在看历史：⛔ 别被贴底 effect 拽回底部
      scrollToOffsetInstant(stream, Math.max(0, offset));
    }));
  };

  const saveName = async () => {
    const next = draftName.trim();
    if (!next || next === group.name) { setEditingName(false); setNameError(""); return; }
    setRenaming(true);
    const r = await onRename?.(next);
    setRenaming(false);
    if (r && !r.ok) { setNameError(r.error || "改名失败"); return; }
    setNameError("");
    setEditingName(false);
  };

  /** 停止：`/stop`（全部在跑的）或 `/stop @某人`（只停他） */
  const runStop = async (rest: string) => {
    const ids = parseMentions(rest, group).map((m) => m.id);
    const targets = ids.length ? ids : (busy ?? []);
    if (!targets.length) return { ok: false, error: "现在没有人在跑，不用停" };
    const results = await Promise.all(targets.map((id) => onStopPartner(id)));
    const bad = results.find((r) => !r.ok);
    if (bad) return { ok: false, error: bad.error || "停止失败" };
    return { ok: true };
  };

  /* ⛔ 11-07 用户（截图圈掉那块）：「这个删除按键，怎么还在这里…都放成员 @ 前面，动态展示，
     联动调度会话，真停止的」。⇒ 全局「停止运行」整块删除（连同 stopAll / stopping 状态）：
     运行态与停止都收到**每个成员那一行**（状态点在 @ 前、停在 @ 后，见 MemberActions）。
     ⛔ 别再以「万一没人在跑怎么办」为理由加回全局键 —— 用户已经否掉两次。 */

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSendError("");
    setMenuMsg("");

    /* ⛔ 命令优先：`/stop` 是**本地动作**，不能被当成一句话派给模型 */
    const cmd = parseCommand(body);
    if (cmd?.name === "stop") {
      setSending(true);
      try {
        const r = await runStop(cmd.rest);
        if (!r.ok) { setSendError(r.error ?? "停止失败"); return; }
        setText("");
        flashMenuMsg("已停止 —— 它这一回合的中断请求已发给引擎");
      } finally {
        setSending(false);
      }
      return;
    }
    if (cmd) { setSendError(`不认识的命令：/${cmd.name}（目前只支持 /stop）`); return; }

    /* 技能 / 文件是"本轮附件"：照主对话口径拼进 query，⛔ 不落群日志、不当成消息刷屏。 */
    const skillBlock = runOpts.skills.length
      ? `[本轮已引用技能]\n${runOpts.skills.map((s) => `- ${s.name}${s.description ? `：${s.description}` : ""}`).join("\n")}\n[请按上述技能工作流执行]`
      : "";
    const fileBlock = runOpts.files.length
      ? `[附件文件]\n${runOpts.files.map((p) => `- ${p}`).join("\n")}\n[附件结束]`
      : "";
    const fullBody = [body, skillBlock, fileBlock].filter(Boolean).join("\n\n");
    /* ⛔⛔ 11-06 用户：「模型也是死的，一点联动性都没有」「跟随模型配置界面，还是旧的」。
       「跟随全局」原来 = 不传 model ⇒ 引擎沿用**复用子会话首次创建时**的模型，
       模型配置界面换了也白换。⇒ 空值就取当前生效模型**显式下发**（turn/start.model
       会覆盖会话旧模型），指定模型时仍按用户选的走。 */
    const effectiveModel = runOpts.model || getActiveModel().name || "";
    const params: TeamRunParams = {
      model: effectiveModel || undefined,
      effort: runOpts.effort,
      sandbox: runOpts.sandbox,
      approvalPolicy: runOpts.approvalPolicy,
    };
    setSending(true);
    try {
      const r = await onSend?.(atTargets, fullBody, params);
      if (r && !r.ok) {
        setSendError(r.error || "派活失败");
        return; // ⛔ 失败保留原文，别把用户打的字清掉
      }
      setText("");
      /* 偏好保留，一次性附件发完即清（与主对话"本轮附件"同语义） */
      setRunOpts((prev) => ({ ...prev, skills: [], files: [] }));
    } catch (err) {
      /* 派活通道异常：把错误说出来，⛔ 原文留着别丢（用户打的字比一次失败值钱） */
      setSendError(`派活失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSending(false);
    }
  };

  /* 卡片的三个动作（飞书 ActionType 的等价物，⛔ 都是真动作，没有装饰按钮）：
     复制 = client_message（纯本地）｜追问 = action_request（把它 @ 上再发一轮）｜来源 = open_url（回原子会话） */
  const copyText = async (row: GroupMessageRow) => {
    try {
      await navigator.clipboard.writeText(row.text);
      setCopied(row.key);
      window.setTimeout(() => setCopied((cur) => (cur === row.key ? "" : cur)), 1200);
    } catch { /* 剪贴板被拒：静默（不让一个复制失败打断阅读） */ }
  };

  const askAgain = (row: GroupMessageRow) => {
    /* 团成员的消息：@ 回**他本人**（合成 id），与成员栏那个 @ 同一口径 ——
       dispatch 会把 `team:<teamId>:<memberId>` 翻成 kind:"member" 派给他自己的会话。 */
    const teamAuthor = parseTeamAuthorId(row.authorId);
    setAtTargets([teamAuthor ? row.authorId : (row.via?.memberId ?? row.authorId)]);
    composerRef.current?.focus();
  };

  const shownRows = useMemo(
    () => (rows.length > visibleCount ? rows.slice(rows.length - visibleCount) : rows),
    [rows, visibleCount],
  );
  const liveLen = (live ?? []).map((r) => `${r.threadId}:${String(r.text ?? "").length}`).join("|");

  /* 11-08 用户令「询问/审批跟对话框一样」：伙伴的询问卡/审批卡要就地弹在群里。
     归属判据 = **本群出现过的子会话 id**（正在跑的 ∪ 群消息里的来源会话）——
     ⛔ 只用 live 会在回合刚结束、卡还没关掉的那一瞬间把卡"闪掉"；
     也⛔ 不用全局 pending（那是所有会话的，会把别的群/主对话的询问一起弹上来）。 */
  const agentThreadIds = useMemo(() => {
    const ids = new Set<string>();
    for (const run of live ?? []) if (run.threadId) ids.add(run.threadId);
    for (const row of rows) if (row.threadId) ids.add(row.threadId);
    return [...ids];
  }, [live, liveLen, rows]);

  /* 输入框那个「停止」键：一次停掉群里所有正在跑的伙伴（主对话 interrupt 的群版）。
     ⛔ 与成员行的单人停止共用同一条通道（harness-team:stop），只是带 stopAll。 */
  const groupRunning = (live ?? []).some((run) => run.status === "running") || (busy ?? []).length > 0;
  const stopEverything = async () => {
    if (stopping || !onStopAll) return;
    setStopping(true);
    setSendError("");
    try {
      const res = await onStopAll(agentThreadIds);
      if (!res?.ok) setSendError(res?.error || "停止失败");
      else flashMenuMsg(`已停止群里 ${res.stopped ?? 0} 个正在跑的伙伴`);
    } finally {
      setStopping(false);
    }
  };

  /* 换群 ⇒ 无条件贴底；消息或流式有变化 ⇒ 只在原本贴底时跟随 */
  useEffect(() => { stickRef.current = true; setVisibleCount(PAGE); stick(); }, [group.id]);
  useEffect(() => { if (stickRef.current) stick(); }, [rows.length, liveLen]);

  /* ⛔ 同一作者、短间隔的连续消息并成一条（用户：「别框框刷屏」）。
     只影响渲染分组，`continued` 里仍是独立消息（各自 itemId 可溯源）。 */
  const displayRows = mergeConsecutive(shownRows);

  /* 引用索引用**全量 rows**（不是分页后的 shownRows）：翻到更早的一页时，
     上一条人类消息可能在被截掉的那一段里，⛔ 不能因此把引用丢成空白。 */
  const quotes = useMemo(() => buildReplyQuotes(rows), [rows]);

  /* ⛔ 11-06 用户：「补充文件引用」——候选只从**群消息正文里真实出现过的本机路径**扫，
     ⛔ 不猜、不建索引；选中的路径仍走现有 `opts.files` / `[附件文件]` 段（与主对话同口径）。 */
  const fileCandidates = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ path: string; source: string }> = [];
    const re = /[A-Za-z]:[\\/][^\s"'<>|*?\n]+/g;
    for (const r of rows) {
      const text = String(r.text ?? "");
      for (const m of text.matchAll(re)) {
        const p = m[0].replace(/[.,;:)\]】]+$/, "");
        if (!p || seen.has(p)) continue;
        seen.add(p);
        out.push({ path: p, source: nameOf(r.authorId) });
        if (out.length >= 40) return out;
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  /* ⛔ 折叠/展开改变内容高度后必须重算贴底（项目纪律：pin-shrink-follow）。
     群头全局开关删掉后改由折叠组自己的过渡结束事件触发（主对话 Fold 用
     grid-template-rows 过渡），这样**单行**开合也能覆盖；只在用户本来贴底时跟，
     ⛔ 不抢他正在翻的历史位置。 */
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await window.codex.listDispatchCatalog();
        const list = Array.isArray(res?.targets) ? res.targets : [];
        if (alive) setCatalog(list.filter((t) => t && t.kind && t.key));
      } catch { /* 目录读不到就不展开，⛔ 不画空壳 */ }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const el = streamRef.current;
    if (!el) return;
    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName !== "grid-template-rows") return;
      if (!stickRef.current) return;
      requestAnimationFrame(() => { if (stickRef.current) stick(); });
    };
    el.addEventListener("transitionend", onEnd);
    return () => el.removeEventListener("transitionend", onEnd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 项目地址显示成短名（全路径放 title）：群头一行塞不下 D://a//b//c */
  const projectName = (group.workspace ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "";
  const ctxParts = [
    projectName ? `项目 ${projectName}` : "",
    group.memory?.trim() ? "群记忆" : "",
    (group.files?.length ?? 0) > 0 ? `${group.files.length} 个参考文件` : "",
    (group.schedules?.length ?? 0) > 0 ? `${group.schedules.length} 个定时` : "",
  ].filter(Boolean);

  return (
    <div className="team-group">
      {/* 群内成员头像（11-07）：点成员栏的头像打开；选完只改这个群的这张脸。 */}
      {avatarTarget && (
        <TeamAvatarPicker
          anchor={avatarTarget.anchor}
          name={avatarTarget.name}
          current={avatarTarget.value}
          variant={avatarTarget.variant}
          onPick={(avatar) => {
            void onSetAvatar?.(avatarTarget.memberId, avatar);
            setAvatarTarget(null);
          }}
          onClose={() => setAvatarTarget(null)}
        />
      )}
      <header className="team-group__head">
        {/* 群徽标：首字小方块（11-07 美化：群头一眼有“这是一个群”的锚点） */}
        <span className="team-group__badge" aria-hidden>{[...(group.name || "群")][0]}</span>
        <div className="team-group__title">
          <div className="team-group__title-row">
            {editingName ? (
              <>
                <input
                  className="team-group__rename-input"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); void saveName(); }
                    if (e.key === "Escape") { e.stopPropagation(); setEditingName(false); setNameError(""); }
                  }}
                  aria-label="群名"
                  maxLength={40}
                  autoFocus
                />
                <button type="button" className="team-group__settings-btn" onClick={() => void saveName()} disabled={renaming}>保存</button>
                <button type="button" className="team-group__settings-btn" onClick={() => { setEditingName(false); setNameError(""); }} disabled={renaming}>取消</button>
              </>
            ) : (
              <>
                <h2>{group.name}</h2>
                {onRename && (
                  <button
                    type="button"
                    className="team-group__rename-btn"
                    title="重命名这个群"
                    aria-label="重命名这个群"
                    onClick={() => { setDraftName(group.name); setNameError(""); setEditingName(true); }}
                  >
                    改名
                  </button>
                )}
              </>
            )}
            <span className="team-group__sub" title={ctxParts.join(" · ")}>
              {group.members.length} 位成员 · {partners.length} 个伙伴
              {ctxParts.length > 0 && ` · ${ctxParts.join(" · ")}`}
            </span>
          </div>
        </div>
        <div className="team-group__head-actions">
          <div className="team-group__avatars" title={`${group.members.length} 位成员`}>
            {group.members.slice(0, 4).map((m) => (
              <button
                key={m.id}
                type="button"
                className={`team-group__avatar has-agent${m.muted ? " is-muted" : ""}`}
                title={`${personNameOf(m)} · 点开资料卡`}
                aria-label={`${personNameOf(m)} 的资料卡`}
                onClick={(e) => openProfile(e, m.id)}
              >
                {/* ⛔ 团画主理人的头像（见 faceOf）：群头一排是"人"，不是一个团团徽 */}
                <MemberAvatar member={faceOf(m)} size={22} />
              </button>
            ))}
            {group.members.length > 4 && <span className="team-group__avatar is-more">+{group.members.length - 4}</span>}
          </div>
          <span className="team-group__head-sep" aria-hidden />
          <button
            type="button"
            className={`team-group__icon-btn${searchOpen ? " is-on" : ""}`}
            onClick={() => setSearchOpen((v) => !v)}
            title="群内搜索"
            aria-label="群内搜索"
            aria-expanded={searchOpen}
          >
            <Search size={14} />
          </button>
          {/* ⛔ 11-08 用户：「右边在 🔍 图标右边加一个下面展开折叠的按键图标」
              —— 收起 / 展开右侧成员栏（键位紧跟搜索键，⛔ 别挪到最右，用户点名了位置） */}
          <button
            type="button"
            className={`team-group__icon-btn is-icon-only${membersOpen ? "" : " is-on"}`}
            onClick={toggleMembers}
            title={membersOpen ? "收起成员栏" : "展开成员栏"}
            aria-label={membersOpen ? "收起成员栏" : "展开成员栏"}
            aria-expanded={membersOpen}
          >
            {membersOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
          </button>
          <button type="button" className="team-group__icon-btn" onClick={() => setShowSettings((v) => !v)} title={showSettings ? "返回工作伙伴" : "群设置"}>
            {showSettings ? <X size={14} /> : <Settings2 size={14} />} <span>{showSettings ? "返回" : "设置"}</span>
          </button>
        </div>
        {searchOpen && (
          <TeamSearchPanel
            rows={rows}
            authorName={nameOf}
            onJump={jumpToRow}
            onClose={() => setSearchOpen(false)}
          />
        )}
      </header>

      {showSettings ? (
        <TeamSettings
          group={group}
          issues={issues}
          limit={limit}
          onAddPartner={onAddPartner}
          onRemovePartner={onRemovePartner}
          onMute={onMute}
          onSetManager={onSetManager}
          onSetMemory={onSetMemory}
          onSetWorkspace={onSetWorkspace}
          onSetFiles={onSetFiles}
          onClearMessages={onClearMessages}
          onDeleteGroup={onDeleteGroup}
          onAddNote={onAddNote}
          onRemoveNote={onRemoveNote}
          onSaveMenu={onSaveMenu}
          onSaveMenuPlacement={onSaveMenuPlacement}
          messageLayout={messageLayout}
          onMessageLayout={(next) => onSetMessageLayout?.(next)}
          onSaveSchedules={onSaveSchedules}
          onRunSchedule={onRunSchedule}
        />
      ) : (
        <div className={`team-group__body${membersOpen ? "" : " is-members-hidden"}`}>
          <div className="team-group__main">
            <div className="team-group__stream-wrap" ref={wrapRef}>
            <div className={`team-group__stream${messageLayout === "left" ? " is-layout-left" : ""}`} role="log" aria-live="polite" ref={streamRef} onScroll={onStreamScroll}>
              {hasMore && (
                <button type="button" className="team-group__more" onClick={() => loadEarlier()}>
                  ↑ 加载更早的 {Math.min(PAGE, rows.length - visibleCount)} 条（共 {rows.length} 条）
                </button>
              )}
              {rows.length === 0 ? (
                <div className="team-group__empty">
                  <span className="team-group__empty-icon" aria-hidden><MessagesSquare size={22} /></span>
                  <p>这个群还没有说过话。</p>
                  <p className="team-group__empty-hint">
                    在下面 @ 一个伙伴派活，它的回复会和这里其他伙伴的按时间排在一起。
                    <br />
                    每个伙伴都有自己独立的会话，这里只是它们的合影。
                  </p>
                  {partners.length === 0 && (
                    <button type="button" className="team-group__empty-btn" onClick={() => setShowSettings(true)}>
                      先加一个伙伴
                    </button>
                  )}
                </div>
              ) : (
                displayRows.map((row, index) => {
                  /* 跨天分隔：只在"这一条与上一条不在同一天"时插一条（⛔ 每天第一条之前才插，
                     不是每条都算 —— 否则同一天里会到处是日期条）。 */
                  const prevRow = displayRows[index - 1];
                  const dayBreak = !prevRow || dayKeyOf(prevRow.at) !== dayKeyOf(row.at);
                  const isBot = row.authorKind === "bot";
                  const role = roleOf(row.authorId);
                  const running = busy?.includes(row.authorId);
                  /* ⛔ 正文永远正常显示（用户：「只有正文正常消息发送出来」）；
                     运行过程另起一个折叠块挂在正文下面，默认收起。 */
                  const quote = isBot ? quotes.get(row.key) : undefined;
                  const mentioned = isBot
                    ? parseMentions(row.text, group, { excludeId: row.authorId }).filter((m) => m.kind === "bot")
                    : [];
                  /* ⛔ 11-07：`mentions` 不再渲染成前缀 chip —— 正文里的 `@名字` 会就地变成真提及。
                     这里再画一遍就是截图上那个「两个 @承枢」，一真一假。 */
                  /* ⛔ 11-07 真机截图修正：定时任务那行曾显示成「定时任务 定时任务」（名字 + 徽标复述）。
                     ⇒ 合成来源（定时任务 / 系统）**用徽标代替名字**：一眼看出「这不是人说的」，
                        也不再重复；有真名的（上级）才名字 + 徽标。 */
                  const authorName = nameOf(row.authorId);
                  const synthetic = row.senderKind === "automation" || row.senderKind === "system";
                  return (
                    <Fragment key={row.key}>
                      {dayBreak && (
                        <div className="team-msg__day" role="separator" aria-label={dayLabelOf(row.at)}>
                          <span>{dayLabelOf(row.at)}</span>
                        </div>
                      )}
                    <article
                      className={`team-msg${isBot ? " is-bot" : " is-human"}${
                        row.senderKind && row.senderKind !== "user" ? ` is-${row.senderKind}` : ""
                      }${flashKey === row.key ? " is-search-hit" : ""}`}
                      data-sender={row.senderKind || "user"}
                      data-thread={row.threadId}
                      data-item={row.itemId}
                      data-item-id={row.itemId}
                      data-ruler-mark={isBot ? undefined : "user"}
                    >
                      {memberOf(row.authorId) ? (
                        <button
                          type="button"
                          className="team-msg__avatar-btn"
                          onClick={(e) => openProfile(e, row.authorId)}
                          title={`${authorName} · 点开资料卡`}
                          aria-label={`${authorName} 的资料卡`}
                        >
                          <MemberAvatar member={faceOfId(row.authorId)} size={28} className="team-msg__avatar has-agent" />
                        </button>
                      ) : (
                        <MemberAvatar member={faceOfId(row.authorId)} size={28} className="team-msg__avatar has-agent" />
                      )}
                      <div className="team-msg__main">
                        <div className="team-msg__meta">
                          {synthetic ? (
                            <em className={`team-msg__sender${row.senderKind === "automation" ? " is-automation" : ""}`}>
                              {authorName}
                            </em>
                          ) : (
                            <strong>{authorName}</strong>
                          )}
                          {/* ⛔ 伙伴互 @ 的消息要能看出来"不是用户派的"：否则用户会以为
                              自己 @ 了两个人（11-06 那次误触发的第一反应就是这句）。 */}
                          {row.via && (
                            <em className="team-msg__via" title={`${row.via.name} 在群里叫它做这件事`}>
                              由 {row.via.name} 叫来
                            </em>
                          )}
                          {isBot && role && <em className="team-msg__role">{role}</em>}
                          {isBot && running && <em className="team-msg__role is-live">处理中</em>}
                          {/* ⛔⛔ 11-07 用户令：「准确区分每条消息是上级发送还是用户发送」。
                              定时任务以前 authorKind=human ⇒ 在群里显示成「我」说的话；
                              现在按结构化 senderKind 标出真实来源，⛔ 不改 authorKind 的既有语义
                              （它还管着过程折叠 / 卡片 / 动作条，动了会连带坏一片）。
                              合成来源的徽标已代替名字（见上），这里只补「上级派发」这一个带真名的角色。 */}
                          {row.senderKind === "supervisor" && <em className="team-msg__sender">上级派发</em>}
                          <time>{fmtTime(row.at)}</time>
                        </div>
                        {/* ⛔ 11-07 用户（对照截图）：名字那一行放到**气泡外面**，气泡里只放引用 / 正文 /
                            运行过程 / 动作条。引用与正文同属这块气泡，左边界才能对齐。 */}
                        <div className="team-msg__body">

                        {/* 引用行放在**正文上面**（用户：这个应该放上面吧，在正文消息上面）。
                            ⛔ 只有伙伴消息有引用；它取的是这条回复之前最近一条人类消息。 */}
                        {isBot && quote && (
                          <div className="team-process__quote team-process__quote--top" title={`回复 ${nameOf(quote.authorId)}：${quote.text}`}>
                            <span className="team-process__quote-bar" aria-hidden />
                            <span className="team-process__quote-line">
                              回复
                              {/* 11-07 用户：「@的成员头像+名字又没了」——引用里的作者必须是真实提及（头像+名字），
                                  引用正文里的 @ 也走同一个渲染器。 */}
                              <button
                                type="button"
                                className="team-at team-process__quote-author"
                                title={`@${nameOf(quote.authorId)} · 点一下加进本轮 @`}
                                onClick={(event) => { event.preventDefault(); mentionPartner(quote.authorId); }}
                              >
                                <MemberAvatar member={faceOfId(quote.authorId)} size={14} className="team-at__avatar" />
                                <span className="team-at__name">{nameOf(quote.authorId)}</span>
                              </button>
                              <span>：</span>
                              <TeamMentionText
                                text={quote.text}
                                candidates={mentionCandidates}
                                faceOfId={faceOfId}
                                nameOf={nameOf}
                                onPick={mentionPartner}
                                excludeId={row.authorId}
                                className="team-process__quote-body"
                              />
                            </span>
                          </div>
                        )}
                        {/* 11-07 用户：「运行折叠板块放上面，下面就可以展示文件卡片那些了，跟主对话框一样」——
                            过程折叠在正文**上方**；正文下面是产物卡 / 图片 / 表格（Markdown 灯箱同主对话）。 */}
                        {isBot && row.kind !== "card" && (
                          <TeamProcess
                            key={row.key}
                            threadId={row.threadId}
                            at={row.at}
                            bodyText={row.text}
                            running={running}
                            onAskAgain={() => askAgain(row)}
                          />
                        )}
                        {row.kind === "card" ? (
                          <pre className="team-msg__card">{JSON.stringify(row.card, null, 2)}</pre>
                        ) : (
                          /* 正文走**主对话同一个 Markdown 组件**（表格/代码/链接/图片灯箱一致）。
                             ⛔ 播报稿 ```voice 是给耳朵的，渲染前剥掉（口径只有一处）。
                             ⛔⛔ 11-07 用户令（截图）：以前这里先渲染一排 `mentions` 前缀 chip、正文里
                                又原样保留 `@承枢` ⇒ 同一条消息出现两个「@承枢」，一真一假。
                                ⇒ 现在**只从正文出**（`17-team-mention-text`）：每个 `@名字` 就地变成
                                  带头像的提及，顺序 = 正文出现顺序。⛔ 不要再加回前缀 chip。 */
                          <>
                            <TeamMentionText
                              text={stripVoiceScript(row.text)}
                              candidates={mentionCandidates}
                              faceOfId={faceOfId}
                              nameOf={nameOf}
                              onPick={mentionPartner}
                              excludeId={row.authorId}
                            />
                            {(row.continued ?? []).map((extra) => (
                              <TeamMentionText
                                key={extra.key}
                                className="team-msg__more markdown"
                                text={stripVoiceScript(extra.text)}
                                candidates={mentionCandidates}
                                faceOfId={faceOfId}
                                nameOf={nameOf}
                                onPick={mentionPartner}
                                excludeId={row.authorId}
                              />
                            ))}
                            {/* 运行过程在**正文下方**、文件卡在过程下方（主对话同序：正文 → 过程 → 产物卡）。 */}
                            {isBot && <TeamCards threadId={row.threadId} at={row.at} bodyText={row.text} />}
                          </>
                        )}
                        {isBot && (
                          <div className="team-msg__actions">
                            <button type="button" onClick={() => void copyText(row)}>
                              {copied === row.key ? "已复制" : "复制"}
                            </button>
                            <button type="button" onClick={() => askAgain(row)}>追问</button>
                            <button type="button" onClick={() => quoteRow(row)} title="把这条消息引用到输入框（发送时带 > 引文）">引用</button>
                            {mentioned.map((m) => (
                              <button
                                key={m.id}
                                type="button"
                                className="team-msg__mention-btn"
                                title="点一下把它加进本轮 @（不会自动派活）"
                                onClick={() => mentionPartner(m.id)}
                              >@{m.name}</button>
                            ))}
                            {/* ⛔⛔ 11-07 用户令「正反向联动做好一点」：
                                · 正向 —— 点「来源」直接**打开那条会话**（以前只是复制 id，等于给了个没法用的坐标）；
                                · 反向 —— 那条会话被删掉时由 `goneThreads` 标成不可点的「已删除」
                                  （见 store 的 `team-thread-gone` 广播），⛔ 不让按钮点了没反应。 */}
                            {goneThreads?.has(row.threadId) ? (
                              <span className="team-msg__origin is-gone" title="这条会话已被删除（群记录保留）">来源 {shortId(row.threadId)} · 已删除</span>
                            ) : (
                              <button
                                type="button"
                                className="team-msg__origin"
                                title={onOpenThread ? `打开来源会话：${row.threadId}` : `来源会话：${row.threadId}（点一下复制）`}
                                onClick={() => { if (onOpenThread) onOpenThread(row.threadId); else void copyText({ ...row, text: row.threadId }); }}
                              >来源 {shortId(row.threadId)}{onOpenThread ? " ↗" : ""}</button>
                            )}
                          </div>
                        )}
                      </div>
                      </div>
                    </article>
                    </Fragment>
                  );
                })
              )}

              {/* 流式卡（飞书 §2.4）：**同一个 threadId 只更新这一张**，不新建消息。
                  ⛔ 正式消息落盘时这张卡会被撤掉（store 里按 threadId 删），所以不会重复。 */}
              {(live ?? []).map((run) => (
                <article
                  key={`live:${run.threadId}`}
                  className={`team-msg is-bot is-live${run.status === "failed" ? " is-failed" : ""}`}
                  data-live={run.threadId}
                >
                  <MemberAvatar
                    member={faceOfId(run.memberId)}
                    size={28}
                    className="team-msg__avatar has-agent"
                  />
                  <div className="team-msg__main">
                    <div className="team-msg__meta">
                      <strong>{run.name}</strong>
                      <em className="team-msg__role is-live">
                        {run.status === "running" ? "正在写" : run.status === "failed" ? "中断" : "完成"}
                      </em>
                      <time>{fmtTime(run.startedAt)}</time>
                    </div>
                    <div className="team-msg__body">
                    {String(run.text ?? "").trim()
                      ? <div className="markdown"><Markdown>{stripVoiceScript(String(run.text).slice(0, 40000))}</Markdown></div>
                      : <p className="team-msg__thinking">正在思考…</p>}
                    {run.status === "running" && <span className="team-msg__caret" aria-hidden />}
                    {run.error && <p className="team-group__notice is-warn">{run.error}</p>}
                  </div>
                  </div>
                </article>
              ))}
            </div>
            {/* 刻度尺（右侧，不随滚动移动）：每条人发的消息一个刻度，点一下跳过去 */}
            <TeamRuler rows={shownRows} scrollRef={streamRef} containerRef={wrapRef} />
            </div>

            {/* ⛔ 11-07 用户令：「停止放到群成员列表卡片后面」——状态条只留一行文字，
                停止键搬到右侧成员栏底部（那里也是"谁在跑"的名单本身）。 */}
            {/* ⛔ 11-07 用户截图「这一块删了，不要了」：常驻状态条整块移除 ——
                谁在跑看成员行（「· 处理中」+ 该行的「停」），不再常驻一行占位文字。 */}
            {menuMsg && (
              <p className={`team-group__notice is-info${menuMsg.includes("不在了") || menuMsg.includes("不可用") ? " is-warn" : ""}`} role="status">
                {menuMsg}
              </p>
            )}
            {nameError && <p className="team-group__notice" role="status">改名失败：{nameError}</p>}
            {(sendError || notice) && (
              <p className="team-group__notice" role="status">{sendError || notice}</p>
            )}

            <footer className="team-group__composer">
              {/* 11-08 用户令「询问，审批，计划，等等全部跟对话框一样」：伙伴跑起来后的
                  询问卡 / 审批卡**就地弹在输入卡上方**（与主对话 composer-overlay-stack 同定位，
                  盖住状态区而不挤走消息流），能直接回答/拒绝，⛔ 不再只能干等。 */}
              <TeamPendingCards app={app} threadIds={agentThreadIds} />
              {/* @ 候选面板（11-07 用户令）：原来那一整排常驻 chip 收进面板，输入区不再被它占掉一行。 */}
              {mention.open && (
                <TeamMentionPanel
                  anchorRef={mentionAnchorRef}
                  sections={mentionSections}
                  selected={atTargets}
                  query={mention.query}
                  onQuery={(query) => setMention((prev) => ({ ...prev, query }))}
                  onPick={pickCandidate}
                  onClear={() => setAtTargets([])}
                  onClose={closeMention}
                  autoFocus={!mention.typed}
                />
              )}
              {/* 已选 chip 只在**有选择时**出现（面板关掉后仍看得见这一轮派给谁） */}
              {atTargets.length > 0 && (
                <div className="team-group__selected" aria-label="本轮 @">
                  <span className="team-group__selected-label">本轮 @</span>
                  {atTargets.map((id) => (
                    <span key={id} className="team-group__selected-chip">
                      <span className="team-group__selected-avatar has-agent"><MemberAvatar member={faceOfId(id)} size={14} /></span>
                      {nameOf(id)}
                      <button type="button" aria-label={`移除 ${nameOf(id)}`} onClick={() => toggleAt(id)}><X size={10} /></button>
                    </span>
                  ))}
                  <button type="button" className="team-group__selected-clear" onClick={() => setAtTargets([])}>清空</button>
                </div>
              )}
              <TeamComposer
                value={text}
                onValueChange={updateText}
                textareaRef={composerRef}
                onKeyDown={(e) => {
                  /* ⛔ 中文输入法选字时的 Enter 不是"发送"（主对话同口径）：
                     组合期内发走半句话、且清空会被 IME 回滚 ⇒ 输入框看着"没清空"。 */
                  if (e.nativeEvent.isComposing) return;
                  /* 打字触发面板时：Enter / Tab 选第一个候选（⛔ 别把半句话当消息发出去） */
                  if (mention.open && mention.typed) {
                    if (e.key === "Escape") { e.stopPropagation(); closeMention(); return; }
                    if (e.key === "Enter" || e.key === "Tab") {
                      const first = matchMentionCandidates(mentionSections.flatMap((s) => s.items), mention.query, 1)[0];
                      if (first) { e.preventDefault(); pickCandidate(first); return; }
                    }
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={atTargets.length ? `对 ${atTargets.map(nameOf).join("、")} 说…` : "说点什么（@ 选伙伴；/stop 可停）"}
                opts={runOpts}
                onOpts={setRunOpts}
                sending={sending}
                /* 11-08 用户令：运行中发送键过渡成停止键（⏹），点一下把群里所有运行状态停掉。 */
                running={groupRunning}
                stopping={stopping}
                onStop={() => void stopEverything()}
                /* ⛔ `/stop` 是本地指令，不需要 @ 任何人 —— 别把发送键锁死 */
                canSend={Boolean(text.trim() && (atTargets.length || /^\/stop\b/.test(text.trim())))}
                onSend={() => void send()}
                targetNames={atTargets.map(nameOf)}
                fileCandidates={fileCandidates}
                onOpenModelSettings={onOpenModelSettings}
                onOpenMention={() => (mention.open ? closeMention() : openMentionPanel())}
                mentionAnchorRef={mentionAnchorRef}
                mentionCount={atTargets.length}
                /* 飞书 §3：`needShowMenuButton = items.length > 0` —— 空菜单不画按钮。
                   FLOAT 形态下按钮在群视图右下（见文件末尾），这里不重复画。 */
                toolsSlot={!floatMenu ? <TeamMenuButton items={menuItems} disabled={sending} placement="input" onPick={pickMenu} /> : null}
                app={app}
              />
            </footer>
          </div>

          {/* 成员栏（飞书群右侧成员区 / 豆包伙伴档案）：只有群才有这个东西 —— 普通会话没有。 */}
          <aside className="team-group__members" aria-label="群成员">
            {/* ⛔⛔ 11-07 用户（截图圈掉这一块）：「这个删除按键，怎么还在这里…都放成员 @ 前面，
                动态展示，联动调度会话，真停止的」。
                ⇒ 这里**只剩一行「成员 N」**：⛔ 不再有全局「停止运行」大按钮，
                   ⛔ 不要再加回来（三个位置都试过，用户最终口径是"运行态与停止都在每个成员那一行"）。 */}
            <div className="team-group__members-head">
              <span>成员 {group.members.length}</span>
              {/* 11-07 用户：「在这里加一排字，点击头像可以修改」 */}
              <span className="team-group__members-hint">点击头像可以修改</span>
            </div>
            <ul>
              {group.members.map((m) => {
                const running = busy?.includes(m.id);
                const isBot = m.kind === "bot";
                const kids = teamKidsOf(m);
                return (
                  <Fragment key={m.id}>
                  <li className={`team-group__member${m.muted ? " is-muted" : ""}`}>
                    {/* ⛔ 11-07 用户令「加一个群内的成员头像自定义修改功能」：
                        头像本身是入口（点一下换脸）。⛔ 用 button 包一层而不是给 span 加 onClick ——
                        键盘用户也要能到（可达性是硬要求），并且要能拿到它的 rect 做浮层定位。 */}
                    {isBot ? (
                      <button
                        type="button"
                        className="team-group__member-avatar has-agent is-editable"
                        title={`换 ${personNameOf(m)} 的头像`}
                        aria-label={`修改 ${personNameOf(m)} 的头像`}
                        onClick={(event) => {
                          const el = event.currentTarget as HTMLElement;
                          setAvatarTarget({ memberId: m.id, name: personNameOf(m), value: String(m.avatar ?? ""), anchor: el, variant: "agent" });
                        }}
                      >
                        <MemberAvatar member={faceOf(m)} size={22} />
                      </button>
                    ) : (
                      /* ⛔ 11-07 用户：「用户头像就用户中心那几个，不要串其他的」—— 人类成员（群主/用户）
                         也能换脸，但**只给用户中心那 8 张**（variant="user"），智能体面孔不串进来。 */
                      <button
                        type="button"
                        className="team-group__member-avatar is-user is-editable"
                        title={`换 ${personNameOf(m)} 的头像`}
                        aria-label={`修改 ${personNameOf(m)} 的头像`}
                        onClick={(event) => {
                          const el = event.currentTarget as HTMLElement;
                          setAvatarTarget({ memberId: m.id, name: personNameOf(m), value: String(m.avatar ?? ""), anchor: el, variant: "user" });
                        }}
                      >
                        <MemberAvatar member={faceOf(m)} size={22} />
                      </button>
                    )}
                    <span className="team-group__member-main">
                      <strong>{personNameOf(m)}</strong>
                      <small title={`成员 id：${m.id}${m.targetKey ? ` · 目标：${m.targetKind}:${m.targetKey}` : ""}`}>
                        {/* ⛔ 上下级放**最前**：这一行会被省略号截断，放后面就永远看不见（用户要"关系明确"） */}
                        {(() => {
                          /* ⛔⛔ 11-06 用户：「肯定要是主理人➕成员」—— 团这一行**就是主理人本人**
                             （大字已经是承枢），副标题写「团名 · 主理人」+ 人数；
                             ⛔ 别再写「负责人 承枢」（会变成"承枢 / 负责人 承枢"重复一遍）。 */
                          if (teamLeadOf(m)) return `${m.name} · 主理人`;
                          /* 生效上级（没显式设过 ⇒ 群主）：成员栏要看得出层级，⛔ 别只认落盘值 */
                          const up = resolveManagerId(group, m.id);
                          const prefix = up ? `上级 ${group.members.find((x) => x.id === up)?.name ?? up} · ` : "";
                          return prefix;
                        })()}
                        {teamLeadOf(m)
                          /* ⛔ 人数不写在副标题里：成员栏只有 ~200px，「软件开发专家团 · 主理人 4 位成员」
                             实测截断成「…主理人 4 …」⇒ 关键身份被省略号吃掉。人数在下面一行行看得见。 */
                          ? ""
                          : (m.id === group.leadId ? "群主" : (m.targetProfession || (isBot ? "伙伴" : "成员")))}
                        {running ? " · 处理中" : ""}
                        {m.muted ? " · 已静音" : ""}
                      </small>
                    </span>
                    {/* ⛔ 11-07 用户：「每个成员 @ 的前面有运行动态展示吗」⇒ 运行态点 + @ + 停 三件套
                        （顺序固定：状态在 @ 前、停在 @ 后），团成员与伙伴同一份实现。 */}
                    {isBot && (
                      <MemberActions
                        id={m.id}
                        name={personNameOf(m)}
                        running={Boolean(running)}
                        selected={atTargets.includes(m.id)}
                        onToggle={toggleAt}
                        onStop={(id) => void onStopPartner(id).then((r) => { if (!r.ok) setSendError(r.error || "停止失败"); })}
                      />
                    )}
                  </li>
                  {/* ⛔ 团成员列表放在**成员行之后**独占一行：塞进行内会被 flex 主轴压成
                      一个几十像素的小框（用户截图：横向滚动、名字全被裁）。 */}
                  {kids.length > 0 && (
                    <li className="team-group__member-kids-row">
                      <ul className="team-group__member-kids" aria-label={`${m.name} 的成员`}>
                        {kids.map((kid) => {
                          /* ⛔ 11-07 用户令：「团成员拆出来，每个成员都可以艾特」「现在只能艾特主代理会话」。
                             → 每个团成员行都有自己的 @（= 派给这位成员本人，走他自己的会话）。
                             合成 id 与群流里成员发言的作者 id 同构（`team:<teamId>:<memberId>`），
                             所以"谁在跑"「谁说了话」用的是同一个 key。 */
                          const kidId = teamAuthorIdOf(String(m.targetKey ?? ""), teamMemberIdOf(kid));
                          const on = atTargets.includes(kidId);
                          const kidRunning = Boolean(busy?.includes(kidId));
                          return (
                            <li key={kid.key} className={`team-group__member is-kid${kidRunning ? " is-running" : ""}`} title={`${kid.name}${kid.profession ? ` · ${kid.profession}` : ""}`}>
                              {/* 11-07 用户：「专家团下面的成员改不了头像」—— 与伙伴行同一入口：
                                  团成员不在 group.members 里，头像存在群级覆盖表 `group.avatars[kidId]`。 */}
                              <button
                                type="button"
                                className="team-group__member-avatar has-agent is-editable"
                                title={`换 ${kid.name} 的头像`}
                                aria-label={`修改 ${kid.name} 的头像`}
                                onClick={(event) => {
                                  const el = event.currentTarget as HTMLElement;
                                  setAvatarTarget({ memberId: kidId, name: kid.name, value: String(group.avatars?.[kidId] ?? ""), anchor: el, variant: "agent" });
                                }}
                              >
                                <MemberAvatar
                                  member={{ id: kid.key, kind: "bot", name: kid.name, targetKind: "member", targetKey: kid.key, avatar: group.avatars?.[kidId] ?? "" }}
                                  size={22}
                                />
                              </button>
                              <span className="team-group__member-main">
                                <strong>{kid.name}</strong>
                                <small>{kid.profession || "团成员"}</small>
                              </span>
                              {/* 团成员同样三件套：运行态点 → @ → 停（11-07 用户：「每个成员 @ 的前面
                                  有运行动态展示吗」）。合成 id 与群流署名一致，所以"谁在跑"和"他说的"
                                  是同一个 key；停止也走它（store.stopPartner 会翻成调度目标键）。 */}
                              <MemberActions
                                id={kidId}
                                name={kid.name}
                                running={kidRunning}
                                selected={on}
                                onToggle={toggleAt}
                                onStop={(id) => void onStopPartner(id).then((r) => { if (!r.ok) setSendError(r.error || "停止失败"); })}
                              />
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  )}
                  </Fragment>
                );
              })}
            </ul>
            {/* ⛔ 11-07：全局「停止运行」在「成员 N」标题行右侧（停全部）；单成员的「停」挂在
                各自成员行里、@ 之后（仅运行中显示）。这里只留一句 @ 提示。 */}
            <div className="team-group__members-foot">
              <p className="team-group__members-hint">点 @ 把这个人加进这次派活</p>
            </div>
          </aside>
        </div>
      )}

      {/* 伙伴资料卡（11-07 用户令：点头像看身份 / 模型 / 群内统计）。
          ⛔ 独立浮层、独立板块：群视图只负责"点谁"和锚点坐标，内容全在 14- 里。
          ⛔ 成员被移除/换群后 `memberOf` 取空 ⇒ 直接不渲染（别弹一张空卡）。 */}
      {profile && memberOf(profile.memberId) && (
        <TeamProfileCard
          member={memberOf(profile.memberId)!}
          group={group}
          rows={rows}
          catalog={catalog}
          modelName={runOpts.model || getActiveModel().name}
          running={(busy ?? []).includes(profile.memberId)}
          anchor={{ x: profile.x, y: profile.y }}
          onClose={() => setProfile(null)}
          onMention={(id) => { mentionPartner(id); }}
          onStop={(id) => void onStopPartner(id).then((r) => { if (!r.ok) setSendError(r.error || "停止失败"); })}
        />
      )}

      {/* FLOAT 形态的入口（飞书 `FLOAT`）：浮在群视图右下，⛔ 不进输入区。
          ⛔ 群设置里不画 —— 那个页面要编辑的正是它，画上去会挡住保存按钮。 */}
      {floatMenu && !showSettings && (
        <TeamMenuButton items={menuItems} disabled={sending} placement="float" onPick={pickMenu} />
      )}
    </div>
  );
}
