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
| ① 离线预检 | `npm run check` | 构建 + **产物新鲜度** + IPC 三件套一致性（main.ts handler ↔ preload 桥接 ↔ vite-env.d.ts 方法面）+ CSS 类覆盖告警 + **纯函数行为断言**（`src/lib/*.mjs`，node 直接 import 跑真实现） | 改了没重建 / 桥接漏了类型 / 有死链 / 判定逻辑跑偏 |
| ② UI 场景（**默认跑全部**） | `npm run e2e` | 自动拉起**已构建**应用逐个跑 `scenarios/*.mjs`，逐步截图到 `.e2e-artifacts/shots/`（文件名带场景前缀） | 界面真破了相（看截图即知） |

四条纪律：

1. **只跑一半不算验收**。`check` 过但 `e2e` 没过 = 没完成，不许提交。
2. **改了哪个模块，就给哪个模块补/改场景**。在 `scripts/e2e/scenarios/` 加 `<名>.mjs`（导出 `steps` 数组）或往现有场景加步骤，或给 `scripts/check-preflight.mjs` 加检查项——**让这次验证沉淀成下次的自动回归**，不许写成一次性脚本跑完就丢（这正是 09-06 那批 `verify-*.mjs` 全员消失的教训）。`npm run e2e` 不带参数即跑全部场景，新场景自动进门槛。
3. **断言必须带前置条件**（先断言「弹窗是关的」再点开），否则上一步的残留状态会导致假通过。
4. **新断言的正确性当场反证一次**：把修复临时改回去，确认断言真的会红。永远绿的断言等于没有断言，尤其「XX 没生效」类 bug。（`model-scope` 实测过两次：把判定改成「全局永远赢」→ 步骤③/⑤ 红；把 `openThread` 改回「只认会话记录」→ 步骤④ 红。）

GUI 起不来时，最低限度跑 `check`（离线可用），并在提交信息里写明 `e2e` 未跑的原因。手册见 `docs/TESTING.md`。

### 引擎自己怎么跑验收（已实测）

引擎跑在应用体内，而 `e2e` 会**再拉起一个隔离实例**——不会和自己撞车。实测依据：单实例锁按 `userData` 隔离，E2E 用临时 profile，两实例完全独立并存（A 窗口里的 `window` 标记 B 读不到，两个进程都存活）。

```bash
# 用随包 node，不依赖 npm（引擎环境最稳的一条）
resources/tools/node/node.exe scripts/e2e/run.mjs           # 全部场景
resources/tools/node/node.exe scripts/e2e/run.mjs smoke     # 只跑指定场景
resources/tools/node/node.exe scripts/e2e/run.mjs --list    # 列出全部场景
```

`npm run check` / `npm run e2e` 亦可，前提是 PATH 里有 node。**E2E 跑的是 `dist/` + `dist-electron/` 产物，必须先构建**——`check` 已含构建；只跑 `e2e` 前先确认产物不过期。

## 这是什么

一个 Electron 桌面应用，把 OpenAI Codex 引擎（`@openai/codex` app-server，stdio JSON-RPC）封装成可用的桌面工作台：多会话、插件/技能、自动化工具、连接器（MCP）、记忆分层。

## 内置能力（引擎可直接用，无需额外安装）

| 能力 | 入口 | 说明 |
|---|---|---|
| 引擎本体 | `app-server --listen stdio://` | 会话、工具、插件、钩子、技能全部走它 |
| 基础运行时 | `resources/tools/{node,python,git,pwsh,vscode-cli,rg,uv,cmake,ninja,sevenzip,jq}` | 已内置随包，**不要**再联网装 |
| 桌面自动化 MCP | `tools/npm-global` 里的 `nuphus`（MCP 服务器名） | 需先装「自动化工具包」，工具前缀 `desktop_*` / `browser_*` |
| 浏览器自动化 CLI | `tools/npm-global/playwright-cli` | 需先装「自动化工具包」，首次 open 会提示装内核 |
| 指纹浏览器 | `require("cloakbrowser")` / `tools/npm-global/cloakbrowser` | 需先装「自动化工具包」+「Cloak 内核」 |
| 内置技能 | `codex-home/skills/` 的 `desktop-automation`、`browser-automation` | 随应用写入，引导引擎调自动化工具 |

## 会话动态工具（thread/start 已注册，可直接调用）

| 工具 | 用途 |
|---|---|
| memory_recall / memory_save | 查询/保存分层记忆（用户偏好/项目背景/工作流/任务经验）；发送前应用会自动注入相关记忆 |
| generate_image / describe_image | 生图与视觉识图（需在 设置→插件→内置插件 配置，未配置时调用会返回指引） |
| rpa_save / rpa_run | 保存自动化流程为 RPA 配方 / 列出并执行已存配方（逐步复现） |
| task_add / task_update | 维护用户任务清单（新增/改状态/列出/删除） |
| agent_ask | 向用户展示选项卡等待选择（第一项为推荐），用于关键决策确认 |

## 工具链清单

