# AGENTS.md — Codex Harness Desktop 项目环境速览

本文件供 Codex 引擎读取：进到本项目（源码 / 本机运行环境）先读这里。**常驻只放每轮都要用的规则**；查阅型细则已外置到 `docs/AGENTS-DETAILS.md`，按当前任务只读相关章节（⛔ 不要整份读）。

> ⛔⛔ **两个活跃仓都是纯本地构建 —— 搞错生效方式 = 白干一轮（2026-10-16 用户令；2026-11-19 云助手下线后收敛为两仓）**
>
> | 仓 | 改动怎么生效 | ⛔ 禁忌 |
> |---|---|---|
> | 桌面版 `D://Codex Harness Desktop`（主仓） | **纯本地构建**：`electron/**` → `npm run build:electron`（**必须重启应用**才生效）；`src/**` → `npm run build:vite`（`npm run dev` 下 vite 热更，刷新即可） | ⛔ **没有服务器、没有部署这一说** |
> | PPcode `D://PPcode` | **纯本地构建**（同主仓；本仓 = 源码 + 发布页合一） | ⛔ 同上 |
> | ~~云助手 `D://Codex Assistant`~~ | **已下线（2026-11-19）**：只保留 GitHub 源码仓 `PMZPZM0/codex-harness-cloud-src` 归档 | ⛔ 不再同步 / 构建 / 部署 / 发版 / 推送 |
>
> ⇒ 动手前**先确认症状出现在哪个仓、那仓的产物怎么生效**，再决定改哪里、拿什么当判据。

## 怎么读（30 秒版）

| 你要做什么 | 读哪里 |
|---|---|
| 确认改哪个仓、怎么生效 | 上面那张表 |
| 提交前的硬红线 | 🔒 敏感信息红线（本文件） |
| 多仓同步 / 发版细节 | `docs/REPO-WORKFLOW.md`；长文 `docs/AGENTS-DETAILS.md` §多仓协作 |
| 改代码前判断放哪一层 | 📐 功能板块（本文件）+ `docs/MODULES.md` |
| 改完怎么算合格 | ⛔ 验收铁律 + 🧹 交付卫生 |
| 改某个功能前的不变量 | 🔑 不变量速查 → `docs/AGENTS-DETAILS.md` §现行不变量速查 |
| 查功能是哪一轮加的 / 历史流水 | `docs/CHANGELOG-INDEX.md`、`logs/` |
| 工具链 / 安装 / 引擎能力 / 默认值 / UI 速览 | `docs/AGENTS-DETAILS.md` 同名章节；能力细则 `docs/TOOLS-AND-CAPABILITIES.md` |

## 🔒 敏感信息红线（2026-11-07 用户令，硬性，无例外）

⛔⛔ **禁止把下列内容写进任何仓库、提交、推送或 GitHub 可见内容**（含源码/文档/注释/脚本/截图/commit message/Release Notes/Issue/PR 正文）：

⛔ 同样禁止出现在 AI 的对话回复、工作日志、探针/调试产物与临时文件里：只准报占位符、命中文件数或路径，**不准回显真实值**。用户已明确零容忍，违反一次即视为严重事故，不是「下次注意」。

1. 服务器公网 IP、内网 IP、主机名与云厂商实例标识；
2. SSH 端口、SSH 登录别名与「别名 → 真实地址:端口」的映射；
3. 开发机（本机）出口 IP；
4. IPv6 前缀 / IPv6 地址；
5. 私钥内容、口令、令牌、Cookie。

写运维/交接说明时**一律用占位符**：`<服务器地址>`、`<SSH 端口>`、`<出口 IP>`、`<IPv6 前缀>`；真实值只放在本机私密文件（如 `~/.ssh/config`、密码管理器）或服务器侧配置里，⛔ 不进 git、不进文档、不进截图。

