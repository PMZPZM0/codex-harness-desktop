/**
 * 图像工坊（image-lab，2026-10-09 立项，用户：「把图像生成与编辑类工具内置进来，
 * 配齐可供 Codex 直接调用的接口，要能在 Windows 上正常跑」）
 *
 * 定位：给 Codex 一套**可直接调用**的作图 / 修图能力，不依赖任何原生二进制。
 *
 * ⛔ 引擎选型 = jimp（**纯 JS**，零原生依赖）：
 *   · 本仓已因 better-sqlite3 的原生模块 ABI 三元组踩过坑（装与跑必须同一个 node），
 *     sharp / canvas 这类带 .node 的库在「Windows 打包 + mac 交叉构建」下是已知风险点；
 *   · jimp 全部是 JS，Win / mac 行为逐字节一致，asar 打包零特判 —— 满足用户「Windows 功能完整」的硬要求。
 *   代价：比 libvips 慢（单张 1024² 百万像素级操作在百毫秒量级，够用）。
 *
 * 职责划分（同 uiverse-library 的口径）：
 *   · 纯函数 `imageEditCore` / `imageInfoCore` 给 dispatch-rpc 的 MCP 工具直接调用（**不另写一份实现**）；
 *   · `defineFeature` 只挂一条 `image-lab:read`（渲染层预览弹窗拉字节用，镜像 model-viewer:read）。
 *   · 弹窗联动（工具调用时弹出预览、完成自动消失）走 `image-lab:event` 推送 ——
 *     与 model-viewer:open 同款**手写推送桥**，不进 manifest / 不占通道计数。
 *
 * ⛔ 路径闸（read 与 edit 共用同一道 `resolveImagePath`）：可信根 + 图片扩展名白名单 + 存在 + 大小上限。
 *   任意路径读写 = 渲染层被注入即可读写全盘（fs:read 09-19 审计高危的同型问题）。
 */
import path from "node:path";
import fs from "node:fs/promises";
import { isInsideTrustedRoots } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { sendToWindow } from "./window-bus";

/** 支持的图片扩展名（读写共用）。⛔ gif 只取首帧（jimp 不解多帧动画）。 */
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".tif", ".gif", ".webp"];
/** 上限 128MB（实测生图产物多在 1~8MB；再大多半是误选文件）。 */
const MAX_IMAGE_BYTES = 128 * 1024 * 1024;

/** 输出格式：jimp 编码器只稳定支持这几种（webp/gif 只能读不能写）。 */
export type ImageFormat = "png" | "jpeg" | "bmp" | "tiff";
const FORMAT_TO_MIME: Record<ImageFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  bmp: "image/bmp",
  tiff: "image/tiff",
};
const FORMAT_TO_EXT: Record<ImageFormat, string> = { png: ".png", jpeg: ".jpg", bmp: ".bmp", tiff: ".tiff" };
/** 源图扩展名 → 可写格式（webp/gif 只能读不能写 ⇒ 回落 png）。 */
const EXT_TO_FORMAT: Record<string, ImageFormat> = {
  ".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".bmp": "bmp", ".tiff": "tiff", ".tif": "tiff",
};

/** 源/出图路径校验（image-lab:read 与工具编辑共用）：可信根内 + 图片扩展名 + 存在 + 大小上限。 */
export async function resolveImagePath(rawPath: string): Promise<string> {
  const candidate = path.resolve(String(rawPath ?? "").trim());
  if (!IMAGE_EXTENSIONS.includes(path.extname(candidate).toLowerCase())) {
    throw new Error(`只支持图片文件（${IMAGE_EXTENSIONS.join(" / ")}）`);
  }
  // ⛔ isInsideTrustedRoots 是内核独占判定（fs:read 同款，不经接缝）——任意路径读 = XSS 即可读全盘
  if (!isInsideTrustedRoots(candidate)) throw new Error("路径不在可信目录内（会话工作目录 / 应用数据目录）");
  const stat = await fs.stat(candidate).catch(() => null);
  if (!stat?.isFile()) throw new Error(`图片不存在：${rawPath}`);
  if (stat.size > MAX_IMAGE_BYTES) {
    throw new Error(`图片超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB 上限（当前 ${Math.round(stat.size / 1024 / 1024)}MB）`);
  }
  return candidate;
}

