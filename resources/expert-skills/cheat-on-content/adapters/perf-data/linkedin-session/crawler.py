"""LinkedIn 单帖分析抓取。

登录一次后，Cookie（含 `li_at`）持久化在 .auth-linkedin/，之后直接复用。
LinkedIn 把单帖分析（/analytics/post-summary/）SSR/inline 进页面，没有稳定可拦的
voyager XHR，所以读渲染后 DOM 文本、按已知标签锚点解析（见 extract.py）。
和 douyin-session 一样：一次抓取共享一个持久化 Chromium 会话。
"""
from __future__ import annotations

import asyncio
import re
from typing import Any

from playwright.async_api import BrowserContext, Page, async_playwright

from paths import auth_dir, debug_dir
from extract import parse_post_meta, parse_post_summary

FEED = "https://www.linkedin.com/feed/"
POST_SUMMARY = "https://www.linkedin.com/analytics/post-summary/urn:li:activity:{activity_id}/"

_ACTIVITY_RE = re.compile(r"urn:li:activity:(\d+)|activity[:-](\d+)|/(\d{15,25})\b")


def extract_activity_id(raw: str) -> str:
    """从帖子 URL 或裸 id 提取 activity_id。

    支持：
    - 裸 id：`7470493738918920193`
    - 帖子链接：`https://www.linkedin.com/feed/update/urn:li:activity:7470493738918920193/`
    - 分析链接：`https://www.linkedin.com/analytics/post-summary/urn:li:activity:7470493738918920193/`
    抽不出时原样返回（交给上层报错）。
    """
    raw = raw.strip()
    if raw.isdigit():
        return raw
    m = _ACTIVITY_RE.search(raw)
    if m:
        return next(g for g in m.groups() if g)
    return raw


class Session:
    """单浏览器会话，持久化登录态。"""

    def __init__(self, ctx: BrowserContext, pw: Any) -> None:
        self.ctx = ctx
        self.pw = pw

    @classmethod
    async def open(cls, headless: bool = False) -> "Session":
        pw = await async_playwright().start()
        auth_path = auth_dir()
        auth_path.mkdir(parents=True, exist_ok=True)
        ctx = await pw.chromium.launch_persistent_context(
            user_data_dir=str(auth_path),
            headless=headless,
            viewport={"width": 1440, "height": 900},
            args=["--disable-blink-features=AutomationControlled"],
        )
        return cls(ctx, pw)

    async def close(self) -> None:
        try:
            await self.ctx.close()
        finally:
            await self.pw.stop()


async def _logged_in(ctx: BrowserContext) -> bool:
    cookies = await ctx.cookies("https://www.linkedin.com")
    return any(c["name"] == "li_at" for c in cookies)


async def ensure_login(timeout_s: int = 300) -> bool:
    """打开 LinkedIn，等用户登录；检测到 li_at cookie 后返回。"""
    sess = await Session.open()
    try:
        page = await sess.ctx.new_page()
        await page.goto(FEED)
        print(f"[登录] 在弹出的 Chromium 里登录 LinkedIn。最多等 {timeout_s} 秒……")
        for i in range(timeout_s):
            if await _logged_in(sess.ctx):
                print(f"[登录] ✓ 检测到 li_at（用时 {i}s）。Cookie 已存到 .auth-linkedin/")
                await asyncio.sleep(1)
                return True
            await asyncio.sleep(1)
        print("[登录] 超时未检测到登录态。")
        return False
    finally:
        await sess.close()


async def _scrape_post(page: Page, activity_id: str) -> dict:
    await page.goto(
        POST_SUMMARY.format(activity_id=activity_id),
        wait_until="domcontentloaded",
        timeout=60000,
    )
    await asyncio.sleep(7)
    if "post-summary" not in page.url:
        print(f"[post] ⚠ 可能被登出 / 重定向：{page.url}")
    txt = await page.inner_text("body")
    dbg = debug_dir()
    dbg.mkdir(parents=True, exist_ok=True)
    (dbg / f"post_{activity_id}.txt").write_text(txt, encoding="utf-8")

    result = parse_post_summary(txt)
    result["meta"] = parse_post_meta(txt)
    result["activity_id"] = activity_id
    if result["metrics"].get("impressions") is None:
        print(f"[post] ⚠ {activity_id} 没抽到 impressions（结构可能变了，看 {dbg}/post_{activity_id}.txt）")
    return result


async def fetch_post_summary(activity_id: str, headless: bool = True) -> dict:
    """DOM 抽取单帖分析（/analytics/post-summary/）。只能看**你自己**的帖子。"""
    sess = await Session.open(headless=headless)
    try:
        if not await _logged_in(sess.ctx):
            print("[post] 未登录。先跑：python review.py login")
            return {}
        page = await sess.ctx.new_page()
        return await _scrape_post(page, activity_id)
    finally:
        await sess.close()


async def fetch_all(activity_id: str, headless: bool = True) -> dict:
    """抓单帖分析，返回 {'post': {...}}（与 review.py 的渲染入口对齐）。"""
    print(f"  → 打开单帖分析页 activity:{activity_id}")
    post = await fetch_post_summary(activity_id, headless=headless)
    if post:
        m = post.get("metrics", {})
        print(f"       impressions={m.get('impressions')} reactions={m.get('reactions')} comments={m.get('comments')}")
    return {"post": post}


if __name__ == "__main__":
    asyncio.run(ensure_login())
