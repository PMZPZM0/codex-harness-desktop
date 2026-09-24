---
name: arch-doc-sync
description: 同步 ARCHITECTURE-RULES.md / AGENTS.md 里的实测数字与过期条目 —— 拆域、加守卫、落地新机制之后收尾用。当用户说「文档滞后 / 同步文档 / §0 数字不对」，或你刚改完代码/守卫/生成器需要收尾时读它。
---

# 同步架构文档的实测数字与过期条目

## 何时用
- 改了代码 / 加了守卫 / 拆了域 / 落地了新机制之后（`ARCHITECTURE-RULES.md` §0 自己写着「每轮收尾必须同步，滞后即视为违规」）
- 用户说「文档滞后 / 同步文档 / §0 数字不对」
- 发现某处写着「未落地」但实际已落地

## 数字位点（各自独立漂移，别只改一处）
1. `docs/ARCHITECTURE-RULES.md` **开头引用块**：基线 SHA / 预检 ✓ 数 / 「尚未落地」清单
2. **§0 现状数字表**：每行一个实测值 + 表头快照 SHA
3. **§4.1** 接口契约表：IPC 三件套 / 生成器的说法
4. **§6** checklist：第 5 步 IPC、第 8 步守卫落点与断言数、第 9 步同步要求
5. **§8** 已知未落地项表：落地了要**改写该行**（写清残留风险），不是删行
6. `AGENTS.md` 的「最硬的六条」：第 3 条 IPC、草案清单、第 6 条守卫落点

## 步骤
1. **grep 定位**（别信记忆）：`Select-String -Path docs\ARCHITECTURE-RULES.md,AGENTS.md -Pattern '三件套同轮|尚未落地|未落地，现手写|<旧数字>'`
2. **核实真源** —— 每个数字都要有实测来源：
   - 预检断言数：`node scripts/check-preflight.mjs` 输出里数 `✓` 行（⚠️ 带 ANSI 色码，先剥 `\x1b\[[0-9;]*m`）
   - 文件 / 行数：`(Get-Content X | Measure-Object -Line).Lines`
   - **注册表项数要读代码里的数组**（如 `ensureBuiltinSkills` 的 `entries`），不是数目录里的文件数
3. **精确替换**：单条 Replace + 自检 `if($n -eq $t){'NO-MATCH'}else{写回}`（见「坑」）
4. **验证**：旧值 grep 计数为 0（**历史留痕行除外**）、编码/换行未变、`npm run check` 全绿
5. **提交**：`git add AGENTS.md docs/ARCHITECTURE-RULES.md`

## 坑
- ⛔ **`.NET IO` 的当前目录 ≠ PowerShell 的 `cd`**：`[IO.File]::ReadAllBytes('docs\x.md')` 会解析到**进程启动目录**（实测报 `Could not find a part of the path 'D:\_Codex临时产物\docs\...'`）。一律传绝对路径。
- ⛔ **写回必须显式 UTF-8 无 BOM**：本仓文档是 UTF-8 无 BOM + 纯 LF。`Set-Content` 默认 ANSI 会毁中文 ⇒ 用 `[IO.File]::WriteAllText($p,$t,(New-Object Text.UTF8Encoding($false)))`。
- ⛔ **历史留痕行不要改**：带 SHA / 日期的「xx 同步」记录是追加式的 —— 新增一条，旧数字在那里是史实。
- ⛔ **插入新行前先探目标文件的换行符**（本仓 LF/CRLF 混用 —— `docs/*.md` 与 `AGENTS.md` 是 LF，但 `07-memory-panel.tsx` / `vite.config.ts` 是 CRLF）⇒ CRLF 用 ``$nl="`r`n"``、LF 用 `$nl=[char]10`；用错就 `Replace` 返回 NO-MATCH（看着像锚点写错，实际是行尾不匹配 —— 09-23 白跑两轮）。PowerShell 双引号里反引号是转义符，而文档满是反引号 ⇒ 替换串一律用**单引号**拼接。
- **一条命令只做 1–4 处替换**：长多语句脚本易被 harness 策略整条拦截；单条 Replace 最稳。

## 判据
- 所有位点的旧值 grep 计数为 0（历史留痕行除外）
- `npm run check` 全绿
- 文件仍是无 BOM（前 3 字节 ≠ `239,187,191`）+ 纯 LF（`\r\n` 计数 0）
- 提交信息写清「改了哪几处 + 为什么 + 验证结果」