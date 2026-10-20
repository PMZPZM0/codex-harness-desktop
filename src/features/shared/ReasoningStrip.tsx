/**
 * 思考板块「长条按行」展示（10-20 用户需求，第二种形态）：
 *   · 收起态 = 与过程行同款的一行：标题 + 「· 最新一行思考内容」；
 *   · 直播中：最新一行溢出时用 CSS transform 无缝横滚（不触发任何 scroll 事件，
 *     避免时间线把嵌套滚动当成用户滚动而上下抖）；
 *   · 完成后：**立即停在最新尾部，不再循环播放**（用户 10-21 报障）；
 *   · 点击标题展开全文（最高 50vh，内部滚动），再点收起。
 * ⛔ 正文内容/追字节奏由 ReasoningCard 传入（displayed），这里只管展示，不另算真相源。
 */
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export function ReasoningStrip({ head, text, running, revealing }: {
  head: ReactNode;
  text: string;
  running: boolean;
  revealing: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const previewRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const toggle = () => setExpanded((current) => !current);
  const hasText = Boolean(text.trim());
  // 收起只带最新一段（最后一条非空行），不是整段思考的前几行。
  const latestLine = useMemo(() => {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return lines[lines.length - 1] ?? "";
  }, [text]);
  const marqueeSeconds = Math.max(8, Math.min(40, latestLine.length * 0.12));

  /* 溢出测量 + 完成态贴尾：
     · 直播：只有真的溢出才挂滚动动画（短内容静止）；
     · 完成：由 CSS `justify-content:flex-end` 直接露出最新尾部，不循环——用户报「已完成还在一直滚动播放」。
       这里不写 scrollLeft / rAF：那会触发 scroll 事件，时间线监听可能跟着上下补偿。 */
  useLayoutEffect(() => {
    const el = previewRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const overflow = content.scrollWidth > el.clientWidth + 1;
    setOverflowing(overflow);
    /* 完成态不在这里滚：由 CSS `justify-content:flex-end` 直接露出尾部；
       直播态只测量是否溢出，滚动交给 CSS transform，避免任何 scrollLeft 事件。 */
  }, [latestLine, running, expanded]);

  return (
    <div className={`reasoning-strip ${running ? "live" : "done"} ${expanded ? "expanded" : "collapsed"} ${hasText ? "" : "empty"}`}>
      <button type="button" className="reasoning-strip-head" aria-expanded={expanded} onClick={toggle} disabled={!hasText} title={!hasText ? "正在等待思考内容" : expanded ? "收起思考内容" : "展开思考内容"}>
        {head}
        {hasText && !expanded ? (
          <>
            <span className="reasoning-strip-sep" aria-hidden>·</span>
            <span className="reasoning-strip-preview" ref={previewRef} title={latestLine}>
              {running ? (
                <span
                  className={`reasoning-strip-marquee ${overflowing ? "is-scrolling" : ""}`}
                  style={{ "--marquee-duration": `${marqueeSeconds}s` } as CSSProperties}
                >
                  <span ref={contentRef}>{latestLine}</span>
                  {overflowing ? <span aria-hidden>{latestLine}</span> : null}
                </span>
              ) : (
                <span className="reasoning-strip-static" ref={contentRef}>{latestLine}</span>
              )}
            </span>
          </>
        ) : null}
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
