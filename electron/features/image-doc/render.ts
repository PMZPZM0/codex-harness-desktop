/**
 * 合成器（image-doc）：把一份 `.comp` 文档渲染成一张平铺图片。
 *
 * ⛔ 这是"Windows 上也有意义"的那一半：Compositor 只在 macOS 26+ / Apple 芯片上跑，
 *    Windows 用户拿不到它 —— 所以我们自己把同一份文档合成出来。同一份 manifest、
 *    同一套公式，**两端看到的是同一张图**（这是选"统一格式"而不是"硬搬 Swift"的全部理由）。
 *
 * 合成口径（对齐 Compositor / Photoshop）：
 *   · layers 自底向上，最后一个画在最上面；
 *   · 调整图层没有像素，作用于它**下方已合成的结果**；
 *   · 合成用 W3C 的完整 alpha 公式（不是简单的 lerp）—— 半透明图层叠在透明画布上才不会发黑：
 *       ao = ab + as·(1−ab)
 *       Co = [(1−as)·ab·Cb + as·(1−ab)·Cs + as·ab·B(Cb,Cs)] / ao
 *   · 蒙版与图层**源图同像素尺寸**（规格明文），所以在源图坐标上采样，不随变换拉伸。
 *
 * ⛔ 纯 JS、无原生依赖、无平台分支（jimp 只用于 PNG 编解码与最终容器）。
 */
import { applyAdjustment, seedFromId } from "./adjust";
import { blendRGB } from "./blend";
import type { BlendMode, CompDocument, Layer, Sampling } from "./model";
import { loadJimp, readLayerImage } from "./model";

/* ── 采样（Nearest / 双线性 / 双三次 Catmull-Rom）─────────────────────────────────── */
type Rgba = { r: number; g: number; b: number; a: number };

function nearest(data: Uint8ClampedArray | Uint8Array, w: number, h: number, u: number, v: number): Rgba {
  const x = Math.max(0, Math.min(w - 1, Math.round(u - 0.5)));
  const y = Math.max(0, Math.min(h - 1, Math.round(v - 0.5)));
  const i = (y * w + x) * 4;
  return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
}

function bilinear(data: Uint8ClampedArray | Uint8Array, w: number, h: number, u: number, v: number): Rgba {
  const x0 = Math.floor(u - 0.5);
  const y0 = Math.floor(v - 0.5);
  const fx = u - 0.5 - x0;
  const fy = v - 0.5 - y0;
  const out: Rgba = { r: 0, g: 0, b: 0, a: 0 };
  for (let dy = 0; dy <= 1; dy += 1) {
    for (let dx = 0; dx <= 1; dx += 1) {
      const sx = Math.max(0, Math.min(w - 1, x0 + dx));
      const sy = Math.max(0, Math.min(h - 1, y0 + dy));
      const weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
      if (weight <= 0) continue;
      const i = (sy * w + sx) * 4;
      out.r += data[i] * weight;
      out.g += data[i + 1] * weight;
      out.b += data[i + 2] * weight;
      out.a += data[i + 3] * weight;
    }
  }
  return out;
}

/** Catmull-Rom 一维权重（t ∈ [0,1]）。 */
function crWeights(t: number): [number, number, number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    -0.5 * t3 + t2 - 0.5 * t,
    1.5 * t3 - 2.5 * t2 + 1,
    -1.5 * t3 + 2 * t2 + 0.5 * t,
    0.5 * t3 - 0.5 * t2,
  ];
}

function bicubic(data: Uint8ClampedArray | Uint8Array, w: number, h: number, u: number, v: number): Rgba {
  const xi = Math.floor(u - 0.5);
  const yi = Math.floor(v - 0.5);
  const fx = u - 0.5 - xi;
  const fy = v - 0.5 - yi;
  const wx = crWeights(fx);
  const wy = crWeights(fy);
  const out: Rgba = { r: 0, g: 0, b: 0, a: 0 };
  for (let m = 0; m < 4; m += 1) {
    const sy = Math.max(0, Math.min(h - 1, yi - 1 + m));
    const wyv = wy[m];
    if (wyv === 0) continue;
    for (let n = 0; n < 4; n += 1) {
      const sx = Math.max(0, Math.min(w - 1, xi - 1 + n));
      const wxv = wx[n];
      if (wxv === 0) continue;
      const weight = wxv * wyv;
      const i = (sy * w + sx) * 4;
      out.r += data[i] * weight;
      out.g += data[i + 1] * weight;
      out.b += data[i + 2] * weight;
      out.a += data[i + 3] * weight;
    }
  }
  return {
    r: Math.max(0, Math.min(255, out.r)),
    g: Math.max(0, Math.min(255, out.g)),
    b: Math.max(0, Math.min(255, out.b)),
    a: Math.max(0, Math.min(255, out.a)),
  };
}

