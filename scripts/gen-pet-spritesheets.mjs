/**
 * 内置桌面宠物生成器 —— 产出**官方 Codex 宠物格式**的宠物包。
 *
 * 官方格式（实测自 codex 引擎二进制 + petdex 公开规范，两者逐字吻合）：
 *   宠物包 = `pet.json` + `spritesheet.webp`
 *   图集   = 8 列 × 9 行，每帧 192×208（v1 整图 1536×1872）
 *   九态行名（**顺序即行序**，⛔ 不可重排、不可增删 —— 引擎按行号取图）：
 *     idle / running-right / running-left / waving / jumping / failed / waiting / running / review
 *
 * 为什么要自己画（而不是下现成的）：
 *   社区宠物包 99% 是《鸣潮》《崩铁》等同人美术，许可证多为 CC BY-NC 或无许可
 *   ⇒ 对外发布的产品不能带。内置宠物必须**自产**，才能零授权风险。
 *   参考：Kenney（CC0）是另一条干净路线，但那批素材没有「九态序列帧」这个形态。
 *
 * 画法：零依赖的 SDF 光栅化（每个形状按距离场算覆盖率做抗锯齿），
 *   9 行 × 8 帧全部由「同一套分层部件 + 每帧不同变换」画出来 —— 与手画骨骼同一个思路，
 *   保证 72 帧之间比例一致（逐帧独立出图必然比例漂移）。
 *
 * 产物落 `public/pets/<slug>/`（→ dist/pets/），**⛔ 不要放 src/ 当模块 import**：
 *   `scripts/before-pack.cjs` 的打包装裁剪只走 `dist/assets/` 的可达闭包，
 *   而它的闭包规则只认 js/css 与 CSS 里的 url() —— JS 里 import 位图会被判成"陈旧死块"删掉
 *   （v0.0.27 事故同型）。放 public/ 出去落在 dist/pets/，不在裁剪面内。
 *
 * 用法：node scripts/gen-pet-spritesheets.mjs [--only <slug>] [--keep-png]
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_ROOT = path.join(ROOT, "public", "pets");

/* ── 官方图集几何（⛔ 改这里就等于改格式，必须同步 pet.json 的 frameSize 与守卫）── */
export const FRAME_W = 192;
export const FRAME_H = 208;
export const COLS = 8;
export const ROWS = 9;
/** 九态行名 —— 官方顺序。索引 = 行号。 */
export const STATE_ROWS = [
  "idle",
  "running-right",
  "running-left",
  "waving",
  "jumping",
  "failed",
  "waiting",
  "running",
  "review",
];

/* ══════════════════════ 第一步：最小 PNG 编码器（零依赖） ══════════════════════ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** RGBA 缓冲 → PNG（filter=0 全量扫描线；宠物图大面积透明，deflate 后体积可控）。 */
function encodePng(rgba, width, height) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ══════════════════════ 第二步：SDF 光栅化（抗锯齿绘制） ══════════════════════ */

