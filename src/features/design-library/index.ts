/**
 * 设计参考域 · 公开面（barrel）。别的域只许从这里 import（架构规则 §1）。
 * 自包含板块（不进程 bag，样板同 component-library）：数据来自 design-md 域（list/get/export），
 * 与 Codex 工具 design_md 同源（resources/design-md/library.json）。
 */
export { DesignLibraryPage } from "./DesignLibrary";
