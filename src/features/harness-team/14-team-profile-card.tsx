/**
 * 团队模式 · 伙伴资料卡（11-07 用户令）
 *
 * 用户原话：「伙伴资料卡（点头像看身份/模型/群内统计）」。
 * 飞书 §2.1 的口径是点机器人头像弹资料卡（`("bot", { avatarRect, botId, relative })`），
 * 这里做本地等价物：**独立板块**（ARCHITECTURE-RULES §2.2），⛔ 不往群视图里顺手加块。
 *
 * ⛔ 数据必须真实：身份取 `group.members` + 调度目录（主理人/职业），
 *    群内统计取**群消息投影**与**群台账**（`harnessTeamLedger`，按 memberId 聚合）。
 *    拿不到就显示「—」/0，⛔ 不编假数据。
 * ⛔ 模型是「本轮派活会用的那个」（群设置 → 跟随全局 / 指定模型），不是成员的私有字段
 *    —— 成员档案里没有模型，写一个假值比不写更糟。
 */
import { useEffect, useMemo, useState } from "react";
import { AtSign, Square, X, Pencil, Check } from "lucide-react";
import type { GroupMessageRow, TeamGroup, TeamMember } from "./01-team-types";
import { MemberAvatar } from "./13-team-avatar";
import { resolveManagerId } from "../../lib/team-models.mjs";
import { formatChars, formatMs, formatTokens } from "../../lib/team-ledger.mjs";
import { useEscapeLayer } from "../../hooks/useEscapeLayer";

type CatalogEntry = { kind: string; key: string; name: string; profession?: string; teamId?: string };

type LedgerStat = {
  count: number;
  chars: number;
  totalTokens: number;
  failed: number;
  avgMs: number;
};

const KIND_LABEL: Record<string, string> = {
  expert: "专家",
  team: "专家团",
  member: "团成员",
  subagent: "子智能体",
  cli: "CLI 智能体",
};

const CARD_W = 306;

