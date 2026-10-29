#!/usr/bin/env node
/**
 * gen-capability-skill —— 生成「宿主接口清单与可拓展能力」内置技能。
 *
 * 数据源（单一真相源）：
 *   · electron/ipc-channels.manifest.json —— 全部 IPC 通道
 *   · electron/ipc-registry.ts           —— 域表（prefix/channels）
 *   · 本脚本内 DOMAIN_DESCRIPTIONS       —— 每域的「用户可感知能力」描述（人工维护）
 *
 * 输出：electron/builtin-skills/14-skill-harness-api.ts（导出 HARNESS_API_SKILL 静态字符串）。
 * ⛔ 技能正文必须是字面量（预检【86】按源文件文本做安全扫描）⇒ 不能运行时拼，只能生成后落盘。
 * ⛔ 加新 IPC 域/通道后重跑本脚本（守卫【153】会比对生成物与数据源是否一致，过期即红）。
 * 用法：node scripts/gen-capability-skill.mjs [--check]
 *   --check：只比对不写（守卫用）；落盘文件与将生成内容不一致时 exit 1。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "electron", "builtin-skills", "14-skill-harness-api.ts");

/* ── 每域的「用户可感知能力」描述（人工维护；新域必须补，缺了生成器报错）──
   口径：写给引擎看 —— 用户提什么需求时该想到这个域、能力边界在哪。一句话。 */
