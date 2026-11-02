/**
 * 办公室「放大屏」（11-02 用户：先做悬停放大屏）。
 *
 * 小屏（66×32 像素）只能表达"他在干什么"；真实内容（文件名 / diff / 命令输出 / 地址）
 * 放到这张**正常字号**的卡片里 —— 悬停工位显示器即出现，移进卡片不会立刻消失。
 *
 * ⛔ 内容全部来自真实事件（office-activity）：没有数据就如实写"等待真实输出"，
 *    绝不编假日志/假页面。
 */
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { OfficeActivityEntry } from "./office-activity";
import type { OfficeMemberState } from "./office-format";

const KIND_LABEL: Record<string, string> = {
  browser: "浏览器",
  websearch: "联网检索",
  "file-write": "写文件",
  "file-read": "看文件",
  "file-edit": "改文件",
  "file-search": "搜文件",
  terminal: "终端",
  service: "调服务",
  collab: "分派",
  thinking: "思考",
};

function Empty({ text }: { text: string }) {
  return <p className="office-inspector-empty">{text}</p>;
}

function DiffLines({ lines }: { lines: string[] }) {
  if (!lines.length) return <Empty text="等待真实改动…" />;
  return (
    <pre className="office-inspector-code">
      {lines.map((line, index) => (
        <code key={index} className={line.startsWith("+") ? "is-add" : line.startsWith("-") ? "is-del" : ""}>{line}</code>
      ))}
    </pre>
  );
}

export function OfficeInspector({
  member,
  activity,
  modeLabel,
  elapsedMs,
  allowBrowserShot,
  onClose,
  onMouseEnter,
  onMouseLeave,
}: {
  member: OfficeMemberState;
  activity: OfficeActivityEntry | null;
  modeLabel: string;
  elapsedMs: number;
  /** 只有「本会话」（= 应用内浏览器面板的主人）才允许截真图；外部 ego 浏览器截不到 */
  allowBrowserShot?: boolean;
  onClose: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const kind = activity?.kind ?? "";
  const detail = String(activity?.detail ?? "").trim();
  const preview = activity?.preview ?? [];
  const title = KIND_LABEL[kind] ?? modeLabel ?? "待机";
  const seconds = elapsedMs >= 1000 ? Math.round(elapsedMs / 1000) : 0;
  /* 第二步（真实截图镜像）：应用内浏览器的 <webview> 可以 capturePage；
     外部 ego / Playwright 的页面不在应用进程里，capturePage 拿不到 ⇒ 只显示地址。
     ⛔ 只在**地址对得上**时截图：否则会拿用户正在看的别的页面冒充成员的操作。 */
  const [browserShot, setBrowserShot] = useState("");
  useEffect(() => {
    if (kind !== "browser" || !allowBrowserShot) { setBrowserShot(""); return; }
    let disposed = false;
    const hostOf = (value: string) => {
      try { return new URL(value).host.toLowerCase(); } catch { return ""; }
    };
    const capture = async () => {
      const wv = document.querySelector("webview") as unknown as { capturePage?: () => Promise<{ toDataURL?: () => string }>; getURL?: () => string } | null;
      if (!wv?.capturePage) return;
      const current = String(wv.getURL?.() ?? "");
      const currentHost = hostOf(current);
      const eventHost = hostOf(detail);
      if (!currentHost || !eventHost || currentHost !== eventHost) { if (!disposed) setBrowserShot(""); return; }
      try {
        const image = await wv.capturePage();
        const url = String(image?.toDataURL?.() ?? "");
        if (!disposed && url) setBrowserShot(url);
      } catch { /* guest 未就绪 / 已销毁：保持地址视图 */ }
    };
    void capture();
    const timer = window.setInterval(() => void capture(), 2000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [kind, allowBrowserShot, detail]);

  return (
    <aside
      className="office-inspector"
      role="dialog"
      aria-label={`${member.name} 的屏幕`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <header className="office-inspector-head">
        <div className="office-inspector-who">
          <strong>{member.name}</strong>
          <small>{member.profession || "成员"}</small>
        </div>
        <span className="office-inspector-mode">{title}{seconds ? ` · ${seconds}s` : ""}</span>
        <button type="button" className="office-inspector-close" aria-label="关闭放大屏" onClick={onClose}><X size={14} /></button>
      </header>

      <div className="office-inspector-body">
        {kind === "browser" ? (
          <div className="office-inspector-browser">
            <div className="office-inspector-url">{detail || "尚未拿到地址"}</div>
            {browserShot ? (
              <img className="office-inspector-shot" src={browserShot} alt="应用内浏览器实时截图" />
            ) : (
              <div className="office-inspector-page">
                <span /><span /><span />
              </div>
            )}
            <p className="office-inspector-note">
              {browserShot
                ? "截图来自应用内浏览器（每 2 秒刷新一次；只在本会话打开同一页面时显示）。"
                : "地址来自真实浏览器操作；外部 ego / Playwright 页面不在应用进程里，无法截图，仅显示地址。"}
            </p>
          </div>
        ) : kind === "file-edit" || kind === "file-write" ? (
          <div className="office-inspector-editor">
            <div className="office-inspector-file">{detail || "（文件名待引擎回传）"}</div>
            <DiffLines lines={preview} />
          </div>
        ) : kind === "terminal" || kind === "file-read" || kind === "file-search" ? (
          <div className="office-inspector-terminal">
            {kind === "terminal" && detail ? <div className="office-inspector-cmd">$ {detail}</div> : null}
            {kind !== "terminal" && detail ? <div className="office-inspector-file">{detail}</div> : null}
            {preview.length ? (
              <pre className="office-inspector-code">
                {preview.map((line, index) => <code key={index}>{line}</code>)}
              </pre>
            ) : (
              <Empty text={kind === "file-search" ? "等待搜索结果…" : "等待真实输出…"} />
            )}
          </div>
        ) : kind === "service" || kind === "collab" ? (
          <div className="office-inspector-service">
            <div className="office-inspector-file">{detail || "（名称待引擎回传）"}</div>
            <Empty text="这次调用没有可展示的正文。" />
          </div>
        ) : kind === "thinking" ? (
          <Empty text="正在思考，暂无工具输出。" />
        ) : (
          <Empty text="待机中 · 屏保轮播" />
        )}
      </div>
    </aside>
  );
}
