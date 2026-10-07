---
id: 2026-10-07-change-压缩链重建宿主侦测rollout-增量扫描-turn-id-归因-压缩线第三来源-锚点改边界回合
date: 2026-10-07
kind: change
area: context
title: 压缩链重建：宿主侦测（rollout 增量扫描 + turn_id 归因）+ 压缩线第三来源 + 锚点改边界回合
tags: [compaction, rollout, divider, engine]
commits: []
files: [electron/compaction-watch.ts, electron/rollout-worker.cjs, electron/features/boot.ts, src/features/app-view/AppView/02-main-stage/01-timeline.tsx, src/lib/compaction-records.mjs]
importance: normal
---

# 压缩链重建：宿主侦测（rollout 增量扫描 + turn_id 归因）+ 压缩线第三来源 + 锚点改边界回合

# 结论

当前引擎（0.153 / 0.157 系）对压缩**不发任何 item 事件**，且**自动压缩是内联完成的** —— 没有独立的压缩回合，ContextCompaction 记录直接记在**用户回合**名下（rollout 实证：`payload.turn_id` == 用户 `turn/start` 回执的 id；手动 `thread/compact/start` 才是独立空回合）。压缩线链路因此重建为**宿主侦测**：增量扫 rollout + 记录按 turn_id 归因 → 落盘 → 广播 → resume 重播 → 渲染层第三来源。

# 依据（实测）

- 隔离实例裸事件捕获：整个压缩过程只有 `thread/status/changed` + 一条 `turn/started` + `turn/completed`；无 `item/started|completed`、无 `thread/compacted`。`thread/turns/list` 里压缩回合 items 为空；item 只落 rollout（`item_completed` + `item.type:"ContextCompaction"` + `turn_id`）。
- 大会话 01a11136（326,200 tokens / 1M 窗口）ratio=0.25 → config.toml 阈值 262,144 → 发一条消息（59s 完成）：期间 rollout 出现 ContextCompaction（turn_id == 该用户回合 id）；`.compact-divider`「上下文已自动压缩」在运行中出现、锚在用户消息上方、回合继续跑完；重启重开会话线仍在（resume 重播）。
- 首版判据「非渲染层回合才查」被上述实测**证伪**：自动压缩内联在用户回合里 ⇒ 真实压缩全被过滤掉（store 恒空、线永不出现）。更正为「按记录自己的 turn_id 归因（== 刚完成回合 id）」，普通回合最多在扫描段里看到**旧**记录（turn_id ≠ 本回合）⇒ 不误判。

# 影响面

- 主进程：新 `electron/compaction-watch.ts` + rollout-worker op `check-compaction`（**逐线程读取偏移 + 8KB 重叠增量扫** —— 压缩记录写在回合开头，之后同回合还能写几百 KB 工具输出，只读"尾部 N 字节"会被挤出窗口漏判）+ boot 的 turn/completed 钩子 + codex-ipc 的 resume 重播与删除清落盘。
- 渲染层：`src/lib/compaction-records.mjs`（内存镜像 + `useSyncExternalStore` 订阅，记录到达即重渲染）+ timeline 三源互斥（引擎 item → 宿主记录 → toast 兜底）+ **锚点改**「压缩记录**自己所在回合**（含）之前最近一条用户消息正上方」—— 新消息到来线不动、随历史往上走（旧口径"永远黏最新一条用户消息"是用户实测点出的毛病）。
- 压缩比例下限 0.5 → 0.1（档位 0.1~0.95；⛔ 不许退回 0 值区 —— 阈值变 0 会每轮都压）。
- 判据：守卫【165】16 条（含 worker 增量扫描归因 / 负向禁旧判据 / 订阅接线）；验收新项 `compact-line`（6 条：新会话两短回合 + 手动 compact 真链路 → 线出现 / 锚点 / 落盘；单跑实测 11s 出线、整项 47s）。

# 回滚

删 `electron/compaction-watch.ts` 并还原 boot / codex-ipc / timeline / rollout-worker 的挂点 + 回退渲染层订阅。注意：回退到 09-26 的"引擎 item + toast"两源在当前引擎下恒不命中 —— 等于压缩线功能整体消失。
