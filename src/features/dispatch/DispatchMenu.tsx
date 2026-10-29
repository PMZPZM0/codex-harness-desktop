/**
 * 调度面板（10-29 改版：专家 / 子智能体默认可用，只有专家团需显式开启）。
 *
 * ⛔⛔ 本文件是「调度许可」在 UI 上的唯一入口。10-29 用户令原文：
 *    「将子智能体调用和专家调度改为默认可直接调用，仅专家团功能需要显式开启」
 *    +「不再需要做数量或使用上的限制，每个会话都可以调度它们」。
 *    ⇒ 三处结构性改动（不是纯文案）：
 *      ① **删掉总开关**（原来那行「允许本会话调度」= 全局独占锁的入口）：它与"每个会话都能派"
 *         冲突，且默认可用之后再放一个总闸只会让人以为默认是关的；
 *      ② 三类改成**平行开关**，专家 / 子智能体出厂为开（用户仍可逐类关掉）；
 *      ③ 专家团行**自带说明**「默认关闭 · 需显式开启」—— 唯一需要用户动作的一类。
 *    ⛔ 权限边界不在 UI：真正的闸在 `electron/dispatch.ts`（dispatchKindAllowed）+ 执行端
 *       `runDelegatedTask`。这里拿掉 disabled 只是 UX，绕不过执行端。
 */

import { Sparkles, Users, Bot, Lock, ChevronDown, CircleCheck } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPopover } from "../app-view/hooks/useAnchoredPopover";

/** 三类许可（与 `src/lib/thread-runtime.mjs` 的 DispatchConfig 同形：无总开关）。 */
export type DispatchDraft = { expert: boolean; team: boolean; subagent: boolean };

