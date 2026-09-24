/**
 * dialog-ipc（09-22 架构改造：从 electron/main.ts 组合根按域拆出，纯搬迁）
 *
 * 域：**系统文件选择对话框**（渲染层「浏览 / 添加目录 / 选图片 / 选文件 / 选私钥」的入口）。
 * 搬出符号：IPC handler dialog:directory / dialog:directory-at / dialog:images /
 *           dialog:files / dialog:ssh-key。
 * 消费方：设置页与工作区选择器。
 *
 * 代码与原地逐字一致（仅顶部 import、文件头注释、通道归并）。
 * 跨域符号经 `import … from "../main"` 取用 —— **活绑定**（TS→CJS 编译成 `main_1.X` 属性访问），
 * 且**只在 handler 回调体内求值**（模块体不碰跨域符号）⇒ 不受 main.ts 模块体执行顺序影响
 * （【91】复发防线：main.ts 的 `app.setPath("userData", …)` 是模块体语句，本模块在其之前被
 *  import 加载 —— 顶层求值会拿到错的 userData）。
 *   - `mainWindow`：主窗口实例（创建前为 null，handler 运行时已就绪）。
 *   - `trustPicked`：把用户亲自选过的路径登记进可信根（安全收敛口径，见 main.ts trustedRoots）。
 * 注册时机不变：main.ts 模块加载期 import 本文件 ⇒ ipcMain.handle 立即执行（早于 whenReady）。
 */
import { dialog, ipcMain } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { mainWindow, trustPicked } from "../runtime-refs";

ipcMain.handle("dialog:directory", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, { properties: ["openDirectory", "createDirectory"] });
  if (result.canceled) return null; trustPicked(result.filePaths); return result.filePaths[0];
});
// /add-dir：从指定起始目录打开选择器（目录不存在时回落到默认行为）
ipcMain.handle("dialog:directory-at", async (_event, startPath: string) => {
  const start = startPath && existsSync(startPath) ? startPath : undefined;
  const result = await dialog.showOpenDialog(mainWindow!, { properties: ["openDirectory", "createDirectory"], defaultPath: start });
  if (result.canceled) return null; trustPicked(result.filePaths); return result.filePaths[0];
});
ipcMain.handle("dialog:images", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
  });
  if (result.canceled) return []; trustPicked(result.filePaths); return result.filePaths;
});
ipcMain.handle("dialog:files", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "All files", extensions: ["*"] }],
  });
  if (result.canceled) return []; trustPicked(result.filePaths); return result.filePaths;
});
// 私钥文件选择器：设置页「浏览…」按钮
ipcMain.handle("dialog:ssh-key", async (_event, startPath?: string) => {
  const start = startPath && existsSync(path.dirname(startPath)) ? path.dirname(startPath) : undefined;
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: "选择 SSH 私钥文件",
    properties: ["openFile"],
    defaultPath: start,
    filters: [{ name: "SSH 私钥", extensions: ["", "pem", "key", "ppk", "id_rsa", "id_ed25519"] }, { name: "All files", extensions: ["*"] }],
  });
  return result.canceled || !result.filePaths?.length ? null : result.filePaths[0];
});
