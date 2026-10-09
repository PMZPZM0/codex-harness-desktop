/**
 * 调整图层内核（image-doc）：12 种，对齐 Compositor 的 adjustment.kind。
 *
 * 规格口径（`docs/writing-comp-files.md`）：
 *   · 调整图层**没有 imageFile**，作用于**它下方的所有内容**；
 *   · 每种都带 identity 的 `levels` 与 `curves` 块，外加各自的参数；
 *   · Hue/Saturation 的参数在 adjustment 本体（hue / saturation / lightness / colorize）；
 *     Color Balance 用 `colorBalanceSettings`（shadow/mid/highlight × 三组，−100..100，加 preserveLuminosity）；
 *     其余种类的精确形状，规格明说「在 Compositor 里加一个、保存、从 manifest 抄」。
 *
 * ⛔ 因此**字段是抄来的、语义是我们实现的近似**：曲线/色阶/曝光/黑白/颜色平衡按 Photoshop 的经典
 *   公式实现；Gaussian / Motion Blur 与噪点类是确定性的。所有未识别字段**原样透传**（model.ts 保证），
 *   所以往返 Compositor 不会丢东西。
 * ⛔ 噪点类（Grain / Add Noise）用**种子化 PRNG**：同一份文档每次渲染必须得到同一张图，
 *   否则"改了没改"根本没法判。种子由调用方从图层 id 派生。
 * ⛔ 不动 alpha：Photoshop 的调整图层不改透明度通道。
 */
import type { Adjustment, CurvePoint, LevelRange } from "./model";

/* ── 种子化随机（mulberry32）：确定性噪点 ─────────────────────────────────────────── */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** 由图层 id 派生种子（同一图层每次渲染同一批噪点）。 */
export function seedFromId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ── LUT ─────────────────────────────────────────────────────────────────────────── */
/** 色阶 → 256 项 LUT。公式：outBlack + ((in−black)/(white−black))^(1/gamma) × (outWhite−outBlack)。 */
export function levelsLut(range: LevelRange): Uint8ClampedArray {
  const black = numOr(range?.black, 0);
  const white = numOr(range?.white, 255);
  const gamma = Math.max(0.01, numOr(range?.gamma, 1));
  const outBlack = numOr(range?.outputBlack, 0);
  const outWhite = numOr(range?.outputWhite, 255);
  const span = white - black || 1;
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i += 1) {
    const t = Math.max(0, Math.min(1, (i - black) / span));
    lut[i] = clamp255(outBlack + Math.pow(t, 1 / gamma) * (outWhite - outBlack));
  }
  return lut;
}

/**
 * 曲线 → 256 项 LUT（Catmull-Rom，端点钳制）。
 * ⛔ 点必须按 x 递增（规格要求）；乱序会让插值结果乱跳，这里先排序兜底。
 */
export function curvesLut(points: CurvePoint[]): Uint8ClampedArray {
  const pts = [...(points ?? [])]
    .map((p) => ({ x: Math.max(0, Math.min(255, numOr(p?.x, 0))), y: Math.max(0, Math.min(255, numOr(p?.y, 0))) }))
    .filter((p, i, arr) => arr.findIndex((q) => q.x === p.x) === i)
    .sort((a, b) => a.x - b.x);
  if (!pts.length) return identityLut();
  if (pts.length === 1) {
    const lut = new Uint8ClampedArray(256);
    lut.fill(pts[0].y);
    return lut;
  }
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i += 1) {
    lut[i] = clamp255(catmullRom(pts, i));
  }
  return lut;
}

