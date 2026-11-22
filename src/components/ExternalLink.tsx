/** 外部链接（正文与用户消息共用）：蓝色；GitHub 链接自动识别并带标志；点击走系统默认浏览器。 */
import { Fragment, type ReactNode } from "react";
import { GitHubMark } from "./GitHubMark";
import { githubLinkLabel, decodePercentText, sanitizeHttpUrl } from "../lib/composer-links.mjs";

/** 外部链接：蓝色；GitHub 链接带标志并去掉协议前缀；点击用系统默认浏览器打开。 */
export function ExternalLink({ href, children, className }: { href?: string; children?: ReactNode; className?: string }) {
  const raw = String(href ?? "");
  const safeHref = sanitizeHttpUrl(raw) || raw;
  const decodedHref = decodePercentText(safeHref);
  const github = /^https?:\/\/(?:www\.)?github\.com\//i.test(safeHref);
  const rawText = typeof children === "string" ? children : "";
  /* Markdown 自动链接可能把 URL 后面的中文一起吞进来（并且转成 %E6…）：
     只把合法 URL 部分做成链接，后面的普通文字还原成中文、留在链接外。 */
  const trailingRaw = rawText.startsWith(safeHref)
    ? rawText.slice(safeHref.length)
    : (rawText.startsWith(decodedHref) ? rawText.slice(decodedHref.length) : "");
  const trailing = decodePercentText(trailingRaw);
  const label = github
    ? githubLinkLabel(decodedHref)
    : (rawText.startsWith(safeHref) || rawText.startsWith(decodedHref) ? decodedHref : children);
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
