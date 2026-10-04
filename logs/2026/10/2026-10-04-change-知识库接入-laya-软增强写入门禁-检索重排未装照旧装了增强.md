---
id: 2026-10-04-change-知识库接入-laya-软增强写入门禁-检索重排未装照旧装了增强
date: 2026-10-04
kind: change
area: knowledge-base
title: 知识库接入 Laya 软增强：写入门禁 + 检索重排（未装照旧、装了增强）
tags: [knowledge-base, laya, soft-enhancement, fail-open]
commits: []
files: [electron/features/laya-service.ts, electron/features/dispatch-rpc.ts, electron/features/dispatch-core.ts, scripts/guards/11-knowledge-base.mjs, docs/KNOWLEDGE-BASE.md]
importance: normal
---

# 知识库接入 Laya 软增强：写入门禁 + 检索重排（未装照旧、装了增强）

## 背景

用户 10-04 拍板：「未安装照旧，安装后进行增强——判断需不需要写入知识库；Codex 查知识库时让 Laya
快速反馈有没有类似知识、对应编号」。同时问「后期知识库数量多了，向量索引跟 Laya 谁更快」。

先行结论（回答用户）：**Laya 替代不了向量索引，也加速不了建索引**——瓶颈是算向量不是判断，
Laya 是分类器吐不出向量；它适合的是「写入前判断值不值得存」和「召回后挑最相关」两个判断位，
提的是精度与索引不膨胀，不是索引速度。

## 结论

- `laya-service.ts` 新增通用单问判断 `layaJudge(text, {instructions, criteria}, {minConfidence, timeoutMs})`：
  服务**已就绪才判**，未就绪只后台预热并弃权（⛔ 不为一次判断拉起 ~700MB 权重的服务，
  思考档同款纪律）；超时（默认 2s）/低置信（默认 0.5）/答案不在 criteria ⇒ 一律 null（fail-open）。
- **写入门禁**（模型工具 `knowledge_add`，dispatch-rpc.ts）：写入前判 worth/junk（minConfidence 0.6），
  判 junk ⇒ `ok:false` 拒写并说明原因与出路（充实内容重试 / 用户手动加）。⛔ UI 手动路径
  （kb:add-text / kb:add-files）**不接门禁**——用户手动导入是明确意图。
- **检索重排**（模型工具 `knowledge_search`，dispatch-rpc.ts）：全文 `searchDocs` 结果 ≥2 条时
  一次 choice 调用（候选编号 1..N + none）挑最相关置顶，输出标注 `⭐ Laya 推荐（置信 x%）`。
  ⛔ UI 的 `kb:search` 不掺（用户手动检索要确定性排序）。
- `dispatch-core.ts` 的 knowledge_add 工具描述同步门禁行为（模型必须知道会被拒写）；
  `gen-capability-skill.mjs` 的 kb 域说明同步；`npm run gen:ipc` 已重跑（harness-api 技能更新）。

## 依据

- laya 现状：`laya-service.ts`（10-01 立项，4 通道 laya:*，唯一消费方 = 思考等级自动切换）；
  延迟纪律来自 10-01 实测教训（「自动档要立刻透出来」）与 multilingual checkpoint 系统性压缩经验。
- kb 现状：模型侧 `knowledge_search` 走**全文** `searchDocs`（无语义分）⇒ Laya 挑最相关有真实增量；
  UI 侧 `kb:search` 用 `searchDocsSmart`（含语义档），不动。
- 守卫【kb】判据 8（7 条，`scripts/guards/11-knowledge-base.mjs`，EXPECTED_CHECKS 3173 → 3180），
  **变异测试 7/7 命中**。第一版 3 条假绿被变异抓出并改形：
  ① 就绪门槛断言锚 `exports.layaJudge` 会命中 layaDecideEffort 的同款判断（exports 块在所有函数体前）
  ⇒ 改锚 `async function layaJudge` 函数体；
  ② `/junk/` 会匹配 `"junkX"` ⇒ 改 `"junk"` 带引号；
  ③ `layaJudge…catch` 会被分支后段补向量的第二个 try/catch 顶替 ⇒ 改顺序断言
  `layaJudge → catch → addDocument`（门禁 catch 在 addDocument 之前）。

## 影响面

- 模型侧行为：装了 Laya 且服务就绪时，写低价值知识会被拒（可重试）、检索结果首条可能是
  Laya 置顶（带置信标注）；未装/未就绪 = 与改前完全一致（fail-open 双保险：layaJudge 内部
  就绪检查 + 调用方 try/catch）。
- 无新 IPC 通道、无 manifest/preload 变化；`npm run check` EXIT=0（0 红，【kb】25/25）。

## 回滚

`git revert <本次提交>`。无数据迁移、无配置残留；layaJudge 本身可独立保留（纯新增导出）。
