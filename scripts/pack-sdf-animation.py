"""
把 `gen-pet-sdf-animation.mjs` 渲染的 PNG 帧编码成动画 WebP，并合并进三只内置宠物的 pet.json。

用法：
  node scripts/gen-pet-sdf-animation.mjs
  python scripts/pack-sdf-animation.py

产物：`public/pets/<slug>/<state>.webp` + `<state>-still.webp`，pet.json 增加
`fps: 30` 与 `animationSet`（保留原来的 spritesheet 字段，官方图集消费方不受影响）。
中间帧在 `.workbuddy/tmp/sdf-anim/`，打包成功后删除。
"""
import json
import os
import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / ".workbuddy" / "tmp" / "sdf-anim"
OUT_ROOT = ROOT / "public" / "pets"
STATES = ["idle", "running-right", "running-left", "waving", "jumping", "failed", "waiting", "running", "review"]
FPS = 30


def main():
    manifest_path = SRC / "manifest.json"
    if not manifest_path.exists():
        raise SystemExit("缺少 .workbuddy/tmp/sdf-anim/manifest.json，先跑 node scripts/gen-pet-sdf-animation.mjs")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    by_slug = {}
    for entry in manifest:
        by_slug.setdefault(entry["slug"], {})[entry["state"]] = entry

    total = 0
    for slug, states in by_slug.items():
        out_dir = OUT_ROOT / slug
        out_dir.mkdir(parents=True, exist_ok=True)
        meta_path = out_dir / "pet.json"
        if not meta_path.exists():
            raise SystemExit(f"缺少 {meta_path}（内置包应先由 gen-pet-spritesheets.mjs 生成）")
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        animation_set = {}
        for state in STATES:
            frame_dir = SRC / slug / state
            files = sorted(frame_dir.glob("*.png"))
            if len(files) < 10:
                raise SystemExit(f"{slug}/{state} 帧数不足：{len(files)}")
            frames = [Image.open(p).convert("RGBA") for p in files]
            animated = out_dir / f"{state}.webp"
            still = out_dir / f"{state}-still.webp"
            frames[0].save(
                animated, format="WEBP", save_all=True, append_images=frames[1:],
                duration=round(1000 / FPS), loop=0, quality=84, method=4,
            )
            frames[0].save(still, format="WEBP", quality=90, method=4)
            animation_set[state] = {"animatedSrc": animated.name, "stillSrc": still.name}
            total += animated.stat().st_size + still.stat().st_size
            print(f"  {slug:14s} {state:14s} {len(frames)} 帧 {animated.stat().st_size // 1024:4d}KB")
        meta["fps"] = FPS
        meta["animationSet"] = animation_set
        meta["supportsLookTracking"] = False
        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"[sdf-pack] {slug} → {out_dir}")

    shutil.rmtree(SRC, ignore_errors=True)
    print(f"[sdf-pack] 完成，动画合计 {total / 1024:.0f}KB；中间帧已清理")


if __name__ == "__main__":
    main()
