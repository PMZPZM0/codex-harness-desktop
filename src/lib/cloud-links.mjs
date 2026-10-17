/**
 * 云端站点的页面地址（基座，纯函数、可被预检直接跑）。
 *
 * 目前只有一项：**云端用户中心**（账户 / 积分 / 模型勾选 / 知识库 / 记忆 的自助页面）。
 *
 * ⛔ 为什么由账号服务基址**派生**而不是写死域名：自建部署换基址时，请求与页面两处
 *   必须一起改 —— 写死就是"接口通了、链接还是老站"这种半拉子状态。
 * ⛔ 用户中心是**纯静态页 + 账号服务接口**，⛔ 不需要桌面端在线（页面里与「本机助手」
 *   相关的只有配对中心那一块，它会自行降级提示）。
 */

/** 账号服务基址 → 云端用户中心 URL。基址空串时返回空串（调用方据此不渲染入口）。 */
export function cloudUserCenterUrl(accountsBase) {
  const base = String(accountsBase || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  const origin = base.endsWith("/cloud-api") ? base.slice(0, -"/cloud-api".length) : base;
  return `${origin}/account.html`;
}