/** 一帧的绘制上下文：只认「该帧的局部坐标」（0,0 = 该帧左上角）。 */
class Canvas2 {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = Buffer.alloc(w * h * 4);   // 全透明起步
  }

  /**
   * 按距离场填充：`sdf(x,y)` 返回「到形状边界的带符号距离」（负 = 内部）。
   * 覆盖率用 1px 平滑带做抗锯齿 —— 比超采样快，也不会出现锯齿栏杆。
   * `color` 可以是 `[r,g,b]` 或 `(x,y) => [r,g,b]`（后者用来画渐变/明暗）。
   */
  fill(sdf, color, alpha = 1) {
    const dynamic = typeof color === "function";
    const flat = dynamic ? null : color;
    const { w, h, px } = this;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const d = sdf(x + 0.5, y + 0.5);
        let cov = 0.5 - d;                       // 边界 ±0.5px 平滑带
        if (cov <= 0) continue;
        if (cov > 1) cov = 1;
        const [r, g, b] = flat ?? color(x + 0.5, y + 0.5);
        const a = cov * alpha;
        const i = (y * w + x) * 4;
        const src = a + (px[i + 3] / 255) * (1 - a);   // source-over
        if (src <= 0) continue;
        px[i] = Math.round((r * a + px[i] * (px[i + 3] / 255) * (1 - a)) / src);
        px[i + 1] = Math.round((g * a + px[i + 1] * (px[i + 3] / 255) * (1 - a)) / src);
        px[i + 2] = Math.round((b * a + px[i + 2] * (px[i + 3] / 255) * (1 - a)) / src);
        px[i + 3] = Math.round(src * 255);
      }
    }
  }

  /** 圆 / 椭圆（rx=ry 即圆） */
  ellipse(cx, cy, rx, ry, color, alpha = 1, rot = 0) {
    const cos = Math.cos(-rot);
    const sin = Math.sin(-rot);
    this.fill((x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      // 椭圆隐式方程近似成距离（各向异性时只是近似，但视觉上足够）
      return Math.hypot(lx / rx, ly / ry) * Math.min(rx, ry) - Math.min(rx, ry);
    }, color, alpha);
  }

  /** 胶囊（线段加圆头）—— 四肢用它，关节处不会有硬角 */
  capsule(x1, y1, x2, y2, r, color, alpha = 1) {
    this.fill((x, y) => {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len2 = dx * dx + dy * dy || 1;
      let t = ((x - x1) * dx + (y - y1) * dy) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) - r;
    }, color, alpha);
  }

  /** 圆角矩形 */
  roundRect(cx, cy, w, h, r, color, alpha = 1) {
    const hw = w / 2;
    const hh = h / 2;
    const rr = Math.min(r, hw, hh);
    this.fill((x, y) => {
      const qx = Math.abs(x - cx) - (hw - rr);
      const qy = Math.abs(y - cy) - (hh - rr);
      const ax = Math.max(qx, 0);
      const ay = Math.max(qy, 0);
      return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - rr;
    }, color, alpha);
  }

  /** 三角形（耳朵 / 箭头），顶点顺时针 */
  triangle(p1, p2, p3, color, alpha = 1) {
    const sign = (ax, ay, bx, by, cx, cy) => (ax - cx) * (by - cy) - (bx - cx) * (ay - cy);
    this.fill((x, y) => {
      const d1 = sign(x, y, p1[0], p1[1], p2[0], p2[1]);
      const d2 = sign(x, y, p2[0], p2[1], p3[0], p3[1]);
      const d3 = sign(x, y, p3[0], p3[1], p1[0], p1[1]);
      const inside = !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
      if (inside) return -1;
      // 到三条边的最小距离（外部）
      const seg = (ax, ay, bx, by) => {
        const dx = bx - ax;
        const dy = by - ay;
        const l2 = dx * dx + dy * dy || 1;
        let t = ((x - ax) * dx + (y - ay) * dy) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
      };
      return Math.min(seg(p1[0], p1[1], p2[0], p2[1]), seg(p2[0], p2[1], p3[0], p3[1]), seg(p3[0], p3[1], p1[0], p1[1]));
    }, color, alpha);
  }

  blitFrom(src, dx, dy) {
    for (let y = 0; y < src.h; y += 1) {
      for (let x = 0; x < src.w; x += 1) {
        const i = (y * src.w + x) * 4;
        if (!src.px[i + 3]) continue;
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) continue;
        const j = (ty * this.w + tx) * 4;
        this.px[j] = src.px[i];
        this.px[j + 1] = src.px[i + 1];
        this.px[j + 2] = src.px[i + 2];
        this.px[j + 3] = src.px[i + 3];
      }
    }
  }
}

/** 竖向渐变着色器：`y0 → y1` 之间从 `c0` 过渡到 `c1`（超出范围夹住）。 */
function vgrad(y0, y1, c0, c1) {
  const span = Math.max(1, y1 - y0);
  return (_x, y) => {
    let t = (y - y0) / span;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return [
      c0[0] + (c1[0] - c0[0]) * t,
      c0[1] + (c1[1] - c0[1]) * t,
      c0[2] + (c1[2] - c0[2]) * t,
    ];
  };
}

/** 颜色混合（用于从主色派生亮部 / 暗部，避免手写两套色板）。 */
function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
const shade = (c, t) => mix(c, [0, 0, 0], t);      // 变暗
const tint = (c, t) => mix(c, [255, 255, 255], t); // 变亮

