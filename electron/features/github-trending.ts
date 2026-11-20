/**
 * GitHub 热门抓取（11-20）—— 与设置 → 发现 →「GitHub 热门」同一口径。
 *
 * GitHub 没有公开 Trending API：取「最近 N 天创建 + star 最多」的 100 个仓库。
 * 候选序与页面一致：gh-proxy 国内镜像 → 官方直连。
 *
 * ⛔ 不放 dispatch-rpc：执行端自己发 HTTP 会与页面各写一份实现，两条路径必然漂移
 *   （守卫【202】直接判红）。这里只做抓取与格式化，schema 在 dispatch-core。
 */

type TrendingArgs = Record<string, unknown>;

/** 取 GitHub 近期热门仓库。失败时返回 ok:false（调用方原样转给模型，不抛）。 */
export async function fetchGithubTrending(args: TrendingArgs): Promise<{ ok: boolean; output?: string; error?: string }> {
  const since = String(args.since ?? "weekly").trim().toLowerCase();
  const days = since === "daily" ? 1 : since === "monthly" ? 30 : 7;
  const label = since === "daily" ? "日榜" : since === "monthly" ? "月榜" : "周榜";
  const limit = Math.min(30, Math.max(1, Math.floor(Number(args.limit) || 10)));
  const language = String(args.language ?? "").trim();
  const date = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const query = [`created:>=${date}`, "stars:>5", language ? `language:${language}` : ""].filter(Boolean).join(" ");
  const api = `api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=100`;
  const candidates = [`https://gh-proxy.com/https://${api}`, `https://${api}`];
  let lastError = "";
  for (const url of candidates) {
    try {
      const response = await fetch(url, { headers: { accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(20_000) });
      if (!response.ok) { lastError = `HTTP ${response.status}`; continue; }
      const data = (await response.json()) as { items?: Array<{ full_name?: unknown; description?: unknown; stargazers_count?: unknown; language?: unknown }> };
      const list = Array.isArray(data?.items) ? data.items : [];
      if (!list.length) { lastError = "榜单为空"; continue; }
      const lines = list.slice(0, limit).map((repo, index) => {
        const meta = [repo.language ? String(repo.language) : "", `★${Number(repo.stargazers_count) || 0}`].filter(Boolean).join(" · ");
        return `${index + 1}. ${String(repo.full_name ?? "")}（${meta}）${repo.description ? ` — ${String(repo.description)}` : ""}`;
      });
      return {
        ok: true,
        output: `${label} GitHub 热门（${language || "全部语言"}，按 star 排序）：\n${lines.join("\n")}\n\n`
          + `口径：GitHub 无公开 Trending API，这里取最近 ${days} 天创建且 star>5 的仓库；简介为原文，需要中文请自行翻译。`,
      };
    } catch (error) {
      lastError = String((error as { message?: unknown })?.message ?? error);
    }
  }
  return { ok: false, error: `GitHub 热门拉取失败：${lastError || "网络不可用"}` };
}
