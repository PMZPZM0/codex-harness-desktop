/**
 * codex-official-market 域 · 公开面（barrel）。别的域只许从这里 import（架构规则 §1）。
 *
 * 这里是**插件页的第二个市场数据源**（Codex 官方 `openai/plugins`，国内镜像）；
 * Gitee 镜像源仍在 `settings-plugins` 域里（那边是 `.plugin-market-block` 的默认视图）。
 */
export { CodexOfficialMarketSection } from "./CodexOfficialMarketSection";