/**
 * 像素级描边：对整帧的 alpha 做**距离变换**（两遍 chamfer），再把距离 ≤ r 的外圈涂成描边色。
 *
 * ⛔ 为什么用像素级而不是"每个形状画两遍"：
 *    · 逐个形状重画一遍要改全部 ~25 个绘制调用点（且相交处会出现内描边）；
 *    · 这里一次算完整帧，得到的是**整个剪影的外轮廓**（贴纸感），且 O(n) 两遍扫描，
 *      192×208 一帧不到 1ms。
 * 观感收益很大：扁平色块有没有一圈描边，是"随手画的色块"和"一张插画"的分界。
 */
function outlineOf(src, color, radius) {
  const { w, h } = src;
  const INF = 1e6;
  const dist = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) dist[i] = src.px[i * 4 + 3] > 8 ? 0 : INF;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? INF : dist[y * w + x]);
  const D = 1, G = 1.4142;
  for (let y = 0; y < h; y += 1) {                    // 前向
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (dist[i] === 0) continue;
      dist[i] = Math.min(dist[i], at(x - 1, y) + D, at(x, y - 1) + D, at(x - 1, y - 1) + G, at(x + 1, y - 1) + G);
    }
  }
  for (let y = h - 1; y >= 0; y -= 1) {               // 后向
    for (let x = w - 1; x >= 0; x -= 1) {
      const i = y * w + x;
      if (dist[i] === 0) continue;
      dist[i] = Math.min(dist[i], at(x + 1, y) + D, at(x, y + 1) + D, at(x + 1, y + 1) + G, at(x - 1, y + 1) + G);
    }
  }
  const out = new Canvas2(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const cov = radius + 0.5 - dist[i];             // 描边带宽带抗锯齿
      if (cov <= 0) continue;
      const a = cov > 1 ? 1 : cov;
      const j = i * 4;
      out.px[j] = color[0];
      out.px[j + 1] = color[1];
      out.px[j + 2] = color[2];
      out.px[j + 3] = Math.round(a * 255);
    }
  }
  return out;
}

/* ══════════════════════ 第三步：宠物外观（三只，全部自产） ══════════════════════ */
/* 色板取本项目 DESIGN.md 的主色与中性色（宠物飘在桌面，用产品自己的蓝更协调）。
   ⛔ 不要在这里引入第二主色以外的花哨渐变。 */
const PALETTE = {
  ink: [35, 35, 31],
  accent: [47, 107, 221],
  accentDark: [30, 74, 158],
  accentLight: [124, 171, 248],
  paper: [248, 248, 247],
  line: [231, 231, 228],
  muted: [111, 111, 105],
  ok: [63, 179, 107],
  red: [217, 79, 67],
  orange: [232, 131, 12],
};

/** 相对亮度（0~1）：用来判断体色深浅，从而选对比色的眼睛/嘴线。 */
function luminance([r, g, b]) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** 三只内置宠物的外观参数：物种差异靠**耳朵 / 头顶件 / 配色**，身体骨架完全共用。 */
const PETS = [
  {
    slug: "harness-blob",
    name: "小墨",
    description: "工程助手墨滴：安静、专注，任务完成会蹦一下。",
    body: PALETTE.accent,
    bodyDark: PALETTE.accentDark,
    accent: PALETTE.accentLight,
    belly: PALETTE.paper,
    ears: "droop",     // 垂耳
    tail: "none",
    vibe: ["专注", "可靠"],
  },
  {
    slug: "harness-cat",
    name: "阿弦",
    description: "原型猫：耳朵尖、尾巴会摆，等指令时会左右张望。",
    body: PALETTE.ink,
    bodyDark: [20, 20, 18],
    accent: PALETTE.orange,
    belly: PALETTE.paper,
    ears: "pointy",    // 尖耳
    tail: "sway",
    vibe: ["好奇", "灵活"],
  },
  {
    slug: "harness-bot",
    name: "小枢",
    description: "原型机器人：头顶天线，工作时双眼与天线的灯会加速闪动。",
    // ⛔ 不用纯白：白色宠物在浅色桌面上会"消失"（腿和轮廓都看不见）⇒ 用中性岩灰，深浅桌面都能读。
    body: [86, 91, 101],
    bodyDark: [60, 64, 73],
    accent: PALETTE.ok,
    belly: [168, 175, 187],
    ears: "antenna",   // 天线
    tail: "none",
    vibe: ["严谨", "冷静"],
  },
];

