/**
 * 记忆捕获的纯逻辑（09-22 新增）：**坑/纠错必须留痕，且要分类**。
 *
 * 背景（用户实测痛点）：原实现 `buildLogSummary` = 「需求：<用户前 120 字>」+「结果：<助手前 240 字>」——
 *   ① 「结果」取的是**开头**（常是寒暄/计划），真正的结论在末尾；
 *   ② 用户纠错（"不对 / 我让你改 A 你改了 B"）这类消息很短，**会被 greeting / too-short 过滤掉**，
 *      于是"踩过的坑"在记忆里**一条都不留**，下一轮同样的坑照踩。
 *
 * 分类（用户 09-22 追加要求：「纠错的记忆要单独一类」「还要有记忆分类功能」）：
 *   类目沿用**既有那一套命名**（渲染层 `MEMORY_CATEGORIES` 与 L7 权重表用的就是它），只新增「用户纠错」：
 *     · 「用户纠错」= 用户说你做错了 / 不满意 —— **单独一类**：注入排最前、**永不被淘汰**、蒸馏时不许丢；
 *     · 「任务经验」= 自己踩的坑 / 失败 / 回归（含修复结论）；
 *     · 「工作流/SOP」= 定下来的做法与约定（不是坑）；
 *     · 「用户偏好」= 口味 / 习惯 / 禁忌。
 *   ⛔ 不要另起第二套分类名 —— 两套分类 = 同一个东西在两个界面里叫两个名字（本项目记过的坑）。
 *
 * 本模块只做纯函数（无 IO、无 Electron），便于预检直接 require 编译产物跑真断言。
 * 写入策略（与 memory-layers 的门禁一致）：
 *   · 自动捕获 → 只进当天日志；
 *   · 检测到纠错/失败 → 额外产出一条候选行，由调用方按 `category` 追加到 LESSONS.md 的对应分节。
 */

/** 用户侧纠错/不满意信号：命中即**强制记录**（不再受短消息/寒暄过滤影响） */
const CORRECTION_SIGNALS: RegExp[] = [
  /不对|错了|不是这个|不是这样|我说的是|我让你|你怎么|为什么又|又(出|来|是)了|还是(不行|不对|没|老)/,
  /谁让你|别再|不要(动|改|碰)|回退|撤回|撤销|恢复原样|弄坏|搞坏/,
  /(你)?漏了|忘了|看错|搞错|理解错|答非所问|跑偏/,
  /重新(来|做|改)|再改|改回/,
];

/** 助手侧"这轮有坑/有修复"的信号。
 *  ⛔ 09-22 收窄：删掉 `failed` 与 `根因|真因|真正的(原因|问题)` —— 它们是**引用/分析**词，不是失败证据。
 *     实证：回复里引用了 `"reason":"append-failed"`、并分析"根因是 key 两端不同源"，
 *     就被判成"这轮踩了坑"，于是把「用户需求 + 注入块」当现象写进 L2（垃圾纪律行，每轮注入）。
 *     真踩坑时几乎必然命中第 1 条（报错/失败/不生效…）或第 3 条的动作词（修复/已修/回滚）。 */
const FAILURE_SIGNALS: RegExp[] = [
  /* ⛔ 09-23：「回归」单字会命中正常中文（「所有努力终将回归本心」）⇒ 纯测试轮被判成踩坑、白产 L2 垃圾行。
     失败信号必须是**失败证据**，不是常见词 —— 收紧成「回归测试/回归问题/回归了/回归现象」。 */
  /报错|失败|崩溃|打不开|不生效|不工作|回归(?:测试|问题|了|现象)|异常|挂了|断了|白屏|卡住/,
  /\berror\b|Error:|exception|exit code [1-9]/i,
  /修复|已修|已改|改好|回滚|规避/,
];

/** 结论标记：结尾段落里出现这些词，说明它就是结论（优先取它而非首段） */
const CONCLUSION_MARKERS: RegExp[] = [
  /结论|根因|已修|已改|已完成|已落|验证|通过|生效|建议|注意|下一步|遗留|教训|踩坑|坑/,
];

