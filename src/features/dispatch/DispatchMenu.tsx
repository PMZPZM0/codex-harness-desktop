/**
 * 调度域（从 src/App.tsx 原样搬来，纯搬迁零行为改动）。
 *
 * 公开面见同目录 index.ts。
 */

import { Sparkles, Users, Bot, Lock, ChevronDown, Trash2, CircleCheck } from "lucide-react";
import { useState, useRef, useEffect } from "react";

export function DispatchMenu({ dispatch, targets, onChange, disabled, busy, topbar, lockedBy, onReleaseHolder, restrictedLabel }: {
  dispatch: { enabled: boolean; expert: boolean; team: boolean; subagent: boolean };
  targets: DispatchTargetEntry[];
  onChange: (next: { enabled: boolean; expert: boolean; team: boolean; subagent: boolean }, opts?: { takeOver?: boolean }) => void;
  disabled?: boolean;
  busy?: boolean;
  /** 顶栏形态：纯图标按钮 + 弹层向下弹（顶栏一排都是小图标，带文字的 composer 形态放不进去） */
  topbar?: boolean;
  /** 另一个会话正持有调度独占锁时传它的显示名（本会话是持有者/没人在用时传 null）。
   *  同一时间只允许一个会话调度 —— 这里把开关置为「锁定」态并给出接管入口。 */
  lockedBy?: string | null;
  /** ⛔ 一键释放（用户 09-17 要求「在调度里面加一个主动释放功能，一键释放后删除旧的调度会话」）：
   *  把调度权从旧持有者手里收回，并删除那条旧调度会话。父组件负责确认与级联删除。 */
  onReleaseHolder?: () => void;
  /** 受保护会话（专家 / 专家团 / 被调度会话）时传标签 —— 按钮直接禁用，不让开。 */
  restrictedLabel?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(dispatch);
  const wrapRef = useRef<HTMLDivElement>(null);
  // 每次打开都从「当前生效值」起算：上一次没点确认就关掉时，草稿不该残留
  useEffect(() => { if (open) setDraft(dispatch); }, [open, dispatch]);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: globalThis.MouseEvent) => { if (!wrapRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);
  const countOf = (kind: DispatchTargetEntry["kind"]) => targets.filter((target) => target.kind === kind).length;
  const rows: { key: "expert" | "team" | "subagent"; title: string; hint: string; n: number; icon: any }[] = [
    { key: "expert", title: "专家", hint: "代码审查 / 内容创作 / 演示文稿等单人专家", n: countOf("expert"), icon: Sparkles },
    { key: "team", title: "专家团", hint: "由主理人按 SOP 调度多名成员协作", n: countOf("team"), icon: Users },
    { key: "subagent", title: "子智能体", hint: "你在设置里配置的自定义角色", n: countOf("subagent"), icon: Bot },
  ];
  const dirty = JSON.stringify(draft) !== JSON.stringify(dispatch);
  return (
    <div className={`composer-menu dispatch-menu ${open ? "open" : ""}`} ref={wrapRef}>
      {topbar ? (
        <button
          type="button"
          className={`icon-button dispatch-topbar-btn ${dispatch.enabled ? "dispatch-on" : ""} ${restrictedLabel ? "is-restricted" : ""}`}
          disabled={disabled || Boolean(restrictedLabel)}
          title={restrictedLabel
            ? `本会话是${restrictedLabel}会话，不开放调度 —— 专家 / 专家团有自己的团内协作，对外派人会让「谁在干活」失控`
            : (dispatch.enabled ? "调度（已开启）：本会话 Codex 可把子任务交给专家 / 专家团 / 子智能体" : "调度：让 Codex 把合适的独立子任务交给专家 / 专家团 / 子智能体")}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {restrictedLabel ? <Lock size={16} /> : <Users size={16} />}
          {dispatch.enabled && <i className="dispatch-dot" aria-hidden />}
        </button>
      ) : (
        <button
          type="button"
          className={`composer-setting ${dispatch.enabled ? "dispatch-on" : ""}`}
          disabled={disabled}
          title="调度设置"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Users size={14} />
          <span>调度{dispatch.enabled ? " · 开" : ""}</span>
          <ChevronDown size={12} className={`menu-caret ${open ? "up" : ""}`} />
        </button>
      )}
      {open && (
        <div className={`composer-menu-pop dispatch-pop ${topbar ? "dispatch-pop-down" : ""}`} role="dialog" aria-label="调度设置">
          <div className="dispatch-head">
            <strong>调度</strong>
            <small>把合适的独立子任务交给专门的角色去做，产出回传本会话</small>
          </div>
          {/* 独占锁提示：同一时间只允许一个会话调度（用户 09-16 要求「其他灰掉，避免同时调用」） */}
          {lockedBy && (
            <div className={`dispatch-lock ${draft.enabled ? "takeover" : ""}`}>
              <Lock size={13} />
              <span>
                <strong>已被「{lockedBy}」占用</strong>
                <small>{draft.enabled ? "确认后会把调度权限移到本会话，原会话的开关自动关闭" : "同一时间只允许一个会话调度；开启即从它那里接管"}</small>
                {/* ⛔ 一键释放（用户 09-17 要求）：把调度权从旧会话手里收回，并删除那条旧调度会话。
                    为什么必须有这个显式入口：持有者是从 thread-runtime 记录**派生**的，而会话被
                    归档/删除时历史上没人清记录 ⇒ 孤儿记录永久占着全局唯一的调度权；那条会话还可能
                    根本不在侧栏里（用户找不到、也就关不掉）。自动自愈只管「持有者已不在列表」，
                    持有者还在列表里、用户就是想清掉它时，靠这个按钮。 */}
                <button
                  type="button"
                  className="dispatch-release"
                  disabled={busy}
                  onClick={() => { setOpen(false); onReleaseHolder?.(); }}
                >
                  <Trash2 size={12} />释放并删除该会话
                </button>
              </span>
            </div>
          )}
          {/* 总开关做成整行可点的 switch：比裸勾选框直观，状态文案跟着变 */}
          <button
            type="button"
            role="switch"
            aria-checked={draft.enabled}
            className={`dispatch-master ${draft.enabled ? "on" : ""}`}
            onClick={() => setDraft({ ...draft, enabled: !draft.enabled })}
          >
            <span className="dispatch-master-text">
              <strong>允许本会话调度</strong>
              <small>{draft.enabled
                ? (lockedBy ? `接管中：将关掉「${lockedBy}」的调度` : "已开启：Codex 可以派人干活了")
                : (lockedBy ? "已锁定：权限在别的会话手里" : "关闭中：Codex 所有事都自己干")}</small>
            </span>
            <span className="dispatch-toggle" aria-hidden><i /></span>
          </button>
          <div className={`dispatch-rows ${draft.enabled ? "" : "is-off"}`}>
            {rows.map((row) => {
              const Icon = row.icon;
              const lockedOff = !draft.enabled || row.n === 0;
              return (
                <button
                  type="button"
                  key={row.key}
                  className={`dispatch-row ${draft[row.key] && !lockedOff ? "checked" : ""}`}
                  disabled={lockedOff}
                  title={row.n === 0 ? "当前没有已启用的对象" : undefined}
                  onClick={() => setDraft({ ...draft, [row.key]: !draft[row.key] })}
                >
                  <span className="dispatch-row-icon"><Icon size={14} /></span>
                  <span className="dispatch-row-text">
                    <strong>{row.title}{row.n ? <em>{row.n}</em> : null}</strong>
                    <small>{row.n ? row.hint : "当前没有已启用的对象"}</small>
                  </span>
                  <span className="dispatch-row-check">{draft[row.key] && !lockedOff ? <CircleCheck size={15} /> : null}</span>
                </button>
              );
            })}
          </div>
          <div className="dispatch-foot">
            <small className="dispatch-scope">仅对当前会话生效</small>
            <div className="dispatch-actions">
              <button type="button" onClick={() => setOpen(false)}>取消</button>
              <button
                type="button"
                className="primary"
                disabled={!dirty || busy}
                onClick={() => { onChange(draft, { takeOver: Boolean(lockedBy) && draft.enabled }); setOpen(false); }}
              >
                {busy ? "应用中…" : (lockedBy && draft.enabled ? "接管并开启" : "确认")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function DispatchBadge({ record }: { record: DelegateRecordEntry }) {
  const tone = record.status === "running" ? "run" : record.status === "failed" ? "fail" : "done";
  const label = record.status === "running" ? "调度中" : record.status === "failed" ? "调度失败" : "调度";
  const note = record.status === "running" ? "执行中" : record.status === "failed" ? "执行失败" : "已完成";
  return <span className={`thread-dispatch-badge tone-${tone}`} title={`调度会话：${record.name}（${note}）`}>{label}</span>;
}

