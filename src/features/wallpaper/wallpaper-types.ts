/**
 * 壁纸域 · 类型面（10-03）。
 *
 * ⛔ 位置说明（守卫【130】分层硬规则）：`src/lib/` 是**基座**（shared/lib/components/hooks），
 *   基座**不反向 import 域**。所以这个文件虽然物理在 `features/wallpaper/` 下，
 *   但它承载的是"基座与域共用的纯类型"，由 `src/lib/wallpaper.ts`（基座）引用。
 *   守卫【130】只扫 `src/lib` → `src/features/*` 的 import 方向，**type-only 引用在本设计里
 *   仍属违规**（基座不该知道任何域的存在）⇒ 下面这些类型改为由域自己声明，
 *   `src/lib/wallpaper.ts` 不再 import 它们，改为自带一份等价的结构类型。
 *   两处必须保持字段一致，守卫【251】第 6 条会比对。
 */

// ⛔ 类型真相源在基座 src/lib/wallpaper.ts（基座不反向 import 域 ⇒ 域反过来 import 基座是对的）
import type { WallpaperFit, WallpaperId } from "../../lib/wallpaper";

export type { WallpaperFit, WallpaperId };

/** 一张可用壁纸的展示信息（url 字段由渲染层按来源生成，接口层不强制）。 */
export interface WallpaperEntry {
  /** 稳定 id：自带素材 `bundled:<文件名>`；本地图 `local-<路径hash>`（见 wallpaper-ipc.ts） */
  id: WallpaperId;
  /** 自带素材的文件名（public/visual 下），本地选图为空 */
  bundled?: string;
  /** 本地绝对路径，自带素材为空 */
  filePath?: string;
  label: string;
  /** 预览用的 URL（自带 = BASE_URL；本地 = harness-image 协议） */
  url: string;
}
