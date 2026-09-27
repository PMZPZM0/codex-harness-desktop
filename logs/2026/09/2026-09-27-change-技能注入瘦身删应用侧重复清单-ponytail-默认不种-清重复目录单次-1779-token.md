---
id: 2026-09-27-change-技能注入瘦身删应用侧重复清单-ponytail-默认不种-清重复目录单次-1779-token
date: 2026-09-27
kind: change
area: engine
title: 技能注入瘦身：删应用侧重复清单 + ponytail 默认不种 + 清重复目录（单次 -1,779 token）
tags: [skills, token-budget, ponytail, skill-discipline, dedupe]
commits: []
files: [electron/skill-discipline.ts, electron/features/boot.ts, scripts/guards/06-app-behavior.mjs]
importance: high
---

# 技能注入瘦身：删应用侧重复清单 + ponytail 默认不种 + 清重复目录（单次 -1,779 token）

用户三连指令（均已确认）：① 删应用侧重复技能清单 ② ponytail 写代码模式默认不启用 ③ 清 ~/.agents/skills 重复目录。

【先答用户的质疑——全部成立】
「这些技能又不是默认启用的，干嘛每次都带上」：机制 = 引擎「扫到就注入」——技能根目录（7 个）下所有 SKILL.md 的 name+description 全量进 developer 块的 ### Available skills，**没有开关**。57 个技能 / 实测 5,653 token，每次请求都带。
「find-skills 不就是用来找技能的吗」：find-skills 管的是**外部市场**（npx skills find → skills.sh），不是本地清单——两者互补而非替代。但用户方向正确：本地技能不该全量注入。

【本轮三项改动（全部实测验证）】
① 应用侧重复清单删除（skill-discipline.ts）：同一批技能此前被注入**两遍**（引擎 9,970 + 应用 skill-discipline 区间 1,561，交集 27 条）。删掉应用侧枚举，保留运用守则（1,155 token，行为约束）+ MCP 清单；技能发现指向引擎清单与 find-skills。codex-home/AGENTS.md 12,646 → 7,088 字节（该文件是运行时产物，已用编译产物 upsert 手动刷新，MCP 清单按调用方同口径回填——用户唯一连接器 enabled=false，空数组与真实行为一致，核实过 refreshSkillDiscipline 的 filter）。
② ponytail 默认不种（boot.ts）：删启动链自动种（旧逻辑=全新安装即自动 enabled，每会话多注入 ponytail+6 子技能 ~640 token）。手动路径保留（runtime:install id=ponytail）；已装用户不受影响。四处描述同步（dev-runtimes / AGENTS.md×3 / TOOLCHAIN.md）。守卫【26】同步翻转。
③ 清 ~/.agents/skills 的 3 个重复技能（sha256 逐一比对与 codex-home/skills 完全一致后才删，整个目录先备份到 .workbuddy/tmp/agents-skills-backup-20260927）。省 219 token。

【实测总账】单次请求 30,385 → 28,606 token（-1,779 / -5.9%）。新安装用户额外省 ponytail ~640（本机已装不受影响）。

【过程中抓到的两个自己的坑（都有价值）】
① **变异测试抓到自己断言的假绿**：第一版负向断言锚「void ensurePonytailPlugin(codexHome, bundledPonytail)」精确字面量——变异时换个实参形态就照样绿。改为结构性断言（boot.ts 里任何形态的 ensurePonytailPlugin 都不许出现，codeOnly 剥注释后判断），重做变异 → 红 ✓。
② **CRLF 静默 no-op**：删死导入的 replace 带了 '\n'，CRLF 文件里 '";\r\n' 匹配不上 '";\n'，replace 空转却报成功——当时 grep 残留计数=1 就是被删失败的证据，被我漏了，直到结构性断言在还原测试中变红才暴露。教训强化：**对文件做字符串替换一律不带换行锚点，改完必须 grep 复核计数**。
③ 顺带发现遗留异常未修（待用户定夺）：desktop-automation 目录里 SKILL.md(4,295B, 09-20) 与 SKILL.md.disabled(1,527B, 08-31) **并存且内容不同**——旧版残留。影响面已消除（新代码不再读该目录写清单；引擎按 SKILL.md 存在照列）。

【完整性核验】tsc 双 0 / vite build / 预检 0 真红；【26】翻转断言+【103】28 条全绿；变异验证（import-only 变体也红）→ 修复 → 绿，完整闭环。
