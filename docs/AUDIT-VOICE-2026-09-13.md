# 语音（通话 + 语音输入）审计 · 2026-09-13

> 提问：现有语音输入 / 语音通话还有哪些可优化。
> 结论：**架构选对了**（全本机离线 sherpa-onnx；渲染层采集/AEC/门控/断句/播放，主进程只编排，
> ASR/TTS 全在 `worker_threads`；通话轮 `effort=low`），但缺两样东西：**量化**与**给人听的文本层**。
> 下面按「用户可感知收益」排序，每条带证据、机制、收益、风险、最小改法。

## 语音唤醒专项（用户 09-13 追加：「语音唤醒功能好像不太行，检查一下」）

### 取证（`.tmp/wake-probe.mjs` / `.tmp/wake-vocab-probe.mjs` / `.tmp/wake-e2e-probe.mjs`，都是真模型真链路）

| 说 | 识别成 | 旧实现（精确 `includes`） |
|---|---|---|
| 小柯小柯 | 小柯小柯 / 小哥小哥 / **小咳小壳** | 1/3 命中 |
| 小科小科 | **小柯小柯 / 小颗小颗** | 0/2 |
| 小可小可 | 消客小客 / 教科小壳 | 0/2 |
| 帮我看看这个项目的代码 | 帮我…（无关） | 不误唤醒 ✓ |

- **「柯」不在识别模型词表里**：`tokens.txt` 只有 **2002** 项（有 科/可/客/刻/课，没有 柯）。
  该模型是**字节级 BPE**，罕见字只能靠 `<0xNN>` 字节拼出来 → 模型更愿意吐**同音常用字**。
  所以「小柯小柯」在真机上经常被识别成 小咳小壳 / 小颗小颗 —— **词是对的，字不是**。
- 同一段音频两次结果可以不同（通用模型当关键词用，本来就不稳定）。
- 唤醒路径**从不 reset 识别流**：`isEndpoint()` 只是查询、不会自动复位 → 文本跨句无限累积
  （实测三轮累积成一整坨），且每块都把整坨文本回传渲染层（O(n²) IPC）。
- **设置开关改了不重挂**：`VoiceCallFloat` 的唤醒 effect 依赖数组只有 `[phase]`，而开关/唤醒词
  来自 effect 内一次性读取的设置 → **在设置页打开开关后毫无反应**（phase 不变就不重挂）。
- **命中后用过期闭包调 `startCall`**：捕获的是 effect 那次渲染的 `threadId`/`models`
  （与 09-12 快捷键「切了会话就用不了」同族 bug）→ 命中后可能报「请先打开一个会话」。
- **启动失败静默**：模型没下全 / 唤醒词为空时直接 `return`，用户看不到任何原因。

### 修复

| 项 | 改法 |
|---|---|
| 匹配 | 新增 `electron/voice/wake-match.ts`（纯逻辑）：**同音容错**匹配 —— 同音表由**音色模型自带的 `lexicon.txt`** 构建（`柯 ㄎ ㄜ ˉ` 与 `科 ㄎ ㄜ ˉ` 归为一类，去声调），零新依赖。实测 {20885 字 / 175ms}，缓存一次 |
| 匹配位置 | 搬到**主进程**（唤醒词、同音表、模型词表都在这边）：渲染层只收 `wake` 事件，`feedWakeAudio` 只回 `{ok, matched}`，不再每块回传整坨文本 |
| 端点复位 | 每次 `endpoint` 就 `reset`（旧实现从不复位）→ 文本不再跨句累积 |
| 预热 | `startWakeListener` 里 `await create`（旧实现把 154MB 模型加载拖到第一块音频上，实测整链 6.5s 全排在那时） |
| 即时生效 | `voice:settings-set` 保存后主进程广播 `{type:"settings"}`；渲染层 effect 依赖 `[phase, wakeCfg.enabled, wakeCfg.phrase]`；主进程侧唤醒词变了立刻重建匹配器 |
| 闭包 | 命中路径走 `startCallRef.current()`（每次渲染转发最新闭包），旧实现直接用 effect 捕获的 `startCall` |
| 背压 | 识别忙时把新块攒起来（上限 1s）合并发送，超限丢最旧（旧实现每块无条件 `invoke`） |
| 可见性 | 新增 `src/voice/wake-state.ts` 广播：设置页唤醒卡片显示「正在聆听 / **最近听到：xxx（未命中）** / 词表提示」；启动失败给出原因 |
| 提示 | 唤醒词含词表外字时给出 `phraseVocabHint`（「柯」不在词表 → 已用同音匹配兜住，想更稳可换常见字） |

