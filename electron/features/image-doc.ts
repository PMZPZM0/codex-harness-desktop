/**
 * 域：image-doc（分层图像文档 · 2026-10-10 立项）
 * 通道：image-doc:open / image-doc:edit / image-doc:render
 *
 * **这是什么**：一个 AI 可推动的**分层图像文档引擎**。用户要的是「把 Compositor 那类能力
 * 做成双系统都能用、且全部由 AI 推动」。做法是抄它的**能力面与文档格式**（`.comp` 规格公开），
 * 不抄代码（Swift/SwiftUI/Metal 在 Electron 里跑不了）：
 *   · 我们写出的 `.comp` 能被 Compositor **直接打开继续精修**（macOS 26+ / Apple 芯片）；
 *   · Windows 上用我们自己的合成器 `image-doc:render` 出图 —— **同一份 manifest、同一套公式**。
 * ⇒ 用**格式**统一两端，而不是硬把 Swift 搬到 Windows（那等于从零重写一个编辑器）。
 *
 * ⛔ 与 image-lab 的分工（别混）：
 *   · image-lab = **单张位图的像素操作**（缩放/裁剪/调色/水印），输入输出都是一张图；
 *   · image-doc = **多图层文档**（图层栈/混合模式/变换/蒙版/调整图层），输入输出是一个 `.comp` 包。
 *   ⇒ "改一张已有的图"用 image_edit；"要把多张图叠成一张、要留图层以后再改"用 image-doc。
 * ⛔ 零凭证：三条通道都不读生图插件配置（只有 image-lab:generate 需要），没配 Key 也照样能用。
 * ⛔ 身份：通道由渲染层发起（引擎事件里带真实 threadId），不接受模型自报。
 */
import path from "node:path";
import fs from "node:fs/promises";
import { isInsideTrustedRoots } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { resolveImagePath } from "./image-lab";
import { renderDocument } from "./image-doc/render";
import {
  ADJUSTMENT_KINDS,
  BLEND_MODES,
  defaultTransform,
  hexToRgba,
  imagesDirOf,
  loadJimp,
  newLayerId,
  openCompDocument,
  parseManifest,
  pruneOrphanImages,
  readLayerImage,
  writeCompDocument,
  writeLayerImage,
  type Adjustment,
  type AdjustmentKind,
  type BlendMode,
  type CompManifest,
  type Layer,
  type Sampling,
} from "./image-doc/model";

/* ── 操作（判别联合）：与 image_edit 的 ops 同风格，模型一次调用可串多个 ────────────── */
export type DocOp =
  | { op: "add_layer"; path: string; name?: string; x?: number; y?: number; width?: number; height?: number; opacity?: number; blendMode?: string; rotation?: number }
  | { op: "set_layer"; id: string; name?: string; visible?: boolean; opacity?: number; blendMode?: string; x?: number; y?: number; width?: number; height?: number; rotation?: number; flipX?: boolean; flipY?: boolean; sampling?: string }
  | { op: "remove_layer"; id: string }
  | { op: "reorder"; id: string; to: number }
  | { op: "add_adjustment"; kind: string; name?: string; opacity?: number; [key: string]: unknown }
  | { op: "set_mask"; id: string; path?: string }
  | { op: "set_canvas"; width?: number; height?: number; background?: string };

type DocToolResult = { ok: boolean; output: string; error?: string };
const docFail = (error: string): DocToolResult => ({ ok: false, output: "", error });

const asBlend = (raw: unknown): BlendMode =>
  (BLEND_MODES as readonly string[]).includes(String(raw)) ? (String(raw) as BlendMode) : "Normal";
const asSampling = (raw: unknown): Sampling =>
  (["High quality", "Smooth", "Nearest"] as const).includes(String(raw) as Sampling) ? (String(raw) as Sampling) : "High quality";

/** 图层清单（给模型看的一行一层：序号 / id / 名字 / 类型 / 可见 / 不透明度 / 混合模式 / 位置尺寸）。 */
function describeLayers(manifest: CompManifest): string {
  if (!manifest.layers.length) return "（空文档，还没有图层）";
  return manifest.layers
    .map((layer, index) => {
      const kind = layer.adjustment ? `调整:${layer.adjustment.kind}` : "像素";
      const size = `${Math.round(layer.transform.size[0])}×${Math.round(layer.transform.size[1])}`;
      const at = `@${Math.round(layer.transform.origin[0])},${Math.round(layer.transform.origin[1])}`;
      const visible = layer.isVisible ? "" : "（隐藏）";
      const blend = layer.blendMode === "Normal" ? "" : ` ${layer.blendMode}`;
      const alpha = layer.opacity < 1 ? ` ${Math.round(layer.opacity * 100)}%` : "";
      return `${index + 1}. [${layer.id}] ${layer.name} · ${kind} · ${size}${at}${alpha}${blend}${visible}`;
    })
    .join("\n");
}

