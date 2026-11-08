/**
 * 团队模式 · @ 候选面板（11-07 用户令）
 *
 * 用户原话：「输入框上面这个列表，改成 @ 面板」+「@ 候选面板（机器人单独一类）」。
 * 飞书 §4 的候选分类是 `single_user` / `single_bot` / `user_group`；本地对应：
 *   · 机器人（single_bot）：能单独派活的伙伴；
 *   · 专家团（user_group）：点它 = 叫整团；
 *   · 团成员：团里那几个人（点它同样落到「叫整团」，由主理人分派）。
 *
 * ⛔ 纯展示：分类/过滤/替换文本都在 `src/lib/team-mention.mjs`（可单测），这里只画。
 * ⛔ 面板不自己管 open（父层持有），因为它有两种打开方式：点 @ 按钮、在输入框打 `@`。
 */
import { useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import { createPortal } from "react-dom";
import { AtSign, Check, X } from "lucide-react";
import type { MentionSection } from "../../lib/team-mention.mjs";
import { matchMentionCandidates } from "../../lib/team-mention.mjs";
import { useAnchoredPopover } from "../../lib/use-centered-popover";
import { MemberAvatar } from "./13-team-avatar";

type Props = {
  /** 11-08 用户令：「@ 弹窗放到 @ 图标上面自适应展示」—— 锚点是输入框里的 @ 按钮。 */
  anchorRef: RefObject<HTMLElement | null>;
  sections: MentionSection[];
  selected: string[];
  query: string;
  onQuery: (next: string) => void;
  /** 点一行：选中 / 取消（`selectId` 由纯函数算好，团成员会落到团那一行） */
  onPick: (item: MentionSection["items"][number]) => void;
  onClear: () => void;
  onClose: () => void;
  /** 点「@」按钮打开时聚焦搜索框；在输入框打 `@` 打开时保持焦点在文本域 */
  autoFocus?: boolean;
};

export function TeamMentionPanel({
  anchorRef, sections, selected, query, onQuery, onPick, onClear, onClose, autoFocus = false,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pos = useAnchoredPopover(true, anchorRef, rootRef);
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);
  /* ⛔ 11-08 用户令：「鼠标点外面要能关掉这个弹窗，还有 Esc」——
     面板是 portal 到 body 的浮层，点面板外任意位置都收（@ 按钮本身除外：它自己 toggle，
     否则 pointerdown 先关、click 又开，闪一下）；输入框里打 `@` 时继续打字不算点击，不受影响。 */
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || rootRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [onClose, anchorRef]);
  /* Esc 只关这一层：⛔ 不能只挂在搜索框上 —— 打字触发的面板焦点在文本域，搜不到那个 keydown。 */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const filtered = useMemo(
    () => sections
      .map((section) => ({ ...section, items: matchMentionCandidates(section.items, query, 40) }))
      .filter((section) => section.items.length > 0),
    [sections, query],
  );
  const total = filtered.reduce((sum, section) => sum + section.items.length, 0);

  return createPortal(
    <div
      className="team-mention team-mention--pop"
      role="dialog"
      aria-label="@ 候选面板"
      ref={rootRef}
      style={pos ? { position: "fixed", left: pos.left, top: pos.top } : { visibility: "hidden", position: "fixed", left: 0, top: 0 }}
    >
      <div className="team-mention__head">
        <AtSign size={13} aria-hidden />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.stopPropagation(); onClose(); }
          }}
          placeholder="搜索伙伴 / 专家团 / 团成员"
          aria-label="@ 搜索"
        />
        {selected.length > 0 && (
          <button type="button" className="team-mention__clear" onClick={onClear} title="清空本轮 @">
            清空 {selected.length}
          </button>
        )}
        <button type="button" className="team-mention__close" aria-label="关闭 @ 面板" onClick={onClose}>
          <X size={12} />
        </button>
      </div>

      <div className="team-mention__body">
        {filtered.map((section) => (
          <section key={section.key} className="team-mention__group">
            <h5>{section.title}<em>{section.items.length}</em></h5>
            {section.items.map((item) => {
              const on = selected.includes(item.selectId);
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`team-mention__item${on ? " is-on" : ""}${item.unbound ? " is-unbound" : ""}${item.muted ? " is-muted" : ""}`}
                  aria-pressed={on}
                  title={item.hint || item.role}
                  onClick={() => onPick(item)}
                >
                  <span className="team-mention__avatar"><MemberAvatar member={item.avatar} size={22} /></span>
                  <span className="team-mention__text">
                    <strong>{item.name}</strong>
                    <small>{item.role}{item.unbound ? " · 未绑定" : ""}{item.muted ? " · 已静音" : ""}</small>
                  </span>
                  {on && <Check size={13} className="team-mention__check" aria-hidden />}
                </button>
              );
            })}
          </section>
        ))}
        {!total && <p className="team-mention__empty">没有匹配的伙伴</p>}
      </div>
    </div>, document.body);
}
