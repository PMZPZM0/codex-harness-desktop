/** feishu-card.mjs 的类型面（渲染层 tsc 要求 .mjs 配 .d.mts；与 src/lib/refresh-receipt 同款）。 */
export type FeishuPollFlow = "" | "setup" | "reconfig" | "login" | "logout";

export function feishuPollOutcome(input: {
  flow: FeishuPollFlow;
  configured: boolean;
  loggedIn: boolean;
  /** 仅 flow="reconfig" 用：appId 是否已变（换应用时的完成信号之一） */
  appChanged?: boolean;
  /** 配置流程（config init 子进程）状态；done 是「选已有应用」场景的唯一完成信号 */
  setupState?: "idle" | "running" | "done" | "failed";
}): { keepLink: boolean; clearBusy: boolean; failed?: boolean };