/** 用户偏好信号（口味/习惯/禁忌）——用于把"偏好"与"坑"分开。
 *  ⛔ 「统一用/统一按」这类**不属于偏好**：那是项目约定（SOP）。早先这条正则把它算进偏好，
 *     导致"以后统一用 pnpm"被记成用户口味 —— 归属错层会进错文件（预检【105】抓到的）。 */
const PREFERENCE_SIGNALS: RegExp[] = [
  /我(更喜欢|喜欢|习惯|讨厌|不喜欢|不想|不接受|受不了|希望)/,
  /以后(都|一律|别|不要)|默认(用|走|按)|记住(我)?(的)?(偏好|习惯)/,
];

/** 约定/流程信号（定下来的做法，不是坑） */
const SOP_SIGNALS: RegExp[] = [
  /约定|规范|标准|流程|步骤|一律|必须(先|要)|禁止|不要(再)?用|统一/,
  /SOP|checklist|清单|模板|口径/,
];

const GREETING = /^(你好|hi|hello|在吗|谢谢|ok|好的|嗯|收到|测试|继续|停|帮我看下)\s*[，。！!？?]?$/i;

/* ── 分类（单一分类体系；新增「用户纠错」） ─────────────────────────────── */
export const CORRECTION_CATEGORY = "用户纠错";
export const PITFALL_CATEGORY = "任务经验";
export const SOP_CATEGORY = "工作流/SOP";
export const PREFERENCE_CATEGORY = "用户偏好";

/** 注入顺序：**纠错最前**（最容易再犯的就是它），其次坑，再约定，最后偏好 */
export const MEMORY_CATEGORY_ORDER: readonly string[] = [CORRECTION_CATEGORY, PITFALL_CATEGORY, SOP_CATEGORY, PREFERENCE_CATEGORY];

/** 每类的行前缀（写进 LESSONS.md 一行一条，便于人眼与管理界面区分） */
export const MEMORY_CATEGORY_MARK: Record<string, string> = {
  [CORRECTION_CATEGORY]: "⚠️ 纠错",
  [PITFALL_CATEGORY]: "⚠️ 坑",
  [SOP_CATEGORY]: "约定",
  [PREFERENCE_CATEGORY]: "偏好",
};

/** 该分类在 LESSONS.md 里的分节标题 */
export function lessonSectionTitle(category: string): string {
  return `## ${category}`;
}

export function categoryRank(category: string): number {
  const i = MEMORY_CATEGORY_ORDER.indexOf(category);
  return i < 0 ? MEMORY_CATEGORY_ORDER.length : i;
}

function oneLine(text: string, limit: number): string {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

/**
 * 剥掉注入给引擎的常驻记忆块（纯函数）。
 * ⛔ 为什么必须有：捕获链拿到的是**原始 userContent**，里面带着 `[Harness 常驻记忆 · …]…[常驻记忆结束]`
 *    与 `[Harness 相关记忆，仅供参考]…[记忆结束]` 两大段。不剥掉就会把它们当成"现象/需求"写进
 *    L2 与当天日志（09-22 实证：垃圾纪律行「⚠️ 坑：看下你的记忆板块功能，自检一下 [Harness 相关记忆…]」，
 *    零复用价值却进 L2、永不淘汰、每轮注入）。
 * ⚠️ 剥集**四处同源**（头尾标签都要求独立成行）：本处 · src/lib/harness-block-strip.mjs ·
 *    electron/thread-backup.ts · electron/rollout-worker.cjs（真源，不是被 gen 脚本重写的 -source.ts）。
 *    src/lib/user-refs.ts 只**调用** harness-block-strip，不持有正则。预检【119】钉住这四处。
 */
export function stripInjectedBlocks(text: string): string {
  return String(text ?? "")
    /* 闭合标签必须**独立成行**（09-23 自指污染）：L2 纪律行会在正文里字面写出闭合标签，
       非贪婪成对正则会**在它内部提前闭合** ⇒ 只剥前半段、后半段铺进 L4「需求」/L2「现象」，
       并继续喂出新的垃圾行。注入端拼的就是独立一行（memory-layers:705/711、send.tsx:278）。 */
    .replace(/^\[Harness 常驻记忆[^\]]*\][\s\S]*?^\[常驻记忆结束\][ \t]*\r?\n?/gm, "")
    .replace(/^\[Harness 相关记忆，仅供参考\][\s\S]*?^\[记忆结束\][ \t]*\r?\n?/gm, "")
    /* 落盘侧必须剥得**最干净**：L4「需求」/L2「现象」直接来自这里，漏一类就是每轮把机器块写进记忆。
       ⛔ 09-23 评审实测：只剥常驻/召回时，短消息轮的「需求」会带上技能块与时间块（长消息轮被 oneLine(120) 截断掩盖了）。 */
    .replace(/^\[本轮已引用技能\][\s\S]*?^\[请按上述技能工作流执行\][ \t]*\r?\n?/gm, "")
    .replace(/^\[当前时间\][\s\S]*?^\[时间结束\][ \t]*\r?\n?/gm, "")
    .trim();
}

