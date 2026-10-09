/**
 * builtin-skills 的「harness-api」部分 —— ⛔ 本文件由 scripts/gen-capability-skill.mjs 自动生成，勿手改。
 * 数据源：ipc-channels.manifest.json + ipc-registry.ts + 生成器内的 DOMAIN_DESCRIPTIONS。
 * 用途：给引擎一份「宿主有哪些接口/可拓展能力」的按需可读清单（用户 09-25：「用户有这么方面需求的时候，
 * 不用一个个去扫」）。守卫【153】比对生成物与数据源，过期即红。
 */
export const HARNESS_API_SKILL = `---
name: harness-api
description: Codex Harness Desktop 宿主的接口清单与可拓展能力。当用户提「做个功能 / 加个集成 / 能不能自动 XX / 宿主有没有 XX 能力 / 帮我接上 XX」这类需求时先读它 —— 按域查现成接口，不用扫描源码，也不要重造宿主已有的能力。
---

# 宿主接口清单与可拓展能力（自动生成，勿手改）

数据源：electron/ipc-channels.manifest.json（86 个能力域 / 432 个通道），由 scripts/gen-capability-skill.mjs 生成。

## 怎么用

- 通道名格式 = \`域前缀:动作\`（渲染层 ⇄ 主进程的内部接口）。**按域查**：用户的需求落在哪个域，就看那个域有哪些动作 —— 有现成域说明能力已存在，要做的是「接入/扩展」，不是重造。
- ⛔⛔ **这些通道不是模型能直接调用的工具**（09-28 加：用户问「你会不会定时任务 / 为什么建不了」，模型据此误解过）。它们只有**应用界面**（按钮 / 设置页）会调。模型在会话里能用的只有三类：① 内置调度 MCP 暴露的**真工具**（下一段的清单）；② 各技能正文教的流程；③ 命令行（node 脚本 / \`codex\` 子命令）。
  **内置调度 MCP 当前暴露的工具**（09-29 现状；实际以 tools/list 返回为准）：
  · 调度：\`scheduler_save\`（建定时任务，\`threadId:"current"\` = 就在当前会话里续聊执行）/ \`scheduler_list\` / \`scheduler_run\` / \`scheduler_delete\`
  · 媒体：\`image_generate\`（生图，\`count\` 1–4 并发出变体，落盘返回本地路径）/ \`video_generate\`（提交视频任务，**立即返回 jobId，不等待**；\`video\` 参数可传白模预演参考片的公网 URL，配 Seedance 2.0/2.5 渲染）/ \`video_status\`（查任务；成功会自动下载落盘；给 \`wait: true\` 就**由宿主一直查到出片/失败/超时**再返回，别自己写循环反复调用）/ \`video_concat\`（把多镜片段按给定顺序拼成成片）/ \`voice_generate\`（台词合成配音 WAV，落盘返回路径；语音模型未下载时报错并指路「设置 → 语音」）
  · 语音播报（10-09）：\`voice_announce\`（**立刻念一句话**给用户听 —— 插播，不必等本轮回复结束；≤120 字；实时语音通话中不可用，那时直接写进回复就会被念出来。⚠️ 即时发送、不等回执：没出声不会报错 ⇒ 别据此向用户声称「已经说了」；⛔ 这句是**说给耳朵**的，正文里**别原样复述**，同一句会被念两遍）/ \`voice_announce_stop\`（立刻停止播报、清掉排队待念的内容）/ \`voice_speak_reply\`（把**本条回复的正文**在生成过程中念出来 —— 不是每条都念，由模型自己判断何时值得开口：用户在催 / 反复没做好 / 当前步骤关键 / 自己有话要说）
  · 子智能体：\`agent_invoke\`（派一个干净上下文的自己）/ \`agent_archive_sessions\` / \`subagent_save\`（新建子智能体代理，name+systemPrompt 必填）
  · 专家：\`expert_save\`（创建/更新专家或专家团——displayNameZh + leadName + leadSystemPrompt 必填，多角色加 members；同 teamId 即更新）/ \`expert_list\`（列已有专家）。用户说「帮我建一个 XX 专家 / 专家团」时直接用它，建完复述 teamId；⛔ 内置六专家（知微/呈象/洞明/鲁班/画意/剪承团）有固定 teamId，别覆盖
  · 专家：\`expert_save\`（创建/更新专家或专家团——displayNameZh + leadName + leadSystemPrompt 必填，多角色加 members；同 teamId 即更新）/ \`expert_list\`（列已有专家）。用户说「帮我建一个 XX 专家 / 专家团」时直接用它，建完复述 teamId；⛔ 内置六专家（知微/呈象/洞明/鲁班/画意/剪承团）有固定 teamId，别覆盖
  · 自造工具：\`connector_register\`（把一个本地 stdio MCP server 脚本注册成持久连接器 —— 重启应用后新会话的 tools/list 带上它的工具）。**没有现成工具时先读 \`self-tools\` 技能**：路线① 工作区脚本立即用（一次性）；路线② 自建 MCP server + connector_register（持久）；路线③ 改宿主源码要重新构建（交给用户）
  · 画布工作流：\`workflow_read\`（读画布上搭的工作流：节点/连线/提示词/产物现状）/ \`workflow_writeback\`（把执行结果写回节点，画布实时显示）。用户说「按画布那套跑 / 画布里搭好的流程执行一下」时：先 workflow_read 看清节点与连线，再用 image_generate / video_generate / voice_generate 按链路逐节点执行，每步产物用 workflow_writeback 写回对应节点
  ⇒ 当用户要「建定时任务 / 加待办 / 存 RPA 配方 / 改设置」这类**界面动作**时，**说明该去哪个界面点**（例如 设置 → 定时任务），**不要**声称自己调用了某个 \`域:动作\` 通道、也不要凭空发明工具名（如 \`task_add\`）—— 没有的工具就是没有。
- 引擎**直接可用**的自动化能力另有专技能：\`desktop-automation\`（键鼠/窗口/OCR，nuphus MCP）、\`browser-skill\`（浏览器，playwright-cli）、\`ssh\`（远程执行）。MCP 连接器是动态的，以 tools/list 实际返回为准。

**怎么读这份清单**（09-25 加，用户实测踩到）：它是**一个文件**，**一次读全** —— 不要分段读、不要在技能目录里 grep 找接口。
引擎的技能清单里给的 \`(file: …)\` 就是它。⛔ 用 cmd 的 \`type "路径"\` 读时，路径上的**引号会被执行通道剥掉**、\`workdir\` 也可能报 \`os error 267\` —— 改用你惯用的读文件方式，或先把它的所在目录设为工作目录再读 \`SKILL.md\`。

## 可拓展点（怎么给宿主加能力）

用户问「能拓展什么 / 能不能接上 XX」时，答案在这张表里 —— **先按「要加的东西」找到改法**，再看上面「能力域」有没有现成通道可复用。

| 想加的东西 | 落点（改哪里 / 用什么） | 注意 |
|---|---|---|
| 宿主原生能力（新接口） | \`electron/ipc-channels.manifest.json\` 加一条 → \`npm run gen:ipc\` → 补 \`ipc-registry.ts\` 的域 \`count\` | ⛔ 生成物勿手改；守卫【2】【90】【107】盯；改完**重跑本清单生成器** |
| 教模型的流程（怎么做事） | 内置技能 \`electron/builtin-skills/NN-*.ts\` + 在 \`builtin-skills.ts\` 登记 | 正文必须**字面量**（【86】做配置面安全扫描），勿运行时拼装 |
| 个人 / 项目的经验与流程 | \`<workspace>/.codex/skills/<name>/SKILL.md\`（引擎原生发现，**默认落点**） | 跨项目才放 \`$CODEX_HOME/skills/\`；⛔ 别放 \`.codex-harness/skills\`（引擎不读） |
| 外部服务 / API 接入 | **MCP 连接器**（设置 → 连接器；或自写 MCP server） | 工具面是动态的，以 \`tools/list\` 实际返回为准 |
| 让某个角色长期替你干活 | **专家 / 专家团**（定义 + 技能包） | 成员在独立会话里跑，产出由主理人汇总 |
| 定时 / 周期任务 | **调度器**（\`scheduler:*\`） | 任务真的在指定 workspace 目录里跑（不是「看起来在那里」） |
| 把会话接到 IM | **渠道 Bot**（\`channel-bot:*\` / \`weixin:*\` / \`telegram:*\`） | — |
| 记录好的桌面流程 | **RPA 配方**（\`rpa:*\`） | 键鼠级回放，适合无 API 的老软件 |
| 浏览器 / 桌面自动化 | 专技能 \`desktop-automation\`（nuphus MCP）、\`browser-skill\`（playwright-cli） | 应用里关掉能力总闸后这些工具**不存在**，别当成坏了 |
| 换记忆后端 | 设置 → 记忆 → 记忆后端（内置金字塔 ⇄ MCP 记忆服务） | 二者**互斥**，且装好才允许切 |
| 主题 / 外观 | \`src/lib/themes.ts\`（多主题扩展点） | — |

⛔ **打包版没有宿主源码**：用户机器上只有一个安装包 ⇒ 那时真正的答案只有**接入类**（技能 / MCP 连接器 / 专家 · 专家团 / 定时任务 / RPA / IM 渠道 / 记忆后端）。要改宿主代码必须在**源码工程**里做；先确认源码在不在手边，再决定说哪种方案。

## 能力域

### pet（11 通道）
桌面宠物（官方 Codex 宠物格式：pet.json + 8×9 图集）：list 发现四目录宠物 / settings-get·set 开关与选择 / roots 目录清单 / open-dir / import 从只读目录导入用户区 / toggle·show·hide 显示控制。宠物本体渲染在独立透明置顶浮窗，宿主侧只做发现与设置
通道：pet:list, pet:settings-get, pet:settings-set, pet:state, pet:roots, pet:open-dir, pet:import, pet:toggle, pet:show, pet:hide, pet:interactive-rect

### drama-canvas（7 通道）
AI 短剧无限画布：把工作流拆成卡片摆在无限画布上（生图/短剧/白模/3D 建模/电商出图各类模板），连线表示「这份输入喂给下一步」。**画布可被模型读写**：board-sync 由画布自动镜像快照，模型用真工具 workflow_read 读内容、workflow_writeback 把产物写回节点（卡片实时显示）——「按画布搭的流程跑」是可行请求
通道：drama-canvas:asset-write, drama-canvas:storyboard-file-remove, drama-canvas:polish-prompt, drama-canvas:describe-image, drama-canvas:output-dir, drama-canvas:output-dir-set, drama-canvas:board-sync

### laya（4 通道）
Laya 智能判断（GitHub NandhaKishorM/laya，Apache-2.0，非自回归决策引擎 33ms）：status 安装与服务状态 / install 安装更新（pip 清华镜像 + 权重走 hf-mirror）/ decide-effort 思考等级自动判断（choice: low/medium/high/xhigh + 校准置信度，<0.45 弃权）——渲染层思考档「自动」开关的数据端；失败一律降级手选档，不是硬依赖
通道：laya:status, laya:install, laya:uninstall, laya:decide-effort

### phone（7 通道）
手机控制（phone-harness）：查状态 / 安装 / 卸载 / 体检 / 权限引导；Android 走 adb（全平台），iPhone 走 Mac 的 iPhone 镜像（仅 macOS）
通道：phone:harness:status, phone:harness:install, phone:harness:uninstall, phone:harness:doctor, phone:harness:guides, phone:harness:open-settings, phone:harness:wire-adb

### team-runs（1 通道）
专家团运行记录查询
通道：team-runs:list

### team-threads（2 通道）
专家团成员会话映射
通道：team-threads:map, team-threads:team-of

### thread-runtime（6 通道）
会话运行态（派发所有权、运行/闲置状态机）
通道：thread-runtime:dispatch-owner, thread-runtime:get, thread-runtime:list, thread-runtime:patch, thread-runtime:release-dispatch, thread-runtime:seed

### agents（11 通道）
子智能体库（创建/归档/委派/目录；成员会话与角色）
通道：agents:archive, agents:catalog, agents:delegated, agents:delegated-of, agents:dispatch-call, agents:enabled-notice, agents:invoke, agents:notice, agents:off-notice, agents:thread-role, agents:tool-description

### theme（1 通道）
主题（亮/暗/跟随系统）
通道：theme:apply

### bot-binding（2 通道）
Bot 与会话/IM 的绑定关系
通道：bot-binding:get, bot-binding:set

### bots（2 通道）
Bot 定义管理
通道：bots:get, bots:set

### bot-stream（2 通道）
Bot 流式输出转发
通道：bot-stream:get, bot-stream:set

### video（7 通道）
内置视频生成接口（国内外 8 家：可灵/万相/Seedance/CogVideoX/MiniMax/Runway/Luma/Veo）：submit 提交 → poll 轮询 → download 落工作区；凭证存 userData/video-providers.json
通道：video:providers, video:config-read, video:config-save, video:submit, video:poll, video:download, video:concat

### poll（3 通道）
轮询板块的配置与中止（间隔 / 超时上限 / 失败重试次数，存 userData/poll-settings.json；poll:abort = 用户在界面上按「中止」时停掉主进程的等待循环）。⛔ 这是**轮询行为**的配置，不是任务本身 —— 提交/查询任务走 video 域那套工具
通道：poll:abort, poll:config-read, poll:config-save

### queue-timer（2 通道）
排队消息的定时发送（主进程定时器；窗口最小化 / 被遮挡时不被 Chromium 节流）
通道：queue-timer:set, queue-timer:cancel

### weixin（6 通道）
微信机器人（iLink bot）：登录绑定/状态 + **主动推送 weixin:send**（to 缺省=最近对话用户；正文依赖 context_token）
通道：weixin:cancel-login, weixin:logout, weixin:poll-login, weixin:send, weixin:start-login, weixin:status

### telegram（3 通道）
Telegram 通道
通道：telegram:connect, telegram:logout, telegram:status

### channels（1 通道）
IM 通道总开关与状态
通道：channels:status

### feishu（5 通道）
飞书通道
通道：feishu:connect, feishu:logout, feishu:qr-cancel, feishu:qr-start, feishu:qr-status

### dingtalk（2 通道）
钉钉通道
通道：dingtalk:connect, dingtalk:logout

### qq（5 通道）
QQ 通道
通道：qq:connect, qq:logout, qq:qr-cancel, qq:qr-start, qq:qr-status

### wecom-webhook（3 通道）
企业微信 webhook 通道
通道：wecom-webhook:connect, wecom-webhook:logout, wecom-webhook:test

### ponytail（2 通道）
写代码模式插件（会话钩子 + 技能的宿主侧开关）
通道：ponytail:mode:get, ponytail:mode:set

### codex（3 通道）
渲染层与引擎（@openai/codex app-server）之间的请求桥：转发请求 / 响应 / 切活跃会话
通道：codex:request, codex:respond, codex:set-active-thread

### user（1 通道）
用户档案（昵称等，供个性化显示）
通道：user:name

### app（8 通道）
应用级杂项（版本、存储用量、缓存清理、重启、加载目录）
通道：app:doctor, app:engine-info, app:home-dir, app:perf-counters, app:relaunch, app:storage-clear, app:storage-info, app:userData

### work-logs（3 通道）
各项目的**工作日志与项目记忆**管理（<项目>/.codex-harness/memory/**：长期记忆 MEMORY.md / 坑与纪律 LESSONS.md+lessons/ / 每日工作日志 logs/YYYY-MM-DD.md / archive / project）——设置 → 数据管理 → 工作日志。可看正文、按项目与类型分组、批量删除。⛔ 这是项目里的工作记录，与会话本身的归档 / 删除（「归档管理」页）不是一回事；删除是销毁性的（工作日志删了不会重建）
通道：work-logs:scan, work-logs:read, work-logs:delete

### capabilities（1 通道）
宿主能力快照（当前环境支持什么，一次性拉取）
通道：capabilities:snapshot

### window（4 通道）
窗口控制（最小化/关闭/置顶/弹出一个独立小窗）
通道：window:popout-thread, window:popout-close, window:popout-id, window:popout-list

### engine（4 通道）
引擎生命周期（重启 / 换模型档位 / 状态查询）
通道：engine:active-turns, engine:check-update, engine:perform-update, engine:restart-log

### builtin（5 通道）
内置模型供应商目录（读/存/探测/图像模型）
通道：builtin:describe-image, builtin:generate-image, builtin:probe, builtin:read, builtin:save

### relay（14 通道）
账号库（OpenAI 账号多账号管理：导入/切换/启停/用量概览）
通道：relay:login, relay:load-account, relay:accounts, relay:toggle-account, relay:switch-account, relay:remove-account, relay:overview, relay:create-key, relay:select, relay:key-billing, relay:register, relay:payment-plans, relay:open-purchase, relay:keys-all

### openai（12 通道）
OpenAI 账号鉴权（登录/凭据/额度）
通道：openai:account-remove, openai:account-switch, openai:accounts, openai:capture-login, openai:import-file, openai:login-cancel, openai:login-start, openai:login-status, openai:models, openai:set-proxy, openai:toggle-account, openai:usage

### prompt（1 通道）
提示词增强（把用户草稿改写为更完整的 prompt）
通道：prompt:enhance

### terminal（5 通道）
内置终端（创建/输入/缩放/重启）
通道：terminal:input, terminal:list, terminal:ready, terminal:resize, terminal:restart

### updates（4 通道）
应用自更新（检查/下载/安装，GitHub Release 单源）
通道：updates:check, updates:download, updates:reveal, updates:install

### plugin（1 通道）
插件卸载入口
通道：plugin:validate

### remote（11 通道）
远程会话（手机/网页端远程接入宿主）
通道：remote:approve, remote:deny, remote:devices, remote:pair-rotate, remote:pair-state, remote:qrcode, remote:revoke, remote:send, remote:start, remote:status, remote:stop

### bot（7 通道）
Bot 会话（Bot 与会话的绑定与消息注入）
通道：bot:approve, bot:bind-consume, bot:bind-qrcode, bot:bind-status, bot:deny, bot:pair-state, bot:revoke

### notify（1 通道）
系统通知（托盘气泡）
通道：notify:show

### awake（1 通道）
阻止系统休眠（长任务期间保持唤醒）
通道：awake:set

### tools（1 通道）
引擎工具面状态（动态工具是否注册）
通道：tools:status

### runtime（5 通道）
随包运行时管理（node/python 等的安装/卸载/列表）
通道：runtime:health, runtime:install, runtime:list, runtime:uninstall, runtime:cancel

### browser（3 通道）
浏览器自动化开关（cloak 状态/打开/弹窗）
通道：browser:cloak-status, browser:open-cloak, browser:popout

### git（1 通道）
仓库 diff 读取
通道：git:diff

### fs（4 通道）
受控文件系统访问（读写/存在性检查，路径受信任目录约束）
通道：fs:write, fs:read, fs:exists, fs:reveal

### model-viewer（1 通道）
**3D 模型预览**（10-05）：read(path) 读会话工作区里的 .glb / .gltf 模型（可信根内、≤256MB，字节直传给预览弹窗）。通常不直接调 —— 引擎侧走 harness_tools 网关的 \`preview_3d\` 在应用内弹出可旋转的 3D 预览；本域通道是渲染层弹窗的取数后端
通道：model-viewer:read

### dialog（6 通道）
文件/目录选择对话框（含跨窗口）
通道：dialog:directory, dialog:directory-at, dialog:images, dialog:files, dialog:ssh-key, dialog:save-as

### dataDir（2 通道）
数据目录自定义（userData 重定向 + 启动期自动迁移；改后重启生效）
通道：dataDir:read, dataDir:prepare

### skills（12 通道）
技能经验包（导入/启停/市场安装/本地列表）
通道：skills:import, skills:local-list, skills:local-remove, skills:market-install, skills:market-install-light, skills:market-list, skills:set-enabled, skills:set-enabled-batch, skills:pool-describe, skills:pool-set, skills:builtin-switch-get, skills:builtin-switch-set

### skill-discipline（1 通道）
技能纪律（写技能时必须遵守的硬规则查询）
通道：skill-discipline:get

### plugins（6 通道）
插件市场（安装/启停/列表）
通道：plugins:market-install, plugins:market-installed, plugins:market-list, plugins:market-uninstall, plugins:set-enabled, plugins:set-linked-enabled

### codex-official-market（5 通道）
Codex 官方插件市场（GitHub openai/plugins 走国内镜像：清单/分类/一键安装/卸载/本地已装）
通道：codex-official-market:categories, codex-official-market:install, codex-official-market:installed, codex-official-market:list, codex-official-market:uninstall

### hooks（2 通道）
钩子（会话生命周期挂钩配置）
通道：hooks:set-enabled, hooks:trust

### connectors（7 通道）
MCP 连接器（外部 app/服务接入：增删改查、启停、OAuth）
通道：connectors:list, connectors:oauth-cancel, connectors:oauth-start, connectors:remove, connectors:save, connectors:set-enabled, connectors:templates

### mcp-servers（4 通道）
MCP 服务器管理（配置/状态）
通道：mcp-servers:overrides, mcp-servers:permissions, mcp-servers:set-enabled, mcp-servers:set-tool-permission

### personalization（6 通道）
个性化（昵称/自定义指令，落 personalization.json 并写入引擎 AGENTS.md）
通道：personalization:mark-greeted, personalization:read, personalization:save, personalization:save-identity, personalization:setNickname, personalization:verify

### appSettings（2 通道）
应用级开关（联网搜索/桌面自动化/下载源等，写 app-settings.json）
通道：appSettings:read, appSettings:save

### model-specs（1 通道）
模型规格（effort 档位等引擎参数）
通道：model-specs:read

### ssh（12 通道）
SSH 服务器库（保存/执行远程命令/导入导出/会话终端）
通道：ssh:delete, ssh:exec, ssh:export, ssh:import, ssh:list, ssh:save, ssh:session-close, ssh:session-open, ssh:session-resize, ssh:session-write, ssh:set-enabled, ssh:test

### threads（5 通道）
会话列表与元数据（归档、重命名、血缘、会话摘要等）
通道：threads:export, threads:export-markdown, threads:import, threads:import-conversation, threads:preview-conversation

### commands（5 通道）
斜杠命令（自定义 / 命令的定义与管理）
通道：commands:delete, commands:expand, commands:list, commands:read, commands:save

### subagents（3 通道）
子智能体——**可创建**：用户要「新建一个子智能体/代理」时，**直接用真工具 \`subagent_save\`**（name+systemPrompt 必填；同 name 即更新）→ \`agent_invoke\` 派活
通道：subagents:list, subagents:remove, subagents:save

### teams（9 通道）
专家团/专家的定义与成员管理——**可创建**：用户要「新建一个专家/专家团」时，**直接用真工具 \`expert_save\`**（先 \`expert_list\` 查重；normalize 自动补默认与 id 规范；teamId 相同即覆盖更新）。字段：displayName/profession/description（zh+en）/category/tags(≤3)/quickPrompts(≤3)/sop；lead 必带 name+systemPrompt；多角色协作加 members[]（每人 name+profession+description+systemPrompt）。⛔ 内置专家（知微/呈象/洞明/鲁班/画意/剪承团）每次启动确保存在——不要用与内置相同的 teamId 去覆盖内置定义，新建用独有 teamId；建完向用户复述 teamId 与成员名单
通道：teams:invoke-member, teams:list, teams:member-session, teams:remove, teams:reset-defaults, teams:save, teams:session-config, teams:start-session, teams:tools

### clipboard（4 通道）
剪贴板（读写文本/图片）
通道：clipboard:image, clipboard:write, clipboard:write-image, clipboard:read-files

### expert-market（2 通道）
SkillHub **专家市场包**（skillhub.cn/skillspackage，55 包）：list 浏览/搜索、install 一键安装——元技能 + orchestration.children 子技能落盘技能目录 + **专家中心自动新增对应专家卡片**（卡片 systemPrompt = 包元技能正文）。用户要「装个专家/装套工作流」时用它
通道：expert-market:install, expert-market:list

### kb（9 通道）
**项目级本地知识库**（<项目>/.codex-harness/knowledge/）：list 列文档 / add-text·add-files 导入 md·txt·代码文档（自动分块）/ search 分块全文检索（带高亮片段）/ read 读全文 / remove 删除。用户要「把资料存进知识库 / 查项目资料」时用它；语义向量后端为按需下载项。⛔⚠️ 上面是 **IPC 桥（给设置页 UI 用），不是模型工具** —— 模型侧只有两个：\`knowledge_search(query, limit?)\` 检索（workspace 缺省 = 调用者 cwd；装了 Laya 时最相关的一条会被置顶标注）与 \`knowledge_add(title, text, source?)\` 写入（10-04 补，此前模型只能读不能写；⚠️ 同名不覆盖会堆重复条目、⚠️ 写入不做语义向量化、⚠️ 专家/被调度会话不许写、⚠️ 装了 Laya 时低价值内容会被拒写并说明原因——充实内容后重试即可）
通道：kb:add-files, kb:add-text, kb:embed-install, kb:embed-status, kb:embed-uninstall, kb:list, kb:read, kb:remove, kb:search

### whatsnew（3 通道）
「更新到新版本后首次启动」的**新功能介绍弹窗**（10-06）：state 取该版本的要点与「该不该弹」（判定含：这个版本有没有要点、用户看过没有、是升级还是全新安装——全新安装不弹，避免新用户看到莫名其妙的「更新内容」）；ack 记下当前版本已看过 ⇒ 同版本不再弹。要点数据在主进程 electron/whats-new-notes.ts，每次发版要加一条（守卫【11r】钉）。⛔ 模型侧用不到它
通道：whatsnew:ack, whatsnew:history, whatsnew:state

### soul-market（4 通道）
SkillHub **人格市场**（skillhub.cn/soul，16 套现成人格）：list 浏览 / get 看人设全文 / current 当前生效 / apply 应用人格（写 personalization.persona + 同步 AGENTS.md，**下一个新会话生效**，slug=null 还原默认）。用户想「换个性格/语气」时用它
通道：soul-market:apply, soul-market:current, soul-market:get, soul-market:list

### pasted-text（3 通道）
粘贴文本暂存（大段粘贴落盘防丢）
通道：pasted-text:read, pasted-text:save, pasted-text:update

### external（1 通道）
用系统默认浏览器打开外部链接
通道：external:open

### shell（1 通道）
系统默认方式打开文件/目录
通道：shell:reveal

### scratch（1 通道）
临时便签（快速记一条）
通道：scratch:create

### custom-model（12 通道）
自定义模型供应商（接入任意 OpenAI 兼容端点：CRUD/探测/测活）
通道：custom-model:apply, custom-model:list, custom-model:probe, custom-model:read, custom-model:remove, custom-model:remove-model, custom-model:save, custom-model:select, custom-model:set-effort, custom-model:set-enabled, custom-model:set-model, custom-model:upsert-model

### bridge（1 通道）
引擎桥连接状态
通道：bridge:status

### channel-bot（3 通道）
IM 通道 Bot（把某个会话接到 IM 机器人上）
通道：channel-bot:read, channel-bot:save, channel-bot:test

### memory（29 通道）
记忆金字塔全链路（L0~L7 分层读写、召回、蒸馏、清理计划/执行、云端网关、工作区开关、记忆后端二选一）
通道：memory:backend:read, memory:backend:set, memory:delete, memory:distill, memory:fabric-entries, memory:fabric-namespaces, memory:fabric-write, memory:gateway:read, memory:gateway:save, memory:gateway:test, memory:hygiene:apply, memory:hygiene:plan, memory:layers:context, memory:layers:read, memory:layers:write, memory:list, memory:mcp:install, memory:mcp:uninstall, memory:mcp:verify, memory:mode-read, memory:mode-set, memory:recall, memory:reset, memory:role-context, memory:role-sessions, memory:save, memory:search, memory:workspace-enabled:read, memory:workspace-enabled:set

### rpa（4 通道）
RPA 配方（录制好的桌面自动化流程）
通道：rpa:delete, rpa:list, rpa:record, rpa:save

### tasks（5 通道）
任务清单（用户待办，可从对话生成）
通道：tasks:add, tasks:clear, tasks:delete, tasks:list, tasks:update

### scheduler（4 通道）
定时任务（一次性/周期：创建/启停/列表/手动运行）。save 支持 deliver:{channel:'weixin',to?}——到点执行后把回合结论主动推给微信用户（to 缺省=最近对话用户）
通道：scheduler:delete, scheduler:list, scheduler:run, scheduler:save

### voice（42 通道）
语音通话全链路（呼叫/音频流/转写/打断/挂断，39 通道）
通道：voice:status, voice:settings-get, voice:settings-set, voice:start, voice:dictation-finish, voice:endpoint-now, voice:stop, voice:audio, voice:speak, voice:preview-voice, voice:hotkey-set, voice:hotkey-get, voice:wake-start, voice:wake-audio, voice:wake-reset, voice:wake-stop, voice:barge, voice:playback-done, voice:models-status, voice:zipvoice-install, voice:zipvoice-cancel, voice:kws-install, voice:kws-cancel, voice:kws-status, voice:profiles-list, voice:preset-list, voice:preset-apply, voice:profiles-import, voice:profiles-record, voice:profiles-save, voice:profiles-delete, voice:profiles-select, voice:profiles-preview, voice:profile-upload, voice:models-install, voice:models-cancel, voice:models-import, voice:models-reveal, voice:models-uninstall, voice:mic-permission, voice:resource-set-enabled, voice:resource-delete, voice:resource-status

### domains（3 通道）
**宿主功能域**的清单与启停（设置 → 开发工具 → 功能域）——停用支持**真热插拔**（通道立即消失、无需重启），但持有跨域共享单例的域（server / codexHome / mainWindow / toolsRoot 的主人）只能重启生效。承载应用自身能力的域（身份/对话主链路/基础对话框）不可停用
通道：domains:list, domains:set-enabled, domains:reload-hint

### declared-plugins（3 通道）
**声明式插件**清单与启停（设置 → 开发工具 → 声明式插件）——插件是一份 JSON（用户目录 codex-home/harness-plugins 或内置 declared-plugins），只描述往哪个插槽挂什么内容、调哪条**已有**通道，不含任何代码。插槽即时生效、无需重启。⛔ 不加载第三方 JS：主进程是特权域（密钥库/开窗/全盘 fs），进代码即提权
通道：declared-plugins:list, declared-plugins:toggle, declared-plugins:open-dirs

### screenshot（6 通道）
截图（冻结帧框选/保存/历史）
通道：screenshot:settings-get, screenshot:settings-set, screenshot:hotkey-set, screenshot:capture, screenshot:pick-dir, screenshot:reveal

### favorites（7 通道）
收藏夹（收藏消息/片段，一键再发送）
通道：favorites:list, favorites:add, favorites:update, favorites:delete, favorites:clear, favorites:touch, favorites:to-memory

### history（1 通道）
跨会话历史搜索（全文检索会话与消息，命中按会话分组）
通道：history:search
`;
