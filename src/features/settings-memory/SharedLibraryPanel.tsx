/**
 * SharedLibraryPanel —— 「项目共享记忆库」的界面（10-10 用户要求：**每个板块一套独立界面**，
 * 不复用同一套模板）。
 *
 * ── 这一套的形态：**书架**（不是列表、不是卡片墙、不是金字塔）────────────────
 *   左：项目**书脊**（竖排、可切换；选中项高亮成"抽出"状态）
 *   右：三类内容各自一块**书层**（用户档案 / 项目规则 / 工作纪律），书层里按层排"书"
 *   顶：当前项目的总占用（把三类的水位合起来看）
 *   ⛔ 与另外两套刻意区分：金字塔那套是**梯形层叠**（纵向结构），控制台那套是**开关面板**（横向设备），
 *     这一套是**横向书架**（左右分栏 + 竖向书脊）—— 三套的"骨架"完全不同。
 *
 * ── 数据 ───────────────────────────────────────────────────────────
 *   · 层规则：src/lib/memory-scope-rules.mjs（唯一真相源）
 *   · 层水位：readMemoryLayers(切换的项目) —— 切项目就重读
 */
import { useEffect, useState } from "react";
import { LibraryBig, FolderOpen } from "lucide-react";
import { MEMORY_LAYER_RULES, MEMORY_SCOPE_LABEL, MEMORY_INJECT_LABEL } from "../../lib/memory-scope-rules.mjs";

/** 三类内容 → 层 id（⛔ 与规则表 join，不另写层定义） */
const SHELVES: { title: string; hint: string; ids: string[] }[] = [
  { title: "用户档案", hint: "跨项目一致 · 全项目共用一份", ids: ["L0"] },
  { title: "项目规则", hint: "本项目全体会话共享", ids: ["L1", "L3"] },
  { title: "工作纪律", hint: "注入时排最前 · 用户纠错单独一类", ids: ["L2"] },
];

export function SharedLibraryPanel({ workspace, projects, onOpenCenter }: {
  workspace: string;
  projects: string[];
  onOpenCenter?: () => void;
}) {
  const [active, setActive] = useState(workspace || projects[0] || "");
  const [snapshot, setSnapshot] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (!active && projects[0]) setActive(projects[0]); }, [projects, active]);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    setLoading(true);
    Promise.resolve((window as any).codex?.readMemoryLayers?.(active))
      .then((snap: any) => { if (alive) setSnapshot(snap ?? null); })
      .catch(() => { if (alive) setSnapshot(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [active]);

  const nameOf = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || p;
  const liveOf = (id: string) => (snapshot?.layers ?? []).find((l: any) => l.id === id);
  const shelfPct = (ids: string[]) => {
    const rows = ids.map(liveOf).filter(Boolean) as any[];
    if (!rows.length) return 0;
    const used = rows.reduce((s, r) => s + (r.used ?? 0), 0);
    const budget = rows.reduce((s, r) => s + (r.budget ?? 0), 0);
    return budget ? Math.min(100, Math.round((used / budget) * 100)) : 0;
  };

  return (
    <div className="lib-root">
      {/* ── 左：项目书脊 ─────────────────────────────────────────────── */}
      <aside className="lib-spines" aria-label="项目">
        {projects.length === 0 && <p className="lib-empty">还没有发现项目 —— 先打开一个工作区。</p>}
        {projects.map((p) => (
          <button type="button" key={p} title={p} data-lib-project={p}
            className={`lib-spine ${active === p ? "is-pulled" : ""}`}
            onClick={() => setActive(p)}>
            <span className="lib-spine-name">{nameOf(p)}</span>
          </button>
        ))}
      </aside>

      {/* ── 右：三层书架 ─────────────────────────────────────────────── */}
      <div className="lib-shelves">
        <header className="lib-head">
          <span className="lib-head-icon"><LibraryBig size={14} /></span>
          <span className="lib-head-copy">
            <strong>{active ? nameOf(active) : "未选项目"}</strong>
            <small title={active}>{active || "从左边选一个项目"}</small>
          </span>
          {loading ? <em className="lib-loading">读取中…</em> : null}
        </header>

        {SHELVES.map((shelf) => {
          const pct = shelfPct(shelf.ids);
          const rows = shelf.ids
            .map((id) => ({ rule: MEMORY_LAYER_RULES.find((r) => r.layer === id), live: liveOf(id) }))
            .filter((x) => x.rule);
          return (
            <section className="lib-shelf" key={shelf.title} data-lib-shelf={shelf.title}>
              <div className="lib-shelf-head">
                <strong>{shelf.title}</strong>
                <span className="lib-shelf-hint">{shelf.hint}</span>
                <span className="lib-shelf-gauge" title={`占用 ${pct}%`}><i style={{ width: `${pct}%` }} /></span>
                <em className="lib-shelf-pct">{pct}%</em>
              </div>
              <div className="lib-books">
                {rows.map(({ rule, live }) => {
                  const rowPct = Math.round(((live?.ratio ?? 0) as number) * 100);
                  return (
                    <article className="lib-book" key={rule!.layer} data-lib-book={rule!.layer}>
                      <span className="lib-book-spine">{rule!.layer}</span>
                      <span className="lib-book-body">
                        <strong>{rule!.name}</strong>
                        <small>{rule!.store}</small>
                        <span className="lib-book-meta">
                          {MEMORY_SCOPE_LABEL[rule!.scope]} · {MEMORY_INJECT_LABEL[rule!.inject]}
                          {live ? ` · ${(live.used ?? 0).toLocaleString()} 字${live.needDistill ? " · 需蒸馏" : ""}` : " · 未读取"}
                        </span>
                      </span>
                      <span className="lib-book-bar"><i style={{ width: `${Math.min(100, rowPct)}%` }} /></span>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}

        <footer className="lib-foot">
          <span className="lib-foot-note"><FolderOpen size={12} />共享层的内容对所有会话都一样 —— 换个会话看，这里不变。</span>
          {onOpenCenter && <button className="secondary-setting" onClick={onOpenCenter}>看全文 / 编辑</button>}
        </footer>
      </div>
    </div>
  );
}
