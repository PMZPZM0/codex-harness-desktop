/**
 * 三只程序化内置宠物的 30fps 动画帧渲染器（10-21 第二轮美术统一）。
 *
 * 已有 `gen-pet-spritesheets.mjs` 出 8 列 × 9 行图集；本脚本复用它的 `drawFrame`
 * 与 `ROW_ANIMATION`，把每行 8 个关键姿势按**浮点 col** 采成 30 帧（30fps），
 * 再交给 `pack-sdf-animation.py` 编码成动画 WebP 并写回 pet.json。
 *
 * 用法：
 *   node scripts/gen-pet-sdf-animation.mjs
 *   python scripts/pack-sdf-animation.py
 *
 * ⛔ 为什么分两步：Node 侧没有 WebP 编码器；Pillow 在 Python 侧已经装好，
 *    和狐狸那套沿用同一个编码参数（q84 / method 4）。
 * ⛔ 帧中间产物只落 `.workbuddy/tmp/sdf-anim/`，打包完由 Python 脚本清掉。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COLS, FRAME_H, FRAME_W, PETS, ROW_ANIMATION, STATE_ROWS, drawFrame, encodePng, mirrorFrame,
} from "./gen-pet-spritesheets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".workbuddy", "tmp", "sdf-anim");
const FRAMES = 30;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const manifest = [];
for (const spec of PETS) {
  const petDir = path.join(OUT, spec.slug);
  for (const state of STATE_ROWS) {
    const dir = path.join(petDir, state);
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < FRAMES; i += 1) {
      const col = (i / FRAMES) * COLS;
      let frame;
      if (state === "running-left") {
        const base = ROW_ANIMATION["running-right"](col);
        frame = mirrorFrame(drawFrame(spec, { ...base, dx: -base.dx }));
      } else {
        frame = drawFrame(spec, ROW_ANIMATION[state](col));
      }
      fs.writeFileSync(path.join(dir, `${String(i).padStart(2, "0")}.png`), encodePng(frame.px, frame.w, frame.h));
    }
    manifest.push({ slug: spec.slug, state, frames: FRAMES, width: FRAME_W, height: FRAME_H });
    console.log(`[sdf-anim] ${spec.slug}/${state} ${FRAMES} 帧`);
  }
}
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`[sdf-anim] 完成 → ${path.relative(ROOT, OUT)}（${manifest.length} 组）`);
