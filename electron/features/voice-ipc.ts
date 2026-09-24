/**
 * registerVoiceIpc —— **组合根**（09-22：原 441 行 / 体内 49 条语句按序切成 3 段）。
 * ⛔ 顺序即契约：子段内含 hook 调用，调用顺序 == 原语句顺序 ⇒ 只能按文件名前缀顺序 import / 调用 / 展开。
 * ⛔ bag 只是跨 part 的旁路，不是段间通道（段间走 `return` + 入参）。
 */
import { registerVoiceIpc1 } from "./voice-ipc/01-voice-hotkey-models";
import { registerVoiceIpc2 } from "./voice-ipc/02-voice-profiles-presets";
import { registerVoiceIpc3 } from "./voice-ipc/03-voice-misc";

import { VoiceService } from "../voice/voice-service";

export function registerVoiceIpc(deps: { voiceService: VoiceService; voiceModelsRoot: string }) {
  const a = registerVoiceIpc1(deps);
  const b = registerVoiceIpc2(a);
  const c = registerVoiceIpc3(a);

}