/* ══════════════════════ 第四步：单帧绘制 ══════════════════════ */

/**
 * 画一帧。所有尺寸都以「脚底在 y=FOOT_Y、身体中心在 x=W/2」为基准 —— 72 帧共用同一套比例，
 * 保证换行动画时不会"人物突然变大变小"。
 *
 * @param spec  宠物外观（PETS 里的一项）
 * @param p     该帧的姿态参数（各行动画算出来的）
 */
function drawFrame(spec, p) {
  const W = FRAME_W;
  const H = FRAME_H;
  const c = new Canvas2(W, H);
  const cx = W / 2 + (p.dx || 0);
  const footY = 196;

  const squash = p.squash ?? 1;            // >1 压扁、<1 拉长
  const bodyW = 78 * (p.wide ?? 1);
  const bodyH = 62 * squash;
  const bodyCY = footY - 34 - bodyH / 2 + (p.dy || 0);
  const headR = 34;
  const headCY = bodyCY - bodyH / 2 - headR * 0.72 + (p.headDy || 0);
  const headCX = cx + (p.headDx || 0);

  /* ① 地面柔阴影（落脚感；跳起来时缩小变淡） */
  c.ellipse(cx, footY + 4, 40 * (p.shadow ?? 1), 9 * (p.shadow ?? 1), [0, 0, 0], 0.16 * (p.shadowAlpha ?? 1));

  /* ② 腿（先画，被躯干压住上端） */
  const legColor = p.useBodyDark ? spec.bodyDark : spec.body;
  for (const side of [-1, 1]) {
    const phase = p.legPhase ?? 0;
    const swing = Math.sin(phase + (side > 0 ? Math.PI : 0)) * (p.legSwing ?? 0);
    const hipX = cx + side * 20;
    const hipY = bodyCY + bodyH / 2 - 2;
    const footX = hipX + swing;
    c.capsule(hipX, hipY, footX, footY - 6, 11, legColor);
    c.ellipse(footX, footY - 5, 13, 7, spec.bodyDark);
  }

  /* ③ 尾巴（在躯干后面；⛔ 起点要落在躯干**轮廓之外**，否则整条尾巴被躯干吃掉） */
  if (spec.tail === "sway") {
    const t = p.tailPhase ?? 0;
    const baseX = cx - (bodyW / 2 + 3);
    const baseY = bodyCY + bodyH / 2 - 12;
    const midX = baseX - 12 + Math.sin(t) * 5;
    const midY = baseY - 20 + Math.cos(t) * 6;
    const endX = baseX - 16 + Math.sin(t) * 13;
    const endY = baseY - 40 + Math.cos(t) * 9;
    c.capsule(baseX, baseY, midX, midY, 7, spec.body);
    c.capsule(midX, midY, endX, endY, 5.5, spec.body);
    c.ellipse(endX, endY, 6.5, 6.5, spec.accent);
  }

  /* ④ 躯干 */
  c.roundRect(cx, bodyCY, bodyW, bodyH, 26, spec.body);
  /* 肚皮（腹部浅色块，让立体感不靠阴影堆） */
  c.ellipse(cx, bodyCY + 8 * squash, bodyW * 0.28, bodyH * 0.3, spec.belly, 0.85);

  /* ⑤ 手臂 */
  const armY = bodyCY - 4;
  const armColor = spec.body;
  for (const side of [-1, 1]) {
    const armLift = side < 0 ? (p.armL ?? 0) : (p.armR ?? 0);
    const ax = cx + side * (bodyW / 2 - 4);
    const ay = armY + (p.armY ?? 0);
    const handX = ax + side * (10 + Math.cos(armLift) * 6);
    const handY = ay + 14 - Math.sin(armLift) * 26;
    c.capsule(ax, ay, handX, handY, 8.5, armColor);
    /* 手掌用强调色 —— ⛔ 别用 bodyDark：深色躯干（黑猫）上手掌会整块消失，
       看起来像"没有手"（第一版实测）。 */
    c.ellipse(handX, handY, 9, 9, spec.accent);
  }

  /* ⑥ 头 */
  c.ellipse(headCX, headCY, headR, headR * 0.92, spec.body);

  /* ⑦ 耳朵 / 头顶件（物种区分点） */
  const earRot = p.earRot ?? 0;
  if (spec.ears === "pointy") {
    c.triangle([headCX - headR + 6, headCY - headR * 0.55], [headCX - headR + 2, headCY - headR * 1.62], [headCX - 4, headCY - headR * 0.86], spec.body);
    c.triangle([headCX + headR - 6, headCY - headR * 0.55], [headCX + headR - 2, headCY - headR * 1.62], [headCX + 4, headCY - headR * 0.86], spec.body);
    // 耳内
    c.triangle([headCX - headR + 10, headCY - headR * 0.7], [headCX - headR + 7, headCY - headR * 1.34], [headCX - 8, headCY - headR * 0.9], spec.accent, 0.75);
    c.triangle([headCX + headR - 10, headCY - headR * 0.7], [headCX + headR - 7, headCY - headR * 1.34], [headCX + 8, headCY - headR * 0.9], spec.accent, 0.75);
  } else if (spec.ears === "droop") {
    for (const side of [-1, 1]) {
      const ex = headCX + side * (headR - 6);
      const ey = headCY - headR * 0.42;
      c.ellipse(ex + side * 8, ey + 10 + earRot * 6 * side, 13, 20, spec.body, 1, side * 0.5);
    }
  } else {
    // antenna：天线 + 顶球（工作时球亮起 —— 用 alpha 表示）
    c.capsule(headCX, headCY - headR * 0.86, headCX + (p.antDx ?? 0), headCY - headR * 1.5, 2.6, spec.bodyDark);
    c.ellipse(headCX + (p.antDx ?? 0), headCY - headR * 1.5 - 6, 7, 7, spec.accent, p.antGlow ?? 1);
  }

  /* ⑧ 脸：眼 / 嘴 */
  const eyeY = headCY + 4;
  const eyeDx = 13;
  const eyeOpen = p.eyeOpen ?? 1;
  /* ⛔ 深色躯干（黑猫）上**只画深瞳会整只眼睛消失**（第一版实测：脸上只剩两个高光点）。
     所以一律「浅色眼白 + 深色瞳孔 + 高光」三层 —— 任何体色都能读出来。 */
  const dark = luminance(spec.body) < 0.35;
  const eyeStroke = dark ? spec.belly : PALETTE.ink;
  if (p.dead) {
    // failed：双眼打叉
    for (const side of [-1, 1]) {
      const ex = headCX + side * eyeDx;
      c.capsule(ex - 6, eyeY - 6, ex + 6, eyeY + 6, 2.4, eyeStroke);
      c.capsule(ex + 6, eyeY - 6, ex - 6, eyeY + 6, 2.4, eyeStroke);
    }
  } else if (eyeOpen < 0.18) {
    // 眨眼：一条细线（用与体色对比的描边色）
    for (const side of [-1, 1]) c.capsule(headCX + side * eyeDx - 6, eyeY, headCX + side * eyeDx + 6, eyeY, 2.2, eyeStroke);
  } else {
    for (const side of [-1, 1]) {
      const ex = headCX + side * eyeDx;
      const eh = 8.6 * eyeOpen;
      c.ellipse(ex, eyeY, 7.4, eh, spec.belly, 0.97);                 // 眼白
      c.ellipse(ex + 1.3, eyeY, 4.6, 4.6 * eyeOpen, PALETTE.ink);     // 瞳孔
      c.ellipse(ex + 3, eyeY - 2.4, 1.7, 1.7 * eyeOpen, PALETTE.paper, 0.95);  // 高光
    }
  }
  // 嘴（打盹/失败时不画）
  if (!p.dead && !p.noMouth) {
    const my = headCY + headR * 0.42;
    if (p.smile) {
      c.capsule(headCX - 7, my - 2, headCX, my + 3, 1.8, eyeStroke, 0.85);
      c.capsule(headCX, my + 3, headCX + 7, my - 2, 1.8, eyeStroke, 0.85);
    } else {
      c.capsule(headCX - 5, my, headCX + 5, my, 1.8, eyeStroke, 0.7);
    }
  }

  /* ⑨ 状态附加物 */
  if (p.zzz) {
    // waiting / 打盹：头顶飘字（画成胶囊笔画拼的 "z"，避免依赖字体）
    for (let i = 0; i < p.zzz; i += 1) {
      const s = 5 + i * 2.2;
      const zx = headCX + headR + 6 + i * 9 + (p.zzzDx ?? 0);
      const zy = headCY - headR - 6 + (p.zzzDy ?? 0) - i * 12;
      c.capsule(zx - s, zy - s, zx + s, zy - s, 1.7, spec.accent, 0.85 - i * 0.18);
      c.capsule(zx + s, zy - s, zx - s, zy + s, 1.7, spec.accent, 0.85 - i * 0.18);
      c.capsule(zx - s, zy + s, zx + s, zy + s, 1.7, spec.accent, 0.85 - i * 0.18);
    }
  }
  if (p.sparkle) {
    // jumping：四向小星（庆祝）
    for (const [sx, sy, k] of [[-1, -1, 7], [1, -1, 9], [-1, 1, 5], [1, 1, 6]]) {
      const px = cx + sx * (bodyW / 2 + 16);
      const py = bodyCY + sy * (bodyH / 2 + 12);
      c.capsule(px - k, py, px + k, py, 1.6, spec.accent, 0.9);
      c.capsule(px, py - k, px, py + k, 1.6, spec.accent, 0.9);
    }
  }
  if (p.sweat) {
    // failed：头侧一滴汗
    c.ellipse(headCX + headR + 4, headCY + 2, 5, 7, PALETTE.accentLight, 0.9);
  }
  if (p.magnifier) {
    // review：手里放大镜（一圈 + 柄）
    const gx = cx + bodyW / 2 + 12;
    const gy = bodyCY - 6;
    c.fill((x, y) => Math.abs(Math.hypot(x - gx, y - gy) - 12) - 3, PALETTE.ink, 0.85);
    c.capsule(gx + 8, gy + 8, gx + 18, gy + 18, 3.2, PALETTE.ink, 0.85);
    c.ellipse(gx, gy, 10, 10, PALETTE.paper, 0.35);
  }
  if (p.workLines) {
    // running：躯干**两侧外侧**的短竖线（干活的速度感）
    // ⛔ 别画在躯干上 —— 横穿身体会像"系了条腰带"，完全读不出"在工作"（第一版实测）。
    for (const side of [-1, 1]) {
      for (let i = 0; i < 2; i += 1) {
        const px = cx + side * (bodyW / 2 + 13 + i * 7);
        const py = bodyCY - 4 + i * 12;
        c.capsule(px, py - 6, px, py + 6, 1.7, spec.accent, 0.45 - i * 0.12);
      }
    }
  }

  return c;
}