/** 一个编辑操作（判别联合）。字段名与工具 schema 逐字一致，别在此处另起别名。 */
export type ImageOp =
  | { op: "resize"; width?: number; height?: number }
  | { op: "scale"; factor: number }
  | { op: "crop"; x: number; y: number; width: number; height: number }
  | { op: "rotate"; degrees: number }
  | { op: "flip"; axis?: "horizontal" | "vertical" | "both" }
  | { op: "brightness"; value: number }
  | { op: "contrast"; value: number }
  | { op: "greyscale" }
  | { op: "invert" }
  | { op: "sepia" }
  | { op: "blur"; radius?: number }
  | { op: "gaussian"; radius: number }
  | { op: "posterize"; n: number }
  | { op: "pixelate"; size?: number }
  | { op: "normalize" }
  | { op: "opacity"; value: number }
  | { op: "color"; apply: string; params?: number[] }
  | { op: "composite"; path: string; x?: number; y?: number; opacity?: number }
  | { op: "text"; text: string; x?: number; y?: number; size?: number; color?: "black" | "white" }
  | { op: "background"; color: string };

export type ImageEditInput = {
  /** 源图绝对路径（单张）。与 paths 至少给一个。 */
  path?: string;
  /** 源图列表（同一组 ops 逐张应用）。 */
  paths?: string[];
  ops: ImageOp[];
  /** 输出路径（缺省 = 源图同目录 `<name>-edit.<ext>`）。必须在可信根内。 */
  output?: string;
  /** 输出格式（缺省沿用源图；webp/gif 源会回落 png）。 */
  format?: ImageFormat;
  /** jpeg 质量 1-100（缺省 90）。 */
  quality?: number;
};

export type ImageEditResult = { path: string; width: number; height: number; bytes: number; format: ImageFormat };

/** jimp 惰性加载（纯 JS，约百毫秒解析）——不在模块顶层 import，避免拖慢引擎启动。
 *  ⛔ 字体规格（SANS_*）在 `jimp/fonts` 子模块、不在主模块导出的 loadFont 里：只 import("jimp")
 *     会拿到 undefined 的字体规格，loadFont 内部报 "Cannot read properties of undefined"。 */
let jimpPromise: Promise<{ jimp: any; fonts: any }> | null = null;
function loadJimp(): Promise<{ jimp: any; fonts: any }> {
  jimpPromise ??= Promise.all([import("jimp"), import("jimp/fonts")]).then(([jimp, fonts]) => ({ jimp, fonts }));
  return jimpPromise;
}

/** 依尺寸与明暗挑内置 SANS 位图字体（jimp 只带这几档，仅 ASCII）。 */
function pickFontSpec(fonts: any, size: number, dark: boolean): string {
  const ladder: Array<[number, string, string]> = [
    [8, "SANS_8_BLACK", "SANS_8_WHITE"],
    [10, "SANS_10_BLACK", "SANS_10_WHITE"],
    [12, "SANS_12_BLACK", "SANS_12_WHITE"],
    [16, "SANS_16_BLACK", "SANS_16_WHITE"],
    [32, "SANS_32_BLACK", "SANS_32_WHITE"],
    [64, "SANS_64_BLACK", "SANS_64_WHITE"],
    [128, "SANS_128_BLACK", "SANS_128_WHITE"],
  ];
  let chosen = ladder[0];
  for (const row of ladder) if (size >= row[0]) chosen = row;
  return dark ? fonts[chosen[1]] : fonts[chosen[2]];
}

