/**
 * 实时语音 · 守卫（10-08 立）—— 用户当天报的一串问题一次钉死：
 *   ① 「不要做两个实时语音弹窗，展示一个就行了」⇒ 通话面**只能有一个**（输入框上方的舞台条）；
 *   ② 「悬浮窗没在对话框居中」⇒ 舞台条必须按 composer 的实际矩形定位，CSS 里不许再写「窗口居中」的老值；
 *   ③ 「不能拖动」⇒ 该问题随 ① 一起消解（舞台条贴在输入框上，不再有需要拖的浮动卡）；
 *   ④ 「开外放时它把自己的声音录进去当成我发的语音」⇒ 识别 final 必须过文本级回声剔除；
 *   ⑤ 「要很大声才录得进去」⇒ 默认开自动增益，且老档案要迁移；
 *   ⑥ 新需求：语音开/关要有状态注入对话，并在语音场景走「快问快答」。
 *
 * ⛔ 独立守卫（不进 `_ctx.mjs` 的 MODULES）⇒ 不计入 EXPECTED_CHECKS，与 11* 系列同款；
 *   必须同时加进 `package.json` 的 check 链，否则等于没写。
 * ⛔ 回声真值表是**真跑**（直接 import src/lib/voice-echo.mjs）——「注释声称有」在本仓是最危险的假象。
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./_ctx.mjs";
import { isLikelySelfEcho, echoSimilarity, ECHO_TAIL_MS } from "../../src/lib/voice-echo.mjs";

let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log(`  ${c ? "✓" : "✗"} 【voice-call】${m}`); if (!c) fails++; };
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const has = (rel) => existsSync(join(ROOT, rel));
/* ⛔ 负向结构断言必须先剥注释：本域刚好在 `.voice-stage` 块里**说明**了被替换掉的旧值
   （「原来写的是 top:84px; left:50%…」）—— 裸匹配会把注释顶成假红（本仓已三次同型）。 */
