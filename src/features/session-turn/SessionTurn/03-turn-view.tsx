/**
 * SessionTurn 的「turn-view」部分（09-22 从同目录 SessionTurn.tsx 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import { Turn } from "../../../lib/turn";
import { FoldHandlers, TurnFoldStream, ItemView } from "../../session-queue";
import { useCodexName, CodexAvatar } from "../../../components/CodexAvatar";
import { isTurnRunning } from "../../../lib/turn-fold";
import { useEffect, useMemo, memo, useState, useRef } from "react";
import { RUN_CLOCK } from "../../../lib/run-clock-2";
import { describeTurnStop } from "../../../lib/turn-stop-reason.mjs";
import { formatDuration } from "../../../lib/format-duration";
import { HookBadge } from "../../session-cards";
import { RunningProcessTime, CompletedChanges } from "../../status";
import { CircleStop, AlertTriangle, FileText, Brain, ChevronDown } from "lucide-react";
import { MessageFooter } from "../../shared/MessageFooter";
import { UserMessageView } from "../../shared/UserMessageView";
import { isTaskTurn } from "../SessionTurn";
export function TurnView({ turn, usage, tokenUsage, fallbackWindow, waitingForApproval, interruptedAt, elapsedSeconds, handlers, hooks, isLastTurn }: { turn: Turn; usage?: any; tokenUsage?: any; fallbackWindow?: number; waitingForApproval?: boolean; interruptedAt?: number; elapsedSeconds?: number; handlers: FoldHandlers; hooks?: any[] | null; isLastTurn?: boolean }) {
  // Codex 的名字（09-17）：用户在用户中心取的；走外部 store 而不是逐层传 props
  // —— 回合标识（.turn-head）在 TurnView 渲染，这里取一次（见 codex-identity.mjs）。
  const codexName = useCodexName();
  const completedTask = turn.status === "completed" && isTaskTurn(turn);
  // 回合已结束（含 completed/interrupted/failed）——普通聊天回合没有文件改动（不满足 isTaskTurn），
  // 但只要回合已收尾就该展示自己的操作栏（复制/分支/统计），避免被 task 限定卡掉。
  // 复用 isTurnRunning 覆盖 status === "running" 别名（部分引擎/历史数据会出现）。
  const turnFinished = !isTurnRunning(turn);
  const running = isTurnRunning(turn);
  // 回合跑完就清掉计时起点（否则这张表会随历史回合一直堆；容量上限只是兜底）。
  // 幂等：加载历史会话时 running 恒为 false，forget 一个不存在的 key 无副作用。
  // ⚠️ 不能改成「卸载时清理」——切会话正是要靠这条记忆跨过卸载（09-18）。
  // 已知小残留（可接受）：切走期间回合在后台跑完时，TurnView 已卸载 → 这次 effect 不跑，
  // 表项要等用户切回来（重挂载后 running=false）才被清；期间由 RUN_CLOCK 的容量上限兜住。
  useEffect(() => {
    if (!running) RUN_CLOCK.forget(turn.id);
  }, [running, turn.id]);
  const userItems = turn.items.filter((item) => item.type === "userMessage");
  // 回合已结束但个别工具/命令的 item/completed 事件丢失（状态仍 inProgress）→
  // 渲染层兜底落成完成态，避免「任务都完成了还卡在正在运行」。仅回合结束时兜底，
  // 正常流式期间（running）保持引擎原始状态不动。
  const responseItems = useMemo(() => {
    const items = turn.items.filter((item) => item.type !== "userMessage");
    if (running) return items;
    let stale = false;
    const fixed = items.map((item) => {
      if (item.status === "inProgress" || item.status === "running") { stale = true; return { ...item, status: "completed" }; }
      return item;
    });
    return stale ? fixed : items;
  }, [turn.items, running]);
  // ⛔ 压缩线位置归位（09-26 用户截图「压缩完成线要在新消息上面，怎么一直在下面」）：
  //    引擎把压缩跑成真实回合时，压缩 item 的 turnId 仍是**上一回合**、且 item/started 晚于
  //    agentMessage 才到（真机事件序列实证）⇒ mergeItem 把它排在回合 items 末尾 ⇒ 线渲染在
  //    回复内容下面。语义上压缩针对的是**这条消息之前的**历史上下文 ⇒ 线固定渲染到回合
  //    顶部（用户气泡上方）= 「新消息上面」。数据不动，只动显示位置。
  const compactItems = responseItems.filter((item) => item.type === "contextCompaction");
  const foldItems = useMemo(() => responseItems.filter((item) => item.type !== "contextCompaction"), [responseItems]);
  // 最终答复 = 最后一条有正文的 agentMessage
  const finalAgent = [...foldItems].reverse().find((item) => item.type === "agentMessage" && String(item.text ?? "").trim()) ?? null;
  const hasContent = foldItems.some((item) => item.type !== "agentMessage" || Boolean(String(item.text ?? "").trim()));
  // 可见内容：空的 agentMessage / 空 reasoning 占位不算。引擎建好 item 到首 token 之间有几十~几百毫秒，
  // 这段空窗必须有「思考中/生成中」占位顶着，否则就是白屏一下再突然整段冒出来（观感=卡+闪）。
  // ⛔ 以 foldItems 为准（09-26）：压缩线已提到回合顶部独立渲染，不算回合内的可见内容——
  //    否则「只有压缩 item」的回合会渲染一张空卡片壳。
  const hasVisible = foldItems.some((item) =>
    item.type === "agentMessage" ? Boolean(String(item.text ?? "").trim())
      : item.type === "reasoning" ? Boolean([...(item.summary ?? []), ...(item.content ?? [])].join("").trim())
        : true,
  );
  const stoppedWithoutReply = Boolean(interruptedAt && userItems.length > 0 && !hasContent);
  // 「用户主动点了停止」——`interruptedAt` 只由本机的 interrupt() 写入（语音插话/手机端停止/
  // 引擎主动中止都不会写它），所以它是"这次是用户自己停的"的可靠判据。
  // ⛔ 09-18 用户：「用户如果点了停止，运行过程和内容要保持在，方便用户继续任务，
  //   在最新内容后面加一个用户已停止」→ ① 过程组默认展开（keepProcessOpen）；
  //   ② 标记落在**内容之后**，不再用顶部那条通用中断提示（那条说"你点了停止/语音插话/手机端
  //   停止"三种可能，用户自己点的却要读一段猜谜，且与末尾标记重复说同一件事）。
  const userStopped = Boolean(interruptedAt);
  // 结束原因（纯函数，见 src/lib/turn-stop-reason.mjs）：running/completed 时 label 为空串
  const stopReason = describeTurnStop(turn);
  const statusLabel = running
    ? (turn.items.some((item) => item.type === "reasoning" && (item.status === "inProgress" || item.status === "running" || (!item.status && !item.durationMs))) ? "思考中" : "生成中")
    : stopReason.label || (turn.durationMs ? `已用 ${formatDuration(turn.durationMs)}` : "已完成");
  const hookBadge = hooks && hooks.length > 0 ? <HookBadge hooks={hooks} /> : undefined;
  return (
    <div className={`turn-group ${running ? "running" : turn.error ? "error" : "completed"}`} id={`turn-${turn.id}`} data-current-turn={isLastTurn ? "true" : undefined}>
      {/* 压缩线固定在回合最顶部（用户气泡上方）——「新消息上面」（09-26，见 compactItems 注释） */}
      {compactItems.map((item) => <ItemView item={item} turn={turn} onCopy={handlers.onCopy} onQuote={handlers.onQuote} key={item.id} />)}
      {userItems.map((item) => <MemoUserMessageView item={item} turn={turn} fallbackWindow={fallbackWindow} onCopy={handlers.onCopy} onQuote={handlers.onQuote} onImageCopy={handlers.onImageCopy} onEditSubmit={(entry) => handlers.onEdit(turn.id, entry)} onOpenFile={handlers.onOpenFile} key={item.id} />)}
      {(userItems.length > 0 || hasVisible) && (
      <div className="turn-card">
        {/* 回合标识：一轮会话只有一份「头像 + 名字」（09-17 用户「一轮会话就一个 Codex 名字和
            Codex 头像就行，就在会话上面就行」）。放在回合最上面，且**回合一建立就渲染** ——
            用户气泡一上屏就有，不用等引擎首个 token（原来长在 agentMessage 里，空 text 被
            「空文本不渲染」挡掉，症状正是「名字和头像没第一时间出来」）。
            条件与下面的占位头一致（userItems 已上屏）；回合结束后只有真产出过内容才留头。 */}
        {userItems.length > 0 && (running || responseItems.length > 0) && (
          <div className="turn-head">
            <span className="turn-head-avatar"><CodexAvatar size={22} /></span>
            <span className="turn-head-name">{codexName}</span>
          </div>
        )}
        {/* 「正在处理 N 秒」+ 它下面那条灰线（border-bottom）：09-17 用户「那个正在处理和那条
            灰线也没有在发送消息后第一时间出来」。原条件是 `running && isTaskTurn(turn)`，而
            isTaskTurn 要求回合内**出现过工具调用** —— 纯聊天或刚发出消息时压根不渲染。
            放宽成 `running`，但**仍要等回合内已有 userMessage**：turn/started 先建回合、
            userMessage item 晚到，而乐观气泡排在 timeline **之后**，中间那段窗口里计时会顶到
            用户消息**上方**（09-17 用户报过同款错位「这个怎么到这个位置了」，实测 1002ms 复现）。
            ⛔ 位置必须在「生成中」**之上**（09-17 用户「你这顺序不对吧，生成中怎么能放灰线上面呢」）：
            计时 + 分隔线属于**回合头信息**（紧接口回合标识），状态词属于内容区 —— 灰线是两者的分界。
            「发送后立刻」的反馈由乐观区块的 .turn-head 负责（见下方 chat-anchor 处）。 */}
        {running && userItems.length > 0 && <RunningProcessTime turnId={turn.id} />}
        {/* 占位头必须等回合内已有 userMessage：turn/started 先建回合、userMessage item 晚到，
            若不等就会渲染在乐观用户气泡上方（切会话后首条消息时肉眼可见错位，09-04 反馈）。
            空窗期反馈由乐观气泡 + 底部 working-indicator 覆盖。 */}
        {running && !hasVisible && userItems.length > 0 && <header className="turn-card-header">
          <span className="turn-card-dot" aria-hidden />
          <span className="turn-card-status shimmer-text">{statusLabel}</span>
        </header>}
        <div className="turn-card-body">
          <div className="codex-turn">
          {stoppedWithoutReply && <div className="interrupted-turn"><CircleStop size={15} /><div><strong>你在 {elapsedSeconds ?? 0} 秒后停止了</strong><span>Codex 尚未开始回复，因此没有生成内容。</span></div></div>}
          {/* ⛔ 非正常结束的回合必须说清「为什么停」（09-18 用户实测「跑长任务老是中途自动停止」）：
              旧实现只显示「处理出错」四个字，用户既不知道是上下文超限、沙箱拒绝还是被中断，
              也不知道能不能接着跑。这里把引擎的分类（codexErrorInfo）与处置建议摆到明面上，
              完整原文走 title 悬停。与上面 stoppedWithoutReply 互斥（那条已说明停止原因）。 */}
          {!running && !stoppedWithoutReply && !userStopped && stopReason.label && (
            <div className={`turn-stop-notice stop-${stopReason.kind}`} role="status" title={stopReason.detail}>
              <AlertTriangle size={15} />
              <div>
                <strong>{turn.durationMs ? `${stopReason.label} · 耗时 ${formatDuration(turn.durationMs)}` : stopReason.label}</strong>
                {stopReason.detail && <span>{stopReason.detail.split("\n")[0]}</span>}
              </div>
            </div>
          )}
          {/* inner 永远不渲染 finalAgent 的 footer（避免 running 时每个新 body 短暂成为 finalAgent 挂按钮 + 避免与外层 2129 行双排）。外层 turnFinished 决定最终是否独占渲染一份。CompletedChanges 仍需 completedTask（聊天回合没文件改动可显）。 */}
          <TurnFoldStream items={foldItems} turn={turn} running={running} fallbackWindow={fallbackWindow} waitingForApproval={waitingForApproval} handlers={handlers} finalAgentId={finalAgent?.id} usage={usage} tokenUsage={tokenUsage} keepProcessOpen={userStopped} />
          {completedTask && <CompletedChanges turn={turn} />}
          {/* 「用户已停止」标记：落在**最新内容之后**（用户 09-18 明确定位）。
              ⛔ 不重复耗时：上方过程组的标题已经写着「已停止 · 耗时 36 秒」，这里再说一遍就是
              同屏两处（用户对重复文案零容忍，09-18 已因同类问题返工过一次）。这里只说
              "发生了停止 + 内容没丢、可以接着来"这两件用户在意的信息。 */}
          {userStopped && (
            <div className="turn-user-stopped" role="status">
              <CircleStop size={14} />
              <div>
                <strong>用户已停止</strong>
                <span>运行过程与内容都已保留，接着发消息即可继续</span>
              </div>
            </div>
          )}
          {turnFinished && finalAgent && <MessageFooter item={finalAgent} turn={turn} usage={usage} tokenUsage={tokenUsage} fallbackWindow={fallbackWindow} onCopy={handlers.onCopy} onQuote={handlers.onQuote} onFork={() => handlers.onFork(turn.id)} extraIcon={hookBadge} />}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

export const MemoTurnView = memo(TurnView, (prev, next) =>
  prev.turn === next.turn
  && prev.usage === next.usage
  && prev.tokenUsage === next.tokenUsage
  && prev.fallbackWindow === next.fallbackWindow
  && prev.isLastTurn === next.isLastTurn
  && prev.waitingForApproval === next.waitingForApproval
  && prev.interruptedAt === next.interruptedAt
  && prev.elapsedSeconds === next.elapsedSeconds
  && prev.handlers === next.handlers
  && prev.hooks === next.hooks,
);

/** memo 用户消息：只有消息内容/回合变化才重渲染 */

export const MemoUserMessageView = memo(UserMessageView, (prev, next) =>
  prev.item === next.item
  && prev.turn === next.turn
  && prev.fallbackWindow === next.fallbackWindow,
);
