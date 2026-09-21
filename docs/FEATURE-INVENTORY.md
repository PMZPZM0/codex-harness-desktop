# 功能清单（改造前基线，2026-09-21）

> 用途：① 改造时"搬一个域 = 勾掉一段"，不漏功能；② 新人/未来的我看一份表就知道
> **这个应用有哪些功能、各自现在在哪、改造后该在哪**。
>
> 数据来源：本机实测（`App.tsx` 结构切分、`main.ts` 的 313 个 `ipcMain.handle`、
> 设置页分支、`src/components`、`src/hooks`、`src/lib`、`electron/*.ts`、内置技能表）。
>
> 列说明：**现状** = 今天的真实坐标；**目标域** = 改造后落点（见 `ARCHITECTURE.md` §2）。

---

## 0. 总量基线（只许降的两个数）

| 指标 | 实测 |
|---|---|
| `src/App.tsx` | **22,216 行** = 模块级 8,049 行 + **App 组件本体 14,167 行（64%）** |
| `electron/main.ts` | **8,971 行 / 313 个 handler / 66 个 IPC 域** |
| `src/styles.css` | 25,454 行 / 58 个注释分节 |
| 设置页分支 | **29 个**（`settingsPage === "…"`，全写在 `App.tsx` 里） |
| 具名块 | 模块级 204 个（最大 `RelayCenterPage` 693 行） |
| 状态 | `useState` 502（App 体内 357）、`useEffect` 201（136） |
| 已模块化 | `src/lib` 27 个 `.mjs`、`src/components` 34 个 `.tsx`、`src/hooks` 5 个、`electron` 54 个模块 |

---

## 1. 会话与回合（threads）

| 功能 | 入口 | 现状 | 目标域 |
|---|---|---|---|
| 会话列表 / 新建 / 切换 / 重命名 | 侧栏 | `App.tsx`（`useThreads` 逻辑在 App 体内） | `features/threads/` |
| 会话导入 / 导出 / Markdown 导出 | 设置·备份、会话菜单 | `ipc: threads:*`（`main.ts` L7234–L7313） | 同上 |
| 回合流式渲染（文本/推理/工具调用/文件变更/审批卡） | 主区 | `App.tsx` 13 块 / 1,294 行（`TurnView` `ItemView` `ReasoningCard` `CommandExecutionCard` `RequestCard` `TurnFoldStream` …） | `features/threads/` |
| 钉顶 / 自动跟随 / 滚动锚点 | 主区 | `pinSentMessage` / `shrinkAnchorPad` / `anchorTopScroll`（**最高风险**） | `features/threads/`（**最后一批**） |
| 计划模式与可编辑计划构件 | 输入区模式钮 + 计划卡 | `src/components/PlanEditor.tsx` + `src/lib/plan-steps.mjs`（v0.0.26-b 新增） | `features/threads/` |
| 中断 / 停止 / 回合状态 | 输入区 | `App.tsx`（`turn-stop-reason.mjs` / `turn-order.mjs` / `turn-truncation.mjs`） | `features/threads/` |
| 会话配置（模型/effort/sandbox/权限） | 输入区、设置 | `thread-runtime` 存储 + `ipc: thread-runtime:*` | `features/threads/` |

## 2. 输入区（composer）

| 功能 | 现状 | 目标域 |
|---|---|---|
| 富文本编辑器 + 内联图片 chip + 附件菜单 | `ComposerEditor`(114) `PastedTextEditor`(99) `ComposerMenu`(41) + `composer-attachments.mjs` | `features/composer/` |
| 草稿 / 发送动画 / 增强提示气泡 | `composer-draft.mjs` `send-anim.mjs` `enhance-hints.mjs` | 同上 |
| 快捷键 | `src/lib/hotkey.mjs` | 同上 |
| 粘贴长文本转卡片 | `ipc: pasted-text:*` + `InlineFileCards` | 同上 |

## 3. 模型与供应商（models）

| 功能 | 现状 | 目标域 |
|---|---|---|
| 供应商目录 / 自定义供应商增删改 / 连通性探测 | `ipc: custom-model:*`（12，L8540–L8838）+ `model-specs` | `features/models/` |
| 模型列表 / 切换 / effort 档位 | `src/lib/effort.ts` `model-scope.mjs` + `EffortPicker.tsx` `ModelIdInput.tsx` `ModelSetupGuide.tsx` | 同上 |
| 「当前能力链路」（多后端时走哪条） | `electron/capability-registry.ts` + `capabilities:*`（v0.0.26-b 新增） | 同上 |
| 供应商连续性 / 重试 | `provider-continuity.mjs` `provider-id.ts` `provider-retry.ts` | 同上 |

