/**
 * model-custom-ipc —— **side-effect barrel**：各域的 ipcMain.handle 在子文件模块加载期注册（09-22 结构改造）。
 * ⛔ 顺序即契约（若含 hook / 副作用注册，调用顺序 == 原文件顺序）⇒ 只能按文件名前缀顺序 import。
 */
import "./model-custom-ipc/01-openai-login";
import "./model-custom-ipc/02-openai-vault-import";
import "./model-custom-ipc/03-openai-accounts";
import "./model-custom-ipc/04-custom-model-read";
import "./model-custom-ipc/05-custom-model-write";
