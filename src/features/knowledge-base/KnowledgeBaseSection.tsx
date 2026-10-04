/**
 * 知识库设置页（knowledge-base 域，10-01 立项）：**项目级**本地知识库。
 * 落点 = <项目>/.codex-harness/knowledge/（随项目走）；v1 检索 = 分块全文评分（零依赖）。
 * 自包含形态（组件库页同款）：列表 / 导入（多选 md·txt 等文本文件 + 粘贴文本）/ 搜索 / 删除。
 * ⛔ 未选工作区时功能不可用——知识库是项目级的，必须先有项目。
 */
import { useCallback, useEffect, useState } from "react";
import { FilePlus2, FolderOpen, Library, RefreshCw, Search, Trash2 } from "lucide-react";
import { PageInfo } from "../../components/SettingsHead";
import { Spinner } from "../../components/CardShell";

type KbDoc = { id: string; title: string; source: string; chunks: number; addedAt: string; bytes: number };
type KbHit = { docId: string; title: string; chunkIndex: number; score: number; snippet: string };

export type KnowledgeBaseSectionProps = { workspace: string; setNotice: (m: string) => void };

export function KnowledgeBaseSection({ workspace, setNotice }: KnowledgeBaseSectionProps) {
  const [docs, setDocs] = useState<KbDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<KbHit[] | null>(null);
  const [busy, setBusy] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteText, setPasteText] = useState("");

  const load = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    try { setDocs(await window.codex.listKnowledgeDocs({ workspace })); }
    catch (error: any) { setNotice(`知识库读取失败：${error?.message ?? error}`); }
    finally { setLoading(false); }
  }, [workspace, setNotice]);

  useEffect(() => { void load(); setHits(null); setQuery(""); }, [workspace]);

  const importFiles = async () => {
    if (!workspace) { setNotice("先在会话里选择工作目录——知识库是项目级的"); return; }
    const picked = await window.codex.chooseFiles().catch(() => [] as string[]);
    if (!picked?.length) return;
    setBusy("import");
    try {
      const result = await window.codex.addKnowledgeFiles({ workspace, paths: picked });
      setNotice(`已导入 ${result.imported.length} 个文档${result.failures.length ? `；${result.failures.length} 个失败（${result.failures[0]}）` : ""}`);
      await load();
    } catch (error: any) { setNotice(`导入失败：${error?.message ?? error}`); }
    finally { setBusy(""); }
  };

  const importPaste = async () => {
    if (!pasteText.trim()) { setNotice("先粘贴要入库的内容"); return; }
    setBusy("paste");
    try {
      const meta = await window.codex.addKnowledgeText({ workspace, title: pasteTitle.trim() || "粘贴的笔记", text: pasteText });
      setNotice(`已导入「${meta.title}」（${meta.chunks} 块）`);
      setPasteOpen(false); setPasteTitle(""); setPasteText("");
      await load();
    } catch (error: any) { setNotice(`导入失败：${error?.message ?? error}`); }
    finally { setBusy(""); }
  };

  const doSearch = async () => {
    if (!query.trim()) { setHits(null); return; }
    setBusy("search");
    try { setHits(await window.codex.searchKnowledge({ workspace, query, limit: 12 })); }
    catch (error: any) { setNotice(`检索失败：${error?.message ?? error}`); }
    finally { setBusy(""); }
  };

  const remove = async (doc: KbDoc) => {
    setBusy(doc.id);
    try {
      await window.codex.removeKnowledgeDoc({ workspace, docId: doc.id });
      setNotice(`已删除「${doc.title}」`);
      await load();
    } catch (error: any) { setNotice(`删除失败：${error?.message ?? error}`); }
    finally { setBusy(""); }
  };

  if (!workspace) {
    return (
      <section className="settings-section stack kb-page">
        <div className="settings-copy"><h2>知识库<PageInfo text="项目级本地知识库：文档落在 <项目>/.codex-harness/knowledge/，随项目走。" helpKey="knowledge-base" label="知识库" /></h2></div>
        <p className="muted">还没有选择工作目录——知识库是**项目级**的，先在会话里选择一个工作文件夹。</p>
      </section>
    );
  }

  return (
    <section className="settings-section stack kb-page">
      <div className="settings-copy"><h2>知识库<PageInfo text={<>项目级本地知识库：文档落在 <code>{workspace}\.codex-harness\knowledge\</code>，随项目走。检索 v1 = 分块全文评分（零依赖、离线可用）；语义向量检索后端（LanceDB + 本地 embedding）将在开发工具页按需提供。</>} helpKey="knowledge-base" label="知识库" /></h2></div>

      <div className="resource-toolbar">
        <div className="kb-search"><Search size={13} /><input value={query} placeholder="在知识库中检索…" onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void doSearch(); }} /></div>
        <button className="secondary-setting" disabled={busy === "search"} onClick={() => void doSearch()}>{busy === "search" ? <Spinner /> : <Search size={13} />}检索</button>
        <button className="secondary-setting" disabled={Boolean(busy)} title="从本机选择一个或多个文本文件（md / txt / 代码等）导入" onClick={() => void importFiles()}>{busy === "import" ? <Spinner /> : <FilePlus2 size={13} />}导入文件</button>
        <button className="secondary-setting" disabled={Boolean(busy)} onClick={() => setPasteOpen((v) => !v)}><Library size={13} />粘贴文本</button>
        <button className="icon-button" title="刷新" onClick={() => void load()}>{loading ? <Spinner /> : <RefreshCw size={14} />}</button>
      </div>

      {pasteOpen && (
        <div className="kb-paste">
          <input value={pasteTitle} placeholder="标题（可留空）" onChange={(event) => setPasteTitle(event.target.value)} />
          <textarea value={pasteText} placeholder="粘贴要入库的内容…" rows={5} onChange={(event) => setPasteText(event.target.value)} />
          <button className="secondary-setting" disabled={busy === "paste"} onClick={() => void importPaste()}>{busy === "paste" ? <Spinner /> : null}入库</button>
        </div>
      )}

      {hits !== null ? (
        hits.length ? (
          <div className="kb-hits">
            {hits.map((hit, index) => (
              <div className="kb-hit" key={hit.docId + ":" + hit.chunkIndex}>
                <span className="kb-hit-title">{hit.title} · 第 {hit.chunkIndex + 1} 块</span>
                <p>{hit.snippet}</p>
                {index === 0 ? <em className="kb-hit-top">最相关</em> : null}
              </div>
            ))}
          </div>
        ) : <p className="muted">没有命中的内容——换个关键词，或确认相关文档已导入。</p>
      ) : (
        docs.length ? <div className="kb-docs">
          {docs.map((doc) => (
            <div className="kb-doc" key={doc.id}>
              <span className="kb-doc-main"><strong>{doc.title}</strong><small>{doc.chunks} 块 · {Math.max(1, Math.round(doc.bytes / 1024))} KB</small></span>
              <button className="icon-button" title={`删除「${doc.title}」`} disabled={Boolean(busy)} onClick={() => void remove(doc)}>{busy === doc.id ? <Spinner /> : <Trash2 size={13} />}</button>
            </div>
          ))}
        </div> : <p className="muted">{loading ? "正在加载…" : "知识库还是空的——用上面「导入文件」或「粘贴文本」添加第一份文档。"}</p>
      )}
    </section>
  );
}
