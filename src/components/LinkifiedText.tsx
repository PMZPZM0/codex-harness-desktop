/** 纯文本里的 HTTP(S) 链接自动变成 ExternalLink（用户消息、非 Markdown 文本共用）。 */
import { Fragment } from "react";
import { ExternalLink } from "./ExternalLink";
import { HTTP_URL_RE } from "../lib/composer-links.mjs";

/** 把纯文本里的 HTTP(S) 链接拆成可点链接，其余文字原样输出。 */
export function LinkifiedText({ text }: { text: string }) {
  const parts: Array<{ text: string; url?: string }> = [];
  let last = 0;
  for (const match of String(text ?? "").matchAll(HTTP_URL_RE)) {
    const start = match.index ?? 0;
    const url = match[0].replace(/[).,;!?]+$/g, "");
    if (start > last) parts.push({ text: text.slice(last, start) });
    parts.push({ text: url, url });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return <>{parts.map((part, index) => part.url
    ? <ExternalLink key={index} href={part.url}>{part.url}</ExternalLink>
    : <Fragment key={index}>{part.text}</Fragment>)}</>;
}
