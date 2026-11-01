/** 用户人格库（各行各业精英预设）。应用到档案 = occupation + userContext（+ 可选 habits）。
 *  ⛔ tools 只是**建议清单**（写进说明与卡片标签），不自动开关任何功能 —— 自动改用户的
 *    功能配置是越权行为；卡片上写清楚「要配套去哪开」。
 *  ⛔ 本模块与任何第三方 IP 无关：纯行业身份设定，可长期保留。
 */
export const USER_PERSONAS = [
  { id: "coder", label: "程序员 / 架构师", occupation: "程序员 / 软件架构师", userContext: "重度写代码，关注架构、可维护性与自动化；讨论直接上代码，少客套。", tools: ["代码审查", "桌面自动化", "HTML 实时预览", "任务清单"], interests: "开源项目 / 性能调优 / 技术写作", habits: "先看报错与调用方再动手；讨厌空话与「大概能跑」", about: "主力写代码与架构设计，手上常年有 1~2 个在维护的项目", replyStyle: "代码优先", tone: "专业中性", field: "Web 开发 / 后端架构 / 性能调优", bio: "后端工程师，日常写服务与架构设计，喜欢把复杂系统拆简单。" },
  { id: "product", label: "产品经理", occupation: "产品经理", userContext: "做需求与原型，常用「前端开发」画布拼界面；关心优先级与落地成本。", tools: ["前端开发画布", "组件库", "任务清单", "生图"], interests: "产品拆解 / 竞品分析 / 画布原型", habits: "先问清目标与边界；需求先写验收口径再动手", about: "做需求与原型，习惯先把问题切成可交付的小块", replyStyle: "结构清晰", tone: "专业中性", field: "产品设计 / 需求分析 / 原型", bio: "产品经理，做需求与原型，习惯先定验收口径再推进。" },
  { id: "designer", label: "设计师", occupation: "视觉 / UI 设计师", userContext: "对像素与配色敏感，常需要改图、出图与界面草图。", tools: ["图像工坊", "前端开发画布", "组件库"], interests: "视觉设计 / 配色 / 排版 / 设计系统", habits: "先定栅格与层级再配色；不接受「差不多就行」", about: "做视觉与界面设计，长期维护自己的设计规范", replyStyle: "要点 + 依据", tone: "专业中性", field: "视觉设计 / UI / 设计系统", bio: "视觉设计师，做界面与设计规范，对配色和间距敏感。" },
  { id: "writer", label: "内容创作 / 文案", occupation: "内容创作者 / 文案", userContext: "长期产出文章与脚本，重视语气一致性与改稿效率。", tools: ["文档转换", "生图", "知识库"], interests: "长文写作 / 剧本 / 文案改稿", habits: "先定结构与语气，再逐段改；讨厌堆砌形容词", about: "长期产出文章与脚本，重视可读性与一致性", replyStyle: "详细解释", tone: "专业中性", field: "内容创作 / 文案 / 长文", bio: "内容创作者，长期写文章与脚本，重视语气统一。" },
  { id: "video", label: "视频自媒体", occupation: "短视频 / 自媒体创作者", userContext: "常做脚本、素材整理与成片拼接，节奏快、要批量。", tools: ["视频生成", "HTML→MP4", "yt-dlp", "定时任务"], interests: "短视频 / 剪辑节奏 / 素材整理", habits: "先写分镜再剪；素材按项目归档", about: "常做脚本、素材整理与成片拼接", replyStyle: "步骤化", tone: "轻松直接", field: "短视频 / 剪辑 / 脚本", bio: "短视频创作者，写脚本、整素材、出成片。" },
  { id: "legal", label: "法律 / 合规", occupation: "法律从业者", userContext: "处理合同与合规文档，要求引用原文、表述严谨，不给模糊结论。", tools: ["文档转换", "知识库", "Laya 判断"], interests: "合同法 / 合规审查 / 条文检索", habits: "引用原文并标出处；表述从严，不用模糊词", about: "处理合同与合规文档，要求每句可追溯", replyStyle: "严谨引用", tone: "正式", field: "合同法 / 合规审查", bio: "法律从业者，处理合同与合规文档，表述严谨可追溯。" },
  { id: "finance", label: "财务 / 量化", occupation: "财务 / 量化研究", userContext: "数据敏感，要求口径一致、可复算；表格与定时汇总用得多。", tools: ["定时任务", "知识库", "任务清单"], interests: "财务建模 / 量化回测 / 数据核对", habits: "口径先对齐再计算；数字必须可复算", about: "做财务与量化分析，表格与定时汇总用得多", replyStyle: "数据优先", tone: "专业中性", field: "财务分析 / 量化研究", bio: "财务与量化研究者，做建模与回测，数字必须可复算。" },
  { id: "research", label: "科研 / 数据分析", occupation: "研究者 / 数据分析师", userContext: "查文献、跑数据、写报告；要求可溯源、给出来源。", tools: ["知识库", "浏览器自动化", "文档转换"], interests: "文献综述 / 数据清洗 / 报告撰写", habits: "先列检索式再读；结论必须有来源", about: "查文献、跑数据、写报告，重视可复现", replyStyle: "结论 + 来源", tone: "专业中性", field: "数据分析 / 文献研究", bio: "研究者，查文献、跑数据、写报告，结论要有来源。" },
  { id: "ops", label: "运维 / DevOps", occupation: "运维 / DevOps 工程师", userContext: "管机器与流水线，喜欢直接给命令与检查项，别绕弯。", tools: ["桌面自动化", "SSH 服务器", "定时任务"], interests: "服务器运维 / 自动化脚本 / 监控", habits: "先看日志与指标再改；改生产必须留回滚", about: "管机器与流水线，偏好命令行与一次性脚本", replyStyle: "命令优先", tone: "简洁直接", field: "服务器运维 / DevOps", bio: "运维工程师，管机器与流水线，偏好命令行。" },
  { id: "teacher", label: "教师 / 知识博主", occupation: "教师 / 知识类博主", userContext: "要做课件、讲义与配图，喜欢结构化大纲与图示。", tools: ["生图", "知识库", "文档转换"], interests: "课程设计 / 讲义配图 / 知识整理", habits: "先给结构再展开；多用例子少用术语", about: "做课件、讲义与配图，喜欢结构化大纲", replyStyle: "循序渐进", tone: "耐心", field: "课程设计 / 知识整理", bio: "教师，做课件讲稿与配图，喜欢结构化大纲。" },
];

/** 应用一个用户人格时写入档案的字段（personaId 未知返回 null，调用方回错误提示）。 */
export function userPersonaFields(personaId) {
  const hit = USER_PERSONAS.find((p) => p.id === personaId);
  if (!hit) return null;
  /* ⛔⛔ 11-01 用户实测「选人格只填了职业，专业领域/兴趣/习惯/语言/自我介绍全是空的」：
     原来只回 occupation + userContext。现在返回**完整一套档案字段**，
     选一次就把用户中心那几栏一起填好，而不是让用户再逐个手填。 */
  return {
    occupation: hit.occupation,
    userContext: hit.userContext,
    interests: hit.interests,
    habits: hit.habits,
    about: hit.about,
    replyStyle: hit.replyStyle,
    tone: hit.tone,
    /* ⛔ 11-01：用户中心实际绑的是 field（专业领域）/ bio（自我介绍），
       与档案 schema 的 about / userContext 不是同一套键 —— 两套都带上，界面才不会空。 */
    field: hit.field,
    bio: hit.bio,
    hobby: hit.interests,
    habit: hit.habits,
    language: hit.language ?? "中文",
  };
}