/** Catmull-Rom 在 x 处的 y（超出两端取端点值）。 */
function catmullRom(pts: Array<{ x: number; y: number }>, x: number): number {
  const n = pts.length;
  if (x <= pts[0].x) return pts[0].y;
  if (x >= pts[n - 1].x) return pts[n - 1].y;
  let k = 0;
  while (k < n - 2 && pts[k + 1].x < x) k += 1;
  const p0 = pts[Math.max(0, k - 1)];
  const p1 = pts[k];
  const p2 = pts[k + 1];
  const p3 = pts[Math.min(n - 1, k + 2)];
  const span = p2.x - p1.x || 1;
  const t = (x - p1.x) / span;
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    2 * p1.y +
    (-p0.y + p2.y) * t +
    (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
    (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
  );
}

function identityLut(): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i += 1) lut[i] = i;
  return lut;
}

/* ── 颜色空间小工具 ───────────────────────────────────────────────────────────────── */
/** RGB(0..1) → HSV，h 为 0..360。 */
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return [h, max === 0 ? 0 : d / max, max];
}
/** HSV → RGB(0..1)。 */
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const seg = Math.floor(((h % 360) + 360) % 360 / 60) % 6;
  const rgb: Array<[number, number, number]> = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ];
  const [r, g, b] = rgb[seg];
  return [r + m, g + m, b + m];
}

/* ── 逐像素调整 ───────────────────────────────────────────────────────────────────── */
type Bitmap = { width: number; height: number; data: Uint8ClampedArray | Uint8Array };

/** 只对 RGB 生效的逐像素映射（alpha 原样保留）。 */
function mapRGB(bitmap: Bitmap, fn: (r: number, g: number, b: number, i: number) => [number, number, number]): void {
  const d = bitmap.data;
  for (let i = 0; i < d.length; i += 4) {
    const [r, g, b] = fn(d[i], d[i + 1], d[i + 2], i);
    d[i] = clamp255(r);
    d[i + 1] = clamp255(g);
    d[i + 2] = clamp255(b);
  }
}

/** Identity 的 levels / curves 块不产生任何变化 —— 用于跳过没实际设置的部分。 */
function isIdentityRanges(ranges: LevelRange[] | undefined): boolean {
  if (!Array.isArray(ranges) || !ranges.length) return true;
  return ranges.every((r) =>
    numOr(r?.black, 0) === 0 && numOr(r?.gamma, 1) === 1 && numOr(r?.white, 255) === 255 &&
    numOr(r?.outputBlack, 0) === 0 && numOr(r?.outputWhite, 255) === 255);
}
function isIdentityCurves(channels: CurvePoint[][] | undefined): boolean {
  if (!Array.isArray(channels) || !channels.length) return true;
  return channels.every((ch) => !ch || ch.length <= 2 && ch.every((p) => numOr(p?.x, 0) === numOr(p?.y, 0)));
}

/* ── 各种调整 ─────────────────────────────────────────────────────────────────────── */
function applyLevels(bitmap: Bitmap, a: Adjustment): void {
  const ranges = a.levels?.ranges;
  if (isIdentityRanges(ranges)) return;
  // 顺序：RGB, R, G, B（规格明示）。缺的通道退回 identity。
  const luts = [0, 1, 2, 3].map((ch) => (ranges?.[ch] ? levelsLut(ranges[ch]) : identityLut()));
  const [rgb, lr, lg, lb] = luts;
  /* ⛔⛔ 别照抄官方的「反预乘」：Rendering/LevelsPixels.c 里那句 `p[c]*255/alpha` 是因为
     它跑在 **CoreGraphics 的预乘缓冲**上（SeparableBlend.swift 显式用
     `CGImageAlphaInfo.premultipliedLast`）。而 jimp 的 bitmap 与我们的累积缓冲都是
     **直通 alpha** —— 这里的数据本来就已是"真实颜色"，再反预乘一次反而算错。
     两条路径数学等价：预乘侧 = LUT(C)·a，直通侧 = LUT(C)，C 是同一个真实颜色。
     （10-10 我先照抄错了、随后验证推翻 —— 留注以警示：**抄公式前先看清数据的色彩空间**。） */
  mapRGB(bitmap, (r, g, b) => [rgb[lr[r]], rgb[lg[g]], rgb[lb[b]]]);
}

