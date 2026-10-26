---
id: 2026-10-26-milestone-ppcode-v016-发版-两个假红教训路径拼重-dist-过期
date: 2026-10-26
kind: milestone
area: release
title: PPcode v0.1.6 发版 + 两个假红教训（路径拼重 / dist 过期）
tags: [release, ppcode, v0.1.6]
commits: [7ecea4f5]
files: [D:/PPcode/docs/releases/v0.1.6.md]
importance: normal
---

# PPcode v0.1.6 发版 + 两个假红教训（路径拼重 / dist 过期）

## 结论

PPcode v0.1.6 已发布（tag 已推，CI 三端构建中）。范围 `v0.1.5..HEAD` = 265 提交（91 feat / 84 fix）。

## ⛔ 一次自己的假结论（写下来防复发）

查「PPcode 有没有办公室 / 新人引导 / Kokoro」时，我下了三条**错命令**，得出「PPcode 没有这些」
的错误结论，用户当场反问「不是同步修改的嘛」：

1. `for f in "src/features/team-office" ...; do ls src/features/$f ...` —— 路径**拼重了**
   （`src/features/src/features/...`），必然找不到；
2. Kokoro 搜的是 `src/features`，实际在 `src/components/VoiceSettingsSection/02-tts-engines.tsx`；
3. 第三个 `ls` 的参数是 `electron/team-office`（不存在），整条命令报错后没看 stderr。

实测：`src/features/team-office` ✓、`src/features/profile-onboarding/ProfileOnboardingWizard.tsx` ✓、
Kokoro 三卡 ✓ —— **三仓同步是完整的**。

## ⛔ 守卫 11r 假红 5 条 = dist-electron 过期

改了 `electron/whats-new-notes.ts` 但没重建就去跑守卫 ⇒ 探针 require 的
`dist-electron/features/whats-new-ipc.js` 还是旧产物（里面没有 0.1.6 条目）⇒
`freshNoShow / hasItems / upgradeShows / ackedNoRepeat / prevRecordUpgrade` 全红。
`npm run build:electron` 之后 **25/25**。顺序：改版本/要点 → 重建 → 跑守卫。

## 发版材料

- version 0.1.5 → 0.1.6（package.json + lock 两处；0.1.5 在 lock 里恰好 2 处，无依赖撞号）
- whats-new 新增 0.1.6 条目 8 条（守卫 11r 上限 3~8）
- `docs/releases/v0.1.6.md` 新写（CI **缺这个文件会直接失败**，见 release.yml 66-68 行）

判据：`npm run build` ✓ · `npm run lint` ✓（仅历史 eslint-disable 警告）· 守卫 11r 25/25 · 守卫 22 通过
提交：PPcode `7ecea4f5` + tag `v0.1.6`；主仓 v0.0.50 构建同期在跑。
