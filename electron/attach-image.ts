/**
 * attach-image.ts —— 附件图片的**体积治理**（2026-11-23 立）。
 *
 * ── 为什么需要（用户实测：粘贴一张截图，会话直接 413 炸掉）──────────────────
 *  报错原文：`unexpected status 413 Payload Too Large: 请求体超过 32 MB 上限`
 *  （上游网关的 `WB_GATEWAY_MAX_BODY_MB`，宿主无法调）。
 *  关键在于**引擎每轮都会把历史消息里的图片重新 base64 发一遍** —— 一张 4K 截图 base64 后
 *  8~12MB，历史里几张就把 body 撑爆：先炸一次 413，之后每条消息都要重新编码/上传几十 MB，
 *  于是「再发消息就好慢，要等好久」。⇒ 根治点在**图片进上下文时的字节数**，不是重试或超时。
 *
 * ── 做法（只治理**我们自己落盘的副本**，⛔ 绝不动用户原文件）──────────────────
 *  ① 长边 > 2048 ⇒ 等比缩到 2048（视觉模型不需要更大，缩完 PNG 体积通常降 60~80%）；
 *  ② 缩完仍 > 2MB ⇒ 转 JPEG q=88（先铺白底，⛔ 否则透明区变黑）；
 *  ③ 压完反而更大 / 解不开 ⇒ **保留原图**（⛔ 不许为了"治理"把用户的图弄坏）。
 *
 *  ⛔ 只在 `clipboard:image`（粘贴落盘）这条路上调用：用户拖进来的原始文件属于他自己的资产，
 *    我们不复制、不改写；那条路只在必要时由界面提示体积（见 send 侧的提示）。
 */
import fs from "node:fs/promises";
import { loadJimp } from "./features/image-doc/model";

/** 视觉模型的有效分辨率上限（再大只是浪费字节，主流厂商也都按这个量级内部缩放）。 */
const MAX_EDGE = 2048;
/** 单图软上限：超过就转 JPEG（截图之外的实拍图能降一个数量级）。 */
const TARGET_BYTES = 2 * 1024 * 1024;

export type ShrinkResult = {
  /** 最终文件路径（转换格式时可能换了扩展名 —— 调用方**必须**用这个返回值）。 */
  path: string;
  /** 最终字节数。 */
  bytes: number;
  /** 是否真的改写过（false = 原文件未动）。 */
  changed: boolean;
  /** 给人看的一句话原因（只在没改动时给，便于排查"为什么没压"）。 */
  note?: string;
};

/**
 * 把一个附件图片压到「视觉够用、字节可控」的形态；返回**最终路径**。
 * ⛔ 调用方必须使用返回的 path（PNG 转 JPEG 时文件名会变）；⛔ 不要对用户原文件调用它。
 */
export async function shrinkAttachedImage(file: string): Promise<ShrinkResult> {
  const before = await fs.stat(file).then((s) => s.size).catch(() => 0);
  if (!before) return { path: file, bytes: 0, changed: false, note: "读不到文件" };

  let Jimp: any;
  try {
    Jimp = await loadJimp();
  } catch {
    return { path: file, bytes: before, changed: false, note: "图像库不可用" };
  }

  let image: any;
  try {
    image = await Jimp.read(file);
  } catch {
    return { path: file, bytes: before, changed: false, note: "不是可解码的图片" };
  }

  const width = Number(image?.bitmap?.width ?? 0);
  const height = Number(image?.bitmap?.height ?? 0);
  const overEdge = Math.max(width, height) > MAX_EDGE;
  if (!overEdge && before <= TARGET_BYTES) return { path: file, bytes: before, changed: false };

  if (overEdge) {
    /* scaleToFit 只缩不放（等比），传目标包围盒即可。 */
    image.scaleToFit({ w: MAX_EDGE, h: MAX_EDGE });
  }

  let buffer: Buffer;
  let asJpeg = false;
  try {
    buffer = await image.getBuffer("image/png");
    if (buffer.length > TARGET_BYTES) {
      /* 转 JPEG 前铺白底：PNG 的透明区在 JPEG 里会变黑（截图/图标很常见）。 */
      if (typeof image.background === "function") image.background(0xffffffff);
      buffer = await image.getBuffer("image/jpeg", { quality: 88 });
      asJpeg = true;
    }
  } catch {
    return { path: file, bytes: before, changed: false, note: "编码失败" };
  }

  /* 压完没变小 ⇒ 说明原图本来就紧致，别白白损失一次编码质量。 */
  if (buffer.length >= before) return { path: file, bytes: before, changed: false, note: "已是最小" };

  const target = asJpeg ? file.replace(/\.(png|bmp|tiff?|webp)$/i, ".jpg") : file;
  try {
    await fs.writeFile(target, buffer);
    if (target !== file) await fs.rm(file, { force: true });
  } catch {
    return { path: file, bytes: before, changed: false, note: "写盘失败" };
  }
  return { path: target, bytes: buffer.length, changed: true };
}
