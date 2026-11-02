/**
 * 网页搜索结果提取（11-02）：引擎不同版本把结果放在 results / sources / citations / links 里，
 * 字段名也不统一。这里做**宽容提取**（纯函数），拿不到就返回空数组 ⇒ 调用方回落到原有一行卡片。
 */

const URL_RE = /^https?:\/\//i;

function urlOf(entry) {
  if (typeof entry === "string") return URL_RE.test(entry) ? entry : "";
  if (!entry || typeof entry !== "object") return "";
  for (const key of ["url", "link", "href", "sourceUrl", "source"]) {
    const value = entry[key];
    if (typeof value === "string" && URL_RE.test(value)) return value;
  }
  return "";
}

function textOf(entry, keys) {
  if (!entry || typeof entry !== "object") return "";
  for (const key of keys) {
    const value = entry[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./i, ""); } catch { return ""; }
}

/** 返回 [{ url, title, snippet, host }]（最多 limit 条，按 url 去重）。 */
export function webSearchResultsOf(item, limit = 6) {
  if (!item || typeof item !== "object") return [];
  const arrays = [item.results, item.sources, item.citations, item.links, item.result?.results, item.result?.sources];
  const out = [];
  const seen = new Set();
  for (const list of arrays) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (out.length >= limit) return out;
      const url = urlOf(entry);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const title = textOf(entry, ["title", "name", "label", "heading"]) || hostOf(url) || url;
      const snippet = textOf(entry, ["snippet", "description", "summary", "text", "content"]);
      out.push({ url, title, snippet, host: hostOf(url) });
    }
  }
  return out;
}

/** 从 URL 提取可读 host（渲染层兜底用）。 */
export function webSearchHostOf(url) {
  return hostOf(url);
}
