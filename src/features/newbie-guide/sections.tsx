/**
 * 新手引导 · 章节注册表（2026-10-07 立，用户：「加一个新手引导常驻板块…迷你版设置界面，
 * 第一个模型配置界面映射，第二开发工具下载界面映射，人格市场映射…版本更新日志默认在最下面…
 * 留好 UI 拓展接口，适合新手快速上手」）。
 *
 * ── 拓展接口（加一节 = 数组加一项，别的地方零改动）──────────────────────────
 *   · `action.kind = "settings"` → 右页给一个「打开设置」主按钮，点了关弹窗并跳到该设置页
 *     （`page` 用设置注册表的页 id，见 helpers/catalogs.ts 的 settingsNav —— 写错会在守卫里红）；
 *   · `changelog: true` → 右页渲染「版本更新日志」（数据走 `whatsnew:history`，⛔ 不许在这里
 *     另抄一份版本数据 —— 单一真相源 = electron/whats-new-notes.ts）；
 *   · 纯说明节（没有 action / changelog）→ 只渲染步骤清单。
 *   ⛔ 排序 = 数组顺序；`changelog` 约定**置底**（用户：「版本更新日志默认在最下面」）。
 */
import { Bot, Heart, Rocket, ScrollText, TerminalSquare } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type GuideStep = { t: string; d?: string };

export type GuideSection = {
  /** 稳定 id（左列表 key / 默认选中 / 守卫引用） */
  id: string;
  /** 左列表显示名（≤6 字，和顶栏标题同一审美） */
  label: string;
  icon: LucideIcon;
  /** 右页标题 + 新人向说明（大白话，别写实现词） */
  title: string;
  intro: string;
  steps: GuideStep[];
  /** 跳到某个设置页（id 必须存在于 settingsNav） */
  action?: { label: string; kind: "settings"; page: string };
  /** 版本更新日志页（数据 = whatsnew:history；约定置底） */
  changelog?: boolean;
};

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: "start",
    label: "快速上手",
    icon: Rocket,
    title: "三步就能开始用",
    intro: "第一次打开应用，按下面三步走一遍就能对话了。以后想找某个功能，也可以随时回这里看看。",
    steps: [
      { t: "配置模型", d: "「设置 → 模型」里选一个服务商、填上 API Key —— 没配模型，消息发不出去。" },
      { t: "选一个项目文件夹", d: "点顶部的 📁 图标选目录，AI 的改动都发生在你选的文件夹里。" },
      { t: "直接说人话提问", d: "在下面输入框描述你要做的事（比如「帮我看看这个项目」），回车发送即可；多步任务它会自己列清单。" },
    ],
    action: { label: "先去配置模型", kind: "settings", page: "model" },
  },
  {
    id: "model",
    label: "配置模型",
    icon: Bot,
    title: "配置模型（必需）",
    intro: "模型是这个应用的发动机：没配置之前，发消息会提示你先去配置。选服务商 → 填 Key → 选模型，三步完事。",
    steps: [
      { t: "选服务商", d: "支持 DeepSeek、OpenAI 兼容接口与自定义中转站；不确定就用默认推荐。" },
      { t: "填 API Key", d: "在服务商官网注册后复制 Key 粘进去（Key 只保存在本机）。" },
      { t: "选模型", d: "配好后在输入框下方的模型芯片里选一个；不同模型费用与能力不同。" },
    ],
    action: { label: "打开设置 · 模型", kind: "settings", page: "model" },
  },
  {
    id: "devtools",
    label: "开发工具",
    icon: TerminalSquare,
    title: "开发工具（按需下载）",
    intro: "需要 Python、Git、FFmpeg 这类工具时，在应用里一键下载就行，不用自己去官网找安装包。",
    steps: [
      { t: "打开「设置 → 开发工具」", d: "列表里标着「内置」的已经随应用装好，可直接用。" },
      { t: "点「下载」", d: "自动走国内镜像；装完立刻生效，无需重启电脑。" },
      { t: "缺 Git 会自动补装", d: "首次启动如果检测到没有 Git，应用会在后台自动装上。" },
    ],
    action: { label: "打开设置 · 开发工具", kind: "settings", page: "devtools" },
  },
  {
    id: "soul-market",
    label: "人格市场",
    icon: Heart,
    title: "人格市场：给 AI 换性格",
    intro: "同一个模型可以扮演不同角色：更简洁、更严谨、更会聊天……在人格市场挑一个装上就能用。",
    steps: [
      { t: "浏览人格", d: "「设置 → 人格市场」，每张卡片都写了适用场景。" },
      { t: "安装", d: "点卡片上的安装即可启用；不想用了随时卸载。" },
      { t: "使用", d: "装好后在会话里选择人格，AI 的回复风格随之改变。" },
    ],
    action: { label: "打开设置 · 人格市场", kind: "settings", page: "soul-market" },
  },
  {
    id: "changelog",
    label: "更新日志",
    icon: ScrollText,
    title: "版本更新日志",
    intro: "每个版本都改了什么，按新到旧列在下面；点「查看完整说明」能看到该版本的详细发布记录。",
    steps: [],
    changelog: true,
  },
];
