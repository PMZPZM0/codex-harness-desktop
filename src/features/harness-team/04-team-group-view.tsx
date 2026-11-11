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
import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentProps } from "react";
import { ArrowDown, MessagesSquare, Search, Settings2, X, PanelRightClose, PanelRightOpen, PanelRight } from "lucide-react";
import type { GroupMessageRow, TeamFile, TeamGroup } from "./01-team-types";
import type { LiveRun } from "./02-team-store";
import { TeamSettings, TeamViewModeSettings } from "./03-team-settings";
import { stripVoiceScript } from "../../lib/voice-script.mjs";
import { Markdown, MentionScopeContext } from "../markdown";
import type { MentionScope } from "../markdown";
/* 11-07 用户令：正文里的 @ 必须渲染成**真艾特**（带头像 + 用户名），多个按出现顺序逐个出。
   ⛔ 渲染在独立板块 `17-team-mention-text`（口径在纯函数 `team-mention-render.mjs` + 单测）。
   ⛔ 成员行三件套拆到 `18-team-member-actions`（守住 >1000 行棘轮，行为逐字未变）。 */
import { TeamMentionChip, TeamMentionText } from "./17-team-mention-text";
import { linkifyMentions } from "../../lib/team-mention-render.mjs";
import { TeamAvatarPicker } from "./19-team-avatar-picker";
import { buildMentionCandidates, fmtTime, shortId } from "./20-team-view-utils";
import { MemberActions } from "./18-team-member-actions";

import { TeamRuler } from "./07-team-ruler";
import type { MentionAvatar, TeamEditorApi } from "../../lib/team-composer-editor";
import { avatarAsset } from "../../lib/avatar-presets";
import { AGENT_AVATAR_COLS, agentAvatarKindOf, pickAgentAvatar } from "../../lib/agent-avatars.mjs";
import { avatarPresetFace, memberAvatarSrc } from "./13-team-avatar";
import { LiveFileRows } from "../status";
import { getThreadLiveFileChanges, subscribeTurnFileChanges } from "../../lib/turn-file-changes.mjs";
import { usageInputTokens } from "../../lib/usage-input-tokens";
import { usageNumber } from "../../lib/usage-number";
import { usageCachedTokens } from "../../lib/usage-cached-tokens";
import { TeamCards } from "./11-team-cards";
/* ⛔ 11-09 用户令「图二效果一模一样，直接把主对话那一套接过来」：伙伴回复整轮复用 TurnView。 */
import { TeamTurnView } from "./29-team-turn-view";
import { DialogFlowScope } from "../../lib/dialog-flow-mode";
import { TeamSidePanel, type TeamSideTab } from "./28-team-side-panel";
import { openRightFile, subscribeRightFile } from "../../lib/right-file.mjs";
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
/* 11-08 用户令「排队消息 / 插队消息补齐」：卡片复用主对话的 QueuedMessageList，本域只做按成员分组。 */
import { TeamQueueStack, queueTeamMessage } from "./23-team-queue";
/* 11-08 用户令「还有办公室预览接进来」：节点与预览都复用主对话那套（见 24- 文件头注释）。 */
import { TeamOfficeEntry } from "./24-team-office-preview";
/* 11-08 用户令「加一个话题回复模式」：话题条 + 弹窗预览都在独立板块，视图只接线。 */
import { TeamTopicBadge, TeamTopicPreview } from "./25-team-topic";
/* 11-08 用户令「发出去消息就要出效果」：运行反馈挂在用户气泡下面，由 busy 驱动。 */
import { TeamRunFeedback, runningPartnersOf } from "./26-team-run-feedback";
/* ⛔ 11-08 三改：过程折叠块回到成员流式卡里（用户气泡下只在占位模式画窄条）。 */
/* ⛔ 11-09 用户令「把主对话框用户消息下面那一排按键复用过来」：直接用主对话的 MessageFooter
   （引用 / 编辑 / 收藏 / 复制），⛔ 不在群里另写一套按钮。 */
import { MessageFooter } from "../shared/MessageFooter";
import type { ThreadItem } from "../../lib/thread-item";
import { copyTextToClipboard } from "../../lib/clipboard";
import type { TeamRunOpts, TeamRunParams } from "./10-team-composer";
import { buildReplyQuotes, buildTopicThreads, topicThreadOf } from "../../lib/team-fold.mjs";
import { getActiveModel } from "../../lib/active-model.mjs";
import { mergeConsecutive, parseCommand, parseMentions, parseTeamAuthorId, resolveManagerId, teamAuthorIdOf, teamMemberIdOf } from "../../lib/team-models.mjs";
/* 11-07：@ 提及与群内搜索的口径全部在纯函数里（可单测），视图只做接线。 */
import { applyMention, matchMentionCandidates, mentionSectionsOf, mentionTargetsInText, mentionTriggerOf, removeMentionsFromText } from "../../lib/team-mention.mjs";
import { clampEffortToLevels, effortLevelsForModel } from "../../lib/model-specs";
/* 11-07 界面优化：消息流按天分隔（飞书群同款）——连续几十条跨天消息只靠时间看不出"这是哪天"。 */
import { dayKeyOf, dayLabelOf } from "../../lib/team-view.mjs";
/* ⛔ 贴底走统一原语（守卫禁止在时间线里直接把 scrollTop 赋成 scrollHeight ——
   连带注释里出现那个字面量都会被扫到）。群消息流没有主对话那圈「尾部留白」，
   所以目标就是内容底 —— 但写入路径必须同源。 */
import { scrollToOffsetInstant } from "../../components/scroll-utils";
/* ⛔ 11-11 独立板块：异步执行反馈（群聊与外面会话共用同一块；零 IPC、自己订阅事件）。 */
import { AsyncRunPanel } from "../async-run-feedback";
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
  /** 群管理员（11-09）：普通群「没 @ 时由谁接话」；空串 = 取消。 */
  onSetAdmin: (memberId: string) => Promise<{ ok: boolean; error?: string }>;
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
  /** 定时任务（整组替换；nextRunAt 由主进程算） */
  onSaveSchedules: (list: unknown[]) => Promise<{ ok: boolean; error?: string }>;
  /** 立刻运行一条定时任务 */
  onRunSchedule: (scheduleId: string) => Promise<{ ok: boolean; error?: string; sent?: number }>;
  /** 群内成员头像（11-07 用户令「加一个群内的成员头像自定义修改功能」）：只改这个群里的这张脸；空串 = 恢复默认 */
  onSetAvatar?: (memberId: string, avatar: string) => Promise<{ ok: boolean; error?: string }>;
  /** 成员改名（11-09）：主进程落群档案 + 伙伴会话标题，成功后本窗口与其它窗口同步刷新。 */
  onRenameMember?: (memberId: string, name: string) => Promise<{ ok: boolean; error?: string }>;
  /** 群消息排版（11-07）：split = 伙伴靠左 / 用户靠右；left = 全部靠左（主进程落盘） */
  onSetMessageLayout?: (next: "split" | "left") => void;
  /** 停止某个伙伴当前这一回合（`@成员 /stop`、成员栏的停止键） */
  onStopPartner: (memberId: string) => Promise<{ ok: boolean; error?: string; reason?: string }>;
  /** 11-08 用户令「点停止是群里所有运行状态都停止掉」：输入框发送键在运行中变成停止键，
      一点全群停（候选 id 由本视图数出来，通道在 store）。 */
  onStopAll?: (threadIds: string[]) => Promise<{ ok: boolean; error?: string; stopped?: number }>;
  /** 某个成员的候选会话 id（新→旧）：运行中发消息要靠它找到"往哪个会话排队"。 */
  threadsOfMember?: (memberId: string) => string[];
  /** 回复模式（11-08 用户令，群设置里可切）：
   *  · `process`（默认）= 运行时展示运行过程（默认折叠可展开），跑完过程消失只留汇报；
   *  · `placeholder` = 不展示过程，只挂「图标+名字」占位，产出后消息上屏。 */
  replyMode?: "process" | "placeholder";
  onSetReplyMode?: (next: "process" | "placeholder") => void;
  /** 群消息形式（独立选项）：chat 平铺 / topic 收进气泡 */
  messageForm?: "chat" | "topic";
  onSetMessageForm?: (next: "chat" | "topic") => void;
  /** 群对话流（11-09 用户令）：`simple` 运行中过程折叠（默认）/ `detail` 运行中铺开过程。 */
  dialogFlow?: "simple" | "detail";
  onSetDialogFlow?: (next: "simple" | "detail") => void;
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

/** 群消息页脚的 token 用量（11-08 用户令「跟主对话完全一致」）：
 *  与 MessageFooter 同一套取值与文案（入 / 出 / 缓存 + 命中率）。 */
function TeamUsage({ usage }: { usage: { inputTokens: number; outputTokens: number; cachedTokens: number; totalTokens: number } }) {
  const input = usageInputTokens(usage);
  const output = usageNumber(usage, "outputTokens", "output_tokens");
  const cached = Math.min(input, usageCachedTokens(usage));
  if (!input && !output) return null;
  const rate = input > 0 ? Math.round((cached / input) * 100) : null;
  return (
    <span className="team-msg__usage" title="本回合 token 用量（与主对话页脚同口径）">
      {input.toLocaleString()} 入 / {output.toLocaleString()} 出 / 缓存 {cached.toLocaleString()}{rate != null ? ` · 命中 ${rate}%` : ""}
    </span>
  );
}

/** 流式卡里的实时编辑行（11-08 用户令「补实时编辑行，跟主对话一致」）：
 *  与主对话同款 LiveFileRows，按**线程**取（群视图不知道回合 id）。 */
function TeamLiveFiles({ threadId }: { threadId: string }) {
  const files = useSyncExternalStore(subscribeTurnFileChanges, () => getThreadLiveFileChanges(threadId));
  return files.length ? (
    <div className="team-msg__live-files">
      <LiveFileRows files={files as never} />
    </div>
  ) : null;
}

/** 团队群视图：消息流 + 输入区 + 设置入口，按群消息形式（对话/话题）渲染。 */

/** 「回复 xxx：…」引用块（11-09 用户令：「运行中也要出现信息引用，跟结束一样」）。
 *  ⛔ 消息行与运行中的流式卡**共用这一个部件** —— 之前引用只在"已落盘的行"上算，
 *   运行中那张卡（流式卡不在 rows 里）就看不到引用，用户对照截图一眼看出不一致。 */
function TeamQuoteBlock({ quote, nameOf, faceOfId, mentionCandidates, mentionPartner, excludeId }: {
  quote: { authorId: string; text: string };
  nameOf: (id: string) => string;
  faceOfId: (id: string) => ComponentProps<typeof MemberAvatar>["member"];
  mentionCandidates: { id: string; name: string }[];
  mentionPartner: (id: string) => void;
  excludeId: string;
}) {
  return (
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
          excludeId={excludeId}
          className="team-process__quote-body"
        />
      </span>
    </div>
  );
}

/** 工作伙伴 · 群聊视图：消息流 / 运行中的流式卡 / 群设置都在这里（引用块走 TeamQuoteBlock）。
 *  ⛔ 11-09 加部件时把原来的注释挤开了，守卫【295】会盯「导出函数必须有中文文档注释」，别再挪。 */
