/**
 * 任务监控面板（右栏「监控」页，10-30 用户令）。
 *
 * 三段（自上而下）：
 *   ① 技能 / MCP / 插件 —— 只取**当前回合 + 上回合**，每页最多 5 条。
 *   ② 会话产物 —— 每回合一块（本轮改动的全部文件，含新增/修改/删除），每页 10 轮、最新在前。
 *   ③ 网页查阅 —— 最新回合访问过的站点。
 *
 * ⛔ 10-31 用户令：「自我进化建议这个板块和配套删了，不要了」——
 *   原来第一段（模型每轮自动复盘 + 可编辑 + 采取建议 + .evolve.md 文件）整块删除，
 *   连带主进程的生成链 / 三个 IPC 通道。⛔ 别只把 UI 藏起来：留后台每轮调一次模型 =
 *   白烧 token + 侧栏冒出内部会话（那次 30 秒 9 条的教训）。
 *
 * ⛔ 一切按 threadId 取（主进程同样只认传入的 id）—— 换会话必须换数据，绝不复用上一会话的缓存。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ChevronLeft, ChevronRight, Globe2, RefreshCw } from "lucide-react";
import type { HarnessAppApi } from "../app-state";
import { WebFavicon } from "../shared/TurnWebSources";
import { collectTurnWebSources } from "../../lib/turn-web-sources.mjs";

type Artifact = { path: string; added: number; deleted: number; status?: string };
type Turn = {
  turnId: string;
  at: number;
  skills: string[];
  mcp: string[];
  plugins: string[];
  artifacts: Artifact[];
  /** 主进程标记：这一轮还在跑（面板据此显示「本轮进行中」） */
  running?: boolean;
};

const PAGE_FILES = 10;    // 产物段每页 10 轮

