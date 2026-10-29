/**
 * 飞书 CLI 卡片轮询的归约（10-29）：这次轮询后，授权链接要不要收起、等待态要不要放掉。
 *
 * ⛔ 为什么单独抽出来：这条判定曾经写在组件闭包里，出过一次真事故 ——
 *    「见到 configured 就收链接」：登录阶段配置**本来就是已完成的** ⇒ 链接被收 ⇒
 *    轮询 effect 依赖 link 被掐断 ⇒ 浏览器里授权成功、卡片永远停在「等待授权」。
 *    组件里的判定没有真值表，改坏了只能靠用户截图发现。规则收到这里，守卫跑真值表。
 *
 * @param {{ flow: "" | "setup" | "reconfig" | "login" | "logout"; configured: boolean; loggedIn: boolean }} input
 * @returns {{ keepLink: boolean; clearBusy: boolean }}
 */
export function feishuPollOutcome({ flow, configured, loggedIn, appChanged = false }) {
  /* ⛔⛔ 重新配置必须排在最前：切换前旧应用**仍然是已登录**的，若先看 loggedIn 就会在首轮
     轮询（2 秒后）直接收链接 + 结束流程 —— 用户浏览器里还没做完，卡片就没了。
     这条流程的唯一完成信号是 appId 变了（调用方算好 appChanged 传进来）。 */
  if (flow === "reconfig") return appChanged ? { keepLink: false, clearBusy: true } : { keepLink: true, clearBusy: false };
  if (loggedIn) return { keepLink: false, clearBusy: true };
  if (flow === "setup" && configured) return { keepLink: false, clearBusy: true };
  /* 等登录时配置已经完成，这是正常状态 —— 链接必须留着，否则 2 秒轮询跟着断。 */
  if (flow === "login") return { keepLink: true, clearBusy: false };
  return { keepLink: false, clearBusy: false };
}
