# 内置能力与会话动态工具（从 AGENTS.md 搬出，11-19）

> 这两节描的是**运行时状态**，不是每轮都要读的规则 —— 常驻副本已删，需要时查这里。
> ⛔ 内容与搬出前逐字一致（11-19 搬家，未改一字）。
> 更权威的来源：内置技能 `harness-api`（由 `scripts/gen-capability-skill.mjs` 从磁盘生成，721 条通道）。

## 内置能力（引擎可直接用，无需额外安装）

> ⛔ **50MB 口径（10-01 用户定稿）**：**下载体积 ≤50MB 的工具一律随包内置**（装机即用）；
> 只有大件与浏览器内核留在「开发工具」页按需下载。改内置清单必须三处同步：
> ① `package.json` 的 `build.extraResources` ② `scripts/prepare-windows-tools.cjs`（win 构建期现造）
> ③ `scripts/prepare-mac-tools.cjs`（mac 构建期现造）。守卫【29】按 extraResources 逐条比对。

**内置（builtIn=true，11 项）**：引擎本体 · Node.js · VS Code CLI · Nuphus 桌面自动化 ·
ponytail 写代码模式插件 · **Python（完整版，自带 pip + Tkinter）** ·
**ripgrep** · **uv** · **CMake** · **7-Zip CLI** · **jq** · **Ninja** · **yt-dlp** · **Android 平台工具（adb）**
（后 9 件为本次按 50MB 口径新纳入；打包靠上面两个 prepare 脚本现造，CI 干净检出必然命中）。

**按需下载（>50MB / 内核）**：PowerShell 7（282MB）· Git（90MB，缺了首启自动补装）·
FFmpeg（307MB）· Miniconda（100MB）· MinGW（267MB）· **Filee 文件转换**（151MB，10-30 立，
KnifeLemon/Filee MIT：244 种格式本地离线互转；GitHub release 镜像序直下 + SHA256 校验 →
`tools/filee/filee-cli.exe`；配套 Codex 工具 `filee_convert`（`filee:convert`，--json 结构化回执）
与「控制台 → 组件更新」的手动更新行（`GITHUB_UPDATEABLE`，⛔ 不进后台自动更新）。
卡片在「设置 → 开发工具 → Filee 文件转换」，CLI 实测口径与守卫见 12aj）·
**ApkStart 安卓运行器**（119MB 下载 / 安装后约 270MB，11-14 立，RoutineMiku/apkstart MIT，仅 Windows 10/11 x64：
本机安卓模拟器，装 APK 后以独立窗口运行；GitHub release 镜像序直下 + SHA256 校验 → `tools/apkstart/ApkStart.exe`，
首次启动由它自己下载约 1GB Android 运行时（adb / emulator / 系统镜像到 `%APPDATA%\apkstart\runtime`）。
配套 Codex 工具 `apkstart`（status / install / launch / screenshot / logcat / adb / open）、
内置技能 `android-emulator` 与「控制台 → 组件更新」的手动更新行；⛔ 完成判据读它的 `apps.json` 与 adb
（GUI 无结构化输出，install 返回 pending ≠ 成功）。守卫 12bo）·
**OpenMAIC 互动课堂**（源码型，约 1.3GB 下载 / 5GB 安装后，11-14 立，THU-MAIC/OpenMAIC MIT，仅 Windows：
Next.js + PostgreSQL 的多智能体互动课堂；按需下载源码 + pnpm 依赖 + 便携 PostgreSQL（`@embedded-postgres`）→
本机构建（`tools/openmaic/{app,runtime}`）→ `next start` 只监听 127.0.0.1；课程/DB/secret 落
`userData/openmaic-data`，卸载可保留。⛔ 依赖必须在最终 app 路径安装（pnpm node_modules 含链接，装完再移动会丢）；
⛔ pg_ctl 退出码不可信，以端口可连为准；模型 Key 只由用户在网页设置里填，宿主不读不写。
配套 Codex 工具 `openmaic`（status / start / stop / open / generate / job）与内置技能 `openmaic`；守卫 12bp）。
**PhotoCraft + Craft 全家桶**（11-15 / 11-16 / 11-17，storytold：photocraft 与 craft-launcher，Apache-2.0）：
开发工具里只有一张「Craft 全家桶」卡（三级弹窗，见下文专节）—— 只按需下载 ArtCraft Launcher 的 11MB 便携包
（GitHub release 镜像序 + SHA256SUMS → `tools/artcraft-launcher`）；19 个 App（含 PhotoCraft）的安装/卸载全部交给
Launcher，宿主只扫描识别并接线；PhotoCraft 仍用自己的 `photocraft` 工具 + `[mcp_servers.photocraft]`，其它 App
各自接一条 MCP + 独立工具 `craft_<id>`。守卫 12bt / 12bu。
**卡片内更新**（11-14 用户：「这些卡片界面里面好像都没有配套更新功能」）：开发工具里按需下载卡
（Filee / ApkStart / OpenMAIC / 飞书 CLI）都有独立「更新」行（`RuntimeUpdateRow`，打开卡片自动查一次），
复用 `runtime:update-check` / `runtime:update` 单一真相源；OpenMAIC 更新 = 重新下载并构建（先停服务/库，课程数据保留）。
⛔ 别再只写「去控制台 → 组件更新」当唯一入口。
**Husk（iPhone 跑 Android）**（11-14，Leviidev/Husk，GPL-2.0-or-later，iOS 15.5+）：翻译层直跑 + QEMU 兜底，
导入 APK 全屏运行。电脑侧只按需下载官方 `Husk.ipa`（142MB，GitHub release 镜像序 + SHA256 → `tools/husk/Husk.ipa`）
并给 SideStore / AltStore / TrollStore 侧载指南（`itslevii.dev/docs/install`，源 `itslevii.dev/repo.json`）；TrollStore 用户可在同一卡片单独下载 `Husk.tipa`（hidden 工具项 `husk-tipa`，独立版本号）。
⛔ **不从电脑直接装进 iPhone**（需要真机 + 签名侧载，宿主不假装能做到）；GPL 外部工具只下载官方 IPA，不 import 其源码。
守卫 12bq。
配套 Codex 工具 `husk`（status / device / download / guide / reveal）与内置技能 `husk`；卡片里有「iPhone 连接」检测行（Windows PnP / mac system_profiler，只检测不做安装）。
全部走国内镜像优先、失败自动回落官方源。**Ego Lite 浏览器不随包内置**（安装后约 611MB），
由「设置 → 开发工具」跳官方安装器；浏览器自动化优先走它，未安装回落 browse-skills
（`nuphus-call browser_*` 驱动默认浏览器）。**Playwright CLI 与浏览器内核已整体移除。**

