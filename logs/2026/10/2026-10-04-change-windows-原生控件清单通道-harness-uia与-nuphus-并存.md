---
id: 2026-10-04-change-windows-原生控件清单通道-harness-uia与-nuphus-并存
date: 2026-10-04
kind: change
area: automation
title: Windows 原生控件清单通道 harness-uia（与 nuphus 并存）
tags: [desktop-automation, uia, mcp, windows, security]
commits: [74b7f81]
files: [resources/tools/harness-uia.mjs, resources/tools/desktop-uia.ps1, electron/automation-policy.ts]
importance: high
---

# Windows 原生控件清单通道 harness-uia（与 nuphus 并存）

## 结论

Windows 桌面自动化加第二条通道：**harness-uia**（独立 MCP 服务器，4 个 `desktop_ui_*` 工具），
用 Windows 自带的 UI Automation 拿「原生控件清单」并按**元素序号**操作。与 nuphus 并存、不替换。

## 依据

- nuphus 的定位是「截屏 → 本地 OCR → 像素坐标」，坐标在窗口挪动 / DPI 缩放 / 自绘界面上会失手；
  Windows 自己有一份控件清单（元素类型 / 名字 / AutomationId / 矩形 / 支持的动作）。
- ⛔ 不塞进 nuphus：它是第三方预编译二进制，我们改不了它的工具面。
- 零体积：用 Windows PowerShell 5.1 自带的 `UIAutomationClient` / `UIAutomationTypes` 程序集，不下载、不随包二进制。
- 实测三条通道的适用边界：**Chromium / Electron / Tauri 窗口的 UIA 树只有个位数元素**
  （Clash Verge 16 个原始元素里只有 2 个有意义、ZCode 9 个）⇒ 网页内容必须走 `browser_*`，不是走 UIA。

## 影响面

- 新增 `resources/tools/harness-uia.mjs`（MCP 门面）+ `resources/tools/desktop-uia.ps1`（UIA 桥），
  两者进 `extraResources`；⛔ 同时补 `.gitignore` 反选 —— 原 `resources/tools/*` 会把它们挡在版本控制外，
  那样守卫【29】里"干净检出就有"的说法就是假的（本次自查抓出）。
- `automation-policy.ts`：`HARNESS_UIA_MCP_SERVER` / `HARNESS_UIA_TOOLS` / `uiaDesktopSupported` / `shouldRegisterUia`；
  `custom-model-apply.ts` 注册段 + `ownedMcpServers`；`toolchain.ts` 的 `harnessUiaServer()`（两文件齐备才算就绪）。
- 判据是「win32 + 桌面总闸 + 脚本齐备」，不注册=整段不写；⛔ 不复用 nuphus 的 `disabled_tools` 掩码。
- `desktop-automation` 技能与常驻指令补「选路」表：原生走清单 / 网页走 `browser_*` / 清单拿不到才用 OCR 坐标。
- 守卫【273】9 条（含真跑 `dist-electron/automation-policy.js` 的注册真值表 4/4）；【29】BY_DESIGN 两条；
  【265】棘轮 07-turn-fold 4879→4887。

## 三条实测坑（下次还会踩）

1. ⛔ **PowerShell 按系统 ANSI(GBK) 写管道**：汉字尾字节可能是反斜杠或双引号的 ASCII 码 ⇒ 输出的 JSON 直接打断。
   解法 = `.ps1` 全文纯 ASCII（含注释！我自己写第一条注释就违反了）+ 强制 `[Console]::OutputEncoding` 为 UTF-8。
2. ⛔ **最小化 / 越界窗口的矩形是 `Infinity`**，`ConvertTo-Json` 原样写出 `Infinity` ⇒ 不是合法 JSON。
   解法 = 坐标一律过 `Round-Geom`，拿不到给 `null` 而不是假的 `0`。
3. **守卫标签里别放 ✓/✗ 字形** —— `grep ✗` 找失败会误命中自己那条绿色断言（本次真被它骗了一次）。

## 验证

- 守卫【273】9 条全绿；两个工程 `tsc` 0 错误。
- 真机实测通道：窗口清单 6 条（hwnd/类名/pid/矩形齐全）、Qoder CN 窗口 630 个原始元素筛出清单、
  无 `confirm` 的写操作被拒、越界矩型归一后 JSON 可解析。
- ⛔ **未实测**：`invoke` / `set_value` 的真实点击与填值效果 —— 不在别人正开着的窗口上乱点，
  需要指定安全目标（如用户自己开的记事本）后单独验一次。
- ⛔ **未跑通整条 `npm run check`**：另一路会话当时正在改 `catalogs.ts` / `composition.json` / `_ctx.mjs`，
  预检有 4~5 项红来自他们的在制品（含一次 `readMainSource is not defined` 让预检自身中断）。
  本提交只含自己的文件，混改的 `09-structural.mjs` 用「HEAD + 仅我一行」方式暂存。

## 回滚

`git revert 74b7f81`。数据面零残留（这条通道不落盘任何用户数据；不注册即完全消失）。