/* ── 各 op 的实现 ─────────────────────────────────────────────────────────────────── */
/** 把一张外部图片转成包内的 8bit RGBA PNG（规格硬要求）。 */
async function importImage(dir: string, rawPath: string): Promise<{ file: string; width: number; height: number }> {
  const source = await resolveImagePath(rawPath);
  const Jimp = await loadJimp();
  const image = await Jimp.read(source);
  const file = `${newLayerId()}.png`;
  await writeLayerImage(dir, file, await image.getBuffer("image/png"));
  return { file, width: image.bitmap.width, height: image.bitmap.height };
}

async function opAddLayer(dir: string, manifest: CompManifest, op: any): Promise<string> {
  const source = String(op?.path ?? "").trim();
  if (!source) throw new Error("add_layer 缺少 path（要加哪张图）");
  const { file, width, height } = await importImage(dir, source);
  const w = Math.max(1, Math.round(Number(op.width) || width));
  const h = Math.max(1, Math.round(Number(op.height) || height));
  const layer: Layer = {
    id: file.replace(/\.png$/, ""),
    name: String(op.name || path.basename(source, path.extname(source))).slice(0, 60),
    imageFile: file,
    isVisible: true,
    isGroup: false,
    opacity: Math.max(0, Math.min(1, Number(op.opacity ?? 1))),
    blendMode: asBlend(op.blendMode),
    transform: {
      ...defaultTransform(w, h),
      origin: [Math.round(Number(op.x ?? 0)), Math.round(Number(op.y ?? 0))],
      rotation: Number(op.rotation ?? 0),
      sampling: "High quality",
    },
  };
  manifest.layers.push(layer);
  manifest.activeLayerID = layer.id;
  return `加图层「${layer.name}」（${w}×${h}）`;
}

function opSetLayer(manifest: CompManifest, op: any): string {
  const layer = manifest.layers.find((l) => l.id === String(op?.id ?? ""));
  if (!layer) throw new Error(`没有 id 为 ${op?.id} 的图层（先调 image_doc_open 看清单）`);
  if (op.name !== undefined) layer.name = String(op.name).slice(0, 60);
  if (op.visible !== undefined) layer.isVisible = Boolean(op.visible);
  if (op.opacity !== undefined) layer.opacity = Math.max(0, Math.min(1, Number(op.opacity)));
  if (op.blendMode !== undefined) layer.blendMode = asBlend(op.blendMode);
  if (op.x !== undefined) layer.transform.origin[0] = Math.round(Number(op.x));
  if (op.y !== undefined) layer.transform.origin[1] = Math.round(Number(op.y));
  if (op.width !== undefined) layer.transform.size[0] = Math.max(1, Math.round(Number(op.width)));
  if (op.height !== undefined) layer.transform.size[1] = Math.max(1, Math.round(Number(op.height)));
  if (op.rotation !== undefined) layer.transform.rotation = Number(op.rotation);
  if (op.flipX !== undefined) layer.transform.flipX = Boolean(op.flipX);
  if (op.flipY !== undefined) layer.transform.flipY = Boolean(op.flipY);
  if (op.sampling !== undefined) layer.transform.sampling = asSampling(op.sampling);
  return `改图层「${layer.name}」`;
}

function opRemoveLayer(dir: string, manifest: CompManifest, op: any): string {
  const index = manifest.layers.findIndex((l) => l.id === String(op?.id ?? ""));
  if (index < 0) throw new Error(`没有 id 为 ${op?.id} 的图层`);
  const [removed] = manifest.layers.splice(index, 1);
  // 图片由 pruneOrphanImages 统一清理（manifest 不再引用就删），这里不直接删，避免误删蒙版复用
  void dir;
  return `删图层「${removed.name}」`;
}

function opReorder(manifest: CompManifest, op: any): string {
  const index = manifest.layers.findIndex((l) => l.id === String(op?.id ?? ""));
  if (index < 0) throw new Error(`没有 id 为 ${op?.id} 的图层`);
  const to = Math.max(0, Math.min(manifest.layers.length - 1, Math.floor(Number(op.to ?? index))));
  const [moved] = manifest.layers.splice(index, 1);
  manifest.layers.splice(to, 0, moved);
  return `把「${moved.name}」移到第 ${to + 1} 层`;
}

