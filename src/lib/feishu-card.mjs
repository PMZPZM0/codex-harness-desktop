/**
 * 飞书 CLI 卡片轮询的归约（10-29）：这次轮询后，授权链接要不要收起、等待态要不要放掉。
 *
 * ⛔ 为什么单独抽出来：这条判定曾经写在组件闭包里，出过一次真事故 ——
 *    「见到 configured 就收链接」：登录阶段配置**本来就是已完成的** ⇒ 链接被收 ⇒
 *    轮询 effect 依赖 link 被掐断 ⇒ 浏览器里授权成功、卡片永远停在「等待授权」。
 *    组件里的判定没有真值表，改坏了只能靠用户截图发现。规则收到这里，守卫跑真值表。
 *
 * 10-30 二次事故（用户实测「我选择已有机器人，又不刷新状态了」）：
 *   重新配置原先只认「appId 变了」一个信号 ⇒ 在浏览器里选**已有应用**（同一个 appId）
 *   永远等不到变化，卡片一直「配置中」。
 *   ⇒ 主进程补 `setupState`（config init 子进程的 `running / done / failed`），
 *     `done`（退出码 0 = 配置已写入）也算完成；`failed` 收尾并如实报错。
 *
 * @param {{ flow: "" | "setup" | "reconfig" | "login" | "logout"; configured: boolean; loggedIn: boolean; appChanged?: boolean; setupState?: "idle" | "running" | "done" | "failed" }} input
 * @returns {{ keepLink: boolean; clearBusy: boolean; failed?: boolean }}
 */
export function feishuPollOutcome({ flow, configured, loggedIn, appChanged = false, setupState = "idle" }) {
  /* ⛔⛔ 重新配置必须排在最前：切换前旧应用**仍然是已登录**的，若先看 loggedIn 就会在首轮
     轮询（2 秒后）直接收链接 + 结束流程 —— 用户浏览器里还没做完，卡片就没了。
     完成信号两个：appId 变了（换应用）**或** config init 正常退出（选的是已有应用）。 */
  if (flow === "reconfig") {
    if (appChanged) return { keepLink: false, clearBusy: true };
    if (setupState === "done") return { keepLink: false, clearBusy: true };
    if (setupState === "failed") return { keepLink: false, clearBusy: true, failed: true };
    return { keepLink: true, clearBusy: false };
  }
  /* 首次配置：config init 失败就收尾报错（别让链接与「配置中」挂在界面上）。 */
  if (flow === "setup" && setupState === "failed") return { keepLink: false, clearBusy: true, failed: true };
  if (loggedIn) return { keepLink: false, clearBusy: true };
  if (flow === "setup" && configured) return { keepLink: false, clearBusy: true };
  /* 等登录时配置已经完成，这是正常状态 —— 链接必须留着，否则 2 秒轮询跟着断。 */
  if (flow === "login") return { keepLink: true, clearBusy: false };
  return { keepLink: false, clearBusy: false };
}
