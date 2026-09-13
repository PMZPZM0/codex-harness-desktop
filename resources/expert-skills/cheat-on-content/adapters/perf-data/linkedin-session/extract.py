"""从渲染后的 DOM 文本里抽取 LinkedIn 单帖分析指标。

LinkedIn 把单帖分析（/analytics/post-summary/）SSR/inline 进页面——不是可拦的
voyager XHR，所以读 `inner_text` 文本、按已知标签锚点解析。纯函数，可独立测试
（见 test_extract.py）。

LinkedIn 会在**日文 / 英文之间随机切换**界面语言（同一 session 内都可能换），
所以每个指标都存多语言别名，两套都试。
"""
from __future__ import annotations

import re


def _to_int(s: str) -> int | None:
    """'34,057' → 34057；'1.2K' → 1200；'3M' → 3000000；抽不出返回 None。"""
    s = s.strip().replace(",", "")
    m = re.fullmatch(r"([\d.]+)\s*([KMB]?)", s)
    if not m:
        return None
    mult = {"": 1, "K": 1_000, "M": 1_000_000, "B": 1_000_000_000}[m.group(2)]
    try:
        return int(float(m.group(1)) * mult)
    except ValueError:
        return None


# 单帖分析页（/analytics/post-summary/）。LinkedIn 在 日/英 间**随机切换**语言，
# 所以每个指标存多语言别名。版式两段：
#   顶部指标——值在标签上一行（"before"）
#   互动明细——值在标签下一行（"after"）
# (labels, key, value_position)
POST_METRICS = [
    (("インプレッション数", "Impressions"), "impressions", "before"),
    (("リーチしたメンバー", "Members reached"), "reach", "before"),
    (("この投稿からのプロフィール閲覧ユーザー", "Profile viewers from this post"), "profile_views_from_post", "before"),
    (("この投稿で獲得したフォロワー", "Followers gained from this post"), "followers_from_post", "before"),
    (("ソーシャルエンゲージメント", "Social engagements"), "social_engagement", "before"),
    (("リアクション", "Reactions"), "reactions", "after"),
    (("コメント", "Comments"), "comments", "after"),
    (("再投稿", "Reposts"), "reposts", "after"),
    (("保存数", "Saves"), "saves", "after"),
    (("LinkedInでの送信数", "Sends on LinkedIn"), "sends", "after"),
]

_IMPRESSION_LABELS = ("インプレッション数", "Impressions")

# 作者署名行的语言标记（"…さんが投稿しました • 4日" / "… posted this • 6d"）。
_BYLINE_MARKERS = ("さんが投稿しました", "posted this")
# 顶部指标段之前会出现的小标题（"Discovery" / "調査" 等）——正文与指标的分界。
_BODY_END_MARKERS = ("調査", "Discovery", "ディスカバリー")


def parse_post_summary(text: str) -> dict:
    """单帖分析 DOM 文本 → {'metrics': {...}}。支持 日/英（LinkedIn 随机切换）。

    锚在第一个指标（Impressions）后，避开正文里的数字；每个指标按 value_position
    取前一行 / 后一行。抽不到的指标为 None（接口/版式变更时不致整体崩）。
    """
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    start = 0
    for i, l in enumerate(lines):
        if l in _IMPRESSION_LABELS:
            start = max(0, i - 1)
            break
    scan = lines[start:]
    out = {key: None for _, key, _ in POST_METRICS}
    for i, line in enumerate(scan):
        for labels, key, pos in POST_METRICS:
            if line not in labels or out[key] is not None:
                continue
            j = i - 1 if pos == "before" else i + 1
            if 0 <= j < len(scan):
                out[key] = _to_int(scan[j])
    return {"metrics": out}


def parse_post_meta(text: str) -> dict:
    """从单帖分析 DOM 抽作者署名 + 相对发布时间 + 正文。

    版式（reading order）：署名行（"…さんが投稿しました • 4日" / "… posted this • 6d"）
    → 正文若干行 → 顶部指标小标题（"Discovery"/"調査"）→ 指标段。
    取署名行与小标题之间的行为正文；抽不到时各字段为空，不报错。
    返回 {'author': str, 'age': str, 'text': str}。
    """
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    byline_idx = None
    for i, l in enumerate(lines):
        if any(m in l for m in _BYLINE_MARKERS):
            byline_idx = i
            break
    if byline_idx is None:
        return {"author": "", "age": "", "text": ""}

    byline = lines[byline_idx]
    author, age = "", ""
    if "•" in byline:
        head, _, tail = byline.partition("•")
        age = tail.strip()
        author = head.strip()
    else:
        author = byline.strip()
    for marker in _BYLINE_MARKERS:
        if marker in author:
            author = author.split(marker, 1)[0].strip()
            break

    body: list[str] = []
    for l in lines[byline_idx + 1:]:
        if l in _IMPRESSION_LABELS or l in _BODY_END_MARKERS:
            break
        body.append(l)
    return {"author": author, "age": age, "text": "\n".join(body).strip()}
