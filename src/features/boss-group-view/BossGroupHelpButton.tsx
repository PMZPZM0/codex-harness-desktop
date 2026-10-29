/**
 *指挥中枢的「?」说明（10-25 用户令：在群成员图标旁边加一个指挥中枢独有的问号注释）。
 *
 * ⛔ portal 到 body + fixed：`.topbar{overflow:hidden}` 会把栏内绝对定位弹层裁掉（成员按钮踩过）。
 * ⛔ 内容只讲**用户视角**（这是什么、怎么用、钱花在哪），不写实现细节。
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HelpCircle, X } from "lucide-react";

const ROWS: Array<{ title: string; body: string }> = [
  {
    title: "普通会话，多一套群编排",
    body: "你平时怎么跟 Codex 说，就怎么跟它说：直接提需求、看回复、随时打断。区别只在于这里多了一套「群编排」工具 —— 拉群、派活、审活。",
  },
  {
    title: "说需求，它自己建群派活",
    body: "例如「做个落地页，要设计 + 前端 + 测试」：建群 → 按岗位拉人 → 把活派下去。拉的人可以是专家、专家团，也可以是你本机的 CLI agent（zcode / qoder / WorkBuddy / DeepSeek / 豆包…）。",
  },
  {
    title: "成员各干各的，交活回来审",
    body: "成员各自开一个会话干活，侧栏会标上「中枢调度」。成品交回后由中枢审查，不过就打回重做 —— 默认最多 2 次，再不过会来问你。",
  },
  {
    title: "中枢只有一个，一直用下去",
    body: "不会每轮对话新建一个；只有成员干活时，下面才会多出它们的会话。",
  },
  {
    title: "顶栏「调度」开关在这里收起了",
    body: "群编排自带独立调度（谁做什么、进度、审查都在群里走），所以这个会话里手动的「允许本会话调度」开关已经收起，避免两套调度打架。",
  },
];

/** 底部示例：告诉用户「一句话就能干活」，比再写一段说明有用。 */
const EXAMPLES = ["做个落地页，要设计 + 前端 + 测试", "把这份文档做成 PPT", "查一下这个报错的根因"];

export function BossGroupHelpButton() {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

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
      if (rect) {
        const width = 340;
        setPos({ top: rect.bottom + 6, left: Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8)) });
      }
    }
    setOpen((v) => !v);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="icon-button ic-amber boss-help-btn"
        title="指挥中枢怎么用"
        aria-label="指挥中枢怎么用"
        aria-expanded={open}
        onClick={toggle}
      >
        <HelpCircle size={16} />
      </button>
      {open && pos
        ? createPortal(
            <div className="boss-help-pop" role="dialog" aria-label="指挥中枢说明" style={{ top: pos.top, left: pos.left, right: "auto" }}>
              <div className="boss-help-head">
                <span className="boss-help-ico"><HelpCircle size={14} /></span>
                <div className="boss-help-headtext">
                  <b>指挥中枢怎么用</b>
                  <span className="boss-help-sub">一个常驻会话：拉群 · 派活 · 审活</span>
                </div>
                <button type="button" className="boss-panel-mini" aria-label="关闭" onClick={() => setOpen(false)}><X size={11} /></button>
              </div>
              <div className="boss-help-list">
                {ROWS.map((row, index) => (
                  <div className="boss-help-row" key={row.title}>
                    <span className="boss-help-num">{String(index + 1).padStart(2, "0")}</span>
                    <div className="boss-help-text">
                      <span className="boss-help-title">{row.title}</span>
                      <span className="boss-help-body">{row.body}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="boss-help-examples">
                <span className="boss-help-examples-label">可以直接这样说</span>
                <div className="boss-help-chips">
                  {EXAMPLES.map((text) => <span className="boss-help-chip" key={text}>{text}</span>)}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
