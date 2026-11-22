/**
 * 输入框里的「已识别链接」行（11-21 用户：输入框也要自动识别链接并展示链接效果）。
 *
 * 只做展示与跳转：文字仍是用户原文，链接点击走系统默认浏览器；GitHub 链接带图标并去掉
 * `https://github.com/` 前缀（与正文里的 GitHub 链接同口径）。主对话与群里共用这一个组件。
 */
import { Link2 } from "lucide-react";
import { GitHubMark } from "../../components/GitHubMark";
import { githubLinkLabel, isGithubUrl } from "../../lib/composer-links.mjs";

/** 输入框顶部的已识别链接行：点击用系统默认浏览器打开；GitHub 链接带标志并去掉协议前缀。 */
export function ComposerLinkRow({ urls }: { urls: string[] }) {
  if (!urls.length) return null;
  return (
    <div className="composer-link-row" aria-label="已识别链接">
      {urls.map((url) => {
        const github = isGithubUrl(url);
        return (
          <button
            key={url}
            type="button"
            className={`composer-link-chip${github ? " is-github" : ""}`}
            title={`在默认浏览器中打开：${url}`}
            onClick={() => void window.codex.openExternal(url)}
          >
            {github ? <GitHubMark size={12} /> : <Link2 size={12} />}
            <span>{github ? githubLinkLabel(url) : url}</span>
          </button>
        );
      })}
    </div>
  );
}
