/**
 * 实时语音 · 会话告知文案（10-08 用户要求）：
 *   「为实时语音功能增加开启与关闭语音通话的状态并在对话框中发送通知，让 Codex 能感知何时开启了实时语音」
 *   「实时语音场景下采用快问快答模式：先直接回答问题，然后再给出思考过程，不要先思考后回答」
 *
 * ⛔ 为什么是渲染层文案而不是主进程：发进对话的那条消息由**渲染层**发（`pendingCommandTextRef` + `send()`，
 *   与调度开关的「【调度已开启】」同一条通路），主进程那条路要新开 IPC 通道（manifest → gen:ipc →
 *   registry + count）—— 为一段静态文案不值当。
 * ⛔ 单一真相源：**只在**这里拼文案；`electron/developer-instructions.ts` 的判据按这里的
 *   `VOICE_CALL_ON_TAG` 常量对齐（守卫【288】两边一起钉，改了这里不改那边就会红）。
 * ⛔ 纯函数、不 import electron / 不碰 DOM ⇒ 守卫可以直接 import 它跑真值表。
 */

/** 开启时的标签。⛔ 这个字面量是**跨文件契约**：引擎侧指令用它判断「本会话在语音通话中」。 */
export const VOICE_CALL_ON_TAG = "【实时语音已开启】";
/** 关闭时的标签。 */
export const VOICE_CALL_OFF_TAG = "【实时语音已结束】";

/** 关闭语音通话、回到文字对话时发的那条。 */
export function voiceCallOffNoticeText(): string {
  return [
    `${VOICE_CALL_OFF_TAG}本会话已挂断实时语音，回到普通文字对话。`,
    "之前那条「先给结论、再说过程」的口语化要求随之失效 —— 按平时的写法回答即可。",
    "收到请只回复「收到」两个字，不要展开。",
  ].join("\n");
}

/** 开启语音通话时发的那条（含「快问快答」指令）。 */
export function voiceCallOnNoticeText(): string {
  return [
    `${VOICE_CALL_ON_TAG}本会话已开始实时语音通话，你的回答**会被念出来给用户听**。`,
    "请按「快问快答」组织输出：**第一句就给结论/答案** —— 一到两句、口语、能直接念出来；",
    "然后再另起一段补充推理过程、依据或细节。",
    "⛔ 不要先说「让我想想」「我先分析一下」这类铺垫：用户是先听到第一句的，铺垫听起来像你在发呆。",
    "⛔ 代码块与表格在朗读时会被跳过（用户看屏幕），所以结论里不要只放代码。",
    "收到请只回复「收到」两个字，不要展开。",
  ].join("\n");
}

/**
 * 语音播报的开关标签（10-09 用户：「让 Codex 知道这个功能与能力」）。
 *
 * ⛔ 同样是**跨文件契约**：引擎侧第 16 条指令按这两个标签判断「这一轮要不要写 ```voice 播报稿」
 *    （`electron/developer-instructions.ts`），守卫 11z 两边一起钉。
 * ⛔ 为什么也用告知而不是「每轮去重说一遍」：播报是两个**应用级**开关（设置 → 语音通话 → 语音播报），
 *    开关一翻就该让当前会话立刻知道 —— 走与实时语音同一条已验证通路最省事，也让"什么时候该写"
 *    这件事在会话里有据可查（模型看得到上下文）。
 */
export const VOICE_ANNOUNCE_ON_TAG = "【语音播报已开启】";
export const VOICE_ANNOUNCE_OFF_TAG = "【语音播报已关闭】";

/** 语音播报开关的那条告知（`voiceAnnounceNoticeText` 按真假二选一）。 */
export function voiceAnnounceNoticeText(enabled: boolean): string {
  /* ⛔ 这里（含本注释）**不能**写出真正的 voice 围栏做示例：这条告知会作为**用户消息**渲染，
     而 `Markdown.tsx` 会把 voice 围栏整块剥掉（它对耳朵不对眼睛）⇒ 示例连同它前面的解释
     一起在屏幕上消失，用户看到的是半截话。⇒ 用「三个反引号 + voice」的文字描述，
     精确格式见 `electron/developer-instructions.ts` 第 16 条（那里不会被渲染）。
     （守卫 11z ⑫ 直接检查本函数体里没有三个连续反引号。） */
  return enabled
    ? [
        `${VOICE_ANNOUNCE_ON_TAG}从这一轮起，你的回复除了显示在屏幕上，还会**念出来给用户听**。`,
        "请在每条回复的**最后**写一段「播报稿」：一个语言标 voice 的围栏块（三个反引号 + voice 开头，再",
        "三个反引号收尾），块里写你要念的话 —— 它**只给耳朵**，屏幕上不会显示。",
        "⛔ 要求：口语中文、一到三句、**按当时该有的语气说**（松了口气 / 抱歉 / 来劲都可以），别念成干巴巴的总结；",
        "不要复述正文，说这次回答**到底给了什么**（结论 / 代价 / 下一步）；不要 markdown、列表、表格、代码。",
        "用户随时可以停止播报，所以短而准比完整更重要。",
        "收到请只回复「收到」两个字，不要展开。",
      ].join("\n")
    : [
        `${VOICE_ANNOUNCE_OFF_TAG}本会话不再念你的回复，回复最后那段「播报稿」（voice 围栏块）也随之作废`,
        "—— 请从这一轮起不要再写它（写了也不会被念，只会白费篇幅）。",
        "除此之外照常回答即可。收到请只回复「收到」两个字，不要展开。",
      ].join("\n");
}

/** 开启/关闭二选一（调用方只给布尔）。 */
export function voiceCallNoticeText(active: boolean): string {
  return active ? voiceCallOnNoticeText() : voiceCallOffNoticeText();
}
