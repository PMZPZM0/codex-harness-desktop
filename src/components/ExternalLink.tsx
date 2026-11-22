/** 外部链接（正文与用户消息共用）：蓝色；GitHub 链接自动识别并带标志；点击走系统默认浏览器。 */
import { Fragment, type ReactNode } from "react";
import { GitHubMark } from "./GitHubMark";
import { githubLinkLabel, sanitizeHttpUrl } from "../lib/composer-links.mjs";

export function ExternalLink({ href, children, className }: { href?: string; children?: ReactNode; className?: string }) {
  const raw = String(href ?? "");
  const safeHref = sanitizeHttpUrl(raw) || raw;
  const github = /^https?:\/\/(?:www\.)?github\.com\//i.test(safeHref);
  const rawText = typeof children === "string" ? children : "";
  /* Markdown 自动链接可能把 URL 后面的中文一起吞进来：只把合法 URL 部分做成链接，
     后面的普通文字留在链接外（⛔ 不能整段变蓝、整段可点）。 */
  const trailing = rawText.startsWith(safeHref) && rawText.length > safeHref.length ? rawText.slice(safeHref.length) : "";
  const label = github
    ? githubLinkLabel(safeHref)
    : (rawText.startsWith(safeHref) ? safeHref : children);
  return (
    <Fragment>
      <a
        href={safeHref}
        className={`external-link${github ? " is-github" : ""}${className ? ` ${className}` : ""}`}
        onClick={(event) => { event.preventDefault(); if (safeHref) void window.codex.openExternal(safeHref); }}
      >
        {github ? <GitHubMark size={14} className="external-link-icon" /> : null}
        {label}
      </a>
      {trailing}
    </Fragment>
  );
}
