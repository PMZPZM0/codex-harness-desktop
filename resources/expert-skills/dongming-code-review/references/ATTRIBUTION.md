# 来源与许可

本技能包（`dongming-code-review`）的**规则集与审查方法论**源自开源项目：

- **项目**：[alibaba/open-code-review](https://github.com/alibaba/open-code-review)（OpenCodeReview / `ocr`）
- **许可**：Apache License 2.0
- **版权**：Copyright 2026 alibaba/open-code-review Contributors
- **获取版本**：仓库 main 分支，拉取时间 2026-09-15

## 本技能包包含的衍生内容与对应来源

| 本包文件 | 来源 | 处理方式 |
|---|---|---|
| `references/rules/*.md`（52 份语言规则） | `internal/config/rules/rule_docs/*.md` | **原样搬运** |
| `references/rule-map.md` | `internal/config/rules/system_rules.json` 的 `path_rule_map` | 转成 Markdown 表格（内容未改） |
| `references/false-positive-filter.md` | `internal/config/template/prompts/review_filter_task_system.md` + `review_filter_task_user.md` | **中文改写 + 归纳**（保留全部判定规则与豁免条款） |
| `references/review-flow.md` | 同上目录的 `plan_task_*.md` / `grouping_task_*.md` / `re_location_task_*.md` + `task_template.json` / `effort.go` | **中文改写 + 归纳**（保留全部阈值与硬约束） |
| `SKILL.md` | 上述内容的整合 + 宿主环境适配 | 原创编排（补了 git 取改动的具体做法、覆盖纪律、输出模板） |

## 与上游的差异（重要）

上游是**独立 CLI**：它自己调 LLM、自己做文件筛选与规则解析。本技能包**没有捆绑 `ocr` 二进制**，而是：

- **复用它的知识资产**（规则集、方法论、去误报协议）
- **用宿主的工具执行**（宿主 agent 自己跑 git、读文件、检索代码）
- **由宿主自己的模型做判断**

所以本包是**方法论移植**，不是 CLI 封装。上游的 `ocr review` / `ocr delegate` 命令在本包里不存在，也不需要。

## 许可合规

Apache-2.0 允许自由使用、修改、分发，包括商业用途，条件是**保留版权声明与许可声明**（本文件即承担该作用）。若本技能包随应用分发，本文件必须一并保留。

上游完整许可文本见：<https://github.com/alibaba/open-code-review/blob/main/LICENSE>
