/**
 * 思考板块「长条按行」展示（10-20 用户需求，第二种形态）：
 *   · 消息流内的长条：标题行 + 固定 3 行高的正文，直播时贴底显示最新几行；
 *   · 点击标题或正文展开全文（最高 50vh，内部滚动），再点收起；
 *   · 与「自适应浮窗」互斥，由设置 → 控制台的 reasoning-display-mode 决定。
 * ⛔ 正文内容/追字节奏由 ReasoningCard 传入（displayed），这里只管展示，不另算真相源。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export function ReasoningStrip({ head, text, running, revealing }: {
  head: ReactNode;
  text: string;
  running: boolean;
  revealing: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const toggle = () => setExpanded((current) => !current);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (expanded) el.scrollTop = 0;
    else el.scrollTop = el.scrollHeight;
  }, [expanded]);

  useEffect(() => {
    if (expanded) return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text, expanded]);

  return (
    <div className={`reasoning-strip ${running ? "live" : "done"} ${expanded ? "expanded" : "collapsed"}`}>
      <button type="button" className="reasoning-strip-head" aria-expanded={expanded} onClick={toggle} title={expanded ? "收起思考内容" : "展开思考内容"}>
        {head}
        <span className="reasoning-strip-hint">{expanded ? "收起" : "展开"}</span>
        <ChevronDown size={13} className="reasoning-strip-caret" />
      </button>
      <div
        className="reasoning-strip-body"
        ref={bodyRef}
        onClick={() => {
          if (!window.getSelection()?.toString()) toggle();
        }}
      >
        {text}{revealing ? <span className="reasoning-stream-cursor" aria-hidden /> : null}
      </div>
    </div>
  );
}
