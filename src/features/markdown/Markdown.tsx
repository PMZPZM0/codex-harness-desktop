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
import { tableToTsv } from "../../lib/md-table-text.mjs";
import { isBlockCode } from "../../lib/md-code-block.mjs";
import { lazy, Suspense } from "react";
/** 交互式流程图（React Flow）：按需加载，避免把图画布打进首屏。 */
const GraphCanvas = lazy(() => import("../graph/GraphCanvas"));
import { stripVoiceScript } from "../../lib/voice-script.mjs";
import { Globe2, Copy, Check } from "lucide-react";
import { FeedbackIconButton } from "../shared/FeedbackIconButton";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
// 数学公式（09-27，对齐引擎 0.156/0.157 的公式渲染能力）：remark-math 负责把 `$…$` / `$$…$$`
// 解析成 math 节点，rehype-katex 渲染成 HTML。只引 katex 自带 CSS（自带字体，深浅色靠 currentColor）。
// ⛔ 已知边界：行内 `$` 与 shell 变量（`$HOME`、`$(…)`）理论上可能误判 —— 但 micromark 的规则是
//   「闭合 $ 后紧跟数字则不解析」（`$5 和 $10` 安全）+「不闭合不成公式」，正文单独出现 `$VAR` 不会被吞，
//   与 GitHub / Typora 行为一致；若日后真被误伤，可关 singleDollarTextMath 只留 `$$`。
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

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

