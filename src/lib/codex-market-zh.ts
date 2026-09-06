// Codex 插件市场（codex-marketplace.com）中文翻译表。
// 市场 API 返回英文简介，这里按 slug 提供中文简介；未收录的条目回退英文原文。
// 覆盖面：OpenAI 官方精选 25 个 + 高星/实用社区插件。新增插件后按需补录即可。
export const CODEX_MARKET_ZH: Record<string, string> = {
  // ── OpenAI 官方精选（openai/plugins）──
  "linear": "查找并引用 Linear 的 Issue 与项目，把任务跟踪直接带进对话。",
  "github": "处理 PR、Issue、CI 与发布流程，用 GitHub 官方插件高效协作。",
  "google-calendar": "管理 Google 日历事件与日程安排，创建、查询、调整会议。",
  "gmail": "读取并管理 Gmail 邮件，起草回复、整理收件箱。",
  "slack": "读取并管理 Slack 消息，在频道与线程中协作。",
  "teams": "总结 Microsoft Teams 消息并起草后续跟进内容。",
  "sharepoint": "总结 SharePoint 站点与文件内容，快速掌握团队资料。",
  "outlook-email": "处理 Outlook 收件箱并起草回复，管理邮件工作流。",
  "outlook-calendar": "管理 Outlook 日程与会议变更，协调时间安排。",
  "canva": "搜索、创建、编辑 Canva 设计，把视觉素材直接产出。",
  "figma": "基于 Figma 集成的设计转代码工作流。",
  "hugging-face": "查看模型、数据集、Spaces 与前沿研究，随时调用 HF 生态。",
  "jam": "带上下文录屏，快速反馈与记录问题现场。",
  "netlify": "部署项目并管理发布版本，一条龙走完上线流程。",
  "stripe": "支付与商业工具集，管理 Stripe 收款与业务数据。",
  "vercel": "Vercel 生态使用指南，部署、预览、环境变量一站管理。",
  "game-studio": "设计、原型并发布浏览器游戏，覆盖 2D/3D 玩法系统与 UI。",
  "box": "搜索并引用 Box 云盘文档。",
  "google-drive": "在 Drive、Docs、Sheets、Slides 之间跨文档工作。",
  "notion": "Notion 工作流：规格、研究、会议记录与知识沉淀。",
  "cloudflare": "Cloudflare 平台指南，配套官方 MCP 服务。",
  "sentry": "查看最近的 Sentry 问题与事件，快速定位线上异常。",
  "build-ios-apps": "用 SwiftUI 与 Xcode 工作流构建、打磨、调试 iOS 应用。",
  "build-web-apps": "构建、评审、发布、扩展 Web 应用：UI、React、部署、支付全覆盖。",
  "test-android-apps": "复现问题、检查 UI 并从 Android 模拟器采集证据。",

  // ── 社区插件（高星 / 实用）──
  "datamoat": "在本地备份、分析并复用 AI 数据，数据主权掌握在自己手里。",
  "knowledge-patch": "检测并安装匹配的知识补丁，保持技能与知识库同步。",
  "memoire": "智能体设计 CI、文件脚手架与 UI 质量工具。",
  "academic-writing-toolkit": "结构化研究、论文写作、证据审查与引文管理。",
  "codeclone": "Python 结构性代码质量分析。",
  "hera-godot": "通过 Hera CLI 用低 token 成本实时操作 Godot 编辑器工作流。",
  "migration-to-aws": "把 GCP 基础设施与 AI 负载迁移到 AWS，自动规划迁移路径。",
  "cross-platform-agent-template": "面向安全云与零信任环境的可移植智能体模板。",
  "aomi": "通过自然语言驱动 Aomi CLI 完成操作。",
  "wakeflow": "双宿主控制回路，管理智能体的长时工作流。",
  "arrowgram": "创建并编辑 Arrowgram 论文与图表。",
  "getpaidx": "控制 GetPaidX 云端帖文与工作区。",
  "mail-agent": "读取并自动化邮件原生工作流，管理多邮箱。",
  "codex-lark-remote": "从飞书控制、观察并接管 Codex 会话。",
  "agent-ticketing-os": "工单与智能体工作流操作系统。",
  "drbinary-chat-plugin": "二进制分析、恶意软件、系统安全与 Android 取证。",
  "multi-account-gmail-mcp": "显式账号选择的完整 Gmail 访问。",
  "apple-calendar": "在 macOS 上读取、搜索、更新与管理日历事件。",
  "apple-reminders": "在 macOS 上读取、分拣、更新与完成提醒事项。",
  "launchfast": "面向 Codex 的亚马逊卖家调研工具。",
  "openproject": "查看项目并在 OpenProject 中管理工作包。",
  "yandex-direct-for-all": "便携的 Yandex Direct、Wordstat、Metrika 与 Roistat 操作包。",
  "remote-ssh": "面向 Codex 的企业级远程 SSH 操作。",
  "powerbi-desktop": "本地 Power BI Desktop 项目的 AI 工作台。",
};

/** 市场分类英文 → 中文 */
export const CODEX_MARKET_CATEGORY_ZH: Record<string, string> = {
  "Coding": "编码",
  "Productivity": "效率",
  "Utilities": "实用工具",
  "AI & Agents": "AI 与智能体",
  "Design": "设计",
  "Data": "数据",
  "Development": "开发",
};

export function zhCategory(category: string): string {
  return CODEX_MARKET_CATEGORY_ZH[category] ?? category;
}
