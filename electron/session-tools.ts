/**
 * electron/session-tools.ts —— 会话列表合并（**纯内存**）
 *
 * ⚠️ 本文件里**不允许**出现同步文件 I/O（readdirSync / readFileSync / statSync …）：
 * 它被 `ipcMain.handle("codex:request")` 直接调用，而所有会话共用同一个主进程事件循环——
 * 任何同步读盘都会在那段时间里让**全部会话**的事件转发停摆（「多会话一起卡」的形态）。
 * preflight【6】有守卫盯着这条（见 scripts/check-preflight.mjs）。
 *
 * rollout 的磁盘扫描/解析（原来也在这个文件里）已整体迁到 **worker 线程**：
 *   · 实现：electron/rollout-worker.cjs（构建期内联成字符串，避开 asar 路径问题）
 *   · 客户端：electron/rollout-pool.ts（`listRolloutThreadsAsync` / `enrichThreadWithRolloutToolsAsync`）
 */

/** 合并 app-server 索引和 rollout 兜底，并严格执行归档筛选。
 * archived=true 只能返回归档项，false 只能返回活动项；旧实现只处理 false，
 * 导致活动会话混入归档管理并被永久删除。 */
export function mergeThreadList(
  indexedInput: any[],
  fallback: any[],
  archived: boolean | null,
  limit = 100,
) {
  const indexed = indexedInput.map((entry) => archived == null ? entry : { ...entry, archived });
  const byId = new Map<string, any>(indexed.map((entry) => [String(entry.id), entry]));
  // 单位归一：引擎索引 updated_at 是秒，rollout 兜底（stat.mtimeMs / started*1000）是毫秒。
  // 混合单位会让侧边栏时间分组把同一批会话拆成两组（毫秒组永远单独成组、标签仍判「今天」）——统一成秒。
  const toSeconds = (value: any): number => {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n > 1e11 ? Math.round(n / 1000) : n;
  };
  for (const raw of fallback) {
    const entry = { ...raw, updatedAt: toSeconds(raw.updatedAt ?? raw.updated_at) };
    const existing = byId.get(String(entry.id));
    if (!existing) {
      byId.set(String(entry.id), entry);
      continue;
    }
    byId.set(String(entry.id), {
      ...entry,
      ...existing,
      name: String(existing.name ?? existing.title ?? "").trim() || entry.name,
      preview: String(existing.preview ?? "").trim() || entry.preview,
      cwd: String(existing.cwd ?? "").trim() || entry.cwd,
      updatedAt: toSeconds(existing.updatedAt ?? existing.updated_at) || entry.updatedAt,
      status: existing.status ?? entry.status,
    });
  }
  return [...byId.values()]
    .filter((entry) => archived == null ? true : Boolean(entry.archived) === archived)
    .sort((a, b) => Number(b.updatedAt ?? b.updated_at ?? 0) - Number(a.updatedAt ?? a.updated_at ?? 0))
    .slice(0, limit);
}

/**
 * 给「引擎索引里有、磁盘上 rollout 已不在」的会话打标记（09-16 修 Bug 8）。
 *
 * `presentIds` = 兜底扫描（`listRolloutThreadsAsync` 的结果）里**磁盘上真实存在**的线程 id 集合 ——
 * 白拿的判据，不需要额外做同步磁盘 I/O（请求路径禁同步 I/O 是本文件头部的硬约束）。
 * 只标带 `path` 的条目：引擎给了路径 = 它认为该有那个文件；兜底独有项（sessions/ 里有、索引里没有）
 * 天然就是存在的文件，不标。
 *
 * ⛔ 实测口径（别把它当「侧栏可见但点开报错」的兜底）：本机这版引擎在 rollout 丢失后**会把整条
 * 线程从 `thread/list` 里隐藏**（真机实测：跑过一回合的会话删掉 rollout 后，再查 `thread/list`
 * 该 id 直接不存在，`thread/resume <id>` 报 `no rollout found for thread id ...`），
 * 所以这个标记在当前引擎上**不会被触发**，属防御性逻辑（引擎某版本仍返回带 path 的条目时，
 * 侧栏会显示「记录丢失」而不是点开才吃引擎原始报错）。用户侧的真实症状是**会话静默消失**。
 */
export function markMissingRollouts<T extends { id?: unknown; path?: unknown }>(entries: T[], presentIds: Set<string>): T[] {
  for (const entry of entries) {
    const id = String(entry?.id ?? "").toLowerCase();
    if (id && entry?.path && !presentIds.has(id)) {
      (entry as T & { rolloutMissing?: boolean }).rolloutMissing = true;
    }
  }
  return entries;
}