/* ══════════════════════ 第五步：九行动画（每行 8 帧） ══════════════════════ */

/** 行动画表：`pose(i)` 给出第 i 帧（0..7）的姿态参数。 */
const ROW_ANIMATION = {
  /* 待机：呼吸起伏 + 第 5 帧眨眼（眨眼只在 idle 出现，别让所有行都眨） */
  idle: (i) => {
    const t = i / COLS;
    const breath = Math.sin(t * Math.PI * 2);
    return {
      squash: 1 + breath * 0.035,
      dy: breath * 2.2,
      armL: 0.1 + breath * 0.05,
      armR: 0.1 - breath * 0.05,
      earRot: breath * 0.35,
      eyeOpen: i === 5 ? 0 : 1,
      tailPhase: t * Math.PI * 2,
      shadow: 1 - breath * 0.03,
    };
  },
  /* 向右小跑：躯干前倾 + 双腿交替 + 上下颠（先画右向，左向靠镜像） */
  "running-right": (i) => {
    const t = i / COLS;
    const bounce = Math.abs(Math.sin(t * Math.PI * 2));
    return {
      dx: 4,
      dy: -bounce * 5,
      squash: 1 + (1 - bounce) * 0.06,
      legPhase: t * Math.PI * 2,
      legSwing: 13,
      armL: -0.5 + bounce * 0.5,
      armR: -0.9 + bounce * 0.4,
      earRot: -0.5 * bounce,
      eyeOpen: 1,
      tailPhase: t * Math.PI * 4,
      shadow: 1 - bounce * 0.18,
      shadowAlpha: 1 - bounce * 0.3,
    };
  },
  /* 挥手：左手举起左右摆（这是"需要你确认"的招牌动作，摆动幅度要明显） */
  waving: (i) => {
    const t = i / COLS;
    const wave = Math.sin(t * Math.PI * 2);
    return {
      armL: 1.5 + wave * 0.5,
      armR: -0.15,
      squash: 1 + wave * 0.02,
      dy: wave * 1.5,
      earRot: wave * 0.4,
      eyeOpen: 1,
      smile: true,
      tailPhase: t * Math.PI * 3,
    };
  },
  /* 跳跃：抛物线 + 落地压扁 + 星星（任务完成的庆祝动作） */
  jumping: (i) => {
    const t = i / COLS;
    const arc = Math.sin(t * Math.PI);          // 0→1→0
    const land = Math.max(0, Math.sin(t * Math.PI * 2 - 1.4)) * 0.5;
    return {
      dy: -arc * 46,
      squash: 1 - arc * 0.1 + land * 0.12,
      armL: 0.6 + arc * 0.9,
      armR: 0.6 + arc * 0.9,
      earRot: -arc * 0.9,
      eyeOpen: 1,
      smile: true,
      sparkle: arc > 0.25,
      shadow: 1 - arc * 0.45,
      shadowAlpha: 1 - arc * 0.5,
    };
  },
  /* 失败：瘫坐 + 打叉眼 + 汗滴（⛔ 不要画成"死"，是"搞砸了"的沮丧） */
  failed: (i) => {
    const t = i / COLS;
    const droop = Math.sin(t * Math.PI * 2) * 0.3;
    return {
      dy: 4,
      squash: 1.12,
      headDy: 6 + droop * 2,
      headDx: droop * 3,
      armL: -0.9, armR: -0.9,
      earRot: 1.1 + droop,
      eyeOpen: 1,
      dead: true,
      noMouth: true,
      sweat: true,
      tailPhase: 0,
      shadow: 1.05,
    };
  },
  /* 等待：仰头张望 + 头顶 z（等模型/权限时用；比静止生动，又明确是"在等") */
  waiting: (i) => {
    const t = i / COLS;
    const sway = Math.sin(t * Math.PI * 2);
    return {
      headDy: -3 + sway * 1.5,
      headDx: sway * 5,
      squash: 1 + sway * 0.02,
      armL: 0.25, armR: 0.25,
      earRot: sway * 0.6,
      eyeOpen: i === 3 ? 0.2 : 1,
      zzz: 1 + (i % 2),
      zzzDx: sway * 6,
      zzzDy: -i * 1.5,
      tailPhase: t * Math.PI * 2,
    };
  },
  /* 工作中：身体前倾 + 双臂高频敲击 + 天线上小球脉冲 */
  running: (i) => {
    const t = i / COLS;
    const tap = Math.sin(t * Math.PI * 4);
    return {
      dy: 1,
      squash: 1.04,
      armL: -0.75 + tap * 0.28,
      armR: -0.75 - tap * 0.28,
      armY: 2,
      earRot: tap * 0.12,
      eyeOpen: 1 - (i % 4 === 3 ? 0.06 : 0),
      workLines: true,
      antGlow: 0.55 + Math.abs(tap) * 0.45,
      antDx: tap * 2.5,
      tailPhase: t * Math.PI * 2,
      shadow: 1.02,
    };
  },
  /* 审查：歪头看 + 放大镜（读完/检查改动时用） */
  review: (i) => {
    const t = i / COLS;
    const tilt = Math.sin(t * Math.PI * 2);
    return {
      headDx: 2 + tilt * 3,
      headDy: 1,
      squash: 1.01,
      armL: 0.5, armR: -0.55,
      earRot: tilt * 0.5,
      eyeOpen: 1,
      magnifier: true,
      tailPhase: t * Math.PI * 2,
    };
  },
};

