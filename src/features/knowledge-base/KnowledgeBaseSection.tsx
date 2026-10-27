/**
 * 知识库设置页（knowledge-base 域，10-01 立项）：**项目级**本地知识库。
 * 落点 = <项目>/.codex-harness/knowledge/（随项目走）；v1 检索 = 分块全文评分（零依赖）。
 * 自包含形态（组件库页同款）：列表 / 导入（多选 md·txt 等文本文件 + 粘贴文本）/ 搜索 / 删除。
 * ⛔ 未选工作区时功能不可用——知识库是项目级的，必须先有项目。
 */
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, FilePlus2, FolderOpen, Library, RefreshCw, Search, Trash2, X, ArrowDown } from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { refreshWithReceipt } from "../../lib/refresh-receipt.mjs";
import { isMacPlatform } from "../../lib/is-mac-platform";

/** 路径分隔符：mac/Linux 用 `/`，Windows 用 `\`（⛔ 渲染层没有 node:path，按平台取字面量）。
 *  10-26 mac 适配审计：这里原来写死 `\.codex-harness\knowledge` ⇒ mac 上显示成 `/a\b\c`。 */
const SEP = isMacPlatform() ? "/" : "\\";

type KbDoc = { id: string; title: string; source: string; chunks: number; addedAt: string; bytes: number };
type KbHit = { docId: string; title: string; chunkIndex: number; score: number; snippet: string };

export type KnowledgeBaseSectionProps = { workspace: string; setNotice: (m: string) => void };