**随包内置（离线可用，勿重复下载）**：Node、Python（含 Tkinter/requests/flask/fastapi/playwright）、Git、PowerShell 7、VS Code CLI、ripgrep、uv、CMake、Ninja、7-Zip、jq。

**按需安装（应用内「开发工具」页 或 手动）**：

| 工具 | 大小 | 安装方式 | 装完效果 |
|---|---|---|---|
| 桌面与浏览器自动化（nuphus + playwright-cli + cloakbrowser 包体） | zip 18MB | 开发工具页点「下载」→ 自动解压 zip 到 `tools/npm-global/` → 自动激活桌面/浏览器自动化联动开关 → 引擎重启生效 | nuphus MCP 注册 35+ 工具；playwright-cli / cloakbrowser 可用 |
| Playwright 浏览器内核 | ~170MB | 开发工具页「下载」（需先装自动化包） | playwright-cli 首次 open 不再提示缺内核 |
| Cloak 指纹浏览器内核 | ~200MB | 开发工具页「下载」（需先装自动化包） | cloakbrowser 可开反检测窗口 |
| ponytail 写代码模式插件 | 随包 2MB | 开发工具页「下载」→ 种到引擎插件 cache + 注册段 | 会话钩子 + 6 个 ponytail-* 技能 |
| FFmpeg / yt-dlp / Miniconda / MinGW | 各 20~300MB | 开发工具页「下载」（联网） | 对应命令可用 |
| Docker Desktop / OpenSSL | — | 系统级安装（开发工具页打开官网） | 系统命令 |

## 安装操作（引擎缺工具时怎么自助装）

1. **优先看 `tools/` 目录**：`resources/tools/npm-global` 存在 = 自动化工具已装；`tools/{node,python,git,...}` 存在 = 基础运行时已装。
2. **缺自动化工具包**：调用应用内 `runtime:install`（id=`automation`），或手动：
   - 解压随包 `tools/automation-tools.zip` 到 `tools/`（内置 python：`python -c "import zipfile; zipfile.ZipFile('automation-tools.zip').extractall('tools')"`），结果得到 `tools/npm-global/`。
   - 重启引擎（或重选一次供应商触发 `applyCustomModel`）→ nuphus MCP 段写入 config.toml。
3. **缺 Playwright / Cloak 内核**：`runtime:install`（id=`playwright-browsers` / `cloak-browsers`），会分别调 `playwright install chromium` 与 `cloakbrowser install`。
4. **缺 ponytail 插件**：`runtime:install`（id=`ponytail`），随包安装源 `tools/ponytail-plugin` 种到 `codex-home/plugins/cache` + 写 `[marketplaces.ponytail]` / `[plugins."ponytail@ponytail"]` / 钩子信任。
5. **装完统一**：重启引擎生效；插件/技能/钩子状态从 `plugin/list`、`skills/list`、`hooks/list` 读。

## 验证基建实现细节（配合开头的「验收铁律」看）

- **E2E 靠主进程自带开关实现**：`CODEX_HARNESS_USER_DATA`（重定向 userData，完全隔离）+ `CODEX_HARNESS_DEBUG_PORT`（开 CDP 端口，端口随机取空闲）——见 `electron/main.ts:60` / `:65`。框架 `scripts/e2e/lib/harness.mjs` 零新依赖（复用 `ws`），**不要引入 Playwright/Puppeteer**。
- **离线预检**：`npm run check` = `build` + `scripts/check-preflight.mjs`。其中 IPC「方法面」解析用自写的括号深度扫描器（纯正则会被「同一行写多个方法 `a: …,  b: …`」和「类型里的 `name(...)` 括号被吃掉后参数名被误当方法名」骗到）。
- **现存场景**：`smoke` 覆盖引导页 → 主界面骨架（`.topbar`/`aside.sidebar`/`main.workspace`/`.composer-editor`/`.send-button`）→ 侧栏六项 → 输入框读写 → `#` 技能面板 → `/` 命令面板 → 技能中心开关 → 右栏展开 → 设置弹窗开关 + 焦点归还 → 渲染层无 console.error。`model-scope` 覆盖**每个会话独立选模型**（真起引擎真建 **两个**会话，重载渲染层让 `openThread` 跑一遍）：③ 有记录 → 不被全局冲掉、且不改写全局默认；④ 没记录 → 落全局默认；⑤ 打开 B 不动 A。
- **环境坑（踩过）**：①环境里的 `HTTP_PROXY` 会把回环请求也代理走 → harness 已自动注入 `NO_PROXY=127.0.0.1,localhost`；②`ws` 库的 `on("message", (data) => …)` 首参是**原始数据**不是 `MessageEvent`；③`clickByText` 必须取**最内层**元素（按 innerText 长度升序），否则点到 wrapper 上；④`contenteditable` 用 CDP `Input.insertText` 输入，`[contenteditable="true"]` 匹配不到 `plaintext-only`；⑤**宿主带着 `ELECTRON_RUN_AS_NODE` 时 Electron 会被降级成纯 node 跑主进程**（启动即崩 `Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')`，栈尾打 `Node.js vXX`）→ harness 在 spawn 前 `delete` 掉这个变量；⑥**引擎的 rollout 是首回合才落盘的**：只 `thread/start` 的会话 `thread/resume` 报 `no rollout found`、`thread/list` 里也不出现 → 想造「能 resume 的会话」必须补一发 `turn/start`（模型调用失败无妨，rollout 已落盘）。
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

