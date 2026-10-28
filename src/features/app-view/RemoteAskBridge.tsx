/**
 * 手机端回答「询问卡」的回包桥（10-28）
 *
 * `agent_ask` 是**宿主动态工具**：它挂在渲染层的一个 Promise 上（等用户点选项），
 * 主进程没法直接 resolve。手机把它选的答案经 RPC 送到主进程，主进程再经
 * `harness:event { type: "remote-agent-ask-answer" }` 送回来 —— 这里把它接到同一
 * 个 resolve 上，等价于用户在电脑上点了那一下。
 *
 * ⛔ 只认「有挂起询问卡 + 会话匹配」的情况；没有卡/别的会话一律忽略（不动别人的卡）。
 */
import { useEffect } from "react";

type Props = {
  agentAsk: { threadId?: string; resolve?: (answer: string) => void } | null | undefined;
  setAgentAsk: (value: null) => void;
};

export function RemoteAskBridge({ agentAsk, setAgentAsk }: Props) {
  useEffect(() => {
    const off = window.codex.onHarnessEvent((payload) => {
      if (payload?.type !== "remote-agent-ask-answer") return;
      if (!agentAsk || typeof agentAsk.resolve !== "function") return;
      const askThread = String(agentAsk.threadId ?? "");
      const incoming = String(payload.threadId ?? "");
      if (askThread && incoming && askThread !== incoming) return;
      try {
        agentAsk.resolve(String(payload.answer ?? ""));
      } catch {
        // 重复回答 / 卡已关闭：忽略
      }
      setAgentAsk(null);
    });
    return () => {
      try { off(); } catch { /* 卸载时通道已关 */ }
    };
  }, [agentAsk, setAgentAsk]);
  return null;
}