提交前必查（命中任何一条就先删再提交；除 staged diff 外，还要查 `git status --short` 里的未跟踪文件；两仓同步时逐仓各查一次）：
```bash
git diff --cached | grep -nE "([0-9]{1,3}\.){3}[0-9]{1,3}|[0-9a-f]{1,4}(:[0-9a-f]{0,4}){2,}|ssh -p |端口[:：]?[0-9]{2,5}|BEGIN .*PRIVATE KEY"
```
⛔ **误提交 = 已泄露**：删文件/改文档**不算修好**（历史与 GitHub 缓存仍可查），必须同轮①改掉当前文件、②**轮换凭据**（SSH 密钥、面板口令、防火墙白名单），③再评估历史清理（`git filter-repo` + 强推是破坏性操作，需用户点头）。

## 🔁 多仓协作与发版（硬性，无例外）

⛔⛔ **改动必须同轮同步两个仓**（桌面版主仓 + PPcode）：任一仓完成一轮功能改动后，必须在同一轮把同一批改动同步到另一仓，并各自推送 `origin main`；**只改一仓就收尾 = 这一轮未完成**。云助手已下线，⛔ 不进同步面。

- 同步流程：主仓 diff → **逐文件 `git apply --check` 预检**（⛔ 不整包瞎 apply）→ apply → 副本侧 `npm run build` + 受影响守卫 + `check-preflight` → `feat(sync)` 提交（写明主仓区间与判据）。
- **`logs/` 结论档案进同步面**：条目文件与 `logs/index.jsonl` 都要跟；补录后各仓跑 `node scripts/logs.mjs reindex`（sha256 与文件字节绑定，直接拷索引会哈希不符）。
- **`android/` 只在主仓**，⛔ 不进同步面。
- **补丁更新 = NSIS 差分**：Release 同时发完整包 + `*.exe.blockmap` + `latest.yml`；缺 blockmap / 失败自动回退完整包。⛔ 不自制覆盖补丁、不直接改安装目录、不从非 GitHub 仓拉可执行文件。
- **镜像固定顺序**：`gh-proxy.com → ghfast.top → GitHub 直连`（`electron/gh-mirror.ts` 单一真相源）；exe / blockmap / latest.yml 同一候选序；补丁资产请求⛔不带令牌。
- **各自 Release 专用**：桌面版 tag `v*`、资产 `Codex.Harness.Desktop-*`；PPcode 用自己仓的 Release。⛔ 永不使用 `/releases/latest`；⛔ 不跨仓复用安装包 / blockmap / latest.yml；旧版 blockmap 必须保留。
- **生成物各仓自己生成**：`electron/preload.ts`、`src/vite-env.d.ts`、`electron/composition.gen.ts`、`electron/builtin-skills/14-skill-harness-api.ts` 跑 `npm run gen:ipc` + `npm run gen:domains`；`ipc-channels.manifest.json` 与 `ipc-registry.ts` 是手写源，分叉处手工合并；棘轮（【265】）按各仓实测值。
- ⛔⛔ **品牌不进同步面**：桌面版 = **Codex Harness Desktop** + CH 图标；PPcode = **PPcode** + PP 图标（`BRAND_NAME = "PPcode"`、窗口标题、AUMID `com.ppcode.desktop`、身份基线自称 PPcode）。⛔ 不互拷 icon / build/icon* / 品牌文案；diff 碰到品牌行必须保留 PPcode 侧。守卫 06【235】钉住。

> 完整命令与发版步骤：`docs/REPO-WORKFLOW.md`；原长文：`docs/AGENTS-DETAILS.md` §多仓协作与发版。

## 📐 功能板块与接口规则

> 细则（板块清单 / 归属判据 / 新增 checklist / 四条接口面契约）→ `docs/MODULES.md`；架构状态 → `docs/PROJECT-PLANS.md`（「一切皆插件」尚未执行，内核/宿主绑定/安全边界不得插件化）。

