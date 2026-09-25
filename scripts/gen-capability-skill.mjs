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
  "codex": "渲染层与引擎（@openai/codex app-server）之间的请求桥：转发请求 / 响应 / 切活跃会话",
  "threads": "会话列表与元数据（归档、重命名、血缘、会话摘要等）",
  "thread-runtime": "会话运行态（派发所有权、运行/闲置状态机）",
  "engine": "引擎生命周期（重启 / 换模型档位 / 状态查询）",
  "capabilities": "宿主能力快照（当前环境支持什么，一次性拉取）",
  "bridge": "引擎桥连接状态",
  "prompt": "提示词增强（把用户草稿改写为更完整的 prompt）",
  "history": "跨会话历史搜索（全文检索会话与消息，命中按会话分组）",
  "external": "用系统默认浏览器打开外部链接",
  "agents": "子智能体库（创建/归档/委派/目录；成员会话与角色）",
  "subagents": "委派执行（把任务派给子智能体跑，主进程直发）",
  "teams": "专家团（多角色协作团队的定义与成员管理）",
  "team-runs": "专家团运行记录查询",
  "team-threads": "专家团成员会话映射",
  "bot": "Bot 会话（Bot 与会话的绑定与消息注入）",
  "bots": "Bot 定义管理",
  "bot-binding": "Bot 与会话/IM 的绑定关系",
  "bot-stream": "Bot 流式输出转发",
  "channel-bot": "IM 通道 Bot（把某个会话接到 IM 机器人上）",
  "weixin": "微信通道（收发/绑定/状态）",
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
  "scheduler": "定时任务（一次性/周期任务：创建/启停/列表）",
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
