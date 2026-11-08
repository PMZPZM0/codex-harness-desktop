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
import { AtSign, Check, X } from "lucide-react";
import type { MentionSection } from "../../lib/team-mention.mjs";
import { matchMentionCandidates } from "../../lib/team-mention.mjs";
import { MemberAvatar } from "./13-team-avatar";

type Props = {
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
  sections, selected, query, onQuery, onPick, onClear, onClose, autoFocus = false,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);
  /* ⛔ 11-08 用户：「这弹窗，也没有鼠标点外部关掉」——原来只能再点一次 @ 键或用 ESC。
     ⇒ 点面板外面就收（输入区那一块算同一个上下文，点文本域 / 工具行不关，
       否则「点输入框继续打字」会把面板关了）。 */
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || rootRef.current?.contains(target)) return;
      if (target.closest(".team-group__composer")) return;
      onClose();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [onClose]);

  const filtered = useMemo(
    () => sections
      .map((section) => ({ ...section, items: matchMentionCandidates(section.items, query, 40) }))
      .filter((section) => section.items.length > 0),
    [sections, query],
  );
  const total = filtered.reduce((sum, section) => sum + section.items.length, 0);

  return (
    <div className="team-mention" role="dialog" aria-label="@ 候选面板" ref={rootRef}>
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
    </div>
  );
}
