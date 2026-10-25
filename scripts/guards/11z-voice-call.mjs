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
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./_ctx.mjs";
import { isLikelySelfEcho, echoSimilarity, ECHO_TAIL_MS } from "../../src/lib/voice-echo.mjs";
import { splitSentences } from "../../src/lib/voice-summary.mjs";
import { AUTO_TOOL_CALL_LIMIT, REWORK_REPEAT_LIMIT, createAutoSpeakTracker, isWorkItem } from "../../src/lib/voice-auto-speak.mjs";
import { extractVoiceScript, stripVoiceScript, createVoiceScriptStripper, resolveAnnounceSummary, spokenDedupeKey, dedupeSpokenSentences, VOICE_FENCE_LANG } from "../../src/lib/voice-script.mjs";

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
const voiceService = read("electron/voice/voice-service.ts");
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
ok(/VOICE_SETTINGS_VERSION = \d+/.test(voiceSettings) && /if \(version < 3\)[\s\S]{0,200}?autoGainControl/.test(voiceSettings),
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

/* ── ⑦ 语音播报：实时正文 + 结束汇总（10-08 用户新增需求，两个独立开关）────────── */
const announceCard = read("src/components/VoiceSettingsSection/10-announce.tsx");
const announceHook = read("src/features/voice-announce/use-voice-announce.ts");
const announceBridge = read("src/features/voice-announce/VoiceAnnounceBridge.tsx");
const bus = read("src/voice/announce-bus.ts");
const engineBridge = read("src/features/voice-announce/engine-bridge.ts");
const seg05 = read("src/features/app-state/parts/part05/01-seg.tsx");
const appViewSrc = read("src/features/app-view/AppView.tsx");

ok(/announce: \{ enabled: true \}/.test(voiceSettings),
  "默认值：`announce.enabled = true`（与旧结构 live 的默认一致 —— 播报默认开着）");
ok(/announce: \{ enabled: announceEnabled \}/.test(voiceSettings) && /announceRaw\?\.live !== false \|\| announceRaw\?\.summary === true/.test(voiceSettings),
  "mergeSettings **显式映射** announce.enabled，且把旧档案的 {live, summary} 平移过来（漏映射 = 用户改了不生效且不报错 —— 本文件已 N 次同款）");
ok(/VOICE_SETTINGS_VERSION = 7/.test(voiceSettings) && /if \(version < 4\)/.test(voiceSettings) && /if \(version < 5\)/.test(voiceSettings) && /if \(version < 6\)/.test(voiceSettings)
  && /if \(version < 7\)/.test(voiceSettings) && /source\.announce = \{ enabled: true \}/.test(voiceSettings),
  "版本 3 → 4（两个开关收成一个）→ 5（语速）→ 6（音质档）→ 7（总开关历史 false 一次性打开）且**各带迁移**");
/* ⛔ 10-21 用户令「语音播报速度默认改成 1.25×」：常量与迁移必须同轮落地（只改常量对老用户无效，
   只写迁移不改常量对新用户无效 —— 两边缺一都等于这次默认值改动没生效）。 */
/* ⛔ 默认值块中间夹着长注释（解释 2 步为什么发沙），夹取窗口给足 1200 字符；
   只锚「同一个 tts 对象里先 speed 后 numSteps」这个结构，不锚注释内容。 */
ok(/tts: \{[\s\S]{0,1200}?speed: 1\.25[\s\S]{0,1200}?numSteps: 4/.test(voiceSettings),
  "默认值：`tts.speed = 1.25` + `tts.numSteps = 4`（语音播报与通话共用这一份 —— 单一真相源）");
ok(/if \(version < 5\)[\s\S]{0,600}?Math\.abs\(speed - 1\.0\) < 1e-9[\s\S]{0,400}?DEFAULT_VOICE_SETTINGS\.tts\.speed/.test(voiceSettings),
  "v4 → v5 迁移：**值等于旧默认 1.0（或缺失）**才迁到 1.25，用户显式调过的档位不动");
/* ⛔ 10-24 用户报「播报声音太沙哑，听不清」：根因是播报端把步数写死 2（换延迟）。
   修复必须**同时**满足三条，缺一条就等于没修：
     ① 播报取设置值（不再是常量）；
     ② speak（通话/试听复用）把 numSteps 下发到 worker；
     ③ 设置页有可选的音质档（否则用户只能吃默认）。 */
ok(/numSteps: cfgRef\.current\.numSteps/.test(announceHook) && !/numSteps: ANNOUNCE_NUM_STEPS\b\)/.test(announceHook),
  "播报的合成步数取设置（`cfgRef.current.numSteps`），不再写死常量 —— 写死 = 用户选了「清晰」也没用");
ok(/numSteps: options\?\.numSteps \?\? this\.currentSettings\.tts\.numSteps/.test(voiceService),
  "speak 把 numSteps 下发到 worker（漏下发 = worker 用默认 4，设置里的档位形同虚设）");
ok(/tts: \{ \.\.\.settings\.tts, numSteps: Number\(v\) \}/.test(announceCard),
  "设置页「播报音质」三档可选（写回 tts.numSteps，与播报/通话/试听共用）");
ok(/checked=\{enabled\}/.test(announceCard) && /apply\(\{ announce: \{ enabled: e\.target\.checked \} \}\)/.test(announceCard)
  && (announceCard.match(/type="checkbox"/g) || []).length === 1,
  "设置页「语音播报」卡片上**只有一个**总开关（正文实时 / 汇总两个旧开关已删）");
ok(/if \(announceRef\.current\.enabled\) void speakDelta\(piece\)/.test(hook),
  "通话的正文朗读受总开关门控（关掉 ⇒ 只出字幕不出声）");
ok(/await flushSpeech\(\);[\s\S]{0,120}?await speakScript\(finalText\)/.test(hook),
  "结束播报**在尾句念完之后**才念（两者共用播放队列，并发入队会把播报稿插进半句中间）");
ok(/const tail = scriptStripperRef\.current\?\.flush\(\) \?\? ""/.test(hook)
  && hook.indexOf("scriptStripperRef.current?.flush()") < hook.indexOf("await flushSpeech()"),
  "通话里先**定下剥离器按住的那半行**再 flush 断句器（否则尾句永远丢，且顺序反了会把尾巴当下一轮首句）");
/* ⛔ 顺序判据必须**先确认两个锚都在**：`indexOf` 找不到时返回 -1，`-1 < x` 恒真 ——
   变异测试实测过这个假绿形态（把剥离那一行删掉，顺序断言照样绿）。 */
const stripPushIdx = hook.indexOf("scriptStripperRef.current.push(String(delta");
const chunkPushIdx = hook.indexOf("chunkerRef.current.push(visible)");
ok(/if \(!scriptStripperRef\.current\) scriptStripperRef\.current = createVoiceScriptStripper\(\)/.test(hook)
  && stripPushIdx > 0 && chunkPushIdx > 0 && stripPushIdx < chunkPushIdx,
  "通话里**先剥离播报稿再断句**（反过来的话半截围栏已经进了断句器，剥不掉 ⇒ 用户听到「反引号反引号」）");
ok(/const a = event\.settings\?\.announce/.test(hook) && /const a: any = raw\.announce \?\? \{\}/.test(announceHook),
  "设置页改开关后经 voice:event 广播即时生效（不必重开通话；两侧都兼容旧形状 {live, summary}）");
ok(/export function publishAnnounceEvent/.test(bus) && /export function subscribeAnnounce/.test(bus)
  && !/summarizeForSpeech|chunker/.test(bus),
  "基座总线只做转发（开关判定/断句/合成全在播报域里，别把逻辑塞进基座）");
/* 10-09 第五轮：正文 delta **回来了** —— 但这次是**受控**的：只有 Codex 用 `voice_speak_reply`
   标记过本回合，delta 才真的被念。判据要同时钉住「通道在」与「开关在」（不然就又变回"每条都念"）。 */
ok(/type: "delta"/.test(bus) && /item\/agentMessage\/delta/.test(engineBridge)
  && /publishAnnounceEvent\(\{ type: "delta", threadId, text \}\)/.test(engineBridge),
  "总线与转发器恢复 delta（正文朗读由 Codex 逐条决定 ⇒ 它有了受控消费者，不再是死契约）");
ok(/source: "" \| "live" \| "summary" \| "tool"/.test(bus),
  "状态来源含 `live`（Codex 决定念的正文）/ `summary`（结束播报稿）/ `tool`（插播）");
ok(/live: "念正文"/.test(read("src/features/voice-announce/VoiceAnnounceIndicator.tsx"))
  && /summary: "播报"/.test(read("src/features/voice-announce/VoiceAnnounceIndicator.tsx"))
  && /tool: "插播"/.test(read("src/features/voice-announce/VoiceAnnounceIndicator.tsx"))
  && /SOURCE_LABEL\[status\.source \?\? ""\] \?\? "语音播报中"/.test(read("src/features/voice-announce/VoiceAnnounceIndicator.tsx")),
  "状态条文案**三种来源都覆盖**（少了哪个用户就不知道在念什么）——⛔ 钉的是 SOURCE_LABEL 的键与\n"
  + "     兜底文案，不是「正在念正文」这几个字（10-12 视觉整改把它们缩成了「念正文/播报/插播」：\n"
  + "     前面已有呼吸圆点 + 喇叭图标表示「正在」，「正在」三字是重复信息）");
const pubIdx = seg05.indexOf("publishEngineAnnounce(event.method");
const streamIdx = seg05.indexOf("if (threadStreamMethods.has(method))");
ok(pubIdx > 0 && streamIdx > 0 && pubIdx < streamIdx,
  "事件源接缝落在 threadStreamMethods 分支**之前**（那个分支会把 item/agentMessage/delta 直接 return 掉 ⇒ 放后面等于播报永不触发）");
ok(/if \(!announceListenerCount\(\)\) return;/.test(engineBridge),
  "没人订阅时在流式热路径上零成本短路（每个 delta 都会走到这里）");
ok(/&& \(!current \|\| threadId !== current\)/.test(engineBridge) || /threadId !== current/.test(engineBridge),
  "只转发**当前会话**的事件（后台会话 / 被调度子会话的输出不该被念出来）");
ok(/aborted: status === "interrupted" \|\| status === "failed"/.test(engineBridge),
  "被打断的回合标成 aborted（与主进程 voice-service 同一口径：看 turn.status，不是看有没有 items）");
/* ⛔⛔ 通话避让（用户 10-09 特意提醒「注意甄别实时语音通话哦，别两个重复播报了」）：
   非通话播报的三条入口（正文 delta / 插播 toolSpeak / 回合结束 turnDone）**共用一处**避让，
   而且必须是订阅回调的**第一条语句** —— 放到某条分支里，就会出现"新加的那条入口忘了避让"
   （两个播报器同时念：通话链路念一份、独立播报再念一份）。
   ⛔ 用切片断言顺序：全文件 `indexOf` 会被别的 effect 里的同名语句骗到（本仓踩过）。 */
const announceSubscriber = announceHook.slice(
  announceHook.indexOf("const off = subscribeAnnounce((event) => {"),
  announceHook.indexOf("window.codex.onHarnessEvent("),
);
const stageIdx = announceSubscriber.indexOf("if (getVoiceStage().active) return;");
ok(stageIdx > 0
  && stageIdx < announceSubscriber.indexOf('event.type === "delta"')
  && stageIdx < announceSubscriber.indexOf('event.type === "toolSpeak"')
  && stageIdx < announceSubscriber.indexOf('event.type === "turnDone"'),
  "通话避让是订阅回调的**第一条语句**（delta / toolSpeak / turnDone 三条入口全排在它后面 —— 谁也绕不过）");
ok((announceSubscriber.match(/getVoiceStage\(\)\.active/g) || []).length === 1,
  "避让**只判一处**（单一裁决点；每条分支各判一次就是本仓记过的「二房东」缺陷：改一边漏一边）");
ok((read("electron/features/dispatch-rpc.ts").match(/if \(status\?\.active\) \{/g) || []).length >= 2,
  "两个播报工具（插播 / 念正文）在通话中**都拒绝**（各自一处 —— 漏一个就得多一个避让点）");
/* ⛔ 钉的是「RenderTree 里只出现一次」而不是某个字面量 —— 10-09 加了 threadId prop（会话闸），
   锚字符串一旦写死就变成"改个 prop 就假红"，这是本仓记过的锚点写法禁区。 */
ok((appViewSrc.match(/<VoiceAnnounceBridge\b/g) || []).length === 1
  && !/<VoiceAnnounceBridge\b/.test(announceBridge),
  "挂载件整个应用只挂一次（挂两次会念两遍 —— 它订阅的是模块级总线）");
/* 运行期安全三条：非通话播报「只管说不管听」，没有这三条它就成了停不下来的复读机 */
ok(/export function setAnnounceStopHandler/.test(bus) && /export function requestAnnounceStop/.test(bus)
  && /setAnnounceStopHandler\(\(target\) => \{ if \(!target \|\| target === threadId\) stopPlayback\(true\); \}\)/.test(announceHook)
  && /requestAnnounceStop\(threadId\)/.test(floatTsx) && /停止播报/.test(floatTsx)
  && /requestAnnounceStop\(\)/.test(read("src/features/voice-announce/VoiceAnnounceIndicator.tsx")),
  "有两条「停止播报」出口（悬浮球右键菜单 + 播报状态条按钮 → 基座广播 → 播报域执行；基座不反向依赖域）——"
  + "悬浮球按会话传 threadId，状态条作用于当前会话");
ok(/queueRef\.current\.length >= MAX_ANNOUNCE_BACKLOG/.test(announceHook),
  "播放队列封顶（超了就丢弃这一句保持跟手，而不是念几分钟前的内容）");
/* ⛔ 10-21 新增第二道背压：正文默认播之后，**待合成**任务才是积压的真源头（合成串行、每段 2~5s，
   正文流出远快于它）。只判播放队列 ⇒ 链上堆几十段 ⇒ 听到的是几分钟前的话（另一种「听不到」）。 */
ok(/pendingTasksRef\.current \+ queueRef\.current\.length >= MAX_ANNOUNCE_BACKLOG/.test(announceHook)
  && announceHook.indexOf("pendingTasksRef.current + queueRef.current.length") < announceHook.indexOf("enqueueTask(() => feedDelta(event.text))"),
  "⛔ 积压闸在**入链之前**：待合成段数 + 待播段数超上限就丢这一段（念的必须是「现在」的内容）");
ok(/pendingTasksRef\.current \+= 1;/.test(announceHook) && /pendingTasksRef\.current = Math\.max\(0, pendingTasksRef\.current - 1\)/.test(announceHook)
  && /pendingTasksRef\.current = 0;/.test(announceHook),
  "待合成计数在入链 +1 / 完成 -1，停止或打断时清零（不清 ⇒ 恢复播报后积压闸一直挡着，表现「恢复了还是不念」）");
ok(/if \(scope === "live" && !cfgRef\.current\.enabled\) return;/.test(announceHook),
  "⛔ 总开关也拦**正文链**（回合中途关掉播报时，断句器尾句/已入链任务绕不过这一处 ⇒ 不会「关了还在念」）");
ok(/subscribeVoiceStage\(\(stage\) => \{ if \(stage\.active\) stopPlayback\(\); \}\)/.test(announceHook),
  "通话一开始就停掉独立播报（否则通话播报与排队音频同时出声）");

/* ── ⑦b 同回合播报去重（10-09 用户报「同一段音频连续播放两次」）──────────────────
   根因（第一轮判定）：同一段内容有三条互不知情的入口（voice_announce 工具 / 正文实时 / 结束稿）。
   ⛔ 第二轮修正（用户 + Codex 自查）：**文案层是病根** —— 工具返回值与指令都要求模型
      「怕听不到就把这句话写进正文」，模型照办 ⇒ 自己给自己叠一遍。
      两处一起治：文案不再要求复述（见上方 ⑯ 契约组），执行端仍然按**句子级**查重兜底。 */
const hookCode = codeOnlyTs(announceHook);
const keyDecl = announceHook.indexOf("const deduped = dedupeSpokenSentences(clean, spokenKeysRef.current)");
const busyIdx = announceHook.indexOf("busyRef.current += 1");
const skipIdx = announceHook.indexOf("if (!deduped.text)");
const keyAdd = announceHook.indexOf("spokenKeysRef.current.add(key)");
const okIdx = announceHook.indexOf("result?.ok");
ok(/import \{[^}]*dedupeSpokenSentences[^}]*\} from "\.\.\/\.\.\/lib\/voice-script\.mjs"/.test(announceHook)
  && keyDecl > 0,
  "speak() **逐句**查重（三条播报入口的唯一汇合处）。⛔ 整段比键会漏判：正文逐句喂、工具与结束稿整段喂，粒度不同 ⇒ 同一句念三遍");
