"""
内置桌面宠物 · AI 美术合成器（09-30）

为什么用 Python 而不是继续用 Node 生成器：
  这里要做的是**位图处理**（解码 PNG / 泛洪抠背景 / 旋转缩放重采样 / 合成），
  PIL 三行就能做的事，在 Node 里要自己写 PNG 解码器 + 双线性重采样（且沙箱禁 spawn）。
  ⛔ Node 那支（`scripts/gen-pet-spritesheets.mjs`）保留为**程序化保底路线**，两支产物同格式。

生图给的是「角色的 N 个姿态」（不是序列帧）——生图模型做不出 8 列 × 9 行、每帧严格的网格，
所以分工是：**美术 = 生图，运动 = 这里按帧做变换**（起伏 / 倾斜 / 压扁 / 水平镜像 / 覆盖件）。
这样每一行都是真在动，而不是"一张图在抖"。

输出：`public/pets/<slug>/spritesheet.png`（8 列 × 9 行，每帧 192×208）+ `pet.json`。
"""
import collections
import json
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART_DIR = os.path.join(ROOT, ".workbuddy", "tmp", "pet-art2")
OUT_ROOT = os.path.join(ROOT, "public", "pets")

FRAME_W, FRAME_H = 192, 208
COLS, ROWS = 8, 9
FOOT_Y = 196          # 脚底基准线（与 Node 那支同源）
CENTER_X = 96

# 九态行名（顺序即行序，⛔ 官方规范，不可重排）
STATES = ["idle", "running-right", "running-left", "waving", "jumping", "failed", "waiting", "running", "review"]

# 每一行用哪个姿态图：一个姿态供多行复用，差异靠这一行的"帧变换 + 覆盖件"表达
ROW_ART = {
    "idle": "stand",
    "running-right": "run",
    "running-left": "run",      # 镜像
    "waving": "cheer",
    "jumping": "cheer",
    "failed": "tired",
    "waiting": "stand",
    "running": "work",
    "review": "stand",
}

PETS = ["harness-blob", "harness-cat", "harness-bot"]
POSE_FILES = ["stand", "cheer", "tired", "run", "work"]
NAME_OF = {"harness-blob": "小墨", "harness-cat": "阿弦", "harness-bot": "小枢"}
DESC_OF = {
    "harness-blob": "工程助手墨滴：安静、专注，任务完成会蹦一下。",
    "harness-cat": "原型猫：耳朵尖、尾巴会摆，等指令时会左右张望。",
    "harness-bot": "原型机器人：头顶天线，工作时双眼与天线的灯会加速闪动。",
}


def cut_background(im, tol=26):
    """
    抠背景。两条路，按**边框众数色**自动选：

    · 浅底（多数场景：生图给的白底）→ **全局限定容差**泛洪。基准色单一，最稳。
    · 深底（edits 端点偶尔给的纯黑/深色渐变）→ **自适应区域生长**（每步只与已判定的
      邻居比色，能顺着渐变走）。

    ⛔ 实测教训（09-30）：深底 + **深色角色**（黑猫炭灰毛 ≈ 黑底）时，任何基于颜色的
      抠法都会渗进身体（自适应 tol 26 直接把猫掏空）。**这种情况不要靠算法救** ——
      让生图改出**白底**（与三个角色都高对比），走上面那条稳的路。
    ⛔ 绝不用「全局去色」：奶白肚皮、深色描边会被一起打穿。泛洪 + 闭合描边保证只吃外面。
    """
    rgba = im.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()

    # 边框众数色 → 判断底色深浅
    samples = []
    sx, sy = max(1, w // 96), max(1, h // 96)
    for x in range(0, w, sx):
        for y in (0, 1, 2, h - 3, h - 2, h - 1):
            samples.append(px[x, y][:3])
    for y in range(0, h, sy):
        for x in (0, 1, 2, w - 3, w - 2, w - 1):
            samples.append(px[x, y][:3])
    bg = collections.Counter(samples).most_common(1)[0][0]
    light = sum(bg) / 3 > 200

    seen = bytearray(w * h)
    stack = []
    for x in range(w):
        for y in (0, h - 1):
            i = y * w + x
            if not seen[i]:
                seen[i] = 1
                stack.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            i = y * w + x
            if not seen[i]:
                seen[i] = 1
                stack.append((x, y))

    NB = ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1))

    if light:
        # 浅底：所有像素都与**背景基准色**比（单基准最稳，不会顺着色差往外扩）
        while stack:
            x, y = stack.pop()
            for dx, dy in NB:
                nx, ny = x + dx, y + dy
                if nx < 0 or ny < 0 or nx >= w or ny >= h:
                    continue
                j = ny * w + nx
                if seen[j]:
                    continue
                c = px[nx, ny]
                if max(abs(c[0] - bg[0]), abs(c[1] - bg[1]), abs(c[2] - bg[2])) <= 60:
                    seen[j] = 1
                    stack.append((nx, ny))
    else:
        # 深底：自适应（与当前像素的邻居比）
        def near(a, b):
            return max(abs(a[0] - b[0]), abs(a[1] - b[1]), abs(a[2] - b[2])) <= tol

        while stack:
            x, y = stack.pop()
            cur = px[x, y]
            for dx, dy in NB:
                nx, ny = x + dx, y + dy
                if nx < 0 or ny < 0 or nx >= w or ny >= h:
                    continue
                j = ny * w + nx
                if seen[j]:
                    continue
                if near(px[nx, ny], cur):
                    seen[j] = 1
                    stack.append((nx, ny))

    # 写回 alpha + 边界 1px 羽化（抹掉抗锯齿光晕）
    for y in range(h):
        row = y * w
        for x in range(w):
            if seen[row + x]:
                r, g, b, _ = px[x, y]
                px[x, y] = (r, g, b, 0)
            elif x and y and x < w - 1 and y < h - 1 and (
                seen[row + x - 1] or seen[row + x + 1] or seen[row - w + x] or seen[row + w + x]
            ):
                r, g, b, a = px[x, y]
                px[x, y] = (r, g, b, min(a, 150))
    return rgba


