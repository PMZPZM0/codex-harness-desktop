/**
 * 团队模式 · 群菜单（11-06）
 *
 * 飞书 §3：机器人可挂菜单树，输入框旁出现「菜单」按钮（`needShowMenuButton = menuItems.length > 0`），
 * 点一项 = `TriggerMenuEvent`，响应可带 `showMsg` 直接回显。
 *
 * 我们这版：点一项 ⇒ **把该指令填进输入框**（不自动发送）+ 输入框上方回显一句
 * （`showMsg` 的等价物）。⛔ 不自动发：派活是对模型的调用，按下发送才算数。
 */
import { useEffect, useRef, useState } from "react";
import { ChevronRight, Menu as MenuIcon } from "lucide-react";
import { normalizeMenu } from "../../lib/team-menu.mjs";
import type { MenuItem } from "../../lib/team-menu.mjs";

type Props = {
  items: MenuItem[];
  /** 选中一个叶子（key）；父层做 `menuPickResult` 的落点 */
  onPick: (key: string) => void;
  disabled?: boolean;
};

export function TeamMenuButton({ items, onPick, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [expand, setExpand] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  const menu = normalizeMenu(items);
  /* ⛔ 空菜单不画按钮（飞书同一条判据）：点开是空的比没有按钮更糟 */
  if (!menu.length) return null;

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

  const pick = (key: string) => {
    onPick(key);
    setOpen(false);
    setExpand("");
  };

  return (
    <div className="team-menu" ref={wrapRef}>
      <button
        type="button"
        className={`team-menu__btn${open ? " is-open" : ""}`}
        onClick={() => { setOpen((v) => !v); setExpand(""); }}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title="快捷指令（点一项填进输入框，确认后再发）"
      >
        <MenuIcon size={13} /> 指令
      </button>

      {open && (
        <div className="team-menu__pop" role="menu">
          {menu.map((group) => {
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
              <div key={group.key} className="team-menu__group">
                <button type="button" className="team-menu__item team-menu__item--group"
                  onClick={() => setExpand(opened ? "" : group.key)}
                  aria-expanded={opened}>
                  <span>{group.label}</span>
                  <ChevronRight size={12} className={opened ? "is-open" : undefined} />
                </button>
                {opened && (
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
          })}
          <p className="team-menu__hint">点一项 = 把指令填进输入框，不会替你发送</p>
        </div>
      )}
    </div>
  );
}
