---
id: 2026-10-07-incident-回合文件追踪遍历预算截断污染漏报真文件-误报已删除-mac-断点诊断落盘
date: 2026-10-07
kind: incident
area: files
title: 回合文件追踪：遍历预算截断污染（漏报真文件 + 误报已删除）+ mac 断点诊断落盘
tags: [file-watch, budget, mac, diag]
commits: []
files: [electron/turn-file-watch.ts, electron/turn-files-debug.ts, electron/features/boot.ts, electron/features/codex-ipc.ts, scripts/accept.mjs]
importance: normal
---

# 回合文件追踪：遍历预算截断污染（漏报真文件 + 误报已删除）+ mac 断点诊断落盘

# 结论

两条：

① **回合文件追踪的遍历预算有两个方向的不可信**（清档后的验收在 Windows 上复现）：
   - **漏报**：全局 4000 文件预算被巨型子树（`release/win-unpacked`，约 5 万文件）整段吃光 ⇒ 排在它后面的目录（含探针真正在写的 `accept-card-probe`）进不了快照，真写的 7 个文件只检出 3 个；
   - **误报「已删除」**：前后两次遍历的截断点随「本轮新增文件数」漂移（本轮 +8 个文件 ⇒ 边界前移 8 位）⇒ 深处图标集（`resources/expert-skills/ppt-master/templates/icons/...`）的边界文件被报成 `deleted +0 -22`，还因排序排进汇总卡前列。
② **mac「消息汇总下的已编辑文件不展示」链路全平台同构、无平台分支** ⇒ 断点藏在若干**静默跳过点**里，而打包版 mac 应用 stdout 不可见（Finder 启动丢 stdout）⇒ 需要**落盘诊断**才能在 mac 上定位。

# 依据

- 本机复现（清空 `.e2e-profile` 后跑 `node scripts/accept.mjs --only file-summary`）：广播里只有 `notes.md/data.json/seed.txt`，而 store 落盘文件中出现两条 `release\win-unpacked\...\alist.svg deleted`；诊断日志（新加的 `turn-files-diag.log`）记到 `emit files:5 changed:5`。
- 修复后同命令 31/31 全绿；诊断日志末行 `emit files:8 changed:8 truncated:true`（截断标记生效、删除抑制生效）。
- mac 链路的静默跳过点（boot turn/started 三处 + 快照侧：cwd 不在磁盘 / 根目录读取失败 / 快照为空 / 收尾无快照）此前**全部无输出**；观察到的唯一真实故障候选：mac TCC 目录权限会让 `readdirSync(根)` 抛 EPERM/EACCES，被 catch 静默吞掉（症状与「工作区本来就没文件」完全一样）。

# 影响面

- `electron/turn-file-watch.ts`：IGNORE 补 `release`/`win-unpacked`/`linux-unpacked`/`mac-*`/`dist-electron`/`DerivedData`/`Pods`/`target`；新增单目录上限 `MAX_PER_DIR=600`（walk 与 walkLight 同口径，防巨型子树吃光全局预算）；walk 返回 `truncated` 标记，**截断时抑制「已删除」判定**（walk 收尾 + walkLight 实时两处）。
- 新 `electron/turn-files-debug.ts`（诊断落盘 `<userData>/turn-files-diag.log`，JSON 行、512KB 上限、失败静默）+ `setTurnFileWatchDiag` 注入 + boot 三个落盘点 + 收尾心跳（含 `truncated`）。
- `electron/features/codex-ipc.ts`：`thread/start` 的 cwd 登记改**引擎回执优先**（`r.thread.cwd ?? p?.cwd`）——请求参数的空串此前会赢 ⇒ 该线程文件追踪全程失明（resume 行本来就是结果优先，两行口径统一）。
- 验收 `file-summary`：前置① 重写为「目标会话 cwd 必须 == 注入工作区根（找不到就新建）」——清档重播种后旧写法会点开别目录的老会话、diff 恒 0 全链假红（本条与 mac 无关，是清档后必然踩到的测试环境问题）；轮询窗口 12s→24s、回合 `sleep 12→24`（新会话 + 大树工作区把中段轮询拖慢，12s 窗口里第二批常落在收尾之后）。
- 守卫 11p 扩到 57 条：诊断落盘模块/注入点/六个诊断点、cwd 结果优先（+负向）、单目录上限两处同口径、截断抑制两处、心跳带 truncated —— 变异测试（去抑制 → 红）通过。

# mac 待办（未闭环）

用户装下一次 mac 构建后复现一次（发一条让模型改文件的回合），把 `~/Library/Application Support/Codex Harness Desktop/turn-files-diag.log` 发回：日志有 `emit` 心跳 → 主进程链正常、问题在渲染/通道；`files:0` + `snapshot-empty`/`walk-root-error EACCES` → 权限或工作区外写入；无任何行 → 快照从未装填（看 `started-no-cwd`/`snapshot-skip`）。

# 回滚

`turn-file-watch.ts` 还原 IGNORE/预算/抑制三处 + 删诊断模块与注入（不推荐：漏报/误报会回来）；验收与守卫的改动可单独保留。
