# 功能清单（现行）

> 回答三个问题：**有哪些功能**、**各自的代码落点在哪**、**去哪找细节**。
> 口径：2026-11-27（v0.0.82）实测目录；一行一个能力，落点为渲染层目录 + 主进程域。
> 规则见 [`ARCHITECTURE-RULES.md`](ARCHITECTURE-RULES.md)，总体架构见 [`ARCHITECTURE.md`](ARCHITECTURE.md)，
> 逐轮变更史见 [`FEATURE-LEDGER.md`](FEATURE-LEDGER.md)。09-21 的「改造前基线」已归档。

---

## 1. 会话与回合

| 功能 | 渲染层落点 | 主进程域 |
|---|---|---|
| 会话列表 / 新建 / 切换 / 重命名 / 置顶 / 归档 / 分支 | `app-view/01-sidebar-shell`、`session-alias`、`session-cards` | `threads-*` |
| 回合渲染（文本 / 推理 / 工具调用 / 文件变更 / 审批卡） | `app-view/02-main-stage`、`async-run-feedback` | 引擎事件（无 IPC 域） |
| 消息排队 / 拖动排序 / 折叠 | `session-queue` | `queue-*` |
| 对话内搜索 / 会话导出 / 备份 | `app-view`、`storage-settings` | `history-*`、`threads-*` |
| 任务监控（后台跑批） | `task-monitor` | `task-*` |

## 2. 输入区与附件

| 功能 | 渲染层落点 | 主进程域 |
|---|---|---|
| 富文本输入 / 内联图片 chip / 附件菜单 / 粘贴长文转卡 | `app-view/03-composer`、`composer-rail`、`inline-cards` | `pasted-text-*`、`clipboard-*` |
| 提示词增强（AI 润色） | `composer` | `builtin`（模型调用） |
| 文档附件转 Markdown | `inline-cards`、`preview` | `markitdown` / `filee` 通道 |
| 技能 / 专家 / 命令 `@` `#` 引用 | `app-view/03-composer`、`harness-team` | — |

## 3. 模型与供应商

| 功能 | 渲染层落点 | 主进程域 |
|---|---|---|
| 供应商目录 / 自定义供应商 / 连通性自检 | `provider-setup` | `custom-model-*` |
| 模型切换 / 思考档位（含 Laya 自动档） | `app-view`、`app-state` | `model-*`、`laya` |
| 中转站账户（余额 / 套餐 / 切换） | `relay` | `relay-*` |
| OpenAI 官方订阅（设备码登录 / 额度） | `openai`、`auth` | `openai-*` |
| 账号库（启用 / 停用 / 删除） | `relay`、`openai` | `relay-accounts.ts`、账号存储 |

## 4. 调度与团队

| 功能 | 渲染层落点 | 主进程域 |
|---|---|---|
| 会话级调度（专家 / 子智能体 / 专家团 / CLI） | `dispatch`、`harness-team` | `delegation`、`agents-*`、`teams-*` |
| 专家团（SOP 编排 / 头像轨 / 成员会话） | `experts-teams`、`harness-team` | `teams-*`、`team-runs-*` |
| 工作伙伴群 / 群聊（资料卡 / @ 候选 / 群内搜索） | `harness-team`、`boss-group-view` | `boss-groups/*`、`group-*` |
| 指挥中枢（成员子会话展开 / 运行反馈） | `boss-group-view` | `boss-groups/runner.ts` |
| 像素办公室（成员工位） | `office-preview` | `office-*` |

## 5. 技能与扩展面

| 功能 | 渲染层落点 | 主进程域 |
|---|---|---|
| 技能中心（内置 / 市场 / 导入 / 启停） | `skills-market`、`skill-packs`、`skill-usage` | `skills-*`、`builtin-skills/` |
| 插件市场（Gitee 官方镜像 / Codex 官方市场） | `settings-plugins`、`codex-official-market` | `plugins-*`、`codex-market.ts` |
| 连接器 / MCP（可视化配置 / 逐工具权限） | `settings-mcp`、`connectors` | `mcp-*`、`mcp-gateway.ts` |
| 专家市场 / 人格市场 | `expert-market`、`soul-market` | `expert-market-*`、`soul-market-*` |
| 组件库 / 设计库 | `component-library`、`design-library` | `harness-api`、`design-md` |
| 命令 / 快捷键 / 钩子 | `commands`、`shortcuts` | `commands-*`、`hooks-*` |

## 6. 记忆

