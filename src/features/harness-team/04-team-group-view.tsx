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
import { useEffect, useMemo, useRef, useState } from "react";
import { Settings2, X } from "lucide-react";
import type { GroupMessageRow, TeamFile, TeamGroup } from "./01-team-types";
import type { LedgerSummary, LiveRun } from "./02-team-store";
import { TeamSettings } from "./03-team-settings";
import { stripVoiceScript } from "../../lib/voice-script.mjs";
import { Markdown } from "../markdown";
import { TeamMenuButton } from "./06-team-menu";
import { TeamRuler } from "./07-team-ruler";
import { TeamProcess } from "./09-team-process";
import { TeamComposer, loadTeamRunOpts, saveTeamRunOpts } from "./10-team-composer";
import type { TeamRunOpts, TeamRunParams } from "./10-team-composer";
import { buildReplyQuotes } from "../../lib/team-fold.mjs";
import { menuPickResult } from "../../lib/team-menu.mjs";
import { mergeConsecutive, parseCommand, parseMentions } from "../../lib/team-models.mjs";
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
  /** 用量汇总 + 拉取 */
  ledger?: LedgerSummary | null;
  onLoadLedger: (days: number) => void;
  /** 停止某个伙伴当前这一回合（`@成员 /stop`、成员栏的停止键） */
  onStopPartner: (memberId: string) => Promise<{ ok: boolean; error?: string }>;
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

