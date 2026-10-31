/**
 * 悬浮播报 · 历史面板（点击图标展开）
 *
 * 用户令（10-31 第二轮，改到这里）：
 *   ·「播报内容没有按会话独立显示，请改为每个会话各自展示自己的播报」⇒ 列表由 Host 过滤后传入；
 *   ·「宽度与输入框对齐，可展示更长的内容，超出输入框宽度时自动换行」⇒ 面板宽度 = 聊天区宽度、
 *     左边缘与输入框左边缘对齐（不再固定 360px 贴在图标旁边）；
 *   ·「群事件按行清晰展示」⇒ 条目从"灰底卡片套灰底正文"改成**列表行**：图标 + 标题行 + 正文，
 *     行间一条细分隔线，hover 才浮底色（原来两层灰块叠着，就是截图里那股乱）；
 *   ·「加入文字逐字展示动画」⇒ 正文走 `TypedText`（群事件打字机 / 语音说话感）。
 *
 * ⛔ 面板宽度与左边缘统一按**聊天区**算，不跟吸附边：不管吸在哪，正文换行宽度都与输入框一致。
 */
import { useEffect, useMemo, useState } from "react";
import { Bell, BellOff, Square, Trash2, X } from "lucide-react";
import { requestAnnounceStop, subscribeAnnounceStatus, getAnnounceStatus } from "../../voice/announce-bus";
import { clearBroadcastHistory, setBroadcastPaused, setBroadcastOpen, type BroadcastItem } from "./store";
import type { DockEdge, StageRect } from "./dock";
import { kindMetaOf, relativeTime } from "./kinds";
import { TypedText } from "./TypedText";

/** 面板与输入框左右各留 12px，避免贴死边框 */
const GAP = 12;
/** 面板宽度上下限（再宽每行太长读不下去，再窄群事件的行会碎成一片） */
const MIN_W = 320;
const MAX_W = 640;

export function BroadcastPanel({ items, edge, stage, icon, paused, threadId }: {
  items: BroadcastItem[];
  edge: DockEdge;
  stage: StageRect;
  /** 图标的当前中心点（面板垂直方向以它为锚） */
  icon: { x: number; y: number };
  paused: boolean;
  threadId?: string;
}) {
  const [expandedId, setExpandedId] = useState<string>("");
  /* 语音播报的实时状态：这条链路的**展示**从输入框上方的条子搬到这里（用户令「统一播报」）。
     ⛔ 合成/播放仍在 features/voice-announce —— 这里只读事实、只给停止出口。 */
  const [voice, setVoice] = useState(() => getAnnounceStatus());
  useEffect(() => subscribeAnnounceStatus(setVoice), []);
  const voiceActive = Boolean(voice?.active);
  const voiceText = String(voice?.current ?? "").trim();

  /* ⛔ 用户令：「宽度与输入框对齐，可展示更长的内容，超出输入框宽度时自动换行」——
     直接用**输入框的实测矩形**（聊天区还含 rail 与内边距，按它算会窄 100px 且左边缘对不上）。 */
  const width = stage.composerWidth ? Math.round(stage.composerWidth) : Math.max(MIN_W, Math.min(MAX_W, stage.right - stage.left - GAP * 2));
  const maxH = Math.max(220, Math.min(520, stage.bottom - stage.top - 24));

  const pos = useMemo(() => {
    /* 水平：与输入框左边缘严格对齐（贴右边时也是 —— 用户要的是"跟输入框对齐"） */
    const left = stage.composerLeft ?? (stage.left + GAP);
    /* 垂直：以图标为锚，在聊天区内钳制 */
    const top = Math.max(stage.top + 8, Math.min(icon.y - 56, Math.max(stage.top + 8, stage.bottom - maxH - 8)));
    return { left, top };
  }, [stage.left, stage.top, stage.bottom, stage.composerLeft, icon.y, maxH]);

  return (
    <div
      className={`bc-panel is-${edge}`}
      role="dialog"
      aria-label="播报历史"
      data-thread={threadId ?? ""}
      style={{ left: Math.round(pos.left), top: Math.round(pos.top), width: Math.round(width), maxHeight: maxH }}
    >
      <div className="bc-panel-head">
        <b>播报</b>
        <span className="bc-panel-count">{items.length}</span>
        <span className="bc-panel-spacer" />
        <button type="button" className="bc-mini" title="清空历史" onClick={() => clearBroadcastHistory()}>
          <Trash2 size={12} />
        </button>
        <button type="button" className="bc-mini" title="关闭（Esc）" onClick={() => setBroadcastOpen(false, threadId ?? "")}>
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
            {voiceText ? (
              <span className="bc-voice-text" title={voiceText}>
                <TypedText text={voiceText} variant="voice" />
              </span>
            ) : null}
          </span>
          <button type="button" className="bc-mini is-stop" title="立即停止播报" onClick={() => requestAnnounceStop()}>
            <Square size={11} />
          </button>
        </div>
      ) : null}

      <div className="bc-panel-list">
        {items.length === 0 ? (
          <div className="bc-empty">
            这个会话还没有播报。
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
              className={`bc-item kind-${item.kind} tone-${item.tone ?? meta.tone}${expanded ? " is-open" : ""}`}
              onClick={() => setExpandedId(expanded ? "" : item.id)}
              title={body || item.title}
            >
              <span className="bc-item-icon" aria-hidden><Icon size={13} /></span>
              <span className="bc-item-main">
                <span className="bc-item-top">
                  <span className="bc-item-kind">{meta.label}</span>
                  <span className="bc-item-time">{relativeTime(item.at)}</span>
                </span>
                {/* 群事件标题走打字机；其它类型标题保持静态（避免一屏字全在动） */}
                <span className="bc-item-title">
                  {item.kind === "group" ? <TypedText text={item.title} variant="group" /> : item.title}
                </span>
                {body ? (
                  <span className="bc-item-text">
                    {item.kind === "group" || item.kind === "voice"
                      ? <TypedText text={body} variant={item.kind === "voice" ? "voice" : "group"} />
                      : body}
                  </span>
                ) : null}
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
        <span className="bc-foot-hint">点外部或按 Esc 收起</span>
      </div>
    </div>
  );
}
