/**
 * 混合模式内核（image-doc）
 *
 * 24 种，拼写与 Compositor / Photoshop 一致（写错一个字 = `.comp` 被整份静默拒绝）。
 * 公式口径：可分离模式用 Photoshop 的经典公式（在 sRGB 0..1 上，与 W3C Compositing 一致）；
 * 非可分离四件套（Hue / Saturation / Color / Luminosity）用 W3C 规范的 SetLum / SetSat / ClipColor。
 *
 * ⛔ 为什么自己写而不直接用 jimp 的 composite：jimp 只带十余种 BLEND_* 常量，缺 Color Burn /
 *    Hard Mix / Hue 等，且它的 blend 语义与 Photoshop 不完全对齐 —— 而我们的产物要能被
 *    Compositor 打开后**看起来一致**，公式必须同源。
 * ⛔ 纯 JS、无平台分支：Windows 与 mac 逐字节一致（这是选 jimp 而非 sharp 的初衷）。
 * ⛔ 就地写入 `backdrop`（不分配数组）—— 百万像素 × 每层的热路径，分配会直接吃掉几百毫秒。
 */
import type { BlendMode } from "./model";

const clamp = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Color Burn：s=0 时结果为 0（不能除零）。 */
function colorBurn(b: number, s: number): number {
  if (s <= 0) return 0;
  return clamp(1 - (1 - b) / s);
}
/** Color Dodge：s=1 时结果为 1。 */
function colorDodge(b: number, s: number): number {
  if (s >= 1) return 1;
  return clamp(b / (1 - s));
}
/** Soft Light 的 D(b) 项（W3C 公式）。 */
function softLightD(b: number): number {
  return b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
}

/** 单通道混合（只覆盖 20 种可分离模式；另 4 种见 blendRGB）。 */
export function blendChannel(mode: BlendMode, b: number, s: number): number {
  switch (mode) {
    case "Normal":
      return s;
    case "Darken":
      return Math.min(b, s);
    case "Multiply":
      return clamp(b * s);
    case "Color Burn":
      return colorBurn(b, s);
    case "Linear Burn":
      return clamp(b + s - 1);
    case "Lighten":
      return Math.max(b, s);
    case "Screen":
      return clamp(b + s - b * s);
    case "Color Dodge":
      return colorDodge(b, s);
    case "Linear Dodge (Add)":
      return clamp(b + s);
    case "Overlay":
      return b <= 0.5 ? clamp(2 * b * s) : clamp(1 - 2 * (1 - b) * (1 - s));
    case "Soft Light":
      return s <= 0.5
        ? clamp(b - (1 - 2 * s) * b * (1 - b))
        : clamp(b + (2 * s - 1) * (softLightD(b) - b));
    case "Hard Light":
      return s <= 0.5 ? clamp(2 * s * b) : clamp(1 - 2 * (1 - s) * (1 - b));
    case "Vivid Light":
      return s <= 0.5 ? colorBurn(b, 2 * s) : colorDodge(b, 2 * (s - 0.5));
    case "Linear Light":
      return clamp(b + 2 * s - 1);
    case "Pin Light":
      return s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1);
    case "Hard Mix":
      // Photoshop：先算 Vivid Light，再硬阈值到 0/1
      return (s <= 0.5 ? colorBurn(b, 2 * s) : colorDodge(b, 2 * (s - 0.5))) >= 0.5 ? 1 : 0;
    case "Difference":
      return clamp(Math.abs(b - s));
    case "Exclusion":
      return clamp(b + s - 2 * b * s);
    case "Subtract":
      return clamp(b - s);
    case "Divide":
      return s <= 0 ? 1 : clamp(b / s);
    default:
      // Hue / Saturation / Color / Luminosity 不是逐通道可算的，交由 blendRGB 处理
      return s;
  }
}

/* ── 非可分离四件套（W3C Compositing and Blending Level 1）────────────────────────── */
const lum = (r: number, g: number, b: number): number => 0.3 * r + 0.59 * g + 0.11 * b;

/** ClipColor：把越界的颜色拉回 0..1，同时保住亮度比例。 */
function clipColor(c: [number, number, number]): void {
  const l = lum(c[0], c[1], c[2]);
  const n = Math.min(c[0], c[1], c[2]);
  const x = Math.max(c[0], c[1], c[2]);
  if (n < 0) {
    c[0] = l + ((c[0] - l) * l) / (l - n || 1);
    c[1] = l + ((c[1] - l) * l) / (l - n || 1);
    c[2] = l + ((c[2] - l) * l) / (l - n || 1);
  }
  if (x > 1) {
    c[0] = l + ((c[0] - l) * (1 - l)) / (x - l || 1);
    c[1] = l + ((c[1] - l) * (1 - l)) / (x - l || 1);
    c[2] = l + ((c[2] - l) * (1 - l)) / (x - l || 1);
  }
}

