// 应用壁纸配置（2026-10-05，外观设置「壁纸」段的数据面 —— 纯函数、可守卫）。
// 持久化走 localStorage（与主题同机制）；跨组件通知走 CustomEvent + storage 事件。
// ⛔ 颜色不落配置：图案层用 mask + background-color: var(--accent)（token 上色，守卫【170】同源）。

export const WALLPAPER_KEY = "wallpaper";
export const WALLPAPER_EVENT = "wallpaper-change";
export const WALLPAPER_MODES = ["off", "pattern", "particles", "vanta", "custom"];

/* ── 图案库（原创几何，hero-patterns 风格）────────────────────────
   ⛔ 瓷砖一律 48px：24px 的小瓷砖铺出来密密麻麻像噪点（10-05 首版实测「都不好看」的主因），
   大瓷砖 + 细线条才是现代感。SVG 走 mask（alpha 即形状），颜色由层 background-color 提供。 */
function tileFill(inner, size) {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><g fill="#fff">${inner}</g></svg>`)}`;
}
function tileStroke(paths, size, width) {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><g fill="none" stroke="#fff" stroke-width="${width ?? 1.2}">${paths}</g></svg>`)}`;
}

export const WALLPAPER_PATTERNS = [
  { id: "dots", name: "圆点", tile: tileFill('<circle cx="14" cy="14" r="3"/><circle cx="38" cy="38" r="1.6" opacity="0.55"/>', 48) },
  { id: "scatter", name: "疏星", tile: tileFill('<circle cx="12" cy="10" r="2"/><circle cx="34" cy="26" r="1.4" opacity="0.5"/><circle cx="24" cy="42" r="1.1" opacity="0.35"/>', 48) },
  { id: "grid", name: "网格", tile: tileStroke('<path d="M0 .6H48M.6 0V48"/>', 48) },
  { id: "blueprint", name: "蓝图", tile: tileStroke('<path d="M0 .6H48M.6 0V48"/><circle cx="24" cy="24" r="10"/>', 48) },
  { id: "waves", name: "波浪", tile: tileStroke('<path d="M0 16c8-10 16-10 24 0s16 10 24 0M0 40c8-10 16-10 24 0s16 10 24 0"/>', 48) },
  { id: "zigzag", name: "折线", tile: tileStroke('<path d="M0 18l12-12 12 12 12-12 12 12v10l-12 12-12-12-12 12-12-12z"/>', 48) },
  { id: "diagonal", name: "斜纹", tile: tileStroke('<path d="M-12 12L12-12M0 24L24 0M12 36L36 12M24 48L48 24M36 60L60 36"/>', 48) },
  { id: "plus", name: "十字", tile: tileStroke('<path d="M14 20h20M24 10v20"/>', 48) },
  { id: "rings", name: "环纹", tile: tileStroke('<circle cx="0" cy="0" r="14"/><circle cx="48" cy="0" r="14"/><circle cx="0" cy="48" r="14"/><circle cx="48" cy="48" r="14"/>', 48) },
  { id: "topo", name: "等高线", tile: tileStroke('<path d="M4 34c10-14 30-14 40-2M10 44c12-10 22-4 30-10M0 16c14-10 30 6 48-8"/>', 48) },
];

/* ── 精选渐变壁纸（自定义图档的内置款）────────────────────────
   mesh-gradient 风格：多层 radial-gradient 叠加 + CSS 类里再叠一层噪点（feTurbulence data-uri）。
   ⛔ 配色是刻意的艺术选择，不跟主题 token —— 「好看」本身就是这档的卖点；文字可读性由
   设置页缩略图与层上的半透明遮罩保证（浅色系自带白雾、深色系自带深雾，见 28-wallpaper.css）。 */