## 4. 账号（中转站 / OpenAI 订阅）

| 功能 | 现状 | 目标域 |
|---|---|---|
| 中转站：登录 / 账号列表 / 启用停用 / 删除 / 切换 / 套餐与密钥 | `ipc: relay:*`（14，L4766–L5335）+ `RelayCenterPage`(693) `RelayBalanceBadge`(66) + **`electron/relay-accounts.ts`（纯函数判据，预检【89】）** | `features/relay/` |
| OpenAI 订阅：账号 / 额度监控 / 启用 | `ipc: openai:*`（12，L4997–L5325）+ `OpenaiSubscriptionPage`(332) `OpenaiOfficialCard`(84) `OpenaiBalanceBadge`(56) | `features/openai/` |
| 账号「生效」唯一判据 + 读取路径无副作用 | `relay-accounts.ts` | 同上（**已修，见 v0.0.26-b 说明**） |

> ⚠️ 这两个域的 handler **在 `main.ts` 里互相插花**（relay L4766–L5335 与 openai L4997–L5325 几乎完全重叠）。

## 5. 调度与专家（agents / dispatch）

| 功能 | 现状 | 目标域 |
|---|---|---|
| 调度开关（会话级 + 全局独占锁） | 顶栏 `DispatchMenu`(157) + `electron/dispatch.ts` | `features/dispatch/` |
| 专家 / 专家团 / 子智能体（三套一套语义） | `ipc: agents:9 teams:9 subagents:4 team-runs:1 team-threads:2`（**首 L583、末 L8296，跨 7,714 行**）+ `ExpertTeamEditorModal`(84) 等 9 块 | `features/agents/` |
| 专家中心（市场） | 设置页 `expert-center` + `electron/expert-teams.ts` `codex-market.ts` | 同上 |
| 新鲜上下文评审（内置子智能体） | `electron/builtin-agents.ts` + `developer-instructions.ts`（v0.0.26-b 新增） | 同上 |

## 6. 技能与扩展面（extensions）

| 功能 | 现状 | 目标域 |
|---|---|---|
| 技能中心（内置 / 市场 / 导入 / 启停） | `ipc: skills:8 plugins:4 builtin:5`（L6310–L7073 交织）+ `electron/builtin-skills.ts` `skills-market.ts` | `features/extensions/` |
| 连接器（OAuth） | `ipc: connectors:7`（L6862–L6982） | 同上 |
| MCP 服务器（覆盖项 / 启停 / 权限） | `ipc: mcp-servers:4` + `electron/nuphus-env.ts` | 同上 |
| 内置插件（视觉 / 文档转换等） | `ipc: plugin:1` + `components/BuiltinPlugins.tsx` `IndexLibrary.tsx` | 同上 |
| 命令与 Hooks（用户自定义） | `ipc: commands:5 hooks:2` + `electron/commands.ts` | 同上 |
| 配置面安全扫描 | `scripts/scan-config.mjs` + `scripts/lib/config-scan.mjs`（预检【86】） | 同上 |

## 7. 渠道与机器人（channels）

| 渠道 | IPC | 模块 |
|---|---|---|
| 微信 | `weixin:5` | `electron/weixin-gateway.ts` |
| 飞书 | `feishu:5` | `feishu-gateway.ts` `feishu-qr-connect.ts` |
| QQ | `qq:5` | `qq-gateway.ts` `qq-qr-connect.ts` |
| Telegram | `telegram:3` | `telegram-gateway.ts` |
| 钉钉 | `dingtalk:2` | `dingtalk-gateway.ts` |
| 企业微信 webhook | `wecom-webhook:3` | `wecom-webhook-gateway.ts` |
| 配对 / 审批 / 流式 / 绑定 | `bot:7 bot-stream:2 bot-binding:2 bots:2 channels:1` | `bot-pairing.ts` `bot-stream.ts` `channel-bot.ts` `channel-text.ts` + `hooks/useChannelBot.ts` + `BotBindCard`(346) |

