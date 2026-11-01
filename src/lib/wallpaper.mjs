// 应用壁纸配置（2026-10-05；11-02 大改版）：持久化 localStorage + CustomEvent 通知。
/* 11-02 用户：「把旧的壁纸删了，多做几套新的…你生成一些好看的壁纸，静态动态，你全部重新做」。
   ⇒ 模式收敛为 5 档（旧图案/粒子/星空整组移除）；静态壁纸改为**生图资产**（public/wallpapers/*.jpg），
     动态壁纸为 CSS 光幕（极光/流光/光晕，颜色走主题 token）。 */

export const WALLPAPER_KEY = "wallpaper";
export const WALLPAPER_EVENT = "wallpaper-change";
export const WALLPAPER_MODES = ["off", "aurora", "ribbon", "halo", "custom"];

/** 旧模式：图案=线条瓷砖 / 粒子=连线网 / 星空=点阵 —— 老档案里这些值统一迁移到 aurora。 */
const LEGACY_MODES = ["pattern", "particles", "stars", "vanta"];

/* ── 静态高级壁纸（生图资产）────────────────────────────────────────────────
   1792×1024、≈90–160KB/张；真实材质（烟 / 丝 / 纸 / 瓷 / 沙丘）比 CSS 渐变更像"高级感"。
   ⛔ 不许有文字 / 水印 / 主体 —— 它垫在界面下面，不是海报。
   ⛔ 资源必须落在 public/wallpapers（随构建进 dist），路径固定在下面这张表里。 */
export const WALLPAPER_PRESETS = [
  { id: "obsidian-smoke", name: "曜石烟", src: "wallpapers/obsidian-smoke.jpg" },
  { id: "midnight-aurora", name: "极夜", src: "wallpapers/midnight-aurora.jpg" },
  { id: "jade-ink", name: "墨玉", src: "wallpapers/jade-ink.jpg" },
  { id: "moon-silk", name: "月白", src: "wallpapers/moon-silk.jpg" },
  { id: "champagne-dunes", name: "香槟", src: "wallpapers/champagne-dunes.jpg" },
  { id: "porcelain-blue", name: "青瓷", src: "wallpapers/porcelain-blue.jpg" },
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
  const raw2 = LEGACY_MODES.includes(r.mode) ? "aurora" : r.mode;
  const mode = WALLPAPER_MODES.includes(raw2) ? raw2 : "off";
  const image = typeof r.image === "string" ? r.image : "";
  return { mode, image };
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