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
import { useMemo, useRef, useState } from "react";
import type { GroupMessageRow, TeamFile, TeamGroup } from "./01-team-types";
import type { LedgerSummary } from "./02-team-store";
import { TeamSettings } from "./03-team-settings";
import { stripVoiceScript } from "../../lib/voice-script.mjs";
import { TeamCard } from "./05-team-card";
import { TeamMenuButton } from "./06-team-menu";
import { menuPickResult } from "../../lib/team-menu.mjs";
import { mergeConsecutive, parseCommand, parseMentions } from "../../lib/team-models.mjs";

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
  onSetFiles: (files: TeamFile[]) => Promise<{ ok: boolean; error?: string }>;
  /** 解散群（只删群与群日志；伙伴的子会话不动） */
  onDeleteGroup?: () => Promise<{ ok: boolean; error?: string }>;
  /** 记忆条目 */
  onAddNote: (note: { text: string; type: "fact" | "constraint" | "runbook" }) => Promise<{ ok: boolean; error?: string }>;
  onRemoveNote: (noteId: string) => Promise<{ ok: boolean; error?: string }>;
  /** 快捷指令菜单（整份替换） */
  onSaveMenu: (items: unknown[]) => Promise<{ ok: boolean; error?: string }>;
  /** 用量汇总 + 拉取 */
  ledger?: LedgerSummary | null;
  onLoadLedger: (days: number) => void;
  /** 停止某个伙伴当前这一回合（`@成员 /stop`、成员栏的停止键） */
  onStopPartner: (memberId: string) => Promise<{ ok: boolean; error?: string }>;
  /** 重命名（主进程是唯一落点；这里只负责发与显示错误） */
  onRename?: (name: string) => Promise<{ ok: boolean; error?: string }>;
  /** 正在跑活的伙伴（id）：显示「正在处理…」，⛔ 不是消息 */
  busy?: string[];
  /** 上次派活的失败说明（⛔ 与消息流分开） */
  notice?: string;
  /** 派活：@ 了谁就把这句话交给谁，各自落各自子会话 */
  onSend?: (partnerIds: string[], text: string) => Promise<{ ok: boolean; error?: string }> | void;
};