const DOMAIN_DESCRIPTIONS = {
  "feishu-cli": "飞书官方 CLI（@larksuite/cli）：安装（约 51MB，npm 国内镜像）、飞书应用配置（config init）、用户登录授权（device flow）与命令执行；安装/登录在「设置 → 开发工具 → 飞书 CLI」完成，Codex 通过 feishu_cli 工具调用",
  "sessionspace": "会话专属工作区（10-29）：每个会话在项目地址下有一个 `<project>/.codex-harness/sessions/<threadId>/`，作为本会话的产物与临时落点。生命周期：新建即建、归档保留（可恢复）、永久删除时目录一并清理、启动时收口孤儿。⛔ 它不是记忆 workspace —— 项目记忆仍按项目根寻址（跨会话共享），会话私有走 private 层",
  "dataaccess": "收藏夹 / 开发日记 / 密码本**对模型开放**的授权闸（10-29）：按「会话 + 模块 + 读/写」三元组授权，默认全关、只存在内存（应用退出即失效）。开启后收藏与日记只允许 read + append（⛔ 不能删/改历史）；密码本只允许存在性查询与「复制到剪贴板」（明文永不出主进程），写入必须先经用户在界面一次性确认。⛔ 没有删除类通道 —— 删除只能由用户本人在界面操作",
  "shortcuts": "键盘快捷键统一读口（10-28）：应用内快捷键存 userData/shortcuts.json，弹窗与「设置 → 控制台 → 键盘快捷键」读写同一份；截图/语音的全局键仍存各自设置文件（它们的 setter 要先注册成功 globalShortcut 再落盘），本域只读来聚合展示。⛔ 模型侧不调用它——改键是用户界面动作，不是工具能力",
  "openfilm": "OpenFilm 视频剪辑（第三方开源 github.com/openfilm/openfilm，MIT + 商标条款）对接：设置 → 工具页可**按需下载**命令行与渲染引擎（npm 走 npmmirror、Chromium 走 cdn.npmmirror，失败自动回官方），可卸载、可查最新版（自动更新三档）。数据面只有状态/安装/卸载/查版本；⛔ 不内置上游二进制，卸载只删运行时、不碰用户 film 目录",
  "app-lock": "应用密码锁（设置 → 应用锁，默认关闭）：开启时生成随机或自定义解锁密码，明文只展示一次、磁盘只存 scrypt 加盐哈希；应用启动/重新显示时先锁屏。错误次数落盘，连续 10 次错误会清空应用数据并重置。⛔ 这是界面门禁，不是磁盘加密；模型侧不调用它",
  "work-logs": "各项目的**工作日志与项目记忆**管理（<项目>/.codex-harness/memory/**：长期记忆 MEMORY.md / 坑与纪律 LESSONS.md+lessons/ / 每日工作日志 logs/YYYY-MM-DD.md / archive / project）——设置 → 数据管理 → 工作日志。可看正文、按项目与类型分组、批量删除。⛔ 这是项目里的工作记录，与会话本身的归档 / 删除（「归档管理」页）不是一回事；删除是销毁性的（工作日志删了不会重建）",
  "video": "内置视频生成接口（国内外 8 家：可灵/万相/Seedance/CogVideoX/MiniMax/Runway/Luma/Veo）：submit 提交 → poll 轮询 → download 落工作区；凭证存 userData/video-providers.json",
  "poll": "轮询板块的配置与中止（间隔 / 超时上限 / 失败重试次数，存 userData/poll-settings.json；poll:abort = 用户在界面上按「中止」时停掉主进程的等待循环）。⛔ 这是**轮询行为**的配置，不是任务本身 —— 提交/查询任务走 video 域那套工具",
  "drama-canvas": "AI 短剧无限画布：把工作流拆成卡片摆在无限画布上（生图/短剧/白模/3D 建模/电商出图各类模板），连线表示「这份输入喂给下一步」。**画布可被模型读写**：board-sync 由画布自动镜像快照，模型用真工具 workflow_read 读内容、workflow_writeback 把产物写回节点（卡片实时显示）——「按画布搭的流程跑」是可行请求",
  "phone": "手机控制（phone-harness）：查状态 / 安装 / 卸载 / 体检 / 权限引导；Android 走 adb（全平台），iPhone 走 Mac 的 iPhone 镜像（仅 macOS）",
  "codex": "渲染层与引擎（@openai/codex app-server）之间的请求桥：转发请求 / 响应 / 切活跃会话",
  "threads": "会话列表与元数据（归档、重命名、血缘、会话摘要等）",
  "thread-runtime": "会话运行态（派发所有权、运行/闲置状态机）",
  "queue-timer": "排队消息的定时发送（主进程定时器；窗口最小化 / 被遮挡时不被 Chromium 节流）",
  "engine": "引擎生命周期（重启 / 换模型档位 / 状态查询）",
  "capabilities": "宿主能力快照（当前环境支持什么，一次性拉取）",
  "bridge": "引擎桥连接状态",
  "prompt": "提示词增强（把用户草稿改写为更完整的 prompt）",
  "model-viewer": "**3D 模型预览**（10-05）：read(path) 读会话工作区里的 .glb / .gltf 模型（可信根内、≤256MB，字节直传给预览弹窗）。通常不直接调 —— 引擎侧走 harness_tools 网关的 `preview_3d` 在应用内弹出可旋转的 3D 预览；本域通道是渲染层弹窗的取数后端",
  "html-video": "**本地 HTML→MP4**（10-11，P1）：render(source, seconds?, fps?, width?, height?, outPath?) 把一段 HTML/CSS 动画在本地渲成 MP4 —— Chromium 抓帧 + 运行时自带 MP4 编码器，**零 ffmpeg 依赖、不联网、不花厂商额度**。source = 可信根内的 .html 绝对路径或 http(s) URL（其余一律拒）；outPath 同样过可信根闸，不传落 <userData>/renders/。模型侧走 harness_tools 网关的 `video_render_html`。典型用法：把工作区里做好的界面/动画/分镜 HTML 成品化成 mp4",
  "image-lab": "**图像工坊**（10-09，Windows/Mac 同一份实现）：read(path) 读图片字节（可信根内、图片扩展名白名单、≤128MB，直传给浮层预览）。⛔ 模型侧不直接调这条通道 —— 四个工具是**各自独立的 dynamicTool**（不走 harness_tools 网关），且各有一条自己的 IPC：`image_generate`→image-lab:generate（**唯一要生图插件凭证的**）、`image_edit`→image-lab:edit（修图：缩放 / 裁剪 / 旋转 / 翻转 / 转格式 / 明暗对比 / 灰度·棕褐 / 模糊 / 马赛克 / 水印合成 / 加英文文字——中文会画成空白；**零凭证**，产出不覆盖原图）、`image_info`→image-lab:info（读尺寸·格式·透明·字节数）、`image_view`→image-lab:view（应用内弹浮层给用户看）。改「形」用 image_edit、改「意」（换主体/风格）用 image_generate；只做小改动前先 agent_ask 问用户。生成与编辑都会弹「图像工坊」浮层，工具调用结束自动收起。⛔ 编辑引擎是 jimp（纯 JS），不许换成 sharp/canvas 这类原生库",
  "whatsnew": "「更新到新版本后首次启动」的**新功能介绍弹窗**（10-06）：state 取该版本的要点与「该不该弹」（判定含：这个版本有没有要点、用户看过没有、是升级还是全新安装——全新安装不弹，避免新用户看到莫名其妙的「更新内容」）；ack 记下当前版本已看过 ⇒ 同版本不再弹。要点数据在主进程 electron/whats-new-notes.ts，每次发版要加一条（守卫【11r】钉）。⛔ 模型侧用不到它",
  "kb": "**项目级本地知识库**（<项目>/.codex-harness/knowledge/）：list 列文档 / add-text·add-files 导入 md·txt·代码文档（自动分块）/ search 分块全文检索（带高亮片段）/ read 读全文 / remove 删除。用户要「把资料存进知识库 / 查项目资料」时用它；语义向量后端为按需下载项。⛔⚠️ 上面是 **IPC 桥（给设置页 UI 用），不是模型工具** —— 模型侧只有两个：`knowledge_search(query, limit?)` 检索（workspace 缺省 = 调用者 cwd；装了 Laya 时最相关的一条会被置顶标注）与 `knowledge_add(title, text, source?)` 写入（10-04 补，此前模型只能读不能写；⚠️ 同名不覆盖会堆重复条目、⚠️ 写入不做语义向量化、⚠️ 专家/被调度会话不许写、⚠️ 装了 Laya 时低价值内容会被拒写并说明原因——充实内容后重试即可）。⛔⛔ **但只有「知识库后端 = 本地」时才是这两个**：后端切到**云端 weknora** 后，检索与写入一律走 MCP 连接器 \`cloud-kb\` 的工具（\`cloud_kb__ask\` / \`cloud_kb__search_knowledge\` / \`cloud_kb__grep_chunks\` / \`cloud_kb__list_documents\` / \`cloud_kb__read_document\` / \`cloud_kb__list_knowledge_bases\`），本地那两个此时**不在工具列表里**。判定方法：工具列表里有 \`cloud_kb__\` 前缀 ⇒ 云端；否则本地。切换**不迁移数据**（本地库与云端库是两份），详见内置技能 \`knowledge-backend\`",
  "cloud": "**云端会话同步**（10-18 自云助手移植）：把本机会话**按行增量**推到云端、按需从云端拉回、以及冲突解决（`cloud:sync/status|push|pull|conflict/resolve`）。⛔ 与 cloud-auth（登录）/ cloud-models（模型目录）是并列的独立板块。用户说「上传会话 / 同步会话到云端 / 从云端恢复会话」时用它。⛔ 服务端可能由管理员关闭同步，此时会返回 `session-sync-disabled`（人话「管理员已关闭云端会话同步」），不要当成网络故障重试",
  "cloud-auth": "**云账号**的登录 / 登出 / 切换（10-16）：用账号密码换云端会话令牌（⛔ 不是配对流程）；令牌在 safeStorage 里，⛔ 渲染层与模型侧都拿不到明文。用户说「登录云端 / 退出云账号 / 换个云账号」时用它。⛔ 与本机「中转站账号」是两条独立的登录线，别混",
  "cloud-models": "**云端模型目录同步**（10-16）：登录后自动把云端「已勾选」的模型写成本机供应商 `cloud`（勾选 = 下拉框可见），并默认每 10 分钟自动保持更新。用户说「云端模型没同步 / 拉一下云端模型 / 勾了模型选不到」时用它（sync 是唯一同步入口，force=true 会重签代理令牌）",
  "cloud-kb": "**云端知识库**（跨设备共享的那一份）→ 本机 MCP 连接器 `cloud-kb`（10-16）。⛔ 与「本地项目级知识库」（kb 域，随项目走）**不是一回事**：这份存在服务端，换台机器登录也在。未开通权益时服务端不建库不发钥匙，本域只会如实报 not-activated",
  "cloud-memory": "**云端记忆**的凭据与上游切换（10-16，10-17 修正）。⛔ 记忆中枢**没有记忆读写接口**（所有路径都是同一个 OpenAI 兼容转发口），**也没有 MCP 端点** ⇒ 记忆不是靠工具调用的，而是在**对话请求层**由服务端自动注入/写入。所以本域做的是：拿到该账号的 userKey 后把**对话上游切到记忆端点**（记忆即全域生效，且天然按账号隔离）。未开通/被停用时自动切回。用户说「云端记忆没生效 / 打开云端记忆」时用它。",
  "team": "**团队工作模式**（10-24）：list 我加入的团队 / enter 进入（把对话上游切到**团队记忆**端点 + 团队知识库接成 cloud-kb-team 连接器）/ exit 退出（记忆回落纯模型、个人知识库按原状态恢复）/ status 生效状态。⛔ 记忆通道是独占的：进入团队 = 个人记忆暂停；团队库与个人库不能同时接（两个 WeKnora 工具名相同）。用户说「切到团队 / 团队记忆不生效 / 团队知识库连不上」时用它",
  "pet": "桌面宠物（官方 Codex 宠物格式：pet.json + 8×9 图集）：list 发现四目录宠物 / settings-get·set 开关与选择 / roots 目录清单 / open-dir / import 从只读目录导入用户区 / toggle·show·hide 显示控制。宠物本体渲染在独立透明置顶浮窗，宿主侧只做发现与设置",
  "laya": "Laya 智能判断（GitHub NandhaKishorM/laya，Apache-2.0，非自回归决策引擎 33ms）：status 安装与服务状态 / install 安装更新（pip 清华镜像 + 权重走 hf-mirror）/ decide-effort 思考等级自动判断（choice: low/medium/high/xhigh + 校准置信度，<0.45 弃权）/ judge = 模型工具 laya_judge 的执行端（短文本多选一判断：知识价值 / 重复 / 自定义 2~6 项；装了 Laya 才在工具面出现，低置信弃权、绝不自动安装）——渲染层思考档「自动」开关的数据端；失败一律降级手选档，不是硬依赖",
  "html-preview": "HTML 实时预览（独立板块）：watch 开始盯一个 HTML 文件（可信目录 + .html/.htm/.xhtml 白名单 + 120ms 防抖）/ unwatch 停止；文件变更推 harness 事件 html-preview:changed。渲染层据此自动打开右栏浏览器、按比例加宽，并让 webview 无缓存重载 —— 模型写 HTML 时用户能实时看到页面",
  "expert-market": "SkillHub **专家市场包**（skillhub.cn/skillspackage，55 包）：list 浏览/搜索、install 一键安装——元技能 + orchestration.children 子技能落盘技能目录 + **专家中心自动新增对应专家卡片**（卡片 systemPrompt = 包元技能正文）。用户要「装个专家/装套工作流」时用它",
  "soul-market": "SkillHub **人格市场**（skillhub.cn/soul，16 套现成人格）：list 浏览 / get 看人设全文 / current 当前生效 / apply 应用人格（写 personalization.persona + 同步 AGENTS.md，**下一个新会话生效**，slug=null 还原默认）。用户想「换个性格/语气」时用它",
  "history": "跨会话历史搜索（全文检索会话与消息，命中按会话分组）",
  "external": "用系统默认浏览器打开外部链接",
  "agents": "子智能体库（创建/归档/委派/目录；成员会话与角色）",
  "subagents": "子智能体——**可创建**：用户要「新建一个子智能体/代理」时，**直接用真工具 `subagent_save`**（name+systemPrompt 必填；同 name 即更新）→ `agent_invoke` 派活",
  "cliagents": "CLI 智能体（10-29）：把外部命令行工具（Claude Code / Codex CLI / Gemini CLI / Aider / OpenClaw / 自建入口）当成**可调度对象**，与专家、子智能体一起出现在输入框 `@` 候选里，派活走 `agent_invoke`（kind=\"cli\"）→ 同一个 runDelegatedTask（开独立会话、登记归属、产出回传）。管理面在「设置 → 开发工具 → CLI 智能体」：按分类（编码 / 通用智能体 / 自建）分组、搜索、检测是否已装（where/which + --version）、复制官方安装命令、启停、新增自定义条目。⛔ 这一步**不能**替你一键安装：installCmd 只在核实过官方来源时才有值，其余显示「按官方文档安装」；⛔ 模型侧没有增删 CLI 定义的通道 —— 用户要接入新 CLI 时，请让他在这个面板里添加（或直接填可执行名）",
  "teams": "专家团/专家的定义与成员管理——**可创建**：用户要「新建一个专家/专家团」时，**直接用真工具 `expert_save`**（先 `expert_list` 查重；normalize 自动补默认与 id 规范；teamId 相同即覆盖更新）。字段：displayName/profession/description（zh+en）/category/tags(≤3)/quickPrompts(≤3)/sop；lead 必带 name+systemPrompt；多角色协作加 members[]（每人 name+profession+description+systemPrompt）。⛔ 内置专家（知微/呈象/洞明/鲁班/画意/剪承团）每次启动确保存在——不要用与内置相同的 teamId 去覆盖内置定义，新建用独有 teamId；建完向用户复述 teamId 与成员名单",
  "boss-groups": "创世 boss 群编排：建群/派活/独立评审/打回换人/预算闸（成员各自一个常驻会话，浏览器用 ego lite 独立 TaskSpace）",
  "team-runs": "专家团运行记录查询",
  "close-confirm": "关闭确认弹窗的回包（最小化到托盘 / 完全退出 / 取消，可勾不再询问）",
  "team-threads": "专家团成员会话映射",
  "bot": "Bot 会话（Bot 与会话的绑定与消息注入）",
  "bots": "Bot 定义管理",
  "bot-binding": "Bot 与会话/IM 的绑定关系",
  "bot-stream": "Bot 流式输出转发",
  "channel-bot": "IM 通道 Bot（把某个会话接到 IM 机器人上）",
  "weixin": "微信机器人（iLink bot）：登录绑定/状态 + **主动推送 weixin:send**（to 缺省=最近对话用户；正文依赖 context_token）",
  "telegram": "Telegram 通道",
  "feishu": "飞书通道",
  "dingtalk": "钉钉通道",
  "qq": "QQ 通道",
  "wecom-webhook": "企业微信 webhook 通道",
  "channels": "IM 通道总开关与状态",
  "memory": "记忆金字塔全链路（L0~L7 分层读写、召回、蒸馏、清理计划/执行、云端网关、工作区开关、记忆后端**三选一**：内置金字塔 / 本地 MCP 记忆服务 / 云端 memapi）",
  "skills": "技能经验包（导入/启停/市场安装/本地列表）",
  "skill-packs": "**精选技能包**（10-30，开发工具页按需安装）：list 三个第三方技能包的状态 / install 下载仓库 `skills/` 子树、每个 SKILL.md 过安全审查后落 `<codex-home>/skills`、装完重启引擎 / uninstall 只删自己 marker 记下的目录。⛔ 不是模型工具（模型侧看到的技能仍由引擎技能表提供），给设置页 UI 用",
  "autoUpdate": "自动化能力与引擎的**后台自动更新**：桌面自动化 nuphus / Mac 电脑操作 open-computer-use / Codex 引擎各一个独立开关（缺省即开，存 app-settings.json）；浏览器自动化 Ego Lite 单独一个开关（默认关，开启后后台跑官方 ego-browser upgrade）。⛔ 手动更新与后台更新走**同一批函数**，不存在两套判据",
  "commands": "斜杠命令（自定义 / 命令的定义与管理）",
  "skill-discipline": "技能纪律（写技能时必须遵守的硬规则查询）",
  "plugins": "插件市场（安装/启停/列表）",
  "codex-official-market": "Codex 官方插件市场（GitHub openai/plugins 走国内镜像：清单/分类/一键安装/卸载/本地已装）",
  "builtin": "内置模型供应商目录（读/存/探测/图像模型）",
  "hooks": "钩子（会话生命周期挂钩配置）",
  "connectors": "MCP 连接器（外部 app/服务接入：增删改查、启停、OAuth）",
  "mcp-servers": "MCP 服务器管理（配置/状态）",
  "plugin": "插件卸载入口",
  "ponytail": "写代码模式插件（会话钩子 + 技能的宿主侧开关）",
  "tools": "引擎工具面状态（动态工具是否注册）",
  "rpa": "RPA 配方（录制好的桌面自动化流程）",
  "tasks": "任务清单（用户待办，可从对话生成）",
  "scheduler": "定时任务（一次性/周期：创建/启停/列表/手动运行）。save 支持 deliver:{channel:'weixin',to?}——到点执行后把回合结论主动推给微信用户（to 缺省=最近对话用户）",
  "ssh": "SSH 服务器库（保存/执行远程命令/导入导出/会话终端）",
  "fs": "受控文件系统访问（读写/存在性检查，路径受信任目录约束）",
  "domains": "**宿主功能域**的清单与启停（设置 → 开发工具 → 功能域）——停用支持**真热插拔**（通道立即消失、无需重启），但持有跨域共享单例的域（server / codexHome / mainWindow / toolsRoot 的主人）只能重启生效。承载应用自身能力的域（身份/对话主链路/基础对话框）不可停用",
  "declared-plugins": "**声明式插件**清单与启停（设置 → 开发工具 → 声明式插件）——插件是一份 JSON（用户目录 codex-home/harness-plugins 或内置 declared-plugins），只描述往哪个插槽挂什么内容、调哪条**已有**通道，不含任何代码。插槽即时生效、无需重启。⛔ 不加载第三方 JS：主进程是特权域（密钥库/开窗/全盘 fs），进代码即提权",
  "shell": "系统默认方式打开文件/目录",
  "dialog": "文件/目录选择对话框（含跨窗口）",
  "clipboard": "剪贴板（读写文本/图片）",
  "notify": "系统通知（托盘气泡）",
  "awake": "阻止系统休眠（长任务期间保持唤醒）",
  "runtime": "随包运行时管理（node/python 等的安装/卸载/列表）",
  "window": "窗口控制（最小化/关闭/置顶/弹出一个独立小窗）",
  "app": "应用级杂项（版本、存储用量、缓存清理、重启、加载目录）",
  "backup": "改动备份的**查询与恢复**（设置 → 数据管理 → 改动备份：开关、备份目录、产物概览、清空）。备份本身由宿主在**每个回合结束时自动完成**（落 changes-index/<会话id>.json + changes-detail/<会话id>/cd_*.json，结构与 WorkBuddy 同构，**容量上限 3G，超了把最旧的移进系统回收站**，不是硬删）。\n\n**用户说「之前那次改动找不回来 / 改错了想回退」时用这一套自己查自己办**：`backupListAll`（有哪些备份可捞）→ `backupReadChange`（那次到底改了哪些文件、增删多少、差异内容）→ `backupRestoreFile`（把某个文件回滚到那一版）。⛔ `backupRestoreFile` 需要备份里存有**整份正文**才回滚得动，而默认只存 hunks（省空间）⇒ 常会回 `needs_full_content`，此时**如实告诉用户**「备份里有这次改动的差异但没有整份正文」并据 hunk 定位手工改，不要反复重试。⛔ 没有「一键整条回滚」：那会连带覆盖用户之后的改动。`backupPrune` 可手动触发一次容量清理。⛔ 清空备份不可恢复，动之前先问过用户",
  "appSettings": "应用级开关（联网搜索/桌面自动化/下载源等，写 app-settings.json）",
  "theme": "主题（亮/暗/跟随系统）",
  "user": "用户档案（昵称等，供个性化显示）",
  "personalization": "个性化（昵称/自定义指令，落 personalization.json 并写入引擎 AGENTS.md）",
  "dataDir": "数据目录自定义（userData 重定向 + 启动期自动迁移；改后重启生效）",
  "updates": "应用自更新（检查/下载/安装，GitHub Release 单源）",
  "remote": "远程会话（手机/网页端远程接入宿主）",
  "relay": "账号库（OpenAI 账号多账号管理：导入/切换/启停/用量概览）",
  "openai": "OpenAI 账号鉴权（登录/凭据/额度）",
  "custom-model": "自定义模型供应商（接入任意 OpenAI 兼容端点：CRUD/探测/测活）",
  "model-specs": "模型规格（effort 档位等引擎参数）",
  "git": "仓库 diff 读取",
  "browser": "浏览器自动化（Ego Lite 检测/安装/打开/升级/回收 Space + 内置预览弹窗）",
  "terminal": "内置终端（创建/输入/缩放/重启）",
  "screenshot": "截图（冻结帧框选/保存/历史）",
  "favorites": "收藏夹（收藏消息/片段，一键再发送）",
  "scratch": "临时便签（快速记一条）",
  "pasted-text": "粘贴文本暂存（大段粘贴落盘防丢）",
  "voice": "语音通话全链路（呼叫/音频流/转写/打断/挂断，39 通道）",
  "vault": "本机**密码本**（输入框左侧竖条 → 密码本）：list 列条目 / save 新增或改（password 省略即保留原密码）/ remove 删除 / copy 把某条密码写入系统剪贴板（30 秒后若还是这条就自动清空）。⛔ 密码用系统 safeStorage 加密落 userData/vault.json，**明文永不落盘、渲染层与模型侧都拿不到**；加密不可用时拒绝保存。模型侧用不到它",
  "journal": "**开发日记**（竖条 → 开发日记）：按天一个 Markdown 文件（userData/dev-journal/YYYY-MM-DD.md）—— list 列日期与摘要 / read 看当天全文 / save 整篇覆盖 / append 追加一条「## HH:mm 标题 + 正文」/ remove 删当天 / search 全文检索。⛔ 与会话归档、项目工作日志是三件不同的事",
  "extensions": "竖条与功能入口菜单的**可扩展目录**（extensions:catalog）：内置四项面板 + userData/extensions.json 里用户自建项，渲染层据此渲染，不改代码就能多一个入口。⛔ 扩展项只能声明封闭动作集（http(s) 链接 / 跳到某个设置页 / 纯说明文字）—— 没有「执行命令」这类动作",
  "team-runs-placeholder": "",
};

