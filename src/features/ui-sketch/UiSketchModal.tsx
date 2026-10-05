/**
 * 界面草图（`ui-sketch` 域，10-05 立）—— 把 m3e-canvas 的原站嵌进应用，用弹窗展示。
 *
 * 为什么是 iframe 而不是把源码搬进来：上游 30,722 行 TS + 自己一套 Tailwind v4 与色板，
 * 并进本仓等于在设计体系里再塞一个体系（守卫【170】的色板对账会当场失焦）。
 * ⇒ 我们**提交它的静态导出产物**（`public/sketch/`，4.2MB，含本地化的 Material Symbols 字体），
 *   由 `sketch://` 只读协议加载（`electron/sketch-protocol.ts`），布局与功能一字不动 ——
 *   用户要的就是「按它原来的样子」。
 *
 * 双向通道 = `scripts/sketch-bridge.js`（构建时内联进那份 index.html）+ postMessage：
 * 两个源（sketch://app 与 file://）拿不到彼此的 DOM 与 localStorage，只有 postMessage 能过去。
 * 写方向复用它**自己的**导入机制（`#doc=` → hashchange → arrive()，可一键撤销），
 * 所以「送进草图」不会重载页面、也不会冲掉用户已有的草图。
 *
 * ⛔ 自包含：本地 state、零 props 之外的耦合、不碰 bag（只有「开没开」那一位在 bag，
 *    与 drama-canvas 同档）。⛔ 不许 createPortal（画布类浮层的既定立场：弹层留在自己那一层）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Copy, Layers, Package, PenTool, RefreshCw, X } from "lucide-react";
import { UI_SKIN_CATS, UI_SKIN_CATALOG } from "../../lib/ui-skin/catalog.gen";
import { loadCategory } from "../../lib/ui-skin/load";
import {
  SKETCH_BRIDGE_SOURCE,
  SKETCH_ENTRY_URL,
  appendComponents,
  buildComponentPrompt,
  describeDiag,
  summarizeDoc,
} from "./sketch-doc.mjs";
import type { SketchDiag, SketchDoc, SketchEntry } from "./sketch-doc.mjs";
import { SketchComponentRow } from "./SketchComponentRow";

/** 桥没应答多久算"没就绪"：8 秒足够本地协议加载 4MB 产物，又不至于让用户干等。 */
const BRIDGE_TIMEOUT_MS = 8000;
/** 推上去之后回读一次的延时：它那条 hashchange 通道是异步解码，读太早会拿到旧文档。 */
const READBACK_DELAY_MS = 1500;

