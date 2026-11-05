/**
 * 团队模式 · 群设置（P0）
 *
 * 只做「伙伴 / 上下级 / 群护栏」三块，全部读写走 props 传进来的动作（⛔ 组件内不直接调桥）。
 * ⛔ 权限说明写文案，不用 disabled 表达归属（项目纪律：disabled 是准入，不是说明）。
 */
import { useState } from "react";
import type { TeamGroup } from "./01-team-types";
import { LOCAL_ACTOR_ID } from "./02-team-store";
import { AppSelect } from "../../components/AppSelect";

type Props = {
  group: TeamGroup;
  issues?: string[];
  limit: number;
  onAddPartner: (partner: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  onRemovePartner: (partnerId: string) => Promise<{ ok: boolean; error?: string }>;
  onMute: (partnerId: string, muted: boolean) => Promise<{ ok: boolean; error?: string }>;
  onSetGuard: (guard: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
};

const SCOPES: { value: TeamGroup["guard"]["scope"]; label: string }[] = [
  { value: "project", label: "仅本项目" },
  { value: "dept", label: "本部门" },
  { value: "all", label: "不限" },
];

export function TeamSettings({ group, issues, limit, onAddPartner, onRemovePartner, onMute, onSetGuard }: Props) {
  const [partnerName, setPartnerName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const partners = group.members.filter((m) => m.kind === "bot");
  const isLead = group.leadId === LOCAL_ACTOR_ID;

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    const r = await fn();
    setMsg(r.ok ? "" : r.error || "操作失败");
    setBusy(false);
  };

  const addPartner = async () => {
    const name = partnerName.trim();
    if (!name) return;
    await run(async () => {
      const r = await onAddPartner({ id: `bot_${Date.now().toString(36)}`, name, kind: "bot" });
      if (r.ok) setPartnerName("");
      return r;
    });
  };

  return (
    <div className="team-settings">
      <section className="team-settings__block">
        <h3>
          伙伴 <span className="team-settings__count">{partners.length} / {limit}</span>
        </h3>
        <p className="team-settings__hint">
          伙伴就是团队里的智能体成员。@ 它就能派活；只有<strong>群主</strong>和<strong>添加者</strong>可以移除。
        </p>
        <ul className="team-settings__list">
          {partners.map((p) => (
            <li key={p.id} className="team-settings__row">
              <span className="team-settings__avatar" aria-hidden>{p.name.slice(0, 1)}</span>
              <span className="team-settings__name">
                {p.name}
                {p.id === group.leadId && <em className="team-settings__tag">群主</em>}
                {p.muted && <em className="team-settings__tag team-settings__tag--muted">已静音</em>}
              </span>
              <button type="button" className="team-settings__mini" onClick={() => void run(() => onMute(p.id, !p.muted))} disabled={busy}>
                {p.muted ? "取消静音" : "静音"}
              </button>
              <button type="button" className="team-settings__mini team-settings__mini--danger" onClick={() => void run(() => onRemovePartner(p.id))} disabled={busy}>
                移除
              </button>
            </li>
          ))}
          {!partners.length && <li className="team-settings__empty">还没有伙伴，下面加一个</li>}
        </ul>
        <div className="team-settings__add">
          <input
            value={partnerName}
            onChange={(e) => setPartnerName(e.target.value)}
            placeholder="伙伴名字（如：数据师）"
            onKeyDown={(e) => { if (e.key === "Enter") void addPartner(); }}
          />
          <button type="button" onClick={() => void addPartner()} disabled={busy || partners.length >= limit}>
            添加伙伴
          </button>
        </div>
        {partners.length >= limit && <p className="team-settings__hint">已达上限（最多 {limit} 个伙伴）</p>}
        {msg && <p className="team-settings__error" role="status">{msg}</p>}
      </section>

      <section className="team-settings__block">
        <h3>群护栏</h3>
        <p className="team-settings__hint">护栏决定这个群能把活派到哪、会不会被打扰。</p>
        <label className="team-settings__row">
          <span>协作范围</span>
          <AppSelect
            value={group.guard.scope}
            onChange={(value) => void run(() => onSetGuard({ scope: value }))}
            options={SCOPES.map((s) => ({ value: s.value, label: s.label }))}
            ariaLabel="协作范围"
            disabled={busy}
          />
        </label>
        <label className="team-settings__row">
          <span>允许外部成员加入</span>
          <input
            type="checkbox"
            checked={group.guard.allowExternal}
            onChange={(e) => void run(() => onSetGuard({ allowExternal: e.target.checked }))}
            disabled={busy}
          />
        </label>
        <label className="team-settings__row">
          <span>响应 @所有人</span>
          <input
            type="checkbox"
            checked={group.guard.respondToEveryone}
            onChange={(e) => void run(() => onSetGuard({ respondToEveryone: e.target.checked }))}
            disabled={busy}
          />
        </label>
        <p className="team-settings__hint">
          默认关闭后两条：外部成员拉不进来，@所有人 不会把伙伴全部叫醒。
        </p>
      </section>

      <section className="team-settings__block">
        <h3>上下级</h3>
        <p className="team-settings__hint">
          上下级决定谁能把活派给谁（委派白名单）。当前群主：{group.members.find((m) => m.id === group.leadId)?.name ?? group.leadId}
          {isLead ? "（你）" : ""}。
        </p>
        <ul className="team-settings__list">
          {group.members.map((m) => (
            <li key={m.id} className="team-settings__row team-settings__row--plain">
              <span className="team-settings__name">{m.name}</span>
              <span className="team-settings__meta">
                上级：{m.managerId ? group.members.find((x) => x.id === m.managerId)?.name ?? m.managerId : "—"}
                {m.canDelegate.length > 0 && ` · 可派给 ${m.canDelegate.length} 人`}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {issues && issues.length > 0 && (
        <section className="team-settings__block team-settings__block--warn">
          <h3>体检</h3>
          <ul>{issues.map((s) => <li key={s}>{s}</li>)}</ul>
        </section>
      )}
    </div>
  );
}