| 板块 | 目录 | 备注 |
|---|---|---|
| 会话与回合 | `src/features/app-state/`、`electron/main/` | 事件归约、回合容器、折叠 |
| 设置页 | `src/features/settings-*`、`electron/features/*-ipc.ts` | 注册表一行一页（【101】） |
| 技能 | `electron/builtin-skills*`、`electron/skill-packs-*` | 三层索引 + 描述 ≤60 字 |
| 记忆 | `electron/memory-*.ts` | 落盘在 `codex-home/memory/`，注入有预算 |
| 工具面 | `electron/tool-profiles.ts` | 目录 + CORE + 岗位增量 + 回滚开关 |
| 调度 | `electron/features/delegation.ts`、`teams-ipc.ts` | 工具面在 thread/start 定死 |
| 浏览器/桌面自动化 | `electron/automation-policy.ts`、`mcp-gateway.ts` | 三通道优先级 + MCP 懒加载 |
| 图像/影音 | `electron/image-*`、`openfilm/`、`media-tools.ts`、`artcraft.ts` | 生图/剪辑各一套 IPC；含 **Craft 全家桶**（artcraft）与 PhotoCraft |

**四条接口面契约**：① 一个板块 = 一个域前缀；② IPC 桥走生成器（勿手改生成物）；③ 断言读递归聚合面；④ 新增能力同轮登记（`HOST_TOOL_CATALOG` / `skill-packs-catalog` / 守卫）。

## 🧹 交付卫生（2026-11-08 用户令，硬性，守卫组 14）

> 全文 `docs/ARCHITECTURE-RULES.md` §12。⛔ 用户原话：「AI 很容易漏掉这些，一定要记得人工复核」。

- **前端不许有孤儿**：新增 `src/` 文件必须同轮从 `src/main.tsx` 沿 import 可达；⛔ 不留 demo/playground/示例组件；板块出口没人 import ⇒ 改走出口或删掉。【291】
- **后端每条通道都要有消费者**：manifest ↔ preload ↔ 渲染层调用/主进程推送四方对账；没消费者 = 死路由，删或登记 `UNWIRED` 棘轮（只许缩）。删一条 = handler + manifest + registry + `gen:ipc` 四处一起删；危险动词（clear/delete/install/…）优先查。【292】
- **字体只许系统栈**：⛔ 不分发字体、不许远程 `@font-face`；商用字体进仓 = 侵权。要品牌字体 ⇒ 带 OFL/Apache woff2 + 白名单 + `THIRD_PARTY_NOTICES.md` 三件一起做。【293】
- **许可与漏洞**：直接依赖必须可商用（GPL/AGPL/SSPL/CC-BY-NC 零容忍）；发版前 `npm audit --omit=dev`，有补丁用 `overrides` 收掉。【294】
- **导出函数必须有中文注释（缺口恒 0）**：一句「干什么 / 边界 / 什么时候别用」，⛔ 不写套话、⛔ 不按函数名套模板批量生成（必须读函数体再写）；守卫 `BASELINE = 0`，不许改大。补法与两仓同步见 §12.6。【295】

## 🎨 视觉 / 浮层（改 UI 前必读）

- **改 UI 前先读根目录 `DESIGN.md`**（色板 / 字体 / 组件 / 主题机制，全部实测自 `src/styles/`）。三个真相源：`AGENTS.md` 管「怎么建」· `docs/ARCHITECTURE-RULES.md` 管「架构怎么划」· `DESIGN.md` 管「长什么样」。
- ⛔ 改 CSS 变量必须同步 `DESIGN.md` 变量表 —— 守卫【170】做真值对账。
- ⛔⛔ **加浮层前查 `DESIGN.md` 的「层叠层级带」**（守卫【198】）：主界面 <30 < 设置内 backdrop 80~97 < **画布 90** < 全局模态 400 < 轻浮层 1000/1001 < toast 9999+。四条硬规则：轻浮层必高于模态遮罩、全局模态必高于画布、**画布专属弹层只能画布内渲染（不许 portal 到 body）**、画布根 backdrop-filter 会创建 containing block。
- 设计方法 = `DESIGN.md` 的 `DESIGN-METHOD` 区 → 内置技能 `frontend-design`（`scripts/gen-design-skill.mjs` 生成，守卫 12at 比对新鲜度；改方法段后跑生成器）。

