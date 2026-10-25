/**
 * BossMemoryPanel —— 「BOSS 会话记忆」板块（10-25 用户令：「记忆板块里面加一个BOSS会话记忆板块，
 * 跟普通会话完全拆开」）。
 *
 * ── 为什么独立成一块（而不是塞进「项目共享记忆库」）──────────────────────
 *   BOSS 会话的记忆**不在任何项目里**：它跑在自己的专属目录
 *   （`<userData>/boss-home/memories/<threadId>`），由主进程的名单
 *   （`boss-groups/session-registry.ts`，唯一真相源）指路。
 *   ⇒ 放「项目共享记忆库」里既找不到它、也会让人误以为它属于某个项目。
 *   ⇒ 独立一张卡：一个 BOSS 会话一行，点开看它自己的层水位。
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
  const [activeId, setActiveId] = useState<string>("");
  const [snapshot, setSnapshot] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  /* 名单：主进程是唯一真相源（⛔ 不用渲染层 localStorage 那份缓存）。
     ⛔ 定时重读 ⇒ 用户在别处删了 BOSS 会话，这里也会同步消失。 */
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
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const active = useMemo(() => sessions.find((s) => s.id === activeId) ?? null, [sessions, activeId]);

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

  const nameOf = (id: string) => {
    const hit = (threads ?? []).find((t) => t?.id === id);
    return String(hit?.name ?? "").trim() || `BOSS 会话 ${String(id).slice(0, 8)}`;
  };

  const layers: any[] = Array.isArray(snapshot?.layers) ? snapshot.layers : [];

  /* 删除该 BOSS 会话的记忆（⛔ 只删记忆目录，不删会话本身 —— 删会话走侧栏）。 */
  const clearMemory = async () => {
    if (!active?.memoryDir) return;
    const dir = active.memoryDir;
    try {
      const res = await (window as any).codex?.deleteBossMemory?.({ memoryDir: dir });
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

  return (
    <div className="boss-mem-root">
      {/* ── 左：BOSS 会话名单（每个会话一份独立记忆）────────────────── */}
      <aside className="boss-mem-list" aria-label="BOSS 会话">
        {sessions.length === 0 && <p className="lib-empty">还没有 BOSS 会话 —— 点侧栏「BOSS 会话」新建一个。</p>}
        {sessions.map((s) => (
          <button type="button" key={s.id} title={s.id} data-boss-mem-session={s.id}
            className={`boss-mem-item ${activeId === s.id ? "is-active" : ""}`}
            onClick={() => setActiveId(s.id)}>
            <span className="boss-mem-item-icon"><Crown size={12} /></span>
            <span className="boss-mem-item-name">{nameOf(s.id)}</span>
          </button>
        ))}
      </aside>

      {/* ── 右：该会话自己的记忆层 ──────────────────────────────────── */}
      <div className="boss-mem-detail">
        <header className="lib-head">
          <span className="lib-head-icon"><Crown size={14} /></span>
          <span className="lib-head-copy">
            <strong>{active ? nameOf(active.id) : "未选 BOSS 会话"}</strong>
            <small title={active?.memoryDir ?? ""}>{active?.memoryDir || "该会话还没有专属记忆目录"}</small>
          </span>
          {loading ? <em className="lib-loading">读取中…</em> : null}
        </header>

        {active ? (
          <>
            <div className="boss-mem-layers">
              {layers.length === 0 && !loading ? <p className="lib-empty">这个 BOSS 会话还没有记忆内容。</p> : null}
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
                BOSS 会话的记忆存在它自己的目录里 —— 与任何项目、任何普通会话都互不相通。
              </span>
              <span className="boss-mem-actions">
                {onOpenThread && <button className="secondary-setting" onClick={() => onOpenThread(active.id)}>打开该会话</button>}
                <button className="secondary-setting danger" onClick={() => void clearMemory()}>
                  <Trash2 size={12} />清空这份记忆
                </button>
              </span>
            </footer>
          </>
        ) : null}
      </div>
    </div>
  );
}
