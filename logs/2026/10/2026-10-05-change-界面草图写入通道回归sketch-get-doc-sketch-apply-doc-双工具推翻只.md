---
id: 2026-10-05-change-界面草图写入通道回归sketch-get-doc-sketch-apply-doc-双工具推翻只
date: 2026-10-05
kind: change
area: ui-sketch
title: 界面草图写入通道回归：sketch_get_doc / sketch_apply_doc 双工具（推翻「只读」结论）
tags: [板块, 草图, agent工具]
commits: []
files: [scripts/sketch-bridge.js, src/features/ui-sketch, src/features/app-state/parts/part05/event-router/02-request.tsx, src/features/app-state/parts/part08/01-seg.tsx, scripts/guards/11h-ui-sketch.mjs, scripts/accept.mjs, public/sketch/index.html]
importance: normal
supersedes: 2026-10-05-change-撤掉草图里的组件库面板与写通道草图改为只读
---

# 界面草图写入通道回归：sketch_get_doc / sketch_apply_doc 双工具（推翻「只读」结论）

# 界面草图写入通道回归：sketch_get_doc / sketch_apply_doc 双工具

> ⚠️ 只推翻前一条结论里的**「桥改成只读 / 删掉写通道」那一点**；
> 「组件库面板整块删除」的部分**仍然有效、不回滚**（守卫留了负向断言防复活），
> 「嵌第三方静态产物 + `sketch://` 协议 + 独立板块」骨架照旧。
> 与上一轮相比，写通道的做法**换了实现**：不再是宿主直推的 `load-doc`，而是走上游自己的分享哈希导入。

## 背景
用户 10-05 下午原话：「界面草图，Codex 可以直接调用嘛，看看有没有对应工具，Codex 可以直接调用这个工具，
继续拼装 UI 界面」—— 他要的是让引擎侧（模型）直接**读画布、写画布**，把草图当成可编程的 UI 工作台继续拼。

## 结论
1. **两个 dynamicTool**（注册在 part08 `buildDynamicTools` 裸数组元素，分发给 part05 事件路由）：
   - `sketch_get_doc`：读回整份文档 JSON + 摘要（`N 屏 / M 部件`）；空画布是**合法结果**（success:true + 指引），不是错误。
   - `sketch_apply_doc`：写侧 = 在文档基础上改（追加屏 / 加部件 / 调坐标），先过 `validateSketchDoc` 前置校验
     （口径逐字抄自上游 bundle：kind 36 枚举 / variant 5 枚举 / 必需字段），失败回中文原因且**不打开窗口**
     —— 模型改一版就能过，比盲写后被上游静默拒收（哈希改了画布没动）可解释得多。
   - 窗口没开自动打开，等"attach + ready"两件事都成立（会话单例判据）；老会话要切走再切回（dynamicTools 只在 thread/start / resume 生效）。
2. **写回只走上游自己的导入通道**：桥把文档编码成上游分享哈希（`#docz=` = deflate-raw + base64url 无 padding；
   无 CompressionStream 回落 `#doc=` + encodeURIComponent）→ `location.hash = …` → 上游 `hashchange → readShareHash → arrive()`
   落盘（它自己校验/归一化，**可 Ctrl+Z 撤销**）。⛔ 桥从不 `setItem`/`removeItem` —— 直接改存储会绕过上游的校验与撤销栈。
3. **渲染层会话单例 `sketch-session.mjs`** 是唯一状态持有者（attach / ready / 在飞请求 + 串行队列 + 关窗拒绝 + StrictMode 语义）；
   弹窗（`UiSketchModal.tsx`）只是 iframe 持有者：挂载时 attach、卸载时 detach、每条消息先 feed。
   ⛔ 等的是"attach + ready"两件事，不是单看 bag 开关：开关 true 而 iframe 还没挂上时发请求 = 消息发进空气。
4. 序列化口径与上游导出分享**逐字对齐**（frames 去 `noteHistory`；item 去 `noteHistory`、`src` 只在 http(s) 时保留）。

## 依据
- 用户原话（本轮）：见背景。
- 「该走上游导入通道」是上一轮就查明的技术事实（上游 `lib/share` 的 `#doc=` / `#docz=` → `arrive()` 是它校验/归一化文档的唯一正门，
  且替换的设计留在 `draftBefore` 可撤销）—— 上一轮的结论是"那就不写"，本轮用户要写，正解就是**用它这条正门**，而不是恢复我们自己直推的旁路。
- 判据同步：守卫【283】64 → **131 条**（新增第八节工具面接线 22 条 / 第九节会话单例真跑 12 条 / 第十节桥 VM 真跑三用例 16 条）；
  验收项 `ui-sketch` 8 → 11 条：新增 ⑨ 真实上游接受我们的 `#docz=` 分享哈希（`load-doc-result ok:true`）+
  ⑩ 宿主摘要变「1 屏 / 2 部件」+ ⑪ 原文档写回后摘要原样还原 —— 这三条只有**真产物**能证明（VM 里的"上游"是模拟的）。
- 变异验证：19 个变异（15 + 5 重跑）全部被守卫捕获。两个坑：① part08 是 CRLF 行尾，bash 里的 LF old-string 替换会 NO-OP，
  变异脚本要同时尝试两种行尾；② 只改 `scripts/sketch-bridge.js` 不改 `public/sketch/index.html` 内联副本时，
  报红的是"桥正文已内联"断言而不是目标 VM 断言 ⇒ 变异脚本要先跑 `--bridge-only` 重建再改。

## 影响面
- `scripts/sketch-bridge.js`：加回写通道（`load-doc` 消息 + 分享哈希编码 + 轮询确认"导入后画布变了没"）；
  `public/sketch/index.html` 内联桥正文随重建更新（`--bridge-only`）。
- `src/features/ui-sketch/sketch-session.mjs`（新增）+ `sketch-doc.mjs`（`validateSketchDoc` 一族）+
  `sketch-doc.d.mts` / `sketch-session.d.mts` / `index.ts` barrel。
- `part08/01-seg.tsx`（工具注册）、`part05/event-router/02-request.tsx`（分发分支 + barrel 对账）。
- `scripts/guards/11h-ui-sketch.mjs`、`scripts/accept.mjs`、`AGENTS.md`（工具表 + 草图小节 + 索引）。
- ⛔ 组件库面板**不回来**；弹窗里不许出现并排面板（iframe 恒占满主体）。

## 回滚
`git revert` 本轮提交整体退回（回到"只读 + 组件库面板已删"的状态；负向断言一并还原，需同步删 ⑨⑩⑪ 验收项）。
⛔ 不要用它回滚组件库面板那部分 —— 那部分不受本轮影响。
