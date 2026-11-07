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
import { Search, Settings2, Square, X } from "lucide-react";
import type { GroupMessageRow, TeamFile, TeamGroup } from "./01-team-types";
import type { LiveRun } from "./02-team-store";
import { TeamSettings } from "./03-team-settings";
import { stripVoiceScript } from "../../lib/voice-script.mjs";
import { Markdown } from "../markdown";
import { TeamMenuButton } from "./06-team-menu";

import { TeamRuler } from "./07-team-ruler";
import { TeamProcess } from "./09-team-process";
import { TeamCards } from "./11-team-cards";
import { MemberAvatar } from "./13-team-avatar";
import { TeamProfileCard } from "./14-team-profile-card";
import { TeamMentionPanel } from "./15-team-mention-panel";
import { TeamSearchPanel } from "./16-team-search";
import { TeamComposer, loadTeamRunOpts, saveTeamRunOpts } from "./10-team-composer";
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

type Props = {
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
  /** 解散群（只删群与群日志；伙伴的子会话不动） */
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
  /** 停止某个伙伴当前这一回合（`@成员 /stop`、成员栏的停止键） */
  onStopPartner: (memberId: string) => Promise<{ ok: boolean; error?: string }>;
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
};

function fmtTime(at: number): string {
  if (!at) return "";
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const shortId = (id: string) => (id.length > 10 ? `${id.slice(0, 6)}…` : id);

/** 群聊一页多少条（首屏 + 每次向上补的量）。 */
const PAGE = 30;

/**
 * 成员行右端的三件套：**运行态动态点 → @ → 停**。
 *
 * 11-07 用户：「每个成员 @ 的前面有运行 ⏹ 动态展示吗」→ 运行态脉冲点落在 @ 前；
 * 11-07 用户（截图圈掉文字按钮）：「停用 ⏹️ 图标替代，放到 @ 前面」⇒ 停止也挪到 @ 前，
 * 且换成方形停止图标（不再有「停」字）。**运行态与停止都在 @ 前面**，顺序固定：
 * 运行态脉冲点 → ⏹️ 停止图标 → @。⛔ 只在运行中出现，空闲成员一律不画。
 * ⛔ 团成员与普通伙伴共用这一个组件（两处各写一份必然漂：一处加了动态点、另一处忘了）。
 */
function MemberActions({
  id, name, running, selected, onToggle, onStop,
}: {
  id: string;
  name: string;
  running: boolean;
  selected: boolean;
  onToggle: (id: string) => void;
  onStop: (id: string) => void;
}) {
  return (
    <>
      {running && (
        <span className="team-group__member-live" title={`${name} 正在运行`} aria-label={`${name} 正在运行`} role="img" />
      )}
      {running && (
        <button
          type="button"
          className="team-group__member-stop"
          title={`停止 ${name} 当前这一回合`}
          aria-label={`停止 ${name}`}
          onClick={() => onStop(id)}
        >
          <Square size={10} fill="currentColor" strokeWidth={1.5} />
        </button>
      )}
      <button
        type="button"
        className={`team-group__member-at${selected ? " is-on" : ""}`}
        title={`@${name}`}
        aria-pressed={selected}
        onClick={() => onToggle(id)}
      >
        @
      </button>
    </>
  );
}

export function TeamGroupView({
  group, rows, issues, busy, notice, limit,
  onAddPartner, onRemovePartner, onMute, onSetManager, onSetMemory, onSetWorkspace, onSetFiles,
  onDeleteGroup, onClearMessages, onRename, onSend,
  onAddNote, onRemoveNote, onSaveMenu, onSaveMenuPlacement, onSaveSchedules, onRunSchedule,
  onStopPartner, live, onOpenModelSettings,
}: Props) {
  const [showSettings, setShowSettings] = useState(false);
  const [text, setText] = useState("");
  const [atTargets, setAtTargets] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
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
  const [mention, setMention] = useState<{ open: boolean; query: string; start: number; typed: boolean }>(
    { open: false, query: "", start: 0, typed: false },
  );
  const [searchOpen, setSearchOpen] = useState(false);
  /** 搜索跳转后的短暂高亮（1.6s 后清掉，⛔ 不留永久 class） */
  const [flashKey, setFlashKey] = useState("");
  /* 过程折叠（用户：「这样不会刷屏」）：每条消息自带一个折叠块、默认收起。
     ⛔ 11-06 用户：「群头那个『展开过程』多余，可以不要了」⇒ 全局开关整体删除，
        只在单条消息上开合；FoldGroup 自己管手动状态，⛔ 不留死 state。 */
  /** 输入框工具行：模型/档位/权限是**持久化偏好**（重启不丢），技能/文件是一次性附件 */
  const [runOpts, setRunOpts] = useState<TeamRunOpts>(loadTeamRunOpts);
  useEffect(() => { saveTeamRunOpts(runOpts); }, [runOpts]);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
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
  const personNameOf = (m: TeamGroup["members"][number]) => teamLeadOf(m)?.name ?? m?.name ?? "";

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
      };
    }
    const m = memberOf(id);
    return m ? faceOf(m) : { id, name: nameOf(id) };
  };

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
  const closeMention = () => setMention({ open: false, query: "", start: 0, typed: false });
  const openMentionPanel = () => setMention({ open: true, query: "", start: 0, typed: false });

  /* 输入框内容变化：顺手判一次 `@` 触发（⛔ 判据只在纯函数里，别在这里写第二套）。 */
  const updateText = (next: string) => {
    setText(next);
    const caret = composerRef.current?.selectionStart ?? next.length;
    const trigger = mentionTriggerOf(next, caret);
    if (trigger) {
      setMention({ open: true, query: trigger.query, start: trigger.start, typed: true });
      return;
    }
    /* 只是「打字触发」的会话要跟着关；面板按钮打开的多选不因继续打字而关 */
    setMention((prev) => (prev.typed ? { open: false, query: "", start: 0, typed: false } : prev));
  };

  /** 面板候选（机器人 / 专家团 / 团成员）—— 目录与群成员一变就重算 */
  const mentionSections = useMemo(() => mentionSectionsOf(group, catalog), [group, catalog]);

  const pickCandidate = (item: { selectId: string; name: string }) => {
    const already = atTargets.includes(item.selectId);
    if (mention.typed) {
      /* 打字触发：把 `@查询词` 换成 `@名字 `，并把这个人加进本轮 @（已选中就只换文本） */
      if (!already) setAtTargets((prev) => [...prev, item.selectId]);
      const applied = applyMention(text, { start: mention.start }, item.name);
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
      <header className="team-group__head">
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
          <button type="button" className="team-group__icon-btn" onClick={() => setShowSettings((v) => !v)} title={showSettings ? "返回群聊" : "群设置"}>
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
          onSaveSchedules={onSaveSchedules}
          onRunSchedule={onRunSchedule}
        />
      ) : (
        <div className="team-group__body">
          <div className="team-group__main">
            <div className="team-group__stream-wrap" ref={wrapRef}>
            <div className="team-group__stream" role="log" aria-live="polite" ref={streamRef} onScroll={onStreamScroll}>
              {hasMore && (
                <button type="button" className="team-group__more" onClick={() => loadEarlier()}>
                  ↑ 加载更早的 {Math.min(PAGE, rows.length - visibleCount)} 条（共 {rows.length} 条）
                </button>
              )}
              {rows.length === 0 ? (
                <div className="team-group__empty">
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
                  const atChips = row.mentions.length
                    ? row.mentions.map((id) => <em key={id} className="team-msg__mention">@{nameOf(id)}</em>)
                    : undefined;
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
                      <div className="team-msg__body">
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

                        {/* 引用行放在**正文上面**（用户：这个应该放上面吧，在正文消息上面）。
                            ⛔ 只有伙伴消息有引用；它取的是这条回复之前最近一条人类消息。 */}
                        {isBot && quote && (
                          <p className="team-process__quote team-process__quote--top" title={`回复 ${nameOf(quote.authorId)}：${quote.text}`}>
                            <span className="team-process__quote-bar" aria-hidden />
                            <span>回复 {nameOf(quote.authorId)}：{quote.text}</span>
                          </p>
                        )}
                        {row.kind === "card" ? (
                          <pre className="team-msg__card">{JSON.stringify(row.card, null, 2)}</pre>
                        ) : (
                          /* 正文走**主对话同一个 Markdown 组件**（表格/代码/链接/图片灯箱一致）。
                             ⛔ 播报稿 ```voice 是给耳朵的，渲染前剥掉（口径只有一处）。
                             @ 用 float 挂在第一段前面（用户：艾特要放消息前面，不要单独一行）。 */
                          <>
                            <div className="markdown team-msg__body-text">
                              {atChips && <span className="team-card__prefix">{atChips}</span>}
                              <Markdown>{stripVoiceScript(row.text)}</Markdown>
                            </div>
                            {(row.continued ?? []).map((extra) => (
                              <div key={extra.key} className="team-msg__more markdown">
                                <Markdown>{stripVoiceScript(extra.text)}</Markdown>
                              </div>
                            ))}
                            {isBot && (
                              <TeamProcess
                                key={row.key}
                                threadId={row.threadId}
                                at={row.at}
                                bodyText={row.text}
                                running={running}
                                onAskAgain={() => askAgain(row)}
                              />
                            )}
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
                            <span className="team-msg__origin" title={`来源会话：${row.threadId}（点一下复制）`} onClick={() => void copyText({ ...row, text: row.threadId })}>
                              来源 {shortId(row.threadId)}
                            </span>
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
                  <div className="team-msg__body">
                    <div className="team-msg__meta">
                      <strong>{run.name}</strong>
                      <em className="team-msg__role is-live">
                        {run.status === "running" ? "正在写" : run.status === "failed" ? "中断" : "完成"}
                      </em>
                      <time>{fmtTime(run.startedAt)}</time>
                    </div>
                    {String(run.text ?? "").trim()
                      ? <div className="markdown"><Markdown>{stripVoiceScript(String(run.text).slice(0, 40000))}</Markdown></div>
                      : <p className="team-msg__thinking">正在思考…</p>}
                    {run.status === "running" && <span className="team-msg__caret" aria-hidden />}
                    {run.error && <p className="team-group__notice is-warn">{run.error}</p>}
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
              {/* @ 候选面板（11-07 用户令）：原来那一整排常驻 chip 收进面板，输入区不再被它占掉一行。 */}
              {mention.open && (
                <TeamMentionPanel
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
                /* ⛔ `/stop` 是本地指令，不需要 @ 任何人 —— 别把发送键锁死 */
                canSend={Boolean(text.trim() && (atTargets.length || /^\/stop\b/.test(text.trim())))}
                onSend={() => void send()}
                targetNames={atTargets.map(nameOf)}
                fileCandidates={fileCandidates}
                onOpenModelSettings={onOpenModelSettings}
                onOpenMention={openMentionPanel}
                mentionCount={atTargets.length}
                /* 飞书 §3：`needShowMenuButton = items.length > 0` —— 空菜单不画按钮。
                   FLOAT 形态下按钮在群视图右下（见文件末尾），这里不重复画。 */
                toolsSlot={!floatMenu ? <TeamMenuButton items={menuItems} disabled={sending} placement="input" onPick={pickMenu} /> : null}
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
            </div>
            <ul>
              {group.members.map((m) => {
                const running = busy?.includes(m.id);
                const isBot = m.kind === "bot";
                const kids = teamKidsOf(m);
                return (
                  <Fragment key={m.id}>
                  <li className={`team-group__member${m.muted ? " is-muted" : ""}`}>
                    <span className="team-group__member-avatar has-agent"><MemberAvatar member={faceOf(m)} size={22} /></span>
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
                              <span className="team-group__member-avatar has-agent">
                                <MemberAvatar
                                  member={{ id: kid.key, kind: "bot", name: kid.name, targetKind: "member", targetKey: kid.key }}
                                  size={22}
                                />
                              </span>
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