### 端到端复验（跑编译产物里的 `VoiceService` 唤醒路径 + 本机真模型）

```
① startWakeListener → ok，hint：「柯」不在识别模型词表里…
② 先说「今天天气不错我们出去走走吧」→ matched=false（端点复位生效，不污染下一句）
③ 说「小柯小柯」→ 识别为「小咳小壳」→ ★ wake 事件（同音容错命中）
④ 说「小科小科」→ 识别为「小颗小颗」→ ★ wake 事件
⑤ 说「帮我看看这个项目的代码」→ matched=false（不误唤醒）
wakeHeard 诊断 4 条：今天天 | 小 | 小颗 | 帮我
```

**注意**：③④ 两条在旧实现下**全部漏唤醒**（识别结果里没有「小柯小柯」这四个字）——
这正是用户「好像不太行」的机制性原因。

### 仍未做
- **KWS 关键词模型**（`sherpa-onnx-node` 里有 `keyword-spotter.js`）：专用小模型（约 15MB）常驻 CPU 远低于现在复用 154MB 识别模型，命中率也更稳。需要新增一个模型下载项 + 安装流程 → **属产品决策，等用户确认**。
- 声母听错（「小柯小柯」→「小哥小哥」）无法靠后处理救：已**故意不匹配**（把 哥 算同音会让「小哥」天天误唤醒），靠「最近听到」诊断让用户换词。

## 反证清单（09-13 第二轮 + 唤醒专项，逐条改回 → 确认预检变红 → 恢复）

「永远绿的断言等于没有断言」（AGENTS.md 铁律 4）。第二轮 6 条接线守卫 + AEC 用例逐条反证过：

| 改回什么 | 预期变红的断言 | 实测输出 |
|---|---|---|
| `if (event.aborted) {` → `if (false) {` | ① 打断链路 | `aborted=false` 红 |
| 把 `await startCapture();` 挪到 `voiceStart` 之后 | ③ 开麦顺序 | `capture=27825 voiceStart=27791` 红 |
| 删掉回灌循环（`for (const block of pending) …`） | ③ 暂存/回灌 | `prebufferRef / liveRef / 回灌循环` 红 |
| `rule2: 0.8` → `rule2: 1.2` | ④ 延迟（默认值 + 迁移） | `rule2=false` 红 |
| `aecRef.current = useSelfAec` → `= true` | ⑤ 不叠加 NLMS | `noDouble=false` 红 |
| `text: \`${VOICE_MESSAGE_PREFIX}${text}\`` → `text: text` | ⑥ 来源标记 | `use=false` 红 |
| AEC 用例把噪声换回正弦（或故意不 `setDelay`） | ⑤ AEC 对齐 | 噪声+不校正：ERLE **−0.4dB**（校正 102.8dB）；正弦下错配也能「压 150dB」→ 用例作废 |

唤醒专项（`.tmp/counter-wake.mjs` apply/restore，5 条接线守卫 + 3 条同音正例）：

| 改回什么 | 预期变红的断言 | 实测输出 |
|---|---|---|
| `same()` 去掉同音查表（退回精确匹配） | 唤醒同音正例 ×3 | `小科小科 / 消客小客 / 滑窗` 三条全红 |
| effect 依赖退回 `[phase]` + 主进程不广播 settings | 配置即时生效 | `deps=false 广播=false 监听=false` 红 |
| 命中改回裸 `startCall()` | 闭包转发 | `ref=false 无裸调用=false` 红 |
| 去掉预热 + 端点复位 + 主进程匹配 | 主进程侧完整性 | `match=false reset=false 预热=false` 红 |
| 去掉背压（每块无条件 invoke） | 背压 | `没有背压` 红 |
| 启动失败分支改回静默 `return` | 失败可见 | `失败提示=false` 红 |

