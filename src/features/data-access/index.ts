/**
 * data-access barrel（10-29）：域间只经 barrel，禁深链内部文件（预检【130】）。
 *
 * 这个域对外只有四样东西：
 *  · DATA_ACCESS_TOOLS —— 三个模型工具的定义（接进 dynamicTools）；
 *  · handleDataAccessTool —— 工具调用执行端（渲染层事件路由用）；
 *  · DataAccessPanel —— 会话级授权面板（rail 入口）；
 *  · VaultWriteConfirm —— 密码写入的一次性确认弹窗（AppView 挂载）。
 */
export { DATA_ACCESS_TOOLS } from "./tool-defs";
export { handleDataAccessTool } from "./tool-handler";
export { DataAccessPanel } from "./DataAccessPanel";
export { VaultWriteConfirm } from "./VaultWriteConfirm";
