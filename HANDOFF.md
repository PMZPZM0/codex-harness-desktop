# HANDOFF — 交接文档（2026-10-26 21:00）

> 写给**完全没有上下文**的新会话。读完这一份 + 根目录 `AGENTS.md`（怎么建 / 怎么同步）即可接手。
> 项目：Codex Harness Desktop（Electron 43 + React 19 + Vite 8，主进程 spawn `@openai/codex` app-server）。
> 配套技能：内置 `handoff`（怎么写这份文档）、`grill-me`（怎么把方案问清）。两者都在 `设置 → 技能` 里。

---

## 一、我们在做什么

主线是「**收尾发版 + 用户实测反馈的连续修复**」，本轮追加一件工具链改造。按时间顺序五块：

1. **发版**：主仓发 `v0.0.50`（删除未发布的 v0.0.48/0.0.49 的 Release 与 tag，合并重打）；PPcode 发 `v0.1.6`。
2. **语音设置页信息架构重做**（用户四轮实测反馈驱动）：状态语义、长卡片、分组、进度反馈、播报开关联动。
3. **删掉「整群时间预算」**（用户令：正常派活不需要，Codex 自己会安排节奏）。
4. **消息刻度尺系列修复**（用户五轮反馈）：联动、可见性对齐、声音反馈、连贯性、延迟、方向音。
5. **内置两个元技能 + 项目级交接文档**：`grill-me`（上游 mattpocock/skills，两份合成一份）、`handoff`（本仓自造），并写这份 `HANDOFF.md`。

贯穿纪律：**每一轮改动必须同轮同步三个仓并各自推送**（见下节）。

## 二、三仓与生效方式（动错仓 = 白干一轮）

| 仓 | 本地路径 | 远端 | src 改动怎么生效 |
|---|---|---|---|
| 主仓（开发主线） | `D:\Codex Harness Desktop` | `PMZPZM0/codex-harness-desktop`（推 `origin main`） | 本地 `npm run build`，**重启应用** |
| PPcode（副本+发布页） | `D:\PPcode` | `PMZPZM0/PPcode` | 同主仓（本地构建） |
| 云助手 | `D:\Codex Assistant` | `PMZPZM0/codex-harness-cloud-src`（**推 `cloud main`**，⛔ origin 指向主仓） | ⛔ **必须 `node scripts/deploy-cloud-ui.mjs`**，只 build 用户看不到 |

同步手法：主仓改完 → 逐文件补丁到两仓 → 各仓 `npm run build` → `feat(sync)` 提交（注明主仓提交号）→ 各自推送。**品牌面（图标/名称/AUMID）不进同步面**。PPcode 版本线 **0.1.x**，主仓 **0.0.x**，tag 不能混用。

## 三、已完成（全部已提交、已推送、三仓干净）

