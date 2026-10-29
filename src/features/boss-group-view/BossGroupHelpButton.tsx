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
    title: "跟平时一样聊，只是手边多了个群",
    body: "怎么跟 Codex 说话，就怎么跟它说：提需求、看回复、随时打断。只是这里多了一套「群编排」工具 —— 拉群、派活、验活。",
  },
  {
    title: "需求说清楚，人就到齐了",
    body: "比如「做个落地页，要设计、前端、测试」：它会建群、按岗位拉人、把活分下去。人可以从专家、专家团里挑，也可以是你本机的命令行 agent（zcode、qoder、WorkBuddy、DeepSeek、豆包…）。",
  },
  {
    title: "各干各的，干完交回来验",
    body: "派出去的活，成员各自开一个会话去做，侧栏会标上「中枢调度」。成品交回来由中枢验收：不合格就打回重做，默认最多两轮，还不行会来问你。",
  },
  {
    title: "一个群对应一条中枢会话",
    body: "点侧栏「指挥中枢」会回到这个群的中枢会话，不会每轮另起一条；群与群、会话与会话互不串项。下面多出来的会话，是成员在干活。",
  },
  {
    title: "顶栏那个「调度」开关，这里可以不管",
    body: "群编排自带一套调度，谁做什么、进度、验收都在群里走；所以这里手动的「允许本会话调度」已经收起 —— 两套同时开只会互相打架。",
  },
];

/** 底部示例：告诉用户「一句话就能开工」，比再写一段说明有用。 */
const EXAMPLES = ["做个落地页，要设计、前端、测试", "把这份文档整理成 PPT", "查一下这个报错的根因"];

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
                  <span className="boss-help-sub">一个常驻会话，替你拉群、派活、验活</span>
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
                <span className="boss-help-examples-label">一句话就能开工，比如</span>
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
