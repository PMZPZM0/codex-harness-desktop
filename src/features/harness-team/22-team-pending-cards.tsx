/**
 * 团队模式 · 伙伴在等你确认（询问 / 审批）
 *
 * 11-08 用户令：「询问，审批，计划，等等全部跟对话框一样就行，不要重复造轮子」+「要完全一样」
 * ⇒ 这里**只做归属过滤**，卡片本体就是主对话那两件：
 *    · `RequestCard`  —— 审批 / 文件改动 / 多项输入（`item/commandExecution/requestApproval` 等）
 *    · `AgentAskCard` —— 伙伴用 agent_ask 提问
 * ⛔ 不写第二种卡、不改卡片内部：卡片长相、按钮文案、回包通道（`window.codex.respond`）全部同源。
 *
 * ⛔ 定位与主对话一致：绝对定位在**输入卡上方**（等价于 `.composer-overlay-stack`），
 *    盖在状态区上、不把消息流挤走；关掉即露出底下内容。
 * ⛔ 归属靠 threadId：群里每个伙伴各跑各的子会话，主对话按 `app.thread.id` 过滤，
 *    这里按「本群出现过的会话 id 集合」过滤 —— 伙伴的询问只落在群里，主对话那条不会重复弹。
 *
 * 计划（`planConfirm`）暂不在群里渲染：它由 `/plan` 的 planTurnRef 产生，而「开始执行 / 提意见」
 * 两个动作都硬校验 `bag.thread.id === planConfirm.threadId`（见 part08/03-seg.tsx）。
 * 派活链路目前不带 /plan ⇒ 群里不可能出现这个态；硬塞一张三个按钮点了没反应的卡
 * 就是本项目明令禁止的「死按钮」。真要做，先给动作加 threadId 入参，再在这里按同一套过滤接上。
 */
import { AgentAskCard } from "../app-view/AppView/02-main-stage/03-composer/03-agent-ask-card";
import { RequestCard } from "../app-view/helpers";
import type { HarnessAppApi } from "../app-state";

/** 待处理卡片：按会话 id 过滤出属于这些群的询问/审批请求。 */
export function TeamPendingCards({ app, threadIds }: { app?: HarnessAppApi; threadIds: string[] }) {
  if (!app) return null;
  const ids = new Set(threadIds.filter(Boolean));
  if (!ids.size) return null;
  /* 引擎把发起请求的会话写在 `params.threadId`（主对话那条过滤用的就是这个字段） */
  const requests = (app.pending ?? []).filter((request) => ids.has(String(request.params?.threadId ?? "")));
  const ask = app.agentAsk && ids.has(app.agentAsk.threadId) ? app.agentAsk : null;
  if (!requests.length && !ask) return null;
  return (
    <div className="team-group__overlay-stack" role="group" aria-label="伙伴在等你确认">
      {ask && <AgentAskCard ask={ask} onClose={() => app.setAgentAsk(null)} />}
      {requests.length > 0 && (
        <div className="approval-stack" data-count={requests.length}>
          {requests.map((request) => (
            <RequestCard
              key={request.id}
              request={request}
              onDone={() => app.setPending((current) => current.filter((entry) => entry.id !== request.id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
