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
ok(/VOICE_SETTINGS_VERSION = 4/.test(voiceSettings) && /if \(version < 4\)/.test(voiceSettings),
  "版本 3 → 4 且带迁移（字段形状变了：两个开关收成一个 —— 不迁移的话老档案读出来是 undefined）");
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
ok(/正在念正文/.test(read("src/features/voice-announce/VoiceAnnounceIndicator.tsx"))
  && /正在念播报稿/.test(read("src/features/voice-announce/VoiceAnnounceIndicator.tsx")),
  "状态条文案含「正在念正文 / 正在念播报稿」（少了哪个用户就不知道在念什么）");
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
ok(/if \(getVoiceStage\(\)\.active\) return;/.test(announceHook),
  "非通话链路在通话中**主动避让**（否则两个播报器同时念）");
/* ⛔ 钉的是「RenderTree 里只出现一次」而不是某个字面量 —— 10-09 加了 threadId prop（会话闸），
   锚字符串一旦写死就变成"改个 prop 就假红"，这是本仓记过的锚点写法禁区。 */
ok((appViewSrc.match(/<VoiceAnnounceBridge\b/g) || []).length === 1
  && !/<VoiceAnnounceBridge\b/.test(announceBridge),
  "挂载件整个应用只挂一次（挂两次会念两遍 —— 它订阅的是模块级总线）");
