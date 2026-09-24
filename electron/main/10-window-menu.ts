/**
 * main 的「window-menu」部分（09-22 从同目录 main.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import { Menu, Notification, app, BrowserWindow, clipboard, globalShortcut, ipcMain, nativeTheme, net, powerSaveBlocker, protocol, safeStorage, session, shell, systemPreferences } from "electron";
// 已知不提供 /models 列表的网关（Coding Plan 套餐等）：探测拉列表失败时返回内置推荐清单。
// 模型清单基于各官方文档（2026-09）；wire 是该网关实测的协议偏好（火山 Coding 仅支持 Chat）。

export function installContextMenu(win: BrowserWindow) {
  win.webContents.on("context-menu", (_event, params) => {
    const editable = params.isEditable;
    const hasSelection = Boolean(params.selectionText && params.selectionText.trim().length > 0);
    const flags = params.editFlags;
    const link = params.linkURL?.trim();

    const template: Electron.MenuItemConstructorOptions[] = [];
    const usable = () => template.some((item) => item.type !== "separator" && (item as { enabled?: boolean }).enabled !== false);

    // 复制：只要有选中文本即可（只读的正文 / 消息气泡区域也能复制）
    template.push({ label: "复制", accelerator: "CmdOrCtrl+C", enabled: hasSelection, click: () => win.webContents.copy() });
    // 剪切：仅可编辑且选中文本
    template.push({ label: "剪切", accelerator: "CmdOrCtrl+X", enabled: editable && hasSelection, click: () => win.webContents.cut() });
    // 粘贴：仅可编辑
    template.push({ label: "粘贴", accelerator: "CmdOrCtrl+V", enabled: editable, click: () => win.webContents.paste() });
    template.push({ label: "删除", enabled: editable && flags.canDelete, click: () => win.webContents.delete() });
    template.push({ type: "separator" });
    template.push({ label: "全选", accelerator: "CmdOrCtrl+A", enabled: flags.canSelectAll, click: () => win.webContents.selectAll() });

    if (link) {
      template.push({ type: "separator" });
      template.push({ label: "复制链接地址", click: () => clipboard.writeText(link) });
      template.push({ label: "在浏览器中打开", click: () => void shell.openExternal(link) });
    }

    template.push({ type: "separator" });
    template.push({ label: "撤销", accelerator: "CmdOrCtrl+Z", enabled: editable && flags.canUndo, click: () => win.webContents.undo() });
    template.push({ label: "重做", accelerator: "CmdOrCtrl+Shift+Z", enabled: editable && flags.canRedo, click: () => win.webContents.redo() });

    // 空白区域右键（无选中、非编辑、非链接）时没有任何可用项，不弹菜单
    if (!usable()) return;
    Menu.buildFromTemplate(template).popup({ window: win });
  });
}