/** 左向小跑 = 右向的**水平镜像**（⛔ 不是重画一套 —— 重画必然两边不对称）。 */
function mirrorFrame(src) {
  const out = new Canvas2(src.w, src.h);
  for (let y = 0; y < src.h; y += 1) {
    for (let x = 0; x < src.w; x += 1) {
      const from = (y * src.w + (src.w - 1 - x)) * 4;
      const to = (y * src.w + x) * 4;
      out.px[to] = src.px[from];
      out.px[to + 1] = src.px[from + 1];
      out.px[to + 2] = src.px[from + 2];
      out.px[to + 3] = src.px[from + 3];
    }
  }
  return out;
}

/** 生成一只宠物的整张图集（8 列 × 9 行）。 */
function buildSheet(spec) {
  const sheet = new Canvas2(COLS * FRAME_W, ROWS * FRAME_H);
  STATE_ROWS.forEach((state, row) => {
    for (let col = 0; col < COLS; col += 1) {
      let frame;
      if (state === "running-left") {
        // 左向 = 右向同一姿势的**水平镜像**（⛔ 不重画一套 —— 重画两边必然不对称）
        const base = ROW_ANIMATION["running-right"](col);
        frame = mirrorFrame(drawFrame(spec, { ...base, dx: -base.dx }));
      } else {
        const pose = ROW_ANIMATION[state];
        if (!pose) throw new Error(`缺少 "${state}" 行的动画定义 —— 官方九态缺一不可`);
        frame = drawFrame(spec, pose(col));
      }
      sheet.blitFrom(frame, col * FRAME_W, row * FRAME_H);
    }
  });
  return sheet;
}

