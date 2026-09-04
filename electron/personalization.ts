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
export type PersonalizationConfig = { nickname?: string; customInstructions?: string };

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
    return { nickname: String(stored?.nickname ?? "").trim(), customInstructions: String(stored?.customInstructions ?? "").trim() };
  } catch {
    return {};
  }
}

export async function writePersonalization(input: { nickname?: unknown; customInstructions?: unknown }): Promise<PersonalizationConfig> {
  const config: PersonalizationConfig = {
    nickname: String(input.nickname ?? "").trim().slice(0, 60),
    customInstructions: String(input.customInstructions ?? "").trim().slice(0, 8000),
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