function applyCurves(bitmap: Bitmap, a: Adjustment): void {
  const channels = a.curves?.channels;
  if (isIdentityCurves(channels)) return;
  const luts = [0, 1, 2, 3].map((ch) => (channels?.[ch]?.length ? curvesLut(channels[ch]) : identityLut()));
  mapRGB(bitmap, (r, g, b) => [luts[1][r], luts[2][g], luts[3][b]]);
}

function applyInvert(bitmap: Bitmap): void {
  mapRGB(bitmap, (r, g, b) => [255 - r, 255 - g, 255 - b]);
}

/** Hue/Saturation：HSV 语义（hue 旋转度、saturation 与 lightness 为 −1..1 的增减）。 */
function applyHueSaturation(bitmap: Bitmap, a: Adjustment): void {
  const hueShift = numOr(a.hue, 0);
  const satDelta = numOr(a.saturation, 0);
  const lightDelta = numOr(a.lightness, 0);
  const colorize = a.colorize === true;
  if (hueShift === 0 && satDelta === 0 && lightDelta === 0 && !colorize) return;
  mapRGB(bitmap, (r, g, b) => {
    let [h, s, v] = rgbToHsv(r / 255, g / 255, b / 255);
    if (colorize) {
      // 着色：强制色相与饱和度，只保留原明度
      h = ((hueShift % 360) + 360) % 360;
      s = Math.max(0, Math.min(1, Math.abs(satDelta) || 0.5));
    } else {
      h = ((h + hueShift) % 360 + 360) % 360;
      s = Math.max(0, Math.min(1, s * (1 + satDelta)));
    }
    v = Math.max(0, Math.min(1, v + lightDelta));
    const [nr, ng, nb] = hsvToRgb(h, s, v);
    return [nr * 255, ng * 255, nb * 255];
  });
}

/** Black & White：通道权重混合（缺省用亮度权重 0.299/0.587/0.114）。 */
function applyBlackAndWhite(bitmap: Bitmap, a: Adjustment): void {
  // 官方是嵌套的 blackWhiteSettings（project-format.md v7）；平铺写法仅作回落
  const bws = (a.blackWhiteSettings ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]): number | null => {
    for (const key of keys) {
      if (bws[key] !== undefined) return numOr(bws[key], 0);
      if (a[key] !== undefined) return numOr((a as Record<string, unknown>)[key], 0);
    }
    return null;
  };
  const rw = pick("reds", "red", "redWeight");
  const gw = pick("greens", "green", "greenWeight");
  const bw = pick("blues", "blue", "blueWeight");
  const wr = rw ?? 0.299;
  const wg = gw ?? 0.587;
  const wb = bw ?? 0.114;
  // 给的是 Photoshop 那种 −100..100 的分区权重时，折成 0..1 再加到亮度权重上
  const scale = (wr + wg + wb) > 2 ? 1 / 300 : 1;
  const sr = wr * scale;
  const sg = wg * scale;
  const sb = wb * scale;
  const sum = sr + sg + sb || 1;
  mapRGB(bitmap, (r, g, b) => {
    const y = (r * sr + g * sg + b * sb) / sum;
    return [y, y, y];
  });
}

/** Exposure：Photoshop 口径 —— pow(v, gamma) × 2^exposure + offset。 */
function applyExposure(bitmap: Bitmap, a: Adjustment): void {
  /* 官方字段名是嵌套的 `exposureSettings`（project-format.md v7）。
     ⛔ 优先读官方结构、回落到我们早先的平铺写法 —— 直接改会让已有 .comp 里的参数静默失效。 */
  const s = (a.exposureSettings ?? {}) as Record<string, unknown>;
  const exposure = numOr(s.exposure, numOr(a.exposure, 0));
  const offset = numOr(s.offset, numOr(a.offset, 0));
  const gamma = numOr(s.gamma, numOr(a.gamma, 1));
  if (exposure === 0 && offset === 0 && gamma === 1) return;
  const gain = Math.pow(2, exposure);
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i += 1) {
    lut[i] = clamp255((Math.pow(i / 255, gamma) * gain + offset) * 255);
  }
  mapRGB(bitmap, (r, g, b) => [lut[r], lut[g], lut[b]]);
}