## ⛔ 临时产物放哪（硬性）

**任何中间产物 —— 命令回显、探针 dump、扫描输出、截图、临时脚本 —— 一律写进 `.workbuddy/tmp/`**；不许落仓库根目录，⛔ 更不许落 `D:\` 盘根（09-21 清理时盘根躺着 664 个这类文件 / 17.3 MB）。`.workbuddy/` 已 gitignore；一次性脚本与输出**跑完即删**（`.workbuddy/tmp` 是 1.4 GB 级堆积过的地方，中转站不是仓库）。收尾自查：`git status` 干净 + 盘根没有新产物。

## 📓 项目日志库 `logs/`（守卫【158】）

结论档案（一个结论一个文件 + 结构化头 + `index.jsonl` + sha256），规范 `logs/README.md`，工具 `scripts/logs.mjs`。

```bash
node scripts/logs.mjs new --kind decision --area memory --title "…" --tags a,b --files p1
node scripts/logs.mjs search <关键词...> [--area a] [--since d]
node scripts/logs.mjs show <唯一前缀即可>
node scripts/logs.mjs verify / dedupe / reindex
```

⛔ **该写**：定了方案 / 修了非显而易见 bug / 发版 / 改了用户可感知行为 / 推翻旧结论（`supersedes`）。**不该写**：纯格式、重命名、依赖升级。
⛔ **不许重复写**：同一段正文只存在一份；日报（`.workbuddy/memory/YYYY-MM-DD.md`）只留一行 `→ logs/<id>`。写入时自动拦相似标题（≥0.75）与相同正文。
⛔ 不丢失五保障：进 git、一条一目追加（改结论用 supersedes）、`verify` 抓篡改、索引可 `reindex`、删除先写墓碑。细则见 `docs/AGENTS-DETAILS.md` §项目日志库。

## 🧭 对话与信息准则（对项目内 AI 助手生效）

1. **信息边界**：不确定、无法查证的直接回「不知道」，禁止猜测编造。
2. **信息溯源**：数字/日期/价格/政策区分有无权威来源；没有就标注「需要自行核实」。
3. **语言**：通俗直白，摒弃空洞晦涩的词汇。
4. **结构**：先结论后理由，不做冗长铺垫。
5. **需求确认**：表述模糊先提问，不自行揣测作答。

## 🦓 默认工作方式 = Ponytail（10-13 用户指定，**默认生效**）

编码类任务默认走 `ponytail`（full）。**先读懂问题，再爬阶梯**（跳过理解直接甩小 diff 是危险的那种懒）：

1. 这东西需要存在吗？（YAGNI）→ 2. 本仓已有吗？复用 → 3. 标准库 → 4. 平台原生 → 5. 已装依赖 → 6. 能一行吗？→ 7. 到这才写最小可跑代码。

**修 bug = 修根因**：先 grep 要改函数的所有调用方，一处共享守卫优于每个调用方各加 diff。
**不做**：没人要的抽象、以后再说的脚手架。**能删就不加**；复杂需求先交懒版本并问一句「先这样够吗」。
**不许省**：信任边界校验、防数据丢失的错误处理、安全措施、可访问性基本项、用户明确要求的；以及「读懂问题」本身。非平凡逻辑留一个能跑的检查。
**输出纪律**：代码优先，其后至多三行说明。完整阶梯与反例见 `docs/AGENTS-DETAILS.md` §Ponytail。

## ⛔ 本文件有注入上限（守卫【172】）

引擎读 AGENTS.md 有字节上限（**官方默认仅 32768 字节**），超了**静默截断**（不报错）。本应用已在启动参数把 `project_doc_max_bytes` 抬到 **524288**（`electron/codex-server.ts`，守卫【172】校验值 > 本文件大小且留 2× 余量）。⛔ 引擎会从 cwd 向上拼接多级 AGENTS.md（项目级 + `codex-home` 全局），上限卡的是拼接总量 ⇒ **查阅型内容一律外置 `docs/`**，关键规则往文件前部放。自查：`wc -c AGENTS.md`。

## 🔑 不变量速查（改这些地方前必读）

> 14 条硬不变量的完整正文（会话滚动双占位、刻度尺波浪、文件卡汇总、压缩时序、停止链路、搜索范围、更新比较、记忆后端二选一、`electron/main/**` 零反向依赖、两个默认值同源、语音音色链、办公室像素场景、Codex 日志管理、云账号登录即用）→ `docs/AGENTS-DETAILS.md` §现行不变量速查。
> **改对应模块前先读那一节**（每条都有守卫钉着，改坏会红）；只改无关模块时不必读。

## ⛔ 验收铁律（硬性，2026-09-11 起）

**改动完成 = `npm run verify` 退出码 0**（= `npm run check` && `npm run e2e`）。禁止「我改完了，你自己点一下试试」。

| 层级 | 命令 | 覆盖 |
|---|---|---|
| ① 离线预检 | `npm run check` | 构建 + 产物新鲜度 + IPC 三件套一致性 + CSS 覆盖 + 纯函数断言 + 结构守卫 |
| ② 验收 | `npm run accept` | 拉起已构建应用，在持久 profile 跑本轮验收项；失败自动截图 |

纪律（完整版 `docs/AGENTS-DETAILS.md` §验收铁律）：
1. **默认只跑最新一轮**：`scripts/accept.mjs` 按 `ROUND_OF/LATEST_ROUND` 分区；`--all` 只在发版/跨模块/用户要求时。判据：这条断言会不会因本次改动变红。
2. **改了哪个模块就改对应验收项**；旧项不再对应直接删。⛔ 不新建场景目录。
3. **断言必须带前置条件**（先断「有这个前提」）。
4. **不做反证**；但**代码审查是收尾固定一环**（用 `dongming-code-review`，加载不到用 `xaction-code-review` 兜底并说明；审查对象是本轮全部提交）。
5. **能静态钉的别用 CDP**：重启/断网/并发类钉进 `scripts/check-preflight.mjs`。
6. **收尾必须跑 `npm run verify:runtime`**（真应用 + CDP：控制台 React 报错 / ErrorBoundary / `.app-shell` 渲染）；build 绿 + 守卫绿 ≠ 界面能跑。
7. **一次性脚本用完即删**；`scripts/guards/**`、`accept.mjs`、`verify-*.mjs` 是资产，不许删。

**审查自查**：改运行态开关要搜全仓引用点；只验「剔除」还要验「落地」；断言打到代码形态（`codeOnly()` 剥注释）；新断言做变异测试（改坏必须报 ✗）；问题当轮修掉再提交。

## 排查方法论（动手前先读）

1. 先问「**有几个东西在写同一份状态 / 同一根滚动条？**」根因多是多 owner 抢资源或状态错位消费，**阈值从来不是根因**。
2. 先打点再推理，打点带数字（top/gap/pad/err）。
3. 测试必须跑到事件真正结束；判据不用会随渲染变化的量（`textContent` 而非 `innerText`，会话用标题点而非行索引）。
4. 状态重置挂在「动作」上，不挂渲染分支。文档与代码同轮更新。
> 完整版（含六个反例）→ `docs/TESTING.md` 的「排查方法论」。

## 引擎自己怎么跑验收

验收会另拉一个隔离实例（`.e2e-profile/main`），不会和自己撞车：

```bash
resources/tools/node/node.exe scripts/accept.mjs [--list|--only <id>|--keep]
npm run accept   # 需要先构建
```

## 这是什么 / 内置能力

Electron 桌面应用，把 OpenAI Codex 引擎（app-server，stdio JSON-RPC）封装成工作台：多会话、插件/技能、自动化工具、连接器（MCP）、记忆。

> 内置能力 11 项 / 按需下载清单 / 每个 dynamicTool 的来源 → `docs/AGENTS-DETAILS.md` §内置能力与会话动态工具、§工具链清单、§安装操作；完整通道清单见内置技能 `harness-api`（生成物）。⛔ 判断「某工具能不能用」只认模型本轮工具列表（工具面按会话画像收窄，`electron/tool-profiles.ts`）。

## 工具链与安装（速查）

- **随包**：Node、VS Code CLI、Nuphus 桌面自动化、ponytail 安装源（默认不装）。⛔ npm-global 必须两条 extraResources 映射（根级 shim + `node_modules` 包体）。
- **按需下载**（开发工具页）：Ego Lite、FFmpeg、yt-dlp、Miniconda、MinGW、语音模型等；首次启动缺 Git 自动后台补装。
- ⛔ 写 `config.toml` 走 `config/value/write` 必带 `mergeStrategy: "replace"`（缺了被引擎拒、`.catch` 静默吞 ⇒ 开关点了没生效）。
- 细节（每个工具的安装方式 / 缺工具自助装）→ `docs/AGENTS-DETAILS.md` §工具链清单、§安装操作。

## 人工预览（给用户看）

`npm run preview:fresh`：全新临时实例（隔离数据目录，不碰真实配置），前台运行、关窗即结束。⛔ 必须用户在自己终端前台跑（agent 沙箱会回收进程树）；临时实例要摘 `ELECTRON_RUN_AS_NODE` / `NODE_OPTIONS` / `CODEBUDDY_SAFE_DELETE*`。

## 验证基建细节 → `docs/TESTING.md`

写新验收项 / 调试 e2e 时才读。三条常踩：E2E 靠 `CODEX_HARNESS_USER_DATA` + `CODEX_HARNESS_DEBUG_PORT`（⛔ 别写行号，用符号 grep）；测试实例工作区 = 项目根；宿主环境变量必须摘干净。现存验收项清单跑 `node scripts/accept.mjs --list`。

## 引擎初始化原则

初始化回归原生：不预写 marketplace、不首启自动种插件/技能；可下载的拓展一律按需安装（`runtime:install` 统一入口）；官方精选市场需 ChatGPT 登录（API Key 装不了），卡片放出来 + 中文提示兜底。

## 其他速查

- **能力可达性**：清单本体 = 内置技能 `harness-api`（`scripts/gen-capability-skill.mjs` 生成，加/改通道后跑 `npm run gen:ipc`，守卫【153】）。`developer-instructions.ts` 有常驻指针；打包版靠技能 + developer_instructions 读同一套方法。
- **两个跨进程默认值同源**（守卫【159】）：自动压缩比例 `0.6`、供应商最大并发 `10` —— 主进程与渲染层各一份字面量，改动必须同源；详见 `docs/AGENTS-DETAILS.md` §两个默认值。
- **UI 速览**：右栏四标签（变更/审阅/浏览器/文件）；浏览器自动化优先 Ego Lite TaskSpace，未装回落 browse-skills；详见 `docs/AGENTS-DETAILS.md` §应用 UI 速览。

## 近期功能性变更（索引）

> 全量流水（含每轮用户原话 → 改了什么 → 判据）→ `docs/CHANGELOG-INDEX.md`。⛔ 只增不回改：搬走的条目不再改写。

- 11-22 首轮上下文再瘦身（AGENTS 查阅型内容外置、resume 工具面回归画像、multi_agent_v1 关闭、技能索引只给名字+路径）
- 11-19 记忆金字塔删除 + 技能清单变索引 + 工具面按会话画像 + MCP 懒加载网关
- 11-19 `find_skills` 工具：实时扫盘检索本地技能
