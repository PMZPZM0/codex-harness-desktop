---
id: 2026-10-06-incident-用户实测三连修粘贴附件双气泡-编辑行就地锚定-审查弹窗被-containing-block-切头
date: 2026-10-06
kind: incident
area: messages
title: 用户实测三连修：粘贴附件双气泡 / 编辑行就地锚定 / 审查弹窗被 containing block 切头 + 思考浮窗幻影缩放
tags: [user-repro, user-refs, portal, containing-block, reasoning-card]
commits: [f290410]
files: [src/lib/user-refs.ts, src/features/session-queue/SessionQueue.tsx, src/features/session-cards/SessionCards.tsx, src/features/status/Status.tsx, src/features/shared/InlineCards.tsx, src/features/shared/ReasoningCard.tsx, src/styles/04-cards-tools.css, scripts/accept.mjs, scripts/guards/11p-file-summary.mjs, scripts/guards/07-turn-fold.mjs]
importance: normal
---

# 用户实测三连修：粘贴附件双气泡 / 编辑行就地锚定 / 审查弹窗被 containing block 切头 + 思考浮窗幻影缩放

## 背景
用户同一轮连报四件事（真机实测）：①「发文件（粘贴长文→.txt 附件）渲染两次问题还在」；
②「编辑文件 +n 数字在哪个地方就展示在哪个地方，不是一直挂在新消息下面，这样多丑」；
③「文件审查弹窗关不掉，那个叉被遮住了」；④「所有思考板块在回合结束时会重复播放一次缩放效果」。

## 结论
1. **粘贴附件双气泡（真因）**：纯附件消息两侧可见文本都为空（`[附件文件]` 段被 `parseUserRefs` 剥掉、
   本地 token 侧也没有正文）⇒ `userMessageMatchesInput` 的 `if (serverText || inputText)` 不成立、
   落到纯图片分支直接 `false` ⇒ 乐观气泡永不合并，整个回合里消息显示两遍（e2e DOM 实测
   `total:2, pending:1`）。修法：两侧按 `parseUserRefs().files` **附件文件列表**逐项同序比对；
   有文本时也同时要求 filesMatch（`src/lib/user-refs.ts`）。
2. **编辑行就地锚定**：`TurnFoldStream` 订阅 live，按「文件**首次出现时刻**流里最后一条工具项」
   定锚（`liveAnchorsRef`），`CappedToolSequence`/`CappedToolRun` 新增 `renderAfter` 把行挂在
   对应项**后面**；原底部块 `LiveFileChanges` 退役为哑组件 `LiveFileRows`（只画给定列表）。
3. **审查弹窗切头（真因）**：`.turn-group` 上有一个**恒等 transform**（`matrix(1,0,0,1,0,0)`，
   computed 实测）——恒等也创建 containing block，`position:fixed` 的遮罩退化成该回合盒
   （实测 481px 高），弹窗在盒内居中后被顶出屏幕、头部（含关闭键）整个被切掉。修法：
   `createPortal` 到 body（一劳永逸，同仓已有先例）+ 外框不滚/头部常驻/代码区内滚 + Esc 兜底；
   **右键菜单同病同修**（fixed + 视口坐标，留在回合内会被整体偏移）。
4. **思考浮窗幻影缩放（真因）**：回合结束大折叠重挂载思考卡时，残留的
   `bufferedReasoningRevealStarts` 标记让 `revealing` 复位活 ⇒ 浮窗凭空 spawn(放大)→suck(缩回)
   一遍（`animationstart` 实测：同一张卡连播三轮）。修法三重：初始揭示只在 `running` 时读标记；
   揭示 effect 非直播态**先清标记且不读它**；回合结束后的浮窗**只认用户显式点开**
   （`running ? (streamingNow || manualOpen !== null) : manualOpen === true`）。

## 依据
- 双气泡：e2e 合成 paste（>200 字）实测 `total:2, pending:1`；修后全程 `total:1, pending:0`；
  用户真实 session rollout（D:\11）只有 1 条 userMessage = 引擎侧从没收到第二条。
- 弹窗：几何 dump 实测 `mask h=481 / modal t=-29 / header t=-16`（头部在屏幕外）；
  portal 后 `mask h=800 / header t=77`，代码滚到底头部仍可见，Esc 可关。
- 幻影：状态轨迹 `pop=true rev=true run=false` 三连 + `reasoning-float-suck ×3`；三重修复后
  回合结束后**零 pop=true / 零 exit=true**。
- 锚定：探测实测同回合内两组编辑行分别停在各自发生点（top 分布 + 截图），不再贴回合底。
- 验收 `file-summary` 15 条全过（新增 ③b 粘贴附件单气泡 + ② 改走粘贴 chip 路径）；
  守卫 11p 28 条、【161】17 条，新断言全部变异测试通过。

## 影响面
- 所有带附件（粘贴长文/文件 chip）的消息：乐观气泡现在能正常合并（用户侧 = 消息只显示一遍）。
- 运行中编辑行位置改变（就地锚定）；`LiveFileChanges` 组件名退役（改 `LiveFileRows`）。
- 审查弹窗与文件卡右键菜单改为 body 级 portal（不受祖先 transform 影响）。
- 思考卡：回合结束后不再有任何浮窗动画幻影；用户点开预览不受影响。

## 回滚
`git revert` 本轮提交即可（四处修复各自独立，可单点回退）。