export function DispatchMenu({ dispatch, targets, onChange, disabled, busy, topbar, restrictedLabel }: {
  dispatch: DispatchDraft;
  targets: DispatchTargetEntry[];
  onChange: (next: DispatchDraft) => void;
  disabled?: boolean;
  busy?: boolean;
  /** 顶栏形态：纯图标按钮 + 弹层向下弹（顶栏一排都是小图标，带文字的 composer 形态放不进去） */
  topbar?: boolean;
  /** 受保护会话（专家 / 专家团 / 被调度会话）时传标签 —— 按钮直接禁用，不让改。 */
  restrictedLabel?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(dispatch);
  const wrapRef = useRef<HTMLDivElement>(null);
  /* 弹层自身（portal 到 body 后已脱离 wrapRef 子树）：「点外面关闭」必须单独问它，
     否则弹层内点击全被判成外部。详见下面 onDown 的注释。 */
  const popRef = useRef<HTMLDivElement>(null);
  // 每次打开都从「当前生效值」起算：上一次没点确认就关掉时，草稿不该残留
  useEffect(() => { if (open) setDraft(dispatch); }, [open, dispatch]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (!open) return;
    /*⛔⛔ 2026-10-04 用户报「界面出来了，点一下又消失」——**我上一个提交造成的**。
       原因：弹层改成 `portal 到 body` 后，它**不在 wrapRef 的 DOM 子树里**
       ⇒ `wrapRef.current.contains(点到的节点)` 恒为 false
       ⇒ 弹层内部**任何一次点击**（含点开关、点行）都被判成"点了外面"⇒ 立刻关闭。
       ✅ 修法：判定要同时问两个容器 —— 按钮的 wrap **和** 弹层自己（popRef）。
       ⚠️ 这类错 tsc/build/旧守卫全绿：逻辑合法，只是 ref 指错了地方。 */
    const onDown = (event: globalThis.MouseEvent) => {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (popRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);
  const countOf = (kind: DispatchTargetEntry["kind"]) => targets.filter((target) => target.kind === kind).length;
  /* ⛔ 顺序即语义：先列**默认可用**的两类（平时不用动），最后是**需要显式开启**的专家团。 */
  const rows: { key: keyof DispatchDraft; title: string; hint: string; n: number; icon: any }[] = [
    { key: "expert", title: "专家", hint: "默认可用 · 代码审查 / 内容创作 / 演示文稿等单人专家", n: countOf("expert"), icon: Sparkles },
    { key: "subagent", title: "子智能体", hint: "默认可用 · 你在设置里配置的自定义角色", n: countOf("subagent"), icon: Bot },
    { key: "team", title: "专家团", hint: "默认关闭 · 需显式开启：主理人按 SOP 调度多名成员协作", n: countOf("team"), icon: Users },
  ];
  const dirty = JSON.stringify(draft) !== JSON.stringify(dispatch);
  const anyAvailable = rows.some((row) => row.n > 0);
  /*⛔⛔ 2026-10-04 用户报「点调度弹窗展示不出来」——
     根因：`.topbar` 在 d19c510 被加了 `overflow: hidden`（修「图标压到原生窗口钮底下」），
     而本弹层是 `.topbar` 的 `position: absolute` 后代 ⇒ **被整棵子树裁掉**，
     按钮点了、state 也变了，就是看不见。
     ⚠️ z-index 救不了：`overflow: hidden` 裁的是**整棵子树**，与层叠次序无关。
     ✅ 正确做法（与顶栏搜索面板同款，本仓已有先例）：**portal 到 body + position: fixed**。
     定位逻辑共用 `useAnchoredPopover`（⛔ 别在这里另写一份：三处弹层同病，
     各自复制坐标算法 = 以后改一处忘两处）。 */
  const posStyle = useAnchoredPopover(open, wrapRef, 300);
  const teamOn = dispatch.team === true;
  return (
    <div className={`composer-menu dispatch-menu ${open ? "open" : ""}`} ref={wrapRef}>
      {topbar ? (
        <button
          type="button"
          className={`icon-button dispatch-topbar-btn ${teamOn ? "dispatch-on" : ""} ${restrictedLabel ? "is-restricted" : ""}`}
          disabled={disabled || Boolean(restrictedLabel)}
          title={restrictedLabel
            ? `本会话是${restrictedLabel}会话，不开放调度 —— 专家 / 专家团有自己的团内协作，对外派人会让「谁在干活」失控`
            : `调度：专家 / 子智能体默认可派；专家团${teamOn ? "已开启" : "未开启（需显式开启）"}`}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {restrictedLabel ? <Lock size={16} /> : <Users size={16} />}
          {teamOn && <i className="dispatch-dot" aria-hidden />}
        </button>
      ) : (
        <button
          type="button"
          className={`composer-setting ${teamOn ? "dispatch-on" : ""}`}
          disabled={disabled}
          title="调度设置"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Users size={14} />
          <span>调度{teamOn ? " · 含专家团" : ""}</span>
          <ChevronDown size={12} className={`menu-caret ${open ? "up" : ""}`} />
        </button>
      )}
      {open && createPortal(
        <div
          ref={popRef}
          className={`composer-menu-pop dispatch-pop${topbar ? " dispatch-pop-fixed" : " dispatch-pop-down"}`}
          role="dialog"
          aria-label="调度设置"
          style={topbar ? posStyle : undefined}
        >
          <div className="dispatch-head">
            <strong>调度</strong>
            <small>把合适的独立子任务交给专门的角色去做，产出回传本会话（每次派活开一个独立会话，上下文互不串）</small>
          </div>
          <div className="dispatch-rows">
            {rows.map((row) => {
              const Icon = row.icon;
              const empty = row.n === 0;
              return (
                <button
                  type="button"
                  key={row.key}
                  className={`dispatch-row ${draft[row.key] ? "checked" : ""}`}
                  disabled={empty}
                  title={empty ? "当前没有已启用的对象（先到设置里新建 / 启用）" : undefined}
                  onClick={() => setDraft({ ...draft, [row.key]: !draft[row.key] })}
                >
                  <span className="dispatch-row-icon"><Icon size={14} /></span>
                  <span className="dispatch-row-text">
                    <strong>{row.title}{row.n ? <em>{row.n}</em> : null}</strong>
                    <small>{empty ? "当前没有已启用的对象" : row.hint}</small>
                  </span>
                  <span className="dispatch-row-check">{draft[row.key] ? <CircleCheck size={15} /> : null}</span>
                </button>
              );
            })}
          </div>
          <div className="dispatch-foot">
            <small className="dispatch-scope">
              {!anyAvailable
                ? "⚠️ 当前没有可调度的对象：先去设置里启用专家 / 子智能体 / 专家团"
                : "专家/子智能体默认可用；专家团需显式开启"}
            </small>
            <div className="dispatch-actions">
              <button type="button" onClick={() => setOpen(false)}>取消</button>
              <button
                type="button"
                className="primary"
                disabled={!dirty || busy}
                onClick={() => { onChange(draft); setOpen(false); }}
              >
                {busy ? "应用中…" : "确认"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
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
