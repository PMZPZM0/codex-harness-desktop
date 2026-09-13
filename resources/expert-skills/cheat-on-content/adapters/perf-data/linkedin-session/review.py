"""发完帖子后跑一次：抓 LinkedIn 单帖分析 → 生成 NotebookLM 友好的 md。

用法：
    python review.py login                              # 仅登录（首次，弹出浏览器）
    python review.py video <activity_id_or_url> [script.txt]   # 抓单帖分析

`video` 子命令名沿用 douyin-session / bilibili-stat 的契约（/cheat-retro 统一调
`run.sh ... video ...`）；对 LinkedIn 而言"video"即一条帖子。
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import crawler
import renderer
from paths import videos_dir


def run_with_id(activity_raw: str, script_path: str | None) -> None:
    active_videos_dir = videos_dir()
    active_videos_dir.mkdir(parents=True, exist_ok=True)

    activity_id = crawler.extract_activity_id(activity_raw)

    script = ""
    if script_path:
        p = Path(script_path).expanduser()
        if p.is_file():
            script = p.read_text(encoding="utf-8", errors="ignore")
            print(f"稿子：{p.name}（{len(script)} 字符）")
        else:
            print(f"[警告] 找不到稿子 {p}")

    print(f"[抓取] 帖子 activity:{activity_id}")
    result = asyncio.run(crawler.fetch_all(activity_id))
    post = result["post"]
    if not post:
        print("❌ 未抓到数据（多半是未登录）。先跑：python review.py login")
        sys.exit(3)

    out_dir = renderer.output_dir_for(post, active_videos_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    if script:
        (out_dir / "script.txt").write_text(script, encoding="utf-8")
    md = renderer.render_report(post, script)
    report = out_dir / "report.md"
    report.write_text(md, encoding="utf-8")
    print(f"\n✓ {report}")


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "login":
        asyncio.run(crawler.ensure_login())
        return
    if len(sys.argv) > 1 and sys.argv[1] == "video":
        if len(sys.argv) < 3:
            print("用法：python review.py video <activity_id_or_url> [script.txt]")
            sys.exit(3)
        activity_raw = sys.argv[2]
        script_path = sys.argv[3] if len(sys.argv) > 3 else None
        run_with_id(activity_raw, script_path)
        return
    print(__doc__)


if __name__ == "__main__":
    main()