| 能力 | 入口 | 说明 |
|---|---|---|
| 引擎本体 | `app-server --listen stdio://` | 会话、工具、插件、钩子、技能全部走它 |
| 基础运行时 | `resources/tools/{node,python,git,pwsh,vscode-cli,rg,uv,cmake,ninja,sevenzip,jq}` | 开发机本地保留；**打包后仅 node/vscode-cli 内置**，其余开发工具页按需下载（缺 Git 启动自动补装） |
| 桌面自动化 MCP | `tools/npm-global` 里的 `nuphus`（MCP 服务器名） | 工具前缀 `desktop_*`；浏览器工具经 `nuphus-call browser_*` CLI 调用 |
| 浏览器自动化首选 | 外部安装的 `ego-browser`（ego lite） | 每个 Codex 会话一个 `codex-<CODEX_THREAD_ID>` TaskSpace；共享登录态、多会话并行；不随包内置。官网 <https://lite.ego.app/zh-cn> · 源码 <https://github.com/citrolabs/ego-lite>（MIT） |
| 浏览器自动化回落（browse-skills） | `nuphus-call browser_navigate / browser_snapshot / browser_click / …` | ego 未安装时驱动本机默认浏览器；不按会话隔离 Space |
| 内置技能 | `codex-home/skills/` 的 `desktop-automation`、`browser-skill` | 随应用写入，引导引擎调自动化工具；旧 `browser-automation` 已退役（升级时按指纹自动清理，用户改过的目录不碰） |

## 会话动态工具（thread/start / thread/resume 注册，可直接调用）

