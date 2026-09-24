/** ToolCodeBlock（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { memo, useMemo, useRef, useState, useCallback, useLayoutEffect } from "react";
import { useCodeSettings, codeFontSize } from "../../lib/code-settings";
import { HIGHLIGHT_CACHE } from "../../lib/highlight-cache";
import { makeCachedHighlightRenderer } from "../../lib/make-cached-highlight-renderer";
import { highlightCacheKey } from "../../lib/code-highlight-cache.mjs";
import { deservesLazyHighlight, plainCodeStyles } from "../../lib/lazy-highlight.mjs";
import { useNearViewport } from "./use-near-viewport";
import { codeThemeStyle, codeFontStack } from "../../lib/code-themes";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { DIFF_LINE_HEIGHT } from "../../lib/diff-line-height";
import { DIFF_OVERSCAN } from "../../lib/diff-overscan";

export const ToolCodeBlock = memo(function ToolCodeBlock({ language, text, revealing, className, maxHeight = 260 }: {
  language: string;
  text: string;
  revealing?: boolean;
  className?: string;
  maxHeight?: number;
}) {
  const settings = useCodeSettings();
  // 大 diff 走行级虚拟化（09-14，学 WorkBuddy 的 tool-diff 行虚拟化）：
  // 一个几千行的 diff 真建几千个行节点 + 语法高亮，是「切会话/展开编辑卡就卡」的主要来源。
  // 只在「diff + 行数够多 + 未开启折行（行高恒定）+ 不在流式追字」时启用——流水追字期间文本还在长，
  // 虚拟化会与逐字追字互相打架；折行会让行高不固定，测不准。其余情况仍走 SyntaxHighlighter。
  const lineCount = useMemo(() => (text ? text.split("\n").length : 0), [text]);
  const virtualizable = language === "diff" && !revealing && !settings.wrap && lineCount > DIFF_VIRTUAL_THRESHOLD;
  // 高亮结果缓存（09-18）：命令输出/diff 是元素大户（每 token 一个 span），切会话重挂载时
  // 重跑一遍就是那几百毫秒到几秒的来源。⛔ 逐字追字（revealing）期间**不接**：text 每帧都变，
  // key 每帧都 miss，白付开销（默认 renderer 走原路径）。
  const hlRenderer = useMemo(() => {
    if (revealing || virtualizable || !HIGHLIGHT_CACHE.shouldCache(text)) return undefined;
    return makeCachedHighlightRenderer(highlightCacheKey({ language, code: text, theme: settings.theme, lineNumbers: settings.lineNumbers, wrapLongLines: settings.wrap }));
  }, [revealing, virtualizable, text, language, settings.theme, settings.lineNumbers, settings.wrap]);
  // 懒高亮（09-18）：命令输出/diff 常是几千行的大块，是"切换会话卡"的主要来源。
  // ⛔ 逐字追字（revealing）期间不启用：那会儿文本每帧都在长，懒加载只会跟追字动画打架。
  const wrapRef = useRef<HTMLDivElement>(null);
  const lazy = !revealing && !virtualizable && deservesLazyHighlight(text);
  const nearViewport = useNearViewport(wrapRef, lazy);
  if (lazy && !nearViewport) {
    const styles = plainCodeStyles(codeThemeStyle(settings.theme));
    return (
      <div className={`tool-code-block ${className ?? ""}`.trim()}>
        <div ref={wrapRef} className="tool-code-pre code-highlight" data-lazy-highlight="pending">
          <div style={{ ...styles.pre, fontSize: codeFontSize(settings.fontScale), fontFamily: codeFontStack(settings.font), lineHeight: 1.55, maxHeight, margin: 0, overflow: "auto" }}><code style={styles.code}>{text || " "}</code></div>
        </div>
      </div>
    );
  }
  return (
    <div className={`tool-code-block ${className ?? ""} ${revealing ? "packet-revealing" : ""}`.trim()}>
      {virtualizable
        ? <VirtualDiffLines text={text} maxHeight={maxHeight} fontSize={codeFontSize(settings.fontScale)} fontFamily={codeFontStack(settings.font)} />
        : (
          <SyntaxHighlighter
            language={language}
            style={codeThemeStyle(settings.theme)}
            PreTag="pre"
            CodeTag="code"
            className="tool-code-pre code-highlight"
            showLineNumbers={settings.lineNumbers}
            wrapLongLines={settings.wrap}
            renderer={hlRenderer}
            customStyle={{
              fontSize: codeFontSize(settings.fontScale),
              fontFamily: codeFontStack(settings.font),
              lineHeight: 1.55,
              maxHeight,
              margin: 0,
            }}
          >{text || " "}</SyntaxHighlighter>
        )}
      {revealing ? <span className="packet-stream-cursor tool-code-cursor" aria-hidden /> : null}
    </div>
  );
});

const DIFF_VIRTUAL_THRESHOLD = 400;
const VirtualDiffLines = memo(function VirtualDiffLines({ text, maxHeight, fontSize, fontFamily }: { text: string; maxHeight: number; fontSize: number | string; fontFamily: string }) {
  const lines = useMemo(() => text.split("\n"), [text]);
  const boxRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState(() => ({ start: 0, end: Math.min(lines.length, 120) }));
  const recompute = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    const first = Math.max(0, Math.floor(el.scrollTop / DIFF_LINE_HEIGHT) - DIFF_OVERSCAN);
    const count = Math.ceil((el.clientHeight || maxHeight) / DIFF_LINE_HEIGHT) + DIFF_OVERSCAN * 2;
    const end = Math.min(lines.length, first + count);
    setRange((current) => (current.start === first && current.end === end ? current : { start: first, end }));
  }, [lines.length, maxHeight]);
  useLayoutEffect(() => { recompute(); }, [recompute]);
  const rows = [];
  for (let i = range.start; i < range.end; i++) {
    const line = lines[i] ?? "";
    const kind = /^(\+\+\+|---)/.test(line) ? "meta" : line.startsWith("@@") ? "hunk" : line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "ctx";
    rows.push(<div key={i} className={`virtual-diff-line ${kind}`} style={{ transform: `translateY(${i * DIFF_LINE_HEIGHT}px)` }}>{line || " "}</div>);
  }
  return (
    <div
      ref={boxRef}
      className="virtual-diff tool-code-pre"
      style={{ maxHeight, fontSize, fontFamily }}
      onScroll={recompute}
      data-total-lines={lines.length}
    >
      <div className="virtual-diff-inner" style={{ height: lines.length * DIFF_LINE_HEIGHT }}>{rows}</div>
    </div>
  );
});