export function TeamGroupView({
  app, group, rows, issues, busy, notice, limit,
  onAddPartner, onRemovePartner, onMute, onSetManager, onSetAdmin, onSetMemory, onSetWorkspace, onSetFiles,
  onDeleteGroup, onClearMessages, onRename, onSend,
  onAddNote, onRemoveNote, onSaveSchedules, onRunSchedule,
  onStopPartner, onStopAll, threadsOfMember, live, replyMode, messageForm, onOpenModelSettings, onOpenThread, goneThreads, onSetAvatar, onRenameMember, onSetMessageLayout, onSetReplyMode, onSetMessageForm, dialogFlow, onSetDialogFlow,
}: Props) {
  /* ⛔ 11-07 用户令「用户头像还有名字同步出来」：群主 = 当前用户，名字取**同一个**身份 store
     （主对话 `UserMessageView` 也是它）。⛔ 不读群记录里写死的「我」。 */
  const userName = useUserName();
  const [showSettings, setShowSettings] = useState(false);
  /* 11-07 用户令：「群设置里加一个选项，消息左右选项，卡片展示」——
     存进群 JSON（`messageLayout`，主进程落盘）；split = 伙伴靠左 / 用户靠右，left = 全部靠左。 */
  const messageLayout = group.messageLayout ?? "split";
  /* ⛔ 11-08 真机「占位模式选不了」：光靠 props 默认值会永远停在 process。
     群对象才是唯一真相源（落盘），props 只是接线层透传 ⇒ 这里再兜一层。 */
  const effectiveReplyMode = replyMode ?? (group.replyMode === "placeholder" ? "placeholder" : "process");
  /* 群对话流（11-09 用户令）：默认 simple = 运行中过程折叠（点标题展开）；
     detail = 运行中直接把步骤铺开。⛔ 只影响运行中，收尾后的整轮折叠不变。 */
  const effectiveDialogFlow = dialogFlow ?? (group.dialogFlow === "detail" ? "detail" : "simple");
  const effectiveMessageForm = messageForm ?? (group.messageForm === "topic" ? "topic" : "chat");
  /* 正在换头像的成员（11-07）：{ 成员、当前值、点的那个头像元素 } —— 元素用于浮层定位。 */
  const [avatarTarget, setAvatarTarget] = useState<{ memberId: string; name: string; value: string; anchor: HTMLElement; variant: "agent" | "user" } | null>(null);
  /* ⛔ 11-09 用户令「这些文件都打不开 / 侧边栏放右边」：群内统一文件入口 = 右侧栏的文件页。
     汇总卡 / 产物卡 / 过程文件卡 / 正文文件引用都走它（⛔ 不再用居中大弹窗）。 */
  const [sideOpen, setSideOpen] = useState(false);
  const [sideTab, setSideTab] = useState<TeamSideTab>("tree");
  const openFilePreview = (path: string) => {
    if (!path) return;
    setSideTab("tree");
    setSideOpen(true);
    openRightFile(path);
  };
  useEffect(() => subscribeRightFile(({ path }: { path: string }) => {
    if (!path) return;
    setSideTab("tree");
    setSideOpen(true);
  }), []);
  /* 汇总卡的「审查」：审阅数据已写进同一份 store（CompletedChanges 里 setTurnReview），
     这里负责把浮动侧栏开到「审阅」页（⛔ 群里没有 AppView 的常驻右栏）。 */
  const openReviewPanel = () => {
    setSideTab("turn-review");
    setSideOpen(true);
  };
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  /* ⛔⛔ 11-08 用户实测（截图：连按回车出去好几条一模一样的消息）：`sending` 是 React state，
     同一帧内连按两次时它还没翻转 ⇒ 两个 send 并行、各自拿同一段正文发一遍。
     ⇒ 同步 ref 闸门（同一次按键/连按只允许一个 send 在飞），state 只管按钮视觉。 */
  const sendingRef = useRef(false);
  /* 11-08 用户令「点停止是群里所有运行状态都停止掉」：输入框发送键在运行中变成一个停止键，
     一点全群停。`stopping` 只用来锁住那一下（主对话同款：interrupting 期间按钮转圈）。
     ⛔ 停止候选 = `agentThreadIds`（群内出现过的子会话），store 再让主进程按活动回合表核对。
     （处理函数在 agentThreadIds 之后定义，见下方的 stopEverything。） */
  const [stopping, setStopping] = useState(false);
  /* 11-08：刚塞过排队消息的会话（threadId → 成员名）。⛔ 不能只靠 live/rows 推 threadId ——
     派活刚发出去时 live 还是空的、群日志里也还没这条消息，排队卡就会"明明排了却不显示"。 */
  const [queuedThreads, setQueuedThreads] = useState<Record<string, string>>({});
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
  const composerRef = useRef<HTMLDivElement | null>(null);
  /* 行内提及编辑器的命令面（插人 / 外部改值 + 光标；11-08 输入框改为 contenteditable）。 */
  const editorApiRef = useRef<TeamEditorApi | null>(null);
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
  /* ⛔ 11-10 用户令「提升到 100 分」：群内进度要一眼看到，⛔ 别让人靠读消息猜。
     只显示「有任务」的群：没有任务时一个字的占位都不放（用户之前专门要求删掉副标题赘述）。
     ⛔ 11-11：带上 items（未结束的清单）—— 数字点得开才叫「看得到进度」，
        只有数字时用户还得自己翻消息找「还欠谁一件事」。 */
  const [taskProgress, setTaskProgress] = useState<{
    total: number; open: number; done: number; waiting: number;
    items: Array<{ id: string; title: string; toName: string; fromName: string; at: number }>;
  } | null>(null);
  /* ⛔⛔ 11-08 用户：「复用一套主对话框的滚轮和自动滚轮最新消息」——
     与主对话同语义：**只有真实用户输入**（滚轮 / 触摸 / 键盘）能解除跟随；
     滚回底部（或点「回到底部」）立刻恢复跟随；流式增长时跟着最新消息走。
     ⛔ 不用 scroll 事件的阈值当唯一判据 —— 内容变高/浏览器 clamp 都会让 scrollTop 自己动。 */
  const followRef = useRef(true);
  /* ⛔ 11-09 用户令「复用主对话那一套滚轮自动跟随」：与主对话同一套语义 ——
     · 程序滚动（贴底/跟随）有 80ms 抑制窗，不会被自己的 scroll 事件当成"用户滚走了"；
     · 只有**真实用户输入**（滚轮/触摸/键盘）造成的上移才解除跟随；
     · 迟滞：距底 ≤4px 重新跟随，>25% 视口才解除（中间地带保持原状，避免流式增长时反复翻转）。 */
  const selfScrollUntilRef = useRef(0);
  const lastTopRef = useRef(0);
  const lastUserInputAtRef = useRef(0);
  /** 排队中的「贴底」rAF（用户上滚时必须取消，否则滚轮会被这一帧顶回底部）。 */
  const followRafRef = useRef(0);
  const cancelFollowRaf = () => {
    if (followRafRef.current) { cancelAnimationFrame(followRafRef.current); followRafRef.current = 0; }
  };
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const distanceFromBottom = () => {
    const el = streamRef.current;
    return el ? Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight) : 0;
  };
  const stick = () => {
    const el = streamRef.current;
    if (!el) return;
    followRef.current = true;
    setAwayFromBottom(false);
    selfScrollUntilRef.current = Date.now() + 80;
    scrollToOffsetInstant(el, el.scrollHeight);
    lastTopRef.current = el.scrollTop;
  };
  /* 分页（用户 11-06：「滚轮和聊天记录分页咋做的」）：⛔ 不一次把 400 条全画进 DOM ——
     首屏 30 条，滚到顶再往前加载一页，并且**保持滚动位置**（否则一加载就跳到别处）。
     11-08：继续沿用，滚轮向上接近顶部会自动补页（与主对话同口径，⛔ 不靠点按钮）。 */
  const [visibleCount, setVisibleCount] = useState(PAGE);
  const hasMore = rows.length > visibleCount;
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;
  const loadEarlier = () => {
    const el = streamRef.current;
    const prevH = el?.scrollHeight ?? 0;
    const prevTop = el?.scrollTop ?? 0;
    followRef.current = false; // 正在翻历史：⛔ 别让贴底 effect 把人拽回底部
    setAwayFromBottom(true);
    setVisibleCount((v) => Math.min(rows.length, v + PAGE));
    requestAnimationFrame(() => {
      const node = streamRef.current;
      if (node) {
        scrollToOffsetInstant(node, node.scrollHeight - prevH + prevTop);
        lastTopRef.current = node.scrollTop;
      }
      setAwayFromBottom(true);
    });
  };
  const onStreamScroll = () => {
    const el = streamRef.current;
    if (!el) return;
    const dist = distanceFromBottom();
    /* 程序滚动抑制窗：只刷新基线，不做方向判定（否则贴底/跟随会被当成用户滚动）。 */
    if (Date.now() < selfScrollUntilRef.current) { lastTopRef.current = el.scrollTop; return; }
    /* 只有真实用户输入（300ms 内有滚轮/触摸/键盘）造成的**上移**才解除跟随；
       ⛔ 不靠 scrollTop 方向猜意图（主对话 09-12 已证那套不可靠）。 */
    const userRecently = Date.now() - lastUserInputAtRef.current < 300;
    if (userRecently && el.scrollTop < lastTopRef.current - 2) followRef.current = false;
    else if (dist <= 4) followRef.current = true;
    else if (dist > el.clientHeight * 0.25) followRef.current = false;
    setAwayFromBottom(!followRef.current && dist > 8);
    /* 滚到顶再往上 = 加载更早一页（主对话的「滚一屏补一页」同口径） */
    if (el.scrollTop < 36 && hasMoreRef.current) loadEarlier();
    lastTopRef.current = el.scrollTop;
  };
  /* 真实用户输入打点（capture 在 window：刻度尺 / 浮层的 wheel 会 stopPropagation，
     挂 scroller 上收不到；主对话同款教训）。
     ⛔⛔ 11-09 用户实测「滚轮滚不上去了」：只在 onScroll 里按位移解除不够 ——
       上滚那一帧排队中的贴底会把视口顶回底部，下一次位移就"看不出来"。
       ⇒ 滚轮/按键**先解除跟随 + 取消待执行的贴底**，再让 onScroll 做迟滞恢复。 */
  useEffect(() => {
    const el = streamRef.current;
    if (!el) return;
    const detach = () => {
      followRef.current = false;
      setAwayFromBottom(true);
      cancelFollowRaf();
    };
    const onWheel = (event: WheelEvent) => {
      lastUserInputAtRef.current = Date.now();
      if (event.deltaY < 0) detach();
      const before = el.scrollTop;
      requestAnimationFrame(() => {
        const node = streamRef.current;
        if (node && node.scrollTop < before - 2) { selfScrollUntilRef.current = 0; detach(); }
      });
    };
    const onKey = (event: KeyboardEvent) => {
      if (!["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "].includes(event.key)) return;
      lastUserInputAtRef.current = Date.now();
      if (["PageUp", "Home", "ArrowUp"].includes(event.key)) detach();
    };
    const onTouch = () => {
      lastUserInputAtRef.current = Date.now();
      /* 触摸上滑 = 看历史：直接解除跟随（手指方向在 scroll 事件里已经晚了一拍）。 */
      const before = el.scrollTop;
      requestAnimationFrame(() => {
        const node = streamRef.current;
        if (node && node.scrollTop < before - 2) { selfScrollUntilRef.current = 0; detach(); }
      });
    };
    window.addEventListener("wheel", onWheel, { passive: true, capture: true });
    el.addEventListener("touchmove", onTouch, { passive: true });
    el.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("wheel", onWheel, { capture: true } as EventListenerOptions);
      el.removeEventListener("touchmove", onTouch);
      el.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* 自动跟随最新消息（主对话同口径）：**内容真的长高**（流式出字 / 过程折叠新增步骤 /
     折叠展开）时，跟随态就贴回底部；非跟随态只更新「离底部多远」用于按钮。
     ⛔ 11-09 用户实测「群聊没有复用自动跟随」：原来 ResizeObserver 观察的是**滚动容器**
       —— 容器自身尺寸不变，内容再长也不会触发。改为观察容器子树（MutationObserver 覆盖
       正文文字增长与新增节点），外加容器尺寸（窗口/分栏变化）。 */
  useEffect(() => {
    const el = streamRef.current;
    if (!el) return;
    const schedule = () => {
      if (followRafRef.current) return;
      followRafRef.current = requestAnimationFrame(() => {
        followRafRef.current = 0;
        if (followRef.current) stick();
        else setAwayFromBottom(distanceFromBottom() > 8);
      });
    };
    const observer = new MutationObserver(schedule);
    /* ⛔ 只观察**内容**（新增节点 / 文字增长）。不观察 class/style：
       悬停与过渡会高频触发，等于每隔几帧就抢一次滚动位置（用户滚轮会被顶回去）。 */
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    el.addEventListener("transitionend", schedule);
    return () => {
      cancelFollowRaf();
      observer.disconnect();
      ro.disconnect();
      el.removeEventListener("transitionend", schedule);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const partners = useMemo(() => group.members.filter((m) => m.kind === "bot"), [group]);
  /* ⛔ 11-08 用户：「指令按键可以不要了，配套群设置里面也可以删了」——
     「指令」按钮 / 菜单 / 展示形态设置整体下线（群消息直接 @ 伙伴即可）。
     `group.menu` / `menuPlacement` 字段保留在数据层（老档案不迁移、不报错），只是没有入口。 */
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
    (m?.kind === "human" ? (userName || m?.name || "") : (teamLeadOf(m)?.name || m?.name || ""));
  /* ⛔⛔ 11-08 用户令：「专家团的主代理人还是显示他名字吧，显示软件开发专家团看着别扭」——
     团在群里**出面说话的是主理人**（承枢 + 交付总监），显示团名像"一个组织在聊天"。
     ⇒ 显示名回退到主理人名（与 11-06 用户令「肯定要是主理人➕成员」一致）。
     ⛔ 上一轮「正文前面多一个 @软件开发专家团」的**真根因是正文被注入 @名字**，
        已由「正文原样落盘 + 气泡里用提及 chip + 发完清 atTargets」三处彻底修掉；
        与显示名无关 ⇒ 这次改显示名不会让那个 bug 回归（守卫 12be 负向断言钉死）。
     ⛔ 但"这一行到底代表谁"仍要说清：@ 面板 hint 明确写「点它 = 叫整团」，selectId 不变。
     ⛔ 头像仍用主理人的脸（`faceOf`），那是同一个人的招牌。 */

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
       就退回 memberId（⛔ 不编名字，也不把整条消息丢掉）。
       ⛔⛔ 11-11 真机：主理人在目录里是 kind:"expert"（不是 "member"），只查 member 会让主理人的
       消息显示成裸英文 `software-dev-team-lead` —— 右侧成员栏却是「承枢」，用户以为有陌生人乱入。
       ⇒ 主理人也按 expert 反查；另一条路径（作者 id 直接就是 lead.id）在下面末尾兜底。 */
    const teamAuthor = parseTeamAuthorId(id);
    if (teamAuthor) {
      const kid = catalog.find((t) => (t.kind === "member" || t.kind === "expert") && t.teamId === teamAuthor.teamId && (teamMemberIdOf(t) === teamAuthor.memberId || t.key === teamAuthor.memberId));
      return kid?.name || teamAuthor.memberId;
    }
    const m = group.members.find((x) => x.id === id);
    if (m) {
      /* ⛔⛔ 11-11 真机（用户截图原话：「软件开发团是什么鬼东西」）：@ 整团时作者 id 是**群成员槽本身**
         （`tgt:team:<team>`，不是 `team:<team>:<member>` 合成 id），而实际在里面说话的是这个团的**主理人**。
         直接回 `personNameOf(m)` 会让群里冒出一个叫「软件开发专家团」的发言人 —— 用户以为陌生人乱入，
         也分不清是承枢。⇒ 整团槽一律显示主理人的名字（与右侧成员栏那一行同一份数据）。 */
      if (String(m.targetKind ?? "") === "team") {
        const lead = teamLeadOf(m);
        if (lead?.name) return lead.name;
      }
      return personNameOf(m);
    }
    /* ⛔ 团主理人的作者 id 有时就是 lead.id（英文 kebab-case），既不是合成 id 也不在 group.members 里。
       目录里主理人条目：kind "expert" / key "<teamId>:<lead.id>" / memberId = lead.id / name = 中文名。 */
    const leadEntry = catalog.find((t) => t.kind === "expert"
      && (teamMemberIdOf(t) === id || String(t.key ?? "").endsWith(`:${id}`)));
    return leadEntry?.name || id;
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


  /* 伙伴回复正文里写了 `@某人` ⇒ 只做成**可点提及**：点一下把它写进输入框的 @，
     ⛔ 不自动发、不自动派活（11-06：模型写「PPT @星象」这种举例文本也会被误读成指令）。 */
  const mentionPartner = (id: string) => {
    const name = nameOf(id);
    if (!name) return;
    if (!atTargets.includes(id)) insertMentionText(name);
    composerRef.current?.focus();
  };

  /* ⛔ 11-06 用户：「补充文件引用和对话消息引用」——
     引用一条群消息 = 以主对话同款 `> 引文` 前缀放进输入框（发送时模型能读到），
     ⛔ 不新增群日志字段、⛔ 不改投影结构。 */
  /* 以主对话同款 `> 引文` 前缀放进输入框；行/整段文本共用一个实现（TurnView 的页脚给的是文本）。 */
  const quoteText = (text: string) => {
    const quoted = String(text ?? "").trim().split("\n").map((line) => `> ${line}`).join("\n");
    if (!quoted) return;
    setText((prev) => `${prev.trimEnd()}${prev.trim() ? "\n\n" : ""}${quoted}\n\n`);
    requestAnimationFrame(() => composerRef.current?.focus());
  };
  const quoteRow = (row: GroupMessageRow) => quoteText(row.text);

  /* 11-09 用户令「把主对话框用户消息下面那一排按键复用过来」：编辑 = 把这条原文放回输入框
     （群记录不可改写，改完再发就是一条新消息）；⛔ 不覆盖用户已经写了一半的草稿。 */
  const editRow = (row: GroupMessageRow) => {
    const original = String(row.text ?? "").trim();
    if (!original) return;
    setText((prev) => `${prev.trimEnd()}${prev.trim() ? "\n\n" : ""}${original}`);
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  /* ── 11-07 三块（资料卡 / @ 面板 / 群内搜索）──────────────────────────────── */

  /** 点头像弹资料卡（锚点取头像的位置，卡片自己夹到视口内） */
  const openProfile = (event: React.MouseEvent<HTMLElement>, memberId: string) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setProfile({ memberId, x: rect.left, y: rect.bottom + 6 });
  };
  const closeMention = () => setMention({ open: false, query: "", start: 0, caret: 0, typed: false });
  const openMentionPanel = () => setMention({ open: true, query: "", start: 0, caret: 0, typed: false });

  /* 输入框内容变化：顺手判一次 `@` 触发（⛔ 判据只在纯函数里，别在这里写第二套）。
     caret 由编辑器带出（contenteditable 没有 selectionStart）。 */
  const updateText = (next: string, caretText?: number) => {
    setText(next);
    const caret = typeof caretText === "number" ? caretText : next.length;
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

  /* 输入框 chip 的头像：与成员栏 / 消息头**同一套判定**
     （群内预设切片 > 自定义图 > 智能体图集（seed = targetKey）> 人类首字）。
     ⛔ 头像判定只用现有纯函数，别在编辑器里另写一套 kind 映射。 */
  const mentionAvatars = useMemo(() => {
    const map: Record<string, MentionAvatar> = {};
    for (const section of mentionSections) {
      for (const item of section.items) {
        const member = item.avatar as { id?: string; kind?: string; targetKind?: string; targetKey?: string; avatar?: string };
        const raw = String(member?.avatar ?? "");
        const face = raw.startsWith("preset:") ? avatarPresetFace(raw.slice("preset:".length)) : null;
        if (face) {
          map[item.name] = {
            backgroundImage: `url("${avatarAsset(face.file)}")`,
            backgroundSize: `${AGENT_AVATAR_COLS * 100}% ${AGENT_AVATAR_COLS * 100}%`,
            backgroundPosition: `${face.x}% ${face.y}%`,
          };
          continue;
        }
        const custom = memberAvatarSrc(raw);
        if (custom) { map[item.name] = { imgSrc: custom }; continue; }
        if ((member?.kind ?? "bot") === "human") { map[item.name] = { initial: item.name }; continue; }
        const pick = pickAgentAvatar(agentAvatarKindOf(member?.targetKind), member?.targetKey || member?.id || item.selectId);
        map[item.name] = {
          backgroundImage: `url("${avatarAsset(pick.file)}")`,
          backgroundSize: `${AGENT_AVATAR_COLS * 100}% ${AGENT_AVATAR_COLS * 100}%`,
          backgroundPosition: `${pick.x}% ${pick.y}%`,
        };
      }
    }
    return map;
  }, [mentionSections]);

  /* ⛔⛔ 11-08 用户（截图）：「手动输入 @ 选中后，输入框里也有 @、输入框上面也有 @」——
     要求全部收进输入框（发出后就是正文里的行内提及），框上不再展示。
     ⇒ **@ 的唯一真相源 = 正文**：选人只往正文插 `@名字 `，发消息时从正文反查目标，
       框外的「本轮 @」chip 行整块删除（⛔ 不再维护第二份 atTargets 状态）。 */
  const mentionCandidatesFlat = useMemo(
    /* ⛔ 11-08 审查（Required）：专家库条目（`library: true`，还没加入本群）**不能**进候选目标表 ——
       否则手打 `@呈象` 会把它当成已入群目标（`atTargets` 非空、发送键亮起），
       但主进程按群成员解析时找不到它 ⇒ 消息发不出去，还看不出原因。
       库条目只负责「点选时先入群」，入群后自然出现在 bot 分组里。 */
    () => mentionSections.flatMap((section) => section.items
      .filter((item) => !(item as { library?: boolean }).library)
      .map((item) => ({ selectId: item.selectId, name: item.name }))),
    [mentionSections],
  );
  const mentionNames = useMemo(() => mentionCandidatesFlat.map((c) => c.name), [mentionCandidatesFlat]);
  /* ⛔ 11-08 审查确认：quoteRow 会把被引用消息写成  行塞进正文，而 mentionTargetsInText
     扫全文 ⇒ 引用一条写着「@构梁」的消息再发送，会**静默派活给构梁**。
     ⇒ 派活目标只从「非引用行」里取（引用是上下文，不是指令）。 */
  const atTargets = useMemo(
    () => mentionTargetsInText(text.replace(/^[ 	]*>.*$/gm, ""), mentionCandidatesFlat),
    [text, mentionCandidatesFlat],
  );

  /** 把 `@名字 ` 插到当前光标处（面板多选 / 成员行 @ 共用；⛔ 不再维护框外 chip）。 */
  const insertMentionText = (name: string) => {
    editorApiRef.current?.insertMention(name);
  };

  /** 成员行 / 面板再点一次 = 取消这个人的 @（从正文里摘掉完整提及）。 */
  const toggleAt = (id: string) => {
    const name = nameOf(id);
    if (!name) return;
    if (atTargets.includes(id)) setText((prev) => removeMentionsFromText(prev, [name]));
    else insertMentionText(name);
  };

  const pickCandidate = async (item: { selectId: string; name: string; role?: string; library?: boolean }) => {
    /* ⛔ 11-08 用户（截图）：「内置的专家都不显示；不管什么时候都要能直接调用」——
       专家库里没加过群的专家：点选时**先加入本群**（与设置页「添加伙伴」同一份载荷），
       成功后再把 `@名字 ` 写进正文。⛔ 加入失败（例如已满员）就说清原因，不静默。 */
    if (item.library) {
      /* ⛔ 先按**点击时**的正文算出替换结果并关面板，再 await 入群 ——
         否则 IPC 往返期间用户继续打字 / 连点，会拿旧正文覆盖新输入、或重复加同一个人。 */
      const applied = mention.typed
        ? applyMention(text, { start: mention.start, caret: mention.caret }, item.name)
        : null;
      closeMention();
      const added = await onAddPartner({
        id: `tgt:expert:${item.selectId}`,
        kind: "bot",
        name: item.name,
        targetKind: "expert",
        targetKey: item.selectId,
        targetProfession: item.role ?? "",
      }).catch((err) => ({ ok: false, error: String(err) }));
      if (!added?.ok) {
        flashMenuMsg(added?.error || `没法把 ${item.name} 加入本群`);
        return;
      }
      flashMenuMsg(`已把 ${item.name} 加入本群`);
      if (applied) editorApiRef.current?.setTextAndCaret(applied.text, applied.caret);
      else insertMentionText(item.name);
      return;
    }
    if (mention.typed) {
      /* 打字触发：把 `@查询词` 换成 `@名字 `（目标身份稍后从正文反查） */
      /* ⛔ 传 caret：只替换用户输入的那几个字，⛔ 不碰后面已经写好的正文。 */
      const applied = applyMention(text, { start: mention.start, caret: mention.caret }, item.name);
      closeMention();
      editorApiRef.current?.setTextAndCaret(applied.text, applied.caret);
      return;
    }
    /* 按钮打开 = 多选面板：点一下切换「插 / 摘正文里的 @名字」，面板不关（飞书同款） */
    if (atTargets.includes(item.selectId)) setText((prev) => removeMentionsFromText(prev, [item.name]));
    else insertMentionText(item.name);
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
      followRef.current = false; // 正在看历史：⛔ 别被贴底 effect 拽回底部
      setAwayFromBottom(true);
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
    const bad = results.find((r) => !r.ok && r.reason !== "idle" && r.reason !== "starting");
    if (bad) return { ok: false, error: bad.error || "停止失败" };
    return { ok: true };
  };

  /* ⛔ 11-07 用户（截图圈掉那块）：「这个删除按键，怎么还在这里…都放成员 @ 前面，动态展示，
     联动调度会话，真停止的」。⇒ 全局「停止运行」整块删除（连同 stopAll / stopping 状态）：
     运行态与停止都收到**每个成员那一行**（状态点在 @ 前、停在 @ 后，见 MemberActions）。
     ⛔ 别再以「万一没人在跑怎么办」为理由加回全局键 —— 用户已经否掉两次。 */

  /** 发完清空草稿。⛔ override（话题弹窗）不发话时**不许动**主输入框 —— 那里面是用户自己的草稿。 */
  const clearComposer = (isOverride: boolean) => {
    if (isOverride) return;
    setText("");
    /* 偏好保留，一次性附件发完即清（与主对话"本轮附件"同语义） */
    setRunOpts((prev) => ({ ...prev, skills: [], files: [] }));
  };

  /** 派活。`override` 由**话题弹窗**使用（11-09 用户：「话题展示那个，没有在话题中沟通的功能啊」）——
   *  它自带正文与目标，⛔ 不读也不清主输入框（否则用户在弹窗里发一句，草稿区被打字内容洗掉）。 */
  const send = async (override?: { body: string; targets: string[]; /** 话题内派活：话题起点原文（只进 prompt）。 */ topicRoot?: string }) => {
    const body = (override?.body ?? text).trim();
    if (!body) return;
    /* 目标：正常发送 = 正文里 @ 到的人；话题弹窗 = 调用方给的（话题发起人 / 最后回复的伙伴）。 */
    const targets = override?.targets ?? atTargets;
    /* ⛔ 11-08：派活是**等整个回合**才返回的（sending 会一直为 true），所以群里有伙伴在跑时
       不能拿 sending 把输入挡死 —— 那条路是"进队列"，不是重复派活。 */
    if (sending && !groupRunning) return { ok: false, error: "上一条还在发送中，稍等一下" };
    /* ⛔ 同步闸门：连按回车时第二个 send 在第一个 await 之前就进来了（state 还没翻转）。 */
    if (sendingRef.current) return { ok: false, error: "上一条还在发送中，稍等一下" };
    sendingRef.current = true;
    setSendError("");
    setMenuMsg("");
    /* ⛔ 11-09 用户令：「发消息不管滚轮在哪/在看历史，都要第一时间回到最新」——
       发送即强制恢复跟随并贴底（不等 rows effect，避免用户正翻历史时新消息上屏却停在上面）。 */
    cancelFollowRaf();
    followRef.current = true;
    stick();

    /* ⛔ 命令优先：`/stop` 是**本地动作**，不能被当成一句话派给模型 */
    const cmd = parseCommand(body);
    if (cmd?.name === "stop") {
      setSending(true);
      try {
        const r = await runStop(cmd.rest);
        if (!r.ok) { setSendError(r.error ?? "停止失败"); return { ok: false, error: r.error ?? "停止失败" }; }
        clearComposer(Boolean(override));
        flashMenuMsg("已停止 —— 它这一回合的中断请求已发给引擎");
        return { ok: true };
      } finally {
        setSending(false);
        sendingRef.current = false;
      }
      return { ok: false, error: "停止失败" };
    }
    if (cmd) { setSendError(`不认识的命令：/${cmd.name}（目前只支持 /stop）`); sendingRef.current = false; return { ok: false, error: `不认识的命令：/${cmd.name}` }; }

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
      /* ⛔ 与主对话同一条口径（11-08 审查）：按**实际要跑的模型**把旧档夹到可用档，
         否则界面显示三档、背后仍按切模型前的旧档发。 */
      effort: clampEffortToLevels(runOpts.effort, effortLevelsForModel(effectiveModel)),
      sandbox: runOpts.sandbox,
      approvalPolicy: runOpts.approvalPolicy,
      /* ⛔ 话题内派活：告诉主进程这条来自某个话题 ⇒ prompt 里会明说「你在话题里」。 */
      ...(override?.topicRoot ? { topicRoot: override.topicRoot } : {}),
    };
    setSending(true);
    try {
      /* 11-08 用户令「排队消息 / 插队消息补齐」：
         正在跑的伙伴**不能**再走派活（那是 turn/start，会打断它正在跑的回合，主进程直接拒）
         ⇒ 这类目标的正文塞进它自己的引擎队列，回合结束由引擎接着做；空闲的仍走派活。 */
      /* ⛔ 运行态以**主进程登记表**为准（`harness-team:running`）：派活刚发出去时渲染层的
         live 还是空的（那要等 `delegate-run started`），拿 live 判会把"正在跑"的伙伴放去派活，
         然后被主进程以「该会话仍有任务在运行」拒掉。live 只作为取不到时的兜底。 */
      /* ⛔ 运行判定用 store 的 busy 名单（派活一发出就有，且跨窗口可靠）+
         `threadsOfMember` 拿"往哪个会话排"；主进程登记表只当补充（它按目标键匹配，名字对不上时会空）。
         ⛔ 不要只看 live：在独立窗口里 live 要等 `delegate-run` 事件，往往迟迟是空的。 */
      const busyIds = new Set(busy ?? []);
      const runningRuns: Array<{ memberId: string; name: string; threadId: string }> = [];
      const pushRun = (memberId: string, name: string, threadId: string) => {
        if (!memberId || !threadId) return;
        if (runningRuns.some((run) => run.memberId === memberId)) return;
        runningRuns.push({ memberId, name, threadId });
      };
      if (groupRunning) {
        const res = (await window.codex.harnessTeamRunning(group.id)) as { runs?: Array<{ memberId?: unknown; name?: unknown; threadId?: unknown }> } | null;
        for (const run of res?.runs ?? []) pushRun(String(run?.memberId ?? ""), String(run?.name ?? ""), String(run?.threadId ?? ""));
        for (const run of live ?? []) if (run.status === "running") pushRun(run.memberId, run.name, run.threadId);
        for (const memberId of busyIds) pushRun(memberId, nameOf(memberId), threadsOfMember?.(memberId)?.[0] ?? "");
      }
      const runningTargets = targets
        .map((id) => ({ id, run: runningRuns.find((run) => run.memberId === id) }))
        .filter((entry): entry is { id: string; run: { memberId: string; name: string; threadId: string } } => Boolean(entry.run?.threadId));
      const idleTargets = targets.filter((id) => !runningTargets.some((entry) => entry.id === id));
      const queued: string[] = [];
      for (const entry of runningTargets) {
        const res = await queueTeamMessage(entry.run.threadId, fullBody);
        if (res.ok) {
          queued.push(entry.run.name);
          setQueuedThreads((prev) => (prev[entry.run.threadId] ? prev : { ...prev, [entry.run.threadId]: entry.run.name }));
        }
        else setSendError(res.error || "排队失败");
      }
      if (!idleTargets.length) {
        if (queued.length) {
          clearComposer(Boolean(override));
          flashMenuMsg(`已排进 ${queued.join("、")} 的队列（它跑完这一轮就接着做；点「立即」可插队）`);
          return { ok: true };
        }
        /* ⛔⛔ 11-09 用户令「无需 @ 成员时可直接发消息」——
           原来这里**直接 return { ok: true }**：没 @ 任何人 ⇒ targets 是空数组 ⇒ 什么都不发，
           用户按了回车却毫无反应（连报错都没有）。⇒ 空目标必须继续往下交给主进程，
           由它按「上下文 → 团主理人 / 群管理员」挑收件人；⛔ 别再在这里吞掉。 */
      }
      const r = await onSend?.(idleTargets, fullBody, params);
      if (r && !r.ok) {
        setSendError(r.error || "派活失败");
        return { ok: false, error: r.error || "派活失败" }; // ⛔ 失败保留原文，别把用户打的字清掉
      }
      if (queued.length) flashMenuMsg(`已排进 ${queued.join("、")} 的队列（它们还在跑）`);
      clearComposer(Boolean(override));
    } catch (err) {
      /* 派活通道异常：把错误说出来，⛔ 原文留着别丢（用户打的字比一次失败值钱） */
      setSendError(`派活失败：${err instanceof Error ? err.message : String(err)}`);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
    return { ok: true };
  };

  /* 卡片的三个动作（飞书 ActionType 的等价物，⛔ 都是真动作，没有装饰按钮）：
     复制 = client_message（纯本地）｜追问 = action_request（把它 @ 上再发一轮）｜来源 = open_url（回原子会话）
     ⛔⛔ 11-09 用户实测「复制功能没用」：这里原来直接调 `navigator.clipboard.writeText` ——
     file:// 下的独立窗口会静默拒绝（还被我 `.catch` 吞掉）⇒ 必须走主对话同一个三级兜底
     （主进程 IPC → navigator.clipboard → execCommand），口径在 lib/clipboard。 */
  const copyText = async (row: GroupMessageRow) => {
    try {
      await copyTextToClipboard(String(row.text ?? ""));
      setCopied(row.key);
      window.setTimeout(() => setCopied((cur) => (cur === row.key ? "" : cur)), 1200);
    } catch { /* 剪贴板被拒：静默（不让一个复制失败打断阅读） */ }
  };

  const askAgain = (row: GroupMessageRow) => {
    /* 团成员的消息：@ 回**他本人**（合成 id），与成员栏那个 @ 同一口径 ——
       dispatch 会把 `team:<teamId>:<memberId>` 翻成 kind:"member" 派给他自己的会话。 */
    const teamAuthor = parseTeamAuthorId(row.authorId);
    const targetId = teamAuthor ? row.authorId : (row.via?.memberId ?? row.authorId);
    const name = nameOf(targetId);
    if (name && !atTargets.includes(targetId)) insertMentionText(name);
    composerRef.current?.focus();
  };

  const shownRows = useMemo(
    () => (rows.length > visibleCount ? rows.slice(rows.length - visibleCount) : rows),
    [rows, visibleCount],
  );
  /* 进度随消息变化刷新（成员回了 ⇒ 任务关闭 ⇒ 数字要变）。⛔ 失败就保持上一次，不把界面打成 0。 */
  useEffect(() => {
    let alive = true;
    const gid = String(group?.id ?? "");
    if (!gid) { setTaskProgress(null); return () => { alive = false; }; }
    /* ⛔ 用生成好的类型（vite-env.d.ts 有声明），⛔ 别用 as any 绕过去 —— 那样改了通道名编译也不报。 */
    void window.codex?.harnessTeamGroupProgress?.(gid)
      .then((r: { ok?: boolean; total?: number; open?: number; done?: number; waiting?: number; items?: Array<{ id: string; title: string; toName: string; fromName: string; at: number }> } | null) => {
        if (!alive || !r?.ok) return;
        setTaskProgress({
          total: Number(r.total ?? 0), open: Number(r.open ?? 0), done: Number(r.done ?? 0),
          waiting: Number(r.waiting ?? 0), items: Array.isArray(r.items) ? r.items : [],
        });
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [group?.id, rows.length]);

  const liveLen = (live ?? []).map((r) => `${r.threadId}:${String(r.text ?? "").length}`).join("|");

  /* ⛔⛔ 11-10 用户报「每个会话结束时群对话框短暂闪烁」的根因：
     store 里 run 完成时**先** appendMessage（正式消息立刻出现），**再** setTimeout 300ms 才删流式卡。
     这 300ms 里同一个回合有两张卡（live + 正式），随后 live 消失 —— 视觉上"多一块再少一块"，
     就是那下闪。修法 = 渲染层做**同帧替换**：该会话已经有正式消息落进来（at ≥ 这一轮开始），
     就立刻不渲染这张 live 卡，不再等 store 的 300ms。
     ⛔ 判据用 startedAt 而不是 runId：同一个 threadId 会有多轮，跑第二轮时上一轮的正式消息
        不该把新卡顶掉。 */
  const persistedThreadAt = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      const threadId = String(row.threadId ?? "");
      if (!threadId) continue;
      const at = Number(row.at ?? 0);
      if (!map.has(threadId) || at > (map.get(threadId) ?? 0)) map.set(threadId, at);
    }
    return map;
  }, [rows]);
  const liveVisible = useMemo(
    () => (live ?? []).filter((run) => {
      const lastAt = persistedThreadAt.get(String(run.threadId ?? ""));
      if (lastAt == null) return true;
      return Number(run.startedAt ?? 0) > lastAt;   // 正式消息还没覆盖这一轮 ⇒ 继续显示
    }),
    [live, liveLen, persistedThreadAt],
  );

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

  /* 排队消息按成员分组：threadId → 成员名（正在跑的 ∪ 群消息来源；与卡片归属同一口径）。 */
  const queueThreads = useMemo(() => {
    const map = new Map<string, string>();
    for (const run of live ?? []) if (run.threadId && run.status === "running") map.set(run.threadId, run.name);
    for (const row of rows) {
      if (!row.threadId || row.threadId.startsWith("group:") || map.has(row.threadId)) continue;
      map.set(row.threadId, nameOf(row.authorId));
    }
    for (const memberId of busy ?? []) {
      const threadId = threadsOfMember?.(memberId)?.[0];
      if (threadId && !map.has(threadId)) map.set(threadId, nameOf(memberId));
    }
    for (const [threadId, name] of Object.entries(queuedThreads)) if (!map.has(threadId)) map.set(threadId, name);
    return [...map].map(([threadId, name]) => ({ threadId, name }));
  }, [live, liveLen, rows, nameOf, queuedThreads, busy, threadsOfMember]);

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
      else flashMenuMsg(res.stopped ? `已停止群里 ${res.stopped} 个正在跑的伙伴` : "当前没有在跑的伙伴（状态已复位）");
    } finally {
      setStopping(false);
    }
  };

  /* 换群 ⇒ 无条件贴底；消息或流式有变化 ⇒ 只在原本跟随最新时贴底 */
  useEffect(() => {
    followRef.current = true;
    setVisibleCount(PAGE);
    stick();
    /* ⛔ 11-09 用户：「进来没在最下面、留了一点空间」——首帧 stick 时图片/卡片/Markdown 还没
       撑高，scrollHeight 偏小 ⇒ 布局完成后再补两次贴底，确保滚轮真正到底。 */
    const raf = requestAnimationFrame(() => stick());
    const t = window.setTimeout(() => stick(), 120);
    /* 换群：上一个群的话题弹窗不能留着（否则内容会串到新群） */
    setTopicOpenKey(null);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(t); };
  }, [group.id]);
  useEffect(() => { if (followRef.current) stick(); }, [rows.length, liveLen]);

  /* ⛔⛔ 11-09 用户：「每次从群设置返回，这个滚轮都在最上面」。
     因为设置页与消息流是**互斥渲染**（`showSettings ? 设置 : 消息流`）⇒ 返回时消息流是**重新挂载**的，
     滚动位置从 0 开始；而下面那条贴底 effect 只在 `followRef.current` 为真时才动，
     首挂载时它还没被置真 ⇒ 停在了顶部。
     ⇒ 从设置返回后主动贴底一次（用户此刻一定是在看最新几条）。 */
  useEffect(() => {
    if (showSettings) return;
    followRef.current = true;
    requestAnimationFrame(() => stick());
  }, [showSettings]);

  /* ⛔⛔ 11-09 用户令「一个回合只出一条消息，跟主对话一样」：老群记录里同一位成员一轮会留下
     好几条"步骤"消息（11-08 的逐条落盘）。渲染时按**回合**收口：同一 threadId + 同一 runId
     （或两边都没有 runId、同作者且间隔 ≤5 分钟）只渲染最后一条 —— 只动渲染，⛔ 不删群记录。 */
  const runCollapsedRows = useMemo(() => {
    const drop = new Set<string>();
    for (let i = 0; i < shownRows.length - 1; i += 1) {
      const a = shownRows[i];
      const b = shownRows[i + 1];
      if (a.authorKind !== "bot" || b.authorKind !== "bot") continue;
      if (a.threadId !== b.threadId || a.authorId !== b.authorId) continue;
      const sameRun = a.runId && b.runId
        ? a.runId === b.runId
        : (!a.runId && !b.runId && Number(b.at) - Number(a.at) <= 5 * 60_000);
      if (sameRun) drop.add(a.key);
    }
    return drop.size ? shownRows.filter((row) => !drop.has(row.key)) : shownRows;
  }, [shownRows]);
  /* ⛔ 同一作者、短间隔的连续消息并成一条（用户：「别框框刷屏」）。
     只影响渲染分组，`continued` 里仍是独立消息（各自 itemId 可溯源）。 */
  const displayRows = useMemo(() => mergeConsecutive(runCollapsedRows), [runCollapsedRows]);
  /* ⛔⛔ 11-09 用户（飞书对照）：「话题就是迷你群聊……后续的消息都在话题里面更新，
     而不是在群里更新」。⇒ 在话题里接着说了一句，那条**不能再在群里显示成一条独立消息**
     （否则主列表多一条孤零零的用户气泡、话题条也不在它下面，看着就像跑到群里去了）。
     判据与分组同源：`buildTopicThreads` 把它并进了某个话题的 replies ⇒ 主列表就收起它。
     ⛔ 只在话题模式生效；聊天模式一行不受影响。 */
  const topicHiddenKeys = useMemo(() => {
    if (effectiveMessageForm !== "topic") return new Set<string>();
    const hidden = new Set<string>();
    for (const thread of buildTopicThreads(displayRows).values()) {
      for (const reply of thread.replies) if (reply.authorKind !== "bot") hidden.add(reply.key);
    }
    return hidden;
  }, [displayRows, effectiveMessageForm]);
  /** 主列表真正渲染的行（话题内追问已收起）。⛔ 其余派生量（运行态、贴底）仍用 displayRows。 */
  const listRows = useMemo(
    () => (topicHiddenKeys.size ? displayRows.filter((r) => !topicHiddenKeys.has(r.key)) : displayRows),
    [displayRows, topicHiddenKeys],
  );
  /* ⛔⛔ 11-09 用户：「成员之间相互艾特也要有我艾特他们一样得效果」。
     伙伴正文由**主对话 TurnView 的 Markdown** 画，那里不认识群成员 ⇒ `@观澜：收到…` 只是纯文字。
     ⇒ 在这里给整条消息流提供「提及渲染作用域」，TurnView / ItemView 一行都不用改。
     ⛔ 依赖用**成员签名串**（而不是回调引用）：回调每次 render 都会新建，用它当依赖会让
        作用域每帧都换、Markdown 的 memo 全部失效（长会话/流式会卡）。
     ⛔ 真正的回调从 ref 里取最新值，签名串只在成员改名/增删时才变。 */
  const mentionKey = useMemo(
    () => mentionCandidates.map((c) => `${c.id}:${c.name}`).join("|"),
    [mentionCandidates],
  );
  const mentionCtxRef = useRef({ candidates: mentionCandidates, nameOf, faceOfId, mentionPartner });
  mentionCtxRef.current = { candidates: mentionCandidates, nameOf, faceOfId, mentionPartner };
  const mentionScope = useMemo<MentionScope>(() => ({
    linkify: (text: string) => linkifyMentions(text, mentionCtxRef.current.candidates, {}),
    render: (id: string, fallbackName: string) => {
      const ctx = mentionCtxRef.current;
      return (
        <TeamMentionChip
          id={id}
          name={ctx.nameOf(id) || fallbackName}
          faceOfId={ctx.faceOfId}
          onPick={ctx.mentionPartner}
        />
      );
    },
    // ⛔ 不把回调列进依赖：见上（它们每次 render 都是新引用）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [mentionKey]);
  /* ⛔ 11-09 用户截图（两枚「处理中」）：同一位成员的历史正文也被标成处理中，看着像两轮一起跑。
     只标**当前轮最后一条**（同一 threadId+runId 的末条），历史正文不再挂状态。 */
  const activeRunKeys = useMemo(() => {
    const keys = new Set<string>();
    const seen = new Set<string>();
    for (let i = displayRows.length - 1; i >= 0; i -= 1) {
      const r = displayRows[i];
      if (r.authorKind !== "bot" || !r.runId) continue;
      const runKey = `${r.threadId}|${r.runId}`;
      if (seen.has(runKey)) continue;
      seen.add(runKey);
      if ((live ?? []).some((run) => run.threadId === r.threadId && run.status === "running" && run.runId === r.runId)) keys.add(r.key);
    }
    return keys;
  }, [displayRows, live]);
  /* ⛔⛔ 11-08 真机「过程模式和占位模式完全一样没有区别」：两种模式的 JSX 原先都挂在
     `live` 流式卡里，而独立窗口里 live 常年为空 ⇒ 发完消息什么都不出现。
     ⇒ 反馈改挂到**最后一条用户消息气泡下面**（用户要的位置），由 busy 名单驱动。
     ⛔ 只挂最后一条：历史消息不该跟着显示"处理中"。跑完 busy 清空 ⇒ 自动消失。 */
  const lastHumanKey = useMemo(() => {
    for (let i = displayRows.length - 1; i >= 0; i -= 1) {
      if (displayRows[i].authorKind !== "bot") return displayRows[i].key;
    }
    return null;
  }, [displayRows]);
  /* ⛔⛔ 11-09 用户实测（截图：一次派活的**每一步**下面都挂着「已更改 2 个文件」）：
     收尾卡原判据是 `summary || !runId` —— CLI 伙伴的消息常常没有 runId ⇒ 每条都画。
     用户口径：「汇总消息下面展示这个卡片就行」。⇒ 只认**一轮的末条**：
     同一作者、相邻、且（同一 runId，或双方都没 runId 且间隔 ≤5 分钟）的连续 bot 行算一轮。
     ⛔ 折叠与汇总卡都挂这条（同一条消息 = 这一轮的收尾位）。 */
  const runTailKeys = useMemo(() => {
    const tails = new Set<string>();
    for (let i = 0; i < displayRows.length; i += 1) {
      const row = displayRows[i];
      if (row.authorKind !== "bot") continue;
      const next = displayRows[i + 1];
      const sameRun = Boolean(next)
        && next.authorKind === "bot"
        && next.authorId === row.authorId
        && (!row.runId || !next.runId || row.runId === next.runId)
        && Number(next.at) - Number(row.at) <= 5 * 60_000;
      if (!sameRun) tails.add(row.key);
    }
    return tails;
  }, [displayRows]);
  const runningPartners = useMemo(
    () => runningPartnersOf(busy ?? [], nameOf, live ?? []),
    /* ⛔ 群消息形式与回复模式正交：话题模式下也要有运行反馈，别把用户晾着 */
    [busy, live, nameOf],
  );

  /* 引用索引用**全量 rows**（不是分页后的 shownRows）：翻到更早的一页时，
     上一条人类消息可能在被截掉的那一段里，⛔ 不能因此把引用丢成空白。 */
  const quotes = useMemo(() => buildReplyQuotes(rows), [rows]);
  /* ⛔ 11-08 用户令：话题消息模式 —— 伙伴回复收进用户气泡，点开弹窗预览。
     ⛔ 用**全量 rows** 分组（同 quotes）：分页翻页后话题内容不能跟着少一半。
     ⛔ 纯函数分组，不在这里写循环（口径在 team-fold.mjs + 单测）。 */
  const topicThreads = useMemo(() => buildTopicThreads(rows), [rows]);
  const [topicOpenKey, setTopicOpenKey] = useState<string | null>(null);
  const openTopicRow = topicOpenKey ? listRows.find((r) => r.key === topicOpenKey) : undefined;
  const openTopic = openTopicRow ? topicThreadOf(topicThreads, openTopicRow) : undefined;

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
      if (!followRef.current) return;
      requestAnimationFrame(() => { if (followRef.current) stick(); });
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
      {/* ⛔ 11-08 审查确认：推理浮窗宿主必须挂在这里（TeamGroupView 根）——
          设置→团队 的 TeamModePanel 直接渲染本组件、没有 TeamChatOverlay，宿主原来只在 overlay 里，
          那种场景浮窗会回落 body（层级被设置弹窗压住）。 */}
      <div className="reasoning-float-host team-reasoning-float-host" aria-hidden />
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
                {taskProgress && taskProgress.total > 0 ? (
                  taskProgress.open > 0 ? (
                    /* ⛔ 11-11：有未结束任务时是**可展开**的（details 原生开关，不额外占 state）；
                       open=0 时不渲染 details —— 点了什么都不发生比不能点更糟。 */
                    <details className="team-tasks">
                      <summary
                        className="team-group__progress is-open"
                        title={`群内点名交接：共 ${taskProgress.total} 条，已回话 ${taskProgress.done} 条，未结束 ${taskProgress.open} 条${taskProgress.waiting ? `，其中 ${taskProgress.waiting} 条还在等人回话` : ""}。这是「谁被点名、谁回过了」的交接台账，不是专家团 SOP 的阶段进度（点开看清单）`}
                      >
                        交接 {taskProgress.done}/{taskProgress.total}
                        {taskProgress.waiting > 0 ? ` · 等 ${taskProgress.waiting} 人` : ""}
                      </summary>
                      <div className="team-tasks__pop" role="group" aria-label="未结束的任务">
                        <p className="team-tasks__head">
                          未结束 {taskProgress.open} 条{taskProgress.waiting > 0 ? ` · 等 ${taskProgress.waiting} 人回话` : ""}
                        </p>
                        <ul>
                          {taskProgress.items.map((it) => (
                            <li key={it.id}>
                              <span className="team-tasks__title">{it.title}</span>
                              <span className="team-tasks__meta">
                                {it.fromName} 派给 {it.toName} · {new Date(it.at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </li>
                          ))}
                        </ul>
                        {taskProgress.open > taskProgress.items.length ? (
                          <p className="team-tasks__more">另有 {taskProgress.open - taskProgress.items.length} 条更早的未列出</p>
                        ) : null}
                      </div>
                    </details>
                  ) : (
                    <span
                      className="team-group__progress is-done"
                      title={`群内点名交接：共 ${taskProgress.total} 条，全部已回话。这只是点名交接结束，不代表专家团 SOP 各阶段已交付`}
                    >
                      交接 {taskProgress.done}/{taskProgress.total}
                    </span>
                  )
                ) : null}
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
            {/* ⛔ 11-08 用户（截图）：「把我框住的文字赘述删了」——
                群头副标题「N 位成员 · M 个伙伴 · 项目 …」整条删除
                （人数看右侧成员栏、项目名看顶栏，这里重复三遍）。 */}
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
          {/* ⛔ 11-08 用户（截图）：「把办公室预览图标放到设置按键这一排的展开折叠左边」——
              从成员栏末位挪到群头操作区，落在「收起/展开成员栏」键的左边。 */}
          <TeamOfficeEntry group={group} live={live} busy={busy} onOpenThread={onOpenThread} />
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
          {/* ⛔ 11-09 用户令：「在展开折叠右边加一个侧栏浮窗按键」——右侧栏开关紧跟成员栏开合键。 */}
          {app && (
            <button type="button" className={`team-group__icon-btn${sideOpen ? " is-on" : ""}`} onClick={() => setSideOpen((v) => !v)} title="右侧栏：变更 / 审阅 / 浏览器 / 文件" aria-expanded={sideOpen}>
              <PanelRight size={14} /> <span>侧栏</span>
            </button>
          )}
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
        /* ⛔ 11-08 用户实测「群设置几个切换切起来很卡」：三个视图开关放在**外层**（点一次只
           重渲染这一小块），其余 6 个区块走 memo（属性没变就不重排）。滚动容器仍在这一层。 */
        <div className="team-settings">
          <TeamViewModeSettings
            messageLayout={messageLayout}
            onMessageLayout={(next) => onSetMessageLayout?.(next)}
            replyMode={effectiveReplyMode}
            onReplyMode={(next) => onSetReplyMode?.(next)}
            messageForm={effectiveMessageForm}
            onMessageForm={(next) => onSetMessageForm?.(next)}
            dialogFlow={effectiveDialogFlow}
            onDialogFlow={(next) => onSetDialogFlow?.(next)}
          />
          <TeamSettings
            group={group}
            issues={issues}
            limit={limit}
            onAddPartner={onAddPartner}
            onRemovePartner={onRemovePartner}
            onMute={onMute}
            onSetManager={onSetManager}
            onSetAdmin={onSetAdmin}
            onSetMemory={onSetMemory}
            onSetWorkspace={onSetWorkspace}
            onSetFiles={onSetFiles}
            onClearMessages={onClearMessages}
            onDeleteGroup={onDeleteGroup}
            onAddNote={onAddNote}
            onRemoveNote={onRemoveNote}
            onSaveSchedules={onSaveSchedules}
            onRunSchedule={onRunSchedule}
          />
        </div>
      ) : (
        <div className={`team-group__body${membersOpen ? "" : " is-members-hidden"}`}>
          <div className="team-group__main">
            <div className="team-group__stream-wrap" ref={wrapRef}>
            {/* ⛔ 提及作用域：包住整条消息流（含运行中的流式卡）⇒ 伙伴正文里的 `@名字`
                也画成带头像的提及，与「我 @ 他们」完全一致。见本组件上方 mentionScope。 */}
            <MentionScopeContext.Provider value={mentionScope}>
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
                listRows.map((row, index) => {
                  /* 跨天分隔：只在"这一条与上一条不在同一天"时插一条（⛔ 每天第一条之前才插，
                     不是每条都算 —— 否则同一天里会到处是日期条）。 */
                  const prevRow = displayRows[index - 1];
                  const dayBreak = !prevRow || dayKeyOf(prevRow.at) !== dayKeyOf(row.at);
                  const isBot = row.authorKind === "bot";
                  /* ⛔ 话题消息模式：主流只留用户消息，伙伴回复收进气泡的话题条里。
                     ⛔ 不删数据、不挡写入 —— 只是这一行不渲染（切回别的模式立刻全回来）。 */
                  if (effectiveMessageForm === "topic" && isBot) return null;
                  const role = roleOf(row.authorId);
                  const running = activeRunKeys.has(row.key);
                  /* ⛔ 11-09 用户令「图二效果一模一样，直接把主对话那一套接过来」：
                     一个回合只落一条群消息 ⇒ 正文 / 过程 / 文件卡 / 页脚**整体**交给主对话的 TurnView。
                     占位模式仍只给正文（该模式承诺不展示过程）。 */
                  /* ⛔ 11-09：CLI 直跑消息没有引擎回合（`cli:` 合成 id）⇒ 不能走 TurnView
                     （它拉不到回合 → 只剩正文、页脚/追问全空）。走普通正文 + 群操作条。 */
                  const useTurnView = isBot && effectiveReplyMode !== "placeholder" && row.kind !== "card"
                    && !String(row.threadId ?? "").startsWith("cli:");
                  /* ⛔ 正文永远正常显示（用户：「只有正文正常消息发送出来」）；
                     运行过程另起一个折叠块挂在正文下面，默认收起。 */
                  const quote = isBot ? quotes.get(row.key) : undefined;
                  const mentioned = isBot
                    ? parseMentions(row.text, group, { excludeId: row.authorId }).filter((m) => m.kind === "bot")
                    : [];
                  /* ⛔ 11-09 用户截图「页脚和追问/来源之间一大片空白」：群特有的追问 / 来源
                     不再另起一行，直接接在**主对话页脚的同一行**（TurnView 的 extraFooter）。 */
                  const footerExtras = isBot && useTurnView ? (
                    <>
                      <button type="button" className="message-action-extra team-msg__extra" onClick={() => askAgain(row)}>追问</button>
                      {mentioned.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          className="message-action-extra team-msg__extra"
                          title="点一下把它加进本轮 @（不会自动派活）"
                          onClick={() => mentionPartner(m.id)}
                        >@{m.name}</button>
                      ))}
                      {row.threadId && !row.threadId.startsWith("cli:") ? (goneThreads?.has(row.threadId) ? (
                        <span className="team-msg__origin is-gone" title="这条会话已被删除（群记录保留）">来源 {shortId(row.threadId)} · 已删除</span>
                      ) : (
                        <button
                          type="button"
                          className="team-msg__origin"
                          title={onOpenThread ? `打开来源会话：${row.threadId}` : `来源会话：${row.threadId}（点一下复制）`}
                          onClick={() => { if (onOpenThread) onOpenThread(row.threadId); else void copyText({ ...row, text: row.threadId }); }}
                        >来源 {shortId(row.threadId)}{onOpenThread ? " ↗" : ""}</button>
                      )) : null}
                    </>
                  ) : null;
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
                          {row.via && (() => {
                            /* ⛔ 11-08 用户令「主代理人显示他名字」：via 落盘的是团名，
                               显示时统一走 nameOf（团 id → 主理人名）；查不到才回退落盘名。 */
                            const viaId = String(row.via.memberId ?? "");
                            const resolved = viaId ? nameOf(viaId) : "";
                            const viaName = resolved && resolved !== viaId ? resolved : row.via.name;
                            /* ⛔⛔ 11-11 用户截图「这又是啥情况，看不懂」：主理人自己回的话被标成
                               「由 X 叫来」—— @ 整团 / 主理人内部转一圈时 via 指向的其实是它自己
                               （整团槽与主理人是同一个人）。⇒ 解析后与作者同名就不显示这条角标，
                               ⛔ 不靠 id 比（两个 id 指向同一张椅子，正是这轮在收的债）。 */
                            if (!viaName || viaName === authorName) return null;
                            return (
                              <em className="team-msg__via" title={`${viaName} 在群里叫它做这件事`}>
                                由 {viaName} 叫来
                              </em>
                            );
                          })()}
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

                        {/* ⛔ 11-09 用户令「一个回合只出一条消息，跟主对话一模一样」：
                            不再有"该轮第一条"的流式消息 ⇒ 运行中的流式卡改到消息流末尾统一渲染
                            （见 displayRows 之后的 live 区块）。 */}
                        {/* 引用行放在**正文上面**（用户：这个应该放上面吧，在正文消息上面）。
                            ⛔ 只有伙伴消息有引用；它取的是这条回复之前最近一条人类消息。 */}
                        {isBot && quote && (
                          <TeamQuoteBlock
                            quote={quote}
                            nameOf={nameOf}
                            faceOfId={faceOfId}
                            mentionCandidates={mentionCandidates}
                            mentionPartner={mentionPartner}
                            excludeId={row.authorId}
                          />
                        )}
                        {/* 11-07 用户：「运行折叠板块放上面，下面就可以展示文件卡片那些了，跟主对话框一样」——
                            过程折叠在正文**上方**；正文下面是产物卡 / 图片 / 表格（Markdown 灯箱同主对话）。 */}
                        {/* ⛔⛔ 11-08 用户令：「运行结束后，运行过程隐藏掉，不显示，只有最后汇报」——
                            过程块**只在运行中**出现（挂在下面的流式卡里）。成品消息一律不再挂
                            TeamProcess：跑完还留着那一行「用插件…」正是用户要删掉的东西。 */}
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
                            {/* ⛔ 11-09 用户令「跟主对话一模一样」：伙伴回复整轮交给 TurnView
                                （深度思考 / 过程步骤 / 正文 / 文件卡 / 页脚同一套实现）。
                                回合还没拉回来时先显示群自己的 @ 可点正文，拉到后无缝换掉。 */}
                            {useTurnView ? (
                              <TeamTurnView
                                threadId={row.threadId}
                                at={row.at}
                                bodyText={row.text}
                                usage={row.usage}
                                onOpenFile={openFilePreview}
                                onOpenReview={openReviewPanel}
                                onQuote={quoteText}
                                onOpenThread={onOpenThread}
                                extraFooter={footerExtras}
                                fallback={(
                                  <TeamMentionText
                                    text={stripVoiceScript(row.text)}
                                    candidates={mentionCandidates}
                                    faceOfId={faceOfId}
                                    nameOf={nameOf}
                                    onPick={mentionPartner}
                                    excludeId={row.authorId}
                                  />
                                )}
                              />
                            ) : (
                              <TeamMentionText
                                text={stripVoiceScript(row.text)}
                                candidates={mentionCandidates}
                                faceOfId={faceOfId}
                                nameOf={nameOf}
                                onPick={mentionPartner}
                                excludeId={row.authorId}
                              />
                            )}
                            {/* ⛔⛔ 11-08 用户（截图 3）：「我点出来的那个 @ 总是固定在消息下面，很不好看」——
                                气泡底部那排「补正文没写到的 @」整块删除：@ 只认正文（行内提及），
                                ⛔ 不再在消息下面另起一排 chip。 */}
                            {/* ⛔ 11-08 用户令「在用户消息气泡里面更新，点击可以弹窗预览」：
                                话题条就挂在用户自己的气泡里，⛔ 不是另起一条消息、也不在主流里平铺。 */}
                            {effectiveMessageForm === "topic" && !isBot && (
                              <TeamTopicBadge
                                thread={topicThreadOf(topicThreads, row)}
                                faceOfId={faceOfId}
                                nameOf={nameOf}
                                onOpen={() => setTopicOpenKey(row.key)}
                              />
                            )}
                            {/* ⛔ 11-08 三改（用户截图）：「这个过程模式下，就不用在用户消息下面展示这个了，
                                只有占位模式才显示这个」—— 过程模式由成员自己的流式卡承担（正在写 + 折叠块），
                                这里只在占位模式画很窄的小图标。 */}
                            {!isBot && row.key === lastHumanKey && (
                              <TeamRunFeedback
                                mode={effectiveReplyMode}
                                partners={runningPartners}
                                faceOfId={faceOfId}
                              />
                            )}
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
                            {/* 占位模式（不展示过程）：仍只挂这一轮的文件卡；过程模式下卡由 TurnView 自己渲染。 */}
                            {isBot && !useTurnView && runTailKeys.has(row.key) && !running ? (
                              <TeamCards threadId={row.threadId} at={row.at} bodyText={row.text} onOpenFile={openFilePreview} onReview={openReviewPanel} />
                            ) : null}
                          </>
                        )}
                        {isBot && !useTurnView && (
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
                            {/* ⛔ 11-08 用户令「用量页脚也要一致」：与主对话 MessageFooter 同一口径。 */}
                            {row.usage && <TeamUsage usage={row.usage} />}
                            {row.threadId && !row.threadId.startsWith("cli:") ? (goneThreads?.has(row.threadId) ? (
                              <span className="team-msg__origin is-gone" title="这条会话已被删除（群记录保留）">来源 {shortId(row.threadId)} · 已删除</span>
                            ) : (
                              <button
                                type="button"
                                className="team-msg__origin"
                                title={onOpenThread ? `打开来源会话：${row.threadId}` : `来源会话：${row.threadId}（点一下复制）`}
                                onClick={() => { if (onOpenThread) onOpenThread(row.threadId); else void copyText({ ...row, text: row.threadId }); }}
                              >来源 {shortId(row.threadId)}{onOpenThread ? " ↗" : ""}</button>
                            )) : null}
                          </div>
                        )}
                      </div>
                      {/* ⛔⛔ 11-09 用户（截图红框）：那排「复制/编辑/收藏/引用」原本在**气泡里面**，
                          要放到气泡**外面**，并且按群设置的「消息排版」自适应贴到**用户头像那一侧** ——
                          split（伙伴靠左·自己靠右）⇒ 贴右；全部靠左 ⇒ 贴左。
                          实现上**不写死 left/right**：这里只把它放在 `.team-msg__main` 的最后一个子项，
                          由 main 的 `align-items`（is-human 时 flex-end / is-layout-left 时 flex-start）
                          自动决定贴哪边 —— 少一个状态，就不会与排版设置不同步（CSS 见 61-team-mode.css）。 */}
                      {!isBot && (
                        <div className="team-msg__footer">
                          <MessageFooter
                            item={{ id: row.itemId, type: "userMessage", content: [{ type: "text", text: String(row.text ?? "") }] } as unknown as ThreadItem}
                            onCopy={() => void copyText(row)}
                            onQuote={() => quoteRow(row)}
                            onEdit={() => editRow(row)}
                          />
                        </div>
                      )}
                      </div>
                    </article>
                    </Fragment>
                  );
                })
              )}

              {/* 流式卡（飞书 §2.4）：**同一个 threadId 只更新这一张**，不新建消息。
                  ⛔ 正式消息落盘时这张卡会被撤掉（store 里按 threadId 删），所以不会重复。 */}
              {liveVisible.map((run) => (
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
                    {/* ⛔ 11-09：一个回合只落一条成品消息（正文不再逐条落盘）⇒ 运行中的
                        过程折叠与实时编辑行**回到流式卡里**（与主对话同序：过程在上、正文在下）。 */}
                    {/* ⛔⛔ 11-09 用户令（两张截图对照）：「运行结束效果是对的，运行中就不对」
                        「给我做到跟主对话框一模一样，不管运行中还是运行结束，都复用过来」。
                        ⇒ 运行中**不再走 TeamProcess 那套自绘过程块**（那是第二套实现，所以长得不一样），
                        改成和收尾态同一个 `TeamTurnView`（= 主对话 TurnView），只是多传 `running`。
                        ⛔ 正文也交给 TurnView 渲染（它自己画 agentMessage）—— 这里**不能再单独渲染
                          `run.text`**，否则同一段正文出现两遍。`run.text` 只当 TurnView 还没拉到
                          回合时的兜底（引擎刚落盘的头一两百毫秒）。 */}
                    {effectiveReplyMode === "process" ? (
                      <>
                        {/* ⛔⛔ 11-09 用户（群设置截图）：「对话流」明明默认折叠（关闭），群里跑起来却把
                            详细步骤全铺开了。根因是 TurnView 读**全局**对话流偏好（默认 detailed），
                            群自己的 `effectiveDialogFlow` 没人消费 ⇒ 这里用作用域覆盖喂给它。
                            ⛔ 只覆盖这一个子树，不改全局偏好（主对话照旧）。 */}
                        {/* ⛔ 11-09 用户：「运行中也要出现信息引用，跟结束一样」。
                            引用取**这次派活之前最近一条人类消息**（流式卡不在 rows 里，所以在这里单独取）。 */}
                        {(() => {
                          const before = rows.filter((r) => r.at <= run.startedAt
                            && String(r.authorKind ?? "") === "human"
                            && String(r.text ?? "").trim());
                          const last = before[before.length - 1];
                          return last
                            ? <TeamQuoteBlock quote={{ authorId: last.authorId, text: last.text }} nameOf={nameOf} faceOfId={faceOfId} mentionCandidates={mentionCandidates} mentionPartner={mentionPartner} excludeId={run.memberId} />
                            : null;
                        })()}
                        <DialogFlowScope.Provider value={effectiveDialogFlow === "detail" ? "detailed" : "simple"}>
                          <TeamTurnView
                            threadId={run.threadId}
                            at={run.startedAt}
                            bodyText=""
                            running
                            live
                            onOpenFile={openFilePreview}
                            onQuote={() => undefined}
                            fallback={String(run.text ?? "").trim()
                              ? <div className="markdown"><Markdown>{stripVoiceScript(String(run.text).slice(0, 40000))}</Markdown></div>
                              : <p className="team-msg__thinking">正在思考…</p>}
                          />
                        </DialogFlowScope.Provider>
                        <TeamLiveFiles threadId={run.threadId} />
                      </>
                    ) : (
                      /* ⛔⛔ 11-08 审查：占位模式承诺「不展示过程与流式正文」—— 流式卡也必须跟着分叉。 */
                      <p className="team-msg__thinking">正在思考…</p>
                    )}
                    {run.status === "running" && <span className="team-msg__caret" aria-hidden />}
                    {run.error && <p className="team-group__notice is-warn">{run.error}</p>}
                  </div>
                  </div>
                </article>
              ))}
            </div>
            </MentionScopeContext.Provider>
            {/* 刻度尺（右侧，不随滚动移动）：每条人发的消息一个刻度，点一下跳过去 */}
            <TeamRuler rows={shownRows} scrollRef={streamRef} containerRef={wrapRef} />
            {/* ⛔ 11-08 用户：「复用一套主对话框的滚轮和自动滚轮最新消息」——
                离底部时浮出「回到底部」（与主对话同一个 `.jump-bottom` 皮肤 + 同语义），
                点一下恢复跟随并贴底。 */}
            {awayFromBottom && (
              <button type="button" className="jump-bottom" title="回到底部" onClick={() => stick()}>
                <ArrowDown size={16} />
              </button>
            )}
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
            {/* ⛔ 11-11 独立板块：异步执行反馈（自己订阅 group-async-run 事件，⛔ 不占群聊域状态）。
                放在输入卡上方 —— 用户要的是"派了几件、谁在跑、谁交回了"一眼可见。 */}
            <AsyncRunPanel groupId={group.id} />

            <footer className="team-group__composer">
              {/* 11-08 用户令「询问，审批，计划，等等全部跟对话框一样」：伙伴跑起来后的
                  询问卡 / 审批卡**就地弹在输入卡上方**（与主对话 composer-overlay-stack 同定位，
                  盖住状态区而不挤走消息流），能直接回答/拒绝，⛔ 不再只能干等。 */}
              <TeamPendingCards app={app} threadIds={agentThreadIds} />
              {/* 排队消息：与主对话同一张卡片（QueuedMessageList），按成员分组；点在「立即」= 插队 */}
              <TeamQueueStack
                app={app}
                threads={queueThreads}
                reloadKey={`${liveLen}|${rows.length}`}
                onNotice={(text) => flashMenuMsg(text)}
              />
              {/* @ 候选面板（11-07 用户令）：原来那一整排常驻 chip 收进面板，输入区不再被它占掉一行。 */}
              {mention.open && (
                <TeamMentionPanel
                  anchorRef={mentionAnchorRef}
                  sections={mentionSections}
                  selected={atTargets}
                  query={mention.query}
                  onQuery={(query) => setMention((prev) => ({ ...prev, query }))}
                  onPick={pickCandidate}
                  onClear={() => setText((prev) => removeMentionsFromText(prev, mentionNames))}
                  onClose={closeMention}
                  autoFocus={!mention.typed}
                />
              )}
              {/* ⛔ 11-08 用户（截图）：框上的「本轮 @」chip 行整块删除 —— 提及只在正文里（发出即行内 chip）。 */}
              <TeamComposer
                value={text}
                onValueChange={updateText}
                textareaRef={composerRef}
                editorApiRef={editorApiRef}
                mentionAvatars={mentionAvatars}
                onKeyDown={(e) => {
                  /* ⛔ 中文输入法选字时的 Enter 不是"发送"（主对话同口径）：
                     组合期内发走半句话、且清空会被 IME 回滚 ⇒ 输入框看着"没清空"。 */
                  if (e.nativeEvent.isComposing) return;
                  /* ⛔ 11-08 用户实测（按住回车/连按出去好几条）：键盘的自动重复不算"再发一条"。 */
                  if (e.repeat) return;
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
                mentionNames={mentionNames}
                mentionCount={atTargets.length}
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
              {/* ⛔ 11-11 真机：标题只数 group.members（团槽位 2），下面却把团成员全展开渲染（6 行）
                  ⇒ 用户看到「成员 2」下面挂着 6 个人。口径统一成实际渲染行数。 */}
              <span title={`群成员 ${group.members.length} 位，另有展开的团成员 ${group.members.reduce((n, x) => n + teamKidsOf(x).length, 0)} 位`}>
                成员 {group.members.length + group.members.reduce((n, x) => n + teamKidsOf(x).length, 0)}
              </span>
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
                    <button
                      type="button"
                      className="team-group__member-main"
                      title={`${personNameOf(m)} · 打开资料卡（可改名 / 换头像）`}
                      onClick={(event) => openProfile(event, m.id)}
                    >
                      <strong>{personNameOf(m)}</strong>
                      {/* ⛔ 11-10 用户：成员列表里管理员要有标签。团群不启用管理员 ⇒ 同样不显示。 */}
                      {m.id === group.adminId && !group.members.some((x) => x.targetKind === "team") && (
                        <em className="team-group__member-tag">管理员</em>
                      )}
                    </button>
                    {/* ⛔ 11-07 用户：「每个成员 @ 的前面有运行动态展示吗」⇒ 运行态点 + @ + 停 三件套
                        （顺序固定：状态在 @ 前、停在 @ 后），团成员与伙伴同一份实现。 */}
                    {isBot && (
                      <MemberActions
                        id={m.id}
                        name={personNameOf(m)}
                        running={Boolean(running)}
                        selected={atTargets.includes(m.id)}
                        onToggle={toggleAt}
                        onStop={(id) => void onStopPartner(id).then((r) => {
                                  /* ⛔ 11-08：会话还在建 / 本来就没在跑 —— 这是状态说明，不是错误（别弹红字）。 */
                                  if (r.ok) return;
                                  if (r.reason === "starting" || r.reason === "idle") flashMenuMsg(r.error || "它当前没有在跑");
                                  else setSendError(r.error || "停止失败");
                                })}
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
                              <button
                                type="button"
                                className="team-group__member-main is-kid"
                                title={`${kid.name} · 打开${m.name}的资料卡`}
                                onClick={(event) => openProfile(event, m.id)}
                              >
                                <strong>{kid.name}</strong>
                              </button>
                              {/* 团成员同样三件套：运行态点 → @ → 停（11-07 用户：「每个成员 @ 的前面
                                  有运行动态展示吗」）。合成 id 与群流署名一致，所以"谁在跑"和"他说的"
                                  是同一个 key；停止也走它（store.stopPartner 会翻成调度目标键）。 */}
                              <MemberActions
                                id={kidId}
                                name={kid.name}
                                running={kidRunning}
                                selected={on}
                                onToggle={toggleAt}
                                onStop={(id) => void onStopPartner(id).then((r) => {
                                  /* ⛔ 11-08：会话还在建 / 本来就没在跑 —— 这是状态说明，不是错误（别弹红字）。 */
                                  if (r.ok) return;
                                  if (r.reason === "starting" || r.reason === "idle") flashMenuMsg(r.error || "它当前没有在跑");
                                  else setSendError(r.error || "停止失败");
                                })}
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
            {/* ⛔ 11-08：全局「停止运行」在「成员 N」标题行右侧（停全部）；单成员的「停」挂在
                各自成员行里、@ 之后（仅运行中显示）。
                ⛔ 11-08 用户（截图）：「把我框住的文字赘述删了」——底部「点 @ 把这个人加进这次派活」
                提示删除。 */}
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
          onRename={onRenameMember ? (name) => onRenameMember(profile.memberId, name) : undefined}
          /* ⛔ 11-10 用户令：管理员在成员列表直接设，不走设置界面。 */
          onSetAdmin={onSetAdmin}
          onStop={(id) => void onStopPartner(id).then((r) => {
                                  /* ⛔ 11-08：会话还在建 / 本来就没在跑 —— 这是状态说明，不是错误（别弹红字）。 */
                                  if (r.ok) return;
                                  if (r.reason === "starting" || r.reason === "idle") flashMenuMsg(r.error || "它当前没有在跑");
                                  else setSendError(r.error || "停止失败");
                                })}
        />
      )}

      {/* 11-09：群右侧栏（贴边抽屉）。文件卡 / 正文文件引用点击都切到它的「文件」页。 */}
      {sideOpen && app && (
        <TeamSidePanel app={app} workspace={group.workspace} tab={sideTab} onTab={setSideTab} onClose={() => setSideOpen(false)} />
      )}

      {/* 话题预览弹窗：⌨ Esc / 点遮罩关闭（板块内用全局 ESC 栈），⛔ 只在话题模式且有回复时出现。 */}
      {/* 话题预览弹窗：⌨ Esc / 点遮罩关闭（板块内用全局 ESC 栈），⛔ 只在话题模式且有回复时出现。
          ⛔⛔ 11-09 用户：「话题展示那个，没有在话题中沟通的功能啊」——
          ⇒ 弹窗底部接一个输入框，发出去 = **带话题引用的新消息**，走群同一条派活通道（send 的 override）。 */}
      {effectiveMessageForm === "topic" && openTopic && (() => {
        const rootText = String((openTopic as { root?: { text?: unknown } }).root?.text ?? "");
        /* 目标：先看话题原消息里 @ 了谁；没 @ 就回给**这个话题最后回复的那个伙伴**（顺着聊下去）。 */
        const partners = mentionTargetsInText(rootText.replace(/^[ \t]*>.*$/gm, ""), mentionCandidatesFlat);
        /* ⛔ 11-09：话题里也有**用户自己的追问**，取最后一个回复者时必须跳过自己，否则把活派给自己。 */
        const replyRows = (openTopic as { replies?: Array<{ authorId?: string; authorKind?: string }> }).replies ?? [];
        const lastReply = replyRows.filter((r) => r.authorKind === "bot").slice(-1)[0];
        const targets = partners.length ? partners : (lastReply?.authorId ? [lastReply.authorId] : []);
        return (
          <TeamTopicPreview
            thread={openTopic as Parameters<typeof TeamTopicPreview>[0]["thread"]}
            faceOfId={faceOfId}
            nameOf={nameOf}
            onClose={() => setTopicOpenKey(null)}
            replyHint={targets.length ? undefined : "这个话题里没有可派活的伙伴（话题里 @ 一个就能接着聊）"}
            onReply={async (text) => {
              const quoted = rootText.trim().split("\n").map((line) => `> ${line}`).join("\n");
              return await send({ body: `${quoted}\n\n${text}`, targets, topicRoot: rootText });
            }}
          />
        );
      })()}

    </div>
  );
}
