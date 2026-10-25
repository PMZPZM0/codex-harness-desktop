---
id: 2026-10-25-incident-群事件投递机制重做steer-进当前回合不再走用户队列
date: 2026-10-25
kind: incident
area: voice
title: 群事件投递机制重做：steer 进当前回合，不再走用户队列
tags: [voice, boss, queue, 机制重做, steer]
commits: []
files: []
importance: high
---

# 群事件投递机制重做：steer 进当前回合，不再走用户队列

用户现场（10-26 深夜，连发四张截图）：群成员同步的消息冒成「排队中 N/M」；一启动应用直接炸出 50+ 条队列；界面永远显示"运行中"（引擎报 thread already has an active or pending turn）；「你机制有问题，删掉，删干净」。

── 原机制的三个叠加故障 ──────────────────────────────────────────────────
① 群事件一律走引擎的**用户消息队列**（thread/queue/add）⇒ 引擎视角它就是"用户的排队消息"
   ⇒ 应用的排队面板把**宿主注入**当**你的消息**显示（还挂立即/定时/编辑/删除，而你管不了它）。
   ⛔ 引擎协议里没有非用户角色的注入通道（turn/start / queue/add / turn/steer 全是用户消息）
   ⇒ 只能治"怎么送 + 怎么渲染 + 怎么排队"。
② 引擎只在线程空闲时才消化队列 ⇒ 中枢回合一卡住就无限堆积（真机 57~99 条，全是同一批任务的
   「已经 N 秒没有进展（无进展 ×1）」/「已交活 N 分钟仍没有审查结论」）⇒ 启动时界面直接炸开。
③ 队列里存在"待启动回合" ⇒ 引擎报 active/pending turn ⇒ 界面永远"运行中"、发不出新消息。
   ⛔ 停滞看门狗的配额闸是 12 条/10 分钟/任务（本意 1 条），文案还写死 ×1 ⇒ 看起来全是重复。

── 新机制 ──────────────────────────────────────────────────────────────
· 有回合在跑 ⇒ turn/steer 追加进当前回合（不进队列）：立刻送达、不排队、不产生 pending turn、
  排队面板永远干净；中枢空闲 ⇒ 才进队列（那时引擎立刻消费）。活动回合取 engineActiveTurnIds。
· 停滞看门狗不再回投（只作状态记录，看板仍能看到"停滞"）；待审提醒每任务只催一次。
· 队列清理：主进程 tick（5s）+ 渲染层读队列时，删掉"看门狗刷屏"那两类（成品交活是真消息，不删）。
· 宿主消息判定兼容旧数据：认 clientUserMessageId 前缀 host: 或正文含 [群事件]。
· 「thread already has an active or pending turn」按良性处理（引擎那边确实还有回合在跑）⇒ 不弹红错。

判据
· 引擎日志（<userData>/codex-home/logs_2.sqlite）实测：新实例 75 秒内零 thread/queue/add、
  零刷屏文本；清理阶段 thread/queue/delete × 15、thread/queue/list × 23。
· 守卫 22-boss-groups 新增 7 条断言钉住这套机制（193/193 通过）。
· tsc -b 全绿；npm run build 通过；11z-voice-call、01-build-ipc-css 通过；三仓已同步并推送，云端已部署。

同步：主仓 71a62211f → PPcode 65ef005d → 云助手 e91432de（+ 部署）。
