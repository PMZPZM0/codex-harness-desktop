/**
 * 开发日记弹层（10-27）。
 *
 * 用户：「第三个开发日记，日记弹窗也做好看一点，记开发日志的，功能配套齐全」。
 * 存储：主进程 `userData/dev-journal/YYYY-MM-DD.md`（一天一个文件，多条追加）。
 * 功能：按天列表 + 搜索 + 今天快速记一条（追加）/ 打开某天整篇编辑 / 删除某天 / 一键插入输入框。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, NotebookPen, Plus, Search, Trash2 } from "lucide-react";

type Day = JournalDay;

export function DevJournalPanel({ onInsert }: { onInsert: (text: string) => void }) {
  const [days, setDays] = useState<Day[]>([]);
  const [today, setToday] = useState("");
  const [dir, setDir] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ date: string; lines: string[] }[] | null>(null);
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [confirmDate, setConfirmDate] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await window.codex.journalList();
      setDays(result.days);
      setToday(result.today);
      setDir(result.dir);
    } catch { /* 主进程不在就保持空列表，不弹错误 */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const q = query.trim();
    if (!q) { setHits(null); return; }
    const timer = window.setTimeout(() => {
      void window.codex.journalSearch(q).then((result) => setHits(result.hits)).catch(() => setHits([]));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  async function openDay(date: string) {
    setBusy(true);
    try {
      const result = await window.codex.journalRead(date);
      setOpenDate(date);
      setContent(result.content);
      setComposing(false);
    } finally { setBusy(false); }
  }

  async function saveDay() {
    if (!openDate || busy) return;
    setBusy(true);
    try {
      const result = await window.codex.journalSave(openDate, content);
      setDays(result.days);
    } finally { setBusy(false); }
  }

  async function appendToday() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await window.codex.journalAppend(today, title, body);
      setDays(result.days);
      setTitle("");
      setBody("");
      setComposing(false);
    } finally { setBusy(false); }
  }

  async function removeDay(date: string) {
    setBusy(true);
    try {
      const result = await window.codex.journalRemove(date);
      setDays(result.days);
      setConfirmDate(null);
      if (openDate === date) { setOpenDate(null); setContent(""); }
    } finally { setBusy(false); }
  }

  const list = useMemo(() => (hits ? hits.map((hit) => ({ date: hit.date, title: hit.lines[0] ?? "", lines: hit.lines })) : days.map((day) => ({ date: day.date, title: day.title, lines: null as string[] | null }))), [days, hits]);

  if (openDate) {
    return (
      <div className="journal-editor">
        <div className="journal-editor-bar">
          <button type="button" className="secondary-setting" onClick={() => { setOpenDate(null); void load(); }}><ChevronLeft size={13} />返回</button>
          <strong>{openDate}</strong>
          <span className="journal-editor-actions">
            <button type="button" className="secondary-setting" onClick={() => onInsert(content)} title="把这篇日记插入输入框，让 Codex 参考">插入输入框</button>
            <button type="button" className="primary-setting" disabled={busy} onClick={() => void saveDay()}>{busy ? "保存中…" : <><Check size={13} />保存</>}</button>
          </span>
        </div>
        <textarea className="journal-textarea" value={content} spellCheck={false} aria-label={`${openDate} 的开发日记`} onChange={(event) => setContent(event.target.value)} />
      </div>
    );
  }

  return (
    <div className="journal">
      <div className="journal-bar">
        <span className="vault-search"><Search size={13} /><input value={query} placeholder="搜索日记内容" aria-label="搜索开发日记" onChange={(event) => setQuery(event.target.value)} /></span>
        <button type="button" className="primary-setting" onClick={() => setComposing((value) => !value)}><Plus size={13} />今天记一条</button>
      </div>

      {composing && (
        <div className="journal-compose">
          <input value={title} maxLength={120} placeholder="标题（可留空）" aria-label="日记标题" onChange={(event) => setTitle(event.target.value)} />
          <textarea value={body} rows={3} placeholder="今天做了什么 / 卡在哪 / 结论是什么" aria-label="日记正文" onChange={(event) => setBody(event.target.value)} />
          <div className="journal-compose-actions">
            <button type="button" className="secondary-setting" onClick={() => setComposing(false)}>取消</button>
            <button type="button" className="primary-setting" disabled={busy || !body.trim()} onClick={() => void appendToday()}>{busy ? "写入中…" : <><Check size={13} />追加到 {today}</>}</button>
          </div>
        </div>
      )}

      {!list.length ? (
        <div className="vault-empty"><NotebookPen size={26} /><strong>{query ? "没有匹配的日记" : "还没有写开发日记"}</strong><p>{query ? "换个关键词试试。" : "点右上「今天记一条」写下第一段；每天一个 Markdown 文件，随时能插入输入框给 Codex 参考。"}</p></div>
      ) : (
        <ul className="journal-list">
          {list.map((entry) => (
            <li key={entry.date} className="journal-item">
              <button type="button" className="journal-item-main" onClick={() => void openDay(entry.date)}>
                <strong>{entry.date}{entry.date === today ? <em className="journal-today">今天</em> : null}</strong>
                {entry.lines ? entry.lines.map((line, index) => <span key={index} className="journal-hit">{line}</span>) : <span className="journal-item-sub">{entry.title || "（空白）"}</span>}
              </button>
              {confirmDate === entry.date ? (
                <span className="journal-item-actions">
                  <button type="button" className="secondary-setting vault-danger" disabled={busy} onClick={() => void removeDay(entry.date)}>确认删除</button>
                  <button type="button" className="secondary-setting" onClick={() => setConfirmDate(null)}>取消</button>
                </span>
              ) : (
                <button type="button" className="icon-button vault-danger" title="删除这一天" aria-label="删除这一天" onClick={() => setConfirmDate(entry.date)}><Trash2 size={13} /></button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="vault-footer" title={dir}>存在 {dir || "userData/dev-journal"}（一天一个 .md，纯文本）</p>
    </div>
  );
}
