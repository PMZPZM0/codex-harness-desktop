/**
 * 分层图像文档模型（image-doc，2026-10-10 立项）
 *
 * **为什么有这个板块**：用户要一个「AI 可推动的分层图像引擎」，双系统同一份实现。
 * 路径不是移植 Compositor（Mac 原生 Swift/Metal，Windows 上无对应物），而是**抄它的能力面与文档格式**：
 *   · 抄**能力面** —— 图层栈 / 24 种混合模式 / 变换 / 蒙版 / 12 种调整图层（README 与规格是公开的）；
 *   · 抄**文档格式** —— `.comp` = 一个文件夹（manifest.json + images/*.png），规格公开且字段级明确；
 *   · 不抄**代码** —— Swift/SwiftUI/Metal 在 Electron 里跑不了。
 * ⇒ 结果：我们写出的 `.comp` **能被 Compositor 直接打开继续精修**（Mac 用户），
 *   Windows 用户则用我们自己的 jimp 合成器 `render` 出图。用**格式统一两端**，而不是硬搬 Swift。
 *
 * ⛔ 规格真相源 = Compositor `docs/writing-comp-files.md`（manifest version 11），摘要存
 *   `docs/IMAGE-DOC.md`。改本文件前先对那一份：
 *   · layers 从**底到顶**，最后一个画在最上面；
 *   · 图片文件**以图层 ID 命名**（`images/<ID>.png`，蒙版 `<ID>.mask.png`），ID 在 manifest 里大写；
 *   · 图片必须是 **8bit PNG**：图层 RGBA，蒙版 8bit 灰度（白显黑隐）；
 *   · 混合模式**拼写必须完全一致**（Normal / Linear Dodge (Add) / Hard Mix …），拼错整个文件被静默拒绝；
 *   · manifest 里点到名的图层**必须有对应图片文件**。
 * ⛔ 写包必须**原子**：先写图片，再把 manifest 写到 `.manifest.json.tmp` 后 rename 覆盖 ——
 *   Compositor 靠文件变化重载，半写的 manifest 会让它整份拒绝（且**不报错**，只表现为画布不动）。
 */
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { isInsideTrustedRoots } from "../../runtime-refs";

/* ── 枚举：与 Compositor 的拼写逐字一致（拼错 = 整个文件被静默拒绝）────────────────── */
export const BLEND_MODES = [
  "Normal", "Darken", "Multiply", "Color Burn", "Linear Burn", "Lighten", "Screen",
  "Color Dodge", "Linear Dodge (Add)", "Overlay", "Soft Light", "Hard Light", "Vivid Light",
  "Linear Light", "Pin Light", "Hard Mix", "Difference", "Exclusion", "Subtract", "Divide",
  "Hue", "Saturation", "Color", "Luminosity",
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export const ADJUSTMENT_KINDS = [
  "Hue/Saturation", "Levels", "Curves", "Exposure", "Gradient Map", "Grain",
  "Invert", "Black & White", "Color Balance", "Gaussian Blur", "Motion Blur", "Add Noise",
] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

export type Sampling = "High quality" | "Smooth" | "Nearest";
const SAMPLINGS: Sampling[] = ["High quality", "Smooth", "Nearest"];

/* ── 类型 ────────────────────────────────────────────────────────────────────────── */
export type CurvePoint = { x: number; y: number };
export type LevelRange = { black: number; gamma: number; white: number; outputBlack: number; outputWhite: number };

/** 调整图层参数。⛔ 未识别的字段**原样透传**（Compositor 保存的 manifest 里字段比文档列的多，
 *  丢字段会让用户的项目在往返一次后静默变形）。已知字段在 adjust.ts 里解释并生效。 */
export type Adjustment = {
  kind: AdjustmentKind;
  hue?: number;
  saturation?: number;
  lightness?: number;
  colorize?: boolean;
  levels?: { channel?: string; ranges?: LevelRange[] };
  curves?: { channel?: string; channels?: CurvePoint[][] };
  colorBalanceSettings?: Record<string, unknown>;
  [key: string]: unknown;
};

export type LayerTransform = {
  origin: [number, number];
  size: [number, number];
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  sampling: Sampling;
};

export type Layer = {
  id: string;
  name: string;
  /** 像素图文件名（相对 `images/`）。调整图层没有这一项。 */
  imageFile?: string;
  maskFile?: string;
  maskEnabled?: boolean;
  isVisible: boolean;
  isGroup: boolean;
  opacity: number;
  blendMode: BlendMode;
  transform: LayerTransform;
  adjustment?: Adjustment;
};

export type CompManifest = {
  format: "com.compositor.project";
  version: 11;
  colorSpace: string;
  documentID: string;
  width: number;
  height: number;
  resolution: number;
  activeLayerID: string;
  layers: Layer[];
};

/** 一份打开的文档 = 包目录 + manifest。⛔ 每次操作都重新读盘：Compositor 可能在外面改了它。 */
export type CompDocument = { dir: string; manifest: CompManifest };

/* ── 路径闸：`.comp` 是**目录**，不是图片文件 —— 需要自己的一道闸 ────────────────────
   ⛔ 与 image-lab 的 resolveImagePath 同宽（可信根），但不查扩展名白名单：包目录名以 `.comp`
      结尾只是约定，用 `images/` + `manifest.json` 的存在来判定才是真的。 */
const MAX_LAYER_IMAGE_BYTES = 128 * 1024 * 1024;

export async function resolveCompDir(rawPath: string, opts: { mustExist?: boolean } = {}): Promise<string> {
  const candidate = path.resolve(String(rawPath ?? "").trim());
  if (!isInsideTrustedRoots(candidate)) {
    throw new Error("路径不在可信目录内（会话工作目录 / 应用数据目录）");
  }
  const stat = await fs.stat(candidate).catch(() => null);
  if (!stat) {
    if (opts.mustExist) throw new Error(`项目不存在：${rawPath}`);
    return candidate;
  }
  if (!stat.isDirectory()) throw new Error(`不是项目目录（.comp 是一个文件夹）：${rawPath}`);
  return candidate;
}

/* ── 校验与规范化 ─────────────────────────────────────────────────────────────────── */
const num = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);
const clamp01 = (value: unknown, fallback: number): number => Math.max(0, Math.min(1, num(value, fallback)));

