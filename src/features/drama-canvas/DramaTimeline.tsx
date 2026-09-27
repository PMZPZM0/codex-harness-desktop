/**
 * 底部时间线（域内私有）：按分镜顺序把镜头排成一条带子，看总时长、点一下跳到那张卡。
 *
 * ⛔ 顺序以**分镜表**为准，不是画布上的 y 坐标 —— 画布是自由摆放的，
 * y 顺序跟"先拍哪一镜"没关系，拿它排时间线会排出一部顺序错乱的片子。
 */
import { Clock3, Film } from "lucide-react";
import { storyboardDuration } from "../../lib/drama-storyboard.mjs";
import { useDramaActions } from "./drama-actions";

export function DramaTimeline({ onFocusNode }: { onFocusNode: (id: string) => void }) {
  const actions = useDramaActions();
  const story = actions.story.story;
  const boardName = actions.story.storyName;
  const nodeIdFor = (shotId: string) => `n-shot-${boardName}-${shotId}`;
  const kindOf = (id: string) => actions.board.nodes.find((n) => n.id === id);

  const cells: Array<{ id: string; nodeId: string; label: string; size: string; line: string; seconds: number; has: "image" | "audio" | "none" }> = [];
  if (story) {
    for (const scene of story.scenes || []) {
      for (const shot of scene.shots || []) {
        const node = kindOf(nodeIdFor(shot.id));
        const payload = node?.data?.payload || {};
        cells.push({
          id: shot.id,
          nodeId: node?.id || "",
          label: `${scene.id}·${shot.id}`,
          size: shot.shot_size || "中景",
          line: shot.line || "",
          seconds: Number(payload.duration ?? shot.duration) || 0,
          has: payload.audio ? "audio" : payload.first_frame ? "image" : "none",
        });
      }
    }
  } else {
    for (const n of actions.board.nodes) {
      if (String(n.data?.kind) !== "shot") continue;
      const p = n.data.payload || {};
      cells.push({ id: String(p.id || n.id), nodeId: n.id, label: String(p.id || "镜头"), size: String(p.shot_size || "中景"), line: String(p.line || ""), seconds: Number(p.duration) || 0, has: p.audio ? "audio" : p.first_frame ? "image" : "none" });
    }
  }

  const total = story ? storyboardDuration(story) : cells.reduce((sum, c) => sum + c.seconds, 0);

  return (
    <section className="drama-canvas-timeline" aria-label="时间线">
      <header className="drama-canvas-timeline-head">
        <Film size={13} />
        <b>{story ? story.title : "未绑定分镜表"}</b>
        <span className="drama-canvas-timeline-meta">
          {story ? `${(story.scenes || []).length} 场 · ` : ""}{cells.length} 镜 · 合计 {Math.round(total * 10) / 10}s
        </span>
        <span className="drama-canvas-timeline-hint"><Clock3 size={11} />时长以配音为准，合成时按每镜 duration 垫齐</span>
      </header>
      <div className="drama-canvas-timeline-strip nowheel">
        {!cells.length ? <p className="drama-canvas-hint">还没有镜头。展开分镜表，或在画布上加一张镜头卡。</p> : null}
        {cells.map((c, i) => (
          <button
            key={`${c.id}-${i}`}
            className={`drama-canvas-timeline-cell ${actions.board.selectedIds.includes(c.nodeId) ? "is-selected" : ""}`}
            disabled={!c.nodeId}
            title={c.nodeId ? `跳到 ${c.label}` : "这一镜在画布上还没有对应的卡"}
            onClick={() => c.nodeId && onFocusNode(c.nodeId)}
          >
            <span className="drama-canvas-timeline-no">{c.label}</span>
            <span className="drama-canvas-timeline-size">{c.size}</span>
            <span className="drama-canvas-timeline-line">{c.line || "无人声"}</span>
            <span className="drama-canvas-timeline-sec">{c.seconds ? `${c.seconds}s` : "—"}</span>
            <i className={`drama-canvas-timeline-dot is-${c.has}`} aria-hidden />
          </button>
        ))}
      </div>
    </section>
  );
}
