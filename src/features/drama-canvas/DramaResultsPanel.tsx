/**
 * 生成结果面板「素材结果」（2026-09-28 新增）：把当前画布上所有已生成的图 / 视频 / 配音
 * 汇总到一处查看 —— 用户反馈「相册也没有，完全看不懂」（生成完的东西散在工作区目录，
 * 卡片上只显示个文件名，没有一处能总览）。
 *
 * ⛔ 不扫盘：数据源是**卡片 payload 的绝对路径**（payload.image / video / audio / first_frame）。
 *    扫盘会引入「工作区里别人放的素材算不算生成结果」这种判不准的问题，而卡片记的就是
 *    「这张画布生成出来的东西」，语义精确。
 * ⛔ 只读：本面板不删文件、不改卡片（删除属于卡片/文件管理，不在这层的职责里）。
 */
import { useMemo, useState } from "react";
import { Film, Image as ImageIcon, Music, Play, X } from "lucide-react";
import { useDramaActions } from "./drama-actions";

type AssetKind = "image" | "video" | "audio";
type Asset = { id: string; nodeId: string; kind: AssetKind; path: string; label: string };

/** 从卡片 payload 里挑出「生成结果」字段。字段名与 use-drama-story 的写回口径一致。 */
function collectAssets(nodes: Array<{ id: string; data?: any }>): Asset[] {
  const out: Asset[] = [];
  for (const node of nodes) {
    const payload = (node.data?.payload || {}) as Record<string, any>;
    const title = String(payload.title || payload.name || node.id);
    const push = (kind: AssetKind, value: unknown, tag: string) => {
      const path = String(value || "");
      if (!path) return;
      out.push({ id: `${node.id}:${kind}:${tag}`, nodeId: node.id, kind, path, label: `${title} · ${tag}` });
    };
    push("image", payload.image, "图");
    push("image", payload.first_frame, "首帧");
    push("video", payload.video, "视频");
    push("audio", payload.audio, "配音");
    // image / audio 卡把结果写在通用 path/url（见 use-drama-story 的写回分支）
    if (String(node.data?.kind) === "image") push("image", payload.path || payload.url, "图");
    if (String(node.data?.kind) === "audio") push("audio", payload.path, "配音");
  }
  // 同一条路径只留一条（image 卡可能同时命中 image 与 path）
  const seen = new Set<string>();
  return out.filter((a) => (seen.has(a.path) ? false : (seen.add(a.path), true)));
}

const fileOf = (p: string) => p.split(/[\\/]/).pop() || p;

export function DramaResultsPanel({ onClose, onLocate }: {
  onClose: () => void;
  /** 定位到产生这条结果的卡片（视口飞过去 + 选中） */
  onLocate: (nodeId: string) => void;
}) {
  const { board } = useDramaActions();
  const [filter, setFilter] = useState<AssetKind | "all">("all");
  const [preview, setPreview] = useState<Asset | null>(null);
  const assets = useMemo(() => collectAssets(board.nodes as any), [board.nodes]);
  const shown = filter === "all" ? assets : assets.filter((a) => a.kind === filter);
  const counts = {
    image: assets.filter((a) => a.kind === "image").length,
    video: assets.filter((a) => a.kind === "video").length,
    audio: assets.filter((a) => a.kind === "audio").length,
  };
  // ⛔ webview/渲染层读本地绝对路径：file:// 在 Electron 渲染层被 CSP 拦，走 assets 协议
  const srcOf = (p: string) => (/^https?:/i.test(p) ? p : `file://${p.replace(/\\/g, "/")}`);

  return (
    <aside className="drama-results" aria-label="生成结果">
      <header className="drama-results-head">
        <b>生成结果</b>
        <span>{assets.length} 项</span>
        <button className="icon-button" title="关闭" onClick={onClose}><X size={15} /></button>
      </header>
      <div className="drama-results-tabs">
        {([["all", `全部 ${assets.length}`], ["image", `图 ${counts.image}`], ["video", `视频 ${counts.video}`], ["audio", `配音 ${counts.audio}`]] as const).map(([key, label]) => (
          <button key={key} className={`drama-results-tab ${filter === key ? "active" : ""}`} onClick={() => setFilter(key as AssetKind | "all")}>{label}</button>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className="drama-results-empty">
          <ImageIcon size={22} />
          <b>{assets.length === 0 ? "这张画布还没有生成结果" : "该类型下没有结果"}</b>
          <small>在卡片上点「生图 · 首帧」/「视频 · 生成」/「配音 · 生成」，产物会自动出现在这里。</small>
        </div>
      ) : (
        <div className="drama-results-grid">
          {shown.map((asset) => (
            <figure key={asset.id} className={`drama-results-item is-${asset.kind}`}>
              <button className="drama-results-thumb" title="预览" onClick={() => setPreview(asset)}>
                {asset.kind === "image" ? <img src={srcOf(asset.path)} alt="" loading="lazy" />
                  : asset.kind === "video" ? <><video src={srcOf(asset.path)} preload="metadata" muted /><span className="drama-results-play"><Play size={16} /></span></>
                  : <span className="drama-results-audio"><Music size={18} /></span>}
              </button>
              <figcaption>
                <span title={asset.path}>{asset.label}</span>
                <small title={asset.path}>{fileOf(asset.path)}</small>
              </figcaption>
              <button className="drama-results-locate" title="定位到这张卡" onClick={() => { onLocate(asset.nodeId); onClose(); }}>定位</button>
            </figure>
          ))}
        </div>
      )}
      {preview ? (
        <div className="drama-results-preview" onMouseDown={(e) => { if (e.target === e.currentTarget) setPreview(null); }}>
          <div className="drama-results-preview-body">
            <header>
              <b>{preview.label}</b>
              <button className="icon-button" title="关闭" onClick={() => setPreview(null)}><X size={15} /></button>
            </header>
            {preview.kind === "image" ? <img src={srcOf(preview.path)} alt={preview.label} />
              : preview.kind === "video" ? <video src={srcOf(preview.path)} controls autoPlay />
              : <audio src={srcOf(preview.path)} controls autoPlay />}
            <footer><Film size={12} /><span>{preview.path}</span></footer>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
