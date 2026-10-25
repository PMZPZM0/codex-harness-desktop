#!/usr/bin/env node
/**
 * 12ae-bubu-pack —— 一二布布主题包守卫（10-24 用户立项）。
 *
 * 用户需求四件套：① 表情包 Codex 要能发（含触发状态）；② 双头像（用户 + Codex）可换布布；
 * ③ 一二布布人格；④ 用户人格库（各行各业精英 + 配套工具建议）+ Codex 能改两边的 persona。
 *
 * 钉的都是「断了就静默退化」的接缝：
 *  ① bubu:// 贴纸链 = markdown-url 放行 + Markdown img 解析 + 素材真的在 public/；
 *  ② 人格全文必须带表情包触发表（没有它 Codex 不知道什么时候发哪张）；
 *  ③ 用户中心两张卡：一键应用走 saveIdentity（persona/soulSlug/assistantName）+ 语音包 sid；
 *  ④ persona_apply 工具注册（part08）与分发（part05）成对，self 只认 yierbubu、user 校验 id。
 * ⛔ 美术口径：public 下的布布素材必须是**本应用原创画风**（不许塞版权 IP 图冒充）。
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let checks = 0;
let fails = 0;
const ok = (cond, label) => {
  checks++;
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) fails++;
};
const read = (p) => {
  try { return readFileSync(join(ROOT, p), "utf8"); } catch { return ""; }
};

const pack = read("src/lib/bubu-pack.mjs");
const mdUrl = read("src/lib/markdown-url.ts");
const md = read("src/features/markdown/Markdown.tsx");
const avatars = read("src/lib/avatar-presets.ts");
const center = read("src/components/UserCenter.tsx");
const part08 = read("src/features/app-state/parts/part08/01-seg.tsx");
const part05 = read("src/features/app-state/parts/part05/event-router/02-request.tsx");
const css = read("src/styles/45-settings-experience.css");
const cssMsg = read("src/styles/03-messages-turns.css");
const personaPanel = read("src/features/soul-market/UserPersonaPanel.tsx");
const soulPage = read("src/features/soul-market/SoulMarketSection.tsx");

/* ── ① bubu:// 贴纸链（跑真值表） ── */
const mod = await import(pathToFileURL(join(ROOT, "src/lib/bubu-pack.mjs")).href);
ok(mod.BUBU_STICKER_IDS.join(",") === "hi,thinking,done,fail,wait"
  && mod.BUBU_STICKERS.every((s) => /^bubu-[a-z]+\.png$/.test(s.file) && s.states.length >= 2),
  "贴纸注册表：5 张、id 与文件名规范、每张都带触发状态");
ok(mod.resolveStickerSrc("bubu://hi").endsWith("/stickers/bubu/bubu-hi.png")
  && mod.resolveStickerSrc("bubu://nope") === ""
  && mod.resolveStickerSrc("https://x/y.png") === ""
  && mod.resolveStickerSrc("") === "",
  "真值表：bubu://<已知 id> → 内置资源；未知 id / 非 bubu:// / 空串 → 不解析（不许崩渲染）");
const bubuLine = mdUrl.split("\n").find((l) => l.includes("bubu:") && l.includes(".test(url)"));
ok(Boolean(bubuLine && bubuLine.includes('node.tagName === "img"') && bubuLine.includes('key === "src"')
  && bubuLine.includes("/^bubu:") && bubuLine.includes('i.test(url)')),
  "markdown-url 只为 img.src 放行 bubu://（⛔ 链接与其它 tag 不放行）");
ok(/import \{ resolveStickerSrc \} from "\.\.\/\.\.\/lib\/bubu-pack\.mjs"/.test(md) && /const bubu = resolveStickerSrc\(src\)/.test(md),
  "Markdown img 先走 bubu:// 解析（未知 id 回退 alt 文本渲染）");
for (const f of ["public/avatars/user-bubu.png", "public/avatars/codex-bubu.png",
  "public/stickers/bubu/bubu-hi.png", "public/stickers/bubu/bubu-thinking.png",
  "public/stickers/bubu/bubu-done.png", "public/stickers/bubu/bubu-fail.png", "public/stickers/bubu/bubu-wait.png"]) {
  ok(existsSync(join(ROOT, f)), `素材在位：${f}`);
}
ok(/\.message-image\.bubu-sticker/.test(cssMsg), "贴纸有专属样式（贴纸卡形态，不是裸 200px 大图）");

