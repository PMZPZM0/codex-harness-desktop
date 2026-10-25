---
id: 2026-10-25-incident-排队面板误显宿主注入消息-中枢身份只认-localstorage-标签被另一窗口顶掉
date: 2026-10-25
kind: incident
area: voice
title: 排队面板误显宿主注入消息 / 中枢身份只认 localStorage / 标签被另一窗口顶掉
tags: [voice, boss, queue, 标签, 持久化]
commits: []
files: []
importance: high
---

# 排队面板误显宿主注入消息 / 中枢身份只认 localStorage / 标签被另一窗口顶掉

用户现场三条报障（10-26）：

① 「成员同步发出来的消息，还要排队吗，这什么操作」
   —— 群事件（`[群事件] 新成员进群：…`）走的是引擎的**用户消息队列**（`thread/queue/add`），
   引擎视角它就是「排队的用户消息」⇒ 应用的排队面板把它显示成「排队中 1/3」的用户消息卡，
   底下还挂着「立即 / 定时 / 编辑 / 删除」——但那不是用户说的话，用户也管不了它。
   根因：宿主注入的消息没有与用户消息区分。修法：宿主侧给 clientUserMessageId 打保留前缀
   （host:…），渲染层按前缀过滤（引擎照收照发，投递链路与 FIFO 一概不动，只在显示层过滤）。
   同一类问题一并修了子智能体回报（delegate-report.ts）。

② 「中枢会话也会变成普通会话」
   —— 中枢身份名单（哪些会话是中枢）**只从 localStorage 读**，而主进程那份登记表
   （<userData>/boss-sessions.json）才是声明过的唯一真相源。localStorage 一丢（清缓存 /
   Chromium profile 重建 / 换源），身份就没了 ⇒ 同一会话在界面上退化成普通会话
   （顶栏成员图标、中枢空态引导、中枢记忆路由全失效）。
   修法：身份名单 = 主进程登记表 ∪ localStorage 缓存；home 锚点读不到时用登记表最后一个兜底。

③ 「对话框选项的标签会掉，重启几次应用就没了」
   —— 会话/项目标签（侧栏「⋯」里的标签编辑器）存在 localStorage，且**每个渲染进程一份快照**；
   应用会开第二个窗口（独立会话弹窗）⇒ 两个窗口各持一份旧快照 ⇒ 旧实现整份覆盖，
   另一个窗口刚写的标签被顶掉。修法：写入前重读盘上最新值，只合并本次改动的那一条；
   删除同理（先重读再删那一条，不能拿旧快照整份覆盖）。
   ⛔ 真机取证：<userData>/Local Storage 的 Chromium profile 在 2026-10-26 02:13 被整个重建
   （只有 000003.log、无 .ldb），而 userData 里的 JSON 都还在 ⇒ 丢的是 localStorage 这一类状态。
   ⇒ 后续凡是要长期留存的，别只放 localStorage。

判据
· 回归脚本 .workbuddy/tmp/ev-spike/test_queue_and_tags.mjs：过滤不误伤用户消息 / 无
  clientUserMessageId 的老数据不过滤 / 标签三窗口互不顶掉 / 删除只删自己那一条 —— 全过。
· 守卫 22-boss-groups 加 5 条断言钉住上述三条（186/186 通过）。
· tsc -b 全绿；vite build 通过；11z-voice-call / 01-build-ipc-css 通过。
