---
id: 2026-10-22-change-qoder式本轮产物文件卡与右栏工作区文件预览联动
date: 2026-10-22
kind: change
area: ui
title: Qoder 式本轮产物文件卡 + 右栏工作区文件预览联动
tags: [file-cards, right-panel, rea, qoder]
commits: [567c880]
files: [src/features/status/OutputFileCards.tsx, src/lib/right-file.mjs, src/lib/right-file.d.mts, src/features/app-view/AppView/RightFileBridge.tsx, src/features/app-view/AppView/03-workspace-files.tsx, src/features/app-view/AppView/03-review-panel.tsx, src/features/app-view/AppView.tsx, src/features/status/Status.tsx, src/styles/04-cards-tools.css, src/styles/14-model-onboarding.css, electron/features/shell-ipc.ts, electron/ipc-channels.manifest.json, electron/ipc-registry.ts, scripts/guards/11p-file-summary.mjs, scripts/accept.mjs]
importance: normal
---

# Qoder 式本轮产物文件卡 + 右栏工作区文件预览联动

## 背景
用户对照 Qoder 截图：「使用 REA 逆向分析 Qoder 这种文件卡片展示怎么做的，右侧侧边栏文件打开联动怎么实现的，帮我也加上」。截图里每轮新建文件以卡片列出（图标 + 名称 + 类型 + 「在右侧栏」下拉 + 「…」菜单），点击在右侧「工作区文件」里预览。

## REA 取证（Qoder 0.4.8，`D:\Program Files (x86)\Qoder\.qoder-versions\0.4.8\resources\app.asar`）
- `@electron/asar` 解包后，UI 在 `out/renderer/assets/DIR8HOYO.js`（15.5MB）。
- i18n `outputFiles`：`ariaLabel:"本轮产物"`、`showMore:"显示其余 {{count}} 个文件"`、`openModeAriaLabel`、
  `openInNewWindow`、`openInWorkspace:"在右侧栏查看"`、`openInSystemApplication:"默认应用"`、
  `moreFileActions`、`copyAbsolutePath/copyRelativePath`。
- 组件：`SZ0` = 本轮产物区（`data-chat-turn-output-files`），`u91=7` ⇒ **最多 7 张**，超出渲染
  `data-chat-output-files-disclosure`；`LZ0` = 单卡，`Qm` 文件芯片 + `yZ0` 打开方式下拉 + `wZ0` 更多操作；
  `jZ0`：默认 `workspace` → `onPreviewFile(path)`（失败回落 `onOpenFile`），`newWindow` → `onOpenInNewWindow`，
  HTML → 内置浏览器，其余 → 系统默认应用；`MZ0` 读设置 `assistantOutputFileDefaultOpenTarget`（workspace/newWindow）。
- 卡片悬停 120ms 出 `data-output-file-preview-hover` 预览；右侧栏是「工作面标签」体系（审阅 / 工作区文件 / 浏览器…）。

## 结论
- **文件卡**：只给**本轮新建文件**（`newFile && !deletedFile`）出卡，最多 7 张、超出折叠；卡片含图标、名称、
  路径、类型、`+N -N`、打开方式下拉（在右侧栏 / 在编辑器打开 / 默认应用，默认存 localStorage
  `output-file-open-target`）与 `…`（复制路径 / 在文件夹中显示）。编辑已有文件仍只走原汇总卡，⛔ 不重复展示。
- **联动**：点卡片 → `src/lib/right-file.mjs` 事件箱 → `RightFileBridge` 打开右栏、切「文件」页、放宽到 420px、
  高亮并展开项目树；右栏「文件」页 = 项目树（单击预览 / 双击居中编辑器）+ `WorkspaceFilePreview`（`fs:read`，
  支持 Markdown / 代码 / 图片 / PDF / 二进制占位）。
- **默认应用**：新增通道 `shell:open`（与 `shell:reveal` 同一道 `isInsideOrEqualTrustedRoots` 闸；渲
  染层路径不可信，⛔ 不放行任意路径）。
- 桌面版没有 Qoder 的独立产物预览窗 ⇒ 打开方式第二项诚实命名为「在编辑器打开」（居中预览/编辑），不假装新窗口。

## 依据
- REA：Qoder `out/renderer/assets/DIR8HOYO.js` 的 `outputFiles` i18n 与 `SZ0/LZ0/jZ0/MZ0` 组件；7 张折叠、
  打开方式默认设置、点击默认 `workspace` 预览均来自上述代码，不是猜的。
- 真机探针（e2e 持久 profile）：历史会话里找到 7 张卡（`notes.md/app.css/data.json/index.html/logo.svg/readme.txt/util.mjs`）；
  点第一张 → 右栏 active tab「文件」、预览头 `notes.md`、面板 399×409；树里点 `AGENTS.md` → 预览正文 65,707 字。
- 验收 `file-cards` 4/4（卡片数量/结构、点卡开右栏、打开方式三项、树预览真实内容）；默认轮 12/12；守卫 11p 69 条。

## 影响面
回合底部新增产物卡（仅新建文件）；右栏「项目树」改名/升级为「文件」，单击预览、双击编辑器；
新增 `shell:open` 通道与 `right-file` 事件箱。用户可感知：新建文件在对话里直接成卡，点一下右栏就能看内容，
不用先开居中弹窗。

## 回滚
回退本提交。删除 `OutputFileCards` 与 `right-file` 事件箱、还原 `03-review-panel` 的树区与标签、移除
`shell:open`（manifest/registry/gen 三处同退）即可；无数据迁移。
