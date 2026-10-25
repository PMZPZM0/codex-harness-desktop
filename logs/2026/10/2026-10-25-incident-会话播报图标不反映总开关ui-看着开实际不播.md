---
id: 2026-10-25-incident-会话播报图标不反映总开关ui-看着开实际不播
date: 2026-10-25
kind: incident
area: voice
title: 会话播报图标不反映总开关，UI 看着开实际不播
tags: [voice, announce, icon, ux]
commits: []
files: [src/features/voice-announce/SessionAnnounceToggle.tsx, src/components/VoiceCallFloat.tsx, src/voice/announce-bus.ts, scripts/guards/11z-voice-call.mjs]
importance: normal
---

# 会话播报图标不反映总开关，UI 看着开实际不播

## 背景
用户再次截图：「明明开着，还说关的」。查本机真实配置 `voice-settings.json`：
`announce.enabled = false`（总开关就是关的），而会话头 📢 图标只按「本会话 muted」显示，
所以是**开着的形状**；模型读到作用域块「已关闭」并回答关闭，逻辑本身是对的，错的是 UI。

## 结论
- 📢 图标与悬浮球菜单改为按**有效状态**（总开关 ∧ 本会话未静音）显示：
  总开关关 ⇒ 直接显示划掉，悬浮球菜单显示「开启播报」。
- 总开关关着时点击 📢 = **直接把总开关打开**（`voiceSettingsSet({announce:{enabled:true}})`），
  不再只是提示「去设置」；本会话静音由设置广播联动解除。
- 隐藏注入继续按有效状态写「已开启/已关闭」，因此打开后下一条消息模型就会知道。

## 依据
- 真实 `voice-settings.json` 实查 `announce.enabled=false`；rollout 里注入块确实写「已关闭」。
- 守卫 11z 197/197（新增：图标读总开关、点击开启、悬浮球文案三态）。

## 影响面
只影响播报状态在 UI 上的显示与 📢/悬浮球菜单的点击语义；播放与开关存储逻辑不变。

## 回滚
恢复 📢 只看 muted、点击只切会话静音，并删掉悬浮球的「开启播报」分支与守卫对应断言。
