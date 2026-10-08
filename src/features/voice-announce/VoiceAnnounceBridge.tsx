/**
 * VoiceAnnounceBridge —— 播报板块的**挂载件**（null 渲染）。
 *
 * 为什么单独一个 null 组件：shell（AppView）只要加一行就能把播报挂起来，且
 * 「挂在哪、挂几次」一眼可见 —— 本模块依赖模块级订阅（announce-bus），一旦被挂两次
 * 就会**念两遍**。与 VoiceCallFloat / VoiceSettingsBridge 同一套做法。
 *
 * ⛔ `threadId` 是**会话闸**：`voice_announce` / `voice_announce_stop` 走的是主进程广播
 *   （`harness:event`，全窗口都会收到），不比对会话 id 的话，另一个窗口/另一个会话的插播
 *   会在当前会话里一起念出来。
 */
import { useVoiceAnnounce } from "./use-voice-announce";

export function VoiceAnnounceBridge({ threadId = "" }: { threadId?: string }): null {
  useVoiceAnnounce(threadId);
  return null;
}
