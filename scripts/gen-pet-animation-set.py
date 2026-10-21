"""
桌面宠物 · 30fps 动画包生成器（10-21 美术替代）

与 `gen-pet-from-art.py`（Petdex 8×9 图集）分工不同：
  · 旧脚本：8 列 × 9 行图集，每态 8 帧，给官方/Petdex 包用；
  · 本脚本：**每态一个动画 WebP（30fps）+ 一张静帧 + 16 向看帧**，给应用内新内置格式用，
    和 Qoder 内置宠物的做法一致，但角色与素材全部自产。

输入：`scripts/pet-art/<slug>/<pose>.png`（白底多姿态角色表裁出来的单姿态；随仓，可重跑）。
输出：`public/pets/<slug>/`：
  idle.webp / idle-still.webp / running-right.webp ...（9 态）
  look-00.webp ... look-15.webp
  pet.json（animationSet + lookFrameSet）

用法：python scripts/gen-pet-animation-set.py [slug]
"""
import json
import math
import os
import runpy
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART_ROOT = os.path.join(ROOT, "scripts", "pet-art")
OUT_ROOT = os.path.join(ROOT, "public", "pets")

FRAME_W, FRAME_H = 192, 208
FOOT_Y = 196
CENTER_X = 96
FPS = 30
FRAMES = 30

STATES = ["idle", "running-right", "running-left", "waving", "jumping", "failed", "waiting", "running", "review"]
ROW_ART = {
    "idle": "stand",
    "running-right": "run",
    "running-left": "run",
    "waving": "cheer",
    "jumping": "cheer",
    "failed": "tired",
    "waiting": "tired",
    "running": "work",
    "review": "review",
}
POSE_FILES = ["stand", "cheer", "tired", "run", "work", "review"]

ART = runpy.run_path(os.path.join(ROOT, "scripts", "gen-pet-from-art.py"))
prepare = ART["prepare"]
normalize = ART["normalize"]
zzz = ART["_zzz"]
sparkle = ART["_sparkle"]
sweat = ART["_sweat"]


def _strip_shadow(im):
    """去掉白底抠图后残留的中性灰软阴影：只从透明边界向内吃掉「低饱和 + 不偏色」的像素。
    奶油色尾尖/白肚皮有暖色偏移（max-min > 16），不会被这条路径吃掉。"""
    rgba = im.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()
    seen = bytearray(w * h)
    stack = []
    for x in range(w):
        for y in (0, h - 1):
            i = y * w + x
            if not seen[i] and px[x, y][3] == 0:
                seen[i] = 1
                stack.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            i = y * w + x
            if not seen[i] and px[x, y][3] == 0:
                seen[i] = 1
                stack.append((x, y))
    nb = ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1))
    while stack:
        x, y = stack.pop()
        for dx, dy in nb:
            nx, ny = x + dx, y + dy
            if nx < 0 or ny < 0 or nx >= w or ny >= h:
                continue
            j = ny * w + nx
            if seen[j]:
                continue
            r, g, b, a = px[nx, ny]
            if a == 0:
                seen[j] = 1
                stack.append((nx, ny))
                continue
            hi, lo = max(r, g, b), min(r, g, b)
            if hi - lo <= 16 and (r + g + b) / 3 >= 100:
                px[nx, ny] = (r, g, b, 0)
                seen[j] = 1
                stack.append((nx, ny))
            else:
                seen[j] = 1
    return rgba


def _sin(t):
    return math.sin(t * math.pi * 2)


