/**
 * GitHub 热门榜单（11-20，设置 → 发现 → GitHub 热门）。
 *
 * 用户：「设置最下面加一个 GitHub 热门榜单，要翻译成中文，10 页，一页 10 个，日周月，走国内镜像源」。
 *
 * 数据：GitHub 没有公开的 Trending API，这里用 Search API 取「最近创建 + star 最多」的 100 个仓库
 *   （日=近 1 天 / 周=近 7 天 / 月=近 30 天），经 `gh-proxy.com` 国内镜像访问，直连作为兜底。
 * 翻译：每页 10 条简介走主进程 `prompt:translate`（当前模型批量翻，失败退 MyMemory），
 *   结果落 localStorage 缓存；仓库名保留原文。
 * ⛔ 不造假「Trending」：页面底部写明口径（GitHub 无公开 Trending API）；翻不出来的条目显示原文。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Flame, LoaderCircle, RefreshCw, Star, TriangleAlert } from "lucide-react";
import { copyTextToClipboard } from "../../lib/clipboard";

type Since = "daily" | "weekly" | "monthly";

type Repo = {
  id: number;
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
};

const SINCE_META: Record<Since, { label: string; days: number }> = {
  daily: { label: "日榜", days: 1 },
  weekly: { label: "周榜", days: 7 },
  monthly: { label: "月榜", days: 30 },
};

const PAGE_SIZE = 10;
const PAGE_COUNT = 10;
const DATA_TTL = 10 * 60_000;
const TRANS_CACHE = "github-trending-zh-v1";

const isChinese = (text: string) => /[\u4e00-\u9fff]/.test(text);
const transKey = (repo: Repo) => `${repo.full_name}|${String(repo.description ?? "").slice(0, 120)}`;

function readTransCache(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(TRANS_CACHE) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch { return {}; }
}

function writeTransCache(map: Record<string, string>): void {
  try { localStorage.setItem(TRANS_CACHE, JSON.stringify(map)); } catch { /* 隐私模式 */ }
}

function formatStars(value: number): string {
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
  return String(value);
}

function cacheKey(since: Since): string { return `github-trending:${since}`; }

function readDataCache(since: Since): Repo[] | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(cacheKey(since)) || "null");
    if (!raw || !Array.isArray(raw.items) || Date.now() - Number(raw.at ?? 0) > DATA_TTL) return null;
    return raw.items as Repo[];
  } catch { return null; }
}

function writeDataCache(since: Since, items: Repo[]): void {
  try { sessionStorage.setItem(cacheKey(since), JSON.stringify({ at: Date.now(), items })); } catch { /* 忽略 */ }
}

