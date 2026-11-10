/**
 * 回合「媒体产物」预览卡（11-09 用户令：「汇总消息下面加视频播放预览卡片和图片预览卡片，
 * 点击后用现有组件播放/预览；主对话框和群聊一起做」）。
 *
 * ⛔ 不新造播放器/灯箱：视频点击走 `openMediaPreview`（MediaPreviewModal，含 HLS），
 *    图片点击走 `openImageLightbox`（既有大图浮层）。这里只负责"把本回合产出的视频/图片
 *    画成可点的预览卡"，播放/预览能力全部复用现有组件。
 * ⛔ 由 `CompletedChanges` 渲染 ⇒ 主对话（03-turn-view）与群聊（11-team-cards）共用同一份，
 *    不写第二套。删除的文件不出卡。
 */
import { Play, Image as ImageIcon, ChevronDown } from "lucide-react";
import { useState } from "react";
import { isVideoPath, mediaDisplaySrc } from "../../lib/media-kind.mjs";
import { isImagePath } from "../../lib/is-image-path";
import { imageUrl } from "../../lib/image-url";
import { openImageLightbox, openMediaPreview } from "../../lib/ui-channels";

export type TurnMediaFile = { path: string; deletedFile?: boolean };

const MAX_VISIBLE = 8;

function nameOf(path: string): string {
  const norm = String(path || "").replaceAll("\\", "/");
  return norm.slice(norm.lastIndexOf("/") + 1) || norm;
}

/** 本回合产出的视频/图片预览卡：视频=首帧缩略+播放角标，图片=缩略图；点击复用现有播放/预览组件。 */
export function TurnMediaCards({ files }: { files: TurnMediaFile[] }) {
  const [expanded, setExpanded] = useState(false);
  const alive = (Array.isArray(files) ? files : []).filter((f) => f && f.path && !f.deletedFile);
  const videos = alive.filter((f) => isVideoPath(f.path));
  const images = alive.filter((f) => isImagePath(f.path));
  const media = [...videos.map((f) => ({ ...f, kind: "video" as const })), ...images.map((f) => ({ ...f, kind: "image" as const }))];
  if (!media.length) return null;
  const visible = expanded ? media : media.slice(0, MAX_VISIBLE);
  const hidden = media.length - visible.length;

  const open = (file: { path: string; kind: "video" | "image" }) => {
    const name = nameOf(file.path);
    if (file.kind === "video") openMediaPreview({ source: file.path, kind: "video", title: name, autoPlay: true });
    else openImageLightbox(file.path, name);
  };

  return (
    <section className="turn-media-cards" aria-label="本轮媒体产物" data-testid="turn-media-cards">
      {visible.map((file) => {
        const name = nameOf(file.path);
        return file.kind === "video" ? (
          <button
            type="button"
            key={file.path}
            className="turn-media-card is-video"
            data-testid="turn-media-video"
            title={`播放视频：${file.path}`}
            onClick={() => open(file)}
          >
            <span className="turn-media-thumb">
              <video src={`${mediaDisplaySrc(file.path)}#t=0.1`} preload="metadata" muted playsInline tabIndex={-1} />
              <span className="turn-media-play"><Play size={16} /></span>
            </span>
            <span className="turn-media-meta"><b title={file.path}>{name}</b><small>视频</small></span>
          </button>
        ) : (
          <button
            type="button"
            key={file.path}
            className="turn-media-card is-image"
            data-testid="turn-media-image"
            title={`预览图片：${file.path}`}
            onClick={() => open(file)}
          >
            <span className="turn-media-thumb">
              <img src={imageUrl(file.path)} alt={name} loading="lazy" onError={(event) => { (event.currentTarget as HTMLImageElement).style.display = "none"; }} />
              <span className="turn-media-play"><ImageIcon size={14} /></span>
            </span>
            <span className="turn-media-meta"><b title={file.path}>{name}</b><small>图片</small></span>
          </button>
        );
      })}
      {hidden > 0 && (
        <button type="button" className="turn-media-disclosure" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          <ChevronDown size={13} className={expanded ? "open" : ""} />
          {expanded ? "收起" : `再显示 ${hidden} 个媒体`}
        </button>
      )}
    </section>
  );
}