function fmtTime(at: number): string {
  if (!at) return "";
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const shortId = (id: string) => (id.length > 10 ? `${id.slice(0, 6)}…` : id);

export function TeamGroupView({
  group, rows, issues, busy, notice, limit,
  onAddPartner, onRemovePartner, onMute, onSetManager, onSetMemory, onSetFiles,
  onDeleteGroup, onRename, onSend,
  onAddNote, onRemoveNote, onSaveMenu, ledger, onLoadLedger, onStopPartner,
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
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const partners = useMemo(() => group.members.filter((m) => m.kind === "bot"), [group]);
  const nameOf = (id: string) => group.members.find((m) => m.id === id)?.name ?? id;
  const memberOf = (id: string) => group.members.find((m) => m.id === id) ?? null;
  const roleOf = (id: string) => memberOf(id)?.targetProfession ?? "";

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

    setSending(true);
    try {
      const r = await onSend?.(atTargets, body);
      if (r && !r.ok) {
        setSendError(r.error || "派活失败");
        return; // ⛔ 失败保留原文，别把用户打的字清掉
      }
      setText("");
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

  /* ⛔ 同一作者、短间隔的连续消息并成一条（用户：「别框框刷屏」）。
     只影响渲染分组，`continued` 里仍是独立消息（各自 itemId 可溯源）。 */
  const displayRows = mergeConsecutive(rows);

  const ctxParts = [
    group.memory?.trim() ? "群记忆" : "",
    (group.files?.length ?? 0) > 0 ? `${group.files.length} 个参考文件` : "",
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
        <div className="team-group__avatars" aria-hidden>
          {group.members.slice(0, 6).map((m) => (
            <span key={m.id} className={`team-group__avatar${m.kind === "bot" ? " is-bot" : ""}${m.muted ? " is-muted" : ""}`} title={m.name}>
              {m.name.slice(0, 1)}
            </span>
          ))}
        </div>
        <button type="button" className="team-group__settings-btn" onClick={() => setShowSettings((v) => !v)}>
          {showSettings ? "返回群聊" : "群设置"}
        </button>
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
          onSetFiles={onSetFiles}
          onDeleteGroup={onDeleteGroup}
          onAddNote={onAddNote}
          onRemoveNote={onRemoveNote}
          onSaveMenu={onSaveMenu}
          ledger={ledger}
          onLoadLedger={onLoadLedger}
        />
      ) : (
        <div className="team-group__body">
          <div className="team-group__main">
            <div className="team-group__stream" role="log" aria-live="polite">
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
                  return (
                    <article
                      key={row.key}
                      className={`team-msg${isBot ? " is-bot" : " is-human"}`}
                      data-thread={row.threadId}
                      data-item={row.itemId}
                    >
                      <span className="team-msg__avatar">{nameOf(row.authorId).slice(0, 1)}</span>
                      <div className="team-msg__body">
                        <div className="team-msg__meta">
                          <strong>{nameOf(row.authorId)}</strong>
                          {isBot && role && <em className="team-msg__role">{role}</em>}
                          {isBot && running && <em className="team-msg__role is-live">处理中</em>}
                          <time>{fmtTime(row.at)}</time>
                        </div>
                        {row.mentions.length > 0 && (
                          <div className="team-msg__mentions">
                            {row.mentions.map((id) => <em key={id}>@{nameOf(id)}</em>)}
                          </div>
                        )}
                        {row.kind === "card" ? (
                          <pre className="team-msg__card">{JSON.stringify(row.card, null, 2)}</pre>
                        ) : (
                          /* ⛔ 播报稿是**给耳朵的**（```voice 围栏块）：对话里由 Markdown 整块剥掉，
                             群视图也得剥 —— 口径只有一处（src/lib/voice-script.mjs）。
                             剥完再交给卡片渲染器（表格/代码/列表给真正的元素，⛔ 不拼 HTML）。 */
                          <>
                            <TeamCard text={stripVoiceScript(row.text)} />
                            {(row.continued ?? []).map((extra) => (
                              <div key={extra.key} className="team-msg__more">
                                <TeamCard text={stripVoiceScript(extra.text)} />
                              </div>
                            ))}
                          </>
                        )}
                        {isBot && (
                          <div className="team-msg__actions">
                            <button type="button" onClick={() => void copyText(row)}>
                              {copied === row.key ? "已复制" : "复制"}
                            </button>
                            <button type="button" onClick={() => askAgain(row)}>追问</button>
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
                <span className="team-group__atlabel">@</span>
                {partners.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`team-group__atchip${atTargets.includes(p.id) ? " is-on" : ""}${p.muted ? " is-muted" : ""}`}
                    onClick={() => toggleAt(p.id)}
                    aria-pressed={atTargets.includes(p.id)}
                  >
                    {p.name}
                    {!p.targetKind && <em className="team-group__atchip-warn" title="这个伙伴没绑定智能体，派不了活">未绑定</em>}
                  </button>
                ))}
                {!partners.length && <span className="team-group__atempty">还没有伙伴可 @</span>}
                {/* 飞书 §3：`needShowMenuButton = items.length > 0` —— 空菜单不画按钮 */}
                <TeamMenuButton
                  items={group.menu ?? []}
                  disabled={sending}
                  onPick={(key) => {
                    const r = menuPickResult(group.menu ?? [], key);
                    setMenuMsg(r.message);
                    if (r.ok) {
                      setText(r.prompt);
                      composerRef.current?.focus();
                    }
                  }}
                />
              </div>
              <textarea
                ref={composerRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={atTargets.length ? `对 ${atTargets.map(nameOf).join("、")} 说…` : "说点什么（先 @ 选伙伴；/stop 可停）"}
                rows={2}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="team-group__send-row">
                <span className="team-group__hint">
                  {sending ? "正在派活…" : atTargets.length ? `将派给 ${atTargets.map(nameOf).join("、")}` : "先点上面的 @ 选伙伴"}
                  {ctxParts.length > 0 && atTargets.length ? (
                    <em className="team-group__ctx"> + {ctxParts.join(" + ")}</em>
                  ) : null}
                </span>
                <button type="button" onClick={() => void send()} disabled={sending || !text.trim() || !atTargets.length}>发送</button>
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
    </div>
  );
}
