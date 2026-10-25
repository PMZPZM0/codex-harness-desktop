---
id: 2026-10-25-change-语音悬浮球角色改为-grok-bot-脸
date: 2026-10-25
kind: change
area: voice
title: 语音悬浮球角色改为 Grok Bot 脸
tags: [voice, ball, skins, grokbot]
commits: []
files: [src/lib/voice-ball-styles.mjs, src/components/VoiceMascot.tsx, src/components/VoiceCallFloat.tsx, src/components/VoiceSettingsSection/06-floating-ball.tsx, src/styles/18-openai-dialog.css, scripts/guards/11z-voice-call.mjs, scripts/guards/03-runtime-boot.mjs]
importance: normal
supersedes: 2026-10-25-change-语音悬浮球内置-6-套外观可切换
---

# 语音悬浮球角色改为 Grok Bot 脸

# 语音悬浮球角色改为 Grok Bot 脸

## 背景
上一轮按「多内置一些好看的」做了 6 套**只换光晕/底盘**的皮肤，用户看后纠正：
「我是让你里面的样式，gorkbot 那种样式，不是让你加个光圈特效就完事，用点心」。
要求改的是**球里面的角色本体**，不是外圈特效。

## 结论
- 角色本体从旧的「多色渐变 3D 球 + 两颗发光圆点」改为 **Grok Bot 式极简机器人脸**：
  大圆脸、两颗**竖直胶囊形**眼睛（无瞳孔/眼白/高光/睫毛）、两颊椭圆腮红，
  **没有鼻子和嘴**；状态只动表情（眨眼 / 聆听睁眼 / 思考眯眼 / 播报腮红呼吸）。
- 6 套外观全部重做为**脸/眼/腮红配色 + 一个小配件**：
  墨黑（默认）/ 奶油 / 薄荷（小芽）/ 蜜桃（星星）/ 天蓝（天线）/ 月白（光环）。
  `DEFAULT_VOICE_BALL_STYLE = "ink"`；未知/旧值（glass/aurora…）统一回落 ink，
  用户档案里上一轮选过的旧 id 不会炸。
- 设置页「悬浮球」卡片的预览从色球改为**真实角色小头像**（`<VoiceMascot skin>`），
  选哪套一眼看到脸；选中写回 `ball.style`，悬浮球经同一设置广播即时切换。
- 旧的 `.voice-mascot-orb` / `.orb-eye` 样式与 DOM 整体删除，守卫改为负向防复活。

## 依据
- CDP（持久 profile）：设置 → 语音通话 → 悬浮球显示 6 张角色卡、6 个 `.voice-bot`；
  点「薄荷」后 active=薄荷、预览脸背景 `rgb(191, 232, 216)`，右下角悬浮球同步切成薄荷（带小芽）。
- 悬浮球实读：`voice-bot--skin-ink` 脸 `rgb(23,21,26)`、眼 `rgb(248,250,252)`、2 眼 + 2 腮红。
- 守卫 11z 204/204（含「胶囊眼 3×9 + 全圆角」「无鼻子/嘴/旧球」断言）、03 退出码 0；
  tsc 与 vite 构建通过。

## 影响面
仅语音悬浮球角色 / 设置页悬浮球卡片；通话舞台条同一组件，因此同步换成新脸。
播报、音量联动、拖拽、右键菜单与设置广播逻辑均未改。

## 回滚
还原 `VoiceMascot.tsx` 与 18 号 CSS 的 `.voice-mascot-orb` 段，目录恢复旧 id 与默认值，
并把守卫 11z/03 的外形断言改回；`ball.style` 字段保留（旧 id 可回落）。

## 后续修正（同日）
用户看真机后一句「眼睛太小了吧」⇒ 胶囊眼改为**按脸尺寸的百分比**：宽 16% / 高 34%
（原固定 3×9px，在 34px 悬浮球上只有 9% 宽），腮红下移到 72% 并缩到 18×9%，
不再与眼睛重叠。28px 设置页预览与 34px 悬浮球同比例缩放；聆听/思考态同步改百分比。
CDP 实测 37.4px 脸：眼 6.6×12.1（原 3×9），截图确认接近 Grok Bot 原图比例。