def _make_frame(art, state, t):
    f = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
    dy = 0.0
    angle = 0.0
    squash = 1.0
    dx = 0.0
    if state == "idle":
        dy = -1.5 + 2.5 * (1 + _sin(t)) / 2
        squash = 1 + 0.018 * _sin(t)
    elif state in ("running-right", "running-left"):
        bounce = abs(_sin(t * 2))
        dy = -7 * bounce
        angle = (-7 if state == "running-right" else 7) + 2.5 * _sin(t * 2)
        dx = 7 if state == "running-right" else -7
    elif state == "waving":
        angle = 4 * _sin(t * 2)
        dy = -2.5 * abs(_sin(t * 2))
    elif state == "jumping":
        arc = max(0.0, _sin(t))
        dy = -58 * arc
        squash = 1 - 0.07 * arc
    elif state == "failed":
        dy = 6
        angle = 3 + 2 * _sin(t)
    elif state == "waiting":
        angle = 4.5 * _sin(t)
        dy = -1 + 1.5 * _sin(t)
    elif state == "running":
        angle = -9 + 2.5 * _sin(t * 4)
        dx = 4
        dy = -1.5
    elif state == "review":
        angle = -4.5 + 2.5 * _sin(t)
        dy = -1 + 1.5 * _sin(t)

    img = art
    if state == "running-left":
        img = art.transpose(Image.FLIP_LEFT_RIGHT)
    if squash != 1.0:
        img = img.resize((img.width, max(1, round(img.height * squash))), Image.LANCZOS)
    if angle:
        img = img.rotate(angle, resample=Image.BICUBIC, expand=True)
    x = CENTER_X - img.width // 2 + round(dx)
    y = FOOT_Y - img.height + round(dy)
    f.alpha_composite(img, (x, y))

    d = ImageDraw.Draw(f)
    if state in ("waiting", "failed") and round(t * FRAMES) % 2 == 0:
        zzz(d, x + img.width - 6, y + 6, round(t * FRAMES) % 8)
    if state == "jumping" and 0.18 < t < 0.82:
        sparkle(d, x - 8, y + 20)
        sparkle(d, x + img.width + 8, y + 40)
    if state == "failed":
        sweat(d, x + img.width - 10, y + 14)
    if state == "running":
        for i in range(2):
            ly = y + 40 + i * 14
            d.line([(x - 12, ly), (x - 2, ly)], fill=(90, 150, 255, 160), width=2)
            d.line([(x + img.width + 2, ly), (x + img.width + 12, ly)], fill=(90, 150, 255, 160), width=2)
    return f


def _make_look(art, direction):
    """16 向看帧：整身朝指针方向轻移 + 微转（没有逐向美术时的稳定近似）。"""
    angle = direction * 22.5
    rad = math.radians(angle)
    dx = round(math.sin(rad) * 7)
    dy = round(-math.cos(rad) * 4)
    rot = math.sin(rad) * 2.2
    img = art.rotate(rot, resample=Image.BICUBIC, expand=True) if abs(rot) > 0.05 else art
    f = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
    x = CENTER_X - img.width // 2 + dx
    y = FOOT_Y - img.height + dy
    f.alpha_composite(img, (x, y))
    return f


def _save_webp(frames, path, still_path, duration=round(1000 / FPS)):
    frames[0].save(
        path,
        format="WEBP",
        save_all=True,
        append_images=frames[1:],
        duration=duration,
        loop=0,
        quality=88,
        method=6,
    )
    frames[0].save(still_path, format="WEBP", quality=92, method=6)


def main():
    slug = sys.argv[1] if len(sys.argv) > 1 else "harness-fox"
    src_dir = os.path.join(ART_ROOT, slug)
    if not os.path.isdir(src_dir):
        raise SystemExit(f"缺少姿态目录：{src_dir}")
    poses = {}
    for name in POSE_FILES:
        path = os.path.join(src_dir, f"{name}.png")
        if not os.path.exists(path):
            raise SystemExit(f"缺少姿态：{path}")
        poses[name] = normalize(_strip_shadow(prepare(Image.open(path))), 178)

    out_dir = os.path.join(OUT_ROOT, slug)
    os.makedirs(out_dir, exist_ok=True)
    animation_set = {}
    total = 0
    for state in STATES:
        art = poses[ROW_ART[state]]
        frames = [_make_frame(art, state, i / FRAMES) for i in range(FRAMES)]
        animated = f"{state}.webp"
        still = f"{state}-still.webp"
        _save_webp(frames, os.path.join(out_dir, animated), os.path.join(out_dir, still))
        animation_set[state] = {"animatedSrc": animated, "stillSrc": still}
        size = os.path.getsize(os.path.join(out_dir, animated))
        total += size
        print(f"  {state:14s} {FRAMES} 帧 {size // 1024:4d}KB")

    look_frames = []
    for i in range(16):
        frame = _make_look(poses["stand"], i)
        name = f"look-{i:02d}.webp"
        _save_webp([frame], os.path.join(out_dir, name), os.path.join(out_dir, name), duration=1000)
        look_frames.append(name)
        total += os.path.getsize(os.path.join(out_dir, name))

    meta = {
        "id": slug,
        "displayName": "阿焰",
        "description": "黏土小狐狸：工作时抱电脑，完成后拿放大镜审阅，被盯着会看向你。",
        "columns": 8,
        "rows": 9,
        "states": STATES,
        "frameSize": {"width": FRAME_W, "height": FRAME_H},
        "spriteVersionNumber": 1,
        "fps": FPS,
        "builtin": True,
        "supportsLookTracking": True,
        "animationSet": animation_set,
        "lookFrameSet": look_frames,
    }
    with open(os.path.join(out_dir, "pet.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"[pet-animation] {slug} → {out_dir}（动画合计 {total / 1024:.0f}KB）")


if __name__ == "__main__":
    main()
