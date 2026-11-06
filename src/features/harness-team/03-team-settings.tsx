/**
 * 团队模式 · 群设置（P0）
 *
 * 只做「伙伴 / 上下级 / 群护栏」三块，全部读写走 props 传进来的动作
 * （⛔ 组件内不直接调桥 —— 唯一例外是**只读**拉一次调度目标清单，见下面 loadCatalog）。
 * ⛔ 权限说明写文案，不用 disabled 表达归属（项目纪律：disabled 是准入，不是说明）。
 */
import { useEffect, useMemo, useState } from "react";
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
  onDeleteGroup?: () => Promise<{ ok: boolean; error?: string }>;
};

const SCOPES: { value: TeamGroup["guard"]["scope"]; label: string }[] = [
  { value: "project", label: "仅本项目" },
  { value: "dept", label: "本部门" },
  { value: "all", label: "不限" },
];

/** 调度目标的一条（与 `listDispatchCatalog()` 的返回一致；这里只声明用得到的字段）。 */
type Target = { kind: string; key: string; name: string; profession?: string; teamId?: string; installed?: boolean };

const KIND_LABEL: Record<string, string> = {
  member: "专家团成员",
  expert: "专家",
  team: "专家团",
  subagent: "子智能体",
  cli: "本机 CLI",
};

export function TeamSettings({ group, issues, limit, onAddPartner, onRemovePartner, onMute, onSetGuard, onDeleteGroup }: Props) {
  const [targets, setTargets] = useState<Target[]>([]);
  const [catalogError, setCatalogError] = useState("");
  const [pick, setPick] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const partners = group.members.filter((m) => m.kind === "bot");
  const isLead = group.leadId === LOCAL_ACTOR_ID;

  /* ⛔ 伙伴**必须**是真实调度目标：手打出来的名字派不了活（P0b 起）。
     ⇒ 这里拉一次 `agents:catalog`（与模型自己派活用的是同一份清单，⛔ 不另建一套池子）。 */
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await window.codex.listDispatchCatalog();
        if (!alive) return;
        const list = Array.isArray(res?.targets) ? (res.targets as Target[]) : [];
        setTargets(list.filter((t) => t && t.kind && t.name && t.installed !== false));
        setCatalogError("");
      } catch (err) {
        if (alive) setCatalogError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { alive = false; };
  }, []);

  /** 已经在这个群里的目标不重复列（按 目标身份 判，不按显示名） */
  const options = useMemo(() => {
    const taken = new Set(partners.map((p) => `${p.targetKind}:${p.targetKey}`));
    return targets
      .map((t, index) => ({ index, t }))
      .filter(({ t }) => !taken.has(`${t.kind}:${t.key}`))
      .map(({ index, t }) => ({
        value: String(index),
        label: `${KIND_LABEL[t.kind] ?? t.kind} · ${t.name}${t.profession ? `（${t.profession}）` : ""}`,
      }));
  }, [targets, partners]);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    const r = await fn();
    setMsg(r.ok ? "" : r.error || "操作失败");
    setBusy(false);
  };

  const addPartner = async () => {
    const target = targets[Number(pick)];
    if (!target) return;
    await run(async () => {
      /* ⛔ id 由目标身份决定：同一目标加两次会被纯函数判重复（幂等），不会出现两个「数据师」 */
      const r = await onAddPartner({
        id: `tgt:${target.kind}:${target.key}`,
        kind: "bot",
        name: target.name,
        targetKind: target.kind,
        targetKey: target.key,
      });
      if (r.ok) setPick("");
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
                {p.targetKind
                  ? <em className="team-settings__tag">{KIND_LABEL[p.targetKind] ?? p.targetKind}</em>
                  : <em className="team-settings__tag team-settings__tag--warn" title="手打的名字没有对应的智能体，派不了活">未绑定</em>}
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
          {options.length ? (
            <AppSelect
              value={pick}
              onChange={setPick}
              options={[{ value: "", label: "选一个智能体…" }, ...options]}
              ariaLabel="选择要加入的智能体"
              disabled={busy || partners.length >= limit}
            />
          ) : (
            <span className="team-settings__empty">
              {catalogError ? `读不到智能体清单：${catalogError}` : "没有可加的智能体（先在专家团 / 子智能体里建一个）"}
            </span>
          )}
          <button type="button" onClick={() => void addPartner()} disabled={busy || !pick || partners.length >= limit}>
            添加伙伴
          </button>
        </div>
        {partners.length >= limit && <p className="team-settings__hint">已达上限（最多 {limit} 个伙伴）</p>}
        {/* ⛔ 权限的真相在主进程（threadRuntime.dispatch.team），这里只说清"为什么某个伙伴派不出去" */}
        <p className="team-settings__hint">
          「专家 / 子智能体 / 本机 CLI」开箱可派；<strong>「专家团成员」需要先在顶栏的调度面板里打开「专家团」</strong>
          ，否则派活会被主进程挡下并回一条说明。
        </p>
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

      {onDeleteGroup && (
        <section className="team-settings__block team-settings__block--warn">
          <h3>解散这个群</h3>
          <p className="team-settings__hint">
            只删群和群里的消息记录；<strong>伙伴自己的会话一条都不会动</strong>（那些会话还在侧栏里）。
          </p>
          {confirmDelete ? (
            <div className="team-settings__row">
              <span className="team-settings__meta">确定解散「{group.name}」？</span>
              <button type="button" className="team-settings__mini" onClick={() => setConfirmDelete(false)} disabled={busy}>取消</button>
              <button
                type="button"
                className="team-settings__mini team-settings__mini--danger"
                onClick={() => void run(() => onDeleteGroup())}
                disabled={busy}
              >
                确认解散
              </button>
            </div>
          ) : (
            <button type="button" className="team-settings__mini team-settings__mini--danger" onClick={() => setConfirmDelete(true)} disabled={busy}>
              解散群
            </button>
          )}
        </section>
      )}

      {issues && issues.length > 0 && (
        <section className="team-settings__block team-settings__block--warn">
          <h3>体检</h3>
          <ul>{issues.map((s) => <li key={s}>{s}</li>)}</ul>
        </section>
      )}
    </div>
  );
}
