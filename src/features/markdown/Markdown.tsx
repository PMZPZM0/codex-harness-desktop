/** Markdown 渲染与代码块（从 src/App.tsx 原样搬来，内容未改）。域公开面见 ./index.ts */
import { memo, useMemo, useRef, useEffect } from "react";
import { hasWidgetFence, extractStreamingWidget } from "../../lib/generative-widget";
import type { ShowWidgetData } from "../../lib/generative-widget";
import { isWidgetDark } from "../../lib/widget-dark";
import { WidgetCard } from "../../components/GenerativeWidget";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import { openImageLightbox } from "../../lib/ui-channels";
import { useCodeSettings, codeFontSize } from "../../lib/code-settings";
import { highlightCacheKey } from "../../lib/code-highlight-cache.mjs";
import { HIGHLIGHT_CACHE } from "../../lib/highlight-cache";
import { makeCachedHighlightRenderer } from "../../lib/make-cached-highlight-renderer";
import { deservesLazyHighlight, plainCodeStyles } from "../../lib/lazy-highlight.mjs";
import { useNearViewport } from "../shared/use-near-viewport";
import { MermaidDiagram } from "../../components/MermaidDiagram";
import { codeFontStack, codeThemeStyle } from "../../lib/code-themes";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { markdownUrlTransform } from "../../lib/markdown-url";
// 分块逻辑搬去 src/lib/markdown-blocks.mjs（纯函数 ⇒ 预检守卫可直接跑真值表）。
// ⛔ 其中含一处容错：列表项后面顶格紧跟的结语行原先被 CommonMark 当 lazy 续行塞进最后一个
//   <li>，渲染上缩进到 marker 之后、左侧空出 marker 宽度（用户 09-24：「最后一个总是歪的，
//   前面空那么多」）。详见 softenListTailLazyContinuation 注释。
import { splitMarkdown } from "../../lib/markdown-blocks.mjs";
import { Globe2 } from "lucide-react";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

function LinkCard({ href }: { href: string }) {
  let host = href;
  try { host = new URL(href).host || href; } catch { /* keep raw href */ }
  return (
    <span className="link-card" role="group" aria-label={`链接卡片 ${host}`}>
      <span className="link-card-icon"><Globe2 size={17} /></span>
      <span className="link-card-body"><strong>{host}</strong><small>网站</small></span>
      <button className="link-card-open" title={`在浏览器中打开 ${href}`} onClick={() => void window.codex.openExternal(href)}>打开</button>
    </span>
  );
}

const MD_REMARK_PLUGINS = [remarkGfm, remarkBreaks];

export const MdCode = memo(function MdCode({ className, children, ...props }: any) {
  const settings = useCodeSettings();
  const code = String(children ?? "").replace(/\n$/, "");
  // ⛔ 流式追字期间不接缓存（09-18 审查补的缺口）：流式的形态是「本次文本 = 上次文本 + 追加」，
  //   每帧都是一个 never-again 的新 key —— 若照单写入，一屏流式能塞进几十个中间态，把
  //   其它会话攒下的缓存条目按 LRU 挤掉（那些会话切回来又变慢）。用「是否在上次文本上追加」
  //   判定，误判最多让某帧少缓存一次，无副作用。ref 在 effect 里更新（render 期不写 ref）。
  const prevCodeRef = useRef("");
  const appended = prevCodeRef.current.length > 0 && code.length > prevCodeRef.current.length && code.startsWith(prevCodeRef.current);
  useEffect(() => { prevCodeRef.current = code; }, [code]);
  // ⛔ hooks 必须无条件调用（下面 !className / mermaid 会提前 return）
  const cacheKey = highlightCacheKey({ language: String(className ?? "").replace("language-", ""), code, theme: settings.theme, lineNumbers: settings.lineNumbers, wrapLongLines: settings.wrap });
  const renderer = useMemo(() => (!appended && HIGHLIGHT_CACHE.shouldCache(code) ? makeCachedHighlightRenderer(cacheKey) : undefined), [cacheKey, code, appended]);
  // 懒高亮：只对"大块"启用（小块高亮本来就便宜，不值得冒颜色跳变的风险）
  const wrapRef = useRef<HTMLDivElement>(null);
  const lazy = deservesLazyHighlight(code) && !appended;
  const nearViewport = useNearViewport(wrapRef, lazy);
  if (!className) return <code {...props}>{children}</code>;
  const language = className.replace("language-", "");
  if (language === "mermaid") return <MermaidDiagram code={String(children)} />;
  const fontSize = codeFontSize(settings.fontScale);
  const fontFamily = codeFontStack(settings.font);
  if (lazy && !nearViewport) {
    const styles = plainCodeStyles(codeThemeStyle(settings.theme));
    return (
      <div ref={wrapRef} className="code-highlight" data-lazy-highlight="pending">
        <div style={{ ...styles.pre, fontSize, fontFamily, margin: 0 }}><code style={styles.code}>{code}</code></div>
      </div>
    );
  }
  return (
    <SyntaxHighlighter
      language={language}
      style={codeThemeStyle(settings.theme)}
      PreTag="div"
      className="code-highlight"
      showLineNumbers={settings.lineNumbers}
      wrapLongLines={settings.wrap}
      renderer={renderer}
      customStyle={{ fontSize, fontFamily, margin: 0 }}
    >{code}</SyntaxHighlighter>
  );
});

