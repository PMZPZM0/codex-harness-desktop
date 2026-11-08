/**
 * 影视播放器 · 卡片（11-01 第四版，按代码审查结论修正）
 *
 * ⛔⛔ 审查发现（已修）：上一版有「下载并安装内核 / 卸载 + 内核 404KB」——
 *   全是**装饰性的**：hls.js 本来就随包（`package.json` 依赖 + `MediaPreview.tsx` 里
 *   `await import("hls.js")`），而那段 CDN 下载存进 localStorage 的文本**没有任何代码读**。
 *   界面显示"已安装"，断网却照样播不了 ⇒ 会误导用户，比没有按钮更糟。已整块删除。
 *
 * ⛔ 现在这张卡的职责只有三件（都是真实能力）：
 *   ① 交代影视源在哪（内置源接口，可复制）；
 *   ② 说明播放走**对话播放器**（media_preview → media-preview:open）；
 *   ③ 免责声明。
 *
 * ⛔ 复制必须走 `copyTextToClipboard`：`navigator.clipboard` 在 file:// 下会静默失败（"假复制"）。
 */
import { Tv } from "lucide-react";
import { copyTextToClipboard } from "../../lib/clipboard";

const SOURCE_APIS: Array<[string, string]> = [
  ["非凡资源", "https://api.ffzyapi.com/api.php/provide/vod"],
  ["量子资源", "https://cj.lziapi.com/api.php/provide/vod"],
  ["光速资源", "https://api.guangsuapi.com/api.php/provide/vod"],
  ["暴风资源", "https://bfzyapi.com/api.php/provide/vod"],
];

/** 影视播放器卡片：说明与入口（当前无需安装项）。 */
export function MediaPlayerCard({ onNotice }: { onNotice?: (message: string) => void }) {
  return (
    <div className="voice-devtools-card">
      <div className="voice-devtools-card-head">
        <div className="voice-devtools-icon"><Tv size={20} /></div>
        <strong className="voice-devtools-name">影视播放器</strong>
        <span className="voice-devtools-badge">内核随包 · hls.js</span>
      </div>

      <div className="voice-devtools-body">
        <span className="voice-devtools-sub">hls.js（MIT，已随应用打包）· m3u8 / mp4</span>
        <div className="voice-devtools-desc">
          影视源在后端。<strong>在对话里直接说「放某部电影」</strong>，Codex 会调用内置源搜索，
          并在<b>对话播放器</b>里起播；播放内核已随应用打包，不需要单独下载。
        </div>

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

      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6, lineHeight: 1.5 }}>
        声明：本功能仅提供<b>索引与播放</b>能力，不托管、不存储、不分发任何影视内容；片源由第三方接口提供，
        可用性与合法性由其自行负责。请遵守当地法律与版权规定。
      </div>
    </div>
  );
}
