/**
 * Uiverse 组件库 · 主进程读取面（10-01）
 *
 * 给 Codex 引擎的「组件库查询」能力做数据端：模型经内置 MCP（harness-dispatch）的
 * ui_component_search / ui_component_get 两个工具查/取 Uiverse Galaxy 组件（3802 个，MIT），
 * 开发前端界面时直接把组件代码搬进用户项目。
 *
 * 数据源 = 渲染层控件皮肤库的同一份 gzip（单一真相源，⛔ 不复制第二份）：
 *   · 构建形态：`<appPath>/dist/assets/<Cat>.html-*.gz`（Vite ?url 导入的产物，hash 文件名用前缀匹配）
 *   · dev 未构建：`<appPath>/src/lib/ui-skin/data/<Cat>.html.gz`
 * ⛔ 类目清单与渲染层 SKIN_LIB_LABELS（src/features/ui-skin/skin-slots.ts）同源同序，改动要两边同步。
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { app } from "electron";

export type UiverseCat = { cat: string; label: string; count: number };
export type UiverseItemMeta = { cat: string; id: string; name: string; author: string };
export type UiverseItem = UiverseItemMeta & { html: string };

/** 类目 → 展示名（与渲染层 skin-slots.ts 的 SKIN_LIB_LABELS 一致；新增类目两边同补） */
const CAT_LABEL: Record<string, string> = {
  Buttons: "按钮",
  Cards: "卡片",
  Checkboxes: "复选框",
  Forms: "表单",
  Inputs: "输入框",
  Notifications: "通知",
  Patterns: "图案",
  "Radio-buttons": "单选",
  "Toggle-switches": "开关",
  Tooltips: "工具提示",
  loaders: "加载器",
};

const cache = new Map<string, UiverseItem[]>();

/** 类目的 gz 文件绝对路径（构建产物优先，源文件回落；都没有 ⇒ null）。 */
function gzPathOf(cat: string): string | null {
  const appPath = app?.getAppPath?.() ?? process.cwd();
  const builtDir = path.join(appPath, "dist", "assets");
  try {
    const hit = fs.readdirSync(builtDir).find((f) => f.startsWith(`${cat}.html-`) && f.endsWith(".gz"));
    if (hit) return path.join(builtDir, hit);
  } catch { /* dist 不存在（dev 未构建）⇒ 走源 */ }
  const srcFile = path.join(appPath, "src", "lib", "ui-skin", "data", `${cat}.html.gz`);
  return fs.existsSync(srcFile) ? srcFile : null;
}

/** 读一个类目全量条目（进程级缓存；读不到 ⇒ 空数组，error 走返回值不 throw）。 */
function itemsOf(cat: string): UiverseItem[] {
  const hit = cache.get(cat);
  if (hit) return hit;
  const gz = gzPathOf(cat);
  if (!gz) return [];
  try {
    const json = JSON.parse(zlib.gunzipSync(fs.readFileSync(gz)).toString("utf8")) as UiverseItem[];
    cache.set(cat, json);
    return json;
  } catch {
    return [];
  }
}

/** 全部类目 + 计数（读不到的类目计 0，不隐藏——页面上看得见"数据没到位"）。 */
export function uiverseCats(): UiverseCat[] {
  return Object.keys(CAT_LABEL).map((cat) => ({ cat, label: CAT_LABEL[cat], count: itemsOf(cat).length }));
}

/**
 * 按类目/关键词搜组件（关键词匹配 name / author，大小写不敏感）。
 * 只回元数据不回正文（正文用 uiverseGet 按 id 取）。
 */
export function uiverseSearch(args: { cat?: string; query?: string; limit?: number }): { items: UiverseItemMeta[]; total: number; error?: string } {
  const cats = args.cat && CAT_LABEL[args.cat] ? [args.cat] : Object.keys(CAT_LABEL);
  const q = String(args.query ?? "").trim().toLowerCase();
  const limit = Math.max(1, Math.min(100, Number(args.limit) || 20));
  const all: UiverseItemMeta[] = [];
  let missing = 0;
  for (const cat of cats) {
    const items = itemsOf(cat);
    if (!items.length && !cache.has(cat)) missing += 1;
    for (const it of items) {
      if (q && !it.name.toLowerCase().includes(q) && !it.author.toLowerCase().includes(q)) continue;
      all.push({ cat, id: it.id, name: it.name, author: it.author });
    }
  }
  return {
    items: all.slice(0, limit),
    total: all.length,
    ...(missing ? { error: `${missing} 个类目数据不可读（库文件缺失或损坏）` } : {}),
  };
}

/** 取一个组件的完整代码（HTML+CSS 内联，可直接粘进项目）。 */
export function uiverseGet(args: { cat: string; id: string }): { item?: UiverseItem; error?: string } {
  const cat = String(args.cat ?? "");
  const id = String(args.id ?? "").toLowerCase();
  if (!CAT_LABEL[cat]) return { error: `未知类目「${cat}」；先用 ui_component_search 拿到合法的 cat/id` };
  const hit = itemsOf(cat).find((it) => it.id === id);
  if (!hit) return { error: `类目 ${cat} 里没有 id=${id} 的组件；先用 ui_component_search 查` };
  return { item: hit };
}

/** 引擎提示用的一句话统计（给 developer instructions / 工具描述复用）。 */
export function uiverseSummary(): string {
  const cats = uiverseCats();
  const total = cats.reduce((n, c) => n + c.count, 0);
  return `Uiverse 组件库（MIT）：${cats.length} 类 / ${total} 个组件（${cats.map((c) => `${c.label} ${c.count}`).join("、")}）`;
}
