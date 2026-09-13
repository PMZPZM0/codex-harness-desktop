"""把抓到的 LinkedIn 单帖分析渲染成 NotebookLM 友好的 Markdown（与 douyin-session 同形）。"""
from __future__ import annotations

import datetime as dt
from pathlib import Path


def _fmt_num(n: int | None) -> str:
    if n is None:
        return "-"
    return f"{n:,}"


def _ratio(num: int | None, den: int | None) -> str:
    """派生比率，分母为 0 / 缺失时显示 '-'。"""
    if not num or not den:
        return "-"
    return f"{num / den * 100:.2f}%"


def render_report(post: dict, script: str) -> str:
    metrics = post.get("metrics", {}) if post else {}
    meta = post.get("meta", {}) if post else {}
    activity_id = post.get("activity_id", "") if post else ""

    impressions = metrics.get("impressions")
    reactions = metrics.get("reactions")
    comments = metrics.get("comments")
    reposts = metrics.get("reposts")

    author = meta.get("author") or ""
    title = author and f"{author} 的 LinkedIn 帖子" or f"LinkedIn 帖子 {activity_id}"

    lines: list[str] = []
    lines.append(f"# {title}")
    lines.append("")
    lines.append(f"- 帖子 activity_id：`{activity_id}`")
    if author:
        lines.append(f"- 作者：{author}")
    if meta.get("age"):
        lines.append(f"- 发布距今：{meta['age']}")
    lines.append(f"- 链接：https://www.linkedin.com/feed/update/urn:li:activity:{activity_id}/")
    lines.append(f"- 抓取时间：{dt.datetime.now().strftime('%Y-%m-%d %H:%M')}")
    lines.append("")

    lines.append("## 数据快照")
    lines.append("")
    lines.append(f"- 展示（Impressions）：{_fmt_num(impressions)}")
    lines.append(f"- 触达人数（Members reached）：{_fmt_num(metrics.get('reach'))}")
    lines.append(f"- 社交互动（Social engagements）：{_fmt_num(metrics.get('social_engagement'))}")
    lines.append(f"- 点赞 / 反应（Reactions）：{_fmt_num(reactions)}")
    lines.append(f"- 评论（Comments）：{_fmt_num(comments)}")
    lines.append(f"- 转发（Reposts）：{_fmt_num(reposts)}")
    lines.append(f"- 收藏（Saves）：{_fmt_num(metrics.get('saves'))}")
    lines.append(f"- 私信转发（Sends）：{_fmt_num(metrics.get('sends'))}")
    lines.append(f"- 帖子带来的主页访问（Profile viewers from post）：{_fmt_num(metrics.get('profile_views_from_post'))}")
    lines.append(f"- 帖子带来的新增关注（Followers from post）：{_fmt_num(metrics.get('followers_from_post'))}")
    lines.append("")
    lines.append("派生比率（相对展示数）：")
    lines.append(f"- 反应率：{_ratio(reactions, impressions)}")
    lines.append(f"- 评论率：{_ratio(comments, impressions)}")
    lines.append(f"- 转发率：{_ratio(reposts, impressions)}")
    lines.append(f"- 社交互动率：{_ratio(metrics.get('social_engagement'), impressions)}")
    lines.append("")

    lines.append("## 帖子正文")
    lines.append("")
    body = (meta.get("text") or "").strip()
    lines.append(body if body else "（未抓到正文——单帖分析页有时不含完整正文，可手动补）")
    lines.append("")

    lines.append("## 原始稿子")
    lines.append("")
    lines.append(script.strip() if script.strip() else "（未提供）")
    lines.append("")

    lines.append("## 评论")
    lines.append("")
    if comments:
        lines.append(
            f"LinkedIn 单帖分析页只给评论**数**（{comments} 条），不含评论正文。"
        )
        lines.append(
            "评论文本是真信号——建议手动把 top 评论粘到这一节，供复盘分析。"
        )
    else:
        lines.append("（没有评论，或未抓到评论数）")
    lines.append("")

    return "\n".join(lines)


def slugify(text: str, max_len: int = 30) -> str:
    """生成文件夹友好的短标题。"""
    bad = '<>:"/\\|?*\n\r\t'
    out = "".join("_" if ch in bad else ch for ch in text).strip()
    return out[:max_len] or "untitled"


def output_dir_for(post: dict, root: Path) -> Path:
    activity_id = post.get("activity_id", "") if post else ""
    date = dt.datetime.now().strftime("%Y-%m-%d")
    author = (post.get("meta", {}) or {}).get("author") if post else ""
    slug = slugify(author or activity_id or "linkedin")
    return root / f"{date}_{activity_id}_{slug}".rstrip("_")
