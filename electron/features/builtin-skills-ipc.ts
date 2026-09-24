/**
 * builtin-skills-ipc —— **side-effect barrel**：各域的 ipcMain.handle 在子文件模块加载期注册（09-22 结构改造）。
 * ⛔ 顺序即契约（若含 hook / 副作用注册，调用顺序 == 原文件顺序）⇒ 只能按文件名前缀顺序 import。
 */
import "./builtin-skills-ipc/01-builtin-images";
import "./builtin-skills-ipc/02-skills-registry";
import "./builtin-skills-ipc/03-plugins-market";
import "./builtin-skills-ipc/04-hooks";
