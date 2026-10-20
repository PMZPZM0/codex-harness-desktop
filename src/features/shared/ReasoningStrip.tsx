/**
 * 思考板块「长条按行」展示（10-20 用户需求，第二种形态）：
 *   · 收起态 = 与过程行同款的一行：标题 + 「· 最新一行思考内容」，末尾省略号；
 *   · 点击标题展开全文（最高 50vh，内部滚动），再点收起；
 *   · 与「自适应浮窗」互斥，由设置 → 控制台的 reasoning-display-mode 决定。
 * ⛔ 正文内容/追字节奏由 ReasoningCard 传入（displayed），这里只管展示，不另算真相源。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export function ReasoningStrip({ head, text, running, revealing }: {
  head: ReactNode;
  text: string;
  running: boolean;
  revealing: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const toggle = () => setExpanded((current) => !current);
  const hasText = Boolean(text.trim());
  const previewRef = useRef<HTMLSpanElement>(null);
  const hoverRef = useRef(false);
  // 收起只带最新一段（最后一条非空行），不是整段思考的前几行。
  const latestLine = useMemo(() => {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return lines[lines.length - 1] ?? "";
  }, [text]);

  /* 收起态：单行内容横向自动滚动（用户 10-20：「长条按行没有思考内容滚动展示」）。
     · 只有真的溢出才滚；短内容静止；
     · 悬停暂停（方便读/选中）；展开后停止；
     · prefers-reduced-motion 时不做动画，直接停在最新尾部。 */
  useEffect(() => {
    if (expanded || !hasText) return;
    const el = previewRef.current;
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (reduce) {
      el.scrollLeft = el.scrollWidth;
      return;
    }
    let raf = 0;
    let holdUntil = 0;
    const tick = (now: number) => {
      const max = el.scrollWidth - el.clientWidth;
      if (max > 1 && !hoverRef.current) {
        if (now >= holdUntil) {
          if (el.scrollLeft >= max - 0.5) {
            holdUntil = now + 1500; // 末尾停 1.5s 再回到开头
            el.scrollLeft = 0;
          } else {
            el.scrollLeft = Math.min(max, el.scrollLeft + 0.8);
          }
        }
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [expanded, hasText]);

  return (
    <div className={`reasoning-strip ${running ? "live" : "done"} ${expanded ? "expanded" : "collapsed"} ${hasText ? "" : "empty"}`}>
      <button type="button" className="reasoning-strip-head" aria-expanded={expanded} onClick={toggle} disabled={!hasText} title={!hasText ? "正在等待思考内容" : expanded ? "收起思考内容" : "展开思考内容"}>
        {head}
        {hasText && !expanded ? <><span className="reasoning-strip-sep" aria-hidden>·</span><span className="reasoning-strip-preview" ref={previewRef} title={latestLine} onPointerEnter={() => { hoverRef.current = true; }} onPointerLeave={() => { hoverRef.current = false; }}>{latestLine || text}</span></> : null}
        {hasText ? <span className="reasoning-strip-hint">{expanded ? "收起" : "展开"}</span> : null}
        {hasText ? <ChevronDown size={13} className="reasoning-strip-caret" /> : null}
      </button>
      {hasText && expanded ? (
        <div className="reasoning-strip-body">
          {text}{revealing ? <span className="reasoning-stream-cursor" aria-hidden /> : null}
        </div>
      ) : null}
    </div>
  );
}
