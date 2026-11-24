/**
 * 幻灯片预览状态 + HTML 渲染（11-24，用户令：「侧边栏要有 PPT 实时预览，标签页那种可以随时叉掉，
 * codex 要知道侧边栏可以展示 PPT 进度」）。
 *
 * ⛔ 为什么预览是"生成一份 HTML 再交给右栏浏览器"而不是自己写个 React 渲染器：
 *    右栏浏览器面板**本来就有多标签 + 关闭按钮**，html-preview 也早已用这条路
 *    （写文件 → file:// → 按比例加宽）。复用它能省掉一整套标签管理，且用户能随手叉掉。
 * ⛔ 模型只给**内容**（标题/要点/备注/图），版式由这里统一渲染 —— 好看由宿主保证，
 *    否则每个会话的 PPT 长得都不一样。
 * ⛔ 数据只在本模块内存里（deck 数十 KB），不落盘；落盘的只有渲染产物 HTML。
 */

/** @typedef {{ index: number, title?: string, bullets?: string[], notes?: string, image?: string }} SlidePage */
/** @typedef {{ id: string, threadId: string, title: string, total: number, pages: SlidePage[], sourcePath?: string, updatedAt: number }} SlideDeck */

/** 当前 deck（同一时刻只预览一份；新 deck 覆盖旧的，⛔ 不做多 deck 标签，右栏一个页签就够）。 */
let current = null;
const listeners = new Set();

function emit() {
  for (const listener of listeners) {
    try { listener(current); } catch { /* 单个订阅者抛错不影响其它 */ }
  }
}