/** 用户是否在纠错/不满（命中任一信号即算） */
export function detectCorrection(userText: string): { hit: boolean; signals: string[] } {
  const text = String(userText ?? "");
  const signals: string[] = [];
  for (const re of CORRECTION_SIGNALS) {
    const m = text.match(re);
    if (m) signals.push(m[0]);
  }
  return { hit: signals.length > 0, signals: [...new Set(signals)].slice(0, 3) };
}

/** 助手这轮是否涉及失败/修复 */
export function detectFailure(assistantText: string): { hit: boolean; signals: string[] } {
  const text = String(assistantText ?? "");
  const signals: string[] = [];
  for (const re of FAILURE_SIGNALS) {
    const m = text.match(re);
    if (m) signals.push(m[0]);
  }
  return { hit: signals.length > 0, signals: [...new Set(signals)].slice(0, 3) };
}

/**
 * 判定这条记忆属于哪一类。
 * ⛔ 优先级即纪律：**纠错 > 坑 > 偏好 > 约定** —— 用户说你做错了，这条首先是一条"纠错"，
 *    而不是"任务经验"（否则最该被优先看到的纪律会被埋进坑堆里）。
 */
export function classifyMemory(
  userContent: string,
  assistantContent: string,
  signals?: { correction?: boolean; failure?: boolean },
): string {
  const user = String(userContent ?? "");
  const assistant = String(assistantContent ?? "");
  const correction = signals?.correction ?? detectCorrection(user).hit;
  if (correction) return CORRECTION_CATEGORY;
  if (signals?.failure ?? detectFailure(assistant).hit) return PITFALL_CATEGORY;
  if (PREFERENCE_SIGNALS.some((re) => re.test(user))) return PREFERENCE_CATEGORY;
  if (SOP_SIGNALS.some((re) => re.test(`${user}\n${assistant}`))) return SOP_CATEGORY;
  /* 兜底：既然要被记录，按最保守的「任务经验」记 —— 注入在纠错之后、但永不被淘汰 */
  return PITFALL_CATEGORY;
}

/**
 * 抽结论：**倾向末尾**（结论/总结通常在最后一段），并剥掉开场寒暄。
 * 判据：从末尾往前找第一个"够长且像结论"的段落（含结论标记，或就是最后一段且 ≥24 字）。
 */
export function extractConclusion(assistantText: string): string {
  const raw = String(assistantText ?? "").trim();
  if (!raw) return "";
  const paras = raw.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (!paras.length) return "";
  const stripLead = (s: string) =>
    s.replace(/^(好的|好了|行|收到|明白|了解|我先|让我|接下来|那(么)?|嗯)[，,：:、\s]*/g, "").trim();
  for (let i = paras.length - 1; i >= 0; i--) {
    const p = stripLead(paras[i]);
    if (!p) continue;
    const isLast = i === paras.length - 1;
    if (CONCLUSION_MARKERS.some((re) => re.test(p)) || (isLast && p.length >= 24)) return oneLine(p, 240);
  }
  return oneLine(stripLead(paras[0]), 240);
}

