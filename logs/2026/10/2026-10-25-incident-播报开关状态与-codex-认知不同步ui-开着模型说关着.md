---
id: 2026-10-25-incident-播报开关状态与-codex-认知不同步ui-开着模型说关着
date: 2026-10-25
kind: incident
area: voice
title: 播报开关状态与 Codex 认知不同步（UI 开着、模型说关着）
tags: [voice, announce, sync, notice]
commits: []
files: [src/voice/announce-bus.ts, src/features/app-view/helpers/components.tsx, src/features/voice-announce/use-voice-announce.ts, src/features/app-view/AppView.tsx, scripts/guards/11z-voice-call.mjs]
importance: normal
---

# 播报开关状态与 Codex 认知不同步（UI 开着、模型说关着）

## 背景
用户截图：语音播报 UI 明明开着，Codex 却回答「本会话的语音播报是关着的……今天凌晨 05:52
这个会话的播报开关被关掉了」。用户判断「不是实时同步开关生效的」。

## 根因
- 模型对播报状态的认知只来自**几条历史告知**，而旧实现只在「总开关」于当前窗口发生翻转时
  才调用 `notifyAnnounceToggle(enabled)`：
  · **会话级喇叭（Codex 名字后的 📢）的关闭/恢复从不告知模型**；
  · 总开关在别的会话里被改 / 应用重启后，本会话收不到恢复告知；
  · 于是模型永远记着历史里最后一条 OFF，UI 却已经恢复成 ON。

## 结论
- 有效状态 = **总开关 ∧ 本会话未静音**，放在 `announce-bus`：
  `setAnnounceGlobalEnabled` + `subscribeAnnounceGlobalEnabled`，
  会话静音继续走 `setAnnounceMutedForThread` 的订阅。
- 告知桥同时订阅两者：有效状态变化就发一条；每个会话把「最后一次已告知的状态」落
  localStorage（`announce-notice-state-v1`），切会话/重启时用于对账。
- 切会话时用**最近 40 回合里最后一条 ON/OFF 告知**做基线（优先于持久记录）：
  UI 已恢复但历史最后一条是 OFF ⇒ 明确补一条 ON，纠正模型认知。
- 新会话第一次知道状态时**只记账不发送**（避免每条新会话都弹告知、白触发一轮「收到」）。

## 依据
- CDP 实测：会话级 📢 关闭 ⇒ 出现「【语音播报已关闭】」，恢复 ⇒ 出现「【语音播报已开启】」；
  把主进程静音态清掉、localStorage 伪造成「已告知 ON」后重载，仍按历史最后一条 OFF 补发 ON
  （notice 记录回到 true）。
- 守卫 11z 199/199；tsc / vite build 通过。

## 影响面
语音播报的**状态告知链**（总开关 + 会话级静音）；不改变播放/合成逻辑，也不改总开关本身。

## 回滚
恢复 `notifyAnnounceToggle` 单点通知与旧桥即可；守卫 11z 两条同步回退。