function samplerOf(mode: Sampling): (d: Uint8ClampedArray | Uint8Array, w: number, h: number, u: number, v: number) => Rgba {
  if (mode === "Nearest") return nearest;
  if (mode === "Smooth") return bilinear;
  return bicubic;
}

/* ── 合成 ─────────────────────────────────────────────────────────────────────────── */
/**
 * 把一张源图按 transform 放置并混合进累积缓冲。
 * @param acc 累积缓冲（直通 alpha，RGBA，0..255，长度 width*height*4）
 */
function compositeLayer(
  acc: Float32Array,
  canvasW: number,
  canvasH: number,
  source: { data: Uint8ClampedArray | Uint8Array; width: number; height: number; mask?: (Uint8ClampedArray | Uint8Array) | null },
  layer: Layer,
  opacity: number,
  mode: BlendMode,
): void {
  const sample = samplerOf(layer.transform.sampling);
  const [ox, oy] = layer.transform.origin;
  const [tw, th] = layer.transform.size;
  const radians = (layer.transform.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  // 目标包围盒：绕矩形中心旋转后的轴对齐框
  const cx = ox + tw / 2;
  const cy = oy + th / 2;
  const bw = Math.abs(tw * cos) + Math.abs(th * sin);
  const bh = Math.abs(tw * sin) + Math.abs(th * cos);
  const x0 = Math.max(0, Math.floor(cx - bw / 2));
  const y0 = Math.max(0, Math.floor(cy - bh / 2));
  const x1 = Math.min(canvasW - 1, Math.ceil(cx + bw / 2));
  const y1 = Math.min(canvasH - 1, Math.ceil(cy + bh / 2));

  // ⛔ 三个数组都在循环外复用（百万像素的热路径里分配元组会直接吃掉几百毫秒）
  const cbRaw: [number, number, number] = [0, 0, 0]; // 原始底色 Cb
  const cb: [number, number, number] = [0, 0, 0];    // 被 blendRGB 就地改写成 B(Cb,Cs)
  const cs: [number, number, number] = [0, 0, 0];    // 源色 Cs

  for (let py = y0; py <= y1; py += 1) {
    for (let px = x0; px <= x1; px += 1) {
      // 目标 → 源：逆旋转回未旋转矩形的局部坐标
      const dx = px + 0.5 - cx;
      const dy = py + 0.5 - cy;
      let lx = dx * cos + dy * sin;
      let ly = -dx * sin + dy * cos;
      if (layer.transform.flipX) lx = -lx;
      if (layer.transform.flipY) ly = -ly;
      const u = lx + tw / 2;
      const v = ly + th / 2;
      if (u < 0 || v < 0 || u > tw || v > th) continue;
      // 局部坐标 → 源图像素坐标
      const su = (u / (tw || 1)) * source.width;
      const sv = (v / (th || 1)) * source.height;
      const texel = sample(source.data, source.width, source.height, su, sv);

      let alpha = (texel.a / 255) * opacity;
      if (alpha <= 0) continue;
      if (source.mask) {
        const m = sample(source.mask, source.width, source.height, su, sv);
        alpha *= m.r / 255;
        if (alpha <= 0) continue;
      }

      const di = (py * canvasW + px) * 4;
      const ab = acc[di + 3] / 255;
      // ⛔ 先留一份**原始**底色：blendRGB 会就地改写它的第一个参数，而 W3C 公式里
      //    Cb 要同时以"原值"参与 (1−as)·ab·Cb 这一项 —— 用改写后的值会让半透明叠加整体偏色。
      cbRaw[0] = acc[di] / 255;
      cbRaw[1] = acc[di + 1] / 255;
      cbRaw[2] = acc[di + 2] / 255;
      cb[0] = cbRaw[0];
      cb[1] = cbRaw[1];
      cb[2] = cbRaw[2];
      cs[0] = texel.r / 255;
      cs[1] = texel.g / 255;
      cs[2] = texel.b / 255;
      blendRGB(cb, cs, mode); // 返回后 cb = B(Cb,Cs)

      // W3C Compositing：alpha 恒按 Normal 合成，颜色按混合函数
      const ao = ab + alpha * (1 - ab);
      if (ao <= 0) continue;
      const w1 = (1 - alpha) * ab;
      const w2 = alpha * (1 - ab);
      const w3 = alpha * ab;
      acc[di] = ((w1 * cbRaw[0] + w2 * cs[0] + w3 * cb[0]) / ao) * 255;
      acc[di + 1] = ((w1 * cbRaw[1] + w2 * cs[1] + w3 * cb[1]) / ao) * 255;
      acc[di + 2] = ((w1 * cbRaw[2] + w2 * cs[2] + w3 * cb[2]) / ao) * 255;
      acc[di + 3] = ao * 255;
    }
  }
}

/** 把调整图层作用到"下方已合成的结果"上，再把结果按 opacity/blend 混回去。 */
function compositeAdjustment(
  acc: Float32Array,
  canvasW: number,
  canvasH: number,
  layer: Layer,
  opacity: number,
  mode: BlendMode,
): void {
  const rgba = new Uint8ClampedArray(canvasW * canvasH * 4);
  for (let i = 0; i < acc.length; i += 1) rgba[i] = Math.max(0, Math.min(255, acc[i]));
  applyAdjustment({ width: canvasW, height: canvasH, data: rgba }, layer.adjustment!, seedFromId(layer.id));
  // 调整结果的 alpha 视为全不透明（调整不改变透明度），再按图层自身的 opacity / blend 混回
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  compositeLayer(
    acc,
    canvasW,
    canvasH,
    { data: rgba, width: canvasW, height: canvasH, mask: null },
    { ...layer, transform: { ...layer.transform, origin: [0, 0], size: [canvasW, canvasH], rotation: 0, flipX: false, flipY: false } },
    opacity,
    mode,
  );
}

/* ── 入口 ─────────────────────────────────────────────────────────────────────────── */
export type RenderOptions = { format?: "png" | "jpeg" | "bmp" | "tiff"; quality?: number };

const MIME: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", bmp: "image/bmp", tiff: "image/tiff" };

/**
 * 渲染一份文档。
 * ⛔ 图层图片缺失时**明确报错**而不是跳过：静默跳过会让"画布少了一层"看起来像合成 bug，
 *    而真实原因是模型给了错路径（本项目反复踩"静默降级最难排查"）。
 */
export async function renderDocument(
  doc: CompDocument,
  opts: RenderOptions = {},
): Promise<{ buffer: Buffer; width: number; height: number; layers: number }> {
  const Jimp = await loadJimp();
  const width = Math.max(1, Math.round(doc.manifest.width));
  const height = Math.max(1, Math.round(doc.manifest.height));
  const acc = new Float32Array(width * height * 4);
  let painted = 0;

  for (const layer of doc.manifest.layers) {
    if (!layer.isVisible) continue;
    const opacity = Math.max(0, Math.min(1, layer.opacity));
    if (layer.adjustment) {
      compositeAdjustment(acc, width, height, layer, opacity, layer.blendMode);
      painted += 1;
      continue;
    }
    if (!layer.imageFile) continue;
    const bytes = await readLayerImage(doc.dir, layer.imageFile);
    if (!bytes) throw new Error(`图层「${layer.name}」的图片缺失：images/${layer.imageFile}`);
    const image = await Jimp.read(bytes);
    let mask: Uint8ClampedArray | Uint8Array | null = null;
    if (layer.maskFile && layer.maskEnabled !== false) {
      const maskBytes = await readLayerImage(doc.dir, layer.maskFile).catch(() => null);
      if (maskBytes) mask = (await Jimp.read(maskBytes)).bitmap.data;
    }
    compositeLayer(acc, width, height, { data: image.bitmap.data, width: image.bitmap.width, height: image.bitmap.height, mask }, layer, opacity, layer.blendMode);
    painted += 1;
  }

  const out = new Jimp({ width, height, color: 0x00000000 });
  const target = out.bitmap.data;
  for (let i = 0; i < acc.length; i += 1) target[i] = Math.max(0, Math.min(255, Math.round(acc[i])));
  const format = opts.format && MIME[opts.format] ? opts.format : "png";
  const buffer = await out.getBuffer(MIME[format], format === "jpeg" ? { quality: Math.max(1, Math.min(100, Math.round(opts.quality ?? 90))) } : undefined);
  return { buffer, width, height, layers: painted };
}
