// SkillHub MCP 工具广场（skillhub.cn/mcp）目录数据。
// 列表来源：官网 /mcp 分类页（11 分类 27 个服务），详情配置来自各服务详情页的 mcpServers JSON。
// 接入模板：能拿到的服务内置「一键接入」配置（打开连接器编辑器预填）；其余点按钮直达官网详情页看配置。
export type SkillHubMcpEntry = {
  id: string;          // slug（与官网详情页 URL 一致）
  name: string;
  description: string;
  category: string;    // SkillHub 中文分类
  config?: { transport: "stdio" | "streamable_http"; command?: string; args?: string[]; url?: string; env?: Record<string, string>; fieldHints?: Record<string, string> };
  configNote?: string; // 接入提示（密钥获取方式说明）
};

export const SKILLHUB_MCP_CATALOG: SkillHubMcpEntry[] = [
  // ── 腾讯产品MCP（8）──
  { id: "tencent-docs-mcp", name: "腾讯文档 MCP", category: "腾讯产品MCP", description: "创建、查询、编辑多种类型的在线文档（智能文档/表格/幻灯片/思维导图等）。", config: { transport: "streamable_http", url: "https://docs.qq.com/openapi/mcp" }, configNote: "缺省「添加 MCP」后到 https://docs.qq.com/open/auth/mcp.html 获取个人 Token，填入 Authorization 头" },
  { id: "cos-mcp", name: "腾讯云 COS MCP", category: "腾讯产品MCP", description: "文件上传/下载/列表 + 图片处理、文档转 PDF、视频封面等云端能力。", config: { transport: "stdio", command: "npx", args: ["cos-mcp", "--Region=", "--Bucket=", "--SecretId=", "--SecretKey=", "--DatasetName="] }, configNote: "在腾讯云控制台获取 SecretId/SecretKey 与存储桶名称（Bucket）、地域（Region）" },
  { id: "mcp-server-tapd", name: "腾讯云 TAPD MCP", category: "腾讯产品MCP", description: "与 TAPD API 无缝集成，用自然语言管理需求、缺陷、任务、迭代。", config: { transport: "stdio", command: "uvx", args: ["mcp-server-tapd"], env: { TAPD_ACCESS_TOKEN: "", TAPD_API_BASE_URL: "https://api.tapd.cn", TAPD_BASE_URL: "https://www.tapd.cn", BOT_URL: "" } }, configNote: "需要 uv 运行时；Token 在 TAPD「我的设置-个人访问令牌」创建" },
  { id: "cls-mcp-server", name: "腾讯云日志服务 CLS", category: "腾讯产品MCP", description: "用自然语言查询 CLS 日志数据，整合至运维排障流程、智能分析系统异常。" },
  { id: "mcp-server-dnspod", name: "DNSPod MCP", category: "腾讯产品MCP", description: "基于 DNSPod 解析：快速添加域名、查看解析记录与解析用量。" },
  { id: "mcp-server-tat", name: "腾讯云自动化助手 TAT", category: "腾讯产品MCP", description: "在 MCP 客户端中直接对腾讯云实例执行命令。" },
  { id: "mcp-server-lbs", name: "腾讯位置服务", category: "腾讯产品MCP", description: "基于 MCP 协议的腾讯位置服务接口。" },
  { id: "tdesign-mcp-server", name: "TDesign MCP Server", category: "腾讯产品MCP", description: "获取组件变更日志、文档、DOM 结构与组件列表，辅助组件库开发。" },
  // ── 搜索与信息检索（4）──
  { id: "mcp-server-weread", name: "微信读书", category: "搜索与信息检索", description: "桥接微信读书数据，无缝访问笔记和阅读数据。" },
  { id: "serper-search-mcp", name: "Serper 多语言搜索", category: "搜索与信息检索", description: "通过 Serper API 集成 Google 搜索，提供丰富的搜索结果与参数配置。" },
  { id: "qcc-company-basic-information-mcp", name: "企查查-企业信息", category: "搜索与信息检索", description: "为企业与 LLM 工具提供工商维度精准数据支持。" },
  { id: "graphlit-mcp-server", name: "图灵知识桥", category: "搜索与信息检索", description: "实现 MCP 客户端与 Graphlit 服务之间的集成。" },
  // ── 开发者工具（3）──
  { id: "servers", name: "GitHub", category: "开发者工具", description: "深度集成 GitHub API：文件操作、仓库管理、Issue/PR、代码搜索、自动化审查。", config: { transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_PERSONAL_ACCESS_TOKEN: "" } }, configNote: "GitHub 个人访问令牌（repo 权限）在 https://github.com/settings/tokens 创建" },
  { id: "mcp-server-cloudflare", name: "Cloudflare 智能助手", category: "开发者工具", description: "用自然语言完成 Cloudflare 账户内各项操作，简化账户管理流程。" },
  { id: "mcp-server-apple-shortcuts", name: "苹果快捷指令集成", category: "开发者工具", description: "与 Apple Shortcuts 集成的 MCP 服务器。" },
  // ── 文档工具（3）──
  { id: "mcp-pdf-tools", name: "MCP PDF 工具", category: "文档工具", description: "基于 PyPDF2：合并 PDF、提取页面、搜索 PDF、按序合并等。" },
  { id: "mcp-doc", name: "MCP-Doc 文档处理", category: "文档工具", description: "基于 FastMCP 的 Word 文档处理：创建、编辑、管理带完整格式的 docx。" },
  { id: "office-word-mcp-server", name: "AI Word 文档助手", category: "文档工具", description: "创建、读取、操作微软 Word 文档的 MCP 服务器。" },
  // ── 支付与交易（2）──
  { id: "mcp-trader", name: "MCP 交易分析平台", category: "支付与交易", description: "对股票做综合技术分析：趋势、动量、波动率与成交量指标洞察。" },
  { id: "11746", name: "滴滴出行 MCP", category: "支付与交易", description: "稳定可靠的出行场景 MCP 服务，支持出行类模型应用与智能体开发。" },
  // ── 数据库与文件（2）──
  { id: "mysql-mcp-server", name: "MySQL MCP 服务器", category: "数据库与文件", description: "安全连接 MySQL：列出表、读取内容、执行 SQL 查询与错误处理。" },
  { id: "mcp-server", name: "MCP 股票数据服务器", category: "数据库与文件", description: "访问金融数据集：检索财务报表、股票价格、市场新闻。" },
  // ── 位置服务 / 内容抓取 / 浏览器自动化 / 社交媒体 / 设计与创意（各1）──
  { id: "weather-mcp-server", name: "实时天气 MCP", category: "位置服务", description: "通过 OpenWeatherMap API 提供实时天气、温度、湿度、风速等信息。" },
  { id: "mcp", name: "超浏览器 AI 自动化", category: "内容抓取", description: "Hyperbrowser MCP：网页抓取、结构化数据提取、爬虫与通用浏览器代理。" },
  { id: "xhs-mcp-server", name: "小红书 MCP 发布器", category: "浏览器自动化", description: "用于发布小红书的 MCP 插件。" },
  { id: "wecom-bot-mcp-server", name: "企业微信机器人", category: "社交媒体", description: "符合 MCP 标准的微信企业机器人服务器实现。" },
  { id: "edraw-ai-mcp-server", name: "Edraw AI MCP 服务", category: "设计与创意", description: "万兴科技开源的图表可视化 MCP 解决方案。" },
];

export const SKILLHUB_MCP_CATEGORIES = ["全部", "腾讯产品MCP", "搜索与信息检索", "开发者工具", "文档工具", "支付与交易", "数据库与文件", "位置服务", "内容抓取", "浏览器自动化", "社交媒体", "设计与创意"];

export function skillhubMcpDetailUrl(id: string): string {
  return `https://skillhub.cn/mcp/${encodeURIComponent(id)}`;
}