| 功能 | 渲染层落点 | 主进程域 |
|---|---|---|
| 记忆列表 / 原子浏览（只读） | `memory-ui`、`memory-list-tools`、`memory-atoms` | `memory-*` |
| 记忆落盘 / 分类 / 整洁 | — | `memory/atoms-*.ts`、`memory-lessons.ts`、`memory-hygiene.ts` |
| 知识库检索 | `knowledge-base` | `knowledge-*` |

## 7. 画布与创作

| 功能 | 渲染层落点 | 主进程域 |
|---|---|---|
| 无限画布（十类卡片 / 拖大 / 连线 / 模型工作流同步） | `drama-canvas` | `drama-canvas`（`workflow_read` / `workflow_writeback`） |
| 图像工坊（生成 / 修图 / 分层） | `image-lab` | `image-lab`、`builtin`（生图） |
| 视频导出（HTML → MP4）与视频生成 | `openfilm`、`media-desk` | `video`、`html-video` |
| PPT / 文档 / 网页预览 | `ppt-preview`、`html-preview`、`preview` | `preview` 协议 |
| 前端开发画布（嵌入式第三方站） | `ui-sketch` | `sketch://` 协议（零 IPC） |
| 产物归档 | `artifact-archive` | `artifact-*` |

## 8. 自动化与工具

| 功能 | 渲染层落点 | 主进程域 |
|---|---|---|
| 桌面自动化（键鼠 / 截屏 / OCR / 窗口） | `settings-computer` | `nuphus` + `agent-desktop`（随包） |
| 浏览器自动化 / 内置浏览器 | `settings-browser`、`app-view` | `browser-*`、Ego Lite |
| RPA 配方 | `settings-rpa` | `rpa-*` |
| 终端（xterm，会话级持久化） | `terminal` | `terminal-*`（node-pty） |
| Python / Node / 工具链安装 | `settings-devtools` | `runtime-*`、`install-runtimes.cjs` |
| SSH / CLI 智能体 / 开发端口 | `ssh`、`cli-agents`、`dev-port` | `ssh-*`、`cli-agent-*`、`devport-*` |

## 9. 语音与提醒

| 功能 | 渲染层落点 | 主进程域 |
|---|---|---|
| 离线语音通话 / 听写 / 音色克隆 | `voice-announce`、`app-state` | `voice/*`（sherpa-onnx） |
| 定时任务 / 轮询 | `settings-schedule`、`polling` | `scheduler-*`、`poll-*` |
| 桌宠 / 壁纸 | `pet`、`wallpaper` | `pet-*`、`wallpaper-*` |
| 自媒体工作台（图文成稿出口） | `media-desk` | `media-*` |

## 10. 远程与连接

| 功能 | 渲染层落点 | 主进程域 |
|---|---|---|
| 手机扫码接入（配对码 + 电脑审批 + 看屏） | `settings-computer`、`profile-onboarding` | `remote.ts`、`remote/*` |
| 机器人接入（微信 / QQ / 飞书 / 钉钉 / Telegram） | `bot`、`settings-*` | `bot-*`、`channels-*` |
| 应用锁 | `app-lock`、`settings-app-lock` | `app-lock.ts` |

## 11. 设置页

`settings-*` 目录一页一个板块（general / appearance / model / memory / skills / plugins / mcp / agents /
agentteam / boss-groups / teams / schedule / automation / computer / browser / rpa / screenshot / ssh /
cli-agents / cli-sync / devtools / commands / hooks / backup / archive / favorites / pet / cloud /
extensibility / app-lock …），按 `settingsPagesOf(app)` 注册表一行一页渲染。

## 12. 系统与更新

| 功能 | 渲染层落点 | 主进程域 |
|---|---|---|
| 应用内更新（完整包 / 点胶囊才下载） | `app-update` | `updates.ts`、`updates-*` |
| 新功能介绍 / 新手引导 | `whats-new`、`newbie-guide` | `whatsnew-*` |
| 数据目录 / 存储 / 导入导出 | `storage-settings`、`import-records` | `registry`、`data-dir` |
| 事件广播（多窗口同步） | `event-broadcast` | `broadcast-*` |

---

## 13. 怎么核对这份清单是否过期

```bash
ls -d src/features/*/ | wc -l          # 渲染层域目录数（本文写于 103）
ls electron/features | wc -l           # 主进程域条目（158）
node -e "console.log(Object.keys(require('./electron/ipc-channels.manifest.json').channels||require('./electron/ipc-channels.manifest.json')).length)"  # 通道数（725）
```

新增板块时同轮更新本表（规则见 `ARCHITECTURE-RULES.md` §2.2「新增板块 checklist」）。
