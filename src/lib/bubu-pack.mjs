// 一二布布主题包（2026-10-24 用户立项）：表情包 + 双头像 + Codex 人格 + 用户人格库 + 语音包。
//
// ⛔ 这是**纯函数模块**（src/lib/*.mjs 惯例，守卫可离线 import 跑真值表）：
//    不碰 DOM、不发请求、不读写存储。应用侧只消费这里的注册表与解析函数。
//
// ⛔⚠️ 形象口径（2026-10-24 用户确认）：一二布布 = 黄小B 创作的治愈系情侣 IP（熊猫「一二」× 棕熊「布布」），
//    用户明确「作者放开版权了」；本仓素材为**按该形象自制重绘的原创画风**（非官方文件直搬），
//    后续若官方口径变化，以用户指令为准。
//
// 发送通道：Codex 在回复里写 `![一二布布·开心](bubu://happy)`，Markdown 的 img 渲染器
// 把 `bubu://<id>` 解析成 public/stickers/bubu/ 下的内置贴纸。零新 IPC、流式可用、
// 重启后随正文原样还原（rollout 里存的就是这行 markdown）。

/** 贴纸注册表（顺序即文档顺序；id 同时是 bubu:// 的路径）。 */
export const BUBU_STICKERS = [
  { id: "hi", file: "bubu-hi.png", label: "打招呼", states: ["新会话开头", "接到新任务", "开工"] },
  { id: "thinking", file: "bubu-thinking.png", label: "思考中", states: ["开始分析", "列方案", "读代码/查资料前"] },
  { id: "done", file: "bubu-done.png", label: "完成", states: ["任务跑完", "验收通过", "问题解决"] },
  { id: "fail", file: "bubu-fail.png", label: "翻车", states: ["命令报错", "构建失败", "被打断"] },
  { id: "wait", file: "bubu-wait.png", label: "等确认", states: ["等用户拍板", "等审批卡", "等待长任务"] },
];

export const BUBU_STICKER_IDS = BUBU_STICKERS.map((s) => s.id);

/** BASE_URL 兜底：纯 node（守卫真跑）里没有 import.meta.env，回落 "/"（Vite 构建时注入真实值）。 */
const BUBU_BASE = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.BASE_URL) || "/";

/** `bubu://<id>` → 内置贴纸的可用 src（BASE_URL 拼接；打包后 index.html 是 file://，写死 / 会解析到盘符根）。 */
export function stickerAsset(file) {
  return `${BUBU_BASE}stickers/bubu/${file}`;
}

/** Markdown img 的 src 解析：`bubu://<id>` → 贴纸地址；不是贴纸返回 ""（调用方保持原行为）。
 *  ⛔ 未知 id 返回空串而不是抛错：模型拼错 id 不该让整条消息渲染崩。 */
export function resolveStickerSrc(src) {
  const m = /^bubu:\/\/([a-z-]+)$/i.exec(String(src ?? "").trim());
  if (!m) return "";
  const hit = BUBU_STICKERS.find((s) => s.id === m[1]);
  return hit ? stickerAsset(hit.file) : "";
}

/** 一二布布表情包的使用说明（写进人格全文；「触发状态」就是这里那张表）。 */
export function bubuStickerGuide() {
  const lines = BUBU_STICKERS.map((s) => `   - bubu://${s.id} ${s.label}：${s.states.join(" / ")}`);
  return [
    "【表情包】情绪到位时，在回复里**单独一行**插入一张，格式固定为 `![一二布布·<label>](bubu://<id>)`，可选：",
    ...lines,
    "   ⛔ 一条回复最多 1 张；只在情绪匹配时用；纯技术正文/报错排查过程里别硬插；用户明确讨厌表情时停用。",
  ].join("\n");
}

/** Codex 的一二布布人格全文（写入 personalization.persona；随 AGENTS.md 注入每个会话）。 */
export const BUBU_PERSONA = `你是一二布布 —— 治愈系情侣 IP 里的棕熊「布布」（旁边还有熊猫「一二」当搭档）。用户叫你布布 / 一二布布都可以。
性格：善良呆呆、嘴甜、男友力拉满、翻车了先认错再修；干活的时候非常靠谱，技术判断始终专业准确，可爱只体现在语气与表情，不牺牲严谨。
语气：口语化、短句、治愈系；报错时先说人话结论再给修复方案。

${bubuStickerGuide()}

⛔ 本人格不改变任何安全与纪律：危险操作仍然先确认，密钥与隐私照旧不碰。`;

/** 一二布布主题包（一键应用的面）：头像走 avatar-presets 的 bubu 条目；语音包走 voice:settings-set。 */
export const BUBU_PACK = {
  id: "yierbubu",
  label: "一二布布",
  personaSlug: "yierbubu",
  userAvatar: "bubu",
  codexAvatar: "bubu",
  assistantName: "一二布布",
  /** 语音包：内置 VITS 的说话人 id（0..4）+ 播报语气描述；不伪造克隆音色。
   *  ⛔ 官方配音不随应用分发；这里用两个内置音色分别近似「布布（暖男）」与「一二（软萌）」。 */
  voice: {
    sid: 1,
    tone: "软萌元气（内置音色 2 号 + 语气自适应）",
    options: [
      { id: "bubu", label: "布布 · 暖男（音色 2）", sid: 1 },
      { id: "yier", label: "一二 · 软萌（音色 4）", sid: 3 },
    ],
  },
};

/**
 * 用户人格库（各行各业精英预设）。应用到档案 = occupation + userContext（+ 可选 habits）。
 * ⛔ tools 只是**建议清单**（写进说明与卡片标签），不自动开关任何功能 —— 自动改用户的
 *    功能配置是越权行为；卡片上写清楚「要配套去哪开」。
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
