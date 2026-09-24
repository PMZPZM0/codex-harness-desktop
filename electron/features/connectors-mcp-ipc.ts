/**
 * connectors-mcp-ipc —— **side-effect barrel**：各域的 ipcMain.handle 在子文件模块加载期注册（09-22 结构改造）。
 * ⛔ 顺序即契约（若含 hook / 副作用注册，调用顺序 == 原文件顺序）⇒ 只能按文件名前缀顺序 import。
 */
import "./connectors-mcp-ipc/01-prompt-enhance";
import "./connectors-mcp-ipc/02-oauth";
import "./connectors-mcp-ipc/03-connectors";
import "./connectors-mcp-ipc/04-mcp-servers";
