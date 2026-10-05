// 应用壁纸配置（2026-10-05，外观设置「壁纸」段的数据面 —— 纯函数、可守卫）。
// 持久化走 localStorage（与主题同机制）；跨组件通知走 CustomEvent + storage 事件。
// ⛔ 颜色不落配置：图案层用 mask + background-color: var(--accent)（token 上色，守卫【170】同源）。

export const WALLPAPER_KEY = "wallpaper";
export const WALLPAPER_EVENT = "wallpaper-change";
export const WALLPAPER_MODES = ["off", "pattern", "particles", "vanta", "custom"];

/* 六款可平铺图案（原创几何，hero-patterns 风格）：SVG 走 mask（alpha 即形状），
   颜色由层 background-color 提供 → 换主题自动跟随。 */
function tile(inner, size) {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><g fill="#fff">${inner}</g></svg>`)}`;
}

export const WALLPAPER_PATTERNS = [
  { id: "dots", name: "圆点", tile: tile('<circle cx="12" cy="12" r="2.2"/>', 24) },
  { id: "grid", name: "方格", tile: svgStroke('<path d="M0 .5H24M.5 0V24"/>', 24) },
  { id: "zigzag", name: "折线", tile: svgStroke('<path d="M0 9l6-6 6 6 6-6 6 6v6l-6 6-6-6-6 6-6-6z"/>', 24) },
  { id: "plus", name: "十字", tile: tile('<path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z"/>', 24) },
  { id: "waves", name: "波浪", tile: svgStroke('<path d="M0 8c4-6 8-6 12 0s8 6 12 0M0 20c4-6 8-6 12 0s8 6 12 0"/>', 24) },
  { id: "slash", name: "斜纹", tile: svgStroke('<path d="M-6 6L6-6M0 12L12 0M6 18L18 6M12 24L24 12M18 30L30 18"/>', 24) },
];

function svgStroke(path, size) {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><g fill="none" stroke="#fff" stroke-width="1.4">${path}</g></svg>`)}`;
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