/* ══════════════════════ 第六步：写盘 ══════════════════════ */

/**
 * ⛔ 出 **PNG** 而不是 WebP —— 实测（2026-09-30，三只内置宠物）：
 *   1536×1872 整图，PNG 154KB vs WebP(q82) 179KB。这套画风是「扁平色块 + 抗锯齿边」，
 *   有损 WebP 在锐边上要花更多码流，反而更大；PNG 还无损。
 *   官方格式两种都收（`spritesheet.{webp,png}`），所以选小的那个。
 * ⛔ 也正因为不出 WebP，本脚本**不 spawn 子进程**（沙箱会拦 spawnSync）⇒ 沙箱内可直接复现。
 */
function main() {
  const args = process.argv.slice(2);
  const onlyIdx = args.indexOf("--only");
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;

  fs.mkdirSync(OUT_ROOT, { recursive: true });
  const list = PETS.filter((p) => !only || p.slug === only);
  if (!list.length) throw new Error(`没有匹配的宠物：${only}`);

  let total = 0;
  for (const spec of list) {
    const dir = path.join(OUT_ROOT, spec.slug);
    fs.mkdirSync(dir, { recursive: true });
    const sheet = buildSheet(spec);
    const pngPath = path.join(dir, "spritesheet.png");
    fs.writeFileSync(pngPath, encodePng(sheet.px, sheet.w, sheet.h));

    const meta = {
      id: spec.slug,
      displayName: spec.name,
      description: spec.description,
      // 官方格式面（pet.json 的消费方靠这三个字段定位图集）
      spritesheetPath: "spritesheet.png",
      frameSize: { width: FRAME_W, height: FRAME_H },
      columns: COLS,
      rows: ROWS,
      states: STATE_ROWS,
      spriteVersionNumber: 1,
      vibes: spec.vibe,
      builtin: true,
    };
    fs.writeFileSync(path.join(dir, "pet.json"), `${JSON.stringify(meta, null, 2)}\n`);

    const size = fs.statSync(pngPath).size;
    total += size;
    console.log(`[pets] ${spec.slug.padEnd(14)} png ${(size / 1024).toFixed(0)}KB  ${ROWS} 态 × ${COLS} 帧`);
  }
  console.log(`[pets] 完成 → ${path.relative(ROOT, OUT_ROOT)}（合计 ${(total / 1024).toFixed(0)}KB）`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
