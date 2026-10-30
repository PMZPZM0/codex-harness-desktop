/**
 * 任务监控面板（右栏「监控」页，10-30 用户令）。
 *
 * 三段（自上而下，与用户口述顺序一致）：
 *   ① 自我改进建议 —— 由**本会话模型**每轮产出（主进程 monitor 域），可编辑；「进化」= 填进输入框 +
 *      挂 self-review 技能（⛔ 不直接 send：React 状态没刷新时 send 读到的还是旧 bag，技能会丢）。
 *   ② 技能 / MCP / 插件 —— 只取**当前回合 + 上回合**，每页最多 5 条。
 *   ③ 会话产物 —— 每回合一块（本轮改动的全部文件，含新增/修改/删除），每页 10 轮、最新在前。
 *
 * ⛔ 一切按 threadId 取（主进程同样只认传入的 id）—— 换会话必须换数据，绝不复用上一会话的缓存。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ChevronLeft, ChevronRight, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import type { HarnessAppApi } from "../app-state";

type Artifact = { path: string; added: number; deleted: number; status?: string };
type Turn = {
  turnId: string;
  at: number;
  skills: string[];
  mcp: string[];
  plugins: string[];
  artifacts: Artifact[];
  suggestion: string;
  suggestionState: "idle" | "running" | "ready" | "failed";
  suggestionError?: string;
};

/** 自我进化技能（与 electron/skill-pack.ts 的 SELF_REVIEW_SKILL 同名） */
const EVOLVE_SKILL = {
  name: "self-review",
  description: "自我进化：记录报错、用户纠正与更好做法，持续沉淀为可复用经验",
};

const PAGE_TURNS = 1;     // 建议/技能段只看最近 2 轮 ⇒ 每页 1 轮 × 2 页窗口
const PAGE_FILES = 10;    // 产物段每页 10 轮