→ 一族 5 个渠道 + 配对/审批，天然同一个域，目标 `features/channels/`。

## 8. 语音（voice）

| 功能 | 现状 | 目标域 |
|---|---|---|
| 语音设置 / 通话界面 / 悬浮球 / 波形 / 吉祥物 | `components/VoiceSettingsSection.tsx` `VoiceCallScreen.tsx` `VoiceCallFloat.tsx` `VoiceWaveform.tsx` `VoiceMascot.tsx` `VoiceDevToolsSection.tsx` | `features/voice/` |
| 回声消除 / 朗读 | `src/lib/voice-aec.mjs` `speak-text.mjs` `mic-error.mjs` | 同上 |
| IPC | `voice:39`（**最大域**，L1028–L1434）+ `VoiceSettingsBridge`（App 内） | 同上 |

## 9. 记忆（memory）

| 功能 | 现状 | 目标域 |
|---|---|---|
| 记忆分层 / 搜索 / 召回 / 历史 | `ipc: memory:17`（L8867–L8913）+ `electron/memory-layers.ts` + `hooks/useMemory.ts` | `features/memory/` |
| 记忆漏斗 / 分层编辑器 / 配置弹窗 | `MemoryFunnel`(97) `MemoryLayersEditor`(73) `MemoryConfigModal`(35) | 同上 |

## 10. 自动化与任务（automation）

| 功能 | 现状 | 目标域 |
|---|---|---|
| 定时任务 / 任务队列 | `ipc: scheduler:4 tasks:4` + `hooks/useScheduler.ts` | `features/automation/` |
| RPA 录制回放 | `ipc: rpa:4` + `electron/rpa-store.ts` + 设置页 `rpa` | 同上 |
| 桌面自动化（nuphus 桌面 15 工具） | 内置技能 `desktop-automation` + `automation-policy.ts` | 同上 |
| 浏览器自动化（nuphus 浏览器 23 工具） | 内置技能 `browser-automation` / `browser-skill` + `components/BrowserPane.tsx` + `ipc: browser:3` | 同上 |

## 11. 终端 / 远程 / SSH

| 功能 | 现状 | 目标域 |
|---|---|---|
| 终端面板 | `ipc: terminal:5` + `electron/terminal.ts` | `features/terminal/` |
| 远程控制（设备 / 状态） | `ipc: remote:11`（L5487–L5513）+ `electron/remote.ts` | `features/remote/` |
| SSH 服务器管理 / 执行 | `ipc: ssh:12` + `electron/ssh-servers.ts` + `SshTerminalModal`(107) `SshExecModal`(47) | `features/ssh/` |

## 12. 个性化与外观

| 功能 | 现状 | 目标域 |
|---|---|---|
| 主题 / 代码外观 / 头像 / 身份 | `ipc: personalization:6 theme:1` + `PersonalizationPage.tsx` `CodeAppearance.tsx` `CodexAvatar.tsx` `UserAvatar.tsx` `user-identity.mjs` `codex-identity.mjs` | `features/appearance/` |
| 用户中心 / 账号 | 设置页 `user` + `components/UserCenter.tsx` + `ipc: user:1` | 同上 |
| 小马驹（ponytail）模式与插件 | `ipc: ponytail:2` + `electron/ponytail-mode.ts` `ponytail-plugin.ts` | 同上 |
| 应用设置 | `ipc: appSettings:2` + `electron/app-settings.ts` | `features/settings/` |

## 13. 用量 / 备份 / 归档 / 存储

| 功能 | 现状 | 目标域 |
|---|---|---|
| 用量统计面板 | `components/UsagePanel.tsx` + 设置页 `usage` | `features/usage/` |
| 备份 / 恢复 | 设置页 `backup` + `electron/thread-backup.ts` | `features/backup/` |
| 归档 / 存储管理 | `components/ArchivePage.tsx` `ArchiveToast.tsx` + 设置页 `archive` `storage` | 同上 |
| 索引库 | `components/IndexLibrary.tsx` | 同上 |

## 14. 壳与基础设施（**不进 features**，留 `electron/` 顶层 / `src/components/`）

