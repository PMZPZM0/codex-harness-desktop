---
id: 2026-09-26-incident-压缩线永远在下面-压缩像假的item-类型大小写不匹配让整条链静默失配前三轮误判在位置
date: 2026-09-26
kind: incident
area: compaction
title: 压缩线永远在下面 + 压缩像假的：item 类型大小写不匹配让整条链静默失配（前三轮误判在位置）
tags: [compaction, event-type, case-mismatch, engine-window]
commits: []
files: [src/lib/compaction-item.mjs, src/features/app-state/parts/part04/01-seg.tsx, src/features/app-state/parts/part05/01-seg.tsx]
importance: high
---

# 压缩线永远在下面 + 压缩像假的：item 类型大小写不匹配让整条链静默失配（前三轮误判在位置）

## 现象（用户三次反馈，逐次加深）

1. 「压缩完成线要在新消息上面，怎么一直在下面」
2. 「旧的消息上面，新的压缩线又在新消息下面」
3. 「压缩纯假的，压缩完 2%，发个消息又 7%」

## 取证（用户会话 rollout，只读）

**① 压缩线一直在下面的真根因**：引擎落盘/事件的压缩 item 类型是 **PascalCase `ContextCompaction`**
（rollout `event_msg.item_completed.item.type` 实证），而宿主与渲染层各处硬写 camelCase
`contextCompaction` 判定 ⇒ **整条压缩链静默不命中**：item 不进 thread（渲染层无 item 可归位，
只剩时间线尾部的 compactToast 兜底在渲染 = 用户看到的「永远在下面」）、prune 不清理旧线、
压缩期运行态不结算。我前两轮都在改位置（TurnView 顶部 → timeline 层插在最后用户消息上方），
**位置逻辑没错，错在数据判定从未命中**。

**② 「压缩是假的」的实况**：引擎确实写了压缩（`compacted` 记录带 message 摘要 +
`replacement_history` 8 条 / 50,253 字符 + window_number/first_window_id/previous_window_id 窗口链），
压缩时刻上报窗口 21,900（用户看到的 2%）。但**紧接着的下一次请求实际 input=70,464**
（用户看到的 7%），14:19 那次同样（压缩后 11 秒 input=67,873）。⇒ 压缩窗口没有被后续请求采用。
宿主不构造发给上游的 prompt，这层改不了；供应商 wireApi=responses、窗口 1M，不是配置问题。
待验证方向：换官方供应商（pptoken/gpt-5.6-sol）跑同一压缩测试对比，判断是否中转网关不吃窗口历史。

## 修复

- 新增唯一口径模块 `src/lib/compaction-item.mjs`：`isCompactionItem()` 大小写不敏感；
  part04/part05/part06/ItemView/turn-view/timeline 六处判定全部改用它（禁再硬写字符串）。
- 新增 `bag.attachCompactionItem(item, turnId)`（part04）：压缩 item 的 turnId 指向宿主不知道的
  引擎内部回合时 mergeItem 会丢弃它 ⇒ 显式挂载兜底：id 已存在就地合并（状态推进），否则挂
  turnId 命中回合、再退最后一条已知回合。part05 的 item/started 与 item/completed 都调。
- 守卫【166】4 条：判定唯一口径（全库扫硬写）+ 两处挂载调用 + 兜底口径。

## 影响面

线位置逻辑（timeline 层归位，插在最后一条用户消息正上方）保持不变，现在终于能真正生效；
压缩链的 pending/prune/settle/活动文案静默全部恢复正常。判据：tsc 0 错、预检 0 真红。