export function UiSketchModal({ onClose, onAskAgent }: { onClose: () => void; onAskAgent: (text: string) => void }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const readyRef = useRef(false);
  const [doc, setDoc] = useState<SketchDoc | null>(null);
  const [bridgeError, setBridgeError] = useState("");
  /** 桥是否应答过（验收项靠这个状态位判断整条链路通没通，见 data-bridge）。 */
  const [bridgeReady, setBridgeReady] = useState(false);
  const [status, setStatus] = useState("草图已就绪 · 右侧挑组件送进来");
  const [panelOpen, setPanelOpen] = useState(true);
  const [cat, setCat] = useState<string>(UI_SKIN_CATS[0]?.cat ?? "Buttons");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SketchEntry[]>([]);
  const [listError, setListError] = useState("");
  /** 跨类目累计的选中项（切类目不能丢），所以要存整条而不只是 id。 */
  const [picked, setPicked] = useState<Record<string, SketchEntry>>({});

  const summary = useMemo(() => summarizeDoc(doc), [doc]);

  /* ESC 关窗自己接（仓里没有"顶层浮层统一 ESC"的机制，别假设有）。
     ⛔ 焦点在 iframe 里时按键不会冒泡到宿主文档 —— 所以 ESC 只在光标不在草图内时生效，
     这是跨源 iframe 的固有行为，不是这里的 bug；标题栏的关闭键始终可用。 */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* 桥的应答：ready / pong / doc 都带当前文档，一律收下（读回的唯一来源）。 */
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { source?: string; type?: string; doc?: SketchDoc; error?: string; diag?: SketchDiag };
      if (!data || data.source !== SKETCH_BRIDGE_SOURCE) return;
      if (data.type === "ready" || data.type === "pong" || data.type === "doc") {
        readyRef.current = true;
        setBridgeReady(true);
        setBridgeError("");
        setDoc(data.doc ?? null);
        /* 跨源看不见里面：没有文档时把桥带出来的诊断写进状态条，别让用户对着白屏猜。 */
        if (!data.doc) setStatus(`画布还没有内容 · ${describeDiag(data.diag)}`);
        return;
      }
      if (data.type === "error") setBridgeError(String(data.error ?? "草图返回未知错误"));
    };
    window.addEventListener("message", onMessage);
    const probe = setTimeout(() => {
      if (readyRef.current) return;
      setBridgeError("草图组件没有应答。多半是 dist/sketch 还没生成 —— 跑一次 npm run build（public/sketch 会被 Vite 拷进 dist）。");
    }, BRIDGE_TIMEOUT_MS);
    return () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(probe);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void loadCategory(cat).then((result) => {
      if (!alive) return;
      /* 目录条目按类目分开存，正文里没有 cat 字段 —— 补上它才能映射到上游的 kind。 */
      setItems(result.items.map((item) => ({ ...item, cat })));
      setListError(result.error ?? "");
    });
    return () => {
      alive = false;
    };
  }, [cat]);

  /** ⛔ targetOrigin 用 "*"：出站的只有"用户自己画的界面 JSON"，无凭据、无路径；
   *  换精确 origin 要处理打包版 file:// 的 "null" origin（Chromium 语义），复杂度全花在
   *  一个本来就不是秘密的载荷上。入站按 source 标记过滤。 */
  const post = (message: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage({ ...message, source: SKETCH_BRIDGE_SOURCE }, "*");
  };

  const syncDoc = () => {
    post({ type: "get-doc" });
    setStatus("已取回当前画布");
  };

  const pushPicked = () => {
    const entries = Object.values(picked);
    if (!entries.length) {
      setStatus("先在右侧勾选组件");
      return;
    }
    /* 没有草图时（新画布）用一个最小合法文档打底：上游 isProject 要 groups/frames 两个数组。 */
    const base = doc ?? { title: "Sketch", frame: "phone", groups: [], frames: [] };
    const result = appendComponents(base, entries);
    if (!result.doc) {
      setStatus("画布内容读不到，送不进去（点上方「取回」再试）");
      return;
    }
    if (!result.added.length) {
      setStatus(`这 ${result.skipped.length} 个组件已经在画布上了`);
      return;
    }
    setDoc(result.doc);
    post({ type: "load-doc", doc: result.doc });
    setStatus(`已送进画布 ${result.added.length} 个组件${result.skipped.length ? `（跳过重复 ${result.skipped.length}）` : ""}`);
    setTimeout(() => post({ type: "get-doc" }), READBACK_DELAY_MS);
  };

  const copyDoc = async () => {
    if (!doc) {
      setStatus("还没有可复制的画布内容");
      return;
    }
    await window.codex.writeClipboard(JSON.stringify(doc, null, 2));
    setStatus("草图 JSON 已复制（可存档 / 发给别的工具）");
  };

  const handToAgent = () => {
    const entries = Object.values(picked);
    /* 画布上什么都没有、也没勾组件 ⇒ 不该发任务：那样送出去的是一句没有内容的空指令，
       白跑一个回合（用户点「交给 Codex 实现」时未必已经在画布上摆过东西）。 */
    if (!entries.length && (!summary.valid || summary.items === 0)) {
      setStatus("画布还是空的 —— 先摆几个部件或勾几个组件");
      return;
    }
    const built = buildComponentPrompt(doc, entries);
    onAskAgent(built.text);
  };

  /* 只筛**已加载的正文**（items 带 html）—— 目录条目 UI_SKIN_CATALOG 没有 html，
     拿它筛会得到"看着能选、送进去却没源码"的半成品。 */
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const list = keyword ? items.filter((entry) => entry.name.toLowerCase().includes(keyword) || entry.id.toLowerCase().includes(keyword)) : items;
    return list.slice(0, 200);
  }, [items, query]);

  const pickedCount = Object.keys(picked).length;

  return (
    <div className="ui-sketch-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="ui-sketch-shell" role="dialog" aria-modal="true" aria-label="界面草图" data-bridge={bridgeError ? "timeout" : bridgeReady ? "ready" : "pending"}>
        {/* 标题与动作**同一行**（10-05 用户反馈「上面按键遮住了」）：原来两行把高度吃掉 ~80px，
            草图站自己的浮动工具栏就顶到可视区上沿、和它右上角的控件挤在一起。 */}
        <header className="ui-sketch-head">
          <PenTool size={15} className="ui-sketch-head-icon" />
          <strong>界面草图</strong>
          <button type="button" onClick={syncDoc}><RefreshCw size={13} />取回画布</button>
          <button type="button" onClick={pushPicked}><Layers size={13} />送进草图</button>
          <button type="button" onClick={() => void copyDoc()}><Copy size={13} />复制 JSON</button>
          <button type="button" className="primary" onClick={handToAgent}><ArrowUp size={13} />交给 Codex 实现</button>
          <span className="ui-sketch-meta">
            {bridgeError ? <em className="ui-sketch-warn">{bridgeError}</em> : <>{summary.valid ? `${summary.title || "未命名"} · ${summary.frames} 屏 / ${summary.items} 部件` : "画布内容未取回"}{pickedCount ? ` · 已选 ${pickedCount} 个组件` : ""}</>}
          </span>
          <span className="esc-hint" title="按 ESC 关闭弹窗">ESC</span>
          <button type="button" title={panelOpen ? "收起组件库" : "展开组件库"} aria-expanded={panelOpen} onClick={() => setPanelOpen((open) => !open)}><Package size={15} /></button>
          <button type="button" title="关闭" onClick={onClose}><X size={15} /></button>
        </header>
        <div className="ui-sketch-body">
          {/* ⛔ 不加 sandbox：桥要在草图源里读写 localStorage（m3e 的持久化就靠它），
              而 sandbox 不放 allow-same-origin 时 localStorage 直接不可用。
              这份产物是我们自己随包的只读文件，站点根恒在 dist/sketch 内（协议白名单），
              加 sandbox 只会把功能阉掉，不会增加任何安全边界。 */}
          <iframe
            ref={iframeRef}
            className="ui-sketch-frame"
            title="界面草图（m3e-canvas）"
            src={SKETCH_ENTRY_URL}
            onLoad={() => post({ type: "ping" })}
          />
          {panelOpen && (
            <aside className="ui-sketch-panel">
              <div className="ui-sketch-panel-head">
                <Package size={13} />
                <strong>组件库</strong>
                <span className="muted">{UI_SKIN_CATALOG.length} 个 Uiverse 控件</span>
              </div>
              <input className="ui-sketch-search" placeholder={`在${UI_SKIN_CATS.find((entry) => entry.cat === cat)?.label ?? cat}里搜`} value={query} onChange={(event) => setQuery(event.target.value)} />
              <div className="ui-sketch-cats">
                {UI_SKIN_CATS.map((entry) => (
                  <button type="button" key={entry.cat} className={entry.cat === cat ? "active" : ""} onClick={() => { setCat(entry.cat); setQuery(""); }}>
                    {entry.label}
                  </button>
                ))}
              </div>
              <div className="ui-sketch-list">
                {listError && <p className="ui-sketch-error">组件库读取失败：{listError}</p>}
                {!listError && !filtered.length && <p className="muted">这一类里没有匹配的组件</p>}
                {filtered.map((entry) => (
                  <SketchComponentRow
                    key={entry.id}
                    entry={entry}
                    picked={Boolean(picked[entry.id])}
                    onToggle={() => setPicked((current) => {
                      const next = { ...current };
                      if (next[entry.id]) delete next[entry.id];
                      else next[entry.id] = entry;
                      return next;
                    })}
                  />
                ))}
                {!listError && filtered.length >= 200 && <p className="muted">只列前 200 个，用上面的搜索缩小范围</p>}
              </div>
              <footer className="ui-sketch-foot">
                <button type="button" onClick={pushPicked}><Layers size={13} />送进草图（{pickedCount}）</button>
              </footer>
            </aside>
          )}
        </div>
        <div className="ui-sketch-status">{status}</div>
      </section>
    </div>
  );
}
