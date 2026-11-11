/**
 * 回合播放卡（11-01 用户令：「在汇总消息下面加播放组件展示卡片，点击后就放大；
 * 这样就算我叉掉了，也可以点击这个重新看。音乐也是一样的逻辑」；
 * 追加：「如果生成了视频文件/音乐文件，也要展示这个文件卡片」）。
 *
 * 两个来源：
 *   ① 回合内 Codex 调了视频/音乐工具（media-preview:open）—— 由 media-playback-store 记录；
 *   ② 回合**生成/改动的视频与音频文件** —— 来自回合文件追踪（turn-file-changes），
 *      这样「生成了一个 mp4 / mp3」也会自动出现播放入口（不需要模型再调一次播放工具）。
 *
 * ⛔ 卡片只负责「重开播放器」：播放/进度都在 MediaPreview 里，这里不自带播放器（避免两份状态）。
 * ⛔ 只收 video/audio：3D 模型/图片不在这里（图片走灯箱、模型有独立预览）。
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Film, Music2, Play } from "lucide-react";
import { getTurnMedia, subscribeMediaPlayback } from "../../lib/media-playback-store.mjs";
import { getTurnFileChanges, getTurnLiveFileChanges, subscribeTurnFileChanges } from "../../lib/turn-file-changes.mjs";
import { mediaKindOf } from "../../lib/media-kind.mjs";
import { openMediaPreview } from "../../lib/ui-channels";

const EMPTY: ReturnType<typeof getTurnMedia> = [];

function basenameOf(path: string): string {
  return String(path ?? "").split(/[\\/]/).pop() || String(path ?? "");
}

type CardItem = { source: string; title: string; kind: "video" | "audio"; generated: boolean };

/** 回合媒体卡：列出本回合产出的媒体文件，可预览与定位。 */
export function TurnMediaCard({ threadId, turnId }: { threadId: string; turnId: string }) {
  const recorded = useSyncExternalStore(
    subscribeMediaPlayback,
    () => getTurnMedia(threadId, turnId),
    () => EMPTY,
  );
  /* 生成的媒体文件：文件追踪是外部 store（与「已更改文件」汇总卡同一份数据），变更时重读。 */
  const [trackedVersion, setTrackedVersion] = useState(0);
  useEffect(() => subscribeTurnFileChanges((changedTurnId: string) => { if (changedTurnId === turnId) setTrackedVersion((v) => v + 1); }), [turnId]);

  const generated = useMemo<CardItem[]>(() => {
    void trackedVersion;
    const entries = [...getTurnFileChanges(turnId), ...getTurnLiveFileChanges(turnId)];
    const seen = new Set<string>();
    const out: CardItem[] = [];
    for (const entry of entries) {
      const path = String(entry?.path ?? "");
      if (!path || entry?.status === "deleted" || seen.has(path)) continue;
      const kind = mediaKindOf(path);
      if (kind !== "video" && kind !== "audio") continue;
      seen.add(path);
      out.push({ source: path, title: basenameOf(path), kind, generated: true });
    }
    return out;
  }, [turnId, trackedVersion]);

  const items = useMemo<CardItem[]>(() => {
    /* ⛔ 11-11 用户「全局查重复」：回合文件里的视频已由 CompletedChanges 的媒体预览卡渲染，
       这张「回合播放卡」再列一遍就是同一视频两张卡 ⇒ 文件来源的视频在这里跳过（音频不受影响）。 */
    const covered = new Set(
      [...getTurnFileChanges(turnId), ...getTurnLiveFileChanges(turnId)]
        .filter((entry) => mediaKindOf(String(entry?.path ?? "")) === "video")
        .map((entry) => String(entry.path).replaceAll("\\", "/")),
    );
    const out: CardItem[] = [];
    const seen = new Set<string>();
    for (const item of [...recorded, ...generated]) {
      if (item.kind !== "video" && item.kind !== "audio") continue;
      if (seen.has(item.source)) continue;
      if (item.kind === "video" && covered.has(String(item.source).replaceAll("\\", "/"))) continue;
      seen.add(item.source);
      out.push({
        source: item.source,
        title: item.title || basenameOf(item.source),
        kind: item.kind,
        generated: "generated" in item ? Boolean(item.generated) : false,
      });
    }
    return out;
  }, [recorded, generated]);

  if (!items.length) return null;
  return (
    <div className="turn-media-cards" aria-label="本回合的媒体">
      {items.map((item) => {
        const audio = item.kind === "audio";
        return (
          <button
            key={item.source}
            type="button"
            className={`turn-media-card is-${audio ? "audio" : "video"}${item.generated ? " is-generated" : ""}`}
            title={item.source}
            onClick={() => openMediaPreview({ source: item.source, title: item.title || undefined, kind: item.kind })}
          >
            <span className="turn-media-card-icon">{audio ? <Music2 size={16} /> : <Film size={16} />}</span>
            <span className="turn-media-card-main">
              <strong>{item.title}</strong>
              <small>{item.generated ? "生成的文件" : audio ? "音乐" : "视频"} · 点击播放</small>
            </span>
            <span className="turn-media-card-play"><Play size={13} />播放</span>
          </button>
        );
      })}
    </div>
  );
}