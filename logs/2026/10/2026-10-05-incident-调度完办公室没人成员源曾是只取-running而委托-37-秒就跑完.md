---
id: 2026-10-05-incident-调度完办公室没人成员源曾是只取-running而委托-37-秒就跑完
date: 2026-10-05
kind: incident
area: office
title: 调度完办公室没人：成员源曾是「只取 running」，而委托 3.7 秒就跑完
tags: [office, dispatch, renderer]
commits: [8330527, 7525939]
files: [src/features/team-office/TeamOfficePreview.tsx, src/features/app-view/AppView.tsx]
importance: high
---

# 调度完办公室没人：成员源曾是「只取 running」，而委托 3.7 秒就跑完

# 调度完办公室没人：成员源曾是「只取 running」，而委托 3.7 秒就跑完

## 背景
用户 10-05 报「我调度了一个专家，办公室预览里面没有更新成员」：截图 A 是空办公室 +
「还没有调度任何子会话 —— 派一个子智能体或专家出去，这里就会多一个人。」，
截图 B 是同一时刻那个会话里 **已成功** 的调度回执（`agent_invoke (kind=expert)` → 专家「知微」已接单）。
办公室与调度头像轨对"谁在办公室里"给出**互相矛盾**的说法。

## 结论
不是调度坏了，是**办公室的成员过滤条件写错了**：

1. 办公室成员取的是**头像轨的 live 表**（`bag.delegatedRailRuns`），而那张表的语义是
   「正在跑的 + 刚跑完停留 20 秒的」；
2. 它又在渲染层**再按 `status === "running"` 过滤一次** ⇒ 跑完的成员立刻从办公室消失。

而委托跑得**极快**：真实记录（`D:\11\delegate-threads.json`）里那次是
`startedAt 1791163100538 → endedAt 1791163104219` = **3.7 秒**（会话里显示的「耗时 18 秒」是整个回合，
含模型延迟）。用户点开办公室时它早已 `done` ⇒ 办公室永远是空的。

## 依据
- 主进程委托登记表里那条记录**存在且 status = "done"**（originThreadId = 用户那个会话的 id，
  与 `D:\11\codex-home/sessions/2026/10/05/rollout-…-01a109a2…jsonl` 对得上）⇒ 数据没丢，是被过滤掉了。
- 办公室代码当时是 `(delegatedRuns ?? []).filter((r) => r.status === "running").slice(0, 6)`，
  而 `delegatedRuns` 就是 `app.delegatedRailRuns`（`Object.values(bag.delegateLiveRuns)` 按
  `originThreadId === bag.thread?.id` 过滤，`finish` 后靠 20 秒计时器才摘掉）。
- 组件级渲染探针（headless Edge 驱动真 `TeamOfficePreview`，输入 = 那条真实记录的副本）：
  修复前等效输入 ⇒ `window.__officeSim.agents` = **[]** + 空态文案（与用户截图逐字一致）；
  修复后同一份输入 ⇒ agents = `[{name:"知微", mode:"idle", seatIndex:0}]`。

## 影响面
- 修法（`8330527`）：办公室成员改取**委托登记表**（`app.delegateRecords` 按 originThreadId 过滤、
  排除已归档、按 startedAt 升序），`running` 只当**标志位**；跑完的坐工位待机、**归档后才离场**；
  取最近 6 个（工位上限）。`eventStateOf` 对非 running 返回 null ⇒ 只坐工位、不再派去书架/饮水机。
- 与头像轨的口径**刻意分家**：头像轨 = "正在跑"（跑完 20 秒摘），办公室 = "我的班底"（归档才走）。
  两个面从此不再互相矛盾。
- 同日的 `7525939` 把入口从"左下角浮动胶囊"改成"消息区右侧轨道末位节点"（与专家团同一形态），
  本条目只讲成员源；入口形态记在 `DESIGN.md`。
- ⛔ 未处理的相邻缺口（已核实、等用户拍板）：① 删除被委派会话后登记表**不清理** ⇒ 办公室会留下
  一个点不开的人（侧栏「调度会话」用 `listThreads ∩ delegateRecords` 天然规避）；②
  `DelegateRegistry.prune()`（7 天保留期）**从未被调用** ⇒ `delegate-threads.json` 只增不减。

## 回滚
把 `AppView` 的 `delegatedRuns` 换回 `app.delegatedRailRuns`，并在 `TeamOfficePreview` 的非 team 分支
加回 `.filter((r) => r.status === "running")`（守卫 11d 的两条新断言会红）。
