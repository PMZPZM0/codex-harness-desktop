---
id: 2026-10-06-incident-文件汇报卡三处静默缺陷死信道-线程id当回合id-dfs-烧光文件预算
date: 2026-10-06
kind: incident
area: messages
title: 文件汇报卡三处静默缺陷：死信道 / 线程id当回合id / DFS 烧光文件预算
tags: [turn-file-watch, accept, file-summary, harness-event]
commits: [839f45c]
files: [electron/turn-file-watch.ts, electron/features/boot.ts, src/lib/turn-file-changes.mjs, scripts/accept.mjs, scripts/guards/11p-file-summary.mjs, scripts/guards/09-structural.mjs]
importance: normal
---

# 文件汇报卡三处静默缺陷：死信道 / 线程id当回合id / DFS 烧光文件预算

## 背景
用户按我给的提示词真机实测：模型走 shell 写文件后，回合底部**没有出现**「已更改 N 个文件」卡（10-06 轮刚做完这张卡，验收全绿）。排查发现三处静默缺陷叠加，且此前的验收用 **`window.dispatchEvent(MessageEvent)` 注入假事件**驱动卡片 —— 只证明「卡会画」，整条真实链路（投递通道 / id 对号 / 快照范围）全在盲区里。

## 结论
三处各自独立、都表现为"卡空白"，一并修复：
1. **死信道**：渲染层 `src/lib/turn-file-changes.mjs` 监听 `window` 的 `message` 事件（要求 `data.channel === "harness:event"`），但**全仓没有任何发送方**。真通道是 `window.codex.onHarnessEvent`（preload 把 ipc `harness:event` 以裸 payload 递进来；09-15 同类坑的注释就在 part05）。⇒ 改走 onHarnessEvent，删掉死监听。
2. **id 对号错**：主进程追踪器把**线程 id**当广播 `turnId` 发（boot.ts 快照/结算都按线程键），而卡片按**回合 id**（`turn.id` / DOM `#turn-<uuid>`）取报告 ⇒ 永远对不上。
3. **DFS 烧光预算**：`walk()` 深度优先 + `MAX_FILES=4000` ⇒ 大工作区（家目录）里 AppData 先被整段走完、**根级新文件永远进不了快照** ⇒ diff 恒 0。

## 依据
- 真机复现（e2e harness 拉真应用 + 真引擎回合，模型写 probe-card.txt/seed.txt）：修复前 `[fsw-diag]` 显示快照/结算两 id 都对、`files:0`；修复后同场景 `files:4`、真通道收到广播、卡片出现（截图 `.e2e-artifacts/shots/01-fsw-repro-v3.png`）。
- 死信道：`grep -rn 'addEventListener("message"' src` 只有 4 处监听、0 处发送；`preload.ts` 的 `onHarnessEvent` = `ipcRenderer.on("harness:event")`。
- DFS 顺序：`scripts/probe-walk` 实测 `C:\Users\Administrator` 下 4000 预算在 AppData 内耗尽（`hitProbe:false`），文件优先两趟后 `hitProbe:true`。

## 影响面
- 所有走 shell/exec/MCP（引擎不感知）写文件的回合：汇报卡从"几乎永远空白"变为真出（引擎 apply_patch 路径的 fileChange 不受影响）。
- `turn-file-watch` 模块签名变 `snapshotTurnWorkspace(threadId, turnId, cwd)`；broadcast `turnId` 语义改为回合 id（无其他消费者）。
- 验收 `file-summary` 重写为**零注入真回合全链路**（真起回合→测试进程落盘 8 文件→追踪器 diff→真广播达且 turnId==真回合 id→卡+交互 12 条）；每个默认验收轮会跑一个真引擎小回合（需 e2e profile 已配模型）。

## 回滚
`git revert` 本轮提交即可（三处 + 守卫/验收一并回退）；回退后卡片回到"仅引擎补丁工具可出"的旧行为。e2e profile 的模型配置（我补种的 custom-model.json / custom-models.json）不在 git 里，无需回滚。
