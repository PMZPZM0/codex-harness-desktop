/**
 * BossMemoryPanel —— 「指挥中枢记忆」板块（10-25 用户令：「记忆板块里面加一个指挥中枢记忆板块，
 * 跟普通会话完全拆开」）。
 *
 * ── 为什么独立成一块（而不是塞进「项目共享记忆库」）──────────────────────
 *  指挥中枢的记忆**不在任何项目里**：它跑在自己的专属目录
 *   （`<userData>/boss-home/memories/<threadId>`），由主进程的名单
 *   （`boss-groups/session-registry.ts`，唯一真相源）指路。
 *   ⇒ 放「项目共享记忆库」里既找不到它、也会让人误以为它属于某个项目。
 *   ⇒ 独立一张卡：一个指挥中枢一行，点开看它自己的层水位。
 *
 * ── 数据来源（⛔ 页面不造数）─────────────────────────────────────────
 *   · 名单：`bossGroupSession({action:"list"})`（主进程；删了会话这里同步消失）
 *   · 每个会话的层水位：`readMemoryLayers(该会话的 memoryDir)`
 *   · 会话名：从 `threads` 里按 id 找（找不到就显示 id 前 8 位）
 *
 * ── 11-11 加「搜索 / 筛选 / 批量管理」（用户看截图点名）──────────────────
 *   ⛔ 筛选逻辑抽到 `src/lib/boss-memory-filter.mjs`（纯函数，守卫 12bl 真跑）；
 *   ⛔ 批量**不新开 IPC**：逐条复用单条的 `clearBossMemory` / `action:remove`，
 *      显式传每个 id / memoryDir（⛔ 不做「一键全清」这种无差别操作）；
 *   ⛔ 批量删除有**页内二次确认**（不弹系统 confirm，也不靠 disabled 表达归属）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Crown, Trash2, FolderOpen } from "lucide-react";
import {
  MEMORY_CONTENT_OPTIONS, MEMORY_STATUS_OPTIONS, filterRows, toggleSelection,
} from "../../lib/memory-list-filter.mjs";
import { MemoryListTools, type MemoryListAction } from "../memory-list-tools";

type BossSessionRow = { id: string; createdAt?: number; memoryDir?: string };
type ThreadRow = { id?: string; name?: string; cwd?: string };
type BossViewRow = { id: string; name: string; alive: boolean; contentCount: number; memoryDir?: string };

/** 指挥中枢记忆：每个中枢一份独立记忆目录，按中枢列会话与条目。 */
export function BossMemoryPanel({ threads, onOpenThread, onNotice }: {
  threads?: ThreadRow[];
  onOpenThread?: (id: string) => void;
  onNotice?: (text: string) => void;
}) {
  const [sessions, setSessions] = useState<BossSessionRow[]>([]);
  /* 当前**生效**的记忆后端（⛔ 必读：MCP 未安装 / 云端未开通会自动回退 builtin）——
     面板显示的是本地金字塔那份，切到 MCP/云端后它就不再被写入 ⇒ 必须说清楚，
     否则用户看到空面板会以为坏了。 */
  const [backend, setBackend] = useState<{ backend: string; effective: string; fallbackReason: string | null } | null>(null);
  const [activeId, setActiveId] = useState<string>("");
  const [snapshot, setSnapshot] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  /* 11-11 搜索 / 筛选 / 勾选 / 批量确认。 */
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [contentFilter, setContentFilter] = useState("all");
  const [contentCount, setContentCount] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  /* 名单：主进程是唯一真相源（⛔ 不用渲染层 localStorage 那份缓存）。
     ⛔ 定时重读 ⇒ 用户在别处删了指挥中枢，这里也会同步消失。
     提成 useCallback 是为了批量操作完能立刻重拉（不等 4 秒定时器）。 */
  const pullSessions = useCallback(async () => {
    try {
      const res: any = await (window as any).codex?.bossGroupSession?.({ action: "list" });
      if (!aliveRef.current) return;
      const list = Array.isArray(res?.sessions) ? res.sessions : [];
      setSessions(list);
      setActiveId((prev) => (prev && list.some((s: any) => s.id === prev) ? prev : (list[0]?.id ?? "")));
    } catch {
      if (aliveRef.current) setSessions([]);
    }
  }, []);

  useEffect(() => {
    void pullSessions();
    const timer = setInterval(() => void pullSessions(), 4000);
    const pullBackend = () => {
      Promise.resolve((window as any).codex?.readMemoryBackend?.())
        .then((res: any) => { if (aliveRef.current && res) setBackend({ backend: String(res.backend), effective: String(res.effective), fallbackReason: res.fallbackReason ?? null }); })
        .catch(() => { if (aliveRef.current) setBackend(null); });
    };
    pullBackend();
    const timer2 = setInterval(pullBackend, 8000);
    return () => { clearInterval(timer); clearInterval(timer2); };
  }, [pullSessions]);

  /* 每条的「有没有记忆内容」：只补读还没缓存过的 id（⛔ 名单每 4 秒重拉一次，
     不缓存会把所有目录反复读一遍）。批量 / 单条操作后由调用方主动改写这份缓存。 */
  useEffect(() => {
    let alive = true;
    const missing = sessions.filter((s) => s.memoryDir && !(s.id in contentCount));
    if (!missing.length) return;
    void Promise.all(missing.map(async (s) => {
      try {
        const snap: any = await (window as any).codex?.readMemoryLayers?.(s.memoryDir);
        return [s.id, Number(snap?.stats?.total ?? 0)] as const;
      } catch { return [s.id, 0] as const; }
    })).then((pairs) => {
      if (!alive) return;
      setContentCount((prev) => {
        const next = { ...prev };
        for (const [id, n] of pairs) next[id] = n;
        return next;
      });
    });
    return () => { alive = false; };
    // ⛔ 故意不依赖 contentCount：否则「写入缓存 → effect 重跑」会自己触发自己。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions]);

  const active = useMemo(() => sessions.find((s) => s.id === activeId) ?? null, [sessions, activeId]);
  /* 会话是否还存在（threads 里找不到 = 会话已被删/已被引擎清掉）。
     ⛔ 只**标记**、不隐藏 —— 记忆目录还在磁盘上，得让用户看得见、能手动清掉。 */
  const sessionAlive = (id: string) => (threads ?? []).some((t) => t?.id === id);

  /* 层水位：按该会话的**专属记忆目录**读（不是项目目录）。 */
  useEffect(() => {
    const dir = active?.memoryDir;
    if (!dir) { setSnapshot(null); return; }
    let alive = true;
    setLoading(true);
    Promise.resolve((window as any).codex?.readMemoryLayers?.(dir))
      .then((snap: any) => { if (alive) setSnapshot(snap ?? null); })
      .catch(() => { if (alive) setSnapshot(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [active?.memoryDir, active?.id]);

  /* ⛔ 名字不能只取 id 的一段：codex 的 thread id 是 **uuid v7** —— 前 8 位是时间戳
     （同一分钟内建的会话前缀**完全一样**，10-25 实测：列表里两个「指挥中枢 01a171d5」），
     尾部也可能是连续位（同样会撞）。
     ⇒ 取 **uuid 的第 3 段 + 尾部 4 位**（v7 的随机位集中在中间，最不容易撞），
        并且同名列加序号兜底（万一还是撞，一眼能看出是两个不同条目）。 */
  /** 显示名的**基名**（不含序号）—— 同名判定用。 */
  const nameBaseOf = (id: string) => {
    const hit = (threads ?? []).find((t) => t?.id === id);
    const named = String(hit?.name ?? "").trim();
    if (named) return named;
    const raw = String(id);
    const seg = raw.split("-");
    const mid = seg.length >= 3 ? seg[2] : raw.slice(0, 4);
    const tail = raw.length > 6 ? raw.slice(-4) : "";
    return `指挥中枢 ${mid.slice(0, 4)}…${tail}`;
  };

  const nameOf = (id: string) => {
    const hit = (threads ?? []).find((t) => t?.id === id);
    const named = String(hit?.name ?? "").trim();
    if (named) return named;
    const base = nameBaseOf(id);
    /* 同名兜底：同一个显示名出现多次 ⇒ 加序号（列表里必须能分辨是两个条目） */
    const same = sessions.filter((x) => x.id !== id && nameBaseOf(x.id) === base).length;
    return same ? `${base} (${same + 1})` : base;
  };

  const rows = useMemo<BossViewRow[]>(() => sessions.map((s) => ({
    id: s.id,
    name: nameOf(s.id),
    alive: sessionAlive(s.id),
    contentCount: Number(contentCount[s.id] ?? 0),
    memoryDir: s.memoryDir,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [sessions, threads, contentCount]);

  const visible = useMemo(() => filterRows(rows, {
    query,
    textOf: (r) => `${r.name} ${r.id}`,
    predicates: [
      (r) => statusFilter === "all" || (statusFilter === "alive" ? r.alive : !r.alive),
      (r) => contentFilter === "all" || (contentFilter === "has" ? r.contentCount > 0 : r.contentCount <= 0),
    ],
  }), [rows, query, statusFilter, contentFilter]);

  /* 删除该指挥中枢的记忆（⛔ 只删记忆目录，不删会话本身 —— 删会话走侧栏）。 */
  const clearMemory = async () => {
    if (!active?.memoryDir) return;
    const dir = active.memoryDir;
    const id = active.id;
    try {
      /* ⛔ 方法名必须与 preload 一致：`clearBossMemory`（⛔ 之前写成 deleteBossMemory
         ⇒ preload 上根本没有这个方法 ⇒ optional call 静默返回 undefined ⇒ 「清空失败」）。 */
      const res = await (window as any).codex?.clearBossMemory?.({ memoryDir: dir });
      if (res?.ok) {
        onNotice?.(`已清空「${nameOf(id)}」的记忆`);
        setSnapshot(null);
        setContentCount((prev) => ({ ...prev, [id]: 0 }));
      } else {
        onNotice?.(res?.error || "清空失败");
      }
    } catch (error: any) {
      onNotice?.(`清空失败：${error?.message ?? error}`);
    }
  };

  /* 移除这条记忆记录（⛔ 从主进程名单里摘掉 + 清掉它的目录 ⇒ 这一条彻底消失）。
     用户令：「旧的还是删不掉」—— 光清空内容条目还在，得能**整条删掉**。 */
  const removeEntry = async () => {
    const id = active?.id;
    if (!id) return;
    try {
      const res = await (window as any).codex?.bossGroupSession?.({ action: "remove", id });
      if (res?.ok) {
        onNotice?.(`已移除「${nameOf(id)}」的记忆记录`);
        setSnapshot(null);
        setActiveId("");
        setContentCount((prev) => { const next = { ...prev }; delete next[id]; return next; });
        void pullSessions();
      } else {
        onNotice?.(res?.error || "移除失败");
      }
    } catch (error: any) {
      onNotice?.(`移除失败：${error?.message ?? error}`);
    }
  };

  /* 批量动作交给通用工具条（含页内二次确认）；这里只定义「指挥中枢」自己的语义。
     ⛔ 逐条显式 id / memoryDir，主进程那两道安全闸照旧生效。 */
  const batchActions: MemoryListAction[] = [
    {
      key: "clear", label: "批量清空内容",
      confirmText: (n) => `将清空选中的 ${n} 条指挥中枢的记忆内容（记录本身保留）。`,
      run: async (ids) => {
        const targets = rows.filter((r) => ids.includes(r.id) && r.memoryDir);
        const results = await Promise.allSettled(targets.map((t) => window.codex.clearBossMemory({ memoryDir: t.memoryDir })));
        const done = results.filter((r) => r.status === "fulfilled" && Boolean((r as PromiseFulfilledResult<{ ok?: boolean }>).value?.ok)).length;
        setContentCount((prev) => { const next = { ...prev }; for (const t of targets) next[t.id] = 0; return next; });
        onNotice?.(`已批量清空 ${done}/${targets.length} 条`);
      },
    },
    {
      key: "remove", label: "批量移除记录", danger: true,
      confirmText: (n) => `将从名单移除选中的 ${n} 条，并清掉它们各自的记忆目录。`,
      run: async (ids) => {
        const targets = rows.filter((r) => ids.includes(r.id));
        const results = await Promise.allSettled(targets.map((t) => window.codex.bossGroupSession({ action: "remove", id: t.id })));
        const done = results.filter((r) => r.status === "fulfilled" && Boolean((r as PromiseFulfilledResult<{ ok?: boolean }>).value?.ok)).length;
        setContentCount((prev) => { const next = { ...prev }; for (const t of targets) delete next[t.id]; return next; });
        onNotice?.(`已批量移除 ${done}/${targets.length} 条`);
        void pullSessions();
      },
    },
  ];

  return (
    <div className="boss-mem-root">
      {/* ── 左：指挥中枢名单（每个会话一份独立记忆）────────────────── */}
      <aside className="boss-mem-list" aria-label="指挥中枢">
        {/* 11-11：四个记忆板块共用同一套工具条（搜索 / 筛选 / 批量管理）。 */}
        <MemoryListTools
          query={query} onQueryChange={setQuery} placeholder="搜名称或 ID"
          filters={[
            { key: "status", label: "按会话状态筛选", value: statusFilter, options: MEMORY_STATUS_OPTIONS, onChange: (v) => { setStatusFilter(v); setSelected([]); } },
            { key: "content", label: "按记忆内容筛选", value: contentFilter, options: MEMORY_CONTENT_OPTIONS, onChange: (v) => { setContentFilter(v); setSelected([]); } },
          ]}
          visibleIds={visible.map((v) => v.id)} selected={selected} onSelectionChange={setSelected}
          actions={batchActions} summary={`共 ${sessions.length} 条`}
        />

        <div className="boss-mem-scroll">
          {sessions.length === 0 && <p className="lib-empty">还没有指挥中枢 —— 点侧栏「指挥中枢」新建一个。</p>}
          {sessions.length > 0 && visible.length === 0 && <p className="lib-empty">没有符合条件的指挥中枢（换个搜索词或筛选条件）。</p>}
          {visible.map((s) => (
            <div className="boss-mem-row" key={s.id}>
              <input type="checkbox" className="mlt-check" aria-label={`选择 ${s.name}`}
                checked={selected.includes(s.id)}
                onChange={(e) => setSelected(toggleSelection(selected, [s.id], e.target.checked))} />
              <button type="button" title={s.id} data-boss-mem-session={s.id}
                className={`boss-mem-item ${activeId === s.id ? "is-active" : ""}${s.alive ? "" : " is-gone"}`}
                onClick={() => setActiveId(s.id)}>
                <span className="boss-mem-item-icon"><Crown size={12} /></span>
                <span className="boss-mem-item-name">{s.name}</span>
                {s.alive ? null : <em className="boss-mem-item-gone">会话已删</em>}
              </button>
            </div>
          ))}
        </div>

      </aside>

      {/* ── 右：该会话自己的记忆层 ──────────────────────────────────── */}
      <div className="boss-mem-detail">
        <header className="lib-head">
          <span className="lib-head-icon"><Crown size={14} /></span>
          <span className="lib-head-copy">
            <strong>{active ? nameOf(active.id) : "未选指挥中枢"}</strong>
            <small title={active?.memoryDir ?? ""}>
              {active && !sessionAlive(active.id) ? "⛔ 这个会话已被删除（记忆目录仍在磁盘上，可移除）" : (active?.memoryDir || "该会话还没有专属记忆目录")}
            </small>
          </span>
          {loading ? <em className="lib-loading">读取中…</em> : null}
          {backend ? (
            <em className="boss-mem-backend" title={backend.fallbackReason ?? ""}>
              记忆后端：{backend.effective === "builtin" ? "本地记忆库" : backend.effective === "mcp" ? "MCP 记忆服务" : "云端记忆"}
              {backend.fallbackReason ? "（已回退）" : ""}
            </em>
          ) : null}
        </header>

        {active ? (
          <>
            {backend && backend.effective !== "builtin" ? (
              <p className="boss-mem-note">
                ⛔ 当前生效后端是 <strong>{backend.effective === "mcp" ? "MCP 记忆服务" : "云端记忆"}</strong>，
                下面这份**本地记忆**目录已不再被自动捕获写入 —— 记忆进的是
                {backend.effective === "mcp" ? "MCP 服务（模型自己调 memory_write）" : "云端（按会话 id 隔离）"}。
                切回「本地记忆库」才会重新往这里写。
              </p>
            ) : null}
            {/* ⛔⛔ 11-11 用户令「四个模块同步更新，我不想再看见旧的」：
                这里原来画的是 L0–L7 层水位条 + 蒸馏标记（金字塔那一套）。
                ⇒ 换成：这个中枢的记忆是否已有内容 + 它自己的目录。
                ⛔ 中枢记忆的条目由它自己的会话维护，设置页不代它编造条目列表。 */}
            <div className="boss-mem-layers">
              {!loading ? (
                <p className="lib-empty">
                  {snapshot && Number(snapshot.stats?.total ?? 0) > 0
                    ? `已有 ${Number(snapshot.stats.total)} 条记忆内容，存在它自己的目录里。`
                    : "这个指挥中枢还没有记忆内容 —— 它下次干活时会自己往里记。"}
                </p>
              ) : null}
              {active.memoryDir ? <p className="boss-mem-note"><code>{active.memoryDir}</code></p> : null}
            </div>
            <footer className="lib-foot">
              <span className="lib-foot-note">
                <FolderOpen size={12} />
               指挥中枢的记忆存在它自己的目录里 —— 与任何项目、任何普通会话都互不相通。
              </span>
              <span className="boss-mem-actions">
                {onOpenThread && <button className="secondary-setting" onClick={() => onOpenThread(active.id)}>打开该会话</button>}
                <button className="secondary-setting" onClick={() => void clearMemory()}>
                  <Trash2 size={12} />清空内容
                </button>
                {/* ⛔ 整条移除：清内容只是清空内容，条目还在列表里；这条才是真删。 */}
                <button className="secondary-setting danger" onClick={() => void removeEntry()}>
                  <Trash2 size={12} />移除这条记录
                </button>
              </span>
            </footer>
          </>
        ) : null}
      </div>
    </div>
  );
}