/** 逐条应用 ops（顺序即语义，照用户给的顺序执行）。 */
async function applyOps(image: any, ops: ImageOp[], lib: { jimp: any; fonts: any }): Promise<void> {
  for (const raw of ops) {
    const op = raw as any;
    switch (op.op) {
      case "resize": {
        // 宽高都给 = 拉伸到该尺寸；只给一个 = 等比缩放到该边
        const patch: Record<string, number> = {};
        if (Number(op.width) > 0) patch.w = Math.round(Number(op.width));
        if (Number(op.height) > 0) patch.h = Math.round(Number(op.height));
        if (Object.keys(patch).length) image.resize(patch);
        break;
      }
      case "scale": {
        const factor = Number(op.factor);
        if (Number.isFinite(factor) && factor > 0) image.scale(Number(factor.toFixed(6)));
        break;
      }
      case "crop":
        image.crop({
          x: Math.max(0, Math.round(Number(op.x) || 0)),
          y: Math.max(0, Math.round(Number(op.y) || 0)),
          w: Math.max(1, Math.round(Number(op.width) || 0)),
          h: Math.max(1, Math.round(Number(op.height) || 0)),
        });
        break;
      case "rotate":
        image.rotate(Number(op.degrees) || 0);
        break;
      case "flip":
        image.flip({ horizontal: op.axis !== "vertical", vertical: op.axis === "vertical" || op.axis === "both" });
        break;
      case "brightness":
        image.brightness(Math.max(-1, Math.min(1, Number(op.value) || 0)));
        break;
      case "contrast":
        image.contrast(Math.max(-1, Math.min(1, Number(op.value) || 0)));
        break;
      case "greyscale":
        image.greyscale();
        break;
      case "invert":
        image.invert();
        break;
      case "sepia":
        image.sepia();
        break;
      case "blur":
        image.blur(Math.max(1, Math.round(Number(op.radius) || 2)));
        break;
      case "gaussian":
        image.gaussian(Math.max(1, Math.round(Number(op.radius) || 2)));
        break;
      case "posterize":
        image.posterize(Math.max(2, Math.round(Number(op.n) || 4)));
        break;
      case "pixelate":
        image.pixelate(Math.max(1, Math.round(Number(op.size) || 4)));
        break;
      case "normalize":
        image.normalize();
        break;
      case "opacity":
        image.opacity(Math.max(0, Math.min(1, Number(op.value) || 0)));
        break;
      case "color": {
        const apply = String(op.apply || "").trim();
        const params = Array.isArray(op.params) ? op.params.map((n: unknown) => Number(n) || 0) : [];
        if (apply) image.color([{ apply, params }]);
        break;
      }
      case "composite": {
        const overlayPath = await resolveImagePath(String(op.path || ""));
        const overlay = await lib.jimp.Jimp.read(overlayPath);
        if (Number.isFinite(Number(op.opacity))) overlay.opacity(Math.max(0, Math.min(1, Number(op.opacity))));
        image.composite(overlay, Math.round(Number(op.x) || 0), Math.round(Number(op.y) || 0));
        break;
      }
      case "text": {
        const text = String(op.text ?? "");
        if (!text) break;
        const font = await lib.jimp.loadFont(pickFontSpec(lib.fonts, Number(op.size) || 16, op.color !== "white"));
        image.print({ font, x: Math.round(Number(op.x) || 0), y: Math.round(Number(op.y) || 0), text });
        break;
      }
      case "background": {
        // 把透明底压成纯色：造一张同尺寸纯色图垫在下面
        const solid = new lib.jimp.Jimp({ width: image.bitmap.width, height: image.bitmap.height, color: parseColor(op.color) });
        solid.composite(image, 0, 0);
        image.bitmap = solid.bitmap;
        break;
      }
      default:
        // 未知 op 明确报错，不静默跳过（静默跳过 = 用户以为改了其实没改）
        throw new Error(`不认识的编辑操作：${String(op.op)}`);
    }
  }
}

/** "#rrggbb" / "#rrggbbaa" / "rrggbb" → jimp 的 0xRRGGBBAA 整数。 */
function parseColor(input: unknown): number {
  const hex = String(input ?? "").trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) return 0x000000ff;
  const rgba = hex.length === 8 ? hex : hex + "ff";
  return Number.parseInt(rgba, 16) >>> 0;
}

/**
 * 图像编辑核心（工具 image_edit 的实现）。逐张读源图 → 应用 ops → 编码落盘 → 返回结果。
 * ⛔ 输出路径同样过可信根闸：工具能写文件，闸口与读同宽（防"工具成了任意写盘后门"）。
 */
