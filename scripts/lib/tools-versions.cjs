/**
 * 随包工具链版本的**单一来源**（09-24，评估报告 §3.4）。
 *
 * ⛔ 为什么要有这个文件：此前 Windows 与 mac 各自**硬编码字面量**，实测漂移出
 *    `playwright-core` 1.62.1（win）vs 1.58.2（mac）—— 差 4 个小版本，而两处都没有任何
 *    注释说明原因。漂移不是"某人改错了"，而是**两处独立字面量**这个机制必然的结果。
 *
 * ⛔ 本文件**不改任何现值**：各平台保留各自当前的钉法。把 mac 对齐到 1.62.1（或反过来）
 *    属于**产品决策** —— mac 侧无法在开发机上验证（CI 才跑），贸然对齐可能直接打坏 mac 包。
 *    要动只改这一张表，并同轮更新 tools-versions 的守卫【141】。
 *
 * ⛔ nuphus 版本另有**四处同源**要求（见 prepare-windows-tools.cjs 顶部注释）：
 *    ① 本文件 ② prepare-mac-tools.cjs 的 npm 安装 ③ mac 的 manifest ④ build-mac.yml 的 ref:
 *    本文件是 ①②③ 的来源；CI workflow 里的 `ref:` 由守卫【29】/【141】钉住一致性。
 */
const TOOLS_VERSIONS = {
  /** 桌面自动化 MCP（nuphus）：四处同源，升级理由通常是安全依赖 */
  nuphus: "0.2.3",
  /** Playwright CLI（随包直出的浏览器自动化入口） */
  playwrightCli: "0.1.18",
  /** playwright-core：⛔ 各平台现值不同，见文件头说明 */
  playwrightCore: {
    win32: "1.62.1",
    darwin: "1.58.2",
  },
  /** ponytail 写代码模式插件（首启自动种入） */
  ponytail: "v4.9.0",
};

module.exports = { TOOLS_VERSIONS };