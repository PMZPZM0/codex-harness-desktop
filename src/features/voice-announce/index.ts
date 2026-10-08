/**
 *voice-announce 域 · 公开面（barrel）。别的域只许从这里 import（架构规则 §1）。
 *
 * ⭐ 只出这一个挂载件：播报的**事件源**是 `src/voice/announce-bus.ts`（事件路由往里发），
 *   **开关**在主进程 voice-settings.json，**设置 UI** 是 `src/components/VoiceSettingsSection/10-announce.tsx`
 *   （设置页是既有基座组件，不反向 import 域）。要让播报支持新模式，加的是
 *   总线的 `AnnounceEvent` 联合类型 + 本域 hook 的一个分支，对外接口不变。
 */
export { VoiceAnnounceBridge } from "./VoiceAnnounceBridge";
/** 「播报中」状态条（贴在输入框上方，带停止按钮）—— 挂载点＝ composer，因为它要按 `.composer-wrap` 定位。 */
export { VoiceAnnounceIndicator } from "./VoiceAnnounceIndicator";
/** 事件路由的接缝：把引擎事件翻成播报事件（当前会话才转发）。 */
export { publishEngineAnnounce } from "./engine-bridge";