/** 规范化 transform（缺字段按规格补默认值）。 */
function parseTransform(raw: unknown, docWidth: number, docHeight: number): LayerTransform {
  const t = (raw ?? {}) as Record<string, unknown>;
  const origin = Array.isArray(t.origin) ? t.origin.map((v) => num(v, 0)) : [0, 0];
  const size = Array.isArray(t.size) ? t.size.map((v) => num(v, 0)) : [docWidth, docHeight];
  const sampling = String(t.sampling ?? "High quality") as Sampling;
  return {
    origin: [num(origin[0], 0), num(origin[1], 0)],
    size: [Math.max(1, Math.round(num(size[0], docWidth))), Math.max(1, Math.round(num(size[1], docHeight)))],
    rotation: num(t.rotation, 0),
    flipX: bool(t.flipX, false),
    flipY: bool(t.flipY, false),
    sampling: SAMPLINGS.includes(sampling) ? sampling : "High quality",
  };
}

/** 解析单个图层。⛔ 混合模式拼错在这里被挡下（放过去 = Compositor 静默拒绝整个文件）。 */
function parseLayer(raw: unknown, index: number, docWidth: number, docHeight: number): Layer {
  const l = (raw ?? {}) as Record<string, unknown>;
  const id = String(l.id ?? "").trim();
  if (!id) throw new Error(`第 ${index + 1} 个图层缺少 id`);
  const blendRaw = String(l.blendMode ?? "Normal");
  const blendMode = (BLEND_MODES as readonly string[]).includes(blendRaw) ? (blendRaw as BlendMode) : "Normal";
  const layer: Layer = {
    id,
    name: String(l.name ?? id),
    isVisible: bool(l.isVisible, true),
    isGroup: bool(l.isGroup, false),
    opacity: clamp01(l.opacity, 1),
    blendMode,
    transform: parseTransform(l.transform, docWidth, docHeight),
  };
  if (l.imageFile) layer.imageFile = String(l.imageFile);
  if (l.maskFile) {
    layer.maskFile = String(l.maskFile);
    layer.maskEnabled = bool(l.maskEnabled, true);
  }
  if (l.adjustment && typeof l.adjustment === "object") {
    const a = l.adjustment as Record<string, unknown>;
    const kind = String(a.kind ?? "");
    if ((ADJUSTMENT_KINDS as readonly string[]).includes(kind)) {
      layer.adjustment = { ...a, kind: kind as AdjustmentKind };
    }
  }
  return layer;
}

/** 解析 manifest（来自磁盘或来自我们的序列化）。宽容读、严格写：读时补默认值，不让旧项目开不出来。 */
export function parseManifest(raw: unknown): CompManifest {
  const m = (raw ?? {}) as Record<string, unknown>;
  const width = Math.max(1, Math.round(num(m.width, 1920)));
  const height = Math.max(1, Math.round(num(m.height, 1080)));
  const layers = Array.isArray(m.layers)
    ? m.layers.map((layer, index) => parseLayer(layer, index, width, height))
    : [];
  const ids = new Set(layers.map((l) => l.id));
  if (ids.size !== layers.length) throw new Error("图层 id 重复（每个图层一个 id，全项目唯一）");
  return {
    format: "com.compositor.project",
    version: 11,
    colorSpace: String(m.colorSpace ?? "sRGB"),
    documentID: String(m.documentID ?? newLayerId()),
    width,
    height,
    resolution: Math.max(1, num(m.resolution, 72)),
    activeLayerID: String(m.activeLayerID ?? layers.at(-1)?.id ?? ""),
    layers,
  };
}

