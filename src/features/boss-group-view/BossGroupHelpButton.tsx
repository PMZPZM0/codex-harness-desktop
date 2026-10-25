/**
 * BOSS 会话的「?」说明（10-25 用户令：在群成员图标旁边加一个 BOSS 会话独有的问号注释）。
 *
 * ⛔ portal 到 body + fixed：`.topbar{overflow:hidden}` 会把栏内绝对定位弹层裁掉（成员按钮踩过）。
 * ⛔ 内容只讲**用户视角**（这是什么、怎么用、钱花在哪），不写实现细节。
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HelpCircle, X } from "lucide-react";

const ROWS: Array<{ title: string; body: string }> = [
  {
    title: "这就是一个普通会话",
    body: "和你平时跟 Codex 对话一样：直接说需求、看回复、随时打断。区别只在于这个会话里多了一套「群编排」工具 —— 它能拉群、派活、审活。",
  },
  {
    title: "说需求就行，它自己拉群喊人",
    body: "比如「做个落地页，要设计 + 前端 + 测试」。它会建群、按岗位拉人，然后把活派下去。拉的人可以是专家、专家团，也可以是你本机的 CLI agent（zcode / qoder / WorkBuddy / DeepSeek / 豆包…）。",
  },
  {
    title: "成员在各自的会话里干活",
    body: "派出去的活由成员自己开一个会话去做，侧栏会给它们标上「BOSS 调度」。它们干完把成品交回来，BOSS 审查，不过就打回重做（默认最多 2 次，再不过会来问你）。",
  },
  {
    title: "这个会话会一直用下去",
    body: "BOSS 会话是固定的那一个，不会每轮对话又新建一个。只有成员干活才会在下面多出会话。",
  },
  {
    title: "顶栏的「调度」开关这里不需要",
    body: "群编排自带一套独立调度（谁做什么、进度、审查都在群里走），所以这个会话里那个手动的「允许本会话调度」开关已经收起来了，避免两套调度打架。",
  },
];

export function BossGroupHelpButton() {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: globalThis.MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (t instanceof Element && t.closest(".boss-help-pop")) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  const toggle = () => {
    if (!open) {
      const rect = btnRef.current?.getBoundingClientRect();
      if (rect) setPos({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
    }
    setOpen((v) => !v);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="icon-button ic-amber boss-help-btn"
        title="BOSS 会话怎么用"
        aria-label="BOSS 会话怎么用"
        aria-expanded={open}
        onClick={toggle}
      >
        <HelpCircle size={16} />
      </button>
      {open && pos
        ? createPortal(
            <div className="boss-help-pop" role="dialog" aria-label="BOSS 会话说明" style={{ top: pos.top, right: pos.right }}>
              <div className="boss-help-head">
                <b>BOSS 会话怎么用</b>
                <button type="button" className="boss-panel-mini" aria-label="关闭" onClick={() => setOpen(false)}><X size={11} /></button>
              </div>
              {ROWS.map((row) => (
                <div className="boss-help-row" key={row.title}>
                  <span className="boss-help-title">{row.title}</span>
                  <span className="boss-help-body">{row.body}</span>
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