反证后已重新构建再跑正式那轮（`check` 0 硬失败 + `--only boot-history` 4/4）。
新增/改动断言的位置：`scripts/check-preflight.mjs` 的【4b】首句阈值、【4c】语音链路、【4d】语音唤醒。


| 项 | 改动 | 证据 |
|---|---|---|
| ① 打断还在念上一轮 | 渲染层 `speechEpochRef` 世代号（`stopPlayback`/`final`/被打断的 `turnDone` 都 +1，await 前后比对）；主进程 `turn/completed` 读 `turn.status`，`interrupted/failed` → `turnDone{aborted:true}`，渲染层不再 `flushSpeech` 而是作废断句器半句 | 预检【4c】「① 打断」守卫（**已反证**：把 `event.aborted` 分支去掉即红）；反证脚本 `.tmp/counter.mjs` |
| ② 念原始 markdown | 新增纯逻辑 `src/lib/speak-text.mjs`：块级状态机丢代码围栏/表格（各留一句占位）+ 行内清洗（markdown 记号/URL/邮箱/路径/emoji/反引号）+ 数字日期中文化（`2026-09-13`→二零二六年九月十三日、`12:30`→十二点三十分、`98%`→百分之九十八、`3.5`→三点五；`GPT-4`/`v2`/`1.2.3` 保持原样）。接在**断句之后、TTS 之前**，字幕仍显示原文 | 预检【4c】8 条朗读视图断言（跑真实现） |
| ③ 听写丢开头 1~3s | `startCall` 顺序反过来：**先开麦暂存**（上限 3s）→ 再 `voiceStart`（加载 154MB 模型 1~3s）→ 同步按序回灌后才切实时链路（`liveRef`，不用 phase state：state 落地晚一帧会丢块）；`finish` 补静音由写死 3.0s 改为 `rule2+0.3`；挂断后 ASR/TTS 线程**保活 90s**（`parkIdle`/`takeIdle`，配置指纹变了就丢弃重建），卸载模型与退出应用时 `disposeIdleWorkers()` | 预检【4c】3 条守卫（**已反证**：把顺序换回去即红） |
| ④ 端到端固定等 1.2s | `asr.rule2` 默认 1.2 → **0.8**，并加档案迁移（`VOICE_SETTINGS_VERSION=2`：只把「还是旧默认 1.2」的档案改掉，用户调过的不动）；首句阈值 `firstMaxChars` 18 → **10**；新增 `voice:endpoint-now`（partial 以 `。！？` 收尾 + 连续 500ms 低能量 → 立即提交，不等 `rule2`）；通话面板显示当前端点阈值 | 预检【4c】：rule2 默认 + 迁移 + 接线；【4b】首句阈值断言改为 ≤10 并加「阈值确实变小」对照 |
| ⑤ NLMS 对齐假设与现实不符 | 参考环 2s → **30s**，且改为「**读指针 + 播放领先量**」写入（旧的入队即写会在队列领先 >2s 时覆盖未读样本、永久失步）；领先量超出环容量则**丢弃该段参考**（宁可不消也不乱消）；`createAec` 新增 `maxDelay`/`setDelay`，按 `outputLatency‖baseLatency` 校正延迟线；**浏览器自带 AEC 开启时不启自研 NLMS**（`aec.mode=auto`，避免两级 AEC 叠加往麦克风注入失真） | 预检【4c】：新用例用**宽带噪声**+600 样本回声 —— 校正后 102.8dB / 不校正 −0.4dB（旧用例用正弦，任何延迟都等价于同频不同相，**测不出**这个问题） |
| ⑥ 引擎分不清语音/打字（用户新增要求） | 引擎协议里**没有**来源字段（`TurnStartParams` 22 个字段逐个查过；`turnTrigger` 只进遥测），故：文本前缀 `[语音] `（与 `electron/channel-bot.ts` 的 `[飞书用户 xxx]` 同一手法）+ `turnTrigger:"voice"`；**排队与 turn/start 两条路径共用同一个 `input`** | 预检【4c】「⑥ 来源标记」（**已反证**） |
| （顺带）⑥ 的前置：设置读晚了 | 麦克风/回声消除/音量/门控的设置读取整体上移到 `getUserMedia` **之前**（旧实现第一次通话必然用默认值，而且「是否启用自己的 NLMS」正是由它决定）；`mic.echoCancellation` 判据改用 `track.getSettings()` 的**实际生效值** | 预检【4c】「麦克风设置先读后用」 |
| （顺带）说话中不抢先 | 端点提前判定只在**未播报**时生效（播报中的能量是喇叭的声音）；回灌期间的音频只画电平、不做 AEC/门控 | 代码注释 + 【4c】守卫 |

