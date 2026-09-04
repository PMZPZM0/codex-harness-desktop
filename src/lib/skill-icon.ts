// 技能图标解析纯函数：把市场/本地技能映射为可视化图标（emoji 优先，lucide 键名兜底）。
// 为什么独立成 lib：映射规则有数据依据（CocoLoop API icon 字段实测约 1/4 为空串），
// 需要被 App.tsx 渲染层与回归脚本共用。
import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Brain,
  Briefcase,
  ChartColumn,
  Code2,
  FileText,
  Globe2,
  LayoutGrid,
  MessageSquare,
  Phone,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Store,
  Target,
  TerminalSquare,
  Wrench,
  Workflow,
} from "lucide-react";

/** 分类 → { 图标, 色调 }。iconClass 用于 skill-avatar 的配色变体。 */
const categoryProfiles: Record<string, { icon: LucideIcon; iconClass: string }> = {
  "AI 增强": { icon: Brain, iconClass: "tone-violet" },
  "开发": { icon: Code2, iconClass: "tone-blue" },
  "办公": { icon: Briefcase, iconClass: "tone-amber" },
  "效率": { icon: Wrench, iconClass: "tone-green" },
  "设计": { icon: LayoutGrid, iconClass: "tone-pink" },
  "内容创作": { icon: FileText, iconClass: "tone-amber" },
  "专业技能": { icon: Target, iconClass: "tone-blue" },
  "安全工具": { icon: ShieldCheck, iconClass: "tone-green" },
  "信息查询": { icon: Search, iconClass: "tone-blue" },
  "联网搜索": { icon: Globe2, iconClass: "tone-cyan" },
  "总排行": { icon: Star, iconClass: "tone-amber" },
  "近期最热": { icon: Sparkles, iconClass: "tone-pink" },
  "最新上传": { icon: Store, iconClass: "tone-green" },
};

/** 名称/描述关键词 → lucide 图标。兜底空 icon 且关键词特征强的技能。 */
const keywordIcons: Array<[RegExp, LucideIcon]> = [
  [/search|engine|搜索|检索|引擎/i, Search],
  [/agent|助手|智能体|bot/i, Bot],
  [/memory|知识图谱|ontology|记忆/i, Brain],
  [/doc|文档|写作|文案|writer/i, FileText],
  [/code|dev|编程|开发|debug/i, Code2],
  [/browser|web|网页|爬虫|crawl/i, Globe2],
  [/scan|安全|防护|audit|审计/i, ShieldCheck],
  [/workflow|自动化|流程|自动化任务/i, Workflow],
  [/data|数据|分析|统计|报表|chart/i, ChartColumn],
  [/mail|邮件|消息|通知|notify/i, MessageSquare],
  [/\bad\b|广告|营销|marketing|增长/i, Target],
  [/call|电话|语音|voice/i, Phone],
];

export type SkillVisual = { emoji: string; Icon: LucideIcon | null; iconClass: string };

/**
 * 解析技能可视化图标。
 * - 市场 emoji（skill.icon）非空 → 直接用，配色按分类。
 * - emoji 为空 → 按名称/描述关键词选 lucide 图标，再按分类兜底，最后 Sparkles。
 */
export function resolveSkillVisual(input: { name: string; description?: string; category?: string; icon?: string }): SkillVisual {
  const category = input.category ?? "";
  const profile = categoryProfiles[category] ?? { icon: Sparkles, iconClass: "tone-blue" };
  const emoji = (input.icon ?? "").trim();
  if (emoji) return { emoji, Icon: null, iconClass: profile.iconClass };
  const haystack = `${input.name} ${input.description ?? ""}`;
  for (const [pattern, icon] of keywordIcons) {
    if (pattern.test(haystack)) return { emoji: "", Icon: icon, iconClass: profile.iconClass };
  }
  return { emoji: "", Icon: profile.icon, iconClass: profile.iconClass };
}
