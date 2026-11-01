/**
 * 回合播放卡（11-01 用户令：「在汇总消息下面加播放组件展示卡片，点击后就放大；
 * 这样就算我叉掉了，也可以点击这个重新看。音乐也是一样的逻辑」）。
 *
 * 位置 = 回合汇总（已完成改动卡）下面一行；数据来自 media-playback-store
 * （回合内真正打开过媒体才记录，不是从工具输出里猜）。
 * ⛔ 卡片只负责「重开播放器」：播放/进度都在 MediaPreview 里，这里不自带播放器（避免两份状态）。
 */
import { useSyncExternalStore } from "react";
import { Film, Music2, Play } from "lucide-react";
import { getTurnMedia, subscribeMediaPlayback } from "../../lib/media-playback-store.mjs";
import { openMediaPreview } from "../../lib/ui-channels";

const EMPTY: ReturnType<typeof getTurnMedia> = [];

export function TurnMediaCard({ threadId, turnId }: { threadId: string; turnId: string }) {
  const items = useSyncExternalStore(
    subscribeMediaPlayback,
    () => getTurnMedia(threadId, turnId),
    () => EMPTY,
  );
  if (!items.length) return null;
  return (
    <div className="turn-media-cards" aria-label="本回合打开过的媒体">
      {items.map((item) => {
        const audio = item.kind === "audio";
        return (
          <button
            key={item.source}
            type="button"
            className={`turn-media-card is-${audio ? "audio" : "video"}`}
            title={item.source}
            onClick={() => openMediaPreview({
              source: item.source,
              title: item.title || undefined,
              kind: (audio ? "audio" : "video") as "audio" | "video",
            })}
          >
            <span className="turn-media-card-icon">{audio ? <Music2 size={16} /> : <Film size={16} />}</span>
            <span className="turn-media-card-main">
              <strong>{item.title || (audio ? "音乐" : "视频")}</strong>
              <small>{audio ? "音乐" : "视频"} · 点击重新打开播放器</small>
            </span>
            <span className="turn-media-card-play"><Play size={13} />播放</span>
          </button>
        );
      })}
    </div>
  );
}