**未做（需真机/需用户决策）**：⑦ worker 自愈（`rebuild()`）、⑧ ASR 热词/同音/标点/ITN、⑨ 渠道转写复用同一 ASR + Silero VAD 的去留、⑩ 语音埋点与验收项（`voice:metrics` + `userData/voice-call.log`）。
⑤ 的「外放/蓝牙实测」也需要真机 A/B（现在默认走浏览器 AEC3，可用设置里的「回声消除」开关或 `aec.mode` 复现两条路径）。

---

## 1. 打断之后它还会把上一轮念完（最直观的 bug，两条路径同时存在）
- 证据：`src/components/VoiceCallFloat.tsx:288` 每个 delta 都 `void speakDelta(piece)`（**无世代号**）
  → `:405` 合成返回后**无条件** `enqueuePlay`；`:411-420` `flushSpeech()` 无「是否刚被打断」判据，
  而 `:291-294` 只要收到 `turnDone` 就调它；`electron/voice/voice-service.ts:385-394` 的
  `turn/completed` 分支**不看 `turn.status`**，`barge()`（`:463-476`）发完 `turn/interrupt`
  后引擎回的完成事件照样走这条路；`stopPlayback`（`:379-391`）只清**已入队**的 source，
  管不到「已经在 TTS 线程里生成中」的请求。
- 机制：`chunkerRef` 只在挂断时销毁（`:548`），打断那刻缓冲里还有 ≤60 字半句；in-flight 的
  `voiceSpeak` 是 await 中的 IPC，打断后它才 resolve，回来直接入队播放 → 「我插话，它把刚才
  那半句念完（≤15 秒）」。
- 收益：打断立刻安静 —— 通话最基本的手感。风险：低。
- 改法：加 `speechEpochRef`，`stopPlayback()`/`barge()` 时 `+1`；`speakDelta`/`flushSpeech`
  在 await 前后比对 epoch，不一致即丢弃；打断时同时 `chunkerRef.current = null`（或加 `discard()`），
  `turn/started` 时重建。

## 2. 朗读的是原始 markdown：代码块 / emoji / URL / 路径都会被念出来
- 证据：`electron/voice/voice-service.ts:378-383`（delta 原样透传）、`:436-439`（`speak()` 只 `trim()`）；
  `src/lib/voice-aec.mjs:208` 把 `\n` 当硬断句符 → **代码块逐行念**；全仓无 emoji/markdown 清洗
  （`grep emoji|stripMarkdown` 在 `electron/` 只命中 `personalization.ts:149-160`，而那里反而**鼓励**
  模型多用 emoji）。TTS 侧也没规范化：`date.fst/number.fst/phone.fst` 随模型下了
  （`electron/voice/model-manifest.ts:66-68`），但 `workers.ts:157-168` 的 vits 配置只传
  `model/lexicon/tokens`，而本机绑定层 `sherpa-onnx-win-x64` 的 TTS 配置键表里**没有 `ruleFsts`**
  （只有识别器侧有）→ 三个 fst 是**死文件**，数字/日期读法不可控。