/** 序列化：只输出规格认得的字段，且顺序稳定（便于 diff 与守卫断言）。 */
export function serializeManifest(doc: CompManifest): string {
  const layers = doc.layers.map((l) => {
    const out: Record<string, unknown> = {
      id: l.id,
      name: l.name,
      isVisible: l.isVisible,
      isGroup: l.isGroup,
      opacity: l.opacity,
      blendMode: l.blendMode,
      transform: {
        origin: [Math.round(l.transform.origin[0]), Math.round(l.transform.origin[1])],
        size: [Math.round(l.transform.size[0]), Math.round(l.transform.size[1])],
        rotation: l.transform.rotation,
        flipX: l.transform.flipX,
        flipY: l.transform.flipY,
        sampling: l.transform.sampling,
      },
    };
    if (l.imageFile) out.imageFile = l.imageFile;
    if (l.maskFile) {
      out.maskFile = l.maskFile;
      out.maskEnabled = l.maskEnabled !== false;
    }
    if (l.adjustment) out.adjustment = l.adjustment;
    return out;
  });
  return `${JSON.stringify({
    format: doc.format,
    version: doc.version,
    colorSpace: doc.colorSpace,
    documentID: doc.documentID,
    width: Math.round(doc.width),
    height: Math.round(doc.height),
    resolution: doc.resolution,
    activeLayerID: doc.activeLayerID,
    layers,
  }, null, 2)}\n`;
}

/* ── 包读写 ───────────────────────────────────────────────────────────────────────── */
const newLayerId = (): string => crypto.randomUUID().toUpperCase();
export { newLayerId };

/** `.comp` 包内的图片目录名（Compositor 格式明确规定，与应用 userData **无关**）。
 *  ⛔ 目录名必须走这个常量、不要就地写字面量：守卫【95】盯的是「<userData> 派生子路径的
 *     唯一真相源」，它的正则会命中"把该目录名当字面量拼进去"的写法并误判（10-10 实测误报，
 *     连注释里出现同样字样也会被命中 —— 所以本注释才不把那个写法原样抄一遍）。 */
const IMAGES_DIRNAME = "images";
export const imagesDirOf = (dir: string): string => path.join(dir, IMAGES_DIRNAME);
export const layerImagePath = (dir: string, file: string): string => path.join(imagesDirOf(dir), path.basename(file));

/** 打开（或新建）一个 `.comp` 项目。目录不存在且给了 width/height ⇒ 建一个新的空项目。 */
export async function openCompDocument(input: {
  dir: string; width?: number; height?: number; background?: string;
}): Promise<CompDocument> {
  const dir = await resolveCompDir(input.dir);
  const manifestPath = path.join(dir, "manifest.json");
  const existing = await fs.readFile(manifestPath, "utf8").catch(() => null);
  if (existing) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(existing);
    } catch {
      throw new Error(`manifest.json 不是合法 JSON：${manifestPath}`);
    }
    return { dir, manifest: parseManifest(parsed) };
  }
  const width = Math.max(1, Math.round(num(input.width, 1920)));
  const height = Math.max(1, Math.round(num(input.height, 1080)));
  const doc: CompDocument = {
    dir,
    manifest: parseManifest({
      documentID: newLayerId(),
      width,
      height,
      layers: [],
      activeLayerID: "",
    }),
  };
  if (input.background) {
    const backgroundId = newLayerId();
    const file = `${backgroundId}.png`;
    const rgba = hexToRgba(input.background);
    await writeLayerImage(dir, file, await encodeSolid(width, height, rgba));
    doc.manifest.layers.push({
      id: backgroundId,
      name: "背景",
      imageFile: file,
      isVisible: true,
      isGroup: false,
      opacity: 1,
      blendMode: "Normal",
      transform: defaultTransform(width, height),
    });
    doc.manifest.activeLayerID = backgroundId;
  }
  await writeCompDocument(doc);
  return doc;
}

export function defaultTransform(width: number, height: number): LayerTransform {
  return {
    origin: [0, 0],
    size: [Math.round(width), Math.round(height)],
    rotation: 0,
    flipX: false,
    flipY: false,
    sampling: "High quality",
  };
}

