/**
 * VoiceAnnounceBridge —— 播报板块的**挂载件**（null 渲染）。
 *
 * 为什么单独一个 null 组件：shell（AppView）只要加一行就能把播报挂起来，且
 * 「挂在哪、挂几次」一眼可见 —— 本模块依赖模块级订阅（announce-bus），一旦被挂两次
 * 就会**念两遍**。与 VoiceCallFloat / VoiceSettingsBridge 同一套做法。
 */
import { useVoiceAnnounce } from "./use-voice-announce";

export function VoiceAnnounceBridge(): null {
  useVoiceAnnounce();
  return null;
}
