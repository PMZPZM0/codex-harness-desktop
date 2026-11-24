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
import { Play, Image as ImageIcon, ChevronDown, Music2, Brush, Box } from "lucide-react";
import { craftOpeners, openPathInCraft, useInstalledCraftIds } from "../shared/craft-open";
import { mediaKindOf } from "../../lib/media-kind.mjs";
import { useState } from "react";
import { isVideoPath, mediaDisplaySrc } from "../../lib/media-kind.mjs";
import { isImagePath } from "../../lib/is-image-path";
import { imageUrl, retryLocalImage } from "../../lib/image-url";
import { openImageLightbox, openMediaPreview, notifyToast } from "../../lib/ui-channels";

export type TurnMediaFile = { path: string; deletedFile?: boolean };

/* ⛔ 11-15 用户：「这里一次展示太多」⇒ 首屏 4 个（与图片同格的 112px 方块），其余折叠。 */
const MAX_VISIBLE = 4;

function nameOf(path: string): string {
  const norm = String(path || "").replaceAll("\\", "/");
  return norm.slice(norm.lastIndexOf("/") + 1) || norm;
}

/** 本回合产出的视频/图片预览卡：视频=首帧缩略+播放角标，图片=缩略图；点击复用现有播放/预览组件。 */
export function TurnMediaCards({ files }: { files: TurnMediaFile[] }) {
  const [expanded, setExpanded] = useState(false);
  /* 11-16：已装的 Craft App（用于「用对应软件打开」按钮；共享轮询，不吃额外 IPC 频率）。 */
  const craftIds = useInstalledCraftIds();
  const alive = (Array.isArray(files) ? files : []).filter((f) => f && f.path && !f.deletedFile);
  const videos = alive.filter((f) => isVideoPath(f.path));
  const images = alive.filter((f) => isImagePath(f.path));
  /* ⛔ 11-15 用户：「下面这个（音频播放卡）放到上面来，可以长方形，不要这么大」
     ⇒ 音频与视频/图片同一排；样式是紧凑长方形（见 .turn-media-card.is-audio-chip）。 */
  const audios = alive.filter((f) => mediaKindOf(f.path) === "audio");
  const media = [
    ...videos.map((f) => ({ ...f, kind: "video" as const })),
    ...images.map((f) => ({ ...f, kind: "image" as const })),
    ...audios.map((f) => ({ ...f, kind: "audio" as const })),
  ];
  if (!media.length) return null;
  const visible = expanded ? media : media.slice(0, MAX_VISIBLE);
  const hidden = media.length - visible.length;
  /* ⛔ 用户：「展开了，没有对应的折叠」—— 原来用 hidden>0 当渲染条件，展开后 hidden=0 ⇒ 按钮消失。 */
  const canFold = media.length > MAX_VISIBLE;

  const open = (file: { path: string; kind: "video" | "image" | "audio" }) => {
    const name = nameOf(file.path);
    if (file.kind === "video") openMediaPreview({ source: file.path, kind: "video", title: name, autoPlay: true });
    else if (file.kind === "audio") openMediaPreview({ source: file.path, kind: "audio", title: name, autoPlay: true });
    else openImageLightbox(file.path, name);
  };

  /** 在 PhotoCraft 原生窗口里打开这张图（未安装时主进程回原因，这里用 toast 说明）。 */
  const editInPhotoCraft = async (path: string) => {
    try {
      const result = await window.codex.photocraftOpen({ path });
      if (!result?.ok) notifyToast("打开 PhotoCraft 失败", result?.error);
    } catch (error) {
      notifyToast("打开 PhotoCraft 失败", String((error as Error)?.message ?? error));
    }
  };

  return (
    <section className="turn-media-cards is-previews" aria-label="本轮媒体产物" data-testid="turn-media-cards">
      {visible.map((file) => {
        const name = nameOf(file.path);
        /* 11-16：按格式给出「用对应 Craft App 打开」；图片的 PhotoCraft 走下面那枚专用按钮。 */
        const extraOpeners = craftOpeners(file.path, craftIds, 3)
          .filter((opener) => opener.id !== "photocraft")
          .slice(0, 2);
        return file.kind === "audio" ? (
          <div className="turn-media-chip-wrap" key={file.path}>
            <button
              type="button"
              className="turn-media-card is-audio-chip"
              data-testid="turn-media-audio"
              title={`播放音频：${file.path}`}
              onClick={() => open(file)}
            >
              <span className="turn-media-chip-icon"><Music2 size={15} /></span>
              <span className="turn-media-chip-name" title={file.path}>{name}</span>
              <span className="turn-media-chip-play"><Play size={12} /></span>
            </button>
            {extraOpeners.map((opener, index) => (
              <button
                type="button"
                key={opener.id}
                className="turn-media-edit"
                style={{ right: 4 + index * 26 }}
                title={`用 ${opener.name} 打开：${file.path}`}
                aria-label={`用 ${opener.name} 打开`}
                onClick={(event) => { event.stopPropagation(); void openPathInCraft(opener.id, file.path, opener.name); }}
              >
                <Box size={12} />
              </button>
            ))}
          </div>
        ) : file.kind === "video" ? (
          <div className="turn-media-image-wrap" key={file.path}>
            <button
              type="button"
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
            {extraOpeners.map((opener, index) => (
              <button
                type="button"
                key={opener.id}
                className="turn-media-edit"
                style={{ right: 4 + index * 26 }}
                title={`用 ${opener.name} 打开：${file.path}`}
                aria-label={`用 ${opener.name} 打开`}
                onClick={(event) => { event.stopPropagation(); void openPathInCraft(opener.id, file.path, opener.name); }}
              >
                <Box size={12} />
              </button>
            ))}
          </div>
        ) : (
          <div className="turn-media-image-wrap" key={file.path}>
            <button
              type="button"
              className="turn-media-card is-image"
              data-testid="turn-media-image"
              title={`预览图片：${file.path}`}
              onClick={() => open(file)}
            >
              <span className="turn-media-thumb">
                <img src={imageUrl(file.path)} alt={name} loading="eager" onError={(event) => retryLocalImage(event as unknown as { currentTarget: HTMLImageElement }, imageUrl(file.path), file.path)} />
                <span className="turn-media-play"><ImageIcon size={14} /></span>
              </span>
              <span className="turn-media-meta"><b title={file.path}>{name}</b><small>图片</small></span>
            </button>
            <button
              type="button"
              className="turn-media-edit"
              data-testid="turn-media-photocraft"
              title={`在 PhotoCraft 中编辑：${file.path}`}
              aria-label="在 PhotoCraft 中编辑"
              onClick={(event) => { event.stopPropagation(); void editInPhotoCraft(file.path); }}
            >
              <Brush size={12} />
            </button>
            {extraOpeners.map((opener, index) => (
              <button
                type="button"
                key={opener.id}
                className="turn-media-edit"
                style={{ right: 30 + index * 26 }}
                title={`用 ${opener.name} 打开：${file.path}`}
                aria-label={`用 ${opener.name} 打开`}
                onClick={(event) => { event.stopPropagation(); void openPathInCraft(opener.id, file.path, opener.name); }}
              >
                <Box size={12} />
              </button>
            ))}
          </div>
        );
      })}
      {canFold && (
        <button type="button" className="turn-media-disclosure" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          <ChevronDown size={13} className={expanded ? "open" : ""} />
          {expanded ? "收起" : `再显示 ${hidden} 个媒体`}
        </button>
      )}
    </section>
  );
}
