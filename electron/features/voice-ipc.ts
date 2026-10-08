/**
 * voice 域组合根（09-22：原 441 行 / 体内 49 条语句按序切成 3 段；
 * 10-03：外面包一层 defineFeature，改由组合表挂载）。
 *
 * ⛔ 顺序即契约：子段内含 hook 调用，调用顺序 == 原语句顺序 ⇒ 只能按文件名前缀顺序
 *    import / 调用 / 展开。
 * ⛔ bag 只是跨 part 的旁路，不是段间通道（段间走 `return` + 入参）。
 *
 * ── 10-03 插件化的两个关键决定 ─────────────────────────────────────────────
 * ① `voiceService` / `voiceModelsRoot` **不在这里传**，而是各段经 runtime-refs 延后取。
 *    原因：组合表的 `import "./composition.gen"` 在 main.ts 前部，而 `new VoiceService(...)`
 *    在其后数百行 —— 若沿用旧签名 `registerVoiceIpc({ voiceService, voiceModelsRoot })`，
 *    组合表就得自己造这两个值，唯一办法是从 main.ts import ⇒ **反向依赖**（守卫【132】会红）。
 *    延后取之后，voice 域对 main.ts 零依赖。
 * ② 三段的 `ipcMain.handle` 全部改 `ipcHost.handle`；`voice:audio` 用 `ipcHost.on`
 *    （高频单向流，且必须能被卸载摘除 —— `ipcMain.on` 摘不掉）。
 */
import { registerVoiceIpc1 } from "./voice-ipc/01-voice-hotkey-models";
import { registerVoiceIpc2 } from "./voice-ipc/02-voice-profiles-presets";
import { registerVoiceIpc3 } from "./voice-ipc/03-voice-misc";

import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import type { HostCaps } from "../runtime/seams";

/** voice 域全部通道（卸载时逐条摘除；`voice:audio` 是 on 型，其余是 handle 型）。 */
const VOICE_CHANNELS = [
  "voice:status", "voice:settings-get", "voice:settings-set", "voice:start",
  "voice:dictation-finish", "voice:endpoint-now", "voice:stop", "voice:audio",
  "voice:speak", "voice:preview-voice", "voice:hotkey-set", "voice:hotkey-get",
  "voice:wake-start", "voice:wake-audio", "voice:wake-reset", "voice:wake-stop",
  "voice:barge", "voice:playback-done", "voice:models-status", "voice:zipvoice-install",
  "voice:zipvoice-cancel", "voice:kws-install", "voice:kws-cancel", "voice:kws-status",
  "voice:profiles-list", "voice:preset-list", "voice:preset-apply", "voice:profiles-import",
  "voice:profiles-record", "voice:profiles-save", "voice:profiles-delete",
  "voice:profiles-select", "voice:profiles-preview", "voice:profile-upload", "voice:models-install",
  "voice:models-cancel", "voice:models-import", "voice:models-reveal",
  "voice:models-uninstall", "voice:mic-permission", "voice:resource-set-enabled",
  "voice:resource-delete", "voice:resource-status",
];

export const voiceFeature = defineFeature<null>({
  id: "voice",
  inject: ["ipc", "host"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    const host = ctx.get<HostCaps>("host");
    if (!ipcHost) throw new Error("voice: 缺少 ipc 服务（宿主未提供）");
    if (!host) throw new Error("voice: 缺少 host 接缝（宿主未提供）");
    const a = registerVoiceIpc1({ ipcHost, host });
    registerVoiceIpc2(a);
    registerVoiceIpc3(a);
    ctx.effect(() => {
      for (const ch of VOICE_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
