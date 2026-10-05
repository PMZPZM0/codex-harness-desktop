---
id: 2026-10-05-incident-办公室背景白屏真根因bg-webp超内联阈值拆成独立文件file下404
date: 2026-10-05
kind: incident
area: team-office
title: 办公室背景白屏真根因：bg.webp 80KB 超内联阈值被拆成独立文件，构建版 file:// 下 404
tags: [team-office, vite, assets-inline, file-protocol, latent-bug]
commits: []
files: [src/features/team-office/OfficeCanvas.tsx, scripts/guards/11d-office-screen.mjs, scripts/guards/06-app-behavior.mjs]
importance: normal
---

# 办公室背景白屏真根因：bg.webp 80KB 超内联阈值被拆成独立文件，构建版 file:// 下 404

## 结论

用户 10-05 报「办公室预览怎么白了」（截图：白底 + 显示器深色块 + 人物正常）。
根因**不是当天任何改动**：`bg.webp` 80,342 字节 > vite 全局 `assetsInlineLimit`(64KB)
⇒ 被拆成独立文件 `/assets/bg-*.webp`；打包/构建版用 `loadFile(dist/index.html)`（file://），
绝对路径 `/assets/...` 解析到**盘根** ⇒ 404 ⇒ `loadImage` onerror → resolve(null) → 不画背景 ⇒ 白底。
人物 PNG 小于阈值被内联成 data:、显示器是程序化绘制 —— 所以**只有背景白**，这个组合正是判据。

## 依据

- `vite.config.ts` 注释白纸黑字：素材必须内联成 data: URI（file:// 上 fetch 被协议层拒绝），
  阈值 64KB 是为 drama-canvas 素材定的 —— bg.webp（09-30 v19 像素办公室引入）恰好超了它。
- ⛔ **为什么拖了五天才发现**：09-30 之后 10-04 的办公室修复全在 **dev 模式**验证
  （vite dev server 供图，`/assets/...` 正常）—— 构建版才复现的坑，dev 里永远假绿。
  这与 0.0.27 死块事故、drama-canvas 白方块是**同族坑第三次**。

## 修法与判据

- `OfficeCanvas.tsx`：`import bgUrl from "./assets/bg.webp?inline"`（强制 data: URI，vite 8 支持）。
- 守卫【screen】+2：① 源码必须 `bg.webp?inline`；② **dist/assets 不许出现 bg-*.webp 独立文件**
  （产物层哨兵，内联失效必红）。变异测试 2/2 命中。
- 【233】资产断言锚点同步 ?inline 形态（旧锚 `from "./assets/bg.webp"` 被新写法打破）。
- EXPECTED_CHECKS 3180 → 3182。

## 教训

**凡 canvas/JS import 的素材，改完后必须看一眼 dist/assets 有没有把它拆成文件**
—— 内联阈值是全局的，任何一张新素材超过 64KB 就会静默退回「构建版才复现」的白图模式。
