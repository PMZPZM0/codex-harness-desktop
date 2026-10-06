---
id: 2026-10-06-change-编辑行冻结汇总卡持久化diff预览升级行号槽两轴滚动
date: 2026-10-06
kind: change
area: ui
title: 编辑行冻结+汇总卡持久化+diff预览升级（行号槽/两轴滚动）
tags: [file-changes, persistence, diff-preview, session-queue]
commits: [70953e2]
files: [electron/turn-file-watch.ts, electron/features/boot.ts, electron/features/codex-ipc.ts, src/features/session-queue/SessionQueue.tsx, src/features/status/Status.tsx, src/features/status/DiffPreview.tsx, src/lib/diff-view.mjs, src/lib/turn-file-changes.mjs, src/styles/04-cards-tools.css, scripts/guards/11p-file-summary.mjs, scripts/guards/11q-live-edits.mjs, scripts/accept.mjs]
importance: normal
---

# 编辑行冻结+汇总卡持久化+diff预览升级（行号槽/两轴滚动）

# 编辑行冻结（收尾不清场）+ 汇总卡落盘持久化 + diff 预览升级（行号槽 / 两轴滚动）

## 背景（用户实测三连 + 一条追加令）
用户跑完一条真回合（模型用 shell 建了 9 个文件）后提了三件事：

1. 「运行结束后，我查看过程，流程没有显示那个文件 +-N 数字」——实时编辑行按 Round J 设计在
   收尾时**清场**（「收尾先发空 live 清场、汇总卡接管」），而汇总卡只在回合底部；用户期望
   **运行结束后过程里仍能看到**「编辑 <文件> +N -M」。
2. 「然后我重启应用，那个下面已修改的文件那个板块不见了」——追踪报告只活在主进程内存
   （广播即弃）；重启后「已更改 N 个文件」卡与一切派生展示全部消失。
3. 「没有 qoder 这种 diff 的预览好看，他这种预览后，我鼠标放上去，还可以左右滚动和上下滚动，
   我们现在的 diff 预览好丑」——悬停预览的捕获级 scroll 监听**一律关窗**（想滚先关窗），
   且正文是裸 `ToolCodeBlock` 文本块（无行号槽、无增删行底）。
4. 追加令：「已修改那个文件，最多一次展示 2 行吧，然后多了的，自动放进收纳里面
   （**这个是汇总消息下面的**）」——汇总卡列表默认 6 行改 2 行。

## 结论 / 做了什么

### ① 收尾不清场：编辑行冻结 + 锚点持久化
- `electron/turn-file-watch.ts`：收尾删掉「先发空 live 清场」那条广播；最终报告**无条件广播**
  （渲染层收到 final 才清 live —— 空报告跳过会让残留 live 数据把编辑行卡在屏幕上不走）。
- `src/features/session-queue/SessionQueue.tsx`：锚点表（file → itemId|null）收尾**不再 clear**；
  数据源改为 **final 优先、live 回落**（`finalEditFiles.length ? finalEditFiles : (running ? live : [])`，
  收尾瞬间不闪空）；收尾时把锚点写 localStorage（`turn-edit-anchors:<turnId>`，空表不写）、
  挂载时读回；锚点对不上任何一项的兜到「收尾区 tail」（插在**最终答复之前**，⛔ 不放整个回合之后）；
  完成态两条渲染分支（plan 折叠 / 分段）都接上 `renderAfter`（`NestedProcessRuns` 增透传）。
- ⛔ 重构保 key：plan 分支的 Fragment key 与原形态逐字一致（fold = `fold-completed-…`、
  正文/单元 = item id）——换前缀会让运行→完成切换时整块重挂、重放揭示动画（用户最烦的同型问题）。

### ② 落盘持久化 + resume 重播
- `<userData>/turn-file-changes/<threadId>.json`（`{ v:1, turns: { [turnId]: { at, files } } }`）；
  上限：每线程 40 回合 / 单文件 1.5MB（从最老回合起丢）；目录由 `bootApp` 内
  `setTurnFileWatchStore(path.join(app.getPath("userData"), …))` 注入
  （⛔ 不在模块顶层求值 `app.getPath` —— import 早于 `setPath`，路径静默漂移）。
- `electron/features/codex-ipc.ts`：`thread/resume` 时把存量报告**按原事件形态**
  （`{ type:"turn-file-changes", turnId, files }`）逐条 `broadcastHarnessEvent` 重播 ——
  渲染层收件零改动，重启/切回会话后卡片与冻结行复活。

### ③ diff 预览升级（Qoder 风）
- 新增纯函数 `src/lib/diff-view.mjs`（`parseDiffLines`）：从 `@@ -a,b +c,d @@` 解析旧/新行号；
  `---`/`+++` 只在**进 hunk 之前**算文件头（进 hunk 后 `---x` 是内容行 —— 按头处理会吞行）；
  兼容引擎统一 diff（meta/hunk/ctx）与宿主伪 diff（无上下文行）。
- 新增 `src/features/status/DiffPreview.tsx`（`DiffPreviewBody`）：双行号槽 + 增删符号 + 彩色行底
  （`color-mix` 主题变量）；面板 `overflow:auto` 两轴滚动（行 `white-space:pre` 不折行 ⇒ 长行出横向滚动条）。
- `Status.tsx`：scroll 关闭豁免**面板内部的滚动**（`panel.contains(event.target)`）；头部加
  「打开完整 diff」展开钮（`Maximize2`，对照 Qoder 预览头）。

### ④ 汇总卡 2 行收纳
- `COLLAPSE_LIMIT = 6 → 2`（收纳 = 原「再显示 N 个文件」折叠钮，形态不动）。

## 影响面 / 判据
- 守卫 11p **47 条**（32→47）、11q **33 条**（28→33）；【118】锚点随重构更新（`fold-completed-…`
  正则改为 ternary 形态，距离实测 848 < 1600）；【265】棘轮 accept.mjs 1122→1189（实测；含 ⑯ 悬停重试与等滚动静默的测试基建修正）。
- 验收 `file-summary`：+⑤b（收尾后冻结行仍在）/ +⑤c（读盘对账 `<threadId>.json`）/
  +⑯b（行号槽 + 两轴滚动 + **面板内滚动不关窗** + 展开钮）；⑧⑨⑭ 改 2 行口径。
- 用户可感知：运行结束后过程里仍有「编辑 <文件> +N -M」（就地锚定、可点开展开过程查看）；
  重启应用后「已更改 N 个文件」卡与编辑行仍在；diff 预览可左右/上下滚动、不再一滚就关。

## 回滚
单批提交；回滚 = `git revert` 本提交（无数据迁移：localStorage 键与 `<userData>` 落盘文件
为新增物，旧版忽略它们即可）。
