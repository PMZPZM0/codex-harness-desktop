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
import { summarizeForSpeech, splitSentences, SUMMARY_PREFIX } from "../../src/lib/voice-summary.mjs";

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

/* ── ⑦ 语音播报：实时正文 + 结束汇总（10-08 用户新增需求，两个独立开关）────────── */
const announceCard = read("src/components/VoiceSettingsSection/10-announce.tsx");
const announceHook = read("src/features/voice-announce/use-voice-announce.ts");
const announceBridge = read("src/features/voice-announce/VoiceAnnounceBridge.tsx");
const bus = read("src/voice/announce-bus.ts");
const engineBridge = read("src/features/voice-announce/engine-bridge.ts");
const seg05 = read("src/features/app-state/parts/part05/01-seg.tsx");
const appViewSrc = read("src/features/app-view/AppView.tsx");

ok(/announce: \{ live: true, summary: false \}/.test(voiceSettings),
  "默认值：live=true（= 通话既有行为，升级不改体验）、summary=false（新功能默认关）");
ok(/announce: \{[\s\S]{0,200}?live: announce\.live !== false[\s\S]{0,100}?summary: announce\.summary === true/.test(voiceSettings),
  "mergeSettings **显式映射** announce（漏映射 = 用户改了不生效且不报错 —— 本文件已 N 次同款）");
ok(/checked=\{announce\.live\}/.test(announceCard) && /checked=\{announce\.summary\}/.test(announceCard),
  "设置页「语音播报」卡片上有**两个独立**开关（实时正文 / 结束汇总）");
ok(/if \(announceRef\.current\.live\) void speakDelta\(piece\)/.test(hook),
  "通话的实时播报受 live 门控（关掉 ⇒ 只出字幕不出声）");
ok(/if \(announceRef\.current\.live\) await flushSpeech\(\);[\s\S]{0,140}?if \(announceRef\.current\.summary\) await speakSummary/.test(hook),
  "汇总**在尾句念完之后**才念（两者共用播放队列，并发入队会把汇总插进半句中间）");
ok(/const a = event\.settings\?\.announce/.test(hook),
  "设置页改开关后经 voice:event 广播即时生效（不必重开通话）");
ok(/export function publishAnnounceEvent/.test(bus) && /export function subscribeAnnounce/.test(bus)
  && !/summarizeForSpeech|chunker/.test(bus),
  "基座总线只做转发（开关判定/断句/合成全在播报域里，别把逻辑塞进基座）");
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
ok((appViewSrc.match(/<VoiceAnnounceBridge \/>/g) || []).length === 1
  && !/<VoiceAnnounceBridge \/>/.test(announceBridge),
  "挂载件整个应用只挂一次（挂两次会念两遍 —— 它订阅的是模块级总线）");
/* 运行期安全三条：非通话播报「只管说不管听」，没有这三条它就成了停不下来的复读机 */
ok(/export function setAnnounceStopHandler/.test(bus) && /export function requestAnnounceStop/.test(bus)
  && /setAnnounceStopHandler\(\(\) => \{ stopPlayback\(\); \}\)/.test(announceHook)
  && /requestAnnounceStop\(\)/.test(floatTsx) && /停止播报/.test(floatTsx),
  "有「停止播报」出口（悬浮球右键菜单 → 基座广播 → 播报域执行；基座不反向依赖域）");
ok(/queueRef\.current\.length >= MAX_ANNOUNCE_BACKLOG/.test(announceHook),
  "播放队列封顶（超了就丢弃这一句保持跟手，而不是念几分钟前的内容）");
ok(/subscribeVoiceStage\(\(stage\) => \{ if \(stage\.active\) stopPlayback\(\); \}\)/.test(announceHook),
  "通话一开始就停掉独立播报（否则通话播报与排队音频同时出声）");

/* 汇总播报：**真跑**纯函数（src/lib/voice-summary.mjs） */
const longText = Array.from({ length: 20 }, (_, i) => `这是第 ${i + 1} 条说明内容。`).join("");
const sLong = summarizeForSpeech(longText);
const sEmpty = summarizeForSpeech("   ");
const sCode = summarizeForSpeech("```\nconsole.log(1)\n```");
const sTable = summarizeForSpeech("对比结果如下。\n| 项 | 值 |\n| --- | --- |\n| a | 1 |\n以上。");
const sOne = summarizeForSpeech("只有一句。");
ok(sLong.text.startsWith(SUMMARY_PREFIX) && sLong.truncated && sLong.kept < sLong.sentences
  && sLong.text.includes("另有") && sLong.text.length <= 200,
  `真跑汇总：长回复压成要点 + 「另有 N 句」（${sLong.sentences} 句 → 念 ${sLong.kept} 句 / ${sLong.text.length} 字）`);
ok(sEmpty.text === "" && sCode.text === "",
  "真跑汇总：空文本与「整段是代码」都返回空串（由调用方改念 SUMMARY_EMPTY_NOTICE，不合成空音频）");
ok(sTable.text.includes("对比结果如下") && sTable.text.includes("以上") && !sTable.text.includes("|"),
  "真跑汇总：表格整段丢掉、不念竖线（复用朗读视图的块级状态机，不另造一份清洗）");
ok(sOne.text === `${SUMMARY_PREFIX}只有一句。`,
  "真跑汇总：短回复原样念（不加「另有」、不截断）");
ok(!/```/.test(sLong.text + sTable.text + sOne.text) && splitSentences("一。二！三？四").length === 4
  && splitSentences("版本 3.5 已发布。").length === 1,
  "汇总输出不含 markdown 围栏；句级切分按中英句末标点，且**不切小数点**");

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
  && /enqueueTask\(\(\) => feedDelta\(event\.text\)\)/.test(announceHook)
  && /enqueueTask\(\(\) => finishTurn\(event\.text\)\)/.test(announceHook),
  "播报动作挂**串行链**：合成是异步的、delta 是并发到达的 ⇒ 不串行会念乱顺序（A 慢 B 快则 B 先出声）");
ok(/summary\.sentences === 0 && String\(finalText \?\? ""\)\.trim\(\)/.test(announceHook),
  "「整段是代码」的那句提示只在**原文非空**时念（finalText 为空 = 引擎没带 items，是数据缺失，不是代码）");
ok(/response\.status === 416[\s\S]{0,420}?await rename\(workPath, destPath\)/.test(store),
  "downloadOnce 处理 416：`.part` 已完整（上次 rename 失败）时校验后提拔成最终文件（否则那份完整文件永远卡住）");
ok(/if \(sha256 && \(await fileShaOrEmpty\(workPath\)\) === sha256\)/.test(store),
  "416 分支的先决条件是 sha256 非空（空 sha 时缺文件也返回空串 ⇒ 会假成功）");
ok(/const staging = join\(modelsRoot, `\.staging-\$\{targetName\}`\)/.test(store)
  && !/\.staging-\$\{targetName\}-\$\{Date\.now/.test(store),
  "暂存目录名**确定性**（每次尝试开头就地清掉 ⇒ 崩溃残留不累积、也不被算进模型体积）");
ok(/const announce = settings\.announce \?\? \{ live: true, summary: false \}/.test(announceCard),
  "设置卡片对 announce 做兜底（老主进程回包缺字段时不许把整页打成白屏）");

console.log(`\n【voice-call】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);