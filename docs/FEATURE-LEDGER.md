# 功能更新清单（FEATURE LEDGER）

> **定位**：功能新增/改动的**权威台账**。发布时写更新日志、GitHub Release Notes、
> `whats-new-notes.ts` 要点，一律以本文件为数据源——不重新翻 commit、不靠记忆。
>
> 与另外两份文档的分工（⛔ 不做第二份真相源）：
> - `docs/FEATURE-INVENTORY.md` = 静态基线（功能**现在在哪**，供搬迁/检索坐标）
> - `docs/CHANGELOG-ROUNDS.md` = 轮次叙事（一次改动的**完整过程**，细节长文）
> - **本文件 = 条目式流水**（一次一行，发布时直接搬）
>
> **维护规则**（写进 `AGENTS.md`，对所有 Agent 生效）：
> 1. **同轮记录**：每次新增功能 / 功能改动，同一个提交轮次内必须在本文末尾追加条目，
>    与代码改动同 commit（或在收尾提交中一并落盘）。漏记 = 工作未完成。
> 2. **列必须齐**：日期、功能名称、类型、影响范围、简要描述，缺一不可。
> 3. **类型只用这六个**：`新增` / `改动` / `修复` / `移除` / `流程`（工作方式/规则） / `基建`（仓库/CI/发布链）。
> 4. **影响范围写具体落点**（模块/板块/IPC 域），不写"全局"糊弄；跨端写明「三仓」「桌面版」等。
> 5. **只追加不改写**：写错了用新行勘误（标注"勘误"），不删旧行——台账要能追溯。
> 6. 新条目加在最上面（最新在前）。

## 条目格式

```
| 日期 | 功能名称 | 类型 | 影响范围 | 简要描述 | 提交 |
```

- **日期**：`YYYY-MM-DD`
- **类型**：新增 / 改动 / 修复 / 移除 / 流程 / 基建
- **影响范围**：模块路径或板块名，多个用顿号；跨端注明哪个仓
- **简要描述**：一两句话说清「做了什么、用户能感知什么」；含关键取舍时附一句
- **提交**：短 hash；尚未提交写 `-`

---

## 台账