ok(skipIdx > 0 && keyDecl > 0 && skipIdx > keyDecl && skipIdx < busyIdx,
  "查重在合成（busy +1）**之前**——命中重复直接跳过，连合成费都不付");
ok(keyAdd > 0 && okIdx > 0 && keyAdd > okIdx
  && /for \(const key of deduped\.keys\) spokenKeysRef\.current\.add\(key\)/.test(announceHook),
  "登记在「确认会出声」**之后**、且登记**这一批每个句子的键**——合成失败不登记，后到的兜底句才不会被误吞");
ok(/const chunks = chunkAnnounceText\(deduped\.text, ANNOUNCE_CHUNK_MAX_CHARS\)/.test(announceHook)
  && /voicePreviewVoice\(\{ text: chunk/.test(announceHook),
  "合成用的是**去重后**的文本（先按去重结果切段、再逐段合成；拿原始 clean = 查重白做）");
ok(/const resetTurnBudget = useCallback/.test(announceHook)
  && (announceHook.match(/resetTurnBudget\(\)/g) || []).length >= 2
  && /finishTurn\(event\.text\)\.finally\(resetTurnBudget\)/.test(announceHook),
  "去重登记表与字数预算**回合级清零**（正常收尾 `.finally(resetTurnBudget)` / 被打断时同步清 /\n"
  + "     没开开关时也要清）——⛔ 跨回合「再说一遍」必须照念，预算也不能跨回合累加（否则第二轮必然沉默）");
ok(/const filter = createSpeakFilter\(\);\s*\n\s*const spoken = String\(filter\.push\(String\(text \?\? ""\)\) \?\? ""\)\.trim\(\);/.test(announceHook)
  && /await speak\(spoken, epoch, \{ speed, scope: "tool" \}\);/.test(announceHook),
  "工具插播文本过**同一套**朗读清洗（正文过滤后是「三个」、工具原文是「3」就永远对不上键；顺带 markdown 记号不再被当字念），并走 `scope: \"tool\"`（不占正文预算）");
/* 去重键真值表：**真跑** import 纯函数（「注释声称有」在本仓是最危险的假象） */
const keyCases = [
  ["已修复 3 个问题。", "已修复3个问题！", true, "标点/空白差异必须算同一段"],
  ["Done.", "done", true, "大小写不敏感"],
  ["你好，世界。", "你好世界", true, "键里就是纯字母数字（含 CJK）"],
  ["你好世界", "你好世界二", false, "不同内容不许误伤（键必须能区分）"],
  ["", "", true, "空文本键为空"],
];
const keyWrong = keyCases.filter(([a, b, same]) => (spokenDedupeKey(a) === spokenDedupeKey(b)) !== same);
ok(keyWrong.length === 0 && spokenDedupeKey(null) === "" && spokenDedupeKey(undefined) === "",
  `去重键真值表 ${keyCases.length - keyWrong.length}/${keyCases.length} 条符合预期${keyWrong.length ? `（错在：${keyWrong.map((c) => c[3]).join("；")}）` : ""}，null/undefined 安全`);
/* 句子级去重真值表：**真跑** —— 三条入口切分粒度不同是本 bug 的根因，必须按「整段先念 / 再逐句喂」的顺序验 */
const seenKeys = new Set();
const dTool = dedupeSpokenSentences("都改完了。可以验收了。", seenKeys);   // 工具：整段喂
for (const k of dTool.keys) seenKeys.add(k);
const dLive1 = dedupeSpokenSentences("都改完了。", seenKeys);              // 正文：逐句喂
const dLive2 = dedupeSpokenSentences("可以验收了。", seenKeys);
const dSum = dedupeSpokenSentences("都改完了。可以验收了。辛苦了。", seenKeys); // 结束稿：整段（含新句）
ok(dTool.text === "都改完了。可以验收了。" && dLive1.text === "" && dLive2.text === ""
  && dSum.text === "辛苦了。" && dSum.keys.length === 1,
  "真跑句子级去重：整段先念后，逐句喂与整段再喂都只剩新句（「重复播放好几次」的根因就在这里）");
ok(dedupeSpokenSentences("第一个问题已修复。第一个问题已修复。", new Set()).keys.length === 1,
  "同一次调用内部也去重（同段里重复的句子只念一次）");
ok(dedupeSpokenSentences("你好世界。", new Set(["你好世界"])).text === "",
  "同回合已念过的句子单独再喂也拦得住（键对齐与整段/逐句无关）");
ok(dedupeSpokenSentences("", new Set()).text === "" && dedupeSpokenSentences(null, new Set()).keys.length === 0,
  "空 / null 安全（返回空文本、零键，不抛）");

/* 汇总播报的**本机压缩**已整条删除（10-09 第二轮用户令「汇总正文不用播报了」）——
   这里改成**负向**断言：压缩器与它的常量都不许回来（回来就意味着又在念"汇总正文"）。 */
const summaryLib = read("src/lib/voice-summary.mjs");
const summaryDts = read("src/lib/voice-summary.d.mts");
ok(!/summarizeForSpeech/.test(codeOnlyTs(summaryLib)) && !/summarizeForSpeech/.test(summaryDts)
  && !/SUMMARY_(PREFIX|MAX_CHARS|EMPTY_NOTICE)/.test(summaryLib + summaryDts),
  "⛔ 本机压缩汇总（summarizeForSpeech / SUMMARY_*）已整条删除且不许复活 —— 它就是用户说的「汇总正文」");
ok(/export function splitSentences/.test(summaryLib) && splitSentences("一。二！三？四").length === 4
  && splitSentences("版本 3.5 已发布。").length === 1,
  "句级切分保留（播报去重靠它按句对齐）；按中英句末标点切，且**不切小数点**");
/* `resolveAnnounceSummary` = 唯一裁决点：**只认模型写的播报稿**，没写就是空（不再有 fallback 分支） */
const sc = resolveAnnounceSummary("先说一句。\n\n```voice\n改完了，能跑。\n```");
const scNone = resolveAnnounceSummary("这段回复里没有任何播报稿。");
const scCodeOnly = resolveAnnounceSummary("```\nconsole.log(1)\n```");
ok(sc.text === "改完了，能跑。" && sc.present === true && scNone.text === "" && scNone.present === false,
  "真跑裁决点：有播报稿就只念那块；没写稿 ⇒ 空（**不回退**到本机压缩摘要）");
ok(scCodeOnly.text === "" && resolveAnnounceSummary("").text === "" && resolveAnnounceSummary(null).text === "",
  "真跑裁决点：只有代码块 / 空串 / null 都返回空且不抛（调用方什么都不念）");
ok(!/source: "script"|source: "fallback"|\.sentences === 0/.test(codeOnlyTs(announceHook)),
  "⛔ 调用端不再有 script/fallback 分支与「整段是代码」的兜底文案（那些都是被删掉的汇总播报残留）");

/* ── ⑧ 音色上传接口（预留）+ 使用教程 ────────────────────────────────── */
const ipcManifest = JSON.parse(read("electron/ipc-channels.manifest.json"));
const uploadCh = ipcManifest.channels.find((c) => c.channel === "voice:profile-upload");
ok(Boolean(uploadCh) && uploadCh.name === "voiceProfileUpload" && uploadCh.invokeArgs === "input",
  "IPC manifest 登记 voice:profile-upload 且 invokeArgs=input（⛔ 漏它 = preload 层静默丢参，本仓已两次）");
const voiceProfilesSeg = read("electron/features/voice-ipc/02-voice-profiles-presets.ts");
ok(/ipcHost\.handle\("voice:profile-upload"/.test(voiceProfilesSeg)
  && /source === "pack"[\s\S]{0,160}?暂未开放/.test(voiceProfilesSeg),
  "handler 存在；pack（音色包）是**明确预留**（返回「暂未开放」而不是静默失败）");
ok(/draftProfileAudio\(/.test(voiceProfilesSeg.slice(voiceProfilesSeg.indexOf('"voice:profile-upload"')))
  && /draftProfileAudio\(/.test(voiceProfilesSeg.slice(0, voiceProfilesSeg.indexOf('"voice:profile-upload"'))),
  "上传与导入共用同一条草稿链（落盘 → ASR 转写参考文本 → 用户校对），不另写一套");
ok(/voiceProfileUpload: \(input\?/.test(read("electron/preload.ts")) && /voiceProfileUpload\(input\?/.test(read("src/vite-env.d.ts")),
  "生成物两侧都有 voiceProfileUpload（preload 内联段 + d.ts 生成段；跑过 gen:ipc，不是只改了 manifest）");
const registrySrc = read("electron/ipc-registry.ts");
/* count 是**事实账**：voice 域实列多少条就写多少（10-21 +2 = announce-owner / announce-set-muted）。 */
/* ⛔ count 是**写死的数字**：加了 voice 域的通道必须同步改这里（否则守卫红）。
   10-26 加了 2 条引擎包下载通道（tts-pack-install / tts-pack-cancel）⇒ 44 → 46。 */
ok(/\{ prefix: "voice", count: 46/.test(registrySrc) && /"voice:profile-upload"/.test(registrySrc),
  "ipc-registry 的 voice 域计到 46 且列出新通道（不同步会被【107】/【90】报红）");
const settingsState = read("src/components/VoiceSettingsSection/use-voice-settings-section-state.tsx");
ok(/voiceProfileUpload\(\{ source: "file" \}\)/.test(settingsState)
  && /uploadProfile=\{uploadProfile\}/.test(read("src/components/VoiceSettingsSection.tsx")),
  "「上传音色」按钮真的接上了 IPC（不是只画了个按钮）");
ok(/<details className="voice-profile-guide">/.test(read("src/components/VoiceSettingsSection/02-voice-clone-profile.tsx"))
  && /上传 \/ 克隆自己的音色/.test(read("src/components/HelpDialog.tsx")),
  "使用教程两处落点：卡片内可折叠步骤 + 帮助弹窗 voice 段（正文各写一份，不互相复制粘贴）");

/* ── ⑨ 语音模型 / 音色克隆模型迁移到「语音通话」页 ─────────────────────── */
const devtoolsPage = read("src/features/settings-devtools/DevtoolsSettingsSection.tsx");
ok(/<VoiceDevToolsSection onNotice=\{onNotice\} \/>/.test(read("src/components/VoiceSettingsSection.tsx")),
  "语音模型 / 音色克隆模型的卡片渲染在「语音通话」页（用户要求迁移到语音相关的那一页）");
ok(!/<VoiceDevToolsSection/.test(codeOnlyTs(devtoolsPage)),
  "开发工具页**不再渲染**它（是迁移不是复制 —— 同一份状态两处渲染 = 双真相源）");
ok(!/VoiceDevToolsSection/.test(read("src/features/app-view/AppView/08-settings-sheet/01-settings-layout/00-settings-registry.tsx")),
  "settings-registry 里那条 prop 传递也清掉了（死 prop 只会骗下一个读它的人）");
ok(/设置 → 语音通话/.test(devtoolsPage),
  "开发工具页留了一句指路（按老习惯找不到时不至于迷路）");

/* ── ⑩ 音色克隆模型「下载失败却显示已安装」（用户实测的那个 bug）────────── */
const store = read("electron/voice/model-store.ts");
const manifestSrc = read("electron/voice/model-manifest.ts");
ok(/`\$\{destPath\}\.part`/.test(store) && /await rename\(workPath, destPath\)/.test(store)
  && /await readFile\(workPath\)/.test(store) && /existsSync\(workPath\) \? statSync\(workPath\)\.size/.test(store),
  "归档型下载改成**原子写**：半截在 .part、校验过了才 rename 到最终路径（残file 不再落进模型目录）");
ok((store.match(/extractArchiveInto\(/g) || []).length >= 3,
  "解压走 staging（解到 .staging-* 再整体落位，失败清干净）—— zipvoice 与 kws 两条装解链路都用了");
ok(/readyFileMinBytes/.test(manifestSrc) && /minBytes: 51_400_000/.test(manifestSrc)
  && /实测完整 124,657,100/.test(manifestSrc),
  "关键文件带最小体积判据（下限按**本机实测**的完整体积定，不是拍脑袋）");
ok(/>= \(minOf\[name\] \?\? 1\)/.test(manifestSrc) && /vocoder\.minBytes/.test(manifestSrc),
  "zipvoiceReady 判「文件在 **且够大**」（根因就是旧版只看 size > 0）");
ok(/if \(!zipvoiceReady\(modelsRoot\)\)/.test(store),
  "装完**回读**一次就绪判定（下载器说成功 ≠ 模型能用；反向也不许错）");

/* 真跑就绪判定（编译产物；check 链先 build 再跑守卫，缺产物直接红、不静默跳过） */
const PROBE_ZV = `
const fs = require("node:fs"); const os = require("node:os"); const path = require("node:path");
const ROOT = ${JSON.stringify(ROOT)};
let out = { fatal: "" };
try {
  const m = require(path.join(ROOT, "dist-electron", "voice", "model-manifest.js"));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zv-guard-"));
  const dir = path.join(tmp, m.ZIPVOICE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const mins = m.ZIPVOICE_ARCHIVE.readyFileMinBytes;
  const mk = (name, size) => { const p = path.join(dir, name); fs.writeFileSync(p, ""); fs.truncateSync(p, size); };
  for (const [name, size] of Object.entries(mins)) mk(name, size);
  mk(m.ZIPVOICE_ARCHIVE.vocoder.name, 1000);
  const halfVocoder = m.zipvoiceReady(tmp);
  mk(m.ZIPVOICE_ARCHIVE.vocoder.name, m.ZIPVOICE_ARCHIVE.vocoder.minBytes);
  mk("decoder.int8.onnx", 1024);
  const truncatedDecoder = m.zipvoiceReady(tmp);
  for (const [name, size] of Object.entries(mins)) mk(name, size);
  const allGood = m.zipvoiceReady(tmp);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "zv-empty-"));
  const none = m.zipvoiceReady(scratch);
  const real = path.join(process.env.APPDATA || "", "Codex Harness Desktop", "voice-models");
  const realReady = fs.existsSync(path.join(real, m.ZIPVOICE_DIR)) ? m.zipvoiceReady(real) : null;
  fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(scratch, { recursive: true, force: true });
  out = { halfVocoder, truncatedDecoder, allGood, none, realReady };
} catch (error) { out = { fatal: String((error && error.message) || error).slice(0, 200) }; }
console.log("DATA " + JSON.stringify(out));
process.exit(0);
`;
let zvRaw = "";
try {
  zvRaw = execFileSync(process.execPath, ["--input-type=commonjs", "-e", PROBE_ZV], {
    cwd: ROOT, encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"],
  });
} catch (error) {
  zvRaw = `${error?.stdout ?? ""}${error?.stderr ?? ""}`;
  if (!zvRaw) console.log(`     就绪判定探针没输出：${String(error?.message ?? error).slice(0, 200)}`);
}
const zvLine = zvRaw.split("\n").find((l) => l.trim().startsWith("DATA "));
let zv = null;
if (zvLine) { try { zv = JSON.parse(zvLine.trim().slice(5)); } catch { zv = null; } }

ok(Boolean(zv) && !zv?.fatal, `真跑就绪判定拿到结果（${zv?.fatal || "ok"}）`);
ok(zv?.halfVocoder === false,
  "真跑：声码器只下了一半 ⇒ **未安装**（用户实测 bug 的正面复现：它以前显示「已安装」）");
ok(zv?.truncatedDecoder === false, "真跑：主包文件被截断 ⇒ 未安装（体积下限真的在起作用）");
ok(zv?.allGood === true && zv?.none === false, "真跑：文件齐备 ⇒ 已安装；目录不存在 ⇒ 未安装");
ok(zv?.realReady !== false,
  "真跑：本机已装好的那套仍判已安装（加固判定不许制造假阴性 —— 那是更贵的错）");

/* ── ⑪ 自我 code review 抓出并修掉的 5 处（把判据留下，防止下次又写回去）──────────
   ⛔ 本组来自对 c75ab5f 的**自审**（dongming-code-review 技能六步闭环），
      不是新功能 —— 每条都是「当时写错、已修」的东西，所以判据要钉住修好的形态。 */
ok(/const chainRef = useRef<Promise<void>>\(Promise\.resolve\(\)\)/.test(announceHook)
  && /enqueueTask\(\(\) => speakNow\(event\.text, event\.speed\)\)/.test(announceHook)
  && /enqueueTask\(\(\) => finishTurn\(event\.text\)\.finally\(resetTurnBudget\)\)/.test(announceHook),
  "播报动作挂**串行链**：合成是异步的、多条入口会并发到达 ⇒ 不串行会念乱顺序（A 慢 B 快则 B 先出声）");
ok(!/summary\.sentences === 0|SUMMARY_EMPTY_NOTICE/.test(codeOnlyTs(announceHook)),
  "⛔ 「整段是代码就看屏幕」那句兜底文案已随汇总播报一起删除（现在没稿就不念，不补任何提示）");
ok(/response\.status === 416[\s\S]{0,420}?await rename\(workPath, destPath\)/.test(store),
  "downloadOnce 处理 416：`.part` 已完整（上次 rename 失败）时校验后提拔成最终文件（否则那份完整文件永远卡住）");
ok(/if \(sha256 && \(await fileShaOrEmpty\(workPath\)\) === sha256\)/.test(store),
  "416 分支的先决条件是 sha256 非空（空 sha 时缺文件也返回空串 ⇒ 会假成功）");
ok(/const staging = join\(modelsRoot, `\.staging-\$\{targetName\}`\)/.test(store)
  && !/\.staging-\$\{targetName\}-\$\{Date\.now/.test(store),
  "暂存目录名**确定性**（每次尝试开头就地清掉 ⇒ 崩溃残留不累积、也不被算进模型体积）");
ok(/const announce: any = settings\.announce \?\? \{ enabled: true \}/.test(announceCard)
  && /typeof announce\.enabled === "boolean"/.test(announceCard),
  "设置卡片对 announce 做兜底（老主进程回包缺字段/还是旧形状时不许把整页打成白屏，也不许显示成「关着」）");

/* ── ⑫ 播报稿：内容由 Codex 自己写（10-09 用户：「语气过于平淡」的解药）──────
   契约（`​`voice`​ 围栏）横跨 4 个文件：引擎指令（写什么）/ `voice-script.mjs`（怎么认）/
   播报 hook（念什么、跳什么）/ Markdown（屏幕上留什么）。任何一处漂移都表现为
   "功能还在但内容永远是机器味" —— 那种坏法最贵，所以它必须进预检。 */
const scriptLib = read("src/lib/voice-script.mjs");
const markdownTsx = read("src/features/markdown/Markdown.tsx");
const indicatorTsx = read("src/features/voice-announce/VoiceAnnounceIndicator.tsx");
const composerTsx = read("src/features/app-view/AppView/02-main-stage/03-composer.tsx");
const devInstr16 = /16\) VOICE ANNOUNCEMENT/.test(devInstr);
/* ⛔ TS 源里的三个反引号是被**转义**过的（六个字符长的 `\` + `` ` `` 组成的串），
   所以不能拿字面 ```voice 去比 —— 那样恒假、会让这条断言变成"永远不红"的假借此_shape。 */
const fenceInDevInstr = /(\\`){3}voice/.test(devInstr);
ok(devInstr16 && fenceInDevInstr && /VOICE_FENCE_LANG = "voice"/.test(scriptLib),
  `引擎指令第 16 条写明了 voice 围栏契约，且与解析器的 VOICE_FENCE_LANG 同一个词（${VOICE_FENCE_LANG}）`);
/* ── 播报内容契约（10-09 第二轮）：挑重点 + **反自我复述** ──────────────────────
   用户定性（Codex 自查）：summary 开着时模型还硬把原句复述进正文（照搬工具提示「怕你听不到就写清楚」）
   = 自己给自己叠一遍；且「播报要 Codex 挑重点，不是长篇大论」。
   ⇒ 工具返回值 / 第 16 条 / 生成器三处文案同轮改掉，这里钉死**两个方向**（该说的说了、不该说的没了）。 */
const rpcSrcForContract = read("electron/features/dispatch-rpc.ts");
const genSkillSrc = read("scripts/gen-capability-skill.mjs");
ok(/CARRY THIS TURN'S IMPORTANT CONTENT/.test(devInstr) && /contentless/.test(devInstr)
  && /~50 Chinese characters is the sweet spot/.test(devInstr),
  "第 16 条要求播报稿装**本轮重要内容**（结果/关键数字/风险），并点名两种失败形态：逐句复述、只有「好了」");
ok(/160-character budget shared by everything spoken this turn/.test(devInstr)
  && /10-12 the user said/.test(devInstr)
  && /VOICE_SCRIPT_MAX_CHARS = 120/.test(scriptLib) && /VOICE_SCRIPT_HARD_CAP = 220/.test(scriptLib),
  "⛔ 10-12「不用这么长」三处同步收紧：指令口径（~50 字 + 每回合 160 字预算）、\n"
  + "     解析层上限（120 / 硬顶 220）—— 只改一处会出现「模型写短了但硬顶还放行一大段」或反之");
ok(!/PICK ONE POINT/.test(devInstr) && !/under ~50 Chinese characters/.test(devInstr),
  "旧的「只挑一个点 / 50 字」口径已随本轮要求更新（要装得下重要内容，但仍不许长篇）");
/* ⛔⛔ 10-09 第三轮（用户：「现在是我说一下，他才会播报，不说，他自己都不写当前回合总结播报内容」）：
   开关状态必须由**宿主在指令里直接给出** —— 上一版让模型"只看会话里那条告知"，而告知只在
   翻转开关时发一次，新会话里根本没有 ⇒ 模型按指令就一个字都不写。 */
const skillDiscipline = read("electron/main/12-skill-discipline.ts");
ok(/const VOICE_ANNOUNCE_INSTRUCTIONS = \(enabled: boolean\) =>/.test(devInstr)
  && /text \+= VOICE_ANNOUNCE_INSTRUCTIONS\(input\.announceEnabled !== false\)/.test(devInstr),
  "第 16 条按**入参**区分开/关（缺省按开），而不是让模型去猜或只等告知");
ok(/announceEnabled: loadVoiceSettings\(app\.getPath\("userData"\)\)\.announce\.enabled !== false/.test(skillDiscipline)
  && /announceEnabled\?: boolean;/.test(devInstr),
  "宿主把语音设置的当前值喂给指令（真相源 = voice-settings.json 的 announce.enabled）");
ok(/its state RIGHT NOW is|state RIGHT NOW/.test(devInstr) && /ON\*\*/.test(devInstr) && /OFF\*\*/.test(devInstr),
  "指令里写明「现在开/关」（模型开局即知，不必等用户开口）");
ok(/without being asked/.test(devInstr),
  "开启分支明确要求**每轮都写、不必等用户点名**（用户报的正是「不说他就不写」）");
/* ⛔ 只审第 16 条的正文区间：第 15 条（实时语音）**本来**就该"只看会话告知"（语音开没开
   无法从工具表推断），裸匹配会把那条正确的判据顶成假红。 */
const devInstr16Body = codeOnlyTs(devInstr).slice(codeOnlyTs(devInstr).indexOf("16) VOICE ANNOUNCEMENT"));
ok(/session-scope block/.test(devInstr16Body) && /当前会话语音播报/.test(devInstr16Body)
  && !/notice is newer than this line/.test(devInstr16Body) && !/【语音播报已开启】/.test(devInstr16Body),
  "⛔ 第 16 条以**会话作用域块**为权威（不再依赖对话里的可见告知 / 旧告知）");
ok(!/still write that sentence in your reply text/.test(codeOnlyTs(devInstr))
  && !/照常用文字把这句话写清楚/.test(codeOnlyTs(rpcSrcForContract))
  && !/那句话照常用文字写出来/.test(genSkillSrc),
  "⛔ 三处文案都不再要求「把播报句写进正文」—— 那正是用户报的「自己给自己叠一遍」（写进正文就会被念两遍）");
ok(/do NOT also paste it into your reply/.test(devInstr) && /别再原样复述/.test(rpcSrcForContract),
  "反向要求写清楚：这句是说给耳朵的，正文别再原样复述（只写在提示里不够 —— 模型看不到守卫，靠文案）");
/* ── 运行中念正文：**每个正文段都念**（10-21 用户契约，取代 10-09「由 Codex 逐条决定」）──────
   用户原话：「运行过程中，每当有新的正文内容输出时都要触发一次语音播报，避免出现播报次数过少、
   几乎听不到的情况」⇒ 旧门控 `if (!speakLiveRef.current) return;`（要模型调 voice_speak_reply
   或命中硬规则才念）就是「几乎听不到」的根因，⛔ 不许再回来（下列负向断言钉住）。
   门只剩两道：通话避让（订阅入口）+ 总开关（分支内）；静音闩锁在 speak() 唯一入口。 */
ok(/const feedDelta = useCallback/.test(announceHook)
  && /if \(!stripperRef\.current\) stripperRef\.current = createVoiceScriptStripper\(\)/.test(announceHook)
  && /chunkerRef\.current\.push\(visible\)/.test(announceHook),
  "正文流式链在（剥离器 → 断句器 → 朗读清洗 → 逐句念）—— 每个正文段都要真的走这条链");
ok(!/if \(!speakLiveRef\.current\) return;/.test(announceHook),
  "⛔ 正文播报**不得**再有 `speakLiveRef` 门控（10-21 已废：模型不标记 ⇒ 几乎听不到）");
/* ⛔ 两个门必须在**同一条分支里**按序检查 —— 拿全文件 `indexOf` 比顺序会被别的函数里的
   同名语句骗到（`finishTurn` 里也有一句 `if (!cfgRef.current.enabled) return;`，实测顶成假红）。 */
const deltaBranch = announceHook.slice(announceHook.indexOf('if (event.type === "delta")'), announceHook.indexOf('if (event.type === "toolSpeak")'));
ok(deltaBranch.includes("if (!cfgRef.current.enabled) return;")
  && deltaBranch.includes("enqueueTask(() => feedDelta(event.text))")
  && deltaBranch.includes("speakLiveRef.current = true;"),
  "delta 分支：只过**总开关**就进串行链，并打上「本回合念过正文」标记（用户关掉播报 ⇒ 正文也不念）");
ok(/const tail = stripperRef\.current\?\.flush\(\) \?\? ""/.test(announceHook)
  && !/const live = speakLiveRef\.current;/.test(announceHook),
  "回合结束**恒**收正文尾句（不再看 `speakLiveRef` 标记 —— 正文默认就念，尾句必须念完）");
/* ── 正文播报 与 结尾重点播报 **互不影响**（10-21 用户明确要求）────────────────────
   落点 = 预算按来源分开：`spentCharsRef` 是 {live,summary,tool} 三个独立计数，
   超预算只关正文（`if (scope === "live") speakLiveRef.current = false`），⚠️ 不许连坐结尾。 */
ok(/const MAX_LIVE_CHARS_PER_TURN = \d+;/.test(announceHook) && /const MAX_SUMMARY_CHARS = \d+;/.test(announceHook)
  && /useRef<Record<SpeakScope, number>>\(\{ live: 0, summary: 0, tool: 0 \}\)/.test(announceHook),
  "正文与结尾播报各有**独立预算**（旧版共用一个数字 ⇒ 正文吃满就把结尾那句重点吞掉）");
ok(/const budget = scope === "live" \? MAX_LIVE_CHARS_PER_TURN : scope === "summary" \? MAX_SUMMARY_CHARS : Number\.POSITIVE_INFINITY/.test(announceHook)
  && /if \(scope === "live"\) speakLiveRef\.current = false;/.test(announceHook)
  && /spentCharsRef\.current\[scope\]/.test(announceHook),
  "预算裁决按 `scope` 分档：超限**只**停正文，结尾播报稿与工具插播不受牵连");
ok(/await speak\(script\.text, epoch, \{ scope: "summary" \}\)/.test(announceHook)
  && /await speak\(spoken, epoch, \{ scope: "live" \}\)/.test(announceHook),
  "两条链各走各的 scope（live / summary）—— 预算与来源标记都分开，接线不许混");
ok(/if \(payload\.action === "speak-reply"\)/.test(announceHook) && /speakLiveRef\.current = true;/.test(announceHook),
  "工具广播保留「标记本回合」语义（老会话/旧文案仍会调），但**不再门控**正文播报");
ok(!/speakLiveRef\.current = true;\s*\n\s*resetLive\(\);/.test(announceHook),
  "⛔ `speak-reply` / 硬规则**不许**再 `resetLive()`：正文默认就念，重置流式链只会把攒着的半句丢掉");
const coreToolsForVoice = read("electron/features/dispatch-core.ts");
ok(/name: "voice_speak_reply"/.test(coreToolsForVoice) && /name === "voice_speak_reply"/.test(rpcSrcForContract)
  && /action: "speak-reply"/.test(rpcSrcForContract),
  "工具在能力网关里注册、执行端真的广播标记（主进程看不到正文 ⇒ 只发信号，正文由渲染层念）");
ok(/loadVoiceSettings\(app\.getPath\("userData"\)\)\.announce\.enabled === false/.test(rpcSrcForContract),
  "总开关关着时工具**明确拒绝**并说清原因（不然模型以为念了、用户什么都没听到 = 谎报成功）");
ok(/在催|几个人在催|用户在催/.test(coreToolsForVoice) && /判定权在你/.test(coreToolsForVoice),
  "工具描述写清**什么时候该用**（用户在催 / 反复没做好 / 步骤关键 / 自己有话说）且判定权在模型");
ok(/resolveAnnounceSummary\(String\(finalText/.test(announceHook) && /if \(script\.text\) \{/.test(announceHook) && /await speak\(script\.text, epoch, \{ scope: "summary" \}\)/.test(announceHook) && !/splitSentences\(script\.text\)/.test(announceHook),
  "结束只念模型写的播报稿（`resolveAnnounceSummary` = 唯一裁决点；没写 ⇒ 什么都不念），且**整段一次合成**（逐句拼接会在句界断开）");
ok(/const tail = stripperRef\.current\?\.flush\(\) \?\? ""/.test(announceHook)
  && announceHook.indexOf("const tail = stripperRef.current?.flush()") < announceHook.indexOf("const script = resolveAnnounceSummary"),
  "回合结束**先**把流式链的尾句念完、**再**念播报稿（顺序反了尾句永远丢）");

/* ── 两条硬规则：宿主侧自动播报兜底（10-09 第六轮，用户拍板「>10 次工具调用 / 返工 ≥2 次」）────
   ⛔ 判据与阈值都在 `src/lib/voice-auto-speak.mjs`（纯函数）⇒ 直接 import 跑真值表。 */
const cmdItem = (command) => ({ type: "commandExecution", command });
const fileItem = (path) => ({ type: "fileChange", path });
const toolItem = (tool, args) => ({ type: "dynamicToolCall", tool, arguments: args });
ok(AUTO_TOOL_CALL_LIMIT === 10 && REWORK_REPEAT_LIMIT === 2,
  `阈值与用户拍板逐字一致（工具调用 **>${AUTO_TOOL_CALL_LIMIT}** 次 / 返工 **≥${REWORK_REPEAT_LIMIT}** 次）—— 改这里先问用户`);
{
  const t = createAutoSpeakTracker();
  for (let i = 0; i < AUTO_TOOL_CALL_LIMIT; i++) t.push(cmdItem(`echo ${i}`));
  ok(t.state.fired === false && t.state.count === AUTO_TOOL_CALL_LIMIT,
    `真跑：正好 ${AUTO_TOOL_CALL_LIMIT} 次**还不触发**（用户口径是"超过"）`);
  const over = t.push(cmdItem("echo last"));
  ok(typeof over === "string" && over.includes(String(AUTO_TOOL_CALL_LIMIT + 1)) && t.state.fired === true,
    `真跑：第 ${AUTO_TOOL_CALL_LIMIT + 1} 次工具调用 ⇒ 强制播报（原因：${over}）`);

  const t2 = createAutoSpeakTracker();
  t2.push(cmdItem("npm test"));
  const rework = t2.push(cmdItem("npm  test"));
  ok(typeof rework === "string" && rework.includes("返工"),
    "真跑：同一条命令跑第二遍 ⇒ 判返工（⛔ 空白差异不算两条，签名先压空白）");

  const t3 = createAutoSpeakTracker();
  t3.push(fileItem("src/a.ts"));
  ok(t3.push(fileItem("src/a.ts")) !== null, "真跑：同一个文件被反复改动 ⇒ 判返工");

  const t4 = createAutoSpeakTracker();
  t4.push(toolItem("harness_tools", { name: "video_status", args: { jobId: "x" } }));
  ok(t4.push(toolItem("harness_tools", { name: "video_status", args: { jobId: "x" } })) !== null,
    "真跑：同一个工具 + 同样参数再调一次 ⇒ 判返工（重试）");

  const t5 = createAutoSpeakTracker();
  t5.push(toolItem("harness_tools", { name: "video_status", args: { jobId: "x" } }));
  ok(t5.push(toolItem("harness_tools", { name: "video_status", args: { jobId: "y" } })) === null,
    "⛔ 同一个工具但参数不同 ⇒ **不算**返工（正常的连续操作别误伤）");

  const t6 = createAutoSpeakTracker();
  t6.push({ type: "webSearch", query: "a" });
  ok(t6.push({ type: "webSearch", query: "a" }) === null,
    "⛔ 联网搜索不参与返工判定（查询本来就该互不相同）");
  ok(isWorkItem({ type: "reasoning" }) === false && isWorkItem({ type: "agentMessage" }) === false
    && isWorkItem({ type: "userMessage" }) === false,
    "思考 / 正文 / 用户消息**不计入**工具调用次数（它们不是「干活」）");

  const t7 = createAutoSpeakTracker();
  t7.push(cmdItem("npm test"));
  ok(t7.push(cmdItem("npm test")) !== null && t7.push(cmdItem("npm test")) === null,
    "命中**只报一次**（调用方据此标记回合；同一回合不重复报）");
  t7.reset();
  ok(t7.state.count === 0 && t7.state.fired === false,
    "reset() 清计数与标记（判据是**逐回合**的，回合边界必须复位）");
}
/* ⛔ 切片起点取**整个 effect**（含 `if (!threadId) return;` 与 threadId 比对那几行），
   只从 `createAutoSpeakTracker()` 切会把会话闸挡在切片外 —— 那样它会变成恒真假绿。 */
const autoRegion = announceHook.slice(announceHook.indexOf("两条硬规则：宿主侧的自动播报兜底"), announceHook.indexOf("[voice-announce] 自动播报"));
ok(autoRegion.includes("cfgRef.current.enabled") && autoRegion.includes("getVoiceStage().active"),
  "自动播报受**总开关**管、通话中不参与（更自动的东西更要尊重开关）");
ok(/if \(!threadId\) return;/.test(autoRegion) && /params\.threadId \?\? ""\) !== threadId/.test(autoRegion),
  "自动播报只认**当前会话**的工具项（别的会话的活儿不该在这里触发播报）");
ok(/autoSpeakRef\.current\?\.reset\(\)/.test(announceHook)
  && /speakLiveRef\.current = true;/.test(autoRegion),
  "硬规则命中与工具走**同一条路**（标记 speakLiveRef），且计数在回合边界重置");
ok(/stripVoiceScript\(children\)/.test(markdownTsx) && /hasWidgetFence\(text\)/.test(markdownTsx),
  "显示层在**渲染前**整块剥掉播报稿（Markdown 是唯一渲染入口；漏这一步 = 屏幕上多一段只有耳朵该听的话）");
/* 真跑：播报稿解析 + 流式剥离（'alive' 版本 —— 注释声称能干的不算，跑出来算） */
{
  const withScript = "正文交代完了。\n\n```voice\n改完了，这回真能跑起来了。\n```\n";
  const okExtract = extractVoiceScript(withScript).text === "改完了，这回真能跑起来了。";
  const okScriptOnly = resolveAnnounceSummary(withScript).text === "改完了，这回真能跑起来了。";
  // token 切分（````` / voice / 正文 分三帧到）：中间那帧不许把半截围栏当正文吐给 TTS
  const stripper = createVoiceScriptStripper();
  const frames = [stripper.push("```"), stripper.push("voice"), stripper.push("\n背后的\n"), stripper.flush()];
  const okStream = frames.every((piece) => piece === "");
  /* ⛔ push() 是「整行才吐」的：没换行就按住（这正是半截围栏不会被念出来的原因）⇒ 这里必须带换行。 */
  const okKeepVisible = stripper.push("正文还在念。\n") === "正文还在念。\n";
  ok(okExtract && okScriptOnly && okStream && okKeepVisible,
    "真跑：提取 / 只认播报稿 / token 切分下的流式剥离 都对（通话链靠这套剥离器不把围栏念出来）");
  ok(stripVoiceScript(withScript).trim() === "正文交代完了。" && !stripVoiceScript(withScript).includes("voice"),
    "真跑：屏幕显示只剩正文（围栏连同播报稿整块消失，不留半截草稿）");
  /* 告知文案本身会作为**用户消息**被渲染 ⇒ 里面绝不能出现真正的 voice 围栏
     （出现就会被上面那条"渲染前剥离"吃掉，用户屏幕上只剩半截话）。
     ⛔ 这里读源文件而不是 import：voice-notice.ts 是 TS，守卫（裸 node）认不了。 */
  /* 10-25：可见告知整条链路已删除（改为 developer instructions 的隐藏注入）——
     这里不再检查告知文案的围栏；改由下方 ⑭ 检查「作用域块每轮携带有效状态」。 */
}

/* ── ⑬ 播报进行中的实时反馈 + 随时停止（10-09 用户第三、四条要求）────── */
ok(/export function publishAnnounceStatus/.test(bus) && /export function subscribeAnnounceStatus/.test(bus)
  && /export type AnnounceStatus/.test(bus) && /publishAnnounceStatus\(\{/.test(announceHook),
  "状态经 announce-bus 广播（执行端推**事实**：有没有在念 / 正在念哪句 / 还排几句；基座不反向依赖域）");
ok(/getAnnounceStatus\(\)/.test(indicatorTsx) && /if \(!status\.active\) return null;/.test(indicatorTsx)
  && !/is-stopped/.test(codeOnlyTs(indicatorTsx)) && !/已停止播报/.test(codeOnlyTs(indicatorTsx)),
  "状态条只在**真的在念**时出现（10-22 用户：「有这个小喇叭就行了，下面这个已停止播报的这个不要」"
  + "—— 静音/恢复只留在回合头 📢 与悬浮球菜单，状态条不再常驻）");
ok(/待播 \{status\.pending\}/.test(indicatorTsx) && /voice-announce-stop/.test(indicatorTsx) && /requestAnnounceStop\(\)/.test(indicatorTsx),
  "状态条给出「当前句 + 待播句数 + 停止按钮」（看不见这条 = 用户既不知念到哪、也不知去哪儿掐断）");
ok(/<VoiceAnnounceIndicator \/>/.test(composerTsx) && /VoiceAnnounceIndicator/.test(read("src/features/voice-announce/index.ts")),
  "状态条挂在 composer 里（它要 `closest('.composer-wrap')` 才能贴输入框；挂错地方就掉到别的位置）");
ok(/closest\("\.composer-wrap"\)/.test(indicatorTsx) && /el\.style\.bottom =/.test(indicatorTsx) && /ResizeObserver/.test(indicatorTsx),
  "状态条定位与舞台条同套：按 composer 实际矩形行内写 left/bottom + 跟随尺寸变化");
ok(/\.voice-announce-bar\s*\{/.test(codeOnlyCss(stageCss)) && !/(?<![-\w])(top|left)\s*:/.test(
    (codeOnlyCss(stageCss).match(/\.voice-announce-bar\s*\{[^}]*\}/) || [""])[0]),
  "`.voice-announce-bar` 的 CSS 块里不写 top/left（与舞台条同款纪律：几何由 JS 按 composer 写）");
/* ── ⑬′ 10-12 三条用户反馈的钉死（「停止都停止不了，一直播报」「不用这么长」「有点丑」）──
   ⛔ 这三条都是**用户当面试出来的**，形态也各自特殊，所以每条都钉"判据所在的那一处"而不是
      某个字面量：静音要在 speak() 入口（唯一点）、字数要在 speak() 里扣（回合级）、
      恢复出口必须存在（否则按一次就永久失去播报 —— 比"停不下来"更糟）。 */
/* ① 静音闩锁：三处入口条件（speak / speakNow / speak-reply）都必须读 mutedRef，
      且必须**真的清掉** speakLiveRef 与 autoSpeakRef —— 少任一条，用户按停后正文流会接着念。 */
ok(/const mutedRef = useRef\(isAnnounceMutedForThread\(threadId\)\)/.test(announceHook)
  && /if \(mutedRef\.current\) return;/.test(announceHook)
  && /if \(mutedRef\.current\) return;\s*\n\s*sourceRef\.current = "tool";/.test(announceHook)
  && /if \(mutedRef\.current\) return;\s*\n\s*speakLiveRef\.current = true;/.test(announceHook),
  "静音闩锁在**三条入口**都生效：speak() 唯一裁决点 / 工具插播 speakNow / speak-reply 标记（漏任一条就有入口绕过）");
ok(/speakLiveRef\.current = false;\s*\n\s*autoSpeakRef\.current\?\.reset\(\);/.test(announceHook),
  "⛔⛔ 主动停止必须**同时**清 speakLiveRef 与 autoSpeakRef（10-12「停止都停止不了」的根因：\n"
  + "     原来只停了队列 —— 正文流下一句 delta 照念、硬规则下一帧又重新标记本回合）");
/* 闩锁的裁决点必须唯一：speak() 里那一处是全部入口的汇合，若再在别处各判一次就成了「二房东」。 */
ok((announceHook.match(/if \(mutedRef\.current\) return;/g) || []).length === 5
  && announceHook.indexOf("if (mutedRef.current) return;") < announceHook.indexOf("busyRef.current += 1"),
  "闩锁判据恰好五处、五处缺一不可：speak 入口 / speak 合成**回来后**再查一次（用户在 TTS 往返期间按停）/\n"
  + "     工具插播 / speak-reply 标记 / 自动播报硬规则。⛔ 少一处就有入口绕过它继续出声 ——\n"
  + "     「只在 speak 里判」不够（插播会先把 stoppedRef 翻回「正在念」，界面撒谎比不出声更坏）");
/* 解除出口：必须成对存在（set + clear），否则卸载后留下指向已卸载 hook 的回调。 */
ok(/export function setAnnounceResumeHandler/.test(bus) && /export function requestAnnounceResume/.test(bus)
  && /setAnnounceResumeHandler\(\(target\) => \{ resumePlayback\(target\); \}\)/.test(announceHook)
  && /setAnnounceResumeHandler\(null\)/.test(announceHook)
  && /requestAnnounceResume\(threadId\)/.test(read("src/features/voice-announce/SessionAnnounceToggle.tsx")),
  "「恢复播报」出口与停止出口**成对**注册/注销，且回合头 📢 上真的有解除口（只有闩锁没有解除口 = 用户按一次永久失去播报）");
ok(/muted: mutedRef\.current/.test(announceHook) && /muted: false/.test(bus),
  "状态广播带 `muted`（区分「1.6 秒回执」与「真的静了」—— 显示层靠它决定要不要给恢复按钮）");

/* ── ⑰ 多窗口播报归属（10-21 用户令「仅应向用户当前所在的会话窗口播报」）──────────────
   冲突根因：`codex:event` 是 broadcastToAll（所有窗口都收），每个窗口都挂 VoiceAnnounceBridge
   且各有一套 AudioContext ⇒ ① 两窗口看不同会话同时输出 = 两段语音叠加；
   ② 同一会话开主窗口 + 弹窗 = 同一句念两遍。会话闸只挡「别的会话」，挡不住「同一会话的另一窗口」。
   方案 = 主进程裁决唯一 owner（焦点 → 最后活跃 → 主窗口），渲染层在 speak() 入口让位。 */
const ownerMod = read("electron/features/voice-ipc/04-announce-owner.ts");
const ownerWiring = read("electron/features/voice-ipc.ts");
const busSrc = read("electron/features/window-bus.ts");
const mainSrc = read("electron/main.ts");
const manifestJson = read("electron/ipc-channels.manifest.json");
const registryForOwner = read("electron/ipc-registry.ts");
const preloadSrc = read("electron/preload.ts");

ok(/export function pickAnnounceOwner\(/.test(ownerMod)
  && /const focused = live\.find\(\(c\) => c\.focused\)/.test(ownerMod)
  && /lastFocusedId == null \? undefined : live\.find/.test(ownerMod)
  && ownerMod.indexOf("const focused = live.find") < ownerMod.indexOf("primary-fallback"),
  "owner 裁决是**纯函数**且顺序正确（焦点 → 最后活跃 → 主窗口回退）—— 纯函数才可离线真跑");
ok(/visible && !c\.minimized/.test(ownerMod),
  "裁决排除**最小化**窗口（最小化时用户看不见内容，让它念等于对着空气说话）");
ok(/if \(live\.length === 1\) return \{ ownerId: live\[0\]\.id, reason: "single-window" \}/.test(ownerMod),
  "单窗口恒为该窗口（零行为变化 —— 不给单窗口用户引入任何新判定）");
ok(/ipcHost\.handle\("voice:announce-owner", \(event, threadId\?: string\) =>/.test(ownerMod)
  && /senderId === ownerId/.test(ownerMod),
  "归属查询在**主进程**比对 sender（渲染层拿不到自己的 webContents.id，没法自己比）");
ok(/if \(!candidates\.length\) return \{ ownerId: null, reason: "no-window" \}/.test(ownerMod)
  && /if \(!live\.length\) return \{ ownerId: null, reason: "all-minimized" \}/.test(ownerMod),
  "⛔ 裁决里 `no-window`（一个窗口都没登记）与 `all-minimized`（有窗口但全缩了）是**两个 reason** —— 合成一个 null 会让「取不到」和「全都缩了」共用返回值");
ok(/if \(ownerId == null\) \{/.test(ownerMod) && /reason !== "all-minimized"/.test(ownerMod),
  "⛔ `all-minimized` ⇒ **全部让位**（owner:false；10-21 用户令「窗口全部缩小了就严格静音」）；`no-window` ⇒ owner:true 保底（宁可多念一次，也不能因一次算不出来就永久静音）");
ok(/\["minimize", "restore", "show", "hide"\]/.test(ownerMod) && /hookWindowEvents\(\)/.test(ownerMod)
  && /new WeakSet<BrowserWindow>\(\)/.test(ownerMod),
  "最小化 / 还原 / 显示 / 隐藏都要重算 owner，且监听**只挂一次**（WeakSet 去重：窗口增减会反复触发，不去重就越挂越多）");
ok(/onBusWindowListChanged\(\(\) => \{[\s\S]{0,90}hookWindowEvents\(\)/.test(ownerMod),
  "开/关弹窗时补挂监听（新弹窗必须被挂上，否则它最小化时不影响裁决）");
ok(/win\.webContents\.send\("voice:announce-owner-changed"/.test(ownerMod)
  && !/broadcastToAll\("voice:announce-owner-changed"/.test(ownerMod),
  "owner 广播**逐窗口定制**（每窗口答案不同）——⛔ 用 broadcastToAll 发同一 payload 等于没判");
ok(/app\.on\("browser-window-focus"/.test(ownerMod) && !/browser-window-blur/.test(ownerMod),
  "焦点变化重算 owner；⛔ **不监听 blur**：切到浏览器/编辑器时应用整体失焦，若把 owner 清空就成了「一离开窗口就听不到」");
ok(/onBusWindowListChanged\(\(\) => (?:broadcastOwner\(\)|\{[\s\S]{0,90}broadcastOwner\(\);?\s*\})\)/.test(ownerMod)
  && /export function onBusWindowListChanged/.test(busSrc)
  && /notifyWindowListChanged\(\)/.test(busSrc),
  "窗口增减（开关独立弹窗）也重算 owner（旧 owner 关闭后必须有人接棒，否则播报静默到下次焦点变化）");
ok(/if \(!isOwnerRef\.current\) return;/.test(announceHook)
  && announceHook.indexOf("if (!isOwnerRef.current) return;") > announceHook.indexOf("if (mutedRef.current) return;"),
  "⛔ owner 判据在 `speak()` **唯一入口**、排在静音闸锁之后（三个来源都汇合到那处，不许在分支里各判一遍）");
ok(/const isOwnerRef = useRef\(true\)/.test(announceHook),
  "⛔ owner 初值 **true**（取不到/旧构建时保持可用；反向 = 用户永久听不到）");
ok(/if \(!next\) stopPlayback\(false\)/.test(announceHook),
  "失去 owner 立刻停播，且用 `stopPlayback(false)`（不是按停语义 ⇒ 不许置静音闸锁）");

ok(/const tid = String\(threadId \?\? ""\)\.trim\(\);/.test(ownerMod)
  && /const muted = Boolean\(tid && state\.mutedThreads\[tid\]\)/.test(ownerMod)
  && /reason, muted, callActive \}/.test(ownerMod)
  && /persistedMuted \|\| r\?\.muted === true/.test(announceHook),
  "⛔ owner 查询**同时带回本会话的静音态**并同步到新窗口（只拿 owner 不拿 muted ⇒ 新开窗口无视已生效的静音，"
  + "用户按过停止它照念 —— 静态归属 ≠ 现在该不该出声；状态按 threadId 分开）");

ok(/let callActive = false;/.test(ownerMod) && /callActive \}/.test(ownerMod) && /if \(r\?\.callActive === true\)/.test(announceHook),
  "⛔ owner 查询**同时带回通话态**（主窗口已在通话时新开弹窗收不到那次广播 ⇒ 必须从初值拿，否则一开口就抢扬声器）；"
  + "未注入 service 时按未通话处理（不许因此让整个查询失败）");
ok(/state\.mutedThreads\[tid\] = true/.test(ownerMod) && /delete state\.mutedThreads\[tid\]/.test(ownerMod)
  && /broadcastMuted\(tid, muted\)/.test(ownerMod)
  && /input\?: \{ muted\?: boolean; threadId\?: string \}/.test(ownerMod)
  && /announceSetMuted\?\.\(\{ muted: true, threadId \}\)/.test(announceHook)
  && /announceSetMuted\?\.\(\{ muted: false, threadId: target \}\)/.test(announceHook)
  && /onAnnounceMuted\?\./.test(announceHook),
  "静音闸锁**按会话**（threadId）：同一会话的多窗口一起安静、别的会话不受影响"
  + "（10-22 用户：「每个会话独立状态，喇叭开关只决定当前会话」）");
/* ── ⑱ 回合头 📢 会话级开关（10-22 用户）────────────────────────────────
   「语音播报在 codex 名字后面加一个📢按键图标开关，每个会话独立状态，
   这个喇叭开关只决定当前会话，是否进行语音播报，跟悬浮球里面的这个同步启用停止」。 */
const announceBusSrc = read("src/voice/announce-bus.ts");
const announceToggleTsx = read("src/features/voice-announce/SessionAnnounceToggle.tsx");
const turnViewTsx = read("src/features/session-turn/SessionTurn/03-turn-view.tsx");
const timelineTsx = read("src/features/app-view/AppView/02-main-stage/01-timeline.tsx");
const turnHeadCss = read("src/styles/13-subagents-page.css");
ok(/const THREAD_MUTE_KEY = "announce-muted-threads"/.test(announceBusSrc)
  && /localStorage\.setItem\(THREAD_MUTE_KEY/.test(announceBusSrc)
  && /export function setAnnounceMutedForThread/.test(announceBusSrc)
  && /export function isAnnounceMutedForThread/.test(announceBusSrc)
  && /export function subscribeAnnounceThreadMuted/.test(announceBusSrc),
  "会话级喇叭状态落 localStorage（同一会话重开仍保持；各会话互不影响）");
const turnHeadIdx = turnViewTsx.indexOf('<span className="turn-head-name">');
const turnToggleIdx = turnViewTsx.indexOf("<SessionAnnounceToggle");
ok(/<span className="turn-head-name">\{codexName\}<\/span>\s*<SessionAnnounceToggle threadId=\{threadId\} \/>/.test(turnViewTsx)
  && turnToggleIdx > turnHeadIdx,
  "📢 开关就渲染在回合头的 Codex 名字**后面**（不是别处；顺序错了用户找不到）");
ok(/const muted = useSyncExternalStore\(/.test(announceToggleTsx)
  && /const globalOn = useSyncExternalStore\(/.test(announceToggleTsx)
  && /const enabled = globalOn && !muted/.test(announceToggleTsx)
  && /function AnnounceIcon\(/.test(announceToggleTsx)
  && /announce-slash/.test(announceToggleTsx)
  && /aria-pressed=\{enabled\}/.test(announceToggleTsx)
  && /<AnnounceIcon muted=\{!enabled\}/.test(announceToggleTsx)
  && /disabled=\{!globalOn\}/.test(announceToggleTsx)
  && /is-off/.test(announceToggleTsx)
  && /语音播报总开关已关闭 —— 去「设置 → 语音通话 → 语音播报」打开/.test(announceToggleTsx)
  && /requestAnnounceStop\(threadId\)/.test(announceToggleTsx)
  && /requestAnnounceResume\(threadId\)/.test(announceToggleTsx),
  "📢 反映**有效状态**（总开关 ∧ 未静音）：总开关关掉时置灰不可点，tooltip 指路「设置 → 语音通话 → 语音播报」");
ok(/subscribeAnnounceStatus/.test(announceToggleTsx)
  && /const playing = enabled && status\.active/.test(announceToggleTsx)
  && /is-playing/.test(announceToggleTsx)
  && /announce-waves/.test(announceToggleTsx),
  "喇叭播放特效：只在**正在播报且有效开启**时点亮声波（10-22 用户「做个好看一点的图标和喇叭播放特效」）");
ok(/turn-head-announce-toast/.test(announceToggleTsx)
  && /已开启当前会话语音播报/.test(announceToggleTsx)
  && /已关闭当前会话语音播报/.test(announceToggleTsx)
  && /role="status"/.test(announceToggleTsx)
  && /setTimeout\(\(\) => setNotice\(null\), 2000\)/.test(announceToggleTsx),
  "开关翻转弹 2 秒就地提醒（10-22 用户「语音播报开启关闭做一个弹窗提醒」；role=status 可被读屏）");
ok(/@keyframes announce-wave/.test(turnHeadCss) && /@keyframes announce-ring/.test(turnHeadCss)
  && /@keyframes announce-toast-in/.test(turnHeadCss)
  && /\.turn-head-announce-toast\s*\{[^}]*pointer-events:\s*none/.test(codeOnlyCss(turnHeadCss)),
  "声波 / 呼吸环 / 提示入场三组动效在样式里，且提示不挡点击（只动 transform/opacity）");
ok(/<MemoTurnView turn=\{turn\} threadId=\{thread\?\.id \?\? ""\}/.test(timelineTsx),
  "会话 id 一路传到回合视图（⛔ 不传 = 所有会话共用空 id，开关会退化成全局）");
ok(/\.turn-head-announce\s*\{[^}]*appearance:\s*none/.test(codeOnlyCss(turnHeadCss))
  && /\.turn-head-announce:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent\)/.test(codeOnlyCss(turnHeadCss))
  && /\.turn-head-announce\.muted\s*\{[^}]*background:\s*var\(--panel-2\)/.test(codeOnlyCss(turnHeadCss))
  && /\.turn-head-announce\.is-off\s*\{[^}]*opacity:\s*0\.45/.test(codeOnlyCss(turnHeadCss))
  && /\.turn-head-announce\.is-off\s*\{[^}]*cursor:\s*not-allowed/.test(codeOnlyCss(turnHeadCss)),
  "📢 按钮走项目变量（appearance:none 防暗色 UA 浅底 / focus-visible 焦点环 / 关态有底色）；总开关关 = 置灰不可点");
ok(/const announceMuted = useSyncExternalStore\(/.test(floatTsx)
  && /const announceGlobalOn = useSyncExternalStore\(/.test(floatTsx)
  && /if \(!announceGlobalOn\) requestVoiceOpenSettings\(\)/.test(floatTsx)
  && /else if \(announceMuted\) requestAnnounceResume\(threadId\);\s*else requestAnnounceStop\(threadId\);/.test(floatTsx)
  && /!announceGlobalOn \? "去设置开启播报" : announceMuted \? "恢复播报" : "停止播报"/.test(floatTsx),
  "悬浮球右键菜单与 📢 共用同一份有效状态：总开关关 = 指路去设置，会话静音 = 「恢复播报」");
/* ── ⑱′ 静音状态必须到模型（10-22 用户：「我关掉了，codex 还说你播报，实际是播报不了的」）──
   只在本机拦播放不够：模型看得到全局 voice-settings.json 的 announce.enabled=true，于是继续
   声称「这条回复会被播报」，还白写 voice 播报稿。修法 = 把会话级 mute 写进该会话的
   developer instructions（每轮 send 前 pushSessionScope；原来挂 adaptiveToneRef，语气关着时
   整个作用域都不下发 ⇒ 静音状态永远到不了模型）。 */
const scopeSrc = read("src/lib/session-scope.mjs");
const runtimeActivityTsx = read("src/features/app-state/parts/part06/02-seg/01-turn-runtime-activity.tsx");
const sendTsx = read("src/features/app-state/parts/part08/02-seg/send.tsx");
ok(/announceMuted: isAnnounceMutedForThread\(threadId\) \? "1" : "0"/.test(runtimeActivityTsx)
  && /announceMuted: input\.announceMuted === true/.test(scopeSrc)
  && /当前会话语音播报：\*\*已关闭\*\*/.test(scopeSrc)
  && /本会话已关闭语音播报/.test(scopeSrc),
  "静音状态写进会话作用域（developer instructions）：模型不会再拿全局 announce.enabled=true 当成能播");
ok(/if \(bag\.threadRef\.current\?\.id\) \{\s*await Promise\.race\(\[bag\.pushSessionScope\(bag\.threadRef\.current\.id\)/.test(sendTsx)
  && !/bag\.threadRef\.current\?\.id && bag\.adaptiveToneRef\.current/.test(codeOnlyTs(sendTsx)),
  "⛔ 每轮发送前都推一次会话作用域（⛔ 不许退回「只在 adaptiveToneRef 开着时推」——语气关着时静音状态根本到不了模型）");
ok(/session-scope block in your developer instructions carries the live per-session state/.test(devInstr)
  && /语音播报已关闭/.test(devInstr),
  "第 16 条明确：会话作用域里的静音状态高于全局 ON（用户现场：「我关掉了，codex 还说你播报」）");
/* ── ⑲ 长播报音质 + 断句（10-22 用户：「声音变小、沙哑、长播报变杂音」＋「断句不准」）──
   ZipVoice 对超长 utterance 会掉音量/发沙 ⇒ 按句/逗号切成 ≤90 字分段合成，再用等功率
   交叉淡化拼成**一条**音频（拼接若逐段排队播放会重新出现句界空档）。
   断句：实时块不再到 60 字硬切（等软断点，最多 hardCap）；TTS 分段不放「两三个字的尾巴」。 */
const aecSrc = read("src/lib/voice-aec.mjs");
ok(/const ANNOUNCE_CHUNK_MAX_CHARS = 90;/.test(announceHook)
  && /ANNOUNCE_CHUNK_MIN_TAIL/.test(announceHook)
  && /chunkAnnounceText\(deduped\.text, ANNOUNCE_CHUNK_MAX_CHARS\)/.test(announceHook)
  && /for \(const chunk of chunks\)/.test(announceHook)
  && /joinAnnounceChunks\(parts, sampleRate\)/.test(announceHook)
  && /sampleRate \* 0\.015/.test(announceHook)
  && /await play\(joined, sampleRate, epoch, deduped\.text\)/.test(announceHook),
  "⛔ 长播报分段合成 + 交叉淡化拼成一条音频（每段 ≤90 字、不留碎片尾巴；只 play 一次 ⇒ 句界不出现播放空档）");
ok((announceHook.match(/createSentenceChunker\(\{ maxChars: 90 \}\)/g) || []).length === 2
  && /const hardCap = options\.hardCap \?\?/.test(aecSrc)
  && /const firstHardCap = options\.firstHardCap \?\?/.test(aecSrc)
  && /const searchEnd = Math\.min\(buffer\.length, Math\.max\(limit, cap\)\)/.test(aecSrc)
  && /if \(soft >= 0 && soft \+ 1 >= Math\.floor\(limit \* 0\.4\)\)/.test(aecSrc)
  && /if \(buffer\.length < cap\) break;/.test(aecSrc),
  "实时断句不再「到字数就硬切」：句末才算硬断，超限先等逗号/顿号，没标点才用 hardCap"
  + "（10-22 用户「断句问题，断的不准」；正文与收尾两处同口径 maxChars=90）");
ok(/onVoiceCallState\?\./.test(announceHook) && /remoteCallActiveRef\.current/.test(announceHook),
  "跨窗口通话避让（`voice:event` 只发主窗口 ⇒ 弹窗靠 voice:call-state 才知道主窗口在通话）");
ok(/broadcastToAll\("voice:call-state", \{ state: event\.state, active \}\)/.test(mainSrc)
  && /if \(event\.type === "state"\)/.test(mainSrc),
  "通话状态旁路广播到**所有窗口**，且只转 state（⛔ 不把 partial/delta 塞进弹窗）");
ok(/voice:announce-owner/.test(manifestJson) && /voice:announce-set-muted/.test(manifestJson)
  && /"voice:announce-owner","voice:announce-set-muted"\]/.test(registryForOwner)
  && /count: 46/.test(registryForOwner),
  "两条新通道进 manifest + registry（count 42→44）—— 漏登记 = 预检【2】红 + 账本读不到");
ok(/onAnnounceOwnerChanged: \(listener/.test(preloadSrc) && /onAnnounceMuted: \(listener/.test(preloadSrc)
  && /onVoiceCallState: \(listener/.test(preloadSrc),
  "三条推送类手写桥在 preload（不在 gen 段：主→渲染的广播不生成 invoke 桥）");
/* ② 长度：每回合字数预算必须在 speak() 里扣，且与去重登记表**同一清零时机**（回合级）。
   ⛔ 10-21：预算按来源分档（正文 600 / 结尾 400 / 插播不限）—— 旧版单一 160 字会把
   「正文念几句」与「结尾重点」互相挤掉（用户明确要求两部分互不影响）。 */
ok(/const MAX_LIVE_CHARS_PER_TURN = \d+;/.test(announceHook)
  && /spentCharsRef\.current\[scope\] \+ deduped\.text\.length > budget/.test(announceHook)
  && /spentCharsRef\.current\[scope\] \+= deduped\.text\.length/.test(announceHook),
  "⛔ 播报**字数预算**仍在（队列背压管不住 live 那条无界正文流），但按来源分档扣减（正文 600 / 结尾 400 独立）");
ok(/const resetTurnBudget = useCallback/.test(announceHook)
  && /resetTurnBudget\(\);/.test(announceHook)
  && /finishTurn\(event\.text\)\.finally\(resetTurnBudget\)/.test(announceHook),
  "字数预算**回合级**清零，且收尾排在 finishTurn **之后**（播报稿本身也要从预算里扣）；⛔ 不能跨回合累加，否则第二轮必然沉默");
/* ③ 视觉：按钮是原生 <button>，暗色下必须 appearance:none（本项目铁律：无 color-scheme ⇒ UA 画浅底），
   且点击区不得低于 32px。 */
ok(/appearance:\s*none/.test((codeOnlyCss(stageCss).match(/\.voice-announce-stop\s*\{[^}]*\}/) || [""])[0])
  && /font:\s*inherit/.test((codeOnlyCss(stageCss).match(/\.voice-announce-stop\s*\{[^}]*\}/) || [""])[0]),
  "⛔ 停止/恢复按钮补 `appearance:none` + `font: inherit`（本项目铁律：全站无 color-scheme，暗色下原生按钮被 UA 画成浅底白块；`font` 简写必须写在 font-size 之前）");
ok(/height:\s*32px/.test((codeOnlyCss(stageCss).match(/\.voice-announce-stop\s*\{[^}]*\}/) || [""])[0]),
  "停止按钮点击区 32px（原先 22px，低于桌面密集区下限 —— 难点中）");
ok(/width:\s*max-content/.test((codeOnlyCss(stageCss).match(/\.voice-announce-bar\s*\{[^}]*\}/) || [""])[0])
  && /el\.style\.maxWidth =/.test(indicatorTsx) && !/el\.style\.width =/.test(indicatorTsx),
  "⛔ 播报条宽度改为**贴合内容**（原先固定 280px 起 ⇒ 没有正文时也是一条空胶囊）；上限由 JS 的 maxWidth 管（CSS 块不写几何）");

/* ── ⑭ 让 Codex 知晓（10-25 改为**隐藏注入**：不往对话里发消息）────────────── */
ok(/16\) VOICE ANNOUNCEMENT/.test(devInstr) && /当前会话语音播报/.test(devInstr) && !/【语音播报已开启】/.test(devInstr),
  "引擎侧第 16 条改读会话作用域块（不再依赖对话里的可见告知）");
ok(!/VOICE_ANNOUNCE_ON_TAG|voiceAnnounceNoticeText/.test(noticeTs) && !/VoiceAnnounceNoticeBridge/.test(appViewSrc),
  "⛔ 不再往对话里发播报开关告知（10-25 用户：不要每次切换发个消息出去）");
ok(/announceOn: getAnnounceGlobalEnabled\(\)/.test(runtimeActivityTsx) && /announceOn: input\.announceOn/.test(scopeSrc)
  && /v\.announceOn === "1"/.test(scopeSrc) && /当前会话语音播报/.test(scopeSrc)
  && /announceOn/.test(scopeSrc.slice(scopeSrc.indexOf('sessionScopeSignature'), scopeSrc.indexOf('sessionScopeSignature') + 240)),
  "有效状态（总开关 ∧ 会话未静音）每轮注入 developer instructions（隐藏；签名含 announceOn ⇒ 下一轮下发）");
const coreTools = read("electron/features/dispatch-core.ts");
const rpcExec = read("electron/features/dispatch-rpc.ts");
ok(/name: "voice_announce"/.test(coreTools) && /name: "voice_announce_stop"/.test(coreTools),
  "能力网关登记了 voice_announce / voice_announce_stop（内置 MCP 工具面在引擎 0.157 后整批延迟暴露 ⇒ 这是唯一可见通道）");
ok(/name === "voice_announce" \|\| name === "voice_announce_stop"/.test(rpcExec)
  && /broadcastHarnessEvent\(\{[\s\S]{0,120}?type: "voice-announce"/.test(rpcExec)
  && /voice-announce["']?[\s\S]{0,200}?speaker|voiceService\?\.status\?\.\(\)/.test(rpcExec),
  "工具执行端真的把请求发出去（主进程没有扬声器出口 ⇒ 广播给渲染层的播报队列，不等念完以免卡住回合）");
ok(/if \(status\?\.active\)[\s\S]{0,200}?return \{ ok: false/.test(rpcExec),
  "通话中明确**拒绝**插播（扬声器独占 + AEC 参考环：两条一起放 = 回声 + 抢话，停还停不掉）");
ok(/type !== "voice-announce"/.test(announceHook) && /payload\.action === "stop"/.test(announceHook)
  && /event\.threadId !== threadId/.test(announceHook),
  "渲染层收到广播且带**会话闸**（harness:event 是全窗口广播，另一个会话的插播不许在这里念出来）");
ok(/\|\s*\{ type: "toolSpeak"; threadId: string; text: string; speed\?: number \}/.test(bus)
  && /publishAnnounceEvent\(\{[\s\S]{0,120}?type: "toolSpeak"/.test(announceHook),
  "总线有 toolSpeak 且其**真的被发布**（⛔ 它**不受**两个播报开关管：显式调用就是用户想听这一句；"
  + "声明了却没人发 = 模型侧开了能力、执行端没有入口 —— 本仓最贵的一种假象）");

/* ── ⑳ 悬浮球外观皮肤（10-25 用户：「配套一套好看的，设置语音通话里可以改样式」）── */
{
  const catalogs = await import("../../src/lib/voice-ball-styles.mjs");
  const styles = catalogs.VOICE_BALL_STYLES;
  ok(Array.isArray(styles) && styles.length >= 6
    && styles.some((s) => s.id === "ink" && s.name)
    && catalogs.normalizeVoiceBallStyle("not-a-skin") === "ink"
    && catalogs.normalizeVoiceBallStyle("mint") === "mint",
    "外观目录 ≥6 套、含默认墨黑，未知 id 回落默认（设置文件手改/旧版本不炸）");
  const mascotSrc = read("src/components/VoiceMascot.tsx");
  ok(/voice-bot-eye--left/.test(mascotSrc) && /voice-bot-eye--right/.test(mascotSrc)
    && /voice-bot-blush--left/.test(mascotSrc) && /voice-bot-blush--right/.test(mascotSrc)
    && !/mouth|nose|voice-mascot-orb/.test(mascotSrc),
    "角色本身是 Grok Bot 式圆脸 + 两颗胶囊眼 + 腮红（⛔ 不是圆点眼/动物/加光圈了事）");
  const botCss = read("src/styles/18-openai-dialog.css");
  ok(/\.voice-bot-eye \{[^}]*width:\s*16%[^}]*height:\s*34%[^}]*border-radius:\s*999px/.test(botCss)
    && !/\.voice-mascot-orb\b/.test(botCss) && /\.voice-bot--skin-ink \{/.test(botCss),
    "胶囊眼是脸宽 16% / 脸高 34% 的竖长条（随 28/34px 预览同比缩放），旧 Siri 球样式已删除");
  const voiceSettingsSrc = read("electron/voice/voice-settings.ts");
  ok(/ball: \{ visible: true, hints: true, style: DEFAULT_VOICE_BALL_STYLE \}/.test(voiceSettingsSrc)
    && /style: normalizeVoiceBallStyle\(\(ball as any\)\.style\)/.test(voiceSettingsSrc),
    "主进程设置默认 + 显式映射 ball.style（⛔ 漏映射 = 设置页选了不生效）");
  const floatStateSrc = read("src/components/VoiceCallFloat/use-voice-call-float-state.tsx");
  ok(/voice-ball--skin-\$\{ballStyle\}/.test(floatStateSrc)
    && /normalizeVoiceBallStyle\(b\.style\)/.test(floatStateSrc),
    "悬浮球按设置切换 skin 类（设置广播即时生效）");
  const ballSettingsSrc = read("src/components/VoiceSettingsSection/06-floating-ball.tsx");
  ok(/VOICE_BALL_STYLES\.map/.test(ballSettingsSrc) && /style: style\.id/.test(ballSettingsSrc),
    "设置页渲染外观卡片并写回 ball.style");
  const ballCss = read("src/styles/18-openai-dialog.css");
  const missing = styles.filter((s) => !new RegExp(`\\.voice-ball--skin-${s.id}\\b`).test(ballCss));
  ok(missing.length === 0, `每套外观都有样式（缺：${missing.map((s) => s.id).join(",") || "无"}）`);
}

/* ── ㉑ 悬浮球轻互动（10-26 用户：「眼睛跟着鼠标走，打字有键盘出来」）── */
{
  const reactions = await import("../../src/lib/ball-reactions.mjs");
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const right = reactions.gazeOffsets(500, 50, rect);
  const leftTop = reactions.gazeOffsets(0, 0, rect);
  ok(Math.abs(right.x - 3) < 0.01 && Math.abs(right.y) < 0.01
    && Math.abs(leftTop.x + 3) < 0.01 && Math.abs(leftTop.y + 2.2) < 0.01,
    "眼球追踪：朝指针方向平移，最大水平 3px / 垂直 2.2px（⛔ 胶囊眼是整体平移，不是画瞳孔）");
  ok(reactions.gazeOffsets(50, 50, rect).x === 0
    && reactions.gazeOffsets(999, 999, { ...rect, width: 0 }).x === 0,
    "指针在球心 = 归零；拿不到矩形 = 归零（不朝左上角乱看）");
  ok(reactions.isTypingKey("a") && reactions.isTypingKey(" ") && reactions.isTypingKey("Backspace")
    && reactions.isTypingKey("中") && !reactions.isTypingKey("a", { ctrlKey: true })
    && !reactions.isTypingKey("ArrowLeft") && !reactions.isTypingKey("Shift"),
    "打字判定：字符/空格/退格/中文算，Ctrl/⌘/Alt 组合与方向键/修饰键不算");
  ok(reactions.isTypingTarget("INPUT") && reactions.isTypingTarget("textarea")
    && reactions.isTypingTarget("DIV", true) && !reactions.isTypingTarget("BUTTON"),
    "只有输入框/多行输入/可编辑区域里的敲键才弹键盘（点按钮、快捷键不算）");

  ok(reactions.pupilScale(0) === 1 && reactions.pupilScale(1) > 1.05
    && reactions.pupilScale(100) === 1.18 && reactions.pupilScale(Number.NaN) === 1,
    "瞳孔缩放：不动 = 1x，越快越大，上限 1.18x（非法速度回落 1）");
  const hookSrc = read("src/components/VoiceCallFloat/use-ball-reactions.ts");
  ok(/requestAnimationFrame/.test(hookSrc) && /setProperty\("--bot-gaze-x"/.test(hookSrc)
    && /removeProperty\("--bot-gaze-x"\)/.test(hookSrc) && !/useState<[^>]*gaze|const \[gaze/.test(hookSrc),
    "鼠标追踪只写 CSS 变量并 rAF 合并（⛔ 不进 React state：每次 pointermove 重渲通话组件会卡）");
  ok(/setProperty\("--bot-eye-scale"/.test(hookSrc) && /removeProperty\("--bot-eye-scale"\)/.test(hookSrc)
    && /pupilScale\(speed\)/.test(hookSrc),
    "瞳孔缩放按指针速度写 --bot-eye-scale，停下复位（140ms 保持 + CSS 过渡回落）");
  ok(/prefers-reduced-motion/.test(hookSrc) && /compositionstart/.test(hookSrc)
    && /removeEventListener\("pointermove"/.test(hookSrc) && /removeEventListener\("keydown"/.test(hookSrc),
    "监听成对摘除；减动效不跟随；中文输入法 composition 也弹键盘");
  const floatSrc = read("src/components/VoiceCallFloat.tsx");
  ok(/useBallReactions\(\{ enabled: ballVisible, ballRef \}\)/.test(floatSrc)
    && /hint && !typingBall/.test(floatSrc),
    "球可见即启用（互斥置灰态也不反复摘挂监听）；打字时提示气泡让位");
  ok(/voice-ball-keyboard/.test(floatSrc) && /\[6, 6, 4\]/.test(floatSrc)
    && /voice-keyboard-row/.test(floatSrc),
    "打字时球上方渲染迷你键盘（三排 6/6/4 键）");
  const mascotSrc2 = read("src/components/VoiceMascot.tsx");
  ok(/voice-bot-gaze[\s\S]{0,200}?voice-bot-eye--left[\s\S]{0,200}?voice-bot-eye--right/.test(mascotSrc2),
    "两只眼睛包在同一个位移层里（眨眼动画与追踪互不覆盖）");
  const reactionCss = read("src/styles/18-openai-dialog.css");
  ok(/\.voice-bot-gaze \{[^}]*translate\(var\(--bot-gaze-x, 0px\), var\(--bot-gaze-y, 0px\)\)/.test(reactionCss)
    && /\.voice-bot-eye \{[^}]*scale:\s*var\(--bot-eye-scale/.test(reactionCss)
    && /\.voice-ball-keyboard \{[^}]*pointer-events:\s*none/.test(reactionCss)
    && /\.voice-keyboard-key \{[^}]*animation:\s*voice-key-tap/.test(reactionCss),
    "位移层、瞳孔缩放（独立 scale 属性）与迷你键盘样式在位（键盘不占布局、不拦点击）");
}

console.log(`\n【voice-call】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);