| 工具 | 来源 | 用途 |
|---|---|---|
| agent_invoke / agent_archive_sessions | 宿主 **dynamicTools**（`part08/01-seg.tsx` 的 `buildDynamicTools`，分发在 `part05/event-router/02-request.tsx`） | 派一个干净上下文的自己 / 归档本次调度产生的临时会话。执行端转 IPC `agents:invoke` / `agents:archive`，与内置 MCP harness-dispatch **共用同一个 `runDelegatedTask` 硬闸** |
| memory_recall / memory_save | 引擎 dynamicTools | 查询/保存分层记忆（用户偏好/项目背景/工作流/任务经验）；发送前应用会自动注入相关记忆 |
| 生图：命令行 `harness-media.mjs image`（首选 dynamicTool `generate_image`） | 命令行 / dynamicTool | 需在 设置→插件→内置插件 配置；未配置时调用会返回指引。⛔ 识图（视觉辅助插件 / describe_image / harness-media vision）已于 10-30 整体移除，不许加回 |
| rpa_save / rpa_run | dynamicTools | 保存自动化流程为 RPA 配方 / 列出并执行已存配方（逐步复现） |
| filee_convert | dynamicTools（10-30） | 调本机 Filee（`filee-cli.exe`）把文件离线转换格式：244 种（图片/PDF/Office/电子书/音视频/归档/CAD/数据/3D），恒带 `--json` 结构化回执；需在 设置→开发工具→Filee 文件转换 安装（151MB，GitHub 镜像序 + SHA256 校验），装后 developer_instructions 注入第 5 条用法；更新在「控制台 → 组件更新」 |
| photocraft | dynamicTools（11-15；11-17 改 Launcher 安装） | 用 PhotoCraft（开源 Photoshop 重写）做专业图像后期：status / commands（500+ 命令可发现）/ info / run（按序执行 ≤20 条命令）/ convert / batch / open（原生窗口）。⛔ 安装由 Craft 全家桶的 Launcher 负责（设置→开发工具→Craft 全家桶→PhotoCraft），宿主不直接下载；文件必须落在会话目录，输出不得覆盖原图；检测到就注册 MCP 连接器（引擎延迟暴露 MCP 工具 ⇒ 主路径仍是本工具） |
| craft_<id> | dynamicTools（11-16，每个已装 App 一个） | 对 Craft 全家桶里**已安装**的 App（CADCraft / LightCraft / FilmCraft…）各自调用它自己的无头 CLI：status / commands / info / run / convert / open。工具只在 Launcher 装好该 App 后出现（新开会话或切走再切回）；输出不能与输入同路径；每个 App 一条独立 `[mcp_servers.<id>]`，⛔ 不共用统一网关 |
| apkstart | dynamicTools（11-14） | 在本机 ApkStart 安卓模拟器里测应用：`status` 查状态/设备/已装应用（读它自己的 `apps.json`）、`install` 装 APK（可选装完启动）、`launch` 按包名启动、`screenshot` 截屏存 PNG、`logcat` 读日志（保留崩溃行）、`adb` 透传点按/输入/授权命令、`open` 打开主界面；需在 设置→开发工具→ApkStart 安卓运行器 安装（仅 Windows，首启再下约 1GB 运行时；pending 不算成功），细节见技能 `android-emulator` |
| openmaic | dynamicTools（11-14） | 在本机 OpenMAIC 互动课堂里生成课：`status` 查安装/服务/能力、`start`/`stop` 启停本地服务与 PostgreSQL、`open` 打开网页、`generate` 提交（requirement / materialIds，异步返回 jobId）、`job` 查进度与课堂链接；需在 设置→开发工具→OpenMAIC 互动课堂 安装（约 1.3GB 下载 + 构建 5–10 分钟，仅 Windows）；⛔ 模型 Key 由用户在网页设置里自己填（不要发到对话里），生成别循环死等，细节见技能 `openmaic` |
| task_add / task_update | dynamicTools | 维护用户任务清单（新增/改状态/列出/删除） |
| agent_ask | dynamicTools | 向用户展示选项卡等待选择（第一项为推荐），用于关键决策确认 |
| frontend_get_doc / frontend_apply_doc | dynamicTools（前端开发，10-05；两轮改名：sketch_* → mobile_ui_* → frontend_*） | 读/写应用内「前端开发」画布（m3e-canvas，手机 / 电脑 / 网页三种形态）：读回整份文档 JSON + 摘要；写回=在文档基础上改（追加屏/加部件/调坐标），走上游分享哈希导入、用户实时可见可 Ctrl+Z。写侧先过 `validateSketchDoc` 前置校验（失败回中文原因）；画布没开自动打开等桥就绪；描述列全 44 种 kind，字段速查在内置技能 frontend-canvas。做手机/电脑/网页界面时主动用（常驻指令第 13 条配套） |
| harness_tools | dynamicTools（**能力网关**，10-05） | 调其余内置能力：`scheduler_*`（定时任务）/ `knowledge_*`（知识库）/ `ui_component_*`（组件库）/ `github_trending`（GitHub 近期热门，日/周/月）/ `video_*` / `voice_generate` / `workflow_*` / `expert_list` / `expert_save` / `subagent_save` / `connector_register`。传 `name` + `args`；⛔ 参数拿不准先 `name="list"` 取清单。执行端 = IPC `agents:dispatch-call` → `dispatchRpcCall`（与内置 MCP 同一套）。⛔ `agent_invoke` / `agent_archive_sessions` / `image_generate` 有专用工具，**不在**网关里 |

