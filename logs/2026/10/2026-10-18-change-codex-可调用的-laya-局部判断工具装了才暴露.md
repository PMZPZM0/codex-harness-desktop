---
id: 2026-10-18-change-codex-可调用的-laya-局部判断工具装了才暴露
date: 2026-10-18
kind: change
area: laya
title: Codex 可调用的 Laya 局部判断工具（装了才暴露）
tags: [laya, tool, judge, conditional]
commits: [64dccf9]
files: [electron/laya-judge.ts, electron/features/laya-service.ts, src/features/app-state/parts/part08/01-seg.tsx, src/features/app-state/parts/part05/event-router/02-request.tsx, electron/developer-instructions.ts, scripts/guards/12s-laya-judge.mjs, scripts/accept.mjs]
importance: normal
---

# Codex 可调用的 Laya 局部判断工具（装了才暴露）

## 背景
用户 10-18：「给 codex 加一个调用 laya 判断的工具，看看那些场景下可以利用起来 laya 模型做判断，
如果安装了 laya 模型，就再暴露这个工具给 codex」。

Laya 是本仓已有的本地决策引擎（`electron/features/laya-service.ts`，pip `laya[serve]`）：
非自回归、单次前向 ~33ms、输出 choice/probabilities/answer_confidence、零文本生成。
此前只服务两条内部旁路（思考档自动切换 / 知识库写入与重复门禁），模型自己看不到也用不了。

## 结论
- 新增专用 dynamicTool **`laya_judge`**，**只在应用 Python 里装了 Laya 时注册**
  （`buildDynamicTools` 读 `layaStatus().installed`；没装连 schema 都不出现）。
  dynamicTools 只在 `thread/start` / `resume` 生效 ⇒ 装好后**新开会话或切回会话**才出现。
- 三档 preset（`electron/laya-judge.ts` 纯函数构造请求）：
  - `knowledge_gate`：知识价值（知识/闲聊），判据与 `knowledge_add` 内部共用同一份常量；
  - `duplicate`：新内容是否与已有内容重复（**新内容放 state、已有内容放 instructions**）；
  - `custom`：模型自定义 2~6 个互斥选项（如意图 task/question/chat、分流 self/expert/team）。
- 输入校验：state ≤4000 字、reference ≤1500、选项 2~6、选项名 ≤30/含义 ≤200、
  阈值 0.5~0.95、等待 3~30s；非法输入回中文原因，不静默截断。
- 结果语义：置信取 `answer_confidence`（不是行动门限 `confidence`）；低于阈值返回
  **「弃权」**文案，明确告诉模型不要拿猜测当结论。
- 执行端 `layaJudgeForTool`：未装直接拒绝；装了但服务没就绪时后台拉起 + 最多等 `timeoutMs`
  （默认 15s），超时如实回报「正在预热」，**绝不自动安装**（一次判断不能变成 800MB 下载）。
- `pip show` 30s 缓存 + 安装/卸载失效：新开会话/切会话问「装没装」不反复阻塞主进程。
- 常驻指令 `LAYA_INSTRUCTIONS`：只在工具表里有 `laya_judge` 时生效；写明适用场景与禁用场景
  （安全/法律/医疗/财务/不可逆操作/事实核查/长文本/开放生成）。
- IPC：`laya:judge`（manifest → registry → `npm run gen:ipc` → preload / vite-env / harness-api）。

## 依据
- 真实 Laya 环境（标定用的 `python.fat-laya`，`laya 0.3.22`，multilingual 权重已缓存）探针：
  - 知识 vs 闲聊：项目规范 → knowledge，`answer_confidence` 0.972；寒暄 → chatter 0.8685；
  - 重复判断：同义改写 → duplicate 0.5549（两段都塞 state 时曾误判 new 0.9403 ⇒ 改成
    「已有内容放 instructions、新内容放 state」才符合训练分布，与 `knowledge_add` 内部问法一致）；
  - 自定义意图：改按钮 → task 0.9819。
- 守卫 `12s-laya-judge` **29 条**：纯函数真值表（默认/duplicate/custom/边界/clamp/弃权）、
  工具面条件注册、事件路由、manifest/registry/preload、执行端不自动安装、判据单源、
  ⛔ 不进 `harness_tools` 网关（同一能力两个名字会被绕过）、常驻指令配套。
- 验收 `laya-judge` **3/3**：本机**应用 Python 未装 Laya**（标定环境才有）⇒ 工具按设计不出现；
  直接调用执行端返回「未安装」且不偷偷安装。已装机器走「真判一次 / 明确回报正在预热」分支。
- `npm run check` 只剩并行云同步线的既有红（cloud 通道未登记 / cloud 域 id），与本轮无关；
  棘轮 accept.mjs 2390→2421（实测净行），LATEST_ROUND 10-16→10-18。

## 影响面
- 主进程：新叶子 `electron/laya-judge.ts`；`laya-service.ts` 加 `laya:judge` 与执行端；
  `dispatch-rpc.ts` 的知识/重复判据改为共用常量；`developer-instructions.ts` 加常驻指令。
- 渲染层：`part08/01-seg.tsx` 条件注册 `laya_judge`；`part05/event-router/02-request.tsx` 分发。
- 通道/生成物：manifest、registry、preload、vite-env、内置技能 harness-api（gen:ipc 产出）。
- 未装 Laya 的用户：工具面完全不变；已装用户：新开会话/切回会话多一个 `laya_judge`。

## 回滚
- 回退本轮提交：删除 `laya_judge` 工具定义/事件分支/`laya:judge` 通道即可；
  `laya-service` 的内部 `layaJudge`/`layaJudgeAll` 不受影响（知识门禁与思考档继续可用）。