/** 是否值得记（**纠错优先**：命中即记，哪怕消息很短） */
export function shouldCapture(userContent: string, assistantContent: string): { record: boolean; reason: string; forced: boolean } {
  /* ⛔ 必须先剥注入块：常驻记忆块的标题里就含「别再犯」⇒ 不剥会让**每一轮**都命中纠错信号
     （实证 09-22：带注入块的回合 forced=true、reason=correction-forced(别再)；不带的回合 forced=false） */
  const user = stripInjectedBlocks(userContent).trim();
  const assistant = String(assistantContent ?? "");
  const correction = detectCorrection(user);
  if (correction.hit) return { record: true, reason: `correction-forced(${correction.signals.join("/")})`, forced: true };
  const text = `${user} ${assistant}`.trim();
  if (!text || text.length < 8) return { record: false, reason: "too-short", forced: false };
  if (GREETING.test(user) && assistant.trim().length < 60) return { record: false, reason: "greeting", forced: false };
  return { record: true, reason: "ok", forced: false };
}

/* ── 回合重点摘要（10-17 新增）────────────────────────────────────────
   ⛔⛔ 为什么要它：原实现把「助手回复的**最后一段**，≥24 字即算结论」当回合结论 ——
   那不是摘要，是**截取**：收尾语「需要我继续吗？」「以上就是全部改动」同样会被当成结论写进 L4，
   于是日志看起来就是**流水账**（用户实测反馈：「不会生成回合重点摘要」）。
   改为**按结构提取**（纯启发式，⛔ 不调模型 —— 捕获链必须便宜且离线可用）：
   结论 / 根因 / 改动 / 验证 / 遗留，五类字段各自取**命中段落里最长的那段**，
   拼成一行重点；**一个字段都提不到时诚实降级**为「（未识别到结论）+ 首段」，⛔ 不假装那是结论。 */
const SUMMARY_FIELDS: Array<{ label: string; re: RegExp }> = [
  { label: "结论", re: /结论|已落|已修|已改|已实现|已完成|定位到/ },
  { label: "根因", re: /根因|真因|原因(?:是|在)|因为|问题出在/ },
  { label: "改动", re: /改动|新增|删除了?|改成|替换为|接入|接线/ },
  { label: "验证", re: /验证|实测|测试通过|确认|回归/ },
  { label: "遗留", re: /遗留|待办|下一步|未做|尚未|还需|待确认/ },
];

/** 抽一段"重点"。优先取命中且最长的那段 —— 长段信息量通常更大，且能压下同段落里的寒暄。 */
function pickParagraph(paras: string[], re: RegExp): string {
  const hit = paras.filter((p) => re.test(p) && p.length >= 12);
  if (!hit.length) return "";
  return oneLine(hit.reduce((a, b) => (b.length > a.length ? b : a)), 240);
}

export type TurnSummary = { line: string; fields: string[]; degraded: boolean };

/** 回合重点摘要：返回 `- 重点：… · 根因：… · 改动：…` 形态的一行（最多三个字段，控注入长度）。 */
export function summarizeTurn(assistantText: string): TurnSummary {
  const paras = stripInjectedBlocks(String(assistantText ?? ""))
    .split(/\n{2,}/)
    .map((p) => p.replace(/^(好的|好了|行|收到|明白|了解|我先|让我|接下来|那(?:么)?|嗯)[，,：:、\s]*/g, "").trim())
    .filter(Boolean);
  if (!paras.length) return { line: "", fields: [], degraded: false };
  const picked: Array<{ label: string; text: string }> = [];
  for (const f of SUMMARY_FIELDS) {
    const text = pickParagraph(paras, f.re);
    /* ⛔ 同一段不要重复占用多个字段（一段话同时含"根因"和"验证"是常态）—— 取到就标记已用 */
    if (text && !picked.some((p) => p.text === text)) picked.push({ label: f.label, text });
  }
  if (!picked.length) {
    /* 降级：没有结构信号 ⇒ 取首段，并**如实标注**（⛔ 不许把它包装成"结论"） */
    const fallback = oneLine(paras[0], 240);
    return fallback
      ? { line: `- 重点（未识别到结论）：${fallback}`, fields: ["fallback"], degraded: true }
      : { line: "", fields: [], degraded: true };
  }
  /* 只留前三个字段：注入预算有限，`改动/验证/遗留` 里最不缺的是细节 */
  const top = picked.slice(0, 3);
  return { line: `- 重点：${top.map((p) => (p.label === "结论" ? p.text : `${p.label}：${p.text}`)).join(" · ")}`, fields: top.map((p) => p.label), degraded: false };
}