- **模型选择的作用域：每个会话独立**（09-11，用户两轮反馈——先是「我切换的模型没生效」「思考又是英文」，再是「每个会话独立模型选择为啥也不行」；纯逻辑 `src/lib/model-scope.mjs`，回归场景 `model-scope`）：
  引擎 `thread/resume` **不回带 model**，模型由客户端每轮 `turn/start` 的 `model` 字段下发（rollout 的 `turn_context.model` = **该回合真正跑的模型**、`thread_settings_applied.thread_settings.model` = 会话级设置，两者是唯一权威判据），所以模型必然是会话级状态。
  **返工史（别再走回头路）**：第一版 `openThread` 无条件用会话记录 → 改了全局默认，打开旧会话仍跑老模型；第二版改成「谁后改谁生效」（时间戳）→ 治好了上面，但**改一次全局默认就把所有旧会话的模型冲掉**，与「会话独立」直接冲突。**定稿只有两条规则**：① 打开会话：该会话自己的记录优先，它还没记录（新建/从没选过）才用全局默认；② 改全局默认：写全局（新会话用），**若此刻有会话打开只同步这一个**，其它会话一律不动。落地上给所有「改全局默认」的动作收敛到唯一入口 `applyGlobalModelChoice`（设置页生效模型/一键切中转站/官方订阅/登录导入/重启生效落定/无会话时选模型），`default-model` 全仓库只有这一处写入（预检有守卫断言）。
  **「模型自报」误导案（09-11 第三次反馈「下拉框就是摆设吗」）**：用户切了下拉后问模型「你是什么模型」，模型自报旧模型——但 rollout `turn_context.model` 证明引擎已真跑新模型。根因：模型不知道引擎层的模型名，被问时会去读 `custom-model.json` 自查，而顶层 `model` 字段从不跟着下拉更新。修复：`chooseModel` 同供应商分支选完模型后 `setProviderModel(apply:false)` 同步档案文件（只写 custom-model.json，不重写 config.toml、不碰引擎）；config.toml 顶层由启动漂移检测对齐。⑦bis 场景加了对应断言。教训：**任何模型/用户能读到的「当前 X」档案文件，状态变更时必须同步，否则自查路径会打架。**
  **「立刻生效」的验收口径**：在输入框下拉里换模型后，**下一条消息**该轮引擎就得跑新模型。回归在 `model-scope` 第 ⑦bis 步（改下拉 → 真发一条 → 读 rollout 的 `turn_context.model`），别用「重开会话才生效」当验收。
  **启动链健壮性（09-11 实测）**：主进程 boot 是 `app.whenReady().then(async () => { … })`，里面任何一处裸 `await` 抛出 → unhandled rejection → **整条启动链中断、引擎根本不 spawn**，症状是「界面能开、发消息毫无回复」，日志里只有一行 `EPERM`（实测 `memory-mode.json` 写不进去：被安全软件/同步盘占用或磁盘满）。boot 副作用（`applyMemoryMode` / `scheduler.start` / `remote.start`，以及既有的 `channelBot.configure`）一律 try/catch 降级；预检【5】有守卫盯着这三处别退回裸 await。
  **另一个隐藏坑**：`allModels` 兜底 effect 曾在「modelId 不在可用列表」时把回落值**写进 localStorage**（会话记录与全局都写）——供应商列表是异步加载的，加载完成前所有非生效供应商的模型都「不在列表里」，于是用户刚选的模型被默默冲掉。现在该 effect **只改内存、不落盘**。

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
- **频道机器人流式回复（bot-stream.ts）**（09-08 新增）：微信/Telegram 机器人回复支持流式——思考/工具/正文按引擎事件时间顺序实时推送。设置全局存 `userData/bot-stream.json`（IPC `bot-stream:get/set`，UI 在机器人管理弹窗：流式回复总开关 + 同步思考 + 同步工具，**回合开始时同步读，开关下一条消息即生效**）。两种传输语义：微信 iLink `message_state=1` 向同一 `client_id` 气泡增量追加、`state=2` 收尾（追加连续失败 2 次自动停用降级收集，收尾补发尾部；flush 节流 1.5s、上限 40 条防刷屏）；Telegram `sendMessage` 建气泡 + `editMessageText` 1.6s 节流整段改写，最终落定超 4000 字分片补发。事件源：`item/reasoning/*Delta`（💭 思考）、`item/started` commandExecution/mcpToolCall/fileChange/webSearch（🔧 工具，单命令输出截 400 字）、`item/agentMessage/delta`（正文）；`item/completed` 权威快照兜底补齐漏收 delta。会话按 threadId 挂在 `botStreamSessions`，turn/completed 后保留（handler 的 onDoneProxy 以 `botStreamSessions.has(threadId)` 判断是否兜底发最终正文，防双发）；Telegram 绑定靠 `telegramBindings`(threadId→chatId) 反查。
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
