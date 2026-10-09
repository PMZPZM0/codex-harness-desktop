---
id: 2026-10-09-change-播报收成一个总开关只念codex写的播报稿
date: 2026-10-09
kind: change
area: voice
title: 播报收成一个总开关只念Codex写的播报稿
tags: [voice, announce, settings, contract]
commits: []
files: [electron/voice/voice-settings.ts, src/features/voice-announce/use-voice-announce.ts, src/components/VoiceCallFloat/use-voice-call-float-state.tsx, src/lib/voice-summary.mjs, src/voice/announce-bus.ts]
importance: high
---

# 播报收成一个总开关只念Codex写的播报稿

# 播报收成一个总开关：只念 Codex 写的内容，不再念正文与汇总

## 用户令（两条连续）

1. 「改成 Codex 写什么播报什么吧，运行的正文和汇总正文不用播报了」
2. 「设置里面功能开关同步更新，只播报 Codex 写的内容」
   + 追问后拍板：**两个开关收成一个总开关**（而不是保留两个只改行为）。

## 判决表（改前 → 改后）

| 来源 | 改前 | 改后 |
|---|---|---|
| 运行中**正文**（流式逐句） | 非通话逐句念 / 通话逐句念 | **非通话整条删除**；通话**保留**（电话里必须把回复念出来），由总开关门控 |
| 结束**本机压缩汇总** | 两条链路都念（`summarizeForSpeech`） | **整条删除**（压缩器与 `SUMMARY_*` 常量一起下线） |
| **Codex 写的播报稿** | 非通话：优先念；通话：不念（还被当正文读出来过） | 两条链路都在回合结束念；没写就**什么都不念** |
| **`voice_announce` 主动插播** | 立即念（开关无关） | 不变 |

⚠️ **通话里原本有个真 bug 顺带修掉**：通话的正文朗读**没有过播报稿剥离器**，而模型一旦写 `voice` 围栏块，
它会把围栏行与整块稿当普通正文念出来（「反引号反引号…」）。现在通话也先剥离再断句
（`scriptStripperRef`），那块改由回合结束时念一次。

## 设置（这一处是用户点名要「同步更新」的）

- `electron/voice/voice-settings.ts`：`announce: { live, summary }` → **`announce: { enabled }`**，
  默认 `true`（与旧 `live` 默认一致 —— 升级不改开关状态）。
- **版本 3 → 4 + 迁移**：老档案的 `{live, summary}` 平移成 `enabled = live !== false || summary === true`
  （判据与旧默认同源：任一为真即"播报开着"）。
  ⛔ 不迁移的话老用户进设置页会看到开关是"关着"的（`enabled` undefined）。
- `mergeSettings` 显式映射 + 兼容旧形状；`src/components/VoiceSettingsSection.tsx` 的类型、
  `10-announce.tsx` 卡片（**一个**复选框 + 重写文案）、`vite-env.d.ts` 声明三处同轮。
  ⛔ 那个声明在**生成段**里 ⇒ 改 `ipc-channels.manifest.json` 再 `npm run gen:ipc`（禁手改生成物）。

## 代码落点

- `src/lib/voice-summary.mjs` 瘦身成**只剩 `splitSentences`**（播报去重靠它按句对齐）；
  `summarizeForSpeech` / `SUMMARY_MAX_CHARS` / `SUMMARY_PREFIX` / `SUMMARY_EMPTY_NOTICE` 全删，
  对应的 `.d.mts` 同步。
- `resolveAnnounceSummary` 改成**只认播报稿**（返回 `{ text, present }`）：没稿 ⇒ 空，调用方什么都不念
  （原来那条 "整段是代码就看屏幕" 的兜底文案一并不再需要）。
- `src/voice/announce-bus.ts`：`AnnounceEvent` 去掉 `delta` 变体、`source` 去掉 `live`
  （⛔ **不是留个没人订阅的死契约**）；`engine-bridge` 同步不再转发正文 delta。
- `use-voice-announce.ts`：删掉剥离器/断句器/`feedDelta` 与"尾巴 flush"整段；`finishTurn` 只剩
  「解析播报稿 → 念」。**保留**串行链、背压、世代号、句子级去重、停止出口、会话闸。
- `VoiceAnnounceIndicator.tsx`：来源文案「正在念正文 / 正在念小结」→「正在念播报稿」。

## 判据

- 守卫 `11z-voice-call` **106 → 113/113**：新增单开关/版本迁移/通话剥离顺序/结束只念稿/
  非通话无正文链/总线无 delta/状态来源无 live/压缩器不许复活 等；**真跑** 裁决点 3 条 + 流式剥离 1 条。
- 变异测试 **3 条全抓**：① 把"本机压缩回退"加回去 ⇒ 红；② 总线加回 delta ⇒ 红；
  ③ 通话拿掉剥离器 ⇒ 红。
  ⛔ ③ 第一次**没抓住**（假绿）：顺序断言用 `indexOf(...) < indexOf(...)`，锚被删掉时返回 -1，
  `-1 < x` 恒真 —— 已改成「先确认两个锚都 > 0 再比顺序」，重做变异后确实红。
- `npm run check` 0 硬失败（含 `gen:ipc` 重跑后生成物一致）；`accept --only settings-pages` **2/2**
  （30 个设置页逐页打开无 ErrorBoundary —— 改了语音页卡片，必须过）。
- 结构棘轮 `09-structural` 的 `use-voice-call-float-state.tsx` 基线 858 → **872**（实测净代码行）。

## 诚实边界

- 通话里"正文照念"**没有**删（那是通话本身，删了电话就哑了）；用户问的两条（正文/汇总）指的是
  非通话的播报链路，通话链只去掉了汇总、并修了围栏被念出来的 bug。
- 「只播报 Codex 写的内容」在通话里表现为：正文（= Codex 写的回复）照念 + 结束念它写的播报稿。
  若将来要让通话也"只念播报稿而不念正文"，那是另一个产品决定（会改变通话体验），需要单独拍板。