def alpha_bbox(im, threshold=24):
    """
    按 **alpha 阈值**取包围盒。
    ⛔ 不能用 `getbbox()` 的默认判据（alpha > 0）：生图会在四角留下极淡的杂散像素，
    它把 bbox 撑到整幅画布 ⇒ 角色被等比缩到很小（实测 1021×1492 的"满宽"包围盒里
    真正的猫只有约 700 宽）。阈值化之后再取，才是角色的真实外接框。
    """
    mask = im.getchannel("A").point(lambda v: 255 if v >= threshold else 0)
    return mask.getbbox()


def prepare(src_img):
    """抠背景（仅在原图**不透明**时才做）→ 裁真实包围盒 → 等比缩放到目标高度。"""
    im = src_img.convert("RGBA")
    corners = [im.getpixel(p)[3] for p in [(2, 2), (im.width - 3, 2), (2, im.height - 3), (im.width - 3, im.height - 3)]]
    # 四角都是透明 ⇒ 生图已经给了透明底（本项目用中转站时就是这样），不必再抠
    if max(corners) > 200:
        im = cut_background(im)
    return im


def normalize(im, target_h):
    """裁到不透明包围盒 → 等比缩放到目标高度（脚底/中心由调用方决定）。"""
    bbox = alpha_bbox(im)
    if not bbox:
        return im
    art = im.crop(bbox)
    scale = target_h / art.height
    size = (max(1, round(art.width * scale)), target_h)
    return art.resize(size, Image.LANCZOS)


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    manifest = {}
    for slug in PETS:
        if only and slug != only:
            continue
        src_dir = os.path.join(ART_DIR, slug)
        poses = {}
        for name in POSE_FILES:
            p = os.path.join(src_dir, f"{name}.png")
            if not os.path.exists(p):
                # 生图文件名带时间戳：退回到目录里唯一一个匹配前缀的文件
                cands = [f for f in os.listdir(src_dir) if f.startswith(name)] if os.path.isdir(src_dir) else []
                if not cands:
                    print(f"  ! 缺姿态 {slug}/{name}，跳过该只")
                    poses = None
                    break
                p = os.path.join(src_dir, sorted(cands)[0])
            poses[name] = normalize(prepare(Image.open(p)), 178)
        if not poses:
            continue

        sheet = Image.new("RGBA", (COLS * FRAME_W, ROWS * FRAME_H), (0, 0, 0, 0))
        for row, state in enumerate(STATES):
            art = poses[ROW_ART[state]]
            for col in range(COLS):
                frame = render_frame(art, state, col)
                sheet.alpha_composite(frame, (col * FRAME_W, row * FRAME_H))

        out_dir = os.path.join(OUT_ROOT, slug)
        os.makedirs(out_dir, exist_ok=True)
        png_path = os.path.join(out_dir, "spritesheet.png")
        sheet.save(png_path, "PNG", optimize=True)
        # ⛔ 官方宠物包用的就是 spritesheet.webp；AI 美术带渐变，WebP q88 比 PNG 小约 60%
        #    （实测 1081KB → 420KB）。两条都出，取小的那个，并把实际文件名写进 pet.json。
        webp_path = os.path.join(out_dir, "spritesheet.webp")
        sheet.save(webp_path, "WEBP", quality=88, method=6)
        if os.path.getsize(webp_path) < os.path.getsize(png_path):
            os.remove(png_path)
            sheet_name = "spritesheet.webp"
        else:
            os.remove(webp_path)
            sheet_name = "spritesheet.png"

        meta = {
            "id": slug,
            "displayName": NAME_OF.get(slug, slug),
            "description": DESC_OF.get(slug, ""),
            "spritesheetPath": sheet_name,
            "frameSize": {"width": FRAME_W, "height": FRAME_H},
            "columns": COLS,
            "rows": ROWS,
            "states": STATES,
            "spriteVersionNumber": 1,
            "builtin": True,
        }
        with open(os.path.join(out_dir, "pet.json"), "w", encoding="utf-8") as fh:
            json.dump(meta, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        size = os.path.getsize(os.path.join(out_dir, sheet_name))
        manifest[slug] = size
        print(f"  ✓ {slug:14s} {sheet_name:17s} {size // 1024:5d}KB")
    if not manifest:
        print("没有产出。先跑生图把姿态放到 .workbuddy/tmp/pet-art/<slug>/<pose>.png")
    return 0


def render_frame(art, state, col):
    """一帧：底图按行/列做变换 + 覆盖件。⛔ 变换只改位姿，不重画（底图是生图出的一整张）。"""
    f = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
    t = col / COLS

    # 每行的动势（振幅小一点：桌宠在桌面上，别像卡通片那样夸张）
    dy = 0.0
    angle = 0.0
    squash = 1.0
    dx = 0.0
    if state == "idle":
        dy = -2 + 2 * (1 + _sin(t)) / 2
        squash = 1 + 0.02 * _sin(t)
    elif state in ("running-right", "running-left"):
        bounce = abs(_sin(t * 2))
        dy = -6 * bounce
        angle = (-6 if state == "running-right" else 6) + 2 * _sin(t * 2)
        dx = 6 if state == "running-right" else -6
    elif state == "waving":
        angle = 3 * _sin(t * 2)
        dy = -2 * abs(_sin(t * 2))
    elif state == "jumping":
        arc = _sin(t)          # 0→1→0
        dy = -54 * arc
        squash = 1 - 0.06 * arc
    elif state == "failed":
        dy = 6
        angle = 3 + 1.5 * _sin(t)
    elif state == "waiting":
        angle = 4 * _sin(t)
        dy = -1 + 1 * _sin(t)
    elif state == "running":
        angle = -8 + 2 * _sin(t * 4)
        dx = 4
        dy = -1
    elif state == "review":
        angle = -4 + 2 * _sin(t)

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
    if state in ("waiting", "failed") and col % 2 == 0:
        _zzz(d, x + img.width - 6, y + 6, col)
    if state == "jumping" and col in (1, 2, 3, 5, 6):
        _sparkle(d, x - 8, y + 20)
        _sparkle(d, x + img.width + 8, y + 40)
    if state == "failed":
        _sweat(d, x + img.width - 10, y + 14)
    if state == "running":
        for i in range(2):
            ly = y + 40 + i * 14
            d.line([(x - 12, ly), (x - 2, ly)], fill=(90, 150, 255, 160), width=2)
            d.line([(x + img.width + 2, ly), (x + img.width + 12, ly)], fill=(90, 150, 255, 160), width=2)
    if state == "review":
        cx = x + img.width + 8
        cy = y + 56 + int(6 * _sin(t))
        d.ellipse([cx - 11, cy - 11, cx + 11, cy + 11], outline=(60, 60, 66, 220), width=3)
        d.line([(cx + 8, cy + 8), (cx + 18, cy + 18)], fill=(60, 60, 66, 220), width=4)
    return f


def _sin(t):
    import math
    return math.sin(t * math.pi * 2)


def _zzz(d, x, y, col):
    for i in range(2):
        s = 4 + i * 2
        zx, zy = x + i * 8, y - i * 12
        d.line([(zx - s, zy - s), (zx + s, zy - s)], fill=(120, 170, 250, 210 - i * 60), width=2)
        d.line([(zx + s, zy - s), (zx - s, zy + s)], fill=(120, 170, 250, 210 - i * 60), width=2)
        d.line([(zx - s, zy + s), (zx + s, zy + s)], fill=(120, 170, 250, 210 - i * 60), width=2)


def _sparkle(d, x, y):
    for s in (5, 7):
        d.line([(x - s, y), (x + s, y)], fill=(255, 214, 122, 220), width=2)
        d.line([(x, y - s), (x, y + s)], fill=(255, 214, 122, 220), width=2)


def _sweat(d, x, y):
    d.ellipse([x - 5, y - 7, x + 5, y + 7], fill=(160, 200, 255, 220))


if __name__ == "__main__":
    raise SystemExit(main())