> ⛔⛔ **内置 MCP（harness-dispatch）的工具在引擎 0.157 里不再直接可调**（10-05 实测定性，用户报「调度工具用不了」的根因）：
>   · 引擎把 MCP 工具改为**延迟暴露** —— `input[0].additional_tools` 里只有 `functions` / `clock` / `collaboration`
>     三组 11 个工具，`agent_invoke` 出现 0 次；`functions.exec` 的说明原话是「Some deferred nested tools may be
>     omitted from this description … still available on the global `tools` object and **listed in `ALL_TOOLS`**」。
>     引擎 feature `tool_search_always_defer_mcp_tools` 已 `removed=true` ⇒ 该行为**永久生效**。
>   · 直接调裸名 → `unsupported call: <name>`（`codex_core::tools::router`）；调 `mcp__<server>__<name>` 同样不支持。
>   · 复现方法：起**独立 `CODEX_HOME`**（隔离，不碰用户会话）+ 把 `model_provider` 指向一个本地 mock HTTP 服务，
>     截获引擎真实请求体 —— 工具面在 `input[0]`（`type:"additional_tools"`）的 `tools[]` 里，直接数 `name` 即可。
>     （隔离起真实 app-server 的握手套路见技能 `codex-engine-config-probe`；判定「某个名到底在不在工具面」必须这样实测，读代码会漏。）
>   ⇒ **10-05 已用「能力网关」重新接回**：宿主注册 1 个网关工具 **`harness_tools`**
>     （`part08/01-seg.tsx` 注册 → `part05/event-router/02-request.tsx` 分发 → IPC `agents:dispatch-call`
>     → **原样转给 `dispatchRpcCall`**，与内置 MCP 共用同一套实现与闸）。模型传 `name` + `args` 调用；
>     `name="list"` 返回全部能力 + 参数 schema。
>   · ⛔ **为什么是 1 个网关而不是 19 个独立工具**：工具面**每次请求**都要带上 ⇒ 19 份 schema 是常驻
>     token 成本，还会挤掉真正重要的工具；且主进程以后新增 MCP 工具时**渲染层不用改**。参数说明按需取。
>   · ⛔ `agent_invoke` / `agent_archive_sessions` / `image_generate` **不在网关里** —— 它们已有专用
>     dynamicTool。同一个能力挂两个名字，模型只会用最直白的那个、另一套被绕过（项目踩过：`subagent_invoke`）。
>   · ⛔ **身份两条路径都要是引擎事实**：网关的 `callerThreadId` 取 `item/tool/call` 的 `params.threadId`
>     （模型伪造不了）；MCP 路径仍靠 `dispatchProbes` 旁证。⛔ 别在渲染层"顺手"补一个模型可见的入参。
>   · ⛔ **老会话要切走再切回**（dynamicTools 只在 `thread/start` / `resume` 生效）。
>   · 守卫 `scripts/guards/11i-capability-gateway.mjs`（16 条）钉住接线；`11j` 钉「内置示范插件一律默认停用」。

> ⛔ 上表的**权威来源是代码**：MCP 工具见 `electron/features/dispatch-core.ts` 的工具数组（改完跑 `npm run gen:ipc` 会同步进 `harness-api` 技能），命令行能力见 `electron/developer-instructions.ts`。表里对不上的名字以代码为准（09-29 发现本表长期把命令行能力 `generate_image` 写成"工具"，且漏了后来新增的调度/媒体工具）。
> ⛔ **生图生视频的完整用法**读两个内置技能：`image-generation`（提示词五段结构 / 尺寸选择 / 变体策略 / 一致性）、`video-generation`（模式路由 / 8 家厂商矩阵 / 去漂移 / 失败修复 / 成片拼接）。
