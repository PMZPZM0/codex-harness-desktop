---
id: 2026-10-11-change-独立会话弹窗不播开机动画加popout不播判据
date: 2026-10-11
kind: change
area: appearance
title: 独立会话弹窗不播开机动画加popout不播判据
tags: [boot-intro, popout, bugfix, guard]
commits: []
files: [src/lib/boot-intro.mjs, src/features/settings-appearance/boot550c/BootIntroGate.tsx, scripts/guards/20-boot-intro.mjs]
importance: normal
---

# 独立会话弹窗不播开机动画加popout不播判据

# 独立会话弹窗不该播开机动画（+ 顺带补两处回归红）

用户实测报障（原话）：「我开的对话框独立弹窗，怎么也播放这个动画了」——独立会话弹窗
（`?popout=<会话>`）也会把 550C 开机片头播一遍。这条是上一个会话被"当日用量上限"截断时
**没来得及修**的那一条。

## 根因

片头闸门 `shouldPlayBootIntro(mode, ctx)` 只挡三种情况：档位=关闭 / 系统减弱动效 / `?pet=1` 宠物浮窗。
**没有挡 `?popout=`**。而独立弹窗走的就是 `<App/>`（`main.tsx` 只对 `?pet=1` 分流）⇒ 它必然经过这个闸门，
所以必须由闸门自己挡。⛔ 片头只在**应用启动**那一刻该出现一次；弹窗是从主窗口分出去的第二块屏，不是"开机"。

## 改法（三处，最小）

- `src/lib/boot-intro.mjs`：`shouldPlayBootIntro` 增加一条 `ctx.popoutWindow ⇒ 不播`；`.d.mts` 的 ctx 类型同步。
- `BootIntroGate.tsx`：读 `location.search` 的 **`has("popout")`**（⛔ 不取值：`?popout=` 空值也是分出去的窗口），
  与 `petWindow` 同款写法传给纯函数；头注释的"三条不播判据"改成"四条"。
- 守卫 `20-boot-intro`（34 → 36/36）：判据齐全断言纳入 popout + 闸门确实读了 `has("popout")` +
  **真跑** `shouldPlayBootIntro` 六组用例（默认播 / 关闭档 / 减弱动效 / 宠物窗 / 弹窗 / 简易档在弹窗里）。

变异 2 条全抓：① 纯函数去掉 popout 判据 ⇒ 两条红；② 闸门不传 `popoutWindow` ⇒ 红。

## 顺带：这个会话留下的两处"回归红"（HEAD 当时是红的）

这两处不是本轮的活，但它们让 `npm run check` 在**干净检出上**就是红的，挡住了"每批必须绿"：

1. **P1 的工具 `video_render_html` 没进渲染层的能力清单**（`part08/01-seg.tsx` 的 `harness_tools` 描述）
   —— 守卫【gw】报「漏了模型就看不到那个名字，等于装了却没人用」。补一行。
2. **`src/vite-env.d.ts` 棘轮基线没跟着 P1 的通道改**（822→823，`html-video:render`）。
   ⛔ 生成物随通道数自然变长，棘轮基线必须同轮实测更新。

## 验证

- `npm run check` 退出码 0（补完这两处才绿）；守卫 20-boot-intro 36/36；渲染层 `tsc -b` 0 错。
- `npm run accept`（默认轮 10-12）**15/15**：free-gateway 7 条 + boot-intro 8 条（含影子树成形 / 铺满视口 /
  驱动真在描边 / Esc 跳过 / 档位落盘）—— 改了闸门，这条必须真跑一遍。

## 诚实边界

- 弹窗那条**没有加 e2e 用例**：开弹窗会多一个 page target，harness 取 `list[0]` 有连错窗口的历史坑
  （宠物浮窗就是因此被排除的）。所以判据落在守卫的**真跑真值表**上（四种 ctx 组合逐条比对），
  这正是"能用静态守卫的别用 CDP 跑"的口径。
- 片头在**主窗口**照旧播（默认档 full）。