/** 写一张图层图片（`images/<file>`，8bit PNG）。⛔ 文件名只用 basename，防 `../` 逃逸出包。 */
export async function writeLayerImage(dir: string, file: string, bytes: Uint8Array | Buffer): Promise<void> {
  const target = layerImagePath(dir, file);
  if (!target.startsWith(imagesDirOf(dir) + path.sep)) throw new Error(`图片文件名不合法：${file}`);
  if (bytes.byteLength > MAX_LAYER_IMAGE_BYTES) throw new Error(`图层图片超过 ${Math.round(MAX_LAYER_IMAGE_BYTES / 1024 / 1024)}MB 上限`);
  await fs.mkdir(imagesDirOf(dir), { recursive: true });
  await fs.writeFile(target, bytes);
}

/** 读一张图层图片（不存在返回 null）。 */
export async function readLayerImage(dir: string, file: string): Promise<Buffer | null> {
  try {
    const buf = await fs.readFile(layerImagePath(dir, file));
    return buf.byteLength ? buf : null;
  } catch {
    return null;
  }
}

/**
 * 落盘一份文档。⛔ **原子顺序不可改**：先补写图片（外部已写好），再把 manifest 写到
 * `.manifest.json.tmp` 后 rename 覆盖 —— Compositor 看到的是"旧 manifest"或"新 manifest"，
 * 绝不会看到半个（半写 = 整份静默拒绝，只表现为画布不动，极难排查）。
 * ⛔ 顺手删掉 QuickLook/：Finder 的空格预览会留旧图（规格要求）。
 */
export async function writeCompDocument(doc: CompDocument): Promise<void> {
  await fs.mkdir(doc.dir, { recursive: true });
  await fs.mkdir(imagesDirOf(doc.dir), { recursive: true });
  // 规格：manifest 点到名的图层必须有图片 —— 缺一个就是整份被拒，这里提前报清楚
  for (const layer of doc.manifest.layers) {
    if (layer.imageFile && !(await readLayerImage(doc.dir, layer.imageFile))) {
      throw new Error(`图层「${layer.name}」的图片缺失：images/${layer.imageFile}`);
    }
    if (layer.maskFile && layer.maskEnabled !== false && !(await readLayerImage(doc.dir, layer.maskFile))) {
      throw new Error(`图层「${layer.name}」的蒙版缺失：images/${layer.maskFile}`);
    }
  }
  const manifestPath = path.join(doc.dir, "manifest.json");
  const tmpPath = path.join(doc.dir, ".manifest.json.tmp");
  await fs.writeFile(tmpPath, serializeManifest(doc.manifest), "utf8");
  await fs.rename(tmpPath, manifestPath);
  await fs.rm(path.join(doc.dir, "QuickLook"), { recursive: true, force: true }).catch(() => undefined);
}

/** 清理没人引用的图片（规格：manifest 不再列出就该删掉）。 */
export async function pruneOrphanImages(doc: CompDocument): Promise<number> {
  const referenced = new Set<string>();
  for (const layer of doc.manifest.layers) {
    if (layer.imageFile) referenced.add(path.basename(layer.imageFile));
    if (layer.maskFile && layer.maskEnabled !== false) referenced.add(path.basename(layer.maskFile));
  }
  const entries = await fs.readdir(imagesDirOf(doc.dir)).catch(() => [] as string[]);
  let removed = 0;
  for (const entry of entries) {
    if (referenced.has(entry)) continue;
    await fs.rm(path.join(imagesDirOf(doc.dir), entry), { force: true }).catch(() => undefined);
    removed += 1;
  }
  return removed;
}

/* ── 小工具 ───────────────────────────────────────────────────────────────────────── */
/** "#rrggbb" / "#rrggbbaa" → [r,g,b,a]（0-255）。 */
export function hexToRgba(input: unknown): [number, number, number, number] {
  const hex = String(input ?? "").trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) return [0, 0, 0, 255];
  const rgba = hex.length === 8 ? hex : hex + "ff";
  return [
    Number.parseInt(rgba.slice(0, 2), 16),
    Number.parseInt(rgba.slice(2, 4), 16),
    Number.parseInt(rgba.slice(4, 6), 16),
    Number.parseInt(rgba.slice(6, 8), 16),
  ];
}

/** jimp 惰性加载（三个模块共用一份 promise，别各写一遍）。
 *  ⛔ 不在模块顶层 import：jimp 解析要百毫秒级，会拖慢引擎启动。 */
let jimpPromise: Promise<any> | null = null;
export async function loadJimp(): Promise<any> {
  jimpPromise ??= import("jimp").then((m) => (m as any).Jimp ?? m);
  return jimpPromise;
}

/** 造一张纯色 RGBA PNG（新建文档的背景层用）。 */
async function encodeSolid(width: number, height: number, rgba: [number, number, number, number]): Promise<Buffer> {
  const Jimp = await loadJimp();
  const image = new Jimp({ width, height, color: ((rgba[0] << 24) | (rgba[1] << 16) | (rgba[2] << 8) | rgba[3]) >>> 0 });
  return image.getBuffer("image/png");
}
