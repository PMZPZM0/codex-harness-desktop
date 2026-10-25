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
 */
import { useEffect, useMemo, useState } from "react";
import { Crown, Trash2, FolderOpen } from "lucide-react";

type BossSessionRow = { id: string; createdAt?: number; memoryDir?: string };
type ThreadRow = { id?: string; name?: string; cwd?: string };

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

  /* 名单：主进程是唯一真相源（⛔ 不用渲染层 localStorage 那份缓存）。
     ⛔ 定时重读 ⇒ 用户在别处删了指挥中枢，这里也会同步消失。 */
  useEffect(() => {
    let alive = true;
    const pull = () => {
      Promise.resolve((window as any).codex?.bossGroupSession?.({ action: "list" }))
        .then((res: any) => {
          if (!alive) return;
          const list = Array.isArray(res?.sessions) ? res.sessions : [];
          setSessions(list);
          setActiveId((prev) => (prev && list.some((s: any) => s.id === prev) ? prev : (list[0]?.id ?? "")));
        })
        .catch(() => { if (alive) setSessions([]); });
    };
    pull();
    const timer = setInterval(pull, 4000);
    const pullBackend = () => {
      Promise.resolve((window as any).codex?.readMemoryBackend?.())
        .then((res: any) => { if (alive && res) setBackend({ backend: String(res.backend), effective: String(res.effective), fallbackReason: res.fallbackReason ?? null }); })
        .catch(() => { if (alive) setBackend(null); });
    };
    pullBackend();
    const timer2 = setInterval(pullBackend, 8000);
    return () => { alive = false; clearInterval(timer); clearInterval(timer2); };
  }, []);

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

  const layers: any[] = Array.isArray(snapshot?.layers) ? snapshot.layers : [];

  /* 删除该指挥中枢的记忆（⛔ 只删记忆目录，不删会话本身 —— 删会话走侧栏）。 */
  const clearMemory = async () => {
    if (!active?.memoryDir) return;
    const dir = active.memoryDir;
    try {
      /* ⛔ 方法名必须与 preload 一致：`clearBossMemory`（⛔ 之前写成 deleteBossMemory
         ⇒ preload 上根本没有这个方法 ⇒ optional call 静默返回 undefined ⇒ 「清空失败」）。 */
      const res = await (window as any).codex?.clearBossMemory?.({ memoryDir: dir });
      if (res?.ok) {
        onNotice?.(`已清空「${nameOf(active.id)}」的记忆`);
        setSnapshot(null);
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
      } else {
        onNotice?.(res?.error || "移除失败");
      }
    } catch (error: any) {
      onNotice?.(`移除失败：${error?.message ?? error}`);
    }
  };

  return (
    <div className="boss-mem-root">
      {/* ── 左：指挥中枢名单（每个会话一份独立记忆）────────────────── */}
      <aside className="boss-mem-list" aria-label="指挥中枢">
        {sessions.length === 0 && <p className="lib-empty">还没有指挥中枢 —— 点侧栏「指挥中枢」新建一个。</p>}
        {sessions.map((s) => (
          <button type="button" key={s.id} title={s.id} data-boss-mem-session={s.id}
            className={`boss-mem-item ${activeId === s.id ? "is-active" : ""}${sessionAlive(s.id) ? "" : " is-gone"}`}
            onClick={() => setActiveId(s.id)}>
            <span className="boss-mem-item-icon"><Crown size={12} /></span>
            <span className="boss-mem-item-name">{nameOf(s.id)}</span>
            {sessionAlive(s.id) ? null : <em className="boss-mem-item-gone">会话已删</em>}
          </button>
        ))}
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
              记忆后端：{backend.effective === "builtin" ? "本地金字塔" : backend.effective === "mcp" ? "MCP 记忆服务" : "云端记忆"}
              {backend.fallbackReason ? "（已回退）" : ""}
            </em>
          ) : null}
        </header>

        {active ? (
          <>
            {backend && backend.effective !== "builtin" ? (
              <p className="boss-mem-note">
                ⛔ 当前生效后端是 <strong>{backend.effective === "mcp" ? "MCP 记忆服务" : "云端记忆"}</strong>，
                下面这份**本地金字塔**目录已不再被自动捕获写入 —— 记忆进的是
                {backend.effective === "mcp" ? "MCP 服务（模型自己调 memory_write）" : "云端（按会话 id 隔离）"}。
                切回「本地金字塔」才会重新往这里写。
              </p>
            ) : null}
            <div className="boss-mem-layers">
              {layers.length === 0 && !loading ? <p className="lib-empty">这个指挥中枢还没有记忆内容。</p> : null}
              {layers.map((l: any) => {
                const pct = Math.round(((l.ratio ?? 0) as number) * 100);
                return (
                  <article className="lib-book" key={l.id} data-boss-mem-layer={l.id}>
                    <span className="lib-book-spine">{l.id}</span>
                    <span className="lib-book-body">
                      <strong>{l.name}</strong>
                      <small>{l.where ?? ""}</small>
                      <span className="lib-book-meta">
                        {(l.used ?? 0).toLocaleString()} 字 / {(l.budget ?? 0).toLocaleString()}
                        {l.needDistill ? " · 需蒸馏" : ""}
                      </span>
                    </span>
                    <span className="lib-book-bar"><i style={{ width: `${Math.min(100, pct)}%` }} /></span>
                  </article>
                );
              })}
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
