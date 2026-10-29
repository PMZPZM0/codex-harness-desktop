/**
 * CLI 智能体面板的**纯函数层**（搜索 / 分组 / 分组计数）。
 *
 * 为什么单独一层：渲染层要对每次按键做筛选、守卫要能离线真跑，
 * 都不该依赖 React。⛔ 不读盘 —— 数据由调用方传入（真相源在主进程 `cliagents:list`）。
 *
 * 分类表（`categories`）也由主进程一起下发（`CLI_CATEGORIES`），这里**不复制第二份字面量**：
 * 两处各写一套分类名必然漂移（本仓反复踩过）。
 */

const text = (value) => String(value ?? "").trim();
const lower = (value) => text(value).toLowerCase();

/** 单条是否命中搜索词（名称 / 可执行名 / 描述 / 分类名 任一包含即可）。 */
export function matchCliAgent(item, query, categoryLabel) {
  const q = lower(query);
  if (!q) return true;
  const hay = [item?.name, item?.bin, item?.description, item?.promptHint, categoryLabel]
    .map(lower)
    .join(" ");
  return hay.includes(q);
}

/**
 * 按分类分组（"全部"由调用方自己决定要不要显示，这里只按真实分类切）。
 * @param {Array<{category?:string}>} items
 * @param {Array<{key:string,label:string,hint:string}>} categories
 * @param {string} query 搜索词（空 = 不过滤）
 * @returns {Array<{ key:string, label:string, hint:string, items:any[], total:number }>}
 * ⛔ 空分类也要保留（哪怕筛完 0 条）—— 用户要能看见"这类一个都没接入"；
 *    但**完全没有条目**且没在搜索时，面板自己会显示空态，不靠这里造组。
 */
export function groupCliAgents(items, categories, query) {
  const list = Array.isArray(items) ? items : [];
  const cats = Array.isArray(categories) ? categories : [];
  const out = [];
  for (const cat of cats) {
    const matched = list.filter((item) => item?.category === cat.key && matchCliAgent(item, query, cat.label));
    out.push({ key: cat.key, label: cat.label, hint: cat.hint ?? "", items: matched, total: matched.length });
  }
  // 分类值不认识（手改过 json / 未来新增分类但旧表没同步）⇒ 收进"未分类"，⛔ 不许静默丢弃
  const known = new Set(cats.map((cat) => cat.key));
  const orphan = list.filter((item) => !known.has(item?.category) && matchCliAgent(item, query, "未分类"));
  if (orphan.length) out.push({ key: "__other", label: "未分类", hint: "分类值无法识别（可在编辑里改成已有一类）", items: orphan, total: orphan.length });
  return out;
}

/** 分类计数（tab 上的数字；不受当前分类过滤影响，只受搜索词影响）。 */
export function countCliAgents(items, categories, query) {
  const groups = groupCliAgents(items, categories, query);
  return { total: groups.reduce((sum, group) => sum + group.total, 0), byCategory: Object.fromEntries(groups.map((group) => [group.key, group.total])) };
}

/** 检测状态的一句话（面板右侧那行小字）。 */
export function detectLabel(status) {
  if (!status || status.state === "idle") return "";
  if (status.state === "busy") return "检测中…";
  if (status.state === "ok") return status.version ? `已安装 · ${status.version}` : "已安装";
  return "未检测到";
}
