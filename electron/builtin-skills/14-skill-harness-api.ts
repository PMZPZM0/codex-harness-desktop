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

数据源：electron/ipc-channels.manifest.json（70 个能力域 / 337 个通道），由 scripts/gen-capability-skill.mjs 生成。

## 怎么用

- 通道名格式 = \`域前缀:动作\`（渲染层 ⇄ 主进程的内部接口）。**按域查**：用户的需求落在哪个域，就看那个域有哪些动作 —— 有现成域说明能力已存在，要做的是「接入/扩展」，不是重造。
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

### team-runs（1 通道）
专家团运行记录查询
通道：team-runs:list

### team-threads（2 通道）
专家团成员会话映射
通道：team-threads:map, team-threads:team-of

### thread-runtime（6 通道）
会话运行态（派发所有权、运行/闲置状态机）
通道：thread-runtime:dispatch-owner, thread-runtime:get, thread-runtime:list, thread-runtime:patch, thread-runtime:release-dispatch, thread-runtime:seed

### agents（9 通道）
子智能体库（创建/归档/委派/目录；成员会话与角色）
通道：agents:archive, agents:catalog, agents:delegated, agents:delegated-of, agents:invoke, agents:notice, agents:off-notice, agents:thread-role, agents:tool-description

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

### weixin（5 通道）
微信通道（收发/绑定/状态）
通道：weixin:cancel-login, weixin:logout, weixin:poll-login, weixin:start-login, weixin:status

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

### runtime（3 通道）
随包运行时管理（node/python 等的安装/卸载/列表）
通道：runtime:install, runtime:list, runtime:uninstall

### browser（3 通道）
浏览器自动化开关（cloak 状态/打开/弹窗）
通道：browser:cloak-status, browser:open-cloak, browser:popout

### git（1 通道）
仓库 diff 读取
通道：git:diff

### fs（3 通道）
受控文件系统访问（读写/存在性检查，路径受信任目录约束）
通道：fs:write, fs:read, fs:exists

### dialog（5 通道）
文件/目录选择对话框（含跨窗口）
通道：dialog:directory, dialog:directory-at, dialog:images, dialog:files, dialog:ssh-key

### dataDir（2 通道）
数据目录自定义（userData 重定向 + 启动期自动迁移；改后重启生效）
通道：dataDir:read, dataDir:prepare

### skills（8 通道）
技能经验包（导入/启停/市场安装/本地列表）
通道：skills:import, skills:local-list, skills:local-remove, skills:market-install, skills:market-install-light, skills:market-list, skills:set-enabled, skills:set-enabled-batch

### skill-discipline（1 通道）
技能纪律（写技能时必须遵守的硬规则查询）
通道：skill-discipline:get

### plugins（4 通道）
插件市场（安装/启停/列表）
通道：plugins:market-install, plugins:market-list, plugins:set-enabled, plugins:set-linked-enabled

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

### subagents（4 通道）
委派执行（把任务派给子智能体跑，主进程直发）
通道：subagents:invoke, subagents:list, subagents:remove, subagents:save

### teams（9 通道）
专家团（多角色协作团队的定义与成员管理）
通道：teams:invoke-member, teams:list, teams:member-session, teams:remove, teams:reset-defaults, teams:save, teams:session-config, teams:start-session, teams:tools

### clipboard（4 通道）
剪贴板（读写文本/图片）
通道：clipboard:image, clipboard:write, clipboard:write-image, clipboard:read-files

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

### memory（24 通道）
记忆金字塔全链路（L0~L7 分层读写、召回、蒸馏、清理计划/执行、云端网关、工作区开关、记忆后端二选一）
通道：memory:backend:read, memory:backend:set, memory:delete, memory:distill, memory:gateway:read, memory:gateway:save, memory:gateway:test, memory:hygiene:apply, memory:hygiene:plan, memory:layers:context, memory:layers:read, memory:layers:write, memory:list, memory:mcp:install, memory:mcp:uninstall, memory:mcp:verify, memory:mode-read, memory:mode-set, memory:recall, memory:reset, memory:save, memory:search, memory:workspace-enabled:read, memory:workspace-enabled:set

### rpa（4 通道）
RPA 配方（录制好的桌面自动化流程）
通道：rpa:delete, rpa:list, rpa:record, rpa:save

### tasks（4 通道）
任务清单（用户待办，可从对话生成）
通道：tasks:add, tasks:delete, tasks:list, tasks:update

### scheduler（4 通道）
定时任务（一次性/周期任务：创建/启停/列表）
通道：scheduler:delete, scheduler:list, scheduler:run, scheduler:save

### voice（39 通道）
语音通话全链路（呼叫/音频流/转写/打断/挂断，39 通道）
通道：voice:status, voice:settings-get, voice:settings-set, voice:start, voice:dictation-finish, voice:endpoint-now, voice:stop, voice:audio, voice:speak, voice:preview-voice, voice:hotkey-set, voice:hotkey-get, voice:wake-start, voice:wake-audio, voice:wake-reset, voice:wake-stop, voice:barge, voice:playback-done, voice:models-status, voice:zipvoice-install, voice:zipvoice-cancel, voice:kws-install, voice:kws-cancel, voice:kws-status, voice:profiles-list, voice:preset-list, voice:preset-apply, voice:profiles-import, voice:profiles-record, voice:profiles-save, voice:profiles-delete, voice:profiles-select, voice:profiles-preview, voice:models-install, voice:models-cancel, voice:models-import, voice:models-reveal, voice:models-uninstall, voice:mic-permission

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
