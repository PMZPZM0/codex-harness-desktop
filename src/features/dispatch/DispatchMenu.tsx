/**
 * 调度面板（10-29 定稿：面板上**只剩「专家团」一个开关**，专家 / 子智能体是常开能力）。
 *
 * ⛔⛔ 本文件是「调度许可」在 UI 上的唯一入口。用户两轮原话：
 *    ①「将子智能体调用和专家调度改为默认可直接调用，仅专家团功能需要显式开启」
 *      +「不再需要做数量或使用上的限制，每个会话都可以调度它们」；
 *    ②「这里就可以只剩一个专家团就行，展示优化一下」。
 *    ⇒ 结构与文案的最终形态：
 *      · 删掉总开关（它同时是全局独占锁的入口，与"每个会话都能派"冲突）；
 *      · 删掉专家 / 子智能体的开关 —— 三类并排里两个永远开着，是纯噪音，还暗示"默认是关的"；
 *        它们改成一行**只读说明**（含当前数量），点它没反应也不会让人以为坏了；
 *      · 专家团是唯一需要用户动作的一类，用整行 switch 承载，并写清开/关各自意味着什么。
 *    ⛔ 权限边界不在 UI：真正的闸在 `electron/dispatch.ts`（dispatchKindAllowed）+ 执行端
 *       `runDelegatedTask`。面板只是让用户能改「专家团」这一项。
 */

import { Users, Lock, ChevronDown } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPopover } from "../app-view/hooks/useAnchoredPopover";
/* ⛔ 胶囊开关一律走共享 ToggleSwitch（守卫【234】⑧）—— 本面板原先手写了一个
   `.dispatch-toggle`（轨道 + 圆点），与别处长不一样，已换掉。 */