/** 调整图层：白名单收集已知参数，其余**原样透传**（Compositor 的字段比文档列的多，丢了会变形）。 */
function opAddAdjustment(manifest: CompManifest, op: any): string {
  const kind = String(op?.kind ?? "");
  if (!(ADJUSTMENT_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`不认识的调整类型：${kind}（可选：${ADJUSTMENT_KINDS.join(" / ")}）`);
  }
  const adjustment: Adjustment = { kind: kind as AdjustmentKind };
  const passthrough = [
    "hue", "saturation", "lightness", "colorize", "amount", "radius", "angle",
    "exposure", "offset", "gamma", "gradientStops", "colorBalanceSettings", "levels", "curves",
  ];
  for (const key of passthrough) if (op[key] !== undefined) (adjustment as Record<string, unknown>)[key] = op[key];
  const layer: Layer = {
    id: newLayerId(),
    name: String(op.name || kind).slice(0, 60),
    isVisible: true,
    isGroup: false,
    opacity: Math.max(0, Math.min(1, Number(op.opacity ?? 1))),
    blendMode: "Normal",
    transform: defaultTransform(manifest.width, manifest.height),
    adjustment,
  };
  manifest.layers.push(layer);
  manifest.activeLayerID = layer.id;
  return `加调整图层「${layer.name}」（作用于下方所有内容）`;
}

async function opSetMask(dir: string, manifest: CompManifest, op: any): Promise<string> {
  const layer = manifest.layers.find((l) => l.id === String(op?.id ?? ""));
  if (!layer) throw new Error(`没有 id 为 ${op?.id} 的图层`);
  const rawPath = String(op?.path ?? "").trim();
  if (!rawPath) {
    delete layer.maskFile;
    delete layer.maskEnabled;
    return `移除「${layer.name}」的蒙版`;
  }
  const { file } = await importImage(dir, rawPath);
  // 蒙版文件必须是 `<id>.mask.png`（规格按图层 id 命名）
  const maskFile = `${layer.id}.mask.png`;
  const Jimp = await loadJimp();
  const bytes = await readLayerImage(dir, file);
  if (bytes) {
    const image = await Jimp.read(bytes);
    image.greyscale(); // 蒙版是 8bit 灰度：白显黑隐
    await writeLayerImage(dir, maskFile, await image.getBuffer("image/png"));
    await fs.rm(path.join(imagesDirOf(dir), file), { force: true }).catch(() => undefined);
  }
  layer.maskFile = maskFile;
  layer.maskEnabled = true;
  return `给「${layer.name}」加蒙版`;
}

async function opSetCanvas(dir: string, manifest: CompManifest, op: any): Promise<string> {
  const width = Math.max(1, Math.round(Number(op?.width ?? manifest.width)));
  const height = Math.max(1, Math.round(Number(op?.height ?? manifest.height)));
  const changed = width !== manifest.width || height !== manifest.height;
  manifest.width = width;
  manifest.height = height;
  let note = changed ? `画布改为 ${width}×${height}` : "画布尺寸未变";
  if (op?.background) {
    const rgba = hexToRgba(op.background);
    const Jimp = await loadJimp();
    const file = `${newLayerId()}.png`;
    const solid = new Jimp({ width, height, color: ((rgba[0] << 24) | (rgba[1] << 16) | (rgba[2] << 8) | rgba[3]) >>> 0 });
    await writeLayerImage(dir, file, await solid.getBuffer("image/png"));
    manifest.layers.unshift({
      id: file.replace(/\.png$/, ""),
      name: "背景",
      imageFile: file,
      isVisible: true,
      isGroup: false,
      opacity: 1,
      blendMode: "Normal",
      transform: defaultTransform(width, height),
    });
    note += "，并垫了一层背景";
  }
  return note;
}

/** 逐条应用 ops（顺序即语义）。⛔ 未知 op 明确报错，不静默跳过。 */
async function applyDocOps(dir: string, manifest: CompManifest, ops: DocOp[]): Promise<string[]> {
  const notes: string[] = [];
  for (const raw of ops) {
    const op = raw as any;
    switch (op.op) {
      case "add_layer":
        notes.push(await opAddLayer(dir, manifest, op));
        break;
      case "set_layer":
        notes.push(opSetLayer(manifest, op));
        break;
      case "remove_layer":
        notes.push(opRemoveLayer(dir, manifest, op));
        break;
      case "reorder":
        notes.push(opReorder(manifest, op));
        break;
      case "add_adjustment":
        notes.push(opAddAdjustment(manifest, op));
        break;
      case "set_mask":
        notes.push(await opSetMask(dir, manifest, op));
        break;
      case "set_canvas":
        notes.push(await opSetCanvas(dir, manifest, op));
        break;
      default:
        throw new Error(`不认识的文档操作：${String(op.op)}`);
    }
  }
  return notes;
}

