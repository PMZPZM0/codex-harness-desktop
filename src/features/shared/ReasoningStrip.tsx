/**
 * 思考板块「长条按行」展示（10-20 用户需求，第二种形态）：
 *   · 收起态 = 与过程行同款的一行：标题 + 「· 最新一行思考内容」，末尾省略号；
 *   · 点击标题展开全文（最高 50vh，内部滚动），再点收起；
 *   · 与「自适应浮窗」互斥，由设置 → 控制台的 reasoning-display-mode 决定。
 * ⛔ 正文内容/追字节奏由 ReasoningCard 传入（displayed），这里只管展示，不另算真相源。
 */
import { useMemo, useState, type ReactNode } from "react";
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
  // 收起只带最新一段（最后一条非空行），不是整段思考的前几行。
  const latestLine = useMemo(() => {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return lines[lines.length - 1] ?? "";
  }, [text]);

  return (
    <div className={`reasoning-strip ${running ? "live" : "done"} ${expanded ? "expanded" : "collapsed"} ${hasText ? "" : "empty"}`}>
      <button type="button" className="reasoning-strip-head" aria-expanded={expanded} onClick={toggle} disabled={!hasText} title={!hasText ? "正在等待思考内容" : expanded ? "收起思考内容" : "展开思考内容"}>
        {head}
        {hasText && !expanded ? <><span className="reasoning-strip-sep" aria-hidden>·</span><span className="reasoning-strip-preview">{latestLine || text}</span></> : null}
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