/* ── 抽取 registry 域表（正则足够稳：条目格式由守卫【90】钉住）── */
const registrySrc = fs.readFileSync(path.join(ROOT, "electron", "ipc-registry.ts"), "utf8");
const domains = [];
const entryRe = /prefix: "([a-zA-Z-]+)", count: (\d+), status: "[a-z-]+", file: "([^"]+)",\s*\n\s*channels: \[([^\]]+)\]/g;
let m;
while ((m = entryRe.exec(registrySrc))) {
  const channels = [...m[4].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  domains.push({ prefix: m[1], count: Number(m[2]), file: m[3], channels });
}
if (!domains.length) { console.error("没从 ipc-registry.ts 抽到域 —— 条目格式变了？"); process.exit(1); }

/* 与 manifest 对账：通道全集必须被域表覆盖 */
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "electron", "ipc-channels.manifest.json"), "utf8"));
const manifestChannels = manifest.channels.map((c) => c.channel);
const domainChannels = new Set(domains.flatMap((d) => d.channels));
const uncovered = manifestChannels.filter((c) => !domainChannels.has(c));
if (uncovered.length) { console.error("manifest 里有通道不在域表：" + uncovered.join(", ")); process.exit(1); }

/* 缺描述的域 ⇒ 报错（新域必须补描述，防止清单带 TODO 出炉） */
const missing = domains.filter((d) => !(d.prefix in DOMAIN_DESCRIPTIONS));
if (missing.length) {
  console.error("以下域缺能力描述，请补进 gen-capability-skill.mjs 的 DOMAIN_DESCRIPTIONS：\n  " + missing.map((d) => d.prefix).join("\n  "));
  process.exit(1);
}

