import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, ExternalLink, Globe2, Maximize2, MoreHorizontal, Plus, RefreshCw, ShieldCheck, Star, X } from "lucide-react";

/**
 * 中央主区「浏览器」视图（sidebar 顶部「浏览器」入口切换进来）。
 * UI 参考极简浏览器：顶部 tab 栏 + 单条工具栏 + 居中空状态。
 *
 * 渲染内核：Electron <webview>（宿主窗口 webPreferences.webviewTag 已开启）。
 * guest 内容是独立 webContents，拿不到 preload / node API，只用于渲染。
 * 「隐身浏览」走 cloak-browsers，属第二阶段（先占位禁用）。
 */
type BrowserTab = { id: string; url: string; title: string; loading: boolean };

const BOOKMARK_KEY = "browser-pane-bookmarks";

/** 输入归一化：域名补 https://；非 URL 走搜索 */
function normalizeUrl(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  if (/^localhost(:\d+)?(\/|$)/i.test(s)) return `http://${s}`;
  if (/^[\w-]+(\.[\w-]+)+(\/|$|\?)/i.test(s)) return `https://${s}`;
  return `https://www.bing.com/search?q=${encodeURIComponent(s)}`;
}

function readBookmarks(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(BOOKMARK_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

// React 不认识 <webview>（Electron 扩展标签），用 any 断言拿到可用组件
const WebviewTag = "webview" as unknown as React.FC<Record<string, unknown> & { ref?: React.Ref<HTMLElement> }>;

export default function BrowserPane({ onOpenExternal, variant, pendingOpen }: { onOpenExternal?: (url: string) => void; variant?: "panel" | "full"; pendingOpen?: { url: string; seq: number } | null }) {
  const [tabs, setTabs] = useState<BrowserTab[]>(() => [{ id: "tab-1", url: "", title: "浏览器", loading: false }]);
  const [activeId, setActiveId] = useState("tab-1");
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<string[]>(readBookmarks);
  const [stealthHint, setStealthHint] = useState("");
  const wvRef = useRef<HTMLElement | null>(null);
  const seqRef = useRef(1);

  const active = tabs.find((entry) => entry.id === activeId) ?? tabs[0];

  // 隐身浏览：调 cloak-browsers 指纹内核（外部窗口），当前页 URL 为空时开空白页
  const openCloak = useCallback(() => {
    void (async () => {
      const target = active.url || "about:blank";
      try {
        const result = await window.codex.openInCloakBrowser(target);
        setStealthHint(result.ok ? `已在指纹浏览器（cloak-browsers）中打开：${target}` : result.detail);
      } catch (error: any) {
        setStealthHint(error?.message ?? "调用指纹浏览器失败");
      }
    })();
  }, [active.url]);

  const patchActive = useCallback((patch: Partial<BrowserTab>) => {
    setTabs((current) => current.map((entry) => (entry.id === activeId ? { ...entry, ...patch } : entry)));
  }, [activeId]);

  const navigate = useCallback((raw: string) => {
    const url = normalizeUrl(raw);
    if (!url) return;
    patchActive({ url });
    setDraft(url);
  }, [patchActive]);

  const addTab = useCallback(() => {
    seqRef.current += 1;
    const id = `tab-${seqRef.current}`;
    setTabs((current) => [...current, { id, url: "", title: "浏览器", loading: false }]);
    setActiveId(id);
    setDraft("");
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs((current) => {
      const next = current.filter((entry) => entry.id !== id);
      // 关掉最后一个时补一个空标签，避免出现「没有标签页」的死状态
      const safe = next.length ? next : [{ id: `tab-${++seqRef.current}`, url: "", title: "浏览器", loading: false }];
      if (id === activeId) {
        const fallback = safe[Math.max(0, current.findIndex((entry) => entry.id === id) - 1)];
        setActiveId(fallback?.id ?? safe[0].id);
        setDraft(fallback?.url ?? "");
      }
      return safe;
    });
  }, [activeId]);

  // 外部打开请求（文件预览「浏览器打开」等）：激活标签是空页就直接导航，否则新开一个标签。
  // 用 seq 区分重复 URL 的连续请求（同一文件改完再开）。
  const openSeqRef = useRef(0);
  useEffect(() => {
    if (!pendingOpen?.url || pendingOpen.seq === openSeqRef.current) return;
    openSeqRef.current = pendingOpen.seq;
    const url = pendingOpen.url;
    const title = decodeURIComponent(url.split("/").pop() ?? "") || url;
    if (active && !active.url) {
      patchActive({ url, title });
      setDraft(url);
      return;
    }
    seqRef.current += 1;
    const id = `tab-${seqRef.current}`;
    setTabs((current) => [...current, { id, url, title, loading: false }]);
    setActiveId(id);
    setDraft(url);
  }, [pendingOpen?.seq, pendingOpen?.url, active, patchActive]);

  const toggleBookmark = useCallback(() => {
    const url = active.url;
    if (!url) return;
    setBookmarks((current) => {
      const next = current.includes(url) ? current.filter((entry) => entry !== url) : [...current, url];
      localStorage.setItem(BOOKMARK_KEY, JSON.stringify(next));
      return next;
    });
  }, [active.url]);

  // webview 事件：回写地址栏/标题/加载态。只渲染激活标签，切标签时元素会重建，
  // 依赖里带上 activeId 保证重建后重新绑定。
  useEffect(() => {
    const wv = wvRef.current as (HTMLElement & {
      goBack?: () => void; goForward?: () => void; reload?: () => void;
    }) | null;
    if (!wv) return;
    const onNavigate = (event: Event) => {
      const url = (event as unknown as { url?: string }).url ?? "";
      if (url) { patchActive({ url }); setDraft(url); }
    };
    const onTitle = (event: Event) => {
      const title = (event as unknown as { title?: string }).title ?? "";
      if (title) patchActive({ title });
    };
    const onStart = () => patchActive({ loading: true });
    const onStop = () => patchActive({ loading: false });
    wv.addEventListener("did-navigate", onNavigate);
    wv.addEventListener("did-navigate-in-page", onNavigate);
    wv.addEventListener("page-title-updated", onTitle);
    wv.addEventListener("did-start-loading", onStart);
    wv.addEventListener("did-stop-loading", onStop);
    return () => {
      wv.removeEventListener("did-navigate", onNavigate);
      wv.removeEventListener("did-navigate-in-page", onNavigate);
      wv.removeEventListener("page-title-updated", onTitle);
      wv.removeEventListener("did-start-loading", onStart);
      wv.removeEventListener("did-stop-loading", onStop);
    };
  }, [activeId, active.url, patchActive]);

  const go = (method: "goBack" | "goForward" | "reload") => {
    const wv = wvRef.current as unknown as Record<string, (() => void) | undefined> | null;
    try { wv?.[method]?.(); } catch { /* guest 未就绪 */ }
  };

  const bookmarked = Boolean(active.url) && bookmarks.includes(active.url);

  return (
    <section className={`browser-pane ${variant === "panel" ? "browser-pane--panel" : ""}`}>
      <div className="browser-pane-tabs">
        {variant !== "panel" && <button className="browser-pane-tabs-toggle" title="标签页列表" aria-label="标签页列表"><ChevronDown size={13} /></button>}
        <div className="browser-pane-strip" role="tablist" aria-label="浏览器标签页">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={tab.id === activeId}
              className={`browser-pane-tab ${tab.id === activeId ? "active" : ""}`}
              onClick={() => { setActiveId(tab.id); setDraft(tab.url); }}
              title={tab.url || "新标签页"}
            >
              <Globe2 size={13} />
              <span>{tab.title || "浏览器"}</span>
              {tabs.length > 1 && (
                <X size={11} className="browser-pane-tab-close" onClick={(event) => { event.stopPropagation(); closeTab(tab.id); }} />
              )}
            </button>
          ))}
          <button className="browser-pane-tab-add" title="新建标签页" aria-label="新建标签页" onClick={addTab}><Plus size={13} /></button>
        </div>
      </div>

      <div className="browser-pane-toolbar">
        <button className="icon-button" title="后退" onClick={() => go("goBack")}><ArrowLeft size={15} /></button>
        <button className="icon-button" title="前进" onClick={() => go("goForward")}><ArrowRight size={15} /></button>
        <button className="icon-button" title="刷新" onClick={() => go("reload")}><RefreshCw size={15} /></button>
        <input
          className="browser-pane-omni"
          value={draft}
          spellCheck={false}
          placeholder="粘贴或输入 URL 以打开网页"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") navigate(draft); }}
        />
        <button className={`icon-button ${bookmarked ? "active-tool" : ""}`} title={bookmarked ? "取消收藏" : "收藏此页"} onClick={toggleBookmark}><Star size={15} /></button>
        <button
          className="icon-button"
          title="隐身浏览（cloak-browsers 指纹内核，独立窗口）"
          onClick={openCloak}
        ><ShieldCheck size={15} /></button>
        <div className="browser-pane-menu-wrap">
          <button className={`icon-button ${menuOpen ? "active-tool" : ""}`} title="更多" onClick={() => setMenuOpen((value) => !value)}><MoreHorizontal size={15} /></button>
          {menuOpen && <>
            <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
            <div className="browser-pane-menu" role="menu">
              <button role="menuitem" disabled={!active.url} onClick={() => { setMenuOpen(false); if (active.url) void window.codex.browserPopout(active.url).catch((error: any) => setStealthHint(error?.message ?? "放大查看失败")); }}>
                <Maximize2 size={13} /><span>放大查看（新窗口）</span>
              </button>
              <button role="menuitem" disabled={!active.url} onClick={() => { setMenuOpen(false); if (active.url) { try { void window.codex.openExternal(active.url); } catch (error: any) { setStealthHint(error?.message ?? "打开失败"); } } }}>
                <ExternalLink size={13} /><span>在系统浏览器打开</span>
              </button>
              <button role="menuitem" disabled={!bookmarks.length} onClick={() => { setMenuOpen(false); const first = bookmarks[0]; if (first) navigate(first); }}>
                <Star size={13} /><span>打开收藏夹首项</span><em>{bookmarks.length}</em>
              </button>
              <button role="menuitem" onClick={() => { setMenuOpen(false); addTab(); }}><Plus size={13} /><span>新建标签页</span></button>
            </div>
          </>}
        </div>
      </div>

      <div className="browser-pane-content">
        {active.url ? (
          <WebviewTag ref={wvRef} src={active.url} className="browser-pane-webview" allowpopups="true" />
        ) : (
          <div className="browser-pane-empty">
            <Globe2 size={56} strokeWidth={0.75} />
            <h2>浏览器</h2>
            <p>粘贴或输入 URL 以打开网页</p>
          </div>
        )}
        {active.loading && <div className="browser-pane-loading" role="status" aria-label="加载中" />}
      </div>

      {stealthHint && (
        <>
          <div className="menu-backdrop" onClick={() => setStealthHint("")} />
          <div className="browser-pane-note" role="dialog" aria-label="隐身浏览">
            <strong><ShieldCheck size={14} />隐身浏览</strong>
            <p>{stealthHint}</p>
            <button className="secondary-setting" onClick={() => setStealthHint("")}>知道了</button>
          </div>
        </>
      )}
    </section>
  );
}
