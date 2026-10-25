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

/** 开启/关闭二选一（调用方只给布尔）。 */
export function voiceCallNoticeText(active: boolean): string {
  return active ? voiceCallOnNoticeText() : voiceCallOffNoticeText();
}