/** 当天日志条目：需求 / **回合重点摘要**（+ 坑，若这轮有） */
export function buildLogEntry(userContent: string, assistantContent: string): string {
  /* ⛔ 先剥注入块：否则当天日志的「需求」字段整段是 `[Harness 相关记忆，仅供参考] [任务经验] …`（实证） */
  const cleanUser = stripInjectedBlocks(userContent);
  const cleanAssistant = stripInjectedBlocks(assistantContent);
  const ask = oneLine(redactSensitive(cleanUser), 120);
  const summary = summarizeTurn(redactSensitive(cleanAssistant));
  const failure = detectFailure(cleanAssistant);
  const lines = [
    ask ? `- 需求：${ask}` : "",
    /* ⛔ 10-17 起用**回合重点摘要**替代原先的「最后一段」截取（见 summarizeTurn 的说明）。 */
    summary.line,
  ];
  if (failure.hit) lines.push(`- ⚠️ 这轮涉及失败/修复（${failure.signals.join("、")}）`);
  return lines.filter(Boolean).join("\n");
}

/* ── 写入判据（10-17 新增）：给「调用方已经决定要记」的路径兜底 ─────────────
   ⛔ 与 `buildLessonLine` 的分工（**别搞成两套判据** —— 本文件头就写过这条纪律）：
     · 自动捕获链走 `buildLessonLine`：门槛 = 命中「纠错 / 失败」信号才产出一行；
     · 这条给「直接写入」路径（收藏、引擎手写、记忆工具、文件收藏）兜底 ——
       它们绕过了 buildLessonLine，原本只有去重、**没有任何价值判据**。
   ⛔ 默认**保留**（fail-open）：宁可多记一条，也不要让启发式误判把用户有意留下的东西丢掉。
     只有命中**明显的流水特征**才拒，并且拒的时候要给出原因（可审计、判据本身可被复盘修正）。

   一句话判据：**日志记「发生了什么」，记忆记「下次该怎么做」。**
   不能改变未来行为的内容 ⇒ 只该待日志里。 */
