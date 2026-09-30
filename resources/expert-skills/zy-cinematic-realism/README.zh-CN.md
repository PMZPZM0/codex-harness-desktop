# 造梦师 · 中文导读（zy-cinematic-realism）

> 上游原文（SKILL.md 与 references/ 全部英文文档）逐字保留、未做改写；本文件是随包分发的中文说明。
> 来源：<https://github.com/popopo-99/zy-cinematic-realism>（v2.3.0，CC BY-NC 4.0）。

## 这是什么

一套电影视觉 Prompt 工作流：把一句场景想法整理成**稳定的视觉方案**，再按目标模型翻译成**原生 Prompt**。

- 核心链：`Scene Master（锁人物 / 瞬间 / 动作 / 机位 / 构图 / 光线 / 道具 / 时间 / 天气 / 限制）→ Model Compiler（按模型编译）→ Result Repair（结果修复）`
- 参考图解梦（Dream Decode）：先判断每张参考图的职责与媒介，再提炼可迁移的视觉规律。
- 连续性：Base Lock + Shot Delta —— Base 锁定不变的要素，逐张只改一个变量，保多帧一致性。
- Prompt Doctor：结果不像时只修机位 / 姿态 / 光线层级，不动身份与主体。

## 怎么用

读同目录 `SKILL.md`（路由器）开始；它会把细节路由到 `references/` 下的分文档：

- `references/model-routing.md` 与 `references/models/`：四个模型的原生适配器（GPT Image 2.5 / Midjourney / Seedream 5 Pro / Nano Banana）。
- `references/dream-decode.md` / `reference-role-router.md` / `medium-router.md`：参考图解梦链。
- `references/prompt-compiler.md` / `result-repair.md` / `quality-checklist.md`：编译 / 修复 / 质检。
- `references/directors/`：导演库（按风格路由）。

## 使用边界

- ⛔ **CC BY-NC 4.0**：署名 + 仅限非商业用途。
- 本应用内主要供生图类专家（画意 / 剪承团首帧）在「电影感 / 叙事单帧」场景使用；电商白底图类需求不要套这套。
- 技能不调用任何外部服务，全部是提示词工程规则。