/** Color Balance：按亮度把 shadow / mid / highlight 三档偏移加权叠加。 */
function applyColorBalance(bitmap: Bitmap, a: Adjustment): void {
  const s = (a.colorBalanceSettings ?? {}) as Record<string, unknown>;
  const read = (prefix: string): [number, number, number] => [
    numOr(s[`${prefix}CyanRed`], 0) / 100,
    numOr(s[`${prefix}MagentaGreen`], 0) / 100,
    numOr(s[`${prefix}YellowBlue`], 0) / 100,
  ];
  const sh = read("shadow");
  const mid = read("mid");
  const hi = read("highlight");
  if (![...sh, ...mid, ...hi].some((v) => v !== 0)) return;
  const preserve = s.preserveLuminosity === true;
  mapRGB(bitmap, (r, g, b) => {
    const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    // 权重：暗部/中间调/亮部三个三角窗（Photoshop 用 25% / 50% / 75% 附近的高斯，这里用三角近似）
    const ws = Math.max(0, 1 - l / 0.5);
    const wm = 1 - Math.abs(l - 0.5) / 0.5;
    const wh = Math.max(0, (l - 0.5) / 0.5);
    const total = ws + wm + wh || 1;
    const dr = (sh[0] * ws + mid[0] * wm + hi[0] * wh) / total;
    const dg = (sh[1] * ws + mid[1] * wm + hi[1] * wh) / total;
    const db = (sh[2] * ws + mid[2] * wm + hi[2] * wh) / total;
    let nr = r + dr * 255 * 0.5;
    let ng = g + dg * 255 * 0.5;
    let nb = b + db * 255 * 0.5;
    if (preserve) {
      const before = 0.299 * r + 0.587 * g + 0.114 * b;
      const after = 0.299 * nr + 0.587 * ng + 0.114 * nb;
      const delta = before - after;
      nr += delta;
      ng += delta;
      nb += delta;
    }
    return [nr, ng, nb];
  });
}

/** Gradient Map：按亮度在渐变 stops 间取色（stops = [{position,color}]，color 为 #rrggbb）。 */
function applyGradientMap(bitmap: Bitmap, a: Adjustment): void {
  /* 官方是 `gradientMapSettings{shadows, highlights, reversed}` —— **两色**渐变映射，
     不是我们原先猜的 gradientStops 数组（project-format.md v7）。
     ⛔ `gradientStops` 仍保留为回落：早先产出的 .comp 里可能已经写了它。 */
  const gs = (a.gradientMapSettings ?? {}) as Record<string, unknown>;
  const raw = (a as Record<string, unknown>).gradientStops;
  let parsed: Array<{ p: number; c: [number, number, number] }>;
  if (Array.isArray(raw) && raw.length >= 2) {
    parsed = raw
      .map((s: any) => ({ p: Math.max(0, Math.min(1, numOr(s?.position, 0))), c: parseHex(s?.color) }))
      .sort((x, y) => x.p - y.p);
  } else {
    let lo = parseHex(gs.shadows);
    let hi = parseHex(gs.highlights);
    if (gs.reversed === true) [lo, hi] = [hi, lo];
    parsed = [{ p: 0, c: lo }, { p: 1, c: hi }];
  }
  mapRGB(bitmap, (r, g, b) => {
    const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    if (l <= parsed[0].p) return parsed[0].c;
    const last = parsed[parsed.length - 1];
    if (l >= last.p) return last.c;
    for (let i = 0; i < parsed.length - 1; i += 1) {
      const a0 = parsed[i];
      const a1 = parsed[i + 1];
      if (l >= a0.p && l <= a1.p) {
        const t = (l - a0.p) / (a1.p - a0.p || 1);
        return [a0.c[0] + (a1.c[0] - a0.c[0]) * t, a0.c[1] + (a1.c[1] - a0.c[1]) * t, a0.c[2] + (a1.c[2] - a0.c[2]) * t];
      }
    }
    return last.c;
  });
}

