/**
 * Craft App 的「按格式用对应软件打开」目录（11-16）。
 *
 * ⛔ 单一真相源：文件卡菜单（`FileCardMenu`）与媒体产物卡（`TurnMediaCards`）都读这一份。
 * ⛔ 只写各 App 官方文档里确认过的格式；没把握的（如 MaterialCraft / Craft Anything）不列。
 * ⛔ 顺序即优先级：同一个扩展名命中多个 App 时，先列出的先显示（最多展示 3 个）。
 */

/** 打开器目录：id 与 Launcher 安装目录归一化后的 id 一致。 */
export const CRAFT_OPENERS = [
  { id: "pdfcraft", name: "PdfCraft", extensions: ["pdf"] },
  { id: "wordcraft", name: "WordCraft", extensions: ["docx", "doc", "odt", "rtf", "html", "htm", "md", "tex", "txt", "pdf"] },
  { id: "gridcraft", name: "GridCraft", extensions: ["xlsx", "xls", "csv", "tsv"] },
  { id: "deckcraft", name: "DeckCraft", extensions: ["pptx", "deckcraft", "pdf", "png", "jpg", "jpeg", "gif"] },
  { id: "vectorcraft", name: "VectorCraft", extensions: ["svg", "pdf", "png", "jpg", "jpeg", "webp"] },
  { id: "figcraft", name: "FigCraft", extensions: ["figcraft", "fig", "svg", "png", "jpg", "jpeg", "webp", "pdf"] },
  { id: "cadcraft", name: "CADCraft", extensions: ["dxf", "dwg", "dwt", "svg", "png", "pdf"] },
  { id: "designcraft", name: "DesignCraft", extensions: ["designcraft", "png", "pdf"] },
  { id: "solidcraft", name: "SolidCraft", extensions: ["step", "stp", "iges", "igs", "3mf", "stl", "obj", "gltf", "glb"] },
  { id: "mailcraft", name: "MailCraft", extensions: ["eml", "mbox", "ics", "vcf", "pst"] },
  { id: "photocraft", name: "PhotoCraft", extensions: ["png", "jpg", "jpeg", "webp", "tif", "tiff", "psd", "psb", "bmp"] },
  { id: "lightcraft", name: "LightCraft", extensions: ["dng", "cr2", "arw", "nef", "raf", "rw2", "pef", "orf", "jpg", "jpeg", "tif", "tiff"] },
  { id: "texturecraft", name: "TextureCraft", extensions: ["png", "tif", "tiff", "jpg", "jpeg", "exr"] },
  { id: "filmcraft", name: "FilmCraft", extensions: ["mp4", "mov", "mkv", "webm", "m4v"] },
  { id: "effectcraft", name: "EffectCraft", extensions: ["mp4", "mov", "png", "tif", "exr", "gif"] },
  { id: "anicraft", name: "AniCraft", extensions: ["fla", "xfl", "svg", "gif", "mp4", "webm", "png"] },
  { id: "soundcraft", name: "SoundCraft", extensions: ["wav", "mp3", "flac", "ogg", "aif", "aiff"] },
];

/** 取路径扩展名（小写；无扩展名返回空串）。 */
export function craftFileExtension(filePath) {
  const name = String(filePath ?? "").split(/[\\/]/).pop() ?? "";
  const at = name.lastIndexOf(".");
  return at > 0 ? name.slice(at + 1).toLowerCase() : "";
}

/**
 * 某个文件可以用哪些**已安装**的 Craft App 打开（按优先级去重）。
 * @param {string} filePath
 * @param {Iterable<string>} installedIds 已安装 App 的归一化 id
 * @param {{ limit?: number }} [options]
 * @returns {Array<{ id: string; name: string }>}
 */
export function craftOpenersFor(filePath, installedIds, options = {}) {
  const ext = craftFileExtension(filePath);
  if (!ext) return [];
  const installed = new Set([...installedIds].map((id) => String(id ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")));
  const limit = Math.max(1, Math.min(6, Number(options.limit) || 3));
  const out = [];
  for (const opener of CRAFT_OPENERS) {
    if (!installed.has(opener.id) || !opener.extensions.includes(ext)) continue;
    out.push({ id: opener.id, name: opener.name });
    if (out.length >= limit) break;
  }
  return out;
}