import { ToggleSwitch } from "../../components/SettingsWidgets";

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
  /* 10-29 用户令：「专家数量要实时同步后台有的专家数量」。
     ⛔ 不能只靠父级缓存：`dispatchInfo` 只在 expertTeams/subAgents 变化时才刷一次，
        在设置里新建/停用专家后，面板上的数字会一直停在旧值。
     ⇒ 打开时向主进程拉一次真实目录，打开期间每 3 秒同步（目录是读两个本地文件，代价很小）；
        关闭即停。拉失败就沿用旧值，不把面板清空。 */
  const [liveTargets, setLiveTargets] = useState<DispatchTargetEntry[] | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const pull = async () => {
      try {
        const cat: any = await window.codex.listDispatchCatalog();
        if (alive && Array.isArray(cat?.targets)) setLiveTargets(cat.targets as DispatchTargetEntry[]);
      } catch { /* 保持旧值 */ }
    };
    void pull();
    const timer = window.setInterval(() => { void pull(); }, 3000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [open]);
  const list = liveTargets ?? targets;
  const countOf = (kind: DispatchTargetEntry["kind"]) => list.filter((target) => target.kind === kind).length;
  /* 10-29 用户令：「我专家库里面这么多专家，你为啥就显示 5 个？」
     ⛔ 之前只数 kind==="expert"（单人专家=没有成员的小团队），**团成员全漏了**。
     ⇒ 专家数 = 单人专家 + 每个团的（主理人 1 + 成员数）。这是「专家库角色总数」口径，
        与用户看到的专家库页面一致；团队仍由上面的开关整团派。 */
  const expertCount = list.reduce((sum, target) => {
    if (target.kind === "expert") return sum + 1;
    if (target.kind === "team") return sum + 1 + Number(target.memberCount ?? 0);
    return sum;
  }, 0);
  const subCount = countOf("subagent");
  const teamCount = countOf("team");
  /* CLI 智能体（10-29 晚）：与专家 / 子智能体同待遇（默认可派、没有开关），只报个数让人知道有它。
     ⛔ 0 个时**不显示**这一枚 chip —— 一个「CLI 0」只会让人以为哪里坏了。 */
  const cliCount = countOf("cli");
  /* 面板只有一个开关（专家团）⇒ 脏判定只看它。确认时 expert/subagent 一律写 true：
     界面上没有"关掉专家"这条路，数据里就不该留一个假的关闭态（老记录里若有 false，这里顺手纠正）。 */
  const dirty = draft.team !== (dispatch.team === true);
  const anyAvailable = expertCount + subCount + teamCount + cliCount > 0;
  /*⛔⛔ 2026-10-04 用户报「点调度弹窗展示不出来」——
     根因：`.topbar` 在 d19c510 被加了 `overflow: hidden`（修「图标压到原生窗口钮底下」），
     而本弹层是 `.topbar` 的 `position: absolute` 后代 ⇒ **被整棵子树裁掉**，
     按钮点了、state 也变了，就是看不见。
     ⚠️ z-index 救不了：`overflow: hidden` 裁的是**整棵子树**，与层叠次序无关。
     ✅ 正确做法（与顶栏搜索面板同款，本仓已有先例）：**portal 到 body + position: fixed**。
     定位逻辑共用 `useAnchoredPopover`（⛔ 别在这里另写一份：三处弹层同病，
     各自复制坐标算法 = 以后改一处忘两处）。 */
  /* ⛔ 宽度必须与弹层 CSS 的实际宽度一致（hook 头注释第 3 条）：写 300 而实际 352
     ⇒ 右对齐时右边会溢出视口 52px（审查发现）。
     ⚠️ 这里别写弹层的 class 名：守卫按「文件里第一次出现该名」找 portal 锚点，
        注释里先出现会把判据索引错位（本轮实测）。 */
  const posStyle = useAnchoredPopover(open, wrapRef, 352);
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
            <span className="dispatch-head-ico"><Users size={15} /></span>
            <div className="dispatch-head-text">
              <strong>调度</strong>
              <small>把子任务交给专家或团队，做完回传本会话。</small>
            </div>
          </div>
          {/* 10-29 用户令「这里就可以只剩一个专家团就行」：专家 / 子智能体是**常开能力**，
              面板不再给它们开关（三个开关键里两个永远开着 = 纯噪音，还会让人以为默认是关的）。
              ⛔ 关掉它们的能力仍在执行端（dispatchKindAllowed 看 dispatch.expert/subagent），
                 面板确认时一律写 true —— 界面上没有"关掉专家"这条路，就不该留下一个假的关闭态。 */}
          <div className={`dispatch-master ${draft.team ? "on" : ""}`}>
            <button
              type="button"
              className="dispatch-master-main"
              disabled={teamCount === 0}
              title={teamCount === 0 ? "当前没有已启用的专家团（先到 设置 → 专家/专家团 里新建）" : undefined}
              aria-pressed={draft.team}
              onClick={() => setDraft({ ...draft, team: !draft.team })}
            >
              <span className="dispatch-row-icon"><Users size={14} /></span>
              <span className="dispatch-master-text">
                <strong>专家团{teamCount ? <em>{teamCount}</em> : null}</strong>
                <small>{teamCount === 0
                  ? "还没有启用的专家团（去 设置 → 专家/专家团 新建）"
                  : (draft.team
                    ? "已开启：主理人会安排成员分工协作"
                    : "关闭时只派单人专家，不组队")}</small>
              </span>
            </button>
            <ToggleSwitch
              className="dispatch-master-switch"
              checked={draft.team}
              disabled={teamCount === 0}
              label="专家团联动调度"
              title={draft.team ? "已开启：主理人可调度多名成员协作" : "默认关闭：开启后主理人才会按 SOP 调度成员"}
              onChange={() => setDraft({ ...draft, team: !draft.team })}
            />
          </div>
          {/* 常开能力只做**说明**，不是开关（点它没反应会让人以为坏了） */}
          {/* ⛔ 文案说人话（用户原话：「默认可用，无需开启，啥意思，写清楚」）：
              这两类**本来就能派**，这里没有开关；上方的开关只管「组队」这一件事。
              数字标签也写准：expertCount 只是**单人专家**（没有成员的团队），
              不是全店专家总数（档案里 7 个团共 41 个角色）—— 写「专家 5」会被当成数错。 */}
          <div className="dispatch-always">
            <span className="dispatch-chip" title="专家库里的每一位（主理人与成员）都是独立专家，都能单独使用">专家 <b>{expertCount}</b></span>
            <span className="dispatch-chip">子智能体 <b>{subCount}</b></span>
            {cliCount > 0 && (
              <span className="dispatch-chip" title="在「设置 → 开发工具 → CLI 智能体」里接入的本机命令行工具">
                CLI <b>{cliCount}</b>
              </span>
            )}
            <small>每位专家都能单独用</small>
          </div>
          {/* ⛔ 底部只在「一个可调度对象都没有」时才出声；正常态那句「仅专家团需要开启」
              与卡片副标题重复，属于赘述（用户点名），删掉。 */}
          <div className={`dispatch-foot${anyAvailable ? " no-scope" : ""}`}>
            {!anyAvailable && (
              <small className="dispatch-scope is-warn">当前没有可调度的对象：去设置里启用专家 / 子智能体 / 专家团，或接入一个 CLI</small>
            )}
            <div className="dispatch-actions">
              <button type="button" onClick={() => setOpen(false)}>取消</button>
              <button
                type="button"
                className="primary"
                disabled={!dirty || busy}
                onClick={() => { onChange({ expert: true, subagent: true, team: draft.team }); setOpen(false); }}
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
