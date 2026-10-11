/**
 * app-view/helpers/turn-overlays —— 回合级「等用户操作」覆盖层的统一释放（10-11）。
 *
 * ⛔ 为什么必须单独收口：询问卡（`agent_ask`）与审批卡（`RequestCard`）都是**阻塞式**的 ——
 *    引擎在等一个回包。用户点「停止」或回合被引擎中止之后，宿主侧原先**没人收这两块**，
 *    它们会一直挂在输入框上方（用户 10-11 报障：手动停止后审批/询问弹窗留在界面上）。
 *    这里把「释放」做成唯一一处：按 threadId 认领 → **先给引擎一个合法回包**（否则那条请求
 *    在引擎侧永远悬着，或让 `agent_ask` 的 await 永不落地）→ 再从宿主状态里摘掉。
 *
 * ⛔ 回包形状全部照协议 schema 抄（`.workbuddy/codex-schema/*.json`），**别自造**：
 *    · `execCommandApproval` / `applyPatchApproval`：`{ decision: { denied: { rejection } } }`
 *    · `item/commandExecution|fileChange/requestApproval`：`{ decision: "decline" }`
 *      （decision 枚举 accept / acceptForSession / decline / acceptWithExecpolicyAmendment…）
 *    · `item/permissions/requestApproval`：`{ permissions: {}, scope: "turn" }`
 *    · `item/tool/requestUserInput`：`{ answers: {} }` —— schema 里只有 answers、**没有**取消形态，
 *      空表是它允许的最小合法回包
 *    · `mcpServer/elicitation/request`：`{ action: "cancel" }`（schema 三选一 accept/decline/cancel）
 *    形状都取自 `CommandExecutionRequestApprovalResponse.json` / `McpServerElicitationRequestResponse.json`
 *    / `ToolRequestUserInputResponse.json` —— 与 `RequestCard` 里用户点「拒绝」时用的是同一套。
 *
 * ⛔ 归属只认 `params.threadId`：五类请求的参数 schema **都带 threadId**（已逐个核对），
 *    所以「停止 A 会话」绝不会误收 B 会话的卡。
 */
import type { PendingRequest } from "../types";

/** 宿主侧询问卡的槽位（与 bag.agentAsk 同形；只取用到的两个字段 ⇒ 不反向依赖 bag 类型） */
export type TurnAskSlot = { threadId: string; resolve: (answer: string) => void } | null | undefined;

/** 按请求类型给一份「用户中止了」的合法回包（形状见文件头，勿改） */
function cancelPayloadFor(request: PendingRequest): unknown {
  const method = String(request?.method ?? "");
  if (method === "execCommandApproval" || method === "applyPatchApproval") {
    return { decision: { denied: { rejection: "User denied request" } } };
  }
  if (method === "mcpServer/elicitation/request") {
    return { action: "cancel", content: null, _meta: request?.params?._meta ?? null };
  }
  if (method === "item/tool/requestUserInput") {
    return { answers: {} };
  }
  if (method.includes("permissions")) {
    return { permissions: {}, scope: "turn" };
  }
  // 兜底：`bag.pending` 只由 `kind === "request"` 的事件喂入（见 part05/01-seg.tsx 的分发条件），
  // 全是"等用户答复"的请求；将来若出现新类型，这里按审批语义拒一次是最保守的答复。
  // ⛔ 引擎若因形状不符而拒收，调用方已经吞掉这个错 —— **摘卡优先**，界面不能留死卡。
  return { decision: "decline" };
}

/**
 * 释放某个会话的回合级覆盖层（询问卡 + 审批/输入请求）。
 *
 * 幂等：重复调用（例如停止按钮先收一次、随后引擎的 turn/aborted 再收一次）不会出错 ——
 * 第二次时对应状态已空，认领不到任何条目。
 *
 * @returns 释放掉的请求条数与是否收掉了询问卡（供调用方打点/断言）
 */
export function releaseTurnOverlays(args: {
  threadId: string;
  /** 当前挂起的请求（bag.pending）；不在挂起态传空数组即可 */
  pending: PendingRequest[] | null | undefined;
  /** 当前询问卡（bag.agentAsk） */
  agentAsk: TurnAskSlot;
  /** 回包通道（window.codex.respond） */
  respond: (id: string | number, payload: unknown) => Promise<unknown>;
  /** 从宿主状态里摘掉这些请求 id（bag.setPending 的函数式更新） */
  clearPending: (ids: Array<string | number>) => void;
  /** 清掉询问卡（bag.setAgentAsk(null)） */
  clearAsk: () => void;
  /**
   * 没有任何 threadId 的请求要不要一并收掉。默认 false（认不出归属就不动别人的卡）；
   * 用户**在当前会话**点停止时传 true —— 那种卡本来就是显示在当前视图里的。
   */
  includeUnattributed?: boolean;
}): { answered: number; askReleased: boolean } {
  const threadId = String(args.threadId ?? "");
  if (!threadId) return { answered: 0, askReleased: false };

  // ① 询问卡：走与 ESC 完全相同的语义（resolve 空串 ⇒ agent_ask 处理器会回一条
  //    「[用户取消了选择]」给引擎，见 part05/event-router/02-request.tsx）。
  //    ⛔ 必须先 resolve 再清状态：只清状态会让那个 await 永远不落地，工具调用挂死。
  let askReleased = false;
  if (args.agentAsk && String(args.agentAsk.threadId ?? "") === threadId) {
    try {
      args.agentAsk.resolve("");
    } catch {
      /* resolve 已调用过就抛，忽略 —— 状态照清 */
    }
    args.clearAsk();
    askReleased = true;
  }

  // ② 审批 / 输入 / elicitation：先回包再摘卡。
  //    ⛔ respond 失败（引擎已自行取消、请求 id 已失效）不影响摘卡 —— 界面不能留着死卡。
  const owned = (args.pending ?? []).filter((request) => {
    const owner = String(request?.params?.threadId ?? "");
    return owner ? owner === threadId : args.includeUnattributed === true;
  });
  for (const request of owned) {
    try {
      void Promise.resolve(args.respond(request.id, cancelPayloadFor(request))).catch(() => undefined);
    } catch {
      /* 同上 */
    }
  }
  if (owned.length) args.clearPending(owned.map((request) => request.id));
  return { answered: owned.length, askReleased };
}