/* ── ② 人格全文带触发表 + 主题包常量 ── */
ok(/BUBU_PERSONA = `你是一二布布/.test(pack) && /bubuStickerGuide\(\)/.test(pack),
  "一二布布人格全文内嵌表情包触发表（⛔ 没有它 Codex 不知道何时发哪张）");
ok(/voice: \{[\s\S]{0,60}?sid: 1[\s\S]{0,220}?label: "布布[\s\S]{0,220}?label: "一二/.test(pack), "语音包口径如实：布布 / 一二 两档内置音色，不伪造官方配音");
ok(/⛔⛔ 形象说明|原创画风/.test(pack) || /原创画风/.test(pack), "美术口径写明是本应用原创画风（不许拿版权 IP 图冒充）");

/* ── ③ 头像预设 + 用户中心两张卡 ── */
ok((avatars.match(/id: "bubu", label: "一二布布"/g) ?? []).length === 2,
  "用户与 Codex 两侧头像预设各有一条「一二布布」");
ok(/bubu-pack-panel/.test(center) && /一键换上一二布布/.test(center)
  && /saveIdentity\(\{ persona: BUBU_PERSONA, soulSlug: BUBU_PACK\.personaSlug, assistantName: BUBU_PACK\.assistantName \}\)/.test(center),
  "用户中心有一键应用：人格 + soulSlug + 名字走 saveIdentity（写档案 + AGENTS.md）");
ok(/pickPresetAvatar\("user-bubu\.png"\)/.test(center)
  && /avatarAsset\("codex-bubu\.png"\)/.test(center)
  && /voiceSettingsSet\(/.test(center) && /sid: bubuVoiceSid/.test(center)
  && /announce: \{ \.\.\.\(current\?\.settings\?\.announce \?\? \{\}\), enabled: true \}/.test(center)
  && /voicePreviewVoice\(\{ sid: bubuVoiceSid/.test(center)
  && /bubu-pack-voice/.test(center),
  "一键应用同步双头像 + 语音包（sid + 开启播报 + 可试听）");
ok(/user-persona-grid/.test(personaPanel) && /userPersonaFields\(personaId\)/.test(personaPanel)
  && /apply\("default"\)/.test(personaPanel)
  && /配套工具只是建议，不自动改/.test(personaPanel)
  && /<UserPersonaPanel/.test(soulPage) && !/user-persona-grid/.test(center),
  "用户人格卡已搬到人格市场（与 Codex 人格同页）：预设网格 + 应用写档案 + 可恢复空白");
ok(/bubu-pack-stickers/.test(css) && /user-persona-grid/.test(css), "两张卡的样式已定义（缺了会退化成裸元素）");

/* ── ④ persona_apply 工具（注册 + 分发成对） ── */
ok(/name: "persona_apply"/.test(read("src/features/app-view/constants/02-identity-onboarding.tsx"))
  && /target=\\"self\\"：改\*\*你自己\*\*的人格，personaId 只内置 \\"yierbubu\\"/.test(read("src/features/app-view/constants/02-identity-onboarding.tsx")),
  "persona_apply 工具已定义（描述列全 self/user 用法与用户人格 id）");
ok(/PERSONA_APPLY_TOOL,/.test(part08), "part08 注册 persona_apply（每个会话都下发）");
ok(/event\.params\?\.tool === "persona_apply"/.test(part05)
  && /saveIdentity\(\{ persona: BUBU_PERSONA, soulSlug: "yierbubu", assistantName: BUBU_PACK\.assistantName \}\)/.test(part05)
  && /userPersonaFields\(personaId\)/.test(part05)
  && /未知用户人格 id/.test(part05)
  && /下一个新会话开始完全生效/.test(part05),
  "part05 分发：self 只认 yierbubu；user 走人格库校验；回执写明新会话生效");
ok(/import \{ BUBU_PACK, BUBU_PERSONA, USER_PERSONAS, userPersonaFields \} from "[^"]*lib\/bubu-pack\.mjs"/.test(part05),
  "分发端从 bubu-pack 单一真相源取注册表（不许抄第二份人格表）");

console.log(fails ? `\n✗ 12ae 未通过：${fails}/${checks}` : `\n✓ 12ae 通过：${checks}/${checks}`);
process.exit(fails ? 1 : 0);
