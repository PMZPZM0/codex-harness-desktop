# HANDOFF — 交接文档（2026-10-26 21:00）

> 写给**完全没有上下文**的新会话。读完这一份 + 根目录 `AGENTS.md`（怎么建 / 怎么同步）即可接手。
> 项目：Codex Harness Desktop（Electron 43 + React 19 + Vite 8，主进程 spawn `@openai/codex` app-server）。
> 配套技能：内置 `handoff`（怎么写这份文档）、`grill-me`（怎么把方案问清）。两者都在 `设置 → 技能` 里。

---

## 一、我们在做什么

主线是「**收尾发版 + 用户实测反馈的连续修复**」，本轮追加一件工具链改造。按时间顺序五块：

1. **发版 → 又撤包**：主仓发 `v0.0.50`（删除未发布的 v0.0.48/0.0.49 的 Release 与 tag，合并重打）；PPcode 发 `v0.1.6`。**两个 Release 已于 10-26 21:30 按用户指令撤包**（Release 连 11 个资产约 5 GB + 本地/远端 tag 全删，详见 §四第 1 条）。
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
| v0.0.50 发版 | 删 0.0.48 Release（先 `DELETE /releases/{id}` 再删 tag）+ 取消 0.0.49 构建；版本 0.0.50；whats-new 8 条；CI 三平台并行 | tag `v0.0.50` → `74e2830e`（**已撤回**：Release 424134808 + tag 均删） |
| PPcode v0.1.6 | 版本 0.1.5→0.1.6、新写 `docs/releases/v0.1.6.md`（⛔ CI 缺它必 fail）、whats-new 8 条 | `7ecea4f5` + tag（**已撤回**：Release 424114270 + tag 均删） |
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
| 消息顺序修复 | 用户消息被误判成群广播（原文里的记忆块提到 `[群事件]`）⇒ 渲染到回复**下方**；改判行首标签 + 剥注入段后再判 | `7fa2f686b` |
| 刻度尺判据同源（审查补） | 刻度尺原读**原文**判群广播 ⇒ 注入块里的行首标签会让普通消息丢刻度；改走 `parseUserRefs(raw).groupEvents`，并加接线断言（12r + 注入剥离回归） | `f0832d0e0` |

判据基线（全部当前绿）：守卫 12r **45/45** · 守卫 22 **204/204** · `npm run check` **0 红**（跑前先 `unset NODE_OPTIONS`，收尾看输出末尾确认 bag-types / dead-imports / require-paths 真跑过）。

## 四、当前卡在哪

**无真阻塞。** 三件挂起事项：

1. **当前没有任何已发布版本**：`v0.0.50` / `v0.1.6` 的 Release 与 tag 已按用户指令撤包（10-26 21:30）⇒ 两仓最新 Release 回落到 `v0.0.47` / `v0.1.5`（10-23）。**已装 0.0.50 的用户不会被降级，但此后收不到更新**。⚠️ 应用内更新检查**不走 `latest.yml` 也不走 `/releases/latest`**（产品线隔离，见 `electron/updates.ts` 顶部注释）：它拉 releases 列表 + tag 前缀过滤 + semver 比较 ⇒ 现在判定 `up_to_date`（`0.0.47 < 0.0.50`）；`latest.yml` 只在手动下载那条路上用来验 sha512。⇒ 需要重新发版，**版本号待用户定**：tag 已删，可复用 `0.0.50`/`0.1.6`（与上次 0.0.48/0.49 同样做法），也可 bump 到 `0.0.51`/`0.1.7`。
2. ~~v0.0.50 的 CI 资产验收~~ —— 已不必做（资产随 Release 删除，共 11 个约 5 GB：主仓 3 个安装包 + blockmap + `latest.yml`，PPcode 3 个安装包 + 3 份 sha256）。**重新发版后仍需验收一次**。本机无 gh CLI，取令牌手法见坑⑫。
3. 悬停**方向音的听感**只有用户真机能确认。嫌弃密/吵就调 `src/lib/wheel-tick.mjs` 的 `minGapMs` / `PEAK_GAIN`。
4. **副本仓的守卫目录落后主仓若干代**（10-26 审查实测：`scripts/guards/` 85 个文件里 **57 个**与主仓不一致；`12r` 差 71 行、`22` 差 219 行且仍在调源码已删的 `checkBudget`）⇒ 两副本仓的 `npm run check` 既红、又覆盖不到 10-18 之后的新规则 —— **「三仓同轮同步」在验证层是失效的**。同步是独立任务：守卫里混着品牌/目录差异（如 `_ctx.mjs` 的 `SKIP_DIRS` 含 `.ppcode-harness`），⛔ 不能整份覆盖。本轮只同步了 `src/**` 与两份回归脚本，没动守卫目录。

## 五、下一步计划