/** 订阅 deck 变化（返回取消函数；配合 useSyncExternalStore 使用）。 */
export function subscribeSlideDeck(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 读当前 deck（无则 null）。 */
export function getSlideDeck() {
  return current;
}

/** 起一份新 deck：同一 id 视为「同一份在更新」，换 id 才是换了一份。
 *  ⛔ threadId 必须带：deck 是**会话的**，全局单例只是实现细节 —— 没有归属时
 *     后台会话的幻灯片会盖掉用户正在看的这一份（并把右栏抢走）。 */
export function startSlideDeck(input) {
  current = {
    id: String(input?.id ?? `deck-${Date.now()}`),
    threadId: input?.threadId ? String(input.threadId) : "",
    title: String(input?.title ?? "幻灯片预览"),
    total: Math.max(1, Number(input?.total) || 1),
    pages: [],
    sourcePath: input?.sourcePath ? String(input.sourcePath) : undefined,
    updatedAt: Date.now(),
  };
  emit();
  return current;
}

/** 加/替换一页（index 从 1 开始；同 index 重复推送按替换处理，模型重做某页时不会出两页）。
 *  ⛔ 必须**换新对象**（不能原地改 current.pages）：订阅方是 useSyncExternalStore，
 *     原地改会让快照引用不变 ⇒ React 判定"没变化"⇒ 桥永远不刷新。 */
export function upsertSlidePage(page) {
  const owner = page?.threadId ? String(page.threadId) : "";
  /* ⛔ 串台防御：这份稿子属于某个会话。换了会话就开新稿 —— 否则 B 会话的页会叠到
     A 会话正在看的稿子上，桥还会把它写进当前工作区、抢走右栏。 */
  if (!current || (owner && current.threadId && current.threadId !== owner)) startSlideDeck({ threadId: owner });
  const index = Math.max(1, Number(page?.index) || current.pages.length + 1);
  const next = {
    index,
    title: page?.title ? String(page.title) : "",
    bullets: Array.isArray(page?.bullets) ? page.bullets.map((b) => String(b)).slice(0, 12) : [],
    notes: page?.notes ? String(page.notes) : "",
    image: page?.image ? String(page.image) : "",
  };
  current = {
    ...current,
    pages: [...current.pages.filter((p) => p.index !== index), next].sort((a, b) => a.index - b.index),
    total: Number(page?.total) > 0 ? Number(page.total) : current.total,
    updatedAt: Date.now(),
  };
  emit();
  return current;
}

/** 收尾：只刷新时间戳（页面据此显示「已完成」）。
 *  ⛔ 也必须**换新对象**：原地改 current.updatedAt 的快照引用不变 ⇒ useSyncExternalStore
 *     判「没变化」⇒ 桥不刷新（将来 finish 带上任何展示语义都会静默失效）。 */
export function finishSlideDeck() {
  if (!current) return null;
  current = { ...current, updatedAt: Date.now() };
  emit();
  return current;
}

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** 把页面里的图片引用变成能显示的 URL：http(s)/data/自定义协议原样，本地路径走 harness-image。 */
function imageSrcOf(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (/^(https?:|data:|harness-|file:)/i.test(value)) return value;
  return `harness-image://local?path=${encodeURIComponent(value)}`;
}

/** 「用其他应用打开」：只有真的存在源文件（.pptx/.key/.odp）时才给按钮。
 *  ⛔ 走 `harness-open` 自定义协议（file:// 页面调不到 IPC）—— 协议侧只放行办公文档扩展名。
 *  ⛔⛔ 必须 `preventDefault` + `fetch`，**不能直接导航**：那是当前页面往外跳，
 *     协议返回后整页会被替换成一句 "ok"（或 415 文案）—— 用户的预览就这么没了。
 *     `mode:"no-cors"` 是因为自定义 scheme 没有 CORS 头，否则请求会被浏览器挡在发出之前。 */
function openWithAppHref(sourcePath) {
  if (!sourcePath) return "";
  return `harness-open://open?path=${encodeURIComponent(sourcePath)}`;
}

/** 点「用其他应用打开」时的内联行为（不导航，只发一次请求）。 */
const OPEN_CLICK = "event.preventDefault();fetch(this.href,{mode:'no-cors'}).catch(function(){})";

/**
 * 渲染整份预览 HTML（自包含：样式内联、无外链、无脚本依赖）。
 * 版式：纵向罗列已生成页（16:9），当前页高亮，顶部固定进度条。
 */
export function renderSlideHtml(deck) {
  const pages = Array.isArray(deck?.pages) ? deck.pages : [];
  const total = Math.max(1, Number(deck?.total) || pages.length || 1);
  const done = pages.length;
  /* ⛔ 高亮「最新一页」要用**最大页码**，不是页数：模型可能乱序推页（先给第 5 页），
     用 pages.length 会去高亮一个不存在的 data-index。 */
  const lastIndex = pages.reduce((max, page) => Math.max(max, Number(page?.index) || 0), 0);
  const openHref = openWithAppHref(deck?.sourcePath);
  const cards = pages
    .map((page) => {
      const img = page.image ? `<div class="slide-art"><img src="${escapeHtml(imageSrcOf(page.image))}" alt=""></div>` : "";
      const bullets = page.bullets?.length
        ? `<ul>${page.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`
        : "";
      const notes = page.notes ? `<div class="slide-notes">${escapeHtml(page.notes)}</div>` : "";
      return `<section class="slide" data-index="${page.index}">
  <header><span class="slide-no">${page.index}</span><h2>${escapeHtml(page.title || `第 ${page.index} 页`)}</h2></header>
  ${img}
  ${bullets}
  ${notes}
</section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(deck?.title ?? "幻灯片预览")}</title>
<style>
:root{color-scheme:light dark;--bg:#f6f6f4;--panel:#fff;--text:#1c1c1a;--muted:#6f6f69;--line:#e4e4df;--accent:#c2410c}
@media (prefers-color-scheme:dark){:root{--bg:#17181a;--panel:#1f2124;--text:#eceff3;--muted:#9da5b1;--line:#2c2f33;--accent:#f97316}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.55 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;padding:0 0 28px}
.top{position:sticky;top:0;z-index:2;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--line);padding:10px 14px}
.row{display:flex;align-items:center;gap:10px}
.title{font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.counter{font-size:12px;color:var(--muted);flex:none;font-variant-numeric:tabular-nums}
.open{align-self:center;flex:none;padding:5px 10px;border:1px solid var(--line);border-radius:999px;background:var(--panel);color:var(--text);font-size:12px;text-decoration:none}
.open:hover{border-color:var(--accent);color:var(--accent)}
.bar{margin-top:8px;height:3px;border-radius:999px;background:var(--line);overflow:hidden}
.bar i{display:block;height:100%;background:var(--accent);transition:width .35s ease;width:${Math.round((done / total) * 100)}%}
.list{padding:14px;display:flex;flex-direction:column;gap:12px}
.slide{aspect-ratio:16/9;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px 20px;display:flex;flex-direction:column;gap:10px;overflow:hidden}
.slide header{display:flex;align-items:baseline;gap:8px}
.slide-no{flex:none;font-size:11px;color:var(--accent);font-variant-numeric:tabular-nums}
.slide h2{margin:0;font-size:17px;line-height:1.3;font-weight:600}
.slide ul{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:5px;font-size:13px}
.slide li::marker{color:var(--accent)}
.slide-art{flex:1;min-height:0;border-radius:8px;overflow:hidden;background:var(--bg)}
.slide-art img{width:100%;height:100%;object-fit:cover;display:block}
.slide-notes{margin-top:auto;font-size:11.5px;color:var(--muted);border-top:1px dashed var(--line);padding-top:6px}
.slide[data-index="${lastIndex}"]{border-color:color-mix(in srgb,var(--accent) 55%,var(--line));box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 28%,transparent)}
.empty{padding:40px 20px;text-align:center;color:var(--muted);font-size:13px}
</style></head>
<body>
<div class="top">
  <div class="row">
    <span class="title">${escapeHtml(deck?.title ?? "幻灯片预览")}</span>
    <span class="counter">${done} / ${total} 页</span>
    ${openHref ? `<a class="open" href="${escapeHtml(openHref)}" onclick="${OPEN_CLICK}">用其他应用打开</a>` : ""}
  </div>
  <div class="bar"><i></i></div>
</div>
${done ? `<div class="list">${cards}</div>` : `<div class="empty">等待第一页…</div>`}
</body></html>`;
}

/* ── 重载通道：预览页是同一个 file:// URL 反复重写，所以新数据靠通知宿主刷新，
   而不是换 URL（换 URL 会在右栏多开一个页签，用户还得手动叉）。── */
let previewUrl = "";
const reloadListeners = new Set();

/** 记住预览页 URL（BrowserPane 用它判断要不要刷新当前标签）。 */
export function setSlidePreviewUrl(url) {
  previewUrl = String(url ?? "");
}

/** 读预览页 URL。 */
export function getSlidePreviewUrl() {
  return previewUrl;
}

/* 「页签被用户叉掉」标记：产品要求是页签随时可叉，但叉掉后 URL 没变，
   桥若只广播重载就永远没有可刷新的页签（模型继续推页用户也看不到）。
   ⇒ 关的时候记一笔，下次推送时重开。 */
let previewClosed = false;

/** 标记预览页签是否已被用户关掉（BrowserPane 关标签时调）。 */
export function setSlidePreviewClosed(closed) {
  previewClosed = closed === true;
}

/** 读「预览页签是否已被用户关掉」。 */
export function isSlidePreviewClosed() {
  return previewClosed;
}

/** 订阅重载信号（返回取消函数）。 */
export function subscribeSlideReload(listener) {
  reloadListeners.add(listener);
  return () => reloadListeners.delete(listener);
}

/** 广播重载信号：桥每写完一次 HTML 调一次。 */
export function notifySlideReload() {
  for (const listener of reloadListeners) {
    try { listener(previewUrl); } catch { /* 单个订阅者抛错不影响其它 */ }
  }
}