| 日期 | 功能名称 | 类型 | 影响范围 | 简要描述 | 提交 |
|---|---|---|---|---|---|
| 2026-10-13 | 专家市场翻页根因修复 + 四市场统一翻页动画 | 修复 | `skillhub-packages.ts`、四个市场组件、`11-settings-secrets.css` | 「下一页没变化」根因 = SkillHub 技能包 API 只认 page=、pageNum 被忽略（实测 page1/2 同 6 条）；改对参数（搜索全量循环同修）+ 四个市场网格统一 key={页码}+page-turn 过渡动画（减动效偏好自动关）；守卫 12n 9 条（3 处变异全抓）| - |
| 2026-10-13 | 修更新面板「一直检查中+鬼畜」无限循环 | 修复 | `market-updates/MarketUpdatePanel.tsx` | apiOf 每次渲染返回新对象 ⇒ useEffect([check]) 每轮重跑检查 → setState 死循环（两面板同时转、行反复闪）；api 改 useMemo 按 kind 记忆化，12j 加防回归断言（裸调用负向）；实测 15s 采样稳定 | - |
| 2026-10-13 | 内置逆向工程专家「洞见」（REA） | 新增 | `electron/expert-teams/16`、`dev-runtimes.ts`、`runtime-ipc.ts`、`custom-model-apply.ts` | 源 morluto/rea（npm rea-agents，MIT，实测装后 ~100MB）：开发工具页新增「REA 逆向分析」按需下载（npmmirror 优先+官方回落，重跑即更新，在线更新链已纳管），装完自动注册 [mcp_servers.rea]；内置单主理人专家「洞见」（requiresTool=rea，未装整队隐藏），SOP=判目标→REA 证据→讲人话→项目内复刻；守卫 12h 24 条（5 处变异全抓） | 447fb19 |
| 2026-10-13 | 内置插件密钥改加密落盘（明文形态清零） | 修复 | `electron/main/09-agents-plugins.ts`（唯一读写点 + safeStorage 加密 + 启动迁移 + `builtinPluginEnv`）、`electron/features/builtin-ipc.ts`、`electron/features/boot.ts`、`electron/codex-server.ts`（`builtinEnv` 单独一格）、`resources/tools/harness-media.mjs`（密钥优先读 env）、`scripts/guards/12m-builtin-secrets.mjs`（新，27 项） | `builtin-plugins.json` 过去用裸 `JSON.stringify` 写明文 `apiKey`（同一应用的 `custom-models.json` 早已 safeStorage 加密）。现落盘只有 `encryptedKey`、明文只在内存；读取**容忍存量明文**（不打红既有端到端夹具）；启动自愈就地升级（不写 .bak）；密钥额外注入**引擎进程 env** —— 命令行兜底 `harness-media.mjs` 是纯 Node、拿不到 safeStorage，这是它唯一的取密钥途径 | 0be0228 |
| 2026-10-13 | 市场技能装了不生效（落盘目录名被折成「点开头」） | 修复 | `electron/skills-market.ts`（`safeFolder` → `skillFolderSlug`）、`electron/codex-market.ts` / `electron/codex-official-market.ts`（同型 safeFolder）、`electron/skill-pool.ts`（新增自愈 `healMisnamedSkillDirs`）、`scripts/guards/11s-skill-switch.mjs`（新增 ③d 段 10 条，含真跑夹具） | 市场技能名形如「李白.Skill」，旧归一（CJK→`-`、再剥前导 `-`）把后面的 `.` 暴露到首位 ⇒ 装成 `.Skill-libai`；而点开头目录在本应用里是「不是用户技能」的通用标记（技能池 / 技能包 / 两个插件市场 / 命令目录五处扫描都跳过）⇒ 装了但谁都看不见。改为首尾的 `.` 与 `-` 一起剥，并在池投影**之前**自愈已装坏的历史落点（只认带我们市场清单的目录，用户自建 `.xxx` 不碰） | cc53251 |
| 2026-10-13 | ponytail 更新完版本号不刷新（当前版本误报随包常量） | 修复 | `electron/ponytail-plugin.ts`（新增 `listInstalledPonytailVersions` 实读已装版本）、`electron/update-backends.ts`（检测 / 更新前两个分支改用实装版本，判更新走 `compareVersions`）、`scripts/guards/12l-component-update.mjs`（新增第 ⑪ 节 9 项，含夹具行为断言） | 用户实测：控制台「组件更新」里 ponytail 那行点更新后 toast 说「已更新」，但版本号与「有更新」徽标一直不动（看着像没刷新）。根因 = 当前版本直接报随包常量 `PONYTAIL_VERSION`（4.9.0），而在线更新装进的是按标签命名的目录（`…/ponytail/ponytail/5.2.0`）⇒ 更新其实成功了，界面仍报 4.9.0、`hasUpdate` 恒真。改为从引擎安装落点实读已装版本（取最高；一个都没装才回落随包常量），"有没有新版"改用 semver 比较 | 3146188 |
| 2026-10-13 | 同步面明确包含 `logs/` 结论档案 | 流程 | `AGENTS.md` 规则块（三仓同内容）、`logs/` 结论档案（条目文件 + `index.jsonl`） | 「改动必须同轮同步全部三个仓」补一句：同步面含 `logs/` 结论档案。起因：`logs/` 此前从未进入同步批次（同步批次对 `logs/` 的 diffstat 为空）⇒ 三仓日志库漂移（PPcode 落后 19 条、云助手落后 8 条）；同日把三仓结论档案补齐到 115 条并各自 `reindex` 重建索引（⛔ sha256 与文件字节含行尾绑定，直接拷索引会哈希不符） | 16c97be |
| 2026-10-13 | 跨仓同步硬规则：改动必须同轮同步全部三仓 | 流程 | `AGENTS.md`（多仓协作段）、`docs/REPO-WORKFLOW.md`，以及 PPcode / 云助手两仓的同名文件（同内容落地） | 用户令「在项目规则里面写一下，改动必须要同步 ppcode 和云助手」：明确三仓清单（桌面版主线 + PPcode + 云助手）、任一仓改动都要同轮同步另外两仓并各推 `main`（⛔ 云助手推 `cloud`，它的 origin 指向桌面版仓）、漏同步 = 该轮工作未完成；配套流程文档补入云助手拓扑与三仓差异（生成物各仓自产、手写源逐项合并、棘轮按实测更新） | 6286030 |
| 2026-10-13 | 改动同步到 PPcode 与云助手（本轮 14 提交） | 流程 | `D:/PPcode`、`D:/Codex Assistant`（两个副本仓） | 自桌面版 8cafc37..f07f73f 逐文件 git apply --check 预检后落地：PPcode 33 项（提交 b9ffddc + 台账回填 b782c0d，已推 origin）、云助手 38 项；副本侧各跑 gen:ipc 与 gen:domains（⛔ 不套主仓生成物）、manifest 手工合并 autoUpdate 域 5 通道与 appSettings 类型串、行数棘轮按副本实测对齐；同一轮把「改动必须同轮同步全部三仓」写成 AGENTS.md 硬规则 | ae22757 |
| 2026-10-13 | 统一组件更新体系（清单 + 单一入口 + 快照回滚） | 新增 | `electron/update-registry.ts`（组件清单与镜像策略单一真相源）、`electron/update-backends.ts`（执行层，接各域既有安装链）、`electron/update-safety.ts`（快照/回滚/内容指纹）、`electron/features/auto-update-ipc.ts`(+scan/run/run-all 三通道)、`electron/app-settings.ts`(autoUpdateOverrides + readAutoUpdateRowSwitch)、`src/features/settings-general/AutoUpdateCard.tsx`（控制台统一入口）、`scripts/guards/12l-component-update.mjs` | 覆盖开发工具（npm/pip）、Codex 引擎、内置技能说明、专家配套技能、ponytail、市场/官方插件、人格包；钩子与随包内置工具列为「不可单独更新」并写明原因。全部走国内镜像（npm→npmmirror、pip→清华、GitHub→gh-proxy/ghfast，直连仅兜底）；更新前快照、失败自动回滚、内容一致则不重装；控制台可检测/逐个更新/一键更新全部并输出进度与结果 | ad2c179 |
| 2026-10-13 | 自动更新开关统一到「控制台」 | 改动 | `settings-general/AutoUpdateCard.tsx`（新）、`GeneralSettingsSection.tsx`、`settings-skills/SkillsCenterSection.tsx`、`settings-automation/AutomationSettingsSection.tsx`、`electron/features/auto-update-ipc.ts`、`app-settings.ts` | 用户反馈「开关都没看见」：技能 / 桌面自动化 / 浏览器自动化 / Mac 电脑操作 / Codex 引擎**五个自动更新开关集中到「设置 → 控制台」的「自动更新」卡片**（原先分散在技能中心与自动化页）。技能中心与自动化页不再放开关、只留指向控制台的说明；自动化页改名「版本与手动更新」（保留版本号、立即更新、进度）。技能那条并入同一状态端点 ⇒ 界面一次请求拿全五个开关；缺省值分档（装包类默认开、技能内容更新默认关）只写一处。每行含名称 + 简要说明 + tooltip + 状态反馈（写盘成功给 notice；关闭态明确写「不会发起更新检查」），关掉后后台连版本比对都不做 | 8576c55 + 本笔 |
| 2026-10-13 | 自动化与引擎的后台自动更新 | 新增 | `electron/features/auto-update-ipc.ts`（新板块，域 `autoUpdate`）、`runtime-ipc.ts`、`engine-ipc.ts`、`app-settings.ts`、`settings-automation/AutomationSettingsSection.tsx` | 桌面自动化（nuphus）、浏览器自动化（playwright-cli）、Mac 电脑操作（open-computer-use，仅 macOS）与 Codex 引擎四类各自一个自动更新开关，**默认开启**、持久化在 app-settings.json、互不影响；开启后主进程启动 20s + 每 6h 静默从国内镜像（npmmirror 优先）检查并更新，成功发系统通知；自动化卡片显示桌面/浏览器当前版本号。手动更新与后台更新**共用同一批函数**（`checkRuntimeUpdateRow`/`performRuntimeUpdate`/`performEngineUpdateFlow`） | e6fec1e |
| 2026-10-13 | 网页来源条挪进消息操作行 | 改动 | `MessageFooter.tsx`、`TurnWebSources.tsx`、`Status.tsx`、`04-cards-tools.css` | 用户令「跟下面这个在一行」：来源条从汇总卡内挪到回合末操作行（复制/分支/耗时/token/收藏）最右端，汇总卡回归纯文件卡；守卫 12g 19→20 条（3 处变异全抓）+ 验收 web-sources 4/4 复跑 | 2837023 |
| 2026-10-13 | 功能更新清单 = 发布数据源 | 流程 | `AGENTS.md`、`docs/FEATURE-LEDGER.md`（对所有 Agent 生效） | 每次功能新增/改动同轮在本文末尾追加六列条目（漏记 = 工作未完成）；发布日志 / Release Notes / whats-new 要点一律从本台账搬，不重翻 commit | 557f06a |
| 2026-10-12 | 汇总卡网页来源 · PPcode 同步 | 流程 | PPcode 仓（`PMZPZM0/PPcode`） | 网页来源条全套同步至 PPcode（守卫 12g / 验收项 web-sources / 副本棘轮 1911→1981 按实测），顺手解锁副本三笔存量红；原版 f6577f11（工具持久化+静默更新）留归属会话自同步 | c4d572a |
| 2026-10-12 | 本地 HTML/CSS → MP4 渲染通道 | 新增 | `electron/html-video.ts`、`html-video-ipc.ts`、`video_render_html` 工具、`scripts/render-html-video.cjs` | 零 ffmpeg：隐藏窗口 canvas + MediaRecorder（本引擎 runtime 原生支持 MP4/avc1）+ CDP 逐帧馈帧，本地 HTML 文件或 http(s) URL 渲成 MP4（默认落 `<userData>/renders/`）；模型经能力网关 `video_render_html` 可调，命令行 `scripts/render-html-video.cjs` 同引擎；守卫 21 十六条（6 处变异全抓） | 4d9f20c |
| 2026-10-12 | 壁纸星野：比例滑杆 + 拖动数字气泡 | 改动 | `WallpaperSettings.tsx`、`28-wallpaper.css`、`wallpaper.mjs` | 星野浓度用户可调（20~300%），滑杆拖动时浮出数字气泡（用户点名「别只看滑杆」）；密度实测提高约 20 倍 + 8% 亮星层次 | a5ece2c、d44ec8f |
| 2026-10-12 | 壁纸 3D 背景换「星野」（vanta 退役） | 改动 | `WallpaperLayer.tsx`、`wallpaper.mjs`、`28-wallpaper.css` | 黑夜→星空/白天→动态点、点间无连线（vanta 网状形态调不出，整体退役防复活）；自绘 canvas 零依赖，鼠标缓动视差 + 纵深系数 + 缓速自漂；旧值 `vanta` 自动迁移；守卫 14-wallpaper 37 条 | 03cd0a7 |
| 2026-10-12 | 壁纸主题色完全适配 | 修复 | `WallpaperLayer.tsx`、`28-wallpaper.css` | 3D/自定义图/粒子档未跟随主题色：vanta 深色降亮降密、自定义图与精选渐变的雾按主题分档（深 82→54% / 浅 46→18%）、粒子接上 `useThemeColor`（原切主题不换色） | c23fbf0 |
| 2026-10-12 | 550C 开机动画 | 新增 | `src/features/settings-appearance/boot550c/`、`src/lib/boot-intro.mjs`、`36-boot-550c.css`、外观设置 | 移植 DSH 插件 dsh-550c-boot（MIT）：完整 16 秒/简易 4 秒/关三档 × 琥珀/绿/青/白四配色，外观页一行可切换+预览；Shadow DOM + portal body + useLayoutEffect（防闪主帧）；`?popout=` / `?pet=1` / 减弱动效不播；守卫 20 共 34 条 + 验收 boot-intro 八条 | b072389、7a8d706 |
| 2026-10-13 | 技能自动更新 + 移除技能更新卡片 | 新增 | `electron/features/skills-ipc.ts`、`src/features/settings-skills/SkillsCenterSection.tsx`、`app-settings.ts` | 设置→技能中心新增「技能自动更新」开关（默认关）：开启后主进程启动 15s 后 + 每 6 小时静默检查市场技能内容变化并自动更新（判据/更新链路与手动完全同一套，含安全检查；防重入、单技能失败跳过）。**移除技能页的「技能更新」大卡片**（占界面过大）；插件页/官方插件页的更新面板保留不动 | 5b803ff |
| 2026-10-13 | 汇总消息右下角网页来源 | 新增 | `src/features/status/Status.tsx`、`TurnWebSources.tsx`、`src/lib/turn-web-sources.mjs` | 回合完成后在状态卡右下角显示本轮引用的网页来源（favicon 条，悬停看标题/链接），从回合事件流提取域名去重 | 6b098cb |
| 2026-10-13 | 开发工具持久化 | 修复 | `electron/features/tool-persistence.ts`、`dev-runtimes.ts`、`runtime-ipc.ts` | 修复「应用更新后手动安装的非内置工具（git/ffmpeg 等）全部丢失」：安装/卸载记账到 `<userData>/installed-tools.json`（原子写、只记非内置项、退出码 0 才记） | 2f757e7 |
| 2026-10-13 | 更新后台静默下载 + 重启安装 | 新增 | `electron/features/updates-ipc.ts`、`UpdateReadyToast.tsx`、`01-sidebar-shell.tsx` | 发新版后启动 8s 自动静默检查下载（sha256 校验），下好左下角弹「更新已就绪」（取消=延后 / 重启安装=先 spawn 安装包再退自己）；手动检查更新发现已下好的包同样弹窗 | 2f757e7 |
| 2026-10-13 | 改动备份（数据管理板块） | 新增 | `electron/features/change-backup.ts`、`change-backup-ipc.ts`、`ChangeBackupSection.tsx` | 与 WorkBuddy 同构的回合级改动备份：开关（默认关）+ 可自定义目录；每回合结束落 changes-index + changes-detail；**3GB 上限**超了按会话移入系统回收站（先明细后索引，失败保留不硬删）；含 agent 工具面 4 通道（list-all / read-change / restore-file / prune） | 8cafc37 |
| 2026-10-13 | 免费网关本体随包内置 | 改动 | `scripts/prepare-{windows,mac}-tools.cjs`、`electron/features/free-gateway-ipc.ts` | 免费网关本体不再运行时下载，随安装包内置（CI 打包阶段随 extraResources 落盘） | 35b0626 |
| 2026-10-13 | 默认工作方式 = Ponytail | 流程 | `AGENTS.md`（对项目内所有 AI 助手生效） | 决策阶梯（存在吗→本仓已有→标准库→平台原生→已装依赖→一行→才写）；修 bug 修根因；4 条不许省的例外；细则全文在 AGENTS.md 同名段 | d122703 |
| 2026-10-13 | 仓库收敛：PPcode/云助手单仓公开化 | 基建 | 三仓 GitHub | `ppcode-src` 并入 `PMZPZM0/PPcode`（源码+发布一仓）后删除；`codex-harness-cloud-src` 转公开并改回自有更新源（自发布不再要跨仓 PAT）；私有仓 Actions 分钟耗尽曾致 CI 秒失败（runner 未分配、步骤数 0），公开仓免费分钟是根因修复 | - |
| 2026-10-12 | 桌面版 v0.0.41 发布 | 基建 | `codex-harness-desktop` | 内容见 `docs/releases/v0.0.41.md`：语音播报三连修（停止真停/每回合限长/状态条重做）、工具链在线更新、自动化通道修正、引擎 0.162.1、移除自动接手。0.0.40 空壳 Release 保留未动 | 8be15d9 |
| 2026-10-12 | 语音播报三连修 | 修复 | 语音板块（`11z-voice-call` 域） | 停止真停（不再播完半句）、每回合限长（超长截断）、状态条重做；同步 PPcode / 云助手 | 44fee6a |
| 2026-10-12 | 引擎升级 0.162.1 | 改动 | 引擎启动链 | npm 声明与实际二进制对齐，防重装被回退旧引擎 | 8be15d9 |
| 2026-10-12 | 移除「自动接手」 | 移除 | 回合收尾链 | 宿主侧自动续跑误判正常收尾的长报告（凭空多发一轮），按用户决定彻底删除，只留提示词层回合连续性规则 | 8be15d9 |