const fmtTime = (ts: number) => {
  const d = new Date(ts || 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const baseName = (p: string) => String(p || "").replaceAll("\\", "/").split("/").pop() || p;

export function TaskMonitorPanel({ app, active = true }: { app: HarnessAppApi; active?: boolean }) {
  const threadId = app.thread?.id ?? "";
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  /* 主进程交回的「进行中回合 id」：与 latest.turnId 相同 ⇒ 这一轮还没结束 */
  const [ongoingId, setOngoingId] = useState("");
  const [filePage, setFilePage] = useState(0);
  /** 网页查阅：默认只列前 6 个，「查看更多」展开全部（与 Qoder 同款形态）。 */
  const [webExpanded, setWebExpanded] = useState(false);

  const load = useCallback(async () => {
    if (!threadId) { setTurns([]); return; }
    setLoading(true);
    try {
      const result: { turns?: Turn[]; ongoingTurnId?: string } | null = await window.codex.readTaskMonitor(threadId);
      setTurns(Array.isArray(result?.turns) ? result.turns : []);
      setOngoingId(String(result?.ongoingTurnId ?? ""));
    } catch { /* 读不到就保持上一次（不闪空） */ } finally { setLoading(false); }
  }, [threadId]);

  /* 换会话 ⇒ 立刻清空并重读（⛔ 不保留上一会话的 turns） */
  useEffect(() => { setTurns([]); setFilePage(0); void load(); }, [threadId, load]);

  /* 只有「引擎真的还有进行中的回合」时才轻量轮询（拿到就停）。
     ⛔ 不要退回「最近一轮还没生成建议」那种判据 —— 那条恒真，面板会永远每 3s 刷一次。 */
  const pendingWork = Boolean(ongoingId);
  useEffect(() => {
    if (!threadId || !active || !pendingWork) return;
    const timer = window.setInterval(() => { void load(); }, 3000);
    return () => window.clearInterval(timer);
  }, [threadId, active, pendingWork, load]);

  const latest = turns[turns.length - 1];
  const prev = turns[turns.length - 2];

  const usage = useMemo(() => {
    /* 技能/MCP/插件只取当前回合 + 上回合（用户口径），每页 5 条 */
    const rows: { label: string; values: string[] }[] = [];
    const add = (label: string, values: string[]) => { if (values.length) rows.push({ label, values }); };
    add(`本回合技能（${latest ? fmtTime(latest.at) : "—"}）`, latest?.skills ?? []);
    add(`上回合技能`, prev?.skills ?? []);
    add("MCP", [...(latest?.mcp ?? []), ...(prev?.mcp ?? [])]);
    add("插件 / 宿主能力", [...(latest?.plugins ?? []), ...(prev?.plugins ?? [])]);
    return rows;
  }, [latest, prev]);

  const fileTurns = useMemo(() => [...turns].reverse(), [turns]);
  /* ★ 10-31 用户令：「下面再加一个最新回合查询过的网页，接线展示到这里」——
     数据源 = **最新回合**的 items（含运行中），与消息底部「网页来源」同一份纯函数
     collectTurnWebSources（⛔ 不另写一套 URL 提取）。切换会话/新回合开始时自动换。 */
  const latestTurn = app.thread?.turns?.at(-1);
  const webSources = useMemo(() => (latestTurn ? collectTurnWebSources(latestTurn as { items?: Array<{ type: string; [key: string]: unknown }> }) : []), [latestTurn]);
  const visibleWeb = webExpanded ? webSources : webSources.slice(0, 6);
  const pageCount = Math.max(1, Math.ceil(fileTurns.length / PAGE_FILES));
  const pageTurns = fileTurns.slice(filePage * PAGE_FILES, filePage * PAGE_FILES + PAGE_FILES);

  return (
    <div className="monitor-panel" data-testid="task-monitor-panel" data-thread-id={threadId}>
      <header className="monitor-head">
        <Activity size={13} className="ic-blue" />
        <strong>任务监控</strong>
        <span className="monitor-sub">{threadId ? `本会话 · ${turns.length} 轮${ongoingId ? " · 本轮进行中" : ""}` : "未选中会话"}</span>
        <button type="button" className="icon-button" title="刷新" onClick={() => void load()}><RefreshCw size={12} className={loading ? "spin" : ""} /></button>
      </header>

      {/* ① 技能 / MCP / 插件 */}
      <section className="monitor-block">
        <div className="monitor-block-head"><strong>技能 / MCP / 插件</strong><span className="monitor-hint">本回合 + 上回合</span></div>
        {usage.length ? usage.map((row) => (
          <div className="monitor-usage" key={row.label}>
            <div className="monitor-usage-label">{row.label}</div>
            <div className="monitor-chips">
              {row.values.slice(0, 5).map((value) => <span className="monitor-chip" key={row.label + value} title={value}>{value}</span>)}
              {row.values.length > 5 && <span className="monitor-chip more">+{row.values.length - 5}</span>}
              {!row.values.length && <span className="monitor-empty">—</span>}
            </div>
          </div>
        )) : <div className="monitor-empty">暂无使用记录</div>}
      </section>

      {/* ② 会话产物（每回合一块，分页） */}
      <section className="monitor-block grow">
        <div className="monitor-block-head">
          <strong>会话产物</strong>
          <span className="monitor-hint">{fileTurns.length} 轮</span>
          <div className="monitor-pager">
            <button type="button" className="icon-button" title="上一页" disabled={filePage <= 0} onClick={() => setFilePage((p) => Math.max(0, p - 1))}><ChevronLeft size={12} /></button>
            <span>{filePage + 1} / {pageCount}</span>
            <button type="button" className="icon-button" title="下一页" disabled={filePage >= pageCount - 1} onClick={() => setFilePage((p) => Math.min(pageCount - 1, p + 1))}><ChevronRight size={12} /></button>
          </div>
        </div>
        <div className="monitor-artifacts">
          {pageTurns.map((turn, index) => (
            <div className="monitor-turn" key={turn.turnId}>
              <div className="monitor-turn-head">
                <span>第 {fileTurns.length - (filePage * PAGE_FILES + index)} 轮</span>
                <em>{fmtTime(turn.at)}</em>
                <span className="monitor-turn-count">{turn.artifacts.length} 个文件</span>
              </div>
              {turn.artifacts.length ? turn.artifacts.map((file) => {
                /* ★ 10-31 用户令：「产出文件如果删除后，加一个这个划线显示」——
                   status=deleted 的行加删除线（并禁用打开：文件已经不在磁盘上了）。 */
                const deleted = String(file.status ?? "") === "deleted";
                return (
                  <button type="button" className={`monitor-file${deleted ? " is-deleted" : ""}`} key={turn.turnId + file.path}
                    title={deleted ? `${file.path}（已删除）` : file.path}
                    disabled={deleted}
                    onClick={() => app.openFile?.(file.path)}>
                    <b>{baseName(file.path)}</b>
                    {deleted ? <span className="monitor-file-flag">已删除</span> : null}
                    <i>+{file.added}</i><em>-{file.deleted}</em>
                  </button>
                );
              }) : <div className="monitor-empty">暂无文件</div>}
            </div>
          ))}
          {!pageTurns.length && <div className="monitor-empty">暂无文件</div>}
        </div>
      </section>

      {/* ③ 最新回合的网页查阅（10-31 用户令）：与消息底部「网页来源」同源，切换会话/新回合自动换 */}
      <section className="monitor-block">
        <div className="monitor-block-head">
          <Globe2 size={12} className="ic-blue" /><strong>网页查阅</strong>
          <span className="monitor-hint">{webSources.length ? `${webSources.length} 个网站 · 最新回合` : "最新回合"}</span>
        </div>
        {webSources.length ? (
          <div className="monitor-web-list">
            {visibleWeb.map((source) => (
              <button type="button" key={source.host} className="monitor-web"
                title={`${source.url}（默认浏览器打开）`}
                onClick={() => { try { void window.codex.openExternal(source.url); } catch { /* 外部浏览器可能被拒 */ } }}>
                <WebFavicon host={source.host} size={14} />
                <span>{source.host}</span>
              </button>
            ))}
            {webSources.length > 6 && !webExpanded ? (
              <button type="button" className="monitor-web-more" onClick={() => setWebExpanded(true)}>查看更多（{webSources.length - 6}）</button>
            ) : null}
          </div>
        ) : <div className="monitor-empty">这一轮没有访问网页</div>}
      </section>
    </div>
  );
}