export function TeamGroupView({
  group, rows, issues, busy, notice, limit,
  onAddPartner, onRemovePartner, onMute, onSetManager, onSetMemory, onSetWorkspace, onSetFiles,
  onDeleteGroup, onClearMessages, onRename, onSend,
  onAddNote, onRemoveNote, onSaveMenu, onSaveMenuPlacement, onSaveSchedules, onRunSchedule,
  ledger, onLoadLedger, onStopPartner, live,
}: Props) {
  const [showSettings, setShowSettings] = useState(false);
  const [text, setText] = useState("");
  const [atTargets, setAtTargets] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  /** 菜单点击的回显（飞书 `showMsg` 的等价物：告诉用户"我往输入框放了什么"） */
  const [menuMsg, setMenuMsg] = useState("");
  /** 群名内联编辑（⛔ 不用 window.prompt：原生弹窗在这个壳里体验差且样式不可控） */
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [nameError, setNameError] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [copied, setCopied] = useState("");
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
  const pickMenu = (key: string) => {
    const r = menuPickResult(group.menu ?? [], key);
    setMenuMsg(r.message);
    if (r.ok) {
      setText(r.prompt);
      composerRef.current?.focus();
    }
  };
  /* 定时任务在群日志里的作者 id 是 `automation`（主进程写入）—— 它不是群成员，
     但消息不能显示成裸 id「automation」。⛔ 只有这一处映射，别在别处再判断一次。 */
  const nameOf = (id: string) => (id === "automation" ? "定时任务" : group.members.find((m) => m.id === id)?.name ?? id);
  const memberOf = (id: string) => group.members.find((m) => m.id === id) ?? null;
  const roleOf = (id: string) => memberOf(id)?.targetProfession ?? "";

  /* 伙伴回复正文里写了 `@某人` ⇒ 只做成**可点提及**：点一下把它加进本轮 @，
     ⛔ 不自动发、不自动派活（11-06：模型写「PPT @星象」这种举例文本也会被误读成指令）。 */
  const mentionPartner = (id: string) => {
    setAtTargets((prev) => (prev.includes(id) ? prev : [...prev, id]));
    composerRef.current?.focus();
  };

  const toggleAt = (id: string) => {
    setAtTargets((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
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
        setMenuMsg("已停止 —— 它这一回合的中断请求已发给引擎");
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
    const params: TeamRunParams = {
      model: runOpts.model || undefined,
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
    setAtTargets([row.authorId]);
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

  /* ⛔ 折叠/展开改变内容高度后必须重算贴底（项目纪律：pin-shrink-follow）。
     群头全局开关删掉后改由折叠组自己的过渡结束事件触发（主对话 Fold 用
     grid-template-rows 过渡），这样**单行**开合也能覆盖；只在用户本来贴底时跟，
     ⛔ 不抢他正在翻的历史位置。 */
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
          </div>
          <span className="team-group__sub">
            {group.members.length} 位成员 · {partners.length} 个伙伴
            {ctxParts.length > 0 && ` · ${ctxParts.join(" · ")}`}
          </span>
        </div>
        <div className="team-group__head-actions">
          <div className="team-group__avatars" title={`${group.members.length} 位成员`}>
            {group.members.slice(0, 4).map((m) => (
              <span key={m.id} className={`team-group__avatar${m.kind === "bot" ? " is-bot" : ""}${m.muted ? " is-muted" : ""}`} title={m.name}>
                {m.name.slice(0, 1)}
              </span>
            ))}
            {group.members.length > 4 && <span className="team-group__avatar is-more">+{group.members.length - 4}</span>}
          </div>
          <span className="team-group__head-sep" aria-hidden />
          <button type="button" className="team-group__icon-btn" onClick={() => setShowSettings((v) => !v)} title={showSettings ? "返回群聊" : "群设置"}>
            {showSettings ? <X size={14} /> : <Settings2 size={14} />} <span>{showSettings ? "返回" : "设置"}</span>
          </button>
        </div>
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
          ledger={ledger}
          onLoadLedger={onLoadLedger}
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
                displayRows.map((row) => {
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
                  return (
                    <article
                      key={row.key}
                      className={`team-msg${isBot ? " is-bot" : " is-human"}`}
                      data-thread={row.threadId}
                      data-item={row.itemId}
                      data-item-id={row.itemId}
                      data-ruler-mark={isBot ? undefined : "user"}
                    >
                      <span className="team-msg__avatar">{nameOf(row.authorId).slice(0, 1)}</span>
                      <div className="team-msg__body">
                        <div className="team-msg__meta">
                          <strong>{nameOf(row.authorId)}</strong>
                          {isBot && role && <em className="team-msg__role">{role}</em>}
                          {isBot && running && <em className="team-msg__role is-live">处理中</em>}
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
                          </>
                        )}
                        {isBot && (
                          <div className="team-msg__actions">
                            <button type="button" onClick={() => void copyText(row)}>
                              {copied === row.key ? "已复制" : "复制"}
                            </button>
                            <button type="button" onClick={() => askAgain(row)}>追问</button>
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
                  <span className="team-msg__avatar">{run.name.slice(0, 1)}</span>
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

            {(busy?.length ?? 0) > 0 && (
              <div className="team-group__running" role="status" aria-live="polite">
                <span className="team-group__dot" aria-hidden />
                {busy!.map(nameOf).join("、")} 正在处理…
              </div>
            )}
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
              <div className="team-group__atbar">
                <span className="team-group__atbar-label">本轮 @</span>
                <div className="team-group__atbar-chips">
                  {partners.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`team-group__atchip${atTargets.includes(p.id) ? " is-on" : ""}${p.muted ? " is-muted" : ""}`}
                      onClick={() => toggleAt(p.id)}
                      aria-pressed={atTargets.includes(p.id)}
                      title={atTargets.includes(p.id) ? "取消选择" : "把它加进本轮 @"}
                    >
                      <i className="team-group__atchip-avatar">{p.name.slice(0, 1)}</i>
                      {p.name}
                      {!p.targetKind && <em className="team-group__atchip-warn" title="这个伙伴没绑定智能体，派不了活">未绑定</em>}
                    </button>
                  ))}
                  {!partners.length && <span className="team-group__atempty">还没有伙伴可 @</span>}
                </div>
                {atTargets.length > 0 && (
                  <button type="button" className="team-group__atbar-clear" onClick={() => setAtTargets([])}>清空</button>
                )}
                {/* 飞书 §3：`needShowMenuButton = items.length > 0` —— 空菜单不画按钮。
                    FLOAT 形态下按钮在群视图右下（见文件末尾），这里不重复画。 */}
                {!floatMenu && (
                  <TeamMenuButton items={group.menu ?? []} disabled={sending} placement="input" onPick={pickMenu} />
                )}
              </div>
              <TeamComposer
                value={text}
                onValueChange={setText}
                textareaRef={composerRef}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={atTargets.length ? `对 ${atTargets.map(nameOf).join("、")} 说…` : "说点什么（先 @ 选伙伴；/stop 可停）"}
                opts={runOpts}
                onOpts={setRunOpts}
                sending={sending}
                /* ⛔ `/stop` 是本地指令，不需要 @ 任何人 —— 别把发送键锁死 */
                canSend={Boolean(text.trim() && (atTargets.length || /^\/stop\b/.test(text.trim())))}
                onSend={() => void send()}
                targetNames={atTargets.map(nameOf)}
              />
              <div className="team-group__send-row">
                <span className="team-group__hint">
                  {sending ? "正在派活…" : atTargets.length ? `将派给 ${atTargets.map(nameOf).join("、")}` : "先点上面的 @ 选伙伴"}
                  {ctxParts.length > 0 && atTargets.length ? (
                    <em className="team-group__ctx"> + {ctxParts.join(" + ")}</em>
                  ) : null}
                </span>
              </div>
            </footer>
          </div>

          {/* 成员栏（飞书群右侧成员区 / 豆包伙伴档案）：只有群才有这个东西 —— 普通会话没有。 */}
          <aside className="team-group__members" aria-label="群成员">
            <div className="team-group__members-head">成员 {group.members.length}</div>
            <ul>
              {group.members.map((m) => {
                const running = busy?.includes(m.id);
                const isBot = m.kind === "bot";
                return (
                  <li key={m.id} className={`team-group__member${m.muted ? " is-muted" : ""}`}>
                    <span className={`team-group__member-avatar${isBot ? " is-bot" : ""}`} aria-hidden>{m.name.slice(0, 1)}</span>
                    <span className="team-group__member-main">
                      <strong>{m.name}</strong>
                      <small title={`成员 id：${m.id}${m.targetKey ? ` · 目标：${m.targetKind}:${m.targetKey}` : ""}`}>
                        {/* ⛔ 上下级放**最前**：这一行会被省略号截断，放后面就永远看不见（用户要"关系明确"） */}
                        {m.managerId ? `上级 ${group.members.find((x) => x.id === m.managerId)?.name ?? m.managerId} · ` : ""}
                        {m.id === group.leadId ? "群主" : (m.targetProfession || (isBot ? "伙伴" : "成员"))}
                        {running ? " · 处理中" : ""}
                        {m.muted ? " · 已静音" : ""}
                      </small>
                    </span>
                    {isBot && running && (
                      <button
                        type="button"
                        className="team-group__member-stop"
                        title={`停止 ${m.name} 当前这一回合`}
                        aria-label={`停止 ${m.name}`}
                        onClick={() => void onStopPartner(m.id).then((r) => { if (!r.ok) setSendError(r.error || "停止失败"); })}
                      >
                        停
                      </button>
                    )}
                    {isBot && (
                      <button
                        type="button"
                        className={`team-group__member-at${atTargets.includes(m.id) ? " is-on" : ""}`}
                        title={`@${m.name}`}
                        onClick={() => toggleAt(m.id)}
                      >
                        @
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="team-group__members-hint">点 @ 把这个人加进这次派活</p>
          </aside>
        </div>
      )}

      {/* FLOAT 形态的入口（飞书 `FLOAT`）：浮在群视图右下，⛔ 不进输入区。
          ⛔ 群设置里不画 —— 那个页面要编辑的正是它，画上去会挡住保存按钮。 */}
      {floatMenu && !showSettings && (
        <TeamMenuButton items={group.menu ?? []} disabled={sending} placement="float" onPick={pickMenu} />
      )}
    </div>
  );
}