/** Add Noise / Grain：确定性噪点（同 id 同结果）。 */
function applyNoise(bitmap: Bitmap, a: Adjustment, seed: number, monochrome: boolean): void {
  /* 官方 v9 字段名（project-format.md）：noiseAmount(0.1–400)、noiseGaussian、
     noiseMonochromatic、noiseSeed。⛔ noiseSeed 优先 —— 官方明说它保证「pattern is stable
     between sessions」，我们从图层 id 派生只是没有它时的兜底。 */
  const amount = numOr(a.noiseAmount, a.amount !== undefined ? numOr(a.amount, 0) * 100 : monochrome ? 20 : 10);
  if (amount <= 0) return;
  const rand = mulberry32(numOr(a.noiseSeed, seed));
  // noiseAmount 是 Photoshop 口径的百分比：100 = 满强度
  const strength = Math.max(0, Math.min(1, amount / 100)) * 255;
  // noiseGaussian 为真时用高斯分布叠加（Box-Muller），否则均匀
  const gaussian = a.noiseGaussian === true;
  const mono = a.noiseMonochromatic === true ? true : monochrome;
  // Box-Muller：±3σ 落在 ±strength/2 内，与均匀分布的可视强度大致可比
  const next = (): number => {
    if (!gaussian) return (rand() - 0.5) * strength;
    const u = Math.max(1e-9, rand());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()) * (strength / 6);
  };
  const d = bitmap.data;
  for (let i = 0; i < d.length; i += 4) {
    if (mono) {
      const n = next();
      d[i] = clamp255(d[i] + n);
      d[i + 1] = clamp255(d[i + 1] + n);
      d[i + 2] = clamp255(d[i + 2] + n);
    } else {
      d[i] = clamp255(d[i] + next());
      d[i + 1] = clamp255(d[i + 1] + next());
      d[i + 2] = clamp255(d[i + 2] + next());
    }
  }
}

/* ── 卷积类：高斯 / 动态模糊 ──────────────────────────────────────────────────────── */
/** 分离高斯（水平 + 垂直两趟），O(n·r) 而非 O(n·r²)。 */
function gaussianKernel(radius: number): Float32Array {
  const r = Math.max(1, Math.round(radius));
  const sigma = r / 3 || 1;
  const size = r * 2 + 1;
  const kernel = new Float32Array(size);
  let sum = 0;
  for (let i = 0; i < size; i += 1) {
    const x = i - r;
    const v = Math.exp(-(x * x) / (2 * sigma * sigma));
    kernel[i] = v;
    sum += v;
  }
  for (let i = 0; i < size; i += 1) kernel[i] /= sum;
  return kernel;
}

function applyGaussianBlur(bitmap: Bitmap, a: Adjustment): void {
  // 官方字段名 = blurRadius（0.1–250 文档像素，project-format.md v9）；radius 是我们早先的写法，作回落
  const radius = numOr(a.blurRadius, numOr(a.radius, 0));
  if (radius <= 0) return;
  const kernel = gaussianKernel(radius);
  const r = (kernel.length - 1) / 2;
  const { width, height, data } = bitmap;
  const tmp = new Float32Array(width * height * 3);
  // 水平
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      for (let k = -r; k <= r; k += 1) {
        const sx = Math.max(0, Math.min(width - 1, x + k));
        const i = (y * width + sx) * 4;
        const w = kernel[k + r];
        sr += data[i] * w;
        sg += data[i + 1] * w;
        sb += data[i + 2] * w;
      }
      const t = (y * width + x) * 3;
      tmp[t] = sr;
      tmp[t + 1] = sg;
      tmp[t + 2] = sb;
    }
  }
  // 垂直
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      for (let k = -r; k <= r; k += 1) {
        const sy = Math.max(0, Math.min(height - 1, y + k));
        const t = (sy * width + x) * 3;
        const w = kernel[k + r];
        sr += tmp[t] * w;
        sg += tmp[t + 1] * w;
        sb += tmp[t + 2] * w;
      }
      const i = (y * width + x) * 4;
      data[i] = clamp255(sr);
      data[i + 1] = clamp255(sg);
      data[i + 2] = clamp255(sb);
    }
  }
}

