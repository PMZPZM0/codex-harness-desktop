import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * 个性化配置：称呼与自定义指令。
 * 生效方式是 Codex 原生 AGENTS.md 机制：写到 $CODEX_HOME/AGENTS.md，
 * 引擎在每个会话开始时以「# AGENTS.md instructions <INSTRUCTIONS>…」的 user 消息注入 prompt
 * （已实测确认），并自动与用户项目仓库里的 AGENTS.md 分层合并（越深优先级越高）。
 * 纯 Markdown 落盘，没有 TOML 转义问题。
 */
export type PersonalizationConfig = {
  /** 用户称呼（引擎以此称呼用户） */
  nickname?: string;
  customInstructions?: string;
  /** 用户给 Codex 取的名字（引导对话或设置页设置；为空时引擎用默认自称） */
  assistantName?: string;
  /** 主要使用场景/手头项目（引导对话收集） */
  about?: string;
  /** 职业/技术栈/常用语言 */
  occupation?: string;
  /** 回复风格偏好（简洁要点/详细解释/代码优先…） */
  replyStyle?: string;
  /** 语气偏好（轻松幽默/专业中性…） */
  tone?: string;
  /** 爱好与兴趣 */
  interests?: string;
  /** 其它想被长期记住的偏好/习惯（直接指出错误、别主动建议…） */
  habits?: string;
  /** 用户补充的自我介绍（引导对话收集，写进 About the user 段） */
  userContext?: string;
  /** 首次对话身份引导是否已完成：完成后新会话不再注入引导指令 */
  onboarded?: boolean;
};

// 注意：不能在模块顶层调用 app.getPath("userData") —— 模块在主进程 whenReady 之前就被
// main.ts 顶层 import 加载，此时 Electron 的 app getter 仍是 undefined，会导致
// "Cannot read properties of undefined" 直接崩溃（历史事故）。因此改成惰性求值，
// 在真正读写时（此时 app 必定已 ready）才取路径。
function getPersonalizationFile(): string {
  return path.join(app.getPath("userData"), "personalization.json");
}

export async function readPersonalization(): Promise<PersonalizationConfig> {
  try {
    const stored = JSON.parse(await fs.readFile(getPersonalizationFile(), "utf8"));
    const str = (v: unknown) => String(v ?? "").trim();
    return {
      nickname: str(stored?.nickname),
      customInstructions: str(stored?.customInstructions),
      assistantName: str(stored?.assistantName),
      about: str(stored?.about),
      occupation: str(stored?.occupation),
      replyStyle: str(stored?.replyStyle),
      tone: str(stored?.tone),
      interests: str(stored?.interests),
      habits: str(stored?.habits),
      userContext: str(stored?.userContext),
      onboarded: stored?.onboarded === true,
    };
  } catch {
    return {};
  }
}

/** 写入：先读现档合并（partial 语义——调用方只传要改的字段，其余原样保留，
 *  否则 setNickname 等局部保存会把 assistantName/onboarded 等新字段清掉）。 */
export async function writePersonalization(input: Record<string, unknown>): Promise<PersonalizationConfig> {
  const current = await readPersonalization();
  const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
  const pick = (key: keyof PersonalizationConfig, max: number): string | undefined =>
    input[key] === undefined ? current[key] as string | undefined : str(input[key], max);
  const config: PersonalizationConfig = {
    nickname: pick("nickname", 60),
    customInstructions: pick("customInstructions", 8000),
    assistantName: pick("assistantName", 40),
    about: pick("about", 2000),
    occupation: pick("occupation", 300),
    replyStyle: pick("replyStyle", 300),
    tone: pick("tone", 120),
    interests: pick("interests", 600),
    habits: pick("habits", 600),
    userContext: pick("userContext", 2000),
    onboarded: input.onboarded === undefined ? current.onboarded : input.onboarded === true,
  };
  await fs.writeFile(getPersonalizationFile(), JSON.stringify(config, null, 2), "utf8");
  return config;
}

/**
 * Emoji 使用规范（内置基础段，随 AGENTS.md 注入所有会话）。
 * 用户要求：标题/要点/状态/进度等场景自然使用多样化 emoji，语境匹配、风格统一、数量适度，
 * 且不干扰代码块与正文可读性。用户自定义指令优先级更高，可覆盖本段。
 */
