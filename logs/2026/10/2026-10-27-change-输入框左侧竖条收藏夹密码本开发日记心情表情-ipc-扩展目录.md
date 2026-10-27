---
id: 2026-10-27-change-输入框左侧竖条收藏夹密码本开发日记心情表情-ipc-扩展目录
date: 2026-10-27
kind: change
area: chat-ui
title: 输入框左侧竖条：收藏夹/密码本/开发日记/心情表情 + IPC 扩展目录
tags: [composer, rail, vault, journal, stickers, extensions]
commits: []
files: [src/features/composer-rail/ComposerRail.tsx, src/features/composer-rail/PasswordBookPanel.tsx, src/features/composer-rail/DevJournalPanel.tsx, src/features/composer-rail/MoodStickersPanel.tsx, electron/features/vault-ipc.ts, electron/features/journal-ipc.ts, electron/features/extensions-ipc.ts, src/styles/54-composer-rail.css, scripts/guards/12ae-composer-rail.mjs]
importance: normal
---

# 输入框左侧竖条：收藏夹/密码本/开发日记/心情表情 + IPC 扩展目录

用户（输入框左侧红框截图）：
「在输入框左边这个地方，线上中间加一个小粗条，做好展开折叠两种状态反馈，点击展开竖着的小窗口，
自适应展示位置，不要主界面小窗口展示不出来，注意多窗口自适应展示弹窗别被切掉了，跟输入框一样高，
宽度就一个图标宽度，最上面一个收藏夹图标…第二个密码本，专门给用户记密码的，密码本弹窗界面做好看一点，
功能配套齐全；第三个开发日记，日记弹窗也做好看一点…表情包图标，这里的表情包可以发给Codex的，
你内置一套心情表情包对应代码，发出去Codex要知道啥意思，选择表情先到输入框，可以跟输入框内容一起发出，
这个小贴条可以跨会话展示，所有会话点击展示都一样…默认隐藏的，点击小粗条自适应位置展示」+
「这个小粗条弹窗记得留好IPC接口，还有那个功能入口菜单也留好IPC接口，方便后续拓展和用户拓展」。

## 结构

- 竖条 `ComposerRail` 挂在 `<form className="composer">` 里 ⇒ 每个会话同一个组件（跨会话一致）；
  默认折叠成 6×64 圆角粗条（骑在输入框左边界外侧、垂直居中），点击展开 22px 图标列；
  top/bottom 拉伸 ⇒ 与输入框同高；展开态写 localStorage，所有会话同一口径。
- 弹层 `createPortal` 到 body，`placePanel()` 用**实测矩形**定位：右开优先 → 右边放不下翻左 →
  上下左右都夹进视口 8px 安全边 ⇒ 主窗口 / 小窗口都不会被切。

## 四个面板

1. 收藏夹：直接复用设置页同一个 `FavoritesSettingsSection`（同一份真相源，不另写一套）。
2. 密码本：`safeStorage` 加密 → `userData/vault.json`；**渲染层永远拿不到明文**（只回 hasSecret），
   复制密码走 `vault:copy`（主进程解密直写剪贴板）；加密不可用时**拒存**（宁可报错也不写明文）。
3. 开发日记：`userData/dev-journal/YYYY-MM-DD.md`，一天一个文件；追加写 `## HH:mm 标题` + 正文；
   支持全文检索、整篇编辑、删除、一键插入输入框。
4. 心情表情：内置 14 个（正向/负向/中性），点选插入「😤（我不满意，这次结果不对）」——
   表情给人看、括号释义给模型看，零引擎改动；可继续打字一起发。

## IPC 扩展目录（用户点名要留）

新增 `extensions:catalog`：返回 `{ rail, menu, file }`。
- 内置面板写在 `electron/features/extensions-ipc.ts`，**用户扩展**写在 `userData/extensions.json`；
- 竖条与「功能入口菜单」都从这份目录渲染（`FunctionMenu` 已接入，只收 url 动作）；
- ⛔ 封闭动作集：`url`（只 http/https）/ `settings`（跳设置页）/ `text`（说明面板）。
  不提供「执行命令/脚本」—— 一个 JSON 就能跑任意命令等于后门。

## 验证

- 真机（CDP）实测：折叠态 `open=false / 无图标 / 手柄 6×64 / 竖条中线 698 == 输入框中线 698 / sameHeight=true`；
  展开态 4 个图标、列高 100px 落在输入框 114px 内；
  四个面板 `left/top/right/bottom` 全部 `inViewport=true`（收藏夹/密码本/日记/表情各自的尺寸）。
- 截图：`01-rail-collapsed.png` / `02-rail-expanded.png` / `03..06-rail-panel-*.png`。
- 守卫 12ae-composer-rail 36/36（已进 `npm run check` 链）；electron tsc + 渲染层 tsc + build 全绿。

## 备注（并行线）

同一工作区还有并行会话在改 OpenFilm 与质检页；本轮只提交自己那批路径。