/* ── 组正文 ── */
const totalChannels = domains.reduce((a, d) => a + d.count, 0);
const lines = [];
lines.push("---");
lines.push("name: harness-api");
lines.push("description: Codex Harness Desktop 宿主的接口清单与可拓展能力。当用户提「做个功能 / 加个集成 / 能不能自动 XX / 宿主有没有 XX 能力 / 帮我接上 XX」这类需求时先读它 —— 按域查现成接口，不用扫描源码，也不要重造宿主已有的能力。");
lines.push("---");
lines.push("");
lines.push("# 宿主接口清单与可拓展能力（自动生成，勿手改）");
lines.push("");
lines.push(`数据源：electron/ipc-channels.manifest.json（${domains.length} 个能力域 / ${totalChannels} 个通道），由 scripts/gen-capability-skill.mjs 生成。`);
lines.push("");
lines.push("## 怎么用");
lines.push("");
lines.push("- 通道名格式 = `域前缀:动作`（渲染层 ⇄ 主进程的内部接口）。**按域查**：用户的需求落在哪个域，就看那个域有哪些动作 —— 有现成域说明能力已存在，要做的是「接入/扩展」，不是重造。");
lines.push("- ⛔⛔ **这些通道不是模型能直接调用的工具**（09-28 加：用户问「你会不会定时任务 / 为什么建不了」，模型据此误解过）。它们只有**应用界面**（按钮 / 设置页）会调。模型在会话里能用的只有三类：① 内置调度 MCP 暴露的**真工具**（下一段的清单）；② 各技能正文教的流程；③ 命令行（node 脚本 / `codex` 子命令）。");
// ⛔ 09-29：工具清单必须**穷举**且随实现更新 —— 此前这段只点名 agent_invoke / agent_archive_sessions，
//    后来加的调度四件套靠另一条「例外」补，媒体四件套（image_generate / video_generate / video_status /
//    video_concat）则**一直没写进来** ⇒ 模型不知道有生图生视频工具，退回「让用户自己去点界面」。
//    改法：清单集中在一处、按域分组，新增 MCP 工具时改这里并重跑生成器（守卫【153】比对生成物）。
lines.push("  **内置调度 MCP 当前暴露的工具**（09-29 现状；实际以 tools/list 返回为准）：");
lines.push("  · 调度：`scheduler_save`（建定时任务，`threadId:\"current\"` = 就在当前会话里续聊执行）/ `scheduler_list` / `scheduler_run` / `scheduler_delete`");
lines.push("  · 媒体：`image_generate`（生图，`count` 1–4 并发出变体，落盘返回本地路径）/ `video_generate`（提交视频任务，**立即返回 jobId，不等待**；`video` 参数可传白模预演参考片的公网 URL，配 Seedance 2.0/2.5 渲染）/ `video_status`（查任务；成功会自动下载落盘；给 `wait: true` 就**由宿主一直查到出片/失败/超时**再返回，别自己写循环反复调用）/ `video_concat`（把多镜片段按给定顺序拼成成片）/ `voice_generate`（台词合成配音 WAV，落盘返回路径；语音模型未下载时报错并指路「设置 → 语音」）/ `image_edit`（**修图**：缩放·裁剪·旋转·翻转·转格式·明暗对比·灰度·模糊·马赛克·水印合成·加英文文字【中文会画成空白】，按 ops 顺序执行）/ `image_info`（读图片尺寸·格式·透明·字节数）/ `image_view`（在应用内弹浮层把这张图给用户看）");
lines.push("  · 语音播报（10-09）：`voice_announce`（**立刻念一句话**给用户听 —— 插播，不必等本轮回复结束；≤120 字；实时语音通话中不可用，那时直接写进回复就会被念出来。⚠️ 即时发送、不等回执：没出声不会报错 ⇒ 别据此向用户声称「已经说了」；⛔ 这句是**说给耳朵**的，正文里**别原样复述**，同一句会被念两遍）/ `voice_announce_stop`（立刻停止播报、清掉排队待念的内容）/ `voice_speak_reply`（把**本条回复的正文**在生成过程中念出来 —— 不是每条都念，由模型自己判断何时值得开口：用户在催 / 反复没做好 / 当前步骤关键 / 自己有话要说）");
lines.push("  · 子智能体：`agent_invoke`（派一个干净上下文的自己）/ `agent_archive_sessions` / `subagent_save`（新建子智能体代理，name+systemPrompt 必填）");
lines.push("  · 专家：`expert_save`（创建/更新专家或专家团——displayNameZh + leadName + leadSystemPrompt 必填，多角色加 members；同 teamId 即更新）/ `expert_list`（列已有专家）。用户说「帮我建一个 XX 专家 / 专家团」时直接用它，建完复述 teamId；⛔ 内置六专家（知微/呈象/洞明/鲁班/画意/剪承团）有固定 teamId，别覆盖");
lines.push("  · 专家：`expert_save`（创建/更新专家或专家团——displayNameZh + leadName + leadSystemPrompt 必填，多角色加 members；同 teamId 即更新）/ `expert_list`（列已有专家）。用户说「帮我建一个 XX 专家 / 专家团」时直接用它，建完复述 teamId；⛔ 内置六专家（知微/呈象/洞明/鲁班/画意/剪承团）有固定 teamId，别覆盖");
lines.push("  · 自造工具：`connector_register`（把一个本地 stdio MCP server 脚本注册成持久连接器 —— 重启应用后新会话的 tools/list 带上它的工具）。**没有现成工具时先读 `self-tools` 技能**：路线① 工作区脚本立即用（一次性）；路线② 自建 MCP server + connector_register（持久）；路线③ 改宿主源码要重新构建（交给用户）");
lines.push("  · 画布工作流：`workflow_read`（读画布上搭的工作流：节点/连线/提示词/产物现状）/ `workflow_writeback`（把执行结果写回节点，画布实时显示）。用户说「按画布那套跑 / 画布里搭好的流程执行一下」时：先 workflow_read 看清节点与连线，再用 image_generate / video_generate / voice_generate 按链路逐节点执行，每步产物用 workflow_writeback 写回对应节点");
lines.push("  ⇒ 当用户要「建定时任务 / 加待办 / 存 RPA 配方 / 改设置」这类**界面动作**时，**说明该去哪个界面点**（例如 设置 → 定时任务），**不要**声称自己调用了某个 `域:动作` 通道、也不要凭空发明工具名（如 `task_add`）—— 没有的工具就是没有。");
lines.push("- 引擎**直接可用**的自动化能力另有专技能：`desktop-automation`（键鼠/窗口/OCR，nuphus MCP）、`browser-skill`（浏览器，ego-browser）、`ssh`（远程执行）。MCP 连接器是动态的，以 tools/list 实际返回为准。");
lines.push("");
lines.push("**怎么读这份清单**（09-25 加，用户实测踩到）：它是**一个文件**，**一次读全** —— 不要分段读、不要在技能目录里 grep 找接口。");
lines.push("引擎的技能清单里给的 `(file: …)` 就是它。⛔ 用 cmd 的 `type \"路径\"` 读时，路径上的**引号会被执行通道剥掉**、`workdir` 也可能报 `os error 267` —— 改用你惯用的读文件方式，或先把它的所在目录设为工作目录再读 `SKILL.md`。");
lines.push("");
lines.push("## 可拓展点（怎么给宿主加能力）");
lines.push("");
lines.push("用户问「能拓展什么 / 能不能接上 XX」时，答案在这张表里 —— **先按「要加的东西」找到改法**，再看上面「能力域」有没有现成通道可复用。");
lines.push("");
lines.push("| 想加的东西 | 落点（改哪里 / 用什么） | 注意 |");
lines.push("|---|---|---|");
lines.push("| 宿主原生能力（新接口） | `electron/ipc-channels.manifest.json` 加一条 → `npm run gen:ipc` → 补 `ipc-registry.ts` 的域 `count` | ⛔ 生成物勿手改；守卫【2】【90】【107】盯；改完**重跑本清单生成器** |");
lines.push("| 教模型的流程（怎么做事） | 内置技能 `electron/builtin-skills/NN-*.ts` + 在 `builtin-skills.ts` 登记 | 正文必须**字面量**（【86】做配置面安全扫描），勿运行时拼装 |");
lines.push("| 个人 / 项目的经验与流程 | `<workspace>/.codex/skills/<name>/SKILL.md`（引擎原生发现，**默认落点**） | 跨项目才放 `$CODEX_HOME/skills/`；⛔ 别放 `.codex-harness/skills`（引擎不读） |");
lines.push("| 外部服务 / API 接入 | **MCP 连接器**（设置 → 连接器；或自写 MCP server） | 工具面是动态的，以 `tools/list` 实际返回为准 |");
lines.push("| 让某个角色长期替你干活 | **专家 / 专家团**（定义 + 技能包） | 成员在独立会话里跑，产出由主理人汇总 |");
lines.push("| 定时 / 周期任务 | **调度器**（`scheduler:*`） | 任务真的在指定 workspace 目录里跑（不是「看起来在那里」） |");
lines.push("| 把会话接到 IM | **渠道 Bot**（`channel-bot:*` / `weixin:*` / `telegram:*`） | — |");
lines.push("| 记录好的桌面流程 | **RPA 配方**（`rpa:*`） | 键鼠级回放，适合无 API 的老软件 |");
lines.push("| 浏览器 / 桌面自动化 | 专技能 `desktop-automation`（nuphus MCP）、`browser-skill`（ego-browser） | 应用里关掉能力总闸后这些工具**不存在**，别当成坏了 |");
lines.push("| 换记忆后端 | 设置 → 记忆 → 记忆后端（内置金字塔 / 本地 MCP 记忆服务 / 云端 memapi，**三选一**） | ⛔ 三者互斥：**落点与工具名随后端变**，别混用（内置=写 `lessons/`；MCP=`local_memory__memory_write`；云端=**无工具**、上游自动收记忆） |");
lines.push("| 换知识库后端 | 设置 → 知识库 → 后端（本地项目库 / 云端 weknora） | 本地 = `knowledge_search` / `knowledge_add`；云端 = `cloud_kb__ask` 等 6 个 MCP 工具。判定看工具列表里有没有 `cloud_kb__` 前缀 |");
lines.push("| 主题 / 外观 | `src/lib/themes.ts`（多主题扩展点） | — |");
lines.push("");
lines.push("⛔ **打包版没有宿主源码**：用户机器上只有一个安装包 ⇒ 那时真正的答案只有**接入类**（技能 / MCP 连接器 / 专家 · 专家团 / 定时任务 / RPA / IM 渠道 / 记忆后端）。要改宿主代码必须在**源码工程**里做；先确认源码在不在手边，再决定说哪种方案。");
lines.push("");
lines.push("## 能力域");
lines.push("");
for (const d of domains) {
  lines.push(`### ${d.prefix}（${d.count} 通道）`);
  lines.push(`${DOMAIN_DESCRIPTIONS[d.prefix]}`);
  lines.push(`通道：${d.channels.join(", ")}`);
  lines.push("");
}
const body = lines.join("\n");