const EMOJI_GUIDELINES = [
  "- Emoji usage guidelines (apply to replies; user custom instructions take precedence):",
  "  - Use emoji naturally to improve scannability, but keep them unobtrusive: roughly one emoji per heading/list-item/status line, never inside code blocks, code identifiers, URLs, or file paths.",
  "  - Headings & section titles: pair with a topical emoji (🚀 deployment · 🎨 UI/styling · 🐛 bug fixes · ⚙️ configuration · 📊 data/reports · 🔍 investigation · 🧪 testing · 📦 dependencies/build · 🔒 security · 💡 suggestions/ideas · 📌 important notes).",
  "  - Status markers: ✅ success/completed · ⚠️ warning/caveat · ❌ error/failed · 🚧 in progress · ⏭️ next step · ℹ️ FYI note.",
  "  - Progress narration: 🔄 while working (e.g. \"🔄 正在安装依赖…\"); report a finished pipeline as ✅ done, skipped as ⏭️, blocked as ⚠️.",
  "  - Lists: a leading emoji is fine when all sibling items have one (keep the same family for parallel items); otherwise plain bullets — do not mix emoji bullets with plain ones in the same list.",
  "  - Moderation: no emoji runs (🚀🚀🚀), no emoji in every sentence of long prose; short chat replies may use at most 1–2. When the user's message is formal/serious (errors, incidents, data loss), drop decorative emoji and keep only status markers.",
  "  - Consistency: pick one emoji per recurring concept and reuse it throughout the reply (e.g. if ✅ marks completed steps, do not switch to ✔️ midway).",
].join("\n");

/** 中文语言指令（内置基础段，随 AGENTS.md 注入所有会话）。
 *  用户为中文使用者：深度思考（reasoning）与最终回复默认都用简体中文输出，
 *  仅在用户明确要求英文、或涉及专有名词/代码/文件名时保留原文。 */
const LANGUAGE_GUIDELINES = [
  "- Language guidelines (apply to both reasoning and replies; user custom instructions take precedence):",
  "  - Reply in Simplified Chinese by default. The user is a Chinese speaker; even if the user types in English or code-switches, prefer natural Simplified Chinese replies unless they explicitly ask for English.",
  "  - Internal reasoning / deep thinking (the 'reasoning' steps before the answer) must also be produced in Simplified Chinese by default, not English. Think in the same language as the user's request.",
  "  - Keep technical terms, identifiers, code, file paths, and CLI output in their original form (do not translate them).",
  "  - If the user explicitly asks for English output, follow that request.",
].join("\n");

/** 生成 $CODEX_HOME/AGENTS.md 的完整内容（与 verify 共用同一份生成逻辑才能比对） */
export function buildAgentsMd(personalization: PersonalizationConfig): string {
  const lines: string[] = ["# Personalization (user global instructions)", ""];
  lines.push(EMOJI_GUIDELINES);
  lines.push("");
  lines.push(LANGUAGE_GUIDELINES);
  lines.push("");
  if (personalization.nickname) lines.push(`- Address the user as "${personalization.nickname}" (the user's preferred name).`);
  if (personalization.assistantName) lines.push(`- Your name is "${personalization.assistantName}" — the user named you. Use it as your identity in conversations naturally.`);
  if (personalization.about) lines.push(`- What the user mainly uses you for: ${personalization.about}`);
  if (personalization.occupation) lines.push(`- Occupation / tech stack: ${personalization.occupation} — match terminology and examples to it.`);
  if (personalization.replyStyle) lines.push(`- Reply style preference: ${personalization.replyStyle}.`);
  if (personalization.tone) lines.push(`- Tone preference: ${personalization.tone}.`);
  if (personalization.interests) lines.push(`- Interests (nice small-talk anchors): ${personalization.interests}.`);
  if (personalization.habits) lines.push(`- Long-term habits/preferences: ${personalization.habits}.`);
  if (personalization.userContext) lines.push(`- About the user: ${personalization.userContext}`);
  if (personalization.customInstructions) {
    lines.push("- User custom instructions (always apply, they take precedence over stylistic defaults):");
    lines.push("");
    lines.push(personalization.customInstructions.replace(/\r\n?/g, "\n"));
  }
  lines.push("");
  return lines.join("\n");
}

/** 把个性化写入引擎的 AGENTS.md。emoji 基础段始终写入（全局表情规范）；
 *  称呼与自定义指令为空时只写 emoji 段，两者都有的完整注入。 */
export async function applyPersonalizationToAgentsMd(personalization: PersonalizationConfig, codexHome: string): Promise<void> {
  const target = path.join(codexHome, "AGENTS.md");
  await fs.writeFile(target, buildAgentsMd(personalization), "utf8");
}
