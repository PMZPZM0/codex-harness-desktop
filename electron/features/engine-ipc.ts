/**
 * engine-ipc —— **side-effect barrel**：各域的 ipcMain.handle 在子文件模块加载期注册（09-22 结构改造）。
 * ⛔ 顺序即契约（若含 hook / 副作用注册，调用顺序 == 原文件顺序）⇒ 只能按文件名前缀顺序 import。
 */
import "./engine-ipc/01-thread-runtime-codex-bridge";
import "./engine-ipc/02-engine-update";
import "./engine-ipc/03-dev-runtime";
import "./engine-ipc/04-dev-runtime-install";
import "./engine-ipc/05-threads-backup";
import "./engine-ipc/06-bridge";
