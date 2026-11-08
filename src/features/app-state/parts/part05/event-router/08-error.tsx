/**
 * handleEventRouter8 —— 01-seg 里那条事件总路由的第 8 个分支体（09-22 纯搬迁）。
 * ⛔ 语义等价要点：原体里的 `return` 是**从 onEvent 回调退出**；本函数把它改成 `return true`，
 *    调用处 `if (handleN(...)) return;` —— 提前退出的效果逐位保留（回调的返回值本来就被丢弃）。
 */
import { ALIGN_RESULT, CONTINUITY_TEXT, HARNESS_PROVIDER_ID, shouldAlignProvider } from "../../../../../lib/provider-continuity.mjs";
import { isRateLimitError } from "../../../../../lib/rate-limit-retry";
import type { Bag } from "../../bag-types";

/** 事件路由第 8 段：错误与限流。限流同样进自动重试；引擎原始英文报错翻成能照做的中文提示。 */
export function handleEventRouter8(bag: Bag, params: any): boolean {
        // error 通知也可能是限流（引擎 RPC 直接报错）：同样进入自动重试
        const rawError = params.error?.message ?? params.message ?? "";
        const details = String(params.error?.additionalDetails ?? params.additionalDetails ?? "");
        // 引擎的 Reconnecting 是英文原始报错，直接显示不友好——翻译成中文提醒：
        // 401=Key 错配（供应商切换后旧会话），流中断=网关不稳（pptoken 常见），均会自动重试。
        const reconnectMatch = rawError.match(/^Reconnecting\.\.\.\s*(\d+)\/(\d+)/);
        /* ⛔⛔ 11-02 用户实测：「上游限流那个提示，模型都正常回复了，还在」。
           Reconnecting 是**引擎正在重试中的进度提示**，不是回合终态：
           ① 不能当成回合结束（否则发送态被熄、线程被标停，重连成功后回复照常来，提示却没人收）；
           ② 迟到的重连通知（回合已经跑完才到）不许把提示再挂回去 —— 该会话既不在运行、
              也没有正在显示的上游提示 ⇒ 视为过期直接忽略。
           ⛔ 清场在 turn/started、流式内容、turn/completed / aborted / failed / interrupted 四处。 */
        const reconnecting = Boolean(reconnectMatch);
        if (!reconnecting) {
          bag.setSending(false);
          bag.setInterrupting(false);
          bag.markThreadStopped(params.threadId);
        }
        const reconnectTid = String(params.threadId ?? "");
        if (reconnectMatch && reconnectTid) {
          const reconnectNo = Number(reconnectMatch[1]);
          const reconnectTotal = Number(reconnectMatch[2]);
          bag.setUpstreamRetries((current) => {
            const alive = bag.runningThreadIdsRef.current.has(reconnectTid)
              || bag.runningTurnIdsRef.current.has(reconnectTid)
              || reconnectTid in current;
            if (!alive) return current;
            return { ...current, [reconnectTid]: { no: reconnectNo, total: reconnectTotal } };
          });
          // 兜底：连续 2 分钟没有任何新的重连进度 ⇒ 视为已恢复（或引擎不再报），提示自动消失。
          // ⛔ 只在条目仍是本次写入的那一条时才清（后续进度会刷新 no，旧定时器一律 no-op）。
          window.setTimeout(() => {
            bag.setUpstreamRetries((current) => {
              const entry = current[reconnectTid];
              if (!entry || entry.no !== reconnectNo || entry.total !== reconnectTotal) return current;
              const next = { ...current };
              delete next[reconnectTid];
              return next;
            });
            /* 审查补强：重连提示不再把线程标停（见上），万一引擎重试耗尽却不发终态事件，
               运行态会永久挂着 —— 这里向引擎核对一次：它已经不在跑就直接熄灯（含当前会话的
               发送/停止键状态；否则线程停了、输入框还停在「停止」）。 */
            if (bag.runningThreadIdsRef.current.has(reconnectTid)) {
              void window.codex.engineActiveTurns().then((info) => {
                if ((info?.threadIds ?? []).map(String).includes(reconnectTid)) return;
                bag.markThreadStopped(reconnectTid);
                if (bag.threadRef.current?.id === reconnectTid) {
                  bag.setSending(false);
                  bag.setInterrupting(false);
                  bag.setActiveTurnId(null);
                }
              }).catch(() => undefined);
            }
          }, 120_000);
        }
        let errorMessage = rawError;
      if (reconnectMatch) {
        const no = reconnectMatch[1], total = reconnectMatch[2];
        if (details.includes("401")) {
          errorMessage = `第 ${no}/${total} 次自动重试：供应商认证失败（API Key 不匹配）。若刚切换过供应商，请停止后重发以自动迁移会话；仍失败请检查该供应商的 Key`;
          // ★ 401 = 会话绑定的供应商 ≠ 当前激活（Key 换了）→ 自动迁移一次，等价「停止后重发」
          //   的迁移，但不需要用户停止：resume 重绑定后引擎重连自然接上新供应商。
          //   触发动机必须在这里兜住：**上下文压缩是引擎自发行为，不走发送路径的迁移检查**，
          //   压缩 401 时用户根本没有「重发」可点（09-14 用户实测：切供应商后旧会话压缩 401 循环）。
          //   每会话只自动迁一次（autoMigratedRef），防 Key 真错时的无限迁移循环。
          const errTid = String(params.threadId ?? "");
          const boundProvider = errTid ? bag.threadProviderRef.current.get(errTid) : undefined;
          const active = bag.activeProviderRef.current;
          // ⛔ 判定同样必须走 shouldAlignProvider：统一内置 provider id（harness）之后，
          // 会话绑定恒为 `harness`、生效供应商是 `custom906` —— 裸比较恒为真，会让每次 401
          // 都把 errTid 记进 autoMigratedRef（「已迁移」是假的，真实迁移没发生），
          // 万一真的需要迁移时反而被这条标记拦住。规则见 src/lib/provider-continuity.mjs。
          if (errTid && boundProvider && active?.provider && shouldAlignProvider(boundProvider, active.provider) && !bag.autoMigratedRef.current.has(errTid)) {
            bag.autoMigratedRef.current.add(errTid);
            // 文案与「自动接力」统一（09-14 用户定稿）：401、打开会话、切换供应商三种场景
            // 走同一入口、同一套说法（自动接力 / 历史上下文与聊天记录完整保留）。
            void bag.alignThreadToProvider(errTid, { provider: active.provider, model: active.model, name: active.name, baseUrl: active.baseUrl, wireApi: active.wireApi }, { reason: "error" })
              .then((r) => { if (r === ALIGN_RESULT.failed) bag.autoMigratedRef.current.delete(errTid); })
              .catch(() => bag.autoMigratedRef.current.delete(errTid));
          }
        }
          else if (/stream (dis)?connected|closed before/i.test(details) || details.includes("httpStatusCode\":null")) errorMessage = `第 ${no}/${total} 次自动重试：上游网关响应中断（模型服务不稳）。引擎正在自动重连，多数情况下稍等即可恢复；持续失败建议换模型或换供应商`;
          else errorMessage = `第 ${no}/${total} 次自动重试：连接中断，引擎正在自动恢复……`;
        } else if (details.includes("401") && /API key format is incorrect/i.test(details)) {
          errorMessage = "供应商认证失败（API Key 与服务商不匹配）：当前供应商的 Key 被发到了另一个服务商。请停止后重发（会自动迁移会话），或检查供应商配置";
        } else if (/402|payment\s*required|insufficient[_\s-]*(balance|quota|funds)|余额不足|欠费/i.test(`${rawError}\n${details}`)) {
          /* 11-08 用户截图：「unexpected status 402 Payment Required: Insufficient Balance … url: 127.0.0.1:47121」
             —— 上游余额不足的原文直接甩给用户看不懂；翻译成可执行的处置（充值 / 换模型），并说明重试无用。 */
          errorMessage = "供应商账户余额不足（上游返回 402 Insufficient Balance）：请到该供应商后台充值，或切换模型 / 供应商后重发。重试不会成功";
        }
        // ⛔ 429 的**排重试**在跨会话区（engine error 通知也覆盖后台会话）；这里只在
        //   非限流的错误上清上下文（限流错误留给重试链，清了就没人重发了）。
        // ⛔⛔ 09-19 实测致命 bug：判定必须用**原始错误**（rawError + details），
        //   不能用上面翻译过的 errorMessage —— 翻译后的中文（「第 10/10 次自动重试：连接中断…」）
        //   里已经没有 429/限流字样 ⇒ isRateLimitError 恒假 ⇒ 跨会话区刚排好的重试链
        //   **在这里被当场 cancel** ⇒ 用户看到「有 429 但不重试、直接中止」（截图实证）。
        const rawIsRateLimit = isRateLimitError([rawError, details].join(" "));
        if (params.threadId && bag.retryContextsRef.current.has(String(params.threadId)) && !rawIsRateLimit) {
          bag.cancelRateLimitRetry(String(params.threadId), true);
        }
        if (bag.compactPendingRef.current.delete(String(params.threadId ?? bag.threadRef.current?.id ?? ""))) {
          bag.setCompactEventState("error", errorMessage);
        }
        bag.setNotice(errorMessage || "Codex 请求失败");
      
  return false;
}