/* 运行期安全三条：非通话播报「只管说不管听」，没有这三条它就成了停不下来的复读机 */
ok(/export function setAnnounceStopHandler/.test(bus) && /export function requestAnnounceStop/.test(bus)
  && /setAnnounceStopHandler\(\(\) => \{ stopPlayback\(/.test(announceHook)
  && /requestAnnounceStop\(\)/.test(floatTsx) && /停止播报/.test(floatTsx)
  && /requestAnnounceStop\(\)/.test(read("src/features/voice-announce/VoiceAnnounceIndicator.tsx")),
  "有两条「停止播报」出口（悬浮球右键菜单 + 播报状态条按钮 → 基座广播 → 播报域执行；基座不反向依赖域）");
ok(/queueRef\.current\.length >= MAX_ANNOUNCE_BACKLOG/.test(announceHook),
  "播放队列封顶（超了就丢弃这一句保持跟手，而不是念几分钟前的内容）");
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
ok(/window\.codex\.voicePreviewVoice\(\{ text: deduped\.text/.test(announceHook),
  "合成用的是**去重后**的文本（拿原始 clean 去合成 = 查重白做）");
ok(/\.finally\(clearSpokenKeys\)/.test(announceHook)
  && (announceHook.match(/clearSpokenKeys\(\)/g) || []).length >= 2,
  "去重登记表**回合级清零**（正常收尾排在 finishTurn 之后 / 被打断时同步清）——跨回合「再说一遍」必须照念");
ok(/const filter = createSpeakFilter\(\);\s*\n\s*const spoken = String\(filter\.push\(String\(text \?\? ""\)\) \?\? ""\)\.trim\(\);/.test(announceHook)
  && /await speak\(spoken, epoch, \{ speed \}\);/.test(announceHook),
  "工具插播文本过**同一套**朗读清洗（正文过滤后是「三个」、工具原文是「3」就永远对不上键；顺带 markdown 记号不再被当字念）");
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
ok(/\{ prefix: "voice", count: 42/.test(registrySrc) && /"voice:profile-upload"/.test(registrySrc),
  "ipc-registry 的 voice 域计到 42 且列出新通道（不同步会被【107】/【90】报红）");
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
  && /enqueueTask\(\(\) => finishTurn\(event\.text\)(\.finally\(clearSpokenKeys\))?\)/.test(announceHook),
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
  && /~80 Chinese characters is the sweet spot/.test(devInstr),
  "第 16 条要求播报稿装**本轮重要内容**（结果/关键数字/风险），并点名两种失败形态：逐句复述、只有「好了」");
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
ok(!/Judge ONLY by that notice/.test(devInstr16Body) && /notice is newer than this line/.test(devInstr16Body),
  "⛔ 第 16 条删掉旧的「只看那条告知」判据（它就是根因），改成：告知仍生效但以**更新的那条**为准");
ok(!/still write that sentence in your reply text/.test(codeOnlyTs(devInstr))
  && !/照常用文字把这句话写清楚/.test(codeOnlyTs(rpcSrcForContract))
  && !/那句话照常用文字写出来/.test(genSkillSrc),
  "⛔ 三处文案都不再要求「把播报句写进正文」—— 那正是用户报的「自己给自己叠一遍」（写进正文就会被念两遍）");
ok(/do NOT also paste it into your reply/.test(devInstr) && /别再原样复述/.test(rpcSrcForContract),
  "反向要求写清楚：这句是说给耳朵的，正文别再原样复述（只写在提示里不够 —— 模型看不到守卫，靠文案）");
/* ── 运行中念正文：**由 Codex 逐条决定**（10-09 第五轮，用户：「正文输出也可以进行播报，
      但不是每条都需要，完全由 codex 决定」）────────────────────────────────────
   ⛔ 这条最容易退化成"每条都念"（那就是用户上一轮明确否掉的形态）⇒ 判据必须钉住**门控**：
      正文流式链存在、但只有 `speakLiveRef` 为真才念；标记只由工具广播设置、回合边界复位。 */
ok(/const feedDelta = useCallback/.test(announceHook)
  && /if \(!stripperRef\.current\) stripperRef\.current = createVoiceScriptStripper\(\)/.test(announceHook)
  && /chunkerRef\.current\.push\(visible\)/.test(announceHook),
  "正文流式链在（剥离器 → 断句器 → 朗读清洗 → 逐句念）—— Codex 决定念时必须真的有这条链");
ok(/if \(!speakLiveRef\.current\) return;/.test(announceHook)
  && announceHook.indexOf("if (!speakLiveRef.current) return;") < announceHook.indexOf("enqueueTask(() => feedDelta(event.text))"),
  "⛔ delta **先过 `speakLiveRef` 门控**再进串行链：没被 Codex 标记的回合一个字都不念");
/* ⛔ 两个门必须在**同一条分支里**按序检查 —— 拿全文件 `indexOf` 比顺序会被别的函数里的
   同名语句骗到（`finishTurn` 里也有一句 `if (!cfgRef.current.enabled) return;`，实测顶成假红）。 */
const deltaBranch = announceHook.slice(announceHook.indexOf('if (event.type === "delta")'), announceHook.indexOf('if (event.type === "toolSpeak")'));
ok(deltaBranch.includes("if (!speakLiveRef.current) return;") && deltaBranch.includes("if (!cfgRef.current.enabled) return;")
  && deltaBranch.indexOf("speakLiveRef.current") < deltaBranch.indexOf("cfgRef.current.enabled")
  && deltaBranch.includes("enqueueTask(() => feedDelta(event.text))"),
  "delta 分支：先过 `speakLiveRef`、再过**总开关**，然后才进串行链（用户关掉播报 ⇒ 正文也不念）");
ok(/if \(payload\.action === "speak-reply"\)/.test(announceHook) && /speakLiveRef\.current = true;/.test(announceHook)
  && /const live = speakLiveRef\.current;\s*\n\s*speakLiveRef\.current = false;/.test(announceHook),
  "工具广播把本回合标记成「念正文」，**回合结束复位**（逐条生效，不会漏到下一轮）");
const coreToolsForVoice = read("electron/features/dispatch-core.ts");
ok(/name: "voice_speak_reply"/.test(coreToolsForVoice) && /name === "voice_speak_reply"/.test(rpcSrcForContract)
  && /action: "speak-reply"/.test(rpcSrcForContract),
  "工具在能力网关里注册、执行端真的广播标记（主进程看不到正文 ⇒ 只发信号，正文由渲染层念）");
ok(/loadVoiceSettings\(app\.getPath\("userData"\)\)\.announce\.enabled === false/.test(rpcSrcForContract),
  "总开关关着时工具**明确拒绝**并说清原因（不然模型以为念了、用户什么都没听到 = 谎报成功）");
ok(/在催|几个人在催|用户在催/.test(coreToolsForVoice) && /判定权在你/.test(coreToolsForVoice),
  "工具描述写清**什么时候该用**（用户在催 / 反复没做好 / 步骤关键 / 自己有话说）且判定权在模型");
ok(/resolveAnnounceSummary\(String\(finalText/.test(announceHook) && /if \(script\.text\) await speak/.test(announceHook),
  "结束只念模型写的播报稿（`resolveAnnounceSummary` = 唯一裁决点；没写 ⇒ 什么都不念）");
ok(/const tail = stripperRef\.current\?\.flush\(\) \?\? ""/.test(announceHook)
  && announceHook.indexOf("const tail = stripperRef.current?.flush()") < announceHook.indexOf("const script = resolveAnnounceSummary"),
  "念过正文的回合：**先把流式链的尾句念完**再念播报稿（否则尾句永远丢）");

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
  const noticeBody = (noticeTs.match(/function voiceAnnounceNoticeText[\s\S]*?\n}\n/) || [""])[0];
  ok(Boolean(noticeBody) && !/(\x60){3}/.test(noticeBody) && /VOICE_ANNOUNCE_ON_TAG/.test(noticeBody),
    "告知文案里不写真围栏（原文注水讲究：写了会被当成播报稿剥掉，用户看到的是半截话）；格式由 ASR 指令兜底");
}

/* ── ⑬ 播报进行中的实时反馈 + 随时停止（10-09 用户第三、四条要求）────── */
ok(/export function publishAnnounceStatus/.test(bus) && /export function subscribeAnnounceStatus/.test(bus)
  && /export type AnnounceStatus/.test(bus) && /publishAnnounceStatus\(\{/.test(announceHook),
  "状态经 announce-bus 广播（执行端推**事实**：有没有在念 / 正在念哪句 / 还排几句；基座不反向依赖域）");
ok(/getAnnounceStatus\(\)/.test(indicatorTsx) && /if \(!status\.active && !status\.stopped\) return null;/.test(indicatorTsx),
  "状态条只在**真的在念**时出现（平时 DOM 里什么都没有 —— 不占输入框周围的空间）");
ok(/待播 \{status\.pending\}/.test(indicatorTsx) && /voice-announce-stop/.test(indicatorTsx) && /requestAnnounceStop\(\)/.test(indicatorTsx),
  "状态条给出「当前句 + 待播句数 + 停止按钮」（看不见这条 = 用户既不知念到哪、也不知去哪儿掐断）");
ok(/<VoiceAnnounceIndicator \/>/.test(composerTsx) && /VoiceAnnounceIndicator/.test(read("src/features/voice-announce/index.ts")),
  "状态条挂在 composer 里（它要 `closest('.composer-wrap')` 才能贴输入框；挂错地方就掉到别的位置）");
ok(/closest\("\.composer-wrap"\)/.test(indicatorTsx) && /el\.style\.bottom =/.test(indicatorTsx) && /ResizeObserver/.test(indicatorTsx),
  "状态条定位与舞台条同套：按 composer 实际矩形行内写 left/bottom/width + 跟随尺寸变化");
ok(/\.voice-announce-bar\s*\{/.test(codeOnlyCss(stageCss)) && !/(?<![-\w])(top|left)\s*:/.test(
    (codeOnlyCss(stageCss).match(/\.voice-announce-bar\s*\{[^}]*\}/) || [""])[0]),
  "`.voice-announce-bar` 的 CSS 块里不写 top/left（与舞台条同款纪律：几何由 JS 按 composer 写）");
ok(/if \(stoppedTimerRef\.current\) clearTimeout/.test(announceHook) && /stoppedRef\.current = false/.test(announceHook),
  "「已停止」只是一句**回执**、会自动收起（留在那儿它就变成一条永远挂着的空提示）");

/* ── ⑭ 让 Codex 知晓 + 有可用工具（10-09 用户：「记得配套对应工具，没工具他调用不了」）── */
ok(/16\) VOICE ANNOUNCEMENT/.test(devInstr) && /【语音播报已开启】/.test(devInstr) && /【语音播报已关闭】/.test(devInstr),
  "引擎侧指令第 16 条按同一对标签判定播报开关（跨文件契约：改文案不改指令 ⇒ 模型认不出这条告知）");
ok((/VOICE_ANNOUNCE_ON_TAG = "【语音播报已开启】"/.test(noticeTs) && /VOICE_ANNOUNCE_OFF_TAG = "【语音播报已关闭】"/.test(noticeTs)),
  "告知标签的真相源在 voice-notice.ts（与通话告知同文件、同范式）");
ok(/setAnnounceNoticeHandler/.test(bus) && /setAnnounceNoticeHandler\(/.test(bridgeTsx) && /voiceAnnounceNoticeText\(enabled\)/.test(bridgeTsx)
  && /<VoiceAnnounceNoticeBridge/.test(appViewSrc) && /notifyAnnounceToggle\(/.test(announceHook),
  "开关翻转 → 告知进当前会话（总线 → 桥翻文案 → App 发送；Model 据此才知道要不要写那段稿）");
ok(/let prev: boolean \| null = null;/.test(announceHook) && /if \(prev !== null && prev !== enabled\) notifyAnnounceToggle\(enabled\);/.test(announceHook),
  "首次读到设置**不发**告知（初值 null 而不是 false —— 否则每次开窗口都往会话里塞一条「已开启」）");
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

console.log(`\n【voice-call】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);