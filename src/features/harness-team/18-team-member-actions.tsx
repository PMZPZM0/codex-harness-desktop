/**
 * 群成员行右端的三件套：**运行态动态点 → @ → 停**（11-07 从 `04-team-group-view` 拆出）。
 *
 * 11-07 用户：「每个成员 @ 的前面有运行 ⏹ 动态展示吗」→ 运行态脉冲点落在 @ 前；
 * 11-07 用户（截图圈掉文字按钮）：「停用 ⏹️ 图标替代，放到 @ 前面」⇒ 停止也挪到 @ 前，
 * 且换成方形停止图标（不再有「停」字）。顺序固定：运行态脉冲点 → ⏹️ → @。
 * ⛔ 只在运行中出现，空闲成员一律不画。
 * ⛔ 团成员与普通伙伴共用这一个组件（两处各写一份必然漂：一处加了动态点、另一处忘了）。
 * ⛔ 拆成独立文件是为了守住 >1000 行棘轮（【265】），行为逐字未变。
 */
import { Square } from "lucide-react";

/** 成员操作行：选中 / 停止该成员（运行中才可停）。 */
export function MemberActions({
  id, name, running, selected, onToggle, onStop,
}: {
  id: string;
  name: string;
  running: boolean;
  selected: boolean;
  onToggle: (id: string) => void;
  onStop: (id: string) => void;
}) {
  return (
    <>
      {running && (
        <span className="team-group__member-live" title={`${name} 正在运行`} aria-label={`${name} 正在运行`} role="img" />
      )}
      {running && (
        <button
          type="button"
          className="team-group__member-stop"
          title={`停止 ${name} 当前这一回合`}
          aria-label={`停止 ${name}`}
          onClick={() => onStop(id)}
        >
          <Square size={10} fill="currentColor" strokeWidth={1.5} />
        </button>
      )}
      <button
        type="button"
        className={`team-group__member-at${selected ? " is-on" : ""}`}
        title={`@${name}`}
        aria-pressed={selected}
        onClick={() => onToggle(id)}
      >
        @
      </button>
    </>
  );
}
