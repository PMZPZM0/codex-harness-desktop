/**
 * 轮询板块在**对话流里**的渲染分支（10-09 建）。
 *
 * ⛔⛔ 为什么不塞进 `ItemView` / 思考卡那些既有分支：需求明写「通过新增独立渲染分支实现，
 *    不改动现有消息渲染逻辑」。这里是一个**新增的兄弟节点**（挂在 `.codex-turn` 内、既有
 *    `turn.after-content` 插槽旁），既有的消息渲染分支一个字都没动，整块摘掉也不影响别人。
 *
 * ⛔ `turnId` 为空 ⇒ 不渲染：拿不到回合 id 就不知道这张卡该出现在哪一回合（挂到每一回合
 *    = 同一张卡重复 N 遍）。"还没归属到任何回合"的任务由 `PollBridge` 用 `backfillPollTurn`
 *    在总线侧补挂 —— 这里只做精确匹配，不猜。
 */
import { usePollTasks } from "./use-poll-tasks";
import { PollCard } from "./PollCard";

export function PollTaskBoard({ turnId }: { turnId: string }) {
  const tasks = usePollTasks();
  /* ⛔ 只取 `kind === "poll"`：长命令 / 长工具调用那种后台任务**不在流里画卡**
     （它在流里已经有自己的工具卡了）—— 它们只出现在输入框那颗胶囊里。 */
  const mine = tasks.filter((task) => task.kind === "poll" && Boolean(turnId) && task.turnId === turnId);
  if (!mine.length) return null;
  return (
    <>
      {mine.map((task) => <PollCard key={task.id} task={task} />)}
    </>
  );
}
