// 应用壁纸配置（2026-10-05，外观设置「壁纸」段的数据面 —— 纯函数、可守卫）。
// 持久化走 localStorage（与主题同机制）；跨组件通知走 CustomEvent + storage 事件。
// ⛔ 颜色不落配置：图案层用 mask + background-color: var(--accent)（token 上色，守卫【170】同源）。

export const WALLPAPER_KEY = "wallpaper";
export const WALLPAPER_EVENT = "wallpaper-change";
export const WALLPAPER_MODES = ["off", "aurora", "ribbon", "halo", "custom", "stars", "pattern", "particles"];

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

/* ── 静态高级壁纸（11-02 用户：「把旧的壁纸删了，多做几套新的，主题色」）──────
   ⛔ 与旧版的关键差别：**全部用主题 token 上色**（color-mix + var(--bg/--panel/--accent/--ic-*)），
     不写死任何色值 ⇒ 切「白天 / 黑夜 / 曜石」时整套壁纸自动换配色，不再出现糖果色垫在深色界面上。
   结构：两层大面积 radial（低饱和强调色 + 极淡次要色）+ 一层主题底色线性渐变；
   页面上的雾面遮罩仍由 28-wallpaper.css 按主题明暗再压一层。 */
export const WALLPAPER_PRESETS = [
  {
    id: "veil", name: "墨雾",
    css: "radial-gradient(120% 90% at 18% 12%, color-mix(in srgb, var(--accent) 16%, transparent) 0%, transparent 62%), radial-gradient(90% 80% at 82% 80%, color-mix(in srgb, var(--ic-cyan) 10%, transparent) 0%, transparent 60%), linear-gradient(155deg, var(--bg), var(--panel) 58%, var(--panel-2))",
  },
  {
    id: "champagne", name: "香槟",
    css: "radial-gradient(110% 85% at 22% 18%, color-mix(in srgb, var(--accent) 24%, transparent) 0%, transparent 60%), radial-gradient(85% 75% at 80% 84%, color-mix(in srgb, var(--amber) 12%, transparent) 0%, transparent 58%), linear-gradient(150deg, var(--panel), var(--bg) 70%)",
  },
  {
    id: "jade", name: "玉岑",
    css: "radial-gradient(115% 90% at 20% 20%, color-mix(in srgb, var(--green) 18%, transparent) 0%, transparent 60%), radial-gradient(90% 80% at 82% 78%, color-mix(in srgb, var(--ic-cyan) 10%, transparent) 0%, transparent 58%), linear-gradient(160deg, var(--bg), var(--panel) 62%, var(--panel-2))",
  },
  {
    id: "ink", name: "玄墨",
    css: "radial-gradient(120% 90% at 28% 8%, color-mix(in srgb, var(--text) 7%, transparent) 0%, transparent 58%), radial-gradient(90% 70% at 78% 92%, color-mix(in srgb, var(--text) 4%, transparent) 0%, transparent 60%), linear-gradient(165deg, var(--panel), var(--bg) 60%)",
  },
  {
    id: "sand", name: "暮砂",
    css: "radial-gradient(115% 90% at 78% 16%, color-mix(in srgb, var(--ic-amber) 18%, transparent) 0%, transparent 60%), radial-gradient(90% 80% at 18% 84%, color-mix(in srgb, var(--accent) 9%, transparent) 0%, transparent 58%), linear-gradient(150deg, var(--bg), var(--panel) 60%, var(--panel-2))",
  },
  {
    id: "nocturne", name: "夜岚",
    css: "radial-gradient(120% 92% at 24% 14%, color-mix(in srgb, var(--ic-violet) 20%, transparent) 0%, transparent 60%), radial-gradient(90% 80% at 84% 80%, color-mix(in srgb, var(--ic-pink) 9%, transparent) 0%, transparent 58%), linear-gradient(155deg, var(--bg), var(--panel) 58%, var(--panel-2))",
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
  // ⛔ 旧值迁移：`vanta`（vanta NET，只会画"点+连线"的网）已退役，换成自绘的星野 `stars`
  //    （用户 10-11：「黑夜→星空、白天→动态点且不要连线」）。老档案里存着 "vanta" 的按 stars 生效。
  const raw2 = r.mode === "vanta" ? "stars" : r.mode;
  const mode = WALLPAPER_MODES.includes(raw2) ? raw2 : "off";
  const pattern = WALLPAPER_PATTERNS.some((p) => p.id === r.pattern) ? r.pattern : "dots";
  const opacityNum = Number(r.opacity);
  const opacity = Number.isFinite(opacityNum) ? Math.min(40, Math.max(2, Math.round(opacityNum))) : 16;
  // 星野密度比例（100 = 默认）。20%~300% —— 用户 10-11「星空加一个比例拉动板块」。
  const scaleNum = Number(r.starScale);
  const starScale = Number.isFinite(scaleNum) ? Math.min(300, Math.max(20, Math.round(scaleNum))) : 100;
  const image = typeof r.image === "string" ? r.image : "";
  return { mode, pattern, opacity, starScale, image };
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