- 机制：语音轮刻意只用增量通道（AGENTS.md：「不复用 BotStreamSession」），但没补「给人听的文本」层。
- 收益：每条带代码/清单的回复少念几十秒噪音。风险：低。
- 改法：在 `speak()` 之前加一层**朗读视图**（去代码块或只念首行注释、删 markdown 记号/URL/路径/emoji、
  数字日期简单中文化）；**字幕仍显示原文**。

## 3. 语音输入（听写）每次按下都丢开头 1~3 秒
- 证据：`VoiceCallFloat.tsx:6533-6538`（keydown → `requestVoiceDictation({action:"start"})`）
  → `:619-620` `startCall("dictation")` → `:570-572` **先** `await window.codex.voiceStart(...)`
  （内部 `voice-service.ts:204` `await this.asr.request("create")` = 在工作线程加载 154MB int8 encoder）
  **再** `startCapture()`（`:446` 才 `getUserMedia`）。挂断时 worker 全 terminate
  （`voice-service.ts:226-234`）→ **每次按键都要重来**。松手还要灌 3 秒静音才出尾句（`workers.ts:69-79`）。
- 收益：按住即说不再丢字；松手到出字少 1.5~2s。风险：低。
- 改法：听写路径**先** `startCapture()` 并把块暂存（上限 ~3s），ASR `create` 完成后回灌；
  `finish` 静音从 3.0s 降到 `rule2+0.3`；给「松手后 N 秒内复用同一 ASR worker」加保活。

## 4. 端到端延迟拆解：固定地板 ≈1.3s，其中 **1.2s 纯等静音**
- 换算：块 1024/16000 = **64ms**（`src/voice/capture-worklet.ts:14-15`；`voice:audio` 走 send 无回包
  `electron/main.ts:610-612`；ASR 串行链 `workers.ts:298-301`）→ 端点判定 `rule2=1.2s`
  （`electron/voice/voice-settings.ts:42` → `workers.ts:40-42`；语义：已解出文字后尾静音 >rule2 成句，
  `rule1=2.4s` 只管「一直没说话」）→ 端点块返回即得文本（`:59-67` 流式增量解码，不重解码）→
  `finishUtterance` 复位流并提交（`voice-service.ts:313-364`，本地 IPC + 小文件，个位 ms）→
  **引擎首 token（代码里读不出，最大未知项）** → 首句需 **≥19 字**（`voice-aec.mjs:207` `firstMaxChars=18`）
  → 每句**整段**合成（无流式 TTS，`workers.ts:180-217`）→ base64 往返（`main.ts:620-631`，
  5s/22.05k ≈0.44MB→0.59MB 字符串；**RTF 无埋点**）→ `enqueuePlay` 用 `startAt=max(now,上句结束)`
  （`:360-376`）→ 设备输出延迟（Windows 共享模式 20~40ms、蓝牙 100~300ms，**代码里完全没补偿**）。
  floor = 1.2s + 64ms + 首块合成（18 字≈4s 音频 × RTF，估 0.4~1.3s）。
- 收益：`rule2` 调到 0.6~0.8 每轮省 0.4~0.6s；「停口 + partial 以句末标点结尾」提前端点再省 0.3~0.5s；
  首块 18→10 字再省 0.3~0.8s。风险：中（rule2 过低会截断长句内停顿）。
- 改法：① 默认 `rule2=0.8` 且通话页可见/可调；② 复用既有 `finish` op 加 `voice:endpoint-now`，
  渲染层在「连续 ~500ms RMS 低于阈值 **且** partial 以 。！？ 结尾」时调用；③ 首句阈值做 10 字（有软断点优先切）。