/** 设置 → 发现 → GitHub 热门：日/周/月三榜，每页 10 条、共 10 页，简介翻成中文。 */
export function GithubTrendingPage() {
  const [since, setSince] = useState<Since>("daily");
  const [items, setItems] = useState<Repo[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [translations, setTranslations] = useState<Record<string, string>>(readTransCache);
  const [translating, setTranslating] = useState(false);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef(0);
  const requestRef = useRef(0);
  const translatingKeysRef = useRef(new Set<string>());

  const load = useCallback(async (force = false) => {
    const id = ++requestRef.current;
    setLoading(true);
    setError("");
    setPage(1);
    try {
      if (!force) {
        const cached = readDataCache(since);
        if (cached?.length) { setItems(cached); return; }
      }
      const days = SINCE_META[since].days;
      const date = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      const query = `created:>=${date} stars:>5`;
      const api = `api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=100`;
      const candidates = [`https://gh-proxy.com/https://${api}`, `https://${api}`];
      let lastError = "";
      for (const url of candidates) {
        try {
          const response = await fetch(url, {
            headers: { accept: "application/vnd.github+json" },
            signal: AbortSignal.timeout(20_000),
          });
          if (!response.ok) { lastError = `HTTP ${response.status}`; continue; }
          const data = (await response.json()) as { items?: Repo[] };
          const list: Repo[] = Array.isArray(data?.items) ? data.items : [];
          if (!list.length) { lastError = "榜单为空"; continue; }
          if (id !== requestRef.current) return;
          setItems(list);
          writeDataCache(since, list);
          return;
        } catch (err) {
          lastError = String((err as { message?: unknown })?.message ?? err);
        }
      }
      throw new Error(lastError || "拉取失败");
    } catch (err) {
      if (id === requestRef.current) setError(String((err as { message?: unknown })?.message ?? err));
    } finally {
      if (id === requestRef.current) setLoading(false);
    }
  }, [since]);

  useEffect(() => { void load(); }, [load]);

  const pageItems = useMemo(() => items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [items, page]);
  const pageCount = Math.min(PAGE_COUNT, Math.max(1, Math.ceil(items.length / PAGE_SIZE)));

  /* 当前页里缺中文简介的条目，一次性交给主进程翻译（每页最多 10 条；相同 key 不重复请求）。 */
  useEffect(() => {
    const missing = pageItems.filter((repo) => {
      const key = transKey(repo);
      return Boolean(repo.description) && !isChinese(String(repo.description))
        && !translations[key] && !translatingKeysRef.current.has(key);
    });
    if (!missing.length) return;
    missing.forEach((repo) => translatingKeysRef.current.add(transKey(repo)));
    let alive = true;
    setTranslating(true);
    setNotice("");
    (async () => {
      try {
        /* 5 条一批并发翻：10 条一次模型请求要 13s 左右，拆两批约 7s 内能出中文。 */
        const chunks: Repo[][] = [];
        for (let index = 0; index < missing.length; index += 5) chunks.push(missing.slice(index, index + 5));
        const results = await Promise.all(chunks.map((chunk) =>
          window.codex.translateTexts({ texts: chunk.map((repo) => String(repo.description ?? "")) })
        ));
        if (!alive) return;
        let anyOk = false;
        let failure = "";
        const pairs: { repo: Repo; zh: string }[] = [];
        chunks.forEach((chunk, chunkIndex) => {
          const result = results[chunkIndex];
          if (!result?.ok) { failure = result?.error || "简介翻译暂不可用，当前显示原文"; return; }
          anyOk = true;
          const list = Array.isArray(result.translations) ? result.translations : [];
          chunk.forEach((repo, index) => pairs.push({ repo, zh: String(list[index] ?? "").trim() }));
        });
        if (!anyOk) { setNotice(failure || "简介翻译暂不可用，当前显示原文"); return; }
        setNotice("");
        setTranslations((current) => {
          const next = { ...current };
          for (const { repo, zh } of pairs) {
            if (zh && zh !== String(repo.description ?? "")) next[transKey(repo)] = zh;
          }
          writeTransCache(next);
          return next;
        });
      } catch {
        if (alive) setNotice("简介翻译暂不可用，当前显示原文");
      } finally {
        missing.forEach((repo) => translatingKeysRef.current.delete(transKey(repo)));
        if (alive) setTranslating(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageItems, translations]);

  const openRepo = (url: string) => { void window.codex.openExternal(url).catch(() => undefined); };

  /* 提示词只写给用户复制，不常驻注入 —— 不发出去就不花 token（11-19 工具/技能新规则）。 */
  useEffect(() => () => { if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current); }, []);
  const copyPrompt = async () => {
    const prompt = `用 github_trending 取${SINCE_META[since].label}前 20 个热门仓库，按语言分组，挑 3 个与我当前项目相关的，说明用途和上手方式。`;
    try {
      await copyTextToClipboard(prompt);
      setCopied(true);
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setNotice("复制失败，请手动选中页面内容复制");
    }
  };

  return (
    <section className="settings-section stack github-trending" data-github-trending>
      <div className="gh-trend-head">
        <div>
          <div className="gh-trend-title-row"><Flame size={16} className="ic-amber" /><strong>GitHub 热门榜单</strong></div>
          <p>日 / 周 / 月三榜 · 国内镜像访问 · 仓库简介翻译成中文（仓库名保留原文）</p>
        </div>
        <div className="gh-trend-actions">
          <div className="gh-trend-tabs" role="tablist" aria-label="榜单周期">
            {(Object.keys(SINCE_META) as Since[]).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={since === key}
                className={`gh-trend-tab${since === key ? " is-active" : ""}`}
                onClick={() => setSince(key)}
              >
                {SINCE_META[key].label}
              </button>
            ))}
          </div>
          <button type="button" className="secondary-setting" onClick={() => void copyPrompt()} title="复制给 Codex 的提示词（用 github_trending 工具取榜单）">
            {copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "已复制" : "复制提示词"}
          </button>
          <button type="button" className="secondary-setting" onClick={() => void load(true)} disabled={loading}>
            {loading ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}刷新
          </button>
        </div>
      </div>

      {notice && <div className="gh-trend-note"><TriangleAlert size={12} /> {notice}</div>}

      {error ? (
        <div className="gh-trend-error">
          <TriangleAlert size={14} />
          <span>拉取失败：{error}</span>
          <button type="button" className="secondary-setting" onClick={() => void load(true)}>重试</button>
        </div>
      ) : loading && !pageItems.length ? (
        <div className="gh-trend-list">
          {Array.from({ length: PAGE_SIZE }).map((_, index) => <div className="gh-trend-row gh-trend-skeleton" key={index} />)}
        </div>
      ) : (
        <>
          <div className="gh-trend-list">
            {pageItems.map((repo, index) => {
              const key = transKey(repo);
              const description = translations[key] || repo.description || "（没有简介）";
              const pending = translating && Boolean(repo.description) && !isChinese(String(repo.description)) && !translations[key];
              return (
                <article className="gh-trend-row" key={repo.id}>
                  <span className="gh-trend-rank">{String((page - 1) * PAGE_SIZE + index + 1).padStart(2, "0")}</span>
                  <div className="gh-trend-main">
                    <div className="gh-trend-name-row">
                      <button type="button" className="gh-trend-name" title={repo.html_url} onClick={() => openRepo(repo.html_url)}>{repo.full_name}</button>
                      {repo.language && <span className="gh-trend-lang">{repo.language}</span>}
                      {pending && <span className="gh-trend-pending">翻译中…</span>}
                    </div>
                    <p className="gh-trend-desc" title={repo.description || undefined}>{description}</p>
                  </div>
                  <div className="gh-trend-side">
                    <span className="gh-trend-stars"><Star size={12} />{formatStars(repo.stargazers_count)}</span>
                    <button type="button" className="secondary-setting gh-trend-open" onClick={() => openRepo(repo.html_url)}><ExternalLink size={12} />打开</button>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="gh-trend-pager" role="navigation" aria-label="榜单分页">
            <button type="button" className="gh-trend-page" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>上一页</button>
            {Array.from({ length: pageCount }).map((_, index) => (
              <button
                key={index}
                type="button"
                className={`gh-trend-page${page === index + 1 ? " is-active" : ""}`}
                onClick={() => setPage(index + 1)}
              >
                {index + 1}
              </button>
            ))}
            <button type="button" className="gh-trend-page" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page >= pageCount}>下一页</button>
          </div>

          <p className="gh-trend-note">
            口径：GitHub 没有公开 Trending API，这里取「最近创建 + star 数最高」的 100 个仓库（日=近 1 天 / 周=近 7 天 / 月=近 30 天），每页 10 个、共 10 页。
            数据经 gh-proxy 国内镜像；简介由当前模型 / MyMemory 翻译并缓存，翻不出来的会显示原文。
          </p>
        </>
      )}
    </section>
  );
}

export default GithubTrendingPage;
