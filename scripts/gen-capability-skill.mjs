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
  "work-logs": "各项目的**工作日志与项目记忆**管理（<项目>/.codex-harness/memory/**：长期记忆 MEMORY.md / 坑与纪律 LESSONS.md+lessons/ / 每日工作日志 logs/YYYY-MM-DD.md / archive / project）——设置 → 数据管理 → 工作日志。可看正文、按项目与类型分组、批量删除。⛔ 这是项目里的工作记录，与会话本身的归档 / 删除（「归档管理」页）不是一回事；删除是销毁性的（工作日志删了不会重建）",
  "video": "内置视频生成接口（国内外 8 家：可灵/万相/Seedance/CogVideoX/MiniMax/Runway/Luma/Veo）：submit 提交 → poll 轮询 → download 落工作区；凭证存 userData/video-providers.json",
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
  "history": "跨会话历史搜索（全文检索会话与消息，命中按会话分组）",
  "external": "用系统默认浏览器打开外部链接",
  "agents": "子智能体库（创建/归档/委派/目录；成员会话与角色）",
  "subagents": "子智能体——**可创建**：用户要「新建一个子智能体/代理」时，**直接用真工具 `subagent_save`**（name+systemPrompt 必填；同 name 即更新）→ `agent_invoke` 派活",
  "teams": "专家团/专家的定义与成员管理——**可创建**：用户要「新建一个专家/专家团」时，**直接用真工具 `expert_save`**（先 `expert_list` 查重；normalize 自动补默认与 id 规范；teamId 相同即覆盖更新）。字段：displayName/profession/description（zh+en）/category/tags(≤3)/quickPrompts(≤3)/sop；lead 必带 name+systemPrompt；多角色协作加 members[]（每人 name+profession+description+systemPrompt）。⛔ 内置专家（知微/呈象/洞明/鲁班/画意/剪承团）每次启动确保存在——不要用与内置相同的 teamId 去覆盖内置定义，新建用独有 teamId；建完向用户复述 teamId 与成员名单",
  "team-runs": "专家团运行记录查询",
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
  "memory": "记忆金字塔全链路（L0~L7 分层读写、召回、蒸馏、清理计划/执行、云端网关、工作区开关、记忆后端二选一）",
  "skills": "技能经验包（导入/启停/市场安装/本地列表）",
  "commands": "斜杠命令（自定义 / 命令的定义与管理）",
  "skill-discipline": "技能纪律（写技能时必须遵守的硬规则查询）",
  "plugins": "插件市场（安装/启停/列表）",
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
  "shell": "系统默认方式打开文件/目录",
  "dialog": "文件/目录选择对话框（含跨窗口）",
  "clipboard": "剪贴板（读写文本/图片）",
  "notify": "系统通知（托盘气泡）",
  "awake": "阻止系统休眠（长任务期间保持唤醒）",
  "runtime": "随包运行时管理（node/python 等的安装/卸载/列表）",
  "window": "窗口控制（最小化/关闭/置顶/弹出一个独立小窗）",
  "app": "应用级杂项（版本、存储用量、缓存清理、重启、加载目录）",
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
  "browser": "浏览器自动化开关（cloak 状态/打开/弹窗）",
  "terminal": "内置终端（创建/输入/缩放/重启）",
  "screenshot": "截图（冻结帧框选/保存/历史）",
  "favorites": "收藏夹（收藏消息/片段，一键再发送）",
  "scratch": "临时便签（快速记一条）",
  "pasted-text": "粘贴文本暂存（大段粘贴落盘防丢）",
  "voice": "语音通话全链路（呼叫/音频流/转写/打断/挂断，39 通道）",
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
lines.push("  · 媒体：`image_generate`（生图，`count` 1–4 并发出变体，落盘返回本地路径）/ `video_generate`（提交视频任务，**立即返回 jobId，不等待**；`video` 参数可传白模预演参考片的公网 URL，配 Seedance 2.0/2.5 渲染）/ `video_status`（查任务；成功会自动下载落盘）/ `video_concat`（把多镜片段按给定顺序拼成成片）/ `voice_generate`（台词合成配音 WAV，落盘返回路径；语音模型未下载时报错并指路「设置 → 语音」）");
lines.push("  · 子智能体：`agent_invoke`（派一个干净上下文的自己）/ `agent_archive_sessions` / `subagent_save`（新建子智能体代理，name+systemPrompt 必填）");
lines.push("  · 专家：`expert_save`（创建/更新专家或专家团——displayNameZh + leadName + leadSystemPrompt 必填，多角色加 members；同 teamId 即更新）/ `expert_list`（列已有专家）。用户说「帮我建一个 XX 专家 / 专家团」时直接用它，建完复述 teamId；⛔ 内置六专家（知微/呈象/洞明/鲁班/画意/剪承团）有固定 teamId，别覆盖");
lines.push("  · 专家：`expert_save`（创建/更新专家或专家团——displayNameZh + leadName + leadSystemPrompt 必填，多角色加 members；同 teamId 即更新）/ `expert_list`（列已有专家）。用户说「帮我建一个 XX 专家 / 专家团」时直接用它，建完复述 teamId；⛔ 内置六专家（知微/呈象/洞明/鲁班/画意/剪承团）有固定 teamId，别覆盖");
lines.push("  · 自造工具：`connector_register`（把一个本地 stdio MCP server 脚本注册成持久连接器 —— 重启应用后新会话的 tools/list 带上它的工具）。**没有现成工具时先读 `self-tools` 技能**：路线① 工作区脚本立即用（一次性）；路线② 自建 MCP server + connector_register（持久）；路线③ 改宿主源码要重新构建（交给用户）");
lines.push("  · 画布工作流：`workflow_read`（读画布上搭的工作流：节点/连线/提示词/产物现状）/ `workflow_writeback`（把执行结果写回节点，画布实时显示）。用户说「按画布那套跑 / 画布里搭好的流程执行一下」时：先 workflow_read 看清节点与连线，再用 image_generate / video_generate / voice_generate 按链路逐节点执行，每步产物用 workflow_writeback 写回对应节点");
lines.push("  ⇒ 当用户要「建定时任务 / 加待办 / 存 RPA 配方 / 改设置」这类**界面动作**时，**说明该去哪个界面点**（例如 设置 → 定时任务），**不要**声称自己调用了某个 `域:动作` 通道、也不要凭空发明工具名（如 `task_add`）—— 没有的工具就是没有。");
lines.push("- 引擎**直接可用**的自动化能力另有专技能：`desktop-automation`（键鼠/窗口/OCR，nuphus MCP）、`browser-skill`（浏览器，playwright-cli）、`ssh`（远程执行）。MCP 连接器是动态的，以 tools/list 实际返回为准。");
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
lines.push("| 浏览器 / 桌面自动化 | 专技能 `desktop-automation`（nuphus MCP）、`browser-skill`（playwright-cli） | 应用里关掉能力总闸后这些工具**不存在**，别当成坏了 |");
lines.push("| 换记忆后端 | 设置 → 记忆 → 记忆后端（内置金字塔 ⇄ MCP 记忆服务） | 二者**互斥**，且装好才允许切 |");
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
