/**
 * 壁纸域 · 类型与纯函数（10-03 新增，独立板块）。
 *
 * 独立板块的理由（docs/ARCHITECTURE-RULES.md §2.2）：壁纸有主进程通道、渲染层状态、
 * 设置页 UI、独立 CSS 作用域与自己的守卫，是完整的一层能力，不塞进既有域。
 *
 * ⛔ 为什么**不复制**用户选中的图片到应用目录（与 harness-image 协议的口径一致）：
 *   `dialog:images` 选完会调 `trustPicked()`，被选路径**及其所在目录**进入
 *   `runtime-refs.ts` 的可信根集合 ⇒ 渲染层可以直接引原路径，不必留副本。
 *   复制反而会多一份冗余（用户改/删原图时，两边不一致才是更糟的体验）。
 *   ⛔ 但「手动填路径」这条通道**必须**在主进程再校验一次 isInsideTrustedRoots ——
 *   用户可以手打任意 `C:\...`，不能因为"前端会显示"就把它当合法图片源。
 *
 * ⛔⛔ 适配原则（用户需求 2/3：不变形、实时重适配、铺满或居中裁剪）：
 *   **适配完全交给 CSS，不在 JS 里算尺寸**。凡是 JS 按窗口尺寸算 width/height 赋给
 *   背景图的写法，都会在窗口拖拽时抖动/滞后，且必须额外监听 resize —— 而
 *   `background-size: cover` 是浏览器原生按当前盒模型实时求解的，天然跟随。
 */

/** 壁纸标识。⛔ "none" = 纯色（关闭）；其余形如 `bundled:<file>` / `local-<hash>`。 */
export type WallpaperId = string;

/** 适配方式。⛔ 没有 "stretch" —— 拉伸变形是需求明确禁止的，不提供该选项。 */
export type WallpaperFit = "cover" | "contain" | "auto";

/** localStorage 键：当前壁纸 id（"none" = 纯色）。⛔ 与 index.html 顶部无交互，不需同步。 */
export const WALLPAPER_KEY = "wallpaper-id";
/** localStorage 键：适配方式。 */
export const WALLPAPER_FIT_KEY = "wallpaper-fit";
/** localStorage 键：遮罩强度 0~100（用户可调；深浅主题各自记忆）。 */
export const WALLPAPER_DIM_KEY = "wallpaper-dim";

/** 关闭态取值（用字符串而不是空串：空串在 localStorage 里容易被当成"没设"）。 */
export const WALLPAPER_OFF = "none";

/** 适配方式 → CSS `background-size`。⛔ 绝不能出现 `100% 100%`（那正是拉伸变形）。 */
export const FIT_TO_SIZE: Record<WallpaperFit, string> = {
  /** 铺满：保持比例、裁掉溢出部分（绝大多数壁纸用这个，永远不留黑边） */
  cover: "cover",
  /** 居中完整：保持比例、完整显示、留出的地方填底色（想看清整张图时用） */
  contain: "contain",
  /** 原始尺寸：1:1 显示，不缩放（几乎只在图标类素材上有意义） */
  auto: "auto",
};

export const FIT_LABELS: Record<WallpaperFit, string> = {
  cover: "铺满",
  contain: "居中",
  auto: "原始",
};

/** 校验并归一（localStorage 可能是旧值/脏值/被人手改过）。 */
export function normalizeFit(value: unknown): WallpaperFit {
  return value === "contain" || value === "auto" ? value : "cover";
}

export function normalizeDim(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 8;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * 本地绝对路径 → 可渲染 URL。
 *
 * ⛔ 必须双编码：路径里有空格/中文/ `#`/`?` 时，Chromium 会先解一层，
 * 直接塞进 URL 会被当成相对路径或被 fragment 截断（协议侧另有兼容解码兜底）。
 * 已有先例：`src/features/app-view/helpers/paths.ts` 的 toFileUrl。
 */
export function wallpaperUrlFromPath(filePath: string): string {
  const full = filePath.replace(/\\/g, "/");
  const encoded = encodeURIComponent(full);
  return `harness-image://img/?path=${encoded}&r=${Date.now()}`;
}

/** 应用内自带的素材（public/visual 下）走 BASE_URL，不经协议。 */
export function wallpaperUrlFromBundled(file: string): string {
  return `${import.meta.env.BASE_URL}visual/${file}`;
}
