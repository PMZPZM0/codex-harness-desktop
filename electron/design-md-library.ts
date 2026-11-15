/**
 * design-md-library —— 随包的「品牌设计语言」库（VoltAgent/awesome-design-md，MIT）。
 *
 * 84 份 DESIGN.md（Google Stitch 格式：YAML tokens + 主题/排版/组件/布局/Do&Don't/响应式/迭代指南），
 * 数据由 `node scripts/sync-design-md.mjs` 从上游整包生成到 `resources/design-md/library.json`
 * （生成物，⛔ 不手改）。用途：
 *   · Codex 工具 `design_md`（dispatch-core / dispatch-rpc）按需取规范；
 *   · 设置页「设计参考」浏览 / 复制 / 导出到项目（design-md-ipc 域）。
 * ⛔ 只做「风格参考」：不复制品牌 logo / 商标，字体走文档里的替代表，正文里的品牌名只作来源标注。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { app } from "electron";

export type DesignMdCategory = { key: string; label: string; en: string; count: number };
export type DesignMdBrief = { slug: string; name: string; category: string; description: string };
export type DesignMdDoc = DesignMdBrief & { designMd: string };

type Library = {
  source: string;
  home: string;
  license: string;
  fetchedAt: string;
  categories: DesignMdCategory[];
  items: DesignMdDoc[];
};

let cached: Library | null = null;
let cachedFile = "";

/** 随包库文件路径：走 app.asar 内的 `resources/design-md/`（package.json build.files 已登记；
 *  开发态 app.getAppPath() = 项目根，同一相对路径）。⛔ 不另占 extraResources（同一份数据不重复打包）。 */
export function designMdLibraryFile(): string {
  return path.join(app.getAppPath(), "resources", "design-md", "library.json");
}

/** 读整库（首次读盘 + 解析后缓存；路径变化就重读，避免测试里换了 appPath 还拿旧缓存）。 */
function library(): Library {
  const file = designMdLibraryFile();
  if (cached && cachedFile === file) return cached;
  const parsed = JSON.parse(readFileSync(file, "utf8")) as Library;
  cached = parsed;
  cachedFile = file;
  return parsed;
}

/** slug 白名单：目录名形态（小写 + 数字 + `.` / `-`），⛔ 防路径穿越。 */
export function isDesignMdSlug(value: string): boolean {
  return /^[a-z0-9][a-z0-9.-]{0,63}$/.test(value);
}

/** 列表（不带正文）：按分类与关键词过滤；limit 缺省返回全部（最多 200）。 */
export function designMdList(input: { category?: string; query?: string; limit?: number } = {}): {
  source: string; home: string; license: string; fetchedAt: string;
  total: number; libraryTotal: number; categories: DesignMdCategory[]; items: DesignMdBrief[];
} {
  const lib = library();
  const category = String(input.category ?? "").trim();
  const query = String(input.query ?? "").trim().toLowerCase();
  let items = lib.items;
  if (category && category !== "all") items = items.filter((item) => item.category === category);
  if (query) {
    items = items.filter((item) => `${item.name} ${item.slug} ${item.description} ${item.category}`.toLowerCase().includes(query));
  }
  const limit = Math.max(1, Math.min(200, Number(input.limit) || 200));
  return {
    source: lib.source,
    home: lib.home,
    license: lib.license,
    fetchedAt: lib.fetchedAt,
    total: items.length,
    libraryTotal: lib.items.length,
    categories: lib.categories,
    items: items.slice(0, limit).map(({ designMd: _designMd, ...brief }) => brief),
  };
}

/** 取一份完整 DESIGN.md（slug 不在库里返回 null）。 */
export function designMdGet(slug: string): DesignMdDoc | null {
  const key = String(slug ?? "").trim();
  if (!isDesignMdSlug(key)) return null;
  return library().items.find((item) => item.slug === key) ?? null;
}

/** 分类中文名（工具输出 / 导出提示用）。 */
export function designMdCategoryLabel(key: string): string {
  return library().categories.find((category) => category.key === key)?.label ?? key;
}
