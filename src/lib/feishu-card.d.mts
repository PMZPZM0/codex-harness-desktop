/** feishu-card.mjs 的类型面（渲染层 tsc 要求 .mjs 配 .d.mts；与 src/lib/refresh-receipt 同款）。 */
export type FeishuPollFlow = "" | "setup" | "reconfig" | "login" | "logout";

export function feishuPollOutcome(input: {
  flow: FeishuPollFlow;
  configured: boolean;
  loggedIn: boolean;
  /** 仅 flow="reconfig" 用：appId 是否已变（重新配置完成的唯一信号） */
  appChanged?: boolean;
}): { keepLink: boolean; clearBusy: boolean };