const codeOnlyCss = (source) => String(source).replace(/\/\*[\s\S]*?\*\//g, "");
const codeOnlyTs = (source) => String(source).replace(/\/\*[\s\S]*?\*\//g, "");

const floatTsx = read("src/components/VoiceCallFloat.tsx");
const hook = read("src/components/VoiceCallFloat/use-voice-call-float-state.tsx");
const stageTsx = read("src/components/VoiceWaveform.tsx");
const stageCss = read("src/styles/18-openai-dialog.css");
const wave = read("src/voice/wave-level.ts");
const noticeTs = read("src/voice/voice-notice.ts");
const devInstr = read("electron/developer-instructions.ts");
const voiceSettings = read("electron/voice/voice-settings.ts");
const bridgeTsx = read("src/features/app-view/helpers/components.tsx");
const appView = read("src/features/app-view/AppView.tsx");

/* ── ① 只留一个通话面 ─────────────────────────────────────────────────── */
ok(!has("src/components/VoiceCallScreen.tsx") && !/VoiceCallScreen/.test(codeOnlyTs(floatTsx)),
  "全屏通话面已删除（组件文件不存在 + 悬浮窗里不再 import/渲染它）");
ok(!/setCallScreen|callScreen/.test(codeOnlyTs(hook)),
  "callScreen 状态已整体删除（不留死状态，否则「接通自动弹全屏」随时会复活）");
ok(/\{expanded && phase !== "active" && \(/.test(floatTsx),
  "右下角语音面板**只在待机**时渲染（通话中唯一的面 = 舞台条；待机面板承担「开始通话/下载模型」入口）");

/* ── ② 舞台条贴输入框居中 ─────────────────────────────────────────────── */
/* ⛔ 判据打的是「这个块里还剩哪些定位属性」，不是注释在不在：
   只允许 `translateX(-50%)`（把 left 当锚点的水平居中偏移），top / left / width 一律交给 JS 写。 */
const stageBlock = (codeOnlyCss(stageCss).match(/\.voice-stage\s*\{[^}]*\}/) || [""])[0];
ok(/transform:\s*translateX\(-50%\)/.test(stageBlock)
  && !/(?<![-\w])left\s*:/.test(stageBlock)
  && !/(?<![-\w])top\s*:/.test(stageBlock)
  && !/(?<![-\w])width\s*:/.test(stageBlock),
  "`.voice-stage` 的 CSS 块里只剩居中偏移 translateX(-50%)，top/left/width 全交给 JS 按 composer 写（旧的「窗口顶部居中」不许并存）");
ok(/closest\("\.composer-wrap"\)/.test(stageTsx) && /el\.style\.left =/.test(stageTsx) && /el\.style\.bottom =/.test(stageTsx) && /el\.style\.width =/.test(stageTsx),
  "舞台按 composer 的实际矩形行内写入 left/bottom/width（贴输入框上方、同宽同中心）");
ok(/ResizeObserver/.test(stageTsx) && /addEventListener\("resize"/.test(stageTsx),
  "窗口缩放与输入区尺寸变化都会重算位置（不许只在挂载时量一次）");

/* ── ③ 「打断」能力没随面板一起丢 ─────────────────────────────────────── */
ok(/export function requestVoiceSkip/.test(wave) && /export function setVoiceSkipHandler/.test(wave),
  "wave-level 里有「打断」的广播通道（与「结束通话」同一套范式）");
ok(/requestVoiceSkip\(\)/.test(stageTsx) && /voice-stage-skip/.test(stageTsx),
  "舞台条上有「打断」按钮（面板通话态撤掉后能力必须在这里）");
ok(/setVoiceSkipHandler\(\(\) => \{ skipCurrent\(\); \}\)/.test(hook),
  "hook 侧把「打断」注册给舞台（skipCurrent = 跳过当前排队的播报）");

/* ── ④ 外放回声剔除（真跑真值表）──────────────────────────────────────── */
const spoken = "好的，我先看一下你的语音设置。当前麦克风是默认设备，回声消除是开着的。";
const echoCases = [
  [true, { heard: spoken, spoken, speaking: true, msSinceSpoken: 0 }],
  [true, { heard: "当前麦克风是默认设备，回声消除是开着的", spoken, speaking: true, msSinceSpoken: 0 }],
  [true, { heard: spoken, spoken, speaking: false, msSinceSpoken: ECHO_TAIL_MS - 200 }],
  [false, { heard: "等一下，先别改设置", spoken, speaking: true, msSinceSpoken: 0 }],
  [false, { heard: spoken, spoken, speaking: false, msSinceSpoken: ECHO_TAIL_MS + 6000 }],
  [false, { heard: "", spoken, speaking: true, msSinceSpoken: 0 }],
];
const wrong = echoCases.filter(([want, input]) => isLikelySelfEcho(input) !== want).length;
ok(wrong === 0, `真跑回声真值表 ${echoCases.length - wrong}/${echoCases.length} 条符合预期（播报中/尾巴窗口内的相似文本判回声，无关文本与窗口外一律放行）`);
ok(echoSimilarity(spoken, "当前麦克风是默认设备，回声消除是开着的") > 0.9
  && echoSimilarity(spoken, "等一下，先别改设置") < 0.3,
  "真跑相似度分得开（回声 ≥0.9 / 无关 <0.3，阈值 0.72 落在中间）");
ok(/isLikelySelfEcho\(\{/.test(hook) && /if \(isLikelySelfEcho\(\{[\s\S]{0,300}?\}\)\) return;/.test(hook),
  "识别 final 处真的调用了回声剔除并直接 return（⛔ 不是只在注释里声称）");
ok(/lastSpokenAtRef/.test(hook) && /prevSpeakingRef/.test(hook),
  "播报「下降沿」被记录（尾巴窗口才有起点；只判 speaking 会漏掉刚播完那句的回灌）");

/* ── ⑤ 麦克风灵敏度（默认 + 迁移）────────────────────────────────────── */
ok(/mic: \{ deviceId: "", noiseSuppression: false, echoCancellation: true, autoGainControl: true \}/.test(voiceSettings),
  "默认开启自动增益（autoGainControl: true）—— 原先 false 是「要很大声才录得进去」的根因");
ok(/VOICE_SETTINGS_VERSION = 3/.test(voiceSettings) && /if \(version < 3\)[\s\S]{0,200}?autoGainControl/.test(voiceSettings),
  "老档案有迁移（只改默认对已存设置的用户无效 —— 必须走版本迁移，照 rule2 那次的同一套判据）");

/* ── ⑥ 语音开/关的状态注入 + 快问快答 ─────────────────────────────────── */
const onTag = /VOICE_CALL_ON_TAG = "([^"]+)"/.exec(noticeTs)?.[1] ?? "";
const offTag = /VOICE_CALL_OFF_TAG = "([^"]+)"/.exec(noticeTs)?.[1] ?? "";
ok(onTag === "【实时语音已开启】" && offTag === "【实时语音已结束】",
  `语音开关的告知标签成对存在（${onTag} / ${offTag}）`);
ok(devInstr.includes(onTag) && devInstr.includes(offTag),
  "引擎侧指令用的是**同两个字面量**（跨文件契约：文案改了这里不改 ⇒ 模型永远认不出这条告知）");
ok(/QUICK-ANSWER MODE/.test(devInstr) && /FIRST sentence/.test(devInstr) && /【实时语音已结束】[^]*?lifted/.test(devInstr),
  "指令写明「快问快答」：第一句就是结论、之后再给推理，且挂断后撤销");
ok(/requestVoiceCallNotice\(true, threadId \|\| ""\)/.test(hook) && /requestVoiceCallNotice\(false, threadId \|\| ""\)/.test(hook),
  "通话开始/挂断各发一次状态告知（挂断那次用**先取后复位**的 wasConversation，否则判据恒真 = 假绿）");
ok(/export function setVoiceCallNoticeHandler/.test(wave) && /voiceCallNoticeText\(active\)/.test(bridgeTsx),
  "告知经 wave-level 广播 + 桥翻文案（文案只在 voice-notice.ts 生成，桥不自己拼）");
ok(/thread\?\.id !== threadId/.test(appView) && /pendingCommandTextRef\.current = text/.test(appView),
  "发告知前有**会话闸**（通话绑定会话，切走之后到达的告知必须丢弃，与调度告知同款）");

console.log(`\n【voice-call】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
