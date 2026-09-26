---
id: 2026-09-26-incident-思考板块流式会取消钉顶交棒判据改为只看正文bodybottomof
date: 2026-09-26
kind: incident
area: pin
title: 思考板块流式会取消钉顶：交棒判据改为只看正文（bodyBottomOf）
tags: [pin, reasoning, scroll, stability]
commits: []
files: []
importance: high
---

# 思考板块流式会取消钉顶：交棒判据改为只看正文（bodyBottomOf）

## 背景

用户 09-26：「思考板块在输出，会把钉顶取消了……只有正文满一屏才能取消钉顶，要不然钉顶不稳定，思考板块撑满了一屏，钉顶没了，让正文输出又钉上去了。」

## 结论

钉顶期的「交棒/跟随」判据从**全量内容底**改为**正文底**（新增 `bodyBottomOf`）：

- `bodyBottomOf(el) = contentBottomOf(el) − Σ(展开中的思考卡折叠体高度)`，选择器
  `.reasoning-card .wb-fold-content`（折叠态 offsetHeight=0，grid 0fr 自动排除，无需按状态过滤）。
- 消费方两处，**必须同源**：
  1. `pinSentMessage` 的交棒判据（`overflow > 4` → 锁 gap、停止纠偏）；
  2. `update()` 钉顶分支的跟随门槛与 pin-shrink-follow 门（`dist` → `bodyDist`）。
- 效果：思考卡把内容撑满一屏**不再取消钉顶**（思考卡有自己的内部滚动，`reasoningFollowRef`
  逐帧把卡内滚动条推到底，不需要视口让位）；正文满一屏才交棒给跟随。
- 配套：`update()` 落穿路径的 `setAwayFromBottom` 加 `!anchorTopRef.current` 短路 ——
  旧代码 `dist > -48` 提前 return 走不到它；改判据后思考流式期间会落穿进来，全量 dist
  会把「回到底部」按钮顶出来，而按钮 onClick 调 `releaseToUser` = **思考从侧门取消钉顶**。

## 依据

- 振荡机制（代码级推演，与用户描述逐字对上）：思考流式 → 全量 dist > 0 → 跟随把视口推到底
  （钉顶没了）→ 思考完成自动折叠（useCardOpen 跟随 running）→ 内容缩回一屏内 → dist ≤ 0
  → pinSentMessage 不再交棒、gapErr > 8 → pin-fix 把消息拉回 54px（又钉上去）→ 循环。
- 变异测试 4/4 全红：交棒退回全量（2 条红）、跟随分支退回全量（红）、shrink 门退回全量（红）、
  删 `!anchorTopRef` 短路（红）。
- 验收 `settings-pages` 通过（43s）；预检 0 条新增真红；bag 守卫 0 missing/extra/mismatch。
- ⚠️ 又踩 `emptyOutDir:false` 累积：中途两次 build 没清 dist ⇒ 【151】红（131→230），清掉重建即绿。

## 影响面

仅钉顶期（anchorTopRef=true）的滚动判据；非钉顶贴底跟随、完成后脱钉、用户滚轮解除全部不动。
已知取舍：思考超长时最新思考内容在卡外不可见（卡内自滚可见尾部），正文出来后照常折叠。

## 回滚

三处 `bodyBottomOf/bodyDist` 换回 `contentBottomOf/dist`，删 helper 与 `setAwayFromBottom` 短路，
守卫【51】⑧ 删除、【126】①④ 正则换回。commit：本轮单提交。
