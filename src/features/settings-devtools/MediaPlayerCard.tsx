/**
 * 影视播放器 · 卡片（11-01 第三版，按用户逐条纠正）
 *
 * ⛔ 用户裁定（每次都是踩过的点，别再改回去）：
 *   ① **放在「媒体与文档」分组里**，不要挂到页面上（上一版飘在「拓展与集成」下面）。
 *   ② 卡片内**不展示播放器本体**：播放交给对话播放器（media_preview → media-preview:open），
 *      这里只做「资源网址 / 内核安装 / 状态」。
 *   ③ 复制**必须真的写进剪贴板**：走 `copyTextToClipboard`（navigator.clipboard 在 file:// 下会静默失败，
 *      上一版就是这样"假复制"的）。
 *   ④ 要有**下载 / 安装 / 卸载**配套，与其它工具一致（内核 = hls.js，按需下载，可卸载）。
 *
 * 搜索：搜片由对话里的 Codex 调用后端工具（media_search → media_detail → media_preview）完成；
 *   卡片不重复实现（渲染层没有 media:* IPC，硬做只能是假搜索）。
 */
import { useCallback, useEffect, useState } from "react";
import { Download, Play, Trash2, Tv } from "lucide-react";
import { copyTextToClipboard } from "../../lib/clipboard";

const HLS_CDN = [
  "https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js",
  "https://unpkg.com/hls.js@1.5.17/dist/hls.min.js",
];
const KERNEL_KEY = "harness.media.kernel.v1";

const SOURCE_APIS: Array<[string, string]> = [
  ["非凡资源", "https://api.ffzyapi.com/api.php/provide/vod"],
  ["量子资源", "https://cj.lziapi.com/api.php/provide/vod"],
  ["光速资源", "https://api.guangsuapi.com/api.php/provide/vod"],
  ["暴风资源", "https://bfzyapi.com/api.php/provide/vod"],
];

export function MediaPlayerCard({ onNotice }: { onNotice?: (message: string) => void }) {
  const [kernel, setKernel] = useState<string>("");     // 已安装的内核文本（空 = 未安装）
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    try { setKernel(localStorage.getItem(KERNEL_KEY) || ""); } catch { /* 隐私模式忽略 */ }
  }, []);

  const install = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      let text = "";
      for (const src of HLS_CDN) {
        try {
          const res = await fetch(src, { cache: "force-cache" });
          if (!res.ok) continue;
          text = await res.text();
          if (text.length > 10_000) break;
        } catch { /* 换下一个 CDN */ }
      }
      if (!text) { setError("内核下载失败（网络受限）—— 仍可用外部播放器打开地址。"); return; }
      localStorage.setItem(KERNEL_KEY, text);
      setKernel(text);
      onNotice?.("播放内核已就绪");
    } catch (e: any) {
      setError(`安装失败：${String(e?.message ?? e).slice(0, 120)}`);
    } finally { setBusy(false); }
  }, [busy, onNotice]);

  const uninstall = useCallback(() => {
    try { localStorage.removeItem(KERNEL_KEY); } catch { /* 忽略 */ }
    setKernel("");
    onNotice?.("已移除播放内核");
  }, [onNotice]);

  const ready = kernel.length > 0;

  return (
    <div className="voice-devtools-card">
      <div className="voice-devtools-card-head">
        <div className="voice-devtools-icon"><Tv size={20} /></div>
        <span className="voice-group-tag">按需</span>
        <strong className="voice-devtools-name">影视播放器内核</strong>
        <span className="voice-devtools-badge">{ready ? "已安装" : "未安装"}</span>
      </div>

      <div className="voice-devtools-body">
        <span className="voice-devtools-sub">hls.js（MIT）· m3u8 / mp4 · 不随包分发，按需下载后可卸载</span>
        <div className="voice-devtools-desc">
          影视源已在后端。在对话里说「放某部电影」，Codex 会搜片并在<b>对话播放器</b>里起播；
          这里的「安装」只负责把播放内核取到本机，卡片本身不展示播放器。
        </div>

        {error ? <div className="voice-devtools-desc" style={{ color: "#dc2626" }}>{error}</div> : null}

        <div style={{ marginTop: 8, fontSize: 12 }}>
          <div style={{ color: "var(--muted)", marginBottom: 4 }}>资源网址（内置源接口）：</div>
          {SOURCE_APIS.map(([name, api]) => (
            <div key={api} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
              <span style={{ width: 64, flex: "none" }}>{name}</span>
              <code style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{api}</code>
              <button
                className="secondary-setting"
                style={{ flex: "none" }}
                onClick={async () => {
                  try { await copyTextToClipboard(api); onNotice?.("已复制源地址"); }
                  catch { onNotice?.("复制失败，请手动选中复制"); }
                }}
              >
                复制
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="voice-devtools-actions">
        {ready ? (
          <>
            <small style={{ color: "var(--muted)", marginRight: "auto" }}>内核 {(kernel.length / 1024).toFixed(0)} KB</small>
            <button className="secondary-setting" onClick={uninstall}>
              <Trash2 size={13} />卸载
            </button>
          </>
        ) : (
          <button className="primary-setting" disabled={busy} onClick={() => void install()}>
            <Download size={13} />{busy ? "下载中…" : "下载并安装内核"}
          </button>
        )}
      </div>

      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6, lineHeight: 1.5 }}>
        声明：本功能仅提供<b>索引与播放</b>能力，不托管、不存储、不分发任何影视内容；片源由第三方接口提供，
        可用性与合法性由其自行负责。请遵守当地法律与版权规定。
      </div>
    </div>
  );
}
