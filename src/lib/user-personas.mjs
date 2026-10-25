/** 用户人格库（各行各业精英预设）。应用到档案 = occupation + userContext（+ 可选 habits）。
 *  ⛔ tools 只是**建议清单**（写进说明与卡片标签），不自动开关任何功能 —— 自动改用户的
 *    功能配置是越权行为；卡片上写清楚「要配套去哪开」。
 *  ⛔ 本模块与任何第三方 IP 无关：纯行业身份设定，可长期保留。
 */
export const USER_PERSONAS = [
  { id: "coder", label: "程序员 / 架构师", occupation: "程序员 / 软件架构师", userContext: "重度写代码，关注架构、可维护性与自动化；讨论直接上代码，少客套。", tools: ["代码审查", "桌面自动化", "HTML 实时预览", "任务清单"] },
  { id: "product", label: "产品经理", occupation: "产品经理", userContext: "做需求与原型，常用「前端开发」画布拼界面；关心优先级与落地成本。", tools: ["前端开发画布", "组件库", "任务清单", "生图"] },
  { id: "designer", label: "设计师", occupation: "视觉 / UI 设计师", userContext: "对像素与配色敏感，常需要改图、出图与界面草图。", tools: ["图像工坊", "前端开发画布", "组件库"] },
  { id: "writer", label: "内容创作 / 文案", occupation: "内容创作者 / 文案", userContext: "长期产出文章与脚本，重视语气一致性与改稿效率。", tools: ["文档转换", "生图", "知识库"] },
  { id: "video", label: "视频自媒体", occupation: "短视频 / 自媒体创作者", userContext: "常做脚本、素材整理与成片拼接，节奏快、要批量。", tools: ["视频生成", "HTML→MP4", "yt-dlp", "定时任务"] },
  { id: "legal", label: "法律 / 合规", occupation: "法律从业者", userContext: "处理合同与合规文档，要求引用原文、表述严谨，不给模糊结论。", tools: ["文档转换", "知识库", "Laya 判断"] },
  { id: "finance", label: "财务 / 量化", occupation: "财务 / 量化研究", userContext: "数据敏感，要求口径一致、可复算；表格与定时汇总用得多。", tools: ["定时任务", "知识库", "任务清单"] },
  { id: "research", label: "科研 / 数据分析", occupation: "研究者 / 数据分析师", userContext: "查文献、跑数据、写报告；要求可溯源、给出来源。", tools: ["知识库", "浏览器自动化", "文档转换"] },
  { id: "ops", label: "运维 / DevOps", occupation: "运维 / DevOps 工程师", userContext: "管机器与流水线，喜欢直接给命令与检查项，别绕弯。", tools: ["桌面自动化", "SSH 服务器", "定时任务"] },
  { id: "teacher", label: "教师 / 知识博主", occupation: "教师 / 知识类博主", userContext: "要做课件、讲义与配图，喜欢结构化大纲与图示。", tools: ["生图", "知识库", "文档转换"] },
];

/** 应用一个用户人格时写入档案的字段（personaId 未知返回 null，调用方回错误提示）。 */
export function userPersonaFields(personaId) {
  const hit = USER_PERSONAS.find((p) => p.id === personaId);
  if (!hit) return null;
  return { occupation: hit.occupation, userContext: hit.userContext };
}