## 5. 自研 NLMS 的对齐假设与现实不符（且与浏览器内置 AEC 叠加）
- 证据：`VoiceCallFloat.tsx:476` `createAec({filterLength:512, delay:480, step:0.12})` →
  只覆盖 **30~62ms** 回声路径；`voice-aec.mjs:78-97` 的 `delay` 是**常量**、无延迟估计；
  参考信号在**入队时**写入（`:357-358`），而实际播放是 `source.start(startAt)`（`:360-376`）——
  队列领先量可远超环容量，环只有 `CAPTURE_RATE*2 = 2 秒`（`:163`），`pushRef`（`:315-321`）**无溢出保护**，
  写指针越过后**覆盖未读样本**，`refReadRef` 只按块推进（`:503-507`）→ 领先 >2s（TTS 生成快于播报时
  几秒内就会发生）时参考**永久失步**，直到挂断才复位（`:549-550`）。同时 `echoCancellation:true`
  本来就是默认约束（`:434-439`、`voice-settings.ts:43`）→ **浏览器 AEC3 已在跑**，第二级拿错参考做减法
  会**反向注入失真**。而预检的 AEC 用例用 `delay:32/filter:128`、回声延迟 40 样本
  （`scripts/check-preflight.mjs:394-400`），**恰好落在可覆盖区间** → 测不到这个失效模式。
- 收益：外放/蓝牙场景从「听不清 + 偶尔自打断」回到可用。风险：中（必须真机外放复测）。
- 改法：① 参考环放大到 ≥30s，且 `pushRef` 发现会覆盖未读样本时**丢弃该段参考**（宁可不消也不乱消）；
  ② 用 `playCtx.outputLatency||baseLatency` 校正 `delay`（或按 `startAt` 定时写参考）；
  ③ 若 `mic.echoCancellation === true`，**直接不启 NLMS、只留门控**（真机 A/B 一次即可定论）。

## 6. 麦克风设置第一次通话必然不生效（读在加载之后，晚一拍）
- 证据：`VoiceCallFloat.tsx:432` `const mic = micSettingsRef.current;` 用在 `:446` 的 `getUserMedia`，
  但设置是 `:478-482` 才读进来写回 ref；全文件只有这两处写 ref（153 声明、482 赋值）。
  ref 初值与默认设置恰好相同 → 「改过麦克风/降噪/AGC」的用户**第一次**通调用的是系统默认设备与默认开关，
  第二次才对；而同一函数后面的 `gateDb/volume/mic` 却当次生效，现象更迷惑。唤醒路径（`:674-676`）
  硬编码 `echoCancellation:true, noiseSuppression:true`，同样忽略设置。
- 收益：选的头戴麦/降噪第一次就生效（外放 + 自研 AEC 失配也随之缓解）。风险：低。
- 改法：把 `:478-483` 那段设置读取整体上移到 `:432` 之前（约 5 行搬家），唤醒路径读同一份设置。

## 7. worker 一死 → 通话僵尸态 + 按 16 次/秒刷错误（dead 粘性，不能自愈）
- 证据：`workers.ts:241` `dead` 只在死亡/terminate 时置真，`:253-254` `start()` 遇 dead 直接 return，
  `:284-286` 每次请求直接 reject → **无法重建**；`voice-service.ts:240-247` 每个音频块 catch 后 `fail()`
  （`:143-147` emit error + console.error）= 16 次/秒；渲染层 `VoiceCallFloat.tsx:295-298` 每次都 `setNotice`；
  `onDeath`（`voice-service.ts:188-190/198-200`）只写一句提示，**不结束通话、不释放麦克风**，
  用户必须手动挂断重开。ASR 串行链无长度上限（`workers.ts:298-301`），落后期累积后只能人工复位。
- 收益：线程崩溃从「通话废掉 + 报错刷屏」变成「一句提示 + 自动重建/干净收尾」。风险：低。
- 改法：`VoiceWorkerClient` 加 `rebuild()`（`dead=false` + 清 pending/chain + 重新 `start()`）；
  ASR 死亡时**先** `await this.stop()` 再 emit 一条明确 error，并给渲染层发 `state:"idle"`（界面回到可重拨）；重建最多试 1 次。

## 8. ASR 侧：无热词、无同音替换、无标点、无 ITN —— 项目名/路径/标识符是错误率最高场景
- 证据：`workers.ts:24-43` 只配 `greedy_search` + 端点，没传 `hotwordsFile`（`:392-393` 已声明支持）、
  没传 `hr`（同音替换，`types.js:375-378`）、也没接标点模型（`node_modules/sherpa-onnx-node/punctuation.js`
  就在包里）；识别结果进引擎前只有 `trim()`（`voice-service.ts:313-324`）。词表是通用 zh 模型
  （`model-manifest.ts:36-44`）→「voice-service.ts」「zh-CN」「app.asar」只能碰运气。
