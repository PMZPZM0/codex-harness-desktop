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