| 块 | 内容 | 主仓提交 |
|---|---|---|
| v0.0.50 发版 | 删 0.0.48 Release（先 `DELETE /releases/{id}` 再删 tag）+ 取消 0.0.49 构建；版本 0.0.50；whats-new 8 条；CI 三平台并行 | tag `v0.0.50` → `74e2830e` |
| PPcode v0.1.6 | 版本 0.1.5→0.1.6、新写 `docs/releases/v0.1.6.md`（⛔ CI 缺它必 fail）、whats-new 8 条 | `7ecea4f5` + tag |
| 语音页 IA | 分 5 组（必需/可选/选声音/可选克隆/日常）+ 高级折叠 12 卡；「使用中」=`选中 && 已装`，缺模型琥珀徽标；引擎卡单列 642px；下载进度+百分比+卡内结果反馈 | `69f65a787` |
| 播报联动 | 父级派生 `ttsReady`（vits=基础模型齐 / kokoro=ready / emotivoice=ready 且 runnable）；开关显示态=`设置值 AND ttsReady`（**不改存储值**，装好自动恢复） | `f29dfbfae` |
| 删预算闸 | `checkBudget` / `policy.budgetMinutes` / 工具 schema 字段 / 建群回执文案全删；守卫 22 改**负向断言**；老 state.json 残留不写迁移 | `131dce932` |
| 刻度尺联动 | 群广播补 `data-ruler-mark`；刻度取舍与群汇报卡**同源**（`src/lib/visible-group-blocks.mjs`）；过滤后空壳**连外壳不渲染**（42→12 刻度） | `131dce932` |
| 声音反馈 | 滚动跨消息响一声、悬停划动一格一声、停 600ms 收；`playWheelTick(dir,{channel,minGapMs})` 三通道（ruler 30 / hover 24 / scroll 28）互不吞；AudioContext 预解锁 | `f1d6e5a48` |
| 悬停连贯性 | 轨道 gap 4→0 + 上下 padding 4→6（单槽仍 14px）；悬停搬到整条轨道 `onMouseMove` 取最近刻度 | `32308728f` |
| 绿线两道闸 | 无压缩证据不画、定不了位置不画 | `32308728f` |
| 方向音 + 崩溃修复 | 悬停按方向传 frequency（下 1700 / 上 2300）；**React #310 修复**（见坑①） | `f2abed071` |
| 内置 `grill-me` | 上游 `grill-me`(3 行代理) + `grilling`(方法论) 合成一份，去掉对 `Skill` 工具的委托；MIT 改编，声明见 `THIRD_PARTY_NOTICES.md` | `85b9274c7` |
| 内置 `handoff` | 五段结构 + 生效方式 + 锚点要求 + 提示词模板 + 判据 | `85b9274c7` |

判据基线（全部当前绿）：守卫 12r **45/45** · 守卫 22 **204/204** · `npm run check` **0 红**（跑前先 `unset NODE_OPTIONS`，收尾看输出末尾确认 bag-types / dead-imports / require-paths 真跑过）。

## 四、当前卡在哪

**无真阻塞。** 三件挂起事项：

1. **已发版的 v0.0.50 / v0.1.6 不含发版后的全部改动**（语音页重做、预算删除、刻度尺全系列、两个新技能）。tag 打在先、改动在后 —— 主仓 tag 后 **10 个**提交、PPcode tag 后 **9 个**提交未进包。⇒ **需要发 v0.0.51（主仓）与 v0.1.7（PPcode），但必须先获用户确认**（问过两次，用户两次都转去提新需求了）。
2. v0.0.50 的 CI 资产没做最终验收（4 个安装包 + `latest.yml` + sha256）。本机无 gh CLI，取令牌手法见坑⑪。
3. 悬停**方向音的听感**只有用户真机能确认。嫌弃密/吵就调 `src/lib/wheel-tick.mjs` 的 `minGapMs` / `PEAK_GAIN`。

## 五、下一步计划

1. 用户确认后发 **v0.0.51 / v0.1.7**：版本对齐（`package.json` + lock 两处）→ whats-new 加 3~8 条 → **先 `npm run build:electron` 再跑守卫 11r**（探针读 `dist-electron`，不重建出 5 条假红）→ 写 `docs/releases/vX.md`（PPcode CI 缺它直接 fail）→ `npm run check` → commit → push → **tag → push tag 触发 CI**。
2. 提醒用户验证清单：语音页分组/开关联动（**重启生效**）、悬停方向音听感、绿线在真压缩会话上的位置（本机无压缩记录，无法端到端验证过）。
3. 若用户继续报刻度尺/语音问题，先读 `.workbuddy/memory/2026-10-26.md` 当日小节（每轮都有根因与判据）。
4. 新会话开工前先读内置技能 `handoff`（本文件的写作规范）与 `grill-me`（用户提新需求但边界不清时，先把方案问清）。

## 六、踩过的坑（⛔ 真实踩到，别再踩）

**代码级：**