export const WALLPAPER_PRESETS = [
  {
    id: "sunrise", name: "霞光",
    css: "radial-gradient(at 18% 22%, #ffd9c0 0px, transparent 55%), radial-gradient(at 82% 18%, #ffb3a7 0px, transparent 50%), radial-gradient(at 70% 80%, #f7a6c1 0px, transparent 55%), radial-gradient(at 25% 85%, #ffe9b8 0px, transparent 50%), linear-gradient(135deg, #fff7ef, #fde8dd)",
  },
  {
    id: "mint", name: "青柠",
    css: "radial-gradient(at 20% 25%, #d8f3dc 0px, transparent 55%), radial-gradient(at 80% 20%, #b7e4c7 0px, transparent 50%), radial-gradient(at 75% 78%, #95d5b2 0px, transparent 55%), radial-gradient(at 20% 80%, #e9f5db 0px, transparent 50%), linear-gradient(135deg, #f6fbf4, #dcf2e3)",
  },
  {
    id: "dusk", name: "暮紫",
    css: "radial-gradient(at 22% 20%, #e0c3fc 0px, transparent 55%), radial-gradient(at 78% 25%, #c3a6f2 0px, transparent 50%), radial-gradient(at 72% 78%, #f0c3e8 0px, transparent 55%), radial-gradient(at 25% 82%, #d9c7ff 0px, transparent 50%), linear-gradient(135deg, #f7f2fb, #e8dcf7)",
  },
  {
    id: "ocean", name: "深海",
    css: "radial-gradient(at 20% 25%, #123b5c 0px, transparent 55%), radial-gradient(at 80% 20%, #0b6e8f 0px, transparent 50%), radial-gradient(at 75% 80%, #0a2f4f 0px, transparent 55%), radial-gradient(at 25% 85%, #0d7a9e 0px, transparent 45%), linear-gradient(135deg, #081c30, #06263e)",
  },
  {
    id: "graphite", name: "墨石",
    css: "radial-gradient(at 22% 22%, #3a3f47 0px, transparent 55%), radial-gradient(at 80% 18%, #2b3038 0px, transparent 50%), radial-gradient(at 72% 80%, #454b54 0px, transparent 55%), radial-gradient(at 25% 85%, #1f242b 0px, transparent 50%), linear-gradient(135deg, #1c2127, #262c33)",
  },
  {
    id: "ember", name: "余烬",
    css: "radial-gradient(at 20% 25%, #5c2e3e 0px, transparent 55%), radial-gradient(at 80% 20%, #7a3b4f 0px, transparent 50%), radial-gradient(at 75% 80%, #b4566b 0px, transparent 45%), radial-gradient(at 28% 82%, #40222e 0px, transparent 50%), linear-gradient(135deg, #2a1620, #3d1f2a)",
  },
];

export function presetById(id) {
  return WALLPAPER_PRESETS.find((p) => p.id === id) ?? null;
}

/** 图片字段的取值可以是 `preset:<id>`（内置精选）或本地绝对路径（harness-image 显示）。 */
export function isPresetImage(image) {
  return typeof image === "string" && image.startsWith("preset:");
}

export function normalizeWallpaper(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const mode = WALLPAPER_MODES.includes(r.mode) ? r.mode : "off";
  const pattern = WALLPAPER_PATTERNS.some((p) => p.id === r.pattern) ? r.pattern : "dots";
  const opacityNum = Number(r.opacity);
  const opacity = Number.isFinite(opacityNum) ? Math.min(40, Math.max(2, Math.round(opacityNum))) : 16;
  const image = typeof r.image === "string" ? r.image : "";
  return { mode, pattern, opacity, image };
}

export function readWallpaper() {
  try {
    return normalizeWallpaper(JSON.parse(localStorage.getItem(WALLPAPER_KEY) ?? ""));
  } catch {
    return normalizeWallpaper(null);
  }
}

export function saveWallpaper(next) {
  const cfg = normalizeWallpaper(next);
  localStorage.setItem(WALLPAPER_KEY, JSON.stringify(cfg));
  window.dispatchEvent(new CustomEvent(WALLPAPER_EVENT));
  return cfg;
}

export function subscribeWallpaper(onChange) {
  const handler = () => onChange(readWallpaper());
  window.addEventListener(WALLPAPER_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(WALLPAPER_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export function patternMask(patternId) {
  const p = WALLPAPER_PATTERNS.find((x) => x.id === patternId) ?? WALLPAPER_PATTERNS[0];
  return `url("${p.tile}")`;
}