- 收益：说文件名/函数名/术语的可用性（语音输入最常被吐槽的场景）。风险：低（应用层）/中（切
  `modified_beam_search` 增 CPU 与延迟，需实测）。
- 改法：① 应用层后处理：用「工作区名 + 当前会话近期出现的文件名/标识符」做同音/近音替换，只作用于 `final`
  （字幕保留原文）；② 想上模型侧热词再接 `hotwordsFile + hotwordsScore`（须同时切 `modified_beam_search`，给开关）。

## 9. 资源：渠道语音转写会**再加载一份** ASR 模型；Silero VAD 下了却从没用过
- 证据：`voice-service.ts:272-310` `transcribeAudioFile` 每次都 `new VoiceWorkerClient` + `create`
  （= 再加载一份 154MB encoder），调用点在 `main.ts:2445` 渠道语音管线 → 通话中即 **+~250MB RSS**
  与 2 个线程抢核（正是「音频块积压/卡顿」的诱发条件）。VAD：`model-manifest.ts:46-52` 下载
  `silero_vad.onnx`，`voice-service.ts:125-130` 把它算进 `modelsReadyFlag`、`:610` 也下载，
  但全仓**没有任何加载代码** → 2MB 白下，且它下载失败会让整个语音功能被「模型未下载完整」挡住。
- 改法：① 渠道转写与通话共用一个 ASR 队列（通话中排队到 `turnDone` 之后，或复用同一 worker 的
  `feed/finish`）；② VAD 要么从 readiness 摘掉（仅作可选增强），要么真用来做「播报期前置门控 + 提交前裁静音」
  —— 它是最省算力的门控手段，比 NLMS 便宜几个数量级。

## 10. 可观测性：语音链路零埋点，验收里也没有语音项
- 证据：`grep performance.now|voiceTrace` 在 `src/voice`、`src/components/Voice*`、`electron/voice`
  **全无命中**；`main.ts:559-574` 的 `voiceLogs` 只进内存 50 条、**无 IPC 读取、不落盘**；
  `voice-crash.log`（`main.ts:183-202`）记的是**所有**渲染进程崩溃与主进程未捕获异常（名字叫 voice 但与语音无因果）、
  无轮转、UI 不呈现；`scripts/accept.mjs` 里 `voice*` 命中 **0**
  （AGENTS.md 提到的 `voice-call` / `voice-call-screen` 场景已随 e2e 目录删除）。
- 收益：第 1/4/5 条的所有数字（引擎 TTFT、TTS RTF、端点等待、失步、打断次数）现在只能靠用户口述，
  无法回归、也无法证明优化有效。风险：低。
- 改法：主进程加 `voice:metrics` 事件 + 环形日志（`userData/voice-call.log`，随 `voiceLogs` 落盘并加 IPC 读取），
  每次通话记：块数/丢弃数/ASR 链深度、`t_endpoint→t_submit→t_firstDelta→t_firstSentence→t_firstAudio`、
  打断次数、worker 重建次数、状态切换 reason；预检加「门控/AEC 参数与 `VoiceCallFloat` 实际取值同源」的接线断言
  （防止再出现「纯函数测的是 delay=32、线上是 480」这类脱钩）。

## 建议顺序（初版；①~⑥ 已于第二轮实施，见上表）

1（低风险、体感最强）→ 3（低风险、听写丢字）→ 6（5 行搬家）→ 2（朗读视图）→ 10（先有数字）→
4（延迟调参，需真机）→ 7（worker 自愈）→ 5（AEC，需真机外放 A/B）→ 8（热词/同音）→ 9（资源复用 + VAD）。

> 以上「初版分析」正文保留作为**决策依据与代码定位**；其中「改法」段落若与上表冲突，以**上表**（已实施版）为准。