1. ⛔⛔ **hook 声明写在提前 `return null` 之后 = React #310 整页崩溃**（用户白屏截图实锤）。给这种组件加 hook 只许加在顶部 hooks 区。连锁假象：自动化「等待元素超时」可能就是崩溃。
2. ⛔ **恒定音调 = 听觉适应 = 用户感知「没声音」**。声音反馈必须带方向/变化；判「有没有声」用 `AudioContext.createOscillator` 埋点（无音频设备也能测）；`wheel-tick` 用 `osc.frequency.value=` 直接赋值 ⇒ 埋点要闭包引用 osc 延迟读 value；`h.eval` 模板字符串里的注释**不能含反引号**。
3. ⛔ **AudioContext 懒创建**：第一次播声才建 ctx ⇒ 第一声迟 50-150ms。已改预解锁（pointerdown/keydown capture），别改回去。
4. ⛔ **渲染层「空壳」**：群事件过滤后一块不剩必须 `return null`，只留 `data-ruler-mark` 外壳会让刻度尺以为有消息。
5. ⛔ **纯函数兜底 ≠ 该画**：`resolveCompactionAnchor("", {at:0})` 兜底到 visible 最后一回合，调用方必须先查证据（两道闸已加，守卫钉住）。
6. ⛔ 每格自己的 `onMouseEnter/Leave` 在缝隙处必然互相打断 ⇒ 悬停一律整条轨道 `onMouseMove` 取最近格。
7. ⛔⛔ **新增内置技能要改四处，漏一处守卫【229】直接红**：① `electron/builtin-skills/NN-skill-*.ts` 常量；② `electron/builtin-skills.ts` 的 import + `entries`；③ `electron/builtin-skills/00-skill-zh-notes.ts` 导读；④ `src/features/app-view/constants/01-notices-labels.tsx` 的 `SKILL_ZH_NOTES` **和** `BUILTIN_DISTRIBUTED_SKILLS`（两处）。技能正文必须是**字面量**（预检【86】按源文件文本扫描，运行时拼装 = 恒真假绿）。
8. ⛔ 照抄外部技能要先查它引用的能力**在本应用存不存在**：上游 `grill-me` 正文只有「Call the Skill tool with "grilling"」，本应用没有 `Skill` 工具 —— 直接内置就是一条死指针。

**流程级：**

9. ⛔ **判定「某仓缺功能」前先怀疑自己的命令**：路径拼重（`src/features/src/features/x`）、搜错目录都会静默失败。用绝对路径 + 单文件 `ls` 复核。
10. ⛔ **改 whats-new 后必须先 `npm run build:electron` 再跑守卫 11r**（探针读 `dist-electron` 产物，不重建 = 5 条假红）。
11. ⛔ 本机无 gh CLI；GitHub API 令牌从凭据管理器取：`printf 'protocol=https\nhost=github.com\n\n' | GIT_TERMINAL_PROMPT=0 git credential fill` 取 `password=`（⛔ 别把 token 打到终端）。
12. ⛔ **删 Release 顺序不可反**：先 `DELETE /releases/{id}`，再删 tag；只删 tag ⇒ Release 退草稿态（匿名不可见、更新器收不到）。
13. ⛔ **heredoc 里写 Python 正则会把 `\s` 写坏成 `/s`** ⇒ 改守卫里正则密集的行，用 Edit 工具直写。
14. ⛔ 守卫脚本变量名冲突 = 整条链 SyntaxError（不是断言失败），报错看第一行。
15. ⛔ **未提交改动先查来历再收口**：云助手工作区曾残留他人 hunk（主仓已提交的同步漏网），查清后单独提交、不与本轮混提。
16. ⛔ 云助手 `src/**` 改完必须 `node scripts/deploy-cloud-ui.mjs`，只 build 用户永远看不到。

## 七、验收手法速查

- 真机（无 GUI）自渲：`scripts/e2e/lib/harness.mjs` 的 `ElectronHarness`（隔离 profile、自动灌真实配置）；定位会话用 `localStorage.setItem("last-thread", <id>)` + reload。
- 声音：埋点 `createOscillator` 计数/频率；方向音看 frequency 值。
- 布局：Jimp 截图 + `ViewImage` 人工核对。
- 刻度尺联动：逐段 `scrollTop` 滚动后数 `.ruler-tick.current` 变化；悬停连贯性 = 每 3px 派发 mousemove 统计 tip 中断次数。
- 项目日志：`node scripts/logs.mjs new --kind milestone …`（结论档案，⛔ 不重复写）。
- 记忆：本轮全部细节在 `.workbuddy/memory/2026-10-26.md`（含每轮的根因/判据/提交号）。