const fmtTime = (ts: number) => {
  const d = new Date(ts || 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const baseName = (p: string) => String(p || "").replaceAll("\\", "/").split("/").pop() || p;

export function TaskMonitorPanel({ app }: { app: HarnessAppApi }) {
  const threadId = app.thread?.id ?? "";
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [filePage, setFilePage] = useState(0);

  const load = useCallback(async () => {
    if (!threadId) { setTurns([]); return; }
    setLoading(true);
    try {
      const result: { turns?: Turn[] } | null = await window.codex.readTaskMonitor(threadId);
      setTurns(Array.isArray(result?.turns) ? result.turns : []);
    } catch { /* 读不到就保持上一次（不闪空） */ } finally { setLoading(false); }
  }, [threadId]);

  /* 换会话 ⇒ 立刻清空并重读（⛔ 不保留上一会话的 turns） */
  useEffect(() => { setTurns([]); setDraft(""); setFilePage(0); void load(); }, [threadId, load]);

  /* 建议由主进程异步生成（回合结束后才回来）⇒ 面板可见时轻量轮询，拿到就停。 */
  useEffect(() => {
    if (!threadId) return;
    const timer = window.setInterval(() => {
      const pending = turns.some((t) => t.suggestionState === "running" || (!t.suggestion && t.suggestionState === "idle" && t.turnId === latest?.turnId));
      if (pending) void load();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [threadId, turns, load]);

  const latest = turns[turns.length - 1];
  const prev = turns[turns.length - 2];

  /* 建议编辑态跟随「最新一轮」；用户改过就先不覆盖（等保存或切轮） */
  useEffect(() => { setDraft(latest?.suggestion ?? ""); }, [latest?.turnId, latest?.suggestion]);

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
  const pageCount = Math.max(1, Math.ceil(fileTurns.length / PAGE_FILES));
  const pageTurns = fileTurns.slice(filePage * PAGE_FILES, filePage * PAGE_FILES + PAGE_FILES);

  const saveSuggestion = async (text: string) => {
    if (!threadId || !latest) return;
    setSaving(true);
    try { await window.codex.saveMonitorSuggestion({ threadId, turnId: latest.turnId, text }); } catch { /* 保存失败不阻塞编辑 */ } finally { setSaving(false); }
  };

  const evolve = async () => {
    const text = draft.trim();
    if (!text) { app.showToast("还没有建议", "等这一轮生成完，或点右上角重新生成"); return; }
    /* ⛔ 真·一键发送：文本走 pendingCommandTextRef、技能走 pendingSkillRef（两条一次性 ref）——
       不用 setPrompt/addSkillReference 再 send：那两个是 setState，send 读到的是**上一次渲染**的 bag，
       结果就是发出去旧正文、技能还被丢掉（这坑踩过一次）。
       ⛔ 走 `app.sendPrefilled`（bag 上的绑定包装），不拿 app 当 bag 硬转：sendImpl 要读几十个
       bag 字段，而 app 是各 part 返回值的合并对象，缺字段时会在发送中途静默走错分支。 */
    try {
      await app.sendPrefilled({ text, skill: EVOLVE_SKILL });
      app.showToast("已发给本会话", "已带上 self-review 技能");
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      app.showToast("发送失败", reason.slice(0, 120));
    }
  };

  const regenerate = async () => {
    if (!threadId || !latest) return;
    try { await window.codex.regenerateMonitorSuggestion({ threadId, turnId: latest.turnId }); } catch { /* 忽略 */ }
    void load();
  };

  return (
    <div className="monitor-panel" data-testid="task-monitor-panel" data-thread-id={threadId}>
      <header className="monitor-head">
        <Activity size={13} className="ic-blue" />
        <strong>任务监控</strong>
        <span className="monitor-sub">{threadId ? `本会话 · ${turns.length} 轮` : "未选中会话"}</span>
        <button type="button" className="icon-button" title="刷新" onClick={() => void load()}><RefreshCw size={12} className={loading ? "spin" : ""} /></button>
      </header>

      {/* ① 自我改进建议 */}
      <section className="monitor-block">
        <div className="monitor-block-head">
          <Sparkles size={12} className="ic-amber" /><strong>自我改进建议</strong>
          <span className="monitor-hint">{!latest ? "暂无建议" : latest.suggestionState === "running" ? "本会话正在复盘…" : latest.suggestionState === "failed" ? `生成失败：${latest.suggestionError ?? ""}` : (latest.suggestion ? "由本会话 Codex 每轮更新" : "暂无建议")}</span>
          <button type="button" className="monitor-mini" onClick={() => void regenerate()} disabled={!latest || latest.suggestionState === "running"} title="让本会话重新给一版建议"><RefreshCw size={11} />重新生成</button>
        </div>
        <textarea
          className="monitor-suggestion"
          value={draft}
          placeholder={latest ? "暂无建议（纯聊天轮不生成）" : "暂无建议"}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void saveSuggestion(draft)}
        />
        <div className="monitor-actions">
          <button type="button" className="monitor-btn primary" onClick={evolve} disabled={!draft.trim()}><Wand2 size={12} />进化（带上技能发回对话）</button>
          <button type="button" className="monitor-btn" onClick={() => void saveSuggestion(draft)} disabled={!latest || saving}>{saving ? "保存中…" : "保存修改"}</button>
        </div>
      </section>

      {/* ② 技能 / MCP / 插件 */}
      <section className="monitor-block">
        <div className="monitor-block-head"><strong>技能与 MCP / 插件</strong><span className="monitor-hint">当前回合 + 上回合，每页 5 条</span></div>
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

      {/* ③ 会话产物（每回合一块，分页） */}
      <section className="monitor-block grow">
        <div className="monitor-block-head">
          <strong>会话产物</strong>
          <span className="monitor-hint">{fileTurns.length} 轮 · 每页 {PAGE_FILES}</span>
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
              {turn.artifacts.length ? turn.artifacts.map((file) => (
                <button type="button" className="monitor-file" key={turn.turnId + file.path} title={file.path} onClick={() => app.openFile?.(file.path)}>
                  <b>{baseName(file.path)}</b>
                  <i>+{file.added}</i><em>-{file.deleted}</em>
                </button>
              )) : <div className="monitor-empty">暂无文件</div>}
            </div>
          ))}
          {!pageTurns.length && <div className="monitor-empty">暂无文件</div>}
        </div>
      </section>
    </div>
  );
}
