/**
 * app-view/helpers/catalogs（09-22 架构改造：从 helpers.tsx 按功能域拆出，纯搬迁）
 *
 * 域：静态目录与常量表（斜杠命令 / 模板 / 设置导航 / 分类标签 / 扩展名）
 * 符号（11）：builtinCommandCatalog / slashCommands / idleTemplates / cronTemplates / settingsNav / imageExts / approvalMenuOptions / skillHubCategories / skillHubCategoryTabs / skillHubCategoryName / pluginMarketCategoryTabs
 *
 * 代码与拆分前逐字一致；依赖边经 AST 依赖图核对，**不跨模块** ⇒ 本文件不 import 同目录其他模块。
 */
import { Archive, Blocks, Bot, Camera, CircleGauge, Clock3, Download, Settings2, Sparkles, Star, Store, TerminalSquare, Sun, Wrench, Wifi, Zap, Server, UserRound, Users, Workflow, Wallet, Database, Headphones } from "lucide-react";
import { BuiltinCommandDef } from "../../../features/commands";
import type { SettingsPage } from "../types";



export /** 内置命令目录（复刻 WorkBuddy/CodeBuddy 命令体系）：name / 描述 / 参数提示 / 分类。
 * 仅收录本项目引擎已具备真实能力的命令，全部有 runSlashCommand 实现。 */
const builtinCommandCatalog: BuiltinCommandDef[] = [
  // 会话管理
  { name: "new", description: "开启全新对话", category: "会话管理" },
  { name: "resume", description: "打开历史任务", category: "会话管理" },
  { name: "rename", description: "重命名当前任务", hint: "<新名称>", category: "会话管理" },
  { name: "fork", description: "从当前任务分叉出新分支", hint: "[分支名]", category: "会话管理" },
  { name: "archive", description: "归档当前任务，列表不再展示", category: "会话管理" },
  { name: "delete", description: "永久删除当前任务（不可恢复）", category: "会话管理" },
  { name: "undo", description: "撤销上一轮对话", category: "会话管理" },
  // 上下文与状态
  { name: "compact", description: "压缩当前上下文，总结较早对话释放空间", category: "上下文与状态" },
  { name: "clear", description: "清空上下文，开启新对话（旧会话保留在历史里）", category: "上下文与状态" },
  { name: "status", description: "显示任务状态、模型、思考强度与上下文用量", category: "上下文与状态" },
  { name: "context", description: "计算并展示当前上下文占用", category: "上下文与状态" },
  // 09-23：`app:doctor` 早就存在（`electron/features/app-diagnostics.ts` 的注释也写着"内置斜杠命令
  // /doctor 支撑"），但**渲染层从来没接**——那句注释是一张空头支票。现在真接上：
  // 引擎二进制/版本/工作区/权限/存储 一键体检，结论进信息弹窗并顺手复制。
  { name: "doctor", description: "环境自查（引擎二进制、版本、工作区、权限、存储）", category: "上下文与状态" },
  { name: "pwd", description: "显示当前工作目录", category: "上下文与状态" },
  { name: "cd", description: "更换当前工作目录", hint: "[目录]", category: "上下文与状态" },
  { name: "queue", description: "查看待处理的消息队列", category: "上下文与状态" },
  { name: "memory", description: "打开记忆管理，查看或新增记忆", category: "上下文与状态" },
  { name: "plan", description: "计划模式：先调研输出方案，确认后执行", hint: "<任务描述>", category: "运行控制" },
  { name: "goal", description: "目标模式：朝目标自动持续推进直至达成", hint: "<目标 | clear>", category: "运行控制" },
  // 模型与权限
  { name: "model", description: "模型与思考设置", category: "模型与权限" },
  { name: "effort", description: "切换真实思考强度", hint: "[极简|低|中|高|最高|极高]", category: "模型与权限" },
  { name: "personality", description: "切换回复风格", hint: "[务实|友好|默认]", category: "模型与权限" },
  { name: "permissions", description: "运行权限设置", category: "模型与权限" },
  { name: "sandbox", description: "切换沙箱执行范围", hint: "[只读|工作区可写|完全访问]", category: "模型与权限" },
  { name: "approval", description: "切换命令审批策略", hint: "[按需|从不]", category: "模型与权限" },
  // 审查与代码
  { name: "review", description: "审查当前代码改动", hint: "[自定义指令]", category: "审查与代码" },
  { name: "diff", description: "打开本轮文件改动", category: "审查与代码" },
  { name: "copy", description: "复制上一条回复到剪贴板", category: "审查与代码" },
  // 信息查询
  { name: "help", description: "查看全部可用命令及用法", category: "信息查询" },
  { name: "skills", description: "列出可用 Skills", category: "信息查询" },
  { name: "mcp", description: "列出 MCP 服务及运行状态", category: "信息查询" },
  { name: "plugins", description: "列出已安装插件", category: "信息查询" },
  { name: "apps", description: "列出已安装 Apps", category: "信息查询" },
  // 运行控制
  { name: "stop", description: "停止当前生成", category: "运行控制" },
];

export /** 兼容旧引用的二元组（name, description） */
const slashCommands = builtinCommandCatalog.map(({ name, description }) => [name, description] as const);

