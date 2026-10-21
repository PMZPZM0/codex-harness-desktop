"""
桌面宠物 · 30fps 动画包生成器（10-21 美术替代 · 第二轮）

与 `gen-pet-from-art.py`（Petdex 8×9 图集）分工不同：
  · 旧脚本：8 列 × 9 行图集，每态 8 帧，给官方/Petdex 包用；
  · 本脚本：**每态一个动画 WebP（30fps）+ 一张静帧 + 16 向看帧**，给应用内新内置格式用。
    角色与素材全部自产，不复制 Qoder 的 Qoduck。

第二轮（10-21 夜）换掉第一版的 192×208 小图：画布 288×312，源图按 270px 归一，
再加上分段运动（呼吸 / 头部起伏 / 尾巴摆动 / 眨眼）与状态特效，避免"整张图在抖"。

输入：`scripts/pet-art/<slug>/<pose>.png`（白底或透明底的单姿态；随仓，可重跑）。
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
from collections import deque

from PIL import Image, ImageDraw
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART_ROOT = os.path.join(ROOT, "scripts", "pet-art")
OUT_ROOT = os.path.join(ROOT, "public", "pets")

FRAME_W, FRAME_H = 288, 312
ART_H = 270
FOOT_Y = 298
CENTER_X = 144
FPS = 30
FRAMES = 30
IDLE_FRAMES = 45

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
TAIL_SIDE = {
    "stand": "right",
    "cheer": "right",
    "tired": "right",
    "work": "right",
    "review": "right",
    "run": "left",
}

ART = runpy.run_path(os.path.join(ROOT, "scripts", "gen-pet-from-art.py"))
prepare = ART["prepare"]
normalize = ART["normalize"]
sparkle = ART["_sparkle"]
sweat = ART["_sweat"]


def _strip_shadow(im):
    """去掉白底抠图后残留的中性灰软阴影：只从透明边界向内吃掉「低饱和 + 不偏色」的像素。"""
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


def _clean_white_holes(im):
    """抠底后脚缝里会留下小片近白像素（四周被腿围住，泛洪进不去）——按连通块删掉。
    只扫下半身且要求近乎纯白，避免误伤奶白肚皮 / 眼里的高光。"""
    rgba = im.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()
    out = im.copy()
    op = out.load()
    seen = bytearray(w * h)
    for y in range(int(h * 0.45), h):
        for x in range(w):
            i = y * w + x
            if seen[i]:
                continue
            r, g, b, a = px[x, y]
            if a < 32 or min(r, g, b) < 235 or max(r, g, b) - min(r, g, b) > 12:
                seen[i] = 1
                continue
            q = deque([(x, y)])
            seen[i] = 1
            comp = []
            while q:
                cx, cy = q.popleft()
                comp.append((cx, cy))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = cx + dx, cy + dy
                    if nx < 0 or ny < 0 or nx >= w or ny >= h:
                        continue
                    j = ny * w + nx
                    if seen[j]:
                        continue
                    rr, gg, bb, aa = px[nx, ny]
                    if aa >= 32 and min(rr, gg, bb) >= 235 and max(rr, gg, bb) - min(rr, gg, bb) <= 12:
                        seen[j] = 1
                        q.append((nx, ny))
                    else:
                        seen[j] = 1
            if len(comp) >= 12:
                for cx, cy in comp:
                    rr, gg, bb, aa = op[cx, cy]
                    op[cx, cy] = (rr, gg, bb, 0)
    return out


def _clean_floor(im):
    """站/坐/跑这类贴地姿态：从底部亮灰像素向上泛洪，吃掉接触阴影与脚缝白底。
    ⛔ 不用于 work/review：笔记本和放大镜是浅色物体，泛洪会咬进道具。"""
    w, h = im.size
    px = im.load()
    seen = bytearray(w * h)
    q = deque()
    out = im.copy()
    op = out.load()
    for y in range(h - 10, h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 0 and (r + g + b) / 3 >= 150 and max(r, g, b) - min(r, g, b) <= 40 and (r - b) <= 26:
                if not seen[y * w + x]:
                    seen[y * w + x] = 1
                    q.append((x, y))
    while q:
        x, y = q.popleft()
        rr, gg, bb, aa = op[x, y]
        op[x, y] = (rr, gg, bb, 0)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if nx < 0 or ny < 0 or nx >= w or ny >= h:
                continue
            j = ny * w + nx
            if seen[j]:
                continue
            seen[j] = 1
            rr, gg, bb, aa = px[nx, ny]
            if aa > 0 and (rr + gg + bb) / 3 >= 150 and max(rr, gg, bb) - min(rr, gg, bb) <= 40 and (rr - bb) <= 26:
                q.append((nx, ny))
    return out


def _recolor_laptop(im):
    """把 work 姿态里的浅灰笔记本改成深蓝：白底抠图会把浅灰当背景吃掉，
    先按「低饱和 + 偏冷 + 非纯白」把屏幕/键盘染深，再走泛洪抠底就不会丢笔记本。
    ⛔ 只吃 b >= r-1 的冷灰：暖灰接触阴影保持原样，交给 _strip_shadow 清。"""
    rgba = im.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()
    for y in range(int(h * 0.55), h):
        for x in range(0, int(w * 0.60)):
            r, g, b, a = px[x, y]
            if a < 32:
                continue
            hi, lo = max(r, g, b), min(r, g, b)
            bright = (r + g + b) / 3
            if hi - lo <= 26 and abs(r - b) <= 18 and abs(r - g) <= 14 and 160 <= bright <= 242 and b >= r - 1:
                px[x, y] = (int(10 + bright * 0.16), int(16 + bright * 0.20), int(30 + bright * 0.30), a)
    return rgba


def _clean_laptop_glow(im):
    """删掉 work 姿态底部的蓝色反光/光晕：它是生图自带的一圈冷色，不是角色，
    留在深色桌面上会像一条蓝色涂鸦。笔记本本体是中性深灰，不会命中。"""
    w, h = im.size
    px = im.load()
    out = im.copy()
    op = out.load()
    for y in range(int(h * 0.86), h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 0 and b - r >= 25 and b - g >= 12 and (r + g + b) / 3 < 180:
                op[x, y] = (r, g, b, 0)
    return out


def _clean_center_floor(im):
    """脚底之间最后残留的近白/浅灰（含接触阴影）：只在画面中下部中线附近按颜色清掉。
    站/坐/跑三姿态的脚是深棕色，不会误伤；尾巴在两侧，不在这个 x 窗口里。"""
    w, h = im.size
    px = im.load()
    out = im.copy()
    op = out.load()
    for y in range(int(h * 0.84), h):
        for x in range(int(w * 0.15), int(w * 0.75)):
            r, g, b, a = px[x, y]
            if a > 0 and (r + g + b) / 3 >= 150 and max(r, g, b) - min(r, g, b) <= 45:
                op[x, y] = (r, g, b, 0)
    return out


def _pupils(im):
    """找两只瞳孔（近黑连通块），用鼻子作参照排除耳朵与鼻孔。
    找不到就返回空 → 该态不眨眼（宁可不动，也不要画歪一只眼）。"""
    w, h = im.size
    px = im.load()
    seen = bytearray(w * h)
    comps = []
    for y in range(0, int(h * 0.55)):
        for x in range(w):
            i = y * w + x
            if seen[i]:
                continue
            r, g, b, a = px[x, y]
            if a < 200 or (r + g + b) / 3 >= 70:
                seen[i] = 1
                continue
            q = deque([(x, y)])
            seen[i] = 1
            pts = []
            while q:
                cx, cy = q.popleft()
                pts.append((cx, cy))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = cx + dx, cy + dy
                    if nx < 0 or ny < 0 or nx >= w or ny >= int(h * 0.55):
                        continue
                    j = ny * w + nx
                    if seen[j]:
                        continue
                    rr, gg, bb, aa = px[nx, ny]
                    if aa >= 200 and (rr + gg + bb) / 3 < 70:
                        seen[j] = 1
                        q.append((nx, ny))
                    else:
                        seen[j] = 1
            if len(pts) >= 80:
                xs = [p[0] for p in pts]
                ys = [p[1] for p in pts]
                comps.append((len(pts), (min(xs), min(ys), max(xs), max(ys))))
    nose = None
    for area, bb in comps:
        cx = (bb[0] + bb[2]) / 2
        cy = (bb[1] + bb[3]) / 2
        if cy > h * 0.42 and abs(cx - w / 2) < w * 0.18 and (nose is None or area > nose[0]):
            nose = (area, bb, cx, cy)
    if not nose:
        return []
    eyes = []
    for area, bb in comps:
        cx = (bb[0] + bb[2]) / 2
        cy = (bb[1] + bb[3]) / 2
        if cy < nose[3] - 5 and area >= 120:
            eyes.append((area, bb, cx, cy))
    eyes = sorted(eyes, reverse=True)[:2]
    if len(eyes) < 2:
        return []
    return [(bb, cx, cy) for _area, bb, cx, cy in eyes]


def _closed_eyes(art, coverage):
    """闭眼帧：把上眼皮画成周围毛色，留一条深色眼缝。
    在 3× 画布上画再缩回，避免 PIL 椭圆边缘的锯齿。"""
    if coverage <= 0:
        return art
    eyes = _pupils(art)
    if len(eyes) < 2:
        return art
    scale = 3
    w, h = art.size
    px = art.load()
    big = art.resize((w * scale, h * scale), Image.LANCZOS)
    d = ImageDraw.Draw(big)
    for (x0, y0, x1, y1), cx, cy in eyes:
        ex0, ey0, ex1, ey1 = x0 - 10, y0 - 11, x1 + 10, y1 + 8
        sy = max(0, ey0 - 3)
        cols = [px[x, sy][:3] for x in range(max(0, ex0), min(w, ex1 + 1)) if px[x, sy][3] > 200]
        above = tuple(sum(c[i] for c in cols) // len(cols) for i in range(3)) if cols else (200, 90, 30)
        below = px[int(cx), min(h - 1, ey1 + 4)][:3]
        col = tuple(int(above[i] * 0.86 + below[i] * 0.14) for i in range(3))
        lid_h = (ey1 - ey0) * max(0.0, min(1.0, coverage))
        bx0, bx1 = ex0 * scale, ex1 * scale
        by0 = ey0 * scale
        by1 = (ey0 + lid_h) * scale
        if by1 <= by0:
            continue
        d.ellipse([bx0, by0, bx1, by1 + (ey1 - ey0) * scale * 0.12], fill=col + (255,))
        d.arc([bx0 + 1, by0 + 1, bx1 - 1, by1], 15, 165, fill=(45, 28, 20, 255), width=2 * scale)
    return big.resize((w, h), Image.LANCZOS)


def _warp(im, fn):
    """NumPy 向量化双线性变形。⛔ 不要退回 Pillow 的 Image.MESH：
    实测 14×10 网格在透明图上会拼出大块马赛克（相邻 tile 不缝合），
    第一版 288×312 就是这么炸的。"""
    src = np.asarray(im.convert("RGBA"), dtype=np.float32)
    h, w = src.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    sx, sy = fn(xx, yy)
    x0 = np.floor(sx).astype(np.int32)
    y0 = np.floor(sy).astype(np.int32)
    x1 = x0 + 1
    y1 = y0 + 1
    wx = (sx - x0)[..., None]
    wy = (sy - y0)[..., None]

    def sample(xi, yi):
        valid = (xi >= 0) & (xi < w) & (yi >= 0) & (yi < h)
        xc = np.clip(xi, 0, w - 1)
        yc = np.clip(yi, 0, h - 1)
        out = src[yc, xc]
        out[~valid] = 0
        return out

    out = (sample(x0, y0) * (1 - wx) * (1 - wy) + sample(x1, y0) * wx * (1 - wy)
           + sample(x0, y1) * (1 - wx) * wy + sample(x1, y1) * wx * wy)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA")


def _head_bob(im, phase, amp=1.8):
    h = im.height
    span = h * 0.58

    def fn(x, y):
        weight = np.clip((span - y) / span, 0.0, 1.0)
        return x + 0.55 * amp * weight * math.sin(phase + 1.1), y + amp * weight * math.sin(phase)

    return _warp(im, fn)


def _tail_wave(im, phase, side, amp=4.2):
    w = im.width
    pivot = w * 0.55

    def fn(x, y):
        if side == "right":
            weight = np.clip((x - pivot) / max(1.0, w - pivot), 0.0, 1.0)
        else:
            weight = np.clip((pivot - x) / max(1.0, pivot), 0.0, 1.0)
        weight = weight ** 1.5
        dx = amp * weight * math.sin(phase)
        dy = amp * 0.45 * weight * math.sin(phase + 0.9)
        return x - dx, y - dy

    return _warp(im, fn)


def _sin(t):
    return math.sin(t * math.pi * 2)


def _clean_floor_pixels(im):
    """最后一刀：合成后脚底中线附近残留的近白底/浅灰阴影直接清掉。
    只扫底部 10% 的中段（尾巴在两侧、脚是深棕），work/review 有浅色道具不调用。"""
    w, h = im.size
    px = im.load()
    for y in range(int(h * 0.90), h):
        for x in range(int(w * 0.15), int(w * 0.75)):
            r, g, b, a = px[x, y]
            if a > 0 and (r + g + b) / 3 >= 190 and max(r, g, b) - min(r, g, b) <= 30:
                px[x, y] = (r, g, b, 0)
    return im


def _make_frame(art, state, t, pose, blink=None):
    dy = 0.0
    angle = 0.0
    squash = 1.0
    dx = 0.0
    if state == "idle":
        dy = -1.0 + 2.0 * (1 + _sin(t)) / 2
        squash = 1 + 0.012 * _sin(t)
        angle = 0.8 * _sin(t)
    elif state in ("running-right", "running-left"):
        bounce = abs(_sin(t * 2))
        dy = -9 * bounce
        angle = (-6 if state == "running-right" else 6) + 2.2 * _sin(t * 2)
        dx = 9 if state == "running-right" else -9
    elif state == "waving":
        angle = 3.5 * _sin(t * 2)
        dy = -3.0 * abs(_sin(t * 2))
    elif state == "jumping":
        arc = max(0.0, math.sin(math.pi * t))
        dy = -20 * arc
        squash = 1 + 0.02 * arc
    elif state == "failed":
        dy = 6
        angle = 2.5 + 2.0 * _sin(t)
        dx = 0.6 * _sin(t * 4)
    elif state == "waiting":
        angle = 4.0 * _sin(t)
        dy = -1 + 1.5 * _sin(t)
    elif state == "running":
        angle = -5.0 + 2.0 * _sin(t * 4)
        dx = 3
        dy = -1.0
    elif state == "review":
        angle = -3.5 + 2.0 * _sin(t)
        dy = -1 + 1.5 * _sin(t)

    img = art if blink is None else blink
    if state in ("idle", "waiting", "review", "running"):
        img = _head_bob(img, t * math.pi * 2)
    if pose in TAIL_SIDE:
        img = _tail_wave(img, t * math.pi * 2 + (1.2 if state in ("idle", "waiting") else 0), TAIL_SIDE[pose])
    if state == "running-left":
        img = img.transpose(Image.FLIP_LEFT_RIGHT)
    if squash != 1.0:
        img = img.resize((img.width, max(1, round(img.height * squash))), Image.LANCZOS)
    if angle:
        img = img.rotate(angle, resample=Image.BICUBIC, expand=True)
    x = CENTER_X - img.width // 2 + round(dx)
    y = FOOT_Y - img.height + round(dy)
    frame = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
    frame.alpha_composite(img, (x, y))
    if state not in ("running", "review"):
        frame = _clean_floor_pixels(frame)

    d = ImageDraw.Draw(frame)
    n = t * FRAMES
    if state in ("waiting", "failed") and round(n) % 2 == 0:
        _zzz(d, x + img.width - 2, y + 14, round(n) % 8, scale=1.5)
    if state == "jumping" and 0.16 < t < 0.84:
        sparkle(d, x - 12, y + 30)
        sparkle(d, x + img.width + 12, y + 52)
    if state == "waving" and round(n) % 3 == 0:
        sparkle(d, x + img.width + 6, y + 18)
    if state == "failed":
        sweat(d, x + img.width - 6, y + 20)
    if state in ("running-right", "running-left"):
        back = -1 if state == "running-right" else 1
        for i in range(3):
            ly = y + img.height * 0.55 + i * 14
            d.line([(x + (img.width if back > 0 else 0) + back * (6 + i * 4), ly),
                    (x + (img.width if back > 0 else 0) + back * (26 + i * 6), ly)],
                   fill=(110, 165, 255, 150), width=2)
        for i in range(2):
            px = x + img.width * (0.32 + i * 0.2)
            py = FOOT_Y - 4
            r = 4 + i * 2
            d.ellipse([px - r, py - r, px + r, py + r], fill=(205, 186, 160, 120))
    if state == "running":
        for i in range(2):
            px = x + img.width * (0.34 + i * 0.16)
            py = y + img.height * 0.78
            if round(n) % 2 == i % 2:
                d.line([(px - 3, py - 5), (px + 3, py + 5)], fill=(255, 220, 130, 210), width=2)
                d.line([(px + 3, py - 5), (px - 3, py + 5)], fill=(255, 220, 130, 210), width=2)
    if state == "review" and 0.25 < t < 0.55:
        gx = x + img.width * 0.8
        gy = y + img.height * 0.25
        d.line([(gx - 7, gy - 7), (gx + 5, gy + 5)], fill=(255, 255, 255, 200), width=2)
    return frame


def _zzz(d, x, y, phase, scale=1.0):
    for i in range(2):
        s = (4 + i * 2) * scale
        zx, zy = x + i * 8 * scale, y - i * 12 * scale
        alpha = 210 - i * 60
        d.line([(zx - s, zy - s), (zx + s, zy - s)], fill=(120, 170, 250, alpha), width=max(2, round(2 * scale)))
        d.line([(zx + s, zy - s), (zx - s, zy + s)], fill=(120, 170, 250, alpha), width=max(2, round(2 * scale)))
        d.line([(zx - s, zy + s), (zx + s, zy + s)], fill=(120, 170, 250, alpha), width=max(2, round(2 * scale)))


def _make_look(art, direction):
    """16 向看帧：整身朝指针方向轻移 + 微转（没有逐向美术时的稳定近似）。"""
    angle = direction * 22.5
    rad = math.radians(angle)
    dx = round(math.sin(rad) * 10)
    dy = round(-math.cos(rad) * 6)
    rot = math.sin(rad) * 2.2
    img = art.rotate(rot, resample=Image.BICUBIC, expand=True) if abs(rot) > 0.05 else art
    frame = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
    x = CENTER_X - img.width // 2 + dx
    y = FOOT_Y - img.height + dy
    frame.alpha_composite(img, (x, y))
    return frame


def _save_webp(frames, path, still_path, duration=round(1000 / FPS)):
    frames[0].save(
        path,
        format="WEBP",
        save_all=True,
        append_images=frames[1:],
        duration=duration,
        loop=0,
        quality=84,
        method=4,
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
        src = Image.open(path)
        if name == "work":
            src = _recolor_laptop(src)
        art = _clean_white_holes(_strip_shadow(prepare(src)))
        if name == "work":
            art = _clean_laptop_glow(art)
        if name == "work" and art.height > 24:
            # 笔记本在地面上的蓝色反光贴在 bbox 底部，裁掉几像素，别让它跟着角色跳
            art = art.crop((0, 0, art.width, art.height - 6))
        if name in ("stand", "tired", "run", "cheer"):
            art = _clean_floor(art)
        poses[name] = normalize(art, ART_H)
        if name in ("stand", "tired", "run", "cheer"):
            poses[name] = _clean_center_floor(poses[name])

    out_dir = os.path.join(OUT_ROOT, slug)
    os.makedirs(out_dir, exist_ok=True)
    animation_set = {}
    total = 0
    for state in STATES:
        pose = ROW_ART[state]
        art = poses[pose]
        count = IDLE_FRAMES if state == "idle" else FRAMES
        blinks = {}
        if state == "idle":
            blinks = {0.4: _closed_eyes(art, 0.4), 0.84: _closed_eyes(art, 0.84)}
        frames = []
        for i in range(count):
            t = i / count
            blink = None
            if state == "idle" and i in (30, 31, 32):
                blink = blinks[0.4] if i != 31 else blinks[0.84]
            frames.append(_make_frame(art, state, t, pose, blink))
        animated = f"{state}.webp"
        still = f"{state}-still.webp"
        _save_webp(frames, os.path.join(out_dir, animated), os.path.join(out_dir, still))
        animation_set[state] = {"animatedSrc": animated, "stillSrc": still}
        size = os.path.getsize(os.path.join(out_dir, animated))
        total += size
        total += os.path.getsize(os.path.join(out_dir, still))
        print(f"  {state:14s} {count} 帧 {size // 1024:4d}KB")

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
        "description": "细毛小狐狸：工作时敲电脑，完成后拿放大镜审阅，被盯着会看向你。",
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
    print(f"[pet-animation] {slug} → {out_dir}（整包 {total / 1024:.0f}KB）")


if __name__ == "__main__":
    main()