/* ── 域 ───────────────────────────────────────────────────────────────────────────── */
export const imageDocFeature = defineFeature<null>({
  id: "image-doc",
  inject: ["ipc", "host"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("image-doc: 缺少 ipc 服务（宿主未提供）");

    /* 打开 / 新建文档 → 返回图层清单 */
    ipcHost.handle("image-doc:open", async (_event, input: {
      dir?: string; width?: number; height?: number; background?: string;
    } = {}): Promise<DocToolResult> => {
      try {
        const dir = String(input?.dir ?? "").trim();
        if (!dir) return docFail("缺少 dir（.comp 项目目录路径）");
        const doc = await openCompDocument({
          dir,
          width: input?.width !== undefined ? Number(input.width) : undefined,
          height: input?.height !== undefined ? Number(input.height) : undefined,
          background: input?.background ? String(input.background) : undefined,
        });
        return {
          ok: true,
          output: `文档 ${doc.dir}：${doc.manifest.width}×${doc.manifest.height}，${doc.manifest.layers.length} 个图层\n${describeLayers(doc.manifest)}`,
        };
      } catch (error) {
        return docFail(`打开文档失败：${String((error as Error)?.message ?? error)}`);
      }
    });

    /* 改结构并落盘（每次都写 manifest —— Compositor 开着就会自动重载） */
    ipcHost.handle("image-doc:edit", async (_event, input: {
      dir?: string; ops?: DocOp[];
    } = {}): Promise<DocToolResult> => {
      try {
        const dir = String(input?.dir ?? "").trim();
        if (!dir) return docFail("缺少 dir（.comp 项目目录路径）");
        const ops = Array.isArray(input?.ops) ? (input.ops as DocOp[]) : [];
        if (!ops.length) return docFail("ops 为空：没说要改什么");
        const doc = await openCompDocument({ dir });
        const notes = await applyDocOps(doc.dir, doc.manifest, ops);
        await writeCompDocument(doc);
        await pruneOrphanImages(doc);
        return {
          ok: true,
          output: `${notes.join("；")}\n当前 ${doc.manifest.layers.length} 个图层：\n${describeLayers(doc.manifest)}`,
        };
      } catch (error) {
        return docFail(`编辑文档失败：${String((error as Error)?.message ?? error)}`);
      }
    });

    /* 合成出图（Windows 上的产物；Mac 上可以直接在 Compositor 里继续改） */
    ipcHost.handle("image-doc:render", async (_event, input: {
      dir?: string; output?: string; format?: "png" | "jpeg" | "bmp" | "tiff"; quality?: number;
    } = {}): Promise<DocToolResult> => {
      try {
        const dir = String(input?.dir ?? "").trim();
        if (!dir) return docFail("缺少 dir（.comp 项目目录路径）");
        const doc = await openCompDocument({ dir });
        const result = await renderDocument(doc, {
          format: input?.format,
          quality: input?.quality !== undefined ? Number(input.quality) : undefined,
        });
        const ext = input?.format === "jpeg" ? ".jpg" : `.${input?.format ?? "png"}`;
        const dest = input?.output
          ? path.resolve(String(input.output))
          : path.join(path.dirname(doc.dir), `${path.basename(doc.dir, ".comp")}-render${ext}`);
        // ⛔ 输出同样过可信根闸：工具能写文件，闸口与读同宽
        if (!isInsideTrustedRoots(dest)) throw new Error("输出路径不在可信目录内（会话工作目录 / 应用数据目录）");
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, result.buffer);
        return {
          ok: true,
          output: `已合成 ${result.layers} 个图层，产出：${dest}（${result.width}×${result.height}，${Math.round(result.buffer.length / 1024)}KB）`,
        };
      } catch (error) {
        return docFail(`合成失败：${String((error as Error)?.message ?? error)}`);
      }
    });

    ctx.effect(() => {
      for (const ch of ["image-doc:open", "image-doc:edit", "image-doc:render"]) ipcHost.removeHandler(ch);
    });
  },
});

// 让预检能直接校验 manifest 解析（无需起应用）
export { parseManifest };
