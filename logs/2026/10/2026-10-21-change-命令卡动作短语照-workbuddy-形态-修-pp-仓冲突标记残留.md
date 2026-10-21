---
id: 2026-10-21-change-命令卡动作短语照-workbuddy-形态-修-pp-仓冲突标记残留
date: 2026-10-21
kind: change
area: ui
title: 命令卡动作短语（照 WorkBuddy 形态）+ 修 PP 仓冲突标记残留
tags: [ui, command, label, workbuddy]
commits: [f66036a, 73e2bd1, a0a6fbcd, 67d9cff4]
files: []
importance: normal
---

# 命令卡动作短语（照 WorkBuddy 形态）+ 修 PP 仓冲突标记残留

用户令（10-21，附 WorkBuddy 截图）：分析 WorkBuddy 命令执行的中文展示实现，参考其做法在本仓实现同样效果。

**WorkBuddy 的机制**（从截图反推，两条硬证据）：
1. 标题 = **模型在工具调用时给的 description**（「加静音同步断言并跑守卫」「写增量同步脚本」
   「复跑守卫并看 check 结果」——含语境与意图，无法从命令字面机械推导；且 `11z`/`check`/`build`
   保留原文 ⇒ LLM 生成的自然取舍，不是翻译器）。
2. 正文 = 命令原文，**一个字符都不翻译**（路径 / 参数 / `+8 -0` 全保留）。
⇒ 双轨：人读的中文标题（可折叠）+ 原文命令（次要位置 / 展开内）+ 状态图标（✓ / ○ / !）。

**本仓的落点**（引擎只给 `command` 字面，commandExecution **不带** description/action ⇒
只能模式识别）：在既有 `command-display.mjs`（intent/target/purpose）之上加 `commandAction()`：
- 规则表覆盖本仓高频命令：`scripts/guards/<名>.mjs` → 「跑守卫 11z」、`npm run check` →
  「跑全量检查」、heredoc → 「写文件 x」、`git commit && git push` → 「提交改动并推送远端」、
  `curl` → 「请求接口」、`rm -rf` → 「删目录」…
- 复合命令拆 `&&`/`;` 拼「A并B」（⛔ 不拆 `|`：管道是同一条处理链）。
- ⛔ **认不出返回空串**，调用方退回原 hint —— 绝不编假动作（"执行操作"这种假文案）。

**自查抓到的回归（已修）**：动作短语会把**技能态**（读 SKILL.md 也是一条命令 ⇒ 显示「跑脚本 x」
盖掉「已使用技能 humanizer」）与**审批态**（「等待批准」）盖掉 ⇒ headline 加两道让位。

判据：真跑 `commandAction` 16 组（含未知命令/空串必须返空）；【127】7 条断言（含负向「不许兜底假动作」、
「必须给技能/审批让位」）；三仓 build 绿；主仓 check 仅 1 条既有 CSS 红。

**顺手修的真 bug**：PP 仓 HEAD 的 `src/lib/extensibility-catalog.mjs` 里带着冲突标记
（`<<<<<<< ours` / `=======` / `>>>>>>> theirs`，ours=514 对、theirs=511 是主仓数）
⇒ 该仓 vite 构建直接 `Encountered diff marker` 全废。删标记保留 514（= PP manifest 条数）。
⛔ 教训：3way 合并后必须 grep 冲突标记再提交；`git apply --3way` 报 conflict 时文件里一定留了标记。
