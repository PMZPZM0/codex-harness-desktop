# AGENTS.md — Codex Harness Desktop 项目环境速览

本文件供 Codex 引擎读取：进到本项目（Codex Harness Desktop 桌面应用的源码 / 或本机运行环境）时，先读这里就知道「环境里有什么、缺什么怎么装、怎么调用」。保持简洁，详细手册见 `docs/TOOLCHAIN.md`（若存在）。

## ⛔ 验收铁律（硬性要求，2026-09-11 起生效，先读这条）

**本项目任何源码改动，一律以「自动验收通过」为完成标准。禁止「我改完了，你自己点一下试试」。**

改动完成 = 下面这条命令**退出码为 0**：

```bash
npm run verify     # 等价于 npm run check && npm run e2e
```

| 层级 | 命令 | 覆盖什么 | 失败意味什么 |
|---|---|---|---|
| ① 离线预检 | `npm run check` | 构建 + **产物新鲜度** + IPC 三件套一致性（main.ts handler ↔ preload 桥接 ↔ vite-env.d.ts 方法面）+ CSS 类覆盖告警 + **纯函数行为断言**（`src/lib/*.mjs`，node 直接 import 跑真实现）+ 结构守卫（零阻塞宿主 / 验收入口唯一化） | 改了没重建 / 桥接漏了类型 / 有死链 / 判定逻辑跑偏 / 架构约束被破 |
| ② 验收（**只有一条脚本**） | `npm run accept` | `scripts/accept.mjs`：拉起**已构建**应用，在**跨轮次复用的持久 profile**（`.e2e-profile/main`，首次把真实会话历史搬进来）上跑本轮验收项，失败自动截图到 `.e2e-artifacts/shots/` | 界面/行为真破了（看截图与逐项输出即知） |

纪律清单：

1. **⛔ 验收范围由流程保证：默认只跑「最新一轮」（2026-09-13 用户严令后**改写流程**，不再是"靠自觉加 --only"）**。
   用户原话：「能不能不要再跑旧的测试了，不要浪费我token啊…只能测试最新改动，给你说了几百遍」→
   「验收流程是死的嘛，你不会重新写嘛」。所以 `scripts/accept.mjs` 现在**按轮次分区**：
   - 每个验收项在文件顶部的 `ROUND_OF` 里登记轮次，`LATEST_ROUND` 指向当前轮；
   - **默认（不带参数）= 只跑 `LATEST_ROUND` 那一轮**；`--only <id>` 只跑指定项；`--all` 才是全量；
   - `--list` 会打印每项所属轮次；新增验收项**必须**登记轮次，否则默认跑不到且会打印警告。
   历史项不删（仍是回归证据），但**永远不会在默认路径上被执行** —— 单跑一次默认验收只有 4~5 项。
   **全量 `--all` 只在三种情况**：发版/里程碑前、跨模块改动无法界定范围、用户明确要求，且跑之前先说明理由。
   判断"本轮该跑什么"的原则：改渲染层交互/滚动 → 那几项渲染项；**改主进程/引擎/打包 → 不跑 accept**
   （CDP 断言测不到），改跑 `check` 并把可静态验证的部分补进预检守卫；纯文档/注释 → 只跑 `check`。
   判据：**这条断言会不会因为这次改动而变红** —— 不会就是纯浪费用户的时间和 token。
2. **改了哪个模块，就改 `scripts/accept.mjs` 里对应的验收项**（每一项是 `{ id, name, run(h) }`，可 `--only <id>` 单独跑）。旧的「一堆历史场景 + 增量哈希 runner」**已按用户要求删干净**（`scripts/e2e/run.mjs`、`scripts/e2e/scenarios/` 都没了，preflight【7】硬守卫不许它们回来）：那套东西改一处主进程源码就带出十几个历史场景、一轮十几分钟，人卡在等它跑完。**不要再新建场景目录**；本轮不再对应的旧验收项**直接删掉**，别攒着。
3. **断言必须带前置条件**（先断言「有这个前提」再做判断），否则上一步的残留状态会导致假通过。
4. **不做反证**（用户 2026-09-19 明令：「把你的反证流程删了，以后不需要再反证了」）：断言写完直接跑正式那轮。历史上"把修复改回去确认会红"的步骤**全部取消** —— 省下的时间用来覆盖更多真实场景，而不是反复往返。
   ⛔ **反证删除、审查保留**（用户同日明确：「code review 审查还是要保留的哈，这个太重要了」）：
   **代码审查（下条第 4 项）是收尾固定一环，与反证无关，不许一起删**。
5. **能用静态守卫的别用 CDP 跑**：要「重启应用 / 断网 / 换网段 / 并发多会话」才能复现的，钉进 `scripts/check-preflight.mjs`（如【10】【11】），改坏了 build 阶段就红，零运行成本。
6. **⛔ 每个功能/任务收尾都要跑一遍代码审查（用户 2026-09-17 明令：「每次做完一个功能或者完成一个任务，都用 code review 检查一遍」）**。
   用 `open-code-review` 技能（行级审查：精确选文件 → 分规则 → 逐文件审 + 覆盖账本 → 行号校验 → 按严重级出报告）。
   **审查对象是本轮 diff**（含未提交改动），**不是全仓库** —— 与验收同一条纪律，不做与本次改动无关的扫描。
   **发现的问题当轮修掉再提交**，不留成待办；**结论要能说出依据**（读了哪些文件、按什么判的），
   不能只说"看起来没问题"。改动极小时可走轻量路径（自检清单 + 四条硬约束）并说明为何轻量，
   但**不许因"改动小"跳过** —— 09-17 抓到的真 bug（`/icon.png` 在 file:// 下加载失败、
   「取消增强」取消完内容仍被覆盖、守卫被注释顶成假绿）全都出在"看起来只是小改"的地方。


### 排查方法论（09-13 一整天弯路换来的，下一轮动手前先读）

1. **看到症状先别调阈值、别加条件**。先问一句：「**现在有几个东西在写同一份状态 / 同一根滚动条？**」这一天 6 次修复的真根因全部是两类 —— ①**多个 owner 抢同一个东西**（钉顶与跟随每 60px 互拉、`switchJumpRef` 被两处消费）；②**状态被提前/错位消费**（裸布尔被下一次任意渲染吃掉）。**阈值从来不是根因**，调阈值只是把互拉挪到另一个区间。
2. **先打点，再推理**。`window.__adbg` 一次 dump 出的时间线胜过半小时的代码推演：这一天每次"我觉得是这个原因"都猜错，每次打点都一击命中（`pin-fix{err:-65}` ↔ `follow-grow{+65}` 互拉、`clear-anchor{at:"switch-jump"}` 出现在**发送**时刻、`pad:622` 残留、`follow-grow` 全程不触发）。**加打点是第一动作，不是最后手段**；打点要带数字（top/gap/pad/err），不要只写"到这里了"。
3. **测试必须跑到事件真正结束**（用户原话：「每次测试消息都不看完，你能发现什么bug，总是运行中就杀应用」）。长回合的毛病只在后段暴露；采样截断 + 收尾杀应用 = 把最关键的证据扔掉，还会把"没跑完"误报成失败。
4. **判据不能用会随渲染状态变化的量**：折叠组收起时 `innerText` 是空串、`textContent` 才与折叠无关；侧栏按最近活动重排，**会话要用标题点、不能用行索引**（用索引测出来的"钉顶没了"有一半是点开了别的会话 → 假红）。判据要落在**语义主体**上（"正在跑的那个回合"），不要用整页总量。
5. **状态重置要挂在「动作」上，不能挂在「某条渲染分支」上**。曾经把锚定状态清零写在"切会话瞬时定位"分支里，那段一旦被任何条件挡掉，清零就跟着被跳过 → 留白残留一整屏、锚点指向别的会话。现在清零挂在 `openThread` 里，结构上不可能被跳过。
6. **文档与代码同轮更新**。过时文档会主动误导下一轮（旧版 AGENTS.md 详细描述了已被删除的 `anchorHeightBaselineRef` 增长量模型与 `byUs` 判据，这一天的弯路有一部分就是照着它走的）。**删掉实现就把对应文档段落标记作废或改写**，别让后来者读到一段"看起来很像现状"的历史。
7. **⛔ 不跑与本次改动无关的断言（用户 09-13 严令，第二次强调）**。原话：「能不能不要再跑旧的测试了，不要浪费我token啊…只能测试最新改动，给你说了几百遍」。
   - 每轮改完只跑 **`--only <与改动相关的 id>`**；判据是「**这条断言会不会因为这次改动而变红**」，不会就别跑。
   - 全量 `accept.mjs` 只用于**发版前 / 跨模块改动 / 用户明确要求**，且跑之前先说明为什么必须全量。
   - 改主进程/引擎/打包这类 CDP 测不到的模块 → **不要跑 accept**，改跑 `check`，并把可静态验证的部分补进预检守卫（【10】【11】就是为此存在的）。
   - 曾经一整天每轮都全量跑 57 项，其中绝大多数与本轮改动无关 —— 纯浪费用户时间和 token，**这是行为准则层面的硬约束，不是建议**。
8. **⛔ 改动范围纪律：只做「架构层设计缺陷」和「渲染层真 bug」，不许顺手改行为（用户 09-13 明令）**。
   原话：「设计缺陷是只架构层，渲染层的bug，你别给我乱改」。
   - **两类可动**：① **架构层设计缺陷** —— IPC 契约与错误传播、真相源数量、事件通道与背压、持久化原子性与迁移、模块边界与守卫、生命周期状态机；② **渲染层真 bug** —— 有可复现路径、能说清"用户看到什么错"的。
   - **不许动**：行为语义、权限边界、可见交互（不经用户确认就"收紧/放开"）。**教训**：我自作主张把 `fs:write` 限定到工作区，用户不得不叫停并回退（`7f0de22`）—— 安全收紧也是**产品决策**，先问再做。
   - **重构不算修复**：除非要动的那段代码本身就是缺陷（例如"两个 owner 抢同一份状态"），否则不要为了"更干净"去改它。
   - 动之前先回答两句：**这是架构缺陷还是渲染 bug？**、**这个改动会不会改变用户看得见的行为？** 第二问为"是"就先问用户。
9. **⛔ 功能完整性铁律（09-15 用户明令：「加功能必须考虑得比我多，不能只做表面」）。**
   一个对象被创建/接力/归档/删除时，它的**全部衍生状态**必须有明确去向——成员会话、
   渲染缓存、映射表（threadProviderRef / team-threads / thread-runtime）、复用键、备份分支、
   侧栏列表。做法：把这次动作当**状态机迁移**，穷举它触碰的每一份持久化状态并逐一回答
   「它去哪」；只实现用户说的那一步 = 半成品。09-14~15 三起事故全是这一类：接力后旧会话
   还在、删主会话后成员成孤儿、统一 id 后 config 出现重复段。修 bug 时同样要问：
   **同类场景还有哪些没覆盖？旧的引用还在不在？清理动作要不要级联？**

10. **⛔ 探针方法论（09-16 发版当天踩出来的三条，省下的是错误结论而不只是时间）**：
   - **Node 的 `https.request` 不读 `HTTP(S)_PROXY` 环境变量**（只有 `curl` 之类会读）。所以「清掉代理变量
     再直连」对 Node 探针**等于没清**，而直连 GitHub 在国内时通时不通 ⇒ 同一脚本这次 533KB、下次 0 字节，
     判据随机。**凡是测网络行为的断言，要么用本地 mock，要么走 curl。**
   - **外网不可当判据**：`downloadUpdate` 那类「跟随重定向」的行为，用真 GitHub 验证会被 ECONNRESET /
     0 字节干扰（还容易被误读成代码有问题）。**正解 = 本地 HTTPS mock**：openssl 自签证书（`-subj /CN=127.0.0.1`
     且 `-addext subjectAltName=IP:127.0.0.1`，否则 Node 不认）× `https.createServer` 一个
     `/redirect → 302 → /payload → 200`，进程内 `NODE_TLS_REJECT_UNAUTHORIZED=0` 放行自签。
     确定性判据 = **下载字节数 + 载荷 sha256 与源一致**；反证 = 摘掉重定向分支 → 必然报 `HTTP 302`。
   - **`(cond ? ok : fail)("消息")` 不能写成 `cond ? ok : fail("消息")`**：后者在 `cond` 为真时**根本不调用 `ok`**，
     于是该断言**一行都不打印、静默漏检**（我这两条新守卫第一版就是这样，预检 526 条"全绿"却查不到它们）。
     写完新守卫先确认**它在输出里出现了**。：临时 profile 每轮都是白纸 —— 侧栏零会话，「切会话重播 / 首轮不出字 / 会话一多互相拖慢」这类问题**只在有历史时才现形**，空目录里测等于没测（用户原话：「为啥你每次拉起来的应用都没有历史记录，那测试有什么意义呢」）。现在首次建 profile 时会把**真实 profile 的会话历史**（`codex-home/sessions/**`）搬进来，之后一轮轮叠加；断言「本轮数据」时用 `h._rolloutFiles({ since: h.launchedAt })`，别让历史文件把断言顶成假绿。profile 在 `.e2e-profile/<name>/`（已 gitignore，含真实对话内容与 Key 密文，**绝不入库**）；想重来就删目录，想重灌真实配置/历史用 `CODEX_HARNESS_RESEED=1`。

GUI 起不来时，最低限度跑 `check`（离线可用），并在提交信息里写明 `accept` 未跑的原因。手册见 `docs/TESTING.md`。

### 引擎自己怎么跑验收（已实测）

引擎跑在应用体内，而 `accept` 会**再拉起一个隔离实例**——不会和自己撞车。实测依据：单实例锁按 `userData` 隔离，验收用 `.e2e-profile/main`，两实例完全独立并存。

```bash
resources/tools/node/node.exe scripts/accept.mjs              # 跑本轮全部验收项（约 20s）
resources/tools/node/node.exe scripts/accept.mjs --list        # 列出验收项
resources/tools/node/node.exe scripts/accept.mjs --only greet  # 只跑 id 含 greet 的项
resources/tools/node/node.exe scripts/accept.mjs --keep        # 跑完不关应用，留着手动看
```

`npm run accept` / `npm run e2e`（同一条）亦可，前提是 PATH 里有 node。**验收跑的是 `dist/` + `dist-electron/` 产物，必须先构建**——`check` 已含构建。

## 这是什么

一个 Electron 桌面应用，把 OpenAI Codex 引擎（`@openai/codex` app-server，stdio JSON-RPC）封装成可用的桌面工作台：多会话、插件/技能、自动化工具、连接器（MCP）、记忆分层。

## 内置能力（引擎可直接用，无需额外安装）

| 能力 | 入口 | 说明 |
|---|---|---|
| 引擎本体 | `app-server --listen stdio://` | 会话、工具、插件、钩子、技能全部走它 |
| 基础运行时 | `resources/tools/{node,python,git,pwsh,vscode-cli,rg,uv,cmake,ninja,sevenzip,jq}` | 开发机本地保留；**打包后仅 node/vscode-cli 内置**，其余开发工具页按需下载（缺 Git 启动自动补装） |
| 桌面自动化 MCP | `tools/npm-global` 里的 `nuphus`（MCP 服务器名） | 需先装「自动化工具包」，工具前缀 `desktop_*` / `browser_*` |
| 浏览器自动化 CLI | `tools/npm-global/playwright-cli` | 需先装「自动化工具包」，首次 open 会提示装内核 |
| 指纹浏览器 | `require("cloakbrowser")` / `tools/npm-global/cloakbrowser` | 需先装「自动化工具包」+「Cloak 内核」 |
| 内置技能 | `codex-home/skills/` 的 `desktop-automation`、`browser-skill` | 随应用写入，引导引擎调自动化工具；旧 `browser-automation` 已退役（升级时按指纹自动清理，用户改过的目录不碰） |

## 会话动态工具（thread/start 已注册，可直接调用）

| 工具 | 用途 |
|---|---|
| memory_recall / memory_save | 查询/保存分层记忆（用户偏好/项目背景/工作流/任务经验）；发送前应用会自动注入相关记忆 |
| generate_image / describe_image | 生图与视觉识图（需在 设置→插件→内置插件 配置，未配置时调用会返回指引） |
| rpa_save / rpa_run | 保存自动化流程为 RPA 配方 / 列出并执行已存配方（逐步复现） |
| task_add / task_update | 维护用户任务清单（新增/改状态/列出/删除） |
| agent_ask | 向用户展示选项卡等待选择（第一项为推荐），用于关键决策确认 |

## 工具链清单

**随包内置（离线可用，勿重复下载）**：Node（安装器引导）、VS Code CLI、**Nuphus 桌面自动化 + Playwright 浏览器自动化 CLI**（`tools/npm-global` 预解压，≈48MB 原始；09-16 起 **CloakBrowser 已从包里剥离**，extraResources `filter` / `pack-automation.cjs` / mac `copy-mac-tools.cjs` 三处同源排除。⛔ **必须两条 extraResources 映射**：`from=resources/tools/npm-global`（根级 shim）+ `from=resources/tools/npm-global/node_modules`（包体本身）——electron-builder 会**无条件丢弃 `from` 根级的 `node_modules`**，只写一条映射的话包里只剩 shim、包体全无）、**ponytail 插件源**（`tools/ponytail-plugin` 1.6MB）。其余（Python/Git/PowerShell/rg/uv/CMake/Ninja/7-Zip/jq）09-16 起不随包，走「开发工具」页按需下载；**首次启动检测到缺 Git 会自动后台补装**（`autoInstallGitIfNeeded`：仅 Windows、与手动安装互斥、装完 `restartServerWhenIdle` 刷新引擎、失败广播 done 事件不悬挂安装态，下次启动仍缺会再试）。**ponytail 首启自动种**（见【26】）：`config.toml` 里**没有** `ponytail@ponytail` 段时才动手，卸载过（段在、enabled=false）永不重装。

**按需安装（应用内「开发工具」页 或 手动）**：

| 工具 | 大小 | 安装方式 | 装完效果 |
|---|---|---|---|
| Nuphus 桌面自动化 | 随包 30MB | **随包直出**，卡片显示「内置」；目录损坏时点「修复安装」（重新解压 zip 到 `tools/npm-global/` + 激活联动开关 + 引擎重启） | nuphus MCP 注册 35+ 桌面工具（经 nuphus-call 按需调用） |
| Playwright 浏览器自动化（CLI） | 随包 18MB | 同上（随包直出 / 可修复安装） | playwright-cli 可用（**默认浏览器通道**） |
| CloakBrowser 指纹浏览器（npm 包） | ~4MB | 开发工具页「下载」（`runNpmInstall`：内置 node 自带 npm + registry.npmmirror.com，失败回落官方源；用户自设 registry 时不覆盖） | `CLOAKBROWSER_ENTRY` 生效，可过 Cloudflare/reCAPTCHA；**不装不影响日常浏览**（默认走内置浏览器视图 + playwright-cli） |
| Playwright 浏览器内核 | ~170MB | 开发工具页「下载」（需先有 Playwright CLI） | playwright-cli 首次 open 不再提示缺内核 |
| Cloak 指纹浏览器内核 | ~200MB | 开发工具页「下载」（需先装 CloakBrowser npm 包） | cloakbrowser 可开反检测窗口 |
| ponytail 写代码模式插件 | 随包 2MB | **首启自动种入**（cache + 注册段 + 钩子信任），无需点安装；按钮分支仅作修复用 | 会话钩子 + 6 个 ponytail-* 技能 |
| FFmpeg / yt-dlp / Miniconda / MinGW | 各 20~300MB | 开发工具页「下载」（联网） | 对应命令可用 |
| Docker Desktop / OpenSSL | — | 系统级安装（开发工具页打开官网） | 系统命令 |
| 语音模型（sherpa-onnx 三件套，识别+端点检测+合成） | 总 ~270MB | 开发工具页「下载模型」或「本地导入」（开发版专用：识别 4 种常见目录布局，SHA256 校验后落盘到 `<userData>/voice-models/`） | **生产构建不打包**——`package.json` 的 `asarUnpack` 只解 `sherpa-onnx-*/**`（原生 addon），模型数据走 userData 按需下载 |

## 安装操作（引擎缺工具时怎么自助装）

1. **优先看 `tools/` 目录**：`resources/tools/npm-global` 存在 = 自动化工具已装；`tools/{node,python,git,...}` 存在 = 基础运行时已装。
2. **缺 Nuphus / Playwright CLI（随包内置能力缺失）**：调用应用内 `runtime:install`（id=`nuphus` / `playwright-cli`，从随包 zip 修复解压），或手动：
   - 解压随包 `tools/automation-tools.zip` 到 `tools/`（内置 python：`python -c "import zipfile; zipfile.ZipFile('automation-tools.zip').extractall('tools')"`），结果得到 `tools/npm-global/`。
   - 重启引擎（或重选一次供应商触发 `applyCustomModel`）→ nuphus MCP 段写入 config.toml。
3. **缺 CloakBrowser npm 包**：`runtime:install`（id=`cloakbrowser`，走 npmmirror npm 源）。
4. **缺 Playwright / Cloak 内核**：`runtime:install`（id=`playwright-browsers` / `cloak-browsers`），会分别调 `playwright install chromium` 与 `cloakbrowser install`（后者需先装 CloakBrowser 包）。
5. **缺 ponytail 插件**：正常情况**不用管**（首启自动种）；真要重种：`runtime:install`（id=`ponytail`），随包安装源 `tools/ponytail-plugin` 种到 `codex-home/plugins/cache` + 写 `[marketplaces.ponytail]` / `[plugins."ponytail@ponytail"]` / 钩子信任。
6. **装完统一**：重启引擎生效；插件/技能/钩子状态从 `plugin/list`、`skills/list`、`hooks/list` 读。
7. ⛔ **写 config.toml 的键值走 `config/value/write` 时必带 `mergeStrategy: "replace"`**（引擎必填；缺了整条请求被拒 `Invalid request: missing field mergeStrategy`，而这些调用普遍 `.catch(() => undefined)` 静默吞掉 → 表现成「开关点了没生效」）。预检【26】有结构守卫：每处调用 600 字符内必须出现该字段。09-16 实测：ponytail 卸载/装回的 enabled 写入漏了它，长期没生效。

## 人工预览（给用户看 / 自己看）

- `npm run preview:fresh`：拉起一个**全新临时实例**（隔离数据目录 ⇒ 未登录 + 未配模型 + 无历史，不碰真实配置与历史），用来人工确认首启引导、空态与布局观感。**前台运行**，关窗即结束。
  ⛔ 必须在用户自己的终端前台跑：agent 沙箱里命令结束会回收整棵进程树（detached spawn / 系统级启动 / 常驻后台任务三种写法全部实测失败），**窗口活不过命令**。
  ⛔ 临时实例的宿主环境变量必须摘：`ELECTRON_RUN_AS_NODE`（不摘 = 启动即崩）、`NODE_OPTIONS`（不摘 = 窗口能开但功能全哑）、`CODEBUDDY_SAFE_DELETE*`。
- 改了 UI 要「让用户亲眼看」时：先 `npm run build`，再让用户跑这条命令；或自己用 e2e harness 起实例截图给对方（截图前记得关掉挡屏的引导弹窗与展开的下拉菜单）。

## 验证基建实现细节（配合开头的「验收铁律」看）

- **E2E 靠主进程自带开关实现**：`CODEX_HARNESS_USER_DATA`（重定向 userData，完全隔离）+ `CODEX_HARNESS_DEBUG_PORT`（开 CDP 端口，端口随机取空闲）——见 `electron/main.ts:60` / `:65`。框架 `scripts/e2e/lib/harness.mjs` 零新依赖（复用 `ws`），**不要引入 Playwright/Puppeteer**。
- **测试实例的工作区 = 项目根目录**（09-11 用户定：以后拉 CDP 就用这个项目地址测）：应用从 `localStorage.workspace` 读工作区（`App.tsx:5972`），而隔离 profile 是白纸 → 界面停在「尚未选择工作区」，部分路径下发送会被拦。harness 现在默认用 `Page.addScriptToEvaluateOnNewDocument` 把 `workspace` 注入成 `this.root`（项目根）**并重载一次**让注入先于页面脚本执行；需要「未选择工作区」空态的场景可传 `new ElectronHarness({ workspace: null })` 关掉。
- **离线预检**：`npm run check` = `build` + `scripts/check-preflight.mjs`。其中 IPC「方法面」解析用自写的括号深度扫描器（纯正则会被「同一行写多个方法 `a: …,  b: …`」和「类型里的 `name(...)` 括号被吃掉后参数名被误当方法名」骗到）。
- **现存场景**：`smoke` 覆盖引导页 → 主界面骨架（`.topbar`/`aside.sidebar`/`main.workspace`/`.composer-editor`/`.send-button`）→ 侧栏六项 → 输入框读写 → `#` 技能面板 → `/` 命令面板 → 技能中心开关 → 右栏展开 → 设置弹窗开关 + 焦点归还 → 渲染层无 console.error。`model-scope` 覆盖**每个会话独立选模型**（真起引擎真建 **两个**会话，灌真实配置且**保留 Key**，共 60 断言）：③ 有记录 → 不被全局冲掉、且不改写全局默认；④ 没记录 → 落全局默认；⑤ 打开 B 不动 A；⑥ 欢迎页改全局默认 → 只动全局、两个会话都不动；⑦ **真发消息**后读 rollout —— `turn_context.model` 证明 A 跑 deepseek、B 跑 glm（会话独立），`token_usage_record.response_id` 证明**两轮都是真实后端回包**（实测 output=159 / 3 tokens）；⑦bis 同一会话里换下拉 → 下一轮**立刻**跑新模型，且 `custom-model.json` + `config.toml` 顶层同步；⑦ter 打开另一个会话 → 档案对齐该会话的模型。**引导页可能被跳过**：真实 Key 灌进去后 `customModel.hasKey=true`，`App.tsx:7754` 的兼容 effect 会自动进入主界面（写 `login-skipped`），所以步骤① 是「引导页或主界面二选一」，不能硬等跳过按钮。
- **环境坑（踩过）**：①环境里的 `HTTP_PROXY` 会把回环请求也代理走 → harness 已自动注入 `NO_PROXY=127.0.0.1,localhost`；②`ws` 库的 `on("message", (data) => …)` 首参是**原始数据**不是 `MessageEvent`；③`clickByText` 必须取**最内层**元素（按 innerText 长度升序），否则点到 wrapper 上；④`contenteditable` 用 CDP `Input.insertText` 输入，`[contenteditable="true"]` 匹配不到 `plaintext-only`；⑤**宿主带着 `ELECTRON_RUN_AS_NODE` 时 Electron 会被降级成纯 node 跑主进程**（启动即崩 `Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')`，栈尾打 `Node.js vXX`）→ harness 在 spawn 前 `delete` 掉这个变量；⑥**引擎的 rollout 是首回合才落盘的**：只 `thread/start` 的会话 `thread/resume` 报 `no rollout found`、`thread/list` 里也不出现 → 想造「能 resume 的会话」必须补一发 `turn/start`（模型调用失败无妨，rollout 已落盘）；⑦宿主还会注入 `NODE_OPTIONS=--require …node-language-shim.cjs`（拦截子进程 fs 写入）——继承下去会让主进程写 userData 时 `EPERM`、启动链断掉（**窗口能开、引擎不 spawn、发消息零回复**）→ harness 也一并 `delete` 掉 `NODE_OPTIONS`（与 ⑤ 同源：都是宿主环境泄漏）；⑧**无 GPU 的机器 / CI 上 Chromium 的 GPU 子进程会反复起不来并最终 FATAL 自杀**（`GPU process isn't usable. Goodbye.`），表现为 e2e「CDP Runtime.enable 超时 / Target crashed」——实测连零项目代码的最小 Electron 应用也一样崩，**与本项目代码无关**；harness 已带 `CODEX_HARNESS_IN_PROCESS_GPU`（主进程据此 `appendSwitch("in-process-gpu")`，另附 `no-sandbox` 等，**仅测试实例生效**）绕开。
- **历史遗留**：`verify:turnfold`/`verify:userrefs`/`verify:memory-layers` 等一批 npm script 指向的文件早已删除（跑必 ENOENT），**09-11 已从 package.json 清理**；现存真脚本只有 `verify:reasoning` / `verify:image-plugin` / `verify:packaged-tools`。新增验证请走 e2e 场景或 preflight 检查项，**别再散落一次性 `.mjs`**。
- 手册见 `docs/TESTING.md`。

## 引擎初始化原则（2026-09 定）

- **初始化回归原生**：不预写 marketplace 段、不首启自动种插件/技能。
- **一切可下载的拓展都按需安装**（自动化包、浏览器内核、ponytail、ffmpeg 等），`runtime:install` 统一入口。
- 官方精选市场（`openai-api-curated`）需 ChatGPT 账号登录才能装，API Key 方式装不了——插件页已隐藏，不要尝试 `plugin/install` 该市场。

## 应用 UI 速览（引擎了解宿主能力用）

- **内置浏览器在右侧面板**（不在中央主区，聊天不受影响）：右栏「浏览器」标签 = Electron `<webview>`（宿主窗口 `webPreferences.webviewTag: true`），guest 与宿主隔离、无 node API。组件 `src/components/BrowserPane.tsx`（`variant="panel"` 适配右栏宽度）。右栏四个标签（变更/终端/浏览器/项目树）常驻直达，无「打开标签页」选择器。标题栏行高 44px 与 titleBarOverlay 原生窗口钮对齐。
- **指纹内核（cloak-browsers）仅用于自动化场景**（模型经 `cloakbrowser` CLI 调用）；浏览器视图的「隐身浏览」按钮为预留位，尚未接入 CDP 嵌入。

## 近期功能性变更（宿主行为，引擎交互相关）
- **⛔ 自动化能力「接线」：提示词改为首选已注册的 `browser_*` MCP 工具（09-20，改完直接生效）**：
  盘点发现一个纯接线问题 —— 包内 nuphus MCP **早已注册 38 个工具**（桌面 15 + 浏览器 23，实测枚举），
  但 `builtin-skills.ts` 的技能正文里 `playwright-cli` 出现 **23 次**、`browser_*` **0 次** ⇒
  24 个工具的 schema 白占约 10k token 前缀，模型却每步起一次 CLI 进程（还有两套不共享的浏览器会话）。
  - **现在的优先级**：① `browser_*` MCP（判据是「工具列表里有没有 `browser_navigate`」——
    nuphus 随**桌面**总闸注册，写死通道会让模型去调不存在的工具）；② `playwright-cli` 降级为兜底；
    ③ CloakBrowser 仍是按需下载的可选增强；④ 需要用户看页面走右栏内置面板。
  - **新增** 三段循环约定（观察 → 动作 → 验证）、`browser_exec` 多步合并单次 CDP 往返、
    `browser_import_cookies` 登录态复用（含凭证边界）、`desktop_perceive` 拿坐标而
    `desktop_vision` 的坐标**不可点**（工具描述原文警告）、Intel Mac 无本地 OCR 的降级说明。
  - ⛔ **桌面指令不再只说 `nuphus-call` 命令行** —— `desktop_*` 就在模型工具列表里，直接调。
  - **✅ 已做（09-20 同日）：两个总闸从「提示词级」升级为「硬控制」并解耦。** 原状有两个短板：
    ① 注册只看 `desktopAutomation`，而 nuphus 是同一个 MCP 服务器同时提供 `desktop_*` 与
    `browser_*` ⇒ **关桌面会把浏览器能力一起带走**（「只给浏览器自动化、不给真实键鼠控制」做不到，
    属安全边界缺陷）；② `browserAutomation=false` 时 `browser_*` 仍全量注册、只靠提示词劝阻
    ⇒ 浏览器总闸**不是硬控制**。
    现法：注册条件改「任一总闸开启」（`shouldRegisterNuphus`），关闭的那一组用 `disabled_tools`
    整体摘掉（工具从引擎工具表消失 = 真阻断）。**唯一来源** = `electron/automation-policy.ts`
    （工具分组实测枚举：**桌面 15 + 浏览器 23 = 38**，此前文档里写的 14+24 是数错了）。
    ⛔ 两个不变量：**UI 与配置同源**（`mcp-servers:permissions` 也过同一掩码，否则出现
    「界面显示未设权限、配置里已被禁用」）；**掩码压过用户显式 allow**，并从 ask/allow 摘除
    （否则同一工具既进 `disabled_tools` 又带 `approval_mode`，配置自相矛盾）。
    ⚠️ 残留：`nuphus-call` / `playwright-cli` 仍在 PATH 上，总闸对**命令行兜底**只有提示词级约束
    （已在指令里明写「不得用 nuphus-call 绕过总闸」）。
  - **nuphus 内置版本 0.2.3**（09-20 从 0.2.2 升级）：工具面 diff **零增删、描述零变化**（实测枚举，
    输出字节数相同）⇒ 对提示词层零风险；上游这一版只有 HUD 视觉重构 + TLS 依赖安全修复，
    **升级理由是安全依赖**（我们打包本来就 `NUPHUS_MCP_HUD=off`）。版本钉死**四处必须同源**：
    `prepare-windows-tools.cjs` 的 `NUPHUS_VERSION`、`prepare-mac-tools.cjs` 的 npm 安装与 manifest、
    `.github/workflows/build-mac.yml` 的 `ref:`（mac x64 走 cargo 从 tag 取源）。
  - **桌面侧也有「判存在」了**（09-20）：此前只有浏览器侧有 ⇒ 总闸关着时模型会去调不存在的
    `desktop_*`。现在技能与指令都按「工具列表里有没有 `desktop_windows_list`」判，并说明不可用时
    的正确回应（让用户去「设置 → 自动化」开）。
- **⛔ 两个「清单与现实脱节」的真 bug（09-20 随上一条一起修，都有真机取证）**：
  1. **技能停用被静默写回**：总闸停用技能是把 `SKILL.md` 改名成 `SKILL.md.disabled`，而
     `ensureBuiltinSkills` 原先无条件写 `SKILL.md` ⇒ **用户关掉的技能每次启动都被重新启用**，
     界面显示「已停用」而引擎照常加载（总闸形同虚设）。现在按 `active → disabled → active` 选目标文件，
     就地更新 `.disabled`；内容比对归一化行尾（否则每次启动白写盘）。
  2. **`developer_instructions` 升级后永不刷新**：启动自愈的判据只 grep 一句
     `"Never infer Python availability"`，而老配置里本来就有这句 ⇒ `instructionsOutdated` **恒为 false**
     ⇒ 任何指令改动**都到不了老用户**（实测：技能文件已更新、config.toml 还是旧文案，只刷新一半）。
     现在抽出 `devInstructionsInput()` 作为**唯一输入来源**，判据用 `developerInstructionsLine()` 生成的
     整行做包含比对 —— 与写出内容逐字同源，既不恒 false（能刷新）也不恒 true（不会每次启动整份重写）。
  - 另有一条**既存**问题（未修、已记档）：该判据同一处的 `providerOutdated` 恒为 true ——
    `config.toml` 写的是 `model_provider = "harness"`，而档案里是 `provider = "custom430"`，
    两者永不相等 ⇒ **每次启动都整份重写 config.toml**（真实 profile 上同样存在，与本次改动无关）。
- **⛔ 上游协议手动开关（`upstreamProtocol`）—— Claude 类通道接入的可控口（09-19，供应商配置界面可调）**：
  用户诉求：「如果用 Claude 模型呢，能做适配协议吗 / 能不能走本地代理转成 Codex 支持的协议」。
  答：**走的正是现有架构**（引擎只发 Responses → 本地协议桥 47121 按上游实际能力转发），缺的不是桥，
  而是「桥判定不了时的人工出口」。
  - **四档取值**（存在供应商档案里，`CustomModelFile.upstreamProtocol`）：`auto`（默认，先按 responses 试，
    上游明确表示"没这个端点"才切 chat）/ `chat`（直接按 Chat Completions 转换）/
    `responses`（强制透传，省一次探测）/ **`anthropic`（09-19 新增，走 Claude 原生 `/v1/messages`）**。
    ⛔ **与 `wireApi` 不是一回事**：`wireApi` 是写给**引擎**的（恒 `responses`，写 chat 会让整份 config.toml 拒载）；
    `upstreamProtocol` 是告诉**本地桥**上游真实是什么协议。别混。
  - ⛔ **Anthropic Messages 适配的三条硬规则**（照文档猜会全错，预检【73】已钉死；端到端实证见
    `scripts/probe-anthropic.cjs`）：
    ① **认证头要转**：引擎只发 `Authorization: Bearer <key>`，Anthropic 要 **`x-api-key`**
       （从 Bearer 里取出后两个都带，官方与中转站各认一种）+ 强制 `anthropic-version`（缺了官方直接 400）；
    ② **消息必须严格交替**：`system` 是**顶层字段**（不在 messages 里），且连续同角色的消息要**合并**
       —— 引擎的 input 里连续两个 user、或并行工具调用产生的多条结果都是常态，不合并必被 400；
    ③ **工具往返是内容块，不是消息上的字段**：调用侧 = assistant 的 `tool_use` 块，
       结果侧 = **user** 的 `tool_result` 块，靠 `tool_use_id` 配对；`tool_use.id` 必须**沿用引擎给的
       `call_id`**（自己生成 → 下一轮回传结果时对不上，工具闭环直接断，表现为"模型说要执行但什么都没发生"）。
    另：`max_tokens` **必填**且 ≤ 模型上限 —— 引擎给的是上下文级大值（实测见过 393216），
    原样透传必被拒，故压到 64000；`tools` 用 `input_schema`（不是 chat 的 `function.parameters`）；
    extended thinking **默认不开**（开启后禁止同时传 temperature/top_p、要求 max_tokens > budget_tokens，
    且部分中转站直接 400）——**思考档位对 Claude 路径不生效**，模型自发返回的 thinking 块仍会转成 reasoning 事件展示。
  - **本地模型适配**（09-19）：供应商配置顶部加了「本地模型」快捷预设（Ollama 11434 / LM Studio 1234 /
    vLLM 8000 / llama.cpp 8080），点一下填好地址与名称，并把**并发设为 1**（单卡多路会让 KV cache 成倍占用、
    明显变慢甚至 OOM）。⛔ 同时修了一个真 bug：保存逻辑原把「无 Key 的第三方供应商」一律存成**禁用**
    （为防"首次安装默认启用"），而本地服务**本来就不需要 Key** ⇒ 用户配好本地模型却发不出消息且看不出原因。
    现在 `isLocalEndpoint()`（loopback + RFC1918 私网）允许无 Key 启用。
    ⛔ **显示侧（`publicCustomModel`）与保存侧（`custom-model:save`）必须过同一判定**：不一致会出现
    「存成启用、界面显示停用」这种自相矛盾状态（预检【64】已按新意图更新锚点）。
  - **配置说明收进 ? 号**（09-19 用户要求「赘述都放到 ? 号里面」）：字段标签旁统一用 `FieldHelp` 组件
    （`.field-help`），hover/focus 才显示。⛔ 三处实现要点：① **同时带原生 `title`** —— 设置面板是滚动容器，
    绝对定位伪元素在某些层级会被 overflow 裁掉，title 兜底保证说明不会"彻底读不到"；
    ② **必须可键盘访问**（`tabIndex={0}` + `:focus-visible`），只靠 hover 的话键盘用户读不到；
    ③ 原来的常驻 `.provider-field-hints` 段落已删除（不是隐藏）—— 别再往界面加常驻长说明。
  - ⛔ **加它的原因**：有些网关对未知路径返回 **400**（不是 404），旧判定只看状态码 ⇒ 当成"端点正常"直接透传 ⇒
    对话失败且看不出原因（Claude 类通道尤其常见）。现在 400 走**歧义判定**：读一小段响应体（≤8KB）按措辞特征
    （`UNSUPPORTED_ENDPOINT_HINT`）定性，**且只在明确是这个意思时才切** —— 宁可漏切（用户可手动指定），
    也不能把"参数错误"误判成"端点不存在"而把本来能用的网关改坏。
  - **注入链路**：`bridgeDial(id, baseUrl)` 从**内存表** `upstreamProtocols` 取协议（同步函数、拿不到异步档案），
    该表在 `readCustomModels()` 与 `writeCustomModels()` 里同步（写档案 = 设置变化的唯一出口）。
    ⛔ **启动链必须在 `await server.start()` 之前预填一次**（`await readCustomModels()`）：引擎起来后渲染层第一个
    请求就可能触发 `bridgeDial`，那时表还空 ⇒ 注册成 `auto` ⇒ 用户配的「强制 chat」**重启后失效**（竞态，难复现）。
    预检【72】已钉死这条。
  - ⛔ `register()` 发现 `mode` 或 `baseUrl` **变了就必须丢掉已解析的协议缓存**（`resolved.delete(id)`）——
    否则用户改完设置，桥还按旧判定走，表现成"改了设置不生效"且查不出原因。
  - **排查接口**：`bridge:status` 同时给 `modes`（实际跑成什么）与 `configured`（**用户配了什么**）。
    排查"我改了设置但没生效"必须看 `configured` —— 它为空/是旧值说明配置没传到桥（断在注册那步），
    而不是桥转发错了。二者混为一谈会往错的方向查。
  - **Claude 的现实约束**（给用户解释用）：Anthropic 提供 OpenAI 兼容层（`/v1/chat/completions`），
    所以 Claude 属「Chat 兼容」那一档，中转站的 Claude 通道多数可直接用；但官方明说兼容层面向测试/对比，
    **工具调用的 JSON 不保证符合 schema**（`strict` 被忽略）—— 而 Codex 干活全靠工具调用，故不建议把它当生产路径。
  - 验证：预检【72】19 条守卫；真机 e2e ①界面下拉（三值、默认 auto）+ 保存落档 + **桥注册的协议真变成 chat**；
    ②**重启场景**（隔离 profile 只放档案、不写 config.toml）：`configured={"tmpchat":"chat"}` 且 config.toml 的
    `base_url` 指向 `http://127.0.0.1:47121/p/<id>`，全通过。
- **⛔ 会话血缘（rollout lineage）：删源会拖死子会话 —— 删除必须守卫、已断的启动自愈（09-19 用户实测事故）**：
  用户原文：「我归档会话，提示 `invalid paginated history lineage for <源id>: missing source rollout`，会话都没法选择了，从根上修掉」。
  - **机制**：分支 / 接力 / 专家团派生出来的会话，其 rollout **首行 `session_meta`** 记着源会话；引擎在 `threads.history_mode = paginated` 时会沿血缘**按字节区间回读源 rollout**（`history_base = { thread_id, end_ordinal_exclusive, end_byte_offset }`）。
  - ⛔ **真正的载体是 `history_base`**，不是（也不只是）`forked_from_id` / `forked_from_ordinal_exclusive` / `parent_thread_id`。只摘前者时「文件层面看着血缘已摘」，引擎**照样报错**（为这个漏项白跑两轮真机验证才定位到）——改血缘字段表时必须连 `history_base` 一起，预检【71】已钉死。
  - **删除侧守卫**：`purgeRolloutFiles` 先 `collectLineage()` 算依赖，**被别的活着的会话依赖的源 rollout 不删**（转 `kept` 返回 + 主进程显式日志）。整批一起删的子会话不算依赖（不存在"子活着源没了"）。保留的文件侧栏不显示（墓碑仍生效），磁盘上留一份血缘锚点。
  - **启动自愈**：`healRolloutLineage()` 对「有血缘且源已丢失」的会话按 `LINEAGE_KEYS` 摘字段（原首行存 `<文件>.lineage.bak` 可回滚），改写走「写 `.heal.tmp` → `rename`」**原子替换**（半截 JSONL = 会话历史损坏，比打不开更糟）；幂等（摘过的不再匹配）。
  - ⛔ **位置与时限是硬约束**：必须在 `await server.start()` **之前** await —— 引擎一起来就把血缘读进内存/缓存，之后再改 rollout 文件**同一次运行内不生效**（实测：字段已摘、resume 仍报 missing source rollout，重启才好）；同时带 5s 超时降级（worker 超时是 15s，不能让自愈把启动拖死）。
  - **取证要点**：血缘只存在 rollout 首行，`state_5.sqlite` **没有血缘列**（判断"能不能删"必须回读文件，不能查索引）；血缘引用只在首行，后续行不含。
  - 验证：预检【71】15 条守卫；真机 e2e 在**真实 codex-home 的最小副本**上复现断链 → 启动 → 断言字段摘除 / 原首行备份 / 内容完好 / `thread/resume` 返回 ok / 二次启动幂等，全通过。
- **⛔ 回合「思考被上游截断」的检测 + 自动续接（09-19 用户实测「思考内容过长会被截断，运行状态就断了」）**：
  真机取证（会话 01a0b515 回合 8「鹈鹕骑自行车」）：应用配 `model_max_output_tokens=393216`，但商汤网关把单次响应**钳到 8192 tokens**；模型思考 16365 字符（≈8000+ tokens）把预算吃光 → 正文 0 字符 → 引擎把「空输出」当 task_complete 正常收尾（**rollout 不记录 finish_reason**，无从事后得知被截断）。本地部署模型（Ollama/vLLM）同样受单次输出上限约束。
  - **检测形态（最关键）**：引擎截断时会**把 reasoning 摘要逐字复制成 agentMessage** 当最后的正文（last_agent_message 就是它）——「正文非空」≠「有产出」。判据 = 思考 ≥6000 字符 且 正文「排除与思考逐字相同/高度相似的复述后」为空 且 无工具动作；三者同真才判（漏报优于误报）。
  - **应用不做任何限制**（用户明令「有的任务需要长时间思考」）：检测只提示，绝不截断/裁剪思考与输出。
  - **自动续接**：引擎无回合内承接通道（`turn/steer` 前置条件 = active turn，截断后已 task_complete；引擎自身不做 finish_reason=length 续写）⇒ 承接落成新回合：延迟 2.5s 等收尾 → `thread/queue/add`「从上次中断处继续写、不要重新思考」（承接语义，非重做任务）→ `queue/start`。防死循环：同一会话 15 分钟内最多 2 次；执行前查该会话无 running turn（用户已手动续上就放弃）——**绝不让正常收尾被误判而多出应用自发的回合（那才是空转）**。
  - 验证：预检【59】15 条守卫（含「正文=思考复述」判真、「长思考+正常短结论」不误判——用户明令的反向用例、续接语义、防循环记账、无长度截断）；反证（放宽阈值→「短结论」守卫变红）；真实 rollout 数据判真 + 真机「正常回合 tc=1/um=1 无截断提示无续接」。
- **⛔ 内置技能 browser-automation → browser-skill 替换（09-19 用户「这个技能优化使用，这个更好，那个替换掉吧」）**：
  `electron/builtin-skills.ts` 的浏览器技能整体重写为 `browser-skill`（4.2KB：playwright-cli **全工作流实操手册**——权威命令表取自随包 `@playwright/cli --help`，含旧版完全没提的 `find`/`requests`/`response-body`/`console`/`state-save`/`kill-all`/`--raw`；**旧技能里唯一有价值的通道选型 / CloakBrowser 反爬升级已并入**，删除不丢能力）。
  - **退役清理**：`RETIRED_SKILLS` 机制——升级启动时，磁盘上内容仍**逐字等于当初内置版本**（含 `SKILL.md.disabled` 形态、**行尾归一化后比对**）的旧技能目录随升级删除；用户改过/自建的一律不碰并 `console.warn` 留痕。⛔ 两个实测坑：① **指纹比对必须归一化行尾**——被总闸停用/启用一次的技能文件会被重写成 LF，常量是 CRLF，只 trim() 永远比成「被改过」→ 清理静默失效（真机验收抓到的）；② **`String.replace` 替换串里 `$$` 是特殊序列**——用 replace 插入含 `page.$$` 的模板常量时 `$` 被吃掉一个，指纹差 1 字符全盘失效；模板注入一律用函数替换 `replace(re, () => text)` 或求值后回写。
  - **总闸联动泛化**：`capability-groups.ts` 的 `browserSkill`（单值）→ `browserSkills`（名单 `BROWSER_SKILL_IDS`），collect/plan/apply/synced/groupMembers 全部走名单——以后再加/换技能只改名单，联动逻辑零改动。
  - 验证：预检【58】12 条守卫（含退役指纹、名单一致性、聚合联动；行尾归一化断言当场反证 ✗）；真机验收 8/8（技能写入 profile、frontmatter/命令齐全、旧目录已清、通道说明未丢、启停与总闸联动各停→启生效）。
- **⛔ 语气自适应：给 agent 加会话级状态（09-19 用户要求「想要 agent 有状态、语气跟着变」）**：
  新增 `src/lib/agent-mood.mjs`（纯函数：归一化 / 信号更新 / 时间衰减 / 语气映射 / 拼块 / 幂等剥离 / 变化签名）
  + `src/App.tsx` 的状态读写（键族 `agent-mood-<threadId>`）、回合挂点、注入与级联清理 + `electron/app-settings.ts` 开关。
  **状态**：心情(-1..1) / 精力(0..1) / 默契(0..1)，由**回合级权威事件**驱动（`turn/completed` → 向好；
  `turn/aborted|failed|interrupted` → 转差，连败惩罚递增封顶 0.30；用户消息关键词 → 被夸 / 被催），
  30 分钟一档朝基线衰减（最多 5 档）。**注入**：走会话自己的 `developer_instructions`
  （`buildSessionScope` 里用 `composeMoodInstructions` 包在作用域块外）⇒ **天然按会话隔离**。
  **⛔ 三个必须记住的点**：① 签名里只放**语气档 + 默契档**，绝不放浮点 —— 否则每回合都发一次
  `thread/settings/update`；② 触发刷新的可靠时机是**发送消息前**（回合刚结束时引擎还在收尾，那时下发会被
  静默拒掉 —— 真机验收实测：状态更新了、引擎侧却没有新语气块）；③ 发送路径上新增的 `await` 必须在
  `sendInFlightRef` 置位**之后**且落在 `try` **之内**（code review 抓到：否则 800ms 窗口可重入发送、
  且一次 throw 会让发送永久卡死）。
  **守卫**：预检【57】23 条，判据扫「**剔掉整行注释**的代码文本」——不能只用原文（`// bumpMood(...)` 照样匹配
  = 假绿），也不能用 `codeOnly`（App.tsx 里成对 `/* */` 极多，一处不配对就会吞掉后面的代码 = 假红）。
  真机验收 8/8：判据落在 **rollout 的 `developer_instructions`**（引擎侧真收到）+ localStorage 状态键（按会话分开）。

- **⛔ 会话「项目地址」改动要真落到侧栏 + 启动自动展开项目（09-19 用户实测：「在已创建会话上修改项目地址，
  改了只是对话框上面显示改了，左侧栏没有变化，新增的项目地址也不出现，这个切换项目地址功能这样看就是假的；
  启动应用左侧栏也没有自动展开项目，要手动展开」）**：
  - **根因**：侧栏项目分组 `projectGroups` 是按 `threads[].cwd` 派的，而 `chooseWorkspace()` 原来只改了
    本地 state + localStorage + 引擎 `thread/settings/update`，**没动列表里那条记录**；
    且引擎 `thread/list` 回包的 cwd 是**创建时写进 rollout** 的那个（settings/update 只改运行时目录）
    ⇒ 就算临时改了本地，下一次列表刷新也会被顶回去 ⇒ 用户看到的「假的」。
  - **修法**：① `chooseWorkspace` 四件事一起做：引擎设置 / 列表条目 + 打开中的 thread 与缓存（侧栏立刻搬家）/
    **本地覆盖落盘**（`thread-cwd-override-v1`，`rememberThreadCwd`）/ 展开新项目 + toast；
    ② 两条列表刷新路径都过 `withCwdOverride(entry)`（漏一条就等于改了个寂寞）；
    ③ `openThread` 顶栏显示走 `effectiveCwd(id, result.cwd)`；
    ④ 启动后**首次**拿到项目分组时自动展开「当前会话所在项目」（`projectAutoExpandRef`，
    只在第一次就绪时执行，之后完全交给用户的展开/折叠偏好）。
  - **验收（真机，profile=main）7/7**：拿一条真实会话把 `thread-cwd-override-v1` 写成新项目 →
    刷新后 `docs` 计数 2→3、原项目 5→4、`docs` 出现在侧栏、**再刷新一次计数不回退**、
    清掉展开偏好后启动自动展开。判据用**项目头计数**（`.project-item-head em`）而不是 DOM 行 ——
    侧栏只渲染展开组的行，用行判会得到"未找到"的假红（前两版就栽在这）。
  - ⛔ **别想让渲染层 stub 原生目录选择框**：`contextBridge` 暴露的 `window.codex` 是
    `frozen + non-configurable`（实测 `writable:false, configurable:false`，赋值静默失效、defineProperty 抛错），
    所以「点『选择其他目录…』→ 侧栏立刻搬家」这一段无法自动化（会真的弹原生框、卡住测试）。
    那段由预检【56】的静态守卫钉住；能自动化的持久化半边已真机验证。
- **⛔⛔ 会话绝对独立：切会话 / 开关独立窗口**不许**影响正在运行的任务（09-19 用户明令：
  「不准再因为切换会话、别的独立弹窗关闭影响正在运行的会话，每个会话都是绝对独立运行状态，
  互不影响，除了用户停止，不许再断」）**。三处真根因，全部收口：
  - **① 渲染层拿"快照"熄灭运行态（主犯）**。`openThread` 的两条路径（freshThread / resume）原来都是
    `if (runningTurn) markThreadRunning(...); else markThreadStopped(id);` —— 而引擎 resume 回包与本地
    缓存快照**经常不带 inProgress 回合**（或带的是旧快照），于是正在跑的会话被判成"已停"：停止键消失、
    侧栏转圈消失；**更致命的是下一条消息会因此走 `turn/start`**，而引擎侧那个回合还在跑 ⇒ 当场被打断。
    ⇒ 撤销运行态**只能**由回合级权威事件（`turn/completed|aborted|failed|interrupted`）或引擎侧记账核实触发；
    「快照里没看到」≠「没在跑」。三处 `else markThreadStopped`（含 `no rollout found` 兜底分支——它正是
    "新建会话首回合还在跑、rollout 尚未落盘"的形态）全部删除。
  - **② `thread/status/changed` 的 `idle` 无条件熄灭**。`idle` 是**快照式**信号（resume 回包、回合间隙、
    引擎重连、切会话重建状态都会发），旧写法 `else markThreadStopped(...)` 拿它抹掉 `turn/started` 点亮的
    运行态。⇒ 现在只有 `notLoaded` / `systemError`（结构性事实）直接清；`idle` 必须**向主进程核实**
    （`engineActiveTurns().threadIds` 里没有该会话）才清。顺带补上渲染层对 `turn/aborted|failed|interrupted`
    的处理（原先只认 `turn/completed` ⇒ 被中断的回合转圈永远挂着）。
  - **③ 主进程硬闸（最后一道，不依赖渲染层状态对不对）**：`codex:request` 里 `turn/start` 若发现
    **引擎侧记账**（`engineActiveTurnIds` 由 `turn/started|completed` 维护）中该会话仍有活动回合，
    **直接拒绝**并提示改走 `thread/queue/add`（排队）或 `turn/steer`（并入当前回合）。
    这是"绝对独立"的兜底：渲染层任何一次状态误判都不会再变成"打断在跑的任务"。
  - **④ 记账必须有出口（否则死锁）**：`engineActiveTurnIds` 原来只按事件增删，**引擎进程重建时不清** ⇒
    闸门与硬闸永久卡在"有任务在跑"（改配置永不生效、消息再也发不出去）。新增
    `CodexServer.setEngineSpawnHook()`（每次 spawn 后回调），主进程据此 `clear()` + 打警告台账；
    同时被推迟的重启请求在"新引擎已按磁盘配置启动"时**直接作废**（等价于已经生效，别再重启一次）。
  - 对应预检【55】7 条守卫（负向断言：全仓不许再出现 `else markThreadStopped(id);` /
    `else markThreadStopped(params.threadId);`）。**改动这块先跑 `npm run check`**。
- **⛔ contextWindow 单一真相源（09-19 用户实测「`custom-model.json` 该模型写 1000000、`custom-models.json`
  同一供应商顶层写 128000，这个修一下，怎么又出现这个问题」）**：
  两个字段表达的是同一件事，却由**两个不同来源**写 —— 模型自己的 `contextWindow` 来自内置规格表
  （新建供应商时的能力值），顶层那个只是**新建模型时的默认值**（UI 默认 128000，用户多半没动过），
  而引擎侧 catalog 读的是**模型自己的**值。两处各写各的 ⇒ 每建一个供应商就留下一对打架的数字：
  界面按大值算（1M → 显示 12% 的假安全感），用户按小值理解（以为只剩 4%）。
  **修法**：在**唯一写入点** `withModels()`（electron/main.ts，所有 provider 写入路径都过它）收口 ——
  顶层恒等于生效模型自己的值（模型没有自己的值时才保留顶层输入）。
  ⇒ `custom-model.json` 顶层、`custom-models.json` 里那条记录、`model-catalog.json`（引擎实际读的）、
  界面显示四处永远一致。渲染层在模型编辑器里补了一句「**本模型的值才是生效上限**，供应商表单里的只是新建时的默认值」，
  把"哪个说了算"直接写出来，避免下次又被一对数字绕进去。
  **验证（离线主进程 e2e，不启动 Electron：stub `electron` → 加载 `dist-electron/main.js` → 直接调 handler → 回读落盘文件）**：
  8/8 通过（两处顶层都是 1048576、返回值一致、模型值未被反向改写、模型无值时保留用户输入 64000、
  `config.toml` 仍能被 Python `tomllib` 权威解析、catalog 也是 1048576）；
  **反证**：只摘掉归一那三行 → 同一套判据 3 条变红（顶层退回 128000）。对应预检【54】4 条守卫。
- **⛔ 钉顶「落点不可达」+ 排队消息不上钉（09-19 用户实测「钉顶也没有啊」，当日定位并修复）**：
  两个独立缺口叠在一起，症状都是「用户消息不在顶部、停在半屏」。
  - **缺口一：留白收缩过头 ⇒ 落点滚不到**。真机打点复现（运行中发消息 → 队列释放这条路径）：
    `pin-apply` 先把消息钉在 36px ✓，随后 `pad-shrink` 把留白从 291→269→258→226 一路缩，
    而 `pin-fix` 想滚到的位置已经**超过 maxScroll**（`top` 恒等于 `max`=1170，`err` 一路涨
    21→59→100→253）⇒ 视口被钳死，消息最终停在 136px（另一轮 289px，用户截图 305px 同源）。
    成因：收缩公式在**流式 + `content-visibility` 惰性布局**下会拿到偏小的锚点坐标 ⇒ `need` 偏小，
    而「只减不增」让缺口永远回不来。**修法（`shrinkAnchorPad` 内，单点）**：收缩后算
    `want = scrollTop + gapErr`，若 `want > maxScroll` ⇒ 判定收缩过头，把缺口**还给留白**
    （`restore = need + (want - max)`，还回后 scrollHeight 同步变大、`maxScroll` 正好等于 `want`），
    打点 `pad-restore`。**「只减不增」必须让位给「落点必须可达」这个不变量。**
  - **缺口二：排队消息从没建立钉顶意图**。会话正在跑时发的消息走 `thread/queue/add`
    （发送函数里那条分支在「上钉」段（`anchorTopRef = true`）**之前就 return**），
    随后由「回合结束自动启动」或「立即」把它变成真实回合 —— 两条释放路径原先都不建立意图，
    那条消息于是落进内容流（实测 `pad≈0`）。**修法**：新增 `armPinForReleasedQueue(threadId, why)`
    （只写意图，**钉顶唯一 owner 仍是 `pinSentMessage`**），在三条释放路径调用：
    `auto-start`（turn/completed 里的队列启动）/ `steer`（立即插队）/ `queue-start`（立即开新回合）。
    ⛔ 它**只对当前可见会话**生效（`threadId !== threadRef.current?.id` 直接返回）——
    给后台会话设意图会抢走视口。
  - **别再"猜根因"**：这两条都是靠 `__adbg` 的 `pad-shrink` / `pad-restore` / `pin-fix` /
    `queue-arm` 打点（带数字）十分钟内定位的；本轮也顺手给 `pin-apply` 加了 `max`/`aCls`。
- **内置模型规格表更新 + 模型 ID Tab 补全 + 模型下拉徽标 + 思考等级滑块（09-18 用户四连需求）**：
  - **规格表**（`src/lib/model-specs.ts`）：按 09-18 官方资料重写。新增 GPT-6 Astra（1.05M/128K/视觉）、
    GPT-5.6 三档（1.05M/128K/视觉）、Claude Fable 5 / Opus 4.8（1M/128K/视觉）、Gemini 3.x（1,048,576/65,536）、
    Kimi K3（1M/**原生视觉**，K3-256k=262K）、GLM-5.3-Flash（**多模态**；注意 GLM-5.3 本体纯文本）、
    Qwen3.8-Max（1M/图+视频）、日日新 SenseNova 6.5（128K/图文视频，用户自己的供应商）、豆包 Seed 2.0（视觉）、
    小米 MiMo-V2.5。修正：GPT-5.4/5.5 400K→1M、Claude 新旗舰 200K→1M、K3 256K→1M。
    ⛔ **视觉标记不是徽标**：它会变成给引擎的 `input_modalities`（main.ts buildModelCatalog）——漏标 =
    视觉模型发图被拒、虚标 = 纯文本模型被允许发图然后被供应商拒，两个方向都有害。维护约定：**只收录
    有据可查的**，拿不准就不加（漏加只是手填一次，错加把错误模态带进引擎）；用户可用
    `userData/model-specs.json` 覆盖。规则每条带 `ids[]`（补全候选）与 vendor/family。
  - **Tab 补全**（`src/components/ModelIdInput.tsx`）：候选 = 内置表（`suggestModelIds`：完全相等 → 前缀 →
    子串/厂商/系列，表内顺序 = 新旗舰在前）+ 供应商探测到的模型 id；↑↓ 选择、**Tab/Enter 补全**、
    Esc 只关列表；每行带 图片/视频/上下文/输出 徽标。回填走**函数式 setState**（Tab 一次跳一长串 id，
    闭包式更新会互相覆盖）+ 尊重 `paramsDirty`（手改过不覆盖）。替代了原生 datalist（无 Tab、无徽标）。
  - **模型下拉徽标**：`ComposerMenu` 选项支持 `badges`，模型菜单每行 = 名称 + 供应商色调圆点（左）+
    图片/视频/上下文/输出徽标（右）+ 当前项勾选挪到最右；弹窗加宽到 330。`Model` 类型补
    `contextWindow/maxOutputTokens`（用户配置值优先、规格表兜底）。
  - **思考等级滑块**（用户定稿）：默认一条 2px 细线；⚪圆点 `opacity:0`，**hover/聚焦/拖动才出现**；
    已选段 = 按档位分色的渐变（`backgroundSize: fillScale` 按「整条轨道」铺，再裁到已选宽 —— 颜色
    对齐档位位置）+ 流光（`::after` 扫光）+ 外发光（⛔ 放 fillwrap 上，fill 自己 overflow:hidden 会
    裁掉 box-shadow）+ 前沿亮珠；**拉满 = `.burn`**：火焰配色 + 流光加速 + 三簇火苗 + 轨道泛橙红。
    原生 `input[type=range]` 的拇指保持**透明但可拖**（拖动/键盘/触摸/无障碍全复用原生）；档位标签
    降级为刻度点+纯文本（不再是「点哪里亮哪里」的高亮胶囊），点击/键盘仍可跳档，释放才提交（不变）。
  - 验证：真启动 **21/21**（Tab 补全+回填+视觉勾选 / 下拉徽标+加宽 / 滑块默认无圆点→hover 出现→
    点轨道跳档→拉满燃烧→松手提交→键盘可用）；预检新增 **22 条**（含真跑 model-specs.ts 的
    规格断言 15 条），6 处改坏逐条反证变红。
  - ⚠️ **CDP 合成鼠标驱动不了原生 range 的拖动手势**（裸 range 对照实验证实；点轨道与键盘正常）——
    验收里拖动链路用「setInput 中间态 + pointerup 提交」验，真实鼠标拖动是浏览器原生行为。

- **思考档位改「纯会话级」+ 删掉模型配置里的档位勾选（09-18 用户：「把模型配置里面思考选择删了，
  每个独立会话选择那个就生效那个」）**：
  - 删掉模型编辑器里的「思考档位」勾选区与 `draft.efforts` —— 档位**不再是模型条目的属性**
    （UI 不再写 `models[].efforts`；旧值保留给主进程 catalog 侧，不主动清理）。
  - 菜单档位**恒为全集**（`levels = ALL_EFFORTS`，不再按模型声明过滤）；「声明被取消后回落」的
    补正 effect 与 `changeEffort` 的 upsert 补声明一并删除 —— 那两处正是 09-16「选了极高、重开
    又是旧档」的根源，现在整类问题消失。
  - 会话级链路（**本来就在**，本轮没动）：`applyEffort` → 有会话写 `thread-runtime-<id>.effort`
    ＋ `updateThreadSettings`，无会话才写 `default-effort`；`openThread` 用 `loadThreadEffort(id)`
    回填。用户问的「会话独立生效配置还在不在」= 在，且是权威。
  - ⛔ **删了手动声明就必须有自动兜底**（用户追问「碰到不支持的档位怎么办」）：新增
    `src/lib/effort-support.ts`（纯函数）—— 发送失败时判定「档位不被支持」（**档位语义 + 否定语义
    双命中**，否则 `invalid api key` 会被误判成档位问题而白白降档重发）→ 记进
    `model-blocked-efforts` → **自动降一档重发一次**（max→极高→最高→高→中→低→极简，跳过已记录的；
    已是最低档则不再重发、改为提示手动选）。菜单把记录过的档位**标灰但仍可点**（网关后来支持了
    能强制选），每次**打开弹窗时重读**（刚降档的、别的窗口记的立刻可见）。
  - **自愈**：这次用当前档位发送**成功**了就清掉该档位的记录（`clearEffortUnsupported`，挂在
    turn/start 成功路径）。没有它，用户强制选回被标灰的档位、或网关后来放开了，标记会永久留着 ——
    一次偶发失败就能让某档位永远灰着。⛔ 自愈只清**本次用的那一档**，不清该模型的全部记录 ——
    一次成功（如降档重发那次）不该把刚学会的其他档位失败一并抹掉。
  - ⛔ **三处必须用同一个 model key**（标记 `fallbackModelId` / 自愈 / 菜单重读 `currentModelId`）：
    `selectedModel?.model ?? modelName(modelId)`，与 `rememberEffortFor` 一致 —— 键不一致会让
    「降档后菜单仍不标灰」或「自愈静默失效」这类问题查不出来（表面功能都正常）。
  - 主进程 catalog 侧仍有「按声明过滤档位」的旧路径，但 UI 已不发档位声明，且引擎**不校验**
     （实证见 `effort.ts`），所以不影响可选性。
  - 验证：真启动 **8/8** —— 会话 A 选「极高」→ 会话 B 选「低」→ **切回 A 仍是「极高」**；菜单 7 档；
    模型配置里无档位区；预置「不支持 max」→ 菜单标灰且仍可点。预检加了**真跑 effort-support.ts**
    的纯函数断言（正例/反例/降档链/跳过已标记/最低档返回 null/分组落盘/按模型隔离/自愈清理）+ 6 条
    接线守卫，**8 处改坏逐条反证变红**。

- **模型编辑器「思考档位」默认全选（09-17 用户：「新建供应商和修改模型，这个都模型全选吧，可以勾掉」）**：
  - 三处必须一起改，缺一处用户就会再撞上「怎么又少几档」：
    ① `openModelEditor` 的初始勾选 = **全集**（原为「模型条目里存了几档就勾几档」→ 每次改模型都要手动补勾）；
    ② 输入模型 ID 时的规格自动回填**不再收窄 efforts**（原实现会把刚输完 ID 后全勾的档位又勾掉几档 ——
       用户碰到的正是这个；规格表继续管上下文 / 最大输出 / 输入输出模态，那些填错真的会被供应商拒）；
    ③ 新建条目的档位兜底从死写 `低/中/高` 改成全集（`App.tsx` 一键接入两处 + `useModelProviders.ts`
       探测新建与刷新校准两处；规格表**明确声明过**的仍按声明）。
  - 提示文案同步为「默认全选；供应商不支持的勾掉即可（一个都不勾则回落 低/中/高/极高）」。
  - 依据：引擎**不校验 effort**（见 `src/lib/effort.ts` 上方的真实引擎探针说明），所以「默认给全档、
    用户按自家供应商实际能力收窄」比「默认收窄、用户补勾」省事，而收窄仍是一次点击。
  - 验证：真启动 **5/5 + 端到端 3/3** 全绿 —— 添加模型 7 档全勾 / 输入 `gpt-5.1` 后仍 7 档（旧行为掉到 4 档）/
    勾掉「极简」剩 6 档 / 编辑已存模型（配置里只声明了 5 档）也是 7 档全勾 /
    **保存后思考菜单真的从 5 档变成 7 档**。预检 ⑰b 加 5 条守卫，三条改坏分别反证变红。

- **Codex 头像「运行有、完成没」根治：默认头像改 CSS 渐变（09-17 用户二次报同一症状：
  「运行完成，头像又不见了，运行的时候还有」）**：
  - 症状极隐蔽：**DOM 上尺寸 22×22 / display / visibility / opacity / `checkVisibility()` 全都正常**，
    就是那块区域一个像素都没画 —— 上一轮只查这些属性，所以误判成「一切正常」。
  - 真因：底色是 SVG `<linearGradient id="codex-avatar-bg">` + `url(#codex-avatar-bg)`。
    **SVG 的 `url(#id)` 是文档级引用** —— 同页每个头像实例都注册一份同 id defs（回合头 +
    乐观头的头 + 各历史回合的头），引用只解析到**文档里第一个**同 id 元素；它一旦落在
    `content-visibility: auto` 被跳过的子树里（`.turn-group` / `.turn-card`：视口外回合跳过
    布局与绘制）或已被卸载，就解析不到 paint server → **整块渲染成空白**。用户那条线程
    上面还有一整个回合（侧栏标题「哈哈」与截图里的消息不是同一条），正是踩到这个。
  - **单回合自测永远复现不了**：当前回合 `.turn-group.running` / `[data-current-turn]` 强制
    `content-visibility: visible`，必须同页存在**第二个**实例（更早的回合头）才会失效。
  - 定量证据（**截头像那块区域 → PNG 回灌页面用 canvas 数颜色**，`uniq ≤ 2` = 根本没画）：
    运行态 346 / 完成态 347；注入一份「更早 + 离屏 + `content-visibility:auto`」的同 id defs 后
    **uniq=2（纯白一片）** = 症状 100% 复现。
  - 修法：底色改 **CSS 渐变**（`.codex-avatar-default{background-image:linear-gradient(…)}`）+
    `::after` 柔光；内部 svg 只画白色四角星，**不带任何 id / `url(#…)` 引用** ——
    全项目从此没有任何引用式 SVG 渐变，每个实例自给自足。
  - 验证：真启动 6/6 + 5/5 全绿（结构 = `span.codex-avatar-default`、内部 0 个 id、
    全页无 `id^=codex-avatar`；运行态 / 完成态 / 注入后像素 uniq = 344 / 351 / 351，
    旧实现注入后 = 2）；预检 3 条守卫逐条反证成立。
  - 顺带修掉一条**假红守卫**：「乐观阶段也有回合头」用 700 字窗口扫原始文本，而窗口里夹着
    一段长注释（原始距离 753 > 700，**剥注释后只有 367**）。结构判据一律先剥注释（`appNC`）
    再匹配 —— 窗口是给代码留的，不是给注释留的。反证：去掉乐观头条件 → 该条变红。

- **思考强度改「底栏按钮 + 宽彩色动态条弹窗」（09-17 用户三次迭代：「改成彩色横向拖动进度条，
  每个等级颜色都不一样」→「弹窗拖动，不是输入框直接一个长条，gpt 那种宽的彩色动态条」→
  「Codex 原生那些思考切换彩色进度条知道啥样不，给我做一个类似的，更好看的」）**：
  `src/components/EffortPicker.tsx`（原 `ComposerMenu` 的「思考」下拉退休）——
  底栏只留一个按钮（图标与档位名都染当前档位色），点开是弹窗：**宽条 34px 高、每档一段纯色**
  （色值按**档位名**固定，模型少声明一档也不会整体串色）、斜向扫光缓慢扫过、滑块下方光晕跟随、
  每档定位点、档位标签（当前档胶囊高亮并染该档色）、以及「当前档 + 一句用途」说明行
  —— 用途行对齐 Codex 原生 effort slider 的信息结构（原生那个内部叫 "juice"，每档带
  Light / Standard / Extended / Max 语义名 + 用途，取代离散 flags 与下拉菜单）。
  - ⛔ **色带不许放大**（`background-size` 必须 100%）：第一版用 220% + `background-position`
    平移做流光 —— 看到的只是色带的一段，**颜色与档位位置错位、分段被抹成渐变**，
    「每档一色」反而看不清（截图实测）。流光改由独立伪元素扫光实现。
  - ⛔ **拖动中绝不提交**：`changeEffort` 在档位未被模型声明时会 `upsertProviderModel`
    （IPC + 重写 model-catalog.json），拖动经过中间档位会反复触发；它还读过期闭包，连发多次会把
    刚选中的档位覆盖回去（09-16 真机踩过）。所以拖动只改本地 draft，**pointerup / keyup 才提交**；
    点档位标签则立即提交。
  - 弹窗必须 **createPortal + fixed**（底栏在滚动容器里，absolute 浮层会被裁掉上半截 ——
    设置页 `?` 气泡踩过同款）；宽度用 `min(340px, calc(100vw - 24px))`（预检的弹窗守卫会扫固定宽度）。
  - 验证：真启动 10 条全绿（按钮染色 / portal+fixed / 宽条 298×34 / 5 档 5 色 / 扫光+光晕 /
    定位点+标签+用途行 / 拖动中不落库 / 释放落库 / 点标签直接切档）；预检 ⑰b 加 8 条守卫，
    反证成立（色带改回 220% → 「分段色带保持 100%」变红）。

- **消息头改「回合级一份」+ 两处反馈提速（09-17 用户第三次反馈：「一轮会话就一个 Codex 名字和
  Codex 头像就行，就在会话上面就行」+「Codex 名字和头像没有第一时间出来，那个正在处理和那条
  灰线也没有在发送消息后第一时间出来」）**：
  - 头像 + 名字从**每条 agent 消息一份**提到**回合级一份**（`.turn-head`，TurnView 渲染）——
    一个回合可能有多段 agentMessage（工具调用前后各一段），原来会一份一份地重复长出来。
  - **「没第一时间出来」的真因**：头长在 agentMessage 内部，而 `if (!text.trim()) return null`
    （空片段不渲染，防空 div 撑出滚动条）会把整个消息头一起挡掉 —— 引擎建好 item 到首 token
    之间 text 是空的，所以名字头像要等第一个字才出现。提到回合级后**用户气泡一上屏就渲染**。
  - 「正在处理 N 秒 + 下面那条灰线」（`.running-process-time` 的 border-bottom）原条件是
    `running && isTaskTurn(turn)`，而 `isTaskTurn` 要求回合内出现过**工具调用** → 纯聊天或刚发出
    消息时压根不渲染。放宽成 `running && userItems.length > 0` —— ⛔ **不能只要 `running`**：
    turn/started 先建回合、userMessage 晚到，而乐观气泡排在 timeline **之后**，那段窗口里计时会
    顶到用户消息**上方**（09-17 实测 1002ms 复现，正是用户报过的同款错位「这个怎么到这个位置了」）。
  - ⛔ **顺序**（09-17 用户第三次反馈「你这顺序不对吧，生成中怎么能放灰线上面呢」）：
    **回合头 → 正在处理 + 灰线 → 生成中 → 正文**。计时 + 分隔线属回合头信息，状态词属内容区，
    灰线是这两者的分界。守卫 ⑰b 按源码顺序判（三者在同一个 `.turn-card` 内，源码序 = DOM 序）。
  - 「发送后**立刻**」的反馈由**乐观区块**的 `.turn-head` 负责：引擎要 1~2s 才有真回合
    （实测乐观气泡 552ms 上屏、真实 userMessage 3.3s 才到），这段窗口提前摆出「头像 + 名字」，
    回声后由 TurnView 接管（同构同位置 → 不断档）。⛔ 乐观区**不放**「正在处理 N 秒」：
    两处各挂一份会各自从 0 计时，接管那一刻数字跳回去。
  - 「你」（用户）的消息也有同款头（`.user-head`：名字 + 头像，**右对齐、头像圆形**，与 Codex 的
    左对齐 + 圆角方形镜像 —— 用户 09-17「人也要有名字和头像，位置跟 Codex 一样」）。名字来自
    `personalization.nickname`（App 的 `username` state，重启异步回读覆盖缓存），头像来自
    localStorage `user-profile` 的 `{ avatarType, avatar }`；经 `src/lib/user-identity.mjs`
    （与 `codex-identity.mjs` 同构的外部 store）分发，消息渲染链上不逐层传 props，
    `components/UserAvatar.tsx` 提供 `useUserName()` / `UserAvatar`（三态：图片 / 表情 / 名字首字）。
    气泡内那个 `.user-message .avatar` 本就是 `display:none` 的布局占位，不会与新头重复。
  - ⛔ **头像健壮性**（09-17 用户报「Codex 头像又不见了」）：这个症状**在 DOM 上看不出来** ——
    `<img>` 加载失败时尺寸 / 可见性 / 透明度全正常，就是没有像素（探针实测 22×22、visible、
    opacity 1，而截图里是空白；磁盘上连 `codex-avatar` 键都没有）。三个来源都要兜住：
    坏 base64 / 上传的图太大写不进 localStorage（`storeCodeAvatar` 是**静默** catch）/
    用户传了坏图。修法：① `CodexAvatar` 的 img 加 `onError` → 回退 `DefaultCodexAvatar`
    （即用户说的"测试里那个"紫色渐变头像）；② `UserAvatar` 同理回退名字首字；
    ③ 上传统一走 `fileToAvatarDataUrl`（canvas 居中裁 128×128），几 MB base64 不再撞配额。
    守卫 ⑰b 加了 3 条（两条 onError 回退 + 两处上传都走压缩）。
  - `.codex-turn .assistant-message` 回到**单列**（不再为头像留 22px 列，否则每段回复都自带一份
    头像、正文还被挤到右边）；`.avatar.agent` 仍被工具卡（imageView / imageGeneration）使用，
    别顺手删。守卫 ⑰b 已改成「回合级唯一头 + 消息内不得再有头像」的判据。

- **首次启动「环境体检」+ 一键补齐基础工具（09-17 用户：「很多新用户上来，工具都不会装，也不知道要装哪些，
  不装 Codex 啥也干不了」）**：`src/components/EnvCheckDialog.tsx` —— 首屏就绪后检测一次，**必备 5 项**
  （模型 / 工作区 / Git / ripgrep / **PowerShell 7**——09-18 用户点名「终端必要的工具」，缺失时终端退回 5.1）缺任一项就弹；
  **常用 3 项**（Python / jq / 7-Zip）列出但只提示不阻断。
  底部「一键安装 N 项」串行调 `installRuntime`（复用主进程 `runtime:progress` 进度），
  另有「不再提示」（localStorage `env-check-optout`）。复用既有能力（`listRuntimes` / `installRuntime` /
  `runtime:progress` 都已存在），**没有新增主进程 IPC**。
  - **⛔ 升级保会话：旧家 rollout 迁移（09-18 用户：「更新新版本…用户旧会话要能接着用」「复制ID，接力会话也不行」）**：
  09-10 前的老版本把引擎 CODEX_HOME 指在 `~/.codex`；切到 userData/codex-home 后**老会话三处全失联**——
  侧栏兜底扫描、复制 ID 引用（`buildThreadPreview`）、`thread/resume` 都只认新家。
  修：`migrateLegacyRolloutHome()` 挂在启动链 `server.start()` 之前——把旧家 `sessions/`、
  `archived_sessions/` 里新家没有的 rollout **拷贝**（⛔ 只拷不删：`~/.codex` 可能仍被官方 CLI 用；
  canonical 文件名按名判重天然幂等）进新家。**真机验收**（隔离 profile 起应用）：
  13 个旧家 rollout 迁入 → 侧栏 16 行可见、`previewConversation` 读旧会话 9 条消息、二次启动幂等零重复。
  预检 ⑰m【40】3 条（迁移存在 / 只拷不删 / 挂在 server.start 之前），反证 2/2。
  ⛔ 以后**任何**动 codexHome / 引擎家目录的改动，都必须先回答「升级用户的老会话去哪了」。
  - **探针协议回落 + 图片模态自愈（09-18 用户反馈：升级用户测 deepseek-v4.1-flash 两连错）**：
  ① 探针 404「does not support the coding plan feature」——火山 Coding Plan 类网关对部分模型的
  `/responses` 直接拒绝，但 Chat 通道是通的；探针只试单协议把"能用"误报成连接失败。
  修：`probeCustomModel` 显式 responses 也保留 chat 回落（`requestedWire`/`wireMismatch` 上报，
  `probeOneModel` 结果里如实标注协议差异）；coding-plan 404 附白话（换通用接入点/换模型）。
  ② 会话带图发送 InvalidParameter「Model do not support image input」——模型标了视觉但接入点
  （火山托管的 DeepSeek）不支持图片。修：**图片模态自愈**——回合错误原话明确点名时，自动摘掉
  该生效模型的 `image` inputType 并保存（保存即重载引擎配置，幂等），toast 说明；再加**入口门禁**
  （`insertComposerImages` 前查 `activeModelSupportsImage()`，不支持就拦在粘贴这一步）。
  **⛔ 同日追评推翻门禁（「带图发送直接报错、还不能正常对话，设计不合理」）→ 改为发送时降级**：
  `sendMessage` 在占位符剥离后、**所有下游构造（乐观气泡/排队/专家包装/正式 input）之前**做
  「图片降级发送」——生效模型不支持图片时把贴图转成路径注记拼进 messageText（`sendImages` 置空，
  五处 input 构造全部继承）：视觉插件已配置 → 引导模型调 describe_image（识图由插件自己的视觉
  模型完成，独立于聊天模型）；未配置 → 注记告知看不了图，对话照常继续。粘贴入口不再硬拦
  （硬拦会堵死降级链路）。守卫锚定**活条件**而非文本存在（`if (false &&…)` 死代码骗文本守卫，
  反证 A 实测抓到）；粘贴入口用函数体切片断言。预检 ⑰k【39】5 条；反证 3/3。
  - **后台安装（09-18 用户：「加一个后台安装功能，弹窗要知道缩小，安装完成自动消失」；起因是
    Python 下载挂住时弹窗卡死、安装中禁一切关闭，用户只能重启）**：点「一键安装」弹窗**立刻收起**，
    右下角 `.env-install-pill` 角标接管（实时进度、点开回弹窗）；**安装中允许关弹窗（关闭 ≠ 取消）**；
    全部装好角标自动消失，有失败自动展开回弹窗给重试入口。守卫【32】4 条（后台化收起 / 角标在
    渲染树 / 失败展开 / 不许再禁关）。
  - 用户拍板三条：**8 项**（不是 22 项全列——新用户列满只会更迷茫；09-18 补 PowerShell 7 到 8 项）/
    **弹窗确认后才下载**
    （Git 90MB 量级，静默装会突然吃带宽）/ **保留 Git 的后台静默自愈**（引擎跑命令的硬依赖，
    `autoInstallGitIfNeeded` 原样不动）。
  - ⛔ **`envCheckDoneRef` 这类「已执行」标记必须在真正执行处置位，不能放在 effect 开头** ——
    effect 依赖里有 `workspace` / `customModel`，启动过程必然变化 → effect 重建 → cleanup 清掉 timer，
    而标记已 true → 新 effect 直接 return → **timer 永不执行、体检永不弹**。
    09-17 真启动实测踩到（移走 `rg.exe` 模拟缺工具，弹窗依然不出现）；靠 `window.__envCheckDbg`
    埋点定位（`effectRan: true` 但没有 `timerFired`）。**该埋点保留**，用户再报「没弹」可直接看它。
  - 验证：真启动端到端 9 条全绿 —— 临时移走 `resources/tools/rg/rg.exe` 模拟缺失 → 弹窗出现
    （8 项 + 必备/常用两组 + 缺失项琥珀高亮 + 体积文案）→ **真点一次一键安装，22 秒装回 ripgrep**
    （`installed=true`）→ finally 恢复文件（try/finally 保证）。
  - 预检 ⑰c 守卫 8 条（8 项齐全 / 必备 5 项 / pwsh 在必备组 / **pwsh 平台门控——mac 终端用系统 shell
    不标必备** / 弹窗在渲染树 / 一键安装真接 `installRuntime` /
    `installableIds` 排除 model+workspace / optout 真被读），反证成立（抹掉 pwsh 项 → 3 条红；抹掉平台门控 → 变红）。
  - **出场时机（09-17 用户二次明确：「只在进入主界面的时候才弹配置引导和工具安装检测自动安装；
    如果已经配置模型，就不引导模型配置，直接做开发工具检测安装」）**：两个引导都靠 `showLogin`
    挡在登录页之外（登录页是**提前 return 的渲染分支**，弹窗挂在那之后，物理上也弹不出来）；
    已配模型（`customModel` 有值）时模型引导不弹 → 直接进行体检；没配模型时先弹模型引导，
    **关掉后体检会补上** —— 体检 effect 的依赖含 `showModelGuide`，靠重建补跑。
    ⛔ **这条依赖不能删**：删了就变成「没配模型的用户关掉引导后永远看不到体检」（静默失效）。
    真启动验证 8 条全绿（`seedRealConfig:false` + 无历史 = 真新用户：首屏登录页 → 不弹任何引导
    且埋点为空 → 点「暂时不登录，直接进入」→ 先弹模型引导 → 关掉 → 体检弹出并列出 ripgrep「待安装」）。
  - 登出（`handleLogout`）会把两个引导弹窗一起收起：登录页看不到它们，留着状态会在重新登录回到
    主界面时「突然重现」。**但两个 done 标记不复位** —— 工具装没装跟账号无关，复位会让刚点过
    「稍后再说」的体检再弹一次。
  - Git 的后台自愈在主进程 boot 就启动（`main.ts` `autoInstallGitIfNeeded`，不等登录）——
    新用户停在登录页那段时间，90MB 的 Git 已经在后台装了。

- **Codex 身份两处显示 bug（09-17，用户「排版严谨一点」+「头像我也没看展示出来」）**：
  ① **消息头只剩名字、头像整个不见了**：真因是历史遗留的两条规则 ——
  `.codex-turn .assistant-message { grid-template-columns: minmax(0, 1fr) }`（单列）
  ＋ `.codex-turn / .process-content .assistant-message .avatar { display: none }`，
  它们是为「assistant 消息左侧不放图标」的老设计服务的。加「头像 + 名字」时没发现，
  于是名字在、头像被 `display:none`（真启动断言实测 `cell:[0,0] / display:"none"`）。
  修：恢复 22px 头像列 + `column-gap: 8px` + 取消 display:none。
  **预检 ⑰b 守卫**（⛔ 判 CSS 前必须先剥注释，否则被注释里的 `display:none` 顶成假绿）。
  ② **用户中心「Codex 的身份」卡排版错乱**：该卡复用了「你自己」资料卡的 `.uc-*` 类名，
  其中 `.uc-presets button { width:30px; height:30px }`（表情头像选择器的方块样式）把
  「用默认名」压成 30px 宽 → **文字竖排断行**；`.uc-name` 的 18px 让标题过大；
  `.uc-avatar` 的圆形底把方形默认头像裁圆。修：改用独立 `codex-id-*` 类名 + 一整套样式
  （标题 14px / 说明 12px / 名字行 input 200px + 按钮 `white-space:nowrap` / 头像 56px 圆角方 /
  上传与恢复按钮贴两角错开）。**教训：复用别的卡片的类名 = 连带复用它的排版假设** ——
  跨卡片复用要么只用纯外壳类，要么另起一套类名。

- **切换会话卡顿：resume 结果被 seq 丢弃，缓存永远建不起来（09-17，用户「切换会话还是会卡顿一下，
  那个会话懒加载渲染没生效了吗」）**：实测（`accept --only switch-speed`）拿到两条曲线 ——
  **命中缓存 p50 = 9ms，冷加载 p50 = 200ms**，但 `cached.n=1 / fresh=8`：**秒开机制本身是好的，
  问题是几乎从不命中**。真因在 `openThread`：`if (seq !== switchSeqRef.current) return;` 排在
  `threadCacheRef.current.set(id, mergedLoaded)` **之前** —— 用户快速连切 A→B→C 时，A、B 的
  resume 结果在「已切走」那行被整个丢弃，缓存里一个都没留下，于是下次切回仍是冷加载。
  **修复：缓存先写、再判 seq**（切走了只是不许它动视图，不是不许它进缓存；已切走路径再
  `mergeLongerStreams` 合一次，防同一会话并发两次 resume 时后到的旧结果把新内容顶短）。
  ⛔ 这是「懒加载没生效」的真实形态：`TURN_WINDOW` 窗口切片（`visibleTurnWindow`）一直是生效的，
  失效的是**缓存预热**——先看分组数据（cached/fresh）再下结论，别盯着渲染窗口改。

- **设置页「?」说明气泡 + 头部单行化（09-17，用户「这个布局改一下，在一排了不好看」「文字赘述过多，
  都在一排了，空白太多，要求紧凑一点」「看看设置界面里面是不是有很多赘述过度的，都改成？号，
  鼠标放上去展示」「帮助展示的位置放的都不好看」）**：**19 处**改用标题旁的 **`?`**（17 处长说明从
  标题下收进，另 2 处是**补回改造时漏掉的入口**：模型页、专家和专家团页），
  hover 展示气泡、气泡底部带「查看完整帮助」—— 于是各页那个占位的「帮助」按钮**退休**（两件事一个解法）。
  - `src/components/SettingsHead.tsx`：`PageInfo`（? + 气泡）+ `HelpOpenContext`。帮助入口走 context
    注入 `setHelpKey`，**不逐页传 prop** —— 二十多个头部每处传一遍，漏传的那个会静默点不开。
  - **⛔ 气泡必须 `createPortal` + `position: fixed`**：设置内容是滚动容器（`overflow:auto`），
    absolute 浮层会被**裁掉下半截**；宽度还要按窗口自适应（写死 380px 在窄窗口溢出屏幕右侧）。
  - **⛔ 只收「>40 字」的，短句留在原地**：≤40 字的内联说明只占一行，硬收进 ? 反而让用户多点一次。
    该判据已写进预检（「赘述回潮」：`settings-copy` 里出现 >40 字内联段落即红）。
  - 语音页的 ? 在子组件里（`VoiceSettingsSection`，最容易被漏改的一页）。
  - 预检 ⑮ 守卫从「帮助按钮数」改写为：? 挂载数 ≥15 / 兼帮助入口的 ? ≥6 / 赘述回潮 / 赘述回潮宽度与定位。

- **Codex 身份：名字 + 头像（09-17，用户「给 codex 消息上面加名字和头像、按用户取的名字展示、默认 codex、
  还要能上传头像、默认头像设计好看点」）**：assistant 消息头部由单个 Bot 图标改为**头像 + 名字一行**
  （名字取用户取的，默认 `Codex`）；用户中心新增「Codex 的身份」卡（改名 + 上传头像 + 用默认名/头像）。
  **单一真相源 = `src/lib/codex-identity.mjs`**（模块级 store + `useSyncExternalStore`）：
  assistant 消息渲染在 `ItemView`/`renderItem` 那条链上，逐层透传会污染十几个组件签名，而它只在改设置时变一次。
  **落盘分工**：名字 → `personalization.assistantName`（主进程落盘，且 `applyPersonalizationToAgentsMd`
  会写进 AGENTS.md，**引擎也知道自己叫什么**）；头像 → `localStorage`（base64 图片，放进那个 JSON 会撑大几十倍）。
  **默认头像**：`src/components/DefaultCodexAvatar.tsx`（圆角方形 + 靛蓝→紫渐变 + 四角星）——
  用圆角方而非圆形是为了与侧栏应用图标成体系、并与"用户头像（圆形）"一眼区分。
  **⛔ `src/lib/*.mjs` 是纯 JS**：`export type` / 参数类型标注 / `new Set<() => void>()` 都会让 rolldown
  直接 PARSE_ERROR。我在 enhance-hints.mjs 与 codex-identity.mjs 上**各踩一次**（第二次是因为教训只写进记忆
  没变成守卫）→ 预检【32】⑱ 现在按结构扫所有 `src/lib/*.mjs`，7 条判红 + 3 条不误报的反证全成立
  （反证过程中修掉守卫自身 2 处漏检：`const y: number` 的声明前缀、泛型正则被箭头函数 `=>` 的 `>` 截断）。

- **用户头像类型链：回调别放宽联合类型（09-18 维护）**：`UserCenter.tsx` 的 `onProfileChange` 曾把
  `avatarType` 声明成 `string`（内部 `UserProfile.avatarType` 本来是 `"emoji" | "image" | "none"`），
  于是 App 侧只能 `userAvatar.type as UserAvatarSpec["type"]` 硬转回来 —— **两种写法都能编译**，
  但 cast 掩盖了「`string` 脏值（例如 localStorage 被手改成别的值）直接进 `setUserIdentity`」这个洞。
  已改成：回调签名保留 `UserProfile["avatarType"]`、App 侧 state 直接用 `UserAvatarSpec` 联合类型、cast 清零。
  预检 ⑰e【33】两条守卫钉住它（反证：签名改回 `string` → 守卫变红 + `tsc` 报 TS2345）。
  ⚠️ 注意 `npm run check` 的前端构建**不做 tsc**（只有 electron 侧有），所以这类类型洞必须在预检里靠
  源码结构断言兜住，或手动 `npx tsc -p tsconfig.app.json --noEmit`。

- **模型配置引导弹窗（09-17 用户要求：首次启动给新手引导）**：`src/components/ModelSetupGuide.tsx`，
  只在**没有生效模型**时弹（用户确认的条件：配好即永不再弹）；两条路直达（官方订阅登录 / 添加供应商）。
  **⛔ 判据是"没有生效模型"而不是"供应商列表为空"**——有供应商但没勾模型同样发不出消息。
  **⛔ 判断时机**：等首屏数据到位**再等 1.2s**（`threadsLoading` 结束只说明会话查完了，供应商配置是另一路加载；
  不等这一下配置正常的老用户会被误弹 —— code review 发现）。关闭后本次启动不再弹。

- **归档后提示浮层（09-17 用户要求：归档后弹窗 + 可跳归档页 + 5 秒 + 可叉掉）**：
  `src/components/ArchiveToast.tsx`，右上角浮出，点「查看归档」跳设置→归档管理；悬停暂停倒计时。
  **⛔ 回调必须用 ref 持有、effect 只依赖 token** —— 调用方传内联箭头函数时，若依赖里带回调，
  每次父渲染都会重置计时器，提示**永远不会自己消失**。

- **供应商名字下移 + 必填（09-17 用户要求）**：从编辑区顶部挪到表单字段；新增必填（原先默认"自定义供应商"，
  多个重名无法区分）；保存按钮据此禁用并在左侧直接写明原因。
  **⛔ 坑**：`editingProvider/setEditingProvider` 是从 `useCustomProviders()` **解构**来的，
  在该位置再 `useState` 一次即重复声明；同时 `editingName` 有 5 处调用（切换供应商时退出重命名态），
  名字挪走后整个状态与调用要一并清除。

- **增强按钮提示气泡（09-17，用户「输入内容后那个亮起来的功能，加个小气泡提醒，词库丰富个性一点」）**：
  输入框右侧的 AI 优化按钮（`.enhance-button`，紫色星星）上方浮出小气泡，文案取自
  `src/lib/enhance-hints.mjs` 的 18 条词库（随机且不与上一条重复）。**触发条件三条叠加**（用户定稿）：
  ① **每次启动应用后的第一次输入必弹** ② 之后每 5 次成功发送弹一次 ③ 输入长需求（≥50 字）弹一次；
  6 秒后自动消失；点气泡本体=开始优化，点右侧 ✕=只关提示（`stopPropagation`），点增强按钮也消费掉。
  **⛔ 条件①必须是"每次启动"而非"仅首次安装"**（这是我第一版的错，被用户纠正）：判定用
  **模块级变量**（`let shownThisRun`，应用启动重新加载 JS 自然归零），**绝不能落 localStorage**
  —— 落盘会让老用户永远看不到这个功能。预检里专门有一条断言"不落盘"。
  **⛔ 条件③必须双向节流**：按"编辑会话"节流（输入清空才重置 `enhanceLongFiredRef`），
  且三条触发共享 `HINT_COOLDOWN_MS` 冷却窗口，否则边打字边弹/刚弹过又弹 = 骚扰。
  **⛔ 两个真坑（实测踩出来的）**：
  ① **不能"发送成功当场显示"** —— 那一刻输入框已清空、回合在跑，增强按钮本身
  （`prompt.trim() || hasEnhanceBackup`）根本不渲染，气泡**没有任何可依附的位置，等于永不出现**。
  计数只置 pending，展示挂在 `enhanceAnchorVisible = (prompt.trim() || hasEnhanceBackup) && !activeThreadRunning`
  上 —— **展示条件必须与被依附按钮的渲染条件逐字一致**，该 effect 放在 `activeThreadRunning` 定义**之后**。
  ② **`.enhance-hint` 必须写 `width: max-content`** —— 绝对定位元素在 32px 宽的按钮容器里会
  shrink-to-fit，气泡被压成**竖排窄条**（一个字一行）。这条**断言全绿但视觉是坏的**，是截图抓出来的：
  **UI 改动必须看截图**，并补了宽度断言。
  **⛔ 增强的"取消"与"还原"**（用户 09-17 明确要求"不满意要能取消增强、返回原输入"）：
  还原原文一直有（`enhanceBackupRef` + 按钮转 revert 态）；但**"增强中取消"原是假功能**——
  只把 loading 关掉、`enhancePrompt` 请求仍在飞，返回后照样 `setPrompt(增强结果)` 覆盖用户输入。
  修法：`enhanceRunIdRef` 取消令牌，`await` 回来后先验令牌（不一致就静默丢弃），`cancelPromptEnhance()` 作废在飞请求。
  进度：**`src/lib/enhance-hints.mjs` 的 `mjs` 是纯 JS，不能写 TS 类型标注**（`const X: string[]` 会让
  rolldown 报 PARSE_ERROR；类型放同目录 `.d.mts`）。
  预检【32】⑰ 十三条守卫 + 10 条变异反证成立（反证过程暴露并加强了 3 条太弱的守卫：长输入阈值需测
  **49/50 边界**、节流需测**耦合表达式**、取消令牌需锚在**请求之后紧跟的位置**——只查文本存在会被
  同名的另一处顶成假绿）。CDP 真启动验收 12 条曾全绿（真发一条消息走完整链路）。

- **设置总览帮助（09-17，用户看截图点名标题栏空白处）**：设置弹窗标题栏加「设置总览」按钮，打开
  宽版弹窗（760px）展示**6 组 23 页的分组地图**：每页一行三列 = 页名 / 这页干什么 / 什么时候会用到它，
  页名可点**直接跳到该页**（`onNavigate` → `settingsNav.flatMap` 反查页面 key），组内标「新手先看」
  （模型/专家团/开发工具），末尾给「第一次使用的最短路径」（模型→个性化→外观）。
  **内容组织原则**：新手卡住的不是不会点按钮，而是**不知道该去哪一页** —— 所以总览按「我想做 X → 去 Y 页」
  的动线写（每页都答"什么时候用"），不是照抄导航列表。6 组各自有 purpose 一句（该组解决什么）。
  **⛔ 最容易复发的失效形态：新增设置页但总览没同步**（新手照总览找不到那页，比没有总览更糟）——
  预检【32】⑯ 核心断言是「OVERVIEW_GROUPS 的 page 集合 ⊇ settingsNav 展示文案集合」（集合包含关系，
  不是数量比对）；另断言跳转接线、标题栏入口、页数动态计算。5 条变异反证成立
  （含"往导航加一页但总览不同步"这条真实事故形态）。
  **简介里的页数必须动态算**（`OVERVIEW_GROUPS.reduce`）——写死数字在新增页后必错，
  而帮助文本里的数字写错是最隐蔽的误导（本轮初版写「22 页」实为 23，被验收断言抓出）。

- **设置页「使用帮助」（09-17 用户要求：新手帮助，弹窗展示）**：模型/插件/技能/MCP/专家团/语音/开发工具
  七页各加「帮助」入口，点开弹窗展示**分步骤操作指引 + 常见问题**。
  **做成组件而非各页各写**（`src/components/HelpDialog.tsx`）：七页结构完全一致（步骤/注意/常见问题），
  各写一遍必然措辞与交互不一致，且加一页要复制一遍。内容集中在 `HELP_CONTENT`（`HelpKey` 联合类型约束）。
  **内容纪律**：只写**当前应用真实有的入口与字段**（写前逐页核过控件名与按钮文案），不写"未来可以"这类承诺
  ——新手照着做走不通会直接失去信任。帮助按钮统一 `HelpButton`（`App.tsx` 内，用 `setHelpKey`）。
  **挂载点分布**：插件/技能/MCP/专家团挂在 `settings-heading-actions`（与现有按钮同排）；
  模型（`provider-list-head`）、专家中心/专家和专家团/开发工具（`settings-copy`）跟在标题后；
  语音页在子组件里，走 `onOpenHelp` prop（不塞魔法字符串给 onNotice）。
  **⛔ 最常见复发形态**：加了组件但**漏挂某一页**，或 `HELP_CONTENT` 少一个 key（点帮助空白/打不开）。
  预检【32】⑮ 五条守卫（key 齐全 / 挂载数 ≥5 / 弹窗在渲染树 / 语音页入口 / 每主题步骤 ≥3），
  4 条变异反证全成立。真启动验收 7 页 × 3 断言 + 语音页 3 断言全绿。

- **⛔ 启动加载页（09-17 先测后定）**：用户要「做一个启动加载动画」，按用户选择先量化再定方案。
  **实测构成（3 轮采样）**：Electron 冷启动 245~396ms → 页面加载+React 挂载 **1.6~2.1s**
  → 等首屏会话数据 **1.3~2.1s**，总计点到有内容 **3.0~3.8s**。两个结论都推翻了预设：
  ① **白窗期实测 ≈ 0ms**（窗口创建→page-start-loading：−5/−2/−1ms）⇒ 原生 splash 窗口（方案 A）
  要解决的问题不存在，**不采用**（而它的焦点抢占/多实例/退出残留风险是实打实的）；
  ② 真正的空白在**挂载之后**——index.html 那份内联 splash 在 `createRoot().render()` 时被整块替换，
  而首屏数据还要 1.3~2.1s 才到，这段界面上毫无反馈（这才是用户"没看到启动动画"的真因）。
  **落地 B+**：`src/components/BootSplash.tsx` 用同一套 `.boot-splash` 类名在挂载瞬间接手，盖到
  `done`（首屏会话数据到达 / 需要登录）再淡出 280ms；阶段由真实状态驱动（starting→engine→threads→ready，
  见 `window.__boot.stages`）；启动 <300ms 直接不显示（避免一闪而过）。样式**必须内联在 index.html**
  （JS 未加载时也要能显示）且**必须跟主题**（固定深黑在亮色主题下黑闪）；index.html 顶部同步 script
  把 localStorage "theme" 写进 `<html data-theme>` 防止首帧主题闪烁。
  **保留的测量设施**：`electron/boot-timing.ts` → `userData/boot-timing.json`（各阶段毫秒，留最近 20 次）
  + 渲染层 `window.__boot`（mount/firstData/stages）。**怀疑"启动变慢"先读它，别猜。**
  **已知未做（用户未选）**：首屏主 JS **1.86MB** 是第二段 1.6s 的成因，动画只掩盖不解问题，
  真正的解法是按需拆包。预检【32】⑭ 五条守卫 + 7 条反证全成立。

- **⛔ 状态色必须真绿（09-17，用户「启用跟禁用一个状态，没有颜色区分」）**：`--green` 曾被写成
  `#1e1e1c`（近黑，暗色主题 `#ececea` 近白）——**不是绿**。全系统 299 处「成功/激活/已安装」视觉
  （内置插件已配置徽标、开发工具已安装、记忆激活、技能完成、子代理徽标、紧凑分割线 success……）
  因此全部静默失效成中性色，看起来「有状态文字没状态颜色」。修：亮 `#1a7f37` / 暗 `#4ec27a`
  （`--green-dark` 零使用，是死变量）。预检【32】⑬ 有通道级守卫（G 通道必须高出 R/B ≥ 40），
  改回中性色直接红。**教训**：用 `var(--green)` 做状态色时先确认变量值真是绿——`color: var(--green)`
  语法合法、值错了不报错，只有渲染取色能暴露。

- **内置插件快捷按钮三态（09-17 同一轮）**：生图/视觉辅助按钮原先只有「已配置」一态（`configured`），
  不体现「启用插件」开关——停用后照样绿勾。现三态：绿`configured`=已启用 / 琥珀`off`=已停用
  （CircleOff 图标）/ 中性=未配置；状态取 `savedCfg`（保存后的权威值）。真启动验收含
  「摘掉 .off 规则取色必须回落中性」的运行时反证。
  **09-18 排版重做**（用户截图反馈「上面那一块怎么排版没优化，还有这么多文字赘述」）：
  旧版用 `.channel-heading`（`align-items:center`）把 4 行长文案和三个按钮挤在同一 flex 行 →
  段落末行飘到按钮下方；且「按钮里塞状态」（`生图插件 | 已停用`）分不清是按钮还是徽标。
  现结构 = `内置插件 + 一句话说明` 一行（说明压到 1~2 行：36 字）、`保存配置` 置该行右上、
  两张**能力卡**（严格说三态移到卡的边框+徽标：绿/琥珀/中性）排在网格里。
  判据（真启动 CDP，19 项）：文案与按钮**不重叠**、两卡**同一行**、`gridTemplateColumns` 两列、
  三态取色通道值 [111,111,105] / [26,127,55] / [194,117,28] 互不相同；反证 E1（网格改单列）→
  「同一行」「列数=2」红；E2（摘掉 `.off` 取色）→「停用偏暖」「三色互不相同」红。
  ⛔ 教训两条：① **颜色解析要兼容 `color-mix()` 的 `color(srgb r g b)` 序列化**（0~1 小数），
  按 `/\d+/g` 抓数字会把小数位当通道值 → 断言假红；② **「两卡等宽」不是"两列"的判据**
  （单列下两卡仍等宽）——它是"内容没把卡撑变形"的检查，反证时期望别写错。
  顺带清掉上一版遗留的**死 CSS**（`-quick/-actions/-head/-body`，TSX 零引用）。

- **生图/视觉插件模型字段：内置热门生图模型参数 + Tab 补全（09-18 用户：「把目前市面上的热门生图模型
  内置一下参数，跟模型配置里面一样，支持 tab 补全」）**：该字段原是原生 `<datalist>`（只能点击/方向键，
  **Tab 补全做不到**，也看不到任何参数）。现换成 `ModelIdInput` 的 `variant="image"`：
  - 规格表 `src/lib/image-model-specs.ts`：与聊天 `model-specs.ts` 同思路、**字段换成生图口径** ——
    **尺寸**（常用像素值 / 分辨率档 / 自定义规则：步长·单边·总像素·比例）、**改图**（参考图张数）、
    **质量档**（quality 取值）、单次张数、比例数。收录：GPT Image 2.5（Flare/Sunburst）、GPT Image 2、
    Nano Banana 2/Pro、Imagen 4、FLUX.2、Seedream 5 Pro/Lite 与 4.5、Qwen-Image、WAN 2.7、Grok Imagine、
    Ideogram V3、Recraft V4、Hunyuan Image 3、SD4。⛔ **拿不准的字段留空**（未收录模型 `matchImageSpec`
    返回 null、界面不显示任何徽标 —— 少一个徽标胜过给一个错的参数）。
  - 徽标 = 尺寸 / 改图≤N 张 / 质量档；选中后字段下方摊开 `imageSpecHint()` 一两行（含自定义尺寸硬规则，
    与 `harness-media.mjs` 的 `checkSize`（16 倍数 / ≤3:1 / 面积 655360–8294400）同口径）。
  - ⛔ **候选行构造抽成纯函数 `buildImageModelRows()`**：组件内分支只能用文本守卫，而文本守卫挡不住
    `if (false)`（反证 G/F 当场抓到）——抽出来后预检能直跑真代码断言。
  - ⛔ 浮层方向/高度：字段常在弹窗底部，弹窗 `overflow:auto` 会把向下弹的候选裁掉 ⇒ 按**最近裁剪祖先**
    的可用空间决定上弹并封顶高度。只判方向的版本被真机验收抓到「上弹后顶出弹窗 7px、首行被切」。
  - 预检 ⑰n【41】27 条（真表行为断言 + 结构断言），反证 7/7（`if(false)` 架空分支、候选返回空、
    把 2.5 的质量档安到 2 代、给 Seedream 4.5 加官方明确不支持的 1K ……）。
  - ⚠️ 教训：**`tsc -b`（`prebuild`，构建口径）与单跑 `tsc -p tsconfig.app.json --noEmit` 不是一回事** ——
    本轮前者报 30+ 个语法错、后者报 0，差点把语法错误的代码放行。验证一律以 `npm run check` 为准。

- **「插件」页刷新入口唯一化（09-18 用户：「插件市场有两个刷新按键…保留上面的，里面不要」）**：
  原先同一屏两颗同款 🔄 —— 标题行那颗刷**页面资源**（技能/钩子/已装插件/记忆/任务/MCP，
  `refreshSettingsResources`），市场工具栏那颗只刷**市场列表**（当前分类/搜索/页码，`refreshMarketPlugins`）。
  功能不重复，但挨着放没人分得清。合并成标题行一颗 `refreshPluginsPage()` = `Promise.all([两者])`，
  市场沿用当前筛选与页码（与旧按钮行为一致），工具栏那颗删除。预检 ⑰g【35】两条守卫
  （插件 section 内 `title="刷新…"` 只能有 1 颗；`refreshPluginsPage` 必须同时刷市场），反证 E1/E2 成立。
  ⛔ 两条方法论教训：① **`window.codex` 是 contextBridge 冻结对象**（`frozen:true`、赋值被静默忽略），
  所以「给桥接方法打点计数」这条验证路径在**渲染层走不通** —— 想验证调用次数只能靠源码级守卫 + 反证，
  或在主进程侧观察；② 判断 loading 用 `.spinner`（`<Spinner/>` 渲染的是 `<span class="spinner">`），
  `.spin` 只是 `<RefreshCw className="spin">` 的动画类，用它采样会恒 0 → 误判"没反应"。

- **并发安装假失败：用户反馈「安装失败：Error invoking remote method 'runtime:install': Error: 该工具正在安装」**
  （09-18 截图）。触发链很日常：**首次启动的 Git 后台自愈安装**（`autoInstallGitIfNeeded`，仅 Windows）
  占住 `runtimeInstalls["git"]`，而体检弹窗「一键安装」里 git 恰好排第一位 →
  `runtime:install` 旧实现 `if (runtimeInstalls.has(id)) throw` 直接抛错 → **渲染层循环外只有一个 try，
  整批中断**：三项一个都没装、弹窗不关、清单原样不动，用户只看到一句"安装失败"。
  三处一起修（缺一处就复发，且都是静默的）：
  ① `electron/main.ts`：并发同 id → **`await` 那个在飞的 promise** 并返回 `{joined:true}`（成功一起成功；
  真失败仍抛真实错误，不假装成功）；② `src/App.tsx` `installEnvMissing`：**逐项 try/catch**，
  一项失败只记录，其余照装，结束区分「全败 / 部分完成 / 全成」，并回读清单让装好的立刻变已就绪；
  ③ `EnvCheckDialog.installableIds` 排除 `installing` 项（正在后台装的别塞进批量），行内显示「安装中…」。
  预检 ⑰i【37】三条守卫；反证 A/B/C 全红（A 改回抛错 / B 改回整批中断 / C 塞回 installing）。
  **真实验收**（CDP 起真应用，对同一 id 连发两次 `installRuntime`）：两次都成功、第二次 `joined:true`；
  反证（改回旧行为）→ 逐字复现用户那句报错。样本用 jq（1MB 真下载，非 mock）。

- **⛔ mac 全面适配第二轮（09-17，用户「MAC 的适配要做全，全方面适配」）**：一轮全库审计（215 个源文件，
  逐条判读平台分支与 Windows 假设）挖出 15 处真缺失，全部修掉并进预检【32】19 条守卫。按影响排序：
  ① **mac 取麦会被系统杀进程**：`electron-builder.mac.cjs` 的 extendInfo 缺 `NSMicrophoneUsageDescription`
  —— macOS 的 TCC 对缺声明的 App **不是拒绝授权、而是直接终止进程**，语音通话/听写首次取麦即闪退；
  ② **关窗后重开 = 功能全哑**：mac 上「关窗 ≠ 退出」（红点关窗后应用留在 Dock），而 `window-all-closed`
  照 Windows 那样 `cleanupAll()` 把引擎/本地服务/调度器/渠道机器人全停了，点 Dock 重开只有空壳窗口
  ⇒ darwin 下跳过清理，真正清理交给 `before-quit`（cleanupDone 幂等）；
  ③ **手机配对隧道在 mac 上从不启动**：`remote.ts` 写死 `path.join(process.cwd(), "resources", "tools", "cloudflared.exe")`
  —— 既依赖 cwd（mac 上是 .app/Contents/MacOS，必落空）又写死 .exe；改为 `toolsRoot()` + 平台布局，
  并让 `prepare-mac-tools.cjs` 现造 `cloudflared-darwin-<arch>.tgz`（mac 包此前**根本没有**隧道二进制），
  `verify-packaged-tools.cjs` 加 mac 断言（存在 + 有执行位）；
  ④ **ffmpeg 在 mac 上找不到**：`resolveFfmpegPath` 只找 `ffmpeg.exe` 且用 cwd ⇒ 渠道语音（飞书 opus→16k wav）必失败；
  ⑤ 其余：docker 系统探测补 darwin（`/Applications/Docker.app`、`/opt/homebrew/bin/docker`）、
  `npmShimPaths` 补 POSIX 的 `bin/<pkg>`、`CODEX_REAL_PWSH` 走 `bundledPwsh()`、`tarExecutable` darwin 用
  `/usr/bin/tar`、终端面板的 PATH 分隔符/路径拼接/自绘提示符平台化、语音默认呼叫键改
  `CommandOrControl+Shift+M`（Windows 仍是 Ctrl）、`hotkey-match` 按平台解析 `CommandOrControl`、
  语音设置面板录入记 `Command` 且显示 ⌘⇧M、`gitBin()` 补 darwin 候选（GUI 进程 PATH 是 launchd 最小集）、
  开发工具卡文案按平台覆盖（`DARWIN_SPEC_TEXT`，不再让 mac 用户看到「装 Git 约 90 MB」）。
  ⛔ 判据纪律：本机是 Windows ⇒ 所有 mac 分支**只能靠结构性断言 + 纯函数行为断言**锁定（【32】⑫ 就是
  `macHotkeyLabel` 的 5 条真值表），产物层另有 mac CI 的 `verify-packaged-tools.cjs` 兜底。

- **发版前的 mac 适配审计（09-18，v0.0.21）**：把「自上次发版以来**新增的行**」按平台敏感模式扫一遍
  （`.exe` / `win32` / `Ctrl+` / 反斜杠路径 / PowerShell / Windows 命令 / `%APPDATA%`），逐条判读。
  本轮抓到一处真问题：技能中心说明把用户数据目录写死成 `${userDataPath}\codex-home\skills`，
  mac 上会显示成 `/Users/…\codex-home\skills` → 新增 `displayPath(base, ...parts)`（按平台选分隔符）。
  预检 ⑰h【36】两条：① `src/**/*.{ts,tsx}` 剥注释后不得出现 `\codex-home|skills|sessions|plugins|...`
  （**1~2 个反斜杠都算**：`\\x` 是源码转义形态，单 `\x` 在模板串里会被 JS 吃掉分隔符，两种都错）；
  ② 展示路径必须走 `displayPath()`。反证 E1（还原原文形态）/E2（单反斜杠）均变红。
  ⛔ 教训：**审计只看"新增行"**（别人验证过的老代码不重复审），但**注释要先剥离**——说明性文字里
  会刻意出现反例（`displayPath` 的注释里就写着 `\codex-home` 这个坏例子）。
- **⛔ 第 0 步已固化为常驻脚本 `scripts/mac-audit.mjs`（09-18，发 v0.0.25 时沉淀）**：`node scripts/mac-audit.mjs <上一版 tag>`
  —— 不传 tag 时自动取最近的 `v*`。它内置**正则自证**（8 条正则各配正/反例样本，任一条不符直接 exit 1、拒绝给出结论），
  再按模式分组列命中并标注「多半是断言夹具 / 疑似平台门控 / 需人工确认」。
  ⛔⛔ **为什么必须内置自证（当天实测的假通过）**：我第一版临时脚本把 Windows 绝对路径正则写成 `[A-Za-z]:\\`
  （JS 正则里 = 匹配**单**反斜杠），而源码里的路径字面量是**双反斜杠**（`"C:\\Users\\..."`）
  ⇒ 它对源码形态**永远不匹配**，报出的「0 命中」是假的、差点当成审计通过发版。
  **「0 命中」与「正则写错了」在输出上完全一样**，所以自证样本要**两种形态都喂**（源码转义形态 + 运行时形态），
  且**双向验**（正例必须命中、反例必须不命中——反例也会写错，我写过一条反例本身含 `powerShell` 字样）。
  v0.0.25 审计结论：命中 10 条（`ctrlKey || metaKey` 1 条 + 反斜杠 9 条），**逐条判读后 0 处真缺口**——
  反斜杠那 9 条 = 4 条断言夹具 + 3 条跨平台正确的分隔符/文件名正则（`[\\/]` 归一、非法字符清理）+ 2 条扫描器误报（`[ \t]`）。

- **「开发工具」双平台覆盖核查（09-18 用户问「工具有没有考虑 Windows 和 mac 两种版本」）**：
  逐层查完，**下载链路是分叉的**（`install-runtimes.cjs` 顶部 `IS_MAC` + `mainMac()` 一整套 darwin 资产：
  node/python/pwsh/ffmpeg/vscode-cli/jq/ninja/7zip/yt-dlp/rg/uv/cmake/conda 各有 mac 构建，git 走系统
  Xcode CLT 引导，`chmod +x` 统一补执行位；「装没装」判定走 `DARWIN_MARKERS` + `runtimeInstalledBySystem`
  的系统探测（git/openssl/docker）；mingw 在 mac 隐藏）。**查出一处真缺口并修掉**：
  `scripts/install-automation.cjs`（随包内置能力的「修复安装」回退，`build/copy-mac-tools.cjs` **明确把它
  拷进 mac 包**）只认 Windows 的 `python.exe` / `7z.exe` 两个解压器 ⇒ mac 上点「修复安装」必然报
  「缺少 python 与 7z，无法解压」——**把平台缺口说成缺依赖**。修：抽 `pickExtractor(platform, exists)`，
  darwin 走 `ditto`（保留 symlink/执行位，npm 包里有 symlink）→ 内置 `python/bin/python3` → `/usr/bin/unzip`
  三级回落；Windows 路径与参数**逐字保持不变**；加 `require.main` 守卫（被 require 时不执行主流程）。
  预检【34】三条：① 两平台安装表 id 集合一致（仅 mingw 例外，与 `DARWIN_HIDDEN` 同源）
  ② `require.main` 守卫在 ③ **行为断言**（require 真模块跑 `pickExtractor`，mac 三档 + 「不再选中 Windows `.exe`」+ Windows 三档）。
  ⛔ 教训：守卫③第一版写的是文本匹配（只查文件里有没有 `/usr/bin/ditto` 字样），**把 `darwin` 改成任意
  字符串它照样绿** —— 反证 F 当场抓到；改成 require 真实现跑纯函数才立住。**能 require 的模块一律用行为断言，
  文本匹配只配当"结构存在性"的最后兜底。**
  另：反证脚本自身也踩了「匹配旧 fail 文案」的坑（守卫改了文案、反证还在找老字符串 → 报"没红"的假结论），
  改文案时必须同步改反证匹配串。

- **⛔ 调度独占锁的「孤儿持有者」（09-17 用户实测：「都关掉了，怎么还提示被锁住了」）+ 一键释放**：
  锁的持有者是**从 `thread-runtime` 记录派生**的（第一个 `dispatch.enabled` 的线程），而**会话被归档/删除时
  没有任何地方清这条记录** —— `thread-runtime-store.ts` 里那句注释「删除/归档线程、记录被清掉时锁会自动
  释放」当年只是**设想**：那一版连 `remove()` 都没有，也没有任何调用点。后果是孤儿记录永久占着全局唯一的
  调度权，而那条会话在侧栏上已经找不到 ⇒ 用户**没有任何入口**能关掉它（实测证据：用户 `thread-runtime.json`
  有 1 条 `enabled:true`，其 threadId 在引擎 `state_5.sqlite` 的 threads 表里已不存在）。
  三道防线（缺一不可）：① **主进程**接引擎 `thread/archived` / `thread/deleted` 事件 → 归档只关开关
  （`releaseDispatch`，保留模型/权限，恢复会话不丢配置）、删除整条移除（`remove`）—— 覆盖所有路径，
  不靠 UI 自觉；② **渲染层自愈**：持有者不在会话列表里就调 `releaseDispatch` 自动释放（覆盖历史坏数据）；
  ③ **一键释放**（用户点名要的）：面板被占用时多一个「释放并删除该会话」，确认后**先释放、后删除**
  （顺序刻意如此：删除失败时用户至少已拿回调度权）。删除复用唯一内核 `deleteThreadCore()`
  （`deleteThread` 与一键释放共用）—— ⛔ 别处再写一份简版删除必漏衍生状态（会话缓存 / 供应商登记 /
  成员会话级联 / 当前会话状态复位）。预检【29】⑩ 段 9 条守卫，9 条变异逐条反证成立。
- **⛔ 乐观气泡「安全阀」的判据（09-17 用户实测：「消息发出去，先是旧内容 + 生成条，过一会才看到我的消息」）**：
  安全阀原条件写的是「**当前没有任何 running 回合**就回收气泡」——这条在**正常发送**时同样成立：
  气泡上屏那一刻本轮 turn 还没建立（要等 `turn/start` 往返 + 记忆召回），条件瞬间命中 ⇒
  探针实测气泡**只活 6~8ms**，而真实消息 1.7~3.3s 才到，用户自己的消息有 2~3 秒**完全不在界面上**
  （只剩一条「正在生成回复 · …」状态条，即用户截图里问的"中间那个"）。
  判据已改为「**本轮确实出现过运行中回合**（`sawRunningTurnRef`）之后、回合结束才回收」+ 15s 超时兜底，
  并在**三条发送路径**（fastArm / 慢路径 / 编辑重发 fork，见下条）复位该 ref。修复后同一探针：气泡存活 1344ms、直到真实消息接管那一刻。
  预检【29】⑤ 段 5 条守卫（关键一条是「回收条件不能是裸 `!running`」的形态断言，5 条反证全成立）。
- **⛔ 编辑消息 → 保存并重新发送 → 消息消失（09-18 用户：「我编辑消息，保存重新，发送，消息不见了」）**：
  `editResend()` 会先 `thread/fork`（把被编辑那一回合**及其之后**从分支里摘掉）再 `turn/start` 重发。
  真机复现链（隔离 profile + 60ms 采样 + 读 `window.__adbg` 埋点）暴露**两个独立缺陷**：
  - ① **气泡当帧被安全阀回收**：`sawRunningTurnRef` 的复位只写在两条普通发送路径上，`editResend` 漏了 ⇒
    fork 回来后新回合还没建（`running=false`）+ 上一轮残留的 `true` ⇒ 阀立即回收气泡（埋点 `confirm-timeout`、
    `pending` 恒 0），而旧回合又被 fork 拿走 ⇒ 提交后有 **1~2 秒界面上连用户自己的消息都没有**（实测采样：
    `t+1ms 旧消息 → t+2038ms 全空 → t+2111ms 新消息`）。修：`editResend` 同样复位该 ref。
  - ② **失败不回退 ⇒ 永久消失**：`catch` 只清气泡，可 fork 已经把原回合拿掉了 ⇒ 用户的消息彻底没了。
    修：进函数时留 `const before = threadRef.current`，**请求抛错**与**引擎没返回回合**两条失败路径都
    `setThread(before)` 回退，提示改成「已回到原来的消息，可重试」。
  - 修复后同一探针：埋点变 `confirm-fired`、`pending=1` 真实可见、**空白窗口未再出现**。
  - 守卫：预检【29】⑤ 改写（不再只数次数 —— 按**复位点所属函数**判定，必须含 `editResend`）+【42】四条；
    反证 3/3（删复位 / 删回退 / 删 `before` 各变红）。
  - ⛔ 复盘教训：**「全 App 数出现次数」和「按函数名 indexOf 切片」两种守卫都假绿/假红过** ——
    前者加删一处都能绕过；后者因为 `async function send` 在文件里位于 `editResend` **之后**，
    `slice(send, editResend)` 取到空串直接假红。判据要落在「这一处的归属」上才可靠。
  - 已知未改（记录备查）：回合**运行中**点「编辑并重新发送」会被有意拦下（toast「请先停止当前任务，再编辑重发」），
    但内联编辑器此时已关闭 ⇒ 草稿丢。要么改成禁用编辑按钮并给出原因，要么保留编辑器；本轮未动。
- **⛔ 生成状态条（`run-activity-bar`）必须排在 `#chat-anchor`（乐观气泡）之后（09-17 用户实测：「这个怎么到这个位置了」）**：
  它原先排在气泡之前，于是「消息已上屏、引擎还没回声」那段窗口里，状态条显示在刚发出的消息**上方**
  （用户截图：状态条 y=51 / 消息 y=86）。运行时反证：改回原顺序 → 气泡 top=80 / 状态条 top=51，
  与截图比例一致；修好后 = 消息 top=80 → 状态条 top=163（钉顶生效）。气泡阶段时间线里只有
  「你的消息 + 状态条」，顺序应与真实阶段「回合内容 → 状态条」一致。
  预检【29】⑥ 两条守卫按**源码顺序**断言（indexOf 比较 + 渲染点唯一 —— 只查两个类名都存在等于没查）。
- **⛔ mac「不使用项目地址」的三个独立死因（09-17 用户报「mac 的不使用项目地址功能用不了，没有适配」）**：
  ① **功能**：欢迎页发送路径条件写成裸 `!workspace` —— mac 全新机器从没设过项目地址，于是用户
     明确选了「不使用项目地址」也照样进那个分支：**scratch 被清掉 + 强制弹目录选择框**，该选项等于无效
     （Windows 老机器早就有 workspace 了，所以这个 bug 一直没暴露）。判据改为 `!workspace && !welcomeScratchDir`。
     运行时证据：以 `workspace: null` 启动（**harness 默认会把项目目录写进 localStorage.workspace，
     不传 null 根本复现不出来**；`last-thread` 也要清，否则启动恢复会话会把该会话 cwd 回填成 workspace）
     → 选「不使用项目地址」→ 发送：修复后消息正常上屏 + 磁盘上真建出 `scratch/chat-<今天>-*`；
     反证退回旧条件 → 发送被目录框拦住、消息永不上屏（= 用户现象）。
  ② **快捷键**：全局 keydown 写死 `if (!event.ctrlKey || event.altKey || event.metaKey) return;` ——
     mac 的命令键是 ⌘(metaKey)，这句把 mac 的**所有**快捷键 return 掉（⌘O 打开工作区、⌘N 新建、⌘K 命令面板…）。
     改为平台分叉：`const mod = mac ? event.metaKey : event.ctrlKey;` + 成对的 `otherMod`。
  ③ **scratch 目录**：原优先写 app 安装目录 —— mac 上那是 `X.app/Contents/MacOS`，写进去会破坏代码签名
     （且 /Applications 通常不可写、被 Gatekeeper translocate 时整个路径是只读卷）⇒ darwin 直接落 userData。
  **展示层**：快捷键提示统一走 `hk()`（规则在 `src/lib/hotkey.mjs` 纯函数里）—— 本机是 Windows 跑不到
  mac 分支，只有把转换规则做成纯函数，预检才能对「mac 上显示成 ⌘⇧F」给出确定性断言而不是靠猜。
  预检【30】段 9 条守卫 + 7 条变异反证；其中一条反证抓出守卫**假绿**（只匹配旧字面串会被等价写法绕过），
  已改成结构性判据「handler 里 `event.metaKey` 恰好出现 2 次 = 成对分叉」。

- **发送动画「两步/卡顿」的相位续播（09-17 第三轮，用户原话「还是两步，卡顿」）**：
  - 上一轮让真实消息「认领」动画解决了「动画被腰斩」，但认领是**从 0% 重新起手** —— 气泡先自己动了约 30ms，接管时又归零重播，视觉上仍有"顿一下再飞"。
  - **修法**：认领时返回**距发送已流逝的毫秒**，真实节点用 `animationDelay: -<elapsed>ms` **接上同一相位**；两段首尾相接。三种结果：`none`（没登记/文本对不上/超 10s TTL）、`skip`（已流逝 ≥ 动画时长 → 不补播，慢回声下消息早已在屏上）、`continue`（0 ≤ elapsed < 550 → 负延迟续播）。
  - **时序判定抽成纯函数** `src/lib/send-anim.mjs`（+ `send-anim.d.mts` 声明，`.mjs` 无声明会触发 TS7016 构建失败），DOM 侧只在 App.tsx 落 inline style —— 便于预检做行为断言。
  - **验证链**（本环境引擎回声 1.2s+/429 频繁，抓不到"快回声"的真实运行时样本，如实记录）：① 纯函数 7 项正向断言 + 3 项反证（阈值归零/前缀改全等/去掉一次性消费 → 均判假）；② CSS 语义运行时实测：`delay 0` 的元素停在 0% 关键帧（`matrix(0.86,…,260)`），`delay -220ms` 的元素已挂在**动画中段**（`matrix(1.000,…,0)`）→ 负延迟确实从该相位开始；③ 预检【29】④ 段把上面全部钉住（含"续播相位必须落到 DOM inline style"的接线守卫）。
  - ⛔ 判据坑：`animation.currentTime` 在首帧前恒读 0，**不能用它判断相位**，要看渲染出的 transform / 或等 `animation.ready`。
  - **真正的"同节点"路线（未做）**：要让乐观气泡与真实消息是同一个 DOM 节点，需要把乐观消息做成时间线里的**临时回合+条目**并用稳定的 React key（sendToken）贯穿到引擎回声之后。这会动到回合组渲染与钉顶/锚定（本项目最脆弱处），在「相位续播已消除重起」的前提下收益有限，故先不做，留作后续可选项。

- **插队（排队消息点「立即」）每次都报错（09-17 用户实测）**：
  - **引擎原文**（直接用真实 threadId + 过期回合调 `turn/steer` 逼出来）：`no active turn to steer`。另外确认 `expectedTurnId` 是**必填**（缺了回 `missing field \`expectedTurnId\``），所以应用传参没写错。
  - **真因**：`startQueued` 只看 `activeTurnId`（应用侧状态）。上一轮 **429 限流失败 / 被中断 / 已跑完**之后它仍是旧值，引擎那边早已没有活动回合 → steer 必失败；失败只弹一句报错、消息仍留在队列里，用户重试几次都一样。
  - **修法**：① 先按「**真的有回合在跑**」判断 —— `isTurnRunning` 找到运行中回合，`activeTurnId` 命中它才用作 `expectedTurnId`；② 引擎仍回 `no active turn` 时**退化为开始新回合**（走 `thread/queue/start`）并清掉陈旧运行态（`markThreadStopped` + `setActiveTurnId(null)`），不再把消息卡死在队列里。
- **429 限流重试条「靠左、越出输入框左缘、右边被切」（09-17，上一轮只改了宽度、没修定位）**：
  - **真因（实测 computed style）**：它借用了 `@keyframes compact-toast-in`，而那套关键帧的 **0%/100% 都带 `translate(-50%, …)`**（本来是给 `left:50%` 居中定位的 toast 用的）。限流条是 static 定位 → 被整体左移**自身宽度的一半**（实测 `transform` 残留 `-237.383px`，宽度 474.8/2；表现为条中心 403 vs 输入框中心 640）。
  - **修法**：新增 `@keyframes rate-limit-bar-in`（只做 `translateY(-6px) → 0` + 淡入），限流条改用它。⛔ 通用教训：**带 `translate(-50%)` 的入场动画只能给「left:50% 居中定位」的元素用**，借用前先看关键帧里有没有位移。
  - 预检守卫【29】：注释剥离后断言「限流条没有借用带 -50% 位移的动画 + `rate-limit-bar-in` 在」，反证（换回 compact-toast-in）成立。

- **发送消息的入场动画不再被腰斩（09-17，用户实测「发出去的消息没有动画到位置，先展示上面消息、没有过渡」）**：
  - **实测根因**（按帧打点）：动画只登记在**乐观气泡**上（`justSentIds`），而引擎回声的真实消息几十毫秒内就接管、气泡随之卸载 —— 实测 t+13ms opacity 0.24（刚起头）→ t+34ms 节点已消失，动画被打断，消息"啪"地跳到最终位置；同时钉顶在接管瞬间重锚，滚动出现 2048→2381→2075 的两步跳。
  - **修法**：`armSendAnimationClaim(text)` 发送时登记正文，真实消息**挂载那一刻**（`UserMessageView` 的 lazy `useState`）用 `claimSendAnimation()` 认领（一次性、10s TTL、前缀匹配防误认领）→ `just-sent` 与节点同帧出现，结构上不可能被接管打断；乐观气泡（`pending`）仍走原 `justSentIds`。
  - **踩过的弯路（重要）**：① 先试图「把动画补挂到接管它的真实节点」，在 4 处接管路径上补 —— 打点显示那些分支**根本没被走到**（`__animHandover` 全程 null），且真实节点比气泡隐藏更早挂载（同帧并存），补挂必然晚一步；② 中途一次"反证运行"显示全绿，实为**构建失败（TS18047 `'claim' is possibly 'null'`，`return false` 让后续收窄失效）导致 bundle 没更新** —— 教训：反证/验证前必须**同时核对构建退出码与产物 mtime/hash**，只看旧日志文件会拿到上一轮的退出码。
  - 验收：真启动发送消息 + 100ms 定点采样 7 条断言全绿（`just-sent` 在真实节点、`getAnimations` 含 `user-msg-send-in`、opacity 0→1、位移 552→488 落地）；反证 = 关掉认领（`if (SEND_CLAIM_TTL_MS > 0) return false;`）后同类 4 条变红。

- **429 限流重试条自适应（09-17，用户实测「重试弹窗展示没有自适应」）**：`.rate-limit-retry-text` 原本是 `nowrap + overflow:hidden + ellipsis` —— 窄窗下整句被截断（视觉上就是「没自适应」）。改为 `white-space: normal; overflow-wrap: anywhere; flex: 1 1 auto; min-width: 0`（长文案换行完整展示），容器 `inline-flex` → `flex` + `width: fit-content; max-width: min(100%, 720px)`（跟内容但永不越界）。同类弹窗复查：`.notice` 已有 `max-width: min(480px, calc(100vw - 36px))`、`.resource-error` 已有 `overflow-wrap:anywhere + min-width:0`，均完好未动。验收：真启动合成 DOM 几何断言 7 条（窄窗 320px 无横向溢出 + 文案不截断 + 确实换行；反证：改回 nowrap 后文字 scroll 294→641 被截断）全绿即删。

- **弹窗自适应修复（09-17，用户实测「执行计划」清单右边被切掉）**：`.goals-pop` 是 `display:grid; width:300px`，而 grid 子项默认 `min-width:auto`——待办文本 `nowrap` 时 min-content=整句长度，把行撑出面板被裁。修：面板宽 `clamp(300px,24vw,400px)` + `max-width` 上限 + `overflow:hidden auto`（横向禁滚）+ **`.goals-pop > * { min-width:0 }`**（grid 子项允许收缩，这是根因修复）+ 面板内待办/计划步骤文本改 `white-space:normal; overflow-wrap:anywhere`（完整换行展示而非裁切）。同类弹窗全库审计后一并防护：`.composer-quick-pop > button > span`（专家/技能/连接器动态名加省略）、`.browser-drawer-row b/small`（文件名换行）、`.ctx-pop-sub`（邮箱/报错串换行）。`.tab-switcher` 无 JSX 引用（死规则）未动。验收：真启动合成 DOM 几何断言 7 条（含运行时反证：摘掉 `min-width:0` 守卫同样内容横向爆到 1366px）全绿即删。

- **mac 全面适配第一轮（09-16 晚，用户实测 v0.0.19 mac 版报「开发工具全部装不上 / 动画全静止 / 红绿灯没适配 / 语音闪退 / 换供应商旧会话死」，并要求「全方面适配一个都不能漏」）**：
  - **开发工具全灭的两个根因**：① mac 包 `extraResources` 是空数组、全靠 `copy-mac-tools.cjs` 从 `resources/tools` 复制，而 CI 只现造 node/npm-global/python/pwsh/ponytail ⇒ **`install-runtimes.cjs`/`install-automation.cjs` 根本不在包里**，点安装 = spawn 不存在的脚本瞬间失败（copy-mac-tools 现已硬性补拷，缺了中止打包）；② `install-runtimes.cjs` 是纯 Windows 脚本（全部 win-x64 资产 + `.exe` marker + `C:\Windows\System32\tar.exe`）。现已按平台分叉：darwin 资产（node-darwin、powershell-osx、python-build-standalone、evermeet ffmpeg、jq/ninja/rg/uv/cmake/7zz/yt-dlp 的 mac 构建、Miniconda MacOSX sh 静默装），解压后统一 **chmod +x**（zip 不保 Unix 位），git 走系统 CLT。**spec marker 平台展开**收进 `main.ts` 的 `DARWIN_MARKERS`（`markerRel()` 是「装没装」唯一入口）+ `DARWIN_HIDDEN`（mingw）；git/openssl 在 darwin 走系统探测（installedBySystem）。
  - **动画全静止**：macOS 系统级「减少动态效果」命中 styles.css 的 `prefers-reduced-motion: reduce` 全局 `*` 块。现在所有静音块都带 `html:not([data-motion="force"])` 前缀，App 默认写 `data-motion="force"`（强制动画；以后要做「跟随系统」再摘属性）。
  - **窗口控制键**：`titleBarOverlay` 的窗口钮是 Windows 专属；darwin 改 `hiddenInset`（红绿灯左上内缩），preload 新增 `codex.platform`，App 写 `<html data-os>`，styles.css 按 `[data-os="darwin"]` 让位（右上 145px 预留区归还内容；顶行跨全宽/侧栏 brand-row 左让红绿灯）。
  - **实时语音闪退（Windows 也有，用户实测两平台都崩）**：sherpa-onnx 的 native 层在 worker_threads 里 abort/段错误会**带死整个进程**，JS 层全拦不住。`VoiceWorkerClient` 底座从 worker_threads 换成 **utilityProcess 独立子进程**（worker 源码零改动：引导文件 `userData/voice-worker-bootstrap.cjs` 用 require shim 供给 `worker_threads` 语义），native 崩溃只死子进程，主进程报「语音引擎进程退出」并可重开。
  - **换供应商旧会话死掉**：症状 = 原地迁移失败每次都走 fork 接力。旧实现把 `thread/resume` 的真实报错吞成 `return false`，无法定位——`migrateThreadToProvider` 现在返回 `{ok, error}`，失败 toast 带引擎原始报错（mac 上再复发时用户能直接看到原因）。
  - **顶栏「目标」钮与「⋯」钮竖排挤在一起（Windows 截图实测）**：`.topbar-actions` 总宽超限时 flex 压缩 `.task-menu-wrap` → 内部两个按钮换行竖排。修复 = 簇内 `> * { flex: none }` + `.task-menu-wrap` 横排 flex；宽度不足由 `.task-title`（min-width:0 + ellipsis）吸收。
  - 验收：本轮现写脚本 33 断言（真启动 CDP：平台标记/动画开关/操作簇几何；离线：bootstrap、darwin 资产名按 GitHub API 实测值、marker 覆盖、CSS 前缀）全绿后即删；预检保持全绿。mac 真机行为待用户验证。

- **⛔ 应用内下载必须跟随重定向（09-16 发 v0.0.18 当天实测，属 09-15 换 GitHub 单源时埋下的坑）**：
  GitHub Release 的 `browser_download_url` **不是文件本身，而是 302**（跳到 `release-assets.githubusercontent.com`
  的签名地址，实测第一跳就是这个）。`electron/updates.ts` 的 `downloadUpdate` 过去是裸 `https.request`
  + `status >= 300 reject` ⇒ **用户点「下载并安装」直接报 HTTP 302，更新走不完**。
  为什么一直没暴露：09-15 才收敛成 GitHub 单源，而当时仓库**0 个 Release**，`checkLatestUpdate` 拿不到东西，
  从没走到下载这步；v0.0.18 是首个 Release 才第一次踩到 ⇒ 当日以 **0.0.19** 修复；同晚应用户要求
  **撤掉线上 0.0.18/0.0.19 两个 Release 与 tag，统一重发为 0.0.18**（已升 0.0.19 的用户不会被
  应用内更新提示到，需手动下载覆盖安装——发布当晚临时版本，接受此影响）。
  修法：`hop(url, depth)` 递归跟随（≤5 跳，`new URL(location, url)` 解析相对跳），**每一跳重新校验 https**
  （防止降级到明文——安装包下载完会被 `shell.openPath` 直接执行）+ 原有 sha256 完整性校验不变。
  守卫：预检⑥组两条（锚定真实分支与 `hop(next, depth+1)` 调用，不是查标识符存在），
  **验收方式 = 本地 HTTPS mock 302 → 200**（见下方「探针方法论坑」）。

- **发版链路搬到 GitHub Actions：推 tag = 发布（09-16，用户「用 GitHub ssh 发布，版本号 0.0.18，Windows mac 双芯片，只在 GitHub 上发布」）**：
  - **前提（决定整条设计）**：本机远端是 SSH（deploy key `~/.ssh/codex_gh_release`，`ssh -T` 能认证），而 **SSH 只能推代码/标签**——既不能创建 Release 也不能上传资产；本机也没有 `gh` CLI、没有任何 API token（`scripts/gh-api.cjs` 那套「从 `remote.origin.url` 抠内嵌 token」的旧流程因此整体失效）。⇒「用 SSH 发版」的唯一可行形态 = **推 tag → Actions 用仓库自带 GITHUB_TOKEN 构建三端包并发布**。
  - **流水线**：`.github/workflows/release.yml`（`on: push: tags: v*`，`permissions: {contents: write, actions: read}`）复用 `build-mac.yml`（新增 `workflow_call`）与**新增的** `build-win.yml`；`publish` job `needs: [mac, win]`（**三端不齐不发版**）→ 按版本号精确匹配产物（artifact 里可能混旧版本）→ 规范化资产名 → 校验 tag 与 `package.json` 版本一致 → 校验 `docs/releases/v<版本>.md` 存在 → `gh release create` + `gh release upload --clobber`（幂等可重跑）→ 打印线上 size/digest。构建步骤只此一份（两个 build 工作流被复用），避免「同口径两处实现漂移」。
  - **Windows 包现在也能在 CI 造**（此前只能在开发机上打）：`resources/tools/*` 被 gitignore ⇒ 干净检出里 `extraResources` 的源**全缺**，而 electron-builder 对缺源是**静默跳过**（= 发坏包）。新增 `scripts/prepare-windows-tools.cjs`（对标 `prepare-mac-tools.cjs`）现造：`node`（v24.19.0，与 mac 同版本）、`npm-global`（内置 node 自带 npm + `npm i -g --prefix`：`@nuphus/nuphus-mcp@0.2.2` / `@playwright/cli@0.1.18` / `playwright-core@1.62.1`，**不装 CloakBrowser**）、`vscode-cli`、`cloudflared.exe`、`ponytail-plugin`、`pwsh-headless`，末尾硬校验七项 marker；`build-win.yml` 在打包**前后**各跑一次 `verify-packaged-tools.cjs`（真 MCP 握手）。
  - **三个 `.mjs` 助手无需现造**：`nuphus-call.mjs` / `harness-media.mjs` / `cloak-open.mjs` 在 gitignore 规则之前就已纳入版本控制（干净检出里就有）；`automation-tools.zip` 仍由 `before-pack.cjs` 从 npm-global 现造。
  - **`pwsh-headless` 源码入库**：它是自编的 C# 转发壳（`/target:winexe` + stdio 透传 = 「无窗口桥」的全部含义，源码内 `CODEX_REAL_PWSH` 可指向真实 pwsh）；过去只有开发机有编译产物，CI 造不出来。已用 `.gitignore` 特批（`!resources/tools/pwsh-headless/PwshHeadless.cs`）入库，CI 用 .NET Framework 的 `csc.exe` 现场编译。
  - **两个实测坑**：① **npm 11 起默认不跑依赖的 install 脚本**（只打 `npm warn allow-scripts`），`@nuphus/nuphus-mcp` 的 postinstall（`bin/check.js`，校验平台原生二进制）会被静默跳过 ⇒ 必须显式 `--allow-scripts=@nuphus/nuphus-mcp`（mac 侧对 arm64 本来就显式放行）；② GitHub 资产直连在国内常被掐（实测 `curl: (52) Empty reply from server`）⇒ 下载做成「直连 → gh-proxy 加速 → 本机代理」回落链（CI runner 直连就是最优路径，不需要代理）。
  - **资产命名 = 应用侧更新器契约**（`electron/updates.ts`）：Windows 取 `*.exe`；mac 必须同时含 `mac` + `.zip` + 架构名（`arm64`/`x64`）。⛔ electron-builder 在 mac **x64** 上产出的是 `…-<版本>-mac.zip`（**不带 x64**）→ publish job 强制改名成 `Codex.Harness.Desktop-<版本>-x64-mac.zip`；**名字错了用户端静默显示「已是最新」，不报任何错**。
  - **⛔ 版本号必须是合法 semver，后缀不能省连字符（09-18 发 v0.0.23-b 时实测）**：想发「0.0.23 的第二次构建」时若把版本写成 `0.0.23B`，electron-builder 的 `normalizePackageData.fixVersionField` 会走 `semver.valid(v, true)` + `semver.clean(v, true)`（loose 模式）把它**规范化成 `0.0.23-B`**（自动补一个连字符）。后果两条都是硬的：① publish job 的产物名核对 `*"${VERSION}"*` 用的是 package.json 原文（`0.0.23B`），而真实产物名含 `0.0.23-B` ⇒ **发布 job 直接失败**（25 分钟 CI 白跑）；② 打包进应用的版本变成 `0.0.23-B`、release tag 却是 `v0.0.23B` ⇒ 更新器按版本字符串比对（`version === currentVersion`），用户端**每次启动都提示「发现新版本」**、点下去下载的还是自己这一版。⇒ 版本后缀一律写成合法 semver（`0.0.23-b`，规范化后原样不变）；**改完版本号先验 `require("semver").clean(v, true) === v`**，再推 tag。
  - **重跑姿势**：CI 失败就修好再 `git push origin :refs/tags/v<版本>` 删 tag、重新推同一 tag（`gh run rerun` 需要 API，本机不可用）。**删远端 tag 重推之前必须先在本地 `git tag -d <tag>` 再 `git tag <tag>` 重建**，否则推上去的还是旧 commit（09-18 实测：只删远端没重建本地 tag → 重推后远端仍指向旧 SHA，得再 force 推一次）。
  - **本机打包只用于自测**：正式包一律 CI 产出 —— 本机打出来的包**没有任何上传通道**（没 token），别把「本机打好了」当发版完成。
  - 守卫：预检【29】19 条（tag 触发 / `contents: write` / 两个构建被复用 / `needs` 三端 / artifact 名在构建与发布两侧一致 / 更新器匹配规则仍在 / 三个资产名合规 / 更新说明在位 / tag 与版本一致 / Windows 现造链与打包前后握手 / `extraResources` 每条源都有出处 / pwsh 源码入库）。

- **打包瘦身：有国内加速源的工具链/内核全部不随包，开发工具页按需下载（09-16，用户「有国内加速的都不用内置，全部放到开发工具里面让用户自己下载；引擎自己下载了界面自动更新」）**：
  - **（09-16 下午追加）自动化包与 ponytail 改「随包直装」**（用户「那这两个就直接内置，就不用解压啥的了」）：`resources/tools/npm-global` 进 extraResources（预解压，18MB 压缩 / 64MB 原始——Nuphus 29.6 + Playwright CLI 18.1 + CloakBrowser 3.6）+ 保留 automation-tools.zip 作修复备用；ponytail 由 `tools/ponytail-plugin` 源在**首启自动种**。效果：装完即「已安装」，nuphus/playwright-cli/cloakbrowser/6 个 ponytail 技能开箱可用，用户不用点安装解压。**为什么这两项能内置**：它们只有 GitHub/npm 源、无国内镜像，且线上回落地址实测不存在（见下），故必须随包；反之有镜像的（python/git/内核…）一律不随包。
  - **ponytail 自动种的三条硬约束**：① 只在 `config.toml` **没有** `ponytail@ponytail` 段时执行（有段=已装或用户卸载过，绝不重装——否则卸载失效）；② 挂在 `server.start()` **之后**（要写 config.toml）；③ 失败只 warn 降级，开发工具页按钮仍可手动种。
  - **⛔ 实测新坑：`config/value/write` 必带 `mergeStrategy: "replace"`**。引擎对该请求必填（缺了整条被拒 `Invalid request: missing field mergeStrategy`），而这类调用普遍 `.catch(() => undefined)` 静默吞掉 → 症状是「开关点了没生效」。本轮就是这样才发现：ponytail 卸载/装回的 `enabled` 写入**长期没生效**（写 false 时插件其实还 enabled）。预检【26】新增结构守卫：正则只匹配真正的调用点 `config/value/write", {`…`})`，逐个体内必须有 mergeStrategy（注释里提到该字符串的段落不算，否则误判），反证：抹掉字段 → missing>0 变红。
  - **现象记录（既有行为，别误判成本轮 bug）**：卸载 ponytail（cache 删除 + `enabled=false`，市场段仍在）后重启，**引擎会按已注册的本地市场自行同步插件文件回 cache**（实测拿回的是上游最新版 4.10.0、带 `.git`，不是随包的 4.9.0），但 `enabled=false` 仍是停用态、我的自动种没有参与（主进程无 seed 日志）。所以「卸载」在功能上成立、磁盘上会有 cache 文件。
  - **为什么**：安装包 ~900MB（压缩）/ ~3.2GB（原始），大头是两套 Chromium 内核（pw-browsers ~700MB + cloak-cache ~536MB）与语言运行时全家桶（python 424MB、pwsh 282MB、git 90MB、cmake 69MB、uv 58MB…），应用本体只有几十 MB。
  - **不随包清单**：pw-browsers、cloak-cache、pwsh、git、python、rg、uv、cmake、ninja、sevenzip、jq（package.json extraResources 移除 + mac copy-mac-tools.cjs 的 NOT_BUNDLED 过滤）；**node 仍内置**——它是安装器引导（install-runtimes.cjs 靠内置 node 跑），asar 同时排除 mermaid sourcemap（-25MB）。开发机 `resources/tools/*` 本地目录保留不动，只是不进包。
  - **国内加速**：`scripts/install-runtimes.cjs` 的 download() 通道序 = npmmirror 镜像（node/python/git-for-windows 有同步）→ 本机代理（仅显式设 PROXY 时）→ 直连 → gh-proxy（GitHub 资源兜底）；pip/conda 早已走清华源。内核下载在 `electron/main.ts runBrowserDownload`：镜像优先（toolchain.ts `CHINA_MIRROR_ENV`：PLAYWRIGHT_DOWNLOAD_HOST=npmmirror、CLOAKBROWSER_DOWNLOAD_URL=gh 代理前缀——归档与 SHA256SUMS 同源校验不受影响），失败自动回落官方源；用户自设同名变量时不覆盖。
  - **界面自动刷新**：主进程 `watchFs(toolsRoot(), {recursive})` 去抖 1.5s 广播 `runtime:progress {auto:true,done:true}`，渲染层收到即刷新开发工具清单与工具状态——引擎在会话里自己装了工具，设置页不用重开。
  - **坑**：① 给「开发工具」新加的 install 分支若直接 spawn 官方源 = 绕过加速，必须走 runBrowserDownload/install-runtimes 的通道逻辑（预检【26】守）；② 变异 package.json 做反证要用 JSON-aware 方式（字符串拼接双逗号会把 JSON 弄非法 → 预检崩在解析上，守卫「恒绿」假象）；③ 反证触过的源码 mtime 变新，恢复后必须重建再终验。
  - **用户须知（文案已同步）**：新装机用户先在开发工具装 **Git**（引擎执行 shell 命令依赖）与所需工具链；自动化能力（Nuphus / Playwright CLI / ponytail）随包直出、无需安装，需要过反爬站点时再到开发工具下载 **CloakBrowser** 与对应内核。

- **自动化工具拆细 + CloakBrowser 剥离随包 + 默认内置浏览器（09-16 下午，用户「这三个内置，CloakBrowser 不用内置按需下载，默认用内置浏览器；自动化工具拆开拆详细一点」）**：
  - **开发工具页拆卡**：原「桌面与浏览器自动化」一张大卡（`automation` 合并 id）拆成逐条能力卡——`nuphus`（Nuphus 桌面自动化）/ `playwright-cli`（Playwright 浏览器自动化）/ `cloakbrowser`（CloakBrowser 指纹浏览器）/ `playwright-browsers` / `cloak-browsers`（两类内核）/ `ponytail`（写代码模式插件），各自独立显示状态、大小与安装动作；`automation` 这个合并 id 已删除。
  - **bundled 语义**（DevRuntimeSpec 新字段，区别于 builtIn「基础运行时」分组）：随包内置来源 → 界面显示「内置」徽标、拒绝卸载；缺失时给「修复安装」（nuphus/playwright-cli = 重新解压随包 zip，ponytail = 重种插件）；已就位时再点安装是幂等空操作（判定统一走 `runtimeInstalled`，与清单同源——ponytail 的 marker 在引擎侧 cache，不在 tools 目录）。⛔ ponytail 的 install 分支必须排在 `spec.bundled` **之前**，否则「修复 ponytail」会去解压 automation zip。
  - **CloakBrowser 按需下载**：`runNpmInstall`（main.ts）用**内置 node 自带 npm**（不依赖用户装没装 node/npm）+ registry.npmmirror.com 优先、官方源回落（用户自设 `npm_config_registry` 时不覆盖）；卸载只删包体目录（⛔ 绝不能按 marker 首段推导——那是 npm-global 根，会把 nuphus / playwright-cli 一起删光）并清掉 npm shim（根目录三件套 + `node_modules/.bin` 三件套，不清则 PATH 上留着指向空目录的 `cloakbrowser.cmd`）。
  - **出包排除（三处同源，缺一不可）**：package.json extraResources 里 npm-global 的 `filter`（排除 cloakbrowser 包体与 shim）、`pack-automation.cjs`（zip 同样排除——否则「修复安装」把它又装回包里）、mac `copy-mac-tools.cjs` 的 `isCloakPackage` 过滤 + `prepare-mac-tools.cjs`（不再安装 cloakbrowser@）。`before-pack.cjs` 的坏包守卫同步升级：从「zip 存在与否」改为**直接校验随包内容**——npm-global 里必须有 `@nuphus/nuphus-mcp` 与 `@playwright/cli`（zip 只是修复备用，不再是唯一保障）。
  - ⛔ **electron-builder 会丢弃 `from` 根级的 `node_modules`（09-16 打包验证才暴露，一直没被发现）**：`copyDir` 的 walk() 对每个条目先过 filter，而 filter（app-builder-lib/out/util/filter.js `createFilter`）里写死了 `if (relative === "node_modules") return false`，**且目录节点被过滤时整棵子树不遍历**。所以「一条 `from=resources/tools/npm-global` 映射 = 预解压开箱即用」是**假的**：包里只有根级 shim（`nuphus-mcp.cmd` 等），`npm-global/node_modules` 根本没进包 → 装完 nuphus / playwright-cli 两张卡都是「未安装」，用户得点一次「修复安装」解 zip 才可用。修法 = **另加一条 `from=resources/tools/npm-global/node_modules` → `to=tools/npm-global/node_modules` 的映射**（那一层相对路径不叫 `node_modules`，绕开剪枝；`copyDir` 只 mkdir+拷贝、不清目标，两条映射并发写同一父目录安全）。守卫：预检【27】断言两条映射都在 + 新映射里同样排除 cloakbrowser，`verify-packaged-tools.cjs` 在产物层断言 `@nuphus/nuphus-mcp/package.json` 与 `@playwright/cli/package.json` 真的在包里。（mac 侧不受影响：`copy-mac-tools.cjs` 用 `fs.cp`，没有这条剪枝。）
  - **zip 新鲜度也要看脚本**：`before-pack.cjs` 原来只比 zip 与 `npm-global` 目录的 mtime → 「只改了 `pack-automation.cjs` 的排除清单、没动目录」时会静默复用旧 zip（日志还说「已是最新，跳过」），用户点一次「修复安装」就把已剥离的包装回去。现在 zip mtime 要同时新于源目录**与打包脚本**。
  - **默认内置浏览器**：developer_instructions（`BROWSER_INSTRUCTIONS`）与 `browser-automation` 技能改为「默认通道 = 内置浏览器视图（右栏 Chromium webview）+ playwright-cli；cloakbrowser 是可选增强，先探 `CLOAKBROWSER_ENTRY`，为空即未安装——不要自己安装、不要当故障上报，提示用户到开发工具下载」；App.tsx 的 `browserMode` 遗留字段默认值改 internal；设置页「浏览器控制」「开发工具」与 `tools:status` 文案同步。⛔ 旧文案「本机内置的浏览器就是 CloakBrowser」在剥离后是**错误指令**（模型会去 import 一个不存在的模块）。
  - 验证：预检新增【27】22 条守卫 + 21 条变异反证全红；`npm run check` 全绿；隔离 profile 真机验收 29 断言（IPC 拆卡 / bundled 标记 / 内置项拒绝卸载 / config.toml 与技能文件里真实落地的指令文案 / 开发工具页卡片与徽标 + 截图）；`electron-builder --dir` 真打包核对产物里 npm-global 已无 cloakbrowser 且 nuphus / playwright-cli 在位。
  - **Git 首启自动补装（09-16 下午，用户拍板「首次启动自动安装行」）**：`autoInstallGitIfNeeded`（main.ts，挂 whenReady 链 remote.start 之后）——仅 Windows（mac 包仍内置 git）、marker（`git\cmd\git.exe`）已存在就跳过、`runtimeInstalls` 互斥防与手动安装撞车；复用按钮安装同一条 install-runtimes.cjs 链（npmmirror 优先），装完 `restartServerWhenIdle` 让引擎新 PATH 生效；失败广播 `done` 事件（不悬挂安装态），下次启动仍缺会再试（自愈）。渲染层 App.tsx 对 `id=git && message 含"自动"` 的 done 事件弹 notice（手动安装的「安装完成」不含「自动」二字，不受影响）。 ⛔ 启动时机必须在 `server.start()` **之后**（restart 语义是杀掉现有引擎重 spawn，太早挂会跟首启 spawn 撞车）。
  - 预检【26】守卫 + 13 条变异反证全红；构建三关全绿。

- **思考等级：低/中/高/最高/极高 + 跟着模型保存（09-16，用户「不是跟着模型保存生效的，每次都要二次保存」）**：
  - **展示名定稿**：`effortLabels` 改短名——low=低 medium=中 high=高 **ultra=最高（引擎扩展档，按模型映射实际强度）xhigh=极高（顶格档）** minimal=极简；菜单顺序 = `ALL_EFFORTS` 序（去掉 minimal 正好是用户要的「低中高最高极高」）；`/effort` 别名表加「极高」。
  - **默认档位**：`CUSTOM_MODEL_EFFORTS` 改为 `["low","medium","high","xhigh"]`（旧三档 → 四档）；**存量声明迁移** `declaredModelEfforts`（src/lib/effort.ts）：未声明（含探测合并的空数组）回退四档；旧版自动生成的「低中高」或「低中高+最高」声明自动补 xhigh；其余显式声明原样尊重。**主进程 `buildModelCatalog` 必须同规则**（两处各自实现，注释互指）——UI 能选的档 catalog 缺声明会被引擎拒。
  - **跟模型保存（二次保存 bug 的两个根源）**：① `applyEffort` 过去只在**无会话**时写档案 `setProviderEffort`（models[].effort + 顶层 + config.toml 兜底），会话里选的档位新会话弹回旧值——现在**无条件写**（档案值只作新会话兜底，会话内权威仍是每轮 turn/start 的 effort）；② `changeEffort` 补声明时 `patched` 带过期闭包里的旧 effort，upsert 会把刚写的档案覆盖回去——补声明必须显式带 `effort: value`。
  - **读取端**：`chooseModel` 切模型优先级 = 本地 model-efforts map → 档案 `models[].effort` → 会话记录 → 模型默认档；启动 `useModelProviders` 的 onAutoSelect 也读档案。
  - **验收坑（09-16 实录）**：e2e 档案是持久 profile——第一轮成功验收会把 xhigh 落盘，之后的反证（摘修复）永远绿。断言必须**两步自含**：先选「高」归零基准，再选「极高」验跟随；档位断言要断到主进程落盘的 `custom-model.json`，只看内存/界面会假绿。
  - 预检【25】16 条断言：档位规则用 **Node `--experimental-strip-types` 直接 import effort.ts 真代码**（不是字符串匹配）；7 条变异反证全红。桥对 chat 上游把 xhigh/ultra 压到 high。
  - **紧凑化 + 两端同步（09-16 追加，用户「注释删了，紧凑简洁展示；这两边能不能实时同步」）**：思考菜单每档下面的说明小字全部删掉（`effortMenuOptions` 不再有 desc，deepseek 特例一并撤）；tooltip 缩短为「思考强度」。模型编辑器「思考档位」勾选 chips 上加 **「当前」徽标**（`.type-chip.is-current` + `.chip-current`，与 composer 共用 `effort` 状态——composer 选档、编辑器徽标即时跟移；反向：编辑器取消勾选当前档由回落 effect 兜底）。

- **本地协议桥：chat-only 网关可以直接用了（09-16，用户拍板「加代理功能，换别的电脑也要能用」）**：
  引擎只会发 Responses（POST /v1/responses），而火山 coding / Kimi Coding 等网关只有 /v1/chat/completions——过去这类网关「连接测试通过、对话全废」。新增 `electron/responses-bridge.ts`：主进程内监听 `127.0.0.1:47121`（被占退回随机端口），引擎照常按 Responses 调用，桥按上游实际能力**透传（支持 responses 时零转换）或双向转换成 Chat Completions**（流式文本 / 工具调用分片 / usage 映射 / reasoning_content→summary 事件，推理内容已实证会落进 rollout）。凭据由引擎带入 `Authorization` 原样透传，桥不留存任何密钥 → **换电脑只需重填一次 Key，行为与设备无关**；代码随主进程编译进 dist-electron，无外部依赖、无安装步骤。
  - **接线（全部单点/兜底）**：`applyCustomModel` 的 `activeBaseUrl` 走 `bridgeDial`（provider/别名/harness 三段共用）；`codex:request` 入口 `bridgeRewriteProviderConfig` 统一改写渲染层自带的内联 config；桥未启动自动降级直连（行为同旧版）。
  - **auto 模式**：上游对 /responses 回 404/405/501 时自动切 chat 并缓存结论；引擎对探测 404 **无感知**（桥不把探测响应写回）。
  - **实证**：`scripts/probe-responses-contract.cjs`（录引擎真实请求：路径/头/工具扁平形状/input 元素）+ `scripts/probe-bridge.cjs`（mock chat-only 网关 + 真实 app-server 端到端：文本、工具往返 tool_call_id 对回、推理无解析错、auto 路由，两种模式 PASS）。
  - **防回归**：预检【24】26 条断言（接线 10 条 + 跑编译产物真实转换 16 条），已逐条合成反证（19 个变异全部可红）；真机验收（accept --only bridge-live，验完已删）8/8：桥 running、引擎 config.toml 7 段 base_url 全指向桥、端口真实监听、设置页新文案可见。
  - UI：设置页不再有协议下拉，改为「协议自动适配」说明；「测试连接」对 chat-only 网关改为成功提示（仅桥未运行时才警告）。

- **API 协议选择被静默改写（09-16 用户实测：「协议保存的时候总是自动跳转到 re 开头的协议，我选的是 CH 开头协议」）**：
  **先立实证**：`scripts/probe-wire-api.cjs`（独立 CODEX_HOME + 真实 app-server + mock 模型 API）跑两组对照——`wire_api = "responses"` 时 initialize/turn 全通、上游收到 `POST /v1/responses`；`wire_api = "chat"` 时 **initialize 能过但 `turn/start` 必报** `` `wire_api = "chat"` is no longer supported. How to fix: set `wire_api = "responses"` `` → 之后每个请求都失败（等同应用全瘫）。**结论：chat 是引擎侧硬拒载，不是我们没实现。**
  **真问题不是归一化，是它改得太安静 + UI 提供了永远无法生效的选项**：设置页「API 格式」下拉给了 Responses/Chat 两项，用户选 Chat → 保存时 `normalizeProvider` 把它改回 responses → 界面跳回，用户只看到「协议自己跳走了」。且探测侧还在推波助澜：`KNOWN_GATEWAY_MODELS` 把火山方舟（`volces.com`，用户唯一供应商）标成 `wire:"chat"`，`probeProvider` 又把 `wireUsed` **回写**进草稿 → 出现「探测说 chat、保存变 responses」的自相矛盾。
  **修法四处**：① `App.tsx` 撤掉「API 格式」下拉，改为如实说明（`provider-form-hint`）；② `probeProvider` 不再回写 `wireApi`，改为曝光致命诊断——实测只有 chat 能通时明确提示「该网关只支持 Chat Completions，引擎仅支持 Responses，连接测试能过但无法用于实际对话」（此前用户只会看到「配好了却用不了」）；③ `main.ts:7041` 保存入口与 3137 别名段、`App.tsx:12876` 会话接力内联 config 全部**显式恒 responses**，不再依赖下游 `normalizeProvider` 兜底（别名段那处尤其危险：`active` 来自 `readCustomModel()`，那个函数**不经过 normalize**，档案里一旦有 chat 残留就会把应用写死）；④ `saveCustomDraft` 保存时显式传 `wireApi:"responses"`。
  **防回归**：预检【23】8 条断言（5 条负向「坏串必判红」+ 3 条正向「保命逻辑别删」），**已逐条合成反证**（把坏串拼进文本确认判红，见 `recheck-wire-guard.mjs` 的做法）；`normalizeProvider` 的归一化与启动自愈里的 `chat → responses` 改写**必须保留**（清存量坏值）。
- **三连修复（09-16 用户实测）**：

- **三连修复（09-16 用户实测）**：
  ① **运行状态行上方整行留白**：真因是最后一个回合 `.turn-group` 的 `margin-bottom:32px` 紧贴 `.run-activity-bar` 叠出一行空白（上次修的 markdown 光标是**另一处**、位置找错了）。修法：`.timeline > .turn-group:has(+ .run-activity-bar) { margin-bottom:4px }`（`:has` 反向选中紧贴状态行的回合，空闲态间距不变）。离屏探针实测间距 32px → **2px**。
  ② **「保存供应商」失败也重启**（新增供应商保存重启后找不到的直接原因）：`saveCustomDraft` 内部吞错只写内联 notice，而「保存」按钮**无论成败都弹「已保存」并 relaunch**——校验失败（最常见：模型列表为空，主进程抛「至少勾选一个生效模型」）也重启，错误提示随重启消失。修法：`saveCustomDraft`/`saveCustomModel` **返回保存结果**，按钮失败时弹「保存失败，应用未重启」toast、不重启；主进程错误文案改为「请先在『模型列表』添加并勾选至少一个生效模型，再保存」。⛔ 通用教训：**catch 吞错的持久化函数必须把成败返回给调用方**，「成功才允许重启」这类后续动作不能建立在"没抛异常"上。
  ③ **档案清单防清空**：`custom-models.json` 曾被整份清空成 `[]`（伴随 relay 账号停用/删除操作，具体元凶未定）。`writeCustomModels` 现在写前备份上一版到 `custom-models.json.bak`（幂等，空/`[]` 不覆盖），任何清空都可手工回滚。
  另：用户机器上被清空的 5 条供应商档案已从 `config.toml` 的 `[model_providers.*]` 段重建（全部 `enabled:false`、`models:[]`，模型需重新勾选；引擎侧 base_url/env_key/统一通道未受影响）。

- **正文流式光标「占一整行」留白修复（09-16 用户截图实测）**：
  **现象**：助手回复最后一段与下方「正在深度思考 · …」运行状态行之间有一条空行留白。
  **真因**：`ProgressiveAgentBody` 把流式光标写成 `.message-body.markdown` 的**平级兄弟** `<span class="packet-stream-cursor">`；markdown 末块是**块级 `<p>`**，兄弟 span 被挤到下一行独占一个行盒（14px），且因 span 成为 box 内最后一个元素，`.message-body > p:last-child{margin-bottom:0}` **失效**、段落还留着 8px 底边距 —— 实测尾部死空间合计 **32.08px**。
  **修法**：删除该兄弟 span，改由 CSS `.message-body.markdown.packet-revealing > :last-child::after` 提供光标（内联跟在最后一行文字后）。工具代码块（`ToolCodeBlock`）的同类 span 是 `position:absolute`、不占布局，**保留不动**（`.packet-stream-cursor` 基类仍在）。
  **验收**：真实构建 CSS + 真实 DOM 结构跑对照，尾部空隙 32.08px → **0px**（基准组 0px，修复前组含 span 14px + 段距 8px + 基线偏移 9.67px）；截图肉眼确认光标由「独占一行」变为「内联句尾」。⚠️ 教训：**流式光标这类装饰性行内元素别写成块级容器的兄弟节点**——它会撑出一个真实行盒，且顺带破坏 `:last-child` 系样式。

- **模型上下文「只生效默认那个模型」修复（09-16 用户实测，致命 bug）**：
  **现象**：模型编辑器里给不同模型配了不同上下文（128000 / 1000000），但**只有默认那个模型生效**。
  **真因**：`config.toml` 顶层的 `model_context_window` 是**引擎的全局单值**，过去取「写配置那一刻生效模型」的 contextWindow 写下去 → 一旦落下就是**全局覆盖**：切到别的模型仍是旧值。实测铁证：同一模型 `deepseek-v4-1-flash` 在**同一会话**里，rollout 上报的 `model_context_window` 从 1000000 变成 128000（模型没变），而它配的是 1M —— UI 显示的正是这个引擎上报值。
  **探针实证**（`scripts/probe-context-window.cjs`：独立 CODEX_HOME + mock 模型 API + 真实 app-server，跑真实 turn 后读引擎自己写的 rollout）：写顶层 128000 时，模型 A(128000)→128000、模型 B(1000000)→**128000（被压掉）**；**不写顶层**时，A→128000、B→**1000000** ✓。
  **修法四处（缺一会残留或复发）**：① `applyCustomModel` **不再生成**顶层该键 —— 上下文只由 `model_catalog_json` 里每个模型自己的 `context_window` 决定（官方订阅走引擎内置模型目录，同样不需要）；② **新增废止键残留检查** `legacyContextKey`：「不写」≠「清掉已经写下的值」，用户机器上存着旧值，靠它触发一次整份重写清掉（`preserveUserConfig` 会丢弃该键，因此幂等）；③ 自愈判定删掉 `written !== wanted` —— 不写该键后这个条件**恒为真**（written 恒 0、wanted 恒正数），会每次启动都整份重写；④ `electron/config-toml.ts` 的 `HARNESS_CONFIG_KEYS` **必须保留** `model_context_window`（该集合的作用就是丢弃 harness 管的键，留着才能清掉旧值；移出会让旧值被原样拼回）。
  **验收**：探针两场景对照 + 端到端（篡改隔离 profile 的 config.toml 再启动，断言旧键被清 / model 未被误改 / catalog 仍在）= 4/4 通过；预检【21】4 条守卫，**反证逐条成立**（删残留检查、改回旧判定、加回生成行各精确红 1 条）。
  **⛔ 断言写法两个坑（本轮踩到）**：预检的 `ok()` / `fail()` **只接受一个消息参数**，写成 `ok(msg, cond)` 会**恒绿**（条件被静默忽略）—— 必须写 `(cond ? ok : fail)(msg)`；另外**模式别用会被自己注释命中的字符串**（`/written !== wanted/` 被注释里同名文字匹配 → 恒红），要匹配 `if (written !== wanted`、`const legacyContextKey =` 这类**代码形式**。

- **刻度尺「缩放后塌成方块」修复（09-15 用户实测，含一条通用架构陷阱）**：用户手动放大缩小窗口后，对话区左侧的消息刻度线变成一个方块。**根因是「不可见态污染状态」+「ResizeObserver 绑在已卸载节点上」**：
  ① 视口 ≤1080px 时 CSS 媒体查询把 `.message-ruler` 置 `display:none`，而 **ResizeObserver 会如实上报高度 0** → `measure()` 照单执行 → `setSlotPad(0)`，`--ruler-pad` 与 `--ruler-gap` 双双变 `0px`；
  ② 视口更窄时 JS 判定容器 <720px → 组件 `return null`，刻度尺 DOM **被卸载**；恢复宽度后 React **重建新节点**，但该 effect 依赖是 `[scrollable, allMarks.length]` 未变 → **不重跑 → ResizeObserver 仍绑在旧节点上 → `measure()` 此后再不执行**；
  ③ 于是 `pad=0` 永不被修正 → 所有刻度紧贴成 12×10 的一块 = 用户看到的「方块」。
  **修法两处（缺一不可）**：`measure()` 开头 `if (!h) return`（不可见态不采样）；effect 依赖加入 `containerNarrow`（节点重建时重新 `observe`）。
  **验收**：同一脚本跨阈值缩放（1280→900→1280）后 `padVar/gap/tickH` 与初始完全一致（`4px / 4px / 10`，刻度坐标 322/336 不变）；修复前同一脚本读数为 `0px / 0px / 2`；console 错误 0。
  **⛔ 通用教训（写任何 observer 前先看这条）**：只要「被 `ResizeObserver`/`IntersectionObserver` 观察的节点会被条件渲染卸载重建」，那个条件就必须出现在 effect 依赖里 —— 否则恢复后观察器**静默失效**，状态永久卡在最后一次读到的坏值。另：**`display:none` 期间 RO 会报 0，测量函数必须把 0 当「无效」而不是「真实值」**。
  **复现要点**：刻度尺需要「**≥5 回合的长会话**」才出现（内容不满一屏时 `scrollable` 为假、刻度尺不渲染）——隔离 profile 里点侧栏**最底部**那条（最老会话），或按会话名匹配，别点最新那条短会话。

- **「目标与进程」面板改造（09-15 用户定稿 A+B+C2+D）**：右上角悬浮面板（`.goals-pop`）此前只认 `planSteps`/`goalText`（引擎 plan / 目标事件），用 `task_add` 建的待办**永远唤不出它**（用户实测「让 Codex 创建任务清单也没有展示出来」）。四项改动：**① 数据实时同步**——`task_add`/`task_update` 处理点补 `listTasks().then(setTaskList)`（此前 `taskList` 只在挂载时拉一次，agent 建完前端完全不知道）；**② 完成即隐藏**——旧版是「跑完收纳 + 20s 后消失」，改为**空闲下降沿立刻隐藏**（用户口径「任务完成了就该隐藏掉，没必要还保留」），由常驻入口叫回；**③ 分区渲染（C2）**——`.goals-section` 两块：「执行计划」（planSteps）与「待办事项」（taskList），**两份独立数据、各自计数，不混列表**（语义与状态数都不同：一个有 pending/inProgress/completed 三态 + 流程图，一个只有 done/未做）；**④ 工具栏常驻入口** `.tb-goals-entry`——面板消失后唯一能叫回它的地方，带 `已完成/总数` 徽标，仅在有内容时出现。
  **⛔ 白屏事故的真因不是这段代码（09-15，查清后勿再误判）**：改完构建通过、但用户启动即白屏，一度怀疑面板 JSX。**真因是「单实例锁 + 构建窗口」**：① `electron/main.ts:2222` 有 `requestSingleInstanceLock`，**新实例拿不到锁就 `app.quit()`、已有实例被聚焦唤起** → 用户「重启」看到的永远是同一个旧窗口；② Vite 构建会**先清空 `dist/`**，用户若在这几秒内启动 → 加载到空/半写页面 → 渲染进程不崩所以窗口留成白屏。**两个条件叠加 = 怎么重建 dist 都没用，用户只能看到白屏**。处置：`taskkill /F /PID <主进程> /T` 清掉残留实例树后重新启动。**纪律：改 dist 的构建不要和用户启动应用并发**（要构建先问一句，或构建完主动告知「可以重启了」）。
  **验收方法（本轮踩坑后定）**：面板显示条件含 `thread`，而**乐观气泡不设 thread** → 停在首页/刚发消息时面板根本不渲染，「脚本跑通」是假绿（新代码一次没执行）。必须**打开历史会话**（点侧栏 `.thread-row` 内按钮）让 `goals-pop` 稳定出现，再点 `.goals-summary` 展开才覆盖到分区渲染。实测：`goalsSection: 2`、`goalsTaskList: 1`、`titles: ["执行计划","待办事项 0/1"]`、**console 错误 0**、截图 `.e2e-artifacts/shots/pw7-01-pw7-panel-body.png`。
  **测试设施补强**：`scripts/e2e/lib/harness.mjs` 此前只收 `Runtime.consoleAPICalled` 的 error，**未捕获异常一条都收不到**（白屏时零线索、只能靠猜）→ 已补 `Runtime.exceptionThrown` 捕获（进 `consoleLog`，`summary()` 会打印）。

- **⛔ 发送定位定稿：固定落点 = 对话区顶部往下一行半（36px），不是钉顶（09-15 用户口径，附截图框选）**：用户原话「把信息默认在这个位置，不要钉顶，把新消息每次都展示在这个位置」→「就顶边框往下一行半就行」。**做法**：`ANCHOR_TOP_OFFSET_PX = 36`（正文 14px × 1.72 ≈ 24px/行）+ `pinSentMessage` 把尾部 `.anchor-pad` **撑满一屏**（`el.clientHeight`）—— 留白把新消息**顶到**这个落点，消息仍在**文档流内**，agent 回复从它下方长出来 → **结构上不可能遮挡**。实测（CDP 时间序列，按文本定位）：发送后 1.34s/2.05s/3.26s 三次采样 `gap` 均 = **36px**，留白 padH = clientHeight。**⛔ 不要再引入 sticky**：三次尝试全部失败，根因是结构性的（① sticky 只在包含块内位移，而用户消息的包含块 `.turn-group` 刚发消息时只有 ~72px 高、下方无空间可借 → 钉不住，实测连发第 2 条 gap=396；② 留白放 `.timeline` 末尾是兄弟节点、扩不了包含块；③ 09-15 把它修「生效」后气泡变成**不透明白底浮层**，实测**盖住同回合助手消息**：`bubble 132~204` vs `text 170~959` → 用户看到「消息中间几行被竖着切掉」）。结论：**悬浮与「不占空间且不遮挡后代」在文档流里无法兼得**。`STICKY_USER_SLOT` 已**彻底删除**（连开关一起）；**预检【18】守卫**：气泡不得「悬浮+不透明底+正 z-index」三合一 / 不得为 sticky 保留 `content-visibility` 配套 / **不得再出现 `STICKY_USER_SLOT`** / **留白必须撑满一屏**。
  **⛔ 撤方案的纪律（bf53b81 的教训）**：撤掉一个方案时，必须还原**该方案改过的每一处**（`ea24b4d` 除了加 CSS/sticky，还把留白从「撑一屏」改成了「恒 0」；只撤 CSS 与开关、漏了这一行 → 留白恒 0 → 新消息顶不到落点、被钳在滚动底部，用户看到「还是在下面」）。显眼的 CSS 好撤，**藏在逻辑里的那半句才是最危险的**。
- **统一内置 provider id（09-14 用户定稿「做固定供应商 ID」，改这块先读这一段）**：新建会话一律绑 `HARNESS_PROVIDER_ID = "harness"`（纯模块 `src/lib/provider-continuity.mjs` 单一来源）——该 id 在 config.toml 里**恒写**且**永远指向当前生效供应商**（`harnessToml`；官方订阅模式不写，走引擎内置 openai 通道），顶层 `model_provider` 也指向它（覆盖「没显式传 provider」的建会话路径：渠道机器人 / 远控等）。→ 切供应商只需重写这一段 + 重启引擎注入新 Key，**所有会话零迁移直接可用**。
  **判定联动**：`shouldAlignProvider` 对 `bound === HARNESS_PROVIDER_ID` **短路返回 false**（天然对齐）；迁移路径（`migrateThreadToProvider`）也把会话改绑 harness 并写入绑定登记表 → **迁移过一次的会话永久对齐**，不再重复迁移。历史会话（rollout 里记着老 id）继续由**别名段**（`collectSessionProviderIds` 扫会话存档补段）+ 打开时的**静默对齐**兜底。
  ⛔ **打开会话的对齐必须静默**（`{ reason: "open", silent: true }`）：引擎侧会话绑定是创建时固定的，切过一次供应商后每个旧会话都「绑定 ≠ 激活」，若每次打开都弹「已自动接力」就变成「点一次会话提醒一次」（用户 09-14 实测）。提示只留给用户真有动作/真出问题的路径：**切换供应商 / 发送前发现异常 / 引擎 401**。
  验收：e2e 6/6 —— 造「绑定 ≠ 激活」（改激活供应商名，地址 Key 不变）后连点 3 个会话**零提示**且历史正常渲染；`thread/start` 用 harness **成功建会话**且返回绑定 = `harness`；config.toml 有 harness 段 + 顶层 `model_provider = "harness"`。预检【16】5 条守卫，反证成立（providerConfig 绑回真实 id → 立刻红）。

- **历史分页懒加载（09-14 用户口径，改这块先读这一段）**：用户要「历史切成一页一页、滚轮最多 10 轮、懒加载、不往上滚不渲染其他页，但**模型上下文不能丢**」。现有三件事已具备（窗口化 / `content-visibility` / 滚到近顶续载），这轮按口径调参并修掉三处真实缺陷：
  ① **首屏一页**：`TURN_WINDOW = 5` / `TURNS_PAGE = 5`（用户 09-14 定稿：只挂最近 5 个回合，越少越快；模块级 `RULER_PAGE = 5` 供刻度尺用，改页大小时两处一起改）（首屏取数 / 本地展开 / 网络分页共用）；`resumeThreadLight(turnBudget = TURNS_PAGE)` 打开会话只取一页 → 首屏成本 = 1 次 `thread/turns/list`。续载预取阈值 480 → 720px。
  ② ⛔ **自动续载只认「真实用户滚动」**（`userScrolledRef`：滚轮 / 触摸 / 翻页键 / 拖滚动条，`openThread` 里重置）：此前只看 `scrollTop < 720`，而打开会话的 `jumpToBottom`、插入内容后的位置补偿都会把 `scrollTop` 扫过近顶区间 → **「用户没滚也跟着加载」**（实测首屏白加载一页 3 → 6）。与既有铁律「绝不用 scrollTop 反推用户意图」一致。
  ③ ⛔ **位置补偿用锚点元素位移**，不用 `scrollHeight` 增量：`content-visibility: auto` 下离屏回合高度是估算值、`scrollHeight` 滞后 → 补偿不足、内容被顶飞（实测位移 4.3k px → 改用锚点后 385px）。做法：插入前记下「视口内第一条回合相对视口的 top」，插入后 `scrollTop += 新 top − 旧 top`；锚点已卸载才退回增量法。
  **上下文不受影响（用户最担心的点）**：分页只影响渲染与读取，引擎侧 rollout / auto-compact 自管；e2e 用「全部 rollout 的 `task_started` 总数在操作前后不变」证明（前端只渲染 9，引擎侧仍 304）。另修 `resumeThreadWithTurns` 多页取完后未交出游标的问题（会导致「往上滚到底」重拉最新一页、出现重复回合）。
  **刻度尺同步（同轮定稿；⛔ 间距压缩部分已被 09-18 口径**取代**，见下）**：MessageRuler 的刻度按 `turns` 派生（只取用户消息）→ 续载后自动补刻度；~~刻度间距走 CSS 变量 `--ruler-pad/--ruler-gap` 自适应压缩~~（**09-18 用户改口径**：「往上滚过一直透出不对，要滚动渲染刻度线」——压缩塞全部在页数多时成一根密集柱、且与视口无关。现改为**固定槽高 14px + 滑动窗口跟随滚动位置**，容量 `min(visibleCount, RULER_MAX)` 封顶，窗口起点锚 `currentIndex`、滚轮 `RULER_PAGE` 翻窗不变）；刻度选区只在 `currentIndex` 变化时归位（加载新页不会把选区拽回最新）；滚轮一次滑 `RULER_PAGE`（= 一页）。
  验收：预检【14】11 条静态守卫（含反证 3/3：窗口改回 400 / 去掉用户滚动判据 / 补偿退回 scrollHeight → 立刻红）；e2e 把 `TURN_WINDOW`/`TURNS_PAGE` **临时调小到 3** 逐步观察（8/8：没滚过 = 恰好一页 / 滚到顶 +3 / 按钮加载 +3 且位移 385px / 载入提示 / 引擎侧总数不变），跑完恢复 20 并重建。

- **✅ 切换供应商不断档：会话「自动接力」（09-14 用户定稿，改这块先读这一段）**：用户口径是「切供应商，原会话还能继续用」「提醒用户是自动接力、历史没丢，旧会话自动归档，让用户感知不出来」。统一入口 `App.tsx` 的 `alignThreadToProvider(threadId, target, { reason })`——四个场景**只走它**（打开会话 / 发送前 / 引擎 401 / 切换供应商），文案与行为一套：
  ① **原地迁移优先**（`migrateThreadToProvider`：`thread/resume{ model, modelProvider, config, sandbox, approvalPolicy }` 重绑定）——**threadId 不变**，聊天记录、侧栏位置、缓存全不动，用户完全无感；引擎侧一个线程一个 provider，settings/update 换 provider 会被拒，resume 是唯一官方通道。
  ② **原地失败 → fork 接力**（极老会话 / 无 rollout）：`thread/fork` 出带完整历史的新会话 → 绑定新供应商 → `openThread` 到新会话 → **`archiveThread` 旧会话**（⛔ 不是删除：归档可恢复，历史不丢），提示「原会话已归档」。
  **触发时机的关键改动（这才是「旧会话用不了」的根因）**：迁移原先只在**发送前**和 **401** 时触发，可**上下文压缩是引擎自发行为**（到阈值自己发请求），用户打开旧会话的瞬间它就可能撞旧绑定 401。现在 **openThread 的 resume 之后立即对齐**（`void`，不 await：打开动作不被迁移阻塞），并且带 `runningThreadIdsRef` 守卫（运行中的会话不打断）。
  **判定收在纯模块** `src/lib/provider-continuity.mjs`（`shouldAlignProvider` / `CONTINUITY_TEXT` / `ALIGN_RESULT`，预检【13】直接 import 断言）：⛔ **绑定未知（本次启动没 resume 过该会话）一律不迁移**——引擎是绑定的唯一权威，拿不到就不猜（与旧行为一致，避免误迁）；绑定 = 激活直接返回 `same`，零开销。
  **模型对齐**：迁移目标取当前**激活供应商 + 激活模型**（`activeProviderRef` 镜像，常驻事件处理器不能读 state），所以原模型不在新供应商时天然落到新供应商的当前模型。
  **⛔ 丢更新陷阱（已修）**：openThread 的模型回填 `restoredModel` 必须先判 `willRealign`——即将接力的会话直接取**激活模型**；否则 openThread 先用旧记录写一次 `thread-model-<id>`，异步迁移完成后再写新值，时序反了就互相覆盖。
  **验收**：预检【13】16 条静态+纯函数断言（含反证 3/3：去掉「绑定未知不迁」/改 `await` / 去掉归档 → 对应断言立刻红）；e2e 真链路（复制真实 profile → 把激活供应商改名 `custom907-relay`，**地址与 Key 不变**，等价于换供应商 → 打开真实旧会话）7/7 —— 触发提示、完成提示、历史完整渲染（13 回合组）、`thread-model-<id>` 指向新供应商。**临时脚本跑完即删（用户口径），此处只留口径与判据。**

- **独立会话弹窗（09-13）**：会话可开成**独立 BrowserWindow**（主窗口之外多个同时存在、互不干扰），三种打开方式——① 顶栏 📁 左边「独立会话弹窗」按钮；② 侧栏会话行**长按 600ms 拖出**（拖出态行高亮 + 浮动 ghost 提示，松手即弹窗）；③ 同一会话重复弹窗 → 聚焦已有窗口。主进程 `electron/main.ts`：`popoutWindows` Set + `createPopoutWindow()`（同款 hidden titleBar + overlay 43px，可拖出应用外）+ `window:popout-thread` / `window:popout-close` / `window:popout-id` 三个 IPC；`codex:event` 改 `broadcastCodexEvent`（主窗口 + 全部弹窗）；**主窗口 closed → 弹窗跟随关闭**；`theme:apply` 遍历所有窗口。渲染层 `src/App.tsx`：弹窗窗口 = **完整主界面克隆**（侧栏/顶栏全保留，可自由切会话），boot 前探测 `popoutThreadId` 并锁定初始会话（不读 last-thread）；弹窗顶栏同位置变「返回主应用」按钮（`popoutClose` → 主进程关弹窗 + 发 `harness:event {type:"popout-return"}` → 主窗口 `openThread` 带回）。preload/vite-env 三方法对齐（check 预检【2】IPC 一致性守卫覆盖）。验收：`--only popout-window`（7 断言：按钮存在/引擎侧取 id/IPC 受理/主窗口非弹窗/返回通道可达）+ 弹窗窗口 CDP 全链路实测（会话锁定一致/返回按钮/侧栏 22 行/截图）。

- **手机远控二次加固：6 位配对码 + 电脑端审批（09-13）**：手机扫码/打开链接后不再「连上即控」。新流程 = 输入电脑端显示的 **6 位配对码**（5 分钟有效、错 10 次作废、可刷新）→ 挂起等电脑端在「手机远控」面板点**允许/拒绝**（请求到达时面板自动弹到前台 + toast 提醒；2 分钟没人理自动过期）→ 通过后以 HttpOnly cookie 下发凭据（`harness_remote` + `harness_device`，https 场景带 Secure）。**已批准设备持久化**（`userData/remote-devices.json`），再连直接进、可单独移除。**二维码/配对链接不再夹带 `?k=` 凭据**（能力式 URL 会随链接/截图/历史/隧道日志外泄）；`authorize()` 只认「凭据 cookie + 已批准设备」，未配对访问 API/WS 一律 401、页面落到配对页；fail-open（token 为空全放行）已删。实现：`electron/remote.ts`（pairing/pairRequests/approved + `/api/pair`、`/api/pair-status`）+ main.ts IPC（`remote:pair-state/approve/deny/revoke/pair-rotate`）+ App.tsx 面板（配对码大字/审批卡/已批准设备列表）。回归：`scripts/accept.mjs --only remote-auth`（14 断言：无凭据 401/配对页/错码拒绝/对码挂起/审批前仍 401/审批卡/点允许/cookie 下发/带凭据 200/已批准直连）；预检【11】新增静态守卫（配对地址不得夹带 accessToken、必须有配对码+审批入口）。

- **⛔ 安全审计第二轮：fs 通道收敛 + CSP（09-19，用户「用户隐私必须重之重，给我修复好」，推翻 09-13 的「fs:write 保持原语义」决策）**。全库审计四方向（Electron 配置 / 后门特征 / 本地服务面 / 更新与密钥）结论：无后门、无遥测、无隐蔽持久化；两处高危 IPC 缺陷本轮修掉：
  - **`fs:read`（任意路径读 → 可信根）**：预览通道原来零校验，渲染层被注入即可读全盘文件。收敛到 `isInsideTrustedRoots`（各会话工作目录 + userData + 用户亲自用系统对话框选过的路径，与 harness-image 协议 09-13 S5 完全同口径）。
  - **`fs:write`（校验形同虚设 → 可信根）**：原校验的 `root` 由渲染层传入，传 `C:\` 即绕过 = 任意路径写。`root` 参数不再参与判定，一律过 `isInsideTrustedRoots`。
  - **同口径收敛**：`shell:reveal`（新增 `isInsideOrEqualTrustedRoots`，允许揭示可信根本身——reveal 工作区/userData 是合法用法）、`updates:reveal`（只认「刚下载并通过 sha256 校验的那个安装包」，与 `updates:install` 同口径）、`terminal:restart`（cwd 验证存在且是目录；终端本身可交互 cd，故做存在性校验而非白名单——白名单挡不住 cd、只会误伤合法用法）。
  - **`thread/list` 响应记账 cwd**（主进程 `threadCwd` 表）：可信根集合才能覆盖「本轮没 resume 过的侧栏会话」，旧会话文件预览不被误伤。⛔ 守卫锚点两次假红教训都出在锚点上：必须锚**记账分支独有**文本 `method === "thread/list" && Array.isArray(r?.data)`，锚到 3700 行的列表增强块或用短窗口都会「代码明明写了、守卫照样红」。
  - **CSP（index.html）**：`script-src 'self' 'unsafe-inline'`（inline 保留是 GenerativeWidget srcdoc 可视化卡片要在 iframe 跑内联脚本，srcdoc 继承父文档 CSP）+ `object-src 'none'` + `base-uri 'self'` + `form-action 'none'`——封死「注入脚本加载外部代码」与劫持；`frame-src *`（PDF 查看器内部导航 chrome-extension://，且内嵌网页本就走 webview 不经 CSP）；img/fetch 放行 https 与本地协议不破外链图片。
  - 守卫：预检⑦层 7 条（fs:write/fs:read/shell:reveal/updates:reveal/terminal:restart/thread-list 记账/CSP），**反证 4/4 成立**（fs:read、fs:write、CSP、thread/list 摘掉即红）。accept 当轮因并行会话未提交的 App.tsx 半成品导致 CDP 握手超时无法跑通（与 CSP 无关——摘掉 CSP 同样超时，已隔离实验证明），待并行改动收口后复跑。


- **✅ 发送锚顶 · 09-13 定稿（当前实现，改这块先读这一段）**：完整走过一天弯路后的收敛版本，**只有三个概念**：
  ① **位置 = 把「这次发送的那条用户消息」放在对话区顶部往下 `ANCHOR_TOP_OFFSET_PX`(54) 处**，唯一 owner 是 `App.tsx` 的 `pinSentMessage(el, threadId)`：锚点取**当前回合里的真实 `.user-message` 元素**（不在发送前回合基线里才算"本次新建"；乐观阶段尚未落进回合时才退回 `#chat-anchor`）。首次调用**立即**落位；之后每次调用**实测 gap**，偏差 > 8px 才延一帧再量一次并一次性修正。**不要**再引入第二个写滚动条的地方 —— 这一天所有"抖/跳/位置不对"最后都归到"两个 owner 抢同一根滚动条"。
  ② **内容一旦长出视口，钉顶就"交棒"给跟随**（`pinGapLockedRef` 记下这个 key，此后不再纠偏）：**「消息稳在 54px」与「最新一行可见」在超屏时必然二选一**，两头都要 = 每 60px 互拉一轮（打点原文 `follow-grow{+65}` → `pin-fix{−65}` 循环）。短回复继续纠偏，长回复消息自然往上走。
  ③ **跟随 = 一条规则 + 一个步长**：`dist = 内容底部 − scrollTop − clientHeight`，`dist > 48` 才**整体**补一次（两次之间视口完全静止）。**不要写成逐帧跟随**（`dist > 8` 就补）——打字机逐字揭示、末行不断重排，逐帧跟随 = 视口每帧都在动，用户原话「长消息换行跟自动跟随在抢，整个内容上下跳动」。
  **所有"滚到底 / 跟随到最新"一律以「内容底部」为准**：`contentBottomOf(el) = scrollHeight − Σ 尾部留白高度`（`.timeline-bottom-spacer.compact` 64px + `.anchor-pad`）。**绝不能用 `scrollHeight`** —— 留白被算进"内容"后，"到底"= 滚进留白，切回会话就是「用户消息被切在视口顶 + 下方一大片空白」（用户截图实锤）。`jumpToBottom(scroller, onSettled, getTarget?)` 第三个参数就是为此加的。
  **解除钉顶只有一个信号：真实用户输入**（滚轮 / 触摸 / 键盘翻页 / 指针拖拽，见 `releaseToUser`）。**已彻底删除**「按 scrollTop 方向猜用户意图」那套启发式 —— 流式增长、浏览器 clamp、`content-visibility` 重排都会让 scrollTop 自己动，从 scroll 事件里根本分不清是谁弄的（旧判据实测把钉顶自己掀掉，用户看到"消息不在那个位置"）。
  **钉顶跟着会话活着**：`pinThreadIdRef` 记归属；切到别的会话 = **休眠**（`pinDormant`：不生效也不销毁），切回来立即复活（`pinDormantSeenRef` → 当 first 处理，因为切回那一帧几何是脏的，延帧纠偏会被跟随抢先）。`openThread` 里**只清留白**，**不要**清 `anchorTopRef` —— 清了就是「切换会话，钉顶没了」。归属记账必须用调用方传入的 threadId，**不能**用 `threadRef.current`（被动 effect 更新，布局 effect 期间还停在上一个会话）。
  ⛔ **sticky 方案已证伪，别再试**：`position: sticky` 只能在**包含块内部**位移，用户消息的包含块是 `.turn-group` —— 刚发消息时组里只有这条消息（~72px），下方没有空间可借，钉不住（实测连发第 2 条 gap=396）；把留白放到 `.timeline` 末尾是**兄弟节点**，扩不了包含块。
- **验收口径的硬要求（这一天的假红假绿都出在这里）**：① **采样必须跑到事件真正结束**（回合跑完再收工，收尾时若还有回合在流式要等它跑完再关应用）—— 用户原话「每次测试消息都不看完，你能发现什么bug，总是运行中就杀应用」，长回合的问题只在后段暴露；② **跳变判据按方向分开**：向下大跳 = 内容成批到达后的追赶（允许，≤1.5 屏），向上大跳才是"往回拽"（≤60px）；采样前 5 帧是**落位本身**，不计入判据；③ **内容完整性不能用会随渲染状态变的量**：折叠组收起时 `innerText` 为空、`textContent` 才与折叠无关；④ 判据落在**正在跑的那个回合**上（`lastTurnText`），别用整条时间线的总量；⑤ **切会话要点「会话标题」而不是行索引** —— 侧栏按最近活动排序，刚发过消息的会话会跳到最前，索引会指到别的会话上去（用索引测出来的"钉顶没了"有一半是假红）。
- **`switchJumpRef` 必须是 `{id, at}`，不能是裸布尔**（这是「发送后消息不在那个位置」的真根因）：裸布尔在"打开会话时置位、当次却没有紧跟一次 thread 变更"（缓存秒开路径）时会一直挂着，直到**发送**触发的那次 thread 更新把它消费掉 → "切会话瞬时定位"分支在发送时执行 = 解除钉顶 + 留白归零 + 贴底。绑 id + 15s 过期后只有该会话自己的渲染能消费它。
- **`mergeLongerStreams` 必须做并集**：resume 快照常常只带部分 items，早期实现只遍历快照 → "缓存里有、快照里没有"的条目**整条消失**，用户看到「运行中切走再切回，对话区整个不展示」（实测同一时间线 textContent 39341 → 6107）。以**缓存顺序**为骨架逐条合并，快照新增的追加末尾，快照整段没带回来的回合补在最前。
- **诊断探针 `window.__adbg`（排这类问题的最快路径）**：打点 `send-arm-main / init-pin / pin-enter / pin-apply / pin-fix / pin-miss / follow-grow / stick-jump / clear-anchor{at} / release:{why} / thread-switch / reveal`。**先拿打点再推理**：这一天每次"猜根因"都猜错，每次"打点"都一击命中（`pin-fix{err:-65}` 与 `follow-grow{+65}` 互拉、`clear-anchor{at:"switch-jump"}` 在发送时触发、`pad:622` 残留……全是打点直接看出来的）。`scripts/accept.mjs --only send-anchor` 会把整段轨迹打出来。
- **⚠️ 以下 09-12 版实现细节已部分作废（`anchorHeightBaselineRef` 增量基线、`byUs` 判据、anchor-pad 按锚高自适应、`cancel:bottom-scroll` 方向判定、`scripts/e2e/**` 场景）全部已删除，仅作历史留档**：目标观感 = WorkBuddy——**每次**发送都把新消息钉在对话区顶部，回复向下展开，视口全程稳定（用户明确「每次发新消息都要在那个位置」，不要自动转贴底）。已落地并验证：①跟随/钉顶全部瞬时滚动（`scroll-utils.ts` 的 `scrollToOffsetInstant`，`.timeline` 的 CSS smooth 让 `behavior:"auto"` 也走动画）；②`.timeline` 加 `overflow-anchor:none`；③程序滚动抑制窗 `selfScrollUntilRef`（钉顶/贴底后 80ms 内的 scroll 事件只刷新基线不做方向判定）；④打字机 packet-reveal 的贴底驱动加 `!anchorTopRef` 守卫；⑤「已工作 X 秒」指示已删。
  **连发失效的真根因（09-12 晚实测探针定位，勿再按「分支没执行」方向排查）**：不是逻辑分支没跑（`init-pin`/`confirm-fired` 探针三连条条都触发），而是**几何 + 误判双重**——(a) **几何**：视口高 622px 而短消息只有 72px，锚点**下方没有内容**时 `scrollTop` 被浏览器钳在 `maxScroll`（探针实测 `want=1598 / got=1155 / sh=1777 / ch=622`，精确等于贴底位置），消息停在视口中间；第一条长消息能成，是**因为它自己就撑满了一屏**（`aH=1102`）。(b) **误判**：被钳制那一下 `scrollTop` 是**增大**的，`update()` 里「scrollTop 真实增大到触底 ⇒ 用户主动往下滚 ⇒ 解除钉顶」把它当成用户行为，于是钉顶**自杀**、退回贴底（away=0）——这条本来是为「回合完成时思考卡折叠导致 dist 骤减」加的防御，反被自己触发。
  **修法（两处，互为冗余）**：①新增**锚顶专用底部留白** `.timeline-bottom-spacer.anchor-pad`（`anchorSpacerRef`，inline height = `clientHeight − 锚点高`，排在 `#chat-anchor` 之后），把锚点下方补足到一整屏 → `scrollTop` 够得着锚点；高度必须随锚高自适应，固定的「一屏」会把下一个新消息的坐标一起撑大（实测 `want` 因此大于 `maxScroll`）。②`pinnedScrollTopRef` 记下**每次钉顶实际落点**，`update()` 里加 `byUs = |scrollTop − pinnedScrollTop| ≤ 2` 判据，把「自己造成的钳制」从「用户滚到底」里摘出来。解除钉顶（上滚 / wheel / 触底）时同步 `pinnedScrollTopRef = -1` + `clearAnchorPad()` 归零留白，避免残留一屏空白。
  **验收**：`scripts/e2e/scenarios/send-anchor-top.mjs` **21/21**（连发三条逐条断言钉顶，gap 实测 5/0/1px，`scrollTop < maxScroll` 证明未被贴底接管）；**联合反证已做**：把留白与 `byUs` 同时关掉 → gap 立刻回到 379/280、`scrollTop === maxScroll`（3 条红），恢复即绿——两个机制各自都能兜住，故**不要单独删任一个**。
  **「不自动贴底」的断言口径**：不能用 `away > 80`（短回复本来就在视口里凑不满一屏，away 天然很小，实测 gap 稳定 1~6px 时 away 只有 67 → 假红）；要用 **`scrollTop < maxScroll − 4`**（视口没停在内容最底部）。
  **落点偏移可调（09-12 晚用户反馈「太高了，往下放两行」）**：钉顶落点由常量 **`ANCHOR_TOP_OFFSET_PX`（`App.tsx` 紧邻 `TURN_WINDOW`，当前 **54**）** 控制，三处使用点（确认换锚 6711 / thread 布局 effect / init-pin）都用它，**不要再写魔法数字**。语义 = 锚点顶部再下移这么多像素（原来只上移 6px，首行几乎贴着对话区上沿）；54 = 原来的 6 + 两行正文（正文 14px × line-height 1.72 ≈ 24px/行）。**用户想再往下就调大这个值**（一行 ≈ 24px）。改后实测 gap 6 → 54（正好 +48），场景 21/21。
  **⚠️ 钉顶必须带「增量自动跟随」（09-12 用户实测二次反馈：「回复流出屏幕、看不到最新」，原话「出消息自动跟随很难吗」）**：第一版 v2 把跟随**整个关掉了**（坚持「不自动转贴底」），后果是消息钉在顶部后正文一路往下流出屏幕、视口钉死不动 → 大片空白 + 看不到最新内容（用户截图实锤）。
  **定稿语义（两者必须同时成立）**：① 新消息钉在顶部（位置稳定）；② **内容每长出一段，就按「增长量」把视口往下推同样多**（`update()` 里 `anchorHeightBaselineRef` 记录基线，`growth = scrollHeight - 基线`，`scrollTop += growth`）。这样新内容始终可见，又不会像旧版「每字重推整屏」那样跳动——**跟随 ≠ 贴底，跟随 = 只补增长量**。
  实现要点：跟随判定必须放在 `update()` 的**方向判定之前**，并同步推进 `lastTop` / `pinnedScrollTopRef`，否则自己的程序滚动会被当成「用户滚到底」而误解除钉顶。基线在每次钉顶后重置为当前 `scrollHeight`。
  回归：`send-anchor-top` 第 ⑥bis 步「长回复时最新内容必须可见」（回复长过一屏后断言 `away ≤ 120px` 且最后回合底部在视口内）；**已反证**：把增量跟随关掉 → 该断言立刻变红（away 130 且越流越大），恢复即绿。
  注意区分：用户消息**自身**比一屏还高（长粘贴）时钉顶无意义（整条装不下），此时跟随底部看结尾才是期望——不要用「锚点高度 > 视口高」去解除钉顶后又立刻被 clamp 逻辑拉回来。
  **⚠️ 长消息不钉顶（09-12 用户实测第三次反馈：「一次发很长消息，一屏展示不下来，agent 会话后马上跳转到 agent 回复消息的那个位置」）**：钉顶的前提是「用户消息能装进一屏」。用户消息**自身**比一屏还高（长粘贴/多段长指令）时钉顶没有意义——整条装不下，钉顶只会把 agent 回复推到屏幕外。**判据必须是「锚点自身高度 > 视口高」**（`a.getBoundingClientRect().height > el.clientHeight`），**不能用 `scrollHeight`**：后者会把「回复长过一屏」也误判成溢出，导致正常短消息一发送就被推到底部（实测 gap -296，已废弃该方案）。命中长消息时：`anchorTopRef = false` + `clearAnchorPad()` + `stickToBottomRef = true` + 瞬时滚到底 → 用户马上看到 agent 回复位置，随后走常规贴底跟随。
  三条语义现在各自独立、互不冲突：①**短消息** → 钉顶（gap≈54）+ 增量跟随；②**回复长过一屏** → 仍钉顶，靠增量跟随保证最新可见；③**用户消息自身超一屏** → 不钉顶，直接跟到回复位置。
  回归：`send-anchor-top` 第 ⑥ter 步（超长消息断言 `away ≤ 240px` 且最后回合底部在视口内；实测 `userTopVisible=-1381 / away=0`）；第 ② 步已改成**短**消息（原为长消息，与新语义冲突）。
  **⚠️ 锚顶留白必须归零（09-12 用户反馈「流动空间太大，汇总时上面消息都看不到」）**：`.timeline-bottom-spacer.anchor-pad` 只为「让锚点滚得上去」而存在，但它是**常驻 DOM 元素**，用完不归零就会在回合结束后残留一整屏空白。**三个归零时机**：① `turn/completed`；② 切会话（`switchJumpRef` 分支）；③ `thread?.id` 变化 effect。钉顶期间的行为不变。**不要**改成「按差额动态收缩」——流式增长会让差额归零、把留白撤掉，锚点立刻被 clamp 弹飞（实测 gap 23→363）。
  **切会话正文重播（09-12 用户反馈）与取证手段**：打字机揭示有进度表（`revealProgressStore`）防重播，但重挂载时若进度表与新渲染对不上就会整段重播。**已加诊断打点**：揭示开始时向 `window.__adbg` 写 `{r:"reveal", key, from, to, animated}`；`multi-session-live` 第 ④bis 步据此断言「单次 animated < 200 字」。实测切会话 揭示次数=0（无重播）。**另外**：`enrichThreadWithRolloutTools` 曾加过「同对象短路返回」优化，它会改变 `thread/resume` 返回对象的引用身份——渲染层据此判断「是否同一批流」，是重播的可疑来源，**已删除**（性能收益由 `parseRollout` 增量解析承担，不改变对外行为）。
  **✅ 流式中切会话切回不再重播正文（09-12 用户精确复现：「都是运行过程中，正文出来了一些，切过去，才会触发正文重新出字」）**：**必须按这个步骤验**——切走时回合**仍在流式**，等跑完再切是测不出来的（第一版取证就是这么漏掉的）。
  复现数据（修复前）：切走时正文 238 字 → 切回涨到 1078 字，`reveal` 打点 `{from:244, to:1078, animated:834}` —— 把 834 个字的**存量**重播了一遍。
  根因：`usePacketRevealText` 重挂载后从 `revealProgressStore` 续播，而进度表存的是**切走那一刻**的位置（244），正文已长到 1078 → 中间 834 字存量被当成「新内容」逐字播出。既有的防重播只挡住「从头播」，挡不住这种。
  修法：**存量正文一次性显示，只对真正新到的增量做打字机**。判据 `remaining > REVEAL_INSTANT_JUMP(400)` → 判定为「重挂载补齐存量」→ 直接显示（单帧/单批真实增量在几十字量级，400 是安全的量级分界）。
  回归：`scripts/e2e/scenarios/replay-on-switch.mjs`（真引擎：A 流式中切走 → 切回 → 量 `window.__adbg` 的 reveal 打点；断言「单次 animated < 120 字」+「正文长度不回退」）。修复后实测 最大单次揭示 **834 → 30 字**，8/8 通过。
  **排查工具**：`window.__adbg` 探针（send-arm-main / init-pin / confirm-fired / cancel:bottom-scroll / pin-apply / thread-switch / reveal），场景每条消息结束自动 dump 轨迹，`node scripts/e2e/run.mjs send-anchor-top` 直接复跑。**注意**：App.tsx 是 CRLF 行尾，脚本批量替换务必容忍 `\r?\n`；e2e harness 已带 `--no-sandbox`（本机 WorkBuddy 宿主 shell 会话下 Chromium 沙箱可能起不来 → Electron 静默 exit 1，与代码无关）。**另一个坑**：改 `styles.css` 不要用 PowerShell `Add-Content` 追加中文（会写进非 UTF-8 字节 → vite 报 `stream did not contain valid UTF-8`、构建直接失败），要用编辑工具。
- **首次对话身份引导：只打一次招呼（09-12 两轮反馈：「怎么每次新会话都强制引导呢，改成一次打招呼才需要引导，其他情况下直接开始干活」→「我看每次思考还说新会话引导那个」）**：`personalization.json` 新增 **`greeted`** 字段——`onboarded` 表示「用户**真的回答了**并落盘了信息」，`greeted` 只表示「**问过一次**」。判定看 `greeted`（`App.tsx` 的 `identityGreeted`，读档时 `greeted === true || onboarded === true` 都算已问候）；注入引导指令的**同时**调新 IPC `personalization:mark-greeted` 落 `greeted=true`，此后新会话一律不带引导、直接干活。IPC 三件套同步（main.ts handler ↔ preload `markIdentityGreeted` ↔ vite-env.d.ts + `PersonalizationConfig` 加 `greeted`）。
  **存量用户迁移（09-12 补，`migrateGreetedForExistingUsers`）**：老档案没有 `greeted`，而 `onboarded` 只在用户真的回答过提问后才为 true → 「装了很久、聊过很多次但从没回答过提问」的用户（本机真实档案正是 `onboarded:false` 且无 `greeted`）升级后又被当成第一次见面。现在启动时迁移：**档案无 `greeted` 且该 profile 已有历史会话 → 直接落 `greeted=true`**（零会话的真·新用户不写，保留一次引导）；**不写 `onboarded`**（那表示"用户回答过"，不能伪装）。调用点必须在 `server.start()` 之前且包 try/catch（preflight【5】硬守卫）。
  **⚠️ 判据必须按 `role === "developer"` 判，不能对整份 rollout 文本 `includes("初次见面")`（09-12 实测踩坑，差点写成"修了还是没修"）**：本文件（项目 AGENTS.md）**自己**就有一段身份引导文档，写着「初次见面」四个字；而 e2e 的工作区 = 项目根 → 引擎把项目 AGENTS.md 注入**每个**会话 → 对整份文本做 includes 会对**每个**会话都为真，断言恒定红（实测：修复后次会话被判成"仍有引导"，纯属误报）。权威判据只有一条：rollout 里 `role === "developer"` 的 message 是否带引导指令（引导走 `developerInstructions`；项目 AGENTS.md 走 `role: "user"` 的「# AGENTS.md instructions」消息）。工具落在 `scripts/e2e/lib/rollout-inspect.mjs`（`greetingInjected` / `GREETING_MARKER`），preflight【7】守卫「判据标记与 App.tsx 注入首句同源 + 限定 developer 角色」，脱钩即硬失败。
  回归：`scripts/e2e/scenarios/identity-greeting-once.mjs`（11/11：首会话**有**引导、次会话**没有**、档案 `greeted=true`、**重开应用（重载渲染层）后新会话仍没有**）与 `identity-greeting-migrate.mjs`（8/8：种入历史会话 + 无 `greeted` → 启动即迁移、新会话不带引导）。**反证已做**：把判定退回「只看 `onboarded`」→ 只有"重开后"那一步红（同一次运行里内存标志会掩盖，**这正是该步存在的理由**）；关掉迁移 → migrate 场景 3 条红。
- **⛔ 零阻塞宿主（09-12；架构约束，preflight【6】硬守卫）**：**`ipcMain.handle("codex:request")` 的处理链上禁止任何同步磁盘 I/O**。理由：所有会话共用同一个主进程事件循环，同步读盘期间**所有会话**的事件转发全部停摆——这就是「多会话一起卡」的形态。落地上 rollout 的目录遍历/解析（原 `session-tools.ts` 的 `listRolloutThreads` / `enrichThreadWithRolloutTools`）已**整体迁入 worker 线程**：实现 `electron/rollout-worker.cjs`，客户端 `electron/rollout-pool.ts`（常驻 worker + 请求 id 配对 Promise + 15s 超时 + 崩溃时失败在途请求并允许重建）；`session-tools.ts` 精简为**纯内存**的 `mergeThreadList`。
  **worker 源码必须内联成字符串**（`scripts/gen-rollout-worker.mjs` 生成 `electron/rollout-worker-source.ts`，已挂进 `build:electron`，生成物不入库）：打包后 worker 文件在 `app.asar` 内，而 `new Worker(路径)` 走 C++ 层读文件、**不经过 Electron 的 asar 补丁** → 读不到（语音 worker 踩过同一个坑，用 `{eval:true}` 绕开）。
  **preflight【6】两条硬失败**：① `main.ts` 不得再出现那两个同步函数名；② worker 内联产物必须存在且不落后于 `.cjs`。**以后往 codex:request 链上加「要看磁盘」的能力，必须走 worker / 异步 fs / 内存缓存。**
  **实测收益**：10 会话并发压测下主进程探测最大 **37ms → 17ms**（多数 1~3ms）；切会话冷启动 **939ms → 11ms**、热切换平均 **15ms**。
  **关于「一会话一进程」的评估（结论：暂不做）**：单引擎空闲实测仅 **31MB**（10 个 ≈ 310MB），内存可行；但 ① 引擎只有**一把全局 Key**、`config.toml` 只有一份 → 要做得先解决「每会话一份 config + Key 池」，会推翻现有全局互斥/旧会话迁移/会话独立选模型；② 实测引擎侧已不是瓶颈。**另注：DSH 自己也不是一会话一线程**（一个 Node 宿主 + 一个事件循环 + 每会话协程式 Agent 对象，包名 `dsh-subagent-in-process-driver`），我们的「单引擎多 thread」在会话粒度上已与它等价。
  ① **大 payload 延后解析**（`electron/codex-server.ts`）：所有会话共用一条 stdio 管道而 `JSON.parse` 是同步的 → 超 **256KB** 且头部含 `method`+`params` 的行延后到 `setImmediate` 解析（延后项走单条 Promise 链保序）；小行仍同步解析保持即时性。
  ② **引擎 stderr 不再转发渲染层**：渲染层对 `kind:"log"` 直接 return 丢弃，转发是白付 IPC 序列化；仍落 `engine-debug.log`。
  ③ **channel-bot 短路**：未启用（`!config?.enabled`）或该会话**没绑定任何渠道**时直接返回，不再对所有会话的每条 delta 做 `+` 拼接（长回复 O(n²)）。
  ④ **`turn/completed` 不再每回合一发 `thread/list`**：该事件自带完整 turn，本地 `mergeTurn` 进缓存 + 就地更新侧栏那一项；只在「没缓存」「还有别的会话在跑」时才走去抖刷新兜底。新增 `app:perf-counters` 的 `threadListRequests` 计数供度量（注意：新建会话路径仍会刷新侧栏，所以计数不会归零）。
  **出字抖动修复**：增量跟随的阈值原为 `growth > 2`（等于每变一点就滚一次 → 视口被反复顶 = 「每出一行抖一下」），改为攒够 **`FOLLOW_STEP_PX`(60px ≈ 两行)** 才跟一次；且**基线只在真正滚动后推进**（无脑刷基线会让 growth 永远攒不到阈值、跟随失效）。回归：`send-anchor-top` 的防抖断言——流式中连续 14 次采样，**相邻最大跳变实测 0px**。
- **应用内通话界面 + 语音快捷键修复（09-12 下午）**：①新增**来电式全屏通话界面** `VoiceCallScreen.tsx`（`.voice-call-screen`，深色渐变+居中大头像随 `--voice-level` 呼吸发光+状态字+你说/回复字幕区+底部大圆钮打断/挂断）；接通自动弹出、右上角「收起」只收界面**不挂断**（悬浮球继续承载通话），右键菜单「打开通话界面」随时唤起；纯展示组件，音频链路全留在 VoiceCallFloat。**踩坑**：入场动画若带 `opacity:0` 起点，在 GPU 合成/遮挡节流下可能冻在第一帧把整个界面冻透明——动画只动 `transform`。②全局快捷键三连修：VoiceCallFloat 的 `onVoiceHotkey` 回调空依赖闭包锁死挂载时的 startCall/threadId（切会话后快捷键「就用不了」的根因）→ 经 ref 每次渲染转发最新 handler；录入组合键主键改按 `e.code`（Ctrl+Shift+1 的 `e.key` 是「!」，按 e.key 匹配被静默丢弃）、`metaKey` 映射 Super 不再冒充 Ctrl；**注册成功才落盘**（先落盘再注册会在新键被占用时留下死键配置且旧键已注销），主进程 `applyVoiceHotkey` 改为先注册新键再放旧键、同键重复设置直接成功。③e2e 流程改版（用户定稿）：`npm run e2e` 默认**只跑 mtime 最新的场景**，`--all` 才全量。回归：`scripts/e2e/scenarios/voice-call-screen.mjs`（16 断言，含「收起≠挂断」与输入链路零回归；harness 新增 `evalInTarget/screenshotInTarget` 供多窗口场景用）。

- **技能运用纪律（09-13，让 Codex 主动用技能与 MCP 办事）**：`electron/skill-discipline.ts` 往 codex-home/AGENTS.md 幂等注入 `<!-- skill-discipline:start/end -->` 区间（boot + 技能装/卸/启停/导入 + 连接器增删/启停 + personalization 保存都会刷新），内容 = ①运用守则（开工先匹配能力、缺技能自主搜市场并安装、缺连接器先查模板且**必须 agent_ask 征得同意**再装、用完汇报 🧩/🔌、效率准则）+ ②当前能力清单（已装技能 name+desc 真实扫描、已配 MCP 连接器）。动态工具四个（createEmptyThread dynamicTools）：`skill_search`（市场搜索+安装状态标注）、`skill_install`（走新 IPC `skills:market-install-light`：**不重启引擎**——重启会杀正在跑的回合；forceReload 重扫，下一回合即可用）、`connector_search`（模板+已配状态）、`connector_install`（复用 connectors:save；描述里写明必须先 agent_ask）。验收项 `skill-discipline`（5 断言：区间存在/守则关键词/安全条款/清单对账）。
- **内置音色预设（09-13 二次换源：开源项目官方成对样本）**：`resources/voice-presets/`（参考 wav 16-bit PCM 单声道 + presets.json，随包 extraResources `voice-presets/`）。当前 3 个预设，音源全部来自 GitHub 热门开源 TTS 项目的**官方示例**（wav 与转写成对、可直接随包分发）：温柔女声·晓晨（CosyVoice `asset/zero_shot_prompt.wav` +「希望你以后能够做的比我还好呦。」）、沉稳男声·阿远（FireRedTTS2 `chat_prompt/zh/S1.flac` 官方转写，已转 PCM16）、磁性英文男声·Nature（F5-TTS `basic_ref_en.wav` + "Some call me nature, others call me mother nature."）。性别标签用基频（F0）实测判定（245/117/115Hz），不是猜的。**旧预设 taiwan-female / jarvis-butler 已下线**：presets.json 移除 + wav 删除 + main.ts 启动时清理用户档案里的同名克隆档案。铁律不变：**预设必须 wav+精确参考文本成对**（ZipVoice zeroshot 文本对不上音质劣化），preflight【4h】守卫（下线预设不得回归/成对完整/试听 worker 缓存/播放反馈）。IPC：`voice:preset-list` / `voice:preset-apply`（幂等：同名档案已存在直接复用）→ createProfile → 选用写 `tts.profileId`。入口在 设置→语音通话→我的音色 卡片（需先装音色克隆模型）。**顺带修了 mergeSettings 吞 profileId 的真 bug**（显式字段映射吞新字段同款）：此前选用克隆音色后设置不持久、通话一直用内置音色（试听因显式传 id 才正常）——voice-presets 验收项抓到。
- **内置付费订阅系统（09-12，中转站 sub2api 套餐的应用内闭环）**：中转站页新增**置顶订阅长条卡**（`.relay-sub-banner`，六态：guest 未登录 / empty 无订阅 / active 生效中 / expiring ≤3 天琥珀 / expired 红 / watching 等待支付）+ **套餐市场二级弹窗**（`.relay-plans-modal`，`GET /api/v1/payment/plans`，for_sale 才上架；价格/划线价/倍率/有效期/features 折叠）+ 登录弹窗升级**登录/注册双 tab**（`.relay-auth-tabs`）。
  **链路协议（pptoken 实测 + Wei-Shaw/sub2api 源码实证）**：① `POST /api/v1/auth/register {email,password,aff_code}`（`relay:register` IPC）——pptoken 无验证码/邮箱验证（RegisterRequest 的 turnstile/verify_code 是站点可选开关），注册成功同凭据 login 落多账号库＝真·自动登录；站点若开验证码，报错原文含 captcha/verify → 渲染层降级 `openExternal` 站点 `/register?aff=` 页兜底。② 付款 = 主进程 `relay:open-purchase` 开**独立 BrowserWindow** 加载 `{站点}/purchase`，`did-finish-load` 后向站点 localStorage 注入 `auth_token`/`refresh_token`/`token_expires_at`（键名来自 sub2api 前端 auth store）再 reload——打开即登录态；**loadURL 不阻塞 IPC**（收银台加载慢/失败只记日志，轮询照常，用户也可在官网付款）。③ 支付完成判定 = 渲染层每 20s 轮询 `subscriptions/summary`（10 分钟窗口，可「我已完成支付」手动核验），出现「新 group_id 或 expires_at 变化」→ 复用/新建该分组 key（`resolveRelayTarget` 幂等，防重复建 key）→ 走既有 `relayActivate` 全链（探测→saveCustomModel→供应商生效，全局互斥其他让位）。④ 供应商 id 恒为 `relay-<host>` 只换 key——会话模型作用域/旧会话迁移/互斥全部零改动兼容。**教训**：断言「激活完成」不能拿 banner 状态当信号（verifyPayment 先 setOverview 再跑激活，banner 提前变 active）——以 `relay-active-v1` 落库 mode/groupId 为权威。回归：`scripts/e2e/scenarios/relay-subscription.mjs`（17 断言，场景进程内起 **mock sub2api 网关**：register/login/summary/keys/payment-plans/purchase 页/v1/models + `__test/mark-paid` 模拟到账）。
    **OpenAI 导入账号文件直接登录（09-12，复刻 sub2api account_codex_import 格式面）**：OpenAI 订阅页「导入账号文件」卡片（多选文件，DataTransfer 读文本）→ 新 IPC `openai:import-file`。认四种形态（可混用：JSON 数组/NDJSON/每行一条）：裸 accessToken 行、Codex CLI auth.json（tokens.access_token/refresh_token/id_token）、扁平 token JSON（驼峰也认）、以上任意数组。身份从 JWT `https://api.openai.com/auth` claims 解（email/chatgpt_account_id/plan_type/订阅期），与 capture-login 同一 vault、按 identity 去重（重导=刷新 tokens）。**导入即登录**：首个 loginable（带 id_token）条目自动 accountSwitch（写 auth.json+重启引擎）+ activateOfficialProvider（启用订阅供应商）；裸 token 无 id_token 只入 vault 存档、不作切换目标（构不成引擎认得的登录态）。**停用当前生效 OpenAI 账号 = 全套退出**（与 relay:toggle-account 对称）：auth.json 置空 + openai-official 条目停用 + custom-model.json 清空 + 重启；只清 auth.json 会留下「生效配置悬空在无凭据供应商上 + 互斥把其他供应商启用按钮卡死」双坑（已修）。页面停用后回调 onRefreshActive 刷新 App 的 customModel 状态解锁互斥。回归：`scripts/e2e/scenarios/openai-import.mjs`（14 断言：四形态混导/JWT claims 解析/导入即生效/停用清理/死锁解除）。
    **供应商互斥与双向联动加强（09-12 二期）**：①`custom-model:set-model`（输入框下拉跨供应商切换）与 `custom-model:select` 此前**没有互斥**——补上 `disableOtherCustomProviders`（save/set-enabled 原本就有），至此四个激活入口（save/set-enabled/set-model/select）全部「启用谁就停用其他」，中转站登录/订阅支付后模型列表里只留本站供应商启用。②反向联动走主进程广播：四个入口在供应商成为当前生效后发 `harness:event {type:"provider-activated", provider}`，渲染层 onEvent 分支发现与 `relay-active-v1` 的 provider 不符 → `writeRelayActive(null)` + toast（余额徽标/置顶订阅卡即时退场，不再残留）。③`relayActivate` 成功尾部补 `refreshActive()`，模型设置页立即反映互斥结果。**e2e 踩坑**：场景里断言 Electron IPC 必须用 `window.codex.listCustomModels()` 等**桥接方法**——`window.codex.request` 是引擎 RPC，引擎不认识会 reject，而 harness.eval 把页面异常变成 `__ERR__:...` 字符串返回（truthy）→ waitFor 假绿；h.check 的 detail 传对象前先 JSON.stringify。
**顺带实锤**：`groups/available` 带 `max_reasoning_effort` + `max_reasoning_effort_over_limit:"downgrade"`——网关分组会强制降思考档位，是「思考等级传最高跑最低」的站方因素（此前只归因到上游模型）。

- **音色档案（我的音色）09-12 新增**：`electron/voice/voice-profiles.ts`（CRUD + wav 编解码 + 重采样），
  TTS worker 新增 `mode: "zipvoice"` 分支（配置照 `.e2e-artifacts/zipvoice-verify.mjs` 里跑通的那份；
  **reference* 必须放进 generationConfig 层**，平铺会报 `reference_sample_rate 0 is invalid`）。
  `voice-service.ts` 的 `ttsWorkerData()` 按 `settings.tts.profileId` 决定用克隆还是内置 vits。
  IPC：`voice:profiles-list/import/record/save/delete/select/preview`。
  流程：导入/录制 → 落草稿 wav → 重采样 16k 交给 `transcribeAudioFile` 自动转写原文 → 用户校对 → 保存 → 选用。
- **⚠️ 显式字段映射会吞掉新字段（09-12 踩）**：`VoiceDevToolsSection.refresh()` 把 IPC 返回重新拼成对象
  （只列了 5 个字段），主进程新增的 `zipvoice` 被丢掉 → 表现「模型装完了状态一直显示未安装」。
  **主进程新增字段时，必须同步检查渲染层有没有这种显式映射**（已在该处加注释警示）。
- **✅ 实时语音六项优化（09-13 第二轮，用户「12345 全部优化」+「引擎要能区分语音消息」；改这块先读这段）**：完整清单与证据见 `docs/AUDIT-VOICE-2026-09-13.md` 顶部表格，要点与**不许回退的约束**：
  ① **打断必须靠世代号，不能只清播放队列**：`VoiceCallFloat` 的 `speechEpochRef`（`stopPlayback`/`final`/`turnDone{aborted}` 三处 +1，`speakDelta`/`flushSpeech` 在 `await voiceSpeak` **前后**都比一次）；主进程 `turn/completed` **必须读 `turn.status`**（`interrupted/failed` → 渲染层不 flush 断句器半句）。TTS 是 await 中的 IPC，只清已入队的 source 管不到「已经在 TTS 线程里生成中」的那句。
  ② **朗读视图是独立一层**（`src/lib/speak-text.mjs`，`.d.mts` 同步）：断句仍吃**原文**（字幕显示原文），进 `voiceSpeak` 前过 `createSpeakFilter()` —— 代码围栏/表格整段丢（各留一句占位），行内清 markdown/URL/邮箱/路径/emoji，数字日期中文化（`GPT-4`/`v2`/`1.2.3` 保持原样，判据是「紧贴字母数字/版本号」）。**过滤器状态跨句**（围栏与句边界不重合），所以它跟断句器一起在 `bumpSpeechEpoch` 里重建。
  ③ **听写预热＝先开麦再加载**：`startCall` 顺序是 `startCapture()` → `voiceStart()` → 同步回灌暂存块 → `liveRef=true`。**不要改回「先加载后开麦」**（开头 1~3 秒直接丢），**也不要用 phase state 当回灌开关**（state 落地晚一帧，那一帧的块会被丢）。`finish` 补静音 = `rule2+0.3`（写死 3 秒是纯等待）；挂断后 ASR/TTS **保活 90s**（`parkIdle`/`takeIdle`，配置指纹一致才复用），卸载模型/退出应用要 `disposeIdleWorkers()`。
  ④ **延迟三处**：`asr.rule2` 默认 0.8（`VOICE_SETTINGS_VERSION=2` + `migrateSettings`：**只改还是旧默认 1.2 的档案**，用户调过的不动 —— 只改默认值对已存在档案无效）；首句阈值 `firstMaxChars=10`；`voice:endpoint-now`（partial 以 `。！？` 收尾 + 连续 500ms 低能量 → 立即提交，**只在未播报时**判）。
  ⑤ **AEC 别再拿错参考做减法**：参考环 30s + **按播放领先量**写入（`pushRef(samples, leadSamples)`；入队即写在队列领先 >2s 时会覆盖未读样本、永久失步）；`createAec` 的 `delay` 由 `setDelay()` 按 `outputLatency‖baseLatency` 校正（`maxDelay` 预分配）；**浏览器自带 AEC 生效时（`track.getSettings().echoCancellation`）默认不启自研 NLMS**（`aec.mode=auto`，两级叠加会注入失真）。**麦克风/回声消除设置必须在 `getUserMedia` 之前读**——它既是「第一次通话设置不生效」的根因，也是这条判断的前提。
  ⑥ **引擎区分语音/打字**：协议里没有来源字段（`TurnStartParams` 全字段查过；`turnTrigger` 只进遥测），所以 `voice-service.ts` 的 `VOICE_MESSAGE_PREFIX="[语音] "` 加在 `submitTurn` 的 `input` 文本上 + `turnTrigger:"voice"`；**排队与 turn/start 共用同一个 `input`**（两条路径都要带）。与 `channel-bot.ts` 的 `[飞书用户 xxx]` 同一手法。副作用：用户消息文本带 4 字符前缀。
  回归：预检【4c】（纯逻辑跑真实现 + 主进程接线静态守卫；**反证清单与逐条实测输出见 `docs/AUDIT-VOICE-2026-09-13.md`**）。AEC 用例**必须用宽带噪声**：正弦下「任意延迟都等价于同频不同相」，256 抽头照样减干净（实测错配也能「压 150dB」）→ 测不出对齐问题。
- **✅ 语音唤醒专项（09-13 用户「唤醒功能好像不太行」；改这块先读 `electron/voice/wake-match.ts` 顶部注释）**：取证结论是**匹配方式错了，不是链路不通** ——
  ① **`text.includes(phrase)` 永远匹配不上**：唤醒复用的是通用流式识别模型，而**「柯」不在它的词表里**（`tokens.txt` 只有 2002 项，是字节级 BPE：有 科/可/客/刻/课，没有 柯）。真机实测「小柯小柯」被识别成 **小咳小壳 / 小颗小颗 / 小哥小哥**，说「小科小科」又被写成「小柯小柯」→ 精确匹配漏唤醒。**修法 = 同音容错**（`electron/voice/wake-match.ts`，同音表由音色模型自带的 `lexicon.txt` 构建，`柯 ㄎ ㄜ ˉ`≈`科 ㄎ ㄜ ˉ`，去声调归一类，20885 字 / 175ms / 缓存一次，零新依赖）。**故意不做**「部分命中/声母容错」：把 哥(ㄍㄜ) 也算作 柯(ㄎㄜ) 会让「小哥」天天误唤醒。
  ② **匹配搬进主进程**（唤醒词、同音表、词表都在这一侧）：渲染层只收 `wake` 事件，`feedWakeAudio` 只回 `{ok, matched}`（旧实现每块回传**整坨累积文本** = O(n²) IPC）。
  ③ **每次 `endpoint` 必须 `reset` 识别流**：`isEndpoint()` 只是查询、不会自动复位（旧实现从不复位 → 文本跨句无限累积，实测三轮变一整坨）；`startWakeListener` 里要 `await create` **预热**（旧实现把 154MB 模型加载拖到第一块音频上，实测整链 6.5s）。
  ④ **常驻监听的配置必须即时生效**：`voice:settings-set` 保存后主进程广播 `{type:"settings"}`，渲染层 effect 依赖 `[phase, wakeCfg.enabled, wakeCfg.phrase]`（旧实现只有 `[phase]` → **在设置页打开开关毫无反应**，这是用户反馈的直接原因之一）；主进程侧唤醒词变了立刻重建匹配器。
  ⑤ **命中后不得用 effect 捕获的 `startCall`**：走 `startCallRef.current()`（与 09-12 快捷键同族 bug：旧闭包的 `threadId` 早已过期 → 命中后报「请先打开一个会话」）。
  ⑥ 背压（忙时攒块合并发、上限 1s）＋启动失败给提示＋新增 `src/voice/wake-state.ts` 广播，设置页唤醒卡片显示「正在聆听 / **最近听到：xxx（未命中）** / 词表提示」—— 通用模型当关键词用，**没有这句诊断用户无从判断该换词还是该改匹配**。
  端到端复验（跑编译产物 `VoiceService` + 本机真模型）：说「小柯小柯」→识别「小咳小壳」→ **命中**；说「小科小科」→「小颗小颗」→ **命中**；说日常话 → 不误唤醒。**这两条在旧实现下全部漏唤醒**。回归：预检【4d】（纯逻辑跑 `dist-electron/voice/wake-match.js` + 6 条接线守卫，逐条反证过）。
- **✅ 唤醒关键词模型（KWS）已内置（09-13，用户「安排一下，内置好」）**：唤醒**优先走专用关键词模型**，识别模型只作回退。
  - 模型：`sherpa-onnx-kws-zipformer-wenetspeech-3.3M`（GitHub release 归档 **31.1MB**，SHA256 `b2f7c89…7f35f`），用 float32 `epoch-12-avg-2` 三件套 —— 3.3M 参数，不是 154MB 识别模型 → 启动 **1.0s**（回退路径 6.5s）、常驻 CPU 低一个量级。
  - 安装：归档型按需（`ensureKws`：多镜像下载 → SHA256 → 随包 Python 解压 → `kwsReady`）；入口在**设置 → 语音通话 → 唤醒卡片**「下载唤醒模型（约 31MB，推荐）」，IPC `voice:kws-install/cancel/status`。**实测直连 GitHub 失败、`ghfast.top` 前缀成功**（55.7s），幂等复调 0ms。
  - 关键词生成：`electron/voice/kws-keywords.ts`（纯逻辑）= **注音（音色词典 lexicon.txt）→ 带声调拼音 → 拆声母/韵母 → 按模型 token 表校验**。模型的 keywords.txt 每行形如 `x iǎo m ǐ x iǎo m ǐ @小米小米`（拼音 token，声调必带）。**判据必须对着模型自带的 8 行 keywords.txt 逐行比对**（预检【4e】，实测 8/8 一致）；踩过的两个坑：① `j/q/x` 后的 ü 要写成 u（军 jūn / 学 xué）；② ㄓ/ㄔ/ㄕ/ㄖ/ㄗ/ㄘ/ㄙ 单独成音节时写 zhi/shi/zi（世 = `sh ì`）—— 少这两条会有整批字生成不出关键词。
  - 效果（真模型）：说「小柯小柯」命中、同音变体「小科小科」也命中（按读音匹配，不再依赖同音兜底）、3 句日常话零误触发、跨关键词不触发；**改唤醒词后自动重建 worker**（keywordsFile 是启动参数），新词命中、旧词不再命中。
  - **KWS 不进 `ALL_VOICE_REPOS`**：它只服务唤醒，没装不该把通话/听写判成「模型未下载完整」；转不出拼音的唤醒词（生僻字）自动回退识别模型并在卡片说明原因。
  - 回归：预检【4e】（生成器对照模型样例 + 6 条接线守卫，逐条反证过）；验收项 `wake-settings`（唤醒卡片状态行 + 同音说明 + 下载入口，7/7）。
- **模型下载提速 + 可取消 + 语音来源标记（09-13，DeepSeek 会话收尾的三项，已提交 `3a73e7b` 等）**：
  - **提速**：候选镜像按「首字节延迟」实测排序后再下（`orderCandidatesByLatency`，`Range: bytes=0-1` 探测），**实测 55.7s → 11.2s**；探测超时 6s → 2s（点下载后不再"几秒没反应"）；连接超时 + 速度下限自动换源（还有备选时才换，避免把自己掐死）。
  - **可取消**：`downloadUrlToFile` / `downloadOnce` 全程接受 `AbortSignal`，取消时**保留 `.part` 断点**并回 `已取消（已下载 xMB，下次点「下载」会接着传）`；续传走 `Range` 206，镜像忽略 Range 返回 200 时从头写（不会写花）。IPC：`voice:kws-install/cancel/status`。
  - **进度不刷爆 IPC**：`downloadOnce` 每 **2MB** 才报一次进度（单流 16~64KB 分片 → 原本可达每秒数百次 IPC + React 更新）。
  - **语音来源标记**：语音发起的消息带 `[语音]` 文本前缀，且 `turn/start` 与排队两条路径都带 `turnTrigger=voice`，引擎侧可区分「语音说的」与「手打的」。回归：预检【4c】⑥ +【4f】（下载可取消/换源提速）。
  - 内置专家技能市场（09-13）：cheat-on-content 与 ppt-master 随包静态分发在 resources/expert-skills/（含 .claude-plugin/marketplace.json 清单），main.ts 启动幂等注册 [marketplaces.expert-skills]（source_type=local，零拷贝——技能原位发现，引擎 plugin/list 直接扫描；不要改回运行时拷贝方案，1.3 万文件体量下有中断/阻塞/启动拖慢三连问题）。内置单人专家：知微（zhiwei-content-oracle，cheat-on-content）与呈象（chengxiang-ppt-master，ppt-master），expert-teams.ts buildXxxExpertTeam + main.ts 启动 ensure（删除后自动回来）；expertIconOf 按职业映射图标，点击专家卡直达单人会话（teams:member-session）。
  - 洞明 · 代码审查专家（09-15，纯角色 + 自带技能包闭环）：第 3 位内置单人专家 `dongming-code-review`（App.tsx EXPERT_CATEGORY_DEFS 归「专项专家」）。**① 技能包体** `resources/expert-skills/dongming-code-review/`（57 文件 / 362KB，随 `.claude-plugin/marketplace.json` 静态分发）＝ SKILL.md 总协议（六步闭环/字段/严重度/输出模板）+ `references/{rule-map.md 路径→规则路由表, rules/×52 语言级规则, false-positive-filter.md 去误报协议, review-flow.md 分组与定位修复, ATTRIBUTION.md}`；方法论、规则集与提示词结构源自 alibaba/open-code-review（Apache-2.0）。**② 闭环不依赖「用户装过技能」**：实测引擎的本地市场注册只让技能「可被发现」，`codex-home/plugins/cache` 下并没有 expert-skills 条目 → 专家读不到自己的技能包；故 `buildDongmingExpertTeam(skillsRoot)` 由 `main.ts:297` 传入 `expertSkillsSourceDir()`（builtin-skills.ts 导出；开发版=项目 resources/，打包版=process.resourcesPath），把**技能包绝对路径**拼进 systemPrompt，专家用文件工具直接读规则集。**③ 改名留痕**：临时 id `mingjian-code-review`「明鉴」→「洞明」，main.ts 有一次性清理（LEGACY_SOLO_TEAM_IDS）防孤儿卡。回归：一次性脚本 9 断言（技能包结构/无 BOM+frontmatter/marketplace 注册/提示词含绝对路径/专家会话 rollout 命中「默认放行」与 52 份规则）。**④ 技能包路径自愈（09-15 补，修「安装位置一变就静默失效」）**：内置专家 ensure 原本是「按 teamId 存在即不更新」，而洞明提示词里写着技能包**绝对路径** —— 安装位置一变（开发版 ↔ 打包版、项目目录改名/搬家）存档里那条旧路径就失效，**而专家读不到技能包时不报错、静默降级**（表现为「洞明突然不读规则集了」）。现由 `syncSkillsPathInTeam(stored, expected)`（electron/expert-teams.ts，配 `skillsPathBlock` / `readSkillsPath` / `syncSkillsPath` 三个纯函数）处理：已有路径行**只换那一段**（其余逐字保留）、缺路径行则补回兜底段、路径没变返回 null **不写盘**、teamId 不匹配不动手；`main.ts:314` 的 ensure 接入。**守卫**：预检新增 5 条断言，用 `dist-electron/expert-teams.js`（编译产物、无副作用，实测可 require）跑**真行为**断言 —— 本项目首次让离线预检能断言主进程 TS 逻辑，此模式可复用（`check` 本身就是 build 之后跑，产物必然新鲜）。回归：一次性脚本 7 断言（伪造旧安装位置 → 启动自愈 / 其余内容逐字保留 / 其它专家未动 / 路径没变不写盘），已当场反证（摘掉同步 → 5/7 红）。
  - 专家中心独立页 + 全员笔名（09-13 晚，替代上一条的 hub 铺卡形态）：「智能体团队」hub 改三入口卡（专家中心/子智能体/专家团），专家卡全部挪进独立 `expert-center` 设置页，按 `EXPERT_CATEGORY_DEFS`（App.tsx，7 组：研发交付/投资交易/内容创作/数据分析/市场增长/产品设计/专项专家）分组陈列，自定义团队落「更多专家」；卡片=笔名+主理人徽标+职业（高亮）+一句话职责。30 位内置专家全量改笔名（承枢/问需/构梁/键客/守关/执舵/观潮/察本/衡值/执缰/文枢/落纸/裁云/调彩/剔瑕/观澜/疏渠/析毫/显影/察势/拔节/执棋/传声/校靶/丈量/执矩/问俗/明断/织流/造境；知微/呈象保留），SOP 与 systemPrompt 内引用同步；**main.ts 启动迁移**按 teamId+memberId 把老存档 expert-teams.json 残留旧名就地同步（只动 name，不碰启用态与自定义团队）。回归：accept --only zhiwei-expert（9 断言，含专家中心页标题/分组数）。
  - **专家团运行时改造（09-14，修四个实测缺陷 + 成员可视化）**：① **并行阶段** `team_phase_invoke(tasks)`（`buildTeamPhaseTool`，与 `team_member_invoke` 一起挂 dynamicTools）——SOP 标「并行」的阶段一次提交整组成员，渲染层 `invokeTeamPhase` 用 `Promise.all` 并发跑 `teams:invoke-member`。**⛔ 只改提示词让模型「一个回合发多个调用」无效**（实测照样逐个发、退化串行），并行必须由宿主工具保证；实测 3 名成员时间窗重叠 54s，整轮 ≈ 最慢者。② **成员线程复用** `(teamId|memberId) → threadId`（`team-threads.json`）+ `thread/resume`——同一成员多次委托沿用同一线程（有跨委托记忆）。③ **成员线程命名** `团名·角色`（`thread/name/set`）——不设名时引擎拿首条用户消息（角色提示词全文）当侧栏标题。④ 修掉成员提示词里「通过 SendMessage 回传」的死指令（成员线程没挂 dynamicTools，真实回传路径 = 宿主等 turn 结束抽文本当工具返回值）。**新增 `electron/team-runs.ts`**：委托记录落盘 `<userData>/team-runs/<leadThreadId>.json` + threadId→teamId 映射落盘（**popout 窗口没有 teamThreadMapRef，只能靠主进程这份**）+ 运行期把成员线程的 `item/agentMessage/delta` 转成 `team-run` 事件广播给所有窗口。**渲染层**：`TeamMemberRail`（消息区右侧 flex 子项，主理人在上成员在下灰线相连，干活亮/空闲灰/完成勾，ResizeObserver 盯 `.timeline-wrap` 宽度 full→compact→hidden 自适应）+ `TeamRunPopup`（开工自动弹、实时流式、结束 2.4s 自动收）+ `TeamMemberHistory`（点头像看历史）；两者经 `useAvatarAnchor` 锚到**对应成员头像**的竖向中心（top 过渡 → 换人时面板平滑滑过去）。回归：一次性脚本 25 断言全绿（含「每成员都有独立线程且回合数≥1」「成员线程标题」「并行重叠」「窄窗口收起」「弹窗锚定偏差 0px」），锚定断言已反证（恒返回 null → 弹窗压回头像轨，⑪quater 红）。
  - **发送即上屏（09-14 用户反馈「消息发出去要等一会才出现」）**：乐观气泡原先排在两段记忆 IPC（`readMemoryContext` + `recallMemory` 串行 await）之后。现在 `send()` 里在引用解析完、记忆还没开始前就 arm（fastArm：非专家/导入首条消息），**只 arm 一次、之后不改 content**——记忆前缀不参与可见正文（`userDisplayText` 剥掉），所以不带记忆的内容与真实消息的可见文本完全一致，`userMessageMatchesInput` 去重不受影响。输入框清空/引用/上下文同步提前。实测点击→气泡上屏 **8~13ms**。两个反例教训：① 钉顶旗标（`anchorTopRef` 等）必须与 `setOptimisticInput` **同一同步块**置位，中间插 await（React 提交渲染）会让钉顶 layoutEffect 空跑一帧 → 不钉顶（gap=594）；② 两次 setState（先原始后替换）会让钉顶/跟随在中间态复核 → 视口拉扯（bigReversals=5）。专家/导入首条消息依赖记忆段，走慢路径（低频）。入场动画 `#chat-anchor` 只做 opacity 不做 transform（它是钉顶量几何的节点）。回归：一次性脚本 7 断言（8ms/内容一致/输入框清空/动画/不重不漏/rollout 内容完整）+ accept `send-anchor` + `reasoning-follow` 全绿；`__adbg` 新增 `send-memory{ms}` 打点（记忆已不在关键路径，若用户仍觉慢可用它定位）。
- **Bot Channel 二次加固：授权码配对（09-13，紧随手机远控）**：机器人聊天的**首次使用**不再"发消息即执行"。新流程 = 在聊天里给机器人**发送电脑端显示的 6 位授权码**（与「手机远控」同一个码，5 分钟有效、连错 5 次冷却 10 分钟）→ 挂起等电脑端在「手机远控」面板点**允许/拒绝**（请求到达自动弹面板 + toast；2 分钟超时）→ 批准后该聊天写入已批准表（`userData/bot-pairing.json`）并持久化，之后消息正常执行；面板可「移除」撤销。未批准的聊天发普通消息只会收到配对引导（消息不会到达引擎）。**覆盖全部 5 个渠道入口**：微信（`handleWeixinMessage`）、Telegram、飞书/钉钉/QQ（`handleChannelMessage`）；钉钉被动回复过期时引导文案仍会发（sessionWebhook 90 分钟内）。实现：`electron/bot-pairing.ts`（纯逻辑 + 注入持久化，跑编译产物可直接断言）+ main.ts IPC（`bot:pair-state/approve/deny/revoke`）+ 事件 `bot:pair-request`；审批卡与手机远控共用（rid 以 `bp-` 开头分流）。回归：预检【4g】7 断言（引导/错码不进队列/对码挂起/审批前拦截/批准放行/冷却锁定/撤销重拦，逐条反证过）。
- **实时语音三修（09-12 用户实测反馈；其中 ② `firstMaxChars=18` 已被 09-13 的 10 取代）**：① 回声门控 `createEchoGate` 起播首块不再直接当回声地板（旧实现地板≈0 → 下一秒必然超阈 → **自己打断自己的播报**，用户原话「我没说话它也断」）：新增 `seedBlocks=8` 学习期、`minFloor=0.004` 绝对地板、`holdBlocks=6` 连续超阈去抖。② 断句 `createSentenceChunker` 新增 `firstMaxChars`——模型开头几十字常无标点，旧阈值 `maxChars=60` 会憋到很晚才出声（用户「语音跟不上正文」）。③ 字幕浮窗 `.voice-stage` 由「composer 上沿 absolute + 半透明毛玻璃」改为「position:fixed 顶部 84px 居中 + var(--bg) 实心白底 + max-height」，脱离输入区文档流（顺带消除运行中的上下文跳动）。preflight 新增 3 条断言，**已逐条反证会红**。
- **崩溃取证 + 渲染进程自愈（09-12）**：`app.on("render-process-gone")` 在非 e2e 模式也落盘 `userData/voice-crash.log`（reason/exitCode）并**自动 reload**。旧行为：渲染进程一死 → 窗口关闭 → `window-all-closed` → `app.quit()`，用户看到「闪退」且零证据。另接 `process.on("uncaughtException"/"unhandledRejection")` 落盘。**注：ASR/TTS 原生推理已用独立探针压测 4 分钟（`.e2e-artifacts/voice-crash-probe.mjs`，连续 feed+speak，RSS 稳定 530MB、干净退出）→ ONNX 路径不是闪退元凶**，别再从这里查。
- **v0.0.14 发版补漏（09-13，两条都是「静默缺功能」）**：发版前**逐项跑一遍 `package.json` 的 `build.extraResources`，逐个 `fs.existsSync` 点名**——electron-builder 对缺失源静默跳过，不报错、不告警，装出来的应用缺功能是用户来投诉才发现的。本次实测补掉两处：① **Windows 缺 `resources/tools/pw-browsers`（Playwright Chromium 内核 701MB）与 `cloak-cache`（CloakBrowser 反检测内核 536MB）** —— v0.0.13 装出来「桌面/浏览器自动化 + 浏览器内核」全线回落在线下载再 404；两者已加进 extraResources（装包 973MB，压缩后）。② **缺 `resources/tools/ponytail-plugin`**（写代码模式插件，会话钩子 + 6 个技能，main.ts `ensurePonytailPlugin` 依赖）—— 源目录本机根本不存在；补法 `curl -L https://github.com/DietrichGebert/ponytail/archive/refs/tags/v4.9.0.tar.gz` + `tar -xzf … --strip-components=1`。`scripts/before-pack.cjs` 现已对它硬校验（缺 `plugin.yaml`/`skills` 即中止打包，逃生阀 `AUTOMATION_ZIP_OPTIONAL=1`）。
- **mac 包的同类坑（09-13 v0.0.14）**：mac 配置 `extraResources: []` + `build/copy-mac-tools.cjs` 只 copy 了 `resources/tools` → **`resources/expert-skills`（知微/呈象技能包，含 ppt-master）与 `resources/voice-presets`（内置音色）根本没进 mac 包**（验包时 zip 里条目数为 0）。copy-mac-tools 现已补拷这两个目录并在缺源时中止打包。**验收 mac 包要按 zip 内条目数点名**（`Contents/Resources/expert-skills/`、`voice-presets/`、`tools/pw-browsers/`、`tools/ponytail-plugin/`、`tools/cloak-cache/`），不能只看产物存在。
- **会话切换丝滑化（09-14，学 WorkBuddy，详见 docs/2026-09-14-*.md）**：① **按会话事件裁剪真的启用**——`filterForRenderer`（main.ts）从 09-12 的「只记账放行」改为命中即 `return null`；安全兜底四件套：`rendererActiveByWindow`（**每窗口分别记**，修掉弹窗与主窗共用全局变量互相覆盖的隐患）、30s 新鲜度失效即放行、`popoutThreadIds` 锁定会话强制放行、广播前 `if (forwarded)` 判空；逃生阀 `HARNESS_EVENT_FILTER=off`（不改代码回退），`perfCounters()` 暴露 `eventFilterEnabled` 供验收区分「真裁了」与「碰巧没事件」。② **大 diff 行级虚拟化** `VirtualDiffLines`（只挂可视区 ± overscan）：仅当 `language==="diff" && !revealing && !settings.wrap && 行数>400` 时启用（折行/追字场景行高不固定，不虚拟化）；行高 20px 与 `.virtual-diff-line` **必须严格一致**（预检【12】守卫），DOM 里只有可视行 → Ctrl+F/全选复制拿不到屏幕外行。③ **窗口与阅读位置记忆**：命中缓存的切换**保留**已展开的渲染窗口（原先无条件重置成 TURN_WINDOW，长会话切回会缩水），离开时记「距底偏移」、切回还原（贴底不记）；两张记忆表都有 8 条 LRU（`touchTurnWindow`）。④ **冷加载骨架**：切换遮罩里先用列表的名称/预览画出目标会话形态。⑤ 切换耗时诊断 `__adbg` 补 `mode(cached/fresh)` 并新增 `window.__switchPerfStats()`（分位数，按组）——**实测：cached P50 20ms/P95 182ms，fresh P50 206ms/P95 623ms**（accept switch-speed）。⑥ **未做**：空闲预取（`resume` 带会话级作用域/动态工具副作用，需单独验证）、流式 DOM 直写（delta 早已 rAF 合帧，收益边际）。回归：accept `switch-speed`（9 断言，含分组与样本数防空断言）+ `switch-running`（20 断言，验证裁剪没打断流式）+ 预检【12】10 条静态守卫。
- **开发工具下载源选择（09-20 用户「下载太慢了，所有工具下载都加下载源选择」）**：`app-settings.downloadSource`（`auto`默认 / `mirror` / `ghproxy` / `ghfast` / `direct` / `proxy`），「开发工具」页顶部下拉可切，**runtime:install 每次现读，下一次下载立即生效（无需重启）**。三条通道全部认源：① 工具链 `install-runtimes.cjs`——主进程经 **`DOWNLOAD_SOURCE` 环境变量**传入（⛔ 不能走 argv：脚本把裸词参数当工具 id），脚本按源组装通道：auto=镜像→(代理)→直连→gh-proxy（与旧行为逐字节一致）；mirror=镜像→直连；ghproxy/ghfast=对应前缀打头→直连；direct=只直连；proxy=代理→直连（PROXY 环境变量没配时=直连）；② npm 包（CloakBrowser）——direct 只走官方 registry，其余镜像优先+官方回落（gh 前缀对 npm registry 无从生效）；③ 浏览器内核（Playwright/Cloak）——direct 只走官方，其余镜像优先+官方回落（Cloak 的镜像本身就是 ghfast 前缀；gh 加速/代理对内核 CDN 无从生效，按 auto 处理，UI 提示里写明）。既有守卫同步重锚（内核双轮/npm registry/工具链通道序三条旧行为断言改为锚新实现，语义不变）。预检【工具下载源】3 条守卫。语音模型下载（VoiceDevToolsSection）不在此列——它本来就只走 npmmirror。
- **⛔ 按会话事件过滤的两条不变量（09-20 修「两个会话窗口一起跑，正在看的会话只显示正在回复、过程不出内容」）**：用户截图 + rollout 实证（引擎 49 秒里稳定产出工具事件、20:24:34 才 turn_aborted，而前端一直没渲染，停止后走 resume 才一次性补齐）。根因在**主进程 `filterForRenderer` 的按会话裁剪**：渲染层只在**会话 id 变化时**上报「我在看哪个会话」（`codex:set-active-thread`），而主进程只信 **30s 内**（`ACTIVE_THREAD_FRESH_MS`）的上报——停留超 30s 就被判成「不知道这个窗口在看什么」，可它**照样返回集合** ⇒ 过期窗口正在看的会话被当成"没人看"，其 item/delta 全被裁掉（`RENDERER_CROSS_SESSION_METHODS` 白名单里没有它们），只剩 `turn/started` 点亮运行态 ⇒ **一直转圈、内容不出来**。两条不变量：① `watchedThreadIds()` **只要存在任何过期上报就整体返回 null（全量放行）** —— 宁可多发不可漏发；② 白名单必须含 `turn/aborted|failed|interrupted` 与 `error`（渲染层的跨会话区用它们熄灭后台会话运行态 / 点绿点 / 排 429 重试，漏发等于后台会话状态永久卡住）。配套：渲染层上报加 **15s 心跳 + 窗口聚焦补报**（切窗口不改会话 id，新鲜度也得刷新）。⚠️ 取舍：窗口被最小化时 Chromium 会节流定时器（≥1min），心跳会过期 → 走放行分支，**失去 09-12 的裁剪收益但保证正确**（正确性优先）。预检【多窗口事件过滤】3 条守卫。
- **输入框草稿按会话持久化 + 会话通知前置会话名（09-19，用户「切会话/关应用不能丢输入；在别的会话不知道通知是哪个会话的」）**：① 草稿 = `src/lib/composer-draft.mjs`（每个会话一个 localStorage 键 `composer-draft-<id>`，无会话=欢迎页 `composer-draft-new`，100KB 上限，空内容=删键）；保存点三层：**onPromptChange 即时落盘**（闭包里的 thread 是当前会话，键一定对）+ **防抖兜底**（覆盖语音听写/增强回填等程序化改 prompt，400ms）+ **beforeunload**（关应用不丢）；切会话/新建在 `openThread`/`startNewThread` 里先存旧键再 `setPrompt(loadDraft(新键))`。⛔ **时序坑**：恢复动作发生在 thread 状态切换之前，防抖此刻写会落到旧会话键 → `draftJustRestoredRef` 标记跳过恢复那一次；但标记**不能在恢复分支里消费后永久滞留**（恢复值==当前值时 effect 不触发、标记滞留，下一次程序化改 prompt 被误跳过）→ `onPromptChange` 里也消费标记。② 通知前缀 = `showToast(title, text, threadId?)` 带第三参 + `threadNameOf()`（`cleanThreadDisplayTitle` 展示名，查不到兜底「会话」——后台/归档会话可能不在侧栏列表）；`scopedNotice(text, threadId)` 给裸 error 用；已接线调用点：限流重试全家（等待槽位/已发出/仍被限流/换档/放弃/停止）、发送失败、换档重发失败、多次被截断、创建分支、绑定更新。预检【草稿+前缀】6 条守卫（⛔ 前缀守卫必须锚 showToast 专属行 `const prefix = name ? \`【${name}】\` : "";` —— 裸锚 `【${name}】` 会被 scopedNotice 顶成假绿）。
- **刻度尺悬停滚轮：声音反馈 + 滚轮闭包 stale 修复（09-19，用户「加一个声音反馈，选最贴合的」）**：音效选型 = **WebAudio 合成的滚轮棘轮咔哒**（`src/lib/wheel-tick.mjs`，无音频资产零依赖）：上滑（看更早）音调略高 2300Hz、下滑 1700Hz、14ms 短衰减、峰值 0.07 刻意压低；⛔ 只在**窗口真的移动**时响——到顶/到底静默是自然的边界反馈；30ms 节流防连滚噪音；任何 AudioContext 异常静默降级（声音绝不拖垮滚轮交互）。**配套修掉 stale closure**：滚轮监听挂载时只绑一次（`wheelBound` 守卫），闭包直读 state 会永远停在首帧值（钳制/容量全用旧值）→ `wheelCtxRef` 每渲染刷新，监听器只读 ref。**「消息少时保持现状」**（用户 09-19 撤回当天的铺满口径）：消息 ≤ 容量仍是固定 14px 槽位居中，超容量才滑窗。预检【14】3 条守卫（next 静默判定 + wheelCtxRef + 音效模块三要素），反证 2/2 成立（摘 playWheelTick / 摘 wheelCtxRef 各自变红）。
- **v0.0.15 发版条目（09-14）**：① **专家团并行调度**：多位专家成员同时执行（成员头像轨 / 工作弹窗 / 历史记录）。② **审批卡紧凑化**：审批请求改到「输入框上一行 + 点开预览」（36px 一行：图标+标题+摘要+允许/拒绝+caret，多条收进 .approval-stack 限高滚动），要用户填信息的两类保持默认展开；窄窗口（≤760px）弹窗自适应。③ 修两处「另一个窗口改了配置」误报（e3515e3，与 thread-runtime 条目配套）。发版：Windows 973MB 站内（dl.ppz123.asia）+ mac 双芯片 GitHub 外链，三平台 mandatory=1 强更新；extraResources 24 项逐项点名、Windows 包 49 项断言验收全过、mac 包按 zip 条目数点名（expert-skills 13257 / voice-presets 5 / 内核与插件齐）。

- **⛔ v0.0.17 已撤包（09-15 用户决定：bug 太多，修完再发正式版）—— 以下仅存档，不要按它发版**：Windows/mac 三个包都已撤，GitHub 上 14 个旧 release 全部删除、`/var/www/codex-harness-releases/data/files/` 已清空，站点当前返回 `no_release`（`releases.json` 0 条）。本地产物 `release-0.0.17/`（4.3GB）与 `release-mac-0.0.17/`（5.7GB）仍在，可随时删。① **历史分页懒加载（极致版）**：打开会话只渲染最近 **5 回合**（≈5 个用户消息），**网络侧也只取这一页**；用户往上滚到近顶才自动续载下一页（每页 5 个用户消息），**消息刻度尺同步补齐并自适应压缩**（刻度多了自动变短变密，滚轮一次滑一页）；**滚回最新（贴底）自动收回**展开的历史（只收渲染窗口、**不动 `thread.turns`**，再滚上去先本地展开不重新请求）；**没滚过就不加载**（打开/切换会话的程序化滚动不误触发，判据只认真实用户滚动）。② **统一内置通道（切供应商零迁移）**：新建会话一律绑 `harness`（永远指向当前生效供应商），换供应商只需重写 config 段 + 重启引擎，**新旧会话直接可用**；旧会话（rollout 里绑着老 id）打开时**静默**对齐（修掉「点一次会话提醒一次」），未覆盖的 id 由别名段兜底。③ **修「正在载入更早的消息…」常驻**：续载请求加 8s 超时 + 提示兜底计时 + 切会话清除（此前引擎慢/挂起时 `finally` 不执行 → 提示与防重入锁一起永久卡住）。④ **供应商开关点即跟随**：点「启用/停用」开关时右侧详情同步切到该供应商（原开关只 `stopPropagation`，把行点击的切详情一并拦掉了）。⑤ 其他：用户消息点击即上屏（原先要等两段记忆 IPC）、`wire_api=chat` 残留档案**读入即归一化**、团队主会话归档/删除时级联处理同簇成员会话。**⛔ 版本号必须三处同改**（`package.json` + `package-lock.json` 两处 + `electron/codex-server.ts` 的 `clientInfo.version`）——0.0.16 只改了第一处，另两处停在 0.0.15，本轮补齐。**发版辅助脚本（09-15 新增，下次发版直接复用）**：`scripts/gh-api.cjs`（GitHub API 封装，自动从 `remote.origin.url` 取 token、走本机代理 7897、带重试与同步等待）、`scripts/gh-release.cjs create|list|delete-all`（建/列/删 release，`delete-all` 用于清场）、`scripts/gh-upload.cjs`（传三个包到 release，直连优先、失败改走代理，进度写 `.e2e-artifacts/gh-upload.log`）、`scripts/fetch-mac.cjs`（下载 CI artifact + 解包 + **按版本号精确匹配**内层 zip + 算 sha256，写 `release-mac-<ver>/manifest.json`）。
- **打包钩子 `build.beforePack`（09-12）**：`scripts/before-pack.cjs` 打包前确保 `resources/tools/automation-tools.zip` 存在（有 npm-global/node_modules 时按 mtime 决定是否重建，失败即**中止打包**）。根因：`resources/tools/*` 全在 .gitignore，zip 必须现造，而 electron-builder 对**缺失的 extraResources 静默跳过** → 装出来的应用点「桌面与浏览器自动化」必报缺 zip。mac 不走此路（mac 配置 extraResources 为空 + `build/copy-mac-tools.cjs` 直接把 npm-global 铺进 Resources/tools，所以 mac 开箱即用）。
- **模型下载健壮性（09-12）**：`model-store` 的 `downloadUrlToFile` 重写为「多候选地址（直连 + `https://ghfast.top/` / `https://gh-proxy.com/` 前缀镜像，实测 206 支持 Range）× 每个地址两次（第二次 Range 续传）」，新增 45 秒无数据卡死判失败，网络类失败**保留断点**（旧实现失败即删残file → 大文件在抖动网络下几乎必失败：实测 54MB 声码器失败而 109MB 主包侥幸成功）。
- **音色克隆（ZipVoice）按需安装（09-12）**：manifest 新增归档型资源 ZIPVOICE_ARCHIVE（GitHub release tar.bz2 109MB + vocos_24khz.onnx 54MB，均带 SHA256）；`ensureZipvoice`（model-store）跑「整包下载→SHA256→解压→声码器」；IPC `voice:zipvoice-install` / `voice:zipvoice-cancel`，`voice:models-status` 带 `zipvoice` 字段；开发工具页独立卡片（`VoiceDevToolsSection`）。**解压必须用随包 Python**：`resources/tools/python/python.exe -c "import sys, tarfile; tarfile.open(sys.argv[1]).extractall(sys.argv[2])" <归档> <目标>`——实测 Windows 自带 bsdtar 报 Can't initialize filter / unable to run program "bzip2 -d"（不内置 bz2），随包 7z 26.02 对该包报 Cannot open as archive；tar/7z 仅作回落。就绪判定 `zipvoiceReady`（关键文件 + 声码器）。
- **设置页内容就绪兜底（09-12）**：`settingsContentReady` 原只靠双 requestAnimationFrame，软件渲染 / 窗口后台时 rAF 被抑制 → 设置页永远停在「正在载入…」（e2e 隔离实例实测复现，也让开发工具页的语音模型卡片「找不到」）；已加 120ms 定时器与 rAF 竞争兜底。
- **渠道语音消息转写（09-12 接力）**：飞书 onAudio 事件（message_type==="audio"）→ `im.messageResources.get` 下载 opus → ffmpeg 归一 16k mono wav（`tools/ffmpeg` 或 PATH，未装时明确提示）→ `VoiceService.transcribeAudioFile`（临时 ASR worker，feed+finish，用完即毁，不影响通话）→ 转写文本走 `handleChannelMessage` 原管线。WAV 解析：`pcm16WavToFloat32`（块级遍历 data 块）。微信渠道未接（silk 编码需专用解码器，本期不做）。
- **首次对话身份引导（09-12 新增）**：未完成引导（personalization.json `onboarded!==true`）时，宿主给新会话的 `thread/start` 带 `developerInstructions`（热情欢迎 + 邀请给 Codex 取名字 + 询问称呼/使用场景）并注册动态工具 `identity_onboard`（assistantName/userName/about）。工具落盘走 `personalization:save-identity`（写 assistantName/userContext/onboarded=true，重建 AGENTS.md，**不重启引擎**——AGENTS.md 每新会话由引擎读取，天然「新会话生效、已配置不再引导」）。协议考证：`ThreadStartParams.developerInstructions`（camelCase，schema 实证）。`writePersonalization` 已改 merge 语义（partial 保存不清其它字段）。

- **长会话窗口化 + 增量加载（09-12，ZCode 式会话切换）**：逆向 ZCode app.asar 得出其「切换秒开」三要素——窗口级 host 子进程常驻、snapshot+deltas 订阅增量、**会话历史按行分页只挂最新一屏**。宿主侧落地第三条（引擎侧多 thread 并行本就同构）：
  ① `resumeThreadLight`（excludeTurns:true + desc 一页）首屏只取引擎单页上限 100 回合，`TURN_WINDOW=40` 只挂最近 40 回合——打开成本与历史长度无关。
  ② `loadEarlierTurns` 增量化：内存还有未渲染的 → 只扩 `turnWindow[id]` 窗口（零网络）；内存耗尽且有游标 → `thread/turns/list` 按 cursor 拉**一页**（引擎单页上限 100，请求 200 会被静默截到 100）拼到最前，并按 scrollHeight 增量补偿 scrollTop（双 rAF 等提交）防止视口跳动。
  ③ `.timeline` 滚动近顶（<480px）经 `onTimelineScroll` 自动续载（`loadingEarlierRef` 防重入、`switchJumpRef` 切换期间跳过）；「显示更早」按钮同一入口；刻度尺跳转 `jumpToTurnInWindow` 先扩窗到覆盖目标回合再 scrollIntoView（否则元素未挂载、跳转静默失败）。
  ④ `openThread` 重置窗口为 40：切回任何会话首屏成本恒定（游标留在 `turnsCursorRef`，向上滚动按需续拉）。原 `earlyTurnExpanded` 布尔（一键全展开，最多 4000 回合同时挂载）已删除。
  **e2e 种子技术（`turn-window` 场景）**：向隔离 profile 写**合成 rollout** 造 260 回合长会话——两个必须：session_meta 要 `history_mode:"paginated"`（缺了引擎不走分页索引、items 重建为空）；文件名必须 canonical `rollout-<ISO带T>-<uuid>.jsonl`（缺 T 报 "does not have a canonical rollout filename"）。回合块形状：task_started → turn_context → item_completed(UserMessage content 小写 `text`/AgentMessage content 大写 `Text`) + response_item(user/assistant message) → task_complete，ordinal 全局连续（有洞整个文件解析失败）。harness 新增 `seedProfile` 钩子（run.mjs 转发 `scenario.harnessOpts`），供场景在进程启动前落盘夹具。

- **欢迎页「项目地址」选择（09-12 新增）**：欢迎页输入框左上角 chip（仅空态 `isEmpty` 显示，发送首条消息后消失）。两种模式：①「使用项目地址」= 全局 workspace（与右上角 📁 完全联动，`chooseWorkspace` 同一入口）；②「不使用项目地址」= 主进程 `scratch:create` IPC 每次新建独立临时目录（优先安装目录下 `scratch/`，不可写回落 userData），`thread/start` 的 `cwd` 用该目录（`sandboxPolicy` 同步），会话建立后 scratch 记录清空——下次再选「无项目」新建另一个目录。引擎据此在该会话内的文件操作都落在独立目录，不污染真实项目。

- **config.toml 错位孤儿键自动清理（09-11）**：`preserveUserConfig` 现在会把「落在某个 section 内的 harness 顶层键」（`HARNESS_CONFIG_KEYS`，含新加的 `model_reasoning_effort`）当错位数据丢弃——引擎运行中 append 顶层键时若文件尾正好在某个段落里，键会被 TOML 归进该段（实测 L136 `model_reasoning_effort="medium"` 落进 `[mcp_servers.nuphus]`，引擎不读、纯误导排查）。用户自建段落（projects 等）的其它行不受影响（行为断言 3 条已验）。
- **钩子徽标中文名（09-11）**：消息 footer 小扳手的 hook 列表把引擎原始 `run.name`（形如 `session-start:0C:\Users\...`，事件名+序号+命令路径拼一起）映射成「会话启动钩子 #0」等中文短名展示；配对仍用原始 name，悬停 title 可看原始值。

- **思考等级档案持久化 + 立即生效（09-11 定稿；用户 21:0x 实测「模型等级切换生效了」，勿回退）**：`custom-model:set-effort` 新 IPC——思考档位写进 `custom-model.json`（`models[].effort` + 顶层 `effort`）并同步 `config.toml` 顶层 `model_reasoning_effort`（`restart:false`，不打断回合；config 顶层只作重启后 resume 老会话的兜底默认）。UI 侧 `applyEffort` 写档案、打开会话时「无会话显式记录才落档案档位」（优先级与会话独立模型一致）。**档案归档键必须用 `customModel.model`（当前生效模型），不能用会话级 `selectedModel`**——两者在「会话选了别的模型」时分叉，顶层与 `models[]` 会各写各的。协议考证：`TurnStartParams.effort`（每轮下发）与 `ThreadSettings.effort`（settings/update）字段名都叫 `effort`；**模型自报思考档位不可信**（模型看不到请求参数，rollout `turn_context.effort` 才是实收值）。回归：`scripts/e2e/scenarios/effort-scope.mjs`（UI 切档 → 档案三处落盘 → rollout 取证）。

- **本机离线语音通话（09-11 新增，旁挂，勿侵入既有输入链路）**：右下角悬浮球一键通话，识别与合成都跑本机（`sherpa-onnx-node`，零凭据、零联网）。
  **分工**：渲染层做采集 / 回声消除（NLMS，需要采样对齐的播放参考）/ 回声门控 / 断句 / 播放；主进程做编排（ASR 与 TTS 跑 `worker_threads`，把识别文本交给引擎、把 `item/agentMessage/delta` 转回渲染层）。
  **关键实现约束（踩过）**：
  ① **不能复用 `BotStreamSession`**——它把思考/工具/正文拼成一条文本且 flush 节流 1500ms，喂语音会「1.5 秒吐一坨还念 emoji」；语音必须另写只吃 `item/agentMessage/delta` 的零节流消费者（可复用的只有 `channel-bot` 的 turn 管线与 `turn/interrupt`）。
  ② **ASR/TTS 必须在 `worker_threads` 里跑**，ONNX 推理放主进程会卡死整个应用的 IPC。
  ③ worker 用 `new Worker(源码字符串, { eval: true })` 创建，**不能用文件路径**——打包后代码在 `app.asar` 内，而 Node 的 worker_threads 走 C++ 层读文件、不经过 Electron 对 asar 的补丁。原生模块路径由主进程 `require.resolve` 后经 `workerData` 传入。**另：eval 模式不允许顶层 `return`**。
  ④ 全项目此前**没有任何权限处理**，`getUserMedia` 会被直接拒——已补 `setPermissionRequestHandler`/`setPermissionCheckHandler`（只放行 `media`）；macOS 另走 `systemPreferences.askForMediaAccess`。
  ⑤ 模型放 `%APPDATA%`（不是应用目录），首次使用按需下载（约 270MB，HF / hf-mirror 双镜像 + SHA256 + `.part` 断点续传），**不随包**。
  ⑥ 语音轮的 `effort` 用 `low`（通话优先低延迟；自定义模型档位是 low/medium/high）。
  **验收**：纯逻辑（重采样 / NLMS / 回声门控 / 断句）在 `src/lib/voice-aec.mjs`，预检【4b】有 18 条断言（含「双讲期间地板必须冻结」——去掉冻结会红，已反证）；UI 场景 `voice-call`（22 断言，含**既有输入链路零回归守卫**）。
  **可拆卸**：删掉 `electron/voice/`、`src/voice/`、`src/components/VoiceCallFloat.tsx` 及 `App.tsx` 里那 2 行挂载即可，其余功能零影响。

- **模型选择的作用域：每个会话独立**（09-11，用户两轮反馈——先是「我切换的模型没生效」「思考又是英文」，再是「每个会话独立模型选择为啥也不行」；纯逻辑 `src/lib/model-scope.mjs`，回归场景 `model-scope`）：
  引擎 `thread/resume` **不回带 model**，模型由客户端每轮 `turn/start` 的 `model` 字段下发（rollout 的 `turn_context.model` = **该回合真正跑的模型**、`thread_settings_applied.thread_settings.model` = 会话级设置，两者是唯一权威判据），所以模型必然是会话级状态。
  **返工史（别再走回头路）**：第一版 `openThread` 无条件用会话记录 → 改了全局默认，打开旧会话仍跑老模型；第二版改成「谁后改谁生效」（时间戳）→ 治好了上面，但**改一次全局默认就把所有旧会话的模型冲掉**，与「会话独立」直接冲突。**定稿只有两条规则**：① 打开会话：该会话自己的记录优先，它还没记录（新建/从没选过）才用全局默认；② 改全局默认：写全局（新会话用），**若此刻有会话打开只同步这一个**，其它会话一律不动。落地上给所有「改全局默认」的动作收敛到唯一入口 `applyGlobalModelChoice`（设置页生效模型/一键切中转站/官方订阅/登录导入/重启生效落定/无会话时选模型），`default-model` 全仓库只有这一处写入（预检有守卫断言）。
  **「模型自报」误导案（09-11 第三次反馈「下拉框就是摆设吗」；第四次要求「一次弄干净、必须 100% 同步」）**：用户切了下拉后问模型「你是什么模型」，模型自报旧模型——但 rollout `turn_context.model` 证明引擎已真跑新模型。根因：模型不知道引擎层的模型名，被问时会去读 `custom-model.json` 自查，而顶层 `model` 字段从不跟着下拉更新。**修复（两次加码）**：① `chooseModel` 同供应商分支选完模型后同步档案——现在是 `setProviderModel({ apply:true, restart:false })`：一次写齐 `custom-model.json` 顶层 `model` + `config.toml` 顶层 `model` + catalog 上下文窗口，但**不重启引擎**；② 新增**打开会话对账 effect**：进入任意会话后，若档案（custom-model.json / config.toml）与**该会话**的模型不一致（旧版本遗留、从别处改过），就地写齐（同样 `restart:false`），保证「模型自查」任何时候都不撒谎。**⛔ 09-14 收窄：这条对账从此只在「无会话打开」时才跑**（`if (threadRef.current?.id) return;`）——有会话打开时 `modelId` 是**该会话**的模型，拿它写全局会把别的会话/另一个窗口的「自查」带跑偏（用户实测「模型还是串全局的」次因）。全局档案的更新路径只剩两条：**无会话时选默认**、**跨供应商切换**。**`applyCustomModel(entry, { restart })` 与 `custom-model:set-model` 的 `restart` 参数就是为这两条加的口子**（默认 true = 旧语义：写配置 + 重启引擎，供应商级切换才需要；`restart:false` = 只写配置文件）。教训：**任何模型/用户能读到的「当前 X」档案文件，状态变更时必须同步，否则自查路径会打架**；而「同步 ≠ 重启引擎」，重启会打断在跑回合（实测 ⑦ 全红：回合被杀 + 渲染层 20s 超时）。⑦bis 钉切换后的档案/config.toml 同步，⑦ter 钉打开会话后的对齐。
  **「立刻生效」的验收口径**：在输入框下拉里换模型后，**下一条消息**该轮引擎就得跑新模型。回归在 `model-scope` 第 ⑦bis 步（改下拉 → 真发一条 → 读 rollout 的 `turn_context.model`），别用「重开会话才生效」当验收。**且必须打到真实后端**：只证明「引擎接了 model 参数」不算数（09-11 用户指正「你这个没有拉起来真实后端测试」）——e2e 灌真实配置时**保留 Key 密文并一并复制 `Local State`**（同机同用户可解出），断言 `token_usage_record.response_id` 出现才算「真实网关真的回了包」（⑦/⑦bis 各有断言，实测 output=159/3/47 tokens）；rollout 里出现 `error/stream_error/turn_failed` 立即早停早红（401 = Key 与通道不配套）。
  **启动链健壮性（09-11 实测）**：主进程 boot 是 `app.whenReady().then(async () => { … })`，里面任何一处裸 `await` 抛出 → unhandled rejection → **整条启动链中断、引擎根本不 spawn**，症状是「界面能开、发消息毫无回复」，日志里只有一行 `EPERM`（实测 `memory-mode.json` 写不进去：被安全软件/同步盘占用或磁盘满）。boot 副作用（`applyMemoryMode` / `scheduler.start` / `remote.start`，以及既有的 `channelBot.configure`）一律 try/catch 降级；预检【5】有守卫盯着这三处别退回裸 await。
  **另一个隐藏坑**：`allModels` 兜底 effect 曾在「modelId 不在可用列表」时把回落值**写进 localStorage**（会话记录与全局都写）——供应商列表是异步加载的，加载完成前所有非生效供应商的模型都「不在列表里」，于是用户刚选的模型被默默冲掉。现在该 effect **只改内存、不落盘**。

- **会话作用域下发：模型自报「我是谁」必须读会话级（09-14，用户第 N 次反馈「模型还是串全局的了，为什么」）**：
  **取证**：`rollout-2026-09-14T05-33-57*.jsonl` 里用户跑「权限检查，模型检查，模型 ID 检查，思考等级检查」，助手自报 `deepseek-v4-flash`，而同一份文件的 `turn_context.model` 两轮都是 `glm-5.3-flash` —— **会话级模型一直是生效的**，坏的是「模型读配置自查」这条路径：引擎不会把会话级配置自动写进 prompt，模型能看到的只有全局 `config.toml` 顶层 `model` + `custom-model.json` 顶层 `model`（语义 = 新建会话的默认值）。所以「引擎只收全局那份配置」这个猜测**不成立**（`turn_context.model` 就是反证），要修的是给模型一个**会话级出口**。
  **修法**：`src/lib/session-scope.mjs`（纯函数）+ `session-scope.d.mts`（`allowJs:false`，tsc 要手写声明）——生成「会话 ID / 当前模型（含供应商）/ 思考档位 / 执行权限 / 工作区」+ 一句「全局顶层不代表当前会话」的作用域块，经 `thread/settings/update` 的 `collaborationMode:{ mode:"default", settings:{ model, reasoning_effort, developer_instructions } }` 下发；引擎按 thread 持久在 rollout 的 `thread_settings_applied...collaboration_mode.settings.developer_instructions`，**不写进全局 config.toml**。下发点：`createEmptyThread`（thread/start 的 developerInstructions，开会话后再补发真实 id）、`openThread`（resume 后，必须用**显式解析值**——此刻 React state 还是上一个会话的）、`updateThreadSettings`（切模型/档位）、`pushThreadPermissions`（改权限）；`scopeSigRef` 按 threadId 记签名，未变不重发。
  **两条实证（探针）**：① 线程级 developer_instructions 是**替换**全局基线、不是追加（只发 MARK_A 时基线计数 = 0）→ 必须自己 `composeScopeInstructions(base, block)` 拼，否则全局基线整段丢失；② 透镜确认注入的 developer 消息里 base 与 block 各一份、不随轮次累积。
  **回归**：`accept.mjs` 的 `session-scope`（12 断言：块进会话自己的 developer 指令 / 块中模型 == `turn_context.model` / 基线没被顶掉 / 显式否定全局 / 引擎已持久 / 会话≠档案 / 切模型与重新打开都没改写全局档案）+ 离线预检【4a-2】（14 条纯逻辑断言，含「全局档案对账已加无会话才写守卫」）。
  **断言设计教训（本轮实踩）**：① 全局档案的基准快照必须在「打开会话」**之前**取——泄漏发生在打开/切换那一瞬间，打开之后才快照就恒绿（反证时把守卫摘掉它照样绿）；真正能翻红的是「切模型」与「切走再切回」两步，它们都在快照之后触发。② rollout 里堆着历轮的 developer 消息，必须取**最新**一条（取第一条会拿上一轮的旧作用域块去比当前 `turn_context.model`，②⑥ 假红）。反证流程：守卫改成 `if (false) return;` → **重建** → ⑦⑧ 立刻翻红 → 恢复 + 重建 → 12/12 绿。

- **会话级配置收敛成单一对象（09-14，参考 ZCode 逆向报告；`src/lib/thread-runtime.mjs`）**：
  ZCode 的三件套是**会话状态对象的字段**（切会话＝切状态对象，零对账），我们原来是三套键族 `thread-model-*` / `thread-effort-*` / `thread-permissions-*` 各写各的（实测约 20 处写、15 处读，散在 chooseModel / openThread / applyGlobalModelChoice / archiveSync / 权限切换 / fork / 迁移 / 兜底 effect 等十来处）——「档案与会话记录分叉」「兜底 effect 冲掉刚选的模型」都源于此。现收敛为 `thread-runtime-<id> = { model, effort, sandbox, approval, rev }`：`loadThreadRuntime` / `saveThreadRuntime` 两个入口 + `patchRuntime`（只覆盖非空传入字段，空值不抹掉已有值，`changed=false` 时不落盘），原有六个 helper（load/saveThreadModel / Effort / Permissions）保留签名但全部改为走这个对象，所有调用点自动收敛。
  **旧三键族降级为派生镜像**（`legacyMirror`）：写时镜像（仅给已发布的旧版本/降级读），**读取路径一律不再从旧键取值**；首次读新键缺失时用 `migrateRuntime` 从旧键迁移一次（升级不丢配置）。`rev` 只在真变化时递增，为后续多窗口并发保护留的钩子——**popout 独立窗口与主窗口共享同一份 localStorage，两个窗口同时改同一会话目前仍无并发保护**（ZCode 用 `sessionSetMode { expectedRevision }` 乐观并发；我们的形态更适合「主进程单点落盘 + 变更广播」，尚未实施，属已知遗留）。
  **⛔ 配套铁规**：只有**明确的用户动作**才落盘，effect / 对账逻辑一律只改内存（既有的「旧会话种子烙印」是 09-13 历史决策，时机不动）。
  **回归**：预检【4a-3】14 条纯逻辑断言（迁移优先级 / 空补丁不抹值 / rev / 镜像派生 / 接线守卫「旧键字面量写入归零」）+ `accept.mjs` 的 `thread-runtime` 场景（切模型→切档位→切权限各改一处不冲掉别处、旧键镜像一致、删新键后按旧键迁移重建、**把旧键写成伪造值也不影响取值**）。
  **反证（两条独立的证伪，必须都做）**：F1 去掉迁移回退（`return emptyRuntime()`）→ ⑤ 红；F2 让旧键优先读取 → ⑥ 红（伪造模型浮出来）。**教训**：⑤ 最初写成「重新打开会话触发迁移」，恒假红——`openThread` 有 30 秒秒开快路径会提前 `return`（`recentResumeAtRef`），根本不读 localStorage；触发读取要用**确定的用户动作**（这里用切权限）。⑥ 最初写成「删掉旧键后值不变」，也没鉴别力——那段流程里可能压根没有读取动作；改成「旧键写入伪造值」才可证伪。

- **多窗口并发保护：会话运行时配置改由主进程权威（09-14，`electron/thread-runtime-store.ts`）**：
  风险面：popout 独立窗口与主窗口是**两个渲染进程**，共享同一份 localStorage（所以存储本身一致），但各自 React 状态是旧的、写入是「读-改-写」三步 → 两个窗口改同一会话会互相看不见、丢更新（各自读到 rev=N，各写回 rev=N+1，后写的把前者的字段抹掉）。
  修法（对齐 ZCode 的 revision 思路，但适配我们「单主进程多渲染进程」的形态）：**主进程做权威存放处** `<userData>/thread-runtime.json`——写入天然串行、**字段级合并**（`{ ...current, ...fields }`，两个窗口各改一个字段都不丢）、按 `baseRev !== current.rev` 判冲突（冲突不拒绝写入：用户动作该赢自己那几个字段，只回报 conflict 供界面刷新）、落盘做 120ms 合并、改完 `broadcastHarnessEvent({ type:"thread-runtime" })` 广播给**所有**窗口。渲染层 localStorage 降为**同步读缓存**（大量同步 `loadThread*` 不能改成异步 IPC），主进程值经 `admitThreadRuntime`（组件内唯一收敛点）写回镜像并按需同步 React 状态 + toast；`openThread` 里 `syncThreadRuntimeWithMain`：主进程无记录则播种本地值（迁移），有记录则以主进程为准（**不 await**，切会话是热路径）。IPC：`thread-runtime:get / seed / patch`（preload `getThreadRuntime / seedThreadRuntime / patchThreadRuntime`）。
  **⛔ 一个必须记住的坑**：`syncThreadRuntimeWithMain` 是 fire-and-forget，openThread 后面**不能复用**早先捕获的 `storedModel`（会拿本地旧值把主进程的权威值覆盖回去）——已改为 `loadThreadModel(id) || storedModel || …`。
  **回归**：`accept.mjs` 的 `thread-runtime-multiwin`（11 断言：真 UI 动作落盘主进程 / 跨窗口广播驱动界面 / 过期 rev 报冲突 / 字段级合并不丢更新 / rev 单调）+ 预检【4a-4】7 条接线守卫。
  **两条反证**：F3 摘掉广播 → ② 红（界面不跟随）；F4 把字段级合并改成整对象覆盖 → ④ 红（sandbox 被抹成空）。
  **场景设计教训**：给会话级字段写「测试值」必须用**合法枚举**或**真实存在的模型**（且同供应商，否则 `allModels` 兜底 effect 会回落），否则应用自己会把测试写入纠正掉、把断言带红——先用真 UI 动作走一遍链路，再模拟另一窗口。

- **审批卡改「输入框上一行 + 点开预览」（09-14，用户「审批弹窗有点丑，卡片太大，两个卡片直接占满」）**：
  `RequestCard`（App.tsx ≈5920）原来三个分支各返回一张 `<section className="approval-card">` 大卡（header 42px + 正文 + footer 42px），两条就把输入框上方占满。现在统一成一段结构：`<section className="approval-card compact">` + `header.approval-line`（**36px 一行**：图标 + 标题 + 一句话 `approval-peek` + 允许/拒绝 + caret）+ `{expanded && <div className="approval-detail">}`（命令全文 / reason / cwd / 权限清单 / 表单）；多条由 `.approval-stack`（`max-height: min(232px,38vh)` + `overflow-y:auto`）收纳，条数再多也只滚动、不推挤输入框。
  **⛔ 两个必须记住的点**：① 要用户**填东西**的两类（`item/tool/requestUserInput` / `mcpServer/elicitation/request`）`useState(() => isUserInput || isElicitation)` 默认展开——收起了用户没法填，这是可用性不是审美；② flex 列默认 `flex-shrink:1` **会压缩子项**：不写 `.approval-stack .approval-card { flex: none }`，行高会被压到 24px 且 `scrollHeight === clientHeight`（**滚动条永远不出现**，实测 8 条时 `scrollable=false`）。
  **e2e 钩子**：审批在 e2e 里无法从真实引擎触发（profile 跑 `danger-full-access`，永不问审批），所以加了与 `window.__adbg` 同款的测试入口 `window.__harnessApprovals.push/clear`（只改内存 state，不碰引擎），供截图与断言。
  **回归**：`accept.mjs` 的 `approval-compact`（10 断言：三条各占一行 ≤44px / 收起态不渲染正文 / 收起态也能允许拒绝 / 摘要只露首行 / **八条时限高滚动且输入框仍在视口** / 展开看到完整命令 / 只影响这一条 / 再点收起 / 清空不残留）+ 预检【4a-5】8 条形态守卫。**反证**：把 `{expanded && …}` 改成恒真（= 旧大卡行为）→ ①②⑦ 红（heights 148/73/108）。

- **会话配置提示的两次误报与修法（09-14，用户「我切换模型会提示另一个窗口修了模型」）**：
  多窗口权威化后我加了一条「广播驱动的界面同步 + 提示」，结果**自己切模型也弹「另一个窗口更新了…」**。两个独立成因，都要修：
  ① **广播回声**：主进程把变更广播给所有窗口（含写入者），而广播常早于 React 提交 state 到达——那一刻 `runtimeStateRef` 还是旧值，被误判成「变了」。修法：写入时 `rememberOwnWrite(ownRuntimeWrites, id, runtime)` 登记签名，广播回来先 `isOwnEcho` 认领，是回声就只写镜像、不 setState、不提示。
  ② **自造冲突**：`patch` 返回的 `conflict` 只说明「你的 baseRev 过期了」，而过期常是自己连续两次写入造成的（切模型会先写档位、再写模型）。拿它当「另一个窗口改的」就是自己吓自己。修法：**conflict 一律静默合并**，提示只留给「广播 + 非回声」（真·别的窗口一定有广播）。
  ③ **中间态不能算回声**（第二轮实测）：回声表若按「签名集合」累计，切模型时先写的**中间态**（模型还是旧的 + 新档位）也在表里——另一个窗口恰好把值改回那个中间态时会被静默吞掉（`thread-runtime-multiwin` ② 就是这么假红的）。修法：回声表 **每个会话只保留最近一次写入**（`Map<threadId, {signature, at}>`）。
  ④ **迟到响应不许回退**：连写两次时先写的响应常在第二次之后才到，照收会把界面与镜像一起退回中间态（模型自己跳回去）。修法：`admitThreadRuntime` 用 `adoptedRevRef` 记每会话已采纳的最大 rev，`next.rev < knownRev` 一律丢弃。
  **回归**：纯函数断言走了预检【4a-4b】（9 条：回声命中 / rev 不参与签名 / 不同值不是回声 / 按会话区分 / TTL / **中间态不算回声** / 每会话一条 / 接线守卫）——**这条时序竞态 e2e 复现不了，必须靠纯函数钉死**；e2e 侧 `thread-runtime-multiwin` 的 ①bis（自己切模型不提示）+ ②bis（别的窗口改了一定提示，保证 ①bis 不是空断言），并给 toast 装了 MutationObserver 累计器（showToast 同时只显示一条，后到的会把前一条顶掉 → 只看瞬时快照会假红）。
  **反证**：F8 让 `isOwnEcho` 恒返回 false → ① 红；F9 改回「按签名累计」的回声表 → 中间态断言 + 表增长断言红。

- **【定论·勿回退】旧会话供应商由 config.toml 决定，不由会话决定**（09-10 跨引擎生命周期探针实证，用户「新会话能用、旧会话不行」）：真实 app-server + 两个假模型端点实测——①只改会话存档 `session_meta.model_provider` → 重启引擎后**无效**；②只改 config.toml 里该 id 的 `base_url` → 重启后**生效**。即：会话存档只记「供应商名字(id)」，请求地址永远取自 config.toml 该 id 的段；且单进程内改任何地方都无效（线程常驻引擎内存），**必须重启引擎重新加载会话**。因此 `migrateThreadToProvider` 的 `thread/resume + modelProvider + 内联 config` 与 `thread/settings/update` 都**改不掉后续 turn 的供应商**（后者不给 `capabilities.experimentalApi=true` 还会被 -32600 拒绝；变体扫描 9 种全失败）——这两条已确认是装样子，别再依赖。
  **落定修法（`applyCustomModel`）**：config.toml 里**每个** `[model_providers.*]` 段一律写「当前生效供应商的 base_url + wire_api」（保留各自 id/name 以便展示与兼容引用）；`collectSessionProviderIds()` 扫 `codex-home/sessions/**/*.jsonl` 首行收集历史引用过的 id，把**已删除供应商的 id 补成别名段**（同上指向当前生效地址），避免 `Model provider not found`。依据：引擎进程只有一把全局 Key（= 当前生效供应商的 Key），故「所有 id 指向当前生效端点」是唯一自洽形态——任何历史会话都必然走当前供应商。**用户明确拒绝 fork/新建分支方案，必须在原会话可用。** 回归脚本 `.workbuddy/verify-provider-alias.cjs`（11 项断言）。

- **供应商连接自检（探测保留网关原话）+ SKILL.md BOM 自愈**（09-10，用户报「切换供应商旧会话用不了、重启也没用」实测定位）：
  ①**真根因不在会话迁移**：引擎日志里当前**生效**供应商（火山方舟 `/api/plan/v3`）连续返回 `401 The API key format is incorrect`（26 次），deepseek 那 8 次是会话绑定 `custom36`（该档**没存 Key**，引擎用全局 Key 去打 → `Your api key ... is invalid`）。即「认证失败原因被笼统提示吞掉，用户只能反复怀疑宿主」。修复两处：**(a) 流式探测的 401/403 分支原来丢弃响应体**（只吐「网络是通的，请检查 API Key」），现统一走新增 `describeHttpBody(body)` 提取 `error.message` 原文再抛出——网关原话是判断「Key 值错」还是「Key 与通道不配套」的唯一依据（火山 `/api/plan/v3` 用套餐专属 Key、普通 Key 用 `/api/v3`）；(b) 渲染层新增 `classifyProviderProbeFailure()`（`src/hooks/useModelProviders.ts`），把失败原文翻译成中文 + 三条排查清单，并且**失败也弹 toast**（原来只写行内小字，极易忽略）；模型设置页列表底部新增**「测试当前供应商」**（`probeActiveProvider`，复用已存 Key），不必先进编辑器。
  ②**顺带发现并修掉一个真 bug：SKILL.md 开头的 UTF-8 BOM（EF BB BF）会让引擎报 `missing YAML frontmatter delimited by ---` 整份拒载**——就是用户问的「我引用了技能你为啥不用」（实测 `skill-smart-prompt` 中招）。修法：`electron/skills-market.ts` 导出 `stripSkillBom`（安装落盘后剥）+ `repairSkillBomScan`（启动扫 userSkillsDir 幂等自愈），`skills:import` 导入后同样剥；自愈调用点必须在 `app.whenReady` 里 **`server.start()`（约 1406 行）之前**（约 1270 行），否则引擎先扫到坏文件。
- **技能卸载进度流程 + 新装技能自带中文注释**（09-10）：①**卸载对称化**——原 `skills:local-remove` 只做「删目录 + 重启引擎」并返回 `{ok:true}`，前端只弹一个 toast，用户体感「没卸掉」。现改为分阶段发事件（`harness:event` 的 `type:"skill-remove"`，stage 序 `prepare→delete→registry→engine→verify→complete|pending`），渲染层用与安装同款的进度弹窗（`SkillRemoveModal`，复用 `.skill-install-modal` 样式）呈现 5 步：校验技能目录 / 删除技能文件 / 清理来源登记 / 重启 Codex 引擎 / 确认引擎已移除；结束时调 `skills/list {forceReload:true}` 回读确认，返回 `{ok, engineRemoved, engineCheckMessage}`，明确告诉用户引擎是否已不再发现该技能。入参改为 `{folder, name}`（**兼容旧字符串入参**），并补目录穿越防护（`path.resolve` 后必须仍在技能根内）与「目录不存在 / 缺 folder」的明确报错。②**新装技能的中文注释**——市场技能装到本地后 `SKILL.md` frontmatter 的 description 多为英文，此前只能在渲染层靠硬编码 `SKILL_ZH_NOTES` 兜底，**新装的技能不在表里就没有中文**。现在安装时把市场的中文简介（SkillHub `description_zh`）写进来源清单（`.skillhub.json` / `.cocoloop.json` 的 `descriptionZh` 字段），`skills:local-list` 回读并透出 `descriptionZh`，`skillZhNote` 优先级 = 中文注释表 → `descriptionZh` → 技能自带中文 → 分类中文 → 兜底。技能卡片描述同样走这条链（无中文时才退回原文）。
- **技能面板「#」触发 + 全链路中文注释**（09-10）：输入框新增 `#` 技能面板，与 `/` 命令面板**同款触发条件**（`prompt.startsWith("#") && !prompt.includes(" ")`）与**同款两列展示**（`.command-palette` 复用 `.command-palette.skill-palette`，`code` 列显示 `#技能名`、`command-desc` 列显示中文注释，首列 156px）。回车/点发送命中即 `addSkillReference`（加入 `selectedSkills` 生成 `[本轮已引用技能]` 前缀）并清掉 `#查询词`；未命中任何技能时按普通文本发送（不劫持以 `#` 开头的正文）。数据源与 `+`→技能子面板、`/skills` 命令**三处统一**为组件内 `mergedSkillCatalog`（`localSkills` + `settingsResources.skills`，`normSkillName` 归一化去重，`shortSkillName` 展示短名），配套模块级工具 `normSkillName`/`shortSkillName`/`skillZhNote`/`matchSkillCatalog`。**中文注释**：`SKILL_ZH_NOTES` 表（key=规范化技能名）覆盖随包与市场技能（含 self-improvement 自我进化、ponytail 系列、plugin-eval 系列、引擎 system 技能 imagegen/openai-docs/skill-creator/skill-installer/review-agent 等）；命中表 → 技能自带中文描述 → 分类中文 → 「已安装技能」兜底，英文描述不再原样铺给用户。**顺带修掉「技能没透」真根因**：技能子面板原 `.slice(0, 8)` 截断，本地技能按目录序排在后面的（如 self-improvement）永远看不到——改为全量渲染，由 `.submenu-pop` 的 `max-height: min(340px, calc(100vh - 16px))` + `overflow-y: auto` 承载滚动。输入框 placeholder 同步更新为「使用 / 选择命令、@ 引用上下文、# 引用技能」。中文搜索可用是因为 `matchSkillCatalog` 同时匹配 `note`（中文注释）字段。**注意**：曾加过一条独立的 `.skill-hint-bar` 技能预提醒条（卡片式，含「展开技能列表/不再提示」），用户否决——「这个卡片不要，占位符里有 # 引用技能提醒就可以了」，已整条移除（组件/状态/CSS 全清）。技能提示只保留在 `ComposerEditor` 的 placeholder 里，不要再加独立提示条。
- **超长上下文 / 重负载优化（重度用户向）**（09-08）：①时间线渲染：每个回合外层 `.turn-group` 加 `content-visibility: auto` + `contain-intrinsic-size: auto 300px`，视口外的回合跳过布局/绘制——这台机器是 `gpu_compositing: disabled_software`（纯 CPU 软件渲染），几个 G 的会话历史（回合全量挂载进 React state + 全量渲染 DOM）原本会直接卡死，此优化让重历史也能流畅滚动。注意：`resumeThreadWithTurns` 仍分页拉齐全部 turns（上限 40 页×200=8000 回合），真正的「按需懒加载旧回合」是下一步可选优化，当前靠 content-visibility 兜底渲染成本。②上下文环预警：`ContextRing` 在占用 ≥80% 加 `.warn`（橙）、≥95% 加 `.danger`（红）；`ContextUsageBadge` 在 ≥70% 时弹出「压缩上下文」按钮（调 `thread/compact/start`）。③新增设置页 **数据管理**（`settingsPage="storage"`，导航在「数据与统计」组）：`StorageSection` 调新增 IPC `app:storage-info`（统计 rollout 原档 / 图片缩略图 / 引擎日志占用）+ `app:storage-clear`（仅安全目标 `engine-log`/`images`，**绝不删会话历史**）；另提供「清理会话恢复缓存」（清空渲染层 `threadCacheRef` 内存 Map + `refreshThreads`，长会话切换后释放内存）与「打开数据目录」。IPC 实现在 electron/main.ts，桥接在 electron/preload.ts（+ vite-env.d.ts 类型）。
- **设置页按需加载 + 骨架先行**（09-08）：用户机器无 GPU 加速（`gpu_compositing: disabled_software`，VM/远程会话典型），设置市场页同步全量挂载 + 引擎 RPC 造成「点击卡顿没反应」。三层修复：①点击设置入口先画弹窗骨架（`settingsContentReady` 双 rAF 后挂载分区内容并拉数据）；②`mcpServerStatus/list {detail:"toolsAndAuthOnly"}` 会拉起全部 MCP 服务枚举工具（CPU 大户），只在进入 settingsPage="mcp" 时请求（`mcpDetailLoadedRef` 会话内沿用）；③SkillHub/插件市场网络请求原是全局 effect 挂载即打（启动全量加载 + 搜索每键一次），改为仅对应市场页可见时请求 + 搜索 350ms 防抖；长页分区 `content-visibility: auto`。注意引擎交互不变，只是宿主侧请求时机变了——依赖 `settingsResources` 的功能（技能子菜单/ponytail 检测等）在设置页打开前拿到的仍是空列表（与旧行为一致，旧行为也是 settingsOpen 才拉）。**用户实测首要根因：开系统代理（Clash 系）时全部网络请求被拖慢/挂起 → 切页卡；关代理秒切。以后排查卡顿先问代理状态。**
- **长会话分页加载**（09-06）：引擎弃用长线程全量水合后，宿主 resume 大线程若返回空 turns 会自动用 `thread/turns/list { threadId, limit, sortDirection:"asc", itemsView:"full", cursor }` 分页拉齐（上限 40 页×200 回合）。引擎侧行为无需配合，但引擎对长线程发出的 `deprecationNotice` 通知宿主已静默处理，不要再向用户转述。
- **插件安装走引擎链路**（09-06）：技能市场之外的插件市场安装 = 下载文件到 `codex-home/plugins/codex-market/<slug>` + 维护 marketplace 根 `.claude-plugin/marketplace.json` 清单 + 调 `plugin/install { pluginName, marketplacePath: <manifest 文件路径> }`。要点：marketplacePath 必须是 manifest **文件**路径（传目录报 os error 5）；本地 marketplace 根缺受支持 manifest（`.claude-plugin/`、`.agents/plugins/`、`.cursor-plugin/` 下的 marketplace.json）时引擎 plugin/list 静默返回空。
- **模型配置约束**（09-06 立规 / 09-09 精准化）：模型编辑器对超限值显示中文预警——这些值原样传供应商，虚标会被拒或长挂。判断依据：内置规格表（src/lib/model-specs.ts matchModelSpec）收录的模型按**官方规格**精准判断（gpt-6/deepseek/gemini 等本就支持 1M，填 1M 不误报）；规格表未收录才退回 >256K/>128K 通用提醒。新模型记得进规格表。引擎侧照常使用用户配置的 contextWindow。
- **模型列表保存=全量覆盖**（09-08 修复）：`custom-model:save` 的 models **以前端传入完整列表为权威**，不再与磁盘旧列表合并——前端保存时总是带全量 models（设置页/中转站/官方订阅/登录页一致），列表里没有的模型即视为用户删除，合并回来会让删除「保存后复活」。仅当调用方完全没传 `models` 字段时才回退磁盘旧列表兜底（老调用方兼容）。删除当前生效模型时前端（App.tsx 删除按钮）已同步把 `model` 回落剩余第一个，`withModels`/`normalizeProvider` 不会把它补回。
- **引擎重启瞬态错误自动重试**（09-08 修复）：保存/切换供应商会 `server.restart()`，restart 会 reject 全部在途请求（`Codex app-server restarted`）——撞上重启窗口的 RPC（如设置页 plugin/list）会弹出吓人的「以下数据读取失败」黄条。已在主进程 `codex:request` 对该错误自动重试 2 次（1.2s/2.4s，restart 本身会 await start()，重试时新引擎已就绪），仍失败才抛出；`Model provider not found` 补救逻辑保持不变。
- **归档批量删除逐条容错**（09-08 修复）：引擎对被 fork 引用的会话拒删（`forked history still references it`），批量删除改为逐条独立处理 + 自动二轮重试（fork 引用可能只是删除顺序问题）+ 失败汇总（人话提示「被其他会话分支引用」），不再一条失败中断整批。
- **图片 part 三形态兼容**（09-08 修复）：宿主发送 `localImage`（驼峰），引擎事件/回读返回 `local_image`（下划线）或 `image`+image_url（data URL）——渲染层统一经 `prompt-images.ts` 的 `isImagePart`/`imagePartSrc`/`normalizeImagePartForSend` 识别与归一化，覆盖用户消息显示、编辑重发、排队消息、引用候选。否则带图消息发出后图片「凭空消失」。
- **图片协议双编码**（09-08 修复）：`harness-image://` 的 path 参数必须**双重 encodeURIComponent**——Chromium 对自定义协议 URL 自行解一层，`%5C`（反斜杠）还原后在协议层丢失（decoded 变 `C:UsersAdministrator...`）→ existsSync false → 返回 1×1 透明占位 PNG（表现为「图片预览透明」）。handler 兼容双/单编码 + 斜杠方向互换兜底。
- **灯箱工具栏避开原生窗口钮**（09-08 修复）：`.lightbox-toolbar` top 必须 ≥56px——titleBarOverlay 窗口钮（高 43px）是系统合成层永远盖住网页内容，压上去会让灯箱「关闭 ×」与应用「关闭 ×」重叠，点灯箱关闭实际关掉整个应用。
- **视觉/生图插件（harness-media.mjs）**（09-08）：vision 支持**本地路径**（自动读文件转 data URL，按扩展名定 mime）——引擎消息里的图片就是本地路径，原实现只收 URL/dataURL 会让模型传路径必 400 后绕路转 base64（表现为「跑半天」）。**视觉模型用 gpt-5.6-luna @ pptoken cc 网关**（实测真实图识别正常）；gpt-5.5 在该网关上游权限被拒（纯文本都 502），勿配。pptoken 共享通道 429/502/503 间歇出现，失败重试或换模型规避。**生图持久化（09-09）**：image 现在返回 `{path, url, note}`——网关可能把图托管在**临时图床**（实测 aiba-media.org 隔夜整域 404，用户微信里裂图），脚本会把 http(s) URL 下载 / data URL 解码存到 `userData/images/codex-harness-<ts>.<ext>` 并返回本地 path；developer_instructions 已注明「引用图片用 path，url 可能几小时就失效勿当永久链接」。注意脚本内 fs 是 node:fs 回调式 API——不传 callback 直接抛 TypeError，落盘必须用同步方法。
- **机器人渠道会话生命周期**（09-08 修复 / 09-09 多渠道真实接入）：渠道网关凭据是主进程**全局单例**（微信 `userData/weixin-accounts/weixin-account.json`、Telegram `telegram-account.json`、飞书 `feishu-account.json`、钉钉 `dingtalk-account.json`、QQ `qq-account.json`、企微 `wecom-webhook.json`），与 localStorage "bots" 的 bot 记录**没有 id 级关联**（一渠道一会话，bot 记录只是 UI 注释）。删除机器人/更换渠道现在会先调对应 `*:logout`（清 token+删凭据文件+停轮询）并立即刷新 `channels:status`——否则同渠道新建被判定「已连接」直接复用旧会话，扫码入口不出现，且旧连接继续收发消息。

**渠道接入状态（09-09）**：真实网关渠道 = 微信（iLink 扫码）、Telegram（Bot Token 长轮询）、飞书（`@larksuiteoapi/node-sdk` WSClient 长连接，事件 `im.message.receive_v1`，免公网 IP）、钉钉（`dingtalk-stream` SDK Stream 模式，回调 topic `/v1.0/im/bot/messages/get`，回复用消息自带 `sessionWebhook`，免公网 IP）、QQ（官方 REST+WebSocket：`app/getAppAccessToken` → `/gateway` → op2 identify/intents (1<<25)|(1<<12) → 被动回复带 `msg_id`，需 `ws` 包）、企微 Webhook（群机器人 webhook，仅推送，腾讯限制无法收消息）。统一管线 `handleChannelMessage(channel, from, chatId, text)`：per-user 内存绑定前缀 `fs:`/`dd:`/`qq:`（微信 `tg:` 兼容旧键）+ 渠道级 `channelBotBindings[channel]`（已扩成 `Record<string, BotChannelBinding|null>`，旧 bot-bindings.json 双键文件兼容）→ resume 失败清绑定 → thread/start → turn/start → onDoneProxy 发最终正文。`channels:status` 返回全部 6 个渠道。启动时各网关 `resume()` 自动恢复。**QQ 注意**：被动回复的 `msg_id` 5 分钟有效、且需在开放平台申请「发送消息」权限并上线机器人；**QQ 扫码连接（09-09）**：`qq:qr-start/status/cancel` 三个 IPC，electron/qq-qr-connect.ts **内联官方扫码协议**（不引 `@tencent-connect/qqbot-connector` 包）——POST q.qq.com/lite/create_bind_task 建任务 → buildConnectUrl 出二维码 URL（主进程 qrSvg 转 SVG）→ 手机 QQ 管理者账号扫码确认 → 轮询 /lite/poll_bind_result（status 2=COMPLETED）→ AES-256-GCM 本地解密 bot_encrypt_secret 得 AppID/AppSecret → 走 qqGateway.connect；status 3=EXPIRED 自动重建任务刷新二维码。**为何内联而非官方包（09-09 实证）**：官方包 CJS 构建损坏（require 解析失败）；且 electron tsconfig 为 CommonJS 会把 await import() 转译成 require，new Function 包 ESM 动态导入虽绕过编译期，但打包 asar 后裸 specifier 解析有挂起风险——UI 二维码区无限转圈。内联后自带请求超时（10s）与错误上报，不再转圈。注意：扫码授权会重置该机器人已保存的 AppSecret（腾讯规则），UI 已提示；qq:logout 会连带取消进行中的扫码流程。其余渠道（飞书/钉钉/企微）的授权安装均为 ISV 服务商模式（需注册服务商+公网回调收 ticket），个人工具产品做不了扫码即连，保持手动输入；**企微注意**：群机器人只能推送不能对话（UI 文案已写明）。
- **开发模式已整体移除**（09-09，用户拍板「鸡肋，删干净」）：原 staging 工作流（dev-workspace 私有仓 / 生效改动 / 撤销生效 / 回滚基线 / Codex 自查 / 启动自愈 boot flag）相关的前后端代码、IPC（dev-mode:get/set/apply/review/self-review/revert-apply/rollback/claim-next/set-thread/relaunch）、CSS 与文档全部删除；`dev-workspace/` 目录与 userData 下的 dev-mode*.json 为历史残留，可手动删除，代码不再读写。机器人会话绑定保留（见下条），机器人始终走标准会话。
- **深度思考「运行状态断」根治（09-09，二次深挖，真实抓流实证）**：渲染层 `reasoningActive` 判定要求 `!reasoningDuration.has` 且 status running，而 `item/completed` 对 reasoning 会立刻 `reasoningDuration.set()`——引擎偶发「提前 completed + 继续发 delta」时运行状态被打停（用户实测：长思考跑很久后运行状态莫名断、内容还在涨）。**根治：reasoningDuration 落点从 item/completed 推迟到 turn/completed 统一结算**（item/completed 只补记 reasoningStart 起点；turn/completed 遍历本回合 reasoning items 结算耗时），配合 appendIndexedDelta 的「delta 到达恢复 active」双保险。引擎侧实证完全正常（diag 脚本 safeStorage 解密真实 key + 起真实引擎 + 超长思考请求，6594/8159 条 delta 0 错位、无 without active item、turn 正常跑完）——日志里 1460 次 without active item 是引擎对孤儿 delta 的报错，真实长流不触发。**调试坑：vite minify 会把变量名重命名（reasoningDuration→e8 之类），不能用变量名搜 bundle 验证产物，要用字符串常量或时间戳**。diag 脚本 .workbuddy/diag-reasoning.cjs 可复用（Electron safeStorage 解密 + 真实引擎抓流）。
- **模型「最大输出 Token」真实生效（09-09，maxOutputTokens 由摆设→落地）**：`model-specs.ts` 里声明的 `maxOutputTokens`（gpt-6=128K 等）此前只填 UI 表单默认值、从未传给引擎（catalog JSON 写 `max_output_tokens` 字段会被引擎静默忽略——探针实证 model/list 读回无该字段）。现在 `applyCustomModel` 的 providerToml 每个 `[model_providers.X]` 段内写 `model_max_output_tokens = <当前生效模型的值>`（与 `model_auto_compact_token_limit` 同级），引擎 `config/read` 能读回（独立 CODEX_HOME 探针实证，`.workbuddy/probe-maxoutput.cjs`）；未填则不写（引擎按模型自身上限）。作用：单次输出硬上限，防止超长输出（深度思考等）撑爆上下文窗口卡死。注意：`model_max_output_tokens` 是 provider 段内键、不是顶层键，不需要进 `HARNESS_CONFIG_KEYS`（该 Set 只管顶层去重）。
- **供应商切换「重启生效」延迟模式（09-10）**：切换供应商不再立即重启引擎打断会话——`custom-model:set-model` 新增 `apply?: boolean`（默认 true 兼容旧调用方；`apply:false` 只保存 custom-model.json 不重启）；新增 `custom-model:apply` IPC（读当前激活 → applyCustomModel → 重启引擎，幂等）。渲染层 `pendingRestart` 状态：切换跨供应商时**引擎空闲自动重启生效**（无运行任务）、有任务则顶部 banner「已选择 X，重启后生效」（「重启生效」按钮 = `applyCustomModel` + `thread/resume` 迁移当前会话，原会话数据完整保留；「撤销」= 恢复 prev provider/model）。生效前 modelId 保持旧值 → 发送走原供应商不触发 send 前切换。**启动 self-heal 补了 model/provider 漂移检查**（config.toml 顶层 `model=`/`model_provider=` 与 custom-model.json 不一致即重写）——「切了没点重启就退出应用」下次启动自动按新配置生效。中转站/官方订阅/设置页保存等立即生效路径成功后 `setPendingRestart(null)`（hook 新增 `onEngineApplied` 回调）清残留 banner。一次只生效一个供应商：pendingRestart 唯一、连续切换只保留最后一次。
- **完全权限重启后被静默降级为 workspace-write（09-10 修复，重启变灰根因）**：打开会话时两处代码会把引擎/本地权限错误降级：① 事件处理把引擎回推的 sandboxPolicy（线程旧状态/创建时默认，常是 workspace-write）在本地无用户记录时**落盘污染 thread-permissions**；②openThread resume 恢复逻辑末尾有  push——0.153.4 的 settings/update 接受 sandboxPolicy，恢复值若来自被污染的 localPerms 会把引擎权限**写回降级**。链条：重启打开 → 回推旧策略落盘 → resume 读到灰值 → push 引擎灰 → 完全权限变灰（用户实测 rollout 时间线 16:19 被降级、需重选恢复）。**修复**：①回推 sandboxPolicy 本地无记录时只临时显示、绝不落盘；②删除 resume 恢复的 settings/update push（打开会话绝不向引擎 push 权限，引擎权限只由 changePermissionMode→pushThreadPermissions 显式管理）；③resume 恢复优先级改为 localPerms(用户选择) > resumedSandbox(引擎真实) > savedDefault(全局默认)。引擎权限通道：thread/settings/update 接受 sandboxPolicy（pushThreadPermissions 用）；thread/resume 带 sandbox 引擎不回读。
- **旧供应商会话自动迁移（09-10，401 无限重连修复）**：切换供应商后，绑定旧供应商（已停用/已切走）的会话发消息会因 Key 错配 401 无限重连（引擎全局 key 经 setApiKey 注入的是当前激活供应商，而线程绑定创建时的 provider/base_url——实测：切到 pptoken 后旧火山引擎会话报 401 API key format incorrect，url 仍是 ark.cn-beijing.volces.com）。**修复**：抽 migrateThreadToProvider（thread/resume 带 modelProvider+config+model 迁移线程到目标供应商，官方唯一通道，历史保留），applyPendingRestart 与发送前共用；发送前检测**自动迁移会话到当前激活供应商**。第一版比 selectedModel.provider（UI 下拉）是错的——切换动作会把下拉改成新供应商导致永不触发（用户实测「保存重启没生效吗旧会话还是不行」）。**正解：threadProviderRef 登记表**——openThread resume 时记录响应回带的 modelProvider（线程真实绑定）；发送前查表发现绑定 != 当前激活 → migrateThreadToProvider + 更新 modelId/saveThreadModel + toast；登记表无记录（本次启动没 resume 过）先轻量 resume（excludeTurns:true）向引擎探测真实绑定（引擎是绑定的唯一权威）。migrateThreadToProvider 成功后同步更新登记表。诊断法：引擎日志 401 的 url 字段直接暴露实际请求 base_url，与 config.toml 当前 provider 对比即可定位 Key 错配。

- **供应商强制重启生效 + 全局互斥（09-10，用户拍板改回）**：用户推翻「延迟生效」设计，要求切换/保存供应商必须立即重启引擎生效。chooseModel 跨供应商分支改回：弹窗（openAppConfirm「切换并重启」）→ setProviderModel（默认 apply → 立即重启）→ migrateThreadToProvider 迁移当前会话 → 更新 modelId/saveThreadModel。设置页「保存」按钮同样弹窗（「保存并重启」）。原延迟生效代码（pendingRestart/banner/applyPendingRestart/cancelPendingRestart/onEngineApplied）保留但不再被 chooseModel 触发（死代码，避免误删）。**互斥**：全局只允许一个激活供应商（custom-model.json 单文件），自定义卡「启用」/OpenAI 订阅「启用订阅」/中转站「设为当前」按钮在已有其他激活供应商时 disabled（title 提示先停用）；自定义卡 disabled 表达式用 customModel != null 收窄（Boolean() 不缩小 TS 类型）。**90s 无流提醒不常驻**：stream-stale systemEvent 插入后 25s 自动撤（原逻辑校对对不上会一直占位）。

- **图片灯箱「打开位置」+ 复制修复（09-10）**：点击消息/附件图片放大后工具栏新增「在文件夹中显示」（本地路径/`harness-image://` 双编码解码后调 `shell:reveal`，http URL 改 `openExternal` 打开链接）。复制图片根因修复：渲染层 `fetch(harness-image://)` 自定义协议拿不到 blob，本地图片改走主进程 `clipboard:write-image` IPC——**Electron 44 已移除 `clipboard.writeImage/readImage`**，主进程写图片剪贴板须 `nativeImage.createFromPath` → `toPNG()` → `clipboard.write([new ClipboardItem({ "image/png": new Blob([new Uint8Array(png)], { type: "image/png" }) })])`。**ClipboardItem 是 electron 模块的具名导出**（`const { clipboard, ClipboardItem } = require("electron")`，官方 breaking-changes 迁移示例）——不是 `Electron.ClipboardItem`（运行时无全局 Electron 命名空间，ReferenceError），也不是 `globalThis.ClipboardItem`（主进程无全局注入，实测 undefined）。图片源形态归一化见 `resolveImagePath`（绝对路径 / harness-image:// 双编码 / http 三态）。

- **输入框粘贴文件为附件（09-10）**：ComposerEditor onPaste 从 clipboardData.files 提取非图片文件（图片仍走 onPasteImage 内联占位符），取 Electron File 对象扩展的 path 属性（File & { path?: string }）→ onPasteFiles → 加入 files 附件条，发送时随 [附件文件] 块带上。支持多选批量粘贴。纯文本粘贴仍走 plaintext-only 原生行为。

- **频道机器人会话绑定（bot-bindings.json）**（09-09）：微信/Telegram 机器人可绑定到已有会话——机器人管理弹窗「绑定会话」选择器（IPC bot-binding:get/set，渠道级绑定存 userData/bot-bindings.json）。会话解析优先级：**渠道级绑定 > per-user 内存绑定（weixinBindings）**；新会话自动写入渠道绑定（顺带修了重启丢内存绑定导致每次重启开新会话）；resume 失败自动清绑定开新会话；weixin/telegram logout 清绑定；解绑同步清 per-user 缓存。绑定行仅在渠道已连接时显示。**机器人始终走标准会话**：机器人级开发/标准切换已随开发模式移除（botDevGet/botDevSet IPC、bot-mode-seg 分段控件均已删除），机器人 cwd 恒为 `botConfig?.workspace || home`。
- ⛔ **【已更正】微信流式回复烧 token 事故 + 网关可观测性（09-12）**：~~iLink 的 `context_token` **实测一次一发**~~ ——
  **"一次一发"这个结论已被 09-18 复核推翻（见下一条）**，当时的处置（撤掉微信流式）已回滚。
  本条里仍然有效的是**网关可观测性那部分**（与 token 无关，继续照做）：发送/取 ticket 失败必须落日志
  （`userData/channel-logs/gateway.log`）、token 失效要连续确认 3 次才停、非文本消息要回复引导。
  （至于当时的现象——每次 flush 都带同一 token、第一条成功后后续全失败——现在归因于**请求体字段/时序**，
  不是 token 一次性；但"**追加失败被 catch 静默吞掉 → 桌面端有完整回答、微信端收不到正文**"这个
  观察仍然成立，所以"失败必须可见"的处置继续有效。）**修复：微信渠道撤掉流式增量**（`weixinStreamSink` 只传 `send`，turn/completed 后一次性发最终正文，必达）；思考/工具流式同步仅 Telegram（replace 语义）保留。②`getupdates` ret=-14/token 失效原先**静默 stop()**（轮询死掉后入站消息全部蒸发、无任何提示）——现改为连续 3 次确认才停 + 日志明确写「到机器人管理重新扫码」，`sendmessage` 失败也落日志。③网关日志同步落盘 `userData/channel-logs/gateway.log`（1MB 轮转 .old）——此前只在内存数组+UI 事件，排查「消息没同步」完全瞎抓。④非文本消息（语音条/图片）此前静默丢弃——现回复引导「请用语音转文字或打字」。**生效需重启应用；token 已失效必须重新扫码绑定**（iLink 无免扫码刷新接口）。

- **微信流式恢复：真约束是「配额」不是「token 一次性」（09-18，用户反馈"运行过程的流式正文没同步过来"）**：
  先复核 09-12 那个结论，判定为**误判**——iLink 的 `context_token` **可复用**（多份协议逆向/实测一致：
  同一 token 连发多条都收得到；"第一条成功后发不出"的真因是 `from_user_id`/`client_id`/`message_type`/
  `message_state`/`base_info` 字段不全导致**服务端静默丢弃**，或 token 未持久化）。**真正的硬约束是配额**：
  用户每发一条消息后，该会话 **24 小时内最多 10 条**独立消息（含最终回复那条），用户再发消息则重置。
  所以"流式 = 把内容切成多个气泡"**每个气泡占 1 条配额** —— 这也是官方 Skill 里"流式"的实现方式。
  另有一个**「对方正在输入…」**接口（`ilink/bot/getconfig` 拿 `typing_ticket`，缓存 24h → `ilink/bot/sendtyping`
  `{ilink_user_id, typing_ticket, status:1|2}`），几秒自动消失需每 5~8 秒重发，**不占那 10 条配额**
  —— 长任务里它才是"过程可见"的主通道。
  三处实现（缺一处就退回"只有汇总"或撞爆配额）：
  ① `weixinStreamSink` 恢复 `append`（state=1 追加同一 client_id 气泡）/ `finalizeAppend`（state=2 收尾）；
  ② `main.ts` 的 `WEIXIN_STREAM_BUDGET = { maxFlushes: 5, flushIntervalMs: 3000, minChars: 40 }`
     —— 追加 5 + 收尾 1 = 6 条，留 4 条余量；`BotStreamSession` 新增 `BotStreamBudget` 参数（Telegram 用近似无限制的默认值）；
  ③ `botStreamPlanFor()` 返回 `{sink, budget, typingFrom}`，turn/started 起 typing、turn/completed 停
     （`weixinTypingStops` 按 threadId 存停止函数，重开回合先停上一轮）。
  验证：纯逻辑验收 10 项（`require dist-electron/bot-stream.js` + 假 sink）——追加 ≤5、总消息 ≤10、
  同一 clientId、**正文零丢失**、降级时收尾补发完整正文、关闭流式退化为一次性发送；
  预检 ⑰j【38】六条守卫；反证 A~F 全红（sink 退回只有 send / 预算调 40 / 预算不传 / 去掉 typing 接口 /
  typing 不停 / 预算不参与节流）。
  ⛔ 两个自己踩的坑：**反证锚点在 CRLF 文件上静默匹配不到**（本仓库行尾不统一：main.ts/bot-stream.ts 是 LF、
  weixin-gateway.ts 是 CRLF）→ 走"变异已落盘"前置断言 + EOL 自动重试；
  **断言期望值不能引用被测常量本身**（`x.length >= WEIXIN_BUDGET.minChars` 在预算被改小时恒真 = 自证式断言），
  必须写**设计值字面量**。
  **渠道纯文本排版（09-18 用户实测「表格同步到手机变竖线堆」+ 追问「其他渠道是不是一样的效果」）**：
  微信 iLink / Telegram（无 parse_mode）/ 飞书 `msg_type=text` / 钉钉 `msgtype=text` / QQ `msg_type=0`
  **都是纯文本通道**，不渲染 Markdown —— 原样转发必然不可读（Telegram 还会露出 `**`）。
  `electron/channel-text.ts` 的 `plainTextForChannel()` 逐行转换：表格行 → `【首列】其余列`
  （分隔行丢弃）、标题 → `【】`、粗体/行内代码去符号、链接去 URL 留文字、列表 → `•`、水平线丢弃；
  **所有渠道的发送点全走它**：`weixinStreamSink` 三个发送点、`telegramStreamSink` 三个发送点、
  `handleChannelMessage` 的 reply 漏斗（飞书/钉钉/QQ）。微信额外**攒到完整行再发**（`carry` 缓冲：
  分片可能切在半行中间，逐行转换因此分片安全；carry 残留由收尾补上，正文不丢）。
  预检【38】直跑真实现做行为断言 + 「各渠道发送点全带转换」结构断言（存在性断言会被死代码骗绿，反证实测）。
  ⚠️ 本轮两个坑：① 守卫锚点没算 TS 类型注解+换行（照抄真实源码形态才对）；② **type-stripping 行为断言
  不查类型严格性** —— `[\s\1]` 里的 `\1` 被判八股转义（TS1536）时预检照样绿，只有 `tsc -p electron/tsconfig.json` 抓到。
  ⚠️ 改文件名/函数名时，预检锚点与反证脚本要一起改（本轮改名 wechat-text→channel-text 时同步了 6 处）。
  **飞书 / 钉钉 / QQ 补过程流式（09-18 用户「其他机器人渠道消息是这个一样的效果不」→ 拍板「接上流式，按各渠道限制做」）**：
  查证后三家**都不能编辑已发消息**（飞书 node-sdk 未暴露 `im.message.patch/update`、钉钉 webhook 只能发新消息、
  QQ 被动回复逐条）⇒ 与微信同款**追加语义**（`append` 推进度 + `finalizeAppend` 收尾发完整汇总），
  预算按各自频控设：飞书 4 条/4s、钉钉 3 条/5s（webhook 20 条/分钟）、QQ 3 条/3s（官方被动回复 ≤5 次/msg_id，3+1 留余量）。
  QQ 的回复凭据**逐条现取**（`msg_id` 5 分钟有效，闭包捕获会在长任务里过期）。
  ⛔ **顺带修掉一个真冲突**：飞书/钉钉/QQ 的绑定与微信共用 `weixinBindings`（键前缀 `fs:`/`dd:`/`qq:`），
  微信分发分支此前只排除 `tg:` ⇒ 会把三家的绑定**截胡**、用微信网关发飞书消息；现按前缀白名单过滤（只认无前缀的微信用户），
  预检【38】加「渠道分发与前缀过滤」守卫。
- **频道机器人流式回复（bot-stream.ts）**（09-08 新增）：微信/Telegram/飞书/钉钉/QQ 机器人回复支持流式——思考/工具/正文按引擎事件时间顺序实时推送（09-18 补齐飞书/钉钉/QQ 的追加语义）。设置全局存 `userData/bot-stream.json`（IPC `bot-stream:get/set`，UI 在机器人管理弹窗：流式回复总开关 + 同步思考 + 同步工具，**回合开始时同步读，开关下一条消息即生效**）。两种传输语义：微信 iLink `message_state=1` 向同一 `client_id` 气泡增量追加、`state=2` 收尾（追加连续失败 2 次自动停用降级收集，收尾补发尾部；flush 节流 1.5s、上限 40 条防刷屏）；Telegram `sendMessage` 建气泡 + `editMessageText` 1.6s 节流整段改写，最终落定超 4000 字分片补发。事件源：`item/reasoning/*Delta`（💭 思考）、`item/started` commandExecution/mcpToolCall/fileChange/webSearch（🔧 工具，单命令输出截 400 字）、`item/agentMessage/delta`（正文）；`item/completed` 权威快照兜底补齐漏收 delta。会话按 threadId 挂在 `botStreamSessions`，turn/completed 后保留（handler 的 onDoneProxy 以 `botStreamSessions.has(threadId)` 判断是否兜底发最终正文，防双发）；Telegram 绑定靠 `telegramBindings`(threadId→chatId) 反查。
- **GPU 渲染策略**（09-06 回退 → 09-09 改为用户可选开关）：默认保持 Chromium 默认（健康显卡自动硬件加速）。曾强推 `ignore-gpu-blocklist` 等四开关，健康显卡上用户实测点击延迟明显变高，已回退——**不要无脑强开**。但低配机（弱核显/黑名单显卡）默认软件渲染、这个 React 应用渲染重会卡，因此做了**设置 → 通用 → 显示与性能 → 硬件加速**三档下拉（`app-settings.hardwareAcceleration`：auto 默认 / force 忽略黑名单+强制 GPU 光栅化/零拷贝 / off 完全 CPU）。主进程在 **app ready 前同步读取并应用**（`readAppSettingsSync`，commandLine 开关只在启动早期生效），需重启生效。启动日志 `[gpu] feature status` 可诊断 GPU 状态；force 档位就是在软件渲染机器上把它改成 hardware 加速的诊断依据。
- **中转站中心（sub2api 兼容，独立设置页 settingsPage="relay"）**（09-07）：宿主设置 → 账户 → 中转站 + 启动登录界面「中转站账户」tab。协议：POST /api/v1/auth/login、GET /api/v1/user/profile（balance=USD 余额）、GET /api/v1/subscriptions/summary（套餐绑定 group_id）、GET/POST /api/v1/keys（key 明文）。用户选「余额」或「套餐」= 选定 API key（套餐 key 绑对应 group_id，余额 key 无分组）→ 自动生成供应商（{site}/v1，OpenAI 兼容）并选中。**多账号**：userData/relay-store.json {activeId, accounts[]}（id=base|email，老 relay-account.json 首读自动迁移）；IPC relay:accounts/switch-account/remove-account；logout=移除当前账号；登录/切换后宿主自动重配模型（**首套餐优先→无订阅走余额**，无可复用 key 自动新建，逐模型 matchModelSpec 同步规格表）。**注意：部分站点（pptoken）强制 key 必须绑分组，无分组 key 网关 403——宿主自动改绑第一个订阅分组重试。** 侧栏账号区 RelayQuotaChip 与输入框 RelayBalanceBadge 显示当前生效套餐余量/余额（5 分钟轮询）。密码 safeStorage 加密，401 自动重登。公共逻辑在 src/lib/relay.ts。**切换账号强同步（09-08 修复）**：relay-active 增加 `switchedAt` 时间戳 + `email` 字段；RelayBalanceBadge 改为按 `provider|apiKey|mode|groupId|switchedAt` 指纹刷新——同网关不同账号复用同一 provider 字符串时也能立即重拉余额，不再卡在旧账号；displayName 含邮箱便于区分；OpenAI 官方面板切号时通过 `onActiveChange` 把当前账号 email 传给输入框徽标（accountKey），同样立即刷新额度。
- **账号启用/停用开关**（09-08 新增 / 09-09 补全）：中转站与 OpenAI 账号卡片右上角开关（IPC relay:toggle-account / openai:toggle-account，开关状态存账号对象 disabled 字段）。停用 = 退出切换候选；**停用使用中的账号会真正退出生效**：中转站清 custom-model.json=null + activeId=null + 同网关 relay 供应商（relay-<host 首段>）禁用 + 引擎重启；OpenAI 清 auth.json + 引擎重启。**重新启用时若无任何生效账号，自动把该账号恢复为当前生效**（切换+autoConfigure 全链路，09-09 补——否则停用→启用一圈回来还得重新配模型，用户反馈「隔夜模型配置没了又让我配置」）。数据全程保留。
- **OpenAI 官方订阅（openai-official 伪供应商）**（09-07）：设置 → 模型 页 OpenaiOfficialCard + 独立页 settingsPage="openai"（OpenaiSubscriptionPage，多账号批量管理）。设备码登录 = 引擎原生 `codex login --device-auth`（spawn 时注入系统代理：HTTPS_PROXY env 优先，否则 session.resolveProxy）。登录成功写 CODEX_HOME/auth.json → **openai:capture-login 收进 vault**（userData/openai-accounts.json，按 email 去重）→ applyCustomModel 对 provider="openai-official" 特判：**不写 model_provider**、写 `preferred_auth_method = "chatgpt"`、不写 model_catalog（引擎内置模型目录）。多账号切换 = openai:account-switch（vault tokens 写回 auth.json + 引擎重启）。额度走 GET chatgpt.com/backend-api/wham/usage（Bearer access_token + chatgpt-account-id，支持按 email 指定 vault 账号）。OpenAI 有区域限制：无代理网络登录会 403（直连 auth.openai.com 403 实证）。登录成功即自动启用（account-switch 写回 auth.json+重启引擎+重配模型，登录完可直接对话）；输入框 OpenaiBalanceBadge 5 分钟轮询 wham/usage 同步官方额度（宽松匹配 percent/ratio 字段）。中转站管理页 = 账号卡片网格 + 二级弹窗（管理面板/登录表单），密钥列表扁平化只显示本账号。

**OpenAI 官方链路铁律（09-07 全链路实证，勿回退）**：
1. **thread/start 绝不传 modelProvider="openai-official"、不内联任何 provider 定义**（渲染层 App.tsx providerConfig 与主进程 newThread 都已特判省略）——引擎按 provider 名校验 env_key，内联即报 Missing CODEX_HARNESS_API_KEY 或 401 api_key_not_supported，流无限重连。
2. **官方供应商存档绝不能有 encryptedKey**：custom-model:save 的「apiKey 留空沿用上一供应商」逻辑会把中转站 sk- key 带进官方条目 → 引擎拿 API Key 调 chatgpt 后端被 401 拒；applyCustomModel/boot 对官方强制 setApiKey("") 并自动清档。
3. **代理必须在引擎 spawn 前注入**（boot 时序：resolveLiveProxy → setExternalEnv → server.start；spawn 后 setExternalEnv 对运行中进程无效）。resolveLiveProxy 会 TCP 探测配置端口，死了自动扫 7897/7890/10808 等常见端口（用户常记错端口，实证 7897 是 Clash Verge 默认）。
4. **官方模型目录接口按 client_version 门控**：GET chatgpt.com/backend-api/codex/models?client_version=1.14.3（陌生版本返回 {"models":[]}）；响应结构 {models:[{slug,visibility:"list",priority,...}]}；请求头要 originator+User-Agent。当前真实模型：gpt-6-astra/gpt-5.6-sol/terra/luna/gpt-5.5/gpt-5.4-mini。
5. **额度接口** GET chatgpt.com/backend-api/wham/usage（Bearer access_token + chatgpt-account-id）：结构 rate_limit.primary_window/secondary_window{used_percent,limit_window_seconds}（18000=5h 窗口、604800=周窗口）。官方请求统一走 openaiFetch（session partition 代理注入 + 剥 ANSI）。
6. **诊断工具**：codex login --device-auth 的控制台输出带 ANSI 转义码（污染 URL/验证码解析，捕获后必须剥掉）；引擎黑匣子日志 userData/engine-debug.log（spawn env 快照/stderr/错误通知，2MB 轮转）；协议复现脚本 .workbuddy/repro-appserver.js（与宿主一致的 initialize/thread/start/turn/start，定位引擎问题的最短路径——注意渲染层 thread/start 有独立内联 providerConfig 隐形链路，别只测主进程）。
- **文件预览 → 内置浏览器**（09-06）：文件预览弹窗对 HTML 文件提供「浏览器打开」按钮，宿主切到右栏浏览器标签并以 `file:///` URL 开新 webview 标签渲染本地页面（BrowserPane `pendingOpen` 请求通道，seq 区分连续打开）。
- **HTML 预览放大 / 系统浏览器打开**（09-09）：用户反馈右栏 BrowserPane 太窄且「在系统浏览器打开」点击无反应。两处修复：① `external:open` IPC 原只放行 http/https，本地 `file:` 协议直接 throw（渲染层未接错误提示 → 静默失败）——现在放行 file:；② 新增 `browser:popout` IPC 开独立 BrowserWindow（1180×800 可调）放大预览，preload 暴露 `browserPopout`，文件预览加「放大预览」按钮、BrowserPane 菜单加「放大查看（新窗口）」与「在系统浏览器打开」（带错误提示）。教训：**新 IPC 若只放行部分协议，本地文件路径（file://）会静默失败，且调用方要接 catch 否则表现为「点击没反应」**。
- **引擎提示中文化**（09-06）：宿主弹卡对引擎英文提示（项目级配置被忽略/限流/断流重连等）做中文翻译后展示；引擎继续发原文即可，宿主负责翻译。
- **更新源收敛为 GitHub 单源 + 发布站转型（09-15，用户定稿「网页更新删了，只保留 github 更新源；服务器后续不发包，只负责收反馈和应用介绍」）**：
  ① `electron/updates.ts` 删除 web 源整段（UPDATE_SERVER_URL/UpdateSource/absolutize/requestJson 的 http 分支），`checkLatestUpdate(currentVersion, platform, arch)` 只走 GitHub Releases API（按平台挑资产：win→exe / mac→arm64|x64 zip）；sha256 校验与 https 强制两条预检守卫原样保留。
  ② `updates:check` IPC 去掉 source 参数（渲染层传不传都被忽略）；preload/vite-env 同步签名；App.tsx 删 updateSource 状态、localStorage `update-source`、「网页/GitHub」切换按钮，「更新地址」行静态显示 GitHub Releases，启动静默检查与手动检查都改为无参调用。**升级注意事项**：旧版客户端 localStorage 里可能残留 `update-source=web`，新代码已不读它，无清理必要。
  ③ 发布站（ch-release:/var/www/codex-harness-releases/server.js，改前备份 server.js.bak-*）两处改动：`/api/latest` 改为**两级查找**——先实时镜像 GitHub Releases（零依赖 httpsGetJson，downloadUrl 直接指 GitHub，服务器不再经手安装包），GitHub 无 release/资产时回落站内**存量** db 记录（当前库存为 0，存量兜底实际不命中，但保留兜底逻辑保证不 500）；`POST /api/releases` 上传接口**永久 410 uploads_disabled**（无 token 先 401、有 token 才见 410），后续发包从机制上关死。反馈 API（/api/feedback*）与静态页（首页介绍 / feedback.html）不动，实测均 200。**注意**：GitHub 仓库目前 0 个 release → `/api/latest` 现在返回 no_release（所有客户端显示「已是最新」），**下一次发版必须把安装包资产传上 GitHub Release**（服务器 github.com 被墙、api.github.com 可达 404 印证私有路径语义；上传从本地走）。
  ④ 发版流程变更已同步进 skill `codex-harness-release-publish`（发布站上传步骤作废）。
- **回合顺序错乱修复（09-15，用户实测「按钮说更早 3 条、上面却没有」）**：会话 01a0a216 渲染成 `[哈喽,周几,测试,早上好,开机慢]` + 按钮声称更早 3 条——状态序被 mergeLongerStreams 的**盲目前插**搅乱（resume 快照只带回部分回合如最旧的 [1,2] 时，extraTurns 前插 → [3..8,1,2]，窗口一裁剪=最旧的贴末尾、中间"失踪"）。新增纯模块 `src/lib/turn-order.mjs`（orderTurnsByTime / mergeTurnListsById / visibleTurnWindow）：mergeLongerStreams、loadEarlierTurns 游标翻页、时间线渲染三处统一**按 id 去重 + 按 startedAt 时序收口**（无 startedAt 的直播回合视为最新排最后）。预检【17】5 断言（含用户事故形状 [3..8,1,2]→[1..8] 的行为用例）。e2e：种 8 回合真实会话，全新打开顺序正确、无回归。
- **发送锚定重做为 WorkBuddy 式 sticky（09-15，用户「我看 workbuddy 的是一直固定在那个位置，上下滚动也不会取消」）**：`.user-message-stack`（回合组直接子级）`position: sticky; top: 54px`，::before 铺 `--bg` 不透明底防透字；消息由 CSS 钉住——回复增长、上下滚动都不解除，sticky 活动范围被回合组盒子天然约束（只在本回合回复区间内钉住，滚出自然松开）。`pinSentMessage` 简化为「首次落位一次 + anchor-pad 恒 0」，删除逐帧 gapErr 纠偏与一整屏留白——**发消息卡顿/延迟展示与底部大空白同根**（撑一屏留白的强制回流 + scrollTop 劫持），一并消除；`update()` 的钉顶跟随（dist>48 补滚）与 sticky 互补不再打架。`accept.mjs` send-anchor 项按新契约重写并登记 09-15 轮（LATEST_ROUND 同步）：pad=0 / computed sticky / 滚动后高回合组消息钉在 ~54px（短回合组无位可钉=自然，不算失败）；已反证（position 改 static → top=-150 红）。reasoning-follow 复跑通过。
- **sticky 悬浮锚定废弃、回到文档流钉顶（09-15 二次定稿，用户「你悬浮干嘛」）**：sticky + ::before 悬浮被用户否决（消息浮在内容上、且发送后不在原位）。已恢复 582d407 的 pinSentMessage 原实现（一整屏留白 + gap 纠偏 + 超屏交棒）与旧 send-anchor 验收项（14/15，唯一红=「钉顶流式不自动跟尾」hiddenMax=881——该行为在 sticky 改造前就存在，非本次回归，待后续单独处理）。注意：恢复用 git show 提取时标记必须全 ASCII（★ 等字符经 shell 会损坏），execSync 的 git 用绝对路径。
- **冷加载遮罩硬超时（09-15，用户实测「打开会话全白」）**：切会话遮罩（正在恢复会话…）的消失链 = markSettled → jumpToBottom →「scrollHeight 连续两帧不变」；大会话冷加载时 content-visibility 逐段回填/后台流式让高度持续变化，jumpToBottom 可长时间不 settled → 遮罩永久挂住 = 全白。修复 = markSettled 里挂 15 秒硬超时，到点无条件淡出遮罩（switchHardTimerRef，正常路径 fade-out 时清除）。诊断数据：干净环境打开 25 回合会话 600ms 内完成（groups 0→5）、滚到底/回顶几何全部正常——全白只发生在引擎忙时 resume 迟迟不完成 + 高度持续变化的环境。
- **滚到底全白第二根因（09-15 截图3）**：冷加载时 content-visibility 的回合段初始 0 高，滚到底 = 视口停在「空白扩展区」；随后段回填真实高度，内容全在视口上方，无机制拉回 → 全白。修复 = ResizeObserver 盯**各 .turn-group**（盯 .timeline 自身无效——其盒子高度不变，scrollHeight 变化不触发 RO）盒子高度突变，贴底模式（stickToBottom 且非钉顶）下把视口拉回新内容底部；RO effect 必须放在 scrollRef/contentTailTarget 声明之后（TS2448 教训）。
- **钉顶第三次重做成功：sticky + content-visibility 前置修复（09-15 定稿，全部验证通过）**：之前两次 sticky 失效的真凶 = `.turn-group` 的 `content-visibility:auto`（Chromium 已知：内部 sticky 完全失效、消息随滚动 1:1 平移）。最终方案两件套：① `.turn-group[data-current-turn]` 改 `content-visibility: visible`（当前回合在视口内，零性能损失）；② 当前回合的用户气泡 `position:sticky; top:54px` + `var(--bg)` 底衬 + 同色上下投影（流式内容从气泡下穿过无缝遮挡，无悬浮感）。`STICKY_USER_SLOT=true`：pinSentMessage 短路为「pad 恒 0 + 不纠偏」。效果（sticky4 一次性验收 5/5，用完即删）：发送后 pad=0、gap=82 钉顶、**滚到底不解除**（sticky 由 CSS 维持）、流式正文 hiddenMax=124px（此前方案 1339px）、零拉扯零回跳——「发送后一屏空白」与「滚动解除钉顶」两个历史顽疾同时消除。交棒/pin-fix/pinDormant 等旧 JS 机制保留但被 `!STICKY_USER_SLOT` 短路（回退开关：改回 false 即恢复旧钉顶）。
- **统一内置 provider id 的漏网之鱼：裸比较导致「模型选不了」+ 每次发送重启引擎（09-15 用户实测「新增的模型选不了」）**：`send()` 的供应商对齐块用 `boundProvider !== customModel.provider` 裸比较判定「要不要迁移」——统一 provider id 后会话绑定恒为 `harness`、生效供应商是 `custom906` / `relay-*`，**裸比较恒为真**，于是每次发送都误判「供应商变了」：① `setProviderModel` 默认 `restart !== false` → **每次发送重启引擎**（engine-debug.log 里 07:50:52~07:51:13 连出 8 条 `[spawn]`）；② 紧接着 `setModelId(updated.model)` 把用户刚选的模型改回供应商顶层 model → 用户感知「选完一发消息就弹回旧模型」＝选不了。**修法两处都改走 `shouldAlignProvider`**（纯模块里明确「绑 harness = 天然对齐」）：send 对齐块（src/App.tsx:14514）+ 401 自动迁移块（11577，那里裸比较恒真会让每会话的 `autoMigratedRef` 假登记，真需要迁移时反被拦住）。判定证据（隔离 profile + 真实旧会话）：修复前「选后胶囊=新模型 → 发送后胶囊=deepseek-v4-flash」且 spawn 17→19；修复后「发送后胶囊保持新模型」+ rollout `turn_context.model` 连续 5 次都是新模型 + spawn 21→21。新增离线守卫【13】：`boundProvider !== <供应商id>` 裸比较调用点计数必须为 0（只允许出现在纯模块内部）。
  - **Codex 调度专家/专家团/子智能体（09-15，用户「给他们接上调度」定稿）**：引擎可在**任意会话**里把独立子任务交给 专家/专家团/子智能体 去做并拿回产出，闭环已端到端验证（14/14）。
    - **入口与工具**：`agent_invoke`（kind=expert/team/member/subagent，目录由 `dispatchToolDescription` 拼进工具 description —— 模型**先知道有什么可调**才叫闭环）+ `agent_archive_sessions`（询问用户后归档）。二者只在**用户直连会话**注册。
    - **主进程**：`electron/dispatch.ts`（纯判定层，可被预检 require 编译产物断言）、`electron/delegate-registry.ts`（被调度会话登记表，落 `delegate-threads.json`）、`main.ts` 的 `runDelegatedTask` + IPC `agents:catalog / tool-description / notice / delegated / delegated-of / invoke / archive`。三方共用一条内核：`thread/start` → L1 持久指令 → `turn/start` → `waitForTurnCompletion`（已有 10 分钟超时）→ `turnOutputText` → 截断 → 回传。
    - **⛔ 四层防护（用户问「不会无限套娃吧」后补齐，缺一层都不算闭环）**：① **L1 提示词**——`delegateScopeBlock()` 经 `thread/settings/update` 的 `collaborationMode.settings.developer_instructions` 下发**会话级持久**指令（直接干活/不转派；主理人只许调本团）。⛔ 必须持久化，塞在单条 query 里会被历史淹没、被上下文压缩吃掉。② **L2 注册侧**——`buildDynamicTools` 里 `dispatchIsDelegated ? [] : subAgentTools(...)`，委派会话连 subagent 工具都不给。③ **L3 执行侧硬闸**——`canDispatchFrom({isDelegated})`，**渲染层防不住的地方由它兜底**（线程复用/竞态/以后有人改错注册点）；这是唯一真正的安全边界。④ **L4 总量闸**——`MAX_CONCURRENT_DISPATCH=4` / `MAX_DEPTH=1` / `clipDispatchOutput` 12000 字截断。**安全现状有据**：主进程全仓 `dynamicTools` 只有团队主理人与调度 team 分支两处传参，成员/子智能体会话一律不带（6269 行有原文注释佐证）。
    - **开关**：会话级 `dispatch: {enabled, expert, team, subagent}` 存 **thread-runtime**（`src/lib/thread-runtime.mjs` + `.d.mts` + `electron/thread-runtime-store.ts` 三处同形），UI 是**顶栏「独立窗口」按钮旁边的 `DispatchMenu`**（`topbar` 形态：纯图标按钮 + 弹层**向下**弹，因为顶栏在页面顶部向上会出屏；另一套 composer 形态保留给以后复用）；确认后经 `pendingCommandTextRef` 自动发一条告知消息（send 会优先消费它、跳过 / 与 # 解析）。
    - **侧栏**：被调度会话带 `thread-dispatch-badge`（调度中/调度/调度失败）与 `is-delegated-row` 左侧强调线；任务结束后**保留**，由 Codex 询问用户后归档。
    - **⛔ 两个坑（09-15 实测）**：① **广播通道**——`broadcastHarnessEvent` 的 payload 是**裸的 `{ type }`**，渲染层必须用 `window.codex.onHarnessEvent`（preload 直连 IPC）接，用 `MessageEvent` 那条路的 `data.event.type` 判会永远不匹配（badge 死活不出现，我改了 3 轮才定位）。② **`src/lib/*.mjs` 改了导出/字段必须同步 `同目录同名.d.mts`**：`tsconfig.app.json` 的 `allowJs: false`，TS 只认手写声明，漏改就报 `has no exported member`（不是缓存问题，清 tsbuildinfo 无效）。
    - **回归**：预检【20】15 条（L3/L4 行为断言走 `dist-electron/dispatch.js` + L1 文案 + L2 注册条件 + `.d.mts` 同步 + dynamicTools 传参守卫）；一次性脚本 14 断言（开关落盘 / 告知消息 / 真调专家起会话回产出 / 登记 / **用委派会话当发起方再调必被拒** / 侧栏徽标 / 归档与落盘），已当场反证（摘掉 `canDispatchFrom` 判断 → 预检 2 项硬失败）。
    - **已知瑕疵（未修）**：被调度会话的侧栏标题显示为首条消息壳（`[SYSTEM TASK · 调度会话]`）而非 `调度·<名字>` —— `thread/name/set` 在 turn 前后各调一次仍未生效，待查引擎侧会话名时机；不影响闭环（会话在侧栏可见且带调度徽标）。
  - **⛔ 调度工具注册改走内置 MCP（09-16，用户实测「配置全开 Codex 说没工具」后查清）**：**引擎硬约束 —— `dynamicTools` 只在 `thread/start` 生效**。四个决定性实验（假工具 + 直接问模型）实测：`thread/resume`、`thread/fork`、`turn/start`、`thread/queue/start` **四条通道全部不生效**（引擎二进制里也只有 `thread/start.dynamicTools` 一个定义点）。⇒ 渲染层 dynamic 注册的 `agent_invoke` 对**已存在的会话永远不可见**；09-15 那句「开关确认后重放 resume 同步工具面」是**假绿**（断言正则匹配到了提问里的「有没有」，把模型的「没有」也判成了绿）。**唯一能覆盖所有会话（含老会话）的注册通道是 MCP**（引擎级注入）。落地：`electron/main.ts` 的 `ensureDispatchHttp()`（本机 HTTP 服务，同时提供 MCP `/mcp` 端点）+ `dispatchMcpTools()` / `dispatchRpcCall()`；config.toml 写 `[mcp_servers.harness-dispatch] url = "http://127.0.0.1:47120/mcp?token=<持久令牌>"`。**三个坑（都踩过）**：① **stdio 通道不可用** —— 用 `electron.exe` 当 MCP 服务器要 **28 秒**才握手完（冷启动），超过 `startup_timeout_sec=20` 被引擎判死，工具根本不注册；② **必须提供 SSE 长连接**（`GET /mcp`）—— 引擎 rmcp streamable-http 客户端开局长连，缺了报 `fail to get common stream: Unexpected content type: None`，POST 就绪也没用（隔离实验的 HTTP 探针实证）；③ **端口与令牌必须跨运行稳定** —— 随机端口/随机令牌会让 config 里的 url 指向**上一次运行的死端口**，引擎连不上就静默放弃（`rmcp::transport::worker: worker quit with fatal` 只在引擎 stderr 里可见）。故：`DISPATCH_FIXED_PORT = 47120` + 令牌落 `userData/dispatch-token.txt`（`ensureDispatchToken()`）。**自愈**：config 的 MCP 段缺失/重复/端口或令牌过期 → 启动自动整份重写（含 `if (custom)` 之外的无模型兜底分支）。**已删代码**：`dispatchToolList()` 与渲染层的 `dynamicToolCall` 分支（`agent_invoke` / `agent_archive_sessions`）—— 双通道会让模型混乱，注释留在原地。
  - **调度独占锁（09-16，用户要求「同一时间只能一个会话开」）**：开关仍**按会话存放**，但「谁有权调度」**全局唯一**。持有者**从记录派生**（`ThreadRuntimeStore.dispatchOwner()`：第一个 `dispatch.enabled` 的线程）而非单独存字段 —— 删/归档线程时锁自动释放，不留死锁。冲突时主进程**不改动任何东西**并回传 `blockedBy`；渲染层显示占用者名 + 「接管并开启」，`takeover=true` 才在同一笔写入里关掉原持有者（原子，两窗口并发也不会出现「两个都开」）。UI：`DispatchMenu` 的 `lockedBy`（锁定态）/ `restrictedLabel`（受保护会话禁用）。IPC：`thread-runtime:dispatch-owner`。**执行侧校验**：`canDispatchFrom({ holdsLock })` —— 非持有者的残留调用一律拒绝（开关关掉/被接管之后，在途调用也刹得住）。
  - **受保护会话（09-16）**：专家 / 专家团 / 被调度的临时会话**不许对外调度**（`restrictedThreadRole()`：`delegateRegistry.infoOf` + `teamRunStore.teamOfThread`，单人专家直达会话走同一条 member-session 链路所以一并覆盖）。UI 直接禁用按钮换锁图标（`agents:thread-role` IPC），主进程在 `thread-runtime:patch` 里硬挡，`canDispatchFrom({ restricted })` 再兜一层。
  - **调度开关的顶栏位置（09-16 两次调整，以最终态为准）**：`DispatchMenu`（`topbar` 变体）挂在 `topbarActionsNode` 的 **「独立弹窗」图标（`.popout-open-btn`）左边**（用户定稿）。历史：先放最右挨着最小化 → 用户改要「独立弹窗图标左边」。**⛔ 只允许一处渲染**（`grep -c "<DispatchMenu" src/App.tsx` 必须为 1）——早期版本在末尾留过一份，双渲染会导致按钮重复。几何验收：`dr.right <= pr.left + 3 && sameRow`（同一行、紧邻）。独立窗口（popout）模式下该按钮不渲染（只显示"返回主应用"）。
  - **调度头像轨（09-16，用户要求「跟专家团那个展示一样」+「调度完头像停留 20 秒，方便用户查看内容」）**：`DelegatedRail` + `DelegatedRunPopup`（复用专家团 `team-rail` / `team-run-popup` 的样式与锚点定位）。数据源＝主进程 `delegate-run` 广播（`started` 点亮头像 + 自动弹窗 / `delta` 流式追加 / `finished` 切完成态）；种子＝`listDelegates`（中途开窗也能看到正在跑的）。`delegateRegistry.handleEngineEvent()` 转发被调度会话的文本增量（与 `TeamRunStore` 同套路，只认正在跑的线程）。**⛔ 停留 20 秒（`DELEGATE_RAIL_LINGER_MS`）**：`finished` 时头像**不立刻摘** —— 先切 `is-done`（呼吸环 `display:none`、头像回正），`delegateRailTimersRef` 计时 20 秒后才从 live 表删除并收起弹窗；计时器在组件卸载时统一 `clearTimeout`。**注意 `delegatedRailRuns` 不再过滤 `status === "running"`**（否则完成态根本渲染不出来），过滤条件只剩 `originThreadId === thread?.id`；`refreshDelegateRecords` 的种子也只补 running、**不删非 running**（删除归计时器管，否则重开窗口会把停留中的头像立刻抹掉）。
  - **调度归档必须真调引擎（09-16 用户实测「Codex 说归档了，但侧栏那个对话还在」）**：MCP 的 `agent_archive_sessions` 执行端原先只调 `delegateRegistry.markArchived()`（标记）→ 登记表 `archived:true` 但**引擎侧线程没归档**，而侧栏是 `thread/list { archived:false }` 过滤的 ⇒ 会话照常显示。**修法**：与 `agents:archive` IPC 走同一条链路 —— 每个 id 先 `server.request("thread/archive", { threadId })`（**不吞错**）再 `markArchived`，最后广播 `delegates-changed`（渲染层 `refreshThreads()` 重拉未归档列表）。回传文案还会报「还有 N 个未归档」（`listByOrigin` 兜底），避免模型误判。验收（4/4）：头像停留 19 秒→消失、侧栏行数 6→5、登记表 `archived:true`。
    - **⛔ 验收写法坑（这次又踩）**：判断「侧栏是否还有调度会话」不能用 `textContent.includes("调度·")` —— 被调度会话的标题是已知瑕疵的 `[SYSTEM TASK · 调度会话]` 首条消息壳（**不含** `调度·`），该断言**恒为假**、是假绿。正确判据：侧栏行数变化 + 登记表 `archived` 字段（引擎侧权威）。
  - **运行动态状态行（09-16，学 WorkBuddy）**：任务运行中在消息流末尾显示「状态 · 一句话」，跑完即消失。
    - **状态**＝当前会话**最后一个进行中的 turn item** 的类型：`commandExecution`→正在执行命令 / `fileChange`→正在编辑文件 / `reasoning`→正在深度思考 / `webSearch`→正在搜索网页 / `mcpToolCall`→正在调用工具；没有进行中 item 兜底「正在生成回复」。
    - **话语**：`RUN_PHRASES`（40 条通用）+ `RUN_PHRASES_BY_ACTIVITY`（6 组活动专属共 21 句）→ `pickRunPhrase(activity)` **专属在前、通用兜底**（专属句少，所以自然以通用句为主）。任务开始时随机锁一句，运行期**不换**（每秒换会闹腾），结束随状态行一起消失。
    - 位置：所有 turn 之后、乐观消息之前；动效三点跳动 + 状态文字 `shimmer-text`，切换文案用 `key` 重挂载触发淡入。
    - 预检【20】3 条守卫：通用池 ≥ 30 条 / `RUN_PHRASES_BY_ACTIVITY` 存在且按活动分 / **不含竞品品牌名**（WorkBuddy 等 —— 照搬会被视作抄袭，文案一律自创）。
    - ⛔ e2e 发消息**必须用 CDP 真输入** `h.pressKey("Enter")`：合成 `new KeyboardEvent` 的 `isTrusted=false` 会被 composer 忽略，消息压根没发出去 → 状态行不出现，**极易误判成功能 bug**。
  - **Windows 原生圆角外边框（09-16，用户「外边框能原生调成圆角嘛」）**：走系统级方案（非无边框+CSS），保留原生阴影/拉伸/系统控制钮。主进程 `electron/win-rounded-corners.ts` 用 koffi（纯 FFI、N-API 模块，跨 Electron ABI 稳定）调 `DwmSetWindowAttribute(DWMWA_WINDOW_CORNER_PREFERENCE=33, DWMWCP_ROUND=2)` 磨圆四角；最大化时系统自动回方（预期）。仅 `win32` 生效，其余平台函数内静默跳过。主窗口与独立会话窗口创建后各调一次 `applyRoundedCorners(win)`，并在 `unmaximize` 防御性重设。koffi 加为生产依赖、`package.json.build.asarUnpack` 增 `node_modules/koffi/**` + `node_modules/@koromix/**`（否则打包后 .node 在 asar 内 dlopen 失败）；**实证**：koffi 在 Electron 44（ABI 149）下 `require` + DWM 调用均正常（假句柄返回 E_INVALIDARG，符合预期）。预检【22】4 条守卫（依赖/两个 asarUnpack/win32 预编译就位）。**09-16 时序修复（用户反馈「主窗口方角、弹窗圆角」）**：构造后立即 `DwmSetWindowAttribute` 会被 `titleBarOverlay` 首次显示时的边框延展（`DwmExtendFrameIntoClientArea`）覆盖回直角——根因是主窗口/独立会话弹窗都用了 `titleBarStyle:"hidden"+titleBarOverlay`，而 `browser:popout` 预览窗/收银台这类**标准边框**窗口由 Win11 自动圆角（用户看到的「圆角弹窗」正是它们）。现改为：构造后先设一次兜底，再在 `win.once('show')` 里 `setTimeout(0)` 补设一次（等边框延展完成后再覆盖回圆角），`unmaximize` 由 `.once` 改 `.on` 以覆盖多次最大化/还原。
  - ⛔ **config.toml 写入面 + 会话/rollout 面大修（09-16 审计 14 个 bug，用户「你负责修好所有BUG」）** —— 报告：`docs/AUDIT-config-permissions-2026-09-16.md`（逐条证据 + 实证矩阵）。口径变更与要记的点：
    - **① 工具级权限换机制（本轮最高价值）**：`[permissions.allow/ask/deny] + "mcp__x__y" = true` 是**死的** —— 引擎 `PermissionProfileToml` 只有 `description/extends/workspace_roots/filesystem/network` 五个字段（工具规则被静默丢弃），且只写 profiles 不写顶层 `default_permissions` 会让引擎判定**整份 config 非法**（stderr `Invalid configuration; using defaults`，随后 `config/read` / `mcpServerStatus/list` 全挂），而 harness 从来不写那个键 ⇒ **点一下权限格就把整份配置打废**。现改走引擎真支持的键（最小 stdio MCP + `mcpServerStatus/list` 实证）：**`deny` → `disabled_tools = [...]`（工具从引擎工具表消失 ＝ 真阻断）**；`ask`/`allow` → `[mcp_servers.<名>.tools.<工具>] approval_mode = "prompt" | "auto"`（枚举只认 `auto/prompt/writes/approve`）。无效写法：`tools.<名>.enabled=false`（未知键静默忽略）、`omit_tools_from`（收的是 `code_mode`/`deferred` 枚举，不是工具名）。`permissions` 已从 `HARNESS_CONFIG_SECTIONS` 移出（用户自己写的 `[permissions.*]`/`default_permissions` 不再被删）。
    - **② 段级所有权 → 键级所有权**：`HARNESS_SECTION_KEYS`（windows / tools / features / otel / sandbox_workspace_write / shell_environment_policy(+.set)）声明 harness 只拥有哪几个子键；用户的 `features.memories` / `otel.trace_exporter` / `sandbox_workspace_write.exclude_tmpdir_env_var` / `windows.sandbox_private_desktop` / `shell_environment_policy.exclude` 由新的 `injectSectionExtras` 插回**同一个表**（TOML 不允许同名表声明两次）。harness **条件写入**的段（`[features]` 在浏览器自动化关闭时不写）会**补建该表** —— 否则用户子键又被丢。
    - **③ 用户顶层键必须输出在第一个段头之前**：旧实现把保留内容拼在文件**末尾**（紧接 `[mcp_servers.nuphus]`）⇒ TOML 语义上用户顶层键成了那个段的键（实测 `approval_policy = "never"` 变成 `mcp_servers.nuphus.approval_policy`）。现在 `preserveUserConfig` 返回 `{topLevel, sections, sectionExtras}`，topLevel 插在 `developer_instructions` 块字符串之后、第一个段头之前。
    - **④ TOML 转义收口 + 数值强校验（RCE 级）**：`escapeTomlString` 现在处理换行/制表/控制字符（粘贴带尾换行的 base_url 曾让整份配置拒载；`new URL()` 挡不住 —— URL 规范会主动剥掉 ASCII 换行，所以「校验通过」而落盘的是原始串）；连接器 `env` 的**键**补了引号转义（原先只有值转义）。`model_max_output_tokens = ${maxOut}` 曾是**裸插值**，实测能注入出合法的 `[mcp_servers.pwn]` 段、引擎 `thread/start` 时**真 spawn 它** ⇒ 改 `Number.isFinite` 校验 + `Math.floor`。
    - **⑤ MCP 段名按 TOML 语法真解析**（`parseTableHeader`）：旧正则字符类不含空格/非 ASCII/`@ : +` ⇒ `[mcp_servers."my server"]`、`"我的服务"`、`"@scope/pkg"` 这类**引擎完全接受**的名字采不到 → 用户手写的 MCP 服务器下次保存模型时**凭空消失**。
    - **⑥ 会话记录面**：`app:storage-info` 原来量**不存在的** `codexHome/rollouts`（占用恒 0），真实落点是 `sessions/` + `archived_sessions/`；`collectSessionProviderIds` 改以**引擎线程索引**（`thread/list` 的 `modelProvider`）为权威源、rollout 扫描降级为补充（旧实现只扫 `sessions/` 首行，**漏掉归档会话**且文件一坏就静默返回空集）；`thread/list` 现在经 `markMissingRollouts`（`session-tools.ts` 的纯函数，预检【28】有单测）给「索引里有 `path`、磁盘上却找不到」的会话标 `rolloutMissing`，侧栏显示「记录丢失」徽标并拦下点击。
      - ⚠️ **口径校正（修的时候才实证出来，别沿用审计报告初稿的说法）**：本机这版引擎在 rollout 丢失后会**把整条线程从 `thread/list` 隐藏** —— 实测「跑过一回合的会话删掉 rollout 后，`thread/list` 不再返回该 id，`thread/resume <id>` 报 `no rollout found for thread id ...`」。所以用户侧真实症状是**会话静默消失**（不是「侧栏可见、点开报错」），`rolloutMissing` 因此是**防御性**标记（当前引擎不会触发它）。也正因为引擎会隐藏，那类会话的 provider id **任何来源都取不到** —— 它们本来也打不开，与 provider 段无关。
    - **⑦ 导入的会话文件必须 canonical**：引擎要求 `rollout-<YYYY-MM-DDTHH-MM-SS>-<uuid>.jsonl`，否则 `thread/resume` 直接拒（`does not have a canonical rollout filename`），而兜底扫描照样把它列进侧栏 ⇒ 导入报「成功 1 条」、侧栏可见、**点开报错**。旧实现写的 `rollout-imported-<uuid>.jsonl` 正是这种坏文件；现在 `canonicalRolloutName`（时间戳优先从 UUIDv7 还原）+ `canonicalizeRel`（老备份就地修好）。**只有文件名重要，目录随便放**。
    - **⑧ 侧栏标题与备份同口径**：worker 原先不剥 harness 注入块（只判 3 个前缀），与 `thread-backup.ts` 漂移 ⇒ 专家团会话的侧栏标题显示「# 交易分析专家团…」这种机器编排提示词（36 条样本 4 条）。现把 `stripSystemTaskWrapper` / `stripHarnessBlocks` / `looksInjected` 整套搬进 worker（两处都必须改，注释里的「同口径」不能当证据）。
    - **⑨ 思考档位**：`max` 补进 `ALL_EFFORTS` / `EFFORT_WHITELIST`（**追加在末尾**，不动已定稿的「低中高最高极高」顺序）—— 引擎内置 gpt-6-astra 就声明了 `max`，旧白名单把它丢掉，「只声明 max」更会回落成整套默认档（替用户换档）。同时**推翻一条旧前提**：引擎**不校验** effort（自定义与内置模型的 `effort="bogus-level"` 都照收、turn 正常完成；已用哨兵 `context_window=555000` 排除「catalog 没被读到」的替代解释）⇒ 白名单只管 UI/声明，**不是安全边界**。
    - **⑩ 门禁**：预检新增 **【28】** 段（40+ 条）—— 用内置 python 的 `tomllib` **真解析**一份按生成逻辑拼出来的样例 config（`preserveUserConfig` → `injectSectionExtras` → `injectMcpToolRules` → 拼装）并断言语义位置；其余断言直接 `require dist-electron/config-toml.js` / `thread-backup.js` 跑**真函数**（`escapeTomlString` / `parseTableHeader` / `collectMcpServerNames` / `canonicalizeRel` / `canonicalRolloutName` / `declaredModelEfforts`），另有一条**真跑 rollout worker** 验「标题取到 `[SYSTEM TASK]` 包装里的用户原文」。
    - **⑪ 永久删除必须连磁盘 rollout 一起清（09-18 用户实测「我删除了，重启又恢复了」）**：引擎的 `thread/delete` 只把线程从**索引**里摘掉，**磁盘上的 rollout 原样留着**；而 `thread/list` 的 rollout 兜底扫描把「索引里没有、磁盘上有」的会话当权威源合回侧栏 ⇒ 删掉的会话重启后复活。用户机实测：state 库 11 条 / 磁盘 18 个 rollout，其中 **12 条**是「已从索引删除但文件还在」，侧栏那 7 个分组名与它们的 cwd 一一对应（`D:\2` 四条、`D:\Codex Harness Desktop` 五条…）。
      - **两件事**：① 清磁盘 —— worker 新增 `purge` op（`purgeRolloutFiles`，按**文件名尾部 uuid** 精确匹配，扫 `sessions/` + `archived_sessions/`；⛔ 别用 `includes` 短 id，会误伤别的 rollout）；② 记墓碑 —— `userData/deleted-threads.json`（小写 id、FIFO 上限 3000 条、**启动时**载入），`mergeThreadList` 的第 5 个参数 `hidden` 按它排除（文件被占用删不掉时靠它兜底）。
      - **两个落点**：**请求路径**（`codex:request` 里 `method === "thread/delete"` 的 `finally`，一处覆盖渲染层全部 6+ 删除入口）+ **引擎事件**（`thread/deleted`，覆盖不经渲染层的删除）。⛔ 别把收尾写进渲染层：删除入口多，漏一处就是这个 bug 复发。
      - **删除响应不等文件清理**：墓碑同步落盘后才返回，purge 走后台 —— 渲染层在 `await thread/delete` **之后**才把那一行从侧栏摘掉，若在这里等 worker 往返（大目录兜底扫描时排队，超时上限 15s）用户会看到「点了删除、那行迟迟不消失」。
      - **引擎对「索引里已无这条线程」的删除会报错**（实测原文：`failed to delete thread: thread-store internal error: failed to read session metadata …`）⇒ 这类报错按**成功**返回（本地残留已清、墓碑已记），否则用户二次删幽灵会话会看到「删除任务失败」、以为没删掉而反复点。
      - ⚠️ **墓碑不能是单向死锁**（code review 抓到的缺口）：导入会话备份时 `applySessionsBackup` **原样复用备份里的 thread id**（canonical 文件名就是 `<id>`），所以导入成功后必须 `forgetDeletedThreads`（只清 `status === "ok"`；duplicate/conflict 保留墓碑）——否则「删掉 → 再从备份导入」的会话永远不显示，且用户查不出原因。
      - **门禁**：预检 **【43】**（行为断言直跑 `dist-electron/session-tools.js` 的 `mergeThreadList`，含「**不传墓碑时一条都不排**」的防退化对照 + 接线/打包断言，反证 6/6）；真机验收 11 项（造幽灵会话 → 真实 UI 走「会话操作 → 删除 → 永久删除」→ 磁盘文件消失 → 写回文件仍不显示 → 重启不出现 → 摘掉墓碑后恢复可见）。
    - **⑫ 回合结束必须说清「为什么停」（09-18 用户实测「跑长任务老是中途自动停止」）**：取证结论 —— ①本机复现 8 轮工具调用**全程跑完**（`turn/completed [status=completed error=null]`），长任务本身不中断；②引擎 `logs_2.sqlite` 里的中止记录是 `event_msg/turn_aborted`（reason=interrupted），来源三种：用户停止按钮（日志有 `turn/interrupt → thread/resume → thread/queue/list → thread/list` 四连指纹）、语音「插话打断」（`voice-service.ts` 的 barge()）、手机端；③工具失败**不会**终止回合（`view_image 不支持`、`blocked by policy` 都被引擎回灌成 function_call_output，模型继续跑）；④真正的「处理出错」= `turn.error` 有值（引擎 `TurnError`：`codexErrorInfo` 分类枚举 contextWindowExceeded / sandboxError / rateLimitExceeded …，`misalignment.steer.message` 甚至是引擎给的继续指令）。
      - ⛔ **两个界面缺陷**（修掉了）：旧实现 `turn.error ? "处理出错" : 耗时…` 把所有错误压成四个字（不显示原因），而**被中断的回合 `{status:"interrupted", error:null}`（真机实测）走「耗时 Xs」分支** —— 界面上完全看不出被中断，用户只能理解成"它自己停了"。
      - **修法**：新增纯函数 `src/lib/turn-stop-reason.mjs`（`describeTurnStop` / `turnHeadline`，`codexErrorInfo` 分类 → 中文标签 + 处置建议 + 引擎原文；`misalignment.steer.message` 取出备用）；回合头状态词与折叠头标题用分类标签（「已停止 · 耗时 3s」「上下文超限 · 耗时 12s」），非正常结束渲染 `.turn-stop-notice` 提示条（处置建议可见、完整原文在 title 悬停；与"尚未开始回复就停止"的旧分支互斥）。
      - **门禁**：预检 **【44】** 14 条（直跑真函数断言各分类 + 「正常完成不出提示条」防误报 + **旧写法必须消失**的结构断言）；真机验收 8 项（真实跑起回合 → turn/interrupt 中止 → 断言「已停止」提示条与处置建议）。⚠️ 验收的"已产出内容"前置**不能匹配用户消息文本**（`innerText.includes("轮")` 会匹配到用户输入的「分3轮…」→ 假前置，走到另一分支）。
    - **⑬ 「正文给完了，回合还没结束」要如实说（09-18 用户实测「怎么回复完了还没结束，啥情况，要等一会，gpt模型」）**：取证 —— 该会话 rollout 时间线还原：`09:37:54.448` 正文落盘（「你好潘潘！👋 我在呢」）→ **中间 28 秒零事件**（同窗口引擎 `logs_2.sqlite` 里**零条** outgoing 事件，没有思考/工具/流增量）→ `09:38:22.5` 才 token_count + task_complete。即 **GPT 系上游（gpt-5.6-sol）输出完正文后迟迟不发流结束信号**，引擎只能干等（真机复现率约 5/6）。**这不是 harness 的 bug**，但界面此时说「正在生成回复 · 正在把收尾收拾干净」是误导——用户以为还在憋正文。
      - **修法**：新增纯函数 `isAwaitingTurnClose(turn)`（`src/lib/turn-stop-reason.mjs`）；判据三条且**宁可不显示也不误报**：① 回合仍在跑；② 回合内**任何** item 还在跑 → false（必须扫全量，否则「正文完成 + 后面还有在跑的命令」会同时显示两条自相矛盾的状态）；③ 倒序找最后一条**有正文的 agentMessage** 且它不在流式中 → true。
      - 界面**只在一处**如实显示（09-18 用户实测「这段文字会出现在『正在处理』后面，跟消息下面重复了」）：底部状态行兜底文案换成「正文已完整，等待模型收尾」，且短语池**只用专属池**（`pickRunPhraseExact`，不过通用池 —— 通用池里「正在把改动收拢干净」这类干活句会让人以为还在干活，真机采样就是这么发现的）。跨进/跨出该状态各换一次句（`turnFinalizing` 布尔量 + ref 防抖），「思考→命令→文件」之间不乱换。⛔ **计时条 `RunningProcessTime` 只管报时**（「正在处理 N 秒」）—— 曾在它后面也拼了同一句，结果同一屏里两处重复，已撤掉；预检【44】有「收尾提示只在底部状态行说一次」的函数体切片守卫（反证成立）。
      - ⛔ **判据不许用展示文案**：初版写成 `runActivity === "正文已完整，等待模型收尾"`，改文案就会静默失效、界面悄悄退回「正在生成回复」而预检照样全绿（本轮审查抓出，已改成独立布尔量 `turnFinalizing`）。
      - **门禁**：预检 **【44】** 追加 9 条（5 条行为断言含「在跑 item 排在正文之前也不算」「正文流式中不算」两条防误报 + 4 条结构守卫：**收尾提示只在底部状态行说一次**（函数体切片，反证成立）、判据收敛为一个布尔量、**不许用展示文案做判据**（须先去注释再判，注释里解释该隐患也会出现同款写法）、专属池不过通用池）；四条新守卫反证 4/4。真机验收（临时脚本：采样状态行与计时条原文 → 收尾提示只在状态行出现、计时条回归纯报时、同一时刻两处都带的样本数必须为 0；**截图必须落在收尾态当场**，放在循环之后会截到"回合已完成"的普通画面）。⚠️ 真机文案实拍：`正文已完整，等待模型收尾 · 正文给完了，模型还在做收尾确认`。
    - **⑭ 图片一律正常发送 + 后台自愈不许打断正在跑的回合（09-18 用户：「不管支不支持识图，就可以发正常的图片……就正常发图就行」）**：删掉 56da154 引入的「按模型 `inputTypes` 预判 → 把图吞掉、往消息正文塞一段面向用户的说明文字」降级分支。删它的两条依据：① 判据是本地模型元数据，**模型其实支持视觉、只是漏勾了「图片」时图被白吞**；② 那段文字是写给用户看的（「如需识图请告知用户配置视觉插件…」），却被拼进**用户消息正文**，模型照抄出来等于在气泡里跟用户讲道理（用户截图实证）。新契约：图片一律按 `localImage` 发；接入点真不支持时引擎会报错，由 `healImageModalityIfUnsupported`（回合错误路径）自动摘掉该模型的图片模态。
      - ⛔ **同一轮查出的真缺陷（用户报「会话切换一下，另外一个正在运行的会话立马就断」）**：`healImageModalityIfUnsupported` → `saveCustomDraft` → `custom-model:save` → `applyCustomModel()` → **`server.restart()`**，而 `electron/main.ts` 的注释原话是「**重启会打断所有在跑回合（app-server restarted）**」。即：任意一次带图发送失败触发的**后台自愈会重启引擎、把用户别的会话里正在跑的回合全部打断**。修法：自愈在 `runningThreadIdsRef.current.size > 0` 时**直接跳过**并 toast 说明（要么等任务跑完，要么到「设置 → 模型」手动改）—— 后台便利动作没有资格杀用户的任务。
      - **取证留痕（切会话本身不打断回合）**：真机遍历切换 8 个会话（每次**校验 `active` 行真的变了**才计入样本），引擎 `logs_2.sqlite` 窗口内 **零条 `turn/interrupt`**，A 的 rollout 里该回合**既无 `task_completed` 也无 `turn_aborted`**、且切换后仍有 turn 活动 → 切换本身不中断。⚠️ 两个采样坑：① `.thread-row` 是**外层 div、没有 onClick**（可点的是它里面的 `button`），点 div 等于什么都没做，会得出"复现不出来"的假结论；② `document.querySelector(".turn-stop-notice")` 取的是**文档里第一个**提示条，可能是**历史回合**遗留的（应用被关闭时在跑的回合下次打开就显示「已停止」），断言必须落到**最后一个回合**上。
      - **门禁**：预检 **【39】** 四条（图片一律正常发送 + 注入文案必须消失 + 自愈只在无回合运行时动手 + 粘贴入口不硬拦），**反证 3/3**（把预判分支加回去 → 红；把 `runningThreadIds` 判断改成 `false` → 红）；真机验收（临时脚本：逐帧采样两处原文证「同一时刻只有一处带该提示」，并扫 `dist/assets/*.js` 确认注入文案已从产物消失）。
    - **⑮ 切会话不再重复语法高亮（09-18 用户：「切换运行会话会有一些卡顿延迟」）**：**先量再改**——① CDP `Performance.getMetrics` 差分证明瓶颈是 **JS 执行**（空闲↔空闲那一跳 ScriptDuration 720ms、布局只有 30ms、主线程总忙 943ms），**不是**布局/滚动；② 逐会话实测发现耗时几乎正比于**目标会话的 DOM 规模**（`ms ↔ 元素数 r=0.974`，≈0.15ms/元素）：666 元素 6ms / 8001 703ms / 13554 1951ms / **23162 元素 3651ms**；③ CPU profile 抓到热点 **`Ql` 单函数自耗 2251ms**（第二名 48ms），伴大量 `appendChild`/`createTextNode` —— 它正是 `react-syntax-highlighter` 的 `create-element`（把高亮 AST 递归建成 React 元素）。根因：切换会话时消息列表**卸载再挂载**，`MdCode` 虽是 `memo` 也救不了（memo 只在组件保持挂载时生效）⇒ 每段代码重新高亮。
      - **修法**：库本身暴露 `renderer` prop（默认实现就是那个递归函数），给它接一层**按内容寻址的 LRU**（`src/lib/code-highlight-cache.mjs`，纯逻辑、可离线断言）。键必须覆盖所有影响高亮产物的输入（语言+代码+主题+行号+换行），漏一个就串键（不同代码命中同一元素树 = 高亮错乱）。三处高亮都接（对话代码块 `MdCode` / 命令输出与 diff `ToolCodeBlock` / 文件预览 `FilePreviewCode`）；React 元素不可变、可在多处挂载 ⇒ **零外观变化**。
      - ⛔ **两个必须守住的边界**：① **逐字流式期间不写缓存**（流式的形态是「本次文本 = 上次文本 + 追加」，每帧一个 never-again 的新 key，照单写入会把别的会话攒下的条目按 LRU 挤掉）；② **单块上限别设小**：第一版设 60000 字符，而真机那个会话 **13346 个元素里 11163 个（84%）来自同一个 66838 字的代码块**——恰好吃不到缓存，那个会话每次切换照样 1.4 秒。现在单块 200k / 总量 600k 字符（`totalChars` 淘汰时同步扣减，`set` 同键不重复计账）。
      - **结果（真机）**：13769 元素会话 **1913ms → 145ms（13.2×）**；66838 字大块所在会话稳定 **148~183ms**（修复前 1393ms）；缓存 `hits=321 / misses=26`。**首次**打开某会话仍要付一次真实高亮（约 1.5~1.9 秒，不可避免），第二次起才走缓存。
      - **门禁**：预检 **【45】** 21 条（键的 7 条区分度/串键防护 + LRU 行为 6 条含总量扣减与同键不重复计账 + 长度窗口 3 条 + 接线 5 条），**反证 5/5 成立**；真机验收 5/5（聚焦目标会话三次切入、并断言会话内不再有超上限代码块）。
      - ⚠️ **本条踩到的两个测量坑（都会给假结论）**：① **rAF 在 e2e 不可见窗口里被节流**（`frames=0`），测帧间隔要用 CDP Performance 指标做差分；② 侧栏**按最近活动重排**，按 `rows[i]` 点会点到别的会话（第一版据此报出"运行中会话切回 1.6 秒"，实为索引漂移的假象——按标题定位后实测只要 29ms）。另外**反证要改到点子上**：第一版 hooks 守卫写成"存在某个 hook 在 return 之前"，因 `useCodeSettings()` 恒在函数开头而**恒真**，反证时把 hook 挪到 return 后它照样绿 ⇒ 判据必须改成「return 之后那段里没有 hook」。
    - **⑯ 代码块懒高亮 + 图片查看项折叠 + 用户附件行位置（09-18 用户三条连报）**：用户原话「不能懒加载嘛，我又没点开看代码高亮，为啥要每次切换都重新加载一遍呢」+「图片和文件会在用户名字上面」+「都靠右，自适应排序啊，靠左多丑」。
      - **懒高亮**（缓存之外的第二步）：只对**大块**（≥1500 字符）启用——进视口邻近区（共享 `IntersectionObserver`，`rootMargin: "1200px 0px"`，触发后一次 `unobserve`）之前渲染"等价外观纯文本"（底色/字体/行高取自主题的 `pre[class*="language-"]` / `code[class*="language-"]`，**不闪白**），进区后换真高亮。三处接线（`MdCode` / `ToolCodeBlock` / `FilePreviewCode`）；小块直接高亮（不给所有代码块引入颜色跳变风险）；逐字流式期间不启用。
        - ⛔ **判据必须用「按裁剪祖先裁剪后的可见矩形」**：真机诊断里一个大块 `top=233/bottom=465`（看着在 800px 视口内）却让**新建的** IntersectionObserver 报 `isIntersecting: false`——它在折叠容器里（`.wb-fold collapsed` height=0 + `.cmd-card closed`）。**未裁剪的 `getBoundingClientRect` 会谎报"在视口内"**（第一版断言就是这么假红的）。正向验证的正确形态 = 展开全部折叠（`.wb-fold.collapsed > .wb-fold-header` + `.cmd-card.closed > .cmd-head`）后断言「待命块归零且大块有 >50 个高亮 token」；真机实测展开后 `pending=0`、最大块 **5127 个 token span**。
      - **图片项折叠**：`imageView`（agent **查看**图片）从 `keepVisible` 改 `foldable` —— 逐张查看目录图片时一张一个常驻大图，把消息区铺满（真机记录：单回合 3 张、单会话 12 张）。查看是**过程**（随过程折叠），生成才是**产出**（`imageGeneration` 仍常驻）。同时给 `toolRunMeta` / `foldAtomOf` 补 `imageView` 分支（分组 `read`、标签「查看图片」），否则摘要显示「处理多个步骤」看不出在干什么。
      - **附件行位置与排版**：`attachRow` 原排在 `.user-message-stack` **第一个**位置 ⇒ 渲染顺序是「附件 → 名字/头像 → 正文」，附件跑到用户名上方。改为「名字/头像 → 正文 → 附件」；行内**不分图片/文件左右两组**（用户明确否掉了"图片靠左"这个方案），按原始顺序排列 + `justify-content: flex-end`（都靠右）+ `flex-wrap: wrap`（多了自动换行）。
      - **门禁**：预检 **【46】27 条**（懒加载阈值与边界 3 + 兜底样式 2 + 接线 3 + 图片折叠 4 + 附件内联 9 + 附件名纯函数 4 + 其余结构守卫），**反证 11/11 成立**（6 条附件内联 + 5 条早前条目）；真机验收 **13/13**（懒高亮 3 + 多附件内联排版 5 + 内联形态 8/8，含"展开折叠后大块必须真高亮"这条正向控制——防的正是"懒加载变成永远不加载"这种反向 bug）。
      - ⛔ **附件行的三版弯路（用户三次纠正，别再走）**：① 附件排在 `.user-message-stack` 首位 → 渲染成「附件 → 名字 → 正文」，用户：「文件和图片会在用户名字上面」；② 改为**气泡下方单独一行、整行右对齐** → 用户：「谁让你单独一行靠右了」；③ 中间还试过**方形缩略图**（64px）与**自造长条 chip** `.user-attach-chip` → 均属"另起一行"，形态与输入框不一致，被否决。**定稿**：附件 chip **内联在正文文字流里**，直接复用输入框的 `.composer-image-chip-inline`，判据是「发送前在输入框里看到的样子 == 发送后消息里显示的样子」。教训：**这类"看起来长什么样"的需求，别自己发明布局——去复用用户已经在用的那个组件**（他说"像输入框那样"时，字面照做即可）。
      - ⚠️ 本条踩到的三个测量/断言坑：① **`getBoundingClientRect` 会谎报"在视口内"** —— 折叠容器（`height: 0` 的祖先）里的元素 rect 照样算得出坐标，但新建的 `IntersectionObserver` 会正确报 `isIntersecting: false`；断言懒加载必须用 IO 的视角、或核对祖先链。② **对照物不存在时断言会恒真**：验证"消息侧 chip 外观 == 输入框侧"时，发送后输入框已清空 → `composerChipStyle` 为 `null` → 我的三元回退成 `true` = 假绿；改为**页面内注入一个同类隐藏元素量同一份 CSS**。③ **夹具重复会让断言假红**：内联附件按路径去重（同一文件重复发不显示两份），第一版用重复路径造"16 个附件"只得到 5 个，于是"没换行"是我的夹具问题，不是实现问题。
      - ⚠️ 另记一条真机实测的 CSS 坑：给附件行加 `margin-left: auto` 会让它**在交叉轴上失去 stretch**，宽度从满宽塌成 fit-content（实测 720px → 415px），`flex-wrap` 于是永远等不到换行时机——"靠右"只能靠 `justify-content: flex-end` + 满宽容器，别用 auto margin 做"双层保险"。
      - **代码审查抓到的真缺陷（已修）**：`attachChipName(part, src)` —— 图片 part 有三形态（`path` / `data:` URL / `http(s)` URL），原先直接 `basename(part?.path ?? src)`，遇 data URL 会显示成 `q842iQAAAABJRU5ErkJggg==`（base64 尾巴）。已抽成 `src/lib/attach-chip-name.mjs` 纯函数（4 条离线断言 + 2 条结构守卫钉死）。
      - **图片显示 src 归一化（09-18 同轮修的第二个真缺陷）**：三处都写 `path.startsWith("http") ? path : imageUrl(path)` ⇒ **data URL 被当成本地路径**去拼 `harness-image://`，灯箱与悬停预览全部打不开（粘进来的图很多正是 data URL 形态）。已抽成 `src/lib/image-src.mjs`（`imageDisplaySrc` / `localImageUrl`，双重编码细节与理由都在这），`imageUrl()` 退化成一行转发。**守卫【47】的关键一条是"不许再出现 http-only 三元"，按原文匹配会把注释里解释该隐患的那行也算上 → 必须先剔除注释行再数**（当天实测的假红）。
      - **内联图片的悬停小预览（09-18）**：`.message-attach-preview` 绝对定位浮层挂在 chip 内，`max-width/max-height` 只给上限、宽高都是 auto ⇒ 浏览器按原始宽高比缩放（横竖图都不用写分支）；`pointer-events: none` 保证不挡自身 hover/click；`cursor: zoom-in` 提示可点开大图。
        - ⛔ **必须带方向判定**：聊天区的 `.timeline` 有 overflow 裁剪，靠近顶部的消息若硬往上弹，预览会被切掉上半截（实测 `top: -101`，等于看不见）。判定取**最近的滚动/裁剪容器**的上沿为界（不能拿视口顶或写死 0），空间不足加 `preview-below` 翻到下方。
        - ⛔ **指针点击后要 `blur()`**：chip 留着焦点时 `:focus-visible` 会让小预览继续挂着 → 「点开大图 → Esc 关掉 → 小预览又自己冒出来」（Esc 属键盘操作，还会把 Chromium 切到键盘焦点渲染模式，让刚点过的按钮开始命中 `:focus-visible`）。判据 `event.detail > 0` 区分指针与键盘激活，键盘激活保留焦点给无障碍。
        - **门禁**：预检 **【47】23 条**（纯函数 9 + 结构 8 + 方向/焦点 6），**反证 13/13 成立**；真机验收 **30/30**（未悬停隐藏 / 悬停可见 / 两种比例各自保比例 / 图片真加载 / 不占布局 / 完整落在裁剪容器内 / 强制贴顶自动翻转 / 点击开灯箱且图片真加载 / Esc 关闭且不残留焦点 / data URL 形态能预览）。
      - ⚠️ **预检"会静默截断"是本轮最危险的坑（09-18 实测）**：预检是平坦脚本，中途一处 `ReferenceError`（我删了局部变量 `inlineBody` 的定义却漏改引用）会让**它之后的所有断言不执行**，进程照样 exit 1；外部只过滤「✗ 行」就会读成"除预期那几条红外全绿"——当时【46】后半与整个【47】从未跑过。**已加兜底**：`uncaughtException` / `unhandledRejection` 捕获后打一条显式 ✗、末尾打印「已执行断言数」。**读预检结果必须同时看这一行**，缺失即截断。
      - ⚠️ **反证脚本必须能区分「守卫变红」与「断言根本没跑」**：只找 `✗ 行` 会把"没执行"误判成"反证失败"（当天第一次跑出 9/9 全绿就是这个原因）。判据：① 结果里必须有「已执行断言数」；② 必须找到目标标签行，找不到要显式报「反证无效」。
      - ⚠️ **夹具图片必须本地生成、当场存在**：第一版悬停验收用了 `.workbuddy/clipboard-images/` 里的图，跑到一半该文件已被清理 ⇒ 图片加载失败（`naturalWidth=0`），**看起来像实现坏了，实为夹具坏了**。已改为脚本内生成的 600×900 / 900×300 两张 PNG（顺便覆盖"横竖两种比例的自适应"）。
      - ⚠️ **悬停类断言要"重测 + 重试"**：消息会触发真实回合、时间线在滚动增高，测到的坐标到派发鼠标事件时可能已失效 → 鼠标没落在 chip 上 → 误判"悬停没生效"。做法：派发后回读 `opacity`，不是 `1` 就移开鼠标重测重试（最多 5 次），并在日志里标出重试次数。
      - ⛔ **新增 overlay 必须接进「统一 Escape 管线」**（09-18 新增 `pasted-text` 大窗口时踩到）：App 层有一份长长的 `closers` 列表（`filePreview` / `lightbox` / `settingsOpen` / …），所有 overlay 的 Esc 关闭都由它驱动。新弹窗要①加一行 closer ②加进依赖数组；需要"关窗前先保存"这类副作用时用**模块级回调**（组件挂载时注册、卸载时置 null），组件内的 `useCallback` 拿不到。**别在组件里再自带一份 `window.addEventListener("keydown")` 处理 Escape** —— 两条链会各关一次，而且它更难被验收脚本触发。
      - ⛔⛔ **CDP 注入的键盘事件在 textarea/contentEditable 聚焦时投递不可靠**（09-18 排查"Esc 关不掉"绕了七八轮的根因）：同一个 `Input.dispatchKeyEvent(keyDown, Escape)`，**焦点在 `BODY` 时应用收得到、焦点在 `TEXTAREA` 时完全收不到**；而同一时刻页面内 `window.dispatchEvent(new KeyboardEvent("keydown", …))` 应用**能**收到。⇒ **键盘快捷键验收一律用页面内派发，不要用 CDP 注入**（真机按键不受影响，这是测试通道限制）。排查这类"处理器像没生效"的问题，**先在处理链里打点**（写进 `window.__dbg`，测完读出来），一次重建即可分辨「压根没被调用 / 被调用但异步卡住 / 执行了但状态没变」——比连猜七八轮快得多。

      - **文件附件改为输入框内联 chip（09-18，用户：「把文件展示不要在输入框上面了，改成在输入框里面的 chip，跟图片一样的展示」）**：图片原本走 `[图片:path]` token + contentEditable 内联 chip，文件却是**独立状态 + 输入框上方一条 `.attachment-strip`**（128×58 方块卡）。改成与图片**同一套机制**：
        - 新增 `[文件:path]` token，两种类型共用 `src/lib/composer-attachments.mjs`（token 格式、解析、插入、剥离、去重全在一处；`prompt-images.ts` 退化成转发，只保留图片专用窄 API）。
          ⛔ **图片 token 的格式必须逐字节保持不变** —— 已发出的消息文本里存着 `[图片:<enc>]`，改了格式老消息的图就解析不出来。
          ⛔ **消息渲染层只认图片**：`splitAttachmentSegments(text, { kinds:["image"] })` 会把 `[文件:…]` **原样算作文本**，否则用户正文里会凭空少一段且无人报错。
        - `files` 状态**整体删除**，改为 `attachedFiles = useMemo(() => promptFilePaths(prompt), [prompt])` —— "输入框里看到的 chip"与"发送出去的附件"天然一致，不会出现状态与文本不同步。
        - 发送时把文件 token 从正文剥离，仍拼成既有的 `[附件文件]` 段（**模型侧协议没变**，只改了用户看见的形态）。
        - chip 往返统一用 `data-attach-kind` + `data-attach-path`（旧的 `data-image-path` 已并入，只此两处引用）。
        - 门禁：【48】48 条（纯函数 20 + 结构 20 + 安全 8），**反证 14/14 成立**；真机验收 20/20。
      - **粘贴超 200 字自动转 .txt（用户：「复制的内容超过 200 字的时候把文本直接显示成一个 .txt 文件的方式」）**：新增 IPC `pasted-text:save`（**不能复用 `fs:write`** —— 那个限定只能写工作区内，粘贴文本写进用户项目目录会污染仓库；落点放应用自己的 `userData/pasted-text`）。阈值与判据是纯函数 `shouldSavePastedTextAsFile`（**按 trim 后长度**判定，纯空白不转）。文件名**按内容哈希**（同一段文本粘两次得到同一个文件；用时间戳会堆出无限副本）。
      - **`.txt` chip 大窗口预览 + 编辑（用户：「要支持打开大窗口预览，而且要可以编辑，方便我修改」）**：新增 `PastedTextEditor`（模块级组件）。三条纪律：
        ① **只有应用自己保存的粘贴文本才可编辑** —— 主进程 `pasted-text:read` 直接返回 `editable`，渲染层**不靠路径前缀猜**（猜错会把用户自己目录里的同名 .txt 当可编辑，一保存就改了他的文件）；读/写通道都做了"必须在 `pasted-text` 目录内"的校验，否则等于给渲染层任意文件读写。
        ② **关窗即存**（Esc / 点遮罩 / 点关闭，改过就自动保存并提示）——编辑的是应用自己的临时文本，丢改动比多存一次更糟。
        ③ **保存不改名**：文件名里的哈希表示"创建时的内容"，编辑后不重算（重算即改名 → 已发出消息里引用的旧路径断链）。
      - **输入框高度**：既有 `min-height: 48px / max-height: min(42vh,360px) / overflow-y: auto` 经验证已满足"自适应 + 有上限 + 到顶内部滚动"（真机实测：空 48px、6 行 134px、200 行 336px 到顶且 `scrollHeight 4478 > 336`），本轮**未改动**，只补了断言把它钉住。
      - **切会话后运行计时重置（用户：「切换会话，正在处理那个时间，切出去切回来，时间就重置了」）**：**同一类根因的第二个实例**——与"切会话重复语法高亮"一样，切会话会把消息区**整体卸载再挂载**，而计时起点原本存在组件内部的 `useRef(Date.now())`，卸载即归零 ⇒ 重挂载重新取一次 `Date.now()`，计时从 0 重数。修法：起点按**回合 id** 记忆进一个**跨挂载存活**的表（`src/lib/run-clock.mjs`，模块级单例 + 容量上限 + LRU 提热度），`RunningProcessTime` 改收 `turnId`；回合结束（`running` 转 false）时 `forget`。
        - ⛔ **不能改成「卸载时清理」**：切会话正要靠这条记忆**跨过卸载**，cleanup 里清等于本 bug 原地复活（守卫已专门盯住这一点）。
        - ⛔ **命中必须提升热度**：长期在跑的回合每秒都在取起点，若不提热度会被后续新回合挤出表 → 切回来又归零。**「容量上限」那条断言区分不出有没有提热度**（插入顺序恰好使得淘汰最久者也是无提热度时的结果），必须另写一条专测（`x` 命中后插 `z`，该淘汰 `y` 而不是 `x`）。
        - 与既有 `turnStartedAtRef` 职责看着重叠、**刻意不合并**：那张表是引擎事件驱动（起点取 `turn/started`），埋在 1MB 主组件里、无上限、不可离线断言；本表是 UI 报时自持的纯逻辑。合并会让「reasoning 耗时结算」与「界面报时」互相牵制。
        - 沿用既有决策：**只用本地秒表，不读引擎时间戳**（`Turn.startedAt` 存在但单位历史上混过）。
        - 门禁：【49】13 条（纯函数 9 + 结构 4）。**反证分两层**：① 离线守卫 **10/10**（含"起点退回组件 useRef""改成卸载时清理"两条正是本 bug 的成因）；② **真机判据反证**——把修复摘掉重建后跑验收，切回后显示 **0 秒**（修复版同场景 **11 秒**）⇒ 判据确实测得出这个 bug。
        - ⚠️ 反证脚本锚点里的换行**必须写 `\r?\n`**，不能写死 `\r\n`：本仓库老行是 CRLF、Edit 新插入的行可能是 LF，写死会让替换静默失配 → 「改动未生效」被误读成「反证失败」（本轮 3 条先报"反证失败"，实为未生效）。
      - **附件名含方括号 → 协议文本泄漏进气泡（09-18 用户截图实证）**：`[附件文件]` 段的结束标记正则写成 `(?:\[附件结束\]|\[[^\]]+\]|$)` —— 那个 `\[[^\]]+\]` 分支**允许行中任意方括号**就收尾，于是文件名/路径里带方括号（`22 钛光金 [最终版].png`、`素材[1]\a.png`）会把段**在行中间切断**，残留的 `.png` 与 `[附件结束]` 被当成用户正文渲染。修法：结束标记**必须独占一行**（`\r?\n\[…`）—— 附件列表每行都以 `- ` 开头，真标记必然整行，既不误伤又修好 bug。三处同构正则（附件/技能/上下文）一起改。
        - ⛔ **必须写 `\r?\n` 而不是 `\n`**：仓库行尾是 CRLF，只写 `\n` 会让 CRLF 消息最后一行的 `\r` 留在 group1 行尾 → 行正则 `^-\s+(.+)$` 失配 → **文件数变 0**（我第一版就是这样，靠断言才发现）。
        - ⛔ 诊断手法值得复用：把「从源码里取出真实正则再跑」——`const fileMatch = clean.match(/…/)` 用正则抠出来 `new RegExp(…)`，测的就是仓库里那个正则本身，而不是手抄一份（抄一份会漂移、抄错也照样绿）。
        - 门禁：【50】19 条（含 7 条真机同款用例的行为断言 + 3 处正则结构 + 停止行为 9 条），**反证 8/8 成立**。反证时踩到两条「反证没打全就误判守卫太松」：① 去掉 CRLF 容错只改了第一个分支，第二分支仍兜住 → 断言照绿；② `defaultOpen` 有**两条**完成态渲染分支，只改一处 → 断言照绿（判据已改成"≥2 处"）。
      - **点停止后过程与内容保留 + 「用户已停止」标记（09-18 用户：「用户如果点了停止，运行过程和内容要保持在，方便用户继续任务，在最新内容后面加一个用户已停止」）**：
        - 取证先行（临时脚本）：点停止后**内容本来就没丢**（正文 955→1491 字、命令卡 2→4、折叠组内 5/9 项都在 DOM 里），真正的两个问题是**过程被折叠成一行**（用户看不到做到哪了）与提示条在**最前面**（不在内容之后）。
        - 修法：`userStopped = Boolean(interruptedAt)`（该值只由本机 `interrupt()` 写入 ⇒ 可靠区分"用户点的停止"与语音插话/手机端/引擎中止）；置真时 ① `TurnFoldStream` 的 `keepProcessOpen` 让过程组**默认展开**；② 在**最新内容之后、操作栏之前**渲染「用户已停止」标记。
        - ⛔ **顶部通用中断提示要与标记互斥**：那条列举「你点了停止/语音插话/手机端停止」三种可能，用户自己按的却要读一段猜，且与末尾标记重复说同一件事 ⇒ `!userStopped` 时不再渲染。非用户触发的中断仍照旧给原因与处置建议。
        - ⛔ 标记里**不重复耗时**：过程组标题已写「已停止 · 耗时 36 秒」，标记再写一遍就是同屏两处（用户对重复文案零容忍）。
      - ⚠️ **真机验收脚本自身的三处缺陷（09-18 踩到，记以免重犯）**：① **读状态前先等就绪**——侧栏还没加载完就 `querySelector(".thread-row.active")` 会拿到 `null`，后续"按标题切回"搜的变成字符串 `"null"`，必然找不到 ⇒ 先 `waitFor(会话行数 ≥ 2)`；② **点击后要轮询到状态真的变**（切会话要等数据加载，不能只 `sleep(600)` 就读 active）；③ **发消息前先停掉在跑的回合**，否则新消息排队、计时条迟迟不出现（第 3 轮就这么"前置不成立"的）。
        - ⚠️ **第 ④ 处（09-18 追加，最坑）**：验收脚本里「点停止」的**时机**必须紧贴"确认真在运行"那一刻 —— 我为了等"内容够多"轮询了 60 秒，而那个任务 10 步命令几十秒就跑完了 ⇒ 轮询结束时 `is-pause` 按钮已消失，`click()` 落空、回合**自然完成**，于是断言报「没有停止标记」。用专门的诊断脚本（逐秒打印 `userStopped/timer/pause`）一次就看清：**点停止后 1 秒标记就已出现**，实现是对的、是验收脚本点晚了。**结论：判定"某 UI 元素没出现"之前，先确认触发动作真的发生了。**
      - ⛔ **结构守卫必须剥注释（09-18 一天踩三次）**：本仓库习惯在注释里写清"某个写法已删除/别再恢复"，而"不许出现 X"的守卫按原文匹配会把**注释里提到 X** 当成 X 还在 → 报假红。已在 `check-preflight.mjs` 加了 `codeOnly()`（剥 `//` / `/* */` / `{/* */}`）统一处理：`startsWith("http") ? … : imageUrl(…)`、`.attachment-strip`、`getBoundingClientRect().top` 三次都是这个原因。**任何"不许出现 X"的断言，匹配前先过 `codeOnly`。**
      - **模型列表删除（用户报「没勾选的删不掉／删掉了勾选的」）：本轮未能复现，做了什么要说清** —— 开发版上跑了 6 个场景（逐行删除 / 勾选框 / 批量删除 / 批量删除+保存+重启 / 删掉"当前生效"的模型+保存 / 加同名 id），**全部正确**。按"症状能找到的机制"做了两处加固：① **重名 id**：`saveModelEditor` 的本地合并分支原先只按 `originalId` 过滤 ⇒ 「添加模型 / 改名撞上已有 id」会留下**两份同 id 条目**，而列表渲染去重（只显示第一条）、删除与批量删除作用在**全部副本**上——这正是"删一次把别的那条带走了"的机制（已按 id 归一 + toast 说明）；② 澄清：保存路径不会复活被删的模型（`normalizeProvider`/`withModels` 只在 `entry.model` 不在列表时补，而渲染层在删除生效模型时已把 `model` 改指下一个可用模型；实测删掉生效的 `gpt-5.6-sol` 后磁盘正确变为 `[luna, terra, astra]`、`model=luna`）。**若再复现，先要"操作级步骤"**：设置页那一排有 4 个同区图标（全选 / 取消全部 / 批量移除未勾选 / 刷新列表），其中刷新（`probeProvider("list")`）会把探测到的新模型以 `enabled:false` **追加**进列表、行数会变 —— 按肌肉记忆点"第 N 行"很容易删错。