const FLOW_PATTERNS: Array<[RegExp, string]> = [
  /* ⛔ 别用 `\b` 收尾：CJK 不是 JS 的 `\w`，`已完成\b` 在「已完成 3 个」上**永不匹配**（真值表抓到的）。
     用「后跟空白/标点或行尾」的先行断言替代。 */
  [/^\s*(?:已完成|正在|继续|接下来|下一步|进度|耗时|用时|运行了|执行了|开始|结束)(?=[\s，。：,:；;]|$)/, "progress-narration"],
  [/^\s*[$>#]\s/, "shell-echo"],
  /* ⛔ 命令回显：`npm run check` 是三个词，早先写成「正好两个词」漏掉了它（真值表抓到）。 */
  [/^\s*(?:npm|pnpm|yarn|git|node|npx|curl|ssh|uv|pip)\s+\S/, "command-echo"],
  [/^[\w./\\-]+\.(?:ts|tsx|js|mjs|cjs|json|md|css|yaml|yml|toml|py|exe)$/i, "bare-path"],
  [/^[0-9a-f]{16,}$/i, "bare-hash-or-id"],
  [/^\s*\d{1,2}:\d{2}(:\d{2})?\s/, "timestamp-line"],
  [/^[\s\d.,%·:：+\-/]+$/, "numbers-only"],
  [/^\s*(改了|新增了|删除了|创建了)\s*[\w./\\-]+\s*$/, "file-change-narration"],
  [/^\s*共\s*\d+\s*(个|条|项)/, "count-summary"],
];

/* ── 敏感信息闸门（10-17，P0）────────────────────────────────────────
   ⛔⛔ 为什么是 P0：捕获链**每轮**把「需求 + 摘要」写进 L4、并且**每轮注入回上下文** ——
   用户在对话里贴过的 API key / 数据库密码 / 证件号会**原样落盘并长期回灌**。
   ⛔ 项目里已有的 `sanitize()` 只作用于**服务端日志**，**不覆盖记忆落盘**（两件事）。
   ⛔ 生态里成熟做法都是默认拦：SkillHub `memory-keeper-studio`「敏感信息如账号密码与完整证件号**拦截**」、
   `agent-memory-keeper`「敏感信息**默认不记**」。
   ⛔ 量度取**高精度低误伤**：宁可漏一点，也不要把正常内容判成敏感（误杀比漏放更伤可用性）。
   ⛔ **敏感一律优先于纠错** —— 「不对，我的密码是 xxx」命中纠错，但**绝不能因此写进记忆**。 */
const SENSITIVE_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "私钥块"],
  [/\b(?:sk|sk-ant|sk-proj|ghp|gho|ghs|github_pat|glpat|xox[baprs]|AKIA|AIza|ya29)[-_]?[A-Za-z0-9_-]{16,}/, "API 密钥"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, "JWT"],
  [/(?:password|passwd|pwd|secret|token|api[-_]?key|access[-_]?key)\s*[:=]\s*["']?[^\s"']{8,}/i, "口令/密钥赋值"],
  [/\b\d{17}[\dXx]\b/, "身份证号"],
  [/(?:卡号|银行卡|card\s*no)\D{0,8}\d{16,19}/i, "银行卡号"],
  [/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/]+:[^\s@/]+@/, "带凭据的连接串"],
];

/** 命中的敏感信息种类（空数组 = 干净）。 */
export function scanSensitive(text: string): string[] {
  const t = String(text ?? "");
  if (!t) return [];
  return SENSITIVE_PATTERNS.filter(([re]) => re.test(t)).map(([, kind]) => kind);
}

/** 把敏感片段**隐去**（用于日志：回合流水要留，但不能留密钥）。
 *  ⛔ 与 shouldRememberLine 的处理不同 —— 那里是**整条拒写**（记忆不需要一个"此处曾有密钥"的痕迹）。 */
export function redactSensitive(text: string): string {
  let t = String(text ?? "");
  for (const [re, kind] of SENSITIVE_PATTERNS) t = t.replace(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`), `「已隐去·${kind}」`);
  return t;
}

/** 流水特征的**名字**（守卫【memGate】用它比对技能正文 —— ⛔ 只暴露名字，不暴露正则，正则属实现细节）。
 *  存在的唯一理由：判据同时活在"代码执行体"与"给模型看的技能正文"两处，
 *  两处各写一份必然漂移，而漂移**不会报错**（技能里说会拦、实际没拦）。这条让漂移立刻打红。 */
export const MEMORY_FLOW_REASONS: readonly string[] = FLOW_PATTERNS.map(([, why]) => why);

/** 一条纪律/记忆**值不值得写**。返回 `keep:false` 时调用方必须**记一条日志说明原因**，⛔ 不许静默吞。 */
export function shouldRememberLine(text: string, category?: string): { keep: boolean; reason: string } {
  const t = oneLine(String(text ?? ""), 400);
  if (!t) return { keep: false, reason: "empty" };
  /* ⓪ 敏感信息**最先判**，且优先于纠错 —— 「不对，我的密码是 xxx」命中纠错，但绝不能因此写进记忆。 */
  const sensitive = scanSensitive(t);
  if (sensitive.length) return { keep: false, reason: `sensitive:${sensitive.join("/")}` };
  /* ① 纠错永不拦 —— 用户亲手纠正的东西，优先级高于任何启发式 */
  if (category === CORRECTION_CATEGORY || CORRECTION_SIGNALS.some((re) => re.test(t))) return { keep: true, reason: "correction" };
  /* ② 强价值信号（失败/约定/偏好）⇒ 留 */
  if ([...FAILURE_SIGNALS, ...SOP_SIGNALS, ...PREFERENCE_SIGNALS].some((re) => re.test(t))) return { keep: true, reason: "signal" };
  /* ③ 明显的流水特征 ⇒ 拒（带上原因）
     ⛔ 顺序必须在 ④ 之前：`已完成` 同时是「结论标记」和「进度播报」——
     先判结论的话，「已完成 3 个文件的修改」会被当成有价值的结论留下（真实冲突，实读发现）。 */
  for (const [re, why] of FLOW_PATTERNS) if (re.test(t)) return { keep: false, reason: why };
  /* ④ 弱价值信号（结论标记）—— 垫在流水之后 */
  if (CONCLUSION_MARKERS.some((re) => re.test(t))) return { keep: true, reason: "conclusion" };
  return { keep: true, reason: "default" };
}

export type LessonCandidate = { line: string; dedupeKey: string; basis: string; category: string } | null;

/**
 * 生成一条待写入的纪律行（写进 LESSONS.md 的对应分节）。
 * 触发：用户纠错 **或** 助手这轮明确出现失败/修复。
 * 形态：`- YYYY-MM-DD ⚠️ 纠错：<现象> → <根因/解法>`（坑用 `⚠️ 坑：`，偏好用 `偏好：`，约定用 `约定：`）。
 */
export function buildLessonLine(input: { userContent: string; assistantContent: string; date: string; threadId?: string }): LessonCandidate {
  /* ⛔ 剥注入块：userContent 里带着常驻记忆块，直接当"现象"会把注入内容写进 L2（实证的垃圾纪律行） */
  const user = stripInjectedBlocks(input.userContent);
  const assistant = stripInjectedBlocks(input.assistantContent);
  const correction = detectCorrection(user);
  const failure = detectFailure(assistant);
  if (!correction.hit && !failure.hit) return null;

  const category = classifyMemory(user, assistant, { correction: correction.hit, failure: failure.hit });
  const phenomenon = oneLine(user, 90) || oneLine(assistant, 90);
  const conclusion = extractConclusion(assistant) || oneLine(assistant, 160);
  const basis = correction.hit ? `correction(${correction.signals.join("/")})` : `failure(${failure.signals.join("/")})`;
  const mark = MEMORY_CATEGORY_MARK[category] ?? "⚠️ 坑";
  const line = `- ${input.date} ${mark}：${phenomenon}${conclusion ? ` → ${conclusion}` : ""}`;
  /* 去重键：现象归一化后取前 32 字。
     ⛔ 09-22 自审抓到的坑：用户只回「不对」时，若只拿现象做键，两条**不同**的纠错会撞成同一个 key ⇒
     第二条被当成重复丢掉（丢信息，且用户永远不知道该记）。所以现象过短时把结论段并进键里。 */
  const norm = (s: string) => s.replace(/[\s，。！？、,.!?:：；;""''（）()【】\[\]]/g, "");
  const keySource = norm(phenomenon).length >= 6 ? phenomenon : `${phenomenon}${conclusion}`;
  const dedupeKey = norm(keySource).slice(0, 32);
  return { line: oneLine(line, 320), dedupeKey, basis, category };
}

/* ── L0 用户档案（跨项目画像） ────────────────────────────────────────── */

/** 画像信号：**关于用户本人的稳定事实**（角色 / 技术栈 / 口味 / 习惯 / 禁忌 / 工作方式）。
 *  ⛔ 与「用户偏好」的区别：偏好是**本项目**的口味（进 L2 preferences.md，随项目走）；
 *     画像是**跨项目**的事实（进 userData 下的 L0 USER.md，每个工作区都注入）。 */
const PROFILE_SIGNALS: RegExp[] = [
  /我(更喜欢|喜欢|习惯|一贯|通常|总是|讨厌|不喜欢|不接受|受不了)/,
  /我(的)?(口味|习惯|偏好|禁忌|底线|原则|工作方式|工作流)/,
  /记住(我)?(的)?(偏好|习惯|口味)/,
];

/** 单句长度闸：超过它多半是**当次任务描述**（"我喜欢蓝色，把按钮改成蓝"），不是稳定事实 */
const PROFILE_MAX_CHARS = 80;

/**
 * L0 画像候选行：`- YYYY-MM-DD 画像：<事实>`。
 * 去重与"只追加、绝不改写/删除既有行"由 MemoryLayers.appendUserProfile 负责，这里只产候选。
 * ponytail: 长度闸是启发式，挡不住"带任务的偏好句"；误报代价 = USER.md 多一行（可人工删），
 *           比"跨项目画像永远不积累"低得多。
 */
export function buildUserProfileLine(input: { userContent: string; date: string }): { line: string; basis: string } | null {
  const user = stripInjectedBlocks(input.userContent);
  if (!user || user.length > PROFILE_MAX_CHARS) return null;
  const fact = oneLine(user, PROFILE_MAX_CHARS);
  const hit = PROFILE_SIGNALS.find((re) => re.test(fact));
  if (!hit) return null;
  return { line: `- ${input.date} 画像：${fact}`, basis: "profile" };
}

/* ── 分节读写（分类的落地形态） ──────────────────────────────────────── */

export type LessonSection = { category: string | null; lines: string[] };

/** 按 `## 分类` 标题把 LESSONS.md 拆成段（category=null 表示文件头的无标题前言） */
export function splitLessonSections(text: string): LessonSection[] {
  const out: LessonSection[] = [];
  let cur: LessonSection = { category: null, lines: [] };
  for (const line of String(text ?? "").split("\n")) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      if (cur.lines.length || cur.category) out.push(cur);
      cur = { category: m[1], lines: [] };
    } else {
      cur.lines.push(line);
    }
  }
  out.push(cur);
  return out;
}

/** 各类计数（设置页显示"纠错 N 条 / 坑 N 条 …"） */
export function groupLessonSections(text: string): { category: string; count: number; chars: number }[] {
  return splitLessonSections(text)
    .filter((s) => s.category)
    .map((s) => {
      const body = s.lines.join("\n");
      return {
        category: s.category as string,
        count: s.lines.filter((l) => /^\s*-\s+/.test(l)).length,
        chars: body.trim().length,
      };
    });
}

/**
 * 注入前重排：分节按 MEMORY_CATEGORY_ORDER 排序（**纠错最前**），未知分类保持原序垫后。
 * ⛔ 只重排、不改内容（磁盘上的顺序不动，用户手写的组织方式不被覆盖）。
 */
export function sortLessonSections(text: string): string {
  const sections = splitLessonSections(text);
  const preamble = sections.filter((s) => !s.category);
  const named = sections
    .filter((s) => s.category)
    .map((s, i) => ({ s, i }))
    .sort((a, b) => categoryRank(a.s.category as string) - categoryRank(b.s.category as string) || a.i - b.i)
    .map((x) => x.s);
  const render = (s: LessonSection) =>
    [...(s.category ? [lessonSectionTitle(s.category)] : []), ...s.lines].join("\n");
  return [...preamble, ...named].map(render).join("\n");
}

/**
 * 分节内追加一行（**不改动其它分节**）：找不到该分类的节就在文件末尾新建一节。
 * 「用户纠错」节由 appendLesson 调用方保证排在最前 —— 这里只保证**不破坏**已有内容。
 */
export function appendLessonLine(text: string, category: string, line: string): string {
  const src = String(text ?? "").trimEnd();
  const heading = lessonSectionTitle(category);
  if (!src) {
    return `# 纪律与记忆\n\n> 按分类分节：用户纠错（注入最前、永不淘汰）/ 任务经验 / 工作流-SOP / 用户偏好。\n\n${heading}\n${line}\n`;
  }
  const lines = src.split("\n");
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start < 0) return `${src}\n\n${heading}\n${line}\n`;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) { end = i; break; }
  }
  /* 插到该节末尾（跳过节尾空行之前），保持节内 append-only 语义 */
  let insert = end;
  while (insert > start + 1 && !lines[insert - 1].trim()) insert -= 1;
  const next = [...lines.slice(0, insert), line, ...lines.slice(insert)];
  return `${next.join("\n").replace(/\s*$/, "")}\n`;
}