/** Motion Blur：沿 angle 方向做长度 radius 的均值。 */
function applyMotionBlur(bitmap: Bitmap, a: Adjustment): void {
  // 官方字段名 = motionDistance（1–2000）/ motionAngle（−90..90 度，project-format.md v9）
  const radius = numOr(a.motionDistance, numOr(a.radius, 0));
  if (radius <= 0) return;
  const angle = (numOr(a.motionAngle, numOr(a.angle, 0)) * Math.PI) / 180;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const steps = Math.max(1, Math.round(radius));
  const { width, height, data } = bitmap;
  const src = new Uint8ClampedArray(data);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      for (let s = 0; s < steps; s += 1) {
        const t = s - (steps - 1) / 2;
        const sx = Math.max(0, Math.min(width - 1, Math.round(x + dx * t)));
        const sy = Math.max(0, Math.min(height - 1, Math.round(y + dy * t)));
        const i = (sy * width + sx) * 4;
        sr += src[i];
        sg += src[i + 1];
        sb += src[i + 2];
      }
      const i = (y * width + x) * 4;
      data[i] = clamp255(sr / steps);
      data[i + 1] = clamp255(sg / steps);
      data[i + 2] = clamp255(sb / steps);
    }
  }
}

/* ── 入口 ─────────────────────────────────────────────────────────────────────────── */
/**
 * 把一个调整图层作用到「它下方已合成的结果」上（就地修改 bitmap）。
 * ⛔ 顺序照 Photoshop：先 Levels → Curves → Exposure → 色相饱和 → 黑白 → 颜色平衡 →
 *    渐变映射 → 反相 → 模糊类 → 噪点类。identity 的块会被跳过（不产生可观测变化）。
 * @param seed 噪点种子（由调用方从图层 id 派生，保证同一文档渲染可复现）
 */
export function applyAdjustment(bitmap: Bitmap, a: Adjustment, seed: number): void {
  applyLevels(bitmap, a);
  applyCurves(bitmap, a);
  applyExposure(bitmap, a);
  if (a.kind === "Hue/Saturation") applyHueSaturation(bitmap, a);
  if (a.kind === "Black & White") applyBlackAndWhite(bitmap, a);
  if (a.kind === "Color Balance") applyColorBalance(bitmap, a);
  if (a.kind === "Gradient Map") applyGradientMap(bitmap, a);
  if (a.kind === "Invert") applyInvert(bitmap);
  if (a.kind === "Gaussian Blur") applyGaussianBlur(bitmap, a);
  if (a.kind === "Motion Blur") applyMotionBlur(bitmap, a);
  if (a.kind === "Add Noise") applyNoise(bitmap, a, seed, false);
  // Grain 的官方参数是嵌套的 grainSettings：把它摊平后再喂给噪点内核（不改动原对象）
  if (a.kind === "Grain") applyNoise(bitmap, flattenSettings(a, "grainSettings"), seed, true);
}

/** 把官方的嵌套 settings 对象摊到顶层（读取优先顶层），用于处理字段结构未知的调整种类。 */
function flattenSettings(a: Adjustment, key: string): Adjustment {
  const nested = (a as Record<string, unknown>)[key];
  if (!nested || typeof nested !== "object") return a;
  return { ...nested, ...a } as Adjustment;
}

/* ── 小工具 ───────────────────────────────────────────────────────────────────────── */
function numOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}
function parseHex(input: unknown): [number, number, number] {
  const hex = String(input ?? "").trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return [0, 0, 0];
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}