1. 用户确认版本号后重新发版（**v0.0.51 / v0.1.7**，或复用 **v0.0.50 / v0.1.6**——tag 已删、可重打）：版本对齐（`package.json` + lock 两处）→ whats-new 加 3~8 条 → **先 `npm run build:electron` 再跑守卫 11r**（探针读 `dist-electron`，不重建出 5 条假红）→ 写 `docs/releases/vX.md`（PPcode CI 缺它直接 fail）→ `npm run check` → commit → push → **tag → push tag 触发 CI**。
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

9. ⛔⛔ **「消息属于哪一类」必须判在剥完注入段的文本上**：`isGroupEventText(原文)` 会把用户消息判成群广播 —— 每条原文都带 `[Harness 常驻记忆 …]`，记忆正文里提到过 `[群事件]`（本项目实测 5 处）⇒ 10-26 群汇报卡改版后该消息被渲染到回复**下方**（用户：「倒反天罡」）。判据收口到 `user-refs.isGroupEventMessage`，且 `parseGroupEvents` 只认**行首**标签。**刻度尺是同一类错的第二个现场**（10-26 审查发现）：`01-message-ruler.tsx` 原调 `visibleGroupBlocks(原文)`，注入块里只要出现**行首** `[群事件]`，普通消息就被算成群广播 —— 块被全部过滤时它的刻度直接消失（气泡照常显示）。现改走 `parseUserRefs(raw).groupEvents`，并由 `verify-injection-strip` 的**接线断言**钉死（要求源码含该表达式、且不含 `visibleGroupBlocks(raw)`；⚠️ 连注释里写这串字都会判红 —— 敏感是有意的，别为此放松断言）。

**流程级：**

10. ⛔ **判定「某仓缺功能」前先怀疑自己的命令**：路径拼重（`src/features/src/features/x`）、搜错目录都会静默失败。用绝对路径 + 单文件 `ls` 复核。
11. ⛔ **改 whats-new 后必须先 `npm run build:electron` 再跑守卫 11r**（探针读 `dist-electron` 产物，不重建 = 5 条假红）。
12. ⛔ 本机无 gh CLI；GitHub API 令牌从凭据管理器取：`printf 'protocol=https\nhost=github.com\n\n' | GIT_TERMINAL_PROMPT=0 git credential fill` 取 `password=`（⛔ 别把 token 打到终端）。
13. ⛔ **删 Release 顺序不可反**：先 `DELETE /releases/{id}`，再删 tag；只删 tag ⇒ Release 退草稿态（匿名不可见、更新器收不到）。
14. ⛔ **heredoc 里写 Python 正则会把 `\s` 写坏成 `/s`** ⇒ 改守卫里正则密集的行，用 Edit 工具直写。
15. ⛔ 守卫脚本变量名冲突 = 整条链 SyntaxError（不是断言失败），报错看第一行。
16. ⛔ **未提交改动先查来历再收口**：云助手工作区曾残留他人 hunk（主仓已提交的同步漏网），查清后单独提交、不与本轮混提。
17. ⛔ 云助手 `src/**` 改完必须 `node scripts/deploy-cloud-ui.mjs`，只 build 用户永远看不到。
18. ⛔ **副本仓守卫可能比源码更旧**：PPcode 的守卫 22 仍在调 `checkBudget`（源码已删该函数）⇒ 一跑就 TypeError，这不等于本轮改坏了。验证本轮改动先单跑 `node scripts/verify-injection-strip.mjs`，再决定要不要收口那份 219 行的守卫差异。
19. ⛔ **撤包不是「删了就完」**：删掉最新 Release 后，`latest.yml` / 下载页会**回落到上一个 Release**（本次 v0.0.50→v0.0.47、v0.1.6→v0.1.5）⇒ 已装新版的用户不降级、但从此收不到更新。撤包与重发要连着做；撤完必须核对三处：API Release 列表、`git ls-remote --tags`、本地 `git tag`（⚠️ 本地 tag 名按字典序排，`v0.0.50` 会排在 `v0.0.5` 前面，别用 `tail` 判断有没有）。
20. ⛔ **`git status` 干净 ≠ 发版资产齐**：撤包前先拉 Release 资产清单（名称/大小/下载量），确认没有用户已下载的版本被无声抹掉（本次 v0.0.50 的 mac-arm64.zip 已有 1 次下载，已如实告知用户）。

## 七、验收手法速查

- 真机（无 GUI）自渲：`scripts/e2e/lib/harness.mjs` 的 `ElectronHarness`（隔离 profile、自动灌真实配置）；定位会话用 `localStorage.setItem("last-thread", <id>)` + reload。
- 声音：埋点 `createOscillator` 计数/频率；方向音看 frequency 值。
- 布局：Jimp 截图 + `ViewImage` 人工核对。
- 刻度尺联动：逐段 `scrollTop` 滚动后数 `.ruler-tick.current` 变化；悬停连贯性 = 每 3px 派发 mousemove 统计 tip 中断次数。
- 项目日志：`node scripts/logs.mjs new --kind milestone …`（结论档案，⛔ 不重复写）。
- 记忆：本轮全部细节在 `.workbuddy/memory/2026-10-26.md`（含每轮的根因/判据/提交号）。
