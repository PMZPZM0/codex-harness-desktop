/**
 * 回合网页来源条（10-12，用户令）：汇总卡右下角的 favicon 圆标行。
 *   · 最多 3 个圆标紧挨着；多于 3 个 = 3 个 logo + 「···」三点；
 *   · 点圆标 = 默认浏览器打开该站（window.codex.openExternal）；
 *   · 点「···」= 弹层看当前回合全部网页，点条目同样默认浏览器打开；
 *   · 弹层 portal 到 body（⛔ 回合卡 .turn-group 有恒等 transform，fixed 会退化）。
 * favicon 加载链：google s2 → favicon.im → 首字母色块（两者都取不到时仍可点）。
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Globe } from "lucide-react";

/** 最多直显的圆标数（用户定稿「最多展示3个，多了就显示三个logo图标*三个点」）。 */
export const WEB_SOURCE_VISIBLE = 3;

function faviconUrl(host: string, step: number): string {
  // ⛔ favicon.im 排第一：google s2 在国内直连不通（2026-10-12 实测 000），im 走 Cloudflare 可达
  if (step === 0) return `https://favicon.im/${encodeURIComponent(host)}?larger=true`;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`;
}

/** 单个 favicon 圆标：两级远程源都 404 时退回首字母色块（保持可点、不破版）。
 *  ⛔ 同时给任务监控面板的「网页查阅」列表复用 —— 两处各写一套加载链必然漂移。 */
export function WebFavicon({ host, size = 20 }: { host: string; size?: number }) {
  const [step, setStep] = useState(0);
  if (step >= 2) {
    return (
      <span className="web-favicon-fallback" style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }} aria-hidden="true">
        {[...host].find((ch) => /[a-z0-9]/i.test(ch))?.toUpperCase() ?? "?"}
      </span>
    );
  }
  return (
    <img src={faviconUrl(host, step)} alt="" loading="lazy" style={{ width: size, height: size }}
      onError={() => setStep((s) => s + 1)} />
  );
}

export function TurnWebSources({ sources, inline = false }: { sources: Array<{ url: string; host: string }>; inline?: boolean }) {
  const [openAll, setOpenAll] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  /* ⛔ hooks 必须在 early return 之前：运行中回合的 sources 会从 0 长出来，
     hook 数量随渲染分支变化 = React 直接报错（hook 调用序纪律）。 */
  const openSite = (url: string) => { try { void window.codex.openExternal(url); } catch { /* 外部浏览器可能被拒 */ } };

  /* 弹层定位：贴「···」按钮右下弹、右缘对齐（汇总卡靠右，向左展开不越视口）。 */
  useLayoutEffect(() => {
    if (!openAll) return;
    const pop = popRef.current;
    const anchor = moreRef.current?.getBoundingClientRect();
    if (!pop) return;
    const M = 8;
    const vw = window.innerWidth;
    if (anchor) {
      const width = Math.min(420, vw - M * 2);
      pop.style.width = width + "px";
      pop.style.left = Math.round(Math.max(M, anchor.right - width)) + "px";
      pop.style.top = Math.round(Math.min(window.innerHeight - M - pop.offsetHeight, anchor.bottom + 6)) + "px";
    }
    pop.style.visibility = "visible";
  }, [openAll]);
  useEffect(() => {
    if (!openAll) return;
    const close = (event: Event) => {
      const pop = popRef.current;
      if (pop && event.target instanceof Node && pop.contains(event.target)) return;
      if (moreRef.current && event.target instanceof Node && moreRef.current.contains(event.target)) return;
      setOpenAll(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpenAll(false); };
    window.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [openAll]);

  if (!sources.length) return null;
  const visible = sources.slice(0, WEB_SOURCE_VISIBLE);
  const rest = sources.length - visible.length;

  return (
    <div className={inline ? "completed-web-row completed-web-inline" : "completed-web-row"}>
      <span className="completed-web-label" title="这个回合访问过的网页（点击用默认浏览器打开）"><Globe size={12} />网页来源</span>
      <span className="completed-web-icons">
        {visible.map((source) => (
          <button type="button" key={source.host} className="web-favicon" title={`${source.host}（默认浏览器打开）`}
            onClick={() => openSite(source.url)}>
            <WebFavicon host={source.host} />
          </button>
        ))}
        {rest > 0 && (
          <button type="button" ref={moreRef} className="web-favicon web-favicon-more"
            title={`还有 ${rest} 个网页 —— 点看全部`} aria-label={`查看全部 ${sources.length} 个网页来源`}
            aria-expanded={openAll}
            onClick={() => setOpenAll((value) => !value)}>
            <i /><i /><i />
          </button>
        )}
      </span>
      {/* 全量弹层：portal 到 body（回合卡恒等 transform 会把 fixed 降级 —— 见 10-06 审查弹窗同款事故）。 */}
      {openAll && createPortal((
        <div ref={popRef} className="completed-web-pop" style={{ visibility: "hidden", top: 0, left: 0 }}
          role="dialog" aria-label="当前回合访问过的网页">
          <header>这个回合访问过 {sources.length} 个网站</header>
          <div className="completed-web-list">
            {sources.map((source) => (
              <button type="button" key={source.host} className="completed-web-item"
                title={`${source.url}（默认浏览器打开）`} onClick={() => openSite(source.url)}>
                <WebFavicon host={source.host} size={16} />
                <span className="completed-web-item-main">
                  <code>{source.host}</code>
                  <small>{source.url}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      ), document.body)}
    </div>
  );
}