const MD_REMARK_PLUGINS = [remarkGfm, remarkBreaks, remarkMath];
const MD_REHYPE_PLUGINS = [rehypeKatex];

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
  // ⛔ hooks 必须无条件调用（下面 !isBlockCode / !language / mermaid 会提前 return）
  const cacheKey = highlightCacheKey({ language: String(className ?? "").replace("language-", ""), code, theme: settings.theme, lineNumbers: settings.lineNumbers, wrapLongLines: settings.wrap });
  const renderer = useMemo(() => (!appended && HIGHLIGHT_CACHE.shouldCache(code) ? makeCachedHighlightRenderer(cacheKey) : undefined), [cacheKey, code, appended]);
  // 懒高亮：只对"大块"启用（小块高亮本来就便宜，不值得冒颜色跳变的风险）
  const wrapRef = useRef<HTMLDivElement>(null);
  const lazy = deservesLazyHighlight(code) && !appended;
  const nearViewport = useNearViewport(wrapRef, lazy);
  /* ⛔ 10-15：**块级围栏 vs 行内 code** 的判据（用户截图：「三块里就中间的没有[复制按钮]」）。
     原先这里是 `if (!className) return <code>` —— 本意只让**行内** code 不套外壳，但「``` 后面
     不写语言」的围栏 className 同样是空 ⇒ 跟着行内代码一起被提前 return：既不高亮、也没有复制
     按钮（10-14 那轮只给**带语言**的代码块补了按钮，漏的正是这一类：提交列表这类裸围栏）。
     判据与实测证据见 `src/lib/md-code-block.mjs`（纯函数，守卫 12o 跑真值表 + react-markdown 真跑）。 */
  if (!isBlockCode(className, children)) return <code {...props}>{children}</code>;
  const language = String(className ?? "").replace("language-", "");
  if (language === "mermaid") return <MermaidDiagram code={String(children)} />;
  /* 10-17 用户令：```flowchart 围栏 = **交互式流程图**（真实节点/连线，可拖拽缩放），
     与 mermaid 的静态 SVG 区分开。懒加载：React Flow 只在真有该围栏时才进包。 */
  if (language === "flowchart" || language === "flow") return <Suspense fallback={<div className="flow-loading">正在渲染交互流程图…</div>}><GraphCanvas code={String(children)} /></Suspense>;
  const fontSize = codeFontSize(settings.fontScale);
  const fontFamily = codeFontStack(settings.font);
  /* ⛔ 10-14 二改（用户截图：「上面没有，下面有了」—— 上面那块是**代码块**、不是表格）：
     代码块与表格共用同一个复制按钮（同一套两段反馈 + 同一套 CSS）。
     ⛔ 复制内容是**代码原文**（`code` 变量就在手上，不用从 DOM 反推）。
     ⛔ 按钮的定位锚是外层 `.markdown pre`（见 CSS 的 `:has` 规则）—— 锚在包裹层上的话，
        横向滚动时按钮会跟着代码一起被滚出可视区。 */
  const withCopy = (node: React.ReactNode) => (
    <div className="md-code-wrap">
      <FeedbackIconButton
        className="md-code-copy"
        title="复制代码"
        doneTitle="已复制代码"
        icon={<Copy size={13} />}
        doneIcon={<Check size={13} />}
        onFire={() => {
          if (!code.trim()) return false;
          void window.codex.writeClipboard(code);
          return true;
        }}
      />
      {node}
    </div>
  );
  /* 无语言围栏（10-15）：没有语法可高亮（SyntaxHighlighter 拿空 language 也只是当纯文本），
     直接走纯文本渲染 + **同一个**复制按钮 —— 与下面的懒加载分支共用 plainCodeStyles，样式同源。 */
  if (!language) {
    const styles = plainCodeStyles(codeThemeStyle(settings.theme));
    return withCopy(
      <div ref={wrapRef} className="code-highlight" data-plain-code="1">
        <div style={{ ...styles.pre, fontSize, fontFamily, margin: 0 }}><code style={styles.code}>{code}</code></div>
      </div>
    );
  }
  if (lazy && !nearViewport) {
    const styles = plainCodeStyles(codeThemeStyle(settings.theme));
    return withCopy(
      <div ref={wrapRef} className="code-highlight" data-lazy-highlight="pending">
        <div style={{ ...styles.pre, fontSize, fontFamily, margin: 0 }}><code style={styles.code}>{code}</code></div>
      </div>
    );
  }
  return withCopy(
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

/**
 * 表格的「右上角复制」（10-14 用户：「汇总输出里类似这种格式内容的时候，在右上角加一个复制小图标，
 * 图标两段过渡动画」—— 截图里那份提交汇总就是一张 markdown 表格，此前正文里没有任何复制入口）。
 *
 * ⛔ 两段反馈**必须复用** `FeedbackIconButton`（10-05 立的共用件）：变对勾 + 1.1s 淡回原样的时序
 *   在它里面，动画本体在 CSS 的 `[data-phase="done"]`。自己写一套 setTimeout = 全仓两套反馈。
 * ⛔ 复制内容是**从已渲染的 DOM 反推的 TSV**（单元格 Tab、行换行）—— 贴进 Excel / 表格 / 文档
 *   就是一张表；贴 markdown 源码则要拿到 raw 文本，而这里离 react-markdown 的源码很远。
 * ⛔ 拿不到表格 / 内容全空时 `onFire` 返回 false ⇒ 不演成功（不假装复制了）。
 */
const MdTable = memo(function MdTable({ children }: { children?: React.ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const copyTable = () => {
    const table = wrapRef.current?.querySelector("table");
    if (!table || !table.rows.length) return false;
    const text = tableToTsv(table.rows);
    if (!text) return false;
    void window.codex.writeClipboard(text);
    return true;
  };
  return (
    <div className="md-table-wrap" ref={wrapRef}>
      <FeedbackIconButton
        className="md-table-copy"
        title="复制表格"
        doneTitle="已复制表格"
        icon={<Copy size={13} />}
        doneIcon={<Check size={13} />}
        onFire={copyTable}
      />
      <table>{children}</table>
    </div>
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
  img: ({ src, alt }) => {
    return <img className="message-image" src={src} alt={alt ?? ""} onClick={() => src && openImageLightbox(src, alt ?? "")} />;
  },
  code: MdCode,
  table: ({ children }) => <MdTable>{children}</MdTable>,
};

export const MdBlock = memo(function MdBlock({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={MD_REMARK_PLUGINS} rehypePlugins={MD_REHYPE_PLUGINS} components={MD_COMPONENTS} urlTransform={markdownUrlTransform}>{text}</ReactMarkdown>;
});

export const Markdown = memo(function Markdown({ children }: { children: string }) {
  /* 10-09：先把**播报稿**整块剥掉再渲染 —— 那段是给耳朵的（`​`voice`​ 围栏，由模型写在回复末尾），
     摊在对话里就是一段重复且莫名其妙的文字（用户只能听到念出来的那一版，看不到任何解释）。
     ⛔ 文本层先行：这比在 markdown AST 里挖 `code` 节点稳 —— 围栏未闭合（流式中）也要整段吞掉，
        否则用户会眼看着半句草稿在屏幕上成形然后消失。
     ⛔ 这是**唯一**的去处： Markdown.tsx 是唯一的渲染入口（流式正文、历史消息、引用、弹窗都过这里）。 */
  const text = useMemo(() => stripVoiceScript(children), [children]);
  // 若正文含可视化 fence（```show_widget / ```widget 等），混合渲染普通 markdown 块 + widget 卡片。
  // 流式阶段未闭合的 fence 用 loading 占位卡（streaming），闭合后替换为真实 iframe。
  const { blocks, widgets } = useMemo<{ blocks: string[]; widgets: Array<{ key: number; data: ShowWidgetData; streaming: boolean }> }>(() => {
    if (!hasWidgetFence(text)) return { blocks: splitMarkdown(text), widgets: [] };
    const result = extractStreamingWidget(text);
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
