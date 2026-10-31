/**
 * 悬浮播报 · 历史面板（点击图标展开）
 *
 * 用户令（10-31）：「点击图标可展开查看历史记录」+「把语音播报也迁移到该悬浮窗统一播报」。
 *
 * ⛔ 位置算法：面板**永远朝聊天区内侧长**（贴左边就向右长，贴右边就向左长）。
 *    直接把 `left/top` 算成定值而不是用 CSS 的 `right: 100%` —— 图标是 `position: fixed`
 *    且中心点定位，用相对定位会随吸附边不同要写四套 CSS，算一次反而简单。
 */
import { useEffect, useMemo, useState } from "react";
import { Bell, BellOff, Square, Trash2, X } from "lucide-react";
import { requestAnnounceStop, subscribeAnnounceStatus, getAnnounceStatus } from "../../voice/announce-bus";
import { clearBroadcastHistory, setBroadcastPaused, setBroadcastOpen, type BroadcastItem } from "./store";
import { POD_SIZE, type DockEdge, type StageRect } from "./dock";
import { kindMetaOf, relativeTime } from "./kinds";

const PANEL_W = 360;
const PANEL_GAP = 12;

export function BroadcastPanel({ items, edge, stage, icon, paused }: {
  items: BroadcastItem[];
  edge: DockEdge;
  stage: StageRect;
  /** 图标的当前中心点（面板以它为锚） */
  icon: { x: number; y: number };
  paused: boolean;
}) {
  const [expandedId, setExpandedId] = useState<string>("");
  /* 语音播报的实时状态：这条链路的**展示**从输入框上方的条子搬到这里（用户令「统一播报」）。
     ⛔ 合成/播放仍在 features/voice-announce —— 这里只读事实、只给停止出口。 */
  const [voice, setVoice] = useState(() => getAnnounceStatus());
  useEffect(() => subscribeAnnounceStatus(setVoice), []);
  const voiceActive = Boolean(voice?.active);
  const voiceText = String(voice?.current ?? "").trim();

  const maxH = Math.max(220, Math.min(480, stage.bottom - stage.top - 24));
  const width = Math.min(PANEL_W, Math.max(240, stage.right - stage.left - 24));

  const pos = useMemo(() => {
    const half = POD_SIZE / 2;
    const clampX = (x: number) => Math.max(stage.left + 8, Math.min(x, stage.right - width - 8));
    if (edge === "left") {
      return { left: icon.x + half + PANEL_GAP, top: clampTop(icon.y - maxH / 2, stage, maxH) };
    }
    if (edge === "right") {
      return { left: icon.x - half - PANEL_GAP - width, top: clampTop(icon.y - maxH / 2, stage, maxH) };
    }
    if (edge === "top") {
      return { left: clampX(icon.x - width / 2), top: icon.y + half + PANEL_GAP };
    }
    return { left: clampX(icon.x - width / 2), top: Math.max(stage.top + 8, icon.y - half - PANEL_GAP - maxH) };
  }, [edge, icon.x, icon.y, maxH, stage.left, stage.right, stage.top, stage.bottom, width]);

  return (
    <div
      className={`bc-panel is-${edge}`}
      role="dialog"
      aria-label="播报历史"
      style={{ left: Math.round(pos.left), top: Math.round(pos.top), width, maxHeight: maxH }}
    >
      <div className="bc-panel-head">
        <b>播报</b>
        <span className="bc-panel-count">{items.length}</span>
        <span className="bc-panel-spacer" />
        <button type="button" className="bc-mini" title="清空历史" onClick={() => clearBroadcastHistory()}>
          <Trash2 size={12} />
        </button>
        <button type="button" className="bc-mini" title="关闭" onClick={() => setBroadcastOpen(false)}>
          <X size={12} />
        </button>
      </div>

      {/* 语音播报的实时行（原先挂在输入框上方的那条状态条，10-31 迁到这里统一播报） */}
      {voiceActive ? (
        <div className="bc-voice-row" role="status" aria-live="polite">
          <span className="bc-voice-dot" aria-hidden />
          <span className="bc-voice-main">
            <span className="bc-voice-title">
              语音播报中
              {voice.pending > 0 ? <span className="bc-voice-pending">待播 {voice.pending} 句</span> : null}
            </span>
            {voiceText ? <span className="bc-voice-text" title={voiceText}>{voiceText}</span> : null}
          </span>
          <button type="button" className="bc-mini is-stop" title="立即停止播报" onClick={() => requestAnnounceStop()}>
            <Square size={11} />
          </button>
        </div>
      ) : null}

      <div className="bc-panel-list">
        {items.length === 0 ? (
          <div className="bc-empty">
            还没有播报。
            <br />
            群事件、语音播报、系统提示都会收到这里。
          </div>
        ) : items.map((item) => {
          const meta = kindMetaOf(item.kind);
          const Icon = meta.icon;
          const expanded = expandedId === item.id;
          const body = String(item.text ?? "").trim();
          return (
            <button
              type="button"
              key={item.id}
              className={`bc-item tone-${item.tone ?? meta.tone}${expanded ? " is-open" : ""}`}
              onClick={() => setExpandedId(expanded ? "" : item.id)}
              title={body || item.title}
            >
              <span className="bc-item-icon" aria-hidden><Icon size={13} /></span>
              <span className="bc-item-main">
                <span className="bc-item-top">
                  <span className="bc-item-kind">{meta.label}</span>
                  <span className="bc-item-time">{relativeTime(item.at)}</span>
                </span>
                <span className="bc-item-title">{item.title}</span>
                {body ? <span className="bc-item-text">{body}</span> : null}
                {item.tags?.length ? (
                  <span className="bc-item-tags">
                    {item.tags.map((tag) => <span className="bc-tag" key={tag}>{tag}</span>)}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      <div className="bc-panel-foot">
        <button type="button" className="bc-foot-btn" onClick={() => setBroadcastPaused(!paused)}>
          {paused ? <Bell size={12} /> : <BellOff size={12} />}
          {paused ? "恢复自动播报" : "暂停自动播报"}
        </button>
      </div>
    </div>
  );
}

function clampTop(y: number, stage: StageRect, maxH: number): number {
  const max = Math.max(stage.top + 8, stage.bottom - maxH - 8);
  return Math.max(stage.top + 8, Math.min(y, max));
}
