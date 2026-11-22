/** 外部链接（正文与用户消息共用）：蓝色；GitHub 链接自动识别并带标志；点击走系统默认浏览器。 */
import type { ReactNode } from "react";
import { GitHubMark } from "./GitHubMark";
import { githubLinkLabel } from "../lib/composer-links.mjs";

export function ExternalLink({ href, children, className }: { href?: string; children?: ReactNode; className?: string }) {
  const raw = String(href ?? "");
  const github = /^https?:\/\/(?:www\.)?github\.com\//i.test(raw);
  const text = typeof children === "string" ? children.trim() : "";
  const label = github && /^https?:\/\//i.test(text) ? githubLinkLabel(raw) : children;
  return (
    <a
      href={href}
      className={`external-link${github ? " is-github" : ""}${className ? ` ${className}` : ""}`}
      onClick={(event) => { event.preventDefault(); if (href) void window.codex.openExternal(href); }}
    >
      {github ? <GitHubMark size={14} className="external-link-icon" /> : null}
      {label}
    </a>
  );
}
