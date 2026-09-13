# 语音（通话 + 语音输入）审计 · 2026-09-13

> 提问：现有语音输入 / 语音通话还有哪些可优化。
> 结论：**架构选对了**（全本机离线 sherpa-onnx；渲染层采集/AEC/门控/断句/播放，主进程只编排，
> ASR/TTS 全在 `worker_threads`；通话轮 `effort=low`），但缺两样东西：**量化**与**给人听的文本层**。
> 下面按「用户可感知收益」排序，每条带证据、机制、收益、风险、最小改法。

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

## 建议顺序
1（低风险、体感最强）→ 3（低风险、听写丢字）→ 6（5 行搬家）→ 2（朗读视图）→ 10（先有数字）→
4（延迟调参，需真机）→ 7（worker 自愈）→ 5（AEC，需真机外放 A/B）→ 8（热词/同音）→ 9（资源复用 + VAD）。