export const FilePreviewCode = memo(function FilePreviewCode({ language, content, truncated }: { language: string; content: string; truncated?: boolean }) {
  const settings = useCodeSettings();
  const normalized = String(language ?? "").replace(/^\./, "").toLowerCase();
  const code = content.replace(/\n$/, "") + (truncated ? "\n…（文件过大，仅展示前 200K 字符）" : "");
  const renderer = useMemo(() => {
    if (!HIGHLIGHT_CACHE.shouldCache(code)) return undefined;
    return makeCachedHighlightRenderer(highlightCacheKey({ language: normalized, code, theme: settings.theme, lineNumbers: true, wrapLongLines: settings.wrap }));
  }, [normalized, code, settings.theme, settings.wrap]);
  // 懒高亮：文件预览常是"大文件整篇"，最该懒加载（没打开到视口就别算）
  const wrapRef = useRef<HTMLDivElement>(null);
  const lazy = deservesLazyHighlight(code);
  const nearViewport = useNearViewport(wrapRef, lazy);
  const fontSize = codeFontSize(settings.fontScale);
  const fontFamily = codeFontStack(settings.font);
  if (lazy && !nearViewport) {
    const styles = plainCodeStyles(codeThemeStyle(settings.theme));
    return (
      <div ref={wrapRef} className="file-preview-code code-highlight" data-lazy-highlight="pending">
        <div style={{ ...styles.pre, fontSize, fontFamily, margin: 0 }}><code style={styles.code}>{code}</code></div>
      </div>
    );
  }
  return (
    <SyntaxHighlighter
      language={normalized}
      style={codeThemeStyle(settings.theme)}
      PreTag="pre"
      CodeTag="code"
      className="file-preview-code code-highlight"
      // WorkBuddy 式文件查看：行号常开（代码块内联展示才跟随用户设置）
      showLineNumbers
      wrapLongLines={settings.wrap}
      renderer={renderer}
      customStyle={{ fontSize, fontFamily, margin: 0 }}
    >{code}</SyntaxHighlighter>
  );
});

export const MD_COMPONENTS: Components = {
  p: ({ children }) => {
    const list = Array.isArray(children) ? children : [children];
    // remark-breaks 对只含空白/换行的段落也会生成 <p>；它不是正文，不能给
    // 后面的命令卡或工具折叠组制造一整行空白。
    if (list.every((child) => child == null || (typeof child === "string" && child.trim() === ""))) return null;
    const only = list.length === 1 ? list[0] : null;
    const href = only?.props?.href;
    if (typeof href === "string" && /^https?:\/\//i.test(href) && String(only.props.children ?? "").replace(/\/+$/, "") === href.replace(/\/+$/, "")) {
      return <LinkCard href={href} />;
    }
    return <p>{children}</p>;
  },
  a: ({ href, children }) => (
    <a href={href} onClick={(event) => { event.preventDefault(); if (href) void window.codex.openExternal(href); }}>
      {children}
    </a>
  ),
  img: ({ src, alt }) => (
    <img className="message-image" src={src} alt={alt ?? ""} onClick={() => src && openImageLightbox(src, alt ?? "")} />
  ),
  code: MdCode,
};

export const MdBlock = memo(function MdBlock({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={MD_REMARK_PLUGINS} components={MD_COMPONENTS} urlTransform={markdownUrlTransform}>{text}</ReactMarkdown>;
});

export const Markdown = memo(function Markdown({ children }: { children: string }) {
  // 若正文含可视化 fence（```show_widget / ```widget 等），混合渲染普通 markdown 块 + widget 卡片。
  // 流式阶段未闭合的 fence 用 loading 占位卡（streaming），闭合后替换为真实 iframe。
  const { blocks, widgets } = useMemo<{ blocks: string[]; widgets: Array<{ key: number; data: ShowWidgetData; streaming: boolean }> }>(() => {
    if (!hasWidgetFence(children)) return { blocks: splitMarkdown(children), widgets: [] };
    const result = extractStreamingWidget(children);
    const bs: string[] = [];
    const ws: Array<{ key: number; data: ShowWidgetData; streaming: boolean }> = [];
    result.segments.forEach((seg, i) => {
      if (seg.type === "text") bs.push(seg.content);
      else ws.push({ key: i, data: seg.data, streaming: false });
    });
    if (result.streamingWidget) ws.push({ key: -1, data: result.streamingWidget, streaming: true });
    return { blocks: bs, widgets: ws };
  }, [children]);
  // 流式出字是纯追加，前面的块只会变多不会重排，用 index 作 key 稳定且足够
  const rendered = blocks.map((text, index) => <MdBlock text={text} key={`b${index}`} />);
  // widget 卡片按流序与文本块交错插入（text/widget 由 segments 顺序保证）
  const dark = isWidgetDark();
  const ordered: React.ReactNode[] = [];
  const textCount = blocks.length;
  for (let i = 0; i < Math.max(textCount, widgets.length); i++) {
    if (i < textCount) ordered.push(rendered[i]);
    if (i < widgets.length) {
      const seg = widgets[i];
      ordered.push(<WidgetCard key={`w${seg.key}`} data={seg.data} dark={dark} streaming={seg.streaming} />);
    }
  }
  return <>{ordered}</>;
});