export function KnowledgeBaseSection({ workspace, setNotice }: KnowledgeBaseSectionProps) {
  /* 10-20：知识库后端 —— local=项目本地库（kb:*）/ cloud=云端 weknora（MCP 工具检索） */
  const [kbBackend, setKbBackend] = useState<"local" | "cloud">("local");
  const [docs, setDocs] = useState<KbDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<KbHit[] | null>(null);
  const [semantic, setSemantic] = useState<boolean | null>(null);
  const [busy, setBusy] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [preview, setPreview] = useState<{ meta: KbDoc; text: string } | null>(null);
  /* 本地语义后端（按需下载，10-04）：状态 + 安装进度（进度事件复用主进程 runtime:progress，id=kb-embedding） */
  const [embedInstalled, setEmbedInstalled] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await window.codex.kbBackendGet?.();
        if (alive && r?.backend === "cloud") setKbBackend("cloud");
      } catch { /* 读不到就按本地算 */ }
    })();
    return () => { alive = false; };
  }, []);
  const [embedBusy, setEmbedBusy] = useState(false);
  const [embedProg, setEmbedProg] = useState<{ percent?: number; speed?: string; remaining?: string; message?: string } | null>(null);

  /* 切换知识库后端：写设置 + **联动连接器**（主进程 applyKbBackend），并按**真实结果**提示。
     ⛔ 不能只看设置写成功就报「已切换」—— 切云端时若账号没开通权益，连接器会被停用，
        模型侧根本拿不到 `cloud_kb__*`，这时必须如实说「未接通」，否则用户以为云端已经在用。 */
  const switchKbBackend = async (next: "local" | "cloud") => {
    setKbBackend(next);
    try {
      const r: any = await window.codex.kbBackendSet?.(next);
      if (next === "cloud") {
        if (r?.connector?.applied === false) setNotice(`已切到云端，但连接器未接通：${r.connector.note ?? "原因未知"}（模型侧暂时拿不到云端工具）`);
        else if (r?.connector?.note) setNotice(`已切到云端，但未接通：${r.connector.note}（账号可能未开通云端知识库）`);
        else setNotice("知识库已切到云端（weknora）");
      } else {
        setNotice("知识库已切到本地项目库（云端工具已从模型侧移除）");
      }
    } catch (error: any) {
      setNotice(`切换失败：${error?.message ?? error}`);
    }
  };

  const refreshEmbedStatus = useCallback(async () => {
    try { setEmbedInstalled(Boolean((await window.codex.getKbEmbedStatus())?.installed)); }
    catch { setEmbedInstalled(false); }
  }, []);

  useEffect(() => {
    void refreshEmbedStatus();
    const off = window.codex.onRuntimeProgress((payload: any) => {
      if (payload?.id !== "kb-embedding") return;
      if (payload.done) { setEmbedBusy(false); setEmbedProg(null); void refreshEmbedStatus(); }
      else setEmbedProg(payload);
    });
    return off;
  }, [refreshEmbedStatus]);

  const installEmbed = async () => {
    setEmbedBusy(true);
    try { await window.codex.installKbEmbedBackend(); setNotice("本地语义检索已就绪——之后的导入与检索都会带上语义档"); }
    catch (error: any) { setNotice(`安装失败：${error?.message ?? error}`); }
    finally { setEmbedBusy(false); }
  };

  const openPreview = async (doc: KbDoc) => {
    try {
      const result = await window.codex.readKnowledgeDoc({ workspace, docId: doc.id });
      if (result) setPreview(result);
      else setNotice(`读不到「${doc.title}」——文件可能已被删除`);
    } catch (error: any) { setNotice(`预览失败：${error?.message ?? error}`); }
  };

  const load = useCallback(async () => {
    if (!workspace) return "先在会话里选择工作目录——知识库是项目级的";
    setLoading(true);
    try { setDocs(await window.codex.listKnowledgeDocs({ workspace })); }
    // ⛔ 失败原因交回调用方（本函数吞了异常，按钮侧的回执靠它区分「完成」与「失败」）
    catch (error: any) { setNotice(`知识库读取失败：${error?.message ?? error}`); return String(error?.message ?? error); }
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
    try {
      /* kb:search 返回 { hits, semantic }（10-01 第三步）：semantic=true 表示带上了语义向量档
         （供应商 /embeddings 可用），false = 纯全文（embedding 不可用时自动回落，不报错）。 */
      const result = await window.codex.searchKnowledge({ workspace, query, limit: 12 }) as any;
      const list = Array.isArray(result) ? result : (result?.hits ?? []);
      setHits(list);
      setSemantic(Array.isArray(result) ? null : Boolean(result?.semantic));
    }
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
        <p className="muted">还没有选择工作目录——知识库是**项目级**的，先在会话里选择一个工作文件夹。</p>
      </section>
    );
  }

  return (
    <section className="settings-section stack kb-page">
      {/* 10-20：知识库后端二选一 —— 本地项目库 / 云端 weknora（MCP）。
          ⛔ 切换**必须**落到连接器上（`kb:backend-set` 会启用/停用 cloud-kb 连接器并失效工具缓存），
             否则设置变了、云端 6 个工具还在模型工具列表里 ⇒ 模型拿云端工具去查本地库。 */}
      <div className="memory-mode-switch" role="tablist" aria-label="知识库来源">
        <button role="tab" aria-selected={kbBackend === "local"} className={`memory-mode-card ${kbBackend === "local" ? "active" : ""}`}
          onClick={() => { void switchKbBackend("local"); }}>
          <div className="memory-mode-body"><strong>本地知识库</strong><span>项目级 · 文件随项目走 · 离线可用</span></div>
        </button>
        <button role="tab" aria-selected={kbBackend === "cloud"} className={`memory-mode-card ${kbBackend === "cloud" ? "active" : ""}`}
          onClick={() => { void switchKbBackend("cloud"); }}>
          <div className="memory-mode-body"><strong>云端知识库</strong><span>weknora · 每账号独立库 · 用 MCP 工具检索</span></div>
        </button>
      </div>
      {kbBackend === "cloud" ? (
        <div className="memory-center-block" style={{ marginBottom: 12 }}>
          <div className="memory-center-block-head">
            <div>
              <strong>当前使用云端知识库</strong>
              <span>库与文档由云账号管理；模型侧通过 MCP 工具检索（<code>cloud_kb__ask</code> / <code>cloud_kb__search_knowledge</code> / <code>cloud_kb__grep_chunks</code> / <code>cloud_kb__list_documents</code> / <code>cloud_kb__read_document</code> / <code>cloud_kb__list_knowledge_bases</code>）。下面的本地库导入与检索在此模式下<b>不生效</b>（数据不会被删除，切回本地即可继续用）。</span>
            </div>
          </div>
        </div>
      ) : null}
      {/* ⛔ 10-20：这块讲的是**本地库**。云端后端下它不再生效，标题必须如实标明 ——
          否则用户看到「文档落在 <workspace>/…」会以为这就是模型正在查的东西（两套库是独立数据）。 */}

      {/* 本地语义后端：未安装时给下载卡片（进度/速度/剩余），装完卡片消失 */}
      {embedInstalled === false ? (
        <div className="kb-embed-card">
          <span className="kb-embed-main">
            <strong>本地语义检索（可选增强）</strong>
            <small>离线中文向量模型 + ONNX 运行库，装好后「语义检索」不再依赖供应商接口。约 110 MB，走国内镜像（npmmirror + hf-mirror），装完即用。</small>
          </span>
          {embedProg || embedBusy ? (
            <span className="runtime-install-state">
              <span className="runtime-progress-bar" role="progressbar" aria-label="本地语义检索下载进度" aria-valuenow={embedProg?.percent ?? 0} aria-valuemin={0} aria-valuemax={100}>
                <i style={{ width: `${embedProg?.percent ?? 0}%` }} />
              </span>
              <em className="runtime-progress">
                {typeof embedProg?.percent === "number" ? `${embedProg.percent}%` : "准备中…"}
                {embedProg?.speed ? ` · ${embedProg.speed}` : ""}
                {embedProg?.remaining ? ` · ${embedProg.remaining}` : ""}
                {embedProg?.message ? ` · ${embedProg.message}` : ""}
              </em>
            </span>
          ) : (
            <button className="primary-setting" disabled={embedBusy} onClick={() => void installEmbed()}><ArrowDown size={13} />下载并安装</button>
          )}
        </div>
      ) : null}

      <div className="resource-toolbar">
        <div className="kb-search"><Search size={13} /><input value={query} placeholder="在知识库中检索…" onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void doSearch(); }} /></div>
        <button className="secondary-setting" disabled={busy === "search"} onClick={() => void doSearch()}>{busy === "search" ? <Spinner /> : <Search size={13} />}检索</button>
        <button className="secondary-setting" disabled={Boolean(busy)} title="从本机选择一个或多个文本文件（md / txt / 代码等）导入" onClick={() => void importFiles()}>{busy === "import" ? <Spinner /> : <FilePlus2 size={13} />}导入文件</button>
        <button className="secondary-setting" disabled={Boolean(busy)} onClick={() => setPasteOpen((v) => !v)}><Library size={13} />粘贴文本</button>
        <button className="icon-button" title="刷新" onClick={() => void refreshWithReceipt(setNotice, "刷新知识库", () => load())}>{loading ? <Spinner /> : <RefreshCw size={14} />}</button>
      </div>

      {pasteOpen && (
        <div className="kb-paste">
          <input value={pasteTitle} placeholder="标题（可留空）" onChange={(event) => setPasteTitle(event.target.value)} />
          <textarea value={pasteText} placeholder="粘贴要入库的内容…" rows={5} onChange={(event) => setPasteText(event.target.value)} />
          <button className="secondary-setting" disabled={busy === "paste"} onClick={() => void importPaste()}>{busy === "paste" ? <Spinner /> : null}入库</button>
        </div>
      )}

      {hits !== null ? (
        <>
        {semantic !== null ? <p className="muted kb-mode">{semantic ? "语义 + 全文双档检索（供应商 embedding 可用）" : "全文检索（供应商 embedding 不可用时的自动回落）"}</p> : null}
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
        </>
      ) : (
        docs.length ? <div className="kb-docs">
          {docs.map((doc) => (
            <div className="kb-doc" key={doc.id}>
              <span className="kb-doc-main" style={{ cursor: "pointer" }} title="点击查看全文" onClick={() => void openPreview(doc)}>
                <strong>{doc.title}</strong><small>{doc.chunks} 块 · {Math.max(1, Math.round(doc.bytes / 1024))} KB</small>
              </span>
              <button className="icon-button" title={`查看「${doc.title}」全文`} onClick={(e) => { e.stopPropagation(); void openPreview(doc); }}>{<Eye size={13} />}</button>
              <button className="icon-button" title={`删除「${doc.title}」`} disabled={Boolean(busy)} onClick={(e) => { e.stopPropagation(); void remove(doc); }}>{busy === doc.id ? <Spinner /> : <Trash2 size={13} />}</button>
            </div>
          ))}
        </div> : <p className="muted">{loading ? "正在加载…" : "知识库还是空的——用上面「导入文件」或「粘贴文本」添加第一份文档。"}</p>
      )}

      {/* 全文预览弹窗（info-modal 体系，portal 到 body——设置页 transform 会劫持 fixed） */}
      {preview && createPortal(
        <div className="info-modal-mask" onClick={() => setPreview(null)}>
          <div className="info-modal kb-preview-modal" role="dialog" aria-label={`${preview.meta.title} 全文预览`} onClick={(e) => e.stopPropagation()}>
            <header>
              <strong>{preview.meta.title}</strong>
              <button type="button" title="关闭" onClick={() => setPreview(null)}><X size={14} /></button>
            </header>
            <pre className="kb-preview-body">{preview.text}</pre>
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
}