/* ── 包成 TS 模块（字面量；反引号与 ${ 转义）── */
const escaped = body.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
const ts = `/**
 * builtin-skills 的「harness-api」部分 —— ⛔ 本文件由 scripts/gen-capability-skill.mjs 自动生成，勿手改。
 * 数据源：ipc-channels.manifest.json + ipc-registry.ts + 生成器内的 DOMAIN_DESCRIPTIONS。
 * 用途：给引擎一份「宿主有哪些接口/可拓展能力」的按需可读清单（用户 09-25：「用户有这么方面需求的时候，
 * 不用一个个去扫」）。守卫【153】比对生成物与数据源，过期即红。
 */
export const HARNESS_API_SKILL = \`${escaped}\`;
`;

if (process.argv.includes("--check")) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (current === ts) { console.log("harness-api 技能与数据源一致（" + domains.length + " 域 / " + totalChannels + " 通道）"); process.exit(0); }
  console.error("harness-api 技能过期：与 manifest/registry 不一致 —— 重跑 node scripts/gen-capability-skill.mjs");
  process.exit(1);
}
fs.writeFileSync(OUT, ts, "utf8");
console.log(`已生成 ${path.relative(ROOT, OUT)}（${domains.length} 域 / ${totalChannels} 通道，正文 ${body.length} 字符）`);
