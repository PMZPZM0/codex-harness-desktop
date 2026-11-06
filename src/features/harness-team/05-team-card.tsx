/**
 * 团队模式 · 消息卡片渲染（11-06）
 *
 * 飞书 §2.2 的 `cardContent` 在**我们这里**没有服务端下发的 JSON，伙伴产出的是 Markdown。
 * 所以这一层把 Markdown 解析成同类节点再渲染成卡片：表格给真 `<table>`、代码给 `<pre>`、
 * 列表给缩进项 —— 群里才不会是一坨原文。
 *
 * ⛔ 安全：解析结果只喂 React 元素，**绝不拼 HTML 字符串**（回复来自模型 = 不可信输入）。
 * ⛔ 大消息：`parseCard` 自带块数上限（MAX_CARD_BLOCKS），这里不再加一层截断。
 */
import { parseCard, parseInline } from "../../lib/team-card.mjs";
import type { CardBlock, InlineSpan } from "../../lib/team-card.mjs";

/** 行内：粗体 / 行内代码 / 链接（只认 http(s)，其它协议当文本）。 */
function Inline({ text }: { text: string }) {
  const spans: InlineSpan[] = parseInline(text);
  return (
    <>
      {spans.map((s, i) => {
        if (s.type === "strong") return <strong key={i}>{s.text}</strong>;
        if (s.type === "code") return <code key={i} className="team-card__inline-code">{s.text}</code>;
        if (s.type === "link") {
          return (
            <a key={i} href={s.href} target="_blank" rel="noreferrer noopener" className="team-card__link">
              {s.text}
            </a>
          );
        }
        return <span key={i}>{s.text}</span>;
      })}
    </>
  );
}

function Block({ block }: { block: CardBlock }) {
  switch (block.type) {
    case "heading": {
      /* ⛔ 不用 h1/h2/h3 标签：群消息里出现 h1 会打乱整页大纲；用 class 控字号即可 */
      const cls = block.level <= 2 ? "team-card__h is-major" : "team-card__h";
      return <p className={cls}><Inline text={block.text} /></p>;
    }
    case "paragraph":
      return <p className="team-card__p"><Inline text={block.text} /></p>;
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag className="team-card__list">
          {block.items.map((it, i) => <li key={i}><Inline text={it} /></li>)}
        </Tag>
      );
    }
    case "table":
      return (
        /* 表格外层必须能横向滚：伙伴产出的列数不受控，硬挤会把整条消息撑到屏幕外 */
        <div className="team-card__tablewrap">
          <table className="team-card__table">
            <thead>
              <tr>{block.header.map((h, i) => <th key={i}><Inline text={h} /></th>)}</tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri}>
                  {block.header.map((_, ci) => <td key={ci}><Inline text={row[ci] ?? ""} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "code":
      return (
        <pre className="team-card__code" data-lang={block.lang || undefined}>
          <code>{block.text}</code>
        </pre>
      );
    case "quote":
      return <blockquote className="team-card__quote"><Inline text={block.text} /></blockquote>;
    case "hr":
      return <hr className="team-card__hr" />;
    default:
      return null;
  }
}

/** 一条消息的正文（替代原来的 `<p>{text}</p>`）。 */
export function TeamCard({ text }: { text: string }) {
  const blocks = parseCard(text);
  if (!blocks.length) return null;
  return (
    <div className="team-card">
      {blocks.map((b, i) => <Block key={i} block={b} />)}
    </div>
  );
}