export const idleTemplates = [
  { name: "Git 周会摘要", desc: "汇总本周 Git 活动，生成周五会话摘要：列出重要提交、已合并 PR 及主要变更，并保持简洁。", prompt: "汇总本周 Git 活动，生成周五会话摘要：列出重要提交、已合并 PR 及主要变更，并保持简洁。" },
  { name: "CI 失败与不稳定测试报告", desc: "扫描最近的 CI 运行，列出失败和不稳定测试及其可能原因，并按影响范围给出修复建议。", prompt: "扫描最近的 CI 运行，列出失败和不稳定测试及其可能原因，并按影响范围给出修复建议。" },
  { name: "文档同步检查", desc: "基于当前代码实现和最近提交，检查仓库中的 README、docs、配置说明与使用示例是否过时或与实现不一致。仅修改文档。", prompt: "基于当前代码实现和最近提交，检查仓库中的 README、docs、配置说明与使用示例是否过时或与实现不一致。仅修改文档。" },
];

export const cronTemplates = [
  { name: "晨会动态", desc: "汇总上一个工作日以来的提交、模块变化、CI 状态和待跟进事项，最终生成不超过 6 条的晨会口述摘要。只读分析。", time: "每工作日 09:00", intervalMinutes: 1440, icon: "◎" },
  { name: "风险扫描", desc: "检查最近 24 小时的代码变更，识别运行错误、数据丢失、权限绕过、资源泄露及跨端兼容等高置信风险，并附代码和修复建议。", time: "每天 10:00", intervalMinutes: 1440, icon: "⚠" },
  { name: "发布简报", desc: "整理本周合并的 PR 和 commit，按功能、修复、体验及工程改进分类，同时生成团队版和面向用户的精简发布说明。", time: "每周五 16:00", intervalMinutes: 10080, icon: "📝" },
  { name: "文档同步检查", desc: "对照最近 7 天的代码、配置、接口与文档变更，识别已改变公开行为但文档尚未同步的高置信差异，并附文件路径和修复建议。", time: "每周三 15:00", intervalMinutes: 10080, icon: "📄" },
];

export const settingsNav: { group: string; items: [SettingsPage, string, any][] }[] = [
  { group: "账户", items: [["user", "用户中心", UserRound], ["model", "模型", Bot], ["relay", "中转站", Wallet], ["openai", "OpenAI 订阅", CircleGauge]] },
  { group: "常用", items: [["general", "控制台", Settings2], ["appearance", "外观", Sun], ["personalization", "个性化", Sparkles], ["voice", "语音通话", Headphones], ["skills", "技能", Zap], ["plugins", "插件", Store], ["memory", "记忆", Archive], ["commands", "命令", TerminalSquare], ["screenshot", "截图", Camera], ["favorites", "收藏夹", Star]] },
  { group: "智能体", items: [["agentteam", "专家/专家团", Users]] },
  { group: "自动化与能力", items: [["automation", "自动化", Workflow], ["mcp", "MCP", Wifi], ["schedule", "定时任务", Clock3], ["hooks", "钩子", Wrench], ["ssh", "SSH 服务器", Server]] },
  { group: "数据与统计", items: [["usage", "使用统计", CircleGauge], ["storage", "数据管理", Database], ["backup", "会话备份", Download], ["archive", "归档管理", Archive]] },
  { group: "开发工具", items: [["devtools", "开发工具", TerminalSquare], ["extensibility", "拓展接口", Blocks]] },
];

export const imageExts = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico"]);

export const approvalMenuOptions = (fullAccess: boolean) => fullAccess ? [
  { value: "on-request", title: "变更前确认", desc: "改文件前先问我。" },
  { value: "untrusted", title: "自动编辑", desc: "自动编辑文件。" },
  { value: "never", title: "完全访问", desc: "减少确认次数。" },
] : [
  { value: "on-request", title: "变更前确认", desc: "改文件前先问我。" },
  { value: "untrusted", title: "自动编辑", desc: "自动编辑文件。" },
  { value: "never", title: "完全访问", desc: "减少确认次数。" },
];

export /** 侧栏里的「调度会话」徽标：标明这个会话是 Codex 调度出来的，以及它当前的状态。
 *  这类会话由调度产生、任务完成后**保留**（不自动归档），由 Codex 询问用户后再归档。 */
// SkillHub showcase 四榜单（对应 skills:market-list 的 section 映射）
const skillHubCategories = ["总排行", "近期最热", "最新上传", "官方精选"];

export const skillHubCategoryTabs: [string, string][] = [
  ["全部", ""], ["AI 智能体", "ai-agent"], ["办公效率", "office-efficiency"], ["知识管理", "knowledge-management"],
  ["数据分析", "data-analysis"], ["内容创作", "content-creation"], ["专业技能", "professional"], ["生活服务", "life-service"],
  ["设计与媒体", "design-media"], ["IT 运维与安全", "it-ops-security"], ["开发编程", "dev-programming"],
];

export const skillHubCategoryName = (key: string) => skillHubCategoryTabs.find(([, value]) => value === key)?.[0] ?? key;

export /** GitHub raw logo → jsDelivr CDN 镜像（raw.githubusercontent.com 在国内不可达，渲染层图片走镜像）；
 *  非 raw 地址原样返回；镜像再失败由 <img onError> 兜底首字母。 */

/** 市场卡片图标：字母兜底在底 + 图片盖上去。原地址优先（本机 raw 直连往往可达），
 *  加载失败再切 jsDelivr 镜像（部分网络下 raw 不可达），再失败隐藏图片露字母。 */

/** 市场卡片点击预览（技能/插件/MCP 通用） */
// 插件市场（codex-marketplace.com）分类 tab：中文标签 → API 英文分类值
const pluginMarketCategoryTabs: [string, string][] = [["全部", "全部"], ["编码", "Coding"], ["效率", "Productivity"], ["实用工具", "Utilities"], ["AI 与智能体", "AI & Agents"], ["设计", "Design"], ["数据", "Data"], ["开发", "Development"]];