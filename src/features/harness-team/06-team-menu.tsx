/**
 * 团队模式 · 群菜单（11-06）
 *
 * 飞书 §3：机器人可挂菜单树，输入框旁出现「菜单」按钮（`needShowMenuButton = menuItems.length > 0`），
 * 点一项 = `TriggerMenuEvent`，响应可带 `showMsg` 直接回显。
 *
 * 我们这版：点一项 ⇒ **把该指令填进输入框**（不自动发送）+ 输入框上方回显一句
 * （`showMsg` 的等价物）。⛔ 不自动发：派活是对模型的调用，按下发送才算数。
 *
 * 11-06 补：飞书的两种展示形态（`INPUT_FIRST` / `FLOAT`）——
 *   · `input`（默认）：按钮在 `@` 行，面板向上弹，与输入区一体；
 *   · `float`：按钮**浮在群视图右下**，面板是带标题与滚动条的浮层；点分组**整屏换成该组**
 *     （带「‹ 返回」），菜单条目一多（十几个）时不会把输入区顶掉一半。
 *     ⛔ 二级不做横向弹出：浮层内部要能滚动，横向子面板会被滚动容器裁掉（11-06 实测）。
 * ⛔ 两种形态共用同一份数据与同一个点击口径（`menuPickResult`），⛔ 不许各写一套行为。
 */
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Menu as MenuIcon, X } from "lucide-react";
import { normalizeMenu } from "../../lib/team-menu.mjs";
import type { MenuItem } from "../../lib/team-menu.mjs";
import type { MenuPlacement } from "./01-team-types";

type Props = {
  items: MenuItem[];
  /** 选中一个叶子（key）；父层做 `menuPickResult` 的落点 */
  onPick: (key: string) => void;
  disabled?: boolean;
  /** 展示形态（缺省 = 贴输入框） */
  placement?: MenuPlacement;
};

export function TeamMenuButton({ items, onPick, disabled, placement = "input" }: Props) {
  const [open, setOpen] = useState(false);
  const [expand, setExpand] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  const menu = normalizeMenu(items);
  const isFloat = placement === "float";
  /* FLOAT 形态：点分组 = 把列表换成该组的子项（带「‹ 返回」）。
     ⛔ 不用横向弹出的子面板：浮层的列表要滚动，横向子面板会被 `overflow-y:auto` 裁掉。 */
  const openedGroup = isFloat && expand ? menu.find((g) => g.key === expand) ?? null : null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  /* ⛔ 空菜单不画按钮（飞书同一条判据）：点开是空的比没有按钮更糟。
     ⛔ 这个 return 必须在所有 hooks 之后（否则切群时 hooks 数量变化，React 会崩）。 */
  if (!menu.length) return null;

  const pick = (key: string) => {
    onPick(key);
    setOpen(false);
    setExpand("");
  };

  return (
    <div className={`team-menu${isFloat ? " team-menu--float" : ""}`} ref={wrapRef}>
      <button
        type="button"
        className={`team-menu__btn${isFloat ? " team-menu__btn--float" : ""}${open ? " is-open" : ""}`}
        onClick={() => { setOpen((v) => !v); setExpand(""); }}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title={isFloat ? "快捷指令（悬浮面板）" : "快捷指令（点一项填进输入框，确认后再发）"}
      >
        <MenuIcon size={isFloat ? 15 : 13} /> 指令
      </button>

      {open && (
        <div className={`team-menu__pop${isFloat ? " team-menu__pop--float" : ""}`} role="menu">
          {isFloat && (
            <div className="team-menu__head">
              <strong>快捷指令</strong>
              <button
                type="button"
                className="team-menu__close"
                title="收起（Esc）"
                aria-label="收起指令菜单"
                onClick={() => { setOpen(false); setExpand(""); }}
              >
                <X size={13} />
              </button>
            </div>
          )}
          <div className="team-menu__list">
            {openedGroup ? (
              <>
                <button type="button" className="team-menu__item team-menu__item--back" onClick={() => setExpand("")}>
                  <ChevronLeft size={12} />
                  <span>{openedGroup.label}</span>
                </button>
                {openedGroup.children.map((child) => (
                  <button key={child.key} type="button" className="team-menu__item" role="menuitem"
                    onClick={() => pick(child.key)} disabled={child.disabled}
                    title={child.prompt}>
                    <span>{child.label}</span>
                    {child.tag && <em>{child.tag}</em>}
                  </button>
                ))}
              </>
            ) : (
              menu.map((group) => {
                const kids = group.children ?? [];
                if (!kids.length) {
                  return (
                    <button key={group.key} type="button" className="team-menu__item" role="menuitem"
                      onClick={() => pick(group.key)} disabled={group.disabled}>
                      <span>{group.label}</span>
                      {group.tag && <em>{group.tag}</em>}
                    </button>
                  );
                }
                const opened = expand === group.key;
                return (
                  <div key={group.key} className={`team-menu__group${opened ? " is-open" : ""}`}>
                    <button type="button" className="team-menu__item team-menu__item--group"
                      onClick={() => setExpand(opened ? "" : group.key)}
                      aria-expanded={opened}>
                      <span>{group.label}</span>
                      <ChevronRight size={12} className={opened ? "is-open" : undefined} />
                    </button>
                    {opened && !isFloat && (
                      <div className="team-menu__sub">
                        {kids.map((child) => (
                          <button key={child.key} type="button" className="team-menu__item" role="menuitem"
                            onClick={() => pick(child.key)} disabled={child.disabled}
                            title={child.prompt}>
                            <span>{child.label}</span>
                            {child.tag && <em>{child.tag}</em>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <p className="team-menu__hint">点一项 = 把指令填进输入框，不会替你发送</p>
        </div>
      )}
    </div>
  );
}