export async function imageEditCore(input: ImageEditInput): Promise<ImageEditResult[]> {
  const lib = await loadJimp();
  const rawPaths = [
    ...(Array.isArray(input.paths) ? input.paths : []),
    ...(input.path ? [input.path] : []),
  ].map((p) => String(p ?? "").trim()).filter(Boolean);
  if (!rawPaths.length) throw new Error("至少要给一张源图（path 或 paths）");
  if (!Array.isArray(input.ops) || !input.ops.length) throw new Error("ops 为空：没说要改什么");

  const quality = Math.max(1, Math.min(100, Math.round(Number(input.quality) || 90)));
  const results: ImageEditResult[] = [];

  for (const rawPath of rawPaths) {
    const source = await resolveImagePath(rawPath);
    const srcExt = path.extname(source).toLowerCase();
    const format: ImageFormat = input.format && FORMAT_TO_MIME[input.format]
      ? input.format
      : (EXT_TO_FORMAT[srcExt] ?? "png");

    const image = await lib.jimp.Jimp.read(source);
    await applyOps(image, input.ops, lib);

    let dest: string;
    if (input.output) {
      dest = path.resolve(String(input.output));
      if (!isInsideTrustedRoots(dest)) throw new Error("输出路径不在可信目录内（会话工作目录 / 应用数据目录）");
    } else {
      const dir = path.dirname(source);
      const base = path.basename(source, srcExt);
      dest = path.join(dir, `${base}-edit${FORMAT_TO_EXT[format]}`);
    }
    await fs.mkdir(path.dirname(dest), { recursive: true });
    const buffer = await image.getBuffer(FORMAT_TO_MIME[format], format === "jpeg" ? { quality } : undefined);
    await fs.writeFile(dest, buffer);
    results.push({ path: dest, width: image.bitmap.width, height: image.bitmap.height, bytes: buffer.length, format });
  }
  return results;
}

/** 读图元信息（工具 image_info）：尺寸 / 格式 / 是否带透明 / 字节数。 */
export async function imageInfoCore(input: { path?: string; paths?: string[] }): Promise<Array<{
  path: string; width: number; height: number; format: string; hasAlpha: boolean; bytes: number;
}>> {
  const lib = await loadJimp();
  const rawPaths = [
    ...(Array.isArray(input.paths) ? input.paths : []),
    ...(input.path ? [input.path] : []),
  ].map((p) => String(p ?? "").trim()).filter(Boolean);
  if (!rawPaths.length) throw new Error("至少要给一张图片（path 或 paths）");
  const out = [];
  for (const rawPath of rawPaths) {
    const source = await resolveImagePath(rawPath);
    const stat = await fs.stat(source);
    const image = await lib.jimp.Jimp.read(source);
    out.push({
      path: source,
      width: image.bitmap.width,
      height: image.bitmap.height,
      format: String(image.mime ?? "").replace("image/", "") || path.extname(source).slice(1),
      hasAlpha: Boolean(image.hasAlpha()),
      bytes: stat.size,
    });
  }
  return out;
}

/* ── 弹窗联动（工具调用时弹渲染层预览，完成自动消失）───────────────────────────
   ⛔ 单通道 `image-lab:event` 承载 open / update / close 三态（preload 只需一个手写桥，
      少一处要跟着 manifest 走的契约）。渲染层照 model-viewer 样板自挂载。 */
export type ImageLabPhase = "open" | "update" | "close";
export type ImageLabEvent = {
  phase: ImageLabPhase;
  /** 同一次工具调用共享的 id（渲染层据此忽略过期事件）。 */
  taskId: string;
  mode?: "generate" | "edit";
  title?: string;
  status?: "running" | "done" | "error";
  images?: string[];
  note?: string;
};

/** 推一条弹窗事件（无窗口时是 no-op，工具调用不受影响）。 */
export function pushImageLabEvent(event: ImageLabEvent): void {
  try { sendToWindow("image-lab:event", event); } catch { /* 窗口在关闭过程中，忽略 */ }
}

export const imageLabFeature = defineFeature<null>({
  id: "image-lab",
  inject: ["ipc", "host"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("image-lab: 缺少 ipc 服务（宿主未提供）");
    ipcHost.handle("image-lab:read", async (_event, input: { path?: string } = {}) => {
      const file = await resolveImagePath(String(input?.path ?? ""));
      const data = await fs.readFile(file);
      // Uint8Array 走结构化克隆直传（不转 base64 —— 图片转码白多 33% 内存）
      return { data: new Uint8Array(data), size: data.byteLength };
    });
    ctx.effect(() => {
      ipcHost.removeHandler("image-lab:read");
    });
  },
});