| 类别 | 现状 |
|---|---|
| 窗口 / 弹窗 / 剪贴板 / 文件选择 / 通知 / 唤醒 / 外部链接 / shell | `ipc: window:4 dialog:5 clipboard:4 fs:3 notify:1 awake:1 external:1 shell:1 scratch:1` |
| 引擎生命周期 / 更新 | `ipc: engine:4 updates:4` + `codex-server.ts` `engine-updater.ts` `updates.ts` `rollout-pool.ts` |
| 启动链 / 引导 / 崩溃兜底 | `BootSplash.tsx` `ErrorBoundary.tsx` `EnvCheckDialog.tsx` + `boot-timing.ts` |
| 工具链（随包运行时 / 开发工具页） | `electron/toolchain.ts` + 设置页 `devtools` + `scripts/install-runtimes.cjs` |
| 帮助 / 反馈 | `components/HelpDialog.tsx` `FlowDiagram.tsx` `GenerativeWidget.tsx` `MermaidDiagram.tsx` |
| 圆角窗口（Windows） | `electron/win-rounded-corners.ts`（**平台门控，mac 不加载**） |
| 数据桥 | `electron/responses-bridge.ts` `harness-services.ts` `config-toml.ts` `preload.ts` |

## 15. 内置技能（7 个，随应用种入）

| 技能 | 用途 |
|---|---|
| `desktop-automation` | 桌面 15 个工具（nuphus） |
| `browser-automation` / `browser-skill` | 浏览器 23 个工具 + 通用浏览器技能 |
| `humanizer` | 去 AI 腔（第三方，逐字保留 + sha256 断言） |
| `no-ai-slop` | 去空话套话（第三方） |
| `i-have-adhd` | 结论先行、说短（第三方） |
| `document-convert` | PDF/Word/PPT/Excel 互转（依赖**按需下载**） |

---

## 16. 映射到目标域（一页速查）

| 目标域 | 主要 IPC | 前端现状块 |
|---|---|---|
| `features/relay/` | relay:14 | `RelayCenterPage` + 2 |
| `features/openai/` | openai:12 | `OpenaiSubscriptionPage` + 2 |
| `features/models/` | custom-model:12 + model-specs + capabilities | 设置页 `model` |
| `features/voice/` | voice:39 | 6 个 Voice 组件 |
| `features/memory/` | memory:17 | 3 块 |
| `features/dispatch/` | thread-runtime（会话级） | `DispatchMenu` + `DispatchBadge` |
| `features/agents/` | agents/teams/subagents/team-*:25 | 9 块 / 354 行 |
| `features/extensions/` | skills/plugins/connectors/mcp-servers/builtin/commands/hooks:31 | 技能市场页 |
| `features/channels/` | 5 渠道 + bot 族:30 | `BotBindCard` + 渠道面板 |
| `features/threads/` | threads/thread-runtime/codex/engine:18 | **13 块 / 1,294 行（最高风险）** |
| `features/composer/` | pasted-text:3 | `ComposerEditor` 等 3 块 |
| `features/automation/` | scheduler/tasks/rpa:12 | RPA 设置页 |
| `features/terminal/` `features/remote/` `features/ssh/` | terminal:5 remote:11 ssh:12 | 3 个 Modal |
| `features/appearance/` `features/settings/` | personalization/theme/user/appSettings/ponytail:12 | 个性化页 / 用户中心 |
| `features/usage/` `features/backup/` | usage/backup/archive/storage | 4 个设置页 |
| 留在 `electron/` 顶层 | 壳族:31 | 引导 / 兜底 / 通用件 |

---

## 17. 已知限制与未完成项（改造前如实记录）

| 项 | 说明 |
|---|---|
| 供应商 id 命名 | `relay-<域名首段>` 会丢端口 ⇒ 同主机两个中转站撞同一 id（**未改**，改会让存量绑定失效） |
| 工具级审批 | 引擎 `approval_mode="prompt"` 实测**不发审批请求** ⇒ 该档在引擎内等于未生效（不是我们漏接） |
| 引擎 hook | 能力已从二进制确证，但**信任链路未验证**，用前必须先起探针 |
| `DispatchMenu` composer 变体 | **死代码**（无调用点），唯一入口是顶栏 |
| 历史命名残留 | 模型列表里 `pptoken`（旧命名）与 `relay-pptoken`（新命名）并存，未清理 |
| 设置页 29 个分支 | 全部硬编码在 `App.tsx`，是本轮"消样板"的主要目标 |