function fmtWhen(at: number): string {
  if (!at) return "—";
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 成员资料卡：身份、在本群的产出统计、可 @ / 可停止。 */
export function TeamProfileCard({
  member, group, rows, catalog, modelName, running, anchor, onClose, onMention, onStop, onRename,
}: {
  member: TeamMember;
  group: TeamGroup;
  rows: GroupMessageRow[];
  catalog: CatalogEntry[];
  /** 本轮派活会用到的模型（群 composer 的生效值） */
  modelName: string;
  running: boolean;
  anchor: { x: number; y: number };
  onClose: () => void;
  onMention: (memberId: string) => void;
  onStop: (memberId: string) => void;
  /** 成员改名（11-09）：主进程改群档案 + 伙伴会话标题；成功后关卡片。 */
  onRename?: (name: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  useEscapeLayer(true, onClose);
  const [stat, setStat] = useState<LedgerStat | null>(null);
  const [statReady, setStatReady] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(String(member.name ?? ""));
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState("");
  /* ⛔ 团成员的显示名来自专家目录（资料卡显示主理人名），群内改名不会改变展示 ⇒ 不提供入口；
     人类成员跟随用户中心。只有绑定到专家/子智能体/CLI 的伙伴可以群内改名。 */
  const canRename = Boolean(onRename) && member.kind === "bot" && member.targetKind !== "team";

  /* 台账按「成员 id」聚合（主进程 `summarizeLedger` 的 byPartner）。
     ⛔ 人类成员没有台账，直接跳过；⛔ 读失败也不弹错（旁路观测不影响资料卡）。 */
  useEffect(() => {
    if (member.kind !== "bot") { setStatReady(true); return; }
    let alive = true;
    void (async () => {
      try {
        const res = await window.codex.harnessTeamLedger(group.id, 30);
        const list = Array.isArray(res?.byPartner) ? res.byPartner : [];
        const hit = list.find((x: Record<string, unknown>) => String(x?.memberId ?? "") === member.id);
        if (alive) {
          setStat(hit
            ? {
              count: Number(hit.count ?? 0) || 0,
              chars: Number(hit.chars ?? 0) || 0,
              totalTokens: Number(hit.totalTokens ?? 0) || 0,
              failed: Number(hit.failed ?? 0) || 0,
              avgMs: Number(hit.avgMs ?? 0) || 0,
            }
            : null);
        }
      } catch { /* 台账读不到 = 显示 0 */ }
      finally { if (alive) setStatReady(true); }
    })();
    return () => { alive = false; };
  }, [group.id, member.id, member.kind]);

  const lead = useMemo(
    () => (member.targetKind === "team"
      ? catalog.find((t) => t.kind === "expert" && t.teamId === member.targetKey) ?? null
      : null),
    [catalog, member.targetKind, member.targetKey],
  );
  const kids = useMemo(
    () => (member.targetKind === "team"
      ? catalog.filter((t) => t.kind === "member" && t.teamId === member.targetKey)
      : []),
    [catalog, member.targetKind, member.targetKey],
  );
  const personName = lead?.name || member.name;
  const personRole = lead?.profession || member.targetProfession || (member.id === group.leadId ? "群主" : "伙伴");
  const managerId = resolveManagerId(group, member.id);
  const managerName = managerId ? group.members.find((m) => m.id === managerId)?.name ?? managerId : "";
  const mine = useMemo(() => rows.filter((r) => r.authorId === member.id), [rows, member.id]);
  const lastAt = mine.reduce((max, r) => Math.max(max, Number(r.at) || 0), 0);
  const face = lead ? { ...member, targetKind: "expert", targetKey: lead.key, name: lead.name } : member;

  const saveRename = async () => {
    if (!onRename || renameBusy) return;
    const next = draft.trim();
    if (!next) { setRenameError("名字不能为空"); return; }
    setRenameBusy(true);
    setRenameError("");
    try {
      const res = await onRename(next);
      if (res?.ok) { setRenaming(false); onClose(); return; }
      setRenameError(res?.error || "改名失败");
    } catch (error) {
      setRenameError(String((error as { message?: string } | null)?.message ?? error) || "改名失败");
    } finally {
      setRenameBusy(false);
    }
  };

  const left = Math.min(Math.max(10, anchor.x), Math.max(10, window.innerWidth - CARD_W - 12));
  const top = Math.min(Math.max(10, anchor.y), Math.max(10, window.innerHeight - 120));

  return (
    <div
      className="team-profile-layer"
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <section
        className="team-profile"
        style={{ left, top, width: CARD_W }}
        role="dialog"
        aria-label={`${personName} 的资料卡`}
      >
        <header className="team-profile__head">
          <span className="team-profile__avatar"><MemberAvatar member={face} size={38} /></span>
          <div className="team-profile__id">
            {renaming ? (
              <div className="team-profile__rename">
                <input
                  className="team-profile__rename-input"
                  value={draft}
                  autoFocus
                  maxLength={24}
                  aria-label="成员新名字"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); void saveRename(); }
                    if (e.key === "Escape") { e.preventDefault(); setRenaming(false); setRenameError(""); }
                  }}
                />
                <button type="button" className="team-profile__rename-save" title="保存" disabled={renameBusy} onClick={() => void saveRename()}>
                  <Check size={12} />
                </button>
                <button type="button" className="team-profile__rename-cancel" title="取消" onClick={() => { setRenaming(false); setRenameError(""); }}>
                  <X size={12} />
                </button>
              </div>
            ) : (
              <strong>{personName}</strong>
            )}
            <small>{personRole}</small>
            <span className="team-profile__badges">
              {member.id === group.leadId && <em className="is-lead">群主</em>}
              {lead && <em className="is-team">主理人</em>}
              {member.muted && <em className="is-muted">已静音</em>}
              {running && <em className="is-live">处理中</em>}
            </span>
            {renameError && <em className="team-profile__rename-error" role="alert">{renameError}</em>}
          </div>
          <button type="button" className="team-profile__close" aria-label="关闭资料卡" onClick={onClose}>
            <X size={13} />
          </button>
        </header>

        <dl className="team-profile__rows">
          <div>
            <dt>身份</dt>
            <dd>{member.kind === "human" ? "用户（群里的你）" : KIND_LABEL[member.targetKind] || "未绑定"}</dd>
          </div>
          <div>
            <dt>绑定</dt>
            <dd title={member.targetKey}>{member.targetKey ? `${member.targetKind}:${member.targetKey}` : "未绑定智能体"}</dd>
          </div>
          <div>
            <dt>上级</dt>
            <dd>{managerName || "—"}</dd>
          </div>
          <div>
            <dt>模型</dt>
            <dd title="群输入框选的派活模型；空 = 跟随全局当前模型">{modelName || "跟随全局"}</dd>
          </div>
          {kids.length > 0 && (
            <div>
              <dt>团成员</dt>
              <dd>{kids.length} 位（{kids.map((k) => k.name).join("、")}）</dd>
            </div>
          )}
        </dl>

        <section className="team-profile__stats">
          <h4>群内统计 <small>近 30 天</small></h4>
          <div className="team-profile__grid">
            <span><b>{mine.length}</b>条发言</span>
            <span><b>{lastAt ? fmtWhen(lastAt) : "—"}</b>最近发言</span>
            <span><b>{statReady ? (member.kind === "bot" ? stat?.count ?? 0 : "—") : "…"}</b>次派活</span>
            <span><b>{statReady ? formatChars(stat?.chars ?? 0) : "…"}</b>字</span>
            <span><b>{statReady ? formatTokens(stat?.totalTokens ?? 0) : "…"}</b>tokens</span>
            <span><b>{statReady ? formatMs(stat?.avgMs ?? 0) : "…"}</b>平均耗时</span>
          </div>
          {(stat?.failed ?? 0) > 0 && <p className="team-profile__warn">有 {stat?.failed} 次派活失败（群里应有失败说明）</p>}
        </section>

        <footer className="team-profile__actions">
          {canRename && !renaming && (
            <button type="button" onClick={() => { setDraft(String(member.name ?? "")); setRenaming(true); setRenameError(""); }}>
              <Pencil size={12} /> 改名字
            </button>
          )}
          <button type="button" onClick={() => { onMention(member.id); onClose(); }}>
            <AtSign size={13} /> 加进本轮 @
          </button>
          {running && member.kind === "bot" && (
            <button type="button" className="is-danger" onClick={() => onStop(member.id)}>
              <Square size={12} /> 停止
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