/** SetLum：保住色相与饱和度，把亮度改成 l。 */
function setLum(c: [number, number, number], l: number): void {
  const d = l - lum(c[0], c[1], c[2]);
  c[0] += d;
  c[1] += d;
  c[2] += d;
  clipColor(c);
}

/** Saturation(C) = max − min。 */
const sat = (c: [number, number, number]): number => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);

/**
 * SetSat：保住色相与亮度，把饱和度改成 s（W3C：Cmax→s，Cmin→0，Cmid 按 (Cmid−Cmin)/(Cmax−Cmin) 缩放）。
 * ⛔ 别用「比较索引是不是 max」来分派 —— 两个分量相等时歧义（灰/纯色边上会跳色）。
 */
function setSat(c: [number, number, number], s: number): void {
  const max = Math.max(c[0], c[1], c[2]);
  const min = Math.min(c[0], c[1], c[2]);
  if (max <= min) {
    c[0] = 0;
    c[1] = 0;
    c[2] = 0;
  } else {
    const scale = s / (max - min);
    c[0] = (c[0] - min) * scale;
    c[1] = (c[1] - min) * scale;
    c[2] = (c[2] - min) * scale;
  }
}

const NON_SEPARABLE = new Set<BlendMode>(["Hue", "Saturation", "Color", "Luminosity"]);
export const isNonSeparable = (mode: BlendMode): boolean => NON_SEPARABLE.has(mode);

/**
 * 就地混合：`backdrop` 被改写成混合结果（元素取值 0..1）。
 * @param backdrop 底（下方已合成结果），会被就地修改
 * @param source   源（当前图层）
 */
export function blendRGB(backdrop: [number, number, number], source: [number, number, number], mode: BlendMode): void {
  if (!isNonSeparable(mode)) {
    backdrop[0] = blendChannel(mode, backdrop[0], source[0]);
    backdrop[1] = blendChannel(mode, backdrop[1], source[1]);
    backdrop[2] = blendChannel(mode, backdrop[2], source[2]);
    return;
  }
  // ⛔ 四种模式的「底/源」取法各不相同，别照抄其中一个：
  //    Hue        = SetLum(SetSat(源, Sat(底)), Lum(底))
  //    Saturation = SetLum(SetSat(底, Sat(源)), Lum(底))
  //    Color      = SetLum(源, Lum(底))
  //    Luminosity = SetLum(SetSat(底, Sat(源)), Lum(源))
  switch (mode) {
    case "Hue": {
      const cr: [number, number, number] = [source[0], source[1], source[2]];
      setSat(cr, sat(backdrop));
      setLum(cr, lum(backdrop[0], backdrop[1], backdrop[2]));
      backdrop[0] = clamp(cr[0]);
      backdrop[1] = clamp(cr[1]);
      backdrop[2] = clamp(cr[2]);
      return;
    }
    case "Saturation": {
      const cr: [number, number, number] = [backdrop[0], backdrop[1], backdrop[2]];
      setSat(cr, sat(source));
      setLum(cr, lum(backdrop[0], backdrop[1], backdrop[2]));
      backdrop[0] = clamp(cr[0]);
      backdrop[1] = clamp(cr[1]);
      backdrop[2] = clamp(cr[2]);
      return;
    }
    case "Color": {
      const cr: [number, number, number] = [source[0], source[1], source[2]];
      setLum(cr, lum(backdrop[0], backdrop[1], backdrop[2]));
      backdrop[0] = clamp(cr[0]);
      backdrop[1] = clamp(cr[1]);
      backdrop[2] = clamp(cr[2]);
      return;
    }
    case "Luminosity": {
      const cr: [number, number, number] = [backdrop[0], backdrop[1], backdrop[2]];
      setSat(cr, sat(source));
      setLum(cr, lum(source[0], source[1], source[2]));
      backdrop[0] = clamp(cr[0]);
      backdrop[1] = clamp(cr[1]);
      backdrop[2] = clamp(cr[2]);
      return;
    }
    default:
      break;
  }
}
